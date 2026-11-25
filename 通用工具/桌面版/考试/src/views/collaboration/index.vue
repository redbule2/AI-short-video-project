<script setup lang="ts">
import Connection from "~icons/ep/connection";
import Delete from "~icons/ep/delete";
import Key from "~icons/ep/key";
import Lock from "~icons/ep/lock";
import Plus from "~icons/ep/plus";
import UserFilled from "~icons/ep/user-filled";
import View from "~icons/ep/view";
import { useCollaborationMock } from "@/features/collaboration/useCollaborationMock";

defineOptions({ name: "CollaborationCenter" });

const {
  canManageAccounts,
  visibleAccounts,
  selectedAccount,
  accountStats,
  drawerVisible,
  createDialogVisible,
  isLoadingAccounts,
  isSavingAccount,
  newAccount,
  openAccount,
  openCreateAccount,
  createAccount,
  toggleAccountStatus,
  resetPassword,
  removeAccount,
  accountRoleLabel,
  accountStatusLabel
} = useCollaborationMock();
</script>

<template>
  <section class="collab-page">
    <header class="collab-topbar">
      <div class="title-block">
        <span class="brand-mark">
          <Connection />
        </span>
        <div class="title-text">
          <h1>协作中心</h1>
          <span>管理主账号与团队子账号的登录权限</span>
        </div>
      </div>

      <div class="top-actions">
        <button
          v-if="canManageAccounts"
          class="primary-action"
          type="button"
          @click="openCreateAccount"
        >
          <Plus />
          新子账号
        </button>
      </div>
    </header>

    <main class="collab-shell">
      <section class="surface-panel">
        <div class="surface-head">
          <div class="surface-head-main">
            <h2>团队账号</h2>
            <div class="stat-chips">
              <span class="stat-chip">共 {{ accountStats.total }}</span>
              <span class="stat-chip">子账号 {{ accountStats.subTotal }}</span>
              <span
                class="stat-chip"
                :class="{ alert: accountStats.disabledTotal > 0 }"
              >
                停用 {{ accountStats.disabledTotal }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="isLoadingAccounts" class="simple-empty">
          <span>加载账号中…</span>
        </div>
        <div
          v-else-if="visibleAccounts.length === 0"
          class="simple-empty empty-cta"
        >
          <strong>还没有子账号</strong>
          <p>邀请成员加入协作，共享团队配置与项目进度。</p>
          <button
            v-if="canManageAccounts"
            class="primary-action"
            type="button"
            @click="openCreateAccount"
          >
            <Plus />
            新建子账号
          </button>
        </div>
        <template v-else>
          <div class="list-head" aria-hidden="true">
            <span>账号</span>
            <span>角色</span>
            <span>最近活跃</span>
            <span>状态</span>
            <span />
          </div>
          <div class="simple-list account-list">
            <article
              v-for="account in visibleAccounts"
              :key="account.id"
              class="simple-row account-row"
              :class="{ muted: account.status === 'disabled' }"
            >
              <button
                class="row-identity"
                type="button"
                @click="openAccount(account.id)"
              >
                <span class="avatar">{{
                  account.displayName.slice(0, 1)
                }}</span>
                <span>
                  <strong>{{ account.displayName }}</strong>
                  <small>{{ account.username }}</small>
                </span>
              </button>

              <span class="role-text">{{
                accountRoleLabel(account.role)
              }}</span>
              <span class="access-text">{{ account.lastActive }}</span>
              <span class="status-pill" :class="account.status">
                {{ accountStatusLabel(account.status) }}
              </span>
              <button
                class="text-action compact"
                type="button"
                @click="openAccount(account.id)"
              >
                <View />
                详情
              </button>
            </article>
          </div>
        </template>
      </section>
    </main>

    <el-drawer
      v-model="drawerVisible"
      direction="rtl"
      size="460px"
      class="collab-drawer"
    >
      <template #header>
        <div class="drawer-title">账号详情</div>
      </template>

      <el-scrollbar class="drawer-scroll">
        <section class="drawer-section">
          <div class="detail-hero">
            <span class="avatar large">{{
              selectedAccount.displayName.slice(0, 1)
            }}</span>
            <div>
              <h3>{{ selectedAccount.displayName }}</h3>
              <p>
                {{ accountRoleLabel(selectedAccount.role) }} ·
                {{ selectedAccount.username }}
              </p>
            </div>
          </div>

          <div class="detail-list">
            <div>
              <span>状态</span>
              <strong>{{ accountStatusLabel(selectedAccount.status) }}</strong>
            </div>
            <div>
              <span>最后活跃</span>
              <strong>{{ selectedAccount.lastActive }}</strong>
            </div>
            <div>
              <span>权限说明</span>
              <strong>{{ selectedAccount.permissionNote }}</strong>
            </div>
          </div>

          <div v-if="selectedAccount.role === 'sub'" class="drawer-actions">
            <button
              class="text-action"
              type="button"
              :disabled="!canManageAccounts"
              @click="toggleAccountStatus(selectedAccount.id)"
            >
              <Lock />
              {{
                selectedAccount.status === "active" ? "停用账号" : "启用账号"
              }}
            </button>
            <button
              class="text-action"
              type="button"
              :disabled="!canManageAccounts"
              @click="resetPassword(selectedAccount.id)"
            >
              <Key />
              重置密码
            </button>
            <button
              class="text-action danger"
              type="button"
              :disabled="!canManageAccounts"
              @click="removeAccount(selectedAccount.id)"
            >
              <Delete />
              移除账号
            </button>
          </div>
        </section>
      </el-scrollbar>
    </el-drawer>

    <el-dialog
      v-model="createDialogVisible"
      width="520px"
      class="collab-dialog create-account-dialog"
      :show-close="false"
    >
      <div class="create-dialog-shell">
        <header class="create-dialog-head">
          <div>
            <p>NEW SUB ACCOUNT</p>
            <h2>新建子账号</h2>
          </div>
          <span class="dialog-mark">
            <UserFilled />
            子账号
          </span>
        </header>

        <div class="create-dialog-body">
          <div class="field-stack">
            <label>
              <span>成员名称</span>
              <el-input
                v-model="newAccount.displayName"
                name="nv8-subaccount-display"
                autocomplete="off"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="例如：分镜助理"
              />
            </label>
            <label>
              <span>登录账号</span>
              <el-input
                v-model="newAccount.username"
                name="nv8-subaccount-handle"
                autocomplete="new-password"
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="例如：shot_assistant"
              />
            </label>
            <label>
              <span>初始密码</span>
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
            </label>
          </div>

          <aside class="dialog-note">
            <strong>权限边界</strong>
            <p>
              子账号继承主账号的团队配置；本地 Codex 和 GPT 由各账号自己维护。
            </p>
          </aside>
        </div>

        <footer class="create-dialog-footer">
          <button
            class="text-action"
            type="button"
            @click="createDialogVisible = false"
          >
            取消
          </button>
          <button
            class="primary-action"
            type="button"
            :disabled="isSavingAccount"
            @click="createAccount"
          >
            <Plus />
            {{ isSavingAccount ? "创建中" : "创建账号" }}
          </button>
        </footer>
      </div>
    </el-dialog>
  </section>
</template>

<style scoped src="./index.css"></style>
