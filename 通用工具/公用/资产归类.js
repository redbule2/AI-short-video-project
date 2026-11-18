/* 提炼出来的人物、场景、道具：全局的、只这一段用的（用在哪几镜），用不着的删掉（2026-11-17 他要）。
   全局：全片好几段都出场的。好几段都选了它就算；只写了一段的时候，AI 提炼时照梗概估，人在提炼页能改。
     记在流水线.json 顶上的「全局」：{ 人物: [名], 场景: [地方名], 道具: [名] }。
   用在哪几镜：镜头表每一镜的「人物」「场景」「道具」（名字；场景写地方名，冒号前那几个字，和「不出图」「不要GEO」记的一样；场景图写图名）。AI 提炼时标，人能改。全局的也标。
   删掉（他定：全片也删）：这一段不用它，镜头表里也去掉；别的段没用它的，全片设定里也删掉（人物、道具那一行，场景那一句），「全局」里也去掉。
     记在这一场的「删掉」：['人物|名', '场景|地方名', '道具|名']：不再提示「剧本里提到了」，AI 重新提炼也不再列。人又加回来的不算删掉。
   用到的：流水线 分场.html（提炼页「出场的」）、资产.html（卡上写全局、镜几，×）、流水线.js（并进 AI 提炼的、改名、提到了没选上的）、
     本机服务 jobs.js（交给 AI 的要求、写提示词时每一镜出场的）。
   测试：node 通用工具/测试/资产归类_测试.cjs */
