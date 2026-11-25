<script setup lang="ts">
import {
  type PublishablePaper,
  useExamPublishDialog
} from "../useExamPublishDialog";

/**
 * 发布弹窗【计时 v2】:发布时必须指定考试截止时间,并点选参考的人。
 * 单源两用:试卷管理行内「发布」与出题工作台桌沿「发布」。
 * 用法:ref 拿到实例后调 open({paperId,title,questionCount,totalScore})。
 */
defineOptions({ name: "ExamPublishDialog" });

const emit = defineEmits<{ published: [] }>();

const dialog = useExamPublishDialog(() => {
  emit("published");
});

defineExpose({
  open: (paper: PublishablePaper) => dialog.open(paper)
});
</script>

<template>
  <el-dialog
    v-model="dialog.visible.value"
    class="exam-assign-dialog"
    :title="
      dialog.paper.value ? `发布「${dialog.paper.value.title}」` : '发布试卷'
    "
    width="480px"
    append-to-body
  >
    <div v-if="dialog.loading.value" class="publish-loading">
      <div v-for="i in 3" :key="i" class="exam-skeleton" />
    </div>
    <template v-else>
      <div v-if="dialog.paper.value" class="assign-label">
        共 {{ dialog.paper.value.questionCount }} 题 ·
        {{ dialog.paper.value.totalScore }} 分;发布后题目锁定为只读。
      </div>

      <div class="assign-label publish-people-row">
        考试的人(默认全员,可增减)
        <span v-if="dialog.candidates.value.length > 0" class="publish-quick">
          <button
            class="exam-link"
            type="button"
            @click="dialog.selectAllSubs()"
          >
            全选子账号
          </button>
          <button
            class="exam-link"
            type="button"
            @click="dialog.clearSelected()"
          >
            清空
          </button>
        </span>
      </div>
      <div v-if="dialog.candidates.value.length === 0" class="assign-empty">
        还没有可指派的账号,先到「协作账号」创建启用的子账号。
      </div>
      <el-checkbox-group
        v-else
        v-model="dialog.selected.value"
        class="assign-subs"
      >
        <el-checkbox
          v-for="sub in dialog.candidates.value"
          :key="sub.username"
          :value="sub.username"
        >
          {{ sub.displayName || sub.username }}
          <span v-if="sub.role === 'owner'" class="assign-sub-owner">
            主账号·我自己
          </span>
          <span class="assign-sub-username">{{ sub.username }}</span>
        </el-checkbox>
      </el-checkbox-group>

      <div class="assign-label">
        考试截止时间 *(到点未交卷,按已保存的作答强制收卷)
      </div>
      <el-date-picker
        v-model="dialog.deadline.value"
        type="datetime"
        placeholder="选择截止时间"
        value-format="YYYY-MM-DDTHH:mm:ss"
        style="width: 100%"
      />
    </template>
    <template #footer>
      <button
        class="exam-btn is-ghost is-small"
        type="button"
        @click="dialog.visible.value = false"
      >
        再检查下
      </button>
      <button
        class="exam-btn is-primary is-small"
        type="button"
        :disabled="!dialog.canConfirm.value"
        @click="dialog.confirm()"
      >
        {{
          dialog.submitting.value
            ? "发布中…"
            : `发布并指派 ${dialog.selected.value.length} 人`
        }}
      </button>
    </template>
  </el-dialog>
</template>
