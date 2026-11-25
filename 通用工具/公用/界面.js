/* ============================================================
   公用 · 界面（window.UI）
   流水线各页共用的小部件：造元素、图标、提示条、对话框、缩小图、悬停看大图、挨着按钮的小窗。
   看文件的那一页（项目管理.html）、写稿页也用这一份（样式在 样式.css；提示条单独在 提示条.css）。
   ============================================================ */
(function () {
'use strict';
const { FS, isComposing } = window.Base;
const box = id => document.getElementById(id) || document.body.appendChild(Object.assign(document.createElement('div'), { id }));

/* ---------- DOM 小工具 ---------- */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return add(el, kids);
}
function add(el, kids) {
  for (const c of [kids].flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const ICON = {
  up: '<path d="M8 12.5v-9M4.6 6.9 8 3.5l3.4 3.4"/>',
  down: '<path d="M8 3.5v9M4.6 9.1 8 12.5l3.4-3.4"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  x: '<path d="M4.7 4.7l6.6 6.6M11.3 4.7l-6.6 6.6"/>',
  dup: '<rect x="5.5" y="5.5" width="7" height="7" rx="1.2"/><path d="M10.5 3.5h-6a1 1 0 0 0-1 1v6"/>',
  folder: '<path d="M2.5 4.6a1 1 0 0 1 1-1h2.9l1.4 1.4h4.7a1 1 0 0 1 1 1v5.9a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>',
  folderOpen: '<path d="M2.5 11.9V4.6a1 1 0 0 1 1-1h2.9l1.4 1.4h4.2a1 1 0 0 1 1 1v1"/><path d="M2.5 11.9 4.1 7.8a1 1 0 0 1 .9-.6h8.6a.6.6 0 0 1 .6.8l-1.5 3.9a1 1 0 0 1-.9.6H3.4a.9.9 0 0 1-.9-.6z"/>',
  book: '<path d="M2.8 3.6h3.6c.7 0 1.3.3 1.6.8.3-.5.9-.8 1.6-.8h3.6v8.6H9.6c-.7 0-1.3.3-1.6.8-.3-.5-.9-.8-1.6-.8H2.8z"/><path d="M8 4.4v8.4"/>',
  copy: '<rect x="5.5" y="2.8" width="7.7" height="9.2" rx="1.2"/><path d="M3.2 5.6v6.6a1 1 0 0 0 1 1h5.6"/>',
  check: '<path d="M3.6 8.4 6.5 11.3 12.4 4.7"/>',
  grid: '<rect x="2.8" y="2.8" width="4.2" height="4.2" rx=".6"/><rect x="9" y="2.8" width="4.2" height="4.2" rx=".6"/><rect x="2.8" y="9" width="4.2" height="4.2" rx=".6"/><rect x="9" y="9" width="4.2" height="4.2" rx=".6"/>',
  chev: '<path d="M6 4l4 4-4 4"/>',
  chevL: '<path d="M10 4 6 8l4 4"/>',
  dockR: '<rect x="2.5" y="3" width="11" height="10" rx="1.6"/><path d="M9.6 3v10"/>',   // 摆到右边（写稿页旁边那一格，公用/写稿旁窗.js）
  dockB: '<rect x="2.5" y="3" width="11" height="10" rx="1.6"/><path d="M2.5 9.4h11"/>',   // 摆到下面
  play: '<path d="M5 3.4v9.2L12.6 8z" fill="currentColor"/>',
  pause: '<path d="M5.4 3.6v8.8M10.6 3.6v8.8" stroke-width="2.4"/>',
  prev: '<path d="M4 3.8v8.4" stroke-width="1.8"/><path d="M12.4 3.8 6.6 8l5.8 4.2z" fill="currentColor"/>',
  next: '<path d="M12 3.8v8.4" stroke-width="1.8"/><path d="M3.6 3.8 9.4 8l-5.8 4.2z" fill="currentColor"/>',
  sound: '<path d="M2.8 6.1h2.4l3.3-2.6v9l-3.3-2.6H2.8z"/><path d="M10.7 5.8a3.2 3.2 0 0 1 0 4.4M12.4 4.1a5.6 5.6 0 0 1 0 7.8"/>',
  mute: '<path d="M2.8 6.1h2.4l3.3-2.6v9l-3.3-2.6H2.8z"/><path d="M10.6 6.2l3.4 3.6M14 6.2l-3.4 3.6"/>',
  film: '<rect x="2.6" y="3.2" width="10.8" height="9.6" rx="1.3"/><path d="M5.2 3.2v9.6M10.8 3.2v9.6M2.6 6.4h2.6M2.6 9.6h2.6M10.8 6.4h2.6M10.8 9.6h2.6"/>',
  image: '<rect x="2.6" y="3.2" width="10.8" height="9.6" rx="1.3"/><circle cx="6" cy="6.4" r="1.1"/><path d="m2.9 11.6 3.3-3.2 2.2 2 1.9-1.7 3 2.9"/>',
  doc: '<path d="M4 2.6h5.2l2.8 2.8v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1z"/><path d="M9 2.8v2.8h2.8M5.4 8.2h5.2M5.4 10.6h3.6"/>',
  file: '<path d="M4 2.6h5.2l2.8 2.8v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3.6a1 1 0 0 1 1-1z"/><path d="M9 2.8v2.8h2.8"/>',
  more: '<circle cx="3.8" cy="8" r=".9" fill="currentColor"/><circle cx="8" cy="8" r=".9" fill="currentColor"/><circle cx="12.2" cy="8" r=".9" fill="currentColor"/>',
  refresh: '<path d="M12.8 7.4A4.9 4.9 0 1 0 11.4 11"/><path d="M13 3.6v3.8H9.2"/>',
  cloud: '<path d="M4.7 12.6h6.6a2.7 2.7 0 0 0 .5-5.35 3.7 3.7 0 0 0-7.1-.9 3.15 3.15 0 0 0 0 6.25z"/>',
  sideL: '<rect x="2.6" y="3" width="10.8" height="10" rx="1.4"/><path d="M6.4 3v10M10.6 6.4 9 8l1.6 1.6"/>',
  sideR: '<rect x="2.6" y="3" width="10.8" height="10" rx="1.4"/><path d="M6.4 3v10M9.2 6.4 10.8 8l-1.6 1.6"/>',
  pen: '<path d="M10.6 3.2 12.8 5.4 6 12.2l-3 .8.8-3z"/><path d="M9.4 4.4l2.2 2.2"/>',
  open: '<path d="M9.2 3h3.8v3.8M13 3 7.6 8.4"/><path d="M11.4 9.4v2.6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5.6a1 1 0 0 1 1-1h2.6"/>',
  zoom: '<circle cx="7" cy="7" r="4"/><path d="m10 10 3 3M5.4 7h3.2M7 5.4v3.2"/>',
  clock: '<circle cx="8" cy="8" r="5.4"/><path d="M8 5v3.2l2.2 1.4"/>',
  flow: '<rect x="2.4" y="2.6" width="4.6" height="3.6" rx=".9"/><rect x="9" y="6.2" width="4.6" height="3.6" rx=".9"/><rect x="2.4" y="9.8" width="4.6" height="3.6" rx=".9"/><path d="M7 4.4h2.6a1.7 1.7 0 0 1 1.7 1.7M11.3 9.8a1.8 1.8 0 0 1-1.8 1.8H7"/>',
};
function icon(n, cls) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[n] || '';
  return s;
}

/* ---------- 提示、对话框 ---------- */
function toast(msg, kind) {
  const t = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, h('i', { class: 's' }), h('span', null, msg));
  box('toasts').append(t);
  setTimeout(() => t.classList.add('out'), kind === 'err' ? 6000 : 3600);
  setTimeout(() => t.remove(), kind === 'err' ? 6500 : 4100);
}
function dialog(build) {
  return new Promise(resolve => {
    const mask = h('div', { class: 'mask' });
    let done = false;
    const close = v => {
      if (done) return; done = true;
      mask.classList.add('out');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(() => mask.remove(), 180);
      resolve(v);
    };
    const top = () => mask === [...document.querySelectorAll('#layer > .mask:not(.out)')].pop();   // 叠着两层时，Esc 只关最上面那层
    const onKey = e => { if (e.key === 'Escape' && !isComposing(e) && top()) { e.preventDefault(); e.stopPropagation(); close(null); } };
    mask.append(build(close));
    mask.addEventListener('mousedown', e => { if (e.target === mask) close(null); });
    document.addEventListener('keydown', onKey, true);
    box('layer').append(mask);
    setTimeout(() => { const f = mask.querySelector('[data-focus]') || mask.querySelector('input,select,textarea'); f && f.focus(); }, 40);
  });
}
function dlgShell(title, sub, body, acts) {
  return h('div', { class: 'dlg' }, h('h3', null, title), sub ? h('div', { class: 'dlg-sub' }, sub) : null, body ? h('div', { class: 'dlg-body' }, body) : null, h('div', { class: 'acts' }, acts));
}
function confirmDlg({ title, body, ok = '确定', cancel = '取消', danger }) {
  return dialog(close => dlgShell(title, body, null, [
    h('button', { class: 'btn ghost', onclick: () => close(false) }, cancel),
    h('button', { class: 'btn ' + (danger ? 'zhu' : 'ink'), 'data-focus': '', onclick: () => close(true) }, ok),
  ]));
}
function choiceDlg({ title, body, buttons }) {
  return dialog(close => dlgShell(title, body, null, buttons.map(b => h('button', { class: 'btn ' + (b.cls || ''), 'data-focus': b.focus ? '' : null, onclick: () => close(b.value) }, b.label))));
}
function chips(options, value, onChange) {
  const wrap = h('div', { class: 'chips' });
  let cur = value;
  const paint = () => [...wrap.children].forEach(c => c.classList.toggle('on', cur === c.dataset.v));
  for (const [v, label] of options) {
    wrap.append(h('button', { class: 'chip', type: 'button', 'data-v': v, onclick: () => { cur = v; paint(); onChange && onChange(cur); } }, label));
  }
  paint();
  wrap.get = () => cur;
  return wrap;
}
const field = (label, input, hint) => h('label', { class: 'fld' }, h('span', null, label), input, hint ? h('em', null, hint) : null);
/* 问一个名字：check 返回一句话就是不行，照实写在下面 */
function inputDlg({ title, body, label, value = '', ok = '好', check }) {
  const inp = h('input', { class: 'inp', value, spellcheck: 'false' });
  const err = h('div', { class: 'fld-err' });
  return dialog(close => {
    const done = async () => { const v = inp.value.trim(); const msg = check ? await check(v) : ''; if (msg) { err.textContent = msg; return; } close(v); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); done(); } });
    inp.addEventListener('input', () => { err.textContent = ''; });
    setTimeout(() => { inp.focus(); const dot = value.lastIndexOf('.'); inp.setSelectionRange(0, dot > 0 ? dot : value.length); }, 60);
    return dlgShell(title, body, [field(label, inp), err],
      [h('button', { class: 'btn ghost', onclick: () => close(null) }, '取消'), h('button', { class: 'btn ink', onclick: done }, ok)]);
  });
}
async function copyText(text, ok) {
  try { await navigator.clipboard.writeText(text); toast(ok || '复制好了'); return true; }
  catch (e) { /* 浏览器不让写剪贴板：摆出来让人自己复制 */ }
  const inp = h('input', { class: 'inp', value: text, readonly: true, spellcheck: 'false' });
  setTimeout(() => { inp.focus(); inp.select(); }, 60);
  await dialog(close => dlgShell('复制', '浏览器没让直接复制。已经选好了，按 Ctrl + C 复制。', [inp],
    h('button', { class: 'btn ink', onclick: () => close() }, '好了')));
  return false;
}

