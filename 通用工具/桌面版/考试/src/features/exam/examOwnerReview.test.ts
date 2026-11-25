import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 主账号(owner)查阅考生答卷 = 复用考生复盘页(设计文档 §11.16)的行为测试。
 * 这里只钉「同一个复盘页在 owner 视角下的语义」,请求条数预算另在 examRequestBudget.test.ts。
 * 覆盖:字段同源映射、未交卷降级、答卷不存在的空态、连看多份答卷的阅读态隔离、
 *      返回成绩总览的 paperId 兜底、未交卷答卷再次进入必须重取快照。
 */

type LifecycleCallback = () => void | Promise<void>;

const lifecycle = vi.hoisted(() => ({
  mounted: [] as LifecycleCallback[],
  activated: [] as LifecycleCallback[]
}));

const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));
const routerPush = vi.hoisted(() => vi.fn(async () => undefined));

/** 每个用例可改写的答卷详情夹具;null = 后端 success:true + data:null(答卷已撤销)。 */
const sheetState = vi.hoisted(() => ({
  detail: null as Record<string, unknown> | null
}));

const httpRequest = vi.hoisted(() =>
  vi.fn(async (method: string, url: string) => {
    if (url.startsWith("/api/exam/sheets/") && method === "get") {
      return { success: true, message: "", data: sheetState.detail };
    }
    return { success: true, message: "", data: null };
  })
);

vi.mock("vue", async importOriginal => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    // keep-alive 钩子在真实组件外拿不到实例,这里造一个假实例让 onActivated 分支可测
    getCurrentInstance: () => ({}) as never,
    onMounted: (callback: LifecycleCallback) => {
      lifecycle.mounted.push(callback);
    },
    onActivated: (callback: LifecycleCallback) => {
      lifecycle.activated.push(callback);
    },
    onBeforeUnmount: () => undefined,
    onDeactivated: () => undefined
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/exam/review", query: routeState.query }),
  useRouter: () => ({ push: routerPush, replace: vi.fn() })
}));

vi.mock("@/utils/http", () => ({ http: { request: httpRequest } }));
vi.mock("@/utils/message", () => ({ message: vi.fn() }));

function ownerSheet(overrides: Record<string, unknown> = {}) {
  return {
    sheetId: "s1",
    paperId: "p-owned",
    paperTitle: "查阅验收卷",
    studentUsername: "sub01",
    studentDisplayName: "小张",
    status: "已判分",
    startedAt: "2026-07-26T09:00:00",
    submittedAt: "2026-07-26T09:12:30",
    gradedAt: "2026-07-26T09:13:00",
    objectiveScore: 40,
    totalScore: 80,
    manualTotalScore: null,
    manualGradedAt: null,
    manualRevision: 0,
    paperTotalScore: 100,
    passScore: 60,
    durationSeconds: 750,
    submitKind: "自主",
    items: [
      {
        questionId: "q1",
        type: "essay",
        stem: "写一段提示词",
        stemImages: null,
        options: null,
        correctAnswer: { text: "参考答案" },
        analysis: "解析",
        score: 10,
        studentAnswer: { text: "考生写的内容" },
        earnedScore: 8,
        isCorrect: null,
        gradedBy: "AI",
        aiComment: "还行",
        manualScore: null,
        manualComment: null,
        manualGraderUsername: null,
        manualUpdatedAt: null,
        orderNo: 1,
        group: null
      }
    ],
    ...overrides
  };
}

async function flushMounted() {
  for (const callback of lifecycle.mounted) {
    await callback();
  }
}

async function flushActivated() {
  for (const callback of lifecycle.activated) {
    await callback();
  }
  // load() 是 fire-and-forget,等一轮微任务让它跑完
  await Promise.resolve();
  await Promise.resolve();
}

async function mountOwnerReview() {
  const { useExamReview } = await import("./useExamReview");
  const api = useExamReview();
  await flushMounted();
  return api;
}

