import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  getExamErrorMessage,
  getExamPapers,
  getManualGradingAssignments,
  saveManualGradingAssignments,
  type ExamPaperSummaryDto,
  type ManualGradingAssignmentWorkspaceDto
} from "@/api/exam";
import { message } from "@/utils/message";

const OwnerDirectValue = "__owner_direct__";

type ScopeFilter = "all" | "unassigned" | "pending" | "completed";

/**
 * 阅卷安排请求预算：
 * - 首次进入=试卷列表 1 GET + 当前卷安排 1 GET；
 * - 切卷=安排 1 GET；
 * - 保存=全部脏行合并为 1 PUT，成功后本地收敛，不追加 GET。
 */
export function useExamManualGradingAssignments() {
  const route = useRoute();
  const router = useRouter();

  const papers = ref<ExamPaperSummaryDto[]>([]);
  const selectedPaperId = ref("");
  const workspace = ref<ManualGradingAssignmentWorkspaceDto | null>(null);
  const loading = ref(true);
  const saving = ref(false);
  const errorText = ref("");
  const searchText = ref("");
  /** 卷堆 = 统计与筛选合一：数字本身就是入口，少两个下拉框。 */
  const scopeFilter = ref<ScopeFilter>("all");
  const selectedSheetIds = ref<string[]>([]);
  const batchGrader = ref<string | null>(null);
  const assignments = ref<Record<string, string>>({});
  const baseline = ref<Record<string, string>>({});

  const dirtyItems = computed(() =>
    Object.entries(assignments.value)
      .filter(([sheetId, grader]) => baseline.value[sheetId] !== grader)
      .map(([sheetId, grader]) => ({
        sheetId,
        graderUsername: grader === OwnerDirectValue ? null : grader
      }))
  );
  const dirtyCount = computed(() => dirtyItems.value.length);
  const pendingCount = computed(
    () =>
      workspace.value?.sheets.filter(
        sheet => sheet.manualGradingStatus === "pending"
      ).length ?? 0
  );
  const completedCount = computed(
    () => (workspace.value?.sheets.length ?? 0) - pendingCount.value
  );
  const unassignedCount = computed(
    () =>
      workspace.value?.sheets.filter(
        sheet =>
          sheet.manualGradingStatus === "pending" &&
          assignments.value[sheet.sheetId] === OwnerDirectValue
      ).length ?? 0
  );
  const totalCount = computed(() => workspace.value?.sheets.length ?? 0);
  const piles = computed(() => [
    { key: "all" as const, label: "全部", count: totalCount.value },
    {
      key: "unassigned" as const,
      label: "待安排",
      count: unassignedCount.value
    },
    { key: "pending" as const, label: "待批改", count: pendingCount.value },
    { key: "completed" as const, label: "已完成", count: completedCount.value }
  ]);

  /**
   * 卷堆归属看 baseline（已保存态），计数看 assignments（编辑态）：
   * 在“待安排”里指派一个人时，数字立刻减一（进度看得见），
   * 但这一行不会当场消失——它留在原位、带朱批边等保存，保存后才离堆。
   * 若归属也跟编辑态，用户刚点完人行就蒸发，等同于“我的操作把数据弄没了”。
   */
  function inScope(sheetId: string, status: string) {
    switch (scopeFilter.value) {
      case "unassigned":
        return (
          status === "pending" && baseline.value[sheetId] === OwnerDirectValue
        );
      case "pending":
        return status === "pending";
      case "completed":
        return status === "completed";
      default:
        return true;
    }
  }

  const filteredSheets = computed(() => {
    const keyword = searchText.value.trim().toLowerCase();
    return (workspace.value?.sheets ?? []).filter(sheet => {
      if (!inScope(sheet.sheetId, sheet.manualGradingStatus)) return false;
      if (!keyword) return true;
      return [sheet.studentDisplayName, sheet.studentUsername]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(keyword));
    });
  });
  const selectableSheetIds = computed(() =>
    filteredSheets.value
      .filter(sheet => !sheet.assignmentLocked)
      .map(sheet => sheet.sheetId)
  );
  const allVisibleSelected = computed(
    () =>
      selectableSheetIds.value.length > 0 &&
      selectableSheetIds.value.every(sheetId =>
        selectedSheetIds.value.includes(sheetId)
      )
  );

  function isDirty(sheetId: string) {
    return assignments.value[sheetId] !== baseline.value[sheetId];
  }

  function hydrate(current: ManualGradingAssignmentWorkspaceDto) {
    const next = Object.fromEntries(
      current.sheets.map(sheet => [
        sheet.sheetId,
        sheet.assignedGraderUsername ?? OwnerDirectValue
      ])
    );
    assignments.value = { ...next };
    baseline.value = { ...next };
    selectedSheetIds.value = [];
  }

  async function loadWorkspace(paperId: string) {
    if (!paperId) return;
    loading.value = true;
    errorText.value = "";
    try {
      const current = await getManualGradingAssignments(paperId);
      if (!current) {
        workspace.value = null;
        errorText.value = "试卷不存在或已被删除。";
        return;
      }
      workspace.value = current;
      hydrate(current);
    } catch (error) {
      workspace.value = null;
      errorText.value = getExamErrorMessage(error);
    } finally {
      loading.value = false;
    }
  }

  async function load() {
    loading.value = true;
    errorText.value = "";
    try {
      const result = await getExamPapers(1, 50);
      papers.value = (result.items ?? []).filter(
        paper => paper.status !== "草稿"
      );
      const queryPaperId = String(route.query.paperId ?? "");
      const target =
        papers.value.find(paper => paper.paperId === queryPaperId) ??
        papers.value[0];
      if (!target) {
        workspace.value = null;
        loading.value = false;
        return;
      }
      selectedPaperId.value = target.paperId;
      await loadWorkspace(target.paperId);
    } catch (error) {
      errorText.value = getExamErrorMessage(error);
      loading.value = false;
    }
  }

  async function selectPaper(paperId: string) {
    if (!paperId || saving.value) return;
    const previousPaperId = workspace.value?.paperId ?? "";
    if (
      dirtyCount.value > 0 &&
      previousPaperId &&
      paperId !== previousPaperId
    ) {
      try {
        await ElMessageBox.confirm(
          `当前有 ${dirtyCount.value} 份安排尚未保存，切换试卷会放弃这些修改。`,
          "放弃未保存的阅卷安排？",
          {
            confirmButtonText: "放弃并切换",
            cancelButtonText: "留在当前试卷",
            type: "warning"
          }
        );
      } catch {
        selectedPaperId.value = previousPaperId;
        return;
      }
    }
    selectedPaperId.value = paperId;
    await router.replace({ query: { ...route.query, paperId } });
    await loadWorkspace(paperId);
  }

  function toggleVisibleSelection(checked: boolean) {
    const visible = new Set(selectableSheetIds.value);
    selectedSheetIds.value = checked
      ? [...new Set([...selectedSheetIds.value, ...visible])]
      : selectedSheetIds.value.filter(sheetId => !visible.has(sheetId));
  }

  function clearSelection() {
    selectedSheetIds.value = [];
  }

  function applyBatch() {
    if (selectedSheetIds.value.length === 0) {
      message("请先勾选要安排的答卷", { type: "warning" });
      return;
    }
    if (batchGrader.value === null) {
      message("请选择阅卷人，或明确选择“主账号直批”", {
        type: "warning"
      });
      return;
    }
    const rows = new Map(
      (workspace.value?.sheets ?? []).map(sheet => [sheet.sheetId, sheet])
    );
    let skipped = 0;
    const next = { ...assignments.value };
    for (const sheetId of selectedSheetIds.value) {
      const sheet = rows.get(sheetId);
      if (!sheet || sheet.assignmentLocked) continue;
      if (
        batchGrader.value !== OwnerDirectValue &&
        batchGrader.value.toLowerCase() === sheet.studentUsername.toLowerCase()
      ) {
        skipped += 1;
        continue;
      }
      next[sheetId] = batchGrader.value;
    }
    assignments.value = next;
    if (skipped > 0) {
      message(`已跳过 ${skipped} 份“阅卷人与考生相同”的答卷`, {
        type: "warning"
      });
    }
  }

  async function save() {
    if (!selectedPaperId.value || dirtyCount.value === 0 || saving.value) {
      return;
    }
    saving.value = true;
    try {
      const result = await saveManualGradingAssignments(
        selectedPaperId.value,
        dirtyItems.value
      );
      baseline.value = { ...assignments.value };
      const assignees = new Map(
        (workspace.value?.assignees ?? []).map(item => [item.username, item])
      );
      for (const sheet of workspace.value?.sheets ?? []) {
        const username =
          assignments.value[sheet.sheetId] === OwnerDirectValue
            ? null
            : assignments.value[sheet.sheetId];
        const assignee = username ? assignees.get(username) : undefined;
        sheet.assignedGraderUsername = username;
        sheet.assignedGraderDisplayName =
          assignee?.displayName ?? username ?? null;
        sheet.assignedGraderDisabled = assignee?.status === "disabled";
      }
      selectedSheetIds.value = [];
      message(
        result.changedCount > 0
          ? `已保存 ${result.changedCount} 份阅卷安排`
          : "阅卷安排没有变化",
        { type: "success" }
      );
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      saving.value = false;
    }
  }

  function openManualGrading(sheetId: string) {
    void router.push({
      name: "ExamManualGrading",
      query: {
        sheetId,
        paperId: selectedPaperId.value,
        source: "assignments"
      }
    });
  }

  async function back() {
    if (dirtyCount.value > 0) {
      try {
        await ElMessageBox.confirm(
          `还有 ${dirtyCount.value} 份阅卷安排未保存。`,
          "离开阅卷安排？",
          {
            confirmButtonText: "放弃并返回",
            cancelButtonText: "继续安排",
            type: "warning"
          }
        );
      } catch {
        return;
      }
    }
    void router.push({
      name: "ExamResults",
      query: selectedPaperId.value
        ? { paperId: selectedPaperId.value }
        : undefined
    });
  }

  onMounted(() => {
    void load();
  });

  return {
    papers,
    selectedPaperId,
    workspace,
    loading,
    saving,
    errorText,
    searchText,
    scopeFilter,
    piles,
    selectedSheetIds,
    batchGrader,
    ownerDirectValue: OwnerDirectValue,
    assignments,
    dirtyCount,
    pendingCount,
    completedCount,
    unassignedCount,
    totalCount,
    filteredSheets,
    allVisibleSelected,
    isDirty,
    load,
    loadWorkspace,
    selectPaper,
    toggleVisibleSelection,
    clearSelection,
    applyBatch,
    save,
    openManualGrading,
    back
  };
}
