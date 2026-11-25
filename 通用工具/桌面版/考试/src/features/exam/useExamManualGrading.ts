import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  ExamErrorKinds,
  getExamErrorKind,
  getExamErrorMessage,
  getManualGradingReferences,
  getManualGradingWorkspace,
  type ManualGradingQuestionDto,
  type ManualGradingReferencesDto,
  type ManualGradingWorkspaceDto,
  submitManualGrading
} from "@/api/exam";
import { message } from "@/utils/message";

interface ManualGradeDraftItem {
  score: number | null;
  comment: string;
}

type ManualGradeDraft = Record<string, ManualGradeDraftItem>;

interface ManualGradeDraftEnvelope {
  schemaVersion: 2;
  viewerUsername: string;
  revision: number;
  submittedAt: string | null;
  items: ManualGradeDraft;
  /** 逐题阅卷游标；选填字段，旧草稿无此键时回落到第一题。 */
  cursorQuestionId?: string | null;
}

/** 逐题阅卷内容区锚点：切题后把阅读起点带回题首（视图渲染此 id）。 */
export const MANUAL_GRADING_ANCHOR_ID = "manual-grading-current";

function draftKey(viewerUsername: string, sheetId: string) {
  return `new-video8:exam-manual-grading:${viewerUsername}:${sheetId}`;
}

function readDraft(current: ManualGradingWorkspaceDto): {
  items: ManualGradeDraft;
  cursorQuestionId: string;
} {
  const empty = { items: {} as ManualGradeDraft, cursorQuestionId: "" };
  if (!current.sheetId || typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(
      draftKey(current.viewerUsername, current.sheetId)
    );
    if (!raw) return empty;
    const envelope = JSON.parse(raw) as Partial<ManualGradeDraftEnvelope>;
    return envelope.schemaVersion === 2 &&
      envelope.viewerUsername === current.viewerUsername &&
      envelope.revision === current.revision &&
      envelope.submittedAt === current.submittedAt &&
      envelope.items
      ? {
          items: envelope.items,
          cursorQuestionId: envelope.cursorQuestionId ?? ""
        }
      : empty;
  } catch {
    return empty;
  }
}

function persistDraft(
  current: ManualGradingWorkspaceDto,
  items: ManualGradeDraft,
  cursorQuestionId: string
) {
  if (typeof window === "undefined") return;
  const envelope: ManualGradeDraftEnvelope = {
    schemaVersion: 2,
    viewerUsername: current.viewerUsername,
    revision: current.revision,
    submittedAt: current.submittedAt,
    items,
    cursorQuestionId
  };
  window.localStorage.setItem(
    draftKey(current.viewerUsername, current.sheetId),
    JSON.stringify(envelope)
  );
}

/**
 * 人工阅卷页请求预算：
 * - 盲评首次进入=工作台 1 GET；
 * - 已提交复核进入=工作台 1 + 参考信息 1 GET；
 * - 首次提交=PUT 1 + 解锁后参考信息 GET 1；
 * - 复核保存=PUT 1。草稿仅写 localStorage，不产生 HTTP。
 * - 逐题切换=0 HTTP：整卷题目与作答由同一个工作台聚合 GET 一次拿齐，
 *   切题只移动本地游标，不按题请求（禁 N+1）。
 *
 * 完成口径（2026-07-25 业务裁决，与后端 ExamManualGradingRules 同源）：
 * 人工得分必填且必须是 [0, 本题满分] 的整数；人工批语选填，留白不影响完成态与提交。
 */