(function (root, factory) {
  const node = typeof module === 'object' && !!module.exports;
  const api = factory(node ? require('./核心.js') : root.Core);
  if (node) module.exports = api;
  else root.AssetScope = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  const KINDS = Object.freeze(['人物', '场景', '道具']);
  const str = v => typeof v === 'string' ? v.trim() : '';
  const list = a => [...new Set((Array.isArray(a) ? a : typeof a === 'string' ? [a] : []).map(str).filter(Boolean))];
  const stem = f => str(f).replace(/\\/g, '/').split('/').pop().replace(/\.[^.]+$/, '');
  /* 场景那一句的地方名：「雪山：风雪漫天……」→ 雪山（核心.js 的 sceneStem）。人物、道具就是名字 */
  const place = t => (Core && Core.sceneStem ? Core.sceneStem(str(t)) : '') || str(t);
  const ref = (k, name) => k === '场景' ? place(name) : str(name);
  const keyOf = (k, name) => k + '|' + ref(k, name);
  const rowsOf = s => s && Array.isArray(s.段落) ? s.段落.filter(x => x && typeof x === 'object') : [];

  /* ---------- 用在哪几镜 ---------- */
  /* 一镜里出场的：{ 人物: [名], 场景: [地方名], 道具: [名] }，空的不写。AI 回的、页面存的都认 */
  function rowCast(x) {
    const out = {};
    for (const k of KINDS) { const a = [...new Set(list(x && x[k]).map(n => ref(k, n)).filter(Boolean))]; if (a.length) out[k] = a; }
    return out;
  }
  const inRow = (x, k, name) => list(x && x[k]).map(n => ref(k, n)).includes(ref(k, name));
  /* 这一段标过用在哪几镜没有（一镜都没标：老的提炼，还没分） */
  const marked = s => rowsOf(s).some(x => KINDS.some(k => list(x[k]).length));
  /* 这一样在这一段的哪几镜：给镜头号，照镜头表的先后。nos：各镜的号（关键帧绑定.js 的 nosOf） */
  const shotsOf = (s, nos, k, name) => rowsOf(s).map((x, i) => inRow(x, k, name) ? String(nos[i]) : '').filter(Boolean);
  /* 镜头号说成一句：连着三镜以上「镜10～14」，不然「镜8、9」。nos：这一段各镜的号（照先后） */
  function nosSay(got, nos) {
    const all = (nos || []).map(String), at = [...new Set((got || []).map(n => all.indexOf(String(n))).filter(i => i >= 0))].sort((a, b) => a - b), out = [];
    for (let i = 0; i < at.length; i++) {
      let j = i;
      while (j + 1 < at.length && at[j + 1] === at[j] + 1) j++;
      out.push(j - i >= 2 ? all[at[i]] + '～' + all[at[j]] : at.slice(i, j + 1).map(p => all[p]).join('、'));
      i = j;
    }
    return out.length ? '镜' + out.join('、') : '';
  }
  /* 这一镜有没有它：点镜头号的小牌子换。改了回 true */
  function setShot(x, k, name, on) {
    if (!x || !KINDS.includes(k)) return false;
    const r = ref(k, name), cur = list(x[k]).map(n => ref(k, n));
    if (!r || cur.includes(r) === !!on) return false;
    const next = on ? [...cur, r] : cur.filter(n => n !== r);
    if (next.length) x[k] = next; else delete x[k];
    return true;
  }
  /* 只留这一段选上的（AI 在镜头里写了出场的没列的名字，不要） */
  function fitRows(s) {
    const own = Object.fromEntries(KINDS.map(k => [k, new Set(castRefs(s, k))]));
    for (const x of rowsOf(s)) for (const k of KINDS) {
      const a = list(x[k]).map(n => ref(k, n)).filter(n => own[k].has(n));
      if (a.length) x[k] = [...new Set(a)]; else delete x[k];
    }
  }

  /* ---------- 这一段选上的、哪几段用着 ---------- */
  /* 这一场选上的：人物、道具是名字；场景是只用文字写的那几句的地方名，和场景图的图名 */
  const castRefs = (s, k) => !s ? [] : k === '场景' ? [...new Set([...list(s.场景文字).map(place), ...list(s.场景图).map(f => place(stem(f)))])] : list(s[k]);
  const inCast = (s, k, name) => castRefs(s, k).includes(ref(k, name));
  const segsOf = (doc, k, name) => (doc && Array.isArray(doc.场) ? doc.场 : []).filter(s => s && inCast(s, k, name)).map(s => str(s.段));
  /* 这一段挂的场景图的图名（11-17：任务书里不写图名，AI 就标不上它用在哪几镜） */
  const imgNames = s => [...new Set(list(s && s.场景图).map(f => place(stem(f))).filter(Boolean))];
  /* 场景图一张都还没标在哪一镜（以前标的时候 AI 不知道图名）：提炼页提醒「让 AI 标上」 */
  const imgsUntagged = s => { const a = imgNames(s), rows = rowsOf(s); return a.length > 0 && rows.length > 0 && a.every(n => !rows.some(x => inRow(x, '场景', n))); };

  /* ---------- 全局：全片好几段都出场的 ---------- */
  const box = doc => doc && doc.rest && typeof doc.rest === 'object' && !Array.isArray(doc.rest) ? doc.rest : doc;   // 页面读进来的流水线，不认识的项在 rest 里；本机服务读的是原样
  function marks(doc) {
    const g = (box(doc) || {}).全局, o = g && typeof g === 'object' && !Array.isArray(g) ? g : {};
    return Object.fromEntries(KINDS.map(k => [k, [...new Set(list(o[k]).map(n => ref(k, n)).filter(Boolean))]]));
  }
  function putMarks(doc, m) {
    const b = box(doc), out = {};
    if (!b) return;
    for (const k of KINDS) if (m[k] && m[k].length) out[k] = m[k];
    if (Object.keys(out).length) b.全局 = out; else delete b.全局;
  }
  const marksGlobal = (doc, k, name) => marks(doc)[k].includes(ref(k, name));
  /* 算不算全局：标了全局，或者好几段都选了它 */
  const isGlobal = (doc, k, name) => marksGlobal(doc, k, name) || segsOf(doc, k, name).length > 1;
  function setGlobal(doc, k, name, on) {
    const m = marks(doc), r = ref(k, name);
    if (!KINDS.includes(k) || !r || m[k].includes(r) === !!on) return false;
    m[k] = on ? [...m[k], r] : m[k].filter(n => n !== r);
    putMarks(doc, m);
    return true;
  }
  /* AI 回的「全局」：{ 人物: [], 场景: [], 道具: [] }；没回这一项给 null（老的提炼：全局照旧） */
  function globalIn(j) {
    const g = j && j.全局;
    if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
    return Object.fromEntries(KINDS.map(k => [k, [...new Set(list(g[k]).map(n => ref(k, n)).filter(Boolean))]]));
  }
  /* 并进 AI 提炼的：这一段选上的几样，AI 说全局就标上，没说就去掉（别的段的不动）；AI 没回「全局」就照旧 */
  function takeMarks(doc, s, g) {
    if (!g) return;
    const m = marks(doc);
    for (const k of KINDS) { const own = castRefs(s, k), on = new Set(g[k] || []); m[k] = [...m[k].filter(n => !own.includes(n)), ...own.filter(n => on.has(n))]; }
    putMarks(doc, m);
  }
  /* 卡上那一行小字：「镜1～5」；这一段标过、它一镜都没有：「哪一镜都没用上」；这一段还没标给 '' */
  function say(doc, s, nos, k, name) {
    if (!marked(s)) return '';
    return nosSay(shotsOf(s, nos, k, name), nos) || '哪一镜都没用上';
  }

  /* ---------- 删掉 ---------- */
  const goneKeys = s => list(s && s.删掉);
  /* 删掉了的（又加回来的不算） */
  const isGone = (s, k, name) => goneKeys(s).includes(keyOf(k, name)) && !inCast(s, k, name);
  /* 删的时候问一句：说清全片设定里删不删、图删不删。file：场景图的路径（只用文字写的场景、人物、道具不给） */
  function dropSay(doc, s, k, name, file) {
    const r = file ? place(stem(file)) : ref(k, name), others = segsOf(doc, k, file ? stem(file) : name).filter(x => x !== str(s && s.段));
    const e = k === '场景' ? null : (doc && Array.isArray(doc[k]) ? doc[k] : []).find(x => x && str(x.名) === r);
    const img = !!file || (!!e && list(e.资产).length > 0);
    return { title: '删掉' + k + '「' + r + '」', ok: '删掉', danger: true,
      body: '这一段不用它，镜头表里也去掉。' + (others.length ? '第' + others.join('、') + '段还用着，全片设定里留着。' : file ? '别的段没用它：全片的场景图里也不再引用。' : k === '场景' ? '别的段没用它：全片设定的场景里，这一句也删掉。' : '别的段没用它：全片设定里也删掉，连描写。')
        + (img ? '图还在原处，不会删。' : '') + 'AI 重新提炼也不再列它；要用，再点「＋ 加' + k + '」。' };
  }
  /* 删掉一样（提炼页、资产页的 ×）。name：人物、道具写名字；场景写这一场「场景文字」里那一句，场景图给 file（路径）。
     回 { all: 全片设定里也删了, others: 还用着的别的段 } */
  function drop(doc, s, k, name, file) {
    const r = file ? place(stem(file)) : ref(k, name), others = segsOf(doc, k, file ? stem(file) : name).filter(x => x !== str(s.段));
    if (k === '场景') {
      if (file) s.场景图 = (s.场景图 || []).filter(f => f !== file);
      else s.场景文字 = (s.场景文字 || []).filter(t => place(t) !== r);
      if (Core && Core.setNoGeo) Core.setNoGeo(s, r, false);
    } else s[k] = (s[k] || []).filter(n => str(n) !== r);
    if (Core && Core.setNoImg) Core.setNoImg(s, k, r, false);
    for (const x of rowsOf(s)) setShot(x, k, r, false);
    if (!goneKeys(s).includes(k + '|' + r)) s.删掉 = [...goneKeys(s), k + '|' + r];
    const all = !others.length;
    if (all) {
      if (k === '场景' && file) doc.场景图 = (doc.场景图 || []).filter(f => f !== file);
      else if (k === '场景') doc.场景 = String(doc.场景 || '').split(/\r?\n/).filter(t => !t.trim() || place(t) !== r).join('\n').replace(/\n{2,}/g, '\n').trim();
      else if (Array.isArray(doc[k])) doc[k] = doc[k].filter(x => !x || str(x.名) !== r);
      setGlobal(doc, k, r, false);
    }
    return { all, others };
  }
  /* 页面上的 ×：先问一句（ask：界面.js 的 confirmDlg），点了「删掉」才删。删了回 true */
  async function dropAsk(ask, doc, s, k, name, file) {
    if (!(await ask(dropSay(doc, s, k, name, file)))) return false;
    drop(doc, s, k, name, file);
    return true;
  }
  /* 并进 AI 提炼的之前：人删掉了、AI 又列上的，不要（v：流水线.js 的 normDistill 读出来的） */
  function skipGone(s, v) {
    if (!v || !goneKeys(s).length) return;
    for (const k of ['人物', '道具']) if (Array.isArray(v[k])) v[k] = v[k].filter(x => !isGone(s, k, x && x.名));
    if (Array.isArray(v.场景)) v.场景 = v.场景.filter(t => !isGone(s, '场景', t));
    for (const x of Array.isArray(v.段落) ? v.段落 : []) for (const k of KINDS) if (Array.isArray(x[k])) { x[k] = x[k].filter(n => !isGone(s, k, n)); if (!x[k].length) delete x[k]; }
    if (v.全局) for (const k of KINDS) v.全局[k] = (v.全局[k] || []).filter(n => !isGone(s, k, n));
  }

  /* ---------- 改名、全片设定里删了一行 ---------- */
  /* 人物、道具改了叫法，全片的场景改了地方名：各镜头里记的、全局、删掉 跟着换 */
  function rename(doc, k, from, to) {
    const a = ref(k, from), b = ref(k, to);
    if (!a || !b || a === b || !KINDS.includes(k)) return false;
    for (const s of doc && Array.isArray(doc.场) ? doc.场 : []) {
      for (const x of rowsOf(s)) if (inRow(x, k, a)) { x[k] = [...new Set(list(x[k]).map(n => ref(k, n) === a ? b : n))]; }
      const g = goneKeys(s);
      if (g.includes(k + '|' + a)) s.删掉 = [...new Set(g.map(x => x === k + '|' + a ? k + '|' + b : x))];
    }
    const m = marks(doc);
    if (m[k].includes(a)) { m[k] = [...new Set(m[k].map(n => n === a ? b : n))]; putMarks(doc, m); }
    return true;
  }
  /* 全片的场景改了几句（流水线.js 的 setScene）：was 第 i 句换成了 now 第 i 句；oldAll、newAll：改前、改后全片的每一句。
     改着改着撞上别的地方的名字（或者原来就有两句同名），不跟着换：宁可这一处要重标，也别把两处并成一处 */
  function renameScenes(doc, was, now, oldAll, newAll) {
    if (!now || !now.length) return;
    const cnt = (L, p) => (L || []).filter(t => place(t) === p).length;
    (was || []).forEach((t, i) => {
      const a = place(t), b = place(now[Math.min(i, now.length - 1)]);
      if (a !== b && cnt(oldAll, a) === 1 && cnt(newAll, b) === 1 && !cnt(oldAll, b)) rename(doc, '场景', a, b);
    });
  }
  /* 全片设定里删了一行（设定页）：各镜头里记的、全局里的也去掉 */
  function forget(doc, k, name) {
    for (const s of doc && Array.isArray(doc.场) ? doc.场 : []) for (const x of rowsOf(s)) setShot(x, k, name, false);
    setGlobal(doc, k, name, false);
  }

  /* ---------- AI 只标了镜头、全局，别的一个字没动：定下来的照旧算数（流水线.js 的 takeDistill） ---------- */
  function sig(doc, s) {
    const desc = k => list(s && s[k]).map(n => { const e = (doc && Array.isArray(doc[k]) ? doc[k] : []).find(x => x && str(x.名) === n); return n + '：' + (e ? str(e.描写) : ''); });
    return JSON.stringify([str(doc && doc.梗概), desc('人物'), desc('道具'), list(s && s.场景文字), list(s && s.场景图), rowsOf(s).map(x => [str(x.号), str(x.写什么), str(x.作用), Number(x.秒数) || 0])]);
  }

  /* ---------- 交给 AI（本机服务 jobs.js）：要求、回的样子、全片设定里写哪一行、写提示词时每一镜出场的 ---------- */
  const RULE_SHOT = '镜头表每个镜头再写三个列表：「人物」「场景」「道具」，写这个镜头里出场的（看得见的、开口说话的），名字照上面人物、道具的「名」，场景写地方名（冒号前那几个字），一个字不差；这个镜头里没有的写空列表。';
  const RULE_GLOBAL = '「全局」：上面列的人物、场景、道具里，全片好几段都会出场的（照梗概和别的段估；全片设定里标了全局的照旧），分人物、场景、道具写进「全局」；只这一段用的不写。';
  /* 提炼的要求接在第 n 条后面 */
  const rules = n => [n + '. ' + RULE_SHOT, (n + 1) + '. ' + RULE_GLOBAL];
  /* 照批注改：原有的照抄，批注说到的照改，还没标的、新加的照规矩标（旧的提炼没标过，借这一回补上） */
  const ruleFix = n => n + '. 镜头的「人物」「场景」「道具」和「全局」：原有的照抄，批注说到的照改；还没标的、新加的照这个标：' + RULE_SHOT + RULE_GLOBAL;
  const SHOT_JSON = '"人物": ["……"], "场景": ["……"], "道具": []';
  const GLOBAL_JSON = '"全局": {"人物": ["……"], "场景": [], "道具": []}';
  /* 人删掉了、这一段不要的：重新提炼时告诉 AI 别再列 */
  function goneLine(s) {
    const g = goneKeys(s).map(x => x.split('|')).filter(([k, n]) => KINDS.includes(k) && n && !inCast(s, k, n));
    return g.length ? '人删掉了、这一段用不着的，别再列，镜头里也别写：' + g.map(([k, n]) => k + '「' + n + '」').join('、') : '';
  }
  /* 这一段挂了场景图的：告诉 AI 图名，镜头的「场景」也能写它 */
  function imgLine(s) {
    const a = imgNames(s);
    return a.length ? '这一段挂了场景图，图名：' + a.join('、') + '。照图名和剧本估，哪个镜头用得上哪张，就把图名写进这个镜头的「场景」，一个字不差。' : '';
  }
  /* 全片设定里写一行：哪些是全局的（标了的，和好几段都选了的） */
  function globalLine(doc) {
    const seen = Object.fromEntries(KINDS.map(k => [k, new Set(marks(doc)[k])]));
    for (const s of doc && Array.isArray(doc.场) ? doc.场 : []) for (const k of KINDS) for (const n of castRefs(s, k)) if (segsOf(doc, k, n).length > 1) seen[k].add(n);
    return '全局（全片好几段都出场的）：' + KINDS.map(k => k + '：' + ([...seen[k]].join('、') || '（没有）')).join('；');
  }
  /* 这一段给 AI 看的「现在的」全局：这一段选上的里面算全局的 */
  const segGlobal = (doc, s) => Object.fromEntries(KINDS.map(k => [k, castRefs(s, k).filter(n => isGlobal(doc, k, n))]));
  /* 镜头表那一行后面接的：「出场：洪七公、雪山、竹棍」 */
  const castSay = x => { const c = rowCast(x), a = KINDS.flatMap(k => c[k] || []); return a.length ? '出场：' + a.join('、') : ''; };

  return Object.freeze({ KINDS, place, ref, keyOf, rowCast, inRow, marked, shotsOf, nosSay, setShot, fitRows, castRefs, inCast, segsOf, imgNames, imgsUntagged, imgLine,
    marks, marksGlobal, isGlobal, setGlobal, globalIn, takeMarks, say, goneKeys, isGone, dropSay, drop, dropAsk, skipGone, rename, renameScenes, forget, sig,
    RULE_SHOT, RULE_GLOBAL, rules, ruleFix, SHOT_JSON, GLOBAL_JSON, goneLine, globalLine, segGlobal, castSay });
});
