'use strict';
/* 菜单路由：外框菜单里有哪几项、点开是哪一页、中间那块留多大。
   每一项点开各是一整页，由本机服务开（开发规范第 13 条）；main.js 给每项开一个视图，切走不关。
   加模块：在 ROUTES 里加一行，图标画进 外框/外框.html 的 <symbol id="i-图标名">。 */
const ROUTES = [
  { id: 'pipeline', 名: '流水线', 图标: 'film', 页: '通用工具/流水线/总览.html' },
  { id: 'exam', 名: '考试', 图标: 'exam', 页: '通用工具/桌面版/页面/考试/index.html' },   // 考试、团队：照搬的 Vue 页面，源码在 桌面版/考试，打出来才有这一页
];
const BAR = 40;    // 顶栏高
const RAIL = 64;   // 左边那一条菜单的宽
const MENUS = ['left', 'top'];   // 菜单放左边一条，或排进顶栏

const find = id => ROUTES.find(r => r.id === id) || null;

/* 存在设置里的「外观」：认不出的换回默认（菜单放左边） */
function fixLook(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return { 菜单: MENUS.includes(s.菜单) ? s.菜单 : 'left' };
}

/* 左边那一条出不出来：菜单放左边、而且有项可点（没登录时一项也没有） */
const railOn = (look, count) => look.菜单 === 'left' && count > 0;

/* 模块页摆在窗口里的哪一块：窗口里面的大小 → x、y、宽、高 */
function stage(size, look, count) {
  const left = railOn(look, count) ? RAIL : 0;
  return { x: left, y: BAR, width: Math.max(0, size.width - left), height: Math.max(0, size.height - BAR) };
}

module.exports = { ROUTES, BAR, RAIL, MENUS, find, fixLook, railOn, stage };
