import { http } from "@/utils/http";

/**
 * 考试模块 API(docs\考试模块设计_2026-07-23.md §6)。
 * 错误契约:业务失败 HTTP 200 + success:false + error.kind(机器可判,禁按中文文案分支);
 * 本文件把 kind 提升为 ExamApiError,页面按 err.kind 分支。
 */

export interface ApiError {
  kind: string;
  retryable?: boolean;
  detail?: unknown;
}

export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
  error?: ApiError | null;
}

/** 携带机器可判 kind 的考试域错误(规范 §3.1)。 */
export class ExamApiError extends Error {
  readonly kind: string;
  readonly retryable: boolean;
  /** 后端 error.detail 原样透传(信封只加法;按 kind 各自约定形状)。 */
  readonly detail: unknown;

  constructor(
    message: string,
    kind = "business-error",
    retryable = false,
    detail: unknown = null
  ) {
    super(message || "请求失败");
    this.name = "ExamApiError";
    this.kind = kind;
    this.retryable = retryable;
    this.detail = detail;
  }
}

export const ExamErrorKinds = {
  PaperNotPublished: "paper-not-published",
  ExamDeadlinePassed: "exam-deadline-passed",
  SheetNotActive: "sheet-not-active",
  ExamTimeOver: "exam-time-over",
  AnswersNotPublished: "answers-not-published",
  AnswerShapeInvalid: "answer-shape-invalid",
  ManualGradingRequired: "manual-grading-required",
  ManualGradingConflict: "manual-grading-conflict",
  ManualGradingNotAssigned: "manual-grading-not-assigned",
  ManualGradingAssignedElsewhere: "manual-grading-assigned-elsewhere",
  ManualGradingAssignmentLocked: "manual-grading-assignment-locked",
  /** 计时 v2:考试已暂停,作答/上传被拒(恢复后再试)。 */
  ExamPaused: "exam-paused"
} as const;

/** 题型 wire 值(库值为中文,映射在后端 ExamScoring)。 */
export type ExamQuestionType =
  | "single"
  | "multiple"
  | "judge"
  | "fillBlank"
  | "essay"
  | "practical";

/** 实操题上传的答案图片。 */
export interface ExamAnswerFile {
  url: string;
  name?: string;
}

/** 逐题型作答/答案对象(§5 同构 schema)。 */
export interface ExamAnswerValue {
  answer?: string | boolean;
  answers?: string[];
  text?: string;
  reference?: string;
  /** 实操题:上传图片列表(≤3 张,url 限本答卷上传目录)。 */
  files?: ExamAnswerFile[];
}

export interface ExamOptionDto {
  key: string;
  text: string;
}

/** 同一共享案例下的大题分组；每个题目行仍是独立计分子题。 */
export interface ExamQuestionGroupDto {
  id: string;
  title: string;
  caseText: string | null;
  subQuestionNo: number;
}

// ---------- 主账号 · 试卷 ----------

