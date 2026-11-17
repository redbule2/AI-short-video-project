/* 写稿页 AI 写的那几区（素材、基础设定、主体与关系、保持一致；老稿叫本段）里的一行。
   2026-11-16 他定：AI 铺底的字也能直接改，不是只能批注。
     点一行就改字，和你写的几区一样边写边存（这一回头一次存的时候，原稿先进历史记录）；
     每行右边一个「批注」小钮，批注照旧写在那一行下面，交给 AI 改。
     批注靠原文认行：一行改了，它的批注跟着挪到改后的原文上，不然 AI 拿到的原文在稿子里找不到；那一行删掉了，批注跟着去掉。
     照 GEO 放的那几行（老稿的总场景、分场景、轴线）也能改，头一回改的时候提醒一句：只改这一段，GEO 底稿和别的段不跟着改。
   这里只放不碰页面的规矩，node 里能测（通用工具/测试/写稿AI行_测试.cjs）；页面怎么摆在 项目管理_写稿试用.html。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AiLine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GEO_RE = /^(总场景|分场景|轴线)/;
  const isGeo = lab => GEO_RE.test(String(lab || ''));   // 这一行的标签是不是照 GEO 放的
  const GEO_TIP = '照项目的场景 GEO 放的，各段一字不差。在这里改只改这一段，GEO 底稿和别的段不跟着改；要各段一起换，点「批注」写给 AI。';
  const GEO_SAY = '这一行是照 GEO 放的：在这里改只改这一段，GEO 底稿和别的段不跟着改';
  const BTN_TIP = '写批注，交给 AI 改';
  /* 能写批注的：AI 写的、有字的行 */
  const notable = (ai, text) => !!ai && !!String(text || '').trim();

  /* 批注挪到改后的原文上。by：原文 → 批注。改后那句已经有批注（两行改成一样了）就接在后面。返回 'moved'、'merged' 或 '' */
  function moveNote(by, from, to) {
    if (!from || !to || from === to || !by.has(from)) return '';
    const note = by.get(from), had = by.get(to);
    by.delete(from);
    if (had && had !== note) { by.set(to, had + '；' + note); return 'merged'; }
    by.set(to, note);
    return 'moved';
  }

  /* 改过字以后对一遍：blocks 是 AI 写的那几区现在的每一行，各自 dataset.hk 记着它的批注认的是哪句原文；fullOf(行) 是这一行现在的原文。
     字改了：批注挪过去。删空了还没删行：先留着（接着打字还跟着走）。行没了、也没有哪一行是这句原文：批注去掉。返回动了几条 */
  function rekey(blocks, by, fullOf) {
    let n = 0;
    const keep = new Set();
    for (const blk of blocks) {
      const cur = fullOf(blk), hk = blk.dataset.hk;
      if (cur) keep.add(cur);
      if (!hk) continue;
      if (!cur) { keep.add(hk); continue; }
      if (cur === hk) continue;
      if (moveNote(by, hk, cur)) n++;
      if (by.has(cur)) blk.dataset.hk = cur; else delete blk.dataset.hk;
    }
    for (const k of [...by.keys()]) if (!keep.has(k)) { by.delete(k); n++; }
    return n;
  }

  return Object.freeze({ isGeo, GEO_TIP, GEO_SAY, BTN_TIP, notable, moveNote, rekey });
});
