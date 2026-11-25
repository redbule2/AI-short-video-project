// 壳子自己的（不是照搬的）：有哪几页、菜单摆哪几页、谁能进。旧项目的路由还管登录、动态菜单，这里只留考试、团队这几页。
// 各页的地址、名字、谁能进（roles）、缓不缓存（keepAlive）照旧项目 router/modules/exam.ts、collaboration.ts，没动。
import type { RouteRecordRaw } from "vue-router";

export const HOME = "/exam/my";

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
    path: "/collaboration",
    name: "CollaborationCenter",
    component: () => import("@/views/collaboration/index.vue"),
    meta: { title: "协作中心", roles: ["admin", "owner"], keepAlive: true }
  },
  { path: "/:rest(.*)*", redirect: HOME }
];

/** 顶上那排菜单摆哪几页（旧网站侧边栏里摆出来的那几项，顺序照旧）。 */
export const MENU = [
  "/exam/papers",
  "/exam/results",
  "/exam/manual-grading-tasks",
  "/exam/my",
  "/collaboration"
];

/** 这一页这个人能不能进：没写 roles 的谁都能进。 */
export function allowed(roles: unknown, mine: string[]) {
  return !Array.isArray(roles) || roles.some(role => mine.includes(role));
}

/** 要缓存的页（切走不重来），名字 = 各页 defineOptions 里的 name。 */
export const cachedPages = routes
  .filter(route => route.meta?.keepAlive)
  .map(route => String(route.name));
