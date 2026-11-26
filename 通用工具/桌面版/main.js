'use strict';
/* 流水线桌面版（开发规范第 11–22 条）
   壳只管登录、窗口、更新、报错；流水线照旧由工作文件夹里的本机服务跑，窗口只开本机服务，外链交给系统浏览器。
   窗口没有系统边框，也没有系统菜单：顶栏、三个窗口按钮、菜单、设置都是外框页（外框/外框.html，装在软件里）画的。
   菜单里每一项（lib/routes.js）各开一个视图摆在中间那块，切走不关；登录页也摆在那一块。点「设置」时右边拉出外框页画的设置那一栏，中间那一页让开、照样露着（换皮肤当场看得到）。
   启动顺序：定工作文件夹 → 开窗口（外框）→ 把安装包里的工具同步进去 → 开本机服务（软件开着就一直看着它，停了自己重开）→ 续上登录（没登录开登录页）→ 开流水线 → 查更新
   试验用的环境变量（scripts/smoke.mjs 用）：ANTOU_DESK_WORK（工作文件夹）、ANTOU_DESK_DATA（设置、登录、日志放哪）、ANTOU_PORT（端口）、
     ANTOU_DESK_API（登录服务器）、ANTOU_DESK_NO_UPDATE=1（不查更新）、ANTOU_DESK_NO_FOCUS=1（窗口出来不抢键盘）、
     ANTOU_DESK_AT=x,y（窗口摆在哪：试验时摆到屏幕外面，不挡正在用电脑的人）、ANTOU_DESK_NO_TOAST=1（来了新消息不弹提醒、不闪任务栏，只记一行日志） */
