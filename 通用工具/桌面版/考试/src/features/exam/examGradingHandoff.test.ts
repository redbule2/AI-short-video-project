import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import performanceBudgets from "../../../quality/performance-budgets.json";
import {
  buildExamGradingPrompt,
  prepareExamGradingPrompt
} from "./examGradingHandoff";

const createExamGradingGrant = vi.hoisted(() => vi.fn());

vi.mock("@/api/exam", () => ({
  createExamGradingGrant
}));

const budgets = performanceBudgets.budgets as Record<string, number>;
const grantFixture = {
  sheetId: "sheet_唯一答卷",
  grantCode: "grant_once_sheet_abc",
  expiresAt: "2026-07-25T19:00:00+08:00",
  expiresInSeconds: 600
};

/** 桌面软件里：页面是本机服务开的（127.0.0.1:8766），壳子连的服务器另在一处（desk.info().api） */
const PAGE_ORIGIN = "http://127.0.0.1:8766";
const deskInfo = vi.fn();
function inDesk(info: unknown) {
  deskInfo.mockResolvedValue(info);
  vi.stubGlobal("window", {
    desk: { info: deskInfo },
    location: { origin: PAGE_ORIGIN }
  });
}

describe("exam grading handoff", () => {
  beforeEach(() => {
    createExamGradingGrant.mockReset();
    createExamGradingGrant.mockResolvedValue(grantFixture);
    deskInfo.mockReset();
    inDesk({ api: "https://video8.online/" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("页面进入只构造界面，不预拉授权", () => {
    buildExamGradingPrompt(
      grantFixture.sheetId,
      "https://video8.online/",
      grantFixture.grantCode,
      grantFixture.expiresAt
    );
    expect(createExamGradingGrant).toHaveBeenCalledTimes(
      budgets["frontend.exam.gradingHandoff.enter"]
    );
  });

  it("显式点击只签发一次，并把单答卷授权写入两个专用端点", async () => {
    const prepared = await prepareExamGradingPrompt(grantFixture.sheetId);

    expect(createExamGradingGrant).toHaveBeenCalledTimes(
      budgets["frontend.exam.gradingHandoff.copyClick"]
    );
    expect(createExamGradingGrant).toHaveBeenCalledWith(
      grantFixture.sheetId
    );
    expect(prepared.prompt).toContain("目标 sheetId: sheet_唯一答卷");
    expect(prepared.prompt).toContain(
      "GET https://video8.online/api/exam/grading/grant/sheets/sheet_%E5%94%AF%E4%B8%80%E7%AD%94%E5%8D%B7"
    );
    expect(prepared.prompt).toContain(
      "POST https://video8.online/api/exam/grading/grant/submit"
    );
    expect(prepared.prompt).toContain(
      `X-Exam-Grading-Grant: ${grantFixture.grantCode}`
    );
    expect(prepared.prompt).toContain('"sheetId": "sheet_唯一答卷"');
    expect(prepared.prompt).toContain("不要控制浏览器");
    expect(prepared.prompt).toContain("不得修改客观题");
    expect(prepared.prompt).not.toContain("/api/auth/login");
    expect(prepared.prompt).not.toContain("需要主账号授权");

    const responseBytes = new TextEncoder().encode(
      JSON.stringify(grantFixture)
    ).byteLength;
    expect(responseBytes).toBeLessThanOrEqual(
      budgets["frontend.exam.gradingHandoff.grantResponseBytesMax"]
    );
  });

  it("同一答卷的重叠点击共享一个在途签发请求", async () => {
    let release!: (value: typeof grantFixture) => void;
    createExamGradingGrant.mockImplementation(
      () =>
        new Promise<typeof grantFixture>(resolve => {
          release = resolve;
        })
    );

    const first = prepareExamGradingPrompt(grantFixture.sheetId);
    const second = prepareExamGradingPrompt(grantFixture.sheetId);

    // 先问壳子服务器在哪，再签发：等签发发出去了再数
    await vi.waitFor(() => expect(createExamGradingGrant).toHaveBeenCalled());
    expect(createExamGradingGrant).toHaveBeenCalledTimes(
      budgets["frontend.exam.gradingHandoff.peakConcurrencyMax"]
    );
    release(grantFixture);
    await Promise.all([first, second]);
  });

  it("授权返回的 sheetId 不匹配时拒绝生成提示词", async () => {
    createExamGradingGrant.mockResolvedValue({
      ...grantFixture,
      sheetId: "sheet_其他答卷"
    });

    await expect(
      prepareExamGradingPrompt(grantFixture.sheetId)
    ).rejects.toThrow("答卷 ID 不匹配");
  });

  it("提示词里写壳子连的服务器，不写页面自己的地址（本机服务）", async () => {
    inDesk({ api: "http://43.143.83.166" });

    const { prompt } = await prepareExamGradingPrompt(grantFixture.sheetId);

    expect(prompt).toContain("Base URL: http://43.143.83.166\n");
    expect(prompt).toContain(
      "GET http://43.143.83.166/api/exam/grading/grant/sheets/"
    );
    expect(prompt).toContain(
      "POST http://43.143.83.166/api/exam/grading/grant/submit"
    );
    expect(prompt).not.toContain("127.0.0.1");
  });

  it.each([
    ["壳子不答", null],
    ["壳子没说服务器在哪", {}],
    ["说了个空的", { api: "  " }],
    ["说的就是页面自己（本机服务）", { api: PAGE_ORIGIN }],
    ["页面自己、带斜杠", { api: PAGE_ORIGIN + "/" }],
    ["不是网址", { api: "video8" }],
    ["不是 http", { api: "file:///C:/x" }]
  ])("问不到服务器地址就停，不签发授权：%s", async (_, info) => {
    inDesk(info);

    await expect(
      prepareExamGradingPrompt(grantFixture.sheetId)
    ).rejects.toThrow("没问到服务器地址");
    expect(createExamGradingGrant).not.toHaveBeenCalled();
  });

  it("不在桌面软件里：不签发授权", async () => {
    vi.stubGlobal("window", { location: { origin: PAGE_ORIGIN } });

    await expect(
      prepareExamGradingPrompt(grantFixture.sheetId)
    ).rejects.toThrow("桌面软件");
    expect(createExamGradingGrant).not.toHaveBeenCalled();
  });
});