export interface ExamPaperSummaryDto {
  paperId: string;
  title: string;
  status: string;
  questionCount: number;
  totalScore: number;
  passScore: number | null;
  durationMinutes: number | null;
  answerRevealPolicy: "onSubmit" | "manual";
  answersPublished: boolean;
  assignedCount: number;
  submittedCount: number;
  gradedCount: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface ExamPaperListDto {
  pageIndex: number;
  pageSize: number;
  total: number;
  items: ExamPaperSummaryDto[];
}

export interface ExamQuestionFullDto {
  questionId: string;
  type: ExamQuestionType;
  stem: string;
  /** 题干配图(全题型可配,≤4 张)。 */
  stemImages: ExamAnswerFile[] | null;
  options: ExamOptionDto[] | null;
  answer: ExamAnswerValue | null;
  analysis: string;
  score: number;
  orderNo: number;
  group: ExamQuestionGroupDto | null;
}

export interface ExamPaperDetailDto {
  paperId: string;
  title: string;
  description: string | null;
  status: string;
  durationMinutes: number | null;
  totalScore: number;
  passScore: number | null;
  answerRevealPolicy: "onSubmit" | "manual";
  answerPublishedAt: string | null;
  questions: ExamQuestionFullDto[];
}

export interface SavePaperMetaRequest {
  title: string;
  description?: string | null;
  durationMinutes?: number | null;
  passScore?: number | null;
  answerRevealPolicy?: "onSubmit" | "manual";
}

export interface ExamQuestionInput {
  questionId?: string;
  type: ExamQuestionType;
  stem: string;
  /** 题干配图(url 须来自本卷上传接口)。 */
  stemImages?: ExamAnswerFile[];
  options?: ExamOptionDto[];
  answer: ExamAnswerValue;
  analysis: string;
  score: number;
  group?: ExamQuestionGroupDto | null;
}

export interface AssignSheetsResult {
  created: string[];
  skipped: string[];
}

export interface ExamSheetSummaryDto {
  sheetId: string;
  studentUsername: string;
  studentDisplayName: string | null;
  studentRemoved: boolean;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  deadline: string | null;
  /** 计时 v2:答题中且已暂停(老师侧可见)。 */
  paused: boolean;
  objectiveScore: number | null;
  /** AI / 系统评分轨道总分。 */
  totalScore: number | null;
  /** 人工评分轨道总分，整卷人工阅卷完成后才有值。 */
  manualTotalScore: number | null;
  manualGradingStatus: "notRequired" | "pending" | "completed";
  manualGradedAt: string | null;
  manualRevision: number;
  assignedGraderUsername: string | null;
  assignedGraderDisplayName: string | null;
  assignedGraderDisabled: boolean;
  submitKind: string | null;
}

export interface ExamPaperResultsDto {
  paperId: string;
  title: string;
  status: string;
  totalScore: number;
  passScore: number | null;
  truncated: boolean;
  sheets: ExamSheetSummaryDto[];
}

export interface ExamSheetItemDto {
  questionId: string;
  type: ExamQuestionType;
  stem: string;
  stemImages: ExamAnswerFile[] | null;
  options: ExamOptionDto[] | null;
  correctAnswer: ExamAnswerValue | null;
  analysis: string;
  score: number;
  studentAnswer: ExamAnswerValue | null;
  earnedScore: number | null;
  isCorrect: boolean | null;
  gradedBy: string | null;
  aiComment: string | null;
  manualScore: number | null;
  manualComment: string | null;
  manualGraderUsername: string | null;
  manualUpdatedAt: string | null;
  orderNo: number;
  group: ExamQuestionGroupDto | null;
}

export interface ExamSheetDetailDto {
  sheetId: string;
  paperId: string;
  paperTitle: string;
  studentUsername: string;
  studentDisplayName: string | null;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  objectiveScore: number | null;
  totalScore: number | null;
  manualTotalScore: number | null;
  manualGradedAt: string | null;
  manualRevision: number;
  paperTotalScore: number;
  /** 及格分(与考生复盘同源);主账号查阅时点亮同一枚及格印章。 */
  passScore: number | null;
  /** 作答用时秒数(交卷时间 - 开始时间);未交卷为 null。 */
  durationSeconds: number | null;
  submitKind: string | null;
  items: ExamSheetItemDto[];
}

// ---------- 主账号 · 人工阅卷 ----------

/** 盲评题目：此类型刻意不包含答案、解析和 AI 结论。 */
export interface ManualGradingQuestionDto {
  questionId: string;
  type: ExamQuestionType;
  stem: string;
  stemImages: ExamAnswerFile[] | null;
  options: ExamOptionDto[] | null;
  score: number;
  studentAnswer: ExamAnswerValue | null;
  manualScore: number | null;
  manualComment: string | null;
  orderNo: number;
  group: ExamQuestionGroupDto | null;
}

export interface ManualGradingWorkspaceDto {
  sheetId: string;
  paperId: string;
  paperTitle: string;
  studentUsername: string;
  studentDisplayName: string | null;
  paperTotalScore: number;
  objectiveScore: number;
  submittedAt: string | null;
  requiresManualGrading: boolean;
  referencesUnlocked: boolean;
  revision: number;
  manualTotalScore: number | null;
  firstSubmittedAt: string | null;
  viewerUsername: string;
  viewerDisplayName: string;
  viewerIsOwner: boolean;
  assignedGraderUsername: string | null;
  items: ManualGradingQuestionDto[];
}

export interface ManualGradingReferenceItemDto {
  questionId: string;
  correctAnswer: ExamAnswerValue | null;
  analysis: string;
  aiScore: number | null;
  aiGradedBy: string | null;
  aiComment: string | null;
}

export interface ManualGradingReferencesDto {
  sheetId: string;
  revision: number;
  aiTotalScore: number | null;
  items: ManualGradingReferenceItemDto[];
}

export interface ManualGradingInput {
  questionId: string;
  score: number;
  comment: string;
}

export interface ManualGradingSubmitResult {
  sheetId: string;
  referencesUnlocked: boolean;
  revision: number;
  manualTotalScore: number;
  firstSubmittedAt: string;
}

export interface ManualGradingAssigneeDto {
  username: string;
  displayName: string;
  status: "active" | "disabled";
}

export interface ManualGradingAssignmentSheetDto {
  sheetId: string;
  studentUsername: string;
  studentDisplayName: string | null;
  submittedAt: string | null;
  manualGradingStatus: "pending" | "completed";
  manualTotalScore: number | null;
  manualRevision: number;
  assignedGraderUsername: string | null;
  assignedGraderDisplayName: string | null;
  assignedGraderDisabled: boolean;
  assignmentLocked: boolean;
}

export interface ManualGradingAssignmentWorkspaceDto {
  paperId: string;
  paperTitle: string;
  assignees: ManualGradingAssigneeDto[];
  sheets: ManualGradingAssignmentSheetDto[];
  hasMore: boolean;
}

export interface ManualGradingAssignmentChangeInput {
  sheetId: string;
  graderUsername: string | null;
}

export interface ManualGradingAssignmentSaveResult {
  changedCount: number;
}

export interface ManualGradingTaskDto {
  sheetId: string;
  paperId: string;
  paperTitle: string;
  studentUsername: string;
  studentDisplayName: string | null;
  submittedAt: string | null;
  assignedAt: string;
  manualGradingStatus: "pending" | "completed";
  manualTotalScore: number | null;
  manualRevision: number;
}

export interface ManualGradingTasksDto {
  items: ManualGradingTaskDto[];
  hasMore: boolean;
}

// ---------- 子账号 · 考试 ----------

export interface MyExamItemDto {
  sheetId: string;
  paperTitle: string;
  paperDescription: string | null;
  status: string;
  questionCount: number;
  totalScore: number;
  passScore: number | null;
  durationMinutes: number | null;
  deadline: string | null;
  answerRevealPolicy: "onSubmit" | "manual";
  answersPublished: boolean;
  startedAt: string | null;
  submittedAt: string | null;
  myObjectiveScore: number | null;
  myTotalScore: number | null;
  endTime: string | null;
  /** 计时 v2:答题中且已暂停(计时冻结)。 */
  paused: boolean;
  /** 计时 v2:剩余实际答题秒数(不限时为 null)。 */
  remainingSeconds: number | null;
  serverNow: string;
}

export interface StartExamResult {
  sheetId: string;
  startedAt: string;
  endTime: string | null;
  serverNow: string;
}

export interface TakingQuestionDto {
  questionId: string;
  type: ExamQuestionType;
  stem: string;
  /** 题干配图(不含任何答案信息)。 */
  stemImages: ExamAnswerFile[] | null;
  options: ExamOptionDto[] | null;
  score: number;
  orderNo: number;
  /** 填空题空数(服务端按参考答案下发;其他题型 null)。 */
  blankCount: number | null;
  /** 大题共享案例与组内子题号；不含答案或解析。 */
  group: ExamQuestionGroupDto | null;
}

export interface TakingPaperDto {
  sheetId: string;
  paperTitle: string;
  totalScore: number;
  questions: TakingQuestionDto[];
  savedAnswers: Record<string, ExamAnswerValue>;
  startedAt: string;
  endTime: string | null;
  /** 计时 v2:考试截止时间(墙钟硬止点;与剩余答题时长同屏展示)。 */
  deadline: string | null;
  /** 计时 v2:是否已暂停(暂停中不能作答)。 */
  paused: boolean;
  /** 计时 v2:剩余实际答题秒数(不限时为 null;暂停期间冻结)。 */
  remainingSeconds: number | null;
  serverNow: string;
}

/** 计时 v2:暂停/恢复答题的结果。 */
export interface ExamPauseStateResult {
  sheetId: string;
  paused: boolean;
  remainingSeconds: number | null;
  endTime: string | null;
  deadline: string | null;
  serverNow: string;
}

export interface SubmitExamResult {
  sheetId: string;
  status: string;
  objectiveScore: number;
  totalScore: number | null;
  submittedAt: string;
}

export interface ReviewItemDto {
  questionId: string;
  type: ExamQuestionType;
  stem: string;
  stemImages: ExamAnswerFile[] | null;
  options: ExamOptionDto[] | null;
  myAnswer: ExamAnswerValue | null;
  correctAnswer: ExamAnswerValue | null;
  analysis: string;
  score: number;
  earnedScore: number | null;
  isCorrect: boolean | null;
  gradedBy: string | null;
  aiComment: string | null;
  manualScore: number | null;
  manualComment: string | null;
  orderNo: number;
  group: ExamQuestionGroupDto | null;
}

export interface ExamReviewDto {
  sheetId: string;
  paperTitle: string;
  status: string;
  paperTotalScore: number;
  passScore: number | null;
  myObjectiveScore: number | null;
  myTotalScore: number | null;
  myManualTotalScore: number | null;
  manualGradedAt: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
  durationSeconds: number | null;
  submitKind: string | null;
  items: ReviewItemDto[];
}

// ---------- unwrap ----------

function toError(response: ApiResponse<unknown>) {
  return new ExamApiError(
    response.message,
    response.error?.kind ?? "business-error",
    response.error?.retryable ?? false,
    response.error?.detail ?? null
  );
}

/** 动作/必有数据的查询:失败或无数据即抛(带 kind)。 */
export function unwrap<T>(response: ApiResponse<T>): T {
  if (!response.success || response.data === null) {
    throw toError(response);
  }
  return response.data;
}

/** 查询类:success:true + data:null 表示「不存在」,返回 null 走空态(规范 §3.1)。 */
export function unwrapNullable<T>(response: ApiResponse<T>): T | null {
  if (!response.success) {
    throw toError(response);
  }
  return response.data;
}

/** 无数据动作:只关心成败。 */
export function unwrapAction(response: ApiResponse<unknown>): void {
  if (!response.success) {
    throw toError(response);
  }
}

/** 统一取可读错误文案(axios 层错误 → 后端 message → Error.message)。 */
export function getExamErrorMessage(error: unknown) {
  const responseData = (error as { response?: { data?: { message?: string } } })
    ?.response?.data;
  if (responseData?.message) {
    return responseData.message;
  }
  return error instanceof Error ? error.message : "请求失败";
}

/** 取机器可判 kind(非 ExamApiError 时返回空串)。 */
export function getExamErrorKind(error: unknown): string {
  return error instanceof ExamApiError ? error.kind : "";
}

/**
 * answers-not-published 的 error.detail:聚合得分。披露口径=GET /my 已公开字段
 * + objectiveFullScore(题面构成,答题时本就可见);不含逐题信息与公布前不可见元数据。
 */
export interface ReviewWaitingScoreDto {
  status: string;
  myObjectiveScore: number | null;
  myTotalScore: number | null;
  paperTotalScore: number;
  /** 该卷客观题总分值(题面构成)——0 表示整卷没有客观题。 */
  objectiveFullScore: number;
  passScore: number | null;
  submittedAt: string | null;
}

/** 从 answers-not-published 错误中取聚合得分;形状不符(旧后端)返回 null 走原等待态。 */
export function parseReviewWaitingScore(
  error: unknown
): ReviewWaitingScoreDto | null {
  if (
    !(error instanceof ExamApiError) ||
    error.kind !== ExamErrorKinds.AnswersNotPublished
  ) {
    return null;
  }
  const detail = error.detail as Partial<ReviewWaitingScoreDto> | null;
  if (!detail || typeof detail !== "object") return null;
  if (typeof detail.paperTotalScore !== "number") return null;
  return {
    status: typeof detail.status === "string" ? detail.status : "",
    myObjectiveScore:
      typeof detail.myObjectiveScore === "number"
        ? detail.myObjectiveScore
        : null,
    myTotalScore:
      typeof detail.myTotalScore === "number" ? detail.myTotalScore : null,
    paperTotalScore: detail.paperTotalScore,
    objectiveFullScore:
      typeof detail.objectiveFullScore === "number"
        ? detail.objectiveFullScore
        : 0,
    passScore: typeof detail.passScore === "number" ? detail.passScore : null,
    submittedAt:
      typeof detail.submittedAt === "string" ? detail.submittedAt : null
  };
}

// ---------- 主账号端点 ----------

export async function getExamPapers(pageIndex = 1, pageSize = 20) {
  const response = await http.request<ApiResponse<ExamPaperListDto>>(
    "get",
    "/api/exam/papers",
    { params: { pageIndex, pageSize } }
  );
  return unwrap(response);
}

/** 成绩总览共用的团队试卷列表；不返回草稿。 */
export async function getExamResultPapers(pageIndex = 1, pageSize = 20) {
  const response = await http.request<ApiResponse<ExamPaperListDto>>(
    "get",
    "/api/exam/result-papers",
    { params: { pageIndex, pageSize } }
  );
  return unwrap(response);
}

export async function getExamPaperDetail(paperId: string) {
  const response = await http.request<ApiResponse<ExamPaperDetailDto>>(
    "get",
    `/api/exam/papers/${paperId}`
  );
  return unwrapNullable(response);
}

export async function createExamPaper(body: SavePaperMetaRequest) {
  const response = await http.request<ApiResponse<{ paperId: string }>>(
    "post",
    "/api/exam/papers",
    { data: body }
  );
  return unwrap(response);
}

/** 整卷导入的请求体:卷面信息 + 全部题目(后端 ImportPaperRequest)。 */
export interface ImportPaperRequest extends SavePaperMetaRequest {
  questions: ExamQuestionInput[];
}

/**
 * 整卷导入:一次 POST 落成一张草稿(题目、答案、解析一起进),等主账号复核后再发布。
 * 题目合不合规矩由后端逐题校验,错在第几题会写在 message 里。
 */
export async function importExamPaper(body: ImportPaperRequest) {
  const response = await http.request<ApiResponse<{ paperId: string }>>(
    "post",
    "/api/exam/papers/import",
    { data: body }
  );
  return unwrap(response);
}

export async function updateExamPaperMeta(
  paperId: string,
  body: SavePaperMetaRequest
) {
  const response = await http.request<ApiResponse<unknown>>(
    "put",
    `/api/exam/papers/${paperId}`,
    { data: body }
  );
  unwrapAction(response);
}

export async function saveExamQuestions(
  paperId: string,
  questions: ExamQuestionInput[]
) {
  const response = await http.request<ApiResponse<unknown>>(
    "put",
    `/api/exam/papers/${paperId}/questions`,
    { data: { questions } }
  );
  unwrapAction(response);
}

export interface PublishPaperResult {
  /** 发布时自动指派的子账号(默认全员参考,主账号可移除)。 */
  autoAssigned: string[];
}

export interface GradingGrantResult {
  sheetId: string;
  grantCode: string;
  expiresAt: string;
  expiresInSeconds: number;
}

export interface PublishPaperPayload {
  deadline?: string | null;
  usernames?: string[] | null;
}

/**
 * 发布试卷(计时 v2):usernames 缺省 = 全部启用子账号(兼容旧行为);
 * 显式给出时按名单指派(可含主账号本人)。deadline = 考试截止时间(墙钟硬止点)。
 */
export async function publishExamPaper(
  paperId: string,
  payload?: PublishPaperPayload
) {
  const response = await http.request<ApiResponse<PublishPaperResult>>(
    "post",
    `/api/exam/papers/${paperId}/publish`,
    {
      data: {
        deadline: payload?.deadline ?? null,
        usernames: payload?.usernames ?? null
      }
    }
  );
  return unwrap(response);
}

/**
 * 将归档卷复制为完全独立的草稿。点击动作只有这 1 个 POST;
 * 旧试卷、旧题目 ID 与旧答卷均不会被复用,复制后可进入出题工作台改题。
 */
export async function copyArchivedExamPaper(archivedPaperId: string) {
  const response = await http.request<ApiResponse<{ paperId: string }>>(
    "post",
    `/api/exam/papers/${archivedPaperId}/copy`
  );
  return unwrap(response);
}

export async function revertExamPaper(paperId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "post",
    `/api/exam/papers/${paperId}/revert`
  );
  unwrapAction(response);
}

