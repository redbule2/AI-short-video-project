'use strict';
/* 流水线桌面版（开发规范第 11–22 条）
   壳只管登录、窗口、更新、报错；流水线照旧由工作文件夹里的本机服务跑，窗口只开本机服务，外链交给系统浏览器。
   窗口没有系统边框，也没有系统菜单：顶栏、三个窗口按钮、菜单、设置都是外框页（外框/外框.html，装在软件里）画的。
   菜单里每一项（lib/routes.js）各开一个视图摆在中间那块，切走不关；登录页也摆在那一块。点「设置」时各页收起来，露出外框页画的设置。
   启动顺序：定工作文件夹 → 开窗口（外框）→ 把安装包里的工具同步进去 → 开本机服务 → 续上登录（没登录开登录页）→ 开流水线 → 查更新
   试验用的环境变量（scripts/smoke.mjs 用）：ANTOU_DESK_WORK（工作文件夹）、ANTOU_DESK_DATA（设置、登录、日志放哪）、ANTOU_PORT（端口）、
     ANTOU_DESK_API（登录服务器）、ANTOU_DESK_NO_UPDATE=1（不查更新）、ANTOU_DESK_NO_FOCUS=1（窗口出来不抢键盘）、
     ANTOU_DESK_AT=x,y（窗口摆在哪：试验时摆到屏幕外面，不挡正在用电脑的人） */
const { app, BrowserWindow, WebContentsView, Menu, dialog, shell, ipcMain, session, net, safeStorage, crashReporter } = require('electron');
const fs = require('fs');
const path = require('path');
const { makeLog } = require('./lib/log.js');
const { makeSettings, writeAtomic, unbom } = require('./lib/settings.js');
const { syncTools } = require('./lib/sync.js');
const { startServer } = require('./lib/runner.js');
const { makeAuth } = require('./lib/auth.js');
const { makeUpdater } = require('./lib/updater.js');
const { ROUTES, BAR, RAIL, find, fixLook, railOn, stage } = require('./lib/routes.js');

const APP_NAME = 'AI短视频流水线';
const APP_ID = 'online.video8.liushuixian.desktop';
const API = (process.env.ANTOU_DESK_API || 'https://video8.online').replace(/\/+$/, '');
const LOGIN = 'login';   // 登录页占的那个视图；不在菜单里
const SET = 'settings';   // 设置：外框页自己画在中间那块，不另开视图
const LOGIN_PAGE = '通用工具/桌面版/页面/登录.html';
const PRELOAD = path.join(__dirname, 'preload.js');
const FRAME_PAGE = path.join(__dirname, '外框', '外框.html');
const FRAME_PRELOAD = path.join(__dirname, '外框', 'preload.js');
const PAPER = '#f4efe6';   // 页面还没画出来时的底色
const PAGE_PREFS = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false };
const NO_FOCUS = process.env.ANTOU_DESK_NO_FOCUS === '1';
const AT = (process.env.ANTOU_DESK_AT || '').split(',').map(Number);
const PLACE = AT.length === 2 && AT.every(Number.isFinite) ? { x: AT[0], y: AT[1] } : {};
const ALLOWED_PERMS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'fullscreen']);

const DATA_DIR = require('./package.json').dataDirName || 'Liushuixian';   // 试装包（pack.mjs trial）打进 LiushuixianTrial：和正式版的设置、登录、单开锁各用各的
app.setPath('userData', process.env.ANTOU_DESK_DATA ? path.resolve(process.env.ANTOU_DESK_DATA) : path.join(app.getPath('appData'), DATA_DIR));   // 设置、登录、日志放这里；英文名，命令行工具不怕
app.setAppUserModelId(APP_ID);
app.setPath('crashDumps', path.join(app.getPath('userData'), 'Crashpad'));
crashReporter.start({ uploadToServer: false, compress: true });   // 崩了只在本机留文件（以后随报告带回，开发规范第 20 条）；不开的话每回启动在程序旁边写一行连不上的报错
const log = makeLog(path.join(app.getPath('userData'), 'logs'));
const settings = makeSettings(path.join(app.getPath('userData'), '设置.json'));
process.on('uncaughtException', e => log.error('主进程出错', e));
process.on('unhandledRejection', e => log.error('主进程有个出错没接住', e));

