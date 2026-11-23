/* ============================================================
   交给 AI 的话（2026-11-14 他定：用 AI 的地方都有两种——「给我提示词」、项目直接调；直接调一律看得见）
   流水线各页、审片台、写稿页、看文件那一页（项目管理.html）共用这个弹窗，不靠页面自己的样式和弹窗：
     给我提示词   要交代的话摆出来、复制，贴进自己开的对话（Codex、Claude、DeepSeek 都行；出图要贴进 Codex。11-21 起出片由流水线自己做，不经这里）。
                  AI 做完把回复写进项目、跑一句命令告诉项目，这里自动接着做；它写不了文件的，把回复贴回来。
     Claude 桌面版 项目已经开了新对话、任务填好，等你按发送；没看到就「再开一次」，或者复制这段话自己贴。
   用法：HandAI.wait(任务) 等服务把话备好再弹；HandAI.open(任务) 直接弹（同时有几个就排队，一个一个弹）；
        HandAI.buttons(任务, 刷新) 任务那一行后面的小按钮（交给 AI 的话、再开一次）；HandAI.SELF 是「给我提示词」的渠道号。
   接口：GET /api/job/<号>?msg、POST /api/job/<号>?reply（贴回来的回复）、POST /api/job/<号>?reopen（Claude 再开一次）
   ============================================================ */
