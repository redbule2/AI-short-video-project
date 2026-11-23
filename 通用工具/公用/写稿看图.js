/* ============================================================
   写稿页 · 看图（window.WriteView）：大图、视频、声音摆在稿子旁边看，不盖住字。
   2026-11-22 他说：写提示词的时候看图不影响看字（原来点开放大是一层黑底，把整页盖住）。
   摆在稿子旁边那一格（公用/写稿旁窗.js）：宽的时候在右边、窄的时候在下面，中间那条拖宽窄，标题栏上换边；
     参考摆着的，图先盖在参考上，收起图参考回来。摆哪边、多宽多高记在这台电脑的浏览器里，和参考各记各的。
   一边看一边写：字照常点、照常改；点这边的钮光标不跑，「插入」放到光标停的地方。
   图点一下放到原尺寸（点哪儿放大哪儿），再点缩回；一组的 ‹ › 翻。光标不在字里时：左右键翻、Esc 收起、空格播放或暂停。
   open(items, i)：items 一样一个 { type: '图片' | '视频' | '音频', ref, name, sub, load() → Blob 或地址, own：给的地址是 blob、看完收回,
     info()：名字底下那行小字（不给就写 sub）, loaded(媒体)：读好以后, insert() }。close()、step(d)、isOpen()。
   这一页的 RefPic.show（公用/点图.js：参考里的图）也摆到这里。
   要先引 公用/界面.js、点图.js、写稿旁窗.js；样式在 公用/写稿看图.css（标题栏、小钮在 写稿旁窗.css）。
   ============================================================ */
(function () {
'use strict';
const { h } = window.UI;
const KEY = 'antou:write:view-dock';
const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 记不下就算了 */ } };
const ST = Object.assign({ mode: 'auto', side: 0.46, bottom: 0.46 }, lsGet(KEY, {}));   // 摆在哪（auto 照宽窄定）、占多宽多高
const save = () => lsSet(KEY, { mode: ST.mode, side: ST.side, bottom: ST.bottom });
const keepFocus = e => e.preventDefault();   // 点这边的钮，稿子里的光标别跑
const ib = (name, title, fn, cls) => h('button', { class: 'rf-ib' + (cls ? ' ' + cls : ''), type: 'button', title, 'aria-label': title, onmousedown: keepFocus, onclick: fn }, UI.icon(name, 'rf-ic'));
const editing = () => { const a = document.activeElement; return !!a && (a.isContentEditable || /^(TEXTAREA|INPUT|SELECT)$/.test(a.tagName)); };
let V = null;   // 开着的：{ el, stage, title, meta, nav, acts, items, i, turn, url, own, media }