let win = null, server = null, auth = null, updater = null;
let work = '', port = 0, quitting = false, user = null;
let look = fixLook(settings.get('外观'));   // 菜单放左边还是顶部
const pages = new Map();                    // 摆在中间那块的各页：菜单项的 id（或 LOGIN）→ { view, title }
let current = '', before = '';              // 现在摆着哪一页（SET 是设置）；点开设置前摆着的那一页
let closing = false, asking = false, quitAsked = false;   // 关窗口：各页都答应了 / 正在一页页问 / 是点了退出（不只是关窗口）

const origin = () => `http://127.0.0.1:${port}`;
const pageUrl = rel => origin() + '/' + rel.split('/').map(encodeURIComponent).join('/');
const alive = w => (w && !w.isDestroyed() ? w : null);
const box = (opts, w = win) => (alive(w) ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts));
const boxSync = (opts, w = win) => (alive(w) ? dialog.showMessageBoxSync(w, opts) : dialog.showMessageBoxSync(opts));
const stamp = () => new Date().toLocaleString('sv-SE').replace(/[-:]/g, '').replace(' ', '-');   // 20261124-153000
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 是不是本机服务的页面：只认 127.0.0.1、localhost 和这个端口 */
function isOurs(url) {
  try {
    const u = new URL(url);
    return port > 0 && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname) && Number(u.port) === port;
  } catch (e) { return false; }
}
/* 考试的题图、答题图放在登录服务器上，考试页里写的是站内地址（/uploads/exam/…）：本机服务没有，认出来换成服务器上的 */
function farFile(url) {
  try {
    const u = new URL(url);
    return isOurs(url) && u.pathname.startsWith('/uploads/exam/') ? API + u.pathname : '';
  } catch (e) { return ''; }
}
function openOutside(url) {
  try {
    const u = new URL(url);
    if (['http:', 'https:', 'mailto:'].includes(u.protocol)) { log.info('外链交给系统浏览器', { url: u.origin + u.pathname }); shell.openExternal(u.href); }
    else log.warn('拦下了打开别的地方', { protocol: u.protocol });
  } catch (e) { log.warn('拦下了打不开的链接'); }
}

/* ---------- 工作文件夹 ---------- */
function writable(dir) {
  const t = path.join(dir, '.antou-test-' + process.pid);
  try { fs.mkdirSync(t); fs.rmdirSync(t); return true; } catch (e) { return false; }
}
/* 有 D 盘放 D 盘（片子大，别挤 C 盘），没有就放「文档」 */
function defaultWork() {
  if (fs.existsSync('D:\\') && writable('D:\\')) return 'D:\\AI短视频项目';
  return path.join(app.getPath('documents'), 'AI短视频项目');
}
const looksLikeWork = d => fs.existsSync(path.join(d, '项目')) || fs.existsSync(path.join(d, '通用工具'));

async function pickWork(note) {
  const def = defaultWork();
  const r = await dialog.showMessageBox({
    type: 'question', title: APP_NAME, noLink: true, defaultId: 0, cancelId: 2,
    message: '项目放在哪个文件夹？',
    detail: `剧本、提示词、图和片子都放在这里，以后升级不会动它。\n\n默认放在：${def}` + (note ? '\n\n' + note : ''),
    buttons: ['就放这里', '换个文件夹…', '退出'],
  });
  if (r.response === 2) return '';
  let dir = def;
  if (r.response === 1) {
    const p = await dialog.showOpenDialog({ title: '选放项目的文件夹', defaultPath: path.dirname(def), properties: ['openDirectory', 'createDirectory'] });
    if (p.canceled || !p.filePaths[0]) return pickWork(note);
    dir = p.filePaths[0];
    if (!looksLikeWork(dir) && fs.readdirSync(dir).length) dir = path.join(dir, 'AI短视频项目');   // 别的东西堆着的文件夹：在里面另建一个
  }
  fs.mkdirSync(dir, { recursive: true });
  settings.set('工作文件夹', dir);
  log.info('定了工作文件夹', { dir });
  return dir;
}

async function chooseWork() {
  const env = process.env.ANTOU_DESK_WORK;
  if (env) { fs.mkdirSync(env, { recursive: true }); return path.resolve(env); }
  const saved = settings.get('工作文件夹');
  if (saved && fs.existsSync(saved)) return saved;
  return pickWork(saved ? `上回用的 ${saved} 找不到了。` : '');
}

