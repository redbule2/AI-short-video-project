/* ============================================================
   流水线 · 审片弹窗（window.ReviewPop，2026-11-22 他定）
   审片不再单独一页：「提示词」那一步每条上点「审片」，弹出审片台（看片、对照提示词、白模、关键帧，写批注）。
   只摆这一条出的样片（它几版出的都算，成片里的、历史记录里的；公用/样片归属.js 的 ofPrompt），进去以后换不到别的提示词（流水线/审片台这一条.js）。
   「这条不要了」在这里挪（流水线.json 的选定、沿用跟着去掉）：移进 历史记录/成片/第N段，名字不改，批注、截图跟着走。
   11-26 起提示词和它出的样片同进同出（他定）：挪完片子叫本机服务理一遍（/api/pairs，pair-keeper.js），这一版没有片留在成片里了，提示词跟着收进历史记录。
   11-25 起历史记录里的一版也能审（oldBtn：网址带 hp＝那一版的文件，审片台照它摆字、只摆它出的样片）。
   要先引 流水线.js、公用/样片归属.js、流水线/历史记录.js。测试：测试/审片弹窗_测试.cjs
   ============================================================ */
(function () {
'use strict';
const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
/* 这一条（e）出过的样片：[{ vid, ver, old, mtime }]，成片里的在前、新的一版在前。历史记录里的读好以前只算成片里的；删掉那一版的（带「__时间」）不算 */
function clipsFor(s, e, list) {
  const hc = HistView.clips(s), hist = (hc.items || []).filter(x => !x.stamp), mt = new Map(hist.map(x => [x.name, x.mtime || 0])), time = clipsOf(s.段).time;
  return ClipOf.scene(s).of(e, list, hist.map(x => x.name)).map(x => ({ ...x, mtime: (x.old ? mt.get(x.vid) : time.get(x.vid)) || 0 }));
}
/* 先打开哪一条：成片里新的一版出的、最后出的那一条；成片里没有就看历史记录里的 */
function firstOf(items) {
  const here = items.filter(x => !x.old), pool = here.length ? here : items, top = pool.filter(x => x.ver === pool[0].ver);
  return top.reduce((a, b) => (b.mtime > a.mtime ? b : a), top[0]);
}
/* 最新这一版（e.name）出的样片，成片、历史记录里的都算。「审片」能不能点、提示词页「已出片 / 没出片」筛选和「已出片」标签都照它
   （11-24 他问「没有出片的提示词为什么会有审片按钮」：筛选原来只数成片，审完收进历史记录的算成没出片，审片却能点） */
const madeOf = (s, e, list, items = clipsFor(s, e, list)) => items.filter(x => x.ver === e.name);
/* 出过片的那一条标出来（11-25 从 提示词.html 挪来，历史记录里的一版也用）：哪几条样片（悬停看名字）。made：[{ vid, old }]，
   审完收进历史记录的也算（11-24），全在历史记录里的写明；inHist：历史记录里的一版（那一排都是历史记录里的，不再写「片在历史记录」） */
function tag(made, inHist) {
  if (!made.length) return null;
  const here = made.filter(x => !x.old), nos = [...new Set(here.map(x => ClipOf.noOf(x.vid)).filter(Boolean))].sort((a, b) => a - b);
  return h('span', { class: 'fs-state ok', title: '这一版出的样片：\n' + made.map(x => x.vid + (x.old ? '（在历史记录里）' : '')).join('\n') }, icon('check'),
    '已出片' + (inHist ? '' : !here.length ? ' · 片在历史记录' : nos.length ? ' 第' + nos.join('、') + '条' : ''));
}
/* 那一行的「审片」：最新这一版出过片才能点。
   前几版出过、最新这一版还没出的也灰掉（11-22 晚他定：「没出片」里的不该能审）；能点以后，弹窗里几版的片照样都摆 */
function btn(s, e, list) {
  const items = clipsFor(s, e, list), mine = madeOf(s, e, list, items).length > 0, here = items.filter(x => !x.old).length, old = items.length - here;
  const say = [here ? '成片里 ' + here + ' 条' : '', old ? '历史记录里 ' + old + ' 条' : ''].filter(Boolean).join('、');
  return h('button', { class: 'btn sm', type: 'button', disabled: !mine,
    title: mine ? '弹出来看片、写批注：只摆这一条出的样片（' + say + '），旁边对照这一条的提示词、白模、关键帧'
      : items.length ? '「' + e.label + '」还没出片：出了片才能审，到时候前几版的片也能在弹窗里换着看' : '这一条还没出片：出了片才能审',
    onclick: () => open(s, e, list) }, '审片');
}
/* 弹出来。want：先打开哪一条（{ vid, old }，不给照 firstOf） */
function open(s, e, list, want) {
  const items = clipsFor(s, e, list);
  if (!items.length) { toast('这一条还没有样片', 'err'); return; }
  const it = (want && items.find(x => x.vid === want.vid && !!x.old === !!want.old)) || firstOf(items);
  const q = new URLSearchParams({ p: F.name, s: s.段, v: it.vid, k: e.key });
  if (it.ver) q.set('pr', it.ver);
  if (it.old) q.set('old', '1');
  show(s, q, e.label);
}
/* 历史记录里的一版（11-25 他要的：历史记录里也看片）：it 是 HistView 列的那一版（{ file: 历史记录/提示词/第N段/原名__时间.txt, label, name }），
   items：它出的样片 [{ vid, old, mtime }]（HistView.made）。审片台照网址的 hp 摆这一版的字、只摆这一版出的样片 */
function oldBtn(s, it, items) {
  const here = items.filter(x => !x.old).length, old = items.length - here, say = [here ? '成片里 ' + here + ' 条' : '', old ? '历史记录里 ' + old + ' 条' : ''].filter(Boolean).join('、');
  return h('button', { class: 'btn sm', type: 'button', disabled: !items.length,
    title: items.length ? '弹出来看片：左边放这一版出的样片（' + say + '），右边对照这一版的字' : '这一版没出过片',
    onclick: () => { const x = items[0]; show(s, new URLSearchParams({ p: F.name, s: s.段, v: x.vid, hp: it.file, ...(x.old ? { old: '1' } : {}) }), it.label); } }, '审片');
}
/* 盖上审片台（iframe）：q 是它的网址参数 */
function show(s, q, label) {
  closePop(); hideHov();
  if (SHELL) SHELL.remove();
  const frame = h('iframe', { class: 'wf-shell-frame', title: '审片 · ' + label, src: '审片台.html?' + q });
  const box = h('div', { class: 'wf-shell wf-rv' }, h('div', { class: 'wf-rv-box' }, frame));
  const keep = async () => {   // 审片台没存的批注先存上；它说不行（正在写的那一条没存）就留着
    try { const w = frame.contentWindow; if (w && w.DESK && await w.DESK.leave() === false) return false; } catch (err) { /* 那一页坏了：照样收起 */ }
    return true;
  };
  const close = async () => {
    if (SHELL !== box || !(await keep()) || SHELL !== box) return;
    box.remove(); SHELL = null; window.DESK_HOST = null;
    document.body.classList.remove('wf-covered');
    HistView.drop(); await refresh();
    if (PAGE.sides) PAGE.sides(new Set(['*']));   // 批注、移走的样片：回来就重读
  };
  window.DESK_HOST = { close, retire: vid => retire(s, vid) };
  box.leave = keep;   // 换页、换项目以前（流水线.js 的 go、pickProject）
  SHELL = box;
  document.body.append(box); document.body.classList.add('wf-covered');
  frame.addEventListener('load', () => { try { frame.contentWindow.focus(); } catch (err) { /* 不要紧 */ } });
}
/* 这条不要了：样片和它的批注、截图（公用/样片归属.js 的 ownKin）移进 历史记录/成片/第N段，名字不改。给 '' 是挪好了，不然是为什么没挪。
   接着叫本机服务把这一段理一遍（同进同出，11-26）：出它的那一版没有片留在成片里了，提示词连写稿资料、批注、出片任务书收进 历史记录/提示词/第N段 */
async function retire(s, vid) {
  if (AI.jobs.some(j => jobLive(j) && j.段 === s.段 && j.视频 === vid)) return 'AI 正在照这条样片做事，做完再移';
  const crel = ['成片', segName(s.段)], ls = lister(F.name), ents = await ls(crel.join('/'));
  if (ls.failed) return '本机服务连不上，这回没移';
  const names = ents.map(x => x.name);
  if (!names.includes(vid)) return '「' + vid + '」已经不在成片里了';
  const from = n => at([F.name, ...crel, n]), to = n => at([F.name, '历史记录', ...crel, n]);
  try { await FS.move(from(vid), to(vid)); } catch (err) { return '没移走：' + err.message + (/同名/.test(err.message) ? '' : '（剪映开着它的话先关掉）'); }
  const left = [];
  for (const n of ClipOf.ownKin(vid, names)) { try { await FS.move(from(n), to(n)); } catch (err) { left.push(n); } }
  let went = [];   // 跟着收进历史记录的提示词（本机服务挪的）
  if (LINK.v >= 27) {
    try {
      const r = await (await LINK.req('POST', '/api/pairs?p=' + encodeURIComponent(F.name) + '&s=' + encodeURIComponent(s.段))).json();
      went = r.提示词 || [];
      left.push(...(r.没挪 || []));
    } catch (err) { left.push('出它的提示词没跟上（' + err.message + '），本机服务过一会儿会再理'); }
  }
  let changed = false;
  if (own(s, '选定') && s.选定 && typeof s.选定 === 'object') for (const k of Object.keys(s.选定)) if (s.选定[k] === vid) { delete s.选定[k]; changed = true; }
  for (const k of ['样片/' + vid, ...went.flatMap(n => ['提示词/' + n, '白模/' + n])]) if (own(s.沿用, k)) { delete s.沿用[k]; changed = true; }
  if (changed) { touch(); await flush(); }
  const say = '「' + vid + '」移进 历史记录 / ' + crel.join(' / ') + ' 了' + (went.length ? '；出它的提示词 ' + went.join('、') + ' 也跟着进了 历史记录 / 提示词 / ' + crel[1] : '');
  toast(left.length ? say + '。这几样没跟上：' + left.join('、') : say, left.length ? 'err' : undefined);
  return '';
}
window.ReviewPop = Object.freeze({ clipsFor, madeOf, firstOf, tag, btn, oldBtn, open, retire });
})();
