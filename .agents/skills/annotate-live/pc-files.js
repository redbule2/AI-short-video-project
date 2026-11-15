'use strict';
/* ============================================================
   从电脑里找图（2026-11-14 他要的：电脑别处有一张图，要能找到，选中后复制到项目里该放的地方，改好名字）。
   资产页挑图弹窗左下角「从电脑里找」用（页面那头在 通用工具\流水线\电脑找图.js）。只认图片；原图不动，复制一份进项目的 资产 里。
   接口（server.js 转过来，已经查过 Host、X-Antou 头）：
     GET  /api/pc?places          常去的几处（桌面、下载、图片、文档）和各个盘
     GET  /api/pc?recent          这几处最近改过的图，新的在前
     GET  /api/pc?list=文件夹       一个文件夹里的子文件夹和图（图新的在前）
     GET  /api/pc?q=名字里的字      整台电脑按名字找图，几个词用空格隔开（各盘过一遍几秒钟；半分钟内再找用记下的）
     GET  /api/pc?img=图的完整路径   原图（页面自己缩小）
     POST /api/pc?copy            {"from": 图的完整路径, "to": 从总文件夹算起的路径，用 / 隔开}：只往 项目/某项目/资产/… 里放；
                                  那一层已经有同名的图（后缀不同也算）就不复制。复制出来的修改时间记成现在（是新放进项目的图）
   找、看最近的图不进系统文件夹（Windows、Program Files、AppData、回收站这些）和点开头的文件夹；翻文件夹时都看得见。
   ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

module.exports = function makePcFiles({ ROOT, log, resolveParts, withLocks = async (paths, fn) => fn() }) {
  const IMG = /\.(png|jpe?g|webp|gif|avif|jfif)$/i;   // jfif 就是 jpg（浏览器存图有时存成这个），复制进项目时改成 .jpg
  const PUT = /\.(png|jpe?g|webp|gif|avif)$/i;         // 项目里认的图（流水线.js 的 IMG_RE）
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
  const SYS = /^(\$.*|system volume information|windows|windows\.old|program files|program files \(x86\)|programdata|appdata|recovery|perflogs|config\.msi|msocache|node_modules|__pycache__)$/i;
  const skipInSearch = n => n.startsWith('.') || SYS.test(n);
  const skipInList = n => /^\$|^system volume information$/i.test(n);   // 翻文件夹：只藏打不开的那两种
  const FRESH = 30e3;   // 各盘的图记下来，这么久之内再找直接用
  const fail = (status, m) => Object.assign(new Error(m), { status });
  const byZh = (a, b) => a.localeCompare(b, 'zh', { numeric: true });
  const extOf = n => (path.extname(n).slice(1) || '').toLowerCase();

  /* 完整路径：只认 X:\… 这种 */
  function absOf(p) {
    const s = String(p || '').trim();
    if (!/^[A-Za-z]:[\\/]/.test(s)) throw fail(400, '路径不对：' + s);
    return path.normalize(s);
  }

  /* ---------- 常去的几处、各个盘 ---------- */
  let placesP = null;
  function places() {
    if (!placesP) placesP = (async () => {
      const home = os.homedir();
      let got = {};
      try {   // 桌面、文档这些可能被挪到别处（比如 OneDrive），照系统登记的
        const ps = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $p=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders';"
          + " @{ desktop=[Environment]::GetFolderPath('Desktop'); downloads=$p.'{374DE290-123F-4565-9164-39C4925E467B}'; pictures=[Environment]::GetFolderPath('MyPictures'); documents=[Environment]::GetFolderPath('MyDocuments') } | ConvertTo-Json -Compress";
        const out = await new Promise((res, rej) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 10e3, windowsHide: true, encoding: 'utf8' }, (e, so) => e ? rej(e) : res(so)));
        got = JSON.parse(out.trim()) || {};
      } catch (e) { /* 读不到就用默认的位置 */ }
      const list = [['桌面', got.desktop || path.join(home, 'Desktop')], ['下载', got.downloads || path.join(home, 'Downloads')], ['图片', got.pictures || path.join(home, 'Pictures')], ['文档', got.documents || path.join(home, 'Documents')]];
      const out = [];
      for (const [name, p] of list) { try { if ((await fsp.stat(p)).isDirectory()) out.push({ name, path: path.normalize(p) }); } catch (e) { /* 没有这一处 */ } }
      return out;
    })().catch(e => { placesP = null; throw e; });
    return placesP;
  }
  async function drives() {
    const one = L => Promise.race([fsp.stat(L + ':\\').then(st => st.isDirectory(), () => false), new Promise(r => setTimeout(() => r(false), 1500))]);   // 断开的网络盘别卡住
    const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const ok = await Promise.all(letters.map(one));
    return letters.filter((L, i) => ok[i]).map(L => ({ name: L + ' 盘', path: L + ':\\' }));
  }

  /* ---------- 往下走：从几处开始，把图交给 onImg（完整路径）。一次开十二个文件夹；depth 最多往下几层，budget 最多走多久 ---------- */
  function walk(roots, { depth = 64, budget = 25e3, onImg }) {
    const t0 = Date.now(), q = roots.map(r => [r, 0]);
    let active = 0, cut = false;
    return new Promise(done => {
      const next = () => {
        if (q.length && Date.now() - t0 > budget) { cut = true; q.length = 0; }
        while (active < 12 && q.length) {
          const [dir, d] = q.shift();
          active++;
          fsp.readdir(dir, { withFileTypes: true }).then(ents => {
            for (const e of ents) {
              if (e.isDirectory()) { if (d < depth && !skipInSearch(e.name)) q.push([path.join(dir, e.name), d + 1]); }   // 目录连接、快捷方式不进（isDirectory 是假的），不会绕圈
              else if (e.isFile() && IMG.test(e.name)) onImg(path.join(dir, e.name));
            }
          }, () => { /* 打不开的文件夹跳过 */ }).finally(() => { active--; next(); });
        }
        if (!active && !q.length) done({ cut });
      };
      next();
    });
  }
  /* 一串图：带上大小、修改时间（读不到的去掉） */
  async function statAll(list) {
    const out = [];
    for (let i = 0; i < list.length; i += 64) {
      const part = await Promise.all(list.slice(i, i + 64).map(async p => { try { const st = await fsp.stat(p); return st.isFile() ? { path: p, name: path.basename(p), dir: path.dirname(p), size: st.size, mtime: Math.floor(st.mtimeMs) } : null; } catch (e) { return null; } }));
      for (const x of part) if (x) out.push(x);
    }
    return out;
  }

  /* ---------- 最近的图：桌面、下载、图片、文档往下六层 ---------- */
  async function recent() {
    const t0 = Date.now(), ps = await places(), seen = new Set(), all = [];
    await walk(ps.map(p => p.path), { depth: 6, budget: 8e3, onImg: p => { const k = p.toLowerCase(); if (!seen.has(k)) { seen.add(k); all.push(p); } } });
    const items = await statAll(all);
    items.sort((a, b) => b.mtime - a.mtime);
    return { items: items.slice(0, 150), total: items.length, ms: Date.now() - t0 };
  }

  /* ---------- 翻文件夹 ---------- */
  async function list(raw) {
    const dir = absOf(raw);
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); }
    catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') throw fail(403, '这个文件夹打不开（没有权限）');
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw fail(404, '没有这个文件夹：' + dir);
      throw e;
    }
    const dirs = ents.filter(e => e.isDirectory() && !skipInList(e.name)).map(e => e.name).sort(byZh);
    const items = await statAll(ents.filter(e => e.isFile() && IMG.test(e.name)).map(e => path.join(dir, e.name)));
    items.sort((a, b) => b.mtime - a.mtime);
    const up = path.dirname(dir);
    return { dir, parent: up === dir ? '' : up, dirs, items };
  }

  /* ---------- 整台电脑按名字找：各盘的图记一份，半分钟内再找直接用 ---------- */
  let IDX = null, building = null;
  function index() {
    if (IDX && Date.now() - IDX.at < FRESH) return Promise.resolve(IDX);
    if (!building) building = (async () => {
      const t0 = Date.now(), list = [];
      const { cut } = await walk((await drives()).map(d => d.path), { onImg: p => list.push(p) });
      const first = !IDX;
      IDX = { at: Date.now(), list, low: list.map(p => p.toLowerCase()), cut, ms: Date.now() - t0 };
      if (first || cut) log(`从电脑里找图：各盘过了一遍，${list.length} 张图，用了 ${(IDX.ms / 1000).toFixed(1)} 秒` + (cut ? '（太久，没过完）' : ''));
      return IDX;
    })().finally(() => { building = null; });
    return building;
  }
  async function search(q) {
    const t0 = Date.now(), words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return { items: [], total: 0, ms: 0 };
    const idx = await index(), byName = [], byDir = [];
    idx.low.forEach((low, i) => {
      if (!words.every(w => low.includes(w))) return;
      const name = low.slice(low.lastIndexOf('\\') + 1);
      (words.every(w => name.includes(w)) ? byName : byDir).push(idx.list[i]);   // 名字里就有的排前面，文件夹名里有的排后面
    });
    const total = byName.length + byDir.length;
    const a = await statAll(byName.slice(0, 300)), b = await statAll(byDir.slice(0, Math.max(0, 300 - a.length)));
    a.sort((x, y) => y.mtime - x.mtime); b.sort((x, y) => y.mtime - x.mtime);
    return { items: [...a, ...b].slice(0, 200), total, cut: idx.cut, ms: Date.now() - t0 };
  }

  /* ---------- 原图 ---------- */
  const statImg = p => fsp.stat(p).catch(e => { throw e.code === 'ENOENT' ? fail(404, '这张图不在了：' + p) : e; });
  async function sendImg(res, raw) {
    const full = absOf(raw);
    if (!IMG.test(full)) throw fail(400, '只看图片');
    const st = await statImg(full);
    if (!st.isFile()) throw fail(404, '不是文件');
    res.writeHead(200, { 'Content-Type': MIME[extOf(full)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
  }

  /* ---------- 复制进项目 ---------- */
  async function copy(body) {
    let j;
    try { j = JSON.parse(body.toString('utf8')); } catch (e) { throw fail(400, '复制请求不是有效 JSON'); }
    const from = absOf(j && j.from);
    if (!IMG.test(from)) throw fail(400, '只复制图片');
    const st = await statImg(from);
    if (!st.isFile()) throw fail(400, '不是文件');
    const parts = String(j.to || '').split('/').filter(Boolean);
    if (parts.length < 4 || parts[0] !== '项目' || parts[2] !== '资产') throw fail(400, '只往项目的 资产 里放：' + j.to);
    if (!PUT.test(parts[parts.length - 1])) throw fail(400, '名字的后缀不对：' + parts[parts.length - 1]);
    const dest = resolveParts(parts.join('/'), true), dir = path.dirname(dest), stem = path.parse(dest).name.toLowerCase();
    if (dest.toLowerCase() === from.toLowerCase()) throw fail(409, '这张图已经在这里了');
    return withLocks([dest], async () => {
      let ents = [];
      try { ents = await fsp.readdir(dir); } catch (e) { /* 还没有这一层 */ }
      const same = ents.find(n => IMG.test(n) && path.parse(n).name.toLowerCase() === stem);   // 同名的图（后缀不同也算）
      if (same) throw fail(409, '那里已经有「' + same + '」了');
      await fsp.mkdir(dir, { recursive: true });
      try { await fsp.copyFile(from, dest, fs.constants.COPYFILE_EXCL); }
      catch (e) { if (e.code === 'EEXIST') throw fail(409, '那里已经有同名的了'); throw e; }
      const now = new Date();
      await fsp.utimes(dest, now, now).catch(() => {});   // Windows 复制会带上原图的修改时间：记成现在，页面才认得出是新放进来的
      const st2 = await fsp.stat(dest);
      log('从电脑里复制：' + from + ' → ' + path.relative(ROOT, dest));
      return { ok: true, file: parts.join('/'), size: st2.size, mtime: Math.floor(st2.mtimeMs) };
    });
  }

  async function handle(req, res, url, { json, readBody }) {
    const q = url.searchParams;
    if (req.method === 'GET' && q.has('places')) return json(res, { places: await places(), drives: await drives() });
    if (req.method === 'GET' && q.has('recent')) return json(res, await recent());
    if (req.method === 'GET' && q.has('list')) return json(res, await list(q.get('list')));
    if (req.method === 'GET' && q.has('q')) return json(res, await search(q.get('q')));
    if (req.method === 'GET' && q.has('img')) return sendImg(res, q.get('img'));
    if (req.method === 'POST' && q.has('copy')) return json(res, await copy(await readBody(req, 64 * 1024)));
    throw fail(404, '没有这个接口');
  }
  return { handle };
};
