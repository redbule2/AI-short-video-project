/* ============================================================
   写稿页 · 参考（window.WriteRef）：边写边看别的视频提示词（2026-11-19 他要的：哪个项目的都行，现在用的、历史记录里的都能挑；主要给人写稿用）。
   顶上「参考」→ 挑一条：左边挑范围（这一段、这个项目、全部项目、别的哪个项目；全部版本、现在用的、历史记录），
     中间一行一条（同一条的几版并成一行，底下一句说它拍什么），右边看它挂的素材、全文，出过样片的能放出来看。
     按字找（项目名、段、名字、正文，几个词空格隔开）。↑↓ 换一行，回车摆上，Esc 关。窄的时候范围摆成一排在上面。
   摆好以后（顶上的「参考」藏起来：换一条、拿掉都在参考自己的标题栏上，要按的只放一处）：
     宽的时候摆在稿子右边、窄的时候摆在下面（标题栏上换边；中间那条能拖宽窄）；「收起」只留标题栏。
     摆在稿子旁边那一格（公用/写稿旁窗.js），和看图共用：点开看图，图先盖在参考上，收起图参考回来。
     头一排是它挂的素材（图出小图，视频、声音点了放）；字里的 @图片N 停上去出小图、点开看大图（照那一条自己的登记，认法在 公用/历史记录.js）。
     「跟着写」：光标到哪一块（生成目标、素材、基础设定、事件脚本……），参考就滚到它那一块、第几镜，那一块标「正在写这一块」。
     每一段停上去浮出「插入」（放到稿子里光标停的地方，Ctrl+Z 撤得回）、「复制」；选中参考里的几个字，浮出同样两个钮。
       参考里的 @图片N 是那一条自己挂的图，带过来就挂错了：放进来、复制出去都换成〔图名〕，要挂图在稿子里输入 @ 自己挑。
     几版的，标题栏上换着看；出过样片的，「样片」放出来看。
   字一个不改，只上色：镜头N 标出来，找的字标黄。
   记在这台电脑的浏览器里：这份稿参考的是哪一条（下回打开接着摆）、最近参考过的几条、挑的范围、摆在哪、多宽、跟不跟着写。
   只读别人的稿子，不改。各项目的提示词由本机服务列（/api/prompts，.agents\skills\annotate-live\prompt-lib.js）。
   要先引 公用/核心.js、底座.js、界面.js、点图.js、找旧版.js、历史记录.js、写稿旁窗.js；样式在 公用/写稿参考.css（摆在旁边那一格、标题栏在 写稿旁窗.css）。
   ============================================================ */
(function () {
'use strict';
const { h, toast } = window.UI, { LINK, FS, at } = window.Base, Core = window.Core;
const IMG = /\.(png|jpe?g|webp|gif|avif|bmp)$/i, REF = /@(图片|视频|音频)\s*([0-9]+)/g, SHOT = /^\s*镜头\s*[0-9０-９]+/, SHOT_NO = /^\s*镜头\s*[0-9０-９]+[a-zA-Z]?/;
const KEY = { recent: 'antou:write:ref-recent', dock: 'antou:write:ref-dock', hint: 'antou:write:ref-hint', scope: 'antou:write:ref-scope', mine: 'antou:write:ref:' };
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 记不下就算了 */ } };
const mineKey = () => KEY.mine + (typeof OPENPATH === 'string' && OPENPATH ? OPENPATH : decodeURIComponent(location.hash));
const idOf = it => it.p + '/' + it.file;
const stemOf = p => String(p).split('/').pop().replace(/\.[^.]+$/, '');
const R = { cur: null, text: '', refs: [], doc: null, note: '', err: '', fold: false, maps: new Map(), target: null, dock: null, sel: null, menu: null, list: null, scroll: 0, fresh: false };
const D = Object.assign({ mode: 'auto', side: 0.42, bottom: 0.42, follow: true }, lsGet(KEY.dock, {}));   // 摆在哪（auto 照宽窄定）、占多宽多高、跟不跟着写
const saveDock = () => lsSet(KEY.dock, { mode: D.mode, side: D.side, bottom: D.bottom, follow: D.follow });

/* ---------- 小东西：图标、项目的颜色点、时间 ---------- */
const PATHS = Object.assign({}, UI.ICON || {}, {   // 换边的 dockR、dockB 在 公用/界面.js
  fold: '<path d="M4.2 6.4 8 10.2l3.8-3.8"/>',
  unfold: '<path d="M4.2 9.6 8 5.8l3.8 3.8"/>',
  insert: '<path d="M12.6 3.4v4.4a2 2 0 0 1-2 2H3.8"/><path d="M6.4 6.9 3.8 9.8l2.6 2.8"/>',
});
function icon(n) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'rf-ic'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = PATHS[n] || '';
  return s;
}
const HUES = ['#2f6d8a', '#b0603a', '#5b7d3a', '#8a4f7d', '#3d5a99', '#9a7b2c', '#3f7f78', '#a04a4a'];
let PCOL = null;
function colorOf(p) {   // 一个项目一个颜色：照项目名排好顺序分，一页里不撞色
  if (!PCOL && R.list) { PCOL = new Map(); [...new Set(R.list.map(x => x.p))].sort((a, b) => a.localeCompare(b, 'zh')).forEach((x, i) => PCOL.set(x, HUES[i % HUES.length])); }
  if (PCOL && PCOL.has(p)) return PCOL.get(p);
  let n = 0;
  for (const c of String(p)) n = (n * 31 + c.codePointAt(0)) >>> 0;
  return HUES[n % HUES.length];
}
const dot = p => h('i', { class: 'rf-dot', style: 'background:' + colorOf(p), title: p });
const pad = n => String(n).padStart(2, '0');
function ago(t) {   // 今天 14:30 / 昨天 09:12 / 11-17
  const d = new Date(t), now = new Date(), d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= d0) return '今天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  if (t >= d0 - 864e5) return '昨天 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  return (d.getMonth() + 1) + '-' + d.getDate();
}
const keepFocus = ev => ev.preventDefault();   // 点参考里的钮，稿子里的光标别跑
const mini = (label, title, fn, ink) => h('button', { class: 'rf-mini' + (ink ? ' ink' : ''), type: 'button', title, onmousedown: keepFocus, onclick: fn }, label);
const ib = (name, title, fn, cls) => h('button', { class: 'rf-ib' + (cls ? ' ' + cls : ''), type: 'button', title, 'aria-label': title, onmousedown: keepFocus, onclick: fn }, icon(name));
function hwheel(el) {   // 横着排的一行：鼠标滚轮往下滚就是往右挪
  el.addEventListener('wheel', ev => {
    if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX) || el.scrollWidth <= el.clientWidth + 1) return;
    ev.preventDefault(); el.scrollLeft += ev.deltaY;
  }, { passive: false });
  return el;
}
function edges(el) {   // 左右还有没露出来的：那一头淡出去
  el.classList.toggle('fl', el.scrollLeft > 2);
  el.classList.toggle('fr', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
}

/* ---------- 读 ---------- */
const textOf = async it => Core.decodeText((await FS.read(at([it.p, ...it.file.split('/')]))).buf).text;
const ioOf = p => ({ readJson: async rel => JSON.parse(Core.decodeText((await FS.read(at([p, ...rel.split('/')]))).buf).text), list: rel => FS.list(at([p, ...rel.split('/')])) });
async function refsOf(it, text) {   // 那一条自己挂的图：照那个项目的登记（现在的、留的底），写稿资料里的挂图为准
  if (!window.Hist) return { refs: [], note: '' };
  if (!R.maps.has(it.p)) R.maps.set(it.p, await Hist.mapsOf(ioOf(it.p)));
  return Hist.refsFor(ioOf(it.p), R.maps.get(it.p), { seg: it.seg, orig: it.orig, file: it.file, old: it.old, stamp: Hist.parse(it.name).stamp }, text);
}
async function fetchList(q) {
  let r;
  try { r = await LINK.req('GET', '/api/prompts' + (q ? '?q=' + encodeURIComponent(q) : '')); }
  catch (e) { throw new Error(/没有这个/.test(e.message) ? '本机服务是旧版，还不会列提示词：重开一下本机服务' : e.message); }
  return (await r.json()).list || [];
}
const whenOf = it => it.old ? (it.when ? it.when + ' 收进历史记录' : '历史记录') : (() => { const d = new Date(it.t); return (d.getMonth() + 1) + '-' + d.getDate() + ' 改过'; })();
const placeOf = it => it.p + ' · 第' + it.seg + '段';
const termsOf = q => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);

