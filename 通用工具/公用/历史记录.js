/* ============================================================
   公用 · 历史记录（Hist）：提示词、审片、资产三页的「历史记录」筛选共用（2026-11-19 他要的：默认不摆历史记录，点一下只看历史记录里的）。
   收进去的文件：历史记录/同样的路径/原名__年月日-时分秒.后缀（有的时间后面还带几位随机字：__20261111-075528-9139db.json）；
   审完没选上的样片收进去名字不改。
     Hist.parse(name)：{ name, orig: 原名（带后缀）, stamp: '20261119-163701', when: '11-19 16:37' }；名字里没带时间的 stamp、when 是空串，orig 就是它。
     Hist.newer(a, b)：排先后用，新的在前（带时间的照时间；没带的照修改时间 mtime）。
     Hist.promptSha(text)：提示词的 SHA-256（去掉 BOM、换行统一成 \n，和 通用工具/核对参考素材.py 一样），给 Promise。
     Hist.refsBySha(maps, key, sha)：几份参考素材映射（现在的和 历史记录/资产/参考素材映射__时间.json 留的底）里，
       哪一份登记的这一条（key：提示词/第N段/原名）正好是这一版的字（prompt_sha256 对得上）；给 { refs, from }（登记了每一镜几秒的多一个 secs）或 null。
     Hist.mapsOf(io)、Hist.refsFor(io, maps, it, text)：一条提示词（现在的、历史记录里的一版）挂的是哪几张图（流水线历史记录、写稿页「参考」共用）。
     Hist.ms(stamp)：收进去的那一刻（本机时间，毫秒）；不是时间给 0。
     Hist.made(...)：一段里每一版（历史记录里的、现在的）出过哪几条样片（流水线历史记录、审片台、写稿页「参考」共用；样子写在它上面）。
     Hist.pairs(...)：一段里提示词和它出的样片对不上的（2026-11-26 他定同进同出；本机服务 pair-keeper.js 照它跟着挪）。
     Hist.KIN、Hist.promptKin、Hist.dated、Hist.stampOf：一版提示词收进历史记录时跟着走的几样、收进去叫什么（删提示词、同进同出共用）。
   网页里、node 里都能用（made、pairs 要先引 公用/核心.js、公用/样片归属.js）。测试：node --test 通用工具/测试/历史记录_测试.cjs、同进同出_测试.cjs
   ============================================================ */
