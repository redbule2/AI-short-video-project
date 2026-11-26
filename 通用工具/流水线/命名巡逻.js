/* ============================================================
   流水线 · 名字巡逻（2026-11-26 他定：项目文件夹里，名字、位置不合规矩的，本机服务隔五分钟扫一遍，这里亮出来）
   顶栏「名字不合规 N」：有新出的不合规的、或者门卫掉了才出现，平时不占地方。点开一个弹窗，一条一行：哪一样、哪里不合，后面：
     改成「…」       照规矩改好的名字。有地方写着它、那里已有同名的、正被别的程序开着，本机服务不改，这一行下面说清楚，你来定
     打开所在文件夹   在资源管理器里选中它
     不用改          记进老文件名单，以后不再提
   门卫掉了（Claude、Codex 的设置被重置过）：最上面一行「门卫没装上」，点「装上」。
   AI 写的时候门卫已经提醒过（.agents/hooks/naming-gate.js）；这里补别的程序存的、人手放进来的。规矩只有一份：通用工具/公用/命名规则.js。
   服务那一半：.agents/skills/annotate-live/naming-patrol.js（GET、POST /api/naming）。老的本机服务没有这个接口：什么也不摆。
   流水线.js 替各页引这一份（最下面），顶栏里摆 NameWatch.topBtn()。
   ============================================================ */
