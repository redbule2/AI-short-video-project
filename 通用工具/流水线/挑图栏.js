/* ============================================================
   流水线 · 资产 · 挑图栏（2026-11-16 他看了 资产页改版_设计稿.html 定的：原来盖住整页的大弹窗，改成右边滑出一栏）
   从哪里点开，顶上就写明挑给谁，挑中的就给它；不再照图名悄悄猜挂给谁。四种：
     给一行挑图（人物、道具卡上「挑现成的图」「换图」）：全片的、删掉的、画布上的。点一张，再点「挂给××」（点两下也行）。
     只用文字写的场景挑一张图：全片的场景图、这一段的。点「这一段改用这张图」。
     关键帧的一格（镜头几 · 开头、中间、结尾）：这一段文件夹里的图。点「绑到镜头几开头」。
     「＋ 加人物」那张卡：表里的（这一段还没选的）、全片的图、这一段的、删掉的、画布上的。挑一样这一段就加上；栏不收，能接着加。
       全片的图：挂给哪一行写在按钮上（这张图已经挂在哪一行，或者图名里的叫法对得上哪一行；都没有就新加一行），看清了再点。
   一栏分几个页签，一次看一组，能搜名字；左下角「＋ 从电脑里找」照旧（电脑找图.js）。只盖右边：左边的卡还看得见；Esc 或 × 收起。
   画布上的图（即梦画布上有、本地没有一样的，11-14 他要的）只能看，点了看大图。
   这一页的图怎么用（useImage、useSeg）、删掉的图（loadDeleted）、画布上的图（CV）原来在 资产.html 的挑图弹窗里，一起挪过来了。
   ============================================================ */
