// 壳子自己那几样的测试（照搬来的考试逻辑，测试在 features/exam 里，也是照搬的）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_MENU,
  CHAT_HOME,
  HOME,
  MENU,
  TEAM_HOME,
  TEAM_MENU,
  allowed,
  cachedPages,
  homeOf,
  isTeamPath,
  menuOf as menuAt,
  routes,
  setTeamMenuSplit
} from "./pages";
import { rolesOf, useUserStoreHook } from "@/store/modules/user";
import { http, toDeskOptions, toHttpError } from "@/utils/http";

const pages = routes.filter(route => route.component);
/** 这个人在这一排里看得到哪几项 */
const seen = (menu: string[], accountType: string) =>
  menu.filter(path =>
    allowed(routes.find(route => route.path === path)?.meta?.roles, rolesOf(accountType))
  );
const menuOf = (accountType: string) => seen(MENU, accountType);

afterEach(() => vi.unstubAllGlobals());

describe("有哪几页", () => {
  it("十三页都在，名字和页里写的一样（缓存靠这个名字认）", () => {
    expect(pages.map(route => route.path)).toEqual([
      "/exam/papers",
      "/exam/trainings",
      "/exam/results",
      "/exam/manual-grading-tasks",
      "/exam/my",
      "/exam/paper-edit",
      "/exam/take",
      "/exam/review",
      "/exam/manual-grading-assignments",
      "/exam/manual-grading",
      "/team",
      "/collaboration",
      "/chat"
    ]);
    for (const route of pages) {
      const file = fileURLToPath(new URL(`./views${route.path}/index.vue`, import.meta.url));
      expect(readFileSync(file, "utf8")).toContain(`defineOptions({ name: "${String(route.name)}" })`);
    }
  });

  it("答题、阅卷安排、人工阅卷每回重来，别的切走不重来", () => {
    expect(cachedPages).toEqual([
      "ExamPapers",
      "ExamTrainings",
      "ExamResults",
      "ExamManualGradingTasks",
      "ExamMy",
      "ExamPaperEdit",
      "ExamReview",
      "MyTeam",
      "CollaborationCenter",
      "TeamChat"
    ]);
  });

  it("「消息」：人人能进；只有它一页，顶上不摆那一排；老壳子并成一排时不往里并（老壳子不在后台收新消息）", () => {
    const chat = routes.find(route => route.path === CHAT_HOME);
    expect([chat?.meta?.title, chat?.meta?.bare, allowed(chat?.meta?.roles, [])]).toEqual(["消息", true, true]);
    expect(routes.filter(route => route.meta?.bare).map(route => route.path)).toEqual([CHAT_HOME]);
    expect([...ALL_MENU, ...MENU, ...TEAM_MENU]).not.toContain(CHAT_HOME);
  });

  it("考试那一排：团队负责人看不到「我的阅卷」，成员看不到「试卷管理」；团队不在这一排了", () => {
    expect(menuOf("owner")).toEqual(["/exam/papers", "/exam/trainings", "/exam/results", "/exam/my"]);
    expect(menuOf("sub")).toEqual(["/exam/trainings", "/exam/results", "/exam/manual-grading-tasks", "/exam/my"]);
    expect(allowed(routes.find(route => route.path === HOME)?.meta?.roles, [])).toBe(true);
  });

  it("「培训」：排在试卷管理后面，人人能进（排名大家都能看，新建、修改、删除由后台只认负责人）", () => {
    const training = routes.find(route => route.path === "/exam/trainings");
    expect([training?.meta?.title, training?.meta?.keepAlive, allowed(training?.meta?.roles, [])]).toEqual(["培训", true, true]);
    expect(MENU.indexOf("/exam/trainings")).toBe(MENU.indexOf("/exam/papers") + 1);
    expect(menuAt("/exam/trainings")).toBe(ALL_MENU);
  });

  it("我的团队那一排：人人有「我的团队」，「账号管理」只有团队负责人有", () => {
    expect(seen(TEAM_MENU, "owner")).toEqual(["/team", "/collaboration"]);
    expect(seen(TEAM_MENU, "sub")).toEqual(["/team"]);
    expect(allowed(routes.find(route => route.path === TEAM_HOME)?.meta?.roles, [])).toBe(true);
    const titleOf = (path: string) => routes.find(route => route.path === path)?.meta?.title;
    expect([titleOf("/team"), titleOf("/collaboration")]).toEqual(["我的团队", "账号管理"]);
  });

  it("壳子菜单里有「我的团队」一项：在哪一项里就摆哪一排；进不去的页退回这一项自己的首页", () => {
    setTeamMenuSplit(true);
    try {
      expect([isTeamPath("/team"), isTeamPath("/collaboration"), isTeamPath("/exam/my")]).toEqual([true, true, false]);
      expect(menuAt("/team")).toBe(TEAM_MENU);
      expect(menuAt("/collaboration")).toBe(TEAM_MENU);
      expect(menuAt("/exam/results")).toBe(MENU);
      expect(homeOf("/collaboration")).toBe(TEAM_HOME); // 成员进不了账号管理：回我的团队，不是掉到考试去
      expect(homeOf("/exam/papers")).toBe(HOME);
    } finally {
      setTeamMenuSplit(false);
    }
  });

  it("老壳子（菜单里没有「我的团队」一项）配上新页面：两排并成一排，团队那两页不会没处进", () => {
    expect(ALL_MENU).toEqual([...MENU, "/team", "/collaboration"]);
    expect(menuAt("/exam/my")).toBe(ALL_MENU);
    expect(menuAt("/team")).toBe(ALL_MENU);
    expect(seen(menuAt("/exam/my"), "owner")).toEqual(["/exam/papers", "/exam/trainings", "/exam/results", "/exam/my", "/team", "/collaboration"]);
    expect(seen(menuAt("/exam/my"), "sub")).toEqual(["/exam/trainings", "/exam/results", "/exam/manual-grading-tasks", "/exam/my", "/team"]);
    expect(homeOf("/collaboration")).toBe(HOME); // 只有一排、一个首页
  });
});

