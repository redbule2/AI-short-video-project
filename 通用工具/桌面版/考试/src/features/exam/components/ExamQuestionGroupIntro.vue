<script setup lang="ts">
import type { ExamQuestionGroupDto } from "@/api/exam";
import { toChineseQuestionNumber } from "@/features/exam/questionGroups";

defineOptions({ name: "ExamQuestionGroupIntro" });

defineProps<{
  group: ExamQuestionGroupDto;
  majorNo: number;
  compact?: boolean;
}>();
</script>

<template>
  <section
    class="exam-group-intro"
    :class="{ 'is-compact': compact }"
    :aria-label="`第${toChineseQuestionNumber(majorNo)}大题 ${group.title}`"
  >
    <div class="exam-group-title">
      {{ toChineseQuestionNumber(majorNo) }}、{{ group.title }}
    </div>
    <div v-if="group.caseText" class="exam-group-case">{{ group.caseText }}</div>
  </section>
</template>

<style scoped>
.exam-group-intro {
  padding: 14px 16px;
  margin: 10px 0 14px;
  color: var(--ink-body, var(--el-text-color-primary));
  background: var(--field, var(--el-fill-color-light));
  border: 1px solid var(--field-edge, var(--el-border-color));
  border-left: 3px solid var(--azure, var(--el-color-primary));
  border-radius: 5px;
}

.exam-group-title {
  font-family: var(--exam-serif, var(--el-font-family));
  font-size: 17px;
  line-height: 1.6;
  letter-spacing: 0.08em;
  color: var(--ink, var(--el-text-color-primary));
}

.exam-group-case {
  margin-top: 6px;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  color: var(--graphite, var(--el-text-color-regular));
}

.exam-group-intro.is-compact {
  padding: 10px 12px;
  margin: 4px 0 10px;
}

.exam-group-intro.is-compact .exam-group-title {
  font-size: 15px;
}
</style>
