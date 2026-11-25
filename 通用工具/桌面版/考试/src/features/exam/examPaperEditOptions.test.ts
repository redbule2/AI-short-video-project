import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 删除选项后的答案跟随回归(gpt-5.6-sol 评审必改#5 的永久测试):
 * 选项重排字母后,正确答案必须"跟人走"(按内容迁移),
 * 被删选项对应的答案清除——不能让旧 key 静默指到别的选项内容。
 */

type LifecycleCallback = () => void | Promise<void>;

const lifecycle = vi.hoisted(() => ({ mounted: [] as LifecycleCallback[] }));

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
  useRoute: () => ({ path: "/exam/paper-edit", query: {} }),
  useRouter: () => ({ push: vi.fn(async () => undefined) })
}));

vi.mock("@/utils/http", () => ({
  http: {
    request: vi.fn(async () => ({ success: true, message: "", data: null }))
  }
}));
vi.mock("@/utils/message", () => ({ message: vi.fn() }));
vi.mock("element-plus", () => ({
  ElMessageBox: { confirm: vi.fn(async () => "confirm") }
}));

beforeEach(() => {
  lifecycle.mounted.length = 0;
});

describe("removeOption keeps answers pointed at the same content", () => {
  it("单选:删 B 后原 C 内容变 B,答案 C→B 跟随", async () => {
    const { useExamPaperEdit } = await import("./useExamPaperEdit");
    const edit = useExamPaperEdit();
    const q = edit.addQuestion("single");
    q.options = [
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
      { key: "C", text: "丙" },
      { key: "D", text: "丁" }
    ];
    q.singleAnswer = "C"; // 正确答案 = 丙

    edit.removeOption(q, "B");

    expect(q.options.map(o => `${o.key}:${o.text}`)).toEqual([
      "A:甲",
      "B:丙",
      "C:丁"
    ]);
    expect(q.singleAnswer).toBe("B"); // 仍指向"丙"
  });

  it("单选:删掉正确答案本身则清空答案", async () => {
    const { useExamPaperEdit } = await import("./useExamPaperEdit");
    const edit = useExamPaperEdit();
    const q = edit.addQuestion("single");
    q.options = [
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
      { key: "C", text: "丙" }
    ];
    q.singleAnswer = "B";

    edit.removeOption(q, "B");

    expect(q.singleAnswer).toBe("");
  });

  it("多选:答案集合按内容迁移,被删项剔除", async () => {
    const { useExamPaperEdit } = await import("./useExamPaperEdit");
    const edit = useExamPaperEdit();
    const q = edit.addQuestion("multiple");
    q.options = [
      { key: "A", text: "甲" },
      { key: "B", text: "乙" },
      { key: "C", text: "丙" },
      { key: "D", text: "丁" }
    ];
    q.multipleAnswers = ["B", "D"]; // 乙 + 丁

    edit.removeOption(q, "B");

    // 剩 A:甲 B:丙 C:丁 → 原"丁"现在是 C;被删的"乙"剔除
    expect(q.multipleAnswers).toEqual(["C"]);
  });
});