export async function archiveExamPaper(paperId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "post",
    `/api/exam/papers/${paperId}/archive`
  );
  unwrapAction(response);
}

export async function deleteExamPaper(paperId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "delete",
    `/api/exam/papers/${paperId}`
  );
  unwrapAction(response);
}

export async function publishExamAnswers(paperId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "post",
    `/api/exam/papers/${paperId}/publish-answers`
  );
  unwrapAction(response);
}

export async function assignExamSheets(
  paperId: string,
  usernames: string[],
  deadline?: string | null
) {
  const response = await http.request<ApiResponse<AssignSheetsResult>>(
    "post",
    `/api/exam/papers/${paperId}/assignments`,
    { data: { usernames, deadline: deadline ?? null } }
  );
  return unwrap(response);
}

export async function revokeExamAssignment(sheetId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "delete",
    `/api/exam/sheets/${encodeURIComponent(sheetId)}/assignment`
  );
  unwrapAction(response);
}

export async function getExamResults(paperId: string) {
  const response = await http.request<ApiResponse<ExamPaperResultsDto>>(
    "get",
    `/api/exam/papers/${paperId}/results`
  );
  return unwrapNullable(response);
}

export async function getExamSheetDetail(sheetId: string) {
  const response = await http.request<ApiResponse<ExamSheetDetailDto>>(
    "get",
    `/api/exam/sheets/${sheetId}`
  );
  return unwrapNullable(response);
}

