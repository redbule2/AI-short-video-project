/* ============================================================
   公用 · 写稿页右栏的「镜头表」页签（2026-11-16 他定，照 通用工具/流水线/写稿页带镜头表_设计稿.html 的丙，色带要）
   整段的镜头表放进右栏：顶上一条色带（一块一镜，宽窄照秒数，颜色照作用标签），下面一镜一行：号、写什么、作用、秒数。
   这一条提示词拍的那几镜标亮、色带上实色，别的淡；打开页签先滚到这几镜。镜头的字在流水线「提炼」那一步改。
   11-20 他要进去写以后照样能加镜头、去掉镜头：能改的，每一镜前面一个勾，勾的就是这一条拍的；勾得和现在不一样，顶上出一条「改成 镜…」，
   点了才改（名字跟着改，改过几版的前几版一起改，写稿页那头在 公用/写稿改镜头.js）。只有 AI 正在做这一条时要等，页签上写为什么。
   拍哪几镜照名字认（关键帧绑定.js 的 shotsOf：1-5.txt 照表里的号，老稿 镜头6-9_视频提示词.txt 照名字里的数，视频提示词_02 这种认不出）。
   用法：先引 镜头作用.js（ShotWhy）、关键帧绑定.js（ShotBind）、界面.js（UI.h），再引这个；
     页面调 WriteShots.paint(格子, 镜头表那几行, 提示词文件名, 核心.js vpCode 认出的镜头号, 改镜头的几样)。
     改镜头的几样：{ lock: 要等的原因（能改给 ''）, apply(勾的号) → 改成了给 true, note: 改完提醒的一句 }；不给就只看不改。
     view()、plan() 只算不画，测试在 通用工具/测试/写稿镜头表_测试.cjs。
   审片台右栏的「镜头表」也用它画（只看不改，11-20；放到哪一镜标「在放」在 公用/审片镜头表.js，照每一行、每一块的 data-no 认）。
   样子在 公用/写稿镜头表.css（作用标签的颜色和 流水线/流水线.css 的 .sw-t 一样，改要两处一起改）。
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./镜头作用.js'), require('./关键帧绑定.js'));
  else root.WriteShots = factory(root.ShotWhy, root.ShotBind);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W, SB) {
  'use strict';
  const str = v => typeof v === 'string' ? v.trim() : '';
  const rowsOf = list => (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object');

  /* 算要画什么。list：这一场的镜头表（流水线.json 的「段落」）；name：提示词文件名；code：名字里的镜头号（没有给 ''）。
     给 { rows: [{ no, what, why, sec, me }], blocks: [{ no, cls, sec, flex, me }], mine: 这一条拍的号, say: 这一条那句, all: 全段那句 } */
  function view(list, name, code) {
    const xs = rowsOf(list);
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
  /* 勾成这样，改成什么（11-20）。picked：勾着的号（先后不管，照表里排）。
     给 { pick: 勾的号, to: 新名字（一镜都没勾给 ''）, same: 和现在拍的一样, add: 加的号, drop: 去掉的号, say: 加了去了哪几镜, sum: 改完拍几镜几秒 } */
  function plan(list, name, code, picked) {
    const xs = rowsOf(list), nos = SB.nosOf(xs), now = SB.shotsOf(code, name, nos) || [], set = new Set((picked || []).map(SB.normNo));
    const pick = nos.filter(n => set.has(n)), to = SB.codeOf(pick, nos), part = W.sum(xs.filter((x, i) => set.has(nos[i])));
    const add = pick.filter(n => !now.includes(n)), drop = now.filter(n => !set.has(n));
    const say = [add.length ? '加 镜' + add.join('、') : '', drop.length ? '去掉 镜' + drop.join('、') : ''].filter(Boolean).join('，');
    const head = to.replace(/\.txt$/i, ''), nm = String(name || ''), tail = code && nm.startsWith(code) ? nm.slice(String(code).length) : '.txt';   // 改过几版的：9b-9d_改1.txt 改完叫 9b-9e_改1.txt
    return { pick, to, code: head, name: to ? head + tail : '', same: !add.length && !drop.length, add, drop, say: to ? say : '一镜都没勾：至少留一镜',
      sum: to ? pick.length + ' 镜' + (part.say ? ' · ' + part.say : '') : '' };
  }
  if (typeof document === 'undefined') return Object.freeze({ view, plan });

  let shown = '';   // 滚到这一条那几镜：每份稿、每次拍的镜变了才滚，平时留着你滚到哪
  const ED = { key: '', pick: null, busy: false };   // 勾了还没改的（换了一份稿、改好了就清掉）；busy：正在改名
  function paint(pane, list, name, code, opt) {
    const { h } = window.UI, v = view(list, name, code);
    if (!v.rows.length) {
      pane.replaceChildren(h('p', { class: 'tab-intro' }, h('b', null, '这一段还没有镜头表。'), '在流水线「提炼」那一步提炼出来，这里就能看。'));
      return;
    }
    const key = name + '|' + v.mine.join(',');
    if (ED.key !== key) { ED.key = key; ED.pick = null; ED.busy = false; }   // 换了一份稿、改好了换了名字：勾的、正在改的都清掉
    const can = !!opt && !opt.lock && !!code, pick = can && ED.pick ? ED.pick : v.mine;
    const p = can && ED.pick ? plan(list, name, code, ED.pick) : null, change = !!p && !p.same;
    const on = no => pick.includes(no);
    const redo = focus => {
      paint(pane, list, name, code, opt);
      if (focus) { const i = pane.querySelector('li[data-no="' + focus + '"] input'); if (i) i.focus({ preventScroll: true }); }
    };
    const toggle = no => { const s = new Set(pick); s.has(no) ? s.delete(no) : s.add(no); ED.pick = v.rows.map(r => r.no).filter(n => s.has(n)); redo(no); };
    const go = async () => {
      if (ED.busy || !p || !p.to) return;
      ED.busy = true; redo();
      let ok = false;
      try { ok = await opt.apply(p.pick); } catch (e) { ok = false; }
      ED.busy = false;
      if (!ok) redo();   // 改成了：写稿页换成新名字，自己会重画这一页
    };
    const tip = r => '镜头' + r.no + '　' + (r.what || '—') + (r.sec ? '　' + r.sec + ' 秒' : '');
    const mark = r => p && p.add.includes(r.no) ? 'add' : p && p.drop.includes(r.no) ? 'drop' : '';
    const intro = can ? ['勾的是这一条拍的几镜：要加一镜、去掉一镜，在这里勾。镜头的字在流水线「提炼」那一步改。']
      : opt && opt.lock ? ['这一条拍的几镜标亮。', h('small', null, opt.lock)]   // 只剩要等的（AI 正在做这一条）
        : ['这一条拍的几镜标亮。只看不改，要改在流水线「提炼」那一步。'];
    pane.replaceChildren(...[   // replaceChildren 会把 null 写成字，先筛掉
      h('p', { class: 'tab-intro' }, h('b', null, '这一段的镜头表。'), ...intro),
      opt && opt.note && !change ? h('p', { class: 'ws-note' }, opt.note) : null,
      h('div', { class: 'ws-head' },   // 色带和合计钉在右栏顶上，往下翻也看得见；勾得和现在不一样，「改成…」也钉在这里
        h('div', { class: 'ws-strip', title: '一块一镜，宽窄照秒数，颜色照作用标签' },
          v.blocks.map((b, i) => h('i', { class: [b.cls, on(b.no) ? 'me' : ''].filter(Boolean).join(' ') || null, 'data-no': b.no, style: 'flex:' + b.flex, title: tip(v.rows[i]) }))),
        h('div', { class: 'ws-cap' }, h('span', { class: v.mine.length ? 'on' : null }, v.say), h('span', null, v.all)),
        change ? h('div', { class: 'ws-act' + (p.to ? '' : ' warn') },
          h('div', { class: 'ws-act-t' }, h('b', null, p.say), p.to ? h('span', null, '改完拍 ' + p.sum + '，名字改成 ' + p.name) : null),
          h('div', { class: 'ws-act-b' },
            h('button', { class: 'btn sm ghost', type: 'button', disabled: ED.busy, onclick: () => { ED.pick = null; redo(); } }, '不改了'),
            p.to ? h('button', { class: 'btn sm dian', type: 'button', disabled: ED.busy, onclick: go }, ED.busy ? '正在改…' : '改成 镜' + p.code) : null)) : null),
      h('ol', { class: 'ws-list' + (can ? ' can' : '') }, v.rows.map(r => {
        const m = mark(r), body = [h('span', { class: 'n' }, r.no),
          h('div', null, h('b', null, r.what || '—'), r.why ? h('small', null, ...W.bits(r.why, h)) : null),
          h('span', { class: 'sc' }, m === 'add' ? h('em', null, '加') : m === 'drop' ? h('em', null, '去掉') : null, r.sec ? r.sec + ' 秒' : '—')];
        return h('li', { class: [on(r.no) ? 'me' : '', m].filter(Boolean).join(' ') || null, 'data-no': r.no },
          can ? h('label', { class: 'ws-row', title: on(r.no) ? '去掉这一镜' : '把这一镜加进这一条' }, h('input', { type: 'checkbox', checked: on(r.no), disabled: ED.busy, 'aria-label': '镜头' + r.no, onchange: () => toggle(r.no) }), ...body) : body);
      }))].filter(Boolean));
    /* 只滚格子外面那个会滚的框（右栏），不用 scrollIntoView：写稿页嵌在流水线里，免得把外面的页面也带着滚 */
    const sk = name + '|' + v.mine.join(','), first = pane.querySelector('.ws-list li.me'), box = pane.parentElement;
    if (sk !== shown && first && box && !pane.hidden) { shown = sk; box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientHeight / 3; }
  }
  return Object.freeze({ view, plan, paint });
});