'use strict';
/* ---------- 用上一张图 ---------- */
/* 一张全片的图该挂到哪一行：给哪一行挑的就是那一行；不然看哪一行已经引用它，再不然照图名里的叫法找（老名字「项目_类别_叫法_资产」也认） */
function rowFor(x, cell) {
  const K = LISTS.find(k => k.cats(x.类别));
  if (!K) return null;
  return (cell && cell.类别 === K.key ? entryOf(K.key, cell.名称) : null) || F.doc[K.key].find(r => r.资产.includes(x.文件)) || F.doc[K.key].find(r => r.名 === tokenOf(x) || r.名 === x.名称) || null;
}
/* 这一段文件夹里的一张图，这一场当 k 用：只这一场用，不挂表里哪一行（原来当别的用的，挪过来） */
function useSeg(s, k, x) {
  const was = segKind(s, x.文件);
  putSeg(s, k, x.文件); orderCast(s); touch();
  return '「' + x.名称 + '」这一段当' + k + '用上了' + (was && was !== k ? '（原来当' + was + '）' : '') + '，只这一段用';
}
/* 这一场用上一张全片的图：人物、道具的图挂到 rowFor 找到的那一行（找不到就照叫法加一行），这一场选上；场景图加进全片和这一场 */
function useImage(s, x, cell) {
  const file = x.文件;
  if (isSceneImg(x)) {
    if (!F.doc.场景图.includes(file)) F.doc.场景图.push(file);
    if (!s.场景图.includes(file)) s.场景图.push(file);
    orderCast(s); touch();
    return '场景图「' + x.名称 + '」这一段用上了';
  }
  const K = LISTS.find(k => k.cats(x.类别));
  let e = rowFor(x, cell);
  const fresh = !e;
  if (fresh) { e = { 名: tokenOf(x), 描写: '', 资产: [] }; F.doc[K.key].push(e); }
  if (!e.资产.includes(file)) {
    if (!K.multi && e.资产.length) e.不用 = [...new Set([...(Array.isArray(e.不用) ? e.不用 : []), ...e.资产])];   // 人物换图：换下来的那张记进「不用」，AI 清单里列着它也不再替你挂回去
    e.资产 = K.multi ? [...e.资产, file] : [file];
  }
  if (Array.isArray(e.不用)) { e.不用 = e.不用.filter(f => f !== file); if (!e.不用.length) delete e.不用; }
  if (e.不用时) { delete e.不用时[file]; if (!Object.keys(e.不用时).length) delete e.不用时; }
  if (!s[K.key].includes(e.名)) s[K.key].push(e.名);
  orderCast(s); touch();
  return K.key + '「' + e.名 + '」' + (fresh ? '加进了' + K.key + '表，' : '') + '挂上了这张图，这一段也选上了';
}
/* 删掉的图：历史记录/资产/全局资产/类别/原名__时间.后缀（「图不要了」移过去的） */
async function loadDeleted() {
  const ls = lister(F.name), out = [];
  for (const c of (await ls('历史记录/资产/全局资产')).filter(e => e.kind === 'directory').map(e => e.name))
    for (const e of (await ls('历史记录/资产/全局资产/' + c)).filter(x => x.kind === 'file' && IMG_RE.test(x.name))) {
      const m = /^(.+)__(\d{8})-(\d{6})(\.[^.]+)$/.exec(e.name);
      if (m) out.push({ 类别: c, 名称: m[1], 文件: '历史记录/资产/全局资产/' + c + '/' + e.name, 原处: '资产/全局资产/' + c + '/' + m[1] + m[4], 序: m[2] + m[3], 戳: m[2] + '-' + m[3], 时: m[2].slice(4, 6) + '-' + m[2].slice(6) + ' ' + m[3].slice(0, 2) + ':' + m[3].slice(2, 4) });
    }
  return out.sort((a, b) => b.序.localeCompare(a.序)).slice(0, 80);
}
/* 删掉的图放回原处（批注、批注截图一起），回放回来以后那张全片的图 */
async function restoreDeleted(x) {
  try { await FS.move(at([F.name, ...x.文件.split('/')]), at([F.name, ...x.原处.split('/')])); }
  catch (e) { toast('没放回来：' + e.message + '（原处要是已经有一张同名的图，先处理那一张）', 'err'); return null; }
  const dir = x.原处.split('/').slice(0, -1), stem = stemOf(x.原处.split('/').pop()), old = ['历史记录', ...dir];
  try { const n = stem + '_批注__' + x.戳 + '.md'; if (await hasFile(F.name, [...old, n]) && !(await hasFile(F.name, [...dir, stem + '_批注.md']))) await FS.move(at([F.name, ...old, n]), at([F.name, ...dir, stem + '_批注.md'])); } catch (e) { /* 挪不动就留在历史记录里 */ }
  try { const n = stem + SHOTS_TAIL + '__' + x.戳; if (await FS.isDir(at([F.name, ...old, n])) && !(await FS.isDir(at([F.name, ...dir, stem + SHOTS_TAIL])))) await FS.move(at([F.name, ...old, n]), at([F.name, ...dir, stem + SHOTS_TAIL])); } catch (e) { /* 同上 */ }
  window.UI.dropThumbs();
  try { F.pool = await loadPool(F.name); } catch (e) { /* 下回再读 */ }
  await loadSides();
  toast('放回来了：' + x.原处);
  return F.pool.find(p => p.文件 === x.原处) || null;
}
const guessKind = x => FRAME_RE.test((x.组 || '') + x.名称) ? '关键帧' : /空镜|场景|底图/.test((x.组 || '') + x.名称) ? '场景' : '';

/* ---------- 即梦画布上的图（11-14 他要的：资产这一步看得到本地的和画布上的，一样的只摆本地的）。
   本机服务读项目 资产/出片设置.json 里的画布，和本地的图逐像素比（.agents/skills/annotate-live/canvas.js）：
   一样的不另摆，本地那一张标「画布有」；画布上有、本地没有一样的，摆在挑图栏「画布上的」那一页，点了看大图。只读画布，不传、不删、不下载进项目。
   登录位：先试默认的，再试总览「即梦授权」里加过的 ---------- */
