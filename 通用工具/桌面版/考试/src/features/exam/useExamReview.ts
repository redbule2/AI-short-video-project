import {
  computed,
  getCurrentInstance,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch
} from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  type ExamReviewDto,
  type ExamSheetDetailDto,
  ExamErrorKinds,
  getExamErrorKind,
  getExamErrorMessage,
  getExamReview,
  getExamSheetDetail,
  parseReviewWaitingScore,
  type ReviewItemDto,
  type ReviewWaitingScoreDto
} from "@/api/exam";
import { message } from "@/utils/message";

/** 逐题判定(单源:题卡着色/答题卡导航/统计口径共用)。 */
export type ReviewVerdict = "right" | "wrong" | "partial" | "pending";

export function classifyReviewItem(item: ReviewItemDto): ReviewVerdict {
  if (item.isCorrect === true) return "right";
  if (item.isCorrect === false) return "wrong";
  if (item.earnedScore === null) return "pending";
  if (item.earnedScore >= item.score) return "right";
  if (item.earnedScore === 0) return "wrong";
  return "partial";
}

/**
 * 考试复盘(本人/团队共享/主账号管理视角共用)。
 * 考生进入 1 次(frontend.exam.review.enter=1);
 * 从成绩总览进入 1 次(frontend.exam.review.ownerEnter=1，预算键沿用旧名)。
 * answers-not-published 不是错误:渲染「待老师公布」等待态(规范 §4.4 错误=行动建议);
 * 等待态经 error.detail 携带聚合得分(与 /my 同披露级别),交卷后分数即刻可见。
 * 双模式(与答题页同款体感):overview=全卷清单;focus=逐题阅读(← → 切题,Esc 回全卷)。
 */
