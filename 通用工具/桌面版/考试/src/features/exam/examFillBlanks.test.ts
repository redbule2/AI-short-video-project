import { describe, expect, it } from "vitest";
import {
  blankBoxWidth,
  countStemBlanks,
  layoutFillBlank,
  normalizeBlankAnswers,
  resolveBlankCount
} from "./fillBlanks";

function textOf(stem: string, blankCount: number) {
  return layoutFillBlank(stem, blankCount)
    .segments.map(segment =>
      segment.kind === "text" ? segment.text : `[${segment.blankIndex}]`
    )
    .join("");
}

describe("填空题版式", () => {
  it("标记数与空数一致时,输入框嵌进句子", () => {
    const layout = layoutFillBlank("光的三原色是____、____和____。", 3);
    expect(layout.inline).toBe(true);
    expect(layout.trailing).toEqual([]);
    expect(textOf("光的三原色是____、____和____。", 3)).toBe(
      "光的三原色是[0]、[1]和[2]。"
    );
  });

  it("全角下划线同样算空位(全角只需 2 个:不会与代码写法撞车)", () => {
    expect(countStemBlanks("提示词的主体是＿＿＿＿,风格是＿＿")).toBe(2);
    expect(layoutFillBlank("提示词的主体是＿＿＿＿,风格是＿＿", 2).inline).toBe(
      true
    );
  });

  it("空括号不算空位:foo() 与中文空位分不开,错认就会让下标错位判错", () => {
    expect(countStemBlanks("调用 foo() 后,返回值是____。")).toBe(1);
    const layout = layoutFillBlank("调用 foo() 后,返回值是____。", 2);
    expect(layout.inline).toBe(false);
    expect(layout.trailing).toEqual([0, 1]);
  });

  it("题干没写横线时,题干原样保留,空排在下面", () => {
    const layout = layoutFillBlank("写出扩散模型采样的两个关键参数。", 2);
    expect(layout.inline).toBe(false);
    expect(layout.segments).toEqual([
      { kind: "text", text: "写出扩散模型采样的两个关键参数。" }
    ]);
    expect(layout.trailing).toEqual([0, 1]);
  });

  it("标记数与空数对不上时整体退回补空,绝不切碎题干", () => {
    const layout = layoutFillBlank("写出两条提示词原则:第一条____。", 2);
    expect(layout.inline).toBe(false);
    expect(layout.trailing).toEqual([0, 1]);
    expect(layout.segments[0]).toEqual({
      kind: "text",
      text: "写出两条提示词原则:第一条____。"
    });
  });

  /**
   * 巧合命中比数目不符危险得多:题干被切碎的同时,真正的空位下标整体后移,
   * 而填空按下标判分 ⇒ 静默判错。这几条都必须只认那一个真空位。
   */
  it.each([
    ["Python 的构造方法名是 __init__ 吗?他是____。", 1],
    ["路径分隔符是____,模块入口文件是 __main__.py。", 1],
    ["Markdown 里 __加粗__ 的语法是____。", 1],
    ["变量 file_name 的命名风格叫____。", 1],
    ["以下代码 print() 输出的是____,类型是____。", 2]
  ])("代码写法不会被当成空位:%s", (stem, expected) => {
    expect(countStemBlanks(stem as string)).toBe(expected);
    expect(layoutFillBlank(stem as string, expected as number).inline).toBe(
      true
    );
  });

  it("被误当空位时下标不会整体后移(命中的就是真正那个空)", () => {
    expect(textOf("路径分隔符是____,模块入口文件是 __main__.py。", 1)).toBe(
      "路径分隔符是[0],模块入口文件是 __main__.py。"
    );
  });

  it("横线越长输入框起手越宽,但有上下限", () => {
    const short = layoutFillBlank("答:___。", 1).segments[1];
    const long = layoutFillBlank(`答:${"_".repeat(40)}。`, 1).segments[1];
    expect(short).toMatchObject({ kind: "blank", width: 6 });
    expect(long).toMatchObject({ kind: "blank", width: 16 });
  });

  it("空数以服务端为准,缺失时回退题干标记数,再兜底 1", () => {
    expect(resolveBlankCount(3, "只有一个____")).toBe(3);
    expect(resolveBlankCount(null, "____和____")).toBe(2);
    expect(resolveBlankCount(0, "没有横线")).toBe(1);
  });
});

describe("填空空位宽度", () => {
  it("没写内容时用题干横线的长度", () => {
    expect(blankBoxWidth(6, "")).toBe(6);
    expect(blankBoxWidth(16, "")).toBe(16);
  });

  it("写长了就撑开——考生必须看得全自己写的答案", () => {
    expect(blankBoxWidth(6, "CFG Scale")).toBe(11);
    // 汉字按两倍宽估:4 字 = 8ch + 2
    expect(blankBoxWidth(6, "清晨侧逆光")).toBe(12);
  });

  it("再长也有上限,不把一行撑爆", () => {
    expect(blankBoxWidth(6, "很长的答案".repeat(20))).toBe(32);
  });
});

describe("填空作答数组", () => {
  it("按空数补齐,保持下标对齐", () => {
    expect(normalizeBlankAnswers(["甲"], 3)).toEqual(["甲", "", ""]);
    expect(normalizeBlankAnswers(undefined, 2)).toEqual(["", ""]);
  });

  it("老师减少空数时不截断已写下的作答(后端不做规范化,截了就没了)", () => {
    expect(normalizeBlankAnswers(["甲", "乙", "丙"], 2)).toEqual([
      "甲",
      "乙",
      "丙"
    ]);
  });
});