/* ---------- 它挂的素材：图出小图，视频、声音点了放 ---------- */
const LOC = new Map();
function locOf(p, r) {   // 登记的那一份在哪：原处换了、挪进历史记录的，照 公用/找旧版.js 找
  const k = p + '|' + r.path + '|' + (r.sha || '');
  if (!LOC.has(k)) {
    const parts = at([p, ...String(r.path).split('/')]);
    const pr = window.RefFile ? RefFile.locate(FS, at([p]), r.path, r.sha) : FS.stat(parts).then(s => s ? { parts, file: r.path } : null);
    pr.catch(() => { if (LOC.get(k) === pr) LOC.delete(k); });
    LOC.set(k, pr);
  }
  return LOC.get(k);
}
const thumbFor = (p, r, w) => locOf(p, r).then(l => { if (!l) throw new Error('找不到了'); return UI.thumbOf(l.parts, w || 240); });
const kindOf = r => (/^@(图片|视频|音频)/.exec(r.ref) || [])[1] || '';
const ORDER = ['图片', '视频', '音频'];
const refRank = r => ORDER.indexOf(kindOf(r)) * 1000 + (+(/([0-9]+)$/.exec(r.ref) || [])[1] || 0);
function showPic(p, r) {
  const label = r.ref + ' · ' + stemOf(r.path), type = f => 'image/' + (/\.jpe?g$/i.test(f) ? 'jpeg' : f.split('.').pop().toLowerCase());
  RefPic.show((async () => {
    const g = window.RefFile ? await RefFile.find(FS, at([p]), r.path, r.sha) : { bytes: (await FS.read(at([p, ...r.path.split('/')]))).buf, file: r.path };
    return URL.createObjectURL(new Blob([g.bytes], { type: type(g.file) }));
  })(), label, p + ' · ' + r.path);
}
async function openRef(p, r) {
  const k = kindOf(r);
  if (k === '图片') { showPic(p, r); return; }
  let l = null;
  try { l = await locOf(p, r); } catch (e) { /* 下面报 */ }
  if (!l) { toast('打不开：文件找不到了（' + r.path + '）', 'err'); return; }
  playFile(l.parts, p + ' · ' + r.ref + ' · ' + stemOf(r.path), k === '音频');
}
function tile(p, r) {
  const k = kindOf(r), name = r.path ? stemOf(r.path) : '没登记是哪个文件';
  const el = h('button', { class: 'rf-as ' + ({ 图片: 'pic', 视频: 'vid', 音频: 'aud' })[k], type: 'button', title: r.ref + ' · ' + (r.path || '没登记') + (k === '图片' ? '\n点开看大图' : '\n点了放出来'), onmousedown: keepFocus, onclick: () => openRef(p, r) },
    h('span', { class: 'rf-as-img' }, k === '图片' ? null : icon(k === '视频' ? 'play' : 'sound')),
    h('span', { class: 'rf-as-n' }, h('b', null, r.ref.slice(1)), h('span', null, name)));
  if (k === '图片' && IMG.test(r.path || '')) UI.whenSeen(el, () => thumbFor(p, r).then(u => el.firstChild.append(h('img', { src: u, alt: '', draggable: 'false' }))).catch(() => el.classList.add('miss')));
  return el;
}
function assetsView(p, refs) {
  const list = (refs || []).filter(r => r && kindOf(r)).sort((a, b) => refRank(a) - refRank(b));
  if (!list.length) return null;
  const row = hwheel(h('div', { class: 'rf-as-row' }, list.map(r => tile(p, r))));
  return h('div', { class: 'rf-assets', 'data-no-ref': '' }, h('div', { class: 'rf-assets-h' }, h('b', null, '这一条挂的素材'), h('small', null, list.length + ' 样，点开看')), row);
}

