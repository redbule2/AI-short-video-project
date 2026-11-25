<script setup lang="ts">
import { ref } from "vue";
import { useExamResults } from "@/features/exam/useExamResults";
import ExamGradingHandoff from "@/features/exam/components/ExamGradingHandoff.vue";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamResults" });

const resultsApi = useExamResults();
const {
  papers,
  canManage,
  papersLoading,
  selectedPaperId,
  selectedPaper,
  results,
  resultsLoading,
  isEmpty
} = resultsApi;

const gradingHandoffVisible = ref(false);
const gradingHandoffSheetId = ref("");

function statusStampClass(status: string) {
  switch (status) {
    case "已判分":
      return "is-jade";
    case "答题中":
    case "已交卷":
      return "is-azure";
    case "缺考":
      return "";
    default:
      return "";
  }
}

function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function openGradingHandoff(sheetId: string) {
  gradingHandoffSheetId.value = sheetId;
  gradingHandoffVisible.value = true;
}
</script>

<template>
  <div class="exam-page results-page">
    <section class="exam-sheet results-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">成绩总览</h1>
          <div class="exam-subtitle">
            团队内共享已交答卷，互相复盘学习
          </div>
        </div>
        <el-select
          v-model="selectedPaperId"
          :loading="papersLoading"
          placeholder="选择试卷"
          style="width: 260px"
          @change="resultsApi.selectPaper"
        >
          <el-option
            v-for="paper in papers"
            :key="paper.paperId"
            :label="`${paper.title}(${paper.status})`"
            :value="paper.paperId"
          />
        </el-select>
      </header>

      <div v-if="papersLoading || resultsLoading" class="results-loading">
        <div v-for="i in 4" :key="i" class="exam-skeleton" />
      </div>

      <div v-else-if="papers.length === 0" class="exam-empty">
        <div class="icon">◎</div>
        <div class="lead">还没有已发布的试卷</div>
        <div class="hint">
          {{
            canManage
              ? "先到「试卷管理」发布并指派一张卷,这里就会出现成绩。"
              : "主账号发布并指派试卷后,这里会展示团队成绩。"
          }}
        </div>
      </div>

      <template v-else-if="results">
        <div class="results-summary">
          <span>
            总分 <span class="exam-mono">{{ results.totalScore }}</span>
            <template v-if="results.passScore !== null">
              · 及格 <span class="exam-mono">{{ results.passScore }}</span>
            </template>
          </span>
          <div v-if="canManage" class="results-summary-actions">
            <button
              class="exam-btn is-ghost is-small"
              type="button"
              @click="resultsApi.openManualGradingAssignments()"
            >
              阅卷安排
            </button>
            <button
              v-if="
                selectedPaper &&
                selectedPaper.answerRevealPolicy === 'manual' &&
                !selectedPaper.answersPublished
              "
              class="exam-btn is-azure is-small"
              type="button"
              @click="resultsApi.publishAnswersForSelected()"
            >
              公布答案
            </button>
          </div>
        </div>

        <div v-if="isEmpty" class="exam-empty">
          <div class="icon">✎</div>
          <div class="lead">
            {{ canManage ? "这张卷还没有指派考生" : "这张卷还没有已交答卷" }}
          </div>
          <div class="hint">
            {{
              canManage
                ? "到「试卷管理」对已发布的卷点「指派考试」。"
                : "团队成员交卷后,即可在这里互相查看学习。"
            }}
          </div>
        </div>

        <ul v-else class="results-list">
          <li v-if="results.truncated" class="results-limit-note">
            当前仅展示最近 500 份答卷。
          </li>
          <li class="results-grid-head result-grid" aria-hidden="true">
            <span>考生</span>
            <span>状态</span>
            <span>评分</span>
            <span>交卷时间</span>
            <span class="is-actions">操作</span>
          </li>
          <li
            v-for="sheet in results.sheets"
            :key="sheet.sheetId"
            class="result-row result-grid"
          >
            <div class="result-student">
              <span class="result-name">
                {{ sheet.studentDisplayName || sheet.studentUsername }}
                <span v-if="sheet.studentRemoved" class="exam-stamp"
                  >已移除</span
                >
              </span>
              <span class="result-username exam-mono">{{
                sheet.studentUsername
              }}</span>
            </div>
            <div class="result-state">
              <span class="exam-stamp" :class="statusStampClass(sheet.status)">
                {{ sheet.status }}
              </span>
              <span v-if="sheet.paused" class="exam-stamp">已暂停</span>
              <span
                v-if="sheet.submitKind === '超时'"
                class="exam-stamp is-vermilion"
              >
                超时收卷
              </span>
              <span
                v-else-if="sheet.submitKind === '强制'"
                class="exam-stamp is-vermilion"
              >
                强制收卷
              </span>
              <span
                v-if="sheet.assignedGraderUsername"
                class="exam-stamp"
                :class="sheet.assignedGraderDisabled ? 'is-vermilion' : ''"
              >
                阅卷 ·
                {{
                  sheet.assignedGraderDisplayName ||
                  sheet.assignedGraderUsername
                }}
                <template v-if="sheet.assignedGraderDisabled"
                  >（停用）</template
                >
              </span>
            </div>
            <div class="result-score-tracks">
              <template
                v-if="sheet.status === '已交卷' || sheet.status === '已判分'"
              >
                <div class="result-score exam-mono">
                  <span class="result-track-label is-ai">AI</span>
                  <span class="result-track-value">
                    <template v-if="sheet.totalScore !== null">
                      {{ sheet.totalScore }}
                      <span class="result-score-total"
                        >/ {{ results.totalScore }}</span
                      >
                    </template>
                    <span
                      v-else-if="sheet.objectiveScore !== null"
                      class="result-score-note"
                    >
                      客观 {{ sheet.objectiveScore }} · 待判
                    </span>
                    <span v-else class="result-score-note">待判</span>
                  </span>
                </div>
                <div class="result-score exam-mono">
                  <span class="result-track-label is-human">人工</span>
                  <span class="result-track-value">
                    <template v-if="sheet.manualTotalScore !== null">
                      {{ sheet.manualTotalScore }}
                      <span class="result-score-total"
                        >/ {{ results.totalScore }}</span
                      >
                    </template>
                    <span
                      v-else-if="sheet.manualGradingStatus === 'notRequired'"
                      class="result-score-note"
                    >
                      无主观题
                    </span>
                    <span v-else class="result-score-note">待阅</span>
                  </span>
                </div>
              </template>
              <span v-else class="result-score-empty">—</span>
            </div>
            <div class="result-time">{{ formatTime(sheet.submittedAt) }}</div>
            <div class="result-actions">
              <button
                v-if="
                  canManage &&
                  (sheet.status === '已交卷' || sheet.status === '已判分') &&
                  sheet.manualGradingStatus !== 'notRequired'
                "
                class="exam-btn is-ghost is-small"
                type="button"
                @click="openGradingHandoff(sheet.sheetId)"
              >
                AI 阅卷
              </button>
              <button
                v-if="
                  canManage &&
                  (sheet.status === '已交卷' || sheet.status === '已判分') &&
                  !(
                    sheet.manualGradingStatus === 'pending' &&
                    sheet.assignedGraderUsername
                  )
                "
                class="exam-btn is-outline-primary is-small"
                type="button"
                @click="resultsApi.openManualGrading(sheet.sheetId)"
              >
                {{
                  sheet.manualGradingStatus === "completed"
                    ? "复核人工评分"
                    : sheet.manualGradingStatus === "notRequired"
                      ? "查看人工阅卷"
                      : "主账号阅卷"
                }}
              </button>
              <!-- 查阅 ≠ 批改:任何已作答的答卷都能进考生同款「复盘看解析」,
                   不再受人工阅卷进度限制(2026-07-26 用户裁决,后端同步放开) -->
              <button
                v-if="
                  sheet.status === '已交卷' ||
                  sheet.status === '已判分' ||
                  (canManage && sheet.status === '答题中')
                "
                class="exam-btn is-ghost is-small"
                type="button"
                @click="resultsApi.openDetail(sheet.sheetId)"
              >
                {{
                  sheet.status === "答题中"
                    ? "查阅作答"
                    : canManage
                      ? "复盘看解析"
                      : "查看答卷"
                }}
              </button>
              <button
                v-if="
                  canManage &&
                  selectedPaper?.status === '已发布' &&
                  (sheet.status === '缺考' ||
                    (sheet.submitKind === '超时' &&
                      (sheet.status === '已交卷' ||
                        sheet.status === '已判分')))
                "
                class="exam-btn is-ghost is-small"
                type="button"
                :disabled="resultsApi.reopening.value[sheet.sheetId]"
                @click="
                  resultsApi.reopenTimedOut(
                    sheet.sheetId,
                    sheet.studentUsername,
                    sheet.status,
                    sheet.deadline
                  )
                "
              >
                {{
                  resultsApi.reopening.value[sheet.sheetId]
                    ? "恢复中…"
                    : "允许继续"
                }}
              </button>
              <button
                v-if="canManage && sheet.status === '答题中'"
                class="exam-link is-danger"
                type="button"
                @click="
                  resultsApi.forceSubmit(sheet.sheetId, sheet.studentUsername)
                "
              >
                强制收卷
              </button>
              <button
                v-if="
                  canManage &&
                  (sheet.status === '待考' || sheet.status === '答题中')
                "
                class="exam-link is-danger"
                type="button"
                :disabled="resultsApi.revoking.value[sheet.sheetId]"
                @click="
                  resultsApi.revoke(
                    sheet.sheetId,
                    sheet.studentUsername,
                    sheet.status
                  )
                "
              >
                {{
                  resultsApi.revoking.value[sheet.sheetId]
                    ? "撤回中…"
                    : "撤回指派"
                }}
              </button>
            </div>
          </li>
        </ul>
      </template>
    </section>

    <el-drawer
      v-if="canManage"
      v-model="gradingHandoffVisible"
      class="exam-handoff-drawer"
      title="AI 阅卷交接"
      size="min(420px, 92vw)"
      append-to-body
    >
      <el-scrollbar class="exam-handoff-scrollbar">
        <!-- :key 强制换答卷时重建实例,防止上一份答卷的授权提示/过期时间残留 -->
        <ExamGradingHandoff
          v-if="gradingHandoffSheetId"
          :key="gradingHandoffSheetId"
          :sheet-id="gradingHandoffSheetId"
        />
      </el-scrollbar>
    </el-drawer>
  </div>
</template>
