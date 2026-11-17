#!/usr/bin/env node
/* 右边批注联动：项目管理就是流水线（通用工具\流水线 那几页），在 Claude 应用右边窗格里打开，经这里读写项目文件；
   看剧本、提示词、图、样片的那一页（通用工具\项目管理.html）嵌在流水线里用，不单独打开。
   用户点「交给 AI 改」就排进队列，AI 在后台跑 `node server.js wait` 等着，收到就改。
   批注分两种，各排各的队：剧本（剧本、镜头表）和提示词（各段的视频提示词）。
     node server.js                     开服务
     node server.js open [文件]         服务没开就开起来，打印要在右边窗格打开的流水线网址（写了文件就把它盖上来看）和接着等批注的命令
     node server.js wait [剧本|提示词]   等用户点「交给 AI 改」，收到就打印出来退出；不写哪种就两种都等 */
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');

const ROOT = process.env.ANTOU_ROOT ? path.resolve(process.env.ANTOU_ROOT) : path.resolve(__dirname, '../../..');   // E:\AI短视频项目；ANTOU_ROOT：拿一份试验用的文件夹试页面时用
const TOOLS = process.env.ANTOU_TOOLS ? path.resolve(process.env.ANTOU_TOOLS) : path.join(ROOT, '通用工具');   // 页面放在这里；ANTOU_TOOLS：总文件夹用试验的、页面用正式的时候用
const PAGE = process.env.ANTOU_PAGE || path.join(TOOLS, '项目管理.html');   // ANTOU_PAGE：试新版页面时用
const PORT = Number(process.env.ANTOU_PORT) || 8766;
const VERSION = 13;            // 13：对剧本（定稿、审片批注和剧本对不上，自动写剧本批注；先 Codex 命令行，不行 DeepSeek 接口）；12：流水线不直接调 AI，一律给我提示词（11-15 他定）；11：用 AI 的地方都有两种（「AI 用」里选「给我提示词」，或者直接调；直接调 Claude、DeepSeek 开看得见的窗口，handoff.js）；10：资产页「从电脑里找」（/api/pc，pc-files.js）；9：自己交给 AI（任务复制出来贴进自己开的对话，回复写进 回复.md 或跑 reply 命令）；8：审片以后让 AI 出修改方案、照方案改（另存 _改N）；7：流水线「网盘」那一页（/api/wangpan/）；6：双模式草稿的冲突保护与正文/写稿记录联合保存；5：AI 任务
const STATIC = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };   // 通用工具 里只发这几种
const ONLINE_MS = 15 * 60e3;   // 这么久之内 AI 来等过，就算它在
const WAIT_MS = 4 * 60e3;      // 一次最多挂这么久，没有就让等的那头再来一次

const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);
const KINDS = ['剧本', '提示词'];
const KIND_ARG = { 剧本: '剧本', 镜头表: '剧本', script: '剧本', 提示词: '提示词', 视频提示词: '提示词', prompt: '提示词' };
const kindOf = line => /(^|[\s/])提示词\//.test(line) ? '提示词' : '剧本';   // 批注文件在 提示词 文件夹里的算提示词，其余算剧本
const queue = { 剧本: [], 提示词: [] };   // 等 AI 改的请求，一行一条
const lastSeen = { 剧本: 0, 提示词: 0 };
const waiters = new Set();   // 正在等的 AI，各记着自己等哪几种
const online = k => [...waiters].some(w => w.kinds.includes(k)) || Date.now() - lastSeen[k] < ONLINE_MS;
const log = (...a) => console.log(new Date().toLocaleTimeString('zh-CN', { hour12: false }), ...a);
const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
const Core = require(path.join(TOOLS, '公用', '核心.js'));   // 视频提示词的名字（RE_VP）：和页面、jobs.js 共用一份
const drafts = require('./draft-store.js')({ ROOT, RE_VP: Core.RE_VP });
const jobs = require('./jobs.js')({ ROOT, TOOLS, log, withFileLocks: drafts.withLocks });   // AI 任务与页面共用文件锁
const pc = require('./pc-files.js')({ ROOT, log, resolveParts, withLocks: drafts.withLocks });   // 资产页「从电脑里找」：整台电脑找图、复制进项目（11-14 加）
/* 流水线「网盘」那一页：项目文件夹在阿里云网盘上的那一份（通用工具\网盘同步\网盘管理.js）。没装好不碍别的 */
let wangpan = null;
try { wangpan = require(path.join(TOOLS, '网盘同步', '网盘管理.js'))({ local: path.join(ROOT, '项目'), log }); }
catch (e) { log('网盘那一页没装上：' + e.message); }

