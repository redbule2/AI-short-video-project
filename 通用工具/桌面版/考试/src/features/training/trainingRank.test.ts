// 「培训」排名页的算法测试：格子怎么写、能不能点开、搜名字、按部门看、成绩表、发卷结果。
import { describe, expect, it } from "vitest";
import type { TeamDepartment, TeamMember } from "@/api/team";
import type {
  SaveTrainingResult,
  TrainingCellDto,
  TrainingCellState,
  TrainingPaperDto,
  TrainingRankingDto,
  TrainingRowDto
} from "@/api/training";
import { UNASSIGNED } from "@/features/team/teamTree";
import {
  CELL_STATE_TEXT,
  canOpenSheet,
  cellHint,
  cellText,
  clipboardHtml,
  clipboardTable,
  departmentChoices,
  filterRows,
  formatDeadline,
  isBelowPass,
  matchesKeyword,
  myRowOf,
  outcomeText,
  remainingOf,
  saveSummary,
  sortByTitle,
  statsOf,
  usernamesInDepartment
} from "./trainingRank";

const paper = (
  paperId: string,
  overrides: Partial<TrainingPaperDto> = {}
): TrainingPaperDto => ({
  paperId,
  title: `卷${paperId}`,
  status: "已发布",
  totalScore: 100,
  passScore: 60,
  answersPublished: false,
  ...overrides
});

const cell = (
  state: TrainingCellState,
  overrides: Partial<TrainingCellDto> = {}
): TrainingCellDto => ({
  sheetId: state === "graded" || state === "pending" ? "s1" : null,
  state,
  score: state === "graded" ? 80 : state === "pending" ? 20 : null,
  scoreSource: state === "graded" ? "auto" : null,
  ...overrides
});

const row = (
  username: string,
  cells: TrainingCellDto[],
  overrides: Partial<TrainingRowDto> = {}
): TrainingRowDto => ({
  rank: 1,
  username,
  displayName: `名${username}`,
  removed: false,
  isMe: false,
  total: cells.reduce((sum, item) => sum + (item.score ?? 0), 0),
  submittedCount: cells.filter(
    item => item.state === "graded" || item.state === "pending"
  ).length,
  pendingCount: cells.filter(item => item.state === "pending").length,
  cells,
  ...overrides
});

const dept = (
  id: string,
  name: string,
  parentId: string | null = null,
  sort = 0
): TeamDepartment => ({ id, name, parentId, sort });

const member = (
  username: string,
  departmentId: string | null
): TeamMember => ({
  username,
  displayName: username,
  role: "sub",
  status: "active",
  departmentId,
  title: ""
});

describe("格子怎么写", () => {
  it("有分写分数，待判带上「待判」，别的写状态", () => {
    expect(cellText(cell("graded"))).toBe("80");
    expect(cellText(cell("pending"))).toBe("20（待判）");
    expect(
      (
        ["taking", "notStarted", "absent", "unassigned", "notSubmitted"] as const
      ).map(state => cellText(cell(state)))
    ).toEqual(["答题中", "未考", "缺考", "未发", "未交"]);
    expect(CELL_STATE_TEXT.graded).toBe("");
  });

  it("停上去说清这个分是谁判的、这一格为什么没分", () => {
    expect(cellHint(cell("graded", { scoreSource: "manual" }))).toContain("人工");
    expect(cellHint(cell("graded", { scoreSource: "auto" }))).toContain("AI");
    expect(cellHint(cell("pending"))).toContain("还没判完");
    expect(cellHint(cell("absent"))).toContain("0 分");
    expect(cellHint(cell("unassigned"))).toContain("没有发给");
  });

  it("判完了、没到及格分才标红；待判的、没设及格分的不标", () => {
    expect(isBelowPass(cell("graded", { score: 59 }), paper("p1"))).toBe(true);
    expect(isBelowPass(cell("graded", { score: 60 }), paper("p1"))).toBe(false);
    expect(isBelowPass(cell("pending", { score: 10 }), paper("p1"))).toBe(false);
    expect(
      isBelowPass(cell("graded", { score: 1 }), paper("p1", { passScore: null }))
    ).toBe(false);
  });

  it("负责人随时能点开答卷；别人要等答案公布；没交卷的谁也点不开", () => {
    const hidden = paper("p1");
    const open = paper("p1", { answersPublished: true });
    expect(canOpenSheet(cell("graded"), hidden, true)).toBe(true);
    expect(canOpenSheet(cell("graded"), hidden, false)).toBe(false);
    expect(canOpenSheet(cell("pending"), open, false)).toBe(true);
    expect(canOpenSheet(cell("notStarted"), open, true)).toBe(false);
  });
});

