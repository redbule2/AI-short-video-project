/* 资产照的哪一句（2026-11-23 他要「资产跟着改」：前面改了，后面照旧版做的要标出来。
   起因：面试被拒 1-1 的第二家面试单位从会议室改成前台，旧的会议室图照算可用，卡上还劝「用上这张图」）。
   每张资产图、每份出图提示词记下它照的是哪一句描写，场景还记下用到它的镜头：流水线.json 顶上的「照的」{ 项目里的路径: { 描写, 镜头, 时间 } }。
   旧了：现在的描写和记下的不一样（描写改了）；场景多了、改了用到它的镜头（镜头改了，删掉的不算）；图出好以后出图提示词又改过（字改了；图文件比字新、同一刻换的不算）。
   旧了的图不算确认过（关键帧、提示词不照它）；资产卡上标出来，原来和现在并排，只给「重画」「旧图还能用」。
   记的时候：页面确认可用、旧图还能用、用新图；本机服务在 Codex 里定稿（codex-draw.js，照点出图那一刻的）、AI 照描写写好字（jobs.js 写字）。
   记下以后文件又换过（别处挑来的图、手改的字）：不知道照的哪一句，不标。
   用到的：流水线.js、资产旧图.js、资产.html、资产详情.js，本机服务 jobs.js、codex-draw.js。测试：node 通用工具/测试/资产照的_测试.cjs */