/** 主账号阅卷安排台：进入/切卷固定 1 个聚合 GET。 */
export async function getManualGradingAssignments(paperId: string) {
  const response = await http.request<
    ApiResponse<ManualGradingAssignmentWorkspaceDto>
  >(
    "get",
    `/api/exam/manual-grading/assignments/papers/${encodeURIComponent(paperId)}`
  );
  return unwrapNullable(response);
}

/** 一次保存本轮全部脏行；不做逐答卷请求。 */
export async function saveManualGradingAssignments(
  paperId: string,
  items: ManualGradingAssignmentChangeInput[]
) {
  const response = await http.request<
    ApiResponse<ManualGradingAssignmentSaveResult>
  >(
    "put",
    `/api/exam/manual-grading/assignments/papers/${encodeURIComponent(paperId)}`,
    { data: { items } }
  );
  return unwrap(response);
}

/** 子账号任务箱：固定 1 个聚合 GET。 */
export async function getMyManualGradingTasks() {
  const response = await http.request<ApiResponse<ManualGradingTasksDto>>(
    "get",
    "/api/exam/manual-grading/my-tasks"
  );
  return unwrap(response);
}

/**
 * 人工阅卷工作台：固定 1 次聚合 GET。首次提交前响应类型物理不含答案/解析/AI 结论。
 */