function send(res, status, body, headers) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, obj) => send(res, 200, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
const mtimeOf = st => Math.floor(st.mtimeMs);

/* 地址里的路径只能落在总文件夹里面：每一节不许是 . 、..，不许有 Windows 文件名里不许有的字 */
const badSeg = s => /^\.+$|[<>:"\\/|?*\u0000-\u001f]|[. ]$/.test(s);
function resolveParts(raw, decoded) {
  const parts = raw.split('/').filter(Boolean).map(s => decoded ? s : decodeURIComponent(s));
  for (const p of parts) if (badSeg(p)) throw httpErr(400, '路径不对：' + p);
  return path.join(ROOT, ...parts);
}
const exists = p => fsp.stat(p).then(() => true, () => false);
async function readBody(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw httpErr(413, '太大了'); chunks.push(c); }
  return Buffer.concat(chunks);
}

/* ---------- 读写文件：照着页面里 FS 的几样用法 ---------- */
async function onFs(req, res, url) {
  const abs = resolveParts(url.pathname.slice('/api/fs'.length));
  const q = url.searchParams;
  if (req.method === 'POST' && q.has('draft')) {
    let body;
    try { body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8')); }
    catch (e) { if (e.status) throw e; throw httpErr(400, '草稿保存请求不是有效 JSON'); }
    return json(res, await drafts.save(abs, body));
  }
  if (req.method === 'GET' && q.has('list')) {
    const ents = await fsp.readdir(abs, { withFileTypes: true });
    const out = ents.filter(e => e.isFile() || e.isDirectory()).map(e => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }));
    if (q.has('t')) await Promise.all(out.map(async o => {   // ?list&t：文件带上修改时间（流水线要比先后：提示词是不是剧本定稿以前写的）
      if (o.kind === 'file') { try { o.mtime = mtimeOf(await fsp.stat(path.join(abs, o.name))); } catch (e) { o.mtime = 0; } }
    }));
    return json(res, out);
  }
  if (req.method === 'GET') {
    return drafts.withLocks([abs], async () => {
      const fh = await fsp.open(abs, 'r');
      try {
        const st = await fh.stat();
        if (!st.isFile()) throw httpErr(404, '不是文件');
        if (q.has('stat')) return json(res, { mtime: mtimeOf(st), size: st.size });
        return send(res, 200, await fh.readFile(), { 'Content-Type': 'application/octet-stream', 'X-Mtime': String(mtimeOf(st)) });
      } finally { await fh.close(); }
    });
  }
  if (req.method === 'PUT') {
    const buf = await readBody(req, 200 * 1024 * 1024);
    return drafts.withLocks([abs], async () => {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      const tmp = abs + '.antou-tmp';   // 先写在旁边，写完再换上，原处不会留半截文件
      try {
        await fsp.writeFile(tmp, buf);
        if (req.headers['if-none-match'] === '*') {
          // 链接只在目标不存在时成功；先检查存在再 rename 会覆盖并发创建的文件。
          try { await fsp.link(tmp, abs); }
          catch (e) { if (e.code === 'EEXIST') throw httpErr(412, '文件已经存在，未覆盖'); throw e; }
          await fsp.unlink(tmp);
        } else await fsp.rename(tmp, abs);
      } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
      const st = await fsp.stat(abs);
      return json(res, { mtime: mtimeOf(st), size: st.size });
    });
  }
  if (req.method === 'POST' && q.has('mkdir')) { await fsp.mkdir(abs, { recursive: true }); return json(res, { ok: true }); }
  /* 改名、挪地方：?move=总文件夹里的新路径（用 / 隔开）；那里已经有了就不动 */
  if (req.method === 'POST' && q.has('move')) {
    const dest = resolveParts(q.get('move'), true);
    if (abs === ROOT || dest === ROOT) throw httpErr(400, '总文件夹不能改名');
    await fsp.stat(abs);
    if (dest.toLowerCase() !== abs.toLowerCase() && await exists(dest)) throw httpErr(409, '那里已经有同名的了');
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(abs, dest);
    log('改名：' + path.relative(ROOT, abs) + ' → ' + path.relative(ROOT, dest));
    return json(res, { ok: true });
  }
  /* 在资源管理器里显示：打开所在的文件夹，选中它 */
  if (req.method === 'POST' && q.has('reveal')) {
    await fsp.stat(abs);
    spawn('explorer.exe', ['/select,' + abs], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    return json(res, { ok: true });
  }
  if (req.method === 'DELETE') {
    const st = await fsp.stat(abs);
    if (st.isDirectory()) {   // 文件夹只删空的（比如批注截图删光以后）
      if ((await fsp.readdir(abs)).length) throw httpErr(409, '文件夹里还有东西，不删');
      await fsp.rmdir(abs);
      return json(res, { ok: true });
    }
    if (!st.isFile()) throw httpErr(400, '只删文件');
    await fsp.unlink(abs);
    return json(res, { ok: true });
  }
  throw httpErr(405, '不支持');
}

/* ---------- 交给 AI：页面排进来，AI 挂着等 ---------- */
/* 只等一种的先拿走自己那种，两种都等的拿剩下的 */
function deliver() {
  for (const w of [...waiters].sort((a, b) => a.kinds.length - b.kinds.length)) {
    const lines = w.kinds.flatMap(k => queue[k].splice(0));
    if (!lines.length) continue;
    w.done(200, lines.join('\n'));
    log(`交到 AI 手上（等${w.kinds.join('、')}的）：` + lines.join(' ｜ '));
  }
}
async function onAi(req, res, url) {
  if (req.method === 'POST' && url.pathname === '/api/ai') {
    const lines = (await readBody(req, 1e6)).toString('utf8').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    for (const l of lines) { const q = queue[kindOf(l)]; if (!q.includes(l)) q.push(l); }
    const on = lines.length > 0 && lines.every(l => online(kindOf(l)));   // 交出的这一种有 AI 在等才算在
    log((on ? '点了交给 AI 改：' : '点了交给 AI 改（AI 没在等，先排着）：') + lines.join(' ｜ '));
    deliver();
    return json(res, { online: on, queued: queue.剧本.length + queue.提示词.length });
  }
  if (req.method === 'GET' && url.pathname === '/api/ai/wait') {
    const k = url.searchParams.get('kind');
    if (k !== null && !KINDS.includes(k)) throw httpErr(400, '批注只分 剧本、提示词 两种');
    const w = { over: false, kinds: k ? [k] : KINDS };
    const seen = () => { for (const x of w.kinds) lastSeen[x] = Date.now(); };
    const end = () => { w.over = true; clearTimeout(timer); waiters.delete(w); seen(); };
    w.done = (status, body) => { if (w.over) return; end(); send(res, status, body, { 'Content-Type': 'text/plain; charset=utf-8' }); };
    const timer = setTimeout(() => w.done(204, ''), WAIT_MS);
    res.on('close', () => { if (!w.over) end(); });
    waiters.add(w); seen();
    deliver();
    return;
  }
  throw httpErr(404, '没有这个接口');
}

async function handle(req, res) {
  try {
    if (!HOSTS.has(req.headers.host || '')) throw httpErr(403, 'Host 不对');
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      // 只认自己页面发来的：别的网页加不了这个头
      if (req.headers['x-antou'] !== '1') throw httpErr(403, '缺少 X-Antou');
      const origin = req.headers.origin;
      if (origin && !HOSTS.has(origin.replace(/^https?:\/\//, ''))) throw httpErr(403, 'Origin 不对');
      if (url.pathname === '/api/ping') return json(res, { root: path.basename(ROOT), v: VERSION, abs: ROOT, draftSave: true, wangpan: !!wangpan });
      if (url.pathname === '/api/fs' || url.pathname.startsWith('/api/fs/')) return await onFs(req, res, url);
      if (url.pathname.startsWith('/api/ai')) return await onAi(req, res, url);
      if (url.pathname === '/api/job' || url.pathname.startsWith('/api/job/') || url.pathname === '/api/jimeng' || url.pathname === '/api/builtin-ai') return await jobs.handle(req, res, url, { json, readBody, httpErr });
      if (url.pathname === '/api/pc') return await pc.handle(req, res, url, { json, readBody });
      if (url.pathname.startsWith('/api/wangpan/')) { if (!wangpan) throw httpErr(404, '网盘那一页没装上，看服务的输出'); return await wangpan.handle(req, res, url); }
      throw httpErr(404, '没有这个接口');
    }
    const p = decodeURIComponent(url.pathname);
    if (req.method === 'GET' && (p === '/' || p === '/项目管理.html')) return send(res, 200, await fsp.readFile(PAGE), { 'Content-Type': 'text/html; charset=utf-8' });
    /* 通用工具 里的页面（流水线各步）和它们用的脚本、样式：原样发出去，只读 */
    if (req.method === 'GET' && p.startsWith('/通用工具/')) {
      const parts = p.split('/').filter(Boolean).slice(1);
      for (const s of parts) if (badSeg(s)) throw httpErr(400, '路径不对：' + s);
      const type = STATIC[path.extname(parts[parts.length - 1] || '').toLowerCase()];
      if (!type) throw httpErr(404, '通用工具 里只发页面、脚本和样式');
      return send(res, 200, await fsp.readFile(path.join(TOOLS, ...parts)), { 'Content-Type': type + '; charset=utf-8' });
    }
    throw httpErr(404, '这里只放 项目管理.html 和 通用工具 里的页面');
  } catch (e) {
    const status = e.status || (['ENOENT', 'ENOTDIR'].includes(e.code) ? 404 : e instanceof URIError ? 400 : 500);
    if (status >= 500) log('出错：', e.message);
    if (!res.headersSent) send(res, status, e.message || String(e), { 'Content-Type': 'text/plain; charset=utf-8' });
    else res.destroy();
  }
}

function serve() {
  ['127.0.0.1', '::1'].forEach((host, i) => {
    const server = http.createServer(handle);
    server.requestTimeout = 0;   // AI 挂着等的请求不能被掐断
    server.on('error', e => {
      if (i) return;   // 没有 IPv6 就算了
      console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已经被占了，可能别的会话开着项目管理服务` : e.message);
      process.exit(1);
    });
    server.listen(PORT, host, () => { if (!i) log(`项目管理联动：http://localhost:${PORT}/　总文件夹 ${ROOT}`); });
  });
}

/* ---------- AI 这头 ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(pathname, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: pathname, timeout, headers: { 'X-Antou': '1', Host: `127.0.0.1:${PORT}` } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8').trim() }));
      res.on('error', reject);
    });
    if (timeout) req.on('timeout', () => req.destroy(new Error('没有回音')));   // 挂着等批注的不限时
    req.on('error', reject);
  });
}
function post(pathname, text) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(text || '', 'utf8');
    const req = http.request({ host: '127.0.0.1', port: PORT, path: pathname, method: 'POST', headers: { 'X-Antou': '1', Host: `127.0.0.1:${PORT}`, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8').trim() }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(buf);
  });
}
/* 交给 AI 等回复的任务（给我提示词、Claude 桌面版、DeepSeek 窗口），AI 做完告诉这边：node server.js reply <任务号> [回复文件]。
   不带回复文件，服务去看这一回该写的那个回复文件（回复.md，核图这类是 回复_核图.md）。等这边落完盘才回话：收到了、格式不对（改好再跑一次）、没接上 */
async function reply(id, file) {
  if (!/^[a-z0-9]+$/.test(id || '')) { console.error('要写任务号：node server.js reply <任务号> [回复文件]'); return 3; }
  let text = '';
  if (file) { try { text = fs.readFileSync(path.resolve(file), 'utf8'); } catch (e) { console.error('读不了回复文件：' + e.message); return 3; } }
  let r;
  try { r = await post('/api/job/' + id + '?reply', text); } catch (e) { console.error(`项目管理服务没开着（端口 ${PORT}）：${e.message}。回复文件留着就行，服务开起来会接着收`); return 2; }
  let j = null;
  try { j = JSON.parse(r.text); } catch (e) { /* 不是 JSON：照原样说 */ }
  if (r.status !== 200 || !j) { console.error('项目没接上：' + r.text); return 3; }
  if (j.格式错) { console.error('项目还没接上：' + j.格式错 + '。改好以后（回复照任务书「回复的格式」写），再跑一次这一句'); return 4; }
  if (j.状态 === '做完') { console.log('项目收到了：' + j.结果); return 0; }
  if (j.状态 === '没成' || j.状态 === '停了') { console.error('项目没接上：' + (j.错误 || j.状态)); return 3; }
  console.log('项目收到了，还在存盘，结果在页面上看'); return 0;
}
/* 服务开着就返回 { root, v }（改前开的没有 v）；端口上是别的程序返回 {}；没开返回 null */
async function ping() {
  let r;
  try { r = await get('/api/ping', 3000); } catch (e) { return null; }
  try { return r.status === 200 ? JSON.parse(r.text) : {}; } catch (e) { return {}; }
}
const OLD_NOTE = '（服务是改前开的，两种批注还是一起收；等没人在等批注时重开一次才分开）';

/* 挂着等，收到就打印出来退出 */
async function wait(arg) {
  const kind = KIND_ARG[arg];
  if (arg && !kind) { console.error(`不认识「${arg}」：写 剧本 或 提示词，不写就两种都等`); return 3; }
  if (kind) { const p = await ping(); if (p && p.root && !p.v) console.error(OLD_NOTE); }
  const url = '/api/ai/wait' + (kind ? '?kind=' + encodeURIComponent(kind) : '');
  let downSince = 0;
  for (;;) {
    try {
      const r = await get(url);
      downSince = 0;
      if (r.status === 200 && r.text) { console.log(r.text); return 0; }
      if (r.status !== 204) { console.error(`项目管理服务回了 ${r.status}：${r.text}`); return 3; }
    } catch (e) {
      downSince = downSince || Date.now();
      if (Date.now() - downSince > 60e3) { console.error(`项目管理服务没开着（端口 ${PORT}），先跑 node server.js open`); return 2; }
      await sleep(2000);
    }
  }
}

/* 文件写成完整路径、项目/项目名/…、项目名/… 都行，换成页面认的 项目名/… */
function relParts(file) {
  const home = path.join(ROOT, '项目');
  const tries = path.isAbsolute(file) ? [file] : [path.join(ROOT, file), path.join(home, file), path.resolve(file)];
  const abs = tries.find(p => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!abs) throw new Error('没找到这个文件：' + file);
  let rel = path.relative(home, abs);
  if (rel.startsWith('..')) rel = path.relative(ROOT, abs);   // 还没挪进 项目 的旧项目
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('这个文件不在 ' + ROOT + ' 里：' + file);
  return rel.split(path.sep);
}
/* 页面里批这几样：剧本、镜头表，各段的视频提示词，还有审片的视频、图片批注的图 */
function fileKind(parts) {
  const name = parts[parts.length - 1];
  if (parts[1] === '定稿的剧本' && /\.docx$/i.test(name)) return '剧本';
  if (parts[1] === '提示词' && Core.RE_VP.test(name) && parts.slice(2, -1).some(d => /第.+段/.test(d))) return '提示词';   // 照镜头号起名的 1-5.txt……；老稿 视频提示词.txt、视频提示词_02.txt……
  if (/\.(mp4|m4v|mov|webm)$/i.test(name)) return '审片';
  if (/\.(png|jpe?g|webp|gif|avif)$/i.test(name)) return '图片';
  return null;
}
/* 会话开在 项目\项目名 里，就直接打开这个项目 */
function cwdProject() {
  const rel = path.relative(path.join(ROOT, '项目'), process.cwd());
  const name = !rel || rel.startsWith('..') || path.isAbsolute(rel) ? '' : rel.split(path.sep)[0];
  return name && fs.existsSync(path.join(ROOT, '项目', name)) ? name : '';
}
/* 服务没开就开起来（开在后台，这条命令退出后它还在），再打印网址 */
async function open(file) {
  let hash = '', kind = '', pj = cwdProject();
  if (file) {
    const parts = relParts(file);
    kind = fileKind(parts);
    if (!kind) { console.error('项目管理里只批剧本、镜头表、各段的视频提示词、视频和图片，这一份不在里面：' + parts.join('/')); return 3; }
    if (!fs.existsSync(path.join(ROOT, '项目', parts[0]))) { console.error('流水线只认 项目 下面的项目，这一份不在里面：' + parts.join('/')); return 3; }
    pj = parts[0];
    hash = '#open=' + parts.slice(1).map(encodeURIComponent).join('/');   // 流水线打开这个项目，把这一份盖上来看
  }
  let p = await ping();
  if (!p) {
    spawn(process.execPath, [__filename], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref();   // cwd 放总文件夹：不占着项目文件夹
    for (let i = 0; i < 40 && !(p = await ping()); i++) await sleep(250);
  }
  if (!p) { console.error(`项目管理服务没开起来（端口 ${PORT}）`); return 2; }
  if (p.root !== path.basename(ROOT)) { console.error(`端口 ${PORT} 被别的程序占着`); return 2; }
  if (!p.v) console.error(OLD_NOTE);
  console.log(`http://localhost:${PORT}/${encodeURI('通用工具/流水线/总览.html')}${pj ? '?p=' + encodeURIComponent(pj) : ''}${hash}`);
  if (kind === '审片' || kind === '图片') console.log(`（${kind}的批注不排队：用户点「交给 AI」复制一句话，贴进对话）`);
  else console.log(`等批注：node "${__filename.replace(/\\/g, '/')}" wait${kind ? ' ' + kind : ''}`);
  return 0;
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'wait') wait(arg).then(code => process.exit(code));
else if (cmd === 'open') open(arg).then(code => process.exit(code), e => { console.error(e.message); process.exit(3); });
else if (cmd === 'reply') reply(arg, process.argv[4]).then(code => process.exit(code), e => { console.error(e.message); process.exit(3); });
else serve();
