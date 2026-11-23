/* ============================================================
   写稿页 · 稿子旁边那一格（window.SideDock）：参考（公用/写稿参考.js）、看图（公用/写稿看图.js）都摆在这里，不盖住字。
   宽的时候摆在稿子右边、窄的时候摆在下面（照稿子这一块多宽自己定，标题栏上的钮能换边）；中间那条拖宽窄。
   各记各的：摆哪边、占多宽多高，用它的那一块给 st（{ mode: 'auto' | 'side' | 'bottom', side, bottom }）和 save()，拖完、换完边照它记。
   一次只露一个：后摆上来的盖在上面，收掉它，底下那个再露出来（2026-11-22：参考摆着时点开看图，图先盖在参考上，收起图参考回来）。
   put(key, el, opt)：摆上来（盖在最上面），或换掉 key 原来那一块（还在原来那一层）；
     opt = { st, save, fold()：只留标题栏没有, onLayout(mode)：摆好以后它自己收拾，mode 是露着时摆在哪边，盖在底下时是 '' }。
   raise(key)：挪到最上面。drop(key)：收掉。has(key)、top()：露着的是哪一块。mode(key)：摆在哪边。
   swapBtn(key, st)：换边的钮（图标、提示跟着变）。ready()：稿子在不在（不在就摆不了）；引这个文件时稿子已经在了，就当场包好。
   onLayout(fn)：每回摆好（摆上、收掉、换边、拖宽窄、窗口变了）以后叫 fn。
   modeFor、sizeAt 不碰页面；整个在 node 里用假的页面测（通用工具/测试/写稿旁窗_测试.cjs）。
   要先引 公用/界面.js；样式在 公用/写稿旁窗.css。
   ============================================================ */
