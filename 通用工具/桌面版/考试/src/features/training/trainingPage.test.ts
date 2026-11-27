// 「培训」页和「新建 / 修改培训」小窗的行为测试：每一步问几次服务器（预算只在 performance-budgets.json 里写，
// 这里直接读它来对，不另抄数字），以及选哪一期、筛人、看答卷、保存、删除这些动作对不对。
// 覆盖键：frontend.exam.trainingsPage.enter / trainings.switchTraining / trainings.refresh / trainings.reactivate /
//   trainings.beforeEdit / trainings.sheetDetail / trainings.afterSave / trainings.delete / trainings.afterDelete /
//   trainingEditor.open / trainingEditor.save / trainingEditor.pick
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import performanceBudgets from "../../../quality/performance-budgets.json";

type LifecycleCallback = () => void | Promise<void>;

const lifecycle = vi.hoisted(() => ({
  mounted: [] as LifecycleCallback[],
  activated: [] as LifecycleCallback[]
}));
const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));
const routerPush = vi.hoisted(() => vi.fn(async () => undefined));
const messageMock = vi.hoisted(() => vi.fn());
const copyMock = vi.hoisted(() => vi.fn((_text: string) => true));

const server = vi.hoisted(() => ({
  canManage: true,
  /** 我是谁：排名表里哪一行是「我」 */
  me: "boss",
  trainings: ["t1", "t2"],
  /** 排名读回来是空的（这一期刚被删了） */
  deleted: new Set<string>(),
  /** 每期的修订版本 */
  revision: 7,
  /** 第2课（原来就在第一期里）现在是草稿：负责人把它撤回来改题了 */
  draftInTraining: false,
  /** 第3课被别的培训占了 */
  paperTaken: false,
  confirmOk: true,
  saveFailedPaper: false,
  saveHeldPaper: false,
  saveError: null as null | { kind: string; message: string }
}));

function rankingOf(trainingId: string) {
  const cell = (
    state: string,
    score: number | null,
    sheetId: string | null = null
  ) => ({
    sheetId,
    state,
    score,
    scoreSource: state === "graded" ? "auto" : null
  });
  const row = (
    rank: number,
    username: string,
    displayName: string,
    cells: ReturnType<typeof cell>[]
  ) => ({
    rank,
    username,
    displayName,
    removed: false,
    isMe: username === server.me,
    total: cells.reduce((sum, item) => sum + (item.score ?? 0), 0),
    submittedCount: cells.filter(item => item.sheetId).length,
    pendingCount: cells.filter(item => item.state === "pending").length,
    cells
  });
  return {
    trainingId,
    name: trainingId === "t1" ? "第一期" : "第二期",
    description: null,
    deadline: null,
    canManage: server.canManage,
    revision: server.revision,
    fullScore: 200,
    papers: [
      { paperId: "p1", title: "第1课", status: "已发布", totalScore: 100, passScore: 60, answersPublished: false },
      { paperId: "p2", title: "第2课", status: server.draftInTraining ? "草稿" : "已发布", totalScore: 100, passScore: null, answersPublished: true }
    ],
    rows: [
      row(1, "amy", "小艾", [
        cell("graded", 90, "s-amy-1"),
        cell("graded", 80, "s-amy-2")
      ]),
      row(2, "bob", "小博", [
        cell("graded", 70, "s-bob-1"),
        cell("notStarted", null)
      ]),
      row(3, "boss", "老板", [
        cell("notStarted", null),
        cell("pending", 10, "s-boss-2")
      ])
    ],
    serverNow: "2026-11-27T10:00:00"
  };
}

const team = {
  ownerUsername: "boss",
  teamName: "老板的团队",
  currentUsername: "boss",
  canManage: true,
  departments: [
    { id: "a", name: "编导部", parentId: null, sort: 1 },
    { id: "a1", name: "一组", parentId: "a", sort: 1 }
  ],
  members: [
    { username: "boss", displayName: "老板", role: "owner", status: "active", departmentId: null, title: "" },
    { username: "amy", displayName: "小艾", role: "sub", status: "active", departmentId: "a", title: "编导" },
    { username: "bob", displayName: "小博", role: "sub", status: "active", departmentId: "a1", title: "" },
    { username: "cat", displayName: "小凯", role: "sub", status: "active", departmentId: null, title: "" },
    { username: "dan", displayName: "小丹", role: "sub", status: "disabled", departmentId: "a", title: "" }
  ]
};

function paperOptions() {
  const inFirst = { trainingId: "t1", trainingName: "第一期" };
  const free = { trainingId: null, trainingName: null };
  return {
    truncated: false,
    items: [
      { paperId: "p10", title: "第10课", status: "草稿", questionCount: 5, totalScore: 50, ...free },
      { paperId: "p3", title: "第3课", status: "已发布", questionCount: 10, totalScore: 100, ...(server.paperTaken ? { trainingId: "t-other", trainingName: "别的培训" } : free) },
      { paperId: "p2", title: "第2课", status: server.draftInTraining ? "草稿" : "已发布", questionCount: 10, totalScore: 100, ...inFirst },
      { paperId: "p1", title: "第1课", status: "已发布", questionCount: 10, totalScore: 100, ...inFirst },
      { paperId: "p-empty", title: "空卷", status: "草稿", questionCount: 0, totalScore: 0, ...free },
      { paperId: "p-old", title: "旧卷", status: "已归档", questionCount: 3, totalScore: 30, ...free }
    ]
  };
}

const ok = (data: unknown) => ({ success: true, message: "", data });

