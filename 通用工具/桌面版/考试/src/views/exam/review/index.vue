<script setup lang="ts">
import { computed } from "vue";
import { ExamTypeLabels, type ReviewItemDto } from "@/api/exam";
import ExamGradingHandoff from "@/features/exam/components/ExamGradingHandoff.vue";
import ReviewAnswerCard from "@/features/exam/components/ReviewAnswerCard.vue";
import ReviewQuestionBody from "@/features/exam/components/ReviewQuestionBody.vue";
import { useUserStoreHook } from "@/store/modules/user";
import {
  isQuestionGroupStart,
  questionMajorNo
} from "@/features/exam/questionGroups";
import {
  classifyReviewItem,
  useExamReview
} from "@/features/exam/useExamReview";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamReview" });

const userStore = useUserStoreHook();
const canManage = computed(() =>
  (userStore.roles ?? []).some(role => role === "admin" || role === "owner")
);
const reviewApi = useExamReview();
const {
  loading,
  review,
  sheetId,
  isResultsReview,
  reviewStudentLabel,
  blocked,
  blockedText,
  waitingScore,
  wrongOnly,
  allItems,
  items,
  stats,
  notSubmitted,
  passed,
  objectiveFullScore,
  durationText,
  backLabel,
  mode,
  navOpen,
  currentQuestionId,
  currentIndex,
  currentItem,
  hasPrev,
  hasNext
} = reviewApi;

function jumpFromNav(item: ReviewItemDto) {
  navOpen.value = false;
  void reviewApi.jumpTo(item);
}

function itemStateClass(item: ReviewItemDto) {
  const verdict = classifyReviewItem(item);
  return {
    right: "is-right",
    wrong: "is-wrong",
    partial: "is-partial",
    pending: "is-pending"
  }[verdict];
}

/** 判词文案(全卷清单头与逐题阅读头共用一份口径)。 */
function verdictText(item: ReviewItemDto): string {
  // 未交卷的答卷(主账号查阅答题中)没有任何判分,别把空判分说成「AI 判分中」
  if (notSubmitted.value) return "未交卷";
  if (item.isCorrect === true) return "✓ 答对";
  if (item.isCorrect === false) return "✗ 答错";
  if (item.gradedBy === null) return "AI 判分中";
  if (item.gradedBy === "系统") return "未作答";
  if (item.earnedScore !== null && item.earnedScore >= item.score) {
    return "✓ 满分";
  }
  if (item.earnedScore === 0) return "未得分";
  if (item.earnedScore !== null) return "部分得分";
  return "";
}

function formatTime(value: string | null | undefined) {
  return value
    ? new Date(value).toLocaleString("zh-CN", { hour12: false })
    : "";
}

function majorNoFor(item: ReviewItemDto) {
  const index = allItems.value.findIndex(
    candidate => candidate.questionId === item.questionId
  );
  return questionMajorNo(allItems.value, index);
}
</script>

