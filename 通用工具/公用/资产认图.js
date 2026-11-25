/* 项目里本来就有的图，照名字认上（2026-11-25 他要：流程改成先写提示词以后，前一条出的图后一条接着用，项目也可能自带图）。
   图放进 资产/人物和道具、资产/场景，名字对得上的自动挂上、算确认可用，不用一张张挂、一张张点「可用」。
   怎么认：
     人物表、道具表里还没有图的一行：先找图名和这一行的名字一模一样的；没有，再找图名下划线前面那一段是它、而且只有一张的（童爸爸 ← 童爸爸_三十出头.png）。
       好几张都对得上、拿不准的不认，留给人挑；已经挂在别的行的、这一行说过「不用」的、哪一段标了只用文字的，不认；
       做图过程里的文件（名字后半截带 底图、白模、叠图、对照、草图、测试、预览）不当成品认。
     只用文字写的场景：资产/场景 里正好有一张图名和地方名一模一样的，这一段改用这张图（标了只用文字的、图照的那一句已经变了的，不认）。
   认上的算确认可用。时间记图文件自己的时间，不记现在（那一行的描写后来改过，就照改的时间）：老项目里早就有的图认上以后，后来写的提示词不会被标成「资产改了」。
     照的哪一句（公用/资产照的.js）记现在的：以前写过的出图提示词不是它的来历，不能拿来算「字改了」。
   提炼的任务书多一句（本机服务 jobs.js）：项目里已经有图、全片设定里还没列的名字，叫 AI 照这个名字写，好和图对上。
   这里只管认和算，不碰页面：怎么存、怎么记时间，由 流水线.js 的 loadSides 交进来。
   用到的：流水线.js（各页）、本机服务 jobs.js。测试：node --test 通用工具/测试/资产认图_测试.cjs */