export async function getManualGradingWorkspace(sheetId: string) {
  const response = await http.request<ApiResponse<ManualGradingWorkspaceDto>>(
    "get",
    `/api/exam/manual-grading/sheets/${encodeURIComponent(sheetId)}`
  );
  return unwrapNullable(response);
}

/** 仅首次整卷人工提交成功后调用；服务端会再次校验解锁资格。 */
export async function getManualGradingReferences(sheetId: string) {
  const response = await http.request<ApiResponse<ManualGradingReferencesDto>>(
    "get",
    `/api/exam/manual-grading/sheets/${encodeURIComponent(sheetId)}/references`
  );
  return unwrap(response);
}

export async function submitManualGrading(
  sheetId: string,
  expectedRevision: number,
  items: ManualGradingInput[]
) {
  const response = await http.request<ApiResponse<ManualGradingSubmitResult>>(
    "put",
    `/api/exam/manual-grading/sheets/${encodeURIComponent(sheetId)}`,
    { data: { expectedRevision, items } }
  );
  return unwrap(response);
}

/**
 * 消费者:ExamGradingHandoff；仅在用户点击“生成并复制授权提示词”时触发。
 * 调用公式=每次显式点击 1 POST，页面进入 0；上层按单飞合并并发点击。
 * 响应仅含 sheetId、临时授权码和过期时间，硬预算 <8 KiB。
 */
