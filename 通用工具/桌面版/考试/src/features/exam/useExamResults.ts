import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  type ExamPaperSummaryDto,
  type ExamPaperResultsDto,
  forceSubmitExamSheet,
  getExamErrorMessage,
  getExamResultPapers,
  getExamResults,
  publishExamAnswers,
  reopenTimedOutExamSheet,
  revokeExamAssignment
} from "@/api/exam";
import { useUserStoreHook } from "@/store/modules/user";
import { message } from "@/utils/message";

/**
 * 成绩总览(团队全员只读；owner/admin 额外拥有管理动作)。
 * 请求预算(frontend.exam.resultsPage.enter=2):首进试卷列表 1 + 选中卷成绩 1;
 * 切卷各 1(frontend.exam.results.switchPaper=1);
 * 「复盘看解析」入口只跳复盘页,本页请求 0(frontend.exam.results.sheetDetail=0)。
 */
export function useExamResults() {
  const route = useRoute();
  const router = useRouter();
  const userStore = useUserStoreHook();
  const canManage = computed(() =>
    (userStore.roles ?? []).some(role => role === "admin" || role === "owner")
  );

  const papers = ref<ExamPaperSummaryDto[]>([]);
  const papersLoading = ref(false);
  const selectedPaperId = ref<string>("");

  const results = ref<ExamPaperResultsDto | null>(null);
  const resultsLoading = ref(false);

  const reopening = ref<Record<string, boolean>>({});
  const revoking = ref<Record<string, boolean>>({});

  const isEmpty = computed(
    () => !resultsLoading.value && (results.value?.sheets.length ?? 0) === 0
  );
  const selectedPaper = computed(() =>
    papers.value.find(paper => paper.paperId === selectedPaperId.value)
  );

  async function loadPapers() {
    papersLoading.value = true;
    try {
      // 只列有指派记录意义的卷(已发布/已归档);上限 50 张,超出用列表页翻页语义即可
      const result = await getExamResultPapers(1, 50);
      papers.value = (result.items ?? []).filter(
        paper => paper.status !== "草稿"
      );
      const fromQuery = String(route.query.paperId ?? "");
      const target =
        papers.value.find(paper => paper.paperId === fromQuery) ??
        papers.value[0];
      if (target) {
        selectedPaperId.value = target.paperId;
        await loadResults(target.paperId);
      }
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      papersLoading.value = false;
    }
  }

  async function loadResults(paperId: string) {
    if (!paperId) return;
    resultsLoading.value = true;
    try {
      results.value = await getExamResults(paperId);
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      resultsLoading.value = false;
    }
  }

  function selectPaper(paperId: string) {
    selectedPaperId.value = paperId;
    void loadResults(paperId);
  }

  /** 查阅答卷:复用考生那张复盘页(source=results 切成主账号视角),与批改流程无关。 */
  function openDetail(sheetId: string) {
    void router.push({
      name: "ExamReview",
      query: {
        sheetId,
        source: "results",
        paperId: selectedPaperId.value
      }
    });
  }

  function openManualGrading(sheetId: string) {
    void router.push({
      name: "ExamManualGrading",
      query: {
        sheetId,
        paperId: selectedPaperId.value
      }
    });
  }

  function openManualGradingAssignments() {
    void router.push({
      name: "ExamManualGradingAssignments",
      query: selectedPaperId.value
        ? { paperId: selectedPaperId.value }
        : undefined
    });
  }

  function forceSubmit(sheetId: string, studentUsername: string) {
    void ElMessageBox.confirm(
      "按考生最后保存的作答立即收卷判分(适合弃考未交的卷)。",
      `强制收卷 ${studentUsername} 的答卷?`,
      {
        confirmButtonText: "强制收卷",
        cancelButtonText: "取消",
        type: "warning"
      }
    )
      .then(async () => {
        try {
          await forceSubmitExamSheet(sheetId);
          message("已强制收卷", { type: "success" });
          await loadResults(selectedPaperId.value);
        } catch (error) {
          message(getExamErrorMessage(error), { type: "error" });
        }
      })
      .catch(() => undefined);
  }

  /**
   * 恢复缺考或超时答卷。请求预算(frontend.exam.results.reopenTimedOut=1):
   * 只发一次 POST，成功后原地更新当前行，不追加成绩 GET。
   */
  async function reopenTimedOut(
    sheetId: string,
    studentUsername: string,
    status = "已交卷",
    deadline: string | null = null
  ) {
    if (reopening.value[sheetId]) return;
    const isAbsent = status === "缺考";
    const futureDeadline =
      deadline && Date.parse(deadline) > Date.now() ? deadline : null;
    try {
      await ElMessageBox.confirm(
        isAbsent
          ? [
              "将缺考状态恢复为待考，考生可以重新点「提笔作答」。",
              futureDeadline
                ? `继续沿用新截止时间：${futureDeadline.replace("T", " ")}。`
                : "旧截止时间已经失效，恢复后将解除旧截止时间。"
            ].join("\n")
          : [
              "保留已保存的答案，清除这次超时产生的分数与判分，重新给予整卷配置的完整限时。",
              "旧截止时间会解除；考生需主动点「继续答题」后才开始计时。",
              "若本卷设置为「交卷即看答案」，考生可能已经看过答案。"
            ].join("\n"),
        `允许 ${studentUsername} 继续答题？`,
        {
          confirmButtonText: "允许继续",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }

    reopening.value = { ...reopening.value, [sheetId]: true };
    try {
      await reopenTimedOutExamSheet(sheetId);
      const sheet = results.value?.sheets.find(
        item => item.sheetId === sheetId
      );
      if (sheet) {
        Object.assign(
          sheet,
          isAbsent
            ? {
                status: "待考",
                startedAt: null,
                submittedAt: null,
                deadline: futureDeadline,
                paused: false,
                objectiveScore: null,
                totalScore: null,
                manualTotalScore: null,
                manualGradingStatus: "pending",
                manualGradedAt: null,
                manualRevision: 0,
                submitKind: null
              }
            : {
                status: "答题中",
                submittedAt: null,
                deadline: null,
                paused: true,
                objectiveScore: null,
                totalScore: null,
                manualTotalScore: null,
                manualGradingStatus: "pending",
                manualGradedAt: null,
                manualRevision: 0,
                submitKind: null
              }
        );
      }
      message(
        isAbsent
          ? "缺考已恢复为待考，考生现在可以提笔作答"
          : "已允许继续；考生主动恢复后重新开始计时",
        { type: "success" }
      );
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      reopening.value = { ...reopening.value, [sheetId]: false };
    }
  }

  /**
   * 撤回单份指派。请求预算(frontend.exam.results.revokeAssignment=1):
   * 只发 1 次 DELETE，成功后本地移除该行，不追加成绩 GET。
   */
  async function revoke(
    sheetId: string,
    studentUsername: string,
    status: string
  ) {
    if (revoking.value[sheetId]) return;
    const isTaking = status === "答题中";
    try {
      await ElMessageBox.confirm(
        isTaking
          ? "考生正在答题。撤回后会立即失去继续作答资格；已保存内容仅作为软删除记录保留，成绩总览不再显示。"
          : "撤回后该考生的「待考」记录会从成绩总览移除。",
        `撤回对 ${studentUsername} 的考试指派?`,
        {
          confirmButtonText: "确认撤回",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }

    revoking.value = { ...revoking.value, [sheetId]: true };
    try {
      await revokeExamAssignment(sheetId);
      if (results.value) {
        results.value.sheets = results.value.sheets.filter(
          item => item.sheetId !== sheetId
        );
      }
      message("已撤回指派", { type: "success" });
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      revoking.value = { ...revoking.value, [sheetId]: false };
    }
  }

  function publishAnswersForSelected() {
    const paper = selectedPaper.value;
    if (!paper) return;
    void ElMessageBox.confirm(
      "公布后所有已交卷的考生都能在复盘里看到答案与解析。",
      `公布「${paper.title}」的答案?`,
      {
        confirmButtonText: "公布答案",
        cancelButtonText: "取消",
        type: "warning"
      }
    )
      .then(async () => {
        try {
          await publishExamAnswers(paper.paperId);
          message("答案已公布", { type: "success" });
          await loadPapers();
        } catch (error) {
          message(getExamErrorMessage(error), { type: "error" });
        }
      })
      .catch(() => undefined);
  }

  onMounted(() => {
    void loadPapers();
  });

  return {
    papers,
    canManage,
    papersLoading,
    selectedPaperId,
    selectedPaper,
    results,
    resultsLoading,
    isEmpty,
    reopening,
    revoking,
    selectPaper,
    loadResults,
    openDetail,
    openManualGrading,
    openManualGradingAssignments,
    forceSubmit,
    reopenTimedOut,
    revoke,
    publishAnswersForSelected
  };
}
