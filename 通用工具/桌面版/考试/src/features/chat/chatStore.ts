// 壳子自己的（不是照搬的）：「消息」这一页的数据和动作（2026-11-26）。
// 问服务器的次数（chatStore.test.ts 量着）：
//   进页面 3 次：团队名单、聊天首页（两样一起问），再拿第一个会话最新的 50 条；
//   切到没看过的会话 1 次，看过的不再拿（新消息壳子会转过来）；点「看更早的」每回 1 次；
//   发一条字、一张图各 1 次；新开私聊 1 次；标已读同一时间最多 1 次在路上，没有新的不标；
//   页面自己不等新消息：壳子在后台等（lib/chat.js），收到了经 desk.onChat 转过来（receive）。
import { computed, reactive } from "vue";
import type * as chatApi from "@/api/chat";
import type {
  ChatConversation,
  ChatMessage,
  ChatStorageWarning
} from "@/api/chat";
import { getCollaborationErrorMessage } from "@/api/collaboration";
import type { TeamMember } from "@/api/team";
import {
  PAGE_SIZE,
  TEXT_MAX,
  applyMessage,
  beijingNow,
  chatRows,
  cleanText,
  hasUnseen,
  mergeMessages,
  sameUser,
  sortConversations,
  type ChatItem,
  type ChatRow
} from "./chatModel";

export interface ChatThread {
  items: ChatItem[];
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  error: string;
}

/** 要打开哪个会话：某个会话，或者和某人的私聊 */
export type ChatOpen = { conversationId?: string; with?: string } | null;

/** 壳子转来的：新消息，或者要打开哪个会话 */
export interface DeskChatEvent {
  messages?: ChatMessage[];
  open?: ChatOpen;
}

export interface ChatDeps {
  api: Pick<
    typeof chatApi,
    | "getChatInbox"
    | "openChatWith"
    | "getChatMessages"
    | "sendChatText"
    | "sendChatImage"
    | "markChatRead"
  >;
  /** 团队名单（「我的团队」那个接口）：名字、谁停用了 */
  team: () => Promise<{ teamName: string; currentUsername: string; members: TeamMember[] }>;
  /** 页面露着、窗口在前面：新消息算看到了 */
  active: () => boolean;
  /** 没成时说一声 */
  notify: (text: string) => void;
  clientId: () => string;
  /** 自己刚发的图：服务器回了编号，本机那一份接着用 */
  keepImage?: (messageId: string, url: string) => void;
}

export const OLD_SERVER = "服务器上还没有「消息」这个功能，要等后台升级。";
export const PEER_GONE = "对方的账号已停用或已移出团队，发不了新消息。";

const EMPTY: ChatThread = { items: [], hasMore: false, loaded: false, loading: false, error: "" };
const two = (n: number) => String(n).padStart(2, "0");

/** 页面上要摆的话：后台没有这个接口（还没升级）说人话 */
export function describeError(error: unknown) {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status === 404 ? OLD_SERVER : getCollaborationErrorMessage(error);
}

