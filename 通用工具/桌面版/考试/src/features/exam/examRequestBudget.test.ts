import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActivePinia } from "pinia";
import performanceBudgets from "../../../quality/performance-budgets.json";
import { store } from "@/store";

/**
 * 考试模块请求预算行为测试(规范 §8.3:预算只在 performance-budgets.json 维护,
 * 本测试直读预算值断言真实调用链,不另抄数字)。
 * 覆盖键:
 *   frontend.exam.papersPage.enter / frontend.exam.paperEdit.enter /
 *   frontend.exam.assignDialog.open / frontend.exam.publishDialog.open /
 *   frontend.exam.archivedCopy.click /
 *   frontend.exam.resultsPage.enter / frontend.exam.results.switchPaper /
 *   frontend.exam.results.sheetDetail /
 *   frontend.exam.results.reopenTimedOut /
 *   frontend.exam.results.revokeAssignment /
 *   frontend.exam.myPage.enter / frontend.exam.take.enter /
 *   frontend.exam.take.autosave / frontend.exam.take.pause /
 *   frontend.exam.take.resume / frontend.exam.review.enter /
 *   frontend.exam.review.ownerEnter /
 *   frontend.exam.manualGrading.blindEnter /
 *   frontend.exam.manualGrading.reviewEnter /
 *   frontend.exam.manualGrading.firstSubmit /
 *   frontend.exam.manualGrading.revisionSubmit /
 *   frontend.exam.manualGrading.conflictRecovery /
 *   frontend.exam.manualGrading.questionSwitch /
 *   frontend.exam.manualGradingAssignments.enter /
 *   frontend.exam.manualGradingAssignments.switchPaper /
 *   frontend.exam.manualGradingAssignments.save /
 *   frontend.exam.manualGradingTasks.enter
 */

type LifecycleCallback = () => void | Promise<void>;

const lifecycle = vi.hoisted(() => ({
  mounted: [] as LifecycleCallback[]
}));

const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));
const manualConflictState = vi.hoisted(() => ({ workspaceGets: 0 }));
const paperListState = vi.hoisted(() => ({ empty: false }));
const routerPush = vi.hoisted(() => vi.fn(async () => undefined));
const routerReplace = vi.hoisted(() => vi.fn(async () => undefined));

const storageState = vi.hoisted(() => new Map<string, unknown>());
const storageLocalMock = vi.hoisted(() => () => ({
  getItem: <T>(key: string): T | null =>
    (storageState.get(key) as T | undefined) ?? null,
  setItem: (key: string, value: unknown) => storageState.set(key, value),
  removeItem: (key: string) => storageState.delete(key)
}));

