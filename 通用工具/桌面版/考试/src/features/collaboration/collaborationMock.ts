export type AccountRole = "owner" | "sub";

export type AccountStatus = "active" | "disabled";

export interface TeamAccount {
  id: string;
  username: string;
  displayName: string;
  role: AccountRole;
  status: AccountStatus;
  lastActive: string;
  permissionNote: string;
}

export const mockAccounts: TeamAccount[] = [
  {
    id: "owner",
    username: "studio_owner",
    displayName: "主账号",
    role: "owner",
    status: "active",
    lastActive: "今天 10:42",
    permissionNote: "管理子账号，维护团队共享配置。"
  },
  {
    id: "sub-lin",
    username: "lin_editor",
    displayName: "林一",
    role: "sub",
    status: "active",
    lastActive: "今天 09:58",
    permissionNote: "继承主账号的团队配置，本地 Codex / GPT 自行维护。"
  },
  {
    id: "sub-qiao",
    username: "qiao_shot",
    displayName: "乔安",
    role: "sub",
    status: "active",
    lastActive: "昨天 22:16",
    permissionNote: "继承主账号的团队配置，本地 Codex / GPT 自行维护。"
  },
  {
    id: "sub-ming",
    username: "ming_audio",
    displayName: "明澈",
    role: "sub",
    status: "disabled",
    lastActive: "6 月 26 日",
    permissionNote: "账号停用后不可登录。"
  }
];

export function accountRoleLabel(role: AccountRole) {
  return role === "owner" ? "主账号" : "子账号";
}

export function accountStatusLabel(status: AccountStatus) {
  return status === "active" ? "启用中" : "已停用";
}
