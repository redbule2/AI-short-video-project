/* 写稿页写「初步剧本」（2026-11-21 他定先写提示词、第一步叫自由稿；11-26 他定改回先写剧本，叫初步剧本：只是初稿，成片照它二次创作）。
   存成 提示词/第N段/初步剧本.txt（11-26 以前建的段叫 自由稿.txt，照认：公用/核心.js 的 isPfFile）。
   整页一张稿纸，别的都不摆（素材这些分区、右栏、请 AI 批、交给 AI 写完）；标题右边一个「提炼分镜」：先存好，再叫流水线那头
   （流水线/剧本.html 的 wfFreeExtract）记下时间、交给 AI 照它提炼分镜。
   11-26 他要「写的舒服，开心」：字大、一行不太长；顶上一句打气的话，跟着写了多少换；人物小牌子点一下插名字（空行里点直接起一句台词）；
   底下写了多少字、这回多写了多少、存好没有；写在最后时，光标那一行不贴着屏幕底边。样子在 写稿自由稿.css。
   11-26 晚他又要「输入体验再好一点」：打开就回到上次写到的地方（光标、滚到哪，记在这台电脑上）；写到哪都让光标那一行停在屏幕大半截以上，
   不光是写在最后；Ctrl+S 立刻存一下；字号小、中、大三档；选了字，底下写选中多少字。
   写稿页过了 1500 行，这些放这里；写稿页里调的是 window.FreeDraft 的几样（init、nav、dress、HINT） */
