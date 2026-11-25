import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 出题工作台重载回归(gpt-5.6-sol 必改#3 的永久测试):
 * essay 的参考答案与 practical 的评分标准同用 answer.reference 承载,
 * 详情重载后两者都必须回填 essayReference,且原样进入保存载荷——
 * 否则实操题「保存→刷新→再保存」会丢评分标准并被必填校验卡死。
 */

type LifecycleCallback = () => void | Promise<void>;

const lifecycle = vi.hoisted(() => ({ mounted: [] as LifecycleCallback[] }));

const httpRequest = vi.hoisted(() =>
  vi.fn(async (method: string, url: string, config?: { data?: unknown }) => {
    if (method === "get" && url === "/api/exam/papers/p1") {
      return {
        success: true,
        message: "",
        data: {
          paperId: "p1",
          title: "重载回归卷",
          description: null,
          status: "草稿",
          durationMinutes: null,
          totalScore: 0,
          passScore: null,
          answerRevealPolicy: "onSubmit",
          answerPublishedAt: null,
          questions: [
            {
              questionId: "q-essay",
              type: "essay",
              stem: "简答题干",
              stemImages: null,
              options: null,
              answer: { reference: "简答参考答案" },
              analysis: "简答解析",
              score: 20,
              orderNo: 1,
              group: {
                id: "case-1",
                title: "共享案例",
                caseText: "同一段原始提示词",
                subQuestionNo: 1
              }
            },
            {
              questionId: "q-practical",
              type: "practical",
              stem: "实操题干",
              stemImages: null,
              options: null,
              answer: { reference: "实操评分标准" },
              analysis: "实操解析",
              score: 20,
              orderNo: 2,
              group: {
                id: "case-1",
                title: "共享案例",
                caseText: "同一段原始提示词",
                subQuestionNo: 2
              }
            }
          ]
        }
      };
    }
    if (method === "put") {
      httpPutBodies.push({ url, data: config?.data });
      return { success: true, message: "", data: null };
    }
    return { success: true, message: "", data: null };
  })
);

const httpPutBodies = vi.hoisted(
  () => [] as Array<{ url: string; data: unknown }>
);

vi.mock("vue", async importOriginal => {
  const actual = await importOriginal<typeof import("vue")>();
  return {
    ...actual,
    onMounted: (callback: LifecycleCallback) => {
      lifecycle.mounted.push(callback);
    }
  };
});

vi.mock("vue-router", () => ({
  useRoute: () => ({ path: "/exam/paper-edit", query: { paperId: "p1" } }),
  useRouter: () => ({ push: vi.fn(async () => undefined) })
}));

vi.mock("@/utils/http", () => ({ http: { request: httpRequest } }));
vi.mock("@/utils/message", () => ({ message: vi.fn() }));
vi.mock("element-plus", () => ({
  ElMessageBox: {
    confirm: vi.fn(async () => "confirm"),
    prompt: vi.fn(async () => ({ value: "x" }))
  }
}));

async function flushMounted() {
  for (const callback of lifecycle.mounted) {
    await callback();
  }
  await Promise.resolve();
}

beforeEach(() => {
  httpRequest.mockClear();
  httpPutBodies.length = 0;
  lifecycle.mounted.length = 0;
});

describe("paper-edit reload keeps reference fields", () => {
  it("essay 参考答案与 practical 评分标准重载后都回填", async () => {
    const { useExamPaperEdit } = await import("./useExamPaperEdit");
    const edit = useExamPaperEdit();
    await flushMounted();

    expect(edit.questions.value).toHaveLength(2);
    expect(edit.questions.value[0].essayReference).toBe("简答参考答案");
    expect(edit.questions.value[1].essayReference).toBe("实操评分标准");
    expect(edit.questions.value.map(item => item.group?.subQuestionNo)).toEqual([
      1, 2
    ]);
  });

  it("重载后不做任何修改直接保存,reference 原样进入载荷(不会被必填校验卡死)", async () => {
    const { useExamPaperEdit } = await import("./useExamPaperEdit");
    const edit = useExamPaperEdit();
    await flushMounted();

    const saved = await edit.save();
    expect(saved).toBe(true);

    const questionsPut = httpPutBodies.find(item =>
      item.url.endsWith("/questions")
    );
    expect(questionsPut).toBeDefined();
    const payload = questionsPut!.data as {
      questions: Array<{
        type: string;
        answer: { reference?: string };
        group?: { id: string; caseText: string | null; subQuestionNo: number };
      }>;
    };
    expect(payload.questions[0].answer.reference).toBe("简答参考答案");
    expect(payload.questions[1].answer.reference).toBe("实操评分标准");
    expect(payload.questions.map(item => item.group?.subQuestionNo)).toEqual([
      1, 2
    ]);
    expect(payload.questions[0].group?.caseText).toBe("同一段原始提示词");
  });
});
