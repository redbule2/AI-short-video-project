import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import {
  type ExamAnswerFile,
  type ExamOptionDto,
  type ExamQuestionGroupDto,
  type ExamQuestionInput,
  type ExamQuestionType,
  getExamErrorMessage,
  getExamPaperDetail,
  revertExamPaper,
  saveExamQuestions,
  updateExamPaperMeta,
  uploadExamStemImage
} from "@/api/exam";
import { message } from "@/utils/message";

/** 出题工作台的本地可编辑题目形态。 */
export interface EditableQuestion {
  localId: number;
  type: ExamQuestionType;
  stem: string;
  /** 题干配图(≤4 张,先经本卷上传接口)。 */
  stemImages: ExamAnswerFile[];
  options: ExamOptionDto[];
  /** 单选答案 key / 判断答案。 */
  singleAnswer: string;
  judgeAnswer: boolean | null;
  multipleAnswers: string[];
  blankAnswers: string[];
  essayReference: string;
  analysis: string;
  score: number;
  group: ExamQuestionGroupDto | null;
}

let localIdSeed = 1;

/**
 * 逐题缺项清单(与 toInputs 的保存校验同一套规则,只是产出短标签而非抛错)。
 * 供总览/题卡/专注编辑三处共用:空数组 = 本题已齐,可保存。
 */
export function questionIssues(question: EditableQuestion): string[] {
  const issues: string[] = [];
  if (!question.stem.trim()) issues.push("题干");
  if (question.type === "single" || question.type === "multiple") {
    if (question.options.some(option => !option.text.trim()))
      issues.push("选项内容");
    const hasAnswer =
      question.type === "single"
        ? Boolean(question.singleAnswer)
        : question.multipleAnswers.length > 0;
    if (!hasAnswer) issues.push("正确答案");
  } else if (question.type === "judge") {
    if (question.judgeAnswer === null) issues.push("正确答案");
  } else if (question.type === "fillBlank") {
    if (question.blankAnswers.every(item => !item.trim()))
      issues.push("参考答案");
  } else if (question.type === "essay") {
    if (!question.essayReference.trim()) issues.push("参考答案");
  } else if (question.type === "practical") {
    if (!question.essayReference.trim()) issues.push("评分标准");
  }
  if (!question.analysis.trim()) issues.push("解析");
  if (!question.score || question.score <= 0) issues.push("分值");
  return issues;
}

function defaultOptions(): ExamOptionDto[] {
  return [
    { key: "A", text: "" },
    { key: "B", text: "" },
    { key: "C", text: "" },
    { key: "D", text: "" }
  ];
}

function emptyQuestion(type: ExamQuestionType): EditableQuestion {
  return {
    localId: localIdSeed++,
    type,
    stem: "",
    stemImages: [],
    options: type === "single" || type === "multiple" ? defaultOptions() : [],
    singleAnswer: "",
    judgeAnswer: null,
    multipleAnswers: [],
    blankAnswers: [""],
    essayReference: "",
    analysis: "",
    score:
      type === "essay" || type === "practical"
        ? 20
        : type === "fillBlank"
          ? 10
          : 5,
    group: null
  };
}

/**
 * 出题工作台(owner)。请求预算:进入按 paperId 拉详情 1 次(frontend.exam.paperEdit.enter=1)。
 * 仅草稿可编辑;已发布 → 只读视图 + 撤回入口。
 */