const CV = { name: '', st: '', sig: '', data: null, err: '', prog: null, poll: 0, paint: null };
const cvJm = () => { try { return JSON.parse(localStorage.getItem('antou:flow:jm-list') || '[]').filter(x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(x)); } catch (e) { return []; } };
const cvUrl = q => { const jm = cvJm(); return '/api/jimeng?' + q + '&p=' + encodeURIComponent(F.name) + (jm.length ? '&jm=' + encodeURIComponent(jm.join(',')) : ''); };
const cvSame = () => new Set(((CV.name === F.name && CV.data && CV.data.一样) || []).map(x => x.file));
const cvProgText = () => { const p = CV.prog || [0, 0]; return (CV.data ? '正在重读画布' : '正在读画布、和本地的图一张一张比（头一回要把画布上的图下下来，要几分钟）') + (p[1] ? '：比了 ' + p[0] + ' / ' + p[1] + ' 张' : '：先读画布上有哪些图') + '…'; };
async function cvLoad(again) {
  const name = F.name;
  if (CV.name !== name) Object.assign(CV, { name, st: '', sig: '', data: null, err: '', prog: null });
  clearTimeout(CV.poll);
  if (again) { CV.st = '在对'; CV.sig = ''; if (CV.paint) CV.paint(); }
  try {
    const j = await (await LINK.req('GET', cvUrl('canvas' + (again ? '&again' : '')))).json();
    if (name !== F.name) return;
    if (!j || !('状态' in j)) throw new Error('本机服务还是旧的，重开一次才看得到画布上的图');
    Object.assign(CV, { st: j.状态, err: j.错误 || '', prog: j.进度 || null });
    if (Array.isArray(j.只在画布)) CV.data = j;
    if (j.状态 === '在对' && CV.paint) CV.poll = setTimeout(() => { if (CV.paint) cvLoad(); }, 2000);
  } catch (e) { Object.assign(CV, { st: '出错', err: e.message }); }
  const sig = CV.st + '|' + CV.err + '|' + (CV.data ? CV.data.共 + '/' + CV.data.只在画布.length + '/' + (CV.data.一样 || []).length : '');
  if (sig === CV.sig) { const el = document.getElementById('cv-prog'); if (el && CV.st === '在对') el.textContent = cvProgText(); return; }   // 只是进度变了：只换那一句
  CV.sig = sig;
  if (CV.paint) CV.paint();
}
/* 画布上的图：经本机服务下下来，缩小了摆；w 是 0 就是原图（看大图用）。一次最多三张 */
const CV_IMG = new Map(), CV_Q = [];
let cvBusy = 0;
function cvPump() {
  while (cvBusy < 3 && CV_Q.length) {
    const job = CV_Q.shift(); cvBusy++;
    (async () => (await window.UI.shrink(await (await LINK.req('GET', cvUrl('img=' + job.rid))).blob(), job.w)).url)().then(job.res, job.rej).finally(() => { cvBusy--; cvPump(); });
  }
}
function cvImg(rid, w) {
  const k = rid + '@' + w, img = h('img', { alt: '', draggable: 'false' });
  if (!CV_IMG.has(k)) { const p = new Promise((res, rej) => { CV_Q.push({ rid, w, res, rej }); cvPump(); }); p.catch(() => CV_IMG.delete(k)); CV_IMG.set(k, p); }
  CV_IMG.get(k).then(u => { img.src = u; }).catch(() => { img.alt = '下不来'; });
  return img;
}
async function cvShow(x) {
  hideHov();
  const img = cvImg(x.rid, 0);
  img.className = 'cv-big';
  await dialog(close => {
    const el = dlgShell('画布上的图 · ' + x.名称, '画布节点「' + x.title + '」，' + x.w + '×' + x.h + '。' + (x.注 ? x.注 + '。' : '本地没有一样的图。') + '这里只看，不下载进项目。',
      [img], [h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close() }, '好了')]);
    el.classList.add('wide');
    return el;
  });
}
const cvTile = x => h('button', { type: 'button', class: 'fl-at cv ' + (x.类别 ? kindCls(x.类别) : ''), title: '画布节点：' + x.title + '（' + x.w + '×' + x.h + '）\n' + (x.注 || '本地没有一样的图') + '\n点一下看大图', onclick: () => cvShow(x) },
  cvImg(x.rid, 220), h('span', null, x.名称 + (x.第几张 ? '（' + x.第几张 + '）' : '')), h('small', null, x.注 ? '和本地同名的不一样' : x.段 && !x.类别 ? '第' + x.段 + '段 · 只在画布' : '只在画布'));
