/* ============================================================
   资产页顶上「出图」（2026-11-23 他定）：人只挑哪几样要出、哪几样不出，勾好一次交出去。
   一样开一个 Codex 新对话，话自动发进去（本机服务一个一个发），Codex 先照字出第一张；
   你在那个对话里聊，要改就说，满意了说「定稿」，这里换上、算确认可用。
   有字没图的默认勾上；已经有图的不勾（勾上是重出，定稿前旧图照用）；出不了的（没字、只用文字、AI 在写字、已经在出）摆在后面说为什么。
   字还是文字描写的（以前点过「只用文字」，后来又改成要出图）：出不了，那一块有「让 AI 改成出图提示词」，几样一起改，改好你批过再出。
   缺脸部特写的人物（11-26，公用/人物卡.js：竖幅全身照）：有字的默认勾上，Codex 照原图重出成人物卡；没字的那一块有「让 AI 写成人物卡」。
   一样怎么出，和弹窗里的「在 Codex 里出图」同一个：流水线.js 的 askDraw；改成出图提示词和弹窗里的同一句要求（资产详情.js 的 adConvert）
   ============================================================ */
'use strict';
const DrawAll = (() => {
  const label = w => w.name + (w.state ? '（' + w.state + '）' : '');
  const CONV = '把原来的文字描写改写成出图提示词：样子照原来的，照出图规矩写';
  /* 字是不是文字描写：读一遍记下来（字的文件时间变了再读）。没读过的先当出图提示词，读完重画 */
  const kinds = new Map();
  let scanning = null;
  async function scan(ws) {
    let changed = false;
    for (const w of ws) {
      if (w.txtOnly || !w.hasTxt || typeof TxtWord !== 'object') continue;
      const t = F.words.get(w.txt) || 0, c = kinds.get(w.txt);
      if (c && c.t === t) continue;
      const text = await readText(w.txt);
      if (text == null) continue;   // 读不了：下回再读
      const txt = TxtWord.isTxt(text);
      if (!c || c.txt !== txt) changed = true;
      kinds.set(w.txt, { t, txt });
    }
    return changed;
  }
  const isTxtWord = w => !!(kinds.get(w.txt) || {}).txt;
  /* 一样能不能出、默认勾不勾、旁边写一句什么 */
  function stateOf(w) {
    if (w.txtOnly) return { why: '只用文字写，不出图' };
    if (w.drawing) return { why: '已经在 Codex 里出着' };
    if (w.writing) return { why: 'AI 在写字，写好再出' };
    if (!w.hasTxt) return w.noFace ? { why: '缺脸部特写，还没有出图提示词：先让 AI 写成人物卡', card: true } : { why: w.hasImg ? '已经有图（要重出，先写出图提示词）' : '还没写出图提示词' };   // 人物卡（11-26，公用/人物卡.js）
    if (isTxtWord(w)) return { why: '字还是文字描写（只用文字时写的）：先改成出图提示词', conv: true };
    if (w.hasNote) return { can: true, on: false, tx: '字的批注还没交给 AI 改：勾上就照现在的字出' };
    if (w.hasCand) return { can: true, on: false, tx: '有一张新图还没挑：勾上就把它收进历史记录，重出' };
    if (w.hasImg) return w.noFace ? { can: true, on: true, tx: '缺脸部特写：勾上照原图重出成人物卡（' + FaceCard.SHORT + '），定稿前旧图照用' } : { can: true, on: false, tx: '已经有图：勾上是重出，定稿前旧图照用' };
    return { can: true, on: true, tx: '有字，还没有图' };
  }
  const listOf = ws => { const seen = new Set(); return ws.filter(w => !seen.has(w.img) && seen.add(w.img)).map(w => ({ w, ...stateOf(w) })); };
  const todo = ws => listOf(ws).filter(x => x.on || x.conv || x.card).length;   // 「出图」里眼下要做的几样：有字没图的、缺脸部特写的（默认勾上）、字还是文字描写要先改的、缺脸部特写还没字的
  /* 顶上那个钮：有能出的、或者有要先改成出图提示词的才摆；默认勾上的几样算在名字里。ink：这一步眼下要按的就是它（深色）。
     after：重画这一页（字读完了、交出去了） */
  function button(s, ws, after, ink) {
    if (!scanning) scanning = scan(ws).then(ch => { scanning = null; if (ch && after) after(); }, () => { scanning = null; });
    const xs = listOf(ws), n = xs.filter(x => x.on).length, conv = xs.some(x => x.conv || x.card);
    if (!xs.some(x => x.can) && !conv) return null;
    return h('button', { class: 'btn sm' + (ink ? ' ink' : n || conv ? '' : ' ghost'), type: 'button', title: '勾好要出的几样：一样开一个 Codex 新对话，话自动发进去。在 Codex 里一样一样聊，满意了说「定稿」', onclick: () => open(s, ws, after) },
      n ? '出图（' + n + ' 样）' : '出图…');
  }
  async function open(s, ws, after) {
    await scan(ws).catch(() => false);
    const xs = listOf(ws), can = xs.filter(x => x.can), no = xs.filter(x => !x.can), conv = no.filter(x => x.conv).map(x => x.w), card = no.filter(x => x.card).map(x => x.w);
    const pick = new Set(can.filter(x => x.on).map(x => x.w.img));
    const go = h('button', { class: 'btn ink', type: 'button', 'data-focus': '' }), all = h('button', { class: 'fl-link', type: 'button' });
    const boxes = [];
    const paint = () => {
      go.disabled = !pick.size; go.textContent = pick.size ? '开 ' + pick.size + ' 个 Codex 对话' : '先勾要出的';
      all.textContent = pick.size === can.length ? '都不勾' : '全勾上';
      for (const b of boxes) b.checked = pick.has(b.value);
    };
    all.onclick = () => { if (pick.size === can.length) pick.clear(); else for (const x of can) pick.add(x.w.img); paint(); };
    const row = x => {
      const box = h('input', { type: 'checkbox', value: x.w.img, onchange: e => { e.target.checked ? pick.add(x.w.img) : pick.delete(x.w.img); paint(); } });
      boxes.push(box);
      return h('label', { class: 'da-row ' + kindCls(x.w.cat) }, box, h('b', { class: 'k-w' }, kindOf(x.w.cat)), h('span', { class: 'da-nm' }, label(x.w)), h('span', { class: 'da-tx' }, x.tx));
    };
    const rows = can.map(row);
    paint();
    const r = await dialog(close => {
      go.onclick = () => { if (pick.size) close({ draw: can.filter(x => pick.has(x.w.img)).map(x => x.w) }); };
      const el = dlgShell('出图 · 第' + s.段 + '段', '勾上的一样开一个 Codex 新对话，话自动发进去，Codex 先照字出第一张。你在那个对话里聊，要改就说；满意了说「定稿」，这里自动换上、算确认可用。',
        [rows.length ? h('div', { class: 'da-list' }, rows) : h('p', { class: 'fn-note' }, '这一段眼下没有能出的：看下面为什么'),
          can.length > 1 ? h('div', null, all) : null,
          no.length ? h('div', { class: 'da-no' }, h('b', null, '这几样现在出不了'), no.map(x => h('div', { class: 'da-row off ' + kindCls(x.w.cat) }, h('i'), h('b', { class: 'k-w' }, kindOf(x.w.cat)), h('span', { class: 'da-nm' }, label(x.w)), h('span', { class: 'da-tx' }, x.why))),
            conv.length ? h('div', null, h('button', { class: 'btn sm', type: 'button', title: 'AI 照原来的文字描写改写成出图提示词，样子照原来的（改之前的那一版收进历史记录）。改好你批过，再来这里出图', onclick: () => close({ conv }) }, '让 AI 改成出图提示词（' + conv.length + ' 样）')) : null,
            card.length ? h('div', null, h('button', { class: 'btn sm', type: 'button', title: 'AI 照现在的图和全片设定写人物卡的出图提示词（' + FaceCard.SHORT + '），样子照原来的。写好你批过，再来这里出图', onclick: () => close({ card }) }, '让 AI 写成人物卡（' + card.length + ' 样）')) : null) : null],
        [h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, '取消'), go]);
      el.classList.add('wide');
      return el;
    });
    if (!r) return;
    if (r.conv) { if (await askWords(s, r.conv, CONV)) toast('交给 AI 改了：改好在那几样的弹窗里批，字定了再来「出图」'); }
    else if (r.card) { if (await askWords(s, r.card, FaceCard.ASK)) toast('交给 AI 写了：写好在那几样的弹窗里批，字定了再来「出图」'); }
    else {
      let n = 0;
      for (const w of r.draw) if (await askDraw(s, w, true)) n++;
      if (n) toast('开了 ' + n + ' 个 Codex 对话，一个一个发进去。在 Codex 里一样一样聊，满意了说「定稿」，这里自动换上');
    }
    if (after) after();
  }
  return { button, open, todo };
})();