/* ---------- 一条提示词照分区摆出来（挑的时候右边看、摆在旁边都用这一个） ---------- */
const NAME = { pre: '开头', all: '全文', goal: '生成目标', event: '本段事件', refs: '素材', cast: '人物', props: '道具', scene: '场景', avs: '动作与声音', unused: '未采用素材', basic: '基础设定', rel: '主体与关系', seg: '本段', script: '事件脚本', shots: '分镜', keep: '保持一致', sound: '声音', rules: '规则' };
function secName(s) {
  const t = s.head ? String(s.head).trim().replace(/^[一二三四五六七八九十]+[、.．]\s*/, '').replace(/^【(.+?)】.*$/, '$1').replace(/[：:].*$/, '').trim() : '';
  return t && t.length <= 12 ? t : NAME[s.key] || s.key;
}
/* 分区：[{ key, name, lines: [{ text, shot: 第几镜（从 0 数）, head, sub }] }]；认不出分区的整份当一块 */
function sectionsOf(text) {
  const doc = Core.parsePrompt(text), out = [];
  const pre = doc.pre.map(b => b.text).filter(t => t.trim());
  if (pre.length) out.push({ key: 'pre', name: NAME.pre, lines: pre.map(t => ({ text: t })) });
  for (const s of doc.sections) {
    const lines = [];
    let k = 0;
    for (const b of s.blocks) if (b.text.trim()) lines.push({ text: b.text, shot: SHOT.test(b.text) ? k++ : null });
    for (const sh of s.shots || []) { lines.push({ text: sh.head, shot: k++, head: true }); for (const b of sh.blocks) if (b.text.trim()) lines.push({ text: b.text, sub: true }); }
    out.push({ key: s.key, name: secName(s), lines });
  }
  if (!doc.sections.length && !pre.length) out.push({ key: 'all', name: NAME.all, lines: text.split(/\r?\n/).filter(t => t.trim()).map(t => ({ text: t })) });
  return out;
}
/* 找的字标出来 */
function marked(text, terms) {
  if (!terms || !terms.length) return [text];
  const low = text.toLowerCase(), out = [];
  let i = 0;
  while (i < text.length) {
    let k = -1, len = 0;
    for (const w of terms) { const j = low.indexOf(w, i); if (j >= 0 && (k < 0 || j < k)) { k = j; len = w.length; } }
    if (k < 0) { out.push(text.slice(i)); break; }
    if (k > i) out.push(text.slice(i, k));
    out.push(h('mark', null, text.slice(k, k + len)));
    i = k + len;
  }
  return out;
}
function lineText(text, terms) {   // 字一个不改，开头的「镜头N」上个色
  const m = SHOT_NO.exec(text);
  return m ? [h('span', { class: 'rf-no' }, marked(m[0], terms)), ...marked(text.slice(m[0].length), terms)] : marked(text, terms);
}
function docView(secs, { terms, acts } = {}) {
  return secs.map(s => {
    const all = () => s.lines.map(l => l.text).join('\n'), shots = s.lines.filter(l => l.shot != null).length;
    return h('section', { class: 'rf-sec', 'data-key': s.key },
      h('div', { class: 'rf-sec-h' }, h('b', null, s.name), shots > 1 ? h('small', { class: 'rf-sec-n' }, shots + ' 镜') : null,
        acts ? h('span', { class: 'rf-here' }, '正在写这一块') : null, h('span', { class: 'sp' }),
        acts ? h('span', { class: 'rf-sec-acts' }, mini('整块插入', '这一块整块放到稿子里光标停的地方', () => insert(all())), mini('整块复制', '这一块整块复制', () => copy(all()))) : null),
      s.lines.map(l => h('div', { class: 'rf-line' + (l.head ? ' head' : '') + (l.sub ? ' sub' : ''), 'data-shot': l.shot == null ? null : String(l.shot) },
        h('span', { class: 'rf-tx' }, lineText(l.text, terms)),
        acts ? h('span', { class: 'rf-acts' }, mini([icon('insert'), '插入'], '放到稿子里光标停的地方（Ctrl+Z 撤得回）', () => insert(l.text), true), mini([icon('copy'), '复制'], '复制这一段', () => copy(l.text))) : null)));
  });
}

