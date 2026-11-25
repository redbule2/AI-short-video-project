<script setup lang="ts">
import { ref, watch } from "vue";
import {
  formatAnswerText,
  type ManualGradingQuestionDto,
  type ManualGradingReferenceItemDto
} from "@/api/exam";

/**
 * 复核阶段的次要信息（参考答案 / 评分标准 / 解析 / AI 得分与批语）。
 * 默认折叠，不与「当前题 + 考生作答 + 人工评分」主流程抢首屏；
 * 切题时自动收起，避免上一题的展开状态带到下一题。
 * 样式类挂在 views/exam/manual-grading/index.css 全局 css。
 */
defineOptions({ name: "ManualGradingReferencePanel" });

const props = defineProps<{
  item: ManualGradingQuestionDto;
  reference: ManualGradingReferenceItemDto | null;
}>();

const open = ref(false);

watch(
  () => props.item.questionId,
  () => {
    open.value = false;
  }
);
</script>

<template>
  <section v-if="reference" class="mg-reference" :class="{ 'is-open': open }">
    <button
      type="button"
      class="mg-reference-toggle"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="mg-reference-title">复核依据</span>
      <span class="mg-reference-hint"> 参考答案 · 解析 · AI 评分 </span>
      <span class="exam-stamp is-azure">
        AI {{ reference.aiScore ?? "待判" }} / {{ item.score }}
      </span>
      <span class="mg-reference-caret" aria-hidden="true">
        {{ open ? "收起" : "展开" }}
      </span>
    </button>

    <div v-show="open" class="mg-reference-body">
      <div class="mg-reference-row">
        <span>{{ item.type === "practical" ? "评分标准" : "参考答案" }}</span>
        <p>{{ formatAnswerText(item.type, reference.correctAnswer) }}</p>
      </div>
      <div class="mg-reference-row">
        <span>解析</span>
        <p>{{ reference.analysis || "—" }}</p>
      </div>
      <div v-if="reference.aiComment" class="mg-reference-row is-ai">
        <span>AI 批语</span>
        <p>{{ reference.aiComment }}</p>
      </div>
    </div>
  </section>
</template>
