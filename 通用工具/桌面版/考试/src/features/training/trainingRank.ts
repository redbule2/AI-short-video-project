// 这里新写的（旧网站没有）：「培训」排名页里不碰界面、不问服务器的算法——
// 格子怎么写、哪些格子能点开、搜名字、按部门看、成绩表怎么复制、发卷结果怎么说。
import type { TeamDepartment, TeamMember } from "@/api/team";
import type {
  SaveTrainingResult,
  TrainingCellDto,
  TrainingCellState,
  TrainingPaperDto,
  TrainingPaperOutcomeDto,
  TrainingRankingDto,
  TrainingRowDto
} from "@/api/training";
import {
  UNASSIGNED,
  flattenTree,
  withDescendants
} from "@/features/team/teamTree";

/** 没有分数的格子写什么；有分的格子直接写分数 */
export const CELL_STATE_TEXT: Record<TrainingCellState, string> = {
  graded: "",
  pending: "待判",
  taking: "答题中",
  notStarted: "未考",
  absent: "缺考",
  unassigned: "未发",
  notSubmitted: "未交"
};

/** 鼠标停在格子上说的那句话 */
export function cellHint(cell: TrainingCellDto) {
  switch (cell.state) {
    case "graded":
      return cell.scoreSource === "manual" ? "人工阅卷的分" : "系统 / AI 判的分";
    case "pending":
      return "已交卷，主观题还没判完；先记已出的客观分";
    case "taking":
      return "正在答题";
    case "notStarted":
      return "卷已经发了，还没开考";
    case "absent":
      return "过了截止时间没考，按 0 分算";
    case "unassigned":
      return "这张卷没有发给这个人";
    default:
      return "还没交卷";
  }
}

/** 判完了、卷子设了及格分、分数不到：标红 */
export function isBelowPass(cell: TrainingCellDto, paper: TrainingPaperDto) {
  return (
    cell.state === "graded" &&
    paper.passScore !== null &&
    (cell.score ?? 0) < paper.passScore
  );
}

/** 这一格能不能点开看答卷：负责人随时能；别人（连本人）要等答案公布 */
export function canOpenSheet(
  cell: TrainingCellDto,
  paper: TrainingPaperDto,
  canManage: boolean
) {
  return Boolean(cell.sheetId) && (canManage || paper.answersPublished);
}

/** 名字或账号里带这几个字（不分大小写）；没打字就全留 */
export function matchesKeyword(row: TrainingRowDto, keyword: string) {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.displayName.toLowerCase().includes(needle) ||
    row.username.toLowerCase().includes(needle)
  );
}

/** 这个部门（连下面的小部门）里有哪些账号；UNASSIGNED 是还没分部门的 */
export function usernamesInDepartment(
  departments: TeamDepartment[],
  members: TeamMember[],
  departmentId: string
) {
  const known = new Set(departments.map(item => item.id));
  if (departmentId === UNASSIGNED) {
    return new Set(
      members
        .filter(item => !item.departmentId || !known.has(item.departmentId))
        .map(item => item.username)
    );
  }
  const subtree = withDescendants(departments, departmentId);
  return new Set(
    members
      .filter(item => item.departmentId && subtree.has(item.departmentId))
      .map(item => item.username)
  );
}

export interface DepartmentChoice {
  id: string;
  /** 带缩进的名字 */
  label: string;
  /** 这个部门（连下级）有几个人在这次培训里 */
  count: number;
}

/** 「按部门看」能挑哪些：只摆有人参加这次培训的部门，最后是还没分部门的 */
export function departmentChoices(
  departments: TeamDepartment[],
  members: TeamMember[],
  rows: TrainingRowDto[]
): DepartmentChoice[] {
  const joined = new Set(rows.map(row => row.username));
  const countIn = (id: string) =>
    [...usernamesInDepartment(departments, members, id)].filter(username =>
      joined.has(username)
    ).length;
  const choices = flattenTree(departments)
    .map(row => ({
      id: row.id,
      label: `${"　".repeat(row.depth - 1)}${row.name}`,
      count: countIn(row.id)
    }))
    .filter(choice => choice.count > 0);
  const loose = countIn(UNASSIGNED);
  if (choices.length > 0 && loose > 0) {
    choices.push({ id: UNASSIGNED, label: "还没分部门", count: loose });
  }
  return choices;
}

/** 搜名字、按部门看：名次不重排，筛出来的人还是原来的名次 */
export function filterRows(
  rows: TrainingRowDto[],
  keyword: string,
  inDepartment: ReadonlySet<string> | null
) {
  return rows.filter(
    row =>
      matchesKeyword(row, keyword) &&
      (inDepartment === null || inDepartment.has(row.username))
  );
}

export interface RankingStats {
  /** 已交卷的份数（含待判） */
  submitted: number;
  /** 发出去的份数；普通成员看不出别人发没发，给 null */
  assigned: number | null;
  /** 交了还没判完的份数 */
  pending: number;
}

