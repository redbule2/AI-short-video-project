import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  type MyExamItemDto,
  getExamErrorKind,
  getExamErrorMessage,
  getMyExams,
  startExam,
  ExamErrorKinds
} from "@/api/exam";
import { message } from "@/utils/message";

/**
 * 我的考试(sub 主入口)。请求预算:进入 1 次列表(frontend.exam.myPage.enter=1)。
 * 开考是不可逆动作 → 必须经「考前确认」显式点「提笔作答」
 * (对抗审查采纳:防误触烧掉唯一机会)。
 */
export function useMyExams() {
  const router = useRouter();
  const items = ref<MyExamItemDto[]>([]);
  const loading = ref(false);
  const loadError = ref(false);
  const starting = ref<Record<string, boolean>>({});

  const isEmpty = computed(() => !loading.value && items.value.length === 0);
  /** 待考/进行中排前,已完成的按交卷时间倒序垫后。 */
  const sorted = computed(() => {
    const weight = (status: string) =>
      status === "答题中"
        ? 0
        : status === "待考"
          ? 1
          : status === "已交卷"
            ? 2
            : 3;
    return [...items.value].sort((a, b) => weight(a.status) - weight(b.status));
  });

  async function load() {
    loading.value = true;
    try {
      const result = await getMyExams();
      items.value = result.items ?? [];
      loadError.value = false;
    } catch (error) {
      loadError.value = true;
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      loading.value = false;
    }
  }

  function describeDuration(item: MyExamItemDto) {
    return item.durationMinutes ? `${item.durationMinutes} 分钟` : "不限时";
  }

  /** 考前确认(拆封仪式):展示规则,显式点「提笔作答」后才 start。 */
  function confirmStart(item: MyExamItemDto) {
    if (starting.value[item.sheetId]) return;
    const deadlineText = item.deadline
      ? `;截止 ${new Date(item.deadline).toLocaleString("zh-CN")}`
      : "";
    void ElMessageBox.confirm(
      `共 ${item.questionCount} 题、总分 ${item.totalScore} 分,答题时长 ${describeDuration(item)}${deadlineText}。本场考试只有一次机会;答题页可「暂停」冻结计时(截止时间到仍会强制收卷),中途关页面可回来继续。`,
      `开始「${item.paperTitle}」?`,
      {
        confirmButtonText: "提笔作答",
        cancelButtonText: "再准备下",
        type: "warning"
      }
    )
      .then(() => start(item))
      .catch(() => undefined);
  }

  async function start(item: MyExamItemDto) {
    starting.value = { ...starting.value, [item.sheetId]: true };
    try {
      await startExam(item.sheetId);
      await router.push({ name: "ExamTake", query: { sheetId: item.sheetId } });
    } catch (error) {
      const kind = getExamErrorKind(error);
      if (kind === ExamErrorKinds.ExamDeadlinePassed) {
        message("该考试已过截止时间,记为缺考。", { type: "warning" });
        await load();
      } else {
        message(getExamErrorMessage(error), { type: "error" });
      }
    } finally {
      starting.value = { ...starting.value, [item.sheetId]: false };
    }
  }

  function continueTaking(item: MyExamItemDto) {
    void router.push({ name: "ExamTake", query: { sheetId: item.sheetId } });
  }

  function goReview(item: MyExamItemDto) {
    void router.push({ name: "ExamReview", query: { sheetId: item.sheetId } });
  }

  onMounted(() => {
    void load();
  });

  return {
    items,
    sorted,
    loading,
    loadError,
    isEmpty,
    starting,
    load,
    describeDuration,
    confirmStart,
    continueTaking,
    goReview
  };
}
