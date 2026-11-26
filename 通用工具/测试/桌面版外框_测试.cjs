'use strict';
/* 桌面版/lib/routes.js：菜单路由里有哪几项、外观设置认不认、中间那块留多大 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { ROUTES, BAR, RAIL, DRAWER, SKINS, find, fixLook, railOn, stage } = require('../桌面版/lib/routes.js');

test('菜单里每一项：id 不重样，有名字、图标，页是本机服务开的路径', () => {
  assert.ok(ROUTES.length >= 1);
  assert.equal(new Set(ROUTES.map(r => r.id)).size, ROUTES.length);
  for (const r of ROUTES) {
    assert.match(r.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(r.名 && r.图标);
    assert.match(r.页, /^通用工具\/.+\.html$/);
    assert.equal(find(r.id), r);
  }
  assert.equal(find('没有这一项'), null);
  assert.equal(ROUTES[0].id, 'pipeline');
});

test('菜单里用到的图标，外框页里都画了；页也都在', () => {
  const html = fs.readFileSync(path.join(__dirname, '../桌面版/外框/外框.html'), 'utf8');
  for (const r of ROUTES) {
    assert.ok(html.includes(`<symbol id="i-${r.图标}"`), `外框.html 里没有图标 ${r.图标}`);
    const src = r.页.replace('通用工具/桌面版/页面/考试/', '通用工具/桌面版/考试/');   // 考试页是打出来的（不进 git）：看它源码的入口在不在
    assert.ok(fs.existsSync(path.join(__dirname, '../..', src)), `没有这一页：${src}`);
  }
});

test('外观设置：认不出的换回默认（菜单放左边、皮肤用头一套）', () => {
  const 皮肤 = SKINS[0].名;
  assert.deepEqual(fixLook(undefined), { 菜单: 'left', 皮肤 });
  assert.deepEqual(fixLook('top'), { 菜单: 'left', 皮肤 });
  assert.deepEqual(fixLook({ 菜单: 'right' }), { 菜单: 'left', 皮肤 });
  assert.deepEqual(fixLook({ 菜单: 'top', 别的: 1 }), { 菜单: 'top', 皮肤 });
  assert.deepEqual(fixLook({ 菜单: 'left', 皮肤: '没有这一套' }), { 菜单: 'left', 皮肤 });
  assert.deepEqual(fixLook({ 皮肤: SKINS[1].名 }), { 菜单: 'left', 皮肤: SKINS[1].名 });
});

test('左边那一条：菜单放左边、有项可点才出来', () => {
  assert.equal(railOn({ 菜单: 'left' }, 1), true);
  assert.equal(railOn({ 菜单: 'left' }, 0), false);   // 没登录
  assert.equal(railOn({ 菜单: 'top' }, 3), false);
});

test('中间那块：顶栏下面，菜单在左边时让出左边一条', () => {
  const size = { width: 1440, height: 920 };
  assert.deepEqual(stage(size, { 菜单: 'left' }, 1), { x: RAIL, y: BAR, width: 1440 - RAIL, height: 920 - BAR });
  assert.deepEqual(stage(size, { 菜单: 'top' }, 1), { x: 0, y: BAR, width: 1440, height: 920 - BAR });
  assert.deepEqual(stage(size, { 菜单: 'left' }, 0), { x: 0, y: BAR, width: 1440, height: 920 - BAR });   // 登录页占满
  assert.deepEqual(stage({ width: 30, height: 20 }, { 菜单: 'left' }, 1), { x: RAIL, y: BAR, width: 0, height: 0 });   // 窗口再小也不出负数
});

test('设置开着：中间那一页让出右边那一栏，照样露着；窗口最小时也留得下', () => {
  const size = { width: 1440, height: 920 };
  assert.deepEqual(stage(size, { 菜单: 'left' }, 1, true), { x: RAIL, y: BAR, width: 1440 - RAIL - DRAWER, height: 920 - BAR });
  assert.deepEqual(stage(size, { 菜单: 'top' }, 1, true), { x: 0, y: BAR, width: 1440 - DRAWER, height: 920 - BAR });
  assert.deepEqual(stage(size, { 菜单: 'left' }, 0, true), { x: 0, y: BAR, width: 1440 - DRAWER, height: 920 - BAR });   // 登录页也让开
  assert.deepEqual(stage({ width: 300, height: 600 }, { 菜单: 'left' }, 1, true).width, 0);
  const main = fs.readFileSync(path.join(__dirname, '../桌面版/main.js'), 'utf8');
  const minWidth = Number(/minWidth: (\d+)/.exec(main)[1]);
  assert.ok(stage({ width: minWidth, height: 600 }, { 菜单: 'left' }, 1, true).width >= 400, '窗口拖到最小，设置开着时页面还得看得清');
});

test('设置那一栏：外框页照壳子给的宽画在右边，皮肤那一行在最上面', () => {
  const html = fs.readFileSync(path.join(__dirname, '../桌面版/外框/外框.html'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../桌面版/外框/外框.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../桌面版/外框/外框.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../桌面版/main.js'), 'utf8');
  assert.ok(/#set-page \{[^}]*width: var\(--drawer\)/.test(css), '设置那一栏的宽照 --drawer');
  assert.ok(js.includes(`setProperty('--drawer', s.drawer + 'px')`) && main.includes('drawer: DRAWER'), '--drawer 是壳子给的，和让出来的一样宽');
  assert.ok(main.includes('routesNow().length, setOpen)'), '摆页面时算上设置开没开');
  const page = html.slice(html.indexOf('<aside id="set-page"'), html.indexOf('</aside>'));
  assert.ok(page && !html.slice(html.indexOf('<main'), html.indexOf('</main>')).includes('set-page'), '设置不在中间那块里');
  assert.ok(page.indexOf('data-do="skin"') < page.indexOf('data-do="menu"') && page.indexOf('data-do="menu"') < page.indexOf('data-do="logout"'), '先是皮肤，再是菜单放哪，再是账号');
});

test('外框页：没有菜单钮；用到的图标都画了；设置里每个钮要办的事壳子都接着', () => {
  const html = fs.readFileSync(path.join(__dirname, '../桌面版/外框/外框.html'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../桌面版/main.js'), 'utf8');
  assert.ok(!html.includes('id="more"') && !main.includes('.popup('), '菜单钮和系统弹出菜单不该再有');
  for (const [, name] of html.matchAll(/href="#(i-[a-z-]+)"/g)) assert.ok(html.includes(`<symbol id="${name}"`), `没画图标 ${name}`);
  const table = main.slice(main.indexOf('const DO = {'), main.indexOf('};', main.indexOf('const DO = {')));
  const wired = new Set([...table.matchAll(/^\s+'?([a-z-]+)'?\s*[:,]/gm)].map(m => m[1]));
  const asked = [...html.matchAll(/data-do="([a-z-]+)"/g)].map(m => m[1]);
  assert.ok(asked.length >= 5);
  for (const name of asked) assert.ok(wired.has(name), `设置里的钮 ${name}，main.js 的 DO 里没接`);
});

test('更新状态一变就说一声（设置里「版本」那一行跟着变）', () => {
  const { makeUpdater } = require('../桌面版/lib/updater.js');
  let said = 0;
  const up = makeUpdater({ app: { isPackaged: false }, dialog: {}, getWindow: () => null, log: { info() {}, warn() {}, error() {} }, onChange: () => { said++; } });
  up.configure();
  assert.equal(said, 1);
  assert.deepEqual(up.status(), { status: 'unsupported', message: '开发时不查更新' });
  assert.equal(up.enabled, false);
});
