<script setup lang="ts">
import { ref } from "vue";
import type { MyExamItemDto } from "@/api/exam";
import ExamGradingHandoff from "@/features/exam/components/ExamGradingHandoff.vue";
import { useMyExams } from "@/features/exam/useMyExams";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamMy" });

const myExams = useMyExams();
const { sorted, loading, loadError, isEmpty, starting } = myExams;
const handoffVisible = ref(false);
const handoffSheetId = ref("");

function openGradingHandoff(sheetId: string) {
  handoffSheetId.value = sheetId;
  handoffVisible.value = true;
}

function statusStampClass(status: string) {
  switch (status) {
    case "答题中":
      return "is-azure";
    case "已判分":
      return "is-jade";
    case "待考":
      return "is-vermilion";
    default:
      return "";
  }
}

function deadlineText(item: MyExamItemDto) {
  return item.deadline
    ? new Date(item.deadline).toLocaleString("zh-CN", { hour12: false })
    : "";
}

function passState(item: MyExamItemDto) {
  if (item.myTotalScore === null || item.passScore === null) return null;
  return item.myTotalScore >= item.passScore;
}
</script>

<template>
  <div class="exam-page my-page">
    <section class="exam-sheet my-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">我的考试</h1>
          <div class="exam-subtitle">
            作答自动保存;限时的卷可在答题页「暂停」冻结计时,回来继续
          </div>
        </div>
        <button class="exam-link" type="button" @click="myExams.load()">
          刷新
        </button>
      </header>

      <div v-if="loading" class="my-loading">
        <div v-for="i in 3" :key="i" class="exam-skeleton" />
      </div>

      <div v-else-if="loadError" class="exam-error">
        <div class="icon">✕</div>
        <div class="lead">考试列表加载失败</div>
        <div class="hint">网络或服务暂不可用,稍候重试一次即可。</div>
        <button class="exam-btn is-ghost" type="button" @click="myExams.load()">
          重新加载
        </button>
      </div>

      <div v-else-if="isEmpty" class="exam-empty">
        <div class="icon">◎</div>
        <div class="lead">还没有指派给你的考试</div>
        <div class="hint">主账号在「试卷管理」指派后,考试会出现在这里。</div>
      </div>

      <ul v-else class="my-list">
        <li
          v-for="item in sorted"
          :key="item.sheetId"
          class="my-card"
          :class="{ 'is-pending': item.status === '待考' }"
        >
          <div class="my-card-head">
            <span class="my-card-title">{{ item.paperTitle }}</span>
            <span class="exam-stamp" :class="statusStampClass(item.status)">
              {{ item.status }}
            </span>
            <span v-if="item.paused" class="exam-stamp">已暂停 · 计时冻结</span>
          </div>
          <p v-if="item.paperDescription" class="my-card-desc">
            {{ item.paperDescription }}
          </p>
          <div class="my-card-meta exam-mono">
            {{ item.questionCount }} 题 · {{ item.totalScore }} 分 ·
            {{ myExams.describeDuration(item) }}
            <template v-if="item.passScore !== null">
              · 及格 {{ item.passScore }}
            </template>
            <span v-if="item.deadline" class="my-card-deadline">
              截止 {{ deadlineText(item) }}
            </span>
          </div>

          <!-- 成绩区 -->
          <div v-if="item.status === '已判分'" class="my-card-score">
            <span class="my-score-number exam-mono">{{
              item.myTotalScore
            }}</span>
            <span class="my-score-total exam-mono"
              >/ {{ item.totalScore }}</span
            >
            <span
              v-if="passState(item) !== null"
              class="exam-stamp"
              :class="passState(item) ? 'is-jade' : 'is-vermilion'"
            >
              {{ passState(item) ? "及格" : "未及格" }}
            </span>
          </div>
          <div
            v-else-if="item.status === '已交卷'"
            class="my-card-score is-partial"
          >
            客观题
            <span class="exam-mono">{{ item.myObjectiveScore ?? 0 }}</span>
            分 · 主观题 AI 判分中
          </div>

          <div class="my-card-actions">
            <button
              v-if="item.status === '待考'"
              class="exam-btn is-primary"
              type="button"
              :disabled="starting[item.sheetId]"
              @click="myExams.confirmStart(item)"
            >
              {{ starting[item.sheetId] ? "开卷中…" : "提笔作答" }}
            </button>
            <button
              v-else-if="item.status === '答题中'"
              class="exam-btn is-outline-primary"
              type="button"
              @click="myExams.continueTaking(item)"
            >
              {{ item.paused ? "继续答题(已暂停)" : "继续作答" }}
            </button>
            <template
              v-else-if="item.status === '已交卷' || item.status === '已判分'"
            >
              <button
                v-if="item.answersPublished"
                class="exam-btn is-ghost"
                type="button"
                @click="myExams.goReview(item)"
              >
                复盘看解析
              </button>
              <span v-else class="my-card-wait">待老师公布答案后可复盘</span>
              <button
                class="exam-link"
                type="button"
                @click="openGradingHandoff(item.sheetId)"
              >
                AI 阅卷交接
              </button>
            </template>
            <span v-else-if="item.status === '缺考'" class="my-card-wait">
              已过截止时间未参加
            </span>
          </div>
        </li>
      </ul>
    </section>

    <el-drawer
      v-model="handoffVisible"
      class="exam-handoff-drawer"
      title="AI 阅卷交接"
      size="min(420px, 92vw)"
      append-to-body
    >
      <el-scrollbar class="exam-handoff-scrollbar">
        <!-- :key 强制换答卷时重建实例,防止上一份答卷的授权提示/过期时间残留 -->
        <ExamGradingHandoff
          v-if="handoffSheetId"
          :key="handoffSheetId"
          :sheet-id="handoffSheetId"
        />
      </el-scrollbar>
    </el-drawer>
  </div>
</template>
