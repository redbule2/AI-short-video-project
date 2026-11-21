/* ============================================================
   公用 · 审片台右栏的「镜头表」页签（2026-11-20 他要的：审片两页都加镜头表；「审片」那一步左边钉的是 流水线/镜头表浮窗.js）
   整段的镜头表照写稿页那一个画（公用/写稿镜头表.js 的 paint，只看不改），这一条拍的几镜标亮；放到哪儿，那一镜标「在放」。
   提示词里的「镜头1、镜头2」是这一条自己的编号，和镜头表的号对不上，所以这样认放到了镜头表哪一镜：
     这一条只拍镜头表的一镜：就是它；
     提示词分的镜头数和这一条拍的几镜一样多、每一镜跟得上秒数：一镜对一镜；
     别的照镜头表估的秒数一镜接一镜排，样片长短对不上就按比例伸缩，标「大约在放」。
   用法：先引 界面.js、镜头作用.js、关键帧绑定.js、写稿镜头表.js，再引这个；样子在 公用/写稿镜头表.css。
     页签：DeskShots.pane(a) 给一个格子，页面摆进右栏。a：{ list: 镜头表那几行, name: 提示词文件名, code: 名字里的镜头号,
       t: 放到第几秒, dur: 样片几秒, cuts: 提示词每一镜 [开始秒, 结束秒]（没跟上秒数给 null） }
     放的时候调 DeskShots.tick(第几秒, 能不能替你滚)：换了一镜才动。
   nowOf() 只算不画，测试在 通用工具/测试/审片镜头表_测试.cjs。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./写稿镜头表.js'));
  else root.DeskShots = factory(root.WriteShots);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (WS) {
  'use strict';
  /* 放到第 a.t 秒，在镜头表哪一镜：{ no: 号, sure: 一镜对一镜认的（false：照秒数估的） }；认不出给 null */
  function nowOf(a) {
    const mine = WS.view(a.list, a.name, a.code).rows.filter(r => r.me);
    if (!mine.length) return null;
    if (mine.length === 1) return { no: mine[0].no, sure: true };
    const t = Math.max(0, +a.t || 0), cuts = Array.isArray(a.cuts) ? a.cuts : [];
    if (cuts.length === mine.length) {
      let i = 0;
      cuts.forEach((c, k) => { if (t >= c[0] - 1e-6) i = k; });
      return { no: mine[i].no, sure: true };
    }
    const secs = mine.map(r => +r.sec || 0), total = secs.reduce((x, y) => x + y, 0);
    if (!total || secs.includes(0)) return null;   // 有一镜没估秒数：排不出
    const at = a.dur > 0 ? Math.min(t, a.dur) / a.dur * total : t;
    let end = 0;
    for (let k = 0; k < mine.length; k++) { end += secs[k]; if (at < end - 1e-6) return { no: mine[k].no, sure: false }; }
    return { no: mine[mine.length - 1].no, sure: false };
  }
  if (typeof document === 'undefined') return Object.freeze({ nowOf });

  const S = { box: null, a: null, key: null };   // box：右栏里的格子（一直用这一个，换页签再回来高矮不变）；a：上回画的那几样；key：现在标的那一镜
  /* 标出在放的那一镜（那一行和色带上那一块）。roll：那一行不在看得见的地方就把右栏滚过去，钉在顶上的那一块不算看得见 */
  function mark(roll) {
    const n = S.a ? nowOf(S.a) : null, key = n ? n.no + (n.sure ? '' : '~') : '';
    if (key === S.key) return;
    S.key = key;
    let li = null;
    for (const el of S.box.querySelectorAll('[data-no]')) {
      const on = !!n && el.dataset.no === n.no;
      el.classList.toggle('now', on); el.classList.toggle('est', on && !n.sure);
      if (on && el.tagName === 'LI') li = el;
    }
    const sc = S.box.parentElement;
    if (!roll || !li || !sc) return;
    const head = S.box.querySelector('.ws-head'), b = sc.getBoundingClientRect(), top = b.top + (head ? head.offsetHeight : 0), r = li.getBoundingClientRect();
    if (r.top < top || r.bottom > b.bottom) sc.scrollTop += r.top - top - (b.bottom - top - r.height) / 3;
  }
  function draw() {
    WS.paint(S.box, S.a.list, S.a.name, S.a.code);
    S.key = null; mark(false);
  }
  function pane(a) {
    if (!S.box) S.box = window.UI.h('div', { class: 'dk-shots' });
    S.a = Object.assign({}, a);
    draw();   // 先画上：页面摆进右栏、找回滚到哪的时候高矮就对
    queueMicrotask(() => { if (S.box.isConnected) draw(); });   // 摆进右栏以后再画一回：头一回打开滚到这一条拍的几镜（写稿镜头表.js 只在格子摆上去以后才滚）
    return S.box;
  }
  function tick(t, roll) {
    if (!S.box || !S.box.isConnected || !S.a) return;
    S.a.t = t;
    mark(roll);
  }
  return Object.freeze({ nowOf, pane, tick });
});
