// 壳子自己的（不是照搬的）：「我的团队」部门树算法的测试。
import { describe, expect, it } from "vitest";
import type { TeamDepartment, TeamMember } from "@/api/team";
import {
  ALL,
  MAX_DEPTH,
  UNASSIGNED,
  childrenOf,
  flattenTree,
  groupsOf,
  heightOf,
  parentOptions,
  pathOf,
  withDescendants
} from "./teamTree";

const dept = (
  id: string,
  name: string,
  parentId: string | null = null,
  sort = 0
): TeamDepartment => ({ id, name, parentId, sort });

const member = (
  username: string,
  departmentId: string | null = null,
  role: "owner" | "sub" = "sub"
): TeamMember => ({
  username,
  displayName: username,
  role,
  status: "active",
  departmentId,
  title: ""
});

// 编导组 ─ 一组 ─ 外拍；拍摄组；后期组（排序：编导 1、拍摄 2、后期 3）
const departments = [
  dept("post", "后期组", null, 3),
  dept("plan", "编导组", null, 1),
  dept("shoot", "拍摄组", null, 2),
  dept("team1", "一组", "plan", 1),
  dept("out", "外拍", "team1", 1)
];

const members = [
  member("m1", "plan"),
  member("m2", "team1"),
  member("m3", "out"),
  member("boss", "post", "owner"),
  member("m4", null),
  member("m5", "deleted-dept")
];

describe("部门树", () => {
  it("照上下级一行行排，同级按排序", () => {
    expect(flattenTree(departments)).toEqual([
      { id: "plan", name: "编导组", depth: 1 },
      { id: "team1", name: "一组", depth: 2 },
      { id: "out", name: "外拍", depth: 3 },
      { id: "shoot", name: "拍摄组", depth: 1 },
      { id: "post", name: "后期组", depth: 1 }
    ]);
    expect(flattenTree([])).toEqual([]);
  });

  it("同级排序一样时按名字排，先后不乱跳", () => {
    const same = [dept("b", "乙"), dept("a", "甲")];
    expect(childrenOf(same, null).map(item => item.id)).toEqual(
      [...same].sort((x, y) => x.name.localeCompare(y.name, "zh-CN")).map(item => item.id)
    );
  });

  it("上级不在了的部门当顶层摆出来，不丢", () => {
    const broken = [dept("a", "甲"), dept("b", "乙", "gone")];
    expect(flattenTree(broken).map(row => [row.id, row.depth])).toEqual([
      ["a", 1],
      ["b", 1]
    ]);
    expect(pathOf(broken, "b")).toBe("乙");
  });

  it("下面还有几层、连下级的 id", () => {
    expect([heightOf(departments, "plan"), heightOf(departments, "out")]).toEqual([2, 0]);
    expect([...withDescendants(departments, "plan")].sort()).toEqual(["out", "plan", "team1"]);
    expect([...withDescendants(departments, "shoot")]).toEqual(["shoot"]);
  });

  it("一路写下来的部门名", () => {
    expect(pathOf(departments, "out")).toBe("编导组 / 一组 / 外拍");
    expect(pathOf(departments, "post")).toBe("后期组");
    expect(pathOf(departments, null)).toBe("");
    expect(pathOf(departments, "deleted-dept")).toBe("");
  });
});

describe("一页摆完：一个部门一组", () => {
  const view = (list: ReturnType<typeof groupsOf>) =>
    list.map(group => [group.id, group.name, group.parentPath, group.hasChildren, group.members.map(item => item.username)]);

  it("照上下级一组组排，只摆直接在这个部门的人；没填部门的、部门被删掉的归到最后「还没分部门」", () => {
    expect(view(groupsOf(departments, members))).toEqual([
      ["plan", "编导组", "", true, ["m1"]],
      ["team1", "一组", "编导组", true, ["m2"]],
      ["out", "外拍", "编导组 / 一组", false, ["m3"]],
      ["shoot", "拍摄组", "", false, []],
      ["post", "后期组", "", false, ["boss"]],
      [UNASSIGNED, "还没分部门", "", false, ["m4", "m5"]]
    ]);
  });

  it("人人都分好了：不摆「还没分部门」", () => {
    const placed = members.filter(item => item.departmentId && item.departmentId !== "deleted-dept");
    expect(groupsOf(departments, placed).some(group => group.id === UNASSIGNED)).toBe(false);
  });

  it("一个部门都没有：整队一组、不摆组名，负责人排最前", () => {
    expect(view(groupsOf([], members))).toEqual([
      [ALL, "", "", false, ["boss", "m1", "m2", "m3", "m4", "m5"]]
    ]);
  });

  it("部门绕成了圈（数据坏了，摆不出来）：里面的人也不丢，归到「还没分部门」", () => {
    const loop = [dept("a", "甲", "b"), dept("b", "乙", "a")];
    const list = groupsOf(loop, [member("x", "a"), member("y", null)]);
    expect(view(list)).toEqual([[UNASSIGNED, "还没分部门", "", false, ["x", "y"]]]);
  });
});

describe("挑上级部门", () => {
  const options = (movingId: string | null) =>
    parentOptions(departments, movingId).map(item => [item.id, item.disabled]);

  it("新建：哪个都能挑，名字按层缩进", () => {
    expect(options(null).every(([, disabled]) => disabled === false)).toBe(true);
    expect(parentOptions(departments, null).map(item => item.label)).toEqual([
      "编导组",
      "　一组",
      "　　外拍",
      "拍摄组",
      "后期组"
    ]);
  });

  it("移动：不能放到自己和自己的下级下面", () => {
    expect(options("plan")).toEqual([
      ["plan", true],
      ["team1", true],
      ["out", true],
      ["shoot", false],
      ["post", false]
    ]);
  });

  it("放过去会超过最多层数的不让挑（连它带着的下级一起算）", () => {
    // 一条 5 层的链 c1…c5，另有带着两层下级的 t1 → t2 → t3
    const chain = Array.from({ length: MAX_DEPTH }, (_, index) =>
      dept(`c${index + 1}`, `链${index + 1}`, index === 0 ? null : `c${index}`)
    );
    const all = [...chain, dept("t1", "甲"), dept("t2", "乙", "t1"), dept("t3", "丙", "t2")];
    const pick = (movingId: string | null) =>
      Object.fromEntries(parentOptions(all, movingId).map(item => [item.id, item.disabled]));

    // 新建：第 5 层下面不能再建
    expect([pick(null).c4, pick(null).c5]).toEqual([false, true]);
    // t1 自己带 2 层下级：最深只能放到第 2 层的部门下面（2 + 1 + 2 = 5）
    expect([pick("t1").c2, pick("t1").c3]).toEqual([false, true]);
    // 没有下级的 t3 可以放到第 4 层下面
    expect([pick("t3").c4, pick("t3").c5]).toEqual([false, true]);
  });
});
