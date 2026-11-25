<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { ManualGradingQuestionDto } from "@/api/exam";

/**
 * 鼠标优先评分面板（本页首要注意力）。
 * - 满分 ≤ BUTTON_MODE_MAX：直接铺 0…满分的分数按钮，点一下即评分；
 * - 满分更大：步长 1 的滑块 + 常用分/±1 快捷按钮，同样纯鼠标即可给出精确整数。
 * 键盘仍可用（按钮/滑块都是原生可聚焦控件），但任何评分动作都不要求键盘输入。
 * 人工批语为次要操作：默认折叠成一行，已有内容时自动展开；留白合法。
 * 样式类挂在 views/exam/manual-grading/index.css 全局 css。
 */
defineOptions({ name: "ManualGradingScorePad" });

/** 满分不超过该值时铺满分数按钮；再大改用滑块，避免按钮过密。 */
const BUTTON_MODE_MAX = 20;

const props = defineProps<{
  item: ManualGradingQuestionDto;
  score: number | null;
  comment: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  "update:score": [value: number];
  "update:comment": [value: string];
}>();

const max = computed(() => props.item.score);
const useButtons = computed(() => max.value <= BUTTON_MODE_MAX);
const scoreChoices = computed(() =>
  Array.from({ length: max.value + 1 }, (_, index) => index)
);
/** 大满分时的常用分：0 / 60% / 80% / 满分（去重后升序）。 */
const quickScores = computed(() => {
  const full = max.value;
  const raw = [0, Math.round(full * 0.6), Math.round(full * 0.8), full];
  return [...new Set(raw)]
    .filter(value => value >= 0 && value <= full)
    .sort((a, b) => a - b);
});
/**
 * 分数按钮的列数：先按每行至多 6 个（保证每格 ≥44px 命中区）算出行数，
 * 再把总数摊平到各行，避免最后一行只剩一个孤儿按钮。
 * 6 个 → 6×1；13 个 → 5+5+3；21 个 → 6+6+6+3。
 */
const scoreColumns = computed(() => {
  const count = scoreChoices.value.length;
  const perRow = Math.min(6, count);
  return Math.ceil(count / Math.ceil(count / perRow));
});
const commentLength = computed(() => props.comment.trim().length);
const canDecrease = computed(() => !props.disabled && (props.score ?? 0) > 0);
const canIncrease = computed(
  () => !props.disabled && (props.score ?? 0) < max.value
);

const commentOpen = ref(false);
// 切题时重算折叠态：已有批语的题直接展开，留白的题保持收起。
watch(
  () => props.item.questionId,
  () => {
    commentOpen.value = commentLength.value > 0;
  },
  { immediate: true }
);

function pick(value: number) {
  if (props.disabled) return;
  emit("update:score", Math.min(max.value, Math.max(0, Math.round(value))));
}

function step(delta: number) {
  pick((props.score ?? 0) + delta);
}

function quickLabel(value: number) {
  if (value === 0) return "0 分";
  if (value === max.value) return `满分 ${value}`;
  return String(value);
}
</script>

<template>
  <section class="mg-pad" aria-label="人工评分">
    <div class="mg-pad-readout">
      <span class="mg-pad-label">人工得分</span>
      <p class="mg-pad-value exam-mono">
        <strong :class="{ 'is-empty': score === null }">
          {{ score === null ? "—" : score }}
        </strong>
        <small>/ {{ max }}</small>
      </p>
      <span class="mg-pad-state" :class="{ 'is-empty': score === null }">
        {{ score === null ? "本题尚未评分" : "已评分" }}
      </span>
    </div>

    <div
      v-if="useButtons"
      class="mg-score-grid"
      :style="{ '--mg-score-cols': scoreColumns }"
    >
      <button
        v-for="value in scoreChoices"
        :key="value"
        type="button"
        class="mg-score-btn exam-mono"
        :class="{ 'is-active': score === value }"
        :disabled="disabled"
        :aria-pressed="score === value"
        :aria-label="`给 ${value} 分`"
        @click="pick(value)"
      >
        {{ value }}
      </button>
    </div>

    <div v-else class="mg-score-slider">
      <el-slider
        class="mg-slider"
        :model-value="score ?? 0"
        :min="0"
        :max="max"
        :step="1"
        :show-tooltip="false"
        :disabled="disabled"
        :aria-label="`拖动给分，满分 ${max}`"
        @input="pick(Number($event))"
      />
      <!-- 微调与常用分分成两排：左右各一个 ±1 精调，下面一排整齐的常用分 -->
      <div class="mg-score-step">
        <button
          type="button"
          class="mg-step-btn exam-mono"
          :disabled="!canDecrease"
          aria-label="减 1 分"
          @click="step(-1)"
        >
          − 1 分
        </button>
        <button
          type="button"
          class="mg-step-btn exam-mono"
          :disabled="!canIncrease"
          aria-label="加 1 分"
          @click="step(1)"
        >
          + 1 分
        </button>
      </div>
      <div
        class="mg-score-quick"
        :style="{ '--mg-score-cols': quickScores.length }"
      >
        <button
          v-for="value in quickScores"
          :key="value"
          type="button"
          class="mg-quick-btn exam-mono"
          :class="{ 'is-active': score === value }"
          :disabled="disabled"
          :aria-pressed="score === value"
          @click="pick(value)"
        >
          {{ quickLabel(value) }}
        </button>
      </div>
    </div>

    <div class="mg-pad-comment">
      <button
        type="button"
        class="mg-comment-toggle"
        :aria-expanded="commentOpen"
        @click="commentOpen = !commentOpen"
      >
        <span class="mg-comment-name"> 人工批语<em>选填</em> </span>
        <span class="mg-comment-state">
          {{ commentLength > 0 ? `已写 ${commentLength} 字` : "留白" }}
        </span>
        <span class="mg-comment-caret" aria-hidden="true">
          {{ commentOpen ? "收起" : "展开" }}
        </span>
      </button>
      <el-input
        v-show="commentOpen"
        class="mg-comment-input"
        :model-value="comment"
        type="textarea"
        :rows="4"
        maxlength="2000"
        show-word-limit
        :disabled="disabled"
        placeholder="可以留白。写下失分依据，批语会展示给考生。"
        @update:model-value="emit('update:comment', $event)"
      />
    </div>
  </section>
</template>
