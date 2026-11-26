// 壳子自己的（不是照搬的）：考试、团队页的入口。全局样式的先后照旧项目 main.ts。
import { createApp } from "vue";
import ElementPlus from "element-plus";
import App from "./App.vue";
import router from "./router";
import { setTeamMenuSplit } from "./pages";
import { setupStore } from "@/store";
import { useUserStoreHook, type DeskUser } from "@/store/modules/user";

import "./style/reset.css";
import "./style/element-plus.css";
import "element-plus/dist/index.css";
import "./style/皮肤.css";   // 颜色跟着桌面版的皮肤走：接在 Element Plus 后面，才压得住它的默认色
import "./style/shell.css";
import "./style/panel.css";

type Desk = {
  info?: () => Promise<{ user: DeskUser | null; menus?: unknown } | null>;
};

async function start() {
  const app = createApp(App);
  setupStore(app);
  const desk = (window as unknown as { desk?: Desk }).desk;
  const info = desk?.info ? await desk.info() : null;
  useUserStoreHook().fill(info?.user ?? null);
  // 壳子左边菜单里有「我的团队」一项的，顶上分两排各摆各的；老壳子没有这一项，就并成一排
  setTeamMenuSplit(Array.isArray(info?.menus) && info.menus.includes("team"));
  app.use(router).use(ElementPlus);
  await router.isReady();
  app.mount("#app");
}

start();