export async function createExamGradingGrant(sheetId: string) {
  const response = await http.request<ApiResponse<GradingGrantResult>>(
    "post",
    "/api/exam/grading/grants",
    { data: { sheetId } }
  );
  return unwrap(response);
}

export async function forceSubmitExamSheet(sheetId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "post",
    `/api/exam/sheets/${sheetId}/force-submit`
  );
  unwrapAction(response);
}

/**
 * 主账号恢复缺考或超时答卷。
 * 缺考回到待考；超时保留已保存作答、作废旧判分并回到暂停态。
 * 点击动作固定 1 次 POST，不跟随刷新成绩列表。
 */
export async function reopenTimedOutExamSheet(sheetId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "post",
    `/api/exam/sheets/${sheetId}/reopen`
  );
  unwrapAction(response);
}

// ---------- 子账号端点 ----------

export async function getMyExams() {
  const response = await http.request<ApiResponse<{ items: MyExamItemDto[] }>>(
    "get",
    "/api/exam/my"
  );
  return unwrap(response);
}

export async function startExam(sheetId: string) {
  const response = await http.request<ApiResponse<StartExamResult>>(
    "post",
    `/api/exam/sheets/${sheetId}/start`
  );
  return unwrap(response);
}

export async function getTakingPaper(sheetId: string) {
  const response = await http.request<ApiResponse<TakingPaperDto>>(
    "get",
    `/api/exam/sheets/${sheetId}/paper`
  );
  return unwrap(response);
}

