// 壳子自己的（不是照搬的）：「消息」这一页问服务器的次数和几样要紧的事（2026-11-26）。
// 次数的规矩写在 chatStore.ts 开头：进页面 3 次；看过的会话不再拿；新消息靠壳子转、页面不自己等；标已读不叠着发。
import { describe, expect, it, vi } from "vitest";
import type { ChatConversation, ChatInbox, ChatMessage } from "@/api/chat";
import type { TeamMember } from "@/api/team";
import { OLD_SERVER, PEER_GONE, createChatStore, type ChatDeps } from "./chatStore";

const msg = (seq: number, conversationId: string, sender: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `m${seq}`,
  seq,
  conversationId,
  sender,
  kind: "text",
  text: `第${seq}条`,
  image: null,
  clientId: null,
  sentAt: "2026-11-26T10:00:00",
  ...extra
});
const conv = (id: string, extra: Partial<ChatConversation> = {}): ChatConversation => ({
  id,
  kind: id === "team_1" ? "team" : "direct",
  peerUsername: id === "team_1" ? null : "wang",
  lastSeq: 0,
  lastMessage: null,
  readSeq: 0,
  unread: 0,
  ...extra
});
const member = (username: string, status: "active" | "disabled" = "active"): TeamMember => ({
  username,
  displayName: { boss: "老板", wang: "小王", li: "小李" }[username] ?? username,
  role: username === "boss" ? "owner" : "sub",
  status,
  departmentId: null,
  title: ""
});
const INBOX: ChatInbox = {
  currentUsername: "boss",
  cursor: 4,
  storageWarning: null,
  conversations: [
    conv("dm_wang", { lastSeq: 4, readSeq: 2, unread: 1 }),
    conv("team_1", { lastSeq: 3, readSeq: 0, unread: 2 })
  ]
};
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(options: { active?: boolean; members?: TeamMember[]; inbox?: ChatInbox; fail?: unknown } = {}) {
  const calls: string[] = [];
  let seq = 10;
  let active = options.active ?? true;
  const notes: string[] = [];
  const api: ChatDeps["api"] = {
    getChatInbox: vi.fn(async () => {
      calls.push("inbox");
      if (options.fail) throw options.fail;
      return structuredClone(options.inbox ?? INBOX);
    }),
    getChatMessages: vi.fn(async (id: string, before?: number) => {
      calls.push(`messages:${id}${before ? `<${before}` : ""}`);
      if (id === "team_1") return { messages: before ? [msg(1, id, "wang")] : [msg(2, id, "li"), msg(3, id, "wang")], hasMore: !before };
      return { messages: [msg(4, id, "wang")], hasMore: false };
    }),
    markChatRead: vi.fn(async (id: string, upTo: number) => {
      calls.push(`read:${id}@${upTo}`);
      return true;
    }),
    sendChatText: vi.fn(async (id: string, text: string, clientId: string) => {
      calls.push(`send:${id}`);
      return msg(++seq, id, "boss", { text, clientId });
    }),
    sendChatImage: vi.fn(async (id: string, _file: File, clientId: string, width: number, height: number) => {
      calls.push(`image:${id}`);
      return msg(++seq, id, "boss", { kind: "image", text: null, image: { bytes: 3, width, height }, clientId });
    }),
    openChatWith: vi.fn(async (username: string) => {
      calls.push(`open:${username}`);
      return conv(`dm_${username}`, { peerUsername: username });
    })
  };
  let ids = 0;
  const kept: string[] = [];
  const store = createChatStore({
    api,
    team: async () => {
      calls.push("team");
      return { teamName: "冒烟", currentUsername: "boss", members: options.members ?? [member("boss"), member("wang"), member("li")] };
    },
    active: () => active,
    notify: text => notes.push(text),
    clientId: () => `c${++ids}`,
    keepImage: id => kept.push(id)
  });
  return { store, api, calls, notes, kept, setActive: (value: boolean) => { active = value; } };
}

