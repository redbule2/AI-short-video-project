/* ============================================================
   两版文字对照（2026-11-14 加）：照修改方案改出来的「_改N」和上一版比，看改了哪几句。
   window.Diff.lines(a, b)：一行一行比，给 [{ t: '=', a }, { t: '-', a }, { t: '+', b }]
   window.Diff.view(a, b, h)：画成一块：没改的行收起来（改动前后各留两行），删的划掉、加的标绿；一行里只改了几个字的，只标那几个字
   h 是 window.UI.h（不同的页各自给）
   ============================================================ */
'use strict';
(function () {
  const split = t => String(t || '').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
  function lines(a, b) {
    const A = split(a), B = split(b), n = A.length, m = B.length;
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));   // 最长公共行
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: '=', a: A[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', a: A[i++] });
      else out.push({ t: '+', b: B[j++] });
    }
    while (i < n) out.push({ t: '-', a: A[i++] });
    while (j < m) out.push({ t: '+', b: B[j++] });
    return out;
  }
  /* 一行改成一行：前后一样的不标，只标中间改了的那几个字。@图片12 这种编号不从中间切开（切开了点不开，也看不出是哪张） */
  const REF = /@(?:图片|视频|音频)\s*[0-9]+/g;
  const spans = t => [...t.matchAll(REF)].map(m => [m.index, m.index + m[0].length]);
  function mid(x, y) {
    let p = 0;
    while (p < x.length && p < y.length && x[p] === y[p]) p++;
    let s = 0;
    while (s < x.length - p && s < y.length - p && x[x.length - 1 - s] === y[y.length - 1 - s]) s++;
    const X = spans(x), Y = spans(y);
    for (let moved = true; moved;) {
      moved = false;
      for (const [t, sp] of [[x, X], [y, Y]]) for (const [a, b] of sp) {
        if (a < p && p < b) { p = a; moved = true; }
        const e = t.length - s;
        if (a < e && e < b) { s = t.length - b; moved = true; }
      }
    }
    return { pre: x.slice(0, p), x: x.slice(p, x.length - s), y: y.slice(p, y.length - s), suf: x.slice(x.length - s) };
  }
  let styled = false;
  function style() {
    if (styled) return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = '.df{font-size:13.5px;line-height:1.8;border:1px solid rgba(214,202,182,.9);border-radius:8px;overflow:hidden;background:#fffdf8}'
      + '.df-l{padding:2px 10px 2px 26px;position:relative;white-space:pre-wrap;word-break:break-word}'
      + '.df-l::before{position:absolute;left:9px;top:2px;font:12px/1.8 ui-monospace,Consolas,monospace;color:#a39a8c}'
      + '.df-l.del{background:rgba(176,58,46,.07);color:#8c3a2e}.df-l.del::before{content:"−";color:#b03a2e}'
      + '.df-l.add{background:rgba(61,122,85,.09);color:#2f5f42}.df-l.add::before{content:"+";color:#3d7a55}'
      + '.df-l.same{color:#5d554a}.df-l del{background:rgba(176,58,46,.18);text-decoration:line-through;text-decoration-color:rgba(176,58,46,.6)}'
      + '.df-l ins{background:rgba(61,122,85,.22);text-decoration:none}'
      + '.df-gap{padding:1px 10px;font-size:12px;color:#a39a8c;background:rgba(240,234,224,.6);text-align:center}'
      + '.df-none{padding:10px;color:#8a8174}';
    document.head.append(el);
  }
  function view(a, b, h) {
    style();
    const ops = lines(a, b), box = h('div', { class: 'df' });
    if (!ops.some(o => o.t !== '=')) { box.append(h('div', { class: 'df-none' }, '两版一模一样。')); return box; }
    const near = new Set();   // 改动前后各留两行
    ops.forEach((o, k) => { if (o.t !== '=') for (let d = -2; d <= 2; d++) near.add(k + d); });
    let gap = 0;
    const flush = () => { if (gap) box.append(h('div', { class: 'df-gap' }, '…… ' + gap + ' 行没改 ……')); gap = 0; };
    for (let k = 0; k < ops.length; k++) {
      const o = ops[k];
      if (o.t === '=') {
        if (!near.has(k)) { if (o.a.trim()) gap++; continue; }
        flush();
        if (o.a.trim()) box.append(h('div', { class: 'df-l same' }, o.a));
        continue;
      }
      flush();
      const dels = [], adds = [];   // 连着的一串删、一串加
      while (k < ops.length && ops[k].t !== '=') { (ops[k].t === '-' ? dels : adds).push(ops[k]); k++; }
      k--;
      if (dels.length === adds.length) {   // 一行换一行：只标改了的那几个字
        dels.forEach((d, i) => {
          const r = mid(d.a, adds[i].b);
          box.append(h('div', { class: 'df-l del' }, r.pre, r.x ? h('del', null, r.x) : null, r.suf));
          box.append(h('div', { class: 'df-l add' }, r.pre, r.y ? h('ins', null, r.y) : null, r.suf));
        });
      } else {
        for (const d of dels) box.append(h('div', { class: 'df-l del' }, h('del', null, d.a)));
        for (const x of adds) box.append(h('div', { class: 'df-l add' }, h('ins', null, x.b)));
      }
    }
    flush();
    return box;
  }
  window.Diff = { lines, view };
})();
