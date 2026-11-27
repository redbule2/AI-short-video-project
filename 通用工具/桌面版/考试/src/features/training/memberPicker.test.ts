// 「参加的人」的算法测试：按部门怎么摆、勾部门带上谁、搜名字怎么筛、默认勾谁、全选和清空各动谁。
import { describe, expect, it } from "vitest";
import type { TeamDepartment, TeamMember } from "@/api/team";
import { ALL, UNASSIGNED } from "@/features/team/teamTree";
import {
  GONE,
  MAX_MEMBERS,
  OWNER,
  clearableUsernames,
  defaultSelection,
  filterGroups,
  initiallyExpanded,
  personMatches,
  pickerGroups,
  selectableUsernames,
  setMany,
  tickOf
} from "./memberPicker";

const dept = (
  id: string,
  name: string,
  parentId: string | null = null,
  sort = 0
): TeamDepartment => ({ id, name, parentId, sort });

const member = (
  username: string,
  departmentId: string | null,
  overrides: Partial<TeamMember> = {}
): TeamMember => ({
  username,
  displayName: username,
  role: "sub",
  status: "active",
  departmentId,
  title: "",
  ...overrides
});

const departments = [
  dept("a", "编导部", null, 1),
  dept("a1", "一组", "a", 1),
  dept("b", "后期部", null, 2),
  dept("empty", "空部门", null, 3)
];
const members = [
  // 负责人挂在编导部：勾编导部也不该把他带上
  member("boss", "a", { role: "owner", displayName: "老板" }),
  member("amy", "a", { displayName: "小艾", title: "编导" }),
  member("bob", "a1", { displayName: "小博" }),
  member("cat", "b", { displayName: "小凯", title: "剪辑" }),
  member("dan", "b", { displayName: "小丹", status: "disabled" }),
  member("eve", "deleted-dept", { displayName: "小伊" })
];

describe("按部门一组组摆", () => {
  it("部门照上下级排、带层数；上级部门的人数连下级一起算；没人的部门不摆；负责人自己单摆一组", () => {
    const groups = pickerGroups(departments, members);
    expect(groups.map(group => [group.id, group.depth])).toEqual([
      ["a", 1],
      ["a1", 2],
      ["b", 1],
      [UNASSIGNED, 1],
      [OWNER, 1]
    ]);
    const a = groups[0];
    expect(a.people.map(person => person.username)).toEqual(["amy"]);
    expect([...a.allUsernames].sort()).toEqual(["amy", "bob"]);
    expect(groups[1].allUsernames).toEqual(["bob"]);
    // 同一个人只在一组里露面
    const shown = groups.flatMap(group => group.people.map(person => person.username));
    expect(shown.length).toBe(new Set(shown).size);
  });

  it("负责人不进部门那几组：勾他所在的部门不会顺手把他带上；他那一组就他一个", () => {
    const groups = pickerGroups(departments, members);
    expect(groups[0].allUsernames).not.toContain("boss");
    const owner = groups.at(-1)!;
    expect([owner.id, owner.name]).toEqual([OWNER, "负责人自己"]);
    expect(owner.people.map(person => [person.username, person.isOwner])).toEqual([
      ["boss", true]
    ]);
    expect(owner.allUsernames).toEqual(["boss"]);
  });

  it("停用的人不摆；部门被删掉的人、没分部门的人放「还没分部门」", () => {
    const groups = pickerGroups(departments, members);
    expect(groups[2].people.map(person => person.username)).toEqual(["cat"]);
    const loose = groups[3];
    expect(loose.name).toBe("还没分部门");
    expect(loose.people.map(person => person.username)).toEqual(["eve"]);
    expect(groups.flatMap(group => group.allUsernames)).not.toContain("dan");
  });

  it("一个部门都没有时成员整队一组，负责人照旧单摆", () => {
    const groups = pickerGroups([], members);
    expect(groups.map(group => [group.id, group.name])).toEqual([
      [ALL, "全部成员"],
      [OWNER, "负责人自己"]
    ]);
    expect(groups[0].people.map(person => person.username)).toEqual([
      "amy",
      "bob",
      "cat",
      "eve"
    ]);
    expect(pickerGroups([], [])).toEqual([]);
  });

  it("已经在名单里、但停用或离开团队的人单摆在最后一组，名字用排名表上的", () => {
    const groups = pickerGroups(departments, members, [
      { username: "amy", displayName: "小艾" },
      { username: "dan", displayName: "小丹" },
      { username: "left", displayName: "" }
    ]);
    const gone = groups.at(-1)!;
    expect([gone.id, gone.name]).toEqual([GONE, "已停用或已离开"]);
    expect(gone.people).toEqual([
      { username: "dan", displayName: "小丹", title: "", isOwner: false, gone: true },
      { username: "left", displayName: "left", title: "", isOwner: false, gone: true }
    ]);
    expect(gone.allUsernames).toEqual(["dan", "left"]);
    // 还在岗的不会跑到这一组
    expect(gone.allUsernames).not.toContain("amy");
  });
});

