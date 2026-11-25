<script setup lang="ts">
import type { ManualGradingQuestionDto } from "@/api/exam";

/**
 * 紧凑题号导航（只放题号，不放题目内容）。
 * 三态可辨：当前题=朱砂实底、已评分=蓝绿实底、未评分=虚线墨灰。
 * 样式类挂在 views/exam/manual-grading/index.css 全局 css。
 */
defineOptions({ name: "ManualGradingNav" });

const props = defineProps<{
  items: ManualGradingQuestionDto[];
  /** 已评分题目的业务 ID 集合（单源自 useExamManualGrading）。 */
  scoredIds: Set<string>;
  currentIndex: number;
}>();

const emit = defineEmits<{ jump: [index: number] }>();

function chipTitle(item: ManualGradingQuestionDto, index: number) {
  const state = props.scoredIds.has(item.questionId) ? "已评分" : "未评分";
  return `第 ${index + 1} 题 · 满分 ${item.score} · ${state}`;
}
</script>

<template>
  <nav class="mg-nav" aria-label="题号导航">
    <div class="mg-nav-strip">
      <button
        v-for="(item, index) in items"
        :key="item.questionId"
        type="button"
        class="mg-nav-chip exam-mono"
        :class="{
          'is-current': index === currentIndex,
          'is-scored': scoredIds.has(item.questionId)
        }"
        :aria-current="index === currentIndex ? 'true' : undefined"
        :title="chipTitle(item, index)"
        @click="emit('jump', index)"
      >
        {{ index + 1 }}
      </button>
    </div>
    <p class="mg-nav-legend">
      <span class="is-current">当前</span>
      <span class="is-scored">已评</span>
      <span class="is-unscored">未评</span>
    </p>
  </nav>
</template>
