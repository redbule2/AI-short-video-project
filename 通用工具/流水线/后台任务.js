/* ============================================================
   流水线 · 后台任务（2026-11-17 他要的：正在做的任务都放进一个抽屉，点一下去它那一页）
   顶栏右边「后台任务」：有在做的就转圈、带个数（有等你交给 AI 的，个数是红的）。点开从右边滑出一栏：
     在做的     这台电脑上本机服务在做的事：各项目的 AI 任务（排着队的、在做的、等你交给 AI 的），网盘传、拿、删。这个项目的排前面
     刚做完的   半小时里做完、没成、停掉的，摆在下面，也能点过去看结果
   点一行去那件事的那一页（别的项目的顺带换项目；就在眼前这一页的，收起抽屉、页面上那一行闪一下）。
   一行后面：停掉；等你交给 AI 的还有「交给 AI 的话」。抽屉不挡页面：点外面、Esc、再点「后台任务」都收起。
   不改本机服务：AI 任务问 GET /api/job（不带 p 就是各项目的），网盘问 GET /api/wangpan/jobs。
   流水线.js 替各页引这一份（最下面），顶栏里摆 BgTasks.topBtn()。
   去哪一页、怎么排、怎么说（targetOf、rowsOf 这几样）不碰页面，在 通用工具/测试/后台任务_测试.cjs 里测。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BgTasks = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const LIVE = ['排队', '在做'];
  const FRESH_MS = 30 * 60e3;   // 刚做完的摆半小时
  const MAX_DONE = 6;
  /* 哪件事在哪一页看（页面文件名）：剧本、提炼（分场.html）、资产、提示词（审片在它每条上的弹窗）。全片的几件在全片设定的分页里，下面 targetOf 单算 */
  const PAGE_OF = {
    按批注改: '剧本', 与AI沟通剧本: '剧本', 影响清单: '剧本',
    提炼: '分场', 提炼按批注改: '分场',
    出图: '资产', 改图: '资产', 写字: '资产', 按批注改字: '资产', 核GEO: '资产',
    写提示词: '提示词', 写完提示词: '提示词', 出片任务书: '提示词', 出片: '提示词', 批注提示词: '提示词', 按批注改提示词: '提示词', 照审片批注另存: '提示词', 另写一种: '提示词',
  };
  const PAGE_NAME = { 总览: '首页', 设定: '全片设定', 剧本: '剧本', 分场: '提炼', 资产: '资产', 提示词: '提示词', 网盘: '网盘' };
  const PAN_KIND = { up: '上传', down: '拿下来', del: '删网盘上的', oldget: '拿回旧版', olddel: '删旧版' };
  const str = v => typeof v === 'string' ? v : v == null ? '' : String(v);
  const segOk = v => /^[0-9]+(-[0-9]+)*$/.test(v);
  /* 第几段：任务上写着的；按剧本批注改的，从批注文件名里认（定稿的剧本/第3-4段/第3-4段_剧本_批注.md） */
  function segOf(j) {
    const s = str(j.段).trim();
    if (segOk(s)) return s;
    const m = /第([0-9]+(?:-[0-9]+)*)段/.exec(str(j.批注) + ' ' + str(j.标题));
    return m ? m[1] : '';
  }
  /* 一件 AI 任务在哪一页看：{ page, s（第几段，全片的空着）, hash（全片设定的分页） } */
  function targetOf(j) {
    const s = segOf(j), 事 = str(j.事);
    if (事 === '补细') return { page: '设定', s: '', hash: Array.isArray(j.人物) && j.人物.length ? '人物' : '道具' };
    if (事 === '场景GEO') return { page: '设定', s: '', hash: '场景' };
    if (事 === '推荐风格') return s ? { page: '剧本', s, hash: '' } : { page: '设定', s: '', hash: '风格' };   // 一段另选的风格：那一段页面顶上的风格小牌子
    const page = PAGE_OF[事];
    return page && s ? { page, s, hash: '' } : { page: '总览', s: '', hash: '' };   // 认不出的、没说第几段的：回这个项目的首页
  }
  const whereOf = t => t.s ? '第' + t.s + '段 · ' + PAGE_NAME[t.page] : PAGE_NAME[t.page] + (t.hash ? ' · ' + t.hash : '');
  /* 在做的这会儿在干什么 */
  function sayOf(j) {
    const x = j.交给;
    if (j.状态 === '排队') return '排着队，前面还有别的任务';
    if (x && x.等 === '你') return '等你交给 AI';
    if (x && x.等 === '发送') return '等你在 Claude 里按发送';
    return str(j.步骤).trim() || (str(j.渠道名) || 'AI') + ' 在做';
  }
  /* 做完的：结果一句 */
  function endOf(j) {
    if (j.状态 === '做完') return str(j.结果).trim() || '做完了';
    if (j.状态 === '停了') return '停掉了';
    return '没成：' + (str(j.错误).trim() || '没说为什么');
  }
  function aiRow(j) {
    const live = LIVE.includes(j.状态), t = targetOf(j), x = live ? j.交给 : null;
    return { key: 'ai:' + j.id, src: 'ai', id: j.id, p: str(j.项目), title: str(j.标题).trim() || str(j.事), live, queued: j.状态 === '排队',
      wait: !!x && (x.等 === '你' || x.等 === '发送'), t0: +j.开始 || +j.建 || 0, t1: +j.结束 || 0, say: live ? sayOf(j) : endOf(j),
      ok: j.状态 === '做完', ...t, where: whereOf(t), job: j };
  }
  function panRow(j) {
    const live = j.state === 'running', st = j.state;
    return { key: 'pan:' + j.id, src: 'pan', id: j.id, p: str(j.p), title: str(j.title).trim() || '网盘 · ' + (PAN_KIND[j.kind] || '传拿'), live, queued: false, wait: false,
      t0: +j.started || 0, t1: +j.ended || 0,
      say: live ? (j.total ? '做了 ' + (j.done || 0) + ' / ' + j.total : '在做') : st === 'done' ? '好了' : st === 'stopped' ? '停掉了'
        : j.restarted ? '本机服务重开过，没做完：点进去「再来一次」'   // 11-18：重开时那件在做，跟着断了（网盘管理.js 存盘读回来的）
        : '没全做成' + (j.nErrors ? '（' + j.nErrors + ' 处出错）' : ''),
      ok: st === 'done', page: '网盘', s: '', hash: '', where: '网盘', job: j };
  }
  /* 抽屉里摆什么：live 在做的（这个项目的在前，同一个项目的挨着；等你的在前，排队的在后，先开的在前），done 半小时里做完的（新的在前） */
  function rowsOf(ai, pan, cur, now) {
    const all = [...(Array.isArray(ai) ? ai : []).map(aiRow), ...(Array.isArray(pan) ? pan : []).map(panRow)];
    const live = all.filter(r => r.live).sort((a, b) => (b.p === cur) - (a.p === cur) || (a.p === b.p ? 0 : a.p.localeCompare(b.p, 'zh')) || b.wait - a.wait || a.queued - b.queued || a.t0 - b.t0);
    const done = all.filter(r => !r.live && r.t1 && now - r.t1 < FRESH_MS).sort((a, b) => b.t1 - a.t1).slice(0, MAX_DONE);
    return { live, done };
  }
  /* 做了多久：2:05、1:02:05 */
  function durText(ms) {
    const s = Math.max(0, Math.round(ms / 1000)), m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    return m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ':' + ss : m + ':' + ss;
  }
  const agoText = ms => ms < 60e3 ? '刚刚' : Math.floor(ms / 60e3) + ' 分钟前';
  const pure = { LIVE, PAGE_OF, segOf, targetOf, whereOf, sayOf, endOf, aiRow, panRow, rowsOf, durText, agoText };
  if (typeof document === 'undefined' || typeof h !== 'function' || typeof LINK !== 'object') return Object.freeze(pure);
  if (window.BgTasks) return window.BgTasks;   // 引了两回：用头一回的

  /* ---------- 页面上的：顶栏按钮、抽屉、隔一会儿问一次 ---------- */
  const CSS = `
.bg-btn .wt-ring { font-size: 12.5px; color: var(--zhe); }
.bg-btn.on { background: rgb(from var(--ink) r g b / .08); color: var(--ink); }
@media (max-width: 1279px) { .bg-btn .bg-tx { display: none; } .bg-btn { padding-left: 9px; padding-right: 9px; } }   /* 窗口窄：只留转圈和个数，给左边的项目名让地方 */
.bg-n { min-width: 18px; height: 18px; padding: 0 5px; display: inline-grid; place-items: center; box-sizing: border-box; border-radius: 9px; background: var(--zhe); color: var(--on-accent); font: 600 11px/1 var(--sans); letter-spacing: 0; }
.bg-n.you { background: var(--zhu); }
.bg-drawer { position: fixed; top: 60px; right: 0; bottom: 0; z-index: 45; width: min(420px, 100vw); display: flex; flex-direction: column; box-sizing: border-box;
  border-left: 1px solid var(--line-2); background: var(--sheet); box-shadow: -18px 0 44px -26px rgb(from var(--shade) r g b / .45); transform: translateX(104%); transition: transform .18s ease; }
.bg-drawer.on { transform: none; }
.bg-drawer[hidden] { display: none; }
.bg-h { flex: none; display: flex; align-items: baseline; gap: 10px; padding: 14px 14px 10px 20px; border-bottom: 1px solid var(--line); }
.bg-h b { font: 600 16px var(--serif); letter-spacing: .08em; }
.bg-sum { font-size: 12.5px; color: var(--ink-3); }
.bg-h .sp { flex: 1; }
.bg-x { align-self: center; width: 28px; height: 28px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 7px; background: none; color: var(--ink-3); cursor: pointer; }
.bg-x:hover { background: rgb(from var(--ink) r g b / .07); color: var(--ink); }
.bg-list { flex: 1; overflow: auto; padding: 6px 10px 18px; }
.bg-g { display: flex; align-items: baseline; gap: 8px; margin: 14px 10px 4px; font: 600 12.5px var(--sans); color: var(--ink-2); }
.bg-g em { font-style: normal; font-weight: 400; color: var(--ink-3); }
.bg-none { margin: 18px 10px 6px; font-size: 13px; color: var(--ink-3); }
.bg-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 12px; padding: 9px 10px; border-radius: 9px; cursor: pointer; }
.bg-row:hover, .bg-row:focus-visible { background: var(--paper); outline: none; }
.bg-l1, .bg-l2 { grid-column: 1; }
.bg-l1 { display: flex; align-items: center; gap: 8px; min-width: 0; }
.bg-l1 > b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13.5px; font-weight: 600; color: var(--ink); }
.bg-l1 > .wt-ring { font-size: 13px; color: var(--zhe); }
.bg-l1 > .ic { flex: none; width: 14px; height: 14px; }
.bg-dot { flex: none; width: 8px; height: 8px; margin: 0 3px; border-radius: 50%; background: var(--zhu); }
.bg-l2 { display: flex; align-items: baseline; gap: 8px; min-width: 0; padding-left: 22px; font-size: 12.5px; color: var(--ink-3); }
.bg-l2 > span { flex: none; max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }   /* 去哪儿写全（太长才省略），在干什么占剩下的 */
.bg-l2 > .bg-say { flex: 0 1 auto; max-width: none; min-width: 0; }
.bg-l2 > b { flex: none; font: 600 12px var(--mono); }
.bg-l2 > i { flex: none; font-style: normal; white-space: nowrap; }
.bg-row.live .bg-say { color: var(--zhe); }
.bg-row.you .bg-say { color: var(--zhu); }
.bg-acts { grid-column: 2; grid-row: 1 / span 2; align-self: center; display: flex; align-items: center; gap: 12px; }
.bg-acts .hai-mini { margin-left: 0; }
.bg-row.done .bg-l1 > b { font-weight: 400; color: var(--ink-2); }
.bg-row.done.ok .ic { color: var(--dai); }
.bg-row.done.bad .ic, .bg-row.done.bad .bg-say { color: var(--zhu); }
.bg-flash { animation: bg-flash 1.2s ease 2; border-radius: 999px; }
@keyframes bg-flash { 0%, 100% { box-shadow: 0 0 0 0 transparent; } 45% { box-shadow: 0 0 0 4px var(--zhe-line); } }
@media (prefers-reduced-motion: reduce) { .bg-drawer { transition: none; } .bg-flash { animation: none; outline: 2px solid var(--zhe-line); } }`;
  if (!document.getElementById('bg-style')) document.head.append(Object.assign(document.createElement('style'), { id: 'bg-style', textContent: CSS }));

  const S = { ai: [], pan: [], panOff: false, at: 0, tried: 0, busy: false, timer: 0, open: false, box: null, list: null, sum: null, sig: '', mineSig: '' };
  const cur = () => (typeof F === 'object' && F && F.name) || '';
  const ready = () => typeof AI === 'object' && !!AI.ok && !!LINK.on;   // 本机服务第 5 版起有 AI 任务
  const shellOn = () => typeof SHELL !== 'undefined' && !!SHELL;
  /* 各项目的任务；这一页刚开、刚停的还没问到的，先拿这一页自己的（AI.jobs）补上 */
  function rows() {
    const ids = new Set(S.ai.map(j => j.id)), mine = ready() && Array.isArray(AI.jobs) ? AI.jobs.filter(j => !ids.has(j.id)) : [];
    return rowsOf([...S.ai, ...mine], S.pan, cur(), Date.now());
  }
  async function poll() {
    if (S.busy) return;
    clearTimeout(S.timer);
    S.busy = true; S.tried = Date.now();
    try {
      if (ready() && !document.hidden) {
        try { const r = await (await LINK.req('GET', '/api/job')).json(); S.ai = Array.isArray(r.jobs) ? r.jobs : []; S.at = Date.now(); }
        catch (e) { /* 本机服务断了一下、正在重开：下回再问 */ }
        if (!S.panOff && LINK.v >= 7) {
          try { const r = await (await LINK.req('GET', '/api/wangpan/jobs')).json(); S.pan = Array.isArray(r.jobs) ? r.jobs : []; }
          catch (e) { if (/没有这个文件|没装上/.test(e.message)) { S.panOff = true; S.pan = []; } }   // 网盘那一页没装上：不再问
        }
        paint();
      }
    } finally {
      S.busy = false;
      S.timer = setTimeout(poll, S.open || rows().live.length ? 2000 : 6000);
    }
  }
  function paint() {
    const { live, done } = rows();
    for (const b of document.querySelectorAll('.bg-btn')) paintBtn(b, live);
    if (S.open) paintList(live, done);
  }
  /* 顶栏的按钮：有在做的转圈、带个数；只剩等你交给 AI 的不转，个数红的 */
  function paintBtn(b, live) {
    const n = live.length, you = live.filter(r => r.wait).length, busy = live.some(r => !r.wait), sig = n + '|' + you + '|' + busy + '|' + S.open;
    if (b.dataset.sig === sig) return;
    b.dataset.sig = sig;
    b.classList.toggle('on', S.open);
    b.setAttribute('aria-expanded', String(S.open));
    b.title = '后台任务：' + (n ? '在做 ' + n + ' 件' + (you ? '，其中 ' + you + ' 件等你交给 AI' : '') + '。点开看全部，点一行去那件事的那一页' : '没有在做的。点开看半小时里刚做完的');
    b.setAttribute('aria-label', '后台任务' + (n ? '，在做 ' + n + ' 件' : ''));
    b.replaceChildren(...[busy ? h('i', { class: 'wt-ring' }) : icon('sideR'), h('span', { class: 'bg-tx' }, '后台任务'), n ? h('span', { class: 'bg-n' + (you ? ' you' : '') }, String(n)) : null].filter(Boolean));
  }
  function topBtn() {
    if (!ready()) return null;   // 老的本机服务没有任务接口
    const b = h('button', { class: 'btn ghost sm bg-btn', type: 'button', 'aria-haspopup': 'dialog', onclick: () => (S.open ? close() : open()) });
    paintBtn(b, rows().live);
    if (!S.at) poll();
    return b;
  }

  /* ---------- 抽屉 ---------- */
  function build() {
    S.sum = h('span', { class: 'bg-sum' });
    S.list = h('div', { class: 'bg-list' });
    S.box = h('aside', { class: 'bg-drawer', role: 'dialog', 'aria-label': '后台任务', hidden: true },
      h('div', { class: 'bg-h' }, h('b', { title: '本机服务在做的事：各项目的 AI 任务、网盘传拿。AI 任务重开本机服务也还在：在等回复的接着等，接不上的写明要重点一次' }, '后台任务'), S.sum, h('span', { class: 'sp' }),
        h('button', { class: 'bg-x', type: 'button', title: '收起（Esc）', onclick: () => close() }, icon('x'))),
      S.list);
    document.body.append(S.box);
  }
  function open() {
    if (!S.box) build();
    const hd = document.querySelector('.wf-top');
    S.box.style.top = (hd ? Math.max(0, Math.round(hd.getBoundingClientRect().bottom)) : 0) + 'px';   // 从页头下面拉出来：页头的按钮照样点得到
    S.open = true; S.sig = '';
    S.box.hidden = false;
    void S.box.offsetWidth;   // 先摆在右边外面，再滑进来
    S.box.classList.add('on');
    paint(); poll();
    const first = S.list.querySelector('.bg-row');
    (first || S.box.querySelector('.bg-x')).focus({ preventScroll: true });
  }
  function close() {
    if (!S.open) return;
    S.open = false;
    if (S.box.contains(document.activeElement)) { const b = document.querySelector('.bg-btn'); if (b) b.focus({ preventScroll: true }); }
    S.box.classList.remove('on');
    setTimeout(() => { if (!S.open) S.box.hidden = true; }, 200);
    paint();
  }
  function paintList(live, done) {
    const me = cur(), sig = [me, ...live.map(r => r.key + '|' + r.say + '|' + r.wait), '/', ...done.map(r => r.key + '|' + r.say)].join('\n');
    const you = live.filter(r => r.wait).length;
    S.sum.textContent = live.length ? '在做 ' + live.length + ' 件' + (you ? ' · 等你 ' + you + ' 件' : '') : '没有在做的';
    if (sig !== S.sig) {   // 有变化才重画：滚到哪、光标在哪一行都留着
      S.sig = sig;
      const sc = S.list.scrollTop, a = document.activeElement, fk = a && S.list.contains(a) && a.closest('.bg-row') ? a.closest('.bg-row').dataset.key : '';
      S.list.replaceChildren(...listEls(live, done, me));
      S.list.scrollTop = sc;
      const back = fk && [...S.list.querySelectorAll('.bg-row')].find(e => e.dataset.key === fk);
      if (back) back.focus({ preventScroll: true });
    }
    tickTimes();
  }
  function listEls(live, done, me) {
    const out = [], mixed = live.some(r => r.p !== me);
    if (!live.length) out.push(h('p', { class: 'bg-none' }, '现在没有在做的任务。'));
    let last = null;
    for (const r of live) {
      if (mixed && r.p !== last) { out.push(h('div', { class: 'bg-g' }, r.p || '（没说哪个项目）', r.p === me ? h('em', null, '这个项目') : null)); last = r.p; }
      out.push(rowEl(r, me));
    }
    if (done.length) {
      out.push(h('div', { class: 'bg-g' }, '刚做完的', h('em', null, '半小时里')));
      for (const r of done) out.push(rowEl(r, me));
    }
    return out;
  }
  function rowEl(r, me) {
    const other = r.p && r.p !== me, where = (other ? r.p + ' · ' : '') + r.where;
    const acts = r.live ? [...(r.src === 'ai' && window.HandAI ? HandAI.buttons(r.job, () => poll()) : []),
      h('button', { class: 'fl-link mute', type: 'button', title: '不等了，停掉这个任务', onclick: () => stop(r) }, '停掉')] : [];
    const mark = r.live ? (r.wait ? h('i', { class: 'bg-dot' }) : h('i', { class: 'wt-ring' })) : icon(r.ok ? 'check' : 'x');
    return h('div', { class: 'bg-row ' + (r.live ? 'live' : 'done ' + (r.ok ? 'ok' : 'bad')) + (r.wait ? ' you' : ''), role: 'button', tabindex: '0', 'data-key': r.key, title: '去「' + where + '」',
      onclick: e => { if (!e.target.closest('button')) jump(r); },
      onkeydown: e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); jump(r); } } },
      h('div', { class: 'bg-l1' }, mark, h('b', null, r.title)),
      h('div', { class: 'bg-l2' }, h('span', null, (r.live && other ? '' : other ? r.p + ' · ' : '') + r.where), h('span', { class: 'bg-say', title: r.say }, r.say),
        r.live ? (r.t0 ? h('b', { 'data-t0': String(r.t0) }) : null) : h('i', { 'data-t1': String(r.t1) })),
      acts.length ? h('div', { class: 'bg-acts' }, acts) : null);
  }
  /* 做了多久、几分钟前：一秒走一次，只换字 */
  function tickTimes() {
    if (!S.list) return;
    const now = Date.now();
    for (const b of S.list.querySelectorAll('[data-t0]')) b.textContent = durText(now - +b.dataset.t0);
    for (const i of S.list.querySelectorAll('[data-t1]')) i.textContent = agoText(now - +i.dataset.t1);
  }
  async function stop(r) {
    try {
      if (r.src === 'pan') await LINK.req('POST', '/api/wangpan/stop', C.encodeText(JSON.stringify({ id: r.id })), { 'Content-Type': 'application/json' });
      else await LINK.req('POST', '/api/job/' + r.id + '?cancel');
    } catch (e) { toast('没停成：' + e.message, 'err'); }
    if (r.src === 'ai' && r.p === cur() && typeof loadJobs === 'function') loadJobs();   // 这一页上那一行跟着换
    poll();
  }
  /* 去那件事的那一页。就在眼前这一页的：不重开页面（滚到哪、没存的字都留着），收起抽屉、那一行闪一下 */
  function jump(r) {
    close();
    const me = cur(), P = typeof PAGE === 'object' ? PAGE : null;
    const here = !!P && !shellOn() && (r.p || me) === me && P.name === r.page && (!P.scene || F.seg === r.s);
    if (!here) { go(r.page, { p: r.p || me, s: r.s }, r.hash); return; }
    if (r.page === '设定' && r.hash && typeof setTab === 'function') setTab(r.hash);
    flash(r);
  }
  function flash(r) {
    const lines = [...document.querySelectorAll('#wf .wf-jobs > div')], short = r.title.replace(/ · .*/, '');
    const el = lines.find(e => e.textContent.includes(r.title)) || lines.find(e => e.textContent.includes(short)) || document.querySelector('#wf .ai-run');
    if (!el) return;
    const pill = el.querySelector('.ai-run') || el;
    pill.scrollIntoView({ block: 'center', behavior: 'smooth' });
    pill.classList.remove('bg-flash'); void pill.offsetWidth; pill.classList.add('bg-flash');
    setTimeout(() => pill.classList.remove('bg-flash'), 2600);
  }

  /* ---------- 收起：点抽屉外面（对话框、交给 AI 的话、提示条上点的不算）、Esc、点进盖着的写稿页 ---------- */
  document.addEventListener('pointerdown', e => {
    if (!S.open || !(e.target instanceof Element)) return;
    if (S.box.contains(e.target) || e.target.closest('.bg-btn, .hai-mask, .mask, #layer, #toasts, .fl-pop, .fl-hov')) return;
    close();
  }, true);
  window.addEventListener('keydown', e => {
    if (!S.open || e.key !== 'Escape' || document.querySelector('.mask:not(.out), .hai-mask')) return;
    e.preventDefault(); e.stopPropagation();
    close();
  }, true);
  window.addEventListener('blur', () => setTimeout(() => { if (S.open && document.activeElement && document.activeElement.tagName === 'IFRAME') close(); }, 0));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  /* 一秒看一眼：服务刚连上就问（问不到的隔几秒再试）；这一页自己开了、停了任务（AI.jobs 变了）马上再问，顶栏的个数不等下一轮；开着就走表 */
  setInterval(() => {
    if (document.hidden || !ready()) return;
    const mine = Array.isArray(AI.jobs) ? AI.jobs.filter(j => LIVE.includes(j.状态)).map(j => j.id + j.状态).join() : '';
    if ((!S.at && Date.now() - (S.tried || 0) > 5000) || mine !== S.mineSig) { S.mineSig = mine; poll(); }
    if (S.open) tickTimes();
  }, 1000);
  /* 顶栏比这一份先画好了（这一份是后引进来的）：补上按钮 */
  const tr = document.querySelector('.wf-top .top-right');
  if (tr && !tr.querySelector('.bg-btn')) { const b = topBtn(); if (b) tr.prepend(b); }

  return Object.freeze({ ...pure, topBtn, open, close, poll });
});
