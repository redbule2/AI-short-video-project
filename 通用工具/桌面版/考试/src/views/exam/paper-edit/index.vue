<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute } from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  questionIssues,
  useExamPaperEdit,
  type EditableQuestion
} from "@/features/exam/useExamPaperEdit";
import ExamPublishDialog from "@/features/exam/components/ExamPublishDialog.vue";
import { ExamTypeLabels, type ExamQuestionType } from "@/api/exam";
import ExamQuestionGroupIntro from "@/features/exam/components/ExamQuestionGroupIntro.vue";
import {
  countMajorQuestions,
  isQuestionGroupStart,
  questionMajorNo
} from "@/features/exam/questionGroups";
import { message } from "@/utils/message";
import "../exam-shared.css";
import "./index.css";

defineOptions({ name: "ExamPaperEdit" });

const route = useRoute();
const edit = useExamPaperEdit();
const {
  loading,
  notFound,
  saving,
  status,
  readonly,
  title,
  description,
  durationMinutes,
  passScore,
  revealPolicy,
  questions,
  totalScore,
  dirty
} = edit;

const publishDialog = ref<InstanceType<typeof ExamPublishDialog> | null>(null);

// ==========================================================================
// 双模式视图状态【2026-07-25 用户裁决】:overview=只读校样(看整卷,不可改);
// focus=逐题编辑(唯一编辑通道,一次只面对一题;卷面信息也走专注编辑)。
// 纯视图层状态,留在组件里——useExamPaperEdit 的数据契约与预算测试不动。
// ==========================================================================

const mode = ref<"overview" | "focus">("overview");
const focusKind = ref<"question" | "meta">("question");
const focusLocalId = ref<number | null>(null);
/** 被删题后就近落位用:记住最后一次有效的焦点序号。 */
const lastFocusIndex = ref(0);

const focusIndex = computed(() =>
  questions.value.findIndex(q => q.localId === focusLocalId.value)
);
const focusQuestion = computed(() =>
  focusIndex.value >= 0 ? questions.value[focusIndex.value] : null
);
const hasPrev = computed(() => focusIndex.value > 0);
const hasNext = computed(
  () => focusIndex.value >= 0 && focusIndex.value < questions.value.length - 1
);

watch(focusIndex, index => {
  if (index >= 0) lastFocusIndex.value = index;
});

/** 焦点题被删除:就近落到下一题;整卷删空则回总览。 */
watch([focusQuestion, questions], () => {
  if (mode.value !== "focus" || focusKind.value !== "question") return;
  if (focusQuestion.value) return;
  if (questions.value.length === 0) {
    mode.value = "overview";
    return;
  }
  const index = Math.min(lastFocusIndex.value, questions.value.length - 1);
  focusLocalId.value = questions.value[index].localId;
});

/** 换屏后把焦点送到题头(非输入元素:←/→ 键立即可用,输入时不劫持)。 */
function focusHead() {
  requestAnimationFrame(() => {
    document.getElementById("pe-focus-head")?.focus({ preventScroll: true });
  });
}

function enterQuestion(localId: number) {
  focusKind.value = "question";
  focusLocalId.value = localId;
  mode.value = "focus";
  window.scrollTo({ top: 0 });
  focusHead();
}

function enterMeta() {
  focusKind.value = "meta";
  mode.value = "focus";
  window.scrollTo({ top: 0 });
  focusHead();
}

/** 回总览,并把刚编辑的题滚到视野中央(位置不迷路)。 */
function exitFocus() {
  const anchorId =
    focusKind.value === "question" && focusLocalId.value !== null
      ? `pe-q-${focusLocalId.value}`
      : "pe-cover";
  mode.value = "overview";
  requestAnimationFrame(() => {
    document.getElementById(anchorId)?.scrollIntoView({ block: "center" });
  });
}

function goPrev() {
  if (!hasPrev.value) return;
  focusLocalId.value = questions.value[focusIndex.value - 1].localId;
  window.scrollTo({ top: 0 });
  focusHead();
}

function goNext() {
  if (!hasNext.value) return;
  focusLocalId.value = questions.value[focusIndex.value + 1].localId;
  window.scrollTo({ top: 0 });
  focusHead();
}

/** 加题即入席:新题直接进入逐题编辑(总览不提供任何编辑)。 */
function addAndEdit(type: ExamQuestionType) {
  if (readonly.value) return;
  const created = edit.addQuestion(type);
  enterQuestion(created.localId);
}

// ---------- 保存/发布(带缺项定位) ----------

/** 第一处缺项:标题缺→卷面信息;否则第一道有缺项的题。返回是否有缺项。 */
function jumpToFirstProblem(): boolean {
  if (!title.value.trim()) {
    enterMeta();
    return true;
  }
  const bad = questions.value.find(q => questionIssues(q).length > 0);
  if (bad) {
    enterQuestion(bad.localId);
    return true;
  }
  return false;
}

async function saveNow() {
  const saved = await edit.save();
  if (!saved && !saving.value) jumpToFirstProblem();
}

