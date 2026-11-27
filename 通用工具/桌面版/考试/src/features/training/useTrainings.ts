// 这里新写的（旧网站没有）：「培训」页的数据——有哪几期、选中那一期的排名、搜名字、按部门看、删除。
import {
  computed,
  getCurrentInstance,
  onActivated,
  onMounted,
  ref,
  shallowRef
} from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { copyTextToClipboard } from "@pureadmin/utils";
import { getExamErrorMessage } from "@/api/exam";
import { type TeamOverview, getTeamOverview } from "@/api/team";
import {
  type TrainingCellDto,
  type TrainingPaperDto,
  type TrainingRankingDto,
  type TrainingRowDto,
  type TrainingSummaryDto,
  deleteTraining,
  getTrainingRanking,
  getTrainings
} from "@/api/training";
import { message } from "@/utils/message";
import {
  canOpenSheet,
  clipboardHtml,
  clipboardTable,
  departmentChoices,
  filterRows,
  myRowOf,
  remainingOf,
  statsOf,
  usernamesInDepartment
} from "./trainingRank";

/** 把成绩表放进剪贴板：字和表格各一份（贴进表格软件用表格那份）；这条路走不通回 false，由调用方退回只放字 */
async function writeRichClipboard(text: string, html: string) {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard?.write ||
    typeof ClipboardItem === "undefined"
  ) {
    return false;
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" })
      })
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * 「培训」页（团队里人人能看排名；新建、修改、删除只有负责人有）。
 * 请求预算，一个接一个发、不并发：
 *   进页面 3 次——培训列表 1 + 选中那一期的排名 1 + 团队部门 1（frontend.exam.trainingsPage.enter=3）；
 *   换一期 1 次（frontend.exam.trainings.switchTraining=1）；
 *   点「刷新」、切走再回来 各 2 次——列表 1 + 排名 1（frontend.exam.trainings.refresh=2、.reactivate=2）；
 *   点「修改」先把这一期重读 1 次（frontend.exam.trainings.beforeEdit=1）；
 *   点格子看答卷只跳页，本页 0 次（frontend.exam.trainings.sheetDetail=0）；
 *   保存完重读列表和排名 2 次（frontend.exam.trainings.afterSave=2）；
 *   删除 1 次、删完重读 2 次（frontend.exam.trainings.delete=1、.afterDelete=2）。
 * 搜名字、按部门看都在本机筛，不问服务器。
 */