describe("搜名字、按部门看", () => {
  const departments = [
    dept("a", "编导部", null, 1),
    dept("a1", "一组", "a", 1),
    dept("b", "后期部", null, 2),
    dept("empty", "空部门", null, 3)
  ];
  const members = [
    member("amy", "a"),
    member("bob", "a1"),
    member("cat", "b"),
    member("dan", null),
    member("eve", "deleted-dept"),
    member("outsider", "b")
  ];
  const rows = ["amy", "bob", "cat", "dan", "eve"].map((name, index) =>
    row(name, [cell("graded")], { rank: index + 1 })
  );

  it("名字、账号都能搜，不分大小写；没打字全留", () => {
    const amy = row("Amy01", [], { displayName: "小艾" });
    expect(matchesKeyword(amy, "")).toBe(true);
    expect(matchesKeyword(amy, " 艾 ")).toBe(true);
    expect(matchesKeyword(amy, "AMY")).toBe(true);
    expect(matchesKeyword(amy, "博")).toBe(false);
  });

  it("部门连下面的小部门一起算；部门被删掉的人算还没分部门", () => {
    expect([...usernamesInDepartment(departments, members, "a")].sort()).toEqual([
      "amy",
      "bob"
    ]);
    expect([...usernamesInDepartment(departments, members, "a1")]).toEqual([
      "bob"
    ]);
    expect(
      [...usernamesInDepartment(departments, members, UNASSIGNED)].sort()
    ).toEqual(["dan", "eve"]);
  });

  it("「按部门看」只摆有人参加的部门，带缩进和人数，最后是还没分部门的", () => {
    expect(departmentChoices(departments, members, rows)).toEqual([
      { id: "a", label: "编导部", count: 2 },
      { id: "a1", label: "　一组", count: 1 },
      { id: "b", label: "后期部", count: 1 },
      { id: UNASSIGNED, label: "还没分部门", count: 2 }
    ]);
    // 团队没设部门：不摆这个筛选
    expect(departmentChoices([], members, rows)).toEqual([]);
  });

  it("筛出来的人名次不重排", () => {
    const inA = usernamesInDepartment(departments, members, "a");
    expect(filterRows(rows, "", inA).map(item => [item.username, item.rank])).toEqual(
      [
        ["amy", 1],
        ["bob", 2]
      ]
    );
    expect(filterRows(rows, "名c", null).map(item => item.rank)).toEqual([3]);
    expect(filterRows(rows, "bob", new Set(["amy"]))).toEqual([]);
  });
});

describe("这一期的概况", () => {
  const ranking = (canManage: boolean): TrainingRankingDto => ({
    trainingId: "t1",
    name: "第一期",
    description: null,
    deadline: null,
    canManage,
    revision: 1,
    fullScore: 200,
    papers: [paper("p1"), paper("p2")],
    rows: [
      row("amy", [cell("graded"), cell("pending")], { isMe: true }),
      row("bob", [cell("notStarted"), cell("unassigned")]),
      row("cat", [cell("taking"), cell("absent")])
    ],
    serverNow: "2026-11-27T10:00:00"
  });

  it("负责人看得到发了几份、交了几份、几份待判；成员看不出发了几份", () => {
    expect(statsOf(ranking(true))).toEqual({
      submitted: 2,
      pending: 1,
      assigned: 5
    });
    expect(statsOf(ranking(false)).assigned).toBeNull();
  });

  it("找得到我自己那一行；还差几张没考完", () => {
    const mine = myRowOf(ranking(false));
    expect(mine?.username).toBe("amy");
    expect(remainingOf(ranking(true).rows[1])).toBe(1);
    expect(remainingOf(ranking(true).rows[2])).toBe(1);
    expect(remainingOf(mine!)).toBe(0);
    expect(
      myRowOf({ ...ranking(true), rows: ranking(true).rows.slice(1) })
    ).toBeNull();
  });
});

