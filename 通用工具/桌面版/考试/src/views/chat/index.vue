<script setup lang="ts">
// 壳子自己的（不是照搬的）：「消息」——左边一列，右边聊天（2026-11-26）。
// 左边上面能搜人（名字、账号、职位）；下面分两段：「最近聊天」（全员群在最前，再是说过话的私聊）、「其他成员」（团队里还没说过话的人，点名字就聊）。
// 数据和动作在 features/chat/chatStore.ts；新消息壳子在后台收（lib/chat.js），经 desk.onChat 转过来。
// 团队负责人看不到别人的私聊（后台按登录的人认）；聊天记录一直留着。
import ArrowDown from "~icons/ep/arrow-down";
import ChatDotRound from "~icons/ep/chat-dot-round";
import CircleClose from "~icons/ep/circle-close";
import Picture from "~icons/ep/picture";
import Search from "~icons/ep/search";
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch
} from "vue";
import { ElMessage } from "element-plus";
import * as chatApi from "@/api/chat";
import type { ChatConversation } from "@/api/chat";
import { getTeamOverview } from "@/api/team";
import { avatarText } from "@/utils/avatar";
import ChatPicture from "@/features/chat/components/ChatPicture.vue";
import { keepImage, prepareImage, type PreparedImage } from "@/features/chat/chatImage";
import {
  TEXT_MAX,
  badgeText,
  formatShortTime,
  formatTime,
  hasTalked,
  matchesQuery,
  needsTimeLine,
  newClientId,
  previewOf,
  sameUser,
  startsGroup,
  type ChatItem,
  type ChatRow
} from "@/features/chat/chatModel";
import { createChatStore, listenDesk } from "@/features/chat/chatStore";

defineOptions({ name: "TeamChat" });

/** 页面露着、窗口在前面：新消息算看到了，才标已读 */
const active = () => document.visibilityState === "visible" && document.hasFocus();
const store = createChatStore({
  api: chatApi,
  team: getTeamOverview,
  active,
  notify: text => ElMessage.error(text),
  clientId: newClientId,
  keepImage
});
const { state, selected, thread, blocked, contacts, rows, nameOf, memberOf, titleOf } = store;
const linked = listenDesk(event => {
  if (event.messages) store.receive(event.messages);
  if (event.open !== undefined) void store.open(event.open);
});
void store.load();

const isMine = (item: ChatItem) => sameUser(item.sender, state.me);
const initial = (username: string | null | undefined) => avatarText(nameOf(username));
const subtitle = computed(() => {
  const conversation = selected.value;
  if (!conversation) return "";
  if (conversation.kind === "team") return `团队「${state.teamName}」· ${state.members.length} 人`;
  const peer = memberOf(conversation.peerUsername);
  return [conversation.peerUsername, peer?.title].filter(Boolean).join(" · ");
});
function listLine(conversation: ChatConversation) {
  const last = conversation.lastMessage;
  if (!last) return conversation.kind === "team" ? "团队里的人都在这里" : "还没说过话";
  const who = sameUser(last.sender, state.me) ? "我" : nameOf(last.sender);
  return `${conversation.kind === "team" || sameUser(last.sender, state.me) ? `${who}：` : ""}${previewOf(last, 26)}`;
}
/** 左边一行下面那句：说过话的写最后一条；还没说过话的写他的职位 */
function rowLine(row: ChatRow) {
  const conversation = row.conversation;
  if (conversation && (conversation.kind === "team" || conversation.lastMessage)) return listLine(conversation);
  return memberOf(row.username)?.title || "还没说过话";
}

// ---- 左边：上面一个搜索框（名字、账号、职位都能搜）；列表分两段——最近聊天、其他成员（2026-11-26）
const query = ref("");
const searchBox = ref<HTMLInputElement | null>(null);
const rowName = (row: ChatRow) => (row.conversation ? titleOf(row.conversation) : nameOf(row.username));
/** 这一行能用哪几样字搜到：群是群名、团队名；人是名字、账号、职位 */
const rowWords = (row: ChatRow) =>
  row.conversation?.kind === "team"
    ? [rowName(row), state.teamName]
    : [rowName(row), row.username, memberOf(row.username)?.title];