async function changeWork() {
  const opts = { title: '换放项目的文件夹', defaultPath: work, properties: ['openDirectory', 'createDirectory'] };
  const p = alive(win) ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (p.canceled || !p.filePaths[0]) return;
  let dir = p.filePaths[0];
  if (!looksLikeWork(dir) && fs.readdirSync(dir).length) dir = path.join(dir, 'AI短视频项目');
  const r = await box({ type: 'question', noLink: true, buttons: ['换，重开软件', '不换'], defaultId: 0, cancelId: 1, message: '换到这个文件夹？', detail: dir + '\n\n原来文件夹里的项目不会挪，也不会删。' });
  if (r.response !== 0) return;
  fs.mkdirSync(dir, { recursive: true });
  settings.set('工作文件夹', dir);
  log.info('换了工作文件夹', { from: work, to: dir });
  app.relaunch();
  app.quit();
}

/* ---------- 工具文件、本机服务 ---------- */
const toolsDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'tools') : path.join(__dirname, 'build', 'tools'));
function nodeExe() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'node', 'node.exe');
  const staged = path.join(__dirname, 'build', 'node', 'node.exe');
  return fs.existsSync(staged) ? staged : 'node';
}

function syncInto(dir) {
  let bundle;
  try { bundle = JSON.parse(unbom(fs.readFileSync(path.join(toolsDir(), '清单.json'), 'utf8'))); }
  catch (e) {
    if (!app.isPackaged) { log.info('开发时没有备好的工具（先跑 pnpm stage），不同步'); return null; }
    throw new Error('安装包里的工具清单读不了，重装一下试试。' + e.message);
  }
  const key = path.resolve(dir).toLowerCase();
  const all = settings.get('已装工具') || {};
  const backupDir = path.join(app.getPath('userData'), '升级备份', stamp());
  const r = syncTools({ src: toolsDir(), work: dir, bundle: bundle.文件 || {}, installed: (all[key] && all[key].文件) || {}, backupDir, log: (m, x) => log.info(m, x) });
  if (r.skipped) { log.info(r.skipped, { dir }); return r; }
  all[key] = { 版本: bundle.版本, 提交: bundle.提交, 时间: new Date().toISOString(), 文件: r.installed };
  settings.set('已装工具', all);
  if (r.backedUp.length) log.warn('本机改过的工具文件先备份了，再换成新的', { 到: backupDir, 文件: r.backedUp.slice(0, 50) });
  if (r.bad.length) log.warn('清单里有认不出的路径，没装', { 文件: r.bad.slice(0, 20) });
  return r;
}

function serverEnv() {
  const env = { ...process.env, ANTOU_ROOT: work, ANTOU_PORT: String(port) };
  for (const k of Object.keys(env)) if (/^(ELECTRON_|CHROME_CRASHPAD)/i.test(k)) delete env[k];   // 壳自己的，别传给服务开的 Codex、Claude 这些 Electron 软件
  const p = settings.get('路径') || {};
  for (const [k, v] of Object.entries({ BRIDGE_PY: p.python, ANTOU_FFMPEG: p.ffmpeg, ANTOU_JIMENG: p.jimeng, ANTOU_DSH_EXE: p.deepseek, ANTOU_DOUBAO_EXE: p.doubao })) if (v) env[k] = v;   // deepseek：DeepSeek Harness.exe；doubao：DoubaoWork.exe（链接没登记的电脑上手动指）
  const exe = nodeExe();
  if (path.isAbsolute(exe)) {   // 带的 Node 放在 PATH 最后：本机自己装了 Node 的，命令行工具照旧用自己的
    const k = Object.keys(env).find(x => x.toUpperCase() === 'PATH') || 'Path';
    env[k] = (env[k] ? env[k] + ';' : '') + path.dirname(exe);
  }
  return env;
}

async function openServer() {
  server = await startServer({ nodeExe: nodeExe(), work, port, env: serverEnv(), log });
  server.onExit((x, tail) => { if (!quitting) serverDied(tail); });
}

async function serverDied(tail) {
  const r = await box({
    type: 'error', title: '本机服务停了', noLink: true, defaultId: 0, cancelId: 2,
    message: '流水线的本机服务停了', detail: (tail || '') + '\n\n日志：' + log.file(),
    buttons: ['重开', '打开日志文件夹', '退出'],
  });
  if (r.response === 1) shell.openPath(log.dir);
  if (r.response === 2) return app.quit();
  if (r.response === 0) {
    try { await openServer(); for (const p of pages.values()) p.view.webContents.reload(); }
    catch (e) { fatal(e); }
  }
}