describe("问服务器的次数", () => {
  it("进页面 3 次：团队名单、首页一起问，再拿第一个会话（全员群）；看着就把它标已读", async () => {
    const { store, calls } = setup();
    await store.load();
    expect(calls.slice(0, 2).sort()).toEqual(["inbox", "team"]);
    expect(calls.slice(2)).toEqual(["messages:team_1", "read:team_1@3"]);
    expect(store.state.conversations.map(item => item.id)).toEqual(["team_1", "dm_wang"]);
    expect(store.state.selectedId).toBe("team_1");
    expect(store.totalUnread.value).toBe(1); // 全员群标了，小王那 1 条还没看
  });

  it("切到没看过的会话拿 1 次，切回看过的不再拿；看更早的每回 1 次，拿完了不再拿", async () => {
    const { store, calls } = setup();
    await store.load();
    await store.select("dm_wang");
    await store.select("team_1");
    await store.select("dm_wang");
    expect(calls.filter(call => call.startsWith("messages:"))).toEqual(["messages:team_1", "messages:dm_wang"]);
    await store.select("team_1");
    expect(await store.loadEarlier()).toBe(true);
    expect(await store.loadEarlier()).toBe(false);
    expect(calls.filter(call => call.startsWith("messages:team_1"))).toEqual(["messages:team_1", "messages:team_1<2"]);
    expect(store.thread.value.items.map(item => item.seq)).toEqual([1, 2, 3]);
  });

  it("不在眼前（窗口在后面）不标已读；回到眼前标一回；没有新的不再标", async () => {
    const { store, calls, setActive } = setup({ active: false });
    await store.load();
    expect(calls.some(call => call.startsWith("read:"))).toBe(false);
    setActive(true);
    await store.markRead();
    await store.markRead();
    expect(calls.filter(call => call.startsWith("read:"))).toEqual(["read:team_1@3"]);
  });

  it("标已读不叠着发：标的时候又来了新的，等这一回标完再标一回", async () => {
    const { store, api, calls } = setup();
    let release = () => {};
    vi.mocked(api.markChatRead).mockImplementationOnce(async (id, upTo) => {
      calls.push(`read:${id}@${upTo}`);
      await new Promise<void>(resolve => { release = resolve; });
      return true;
    });
    const loading = store.load();
    await vi.waitFor(() => expect(calls).toContain("read:team_1@3"));
    store.receive([msg(5, "team_1", "wang")]);
    store.receive([msg(6, "team_1", "li")]);
    expect(calls.filter(call => call.startsWith("read:"))).toEqual(["read:team_1@3"]);
    release();
    await loading;
    await vi.waitFor(() => expect(calls.filter(call => call.startsWith("read:"))).toEqual(["read:team_1@3", "read:team_1@6"]));
  });
});

describe("新消息（壳子转来的）", () => {
  it("并进会话：没在看的会话加没看条数、挪到前面；首页没读出来时先攒着；同一条不算两回", async () => {
    const { store, calls } = setup();
    store.receive([msg(5, "dm_wang", "wang")]); // 首页还没读：攒着
    await store.load();
    expect(store.state.conversations.find(item => item.id === "dm_wang")?.unread).toBe(2);
    store.receive([msg(5, "dm_wang", "wang"), msg(7, "dm_wang", "wang")]);
    const wang = store.state.conversations.find(item => item.id === "dm_wang")!;
    expect([wang.unread, wang.lastSeq, wang.lastMessage?.id]).toEqual([3, 7, "m7"]);
    expect(calls.filter(call => call === "inbox")).toHaveLength(1);
  });

  it("别人新开的私聊：会话列表里添上；自己在别处新开的认不出是谁，重读一次首页", async () => {
    const { store, calls } = setup();
    await store.load();
    store.receive([msg(8, "dm_li", "li")]);
    expect(store.state.conversations.find(item => item.id === "dm_li")).toMatchObject({ kind: "direct", peerUsername: "li", unread: 1 });
    store.receive([msg(9, "dm_x", "boss")]);
    await tick();
    expect(calls.filter(call => call === "inbox")).toHaveLength(2);
  });

  it("正看着的会话里来了新的：并进列表、不加条数、马上标已读", async () => {
    const { store, calls } = setup();
    await store.load();
    store.receive([msg(5, "team_1", "wang")]);
    await tick();
    expect(store.thread.value.items.map(item => item.seq)).toEqual([2, 3, 5]);
    expect(store.state.conversations[0].unread).toBe(0);
    expect(calls).toContain("read:team_1@5");
  });
});

