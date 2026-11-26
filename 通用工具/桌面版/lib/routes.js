'use strict';
/* 菜单路由：外框菜单里有哪几项、点开是哪一页、中间那块留多大。
   每一项点开各是一整页，由本机服务开（开发规范第 13 条）；main.js 给每项开一个视图，切走不关。
   加模块：在 ROUTES 里加一行，图标画进 外框/外框.html 的 <symbol id="i-图标名">。 */
const ROUTES = [
  { id: 'pipeline', 名: '流水线', 图标: 'film', 页: '通用工具/流水线/总览.html' },
  { id: 'tutorial', 名: '视频教程', 图标: 'play', 页: '通用工具/桌面版/页面/视频教程/视频教程.html' },   // 课在本机「通用工具」里的「…教程」文件夹，不进安装包
  { id: 'exam', 名: '考试', 图标: 'exam', 页: '通用工具/桌面版/页面/考试/index.html' },   // 考试、团队：照搬的 Vue 页面，源码在 桌面版/考试，打出来才有这一页
  { id: 'team', 名: '我的团队', 图标: 'team', 页: '通用工具/桌面版/页面/考试/index.html', 起: '#/team' },   // 和「考试」是同一份页面，各开各的；「起」接在网址后面，打开就进团队那一页
  { id: 'chat', 名: '消息', 图标: 'chat', 页: '通用工具/桌面版/页面/考试/index.html', 起: '#/chat' },   // 团队聊天：也是这同一份页面；新消息由壳子在后台收（lib/chat.js），菜单上写着几条没看
];
const BAR = 40;    // 顶栏高
const RAIL = 64;   // 左边那一条菜单的宽
const DRAWER = 360;   // 设置那一栏（从右边拉出来）的宽
const MENUS = ['left', 'top'];   // 菜单放左边一条，或排进顶栏
/* 皮肤：名字、页面还没画出来时窗口的底色、是不是「深桌子上铺亮纸」（纸面要另标，见 preload.js）。头一套是默认的。
   颜色本身在样式里，名字对着这里：外框的在 外框/外框.css，流水线、登录、考试和团队各页的在 公用/皮肤.css（四套都在那一份）。 */
const SKINS = [
  { 名: '宣纸', 底: '#f4efe6' },
  { 名: '墨夜', 底: '#1f1d19' },
  { 名: '青瓷', 底: '#eef3f1' },
  { 名: '校样台', 底: '#211f1a', 纸面: true },
];

const find = id => ROUTES.find(r => r.id === id) || null;
const skinOf = name => SKINS.find(s => s.名 === name) || SKINS[0];
/* 说给页面的（preload.js 照它写 <html data-skin>）：默认那一套不写名字，页面的样式本来就是它 */
const skinForPage = s => ({ 名: s === SKINS[0] ? '' : s.名, 纸面: !!s.纸面 });

/* 存在设置里的「外观」：认不出的换回默认（菜单放左边、皮肤用头一套） */
function fixLook(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  return { 菜单: MENUS.includes(s.菜单) ? s.菜单 : 'left', 皮肤: skinOf(s.皮肤).名 };
}

/* 左边那一条出不出来：菜单放左边、而且有项可点（没登录时一项也没有） */
const railOn = (look, count) => look.菜单 === 'left' && count > 0;

/* 模块页摆在窗口里的哪一块：窗口里面的大小 → x、y、宽、高。设置开着（drawer）时右边让给设置那一栏，页面照样露着 */
function stage(size, look, count, drawer) {
  const left = railOn(look, count) ? RAIL : 0, right = drawer ? DRAWER : 0;
  return { x: left, y: BAR, width: Math.max(0, size.width - left - right), height: Math.max(0, size.height - BAR) };
}

module.exports = { ROUTES, BAR, RAIL, DRAWER, MENUS, SKINS, find, skinOf, skinForPage, fixLook, railOn, stage };
