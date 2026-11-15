/* ============================================================
   公用 · 底座（window.Base）
   流水线各页都靠它：经本机服务读写总文件夹里的文件、把事情交给 AI、认项目、几样小工具。
   路径一律是从总文件夹算起的一串名字，比如 ['项目', '童晓晓', '定稿的剧本', '流水线.json']。
   这几页只在本机服务里用（在 Claude 里说「打开项目管理」，项目管理就是流水线）；直接双击文件打开时读不了项目。
   ============================================================ */
(function () {
'use strict';
const C = window.Core;
const HDR = { 'X-Antou': '1' };
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const mimeOf = n => MIME[(n.split('.').pop() || '').toLowerCase()] || '';

/* ---------- 本机服务 ---------- */
const LINK = {
  on: false, v: 0, root: '', abs: '',
  url: parts => '/api/fs/' + parts.map(encodeURIComponent).join('/'),
  async req(method, url, body) {
    const r = await fetch(url, { method, body, cache: 'no-store', headers: HDR, keepalive: !!body && body.byteLength < 60000 });
    if (!r.ok) throw new Error(r.status === 404 ? '没有这个文件' : (await r.text()) || '本机服务出错 ' + r.status);
    return r;
  },
  /* 服务在不在：在就记下总文件夹叫什么、服务是第几版 */
  async up() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const j = await (await this.req('GET', '/api/ping')).json();
      Object.assign(this, { on: true, v: j.v || 0, root: j.root || '', abs: j.abs || '' });
      return j;
    } catch (e) { return null; }
  },
};

/* ---------- 读写文件 ---------- */
const FS = {
  async file(parts) {
    const r = await LINK.req('GET', LINK.url(parts)), name = parts[parts.length - 1];
    return new File([await r.blob()], name, { type: mimeOf(name), lastModified: +r.headers.get('X-Mtime') });
  },
  async read(parts) { const r = await LINK.req('GET', LINK.url(parts)); const buf = new Uint8Array(await r.arrayBuffer()); return { buf, mtime: +r.headers.get('X-Mtime'), size: buf.length }; },
  async stat(parts) { try { return await (await LINK.req('GET', LINK.url(parts) + '?stat')).json(); } catch (e) { return null; } },
  async write(parts, data) { return (await LINK.req('PUT', LINK.url(parts), data)).json(); },
  async list(parts) {
    const ents = await (await LINK.req('GET', LINK.url(parts) + '?list&t')).json();   // &t：文件带修改时间（老版本的服务不认，那就没有）
    return ents.map(e => ({ name: e.name, kind: e.kind, mtime: e.mtime || 0, handle: { kind: e.kind, name: e.name, getFile: () => FS.file([...parts, e.name]) } }));
  },
  async remove(parts) { await LINK.req('DELETE', LINK.url(parts)); },
  /* 改名、挪地方：那里已经有同名的就不动（服务会报错） */
  async move(from, to) { await LINK.req('POST', LINK.url(from) + '?move=' + encodeURIComponent(to.join('/'))); },
  async isDir(parts) { try { await FS.list(parts); return true; } catch (e) { return false; } },
  async mkdir(parts) { await LINK.req('POST', LINK.url(parts) + '?mkdir'); },   // 建文件夹，上面几层没有的一起建
};

/* ---------- 交给 AI：排进本机服务的队，对话里的 AI 挂着等；返回 AI 在不在等 ---------- */
async function askAI(line) { return (await (await LINK.req('POST', '/api/ai', line)).json()).online; }