/* ---------- 「AI 用」那一排：交给哪个 AI，旁边跟着它的模型、推理深度（流水线顶栏、审片台共用；选的记在 底座.js 的 CH）----------
   cls：样式名的头，摆出来是 <cls>-box 包着几个 <cls>，下拉框是 <cls>-sel，定不了的那句是 <cls>-fixed；tip：「AI 用」下拉框上的说明。
   一个 AI 都调不起来就不摆；只有一个就不给选，写「交给 X」 */
function aiPicker(cls, tip) {
  const { CH } = window.Base;
  if (!CH.list.length) return null;
  const box = kids => h('span', { class: cls + '-box' }, kids);
  const pick = (k, label, say) => {   // k：'模型' 或 '深度'；这个 AI 定不了这一样就不出
    const c = CH.info();
    if (!c || !(c[k] || []).length) return null;
    const dn = c['默认' + k + '名'];
    const sel = h('select', { class: cls + '-sel', title: say + (c[k + '说明'] || '') }, h('option', { value: '' }, '默认' + (dn ? '（' + dn + '）' : '')), c[k].map(d => h('option', { value: d.id }, d.名)));
    sel.value = CH.opt(k);
    sel.addEventListener('change', () => { CH.setOpt(c.id, k, sel.value); sel.blur(); toast(CH.say()); });
    return h('label', { class: cls }, label, sel);
  };
  const opts = () => {   // 定不了的合成一句「照 Codex（Terra · 最高）」；给我提示词：用哪个 AI、什么模型你自己定
    const c = CH.info();
    if (!c || c.hand === 'self') return h('span');
    const md = pick('模型', '模型', '用它的哪个模型。'), dp = pick('深度', '推理', '想得多深：越深越慢。');
    const fixed = [!md && c.默认模型名, !dp && c.默认深度名].filter(Boolean).join(' · ');
    const label = !md && !dp ? '模型、推理' : !md ? '模型' : !dp ? '推理' : '';
    const say = [...new Set([!md && c.模型说明, !dp && c.深度说明].filter(Boolean))].join('\n');
    return box([md, dp, label ? h('span', { class: cls, title: say }, label, h('span', { class: cls + '-fixed' }, '照 ' + c.名 + (fixed ? '（' + fixed + '）' : ''))) : null]);
  };
  if (CH.list.length < 2) return box([CH.now() === CH.SELF ? h('span', { class: cls, title: '这台电脑上没找到 Codex、DeepSeek、豆包工作：点了把要交代的话给你，贴进你自己开的对话；它做完告诉项目，这里自动接着做' }, 'AI：复制给你自己的对话') : h('span', { class: cls }, '交给 ' + CH.name()), opts()]);
  const sel = h('select', { class: cls + '-sel', title: tip }, CH.list.map(c => h('option', { value: c.id, title: c.说明 }, c.名)));
  sel.value = CH.now();
  let op = opts();
  sel.addEventListener('change', () => { CH.set(sel.value); sel.blur(); const n = opts(); op.replaceWith(n); op = n; toast(CH.say()); });
  return box([h('label', { class: cls }, 'AI 用', sel), op]);
}

