/* ============================================================
   流水线 · 镜头表浮窗（2026-11-16 他要的：写提示词时镜头表放在一边，随时看）
   钉在左边、步骤条下面，不跟着页面滚；镜头多了在框里自己滚。点「收起」缩成左边一个小签，点小签再打开；开着收着记在这台电脑的浏览器里。
   左边空得下就摆在空白里；窗口窄、空不下：没动过就先收着，你点开了就盖在正文上面。
   挂在 body 上、不进 #wf：页面重画不冲掉框里滚到哪。这里只看，镜头表在「提炼」那一步改。
   鼠标停在一条提示词上，它拍的那几镜标出来（页面调 ShotFloat.mark(号列表)）。审片那一步也钉这一个，停在一条样片上标出它拍的几镜（11-20）。
   作用的标签画成色块、每镜写预估秒数、顶上写合计（11-16，公用/镜头作用.js；页面要先引它）。
   用法：在 流水线.js 后面引这个文件，页面 render() 里调 ShotFloat.paint(这一场)。摆法 layout() 在 通用工具/测试/镜头表浮窗_测试.cjs 里测。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShotFloat = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GAP = 16, MIN = 200, MAX = 300;   // 离窗口左边、离正文各空 16；框宽 200～300
  /* 摆法。flLeft：正文那一栏离窗口左边多远；pref：'on' 你点开过、'off' 你收起过、'' 没动过；vw：窗口多宽。
     给 { mode: 'dock' 摆在左边空白里 | 'float' 盖在正文上 | 'tab' 收成小签, width } */
  function layout(flLeft, pref, vw) {
    if (pref === 'off') return { mode: 'tab', width: 0 };
    const room = Math.floor(flLeft - GAP * 2);
    if (room >= MIN) return { mode: 'dock', width: Math.min(MAX, room) };
    if (pref === 'on') return { mode: 'float', width: Math.max(160, Math.min(MAX, Math.floor(vw - GAP * 2))) };
    return { mode: 'tab', width: 0 };
  }
  if (typeof document === 'undefined') return Object.freeze({ layout });

  const KEY = 'antou:flow:shot-float';
  const str = v => typeof v === 'string' ? v : '';
  const prefNow = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  let box = null, tab = null, list = null, count = null, has = false, sig = '', marked = [];
  function setPref(v) {
    try { localStorage.setItem(KEY, v); } catch (e) { /* 记不住就只管这一回 */ }
    place();
    if (v === 'off') tab.focus(); else box.querySelector('.sf-h button').focus();
  }
  function ensure() {
    if (box) return;
    const { h } = window.UI;
    list = h('ol', { class: 'sf-list' });
    count = h('span', { class: 'faint small' });
    box = h('aside', { class: 'wf-sf', 'aria-label': '镜头表', hidden: '' },
      h('div', { class: 'sf-h', title: '这一段的镜头表，在「提炼」那一步改。\n鼠标停在一条提示词或样片上，它拍的那几镜在这里标出来' },
        h('b', null, '镜头表'), count, h('span', { class: 'sp' }),
        h('button', { class: 'fl-link', type: 'button', title: '收到左边，点「镜头表」小签再打开', onclick: () => setPref('off') }, '收起')),
      list);
    tab = h('button', { class: 'wf-sf-tab', type: 'button', title: '打开镜头表', hidden: '', onclick: () => setPref('on') }, '镜头表');
    document.body.append(box, tab);
    window.addEventListener('resize', place);
  }
  /* 量一下正文在哪、步骤条多高，摆好 */
  function place() {
    if (!box) return;
    document.body.classList.toggle('sf-none', !has || prefNow() === 'off');   // 左边不钉镜头表：提示词页的正文回到正中（流水线.css .wf-pp）。只看收没收起，不看量出来的，先挂上再量
    if (!has) { box.hidden = tab.hidden = true; return; }
    const fl = document.getElementById('fl-body'), steps = document.getElementById('wf-steps');
    const top = Math.round(steps ? Math.max(0, steps.getBoundingClientRect().bottom) + 14 : 130);
    const L = layout(fl ? fl.getBoundingClientRect().left : 0, prefNow(), window.innerWidth);
    box.hidden = L.mode === 'tab';
    tab.hidden = L.mode !== 'tab';
    box.classList.toggle('float', L.mode === 'float');
    box.style.top = tab.style.top = top + 'px';
    if (L.width) box.style.width = L.width + 'px';
    box.style.maxHeight = Math.max(160, window.innerHeight - top - GAP) + 'px';
  }
  /* 画这一场的镜头表。内容没变不重画；变了也留着框里滚到哪 */
  function paint(s) {
    ensure();
    const rows = s && Array.isArray(s.段落) ? s.段落 : [];
    has = rows.length > 0;
    if (has) {
      const W = window.ShotWhy, nos = window.ShotBind.nosOf(rows), key = JSON.stringify([s.段, nos, rows.map(x => [str(x.写什么), str(x.作用), W.secOf(x)])]);
      if (key !== sig) {
        const { h } = window.UI, y = list.scrollTop;
        sig = key;
        list.replaceChildren(...rows.map((x, i) => h('li', { 'data-no': nos[i] },
          h('span', { class: 'n' }, '镜头' + nos[i]), h('span', null, str(x.写什么).trim() || '—', W.secOf(x) ? h('span', { class: 'faint' }, '　' + W.secOf(x) + ' 秒') : null),
          str(x.作用).trim() ? h('span', { class: 'y' }, ...W.bits(x.作用, h)) : null)));
        const sum = W.sum(rows);
        count.textContent = rows.length + ' 镜' + (sum.total ? ' · ' + sum.say : '');
        list.scrollTop = y;
        mark(marked);
      }
    }
    place();
    setTimeout(place, 0);   // 页面画上去以后再量一次正文在哪
  }
  /* 标出这几镜（号的列表；空的就是都不标）。标的那几镜不在框里看得见的地方，框里滚过去（页面不动） */
  function mark(nos) {
    marked = Array.isArray(nos) ? nos.map(String) : [];
    if (!list) return;
    let first = null;
    for (const li of list.children) { const on = marked.includes(li.dataset.no); li.classList.toggle('on', on); if (on && !first) first = li; }
    if (!first || box.hidden) return;
    const last = [...list.children].filter(li => li.classList.contains('on')).pop();
    const a = first.offsetTop - list.offsetTop, b = last.offsetTop - list.offsetTop + last.offsetHeight;
    if (a < list.scrollTop) list.scrollTop = a - 4;
    else if (b > list.scrollTop + list.clientHeight) list.scrollTop = Math.min(a - 4, b - list.clientHeight + 4);
  }
  return Object.freeze({ layout, paint, mark, place });
});
