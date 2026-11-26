/* 关键帧绑定（2026-11-16 他定，流程图：通用工具/流水线/关键帧绑定_流程图.html）。页面（提炼、资产、提示词）和本机服务（交给 AI 的话）共用这一份。
   镜头号：镜头表每一镜一个固定的号，存在流水线.json 这一镜的「号」里。删一镜，后面的号不挪；中间加一镜，号是前一镜加 b、c（3b）；加在最后接着往后排。
     视频提示词的名字（1-5.txt）、关键帧的名字（镜头11_首帧）、交给 AI 的镜头表，都用这个号。1-5 是表里镜头1 到镜头5 那几行（中间删过、加过都照表）。
   绑定：每张关键帧绑在「镜头几 · 开头（首帧）／中间（关键帧）／结尾（尾帧）」上，存在这一场的「关键帧绑定」：图 → { 镜, 刻, 备选, 写什么 }。
     写什么：绑的时候那一镜写的什么。镜头表后来改了这一镜的字，就和它对不上，标「看一眼」。
     同一镜同一刻有几张：一张现用，别的备选（备选: true）。写提示词默认带现用的。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShotBind = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const str = v => typeof v === 'string' ? v.trim() : typeof v === 'number' && isFinite(v) ? String(v) : '';
  const NO_RE = /^(?:镜头)?\s*0*([0-9]+)([a-z]?)$/i;
  const parseNo = v => { const m = NO_RE.exec(str(v)); return m ? { n: +m[1], l: m[2].toLowerCase() } : null; };
  const normNo = v => { const p = parseNo(v); return p ? p.n + p.l : ''; };
  const letter = c => String.fromCharCode(c);

  /* 镜头表每一镜的号：有「号」的照它（重了的当没有）；没有的补上：后面还有带号的镜头（中间加的）是前一镜加 b、c，
     后面没有了（加在最后、整张表都没号）接着最大的号往后排，最前面加的是 0、0b。不改表，给号的列表 */
  function nosOf(paras) {
    const list = Array.isArray(paras) ? paras : [], used = new Set();
    const claim = list.map(x => { const n = normNo(x && x.号); return n && !used.has(n) ? (used.add(n), n) : ''; });
    let max = 0;
    for (const n of used) max = Math.max(max, parseNo(n).n);
    const after = (base, from) => { for (let c = from; c <= 122; c++) if (!used.has(base + letter(c))) return base + letter(c); return ''; };
    const out = [];
    for (let i = 0; i < list.length; i++) {
      let no = claim[i];
      if (!no) {
        const prev = out[i - 1] || '', later = claim.slice(i + 1).some(Boolean);
        if (!later) no = String(++max);
        else if (prev) { const p = parseNo(prev); no = after(p.n, p.l ? p.l.charCodeAt(0) + 1 : 98) || String(++max); }
        else no = used.has('0') ? after(0, 98) || String(++max) : '0';
        used.add(no);
      }
      out.push(no);
    }
    return out;
  }
  /* 把号写进表里（页面存之前、并进 AI 提炼的以后）：没有号的补上，有的不动 */
  function fillNos(paras) {
    const nos = nosOf(paras);
    (paras || []).forEach((x, i) => { if (x && typeof x === 'object') x.号 = nos[i]; });
    return paras;
  }
  /* 号的先后：先比数，再比字母（3 < 3b < 4） */
  const cmpNo = (x, y) => { const p = parseNo(x), q = parseNo(y); return p && q ? p.n - q.n || (p.l < q.l ? -1 : p.l > q.l ? 1 : 0) : 0; };
  /* 名字里的镜头号（1-5、1-3、5、9-11、3b）→ 这一条拍哪几镜：照表里的先后，a-b 是表里 a 到 b 那几行。给 { nos, missing（表里没有的号） }。
     a-b 有一头的镜头删掉了：照号往里收到还在的那一镜（镜头2 删了，2-3 拍镜头3），a 到 b 之间一镜都不剩才算没有（11-18：删了镜头，名字里带着它的稿照旧能用） */
  function expand(code, nos) {
    const out = [], missing = [];
    const inward = (lo, hi, first) => { const ok = nos.filter(n => cmpNo(n, lo) >= 0 && cmpNo(n, hi) <= 0).sort(cmpNo); return ok.length ? ok[first ? 0 : ok.length - 1] : ''; };
    for (const part of String(code || '').replace(/\.txt$/i, '').split('、').map(x => x.trim()).filter(Boolean)) {
      const ends = part.split('-'), a = normNo(ends[0]), b = ends.length > 1 ? normNo(ends[1]) : a;
      let i = nos.indexOf(a), j = nos.indexOf(b);
      if (a && b && a !== b && (i < 0 || j < 0)) {
        const up = cmpNo(a, b) <= 0, lo = up ? a : b, hi = up ? b : a;
        if (i < 0) i = nos.indexOf(inward(lo, hi, up));
        if (j < 0) j = nos.indexOf(inward(lo, hi, !up));
      }
      if (i < 0 || j < 0) { for (const [x, k] of [[a || ends[0], i], [b || ends[1], j]]) if (k < 0 && !missing.includes(x)) missing.push(x); continue; }
      for (let k = Math.min(i, j); k <= Math.max(i, j); k++) if (!out.includes(nos[k])) out.push(nos[k]);
    }
    return { nos: out.sort((x, y) => nos.indexOf(x) - nos.indexOf(y)), missing };
  }
  /* 一条提示词拍哪几镜：名字是镜头号的（code，核心.js 的 vpCode 认出来的）照表里认；老稿「镜头6-9_视频提示词.txt」照名字里的数认（那时的号就是数）；认不出给 null */
  function shotsOf(code, name, nos) {
    if (code) return expand(code, nos).nos;
    const k = /^(?:段落|镜头)\s*([0-9]+)(?:\s*[-－—–~～至到]\s*([0-9]+))?(?=_)/.exec(String(name || '').split('/').pop());
    if (!k) return null;
    const a = Math.min(+k[1], +(k[2] || k[1])), b = Math.max(+k[1], +(k[2] || k[1]));
    return nos.filter(n => { const v = parseInt(n, 10); return v >= a && v <= b; });
  }
  /* 勾了哪几镜 → 提示词的名字：照表里的先后，表里挨着的连成一段（1-3、5.txt；中间删过镜头10 的 9-11.txt）。没勾给 '' */
  function codeOf(picked, nos) {
    const idx = [...new Set((picked || []).map(normNo).map(n => nos.indexOf(n)).filter(i => i >= 0))].sort((a, b) => a - b), runs = [];
    for (const i of idx) { const r = runs[runs.length - 1]; if (r && i === r[1] + 1) r[1] = i; else runs.push([i, i]); }
    return runs.length ? runs.map(([a, b]) => a === b ? nos[a] : nos[a] + '-' + nos[b]).join('、') + '.txt' : '';
  }
  /* 两镜的字像不像（0～1）：写什么、作用里挨着的两个字重了多少。标点、镜N 不算（重新提炼的镜N 按排第几写，和号对不上） */
  const LIKE = 0.3;
  function grams(x) {
    const m = new Map();
    for (const t of [str(x && x.写什么), str(x && x.作用)]) {
      const c = [...t.replace(/镜(?:头)?\s*[0-9]+[a-z]?/gi, ' ').replace(/[\s\p{P}\p{S}]+/gu, ' ')];
      for (let i = 0; i + 1 < c.length; i++) if (c[i] !== ' ' && c[i + 1] !== ' ') m.set(c[i] + c[i + 1], (m.get(c[i] + c[i + 1]) || 0) + 1);
    }
    return m;
  }
  function alike(a, b) {
    const x = grams(a), y = grams(b);
    let same = 0, n = 0;
    for (const [g, v] of x) { n += v; same += Math.min(v, y.get(g) || 0); }
    for (const v of y.values()) n += v;
    return n ? 2 * same / n : 0;
  }
  /* AI 重新提炼、照批注改的镜头表并进来：原来的号尽量留着（提示词的名字、关键帧都认号）。先认字：字一样的拿原来那一镜的号；只改了作用、写什么一样的也是。
     剩下的照夹在哪两镜中间认：前后认出来的两镜之间，新的、原来的一样多，挨个对上（当它改了字）；不一样多（中间还删了、加了镜头），挑字最像的对上，不像的不对
     （11-18：删了一镜、又改了另一镜的字，改字的那一镜也留原号）。再剩下的不写号，存的时候补（中间的 3b、最后的接着排）。fresh：新的表（[{ 写什么, 作用 }]），old：原来的表 */
  function keepNos(fresh, old) {
    const olds = old || [], oldNos = nosOf(olds), key = x => str(x && x.写什么) + '　' + str(x && x.作用), taken = new Set();
    const res = fresh.map(() => ''), at = fresh.map(() => -1);   // at：对上的是原来的第几镜
    const take = (i, k) => { res[i] = oldNos[k]; at[i] = k; taken.add(k); };
    fresh.forEach((x, i) => { const k = olds.findIndex((o, j) => !taken.has(j) && key(o) === key(x)); if (k >= 0) take(i, k); });
    fresh.forEach((x, i) => { if (res[i] || !str(x && x.写什么)) return; const k = olds.findIndex((o, j) => !taken.has(j) && str(o && o.写什么) === str(x.写什么)); if (k >= 0) take(i, k); });   // 写什么一样、只改了作用（11-16 起作用改写法）：也是原来那一镜
    for (let i = 0; i < fresh.length; i++) {
      if (res[i]) continue;
      let e = i;
      while (e + 1 < fresh.length && !res[e + 1]) e++;
      const lo = i > 0 ? at[i - 1] : -1, hi = e + 1 < fresh.length ? at[e + 1] : olds.length, mine = [];
      for (let k = i; k <= e; k++) mine.push(k);
      const left = olds.map((o, j) => j).filter(j => !taken.has(j) && (lo >= hi || (j > lo && j < hi)));   // 前后两镜的先后翻过来了（AI 挪了镜头）：没对上的都算
      if (lo < hi && left.length === mine.length) mine.forEach((k, n) => take(k, left[n]));
      else {
        const pairs = [];
        for (const k of mine) for (const j of left) { const v = alike(fresh[k], olds[j]); if (v >= LIKE) pairs.push([v, k, j]); }
        pairs.sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2]);
        for (const [, k, j] of pairs) if (!res[k] && !taken.has(j)) take(k, j);
      }
      i = e;
    }
    fresh.forEach((x, i) => { if (res[i]) x.号 = res[i]; else delete x.号; });
    return fillNos(fresh);
  }
  /* AI 照抄来的号能不能直接用：都认得、不重；原来没有的得是照规矩新起的（带字母的 3b、比原来的都大、最前面的 0），删掉的号不许拿回来用。got：AI 写的号，oldNos：原来的表的号 */
  function nosOk(got, oldNos) {
    const max = Math.max(0, ...oldNos.map(n => (parseNo(n) || { n: 0 }).n));
    return got.length > 0 && got.every(Boolean) && new Set(got).size === got.length
      && got.every(n => { const p = parseNo(n); return oldNos.includes(n) || (!!p && (!!p.l || p.n > max || p.n === 0)); });
  }

  /* ---------- 关键帧绑定 ---------- */
  const MOMENTS = ['首帧', '关键帧', '尾帧'];   // 和「出关键帧…」里取哪一刻的三个一样：名字里也这么写（镜头11_首帧）
  const SAY = { 首帧: '开头', 关键帧: '中间', 尾帧: '结尾' };
  /* 关键帧的起名规矩：图名带「首帧」「关键帧」「尾帧」（镜头11_首帧、镜头11_首帧_雾）；「_候选」「_白模帧」结尾的是过程图，不算。
     给镜头挑关键帧那一栏只摆合规矩的图（2026-11-26 他要）。f：图的路径或名字，带不带后缀都行 */
  const isFrameName = f => { const n = String(f || '').split('/').pop().replace(/\.(png|jpe?g|webp|gif|avif)$/i, ''); return MOMENTS.some(m => n.includes(m)) && !/_(候选|白模帧)$/.test(n); };
  function normBind(b) {
    if (!b || typeof b !== 'object') return null;
    const 镜 = normNo(b.镜), 刻 = MOMENTS.includes(b.刻) ? b.刻 : '';
    return 镜 && 刻 ? { 镜, 刻, ...(b.备选 ? { 备选: true } : {}), 写什么: str(b.写什么) } : null;
  }
  /* 这一场的绑定：图 → { 镜, 刻, 备选, 写什么 }（读成能用的样子，不对的丢掉） */
  function bindsOf(s) {
    const o = s && s.关键帧绑定, out = {};
    if (o && typeof o === 'object' && !Array.isArray(o)) for (const [f, b] of Object.entries(o)) { const n = normBind(b); if (n && f) out[f] = n; }
    return out;
  }
  /* 照名字猜绑哪一镜哪一刻：镜头11_首帧.png → 镜头11 首帧；1-5_镜头3_尾帧 → 镜头3 尾帧。表里没有这个号、看不出哪一刻，给 null */
  function guess(file, nos) {
    const name = String(file).split('/').pop().replace(/\.[^.]+$/, '');
    const m = /(?:镜头|段落)\s*0*([0-9]+[a-z]?)(?![0-9a-z])/i.exec(name), 镜 = m ? normNo(m[1]) : '';
    const 刻 = /尾帧/.test(name) ? '尾帧' : /首帧/.test(name) ? '首帧' : /关键帧|中间/.test(name) ? '关键帧' : '';
    return 镜 && nos.includes(镜) && 刻 ? { 镜, 刻 } : null;
  }
  const rowOf = (paras, nos, no) => { const i = nos.indexOf(no); return i >= 0 ? paras[i] : null; };
  /* 这一镜现在写的字和绑的时候不一样了 */
  const staleOf = (b, paras, nos) => { const r = rowOf(paras, nos, b.镜); return !!r && !!b.写什么 && str(r.写什么) !== b.写什么; };
  /* 现用的：「镜|刻」→ 图。没标备选的那几张里，名字最短的现用（镜头11_首帧 比 镜头11_首帧_雾 先） */
  function currentOf(frames, binds, nos) {
    const out = new Map(), pick = new Map(), cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0);
    for (const f of frames) {
      const b = binds[f];
      if (!b || !nos.includes(b.镜)) continue;
      const k = b.镜 + '|' + b.刻, p = pick.get(k), rank = [b.备选 ? 1 : 0, f.split('/').pop().length, f];
      if (!p || cmp(rank, p) < 0) pick.set(k, rank);
    }
    for (const [k, r] of pick) out.set(k, r[2]);
    return out;
  }
  const isCurrent = (f, b, cur) => !!b && cur.get(b.镜 + '|' + b.刻) === f;
  /* 按镜头表摆：每一镜挂着哪几张（开头、中间、结尾，现用在前）；没绑的、绑的镜头删了的放 loose（带上照名字猜的） */
  function table(frames, paras, binds) {
    const nos = nosOf(paras), cur = currentOf(frames, binds, nos);
    const rows = nos.map((no, i) => ({ 号: no, 写什么: str(paras[i].写什么), 作用: str(paras[i].作用), 帧: [] })), loose = [];
    for (const f of frames) {
      const b = binds[f], i = b ? nos.indexOf(b.镜) : -1;
      if (i < 0) { loose.push({ file: f, gone: b ? b.镜 : '', guess: guess(f, nos) }); continue; }
      rows[i].帧.push({ file: f, 刻: b.刻, current: isCurrent(f, b, cur), stale: staleOf(b, paras, nos) });
    }
    for (const r of rows) r.帧.sort((a, b) => MOMENTS.indexOf(a.刻) - MOMENTS.indexOf(b.刻) || (b.current - a.current) || a.file.localeCompare(b.file, 'zh', { numeric: true }));
    return { nos, rows, loose };
  }
  /* 资产页一镜一张卡上的三格（开头、中间、结尾）：每一格现用的那张、备选的几张。row：table 给的一镜 */
  function slots(row) {
    const all = row && Array.isArray(row.帧) ? row.帧 : [], out = {};
    for (const m of MOMENTS) { const fs = all.filter(x => x.刻 === m), cur = fs.find(x => x.current) || fs[0] || null; out[m] = { cur, alts: fs.filter(x => x !== cur) }; }
    return out;
  }
  /* 一张一张看的先后（关键帧弹窗的上一张、下一张）：照镜头表，每一镜开头、中间、结尾，同一刻现用在前；没绑的放最后。t：table 给的 */
  const seq = t => [...t.rows.flatMap(r => r.帧.map(x => x.file)), ...t.loose.map(x => x.file)];
  /* 写提示词时带哪几张：shots（镜头号）里每一镜每一刻现用的那张，照表里先后、开头中间结尾排 */
  function forShots(shots, frames, paras, binds) {
    const nos = nosOf(paras), cur = currentOf(frames, binds, nos), out = [];
    for (const no of nos) if ((shots || []).map(normNo).includes(no)) for (const m of MOMENTS) { const f = cur.get(no + '|' + m); if (f) out.push(f); }
    return out;
  }
  /* 几张关键帧按绑定排先后：绑了的照镜头表、开头中间结尾；没绑的放后面，照原来的先后 */
  function order(files, paras, binds) {
    const nos = nosOf(paras), key = (f, i) => { const b = binds[f], k = b ? nos.indexOf(b.镜) : -1; return k >= 0 ? [k, MOMENTS.indexOf(b.刻), b.备选 ? 1 : 0, i] : [1e9, 0, 0, i]; };   // 同一镜同一刻：现用在前，备选在后
    return files.map((f, i) => ({ f, k: key(f, i) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.k[3] - b.k[3]).map(x => x.f);
  }
  /* 一张关键帧怎么说（页面上、交给 AI）：镜头11「外星战士喊冲锋」开头 */
  function say(b, paras) {
    if (!b) return '';
    const nos = nosOf(paras), r = rowOf(paras, nos, b.镜), w = r ? str(r.写什么) : '';
    return '镜头' + b.镜 + (w ? '「' + w + '」' : '') + SAY[b.刻] + (r ? '' : '（这一镜已经删了）');
  }
  /* 素材登记（参考素材映射.json）里它叫什么：关键帧｜镜头11｜开头 */
  const regName = b => b ? '关键帧｜镜头' + b.镜 + '｜' + SAY[b.刻] : '关键帧';
  /* 绑上：写进这一场的「关键帧绑定」，带上这一镜现在写的什么。同一镜同一刻已经有现用的，新绑的当备选（current：要它当现用） */
  function bind(s, file, no, 刻, paras, current) {
    const all = s.关键帧绑定 && typeof s.关键帧绑定 === 'object' && !Array.isArray(s.关键帧绑定) ? s.关键帧绑定 : (s.关键帧绑定 = {});
    const nos = nosOf(paras), r = rowOf(paras, nos, normNo(no));
    if (!r || !MOMENTS.includes(刻)) return false;
    const 镜 = normNo(no), same = Object.entries(all).filter(([f, b]) => f !== file && normBind(b) && normBind(b).镜 === 镜 && b.刻 === 刻);
    if (current) for (const [, b] of same) b.备选 = true;
    all[file] = { 镜, 刻, ...(!current && same.some(([, b]) => !b.备选) ? { 备选: true } : {}), 写什么: str(r.写什么) };
    return true;
  }
  /* 当现用：同一镜同一刻别的几张改成备选 */
  function setCurrent(s, file) {
    const all = s.关键帧绑定 || {}, b = all[file];
    if (!b) return;
    for (const [f, x] of Object.entries(all)) if (f !== file && x && x.镜 === b.镜 && x.刻 === b.刻) x.备选 = true;
    delete b.备选;
  }
  /* 这一镜改过字，看过了还对得上：记下现在的字 */
  function keep(s, file, paras) {
    const b = s.关键帧绑定 && s.关键帧绑定[file], nos = nosOf(paras), r = b ? rowOf(paras, nos, normNo(b.镜)) : null;
    if (b && r) b.写什么 = str(r.写什么);
  }
  function unbind(s, file) { if (s.关键帧绑定 && s.关键帧绑定[file]) { delete s.关键帧绑定[file]; if (!Object.keys(s.关键帧绑定).length) delete s.关键帧绑定; } }

  /* 出片前对一遍（2026-11-16 他定：只标红提醒，照样能出片）。
     hung：这一条挂着的关键帧 [{ ref, path }]；shots：这一条拍的镜头号（名字是镜头号的稿才有，老稿给 null）；text：提示词全文。给 [句子] */
  function check({ hung, shots, paras, binds, text }) {
    const nos = nosOf(paras), out = [], t = String(text || '');
    for (const r of hung || []) {
      const b = binds[r.path], i = b ? nos.indexOf(b.镜) : -1;
      if (!new RegExp(r.ref + '(?![0-9])').test(t)) out.push(r.ref + ' 挂着，提示词里没写到它');
      if (!b) { out.push(r.ref + ' 还没绑到镜头表的哪一镜（资产那一步「关键帧」一块里绑）'); continue; }
      if (i < 0) { out.push(r.ref + ' 绑的镜头' + b.镜 + ' 已经从镜头表里删了'); continue; }
      if (shots && !shots.includes(b.镜)) out.push(r.ref + ' 是镜头' + b.镜 + ' 的，这一条拍的是镜头' + shots.join('、'));
      if (staleOf(b, paras, nos)) out.push('镜头' + b.镜 + ' 的字改过，' + r.ref + ' 还对得上吗');
    }
    return out;
  }
  return Object.freeze({ normNo, nosOf, fillNos, expand, shotsOf, codeOf, keepNos, nosOk, MOMENTS, SAY, isFrameName, bindsOf, guess, currentOf, isCurrent, staleOf, table, slots, seq, forShots, order, say, regName, bind, setCurrent, keep, unbind, check });
});