/** 题干配图上传(owner,仅草稿卷;png/jpg/webp ≤10MB)。触发=出题时逐张选择,每张 1 次请求。 */
export async function uploadExamStemImage(paperId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await http.request<ApiResponse<ExamAnswerFile>>(
    "post",
    `/api/exam/papers/${paperId}/uploads`,
    { data: form, headers: { "Content-Type": "multipart/form-data" } }
  );
  return unwrap(response);
}

/** 实操题答案图片上传(仅答题中;png/jpg/webp ≤10MB)。触发=用户逐张选择,每张 1 次请求。 */
export async function uploadExamAnswerImage(sheetId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await http.request<ApiResponse<ExamAnswerFile>>(
    "post",
    `/api/exam/sheets/${sheetId}/uploads`,
    { data: form, headers: { "Content-Type": "multipart/form-data" } }
  );
  return unwrap(response);
}

/** 计时 v2:暂停答题(冻结计时;服务端同时冻结作答)。触发=答题页点「暂停」,1 次请求。 */
export async function pauseExam(sheetId: string) {
  const response = await http.request<ApiResponse<ExamPauseStateResult>>(
    "post",
    `/api/exam/sheets/${sheetId}/pause`
  );
  return unwrap(response);
}

/** 计时 v2:恢复答题(计时重新起表)。触发=暂停页点「继续答题」,1 次请求。 */
export async function resumeExam(sheetId: string) {
  const response = await http.request<ApiResponse<ExamPauseStateResult>>(
    "post",
    `/api/exam/sheets/${sheetId}/resume`
  );
  return unwrap(response);
}