const found = computed(() => rows.value.filter(row => matchesQuery(query.value, rowWords(row))));
const sections = computed(() =>
  [
    { key: "talked", title: "最近聊天", rows: found.value.filter(row => !!row.conversation && hasTalked(row.conversation)) },
    { key: "others", title: "其他成员", rows: found.value.filter(row => !row.conversation || !hasTalked(row.conversation)) }
  ].filter(section => section.rows.length > 0)
);
/** 停用了、移出团队了的人：那一行淡一点（记录照样能翻） */
const gone = (row: ChatRow) =>
  row.conversation?.kind === "direct" && memberOf(row.username)?.status !== "active";
/** 点了一行：从搜出来的里点的，搜索清掉，列表回到原样 */
function pickRow(row: ChatRow) {
  query.value = "";
  void store.pick(row);
}
/** 搜索框里：Enter 开搜到的第一个；Esc 先清字，再按一下离开搜索框 */
function onSearchKey(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === "Enter" && query.value.trim() && found.value.length) pickRow(found.value[0]);
  else if (event.key === "Escape") {
    if (query.value) query.value = "";
    else searchBox.value?.blur();
  }
}
function clearSearch() {
  query.value = "";
  searchBox.value?.focus();
}
const storageLine = computed(() => {
  const warning = state.storageWarning;
  if (!warning) return "";
  const gb = (warning.freeBytes / 1073741824).toFixed(1);
  return warning.imagesBlocked
    ? `服务器硬盘快满了：只剩 ${gb} GB，图片已经发不了了（文字照常能发）。请清理服务器或加硬盘。`
    : `服务器硬盘快满了：只剩 ${gb} GB。剩不到 1 GB 时图片就发不了了（文字照常能发）。`;
});

// ---- 写的字：每个会话各留各的（切走再回来还在）
const drafts = reactive<Record<string, string>>({});
const draft = computed({
  get: () => drafts[state.selectedId] ?? "",
  set: value => {
    drafts[state.selectedId] = value;
  }
});
const canSend = computed(() => !!selected.value && !blocked.value && draft.value.trim().length > 0);

async function send() {
  const text = draft.value;
  if (!canSend.value) return;
  if (text.trim().length > TEXT_MAX) {
    ElMessage.warning(`一条消息最多 ${TEXT_MAX} 个字。`);
    return;
  }
  draft.value = "";
  await store.sendText(text);
}
function onKey(event: KeyboardEvent) {
  // Enter 发，Shift+Enter 换行；输入法还在选字时的 Enter 不算
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  void send();
}

// ---- 滚动：切到一个会话、自己发了、本来就在最底下，滚到最底下；正往上翻着看的，不拽下来，底下提示有几条新的
const scroller = ref<HTMLElement | null>(null);
const newBelow = ref(0);
const nearBottom = () => {
  const el = scroller.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
};
async function toBottom() {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
  newBelow.value = 0;
}
watch(
  () => [state.selectedId, thread.value.items.length, thread.value.items.at(-1)?.id] as const,
  ([id, length, last], [oldId, oldLength, oldLast]) => {
    if (id !== oldId || !oldLength) {
      void toBottom();
      return;
    }
    if (last === oldLast) return; // 往上翻出来的更早的
    const item = thread.value.items.at(-1);
    if ((item && isMine(item)) || nearBottom()) void toBottom();
    else newBelow.value += Math.max(1, length - oldLength);
  }
);
function onScroll() {
  if (newBelow.value && nearBottom()) newBelow.value = 0;
}
async function earlier() {
  const el = scroller.value;
  const fromBottom = el ? el.scrollHeight - el.scrollTop : 0;
  if (!(await store.loadEarlier())) return;
  await nextTick();
  if (el) el.scrollTop = el.scrollHeight - fromBottom; // 往上加了一截：眼睛看着的那条不动
}