export function createChatStore(deps: ChatDeps) {
  const state = reactive({
    loadState: "loading" as "loading" | "ready" | "error",
    loadError: "",
    me: "",
    teamName: "",
    members: [] as TeamMember[],
    conversations: [] as ChatConversation[],
    selectedId: "",
    threads: {} as Record<string, ChatThread>,
    storageWarning: null as ChatStorageWarning | null
  });
  let early: ChatMessage[] = []; // 首页还没读出来，壳子就转来的
  let wanted: ChatOpen = null; // 首页还没读出来，就说了要打开的
  let reading = false;
  let readAgain = false;

  const people = computed(
    () => new Map(state.members.map(member => [member.username.toLowerCase(), member]))
  );
  const memberOf = (username?: string | null) =>
    people.value.get((username || "").toLowerCase());
  const nameOf = (username?: string | null) =>
    memberOf(username)?.displayName || username || "";
  const conversationOf = (id: string) => state.conversations.find(item => item.id === id);
  const titleOf = (conversation: ChatConversation) =>
    conversation.kind === "team" ? "全员群" : nameOf(conversation.peerUsername) || "私聊";

  const selected = computed(() => conversationOf(state.selectedId) ?? null);
  const thread = computed(() => state.threads[state.selectedId] ?? EMPTY);
  const totalUnread = computed(() =>
    state.conversations.reduce((sum, item) => sum + item.unread, 0)
  );
  /** 能不能往这个会话里发：私聊对方停用了、移出团队了就不能 */
  const blocked = computed(() => {
    const conversation = selected.value;
    if (!conversation || conversation.kind === "team") return "";
    const peer = memberOf(conversation.peerUsername);
    return peer && peer.status === "active" ? "" : PEER_GONE;
  });
  /** 能开私聊的人：团队里除了自己、没停用的 */
  const contacts = computed(() =>
    state.members.filter(
      member => member.status === "active" && !sameUser(member.username, state.me)
    )
  );
  /** 左边那一列：全员群、说过话的私聊，再是团队里还没说过话的人（点名字就聊） */
  const rows = computed(() => chatRows(state.conversations, contacts.value));

  function threadOf(id: string) {
    if (!state.threads[id]) state.threads[id] = { ...EMPTY, items: [] };
    return state.threads[id];
  }

  async function load() {
    state.loadState = "loading";
    try {
      const [team, inbox] = await Promise.all([deps.team(), deps.api.getChatInbox()]);
      state.teamName = team.teamName;
      state.members = team.members;
      state.me = inbox.currentUsername || team.currentUsername;
      state.conversations = sortConversations(inbox.conversations);
      state.storageWarning = inbox.storageWarning ?? null;
      state.loadState = "ready";
      const queued = early;
      early = [];
      receive(queued);
      const target = wanted;
      wanted = null;
      if (target) await open(target);
      if (!conversationOf(state.selectedId)) await select(state.conversations[0]?.id ?? "");
    } catch (error) {
      state.loadError = describeError(error);
      state.loadState = "error";
    }
  }

  async function loadThread(id: string) {
    const current = threadOf(id);
    current.loading = true;
    current.error = "";
    try {
      const page = await deps.api.getChatMessages(id, undefined, PAGE_SIZE);
      current.items = mergeMessages(current.items, page.messages);
      current.hasMore = page.hasMore;
      current.loaded = true;
    } catch (error) {
      current.error = describeError(error);
    } finally {
      current.loading = false;
    }
  }

  async function select(id: string) {
    state.selectedId = id;
    if (!id) return;
    const current = threadOf(id);
    if (!current.loaded && !current.loading) await loadThread(id);
    void markRead();
  }

  /** 往上翻：拿最早那条前面的 50 条。拿到了回 true */
  async function loadEarlier() {
    const id = state.selectedId;
    const current = state.threads[id];
    const first = current?.items.find(item => !item.state);
    if (!current || !current.hasMore || current.loading || !first) return false;
    current.loading = true;
    try {
      const page = await deps.api.getChatMessages(id, first.seq, PAGE_SIZE);
      current.items = mergeMessages(current.items, page.messages);
      current.hasMore = page.hasMore;
      return true;
    } catch (error) {
      deps.notify(describeError(error));
      return false;
    } finally {
      current.loading = false;
    }
  }

  /** 壳子转来的新消息（自己发出去、服务器回的那条也走这里）：并进各会话，会话列表跟着变 */
  function receive(messages: ChatMessage[]) {
    if (!messages.length) return;
    if (state.loadState !== "ready") {
      early.push(...messages);
      return;
    }
    const watching = deps.active();
    const groups = new Map<string, ChatMessage[]>();
    for (const message of messages) {
      const list = groups.get(message.conversationId) ?? [];
      list.push(message);
      groups.set(message.conversationId, list);
    }
    let unknown = false;
    const list = [...state.conversations];
    for (const [id, incoming] of groups) {
      let index = list.findIndex(item => item.id === id);
      if (index < 0) {
        // 首页里没有：别人刚开的私聊（全员群一直在首页里）
        const other = incoming.find(message => !sameUser(message.sender, state.me));
        if (!other) {
          unknown = true; // 自己在别处新开的：认不出是和谁，回头重读一遍首页
          continue;
        }
        list.push({ id, kind: "direct", peerUsername: other.sender, lastSeq: 0, lastMessage: null, readSeq: 0, unread: 0 });
        index = list.length - 1;
      }
      const looking = watching && id === state.selectedId;
      list[index] = incoming.reduce(
        (conversation, message) => applyMessage(conversation, message, state.me, looking),
        list[index]
      );
      const current = state.threads[id];
      if (current) current.items = mergeMessages(current.items, incoming);
    }
    state.conversations = sortConversations(list);
    if (unknown) void refreshInbox();
    void markRead();
  }

  async function refreshInbox() {
    try {
      const inbox = await deps.api.getChatInbox();
      state.conversations = sortConversations(inbox.conversations);
      state.storageWarning = inbox.storageWarning ?? null;
    } catch {
      // 下回再说
    }
  }

  /** 打开一个会话（点了提醒、「我的团队」里点了「发消息」） */
  async function open(target: ChatOpen) {
    if (!target) return;
    if (state.loadState !== "ready") {
      wanted = target;
      return;
    }
    if (target.with) return startDirect(target.with);
    if (!target.conversationId) return;
    if (!conversationOf(target.conversationId)) await refreshInbox();
    if (conversationOf(target.conversationId)) await select(target.conversationId);
  }

  /** 和某人私聊：有就切过去，没有先建一个 */
  async function startDirect(username: string) {
    if (!username || sameUser(username, state.me)) return;
    const existing = state.conversations.find(
      item => item.kind === "direct" && sameUser(item.peerUsername, username)
    );
    if (existing) return select(existing.id);
    try {
      const conversation = await deps.api.openChatWith(username);
      if (!conversationOf(conversation.id)) {
        state.conversations = sortConversations([...state.conversations, conversation]);
      }
      await select(conversation.id);
    } catch (error) {
      deps.notify(describeError(error));
    }
  }

  /** 点了左边一行：会话就切过去；还没说过话的人就开私聊 */
  function pick(row: ChatRow) {
    return row.conversation ? select(row.conversation.id) : startDirect(row.username);
  }

  /** 正看着的会话里有别人发来、还没标的：标到最新那条。同一时间只标一回，标的时候又来了新的，标完再标一回 */
  async function markRead() {
    const conversation = selected.value;
    if (!conversation || !deps.active()) return;
    const current = state.threads[conversation.id];
    if (!current?.loaded || !hasUnseen(conversation, current.items, state.me)) return;
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    const id = conversation.id;
    const upTo = Math.max(
      conversation.lastSeq,
      ...current.items.filter(item => !item.state).map(item => item.seq)
    );
    const counted = conversation.unread;
    try {
      await deps.api.markChatRead(id, upTo);
      state.conversations = state.conversations.map(item =>
        item.id === id
          ? { ...item, readSeq: Math.max(item.readSeq, upTo), unread: Math.max(0, item.unread - counted) }
          : item
      );
    } catch {
      // 标不上：下回再标
    } finally {
      reading = false;
      if (readAgain) {
        readAgain = false;
        void markRead();
      }
    }
  }

  function nowText() {
    const t = beijingNow();
    return `${t.y}-${two(t.mo)}-${two(t.d)}T${two(t.h)}:${two(t.mi)}:00`;
  }

  function change(conversationId: string, clientId: string, patch: Partial<ChatItem>) {
    const current = state.threads[conversationId];
    if (!current) return;
    current.items = current.items.map(item =>
      item.state && item.clientId === clientId ? { ...item, ...patch } : item
    );
  }

  /** 发出去（重发也走这里，编号不变：上回其实发到了的，服务器认得出不会重复） */
  async function deliver(item: ChatItem) {
    change(item.conversationId, item.clientId!, { state: "sending", error: "" });
    try {
      const saved =
        item.kind === "image"
          ? await deps.api.sendChatImage(
              item.conversationId,
              item.file!,
              item.clientId!,
              item.image!.width ?? 0,
              item.image!.height ?? 0
            )
          : await deps.api.sendChatText(item.conversationId, item.text!, item.clientId!);
      if (item.localUrl) deps.keepImage?.(saved.id, item.localUrl);
      receive([saved]);
    } catch (error) {
      change(item.conversationId, item.clientId!, { state: "failed", error: describeError(error) });
    }
  }

  function draftItem(conversationId: string, part: Partial<ChatItem>): ChatItem {
    const clientId = deps.clientId();
    return {
      id: `local:${clientId}`,
      seq: 0,
      conversationId,
      sender: state.me,
      kind: "text",
      text: null,
      image: null,
      clientId,
      sentAt: nowText(),
      state: "sending",
      ...part
    };
  }

  /** 发一条字。字是空的、太长的不发（回 false） */
  async function sendText(raw: string) {
    const conversation = selected.value;
    const text = cleanText(raw);
    if (!conversation || !text || blocked.value) return false;
    if (text.length > TEXT_MAX) {
      deps.notify(`一条消息最多 ${TEXT_MAX} 个字。`);
      return false;
    }
    const item = draftItem(conversation.id, { kind: "text", text });
    const current = threadOf(conversation.id);
    current.items = [...current.items, item];
    await deliver(item);
    return true;
  }

  /** 发一张图（已经缩好了的，见 chatImage.ts 的 prepareImage） */
  async function sendImage(image: { file: File; width: number; height: number; url: string }) {
    const conversation = selected.value;
    if (!conversation || blocked.value) return false;
    const item = draftItem(conversation.id, {
      kind: "image",
      image: { bytes: image.file.size, width: image.width, height: image.height },
      localUrl: image.url,
      file: image.file
    });
    const current = threadOf(conversation.id);
    current.items = [...current.items, item];
    await deliver(item);
    return true;
  }

  return {
    state,
    selected,
    thread,
    totalUnread,
    blocked,
    contacts,
    rows,
    nameOf,
    memberOf,
    titleOf,
    load,
    loadThread,
    select,
    pick,
    loadEarlier,
    receive,
    open,
    startDirect,
    markRead,
    sendText,
    sendImage,
    retry: (item: ChatItem) => deliver(item)
  };
}

export type ChatStore = ReturnType<typeof createChatStore>;

/** 接上壳子：新消息、要打开哪个会话都交给 handle。整页只接一回（切走再回来不会接两回）。壳子太老、没有这一样的回 false */
let handle: ((event: DeskChatEvent) => void) | null = null;
let hooked = false;
export function listenDesk(fn: (event: DeskChatEvent) => void) {
  handle = fn;
  const desk = (globalThis as unknown as {
    desk?: { onChat?: (fn: (event: DeskChatEvent) => void) => void };
  }).desk;
  if (!desk?.onChat) return false;
  if (!hooked) {
    hooked = true;
    desk.onChat(event => handle?.(event));
  }
  return true;
}