/* 画布上的、这一回要摆的：人物、场景、道具只摆名字是这一类的；关键帧只摆这一段的 */
const cvMine = (k, s) => { const all = (CV.name === F.name && CV.data && CV.data.只在画布) || []; return k === '关键帧' ? all.filter(x => x.段 === s.段) : all.filter(x => x.类别 && kindOf(x.类别) === k); };
function cvPane(k, s, list) {
  if (CV.name !== F.name) return [h('p', { class: 'fn-note' }, '还没读画布。')];
  if (CV.st === '没画布') return [h('p', { class: 'fn-note' }, '这个项目还没有即梦画布（资产 / 出片设置.json 里没写画布网址）。')];
  const d = CV.data, busy = !CV.st || CV.st === '在对', all = (d && d.只在画布) || [];
  const again = h('button', { class: 'fl-link', type: 'button', title: '重读即梦画布，再和本地的图比一遍', onclick: () => cvLoad(true) }, '再读一遍画布');
  const note = CV.st === '出错' ? h('p', { class: 'fn-note warn' }, '画布读不了：' + CV.err + '　', again)
    : busy ? h('p', { class: 'fn-note', id: 'cv-prog' }, cvProgText())
      : h('p', { class: 'fn-note' }, '画布上一共 ' + d.共 + ' 张图：' + (d.一样 || []).length + ' 张本地有一样的，只摆本地的（标「画布有」）；本地没有一样的 ' + all.length + ' 张，这里摆' + (k === '关键帧' ? '这一段的' : k) + ' ' + list.length + ' 张。只能看，点一下看大图。　', again);
  return [note, list.length ? h('div', { class: 'fl-ag' }, list.map(cvTile)) : null];
}