describe("成绩表、卷名、时间", () => {
  it("复制出来一行一个人、制表符隔开，名字里的换行和制表符换成空格", () => {
    const table = clipboardTable(
      [paper("p1", { title: "第1课" }), paper("p2", { title: "第2课\t加试" })],
      [
        row("amy", [cell("graded"), cell("pending")], {
          rank: 1,
          displayName: "小\n艾",
          total: 100
        }),
        row("bob", [cell("absent", { score: 0 }), cell("unassigned")], {
          rank: 2,
          total: 0
        })
      ]
    );
    expect(table.split("\n")).toEqual([
      "名次\t姓名\t账号\t第1课\t第2课 加试\t总分",
      "1\t小 艾\tamy\t80\t20（待判）\t100",
      "2\t名bob\tbob\t缺考\t未发\t0"
    ]);
  });

  it("表格版：分数是数，名字、账号、状态都标成文字——手机号账号不变样、= 开头的名字不当公式、尖括号不当标签", () => {
    const html = clipboardHtml(
      [paper("p1", { title: "第1课<b>" })],
      [
        row("13800001111", [cell("graded")], {
          rank: 1,
          displayName: "=SUM(A1)",
          total: 80
        }),
        row("007", [cell("absent", { score: 0 })], { rank: 2, total: 0 })
      ]
    );
    const text = (value: string) =>
      `<td style="mso-number-format:'\\@'">${value}</td>`;
    expect(html).toBe(
      "<table><thead><tr><th>名次</th><th>姓名</th><th>账号</th><th>第1课&lt;b&gt;</th><th>总分</th></tr></thead><tbody>" +
        `<tr><td>1</td>${text("=SUM(A1)")}${text("13800001111")}<td>80</td><td>80</td></tr>` +
        `<tr><td>2</td>${text("名007")}${text("007")}${text("缺考")}<td>0</td></tr>` +
        "</tbody></table>"
    );
  });

  it("卷名照人读的顺序排，不动原来那份", () => {
    const items = ["第10课", "第2课", "第1课", "附加卷"].map(title => ({ title }));
    expect(sortByTitle(items).map(item => item.title)).toEqual([
      "第1课",
      "第2课",
      "第10课",
      "附加卷"
    ]);
    expect(items[0].title).toBe("第10课");
  });

  it("截止时间写到分；没有或认不出就空着", () => {
    expect(formatDeadline("2026-12-05T18:00:00")).toBe("2026-12-05 18:00");
    expect(formatDeadline(null)).toBe("");
    expect(formatDeadline("不是时间")).toBe("");
  });
});

describe("发卷结果怎么说", () => {
  const result: SaveTrainingResult = {
    trainingId: "t1",
    revokedCount: 2,
    papers: [
      { paperId: "p1", title: "第1课", outcome: "published", createdCount: 30, message: null },
      { paperId: "p2", title: "第2课", outcome: "assigned", createdCount: 3, message: null },
      { paperId: "p3", title: "第3课", outcome: "unchanged", createdCount: 0, message: null },
      { paperId: "p4", title: "第4课", outcome: "skipped", createdCount: 0, message: "已归档，不再发卷。" },
      { paperId: "p5", title: "第5课", outcome: "failed", createdCount: 0, message: "试卷还没有题目,无法发布。" }
    ]
  };

  it("每张卷一句话", () => {
    expect(result.papers.map(outcomeText)).toEqual([
      "已发布，发给 30 人",
      "补发给 3 人",
      "参加的人都已经有这张卷",
      "已归档，不再发",
      "试卷还没有题目,无法发布。"
    ]);
    expect(outcomeText({ ...result.papers[4], message: null })).toBe("没发出去");
  });

  it("保存完一句话：发了几份、收回几份、几张没发出去", () => {
    expect(saveSummary(result)).toEqual({
      text: "培训已保存：新发出 33 份卷，收回 2 份没开考的卷，有 1 张卷没发出去",
      sent: 33,
      failed: 1,
      held: 0
    });
    expect(
      saveSummary({ trainingId: "t1", revokedCount: 0, papers: [result.papers[2]] })
    ).toEqual({ text: "培训已保存", sent: 0, failed: 0, held: 0 });
    // 原来就在培训里的草稿卷这次没让发布：不算失败，但要说一声
    const held = { paperId: "p6", title: "第6课", outcome: "held" as const, createdCount: 0, message: null };
    expect(outcomeText(held)).toBe("还是草稿，这次没发布");
    expect(
      saveSummary({ trainingId: "t1", revokedCount: 0, papers: [result.papers[1], held] })
    ).toEqual({
      text: "培训已保存：新发出 3 份卷，1 张草稿卷这次没发布",
      sent: 3,
      failed: 0,
      held: 1
    });
    // 一份没发出去、还有卷失败：不说「没有要新发的卷」这种自相矛盾的话
    expect(
      saveSummary({ trainingId: "t1", revokedCount: 0, papers: [result.papers[4]] }).text
    ).toBe("培训已保存：有 1 张卷没发出去");
  });
});
