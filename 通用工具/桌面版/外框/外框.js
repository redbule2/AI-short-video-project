'use strict';
/* 外框页：顶栏（名字、设置钮、窗口三个按钮）、菜单（左边一条，或排进顶栏）、设置（从右边拉出来的一栏）。
   画成什么样全照壳子给的状态（deskFrame.state、onState）；模块页不在这一页里，壳子另开视图盖在中间那块（#stage）上，
   点「设置」时壳子把模块页往左让开（lib/routes.js 的 DRAWER），露出这一页画在右边的设置；模块页照样露着，换皮肤当场看得到。 */
(function () {
const api = window.deskFrame;
const SVG = 'http://www.w3.org/2000/svg';
const SET = 'settings';
const root = document.documentElement;
const $ = id => document.getElementById(id);
let navKey = '';

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.setAttribute('class', 'ic');
  svg.append(use);
  return svg;
}
function navBtn(r, on) {
  const b = document.createElement('button');
  const t = document.createElement('span');
  t.textContent = r.名;
  b.type = 'button';
  b.title = r.名 + (r.数 ? `（${r.数} 条没看）` : '');
  b.dataset.go = r.id;
  if (on) b.className = 'on';
  b.append(icon(r.图标), t);
  if (r.数 > 0) {   // 没看的条数（「消息」那一项）：右上角一个红圆点写着数，过了 99 写 99+
    const n = document.createElement('b');
    n.className = 'dot';
    n.textContent = r.数 > 99 ? '99+' : String(r.数);
    b.append(n);
  }
  return b;
}
function flag(k, on) {
  if (on) root.dataset[k] = '1'; else delete root.dataset[k];
}

function draw(s) {
  if (!s) return;
  root.style.setProperty('--bar', s.bar + 'px');
  root.style.setProperty('--rail', s.rail + 'px');
  root.style.setProperty('--drawer', s.drawer + 'px');
  root.dataset.menu = s.menu;
  root.dataset.skin = s.skin;   // 外框.css 照它换那一组 --k- 颜色
  flag('rail', s.railOn);
  flag('set', s.setOpen);
  flag('max', s.maximized);
  flag('full', s.fullscreen);
  flag('blur', !s.focused);
  const key = JSON.stringify([s.menu, s.current, s.routes]);
  if (key !== navKey) {   // 菜单没变就不重画：正指着、正按着的那一项别被换掉
    navKey = key;
    const items = s.routes.map(r => navBtn(r, r.id === s.current));
    $('tabs').replaceChildren(...(s.menu === 'top' ? items : []));
    $('rail').replaceChildren(...(s.menu === 'left' ? items : []));
  }
  $('name').textContent = s.app;
  $('title').textContent = s.title || '';
  $('off').hidden = !s.offline;
  $('srv').hidden = !s.server;   // 本机服务停着、没开起来：挂一块小牌子（壳子在自己重开，好了就收掉），点了打开日志文件夹
  $('srv').textContent = s.server || '';
  $('srv').title = s.serverTip || '';
  document.querySelector('[data-win="max"]').title = s.fullscreen ? '退出全屏' : s.maximized ? '还原' : '最大化';
  $('max-use').setAttribute('href', s.maximized || s.fullscreen ? '#i-restore' : '#i-max');

  $('set').classList.toggle('on', s.setOpen);
  $('set-page').hidden = !s.setOpen;
  $('busy').hidden = !s.busy;
  $('busy').textContent = s.busy || '';
  $('set-user').textContent = s.user ? s.user + (s.team ? '　' + s.team : '') + (s.offline ? '（离线）' : '') : '没登录';
  $('set-logout').hidden = !s.user;
  $('set-work').textContent = s.work;
  for (const b of document.querySelectorAll('[data-do="menu"]')) b.classList.toggle('on', b.dataset.arg === s.menu);
  for (const b of document.querySelectorAll('[data-do="skin"]')) b.classList.toggle('on', b.dataset.arg === s.skin);
  $('set-ver').textContent = s.version;
  $('set-up').textContent = s.update.text;
  $('set-update').hidden = s.update.can !== 'check';
  $('set-install').hidden = s.update.can !== 'install';
  $('set-note').textContent = s.note;
}

/* 钮都在这里接：窗口三个按钮、去哪一页（菜单里的各项、设置和它的「收起」）、设置里要壳子办的事 */
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.win) api.win(b.dataset.win);
  else if (b.dataset.go) api.go(b.dataset.go);
  else if (b.dataset.do) api.do(b.dataset.do, b.dataset.arg);
});
/* 设置开着时按 Esc 收起来（键盘在设置那一栏里时；在中间那一页里按的归那一页） */
document.addEventListener('keydown', e => { if (e.key === 'Escape' && root.dataset.set) api.go(SET); });
api.onState(draw);
api.state().then(draw);
})();