/* ---------- 登录 ---------- */
function tokenStore() {
  const file = path.join(app.getPath('userData'), '登录.bin');
  let mem = null;
  return {
    read() {
      if (mem) return mem;
      try {
        if (!safeStorage.isEncryptionAvailable()) return null;
        mem = JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
        return mem;
      } catch (e) { if (e.code !== 'ENOENT') log.warn('本机存的登录读不了', { message: e.message }); return null; }
    },
    write(obj) {
      mem = obj;
      if (!safeStorage.isEncryptionAvailable()) { log.warn('这台电脑不能加密存登录：只在这回开着时记住'); return; }
      writeAtomic(file, safeStorage.encryptString(JSON.stringify(obj)));
    },
    remove() { mem = null; try { fs.unlinkSync(file); } catch (e) { /* 本来就没有 */ } },
  };
}

function afterLogin(u) {
  user = u;
  setTimeout(async () => {   // 先让登录页说一声「登录好了」，再换成流水线（菜单这时才出来）
    if (!alive(win) || user !== u) return;
    await closePage(LOGIN);
    go(ROUTES[0].id);
  }, 400);
}
async function logout(why) {
  if (!(await closePages())) return;   // 有一页还有没存的、选了留下：先不退
  auth.logout();
  user = null;
  openPage(LOGIN, pageUrl(LOGIN_PAGE) + (typeof why === 'string' && why ? '#why=' + encodeURIComponent(why) : ''));
}

/* ---------- 窗口、外框 ---------- */
const routesNow = () => (user ? ROUTES : []);   // 没登录时菜单里一项也没有

/* 设置里「版本」那一行：写什么话、给哪个钮（check 检查更新，install 现在重启装上，空的不给） */
function updateNow() {
  const r = updater.status();
  const say = { checking: '正在查…', 'not-available': '已经是最新的了', available: '发现新版本，正在后台下，下好了会问你' };
  return { text: say[r.status] || r.message, can: !updater.enabled ? '' : r.status === 'downloaded' ? 'install' : 'check' };
}
/* 外框页照这个画（外框/外框.js 的 draw） */
function frameState() {
  const p = pages.get(current);
  return {
    app: APP_NAME, bar: BAR, rail: RAIL, menu: look.菜单, railOn: railOn(look, routesNow().length),
    routes: routesNow().map(r => ({ id: r.id, 名: r.名, 图标: r.图标 })), current,
    title: current === SET ? '设置' : p ? p.title : '', offline: !!(user && user.offline), busy: pages.size ? '' : '正在打开流水线…',
    maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused(),
    user: user ? user.nickname || user.username : '', team: !user || !user.accountType ? '' : user.accountType === 'sub' ? `团队「${user.ownerUsername}」的成员` : '团队负责人', work, version: app.getVersion(), update: updateNow(),   // 这一行和下一行是设置里写的
    note: `本机服务 ${origin()}　登录服务器 ${API}　Electron ${process.versions.electron}`,
  };
}
/* 有变化就说给外框；任务栏上看到的窗口名也跟着 */
function tell() {
  if (!alive(win)) return;
  const s = frameState();
  win.setTitle((s.title ? s.title + ' — ' : '') + APP_NAME + (s.offline ? '（离线）' : ''));
  win.webContents.send('frame:state', s);
}
/* 各页摆到中间那块；只让现在这一页露出来 */
function layout() {
  if (!alive(win)) return;
  const rect = stage(win.contentView.getBounds(), look, routesNow().length);   // 窗口里面实际多大，问装各页的那一层：最大化那一下 getContentSize() 报的还是没变完的数
  for (const [id, p] of pages) { p.view.setBounds(rect); p.view.setVisible(id === current); }
}

