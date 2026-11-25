// 壳子自己的（不是照搬的）：把路由建起来。有哪几页在 pages.ts。
import { createRouter, createWebHashHistory } from "vue-router";
import { HOME, allowed, routes } from "./pages";
import { useUserStoreHook } from "@/store/modules/user";

const router = createRouter({ history: createWebHashHistory(), routes });

router.beforeEach(to =>
  allowed(to.meta.roles, useUserStoreHook().roles) ? true : HOME
);
router.afterEach(to => {
  document.title = String(to.meta.title || "考试");
});

export default router;
