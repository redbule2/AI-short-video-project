import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 人工阅卷工作台行为测试（逐题阅卷 + 批语选填，2026-07-25）。
 * 覆盖：
 *   - 完成口径只看「合法整数得分」，批语留白/纯空白不影响 isComplete；
 *   - 得分越界或非整数不算完成；
 *   - 逐题游标与评分草稿写入 localStorage，重开页面可恢复；
 *   - 首次提交成功后清空草稿。
 * 请求条数预算在 examRequestBudget.test.ts（单源 quality/performance-budgets.json）。
 */

type LifecycleCallback = () => void | Promise<void>;

const lifecycle = vi.hoisted(() => ({ mounted: [] as LifecycleCallback[] }));
const routeState = vi.hoisted(() => ({ query: {} as Record<string, string> }));

const httpRequest = vi.hoisted(() =>
  vi.fn(async (method: string, url: string) => {
    if (url === "/api/exam/manual-grading/sheets/s1" && method === "get") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          paperId: "p1",
          paperTitle: "行为夹具卷",
          studentUsername: "sub01",
          studentDisplayName: "学员一",
          paperTotalScore: 60,
          objectiveScore: 12,
          submittedAt: "2026-07-25T09:55:00",
          requiresManualGrading: true,
          referencesUnlocked: false,
          revision: 0,
          manualTotalScore: null,
          firstSubmittedAt: null,
          viewerUsername: "owner",
          viewerDisplayName: "主账号",
          viewerIsOwner: true,
          assignedGraderUsername: null,
          items: [
            {
              questionId: "q1",
              type: "essay",
              stem: "说明视角变化",
              stemImages: null,
              options: null,
              score: 5,
              studentAnswer: { text: "由远到近" },
              manualScore: null,
              manualComment: null,
              orderNo: 1,
              group: null
            },
            {
              questionId: "q2",
              type: "fillBlank",
              stem: "补全术语",
              stemImages: null,
              options: null,
              score: 3,
              studentAnswer: { answers: ["景别"] },
              manualScore: null,
              manualComment: null,
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
              manualScore: null,
              manualComment: null,
              orderNo: 3,
              group: null
            }
          ]
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
          revision: 1,
          aiTotalScore: 30,
          items: []
        }
      };
    }
    if (url === "/api/exam/manual-grading/sheets/s1" && method === "put") {
      return {
        success: true,
        message: "",
        data: {
          sheetId: "s1",
          referencesUnlocked: true,
          revision: 1,
          manualTotalScore: 55,
          firstSubmittedAt: "2026-07-25T10:00:00"
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() })
}));

vi.mock("@/utils/http", () => ({ http: { request: httpRequest } }));
vi.mock("@/utils/message", () => ({ message: vi.fn() }));
vi.mock("element-plus", () => ({
  ElMessageBox: { confirm: vi.fn(async () => "confirm") }
}));

/** vitest 跑在 node 环境，草稿落盘要自备最小 window.localStorage。 */
const memoryStore = new Map<string, string>();
const windowStub = {
  localStorage: {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value);
    },
    removeItem: (key: string) => {
      memoryStore.delete(key);
    }
  }
};

async function flushMounted() {
  for (const callback of lifecycle.mounted) {
    await callback();
  }
  await Promise.resolve();
  await Promise.resolve();
}

async function mountWorkbench() {
  lifecycle.mounted.length = 0;
  const { useExamManualGrading } = await import("./useExamManualGrading");
  const manual = useExamManualGrading();
  await flushMounted();
  return manual;
}

