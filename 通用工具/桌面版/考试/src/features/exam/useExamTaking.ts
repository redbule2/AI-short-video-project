import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useDebounceFn, useIntervalFn } from "@vueuse/core";
import {
  type ExamAnswerFile,
  type ExamAnswerValue,
  type ExamPauseStateResult,
  type TakingPaperDto,
  type TakingQuestionDto,
  ExamErrorKinds,
  getExamErrorKind,
  getExamErrorMessage,
  getTakingPaper,
  pauseExam,
  resumeExam,
  saveExamAnswers,
  submitExam,
  uploadExamAnswerImage
} from "@/api/exam";
import {
  examTakingBucketKey,
  useExamTakingStoreHook
} from "@/store/modules/examTaking";
import { useUserStoreHook } from "@/store/modules/user";
import { message } from "@/utils/message";

const AutosaveDebounceMs = 2000;

/**
 * 清洗回灌/快照作答:旧版后端规范化实操作答时把可选字段落成了 null("text":null,
 * 2026-07-24 交卷事故根因),原样再提交会被形状校验拒绝且永远重试不好(毒丸)。
 * 运行时剥掉 null 字段、丢弃非法 files 项与空壳条目,让历史脏数据自愈。
 */
function sanitizeAnswers(
  source: Record<string, ExamAnswerValue>
): Record<string, ExamAnswerValue> {
  const result: Record<string, ExamAnswerValue> = {};
  for (const [questionId, raw] of Object.entries(source ?? {})) {
    if (!raw || typeof raw !== "object") continue;
    const value = { ...raw } as Record<string, unknown>;
    for (const key of ["answer", "answers", "text", "reference", "files"]) {
      if (value[key] === null) delete value[key];
    }
    if (Array.isArray(value.files)) {
      value.files = (value.files as unknown[])
        .filter(
          (file): file is ExamAnswerFile =>
            Boolean(file) && typeof (file as ExamAnswerFile).url === "string"
        )
        .map(file => (file.name == null ? { url: file.url } : file));
    }
    if (Object.keys(value).length === 0) continue;
    result[questionId] = value as ExamAnswerValue;
  }
  return result;
}

/**
 * 答题现场(sub)。体验合同(设计 §8 + 对抗审查采纳):
 * - 进入 1 次拿齐题目+已存作答+计时(frontend.exam.take.enter=1);
 * - 作答本地即时落盘(examTaking store),服务器 2s 防抖保存(frontend.exam.take.autosave=1/窗口);
 * - 恢复:服务器为准,但防抖窗口内未推送的本地改动(updatedAt>lastSyncedAt)以本地为准并立即回推;
 * - 计时只对服务端下发的单一 endTime 倒计时(带 serverNow 漂移校正),到时自动交卷;
 * - 并发/超时被服务端拒绝(sheet-not-active / exam-time-over)= 已交卷,平静跳转复盘,不弹错误。
 */
