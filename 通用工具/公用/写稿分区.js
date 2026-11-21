/* ============================================================
   写稿页 · 分镜的两种写法（2026-11-20 他定；设计稿 流水线/写稿页分区镜头_设计稿.html，挑的 甲、A、A、A）
   合并＝一镜一段；分区＝「镜头N：」下面一栏一行、几个小节（栏名照 公用/写稿状态.js 的 Zoned）。
   ① 分区的镜头一栏一个小框：小节能加、删、挪；整段分区的字贴进来自动分到各栏；存进提示词还是一栏一行。
   ② 一条提示词的分镜两种都留着，整条一起挑（拨「合并｜分区」）：提示词里放挑中的那种、拿去出片；另一种存在写稿资料「镜头信息」里
      （另一种、另一种据）。改了挑中那种，另一种标「旧了」，点「照X重写Y」AI 才重写（本机服务「另写一种」）。换一种时，原来那一版先进历史记录。
   ③ 拆镜头：人写的一大段（自由模式写的），点「交给 AI 写完」时 AI 拆成一镜一镜、扩写，两种一起写（公用/写稿写完.js，本机服务「写完提示词」）。
   11-21 他定分区为主、合并备选：新稿一律先用分区；拨成合并的记进「镜头写法」，这一条以后照合并。老稿没记，照镜头写成的样子认。
   本机服务那边在 .agents/skills/annotate-live/shot-styles.js。用的是写稿页的东西（DOC、SIDE、save、tellAI……），只在画、点、任务走完时用。
   写稿页过了 1500 行，新功能放这里，页面只挂几处（最后 window.Zone 那一行）
   ============================================================ */
