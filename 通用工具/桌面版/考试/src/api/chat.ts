// 壳子自己的（不是照搬的）：「消息」（团队聊天）的接口——会话、消息、图片、已读（2026-11-26）。
// 后台在 new-video8-8 的 CollaborationChatController；团队、谁能看哪个会话都由后台按登录的人认，这里不传团队。
// 等新消息（GET updates）不在页面里：壳子在后台等（lib/chat.js），收到了经 desk.onChat 转过来。
import { http } from "@/utils/http";
import { unwrap, type ApiResponse } from "./reply";

export type ChatKind = "team" | "direct";

export interface ChatImageInfo {
  bytes: number;
  width: number | null;
  height: number | null;
}

export interface ChatMessage {
  id: string;
  /** 顺序号：越大越新 */
  seq: number;
  conversationId: string;
  sender: string;
  kind: "text" | "image";
  text: string | null;
  image: ChatImageInfo | null;
  /** 页面自己起的编号：网断了重发不会重复，也靠它认出自己刚发的那条 */
  clientId: string | null;
  /** 服务器记的北京时间，不带时区："2026-11-26T15:30:00" */
  sentAt: string;
}

export interface ChatConversation {
  id: string;
  /** team 全员群；direct 两个人的私聊 */
  kind: ChatKind;
  peerUsername: string | null;
  lastSeq: number;
  lastMessage: ChatMessage | null;
  readSeq: number;
  /** 别人发来、我还没看的条数；最多数到 100 */
  unread: number;
}

export interface ChatStorageWarning {
  freeBytes: number;
  /** 低到不收新图片了 */
  imagesBlocked: boolean;
}

export interface ChatInbox {
  currentUsername: string;
  conversations: ChatConversation[];
  cursor: number;
  /** 服务器硬盘快满时才有（只给团队负责人） */
  storageWarning: ChatStorageWarning | null;
}

export interface ChatMessagePage {
  /** 从旧到新 */
  messages: ChatMessage[];
  hasMore: boolean;
}

/** 一张图本身（壳子拿回来的类型和字节） */
export interface ChatImageData {
  type: string;
  bytes: Uint8Array;
}

const CHAT = "/api/collaboration/chat";
const conversation = (id: string) =>
  `${CHAT}/conversations/${encodeURIComponent(id)}`;

export async function getChatInbox() {
  return unwrap(await http.request<ApiResponse<ChatInbox>>("get", `${CHAT}/inbox`));
}

/** 和某人的私聊：没有就建一个；with 空着是全员群 */
export async function openChatWith(username: string) {
  return unwrap(
    await http.request<ApiResponse<ChatConversation>>("post", `${CHAT}/conversations`, {
      data: { with: username }
    })
  );
}

/** 一个会话的消息：最新的 take 条；before 给了就拿它前面的 */
export async function getChatMessages(id: string, before?: number, take?: number) {
  return unwrap(
    await http.request<ApiResponse<ChatMessagePage>>("get", `${conversation(id)}/messages`, {
      params: { before, take }
    })
  );
}

export async function sendChatText(id: string, text: string, clientId: string) {
  return unwrap(
    await http.request<ApiResponse<ChatMessage>>("post", `${conversation(id)}/messages`, {
      data: { text, clientId }
    })
  );
}

export async function sendChatImage(
  id: string,
  file: File,
  clientId: string,
  width: number,
  height: number
) {
  const data = new FormData();
  data.append("file", file);
  return unwrap(
    await http.request<ApiResponse<ChatMessage>>("post", `${conversation(id)}/images`, {
      params: { clientId, width, height },
      data
    })
  );
}

export async function markChatRead(id: string, upToSeq: number) {
  return unwrap(
    await http.request<ApiResponse<boolean>>("post", `${conversation(id)}/read`, {
      data: { upToSeq }
    })
  );
}

/** 聊天里的一张图：要登录、要在那个会话里，经壳子拿回图本身 */
export async function getChatImage(messageId: string) {
  return http.request<ChatImageData>(
    "get",
    `${CHAT}/messages/${encodeURIComponent(messageId)}/image`,
    { binary: true }
  );
}