describe("发消息", () => {
  it("发字：先摆出来（发送中），服务器回了换成那一条；壳子再转来同一条不重复；空的、太长的不发", async () => {
    const { store, calls, notes } = setup();
    await store.load();
    const sending = store.sendText("  你好  ");
    expect(store.thread.value.items.at(-1)).toMatchObject({ text: "你好", state: "sending", sender: "boss" });
    expect(await sending).toBe(true);
    const sent = store.thread.value.items.at(-1)!;
    expect([sent.state, sent.text, sent.clientId]).toEqual([undefined, "你好", "c1"]);
    store.receive([{ ...sent }]);
    expect(store.thread.value.items.filter(item => item.text === "你好")).toHaveLength(1);
    expect(await store.sendText("   ")).toBe(false);
    expect(await store.sendText("字".repeat(4001))).toBe(false);
    expect(notes).toEqual(["一条消息最多 4000 个字。"]);
    expect(calls.filter(call => call.startsWith("send:"))).toEqual(["send:team_1"]);
    expect(store.state.conversations[0].unread).toBe(0); // 自己发的不算没看
  });

  it("没发出去：标着「没发出去」和服务器的话；重发用同一个编号", async () => {
    const { store, api } = setup();
    await store.load();
    vi.mocked(api.sendChatText).mockRejectedValueOnce(new Error("连不上服务器，看看网络"));
    await store.sendText("在吗");
    const failed = store.thread.value.items.at(-1)!;
    expect([failed.state, failed.error]).toEqual(["failed", "连不上服务器，看看网络"]);
    await store.retry(failed);
    expect(vi.mocked(api.sendChatText).mock.calls.map(call => call[2])).toEqual(["c1", "c1"]);
    expect(store.thread.value.items.at(-1)?.state).toBeUndefined();
  });

  it("发图：带上宽高；服务器回了编号，本机那一份接着用（不再拿一回）", async () => {
    const { store, api, kept } = setup();
    await store.load();
    const file = new File([new Uint8Array([1, 2, 3])], "a.webp", { type: "image/webp" });
    await store.sendImage({ file, width: 300, height: 200, url: "blob:local" });
    expect(vi.mocked(api.sendChatImage).mock.calls[0].slice(2)).toEqual(["c1", 300, 200]);
    expect(store.thread.value.items.at(-1)).toMatchObject({ kind: "image", image: { width: 300, height: 200 } });
    expect(kept).toEqual(["m11"]);
  });

  it("私聊对方停用了、移出团队了：不让发，说清楚为什么", async () => {
    const { store, calls } = setup({ members: [member("boss"), member("wang", "disabled")] });
    await store.load();
    await store.select("dm_wang");
    expect(store.blocked.value).toBe(PEER_GONE);
    expect(await store.sendText("在吗")).toBe(false);
    expect(calls.some(call => call.startsWith("send:"))).toBe(false);
    expect(store.contacts.value.map(item => item.username)).toEqual([]);
  });
});

describe("左边那一列：直接列出团队里的人", () => {
  it("全员群在最前，说过话的私聊最近的在前，再是还没说过话的人（照团队名单）；不列自己；停用的只在说过话时留着", async () => {
    const inbox: ChatInbox = {
      ...INBOX,
      conversations: [
        conv("dm_li", { peerUsername: "li" }), // 开过、还没说过话
        conv("dm_sun", { peerUsername: "sun", lastSeq: 1 }),
        conv("team_1", { lastSeq: 3 }),
        conv("dm_wang", { lastSeq: 4 })
      ]
    };
    const members = [member("boss"), member("zhao"), member("wang"), member("li"), member("sun", "disabled"), member("qian", "disabled")];
    const { store } = setup({ inbox, members });
    await store.load();
    expect(store.rows.value.map(row => row.key)).toEqual(["team_1", "dm_wang", "dm_sun", "u:zhao", "u:li"]);
    expect(store.rows.value.map(row => row.conversation?.id ?? null)).toEqual(["team_1", "dm_wang", "dm_sun", null, "dm_li"]);
  });

  it("点还没说过话的人：开私聊问 1 次、停在那儿，那一行不挪；再点不再问；说了第一句挪到说过话的那一截", async () => {
    const { store, calls } = setup();
    await store.load();
    const li = () => store.rows.value.find(row => row.username === "li")!;
    expect(li().conversation).toBeNull();
    await store.pick(li());
    expect(store.state.selectedId).toBe("dm_li");
    expect(store.rows.value.map(row => row.key)).toEqual(["team_1", "dm_wang", "u:li"]);
    await store.pick(li());
    expect(calls.filter(call => call.startsWith("open:"))).toEqual(["open:li"]);
    await store.sendText("在吗");
    expect(store.rows.value.map(row => row.key)).toEqual(["team_1", "dm_li", "dm_wang"]);
    await store.pick(store.rows.value[0]);
    expect(store.state.selectedId).toBe("team_1");
  });
});

describe("打开某个会话、和某人私聊", () => {
  it("首页没读出来就说了要打开：读出来以后直接进那个，不先拿全员群", async () => {
    const { store, calls } = setup();
    void store.open({ conversationId: "dm_wang" });
    await store.load();
    expect(store.state.selectedId).toBe("dm_wang");
    expect(calls.filter(call => call.startsWith("messages:"))).toEqual(["messages:dm_wang"]);
  });

  it("和某人私聊：有就切过去不再问；没有先建一个；不能和自己", async () => {
    const { store, calls } = setup();
    await store.load();
    await store.open({ with: "wang" });
    expect(store.state.selectedId).toBe("dm_wang");
    await store.startDirect("li");
    expect(store.state.selectedId).toBe("dm_li");
    await store.startDirect("BOSS");
    expect(calls.filter(call => call.startsWith("open:"))).toEqual(["open:li"]);
  });

  it("服务器上还没有聊天（后台没升级）：说人话", async () => {
    const { store } = setup({ fail: Object.assign(new Error("x"), { response: { status: 404, data: null } }) });
    await store.load();
    expect([store.state.loadState, store.state.loadError]).toEqual(["error", OLD_SERVER]);
  });
});
