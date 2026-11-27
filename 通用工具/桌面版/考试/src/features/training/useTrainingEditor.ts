// 这里新写的（旧网站没有）：「新建 / 修改培训」小窗的数据——名字、勾试卷、勾参加的人、截止时间、保存并发卷。
import { computed, ref } from "vue";
import { ElMessageBox } from "element-plus";
import {
  ExamApiError,
  getExamErrorKind,
  getExamErrorMessage
} from "@/api/exam";
import { type TeamOverview, getTeamOverview } from "@/api/team";
import {
  type SaveTrainingResult,
  type TrainingPaperOptionDto,
  TrainingErrorKinds,
  createTraining,
  getTrainingPaperOptions,
  updateTraining
} from "@/api/training";
import { message } from "@/utils/message";
import {
  type KeptMember,
  type PickerGroup,
  MAX_MEMBERS,
  clearableUsernames,
  defaultSelection,
  filterGroups,
  initiallyExpanded,
  pickerGroups,
  selectableUsernames,
  setMany
} from "./memberPicker";
import { saveSummary, sortByTitle } from "./trainingRank";

/** 一次培训最多几张卷：和后台 ExamTrainingRules.MaxPapersPerTraining 一样 */
export const MAX_PAPERS = 30;
/** 名字最多几个字：和后台 ExamTrainingRules.MaxNameLength 一样 */
export const MAX_NAME_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

/** 已经在这期培训里的一张卷：排名表上现成的那几样 */
export interface EditingPaper {
  paperId: string;
  title: string;
  status: string;
  totalScore: number;
}

/** 要改的那一期：点「修改」时刚读回来的排名里现成的，不另问服务器 */
export interface EditingTraining {
  trainingId: string;
  name: string;
  description: string | null;
  deadline: string | null;
  /** 修订版本：保存时原样带回去，后台对不上就拒 */
  revision: number;
  papers: EditingPaper[];
  members: KeptMember[];
}

export interface PaperChoice {
  option: TrainingPaperOptionDto;
  /** 为什么勾不了；能勾是空串 */
  blocked: string;
}

/**
 * 这张卷为什么不能勾进这次培训；能勾回空串。
 * 原来就在这次培训里的卷（哪怕已经归档、还没出题）不拦：能留着，去掉了也还能勾回来。
 */
export function paperBlockedReason(
  option: TrainingPaperOptionDto,
  editingId: string | null,
  alreadyInTraining: boolean
) {
  if (option.trainingId && option.trainingId !== editingId) {
    return `已在「${option.trainingName ?? "别的培训"}」里`;
  }
  if (alreadyInTraining) return "";
  if (option.status === "已归档") return "已归档，不能再发";
  if (option.questionCount === 0) return "还没有题目";
  return "";
}

const isPast = (value: string | null) =>
  Boolean(value) && new Date(value as string).getTime() <= Date.now();

/**
 * 「新建 / 修改培训」小窗。
 * 请求预算：打开 2 次——选卷清单 1 + 团队成员和部门 1（frontend.exam.trainingEditor.open=2），一个接一个发；
 * 点「保存并发卷」1 次（frontend.exam.trainingEditor.save=1）；勾卷、勾人、搜名字、展开收起都不问服务器
 * （frontend.exam.trainingEditor.pick=0）。
 * 保存完叫页面重读（onSaved）：给的是刚保存的那一期；给空串是「不知道存没存上、或这一期没了」，页面留在原地重读。
 */
