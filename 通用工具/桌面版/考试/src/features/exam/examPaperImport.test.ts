import { describe, expect, it } from "vitest";
import { importSummary, readPaperFile } from "./paperImport";

/**
 * 「导入试卷」读文件(桌面版 2026-11-26 加):只挡根本不是试卷文件的,
 * 每道题合不合规矩留给后端判;请求条数在 examRequestBudget.test.ts。
 */
const PAPER = {
  title: "Seedance提示词教程 · 第 1 课 写好生成目标",
  description: "课后练习",
  durationMinutes: null,
  passScore: 60,
  answerRevealPolicy: "onSubmit",
  questions: [
    {
      type: "fillBlank",
      stem: "写生成目标就写三样:____、____、____。",
      answer: { answers: ["谁", "做什么", "最后怎样"] },
      analysis: "意思对就给分",
      score: 5
    }
  ]
};

describe("readPaperFile", () => {
  it("好的试卷文件原样读出来", () => {
    const result = readPaperFile(JSON.stringify(PAPER));
    expect(result).toEqual({ ok: true, paper: PAPER });
  });

  it("开头带 BOM 的(记事本另存的)也读得了", () => {
    const result = readPaperFile(String.fromCharCode(0xfeff) + JSON.stringify(PAPER));
    expect(result.ok).toBe(true);
  });

  it("不是 JSON、不是一张卷的:说选错了文件", () => {
    expect(readPaperFile("第 1 课 课后练习")).toEqual({
      ok: false,
      reason: "不是试卷文件(读不成 JSON)"
    });
    for (const text of ["[]", "null", "3", JSON.stringify("卷")]) {
      expect(readPaperFile(text)).toEqual({
        ok: false,
        reason: "不是试卷文件(里面不是一张卷)"
      });
    }
  });

  it("没卷名、没题目的:说缺哪样", () => {
    expect(readPaperFile(JSON.stringify({ ...PAPER, title: "  " }))).toEqual({
      ok: false,
      reason: "没写卷名(title)"
    });
    expect(readPaperFile(JSON.stringify({ questions: PAPER.questions }))).toEqual({
      ok: false,
      reason: "没写卷名(title)"
    });
    expect(readPaperFile(JSON.stringify({ ...PAPER, questions: [] }))).toEqual({
      ok: false,
      reason: "里面一道题都没有(questions)"
    });
    expect(readPaperFile(JSON.stringify({ title: "卷", questions: "十道" }))).toEqual({
      ok: false,
      reason: "里面一道题都没有(questions)"
    });
  });

  it("题目本身合不合规矩不在这里判(留给后端,规矩只写一处)", () => {
    const odd = { title: "卷", questions: [{ type: "不认识的题型" }] };
    expect(readPaperFile(JSON.stringify(odd)).ok).toBe(true);
  });
});

describe("importSummary", () => {
  it("都成了:只说导入了几张、都是草稿", () => {
    expect(importSummary(["甲", "乙"], [])).toEqual([
      "导入了 2 张,都是草稿——复核后再点「发布」。"
    ]);
  });

  it("有没成的:一份一行,带着原因", () => {
    expect(importSummary(["甲"], ["乙.json:没写卷名(title)"])).toEqual([
      "导入了 1 张,都是草稿——复核后再点「发布」。",
      "这 1 份没导进来:",
      "乙.json:没写卷名(title)"
    ]);
    expect(importSummary([], ["乙.json:不是试卷文件(读不成 JSON)"])).toEqual([
      "这 1 份没导进来:",
      "乙.json:不是试卷文件(读不成 JSON)"
    ]);
  });
});
