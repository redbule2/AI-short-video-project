import { describe, expect, it } from "vitest";
import type { ExamQuestionGroupDto } from "@/api/exam";
import {
  countMajorQuestions,
  isQuestionGroupStart,
  questionMajorNo,
  toChineseQuestionNumber
} from "./questionGroups";

function grouped(id: string, subQuestionNo: number): {
  group: ExamQuestionGroupDto;
} {
  return {
    group: {
      id,
      title: `大题 ${id}`,
      caseText: null,
      subQuestionNo
    }
  };
}

describe("exam question groups", () => {
  const questions = [
    grouped("a", 1),
    grouped("a", 2),
    { group: null },
    grouped("b", 1),
    grouped("b", 2),
    grouped("b", 3)
  ];

  it("同组只计一道大题，独立题自身计一道", () => {
    expect(countMajorQuestions(questions)).toBe(3);
    expect(questions.map((_, index) => questionMajorNo(questions, index))).toEqual([
      1, 1, 2, 3, 3, 3
    ]);
  });

  it("只在同组第一道子题展示共享案例", () => {
    expect(
      questions.map((_, index) => isQuestionGroupStart(questions, index))
    ).toEqual([true, false, false, true, false, false]);
  });

  it("大题编号使用中文数字", () => {
    expect([1, 10, 15, 27].map(toChineseQuestionNumber)).toEqual([
      "一",
      "十",
      "十五",
      "二十七"
    ]);
  });
});
