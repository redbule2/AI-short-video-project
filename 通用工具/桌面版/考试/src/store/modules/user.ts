// 壳子自己的（不是照搬的）：旧项目的用户仓库管登录、存凭证；这里登录归桌面软件管，只留考试用到的「是谁、什么角色」。
import { defineStore } from "pinia";
import { store } from "../utils";

export interface DeskUser {
  username: string;
  nickname: string;
  accountType: string;
}

/** 角色照旧后台 UserService.BuildRoles：主账号 = admin + owner，子账号 = sub。 */
export function rolesOf(accountType: string) {
  return accountType === "owner" ? ["admin", "owner"] : ["sub"];
}

export const useUserStore = defineStore("pure-user", {
  state: () => ({
    username: "",
    nickname: "",
    roles: [] as string[]
  }),
  actions: {
    fill(user: DeskUser | null) {
      this.username = user?.username ?? "";
      this.nickname = user?.nickname ?? "";
      this.roles = user ? rolesOf(user.accountType) : [];
    }
  }
});

export function useUserStoreHook() {
  return useUserStore(store);
}