/* 缩小图：一次做两张，做好的留着。w：做多宽（小图 220，悬停看的大一点 640）。各页都用这一份，别另抄 */
const THUMB = new Map(), TQ = [], TSIZE = new Map();
let TBUSY = 0;
function pump() {
  while (TBUSY < 2 && TQ.length) {
    const job = TQ.shift(); TBUSY++;
    makeThumb(job.parts, job.w).then(job.res, job.rej).finally(() => { TBUSY--; pump(); });
  }
}
/* 把一张图缩到 w 宽，给 { url, w, h }。w 是 0、缩不了（不是图）就给原图，w、h 是 0。缩图只用这一份 */
async function shrink(blob, w) {
  if (w) try {
    const bmp = await createImageBitmap(blob, { resizeWidth: w, resizeQuality: 'medium' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
    return { url: URL.createObjectURL(await c.convertToBlob({ type: 'image/jpeg', quality: .84 })), w: c.width, h: c.height };
  } catch (e) { /* 缩不了：给原图 */ }
  return { url: URL.createObjectURL(blob), w: 0, h: 0 };
}
async function makeThumb(parts, w) {
  const { buf } = await FS.read(parts);
  const ext = parts[parts.length - 1].split('.').pop().toLowerCase();
  const t = await shrink(new Blob([buf], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }), w);
  if (t.w) TSIZE.set(t.url, [t.w, t.h]);
  return t.url;
}
/* 做好的这张多宽多高：先按比例占好位置，图出来不跳 */
const thumbSize = u => TSIZE.get(u) || null;
/* 图重出过（同一个路径换了内容）：做好的缩小图不能再用。parts：只扔这一张；不给就全扔 */
function dropThumbs(parts) {
  const one = parts && parts.join('/');
  for (const [k, p] of THUMB) if (!one || k.slice(0, k.lastIndexOf('@')) === one) {
    THUMB.delete(k);
    p.then(u => setTimeout(() => { URL.revokeObjectURL(u); TSIZE.delete(u); }, 1000), () => {});   // 等一会再收：刚拿到这张的图还在读
  }
}
function thumbOf(parts, w) {
  const k = parts.join('/') + '@' + w;
  if (!THUMB.has(k)) {
    const p = new Promise((res, rej) => { TQ.push({ parts, w, res, rej }); pump(); });
    p.catch(() => { if (THUMB.get(k) === p) THUMB.delete(k); });
    THUMB.set(k, p);
  }
  return THUMB.get(k);
}
/* 露出来（离屏幕 400 像素以内）才做：小图多的地方用。fn 只跑一次 */
const SEEN = new WeakMap();
const SEEN_IO = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) { SEEN_IO.unobserve(e.target); const fn = SEEN.get(e.target); SEEN.delete(e.target); if (fn) fn(e.target); }
}, { rootMargin: '400px' });
function whenSeen(el, fn) { SEEN.set(el, fn); SEEN_IO.observe(el); return el; }
function thumbImg(parts, w) {
  const img = h('img', { alt: '', draggable: 'false' });
  thumbOf(parts, w || 220).then(u => { img.src = u; }).catch(() => {});
  return img;
}

