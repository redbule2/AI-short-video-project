// 壳子自己的（不是照搬的）：「消息」里那些算法的测试（2026-11-26）。
import { describe, expect, it } from "vitest";
import type { ChatConversation, ChatMessage } from "@/api/chat";
import {
  UNREAD_CAP,
  applyMessage,
  badgeText,
  beijingNow,
  cleanText,
  fitSide,
  formatShortTime,
  formatTime,
  hasTalked,
  hasUnseen,
  matchesQuery,
  mergeMessages,
  needsShrink,
  needsTimeLine,
  newClientId,
  previewOf,
  readTime,
  sortConversations,
  startsGroup,
  thumbSize,
  type ChatItem
} from "./chatModel";

const msg = (seq: number, sender = "wang", extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${seq}`,
  seq,
  conversationId: "team_1",
  sender,
  kind: "text",
  text: `第${seq}条`,
  image: null,
  clientId: null,
  sentAt: "2026-11-26T10:00:00",
  ...extra
});
const conv = (extra: Partial<ChatConversation> = {}): ChatConversation => ({
  id: "team_1",
  kind: "team",
  peerUsername: null,
  lastSeq: 5,
  lastMessage: null,
  readSeq: 5,
  unread: 0,
  ...extra
});
const NOW = readTime("2026-11-26T15:30:00")!;

describe("时间", () => {
  it("服务器的时间照字面读，按北京时间算今天、昨天，不管这台电脑在哪个时区", () => {
    expect(beijingNow(Date.UTC(2026, 10, 25, 22, 1))).toEqual({ y: 2026, mo: 11, d: 26, h: 6, mi: 1 });
    expect(formatTime("2026-11-26T09:05:00", NOW)).toBe("09:05");
    expect(formatTime("2026-11-25T23:59:59", NOW)).toBe("昨天 23:59");
    expect(formatTime("2026-03-01T08:00:00", NOW)).toBe("03-01 08:00");
    expect(formatTime("2025-12-31T08:00:00", NOW)).toBe("2025-12-31 08:00");
    expect(formatTime("2026-11-26T16:00:00", NOW)).toBe("16:00"); // 服务器比这边快一点：也算今天
    expect(formatTime("不是时间", NOW)).toBe("");
    expect(formatShortTime("2026-11-26T09:05:00", NOW)).toBe("09:05");
    expect(formatShortTime("2026-11-25T09:05:00", NOW)).toBe("昨天");
    expect(formatShortTime("2026-01-02T09:05:00", NOW)).toBe("01-02");
    expect(formatShortTime("2024-01-02T09:05:00", NOW)).toBe("2024-01-02");
  });

  it("两条隔了 5 分钟以上，中间夹一行时间；第一条上面也夹", () => {
    expect(needsTimeLine(undefined, msg(1))).toBe(true);
    expect(needsTimeLine(msg(1, "a", { sentAt: "2026-11-26T10:00:00" }), msg(2, "a", { sentAt: "2026-11-26T10:04:59" }))).toBe(false);
    expect(needsTimeLine(msg(1, "a", { sentAt: "2026-11-26T10:00:00" }), msg(2, "a", { sentAt: "2026-11-26T10:05:00" }))).toBe(true);
    expect(needsTimeLine(msg(1, "a", { sentAt: "2026-11-25T23:58:00" }), msg(2, "a", { sentAt: "2026-11-26T00:04:00" }))).toBe(true);
  });

  it("同一个人接着说（中间没夹时间）：后几条不新起一段；换了人、隔了 5 分钟、第一条都新起", () => {
    expect(startsGroup(undefined, msg(1))).toBe(true);
    expect(startsGroup(msg(1, "a", { sentAt: "2026-11-26T10:00:00" }), msg(2, "A", { sentAt: "2026-11-26T10:03:00" }))).toBe(false);
    expect(startsGroup(msg(1, "a"), msg(2, "b"))).toBe(true);
    expect(startsGroup(msg(1, "a", { sentAt: "2026-11-26T10:00:00" }), msg(2, "a", { sentAt: "2026-11-26T10:06:00" }))).toBe(true);
  });
});

describe("字", () => {
  it("预览：图片写 [图片]，换行变空格，太长截断", () => {
    expect(previewOf(msg(1, "a", { kind: "image", text: null }))).toBe("[图片]");
    expect(previewOf(msg(1, "a", { text: "晚上\n  开会" }))).toBe("晚上 开会");
    expect(previewOf(msg(1, "a", { text: "一".repeat(50) }), 10)).toBe(`${"一".repeat(10)}…`);
    expect(previewOf(null)).toBe("");
  });

  it("发之前：换行统一、去掉看不见的字符、去掉头尾空白；编号只用后台认的字", () => {
    expect(cleanText("  a\r\nb\rc\u0007\t d  ")).toBe("a\nb\nc\t d");
    expect(cleanText(" \n ")).toBe("");
    const id = newClientId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newClientId()).not.toBe(id);
    expect([badgeText(3), badgeText(99), badgeText(100)]).toEqual(["3", "99", "99+"]);
  });
});

describe("列表", () => {
  it("并进新消息：按顺序号排、不重复；自己刚发的那条按编号换成服务器回的；没发出去的留在最后", () => {
    const sending: ChatItem = { ...msg(0, "me"), id: "local:c1", clientId: "c1", state: "sending" };
    const failed: ChatItem = { ...msg(0, "me"), id: "local:c2", clientId: "c2", state: "failed" };
    let list = mergeMessages([msg(3), msg(1)], [msg(2), msg(3)]);
    expect(list.map(item => item.seq)).toEqual([1, 2, 3]);
    list = [...list, sending, failed];
    list = mergeMessages(list, [msg(4, "me", { clientId: "c1" }), msg(5)]);
    expect(list.map(item => item.id)).toEqual(["m1", "m2", "m3", "m4", "m5", "local:c2"]);
    expect(mergeMessages(list, [])).toBe(list);
  });

  it("会话跟着新消息变：别人发的、没正看着的才加没看条数；首页算过的不再算；最多数到 100", () => {
    const base = conv({ lastSeq: 5, readSeq: 3, unread: 2 });
    expect(applyMessage(base, msg(5), "me", false)).toBe(base);
    const next = applyMessage(base, msg(6), "me", false);
    expect([next.lastSeq, next.unread, next.lastMessage?.id]).toEqual([6, 3, "m6"]);
    expect(applyMessage(base, msg(6, "ME"), "me", false).unread).toBe(2); // 自己发的
    expect(applyMessage(base, msg(6), "me", true).unread).toBe(2); // 正看着
    expect(applyMessage(conv({ unread: UNREAD_CAP }), msg(9), "me", false).unread).toBe(UNREAD_CAP);
  });

  it("排序：全员群最前，别的最后一条新的在前；有没有没标已读的（正看着时来的不算条数也得标）", () => {
    const list = sortConversations([
      conv({ id: "d1", kind: "direct", lastSeq: 3 }),
      conv({ id: "d2", kind: "direct", lastSeq: 9 }),
      conv({ id: "t", kind: "team", lastSeq: 1 })
    ]);
    expect(list.map(item => item.id)).toEqual(["t", "d2", "d1"]);
    const c = conv({ readSeq: 5, unread: 0 });
    expect(hasUnseen(c, [msg(5), msg(6, "me")], "me")).toBe(false);
    expect(hasUnseen(c, [msg(6)], "me")).toBe(true);
    expect(hasUnseen(conv({ unread: 1 }), [], "me")).toBe(true);
  });

  it("分两段：全员群、说过话的私聊算「最近聊天」；开了私聊还没说话的不算", () => {
    expect(hasTalked(conv({ kind: "team", lastSeq: 0 }))).toBe(true);
    expect(hasTalked(conv({ kind: "direct", lastSeq: 0, lastMessage: null }))).toBe(false);
    expect(hasTalked(conv({ kind: "direct", lastSeq: 3 }))).toBe(true);
  });

  it("搜索：名字、账号、职位里含着就算；不分大小写、不管空白；没写字的全算", () => {
    const wang = ["小王", "xiaowang", "编导"];
    expect(matchesQuery("", wang)).toBe(true);
    expect(matchesQuery("  ", wang)).toBe(true);
    expect(matchesQuery("王", wang)).toBe(true);
    expect(matchesQuery("XiaoW", wang)).toBe(true);
    expect(matchesQuery("编 导", wang)).toBe(true);
    expect(matchesQuery("剪辑", wang)).toBe(false);
    expect(matchesQuery("王", [null, undefined, ""])).toBe(false);
  });
});

describe("图片", () => {
  it("发之前：动图不缩；大于 1MB 或长边超 1600 的缩到长边 1600，等比", () => {
    expect(needsShrink("image/gif", 9e6, 4000, 4000)).toBe(false);
    expect(needsShrink("image/png", 500e3, 1600, 900)).toBe(false);
    expect(needsShrink("image/png", 2e6, 800, 600)).toBe(true);
    expect(needsShrink("image/jpeg", 100e3, 3200, 100)).toBe(true);
    expect(fitSide(3200, 1800)).toEqual({ width: 1600, height: 900 });
    expect(fitSide(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSide(10000, 3)).toEqual({ width: 1600, height: 1 });
  });

  it("聊天里的小图：长边不超过 240，太细的留够点的地方，不知道大小的摆方的", () => {
    expect(thumbSize(1600, 900)).toEqual({ width: 240, height: 135 });
    expect(thumbSize(100, 50)).toEqual({ width: 100, height: 50 });
    expect(thumbSize(2000, 20)).toEqual({ width: 240, height: 48 });
    expect(thumbSize(null, null)).toEqual({ width: 180, height: 180 });
  });
});