const httpRequest = vi.hoisted(() =>
  vi.fn(async (method: string, url: string) => {
    if (
      (url === "/api/exam/papers" || url === "/api/exam/result-papers") &&
      method === "get"
    ) {
      return {
        success: true,
        message: "",
        data: {
          pageIndex: 1,
          pageSize: 20,
          total: 1,
          items: paperListState.empty
            ? []
            : [
                {
                  paperId: "p1",
                  title: "预算夹具卷",
                  status: "已发布",
                  questionCount: 1,
                  totalScore: 5,
                  passScore: null,
                  durationMinutes: null,
                  answerRevealPolicy: "onSubmit",
                  answersPublished: true,
                  assignedCount: 1,
                  submittedCount: 0,
                  gradedCount: 0,
                  createdAt: "2026-07-23T00:00:00",
                  updatedAt: null
                }
              ]
        }
      };
    }
    if (url === "/api/exam/papers/p1") {
      return {
        success: true,
        message: "",
        data: {
          paperId: "p1",
          title: "预算夹具卷",
          description: null,
          status: "草稿",
          durationMinutes: null,
          totalScore: 0,
          passScore: null,
          answerRevealPolicy: "onSubmit",
          answerPublishedAt: null,
          questions: []
        }
      };
    }
    if (url === "/api/exam/papers/p1/results") {
      return {
        success: true,
        message: "",
        data: {
          paperId: "p1",
          title: "预算夹具卷",
          status: "已发布",
          totalScore: 5,
          passScore: null,
          truncated: false,
          sheets: []
        }
      };
    }
    if (url === "/api/exam/sheets/s1" && method === "get") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paperId: "p1",
          paperTitle: "预算夹具卷",
          studentUsername: "sub01",
          studentDisplayName: null,
          status: "已判分",
          startedAt: "2026-07-26T09:00:00",
          submittedAt: "2026-07-26T09:12:30",
          gradedAt: null,
          objectiveScore: 5,
          totalScore: 5,
          manualTotalScore: null,
          manualGradedAt: null,
          manualRevision: 0,
          paperTotalScore: 5,
          passScore: 3,
          durationSeconds: 750,
          submitKind: "自主",
          items: []
        }
      };
    }
    if (url === "/api/exam/manual-grading/sheets/s1" && method === "get") {
      manualConflictState.workspaceGets += 1;
      const reviewStage = routeState.query.stage === "review";
      const recoveredRevision =
        routeState.query.conflict === "true" &&
        manualConflictState.workspaceGets > 1
          ? 2
          : 1;
      // multi=true 才铺多题夹具:逐题切题/未评分定位需要 >1 题,
      // 但默认单题夹具要保持既有提交类用例的完成态不变。
      const manualItems: Record<string, unknown>[] = [
        {
          questionId: "q1",
          type: "essay",
          stem: "说明视角变化",
          stemImages: null,
          options: null,
          score: 5,
          studentAnswer: { text: "由远到近" },
          manualScore: reviewStage ? 4 : null,
          manualComment: reviewStage ? "判断基本正确。" : null,
          orderNo: 1,
          group: null
        }
      ];
      if (routeState.query.multi === "true") {
        manualItems.push(
          {
            questionId: "q2",
            type: "fillBlank",
            stem: "补全术语",
            stemImages: null,
            options: null,
            score: 3,
            studentAnswer: { answers: ["景别"] },
            manualScore: reviewStage ? 3 : null,
            manualComment: reviewStage ? "正确。" : null,
            orderNo: 2,
            group: null
          },
          {
            questionId: "q3",
            type: "practical",
            stem: "提交分镜图",
            stemImages: null,
            options: null,
            score: 40,
            studentAnswer: { files: [{ url: "/u/1.png", name: "1.png" }] },
            manualScore: reviewStage ? 30 : null,
            manualComment: reviewStage ? "构图合格。" : null,
            orderNo: 3,
            group: null
          }
        );
      }
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paperId: "p1",
          paperTitle: "预算夹具卷",
          studentUsername: "sub01",
          studentDisplayName: "学员一",
          paperTotalScore: 5,
          objectiveScore: 0,
          submittedAt: "2026-07-25T09:55:00",
          requiresManualGrading: true,
          referencesUnlocked: reviewStage,
          revision: reviewStage ? recoveredRevision : 0,
          manualTotalScore: reviewStage ? 4 : null,
          firstSubmittedAt: reviewStage ? "2026-07-25T10:00:00" : null,
          viewerUsername: "owner",
          viewerDisplayName: "主账号",
          viewerIsOwner: true,
          assignedGraderUsername: null,
          items: manualItems
        }
      };
    }
    if (
      url === "/api/exam/manual-grading/sheets/s1/references" &&
      method === "get"
    ) {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          revision:
            routeState.query.conflict === "true" &&
            manualConflictState.workspaceGets > 1
              ? 2
              : 1,
          aiTotalScore: 4,
          items: [
            {
              questionId: "q1",
              correctAnswer: { reference: "由远到近属于景别变化" },
              analysis: "判断主体比例。",
              aiScore: 4,
              aiGradedBy: "AI",
              aiComment: "基本正确。"
            }
          ]
        }
      };
    }
    if (url === "/api/exam/manual-grading/sheets/s1" && method === "put") {
      if (routeState.query.conflict === "true") {
        return {
          success: false,
          message: "人工评分已被其他页面提交或修改",
          data: null,
          error: {
            kind: "manual-grading-conflict",
            retryable: true
          }
        };
      }
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          referencesUnlocked: true,
          revision: routeState.query.stage === "review" ? 2 : 1,
          manualTotalScore: 4,
          firstSubmittedAt: "2026-07-25T10:00:00"
        }
      };
    }
    if (
      url === "/api/exam/manual-grading/assignments/papers/p1" &&
      method === "get"
    ) {
      return {
        success: true,
        message: "",
        data: {
          paperId: "p1",
          paperTitle: "预算夹具卷",
          assignees: [
            {
              username: "grader01",
              displayName: "阅卷员一",
              status: "active"
            }
          ],
          sheets: [
            {
              sheetId: "s1",
              studentUsername: "sub01",
              studentDisplayName: "学员一",
              submittedAt: "2026-07-25T09:55:00",
              manualGradingStatus: "pending",
              manualTotalScore: null,
              manualRevision: 0,
              assignedGraderUsername: null,
              assignedGraderDisplayName: null,
              assignedGraderDisabled: false,
              assignmentLocked: false
            }
          ],
          hasMore: false
        }
      };
    }
    if (
      url === "/api/exam/manual-grading/assignments/papers/p1" &&
      method === "put"
    ) {
      return {
        success: true,
        message: "",
        data: { changedCount: 1 }
      };
    }
    if (url === "/api/exam/manual-grading/my-tasks" && method === "get") {
      return {
        success: true,
        message: "",
        data: {
          items: [
            {
              sheetId: "s1",
              paperId: "p1",
              paperTitle: "预算夹具卷",
              studentUsername: "sub01",
              studentDisplayName: "学员一",
              submittedAt: "2026-07-25T09:55:00",
              assignedAt: "2026-07-25T10:00:00",
              manualGradingStatus: "pending",
              manualTotalScore: null,
              manualRevision: 0
            }
          ],
          hasMore: false
        }
      };
    }
    if (url === "/api/collaboration/accounts") {
      return {
        success: true,
        message: "",
        data: {
          accounts: [
            {
              id: "1",
              username: "sub01",
              displayName: "学员一",
              role: "sub",
              status: "active",
              lastActive: "",
              permissionNote: "",
              createdAt: "2026-07-23T00:00:00",
              updatedAt: null
            }
          ],
          stats: { total: 2, subTotal: 1, disabledTotal: 0 },
          currentUsername: "owner",
          ownerUsername: "owner",
          accountType: "owner",
          canManageAccounts: true
        }
      };
    }
    if (url === "/api/exam/papers/p1/copy" && method === "post") {
      return {
        success: true,
        message: "",
        data: { paperId: "p-new" }
      };
    }
    if (url === "/api/exam/my") {
      return { success: true, message: "", data: { items: [] } };
    }
    if (url === "/api/exam/sheets/s1/paper") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paperTitle: "预算夹具卷",
          totalScore: 5,
          questions: [
            {
              questionId: "q1",
              type: "single",
              stem: "1+1=?",
              options: [
                { key: "A", text: "1" },
                { key: "B", text: "2" }
              ],
              score: 5,
              orderNo: 1
            }
          ],
          savedAnswers: {},
          startedAt: "2026-07-23T10:00:00",
          endTime: null,
          paused: false,
          remainingSeconds: 600,
          serverNow: "2026-07-23T10:00:05"
        }
      };
    }
    if (url === "/api/exam/sheets/s1/answers") {
      return { success: true, message: "", data: null };
    }
    if (url === "/api/exam/sheets/s1/pause") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paused: true,
          remainingSeconds: 600,
          endTime: null,
          deadline: null,
          serverNow: "2026-07-23T10:00:06"
        }
      };
    }
    if (url === "/api/exam/sheets/s1/resume") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paused: false,
          remainingSeconds: 600,
          endTime: "2026-07-23T10:10:06",
          deadline: null,
          serverNow: "2026-07-23T10:00:06"
        }
      };
    }
    if (url === "/api/exam/sheets/s1/review") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paperTitle: "预算夹具卷",
          status: "已判分",
          paperTotalScore: 5,
          passScore: null,
          myObjectiveScore: 5,
          myTotalScore: 5,
          myManualTotalScore: null,
          manualGradedAt: null,
          startedAt: null,
          submittedAt: null,
          gradedAt: null,
          durationSeconds: 60,
          submitKind: "自主",
          items: []
        }
      };
    }
    return { success: true, message: "", data: null };
  })
);

