/* ============================================================
   公用 · 审片（window.Review）：审片台.html（流水线「审片」）、看文件那一页（项目管理.html）的审片共用这一份
   从 mp4 头里读帧率和帧数、时间和帧号怎么写、批注文件（样片名_批注.md）怎么读写、截图怎么存。
   两页写出来的批注文件一个格式：AI 一读就懂，两页都读得回来（一页写了「对照」「弃用关键帧」，另一页改了也照原样留着）。
   本机服务 jobs.js 也读这份文件（截图、弃用关键帧那几行），改格式要一起改。
   截图、存取文件那几样要在网页里用（经本机服务读写，靠 底座.js、界面.js）；别的在 node 里也能跑（审片_测试.cjs）。
   ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Review = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const uid = () => Math.random().toString(36).slice(2, 10);
  const baseName = s => String(s).trim().split(/[\\/]/).pop();
  const clean = p => (typeof p === 'string' ? p : '').trim().replace(/\\/g, '/');

  /* ---------- 从 mp4 头里读帧率和帧数；读不出给 null（页面按每秒 24 帧） ---------- */
  const fourcc = (dv, p) => String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
  function boxAt(dv, p, end) {
    if (p + 8 > end) return null;
    let size = dv.getUint32(p), head = 8;
    if (size === 1) { if (p + 16 > end) return null; size = Number(dv.getBigUint64(p + 8)); head = 16; }
    else if (size === 0) size = end - p;
    if (size < head || p + size > end) return null;
    return { type: fourcc(dv, p + 4), start: p + head, end: p + size };
  }
  function boxes(dv, box) { const out = []; for (let p = box.start; p < box.end;) { const b = boxAt(dv, p, box.end); if (!b) break; out.push(b); p = b.end; } return out; }
  const child = (dv, box, type) => box ? boxes(dv, box).find(b => b.type === type) || null : null;
  function snapFps(x) {
    const std = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60];
    const c = std.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
    return Math.abs(c - x) / c < 0.01 ? c : x;
  }
  /* file：File 或 Blob（有 size、slice） → { frames, fps } */
  async function videoInfo(file) {
    try {
      let p = 0, moov = null;
      while (p + 8 <= file.size) {
        const dv = new DataView(await file.slice(p, p + 16).arrayBuffer());
        let size = dv.getUint32(0), head = 8;
        if (size === 1) { size = Number(dv.getBigUint64(8)); head = 16; } else if (size === 0) size = file.size - p;
        if (size < head) return null;
        if (fourcc(dv, 4) === 'moov') { moov = new DataView(await file.slice(p, p + size).arrayBuffer()); break; }
        p += size;
      }
      if (!moov) return null;
      for (const trak of boxes(moov, boxAt(moov, 0, moov.byteLength)).filter(b => b.type === 'trak')) {
        const mdia = child(moov, trak, 'mdia'), hdlr = child(moov, mdia, 'hdlr'), mdhd = child(moov, mdia, 'mdhd');
        if (!hdlr || !mdhd || fourcc(moov, hdlr.start + 8) !== 'vide') continue;
        const scale = moov.getUint32(mdhd.start + (moov.getUint8(mdhd.start) === 1 ? 20 : 12));
        const stts = child(moov, child(moov, child(moov, mdia, 'minf'), 'stbl'), 'stts');
        if (!stts) return null;
        let frames = 0, ticks = 0;
        for (let i = 0, n = moov.getUint32(stts.start + 4); i < n; i++) {
          const c = moov.getUint32(stts.start + 8 + i * 8);
          frames += c; ticks += c * moov.getUint32(stts.start + 12 + i * 8);
        }
        return frames && ticks && scale ? { frames, fps: snapFps(frames * scale / ticks) } : null;
      }
    } catch (e) { /* 不是 mp4，或者头坏了 */ }
    return null;
  }

  /* ---------- 时间：分:秒.十分之一秒；帧号给人看从 1 数。n 是一条批注：f 开始帧，f2 结束帧（没有是 null） ---------- */
  function fmt(t) { const d = Math.max(0, Math.floor(t * 10 + 1e-6)); return Math.floor(d / 600) + ':' + String(Math.floor(d / 10) % 60).padStart(2, '0') + '.' + (d % 10); }
  const fmtF = (f, fps) => fmt(f / fps);
  const fpsText = x => String(Math.round(x * 1000) / 1000);
  const rangeText = (n, fps) => n.f2 == null ? fmtF(n.f, fps) : fmtF(n.f, fps) + '～' + fmtF(n.f2, fps);
  const frameText = n => n.f2 == null ? '第' + (n.f + 1) + '帧' : '第' + (n.f + 1) + '～' + (n.f2 + 1) + '帧';
  function shotFileName(f, fps) { const d = Math.floor(f / fps * 10 + 1e-6); return Math.floor(d / 600) + '分' + String(Math.floor(d / 10) % 60).padStart(2, '0') + '.' + (d % 10) + '秒_第' + (f + 1) + '帧.jpg'; }
  const byFrame = (a, b) => a.f - b.f || (a.f2 == null ? a.f : a.f2) - (b.f2 == null ? b.f : b.f2);
  /* 删批注时问的那一句里摆的：时间＋前 60 个字 */
  const brief = (n, fps) => rangeText(n, fps) + '　' + (n.text.length > 60 ? n.text.slice(0, 60) + '…' : n.text);

  /* ---------- 写批注时的几样 ---------- */
  const CATS = ['光影', '镜头', '表演', '声音', '其他'];
  const catsOf = set => [...CATS.filter(c => set.has(c)), ...[...set].filter(c => !CATS.includes(c))];   // 分类照固定的先后，自己加的排后面
  const shotOf = s => { s = String(s).trim(); return /^[0-9０-９]+$/.test(s) ? s.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).padStart(2, '0') : s; };   // 只写了数字：两位，全角改半角

  /* ---------- 批注文件 ---------- */
  const mdEsc = s => s.replace(/^#/gm, '＃');
  /* 写进批注的路径。parts 从总文件夹算起；abs：本机服务给的总文件夹完整位置，有就写 E:\ 开头的，没有就写相对这份批注所在文件夹的 */
  function relPath(notesAt, parts, abs) {
    if (abs) return [abs, ...parts].join('\\');
    const base = notesAt.slice(0, -1);
    let i = 0;
    while (i < base.length && i < parts.length - 1 && base[i] === parts[i]) i++;
    return '../'.repeat(base.length - i) + parts.slice(i).join('/');
  }
  /* 「第12帧」「第3～40帧」，没有帧号就认「0:01.5～0:02.0」→ [开始帧, 结束帧或 null] */
  function framesOf(s, fps) {
    const m = /第\s*(\d+)\s*(?:帧)?\s*(?:[～~\-–—至到]\s*第?\s*(\d+)\s*)?帧/.exec(s);
    if (m) return [m[1] - 1, m[2] ? m[2] - 1 : null];
    const ts = [...s.matchAll(/(\d+):(\d{1,2}(?:\.\d+)?)/g)].map(x => (+x[1]) * 60 + (+x[2]));
    return ts.length ? [Math.round(ts[0] * fps), ts[1] != null ? Math.round(ts[1] * fps) : null] : null;
  }
  /* 「弃用关键帧：@图片9 E:\…\资产\第3-4段\镜头4_首帧.png」→ { ref, rel 从项目里面写起（认不出空着，照编号认）, raw 原样 } */
  function kfParse(s) {
    const m = /^(@图片\d+)\s*(.*)$/.exec(String(s).trim());
    if (!m) return null;
    const p = clean(m[2]), k = p.lastIndexOf('/资产/');
    return { ref: m[1], rel: k >= 0 ? p.slice(k + 1) : p.startsWith('资产/') ? p : '', raw: m[2].trim() };
  }
  /* 读：{ prompt 提示词文件名, promptLine 提示词那一行原样, general 整体, notes: [{ id, f, f2, cats, shot, cmp, kf, img, img2, text }] } */
  function parseNotes(md, fps) {
    const out = { prompt: '', promptLine: '', general: '', notes: [] }, all = [];
    let cur = null;
    for (const line of String(md).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const hd = /^##\s*(整体|\d+)\s*(?:[｜|]\s*(.*))?$/.exec(line);
      if (hd) { all.push(cur = { general: hd[1] === '整体', head: (hd[2] || '').trim(), time: '', cats: [], shot: '', cmp: '', kf: null, img: '', img2: '', text: null }); continue; }
      if (!cur) { const m = /^提示词：\s*(.+)$/.exec(line); if (m) { out.promptLine = m[1].trim(); out.prompt = baseName(m[1]); } continue; }
      if (cur.text !== null) { cur.text += '\n' + line; continue; }   // 批注写在最后，可以有好几行
      let m;
      if ((m = /^批注：(.*)$/.exec(line))) cur.text = m[1];
      else if ((m = /^时间：(.*)$/.exec(line))) cur.time = m[1];
      else if ((m = /^分类：(.*)$/.exec(line))) cur.cats = m[1].split(/[、，,\/／\s]+/).filter(Boolean);
      else if ((m = /^镜头：(.*)$/.exec(line))) cur.shot = m[1].trim();
      else if ((m = /^弃用关键帧：(.*)$/.exec(line))) cur.kf = kfParse(m[1]);
      else if ((m = /^对照：(.*)$/.exec(line))) cur.cmp = m[1].trim();
      else if ((m = /^结束截图：(.*)$/.exec(line))) cur.img2 = baseName(m[1]);
      else if ((m = /^截图：(.*)$/.exec(line))) cur.img = baseName(m[1]);
    }
    for (const x of all) {
      const text = (x.text || '').trim();
      if (!text) continue;
      if (x.general) { out.general = text; continue; }
      const fr = framesOf(x.time || x.head, fps);
      if (!fr) continue;
      out.notes.push({ id: uid(), f: fr[0], f2: fr[1] != null && fr[1] !== fr[0] ? fr[1] : null, cats: x.cats, shot: x.shot, cmp: x.cmp, kf: x.kf, img: x.img, img2: x.img2, text });
    }
    out.notes.sort(byFrame);
    return out;
  }
  /* 写：o = { title 样片名, video 样片路径, prompt 提示词那一行（空就不写）, fps, general, notes,
       where 在哪写的（「流水线「审片」」），shotWord 「镜头」对应提示词里的什么（「镜头 N」），rel 路径是相对的,
       show(parts) 截图的路径怎么写, shotsDir 截图文件夹, kfShow(kf) 弃用的那张关键帧路径怎么写 } */
  function notesText(o) {
    const L = ['# 审片批注｜' + o.title, '', '视频：' + o.video];
    if (o.prompt) L.push('提示词：' + o.prompt);
    L.push('', '用户在' + o.where + '里边看这条样片边写的批注。时间是样片里的位置（分:秒.十分之一秒），括号里是第几帧（从 1 数，每秒 ' + fpsText(o.fps) + ' 帧）；「镜头」对应提示词里的「' + o.shotWord + '」；'
      + (o.notes.some(n => n.cmp) ? '「对照」是写这一条时旁边摆着对照的东西（白模、另一条样片是同一时刻的画面，关键帧是这一镜开头那一刻该有的样子）；' : '')
      + (o.notes.some(n => n.kf) ? '写了「弃用关键帧」的，是用户不要这张关键帧了，「批注」写的是为什么；' : '')
      + '截图是写这条批注时停住的那一帧，先看截图再读批注。' + (o.rel ? '路径都相对这份批注所在的文件夹。' : ''), '');
    if (o.general.trim()) L.push('## 整体', '批注：' + mdEsc(o.general.trim()), '');
    o.notes.forEach((n, i) => {
      L.push('## ' + (i + 1) + '｜' + rangeText(n, o.fps), '时间：' + rangeText(n, o.fps) + '（' + frameText(n) + '）');
      if (n.cats.length) L.push('分类：' + n.cats.join('、'));
      if (n.shot) L.push('镜头：' + n.shot);
      if (n.kf) L.push('弃用关键帧：' + n.kf.ref + ' ' + o.kfShow(n.kf));
      if (n.cmp) L.push('对照：' + n.cmp);
      if (n.img) L.push('截图：' + o.show([...o.shotsDir, n.img]));
      if (n.img2) L.push('结束截图：' + o.show([...o.shotsDir, n.img2]));
      L.push('批注：' + mdEsc(n.text), '');
    });
    return L.join('\n');
  }

  /* ---------- 网页里用的：画面、文件（经本机服务）。st 是一条样片的状态：notesAt、shotsDir、fps、notes、general、mdMtime、q、saveT、saving、err、thumbs ---------- */
  const G = typeof globalThis !== 'undefined' ? globalThis : this;
  const B = () => G.Base, U = () => G.UI;   // 底座.js、界面.js：用到的时候才拿
  const HAS_RVFC = typeof HTMLVideoElement !== 'undefined' && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  /* 跳到第 t 秒，等画面到了（最多等两秒） */
  function seekRaw(video, t) {
    return new Promise(res => {
      let done = false;
      const fin = () => { if (done) return; done = true; video.removeEventListener('seeked', fin); clearTimeout(tm); res(); };
      const tm = setTimeout(fin, 2000);
      video.addEventListener('seeked', fin);
      video.currentTime = isFinite(video.duration) ? Math.min(t, video.duration) : t;
    });
  }
  function grab(video) {
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('浏览器没给出图片')), 'image/jpeg', 0.92));
  }
  /* 截下停着的这一帧 f：{ f, blob, url, img: '' }；没截下来就只有帧号 */
  async function grabEnd(video, f) {
    try { const blob = await grab(video); return { f, blob, url: URL.createObjectURL(blob), img: '' }; }
    catch (e) { U().toast('这一帧没截下来：' + e.message, 'err'); return { f, img: '' }; }
  }
  async function readNotes(st) {
    try {
      const r = await B().FS.read(st.notesAt), p = parseNotes(B().C.decodeText(r.buf).text, st.fps);
      st.notes = p.notes; st.general = p.general; st.mdMtime = r.mtime;
      return p;
    } catch (e) { st.notes = []; st.general = ''; st.mdMtime = 0; return null; }
  }
  /* 写进文件；批注全删光就删掉文件。上一次还没写完的，排在后面接着写。text()：写的那一刻的批注文字；after()：写完（成没成）以后 */
  function saveNotes(st, text, after) {
    clearTimeout(st.saveT); st.saveT = 0;
    st.q = st.q.then(async () => {
      const { FS } = B();
      st.saving = true;
      try {
        if (st.notes.length || st.general.trim()) await FS.write(st.notesAt, new TextEncoder().encode(text()));
        else if (await FS.stat(st.notesAt)) await FS.remove(st.notesAt);
        const s = await FS.stat(st.notesAt);
        st.mdMtime = s ? s.mtime : 0; st.err = '';
      } catch (e) { st.err = e.message; U().toast('批注没存上：' + e.message, 'err'); }
      finally { st.saving = false; }
      if (after) after();
    });
    return st.q;
  }
  async function writeShot(st, f, blob) {
    const name = shotFileName(f, st.fps);
    try {
      await B().FS.write([...st.shotsDir, name], blob);
      const old = st.thumbs.get(name); if (old) old.then(URL.revokeObjectURL).catch(() => {});
      st.thumbs.set(name, Promise.resolve(URL.createObjectURL(blob)));
      return name;
    } catch (e) { U().toast('截图没存上：' + e.message, 'err'); return ''; }
  }
  function shotImg(st, name, cls) {
    const { h } = U();
    const img = h('img', { alt: name, class: cls || null, decoding: 'async' });
    if (!st.thumbs.has(name)) st.thumbs.set(name, B().FS.file([...st.shotsDir, name]).then(f => URL.createObjectURL(f)));
    st.thumbs.get(name).then(u => { img.src = u; }).catch(() => { st.thumbs.delete(name); img.replaceWith(h('span', null, '图不见了')); });
    return img;
  }
  /* 批注删了、改了时间，原来的截图没别的批注用，就删掉；文件夹空了也删掉 */
  async function dropUnused(st, names) {
    const { FS } = B();
    const used = new Set(st.notes.flatMap(n => [n.img, n.img2]).filter(Boolean));
    for (const name of new Set(names.filter(Boolean))) {
      if (used.has(name)) continue;
      try { await FS.remove([...st.shotsDir, name]); } catch (e) { /* 已经没了 */ }
      const u = st.thumbs.get(name); if (u) { u.then(URL.revokeObjectURL).catch(() => {}); st.thumbs.delete(name); }
    }
    if (!used.size) { try { await FS.remove(st.shotsDir); } catch (e) { /* 还有别的文件，或者本来就没有 */ } }
  }

  return Object.freeze({
    videoInfo, snapFps, fmt, fmtF, fpsText, rangeText, frameText, shotFileName, byFrame, brief, CATS, catsOf, shotOf,
    mdEsc, relPath, framesOf, kfParse, parseNotes, notesText,
    HAS_RVFC, seekRaw, grab, grabEnd, readNotes, saveNotes, writeShot, shotImg, dropUnused,
  });
});