export function statsOf(ranking: TrainingRankingDto): RankingStats {
  let submitted = 0;
  let pending = 0;
  let assigned = 0;
  for (const row of ranking.rows) {
    submitted += row.submittedCount;
    pending += row.pendingCount;
    assigned += row.cells.filter(cell => cell.state !== "unassigned").length;
  }
  return {
    submitted,
    pending,
    assigned: ranking.canManage ? assigned : null
  };
}

/** 我自己那一行；我不在这次培训里就没有 */
export function myRowOf(ranking: TrainingRankingDto) {
  return ranking.rows.find(row => row.isMe) ?? null;
}

/** 这个人还有几张卷没考完（没开考的、正在答的） */
export function remainingOf(row: TrainingRowDto) {
  return row.cells.filter(
    cell => cell.state === "notStarted" || cell.state === "taking"
  ).length;
}

/** 一格写成字：复制成绩表用 */
export function cellText(cell: TrainingCellDto) {
  if (cell.state === "graded") return String(cell.score ?? 0);
  if (cell.state === "pending") return `${cell.score ?? 0}（待判）`;
  return CELL_STATE_TEXT[cell.state];
}

/** 成绩表：一行一个人、制表符隔开，贴进表格软件正好一格一格 */
export function clipboardTable(
  papers: TrainingPaperDto[],
  rows: TrainingRowDto[]
) {
  const clean = (value: string) => value.replace(/[\t\r\n]+/g, " ");
  const head = ["名次", "姓名", "账号", ...papers.map(paper => paper.title), "总分"];
  const body = rows.map(row => [
    String(row.rank),
    row.displayName,
    row.username,
    ...row.cells.map(cellText),
    String(row.total)
  ]);
  return [head, ...body].map(line => line.map(clean).join("\t")).join("\n");
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * 成绩表的表格版（和上面那份字一起放进剪贴板）：贴进 WPS、Excel 时，名字、账号、状态这些格子标成「文字」——
 * 手机号做的账号不会变成 1.38E+10、开头的 0 不丢，名字开头是 = + - @ 的也不会被当成公式。分数照旧是数。
 */
export function clipboardHtml(
  papers: TrainingPaperDto[],
  rows: TrainingRowDto[]
) {
  const text = (value: string) =>
    `<td style="mso-number-format:'\\@'">${escapeHtml(value)}</td>`;
  const number = (value: number) => `<td>${value}</td>`;
  const head = ["名次", "姓名", "账号", ...papers.map(paper => paper.title), "总分"]
    .map(title => `<th>${escapeHtml(title)}</th>`)
    .join("");
  const body = rows
    .map(
      row =>
        `<tr>${[
          number(row.rank),
          text(row.displayName),
          text(row.username),
          ...row.cells.map(cell =>
            cell.state === "graded"
              ? number(cell.score ?? 0)
              : text(cellText(cell))
          ),
          number(row.total)
        ].join("")}</tr>`
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** 卷名照人读的顺序排：第2课在第10课前面 */
export function sortByTitle<T extends { title: string }>(items: T[]) {
  return [...items].sort((a, b) =>
    a.title.localeCompare(b.title, "zh-CN", { numeric: true })
  );
}

export function formatDeadline(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 一张卷这次发得怎么样 */
export function outcomeText(outcome: TrainingPaperOutcomeDto) {
  switch (outcome.outcome) {
    case "published":
      return `已发布，发给 ${outcome.createdCount} 人`;
    case "assigned":
      return `补发给 ${outcome.createdCount} 人`;
    case "skipped":
      return "已归档，不再发";
    case "failed":
      return outcome.message || "没发出去";
    case "held":
      return "还是草稿，这次没发布";
    default:
      return "参加的人都已经有这张卷";
  }
}

/** 保存完一句话说清：发了几份、收回几份、有没有没发出去的、有没有留着没发布的草稿卷 */
export function saveSummary(result: SaveTrainingResult) {
  const sent = result.papers.reduce(
    (sum, paper) => sum + paper.createdCount,
    0
  );
  const failed = result.papers.filter(paper => paper.outcome === "failed").length;
  const held = result.papers.filter(paper => paper.outcome === "held").length;
  const parts: string[] = [];
  if (sent > 0) {
    parts.push(`新发出 ${sent} 份卷`);
  }
  if (result.revokedCount > 0) {
    parts.push(`收回 ${result.revokedCount} 份没开考的卷`);
  }
  if (failed > 0) {
    parts.push(`有 ${failed} 张卷没发出去`);
  }
  if (held > 0) {
    parts.push(`${held} 张草稿卷这次没发布`);
  }
  return {
    text: parts.length > 0 ? `培训已保存：${parts.join("，")}` : "培训已保存",
    sent,
    failed,
    held
  };
}