(function () {
  'use strict';
  const is = () => typeof STEM === 'string' && Core.isPfFile(STEM + '.txt');
  const HINT = '想到哪写到哪，不用分镜头，也不用管格式。比如：\n面馆门口，傍晚。老周把面端到小男孩面前：“吃吧，不要钱。”小男孩埋头吃，老周在一旁看着笑。\n在哪、谁、做什么、说什么，写下来就好；想好的机位、声音也可以写。';
  const CHEER = [[1000, '写了一大段，真不少！写完了点右上角「提炼分镜」。'], [500, '越写越顺了，人和事都在纸上了。'], [150, '戏出来了。想到什么写什么，写错不要紧。'], [1, '开头有了，接着往下写。'], [0, '第一句最难，随便写一句，后面就顺了。']];
  const SPEAK = /^[ \t　]*([一-龥A-Za-z0-9·]{1,8})[：:][ \t　]*[“"「]/gm;   // 一行开头「名字：“」：这个人说了话
  const MAX_CHIPS = 10;
  let START = null, CHEER_AT = -1, SAVE_OB = null;

  function init() {   // 打开的是初步剧本：右栏收起，用不上的按钮、说明藏起来，换上稿纸的样子
    document.body.classList.add('free-draft', 'norail');
    if (document.getElementById('free-draft-css')) return;
    const css = document.createElement('style');
    css.id = 'free-draft-css';
    css.textContent = '.free-draft #askAll, .free-draft #previewBtn, .free-draft #refBtn, .free-draft #railBtn, .free-draft #sendNotes, .free-draft #rail, .free-draft .editor-side, .free-draft .free-footer, .free-draft .whole-note, .free-draft #tip { display: none !important; } .pf-nav { display: flex; justify-content: flex-end; padding: 4px 0 2px; }';
    document.head.append(css, h('link', { rel: 'stylesheet', href: '公用/写稿自由稿.css' }));
  }
  function nav() {   // 标题下面那一行：只有「提炼分镜」
    return h('nav', { class: 'pf-nav' }, h('button', { id: 'pfBtn', class: 'btn sm fin-b dian', type: 'button', title: '先存好，再交给 AI 照它分镜头、列出场的人物场景道具', onclick: extract }, '提炼分镜'));
  }
  async function extract() {
    if (!READY) return;
    if (CONFLICT) return toast('这份稿有修改冲突：先在上面处理好');
    if (!String(freeText()).trim()) return toast('初步剧本还空着：先写好这一段的戏');
    clearTimeout(ST);
    if (!await save()) return toast('还没存上，先存好再提炼');
    const go = window.parent !== window && typeof window.parent.wfFreeExtract === 'function' ? window.parent.wfFreeExtract : null;
    if (!go) return toast('存好了。回流水线，在这一段的「初步剧本」那一步点「提炼分镜」');
    go();
  }

  /* ---------- 稿纸上加的几样：dress 在 renderFree 换好文字框以后调（写稿交互.js） ---------- */
  const ta = () => document.getElementById('freeText');
  const countOf = v => v.replace(/\s/g, '').length;   // 字数：空格、换行不算
  /* 小牌子上的名字：这份稿里说过话的（说得多的在前），再接全片人物表里的；最多十个 */
  function names(v) {
    const hit = new Map();
    for (const m of String(v).matchAll(SPEAK)) hit.set(m[1], (hit.get(m[1]) || 0) + 1);
    const cast = typeof FLOW_ALL !== 'undefined' && FLOW_ALL && Array.isArray(FLOW_ALL.人物) ? FLOW_ALL.人物.map(e => e && String(e.名 || '').trim()).filter(Boolean) : [];
    return [...new Set([...[...hit].sort((a, b) => b[1] - a[1]).map(x => x[0]), ...cast])].slice(0, MAX_CHIPS);
  }
  /* 点名字：空行开头点，写成「名字：“”」光标停在引号里；别的地方点，只插名字 */
  function putName(n) {
    const t = ta(); if (!t) return;
    const v = t.value, s = t.selectionStart, e = t.selectionEnd, head = v.slice(v.lastIndexOf('\n', s - 1) + 1, s);
    if (s === e && !head.trim()) { typeInto(t, s, e, n + '：“”'); const p = s + n.length + 2; t.setSelectionRange(p, p); }
    else typeInto(t, s, e, n);
  }
  function putQuote() {   // 选了字就加上引号，没选就放一对引号、光标在中间
    const t = ta(); if (!t) return;
    const s = t.selectionStart, e = t.selectionEnd, sel = t.value.slice(s, e);
    typeInto(t, s, e, '“' + sel + '”');
    if (!sel) t.setSelectionRange(s + 1, s + 1);
  }
  const chip = (label, title, fn, cls) => h('button', { class: 'pf-chip' + (cls ? ' ' + cls : ''), type: 'button', title, onmousedown: ev => ev.preventDefault(), onclick: fn }, label);   // 按下去不抢光标
  function paintChips() {
    const box = document.getElementById('pfChips'), t = ta();
    if (!box || !t) return;
    const list = names(t.value), key = list.join('|');
    if (box.dataset.key === key && box.firstChild) return;
    box.dataset.key = key;
    box.replaceChildren(...[h('span', { class: 'pf-chips-l' }, '插入'),
      ...list.map(n => chip(n, '插进「' + n + '」。在空行开头点，直接写成「' + n + '：“”」', () => putName(n))),
      chip('“ ”', '加一对引号：选了字就把它括起来', putQuote, 'q'),
      list.length ? null : h('span', { class: 'pf-chips-tip' }, '写过「名字：“……”」的人，会出现在这里，点一下就能接着写他的台词')].filter(Boolean));   // replaceChildren 收到 null 会写出「null」
  }
  function paintCount() {
    const t = ta(), cnt = document.getElementById('pfCount'), dl = document.getElementById('pfDelta'), ch = document.getElementById('pfCheer');
    if (!t || !cnt) return;
    const n = countOf(t.value);
    if (START === null) START = n;
    cnt.replaceChildren('已写 ', h('b', null, String(n)), ' 字');
    dl.textContent = n > START ? '这回 +' + (n - START) : '';
    const at = CHEER.findIndex(([k]) => n >= k);
    if (ch && at !== CHEER_AT) {   // 换一句打气的话：轻轻浮上来
      CHEER_AT = at; ch.textContent = CHEER[at][1];
      ch.classList.remove('new'); void ch.offsetWidth; ch.classList.add('new');
    }
  }
  function paintSave() {   // 写稿页顶上那个「存好没有」搬到稿纸底下（顶上那一行藏起来了）
    const src = document.getElementById('save'), out = document.getElementById('pfSave');
    if (!src || !out) return;
    const t = src.textContent.trim(), bad = src.classList.contains('err');
    out.textContent = t;
    out.classList.toggle('err', bad);
    out.classList.toggle('ok', !bad && !/正在|保存中/.test(t));
  }
  /* 光标那一行别贴着屏幕底边：打字时走到屏幕六成往下，就往上挪到六成（11-26 晚起写在中间也管，以前只管写在最后）。
     mid：刚打开、回到上次写到的地方时，光标那一行不在屏幕中段就挪到四成高的地方 */
  function follow(mid) {
    const t = ta(), box = document.getElementById('canvas');
    if (!t || !box || typeof mirrorRect !== 'function') return;
    const at = mirrorRect(t, t.selectionStart), r = box.getBoundingClientRect(), want = r.top + r.height * 0.62;   // 光标在哪：到影子里量（量不到给的是整个框，不挪）
    if (!at || at.height > 80) return;
    if (mid) { if (at.bottom > want || at.top < r.top + r.height * 0.15) box.scrollTop += at.top - (r.top + r.height * 0.4); return; }
    if (at.bottom > want) box.scrollTop += at.bottom - want;
  }
  /* ---------- 回到上次写到的地方：光标停在第几个字、稿纸滚到哪，照这份稿记在这台电脑上 ---------- */
  const SPOT = () => 'antou:pf-spot:' + (typeof OPENPATH === 'string' && OPENPATH ? OPENPATH : STEM);
  let BACK = false;   // 这一回打开已经放回去过：后面重画文字框（存盘撞车、换了别的写法）不再挪光标
  function remember() {
    const t = ta(), box = document.getElementById('canvas');
    if (!t || !BACK) return;
    try { localStorage.setItem(SPOT(), JSON.stringify({ at: t.selectionStart, top: box ? Math.round(box.scrollTop) : 0 })); } catch (e) { /* 记不住就算了 */ }
  }
  function goBack() {
    const t = ta(), box = document.getElementById('canvas');
    if (!t || BACK) return;
    BACK = true;
    let m = null;
    try { m = JSON.parse(localStorage.getItem(SPOT()) || 'null'); } catch (e) { m = null; }
    const at = Math.max(0, Math.min(m && Number.isFinite(m.at) ? m.at : t.value.length, t.value.length));   // 没记过：放到最后，接着往下写
    t.focus({ preventScroll: true });
    t.setSelectionRange(at, at);
    if (box && m && Number.isFinite(m.top)) box.scrollTop = m.top;
    requestAnimationFrame(() => follow(true));
  }
  /* ---------- 字号：小、中、大，记在这台电脑上；文字框和底下那层影子一起换（--pf-fs，写稿自由稿.css） ---------- */
  const SIZE_KEY = 'antou:pf-font', SIZES = [['小', 16], ['中', 18], ['大', 20]];
  function sizeNow() { let v = 0; try { v = Number(localStorage.getItem(SIZE_KEY)); } catch (e) { v = 0; } return SIZES.some(x => x[1] === v) ? v : 18; }
  function setSize(px) {
    try { localStorage.setItem(SIZE_KEY, String(px)); } catch (e) { /* 记不住就只管这一回 */ }
    paintSize();
    const t = ta();
    if (t && typeof grow === 'function') grow(t);
    requestAnimationFrame(() => follow(true));
  }
  function paintSize() {
    const sec = document.querySelector('.free-section'), px = sizeNow();
    if (sec) sec.style.setProperty('--pf-fs', px + 'px');
    for (const b of document.querySelectorAll('.pf-sz')) b.classList.toggle('on', Number(b.dataset.px) === px);
  }
  function paintSel() {   // 选了字：写选中多少字
    const t = ta(), out = document.getElementById('pfSel');
    if (!t || !out) return;
    const n = t.selectionEnd > t.selectionStart ? countOf(t.value.slice(t.selectionStart, t.selectionEnd)) : 0;
    out.textContent = n ? '选中 ' + n + ' 字' : '';
  }
  /* Ctrl+S：立刻存一下（本来就边写边存，按了心里踏实）。浏览器自己那个「另存网页」不弹 */
  function saveKey(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== 's' || !is()) return;
    e.preventDefault();
    if (typeof save !== 'function') return;
    if (typeof ST !== 'undefined') clearTimeout(ST);
    save();
  }
  let KEYS_ON = false;
  function dress() {
    const t = ta(), sec = t && t.closest('.free-section');
    if (!t || !sec) return;
    const k = document.querySelector('#sheet .doc-kicker'), seg = document.querySelector('#sheet .doc-seg');
    if (k) k.textContent = '初 步 剧 本';
    if (seg && !seg.querySelector('.pf-kind')) seg.append(h('small', { class: 'pf-kind' }, '初步剧本'));   // 文件名藏起来了：标题后面写明这是哪一份
    t.setAttribute('aria-label', '初步剧本');
    sec.prepend(h('div', { class: 'pf-head' }, h('p', { id: 'pfCheer', class: 'pf-cheer' }), h('div', { id: 'pfChips', class: 'pf-chips', role: 'toolbar', 'aria-label': '点一下插到光标处' })));
    sec.append(h('div', { class: 'pf-stat', 'aria-live': 'polite' }, h('span', { id: 'pfCount' }), h('span', { id: 'pfDelta', class: 'pf-delta' }), h('span', { id: 'pfSel', class: 'pf-sel' }), h('span', { id: 'pfSave', class: 'pf-save' }),
      h('span', { class: 'pf-size', role: 'group', 'aria-label': '字号' }, ...SIZES.map(([l, px]) => h('button', { class: 'pf-sz', type: 'button', 'data-px': String(px), title: '字号：' + l + '（记在这台电脑上）', onmousedown: ev => ev.preventDefault(), onclick: () => setSize(px) }, l)))));
    paintSize();
    t.addEventListener('input', () => { paintCount(); paintChips(); paintSel(); remember(); requestAnimationFrame(() => follow()); });
    for (const ev of ['keyup', 'mouseup', 'select', 'blur']) t.addEventListener(ev, () => { paintSel(); remember(); });
    const box = document.getElementById('canvas');
    if (box && !box.dataset.pfSpot) { box.dataset.pfSpot = '1'; let tm = 0; box.addEventListener('scroll', () => { clearTimeout(tm); tm = setTimeout(remember, 200); }, { passive: true }); }
    if (!KEYS_ON) { KEYS_ON = true; document.addEventListener('keydown', saveKey); window.addEventListener('pagehide', remember); }
    setTimeout(goBack, 60);   // 文字框撑开（grow）以后再放光标、滚过去
    t.addEventListener('focus', paintChips);
    CHEER_AT = -1; paintCount(); paintChips(); paintSave();
    setTimeout(paintChips, 1500);   // 全片人物表是另外读的，读好了再摆一遍
    const src = document.getElementById('save');
    if (src && !SAVE_OB) { SAVE_OB = new MutationObserver(paintSave); SAVE_OB.observe(src, { subtree: true, childList: true, characterData: true, attributes: true }); }
  }
  window.FreeDraft = Object.freeze({ is, init, nav, dress, HINT, names, countOf });
})();
