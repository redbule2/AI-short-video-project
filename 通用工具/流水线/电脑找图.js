/* ============================================================
   流水线 · 从电脑里找图（2026-11-14 他要的：「如果我电脑其他地方有一张图，要可以支持查找，选中后复制到我们项目中的位置，改好名称」）
   资产页挑图弹窗（＋ 新增人物、场景、道具、关键帧，用已有的图，给某一行挑图）左下角「＋ 从电脑里找」打开。一个弹窗两步，一次只看一件事：
     ① 找：顶上搜索框（整台电脑按图名找，几个词用空格隔开），下面一排常去的地方（最近的图、桌面、下载、图片、文档、各个盘），文件夹点进点出。点一张图到 ②。
     ② 起名：左边大图；右边当什么用（从哪一块点开的就定了）、放哪（全片的：资产/全局资产/类别；只给这一场：资产/第N段）、名字，下面写着复制到哪。
        那一层已经有同名的图（后缀不同也算）、名字带类别、第几段、版本号的不让复制；已经在这个项目 资产 里的图不再复制一份。
        点「复制进项目」：原图不动，复制一份过去；回到挑图弹窗，这一场照点图那样用上它（资产.html 的 addDlg）。
   找、看图、复制都经本机服务（.agents/skills/annotate-live/pc-files.js，/api/pc）。服务是旧的就说要重开。
   上回在哪个文件夹、找的什么记着，再打开从那里接着。
   ============================================================ */
'use strict';
const PCF = { view: 'recent', dir: '', q: '' };   // 上回在哪：再打开从那里接着
const PC_PAGE = 120;   // 一次摆多少张，多的点「再摆」
async function pcReq(method, q, body) {
  const r = await fetch('/api/pc?' + q, { method, body, cache: 'no-store', headers: { 'X-Antou': '1' } });
  if (!r.ok) throw Object.assign(new Error((await r.text()) || '本机服务出错 ' + r.status), { status: r.status });
  return r.json();
}
const pcExt = n => (n.split('.').pop() || '').toLowerCase();
const pcSize = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const pcTime = ms => { const d = new Date(ms), same = d.getFullYear() === new Date().getFullYear(); return (same ? '' : d.getFullYear() + '-') + two(d.getMonth() + 1) + '-' + two(d.getDate()) + (same ? ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) : ''); };

/* 缩小图：看得见的才去读，一次四张。w 是 0 就是原图（第二步的大图） */
const PC_IMG = new Map(), PC_Q = [];
let pcBusy = 0;
function pcPump() {
  while (pcBusy < 4 && PC_Q.length) {
    const job = PC_Q.shift(); pcBusy++;
    (async () => {
      const r = await fetch('/api/pc?img=' + encodeURIComponent(job.p), { cache: 'no-store', headers: { 'X-Antou': '1' } });
      if (!r.ok) throw new Error(await r.text());
      return (await window.UI.shrink(await r.blob(), job.w)).url;
    })().then(job.res, job.rej).finally(() => { pcBusy--; pcPump(); });
  }
}
function pcImgUrl(p, w) {
  const k = p + '@' + w;
  if (!PC_IMG.has(k)) { const pr = new Promise((res, rej) => { PC_Q.push({ p, w, k, res, rej }); pcPump(); }); pr.catch(() => PC_IMG.delete(k)); PC_IMG.set(k, pr); }
  return PC_IMG.get(k);
}
const PC_SKIP = '不读了';
function pcForget() { for (const job of PC_Q.splice(0)) { PC_IMG.delete(job.k); job.rej(new Error(PC_SKIP)); } }   // 换了地方、去起名：还没轮到的先不读
function pcClear() { pcForget(); for (const pr of PC_IMG.values()) pr.then(u => URL.revokeObjectURL(u), () => {}); PC_IMG.clear(); }   // 关弹窗：做好的也扔掉

/* 打开找图弹窗。s：这一场；k：从哪一块点开的（人物、场景、道具、关键帧，空着是「用已有的图」）；row：给表里哪一行挑图（人物、道具那一格）。
   复制好了返回 { file: 项目里的路径, kind: 当什么用, seg: 是不是只给这一场 }，没复制返回 null */
