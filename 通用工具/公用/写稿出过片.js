/* 写稿页：出过片的提示词锁住（2026-11-22 他定：「已经出片的提示词不能改，只能新增提示词」）。
   打开时问本机服务（/api/filmed，.agents/skills/annotate-live/filmed.js）这一版出没出过片。出过片的这一页锁着：能看、能翻，不能改字、挂图、交给 AI；
   顶上一条说出了哪几条样片，点「另存成「X_改N」」（11-23 他定：不许原样照抄）：交给 AI 照这一版的批注（审片批注、提示词上写的）改，
     改好的另存成下一版（本机服务 review-fork.js），这一页换到新的一版接着写。原稿不动；一份批注都没有点不了。
   存稿时服务回 423（刚出了片）：一样锁上，没存上的字留在浏览器恢复草稿里，另存以后在新的一版上点「恢复到页面」。
   按批注改提示词的（别处交的）改好另存成了下一版：也换到那一版。
   写稿页过了 1500 行，新功能放这里；用写稿页的 PJ、SEGDIR、STEM、OPENPATH、JOBS、draftKey、tellAI……。写稿页里调 window.Filmed：
     init（打开时，锁了给 true）、on（锁着没有）、paint（每秒）、hit（存稿撞上 423）、done（任务做完，换到另存的那一版给 true）、jobBody（交给 AI 的那一行） */
(function () {
  'use strict';
  const S = { f: null, busy: false };   // f：服务给的这一版 { 出过片, 片, 历史, 在出, 下一版, 最新, 不能另存, 批注 }；busy：正在交给 AI
  const KIND = '照审片批注另存', FORK_V = 24;   // 本机服务第 24 版起有这件事（review-fork.js）
  const NOTE_KEY = 'xiegao:filmed-note';   // 另存好了换页以后，在新的一版上说一句
  const LOCK = ['#sheet', '#editor-mode', '#pane-assets', '#pane-ai', '#pane-lint', '#pane-shots'], OFF = ['#askAll', '#sendNotes'];
  const segNo = () => SEGDIR.replace(/^第|段$/g, '');
  const me = () => STEM + '.txt';
  const on = () => !!(S.f && S.f.出过片);
  const q = n => '?p=' + encodeURIComponent(PJ) + '&s=' + encodeURIComponent(segNo()) + '&n=' + encodeURIComponent(n);
  const short = n => vpShort(String(n).replace(/\.txt$/i, '')).replace(/_/g, ' ');
  function lock() {   // 设过了不再设：别的地方（交给 AI 写完、恢复草稿）放开了再锁回来
    for (const s of LOCK) { const el = $(s); if (el && !el.inert) el.inert = true; }
    for (const s of OFF) { const b = $(s); if (b && !b.disabled) b.disabled = true; }
  }
  let mo = null;
  function watch() {
    if (mo || typeof MutationObserver !== 'function') return;
    mo = new MutationObserver(() => { if (on()) lock(); });
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
    if (on()) { watch(); paint(); }
    return on();
  }
  const mine = () => JOBS.live.some(j => j.名 === me() || j.批注 === HNF.join('/'));   // 这一条有 AI 任务在做
  function paint() {
    if (!on()) return;
    lock();
    style();
    const f = S.f, vids = [...f.片, ...f.历史.map(v => v + '（在历史记录里）')], ns = (f.批注 || []).map(r => r.split('/').pop());
    const why = S.busy ? '正在交给 AI' : mine() ? 'AI 正在做这一条（左下角那一条）：做完再另存' : !f.下一版 ? f.不能另存
      : SVC < FORK_V ? '本机服务是旧的：重开一次，另存才会交给 AI 照批注改' : !ns.length ? '还没写批注：先到流水线这一条点「审片」，边看边写哪里不对，再点这里' : '';
    const sig = JSON.stringify([f, why]);
    let bar = $('#filmedBar');
    if (bar && bar.dataset.sig === sig) return;   // 每秒都来：没变就不重摆
    const btns = [];
    if (f.下一版) { const b = h('button', { class: 'btn sm ink', type: 'button', onclick: fork, title: why || '把要交代的话给你，复制给你自己的 AI：照 ' + ns.join('、') + ' 改，改好的另存成「' + f.下一版 + '」，这一页换过去接着写。不许原样照抄，AI 一处没改就不另存；原稿和它出的样片都不动' }, '另存成「' + short(f.下一版) + '」'); b.disabled = !!why; btns.push(b); }
    else if (f.最新 && f.最新 !== me()) btns.push(h('button', { class: 'btn sm', type: 'button', onclick: () => go(f.最新) }, '打开最新的「' + short(f.最新) + '」'));
    const box = h('div', { id: 'filmedBar', class: 'filmed-bar', 'data-sig': sig },
      h('b', null, f.在出 ? '这一版正在出片，原稿不能改。' : '这一版出过片，原稿不能改。'),
      h('div', null, f.在出 ? '出完以后，要改就另存成新的一版。' : '出过的样片：' + vids.join('、') + '。要改：先审片写批注，再点「另存」，AI 照批注改出新的一版（不许原样照抄），样片和出它的这一版留着对得上。'),
      ...btns, why && !S.busy ? h('small', null, why) : null);
    if (bar) bar.replaceWith(box); else $('#canvas').prepend(box);
    setStatus(f.在出 ? '正在出片 · 只能看' : '出过片 · 只能看');
  }
  /* 换到同一段的另一份稿：网址一换，写稿页自己重开（hashchange） */
  function go(n, say) {
    const next = [...OPENPATH.split('/').slice(0, -1), n];
    try { if (say) sessionStorage.setItem(NOTE_KEY, say); } catch (e) { /* 存不了就不说 */ }
    try { if (parent !== window && typeof parent.retitleWrite === 'function') parent.retitleWrite(me(), n); } catch (e) { /* 不是流水线里开的 */ }
    location.hash = 'open=' + next.map(encodeURIComponent).join('/');
  }
  /* 另存：交给 AI 照批注改（本机服务开「照审片批注另存」，照例把要交代的话给你）。改好了 done 换到新的一版 */
  async function fork() {
    if (S.busy || !on() || !S.f.下一版 || mine() || !(S.f.批注 || []).length || SVC < FORK_V) return;
    S.busy = true; paint();
    try { const r = await tellAI(KIND + ' ' + OPENPATH); toast(r.say || '交给 AI 了：进度在左下角，改好的另存成新的一版，这一页自己换过去'); }
    catch (e) { toast('没交上：' + e.message); try { S.f = await ask(me()); } catch (x) { /* 照旧 */ } }
    S.busy = false; paint();
  }
  const jobBody = (line, base) => line.startsWith(KIND + ' ') ? { ...base, 事: KIND } : null;
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
    if (!j || (j.事 !== '按批注改提示词' && j.事 !== KIND) || j.状态 !== '做完' || !j.名 || j.名 === me() || !Core.RE_VP.test(j.名) || Core.vpBase(j.名) !== Core.vpBase(me())) return false;
    try {
      const k = draftKey(), v = localStorage.getItem(k);
      if (v) { localStorage.setItem(k.slice(0, k.length - OPENPATH.length) + [...OPENPATH.split('/').slice(0, -1), j.名].join('/'), v); localStorage.removeItem(k); }
    } catch (e) { /* 浏览器存不了：恢复草稿留在原处 */ }
    go(j.名, j.结果);
    return true;
  }
  window.Filmed = Object.freeze({ init, on, paint, hit, done, jobBody });
})();
