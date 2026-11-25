/* 冒烟试一遍（开发规范第 21 条「本机装一遍点通」里机器能做的那一半）
     node scripts/smoke.mjs        开发版（electron .；工具从 build/tools 来，先跑 pnpm stage）
     node scripts/smoke.mjs exe    打好的 release/win-unpacked/Liushuixian.exe（先跑 pnpm pack）
   空的工作文件夹、空的设置，接一个假的登录服务器（不碰 video8.online），窗口出来不抢键盘。看这几样：
   工具同步进去、本机服务开起来、登录页出来、假账号登录后进总览、再开一回不用登录、页面没报错、关掉后本机服务也关了；
   注册要填团队；考试（照搬的那一页）：经壳子问服务器、凭证过期自己续、图转到服务器拿；
   外框：没登录没有菜单、登录后菜单在左边、最大化和还原、设置（换菜单位置、退出登录）、快捷键（放大、刷新）、
   页面有没存的时关窗口先问、设置改成菜单放顶部再开一回，各页都摆在该在的地方。
   截图放 build/smoke（「窗口」开头的是整个窗口，别的是单独一页）。
   窗口摆在屏幕外面跑，不挡正在用电脑的人（想看着它跑：ANTOU_SMOKE_AT=100,100）；试最大化时会在屏幕上露一下，一两秒就回去。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ping, killTree, samePath } = require('../lib/runner.js');
import { shotWindows, clickDialog } from './win-helpers.mjs';

const DESK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(DESK, 'build', 'smoke');
const useExe = process.argv[2] === 'exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
function check(ok, text, detail) {
  console.log((ok ? '✔ ' : '✖ ') + text);
  if (!ok) { failed++; if (detail) console.log('　' + String(detail).split('\n').join('\n　')); }
  return ok;
}

/* ---------- 假的登录服务器：账号 smoke、密码 smoke-pass ---------- */
const FAKE = { accessToken: 'fake-access', refreshToken: 'fake-refresh', expires: new Date(Date.now() + 3600e3).toISOString(), username: 'smoke', nickname: '冒烟', avatar: '', accountType: 'owner', ownerUsername: 'smoke', roles: [], permissions: [] };
const seen = [];
/* 假服务器上的考试、团队：一张卷、两个人、一张图。问这两块得带凭证；头一回装作凭证过期，看壳子会不会自己续一回再问 */
const SUB = name => ({ ...FAKE, username: name, nickname: name, accountType: 'sub', ownerUsername: 'smoke' });
const MY = { items: [{ sheetId: 's1', paperTitle: '冒烟卷', paperDescription: null, status: '待考', questionCount: 3, totalScore: 10, passScore: 6, durationMinutes: 30, deadline: null, answerRevealPolicy: 'onSubmit', answersPublished: false, startedAt: null, submittedAt: null, myObjectiveScore: null, myTotalScore: null, endTime: null, paused: false, remainingSeconds: null, serverNow: new Date().toISOString() }] };
const MAN = (id, username, displayName, role) => ({ id, username, displayName, role, status: 'active', lastActive: '', permissionNote: '', createdAt: '2026-11-01T00:00:00', updatedAt: null });
const TEAM = { accounts: [MAN('1', 'smoke', '冒烟', 'owner'), MAN('2', 'xiaowang', '小王', 'sub')], stats: { total: 2, subTotal: 1, disabledTotal: 0 }, currentUsername: 'smoke', ownerUsername: 'smoke', accountType: 'owner', canManageAccounts: true };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const auths = {};   // 各地址最近一回带来的凭证
let staleOnce = true;
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    let j = {};
    try { j = JSON.parse(body); } catch (e) { /* 空的 */ }
    seen.push(req.url);
    const send = o => { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
    const p = req.url.split('?')[0];
    auths[p] = req.headers.authorization || '';
    if (p === '/api/auth/register') return send(!j.ownerUsername ? { success: false, message: '请填写团队（团队负责人的账号）。', data: null } : j.ownerUsername !== 'smoke' ? { success: false, message: '没有这个团队，请向团队负责人确认账号。', data: null } : { success: true, message: '注册成功。', data: SUB(j.username) });
    if (p.startsWith('/uploads/exam/')) { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
    if (p.startsWith('/api/exam/') || p.startsWith('/api/collaboration/')) {
      if (!/^Bearer fake-access/.test(auths[p]) || staleOnce) { staleOnce = false; res.writeHead(401); return res.end(); }
      if (p === '/api/exam/my') return send({ success: true, message: '', data: MY });
      if (p === '/api/exam/sheets/s1/uploads') return send({ success: true, message: '已上传', data: { url: '/uploads/exam/s1/a.png', name: (/filename="([^"]*)"/.exec(body) || [])[1] || '', type: req.headers['content-type'] || '' } });
      if (p === '/api/collaboration/accounts') return send({ success: true, message: '', data: TEAM });
      return send({ success: false, message: '假服务器没备这个', data: null });
    }
    if (req.url === '/api/auth/login') return send(j.username === 'smoke' && j.password === 'smoke-pass' ? { success: true, message: '登录成功。', data: FAKE } : { success: false, message: '账号或密码错误。', data: null });
    if (req.url === '/api/auth/refresh-token') return send(j.refreshToken === 'fake-refresh' ? { success: true, message: 'ok', data: { accessToken: 'fake-access-2', refreshToken: 'fake-refresh', expires: FAKE.expires } } : { success: false, message: '刷新令牌无效，请重新登录。', data: null });
    res.writeHead(404);
    res.end();
  });
});
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const API = `http://127.0.0.1:${mock.address().port}`;