const { app, BrowserWindow, WebContentsView, Menu, dialog, shell, ipcMain, session, net, safeStorage, crashReporter, webContents, Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const { makeLog } = require('./lib/log.js');
const { makeSettings, writeAtomic, unbom } = require('./lib/settings.js');
const { syncTools } = require('./lib/sync.js');
const { keepServer } = require('./lib/runner.js');
const { makeAuth } = require('./lib/auth.js');
const { makeUpdater } = require('./lib/updater.js');
const { makeChat } = require('./lib/chat.js');
const { ROUTES, BAR, RAIL, DRAWER, find, fixLook, railOn, stage, skinOf, skinForPage } = require('./lib/routes.js');

const APP_NAME = 'AI短视频流水线';
const APP_ID = 'online.video8.liushuixian.desktop';
/* 登录服务器：直接连服务器的 IP，不加密（2026-11-26 用户定）。
   为什么不用域名：video8.online 没备案，被腾讯云按域名拦着，不开代理连不上；直接连 IP 不拦（服务器上 nginx 的 video8-assets 那一路，和域名是同一个网站、同一个后台）。
   不加密的意思：账号密码、登录凭证、升级清单在网上都是明文。以后补加密（自己签一张证书、软件只认这一张），改这一行和 electron-builder.yml 的升级地址。
   服务器的 IP 变了，这里要跟着改，装过的人都得重装。 */
const API = (process.env.ANTOU_DESK_API || 'http://43.143.83.166').replace(/\/+$/, '');
const LOGIN = 'login';   // 登录页占的那个视图；不在菜单里
const SET = 'settings';   // 设置：外框页自己画在右边那一栏，不另开视图
const CHAT = 'chat';      // 「消息」那一项（lib/routes.js）
const LOGIN_PAGE = '通用工具/桌面版/页面/登录.html';
const PRELOAD = path.join(__dirname, 'preload.js');
const FRAME_PAGE = path.join(__dirname, '外框', '外框.html');
const FRAME_PRELOAD = path.join(__dirname, '外框', 'preload.js');
const PAGE_PREFS = { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false };
const NO_FOCUS = process.env.ANTOU_DESK_NO_FOCUS === '1';
const NO_TOAST = process.env.ANTOU_DESK_NO_TOAST === '1';
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

let win = null, server = null, auth = null, updater = null, chat = null;
let work = '', port = 0, user = null;
let srv = '', srvTip = '';                  // 本机服务停着、没开起来时顶栏那块小牌子写什么、指上去看什么；好好的是空的
let look = fixLook(settings.get('外观'));   // 菜单放左边还是顶部、用哪套皮肤
const skinNow = () => skinOf(look.皮肤);     // 现在这套皮肤：{ 名, 底（页面还没画出来时的底色）, 纸面 }
const pages = new Map();                    // 摆在中间那块的各页：菜单项的 id（或 LOGIN）→ { view, title }
let current = '';                           // 现在摆着哪一页
let setOpen = false;                        // 设置那一栏开着没有：开着时中间那一页往左让开，照样露着、照样能换页
let closing = false, asking = false, quitAsked = false;   // 关窗口：各页都答应了 / 正在一页页问 / 是点了退出（不只是关窗口）

const origin = () => `http://127.0.0.1:${port}`;
const pageUrl = rel => origin() + '/' + rel.split('/').map(encodeURIComponent).join('/');
const routeUrl = r => pageUrl(r.页) + (r.起 || '');   // 菜单里一项的网址：有「起」的接在后面（「我的团队」和「考试」同一份页面，靠它进各自那一页）
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

/* 本机服务常驻（lib/runner.js 的 keepServer）：停了它自己重开、不弹窗，这里只在顶栏挂一块小牌子（点了打开日志文件夹）。
   又好了：停着那会儿没打开的页重开一回；开着好好的页不动，免得冲掉没存的字 */
async function openServer() {
  server = await keepServer({ nodeExe: nodeExe(), work, port, env: serverEnv(), log, onChange: serverChanged });
}
function serverChanged(s) {
  srv = s.up ? '' : s.error ? '本机服务没开起来，正在重试' : '本机服务停了，正在重开';
  srvTip = s.error ? s.error.split('\n').slice(0, 8).join('\n') + '\n\n点一下打开日志文件夹' : '';
  if (s.up) for (const p of pages.values()) if (p.failed) { p.failed = false; p.view.webContents.reload(); }
  tell();
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
  chat.start(u.username);
  setTimeout(async () => {   // 先让登录页说一声「登录好了」，再换成流水线（菜单这时才出来）
    if (!alive(win) || user !== u) return;
    await closePage(LOGIN);
    go(ROUTES[0].id);
  }, 400);
}
async function logout(why) {
  if (!(await closePages())) return;   // 有一页还有没存的、选了留下：先不退
  chat.stop();
  chatReady = null;
  chatWant = null;
  auth.logout();
  user = null;
  setOpen = false;   // 回登录页：设置那一栏收起来
  openPage(LOGIN, pageUrl(LOGIN_PAGE) + (typeof why === 'string' && why ? '#why=' + encodeURIComponent(why) : ''));
}
/* 替页面、替收消息问服务器：凭证续不上了（401）就回登录页 */
let expiring = false;
async function serverApi(method, pathname, opts) {
  const r = await auth.api(method, pathname, opts);
  if (r.status === 401 && user && !expiring) {
    expiring = true;
    logout('登录过期了，请重新登录').finally(() => { expiring = false; });
  }
  return r;
}

/* ---------- 消息（团队聊天）：壳子在后台收新消息（lib/chat.js），转给「消息」那一页；没看的条数写在菜单上，人不在眼前时右下角提醒 ---------- */
let chatReady = null;   // 「消息」那一页准备好收了：它的 webContents（页面调 desk.onChat 时说的）
let chatWant = null;    // 等它准备好了要打开的会话：{ conversationId } 或 { with: 对方账号 }
let toast = null;       // 右下角那一条：来了新的先收掉旧的，免得一摞；也留着它，点它才叫得应
const chatHooked = new WeakSet();
function sendChat(payload) {
  if (chatReady && !chatReady.isDestroyed()) chatReady.send('desk:chat', payload);
}
function flushChat() {
  if (!chatWant || !chatReady || chatReady.isDestroyed()) return;
  sendChat({ open: chatWant });
  chatWant = null;
}
/* 打开「消息」，进某个会话（点了右下角的提醒、「我的团队」里点了「发消息」）；target 空的只打开 */
function openChat(target) {
  if (!user || !alive(win)) return;
  if (win.isMinimized()) win.restore();
  if (NO_FOCUS) win.showInactive(); else { win.show(); win.focus(); }   // 试验时不抢正在用电脑的人的键盘
  chatWant = target;
  go(CHAT);
  flushChat();
}
/* 要提醒（lib/chat.js 的 onNotice）：正看着「消息」不提醒新消息；不然任务栏闪、右下角弹一条，点它进那个会话 */
function notice(n) {
  if (!alive(win)) return;
  if (!n.storage && win.isFocused() && current === CHAT) return;
  if (NO_TOAST) { log.info(n.storage ? '硬盘快满提醒' : '新消息提醒', { 条数: n.count }); return; }
  if (!n.storage && !win.isFocused()) win.flashFrame(true);
  if (!Notification.isSupported()) return;
  if (toast) toast.close();
  toast = new Notification({ title: n.title, body: n.body });
  toast.on('click', () => openChat(n.conversationId ? { conversationId: n.conversationId } : null));
  toast.show();
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
    app: APP_NAME, bar: BAR, rail: RAIL, drawer: DRAWER, menu: look.菜单, railOn: railOn(look, routesNow().length), setOpen,
    routes: routesNow().map(r => ({ id: r.id, 名: r.名, 图标: r.图标, 数: r.id === CHAT ? chat.unread() : 0 })), current, skin: look.皮肤,   // 数：菜单上写的没看条数（「消息」那一项）
    title: p ? p.title : '', offline: !!(user && user.offline), busy: pages.size ? '' : '正在打开流水线…', server: srv, serverTip: srvTip,
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
/* 各页摆到中间那块（设置开着时让出右边那一栏）；只让现在这一页露出来 */
function layout() {
  if (!alive(win)) return;
  const rect = stage(win.contentView.getBounds(), look, routesNow().length, setOpen);   // 窗口里面实际多大，问装各页的那一层：最大化那一下 getContentSize() 报的还是没变完的数
  for (const [id, p] of pages) { p.view.setBounds(rect); p.view.setVisible(id === current); }
}

function makeWindow() {
  const w = new BrowserWindow({
    width: 1440, height: 920, ...PLACE, minWidth: 900, minHeight: 600, show: false, backgroundColor: skinNow().底, title: APP_NAME,
    frame: false,   // 没有系统边框：顶栏和三个窗口按钮在外框页里
    webPreferences: { preload: FRAME_PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
  });
  w.once('ready-to-show', () => (NO_FOCUS ? w.showInactive() : w.show()));
  w.on('page-title-updated', e => e.preventDefault());   // 窗口名由 tell() 定
  w.contentView.on('bounds-changed', layout);   // 拖边、最大化、还原、全屏：里面大小一变就重摆
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) w.on(ev, () => { layout(); tell(); });
  for (const ev of ['focus', 'blur']) w.on(ev, tell);
  w.on('focus', () => w.flashFrame(false));   // 来了新消息时任务栏闪着：人回来了就停
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
    view.setBackgroundColor(skinNow().底);
    p = { view, title: '' };
    pages.set(id, p);
    view.webContents.on('page-title-updated', (e, title) => { p.title = title; tell(); });
    view.webContents.on('did-fail-load', (e, code, desc, url, isMain) => { if (isMain && code !== -3) p.failed = true; });   // 本机服务停着时没打开：服务又好了重开它（serverChanged）
    view.webContents.on('did-navigate', () => { p.failed = false; });
    win.contentView.addChildView(view);
    p.loaded = view.webContents.loadURL(url);
    p.loaded.catch(() => {});   // 没打开的在 guard 的 did-fail-load 里记了；要等结果的自己接 p.loaded
  }
  show(id);
  return p.loaded;
}
/* 把一页摆到前面（设置那一栏开着就还开着） */
function show(id) {
  current = id;
  layout();
  tell();
  const p = pages.get(id);
  if (!NO_FOCUS) (p ? p.view.webContents : win.webContents).focus();
}
/* 点「设置」：右边拉出那一栏；开着时再点一下（或点它的「收起」、按 Esc）收回去。开着时照样能点菜单换页，挨个看换了皮肤的样子 */
function toggleSet() {
  setOpen = !setOpen;
  layout();
  tell();
  const p = pages.get(current);
  if (!NO_FOCUS) (setOpen || !p ? win.webContents : p.view.webContents).focus();
}
/* 点菜单里的一项 */
function go(id) {
  const r = find(id);
  return r && user && alive(win) ? openPage(r.id, routeUrl(r)) : Promise.resolve();
}
/* 现在这一块回它的首页（流水线回总览） */
function home() {
  const r = find(current), p = pages.get(current);
  if (r && p) p.view.webContents.loadURL(routeUrl(r)).catch(() => {});
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
    if (isOurs(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, backgroundColor: skinNow().底, webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false } } };
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
  ipcMain.handle('desk:info', e => (from(e) ? { app: APP_NAME, version: app.getVersion(), user, work, port, api: API, menus: routesNow().map(r => r.id) } : null));   // menus：左边菜单里现在有哪几项（考试页靠它知道「我的团队」是不是已经单独成一项）
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
  /* 页面一开头就问现在用哪套皮肤（preload.js 照它写 <html data-skin>）：要当场答，所以是同步的；不是本机页面的不答 */
  ipcMain.on('desk:skin', e => { const u = e.senderFrame && e.senderFrame.url; e.returnValue = u && isOurs(u) ? skinForPage(skinNow()) : null; });
  ipcMain.handle('desk:api', async (e, method, pathname, opts) => {
    if (!from(e, find('exam').页)) return { ok: false, status: 400, data: null };
    const r = await serverApi(method, pathname, opts);
    chat.observe(method, pathname, opts, r);   // 页面标了已读：菜单上「消息」的数字跟着减
    return r;
  });
  /* 「消息」那一页调了 desk.onChat：准备好收了。它刷新（重新读一遍）时先当没准备好，等它再说一声 */
  ipcMain.on('desk:chat-ready', e => {
    const p = pages.get(CHAT);
    if (!p || e.sender !== p.view.webContents) return;
    chatReady = e.sender;
    if (!chatHooked.has(e.sender)) {
      chatHooked.add(e.sender);
      const wc = e.sender;
      wc.on('did-start-navigation', (d, url, inPlace, mainFrame) => {
        const main = d && d.isMainFrame !== undefined ? d.isMainFrame : mainFrame, same = d && d.isSameDocument !== undefined ? d.isSameDocument : inPlace;
        if (main && !same && chatReady === wc) chatReady = null;
      });
    }
    flushChat();
  });
  /* 「我的团队」里点了「发消息」：打开「消息」，进和这个人的私聊 */
  ipcMain.on('desk:open-chat', (e, who) => { if (from(e, find('exam').页) && who) openChat({ with: String(who) }); });

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
  const was = look.皮肤;
  look = fixLook({ ...look, ...patch });
  settings.set('外观', look);
  if (look.皮肤 !== was) paintSkin();
  layout();
  tell();
}
/* 换了皮肤：窗口和各页「还没画出来时」的底色跟着换，再告诉开着的各页（preload.js 听着，不用重开）；外框页照 tell() 给的 skin 换 */
function paintSkin() {
  const s = skinNow();
  if (alive(win)) win.setBackgroundColor(s.底);
  for (const p of pages.values()) p.view.setBackgroundColor(s.底);
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && isOurs(wc.getURL())) wc.send('desk:skin', skinForPage(s));
}
/* 设置里的钮（外框页经 frame:do 叫；钮上的 data-do 对着这里的名字） */
const DO = {
  logout,
  work: () => shell.openPath(work),
  'change-work': changeWork,
  menu: where => setLook({ 菜单: where }),
  skin: name => setLook({ 皮肤: name }),
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
  if (server) server.stop();
  app.exit(1);
}