<template>
  <div class="exam-page review-page">
    <section v-if="loading" class="exam-sheet review-blocked">
      <div v-for="i in 6" :key="i" class="exam-skeleton" />
    </section>

    <!-- 等待公布:成绩先行,答案解析待公布 -->
    <section
      v-else-if="blocked === 'waiting'"
      class="exam-sheet review-blocked"
    >
      <div v-if="waitingScore" class="review-waiting-score">
        <template v-if="waitingScore.myTotalScore !== null">
          <div class="review-waiting-headline">
            <span class="review-score exam-mono">{{
              waitingScore.myTotalScore
            }}</span>
            <span class="review-score-total exam-mono"
              >/ {{ waitingScore.paperTotalScore }}</span
            >
            <span
              v-if="waitingScore.passScore !== null"
              class="exam-stamp"
              :class="
                waitingScore.myTotalScore >= waitingScore.passScore
                  ? 'is-jade'
                  : 'is-vermilion'
              "
            >
              {{
                waitingScore.myTotalScore >= waitingScore.passScore
                  ? "及格"
                  : "未及格"
              }}
            </span>
          </div>
          <div class="review-waiting-sub">成绩已出,答案与解析待老师公布</div>
        </template>
        <template v-else>
          <div class="review-waiting-headline">
            <template v-if="waitingScore.objectiveFullScore > 0">
              <span class="review-score exam-mono">{{
                waitingScore.myObjectiveScore ?? 0
              }}</span>
              <span class="review-score-total exam-mono"
                >/ {{ waitingScore.objectiveFullScore }}</span
              >
              <span class="review-waiting-note">客观题已判</span>
            </template>
            <span v-else class="review-waiting-note is-lone">
              本卷全部为简答/实操题,没有可即时判分的客观题
            </span>
          </div>
          <div class="review-waiting-sub">
            主观题正在等待 AI 判分,总分出来会先显示在「我的考试」
          </div>
        </template>
        <div v-if="waitingScore.submittedAt" class="review-waiting-meta">
          已交卷 {{ formatTime(waitingScore.submittedAt) }}
        </div>
      </div>

      <div class="exam-empty">
        <div class="icon">◷</div>
        <div class="lead">答案与解析还没公布</div>
        <div class="hint">{{ blockedText }}</div>
        <button
          class="exam-btn is-ghost"
          type="button"
          @click="reviewApi.backToSource()"
        >
          回「{{ backLabel }}」
        </button>
      </div>
      <ExamGradingHandoff
        v-if="canManage && sheetId && waitingScore?.myTotalScore === null"
        :sheet-id="sheetId"
      />
    </section>

    <section v-else-if="blocked" class="exam-sheet review-blocked">
      <div class="exam-empty">
        <div class="icon">✕</div>
        <div class="lead">暂时无法复盘</div>
        <div class="hint">{{ blockedText }}</div>
        <button
          class="exam-btn is-ghost"
          type="button"
          @click="reviewApi.backToSource()"
        >
          回「{{ backLabel }}」
        </button>
      </div>
    </section>

    <div v-else-if="review" class="review-layout">
      <!-- ===== 全卷清单 ===== -->
      <section v-if="mode === 'overview'" class="exam-sheet review-sheet">
        <!-- 成绩单 -->
        <header class="review-head">
          <div class="review-head-left">
            <h1 class="exam-title">{{ review.paperTitle }}</h1>
            <div class="review-meta">
              <span
                v-if="isResultsReview && reviewStudentLabel"
                class="exam-stamp"
              >
                考生 {{ reviewStudentLabel }}
              </span>
              <span v-if="notSubmitted" class="exam-stamp is-azure">
                答题中 · 未交卷
              </span>
              <span v-if="review.submittedAt">
                已收卷 {{ formatTime(review.submittedAt) }} ·
                {{ allItems.length }} 题作答已封存
              </span>
              <!-- 不写「实时」:这是打开这一刻取到的快照,页面不轮询 -->
              <span v-else>{{ allItems.length }} 题 · 打开时的作答快照</span>
              <template v-if="durationText">· 用时 {{ durationText }}</template>
              <span
                v-if="review.submitKind === '超时'"
                class="exam-stamp is-vermilion"
              >
                超时自动交卷
              </span>
              <span
                v-else-if="review.submitKind === '强制'"
                class="exam-stamp is-vermilion"
              >
                老师收卷
              </span>
            </div>
          </div>
          <div class="review-score-card">
            <span
              v-if="notSubmitted"
              class="review-score-total is-pending-only"
            >
              未交卷 · 暂无成绩
            </span>
            <div
              v-else-if="review.myTotalScore !== null"
              class="review-score-track"
            >
              <span class="review-score-track-label is-ai">AI</span>
              <span class="review-score exam-mono">{{
                review.myTotalScore
              }}</span>
              <span class="review-score-total exam-mono">
                / {{ review.paperTotalScore }}
              </span>
              <span
                v-if="passed !== null"
                class="exam-stamp"
                :class="passed ? 'is-jade' : 'is-vermilion'"
              >
                {{ passed ? "及格" : "未及格" }}
              </span>
            </div>
            <template v-else-if="objectiveFullScore > 0">
              <span class="review-score exam-mono">{{
                review.myObjectiveScore ?? 0
              }}</span>
              <span class="review-score-total">
                客观题得分 · {{ stats.pending }} 题待 AI 判分
              </span>
            </template>
            <template v-else>
              <span class="review-score-total is-pending-only">
                全卷简答/实操 · {{ stats.pending }} 题待 AI 判分
              </span>
            </template>
            <!-- 未交卷时人工轨道也要一起收:无主观题的卷 manualTotalScore 会是 0,
                 和同屏的「未交卷 · 暂无成绩」自相矛盾 -->
            <div
              v-if="!notSubmitted && review.myManualTotalScore !== null"
              class="review-score-track"
            >
              <span class="review-score-track-label is-human">人工</span>
              <span class="review-score exam-mono">
                {{ review.myManualTotalScore }}
              </span>
              <span class="review-score-total exam-mono">
                / {{ review.paperTotalScore }}
              </span>
            </div>
          </div>
        </header>

        <!-- 未交卷的答卷不能开 AI 阅卷授权(服务端只对已交卷/已判分发放),不给这个入口 -->
        <ExamGradingHandoff
          v-if="canManage && review.myTotalScore === null && !notSubmitted"
          :sheet-id="review.sheetId"
        />

        <div class="review-toolbar">
          <div class="review-stats">
            <span v-if="notSubmitted" class="review-stat is-pending">
              作答快照 · 未判分
            </span>
            <template v-else>
              <span class="review-stat is-right">拿满 {{ stats.right }}</span>
              <span class="review-stat is-wrong">丢分 {{ stats.lost }}</span>
              <span v-if="stats.pending > 0" class="review-stat is-pending">
                待判 {{ stats.pending }}
              </span>
            </template>
          </div>
          <div class="review-toolbar-actions">
            <button
              class="review-filter"
              type="button"
              :disabled="items.length === 0"
              title="一次只看一题,键盘 ← → 翻题"
              @click="reviewApi.enterFocus()"
            >
              逐题阅读
            </button>
            <!-- 未交卷=全卷都没判分,「只看丢分题」必然筛空,不给这个空转按钮 -->
            <button
              v-if="!notSubmitted"
              class="review-filter"
              type="button"
              :class="{ 'is-on': wrongOnly }"
              :aria-pressed="wrongOnly"
              @click="wrongOnly = !wrongOnly"
            >
              只看丢分题
            </button>
            <button
              class="exam-link"
              type="button"
              @click="reviewApi.backToSource()"
            >
              回「{{ backLabel }}」
            </button>
          </div>
        </div>

        <div v-if="allItems.length === 0" class="exam-empty">
          <div class="icon">◌</div>
          <div class="lead">没有题目记录</div>
          <div class="hint">这份答卷没有可复盘的题目。</div>
        </div>

        <div v-else-if="items.length === 0" class="exam-empty">
          <div class="icon">✓</div>
          <div class="lead">没有丢分题</div>
          <div class="hint">已判的题目全部拿满,漂亮。</div>
          <button
            class="exam-btn is-ghost"
            type="button"
            @click="wrongOnly = false"
          >
            查看全部题目
          </button>
        </div>

        <ol class="review-items">
          <li
            v-for="(item, index) in items"
            :id="`review-q-${item.questionId}`"
            :key="item.questionId"
            class="review-q"
            :class="itemStateClass(item)"
          >
            <div class="review-q-head">
              <button
                class="review-q-no exam-mono"
                type="button"
                title="逐题阅读本题(沉浸模式)"
                @click="reviewApi.enterFocus(item.questionId)"
              >
                {{ item.group?.subQuestionNo ?? item.orderNo }}
              </button>
              <span class="exam-stamp">{{ ExamTypeLabels[item.type] }}</span>
              <span class="review-q-verdict">{{ verdictText(item) }}</span>
              <span class="review-q-score exam-mono">
                <template v-if="notSubmitted"
                  >本题 {{ item.score }} 分</template
                >
                <template v-else>
                  AI {{ item.earnedScore ?? "—" }} / {{ item.score }}
                  <template v-if="item.manualScore !== null">
                    · 人工 {{ item.manualScore }} / {{ item.score }}
                  </template>
                </template>
              </span>
            </div>
            <ReviewQuestionBody
              :item="item"
              :show-group-intro="
                Boolean(item.group) && isQuestionGroupStart(items, index)
              "
              :major-no="majorNoFor(item)"
              :viewer="isResultsReview ? 'owner' : 'student'"
            />
          </li>
        </ol>
      </section>

      <!-- ===== 逐题阅读:一次只面对一题(← → 切题,Esc 回全卷) ===== -->
      <section
        v-else-if="currentItem"
        id="review-focus-sheet"
        :key="currentItem.questionId"
        class="exam-sheet review-sheet review-focus"
      >
        <header class="review-focus-head">
          <button
            class="exam-link"
            type="button"
            @click="reviewApi.exitFocus()"
          >
            ← 回全卷
          </button>
          <span class="review-focus-position">
            第 <span class="exam-mono">{{ currentIndex + 1 }}</span> 题
            <span class="review-focus-position-total"
              >/ 共 {{ items.length }} 题</span
            >
            <template v-if="wrongOnly">(只看丢分题)</template>
          </span>
          <span class="review-focus-shortcuts"> 键盘 ← → 切题 · Esc 返回 </span>
        </header>

        <article class="review-q" :class="itemStateClass(currentItem)">
          <div class="review-q-head">
            <span class="review-q-no exam-mono is-static">
              {{ currentItem.group?.subQuestionNo ?? currentItem.orderNo }}
            </span>
            <span class="exam-stamp">{{
              ExamTypeLabels[currentItem.type]
            }}</span>
            <span class="review-q-verdict">{{ verdictText(currentItem) }}</span>
            <span class="review-q-score exam-mono">
              <template v-if="notSubmitted">
                本题 {{ currentItem.score }} 分
              </template>
              <template v-else>
                AI {{ currentItem.earnedScore ?? "—" }} /
                {{ currentItem.score }}
                <template v-if="currentItem.manualScore !== null">
                  · 人工 {{ currentItem.manualScore }} /
                  {{ currentItem.score }}
                </template>
              </template>
            </span>
          </div>
          <ReviewQuestionBody
            :item="currentItem"
            :show-group-intro="Boolean(currentItem.group)"
            :major-no="majorNoFor(currentItem)"
            :viewer="isResultsReview ? 'owner' : 'student'"
          />
        </article>

        <footer class="review-focus-footer">
          <button
            class="exam-btn is-ghost"
            type="button"
            :disabled="!hasPrev"
            @click="reviewApi.goPrev()"
          >
            ← 上一题
          </button>
          <button
            class="exam-link"
            type="button"
            @click="reviewApi.exitFocus()"
          >
            回全卷
          </button>
          <button
            v-if="hasNext"
            class="exam-btn is-outline-primary"
            type="button"
            @click="reviewApi.goNext()"
          >
            下一题 →
          </button>
          <button
            v-else
            class="exam-btn is-outline-primary"
            type="button"
            @click="reviewApi.exitFocus()"
          >
            读完了 · 回全卷
          </button>
        </footer>
      </section>

      <!-- 答题卡:桌面右栏吸顶;窄屏顶部横条,中段跳题使用悬浮答题卡 -->
      <aside v-if="allItems.length > 0" class="review-nav" aria-label="答题卡">
        <ReviewAnswerCard
          :items="allItems"
          :wrong-only="wrongOnly"
          :pending-count="stats.pending"
          :not-submitted="notSubmitted"
          :current-question-id="mode === 'focus' ? currentQuestionId : null"
          @jump="item => reviewApi.jumpTo(item)"
        />
      </aside>
    </div>

    <!-- 悬浮答题卡:窄屏 fixed 浮层,长卷滚到任何位置都能跳题 -->
    <template v-if="!loading && !blocked && review && allItems.length > 0">
      <button
        type="button"
        class="review-fab exam-mono"
        :aria-expanded="navOpen"
        aria-label="打开答题卡"
        @click="navOpen = !navOpen"
      >
        题卡
      </button>
      <div
        v-if="navOpen"
        class="review-fab-backdrop"
        aria-hidden="true"
        @click="navOpen = false"
      />
      <div
        v-if="navOpen"
        class="review-fab-pop"
        role="dialog"
        aria-label="答题卡"
      >
        <ReviewAnswerCard
          :items="allItems"
          :wrong-only="wrongOnly"
          :pending-count="stats.pending"
          :not-submitted="notSubmitted"
          :current-question-id="mode === 'focus' ? currentQuestionId : null"
          @jump="jumpFromNav"
        />
      </div>
    </template>
  </div>
</template>
