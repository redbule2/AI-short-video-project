import { computed, nextTick, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  createSubAccount,
  getCollaborationErrorMessage,
  getCollaborationWorkspace,
  removeSubAccount,
  resetSubAccountPassword,
  updateSubAccountStatus,
  type TeamAccount
} from "@/api/collaboration";
import { accountRoleLabel, accountStatusLabel } from "./collaborationMock";

export function useCollaborationMock() {
  const accounts = ref<TeamAccount[]>([]);
  const currentUsername = ref("");
  const canManageAccounts = ref(false);
  const createDialogVisible = ref(false);
  const isLoadingAccounts = ref(false);
  const isSavingAccount = ref(false);

  const newAccount = reactive({
    displayName: "",
    username: "",
    password: ""
  });

  function resetNewAccount() {
    newAccount.displayName = "";
    newAccount.username = "";
    newAccount.password = "";
  }

  function clearNativeCreateInputs() {
    document
      .querySelectorAll<HTMLInputElement>(
        ".create-account-dialog .el-input__inner"
      )
      .forEach(input => {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
    resetNewAccount();
  }

  // 始终展示主账号及其名下的全部子账号，主账号置顶。
  const visibleAccounts = computed(() =>
    [...accounts.value].sort((a, b) => {
      if (a.role === b.role) return 0;
      return a.role === "owner" ? -1 : 1;
    })
  );

  const accountStats = computed(() => {
    const subAccounts = accounts.value.filter(item => item.role === "sub");
    const disabledAccounts = accounts.value.filter(
      item => item.status === "disabled"
    );

    return {
      total: accounts.value.length,
      subTotal: subAccounts.length,
      disabledTotal: disabledAccounts.length
    };
  });

  async function loadAccounts() {
    isLoadingAccounts.value = true;
    try {
      const workspace = await getCollaborationWorkspace();
      accounts.value = workspace.accounts;
      currentUsername.value = workspace.currentUsername;
      canManageAccounts.value = workspace.canManageAccounts;
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    } finally {
      isLoadingAccounts.value = false;
    }
  }

  async function openCreateAccount() {
    if (!canManageAccounts.value) {
      ElMessage.warning("只有主账号可以创建子账号");
      return;
    }

    resetNewAccount();
    createDialogVisible.value = true;
    await nextTick();
    window.setTimeout(clearNativeCreateInputs, 80);
  }

  async function createAccount() {
    if (!newAccount.displayName.trim()) {
      ElMessage.warning("请输入成员名称");
      return;
    }

    if (!newAccount.username.trim()) {
      ElMessage.warning("请输入登录账号");
      return;
    }

    if (!newAccount.password.trim()) {
      ElMessage.warning("请输入初始密码");
      return;
    }

    const username = newAccount.username.trim();
    if (
      accounts.value.some(
        item => item.username.toLowerCase() === username.toLowerCase()
      )
    ) {
      ElMessage.warning("登录账号已存在");
      return;
    }

    isSavingAccount.value = true;
    try {
      await createSubAccount({
        displayName: newAccount.displayName.trim(),
        username,
        password: newAccount.password
      });
      await loadAccounts();
      createDialogVisible.value = false;
      resetNewAccount();
      ElMessage.success("已创建子账号");
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    } finally {
      isSavingAccount.value = false;
    }
  }

  async function toggleAccountStatus(accountId: string) {
    if (!canManageAccounts.value) {
      ElMessage.warning("只有主账号可以调整账号状态");
      return;
    }

    const account = accounts.value.find(item => item.id === accountId);
    if (!account || account.role === "owner") {
      ElMessage.warning("主账号不可停用");
      return;
    }

    try {
      const nextStatus = account.status === "active" ? "disabled" : "active";
      const updated = await updateSubAccountStatus(
        account.username,
        nextStatus
      );
      accounts.value = accounts.value.map(item =>
        item.id === updated.id ? updated : item
      );
      ElMessage.success(
        nextStatus === "active" ? "子账号已启用" : "子账号已停用"
      );
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    }
  }

  async function resetPassword(accountId: string) {
    if (!canManageAccounts.value) {
      ElMessage.warning("只有主账号可以重置子账号密码");
      return;
    }

    const account = accounts.value.find(item => item.id === accountId);
    if (!account || account.role === "owner") {
      ElMessage.warning("主账号密码请在个人设置中修改");
      return;
    }

    // 一点就换掉密码、旧的马上作废：先问一句（以前藏在详情抽屉里，现在挪到每行的「管理」菜单里，离手更近）
    try {
      await ElMessageBox.confirm(
        `重置「${account.displayName}」的密码？旧密码马上不能用，新密码只显示这一次。`,
        "重置密码",
        {
          confirmButtonText: "重置",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }

    try {
      const result = await resetSubAccountPassword(account.username);
      await ElMessageBox.alert(
        `新密码：${result.password}`,
        `已重置 ${account.displayName} 的密码`,
        {
          confirmButtonText: "知道了",
          type: "success"
        }
      );
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    }
  }

  async function removeAccount(accountId: string) {
    if (!canManageAccounts.value) {
      ElMessage.warning("只有主账号可以移除子账号");
      return;
    }

    const account = accounts.value.find(item => item.id === accountId);
    if (!account || account.role === "owner") {
      ElMessage.warning("主账号不可移除");
      return;
    }

    try {
      await ElMessageBox.confirm(
        `确认移除子账号「${account.displayName}」？移除后该账号不可再登录，历史内容仍保留归属。`,
        "移除子账号",
        {
          confirmButtonText: "移除",
          cancelButtonText: "取消",
          type: "warning"
        }
      );
    } catch {
      return;
    }

    try {
      await removeSubAccount(account.username);
      accounts.value = accounts.value.filter(item => item.id !== accountId);
      ElMessage.success("已移除子账号");
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    }
  }

  void loadAccounts();

  return {
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
  };
}