/* ---------- 调试口（CDP）：看页面、填表、截图 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antou-smoke-'));
const work = path.join(tmp, 'AI短视频项目');
const data = path.join(tmp, 'data');
const port = 18900 + Math.floor(Math.random() * 90);
const cdp = port + 1000;
const insp = port + 2000;   // 主进程的调试口：替人按快捷键（hitKey、pressKey）

async function targets() {
  try { return await (await fetch(`http://127.0.0.1:${cdp}/json/list`)).json(); } catch (e) { return []; }
}
async function waitPage(match, ms) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(300)) {
    const t = (await targets()).find(x => x.type === 'page' && match(decodeURIComponent(x.url)));
    if (t) return t;
  }
  return null;
}
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    ws.onopen = () => resolve({
      send(method, params = {}) {
        const i = ++id;
        ws.send(JSON.stringify({ id: i, method, params }));
        return new Promise((res, rej) => {
          pending.set(i, { res, rej });
          setTimeout(() => { if (pending.delete(i)) rej(new Error(method + ' 等太久')); }, 15000);
        });
      },
      close: () => ws.close(),
    });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      const p = m.id && pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
    };
    ws.onerror = () => reject(new Error('连不上调试口'));
  });
}
async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('页面里出错：' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}
async function shot(c, name) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
}
function logLines() {
  const dir = path.join(data, 'logs');
  try { return fs.readdirSync(dir).flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n')).filter(Boolean); } catch (e) { return []; }
}
function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}

/* ---------- 开、关软件 ---------- */
function launch() {
  const exe = useExe ? path.join(DESK, 'release', 'win-unpacked', 'Liushuixian.exe') : path.join(DESK, 'node_modules', 'electron', 'dist', 'electron.exe');
  const quiet = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'];   // 窗口摆在屏幕外面也照样画，截图才截得到
  const args = [...(useExe ? [] : ['.']), ...quiet, `--remote-debugging-port=${cdp}`, `--inspect=${insp}`];
  const env = { ...process.env, ANTOU_DESK_WORK: work, ANTOU_DESK_DATA: data, ANTOU_PORT: String(port), ANTOU_DESK_API: API, ANTOU_DESK_NO_UPDATE: '1', ANTOU_DESK_NO_FOCUS: '1', ANTOU_DESK_AT: process.env.ANTOU_SMOKE_AT || '-9000,-9000' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(exe, args, { cwd: DESK, env, stdio: 'ignore' });
  child.on('error', e => console.log('开不起来：' + e.message));
  return child;
}
/* 等软件自己退；等了 12 秒还没退就硬关，回 false */
async function exited(child) {
  for (let i = 0; i < 48 && child.exitCode === null; i++) await sleep(250);
  const ok = child.exitCode !== null;
  if (!ok) killTree(child);
  await sleep(800);
  return ok;
}

/* ---------- 外框 ---------- */
const APP = 'AI短视频流水线';
const FRAME = u => u.startsWith('file:') && u.includes('/外框/外框.html');
const LOGIN = u => u.includes('/通用工具/桌面版/页面/登录.html');
const HOME = u => u.includes('/通用工具/流水线/总览.html');
const EXAM = u => u.includes('/通用工具/桌面版/页面/考试/index.html');
const frameState = c => evaluate(c, `window.deskFrame.state()`);
const sizeOf = c => evaluate(c, `({ w: innerWidth, h: innerHeight })`);
async function until(fn, ms = 8000) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) { const v = await fn(); if (v) return v; }
  return null;
}
/* 中间那一页是不是正好摆在顶栏下面、菜单右边：两页各自量自己多大，对一对 */
async function fits(frame, page, s) {
  const f = await sizeOf(frame), p = await sizeOf(page), left = s.railOn ? s.rail : 0;
  return p.w === f.w - left && p.h === f.h - s.bar ? '' : `外框 ${f.w}×${f.h}，页面 ${p.w}×${p.h}，该是 ${f.w - left}×${f.h - s.bar}`;
}
const winShot = name => shotWindows(app.pid, OUT, name).length > 0;
/* 在主进程里跑一句（经 --inspect 开的调试口）：按键要从系统那头进来，页面这头够不着 */
async function mainEval(expression) {
  const list = await (await fetch(`http://127.0.0.1:${insp}/json/list`)).json();
  const m = await connect(list[0].webSocketDebuggerUrl);
  try { return await evaluate(m, `(() => { const E = process.mainModule.require('electron'); ${expression} })()`); } finally { m.close(); }
}
/* 替人按一个快捷键：直接叫那份不露面的菜单里的那一项 */
const hitKey = label => mainEval(`E.Menu.getApplicationMenu().items[0].submenu.items.find(i => i.label === ${JSON.stringify(label)}).click(); return true;`);
/* 替人点外框页上的一个钮；等外框变成要的样子 */
const clickF = (c, sel) => evaluate(c, `document.querySelector(${JSON.stringify(sel)}).click()`);
const frameUntil = (c, ok) => until(async () => { const x = await frameState(c); return ok(x) && x; });
/* 替人在中间那一页里按一个键 */
const pressKey = (keyCode, modifiers) => mainEval(`const wc = E.webContents.getAllWebContents().find(w => decodeURIComponent(w.getURL()).includes('/通用工具/流水线/总览.html')); for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: ${JSON.stringify(keyCode)}, modifiers: ${JSON.stringify(modifiers || [])} }); return true;`);