export function useExamPaperEdit() {
  const route = useRoute();
  const router = useRouter();
  const paperId = computed(() => String(route.query.paperId ?? ""));

  const loading = ref(false);
  const notFound = ref(false);
  const saving = ref(false);

  const status = ref("草稿");
  const title = ref("");
  const description = ref("");
  const durationMinutes = ref<number | null>(null);
  const passScore = ref<number | null>(null);
  const revealPolicy = ref<"onSubmit" | "manual">("onSubmit");
  const questions = ref<EditableQuestion[]>([]);
  /** 是否有未保存改动(离开守卫)。 */
  const dirty = ref(false);

  const readonly = computed(() => status.value !== "草稿");
  const totalScore = computed(() =>
    questions.value.reduce((sum, question) => sum + (question.score || 0), 0)
  );

  function markDirty() {
    dirty.value = true;
  }

  async function load() {
    if (!paperId.value) {
      notFound.value = true;
      return;
    }
    loading.value = true;
    try {
      const detail = await getExamPaperDetail(paperId.value);
      if (!detail) {
        notFound.value = true;
        return;
      }
      status.value = detail.status;
      title.value = detail.title;
      description.value = detail.description ?? "";
      durationMinutes.value = detail.durationMinutes;
      passScore.value = detail.passScore;
      revealPolicy.value = detail.answerRevealPolicy;
      questions.value = detail.questions.map(question => ({
        localId: localIdSeed++,
        type: question.type,
        stem: question.stem,
        stemImages: question.stemImages
          ? question.stemImages.map(i => ({ ...i }))
          : [],
        options: question.options ? question.options.map(o => ({ ...o })) : [],
        singleAnswer:
          question.type === "single" &&
          typeof question.answer?.answer === "string"
            ? question.answer.answer
            : "",
        judgeAnswer:
          question.type === "judge" &&
          typeof question.answer?.answer === "boolean"
            ? question.answer.answer
            : null,
        multipleAnswers:
          question.type === "multiple"
            ? [...(question.answer?.answers ?? [])]
            : [],
        blankAnswers:
          question.type === "fillBlank"
            ? [...(question.answer?.answers ?? [""])]
            : [""],
        // essay 与 practical 同用 reference 字段承载(参考答案/评分标准)——
        // 两个题型都要回填,否则实操题重载后评分标准丢失【gpt-5.6-sol 必改#3】
        essayReference:
          question.type === "essay" || question.type === "practical"
            ? (question.answer?.reference ?? "")
            : "",
        analysis: question.analysis,
        score: question.score,
        group: question.group ? { ...question.group } : null
      }));
      dirty.value = false;
      notFound.value = false;
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      loading.value = false;
    }
  }

  function addQuestion(type: ExamQuestionType): EditableQuestion {
    const created = emptyQuestion(type);
    questions.value = [...questions.value, created];
    markDirty();
    return created;
  }

  function removeQuestion(localId: number) {
    void ElMessageBox.confirm("删除这道题?", "确认删除", {
      confirmButtonText: "删除",
      cancelButtonText: "取消",
      type: "warning"
    })
      .then(() => {
        questions.value = questions.value.filter(q => q.localId !== localId);
        normalizeQuestionGroups();
        markDirty();
      })
      .catch(() => undefined);
  }

  function moveQuestion(localId: number, direction: -1 | 1) {
    const index = questions.value.findIndex(q => q.localId === localId);
    if (index < 0) return;
    const next = [...questions.value];
    const current = questionBlockRange(next, index);
    if (direction === -1) {
      if (current.start === 0) return;
      const previous = questionBlockRange(next, current.start - 1);
      next.splice(
        previous.start,
        current.end - previous.start + 1,
        ...next.slice(current.start, current.end + 1),
        ...next.slice(previous.start, previous.end + 1)
      );
    } else {
      if (current.end >= next.length - 1) return;
      const following = questionBlockRange(next, current.end + 1);
      next.splice(
        current.start,
        following.end - current.start + 1,
        ...next.slice(following.start, following.end + 1),
        ...next.slice(current.start, current.end + 1)
      );
    }
    questions.value = next;
    markDirty();
  }

  function questionBlockRange(items: EditableQuestion[], index: number) {
    const groupId = items[index]?.group?.id;
    if (!groupId) return { start: index, end: index };
    let start = index;
    let end = index;
    while (start > 0 && items[start - 1]?.group?.id === groupId) start -= 1;
    while (end < items.length - 1 && items[end + 1]?.group?.id === groupId) end += 1;
    return { start, end };
  }

  function normalizeQuestionGroups() {
    const counters = new Map<string, number>();
    for (const question of questions.value) {
      if (!question.group) continue;
      const subQuestionNo = (counters.get(question.group.id) ?? 0) + 1;
      counters.set(question.group.id, subQuestionNo);
      question.group = { ...question.group, subQuestionNo };
    }
  }

  function createQuestionGroup(localId: number) {
    const question = questions.value.find(item => item.localId === localId);
    if (!question || question.group) return;
    question.group = {
      id: `group-${Date.now()}-${localId}`,
      title: "案例大题",
      caseText: null,
      subQuestionNo: 1
    };
    markDirty();
  }

  function joinPreviousQuestionGroup(localId: number) {
    const index = questions.value.findIndex(item => item.localId === localId);
    const question = questions.value[index];
    const previousGroup = questions.value[index - 1]?.group;
    if (!question || question.group || !previousGroup) return;
    question.group = { ...previousGroup, subQuestionNo: previousGroup.subQuestionNo + 1 };
    normalizeQuestionGroups();
    markDirty();
  }

  function updateQuestionGroup(
    groupId: string,
    title: string,
    caseText: string | null
  ) {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) throw new Error("大题标题不能为空。");
    const normalizedCaseText = caseText?.trim() || null;
    for (const question of questions.value) {
      if (question.group?.id === groupId) {
        question.group = {
          ...question.group,
          title: normalizedTitle,
          caseText: normalizedCaseText
        };
      }
    }
    markDirty();
  }

  function removeQuestionGroup(groupId: string) {
    for (const question of questions.value) {
      if (question.group?.id === groupId) question.group = null;
    }
    markDirty();
  }

  function addOption(question: EditableQuestion) {
    if (question.options.length >= 8) return;
    const nextKey = String.fromCharCode(65 + question.options.length);
    question.options = [...question.options, { key: nextKey, text: "" }];
    markDirty();
  }

  function removeOption(question: EditableQuestion, key: string) {
    if (question.options.length <= 2) return;
    // 先建 旧key→新key 映射,再重排——否则字母顺移后旧答案 key 会指到别的选项内容,
    // 正确答案被静默换掉【gpt-5.6-sol 评审必改#5】
    const keyMap = new Map<string, string>();
    const survivors = question.options.filter(option => option.key !== key);
    survivors.forEach((option, index) => {
      keyMap.set(option.key, String.fromCharCode(65 + index));
    });
    question.options = survivors.map((option, index) => ({
      key: String.fromCharCode(65 + index),
      text: option.text
    }));
    question.singleAnswer = keyMap.get(question.singleAnswer) ?? "";
    question.multipleAnswers = question.multipleAnswers
      .map(item => keyMap.get(item))
      .filter((item): item is string => Boolean(item));
    markDirty();
  }

  function addBlank(question: EditableQuestion) {
    question.blankAnswers = [...question.blankAnswers, ""];
    markDirty();
  }

  function removeBlank(question: EditableQuestion, index: number) {
    if (question.blankAnswers.length <= 1) return;
    question.blankAnswers = question.blankAnswers.filter((_, i) => i !== index);
    markDirty();
  }

  /** 本地校验并转 wire 形态;有问题抛可读错误。 */
  function toInputs(): ExamQuestionInput[] {
    if (!title.value.trim()) throw new Error("试卷标题不能为空。");
    return questions.value.map((question, index) => {
      const no = index + 1;
      if (!question.stem.trim()) throw new Error(`第 ${no} 题题干不能为空。`);
      if (!question.analysis.trim())
        throw new Error(`第 ${no} 题必须填写解析(答题者复盘时可见)。`);
      if (!question.score || question.score <= 0)
        throw new Error(`第 ${no} 题分值必须为正整数。`);

      let answer: ExamQuestionInput["answer"];
      let options: ExamOptionDto[] | undefined;
      switch (question.type) {
        case "single": {
          options = question.options.map(o => ({
            key: o.key,
            text: o.text.trim()
          }));
          if (options.some(o => !o.text))
            throw new Error(`第 ${no} 题存在空选项内容。`);
          if (!question.singleAnswer)
            throw new Error(`第 ${no} 题请勾选正确答案。`);
          answer = { answer: question.singleAnswer };
          break;
        }
        case "multiple": {
          options = question.options.map(o => ({
            key: o.key,
            text: o.text.trim()
          }));
          if (options.some(o => !o.text))
            throw new Error(`第 ${no} 题存在空选项内容。`);
          if (question.multipleAnswers.length === 0)
            throw new Error(`第 ${no} 题请勾选正确答案(可多选)。`);
          answer = { answers: [...question.multipleAnswers] };
          break;
        }
        case "judge": {
          if (question.judgeAnswer === null)
            throw new Error(`第 ${no} 题请选择「对」或「错」。`);
          answer = { answer: question.judgeAnswer };
          break;
        }
        case "fillBlank": {
          const blanks = question.blankAnswers.map(item => item.trim());
          if (blanks.every(item => !item))
            throw new Error(`第 ${no} 题请填写各空的参考答案。`);
          answer = { answers: blanks };
          break;
        }
        case "essay": {
          if (!question.essayReference.trim())
            throw new Error(`第 ${no} 题请填写参考答案(AI 判分依据)。`);
          answer = { reference: question.essayReference.trim() };
          break;
        }
        case "practical": {
          if (!question.essayReference.trim())
            throw new Error(
              `第 ${no} 题请填写评分标准(考生按要求上传图片,AI 拉图对照评分)。`
            );
          answer = { reference: question.essayReference.trim() };
          break;
        }
      }
      return {
        type: question.type,
        stem: question.stem.trim(),
        stemImages: question.stemImages.length
          ? [...question.stemImages]
          : undefined,
        options,
        answer,
        analysis: question.analysis.trim(),
        score: question.score,
        group: question.group ? { ...question.group } : null
      };
    });
  }

  /** 配图上传中计数:保存/发布必须等它归零(上传完成屏障【gpt-5.6-sol 必改#4】)。 */
  const stemUploadingCount = ref(0);

  /** 题干配图:选择即上传(仅草稿;≤4 张)。 */
  async function uploadStemImage(question: EditableQuestion, file: File) {
    if (readonly.value) return;
    if (question.stemImages.length >= 4) {
      message("每题题干配图最多 4 张。", { type: "warning" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      message("图片大小须在 10MB 以内。", { type: "warning" });
      return;
    }
    stemUploadingCount.value += 1;
    try {
      const uploaded = await uploadExamStemImage(paperId.value, file);
      question.stemImages = [...question.stemImages, uploaded];
      markDirty();
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      stemUploadingCount.value -= 1;
    }
  }

  function removeStemImage(question: EditableQuestion, url: string) {
    question.stemImages = question.stemImages.filter(item => item.url !== url);
    markDirty();
  }

  async function save(): Promise<boolean> {
    if (saving.value || readonly.value) return false;
    if (stemUploadingCount.value > 0) {
      message("题干配图还在上传,传完再保存。", { type: "warning" });
      return false;
    }
    saving.value = true;
    try {
      const inputs = toInputs();
      await updateExamPaperMeta(paperId.value, {
        title: title.value.trim(),
        description: description.value.trim() || null,
        durationMinutes: durationMinutes.value,
        passScore: passScore.value,
        answerRevealPolicy: revealPolicy.value
      });
      await saveExamQuestions(paperId.value, inputs);
      dirty.value = false;
      message("已保存", { type: "success" });
      return true;
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
      return false;
    } finally {
      saving.value = false;
    }
  }

  function revert() {
    void ElMessageBox.confirm(
      "撤回后回到草稿可继续改题;该卷未开考的指派会一并撤销。",
      "撤回这张卷?",
      { confirmButtonText: "撤回", cancelButtonText: "取消", type: "warning" }
    )
      .then(async () => {
        try {
          await revertExamPaper(paperId.value);
          message("已撤回为草稿", { type: "success" });
          await load();
        } catch (error) {
          message(getExamErrorMessage(error), { type: "error" });
        }
      })
      .catch(() => undefined);
  }

  function backToPapers() {
    void router.push({ name: "ExamPapers" });
  }

  onMounted(() => {
    void load();
  });

  return {
    paperId,
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
    dirty,
    markDirty,
    load,
    addQuestion,
    removeQuestion,
    moveQuestion,
    createQuestionGroup,
    joinPreviousQuestionGroup,
    updateQuestionGroup,
    removeQuestionGroup,
    addOption,
    removeOption,
    addBlank,
    removeBlank,
    stemUploadingCount,
    uploadStemImage,
    removeStemImage,
    save,
    revert,
    backToPapers
  };
}