export async function saveExamAnswers(
  sheetId: string,
  answers: Record<string, ExamAnswerValue>
) {
  const response = await http.request<ApiResponse<unknown>>(
    "put",
    `/api/exam/sheets/${sheetId}/answers`,
    { data: { answers } }
  );
  unwrapAction(response);
}

export async function submitExam(
  sheetId: string,
  answers?: Record<string, ExamAnswerValue>
) {
  const response = await http.request<ApiResponse<SubmitExamResult>>(
    "post",
    `/api/exam/sheets/${sheetId}/submit`,
    { data: { answers: answers ?? null } }
  );
  return unwrap(response);
}

export async function getExamReview(sheetId: string) {
  const response = await http.request<ApiResponse<ExamReviewDto>>(
    "get",
    `/api/exam/sheets/${sheetId}/review`
  );
  return unwrap(response);
}

// ---------- 展示辅助(纯函数) ----------

export const ExamTypeLabels: Record<ExamQuestionType, string> = {
  single: "单选",
  multiple: "多选",
  judge: "判断",
  fillBlank: "填空",
  essay: "简答",
  practical: "实操"
};

/** 把作答对象转成可读文本(复盘/详情展示用)。 */
export function formatAnswerText(
  type: ExamQuestionType,
  value: ExamAnswerValue | null
): string {
  if (!value) return "未作答";
  switch (type) {
    case "single":
      return typeof value.answer === "string" && value.answer
        ? value.answer
        : "未作答";
    case "multiple":
      return value.answers?.length
        ? [...value.answers].sort().join("、")
        : "未作答";
    case "judge":
      return typeof value.answer === "boolean"
        ? value.answer
          ? "对"
          : "错"
        : "未作答";
    case "fillBlank":
      return value.answers?.some(item => item?.trim())
        ? value.answers.map(item => item?.trim() || "(空)").join(" / ")
        : "未作答";
    case "essay":
      return value.text?.trim() || value.reference?.trim() || "未作答";
    case "practical": {
      const parts: string[] = [];
      if (value.files?.length) {
        parts.push(`已上传 ${value.files.length} 张图片`);
      }
      if (value.text?.trim()) {
        const text = value.text.trim();
        parts.push(text.length > 60 ? `${text.slice(0, 60)}…` : text);
      }
      if (parts.length) return parts.join(" · ");
      return value.reference?.trim() || "未作答";
    }
  }
}

/**
 * 可一键复制的考生原文(阅卷/复盘用:简答与实操写的提示词要能整段拿去生图)。
 * 与 formatAnswerText 分开:那份是给人读的摘要(会截断、加「已上传 N 张图片」),
 * 这份是正文原样(只去掉首尾空白),中间一个字都不能少、不能截断。
 * 只认简答与实操:选择/判断复制一个「A」没有意义,填空是几个词、肉眼抄得过来,
 * 给它们也挂按钮只会让长卷子每张卡片都多出一颗按钮。返回空串 = 按钮不出现。
 */
export function answerCopyText(
  type: ExamQuestionType,
  value: ExamAnswerValue | null | undefined
): string {
  if (!value) return "";
  if (type !== "essay" && type !== "practical") return "";
  return value.text?.trim() ?? "";
}