let app = null;
try {
  console.log(`冒烟：${useExe ? '打好的 exe' : '开发版'}，工作文件夹 ${work}，端口 ${port}`);
  app = launch();
  const login = await waitPage(LOGIN, 45000);
  if (!check(!!login, '登录页出来了', '45 秒没等到登录页。日志最后几行：\n' + logLines().slice(-12).join('\n'))) throw new Error('停');
  const p = await ping(port);
  check(p && samePath(p.abs, work), '本机服务开着，认的是这个工作文件夹', p && p.abs);
  const n = fs.existsSync(path.join(work, '通用工具')) ? countFiles(work) : 0;
  check(n > 100, `工具同步进工作文件夹了（${n} 个文件）`);
  check(fs.existsSync(path.join(work, '项目')), '「项目」文件夹建好了');
  let c = await connect(login.webSocketDebuggerUrl);
  await sleep(600);
  check(await evaluate(c, `typeof window.desk === 'object' && typeof window.desk.login === 'function'`), '页面拿得到 window.desk');
  check(await evaluate(c, `typeof require === 'undefined' && typeof process === 'undefined' && typeof window.deskFrame === 'undefined'`), '页面拿不到 Node（require、process），也拿不到外框的那几样');
  await shot(c, '1_登录页.png');

  const ft = await waitPage(FRAME, 5000);
  if (!check(!!ft, '外框页开着（顶栏、窗口按钮是它画的）')) throw new Error('停');
  const f = await connect(ft.webSocketDebuggerUrl);
  let s = await frameState(f);
  check(s && s.routes.length === 0 && !s.railOn && s.current === 'login', '没登录：菜单里一项也没有，中间摆的是登录页', JSON.stringify(s));
  check(await evaluate(f, `document.querySelectorAll('#win button').length === 3 && !!document.getElementById('set') && !document.getElementById('more') && typeof require === 'undefined'`), '外框上有「设置」和三个窗口按钮，没有菜单钮，拿不到 Node');
  let bad = await fits(f, c, s);
  check(!bad, '登录页摆在顶栏下面、占满宽', bad);
  check(winShot('窗口1_登录'), '截了整个窗口（登录）');
  await clickF(f, '#set');
  s = await frameUntil(f, x => x.current === 'settings');
  check(!!s && await evaluate(f, `(() => { const g = id => document.getElementById(id); return !g('set-page').hidden && g('set-user').textContent === '没登录' && g('set-logout').hidden; })()`), '没登录点「设置」：露出设置，写着没登录，没有「退出登录」', JSON.stringify(s));
  check(await evaluate(c, `document.visibilityState`) === 'hidden', '登录页收起来了，没关');
  await clickF(f, '#set');
  s = await frameUntil(f, x => x.current === 'login');
  check(!!s && await evaluate(f, `document.getElementById('set-page').hidden`) && !!(await until(() => evaluate(c, `document.visibilityState === 'visible'`))), '再点一下「设置」：回到登录页');

  console.log('注册要填团队：');
  await evaluate(c, `document.querySelectorAll('.tabs button')[1].click()`);
  check(await evaluate(c, `(() => { const rows = [...document.querySelectorAll('label.reg')]; return rows.length === 2 && rows.every(r => !r.hidden) && rows[1].firstChild.textContent === '团队'; })()`), '点「注册」：多出「再输一遍密码」和「团队」两格');
  await evaluate(c, `(() => { const [u, pw, again] = document.querySelectorAll('input'); u.value = 'new1'; pw.value = again.value = 'p'; document.querySelector('form').requestSubmit(); return true; })()`);
  check(await until(() => evaluate(c, `document.querySelector('.msg').textContent === '请输入团队'`), 3000) && !seen.includes('/api/auth/register'), '团队没填：不让注册，也不去问服务器');
  await shot(c, '1b_注册.png');
  await evaluate(c, `(() => { document.querySelectorAll('input')[3].value = 'nobody'; document.querySelector('form').requestSubmit(); return true; })()`);
  check(await until(() => evaluate(c, `/没有这个团队/.test(document.querySelector('.msg').textContent)`), 5000) && !(await waitPage(HOME, 300)), '团队填得不对：照服务器的话说，没注册上');
  await evaluate(c, `(() => { document.querySelectorAll('.tabs button')[0].click(); return document.querySelectorAll('label.reg:not([hidden])').length; })()`);

  const wrong = await evaluate(c, `window.desk.login('smoke', 'wrong')`);
  check(wrong && wrong.ok === false && /账号或密码错误/.test(wrong.message), '密码不对：照服务器的话说', JSON.stringify(wrong));
  await evaluate(c, `(() => { const [u, pw] = document.querySelectorAll('input'); u.value = 'smoke'; pw.value = 'smoke-pass'; document.querySelector('form').requestSubmit(); return true; })()`);
  c.close();
  let home = await waitPage(HOME, 20000);
  if (!check(!!home, '登录后进了总览')) throw new Error('停');
  c = await connect(home.webSocketDebuggerUrl);
  await sleep(3000);
  const info = await evaluate(c, `({ title: document.title, n: document.querySelectorAll('*').length })`);
  check(info.n > 30, `总览画出来了（${info.n} 个元素，标题「${info.title}」）`);
  await shot(c, '2_总览.png');
  check(!(await waitPage(LOGIN, 600)), '登录页关掉了');
  s = await frameState(f);
  check(s.routes.length >= 1 && s.current === 'pipeline' && s.menu === 'left' && s.railOn && s.title === info.title, '登录后：菜单在左边，「流水线」亮着，顶栏写着页面的名字', JSON.stringify(s));
  check(await evaluate(f, `(() => { const b = document.querySelector('#rail button.on'); return !!b && b.textContent === '流水线' && getComputedStyle(document.getElementById('rail')).display !== 'none' && !document.querySelector('#tabs button') && document.getElementById('title').textContent === ${JSON.stringify(info.title)}; })()`), '外框画的和状态对得上');
  bad = await fits(f, c, s);
  check(!bad, '流水线摆在顶栏下面、菜单右边', bad);
  check(winShot('窗口2_菜单在左'), '截了整个窗口（菜单在左）');
  const fw = (await sizeOf(f)).w;
  await evaluate(f, `delete document.documentElement.dataset.blur`);   // 窗口出来没抢键盘，顶栏是淡的；截一张亮着、指着关闭钮的样子
  await f.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fw - 23, y: 20 });
  await sleep(300);
  await shot(f, '3_外框_指着关闭.png');
  check(winShot('窗口2c_亮着_指着关闭'), '截了整个窗口（窗口在前面、鼠标指着关闭钮的样子）');
  await f.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fw / 2, y: 300 });

  console.log('窗口按钮：');
  await evaluate(f, `document.querySelector('[data-win="max"]').click()`);
  check(await until(async () => (await frameState(f)).maximized), '点最大化：窗口最大了');
  await sleep(500);
  bad = await fits(f, c, await frameState(f));
  check(!bad && await evaluate(f, `document.documentElement.dataset.max === '1' && document.querySelector('[data-win="max"]').title === '还原'`), '最大以后页面跟着变大，按钮换成「还原」', bad);
  await evaluate(f, `document.querySelector('[data-win="max"]').click()`);
  check(await until(async () => !(await frameState(f)).maximized), '再点一下：还原了');
  await sleep(500);
  bad = await fits(f, c, await frameState(f));
  check(!bad, '还原以后页面跟着变回来', bad);

  console.log('设置（外框页自己画的，替人点）：');
  const setFile = path.join(data, '设置.json');
  await clickF(f, '#set');
  s = await frameUntil(f, x => x.current === 'settings');
  check(!!s && s.title === '设置' && await evaluate(f, `(() => { const g = id => document.getElementById(id); return !g('set-page').hidden && g('set').classList.contains('on') && g('set-user').textContent === '冒烟　团队负责人' && !g('set-logout').hidden && !!document.querySelector('[data-do="menu"][data-arg="left"].on') && g('set-ver').textContent.length > 0 && g('set-up').textContent.length > 0 && g('set-update').hidden && g('set-install').hidden && !document.querySelector('#rail button.on'); })()`), '点「设置」：账号、菜单放哪、版本都写着（试的时候不查更新，所以没有「检查更新」）', JSON.stringify(s));
  check(samePath(await evaluate(f, `document.getElementById('set-work').textContent`), work), '工作文件夹写的是这一个');
  check(await evaluate(c, `document.visibilityState`) === 'hidden', '流水线那一页收起来了，没关');
  await evaluate(f, `delete document.documentElement.dataset.blur`);
  await shot(f, '4_设置.png');
  check(winShot('窗口2d_设置'), '截了整个窗口（设置）');
  await clickF(f, '[data-do="menu"][data-arg="top"]');
  s = await frameUntil(f, x => x.menu === 'top');
  check(!!s && !s.railOn && s.current === 'settings' && await evaluate(f, `!!document.querySelector('[data-do="menu"][data-arg="top"].on') && document.querySelectorAll('#tabs button').length === 2`), '挑「顶部一排」：菜单当场排进顶栏，设置还开着', JSON.stringify(s));
  check(JSON.parse(fs.readFileSync(setFile, 'utf8')).外观.菜单 === 'top', '记进设置了');
  await clickF(f, '#tabs button');
  s = await frameUntil(f, x => x.current === 'pipeline');
  await sleep(400);
  bad = s ? await fits(f, c, s) : '没回去';
  check(!!s && !bad && await evaluate(c, `document.visibilityState`) === 'visible', '点菜单里的「流水线」：回到流水线，页面占满宽', bad);
  await clickF(f, '#set');
  await frameUntil(f, x => x.current === 'settings');
  await clickF(f, '[data-do="menu"][data-arg="left"]');
  await frameUntil(f, x => x.menu === 'left');
  await clickF(f, '#set-page [data-go]');
  s = await frameUntil(f, x => x.current === 'pipeline' && x.menu === 'left');
  await sleep(400);
  bad = s ? await fits(f, c, s) : '没回去';
  check(!!s && s.railOn && !bad, '挑回「左边一条」，点「返回」：回到流水线，菜单在左边', bad);

  console.log('快捷键（经主进程的调试口替人按）：');
  const w0 = (await sizeOf(c)).w;
  await hitKey('放大');
  check(await until(async () => (await sizeOf(c)).w < w0) && (await sizeOf(f)).w === fw, '放大：放大的是中间那一页，外框不动');
  await hitKey('原样大小');
  check(await until(async () => (await sizeOf(c)).w === w0), '原样大小：变回来了');
  await evaluate(c, `window.__mark = 1`);
  await evaluate(f, `window.__mark = 1`);
  await hitKey('刷新');
  check(await until(() => evaluate(c, `typeof window.__mark === 'undefined' && document.readyState === 'complete'`).catch(() => false)), '刷新：中间那一页重新读了一遍');
  check(await evaluate(f, `window.__mark === 1`), '外框没跟着刷新');
  await evaluate(c, `window.__mark = 1`);
  await pressKey('R', ['control']);
  check(await until(() => evaluate(c, `typeof window.__mark === 'undefined' && document.readyState === 'complete'`).catch(() => false), 5000), '在页面里按 Ctrl+R：也刷新了（没有系统菜单，快捷键照样管用）');
  console.log('考试（照搬的那一页，问的是假服务器）：');
  check((await evaluate(c, `window.desk.api('GET', '/api/exam/my')`)).status === 400, '别的页面不许经壳子问服务器');
  await clickF(f, '#rail button[data-go="exam"]');
  const examT = await waitPage(EXAM, 15000);
  if (check(!!examT, '点菜单里的「考试」：考试页开了')) {
    const x = await connect(examT.webSocketDebuggerUrl);
    check(await until(() => evaluate(x, `(document.body ? document.body.innerText : '').includes('冒烟卷')`), 12000), '「我的考试」里摆出了服务器给的那张卷');
    check(/^Bearer fake-access-2$/.test(auths['/api/exam/my']) && seen.filter(u => u === '/api/exam/my').length === 2, '凭证是壳子带上的；头一回过期，自己续了一回再问', auths['/api/exam/my']);
    check(await evaluate(x, `[...document.querySelectorAll('.shell-nav a')].map(a => a.textContent.trim()).join('、')`) === '试卷管理、成绩总览、我的考试、团队', '团队负责人看到的菜单：试卷管理、成绩总览、我的考试、团队');
    check(await evaluate(x, `typeof require === 'undefined' && !JSON.stringify({ ...localStorage }).includes('fake-') && Object.keys(window.desk).join() === 'info,login,register,logout,api'`), '考试页拿不到 Node，也拿不到凭证');
    check((await evaluate(x, `window.desk.api('GET', '/api/auth/login')`)).status === 400, '考试页也只许问考试、团队两块');
    s = await frameState(f);
    bad = await fits(f, x, s);
    check(s.current === 'exam' && s.title === '我的考试' && !bad && await evaluate(c, `document.visibilityState`) === 'hidden', '顶栏写着「我的考试」，考试摆在菜单右边，流水线收起来了', bad || JSON.stringify(s));
    await shot(x, '5_考试.png');
    await evaluate(x, `[...document.querySelectorAll('.shell-nav a')].find(a => a.textContent.trim() === '团队').click()`);
    check(await until(() => evaluate(x, `location.hash === '#/collaboration' && (document.body ? document.body.innerText : '').includes('小王')`), 8000), '点「团队」：摆出团队里的人');
    await shot(x, '6_团队.png');
    const img = await evaluate(x, `new Promise(r => { const i = new Image(); i.onload = () => r(i.naturalWidth); i.onerror = () => r(0); i.src = '/uploads/exam/s1/a.png'; })`);
    check(img === 1 && seen.includes('/uploads/exam/s1/a.png'), '考试里的图：转到登录服务器去拿', String(img));
    const up = await evaluate(x, `window.desk.api('POST', '/api/exam/sheets/s1/uploads', { file: { name: '答题图.png', type: 'image/png', bytes: new Uint8Array([137, 80, 78, 71]).buffer } })`);
    check(up.ok && up.data.data.name === '答题图.png' && up.data.data.type.startsWith('multipart/form-data; boundary='), '传图：经壳子拼成表单发给服务器', JSON.stringify(up));
    check(winShot('窗口2e_考试'), '截了整个窗口（考试）');
    await clickF(f, '#rail button[data-go="pipeline"]');
    s = await frameUntil(f, y => y.current === 'pipeline');
    check(!!s && await evaluate(x, `document.visibilityState`) === 'hidden' && await evaluate(c, `document.visibilityState`) === 'visible', '点回「流水线」：考试页收起来，没关');
    x.close();
  }

  await clickF(f, '#set');
  await frameUntil(f, x => x.current === 'settings');
  await clickF(f, '[data-do="logout"]');
  const login2 = await waitPage(LOGIN, 8000);
  s = await frameState(f);
  check(!!login2 && s.current === 'login' && s.routes.length === 0 && !s.railOn && !(await waitPage(HOME, 500)) && !(await waitPage(EXAM, 300)), '设置里点「退出登录」：流水线、考试都关了，回到登录页，菜单收起来', JSON.stringify(s));
  c.close();
  if (!login2) throw new Error('停');
  c = await connect(login2.webSocketDebuggerUrl);
  await sleep(600);
  const again = await evaluate(c, `window.desk.login('smoke', 'smoke-pass')`);
  c.close();
  home = await waitPage(HOME, 20000);
  if (!check(again && again.ok && !!home, '再登录：又进了总览', JSON.stringify(again))) throw new Error('停');
  c = await connect(home.webSocketDebuggerUrl);
  await sleep(2000);
  check(seen.includes('/api/auth/login') && !logLines().some(l => l.includes('video8.online/api')), '登录问的是假服务器，没碰 video8.online');
  const bin = path.join(data, '登录.bin');
  check(fs.existsSync(bin) && !fs.readFileSync(bin).includes('fake-refresh'), '登录凭证加密存了（文件里看不到原文）');

  console.log('页面里有没存的，点关闭钮：');
  await c.send('Runtime.evaluate', { expression: `addEventListener('beforeunload', e => { e.preventDefault(); e.returnValue = ''; }); true`, userGesture: true });
  const clickClose = () => evaluate(f, `document.querySelector('[data-win="close"]').click()`).catch(() => {});
  clickClose();
  check(clickDialog(app.pid, APP, 1, 10) === 'clicked', '先问「离开／留下」');
  await sleep(1000);
  check(app.exitCode === null && (await frameState(f)).current === 'pipeline' && !!(await waitPage(HOME, 500)), '选「留下」：软件和这一页都还在');
  clickClose();
  check(clickDialog(app.pid, APP, 0, 10) === 'clicked', '再点关闭钮，又问了一回');
  check(await exited(app), '选「离开」：软件自己退了');
  check(!(await ping(port)), '关掉软件后，本机服务也关了');

  console.log('再开一回（设置里改成菜单放顶部）：');
  fs.writeFileSync(setFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(setFile, 'utf8')), 外观: { 菜单: 'top' } }, null, 2));
  app = launch();
  home = await waitPage(HOME, 45000);
  check(!!home, '不用再登录，直接进总览');
  check(seen.includes('/api/auth/refresh-token'), '启动时续了一回登录');
  const ft2 = home && await waitPage(FRAME, 5000);
  if (check(!!ft2, '外框页开着')) {
    const f2 = await connect(ft2.webSocketDebuggerUrl), c2 = await connect(home.webSocketDebuggerUrl);
    await sleep(2500);
    s = await frameState(f2);
    check(s.menu === 'top' && !s.railOn && s.current === 'pipeline', '菜单排进顶栏了', JSON.stringify(s));
    check(await evaluate(f2, `(() => { const b = document.querySelector('#tabs button.on'); return !!b && b.textContent === '流水线' && getComputedStyle(document.getElementById('rail')).display === 'none' && !document.querySelector('#rail button'); })()`), '顶栏里「流水线」亮着，左边那一条收起来了');
    bad = await fits(f2, c2, s);
    check(!bad, '流水线摆在顶栏下面、占满宽', bad);
    check(winShot('窗口3_菜单在顶'), '截了整个窗口（菜单在顶）');
    evaluate(f2, `document.querySelector('[data-win="close"]').click()`).catch(() => {});   // 软件一退，调试口就断了，等不到回话
    await sleep(300);
    f2.close();
    c2.close();
  }
  check(await exited(app), '点关闭钮：没有没存的，不问，软件自己退了');
  app = null;
  check(!(await ping(port)), '关掉软件后，本机服务也关了');

  const errs = logLines().filter(l => / ERROR /.test(l) || / WARN \[页面\]/.test(l));
  check(errs.length === 0, '日志里没有出错', errs.slice(0, 12).join('\n'));
} catch (e) {
  if (e.message !== '停') check(false, '冒烟中途出错', e.stack || e.message);
} finally {
  if (app && app.exitCode === null) killTree(app);
  mock.close();
  await sleep(500);
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
}
console.log(failed ? `\n没过：${failed} 处` : '\n都过了。截图在 build/smoke');
process.exit(failed ? 1 : 0);
