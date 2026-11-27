// 这里新写的（旧网站没有）：「参加的人」怎么按部门摆、勾部门怎么带上整个部门、搜名字怎么筛——不碰界面、不问服务器。
// 部门树的算法用「我的团队」现成的（features/team/teamTree）。
import type { TeamDepartment, TeamMember } from "@/api/team";
import {
  ALL,
  UNASSIGNED,
  flattenTree,
  withDescendants
} from "@/features/team/teamTree";

/** 一次培训最多几个人：和后台 ExamTrainingRules.MaxMembersPerTraining 一样 */
export const MAX_MEMBERS = 200;

/** 还在培训名单里、但已经停用或离开团队的人，单摆一组 */
export const GONE = "__gone__";

/** 负责人自己单摆一组：默认不参加，「全选」、勾部门都不会把他带上，要参加自己勾 */
export const OWNER = "__owner__";

export interface PickerPerson {
  username: string;
  displayName: string;
  /** 职位；没填是空串 */
  title: string;
  isOwner: boolean;
  /** 已停用或已离开团队：只能留着或去掉，去掉了就加不回来 */
  gone: boolean;
}

export interface PickerGroup {
  /** 部门的 id；没有部门时整队一组是 ALL；还没分部门的是 UNASSIGNED；负责人自己是 OWNER；已停用或离开的是 GONE */
  id: string;
  name: string;
  /** 顶层是 1 */
  depth: number;
  /** 直接在这一组的人（下级部门的人摆在下级那一组） */
  people: PickerPerson[];
  /** 这一组连下面小部门所有人的账号：勾组名时一起勾 */
  allUsernames: string[];
}

/** 已经在培训里的人：账号和排名表上的名字 */
export interface KeptMember {
  username: string;
  displayName: string;
}

const personOf = (member: TeamMember): PickerPerson => ({
  username: member.username,
  displayName: member.displayName || member.username,
  title: member.title ?? "",
  isOwner: member.role === "owner",
  gone: false
});

const byName = (a: PickerPerson, b: PickerPerson) =>
  Number(b.isOwner) - Number(a.isOwner) ||
  a.displayName.localeCompare(b.displayName, "zh-CN");

/**
 * 「参加的人」一组组摆好：部门照上下级排，再是还没分部门的，然后是负责人自己，最后是已停用或离开、但还在名单里的。
 * 一个部门都没有时整队一组。停用的人不摆（已经在名单里的除外）。
 * 负责人不进部门那几组：他默认不参加，勾部门、点「全选」都不该顺手把他带上。
 */
export function pickerGroups(
  departments: TeamDepartment[],
  members: TeamMember[],
  kept: KeptMember[] = []
): PickerGroup[] {
  const everyone = members.filter(member => member.status === "active");
  const activeNames = new Set(everyone.map(member => member.username));
  const owners = everyone.filter(member => member.role === "owner");
  const active = everyone.filter(member => member.role !== "owner");
  const groups: PickerGroup[] = [];

  if (departments.length === 0) {
    if (active.length > 0) {
      groups.push({
        id: ALL,
        name: "全部成员",
        depth: 1,
        people: active.map(personOf).sort(byName),
        allUsernames: active.map(member => member.username)
      });
    }
  } else {
    const rows = flattenTree(departments);
    const shown = new Set(rows.map(row => row.id));
    for (const row of rows) {
      const subtree = withDescendants(departments, row.id);
      const under = active.filter(
        member => member.departmentId && subtree.has(member.departmentId)
      );
      // 这个部门连下级一个人都没有：不摆，省得一排空组
      if (under.length === 0) continue;
      groups.push({
        id: row.id,
        name: row.name,
        depth: row.depth,
        people: active
          .filter(member => member.departmentId === row.id)
          .map(personOf)
          .sort(byName),
        allUsernames: under.map(member => member.username)
      });
    }
    const loose = active.filter(
      member => !member.departmentId || !shown.has(member.departmentId)
    );
    if (loose.length > 0) {
      groups.push({
        id: UNASSIGNED,
        name: "还没分部门",
        depth: 1,
        people: loose.map(personOf).sort(byName),
        allUsernames: loose.map(member => member.username)
      });
    }
  }

  if (owners.length > 0) {
    groups.push({
      id: OWNER,
      name: "负责人自己",
      depth: 1,
      people: owners.map(personOf),
      allUsernames: owners.map(member => member.username)
    });
  }

  const gone = kept.filter(member => !activeNames.has(member.username));
  if (gone.length > 0) {
    groups.push({
      id: GONE,
      name: "已停用或已离开",
      depth: 1,
      people: gone.map(member => ({
        username: member.username,
        displayName: member.displayName || member.username,
        title: "",
        isOwner: false,
        gone: true
      })),
      allUsernames: gone.map(member => member.username)
    });
  }
  return groups;
}