async function pcFind({ s, k, row }) {
  closePop(); hideHov();
  let pl;
  try { pl = await pcReq('GET', 'places'); }
  catch (e) { toast(e.status === 404 ? '本机服务还是旧的，重开一次才能从电脑里找图' : '本机服务连不上：' + e.message, 'err'); return null; }
  const fixKind = row ? kindOf(row.类别) : k || '';
  const mineRoot = (LINK.abs + '\\项目\\' + F.name + '\\').toLowerCase();
  const inMine = p => !!LINK.abs && p.toLowerCase().startsWith(mineRoot + '资产\\');   // 已经在这个项目的 资产 里
  const baseOfDir = d => { const low = d.toLowerCase(); return pl.places.find(x => { const b = x.path.toLowerCase().replace(/\\$/, ''); return low === b || low.startsWith(b + '\\'); }) || null; };
  const placeOf = d => { const b = baseOfDir(d); return b ? b.name + d.slice(b.path.replace(/\\$/, '').length) : d; };   // C:\Users\li\Downloads\参考 → 下载\参考
  const shortDir = d => { const q = placeOf(d).split('\\').filter(Boolean); return q.length > 3 ? q[0] + '\\…\\' + q[q.length - 1] : placeOf(d); };
  let io = null;
  const r = await dialog(close => {
    let tok = 0, gen = 0, cur = null, keepTop = 0;
    const body = h('div', { class: 'pc-body' }), acts = h('span', { class: 'pc-acts' });
    const qIn = h('input', { class: 'inp', type: 'search', placeholder: '图名里的字，回车在整台电脑里找（几个词用空格隔开）；也能粘贴文件夹、图的完整路径', spellcheck: 'false', 'data-focus': '', value: PCF.view === 'search' ? PCF.q : '' });
    const find = async () => {
      const q = qIn.value.trim().replace(/^"(.*)"$/, '$1').trim();   // 资源管理器「复制文件地址」带着引号
      if (!q) { qIn.focus(); return; }
      if (!/^[A-Za-z]:[\\/]/.test(q)) { load('search', q); return; }
      const p = q.replace(/\//g, '\\'), isImg = /\.(png|jpe?g|webp|gif|avif|jfif)$/i.test(p), dir = isImg ? p.slice(0, p.lastIndexOf('\\')) || p : p;   // 完整路径：文件夹就打开；图就打开它那一层，直接到起名
      await load('dir', /^[A-Za-z]:$/.test(dir) ? dir + '\\' : dir);
      const it = isImg && cur && cur.view === 'dir' && (cur.items || []).find(x => x.path.toLowerCase() === p.toLowerCase());
      if (it) paintName(it);
    };
    qIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); find(); } });
    const findRow = h('div', { class: 'pc-find' }, qIn, h('button', { class: 'btn', type: 'button', onclick: find }, icon('zoom'), '找'));
    const placesEl = h('div', { class: 'pc-places' }), where = h('div', { class: 'pc-where' }), box = h('div', { class: 'pc-box' });
    const step1 = [findRow, placesEl, where, box];
    io = new IntersectionObserver(ents => { for (const e of ents) if (e.isIntersecting) { io.unobserve(e.target); e.target._pc(); } }, { root: box, rootMargin: '300px' });
    const lazy = p => {
      const img = h('img', { alt: '', draggable: 'false' }), my = gen;
      img._pc = () => pcImgUrl(p, 220).then(u => { img.src = u; }, e => { if (e.message !== PC_SKIP) img.alt = '读不出来'; else if (my === gen) io.observe(img); });   // 去起名时没轮到的：回来再读
      io.observe(img);
      return img;
    };
    const PL = [['recent', '最近的图', '桌面、下载、图片、文档里最近改过的图'], ...pl.places.map(x => [x.path, x.name, x.path]), ...pl.drives.map(x => [x.path, x.name, x.path])];
    const crumbs = d => {   // 在常去的地方里面的，从那个地方算起（下载 › 参考图）；不然从盘算起
      const base = baseOfDir(d), out = base ? [[base.path, base.name]] : [];
      let acc = base ? base.path.replace(/\\$/, '') : '';
      (base ? d.slice(acc.length) : d).split('\\').filter(Boolean).forEach((p, i) => { acc = !base && i === 0 ? p + '\\' : acc.replace(/\\$/, '') + '\\' + p; out.push([acc, !base && i === 0 ? p + '\\' : p]); });
      return out;
    };
    const paintFind = () => {
      const c = cur, items = c.items || [], dirs = c.view === 'dir' ? c.dirs || [] : [];
      placesEl.replaceChildren(...PL.map(([key, label, title]) => h('button', { class: 'chip' + ((key === 'recent' ? c.view === 'recent' : c.view === 'dir' && c.dir.toLowerCase() === key.toLowerCase()) ? ' on' : ''), type: 'button', title, onclick: () => key === 'recent' ? load('recent') : load('dir', key) }, label)));
      if (c.busy) where.replaceChildren(c.view === 'search' ? '正在找「' + c.q + '」…（要把各个盘过一遍，几秒钟）' : c.view === 'dir' ? '正在打开 ' + c.dir + ' …' : '正在读最近的图…');
      else if (c.err) where.replaceChildren(h('span', { class: 'warn' }, (c.view === 'search' ? '没找成：' : '打不开：') + c.err));
      else if (c.view === 'dir') {
        const cs = crumbs(c.dir);
        where.replaceChildren(...(c.parent ? [h('button', { class: 'btn sm ghost', type: 'button', title: '上一层：' + c.parent, onclick: () => load('dir', c.parent) }, icon('up'), '上一层')] : []),
          ...cs.flatMap(([p, label], i) => [i ? h('span', { class: 'pc-sep' }, '›') : null, i === cs.length - 1 ? h('b', { title: p }, label) : h('button', { class: 'fl-link', type: 'button', title: p, onclick: () => load('dir', p) }, label)]).filter(Boolean),
          h('span', { class: 'pc-cnt' }, items.length ? items.length + ' 张图' + (items.length > 1 ? '，新的在前' : '') : ''));
      } else if (c.view === 'search') where.replaceChildren('找「' + c.q + '」：' + (c.total ? '找到 ' + c.total + ' 张' + (c.total > items.length ? '，摆前 ' + items.length + ' 张（名字里就有的在前）' : '') : '没找到') + (c.cut ? '。电脑太大，没找全' : ''));
      else where.replaceChildren('最近改过的图（' + pl.places.map(x => x.name).join('、') + '里的），新的在前' + (c.total > items.length ? '，摆最新的 ' + items.length + ' 张' : ''));
      io.disconnect(); gen++;
      const tile = x => { const mine = inMine(x.path);
        return h('button', { type: 'button', class: 'fl-at pc-at' + (mine ? ' mine' : ''), title: x.path + '\n' + pcSize(x.size) + ' · ' + pcTime(x.mtime) + (mine ? '\n已经在这个项目的资产里' : '') + '\n点一下：起名字，复制进项目', onclick: () => paintName(x) },
          lazy(x.path), h('span', null, x.name), h('small', null, mine ? '已在项目里' : c.view === 'dir' ? pcTime(x.mtime) : shortDir(x.dir) + ' · ' + pcTime(x.mtime))); };
      const shown = items.slice(0, c.shown), more = items.length - shown.length;
      const empty = c.busy || c.err ? '' : c.view === 'dir' ? (dirs.length || items.length ? '' : '这个文件夹里没有图，也没有别的文件夹。') : items.length ? '' : c.view === 'search' ? '没找到名字里带「' + c.q + '」的图。少写几个字再找，或者翻文件夹。' : '这几处最近没有图。';
      box.replaceChildren(...[
        dirs.length ? h('div', { class: 'pc-dirs' }, dirs.map(n => { const p = c.dir.replace(/\\$/, '') + '\\' + n; return h('button', { class: 'pc-dir', type: 'button', title: p, onclick: () => load('dir', p) }, icon('folder'), h('span', null, n)); })) : null,
        shown.length ? h('div', { class: 'fl-ag' }, shown.map(tile)) : null,
        more > 0 ? h('button', { class: 'btn sm pc-more', type: 'button', onclick: () => { c.shown += PC_PAGE; paintFind(); } }, '再摆 ' + Math.min(more, PC_PAGE) + ' 张（还有 ' + more + ' 张）') : null,
        empty ? h('p', { class: 'fn-note' }, empty) : null].filter(Boolean));
    };
    const load = async (view, arg) => {
      const my = ++tok;
      pcForget();
      Object.assign(PCF, view === 'dir' ? { view, dir: arg } : view === 'search' ? { view, q: arg } : { view });
      cur = { view, dir: view === 'dir' ? arg : '', q: view === 'search' ? arg : '', busy: true, items: [], dirs: [], shown: PC_PAGE };
      paintFind(); box.scrollTop = 0;
      try {
        const j = await pcReq('GET', view === 'dir' ? 'list=' + encodeURIComponent(arg) : view === 'search' ? 'q=' + encodeURIComponent(arg) : 'recent');
        if (my !== tok) return;
        Object.assign(cur, j, { busy: false });
      } catch (e) { if (my !== tok) return; Object.assign(cur, { busy: false, err: e.message }); }
      paintFind();
    };
    const SUB1 = '整台电脑按名字找，或者翻文件夹。点一张图，下一步起名字。原图不动，复制一份进项目。';
    const cancel = h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, '取消');
    const toFind = () => { el.querySelector('.dlg-sub').textContent = SUB1; body.replaceChildren(...step1); box.scrollTop = keepTop; acts.replaceChildren(cancel); };

    /* ② 起名：当什么用、放哪、名字；那一层有同名的、名字不合规矩的不让复制 */
    const paintName = x => {
      keepTop = box.scrollTop;
      pcForget();
      let kind = fixKind, seg = fixKind === '关键帧';
      const ext = pcExt(x.name) === 'jfif' ? 'jpg' : pcExt(x.name);
      const big = h('img', { class: 'cv-big', alt: '' }), dims = h('span');
      big.addEventListener('load', () => { dims.textContent = big.naturalWidth + '×' + big.naturalHeight + ' · '; });
      pcImgUrl(x.path, 0).then(u => { big.src = u; }, () => { big.alt = '读不出来'; });
      const def = row ? (row.文件 ? baseOf(row.文件) : row.名称 + (row.sub ? '_' + row.sub : '')) : stemOf(x.name).trim();   // 给哪一行挑的：照那一行的名字（图不在了的照原来的图名）
      const nameIn = h('input', { class: 'inp', value: def, spellcheck: 'false', maxlength: '60' });
      const err = h('div', { class: 'fld-err' }), dest = h('div', { class: 'pc-dest' }), hint = h('span');
      const okBtn = h('button', { class: 'btn ink', type: 'button' }, '复制进项目');
      const destParts = () => seg ? ['资产', segName(s.段), nameIn.value.trim() + '.' + ext] : ['资产', '全局资产', kind, nameIn.value.trim() + '.' + ext];
      const ls = new Map(), listDir = parts => { const key = parts.join('/'); if (!ls.has(key)) ls.set(key, FS.list(at([F.name, ...parts])).catch(() => [])); return ls.get(key); };
      const why = async () => {
        if (inMine(x.path)) return '这张已经在这个项目的资产里了（' + x.path.slice(mineRoot.length).replace(/\\/g, ' / ') + '）。同一张图只放一处，不再复制一份';
        if (!kind) return '先选当什么用';
        const n = nameIn.value.trim();
        if (!n) return '写个名字';
        if (!nameOk(n)) return '名字里不能有 \\ / : * ? " < > |，结尾不能是点或空格';
        if (/_(候选|白模帧|批注)$/.test(n)) return '名字别以「_候选」「_白模帧」「_批注」结尾，这几个页面另有用处';
        if ((F.name && n.startsWith(F.name + '_')) || /第[0-9]+(-[0-9]+)*[段场]/.test(n) || /^(人物|场景|道具|特效|关键帧)[_ ]/.test(n)) return '名字只写内容：项目、类别、第几段看它放在哪个文件夹，不用写进名字';
        if (/(^|[_ -])[vV][0-9]+$|_改[0-9]+$|__[0-9]{8}-[0-9]{6}$/.test(n)) return '名字别带版本号';
        const parts = destParts(), low = n.toLowerCase();
        const same = (await listDir(parts.slice(0, -1))).find(e => e.kind === 'file' && IMG_RE.test(e.name) && stemOf(e.name).toLowerCase() === low);
        if (same) return '那里已经有「' + same.name + '」了，换个名字。要换掉那一张：先在资产页删了它（图不要了，会进历史记录），再来复制';
        return '';
      };
      let ck = 0;
      const check = async () => { const my = ++ck, msg = kind && nameIn.value.trim() ? await why() : inMine(x.path) ? await why() : ''; if (my !== ck) return; err.textContent = msg; okBtn.disabled = !!msg; };   // 还没选当什么用、名字空着：先不说，点「复制」时再说
      const segEl = row ? null : window.UI.chips([['all', '全片的'], ['seg', '只给这一场']], seg ? 'seg' : 'all', v => { seg = v === 'seg'; sync(); });
      const grp = (label, chipsEl) => h('div', { class: 'fld' }, h('span', null, label), chipsEl);   // 不用 field：label 包着按钮，点字会点到第一个按钮
      const segFld = segEl ? grp('放哪', segEl) : null;
      const kindFld = fixKind ? null : grp('当什么用', window.UI.chips([...KINDS, '关键帧'].map(c => [c, '当' + c]), '', v => { if (v === '关键帧') seg = true; else if (kind === '关键帧') seg = false; kind = v; sync(); }));   // 关键帧只放这一段的文件夹
      const sync = () => {
        if (segFld) { segFld.hidden = kind === '关键帧'; [...segEl.children].forEach(b => b.classList.toggle('on', b.dataset.v === (seg ? 'seg' : 'all'))); }
        const parts = destParts();
        if (kind) dest.replaceChildren('复制到：', ...parts.slice(0, -1).flatMap(p => [p, ' / ']), h('b', null, (nameIn.value.trim() || '名字') + '.' + ext));
        else dest.replaceChildren('选了当什么用，这里写复制到哪。');
        hint.textContent = !kind ? '' : row ? '挂到「' + row.名称 + '」这一行。名字只写内容，不带项目名、类别、第几段、版本号。'
          : kind === '关键帧' ? '名字带「首帧」「尾帧」「关键帧」的，提示词那一步认得出，比如「镜头3_首帧」。'
            : !seg && KIND[kind] ? '下划线前面是戏里的叫法：「童爸爸_三十出头」挂到' + kind + '表「童爸爸」那一行，表里没有就加一行。不带项目名、类别、第几段、版本号。'
              : '只写内容，比如「菜市场路口」；不带项目名、类别、第几段、版本号。';
        check();
      };
      const go = async () => {
        const msg = await why();
        if (msg) { err.textContent = msg; return; }
        const parts = destParts();
        okBtn.disabled = true; okBtn.textContent = '正在复制…';
        try { await pcReq('POST', 'copy', JSON.stringify({ from: x.path, to: ['项目', F.name, ...parts].join('/') })); close({ file: parts.join('/'), kind, seg }); }
        catch (e) { err.textContent = '没复制成：' + e.message; okBtn.disabled = false; okBtn.textContent = '复制进项目'; }
      };
      okBtn.addEventListener('click', go);
      nameIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); go(); } });
      nameIn.addEventListener('input', debounce(sync, 200));
      el.querySelector('.dlg-sub').textContent = '起好名字，复制进项目。原图还在原处，不动它。';
      body.replaceChildren(h('div', { class: 'pc-name' },
        h('div', { class: 'pc-big' }, big),
        h('div', { class: 'pc-form' },
          h('div', { class: 'pc-src', title: x.path }, h('b', null, x.name), h('br'), x.dir, h('br'), dims, pcSize(x.size) + ' · ' + pcTime(x.mtime)),
          fixKind ? h('div', { class: 'pc-kind ' + kindCls(fixKind) }, row ? '给' + fixKind + '「' + row.名称 + '」挑的图' : '当' + fixKind + '用') : kindFld,
          segFld,
          field('名字', h('div', { class: 'pc-name-row' }, nameIn, h('span', { class: 'pc-ext' }, '.' + ext)), hint),
          dest, err)));
      acts.replaceChildren(h('button', { class: 'btn ghost', type: 'button', onclick: toFind }, '← 换一张'), okBtn);
      sync();
      setTimeout(() => { nameIn.focus(); nameIn.select(); }, 40);
    };
    const el = dlgShell('从电脑里找图 · 第' + s.段 + '场' + (row ? ' · 给「' + row.名称 + '」' : fixKind ? ' · 当' + fixKind : ''), SUB1, [body], [acts]);
    el.classList.add('wide', 'pc-dlg');
    body.replaceChildren(...step1);
    acts.replaceChildren(cancel);
    load(PCF.view === 'dir' && PCF.dir ? 'dir' : PCF.view === 'search' && PCF.q ? 'search' : 'recent', PCF.view === 'dir' ? PCF.dir : PCF.q);
    return el;
  });
  if (io) io.disconnect();
  pcClear();
  return r || null;
}
