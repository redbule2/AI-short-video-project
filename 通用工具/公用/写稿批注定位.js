/* 写稿页 · AI 批注（「请 AI 批」写回来的 _AI批注.md）说的那一句，现在在稿子哪儿；「照改」「撤回」就在那儿换字。
   2026-11-22 他问「这个批注为什么没有照改」：AI 把事件脚本最后「声音包括……」那一行的位置写成「镜头2」，页面只在镜头2 的框里找，
   找不到就说「这句原文你已经改过了」；其实那一行摆在「基础设定」里（写稿状态.js 的 look）。AI 写的几区（素材、基础设定、主体与关系、保持一致）也一直没有「照改」。
   现在：先找「位置」说的那一框，再找「位置」说的那一区，再全稿找（你写的框、AI 写的行都算）；全稿都没有，才算你改过了。
   你写的框照打字换（Ctrl+Z 撤得回）；AI 写的一行整行换上，和你自己改了这一行一样（左边换青线、边写边存、你写给 AI 的批注跟着挪）。
   pick、cut 不碰页面，node 里能测（通用工具/测试/写稿批注定位_测试.cjs）；别的用写稿页的 boxOf、fullOf、lineOf、toBlock、fill、typeInto、afterEdit、runsOf、rangeIn、SECS……，只在找、换的时候用 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NoteSpot = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  /* texts 里头一个有这句的：{ i, s, e }。at：上回在哪（撤回时用：同一句出现几回，认原来那一处） */
  function pick(texts, text, at) {
    if (!text) return null;
    for (let i = 0; i < texts.length; i++) {
      const v = String(texts[i] == null ? '' : texts[i]);
      const s = at != null && at >= 0 && v.substr(at, text.length) === text ? at : v.indexOf(text);
      if (s >= 0) return { i, s, e: s + text.length };
    }
    return null;
  }
  /* AI 写的一行换字：full 是这一行的原话（批注认的那种，老稿的保持一致带「保持一致：」），pre 是 full 开头不在这一行里的字；给换好的这一行（带标签） */
  function cut(full, pre, s, e, to) {
    const out = full.slice(0, s) + to + full.slice(e);
    return pre && out.startsWith(pre) ? out.slice(pre.length) : out;
  }

  /* ---------- 写稿页上 ---------- */
  const isTa = x => x.tagName === 'TEXTAREA';
  const textOf = x => isTa(x) ? x.value : fullOf(x);
  const secOf = where => SECS.filter(x => String(where || '').includes(x.name)).sort((a, b) => b.name.length - a.name.length)[0] || null;   // 「本段事件」也含「本段」：认长的
  /* 能找的地方，照这个先后：「位置」说的那一框 → 「位置」说的那一区 → 你写的全部框 → AI 写的全部行。整页老稿（自由模式整页存）不认 AI 那几区：存的时候不存它们 */
  function places(n) {
    const out = [], seen = new Set(), add = x => { if (x && !seen.has(x)) { seen.add(x); out.push(x); } };
    const blocks = MODE === '自由' && WHOLE ? [] : $$('#sheet section .blist > .blk'), sec = secOf(n.where);
    add(boxOf(n));
    if (sec) blocks.filter(b => b.dataset.sec === sec.key).forEach(add);
    $$('#sheet .wr-ta').forEach(add);
    blocks.forEach(add);
    return out;
  }
  /* AI 写的一行里这一句落在哪（标出来、跳过去用）：标签、「保持一致：」不在框里，去掉再找；跨过素材名牌的，标整行 */
  function rangeOf(blk, s, e) {
    const ed = $('.ed', blk), full = fullOf(blk), head = full.length - plain(ed).length, rest = full.slice(Math.max(s, head), e);
    for (const run of rest ? runsOf(ed) : []) { const i = run.t.indexOf(rest); if (i >= 0) return rangeIn(run, i, i + rest.length); }
    const r = new Range(); r.selectNodeContents(ed); return r;
  }
  /* 这条批注说的那一句（text 不给就是原文）现在在哪：{ ta, s, e }（你写的框）或 { blk, s, e, range }（AI 写的一行，s、e 在 fullOf 里）；哪儿都没有给 null */
  function find(n, text, at) {
    const t = text === undefined ? n.find : text;
    if (!t) return null;
    const list = places(n), hit = pick(list.map(textOf), t, at);
    if (!hit) return null;
    const x = list[hit.i];
    return isTa(x) ? { ta: x, s: hit.s, e: hit.e } : { blk: x, s: hit.s, e: hit.e, range: rangeOf(x, hit.s, hit.e) };
  }
  /* 换字。你写的框：照打字换；框在收着的那几区里（点不着光标）就直接换、照样算改了字。AI 写的一行：整行换上 */
  function put(sp, text) {
    if (sp.ta) {
      if (sp.ta.getClientRects().length) return typeInto(sp.ta, sp.s, sp.e, text);
      sp.ta.setRangeText(text, sp.s, sp.e, 'end'); sp.ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const blk = sp.blk, full = fullOf(blk), b = toBlock(cut(full, full.slice(0, full.length - lineOf(blk).length), sp.s, sp.e, text), blk.dataset.sec);
    let lab = $(':scope > .lab', blk);
    if (b.lab) { blk.dataset.lab = b.lab; if (!lab) blk.prepend(lab = h('span', { class: 'lab' })); lab.textContent = b.lab + '：'; }
    else { delete blk.dataset.lab; if (lab) lab.remove(); }
    fill($('.ed', blk), b.t);
    if (blk.classList.contains('ai')) blk.classList.add('mine');   // AI 写的这一行你改过了
    afterEdit();
  }
  /* 卡片挂的地方不是这一句所在的那一区（上面共用的几区平时收着）：说一声在哪，点卡片跳过去 */
  function away(sp, home) {
    const el = sp && (sp.ta || sp.blk), sec = el && el.closest('section[data-sec]');
    if (!sec || !home || home.contains(el)) return '';
    const s = SECS.find(x => x.key === sec.dataset.sec);
    return s ? '这句在「' + s.name + '」里，点一下卡片跳过去。' : '';
  }

  return Object.freeze({ pick, cut, find, put, away });
});