const httpRequest = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined)
);

function respond(method: string, url: string) {
  if (url === "/api/collaboration/team") return ok(team);
  if (url === "/api/exam/trainings/paper-options") return ok(paperOptions());
  if (url === "/api/exam/trainings" && method === "get") {
    return ok({
      canManage: server.canManage,
      items: server.trainings
        .filter(id => !server.deleted.has(id))
        .map(id => ({
          trainingId: id,
          name: id === "t1" ? "第一期" : "第二期",
          description: null,
          deadline: null,
          paperCount: 2,
          memberCount: 3,
          createdAt: "2026-11-27T09:00:00",
          updatedAt: null
        }))
    });
  }
  const ranking = url.match(/^\/api\/exam\/trainings\/([^/]+)\/ranking$/);
  if (ranking && method === "get") {
    return ok(server.deleted.has(ranking[1]) ? null : rankingOf(ranking[1]));
  }
  if (method === "post" || method === "put") {
    if (server.saveError) {
      return {
        success: false,
        message: server.saveError.message,
        data: null,
        error: { kind: server.saveError.kind }
      };
    }
    const second = server.saveFailedPaper
      ? { paperId: "p10", title: "第10课", outcome: "failed", createdCount: 0, message: "试卷还没有题目,无法发布。" }
      : server.saveHeldPaper
        ? { paperId: "p2", title: "第2课", outcome: "held", createdCount: 0, message: "还是草稿，这次没有发布；要发就勾上「一起发布」再保存。" }
        : { paperId: "p10", title: "第10课", outcome: "published", createdCount: 2, message: null };
    return ok({
      trainingId: method === "post" ? "t-new" : "t1",
      revokedCount: 0,
      papers: [
        { paperId: "p1", title: "第1课", outcome: "assigned", createdCount: 2, message: null },
        second
      ]
    });
  }
  if (method === "delete") {
    const id = url.split("/").pop()!;
    server.deleted.add(id);
    return ok(null);
  }
  throw new Error(`没料到的请求：${method} ${url}`);
}

vi.mock("vue", async importOriginal => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    // 页面是缓存着的：切回来要重读。真实组件外拿不到实例，这里造一个假的让 onActivated 那一支可测
    getCurrentInstance: () => ({}) as never,
    onMounted: (callback: LifecycleCallback) => {
      lifecycle.mounted.push(callback);
    },
    onActivated: (callback: LifecycleCallback) => {
      lifecycle.activated.push(callback);
    }
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/exam/trainings", query: routeState.query }),
  useRouter: () => ({ push: routerPush })
}));

vi.mock("@/utils/http", () => ({ http: { request: httpRequest } }));
vi.mock("@/utils/message", () => ({ message: messageMock }));

vi.mock("element-plus", () => ({
  ElMessageBox: {
    confirm: vi.fn(async () => {
      if (!server.confirmOk) throw new Error("cancel");
      return "confirm";
    })
  }
}));

vi.mock("@pureadmin/utils", () => ({ copyTextToClipboard: copyMock }));

const budgets = performanceBudgets.budgets as Record<string, number>;

/** 等这一串请求走完：假服务器当场就回，让出一轮就都走完了 */
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 0));

/** 进页面：把 onMounted 里登记的事跑一遍（页面里是「void enter()」，不等它，所以要再让出一轮） */
async function flushMounted() {
  for (const callback of lifecycle.mounted) {
    await callback();
  }
  await settle();
}

/** 切走再切回来 */
async function flushActivated() {
  for (const callback of lifecycle.activated) {
    await callback();
  }
  await settle();
}

const urls = () => httpRequest.mock.calls.map(call => `${call[0]} ${call[1]}`);
const lastBody = () =>
  (
    httpRequest.mock.calls.filter(
      call => call[0] === "post" || call[0] === "put"
    ).at(-1)?.[2] as { data: Record<string, unknown> }
  ).data;