export function useExamTaking() {
  const route = useRoute();
  const router = useRouter();
  const takingStore = useExamTakingStoreHook();
  const username = useUserStoreHook().username as string;

  const sheetId = computed(() => String(route.query.sheetId ?? ""));
  const bucketKey = computed(() =>
    examTakingBucketKey(username, sheetId.value)
  );

  const loading = ref(true);
  /** 页面级不可答状态:"" 正常;pending=未开考;closed=已结束;error=加载失败。 */
  const blocked = ref<"" | "pending" | "closed" | "error">("");
  const blockedText = ref("");

  const paper = ref<TakingPaperDto | null>(null);
  const answers = ref<Record<string, ExamAnswerValue>>({});
  const flagged = ref<Set<string>>(new Set());
  const currentQuestionId = ref("");
  /**
   * 答题双模式【2026-07-27 用户裁决】:
   * focus=默认逐题作答;overview=仅在考生主动点「回卷面选题」后进入。
   */
  const mode = ref<"overview" | "focus">("focus");

  const saving = ref(false);
  const lastSavedAt = ref<number>(0);
  const saveFailed = ref(false);
  const submitting = ref(false);
  /** 保存五态(如实反馈【gpt-5.6-sol 采纳】):idle→local(已记本机)→syncing→synced/failed/rejected。 */
  const saveState = ref<
    "idle" | "local" | "syncing" | "synced" | "failed" | "rejected"
  >("idle");
  /** 窄屏答题卡抽屉开关(键盘 Esc 需要感知,故放 composable)。 */
  const cardOpen = ref(false);

  /** 服务端时钟漂移:endTimeLocalMs = endTime - serverNow + Date.now()(取一次)。 */
  const endTimeLocalMs = ref<number | null>(null);
  const nowTick = ref(Date.now());
  const autoSubmitted = ref(false);

  // ---------- 计时 v2:暂停冻结 ----------

  /** 是否已暂停(服务端为准;暂停中计时冻结、不能作答,可离开页面)。 */
  const paused = ref(false);
  /** 最近一次服务端下发的剩余答题秒数(不限时为 null);暂停时即冻结显示值。 */
  const budgetRemainingSeconds = ref<number | null>(null);
  const pausing = ref(false);
  const resuming = ref(false);
  /** 本卷是否有答题时长预算(不限时的卷不提供暂停——冻结无意义)。 */
  const hasTimeBudget = computed(() => budgetRemainingSeconds.value !== null);

  const questions = computed<TakingQuestionDto[]>(
    () => paper.value?.questions ?? []
  );

  function isAnswered(questionId: string): boolean {
    const value = answers.value[questionId];
    if (!value) return false;
    const question = questions.value.find(q => q.questionId === questionId);
    switch (question?.type) {
      case "single":
        return typeof value.answer === "string" && value.answer.length > 0;
      case "multiple":
        return (value.answers?.length ?? 0) > 0;
      case "judge":
        return typeof value.answer === "boolean";
      case "fillBlank":
        return (value.answers ?? []).some(item => item?.trim());
      case "essay":
        return Boolean(value.text?.trim());
      case "practical":
        return (value.files?.length ?? 0) > 0 || Boolean(value.text?.trim());
      default:
        return false;
    }
  }

  const answeredCount = computed(
    () => questions.value.filter(q => isAnswered(q.questionId)).length
  );
  const unansweredCount = computed(
    () => questions.value.length - answeredCount.value
  );

  /** 硬止点倒计时(驱动到时自动交卷):暂停时 endTime=截止时间,照常倒数。 */
  const remainingMs = computed(() => {
    if (endTimeLocalMs.value === null) return null;
    return Math.max(0, endTimeLocalMs.value - nowTick.value);
  });

  function formatClock(totalSeconds: number) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  /** 计时展示:暂停=冻结的剩余答题时长;活跃=到最近止点(时长/截止孰早)的倒计时。 */
  const remainingText = computed(() => {
    if (paused.value) {
      return budgetRemainingSeconds.value === null
        ? "不限时"
        : formatClock(budgetRemainingSeconds.value);
    }
    const ms = remainingMs.value;
    if (ms === null) return "不限时";
    return formatClock(Math.floor(ms / 1000));
  });
  /** 剩余 <5 分钟进入告警态(计时变朱砂;暂停冻结时不告警)。 */
  const timeCritical = computed(
    () =>
      !paused.value &&
      remainingMs.value !== null &&
      remainingMs.value <= 5 * 60 * 1000
  );
  function formatDeadline(value: string | number | Date) {
    return new Date(value).toLocaleString("zh-CN", {
      hour12: false,
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  /** 最晚交卷时间(墙钟硬止点):活跃答题时也与剩余时长同屏展示【sol 必改#2】。 */
  const deadlineText = computed(() =>
    paper.value?.deadline ? formatDeadline(paper.value.deadline) : null
  );
  /** 暂停页提示:截止时间(到点仍强制收卷)。暂停时 endTime 即截止。 */
  const pausedDeadlineText = computed(() => {
    if (!paused.value) return null;
    if (paper.value?.deadline) return formatDeadline(paper.value.deadline);
    if (endTimeLocalMs.value === null) return null;
    return formatDeadline(endTimeLocalMs.value);
  });
  /** 暂停时作答是否已确认同步到服务器(暂停层如实区分,不笼统说"放心离开")。 */
  const pausedSyncOk = computed(
    () => saveState.value === "synced" || saveState.value === "idle"
  );

  const lastSavedText = computed(() => {
    switch (saveState.value) {
      case "rejected":
        return "有作答未通过校验,未能同步;修改对应题目后自动重存";
      case "failed":
        return "网络不稳,本机内容仍在;恢复后自动同步";
      case "syncing":
        return "同步中…";
      case "local":
        return "已记在本机 · 等待同步";
      case "synced":
        return `已同步 ${new Date(lastSavedAt.value).toLocaleTimeString("zh-CN", { hour12: false })}`;
      default:
        return "作答会自动保存";
    }
  });

  // ---------- 保存链 ----------

  /** 保存串行化旗标:在飞请求期间的新改动只记「需再存」,完成后用最新快照补一发——
   * 防止旧请求晚到覆盖删除操作(如移除最后一张实操图片)【gpt-5.6-sol 应改#7】。 */
  let needResave = false;
  /** 形状校验被拒只弹一次错(每次保存尝试都会再抛,防轰炸)。 */
  let shapeErrorWarned = false;

  /** 保存一次(立即,不防抖):暂停前冲刷与防抖推送共用同一实现【sol 必改#1】。 */
  async function syncAnswersNow(): Promise<boolean> {
    if (!paper.value || submitting.value || autoSubmitted.value) return false;
    if (saving.value) {
      needResave = true;
      return false;
    }
    saving.value = true;
    saveState.value = "syncing";
    try {
      await saveExamAnswers(sheetId.value, answers.value);
      saveFailed.value = false;
      shapeErrorWarned = false;
      lastSavedAt.value = Date.now();
      saveState.value = "synced";
      takingStore.patch(bucketKey.value, snapshot => {
        snapshot.lastSyncedAt = Date.now();
      });
      return true;
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (kind === ExamErrorKinds.SheetNotActive) {
        // 已被并发/超时交卷:平静收场
        await handleClosed("考试已结束,已按最后保存的作答交卷。");
      } else if (kind === ExamErrorKinds.ExamTimeOver) {
        await handleClosed("时间到,已按最后保存的作答自动交卷。");
      } else if (kind === ExamErrorKinds.ExamPaused) {
        // 计时 v2:服务端说已暂停(如另开标签页暂停)——同步暂停态,
        // 本地作答保留,恢复答题后自动补一发同步
        paused.value = true;
        saveState.value = "local";
      } else if (kind === ExamErrorKinds.AnswerShapeInvalid) {
        // 形状校验被拒是确定性失败:自动重试永远不会好(2026-07-24 曾静默失败 2 小时),
        // 如实大声报错并停止重试;用户修改对应题目后 setAnswer 自然再触发保存
        saveFailed.value = true;
        saveState.value = "rejected";
        if (!shapeErrorWarned) {
          shapeErrorWarned = true;
          message(getExamErrorMessage(error), {
            type: "error",
            duration: 8000
          });
        }
      } else {
        // 本地已落盘,不打断作答;经防抖自动重试(每窗口≤1次,与预算一致)
        saveFailed.value = true;
        saveState.value = "failed";
        void pushToServer();
      }
      return false;
    } finally {
      saving.value = false;
      if (needResave && !autoSubmitted.value) {
        needResave = false;
        void pushToServer();
      }
    }
  }

  const pushToServer = useDebounceFn(syncAnswersNow, AutosaveDebounceMs);

  /** 唯一作答写入口:本地即时落盘 + 防抖推服务器。暂停中冻结作答(与服务端一致)。 */
  function setAnswer(questionId: string, value: ExamAnswerValue | null) {
    if (paused.value) return;
    const next = { ...answers.value };
    if (value === null) {
      delete next[questionId];
    } else {
      next[questionId] = value;
    }
    answers.value = next;
    takingStore.patch(bucketKey.value, snapshot => {
      snapshot.answers = { ...next };
      snapshot.updatedAt = Date.now();
    });
    if (saveState.value !== "syncing") {
      saveState.value = "local"; // 输入瞬间如实反馈:先记本机,防抖后同步
    }
    void pushToServer();
  }

  // ---------- 实操题:图片上传作答 ----------

  /** 每题最多上传张数(与后端 ExamScoring.MaxPracticalFiles 同值,由保存校验兜底)。 */
  const MaxPracticalFiles = 3;
  const uploadingCount = ref(0);

  /** 选择即上传:成功后把 {url,name} 记入该题作答(走统一 setAnswer 落盘+同步)。 */
  async function uploadPracticalFile(questionId: string, file: File) {
    const current = answers.value[questionId]?.files ?? [];
    if (current.length >= MaxPracticalFiles) {
      message(`每题最多上传 ${MaxPracticalFiles} 张图片。`, {
        type: "warning"
      });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      message("图片大小须在 10MB 以内。", { type: "warning" });
      return;
    }
    uploadingCount.value += 1;
    try {
      const uploaded = await uploadExamAnswerImage(sheetId.value, file);
      const existing = answers.value[questionId];
      const next: ExamAnswerFile[] = [...(existing?.files ?? []), uploaded];
      // 保留随附文字(提示词/自评)——上传不清空 text
      setAnswer(questionId, { files: next, text: existing?.text });
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (kind === ExamErrorKinds.SheetNotActive) {
        await handleClosed("考试已结束,图片未上传。");
      } else {
        message(getExamErrorMessage(error), { type: "error" });
      }
    } finally {
      uploadingCount.value -= 1;
    }
  }

  function removePracticalFile(questionId: string, url: string) {
    const existing = answers.value[questionId];
    const next = (existing?.files ?? []).filter(item => item.url !== url);
    const text = existing?.text?.trim() ? existing.text : undefined;
    setAnswer(questionId, next.length || text ? { files: next, text } : null);
  }

  /** 实操随附文字(最终提示词/自评);与图片共同构成作答。 */
  function setPracticalText(questionId: string, text: string) {
    const existing = answers.value[questionId];
    const files = existing?.files ?? [];
    const trimmed = text.trim();
    setAnswer(
      questionId,
      files.length || trimmed
        ? { files, text: trimmed ? text : undefined }
        : null
    );
  }

  // ---------- 计时 v2:暂停 / 恢复 ----------

  /** 应用服务端下发的暂停态(单一时钟:endTime 带漂移校正落到本地)。 */
  function applyPauseState(state: ExamPauseStateResult) {
    paused.value = state.paused;
    budgetRemainingSeconds.value = state.remainingSeconds;
    if (state.endTime) {
      const serverNow = new Date(state.serverNow).getTime();
      const endTime = new Date(state.endTime).getTime();
      endTimeLocalMs.value = Date.now() + (endTime - serverNow);
    } else {
      endTimeLocalMs.value = null;
    }
  }

  /** 暂停答题:计时冻结,可离开页面;截止时间到仍会强制收卷。幂等。 */
  async function pause() {
    if (pausing.value || paused.value || submitting.value || !paper.value)
      return;
    // 上传完成屏障:图片在飞时暂停,写入会被"已暂停"拒收【sol 必改#1】
    if (uploadingCount.value > 0) {
      message("图片还在上传,传完再暂停(或先移除该图)。", { type: "warning" });
      return;
    }
    pausing.value = true;
    try {
      // 先冲刷最后一笔作答(不等防抖窗口),暂停层的"已同步"承诺才立得住;
      // 冲刷失败照样允许暂停,但暂停层会如实提示"仅保存在本机"
      await syncAnswersNow();
      const result = await pauseExam(sheetId.value);
      applyPauseState(result);
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (
        kind === ExamErrorKinds.SheetNotActive ||
        kind === ExamErrorKinds.ExamTimeOver
      ) {
        await handleClosed("考试已结束,已按最后保存的作答交卷。");
      } else {
        message(getExamErrorMessage(error), { type: "error" });
      }
    } finally {
      pausing.value = false;
    }
  }

  /** 恢复答题:计时重新起表;预算已耗尽会被服务端按最后作答强制交卷。 */
  async function resume() {
    if (resuming.value || !paused.value || !paper.value) return;
    resuming.value = true;
    try {
      const result = await resumeExam(sheetId.value);
      applyPauseState(result);
      // 暂停期间若有被拒的本地改动,恢复后自动补同步(经防抖,预算不变)
      void pushToServer();
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (kind === ExamErrorKinds.ExamTimeOver) {
        await handleClosed("答题时长已用完,已按最后保存的作答自动交卷。");
      } else if (kind === ExamErrorKinds.SheetNotActive) {
        await handleClosed("考试已结束,已按最后保存的作答交卷。");
      } else {
        message(getExamErrorMessage(error), { type: "error" });
      }
    } finally {
      resuming.value = false;
    }
  }

  function toggleFlag(questionId: string) {
    const next = new Set(flagged.value);
    if (next.has(questionId)) {
      next.delete(questionId);
    } else {
      next.add(questionId);
    }
    flagged.value = next;
    takingStore.patch(bucketKey.value, snapshot => {
      snapshot.flagged = [...next];
    });
  }

  function scrollToQuestion(questionId: string) {
    currentQuestionId.value = questionId;
    document
      .getElementById(`exam-q-${questionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- 专注答题模式 ----------

  const currentIndex = computed(() =>
    questions.value.findIndex(q => q.questionId === currentQuestionId.value)
  );
  const currentQuestion = computed(() =>
    currentIndex.value >= 0 ? questions.value[currentIndex.value] : null
  );
  const hasPrev = computed(() => currentIndex.value > 0);
  const hasNext = computed(
    () =>
      currentIndex.value >= 0 && currentIndex.value < questions.value.length - 1
  );

  /** 换题后把焦点送回题干(键盘/读屏不迷路【gpt-5.6-sol 采纳】)。 */
  function focusStem() {
    requestAnimationFrame(() => {
      document
        .getElementById("exam-focus-stem")
        ?.focus({ preventScroll: true });
    });
  }

  /** 从总览/答题卡点进某题,进入专注答题。 */
  function enterFocus(questionId: string) {
    currentQuestionId.value = questionId;
    mode.value = "focus";
    cardOpen.value = false;
    window.scrollTo({ top: 0 });
    focusStem();
  }

  /** 退出答题模式,回到卷面总览并定位到刚才那题。 */
  function exitFocus() {
    const questionId = currentQuestionId.value;
    mode.value = "overview";
    requestAnimationFrame(() => {
      document
        .getElementById(`exam-q-${questionId}`)
        ?.scrollIntoView({ block: "center" });
    });
  }

  function goPrev() {
    if (!hasPrev.value) return;
    currentQuestionId.value =
      questions.value[currentIndex.value - 1].questionId;
    window.scrollTo({ top: 0 });
    focusStem();
  }

  function goNext() {
    if (!hasNext.value) return;
    currentQuestionId.value =
      questions.value[currentIndex.value + 1].questionId;
    window.scrollTo({ top: 0 });
    focusStem();
  }

  /** 键盘用选项键(A-D / 1-9)作答当前题;判断题 A/1=对、B/2=错。 */
  function applyKeyOption(rawKey: string) {
    const question = currentQuestion.value;
    if (!question) return;
    const key = rawKey.toUpperCase();
    if (question.type === "judge") {
      if (key === "A" || key === "1")
        setAnswer(question.questionId, { answer: true });
      if (key === "B" || key === "2")
        setAnswer(question.questionId, { answer: false });
      return;
    }
    if (question.type !== "single" && question.type !== "multiple") return;
    const options = question.options ?? [];
    const byLetter = options.find(option => option.key.toUpperCase() === key);
    const byDigit = /^[1-9]$/.test(key) ? options[Number(key) - 1] : undefined;
    const target = byLetter ?? byDigit;
    if (!target) return;
    if (question.type === "single") {
      setAnswer(question.questionId, { answer: target.key });
      return;
    }
    const current = answers.value[question.questionId]?.answers ?? [];
    const next = current.includes(target.key)
      ? current.filter(item => item !== target.key)
      : [...current, target.key];
    setAnswer(question.questionId, next.length ? { answers: next } : null);
  }

  /** 专注模式键盘作答:A-D/1-9 选项、←/→ 翻题、Esc 回卷面、F 标记(输入中/弹层内不劫持)。 */
  function handleKeydown(event: KeyboardEvent) {
    // 暂停层盖住卷面时,不再劫持任何答题快捷键(遮罩后的题目不可操作)【sol 可选采纳】
    if (paused.value) return;
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    )
      return;
    // 卷面直答后这条输入豁免是每次填空击键的必经之路,别再收窄
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(
        "input, textarea, [contenteditable], .el-overlay, .el-message-box"
      )
    ) {
      // 输入/弹层中仅保留 Esc 关答题卡抽屉
      if (event.key === "Escape" && cardOpen.value) {
        cardOpen.value = false;
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Escape") {
      if (cardOpen.value) {
        cardOpen.value = false;
      } else if (mode.value === "focus") {
        exitFocus();
      }
      event.preventDefault();
      return;
    }
    if (mode.value !== "focus") return;
    switch (event.key) {
      case "ArrowLeft":
        goPrev();
        event.preventDefault();
        break;
      case "ArrowRight":
        goNext();
        event.preventDefault();
        break;
      case "f":
      case "F":
        if (currentQuestion.value) toggleFlag(currentQuestion.value.questionId);
        event.preventDefault();
        break;
      default:
        if (/^[a-hA-H1-9]$/.test(event.key)) {
          applyKeyOption(event.key);
          event.preventDefault();
        }
    }
  }

  // ---------- 生命周期 ----------

  async function load() {
    if (!sheetId.value) {
      blocked.value = "error";
      blockedText.value = "缺少答卷参数,请从「我的考试」进入。";
      loading.value = false;
      return;
    }
    loading.value = true;
    try {
      const result = await getTakingPaper(sheetId.value);
      paper.value = result;

      // 恢复:服务器为准;但本地有未同步改动(updatedAt>lastSyncedAt)时,本地快照
      // 是唯一完整事实源(patch 每次落全量 map)——整体取代而非 overlay 合并,
      // 否则"清空某题作答"这类删除会被服务器旧值复活【gpt-eval Blocking#2 修复】
      // 两个来源都过 sanitizeAnswers:历史落库/旧快照里的 "text":null 毒丸在此拆除
      const snapshot = takingStore.get(bucketKey.value);
      const hasUnsyncedLocal =
        snapshot.updatedAt > 0 && snapshot.updatedAt > snapshot.lastSyncedAt;
      const merged: Record<string, ExamAnswerValue> = sanitizeAnswers(
        hasUnsyncedLocal ? snapshot.answers : (result.savedAnswers ?? {})
      );
      answers.value = merged;
      flagged.value = new Set(snapshot.flagged);
      takingStore.patch(bucketKey.value, item => {
        item.answers = { ...merged };
      });
      if (hasUnsyncedLocal) {
        void pushToServer();
      }

      if (result.endTime) {
        const serverNow = new Date(result.serverNow).getTime();
        const endTime = new Date(result.endTime).getTime();
        endTimeLocalMs.value = Date.now() + (endTime - serverNow);
      } else {
        endTimeLocalMs.value = null;
      }
      // 计时 v2:恢复暂停态(暂停中刷新/重进页面,回来仍是暂停页)
      paused.value = result.paused;
      budgetRemainingSeconds.value = result.remainingSeconds;
      currentQuestionId.value = result.questions[0]?.questionId ?? "";
      // 每次进入/继续答题都从第一题的逐题模式开始;总览只能由考生主动打开。
      mode.value = "focus";
      blocked.value = "";
    } catch (error) {
      const kind = getExamErrorKind(error);
      const text = getExamErrorMessage(error);
      if (kind === ExamErrorKinds.SheetNotActive) {
        if (text.includes("还未开始")) {
          blocked.value = "pending";
          blockedText.value =
            "这场考试还没开始,请回「我的考试」点「开始考试」。";
        } else {
          blocked.value = "closed";
          blockedText.value = "考试已结束。";
        }
      } else {
        blocked.value = "error";
        blockedText.value = text;
      }
    } finally {
      loading.value = false;
    }
  }

  async function handleClosed(text: string) {
    if (autoSubmitted.value) return;
    autoSubmitted.value = true;
    takingStore.clear(bucketKey.value);
    message(text, { type: "warning" });
    await router.replace({
      name: "ExamReview",
      query: { sheetId: sheetId.value }
    });
  }

  /** 到时自动交卷(以服务端为准;本地时钟只做触发)。 */
  async function autoSubmitOnTimeout() {
    if (autoSubmitted.value || submitting.value) return;
    autoSubmitted.value = true;
    // 有界等待在飞的图片上传(服务端有 60s 宽限,这里最多等 8s)【gpt-5.6-sol 必改#4】
    for (
      let waited = 0;
      uploadingCount.value > 0 && waited < 8000;
      waited += 400
    ) {
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    submitting.value = true;
    try {
      const result = await submitExam(sheetId.value, answers.value);
      takingStore.clear(bucketKey.value);
      message(
        result.status === "已判分"
          ? `时间到,已自动交卷。客观题得分 ${result.objectiveScore} 分。`
          : "时间到,已自动交卷。主观题正在判分。",
        { type: "warning" }
      );
      await router.replace({
        name: "ExamReview",
        query: { sheetId: sheetId.value }
      });
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (
        kind === ExamErrorKinds.SheetNotActive ||
        kind === ExamErrorKinds.ExamTimeOver
      ) {
        takingStore.clear(bucketKey.value);
        await router.replace({
          name: "ExamReview",
          query: { sheetId: sheetId.value }
        });
      } else {
        autoSubmitted.value = false;
        message(getExamErrorMessage(error), { type: "error" });
      }
    } finally {
      submitting.value = false;
    }
  }

  /** 暂停层出现时把焦点送到「继续答题」,键盘用户不迷路【sol 可选采纳】。 */
  watch(paused, value => {
    if (!value || typeof window === "undefined") return;
    requestAnimationFrame(() => {
      document.getElementById("exam-paused-resume")?.focus();
    });
  });

  const timer = useIntervalFn(
    () => {
      nowTick.value = Date.now();
      if (
        remainingMs.value !== null &&
        remainingMs.value <= 0 &&
        paper.value &&
        !autoSubmitted.value
      ) {
        void autoSubmitOnTimeout();
      }
    },
    500,
    { immediate: true }
  );

  /** 检查并交卷:确认框列 已答/未答/标记 三项,默认焦点=返回检查【gpt-5.6-sol 采纳】。 */
  function confirmSubmit() {
    if (submitting.value || !paper.value) return;
    // 上传完成屏障:图片还在传就交卷,答案会缺图【gpt-5.6-sol 必改#4】
    if (uploadingCount.value > 0) {
      message("图片还在上传,传完再交卷(或先移除该图)。", { type: "warning" });
      return;
    }
    const unanswered = unansweredCount.value;
    const flaggedCount = flagged.value.size;
    const parts = [
      `已答 ${answeredCount.value} 题`,
      `未答 ${unanswered} 题`,
      ...(flaggedCount > 0 ? [`标记 ${flaggedCount} 题`] : [])
    ];
    const tip = `${parts.join(" · ")}。交卷后不能再修改。`;
    void ElMessageBox.confirm(tip, "确认交卷?", {
      confirmButtonText: "确认交卷",
      cancelButtonText: "返回检查",
      type: unanswered > 0 ? "warning" : "info",
      autofocus: false
    })
      .then(() => doSubmit())
      .catch(() => undefined);
  }

  async function doSubmit() {
    if (submitting.value) return;
    submitting.value = true;
    autoSubmitted.value = true; // 停掉计时自动交卷竞争
    try {
      const result = await submitExam(sheetId.value, answers.value);
      takingStore.clear(bucketKey.value);
      message(
        result.status === "已判分"
          ? `交卷成功,得分 ${result.totalScore} 分。`
          : `交卷成功。客观题 ${result.objectiveScore} 分,主观题等待 AI 判分。`,
        { type: "success" }
      );
      await router.replace({
        name: "ExamReview",
        query: { sheetId: sheetId.value }
      });
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (kind === ExamErrorKinds.SheetNotActive) {
        takingStore.clear(bucketKey.value);
        await router.replace({
          name: "ExamReview",
          query: { sheetId: sheetId.value }
        });
      } else {
        autoSubmitted.value = false;
        message(getExamErrorMessage(error), { type: "error" });
      }
    } finally {
      submitting.value = false;
    }
  }

  function backToMy() {
    void router.push({ name: "ExamMy" });
  }

  onMounted(() => {
    void load();
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeydown);
    }
  });

  onBeforeUnmount(() => {
    timer.pause();
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handleKeydown);
    }
  });

  return {
    sheetId,
    loading,
    blocked,
    blockedText,
    paper,
    questions,
    answers,
    flagged,
    currentQuestionId,
    mode,
    cardOpen,
    currentIndex,
    currentQuestion,
    hasPrev,
    hasNext,
    answeredCount,
    unansweredCount,
    remainingMs,
    remainingText,
    timeCritical,
    paused,
    pausing,
    resuming,
    hasTimeBudget,
    deadlineText,
    pausedDeadlineText,
    pausedSyncOk,
    pause,
    resume,
    saving,
    saveFailed,
    lastSavedText,
    submitting,
    isAnswered,
    setAnswer,
    uploadingCount,
    uploadPracticalFile,
    removePracticalFile,
    setPracticalText,
    toggleFlag,
    scrollToQuestion,
    enterFocus,
    exitFocus,
    goPrev,
    goNext,
    confirmSubmit,
    backToMy,
    load
  };
}
