// 壳子自己的（不是照搬的）：「我的团队」里和部门树有关的算法，不碰界面、不问服务器。
import type { TeamDepartment, TeamMember } from "@/api/team";

/** 两组不是部门的：一个部门都没有时整队一组（ALL）；还没分部门的人（UNASSIGNED） */
export const ALL = "__all__";
export const UNASSIGNED = "__unassigned__";

/** 部门最多分几层：和后台 TeamStructureRules.MaxDepartmentDepth 一样 */
export const MAX_DEPTH = 5;

export interface TreeRow {
  id: string;
  name: string;
  /** 顶层是 1 */
  depth: number;
}

const byOrder = (a: TeamDepartment, b: TeamDepartment) =>
  a.sort - b.sort || a.name.localeCompare(b.name, "zh-CN");

/** 上级还在不在：上级被删、数据对不上的，当顶层摆出来，不让它丢 */
function parentOf(departments: TeamDepartment[], item: TeamDepartment) {
  return item.parentId && departments.some(d => d.id === item.parentId)
    ? item.parentId
    : null;
}

export function childrenOf(
  departments: TeamDepartment[],
  parentId: string | null
) {
  return departments
    .filter(item => parentOf(departments, item) === parentId)
    .sort(byOrder);
}

/** 这个部门自己和它下面所有部门的 id */
export function withDescendants(departments: TeamDepartment[], id: string) {
  const found = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of departments) {
      if (item.parentId && found.has(item.parentId) && !found.has(item.id)) {
        found.add(item.id);
        grew = true;
      }
    }
  }
  return found;
}

/** 下面还有几层：没有下级是 0 */
export function heightOf(departments: TeamDepartment[], id: string) {
  let height = 0;
  let level = [id];
  while (height <= departments.length) {
    const next = departments
      .filter(item => item.parentId && level.includes(item.parentId))
      .map(item => item.id);
    if (next.length === 0) break;
    height += 1;
    level = next;
  }
  return height;
}

/** 部门照上下级一行行排好，带层数 */
export function flattenTree(departments: TeamDepartment[]): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth > departments.length) return;
    for (const item of childrenOf(departments, parentId)) {
      rows.push({ id: item.id, name: item.name, depth });
      walk(item.id, depth + 1);
    }
  };
  walk(null, 1);
  return rows;
}

/** 「拍摄组 / 外拍小队」这样一路写下来；没分部门回空串 */
export function pathOf(departments: TeamDepartment[], id: string | null) {
  const names: string[] = [];
  let cursor = id;
  while (cursor && names.length <= departments.length) {
    const current = departments.find(item => item.id === cursor);
    if (!current) break;
    names.unshift(current.name);
    cursor = parentOf(departments, current);
  }
  return names.join(" / ");
}

export interface TeamGroup {
  /** 部门的 id；整队一组是 ALL，还没分部门的是 UNASSIGNED */
  id: string;
  /** 是部门的才有（改名、删除用） */
  department: TeamDepartment | null;
  /** 组名；整队一组时空着，不摆组名 */
  name: string;
  /** 上级部门一路写下来（「拍摄组」）；顶层的空着 */
  parentPath: string;
  /** 下面还有部门：自己这一级没人时不说「还没有人」 */
  hasChildren: boolean;
  /** 直接在这一组的人（下级部门的人在下级那一组），负责人排最前 */
  members: TeamMember[];
}

/** 「我的团队」一页摆完：部门照上下级一组组排，最后是还没分部门的；一个部门都没有时整队一组 */
export function groupsOf(
  departments: TeamDepartment[],
  members: TeamMember[]
): TeamGroup[] {
  const ownerFirst = (list: TeamMember[]) =>
    [...list].sort(
      (a, b) => Number(b.role === "owner") - Number(a.role === "owner")
    );
  if (departments.length === 0) {
    return [
      {
        id: ALL,
        department: null,
        name: "",
        parentPath: "",
        hasChildren: false,
        members: ownerFirst(members)
      }
    ];
  }
  const rows = flattenTree(departments);
  const groups: TeamGroup[] = rows.map(row => {
    const department = departments.find(item => item.id === row.id)!;
    return {
      id: row.id,
      department,
      name: row.name,
      parentPath: pathOf(departments, parentOf(departments, department)),
      hasChildren: childrenOf(departments, row.id).length > 0,
      members: ownerFirst(
        members.filter(member => member.departmentId === row.id)
      )
    };
  });
  // 没填部门的、部门已经被删掉（或数据对不上、摆不出来）的，都算还没分部门：一个人也不能丢
  const shown = new Set(rows.map(row => row.id));
  const loose = members.filter(
    member => !member.departmentId || !shown.has(member.departmentId)
  );
  if (loose.length > 0) {
    groups.push({
      id: UNASSIGNED,
      department: null,
      name: "还没分部门",
      parentPath: "",
      hasChildren: false,
      members: ownerFirst(loose)
    });
  }
  return groups;
}

export interface ParentOption {
  id: string;
  /** 带缩进的名字 */
  label: string;
  /** 放不得：是它自己、它的下级，或者放过去就超层了 */
  disabled: boolean;
}

/** 「上级部门」能挑哪些。movingId 是正在改的那个部门；新建时给 null */
export function parentOptions(
  departments: TeamDepartment[],
  movingId: string | null
): ParentOption[] {
  const blocked = movingId
    ? withDescendants(departments, movingId)
    : new Set<string>();
  const carried = movingId ? heightOf(departments, movingId) : 0;
  return flattenTree(departments).map(row => ({
    id: row.id,
    label: `${"　".repeat(row.depth - 1)}${row.name}`,
    disabled: blocked.has(row.id) || row.depth + 1 + carried > MAX_DEPTH
  }));
}