export function useExamReview() {
  const route = useRoute();
  const router = useRouter();
  const sheetId = computed(() => String(route.query.sheetId ?? ""));
  const isResultsReview = computed(() => route.query.source === "results");
  /** 从「培训」排名表点进来的：看完回那一期培训(2026-11-27 加的) */
  const isFromTraining = computed(() => route.query.from === "training");
  const sourcePaperId = computed(() => String(route.query.paperId ?? ""));
  const requestKey = computed(
    () => `${isResultsReview.value ? "owner" : "student"}:${sheetId.value}`
  );

  const loading = ref(true);
  const loadedRequestKey = ref("");
  const review = ref<ExamReviewDto | null>(null);
  const reviewStudentLabel = ref("");
  /** 成绩总览视角下的所属试卷;深链缺 paperId 时用于返回原卷。 */
  const loadedPaperId = ref("");
  /** waiting=答案未公布;notReady=还没交卷/缺考;error=其他失败。 */
  const blocked = ref<"" | "waiting" | "notReady" | "error">("");
  const blockedText = ref("");
  /** 等待态下的聚合得分(旧后端无 detail 时为 null,退回纯文案)。 */
  const waitingScore = ref<ReviewWaitingScoreDto | null>(null);
  const wrongOnly = ref(false);

  /** overview=全卷清单;focus=逐题阅读。 */
  const mode = ref<"overview" | "focus">("overview");
  const currentQuestionId = ref<string | null>(null);
  /** 悬浮答题卡开合(在 composable 里,Esc 才能按「先关浮层再退模式」的优先级处理)。 */
  const navOpen = ref(false);

  const allItems = computed(() => review.value?.items ?? []);

  const items = computed(() => {
    if (!wrongOnly.value) return allItems.value;
    return allItems.value.filter(item => {
      const verdict = classifyReviewItem(item);
      return verdict === "wrong" || verdict === "partial";
    });
  });

  /** 判词统计(答题卡/工具条共用):right=拿满 wrong=未得分 partial=部分 pending=待判。 */
  const stats = computed(() => {
    const counts = { right: 0, wrong: 0, partial: 0, pending: 0 };
    for (const item of allItems.value) {
      counts[classifyReviewItem(item)] += 1;
    }
    return { ...counts, lost: counts.wrong + counts.partial };
  });

  /**
   * 未交卷:主账号可以查阅「答题中」答卷的作答快照(考生自己进复盘页时必然已交卷)。
   * 这类答卷没有成绩也没有判词,页面据此收起分数/判词/AI 交接,只留题面与作答。
   */
  const notSubmitted = computed(
    () => Boolean(review.value) && !review.value?.submittedAt
  );

  const passed = computed(() => {
    const data = review.value;
    if (!data || data.myTotalScore === null || data.passScore === null) {
      return null;
    }
    return data.myTotalScore >= data.passScore;
  });

  /** 该卷客观题总分值(0=整卷无客观题;成绩头「客观 0 分」歧义就是这么来的)。 */
  const objectiveFullScore = computed(() =>
    allItems.value.reduce(
      (sum, item) =>
        item.type === "single" ||
        item.type === "multiple" ||
        item.type === "judge"
          ? sum + item.score
          : sum,
      0
    )
  );

  const durationText = computed(() => {
    const seconds = review.value?.durationSeconds;
    if (seconds === null || seconds === undefined) return "";
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return minutes > 0 ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
  });
  const backLabel = computed(() =>
    isFromTraining.value
      ? "培训"
      : isResultsReview.value
        ? "成绩总览"
        : "我的考试"
  );

  /**
   * 成绩总览答卷详情 → 考生复盘同一份视图模型。
   * passScore/durationSeconds 由后端同源下发(不再置 null),及格印章与用时两块在主账号视角一并点亮。
   */
  function mapOwnerSheet(detail: ExamSheetDetailDto): ExamReviewDto {
    return {
      sheetId: detail.sheetId,
      paperTitle: detail.paperTitle,
      status: detail.status,
      paperTotalScore: detail.paperTotalScore,
      passScore: detail.passScore,
      myObjectiveScore: detail.objectiveScore,
      myTotalScore: detail.totalScore,
      myManualTotalScore: detail.manualTotalScore,
      manualGradedAt: detail.manualGradedAt,
      startedAt: detail.startedAt,
      submittedAt: detail.submittedAt,
      gradedAt: detail.gradedAt,
      durationSeconds: detail.durationSeconds,
      submitKind: detail.submitKind,
      items: detail.items.map(({ studentAnswer, ...item }) => ({
        ...item,
        myAnswer: studentAnswer
      }))
    };
  }

  // ---------- 逐题阅读 ----------

  const currentIndex = computed(() =>
    items.value.findIndex(item => item.questionId === currentQuestionId.value)
  );
  const currentItem = computed(() =>
    currentIndex.value >= 0 ? items.value[currentIndex.value] : null
  );
  const hasPrev = computed(() => currentIndex.value > 0);
  const hasNext = computed(
    () => currentIndex.value >= 0 && currentIndex.value < items.value.length - 1
  );

  function scrollFocusTop() {
    document
      .getElementById("review-focus-sheet")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /** 进入逐题阅读;不带参数从当前筛选集的第一题开始。 */
  function enterFocus(questionId?: string) {
    const list = items.value;
    if (list.length === 0) return;
    currentQuestionId.value =
      questionId && list.some(item => item.questionId === questionId)
        ? questionId
        : list[0].questionId;
    mode.value = "focus";
    void nextTick().then(scrollFocusTop);
  }

  /** 回全卷清单,并把视口带回刚才读到的那道题(阅读连续性)。 */
  function exitFocus() {
    const backTo = currentQuestionId.value;
    mode.value = "overview";
    void nextTick().then(() => {
      if (backTo) {
        document
          .getElementById(`review-q-${backTo}`)
          ?.scrollIntoView({ block: "center" });
      }
    });
  }

  function goPrev() {
    if (!hasPrev.value) return;
    currentQuestionId.value = items.value[currentIndex.value - 1].questionId;
    scrollFocusTop();
  }

  function goNext() {
    if (!hasNext.value) return;
    currentQuestionId.value = items.value[currentIndex.value + 1].questionId;
    scrollFocusTop();
  }

  /** 筛选集变化(如切「只看丢分题」)后当前题被滤掉:落到新集合第一题;集合为空则回全卷。 */
  watch(items, list => {
    if (mode.value !== "focus") return;
    if (list.some(item => item.questionId === currentQuestionId.value)) return;
    if (list.length > 0) {
      currentQuestionId.value = list[0].questionId;
    } else {
      mode.value = "overview";
    }
  });

  /**
   * 键盘:Esc 先关悬浮答题卡、再退逐题模式(与答题页 Esc 先关答题卡抽屉同序);
   * ← → 仅逐题模式切题。修饰键组合(Alt+←=浏览器后退等)与已处理事件一律放行
   * 【对抗审查采纳,同 useExamTaking 守卫】;不劫持输入框。
   */
  function handleKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.isComposing
    ) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.key === "Escape") {
      if (navOpen.value) {
        navOpen.value = false;
        return;
      }
      if (mode.value === "focus") {
        exitFocus();
      }
      return;
    }
    if (mode.value !== "focus") return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goPrev();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goNext();
    }
  }

  async function load() {
    loadedRequestKey.value = requestKey.value;
    if (!sheetId.value) {
      blocked.value = "error";
      blockedText.value = `缺少答卷参数,请从「${backLabel.value}」进入。`;
      loading.value = false;
      return;
    }
    loading.value = true;
    review.value = null;
    waitingScore.value = null;
    reviewStudentLabel.value = "";
    loadedPaperId.value = "";
    // 主账号会连着查阅同一张卷的多份答卷:阅读态必须跟着答卷重置,
    // 否则上一份的「只看丢分题」「逐题阅读到第几题」会串到下一份(keepAlive 页不会自动清)。
    wrongOnly.value = false;
    mode.value = "overview";
    currentQuestionId.value = null;
    navOpen.value = false;
    try {
      if (isResultsReview.value) {
        const detail = await getExamSheetDetail(sheetId.value);
        if (!detail) {
          blocked.value = "notReady";
          blockedText.value = `答卷不存在或已被撤销,请回${isFromTraining.value ? "培训" : "成绩总览"}重新进入。`;
          return;
        }
        reviewStudentLabel.value =
          detail.studentDisplayName || detail.studentUsername;
        loadedPaperId.value = detail.paperId;
        review.value = mapOwnerSheet(detail);
      } else {
        review.value = await getExamReview(sheetId.value);
      }
      blocked.value = "";
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (kind === ExamErrorKinds.AnswersNotPublished) {
        blocked.value = "waiting";
        waitingScore.value = parseReviewWaitingScore(error);
        blockedText.value = "老师还没公布答案与解析,公布后就能在这里逐题复盘。";
      } else if (kind === ExamErrorKinds.SheetNotActive) {
        blocked.value = "notReady";
        blockedText.value = getExamErrorMessage(error);
      } else {
        blocked.value = "error";
        blockedText.value = getExamErrorMessage(error);
        message(blockedText.value, { type: "error" });
      }
    } finally {
      loading.value = false;
    }
  }

  /** 答题卡跳题:全卷模式滚动定位;逐题模式直接切到该题。被筛掉的题先解除筛选。 */
  async function jumpTo(item: ReviewItemDto) {
    if (wrongOnly.value) {
      const verdict = classifyReviewItem(item);
      if (verdict !== "wrong" && verdict !== "partial") {
        wrongOnly.value = false;
        await nextTick();
      }
    }
    if (mode.value === "focus") {
      currentQuestionId.value = item.questionId;
      scrollFocusTop();
      return;
    }
    document
      .getElementById(`review-q-${item.questionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function backToSource() {
    if (isFromTraining.value) {
      const trainingId = String(route.query.trainingId ?? "");
      void router.push({
        name: "ExamTrainings",
        query: trainingId ? { trainingId } : {}
      });
      return;
    }
    if (isResultsReview.value) {
      // 深链/收藏进来可能没带 paperId,退回答卷自身所属卷,别把主账号丢回默认第一张卷
      const paperId = sourcePaperId.value || loadedPaperId.value;
      void router.push({
        name: "ExamResults",
        query: paperId ? { paperId } : {}
      });
      return;
    }
    void router.push({ name: "ExamMy" });
  }

  // keepAlive:true——切走页面时必须摘掉全局键盘监听(同名回调重复 add 会被 DOM 去重)。
  // 守卫两层:node 测试环境无 window(与 useExamTaking 同法);
  // keep-alive 钩子只能在组件实例内注册(裸调用如单测环境会因无实例而崩)。
  function attachKeyboard() {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", handleKeydown);
    }
  }

  function detachKeyboard() {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handleKeydown);
    }
  }

  onMounted(() => {
    attachKeyboard();
    void load();
  });
  onBeforeUnmount(detachKeyboard);
  if (getCurrentInstance()) {
    onActivated(() => {
      attachKeyboard();
      // 换了答卷要重取;同一份「未交卷」答卷再次进入也要重取——
      // 考生还在答,缓存下来的快照会越看越旧(仍是每次进入 1 次 GET,不加预算)。
      if (
        loadedRequestKey.value !== requestKey.value ||
        (isResultsReview.value && notSubmitted.value)
      ) {
        void load();
      }
    });
    onDeactivated(detachKeyboard);
  }

  return {
    sheetId,
    isResultsReview,
    loading,
    review,
    reviewStudentLabel,
    blocked,
    blockedText,
    waitingScore,
    wrongOnly,
    allItems,
    items,
    stats,
    notSubmitted,
    passed,
    objectiveFullScore,
    durationText,
    backLabel,
    mode,
    navOpen,
    currentQuestionId,
    currentIndex,
    currentItem,
    hasPrev,
    hasNext,
    enterFocus,
    exitFocus,
    goPrev,
    goNext,
    load,
    jumpTo,
    backToSource
  };
}
