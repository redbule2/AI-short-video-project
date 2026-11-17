/* ============================================================
   公用 · 写稿页右栏的「镜头表」页签（2026-11-16 他定，照 通用工具/流水线/写稿页带镜头表_设计稿.html 的丙，色带要）
   整段的镜头表放进右栏：顶上一条色带（一块一镜，宽窄照秒数，颜色照作用标签），下面一镜一行：号、写什么、作用、秒数。
   这一条提示词拍的那几镜标亮、色带上实色，别的淡；打开页签先滚到这几镜。只看不改：镜头表在流水线「提炼」那一步改。
   拍哪几镜照名字认（关键帧绑定.js 的 shotsOf：1-5.txt 照表里的号，老稿 镜头6-9_视频提示词.txt 照名字里的数，视频提示词_02 这种认不出）。
   用法：先引 镜头作用.js（ShotWhy）、关键帧绑定.js（ShotBind）、界面.js（UI.h），再引这个；
     页面调 WriteShots.paint(格子, 镜头表那几行, 提示词文件名, 核心.js vpCode 认出的镜头号)。view() 只算不画，测试在 通用工具/测试/写稿镜头表_测试.cjs。
   作用标签的颜色在 写稿编辑.css，和 流水线/流水线.css 的 .sw-t 一样，改要两处一起改。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./镜头作用.js'), require('./关键帧绑定.js'));
  else root.WriteShots = factory(root.ShotWhy, root.ShotBind);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W, SB) {
  'use strict';
  const str = v => typeof v === 'string' ? v.trim() : '';

  /* 算要画什么。list：这一场的镜头表（流水线.json 的「段落」）；name：提示词文件名；code：名字里的镜头号（没有给 ''）。
     给 { rows: [{ no, what, why, sec, me }], blocks: [{ no, cls, sec, flex, me }], mine: 这一条拍的号, say: 这一条那句, all: 全段那句 } */
  function view(list, name, code) {
    const xs = (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object');
    if (!xs.length) return { rows: [], blocks: [], mine: [], say: '', all: '' };
    const nos = SB.nosOf(xs), got = SB.shotsOf(code, name, nos), mine = got || [], me = no => mine.includes(no);
    const rows = xs.map((x, i) => ({ no: nos[i], what: str(x.写什么) || str(x.拍什么), why: str(x.作用), sec: W.secOf(x), me: me(nos[i]) }));
    const blocks = W.strip(xs).blocks.map(b => ({ no: nos[b.i], cls: W.TAGS[b.tag] || '', sec: b.sec, flex: Math.round(b.w * 10000) / 100, me: me(nos[b.i]) }));
    const sum = W.sum(xs), part = W.sum(xs.filter((x, i) => me(nos[i])));
    const lost = code ? SB.expand(code, nos).missing : [];
    const say = !got ? '这一条没照镜头号起名，标不出拍哪几镜'
      : mine.length ? '这一条拍 镜' + SB.codeOf(mine, nos).replace(/\.txt$/i, '') + (mine.length > 1 ? '（' + mine.length + ' 镜）' : '') + (part.say ? ' · ' + part.say : '') + (lost.length ? '；表里没有 镜' + lost.join('、') : '')
      : '这一条的镜头号在表里找不到' + (lost.length ? '：镜' + lost.join('、') : '');
    return { rows, blocks, mine, say, all: xs.length + ' 镜' + (sum.say ? ' · ' + sum.say : '') };
  }
  if (typeof document === 'undefined') return Object.freeze({ view });

  let shown = '';   // 滚到这一条那几镜：每份稿、每次拍的镜变了才滚，平时留着你滚到哪
  function paint(pane, list, name, code) {
    const { h } = window.UI, v = view(list, name, code);
    if (!v.rows.length) {
      pane.replaceChildren(h('p', { class: 'tab-intro' }, h('b', null, '这一段还没有镜头表。'), '在流水线「提炼」那一步提炼出来，这里就能看。'));
      return;
    }
    const tip = r => '镜头' + r.no + '　' + (r.what || '—') + (r.sec ? '　' + r.sec + ' 秒' : '');
    pane.replaceChildren(
      h('p', { class: 'tab-intro' }, h('b', null, '这一段的镜头表。'), '这一条拍的几镜标亮。只看不改，要改在流水线「提炼」那一步。'),
      h('div', { class: 'ws-head' },   // 色带和合计钉在右栏顶上，往下翻也看得见
        h('div', { class: 'ws-strip', title: '一块一镜，宽窄照秒数，颜色照作用标签' },
          v.blocks.map((b, i) => h('i', { class: [b.cls, b.me ? 'me' : ''].filter(Boolean).join(' ') || null, style: 'flex:' + b.flex, title: tip(v.rows[i]) }))),
        h('div', { class: 'ws-cap' }, h('span', { class: v.mine.length ? 'on' : null }, v.say), h('span', null, v.all))),
      h('ol', { class: 'ws-list' }, v.rows.map(r => h('li', { class: r.me ? 'me' : null, 'data-no': r.no },
        h('span', { class: 'n' }, r.no),
        h('div', null, h('b', null, r.what || '—'), r.why ? h('small', null, ...W.bits(r.why, h)) : null),
        h('span', { class: 'sc' }, r.sec ? r.sec + ' 秒' : '—')))));
    /* 只滚格子外面那个会滚的框（右栏），不用 scrollIntoView：写稿页嵌在流水线里，免得把外面的页面也带着滚 */
    const key = name + '|' + v.mine.join(','), first = pane.querySelector('.ws-list li.me'), box = pane.parentElement;
    if (key !== shown && first && box && !pane.hidden) { shown = key; box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3; }
  }
  return Object.freeze({ view, paint });
});