async function boot() {
  log.info('启动', { 版本: app.getVersion(), electron: process.versions.electron, 系统: process.getSystemVersion(), 打包: app.isPackaged, api: API });
  harden(session.defaultSession);
  app.on('web-contents-created', (_, wc) => guard(wc));
  auth = makeAuth({ api: API, fetch: (u, { timeout = 10000, ...o }) => net.fetch(u, { ...o, signal: AbortSignal.timeout(timeout) }), store: tokenStore(), log });
  updater = makeUpdater({ app, dialog, getWindow: () => win, log, onChange: tell });
  chat = makeChat({ ask: serverApi, log, onChange: tell, onMessages: messages => sendChat({ messages }), onNotice: notice });
  ipc();
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: '快捷键', submenu: KEYS }]));   // 不露面，只为那几个快捷键
  work = await chooseWork();
  if (!work) return app.quit();
  port = Number(process.env.ANTOU_PORT) || Number(settings.get('端口')) || 8766;
  log.info('工作文件夹和端口', { work, port });
  win = makeWindow();
  syncInto(work);
  await openServer();
  session.defaultSession.webRequest.onBeforeRequest({ urls: [origin() + '/uploads/exam/*'] }, (d, cb) => cb({ redirectURL: farFile(d.url) }));   // 考试页里的图：转到登录服务器去拿
  const r = await auth.resume();
  user = r.ok ? r.user : null;
  if (user) chat.start(user.username);
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
  app.on('will-quit', () => { if (server) server.stop(); });   // 窗口都关了才停本机服务：页面关的时候还要找它存东西
  app.whenReady().then(boot).catch(fatal);
}
