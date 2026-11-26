<script setup lang="ts">
// 「账号管理」（旧网站叫协作中心）：负责人给团队里的人建登录账号、停用、重置密码、移除。
// 2026-11-26 壳子这边改了样子：底子照考试页的「清样纸」（views/exam/exam-shared.css），和旁边「我的团队」一样宽；
// 详情抽屉去掉了（里面的话行上都有），停用、重置密码、移除收进每行后面的「管理」菜单。
import { useCollaborationMock } from "@/features/collaboration/useCollaborationMock";
import { avatarText } from "@/utils/avatar";
import "../exam/exam-shared.css";

defineOptions({ name: "CollaborationCenter" });

const {
  canManageAccounts,
  currentUsername,
  visibleAccounts,
  accountStats,
  createDialogVisible,
  isLoadingAccounts,
  isSavingAccount,
  newAccount,
  openCreateAccount,
  createAccount,
  toggleAccountStatus,
  resetPassword,
  removeAccount,
  accountRoleLabel,
  accountStatusLabel
} = useCollaborationMock();

/** 每行「管理」菜单里点了哪一项 */
function onCommand(command: string, accountId: string) {
  if (command === "status") void toggleAccountStatus(accountId);
  else if (command === "password") void resetPassword(accountId);
  else if (command === "remove") void removeAccount(accountId);
}
</script>

<template>
  <div class="exam-page desk-panel accounts-page">
    <section class="exam-sheet team-sheet">
      <header class="exam-sheet-head">
        <div>
          <h1 class="exam-title">账号管理</h1>
          <div class="exam-subtitle">
            共 {{ accountStats.total }} 个账号<template v-if="accountStats.disabledTotal"
              >，{{ accountStats.disabledTotal }} 个停用</template
            >。停用、重置密码、移除：点每行后面的「管理」
          </div>
        </div>
        <div class="team-head-actions">
          <button
            v-if="canManageAccounts"
            class="exam-btn is-primary"
            type="button"
            data-do="new-account"
            @click="openCreateAccount"
          >
            新建子账号
          </button>
        </div>
      </header>

      <div v-if="isLoadingAccounts && visibleAccounts.length === 0" class="team-loading">
        <div v-for="n in 4" :key="n" class="exam-skeleton" />
      </div>
      <div v-else-if="visibleAccounts.length === 0" class="exam-empty">
        <div class="lead">还没有子账号</div>
        <div class="hint">邀请成员加入协作，共享团队配置与项目进度。</div>
        <button
          v-if="canManageAccounts"
          class="exam-btn is-primary is-small"
          type="button"
          @click="openCreateAccount"
        >
          新建子账号
        </button>
      </div>
      <template v-else>
        <div class="account-grid account-head" aria-hidden="true">
          <span>账号</span>
          <span>最近登录</span>
          <span>状态</span>
          <span />
        </div>
        <ul class="account-list">
          <li
            v-for="account in visibleAccounts"
            :key="account.id"
            class="account-grid account-row"
            :class="{ muted: account.status === 'disabled' }"
          >
            <div class="account-who">
              <span
                class="desk-avatar"
                :class="{ owner: account.role === 'owner' }"
                aria-hidden="true"
              >
                {{ avatarText(account.displayName) }}
              </span>
              <div class="account-text">
                <div class="account-name">
                  <strong>{{ account.displayName }}</strong>
                  <span v-if="account.role === 'owner'" class="exam-stamp is-vermilion">
                    {{ accountRoleLabel(account.role) }}
                  </span>
                  <span v-if="account.username === currentUsername" class="exam-stamp">
                    我
                  </span>
                </div>
                <div class="account-user">{{ account.username }}</div>
              </div>
            </div>
            <span class="account-seen" :class="{ never: account.lastActive === '尚未登录' }">
              {{ account.lastActive }}
            </span>
            <span class="account-status" :class="{ ok: account.status === 'active' }">
              <span v-if="account.status === 'disabled'" class="exam-stamp is-vermilion">
                {{ accountStatusLabel(account.status) }}
              </span>
              <template v-else>{{ accountStatusLabel(account.status) }}</template>
            </span>
            <span class="account-actions">
              <el-dropdown
                v-if="canManageAccounts && account.role === 'sub'"
                trigger="click"
                popper-class="account-menu"
                @command="(command: string) => onCommand(command, account.id)"
              >
                <button class="exam-link" type="button" data-do="account-menu">
                  管理 ▾
                </button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="status">
                      {{ account.status === "active" ? "停用账号" : "启用账号" }}
                    </el-dropdown-item>
                    <el-dropdown-item command="password">重置密码</el-dropdown-item>
                    <el-dropdown-item command="remove" divided class="is-danger">
                      移除账号
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </span>
          </li>
        </ul>
        <p v-if="canManageAccounts && accountStats.subTotal === 0" class="team-tip">
          还没有子账号：点右上角「新建子账号」，给团队里的人各建一个。
        </p>
      </template>
    </section>

    <el-dialog
      v-model="createDialogVisible"
      title="新建子账号"
      width="460px"
      class="desk-dialog create-account-dialog"
    >
      <el-form label-position="top" @submit.prevent="createAccount">
        <el-form-item label="成员名称">
          <el-input
            v-model="newAccount.displayName"
            name="nv8-subaccount-display"
            autocomplete="off"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            placeholder="例如：分镜助理"
          />
        </el-form-item>
        <el-form-item label="登录账号">
          <el-input
            v-model="newAccount.username"
            name="nv8-subaccount-handle"
            autocomplete="new-password"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            placeholder="例如：shot_assistant"
          />
        </el-form-item>
        <el-form-item label="初始密码">
          <el-input
            v-model="newAccount.password"
            name="nv8-subaccount-secret"
            type="password"
            autocomplete="new-password"
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore="true"
            show-password
            placeholder="用于子账号首次登录"
          />
        </el-form-item>
      </el-form>
      <p class="account-note">
        子账号继承主账号的团队配置；本地 Codex 和 GPT 由各账号自己维护。
      </p>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="isSavingAccount"
          data-do="create-account"
          @click="createAccount"
        >
          创建账号
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped src="./index.css"></style>
