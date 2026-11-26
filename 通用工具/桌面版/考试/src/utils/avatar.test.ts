// 壳子自己的（不是照搬的）：圆头像上写的字（2026-11-26）。
import { describe, expect, it } from "vitest";
import { avatarText } from "./avatar";

describe("头像上的字", () => {
  it("中文名取最后两个字，别的取头一个字母大写，空的写问号", () => {
    expect(["小王", "张三丰", "欧阳娜娜", "周", "boss", " amy ", "Tom张", "", null].map(avatarText)).toEqual([
      "小王",
      "三丰",
      "娜娜",
      "周",
      "B",
      "A",
      "张",
      "?",
      "?"
    ]);
  });
});