describe("勾和搜", () => {
  it("全勾、勾了一部分、一个没勾", () => {
    expect(tickOf(["amy", "bob"], new Set(["amy", "bob", "cat"]))).toBe("all");
    expect(tickOf(["amy", "bob"], new Set(["amy"]))).toBe("some");
    expect(tickOf(["amy", "bob"], new Set(["cat"]))).toBe("none");
    expect(tickOf([], new Set(["cat"]))).toBe("none");
  });

  it("一批人一起勾上或去掉，原来那份不动", () => {
    const before = new Set(["amy"]);
    const added = setMany(before, ["bob", "cat"], true);
    expect([...added].sort()).toEqual(["amy", "bob", "cat"]);
    expect([...setMany(added, ["amy", "cat", "nobody"], false)]).toEqual(["bob"]);
    expect([...before]).toEqual(["amy"]);
  });

  it("名字、账号、职位都能搜，不分大小写", () => {
    const amy = pickerGroups(departments, members)[0].people[0];
    expect(personMatches(amy, "")).toBe(true);
    expect(personMatches(amy, "艾")).toBe(true);
    expect(personMatches(amy, "AMY")).toBe(true);
    expect(personMatches(amy, "编导")).toBe(true);
    expect(personMatches(amy, "剪辑")).toBe(false);
  });

  it("搜名字时只留对得上的人，没人对得上的组不摆；勾上级部门只动搜出来的人", () => {
    const groups = pickerGroups(departments, members);
    expect(filterGroups(groups, "  ")).toBe(groups);

    const found = filterGroups(groups, "小博");
    expect(found.map(group => group.id)).toEqual(["a", "a1"]);
    // 上级部门自己没有搜到的人，但下级有：组还在，勾它只带上小博
    expect(found[0].people).toEqual([]);
    expect(found[0].allUsernames).toEqual(["bob"]);
    expect(found[1].people.map(person => person.username)).toEqual(["bob"]);

    expect(filterGroups(groups, "查无此人")).toEqual([]);
  });

  it("新建默认勾全体在岗成员，负责人自己和停用的人不勾", () => {
    expect(defaultSelection(members)).toEqual(["amy", "bob", "cat", "eve"]);
  });

  it("全选只带上全体成员：负责人自己、已停用或离开的不带；搜着的时候只带搜出来的", () => {
    const groups = pickerGroups(departments, members, [
      { username: "dan", displayName: "小丹" }
    ]);
    expect(selectableUsernames(groups).sort()).toEqual([
      "amy",
      "bob",
      "cat",
      "eve"
    ]);
    expect(selectableUsernames(filterGroups(groups, "小凯"))).toEqual(["cat"]);
    // 搜负责人的名字再点全选：也不会把他带上，要参加得自己点他
    expect(selectableUsernames(filterGroups(groups, "老板"))).toEqual([]);
  });

  it("清空去掉在岗的人（连负责人自己）；已停用或离开的不动——他们去掉了就加不回来", () => {
    const groups = pickerGroups(departments, members, [
      { username: "dan", displayName: "小丹" }
    ]);
    expect(clearableUsernames(groups).sort()).toEqual([
      "amy",
      "bob",
      "boss",
      "cat",
      "eve"
    ]);
    expect(clearableUsernames(groups)).not.toContain("dan");
  });

  it("一打开：人少全摊开；部门多人多时部门先收起，负责人和已离开的两组照旧摊开；只有一组时不收", () => {
    const small = pickerGroups(departments, members);
    expect(initiallyExpanded(small)).toEqual(small.map(group => group.id));

    const crowd = [
      ...members,
      ...Array.from({ length: 25 }, (_, index) => member(`u${index}`, "a"))
    ];
    const big = pickerGroups(departments, crowd, [
      { username: "dan", displayName: "小丹" }
    ]);
    expect(initiallyExpanded(big)).toEqual([OWNER, GONE]);

    // 团队没设部门：成员就一组，收起来等于什么都看不见，所以摊开
    const flat = pickerGroups([], crowd);
    expect(initiallyExpanded(flat)).toEqual([ALL, OWNER]);
    expect(MAX_MEMBERS).toBe(200);
  });
});