beforeEach(() => {
  vi.stubGlobal("window", windowStub);
  httpRequest.mockClear();
  memoryStore.clear();
  lifecycle.mounted.length = 0;
  routeState.query = { sheetId: "s1", paperId: "p1" };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("人工阅卷工作台 · 逐题与批语选填", () => {
  it("完成口径只看得分：批语留白仍算已评分且可提交", async () => {
    const manual = await mountWorkbench();

    expect(manual.completedCount.value).toBe(0);
    expect(manual.isComplete.value).toBe(false);

    manual.setScore("q1", 5);
    manual.setScore("q2", 0);
    manual.setScore("q3", 40);
    await Promise.resolve();

    expect(
      Object.values(manual.grades.value).every(item => item.comment === "")
    ).toBe(true);
    expect(manual.completedCount.value).toBe(3);
    expect(manual.unscoredCount.value).toBe(0);
    expect(manual.isComplete.value).toBe(true);
    expect(manual.progressPercent.value).toBe(100);
    // 客观 12 + 人工 45
    expect(manual.projectedTotal.value).toBe(57);
  });

  it("纯空白批语不影响完成态，提交时按 trim 后的空串下发", async () => {
    const manual = await mountWorkbench();
    manual.setScore("q1", 4);
    manual.setScore("q2", 3);
    manual.setScore("q3", 20);
    manual.setComment("q1", "   \n\t  ");
    manual.setComment("q2", "  论据完整。 ");
    await Promise.resolve();

    expect(manual.isComplete.value).toBe(true);

    httpRequest.mockClear();
    await manual.submit();

    const putCall = httpRequest.mock.calls.find(
      ([method, url]) =>
        method === "put" && url === "/api/exam/manual-grading/sheets/s1"
    ) as unknown as [string, string, { data: { items: unknown[] } }];
    expect(putCall[2].data.items).toEqual([
      { questionId: "q1", score: 4, comment: "" },
      { questionId: "q2", score: 3, comment: "论据完整。" },
      { questionId: "q3", score: 20, comment: "" }
    ]);
  });

  it("越界或非整数得分不计入完成", async () => {
    const manual = await mountWorkbench();

    manual.grades.value.q1.score = 6; // 满分 5
    manual.grades.value.q2.score = -1;
    manual.grades.value.q3.score = 12.5;
    await Promise.resolve();

    expect(manual.completedCount.value).toBe(0);
    expect(manual.isComplete.value).toBe(false);
  });

  it("未评分题定位：firstUnscoredIndex 与一键跳转指向第一道缺分题", async () => {
    const manual = await mountWorkbench();
    manual.setScore("q1", 5);
    manual.setScore("q3", 40);
    await Promise.resolve();

    expect(manual.firstUnscoredIndex.value).toBe(1);
    manual.goFirstUnscored();
    expect(manual.currentIndex.value).toBe(1);
    expect(manual.currentItem.value?.questionId).toBe("q2");

    manual.setScore("q2", 2);
    await Promise.resolve();
    expect(manual.firstUnscoredIndex.value).toBe(-1);
  });

  it("刷新后恢复评分草稿与当前题游标", async () => {
    const first = await mountWorkbench();
    first.setScore("q1", 3);
    first.setComment("q1", "论证略薄。");
    first.goTo(2);
    await Promise.resolve();

    expect(memoryStore.size).toBe(1);

    // 重新进入页面（等价于刷新/关标签重开）
    const second = await mountWorkbench();
    expect(second.grades.value.q1).toEqual({
      score: 3,
      comment: "论证略薄。"
    });
    expect(second.currentIndex.value).toBe(2);
    expect(second.currentItem.value?.questionId).toBe("q3");
    expect(second.completedCount.value).toBe(1);
  });

  it("首次提交成功后清空本地草稿并解锁参考信息", async () => {
    const manual = await mountWorkbench();
    manual.setScore("q1", 5);
    manual.setScore("q2", 3);
    manual.setScore("q3", 40);
    await Promise.resolve();
    expect(memoryStore.size).toBe(1);

    await manual.submit();

    expect(memoryStore.size).toBe(0);
    expect(manual.isReviewStage.value).toBe(true);
    expect(manual.workspace.value?.revision).toBe(1);
  });
});
