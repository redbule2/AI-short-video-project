// 壳子自己的（不是照搬的）：有哪几页、菜单摆哪几页、谁能进。旧项目的路由还管登录、动态菜单，这里只留考试、团队这几页。
// 各页的地址、名字、谁能进（roles）、缓不缓存（keepAlive）照旧项目 router/modules/exam.ts、collaboration.ts，没动；
// 这里自己的：多了「我的团队」一页（/team，人人能进）、「消息」一页（/chat，人人能进）；协作中心在菜单里改叫「账号管理」。
// 桌面软件左边菜单里「考试」「我的团队」「消息」各是一项，开的是同一份页面、各进各的首页，顶上那排菜单也各摆各的；
// 「消息」只有它一页，顶上不摆那一排（meta.bare），整页给聊天。
import type { RouteRecordRaw } from "vue-router";

export const HOME = "/exam/my";
/** 「我的团队」那一项打开时进的页 */
export const TEAM_HOME = "/team";
/** 「消息」那一项打开时进的页 */
export const CHAT_HOME = "/chat";

export const routes: RouteRecordRaw[] = [
  { path: "/", redirect: HOME },
  { path: "/exam", redirect: HOME },
  {
    path: "/exam/papers",
    name: "ExamPapers",
    component: () => import("@/views/exam/papers/index.vue"),
    meta: { title: "试卷管理", roles: ["admin", "owner"], keepAlive: true }
  },
  {
    path: "/exam/results",
    name: "ExamResults",
    component: () => import("@/views/exam/results/index.vue"),
    meta: { title: "成绩总览", keepAlive: true }
  },
  {
    path: "/exam/manual-grading-tasks",
    name: "ExamManualGradingTasks",
    component: () => import("@/views/exam/manual-grading-tasks/index.vue"),
    meta: { title: "我的阅卷", roles: ["sub"], keepAlive: true }
  },
  {
    path: "/exam/my",
    name: "ExamMy",
    component: () => import("@/views/exam/my/index.vue"),
    meta: { title: "我的考试", keepAlive: true }
  },
  {
    path: "/exam/paper-edit",
    name: "ExamPaperEdit",
    component: () => import("@/views/exam/paper-edit/index.vue"),
    meta: { title: "出题工作台", roles: ["admin", "owner"], keepAlive: true }
  },
  {
    path: "/exam/take",
    name: "ExamTake",
    component: () => import("@/views/exam/take/index.vue"),
    meta: { title: "答题", keepAlive: false }
  },
  {
    path: "/exam/review",
    name: "ExamReview",
    component: () => import("@/views/exam/review/index.vue"),
    meta: { title: "考试复盘", keepAlive: true }
  },
  {
    path: "/exam/manual-grading-assignments",
    name: "ExamManualGradingAssignments",
    component: () =>
      import("@/views/exam/manual-grading-assignments/index.vue"),
    meta: { title: "阅卷安排", roles: ["admin", "owner"], keepAlive: false }
  },
  {
    path: "/exam/manual-grading",
    name: "ExamManualGrading",
    component: () => import("@/views/exam/manual-grading/index.vue"),
    meta: { title: "人工阅卷", roles: ["admin", "owner", "sub"], keepAlive: false }
  },
  {
    path: "/team",
    name: "MyTeam",
    component: () => import("@/views/team/index.vue"),
    meta: { title: "我的团队", keepAlive: true }
  },
  {
    path: "/collaboration",
    name: "CollaborationCenter",
    component: () => import("@/views/collaboration/index.vue"),
    meta: { title: "账号管理", roles: ["admin", "owner"], keepAlive: true }
  },
  {
    path: CHAT_HOME,
    name: "TeamChat",
    component: () => import("@/views/chat/index.vue"),
    meta: { title: "消息", keepAlive: true, bare: true }
  },
  { path: "/:rest(.*)*", redirect: HOME }
];

/** 「考试」顶上那排菜单摆哪几页（旧网站侧边栏里摆出来的那几项，顺序照旧）。 */
export const MENU = [
  "/exam/papers",
  "/exam/results",
  "/exam/manual-grading-tasks",
  "/exam/my"
];

/** 「我的团队」顶上那排：人人看得到「我的团队」，「账号管理」（建账号、停用、重置密码）只有负责人有。 */
export const TEAM_MENU = [TEAM_HOME, "/collaboration"];

/** 壳子左边菜单里没有单独的「我的团队」时（老壳子配上了新页面）：两排并成一排，团队那两页接在考试后面，不然没处进。
 *  「消息」不往里并：老壳子不在后台收新消息，这一页在它里面不好用。 */
export const ALL_MENU = [...MENU, ...TEAM_MENU];

/** 壳子左边菜单里有没有单独的「我的团队」一项：main.ts 开头问壳子（desk.info().menus），问不到就当没有。 */
let teamMenuSplit = false;
export function setTeamMenuSplit(value: boolean) {
  teamMenuSplit = value;
}

/** 这一页是不是「我的团队」那一项里的 */
export function isTeamPath(path: string) {
  return TEAM_MENU.includes(path);
}

/** 现在这一页，顶上该摆哪一排 */
export function menuOf(path: string) {
  if (!teamMenuSplit) return ALL_MENU;
  return isTeamPath(path) ? TEAM_MENU : MENU;
}

/** 这一页进不去时退回哪：在哪一项里就回哪一项的首页 */
export function homeOf(path: string) {
  return teamMenuSplit && isTeamPath(path) ? TEAM_HOME : HOME;
}

/** 这一页这个人能不能进：没写 roles 的谁都能进。 */
export function allowed(roles: unknown, mine: string[]) {
  return !Array.isArray(roles) || roles.some(role => mine.includes(role));
}

/** 要缓存的页（切走不重来），名字 = 各页 defineOptions 里的 name。 */
export const cachedPages = routes
  .filter(route => route.meta?.keepAlive)
  .map(route => String(route.name));
