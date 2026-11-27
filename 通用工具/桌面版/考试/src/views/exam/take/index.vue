<script setup lang="ts">
import { computed } from "vue";
import {
  ExamTypeLabels,
  formatAnswerText,
  type TakingQuestionDto
} from "@/api/exam";
import ExamFillBlankFields from "@/features/exam/components/ExamFillBlankFields.vue";
import ExamQuestionGroupIntro from "@/features/exam/components/ExamQuestionGroupIntro.vue";
import {
  normalizeBlankAnswers,
  resolveBlankCount
} from "@/features/exam/fillBlanks";
import {
  isQuestionGroupStart,
  questionMajorNo
} from "@/features/exam/questionGroups";
import { useExamTaking } from "@/features/exam/useExamTaking";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamTake" });

const taking = useExamTaking();
const {
  loading,
  blocked,
  blockedText,
  paper,
  questions,
  answers,
  flagged,
  currentQuestionId,
  mode,
  cardOpen,
  currentIndex,
  currentQuestion,
  hasPrev,
  hasNext,
  answeredCount,
  unansweredCount,
  remainingText,
  timeCritical,
  paused,
  pausing,
  resuming,
  hasTimeBudget,
  deadlineText,
  pausedDeadlineText,
  pausedSyncOk,
  saveFailed,
  lastSavedText,
  submitting
} = taking;

function pickSingle(question: TakingQuestionDto, key: string) {
  taking.setAnswer(question.questionId, { answer: key });
}

function toggleMultiple(question: TakingQuestionDto, key: string) {
  const current = answers.value[question.questionId]?.answers ?? [];
  const next = current.includes(key)
    ? current.filter(item => item !== key)
    : [...current, key];
  taking.setAnswer(question.questionId, next.length ? { answers: next } : null);
}

function pickJudge(question: TakingQuestionDto, value: boolean) {
  taking.setAnswer(question.questionId, { answer: value });
}

function setBlank(question: TakingQuestionDto, index: number, value: string) {
  const next = normalizeBlankAnswers(
    answers.value[question.questionId]?.answers,
    blankCount(question)
  );
  next[index] = value;
  // 全空必须回落成 null:后端把 ["","",""] 判为未作答并锁死 0 分(ExamScoring.IsAnswered),
  // 照发补齐后的空数组会让这题再也进不了 AI 判分。
  taking.setAnswer(
    question.questionId,
    next.some(item => item.trim()) ? { answers: next } : null
  );
}

/** 简答:内容驱动稿纸自动增高(承诺什么就做什么【gpt-5.6-sol 采纳】)。 */
function setEssay(question: TakingQuestionDto, event: Event) {
  const el = event.target as HTMLTextAreaElement;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
  taking.setAnswer(
    question.questionId,
    el.value.trim() ? { text: el.value } : null
  );
}

