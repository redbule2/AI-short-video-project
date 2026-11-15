/* 白模＋关键帧的写法（2026-11-14 用户定：和普通提示词分开，照官方《Doubao Seedance 2.5 提示词指南》里「粗粒度白模 + 阶段关键帧」的例子）。
   一条提示词同时挂了白模视频（@视频N）和关键帧（@图片N），就用这一套，不用 sd25-pe 的关键帧锚点句（「以…的顺序作为关键帧」「@图片N作为首帧」），
   也不用「@视频N是粗粒度白模参考……」那一句：
   素材里四句（写法一放【参考素材职责】最前面；写法二关键帧那句放【场景】最前面，白模那几句放【动作与声音】最前面）：
     以@视频1作为整支视频唯一的运镜……参考，严格保持@视频1的镜头顺序、切点……不新增镜头。
     @视频1中的〔哪个白模几何体〕对应〔哪个人物或道具〕。（已经写了「@视频1中的……」「@视频1里……」的不补）
     @图片1至@图片5是各镜头的关键帧……每一镜参考哪一张，写在事件脚本那一镜的开头。
     所有画面照对应的关键帧；@视频1只作运镜、镜头运动和动作参考，不采用它的灰模外观、材质和空白背景。
   事件脚本：每一镜开头写这一镜在白模里的整数秒和参考哪张（官方 2.5 认整数秒，2.0 只认镜头号）：
     镜头1：0-4秒，首帧参考@图片1。……　后面的镜头写「开场参考」，名字带尾帧的写「结尾参考」，别的写「参考」。
   秒数照白模的切点：白模一律整秒切（11-14 用户定），切点写在白模旁边的「_说明.md」里，一镜一行「镜头1：0-4秒」；
     没有说明就留〔起〕〔止〕给人填（生成任务书时还有〔〕就拦下）。关键帧按名字里的镜头号对，对不上的按先后。
   不加圆括号：sd25-pe 里圆括号是音乐的记号。 */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./关键帧写法.js') : root.KeyFrames);
  if (node) module.exports = api;
  else root.BmKey = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (KeyFrames) {
  'use strict';
  const T = s => String(s == null ? '' : s).trim();
  const headKey = l => String(l == null ? '' : l).replace(/\s+/g, '');
  const isHead = l => /^【[^】]+】$/.test(headKey(l));
  const REF_HEAD = /^【(参考素材职责|人物|道具|场景|动作与声音|未采用素材|主体设定[：:][^】]*)】$/;
  const AFTER_REFS = /^【(主体与关系|事件脚本|保持一致)】$/;

  /* ---------- 素材里的四句 ---------- */
  const span = refs => {
    if (typeof refs === 'string') return refs;
    const n = refs.map(r => +String(r).replace(/\D+/g, ''));
    return refs.length > 1 && n.every((x, i) => !i || x === n[i - 1] + 1) ? refs[0] + '至' + refs[refs.length - 1] : refs.join('、');
  };
  const LEAD = v => '以' + v + '作为整支视频唯一的运镜、镜头节奏、景别变化、主体运动轨迹和镜头调度参考，严格保持' + v + '的镜头顺序、切点、机位变化、运动方式和节奏，不改变镜头结构，不新增镜头。';
  const MAP = v => v + '中的〔哪个白模几何体〕对应〔哪个人物或道具〕。';
  const GROUP = refs => span(refs) + '是各镜头的关键帧，分别约束对应那一镜的构图、人物造型、环境和色彩；每一镜参考哪一张，写在事件脚本那一镜的开头。';
  const END = v => '所有画面照对应的关键帧；' + v + '只作运镜、镜头运动和动作参考，不采用它的灰模外观、材质和空白背景。';
  const RE_LEAD = /^以@视频\d+作为整支视频唯一的/, RE_END = /^所有画面照对应的关键帧[；;]/, RE_GROUP = /^@图片\d+(?:(?:至|、)@图片\d+)*是各镜头的关键帧/;
  const RE_ROLE = /^@视频\d+是(?:粗|细)?粒度?白模参考/;   // 普通写法里白模那一句（sd25-pe）
  const isOwn = l => RE_LEAD.test(T(l)) || RE_END.test(T(l)) || RE_GROUP.test(T(l));
  /* 一份稿是不是已经照这一套写了：素材里有白模那句或者关键帧那句 */
  const isBmk = lines => (Array.isArray(lines) ? lines : String(lines || '').split(/\r\n|\n|\r/)).some(l => RE_LEAD.test(T(l)) || RE_GROUP.test(T(l)));

  /* ---------- 每一镜开头：几秒到几秒、参考哪张 ---------- */
  const NUM = '(\\d+(?:\\.\\d+)?|〔[^〔〕]*〕)';
  const ONE = '(?:首帧|开场|结尾)?参考\\s*(?:@图片\\d+|〔[^〔〕]*〕)';
  const RE_TAG = new RegExp('^\\s*' + NUM + '\\s*[-－—–~～至到]\\s*' + NUM + '\\s*(?:秒|[sS])((?:\\s*[，,、]\\s*' + ONE + ')*)\\s*[。．.，,；;]?\\s*');
  function tagOf(body) {
    const m = RE_TAG.exec(String(body == null ? '' : body));
    if (!m) return null;
    const num = x => /^〔/.test(x) ? null : +x;
    return { a: num(m[1]), b: num(m[2]), refs: m[3].match(/@图片\d+/g) || [], len: m[0].length, text: m[0] };
  }
  const roleWord = (name, i) => /尾帧/.test(name || '') ? '结尾' : /首帧/.test(name || '') ? (i === 0 ? '首帧' : '开场') : '';
  /* p：{ cut: { a, b } 或 null, frames: [{ ref, name }] }；i：第几镜（0 起）；old：这一镜原来写的（没有切点时，原来填过的秒数照旧带上） */
  function makeTag(p, i, old) {
    const a = p && p.cut ? p.cut.a : old && old.a != null ? old.a : '〔起〕', b = p && p.cut ? p.cut.b : old && old.b != null ? old.b : '〔止〕';
    const fr = ((p && p.frames) || []).map(f => roleWord(f.name, i) + '参考' + f.ref);
    return a + '-' + b + '秒' + (fr.length ? '，' + fr.join('、') : '') + '。';
  }
  /* 白模说明里的切点：一镜一行「镜头1：0-4秒」（「镜头1 0-4秒」「镜头1｜0-4秒」也认） */
  function cutsOf(md) {
    const out = [];
    for (const line of String(md || '').split(/\r\n|\n|\r/)) {
      const m = /镜头\s*0*([0-9]+)\s*[：:｜|]?\s*(\d+(?:\.\d+)?)\s*[-－—–~～至到]\s*(\d+(?:\.\d+)?)\s*秒/.exec(line);
      if (m && !out.some(c => c.no === +m[1])) out.push({ no: +m[1], a: +m[2], b: +m[3] });
    }
    return out.sort((x, y) => x.a - y.a || x.no - y.no);
  }
  /* 哪一镜对哪段秒数、哪几张关键帧：有切点就一镜一段，关键帧按名字里的镜头号对（一个号都对不上的按先后）；没有切点，一张关键帧一镜 */
  function plan(cuts, frames) {
    const fr = KeyFrames.order((frames || []).slice());
    if (!cuts || !cuts.length) return fr.map(f => ({ cut: null, frames: [f] }));
    const out = cuts.map(c => ({ cut: c, frames: [] }));
    let hit = 0;
    for (const f of fr) { const n = KeyFrames.noOf(f.name), p = n != null ? out.find(x => x.cut.no === n) : null; if (p) { p.frames.push(f); hit++; } }
    if (!hit) { fr.forEach((f, i) => { if (out[i]) out[i].frames.push(f); }); return out; }
    const rest = fr.filter(f => KeyFrames.noOf(f.name) == null);
    for (const p of out) if (!p.frames.length && rest.length) p.frames.push(rest.shift());
    return out;
  }

  /* 挑关键帧时每张旁边写的：对上第几镜、几秒，这一镜开头写首帧／开场／结尾；对不上白模哪一镜的不写进事件脚本 */
  function labelOf(cuts, frames, i) {
    const p = plan(cuts, frames), k = p.findIndex(x => x.frames.includes(frames[i]));
    if (k < 0) return '白模里没有这一镜，不写进事件脚本';
    const w = roleWord(frames[i].name, k);
    return '镜头' + (k + 1) + (p[k].cut ? ' · ' + p[k].cut.a + '-' + p[k].cut.b + '秒' : '') + (w ? ' · ' + w : '');
  }

  /* ---------- 整份稿里找段：素材那几组、事件脚本里一镜一行 ---------- */
  const RE_SHOT = /^(\s*镜头\s*)([0-9０-９]+)(\s*[：:]\s*)(.*)$/;
  const toNo = s => +String(s).replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xFF10));
  function refsRange(L) {   // [起, 止)：从第一个素材组名起，到【主体与关系】【事件脚本】【保持一致】之前；没有素材组就是这几段前面的一个空位置
    const a = L.findIndex(l => REF_HEAD.test(headKey(l)));
    const next = from => { const k = L.findIndex((l, i) => i >= from && AFTER_REFS.test(headKey(l))); return k < 0 ? L.length : k; };
    if (a >= 0) return [a, next(a)];
    const z = next(0);
    return [z, z];
  }
  function shotRange(L) {
    const s = L.findIndex(l => headKey(l) === '【事件脚本】');
    if (s < 0) return null;
    let e = L.findIndex((l, i) => i > s && isHead(l));
    if (e < 0) e = L.length;
    return [s, e];
  }
  /* 一组的最前面插几句；没有这一组就在 before 里最先出现的那一组前面补上组名（gap：整份稿里组和组之间空一行） */
  function putFront(L, head, add, before, gap) {
    if (!add.length) return L;
    const g = L.findIndex(l => headKey(l) === head);
    if (g >= 0) { L.splice(g + 1, 0, ...add); return L; }
    let k = L.findIndex(l => before.includes(headKey(l)));
    if (k < 0) { k = L.length; while (gap && k > 0 && !T(L[k - 1])) k--; }
    const block = [head, ...add];
    if (gap && k > 0 && T(L[k - 1])) block.unshift('');
    if (gap && k < L.length && T(L[k])) block.push('');   // 后面紧跟着的是空行就不再补
    L.splice(k, 0, ...block);
    return L;
  }
  /* 一组的最后面补几句（这一组没有就和 putFront 一样新建） */
  function putBack(L, head, add, before, gap) {
    if (!add.length) return L;
    const g = L.findIndex(l => headKey(l) === head);
    if (g < 0) return putFront(L, head, add, before, gap);
    let e = L.findIndex((l, i) => i > g && isHead(l));
    if (e < 0) e = L.length;
    while (e > g + 1 && !T(L[e - 1])) e--;
    L.splice(e, 0, ...add);
    return L;
  }
  /* 删空了的组（原来有句子、这回一句不剩）连组名一起拿掉 */
  function dropEmpty(L, had) {
    for (let i = L.length - 1; i >= 0; i--) {
      const k = headKey(L[i]);
      if (!had.has(k)) continue;
      const n = L[i + 1];
      if (n === undefined || !T(n) || isHead(n)) L.splice(i, n !== undefined && !T(n) && i > 0 && !T(L[i - 1]) ? 2 : 1);
    }
    return L;
  }
  const filled = L => new Set(L.map((l, i) => isHead(l) && L[i + 1] !== undefined && T(L[i + 1]) && !isHead(L[i + 1]) ? headKey(l) : '').filter(Boolean));

  /* 素材那几行（整份稿里的一段，或者写稿页素材区的几行）换成这一套：原来的关键帧锚点句、白模那一句、这一套的旧句子拿掉，照现在挂的重写。
     o：{ vid: '@视频1', frames: [{ ref, name }], two：写法二（不给就看有没有【人物】【道具】【场景】【动作与声音】）, gap } */
  function refsLines(lines, o) {
    const L = lines.slice(), sc = KeyFrames.scan(L), drop = new Set(sc.rows.keys()), v = o.vid;
    const isMap = l => !!v && (T(l).startsWith(v + '中的') || T(l).startsWith(v + '里'));   // 白模里哪个是谁（人填过的），挪到白模那句后面
    L.forEach((l, i) => { if (isOwn(l) || (v && RE_ROLE.test(T(l)) && T(l).startsWith(v + '是'))) drop.add(i); });
    const had = filled(L), removed = [], maps = [];
    let out = L.filter((l, i) => { if (drop.has(i)) { removed.push(T(l)); return false; } if (isMap(l)) { maps.push(l); return false; } return true; });
    const refs = KeyFrames.order((o.frames || []).slice()).map(f => f.ref);
    const bm = v ? [LEAD(v), ...(maps.length ? maps : [MAP(v)])] : [], kf = refs.length ? [GROUP(refs)] : [], end = v && refs.length ? [END(v)] : [];
    const two = o.two != null ? !!o.two : out.some(l => /^【(人物|道具|场景|动作与声音)】$/.test(headKey(l)));
    if (two) {
      putFront(out, '【场景】', kf, ['【动作与声音】', '【未采用素材】'], o.gap);
      putFront(out, '【动作与声音】', bm, ['【未采用素材】'], o.gap);
      putBack(out, '【动作与声音】', end, ['【未采用素材】'], o.gap);
    } else {
      putFront(out, '【参考素材职责】', [...bm, ...kf], ['【未采用素材】'], o.gap);
      putBack(out, '【参考素材职责】', end, ['【未采用素材】'], o.gap);
    }
    out = dropEmpty(out, had);
    const now = new Set(out.map(T));
    return { lines: out, removed: removed.filter(l => l && !now.has(l)) };
  }
  /* 事件脚本里一镜一行「镜头N：……」：开头写上秒数和参考哪张（原来写过的换掉）；白模的镜头比稿子多，后面补上空镜头 */
  function tagShots(L, pl, secs) {
    let r = shotRange(L);
    if (!r) { const k = L.findIndex(l => headKey(l) === '【保持一致】'); const at = k < 0 ? L.length : k; L.splice(at, 0, ...(at && T(L[at - 1]) ? [''] : []), '【事件脚本】', ...(at < L.length ? [''] : [])); r = shotRange(L); }
    const [s, e] = r, idx = [];
    for (let i = s + 1; i < e; i++) if (RE_SHOT.test(L[i])) idx.push(i);
    idx.forEach((i, k) => {
      const m = RE_SHOT.exec(L[i]), t = tagOf(m[4]), rest = t ? m[4].slice(t.len) : m[4];
      L[i] = m[1] + m[2] + (T(m[3]) ? m[3] : '：') + makeTag(pl[k] || null, k, t || (secs && secs[k]) || null) + rest;
    });
    if (pl.length > idx.length) {
      let at = idx.length ? idx[idx.length - 1] + 1 : s + 1;
      while (at < e && T(L[at]) && !RE_SHOT.test(L[at]) && !/^(最终画面|声音包括)/.test(T(L[at]))) at++;   // 上一镜接着写的几行跟着它
      const last = idx.length ? toNo(RE_SHOT.exec(L[idx[idx.length - 1]])[2]) : 0;
      L.splice(at, 0, ...pl.slice(idx.length).map((p, k) => '镜头' + (last + k + 1) + '：' + makeTag(p, idx.length + k, null)));
    }
    return idx.length;
  }
  const splitText = text => String(text == null ? '' : text).split(/\r\n|\n|\r/);
  const eolOf = text => /\r\n/.test(text) ? '\r\n' : '\n';
  /* 整份稿换成这一套。o：{ vid, frames: [{ ref, name }], cuts: cutsOf(白模说明), secs: bare() 记下的每一镜原来的秒数, two } */
  function toBmk(text, o) {
    const L = splitText(text), [a, z] = refsRange(L);
    const r = refsLines(L.slice(a, z), { ...o, gap: true });
    const block = r.lines.slice();
    if (block.length && z < L.length && T(block[block.length - 1])) block.push('');
    if (block.length && a > 0 && T(L[a - 1]) && T(block[0])) block.unshift('');
    L.splice(a, z - a, ...block);
    const n = tagShots(L, plan(o.cuts || [], o.frames || []), o.secs);
    return { text: L.join(eolOf(text)), removed: r.removed, shots: n };
  }
  /* 拿掉这一套的句子（白模那句、关键帧那句、收尾那句）和每一镜开头的秒数、参考哪张，剩下普通写法的样子。
     secs：每一镜原来写的秒数（重排关键帧以后照旧带上）；removed：拿掉的句子 */
  function bare(text) {
    const L = splitText(text), had = filled(L), removed = [], secs = [];
    let out = L.filter(l => { if (!isOwn(l)) return true; removed.push(T(l)); return false; });
    const r = shotRange(out);
    if (r) for (let i = r[0] + 1; i < r[1]; i++) {
      const m = RE_SHOT.exec(out[i]);
      if (!m) continue;
      const t = tagOf(m[4]);
      secs.push(t ? { a: t.a, b: t.b } : null);
      if (t) out[i] = m[1] + m[2] + m[3] + m[4].slice(t.len);
    }
    out = dropEmpty(out, had);
    return { text: out.join(eolOf(text)), removed, secs, shots: secs.filter(Boolean).length };
  }
  /* 从这一套换回普通写法：bare 以后，o.frames（还挂着的关键帧）照 sd25-pe 写回锚点句，o.bmLines（要写回的白模句子）写回去 */
  function fromBmk(text, o = {}) {
    const b = bare(text), removed = b.removed, n = b.shots;
    let out = splitText(b.text);
    const had = filled(out), [a, z] = refsRange(out), seg = out.slice(a, z);
    const two = seg.some(l => /^【(人物|道具|场景|动作与声音)】$/.test(headKey(l)));
    const fl = o.frames && o.frames.length ? KeyFrames.lines(KeyFrames.order(o.frames.slice())) : [];
    if (two) { putFront(seg, '【场景】', fl, ['【动作与声音】', '【未采用素材】'], true); putFront(seg, '【动作与声音】', o.bmLines || [], ['【未采用素材】'], true); }
    else putFront(seg, '【参考素材职责】', [...fl, ...(o.bmLines || [])], ['【未采用素材】'], true);
    out.splice(a, z - a, ...seg);
    out = dropEmpty(out, had);
    return { text: out.join(eolOf(text)), removed, shots: n };
  }

  /* ---------- 校对：每一镜开头的秒数（写稿页、生成任务书都用） ---------- */
  function shots(text) {   // 事件脚本里的一镜一行：[{ no, body }]
    const L = splitText(text), r = shotRange(L), out = [];
    if (r) for (let i = r[0] + 1; i < r[1]; i++) { const m = RE_SHOT.exec(L[i]); if (m) out.push({ no: toNo(m[2]), body: m[4] }); }
    return out;
  }
  /* list：shots() 的结果（或者一镜一段正文）；total：白模多长（秒，不知道就 0）；cuts：白模说明里的切点（没有就不比）。返回 [{ i, msg }] */
  function check(list, total, cuts) {
    const out = [], one = (x, i) => typeof x === 'string' ? { no: i + 1, body: x } : x;
    let prev = 0, ok = true;
    list.map(one).forEach((x, i) => {
      const t = tagOf(x.body), no = '镜头' + x.no, c = cuts && cuts.length === list.length ? cuts[i] : null;
      if (!t) { out.push({ i, msg: no + '开头没写它在白模里是几秒到几秒、参考哪张关键帧（如「0-4秒，首帧参考@图片1。」）' }); ok = false; prev = null; return; }
      if (t.a == null || t.b == null) { out.push({ i, msg: no + '的秒数还没填' }); ok = false; prev = null; return; }
      if (!Number.isInteger(t.a) || !Number.isInteger(t.b)) { out.push({ i, msg: no + '写的是 ' + t.a + '-' + t.b + ' 秒：只写整秒（官方 2.5 认整数秒，白模也在整秒切）' }); ok = false; }
      else if (t.b <= t.a) { out.push({ i, msg: no + '的 ' + t.a + '-' + t.b + ' 秒起止不对' }); ok = false; }
      else if (prev != null && t.a !== prev) { out.push({ i, msg: no + '从第 ' + t.a + ' 秒起，上一镜到第 ' + prev + ' 秒，接不上' }); ok = false; }
      else if (c && (c.a !== t.a || c.b !== t.b)) { out.push({ i, msg: no + '写的是 ' + t.a + '-' + t.b + ' 秒，白模说明里是 ' + c.a + '-' + c.b + ' 秒' }); ok = false; }
      prev = t.b;
    });
    if (cuts && cuts.length && cuts.length !== list.length) out.push({ i: Math.max(0, list.length - 1), msg: '白模说明里有 ' + cuts.length + ' 个镜头，事件脚本写了 ' + list.length + ' 镜：要和白模一样' });
    else if (ok && list.length && total > 0 && Math.abs(prev - total) > 0.6) out.push({ i: list.length - 1, msg: '最后一镜到第 ' + prev + ' 秒，白模是 ' + (Math.round(total * 10) / 10) + ' 秒：镜头和秒数要和白模一样' });
    return out;
  }

  return Object.freeze({ LEAD, MAP, GROUP, END, isBmk, isOwn, tagOf, makeTag, cutsOf, plan, labelOf, refsLines, toBmk, bare, fromBmk, shots, check, RE_ROLE });
});
