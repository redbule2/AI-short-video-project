// 壳子自己的（不是照搬的）：「我的团队」这一页的数据和动作。
// 问服务器的次数：进页面读 1 次总览；点「刷新」读 1 次；每保存、删除一回发 1 次写，
// 写完照服务器回的那一条就地改，不再重读整份。
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { getCollaborationErrorMessage } from "@/api/collaboration";
import {
  createTeamDepartment,
  deleteTeamDepartment,
  getTeamOverview,
  saveTeamMemberPlacement,
  updateTeamDepartment,
  type TeamDepartment,
  type TeamMember,
  type TeamOverview
} from "@/api/team";
import { groupsOf, parentOptions } from "./teamTree";

/** 下拉框里「放在顶层」「不分部门」那一项的值（存的时候换成 null） */
export const TOP = "__top__";

export function useTeam() {
  const overview = ref<TeamOverview | null>(null);
  const loadState = ref<"loading" | "ready" | "error">("loading");
  const loadError = ref("");
  const saving = ref(false);

  /** 新建、修改部门的那个小窗：id 空着是新建 */
  const departmentForm = reactive({
    visible: false,
    id: "",
    name: "",
    parentId: TOP
  });
  /** 调部门、改职位的那个小窗 */
  const memberForm = reactive({
    visible: false,
    username: "",
    displayName: "",
    departmentId: TOP,
    title: ""
  });

  const canManage = computed(() => overview.value?.canManage ?? false);
  const departments = computed(() => overview.value?.departments ?? []);
  const members = computed(() => overview.value?.members ?? []);
  /** 一页摆完：一个部门一组，最后是还没分部门的 */
  const groups = computed(() => groupsOf(departments.value, members.value));
  const departmentChoices = computed(() =>
    parentOptions(departments.value, departmentForm.id || null)
  );
  const memberDepartmentChoices = computed(() =>
    parentOptions(departments.value, null).map(item => ({
      id: item.id,
      label: item.label
    }))
  );

  async function load() {
    loadState.value = "loading";
    try {
      overview.value = await getTeamOverview();
      loadState.value = "ready";
    } catch (error) {
      // 软件比后台新的时候（后台还没升级），这个接口还没有：说人话，别摆状态码
      const status = (error as { response?: { status?: number } })?.response
        ?.status;
      loadError.value =
        status === 404
          ? "服务器上还没有「我的团队」这个功能，要等后台升级。"
          : getCollaborationErrorMessage(error);
      loadState.value = "error";
    }
  }

  function openCreateDepartment() {
    if (!canManage.value) return;
    departmentForm.id = "";
    departmentForm.name = "";
    departmentForm.parentId = TOP;
    departmentForm.visible = true;
  }

  function openEditDepartment(department: TeamDepartment) {
    if (!canManage.value) return;
    departmentForm.id = department.id;
    departmentForm.name = department.name;
    departmentForm.parentId = department.parentId ?? TOP;
    departmentForm.visible = true;
  }

  async function saveDepartment() {
    const current = overview.value;
    if (!current || saving.value) return;
    const name = departmentForm.name.trim();
    if (!name) {
      ElMessage.warning("请填写部门名称");
      return;
    }

    const data = {
      name,
      parentId: departmentForm.parentId === TOP ? null : departmentForm.parentId
    };
    saving.value = true;
    try {
      if (departmentForm.id) {
        const saved = await updateTeamDepartment(departmentForm.id, data);
        current.departments = current.departments.map(item =>
          item.id === saved.id ? saved : item
        );
        ElMessage.success("部门已更新");
      } else {
        const created = await createTeamDepartment(data);
        current.departments = [...current.departments, created];
        ElMessage.success("部门已新建");
      }
      departmentForm.visible = false;
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    } finally {
      saving.value = false;
    }
  }

  async function removeDepartment(department: TeamDepartment) {
    const current = overview.value;
    if (!current || !canManage.value || saving.value) return;
    const inside = current.members.filter(
      member => member.departmentId === department.id
    ).length;
    try {
      await ElMessageBox.confirm(
        inside > 0
          ? `确认删除部门「${department.name}」？里面的 ${inside} 个人会变成「还没分部门」，人不会被删。`
          : `确认删除部门「${department.name}」？`,
        "删除部门",
        { confirmButtonText: "删除", cancelButtonText: "取消", type: "warning" }
      );
    } catch {
      return;
    }

    saving.value = true;
    try {
      await deleteTeamDepartment(department.id);
      current.departments = current.departments.filter(
        item => item.id !== department.id
      );
      current.members = current.members.map(member =>
        member.departmentId === department.id
          ? { ...member, departmentId: null }
          : member
      );
      ElMessage.success("部门已删除");
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    } finally {
      saving.value = false;
    }
  }

  function openMember(member: TeamMember) {
    if (!canManage.value) return;
    memberForm.username = member.username;
    memberForm.displayName = member.displayName;
    // 部门已经不在了的（别处删了），当成没分部门
    memberForm.departmentId =
      member.departmentId &&
      departments.value.some(item => item.id === member.departmentId)
        ? member.departmentId
        : TOP;
    memberForm.title = member.title;
    memberForm.visible = true;
  }

  async function saveMember() {
    const current = overview.value;
    if (!current || saving.value) return;
    saving.value = true;
    try {
      const saved = await saveTeamMemberPlacement(memberForm.username, {
        departmentId:
          memberForm.departmentId === TOP ? null : memberForm.departmentId,
        title: memberForm.title.trim()
      });
      current.members = current.members.map(member =>
        member.username === saved.username ? saved : member
      );
      memberForm.visible = false;
      ElMessage.success("已保存");
    } catch (error) {
      ElMessage.error(getCollaborationErrorMessage(error));
    } finally {
      saving.value = false;
    }
  }

  void load();

  return {
    TOP,
    overview,
    loadState,
    loadError,
    saving,
    departmentForm,
    memberForm,
    canManage,
    members,
    departments,
    groups,
    departmentChoices,
    memberDepartmentChoices,
    load,
    openCreateDepartment,
    openEditDepartment,
    saveDepartment,
    removeDepartment,
    openMember,
    saveMember
  };
}
