import { computed, ref } from "vue";
import {
  type TeamAccount,
  getCollaborationWorkspace
} from "@/api/collaboration";
import {
  type PublishPaperResult,
  getExamErrorMessage,
  publishExamPaper
} from "@/api/exam";
import { message } from "@/utils/message";

/** 发布弹窗需要知道的卷面摘要(试卷管理行 / 出题工作台都能拼出来)。 */
export interface PublishablePaper {
  paperId: string;
  title: string;
  questionCount: number;
  totalScore: number;
}

/**
 * 发布弹窗数据源【计时 v2:发布时指定考试截止时间与考生】。
 * 请求预算:弹窗打开 1 次协作账号查询(frontend.exam.publishDialog.open=1);
 * 确认 = 1 次发布 POST。试卷管理页与出题工作台共用(单源,不各抄一份)。
 */
export function useExamPublishDialog(
  onPublished?: (result: PublishPaperResult) => void | Promise<void>
) {
  const visible = ref(false);
  const paper = ref<PublishablePaper | null>(null);
  const candidates = ref<TeamAccount[]>([]);
  const selected = ref<string[]>([]);
  /** 考试截止时间(必填;墙钟硬止点,到点未交按已存作答强制收卷)。 */
  const deadline = ref<string | null>(null);
  const loading = ref(false);
  const submitting = ref(false);

  const canConfirm = computed(
    () =>
      Boolean(deadline.value) && selected.value.length > 0 && !submitting.value
  );

  async function open(target: PublishablePaper) {
    paper.value = target;
    deadline.value = null;
    visible.value = true;
    loading.value = true;
    try {
      const workspace = await getCollaborationWorkspace();
      // 候选=启用子账号 + 主账号本人(2026-07-24:主账号也可参与考试)
      candidates.value = (workspace?.accounts ?? []).filter(
        account =>
          account.status === "active" &&
          (account.role === "sub" || account.role === "owner")
      );
      // 默认全选启用子账号(「发布即全员参考」的延续);主账号本人自行勾选
      selected.value = candidates.value
        .filter(account => account.role === "sub")
        .map(account => account.username);
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
      candidates.value = [];
      selected.value = [];
    } finally {
      loading.value = false;
    }
  }

  /** 人多时快速圈定:全选子账号 / 清空【sol 应改#3】。 */
  function selectAllSubs() {
    selected.value = candidates.value
      .filter(account => account.role === "sub")
      .map(account => account.username);
  }

  function clearSelected() {
    selected.value = [];
  }

  async function confirm() {
    const target = paper.value;
    if (!target || submitting.value) return;
    if (!deadline.value) {
      message("请先指定考试截止时间——到点未交卷会按已保存作答强制收卷。", {
        type: "warning"
      });
      return;
    }
    if (new Date(deadline.value).getTime() <= Date.now()) {
      message("截止时间必须晚于当前时间。", { type: "warning" });
      return;
    }
    if (selected.value.length === 0) {
      message("请至少选择一位考生。", { type: "warning" });
      return;
    }
    submitting.value = true;
    try {
      const payload = {
        deadline: deadline.value,
        usernames: [...selected.value]
      };
      const result = await publishExamPaper(target.paperId, payload);
      message(`已发布,并指派给 ${result.autoAssigned.length} 位考生`, {
        type: "success"
      });
      visible.value = false;
      await onPublished?.(result);
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      submitting.value = false;
    }
  }

  return {
    visible,
    paper,
    candidates,
    selected,
    deadline,
    loading,
    submitting,
    canConfirm,
    open,
    confirm,
    selectAllSubs,
    clearSelected
  };
}