(function (root, factory) {
  const node = typeof module === 'object' && !!module.exports;
  const api = factory(node ? require('./资产归类.js') : root.AssetScope);
  if (node) module.exports = api;
  else root.AssetSrc = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Scope) {
  'use strict';
  const KINDS = Object.freeze(['人物', '道具', '场景']);
  const str = v => typeof v === 'string' ? v : v == null ? '' : String(v);
  const flat = t => str(t).replace(/\s+/g, ' ').trim();   // 摆出来、记下来：一行
  const bare = t => str(t).replace(/\s+/g, '');   // 比的时候不管空格、换行
  const timeOf = t => { const n = Date.parse(str(t).trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
  const place = t => Scope.place(flat(t));   // 场景的地方名：「面摊：傍晚……」→ 面摊（两边都照它算，才比得上）
  const box = doc => doc && isObj(doc.rest) ? doc.rest : doc;   // 页面读进来的流水线，不认识的项在 rest 里

  /* ---------- 现在的样子 ---------- */
  /* 现在的描写：人物、道具是那一行的「描写」；场景是全片场景里地方名对得上的那一句 */
  function descOf(doc, kind, name) {
    if (!doc || !flat(name)) return '';
    if (kind === '场景') { const k = place(name); return str(doc.场景).split(/\r?\n/).map(l => l.trim()).find(l => l && place(l) === k) || ''; }
    const e = (Array.isArray(doc[kind]) ? doc[kind] : []).find(x => x && flat(x.名) === flat(name));
    return e ? str(e.描写).trim() : '';
  }
  /* 用到这处场景的镜头（写什么），全片各段的：镜头表标了出场的，只看标了它的那几镜；这一段一镜都没标（老的提炼），选了它就算整段 */
  function shotsOf(doc, name) {
    const out = [];
    for (const s of doc && Array.isArray(doc.场) ? doc.场 : []) {
      if (!isObj(s)) continue;
      const rows = (Array.isArray(s.段落) ? s.段落 : []).filter(isObj);
      const pick = Scope.marked(s) ? rows.filter(x => Scope.inRow(x, '场景', name)) : Scope.inCast(s, '场景', name) ? rows : [];
      for (const x of pick) { const t = flat(x.写什么 !== undefined ? x.写什么 : x.拍什么); if (t && !out.includes(t)) out.push(t); }
    }
    return out;
  }
  /* 这一样现在照的：{ 描写 }，场景还有 镜头 */
  const nowOf = (doc, kind, name) => kind === '场景' ? { 描写: descOf(doc, kind, name), 镜头: shotsOf(doc, name) } : { 描写: descOf(doc, kind, name) };

  /* ---------- 记下的 ---------- */
  const tidy = (snap, time) => ({ 描写: str(snap && snap.描写).trim(), ...(snap && Array.isArray(snap.镜头) ? { 镜头: snap.镜头.map(flat).filter(Boolean) } : {}), 时间: str(time) });
  function recOf(doc, file) {
    const m = (box(doc) || {}).照的, r = isObj(m) && file ? m[file] : null;
    return isObj(r) ? tidy(r, r.时间) : null;
  }
  /* 记下这个文件照的哪一句。snap：nowOf 给的；time：记的时间（nowText 的样子）。描写、镜头都空着的不记。记上了回 true */
  function record(doc, file, snap, time) {
    const b = box(doc);
    if (!b || !file || !snap || (!flat(snap.描写) && !(Array.isArray(snap.镜头) && snap.镜头.some(flat)))) return false;
    if (!isObj(b.照的)) b.照的 = {};
    b.照的[file] = tidy(snap, time);
    return true;
  }
  /* 图换过（照批注改出来的）：还是照原来那一句改的，记下的照留，时间换成现在 */
  function restamp(doc, file, time) {
    const r = recOf(doc, file);
    if (!r) return false;
    box(doc).照的[file] = { ...r, 时间: str(time) };
    return true;
  }

  /* ---------- 旧了没有 ---------- */
  /* 记下的和现在的比：描写不一样（两边都有字才算）；场景多了或改了镜头（删掉的不算，记的时候没记镜头的不比）。都一样回 null */
  function diff(rec, now) {
    if (!rec || !now) return null;
    const out = {}, a = bare(rec.描写), b = bare(now.描写);
    if (a && b && a !== b) out.描写 = { 原来: str(rec.描写).trim(), 现在: str(now.描写).trim() };
    if (Array.isArray(rec.镜头) && Array.isArray(now.镜头)) {
      const was = new Set(rec.镜头.map(bare)), add = now.镜头.filter(t => bare(t) && !was.has(bare(t))).map(flat);
      if (add.length) out.镜头 = add;
    }
    return out.描写 || out.镜头 ? out : null;
  }
  const fresh = (r, t) => !!r && !(t && t > timeOf(r.时间) + 999);   // 记下以后文件没再换过
  /* 一张图旧了没有：kind、name 它是哪一样（场景的 name 写地方名）；imgTime 图文件的修改时间（毫秒，不知道给 0） */
  function imgStale(doc, file, kind, name, imgTime) {
    if (!KINDS.includes(kind)) return null;
    const r = recOf(doc, file);
    return fresh(r, imgTime) ? diff(r, nowOf(doc, kind, name)) : null;
  }
  /* 这张图出好（确认可用、记下）以后，出图提示词又改过：字改了。okTime：确认可用的时间（没确认给 0）；wordTime：字的修改时间；
     imgTime：图文件的修改时间（不知道给 0）。图文件比字新、或和字同一刻换的，图就是照这份字出的，不算（11-26 大砍刀：图和字在流水线外一起换，被误标） */
  function wordEdited(doc, file, okTime, wordTime, imgTime) {
    const r = recOf(doc, file), ref = Math.max(r ? timeOf(r.时间) : 0, okTime || 0);
    return !!ref && !!wordTime && wordTime > Math.max(ref, imgTime || 0) + 999;
  }
  /* 出图提示词旧了没有（照它出图以前要不要先改）：看字记下的；字没记、或者记下以后又改过，看图记下的（字比图早，图就是照它出的） */
  function wordStale(doc, word, kind, name, wordTime, img, imgTime) {
    if (!KINDS.includes(kind)) return null;
    let r = recOf(doc, word);
    if (!fresh(r, wordTime)) { const g = img ? recOf(doc, img) : null; r = fresh(g, imgTime) && fresh(g, wordTime) ? g : null; }
    return r ? diff(r, nowOf(doc, kind, name)) : null;
  }

  /* ---------- 说出来 ---------- */
  /* 卡上那几个字（d：imgStale 给的，字改了另加 字: true） */
  const tagOf = d => !d ? '' : d.描写 ? '描写改了' : d.镜头 ? '镜头改了' : d.字 ? '字改了' : '';
  /* 发进 Codex 的话里加的几行（不空行、不写 Markdown 列表，codex-chat 才核得上输入框） */
  function msgLines(d) {
    if (!d) return [];
    return [...(d.描写 ? ['这回描写改了。原来：' + flat(d.描写.原来), '现在：' + flat(d.描写.现在)] : []),
      ...(Array.isArray(d.镜头) && d.镜头.length ? ['用到它的镜头多了：' + d.镜头.map(flat).join('；')] : [])];
  }
  /* 页面交过来的「照的」「变了」：只留认得的几样，字数有个上限 */
  const cut = (t, n) => str(t).trim().slice(0, n);
  function cleanSnap(v) {
    if (!isObj(v)) return null;
    const out = { 描写: cut(v.描写, 4000), ...(Array.isArray(v.镜头) ? { 镜头: v.镜头.slice(0, 80).map(x => cut(flat(x), 400)).filter(Boolean) } : {}) };
    return out.描写 || (out.镜头 || []).length ? out : null;
  }
  function cleanDiff(v) {
    if (!isObj(v)) return null;
    const d = isObj(v.描写) && cut(v.描写.原来, 4000) && cut(v.描写.现在, 4000) ? { 原来: cut(v.描写.原来, 4000), 现在: cut(v.描写.现在, 4000) } : null;
    const add = Array.isArray(v.镜头) ? v.镜头.slice(0, 40).map(x => cut(flat(x), 400)).filter(Boolean) : [];
    return d || add.length ? { ...(d ? { 描写: d } : {}), ...(add.length ? { 镜头: add } : {}) } : null;
  }
  return Object.freeze({ KINDS, descOf, shotsOf, nowOf, recOf, record, restamp, diff, imgStale, wordEdited, wordStale, tagOf, msgLines, cleanSnap, cleanDiff });
});