(function (G) {
'use strict';
const AP = () => G.AssetPath || require('./资产路径.js');   // 资产放哪（公用/资产路径.js）：老登记里的路径换成新的
const CO = () => G.ClipOf || require('./样片归属.js');   // 样片是哪一条出的（公用/样片归属.js）
const CORE = () => G.Core || require('./核心.js');   // 视频提示词、样片的名字（公用/核心.js）
const RE = /^(.+)__([0-9]{8})-([0-9]{6})(?:-[0-9a-z]+)?(\.[^./\\]+)?$/i;
const when = stamp => /^[0-9]{8}-[0-9]{6}$/.test(stamp || '') ? stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + ' ' + stamp.slice(9, 11) + ':' + stamp.slice(11, 13) : '';
const ms = stamp => { const m = /^([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})$/.exec(stamp || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0; };
function parse(name) {
  const n = String(name || ''), m = RE.exec(n);
  if (!m) return { name: n, orig: n, stamp: '', when: '' };
  const stamp = m[2] + '-' + m[3];
  return { name: n, orig: m[1] + (m[4] || ''), stamp, when: when(stamp) };
}
/* 新的在前：都带时间照时间比；有一个没带，照修改时间（毫秒）；再一样照名字 */
const newer = (a, b) => (a.stamp && b.stamp ? b.stamp.localeCompare(a.stamp) : 0) || (b.mtime || 0) - (a.mtime || 0) || String(a.name).localeCompare(String(b.name), 'zh', { numeric: true });
const norm = t => { const x = String(t); return (x.charCodeAt(0) === 0xfeff ? x.slice(1) : x).replace(/\r\n?/g, '\n'); };
async function promptSha(text) {
  const bytes = new TextEncoder().encode(norm(text)), sub = G.crypto && G.crypto.subtle;
  if (!sub) throw new Error('这个浏览器核不了文件内容，请用 Chrome 或 Edge 打开');
  return [...new Uint8Array(await sub.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
/* maps：[{ from: '资产/参考素材映射.json', prompts: {...} }, ...]，先给的先认 */
function refsBySha(maps, key, sha) {
  if (!sha) return null;
  for (const m of maps || []) {
    const v = m && m.prompts && m.prompts[key];
    if (v && String(v.prompt_sha256 || '').toLowerCase() === sha.toLowerCase() && Array.isArray(v.references)) return { refs: v.references, from: m.from || '', ...(v.秒数 ? { secs: v.秒数 } : {}) };
  }
  return null;
}
/* 一个项目的几份参考素材映射：现在那一份在前，历史记录/资产 里留的底从新到旧。
   io.readJson(项目里的路径)、io.list(项目里的文件夹) → [{ name, kind, mtime }]；读不了的跳过 */
async function mapsOf(io) {
  const out = [], take = async rel => { try { const j = await io.readJson(rel); out.push({ from: rel, prompts: (j && j.prompts) || {} }); } catch (e) { /* 没有、坏了 */ } };
  await take('资产/参考素材映射.json');
  let ents = [];
  try { ents = await io.list('历史记录/资产'); } catch (e) { /* 没有 */ }
  const snaps = ents.filter(e => e.kind === 'file' && /^参考素材映射__.+\.json$/i.test(e.name)).map(e => ({ ...parse(e.name), mtime: e.mtime || 0 })).sort(newer);
  for (const x of snaps) await take('历史记录/资产/' + x.name);
  return out;
}
/* 一条视频提示词挂的图（现在用的，或者历史记录里的一版）：{ refs: [{ ref, path, sha }], note }；那一份登记了每一镜几秒的，多一个 secs（审片台跟着播放标镜头用）。
   it：{ seg: '3-1', orig: 原名, file: 项目里的路径, old: 历史记录里的, stamp }；maps：mapsOf 给的；text：这一版的字。
   照这一版自己的登记认：字正好对得上的那一份映射 → 认不出照现在同名那一条的登记（老版本标 note：可能不是那时候挂的）；
   写稿资料（现在的 原名_写稿.json，老版本是同一时间收进去的 原名_写稿__时间.json）里的挂图，同一个编号以它为准 */
async function refsFor(io, maps, it, text) {
  const out = new Map(), key = '提示词/第' + it.seg + '段/' + it.orig, ok = r => r && /^@(图片|视频|音频)[0-9]+$/.test(r.ref);
  const hit = refsBySha(maps, key, await promptSha(text)), now = maps[0] && maps[0].prompts[key];
  const reg = hit ? hit.refs : now && Array.isArray(now.references) ? now.references : [];
  let note = !hit && it.old && reg.length ? '这一版没找到当时的登记，@图片 照现在「' + it.orig + '」的登记认，可能不是那时候挂的' : '';
  for (const r of reg) if (ok(r)) out.set(r.ref, { ref: r.ref, path: AP().fromOld(String(r.path || '')).replace(/\\/g, '/'), sha: r.sha256 || '' });
  const dir = String(it.file).split('/').slice(0, -1).join('/'), side = it.orig.replace(/\.txt$/i, '') + '_写稿' + (it.old && it.stamp ? '__' + it.stamp : '') + '.json';
  if (!it.old || it.stamp) {
    try {
      const pics = ((await io.readJson(dir + '/' + side)) || {}).挂图 || {};
      for (const [ref, p] of Object.entries(pics)) if (ok({ ref })) { const o = out.get(ref), path = AP().fromOld(String(p)).replace(/\\/g, '/'); out.set(ref, { ref, path, sha: o && o.path === path ? o.sha : '' }); }
      if (Object.keys(pics).length) note = '';
    } catch (e) { /* 不是网页上写的稿 */ }
  }
  const secs = hit ? hit.secs : !it.old && now ? now.秒数 : null;   // 老版本没认出当时的登记：秒数不照现在的猜
  return { refs: [...out.values()], note, ...(secs ? { secs } : {}) };
}
/* 一段里每一版出过哪几条样片（2026-11-25 他要的：流水线「历史记录」里也看片、筛已出片；审片台、写稿页「参考」同一套）。
   照名字认是哪一条（公用/样片归属.js 的 carries；认不上的，片子后来做的 kinCarries 也算），再照时间认是哪一版：
   收进历史记录的那一版管到它被收进去的那一刻，之后出的归现在这一版，现在没有了归最后收进去的那一版；
   删提示词时跟着收进去的样片（名字带同一个「__时间」）就是那一版的。
   olds：历史记录/提示词/第N段 里的视频提示词 [{ name, mtime }]；curs：提示词/第N段 里的视频提示词文件名；
   here、hist：成片/第N段、历史记录/成片/第N段 里的文件 [{ name, mtime }]（毫秒；不是视频的跳过）；now(原名)：改过名的现在叫什么（不给照原名）。
   给 { old: Map(历史记录里的文件名 → 样片), cur: Map(现在的文件名 → 样片) }，样片 [{ vid, old, mtime }]：成片里的在前、新的在前 */
const VID = /\.(mp4|m4v|mov|webm)$/i;
function made({ olds = [], curs = [], here = [], hist = [], now = n => n } = {}) {
  const C = CO(), cur = new Set(curs), fams = new Map(), out = { old: new Map(olds.map(x => [x.name, []])), cur: new Map(curs.map(n => [n, []])) };
  const fam = o => fams.get(o) || fams.set(o, { olds: [], cur: '' }).get(o);
  for (const x of olds) { const p = parse(x.name); fam(p.orig).olds.push({ name: x.name, stamp: p.stamp, t: ms(p.stamp) || x.mtime || 0 }); }   // 名字里没带时间的老文件：照它的修改时间
  for (const n of curs) fam(n);
  for (const [o, f] of fams) { const n = now(o); f.cur = cur.has(n) ? n : cur.has(o) ? o : ''; f.olds.sort((a, b) => a.t - b.t); }
  const put = (to, c) => { if (to && !to.some(y => y.vid === c.name && y.old === c.old)) to.push({ vid: c.name, old: c.old, mtime: c.mtime || 0 }); };
  for (const c of [...here.map(x => ({ ...x, old: false })), ...hist.map(x => ({ ...x, old: true }))]) {
    if (!VID.test(c.name)) continue;
    const p = parse(c.name), vid = p.orig, all = [...fams.keys()];   // 跟着删掉的那一版收进去的（1-5__时间.mp4）：照原名认
    let hit = all.filter(o => C.carries(vid, o));
    if (!hit.length) hit = all.filter(o => C.kinCarries(vid, o));
    for (const o of hit) {
      const f = fams.get(o), at = (p.stamp && f.olds.find(x => x.stamp === p.stamp)) || f.olds.find(x => x.t > (c.mtime || 0));
      put(at ? out.old.get(at.name) : f.cur ? out.cur.get(f.cur) : f.olds.length ? out.old.get(f.olds[f.olds.length - 1].name) : null, c);
    }
  }
  const ord = (a, b) => (a.old - b.old) || b.mtime - a.mtime || String(a.vid).localeCompare(String(b.vid), 'zh', { numeric: true });
  for (const m of [out.old, out.cur]) for (const v of m.values()) v.sort(ord);
  return out;
}

/* ---------- 提示词和它出的样片同进同出（2026-11-26 他定：「如果成片在历史记录，那么提示词也应该进历史记录，反之……」） ---------- */
/* 一版提示词收进历史记录时，提示词/第N段 里跟着它走的：写稿资料、批注、AI 批注（再加出片任务书、批注截图，见 promptKin） */
const KIN = Object.freeze([['_写稿.json', '写稿资料'], ['_批注.md', '批注'], ['_AI批注.md', 'AI 批注']]);
const SHOTS = '_批注截图';
/* names：提示词/第N段 里的名字（文件、文件夹都给）。给 [[名字, 叫法]]，有的才给 */
function promptKin(name, names) {
  const s = String(name).replace(/\.txt$/i, ''), have = new Set(names || []);
  return [...KIN.map(([t, lab]) => [s + t, lab]), [CORE().vpTask(name), '出片任务书'], [s + SHOTS, '批注截图']].filter(([n]) => n !== name && have.has(n));
}
/* 收进历史记录叫什么：视频提示词_02.txt → 视频提示词_02__时间.txt；批注截图这种文件夹，时间接在最后 */
const dated = (n, stamp) => { const d = n.lastIndexOf('.'); return d > 0 && !n.endsWith(SHOTS) ? n.slice(0, d) + '__' + stamp + n.slice(d) : n + '__' + stamp; };
const two = n => String(n).padStart(2, '0');
const stampOf = (d = new Date()) => d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());   // 本机时间：20261126-153000
/* 一段里对不上的。只认名字，和「出过片」同一套（公用/样片归属.js 的 carries；片子后来做的 kinCarries 也算；改过名的连以前的名字）：
     a：提示词还在用，它出的片（连后期补、混剪）全在历史记录里 → [{ name, clips }]
     b：片还在成片，出它的那一版提示词只在历史记录里 → [{ vid, from: 历史记录里那几份 }]
   同一版还有片在成片（另一条、后期补的）不算对不上。历史记录里带「__时间」的片是删掉的那一版的，不算。
   老名字的样片（第N条，照记号认，认不准）不管：有老名字的片认它的提示词也不管。
   curs：提示词/第N段 的名字；olds：历史记录/提示词/第N段 的；here、hist：成片/第N段、历史记录/成片/第N段 的；rn：这一场的「改名」 */
function pairs({ curs = [], olds = [], here = [], hist = [], rn = null } = {}) {
  const C = CO(), K = CORE(), cur = curs.filter(n => K.RE_VP.test(n)), has = new Set(cur);
  const was = n => [n, ...(rn && typeof rn === 'object' ? K.vpWas(rn, n, x => has.has(x)) : [])];
  const of = (v, n) => was(n).some(m => C.carries(v, m) || C.kinCarries(v, m));
  const vids = (list, old) => list.filter(v => VID.test(v) && !(old && parse(v).stamp));
  const now = vids(here, false), gone = vids(hist, true), legacy = v => K.clipOld(v);
  const a = [], b = [];
  for (const n of cur) {
    if ([...now, ...gone].some(v => legacy(v) && was(n).some(m => C.carries(v, m)))) continue;
    const back = gone.filter(v => of(v, n));
    if (back.length && !now.some(v => of(v, n))) a.push({ name: n, clips: back });
  }
  const ps = olds.map(n => ({ n, o: parse(n).orig })).filter(x => K.RE_VP.test(x.o));
  for (const v of now) {
    if (legacy(v) || cur.some(n => of(v, n))) continue;
    const from = ps.filter(x => of(v, x.o)).map(x => x.n);
    if (from.length) b.push({ vid: v, from });
  }
  return { a, b };
}
const Hist = Object.freeze({ parse, when, ms, newer, promptSha, refsBySha, mapsOf, refsFor, made, KIN, promptKin, dated, stampOf, pairs });
if (typeof module !== 'undefined' && module.exports) module.exports = Hist;
G.Hist = Hist;
})(typeof globalThis !== 'undefined' ? globalThis : this);
