<script setup lang="ts">
// 壳子自己的（不是照搬的）：顶上一排菜单，下面装各页。
// 装各页的那几层（app-main、滚动区、grow、main-content）照旧项目 layout/components/lay-content，各页的尺寸才对得上。
import { computed } from "vue";
import { useRoute } from "vue-router";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import { allowed, cachedPages, menuOf, routes } from "./pages";
import { useUserStoreHook } from "@/store/modules/user";

const user = useUserStoreHook();
const current = useRoute();
// 「消息」只有一页：顶上不摆那一排，整页给它
const bare = computed(() => Boolean(current.meta?.bare));
// 「考试」「我的团队」各摆各的一排：现在在哪一项里，就摆哪一排
const menu = computed(() =>
  menuOf(current.path)
    .map(path => routes.find(route => route.path === path)!)
    .filter(route => allowed(route.meta?.roles, user.roles))
    .map(route => ({ path: route.path, 名: String(route.meta?.title) }))
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
    <nav v-if="!bare" class="shell-nav">
      <router-link v-for="item in menu" :key="item.path" :to="item.path">
        {{ item.名 }}
      </router-link>
    </nav>
    <section class="app-main" :class="{ bare }">
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