/* ---------- 挑图栏 ---------- */
const PB = { el: null, o: null, tab: '', q: '', sel: '', deleted: [], mine: [], busy: false };
const pbKind = o => o.mode === 'slot' ? '关键帧' : o.mode === 'text' ? '场景' : o.k;
function pbTabs(o) {
  if (o.mode === 'slot') return ['这一段的', '画布上的'];
  if (o.mode === 'row') return ['全片的', '删掉的', '画布上的'];
  if (o.mode === 'text') return ['全片的', '这一段的', '删掉的', '画布上的'];
  if (o.k === '关键帧') return ['这一段的', '画布上的'];
  return [o.k === '场景' ? '文字写的' : '表里的', '全片的', '这一段的', '删掉的', '画布上的'];
}
const pbLabel = o => o.row ? o.row.名称 + (o.row.sub ? '（' + o.row.sub + '）' : '') : '';
/* 这一页摆的几样：{ id, kind（row 表里一行 / line 文字写的场景 / pool 全片的图 / seg 这一段的图 / del 删掉的图）, name, file, note, used（已经用着，不能再点） } */
function pbItems(o, tab) {
  const s = o.s, k = pbKind(o), row = o.row ? entryOf(o.row.类别, o.row.名称) : null, onCv = cvSame();
  const cvN = (x, note) => onCv.has(x.文件) ? (note ? note + ' · ' : '') + '画布有' : note;
  const owner = x => { for (const K of LISTS) { const e = F.doc[K.key].find(r => r.资产.includes(x.文件)); if (e) return e.名 + ' 的图'; } return ''; };
  const here = x => isSceneImg(x) ? s.场景图.includes(x.文件) : LISTS.some(K => K.cats(x.类别) && s[K.key].some(n => { const e = entryOf(K.key, n); return !!e && e.资产.includes(x.文件); }));
  if (tab === '表里的') return F.doc[k].filter(e => !s[k].includes(e.名)).map(e => ({ id: 'row:' + e.名, kind: 'row', name: e.名, file: e.资产.find(g => !F.gone.has(g)) || '', note: oneLine(e.描写) || '还没写描写', e }));
  if (tab === '文字写的') return sceneLines().filter(t => !uniq(s.场景文字).includes(t)).map(t => ({ id: 'line:' + t, kind: 'line', name: sceneLabel(t), file: '', note: sceneRest(t) || '只用文字写，不用图', t }));
  if (tab === '全片的') return F.pool.filter(k === '场景' ? isSceneImg : x => KIND[k] && KIND[k].cats(x.类别)).map(x => {
    const used = o.mode === 'row' ? !!row && row.资产.includes(x.文件) : o.mode === 'add' ? here(x) : o.mode === 'text' ? s.场景图.includes(x.文件) : false;
    return { id: 'pool:' + x.文件, kind: 'pool', name: x.名称, file: x.文件, x, used, note: cvN(x, used ? (o.mode === 'row' ? '已经挂着' : '这一段在用') : k === '场景' ? '' : owner(x) || '还没人用') };
  });
  if (tab === '这一段的') {
    const list = k === '关键帧' ? [...PB.mine].sort((a, b) => (guessKind(b) === '关键帧') - (guessKind(a) === '关键帧')) : PB.mine;
    return list.map(x => { const u = segKind(s, x.文件), used = u === k && (k !== '关键帧' || o.mode !== 'slot' || SB.bindsOf(s)[x.文件] && SB.bindsOf(s)[x.文件].镜 === o.slot.no && SB.bindsOf(s)[x.文件].刻 === o.slot.刻);
      return { id: 'seg:' + x.文件, kind: 'seg', name: x.名称, file: x.文件, x, group: x.组, used: !!used, note: cvN(x, !u ? '' : u === k ? (k === '关键帧' && SB.bindsOf(s)[x.文件] ? '绑在' + SB.say(SB.bindsOf(s)[x.文件], s.段落).replace(/「[^」]*」/, '') : '这一段当' + u + '用着') : '这一段当' + u + '用着，挑了改当' + k) }; });
  }
  if (tab === '删掉的') return PB.deleted.filter(x => kindOf(x.类别) === k).map(x => ({ id: 'del:' + x.文件, kind: 'del', name: x.名称, file: x.文件, x, note: x.时 + ' 删的' }));
  return [];
}
/* 选中的那一样，按钮上写什么、点了做什么（run 回给 toast 的话；没做成回 null） */
function pbAct(o, it) {
  const s = o.s, k = pbKind(o), label = pbLabel(o);
  if (!it) return null;
  if (o.mode === 'slot') {
    const say = '镜头' + o.slot.no + ' ' + SB.SAY[o.slot.刻];
    return { text: '绑到' + say, run: async () => { if (segKind(s, it.file) !== '关键帧') putSeg(s, '关键帧', it.file); SB.bind(s, it.file, o.slot.no, o.slot.刻, s.段落, true); touch(); return '「' + it.name + '」绑到' + say + '，当现用'; } };
  }
  if (o.mode === 'row') {
    const e = entryOf(o.row.类别, o.row.名称), K = KIND[o.row.类别], swap = !!e && !K.multi && e.资产.length && !e.资产.includes(it.file);
    const doIt = async x => {
      if (swap && !(await confirmDlg({ title: '「' + e.名 + '」换成这张图？', body: '现在挂的是 ' + baseOf(e.资产[0]) + '，换成 ' + x.名称 + '。原来那张还留在项目里，随时能换回去。', ok: '换成这一张' }))) return null;
      return useImage(s, x, o.row);
    };
    if (it.kind === 'del') return { text: '放回来，挂给「' + label + '」', run: async () => { const x = await restoreDeleted(it.x); return x ? doIt(x) : null; } };
    return { text: (swap ? '换成这张，' : '') + '挂给「' + label + '」', run: () => doIt(it.x) };
  }
  if (o.mode === 'text') {
    const toImg = file => { useSceneImg(s, o.text, file); return '场景「' + sceneLabel(o.text) + '」这一段改用这张图了（全片设定里那一句还在）'; };
    if (it.kind === 'seg') return { text: '这一段改用这张图', run: async () => { s.场景文字 = uniq(s.场景文字).filter(t => t !== o.text); putSeg(s, '场景', it.file); orderCast(s); touch(); return '场景「' + sceneLabel(o.text) + '」这一段改用「' + it.name + '」了，只这一段用'; } };
    if (it.kind === 'del') return { text: '放回来，这一段改用它', run: async () => { const x = await restoreDeleted(it.x); return x ? toImg(x.文件) : null; } };
    return { text: '这一段改用这张图', run: async () => toImg(it.file) };
  }
  /* add：加这一段出场的 */
  if (it.kind === 'row') return { text: '选上「' + it.name + '」', run: async () => { s[k].push(it.name); orderCast(s); touch(); return k + '「' + it.name + '」这一段选上了' + (it.file ? '' : '。它还没有图'); } };
  if (it.kind === 'line') return { text: '选上「' + it.name + '」', run: async () => { s.场景文字 = [...uniq(s.场景文字), it.t]; orderCast(s); touch(); return '场景「' + it.name + '」这一段选上了（只用文字写）'; } };
  if (it.kind === 'seg') return { text: '这一段当' + k + '用', run: async () => useSeg(s, k, it.x) };
  const poolText = x => { if (isSceneImg(x)) return '这一段用上它'; const r = rowFor(x, null); return !r ? '新加' + k + '「' + tokenOf(x) + '」' : r.资产.includes(x.文件) ? '选上「' + r.名 + '」' : '挂给「' + r.名 + '」'; };
  const poolRun = async x => {
    const r = isSceneImg(x) ? null : rowFor(x, null), K = r ? LISTS.find(c => c.cats(x.类别)) : null;
    if (r && !K.multi && r.资产.length && !r.资产.includes(x.文件) && !(await confirmDlg({ title: '「' + r.名 + '」换成这张图？', body: '现在挂的是 ' + baseOf(r.资产[0]) + '，换成 ' + x.名称 + '。原来那张还留在项目里，随时能换回去。', ok: '换成这一张' }))) return null;
    return useImage(s, x, null);
  };
  if (it.kind === 'del') return { text: '放回来，' + poolText({ ...it.x, 文件: it.x.原处 }), run: async () => { const x = await restoreDeleted(it.x); return x ? poolRun(x) : null; } };
  return { text: poolText(it.x), run: () => poolRun(it.x) };
}
function pbTitle(o) {
  const s = o.s;
  if (o.mode === 'row') return ['给「' + pbLabel(o) + '」挑图', KIND[o.row.类别].multi ? '挑中的挂到全片的「' + o.row.名称 + '」（一个道具可以挂几张，一个状态一张）' : '挑中的挂到全片的「' + o.row.名称 + '」，各段都用这张'];
  if (o.mode === 'text') return ['给场景「' + sceneLabel(o.text) + '」挑一张图', '用了图，这一段就不再只用文字写（全片设定里那一句还在）'];
  if (o.mode === 'slot') return ['给「镜头' + o.slot.no + ' ' + SB.SAY[o.slot.刻] + '」挑关键帧', '资产 / ' + segName(s.段) + ' 里的图（连下一层文件夹）。挑中的当现用，原来那张改备选'];
  return ['加' + o.k + ' · 第' + s.段 + '段', o.k === '关键帧' ? '资产 / ' + segName(s.段) + ' 里的图，挑了就当关键帧，放在「还没绑」那一排' : '挑一样，这一段就加上。栏不收，能接着加'];
}
function pbPaint() {
  const o = PB.o;
  if (!o || !PB.el) return;
  const tabs = pbTabs(o), k = pbKind(o), q = PB.q.trim().toLowerCase();
  if (!tabs.includes(PB.tab)) PB.tab = tabs[0];
  const count = t => t === '画布上的' ? (CV.data && CV.name === F.name ? cvMine(k, o.s).length : '') : pbItems(o, t).length;
  const [title, sub] = pbTitle(o);
  const list = PB.tab === '画布上的' ? [] : pbItems(o, PB.tab).filter(x => !q || x.name.toLowerCase().includes(q));
  const sel = list.find(x => x.id === PB.sel) || null, act = sel && !sel.used ? pbAct(o, sel) : null;
  const pick = it => { if (it.used) { toast(it.note || '已经在用了'); return; } PB.sel = PB.sel === it.id ? '' : it.id; pbPaint(); };
  const tile = it => {
    const el = h('button', { type: 'button', class: 'fl-at ' + kindCls(it.kind === 'seg' ? '这一段' : k) + (it.used ? ' on' : '') + (it.id === PB.sel ? ' sel' : ''), title: (it.file || it.name) + (it.note ? '\n' + it.note : '') + (it.used ? '' : '\n点一下选中，再点下面的钮；点两下直接用'),
      onclick: () => pick(it), ondblclick: () => { if (!it.used) { PB.sel = it.id; go1(); } } },
    it.file ? thumbImg(it.file) : h('span', { class: 'fl-at-no' }, it.kind === 'line' ? '文字' : '还没有图'), h('span', null, it.name), it.note ? h('small', null, it.note) : null, h('i', null, icon('check')));
    if (it.file) hoverable(el, it.file, it.name);
    return el;
  };
  let body;
  if (PB.tab === '画布上的') body = cvPane(k, o.s, cvMine(k, o.s).filter(x => !q || String(x.名称).toLowerCase().includes(q)));
  else if (!list.length) body = [h('p', { class: 'fn-note' }, q ? '没有名字里带「' + PB.q.trim() + '」的。' : PB_EMPTY(o, PB.tab))];
  else if (PB.tab === '这一段的') body = segGroups(list.map(x => ({ ...x, 组: x.group }))).flatMap(([g, l]) => [h('div', { class: 'pick-lab' }, g || segName(o.s.段) + ' 本层'), h('div', { class: 'fl-ag' }, l.map(tile))]);
  else body = [h('div', { class: 'fl-ag' }, list.map(tile))];
  const fresh = o.mode === 'add' && (KIND[o.k] || o.k === '场景') ? h('button', { class: 'btn sm ghost', type: 'button', title: o.k === '场景' ? '一句话写这个地方，记进全片设定的「场景」，这一段也选上。不用先有图' : '写叫法、描写（能顺手挑一张图），记进全片的' + o.k + '表，这一段也选上', onclick: () => pbNew(o) }, '＋ 新加一个' + o.k) : null;
  PB.el.replaceChildren(
    h('div', { class: 'pb-h' }, h('div', { class: 'pb-t' }, h('b', null, title), h('small', null, sub)), h('button', { class: 'pb-x', type: 'button', title: '收起（Esc）', onclick: pbClose }, icon('x'))),
    h('div', { class: 'pb-tabs', role: 'tablist' }, tabs.map(t => h('button', { class: 'pb-tab' + (t === PB.tab ? ' on' : ''), type: 'button', role: 'tab', onclick: () => { PB.tab = t; PB.sel = ''; pbPaint(); if (t === '画布上的' && !CV.st) cvLoad(); } }, t, h('em', null, String(count(t)))))),
    PB.search,
    h('div', { class: 'pb-body' }, ...body.filter(Boolean)),
    h('div', { class: 'pb-f' },
      o.mode === 'row' || o.mode === 'add' || o.mode === 'slot' || o.mode === 'text' ? h('button', { class: 'btn sm pc-open', type: 'button', title: '电脑别处的图：整台电脑按名字找，或者翻文件夹；选中一张，起好名字，复制进项目该放的地方（原图不动）', onclick: () => pbPc(o) }, '＋ 从电脑里找') : null,
      fresh, h('span', { class: 'sp' }),
      sel ? h('span', { class: 'pb-sel', title: sel.file || sel.name }, '选中：' + sel.name) : h('span', { class: 'pb-sel faint' }, '点一张选中'),
      h('button', { class: 'btn ink', type: 'button', disabled: !act || PB.busy, onclick: go1 }, act ? act.text : '用这一张')));
}
const PB_EMPTY = (o, tab) => tab === '表里的' ? o.k + '表里的都选上了。表里没有的，点下面「＋ 新加一个' + o.k + '」。'
  : tab === '文字写的' ? '全片设定里写的场景都选上了。没写过的，点下面「＋ 新加一个场景」。'
    : tab === '全片的' ? '项目的 资产 / 全局资产 / ' + (pbKind(o) === '场景' ? '场景' : pbKind(o)) + ' 里还没有图。'
      : tab === '这一段的' ? '资产 / ' + segName(o.s.段) + ' 里还没有图。空镜、关键帧、参考图放进去（可以再分一层文件夹，比如「空镜」「关键帧」），这里就有。'
        : tab === '删掉的' ? '没有删掉的图。' : '';