(function (root, factory) {
  const node = typeof module === 'object' && !!module.exports;
  const api = factory(node ? require('./核心.js') : root.Core, node ? require('./资产路径.js') : root.AssetPath);
  if (node) module.exports = api;
  else root.AssetMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, AP) {
  'use strict';
  const ROWS = Object.freeze(['人物', '道具']);
  const IMG_RE = /\.(png|jpe?g|webp)$/i, CAND_RE = /_候选\.(png|jpe?g|webp)$/i;
  const PROC_RE = /底图|白模|叠图|对照|草图|测试|预览/;   // 做图过程里的文件，不是成品
  const MAX = 40;   // 任务书里一类最多列几个名字
  const str = v => typeof v === 'string' ? v : v == null ? '' : String(v);
  const low = f => str(f).toLowerCase();
  const stemOf = n => str(n).replace(/\.[^.]+$/, '');
  const callOf = stem => str(stem).split('_')[0];   // 图名下划线前面那一段，就是戏里的叫法
  const filesOf = v => (Array.isArray(v) ? v : [v]).map(x => str(x).trim().replace(/\\/g, '/')).filter(Boolean);   // 一张图写成一个字符串、几张写成列表，两种都认
  const rowsOf = (doc, k) => (doc && Array.isArray(doc[k]) ? doc[k] : []).filter(e => e && typeof e === 'object' && str(e.名).trim());
  const scenesOf = doc => (doc && Array.isArray(doc.场) ? doc.场 : []).filter(s => s && typeof s === 'object');
  const timeOf = t => { const n = Date.parse(str(t).trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const poolOf = (pool, c) => (Array.isArray(pool) ? pool : []).filter(x => x && x.类别 === c && str(x.文件) && str(x.名称));
  const finished = x => x.名称 === callOf(x.名称) || !PROC_RE.test(x.名称.slice(callOf(x.名称).length));   // 成品：名字就是叫法，或者后半截不带过程文件那几个词

  /* ---------- 认 ---------- */
  /* 人物和道具里还没人挂的图：哪张表的哪一行都没引用 */
  function freeImgs(doc, pool) {
    const used = new Set(ROWS.flatMap(k => rowsOf(doc, k).flatMap(e => filesOf(e.资产))).map(low));
    return poolOf(pool, AP.CP).filter(x => !used.has(low(x.文件)));
  }
  /* 名字是 name 的一行该认哪一张（free：还没人挂的图；no：这一行说过不用的，小写）。认不准回 '' */
  function pickRow(name, free, no) {
    const ok = free.filter(x => !(no && no.has(low(x.文件))));
    const same = ok.filter(x => x.名称 === name);
    if (same.length) return same.length === 1 ? same[0].文件 : '';
    const like = ok.filter(x => callOf(x.名称) === name && finished(x));
    return like.length === 1 ? like[0].文件 : '';
  }
  const textOnly = (doc, k, name) => scenesOf(doc).some(s => Core.noImg(s, k, name));   // 哪一段标了只用文字：他说过这一样不要图
  /* 表里还没有图的行，各该挂哪一张：[{ 类别, 名, 文件 }]。gone：引用着、文件却不在了的图（Set，没有就不给） */
  function rowPicks(doc, pool, gone) {
    const out = [], taken = new Set(), free = freeImgs(doc, pool);
    for (const k of ROWS) for (const e of rowsOf(doc, k)) {
      if (filesOf(e.资产).some(f => !(gone && gone.has(f))) || textOnly(doc, k, e.名)) continue;
      const f = pickRow(e.名, free.filter(x => !taken.has(x.文件)), new Set(filesOf(e.不用).map(low)));
      if (f) { taken.add(f); out.push({ 类别: k, 名: e.名, 文件: f }); }
    }
    return out;
  }
  /* 只用文字写的场景，资产/场景 里正好有一张同名的图：[{ 段, 文字, 名, 文件 }]。old(图, ['场景', 地方名])：这张图旧了，不认 */
  function scenePicks(doc, pool, old) {
    const out = [], imgs = poolOf(pool, AP.SC);
    for (const s of scenesOf(doc)) for (const t of [...new Set((Array.isArray(s.场景文字) ? s.场景文字 : []).map(x => str(x).trim()).filter(Boolean))]) {
      const n = Core.sceneStem(t);
      if (!n || Core.noImg(s, '场景', n)) continue;
      const hit = imgs.filter(x => x.名称 === n);
      if (hit.length !== 1 || (old && old(hit[0].文件, ['场景', n]))) continue;
      out.push({ 段: s.段, 文字: t, 名: n, 文件: hit[0].文件 });
    }
    return out;
  }
  /* 认上，改 doc（页面读进来的流水线：每一行的「资产」是列表）。o 是页面交进来的几样：
       gone                      引用着、文件却不在了的图（Set）
       old(图, [类别, 名])        这张图旧了没有
       when(图, 那一行)           认上的时间记成什么（'2026-11-25 05:00:00'：图文件自己的时间；那一行的描写后来改过，就照改的时间。场景没有那一行）
       note(图, [类别, 名])       记下它照的是现在哪一句（时间页面自己记：现在）
       row(类别, 那一行, 时间)     这一行挂上图以后页面要记的
       scene(那一段, 那一句, 图, 时间)   这一段改用这张图
     回认上的几样：[{ 类别, 名, 文件 }] */
  function apply(doc, pool, o) {
    const got = [];
    const ok = (f, t) => { if (!doc.可用 || typeof doc.可用 !== 'object') doc.可用 = {}; if (timeOf(doc.可用[f]) < timeOf(t)) doc.可用[f] = t; };   // 以前确认过、比这个时间还新的，照旧
    for (const p of rowPicks(doc, pool, o.gone)) {
      const e = rowsOf(doc, p.类别).find(x => x.名 === p.名), t = o.when(p.文件, e);
      e.资产 = p.类别 === '道具' ? [...filesOf(e.资产), p.文件] : [p.文件];   // 人物只挂一张：原来挂的那张不在了，换成认上的
      ok(p.文件, t); o.note(p.文件, [p.类别, p.名]); o.row(p.类别, e, t);
      got.push(p);
    }
    for (const p of scenePicks(doc, pool, o.old)) {
      const s = scenesOf(doc).find(x => x.段 === p.段), t = o.when(p.文件, null);
      o.scene(s, p.文字, p.文件, t); ok(p.文件, t); o.note(p.文件, ['场景', p.名]);
      got.push({ 类别: '场景', 名: p.名, 文件: p.文件 });
    }
    return got;
  }
  /* 认上以后跟人说的那一句（同一张图几段都用上了，只说一回） */
  function say(got) {
    const seen = new Set(), list = (Array.isArray(got) ? got : []).filter(x => x && x.文件 && !seen.has(x.文件) && seen.add(x.文件));
    if (!list.length) return '';
    return '照名字认上了 ' + list.length + ' 张图：' + list.slice(0, 6).map(x => x.类别 + '「' + x.名 + '」').join('、') + (list.length > 6 ? ' 等' : '') + '。都算确认可用；认错了的，点那张卡上的 × 取下。';
  }

  /* ---------- 提炼的任务书 ---------- */
  /* 文件夹里有图、全片设定里还没列的名字：{ 物: [人物和道具的叫法], 景: [场景图的名字] } */
  function freeNames(doc, pool) {
    const have = new Set(ROWS.flatMap(k => rowsOf(doc, k).map(e => str(e.名).trim())));
    const 物 = [...new Set(freeImgs(doc, pool).filter(finished).map(x => callOf(x.名称)))].filter(n => n && !have.has(n));
    const used = new Set([...filesOf(doc && doc.场景图), ...scenesOf(doc).flatMap(s => filesOf(s.场景图))].map(low));
    const places = new Set(str(doc && doc.场景).split(/\r?\n/).map(l => Core.sceneStem(l)).filter(Boolean));   // 全片场景里已经写了的地方
    const 景 = [...new Set(poolOf(pool, AP.SC).filter(x => !used.has(low(x.文件)) && !PROC_RE.test(x.名称)).map(x => x.名称))].filter(n => !places.has(n));
    return { 物: 物.slice(0, MAX), 景: 景.slice(0, MAX) };
  }
  /* 任务书里那一句；一个名字都没有回 '' */
  function bookLine(names) {
    const a = names && Array.isArray(names.物) ? names.物 : [], b = names && Array.isArray(names.景) ? names.景 : [];
    if (!a.length && !b.length) return '';
    const q = list => list.map(x => '「' + x + '」').join('');
    return '项目里已经有现成的图、全片设定里还没列的：' + [a.length ? '人物和道具' + q(a) : '', b.length ? '场景' + q(b) : ''].filter(Boolean).join('；')
      + '。剧本里出场的要是其中哪一样，名字就照这个写（场景是冒号前面的地方名），一个字不差，好和图对上；剧本里没有的不要列。';
  }
  /* 本机服务用：资产/人物和道具、资产/场景 本层有哪些图。ls(文件夹) 回里面的名字；dirOf(文件夹的名字) 回它的路径。候选图不算 */
  async function poolOn(ls, dirOf) {
    const out = [];
    for (const c of [AP.CP, AP.SC]) for (const n of [...(await ls(dirOf(c)) || [])].map(str).filter(n => IMG_RE.test(n) && !CAND_RE.test(n)).sort()) out.push({ 类别: c, 名称: stemOf(n), 文件: '资产/' + c + '/' + n });
    return out;
  }
  return Object.freeze({ ROWS, PROC_RE, freeImgs, pickRow, rowPicks, scenePicks, apply, say, freeNames, bookLine, poolOn });
});
