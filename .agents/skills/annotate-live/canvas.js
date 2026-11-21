'use strict';
/* ============================================================
   即梦画布上的图（11-14 他要的：资产页能看到本地的和画布上的，一样的只摆本地的）。
   只读画布：node find、node show、resource download，不建、不改、不删节点，不花积分。
   一样不一样看像素：画布下回来的是平台重新压过的 PNG，文件校验值和本地原图不同、像素一样，所以两边都解开比像素。
   本地比哪些图：资产页摆得出来的那几处——资产/人物和道具、资产/场景、资产/关键帧/第N段（本层和下一层），历史记录/资产 里同样的几处。
   接口（jobs.js 的 /api/jimeng 转过来，都是 GET，server.js 已经查过 X-Antou 头）：
     /api/jimeng?canvas&p=项目[&again][&jm=登录位,…]   画布上本地没有的图。头一回要把图下下来比，先回「在对」，页面隔两秒再问
     /api/jimeng?img=<素材编号>&p=项目[&jm=…]           一张画布上的图（先下到缓存）
   画布：项目 资产/出片设置.json 的「画布」网址。登录位：出片设置里写了「登录位」就用它；没写先试默认的，再试页面给的
     （总览「即梦授权」里加过的），谁读得了这张画布就用谁。
   缓存在系统临时文件夹 antou-canvas/<画布编号>/：<素材编号>.img，和 比对.json（各图的像素校验值，本地图按 路径|大小|修改时间 记；
     画布视频：素材编号 → 文件的 SHA-256）。删了也不要紧，再下一遍。
   出片任务书也用（jobs.js 直接调，11-17 加）：versions 认画布上和本地文件同名的节点是哪一版，plan 照认的结果写任务书里那一句。
   ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

module.exports = function makeCanvas({ HOME, JM, run, log, AP = require(path.resolve(__dirname, '../../../通用工具/公用/资产路径.js')) }) {   // AP：公用/资产路径.js（资产放哪、节点名），jobs.js 照 TOOLS 传进来
  const CACHE = process.env.ANTOU_CANVAS_CACHE || path.join(os.tmpdir(), 'antou-canvas');
  const IMG = /\.(png|jpe?g|webp)$/i;
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const NAME = /^[A-Za-z0-9_-]{1,40}$/;
  const STALE = 10 * 60e3;   // 比好的结果这么久之内直接用；过了这么久，或者页面点「再读一遍画布」，重读
  const unbom = s => String(s).replace(/^\uFEFF/, '');
  const stem = n => n.replace(/\.[^.]+$/, '');
  const fail = m => Object.assign(new Error(m), { plain: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ---------- 即梦命令行：一次最多开三个。low：下图排在读节点后面（页面在下小图时点「再读一遍」，不用等图下完）。
     call 不排队：出片任务书认节点时，几个名字一起查（一条要三秒上下，一起查和查一条一样快；each 一次最多 8 条），只查节点不下图 ---------- */
  let busy = 0;
  const queue = [];
  async function slot(fn, low) {
    if (busy >= 3) await new Promise(r => { const w = { r, low: !!low }, i = low ? -1 : queue.findIndex(q => q.low); if (i < 0) queue.push(w); else queue.splice(i, 0, w); });
    else busy++;   // 等着的那个是接前一个的班，不另加
    try { return await fn(); } finally { const next = queue.shift(); if (next) next.r(); else busy--; }
  }
  async function call(profile, args, timeout) {
    if (!fs.existsSync(JM)) throw fail('这台电脑上没找到即梦命令行（' + JM + '）');
    const r = await run(JM, ['--non-interactive', ...(profile ? ['--profile', profile] : []), ...args], { timeout: timeout || 90e3 });
    let j = null;
    try { j = JSON.parse(r.out); } catch (e) { /* 不是 JSON */ }
    if (r.code !== 0 || !j || j.ok === false) {
      const er = j && (j.error || (j.data && j.data.error));
      throw fail((er && (er.message || er.reason || er.code)) || (r.err || r.out || '').trim().slice(0, 300) || '即梦命令行出错（退出码 ' + r.code + '）');
    }
    return j.data || {};
  }
  const cli = (profile, args, timeout, low) => slot(() => call(profile, args, timeout), low);
  async function each(list, n, fn) {   // 一次最多 n 个一起跑，结果照 list 的先后
    const out = new Array(list.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); } }));
    return out;
  }

  /* ---------- 哪张画布、用哪个登录位 ---------- */
  async function settings(name) {
    let set = {};
    try { set = JSON.parse(unbom(await fsp.readFile(path.join(HOME, name, '资产', '出片设置.json'), 'utf8'))); } catch (e) { /* 没有就空着 */ }
    const m = UUID.exec(String(set.画布 || ''));
    const p = String(set.登录位 || '');
    return { canvas: m ? m[0].toLowerCase() : '', fixed: NAME.test(p) ? (p === 'default' ? '' : p) : null };
  }
  const dirOf = canvas => path.join(CACHE, canvas);
  async function loadCmp(canvas) {
    try { const j = JSON.parse(await fsp.readFile(path.join(dirOf(canvas), '比对.json'), 'utf8')); return { 画布图: j.画布图 || {}, 本地图: j.本地图 || {}, 画布视频: j.画布视频 || {}, 登录位: j.登录位 }; }
    catch (e) { return { 画布图: {}, 本地图: {}, 画布视频: {} }; }
  }
  async function saveCmp(canvas, cmp) {
    await fsp.mkdir(dirOf(canvas), { recursive: true });
    const f = path.join(dirOf(canvas), '比对.json'), tmp = f + '.' + process.pid + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(cmp));
    await fsp.rename(tmp, f);
  }
  const known = new Map();   // 画布 → 读得了它的登录位（'' 是默认的）
  async function pickProfile(canvas, fixed, extra) {
    if (fixed != null) return fixed;
    if (known.has(canvas)) return known.get(canvas);
    const saved = (await loadCmp(canvas)).登录位;
    const order = [...new Set([...(typeof saved === 'string' ? [saved] : []), '', ...extra.filter(x => x !== 'default')])];
    const tried = [];
    for (const p of order) {
      try { await cli(p, ['node', 'find', '--project-id', canvas, '--type', 'image', '--limit', '1']); known.set(canvas, p); return p; }
      catch (e) { tried.push((p || '默认的') + '：' + e.message); }
    }
    throw fail('这张画布哪个登录位都读不了（' + tried.join('；') + '）。到总览「即梦授权」看看登没登录、是不是这个号');
  }

  /* ---------- 画布上的图：节点名、素材编号、宽高 ---------- */
  async function listCanvas(profile, canvas) {
    const nodes = [];
    for (let off = 0; off <= 1000;) {
      const d = await cli(profile, ['node', 'find', '--project-id', canvas, '--type', 'image', '--limit', '50', '--offset', String(off)]);
      const page = d.items || d.nodes || [];
      nodes.push(...page);
      if (!d.hasMore || !page.length) break;
      off += page.length;
    }
    const ok = nodes.filter(n => n && n.nodeId && n.status === 'success'), out = [];
    for (let i = 0; i < ok.length; i += 20) {
      const d = await cli(profile, ['node', 'show', '--project-id', canvas, ...ok.slice(i, i + 20).flatMap(n => ['--node-id', n.nodeId])]);
      for (const r of d.nodes || d.items || []) {
        const n = r && (r.node || r);
        if (!n || !n.nodeId) continue;
        const res = (n.resources || []).filter(x => x && x.resourceId && x.status === 'success' && (x.type === 'image' || x.image));
        res.forEach((x, k) => out.push({ node: n.nodeId, title: String(n.title || '').trim(), rid: x.resourceId, w: (x.image && x.image.width) || 0, h: (x.image && x.image.height) || 0, 第几张: res.length > 1 ? k + 1 : 0 }));
      }
    }
    return out;
  }
  /* 节点名是哪一类、叫什么（照 AGENTS.md「即梦画布」：人物和道具_文件名、场景_文件名、第N段_文件名，认法在 公用/资产路径.js；
     11-20 以前的 人物_、道具_、特效_ 开头的，和更老的「项目_类别_叫法_资产」也认） */
  function parseTitle(title, project) {
    const a = AP.parseTitle(title);
    if (a) return { 类别: a.类别, 段: a.seg, 名称: a.名称 };
    const m = /^(.+?)_(人物|场景|道具|特效)_(.+?)(?:_资产)?$/.exec(title);
    if (m && m[1] === project) return { 类别: m[2], 段: '', 名称: m[3] };
    return { 类别: '', 段: '', 名称: title };
  }
  /* 照节点名找本地的文件：这个文件现在该叫的名字、或者 11-20 以前的老名字（AP.titlesOf）和节点名一样的。资产、历史记录/资产 都认 */
  function byName(title, files) {
    const t = String(title || '').trim();
    return t ? files.filter(f => AP.titlesOf(f).includes(t)) : [];
  }

  /* ---------- 本地的图：资产页摆得出来的那几处 ---------- */
  async function localImages(name) {
    const base = path.join(HOME, name), out = [];
    const ls = async rel => { try { return await fsp.readdir(path.join(base, ...rel), { withFileTypes: true }); } catch (e) { return []; } };
    const add = (rel, ents) => { for (const e of ents) if (e.isFile() && IMG.test(e.name)) out.push([...rel, e.name].join('/')); };
    for (const top of [['资产'], ['历史记录', '资产']]) {
      for (const c of [AP.CP, AP.SC]) add([...top, c], await ls([...top, c]));
      for (const s of (await ls([...top, AP.KF])).filter(e => e.isDirectory() && /^第.+段$/.test(e.name))) {
        const seg = [...top, AP.KF, s.name], ents = await ls(seg);
        add(seg, ents);
        for (const d of ents.filter(e => e.isDirectory())) add([...seg, d.name], await ls([...seg, d.name]));
      }
    }
    return out;
  }
  async function pngSize(abs) {   // 只读文件头；不是 PNG 回 null
    let fh;
    try {
      fh = await fsp.open(abs, 'r');
      const b = Buffer.alloc(24), { bytesRead } = await fh.read(b, 0, 24, 0);
      return bytesRead === 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null;
    } catch (e) { return null; } finally { if (fh) await fh.close().catch(() => {}); }
  }

  /* ---------- PNG 解成 8 位 RGBA，算像素校验值（全透明的点只算透明）。隔行扫描的、不是 PNG 的回 null ---------- */
  function pixelHash(buf) {
    if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    let pos = 8, w = 0, hgt = 0, depth = 0, ct = 0, inter = 0, pal = null, trns = null;
    const idat = [];
    while (pos + 8 <= buf.length) {
      const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), d = buf.subarray(pos + 8, pos + 8 + len);
      if (type === 'IHDR') { w = d.readUInt32BE(0); hgt = d.readUInt32BE(4); depth = d[8]; ct = d[9]; inter = d[12]; }
      else if (type === 'PLTE') pal = d;
      else if (type === 'tRNS') trns = d;
      else if (type === 'IDAT') idat.push(d);
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct];
    if (!w || !hgt || !ch || inter || ![1, 2, 4, 8, 16].includes(depth) || (ct === 3 && !pal)) return null;
    let raw;
    try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }
    const bpp = Math.max(1, (ch * depth) >> 3), stride = (w * ch * depth + 7) >> 3;
    if (raw.length < hgt * (stride + 1)) return null;
    const px = Buffer.alloc(hgt * stride);
    for (let y = 0; y < hgt; y++) {   // 去掉每行的滤波
      const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride, up = o - stride;
      if (f > 4) return null;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? px[o + x - bpp] : 0, b = y ? px[up + x] : 0;
        let v = raw[src + x];
        if (f === 1) v += a;
        else if (f === 2) v += b;
        else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const c = y && x >= bpp ? px[up + x - bpp] : 0, p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        px[o + x] = v & 255;
      }
    }
    const out = Buffer.alloc(w * hgt * 4), max = (1 << Math.min(depth, 8)) - 1;
    const sample = (o, i) => depth === 8 ? px[o + i] : depth === 16 ? px[o + i * 2] : (px[o + ((i * depth) >> 3)] >> (8 - depth - ((i * depth) & 7))) & max;
    const sample16 = (o, i) => depth === 16 ? px.readUInt16BE(o + i * 2) : sample(o, i);
    const scale = v => depth >= 8 ? v : Math.round(v * 255 / max);
    const tKey = trns && (ct === 0 ? [trns.readUInt16BE(0)] : ct === 2 && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null);
    for (let y = 0; y < hgt; y++) {
      const o = y * stride;
      for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        let r, g, b, a = 255;
        if (ct === 6) { r = sample(o, x * 4); g = sample(o, x * 4 + 1); b = sample(o, x * 4 + 2); a = sample(o, x * 4 + 3); }
        else if (ct === 2) { r = sample(o, x * 3); g = sample(o, x * 3 + 1); b = sample(o, x * 3 + 2); if (tKey && sample16(o, x * 3) === tKey[0] && sample16(o, x * 3 + 1) === tKey[1] && sample16(o, x * 3 + 2) === tKey[2]) a = 0; }
        else if (ct === 3) { const i = sample(o, x); r = pal[i * 3] || 0; g = pal[i * 3 + 1] || 0; b = pal[i * 3 + 2] || 0; if (trns && i < trns.length) a = trns[i]; }
        else if (ct === 4) { r = g = b = sample(o, x * 2); a = sample(o, x * 2 + 1); }
        else { r = g = b = scale(sample(o, x)); if (tKey && sample16(o, x) === tKey[0]) a = 0; }
        if (a === 0) r = g = b = 0;
        out[q] = r; out[q + 1] = g; out[q + 2] = b; out[q + 3] = a;
      }
    }
    return { w, h: hgt, hash: crypto.createHash('sha256').update(w + 'x' + hgt + ';').update(out).digest('hex') };
  }

  /* ---------- 下一张画布上的图到缓存（同一张同时只下一回；下不来隔两秒再试一回） ---------- */
  const inflight = new Map();
  function fetchImg(profile, canvas, rid) {
    const file = path.join(dirOf(canvas), rid + '.img');
    if (fs.existsSync(file)) return Promise.resolve(file);
    if (!inflight.has(rid)) inflight.set(rid, (async () => {
      await fsp.mkdir(dirOf(canvas), { recursive: true });
      const part = file + '.' + process.pid + '.part';
      for (let k = 0; ; k++) {
        try {
          await cli(profile, ['resource', 'download', rid, '--project-id', canvas, '-o', part], 150e3, true);
          await fsp.rename(part, file);
          return file;
        } catch (e) {
          await fsp.rm(part, { force: true }).catch(() => {});
          if (k) throw e;
          await sleep(2000);
        }
      }
    })().finally(() => inflight.delete(rid)));
    return inflight.get(rid);
  }

  /* ---------- 比一遍：画布上每张图，本地有没有像素一样的 ---------- */
  async function scan(name, extra, job) {
    const { canvas, fixed } = await settings(name);
    if (!canvas) throw fail('资产/出片设置.json 里还没写画布网址');
    const profile = await pickProfile(canvas, fixed, extra);
    Object.assign(job, { 画布: canvas, 登录位: profile || 'default' });
    const cmp = await loadCmp(canvas);
    cmp.登录位 = profile;
    const items = await listCanvas(profile, canvas);
    const files = await localImages(name), base = path.join(HOME, name), info = new Map();
    for (const f of files) {
      const abs = path.join(base, ...f.split('/'));
      let st;
      try { st = await fsp.stat(abs); } catch (e) { continue; }
      info.set(f, { abs, key: f + '|' + st.size + '|' + Math.floor(st.mtimeMs), size: /\.png$/i.test(f) ? await pngSize(abs) : null });
    }
    const sized = (w, h) => files.filter(f => { const x = info.get(f); return !!x && !!x.size && x.size[0] === w && x.size[1] === h; });
    const localHash = async f => {
      const x = info.get(f);
      if (!x || !x.size) return null;
      if (!(x.key in cmp.本地图)) { let r = null; try { r = pixelHash(await fsp.readFile(x.abs)); } catch (e) { /* 读不了 */ } cmp.本地图[x.key] = r && r.hash; }
      return cmp.本地图[x.key];
    };
    job.进度 = [0, items.length];
    const same = [], only = [];
    const one = async it => {
      const named = byName(it.title, files);
      const desc = { ...it, ...parseTitle(it.title, name) };
      if (!named.length && it.w && it.h && !sized(it.w, it.h).length) { only.push(desc); return; }   // 本地没有这么大的图：一定不一样，先不用下
      let c = cmp.画布图[it.rid];
      if (!c) {
        try { const r = pixelHash(await fsp.readFile(await fetchImg(profile, canvas, it.rid))); c = r ? { hash: r.hash, w: r.w, h: r.h } : { hash: null }; cmp.画布图[it.rid] = c; }
        catch (e) { c = { hash: null, err: e.message }; }
      }
      if (c.hash) for (const f of [...new Set([...named, ...sized(c.w || it.w, c.h || it.h)])]) if (await localHash(f) === c.hash) { same.push({ node: it.node, title: it.title, file: f }); return; }
      if (named.length && (!c.hash || named.some(f => !(info.get(f) || {}).size))) { same.push({ node: it.node, title: it.title, file: named[0], 只看名字: true }); return; }   // 像素比不了（不是 PNG、画布的图下不来）：名字对上就算一样
      if (named.length) desc.注 = '和本地同名的图不一样（' + named[0] + '）';
      else if (c.err) desc.注 = '没下下来，没比：' + c.err;
      only.push(desc);
    };
    let i = 0;
    await Promise.all([0, 1, 2].map(async () => { while (i < items.length) { const it = items[i++]; await one(it); job.进度 = [job.进度[0] + 1, items.length]; } }));
    await saveCmp(canvas, cmp).catch(e => log('画布比对结果没存上：' + e.message));
    const order = x => [x.类别 === '人物' || x.类别 === AP.CP ? 0 : x.类别 === '场景' ? 1 : x.类别 ? 2 : x.段 ? 3 : 4, x.段, x.名称];
    only.sort((a, b) => { const p = order(a), q = order(b); return p[0] - q[0] || p[1].localeCompare(q[1], 'zh', { numeric: true }) || p[2].localeCompare(q[2], 'zh', { numeric: true }); });
    return { 画布: canvas, 登录位: profile || 'default', 共: items.length, 一样: same, 只在画布: only.map(x => ({ node: x.node, title: x.title, rid: x.rid, w: x.w, h: x.h, 第几张: x.第几张, 类别: x.类别, 段: x.段, 名称: x.名称, 注: x.注 || '' })) };
  }

  /* ---------- 画布上和本地文件同名的节点，是本地哪一版（出片任务书用，11-17 加） ----------
     本地文件换了新的，旧版进历史记录（名字带 __时间），画布上同名的节点可能还是旧版。原来叫 Codex 去生成记录里查节点对哪个
     SHA-256，没记的就停下问人（3-4 第20条）。现在写任务书时这里先认好：
       视频：下下来算 SHA-256（即梦原样存，和上传时一样）；图：各版都是 PNG 就比像素（即梦会重压，文件不一样、像素一样）；
       比不了的（下不来、有不是 PNG 的）照上传时间认：历史记录的 __时间 是那一版被换下来的时候，上传以后头一回换下来的那一版就是它，
       那一版（没换过的就是现在的文件）要在上传前就写好了，不然认不出。
     items：[{ title 节点名, titles 画布上可能叫的几个名字（现在的在前，11-20 以前的老名字在后；没给就只查 title）, cur 现在的文件（绝对路径）, sha 它的 SHA-256, olds: [{ t __时间, f 那一版的文件, sha }] }]
     回：和 items 一一对应，每样是画布上一字不差同名的节点 [{ node, 名: 画布上现在叫的老名字（和 title 一样就不写）, 版: 'cur'｜那一版的 __时间｜''（认不出）, 凭: 文件｜画面｜时间｜对不上｜没有素材｜'' }] */
  async function versions({ name, canvas, profile, items }) {
    const cmp = await loadCmp(canvas), base = path.join(HOME, name);
    const findAll = async t => {   // 一个名字翻页查完：按名字查出来的还有 名字__时间、名字_上层 这些，只留一字不差的
      const got = [];
      for (let off = 0; off <= 1000;) {
        const d = await call(profile, ['node', 'find', '--project-id', canvas, '--name', t, '--type', 'image', '--type', 'video', '--limit', '50', '--offset', String(off)]);
        const page = d.items || d.nodes || [];
        page.filter(n => n && n.nodeId && String(n.title || '').trim() === t).forEach(n => got.push(n.nodeId));
        if (!d.hasMore || !page.length) break;
        off += page.length;
      }
      return got;
    };
    // 各样的新名、老名摊开一起查（11-21：原来一个名字查完才查下一个，我军士兵四个名字就要 12 秒，点批准出片要等二十多秒）
    const asks = items.flatMap((it, i) => (it.titles || [it.title]).map(t => ({ i, t })));
    const hits = await each(asks, 8, a => findAll(a.t));
    const found = items.map(() => new Map());   // 节点编号 → 画布上现在的名字；照名字的先后放，不照谁先查完
    asks.forEach((a, k) => hits[k].forEach(id => found[a.i].set(id, a.t)));
    for (let i = 0; i < found.length; i++) found[i] = [...found[i]];
    const ids = [...new Set(found.flat().map(x => x[0]))], res = new Map();   // 节点上的素材：编号、是不是视频、上传时间
    for (let i = 0; i < ids.length; i += 20) {
      const d = await call(profile, ['node', 'show', '--project-id', canvas, ...ids.slice(i, i + 20).flatMap(id => ['--node-id', id])]);
      for (const r of d.nodes || d.items || []) {
        const n = r && (r.node || r), x = n && (n.resources || []).find(v => v && v.resourceId && v.status === 'success');
        if (n && n.nodeId && x) res.set(n.nodeId, { rid: x.resourceId, video: x.type === 'video' || !!x.video, at: Number(x.createdAt) || 0 });
      }
    }
    const fileSha = f => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('error', no).on('data', c => h.update(c)).on('end', () => ok(h.digest('hex'))); });
    const vidSha = async rid => {   // 画布上的视频：下下来算完就删（视频大，只记校验值）
      if (cmp.画布视频[rid]) return cmp.画布视频[rid];
      await fsp.mkdir(dirOf(canvas), { recursive: true });
      const part = path.join(dirOf(canvas), rid + '.' + process.pid + '.part');
      try { await cli(profile, ['resource', 'download', rid, '--project-id', canvas, '-o', part], 300e3, true); return (cmp.画布视频[rid] = await fileSha(part)); }
      finally { await fsp.rm(part, { force: true }).catch(() => {}); }
    };
    const imgPx = async rid => {   // 画布上的图：像素校验值（和资产页同一份缓存）
      if (!(cmp.画布图[rid] && cmp.画布图[rid].hash)) { const r = pixelHash(await fsp.readFile(await fetchImg(profile, canvas, rid))); cmp.画布图[rid] = r ? { hash: r.hash, w: r.w, h: r.h } : { hash: null }; }
      return cmp.画布图[rid].hash;
    };
    const localPx = async f => {   // 本地的 PNG：键和资产页一样（项目里的路径|大小|修改时间）
      let st;
      try { st = await fsp.stat(f); } catch (e) { return null; }
      const key = path.relative(base, f).split(path.sep).join('/') + '|' + st.size + '|' + Math.floor(st.mtimeMs);
      if (!(key in cmp.本地图)) { let r = null; try { r = pixelHash(await fsp.readFile(f)); } catch (e) { /* 读不了 */ } cmp.本地图[key] = r && r.hash; }
      return cmp.本地图[key];
    };
    const mtime = async f => { try { return (await fsp.stat(f)).mtimeMs; } catch (e) { return Infinity; } };
    const stampMs = t => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)$/.exec(t); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : NaN; };
    const byTime = async (it, at) => {
      if (!at) return '';
      const hit = it.olds.map(o => ({ ...o, ms: stampMs(o.t) })).filter(o => o.ms >= at).sort((a, b) => a.ms - b.ms)[0];
      return (await mtime(hit ? hit.f : it.cur)) <= at + 60e3 ? (hit ? hit.t : 'cur') : '';   // 一分钟：本机和即梦的钟对不齐
    };
    const judge = async (it, id) => {
      const x = res.get(id);
      if (!x) return { node: id, 版: '', 凭: '没有素材' };
      const all = [{ t: 'cur', f: it.cur, sha: it.sha }, ...it.olds];
      try {
        if (x.video) { const h = await vidSha(x.rid), v = all.find(o => o.sha === h); return { node: id, 版: v ? v.t : '', 凭: v ? '文件' : '对不上' }; }
        if (all.every(o => /\.png$/i.test(o.f))) {
          const h = await imgPx(x.rid);
          if (h) {   // 照上传时间猜的那一版先比（一张大图解开要大半秒，旧版多的头一回能省好几秒），比中就停
            const guess = await byTime(it, x.at);
            let blind = false;
            for (const o of [...all.filter(o => o.t === guess), ...all.filter(o => o.t !== guess)]) { const p = await localPx(o.f); if (p === h) return { node: id, 版: o.t, 凭: '画面' }; if (!p) blind = true; }
            if (!blind) return { node: id, 版: '', 凭: '对不上' };
          }
        }
      } catch (e) { log('画布上的 ' + id + ' 没下下来，照上传时间认：' + e.message); }
      const t = await byTime(it, x.at);
      return { node: id, 版: t, 凭: t ? '时间' : '' };
    };
    const out = await Promise.all(items.map((it, i) => Promise.all(found[i].map(async ([id, t]) => ({ ...await judge(it, id), ...(t !== it.title ? { 名: t } : {}) })))));   // 各样一起认（下图照旧走 cli 排队，最多三条）
    await saveCmp(canvas, cmp).catch(e => log('画布比对结果没存上：' + e.message));
    return out;
  }
  /* 出片任务书里「换过新的」那一样：画布上叫 nm 的节点各怎么办（照 versions 认的结果写给 Codex） */
  function plan(nm, nodes) {
    const why = { 文件: '下载下来比过文件', 画面: '下载下来比过画面', 时间: '照上传时间认的' };
    const lost = { 对不上: '下载下来比过，和本地哪一版都对不上', 没有素材: '节点上没有素材' };
    const head = '这个文件换过新的，旧版收在历史记录。', tail = '开工时画布上要是多出这里没写的「' + nm + '」，也停下问我。';
    if (!nodes.length) return head + '生成任务书时查过画布，没有叫「' + nm + '」的节点：照这个文件传一个新节点，名字写「' + nm + '」。' + tail;
    const cur = nodes.filter(x => x.版 === 'cur'), old = nodes.filter(x => x.版 && x.版 !== 'cur'), odd = nodes.filter(x => !x.版);
    const say = [...old.map(x => x.node + ' 是旧版（' + why[x.凭] + '），先把它改名成「' + nm + '__' + x.版 + '」（照 AGENTS.md，只改名，不删）'),
      ...cur.map((x, i) => { const old = !!x.名 && x.名 !== nm; return x.node + (old ? '（画布上还叫老名字「' + x.名 + '」）' : '') + ' 就是现在这个文件（' + why[x.凭] + '），' + (i ? '不用管它' : old ? '先把它改名成「' + nm + '」再引用，不重传' : '直接引用，不重传'); }),
      ...odd.map(x => x.node + ' 认不出是哪一版（' + (lost[x.凭] || '下不下来，也没法照上传时间认') + '）')];
    return head + '生成任务书时查过画布上叫「' + nm + '」的节点：' + say.join('；') + '。'
      + (odd.length ? '有认不出的：这一样先别改名、别传，停下问我。' : cur.length ? '' : '改好名再照这个文件传一个新节点，名字写「' + nm + '」。') + tail;
  }

  const jobs = new Map();   // 项目 → { 状态: 在对|好了|出错, 进度, 结果, 错误, 时间 }
  async function handle(req, res, q, { json, httpErr }) {
    const name = String(q.get('p') || '');
    if (!name || /[<>:"\\/|?*\u0000-\u001f]/.test(name) || /^\.+$/.test(name) || !fs.existsSync(path.join(HOME, name))) throw httpErr(400, '没有这个项目');
    const extra = String(q.get('jm') || '').split(',').filter(x => NAME.test(x));
    if (q.has('img')) {
      const m = UUID.exec(String(q.get('img')));
      if (!m || m[0] !== String(q.get('img'))) throw httpErr(400, '素材编号不对');
      const { canvas, fixed } = await settings(name);
      if (!canvas) throw httpErr(404, '资产/出片设置.json 里还没写画布网址');
      let buf;
      try { buf = await fsp.readFile(await fetchImg(await pickProfile(canvas, fixed, extra), canvas, m[0])); }
      catch (e) { throw httpErr(502, '画布上的图下不来：' + e.message); }
      const type = buf[0] === 0x89 ? 'image/png' : buf[0] === 0xff ? 'image/jpeg' : buf.toString('latin1', 8, 12) === 'WEBP' ? 'image/webp' : 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(buf);
      return;
    }
    if (!(await settings(name)).canvas) { jobs.delete(name); return json(res, { 状态: '没画布', 进度: [0, 0], 错误: '' }); }   // 这个项目还没用即梦画布
    let job = jobs.get(name);
    const fresh = job && job.状态 === '好了' && Date.now() - job.时间 < STALE && !q.has('again');
    if (!job || (job.状态 !== '在对' && !fresh)) {
      const before = job && job.结果;
      job = { 状态: '在对', 进度: [0, 0], 时间: Date.now(), 结果: before };   // 重读的时候，上一回比好的先接着给
      jobs.set(name, job);
      const self = job;
      self.跑 = scan(name, extra, self).then(r => { Object.assign(self, { 状态: '好了', 结果: r, 错误: '', 时间: Date.now() }); },
        e => { Object.assign(self, { 状态: '出错', 错误: e.message, 时间: Date.now() }); log('读画布出错：' + e.message); });
      await Promise.race([self.跑, sleep(1500)]);   // 缓存里都有的，一下就好：这一回就带上结果
    }
    return json(res, { 状态: job.状态, 进度: job.进度, 错误: job.错误 || '', 时间: job.时间, ...(job.结果 || {}) });
  }
  return { handle, versions, plan };
};