function makeWindow() {
  const w = new BrowserWindow({
    width: 1440, height: 920, ...PLACE, minWidth: 900, minHeight: 600, show: false, backgroundColor: PAPER, title: APP_NAME,
    frame: false,   // 没有系统边框：顶栏和三个窗口按钮在外框页里
    webPreferences: { preload: FRAME_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  w.once('ready-to-show', () => (NO_FOCUS ? w.showInactive() : w.show()));
  w.on('page-title-updated', e => e.preventDefault());   // 窗口名由 tell() 定
  w.contentView.on('bounds-changed', layout);   // 拖边、最大化、还原、全屏：里面大小一变就重摆
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) w.on(ev, () => { layout(); tell(); });
  for (const ev of ['focus', 'blur']) w.on(ev, tell);
  w.on('close', e => {
    if (closing || !pages.size) return;
    e.preventDefault();   // 先一页页问有没有没存的，都答应了再真关
    if (asking) return;
    const quit = quitAsked;
    quitAsked = false;
    asking = true;
    closePages().then(ok => {
      asking = false;
      if (!ok || !alive(w)) return;
      closing = true;
      if (quit) app.quit(); else w.close();
    });
  });
  w.on('closed', () => { win = null; });
  w.webContents.on('render-process-gone', () => { if (!w.isDestroyed()) w.loadFile(FRAME_PAGE); });   // 外框页崩了就重画，不然窗口上连关闭钮都没有
  w.loadFile(FRAME_PAGE);
  return w;
}

/* ---------- 中间那块：菜单里每一项各开一个视图，切走不关；登录页也摆在这里 ---------- */
/* 摆出一页：没开过的先开。回的是这一页头一回打开的结果（没打开会抛） */
function openPage(id, url) {
  let p = pages.get(id);
  if (!p) {
    const view = new WebContentsView({ webPreferences: PAGE_PREFS });
    view.setBackgroundColor(PAPER);
    p = { view, title: '' };
    pages.set(id, p);
    view.webContents.on('page-title-updated', (e, title) => { p.title = title; tell(); });
    win.contentView.addChildView(view);
    p.loaded = view.webContents.loadURL(url);
    p.loaded.catch(() => {});   // 没打开的在 guard 的 did-fail-load 里记了；要等结果的自己接 p.loaded
  }
  show(id);
  return p.loaded;
}
/* 把一页摆到前面（SET 是设置：各页都收起来，露出外框页画的那一块） */
function show(id) {
  current = id;
  layout();
  tell();
  const p = pages.get(id);
  if (!NO_FOCUS) (p ? p.view.webContents : win.webContents).focus();
}
/* 点「设置」：打开；开着时再点一下（或点它的「返回」）回原来那一页 */
function toggleSet() {
  if (current !== SET) { before = current; return show(SET); }
  show(pages.has(before) ? before : [...pages.keys()][0] || '');
}
/* 点菜单里的一项 */
function go(id) {
  const r = find(id);
  return r && user && alive(win) ? openPage(r.id, pageUrl(r.页)) : Promise.resolve();
}
/* 现在这一块回它的首页（流水线回总览） */
function home() {
  const r = find(current), p = pages.get(current);
  if (r && p) p.view.webContents.loadURL(pageUrl(r.页)).catch(() => {});
}
/* 关一页：页里有没存的会先问（guard 里的「离开／留下」）；选了留下回 false，这一页照旧开着 */
function closePage(id) {
  const p = pages.get(id);
  if (!p) return Promise.resolve(true);
  const wc = p.view.webContents;
  return new Promise(resolve => {
    const done = ok => {
      wc.off('destroyed', gone);
      wc.off('desk-stay', stay);
      if (ok) {
        pages.delete(id);
        if (alive(win)) win.contentView.removeChildView(p.view);
        if (current === id) current = '';
      }
      resolve(ok);
    };
    const gone = () => done(true), stay = () => done(false);
    if (wc.isDestroyed()) return done(true);
    wc.once('destroyed', gone);
    wc.once('desk-stay', stay);
    wc.close({ waitForBeforeUnload: true });
  });
}
/* 全关（关窗口、退出登录前）：有一页选了留下就停，把那一页摆出来 */
async function closePages() {
  const n = pages.size;
  for (const id of [...pages.keys()]) {
    if (await closePage(id)) continue;
    show(id);
    return false;
  }
  if (n) await sleep(250);   // 页面关的时候顺手存的那一下（剧本页等）要一点工夫才到本机服务，别抢在前头把服务关了
  tell();
  return true;
}

/* 所有页面都照这几条：只开本机服务，别的交给系统浏览器；不许嵌 webview；离开前有没存的要问 */
function guard(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    const far = farFile(url);
    if (far) { openOutside(far); return { action: 'deny' }; }   // 点开考试里的图：交给系统浏览器看大图
    if (isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: PAPER, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false } } };
    openOutside(url);
    return { action: 'deny' };
  });
  const stay = (e, url) => {
    const u = (e && e.url) || url;
    if (u && !isOurs(u)) { e.preventDefault(); openOutside(u); }
  };
  wc.on('will-navigate', stay);
  wc.on('will-redirect', stay);
  wc.on('will-attach-webview', e => e.preventDefault());
  wc.on('will-prevent-unload', e => {
    const r = boxSync({ type: 'question', title: APP_NAME, buttons: ['离开', '留下'], defaultId: 1, cancelId: 1, noLink: true, message: '这一页还有没存的改动', detail: '离开就丢了。确定离开？' }, BrowserWindow.fromWebContents(wc) || win);
    if (r === 0) e.preventDefault();   // 照样离开
    else wc.emit('desk-stay');         // 留下：closePage 等着这一声
  });
  wc.on('console-message', (e, level, message, line, source) => {
    const d = e && e.message !== undefined ? e : { level, message, lineNumber: line, sourceId: source };
    if (d.level === 3 || d.level === 'error') log.warn('[页面] ' + d.message, { at: `${d.sourceId || ''}:${d.lineNumber || ''}` });
  });
  wc.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) log.warn('页面没打开', { code, desc, url }); });
}