// ---- 图片：挑、粘贴、拖进来都先给人看一眼再发；点开看大图
const picker = ref<HTMLInputElement | null>(null);
const pending = reactive({ visible: false, image: null as PreparedImage | null });
const viewer = ref("");
async function offer(file: File | null | undefined) {
  if (!file || !selected.value) return;
  if (blocked.value) {
    ElMessage.warning(blocked.value);
    return;
  }
  try {
    pending.image = await prepareImage(file);
    pending.visible = true;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}
function onPick(event: Event) {
  const target = event.target as HTMLInputElement;
  void offer(target.files?.[0]);
  target.value = "";
}
function firstImage(files: FileList | null | undefined) {
  return [...(files ?? [])].find(file => file.type.startsWith("image/"));
}
function onPaste(event: ClipboardEvent) {
  const file = firstImage(event.clipboardData?.files);
  if (!file) return;
  event.preventDefault();
  void offer(file);
}
function onDrop(event: DragEvent) {
  void offer(firstImage(event.dataTransfer?.files));
}
async function sendPending() {
  const image = pending.image;
  pending.image = null;
  pending.visible = false;
  if (image) await store.sendImage(image);
}
function dropPending() {
  if (pending.image) URL.revokeObjectURL(pending.image.url);
  pending.image = null;
}

// ---- 回到眼前时把正看着的标已读；拖到页面别处的文件不许把整页换掉；Esc 关大图
const wake = () => void store.markRead();
const stopDrop = (event: DragEvent) => event.preventDefault();
const onEsc = (event: KeyboardEvent) => {
  if (event.key === "Escape" && viewer.value) viewer.value = "";
};
onMounted(() => {
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("dragover", stopDrop);
  window.addEventListener("drop", stopDrop);
  window.addEventListener("keydown", onEsc);
});
onActivated(wake);
onBeforeUnmount(() => {
  window.removeEventListener("focus", wake);
  document.removeEventListener("visibilitychange", wake);
  window.removeEventListener("dragover", stopDrop);
  window.removeEventListener("drop", stopDrop);
  window.removeEventListener("keydown", onEsc);
});
</script>

<template>
  <section class="chat-page desk-panel">
    <div v-if="state.loadState === 'error'" class="chat-state wide">
      <strong>没读出来</strong>
      <p>{{ state.loadError }}</p>
      <button class="text-action" type="button" @click="store.load">再试一次</button>
    </div>
    <div v-else-if="state.loadState === 'loading'" class="chat-state wide">
      <span>正在读取消息…</span>
    </div>

    <template v-else>
      <aside class="chat-list" aria-label="会话">
        <header class="list-head">
          <label class="search">
            <Search class="search-icon" aria-hidden="true" />
            <input
              ref="searchBox"
              v-model="query"
              type="text"
              name="chat-search"
              autocomplete="off"
              aria-label="找人"
              placeholder="找人：名字、账号、职位"
              @keydown="onSearchKey"
            />
            <button v-if="query" class="search-clear" type="button" title="清空" @click="clearSearch">
              <CircleClose />
            </button>
          </label>
        </header>
        <p v-if="storageLine" class="chat-warn">{{ storageLine }}</p>
        <p v-if="!linked" class="chat-warn">这一版软件收不到新消息，要重新打开这一页才看得到。请升级软件。</p>
        <div class="conv-list">
          <section v-for="section in sections" :key="section.key" class="conv-group">
            <h3 class="list-label">{{ section.title }}</h3>
            <button
              v-for="row in section.rows"
              :key="row.key"
              class="conv-row"
              :class="{ on: !!row.conversation && row.conversation.id === state.selectedId, gone: gone(row) }"
              type="button"
              :data-conv="row.conversation?.id"
              :data-user="row.username || undefined"
              @click="pickRow(row)"
            >
              <span class="avatar" :class="{ group: row.conversation?.kind === 'team' }" aria-hidden="true">
                <ChatDotRound v-if="row.conversation?.kind === 'team'" />
                <template v-else>{{ initial(row.username) }}</template>
              </span>
              <span class="conv-main">
                <strong>{{ rowName(row) }}</strong>
                <small>{{ rowLine(row) }}</small>
              </span>
              <span class="conv-side">
                <time v-if="row.conversation?.lastMessage">{{ formatShortTime(row.conversation.lastMessage.sentAt) }}</time>
                <b v-if="row.conversation && row.conversation.unread > 0" class="badge">{{ badgeText(row.conversation.unread) }}</b>
              </span>
            </button>
          </section>
          <p v-if="query.trim() && found.length === 0" class="list-empty">没找到「{{ query.trim() }}」，换个字试试（名字、账号、职位都行）。</p>
          <p v-else-if="contacts.length === 0" class="list-empty">团队里还没有别人，有人加进来就会列在这里。</p>
        </div>
      </aside>

      <main v-if="selected" class="chat-room" @dragover.prevent @drop.prevent="onDrop">
        <header class="room-head">
          <h2>{{ titleOf(selected) }}</h2>
          <span>{{ subtitle }}</span>
        </header>

        <div ref="scroller" class="room-scroll" @scroll="onScroll">
          <button
            v-if="thread.hasMore"
            class="text-action compact more"
            type="button"
            :disabled="thread.loading"
            @click="earlier"
          >
            {{ thread.loading ? "正在读…" : "看更早的消息" }}
          </button>
          <div v-if="thread.error" class="chat-state">
            <strong>没读出来</strong>
            <p>{{ thread.error }}</p>
            <button class="text-action" type="button" @click="store.loadThread(state.selectedId)">再试一次</button>
          </div>
          <div v-else-if="!thread.loaded" class="chat-state"><span>正在读取…</span></div>
          <div v-else-if="thread.items.length === 0" class="chat-state">
            <span>{{ selected.kind === "team" ? "全员群里还没人说话，先打个招呼吧。" : "还没说过话，先打个招呼吧。" }}</span>
          </div>
          <template v-for="(item, index) in thread.items" :key="item.clientId || item.id">
            <div v-if="needsTimeLine(thread.items[index - 1], item)" class="time-line">
              {{ formatTime(item.sentAt) }}
            </div>
            <div
              class="msg"
              :class="{ mine: isMine(item), follow: !startsGroup(thread.items[index - 1], item) }"
              :data-seq="item.seq"
            >
              <span v-if="!isMine(item)" class="avatar small" aria-hidden="true">{{ initial(item.sender) }}</span>
              <div class="msg-body" :title="formatTime(item.sentAt)">
                <small
                  v-if="selected.kind === 'team' && !isMine(item) && startsGroup(thread.items[index - 1], item)"
                  class="msg-name"
                >{{ nameOf(item.sender) }}</small>
                <div v-if="item.kind === 'text'" class="bubble">{{ item.text }}</div>
                <ChatPicture v-else :item="item" @open="url => (viewer = url)" />
                <div v-if="item.state === 'sending'" class="msg-state">发送中…</div>
                <div v-else-if="item.state === 'failed'" class="msg-state failed">
                  没发出去：{{ item.error }}
                  <button class="link" type="button" data-do="retry" @click="store.retry(item)">重发</button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <button v-if="newBelow > 0" class="new-below" type="button" @click="toBottom">
          <ArrowDown />
          {{ newBelow }} 条新消息
        </button>

        <footer v-if="blocked" class="composer blocked">{{ blocked }}</footer>
        <footer v-else class="composer">
          <div class="composer-box">
            <textarea
              v-model="draft"
              name="chat-text"
              :maxlength="TEXT_MAX"
              placeholder="写消息……Enter 发送，Shift+Enter 换行；截图可以直接粘贴进来"
              @keydown="onKey"
              @paste="onPaste"
            />
            <div class="composer-bar">
              <button
                class="tool"
                type="button"
                data-do="pick-image"
                title="发图片：也可以把截图直接粘贴进来，或者拖进来"
                @click="picker?.click()"
              >
                <Picture />
                图片
              </button>
              <input
                ref="picker"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                @change="onPick"
              />
              <span class="hint">{{ draft.length > TEXT_MAX - 500 ? `${draft.length} / ${TEXT_MAX}` : "" }}</span>
              <button class="primary-action compact" type="button" data-do="send" :disabled="!canSend" @click="send">
                发送
              </button>
            </div>
          </div>
        </footer>
      </main>
    </template>

    <el-dialog v-model="pending.visible" title="发这张图？" width="520px" class="desk-dialog" @closed="dropPending">
      <img v-if="pending.image" class="pending-image" :src="pending.image.url" alt="要发的图" />
      <template #footer>
        <el-button @click="pending.visible = false">取消</el-button>
        <el-button type="primary" data-do="send-image" @click="sendPending">发送</el-button>
      </template>
    </el-dialog>

    <div v-if="viewer" class="chat-viewer" title="点一下关掉" @click="viewer = ''">
      <img :src="viewer" alt="大图" />
    </div>
  </section>
</template>

<style scoped src="./index.css"></style>
