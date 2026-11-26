/* ============================================================
   审片台 · 只审这一条提示词（window.DeskOne，2026-11-22 他定：审片改成「提示词」那一步每条上的弹窗，进去以后换不到别的提示词）
   审片台.html 的网址带 k＝这一条的原稿名（弹窗给的，流水线/审片弹窗.js；没给照样片名字认）。
   只摆这一条几版出的样片：成片里的、历史记录里的（认法在 公用/样片归属.js 的 ofPrompt，和提示词那一步「审片」数的一样）。
   顶上：关闭、换这一条的哪条样片、出自哪一版（不能换）、复制批注、这条不要了；旁边对照「另一条样片」也只摆这一条的。
   用到审片台.html 后面那段脚本里的 PJ、SEG、SEGD、VID、OLD、D、promptFams、flowScene、listRel、leave、host、goBack、clipLabel（用到时才找）。
   「这条不要了」交给弹窗那一页挪（它管流水线.json）：window.DESK_HOST.retire(样片名) 给 '' 是挪好了，不然是为什么没挪
   11-25 起网址带 hp（历史记录里的一版，流水线历史记录那一页点「审片」）：只摆那一版出的样片，字和挂的图照那一版（oldPrompt），不能「这条不要了」
   ============================================================ */
(function () {
'use strict';
const { h, toast, popover, confirmDlg, copyText } = window.UI;
const { C, LINK, FS } = window.Base;
const { vpLabel } = window.Core;
const KEY = new URLSearchParams(location.search).get('k') || '';
const HP = new URLSearchParams(location.search).get('hp') || '';   // 历史记录里的一版（11-25 他要的，流水线/审片弹窗.js 的 oldBtn）：历史记录/提示词/第N段/原名__时间.txt
const HIST = HP ? Hist.parse(HP.split('/').pop()) : null;
const ONE = { fam: null, items: [], note: '' };
const same = (x, vid, old) => x.vid === vid && !!x.old === !!old;
const nameStem = n => String(n).replace(/\.[^.]+$/, '');
/* 这一条是哪一条（网址的 k；没给照样片名字认），它出过的样片：[{ vid, ver, old, mtime, noted }]，成片里的在前、新的一版在前。
   历史记录里的一版（hp）：只摆那一版出的（公用/历史记录.js 的 made，和流水线历史记录那一页同一套） */
async function load() {
  const fams = promptFams(), sc = flowScene(), sel = sc && sc.选定 && typeof sc.选定 === 'object' ? sc.选定 : {};
  const files = async dir => (await listRel(dir)).filter(e => e.kind === 'file');
  const here = await files('成片/' + SEGD), olds = await files('历史记录/成片/' + SEGD);
  const vids = es => es.map(e => e.name).filter(n => VIDEO_RE.test(n));
  let got;
  if (HIST) {
    const cur = D.prompts.map(p => p.name), rn = sc && sc.改名, mine = (await files('历史记录/提示词/' + SEGD)).filter(e => RE_VP.test(Hist.parse(e.name).orig));
    const m = Hist.made({ olds: mine, curs: cur, here, hist: olds, now: o => window.Core.vpNow(rn, o, n => cur.includes(n)) }).old;
    ONE.fam = { key: HIST.orig, name: HIST.orig, vers: [HIST.orig] };
    got = (m.get(HIST.name) || []).map(x => ({ vid: x.vid, ver: '', old: x.old }));
  } else {
    const key = KEY || (OLD ? (ClipOf.byName(VID, fams) || {}).key : ClipOf.promptOf(VID, fams, sel)) || (fams.find(f => f.vers.some(n => ClipOf.kinCarries(VID, n))) || {}).key || '';
    ONE.fam = fams.find(f => f.key === key) || null;
    got = ONE.fam ? ClipOf.ofPrompt(ONE.fam, fams, sel, vids(here), vids(olds), null) : [];
  }
  ONE.items = got.map(x => { const es = x.old ? olds : here, e = es.find(y => y.name === x.vid); return { ...x, mtime: e ? e.mtime || 0 : 0, noted: es.some(y => y.name === nameStem(x.vid) + '_批注.md') }; });
  if (!ONE.items.some(x => same(x, VID, OLD))) ONE.items.unshift({ vid: VID, ver: '', old: OLD, mtime: 0, noted: false });   // 认不出是这一条的：也摆上，换走了还换得回来
  return ONE.fam;
}
/* 历史记录里的那一版：{ rel, text, refs: [{ ref, path, sha }], secs }（挂的图、每一镜几秒照那一版自己的登记：公用/历史记录.js 的 refsFor，
   和流水线历史记录那一页「看」同一套）；读不了给 { rel, err }。不是历史记录里的一版给 null */
async function oldPrompt() {
  if (!HIST) return null;
  const io = { readJson: async rel => JSON.parse(await readText(rel)), list: rel => listRel(rel) };
  try {
    const text = await readText(HP), R = await Hist.refsFor(io, await Hist.mapsOf(io), { seg: SEG, orig: HIST.orig, file: HP, old: true, stamp: HIST.stamp }, text);
    ONE.note = R.note;
    return { rel: HP, text, refs: R.refs, secs: R.secs || null };
  } catch (e) { return { rel: HP, err: e.message }; }
}
/* 这一条别的样片（旁边对照「另一条样片」用）：{ rel, name, label, old, ver, mtime } */
const others = () => ONE.items.filter(x => !same(x, VID, OLD)).map(x => ({ rel: (x.old ? '历史记录/' : '') + '成片/' + SEGD + '/' + x.vid, name: x.vid, label: clipLabel(x.vid), old: x.old, ver: x.ver, mtime: x.mtime }));
const urlOf = x => '审片台.html?' + new URLSearchParams({ p: PJ, s: SEG, v: x.vid, ...(HIST ? { hp: HP } : { ...(ONE.fam ? { k: ONE.fam.key } : {}), ...(x.ver ? { pr: x.ver } : {}) }), ...(x.old ? { old: '1' } : {}) });
/* 换一条：这一条没存的批注先存上 */
async function openClip(x) {
  if (same(x, VID, OLD) || !(await leave())) return;
  location.replace(urlOf(x));
}
const two = n => String(n).padStart(2, '0');
const day = t => { if (!t) return ''; const d = new Date(t); return two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); };
function pick(anchor) {
  popover(anchor, close => [h('div', { class: 'fl-pop-h' }, '这一条出的样片'),
    h('div', { class: 'fl-pl' }, ONE.items.map(x => h('button', { type: 'button', class: 'fl-pi' + (same(x, VID, OLD) ? ' on' : ''), onclick: () => { close(); openClip(x); } },
      h('span', { class: 'pn' }, h('b', null, clipLabel(x.vid)), h('small', null, [HIST ? '' : x.ver ? vpLabel(x.ver) + ' 出的' : '认不出是哪一版出的', x.old ? '在历史记录里' : '', day(x.mtime), x.noted ? '写过批注' : ''].filter(Boolean).join(' · ')))))),
    h('div', { class: 'fl-pop-f' }, (HIST ? '只摆历史记录里这一版出的。' : '只摆这一条提示词出的。') + '换一条，这一条的批注先存上。')]);
}
/* 不满意：这条的批注复制下来，贴给你自己的 AI 商量怎么改（审片只批注、不出方案：2026-11-15 他定）。带样片、提示词、截图的完整路径 */
const full = parts => LINK.abs ? [LINK.abs, ...parts].join('\\') : parts.join('/');
async function copyNotes() {
  if (D.form && D.form.changed && D.form.text.trim()) { toast('正在写的这一条还没存：先按 Ctrl + 回车存上，再复制', 'err'); return; }
  if (D.saveT) saveNow();
  await D.q;
  if (!D.notes.length && !D.general.trim()) { toast('还没有批注：停在哪一帧，按回车写一条', 'err'); return; }
  let md;
  try { md = unbom(C.decodeText((await FS.read(D.notesAt)).buf).text).trim(); } catch (e) { toast('批注读不了：' + e.message, 'err'); return; }
  const pics = await FS.isDir(D.shotsDir).catch(() => false);
  const head = '我审第' + SEG + '段的样片「' + VID + '」写了批注，文件在 ' + full(D.notesAt) + (pics ? '，截图在 ' + full(D.shotsDir) : '') + '。先跟我商量怎么改，商量定了再动手；改好了我回流水线重新走。';
  await copyText(head + '\n\n' + md + '\n', '复制好了：贴给你自己的 AI，商量怎么改');
}
/* 这条不要了：移进 历史记录/成片/第N段（名字不改，批注、截图跟着走），换到这一条成片里的下一条；没有了就收起 */
async function retire() {
  const ho = host();
  if (!ho || typeof ho.retire !== 'function') { toast('从「提示词」那一步点「审片」打开，才能移走', 'err'); return; }
  if (!(await confirmDlg({ title: '这条不要了', body: VID + ' 移进这个项目的「历史记录 / 成片 / ' + SEGD + '」，它的批注、截图跟着一起移，名字不改。提示词留在原处。', ok: '移进历史记录' }))) return;
  if (!(await leave())) return;
  D.checking = true;   // 批注马上要挪走：别去看它在不在
  const err = await ho.retire(VID);
  if (err) { D.checking = false; toast(err, 'err'); return; }
  const next = ONE.items.find(x => !x.old && x.vid !== VID);
  if (next) location.replace(urlOf(next)); else ho.close();
}
/* 顶栏。status：批注存没存的那一格（审片台画） */
function top(status) {
  const i = ONE.items.findIndex(x => same(x, VID, OLD)), n = ONE.items.length;
  return h('header', { class: 'dk-top' },
    h('button', { class: 'btn sm ink', type: 'button', title: '收起审片，回到提示词那一步（批注都存着）。也可以按 Esc', onclick: goBack }, '关闭'),
    h('div', { class: 'dk-title' }, h('b', null, '审片 · 第' + SEG + '段 · ' + (ONE.fam ? vpLabel(ONE.fam.key) : '认不出是哪一条')),
      n > 1 ? null : h('span', { title: VID }, clipLabel(VID)),
      OLD ? h('span', { class: 'fs-state', title: '这条在历史记录里：批注照旧存在它旁边' }, '历史记录') : null),
    n > 1 ? h('button', { class: 'btn sm', type: 'button', title: VID + '\n换这一条提示词出的另一条（别的提示词的不在这里）', onclick: ev => pick(ev.currentTarget) }, clipLabel(VID) + '　' + (i + 1) + ' / ' + n + ' ▾') : null,
    h('span', { class: 'sp' }),
    HIST ? h('span', { class: 'dk-pr', title: HP + '\n右边的「这一镜」「提示词」「资产」都照这一版摆' + (ONE.note ? '\n' + ONE.note : '') }, D.prompt ? '出自 ' + vpLabel(D.prompt) + ' · ' + HIST.when + ' 收进历史记录的那一版' : '历史记录里的这一版读不了')
      : h('span', { class: 'dk-pr', title: '这条样片是这一条的哪一版出的：右边的「这一镜」「提示词」「资产」都照它摆' }, D.prompt ? '出自 ' + vpLabel(D.prompt) : D.promptKeep ? '出自 ' + baseName(D.promptKeep) + '（已经不在了）' : '认不出是哪一版出的'),
    status,
    h('button', { class: 'btn sm', type: 'button', title: '把这条的批注复制下来（带样片、提示词、截图的完整路径），贴给你自己的 AI 商量怎么改', onclick: copyNotes }, '复制批注'),
    OLD || HIST ? null : h('button', { class: 'btn sm ghost', type: 'button', title: '不要这条样片了：移进历史记录，批注、截图跟着走，名字不改', onclick: retire }, '这条不要了'));   // 历史记录里的一版只看（11-25）
}
window.DeskOne = { load, oldPrompt, others, top, get fam() { return ONE.fam; }, get items() { return ONE.items; } };
})();
