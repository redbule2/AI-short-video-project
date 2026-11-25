import type { ExamQuestionGroupDto } from "@/api/exam";

export interface QuestionWithGroup {
  group: ExamQuestionGroupDto | null;
}

export function isQuestionGroupStart(
  questions: readonly QuestionWithGroup[],
  index: number
): boolean {
  const groupId = questions[index]?.group?.id;
  if (!groupId) return false;
  return index === 0 || questions[index - 1]?.group?.id !== groupId;
}

/** 返回当前子题所属的大题序号；未分组题自身按一道大题计。 */
export function questionMajorNo(
  questions: readonly QuestionWithGroup[],
  targetIndex: number
): number {
  let majorNo = 0;
  for (let index = 0; index <= targetIndex && index < questions.length; index++) {
    if (!questions[index]?.group || isQuestionGroupStart(questions, index)) {
      majorNo += 1;
    }
  }
  return majorNo;
}

export function countMajorQuestions(
  questions: readonly QuestionWithGroup[]
): number {
  return questionMajorNo(questions, questions.length - 1);
}

export function toChineseQuestionNumber(value: number): string {
  if (value <= 0 || value > 99) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value];
  const tens = Math.floor(value / 10);
  const units = value % 10;
  return `${tens === 1 ? "" : digits[tens]}十${units ? digits[units] : ""}`;
}