beforeEach(() => {
  httpRequest.mockReset();
  httpRequest.mockImplementation(async (...args: unknown[]) =>
    respond(String(args[0]), String(args[1]))
  );
  routerPush.mockClear();
  messageMock.mockClear();
  copyMock.mockClear();
  lifecycle.mounted.length = 0;
  lifecycle.activated.length = 0;
  routeState.query = {};
  Object.assign(server, {
    canManage: true,
    me: "boss",
    trainings: ["t1", "t2"],
    revision: 7,
    draftInTraining: false,
    paperTaken: false,
    confirmOk: true,
    saveFailedPaper: false,
    saveHeldPaper: false,
    saveError: null
  });
  server.deleted.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountPage() {
  const { useTrainings } = await import("./useTrainings");
  const page = useTrainings();
  await flushMounted();
  return page;
}

describe("「培训」页问几次服务器", () => {
  it("trainingsPage.enter: 进页面 = 列表 1 + 头一期的排名 1 + 团队部门 1，一个接一个", async () => {
    const page = await mountPage();
    expect(urls()).toEqual([
      "get /api/exam/trainings",
      "get /api/exam/trainings/t1/ranking",
      "get /api/collaboration/team"
    ]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainingsPage.enter"]
    );
    expect(page.selectedId.value).toBe("t1");
    expect(page.ranking.value?.name).toBe("第一期");
    expect(page.canManage.value).toBe(true);
    expect(page.rankingReady.value).toBe(true);
  });

  it("地址里带着哪一期就停在哪一期（从答卷回来、刚保存完）", async () => {
    routeState.query = { trainingId: "t2" };
    const page = await mountPage();
    expect(page.selectedId.value).toBe("t2");
    expect(urls()[1]).toBe("get /api/exam/trainings/t2/ranking");
  });

  it("trainings.switchTraining: 换一期只读那一期的排名 1 次，搜的字和部门清掉；读回来以前不让改、不让删", async () => {
    const page = await mountPage();
    page.keyword.value = "小艾";
    page.departmentId.value = "a";
    httpRequest.mockClear();

    page.selectTraining("t2");
    // 新一期还没读回来：屏幕上不留旧的那张表，「修改」「删除」先灰着
    expect(page.ranking.value).toBeNull();
    expect(page.rankingReady.value).toBe(false);
    await settle();
    expect(urls()).toEqual(["get /api/exam/trainings/t2/ranking"]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.switchTraining"]
    );
    expect([page.keyword.value, page.departmentId.value]).toEqual(["", ""]);
    expect(page.ranking.value?.name).toBe("第二期");
    expect(page.rankingReady.value).toBe(true);
  });

  it("trainings.refresh: 点刷新 = 列表 1 + 排名 1，别人刚建的一期也看得到", async () => {
    const page = await mountPage();
    server.trainings = ["t-new", "t1", "t2"];
    httpRequest.mockClear();
    await page.refresh();
    expect(urls()).toEqual([
      "get /api/exam/trainings",
      "get /api/exam/trainings/t1/ranking"
    ]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.refresh"]
    );
    expect(page.trainings.value.map(item => item.trainingId)).toEqual([
      "t-new",
      "t1",
      "t2"
    ]);
    // 还停在原来看的那一期
    expect(page.selectedId.value).toBe("t1");
  });

  it("trainings.reactivate: 这一页是缓存着的，切走再切回来重读列表 1 + 排名 1；刚进页面那一下不重复读", async () => {
    const { useTrainings } = await import("./useTrainings");
    const page = useTrainings();
    // 头一回进页面：onMounted、onActivated 挨着来，只该读进页面那一串
    for (const callback of lifecycle.mounted) await callback();
    for (const callback of lifecycle.activated) await callback();
    await settle();
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainingsPage.enter"]
    );

    // 昨天看的时候只有两期；今天负责人又建了一期，切回来就该看到
    server.trainings = ["t-new", "t1", "t2"];
    httpRequest.mockClear();
    await flushActivated();
    expect(urls()).toEqual([
      "get /api/exam/trainings",
      "get /api/exam/trainings/t1/ranking"
    ]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.reactivate"]
    );
    expect(page.trainings.value).toHaveLength(3);
  });

  it("trainings.beforeEdit: 点「修改」先把这一期重读 1 次，拿最新的名单和版本当底稿", async () => {
    const page = await mountPage();
    // 别处刚改过：版本涨了
    server.revision = 8;
    httpRequest.mockClear();
    const fresh = await page.freshForEdit();
    expect(urls()).toEqual(["get /api/exam/trainings/t1/ranking"]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.beforeEdit"]
    );
    expect(fresh?.revision).toBe(8);
    expect(page.ranking.value?.revision).toBe(8);
  });

  it("点「修改」时这一期已经被别人删了：不开小窗，列表里拿掉它", async () => {
    const page = await mountPage();
    server.deleted.add("t1");
    const fresh = await page.freshForEdit();
    expect(fresh).toBeNull();
    expect(page.trainings.value.map(item => item.trainingId)).toEqual(["t2"]);
    expect(page.selectedId.value).toBe("t2");
  });

  it("trainings.sheetDetail: 负责人点分数只跳去看答卷（成绩总览那一面），带上回培训的路，本页不问服务器", async () => {
    const page = await mountPage();
    httpRequest.mockClear();
    const ranking = page.ranking.value!;
    const amy = ranking.rows[0];
    page.openSheet(amy, amy.cells[0], ranking.papers[0]);

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.sheetDetail"]
    );
    expect(routerPush).toHaveBeenCalledWith({
      name: "ExamReview",
      query: {
        sheetId: "s-amy-1",
        source: "results",
        paperId: "p1",
        from: "training",
        trainingId: "t1"
      }
    });
    // 负责人不用等答案公布；没交卷的格子点不开
    expect(page.cellOpenable(amy.cells[0], ranking.papers[0])).toBe(true);
    const bob = ranking.rows[1];
    routerPush.mockClear();
    page.openSheet(bob, bob.cells[1], ranking.papers[1]);
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("普通成员：答案没公布的卷点不开；看自己的卷走考生那一面，看别人的走成绩总览那一面", async () => {
    server.canManage = false;
    server.me = "amy";
    const page = await mountPage();
    const ranking = page.ranking.value!;
    const [amy, bob] = ranking.rows;

    expect(page.cellOpenable(amy.cells[0], ranking.papers[0])).toBe(false);
    page.openSheet(amy, amy.cells[0], ranking.papers[0]);
    expect(routerPush).not.toHaveBeenCalled();

    page.openSheet(amy, amy.cells[1], ranking.papers[1]);
    expect(routerPush).toHaveBeenLastCalledWith({
      name: "ExamReview",
      query: { sheetId: "s-amy-2", from: "training", trainingId: "t1" }
    });

    const published = { ...ranking.papers[0], answersPublished: true };
    page.openSheet(bob, bob.cells[0], published);
    expect(routerPush).toHaveBeenLastCalledWith({
      name: "ExamReview",
      query: {
        sheetId: "s-bob-1",
        source: "results",
        paperId: "p1",
        from: "training",
        trainingId: "t1"
      }
    });
    expect(page.myRow.value?.username).toBe("amy");
  });

  it("trainings.afterSave: 保存完重读列表 1 + 排名 1，停在刚保存的那一期；换过去以前旧的那张表先撤掉", async () => {
    const page = await mountPage();
    server.trainings = ["t-new", "t1", "t2"];
    httpRequest.mockClear();
    const saving = page.afterSaved("t-new");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // 列表刚读回来、新一期的排名还没到：不能名字是新的、表还是旧的那一期
    if (page.selectedId.value === "t-new") {
      expect(page.ranking.value?.trainingId ?? "t-new").toBe("t-new");
    }
    await saving;
    expect(urls()).toEqual([
      "get /api/exam/trainings",
      "get /api/exam/trainings/t-new/ranking"
    ]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.afterSave"]
    );
    expect(page.selectedId.value).toBe("t-new");
    expect(page.rankingReady.value).toBe(true);
  });

  it("没说是哪一期就重读（不知道存没存上时）：留在原来看的那一期", async () => {
    const page = await mountPage();
    page.selectTraining("t2");
    await settle();
    httpRequest.mockClear();
    await page.afterSaved("");
    expect(urls()).toEqual([
      "get /api/exam/trainings",
      "get /api/exam/trainings/t2/ranking"
    ]);
    expect(page.selectedId.value).toBe("t2");
  });

  it("trainings.delete: 问过以后删 1 次，再重读列表 1 + 剩下头一期的排名 1；点取消什么都不发", async () => {
    const page = await mountPage();
    httpRequest.mockClear();
    server.confirmOk = false;
    await page.remove();
    expect(httpRequest).not.toHaveBeenCalled();

    server.confirmOk = true;
    await page.remove();
    expect(urls()).toEqual([
      "delete /api/exam/trainings/t1",
      "get /api/exam/trainings",
      "get /api/exam/trainings/t2/ranking"
    ]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainings.delete"] +
        budgets["frontend.exam.trainings.afterDelete"]
    );
    expect(page.selectedId.value).toBe("t2");
    expect(page.trainings.value.map(item => item.trainingId)).toEqual(["t2"]);
  });

  it("排名还没读回来时点不动删除：不会照着旧表删错一期", async () => {
    const page = await mountPage();
    page.selectTraining("t2");
    httpRequest.mockClear();
    // 第二期的排名还在路上
    await page.remove();
    expect(urls()).not.toContain("delete /api/exam/trainings/t2");
    await settle();
  });

  it("这一期刚被别人删了：从列表里拿掉，换到剩下的头一期", async () => {
    server.deleted.add("t1");
    httpRequest.mockImplementation(async (...args: unknown[]) => {
      const [method, url] = [String(args[0]), String(args[1])];
      // 列表还是旧的（两期都在），排名读回来才发现 t1 没了
      if (url === "/api/exam/trainings" && method === "get") {
        server.deleted.clear();
        const stale = respond(method, url);
        server.deleted.add("t1");
        return stale;
      }
      return respond(method, url);
    });
    const page = await mountPage();
    expect(page.trainings.value.map(item => item.trainingId)).toEqual(["t2"]);
    expect(page.selectedId.value).toBe("t2");
    expect(page.ranking.value?.name).toBe("第二期");
  });

  it("一期培训都没有：不读排名，摆空态", async () => {
    server.trainings = [];
    const page = await mountPage();
    expect(page.isEmpty.value).toBe(true);
    expect(page.ranking.value).toBeNull();
    expect(urls()).toEqual(["get /api/exam/trainings", "get /api/collaboration/team"]);
  });
});

describe("搜名字、按部门看、复制成绩表都在本机做", () => {
  it("筛人不问服务器，名次不变；「看全部」清掉筛选", async () => {
    const page = await mountPage();
    httpRequest.mockClear();

    expect(page.departments.value).toEqual([
      { id: "a", label: "编导部", count: 2 },
      { id: "a1", label: "　一组", count: 1 },
      { id: "__unassigned__", label: "还没分部门", count: 1 }
    ]);
    page.departmentId.value = "a";
    expect(page.visibleRows.value.map(row => [row.username, row.rank])).toEqual([
      ["amy", 1],
      ["bob", 2]
    ]);
    page.keyword.value = "博";
    expect(page.visibleRows.value.map(row => row.username)).toEqual(["bob"]);
    expect(page.filtering.value).toBe(true);

    page.clearFilters();
    expect(page.visibleRows.value).toHaveLength(3);
    expect(page.filtering.value).toBe(false);
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("复制的是眼前筛出来的那几行；放不了表格的环境就只放字", async () => {
    const page = await mountPage();
    page.keyword.value = "小艾";
    await page.copyTable();
    expect(copyMock).toHaveBeenCalledTimes(1);
    expect(copyMock.mock.calls[0][0].split("\n")).toEqual([
      "名次\t姓名\t账号\t第1课\t第2课\t总分",
      "1\t小艾\tamy\t90\t80\t170"
    ]);
    expect(messageMock).toHaveBeenLastCalledWith(
      expect.stringContaining("已复制 1 人"),
      { type: "success" }
    );
  });

  it("能放表格的环境：字和表格各放一份，表格那份账号是文字（手机号不变样）", async () => {
    const written: Record<string, Blob>[] = [];
    vi.stubGlobal(
      "ClipboardItem",
      class {
        constructor(public items: Record<string, Blob>) {
          written.push(items);
        }
      }
    );
    vi.stubGlobal("navigator", { clipboard: { write: vi.fn(async () => undefined) } });
    const page = await mountPage();
    await page.copyTable();

    expect(copyMock).not.toHaveBeenCalled();
    expect(Object.keys(written[0]).sort()).toEqual(["text/html", "text/plain"]);
    const html = await written[0]["text/html"].text();
    expect(html).toContain(`<td style="mso-number-format:'\\@'">amy</td>`);
    expect(await written[0]["text/plain"].text()).toContain("名次\t姓名\t账号");
    expect(messageMock).toHaveBeenLastCalledWith(
      expect.stringContaining("已复制 3 人"),
      { type: "success" }
    );
  });

  it("概况：交了几份、几份待判、我第几名、我还差几张", async () => {
    const page = await mountPage();
    expect(page.stats.value).toEqual({ submitted: 4, pending: 1, assigned: 6 });
    expect([page.myRow.value?.rank, page.myRemaining.value]).toEqual([3, 1]);
  });
});

async function openEditor() {
  const { useTrainingEditor } = await import("./useTrainingEditor");
  const onSaved = vi.fn();
  const editor = useTrainingEditor(onSaved);
  return { editor, onSaved };
}

/** 要改的第一期：两张卷、三个人（小丹后来被停用了） */
const editingFirst = (overrides: Record<string, unknown> = {}) => ({
  trainingId: "t1",
  name: "第一期",
  description: null,
  deadline: null as string | null,
  revision: 7,
  papers: [
    { paperId: "p1", title: "第1课", status: "已发布", totalScore: 100 },
    { paperId: "p2", title: "第2课", status: server.draftInTraining ? "草稿" : "已发布", totalScore: 100 }
  ],
  members: [
    { username: "amy", displayName: "小艾" },
    { username: "bob", displayName: "小博" },
    { username: "dan", displayName: "小丹" }
  ],
  ...overrides
});

const choiceOf = (
  editor: Awaited<ReturnType<typeof openEditor>>["editor"],
  paperId: string
) => editor.paperChoices.value.find(choice => choice.option.paperId === paperId)!;

describe("「新建 / 修改培训」小窗", () => {
  it("trainingEditor.open: 打开 = 选卷清单 1 + 团队成员和部门 1；新建默认勾全体在岗成员", async () => {
    const { editor } = await openEditor();
    await editor.openCreate();
    expect(urls()).toEqual([
      "get /api/exam/trainings/paper-options",
      "get /api/collaboration/team"
    ]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainingEditor.open"]
    );
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "bob", "cat"]);
    expect(editor.pickedPapers.value.size).toBe(0);
    expect(editor.isEdit.value).toBe(false);
    expect(editor.canSave.value).toBe(false);
    // 负责人自己单摆一组、默认不勾
    expect(editor.groups.value.map(group => group.id)).toEqual([
      "a",
      "a1",
      "__unassigned__",
      "__owner__"
    ]);
    // 能勾的排前面、照人读卷名的顺序；勾不了的沉到底下
    expect(
      editor.paperChoices.value.map(choice => [choice.option.title, choice.blocked])
    ).toEqual([
      ["第3课", ""],
      ["第10课", ""],
      ["第1课", "已在「第一期」里"],
      ["第2课", "已在「第一期」里"],
      ["旧卷", "已归档，不能再发"],
      ["空卷", "还没有题目"]
    ]);
  });

  it("勾不了的卷勾不上；原来就在培训里的卷（哪怕已归档、没出题）不拦，去掉了还能勾回来", async () => {
    const { editor } = await openEditor();
    await editor.openCreate();
    for (const choice of editor.paperChoices.value) editor.togglePaper(choice);
    expect([...editor.pickedPapers.value].sort()).toEqual(["p10", "p3"]);

    const { paperBlockedReason } = await import("./useTrainingEditor");
    const archived = paperOptions().items[5];
    expect(paperBlockedReason(archived, "t1", true)).toBe("");
    expect(paperBlockedReason(archived, "t1", false)).toBe("已归档，不能再发");
    // 在这次培训自己名下的卷不算「被占」
    expect(paperBlockedReason(paperOptions().items[3], "t1", false)).toBe("");

    // 已经勾着的卷后来变成勾不了的（清单读新以后）：照样能去掉
    editor.togglePaper({ option: choiceOf(editor, "p3").option, blocked: "已在「别的培训」里" });
    expect(editor.pickedPapers.value.has("p3")).toBe(false);
    editor.togglePaper({ option: choiceOf(editor, "p3").option, blocked: "已在「别的培训」里" });
    expect(editor.pickedPapers.value.has("p3")).toBe(false);
  });

  it("trainingEditor.pick: 勾卷、勾人、勾部门、全选、清空、搜名字都不问服务器", async () => {
    const { editor } = await openEditor();
    await editor.openCreate();
    httpRequest.mockClear();

    editor.clearAll();
    expect(editor.pickedPeople.value.size).toBe(0);

    // 勾上级部门：连下面小组的人一起勾上；再点一次一起去掉
    const dept = editor.groups.value.find(group => group.id === "a")!;
    editor.toggleGroup(dept);
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "bob"]);
    editor.toggleGroup(dept);
    expect(editor.pickedPeople.value.size).toBe(0);

    // 搜名字时「全选」只勾搜出来的，搜到的组自动摊开
    editor.peopleKeyword.value = "小凯";
    expect(editor.groups.value.map(group => group.id)).toEqual(["__unassigned__"]);
    expect(editor.isExpanded("__unassigned__")).toBe(true);
    editor.selectAll();
    expect([...editor.pickedPeople.value]).toEqual(["cat"]);

    // 全选 = 全体成员；负责人自己不带，要参加单独勾
    editor.peopleKeyword.value = "";
    editor.selectAll();
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "bob", "cat"]);
    editor.togglePerson("boss");
    expect(editor.pickedPeople.value.has("boss")).toBe(true);
    // 清空连负责人自己一起去掉
    editor.clearAll();
    expect(editor.pickedPeople.value.size).toBe(0);

    editor.toggleExpand("a");
    const wasOpen = editor.isExpanded("a");
    editor.toggleExpand("a");
    expect(editor.isExpanded("a")).toBe(!wasOpen);

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainingEditor.pick"]
    );
  });

  it("trainingEditor.save: 新建只发 1 次，卷照卷名的顺序给，成了就关上、说清发了几份", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openCreate();
    editor.name.value = "  第三期  ";
    editor.description.value = "  ";
    for (const choice of editor.paperChoices.value) editor.togglePaper(choice);
    httpRequest.mockClear();

    expect(editor.canSave.value).toBe(true);
    expect(editor.hint.value).toContain("2 张卷会发给勾上的 3 人");
    await editor.save();

    expect(urls()).toEqual(["post /api/exam/trainings"]);
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.trainingEditor.save"]
    );
    expect(lastBody()).toEqual({
      name: "第三期",
      description: null,
      deadline: null,
      paperIds: ["p3", "p10"],
      usernames: ["amy", "bob", "cat"],
      expectedRevision: null,
      publishExistingDrafts: false
    });
    expect(editor.visible.value).toBe(false);
    expect(onSaved).toHaveBeenCalledWith("t-new");
    expect(messageMock).toHaveBeenLastCalledWith(
      "培训已保存：新发出 4 份卷",
      expect.objectContaining({ type: "success" })
    );
  });

  it("没起名字、没勾卷、没勾人、新填的截止时间已过：都不发请求，各说各的", async () => {
    const { editor } = await openEditor();
    await editor.openCreate();
    httpRequest.mockClear();

    await editor.save();
    expect(messageMock).toHaveBeenLastCalledWith(expect.stringContaining("名字"), { type: "warning" });

    editor.name.value = "第三期";
    await editor.save();
    expect(messageMock).toHaveBeenLastCalledWith(expect.stringContaining("试卷"), { type: "warning" });

    editor.togglePaper(editor.paperChoices.value[0]);
    editor.clearAll();
    await editor.save();
    expect(messageMock).toHaveBeenLastCalledWith(expect.stringContaining("参加的人"), { type: "warning" });

    editor.selectAll();
    editor.deadline.value = "2020-01-01T00:00:00";
    await editor.save();
    expect(messageMock).toHaveBeenLastCalledWith(expect.stringContaining("截止时间"), { type: "warning" });

    expect(httpRequest).not.toHaveBeenCalled();
    expect(editor.visible.value).toBe(true);
  });

  it("修改：名单、试卷照原样勾上；已停用的人单摆一组、默认留着；说清这回加了谁、去了谁；带上版本", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openEdit(editingFirst());

    expect(editor.isEdit.value).toBe(true);
    expect(editor.name.value).toBe("第一期");
    expect([...editor.pickedPapers.value].sort()).toEqual(["p1", "p2"]);
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "bob", "dan"]);
    const gone = editor.groups.value.at(-1)!;
    expect([gone.id, gone.people.map(person => person.username)]).toEqual(["__gone__", ["dan"]]);
    expect(editor.hint.value).toBe("保存后：手上缺卷的人会补发，已经有卷的人不重发。");
    expect(editor.isDirty()).toBe(false);
    // 在这期培训里的卷排在能勾的那一段
    expect(choiceOf(editor, "p1").blocked).toBe("");

    editor.togglePerson("bob");
    editor.togglePerson("cat");
    editor.togglePaper(choiceOf(editor, "p10"));
    editor.togglePaper(choiceOf(editor, "p2"));
    expect(editor.changes.value).toEqual({
      addedPeople: 1,
      removedPeople: 1,
      addedPapers: 1,
      removedPapers: 1
    });
    expect(editor.hint.value).toBe(
      "保存后：新加的 1 人会收到全部卷；新加的 1 张卷会发给所有参加的人；去掉的 1 人不进排名，还没开考的卷会收回；去掉的 1 张卷不再算进排名（卷和成绩都还在）。手上缺卷的人会补发。"
    );
    expect(editor.isDirty()).toBe(true);

    httpRequest.mockClear();
    await editor.save();
    expect(urls()).toEqual(["put /api/exam/trainings/t1"]);
    expect(lastBody()).toMatchObject({
      usernames: ["amy", "dan", "cat"],
      paperIds: ["p1", "p10"],
      expectedRevision: 7,
      publishExistingDrafts: false
    });
    expect(onSaved).toHaveBeenCalledWith("t1");
  });

  it("「清空」不带走已停用或离开的人——他们去掉了就加不回来，要去掉得单独点", async () => {
    const { editor } = await openEditor();
    await editor.openEdit(editingFirst());
    editor.clearAll();
    expect([...editor.pickedPeople.value]).toEqual(["dan"]);
    editor.selectAll();
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "bob", "cat", "dan"]);
    editor.togglePerson("dan");
    expect(editor.pickedPeople.value.has("dan")).toBe(false);
  });

  it("截止时间：原来的过了期也原样留着、照样能改名字；新改的不许是过去的", async () => {
    const { editor } = await openEditor();
    await editor.openEdit(editingFirst({ deadline: "2020-01-01T00:00:00" }));
    // 不因为过了期就悄悄清掉
    expect(editor.deadline.value).toBe("2020-01-01T00:00:00");
    expect(editor.deadlineExpired.value).toBe(true);
    expect(editor.isDirty()).toBe(false);

    editor.name.value = "第一期（收官）";
    httpRequest.mockClear();
    await editor.save();
    expect(urls()).toEqual(["put /api/exam/trainings/t1"]);
    expect(lastBody().deadline).toBe("2020-01-01T00:00:00");

    // 改成另一个过去的时间：这是新填的，前端直接拦
    await editor.openEdit(editingFirst({ deadline: "2020-01-01T00:00:00" }));
    editor.deadline.value = "2021-01-01T00:00:00";
    expect(editor.deadlineExpired.value).toBe(false);
    httpRequest.mockClear();
    await editor.save();
    expect(httpRequest).not.toHaveBeenCalled();
    expect(messageMock).toHaveBeenLastCalledWith(expect.stringContaining("截止时间"), { type: "warning" });

    // 没到期的原样带着，也不算过期
    await editor.openEdit(editingFirst({ deadline: "2999-01-01T00:00:00" }));
    expect([editor.deadline.value, editor.deadlineExpired.value]).toEqual(["2999-01-01T00:00:00", false]);
  });

  it("截止时间过了又要发新卷：后台拦下来，把话原样告诉人，小窗不关、勾好的不丢", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openEdit(editingFirst({ deadline: "2020-01-01T00:00:00" }));
    editor.togglePerson("cat");
    server.saveError = { kind: "training-deadline-passed", message: "截止时间已经过了：改晚一点或清空，才能把卷发出去。" };
    await editor.save();
    expect(editor.visible.value).toBe(true);
    expect(editor.pickedPeople.value.has("cat")).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(messageMock).toHaveBeenLastCalledWith(
      "截止时间已经过了：改晚一点或清空，才能把卷发出去。",
      expect.objectContaining({ type: "error" })
    );
  });

  it("原来就在培训里的草稿卷：默认不顺手发布，勾了「一起发布」才发；把它去掉就不提了", async () => {
    server.draftInTraining = true;
    const { editor } = await openEditor();
    await editor.openEdit(editingFirst());
    expect(editor.existingDrafts.value).toEqual(["第2课"]);
    expect(editor.publishExistingDrafts.value).toBe(false);
    expect(editor.hint.value).toBe("保存后：1 张草稿卷先不发布。手上缺卷的人会补发。");

    server.saveHeldPaper = true;
    await editor.save();
    expect(lastBody().publishExistingDrafts).toBe(false);
    // 留着没发布不算失败：小窗关上，提示里说一声
    expect(editor.visible.value).toBe(false);
    expect(messageMock).toHaveBeenLastCalledWith(
      "培训已保存：新发出 2 份卷，1 张草稿卷这次没发布",
      expect.objectContaining({ type: "success" })
    );

    server.saveHeldPaper = false;
    await editor.openEdit(editingFirst());
    editor.publishExistingDrafts.value = true;
    expect(editor.hint.value).toBe("保存后：1 张草稿卷会一起发布。手上缺卷的人会补发。");
    expect(editor.isDirty()).toBe(true);
    await editor.save();
    expect(lastBody().publishExistingDrafts).toBe(true);

    // 这次新勾进来的草稿卷不归这个开关管（一律发布），所以只勾新草稿时不摆这个开关
    await editor.openEdit(editingFirst());
    editor.togglePaper(choiceOf(editor, "p2"));
    editor.togglePaper(choiceOf(editor, "p10"));
    expect(editor.existingDrafts.value).toEqual([]);
    editor.publishExistingDrafts.value = true;
    await editor.save();
    expect(lastBody().publishExistingDrafts).toBe(false);
  });

  it("选卷清单没给全（试卷太多）：原来就在培训里的卷照样摆着、勾着，保存时不会被悄悄拿出培训", async () => {
    const { editor } = await openEditor();
    await editor.openEdit(
      editingFirst({
        papers: [
          { paperId: "p1", title: "第1课", status: "已发布", totalScore: 100 },
          { paperId: "p-ancient", title: "第0课_老卷", status: "已归档", totalScore: 40 }
        ]
      })
    );
    const ancient = choiceOf(editor, "p-ancient");
    expect([ancient.blocked, ancient.option.questionCount, ancient.option.totalScore]).toEqual(["", -1, 40]);
    expect(editor.pickedScore.value).toBe(140);
    editor.name.value = "第一期（改名）";
    await editor.save();
    expect(lastBody().paperIds).toEqual(["p-ancient", "p1"]);

    // 真要去掉它：底下那句话会说去掉了 1 张卷
    await editor.openEdit(
      editingFirst({
        papers: [
          { paperId: "p1", title: "第1课", status: "已发布", totalScore: 100 },
          { paperId: "p-ancient", title: "第0课_老卷", status: "已归档", totalScore: 40 }
        ]
      })
    );
    editor.togglePaper(choiceOf(editor, "p-ancient"));
    expect(editor.changes.value.removedPapers).toBe(1);
    expect(editor.hint.value).toContain("去掉的 1 张卷不再算进排名");
  });

  it("有卷没发出去：小窗不关，把每张卷的结果摆出来，页面照样刷新", async () => {
    server.saveFailedPaper = true;
    const { editor, onSaved } = await openEditor();
    await editor.openCreate();
    editor.name.value = "第三期";
    editor.togglePaper(editor.paperChoices.value[0]);
    await editor.save();

    expect(editor.visible.value).toBe(true);
    expect(editor.outcome.value?.papers.map(paper => paper.outcome)).toEqual(["assigned", "failed"]);
    expect(onSaved).toHaveBeenCalledWith("t-new");
    expect(messageMock).toHaveBeenLastCalledWith(
      expect.stringContaining("有 1 张卷没发出去"),
      expect.objectContaining({ type: "warning" })
    );
    // 已经保存过了：再关小窗不用问「不保存就关掉？」
    expect(editor.isDirty()).toBe(false);
  });

  it("保存时有卷刚被别的培训占了：只把选卷清单读新 1 次，那张卷去掉勾，勾好的人不动", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openCreate();
    editor.name.value = "第三期";
    for (const choice of editor.paperChoices.value) editor.togglePaper(choice);
    editor.togglePerson("cat");
    server.saveError = { kind: "training-paper-taken", message: "「第3课」已经在培训「别的培训」里，一张卷只能放进一个培训。" };
    server.paperTaken = true;
    httpRequest.mockClear();

    await editor.save();
    expect(urls()).toEqual([
      "post /api/exam/trainings",
      "get /api/exam/trainings/paper-options"
    ]);
    expect([...editor.pickedPapers.value]).toEqual(["p10"]);
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "bob"]);
    expect(choiceOf(editor, "p3").blocked).toBe("已在「别的培训」里");
    expect(editor.visible.value).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    expect(messageMock).toHaveBeenCalledWith(
      expect.stringContaining("一张卷只能放进一个培训"),
      expect.objectContaining({ type: "error" })
    );
  });

  it("这期培训在别处刚改过（版本对不上）：不硬存，关上小窗、叫页面读新的，免得冲掉那边的改动", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openEdit(editingFirst());
    editor.togglePerson("bob");
    server.saveError = { kind: "training-stale", message: "这期培训刚刚在别处改过，请刷新后再改，免得把那边的改动冲掉。" };
    await editor.save();
    expect(editor.visible.value).toBe(false);
    expect(onSaved).toHaveBeenCalledWith("t1");
    expect(messageMock).toHaveBeenLastCalledWith(
      expect.stringContaining("刚刚在别处改过"),
      expect.objectContaining({ type: "error" })
    );
  });

  it("要改的那一期已经被删了：关上小窗，叫页面重读", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openEdit(editingFirst());
    server.saveError = { kind: "training-not-found", message: "培训不存在或已删除，请刷新后重试。" };
    await editor.save();
    expect(editor.visible.value).toBe(false);
    expect(onSaved).toHaveBeenCalledWith("");
  });

  it("没收到服务器的回话（断网、等太久）：不知道存没存上——小窗留着、勾好的不丢，先叫页面把列表读新", async () => {
    const { editor, onSaved } = await openEditor();
    await editor.openCreate();
    editor.name.value = "第三期";
    editor.togglePaper(editor.paperChoices.value[0]);
    httpRequest.mockImplementationOnce(async () => {
      throw new Error("连不上服务器，看看网络");
    });
    await editor.save();

    expect(editor.visible.value).toBe(true);
    expect(editor.name.value).toBe("第三期");
    expect(editor.pickedPapers.value.size).toBe(1);
    expect(onSaved).toHaveBeenCalledWith("");
    expect(messageMock).toHaveBeenLastCalledWith(
      expect.stringContaining("不知道存没存上"),
      expect.objectContaining({ type: "warning" })
    );
    // 还能再点保存
    expect(editor.canSave.value).toBe(true);
  });

  it("关小窗：没改过直接关；改过先问，点「接着改」就不关", async () => {
    const { editor } = await openEditor();
    await editor.openCreate();
    await editor.requestClose();
    expect(editor.visible.value).toBe(false);

    await editor.openCreate();
    editor.name.value = "写了一半";
    server.confirmOk = false;
    await editor.requestClose();
    expect(editor.visible.value).toBe(true);
    server.confirmOk = true;
    await editor.requestClose();
    expect(editor.visible.value).toBe(false);
  });

  it("试卷和成员没读出来：摆「再读一次」，不让保存", async () => {
    httpRequest.mockImplementationOnce(async () => ({ success: false, message: "服务暂不可用", data: null }));
    const { editor } = await openEditor();
    await editor.openCreate();
    expect(editor.loadError.value).toBe(true);
    expect(editor.canSave.value).toBe(false);

    await editor.load();
    expect(editor.loadError.value).toBe(false);
    expect(editor.paperChoices.value).toHaveLength(6);
  });

  it("连着开两次小窗：先发的那回晚回来，不许动眼前这份，也不许把「改没改过」的底重拍", async () => {
    let release: (value: unknown) => void = () => undefined;
    httpRequest.mockImplementationOnce(
      () => new Promise(resolve => (release = resolve))
    );
    const { editor } = await openEditor();
    // 点「新建」，网慢，还在转圈就关掉，改点「修改」
    const first = editor.openCreate();
    await editor.openEdit(editingFirst());
    editor.togglePerson("bob");
    expect(editor.isDirty()).toBe(true);

    // 头一回的选卷清单这时候才回来
    release(ok(paperOptions()));
    await first;
    await settle();

    expect(editor.isEdit.value).toBe(true);
    expect(editor.loading.value).toBe(false);
    // 没被「新建」的默认名单盖掉，也没把刚去掉的小博勾回来
    expect([...editor.pickedPeople.value].sort()).toEqual(["amy", "dan"]);
    // 还记得改过：关小窗照样会问
    expect(editor.isDirty()).toBe(true);
  });
});
