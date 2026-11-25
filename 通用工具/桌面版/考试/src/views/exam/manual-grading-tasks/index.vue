<script setup lang="ts">
import Reading from "~icons/ep/reading";
import Check from "~icons/ep/check";
import { useExamManualGradingTasks } from "@/features/exam/useExamManualGradingTasks";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamManualGradingTasks" });

const tasks = useExamManualGradingTasks();
const {
  loading,
  errorText,
  hasMore,
  statusFilter,
  pendingCount,
  completedCount,
  visibleItems
} = tasks;

function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}
</script>

<template>
  <div class="exam-page grading-tasks-page">
    <section class="exam-sheet grading-tasks-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">我的阅卷</h1>
          <div class="exam-subtitle">
            独立完成分数和批语后，才会解锁参考答案与解析
          </div>
        </div>
        <button
          class="exam-btn is-ghost is-small"
          type="button"
          :disabled="loading"
          @click="tasks.load"
        >
          刷新任务
        </button>
      </header>

      <div class="grading-task-seal">
        <div class="grading-task-seal-icon">
          <Reading />
        </div>
        <div>
          <span>今日批卷签</span>
          <strong>
            {{ pendingCount > 0 ? `还有 ${pendingCount} 份待批` : "待批任务已清" }}
          </strong>
          <p>你只能看到主账号指派给自己的答卷，也不能批改自己的答卷。</p>
        </div>
      </div>

      <div class="grading-task-tabs" role="tablist" aria-label="阅卷任务状态">
        <button
          type="button"
          :class="{ 'is-active': statusFilter === 'pending' }"
          @click="statusFilter = 'pending'"
        >
          待批改 <span class="exam-mono">{{ pendingCount }}</span>
        </button>
        <button
          type="button"
          :class="{ 'is-active': statusFilter === 'completed' }"
          @click="statusFilter = 'completed'"
        >
          已完成 <span class="exam-mono">{{ completedCount }}</span>
        </button>
      </div>

      <div v-if="loading" class="grading-tasks-loading">
        <div v-for="i in 5" :key="i" class="exam-skeleton" />
      </div>

      <div v-else-if="errorText" class="exam-empty">
        <div class="icon">✕</div>
        <div class="lead">任务箱加载失败</div>
        <div class="hint">{{ errorText }}</div>
        <button
          class="exam-btn is-outline-primary"
          type="button"
          @click="tasks.load"
        >
          重新加载
        </button>
      </div>

      <div v-else-if="visibleItems.length === 0" class="exam-empty">
        <div class="icon">{{ statusFilter === "pending" ? "✓" : "◎" }}</div>
        <div class="lead">
          {{
            statusFilter === "pending"
              ? "暂时没有待批答卷"
              : "还没有已完成的互阅"
          }}
        </div>
        <div class="hint">
          {{
            statusFilter === "pending"
              ? "主账号新指派的答卷会出现在这里。"
              : "完成首次整卷评分后，可在这里继续复核。"
          }}
        </div>
      </div>

      <ul v-else class="grading-task-list">
        <li
          v-for="task in visibleItems"
          :key="task.sheetId"
          class="grading-task-row"
        >
          <div
            class="grading-task-mark"
            :class="{ 'is-complete': task.manualGradingStatus === 'completed' }"
          >
            <Check v-if="task.manualGradingStatus === 'completed'" />
            <Reading v-else />
          </div>
          <div class="grading-task-paper">
            <span>试卷</span>
            <strong>{{ task.paperTitle }}</strong>
          </div>
          <div class="grading-task-student">
            <span>考生答卷</span>
            <strong>
              {{ task.studentDisplayName || task.studentUsername }}
            </strong>
            <small class="exam-mono">{{ task.studentUsername }}</small>
          </div>
          <div class="grading-task-time">
            <span>交卷时间</span>
            <strong>{{ formatTime(task.submittedAt) }}</strong>
          </div>
          <div class="grading-task-result">
            <span
              class="exam-stamp"
              :class="
                task.manualGradingStatus === 'completed'
                  ? 'is-jade'
                  : 'is-vermilion'
              "
            >
              {{
                task.manualGradingStatus === "completed"
                  ? `人工总分 ${task.manualTotalScore}`
                  : "待独立盲评"
              }}
            </span>
            <button
              class="exam-btn is-outline-primary is-small"
              type="button"
              @click="tasks.openTask(task)"
            >
              {{
                task.manualGradingStatus === "completed"
                  ? "复核评分"
                  : "去评分"
              }}
            </button>
          </div>
        </li>
      </ul>

      <p v-if="hasMore" class="grading-task-limit">
        任务较多，本页先显示最近 500 份。
      </p>
    </section>
  </div>
</template>
