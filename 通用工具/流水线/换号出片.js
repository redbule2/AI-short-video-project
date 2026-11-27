'use strict';
/* ============================================================
   换个即梦号出片（2026-11-26 他要的）
   原来的号没积分了：弹窗问要不要换到别的号——挑那个号名下的一张画布，那个号没有画布就新建一张（名字写项目名）。
   换好以后这个项目都用新号的这张画布出；用到的素材出片时在新画布上重新传一遍（不花积分），原来那张画布不动。
   什么时候弹：出片报完价、这个号的积分不够（任务上记着「缺积分」，jm-video.js 记的）；「批准出片」弹窗里点「换个号」也行。
   有哪几个号：默认的那一个，加上首页「即梦授权」里登记过的登录位（流水线.js 的 jmNames）。
   服务那头（jobs.js）：GET /api/jimeng?canvases 列那个号名下的画布，POST /api/jimeng?switch 换过去——只改 资产/出片设置.json 的「画布」「登录位」，
   换下来的那一对记在「换下的」里，要换回去照样在这里换。
   「批准出片」弹窗最上面那一块也在这里（card，同一天他要）：批准的时候把具体哪个号、哪张画布摆给他看——
   号写登录位和昵称、还剩多少积分，画布写名字（到这个号名下的画布里找）；画布不在这个号名下、号没登录的标红。
   只提示词页用。用到 流水线.js 的 F、at、jmNames、go 和 公用 的 h、dialog、dlgShell、LINK、FS、C。
   ============================================================ */
