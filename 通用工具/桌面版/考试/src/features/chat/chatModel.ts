// 壳子自己的（不是照搬的）：「消息」里不碰服务器、不碰页面的那些算法（2026-11-26）：
// 新消息并进列表、会话列表跟着变、时间怎么写、预览怎么写、发图前缩多大、缩略图多大。
import type { ChatConversation, ChatMessage } from "@/api/chat";

/** 列表里的一条：服务器回过的，或者自己刚发、还在路上的（state） */
export interface ChatItem extends ChatMessage {
  /** sending 正在发；failed 没发出去（能重发） */
  state?: "sending" | "failed";
  /** 没发出去时服务器说的话 */
  error?: string;
  /** 自己刚发的图：先用本机这一份摆出来 */
  localUrl?: string;
  /** 重发时要再传一遍的那张图 */
  file?: File;
}

export const UNREAD_CAP = 100; // 后台最多数到 100（TeamChatRules.UnreadCountCap）
export const TEXT_MAX = 4000; // 一条字最多这么长（后台 TeamChatRules.MaxTextLength）
export const PAGE_SIZE = 50; // 一回拿多少条（后台默认 50）
export const GAP_MINUTES = 5; // 两条隔了这么久，中间夹一行时间

export const sameUser = (a?: string | null, b?: string | null) =>
  (a || "").toLowerCase() === (b || "").toLowerCase();

// ---- 时间：服务器记的是北京时间、不带时区（"2026-11-26T15:30:00"）。
// 照字面读；「今天」「昨天」也按北京时间算，不管这台电脑设的哪个时区（团队都在国内，看到的要和别人一样）。
const BEIJING = 8 * 3600e3;

export interface WallTime {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
}

export function readTime(text: string | null | undefined): WallTime | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text || "");
  return m ? { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5] } : null;
}

export function beijingNow(now = Date.now()): WallTime {
  const t = new Date(now + BEIJING);
  return {
    y: t.getUTCFullYear(),
    mo: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    h: t.getUTCHours(),
    mi: t.getUTCMinutes()
  };
}

const minuteNo = (t: WallTime) => Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi) / 60e3;
const dayNo = (t: WallTime) => Math.floor(Date.UTC(t.y, t.mo - 1, t.d) / 864e5);
const two = (n: number) => String(n).padStart(2, "0");

/** 消息中间那一行时间：今天只写几点；昨天写「昨天 几点」；今年写「月-日 几点」；更早带上年 */
export function formatTime(sentAt: string, now = beijingNow()) {
  const t = readTime(sentAt);
  if (!t) return "";
  const hm = `${two(t.h)}:${two(t.mi)}`;
  const gap = dayNo(now) - dayNo(t);
  if (gap <= 0) return hm;
  if (gap === 1) return `昨天 ${hm}`;
  if (t.y === now.y) return `${two(t.mo)}-${two(t.d)} ${hm}`;
  return `${t.y}-${two(t.mo)}-${two(t.d)} ${hm}`;
}

/** 会话列表右边那个短的：今天写几点，昨天写「昨天」，今年写「月-日」，更早写年月日 */
export function formatShortTime(sentAt: string, now = beijingNow()) {
  const t = readTime(sentAt);
  if (!t) return "";
  const gap = dayNo(now) - dayNo(t);
  if (gap <= 0) return `${two(t.h)}:${two(t.mi)}`;
  if (gap === 1) return "昨天";
  if (t.y === now.y) return `${two(t.mo)}-${two(t.d)}`;
  return `${t.y}-${two(t.mo)}-${two(t.d)}`;
}

/** 这一条上面要不要夹一行时间：第一条要；和上一条隔了 5 分钟以上要 */
export function needsTimeLine(previous: ChatMessage | undefined, current: ChatMessage) {
  if (!previous) return true;
  const a = readTime(previous.sentAt);
  const b = readTime(current.sentAt);
  return !a || !b || minuteNo(b) - minuteNo(a) >= GAP_MINUTES;
}

/** 这一条是不是新起一段：同一个人接着说（中间没夹时间）的后几条不再摆头像和名字，挨得近一点（2026-11-26） */
export function startsGroup(previous: ChatMessage | undefined, current: ChatMessage) {
  return !previous || needsTimeLine(previous, current) || !sameUser(previous.sender, current.sender);
}

// ---- 字

