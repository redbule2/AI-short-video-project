<script setup lang="ts">
// 壳子自己的（不是照搬的）：顶上一排菜单，下面装各页。
// 装各页的那几层（app-main、滚动区、grow、main-content）照旧项目 layout/components/lay-content，各页的尺寸才对得上。
import { computed } from "vue";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { MENU, allowed, cachedPages, routes } from "./pages";
import { useUserStoreHook } from "@/store/modules/user";

const user = useUserStoreHook();
const menu = computed(() =>
  MENU.map(path => routes.find(route => route.path === path)!)
    .filter(route => allowed(route.meta?.roles, user.roles))
    .map(route => ({
      path: route.path,
      名: route.path === "/collaboration" ? "团队" : String(route.meta?.title)
    }))
);
const wrapStyle = {
  display: "flex",
  "flex-wrap": "wrap",
  "max-width": "100%",
  margin: "0 auto"
};
const viewStyle = {
  display: "flex",
  flex: "auto",
  overflow: "hidden",
  "flex-direction": "column"
};
</script>

<template>
  <el-config-provider :locale="zhCn">
    <nav class="shell-nav">
      <router-link v-for="item in menu" :key="item.path" :to="item.path">
        {{ item.名 }}
      </router-link>
    </nav>
    <section class="app-main">
      <router-view v-slot="{ Component, route }">
        <div class="w-full h-full">
          <el-scrollbar :wrap-style="wrapStyle" :view-style="viewStyle">
            <div class="grow">
              <keep-alive :include="cachedPages">
                <component
                  :is="Component"
                  :key="route.fullPath"
                  class="main-content"
                />
              </keep-alive>
            </div>
          </el-scrollbar>
        </div>
      </router-view>
    </section>
  </el-config-provider>
</template>
