import { defineStore } from "pinia";
import { store, storageLocal } from "../utils";
import type { ExamAnswerValue } from "@/api/exam";

/**
 * 答题现场本地快照(CLAUDE.md 页面状态持久化铁律;范式=screenplayDraft 的 patch 单出口)。
 * 桶键 = `${username}|${sheetId}`(用户隔离);内容 = 作答 + 标记 + 时间戳。
 * 恢复语义:服务器为准,但「本地有落库时间戳之后的改动」(updatedAt > lastSyncedAt)
 * 说明防抖窗口内的按键还没推上去,这部分以本地为准并立即回推——防刷新丢最后几秒作答。
 */
const STORAGE_KEY = "newVideo8.examTaking.v1";
/** 只保留最近 N 场考试的现场,防 localStorage 膨胀。 */
const MAX_BUCKETS = 20;

export interface ExamTakingSnapshot {
  answers: Record<string, ExamAnswerValue>;
  flagged: string[];
  /** 本地最后一次改动时间(ms)。 */
  updatedAt: number;
  /** 最后一次服务器保存成功时间(ms);0=从未同步。 */
  lastSyncedAt: number;
}

type SnapshotMap = Record<string, ExamTakingSnapshot>;

function emptySnapshot(): ExamTakingSnapshot {
  return { answers: {}, flagged: [], updatedAt: 0, lastSyncedAt: 0 };
}

function normalize(raw: unknown): ExamTakingSnapshot {
  const value = (raw ?? {}) as Partial<ExamTakingSnapshot>;
  return {
    answers:
      value.answers && typeof value.answers === "object" ? value.answers : {},
    flagged: Array.isArray(value.flagged) ? value.flagged : [],
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
    lastSyncedAt:
      typeof value.lastSyncedAt === "number" ? value.lastSyncedAt : 0
  };
}

function restore(): SnapshotMap {
  const raw = storageLocal().getItem<SnapshotMap>(STORAGE_KEY);
  if (!raw || typeof raw !== "object") return {};
  const result: SnapshotMap = {};
  for (const [key, value] of Object.entries(raw)) {
    result[key] = normalize(value);
  }
  return result;
}

export function examTakingBucketKey(username: string, sheetId: string) {
  return `${username || "anonymous"}|${sheetId}`;
}

export const useExamTakingStore = defineStore("newvideo-exam-taking", {
  state: () => ({ snapshots: restore() as SnapshotMap }),
  actions: {
    get(bucketKey: string): ExamTakingSnapshot {
      return this.snapshots[bucketKey] ?? emptySnapshot();
    },
    /** 唯一写出口:所有改动经此落盘(patch 单出口范式)。 */
    patch(bucketKey: string, mutate: (snapshot: ExamTakingSnapshot) => void) {
      const current = this.snapshots[bucketKey] ?? emptySnapshot();
      const next: ExamTakingSnapshot = {
        answers: { ...current.answers },
        flagged: [...current.flagged],
        updatedAt: current.updatedAt,
        lastSyncedAt: current.lastSyncedAt
      };
      mutate(next);
      this.snapshots = { ...this.snapshots, [bucketKey]: next };
      this.prune();
      this.persist();
    },
    /** 交卷成功后清场。 */
    clear(bucketKey: string) {
      if (!(bucketKey in this.snapshots)) return;
      const next = { ...this.snapshots };
      delete next[bucketKey];
      this.snapshots = next;
      this.persist();
    },
    prune() {
      const keys = Object.keys(this.snapshots);
      if (keys.length <= MAX_BUCKETS) return;
      const sorted = keys.sort(
        (a, b) => this.snapshots[b].updatedAt - this.snapshots[a].updatedAt
      );
      const next: SnapshotMap = {};
      for (const key of sorted.slice(0, MAX_BUCKETS)) {
        next[key] = this.snapshots[key];
      }
      this.snapshots = next;
    },
    persist() {
      storageLocal().setItem(STORAGE_KEY, this.snapshots);
    }
  }
});

export function useExamTakingStoreHook() {
  return useExamTakingStore(store);
}
