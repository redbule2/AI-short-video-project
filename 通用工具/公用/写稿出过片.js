/* 写稿页：出过片的提示词锁住（2026-11-22 他定：「已经出片的提示词不能改，只能新增提示词」）。
   打开时问本机服务（/api/filmed，.agents/skills/annotate-live/filmed.js）这一版出没出过片。出过片的这一页锁着：能看、能翻，不能改字、挂图、交给 AI；
   顶上一条说出了哪几条样片。点「另存成「X_改N」」（2026-11-23 晚他定：另存不看审片、批注）：这一页放开，照这一版接着改；
     改了提示词或素材，头一回存就另存成下一版（POST /api/filmed），这一页换成新的一版接着写（写稿改镜头.js 的 retarget，不重开）。原稿、样片不动。
     提示词、素材都没变的不存（本机服务比，回 422）：回到流水线也不会多出一版。还没存成以前，交给 AI 的几样等存成了再交；请 AI 批、交给 AI 改、加减镜头关着。
     流水线那一行点「另存成改N」打开的（网址带 fork=1）：一打开就是这样。
   存稿时服务回 423（刚出了片）：一样锁上，没存上的字留在浏览器恢复草稿里，另存以后在新的一版上点「恢复到页面」。
   按批注改提示词、照审片批注另存（流水线那一行「⋯」里交的）做完，改好另存成了下一版：也换到那一版。
   写稿页过了 1500 行，新功能放这里；用写稿页的 PJ、SEGDIR、STEM、OPENPATH、HDR、JOBS、draftKey、offerRecovery、setAsk、paintSend……。写稿页里调 window.Filmed：
     init（打开时，锁了给 true）、on（锁着没有）、pending（另存还没存成：给一句说法，不然给 ''）、base（点另存那一刻的写稿资料）、post（另存：带着这一页的字和写稿资料）、
     made（另存成了：换成新的一版）、miss（另存没成）、paint（每秒）、hit（存稿撞上 423）、done（任务做完，换到另存的那一版给 true） */
