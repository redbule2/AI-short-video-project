/* 资产改过（2026-11-17 他要：资产改了，提示词还是旧的，流水线的逻辑就不对了）。
   提示词写好以后（或者你点了「沿用」以后），这一段用到的资产又改了：那条提示词标「资产改了，待核对」，批准出片按不动；照它出的样片也标待核对。
   算「改了」的：只用文字的文字描写、场景的 GEO 底稿、图文件换过、人物道具那一行（描写、图、音色）、这一场换了出场的（含只用文字、不要 GEO 的切换）。
   一键「照新资产改」：页面把改过的写进这一条的批注（提示词/第N段/名_批注.md，「整体」那一段带 MARK），交给 AI 按批注改提示词：
   改过的字（文字描写、GEO 底稿、描写）写新字；换过的图写图在哪（AI 打开看）；那一行换过图或音色写现在的；换了出场的写现在出场的。
   11-17 晚他问「资产改了，怎么没有按钮更新提示词」：以前换图、换音色、换出场的不给按钮，现在哪一种都给。
   11-18：换了图，这一条镜头里看得见它、还没挂的，AI 照 sd25-pe 挂上、在【素材登记】里登记；挂图那句写清图里要照的东西（药膳鸡 2-3 砂锅那句只写了外形，出片锅里是空的）。
   AI 只改对不上的地方，都对得上就回 []：本机服务不改字，只把稿子的时间更新（不再标待核对），批注照旧收进历史记录。
   用到的：流水线.js（upTime、assetEdits）、提示词.html（标签、按钮）、本机服务 jobs.js（按批注改提示词 回 [] 时）。测试：node 通用工具/测试/资产改过_测试.cjs */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AssetEdit = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MARK = '资产改了：这份批注是流水线照改过的资产写的';
  const SAY = { 文字描写: '文字描写', GEO底稿: ' GEO 底稿', 描写: '描写', 图: '图', 图或音色: '图或音色', 出场: '出场的' };
  const KIND = { 场景图: '场景', 人物图: '人物', 道具图: '道具', 场景文字: '场景' };
  const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
  const str = v => String(v == null ? '' : v).trim();

  /* 资产格子（页面 assetsOf 给的）各是什么时候改的。look(it)：这一格的字（页面 wordOf 给的：txtOnly、txt、hasTxt、geo、hasGeo），没有给 null；
     time(文件)：文件的修改时间。关键帧不算（它只管挂了它的那一条，另有一套）；AI 另外列的（own 是假）不算 */
  function editsOf(items, look, time) {
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || !it.own || it.类别 === '关键帧') continue;
      const w = look ? look(it) : null, cat = (w && w.cat) || KIND[it.类别] || it.类别, name = (w && w.name) || it.名称;
      const add = (改了, 文件) => { const t = num(time(文件)); if (t) out.push({ 类别: cat, 名称: name, 改了, 时间: t, 文件 }); };
      if (w && w.txtOnly) { if (w.hasTxt) add('文字描写', w.txt); continue; }
      if (it.at) add('图', it.at);
      if (w && w.geo && w.hasGeo) add('GEO底稿', w.geo);
    }
    return out;
  }
  /* 出场的人物、道具那一行：rows [{ 类别, 名称, 改, 描写改, 描写 }]（时间是毫秒）。描写改了带上新的描写；那一行后来又动过（图、音色）另算一样 */
  function rowEdits(rows) {
    const out = [];
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !str(r.名称)) continue;
      const a = num(r.改), d = num(r.描写改);
      if (d) out.push({ 类别: r.类别, 名称: str(r.名称), 改了: '描写', 时间: d, 字: str(r.描写) });
      if (a > d + 999) out.push({ 类别: r.类别, 名称: str(r.名称), 改了: '图或音色', 时间: a });
    }
    return out;
  }
  /* since 以后改的：同一样同一种只留最后一回，按先后排 */
  function after(parts, since) {
    const t = num(since), best = new Map();
    for (const p of Array.isArray(parts) ? parts : []) {
      if (!p || num(p.时间) <= t + 999) continue;
      const k = p.类别 + '/' + p.名称 + '/' + p.改了, o = best.get(k);
      if (!o || p.时间 > o.时间) best.set(k, p);
    }
    return [...best.values()].sort((a, b) => a.时间 - b.时间);
  }
  /* 一句话说改了哪几样：「洪七公、竹棍的文字描写；破庙的 GEO 底稿；换了出场的」 */
  function say(list, max) {
    const m = max || 6, groups = new Map();
    for (const p of Array.isArray(list) ? list : []) {
      if (!groups.has(p.改了)) groups.set(p.改了, []);
      const ns = groups.get(p.改了);
      if (p.名称 && !ns.includes(p.名称)) ns.push(p.名称);
    }
    return [...groups].map(([k, ns]) => k === '出场' ? '换了出场的' : (ns.length > m ? ns.slice(0, m).join('、') + '等 ' + ns.length + ' 样' : ns.join('、')) + '的' + SAY[k]).join('；');
  }
  /* 这一场现在出场的（「换了出场的」那一样写进批注用）。items、look 同 editsOf；full(文件)：AI 打得开的路径（页面给 E:\ 开头的）。
     一类一行：「人物：洪七公（图 项目/…/洪七公.png）、竹棍（只用文字，文字描写 项目/…）」。关键帧、AI 另外列的不算 */
  function castText(items, look, full) {
    const f = full || (x => x), rows = new Map([['人物', []], ['道具', []], ['场景', []]]);
    for (const it of Array.isArray(items) ? items : []) {
      if (!it || !it.own || it.类别 === '关键帧') continue;
      const w = look ? look(it) : null, cat = KIND[it.类别] || it.类别, txt = w && w.hasTxt ? '，文字描写 ' + f(w.txt) : '';
      const how = it.文字 ? '文字写的：' + str(it.文字) + txt : it.只字 ? '只用文字' + (txt || '，还没写文字描写') : it.at ? '图 ' + f(it.at) : str(it.状态) || '还没有图';
      if (!rows.has(cat)) rows.set(cat, []);
      rows.get(cat).push(str(it.名称) + (it.sub && !KIND[it.类别] ? '·' + it.sub : '') + '（' + how + '）');   // 人物、道具那一行的 sub 是哪个样子；这一段的图 sub 写的是「这一段的」，不带
    }
    return [...rows].filter(([, xs]) => xs.length).map(([k, xs]) => k + '：' + xs.join('、')).join('\n');
  }
  /* 人物、道具那一行现在的图和音色（「图或音色」那一样写进批注用）。e：流水线.json 里那一行 */
  function rowText(e, full) {
    const f = full || (x => x), imgs = e && Array.isArray(e.资产) ? e.资产.filter(Boolean) : [];
    return ['图：' + (imgs.length ? imgs.map(f).join('、') : '没有'), ...(e && typeof e.音色 === 'string' ? ['音色：' + (e.音色 ? f(e.音色) : '不用')] : [])].join('\n');
  }
  /* 批注里一样一段的头一句 */
  function headOf(p) {
    if (p.改了 === '出场') return '这一场出场的（换过了，现在的）';
    const who = p.类别 ? p.类别 + '「' + p.名称 + '」' : p.名称;
    return who + (p.改了 === '图' ? '的图（换过了，打开看现在这张）' : p.改了 === '图或音色' ? '那一行的图或音色（换过了，现在的）' : '的' + SAY[p.改了] + '（现在的）');
  }
  /* 批注「整体」那一段：MARK 开头，说怎么改，一样一段（缩进两格：底稿里的「## 」不会被当成批注的段头）。list 里每一样带「字」：新字、图的路径、现在的样子，空的不写 */
  /* 11-17 第二版：第一版写「同一样各镜头写成一样」，AI 把长相整段抄进每个镜头、人名换成「他」，校对一下报了 15 处。改成：长相只改一处，镜头只改打架的词、写名字 */
  function general(list) {
    const xs = (Array.isArray(list) ? list : []).filter(p => p && SAY[p.改了] && str(p.字)), has = (...ks) => xs.some(p => ks.includes(p.改了));
    return [MARK + '。这一条写好以后，下面几样又改过。照新的对一遍，只改对不上的：',
      '- 人物、道具的长相、衣着、样子、颜色、材质：只改它在【主体与关系】里的那一行（写法二是【人物】【道具】【场景】里的那一行），照新的写全，不缩成一两句。',
      '- 场景里有什么、什么时辰、光从哪来：改【主体与关系】里那个场景的一行，和【基础设定】的光色基调。',
      ...(has('图', '图或音色') ? ['- 换过的图：先打开下面写的那张图看；这一条写到它的样子，和新图对不上的照上面两条改。',
        '- 挂图照 sd25-pe：这一条镜头里看得见它、还没挂它的图的，挂上，编号接着往后编，登记进【素材登记】；素材里那一句写清图里要照的东西，装着东西的写上里面的。已经挂了的，那一句没写全的补上。'] : []),
      ...(has('出场') ? ['- 换了出场的：只看这一条已经写到的人物、道具、场景，现在不出场了、改成只用文字了的照现在的改；这一条没写到的不加。'] : []),
      '- 【事件脚本】：只改和新的打架的词（颜色、时辰、东西不对），不把长相、衣着、场景描写抄进镜头。镜头里指人写名字，不写他、她（台词、旁白里的照原文）。',
      '- 已经挂的 @图片、@视频、@音频，编号和文件不动。别的一字不动。都对得上，就回一个空列表 []。',
      ...xs.map((p, i) => (i + 1) + '. ' + headOf(p) + '：\n' + str(p.字).split(/\r?\n/).map(l => '  ' + l).join('\n'))].join('\n');
  }
  /* 写进批注文件的整份 Markdown。Core：公用/核心.js（notesToMd、parseNotes）；o：{ title, file, list, old：原来的批注（没有给 ''） }。
     原来人写的批注照留（逐条的、整体的都留）；原来是这里写过的整体，换成新的 */
  function noteMd(Core, o) {
    const old = o.old ? Core.parseNotes(o.old) : { general: '', items: [] };
    const keep = old.general && !isAuto(old.general) ? old.general : '';
    return Core.notesToMd({ title: o.title, file: o.file, general: general(o.list) + (keep ? '\n\n' + keep : ''), items: old.items });
  }
  const isAuto = md => str(md).includes(MARK);
  /* 这份批注只有这里写的整体、没有人写的逐条：AI 回 [] 就是都对得上（本机服务照这个不改字、只更新时间） */
  const onlyAuto = md => isAuto(md) && !/^##\s*\d+/m.test(String(md || ''));
  return Object.freeze({ MARK, SAY, editsOf, rowEdits, after, say, castText, rowText, general, noteMd, isAuto, onlyAuto });
});
