/* 素材编号（2026-11-15 加）：即梦照挂的先后编号认 @图片1、@图片2……，缺一个号，后面的就全对错了。
   正文里不再写的号（比如在写稿页删了「开场参考@图片9」），去掉它，后面的往前挪；登记（参考素材映射、写稿记录的挂图）跟着挪。
   只认正文里明写的编号，和出片任务书一样：「@图片6至@图片10」中间的号不算写了。
   白模（@视频N）不替人去掉：登记了、正文里没写，交给本机服务那一条拦下，由人定去不去。
   流水线「提示词」那一步生成任务书以前用：先摆给人看去掉哪几张、怎么挪，点了才挪。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RefNo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const TYPES = ['图片', '视频', '音频'];
  const IS_REF = /^@(图片|视频|音频)\d+$/;
  const clean = p => String(p == null ? '' : p).replace(/\\/g, '/');
  const typeOf = ref => (/^@(图片|视频|音频)/.exec(String(ref)) || [])[1] || '';
  const noOf = ref => +String(ref).replace(/^@(图片|视频|音频)/, '');
  /* 正文里明写了哪些号：{ 图片: [1, 2, …], 视频: […], 音频: […] }（排好、不重复） */
  function usedOf(text) {
    const out = { 图片: new Set(), 视频: new Set(), 音频: new Set() };
    for (const m of String(text == null ? '' : text).matchAll(/@(图片|视频|音频)(\d+)/g)) out[m[1]].add(+m[2]);
    return Object.fromEntries(TYPES.map(t => [t, [...out[t]].sort((a, b) => a - b)]));
  }
  /* text：提示词正文；regs：这份稿登记的素材 [{ ref, path }]（参考素材映射里的和挂图里的放在一起）；types：只管哪几种（不给就三种都管）。
     返回 { moves: Map(旧编号 → 新编号), dropped: [{ ref, path }]（空着的号上登记的、正文里不再写的）, blocked: 挪不了的原因（空就是能挪） }。
     编号本来就连着：moves 是空的 */
  function plan(text, regs, types = TYPES) {
    const used = usedOf(text), gapped = TYPES.filter(t => types.includes(t) && !used[t].every((n, i) => n === i + 1));
    const none = why => ({ moves: new Map(), dropped: [], blocked: why });
    if (!gapped.length) return none('');
    const reg = new Map();
    for (const r of regs || []) {
      if (!r || !IS_REF.test(r.ref) || !gapped.includes(typeOf(r.ref))) continue;   // 编号连着的那几种不管（登记对不对交给本机服务）
      const p = clean(r.path);
      if (reg.has(r.ref) && reg.get(r.ref) !== p) return none(r.ref + ' 在参考素材映射和写稿记录里登记的不是同一个文件');
      reg.set(r.ref, p);
    }
    const moves = new Map(), dropped = [];
    for (const t of gapped) {
      const u = used[t], max = u[u.length - 1];
      for (const [ref, p] of reg) {
        if (typeOf(ref) !== t || noOf(ref) >= max || u.includes(noOf(ref))) continue;
        if (t === '视频') return none('挂了白模 ' + ref + '，可是提示词里没写它的编号');
        dropped.push({ ref, path: p });
      }
      u.forEach((n, i) => { if (n !== i + 1) moves.set('@' + t + n, '@' + t + (i + 1)); });
    }
    for (const from of moves.keys()) if (!reg.has(from)) return none('提示词里写了 ' + from + '，可是没登记它是哪个文件');
    dropped.sort((a, b) => a.ref.localeCompare(b.ref, 'zh', { numeric: true }));
    return { moves, dropped, blocked: '' };
  }
  /* 照 plan 换正文里的编号，别的一个字不动 */
  const apply = (text, p) => p && p.moves.size ? String(text == null ? '' : text).replace(/@(图片|视频|音频)(\d+)/g, (m, t, d) => p.moves.get('@' + t + (+d)) || m) : String(text == null ? '' : text);
  /* 登记跟着挪：[{ ref, … }]（参考素材映射里一份稿的 references）换成新编号，空号上的去掉 */
  function regs(list, p) {
    const gone = new Set(p.dropped.map(r => r.ref));
    return (Array.isArray(list) ? list : []).filter(r => !(r && gone.has(r.ref))).map(r => r && p.moves.has(r.ref) ? { ...r, ref: p.moves.get(r.ref) } : r);
  }
  /* 挂图 { 编号: 文件 } 跟着挪。all：这份稿登记的全部 [{ ref, path }]：挪过的号都记进挂图，
     参考素材映射万一没跟着换，两处对不上，生成任务书会拦下，不会挂错图 */
  function hang(map, p, all) {
    const gone = new Set(p.dropped.map(r => r.ref)), out = {};
    for (const [ref, file] of Object.entries(map || {})) if (!gone.has(ref) && !p.moves.has(ref)) out[ref] = file;
    for (const [from, to] of p.moves) {
      const r = (all || []).find(x => x && x.ref === from), file = map && Object.prototype.hasOwnProperty.call(map, from) ? map[from] : r ? r.path : '';
      if (file) out[to] = clean(file);
    }
    return out;
  }
  /* 给人看的一句：去掉哪几张、怎么挪（nameOf：文件 → 叫法） */
  function say(p, nameOf = f => clean(f).split('/').pop().replace(/\.[^.]+$/, '')) {
    const mv = [...p.moves].map(([a, b]) => a + '→' + b.replace(/^@(图片|视频|音频)/, ''));
    return (p.dropped.length ? '提示词里不再用 ' + p.dropped.map(r => r.ref + '（' + nameOf(r.path) + '）').join('、') + '。' : '编号中间空着号。')
      + '即梦照挂的先后编号认图，后面的往前挪：' + mv.join('、') + '，挂的图跟着挪。';
  }
  return Object.freeze({ usedOf, plan, apply, regs, hang, say });
});