/* ---------- 往稿子里放：记着最后在哪写（文字框、AI 那几行、镜头标题） ---------- */
const editable = el => !!el && !!el.closest && !!el.closest('#sheet') && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search)$/.test(el.type)) || el.isContentEditable);
function remember() {
  const a = document.activeElement;
  if (!editable(a)) return false;
  if (a.isContentEditable) { const s = getSelection(); R.target = { el: a, range: s.rangeCount && a.contains(s.anchorNode) ? s.getRangeAt(0).cloneRange() : (R.target && R.target.el === a ? R.target.range : null) }; }
  else R.target = { el: a };
  return true;
}
document.addEventListener('selectionchange', () => { if (remember()) follow(R.target.el); });
document.addEventListener('focusin', e => { if (editable(e.target) && remember()) follow(e.target); });
/* 参考里的 @图片N 是那一条自己的编号，带到这份稿里就挂错了：换成〔图名〕 */
function forHere(text) {
  let n = 0;
  const out = String(text).replace(REF, (m, kind, num) => {
    n++;
    const r = (R.refs || []).find(x => x.ref === '@' + kind + num);
    return '〔' + (r && r.path ? stemOf(r.path) : kind + num) + '〕';
  });
  return { text: out, n };
}
function insert(raw) {
  const t = R.target;
  if (!t || !t.el.isConnected) { toast('先在稿子里点一下要放的地方，再点「插入」', 'err'); return; }
  const el = t.el, f = forHere(raw), put = el.tagName === 'TEXTAREA' ? f.text : f.text.replace(/\s*\n+\s*/g, ' ');   // 文字框以外的都是一行：换行变成空格
  el.focus();
  if (el.isContentEditable && t.range) { const s = getSelection(); s.removeAllRanges(); s.addRange(t.range); }
  if (!document.execCommand('insertText', false, put) && !el.isContentEditable) {
    el.setRangeText(put, el.selectionStart, el.selectionEnd, 'end'); el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  remember();
  lsSet(KEY.hint, 1);
  const tip = R.dock && R.dock.querySelector('.rf-tip');
  if (tip) tip.remove();
  toast(f.n ? '放进去了。参考里的 @图片 换成了〔图名〕：这份稿要挂图，输入 @ 自己挑' : '放进稿子里了（Ctrl+Z 撤得回）');
}
async function copy(raw) {
  const f = forHere(raw);
  try { await navigator.clipboard.writeText(f.text); toast(f.n ? '复制好了（@图片 换成了〔图名〕）' : '复制好了'); }
  catch (e) { toast('复制不了：' + e.message, 'err'); }
}

/* ---------- 跟着写：光标到哪一块，参考滚到它那一块、第几镜 ---------- */
const FOLLOW = { event: ['goal', 'event'], refs: ['refs', 'cast', 'props', 'scene', 'avs', 'unused'], basic: ['basic'], seg: ['rel', 'seg'], keep: ['keep'], shots: ['script', 'shots'] };
function shotInFree(ta) {   // 自由写的那一大框：光标所在这一行往上数，第几个「镜头N」
  const v = ta.value, e = v.indexOf('\n', ta.selectionStart);
  return v.slice(0, e < 0 ? v.length : e).split('\n').filter(l => SHOT.test(l)).length - 1;
}
function follow(el) {
  if (!D.follow || !R.dock || R.fold || !el || !el.closest) return;
  const sec = el.closest('section[data-sec]'), keys = sec ? FOLLOW[sec.dataset.sec] : null, body = R.dock.querySelector('.rf-body');
  if (!keys || !body) return;
  const box = keys.map(k => body.querySelector('.rf-sec[data-key="' + k + '"]')).find(Boolean);
  if (!box) return;
  let to = box, i = -1;
  const shot = el.closest('.p-shot');
  if (shot) i = [...document.querySelectorAll('#sheet .p-shot')].indexOf(shot);
  else if (el.tagName === 'TEXTAREA' && el.id === 'freeText') i = shotInFree(el);
  if (i >= 0) to = box.querySelector('.rf-line[data-shot="' + i + '"]') || box;
  if (to === box ? box.classList.contains('rf-on') && !box.querySelector('.rf-now') : to.classList.contains('rf-now')) return;
  for (const x of body.querySelectorAll('.rf-now, .rf-on')) x.classList.remove('rf-now', 'rf-on');
  box.classList.add('rf-on');
  if (to !== box) to.classList.add('rf-now');
  body.scrollTo({ top: Math.max(0, to.offsetTop - (to === box ? 0 : 46)), behavior: 'smooth' });
  paintTabs(box.dataset.key);
}
function paintTabs(key) {
  if (!R.dock) return;
  const nav = R.dock.querySelector('.rf-nav');
  for (const b of R.dock.querySelectorAll('.rf-tab')) {
    const on = b.dataset.key === key;
    b.classList.toggle('on', on);
    if (on && nav) { const l = b.offsetLeft, r = l + b.offsetWidth; if (l < nav.scrollLeft + 20 || r > nav.scrollLeft + nav.clientWidth - 20) nav.scrollTo({ left: Math.max(0, l - 28), behavior: 'smooth' }); }
  }
}
let SPY = 0;
function spy(body) {   // 自己滚参考：顶上那排跟着亮到滚到的那一块
  cancelAnimationFrame(SPY);
  SPY = requestAnimationFrame(() => {
    if (!body.isConnected) return;
    let key = null;
    for (const s of body.querySelectorAll('.rf-sec')) { if (s.offsetTop - 12 <= body.scrollTop) key = s.dataset.key; else break; }
    if (!key) { const f = body.querySelector('.rf-sec'); key = f && f.dataset.key; }
    if (key) paintTabs(key);
  });
}
function jump(key) {
  const body = R.dock && R.dock.querySelector('.rf-body'), box = body && body.querySelector('.rf-sec[data-key="' + key + '"]');
  if (box) { body.scrollTo({ top: box.offsetTop, behavior: 'smooth' }); paintTabs(key); }
}

/* ---------- 摆在旁边：那一格（左右、上下、拖宽窄、换边）在 公用/写稿旁窗.js，和看图共用 ---------- */
const DOCK = { st: D, save: saveDock, fold: () => R.fold,
  onLayout: m => { if (R.dock) R.dock.classList.toggle('short', m === 'bottom' && !R.fold && R.dock.clientHeight < 360); } };   // 矮：素材缩小，多露几行字
function paintBtn() {   // 摆着的时候换一条、拿掉都在参考的标题栏上：顶上这个先藏起来（看图盖着也算摆着）
  const btn = document.getElementById('refBtn');
  if (btn) btn.classList.toggle('rf-hide', !!R.dock);
}
const verName = v => v.old ? (v.when || v.name) + ' 的版本' : '现在用的';
const verShort = v => v.old ? (v.when ? v.when.split(' ')[0] : '老') + ' 的版本' : '现在用的';   // 标题栏上挤：只写哪天
function versionsOf(it) {   // 摆着的这一条一共几版（现在用的在前，历史记录里的新的在前）
  if (!R.list) return [];
  const f = families(R.list.filter(x => famOf(x) === famOf(it)))[0], vs = f ? versOf(f, '全部') : [];
  return vs.some(v => idOf(v) === idOf(it)) ? vs : [];
}
function dockHead(it) {
  const clips = it.clips || [], vs = versionsOf(it);
  return h('div', { class: 'rf-head' },
    h('div', { class: 'rf-id', title: it.p + ' / ' + it.file },
      h('span', { class: 'rf-badge' }, '参考'),
      h('div', { class: 'rf-title' }, h('b', null, it.label || stemOf(it.orig)), h('small', null, dot(it.p), h('span', null, placeOf(it))))),
    R.fold ? null : h('div', { class: 'rf-tools' },
      vs.length > 1
        ? h('button', { class: 'rf-chip ver' + (it.old ? ' old' : ''), type: 'button', title: '看的是' + verName(it) + '。这一条有 ' + vs.length + ' 版：换着看看以前怎么写的', onmousedown: keepFocus, onclick: ev => verMenu(ev.currentTarget, it, vs) }, icon('clock'), h('span', null, verShort(it)), icon('fold'))
        : it.old ? h('span', { class: 'rf-chip ver old still', title: '看的是' + verName(it) }, icon('clock'), h('span', null, verShort(it))) : null,
      clips.length ? h('button', { class: 'rf-chip clip', type: 'button', title: '它出过的样片：' + clips.map(c => stemOf(c.file)).join('、'), onmousedown: keepFocus, onclick: ev => clips.length === 1 ? play(it, clips[0]) : clipMenu(ev.currentTarget, it) }, icon('play'), '样片 ' + clips.length) : null,
      h('label', { class: 'rf-switch', title: '光标到哪一块，参考就滚到它那一块、第几镜' },
        h('input', { type: 'checkbox', checked: !!D.follow, onchange: ev => { D.follow = ev.target.checked; saveDock(); if (D.follow && R.target) follow(R.target.el); } }), h('i'), '跟着写'),
      SideDock.swapBtn('ref', D)),
    h('div', { class: 'rf-win' },
      h('button', { class: 'rf-mini', type: 'button', title: '挑别的一条参考', onclick: () => pick() }, '换一条'),
      ib(R.fold ? 'unfold' : 'fold', R.fold ? '展开' : '收起，只留标题栏', () => { R.fold = !R.fold; paintDock(); }),
      ib('x', '拿掉参考', () => closeDock(true), 'x')));
}
const tip = () => h('div', { class: 'rf-tip' }, icon('insert'),
  h('span', null, '鼠标停在一段上，点「插入」放到稿子里光标停的地方，选中几个字也行。光标挪到哪一块，这边跟到哪一块。'),
  ib('x', '知道了', ev => { lsSet(KEY.hint, 1); ev.currentTarget.parentElement.remove(); }));
function paintDock() {
  if (!R.cur || !SideDock.ready()) return;
  const it = R.cur, secs = R.doc || [], old = R.dock && R.dock.querySelector('.rf-body');
  if (old && old.dataset.id === idOf(it)) R.scroll = old.scrollTop;
  const nav = secs.length > 1 ? hwheel(h('div', { class: 'rf-nav', role: 'tablist' }, secs.map(s => h('button', { class: 'rf-tab', type: 'button', role: 'tab', 'data-key': s.key, onmousedown: keepFocus, onclick: () => jump(s.key) }, s.name)))) : null;
  if (nav) { nav.addEventListener('scroll', () => edges(nav), { passive: true }); new ResizeObserver(() => edges(nav)).observe(nav); }
  const body = h('div', { class: 'rf-body', 'data-ref-p': it.p, 'data-id': idOf(it) },
    R.err ? h('p', { class: 'rf-note bad' }, R.err) : [
      lsGet(KEY.hint, 0) ? null : tip(),
      R.note ? h('p', { class: 'rf-note' }, R.note) : null,
      assetsView(it.p, R.refs),
      docView(secs, { acts: true })]);
  body.addEventListener('mouseup', () => setTimeout(selBar, 0));
  body.addEventListener('scroll', () => { hideSel(); hidePeek(); spy(body); }, { passive: true });
  const el = h('aside', { class: 'rf-dock' + (R.fresh ? ' rf-enter' : ''), id: 'rf-dock', 'aria-label': '参考的提示词' }, dockHead(it), R.fold ? null : [nav, body]);
  R.fresh = false;
  R.dock = el;
  SideDock.put('ref', el, DOCK);   // 原来摆着的换掉（看图盖着的，还在看图底下）
  paintBtn();
  if (!R.fold) {
    if (R.scroll) body.scrollTop = R.scroll;
    requestAnimationFrame(() => { if (nav) edges(nav); spy(body); const on = body.querySelector('.rf-on'); if (on) paintTabs(on.dataset.key); });
  }
}
async function openDock(it, quiet) {
  if (!R.cur || idOf(R.cur) !== idOf(it)) R.scroll = 0;
  if (!R.dock) R.fresh = true;
  Object.assign(R, { cur: it, err: '', note: '', doc: null, refs: [], text: '' });
  try {
    R.text = await textOf(it);
    R.doc = sectionsOf(R.text);
    try { const r = await refsOf(it, R.text); R.refs = r.refs; R.note = r.note; } catch (e) { /* 认不出图：字照样能看 */ }
  } catch (e) { R.err = /没有这个文件/.test(e.message) ? '这一条不在原处了（可能挪走或删了）。点「换一条」重新挑。' : '读不了：' + e.message; }
  if (R.cur !== it) return;
  const { hit, ...keep } = it;
  lsSet(mineKey(), keep);
  lsSet(KEY.recent, [keep, ...lsGet(KEY.recent, []).filter(x => idOf(x) !== idOf(it))].slice(0, 8));
  paintDock();
  if (!quiet) SideDock.raise('ref');   // 自己挑的这一条：看图盖着也翻到上面来
  if (!quiet && R.target) follow(R.target.el);
  if (!R.list) fetchList('').then(l => {   // 打开写稿页接着摆的：补上这一条有几版、样片换没换
    R.list = l; PCOL = null;
    const fresh = l.find(x => idOf(x) === idOf(it));
    if (fresh) Object.assign(it, fresh);
    const hd = R.cur === it && R.dock && R.dock.querySelector('.rf-head');
    if (hd) hd.replaceWith(dockHead(it));
  }).catch(() => { /* 列不出来：就不给换版本 */ });
}
function closeDock(forget) {
  hideSel(); closeMenu(); hidePeek();
  SideDock.drop('ref');
  R.dock = null; R.cur = null;
  paintBtn();
  if (forget) lsSet(mineKey(), null);
}

/* ---------- 选中参考里的字：浮出「插入到光标处」「复制」 ---------- */
function hideSel() { if (R.sel) { R.sel.remove(); R.sel = null; } }
function selBar() {
  hideSel();
  const s = getSelection(), body = R.dock && R.dock.querySelector('.rf-body');
  if (!s || s.isCollapsed || !s.rangeCount || !body || !body.contains(s.anchorNode)) return;
  const text = s.toString().trim();
  if (!text) return;
  const r = s.getRangeAt(0).getBoundingClientRect();
  R.sel = h('div', { class: 'rf-selbar', style: 'left:' + Math.max(8, Math.min(innerWidth - 220, r.left)) + 'px;top:' + (r.top > 52 ? r.top - 42 : r.bottom + 8) + 'px' },
    mini([icon('insert'), '插入到光标处'], '放到稿子里光标停的地方', () => { hideSel(); insert(text); }, true), mini([icon('copy'), '复制'], '复制选中的字', () => { hideSel(); copy(text); }));
  document.body.append(R.sel);
}
document.addEventListener('mousedown', e => { if (R.sel && !R.sel.contains(e.target)) hideSel(); }, true);

/* ---------- 字里的 @图片N：停上去出小图 ---------- */
let PEEK = null, PEEK_T = 0;
function hidePeek() { clearTimeout(PEEK_T); if (PEEK) { PEEK.remove(); PEEK = null; } }
function peekRef(a) {   // 这处 @图片N 是哪一条的哪张图
  const box = a.closest('.rf-body, .rf-prev-b');
  if (!box) return null;
  const refs = box.classList.contains('rf-prev-b') ? (PICK && PICK.refs) || [] : R.refs, r = refs.find(x => x.ref === a.dataset.ref);
  return r && IMG.test(r.path || '') ? { p: box.dataset.refP, r } : null;
}
document.addEventListener('mouseover', e => {
  const a = e.target && e.target.closest ? e.target.closest('.rl') : null;
  if (!a || (PEEK && PEEK.anchor === a)) return;
  const g = peekRef(a);
  if (!g) return;
  a.removeAttribute('title');   // 自己出小图，浏览器那个灰条就不要了
  clearTimeout(PEEK_T);
  PEEK_T = setTimeout(() => {
    if (!a.isConnected) return;
    hidePeek();
    const im = h('div', { class: 'im' });
    PEEK = h('div', { class: 'rf-peek', 'data-no-ref': '' }, im, h('p', null, h('b', null, g.r.ref), ' · ' + stemOf(g.r.path), h('small', null, '点一下看大图')));
    PEEK.anchor = a;
    document.body.append(PEEK);
    const put = () => {
      if (!PEEK || !a.isConnected) return;
      const r = a.getBoundingClientRect(), w = PEEK.offsetWidth, hh = PEEK.offsetHeight;
      PEEK.style.left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
      PEEK.style.top = (r.top - hh - 8 >= 8 ? r.top - hh - 8 : Math.min(r.bottom + 8, innerHeight - hh - 8)) + 'px';
    };
    put();
    thumbFor(g.p, g.r, 360).then(u => { if (PEEK && PEEK.anchor === a) { const img = h('img', { src: u, alt: '' }); img.addEventListener('load', put); im.append(img); } })
      .catch(() => { if (PEEK && PEEK.anchor === a) { im.append(h('span', null, '小图出不来，点开试试')); put(); } });
  }, 160);
});
document.addEventListener('mouseout', e => {
  const a = e.target && e.target.closest ? e.target.closest('.rl') : null;
  if (a && !a.contains(e.relatedTarget)) hidePeek();
});
document.addEventListener('mousedown', hidePeek, true);

/* ---------- 小菜单：几版、样片 ---------- */
function popMenu(anchor, rows) {
  const same = R.menu && R.menu.anchor === anchor;
  closeMenu();
  if (same) return;
  const r = anchor.getBoundingClientRect(), m = h('div', { class: 'rf-menu', role: 'menu' }, rows);
  document.body.append(m);
  const w = m.offsetWidth, hh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  m.style.top = (r.bottom + 4 + hh <= innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - hh)) + 'px';
  m.anchor = anchor; R.menu = m;
  setTimeout(() => document.addEventListener('mousedown', menuOut, true), 0);
}
function menuOut(e) { if (R.menu && !R.menu.contains(e.target) && !R.menu.anchor.contains(e.target)) closeMenu(); }
function closeMenu() { if (R.menu) { R.menu.remove(); R.menu = null; } document.removeEventListener('mousedown', menuOut, true); }
function verMenu(anchor, it, vs) {
  popMenu(anchor, [h('div', { class: 'rf-menu-h' }, '这一条的 ' + vs.length + ' 版'), ...vs.map(v => {
    const on = idOf(v) === idOf(it), n = (v.clips || []).length;
    return h('button', { type: 'button', role: 'menuitem', class: on ? 'on' : '', title: v.file, onclick: () => { closeMenu(); if (!on) openDock(v); } },
      h('span', { class: 'ck' }, on ? icon('check') : null), h('span', { class: 'tx' }, verName(v)),
      h('small', null, [n ? '样片 ' + n : '', v.old ? '历史记录' : ''].filter(Boolean).join(' · ')));
  })]);
}
function clipMenu(anchor, it) {
  popMenu(anchor, [h('div', { class: 'rf-menu-h' }, '它出过的样片'), ...(it.clips || []).map(c => h('button', { type: 'button', role: 'menuitem', onclick: () => { closeMenu(); play(it, c); } },
    h('span', { class: 'ck' }, icon('play')), h('span', { class: 'tx' }, stemOf(c.file)), c.old ? h('small', null, '历史记录') : null))]);
}