/* ---------- 弹出来的小东西：悬停看大图、挨着按钮的小窗 ---------- */
let HOV = null, HOV_T = 0;
function hideHov() { clearTimeout(HOV_T); if (HOV) { HOV.remove(); HOV = null; } }
/* 鼠标停在一张小图上：旁边弹出大一点的 */
function hoverable(el, parts, title, sub) {
  el.addEventListener('mouseenter', () => {
    clearTimeout(HOV_T);
    HOV_T = setTimeout(() => {
      if (!el.isConnected) return;
      hideHov();
      const img = thumbImg(parts, 640);
      HOV = h('div', { class: 'fl-hov' }, img, h('div', { class: 'fl-hov-n' }, title || ''), sub ? h('div', { class: 'fl-hov-p' }, sub) : null);
      document.body.append(HOV);
      const put = () => {
        if (!HOV || !el.isConnected) return;
        const r = el.getBoundingClientRect(), w = HOV.offsetWidth, hh = HOV.offsetHeight;
        const left = r.right + 10 + w <= innerWidth - 8 ? r.right + 10 : r.left - 10 - w >= 8 ? r.left - 10 - w : Math.max(8, innerWidth - w - 8);
        HOV.style.left = left + 'px';
        HOV.style.top = Math.max(8, Math.min(r.top - 20, innerHeight - hh - 8)) + 'px';
      };
      put(); img.addEventListener('load', put);
    }, 350);
  });
  el.addEventListener('mouseleave', hideHov);
  el.addEventListener('mousedown', hideHov);
}
let POP = null;
function closePop() {
  if (!POP) return;
  const p = POP; POP = null;
  p.el.remove();
  document.removeEventListener('mousedown', p.out, true);
  document.removeEventListener('keydown', p.key, true);
  window.removeEventListener('resize', closePop);
  if (p.scroll) window.removeEventListener('scroll', p.scroll, true);
}
/* 挨着 anchor 弹一个小窗；点别处、按 Esc、滚动页面就收起 */
function popover(anchor, build) {
  closePop(); hideHov();
  const el = h('div', { class: 'fl-pop', role: 'dialog' });
  const p = { el };
  p.out = e => { if (!el.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  p.key = e => { if (e.key === 'Escape' && !isComposing(e)) { e.preventDefault(); e.stopPropagation(); closePop(); } };
  el.append(...[build(closePop)].flat(Infinity).filter(Boolean));
  document.body.append(el);
  const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  el.style.top = (r.bottom + 6 + hh <= innerHeight - 8 ? r.bottom + 6 : r.top - 6 - hh >= 8 ? r.top - 6 - hh : Math.max(8, innerHeight - hh - 8)) + 'px';
  document.addEventListener('mousedown', p.out, true);
  document.addEventListener('keydown', p.key, true);
  window.addEventListener('resize', closePop);
  p.scroll = e => { if (e.target instanceof Node && el.contains(e.target)) return; closePop(); };   // 滚页面就收起；在小窗自己的清单里滚不算
  window.addEventListener('scroll', p.scroll, true);
  POP = p;
}
/* 钉在另一条下面：el 是 position: sticky 的一条，钉在 above（也钉着的，比如步骤条；窄了会折行，高度不定）下面，照它的底边量；钉住时加 .stuck（底下一道线）。
   滚动、改窗口大小、重画以后各量一回（资产详情.js 的标题行、提示词那一步的筛选都用它） */
function pinUnder(el, above) {
  if (!el) return;
  const pin = above ? (parseFloat(getComputedStyle(above).top) || 0) + above.offsetHeight : 0;
  el.style.top = pin + 'px';
  el.classList.toggle('stuck', el.getBoundingClientRect().top <= pin + 1);
}

window.UI = { h, add, icon, ICON, toast, dialog, dlgShell, confirmDlg, choiceDlg, chips, field, inputDlg, copyText, aiPicker, shrink, thumbOf, thumbImg, thumbSize, dropThumbs, whenSeen, hoverable, hideHov, popover, closePop, pinUnder, get popOpen() { return !!POP; } };
})();
