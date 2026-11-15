/* ============================================================
   等待的样子（2026-11-15 他要的：等 AI 做事时用，带点动画、好看、简单）
   一个转着的墨环（头上一颗圆点，后面拖一道渐淡的尾巴），旁边的字有一道光慢慢扫过。
   颜色、大小跟着所在的字走：字是什么颜色，环就是什么颜色；字多大，环就多大。
     <i class="wt-ring"></i>             只要墨环，摆在一行字前面
     <span class="wt-t">AI 在铺底</span>   字上扫光
     Wait.el('AI 在铺底')                一行：墨环＋扫光的字
     Wait.el('AI 在铺底', true)          大的：墨环在上、字在下，摆在一块地方的正中间
   样子只写在这一份里，页面引进来就有（流水线各页由 流水线.js 替它们引）。
   ============================================================ */
'use strict';
(function () {
  if (window.Wait) return;
  const CSS = `
.wt { display: inline-flex; align-items: center; gap: .55em; }
.wt-ring { --wt-w: 2px; position: relative; display: inline-block; flex: none; width: 1.1em; height: 1.1em; border-radius: 50%; vertical-align: -.18em;
  background: conic-gradient(from 0deg, transparent 0 14%, currentColor 100%) color-mix(in srgb, currentColor 13%, transparent);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - var(--wt-w) - .6px), #000 calc(100% - var(--wt-w)));
  mask: radial-gradient(farthest-side, transparent calc(100% - var(--wt-w) - .6px), #000 calc(100% - var(--wt-w)));
  animation: wt-spin .9s linear infinite; }
.wt-ring::after { content: ''; position: absolute; top: 0; left: 50%; width: var(--wt-w); height: var(--wt-w); margin-left: calc(var(--wt-w) / -2); border-radius: 50%; background: currentColor; }
.wt-t { background: linear-gradient(100deg, currentColor 38%, color-mix(in srgb, currentColor 42%, #fff) 50%, currentColor 62%) 0 0 / 260% 100%;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; animation: wt-shine 2.4s linear infinite; }
.wt-box { display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center; }
.wt-box > .wt-ring { --wt-w: 3px; font-size: 30px; }
.wt-box > .wt-t { margin: 0; }
@keyframes wt-spin { to { transform: rotate(1turn); } }
@keyframes wt-shine { from { background-position: 100% 0; } to { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) {
  .wt-ring { animation-duration: 2.6s; }
  .wt-t { animation: none; background: none; -webkit-text-fill-color: currentColor; }
}`;
  if (!document.getElementById('wt-style')) {
    const st = document.createElement('style');
    st.id = 'wt-style'; st.textContent = CSS;
    (document.head || document.documentElement).append(st);
  }
  function ring() {
    const i = document.createElement('i');
    i.className = 'wt-ring'; i.setAttribute('aria-hidden', 'true');
    return i;
  }
  function el(text, big) {
    const box = document.createElement(big ? 'div' : 'span'), t = document.createElement(big ? 'p' : 'span');
    box.className = big ? 'wt-box' : 'wt'; box.setAttribute('role', 'status');
    t.className = 'wt-t'; t.textContent = text || '';
    box.append(ring(), t);
    return box;
  }
  window.Wait = { ring, el };
})();