/* ---------- 放视频、声音（样片、挂的视频声音） ---------- */
async function playFile(parts, title, audio) {
  let url;
  try { url = URL.createObjectURL(await FS.file(parts)); } catch (e) { toast('打不开：' + e.message, 'err'); return; }
  const v = h(audio ? 'audio' : 'video', { src: url, controls: true, autoplay: true, playsinline: true });
  const box = h('div', { class: 'rf-vid' + (audio ? ' aud' : ''), onclick: ev => { if (ev.target === box) shut(); } },
    h('figure', null, v, h('figcaption', null, h('span', null, title), h('button', { class: 'rf-mini', type: 'button', onclick: () => shut() }, '关（Esc）'))));
  const key = ev => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); shut(); } };
  function shut() { v.pause(); box.remove(); URL.revokeObjectURL(url); removeEventListener('keydown', key, true); }
  addEventListener('keydown', key, true);
  document.body.append(box);
}
const play = (it, c) => playFile(at([it.p, ...c.file.split('/')]), it.p + ' · ' + stemOf(c.file));

/* ---------- 挑一条：左边范围，中间一行一条（同一个名字的几版并成一行），右边看素材、全文、换着看几版 ---------- */
const famOf = x => x.p + '/' + x.seg + '/' + x.orig;
function families(items) {
  const m = new Map();
  for (const x of items) {
    const k = famOf(x);
    if (!m.has(k)) m.set(k, { key: k, p: x.p, seg: x.seg, orig: x.orig, label: x.label || stemOf(x.orig), cur: null, olds: [], t: 0 });
    const f = m.get(k);
    if (x.old) f.olds.push(x); else f.cur = x;
    f.t = Math.max(f.t, x.t);
  }
  for (const f of m.values()) f.olds.sort((a, b) => b.t - a.t);
  return [...m.values()].sort((a, b) => b.t - a.t);
}
const versOf = (f, kind) => kind === '历史记录' ? f.olds : kind === '现在用的' ? (f.cur ? [f.cur] : []) : (f.cur ? [f.cur] : []).concat(f.olds);
const nc = vs => vs.reduce((n, v) => n + (v.clips || []).length, 0);   // 这几版一共出过几条样片
const segNum = s => String(s).split('-').map(Number);
const bySeg = (a, b) => { const x = segNum(a), y = segNum(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const KINDS = [['全部', '全部', '几版都算'], ['现在用的', '现在用的', '只看各段现在用的'], ['历史记录', '历史记录', '只看收进历史记录的老版本']];
let PICK = null;
function pick() {
  closePick(); closeMenu(); hidePeek();
  const here = typeof PJ === 'string' ? PJ : '', opened = (typeof OPENPATH === 'string' ? OPENPATH : '').split('/'), om = /^第(.+)段$/.exec(opened[2] || '');
  const hereSeg = om ? om[1] : '', mineFam = om ? opened[0] + '/' + om[1] + '/' + opened[opened.length - 1] : '';   // 正在写的这一份是哪一条
  const saved = lsGet(KEY.scope, {});
  const P = PICK = { q: '', scope: saved.scope || 'all', kind: '全部', all: null, projs: [], rows: [], at: -1, ver: null, timer: 0, seq: 0, pseq: 0, refs: [] };
  if ((P.scope === 'seg' && !hereSeg) || (P.scope === 'proj' && !here)) P.scope = 'all';
  const saveScope = () => lsSet(KEY.scope, { scope: P.scope });   // 记范围；只看历史记录不记，下回照旧全都摆
  const q = h('input', { class: 'rf-q', type: 'search', placeholder: '找字：齐射、炮阵、镜头1……几个词用空格隔开', spellcheck: 'false', 'aria-label': '找字' });
  const clear = h('button', { class: 'rf-ib rf-q-x', type: 'button', title: '清掉', hidden: true, onclick: () => { q.value = ''; clear.hidden = true; load(''); q.focus(); } }, icon('x'));
  const scope = h('nav', { class: 'rf-scope', 'aria-label': '范围' });
  // 行里、小图里的 @图片N 是那一条的：data-no-ref，别让写稿页当成自己的图认
  const list = h('div', { class: 'rf-list', role: 'listbox', 'aria-label': '提示词', 'data-no-ref': '' }, h('p', { class: 'rf-empty' }, '正在列各项目的提示词…'));
  const prev = h('div', { class: 'rf-prev' }, h('p', { class: 'rf-empty' }, '选中一行，这里看全文。'));
  const count = h('span', { class: 'rf-count' }), ok = h('button', { class: 'btn sm dian', type: 'button', disabled: true, onclick: () => choose() }, '摆在旁边');
  const mask = h('div', { class: 'rf-mask', onmousedown: ev => { if (ev.target === mask) closePick(); } },
    h('div', { class: 'rf-pick', role: 'dialog', 'aria-label': '挑一条参考' },
      h('div', { class: 'rf-pick-h' },
        h('div', { class: 'rf-pick-tt' }, h('b', null, '挑一条参考'), h('small', null, '哪个项目的都行，历史记录里的老版本也算')),
        h('label', { class: 'rf-search' }, icon('zoom'), q, clear),
        ib('x', '关（Esc）', () => closePick(), 'x')),
      h('div', { class: 'rf-pick-b' }, scope, list, prev),
      h('div', { class: 'rf-pick-f' }, count, h('span', { class: 'sp' }),
        h('span', { class: 'rf-keys' }, h('span', null, h('kbd', null, '↑'), h('kbd', null, '↓'), ' 换一行'), h('span', null, h('kbd', null, '回车'), ' 摆上'), h('span', null, h('kbd', null, 'Esc'), ' 关')),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => closePick() }, '取消'), ok)));
  P.el = mask;
  hwheel(scope);
  document.body.append(mask);
  q.focus();
  q.addEventListener('input', () => { clear.hidden = !q.value; clearTimeout(P.timer); P.timer = setTimeout(() => load(q.value.trim()), 220); });
  mask.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closePick(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); move(ev.key === 'ArrowDown' ? 1 : -1); }
    else if (ev.key === 'Enter' && P.ver && !ev.isComposing && ev.target.tagName !== 'BUTTON') { ev.preventDefault(); choose(); }
  });
  (async () => {
    try {
      R.list = await fetchList(''); PCOL = null;
      if (PICK !== P) return;
      P.projs = [...new Set(R.list.map(x => x.p))].sort((a, b) => (b === here) - (a === here) || a.localeCompare(b, 'zh'));
      if (P.scope.startsWith('p:') && !P.projs.includes(P.scope.slice(2))) P.scope = 'all';
      if (!P.q) { P.all = R.list; paintList(); }
    } catch (e) { if (PICK === P) list.replaceChildren(h('p', { class: 'rf-empty bad' }, '列不出来：' + e.message)); }
  })();
  async function load(text) {
    const seq = ++P.seq;
    P.q = text;
    if (!text) { P.all = R.list; paintList(); return; }
    list.classList.add('busy');
    try { const got = await fetchList(text); if (seq !== P.seq || PICK !== P) return; P.all = got; paintList(); }
    catch (e) { if (seq === P.seq && PICK === P) list.replaceChildren(h('p', { class: 'rf-empty bad' }, '找不了：' + e.message)); }
    finally { if (seq === P.seq) list.classList.remove('busy'); }
  }
  const recent = () => termsOf(P.q).length ? [] : lsGet(KEY.recent, []);
  /* 一行默认看哪一版：正摆着的、最近看过的那一版，不然现在用的，再不然最后收进去的 */
  const prefer = f => { const vs = versOf(f, P.kind), ids = [R.cur, ...recent()].filter(x => x && famOf(x) === f.key).map(idOf); return vs.find(v => ids.includes(idOf(v))) || vs[0]; };
  const inScope = (f, s) => s === 'all' || (s === 'seg' ? f.p === here && f.seg === hereSeg : s === 'proj' ? f.p === here : f.p === s.slice(2));
  function paintScope(n, kn) {
    const b = (key, label, sub, p) => h('button', { class: 'rf-sc' + (P.scope === key ? ' on' : ''), type: 'button', title: sub ? label + '（' + sub + '）' : label, onclick: () => { if (P.scope === key) return; P.scope = key; saveScope(); paintList(); } },
      p ? dot(p) : null, h('span', { class: 'rf-sc-t' }, h('span', null, label), sub ? h('small', null, sub) : null), h('span', { class: 'rf-sc-n' }, String(n[key] || 0)));
    const others = P.projs.filter(p => p !== here), other = P.scope.startsWith('p:') ? P.scope.slice(2) : '';
    const more = others.length ? h('button', { class: 'rf-sc more' + (other ? ' on' : ''), type: 'button', title: '只看别的哪个项目', onclick: ev => popMenu(ev.currentTarget, [h('div', { class: 'rf-menu-h' }, '只看别的哪个项目'), ...others.map(p => h('button', { type: 'button', role: 'menuitem', class: p === other ? 'on' : '', onclick: () => { closeMenu(); P.scope = 'p:' + p; saveScope(); paintList(); } },
      h('span', { class: 'ck' }, dot(p)), h('span', { class: 'tx' }, p), h('small', { class: 'n' }, String(n['p:' + p] || 0))))]) },
      other ? dot(other) : null, h('span', { class: 'rf-sc-t' }, h('span', null, other || '别的项目')), other ? h('span', { class: 'rf-sc-n' }, String(n[P.scope] || 0)) : null, icon('fold')) : null;
    scope.replaceChildren(
      h('div', { class: 'rf-sc-g' }, h('h4', null, '范围'),
        hereSeg ? b('seg', '这一段', '第' + hereSeg + '段') : null,
        here ? b('proj', '这个项目', here, here) : null,
        b('all', '全部项目', P.projs.length + ' 个项目'), more),
      others.length ? h('div', { class: 'rf-sc-g others' }, h('h4', null, '别的项目'), others.map(p => b('p:' + p, p, null, p))) : null,
      h('div', { class: 'rf-sc-g kinds' }, h('h4', null, '版本'),
        h('div', { class: 'rf-kinds', role: 'radiogroup' }, KINDS.map(([k, label, tt]) => h('button', { class: 'rf-kind' + (k === P.kind ? ' on' : ''), type: 'button', role: 'radio', 'aria-checked': String(k === P.kind), title: tt + '（' + (kn[k] || 0) + ' 条）', onclick: () => { if (P.kind === k) return; P.kind = k; saveScope(); paintList(); } }, label)))));
    const on = scope.querySelector('.rf-sc.on');
    if (on && scope.scrollWidth > scope.clientWidth + 1) { const l = on.offsetLeft, r = l + on.offsetWidth; if (l < scope.scrollLeft || r > scope.scrollLeft + scope.clientWidth) scope.scrollLeft = Math.max(0, l - 24); }
  }
  function groupsOf(fams, terms) {
    const out = [], seen = new Set();
    if (!terms.length) {
      const r = [...new Set(recent().map(famOf))].map(k => fams.find(f => f.key === k)).filter(Boolean);   // 同一条看过几版，只摆一行
      if (r.length) { out.push({ name: '最近看过', fams: r }); r.forEach(f => seen.add(f.key)); }
    }
    const rest = fams.filter(f => !seen.has(f.key));
    if (terms.length) out.push({ name: '找到的', fams: rest });
    else if (P.scope === 'all') {   // 全部项目：照改动时间分几堆
      const d0 = new Date(new Date().toDateString()).getTime(), day = 864e5;
      for (const [name, lo, hi] of [['今天', d0, Infinity], ['昨天', d0 - day, d0], ['这几天', d0 - 6 * day, d0 - day], ['更早', -Infinity, d0 - 6 * day]]) out.push({ name, fams: rest.filter(f => f.t >= lo && f.t < hi) });
    } else if (P.scope === 'seg') out.push({ name: '第' + hereSeg + '段', fams: rest });
    else {   // 一个项目：照段分，正在写的这一段在前，别的段号大的（新写的）在前
      const segs = [...new Set(rest.map(f => f.seg))].sort((a, b) => (P.scope === 'proj' && (b === hereSeg) - (a === hereSeg)) || bySeg(b, a));
      for (const s of segs) out.push({ name: '第' + s + '段', fams: rest.filter(f => f.seg === s) });
    }
    return out.filter(g => g.fams.length);
  }
  function paintList() {
    if (!P.all) return;
    const terms = termsOf(P.q), cur = R.cur ? famOf(R.cur) : '', all = families(P.all), has = (f, k) => versOf(f, k).length > 0;
    const n = {}, kn = {};
    for (const s of ['seg', 'proj', 'all', ...P.projs.map(p => 'p:' + p)]) n[s] = all.filter(f => inScope(f, s) && has(f, P.kind)).length;
    for (const [k] of KINDS) kn[k] = all.filter(f => inScope(f, P.scope) && has(f, k)).length;
    paintScope(n, kn);
    const fams = all.filter(f => inScope(f, P.scope) && has(f, P.kind)), out = [];
    P.rows = [];
    const one = P.scope !== 'all';   // 只看一个项目：行里不再写项目名
    for (const g of groupsOf(fams, terms)) {
      if (P.rows.length >= 400) break;
      out.push(h('div', { class: 'rf-grp' }, h('span', null, g.name), h('small', null, String(g.fams.length))));
      for (const f of g.fams) { if (P.rows.length >= 400) break; out.push(row(f, P.rows.length, terms, cur, one)); P.rows.push(f); }
    }
    list.replaceChildren(...(out.length ? out : [h('p', { class: 'rf-empty' }, terms.length ? '没找到「' + P.q + '」。换个词，或者少写一个词，或者把范围放大一点。' : '这里还没有。换个范围看看。')]));
    list.scrollTop = 0;
    const nv = fams.reduce((s, f) => s + versOf(f, P.kind).length, 0);
    count.textContent = (fams.length > P.rows.length ? '找到 ' + fams.length + ' 条，只摆了前 ' + P.rows.length + ' 条' : '共 ' + fams.length + ' 条') + (nv > fams.length ? '（' + nv + ' 版）' : '') + (terms.length && P.all.length >= 300 ? '，只找了前 300 版，多写个词能找准些' : '');
    P.at = -1; P.ver = null; ok.disabled = true;
    if (P.rows.length) select(0, true);
    else prev.replaceChildren(h('p', { class: 'rf-empty' }, '选中一行，这里看全文。'));
  }
  function row(f, i, terms, cur, one) {
    const vs = versOf(f, P.kind), top = prefer(f), hit = terms.length ? top.hit || (vs.find(v => v.hit) || {}).hit : '', clips = nc(vs);
    const sub = [one ? '' : f.p, '第' + f.seg + '段', P.kind !== '现在用的' && f.olds.length ? '历史 ' + f.olds.length + ' 版' : '', clips ? '样片 ' + clips : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'rf-row', role: 'option', 'data-i': String(i), onclick: () => select(i), ondblclick: () => { select(i); choose(); } },
      h('div', { class: 'rf-row-t' }, dot(f.p), h('b', null, f.label),
        f.key === cur ? h('span', { class: 'rf-tag on' }, '正摆着') : null,
        f.key === mineFam ? h('span', { class: 'rf-tag me' }, '正在写的这一条') : null,
        f.cur ? null : h('span', { class: 'rf-tag old' }, '只在历史记录'),
        h('span', { class: 'sp' }), h('small', { class: 'rf-row-when', title: whenOf(top) }, ago(f.t))),
      h('div', { class: 'rf-row-s' }, sub),
      hit ? h('div', { class: 'rf-row-hit' }, marked(hit, terms)) : top.lead ? h('div', { class: 'rf-row-lead' }, top.lead) : null);
  }
  function move(d) { if (P.rows.length) select(Math.max(0, Math.min(P.rows.length - 1, P.at + d))); }
  function head(f, vs, it) {
    const clips = it.clips || [];
    return h('div', { class: 'rf-prev-h' },
      h('div', { class: 'rf-prev-p' }, dot(f.p), h('span', null, placeOf(f)), h('span', { class: 'sp' }),
        clips.length ? h('button', { class: 'rf-chip clip', type: 'button', title: '这一版出过的样片：' + clips.map(c => stemOf(c.file)).join('、'), onclick: ev => clips.length === 1 ? play(it, clips[0]) : clipMenu(ev.currentTarget, it) }, icon('play'), '看样片 ' + clips.length) : null),
      h('b', { class: 'rf-prev-t', title: it.file }, f.label),
      vs.length > 1
        ? hwheel(h('div', { class: 'rf-vers', 'aria-label': '这一条的几版' }, vs.map(v => h('button', { class: 'rf-ver-b' + (v === it ? ' on' : '') + (v.old ? ' old' : ''), type: 'button', title: v.file, onclick: () => select(P.at, true, v) },
          verName(v), (v.clips || []).length ? h('small', null, ' · 样片 ' + v.clips.length) : null))))
        : h('small', { class: 'rf-prev-one' }, (it.old ? '历史记录 · ' : '现在用的 · ') + whenOf(it)));
  }
  async function select(i, soft, ver) {
    const f = P.rows[i];
    if (!f) return;
    const vs = versOf(f, P.kind), it = ver || prefer(f), seq = ++P.pseq;
    P.at = i; P.ver = it; ok.disabled = false;
    for (const el of list.querySelectorAll('.rf-row.on')) { el.classList.remove('on'); el.removeAttribute('aria-selected'); }
    const rw = list.querySelector('.rf-row[data-i="' + i + '"]');
    if (rw) { rw.classList.add('on'); rw.setAttribute('aria-selected', 'true'); if (!soft) rw.scrollIntoView({ block: 'nearest' }); }
    prev.replaceChildren(head(f, vs, it), h('div', { class: 'rf-prev-b' }, h('p', { class: 'rf-empty' }, '正在读…')));
    let text, refs = [];
    try { text = await textOf(it); } catch (e) { if (seq === P.pseq) prev.replaceChildren(head(f, vs, it), h('div', { class: 'rf-prev-b' }, h('p', { class: 'rf-empty bad' }, '读不了：' + e.message))); return; }
    try { refs = (await refsOf(it, text)).refs; } catch (e) { /* 认不出图：字照样能看 */ }
    if (seq !== P.pseq || PICK !== P) return;
    P.refs = refs;
    prev.replaceChildren(head(f, vs, it), h('div', { class: 'rf-prev-b', 'data-ref-p': it.p }, assetsView(it.p, refs), docView(sectionsOf(text), { terms: termsOf(P.q) })));
    const m = prev.querySelector('.rf-prev-b mark');
    if (m) m.scrollIntoView({ block: 'center' });
  }
  function choose() { const it = P.ver; if (!it) return; closePick(); openDock(it); }
}
function closePick() { if (PICK) { clearTimeout(PICK.timer); PICK.el.remove(); PICK = null; hidePeek(); closeMenu(); } }