export function useTrainingEditor(
  onSaved: (trainingId: string) => void | Promise<void>
) {
  const visible = ref(false);
  const editing = ref<EditingTraining | null>(null);
  const loading = ref(false);
  const loadError = ref(false);
  const submitting = ref(false);

  const name = ref("");
  const description = ref("");
  const deadline = ref<string | null>(null);
  /** 打开时这期培训原来的截止时间：没动过就原样带回去，不因为它过了期就悄悄清掉 */
  const originalDeadline = ref<string | null>(null);

  const paperOptions = ref<TrainingPaperOptionDto[]>([]);
  const papersTruncated = ref(false);
  const pickedPapers = ref<Set<string>>(new Set());
  const paperKeyword = ref("");
  /** 原来就在培训里、还是草稿的卷，这次要不要一起发布（默认不发：可能正撤回来改题） */
  const publishExistingDrafts = ref(false);

  const team = ref<TeamOverview | null>(null);
  const pickedPeople = ref<Set<string>>(new Set());
  const peopleKeyword = ref("");
  const expanded = ref<Set<string>>(new Set());

  /** 有卷没发出去时，留在小窗里把每张卷的结果摆给人看 */
  const outcome = ref<SaveTrainingResult | null>(null);
  /** 打开时的样子：关小窗前比一比，有没有没保存的改动 */
  let snapshot = "";
  /** 第几回读：连着开两次小窗时，先发的那回晚回来也不许动眼前这份 */
  let loadSeq = 0;

  const isEdit = computed(() => editing.value !== null);
  const editingId = computed(() => editing.value?.trainingId ?? null);

  /**
   * 能勾的卷排前面，勾不了的沉到底下；两段里都照卷名排。
   * 原来就在培训里、选卷清单却没给的卷（清单有上限）也照样摆出来勾着——
   * 试卷名单是照这份清单拼的，漏了哪张，一保存那张就被悄悄拿出培训。
   */
  const paperChoices = computed<PaperChoice[]>(() => {
    const before = editing.value;
    const already = new Set((before?.papers ?? []).map(paper => paper.paperId));
    const listed = new Set(paperOptions.value.map(option => option.paperId));
    const missing: TrainingPaperOptionDto[] = (before?.papers ?? [])
      .filter(paper => !listed.has(paper.paperId))
      .map(paper => ({
        paperId: paper.paperId,
        title: paper.title,
        status: paper.status,
        questionCount: -1,
        totalScore: paper.totalScore,
        trainingId: before!.trainingId,
        trainingName: before!.name
      }));
    const all = sortByTitle([...paperOptions.value, ...missing]).map(option => ({
      option,
      blocked: paperBlockedReason(
        option,
        editingId.value,
        already.has(option.paperId)
      )
    }));
    return [
      ...all.filter(choice => !choice.blocked),
      ...all.filter(choice => choice.blocked)
    ];
  });
  const visiblePapers = computed(() => {
    const needle = paperKeyword.value.trim().toLowerCase();
    return needle
      ? paperChoices.value.filter(choice =>
          choice.option.title.toLowerCase().includes(needle)
        )
      : paperChoices.value;
  });
  /** 勾上的卷，照卷名排好：就是排名表里各列的先后 */
  const orderedPaperIds = computed(() =>
    paperChoices.value
      .filter(choice => pickedPapers.value.has(choice.option.paperId))
      .map(choice => choice.option.paperId)
  );
  const pickedScore = computed(() =>
    paperChoices.value
      .filter(choice => pickedPapers.value.has(choice.option.paperId))
      .reduce((sum, choice) => sum + choice.option.totalScore, 0)
  );
  /** 原来就在培训里、现在还是草稿、这次也还勾着的卷：保存时默认不顺手发布 */
  const existingDrafts = computed(() => {
    const already = new Set(
      (editing.value?.papers ?? []).map(paper => paper.paperId)
    );
    return paperChoices.value
      .filter(
        choice =>
          choice.option.status === "草稿" &&
          already.has(choice.option.paperId) &&
          pickedPapers.value.has(choice.option.paperId)
      )
      .map(choice => choice.option.title);
  });

  const allGroups = computed<PickerGroup[]>(() =>
    team.value
      ? pickerGroups(
          team.value.departments,
          team.value.members,
          editing.value?.members ?? []
        )
      : []
  );
  const groups = computed(() =>
    filterGroups(allGroups.value, peopleKeyword.value)
  );
  const searching = computed(() => Boolean(peopleKeyword.value.trim()));

  const tooManyPapers = computed(() => pickedPapers.value.size > MAX_PAPERS);
  const tooManyPeople = computed(() => pickedPeople.value.size > MAX_MEMBERS);
  /** 修改时原来的截止时间已经过了、又没动它：提醒一句，要发新卷得先改晚或清空 */
  const deadlineExpired = computed(
    () =>
      isEdit.value &&
      deadline.value === originalDeadline.value &&
      isPast(originalDeadline.value)
  );

  /** 改的时候：这回加了谁、去了谁、加了哪几张卷、去了哪几张卷 */
  const changes = computed(() => {
    const before = editing.value;
    if (!before) {
      return { addedPeople: 0, removedPeople: 0, addedPapers: 0, removedPapers: 0 };
    }
    const wasIn = new Set(before.members.map(member => member.username));
    const hadPaper = new Set(before.papers.map(paper => paper.paperId));
    return {
      addedPeople: [...pickedPeople.value].filter(name => !wasIn.has(name))
        .length,
      removedPeople: [...wasIn].filter(name => !pickedPeople.value.has(name))
        .length,
      addedPapers: [...pickedPapers.value].filter(id => !hadPaper.has(id)).length,
      removedPapers: [...hadPaper].filter(id => !pickedPapers.value.has(id))
        .length
    };
  });

  /** 保存钮上面那句话：点下去会发生什么 */
  const hint = computed(() => {
    const papers = pickedPapers.value.size;
    const people = pickedPeople.value.size;
    if (!isEdit.value) {
      return papers > 0 && people > 0
        ? `保存后，这 ${papers} 张卷会发给勾上的 ${people} 人；草稿卷顺手发布。`
        : "勾好试卷和参加的人，保存后系统自动发卷。";
    }
    const parts: string[] = [];
    if (changes.value.addedPeople > 0) {
      parts.push(`新加的 ${changes.value.addedPeople} 人会收到全部卷`);
    }
    if (changes.value.addedPapers > 0) {
      parts.push(`新加的 ${changes.value.addedPapers} 张卷会发给所有参加的人`);
    }
    if (changes.value.removedPeople > 0) {
      parts.push(
        `去掉的 ${changes.value.removedPeople} 人不进排名，还没开考的卷会收回`
      );
    }
    if (changes.value.removedPapers > 0) {
      parts.push(
        `去掉的 ${changes.value.removedPapers} 张卷不再算进排名（卷和成绩都还在）`
      );
    }
    if (existingDrafts.value.length > 0) {
      parts.push(
        publishExistingDrafts.value
          ? `${existingDrafts.value.length} 张草稿卷会一起发布`
          : `${existingDrafts.value.length} 张草稿卷先不发布`
      );
    }
    return parts.length > 0
      ? `保存后：${parts.join("；")}。手上缺卷的人会补发。`
      : "保存后：手上缺卷的人会补发，已经有卷的人不重发。";
  });

  const canSave = computed(
    () =>
      !loading.value &&
      !loadError.value &&
      !submitting.value &&
      name.value.trim().length > 0 &&
      pickedPapers.value.size > 0 &&
      pickedPeople.value.size > 0 &&
      !tooManyPapers.value &&
      !tooManyPeople.value
  );

  function takeSnapshot() {
    return JSON.stringify([
      name.value.trim(),
      description.value.trim(),
      deadline.value,
      publishExistingDrafts.value,
      [...pickedPapers.value].sort(),
      [...pickedPeople.value].sort()
    ]);
  }

  function isDirty() {
    return snapshot !== "" && snapshot !== takeSnapshot();
  }

  async function load() {
    const seq = ++loadSeq;
    loading.value = true;
    loadError.value = false;
    try {
      const options = await getTrainingPaperOptions();
      if (seq !== loadSeq) return;
      const overview = await getTeamOverview();
      if (seq !== loadSeq) return;
      paperOptions.value = options.items ?? [];
      papersTruncated.value = options.truncated;
      team.value = overview;
      if (!editing.value) {
        pickedPeople.value = new Set(defaultSelection(overview.members));
      }
      expanded.value = new Set(initiallyExpanded(allGroups.value));
      snapshot = takeSnapshot();
    } catch (error) {
      if (seq !== loadSeq) return;
      loadError.value = true;
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      if (seq === loadSeq) {
        loading.value = false;
      }
    }
  }

  /** 有卷刚被别的培训占了：只把选卷清单读新，占掉的那几张去掉勾、变灰；勾好的人不动 */
  async function reloadPaperOptions() {
    try {
      const options = await getTrainingPaperOptions();
      paperOptions.value = options.items ?? [];
      papersTruncated.value = options.truncated;
      pickedPapers.value = setMany(
        pickedPapers.value,
        paperOptions.value
          .filter(
            option => option.trainingId && option.trainingId !== editingId.value
          )
          .map(option => option.paperId),
        false
      );
    } catch {
      // 读不出来就留着原样：再点保存，后台照样会拦
    }
  }

  function reset(target: EditingTraining | null) {
    editing.value = target;
    name.value = target?.name ?? "";
    description.value = target?.description ?? "";
    deadline.value = target?.deadline ?? null;
    originalDeadline.value = deadline.value;
    pickedPapers.value = new Set(
      (target?.papers ?? []).map(paper => paper.paperId)
    );
    pickedPeople.value = new Set(
      (target?.members ?? []).map(member => member.username)
    );
    publishExistingDrafts.value = false;
    paperOptions.value = [];
    papersTruncated.value = false;
    paperKeyword.value = "";
    peopleKeyword.value = "";
    outcome.value = null;
    snapshot = "";
    visible.value = true;
  }

  async function openCreate() {
    reset(null);
    await load();
  }

  async function openEdit(target: EditingTraining) {
    reset(target);
    await load();
  }

  /** 勾上或去掉一张卷：勾不了的卷勾不上，但已经勾着的随时能去掉 */
  function togglePaper(choice: PaperChoice) {
    const id = choice.option.paperId;
    const on = !pickedPapers.value.has(id);
    if (on && choice.blocked) return;
    pickedPapers.value = setMany(pickedPapers.value, [id], on);
  }

  function togglePerson(username: string) {
    pickedPeople.value = setMany(
      pickedPeople.value,
      [username],
      !pickedPeople.value.has(username)
    );
  }

  /** 勾组名：这一组连下面小部门的人一起勾上；已经全勾了就一起去掉 */
  function toggleGroup(group: PickerGroup) {
    const allOn = group.allUsernames.every(username =>
      pickedPeople.value.has(username)
    );
    pickedPeople.value = setMany(pickedPeople.value, group.allUsernames, !allOn);
  }

  /** 全选：眼前摆着的全体成员都勾上（搜名字时只勾搜出来的）；负责人自己不带 */
  function selectAll() {
    pickedPeople.value = setMany(
      pickedPeople.value,
      selectableUsernames(groups.value),
      true
    );
  }

  /** 清空：眼前摆着的在岗的人都去掉（搜名字时只去掉搜出来的）；已停用或离开的不动 */
  function clearAll() {
    pickedPeople.value = setMany(
      pickedPeople.value,
      clearableUsernames(groups.value),
      false
    );
  }

  function toggleExpand(groupId: string) {
    const next = new Set(expanded.value);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    expanded.value = next;
  }

  /** 搜名字时搜到的组都摊开，不用再一个个点 */
  function isExpanded(groupId: string) {
    return searching.value || expanded.value.has(groupId);
  }

  async function save() {
    if (submitting.value) return;
    const trimmedName = name.value.trim();
    if (!trimmedName) {
      message("先给这次培训起个名字。", { type: "warning" });
      return;
    }
    if (pickedPapers.value.size === 0) {
      message("至少勾一张试卷。", { type: "warning" });
      return;
    }
    if (pickedPeople.value.size === 0) {
      message("至少勾一个参加的人。", { type: "warning" });
      return;
    }
    if (tooManyPapers.value) {
      message(`一次培训最多放 ${MAX_PAPERS} 张试卷。`, { type: "warning" });
      return;
    }
    if (tooManyPeople.value) {
      message(`一次培训最多 ${MAX_MEMBERS} 人参加。`, { type: "warning" });
      return;
    }
    // 新填的、改过的截止时间不许是过去的；原来那个没动过就原样带回去（要不要拦由后台看这次发不发新卷）
    if (deadline.value !== originalDeadline.value && isPast(deadline.value)) {
      message("截止时间要晚于现在；不设截止就清空。", { type: "warning" });
      return;
    }

    const target = editing.value;
    submitting.value = true;
    try {
      const body = {
        name: trimmedName,
        description: description.value.trim() || null,
        deadline: deadline.value,
        paperIds: orderedPaperIds.value,
        usernames: [...pickedPeople.value],
        expectedRevision: target?.revision ?? null,
        publishExistingDrafts:
          existingDrafts.value.length > 0 && publishExistingDrafts.value
      };
      const result = target
        ? await updateTraining(target.trainingId, body)
        : await createTraining(body);
      const summary = saveSummary(result);
      snapshot = "";
      if (summary.failed > 0) {
        // 有卷没发出去：留在小窗里把每张卷的结果摆出来
        outcome.value = result;
        message(summary.text, { type: "warning", duration: 5000 });
      } else {
        visible.value = false;
        message(summary.text, { type: "success", duration: 4000 });
      }
      await onSaved(result.trainingId);
    } catch (error) {
      await afterSaveError(error, target);
    } finally {
      submitting.value = false;
    }
  }

  /** 保存没成：照后台说的原因各办各的 */
  async function afterSaveError(error: unknown, target: EditingTraining | null) {
    if (!(error instanceof ExamApiError)) {
      // 不是后台明说「不行」，而是没收到回话（断网、等太久）：这时不知道存没存上。
      // 先叫页面把列表读新，小窗留着、勾好的不丢；人看了列表再决定要不要重存。
      message(
        "没收到服务器的回话，不知道存没存上。先看一眼培训列表里有没有，再决定要不要重存。",
        { type: "warning", duration: 8000 }
      );
      await onSaved("");
      return;
    }
    const kind = getExamErrorKind(error);
    message(getExamErrorMessage(error), { type: "error", duration: 5000 });
    if (kind === TrainingErrorKinds.PaperTaken) {
      await reloadPaperOptions();
    } else if (kind === TrainingErrorKinds.TrainingNotFound) {
      visible.value = false;
      await onSaved("");
    } else if (kind === TrainingErrorKinds.Stale) {
      // 这期培训在别处刚改过：手上这份底稿旧了，存上去会冲掉那边的改动。关掉，让页面读新的再改。
      visible.value = false;
      await onSaved(target?.trainingId ?? "");
    }
  }

  /** 关小窗：有没保存的改动先问一句 */
  async function requestClose() {
    if (submitting.value) return;
    if (isDirty()) {
      try {
        await ElMessageBox.confirm(
          "改动还没保存，关掉就没了。",
          "不保存就关掉？",
          {
            confirmButtonText: "不保存，关掉",
            cancelButtonText: "接着改",
            type: "warning"
          }
        );
      } catch {
        return;
      }
    }
    visible.value = false;
  }

  return {
    visible,
    editing,
    isEdit,
    loading,
    loadError,
    submitting,
    name,
    description,
    deadline,
    deadlineExpired,
    paperChoices,
    visiblePapers,
    papersTruncated,
    pickedPapers,
    pickedScore,
    paperKeyword,
    existingDrafts,
    publishExistingDrafts,
    groups,
    allGroups,
    pickedPeople,
    peopleKeyword,
    searching,
    tooManyPapers,
    tooManyPeople,
    changes,
    hint,
    canSave,
    outcome,
    openCreate,
    openEdit,
    load,
    togglePaper,
    togglePerson,
    toggleGroup,
    selectAll,
    clearAll,
    toggleExpand,
    isExpanded,
    isDirty,
    save,
    requestClose
  };
}