export type Tick = "all" | "some" | "none";

/** 这一批人勾了几成：全勾、勾了一部分、一个没勾 */
export function tickOf(
  usernames: string[],
  selected: ReadonlySet<string>
): Tick {
  const picked = usernames.filter(username => selected.has(username)).length;
  if (picked === 0) return "none";
  return picked === usernames.length ? "all" : "some";
}

/** 一批人一起勾上或去掉，回一份新的 */
export function setMany(
  selected: ReadonlySet<string>,
  usernames: string[],
  on: boolean
) {
  const next = new Set(selected);
  for (const username of usernames) {
    if (on) next.add(username);
    else next.delete(username);
  }
  return next;
}

/** 名字、账号、职位里带这几个字（不分大小写） */
export function personMatches(person: PickerPerson, keyword: string) {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return true;
  return [person.displayName, person.username, person.title].some(text =>
    text.toLowerCase().includes(needle)
  );
}

/**
 * 搜名字时只留对得上的人、没人对得上的组不摆；这时勾组名只动眼前搜出来的这几个人。
 * 没打字就原样。
 */
export function filterGroups(groups: PickerGroup[], keyword: string) {
  if (!keyword.trim()) return groups;
  const hit = new Set(
    groups.flatMap(group =>
      group.people
        .filter(person => personMatches(person, keyword))
        .map(person => person.username)
    )
  );
  return groups
    .map(group => ({
      ...group,
      people: group.people.filter(person => hit.has(person.username)),
      allUsernames: group.allUsernames.filter(username => hit.has(username))
    }))
    .filter(group => group.allUsernames.length > 0);
}

/** 新建培训默认勾谁：全体在岗成员，负责人自己不勾（和发布试卷一个规矩） */
export function defaultSelection(members: TeamMember[]) {
  return members
    .filter(member => member.status === "active" && member.role === "sub")
    .map(member => member.username);
}

/** 是不是平常的组（部门、还没分部门、整队）：负责人自己、已停用或离开的两组不算 */
const isOrdinary = (group: PickerGroup) =>
  group.id !== OWNER && group.id !== GONE;

/** 「全选」勾哪些：眼前摆着的全体成员；负责人自己、已停用或离开的不会被带上 */
export function selectableUsernames(groups: PickerGroup[]) {
  const names = new Set<string>();
  for (const group of groups.filter(isOrdinary)) {
    for (const person of group.people) names.add(person.username);
  }
  return [...names];
}

/**
 * 「清空」去掉哪些：眼前摆着的还在岗的人（连负责人自己）。
 * 已停用或离开的不动——他们去掉了就加不回来，要去掉得自己一个个点。
 */
export function clearableUsernames(groups: PickerGroup[]) {
  const names = new Set<string>();
  for (const group of groups.filter(group => group.id !== GONE)) {
    for (const person of group.people) names.add(person.username);
  }
  return [...names];
}

/**
 * 一打开先摊开哪几组：人少（或只有一组）全摊开；部门多、人多时部门先收起，只看部门名和人数，点开才看人。
 * 负责人自己、已停用或离开的两组人少又要紧，一直摊开。
 */
export function initiallyExpanded(groups: PickerGroup[]) {
  const ordinary = groups.filter(isOrdinary);
  const people = ordinary.reduce((sum, group) => sum + group.people.length, 0);
  const collapse = ordinary.length > 1 && people > 24;
  return groups
    .filter(group => !collapse || !isOrdinary(group))
    .map(group => group.id);
}