/** 预览：图片写「[图片]」，字的把换行换成空格，太长截断 */
export function previewOf(message: ChatMessage | null | undefined, max = 40) {
  if (!message) return "";
  if (message.kind === "image") return "[图片]";
  const text = (message.text || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 发之前的字：换行统一、去掉看不见的控制字符、去掉头尾空白（和后台 NormalizeText 一样） */
export function cleanText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim();
}

/** 没看的条数怎么写：过了 99 写 99+ */
export const badgeText = (count: number) => (count > 99 ? "99+" : String(count));

/** 页面自己起的消息编号：后台只认字母、数字、- 和 _，最长 64 */
export function newClientId() {
  const c = globalThis.crypto;
  const raw =
    c && "randomUUID" in c
      ? c.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `c-${raw}`.slice(0, 64);
}

// ---- 列表

/** 新消息并进一个会话的消息列表：按顺序号排、同一条不重复；
 *  自己刚发的（还在路上、没发出去的）按页面起的编号认出来，换成服务器回的那条。 */
export function mergeMessages(list: ChatItem[], incoming: ChatMessage[]): ChatItem[] {
  if (!incoming.length) return list;
  const done = new Map<string, ChatItem>();
  for (const item of list) if (!item.state) done.set(item.id, item);
  for (const item of incoming) done.set(item.id, item);
  const sorted = [...done.values()].sort((a, b) => a.seq - b.seq);
  const arrived = new Set(sorted.map(item => item.clientId).filter(Boolean));
  return [...sorted, ...list.filter(item => item.state && !arrived.has(item.clientId))];
}

/** 一条新消息到了，会话列表里这一项跟着变：最后一条、顺序号；
 *  别人发的、我又没正看着的，没看的条数加一。首页里已经算进去的（顺序号不比它新）不再算。 */
export function applyMessage(
  conversation: ChatConversation,
  message: ChatMessage,
  me: string,
  watching: boolean
): ChatConversation {
  if (message.seq <= conversation.lastSeq) return conversation;
  const counts = !watching && !sameUser(message.sender, me) && message.seq > conversation.readSeq;
  return {
    ...conversation,
    lastSeq: message.seq,
    lastMessage: message,
    unread: counts ? Math.min(UNREAD_CAP, conversation.unread + 1) : conversation.unread
  };
}

/** 会话排序：全员群在最前，别的按最后一条新到旧（和后台一样） */
export function sortConversations(list: ChatConversation[]) {
  return [...list].sort(
    (a, b) => Number(b.kind === "team") - Number(a.kind === "team") || b.lastSeq - a.lastSeq
  );
}

/** 左边一行：全员群、私聊，或者团队里还没说过话的一个人（点了才开私聊） */
export interface ChatRow {
  key: string;
  /** 私聊那头是谁；全员群是空的 */
  username: string;
  /** 还没开过私聊的人是 null */
  conversation: ChatConversation | null;
}

/** 算不算说过话：全员群总算；私聊要有过消息。左边那一列照它分成「最近聊天」和「其他成员」两段 */
export const hasTalked = (item: ChatConversation) =>
  item.kind === "team" || item.lastSeq > 0 || !!item.lastMessage;

/** 左边的搜索：去掉空白、不分大小写，几样字（名字、账号、职位……）里有一样含着要找的就算找到；没写字的全算 */
export function matchesQuery(query: string, fields: (string | null | undefined)[]) {
  const squeeze = (text: string | null | undefined) => String(text ?? "").replace(/\s+/g, "").toLowerCase();
  const wanted = squeeze(query);
  return !wanted || fields.some(field => squeeze(field).includes(wanted));
}

/** 左边那一列：全员群在最前，说过话的私聊最近的在前，再是还没说过话的人（照团队名单的顺序）。
 *  people 是能开私聊的人（没停用、不是自己）；停用了的只在说过话时留着，好翻记录。 */
export function chatRows(conversations: ChatConversation[], people: { username: string }[]): ChatRow[] {
  const talked = sortConversations(conversations).filter(hasTalked);
  const directOf = (username: string) =>
    conversations.find(item => item.kind === "direct" && sameUser(item.peerUsername, username)) ?? null;
  const talkedWith = (username: string) =>
    talked.some(item => item.kind === "direct" && sameUser(item.peerUsername, username));
  return [
    ...talked.map(item => ({ key: item.id, username: item.peerUsername ?? "", conversation: item })),
    ...people
      .filter(person => !talkedWith(person.username))
      .map(person => ({ key: `u:${person.username}`, username: person.username, conversation: directOf(person.username) }))
  ];
}

/** 这个会话里有没有别人发来、还没标已读的（标已读看这个，不看条数：正看着时来的不算条数，可也得标） */
export function hasUnseen(conversation: ChatConversation, items: ChatItem[], me: string) {
  return (
    conversation.unread > 0 ||
    items.some(
      item => !item.state && item.seq > conversation.readSeq && !sameUser(item.sender, me)
    )
  );
}

// ---- 图片

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 后台只收 10MB 以内
export const IMAGE_MAX_SIDE = 1600; // 发之前长边缩到这么大
export const IMAGE_KEEP_BYTES = 1024 * 1024; // 1MB 以内、长边也不超的原样发
export const THUMB_SIDE = 240; // 聊天里摆的小图最大这么大

/** 等比缩到长边不超过 max */
export function fitSide(width: number, height: number, max = IMAGE_MAX_SIDE) {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const k = max / long;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k))
  };
}

/** 发之前要不要缩：动图不缩（缩了就不动了）；大于 1MB 或长边超了的缩 */
export function needsShrink(type: string, bytes: number, width: number, height: number) {
  if (type === "image/gif") return false;
  return bytes > IMAGE_KEEP_BYTES || Math.max(width, height) > IMAGE_MAX_SIDE;
}

/** 聊天里小图摆多大：长边不超过 240，太细长的也留够点的地方；不知道大小的摆个方的 */
export function thumbSize(width?: number | null, height?: number | null) {
  if (!width || !height) return { width: 180, height: 180 };
  const fit = fitSide(width, height, THUMB_SIDE);
  return { width: Math.max(48, fit.width), height: Math.max(48, fit.height) };
}