/* 点了按钮（或点两下）：做选中的那一样。给一行挑、给一格挑的做完就收起；加出场的不收，能接着加 */
async function go1() {
  const o = PB.o, list = PB.tab === '画布上的' ? [] : pbItems(o, PB.tab), it = list.find(x => x.id === PB.sel), act = it && !it.used ? pbAct(o, it) : null;
  if (!act || PB.busy) return;
  PB.busy = true;
  try {
    const msg = await act.run();
    if (!msg) return;
    toast(msg);
    PB.sel = '';
    if (o.mode !== 'add') pbClose();
    else pbPaint();
    paint();
  } finally { PB.busy = false; if (PB.el) pbPaint(); }
}
async function pbNew(o) {
  const s = o.s;
  if (o.k === '场景') { await addSceneLine(s); }
  else { const n = await entryDlg(KIND[o.k]); if (n && !s[o.k].includes(n)) { s[o.k].push(n); orderCast(s); touch(); } }
  try { F.pool = await loadPool(F.name); } catch (e) { /* 下回再读 */ }
  paint(); pbPaint();
}
/* 从电脑里找：找到、起好名字，复制进项目（电脑找图.js），再照这一栏挑给谁那样用上 */
async function pbPc(o) {
  hideHov();
  const k = pbKind(o), r = await pcFind({ s: o.s, k, row: o.row || null });
  if (!r) return;
  window.UI.dropThumbs();
  try { F.pool = await loadPool(F.name); } catch (e) { /* 下回再读 */ }
  try { PB.mine = await loadSegPool(F.name, o.s.段); } catch (e) { /* 同上 */ }
  await loadSides();
  toast('复制进来了：' + r.file.replace(/\//g, ' / '));
  const x = r.seg ? PB.mine.find(m => m.文件 === r.file) : F.pool.find(p => p.文件 === r.file);
  if (x) {
    const it = { id: (r.seg ? 'seg:' : 'pool:') + x.文件, kind: r.seg ? 'seg' : 'pool', name: x.名称, file: x.文件, x };
    const act = o.mode === 'add' && r.seg ? { run: async () => useSeg(o.s, r.kind, x) } : pbAct(o, it);
    const msg = act ? await act.run() : null;
    if (msg) { toast(msg); if (o.mode !== 'add') { pbClose(); paint(); return; } }
  }
  paint(); pbPaint();
}
/* 打开（已经开着就换成新的这一样）。o：{ s, mode: row|text|slot|add, k, row（给哪一行挑：资产格子那一样）, text（文字写的场景那一句）, slot: { no, 刻 } } */
async function pbOpen(o) {
  closePop(); hideHov();
  const same = PB.o && PB.o.mode === o.mode && PB.o.k === o.k;
  PB.o = o; PB.sel = '';
  if (!same) { PB.tab = ''; PB.q = ''; }
  if (!PB.el) {
    PB.el = h('aside', { class: 'pb', role: 'dialog', 'aria-label': '挑图' });
    PB.search = h('input', { class: 'inp pb-q', type: 'search', placeholder: '搜名字…', spellcheck: 'false', oninput: () => { PB.q = PB.search.value; PB.sel = ''; pbPaint(); } });
    document.body.append(PB.el);
    document.addEventListener('keydown', pbKey, true);
    document.body.classList.add('pb-open');
  }
  PB.search.value = PB.q;
  pbPaint();
  CV.paint = pbPaint;
  try { F.pool = await loadPool(F.name); } catch (e) { /* 读不出来就用手里的 */ }   // 页面开着的时候放进来的图（自己拷的、Codex 出的）也要列出来
  try { PB.deleted = await loadDeleted(); } catch (e) { PB.deleted = []; }
  try { PB.mine = await loadSegPool(F.name, o.s.段); } catch (e) { PB.mine = []; }
  if (PB.o === o) { pbPaint(); cvLoad(); }   // 画布上的：不等它，读好了摆进「画布上的」那一页、给本地的图标「画布有」
}
function pbClose() {
  if (!PB.el) return;
  PB.el.remove(); PB.el = null; PB.o = null; PB.sel = '';
  document.removeEventListener('keydown', pbKey, true);
  document.body.classList.remove('pb-open');
  CV.paint = null; clearTimeout(CV.poll);
  hideHov();
}
function pbKey(e) {
  if (e.key !== 'Escape' || isComposing(e) || window.UI.popOpen || document.querySelector('.mask:not(.out)')) return;   // 上面盖着小窗、弹窗：先收它们
  e.preventDefault(); pbClose();
}
/* 页面重画了：开着的这一栏跟着换（这一场的图、在用的变了） */
const pbRefresh = () => { if (PB.el && PB.o) { const s = sceneNow(); if (!s || s.段 !== PB.o.s.段) pbClose(); else { PB.o.s = s; pbPaint(); } } };
window.PickBar = Object.freeze({ open: pbOpen, close: pbClose, refresh: pbRefresh, get on() { return !!PB.el; } });