function harden(ses) {
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    const ok = ALLOWED_PERMS.has(perm) && isOurs((details && details.requestingUrl) || wc.getURL());
    if (!ok) log.warn('拦下了权限请求', { perm });
    cb(ok);
  });
  ses.setPermissionCheckHandler((wc, perm, requestingOrigin) => ALLOWED_PERMS.has(perm) && isOurs(requestingOrigin + '/'));
}

/* 页面经 preload 调的几样：只认本机服务的页面；登录、注册只认登录页，问服务器只认考试那一页。外框页调的（frame:）只认外框页自己 */
function ipc() {
  const from = (e, only) => {
    const u = e.senderFrame && e.senderFrame.url;
    if (!u || !isOurs(u)) { log.warn('拦下了不是本机页面的调用', { url: u }); return false; }
    if (only && decodeURIComponent(new URL(u).pathname) !== '/' + only) { log.warn('拦下了别的页面的调用', { 只许: only }); return false; }
    return true;
  };
  ipcMain.handle('desk:info', e => (from(e) ? { app: APP_NAME, version: app.getVersion(), user, work, port, api: API } : null));
  ipcMain.handle('desk:login', async (e, u, p) => {
    if (!from(e, LOGIN_PAGE)) return { ok: false, message: '不许' };
    const r = await auth.login(u, p);
    if (r.ok) afterLogin(r.user);
    return r;
  });
  ipcMain.handle('desk:register', async (e, u, p, again, team) => {
    if (!from(e, LOGIN_PAGE)) return { ok: false, message: '不许' };
    const r = await auth.register(u, p, again, team);
    if (r.ok) afterLogin(r.user);
    return r;
  });
  ipcMain.handle('desk:logout', e => { if (from(e)) logout(); return true; });
  let expiring = false;
  ipcMain.handle('desk:api', async (e, method, pathname, opts) => {
    if (!from(e, find('exam').页)) return { ok: false, status: 400, data: null };
    const r = await auth.api(method, pathname, opts);
    if (r.status === 401 && user && !expiring) {   // 凭证续不上了：回登录页
      expiring = true;
      logout('登录过期了，请重新登录').finally(() => { expiring = false; });
    }
    return r;
  });

  const fromFrame = e => !!alive(win) && e.sender === win.webContents;
  ipcMain.handle('frame:state', e => (fromFrame(e) ? frameState() : null));
  ipcMain.on('frame:win', (e, what) => {
    if (!fromFrame(e)) return;
    if (what === 'min') win.minimize();
    else if (what === 'close') win.close();
    else if (what === 'max') {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    }
  });
  ipcMain.on('frame:go', (e, id) => { if (fromFrame(e)) (id === SET ? toggleSet() : go(id)); });
  ipcMain.on('frame:do', (e, what, arg) => { if (fromFrame(e) && Object.hasOwn(DO, what)) DO[what](arg); });
}