export function useTrainings() {
  const route = useRoute();
  const router = useRouter();

  const trainings = ref<TrainingSummaryDto[]>([]);
  const canManage = ref(false);
  const listLoading = ref(true);
  const listError = ref(false);
  const selectedId = ref("");

  /** 整份换新、不在原地改：用浅的就够，200 人 × 30 张卷不用一格格做成响应式 */
  const ranking = shallowRef<TrainingRankingDto | null>(null);
  const rankingLoading = ref(false);
  const rankingError = ref(false);

  /** 「按部门看」用的团队部门；读不到就不摆这个筛选，排名照看 */
  const team = ref<TeamOverview | null>(null);
  const keyword = ref("");
  const departmentId = ref("");
  const removing = ref(false);
  /** 进页面那一串读完了没有：读完以后再切回来才重读 */
  let entered = false;

  const selected = computed(
    () =>
      trainings.value.find(item => item.trainingId === selectedId.value) ?? null
  );
  const isEmpty = computed(
    () => !listLoading.value && !listError.value && trainings.value.length === 0
  );
  /**
   * 眼前这张排名表就是选中的那一期、而且读完了：这样才让改、让删。
   * 不然会改错一期、删错一期，或者拿一张没读新的旧名单当底稿存上去。
   */
  const rankingReady = computed(
    () =>
      !listLoading.value &&
      !rankingLoading.value &&
      ranking.value !== null &&
      ranking.value.trainingId === selectedId.value
  );
  const stats = computed(() => (ranking.value ? statsOf(ranking.value) : null));
  const myRow = computed(() => (ranking.value ? myRowOf(ranking.value) : null));
  const myRemaining = computed(() =>
    myRow.value ? remainingOf(myRow.value) : 0
  );
  const departments = computed(() =>
    team.value && ranking.value
      ? departmentChoices(
          team.value.departments,
          team.value.members,
          ranking.value.rows
        )
      : []
  );
  const visibleRows = computed(() => {
    if (!ranking.value) return [];
    const inDepartment =
      departmentId.value && team.value
        ? usernamesInDepartment(
            team.value.departments,
            team.value.members,
            departmentId.value
          )
        : null;
    return filterRows(ranking.value.rows, keyword.value, inDepartment);
  });
  const filtering = computed(
    () => Boolean(keyword.value.trim()) || Boolean(departmentId.value)
  );

  /** 读培训列表；prefer 是想停在哪一期（刚保存的、地址里带的），没有就留在原来那期，再没有就第一期 */
  async function loadList(prefer = "") {
    listLoading.value = true;
    try {
      const result = await getTrainings();
      trainings.value = result.items ?? [];
      canManage.value = result.canManage;
      listError.value = false;
      const target =
        trainings.value.find(item => item.trainingId === prefer) ??
        trainings.value.find(item => item.trainingId === selectedId.value) ??
        trainings.value[0];
      const nextId = target?.trainingId ?? "";
      // 换了一期（或一期也没有了）：原来那张排名不留在屏幕上，免得名字是新的、表是旧的
      if (ranking.value && ranking.value.trainingId !== nextId) {
        ranking.value = null;
      }
      selectedId.value = nextId;
    } catch (error) {
      listError.value = true;
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      listLoading.value = false;
    }
  }

  async function loadRanking(trainingId: string) {
    if (!trainingId) return;
    rankingLoading.value = true;
    let result: TrainingRankingDto | null;
    try {
      result = await getTrainingRanking(trainingId);
    } catch (error) {
      // 读回来之前又换了一期：这份不要了，也不替新的那一期收场
      if (selectedId.value === trainingId) {
        rankingError.value = true;
        rankingLoading.value = false;
        message(getExamErrorMessage(error), { type: "error" });
      }
      return;
    }
    if (selectedId.value !== trainingId) return;
    rankingError.value = false;
    rankingLoading.value = false;
    if (result) {
      ranking.value = result;
      return;
    }

    // 这一期刚被删了：从列表里拿掉，换到剩下的头一期
    message("这期培训已经被删除了。", { type: "warning" });
    trainings.value = trainings.value.filter(
      item => item.trainingId !== trainingId
    );
    ranking.value = null;
    selectedId.value = trainings.value[0]?.trainingId ?? "";
    if (selectedId.value) {
      await loadRanking(selectedId.value);
    }
  }

  async function loadTeam() {
    try {
      team.value = await getTeamOverview();
    } catch {
      team.value = null;
    }
  }

  /** 列表和选中那一期的排名一起读新（刷新、切回来、保存完、删完都走这里）：2 次请求 */
  async function reloadAll(prefer = "") {
    await loadList(prefer);
    if (selectedId.value) {
      await loadRanking(selectedId.value);
    }
  }

  async function enter() {
    await reloadAll(String(route.query.trainingId ?? ""));
    await loadTeam();
    entered = true;
  }

  function selectTraining(trainingId: string) {
    selectedId.value = trainingId;
    keyword.value = "";
    departmentId.value = "";
    ranking.value = null;
    void loadRanking(trainingId);
  }

  /** 点「刷新」：连列表一起读新（别人刚建的一期、刚改的名字也看得到） */
  async function refresh() {
    if (listLoading.value || rankingLoading.value) return;
    await reloadAll();
  }

  /**
   * 点「修改」前先把这一期重读一遍。保存是整份覆盖的，底稿必须是最新的：
   * 拿屏幕上那张可能过了期的名单存上去，会把别处刚加的人悄悄去掉。读不到就回 null、不开小窗。
   */
  async function freshForEdit() {
    const trainingId = selectedId.value;
    if (!trainingId || rankingLoading.value) return null;
    await loadRanking(trainingId);
    const fresh = ranking.value;
    return fresh && fresh.trainingId === trainingId && !rankingError.value
      ? fresh
      : null;
  }

  /** 新建、修改保存完：停在刚保存的那一期，重读列表和排名（没给是哪一期就留在原来那期） */
  async function afterSaved(trainingId: string) {
    keyword.value = "";
    departmentId.value = "";
    await reloadAll(trainingId);
  }

  async function remove() {
    const target = selected.value;
    if (!target || removing.value || !rankingReady.value) return;
    try {
      await ElMessageBox.confirm(
        "只删掉这期培训和它的排名。试卷、答卷、成绩都不动，这几张卷回到单张考试，以后还能放进别的培训。",
        `删除培训「${target.name}」？`,
        {
          confirmButtonText: "删除培训",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }

    removing.value = true;
    try {
      await deleteTraining(target.trainingId);
      message("培训已删除，试卷和成绩都还在", { type: "success" });
      // 删的这会儿人要是已经换去看别的一期了，就留在那一期，不把他拽回头一期
      if (selectedId.value === target.trainingId) {
        selectedId.value = "";
        ranking.value = null;
      }
      await reloadAll();
    } catch (error) {
      message(getExamErrorMessage(error), { type: "error" });
    } finally {
      removing.value = false;
    }
  }

  function cellOpenable(cell: TrainingCellDto, paper: TrainingPaperDto) {
    return canOpenSheet(cell, paper, canManage.value);
  }

  /**
   * 点格子看这份答卷：跳去复盘页，带上「从培训来的」，看完能回到这一期。
   * 普通成员看自己的卷走考生那一面；别的都走成绩总览那一面（负责人不用等答案公布）。
   */
  function openSheet(
    row: TrainingRowDto,
    cell: TrainingCellDto,
    paper: TrainingPaperDto
  ) {
    if (!cell.sheetId || !cellOpenable(cell, paper)) return;
    const back = { from: "training", trainingId: selectedId.value };
    void router.push({
      name: "ExamReview",
      query:
        row.isMe && !canManage.value
          ? { sheetId: cell.sheetId, ...back }
          : {
              sheetId: cell.sheetId,
              source: "results",
              paperId: paper.paperId,
              ...back
            }
    });
  }

  /**
   * 把眼前这张成绩表复制出去：字一份、表格一份。贴进表格软件用的是表格那份，
   * 账号（手机号）不会变成 1.38E+10。放不了表格的环境退回只放字。
   */
  async function copyTable() {
    if (!ranking.value) return;
    const papers = ranking.value.papers;
    const rows = visibleRows.value;
    const text = clipboardTable(papers, rows);
    let ok = await writeRichClipboard(text, clipboardHtml(papers, rows));
    if (!ok) {
      try {
        ok = copyTextToClipboard(text);
      } catch {
        ok = false;
      }
    }
    message(
      ok
        ? `已复制 ${rows.length} 人的成绩表，去表格里粘贴`
        : "复制失败，请再试一次",
      { type: ok ? "success" : "error" }
    );
  }

  function goMyExams() {
    void router.push({ name: "ExamMy" });
  }

  function clearFilters() {
    keyword.value = "";
    departmentId.value = "";
  }

  onMounted(() => {
    void enter();
  });
  // 这一页是缓存着的（切走不重来）：再切回来时把列表和排名读新，别拿上回的给人看——
  // 负责人刚建的一期、别处刚改的名单，不用重开软件就看得到。头一回进页面由上面那一串管，这里不重复读。
  if (getCurrentInstance()) {
    onActivated(() => {
      if (entered) {
        void reloadAll();
      }
    });
  }

  return {
    trainings,
    canManage,
    listLoading,
    listError,
    isEmpty,
    selectedId,
    selected,
    ranking,
    rankingLoading,
    rankingError,
    rankingReady,
    stats,
    myRow,
    myRemaining,
    departments,
    keyword,
    departmentId,
    visibleRows,
    filtering,
    removing,
    reloadAll,
    selectTraining,
    refresh,
    freshForEdit,
    afterSaved,
    remove,
    cellOpenable,
    openSheet,
    copyTable,
    goMyExams,
    clearFilters
  };
}