const JmSwap = (() => {
  const who = (p, nick) => (p ? '「' + p + '」号' : '默认号') + (nick ? '「' + nick + '」' : '');
  const ask = async (method, q) => { try { return await (await LINK.req(method, '/api/jimeng?' + q)).json(); } catch (e) { return { ok: false, error: e.message }; } };
  const inner = r => (r && r.data && (r.data.data || r.data)) || {};
  /* 一个登录位：登没登录、昵称、还剩多少积分（查不到是 null） */
  async function account(p) {
    const r = await ask('GET', 'x=1&profile=' + encodeURIComponent(p)), sd = inner(r.status), ad = inner(r.account);
    const raw = ad.availableCredits != null ? ad.availableCredits : ad.credits && ad.credits.available;
    return { p, on: !!(r.status && r.status.ok && sd.loggedIn === true), nick: ad.displayName || '', credits: raw == null || raw === '' || !isFinite(+raw) ? null : +raw };
  }
  /* 这个项目现在记的是哪个号、哪张画布（资产/出片设置.json；还没有这份文件就是默认号、没画布） */
  async function setting() {
    try {
      const d = JSON.parse(C.decodeText((await FS.read(at([F.name, '资产', '出片设置.json']))).buf).text);
      return { p: /^[A-Za-z0-9_-]{1,40}$/.test(d.登录位 || '') && d.登录位 !== 'default' ? d.登录位 : '', 画布: String(d.画布 || ''), 换下的: Array.isArray(d.换下的) ? d.换下的 : [] };
    } catch (e) { return { p: '', 画布: '', 换下的: [] }; }
  }
  const idOf = u => (/[0-9a-f]{8}-[0-9a-f-]{27}/i.exec(String(u)) || [''])[0].toLowerCase();   // 画布网址里的编号
  /* 设置里记的那张画布叫什么：到这个号名下的画布里找。找到回 { 画布名 }；不在这个号名下回 { 画布错: true }（出片时服务会拦下）；
     没写画布、没查到（没登录、即梦没回音）回 {} */
  async function canvasOf(p, url) {
    const id = idOf(url);
    if (!id) return {};
    const r = await ask('GET', 'canvases=1&profile=' + encodeURIComponent(p));
    if (!r.ok) return {};
    const hit = (r.items || []).find(x => String(x.id).toLowerCase() === id);
    return hit ? { 画布名: hit.name || id.slice(0, 8) } : { 画布错: true };
  }
  /* 现在用的这个号、这张画布：{ p, 画布, 换下的, on, nick, credits, 画布名 或 画布错 }（号和画布一起查，不多等） */
  const now = async () => { const s = await setting(), [a, c] = await Promise.all([account(s.p), canvasOf(s.p, s.画布)]); return { ...s, ...a, ...c }; };

  /* 「批准出片」弹窗最上面那一块里摆的东西：这一条用哪个号、哪张画布出。
     a：now() 查回来的，还在查是 null；cost：这一条估价多少积分（估不出是 0），比这个号剩的多就标红；swap：点了「换个号」 */
  function card(a, cost, swap) {
    if (!a) return [h('span', null, '用哪个号、哪张画布出'), h('div', { class: 'fn-note' }, '在查用哪个即梦号、哪张画布…')];
    const row = (k, v, note, bad) => h('div', { style: 'display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px' },
      h('span', { class: 'fn-note', style: 'flex:none;width:3.4em' }, k), h('b', { style: 'font-weight:600' }, v), note ? h('span', { class: 'fn-note' + (bad ? ' warn' : '') }, note) : null);
    const few = a.on && a.credits != null && cost > a.credits, id = idOf(a.画布), no = id.slice(0, 8);
    const link = h('button', { class: 'fl-link', type: 'button', style: 'float:right;letter-spacing:0', title: '换到别的即梦号，挑那个号名下的画布（没有就新建一张）。换了以后这个项目都用新号出', onclick: swap }, '换个号');
    return [h('span', null, '用这个号、这张画布出', link),
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;padding:9px 12px;border:1px solid var(--line-2);border-radius:7px;background:var(--white)' },
        row('即梦号', who(a.p, a.nick), !a.on ? '没登录：到首页「即梦授权」登录，或者换个号' : (a.credits != null ? '还剩 ' + a.credits + ' 积分' : '') + (few ? '，估计不够出这一条' : ''), !a.on || few),
        !a.画布.trim() ? row('画　布', '还没有', '批准以后新建一张，名字写「' + F.name + '」')
          : !id ? row('画　布', '网址不对', '资产/出片设置.json 里记的不是即梦画布的网址，出片会被拦下', true)
          : a.画布名 ? row('画　布', '「' + a.画布名 + '」')
          : a.画布错 ? row('画　布', '编号 ' + no + ' 的那张', '不在这个号名下，出片会被拦下：换个号', true)
          : row('画　布', '编号 ' + no + ' 的那张', '名字没查到'))];
  }

  /* 弹窗。lack：{ 要, 有, 登录位, 账号 }（出片时发现不够的）；没有就是自己点「换个号」进来的。
     换好回 { 画布, 登录位, 账号, 画布名, 新建 }，没换回 null */
  function dlg(lack) {
    return dialog(close => {
      const list = h('div', { class: 'jm-swap' }, h('span', { class: 'fn-note' }, '在查有哪几个号…'));
      const cv = h('select', { class: 'inp', disabled: true }, h('option', { value: '' }, '先挑一个号')), cvHint = h('em'), err = h('div', { class: 'fld-err' });
      const okBtn = h('button', { class: 'btn zhu', type: 'button', disabled: true }, lack ? '换到这个号，接着出' : '换到这个号');
      let pick = null, set = { p: '', 画布: '', 换下的: [] }, busy = false, tok = 0;
      const ready = () => { okBtn.disabled = busy || !pick || cv.disabled; };
      /* 挑了一个号：列它名下的画布。这个项目以前在这个号上用过的那张排头一个，没有就看有没有和项目同名的，再没有就新建 */
      async function choose(a) {
        pick = a; err.textContent = ''; cv.disabled = true; ready();
        cv.replaceChildren(h('option', { value: '' }, '在查这个号名下的画布…')); cvHint.textContent = '';
        const t = ++tok, r = await ask('GET', 'canvases=1&profile=' + encodeURIComponent(a.p));
        if (t !== tok) return;   // 中间又挑了别的号
        if (!r.ok) { cv.replaceChildren(h('option', { value: '' }, '没查到')); err.textContent = r.error || '这个号名下的画布没查到'; return; }
        const items = r.items || [];
        const used = new Set(set.换下的.filter(x => x && (x.登录位 || '') === a.p).map(x => idOf(x.画布)));
        const def = items.find(x => used.has(x.id.toLowerCase())) || items.find(x => x.name === F.name) || null;
        cv.replaceChildren(h('option', { value: '' }, '新建一张，名字写「' + F.name + '」'),
          ...items.map(x => h('option', { value: x.id }, (x.name || x.id.slice(0, 8)) + (used.has(x.id.toLowerCase()) ? '（这个项目以前用过）' : x.name === F.name ? '（和项目同名）' : ''))));
        cv.value = def ? def.id : '';
        cvHint.textContent = items.length ? '这个号名下有 ' + items.length + ' 张画布。别的项目的画布别混着用' : '这个号还没有画布：新建一张';
        cv.disabled = false; ready();
      }
      async function swap() {
        if (busy || !pick) return;
        busy = true; err.textContent = ''; ready();
        const old = okBtn.textContent;
        okBtn.textContent = cv.value ? '在换…' : '在新建画布…';
        const r = await ask('POST', 'switch=1&p=' + encodeURIComponent(F.name) + '&profile=' + encodeURIComponent(pick.p) + (cv.value ? '&to=' + encodeURIComponent(cv.value) : ''));
        busy = false; okBtn.textContent = old; ready();
        if (!r.ok) { err.textContent = '没换成：' + (r.error || '本机服务没说原因'); return; }
        close(r);
      }
      okBtn.onclick = swap;
      (async () => {
        set = await setting();
        const all = await Promise.all(['', ...jmNames()].filter(p => p !== set.p).map(account));
        const rows = all.map(a => ({ a, why: !a.on ? '没登录' : lack && a.credits != null && a.credits < lack.要 ? '也不够，只剩 ' + a.credits + ' 积分' : '' }))
          .sort((x, y) => !!x.why - !!y.why || (y.a.credits || 0) - (x.a.credits || 0));   // 能换的在前，积分多的在前
        const first = rows.find(x => !x.why);
        list.replaceChildren(...[...rows.map(({ a, why }) => h('label', { class: 'jm-swap-row', style: 'display:flex;align-items:center;gap:8px;padding:5px 0;' + (why ? 'opacity:.6' : 'cursor:pointer') },
          h('input', { type: 'radio', name: 'jm-swap', disabled: !!why, checked: !!first && first.a === a, onchange: () => choose(a) }),
          h('span', null, who(a.p, a.nick)), h('span', { class: 'fn-note' + (why ? ' warn' : '') }, why || (a.credits != null ? '还剩 ' + a.credits + ' 积分' : '登录着')))),
        first ? null : h('p', { class: 'fn-note warn' }, (rows.length ? '这几个号都换不了。' : '这台电脑上还没有别的即梦号。') + '到首页的「即梦授权」加一个登录位、登录好' + (lack ? '（或者给现在这个号充积分）' : '') + '，再回来点「批准出片」。',
          h('button', { class: 'fl-link', type: 'button', onclick: () => { close(null); go('总览'); } }, '去首页'))].filter(Boolean));
        if (first) choose(first.a); else cv.replaceChildren(h('option', { value: '' }, '没有能换的号'));
      })();
      return dlgShell(lack ? '积分不够，换个号出？' : '换个即梦号出片',
        [lack ? h('p', null, who(lack.登录位, lack.账号) + '只剩 ' + lack.有 + ' 积分，这一条报价 ' + lack.要 + '。停在草稿，没花积分。') : null,
          h('p', null, '换了以后，这个项目都用新号的这张画布出；用到的素材出片时在新画布上重新传一遍，不花积分。原来那张画布不动。')],
        [h('div', { class: 'fld' }, h('span', null, '换到哪个号'), list), h('label', { class: 'fld' }, h('span', null, '用哪张画布'), cv, cvHint), err],
        [h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, lack ? '先不出' : '取消'), okBtn]);
    });
  }
  return { who, now, card, dlg };
})();