/* ---------- 设置、快捷键：窗口上没有系统菜单。设置是外框页画的，这里是它那几个钮要办的事 ---------- */
function setLook(patch) {
  look = fixLook({ ...look, ...patch });
  settings.set('外观', look);
  layout();
  tell();
}
/* 设置里的钮（外框页经 frame:do 叫；钮上的 data-do 对着这里的名字） */
const DO = {
  logout,
  work: () => shell.openPath(work),
  'change-work': changeWork,
  menu: where => setLook({ 菜单: where }),
  update: () => updater.check(),   // 查到什么：updater 一变就 tell()，写回设置里
  install: () => updater.install(),
  logs: () => shell.openPath(log.dir),
};
/* 刷新、放大这些管哪一页：另开的小窗管它自己，不然管中间摆着的那一页（不管外框） */
function onPage(fn) {
  return () => {
    const f = BrowserWindow.getFocusedWindow(), p = pages.get(current);
    const wc = f && f !== win ? f.webContents : p && p.view.webContents;
    if (wc && !wc.isDestroyed()) fn(wc);
  };
}
/* 只有快捷键的几样：排成一份不露面的菜单，按键才管用 */
const KEYS = [
  { label: '回到首页', accelerator: 'Alt+Home', click: home },
  { label: '刷新', accelerator: 'CmdOrCtrl+R', click: onPage(wc => wc.reload()) },
  { label: '开发者工具', accelerator: 'F12', click: onPage(wc => wc.toggleDevTools()) },
  { label: '放大', accelerator: 'CmdOrCtrl+=', click: onPage(wc => wc.setZoomLevel(wc.getZoomLevel() + 0.5)) },
  { label: '缩小', accelerator: 'CmdOrCtrl+-', click: onPage(wc => wc.setZoomLevel(wc.getZoomLevel() - 0.5)) },
  { label: '原样大小', accelerator: 'CmdOrCtrl+0', click: onPage(wc => wc.setZoomLevel(0)) },
  { label: '全屏', accelerator: 'F11', click: () => alive(win) && win.setFullScreen(!win.isFullScreen()) },
];

/* ---------- 启动、出错、退出 ---------- */
async function fatal(e) {
  log.error('打不开', e);
  const text = String((e && e.message) || e);
  const [first, ...rest] = text.split('\n');
  const r = await dialog.showMessageBox({
    type: 'error', title: APP_NAME + ' 打不开', noLink: true, defaultId: 1, cancelId: 1,
    message: first, detail: (rest.length ? rest.join('\n') + '\n\n' : '') + '日志：' + log.file(),
    buttons: ['打开日志文件夹', '退出'],
  });
  if (r.response === 0) await shell.openPath(log.dir);
  quitting = true;
  if (server) server.stop();
  app.exit(1);
}

async function boot() {
  log.info('启动', { 版本: app.getVersion(), electron: process.versions.electron, 系统: process.getSystemVersion(), 打包: app.isPackaged, api: API });
  harden(session.defaultSession);
  app.on('web-contents-created', (_, wc) => guard(wc));
  auth = makeAuth({ api: API, fetch: (u, { timeout = 10000, ...o }) => net.fetch(u, { ...o, signal: AbortSignal.timeout(timeout) }), store: tokenStore(), log });
  updater = makeUpdater({ app, dialog, getWindow: () => win, log, onChange: tell });
  ipc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '快捷键', submenu: KEYS }]));   // 不露面，只为那几个快捷键
  work = await chooseWork();
  if (!work) { quitting = true; return app.quit(); }
  port = Number(process.env.ANTOU_PORT) || Number(settings.get('端口')) || 8766;
  log.info('工作文件夹和端口', { work, port });
  win = makeWindow();
  syncInto(work);
  await openServer();
  session.defaultSession.webRequest.onBeforeRequest({ urls: [origin() + '/uploads/exam/*'] }, (d, cb) => cb({ redirectURL: farFile(d.url) }));   // 考试页里的图：转到登录服务器去拿
  const r = await auth.resume();
  user = r.ok ? r.user : null;
  await (user ? go(ROUTES[0].id) : openPage(LOGIN, pageUrl(LOGIN_PAGE) + (r.why ? '#why=' + encodeURIComponent(r.why) : '')));
  updater.configure();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.on('render-process-gone', (e, wc, d) => log.error('页面进程没了', d));
  app.on('child-process-gone', (e, d) => log.error('子进程没了', d));
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitAsked = true; });   // 窗口那头先一页页问过（makeWindow 的 close），都答应了才真退
  app.on('will-quit', () => { quitting = true; if (server) server.stop(); });   // 窗口都关了才停本机服务：页面关的时候还要找它存东西
  app.whenReady().then(boot).catch(fatal);
}