describe("主账号查阅考生答卷(复用考生复盘页)", () => {
  beforeEach(() => {
    vi.resetModules();
    lifecycle.mounted.length = 0;
    lifecycle.activated.length = 0;
    httpRequest.mockClear();
    routerPush.mockClear();
    sheetState.detail = ownerSheet();
    routeState.query = { sheetId: "s1", source: "results", paperId: "p1" };
  });

  it("及格判定与用时由答卷详情同源带回,不再是 owner 视角下的空白", async () => {
    const review = await mountOwnerReview();

    expect(review.isResultsReview.value).toBe(true);
    expect(review.reviewStudentLabel.value).toBe("小张");
    expect(review.review.value?.passScore).toBe(60);
    expect(review.passed.value).toBe(true);
    expect(review.durationText.value).toBe("12 分 30 秒");
    // studentAnswer 改名成复盘页统一的 myAnswer,逐题 AI/人工字段原样透传
    expect(review.allItems.value[0].myAnswer).toEqual({ text: "考生写的内容" });
    expect(review.allItems.value[0].aiComment).toBe("还行");
    expect(review.backLabel.value).toBe("成绩总览");
  });

  it("未交卷的答卷:notSubmitted 为真,页面据此收起成绩与判词", async () => {
    sheetState.detail = ownerSheet({
      status: "答题中",
      submittedAt: null,
      gradedAt: null,
      objectiveScore: null,
      totalScore: null,
      durationSeconds: null,
      submitKind: null
    });

    const review = await mountOwnerReview();

    expect(review.notSubmitted.value).toBe(true);
    expect(review.blocked.value).toBe("");
    expect(review.durationText.value).toBe("");
    expect(review.passed.value).toBeNull();
  });

  it("答卷已被撤销(data:null)时落 notReady 空态,不抛异常", async () => {
    sheetState.detail = null;

    const review = await mountOwnerReview();

    expect(review.blocked.value).toBe("notReady");
    expect(review.blockedText.value).toContain("答卷不存在");
    expect(review.review.value).toBeNull();
    expect(review.loading.value).toBe(false);
  });

  it("连着查阅多份答卷:上一份的阅读态不会串到下一份", async () => {
    const review = await mountOwnerReview();
    // 直接置态而不调 enterFocus():那条路径会 scrollIntoView,node 环境没有 document
    review.wrongOnly.value = true;
    review.mode.value = "focus";
    review.currentQuestionId.value = "q1";
    review.navOpen.value = true;

    routeState.query = { sheetId: "s2", source: "results", paperId: "p1" };
    sheetState.detail = ownerSheet({ sheetId: "s2" });
    await review.load();

    expect(review.wrongOnly.value).toBe(false);
    expect(review.mode.value).toBe("overview");
    expect(review.currentQuestionId.value).toBeNull();
    expect(review.navOpen.value).toBe(false);
  });

  it("深链没带 paperId 时,回成绩总览用答卷自身所属试卷兜底", async () => {
    routeState.query = { sheetId: "s1", source: "results" };

    const review = await mountOwnerReview();
    review.backToSource();

    expect(routerPush).toHaveBeenCalledWith({
      name: "ExamResults",
      query: { paperId: "p-owned" }
    });
  });

  it("未交卷答卷再次进入会重取快照,已交卷答卷不重复拉取", async () => {
    sheetState.detail = ownerSheet({
      status: "答题中",
      submittedAt: null,
      totalScore: null,
      durationSeconds: null
    });
    await mountOwnerReview();
    expect(httpRequest).toHaveBeenCalledTimes(1);

    await flushActivated();
    expect(httpRequest).toHaveBeenCalledTimes(2);

    // 已交卷的答卷是封存态,再次激活不该白拉一次
    vi.resetModules();
    lifecycle.mounted.length = 0;
    lifecycle.activated.length = 0;
    httpRequest.mockClear();
    sheetState.detail = ownerSheet();
    await mountOwnerReview();
    expect(httpRequest).toHaveBeenCalledTimes(1);

    await flushActivated();
    expect(httpRequest).toHaveBeenCalledTimes(1);
  });
});
