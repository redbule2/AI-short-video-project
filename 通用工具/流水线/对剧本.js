/* ============================================================
   流水线 · 对剧本（2026-11-16 他定）：片子定稿了、审片写了批注，和剧本对一对；对不上的，AI 替你在剧本旁边写剧本批注。
   不用复制给 AI：本机服务自己调（先本机 Codex 命令行，不行换 DeepSeek 接口），在 .agents/skills/annotate-live/script-check.js。
   这一份是页面那头（各页引在 流水线.js 后面）：
     审片页  点「满意，选定」「这一段定稿」、从审片台写完批注回来：自动开；这一段在对的、对出问题的，摆在样片上面
     剧本页  AI 写了几条批注，说一句；你重新定稿时，跟着片子改的那几条样片和提示词不标「待核对」（剧本改成了片子的样子）
             照定稿样片写的那几条：点「照片子改剧本」，项目自己照着改，镜头表跟着删、不用重新定稿（11-18，本机服务第 15 版起）
     顶栏    「内置 AI」：Codex 在不在、DeepSeek 的 key（每台电脑自己填，存在这台电脑的用户目录里，不进项目）
   记录在 定稿的剧本/第N段/第N段_对剧本.json（AI 写，页面只读）
   ============================================================ */
'use strict';
(function () {
  const KINDS = ['定稿对剧本', '审片对剧本'];
  const ready = () => AI.ok && LINK.v >= 13;   // 本机服务第 13 版起有
  const ledgerAt = seg => [F.name, '定稿的剧本', segName(seg), segName(seg) + '_对剧本.json'];
  const notesAt = seg => [F.name, '定稿的剧本', segName(seg), segName(seg) + '_剧本_批注.md'];
  const stem = v => String(v || '').replace(/\.[^.]+$/, '');

  /* ---------- 自动开 ---------- */
  async function open(body) {
    if (!ready()) return null;
    const j = await startJob(body, true);
    if (j && jobLive(j)) toast('自动对一对剧本：' + j.标题.replace(/^对剧本 · /, '') + '。对不上的写成剧本批注，不改剧本');
    return j;
  }
  /* 选定、这一段定稿：name 是这条样片当初照着出的那一版提示词 */
  const onPick = (s, vid, name) => vid && name ? open({ 事: '定稿对剧本', 段: s.段, 名: name, 视频: vid }) : null;
  /* 从审片台回来：这条写过批注才对 */
  const onNotes = (s, vid, name) => clipsOf(s.段).all.has(stem(vid) + '_批注.md') ? open({ 事: '审片对剧本', 段: s.段, 视频: vid, 名: name || '' }) : null;

  /* ---------- 审片页：这一段在对的、对出要改的、没对成的 ---------- */
  function lines(s) {
    const latest = new Map();
    for (const j of AI.jobs) if (KINDS.includes(j.事) && j.段 === s.段) latest.set(j.事 + '｜' + (j.名 || '') + '｜' + (j.视频 || ''), j);
    const out = [];
    for (const j of latest.values()) {
      if (jobLive(j)) { out.push(h('div', null, jobLine(j), h('span', { class: 'fn-note' }, j.标题))); continue; }
      if (Date.now() - (j.结束 || 0) > 30 * 60e3) continue;
      if (j.状态 === '做完' && (j.产出 || []).length) out.push(h('div', null, h('span', { class: 'fn-note warn' }, j.标题 + '：' + j.结果),
        h('button', { class: 'btn sm', type: 'button', title: '剧本页下面能看到 AI 写的批注，不同意的删掉', onclick: () => go('剧本', { s: s.段 }) }, '去剧本看批注')));
      else if (j.状态 === '没成') out.push(h('div', null, h('span', { class: 'fn-note warn', title: '任务书和 AI 的回答留在：' + j.记录 }, j.标题 + ' 没做成：' + j.错误)));
    }
    return out.length ? h('div', { class: 'wf-jobs' }, out) : null;
  }

  /* ---------- 剧本页 ---------- */
  const CACHE = new Map();   // 段 → { at, sig, list, notes }
  async function load(seg) {
    let list = [];
    try { list = (JSON.parse(C.decodeText((await FS.read(at(ledgerAt(seg)))).buf).text.replace(/^\uFEFF/, '')).记录) || []; } catch (e) { /* 还没对过 */ }
    const notes = !!(await FS.stat(at(notesAt(seg))));
    const v = { at: Date.now(), list: Array.isArray(list) ? list : [], notes };
    v.sig = v.list.length + '｜' + notes;
    return v;
  }
  /* ---------- 照片子改剧本（11-18 他定）：照定稿样片写的剧本批注带着「改成」，项目自己照着改，不再交给 AI、不用重新定稿 ----------
     服务那头（script-check.js）改完剧本，在对剧本记录里记一笔；这头照它记进这一场的「回填」（剧本定稿照旧算数，公用/核心.js 的 scriptFinal），
     写提示词时整镜删掉、对剧本认出来的镜头，从镜头表拿掉（号不再用） */
  const BACK = '照片子改剧本';
  function syncBack(seg, list) {
    const s = F.doc && Array.isArray(F.doc.场) ? F.doc.场.find(x => x.段 === seg) : null;
    if (!s || !C.applyBack || !C.applyBack(s, list, shotNos(s))) return false;   // 记「回填」、拿掉删掉的镜头：公用/核心.js
    touch();
    return true;
  }
  async function backfill(s) {
    if (!(await confirmDlg({ title: '照片子改剧本', ok: '照着改',
      body: 'AI 照定稿的样片写的那几条剧本批注，项目直接照着改剧本，原来的剧本收进历史记录；写提示词时整镜删掉的镜头，镜头表跟着删。剧本定稿照旧算数，不用重新定稿。你写的、照审片批注写的留着，照老办法交给 AI 改。' }))) return;
    const j = await startJob({ 事: BACK, 段: s.段 }, true);
    if (j) toast(j.状态 === '没成' ? '没改成：' + j.错误 : '在照片子改剧本，几秒就好', j.状态 === '没成' ? 'err' : undefined);
    rerender();
  }

  /* 剧本上方那一条：这回定稿以后 AI 写了几条批注、还在 */
  function scriptNote(s) {
    if (!ready()) return null;
    const c = CACHE.get(s.段), ended = AI.jobs.some(j => (KINDS.includes(j.事) || j.事 === BACK) && j.段 === s.段 && !jobLive(j) && (j.结束 || 0) > (c ? c.at : 0));
    if (!c || ended || Date.now() - c.at > 15e3) {
      if (!c || !c.loading) {
        if (c) c.loading = true; else CACHE.set(s.段, { at: 0, sig: '', list: [], notes: false, loading: true });
        load(s.段).then(v => { const was = CACHE.get(s.段); CACHE.set(s.段, v); if (syncBack(s.段, v.list) || !was || was.sig !== v.sig) { if (!typing()) rerender(); else F.later = true; } })
          .catch(() => { const x = CACHE.get(s.段); if (x) { x.loading = false; x.at = Date.now(); } });
      }
      if (!c || !c.at) return null;
    }
    if (!c.notes) return null;
    const since = Math.max(timeOf(s.剧本定稿), timeOf(s.回填)), mine = c.list.filter(r => (r.写了 || []).length && timeOf(r.时间) > since);
    if (!mine.length) return null;
    const n = k => mine.filter(r => r.事 === k).reduce((a, r) => a + r.写了.length, 0), a = n('定稿对剧本'), b = n('审片对剧本');
    const auto = LINK.v >= 15 && mine.some(r => r.事 === '定稿对剧本' && r.写了.some(x => typeof x.改成 === 'string')), run = AI.jobs.find(j => j.事 === BACK && j.段 === s.段 && jobLive(j));
    return h('span', { class: 'fn-note warn', title: '对剧本的记录在 ' + ledgerAt(s.段).slice(1).join('/') },
      'AI 对剧本写了 ' + (a + b) + ' 条批注（' + [a ? '照定稿的样片 ' + a + ' 条' : '', b ? '照审片批注 ' + b + ' 条' : ''].filter(Boolean).join('、') + '），标着「AI 照……写」。在下面看：不同意的删掉，'
      + (auto ? '同意就点「照片子改剧本」：照定稿样片写的那几条项目自己改，镜头表跟着改，不用重新定稿' + (b ? '；照审片批注写的照老办法交给 AI 改' : '') + '。' : '同意就交给 AI 改，改完重新定稿。'),
      auto ? (run ? jobLine(run) : h('button', { class: 'btn sm', type: 'button', title: '不调 AI：照对剧本时 AI 写好的「改成」直接改剧本', onclick: () => backfill(s) }, '照片子改剧本')) : null);
  }
  /* 重新定稿时（剧本.html 的 finalScript）：上回定稿以后照定稿的样片写过批注的，那几条样片还选定着，就记「沿用」。返回记了几条 */
  async function keepClips(s, prev) {
    if (!ready()) return 0;
    let v;
    try { v = await load(s.段); } catch (e) { return 0; }
    const since = timeOf(prev), sel = s.选定 && typeof s.选定 === 'object' ? s.选定 : {}, done = new Set();
    for (const r of v.list) {
      if (r.事 !== '定稿对剧本' || !(r.写了 || []).length || timeOf(r.时间) <= since) continue;
      const key = vpBase(nowName(s.段, String(r.提示词 || '')));   // 记录里是改名以前的名字也认
      if (!key || sel[key] !== r.视频 || done.has(key)) continue;
      done.add(key);
      keepAsIs(s, '样片/' + r.视频);
      const e = promptsOf(s.段).find(x => x.key === key);
      keepAsIs(s, '提示词/' + (e ? e.name : key));
    }
    return done.size;
  }

  /* ---------- 顶栏「内置 AI」 ---------- */
  let ST = null, asking = false;
  async function status(force) {
    if (!ready()) return null;
    if (ST && !force) return ST;
    if (asking) return ST;
    asking = true;
    try { ST = await (await LINK.req('GET', '/api/builtin-ai')).json(); } catch (e) { ST = null; } finally { asking = false; }
    return ST;
  }
  function topBtn() {
    if (!ready()) return null;
    if (!ST) { status().then(st => { if (st) { const b = document.querySelector('.wf-builtin'); if (b) b.replaceWith(topBtn()); } }); }
    const bad = ST && !ST.codex && !ST.deepseek.填了;
    return h('button', { class: 'btn ghost sm wf-builtin' + (bad ? ' warn' : ''), type: 'button', title: '对剧本用的 AI：先本机 Codex，不行换 DeepSeek。点开看、填 DeepSeek 的 key', onclick: setup },
      '内置 AI' + (ST && !ST.deepseek.填了 ? '（没填 key）' : ''));
  }
  async function setup() {
    const st = await status(true);
    if (!st) { toast('本机服务是旧的，重开一次才有内置 AI', 'err'); return; }
    const inp = h('input', { class: 'inp', type: 'password', placeholder: 'sk-……', autocomplete: 'off', spellcheck: 'false' });
    const say = h('div', { class: 'fn-note' });
    const ds = st.deepseek.填了 ? '填了（尾号 ' + st.deepseek.尾号 + (st.deepseek.时间 ? '，' + String(st.deepseek.时间).slice(0, 10) + ' 填的' : '') + '）' : '还没填';
    await dialog(close => {
      const save = async () => {
        const key = inp.value.trim();
        if (!key) { say.textContent = '先把 key 贴进上面的框'; return; }
        say.textContent = '在查这个 key 能不能用……';
        try { const r = await (await LINK.req('POST', '/api/builtin-ai', C.encodeText(JSON.stringify({ key })))).json(); toast('存好了：尾号 ' + r.尾号 + '，余额 ' + r.余额); ST = null; close(); refreshBtn(); }
        catch (e) { say.textContent = '没存：' + e.message; }
      };
      const test = async () => {
        say.textContent = '在查余额……';
        try { const r = await (await LINK.req('POST', '/api/builtin-ai?test')).json(); say.textContent = (r.能用 ? '能用' : '用不了') + '，余额 ' + r.余额; }
        catch (e) { say.textContent = '查不了：' + e.message; }
      };
      const drop = async () => {
        if (!(await confirmDlg({ title: '删掉 DeepSeek 的 key', body: '删掉以后，Codex 没对成就没有后备。', ok: '删掉' }))) return;
        try { await LINK.req('DELETE', '/api/builtin-ai'); toast('删掉了'); ST = null; close(); refreshBtn(); } catch (e) { say.textContent = '没删掉：' + e.message; }
      };
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); save(); } });
      return dlgShell('内置 AI', '片子定稿、写完审片批注时，项目自己调 AI 对一对剧本，不用你复制。先用这台电脑上的 Codex（命令行，不开窗口）；Codex 没对成、超过 6 分钟，换 DeepSeek。',
        [h('p', null, 'Codex 命令行：' + (st.codex ? '找到了' : '没找到（装好 Codex 桌面版就有）')),
          h('p', null, 'DeepSeek 的 key：' + ds + '。key 只存在这台电脑的用户目录里，不进项目、不上网盘。'),
          field(st.deepseek.填了 ? '换一个 key' : '填 key', inp), say],
        [st.deepseek.填了 ? h('button', { class: 'btn ghost', type: 'button', onclick: drop }, '删掉 key') : null,
          st.deepseek.填了 ? h('button', { class: 'btn ghost', type: 'button', onclick: test }, '查余额') : null,
          h('button', { class: 'btn ghost', type: 'button', onclick: () => close() }, '关上'),
          h('button', { class: 'btn ink', type: 'button', onclick: save }, '存上')].filter(Boolean));
    });
  }
  function refreshBtn() { status(true).then(() => { const b = document.querySelector('.wf-builtin'); if (b) b.replaceWith(topBtn()); }); }

  window.ScriptCheck = { onPick, onNotes, lines, scriptNote, keepClips, topBtn };

  /* 引进来时顶栏已经画好了：等本机服务连上，把「内置 AI」补进去（以后重画顶栏，renderTop 自己带上） */
  let tries = 0;
  const tick = setInterval(() => {
    if (++tries > 40) { clearInterval(tick); return; }
    if (!ready() || !F.doc || !Array.isArray(F.doc.场)) return;
    clearInterval(tick);
    for (const x of F.doc.场) if (x && x.剧本定稿) load(x.段).then(v => { if (syncBack(x.段, v.list) && !typing()) rerender(); }).catch(() => {});   // 别的页面照片子改过剧本、这一页还没记上的：补记（11-18）
    const top = document.querySelector('.wf-top .top-right');
    if (!top || top.querySelector('.wf-builtin')) return;
    const b = topBtn();
    if (b) top.insertBefore(b, top.querySelector('.ai-ch-box') || top.querySelector('#fl-status'));
  }, 500);
})();