/* ---------- 项目 ---------- */
const HOME = '项目';
const at = parts => [HOME, ...parts];   // 项目名开头的路径 → 从总文件夹算起
const hidden = n => /^[.$]|^~\$/.test(n) || /\.antou-tmp$/.test(n);
async function projects() {
  let ents = [];
  try { ents = await FS.list([HOME]); } catch (e) { return []; }
  return ents.filter(e => e.kind === 'directory' && !hidden(e.name)).map(e => e.name).sort((a, b) => a.localeCompare(b, 'zh', { numeric: true }));
}
/* 一个项目里 定稿的剧本 的各段：剧本、镜头表读出来（和 项目管理 里「剧本」那一样认的是同一套） */
async function scanScripts(name) {
  const pj = { name, segs: new Map(), order: [] };
  const slot = seg => { if (!pj.segs.has(seg)) pj.segs.set(seg, { seg, script: [], shots: [] }); return pj.segs.get(seg); };
  const walk = async (parts, depth) => {
    let ents;
    try { ents = await FS.list(at(parts)); } catch (e) { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    for (const e of ents) {
      if (hidden(e.name)) continue;
      const p = [...parts, e.name];
      if (e.kind === 'directory') { if (depth > 0) await walk(p, depth - 1); continue; }
      if (!/\.docx$/i.test(e.name)) continue;
      let r;
      try { r = await FS.read(at(p)); } catch (err) { continue; }
      if (!r.size) continue;
      let paras;
      try { paras = await C.readDocx(r.buf.buffer); } catch (err) { continue; }
      const base = { path: p, name: e.name, size: r.size, mtime: r.mtime }, fseg = C.segFromName(e.name);
      const isShots = /镜头表|分镜表/.test(e.name) || (!/剧本/.test(e.name) && paras.some(x => /^镜头\s*[0-9]+\s*[｜|]/.test(C.cleanPara(x.text))));
      if (isShots) {
        const doc = C.parseShotList(paras, fseg), seg = doc.seg || fseg;
        if (seg) slot(seg).shots.push({ ...base, kind: 'shots', seg, title: doc.name, doc });
      } else {
        const got = C.parseScripts(paras, fseg), combined = got.segs.length > 1 || C.isRangeName(e.name);
        for (const doc of got.segs) { const seg = doc.seg || fseg; if (seg) slot(seg).script.push({ ...base, kind: 'script', seg, combined, title: doc.name, doc }); }
      }
    }
  };
  await walk([name, '定稿的剧本'], 4);
  for (const s of pj.segs.values()) {
    s.script.sort((a, b) => (a.combined - b.combined) || a.name.localeCompare(b.name, 'zh'));
    s.shots.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }
  pj.order = [...pj.segs.keys()].sort(C.segCompare);
  return pj;
}

/* ---------- 小工具 ---------- */
const two = n => String(n).padStart(2, '0');
const stampNow = () => { const d = new Date(); return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()); };
const nowText = (d = new Date()) => { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()); };
const timeOf = t => { const n = Date.parse(String(t || '').trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const isComposing = e => e.isComposing || e.keyCode === 229;
const store = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 存满了就不存 */ } };

/* ---------- 网址：页面之间只靠它传话。p＝项目，s＝第几场 ---------- */
/* a＝资产那一页点开的一样东西（它的图的路径），from＝从哪一页点过来的，v＝哪一条提示词（关键帧）（11-14 加的，资产那一页用） */
const MORE_Q = ['a', 'from', 'v'];
const query = () => { const q = new URLSearchParams(location.search), o = { p: q.get('p') || '', s: q.get('s') || '' }; for (const k of MORE_Q) o[k] = q.get(k) || ''; return o; };
function pageUrl(page, { p, s, ...more } = {}, hash) {
  const q = new URLSearchParams();
  if (p) q.set('p', p);
  if (s) q.set('s', s);
  for (const k of MORE_Q) if (more[k]) q.set(k, more[k]);
  const qs = q.toString();
  return encodeURIComponent(page) + '.html' + (qs ? '?' + qs : '') + (hash ? '#' + encodeURIComponent(hash) : '');
}
/* 看文件的那一页（通用工具/项目管理.html，本机服务的 /）：整页嵌在流水线里，看剧本、提示词、图、样片，写批注。
   它只认嵌着打开（?embed=1）；不嵌着打开会转回流水线首页（老页面 2026-11-13 下掉了） */
const shellUrl = parts => '/?embed=1' + (parts && parts.length ? '#open=' + parts.map(encodeURIComponent).join('/') : '');

window.Base = { C, LINK, FS, askAI, HOME, at, projects, scanScripts, mimeOf, two, stampNow, nowText, timeOf, debounce, isComposing, store, query, pageUrl, shellUrl };
})();