/** 发布【计时 v2】:缺项定位 → 保存 → 弹窗指定考试截止时间与考生。 */
async function publishNow() {
  if (questions.value.length === 0) {
    message("试卷还没有题目,先加题再发布。", { type: "warning" });
    return;
  }
  if (jumpToFirstProblem()) {
    message("卷面还有缺项,已带你到第一处;补齐后再发布。", { type: "warning" });
    return;
  }
  const saved = await edit.save(); // 锁定的是已保存的题,发布前必先落库
  if (!saved) return;
  publishDialog.value?.open({
    paperId: edit.paperId.value,
    title: title.value,
    questionCount: questions.value.length,
    totalScore: totalScore.value
  });
}

// ---------- 键盘:←/→ 翻题、Esc 回总览、Ctrl+S 保存(输入中不劫持方向键) ----------

function handleKeydown(event: KeyboardEvent) {
  if (
    (event.ctrlKey || event.metaKey) &&
    (event.key === "s" || event.key === "S")
  ) {
    event.preventDefault();
    if (!readonly.value && !loading.value) void saveNow();
    return;
  }
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const target = event.target as HTMLElement | null;
  // Esc 单独前置:输入框里也能一键回总览(先收起焦点再退场)【sol 应改#2】;
  // 弹层内仍不劫持(弹层自己消费 Esc)
  if (
    event.key === "Escape" &&
    !target?.closest(".el-overlay, .el-message-box")
  ) {
    if (mode.value === "focus") {
      target?.blur?.();
      exitFocus();
      event.preventDefault();
    }
    return;
  }
  if (
    target?.closest(
      "input, textarea, [contenteditable], .el-overlay, .el-message-box"
    )
  )
    return;
  if (mode.value !== "focus" || focusKind.value !== "question") return;
  if (event.key === "ArrowLeft") {
    goPrev();
    event.preventDefault();
  } else if (event.key === "ArrowRight") {
    goNext();
    event.preventDefault();
  }
}

/** 浏览器刷新/关标签的丢改动保护(路由守卫管不到这两条路)【sol 应改#1】。 */
function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!dirty.value || readonly.value) return;
  event.preventDefault();
  event.returnValue = "";
}

onMounted(() => {
  if (String(route.query.setup ?? "") === "rules") {
    enterMeta();
  }
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("beforeunload", handleBeforeUnload);
  }
});

onBeforeUnmount(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  }
});

// ---------- 稿纸 textarea 随内容自动加高 ----------