(function () {
  if (window.HandAI) return;
  const SELF = '自己交给 AI';
  const HDR = { 'X-Antou': '1' };
  const css = `
.hai-mask { position: fixed; inset: 0; z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(30, 24, 18, .32); }
.hai-box { width: min(760px, 100%); max-height: calc(100vh - 48px); display: flex; flex-direction: column; gap: 12px; padding: 20px 22px 16px; border-radius: 12px;
  background: var(--sheet, #fffdf9); color: var(--ink, #2a2622); box-shadow: 0 1px 2px rgba(60, 45, 30, .05), 0 18px 48px -18px rgba(60, 45, 30, .45);
  font: 14px/1.7 var(--sans, 'Noto Sans SC', 'Microsoft YaHei', sans-serif); }
.hai-h { display: flex; align-items: baseline; gap: 10px; }
.hai-h b { font: 600 18px/1.4 var(--serif, 'Noto Serif SC', 'SimSun', serif); letter-spacing: .08em; }
.hai-h span { color: var(--ink-3, #887e74); font-size: 13px; }
.hai-h i { margin-left: auto; font-style: normal; font-size: 12px; color: var(--zhu, #a83a2c); }
.hai-say { margin: 0; color: var(--ink-2, #554d45); font-size: 13.5px; line-height: 1.85; }
.hai-msg { flex: 1 1 auto; min-height: 120px; overflow: auto; margin: 0; padding: 12px 14px; border: 1px solid var(--line, #e5dccd); border-radius: 8px;
  background: var(--paper, #f4efe6); white-space: pre-wrap; word-break: break-all; font: 13px/1.75 var(--mono, Consolas, 'Noto Sans SC', monospace); }
.hai-back { display: none; flex-direction: column; gap: 8px; }
.hai-box.back .hai-back { display: flex; }
.hai-back textarea { min-height: 120px; resize: vertical; padding: 10px 12px; border: 1px solid var(--line-2, #d6cab6); border-radius: 8px; background: #fff;
  font: 13px/1.7 var(--mono, Consolas, 'Noto Sans SC', monospace); color: inherit; }
.hai-foot { display: flex; align-items: center; gap: 8px; }
.hai-foot .sp { flex: 1; }
.hai-link { padding: 0; border: 0; background: none; color: var(--dai, #3e5c5e); font: inherit; font-size: 13px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.hai-btn { padding: 6px 16px; border: 1px solid var(--line-2, #d6cab6); border-radius: 7px; background: var(--sheet, #fffdf9); color: var(--ink, #2a2622); font: inherit; cursor: pointer; }
.hai-btn:hover { background: var(--paper-2, #ece5d8); }
.hai-btn.ink { background: var(--ink, #2a2622); border-color: var(--ink, #2a2622); color: #f7f1e6; }
.hai-btn.ink:hover { background: #3c3630; }
.hai-btn.ghost { border-color: transparent; background: transparent; color: var(--ink-2, #554d45); }
.hai-err { color: var(--zhu, #a83a2c); font-size: 13px; }
.hai-box.got .hai-msg { opacity: .45; }
.hai-box.got .hai-copy, .hai-box.got .hai-link { display: none; }
.hai-tip { position: fixed; left: 50%; bottom: 28px; z-index: 9100; transform: translateX(-50%); padding: 8px 16px; border-radius: 8px; background: var(--ink, #2a2622); color: #f7f1e6; font-size: 13px; }
.hai-mini { padding: 0; border: 0; background: none; color: var(--dai, #3e5c5e); font: inherit; font-size: 12.5px; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; margin-left: 8px; }`;
  function style() {
    if (document.getElementById('hai-style')) return;
    const s = document.createElement('style');
    s.id = 'hai-style'; s.textContent = css;
    document.head.append(s);
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'class') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  }
  function tip(text) {
    style();
    const t = el('div', { class: 'hai-tip' }, text);
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }
  async function req(method, url, body) {
    const r = await fetch(url, { method, headers: body != null ? { ...HDR, 'Content-Type': 'text/plain; charset=utf-8' } : HDR, body: body != null ? body : undefined });
    const t = await r.text();
    if (!r.ok) throw new Error(t.replace(/^\s*\{?"?error"?:?\s*"?/, '').replace(/"?\}?\s*$/, '') || String(r.status));
    try { return JSON.parse(t); } catch (e) { return t; }
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* 内置浏览器有时不让：用老办法 */ }
    const ta = el('textarea', { style: 'position:fixed;left:-9999px;top:0' });
    ta.value = text; document.body.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  /* 这个任务现在是不是在等人：给我提示词（等你贴）、Claude 桌面版（等你按发送 / 在做） */
  const waiting = j => !!j && !!j.交给 && (j.状态 === '在做' || j.状态 === '排队');
  const queue = [];
  let showing = null;

  async function open(job, after) {
    if (!job || !job.id) return;
    if (showing === job.id || queue.some(x => x.job.id === job.id)) return;
    if (showing) { queue.push({ job, after }); updateCount(); return; }
    showing = job.id;
    try { await show(job, after); }
    finally {
      showing = null;
      const next = queue.shift();
      if (next) open(next.job, next.after);
    }
  }
  let countEl = null;
  function updateCount() { if (countEl) countEl.textContent = queue.length ? '后面还有 ' + queue.length + ' 个要交' : ''; }

  async function show(job, after) {
    style();
    let m;
    try { m = await req('GET', '/api/job/' + job.id + '?msg'); }
    catch (e) { tip('交给 AI 的话没读到：' + e.message); return; }
    const how = m.方式 || 'self';
    const say = how === 'claude'
      ? (m.等 === '发送' ? '项目已经在 Claude 桌面版开了一个新对话，任务填好了：到 Claude 窗口里按发送（Claude 规定外面带进来的话要你按一下）。没看到那个对话，就点「再开一次」，或者复制下面的话，贴进 Claude 的新对话。' : 'Claude 已经在做了，在 Claude 窗口里看。它做完会告诉项目，这里自动接着做。')
      : how === 'deepseek' ? 'DeepSeek 在它自己的窗口里做，做完自动接上。'
      : m.说 || '复制下面的话，贴进你自己在 Codex、Claude 或 DeepSeek 里新开的对话' + (m.要Codex ? '（这件事要贴进 Codex：要用它的出图工具或者操作即梦）' : '') + '。它做完会把回复写进项目、告诉这边，这里自动接着做，不用回来点。';
    return new Promise(resolve => {
      const ta = el('textarea', { placeholder: 'AI 写不了文件的话（比如 Codex 只读）：把它的回复整段贴在这里，点「交回复」', spellcheck: 'false' });
      const err = el('div', { class: 'hai-err' });
      countEl = el('i');
      updateCount();
      let closed = false, timer = 0;
      const close = () => { if (closed) return; closed = true; clearInterval(timer); document.removeEventListener('keydown', onKey, true); mask.remove(); countEl = null; resolve(); if (after) after(); };
      const give = async () => {
        const t = ta.value.trim();
        if (!t) { err.textContent = '先把 AI 的回复贴进来'; ta.focus(); return; }
        err.textContent = '交上去了，在接着做……';
        let r;
        try { r = await req('POST', '/api/job/' + job.id + '?reply', t); }
        catch (e) { err.textContent = '没交上：' + e.message; return; }
        if (r && r.格式错) { err.textContent = '还没接上：' + r.格式错 + '。让 AI 照任务书改好，再贴一次'; return; }
        if (r && (r.状态 === '没成' || r.状态 === '停了')) { err.textContent = '没成：' + (r.错误 || r.状态); return; }
        close();
        tip(r && r.状态 === '做完' ? (r.结果 || '做完了') : '交上去了，这里接着做');
      };
      const reopen = async () => {
        try { await req('POST', '/api/job/' + job.id + '?reopen'); tip('又开了一次：到 Claude 窗口里看'); }
        catch (e) { err.textContent = '没开成：' + e.message; }
      };
      const sayEl = el('p', { class: 'hai-say' }, say);
      /* 开着的时候隔两秒看一眼任务：回复接上了就别再叫人复制；做完（或没成、停了）自己关上，结果页面会提示 */
      timer = setInterval(async () => {
        let j;
        try { j = await req('GET', '/api/job/' + job.id); } catch (e) { clearInterval(timer); return; }   // 服务重开过、任务不在了：不再看
        if (closed || !j || typeof j !== 'object') return;
        if (j.状态 !== '在做' && j.状态 !== '排队') { close(); return; }
        if (!j.交给) { sayEl.textContent = '回复收到了，在接着做，做完这个框自己关上。'; box.classList.add('got'); }
        else if (how === 'claude' && j.交给.等 === '做') sayEl.textContent = 'Claude 已经在做了，在 Claude 窗口里看。它做完会告诉项目，这里自动接着做。';
      }, 2000);
      const box = el('div', { class: 'hai-box', role: 'dialog' },
        el('div', { class: 'hai-h' }, el('b', null, how === 'self' ? '给我提示词' : how === 'claude' ? '交给 Claude' : '交给 DeepSeek'), el('span', null, m.标题 || job.标题 || ''), countEl),
        sayEl,
        el('pre', { class: 'hai-msg' }, m.话 || '（还没备好，等一两秒再点）'),
        el('div', { class: 'hai-back' }, ta, el('div', { class: 'hai-foot' }, el('span', { class: 'sp' }), el('button', { class: 'hai-btn', type: 'button', onclick: give }, '交回复'))),
        err,
        el('div', { class: 'hai-foot' },
          how !== 'deepseek' ? el('button', { class: 'hai-link', type: 'button', onclick: () => { box.classList.toggle('back'); if (box.classList.contains('back')) ta.focus(); } }, 'AI 写不了文件？把它的回复贴回来') : null,
          el('span', { class: 'sp' }),
          el('button', { class: 'hai-btn ghost', type: 'button', onclick: close }, '关上（接着等）'),
          how === 'claude' && m.等 === '发送' ? el('button', { class: 'hai-btn', type: 'button', onclick: reopen }, '再开一次') : null,
          el('button', { class: 'hai-btn ink hai-copy', type: 'button', onclick: async () => { if (await copy(m.话 || '')) tip(how === 'self' ? '复制好了：贴进你自己的 AI 的新对话' : '复制好了'); else err.textContent = '复制不了：在上面框里全选、Ctrl+C'; } }, '复制')));
      const mask = el('div', { class: 'hai-mask', onclick: e => { if (e.target === mask) close(); } }, box);
      const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      document.addEventListener('keydown', onKey, true);
      document.body.append(mask);
    });
  }
  /* 给我提示词：开了任务以后，等服务把要交代的话备好（一般一两秒），再弹。返回最新的任务。
     Claude 桌面版的不弹：Claude 窗口自己会跳到新对话；没看到的，任务那一行有「再开一次」 */
  async function wait(job, after) {
    let j = job;
    for (let i = 0; i < 90 && j && (j.状态 === '排队' || j.状态 === '在做') && !j.交给; i++) {
      await new Promise(r => setTimeout(r, 400));
      try { j = await req('GET', '/api/job/' + j.id); } catch (e) { break; }
    }
    if (j && j.交给 && j.交给.方式 === 'self') open(j, after);
    else if (j && !j.交给 && (j.状态 === '没成' || j.状态 === '停了')) tip((j.标题 || '') + ' 没成：' + (j.错误 || j.状态));
    return j;
  }
  /* 任务那一行后面的小按钮：等你交给 AI 的、Claude 等你按发送的 */
  function buttons(job, refresh) {
    if (!waiting(job)) return [];
    style();
    const out = [el('button', { class: 'hai-mini', type: 'button', title: '再看一遍要交给 AI 的话；AI 写不了文件的，也在那里把它的回复贴回来', onclick: () => open(job, refresh) }, '交给 AI 的话')];
    if (job.交给.方式 === 'claude' && job.交给.等 === '发送') out.push(el('button', { class: 'hai-mini', type: 'button', title: '没看到 Claude 里新开的对话：再开一次', onclick: async () => { try { await req('POST', '/api/job/' + job.id + '?reopen'); tip('又开了一次：到 Claude 窗口里看'); } catch (e) { tip('没开成：' + e.message); } } }, '再开一次'));
    return out;
  }
  window.HandAI = { SELF, open, wait, buttons, waiting };
})();