function growEssay(el: unknown) {
  const textarea = el as HTMLTextAreaElement | null;
  if (!textarea?.style) return;
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

/** 填空题空数:以服务端按参考答案下发的 blankCount 为准;缺失时回退题干下划线段数。 */
function blankCount(question: TakingQuestionDto) {
  return resolveBlankCount(question.blankCount, question.stem);
}

/** 未作答时回同一个常量空数组:每次新建 [] 会让子组件在计时 tick 上白重渲染。 */
const EmptyBlanks: string[] = [];

function blankValues(question: TakingQuestionDto) {
  return answers.value[question.questionId]?.answers ?? EmptyBlanks;
}

/** 读屏用的题目定位(分组子题报大题内子题号,独立题报全卷序号)。 */
function questionLabel(question: TakingQuestionDto) {
  return `第 ${question.group?.subQuestionNo ?? question.orderNo} 题`;
}

function isPicked(question: TakingQuestionDto, key: string) {
  const value = answers.value[question.questionId];
  if (question.type === "single") return value?.answer === key;
  return value?.answers?.includes(key) ?? false;
}

/** 填空题在卷面上直接写(输入框不能塞进 button,这一支的题目体是 div)。 */
function isFillBlank(question: TakingQuestionDto) {
  return question.type === "fillBlank";
}

/** 卷面可直答的题型(选择/判断点选、填空直接写);简答/实操才进专注模式。 */
function isPaperAnswerable(question: TakingQuestionDto) {
  return (
    question.type === "single" ||
    question.type === "multiple" ||
    question.type === "judge" ||
    isFillBlank(question)
  );
}

/** 卷面点题:填空就地作答不跳走,其余题型点开专注模式。 */
function openQuestion(question: TakingQuestionDto) {
  if (isFillBlank(question)) return;
  taking.enterFocus(question.questionId);
}

/** 本卷是否有填空题:没有就不必在卷首讲填空的规矩(那句话已经够长了)。 */
const hasFillBlank = computed(() => questions.value.some(isFillBlank));

function judgeValue(question: TakingQuestionDto) {
  const value = answers.value[question.questionId]?.answer;
  return typeof value === "boolean" ? value : null;
}

function essayValue(question: TakingQuestionDto) {
  return answers.value[question.questionId]?.text ?? "";
}

/** 实操:选择即上传(成功后写入作答并自动保存)。 */
function onPracticalPick(question: TakingQuestionDto, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ""; // 允许重复选择同一文件
  if (file) {
    void taking.uploadPracticalFile(question.questionId, file);
  }
}

/** 总览里的作答摘要(未答给安静占位)。 */
function answerSummary(question: TakingQuestionDto) {
  if (!taking.isAnswered(question.questionId)) return "";
  return formatAnswerText(
    question.type,
    answers.value[question.questionId] ?? null
  );
}
</script>

<template>
  <div class="exam-page take-page">
    <!-- 加载态 -->
    <section v-if="loading" class="exam-sheet take-blocked">
      <div v-for="i in 6" :key="i" class="exam-skeleton" />
    </section>

    <!-- 不可答态 -->
    <section v-else-if="blocked" class="exam-sheet take-blocked">
      <div class="exam-error">
        <div class="icon">{{ blocked === "pending" ? "◎" : "✕" }}</div>
        <div class="lead">
          {{
            blocked === "pending"
              ? "考试还没开始"
              : blocked === "closed"
                ? "考试已结束"
                : "进入考试失败"
          }}
        </div>
        <div class="hint">{{ blockedText }}</div>
        <button
          class="exam-btn is-ghost"
          type="button"
          @click="taking.backToMy()"
        >
          回「我的考试」
        </button>
      </div>
    </section>

    <!-- 答题现场 -->
    <div v-else-if="paper" class="take-layout">
      <!-- ===== 卷面总览:整卷摊在桌上,点任意一题提笔作答 ===== -->
      <section
        v-if="mode === 'overview'"
        class="exam-sheet take-paper take-overview"
      >
        <header class="take-paper-head">
          <h1 class="exam-title">{{ paper.paperTitle }}</h1>
          <span class="take-paper-total exam-mono"
            >满分 {{ paper.totalScore }}</span
          >
        </header>
        <p class="take-overview-hint">
          这是整张卷面。选择、判断点选项作答<template v-if="hasFillBlank"
            >,填空直接写在横线上</template
          >;简答、实操点题目提笔作答,一次只看一题,随时可回卷面。
        </p>

        <ol class="ov-questions">
          <li
            v-for="(question, index) in questions"
            :id="`exam-q-${question.questionId}`"
            :key="question.questionId"
            class="ov-q"
            :class="{
              'is-answered': taking.isAnswered(question.questionId),
              'is-flagged': flagged.has(question.questionId)
            }"
          >
            <ExamQuestionGroupIntro
              v-if="question.group && isQuestionGroupStart(questions, index)"
              :group="question.group"
              :major-no="questionMajorNo(questions, index)"
              compact
            />
            <!-- 题目体:填空题里有输入框,只能是 div;其余题型是点开专注模式的按钮 -->
            <component
              :is="isFillBlank(question) ? 'div' : 'button'"
              class="ov-q-body"
              :class="{ 'is-static': isFillBlank(question) }"
              :type="isFillBlank(question) ? undefined : 'button'"
              :aria-label="
                isFillBlank(question)
                  ? undefined
                  : isPaperAnswerable(question)
                    ? `第 ${question.orderNo} 题,${taking.isAnswered(question.questionId) ? '已答' : '未答'},点击进入专注答题`
                    : `第 ${question.orderNo} 题,${taking.isAnswered(question.questionId) ? '已答,点击修改' : '未答,点击作答'}`
              "
              @click="openQuestion(question)"
            >
              <span class="ov-q-head">
                <span class="ov-q-no exam-mono">
                  {{ question.group?.subQuestionNo ?? question.orderNo }}
                </span>
                <span class="exam-stamp">{{
                  ExamTypeLabels[question.type]
                }}</span>
                <span class="ov-q-score exam-mono"
                  >{{ question.score }} 分</span
                >
                <span
                  class="ov-q-state"
                  :class="{
                    'is-answered': taking.isAnswered(question.questionId)
                  }"
                >
                  {{
                    taking.isAnswered(question.questionId) ? "✓ 已答" : "未答"
                  }}
                </span>
              </span>
              <!-- 填空:横线就在题干里,当场写 -->
              <ExamFillBlankFields
                v-if="isFillBlank(question)"
                :stem="question.stem"
                :blank-count="blankCount(question)"
                :values="blankValues(question)"
                :disabled="paused"
                :id-prefix="`ov-${question.questionId}`"
                :question-label="questionLabel(question)"
                @update="(index, value) => setBlank(question, index, value)"
              />
              <span v-else class="ov-q-stem">{{ question.stem }}</span>
              <span
                v-if="question.stemImages?.length"
                class="stem-images is-compact"
              >
                <img
                  v-for="image in question.stemImages"
                  :key="image.url"
                  :src="image.url"
                  :alt="image.name || '题干配图'"
                  loading="lazy"
                />
              </span>
              <template v-if="!isPaperAnswerable(question)">
                <span v-if="answerSummary(question)" class="ov-q-answer">
                  我的作答:{{ answerSummary(question) }}
                </span>
                <span v-else class="ov-q-invite">点击提笔作答 →</span>
              </template>
            </component>

            <!-- 选择题:选项摊在卷面上,点选即作答(不必进专注模式) -->
            <div
              v-if="question.type === 'single' || question.type === 'multiple'"
              class="ov-options"
              :role="question.type === 'single' ? 'radiogroup' : 'group'"
              :aria-label="`第 ${question.orderNo} 题选项`"
            >
              <button
                v-for="option in question.options ?? []"
                :key="option.key"
                type="button"
                class="take-option"
                :class="{ 'is-picked': isPicked(question, option.key) }"
                :role="question.type === 'single' ? 'radio' : 'checkbox'"
                :aria-checked="isPicked(question, option.key)"
                @click="
                  question.type === 'single'
                    ? pickSingle(question, option.key)
                    : toggleMultiple(question, option.key)
                "
              >
                <span
                  class="take-option-mark"
                  :class="question.type === 'multiple' ? 'is-square' : ''"
                >
                  {{ option.key }}
                </span>
                <span class="take-option-text">{{ option.text }}</span>
              </button>
            </div>

            <!-- 判断题:对/错直接点选 -->
            <div
              v-else-if="question.type === 'judge'"
              class="ov-options is-judge"
              role="radiogroup"
              :aria-label="`第 ${question.orderNo} 题判断`"
            >
              <button
                type="button"
                class="take-option take-judge-option"
                :class="{ 'is-picked': judgeValue(question) === true }"
                role="radio"
                :aria-checked="judgeValue(question) === true"
                @click="pickJudge(question, true)"
              >
                <span class="take-option-mark">对</span>
              </button>
              <button
                type="button"
                class="take-option take-judge-option"
                :class="{ 'is-picked': judgeValue(question) === false }"
                role="radio"
                :aria-checked="judgeValue(question) === false"
                @click="pickJudge(question, false)"
              >
                <span class="take-option-mark">错</span>
              </button>
            </div>
          </li>
        </ol>
      </section>

      <!-- ===== 专注答题:一次只面对一题 ===== -->
      <section
        v-else-if="currentQuestion"
        :key="currentQuestion.questionId"
        class="exam-sheet take-paper take-focus"
      >
        <header class="focus-head">
          <button
            class="exam-link focus-exit"
            type="button"
            @click="taking.exitFocus()"
          >
            ← 回卷面选题
          </button>
          <span class="focus-position">
            <template v-if="currentQuestion.group">
              第
              <span class="exam-mono">{{
                questionMajorNo(questions, currentIndex)
              }}</span>
              大题 · 子题
              <span class="exam-mono">{{
                currentQuestion.group.subQuestionNo
              }}</span>
            </template>
            <template v-else>
              第 <span class="exam-mono">{{ currentIndex + 1 }}</span> 题
            </template>
            <span class="focus-position-total"
              >/ 共 {{ questions.length }} 题</span
            >
          </span>
          <span class="exam-stamp">{{
            ExamTypeLabels[currentQuestion.type]
          }}</span>
          <span class="focus-score exam-mono"
            >{{ currentQuestion.score }} 分</span
          >
          <button
            class="take-q-flag"
            type="button"
            :class="{ 'is-on': flagged.has(currentQuestion.questionId) }"
            :aria-pressed="flagged.has(currentQuestion.questionId)"
            title="标记本题(快捷键 F),答题卡上折角提醒"
            @click="taking.toggleFlag(currentQuestion.questionId)"
          >
            {{ flagged.has(currentQuestion.questionId) ? "已标记" : "标记" }}
          </button>
        </header>

        <ExamQuestionGroupIntro
          v-if="currentQuestion.group"
          :group="currentQuestion.group"
          :major-no="questionMajorNo(questions, currentIndex)"
        />
        <!-- 填空题的题干由作答格自己渲染(横线上就是输入框);换题后的焦点锚点仍是这个 id -->
        <div
          v-if="isFillBlank(currentQuestion)"
          id="exam-focus-stem"
          class="focus-stem is-fill"
          tabindex="-1"
        >
          <ExamFillBlankFields
            :stem="currentQuestion.stem"
            :blank-count="blankCount(currentQuestion)"
            :values="blankValues(currentQuestion)"
            :disabled="paused"
            :id-prefix="`focus-${currentQuestion.questionId}`"
            :question-label="questionLabel(currentQuestion)"
            @update="(index, value) => setBlank(currentQuestion!, index, value)"
          />
        </div>
        <div v-else id="exam-focus-stem" class="focus-stem" tabindex="-1">
          {{ currentQuestion.stem }}
        </div>

        <!-- 题干配图:点开看原图 -->
        <div v-if="currentQuestion.stemImages?.length" class="stem-images">
          <a
            v-for="image in currentQuestion.stemImages"
            :key="image.url"
            :href="image.url"
            target="_blank"
            rel="noopener"
            :title="image.name || '点开看原图'"
          >
            <img
              :src="image.url"
              :alt="image.name || '题干配图'"
              loading="lazy"
            />
          </a>
        </div>

        <!-- 单选 / 多选 -->
        <div
          v-if="
            currentQuestion.type === 'single' ||
            currentQuestion.type === 'multiple'
          "
          class="take-options"
          :role="currentQuestion.type === 'single' ? 'radiogroup' : 'group'"
          aria-label="选项"
        >
          <button
            v-for="option in currentQuestion.options ?? []"
            :key="option.key"
            type="button"
            class="take-option"
            :class="{ 'is-picked': isPicked(currentQuestion, option.key) }"
            :role="currentQuestion.type === 'single' ? 'radio' : 'checkbox'"
            :aria-checked="isPicked(currentQuestion, option.key)"
            @click="
              currentQuestion.type === 'single'
                ? pickSingle(currentQuestion, option.key)
                : toggleMultiple(currentQuestion, option.key)
            "
          >
            <span
              class="take-option-mark"
              :class="currentQuestion.type === 'multiple' ? 'is-square' : ''"
            >
              {{ option.key }}
            </span>
            <span class="take-option-text">{{ option.text }}</span>
          </button>
          <p class="focus-type-hint">
            {{
              currentQuestion.type === "multiple"
                ? "多选题:选出所有正确项 · "
                : ""
            }}键盘 A-D 可直接作答
          </p>
        </div>

        <!-- 判断 -->
        <div
          v-else-if="currentQuestion.type === 'judge'"
          class="take-judge"
          role="radiogroup"
          aria-label="判断"
        >
          <button
            type="button"
            class="take-option take-judge-option"
            :class="{ 'is-picked': judgeValue(currentQuestion) === true }"
            role="radio"
            :aria-checked="judgeValue(currentQuestion) === true"
            @click="pickJudge(currentQuestion, true)"
          >
            <span class="take-option-mark">对</span>
          </button>
          <button
            type="button"
            class="take-option take-judge-option"
            :class="{ 'is-picked': judgeValue(currentQuestion) === false }"
            role="radio"
            :aria-checked="judgeValue(currentQuestion) === false"
            @click="pickJudge(currentQuestion, false)"
          >
            <span class="take-option-mark">错</span>
          </button>
        </div>

        <!-- 填空的作答格已在题干里,这里不再摆东西 -->

        <!-- 实操:按要求上传图片作答 -->
        <div
          v-else-if="currentQuestion.type === 'practical'"
          class="focus-practical"
        >
          <div class="practical-files">
            <figure
              v-for="file in answers[currentQuestion.questionId]?.files ?? []"
              :key="file.url"
              class="practical-file"
            >
              <a :href="file.url" target="_blank" rel="noopener">
                <img
                  :src="file.url"
                  :alt="file.name || '答案图片'"
                  loading="lazy"
                />
              </a>
              <figcaption class="practical-file-name">
                {{ file.name || "图片" }}
              </figcaption>
              <button
                class="practical-file-remove"
                type="button"
                :aria-label="`移除 ${file.name || '图片'}`"
                @click="
                  taking.removePracticalFile(
                    currentQuestion.questionId,
                    file.url
                  )
                "
              >
                ✕
              </button>
            </figure>

            <label
              v-if="
                (answers[currentQuestion.questionId]?.files?.length ?? 0) < 3
              "
              class="practical-upload"
              :class="{ 'is-busy': taking.uploadingCount.value > 0 }"
            >
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                class="practical-upload-input"
                @change="onPracticalPick(currentQuestion, $event)"
              />
              <span class="practical-upload-icon">＋</span>
              <span class="practical-upload-text">
                {{ taking.uploadingCount.value > 0 ? "上传中…" : "上传图片" }}
              </span>
              <span class="practical-upload-hint"
                >png / jpg / webp · 单张 ≤10MB</span
              >
            </label>
          </div>
          <p class="focus-type-hint">
            按题目要求完成操作后,把成品图片上传到这里(最多 3
            张);上传即自动保存。
          </p>

          <!-- 随附文字:最终提示词 / 自评 / 核对表(与图片共同计分) -->
          <div class="practical-text-wrap">
            <label
              class="practical-text-label"
              :for="`practical-text-${currentQuestion.questionId}`"
            >
              最终提示词与自评(题目有要求时必填,与图片一同判分)
            </label>
            <textarea
              :id="`practical-text-${currentQuestion.questionId}`"
              class="take-essay practical-text"
              rows="5"
              maxlength="4000"
              :value="answers[currentQuestion.questionId]?.text ?? ''"
              placeholder="粘贴最终提示词,并附不超过 150 字的自评…"
              @input="
                taking.setPracticalText(
                  currentQuestion.questionId,
                  ($event.target as HTMLTextAreaElement).value
                )
              "
            />
          </div>
        </div>

        <!-- 简答:稿纸随内容自动加高 -->
        <div
          v-else-if="currentQuestion.type === 'essay'"
          class="focus-essay-wrap"
        >
          <textarea
            :ref="growEssay"
            class="take-essay"
            rows="8"
            :value="essayValue(currentQuestion)"
            placeholder="从这里开始作答…"
            @input="setEssay(currentQuestion, $event)"
          />
          <div class="focus-essay-meta">
            <span>本机已记录 · 自动同步</span>
            <span class="exam-mono"
              >{{ essayValue(currentQuestion).length }} 字</span
            >
          </div>
        </div>

        <!-- 桌沿:翻页 -->
        <footer class="focus-footer">
          <button
            class="exam-btn is-ghost"
            type="button"
            :disabled="!hasPrev"
            @click="taking.goPrev()"
          >
            ← 上一题
          </button>
          <button
            class="exam-link focus-footer-exit"
            type="button"
            @click="taking.exitFocus()"
          >
            回卷面选题
          </button>
          <button
            v-if="hasNext"
            class="exam-btn is-outline-primary"
            type="button"
            @click="taking.goNext()"
          >
            下一题 →
          </button>
          <button
            v-else-if="unansweredCount > 0"
            class="exam-btn is-outline-primary"
            type="button"
            @click="taking.exitFocus()"
          >
            回卷面检查 · 还有 {{ unansweredCount }} 题
          </button>
          <button
            v-else
            class="exam-btn is-outline-primary"
            type="button"
            @click="taking.confirmSubmit()"
          >
            检查并交卷
          </button>
        </footer>
      </section>

      <!-- 桌沿答题卡(两种模式常驻;窄屏为带遮罩的抽屉) -->
      <div
        v-if="cardOpen"
        class="take-card-backdrop"
        aria-hidden="true"
        @click="cardOpen = false"
      />
      <aside
        class="take-rail"
        :class="{ 'is-open': cardOpen }"
        role="complementary"
        aria-label="答题卡与计时"
      >
        <div class="rail-inner">
          <div class="rail-timer" :class="{ 'is-critical': timeCritical }">
            <span class="rail-timer-label">
              {{ paused ? "已暂停" : timeCritical ? "仅剩" : "剩余" }}
            </span>
            <span class="rail-timer-value exam-mono">{{ remainingText }}</span>
          </div>
          <div v-if="deadlineText" class="rail-deadline">
            最晚交卷 <span class="exam-mono">{{ deadlineText }}</span>
          </div>
          <button
            v-if="hasTimeBudget && !paused"
            class="rail-pause"
            type="button"
            :disabled="pausing"
            title="暂停后计时冻结,不能作答;可以离开页面,回来继续。截止时间到仍会强制收卷。"
            @click="taking.pause()"
          >
            {{ pausing ? "暂停中…" : "‖ 暂停 · 冻结计时" }}
          </button>
          <div class="rail-save" :class="{ 'is-failed': saveFailed }">
            {{ lastSavedText }}
          </div>

          <div class="rail-progress">
            <span class="rail-card-label">答题卡</span>
            <span class="exam-mono"
              >已答 {{ answeredCount }} / {{ questions.length }}</span
            >
          </div>

          <div class="rail-card" role="navigation" aria-label="答题卡">
            <button
              v-for="question in questions"
              :key="question.questionId"
              type="button"
              class="rail-cell exam-mono"
              :class="{
                'is-answered': taking.isAnswered(question.questionId),
                'is-flagged': flagged.has(question.questionId),
                'is-current':
                  mode === 'focus' && currentQuestionId === question.questionId
              }"
              :aria-label="`第 ${question.orderNo} 题${taking.isAnswered(question.questionId) ? ',已答' : ',未答'}`"
              @click="taking.enterFocus(question.questionId)"
            >
              {{ question.orderNo }}
            </button>
          </div>

          <div class="rail-legend">
            <span><i class="legend-dot is-answered" />已答</span>
            <span><i class="legend-dot" />未答</span>
            <span><i class="legend-dot is-flagged" />标记</span>
          </div>

          <button
            class="exam-btn is-outline-primary rail-submit"
            type="button"
            :disabled="submitting"
            @click="taking.confirmSubmit()"
          >
            {{ submitting ? "交卷中…" : "检查并交卷" }}
          </button>
        </div>
      </aside>

      <!-- 计时 v2:暂停层——计时冻结,遮住卷面,可安心离开 -->
      <div
        v-if="paused"
        class="take-paused-layer"
        role="dialog"
        aria-modal="true"
        aria-label="考试已暂停"
      >
        <div class="paused-card">
          <span class="exam-stamp is-azure paused-stamp"
            >已暂停 · 计时冻结</span
          >
          <div class="paused-remaining exam-mono">{{ remainingText }}</div>
          <div class="paused-remaining-label">剩余答题时长</div>
          <p v-if="pausedSyncOk" class="paused-hint">
            作答已同步到服务器。可以放心去忙,中途关掉页面、换台设备都没关系——回来点「继续答题」接着写。
          </p>
          <p v-else class="paused-hint is-warn">
            有作答还没同步到服务器(暂时只保存在本机)。这台设备的内容不会丢,恢复答题后会自动补同步;先别换设备作答。
          </p>
          <p v-if="pausedDeadlineText" class="paused-deadline">
            注意:{{ pausedDeadlineText }}
            截止,到点未交会按服务器已收到的作答强制收卷。
          </p>
          <button
            id="exam-paused-resume"
            class="exam-btn is-outline-primary paused-resume"
            type="button"
            :disabled="resuming"
            @click="taking.resume()"
          >
            {{ resuming ? "恢复中…" : "继续答题" }}
          </button>
          <button class="exam-link" type="button" @click="taking.backToMy()">
            先回「我的考试」
          </button>
        </div>
      </div>

      <!-- 窄屏底栏:单层操作带,随模式切换 -->
      <div class="take-mobile-bar" :class="{ 'is-focus': mode === 'focus' }">
        <template v-if="mode === 'focus'">
          <button
            class="exam-btn is-ghost is-small"
            type="button"
            :disabled="!hasPrev"
            @click="taking.goPrev()"
          >
            ← 上一题
          </button>
          <span
            class="mobile-timer exam-mono"
            :class="{ 'is-critical': timeCritical }"
          >
            {{ remainingText }}
          </span>
          <button
            v-if="hasTimeBudget && !paused"
            class="mobile-pause"
            type="button"
            :disabled="pausing"
            aria-label="暂停,冻结计时"
            title="暂停 · 冻结计时"
            @click="taking.pause()"
          >
            ‖
          </button>
          <button
            class="exam-btn is-ghost is-small"
            type="button"
            @click="cardOpen = true"
          >
            题卡
          </button>
          <button
            v-if="hasNext"
            class="exam-btn is-outline-primary is-small"
            type="button"
            @click="taking.goNext()"
          >
            下一题 →
          </button>
          <button
            v-else
            class="exam-btn is-outline-primary is-small"
            type="button"
            @click="taking.exitFocus()"
          >
            回卷面 →
          </button>
        </template>
        <template v-else>
          <span
            class="mobile-timer exam-mono"
            :class="{ 'is-critical': timeCritical }"
          >
            {{ remainingText }}
          </span>
          <button
            v-if="hasTimeBudget && !paused"
            class="mobile-pause"
            type="button"
            :disabled="pausing"
            aria-label="暂停,冻结计时"
            title="暂停 · 冻结计时"
            @click="taking.pause()"
          >
            ‖
          </button>
          <span class="mobile-progress exam-mono">
            {{ answeredCount }}/{{ questions.length }}
          </span>
          <button
            class="exam-btn is-ghost is-small"
            type="button"
            @click="cardOpen = true"
          >
            答题卡
          </button>
          <button
            class="exam-btn is-outline-primary is-small"
            type="button"
            :disabled="submitting"
            @click="taking.confirmSubmit()"
          >
            检查并交卷
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
