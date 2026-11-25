<script setup lang="ts">
import Lock from "~icons/ep/lock";
import Search from "~icons/ep/search";
import { useExamManualGradingAssignments } from "@/features/exam/useExamManualGradingAssignments";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamManualGradingAssignments" });

const assignment = useExamManualGradingAssignments();
const {
  papers,
  selectedPaperId,
  workspace,
  loading,
  saving,
  errorText,
  searchText,
  scopeFilter,
  piles,
  selectedSheetIds,
  batchGrader,
  ownerDirectValue,
  assignments,
  dirtyCount,
  filteredSheets,
  allVisibleSelected
} = assignment;

function formatTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      })
    : "—";
}

function isSelected(sheetId: string) {
  return selectedSheetIds.value.includes(sheetId);
}

function toggleRow(sheetId: string, checked: boolean) {
  selectedSheetIds.value = checked
    ? [...new Set([...selectedSheetIds.value, sheetId])]
    : selectedSheetIds.value.filter(value => value !== sheetId);
}

function reviewerLabel(sheetId: string) {
  const username = assignments.value[sheetId];
  if (username === ownerDirectValue) return "主账号直批";
  const grader = workspace.value?.assignees.find(
    item => item.username === username
  );
  return grader?.displayName || username;
}
</script>

<template>
  <div class="exam-page assignment-page">
    <section class="exam-sheet assignment-sheet">
      <header class="assignment-head">
        <div>
          <button class="exam-link" type="button" @click="assignment.back">
            ← 成绩总览
          </button>
          <h1 class="exam-title">阅卷安排</h1>
          <p class="assignment-flowline">
            考生答卷 <i aria-hidden="true">→</i> 指定阅卷人
            <i aria-hidden="true">→</i> 盲评后解锁解析 · 首次提交后责任人锁定
          </p>
        </div>
        <label class="assignment-paper">
          <span>当前试卷</span>
          <el-select
            v-model="selectedPaperId"
            :disabled="saving"
            placeholder="选择试卷"
            class="exam-field-quiet assignment-paper-select"
            popper-class="exam-popper"
            @change="assignment.selectPaper"
          >
            <el-option
              v-for="paper in papers"
              :key="paper.paperId"
              :label="paper.title"
              :value="paper.paperId"
            />
          </el-select>
        </label>
      </header>

      <div v-if="loading" class="assignment-loading">
        <div v-for="i in 5" :key="i" class="exam-skeleton" />
      </div>

      <div v-else-if="errorText" class="exam-empty">
        <div class="icon">✕</div>
        <div class="lead">阅卷安排没有打开</div>
        <div class="hint">{{ errorText }}</div>
        <button
          class="exam-btn is-outline-primary"
          type="button"
          @click="assignment.load"
        >
          重新加载
        </button>
      </div>

      <div v-else-if="papers.length === 0" class="exam-empty">
        <div class="icon">◎</div>
        <div class="lead">还没有可安排的试卷</div>
        <div class="hint">试卷发布并有考生交卷后，就可以安排人工互阅。</div>
      </div>

      <template v-else-if="workspace">
        <!-- 卷堆：统计与筛选合一，数字本身即入口 -->
        <nav class="assignment-piles" aria-label="按卷堆筛选">
          <button
            v-for="pile in piles"
            :key="pile.key"
            type="button"
            class="assignment-pile"
            :class="{ 'is-active': scopeFilter === pile.key }"
            :aria-pressed="scopeFilter === pile.key"
            @click="scopeFilter = pile.key"
          >
            <strong class="exam-mono">{{ pile.count }}</strong>
            <span>{{ pile.label }}</span>
          </button>
          <label class="assignment-search">
            <Search aria-hidden="true" />
            <el-input
              v-model="searchText"
              clearable
              placeholder="搜索考生姓名或账号"
              class="exam-field-quiet"
            />
          </label>
        </nav>

        <div v-if="workspace.sheets.length === 0" class="exam-empty">
          <div class="icon">✎</div>
          <div class="lead">暂无可安排的人工阅卷</div>
          <div class="hint">
            这里只显示已交卷且包含填空、简答或实操题的答卷。
          </div>
        </div>

        <template v-else>
          <div class="assignment-ledger-head assignment-grid">
            <el-checkbox
              :model-value="allVisibleSelected"
              aria-label="选择当前卷堆中可调整的答卷"
              @change="assignment.toggleVisibleSelection(Boolean($event))"
            />
            <span>考生答卷</span>
            <span>阅卷人</span>
            <span>状态</span>
            <span />
          </div>

          <div v-if="filteredSheets.length === 0" class="exam-empty is-compact">
            <div class="lead">这个卷堆是空的</div>
            <div class="hint">可以清空搜索词，或切回“全部”。</div>
          </div>

          <ul v-else class="assignment-list">
            <li
              v-for="sheet in filteredSheets"
              :key="sheet.sheetId"
              class="assignment-row assignment-grid"
              :class="{
                'is-complete': sheet.assignmentLocked,
                'is-dirty': assignment.isDirty(sheet.sheetId),
                'is-picked': isSelected(sheet.sheetId)
              }"
            >
              <el-checkbox
                :model-value="isSelected(sheet.sheetId)"
                :disabled="sheet.assignmentLocked"
                :aria-label="`选择 ${sheet.studentUsername} 的答卷`"
                @change="toggleRow(sheet.sheetId, Boolean($event))"
              />

              <div class="assignment-student">
                <strong>
                  {{ sheet.studentDisplayName || sheet.studentUsername }}
                </strong>
                <span class="exam-mono">{{ sheet.studentUsername }}</span>
                <small>{{ formatTime(sheet.submittedAt) }} 交卷</small>
              </div>

              <div class="assignment-hand">
                <i class="assignment-arrow" aria-hidden="true">→</i>
                <el-select
                  v-if="!sheet.assignmentLocked"
                  v-model="assignments[sheet.sheetId]"
                  class="exam-field-quiet"
                  popper-class="exam-popper"
                  :aria-label="`把 ${sheet.studentUsername} 的答卷交给`"
                >
                  <el-option label="主账号直批" :value="ownerDirectValue" />
                  <!-- label 决定收起后显示的短名；插槽只在下拉里展开账号与停用态 -->
                  <el-option
                    v-for="grader in workspace.assignees"
                    :key="grader.username"
                    :label="grader.displayName"
                    :value="grader.username"
                    :disabled="
                      grader.status === 'disabled' ||
                      grader.username.toLowerCase() ===
                        sheet.studentUsername.toLowerCase()
                    "
                  >
                    <span class="exam-option">
                      <strong>{{ grader.displayName }}</strong>
                      <em class="exam-mono">{{ grader.username }}</em>
                      <i v-if="grader.status === 'disabled'">已停用</i>
                    </span>
                  </el-option>
                </el-select>
                <span v-else class="assignment-hand-locked">
                  {{ reviewerLabel(sheet.sheetId) }}
                  <Lock aria-hidden="true" />
                  <em>已锁定</em>
                </span>
              </div>

              <div class="assignment-mark">
                <span
                  class="exam-stamp"
                  :class="
                    sheet.manualGradingStatus === 'completed'
                      ? 'is-jade'
                      : 'is-vermilion'
                  "
                >
                  {{
                    sheet.manualGradingStatus === "completed"
                      ? "已完成"
                      : "待批改"
                  }}
                </span>
                <span
                  v-if="sheet.assignedGraderDisabled"
                  class="assignment-warn"
                >
                  阅卷人已停用
                </span>
              </div>

              <div class="assignment-act">
                <button
                  v-if="
                    sheet.assignmentLocked ||
                    assignments[sheet.sheetId] === ownerDirectValue
                  "
                  class="exam-btn is-ghost is-small"
                  type="button"
                  @click="assignment.openManualGrading(sheet.sheetId)"
                >
                  {{ sheet.assignmentLocked ? "复核评分" : "我来批" }}
                </button>
                <span
                  v-else-if="assignment.isDirty(sheet.sheetId)"
                  class="assignment-hint"
                >
                  保存后进入对方待办
                </span>
                <span v-else class="assignment-hint">已在对方待办</span>
              </div>
            </li>
          </ul>

          <p v-if="workspace.hasMore" class="assignment-limit-note">
            当前试卷答卷较多，本页先显示最近 500 份。
          </p>
        </template>

        <!-- 桌沿：只有"有事可做"时才出现，页面唯一主按钮 -->
        <Transition name="assignment-deskedge">
          <footer
            v-if="selectedSheetIds.length > 0 || dirtyCount > 0"
            class="assignment-deskedge"
          >
            <div v-if="selectedSheetIds.length > 0" class="assignment-batch">
              <strong>已选 {{ selectedSheetIds.length }} 份</strong>
              <span>交给</span>
              <el-select
                v-model="batchGrader"
                placeholder="选择阅卷人"
                class="exam-field-quiet assignment-batch-select"
                popper-class="exam-popper"
              >
                <el-option
                  label="主账号直批（撤回指派）"
                  :value="ownerDirectValue"
                />
                <el-option
                  v-for="grader in workspace.assignees"
                  :key="grader.username"
                  :label="grader.displayName"
                  :value="grader.username"
                  :disabled="grader.status === 'disabled'"
                >
                  <span class="exam-option">
                    <strong>{{ grader.displayName }}</strong>
                    <em class="exam-mono">{{ grader.username }}</em>
                    <i v-if="grader.status === 'disabled'">已停用</i>
                  </span>
                </el-option>
              </el-select>
              <button
                class="exam-btn is-ghost is-small"
                type="button"
                @click="assignment.applyBatch"
              >
                套用
              </button>
              <button
                class="exam-link"
                type="button"
                @click="assignment.clearSelection"
              >
                取消选择
              </button>
            </div>

            <div class="assignment-commit">
              <span v-if="dirtyCount > 0">{{ dirtyCount }} 份安排待保存</span>
              <button
                class="exam-btn is-primary"
                type="button"
                :disabled="dirtyCount === 0 || saving"
                @click="assignment.save"
              >
                {{ saving ? "保存中…" : "保存阅卷安排" }}
              </button>
            </div>
          </footer>
        </Transition>
      </template>
    </section>
  </div>
</template>