(function () {
  'use strict';
  const S = { f: null, pend: '', shown: '', base: '' };   // f：服务给的这一版 { 出过片, 片, 历史, 在出, 下一版, 最新, 不能另存, 批注 }；pend：正在另存成哪一版（还没存成）；shown：流水线顶上那一行写的哪一版；base：点另存那一刻的写稿资料（JSON）
  const KINDS = ['按批注改提示词', '照审片批注另存'], FORK_V = 25;   // KINDS：做完会另存成下一版的任务；FORK_V：本机服务第 25 版起带着改好的字另存（filmed.js）
  const NOTE_KEY = 'xiegao:filmed-note';   // 另存好了换页以后，在新的一版上说一句
  const LOCK = ['#sheet', '#editor-mode', '#pane-assets', '#pane-ai', '#pane-lint', '#pane-shots'], OFF = ['#askAll', '#sendNotes'];
  const HOLD = ['#pane-shots'];   // 另存还没存成：加减镜头（要改名字）存成了再做；OFF 那两个也关着
  const segNo = () => SEGDIR.replace(/^第|段$/g, '');
  const me = () => STEM + '.txt';
  const on = () => !!(S.f && S.f.出过片) && !S.pend;
  const q = n => '?p=' + encodeURIComponent(PJ) + '&s=' + encodeURIComponent(segNo()) + '&n=' + encodeURIComponent(n);
  const short = n => vpShort(String(n).replace(/\.txt$/i, '')).replace(/_/g, ' ');
  const pending = () => S.pend ? '还没另存成「' + short(S.pend) + '」：先改一处提示词或素材，存成新的一版再交给 AI' : '';
  function lock() {   // 设过了不再设：别的地方（交给 AI 写完、恢复草稿）放开了再锁回来。另存还没存成的只锁 HOLD 和 OFF
    for (const s of S.pend ? HOLD : LOCK) { const el = $(s); if (el && !el.inert) el.inert = true; }
    for (const s of OFF) { const b = $(s); if (b && !b.disabled) b.disabled = true; }
  }
  const unlock = list => { for (const s of list) { const el = $(s); if (el && el.inert) el.inert = false; } };
  let mo = null;
  function watch() {
    if (mo || typeof MutationObserver !== 'function') return;
    mo = new MutationObserver(() => { if (on() || S.pend) lock(); });
    for (const s of [...LOCK, ...OFF]) { const el = $(s); if (el) mo.observe(el, { attributes: true, attributeFilter: ['inert', 'disabled'] }); }
  }
  function style() {
    if ($('#filmed-css')) return;
    document.head.append(h('style', { id: 'filmed-css' }, '.filmed-bar{margin:0 0 16px;padding:13px 16px;border:1px solid var(--qing-line);border-radius:6px;background:var(--qing-soft);color:var(--ink-2);font:13px/1.8 var(--sans)}'
      + '.filmed-bar b{color:var(--qing)}.filmed-bar .btn{margin:8px 8px 0 0}.filmed-bar small{display:block;color:var(--ink-3)}'));
  }
  async function ask(n) {
    const r = await fetch('/api/filmed' + q(n), { headers: HDR, cache: 'no-store' });
    if (!r.ok) throw new Error((await r.text()) || String(r.status));
    return r.json();
  }
  async function init() {
    try { const n = sessionStorage.getItem(NOTE_KEY); if (n) { sessionStorage.removeItem(NOTE_KEY); toast(n); } } catch (e) { /* 读不了就不说 */ }
    if (!Core.RE_VP.test(me())) return false;   // 先写提示词的段的自由稿不管
    if (SVC == null) { try { SVC = (await (await fetch('/api/ping', { headers: HDR })).json()).v || 0; } catch (e) { SVC = 0; } }
    if (SVC < 22) return false;   // 老服务没有这一样
    try { S.f = await ask(me()); } catch (e) { S.f = null; return false; }
    if (!on()) return false;
    watch();
    if (/[#&]fork=1(?:&|$)/.test(location.hash) && start(true)) return false;   // 流水线那一行点「另存成改N」开的：一打开就放开（写稿页接着问要不要恢复草稿）
    paint();
    return true;
  }
  const mine = () => JOBS.live.some(j => j.名 === me() || j.批注 === HNF.join('/'));   // 这一条有 AI 任务在做
  const why = () => mine() ? 'AI 正在做这一条（左下角那一条）：做完再另存' : !S.f.下一版 ? S.f.不能另存 : SVC < FORK_V ? '本机服务是旧的：重开一次才能另存' : '';   // 现在另存不了的原因
  /* 另存：这一页放开，照这一版接着改。改了头一回存就另存成下一版（写稿交互.js 的 saveEditor 调 post、made）；没改的不存 */
  function start(fromUrl) {
    if (!on() || why()) return false;
    S.pend = S.f.下一版; S.shown = fromUrl ? S.pend : me(); S.base = JSON.stringify(editorSnapshot());   // 先记上再放开：锁的那几块一放开，watch 照 S.pend 只锁回 HOLD。base：拨合并、分区这类不打字的改动，和它比出来
    unlock(LOCK.filter(s => !HOLD.includes(s)));
    paint();
    setStatus('另存成「' + short(S.pend) + '」：改了才存');
    return true;
  }
  function buttons(f, no) {
    if (f.下一版) {
      const b = h('button', { class: 'btn sm ink', type: 'button', onclick: () => { if (start(false)) offerRecovery(); }, title: no || '这一页放开，照这一版接着改：改了提示词或素材才存成「' + f.下一版 + '」，一处没改就不另存；原稿和它出的样片都不动' }, '另存成「' + short(f.下一版) + '」');
      b.disabled = !!no;
      return [b];
    }
    return f.最新 && f.最新 !== me() ? [h('button', { class: 'btn sm', type: 'button', onclick: () => go(f.最新) }, '打开最新的「' + short(f.最新) + '」')] : [];
  }
  function paint() {
    let bar = $('#filmedBar');
    if (!S.f || !S.f.出过片) { if (bar) bar.remove(); return; }
    lock();
    style();
    const f = S.f, vids = [...f.片, ...f.历史.map(v => v + '（在历史记录里）')], no = S.pend ? '' : why();
    const sig = JSON.stringify([f, no, S.pend]);
    if (bar && bar.dataset.sig === sig) return;   // 每秒都来：没变就不重摆
    const box = S.pend
      ? h('div', { id: 'filmedBar', class: 'filmed-bar', 'data-sig': sig },
        h('b', null, '正在另存成「' + short(S.pend) + '」，原稿「' + short(me()) + '」不动。'),
        h('div', null, '照下面改：改了提示词或换了素材，就存成「' + short(S.pend) + '」，接着在这里写；一处没改不另存，回到流水线也不会多出一版。'))
      : h('div', { id: 'filmedBar', class: 'filmed-bar', 'data-sig': sig },
        h('b', null, f.在出 ? '这一版正在出片，原稿不能改。' : '这一版出过片，原稿不能改。'),
        h('div', null, f.在出 ? '出完以后，要改就另存成新的一版。' : '出过的样片：' + vids.join('、') + '。要改就点「另存」，在这里照它改：改了提示词或素材才存成新的一版，样片和出它的这一版留着对得上。'),
        ...buttons(f, no), no ? h('small', null, no) : null);
    if (bar) bar.replaceWith(box); else $('#canvas').prepend(box);
    if (!S.pend) setStatus(f.在出 ? '正在出片 · 只能看' : '出过片 · 只能看');
  }
  /* 换到同一段的另一份稿：网址一换，写稿页自己重开（hashchange） */
  function go(n, say) {
    const next = [...OPENPATH.split('/').slice(0, -1), n];
    try { if (say) sessionStorage.setItem(NOTE_KEY, say); } catch (e) { /* 存不了就不说 */ }
    try { if (parent !== window && typeof parent.retitleWrite === 'function') parent.retitleWrite(me(), n); } catch (e) { /* 不是流水线里开的 */ }
    location.hash = 'open=' + next.map(encodeURIComponent).join('/');
  }
  /* 另存：带着这一页的字和写稿资料那几样。本机服务比过和这一版不一样才存成下一版，一样回 422 */
  const post = (text, side) => fetch('/api/filmed' + q(me()), { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, side }) });
  /* 另存成了：这一页换成新的一版（名字、路径、网址，这台浏览器里照路径记的跟着换），写稿页接着照常存 */
  function made(r) {
    const from = me(), shown = S.shown;
    ShotEdit.retarget(r.名, OPENPATH);
    try { if (shown && shown !== r.名 && parent !== window && typeof parent.retitleWrite === 'function') parent.retitleWrite(shown, r.名); } catch (e) { /* 不是流水线里开的 */ }
    S.f = null; S.pend = ''; S.shown = ''; S.base = '';
    unlock(LOCK);
    const bar = $('#filmedBar'); if (bar) bar.remove();
    setAsk(); paintSend(); Finish.paint();   // 请 AI 批、交给 AI 改、交给 AI 写完照新的一版重新算
    toast('另存成「' + short(r.名) + '」了：原稿「' + short(from) + '」和它出的样片都不动，接着在这里写');
  }
  /* 另存没成（这一条刚有了新的一版、正在出片……）：再问一遍服务。还能另存的照新排的名字接着另存，另存不了的锁回去（没存上的字在浏览器恢复草稿里） */
  async function miss(msg) {
    toast('没另存成：' + msg);
    try { S.f = await ask(me()); } catch (e) { /* 问不到照旧 */ }
    S.pend = '';
    if (!S.f.出过片) { unlock(LOCK); setAsk(); paintSend(); Finish.paint(); }   // 不算出过片了（样片挪走了）：照普通的稿存
    else if (S.f.下一版 && !why()) S.pend = S.f.下一版;   // 名字让开了：照新排的名字接着另存
    paint();   // 另存不了的锁回去
    setStatus('没另存成：' + msg + '；你写的留在浏览器里', true);
  }
  /* 存稿撞上 423：这一版刚出了片（或正在出）。锁上，没存上的字写稿页已经记进浏览器恢复草稿 */
  async function hit(msg) {
    try { S.f = await ask(me()); } catch (e) { /* 问不到也锁上 */ }
    if (!on()) S.f = { 出过片: true, 片: [], 历史: [], 在出: false, 下一版: '', 最新: '', 不能另存: msg || '这一版出过片' };
    watch(); paint();
    setStatus('没存上：这一版出过片，原稿不能改；你写的留在浏览器里，另存以后恢复', true);
  }
  /* 按批注改提示词、照审片批注另存做完，改好的另存成了下一版（filmed.js）：换到那一版。
     没存上的字（撞上 423 留下的恢复草稿）跟着到新的一版，在那边点「恢复到页面」 */
  function done(j) {
    if (!j || !KINDS.includes(j.事) || j.状态 !== '做完' || !j.名 || j.名 === me() || !Core.RE_VP.test(j.名) || Core.vpBase(j.名) !== Core.vpBase(me())) return false;
    try {
      const k = draftKey(), v = localStorage.getItem(k);
      if (v) { localStorage.setItem(k.slice(0, k.length - OPENPATH.length) + [...OPENPATH.split('/').slice(0, -1), j.名].join('/'), v); localStorage.removeItem(k); }
    } catch (e) { /* 浏览器存不了：恢复草稿留在原处 */ }
    go(j.名, j.结果);
    return true;
  }
  window.Filmed = Object.freeze({ init, on, pending, base: () => S.base, post, made, miss, paint, hit, done });
})();
