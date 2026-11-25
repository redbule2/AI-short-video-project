import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  getExamErrorMessage,
  getMyManualGradingTasks,
  type ManualGradingTaskDto
} from "@/api/exam";

/** 我的阅卷任务箱：进入或显式刷新各 1 个聚合 GET；打开任务只跳路由。 */
export function useExamManualGradingTasks() {
  const router = useRouter();
  const loading = ref(true);
  const errorText = ref("");
  const items = ref<ManualGradingTaskDto[]>([]);
  const hasMore = ref(false);
  const statusFilter = ref<"pending" | "completed">("pending");

  const pendingCount = computed(
    () =>
      items.value.filter(item => item.manualGradingStatus === "pending").length
  );
  const completedCount = computed(() => items.value.length - pendingCount.value);
  const visibleItems = computed(() =>
    items.value.filter(
      item => item.manualGradingStatus === statusFilter.value
    )
  );

  async function load() {
    loading.value = true;
    errorText.value = "";
    try {
      const result = await getMyManualGradingTasks();
      items.value = result.items;
      hasMore.value = result.hasMore;
      if (pendingCount.value === 0 && completedCount.value > 0) {
        statusFilter.value = "completed";
      }
    } catch (error) {
      errorText.value = getExamErrorMessage(error);
    } finally {
      loading.value = false;
    }
  }

  function openTask(task: ManualGradingTaskDto) {
    void router.push({
      name: "ExamManualGrading",
      query: {
        sheetId: task.sheetId,
        paperId: task.paperId,
        source: "manual-tasks"
      }
    });
  }

  onMounted(() => {
    void load();
  });

  return {
    loading,
    errorText,
    items,
    hasMore,
    statusFilter,
    pendingCount,
    completedCount,
    visibleItems,
    load,
    openTask
  };
}