function grow(el: HTMLTextAreaElement) {
  if (!el?.style) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

const vGrow = {
  mounted: grow,
  updated: grow
};

// ---------- 数值字段(原生输入,空串→null 语义) ----------

function setDuration(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  durationMinutes.value =
    raw === "" ? null : Math.max(1, Math.floor(Number(raw)));
  edit.markDirty();
}

function setPassScore(event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  passScore.value = raw === "" ? null : Math.max(0, Math.floor(Number(raw)));
  edit.markDirty();
}

function setScore(question: EditableQuestion, event: Event) {
  const raw = (event.target as HTMLInputElement).value;
  question.score =
    raw === "" ? 0 : Math.min(100, Math.max(1, Math.floor(Number(raw))));
  edit.markDirty();
}

// ---------- 正确答案标记(朱砂即定) ----------

function markSingle(question: EditableQuestion, key: string) {
  question.singleAnswer = question.singleAnswer === key ? "" : key;
  edit.markDirty();
}

function markMultiple(question: EditableQuestion, key: string) {
  question.multipleAnswers = question.multipleAnswers.includes(key)
    ? question.multipleAnswers.filter(item => item !== key)
    : [...question.multipleAnswers, key];
  edit.markDirty();
}

function markJudge(question: EditableQuestion, value: boolean) {
  question.judgeAnswer = value;
  edit.markDirty();
}

function isCorrectOption(question: EditableQuestion, key: string) {
  return question.type === "single"
    ? question.singleAnswer === key
    : question.multipleAnswers.includes(key);
}

// ---------- 题干配图 ----------

function onStemImagePick(question: EditableQuestion, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (file) {
    void edit.uploadStemImage(question, file);
  }
}

// ---------- 总览展示辅助 ----------

const typeChoices: ExamQuestionType[] = [
  "single",
  "multiple",
  "judge",
  "fillBlank",
  "essay",
  "practical"
];

const groupDrawerVisible = ref(false);
const groupEditor = ref({ id: "", title: "", caseText: "" });

function openGroupEditor(question: (typeof questions.value)[number]) {
  if (!question.group) return;
  groupEditor.value = {
    id: question.group.id,
    title: question.group.title,
    caseText: question.group.caseText ?? ""
  };
  groupDrawerVisible.value = true;
}

function createGroup(question: (typeof questions.value)[number]) {
  edit.createQuestionGroup(question.localId);
  openGroupEditor(question);
}

function saveGroupEditor() {
  try {
    edit.updateQuestionGroup(
      groupEditor.value.id,
      groupEditor.value.title,
      groupEditor.value.caseText
    );
    groupDrawerVisible.value = false;
  } catch (error) {
    void ElMessageBox.alert(
      error instanceof Error ? error.message : "大题信息保存失败。",
      "请检查大题信息"
    );
  }
}

function removeCurrentGroup() {
  void ElMessageBox.confirm(
    "移除后，同组子题会保留并恢复为独立大题。",
    "移除大题分组？",
    {
      confirmButtonText: "移除分组",
      cancelButtonText: "取消",
      type: "warning"
    }
  )
    .then(() => {
      edit.removeQuestionGroup(groupEditor.value.id);
      groupDrawerVisible.value = false;
    })
    .catch(() => undefined);
}

const incompleteCount = computed(
  () => questions.value.filter(q => questionIssues(q).length > 0).length
);

const metaSummary = computed(() => {
  const parts = [
    passScore.value !== null ? `及格 ${passScore.value} 分` : "不设及格线",
    revealPolicy.value === "onSubmit" ? "答案交卷即看" : "答案手动公布"
  ];
  return parts.join(" · ");
});

function issuesText(question: EditableQuestion) {
  const issues = questionIssues(question);
  return issues.length ? `缺:${issues.join("、")}` : "";
}

/** 离开守卫:未保存改动提示(提交失败保留输入的姊妹条款)。 */
onBeforeRouteLeave(async () => {
  if (!dirty.value || readonly.value) return true;
  try {
    await ElMessageBox.confirm("题目还没保存,直接离开会丢失改动。", "未保存", {
      confirmButtonText: "留下保存",
      cancelButtonText: "放弃改动离开",
      type: "warning"
    });
    // 按钮写"留下保存"就真的保存(说到做到)【sol 应改#1】;失败则留在页内改
    void saveNow();
    return false;
  } catch {
    return true;
  }
});
</script>

<template>
  <div class="exam-page paper-edit-page">
    <div class="pe-layout">
      <section class="exam-sheet pe-sheet">
        <!-- ===== 加载 / 缺卷 ===== -->
        <template v-if="loading">
          <div v-for="i in 6" :key="i" class="exam-skeleton" />
        </template>

        <div v-else-if="notFound" class="exam-error">
          <div class="icon">✕</div>
          <div class="lead">试卷不存在或已删除</div>
          <button
            class="exam-btn is-ghost"
            type="button"
            @click="edit.backToPapers()"
          >
            返回试卷管理
          </button>
        </div>

        <!-- ===== 总览:整卷只读校样,点任意一处进入逐题编辑 ===== -->
        <template v-else-if="mode === 'overview'">
          <header class="exam-sheet-head">
            <div>
              <h1 class="exam-title">出题工作台</h1>
              <div class="exam-subtitle">
                总览是只读校样——点卷头或任意一题,进入逐题编辑
              </div>
            </div>
            <div class="pe-head-right">
              <span
                class="exam-stamp"
                :class="
                  status === '已发布'
                    ? 'is-jade'
                    : status === '草稿'
                      ? 'is-azure'
                      : ''
                "
              >
                {{ status }}
              </span>
              <button
                class="exam-link"
                type="button"
                @click="edit.backToPapers()"
              >
                返回试卷管理
              </button>
            </div>
          </header>

          <div v-if="readonly" class="pe-readonly-banner">
            已发布的试卷只读;要改题请先
            <button class="exam-link" type="button" @click="edit.revert()">
              撤回为草稿
            </button>
            (未开考的指派会一并撤销)。
          </div>

          <!-- 卷头(标题/说明/规则):点击进入卷面信息编辑 -->
          <div id="pe-cover" class="pe-cover">
            <button
              type="button"
              class="pe-cover-main"
              :aria-label="readonly ? '查看卷面信息' : '编辑卷面信息'"
              @click="enterMeta()"
            >
              <span class="pe-cover-head">
                <span
                  class="pe-cover-title"
                  :class="{ 'is-empty': !title.trim() }"
                >
                  {{ title.trim() || "未命名试卷" }}
                </span>
                <span class="pe-cover-invite">{{
                  readonly ? "查看规则 →" : "设置时长与规则 →"
                }}</span>
              </span>
              <span v-if="description.trim()" class="pe-cover-desc">{{
                description
              }}</span>
              <span class="pe-cover-meta">
                <span
                  class="pe-cover-duration"
                  :class="{ 'is-unset': durationMinutes === null }"
                >
                  {{
                    durationMinutes
                      ? `考试时长 ${durationMinutes} 分钟`
                      : "考试时长 不限时（点击设置）"
                  }}
                </span>
                <span>{{ metaSummary }}</span>
                <span class="exam-mono"
                  >共 {{ questions.length }} 题 · 总分 {{ totalScore }}</span
                >
                <span
                  v-if="!readonly && incompleteCount > 0"
                  class="pe-cover-lack"
                >
                  {{ incompleteCount }} 题有缺项
                </span>
              </span>
            </button>
          </div>

          <!-- 题目清单(只读) -->
          <div v-if="questions.length === 0" class="exam-empty">
            <div class="icon">✎</div>
            <div class="lead">还没有题目</div>
            <div class="hint">
              从下方选择题型加题——新题会直接进入逐题编辑;也可让 AI
              经导入接口整卷出题。
            </div>
          </div>

          <ol v-else class="pe-ov-list">
            <li
              v-for="(question, index) in questions"
              :id="`pe-q-${question.localId}`"
              :key="question.localId"
              class="pe-ov-item"
            >
              <ExamQuestionGroupIntro
                v-if="question.group && isQuestionGroupStart(questions, index)"
                :group="question.group"
                :major-no="questionMajorNo(questions, index)"
                compact
              />
              <button
                type="button"
                class="pe-ov-q"
                :aria-label="`第 ${index + 1} 题,${ExamTypeLabels[question.type]},${readonly ? '点击查看' : '点击进入编辑'}`"
                @click="enterQuestion(question.localId)"
              >
                <span class="pe-ov-head">
                  <span class="pe-ov-no exam-mono">
                    {{ question.group?.subQuestionNo ?? index + 1 }}
                  </span>
                  <span v-if="question.group" class="exam-stamp is-azure">
                    子题
                  </span>
                  <span class="exam-stamp">{{
                    ExamTypeLabels[question.type]
                  }}</span>
                  <span class="pe-ov-score exam-mono"
                    >{{ question.score }} 分</span
                  >
                  <span
                    v-if="!readonly && issuesText(question)"
                    class="pe-ov-issues"
                  >
                    {{ issuesText(question) }}
                  </span>
                  <span class="pe-ov-invite">{{
                    readonly ? "查看 →" : "改这题 →"
                  }}</span>
                </span>

                <span
                  class="pe-ov-stem"
                  :class="{ 'is-empty': !question.stem.trim() }"
                >
                  {{ question.stem.trim() || "(题干未填)" }}
                </span>

                <span v-if="question.stemImages.length" class="pe-ov-images">
                  <img
                    v-for="image in question.stemImages"
                    :key="image.url"
                    :src="image.url"
                    :alt="image.name || '题干配图'"
                    loading="lazy"
                  />
                </span>

                <!-- 选择题:正确项落朱砂 -->
                <span
                  v-if="
                    question.type === 'single' || question.type === 'multiple'
                  "
                  class="pe-ov-opts"
                >
                  <span
                    v-for="option in question.options"
                    :key="option.key"
                    class="pe-ov-opt"
                    :class="{
                      'is-correct': isCorrectOption(question, option.key)
                    }"
                  >
                    <span
                      class="pe-ov-opt-mark exam-mono"
                      :class="{ 'is-square': question.type === 'multiple' }"
                    >
                      {{ option.key }}
                    </span>
                    <span
                      class="pe-ov-opt-text"
                      :class="{ 'is-empty': !option.text.trim() }"
                    >
                      {{ option.text.trim() || "(未填)" }}
                    </span>
                  </span>
                </span>

                <!-- 判断:正确一侧落朱砂 -->
                <span
                  v-else-if="question.type === 'judge'"
                  class="pe-ov-opts is-judge"
                >
                  <span
                    class="pe-ov-opt"
                    :class="{ 'is-correct': question.judgeAnswer === true }"
                  >
                    <span class="pe-ov-opt-mark is-word">对</span>
                  </span>
                  <span
                    class="pe-ov-opt"
                    :class="{ 'is-correct': question.judgeAnswer === false }"
                  >
                    <span class="pe-ov-opt-mark is-word">错</span>
                  </span>
                </span>

                <!-- 填空:各空参考答案 -->
                <span
                  v-else-if="question.type === 'fillBlank'"
                  class="pe-ov-lines"
                >
                  <span
                    v-for="(blank, blankIndex) in question.blankAnswers"
                    :key="blankIndex"
                    class="pe-ov-line"
                  >
                    <span class="pe-ov-line-label"
                      >空 {{ blankIndex + 1 }}</span
                    >
                    <span
                      class="pe-ov-line-value"
                      :class="{ 'is-empty': !blank.trim() }"
                    >
                      {{ blank.trim() || "(未填)" }}
                    </span>
                  </span>
                </span>

                <!-- 简答/实操:参考答案(评分标准)摘要 -->
                <span v-else class="pe-ov-lines">
                  <span class="pe-ov-line">
                    <span class="pe-ov-line-label">
                      {{
                        question.type === "practical" ? "评分标准" : "参考答案"
                      }}
                    </span>
                    <span
                      class="pe-ov-line-value is-clamp"
                      :class="{ 'is-empty': !question.essayReference.trim() }"
                    >
                      {{ question.essayReference.trim() || "(未填)" }}
                    </span>
                  </span>
                </span>

                <span class="pe-ov-lines">
                  <span class="pe-ov-line">
                    <span class="pe-ov-line-label">解析</span>
                    <span
                      class="pe-ov-line-value is-clamp is-analysis"
                      :class="{ 'is-empty': !question.analysis.trim() }"
                    >
                      {{ question.analysis.trim() || "(未填)" }}
                    </span>
                  </span>
                </span>
              </button>
            </li>
          </ol>

          <!-- 加题:选题型即入席 -->
          <div v-if="!readonly" class="pe-add-row">
            <span class="pe-add-label">加一题,直接开写:</span>
            <button
              v-for="type in typeChoices"
              :key="type"
              class="exam-btn is-ghost is-small"
              type="button"
              @click="addAndEdit(type)"
            >
              {{ ExamTypeLabels[type] }}
            </button>
          </div>
        </template>

        <!-- ===== 专注编辑:卷面信息 ===== -->
        <template v-else-if="focusKind === 'meta'">
          <header class="pe-focus-head">
            <button
              class="exam-link pe-focus-exit"
              type="button"
              @click="exitFocus()"
            >
              ← 回卷面总览
            </button>
            <span id="pe-focus-head" tabindex="-1" class="pe-focus-pos"
              >卷面信息</span
            >
            <span class="pe-focus-hint">标题、说明与考试规则</span>
          </header>

          <label class="pe-caption" for="pe-meta-title">试卷标题 *</label>
          <input
            id="pe-meta-title"
            v-model="title"
            class="pe-title-input"
            type="text"
            maxlength="200"
            :disabled="readonly"
            placeholder="给这张卷起个名字"
            @input="edit.markDirty()"
          />

          <label class="pe-caption" for="pe-meta-desc">
            说明
            <span class="pe-caption-note">考试范围、注意事项;考生考前可见</span>
          </label>
          <textarea
            id="pe-meta-desc"
            v-model="description"
            v-grow
            class="pe-textarea"
            rows="3"
            maxlength="1000"
            :disabled="readonly"
            placeholder="写点考试范围、注意事项…"
            @input="edit.markDirty()"
          />

          <div class="pe-meta-grid">
            <label class="pe-meta-field">
              <span class="pe-caption">
                考试时长（分钟）
                <span class="pe-caption-note">留空表示不限时</span>
              </span>
              <input
                class="pe-num"
                type="number"
                min="1"
                max="600"
                :value="durationMinutes ?? ''"
                :disabled="readonly"
                placeholder="不限"
                @input="setDuration($event)"
              />
              <span class="pe-meta-help">
                从考生点「开始考试 / 继续答题」后，按实际作答时间计算。
              </span>
            </label>
            <label class="pe-meta-field">
              <span class="pe-caption">及格分</span>
              <input
                class="pe-num"
                type="number"
                min="0"
                :value="passScore ?? ''"
                :disabled="readonly"
                placeholder="不设"
                @input="setPassScore($event)"
              />
            </label>
            <div class="pe-meta-field">
              <span class="pe-caption">答案公布</span>
              <div class="pe-choice">
                <button
                  type="button"
                  class="pe-choice-btn"
                  :class="{ 'is-on': revealPolicy === 'onSubmit' }"
                  :disabled="readonly"
                  @click="
                    revealPolicy = 'onSubmit';
                    edit.markDirty();
                  "
                >
                  交卷即看
                </button>
                <button
                  type="button"
                  class="pe-choice-btn"
                  :class="{ 'is-on': revealPolicy === 'manual' }"
                  :disabled="readonly"
                  @click="
                    revealPolicy = 'manual';
                    edit.markDirty();
                  "
                >
                  手动公布
                </button>
              </div>
            </div>
          </div>

          <footer class="pe-focus-footer is-single">
            <button
              class="exam-btn is-ghost"
              type="button"
              @click="exitFocus()"
            >
              回卷面总览
            </button>
          </footer>
        </template>

        <!-- ===== 专注编辑:一次只改一题 ===== -->
        <template v-else-if="focusQuestion">
          <div :key="focusQuestion.localId" class="pe-focus">
            <ExamQuestionGroupIntro
              v-if="focusQuestion.group"
              :group="focusQuestion.group"
              :major-no="questionMajorNo(questions, focusIndex)"
              compact
            />
            <header class="pe-focus-head">
              <button
                class="exam-link pe-focus-exit"
                type="button"
                @click="exitFocus()"
              >
                ← 回卷面总览
              </button>
              <span id="pe-focus-head" tabindex="-1" class="pe-focus-pos">
                <template v-if="focusQuestion.group">
                  第
                  <span class="exam-mono">{{
                    questionMajorNo(questions, focusIndex)
                  }}</span>
                  大题 · 子题
                  <span class="exam-mono">{{
                    focusQuestion.group.subQuestionNo
                  }}</span>
                </template>
                <template v-else>
                  第 <span class="exam-mono">{{ focusIndex + 1 }}</span> 题
                </template>
                <span class="pe-focus-total"
                  >/ 共 {{ questions.length }} 题</span
                >
              </span>
              <span class="exam-stamp">{{
                ExamTypeLabels[focusQuestion.type]
              }}</span>
              <label class="pe-score">
                <input
                  class="pe-num is-score"
                  type="number"
                  min="1"
                  max="100"
                  :value="focusQuestion.score || ''"
                  :disabled="readonly"
                  aria-label="本题分值"
                  @input="setScore(focusQuestion, $event)"
                />
                <span class="pe-score-unit">分</span>
              </label>
              <span v-if="!readonly" class="pe-focus-tools">
                <button
                  v-if="focusQuestion.group"
                  class="exam-link"
                  type="button"
                  @click="openGroupEditor(focusQuestion)"
                >
                  编辑大题
                </button>
                <button
                  v-if="!focusQuestion.group"
                  class="exam-link"
                  type="button"
                  @click="createGroup(focusQuestion)"
                >
                  设为大题
                </button>
                <button
                  v-if="
                    !focusQuestion.group && questions[focusIndex - 1]?.group
                  "
                  class="exam-link"
                  type="button"
                  @click="edit.joinPreviousQuestionGroup(focusQuestion.localId)"
                >
                  并入上一大题
                </button>
                <button
                  class="exam-link"
                  type="button"
                  :disabled="!hasPrev"
                  title="上移一位"
                  @click="edit.moveQuestion(focusQuestion.localId, -1)"
                >
                  ↑ 上移
                </button>
                <button
                  class="exam-link"
                  type="button"
                  :disabled="!hasNext"
                  title="下移一位"
                  @click="edit.moveQuestion(focusQuestion.localId, 1)"
                >
                  ↓ 下移
                </button>
                <button
                  class="exam-link is-danger"
                  type="button"
                  @click="edit.removeQuestion(focusQuestion.localId)"
                >
                  删除
                </button>
              </span>
            </header>

            <p
              v-if="!readonly && questionIssues(focusQuestion).length"
              class="pe-issue-hint"
            >
              本题还缺:{{ questionIssues(focusQuestion).join("、") }}
            </p>

            <label class="pe-caption" :for="`pe-stem-${focusQuestion.localId}`"
              >题干 *</label
            >
            <textarea
              :id="`pe-stem-${focusQuestion.localId}`"
              v-model="focusQuestion.stem"
              v-grow
              class="pe-stem-input"
              rows="2"
              :disabled="readonly"
              placeholder="在此写题干…"
              @input="edit.markDirty()"
            />

            <!-- 题干配图(全题型可配,≤4 张) -->
            <div class="pe-images">
              <figure
                v-for="image in focusQuestion.stemImages"
                :key="image.url"
                class="pe-image"
              >
                <a :href="image.url" target="_blank" rel="noopener">
                  <img
                    :src="image.url"
                    :alt="image.name || '题干配图'"
                    loading="lazy"
                  />
                </a>
                <button
                  v-if="!readonly"
                  class="pe-image-remove"
                  type="button"
                  :aria-label="`移除配图 ${image.name || ''}`"
                  @click="edit.removeStemImage(focusQuestion, image.url)"
                >
                  ✕
                </button>
              </figure>
              <label
                v-if="!readonly && focusQuestion.stemImages.length < 4"
                class="pe-image-add"
                :class="{ 'is-busy': edit.stemUploadingCount.value > 0 }"
              >
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  class="pe-image-input"
                  @change="onStemImagePick(focusQuestion, $event)"
                />
                <span>{{
                  edit.stemUploadingCount.value > 0 ? "上传中…" : "＋ 配图"
                }}</span>
              </label>
            </div>

            <!-- 选择题:选项即题纸行,点字母圈=朱砂标记正确答案 -->
            <template
              v-if="
                focusQuestion.type === 'single' ||
                focusQuestion.type === 'multiple'
              "
            >
              <div class="pe-caption">
                选项与正确答案 *
                <span class="pe-caption-note">
                  点字母{{ focusQuestion.type === "single" ? "圈" : "框" }} =
                  标记正确答案
                  {{ focusQuestion.type === "multiple" ? "(可多选)" : "" }}
                </span>
              </div>
              <div class="pe-opts">
                <div
                  v-for="option in focusQuestion.options"
                  :key="option.key"
                  class="pe-opt"
                >
                  <button
                    type="button"
                    class="pe-opt-mark exam-mono"
                    :class="{
                      'is-square': focusQuestion.type === 'multiple',
                      'is-correct': isCorrectOption(focusQuestion, option.key)
                    }"
                    :disabled="readonly"
                    :aria-pressed="isCorrectOption(focusQuestion, option.key)"
                    :aria-label="`选项 ${option.key} ${isCorrectOption(focusQuestion, option.key) ? '是' : '不是'}正确答案`"
                    @click="
                      focusQuestion.type === 'single'
                        ? markSingle(focusQuestion, option.key)
                        : markMultiple(focusQuestion, option.key)
                    "
                  >
                    {{ option.key }}
                  </button>
                  <input
                    v-model="option.text"
                    class="pe-opt-input"
                    type="text"
                    :disabled="readonly"
                    :placeholder="`选项 ${option.key} 内容`"
                    @input="edit.markDirty()"
                  />
                  <button
                    v-if="!readonly"
                    class="exam-link is-danger pe-opt-remove"
                    type="button"
                    :disabled="focusQuestion.options.length <= 2"
                    @click="edit.removeOption(focusQuestion, option.key)"
                  >
                    移除
                  </button>
                </div>
                <div v-if="!readonly" class="pe-opt-tools">
                  <button
                    class="exam-link"
                    type="button"
                    :disabled="focusQuestion.options.length >= 8"
                    @click="edit.addOption(focusQuestion)"
                  >
                    + 加选项
                  </button>
                </div>
              </div>
            </template>

            <!-- 判断:对/错点选即定 -->
            <template v-else-if="focusQuestion.type === 'judge'">
              <div class="pe-caption">正确答案 *</div>
              <div class="pe-choice is-answer">
                <button
                  type="button"
                  class="pe-choice-btn"
                  :class="{ 'is-on': focusQuestion.judgeAnswer === true }"
                  :disabled="readonly"
                  @click="markJudge(focusQuestion, true)"
                >
                  对
                </button>
                <button
                  type="button"
                  class="pe-choice-btn"
                  :class="{ 'is-on': focusQuestion.judgeAnswer === false }"
                  :disabled="readonly"
                  @click="markJudge(focusQuestion, false)"
                >
                  错
                </button>
              </div>
            </template>

            <!-- 填空:各空参考答案写在横线上 -->
            <template v-else-if="focusQuestion.type === 'fillBlank'">
              <div class="pe-caption">
                各空参考答案 * <span class="pe-caption-note">AI 判分参考</span>
              </div>
              <!-- 题干里画横线,考生就能在句子里当场填(横线数与空数一致才内嵌) -->
              <p class="pe-hint">
                在题干里用连续下划线
                <code>______</code>
                标出空位(条数与下面的空数一致),考生就能直接写在句子里;横线画多长,空位起手就多宽(考生写长了会自动撑开)。不写也行,系统会把空排在题干下面。
              </p>
              <div class="pe-blanks">
                <div
                  v-for="(blank, blankIndex) in focusQuestion.blankAnswers"
                  :key="blankIndex"
                  class="pe-blank"
                >
                  <span class="pe-blank-no exam-mono"
                    >空 {{ blankIndex + 1 }}</span
                  >
                  <input
                    v-model="focusQuestion.blankAnswers[blankIndex]"
                    class="pe-blank-input"
                    type="text"
                    :disabled="readonly"
                    placeholder="参考答案"
                    @input="edit.markDirty()"
                  />
                  <button
                    v-if="!readonly"
                    class="exam-link is-danger pe-opt-remove"
                    type="button"
                    :disabled="focusQuestion.blankAnswers.length <= 1"
                    @click="edit.removeBlank(focusQuestion, blankIndex)"
                  >
                    移除
                  </button>
                </div>
                <div v-if="!readonly" class="pe-opt-tools">
                  <button
                    class="exam-link"
                    type="button"
                    @click="edit.addBlank(focusQuestion)"
                  >
                    + 加一空
                  </button>
                </div>
              </div>
            </template>

            <!-- 简答参考答案 / 实操评分标准 -->
            <template v-else>
              <label
                class="pe-caption"
                :for="`pe-ref-${focusQuestion.localId}`"
              >
                {{
                  focusQuestion.type === "practical"
                    ? "评分标准 *"
                    : "参考答案 *"
                }}
                <span class="pe-caption-note">
                  {{
                    focusQuestion.type === "practical"
                      ? "考生按题干上传图片,AI 拉图对照此标准评分;复盘可见"
                      : "AI 判分依据;考生复盘可见"
                  }}
                </span>
              </label>
              <textarea
                :id="`pe-ref-${focusQuestion.localId}`"
                v-model="focusQuestion.essayReference"
                v-grow
                class="pe-textarea"
                rows="3"
                :disabled="readonly"
                :placeholder="
                  focusQuestion.type === 'practical'
                    ? '写下评分标准:满分条件、扣分点…'
                    : '写下参考答案:AI 按它判分…'
                "
                @input="edit.markDirty()"
              />
            </template>

            <label
              class="pe-caption"
              :for="`pe-analysis-${focusQuestion.localId}`"
            >
              解析 *
              <span class="pe-caption-note">考生复盘时可见;可写评分要点</span>
            </label>
            <textarea
              :id="`pe-analysis-${focusQuestion.localId}`"
              v-model="focusQuestion.analysis"
              v-grow
              class="pe-textarea"
              rows="3"
              :disabled="readonly"
              placeholder="写下解析:为什么答案是这个…"
              @input="edit.markDirty()"
            />

            <footer class="pe-focus-footer">
              <button
                class="exam-btn is-ghost"
                type="button"
                :disabled="!hasPrev"
                @click="goPrev()"
              >
                ← 上一题
              </button>
              <button class="exam-link" type="button" @click="exitFocus()">
                回卷面总览
              </button>
              <button
                v-if="hasNext"
                class="exam-btn is-outline-primary"
                type="button"
                @click="goNext()"
              >
                下一题 →
              </button>
              <button
                v-else-if="!readonly"
                class="exam-btn is-outline-primary"
                type="button"
                @click="exitFocus()"
              >
                回卷面检查
              </button>
              <button
                v-else
                class="exam-btn is-ghost"
                type="button"
                @click="exitFocus()"
              >
                回卷面总览
              </button>
            </footer>
            <p class="pe-shortcut-hint" aria-hidden="true">
              Esc 回总览 · ← → 翻题 · Ctrl+S 保存
            </p>
          </div>
        </template>
      </section>

      <!-- ===== 桌沿题卡:全卷缩影 + 保存/发布(两种模式常驻) ===== -->
      <aside
        v-if="!loading && !notFound"
        class="pe-rail"
        role="complementary"
        aria-label="题卡与保存"
      >
        <div class="pe-rail-inner">
          <div class="pe-rail-head">
            <span class="pe-rail-label">题卡</span>
            <span class="pe-rail-sum exam-mono">
              {{ countMajorQuestions(questions) }} 大题 ·
              {{ questions.length }} 子题 · {{ totalScore }} 分
            </span>
          </div>

          <button
            type="button"
            class="pe-rail-meta"
            :class="{ 'is-current': mode === 'focus' && focusKind === 'meta' }"
            @click="enterMeta()"
          >
            卷面信息
          </button>

          <div class="pe-rail-card" role="navigation" aria-label="题卡导航">
            <button
              v-for="(question, index) in questions"
              :key="question.localId"
              type="button"
              class="pe-cell exam-mono"
              :class="{
                'is-complete': questionIssues(question).length === 0,
                'is-current':
                  mode === 'focus' &&
                  focusKind === 'question' &&
                  focusLocalId === question.localId
              }"
              :aria-label="`第 ${index + 1} 题,${questionIssues(question).length === 0 ? '已齐' : '有缺项'}`"
              @click="enterQuestion(question.localId)"
            >
              {{ index + 1 }}
            </button>
          </div>

          <div v-if="!readonly" class="pe-rail-legend">
            <span><i class="pe-dot is-complete" />已齐</span>
            <span><i class="pe-dot" />有缺项</span>
          </div>

          <!-- 加题常驻桌沿:长卷不必滚到卷末【sol 必改#3】 -->
          <div v-if="!readonly" class="pe-rail-add">
            <span class="pe-rail-add-label">＋ 加一题,直接开写</span>
            <div class="pe-rail-add-grid">
              <button
                v-for="type in typeChoices"
                :key="type"
                type="button"
                class="pe-rail-add-btn"
                @click="addAndEdit(type)"
              >
                {{ ExamTypeLabels[type] }}
              </button>
            </div>
          </div>

          <div class="pe-rail-dirty" :class="{ 'is-dirty': dirty }">
            {{
              readonly ? "已发布 · 只读" : dirty ? "有未保存改动" : "改动已保存"
            }}
          </div>

          <div v-if="!readonly" class="pe-rail-actions">
            <button
              class="exam-btn is-primary pe-rail-btn"
              type="button"
              :disabled="saving"
              @click="saveNow()"
            >
              {{ saving ? "保存中…" : "保存" }}
            </button>
            <button
              class="exam-btn is-ghost pe-rail-btn"
              type="button"
              :disabled="questions.length === 0"
              @click="publishNow()"
            >
              发布
            </button>
          </div>
        </div>
      </aside>
    </div>

    <!-- 窄屏底栏:统计 + 保存/发布 -->
    <div v-if="!loading && !notFound" class="pe-mobile-bar">
      <span class="pe-mobile-sum exam-mono">
        {{ countMajorQuestions(questions) }} 大题 · {{ questions.length }} 子题
        · {{ totalScore }} 分
      </span>
      <span v-if="dirty && !readonly" class="pe-mobile-dirty">未保存</span>
      <template v-if="!readonly">
        <button
          class="exam-btn is-ghost is-small"
          type="button"
          :disabled="questions.length === 0"
          @click="publishNow()"
        >
          发布
        </button>
        <button
          class="exam-btn is-primary is-small"
          type="button"
          :disabled="saving"
          @click="saveNow()"
        >
          {{ saving ? "保存中…" : "保存" }}
        </button>
      </template>
    </div>

    <el-drawer
      v-model="groupDrawerVisible"
      class="exam-group-drawer"
      title="大题共享案例"
      size="520px"
    >
      <el-scrollbar class="exam-group-drawer-scroll">
        <div class="exam-group-form">
          <label class="meta-field">
            <span class="meta-label">大题标题 *</span>
            <el-input
              v-model="groupEditor.title"
              maxlength="200"
              placeholder="例如：第一人称女孩牵狗"
            />
          </label>
          <label class="meta-field">
            <span class="meta-label">共享案例 / 原始提示词</span>
            <el-input
              v-model="groupEditor.caseText"
              type="textarea"
              :autosize="{ minRows: 6, maxRows: 16 }"
              maxlength="4000"
              show-word-limit
              placeholder="只写同组子题共同使用的人物、场景或原始提示词。"
            />
          </label>
          <p class="edit-q-hint">
            组内每个子题仍独立计分；标题和案例只展示一次，保存时不会新增请求或数据库查询。
          </p>
        </div>
      </el-scrollbar>
      <template #footer>
        <div class="exam-group-drawer-actions">
          <button
            class="exam-link is-danger"
            type="button"
            @click="removeCurrentGroup()"
          >
            移除分组
          </button>
          <span class="exam-group-drawer-primary">
            <button
              class="exam-btn is-ghost"
              type="button"
              @click="groupDrawerVisible = false"
            >
              取消
            </button>
            <button
              class="exam-btn is-primary"
              type="button"
              @click="saveGroupEditor()"
            >
              应用到整组
            </button>
          </span>
        </div>
      </template>
    </el-drawer>

    <ExamPublishDialog ref="publishDialog" @published="edit.load()" />
  </div>
</template>
