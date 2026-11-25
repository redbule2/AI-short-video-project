'use strict';
/* 外框页：顶栏（名字、设置钮、窗口三个按钮）、菜单（左边一条，或排进顶栏）、设置（画在中间那块）。
   画成什么样全照壳子给的状态（deskFrame.state、onState）；模块页不在这一页里，壳子另开视图盖在中间那块（#stage）上，
   点「设置」时壳子把它们收起来，露出这一页自己画的设置。 */
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
  b.title = r.名;
  b.dataset.go = r.id;
  if (on) b.className = 'on';
  b.append(icon(r.图标), t);
  return b;
}
function flag(k, on) {
  if (on) root.dataset[k] = '1'; else delete root.dataset[k];
}

function draw(s) {
  if (!s) return;
  root.style.setProperty('--bar', s.bar + 'px');
  root.style.setProperty('--rail', s.rail + 'px');
  root.dataset.menu = s.menu;
  flag('rail', s.railOn);
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
  document.querySelector('[data-win="max"]').title = s.fullscreen ? '退出全屏' : s.maximized ? '还原' : '最大化';
  $('max-use').setAttribute('href', s.maximized || s.fullscreen ? '#i-restore' : '#i-max');

  const set = s.current === SET;
  $('set').classList.toggle('on', set);
  $('set-page').hidden = !set;
  $('busy').hidden = set || !s.busy;
  $('busy').textContent = s.busy || '';
  $('set-user').textContent = s.user ? s.user + (s.team ? '　' + s.team : '') + (s.offline ? '（离线）' : '') : '没登录';
  $('set-logout').hidden = !s.user;
  $('set-work').textContent = s.work;
  for (const b of document.querySelectorAll('[data-do="menu"]')) b.classList.toggle('on', b.dataset.arg === s.menu);
  $('set-ver').textContent = s.version;
  $('set-up').textContent = s.update.text;
  $('set-update').hidden = s.update.can !== 'check';
  $('set-install').hidden = s.update.can !== 'install';
  $('set-note').textContent = s.note;
}

/* 钮都在这里接：窗口三个按钮、去哪一页（菜单里的各项、设置和它的「返回」）、设置里要壳子办的事 */
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.win) api.win(b.dataset.win);
  else if (b.dataset.go) api.go(b.dataset.go);
  else if (b.dataset.do) api.do(b.dataset.do, b.dataset.arg);
});
api.onState(draw);
api.state().then(draw);
})();
