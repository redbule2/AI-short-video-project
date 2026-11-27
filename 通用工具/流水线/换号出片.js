'use strict';
/* ============================================================
   换个即梦号出片（2026-11-26 他要的）
   原来的号没积分了：弹窗问要不要换到别的号——挑那个号名下的一张画布，那个号没有画布就新建一张（名字写项目名）。
   换好以后这个项目都用新号的这张画布出；用到的素材出片时在新画布上重新传一遍（不花积分），原来那张画布不动。
   什么时候弹：出片报完价、这个号的积分不够（任务上记着「缺积分」，jm-video.js 记的）；「批准出片」弹窗里点「换个号」也行。
   有哪几个号：默认的那一个，加上首页「即梦授权」里登记过的登录位（流水线.js 的 jmNames）。
   服务那头（jobs.js）：GET /api/jimeng?canvases 列那个号名下的画布，POST /api/jimeng?switch 换过去——只改 资产/出片设置.json 的「画布」「登录位」，
   换下来的那一对记在「换下的」里，要换回去照样在这里换。
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
  /* 现在用的这个号：{ p, 画布, 换下的, on, nick, credits } */
  const now = async () => { const s = await setting(); return { ...s, ...(await account(s.p)) }; };

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
        const items = r.items || [], idOf = u => (/[0-9a-f]{8}-[0-9a-f-]{27}/i.exec(String(u)) || [''])[0].toLowerCase();
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
  return { who, now, dlg };
})();
