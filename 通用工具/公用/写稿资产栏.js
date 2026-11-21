/* ============================================================
   公用 · 写稿页右栏「资产」页签分类看（2026-11-20 他要：分 关键帧、人物道具、已引用、未引用）
   搜索框底下一排小页签：关键帧 · 人物道具 · 场景 ┆ 已引用 · 未引用，一次只看一类，页签上带个数。
     关键帧、人物道具、场景照文件放在哪认（资产路径.js placeOf：资产/关键帧/第N段、资产/人物和道具、资产/场景；登记在别处的照路径认）；
     场景页签只在有场景图时摆（他点名的是另外四个）。
     已引用：这份挂了编号的，照编号排；未引用：能挂、还没挂的，照类别分块。
     一类里面：图在最前，再是白模视频、别的视频、声音；关键帧、场景的图 16:9 两列，人物道具的图方块三列、人物排前面。
   「关键帧」只摆这一条拍的镜头的（11-20 他要：不要全部都摆）：知道这一条拍哪几镜、这一场也绑过关键帧时，「关键帧」页签和未引用的「关键帧」那一块
     只摆绑在这几镜上的，标题「这一条拍的 · 镜8、11-14」；别的镜头的、没绑的（白模、空镜、参考截图）不摆，搜的时候才跟在后面（正文里打 @ 也找得到）。
     绑在哪一镜只看流水线里的「关键帧绑定」，不看文件名（他定：镜头8_首帧 绑在镜头9 开头，就算镜头9 的）。
     这一条拍哪几镜照提示词的名字（关键帧绑定.js shotsOf，和镜头表页签一样）；认不出（老名字）、这一场一张没绑过（老项目），照旧全摆。
     一类里面绑了的照镜头表、开头中间结尾、现用在前，没绑的放后面照名字；图上标一行绑在哪（镜9 开头）；这一条有的镜头一张没绑，说一句。
   列不列（只列确认可用的，白模、人物音色照列）、每一样怎么画（插入、钉住、放大）是页面的，传进来；挂上的不管确认没有都列，页面自己标。
   看哪一类记在 sessionStorage：刷新还在，重开从「关键帧」看起。
   用法：先引 界面.js（UI.h）、资产路径.js（AssetPath）、关键帧绑定.js（ShotBind），再引这个；页面调 AssetRail.paint(几个格子, 参数)，见 paint。
     sort()、split()、tagOf()、lackOf()、blocksOf() 只算不画，测试在 通用工具/测试/写稿资产栏_测试.cjs。样子在 写稿编辑.css 的「资产页签分类」那段。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./资产路径.js'), require('./关键帧绑定.js'));
  else root.AssetRail = factory(root.AssetPath, root.ShotBind);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (AP, SB) {
  'use strict';
  const TYPES = ['关键帧', '人物道具', '场景'], TABS = [...TYPES, '已引用', '未引用'];
  const DIR_TYPE = { [AP.KF]: '关键帧', [AP.CP]: '人物道具', [AP.SC]: '场景' };
  /* 这一样归哪一类：照放在哪个文件夹；不在这三处的给 '' */
  const typeOf = a => (a && DIR_TYPE[AP.placeOf(a.path).where]) || '';
  const isBaimo = a => !!a && a.type === '视频' && /白模/.test(a.name);
  const order = (a, b) => (a.kind === 'person' ? 0 : 1) - (b.kind === 'person' ? 0 : 1) || a.name.localeCompare(b.name, 'zh', { numeric: true });   // 人物排前面，再照名字（镜头2 在镜头10 前面）

  /* ---------- 绑在哪一镜：只看流水线里的「关键帧绑定」，不看文件名 ---------- */
  /* 页面给的 { paras: 这一场的镜头表, mine: 这一条拍的号, binds: ShotBind.bindsOf(这一场) } → 用得上的样子（mine 只留表里有的） */
  function prep(x) {
    const paras = Array.isArray(x && x.paras) ? x.paras : [], nos = SB.nosOf(paras);
    const mine = [...new Set(((x && x.mine) || []).map(SB.normNo))].filter(n => nos.includes(n));
    return { paras, nos, mine, binds: x && x.binds && typeof x.binds === 'object' ? x.binds : {} };
  }
  const bindOf = (a, sh) => (a && sh && sh.binds[a.path]) || null;
  const isMine = (a, sh) => { const b = bindOf(a, sh); return !!b && sh.mine.includes(b.镜); };
  /* 绑在这一条拍的镜头上的（mine）、别的（rest），先后不动。sh：sort 给的 */
  function split(list, sh) {
    const out = { mine: [], rest: [] };
    for (const a of list || []) (isMine(a, sh) ? out.mine : out.rest).push(a);
    return out;
  }
  /* 一类里面的先后：绑了的照镜头表、开头中间结尾、现用在前（ShotBind.order）；没绑的、绑的那一镜删了的放后面，照名字 */
  function byBind(list, sh) {
    const xs = [...list].sort(order);
    if (!Object.keys(sh.binds).length) return xs;
    const at = new Map(xs.map(a => [a.path, a]));
    return SB.order(xs.map(a => a.path), sh.paras, sh.binds).map(f => at.get(f));
  }
  /* 图上那一行：绑在哪（镜9 开头、镜11 开头 · 备选）。没绑的给 null */
  function tagOf(a, sh) {
    const b = bindOf(a, sh);
    if (!b) return null;
    return { text: '镜' + b.镜 + ' ' + SB.SAY[b.刻] + (b.备选 ? ' · 备选' : '') + (sh.nos.includes(b.镜) ? '' : '（删了）'),
      title: '绑在' + SB.say(b, sh.paras) + (b.备选 ? '，备选' : '') + '（流水线「资产」那一步绑的）' };
  }
  /* 这一条拍的镜头里一张关键帧都没绑的号。这一场一张都没绑过（老项目）不说，给 [] */
  function lackOf(all, sh) {
    const got = new Set((all || []).map(a => bindOf(a, sh)).filter(Boolean).map(b => b.镜));
    return got.size ? sh.mine.filter(n => !got.has(n)) : [];
  }

  /* 分好类，只算不画。
     all：页面扫到的全部；used：挂了编号的（照编号排好）；show(a)：没挂的列不列；hit(a)：合不合搜索；q：搜的字；shots：见 prep，没有就全摆。
     给 { lists: 每个页签列哪些, n: 每个页签几个（合搜索的）, tabs: 摆哪几个页签, sh: 镜头和绑定（sh.on：「关键帧」只摆这一条拍的；split、tagOf、lackOf 用） } */
  function sort(all, opt) {
    const o = opt || {}, used = (o.used || []).filter(Boolean), show = o.show || (() => true), hit = o.hit || (() => true), sh = prep(o.shots);
    sh.on = sh.mine.length > 0 && (all || []).some(a => !!bindOf(a, sh));   // 知道拍哪几镜、这一场绑过关键帧
    const on = new Set(used.map(a => a.path)), seen = new Set(), lists = {}, has = {};
    for (const k of TABS) { lists[k] = []; has[k] = 0; }
    for (const a of [...used, ...(all || [])]) {
      if (!a || seen.has(a.path)) continue;
      seen.add(a.path);
      const isUsed = on.has(a.path);
      if (!isUsed && !show(a)) continue;   // 挂上的照列，没确认可用的页面自己标
      const t = typeOf(a), hits = hit(a), off = sh.on && !o.q && t === '关键帧' && !isMine(a, sh);   // 不是这一条拍的：不搜就不摆（已引用照列）
      for (const k of [isUsed ? '已引用' : '未引用', ...(t ? [t] : [])]) { if (off && k !== '已引用') continue; has[k]++; if (hits) lists[k].push(a); }
    }
    for (const k of [...TYPES, '未引用']) lists[k] = byBind(lists[k], sh);   // 已引用照编号，不重排
    const n = {};
    for (const k of TABS) n[k] = lists[k].length;
    return { lists, n, tabs: TABS.filter(k => k !== '场景' || has.场景), sh };
  }

  /* 一类里面分块：图、白模视频、别的视频、声音（点「关键帧」先看到的是图）。给 [{ k, label, unit, items }]，空的不给 */
  function blocksOf(list, voice) {
    const vid = (list || []).filter(a => a.type === '视频'), aud = (list || []).filter(a => a.type === '音频'), bm = vid.filter(isBaimo);
    return [
      { k: 'img', label: '图片', unit: '张', items: (list || []).filter(a => a.type === '图片') },
      { k: 'baimo', label: '白模视频', unit: '个', items: bm },
      { k: 'vid', label: bm.length ? '其他视频' : '视频', unit: '个', items: vid.filter(a => !isBaimo(a)) },
      { k: 'aud', label: aud.length && voice && aud.every(voice) ? '人物音色' : '音频', unit: '个', items: aud },
    ].filter(b => b.items.length);
  }

  /* ---------- 画 ---------- */
  const KEY = 'xiegao.asset-tab';
  let TAB = '';
  const saved = () => { try { return sessionStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  function pick(k) { TAB = k; try { sessionStorage.setItem(KEY, k); } catch (e) { /* 存不了就只记在页面里 */ } }
  const TAB_TIP = {
    关键帧: '只给这一段用的：首帧、空镜、白模、参考截图（资产 / 关键帧 / 第N段）',
    人物道具: '各段通用的人物、道具、特效和人物音色（资产 / 人物和道具）',
    场景: '各段通用的场景图（资产 / 场景）',
    已引用: '这份提示词挂了编号的，照编号排',
    未引用: '能用、还没挂进这份提示词的',
  };
  const SAY = {
    关键帧: '这一段的首帧、空镜、白模',
    人物道具: '各段通用的人物、道具、人物音色',
    场景: '各段通用的场景图',
    已引用: '挂了编号的，照编号排；编号页面自己管',
    未引用: '能用、还没挂进这份的',
  };
  const TIP = '点图放大，点视频播放。鼠标移上去点「钉住」放在这一栏最上面，一边写一边看；点「插入」挂到提示词里。';

  /* 画资产页签。el：{ tabs: 分类那一排, hint: 底下一句话, list: 列表 }（三个格子页面先摆好）。
     o：all、used、show、hit、shots：同 sort；q：搜的字；ok：只列确认可用的（说明里讲一句）；seg：这一段的文件夹名；voice(a)：是不是人物音色；
        row(a, 同块)：已引用的一行；card(a, 同块)：视频卡；tile(a, 同块, 绑在哪 { text, title } 或 null)：一张图；audio(a, 同块)：声音一行；repaint()：换了页签重画整栏。
     给现在看的那一类 */
  function paint(el, o) {
    const { h } = globalThis.UI, s = sort(o.all, o);
    if (!TAB) TAB = saved();
    const tab = s.tabs.includes(TAB) ? TAB : s.tabs[0];
    const go = k => { pick(k); o.repaint(); const sc = el.list.closest('.rail-body'); if (sc) sc.scrollTop = 0; };
    const btn = k => h('button', { type: 'button', class: 'as-tab' + (k === tab ? ' on' : '') + (s.n[k] ? '' : ' zero'), role: 'tab', 'aria-selected': String(k === tab), 'data-tab': k, title: TAB_TIP[k],
      onclick: () => { if (k !== tab) go(k); } }, k, h('i', null, String(s.n[k])));
    el.tabs.replaceChildren(...s.tabs.filter(k => TYPES.includes(k)).map(btn), h('span', { class: 'as-sep', 'aria-hidden': 'true' }), btn('已引用'), btn('未引用'));
    const only = tab === '关键帧' && s.sh.on;   // 只摆这一条拍的镜头的
    el.hint.textContent = (o.ok && tab !== '已引用' ? '只列确认可用的。' : '') + (only ? '只摆这一条拍的镜头；别的搜得到' : SAY[tab]);   // 挂上的不管确认没有都列，已引用那页不说这句
    el.hint.title = (only ? '只摆绑在这一条拍的镜头上的（照流水线的关键帧绑定，不看文件名）。别的镜头的、白模、空镜：在上面搜，或在正文里打 @。\n' : '')
      + (tab === '关键帧' && o.seg ? '资产 / 关键帧 / ' + o.seg + '\n' : '') + TIP;
    el.list.replaceChildren(...body(tab, s, o, go));
    return tab;
  }
  function body(tab, s, o, go) {
    const { h } = globalThis.UI, list = s.lists[tab], sh = s.sh, out = [], only = sh.on && tab === '关键帧';
    if (!list.length && !(only && !o.q)) return [empty(tab, s, o, go)];   // 只摆这一条拍的、没在搜：一张没有也摆标题，说清是哪几镜
    if (tab === '已引用') return [h('div', { class: 'used-list' }, list.map(a => o.row(a, list)))];
    const head = (label, n) => h('div', { class: 'as-h' }, h('span', null, label), h('em', null, n));
    const blocks = (xs, t) => blocksOf(xs, o.voice).map(b => blockEl(b, t, o, sh));
    /* 只摆这一条拍的时候：这一条拍的一块在前；搜的时候搜到的别的跟在后面 */
    const mineFirst = (xs, t) => {
      const { mine, rest } = split(xs, sh);
      return [...(mine.length ? [mineHead(sh, mine), ...blocks(mine, t)] : []), ...(rest.length ? [head('别的镜头、没绑的 · 搜到的', rest.length + ' 个'), ...blocks(rest, t)] : [])];
    };
    if (tab === '未引用') {   // 一类一个标题，底下不再分小标题
      for (const t of [...TYPES, '']) {
        const xs = list.filter(a => typeOf(a) === t);
        if (xs.length) out.push(h('div', { class: 'as-h as-type' }, h('span', null, t || '别处'), h('em', null, xs.length + ' 个')), ...(sh.on && t === '关键帧' ? mineFirst(xs, t) : blocks(xs, t)));
      }
      return out;
    }
    if (only && o.q) return mineFirst(list, tab);
    if (only) {
      const lack = lackOf(o.all, sh);
      out.push(mineHead(sh, list));
      if (lack.length) out.push(h('p', { class: 'as-lack', title: '到流水线「资产」那一步的「关键帧」一块里绑' }, '镜' + lack.join('、') + ' 还没绑关键帧'));
      if (!list.length && o.ok && lack.length < sh.mine.length) out.push(h('div', { class: 'as-empty' }, '绑的关键帧还没确认可用：回流水线，看过能用的点「确认可用」。'));
      return [...out, ...blocks(list, tab)];
    }
    const bs = blocksOf(list, o.voice);
    for (const b of bs) {
      if (bs.length > 1) out.push(head(b.label, b.items.length + ' ' + b.unit));
      out.push(blockEl(b, tab, o, sh));
    }
    return out;
  }
  /* 「这一条拍的 · 镜8、11-14」那一块的标题 */
  function mineHead(sh, mine) {
    const { h } = globalThis.UI, unit = mine.every(a => a.type === '图片') ? ' 张' : ' 个';
    return h('div', { class: 'as-h as-mine', title: '绑在这一条拍的镜头上的，照镜头表排：只看流水线里的关键帧绑定，不看文件名。别的镜头的、白模、空镜：在上面搜' },
      h('span', null, '这一条拍的 · 镜' + SB.codeOf(sh.mine, sh.nos).replace(/\.txt$/i, '')), mine.length ? h('em', null, mine.length + unit) : null);
  }
  function blockEl(b, t, o, sh) {
    const { h } = globalThis.UI;
    if (b.k === 'img') return h('div', { class: 'as-grid' + (t === '关键帧' || t === '场景' ? ' wide' : '') }, b.items.map(a => o.tile(a, b.items, tagOf(a, sh))));
    return h('div', { class: 'as-block' }, b.items.map(a => (b.k === 'aud' ? o.audio : o.card)(a, b.items)));
  }
  function empty(tab, s, o, go) {
    const { h } = globalThis.UI;
    if (o.q) {   // 搜的时候这一类没有：别的页签里有的点了过去
      const there = s.tabs.filter(k => k !== tab && s.n[k]);
      return h('div', { class: 'as-empty' }, there.length ? '这一类里没找到，在：' : '没找到。', ...there.map(k => h('button', { type: 'button', class: 'mini-b', onclick: () => go(k) }, k + ' ' + s.n[k])));
    }
    const say = tab === '已引用' ? '还没挂素材：在别的页签点「插入」，或在正文里打 @。'
      : tab === '未引用' ? '能用的都挂上了。'
      : o.ok ? '这一类还没有确认可用的：回流水线，看过能用的点「确认可用」。' : '这一类还没有文件。';
    return h('div', { class: 'as-empty' }, say);
  }

  return { TABS, TYPES, typeOf, isBaimo, sort, split, tagOf, lackOf, blocksOf, paint };
});