vi.mock("vue", async importOriginal => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    onMounted: (callback: LifecycleCallback) => {
      lifecycle.mounted.push(callback);
    },
    onBeforeUnmount: () => undefined
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/exam", query: routeState.query }),
  useRouter: () => ({
    push: routerPush,
    replace: routerReplace
  })
}));

vi.mock("@/utils/http", () => ({
  http: { request: httpRequest }
}));

vi.mock("@/utils/message", () => ({
  message: vi.fn()
}));

vi.mock("element-plus", () => ({
  ElMessageBox: {
    confirm: vi.fn(async () => "confirm"),
    prompt: vi.fn(async () => ({ value: "x" }))
  }
}));

vi.mock("@/store/modules/user", () => ({
  useUserStoreHook: () => ({ username: "sub01", roles: ["sub"] })
}));

vi.mock("@pureadmin/utils", async importOriginal => {
  const actual = await importOriginal<typeof import("@pureadmin/utils")>();
  return {
    ...actual,
    storageLocal: storageLocalMock
  };
});

vi.mock("@/store/utils", async () => {
  const { store: appStore } = await import("@/store");
  return {
    store: appStore,
    storageLocal: storageLocalMock
  };
});

const budgets = performanceBudgets.budgets as Record<string, number>;

async function flushMounted() {
  for (const callback of lifecycle.mounted) {
    await callback();
  }
  await Promise.resolve();
  await Promise.resolve();
}

