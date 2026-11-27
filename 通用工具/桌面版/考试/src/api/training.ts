// 这里新写的（旧网站没有）：考试「培训」的接口——一次培训 = 名字 + 几张试卷 + 一批参加的人，按各卷得分之和排名。
// 后台在 new-video8-8 的 ExamTrainingController（2026-11-27 加的）；团队由后台按登录的人认，这里不传团队。
// 回话怎么拆、出错带什么 kind，和考试别的接口共用一套（@/api/exam 的 unwrap 那三个）。
import { http } from "@/utils/http";
import {
  type ApiResponse,
  unwrap,
  unwrapAction,
  unwrapNullable
} from "./exam";

export const TrainingErrorKinds = {
  TrainingNotFound: "training-not-found",
  PaperTaken: "training-paper-taken",
  DeadlinePassed: "training-deadline-passed",
  /** 这期培训在别处刚改过：手上这份底稿旧了，要刷新后再改 */
  Stale: "training-stale"
} as const;

/**
 * 一个人在一张卷上的格子：
 * graded 有分；pending 已交卷还没判完（先记客观分）；taking 答题中；notStarted 没考；absent 缺考；
 * unassigned 这张卷没发给他；notSubmitted 普通成员看别人时，没交卷的统称。
 */
export type TrainingCellState =
  | "graded"
  | "pending"
  | "taking"
  | "notStarted"
  | "absent"
  | "unassigned"
  | "notSubmitted";

/** manual 人工阅卷分；auto 系统 / AI 判分 */
export type TrainingScoreSource = "manual" | "auto";

/**
 * published 草稿卷顺手发布了；assigned 补发了；unchanged 大家都有了；skipped 已归档不发；failed 没发出去；
 * held 原来就在培训里的草稿卷，这次没让发布（防改题改到一半被发出去）
 */
export type TrainingOutcome =
  | "published"
  | "assigned"
  | "unchanged"
  | "skipped"
  | "failed"
  | "held";

export interface TrainingSummaryDto {
  trainingId: string;
  name: string;
  description: string | null;
  deadline: string | null;
  paperCount: number;
  memberCount: number;
  createdAt: string;
  updatedAt: string | null;
}

export interface TrainingListDto {
  /** 能不能新建、修改、删除：只有团队负责人能 */
  canManage: boolean;
  items: TrainingSummaryDto[];
}

export interface TrainingPaperDto {
  paperId: string;
  title: string;
  /** 草稿 / 已发布 / 已归档 */
  status: string;
  /** 卷面总分；没发布的草稿卷是 0 */
  totalScore: number;
  passScore: number | null;
  /** 答案公布了没有：普通成员公布后才能点开别人的答卷 */
  answersPublished: boolean;
}

/** 一个人在一张卷上的格子。不带试卷编号：格子和 papers 一样的顺序、一样多，按位置对。 */
export interface TrainingCellDto {
  /** 交了卷的才有，用来点开看答卷 */
  sheetId: string | null;
  state: TrainingCellState;
  /** 计入总分的分；没有分是 null（按 0 算） */
  score: number | null;
  scoreSource: TrainingScoreSource | null;
}

export interface TrainingRowDto {
  /** 同分并列，下一名跳过并列的人数（1、1、3） */
  rank: number;
  username: string;
  displayName: string;
  /** 已经被移出团队，成绩还留着 */
  removed: boolean;
  isMe: boolean;
  total: number;
  /** 交了几张卷（含待判） */
  submittedCount: number;
  /** 交了卷还没判完的张数 */
  pendingCount: number;
  /** 和 papers 一样的顺序、一样多 */
  cells: TrainingCellDto[];
}

export interface TrainingRankingDto {
  trainingId: string;
  name: string;
  description: string | null;
  deadline: string | null;
  canManage: boolean;
  /** 修订版本：修改时原样带回去，后台对不上就拒（防两处同时改互相冲掉） */
  revision: number;
  /** 各卷卷面总分加起来（没发布的草稿卷不算） */
  fullScore: number;
  papers: TrainingPaperDto[];
  rows: TrainingRowDto[];
  serverNow: string;
}

export interface TrainingPaperOptionDto {
  paperId: string;
  title: string;
  status: string;
  questionCount: number;
  totalScore: number;
  /** 已经在哪个培训里；不在任何培训里是 null */
  trainingId: string | null;
  trainingName: string | null;
}

export interface TrainingPaperOptionsDto {
  items: TrainingPaperOptionDto[];
  /** 试卷太多时只给最近的那一批 */
  truncated: boolean;
}

export interface SaveTrainingRequest {
  name: string;
  description: string | null;
  /** 这次新发出去的卷用的截止时间；已经发出去的不变 */
  deadline: string | null;
  /** 培训里的试卷，按先后顺序 */
  paperIds: string[];
  /** 参加的人（登录账号） */
  usernames: string[];
  /** 修改时必带：打开小窗那一刻读到的修订版本；新建不带 */
  expectedRevision?: number | null;
  /** 原来就在培训里、还是草稿的卷，这次要不要一起发布（默认不发；这次新加的草稿卷一律发布） */
  publishExistingDrafts?: boolean;
}

export interface TrainingPaperOutcomeDto {
  paperId: string;
  title: string;
  outcome: TrainingOutcome;
  /** 这次新发出去几份 */
  createdCount: number;
  message: string | null;
}

export interface SaveTrainingResult {
  trainingId: string;
  /** 被去掉的人，收回了几份还没开考的卷 */
  revokedCount: number;
  papers: TrainingPaperOutcomeDto[];
}

const TRAININGS = "/api/exam/trainings";

export async function getTrainings() {
  const response = await http.request<ApiResponse<TrainingListDto>>(
    "get",
    TRAININGS
  );
  return unwrap(response);
}

/** 培训被删了回 null */
export async function getTrainingRanking(trainingId: string) {
  const response = await http.request<ApiResponse<TrainingRankingDto>>(
    "get",
    `${TRAININGS}/${encodeURIComponent(trainingId)}/ranking`
  );
  return unwrapNullable(response);
}

export async function getTrainingPaperOptions() {
  const response = await http.request<ApiResponse<TrainingPaperOptionsDto>>(
    "get",
    `${TRAININGS}/paper-options`
  );
  return unwrap(response);
}

export async function createTraining(data: SaveTrainingRequest) {
  const response = await http.request<ApiResponse<SaveTrainingResult>>(
    "post",
    TRAININGS,
    { data }
  );
  return unwrap(response);
}

export async function updateTraining(
  trainingId: string,
  data: SaveTrainingRequest
) {
  const response = await http.request<ApiResponse<SaveTrainingResult>>(
    "put",
    `${TRAININGS}/${encodeURIComponent(trainingId)}`,
    { data }
  );
  return unwrap(response);
}

export async function deleteTraining(trainingId: string) {
  const response = await http.request<ApiResponse<unknown>>(
    "delete",
    `${TRAININGS}/${encodeURIComponent(trainingId)}`
  );
  unwrapAction(response);
}
