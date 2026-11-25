import { computed, onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import {
  type ExamPaperSummaryDto,
  archiveExamPaper,
  assignExamSheets,
  copyArchivedExamPaper,
  createExamPaper,
  deleteExamPaper,
  getExamErrorMessage,
  getExamPapers,
  publishExamAnswers,
  revertExamPaper
} from "@/api/exam";
import {
  type TeamAccount,
  getCollaborationWorkspace
} from "@/api/collaboration";
import { message } from "@/utils/message";

const PageSize = 20;

/**
 * 试卷管理数据源(owner)。
 * 请求预算:进入页面 1 次列表(frontend.exam.papersPage.enter=1);
 * 指派弹窗打开时 1 次协作账号查询(frontend.exam.assignDialog.open=1);
 * 归档卷复制点击只发 1 次 POST(frontend.exam.archivedCopy.click=1)。
 */
export function useExamPapers() {
  const papers = ref<ExamPaperSummaryDto[]>([]);
  const pageIndex = ref(1);
  const total = ref(0);
  const loading = ref(false);
  const loadError = ref(false);
  /** 行级动作忙碌:paperId → true(防连点)。 */
  const busy = ref<Record<string, boolean>>({});

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(total.value / PageSize))
  );
  const isEmpty = computed(() => !loading.value && papers.value.length === 0);

  // 指派弹窗
  const assignVisible = ref(false);
  const assignPaper = ref<ExamPaperSummaryDto | null>(null);
  const assignSubs = ref<TeamAccount[]>([]);
  const assignSelected = ref<string[]>([]);
  const assignDeadline = ref<string | null>(null);
  const assignLoading = ref(false);
  const assignSubmitting = ref(false);

  async function load(page = pageIndex.value) {
    loading.value = true;
    try {
      const result = await getExamPapers(page, PageSize);
      papers.value = result.items ?? [];
      total.value = result.total ?? 0;
      pageIndex.value = result.pageIndex || page;
      loadError.value = false;
    } catch (error) {
      loadError.value = true;
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      loading.value = false;
    }
  }

  function goToPage(page: number) {
    const target = Math.min(Math.max(1, page), totalPages.value);
    if (target === pageIndex.value || loading.value) return;
    void load(target);
  }

  async function runRowAction(
    paperId: string,
    action: () => Promise<void>,
    successText: string
  ) {
    if (busy.value[paperId]) return;
    busy.value = { ...busy.value, [paperId]: true };
    try {
      await action();
      message(successText, { type: "success" });
      await load();
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      busy.value = { ...busy.value, [paperId]: false };
    }
  }

  async function createPaper() {
    try {
      const { value } = await ElMessageBox.prompt(
        "先起一个卷名；创建后会直接进入「卷面信息」，先设置考试时长与规则。",
        "新建试卷",
        {
          confirmButtonText: "创建并出题",
          cancelButtonText: "取消",
          inputPlaceholder: "例如:第 3 期剪辑基础考核",
          inputValidator: input => (input?.trim() ? true : "试卷标题不能为空")
        }
      );
      const result = await createExamPaper({ title: value.trim() });
      message("试卷已创建", { type: "success" });
      return result.paperId;
    } catch (error) {
      if (error !== "cancel" && error !== "close") {
        message(getExamErrorMessage(error), { type: "error" });
      }
      return null;
    }
  }

  async function copyArchived(paper: ExamPaperSummaryDto) {
    if (busy.value[paper.paperId]) return null;
    busy.value = { ...busy.value, [paper.paperId]: true };
    try {
      const result = await copyArchivedExamPaper(paper.paperId);
      message("已复制为独立草稿,可以继续改题", { type: "success" });
      return result.paperId;
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
      return null;
    } finally {
      busy.value = { ...busy.value, [paper.paperId]: false };
    }
  }

  function revert(paper: ExamPaperSummaryDto) {
    void ElMessageBox.confirm(
      "撤回后回到草稿可继续改题;该卷未开考的指派会一并撤销。",
      `撤回「${paper.title}」?`,
      { confirmButtonText: "撤回", cancelButtonText: "取消", type: "warning" }
    )
      .then(() =>
        runRowAction(
          paper.paperId,
          () => revertExamPaper(paper.paperId),
          "已撤回为草稿"
        )
      )
      .catch(() => undefined);
  }

  function archive(paper: ExamPaperSummaryDto) {
    void ElMessageBox.confirm(
      "归档后不能再指派或开考;正在作答与待判分的答卷会照常走完,成绩保留可查。",
      `归档「${paper.title}」?`,
      { confirmButtonText: "归档", cancelButtonText: "取消", type: "warning" }
    )
      .then(() =>
        runRowAction(
          paper.paperId,
          () => archiveExamPaper(paper.paperId),
          "已归档"
        )
      )
      .catch(() => undefined);
  }

  function removePaper(paper: ExamPaperSummaryDto) {
    void ElMessageBox.confirm(
      "删除后不可恢复(存在答卷记录的试卷不能删除,可改用归档)。",
      `删除「${paper.title}」?`,
      { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" }
    )
      .then(() =>
        runRowAction(
          paper.paperId,
          () => deleteExamPaper(paper.paperId),
          "已删除"
        )
      )
      .catch(() => undefined);
  }

  function publishAnswers(paper: ExamPaperSummaryDto) {
    void ElMessageBox.confirm(
      "公布后所有已交卷的考生都能在复盘里看到答案与解析。",
      `公布「${paper.title}」的答案?`,
      {
        confirmButtonText: "公布答案",
        cancelButtonText: "取消",
        type: "warning"
      }
    )
      .then(() =>
        runRowAction(
          paper.paperId,
          () => publishExamAnswers(paper.paperId),
          "答案已公布"
        )
      )
      .catch(() => undefined);
  }

  async function openAssign(paper: ExamPaperSummaryDto) {
    assignPaper.value = paper;
    assignSelected.value = [];
    assignDeadline.value = null;
    assignVisible.value = true;
    assignLoading.value = true;
    try {
      const workspace = await getCollaborationWorkspace();
      // 候选=启用子账号 + 主账号本人(2026-07-24:主账号也可参与考试,自考走补指派)
      assignSubs.value = (workspace?.accounts ?? []).filter(
        account =>
          account.status === "active" &&
          (account.role === "sub" || account.role === "owner")
      );
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
      assignSubs.value = [];
    } finally {
      assignLoading.value = false;
    }
  }

  async function confirmAssign() {
    const paper = assignPaper.value;
    if (!paper || assignSelected.value.length === 0 || assignSubmitting.value) {
      return;
    }
    assignSubmitting.value = true;
    try {
      const result = await assignExamSheets(
        paper.paperId,
        assignSelected.value,
        assignDeadline.value
      );
      const createdCount = result.created.length;
      const skippedCount = result.skipped.length;
      message(
        skippedCount > 0
          ? `已指派 ${createdCount} 人,${skippedCount} 人此前已指派(保持不变)`
          : `已指派 ${createdCount} 人`,
        { type: "success" }
      );
      assignVisible.value = false;
      await load();
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      assignSubmitting.value = false;
    }
  }

  onMounted(() => {
    void load(1);
  });

  return {
    papers,
    pageIndex,
    total,
    totalPages,
    loading,
    loadError,
    isEmpty,
    busy,
    load,
    goToPage,
    createPaper,
    copyArchived,
    revert,
    archive,
    removePaper,
    publishAnswers,
    // 指派
    assignVisible,
    assignPaper,
    assignSubs,
    assignSelected,
    assignDeadline,
    assignLoading,
    assignSubmitting,
    openAssign,
    confirmAssign
  };
}