function frame() {
  const f = { stage: h('div', { class: 'vw-stage' }), title: h('b'), meta: h('span'), nav: h('div', { class: 'vw-nav' }), acts: h('div', { class: 'vw-acts' }) };
  f.el = h('aside', { class: 'rf-dock vw rf-enter', 'aria-label': '看图', 'data-no-ref': '' },
    h('div', { class: 'rf-head' },
      h('div', { class: 'rf-id' }, h('span', { class: 'rf-badge vw-badge' }, '看图'), h('div', { class: 'rf-title' }, f.title, h('small', null, f.meta))),
      h('div', { class: 'rf-tools' }, f.nav, f.acts, SideDock.swapBtn('view', ST)),
      h('div', { class: 'rf-win' }, ib('x', '收起（Esc）', () => close(), 'x'))),
    f.stage);
  f.el.addEventListener('animationend', () => f.el.classList.remove('rf-enter'), { once: true });   // 翻回上面来时别再滑一回
  return f;
}
function paintTitle(v, cur) {
  v.title.replaceChildren(cur.ref ? h('span', { class: 'vw-ref' }, cur.ref) : '', cur.name || '');
  v.title.title = (cur.ref ? cur.ref + ' · ' : '') + (cur.name || '');
}
function free(v) { if (v.url && v.own) URL.revokeObjectURL(v.url); v.url = ''; v.own = false; }
function zoom(v, m, e) {   // 点一下放到原尺寸，点哪儿就放大哪儿；再点缩回
  const r = m.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height, z = v.stage.classList.toggle('zoom');
  m.title = z ? '点击缩回' : '点击放大到原尺寸';
  if (z) { const n = m.getBoundingClientRect(); v.stage.scrollLeft += n.left + fx * n.width - e.clientX; v.stage.scrollTop += n.top + fy * n.height - e.clientY; }
}
async function show() {
  const v = V, cur = v.items[v.i], mine = ++v.turn, now = () => mine === v.turn && V === v;
  v.media = null; v.stage.classList.remove('zoom'); v.stage.replaceChildren(); free(v);
  paintTitle(v, cur);
  v.meta.textContent = '正在打开 ' + (cur.sub || cur.name || '') + ' …';
  v.nav.replaceChildren(...(v.items.length > 1 ? [ib('chevL', '上一个（←）', () => step(-1)), h('span', { class: 'vw-n' }, (v.i + 1) + ' / ' + v.items.length), ib('chev', '下一个（→）', () => step(1))] : []));
  v.acts.replaceChildren();
  let src;
  try { src = await cur.load(); }
  catch (e) { if (now()) { v.meta.textContent = cur.sub || ''; v.stage.replaceChildren(h('p', { class: 'vw-err' }, '打不开：' + (e && e.message || e))); } return; }
  if (!now()) { if (cur.own && typeof src === 'string') URL.revokeObjectURL(src); return; }   // 等的时候换了一个、收起了
  if (src instanceof Blob) { v.url = URL.createObjectURL(src); v.own = true; } else { v.url = String(src); v.own = !!cur.own; }
  const info = () => { if (now()) v.meta.textContent = cur.info ? cur.info() : cur.sub || ''; };
  let m;
  if (cur.type === '音频') m = h('audio', { src: v.url, controls: true, autoplay: true });
  else if (cur.type === '视频') {
    m = h('video', { src: v.url, controls: true, autoplay: true, loop: true, playsinline: true, onloadedmetadata: e => { if (cur.loaded) cur.loaded(e.currentTarget); info(); } });
    v.acts.append(...[0.5, 1, 2].map(r => h('button', { class: 'rf-mini vw-rate' + (r === 1 ? ' on' : ''), type: 'button', 'data-rate': r, title: '播放速度', onmousedown: keepFocus,
      onclick: e => { m.playbackRate = r; for (const b of v.acts.querySelectorAll('[data-rate]')) b.classList.toggle('on', b === e.currentTarget); } }, r + '×')));
  } else {
    m = h('img', { src: v.url, alt: cur.name || '', title: '点击放大到原尺寸', onload: e => { if (cur.loaded) cur.loaded(e.currentTarget); info(); } });
    m.addEventListener('click', e => zoom(v, m, e));
  }
  if (cur.insert) v.acts.append(h('button', { class: 'rf-mini ink', type: 'button', title: '放到稿子里光标停的地方', onmousedown: keepFocus, onclick: () => { cur.insert(); paintTitle(v, cur); } }, '插入'));
  v.media = m; v.stage.append(m); info();
}
function open(items, i) {
  if (!items || !items.length || !SideDock.ready()) return false;
  if (!V) { V = Object.assign(frame(), { turn: 0, url: '', own: false, media: null }); SideDock.put('view', V.el, { st: ST, save }); }
  else SideDock.raise('view');
  V.items = items; V.i = Math.min(items.length - 1, Math.max(0, i | 0));
  show();
  return true;
}
function step(d) {
  if (!V || V.items.length < 2) return;
  V.i = (V.i + d + V.items.length) % V.items.length;
  show();
}
function close() {
  if (!V) return;
  const v = V; V = null; v.turn++;
  free(v);
  SideDock.drop('view');
}
document.addEventListener('keydown', e => {   // 光标不在字里、看图露着：Esc 收起，左右键翻，空格播放或暂停
  if (!V || e.defaultPrevented || e.isComposing || editing() || SideDock.top() !== 'view') return;
  const m = V.media, onMedia = !!m && document.activeElement === m;
  if (e.key === 'Escape') { e.preventDefault(); close(); }
  else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !onMedia && V.items.length > 1) { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
  else if (e.key === ' ' && m && m.play && !onMedia && !(e.target.closest && e.target.closest('button'))) { e.preventDefault(); if (m.paused) m.play(); else m.pause(); }
});
if (window.RefPic && RefPic.useViewer) RefPic.useViewer((src, title, sub) => open([{ type: '图片', name: title, sub, load: () => src, own: typeof src !== 'string' }], 0));
window.WriteView = { open, close, step, isOpen: () => !!V };
})();
