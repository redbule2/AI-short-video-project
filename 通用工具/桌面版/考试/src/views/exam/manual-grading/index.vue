<script setup lang="ts">
import { computed } from "vue";
import Lock from "~icons/ep/lock";
import Unlock from "~icons/ep/unlock";
import ManualGradingNav from "@/features/exam/components/ManualGradingNav.vue";
import ManualGradingProgress from "@/features/exam/components/ManualGradingProgress.vue";
import ManualGradingQuestionPanel from "@/features/exam/components/ManualGradingQuestionPanel.vue";
import ManualGradingReferencePanel from "@/features/exam/components/ManualGradingReferencePanel.vue";
import ManualGradingScorePad from "@/features/exam/components/ManualGradingScorePad.vue";
import { questionMajorNo } from "@/features/exam/questionGroups";
import {
  MANUAL_GRADING_ANCHOR_ID,
  useExamManualGrading
} from "@/features/exam/useExamManualGrading";
import "../exam-shared.css";
import "./index.css";

/**
 * 人工阅卷工作台（逐题阅卷）。
 * 本文件只做布局装配：业务状态全部来自 useExamManualGrading，
 * 子组件通过 props/emits 通信，不各自持有 grades / 当前题 / 完成态副本。
 */
defineOptions({ name: "ExamManualGrading" });

const grading = useExamManualGrading();
const {
  loading,
  saving,
  errorText,
  workspace,
  references,
  items,
  completedCount,
  unscoredCount,
  isComplete,
  progressPercent,
  scoredQuestionIds,
  projectedTotal,
  isReviewStage,
  studentLabel,
  currentIndex,
  currentItem,
  currentGrade,
  currentReference,
  hasPrev,
  hasNext,
  firstUnscoredIndex
} = grading;

const majorNo = computed(() =>
  questionMajorNo(items.value, currentIndex.value)
);
const submitLabel = computed(() => {
  if (saving.value) return "保存中…";
  return isReviewStage.value ? "保存复核修改" : "检查并提交";
});

function formatTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
</script>

<template>
  <div class="exam-page manual-grading-page">
    <section v-if="loading" class="exam-sheet manual-grading-sheet">
      <div v-for="i in 6" :key="i" class="exam-skeleton" />
    </section>

    <section v-else-if="errorText" class="exam-sheet manual-grading-sheet">
      <div class="exam-empty">
        <div class="icon">✕</div>
        <div class="lead">无法打开人工阅卷</div>
        <div class="hint">{{ errorText }}</div>
        <div class="mg-empty-actions">
          <button class="exam-btn is-ghost" type="button" @click="grading.back">
            返回上一页
          </button>
          <button
            class="exam-btn is-outline-primary"
            type="button"
            @click="grading.load"
          >
            重新加载
          </button>
        </div>
      </div>
    </section>

    <section v-else-if="workspace" class="exam-sheet manual-grading-sheet">
      <header class="mg-head">
        <div class="mg-head-copy">
          <button class="exam-link" type="button" @click="grading.back">
            ← {{ workspace.viewerIsOwner ? "成绩总览" : "我的阅卷" }}
          </button>
          <h1 class="exam-title">{{ workspace.paperTitle }}</h1>
          <p class="exam-subtitle">
            {{ workspace.viewerIsOwner ? "主账号阅卷" : "互阅任务" }} ·
            {{ studentLabel }}
            <template v-if="!workspace.viewerIsOwner">
              · 阅卷人 {{ workspace.viewerDisplayName }}
            </template>
            <template v-if="workspace.firstSubmittedAt">
              · 首次提交 {{ formatTime(workspace.firstSubmittedAt) }}
            </template>
          </p>
        </div>
        <div class="mg-head-stage">
          <span
            class="exam-stamp"
            :class="isReviewStage ? 'is-jade' : 'is-vermilion'"
          >
            {{ isReviewStage ? "复核阶段" : "独立盲评" }}
          </span>
          <p class="mg-seal" :class="{ 'is-unlocked': isReviewStage }">
            <component :is="isReviewStage ? Unlock : Lock" />
            <span>
              {{
                isReviewStage
                  ? "参考答案与解析已解锁"
                  : "答案与解析已封存，提交后解锁"
              }}
            </span>
          </p>
        </div>
      </header>

      <div v-if="!workspace.requiresManualGrading" class="exam-empty">
        <div class="icon">✓</div>
        <div class="lead">本卷没有需要人工批改的主观题</div>
        <div class="hint">客观题由系统判分，无需重复人工评分。</div>
        <button class="exam-btn is-ghost" type="button" @click="grading.back">
          返回上一页
        </button>
      </div>

      <template v-else-if="currentItem">
        <ManualGradingProgress
          :position="currentIndex + 1"
          :total="items.length"
          :scored="completedCount"
          :unscored="unscoredCount"
          :percent="progressPercent"
          :projected-total="projectedTotal"
          :paper-total-score="workspace.paperTotalScore"
          :review-stage="isReviewStage"
          :ai-total-score="references?.aiTotalScore ?? null"
        />

        <div class="mg-body">
          <div class="mg-main">
            <ManualGradingQuestionPanel
              :key="currentItem.questionId"
              :item="currentItem"
              :index="currentIndex"
              :total="items.length"
              :major-no="majorNo"
              :anchor-id="MANUAL_GRADING_ANCHOR_ID"
            />
            <ManualGradingReferencePanel
              v-if="isReviewStage"
              :item="currentItem"
              :reference="currentReference"
            />
          </div>

          <aside class="mg-side">
            <ManualGradingScorePad
              :item="currentItem"
              :score="currentGrade.score"
              :comment="currentGrade.comment"
              :disabled="saving"
              @update:score="grading.setScore(currentItem!.questionId, $event)"
              @update:comment="
                grading.setComment(currentItem!.questionId, $event)
              "
            />
          </aside>
        </div>

        <footer class="mg-deck">
          <ManualGradingNav
            :items="items"
            :scored-ids="scoredQuestionIds"
            :current-index="currentIndex"
            @jump="grading.goTo"
          />

          <div class="mg-deck-actions">
            <div class="mg-deck-move">
              <button
                class="exam-btn is-ghost"
                type="button"
                :disabled="!hasPrev"
                @click="grading.goPrev"
              >
                ← 上一题
              </button>
              <button
                class="exam-btn is-outline-primary"
                type="button"
                :disabled="!hasNext"
                @click="grading.goNext"
              >
                下一题 →
              </button>
            </div>

            <p v-if="unscoredCount > 0" class="mg-deck-hint">
              <span>
                还有 <b class="exam-mono">{{ unscoredCount }}</b> 题未评分
              </span>
              <!-- 第一道未评分题就是当前题时不给死按钮：点了没反应比没按钮更糟 -->
              <button
                v-if="firstUnscoredIndex !== currentIndex"
                class="exam-btn is-small is-ghost"
                type="button"
                @click="grading.goFirstUnscored"
              >
                跳到第 {{ firstUnscoredIndex + 1 }} 题
              </button>
              <em v-else>本题就是第一道未评分题</em>
            </p>
            <p v-else class="mg-deck-hint is-ready">
              <span>
                全部 <b class="exam-mono">{{ items.length }}</b> 题已给分
              </span>
              <em>人工批语选填，留白不影响提交</em>
            </p>

            <button
              class="exam-btn is-primary mg-submit"
              type="button"
              :disabled="!isComplete || saving"
              @click="grading.submit"
            >
              {{ submitLabel }}
            </button>
          </div>
        </footer>
      </template>
    </section>
  </div>
</template>