function callsTo(urlPart: string, method?: string) {
  return httpRequest.mock.calls.filter(
    ([m, url]) =>
      String(url).includes(urlPart) && (method === undefined || m === method)
  ).length;
}

beforeEach(() => {
  httpRequest.mockClear();
  storageState.clear();
  lifecycle.mounted.length = 0;
  routeState.query = {};
  manualConflictState.workspaceGets = 0;
  paperListState.empty = false;
  routerPush.mockClear();
  routerReplace.mockClear();
  setActivePinia(store);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("exam request budgets", () => {
  it("papersPage.enter: 试卷管理首进只拉 1 次列表", async () => {
    const { useExamPapers } = await import("./useExamPapers");
    useExamPapers();
    await flushMounted();
    expect(callsTo("/api/exam/papers", "get")).toBe(
      budgets["frontend.exam.papersPage.enter"]
    );
  });

  it("assignDialog.open: 指派弹窗打开只拉 1 次协作账号", async () => {
    const { useExamPapers } = await import("./useExamPapers");
    const papers = useExamPapers();
    await flushMounted();
    httpRequest.mockClear();
    await papers.openAssign({
      paperId: "p1",
      title: "预算夹具卷"
    } as never);
    expect(callsTo("/api/collaboration/accounts")).toBe(
      budgets["frontend.exam.assignDialog.open"]
    );
  });

  it("publishDialog.open: 发布弹窗打开只拉 1 次协作账号", async () => {
    const { useExamPublishDialog } = await import("./useExamPublishDialog");
    const dialog = useExamPublishDialog();
    await dialog.open({
      paperId: "p1",
      title: "预算夹具卷",
      questionCount: 1,
      totalScore: 5
    });
    expect(callsTo("/api/collaboration/accounts")).toBe(
      budgets["frontend.exam.publishDialog.open"]
    );
  });

  it("archivedCopy.click: 归档卷复制只发 1 次 POST", async () => {
    const { useExamPapers } = await import("./useExamPapers");
    const papers = useExamPapers();
    await flushMounted();
    httpRequest.mockClear();

    const copiedPaperId = await papers.copyArchived({
      paperId: "p1",
      title: "预算夹具卷",
      questionCount: 1,
      totalScore: 5
    } as never);

    expect(copiedPaperId).toBe("p-new");
    expect(callsTo("/api/exam/papers/p1/copy", "post")).toBe(
      budgets["frontend.exam.archivedCopy.click"]
    );
  });

  it("paperEdit.enter: 出题工作台进入只拉 1 次详情", async () => {
    routeState.query = { paperId: "p1" };
    const { useExamPaperEdit } = await import("./useExamPaperEdit");
    useExamPaperEdit();
    await flushMounted();
    expect(callsTo("/api/exam/papers/p1", "get")).toBe(
      budgets["frontend.exam.paperEdit.enter"]
    );
  });

  it("resultsPage.enter: 成绩总览首进 = 列表 1 + 选中卷成绩 1", async () => {
    const { useExamResults } = await import("./useExamResults");
    useExamResults();
    await flushMounted();
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.resultsPage.enter"]
    );
  });

  it("results.sheetDetail: 答卷详情入口只跳复盘页,本页不发请求", async () => {
    const { useExamResults } = await import("./useExamResults");
    const results = useExamResults();
    await flushMounted();
    httpRequest.mockClear();
    await results.openDetail("s1");
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.results.sheetDetail"]
    );
    expect(routerPush).toHaveBeenCalledWith({
      name: "ExamReview",
      query: { sheetId: "s1", source: "results", paperId: "p1" }
    });
  });

  it("results.switchPaper: 每次切卷只拉所选卷成绩 1 次", async () => {
    const { useExamResults } = await import("./useExamResults");
    const results = useExamResults();
    await flushMounted();
    httpRequest.mockClear();

    results.selectPaper("p2");
    await Promise.resolve();
    await Promise.resolve();

    expect(callsTo("/api/exam/papers/p2/results", "get")).toBe(
      budgets["frontend.exam.results.switchPaper"]
    );
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.results.switchPaper"]
    );
  });

  it("results.reopenTimedOut: 允许继续只发 1 次 POST,不跟随刷新", async () => {
    const { useExamResults } = await import("./useExamResults");
    const results = useExamResults();
    await flushMounted();
    httpRequest.mockClear();

    await results.reopenTimedOut("s1", "sub01");

    expect(callsTo("/api/exam/sheets/s1/reopen", "post")).toBe(
      budgets["frontend.exam.results.reopenTimedOut"]
    );
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.results.reopenTimedOut"]
    );
  });

  it("results.revokeAssignment: 撤回指派只发 1 次 DELETE,不跟随刷新", async () => {
    const { useExamResults } = await import("./useExamResults");
    const results = useExamResults();
    await flushMounted();
    httpRequest.mockClear();

    await results.revoke("s1", "sub01", "答题中");

    expect(callsTo("/api/exam/sheets/s1/assignment", "delete")).toBe(
      budgets["frontend.exam.results.revokeAssignment"]
    );
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.results.revokeAssignment"]
    );
  });

  it("myPage.enter: 我的考试首进只拉 1 次", async () => {
    const { useMyExams } = await import("./useMyExams");
    useMyExams();
    await flushMounted();
    expect(callsTo("/api/exam/my")).toBe(budgets["frontend.exam.myPage.enter"]);
  });

  it("take.enter: 进入只请求 1 次并默认从第一题逐题作答", async () => {
    routeState.query = { sheetId: "s1" };
    const { useExamTaking } = await import("./useExamTaking");
    const taking = useExamTaking();
    await flushMounted();
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.take.enter"]
    );
    expect(taking.mode.value).toBe("focus");
    expect(taking.currentQuestionId.value).toBe("q1");
  });

  it("take.autosave: 连续作答在 2s 防抖窗口内至多 1 次 PUT", async () => {
    vi.useFakeTimers();
    routeState.query = { sheetId: "s1" };
    const { useExamTaking } = await import("./useExamTaking");
    const taking = useExamTaking();
    for (const callback of lifecycle.mounted) {
      const pending = callback();
      await vi.advanceTimersByTimeAsync(10);
      await pending;
    }
    httpRequest.mockClear();

    // 同一防抖窗口内密集改 5 次答案
    taking.setAnswer("q1", { answer: "A" });
    taking.setAnswer("q1", { answer: "B" });
    taking.setAnswer("q1", { answer: "A" });
    taking.setAnswer("q1", { answer: "B" });
    taking.setAnswer("q1", { answer: "A" });
    await vi.advanceTimersByTimeAsync(2500);

    expect(callsTo("/api/exam/sheets/s1/answers", "put")).toBeLessThanOrEqual(
      budgets["frontend.exam.take.autosave"]
    );
    expect(callsTo("/api/exam/sheets/s1/answers", "put")).toBeGreaterThan(0);
  });

  it("take.pause/resume: 暂停与恢复各只发 1 次请求", async () => {
    routeState.query = { sheetId: "s1" };
    const { useExamTaking } = await import("./useExamTaking");
    const taking = useExamTaking();
    await flushMounted();

    httpRequest.mockClear();
    await taking.pause();
    expect(callsTo("/api/exam/sheets/s1/pause", "post")).toBe(
      budgets["frontend.exam.take.pause"]
    );
    expect(taking.paused.value).toBe(true);

    httpRequest.mockClear();
    await taking.resume();
    expect(callsTo("/api/exam/sheets/s1/resume", "post")).toBe(
      budgets["frontend.exam.take.resume"]
    );
    expect(taking.paused.value).toBe(false);
  });

  it("review.enter: 复盘页进入只拉 1 次", async () => {
    routeState.query = { sheetId: "s1" };
    const { useExamReview } = await import("./useExamReview");
    useExamReview();
    await flushMounted();
    expect(callsTo("/api/exam/sheets/s1/review")).toBe(
      budgets["frontend.exam.review.enter"]
    );
  });

  it("review.ownerEnter: 主账号答卷详情复用复盘页且只拉 1 次", async () => {
    routeState.query = {
      sheetId: "s1",
      source: "results",
      paperId: "p1"
    };
    const { useExamReview } = await import("./useExamReview");
    const review = useExamReview();
    await flushMounted();
    expect(callsTo("/api/exam/sheets/s1", "get")).toBe(
      budgets["frontend.exam.review.ownerEnter"]
    );
    expect(callsTo("/api/exam/sheets/s1/review")).toBe(0);
    // 总量断言:callsTo 是子串匹配,单看它挡不住「顺手再拉一次试卷/成绩」的加请求
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.review.ownerEnter"]
    );
    expect(review.isResultsReview.value).toBe(true);
    // 及格印章与用时由这一次详情请求同源带回,不得为此再发第二个请求
    expect(review.passed.value).toBe(true);
    expect(review.durationText.value).toBe("12 分 30 秒");
  });

  it("manualGradingAssignments.enter: 安排台首进固定列表+聚合安排 2 次", async () => {
    routeState.query = { paperId: "p1" };
    const { useExamManualGradingAssignments } = await import(
      "./useExamManualGradingAssignments"
    );
    useExamManualGradingAssignments();
    await flushMounted();
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGradingAssignments.enter"]
    );
  });

  it("manualGradingAssignments.switchPaper: 切卷只取 1 次聚合安排", async () => {
    routeState.query = { paperId: "p1" };
    const { useExamManualGradingAssignments } = await import(
      "./useExamManualGradingAssignments"
    );
    const assignments = useExamManualGradingAssignments();
    await flushMounted();
    httpRequest.mockClear();
    await assignments.loadWorkspace("p1");
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGradingAssignments.switchPaper"]
    );
  });

  it("manualGradingAssignments.empty: 没有可安排试卷时结束加载并显示空态", async () => {
    paperListState.empty = true;
    const { useExamManualGradingAssignments } = await import(
      "./useExamManualGradingAssignments"
    );
    const assignments = useExamManualGradingAssignments();
    await flushMounted();
    expect(assignments.loading.value).toBe(false);
    expect(assignments.papers.value).toEqual([]);
    expect(callsTo("/api/exam/papers", "get")).toBe(1);
  });

  it("manualGradingAssignments.save: 全部脏行合并为 1 次 PUT", async () => {
    routeState.query = { paperId: "p1" };
    const { useExamManualGradingAssignments } = await import(
      "./useExamManualGradingAssignments"
    );
    const assignments = useExamManualGradingAssignments();
    await flushMounted();
    assignments.assignments.value.s1 = "grader01";
    httpRequest.mockClear();
    await assignments.save();
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGradingAssignments.save"]
    );
    expect(
      callsTo("/api/exam/manual-grading/assignments/papers/p1", "put")
    ).toBe(1);
  });

  it("manualGradingTasks.enter: 我的阅卷只取 1 次聚合任务", async () => {
    const { useExamManualGradingTasks } = await import(
      "./useExamManualGradingTasks"
    );
    useExamManualGradingTasks();
    await flushMounted();
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGradingTasks.enter"]
    );
  });

  it("manualGrading.blindEnter: 盲评进入只取 1 次无答案工作台", async () => {
    routeState.query = { sheetId: "s1", paperId: "p1" };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.blindEnter"]
    );
    expect(callsTo("/references", "get")).toBe(0);
    expect(manual.isReviewStage.value).toBe(false);
  });

  it("manualGrading.reviewEnter: 已提交复核进入固定 2 次 GET", async () => {
    routeState.query = { sheetId: "s1", paperId: "p1", stage: "review" };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.reviewEnter"]
    );
    expect(callsTo("/references", "get")).toBe(1);
    expect(manual.isReviewStage.value).toBe(true);
  });

  it("manualGrading.firstSubmit: 首次提交 1 PUT + 解锁参考 1 GET", async () => {
    routeState.query = { sheetId: "s1", paperId: "p1" };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();
    manual.grades.value.q1.score = 4;
    manual.grades.value.q1.comment = "判断基本正确。";
    httpRequest.mockClear();

    await manual.submit();

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.firstSubmit"]
    );
    expect(callsTo("/api/exam/manual-grading/sheets/s1", "put")).toBe(1);
    expect(callsTo("/references", "get")).toBe(1);
  });

  it("manualGrading.revisionSubmit: 复核保存只发 1 次 PUT", async () => {
    routeState.query = { sheetId: "s1", paperId: "p1", stage: "review" };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();
    httpRequest.mockClear();

    await manual.submit();

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.revisionSubmit"]
    );
    expect(callsTo("/api/exam/manual-grading/sheets/s1", "put")).toBe(1);
    expect(callsTo("/references", "get")).toBe(0);
  });

  it("manualGrading.questionSwitch: 逐题切换与跳题不发任何请求", async () => {
    routeState.query = { sheetId: "s1", paperId: "p1", multi: "true" };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();
    expect(manual.items.value).toHaveLength(3);
    httpRequest.mockClear();

    manual.goNext();
    manual.goNext();
    manual.goPrev();
    manual.goTo(2);
    manual.goTo(0);
    manual.goFirstUnscored();
    await Promise.resolve();

    // 整卷题目与作答由同一个工作台聚合 GET 拿齐,切题只移动本地游标(禁 N+1)。
    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.questionSwitch"]
    );
  });

  it("manualGrading.commentOptional: 批语全空只要得分齐全就能按预算提交", async () => {
    routeState.query = { sheetId: "s1", paperId: "p1", multi: "true" };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();

    // 还有未评分题时:主提交被拦住,一次请求都不发。
    manual.setScore("q1", 5);
    manual.setScore("q2", 0);
    await Promise.resolve();
    expect(manual.isComplete.value).toBe(false);
    expect(manual.unscoredCount.value).toBe(1);
    httpRequest.mockClear();
    await manual.submit();
    expect(httpRequest).toHaveBeenCalledTimes(0);

    // 得分补齐后:批语一个字没写也算完成,提交照常走首次提交预算。
    manual.setScore("q3", 40);
    await Promise.resolve();
    expect(manual.completedCount.value).toBe(3);
    expect(manual.isComplete.value).toBe(true);
    expect(
      Object.values(manual.grades.value).every(item => item.comment === "")
    ).toBe(true);

    httpRequest.mockClear();
    await manual.submit();

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.firstSubmit"]
    );
    const putCall = httpRequest.mock.calls.find(
      ([method, url]) =>
        method === "put" && url === "/api/exam/manual-grading/sheets/s1"
    ) as unknown as [string, string, { data: { items: unknown[] } }];
    expect(putCall[2].data.items).toEqual([
      { questionId: "q1", score: 5, comment: "" },
      { questionId: "q2", score: 0, comment: "" },
      { questionId: "q3", score: 40, comment: "" }
    ]);
  });

  it("manualGrading.conflictRecovery: 冲突后有界刷新并保留当前编辑", async () => {
    routeState.query = {
      sheetId: "s1",
      paperId: "p1",
      stage: "review",
      conflict: "true"
    };
    const { useExamManualGrading } = await import("./useExamManualGrading");
    const manual = useExamManualGrading();
    await flushMounted();
    manual.grades.value.q1.score = 3;
    manual.grades.value.q1.comment = "保留这条尚未保存的复核意见。";
    httpRequest.mockClear();

    await manual.submit();

    expect(httpRequest).toHaveBeenCalledTimes(
      budgets["frontend.exam.manualGrading.conflictRecovery"]
    );
    expect(callsTo("/api/exam/manual-grading/sheets/s1", "put")).toBe(1);
    expect(
      httpRequest.mock.calls.filter(
        ([method, url]) =>
          method === "get" && url === "/api/exam/manual-grading/sheets/s1"
      )
    ).toHaveLength(1);
    expect(callsTo("/references", "get")).toBe(1);
    expect(manual.workspace.value?.revision).toBe(2);
    expect(manual.grades.value.q1).toEqual({
      score: 3,
      comment: "保留这条尚未保存的复核意见。"
    });
  });
});
