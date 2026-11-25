// 壳子自己的（不是照搬的）：考试、团队页的入口。全局样式的先后照旧项目 main.ts。
import { createApp } from "vue";
import ElementPlus from "element-plus";
import App from "./App.vue";
import router from "./router";
import { setupStore } from "@/store";
import { useUserStoreHook, type DeskUser } from "@/store/modules/user";

import "./style/reset.css";
import "./style/element-plus.css";
import "element-plus/dist/index.css";
import "./style/shell.css";

type Desk = { info?: () => Promise<{ user: DeskUser | null } | null> };

async function start() {
  const app = createApp(App);
  setupStore(app);
  const desk = (window as unknown as { desk?: Desk }).desk;
  const info = desk?.info ? await desk.info() : null;
  useUserStoreHook().fill(info?.user ?? null);
  app.use(router).use(ElementPlus);
  await router.isReady();
  app.mount("#app");
}

start();
