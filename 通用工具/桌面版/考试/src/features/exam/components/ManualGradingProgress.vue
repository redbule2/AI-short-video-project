<script setup lang="ts">
/**
 * 人工阅卷进度条（顶部紧凑信息区第二行）。
 * 只读展示：当前题位置、已评/未评、整体完成度、当前人工总分（复核阶段加 AI 总分）。
 * 状态单源在 useExamManualGrading，本组件不持有任何评分状态。
 * 样式类挂在 views/exam/manual-grading/index.css 全局 css。
 */
defineOptions({ name: "ManualGradingProgress" });

defineProps<{
  /** 1 基当前题序。 */
  position: number;
  total: number;
  scored: number;
  unscored: number;
  percent: number;
  projectedTotal: number;
  paperTotalScore: number;
  reviewStage: boolean;
  aiTotalScore: number | null;
}>();
</script>

<template>
  <section class="mg-progress" aria-label="阅卷进度">
    <div class="mg-progress-cell">
      <span class="mg-progress-label">当前</span>
      <strong class="mg-progress-value exam-mono">
        第 {{ position }}<small>/ {{ total }}</small> 题
      </strong>
    </div>

    <div class="mg-progress-bar">
      <div
        class="mg-progress-track"
        role="progressbar"
        :aria-valuenow="scored"
        :aria-valuemin="0"
        :aria-valuemax="total"
        :aria-label="`已评 ${scored} 题，共 ${total} 题`"
      >
        <div class="mg-progress-fill" :style="{ width: `${percent}%` }" />
      </div>
      <div class="mg-progress-counts">
        <span class="mg-count is-scored">
          已评 <b class="exam-mono">{{ scored }}</b>
        </span>
        <span class="mg-count is-unscored">
          未评 <b class="exam-mono">{{ unscored }}</b>
        </span>
      </div>
    </div>

    <div class="mg-progress-cell is-total">
      <span class="mg-progress-label">当前人工总分</span>
      <strong class="mg-progress-value exam-mono">
        {{ projectedTotal }}<small>/ {{ paperTotalScore }}</small>
      </strong>
    </div>

    <div v-if="reviewStage" class="mg-progress-cell is-ai">
      <span class="mg-progress-label">AI 总分</span>
      <strong class="mg-progress-value exam-mono">
        {{ aiTotalScore ?? "待判" }}
      </strong>
    </div>
  </section>
</template>
