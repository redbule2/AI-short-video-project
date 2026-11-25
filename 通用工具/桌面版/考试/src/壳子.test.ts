// 壳子自己那几样的测试（照搬来的考试逻辑，测试在 features/exam 里，也是照搬的）。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { reactive } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOME, MENU, allowed, cachedPages, routes } from "./pages";
import { rolesOf, useUserStoreHook } from "@/store/modules/user";
import { http, toDeskOptions, toHttpError } from "@/utils/http";

const pages = routes.filter(route => route.component);
const menuOf = (accountType: string) =>
  MENU.filter(path =>
    allowed(routes.find(route => route.path === path)?.meta?.roles, rolesOf(accountType))
  );

afterEach(() => vi.unstubAllGlobals());

describe("有哪几页", () => {
  it("十页都在，名字和页里写的一样（缓存靠这个名字认）", () => {
    expect(pages.map(route => route.path)).toEqual([
      "/exam/papers",
      "/exam/results",
      "/exam/manual-grading-tasks",
      "/exam/my",
      "/exam/paper-edit",
      "/exam/take",
      "/exam/review",
      "/exam/manual-grading-assignments",
      "/exam/manual-grading",
      "/collaboration"
    ]);
    for (const route of pages) {
      const file = fileURLToPath(new URL(`./views${route.path}/index.vue`, import.meta.url));
      expect(readFileSync(file, "utf8")).toContain(`defineOptions({ name: "${String(route.name)}" })`);
    }
  });

  it("答题、阅卷安排、人工阅卷每回重来，别的切走不重来", () => {
    expect(cachedPages).toEqual([
      "ExamPapers",
      "ExamResults",
      "ExamManualGradingTasks",
      "ExamMy",
      "ExamPaperEdit",
      "ExamReview",
      "CollaborationCenter"
    ]);
  });

  it("菜单：团队负责人看不到「我的阅卷」，成员看不到「试卷管理」「团队」", () => {
    expect(menuOf("owner")).toEqual(["/exam/papers", "/exam/results", "/exam/my", "/collaboration"]);
    expect(menuOf("sub")).toEqual(["/exam/results", "/exam/manual-grading-tasks", "/exam/my"]);
    expect(allowed(routes.find(route => route.path === HOME)?.meta?.roles, [])).toBe(true);
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
  });

  it("连不上说看看网络；状态码不对带着服务器的话抛出去", () => {
    expect(toHttpError({ ok: false, status: 0, data: null }).message).toBe("连不上 video8.online，看看网络");
    const error = toHttpError({ ok: false, status: 500, data: { message: "坏了" } }) as Error & { response: unknown };
    expect(error.response).toEqual({ status: 500, data: { message: "坏了" } });
  });

  it("经桌面软件去问：回的是服务器给的那一整份", async () => {
    const api = vi.fn(async () => ({ ok: true, status: 200, data: { success: true, data: 1 } }));
    vi.stubGlobal("window", { desk: { api } });
    expect(await http.request("get", "/api/exam/my", { params: { a: 1 } })).toEqual({ success: true, data: 1 });
    expect(api).toHaveBeenCalledWith("get", "/api/exam/my", { query: { a: 1 } });
    api.mockResolvedValueOnce({ ok: false, status: 0, data: null } as never);
    await expect(http.post("/api/exam/papers", { data: {} })).rejects.toThrow("连不上 video8.online");
  });

  it("不在桌面软件里：说清楚", async () => {
    vi.stubGlobal("window", {});
    await expect(http.request("get", "/api/exam/my")).rejects.toThrow("这一页要在桌面软件里打开");
  });
});