describe("登录的人", () => {
  it("角色照旧后台：主账号 admin + owner，别的都算成员", () => {
    expect(rolesOf("owner")).toEqual(["admin", "owner"]);
    expect(rolesOf("sub")).toEqual(["sub"]);
    expect(rolesOf("")).toEqual(["sub"]);
    const user = useUserStoreHook();
    user.fill({ username: "boss", nickname: "老板", accountType: "owner" });
    expect([user.username, user.nickname, user.roles]).toEqual(["boss", "老板", ["admin", "owner"]]);
    user.fill(null);
    expect([user.username, user.roles]).toEqual(["", []]);
  });
});

describe("问服务器", () => {
  it("带的东西转成纯数据；一张图单独带", async () => {
    const data = reactive({ answers: { q1: { answer: "A", skip: undefined } } });
    const sent = await toDeskOptions({ params: { pageIndex: 1 }, data });
    expect(sent).toEqual({ query: { pageIndex: 1 }, body: { answers: { q1: { answer: "A" } } } });
    expect(sent.body).not.toBe(data);
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "图.png", { type: "image/png" }));
    const file = (await toDeskOptions({ data: form })).file as { name: string; type: string; bytes: ArrayBuffer };
    expect([file.name, file.type, [...new Uint8Array(file.bytes)]]).toEqual(["图.png", "image/png", [1, 2, 3]]);
    expect(await toDeskOptions()).toEqual({});
    expect(await toDeskOptions({ binary: true })).toEqual({ binary: true }); // 要一张图（聊天里的）：壳子回图本身
  });

  it("连不上说看看网络；状态码不对带着服务器的话抛出去", () => {
    expect(toHttpError({ ok: false, status: 0, data: null }).message).toBe("连不上服务器，看看网络");
    const error = toHttpError({ ok: false, status: 500, data: { message: "坏了" } }) as Error & { response: unknown };
    expect(error.response).toEqual({ status: 500, data: { message: "坏了" } });
  });

  it("经桌面软件去问：回的是服务器给的那一整份", async () => {
    const api = vi.fn(async () => ({ ok: true, status: 200, data: { success: true, data: 1 } }));
    vi.stubGlobal("window", { desk: { api } });
    expect(await http.request("get", "/api/exam/my", { params: { a: 1 } })).toEqual({ success: true, data: 1 });
    expect(api).toHaveBeenCalledWith("get", "/api/exam/my", { query: { a: 1 } });
    api.mockResolvedValueOnce({ ok: false, status: 0, data: null } as never);
    await expect(http.post("/api/exam/papers", { data: {} })).rejects.toThrow("连不上服务器");
  });

  it("不在桌面软件里：说清楚", async () => {
    vi.stubGlobal("window", {});
    await expect(http.request("get", "/api/exam/my")).rejects.toThrow("这一页要在桌面软件里打开");
  });
});
