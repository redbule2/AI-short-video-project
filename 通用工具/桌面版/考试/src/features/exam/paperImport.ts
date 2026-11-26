import type { ImportPaperRequest } from "@/api/exam";

/**
 * 「导入试卷」读文件(纯函数;桌面版 2026-11-26 加,旧网站没有)。
 *
 * 一份文件 = 一张卷,内容就是后端整卷导入要的 JSON:
 *   { title, description?, durationMinutes?, passScore?, answerRevealPolicy?, questions: [...] }
 * 这里只挡「根本不是试卷文件」的(不是 JSON、没卷名、没题目),好让人一眼看出选错了文件;
 * 每道题合不合规矩(题型、答案形状、分值、解析)只由后端判——规矩只写一处,别在前端再抄一遍。
 */
export type PaperFileResult =
  | { ok: true; paper: ImportPaperRequest }
  | { ok: false; reason: string };

export function readPaperFile(text: string): PaperFileResult {
  let data: unknown;
  try {
    // 记事本另存的 UTF-8 文件开头会带一个看不见的 BOM,JSON.parse 不认
    data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, reason: "不是试卷文件(读不成 JSON)" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, reason: "不是试卷文件(里面不是一张卷)" };
  }
  const paper = data as Partial<ImportPaperRequest>;
  if (typeof paper.title !== "string" || !paper.title.trim()) {
    return { ok: false, reason: "没写卷名(title)" };
  }
  if (!Array.isArray(paper.questions) || paper.questions.length === 0) {
    return { ok: false, reason: "里面一道题都没有(questions)" };
  }
  return { ok: true, paper: paper as ImportPaperRequest };
}

/** 导入完说给人听的话:成了几张、哪几份没成(一份一行,带原因)。 */
export function importSummary(done: string[], failed: string[]) {
  const lines: string[] = [];
  if (done.length > 0) {
    lines.push(`导入了 ${done.length} 张,都是草稿——复核后再点「发布」。`);
  }
  if (failed.length > 0) {
    lines.push(`这 ${failed.length} 份没导进来:`, ...failed);
  }
  return lines;
}