(function () {
'use strict';
const WIDE = 880, MIN = 0.2, MAX = 0.72;   // 稿子这一块宽过 880 才摆右边；旁边这一格占 20%～72%
const modeFor = (st, width) => st && (st.mode === 'side' || st.mode === 'bottom') ? st.mode : width >= WIDE ? 'side' : 'bottom';
const sizeAt = (m, box, x, y) => Math.min(MAX, Math.max(MIN, m === 'side' ? (box.right - x) / box.width : (box.bottom - y) / box.height));
const SWAP = { side: ['dockB', '摆到稿子下面'], bottom: ['dockR', '摆到稿子右边'] };
const S = { split: null, docks: [] };   // docks：{ key, el, grip, opt }，后面的盖在上面
const HOOKS = [];   // onLayout(fn)：每回摆好以后叫一声（写稿页：稿子变宽变窄，文字框重新撑高）
const find = key => S.docks.find(d => d.key === key) || null;
const topDock = () => S.docks[S.docks.length - 1] || null;
const width = () => S.split ? S.split.clientWidth : 0;

function ready() {
  if (S.split) return true;
  const canvas = document.getElementById('canvas');
  if (!canvas) return false;
  const top = canvas.scrollTop, left = canvas.scrollLeft;   // 挪稿子会丢滚到哪：记下来放回去
  S.split = document.createElement('div'); S.split.className = 'rf-split';
  canvas.before(S.split); S.split.append(canvas);
  canvas.scrollTop = top; canvas.scrollLeft = left;
  new ResizeObserver(() => layout()).observe(S.split);
  return true;
}
function paintSwap(b, m) {
  if (!m || b.dataset.m === m) return;
  b.dataset.m = m; b.title = SWAP[m][1]; b.setAttribute('aria-label', SWAP[m][1]);
  b.replaceChildren(window.UI.icon(SWAP[m][0], 'rf-ic'));
}
function layout() {
  const sp = S.split;
  if (!sp) return;
  const t = topDock(), w = sp.clientWidth, m = t ? modeFor(t.opt.st, w) : '';
  sp.classList.toggle('side', m === 'side'); sp.classList.toggle('bottom', m === 'bottom'); sp.classList.toggle('fold', !!t && !!(t.opt.fold && t.opt.fold()));
  if (t) sp.style.setProperty('--rf-size', Math.round((m === 'side' ? t.opt.st.side : t.opt.st.bottom) * 1000) / 10 + '%');
  for (const d of S.docks) {
    const on = d === t;
    d.el.classList.toggle('rf-under', !on); d.grip.classList.toggle('rf-under', !on);
    for (const b of d.el.querySelectorAll('.rf-swap')) paintSwap(b, modeFor(d.opt.st, w));
    if (d.opt.onLayout) d.opt.onLayout(on ? m : '');
  }
  for (const fn of HOOKS) fn();
}
function grip(d) {
  const g = document.createElement('div');
  g.className = 'rf-grip'; g.title = '拖动改宽窄'; g.setAttribute('role', 'separator');
  g.addEventListener('pointerdown', ev => {
    ev.preventDefault(); g.setPointerCapture(ev.pointerId);
    const box = S.split.getBoundingClientRect(), m = modeFor(d.opt.st, S.split.clientWidth);
    const move = e => { d.opt.st[m] = sizeAt(m, box, e.clientX, e.clientY); layout(); };
    const up = () => { g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', up); if (d.opt.save) d.opt.save(); };
    g.addEventListener('pointermove', move); g.addEventListener('pointerup', up);
  });
  return g;
}
/* 稿子里刚点的那一处（按住 Ctrl 点 @图片N 看图）：摆到下面、稿子变矮时别把它挤到看不见，往上挪到露出来 */
let CLICK = null;
document.addEventListener('pointerdown', e => { const c = document.getElementById('canvas'); CLICK = c && c.contains(e.target) ? { y: e.clientY, t: Date.now() } : null; }, true);
function keepClick() {
  const canvas = document.getElementById('canvas'), k = CLICK;
  CLICK = null;
  if (!k || Date.now() - k.t > 2000 || !canvas || !S.split.classList.contains('bottom')) return;
  const edge = canvas.getBoundingClientRect().bottom - 60;
  if (k.y > edge) canvas.scrollTop += k.y - edge;
}
function put(key, el, opt) {
  if (!ready()) return false;
  const d = find(key);
  if (d) {
    if (d.el !== el) d.el.replaceWith(el);
    d.el = el; if (opt) d.opt = opt;
  } else {
    const n = { key, el, grip: null, opt: opt || { st: { mode: 'auto', side: 0.42, bottom: 0.42 } } };
    n.grip = grip(n);
    S.split.append(n.grip, el);
    S.docks.push(n);
  }
  layout();
  if (!d) keepClick();
  return true;
}
function raise(key) {
  const d = find(key);
  if (!d || d === topDock()) return;
  S.docks.splice(S.docks.indexOf(d), 1); S.docks.push(d);
  layout(); keepClick();
}
function drop(key) {
  const d = find(key);
  if (!d) return;
  d.grip.remove(); d.el.remove();
  S.docks.splice(S.docks.indexOf(d), 1);
  layout();
}
function mode(key) { const d = find(key); return d ? modeFor(d.opt.st, width()) : ''; }
function swapBtn(key, st) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'rf-ib rf-swap';
  b.addEventListener('mousedown', e => e.preventDefault());   // 点了稿子里的光标别跑
  b.addEventListener('click', () => {
    const d = find(key);
    if (!d) return;
    d.opt.st.mode = modeFor(d.opt.st, width()) === 'side' ? 'bottom' : 'side';
    if (d.opt.save) d.opt.save();
    layout();
  });
  paintSwap(b, modeFor(st, width()));
  return b;
}
ready();   // 页面一打开就把稿子包好：等写着字再挪，光标会丢
window.SideDock = { put, raise, drop, has: key => !!find(key), top: () => (topDock() || {}).key || '', mode, swapBtn, ready, layout, onLayout: fn => { HOOKS.push(fn); }, modeFor, sizeAt };
})();
