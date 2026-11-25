/**
 * 填空题「直接填空」的版式与输入规则(纯函数;答题页卷面直答与专注模式共用一份)。
 *
 * 版式规则(刻意从简,宁可少嵌一次,也不把题干切碎):
 * - 空位标记 = 连续 3 个及以上半角下划线,或 2 个及以上全角下划线(`＿＿`);
 * - 半角下划线两侧不能紧挨英文字母/数字/下划线——`__init__`、`__main__.py`、
 *   Markdown 的 `__加粗__` 都因此排除。全角下划线不会出现在代码标识符里,不需要这层判定;
 * - 空括号不算标记:`foo()`、`print()` 与中文「( )」空位在题干里无法可靠区分,
 *   宁可退回补空行,也不能把 `foo()` 当成第一个空——那会让后面每个空的下标都错位,
 *   而填空是按下标判分的(后端 correctAnswer.answers 逐位对齐),错位=静默判错;
 * - 只有「题干里的标记数 === 服务端按参考答案下发的空数」时,才把输入框嵌进句子里(所见即所填);
 * - 数目对不上(含题干没写标记)就原样展示题干,把空排在题干下面并标「空 1 / 空 2」
 *   ——每个空都够得着,不靠猜。
 *
 * 输入规则:填空必须自己写,粘贴/拖入一律拦下——规则与简答共用一份,见 `pasteGuard.ts`。
 */

/** 空位候选。每次调用新建实例:带 g 标志的正则共享 lastIndex,复用会漏匹配。 */
function blankMarker() {
  return /_{3,}|＿{2,}/g;
}

/** 会让下划线变成代码标识符一部分的字符(中日韩文字不在其列:中文题干里「是____。」必须算空位)。 */
function isIdentifierChar(char: string | undefined) {
  return Boolean(char) && /[A-Za-z0-9_]/.test(char as string);
}

/** 题干里真正的空位标记(已滤掉 `__init__` 这类代码写法)。 */
function findBlankMarkers(stem: string) {
  return [...(stem ?? "").matchAll(blankMarker())].filter(match => {
    if (match[0].startsWith("＿")) return true;
    const start = match.index ?? 0;
    return (
      !isIdentifierChar(stem[start - 1]) &&
      !isIdentifierChar(stem[start + match[0].length])
    );
  });
}

export type FillBlankSegment =
  | { kind: "text"; text: string }
  | { kind: "blank"; blankIndex: number; width: number };

export interface FillBlankLayout {
  /** true = 空位嵌在题干里;false = 题干原样 + 末尾按「空 N」补齐。 */
  inline: boolean;
  blankCount: number;
  segments: FillBlankSegment[];
  /** 需要补在题干后面的空序号(0 基);inline 时为空。 */
  trailing: number[];
}

/** 空位起始宽度(ch):照着题干里横线的长度给。下限 6 是因为老师最常写 `____`(4 条),
 *  4ch 扣掉左右内边距只剩一个多汉字宽,起手就显窄。实际宽度还会随作答变长,见 blankBoxWidth。 */
function blankWidth(marker: string) {
  return Math.min(Math.max(marker.length, 6), 16);
}

/**
 * 空位实际宽度(ch):取「题干横线长度」与「当前作答所需宽度」的较大者,写多长就撑多长。
 * 固定宽度会让考生看不全自己写的答案(4ch 只够一个多汉字),这在考试里是硬伤。
 * 汉字按 2ch 估:ch 是数字 0 的宽度,CJK 字形约两倍宽。
 */
export function blankBoxWidth(markerWidth: number, value: string): number {
  let typed = 0;
  for (const char of value ?? "") {
    typed += /[⺀-鿿豈-﫿＀-｠]/.test(char) ? 2 : 1;
  }
  return Math.min(Math.max(markerWidth, typed + 2), 32);
}

/** 题干里的空位标记数(供缺省空数回退用)。 */
export function countStemBlanks(stem: string): number {
  return findBlankMarkers(stem).length;
}

/** 本题空数:服务端按参考答案下发的为准;缺失时回退题干标记数,再兜底 1。 */
export function resolveBlankCount(
  blankCount: number | null | undefined,
  stem: string
): number {
  if (blankCount && blankCount > 0) return blankCount;
  return Math.max(1, countStemBlanks(stem));
}

export function layoutFillBlank(
  stem: string,
  blankCount: number
): FillBlankLayout {
  const source = stem ?? "";
  const total = Math.max(0, blankCount);
  const matches = findBlankMarkers(source);

  if (total === 0 || matches.length !== total) {
    return {
      inline: false,
      blankCount: total,
      segments: source ? [{ kind: "text", text: source }] : [],
      trailing: Array.from({ length: total }, (_, index) => index)
    };
  }

  const segments: FillBlankSegment[] = [];
  let cursor = 0;
  matches.forEach((match, blankIndex) => {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: "text", text: source.slice(cursor, start) });
    }
    segments.push({ kind: "blank", blankIndex, width: blankWidth(match[0]) });
    cursor = start + match[0].length;
  });
  if (cursor < source.length) {
    segments.push({ kind: "text", text: source.slice(cursor) });
  }

  return { inline: true, blankCount: total, segments, trailing: [] };
}

/**
 * 补齐到 blankCount 长度的作答数组(后端按下标对齐判分,不能缺位)。
 * 只补不截:老师把参考答案从 3 空改成 2 空时,考生已经写下的第 3 空必须留着
 * ——后端对填空不做任何规范化(原样存原样回灌),截掉就是当场销毁作答且不可恢复。
 * 数组因此可能长于 blankCount,后端保存校验不比对长度,是安全的。
 */
export function normalizeBlankAnswers(
  current: readonly string[] | undefined,
  blankCount: number
): string[] {
  const length = Math.max(Math.max(0, blankCount), current?.length ?? 0);
  return Array.from({ length }, (_, index) =>
    typeof current?.[index] === "string" ? current[index] : ""
  );
}