(function () {
  'use strict';
  const Z = () => PromptDraft.Zoned;
  const STYLES = ['合并', '分区'], other = s => s === '合并' ? '分区' : '合并';
  const PH = {   // 空着的栏里的灰字：该写什么
    '机位/景别/角度': '从哪儿拍、多大景别、什么角度',
    '本镜调用': '这一镜用到的人物、道具、场景，写称谓',
    '画面构图': '开头这一刻谁在画面哪儿',
    '环境音': '这一镜一直在响的声音',
    '进入状态': '开头那一刻是什么样',
    '动作/表情': '谁做了什么，一两件事',
    '音效': '这一下响什么，写在 < > 里',
    '镜头': '镜头怎么动，不动写「机位不挪」',
    '台词': '谁说什么，原话写在 { } 里；没有写「无」',
    '退出状态': '结束那一刻是什么样',
    '切点': '在哪一下切走',
  };
  const S = { style: '', picked: false, compare: false, grace: 0, sig: '' };   // grace：任务刚做完那一会儿（存盘撞上了照样合）
  const CMP_KEY = 'xiegao:zone:compare';
  try { S.compare = localStorage.getItem(CMP_KEY) === '1'; } catch (e) { /* 记不住就不对照 */ }
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const segNo = () => SEGDIR.replace(/^第|段$/g, '');
  const isJob = j => !!j && j.事 === '另写一种' && j.段 === segNo() && j.名 === STEM + '.txt';
  const liveOf = kind => JOBS.live.find(j => isJob(j) && (!kind || j.事 === kind)) || null;
  const busy = () => !!liveOf();
  const watching = () => busy() || Date.now() < S.grace;   // 任务在做、刚做完那一会儿：存盘撞上了它写文件，合上接着存
  const zonedUi = () => isPe() && S.style === '分区';
  const fieldOf = l => { const f = Core.splitLabel(String(l).trim()); return f && [...Z().HEAD, ...Z().SUB, ...Z().TAIL].includes(f.label) ? { k: f.label, v: f.value.trim() } : null; };

  /* ---------- 用哪种写法 ---------- */
  const shotsStyle = shots => { const ls = (shots || []).filter(s => s && s.lines && s.lines.length); return !ls.length ? '' : ls.some(s => Z().isZoned(s.lines)) ? '分区' : '合并'; };
  /* 写稿页 render 头一句：写稿资料里记的；没记的照镜头写成的样子认（不记）；还没镜头的用分区（11-21 起分区为主，记下来） */
  function init() {
    if (!DOC || !isPe()) { S.style = ''; S.picked = false; return; }
    const rec = STYLES.includes(SIDE.镜头写法), seen = rec ? '' : shotsStyle(DOC.shots);
    S.style = rec ? SIDE.镜头写法 : seen || '分区';
    S.picked = rec || !seen;
  }
  /* ---------- 镜头卡：分区的一栏一个小框 ---------- */
  const blank = () => ({ head: {}, subs: [{ name: '', f: {} }], tail: {} });   // 新的一镜：开头几栏、一个小节、收尾两栏，都空着
  function fieldEl(k, v) {
    const wr = writer('shot', 1, PH[k] || '', v || ''), ta = $('.wr-ta', wr);
    ta.dataset.field = k; ta.setAttribute('aria-label', k);
    return h('div', { class: 'zf', 'data-k': k }, h('span', { class: 'zk' }, k), wr);
  }
  function subEl(s, i) {
    const box = h('div', { class: 'zsub', 'data-name': s.name || '' });
    box.append(h('div', { class: 'zsub-h' }, h('b', { class: 'zsub-n' }, s.name || Z().subName(i)), h('span', { class: 'zsub-ops' },
      h('button', { type: 'button', class: 'mini-b', tabindex: '-1', 'data-zmove': '-1', title: '上移', onclick: () => moveSub(box, -1) }, '↑'),
      h('button', { type: 'button', class: 'mini-b', tabindex: '-1', 'data-zmove': '1', title: '下移', onclick: () => moveSub(box, 1) }, '↓'),
      h('button', { type: 'button', class: 'mini-b', tabindex: '-1', onclick: () => delSub(box) }, '删除'))),
      ...Z().SUB.map(k => fieldEl(k, s.f[k])));
    return box;
  }
  function zoneEl(z) {
    const zone = h('div', { class: 'zone' });
    zone.append(h('div', { class: 'zhead' }, ...Z().HEAD.map(k => fieldEl(k, z.head[k]))),
      h('div', { class: 'zsubs' }, ...z.subs.map(subEl)),
      h('button', { type: 'button', class: 'zadd', tabindex: '-1', onclick: () => addSub(zone) }, '＋ 加一个小节'),
      h('div', { class: 'zend' }, ...Z().TAIL.map(k => fieldEl(k, z.tail[k]))));
    zone.addEventListener('paste', e => onPaste(e, zone));
    paintSubOps(zone);
    return zone;
  }
  /* 写稿页 shotEl 里「镜头正文」那两样：[标题行, 正文]。PE 稿正文外面套一层，对照着看时左边多一栏另一种；旧格式的稿照旧一个框 */
  function body(sh) {
    if (!isPe()) return [h('div', { class: 'shot-caption' }, '镜头正文', h('span', null, '自由写 · 输入 @ 引用素材')), writer('shot', 4, '写画面、动作、台词……', sh.lines.join('\n'))];
    const z = zonedUi() ? (sh.lines.length ? Z().of(sh.lines) : blank()) : null;
    const tip = z ? '一栏一栏填 · 整段分区的字贴进来自动分栏 · 输入 @ 引用素材' : zonedUi() ? '这一镜没照分区的栏写，照原样一个框 · 输入 @ 引用素材' : '一镜一段 · 输入 @ 引用素材';
    return [h('div', { class: 'shot-caption' }, '镜头正文', h('span', null, tip)),
      h('div', { class: 'zbody' }, h('div', { class: 'zalt' }), h('div', { class: 'zmine' }, z ? zoneEl(z) : writer('shot', 4, '写画面、动作、台词……', sh.lines.join('\n'))))];
  }
  const growAll = el => $$('.wr-ta', el).forEach(grow);
  const edited = () => { touch(); paintMarks(); };
  function paintSubOps(zone) {
    const list = $$('.zsub', zone);
    list.forEach((b, i) => { $('[data-zmove="-1"]', b).disabled = i === 0; $('[data-zmove="1"]', b).disabled = i === list.length - 1; });
  }
  function renumber(zone) { $$('.zsub', zone).forEach((b, i) => { b.dataset.name = ''; $('.zsub-n', b).textContent = Z().subName(i); }); paintSubOps(zone); }   // 挪过、删过、加过的小节照先后重新叫
  function addSub(zone) {
    const list = $('.zsubs', zone), b = subEl({ name: '', f: {} }, list.children.length);
    list.append(b); renumber(zone); growAll(b); $('.wr-ta', b).focus(); edited();
  }
  function moveSub(b, step) {
    const sib = step < 0 ? b.previousElementSibling : b.nextElementSibling;
    if (!sib) return;
    if (step < 0) sib.before(b); else sib.after(b);
    renumber(b.closest('.zone')); edited(); b.scrollIntoView({ block: 'nearest' });
  }
  function delSub(b) {
    if ($$('.wr-ta', b).some(t => t.value.trim()) && !confirm($('.zsub-n', b).textContent + ' 已经写了字，确定删除？')) return;
    const zone = b.closest('.zone');
    b.remove(); renumber(zone); edited();
  }
  /* 整段分区的字贴进来：认得出两栏以上就分到各栏（这一镜原来有字的先问一声）；一句话照常贴 */
  function onPaste(e, zone) {
    const text = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
    if (!/\n/.test(text)) return;
    const z = Z().of(text.split(/\r?\n/), true);
    if (!z) return;
    e.preventDefault();
    const card = zone.closest('.p-shot');
    if (linesOf(card).length && !confirm('把贴进来的分到各栏，换掉这一镜原来的字？')) return;
    const nz = zoneEl(z);
    zone.replaceWith(nz); growAll(nz); edited();
    const first = $$('.wr-ta', nz).find(t => t.value) || $('.wr-ta', nz);
    if (first) first.focus();
    toast('分到各栏了');
  }

  /* ---------- 写稿页读字用的几样 ---------- */
  const cleanV = v => String(v || '').split(/\n+/).map(s => s.trim()).filter(Boolean).join('\n');
  const boxVals = box => Object.fromEntries($$(':scope > .zf', box).map(r => [r.dataset.k, cleanV($('.wr-ta', r).value)]));
  const zoneOf = zone => ({ head: boxVals($('.zhead', zone)), subs: $$('.zsub', zone).map(b => ({ name: b.dataset.name || '', f: boxVals(b) })), tail: boxVals($('.zend', zone)) });
  const zoneIn = el => $('.zmine > .zone', el);
  /* 一镜的正文，一行一项（collect 用）：分区的照栏拼回一栏一行；一栏都没写就是空的一镜 */
  function linesOf(el) {
    const zone = zoneIn(el);
    if (zone) return $$('.wr-ta', zone).some(t => t.value.trim()) ? Z().lines(zoneOf(zone)) : [];
    const ta = $('.zmine .wr-ta', el) || $('.wr-ta', el);
    return ta ? ta.value.split(/\n+/).map(s => s.trim()).filter(Boolean) : [];
  }
  const textOf = el => $('.zmine', el) ? linesOf(el).join('\n') : ($('.wr-ta', el) || { value: '' }).value;   // 一镜（或生成目标那一区）的全部字
  function peekOf(el) {   // 收起来时、左边目录里露的那一句
    const zone = zoneIn(el);
    if (!zone) return textOf(el);
    const z = zoneOf(zone), act = z.subs.map(s => s.f['动作/表情']).find(Boolean);
    return [z.head['机位/景别/角度'], act].filter(Boolean).join('　') || linesOf(el).join(' ');
  }
  const boxFor = (el, n) => { const all = $$('.zmine .wr-ta', el), has = s => s && all.find(t => t.value.includes(s)); return has(n.find) || has(n.to) || all[0] || $('.wr-ta', el) || null; };   // 批注说的那一句在哪个框（照改过的认改成的字，撤回才找得着）
  const fileLines = (no, lines) => Z().shotLines(no, lines);   // 这一镜在文件里是哪几行
  /* AI 批注照抄了分区镜头的整行（「切点：……」）：栏名不在框里，去掉栏名再找 */
  function fixNote(n) {
    const f = n.find && fieldOf(n.find), t = n.to != null && fieldOf(n.to);
    if (!f || !f.v || (n.to != null && n.to !== '' && (!t || t.k !== f.k))) return n;
    const card = n.shotId && $$('.p-shot').find(x => x.dataset.id === n.shotId);
    const box = card && $$('.zmine .wr-ta', card).find(x => x.dataset.field === f.k && x.value.includes(f.v));
    return box ? { ...n, find: f.v, ...(n.to != null ? { to: t ? t.v : '' } : {}) } : n;
  }

  /* ---------- 镜头信息、存盘 ---------- */
  const fromMeta = m => m && Array.isArray(m.另一种) && m.另一种.length ? { alt: m.另一种.map(String), altKey: String(m.另一种据 || '') } : { alt: null, altKey: '' };
  const meta = s => s && Array.isArray(s.alt) && s.alt.length ? { 另一种: s.alt, 另一种据: s.altKey || '' } : {};
  const snapshot = () => isPe() && S.picked && STYLES.includes(S.style) ? { 镜头写法: S.style } : {};

  /* ---------- 两种写法：哪几镜另一种还没有、旧了 ---------- */
  function cards() {
    return $$('.p-shot').map(el => { const s = (DOC && DOC.shots.find(x => x.id === el.dataset.id)) || {}, lines = linesOf(el); return { el, no: el.dataset.no, lines, alt: s.alt || null, stale: !!s.alt && s.altKey !== Z().key(lines) }; });
  }
  function needs() {
    const list = cards().filter(c => c.lines.length);
    return { list, had: list.filter(c => c.alt), stale: list.filter(c => c.stale), lack: list.filter(c => !c.alt) };
  }
  const nos = cs => cs.map(c => c.no).join('、');
  /* 拨「合并｜分区」：整条一起换。另一种都有、都是照现在这版写的才换；缺的、旧了的先让 AI 写 */
  async function switchTo(to) {
    if (!READY || !isPe() || to === S.style || !STYLES.includes(to)) return;
    if (busy()) return toast('AI 正在写这一条的分镜：写完再换');
    if (CONFLICT) return toast('这份稿有修改冲突：先在上面处理好，再换');
    if (MODE !== '分镜') return toast('先回到分镜模式再换写法');
    const n = needs();
    if (n.stale.length || n.lack.length) {
      const why = [n.lack.length ? '镜头' + nos(n.lack) + ' 还没有' + to + '的' : '', n.stale.length ? '镜头' + nos(n.stale) + ' 的' + to + '旧了' : ''].filter(Boolean).join('，');
      if (confirm(why + '。先让 AI 照' + S.style + '写好' + to + '的，写好再换？')) rewrite();
      return;
    }
    DOC = collect();
    for (const s of DOC.shots) if (s.lines.length && s.alt) { const was = s.lines; s.lines = s.alt; s.alt = was; s.altKey = Z().key(s.lines); }
    S.style = to; S.picked = true; SIDE.镜头写法 = to; ARCHIVED = false;   // 换之前的那一版照例先留一份进历史记录（存盘时归档）
    refreshShotList(); paint();
    clearTimeout(ST);
    if (await save()) toast('换成' + to + '了：拿去出片的是' + to + '这种，原来那一版进了历史记录');
  }
  /* 照挑中的那种，把另一种还没有、旧了的几镜交给 AI 写 */
  async function rewrite() {
    if (!READY || busy()) return;
    if (CONFLICT) return toast('这份稿有修改冲突：先在上面处理好，再写');
    if (!needs().list.length) return toast('还没写镜头：先写一镜再让 AI 写另一种');
    try {
      clearTimeout(ST); if (!await save()) return toast('稿子还没存上，先存好再写');
      const r = await tellAI('另写一种 ' + OPENPATH);
      toast(r.say || 'AI 在写' + other(S.style) + '的：进度在左下角，写好自动换上');
    } catch (e) { toast('没交上：' + e.message); }
    paint();
  }
  const jobBody = (line, base) => /^另写一种 /.test(line) ? { ...base, 事: '另写一种' } : null;
  /* 任务走完（没成、停掉也一样）：外面改了的换上（merge 只换它写的那几样，你在写的地方不重画）；存盘撞上了它写文件的，合上接着存 */
  async function done(j) {
    S.grace = Date.now() + 20e3;
    try {
      for (let i = 0; i < 80 && (POLLING || PULLING || SAVING); i++) await sleep(100);
      if (CONFLICT) { if (await heal()) await save(); }
      else await poll();
    } finally {
      paint();
      toast(j.状态 === '做完' ? j.结果 : j.标题 + (j.状态 === '停了' ? ' 停掉了' : ' 没成：' + j.错误));
    }
  }
  /* 外面只改了另一种（另写一种）：就地换上，不整页重画。换好了（或者本来就一样）给 true。
     写稿页 pullExternal0 里调（带着读好的 r、ss）；存盘前、撞上冲突时不带，自己读 */
  async function merge(r, ss) {
    if (!DOC || !READY) return false;
    if (!r) [r, ss] = await Promise.all([FS.text(PROMPT), readSideState()]);
    return r.text === LASTTEXT && (JSON.stringify(editorPart(ss.side)) === JSON.stringify(BASE_EDITOR) || altsOnly(ss));
  }
  function takeSide(ss) {   // 写稿资料换成文件里的；你刚挂、还没存的图留着（和 poll 一样）
    const pending = SIDE.挂图;
    SIDE = ss.side; SIDE_MT = ss.mtime; BASE_EDITOR = structuredClone(editorPart(ss.side));
    if (dirty()) SIDE.挂图 = { ...(SIDE.挂图 || {}), ...(pending || {}) };
  }
  function altsOnly(ss) {
    const strip = e => JSON.stringify({ ...e, 镜头信息: (Array.isArray(e.镜头信息) ? e.镜头信息 : []).map(m => { const { 另一种, 另一种据, ...rest } = m || {}; return rest; }) });
    const now = editorPart(ss.side);
    if (strip(now) !== strip(BASE_EDITOR)) return false;
    for (const m of Array.isArray(now.镜头信息) ? now.镜头信息 : []) { const s = m && DOC.shots.find(x => x.id === m.id); if (s) Object.assign(s, fromMeta(m)); }
    takeSide(ss);
    S.sig = ''; paint();
    if (dirty()) touch();
    return true;
  }
  async function heal() {   // 冲突条是另写一种写文件撞出来的：能合就合上、收起冲突条
    try { if (!await merge()) return false; } catch (e) { return false; }
    CONFLICT = false; const box = $('#saveConflict'); if (box) box.remove(); setStatus('正在保存…');
    return true;
  }
  async function sync() {   // 写稿页 save 开头调（任务在做、刚做完时）：文件变了先合上再存，免得拿旧底去存、闪一下冲突条
    try {
      const st = await FS.stat(PROMPT);
      let sm = 0;
      try { sm = (await FS.stat(SIDEF)).mtime; } catch (e) { sm = 0; }
      if (st.mtime !== MTIME || sm !== SIDE_MT) await merge();
    } catch (e) { /* 看不了就照常存，撞上了 heal 再合 */ }
  }

  /* ---------- 分镜那一区顶上一条：合并｜分区、对照着看、照X写Y；另一种旧了的黄条、还没拆的一段 ---------- */
  function bar() {
    if (!isPe()) return null;
    S.sig = '';
    const el = h('div', { class: 'zbar', id: 'zbar' });
    setTimeout(paint, 0);   // 镜头卡画好了再画（要读镜头里的字）
    return el;
  }
  const chip = (label, fn, cls, title) => h('button', { type: 'button', class: 'zchip ' + (cls || ''), tabindex: '-1', title: title || '', onclick: fn }, label);
  const loose = () => (DOC.shotsPre || []).map(l => String(l).trim()).filter(Boolean).join('');   // 事件脚本里不在哪一镜里的字（人写的一大段）
  function paintBar(el) {
    const writing = !!liveOf('另写一种'), off = !READY || busy();
    if (MODE !== '分镜') {
      el.replaceChildren(h('div', { class: 'zbar-row' }, h('span', { class: 'zhint' }, '写好这一段，点上面「交给 AI 写完」：AI 拆成一镜一镜（分区写法，合并的另存一份），生成目标、素材这些一起写好')));
      return;
    }
    const n = needs(), to = other(S.style);
    const seg = h('span', { class: 'zseg', role: 'tablist', 'aria-label': '分镜写法' }, ...STYLES.map(s => h('button', { type: 'button', tabindex: '-1', role: 'tab', class: s === S.style ? 'on' : '', 'aria-selected': String(s === S.style),
      title: s === S.style ? '提示词里放的是这种，拿去出片' : '整条换成' + s + '写法（另一种都写好了才换；原来那一版先进历史记录）', disabled: off || null, onclick: () => switchTo(s) }, s)));
    const kids = [seg, h('span', { class: 'zhint' }, '拿去出片的是 ', h('b', null, S.style), ' 这种')];
    if (n.had.length) kids.push(chip('对照着看', () => { S.compare = !S.compare; try { localStorage.setItem(CMP_KEY, S.compare ? '1' : '0'); } catch (e) { /* 记不住就算了 */ } S.sig = ''; paint(); }, S.compare ? 'on' : '', '两种并排摆：左边是另一种（只看），右边是拿去出片的'));
    if (writing) kids.push(h('span', { class: 'zhint' }, h('i', { class: 'wt-ring' }), 'AI 在写' + to + '的'));
    else if (n.lack.length && !n.stale.length) { const b = chip('照' + S.style + '写一份' + to, rewrite, '', '让 AI 照现在的' + S.style + '写一份' + to + '的（镜头' + nos(n.lack) + '），写好存在写稿资料里，拨过去就能用'); b.disabled = off; kids.push(b); }
    const rows = [h('div', { class: 'zbar-row' }, ...kids)];
    if (n.stale.length) {
      const b = chip('照' + S.style + '重写' + to, rewrite);
      b.disabled = off;
      rows.push(h('div', { class: 'zstale' }, to + '那种旧了：你改过' + S.style + '的镜头' + nos(n.stale) + (n.lack.length ? '；镜头' + nos(n.lack) + ' 还没有' + to + '的' : '') + '。', b));
    }
    const lo = loose();
    if (lo) rows.push(h('div', { class: 'zloose' }, '事件脚本里还有一段没分镜的字：', h('q', null, lo.length > 40 ? lo.slice(0, 40) + '…' : lo), '（拿去出片照原样带着）。点上面「交给 AI 写完」拆成一镜一镜。'));
    el.replaceChildren(...rows);
  }
  function altView(c, to) {   // 对照着看：左边那一栏（只看）
    const head = h('div', { class: 'zalt-h' }, to, h('em', null, to === '合并' ? '一镜一段' : '一栏一栏', c.alt ? (c.stale ? ' · 旧了' : '') : ' · 还没有'));
    if (!c.alt) return [head, h('div', { class: 'zalt-b faint' }, '还没写' + to + '的：点上面「照' + S.style + '写一份' + to + '」')];
    return [head, h('div', { class: 'zalt-b' }, ...c.alt.map(l => { const f = fieldOf(l); return Core.RE_SUB.test(l.trim()) ? h('p', { class: 'sl' }, l) : f ? h('p', null, h('span', { class: 'k' }, f.k), '　' + f.v) : h('p', null, l); }))];
  }
  /* 跟着打字、任务进度走（写稿页 paintShotMeta、paintJobs 里调）：变了才重画 */
  function paint() {
    const el = $('#zbar');
    if (!el || !DOC) return;
    const cs = MODE === '分镜' ? cards() : [], to = other(S.style);
    const sig = JSON.stringify([MODE, S.style, S.compare, READY, loose(), JOBS.live.filter(isJob).map(j => j.事 + j.状态), cs.map(c => [c.no, !!c.alt, c.stale, !!c.lines.length])]);
    if (sig !== S.sig) { S.sig = sig; paintBar(el); }
    for (const c of cs) {
      c.el.classList.toggle('cmp', S.compare);
      const box = $('.zalt', c.el);
      if (!box) continue;
      const k = S.compare ? JSON.stringify([to, c.alt, c.stale]) : '';
      if (box.dataset.sig === k) continue;
      box.dataset.sig = k;
      box.classList.toggle('old', c.stale);
      box.replaceChildren(...(S.compare ? altView(c, to) : []));
    }
  }

  window.Zone = Object.freeze({ init, body, linesOf, textOf, peekOf, boxFor, fileLines, fixNote, fromMeta, meta, snapshot, bar, paint, merge, heal, sync, watching, isJob, done, jobBody, switchTo, rewrite, style: () => S.style });
})();