export function useExamManualGrading() {
  const route = useRoute();
  const router = useRouter();
  const sheetId = computed(() => String(route.query.sheetId ?? "").trim());
  const paperId = computed(() => String(route.query.paperId ?? "").trim());

  const loading = ref(true);
  const saving = ref(false);
  const errorText = ref("");
  const workspace = ref<ManualGradingWorkspaceDto | null>(null);
  const references = ref<ManualGradingReferencesDto | null>(null);
  const grades = ref<ManualGradeDraft>({});
  const hydrated = ref(false);
  /** 逐题阅卷游标（题目业务 ID）；空串表示回落到第一题。 */
  const currentQuestionId = ref("");

  const items = computed<ManualGradingQuestionDto[]>(
    () => workspace.value?.items ?? []
  );
  const referencesByQuestion = computed(
    () =>
      new Map(
        (references.value?.items ?? []).map(item => [item.questionId, item])
      )
  );

  /** 单题是否算「已评分」：整数分且落在 [0, 满分]；与批语无关。 */
  function isScored(item: ManualGradingQuestionDto) {
    const score = grades.value[item.questionId]?.score;
    return (
      typeof score === "number" &&
      Number.isInteger(score) &&
      score >= 0 &&
      score <= item.score
    );
  }

  const scoredQuestionIds = computed(
    () => new Set(items.value.filter(isScored).map(item => item.questionId))
  );
  const completedCount = computed(() => scoredQuestionIds.value.size);
  const unscoredCount = computed(
    () => items.value.length - completedCount.value
  );
  const isComplete = computed(
    () => items.value.length > 0 && unscoredCount.value === 0
  );
  const progressPercent = computed(() =>
    items.value.length === 0
      ? 0
      : Math.round((completedCount.value / items.value.length) * 100)
  );

  const subjectiveScore = computed(() =>
    items.value.reduce((sum, item) => {
      const value = grades.value[item.questionId]?.score;
      return sum + (typeof value === "number" ? value : 0);
    }, 0)
  );
  const projectedTotal = computed(
    () => (workspace.value?.objectiveScore ?? 0) + subjectiveScore.value
  );
  const isReviewStage = computed(() =>
    Boolean(workspace.value?.referencesUnlocked)
  );
  const studentLabel = computed(() => {
    const current = workspace.value;
    if (!current) return "";
    return current.studentDisplayName
      ? `${current.studentDisplayName}（${current.studentUsername}）`
      : current.studentUsername;
  });

  // ---------- 逐题阅卷 ----------

  /** 游标失效（首次进入/冲突后题集变化）时回落第一题，保证下标恒定有效。 */
  const currentIndex = computed(() => {
    const index = items.value.findIndex(
      item => item.questionId === currentQuestionId.value
    );
    return index >= 0 ? index : 0;
  });
  const currentItem = computed<ManualGradingQuestionDto | null>(
    () => items.value[currentIndex.value] ?? null
  );
  const currentGrade = computed<ManualGradeDraftItem>(
    () =>
      grades.value[currentItem.value?.questionId ?? ""] ?? {
        score: null,
        comment: ""
      }
  );
  const currentReference = computed(() =>
    currentItem.value
      ? (referencesByQuestion.value.get(currentItem.value.questionId) ?? null)
      : null
  );
  const hasPrev = computed(() => currentIndex.value > 0);
  const hasNext = computed(() => currentIndex.value < items.value.length - 1);
  const firstUnscoredIndex = computed(() =>
    items.value.findIndex(item => !isScored(item))
  );

  /**
   * 切题后把阅读起点带回页首。
   * 逐题模式一屏只有一道题，阅读起点就是页首——所以是把滚动容器归零，
   * 而不是 scrollIntoView 把题卡顶到容器顶（那会把抬头与进度条挤出视口）。
   */
  function scrollToQuestionTop() {
    if (typeof document === "undefined") return;
    void nextTick(() => {
      const anchor = document.getElementById(MANUAL_GRADING_ANCHOR_ID);
      for (let node = anchor?.parentElement; node; node = node.parentElement) {
        const overflowY = getComputedStyle(node).overflowY;
        if (
          /(auto|scroll|overlay)/.test(overflowY) &&
          node.scrollHeight > node.clientHeight + 1
        ) {
          node.scrollTop = 0;
          break;
        }
      }
      window.scrollTo(0, 0);
    });
  }

  function goTo(index: number) {
    const target = items.value[index];
    if (!target || target.questionId === currentQuestionId.value) return;
    currentQuestionId.value = target.questionId;
    scrollToQuestionTop();
  }

  function goPrev() {
    if (hasPrev.value) goTo(currentIndex.value - 1);
  }

  function goNext() {
    if (hasNext.value) goTo(currentIndex.value + 1);
  }

  /** 一键跳到第一道未评分题；全部评完时不动。 */
  function goFirstUnscored() {
    const index = firstUnscoredIndex.value;
    if (index >= 0) goTo(index);
  }

  // ---------- 评分与批语（唯一写入口，子组件不直接改 grades） ----------

  function setScore(questionId: string, value: number) {
    const grade = grades.value[questionId];
    if (!grade) return;
    grade.score = value;
  }

  function setComment(questionId: string, value: string) {
    const grade = grades.value[questionId];
    if (!grade) return;
    grade.comment = value;
  }

  function hydrateGrades(current: ManualGradingWorkspaceDto) {
    const local = readDraft(current);
    grades.value = Object.fromEntries(
      current.items.map(item => {
        const cached = local.items[item.questionId];
        return [
          item.questionId,
          {
            score: cached?.score ?? item.manualScore ?? null,
            comment: cached?.comment ?? item.manualComment ?? ""
          }
        ];
      })
    );
    const resumed = current.items.some(
      item => item.questionId === local.cursorQuestionId
    )
      ? local.cursorQuestionId
      : "";
    currentQuestionId.value = resumed || current.items[0]?.questionId || "";
    hydrated.value = true;
  }

  async function load() {
    if (!sheetId.value) {
      errorText.value = "缺少答卷编号，请从成绩总览重新进入。";
      loading.value = false;
      return;
    }

    loading.value = true;
    errorText.value = "";
    references.value = null;
    hydrated.value = false;
    try {
      const current = await getManualGradingWorkspace(sheetId.value);
      if (!current) {
        errorText.value = "答卷不存在或已被撤回。";
        return;
      }
      workspace.value = current;
      hydrateGrades(current);
      if (current.referencesUnlocked && current.requiresManualGrading) {
        references.value = await getManualGradingReferences(current.sheetId);
      }
    } catch (error) {
      errorText.value = getExamErrorMessage(error);
    } finally {
      loading.value = false;
    }
  }

  // 评分/批语/游标任一变化即落盘；只写 localStorage，不产生 HTTP。
  watch(
    [grades, currentQuestionId],
    () => {
      if (
        !hydrated.value ||
        !workspace.value ||
        typeof window === "undefined"
      ) {
        return;
      }
      persistDraft(workspace.value, grades.value, currentQuestionId.value);
    },
    { deep: true }
  );

  async function submit() {
    const current = workspace.value;
    if (!current || saving.value || !isComplete.value) return;

    if (!current.referencesUnlocked) {
      try {
        await ElMessageBox.confirm(
          "提交后会解锁参考答案、解析和 AI 评分。请确认整卷主观题的人工得分都已给定（人工批语选填，可以留白）。",
          "提交人工阅卷？",
          {
            confirmButtonText: "提交并解锁解析",
            cancelButtonText: "继续检查",
            type: "warning"
          }
        );
      } catch {
        return;
      }
    }

    saving.value = true;
    try {
      const result = await submitManualGrading(
        current.sheetId,
        current.revision,
        current.items.map(item => ({
          questionId: item.questionId,
          score: grades.value[item.questionId].score as number,
          comment: grades.value[item.questionId].comment.trim()
        }))
      );
      const wasBlind = !current.referencesUnlocked;
      Object.assign(current, {
        referencesUnlocked: true,
        revision: result.revision,
        manualTotalScore: result.manualTotalScore,
        firstSubmittedAt: result.firstSubmittedAt
      });
      for (const item of current.items) {
        item.manualScore = grades.value[item.questionId].score;
        item.manualComment = grades.value[item.questionId].comment.trim();
      }
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(
          draftKey(current.viewerUsername, current.sheetId)
        );
      }
      if (wasBlind) {
        references.value = await getManualGradingReferences(current.sheetId);
        message("人工阅卷已提交，参考答案与解析已解锁", {
          type: "success"
        });
      } else {
        if (references.value) references.value.revision = result.revision;
        message("人工评分已更新", { type: "success" });
      }
    } catch (error) {
      if (getExamErrorKind(error) === ExamErrorKinds.ManualGradingConflict) {
        try {
          const preserved = Object.fromEntries(
            Object.entries(grades.value).map(([questionId, item]) => [
              questionId,
              { ...item }
            ])
          );
          const preservedCursor = currentQuestionId.value;
          const latest = await getManualGradingWorkspace(current.sheetId);
          if (!latest) {
            throw new Error("答卷已不存在");
          }
          const expectedIds = current.items.map(item => item.questionId).sort();
          const latestIds = latest.items.map(item => item.questionId).sort();
          if (
            expectedIds.length !== latestIds.length ||
            expectedIds.some(
              (questionId, index) => questionId !== latestIds[index]
            )
          ) {
            throw new Error("人工阅卷题目集合已变化");
          }
          const latestReferences = latest.referencesUnlocked
            ? await getManualGradingReferences(latest.sheetId)
            : null;
          workspace.value = latest;
          references.value = latestReferences;
          grades.value = preserved;
          currentQuestionId.value = preservedCursor;
          persistDraft(latest, preserved, preservedCursor);
          message(
            "已同步其他页面的最新修订，当前编辑仍保留；请核对后重新保存",
            {
              type: "warning"
            }
          );
        } catch {
          message(getExamErrorMessage(error), { type: "error" });
        }
        return;
      }
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      saving.value = false;
    }
  }

  function back() {
    const current = workspace.value;
    if (
      route.query.source === "manual-tasks" ||
      current?.viewerIsOwner === false
    ) {
      void router.push({ name: "ExamManualGradingTasks" });
      return;
    }
    void router.push({
      name: "ExamResults",
      query: paperId.value ? { paperId: paperId.value } : undefined
    });
  }

  onMounted(() => {
    void load();
  });

  return {
    sheetId,
    loading,
    saving,
    errorText,
    workspace,
    references,
    referencesByQuestion,
    grades,
    items,
    completedCount,
    unscoredCount,
    isComplete,
    progressPercent,
    scoredQuestionIds,
    subjectiveScore,
    projectedTotal,
    isReviewStage,
    studentLabel,
    currentQuestionId,
    currentIndex,
    currentItem,
    currentGrade,
    currentReference,
    hasPrev,
    hasNext,
    firstUnscoredIndex,
    goTo,
    goPrev,
    goNext,
    goFirstUnscored,
    setScore,
    setComment,
    load,
    submit,
    back
  };
}