/* ---------- @图片N：照那一条自己挂的图认（公用/点图.js 的 also：这两处归这里管，别处照写稿页自己的认） ---------- */
function refAt(ref, el) {
  const box = el && el.closest && el.closest('.rf-body, .rf-prev-b');
  if (!box) return undefined;
  const refs = box.classList.contains('rf-prev-b') ? (PICK && PICK.refs) || [] : R.refs, p = box.dataset.refP;
  const r = refs.find(x => x.ref === ref);
  if (!r || !IMG.test(r.path)) return null;
  return { tip: ref + ' · ' + stemOf(r.path) + '　点开看大图（' + p + ' 挂的图）', open: () => showPic(p, r) };
}
if (window.RefPic && RefPic.also) RefPic.also(refAt);

/* ---------- 顶上的钮；这份稿上回参考的那一条接着摆 ---------- */
const TIP = '挑一条别的视频提示词摆在旁边，边写边看（哪个项目的都行，历史记录里的也算）';
function start() {
  const top = document.querySelector('.top-right');
  if (top && !document.getElementById('refBtn')) top.insertBefore(h('button', { class: 'btn sm rf-btn', id: 'refBtn', type: 'button', title: TIP, onclick: () => pick() }, '参考'), document.getElementById('previewBtn'));
  const last = lsGet(mineKey(), null);
  if (last && last.p && last.file) openDock(last, true);
}
let tries = 0;
(function wait() {   // 写稿页打开文件以后（OPENPATH 有了）再摆：记的是这一份稿参考的哪一条
  if (typeof OPENPATH === 'string' && OPENPATH && document.getElementById('sheet')) { start(); return; }
  if (++tries < 100) setTimeout(wait, 100); else start();
})();
window.WriteRef = { pick, open: openDock, close: closeDock, sections: sectionsOf, forHere };
})();