(function () {
  'use strict';
  if (window.NameWatch || !window.UI) return;
  const { h, toast, dialog, dlgShell } = window.UI;
  const S = { data: null, btns: new Set(), paint: null, busy: false };

  document.head.append(h('style', null, [
    '.nw-btn[hidden]{display:none}',
    '.nw-btn .nw-n{margin-left:4px;padding:0 6px;border-radius:9px;background:var(--zhu);color:var(--on-accent);font-size:12px;line-height:18px}',
    '.nw-list{display:flex;flex-direction:column;gap:8px;max-height:60vh;overflow:auto}',
    '.nw-row{display:flex;gap:12px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--sheet)}',
    '.nw-main{flex:1;min-width:0}',
    '.nw-path{word-break:break-all}',
    '.nw-why{color:var(--zhu);font-size:13px;margin-top:2px}',
    '.nw-err{color:var(--zhu);font-size:13px;margin-top:6px}',
    '.nw-acts{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;flex:none;max-width:55%}',
    '.nw-empty{color:var(--ink-3);padding:12px 0}',
  ].join('\n')));

  async function api(method, body) {
    const r = await fetch('/api/naming' + (method === 'GET' ? '?fresh' : ''), {
      method, cache: 'no-store', body: body ? JSON.stringify(body) : undefined,
      headers: { 'X-Antou': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    });
    const t = await r.text();
    if (!r.ok) throw Object.assign(new Error(t || '本机服务出错 ' + r.status), { status: r.status });
    return JSON.parse(t);
  }
  const gateOff = d => !!d && !!d.门卫 && (d.门卫.claude === false || d.门卫.codex === false);
  const count = d => d ? (d.问题 || []).length + (gateOff(d) ? 1 : 0) : 0;

  function paintBtn(b) {
    const d = S.data, n = count(d), items = d ? (d.问题 || []).length : 0;
    b.hidden = !n;
    if (!n) return;
    b.title = (items ? '项目里有 ' + items + ' 样名字、位置不合规矩（本机服务隔五分钟扫一遍）' : '') + (gateOff(d) ? (items ? '；' : '') + '门卫没装上：AI 写文件时不会被提醒' : '') + '。点开一条条看';
    b.replaceChildren(items ? '名字不合规' : '门卫没装上', items ? h('span', { class: 'nw-n' }, String(items)) : null);
  }
  function paintAll() {
    for (const b of [...S.btns]) { if (!b.isConnected && b.dataset.out) S.btns.delete(b); else { b.dataset.out = b.isConnected ? '' : '1'; paintBtn(b); } }
    if (S.paint) S.paint();
  }
  async function poll() {
    if (S.busy) return;
    S.busy = true;
    try { S.data = await api('GET'); } catch (e) { S.data = null; }   // 老的本机服务没有这个接口、服务没开：什么也不摆
    finally { S.busy = false; }
    paintAll();
  }
  function topBtn() {
    const b = h('button', { class: 'btn ghost sm nw-btn', type: 'button', 'aria-haspopup': 'dialog', hidden: true, onclick: () => open() });
    S.btns.add(b);
    paintBtn(b);
    return b;
  }

  /* 一行后面的钮：点了先把这一行的钮都按住，做完重画；出错写在这一行下面 */
  function act(label, run, cls) {
    return h('button', { class: 'btn sm ' + (cls || 'ghost'), type: 'button', onclick: async e => {
      const row = e.currentTarget.closest('.nw-row'), err = row.querySelector('.nw-err');
      row.querySelectorAll('button').forEach(x => { x.disabled = true; });
      err.textContent = '';
      try { await run(); if (row.isConnected) row.querySelectorAll('button').forEach(y => { y.disabled = false; }); }   // 没重画（打开文件夹）：钮放开
      catch (x) { err.textContent = x.message; row.querySelectorAll('button').forEach(y => { y.disabled = false; }); }
    } }, label);
  }
  const reveal = rel => fetch('/api/fs/' + rel.split('/').map(encodeURIComponent).join('/') + '?reveal', { method: 'POST', headers: { 'X-Antou': '1' } })
    .then(async r => { if (!r.ok) throw new Error((await r.text()) || '没打开'); });
  const take = d => { S.data = { ...S.data, ...d }; paintAll(); };

  function rows() {
    const d = S.data || {}, out = [];
    if (gateOff(d)) {
      const who = [d.门卫.claude === false ? 'Claude' : '', d.门卫.codex === false ? 'Codex' : ''].filter(Boolean).join('、');
      out.push(h('div', { class: 'nw-row' },
        h('div', { class: 'nw-main' }, h('div', { class: 'nw-path' }, '门卫没装上：' + who), h('div', { class: 'nw-why' }, '设置被重置过会掉。装上以后，AI 往项目里写的文件名字不合规矩会被提醒'), h('div', { class: 'nw-err' })),
        h('div', { class: 'nw-acts' }, act('装上', async () => { take(await api('POST', { 装门卫: true })); toast('装上了。Codex 还要在它的 设置 > Hooks 里点一次信任'); }, 'ink'))));
    }
    for (const x of d.问题 || []) {
      out.push(h('div', { class: 'nw-row' },
        h('div', { class: 'nw-main' }, h('div', { class: 'nw-path', title: x.rel }, x.rel.replace(/^项目\//, '') + (x.dir ? '（文件夹）' : '')), h('div', { class: 'nw-why' }, x.why), h('div', { class: 'nw-err' })),
        h('div', { class: 'nw-acts' },
          x.fix ? act('改成「' + x.fix + '」', async () => { take(await api('POST', { rel: x.rel, 改成: x.fix })); toast('改好了：' + x.fix); }, 'ink') : null,
          act('打开所在文件夹', () => reveal(x.rel)),
          act('不用改', async () => { take(await api('POST', { rel: x.rel, 不用改: true })); }))));
    }
    if (!out.length) out.push(h('div', { class: 'nw-empty' }, '都合规矩了。'));
    return out;
  }

  async function open() {
    await poll();
    const list = h('div', { class: 'nw-list' });
    S.paint = () => list.replaceChildren(...rows());
    S.paint();
    await dialog(close => {
      const d = dlgShell('名字、位置不合规矩的', '规矩照 AGENTS.md。AI 写的时候门卫已经提醒过；这里是本机服务隔五分钟扫出来的，别的程序存的、手放进来的都在这。', list,
        [h('button', { class: 'btn ink', type: 'button', 'data-focus': '', onclick: () => close() }, '关上')]);
      d.classList.add('wide');   // 一行要摆路径和三个钮：用宽的弹窗
      return d;
    });
    S.paint = null;
  }

  setInterval(() => { if (!document.hidden) poll(); }, 60e3);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  window.NameWatch = Object.freeze({ topBtn, open, poll });
  /* 顶栏比这一份先画好了（这一份是后引进来的）：补上按钮 */
  const tr = document.querySelector('.wf-top .top-right');
  if (tr && !tr.querySelector('.nw-btn')) tr.prepend(topBtn());
  poll();
})();
