<script setup lang="ts">
import { ExamTypeLabels, type ReviewItemDto } from "@/api/exam";
import {
  classifyReviewItem,
  type ReviewVerdict
} from "@/features/exam/useExamReview";

/**
 * 复盘答题卡(判词着色的题号格子,单源:页首总览与悬浮面板共用)。
 * 样式类挂在 review-page 全局 css(views/exam/review/index.css)。
 */
defineOptions({ name: "ReviewAnswerCard" });

const props = defineProps<{
  items: ReviewItemDto[];
  /** 「只看丢分题」开启时,被滤掉的题号做视觉减淡(仍可点击跳转)。 */
  wrongOnly: boolean;
  pendingCount: number;
  /** 逐题阅读模式下的当前题(格子加当前圈);全卷模式传 null。 */
  currentQuestionId?: string | null;
  /** 未交卷(主账号查阅答题中):全卷无判分,判词图例整条收起,只留题号跳转。 */
  notSubmitted?: boolean;
}>();

const emit = defineEmits<{ jump: [item: ReviewItemDto] }>();

const verdictClass: Record<ReviewVerdict, string> = {
  right: "is-right",
  wrong: "is-wrong",
  partial: "is-partial",
  pending: "is-pending"
};

function chipClass(item: ReviewItemDto) {
  const verdict = classifyReviewItem(item);
  return [
    verdictClass[verdict],
    {
      "is-dimmed":
        props.wrongOnly && verdict !== "wrong" && verdict !== "partial",
      "is-current": props.currentQuestionId === item.questionId
    }
  ];
}
</script>

<template>
  <div class="review-nav-card">
    <div class="review-nav-head">
      <span class="review-nav-title">答题卡</span>
      <span class="review-nav-count exam-mono">{{ items.length }} 题</span>
    </div>
    <div v-if="!notSubmitted" class="review-nav-legend">
      <span class="review-legend is-right">拿满</span>
      <span class="review-legend is-partial">部分</span>
      <span class="review-legend is-wrong">丢分</span>
      <span v-if="pendingCount > 0" class="review-legend is-pending">待判</span>
    </div>
    <div class="review-nav-grid">
      <button
        v-for="item in items"
        :key="item.questionId"
        type="button"
        class="review-chip exam-mono"
        :class="chipClass(item)"
        :title="`第 ${item.orderNo} 题 · ${ExamTypeLabels[item.type]}`"
        @click="emit('jump', item)"
      >
        {{ item.orderNo }}
      </button>
    </div>
  </div>
</template>
