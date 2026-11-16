/* ============================================================
   流水线 · 资产 · 一样东西自己的那一页（2026-11-14 他要的：点一样资产，进它自己的一页看字、批字、批准出图；原来那个小窗太黑盒）
   网址：资产.html?p=项目&s=第几场&a=这一样的图（资产/全局资产/人物/老李.png；还没出图的、只用文字写的场景，是它要出的那张图的路径）
     关键帧从提示词那一步点进来的再带 &from=提示词&v=哪一条提示词，看完回提示词。
   一页从上到下：
     走到哪一步（AI 写字 → 你批字 → AI 出图 → 你看图 → 确认可用），眼下该做的那一件；
     左边是字：要撑住什么戏、AI 替你定的（剧本里没写的）、参考图、GEO 底稿（场景）、出图提示词、批注，底下「存」「交给 AI 改」「批准出图」；
     右边是图：现在的图、AI 核图说了什么；出了新图（候选）时旧图、新图并排，各自下面一个钮「用旧图」「用新图」；
     最下面：AI 在这一样上做过的事（每一回的任务书、它的回复都能点开看）、以前的字。
   顶上「上一样」「下一样」；关键帧是「上一张」「下一张」，只在这一场的关键帧里翻，还有「删除」（和资产页那一格的 × 一个做法，11-15 他要的）。
   右下角悬浮的是眼下该做的那一件，和「下一样要你看的」。改了的字离开这一页时自动存上（改之前的那一版收进历史记录），Ctrl+S 也能存。
   写字、出图、候选、确认这些做法和资产格子共用，在 流水线.js「文生资产」那一节；这里只管这一页怎么摆
   ============================================================ */
'use strict';
const AD = { key: '', base: null, mt: '', failMt: '', dirty: false, loading: false, outside: false, els: null, cur: null, hist: null, histKey: '', scan: null, scanKey: '', imgSig: '', logSig: '', picT: '' };
const adMode = () => !!query().a;
const adFrom = () => query().from === '提示词' ? '提示词' : '资产';
const escRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const adLabel = w => (w.frame ? '关键帧' : w.cat) + '「' + (w.frame ? w.stem : w.name + (w.state ? '（' + w.state + '）' : '')) + '」';
const adStamp = w => [F.words.get(w.txt) || 0, w.geo ? F.words.get(w.geo) || 0 : 0, F.words.get(w.note) || 0].join('/');
const adNeedsYou = w => w.step === 'word' || w.step === 'cand' || w.step === 'img';
const relDir = r => { const p = '项目/' + F.name + '/'; return r && r.startsWith(p) ? r.slice(p.length) : ''; };   // 任务记录（从总文件夹算起）→ 项目里的路径

/* 网址里点的那一样：先在这一场的格子里找，找不到再当提示词那一步出的关键帧 */
function adFind(s) {
  const q = query(), a = q.a;
  for (const it of assetsOf(s).list) { const w = wordOf(s, it); if (w && w.img === a) { if (w.frame) w.forPrompt = q.v || (w.rec && w.rec.提示词) || ''; return { it, w }; } }
  const ad = '资产/' + segName(s.段) + '/';
  if (a.startsWith(ad) && !a.slice(ad.length).includes('/')) {
    const stem = baseOf(a);
    if (nameOk(stem) && !/_(候选|白模帧)$/.test(stem)) {
      const w = wordFor(s, '关键帧', stem, a, null);
      w.forPrompt = q.v || (w.rec && w.rec.提示词) || '';
      if (w.hasTxt || w.hasImg || w.hasCand || w.writing || w.drawing) return { it: null, w };
    }
  }
  return null;
}
/* 上一样、下一样用：人物、场景、道具照资产格子的先后排；关键帧只在这一场的关键帧里排（照镜头号） */
const adOrder = (s, w) => { const list = assetsOf(s).list, mine = w.frame ? list.filter(it => it.类别 === '关键帧') : KINDS.flatMap(k => list.filter(it => kindOf(it.类别) === k)); return mine.map(it => ({ it, w: wordOf(s, it) })).filter(x => x.w); };
const adUnit = w => w.frame ? '张' : '样';
/* 这一样眼下在做的 AI 任务、上一回没做成的 */
function adMine(s, w) {
  const key = w.cat + '/' + w.stem;
  return j => (j.事 === '写字' && j.段 === s.段 && (Array.isArray(j.只) && j.只.length ? j.只.includes(key) : !w.frame && !w.hasTxt && !w.hasImg))
    || (j.事 === '按批注改字' && j.名 === w.stem) || ((j.事 === '出图' || j.事 === '改图') && j.类别 === w.cat && j.文件名 === w.stem) || (j.事 === '核GEO' && j.名 === w.stem);
}
const adJobs = (s, w) => AI.jobs.filter(j => jobLive(j) && adMine(s, w)(j));
function adFailed(s, w) {
  const j = AI.jobs.filter(adMine(s, w)).pop();
  return j && j.状态 === '没成' && Date.now() - j.结束 < 30 * 60e3 ? j : null;
}

/* ---------- 字：读、填、存 ---------- */
async function adLoad(w) {
  const raw = w.hasTxt ? await readText(w.txt) : '', geo = w.hasGeo ? await readText(w.geo) : '', note = w.hasNote ? await readText(w.note) : '';
  if (raw === null || geo === null || note === null) return null;
  const { head, body } = splitWord(raw), nl = head.find(l => /^要撑住[：:]/.test(l));
  return { head, body, geo: (geo || '').trim(), note: noteBody(note), need: nl ? nl.replace(/^要撑住[：:]\s*/, '').trim() : '' };
}
const adHead = w => ['用途：' + purposeOf(w), ...(w.need ? ['要撑住：' + w.need] : [])];
const adText = (w, head, body) => [...(head.length ? head : adHead(w)), '提示词', body].join('\n') + '\n';
const adVals = () => { const e = AD.els; return { body: e.ta.value.trim(), geo: e.gta ? e.gta.value.trim() : '', note: e.nta.value.trim() }; };
const adChanged = () => { if (!AD.base || !AD.els) return false; const v = adVals(), b = AD.base; return v.body !== b.body || (!!AD.els.gta && v.geo !== b.geo) || v.note !== b.note; };
async function adReload(w) {
  AD.loading = true;
  const mt = adStamp(w), b = await adLoad(w);
  AD.loading = false;
  if (AD.key !== w.img) return;
  if (!b) { AD.failMt = mt; toast('字读不出来，过一会儿再试', 'err'); return; }
  if (AD.base && AD.dirty) { AD.outside = true; adRepaint(); return; }   // 读的时候你又改了：不盖你的，顶上提醒一句
  const e = adEls(w);
  e.ta.value = b.body; if (e.gta) e.gta.value = b.geo; e.nta.value = b.note;
  Object.assign(AD, { base: b, mt, dirty: false, outside: false });
  adRepaint();
}
/* 存上改了的：字、GEO 底稿改之前的那一版收进历史记录（putText）；批注是过程文件，直接盖。quiet：不另外提示 */
async function adSave(s, w, quiet) {
  if (!AD.base || !AD.els) return true;
  const v = adVals(), b = AD.base, stamp = stampNow();
  const ch = { body: v.body !== b.body, geo: !!AD.els.gta && v.geo !== b.geo, note: v.note !== b.note };
  if (!ch.body && !ch.geo && !ch.note) { AD.dirty = false; adPaintActs(); return true; }
  if (ch.body && !v.body) { toast('出图提示词空着，没存：不要这一样，回资产页点那一格的 ×', 'err'); return false; }
  if (ch.geo && !v.geo) { toast('GEO 底稿空着，没存', 'err'); return false; }
  try {
    if (ch.body) await putText(w.txt, adText(w, b.head, v.body), stamp);
    if (ch.geo) await putText(w.geo, v.geo + '\n', stamp);
    if (ch.note) {
      if (v.note) await FS.write(at([F.name, ...w.note.split('/')]), C.encodeText('# 字的批注｜' + w.stem + '\n文件：' + w.txt + '\n\n## 整体\n' + v.note + '\n'));
      else if (w.hasNote) await archiveFile(w.note, stamp);
    }
  } catch (e) { toast('没存上：' + e.message, 'err'); return false; }
  AD.base = { ...b, body: v.body, geo: AD.els.gta ? v.geo : b.geo, note: v.note, head: ch.body && !b.head.length ? adHead(w) : b.head };
  AD.dirty = adChanged();
  await loadSides();
  const r = adFind(s);
  if (r) AD.mt = adStamp(r.w);   // 自己存的不算「外面改过」
  if (!quiet) toast('存上了' + (ch.body || ch.geo ? '，改之前的那一版收进了历史记录' : ''));
  adRepaint();
  return true;
}
async function adLeave() {   // 换页前（go）：没存的先存上，存不上就不走
  const c = AD.cur;
  if (!c || !AD.dirty) return;
  if (!(await adSave(c.s, c.w, true))) throw new Error('字没存上');
}
window.addEventListener('beforeunload', e => { if (adMode() && AD.dirty) { e.preventDefault(); e.returnValue = ''; } });
document.addEventListener('keydown', e => { if (adMode() && (e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && AD.cur) { e.preventDefault(); adSave(AD.cur.s, AD.cur.w); } });

/* ---------- 几样事：写字、交给 AI 改、批准出图、确认、候选 ---------- */
async function adWrite(s, w, self) {   // 还没有字：让 AI 写（批注框里写的当要求）。self：自己交给 AI
  if (!(await adSave(s, w, true))) return;
  if (w.frame && AD.base) w.refs = headRefs(AD.base.head).map(r => r.file);   // 关键帧重写：参考图照字开头那几行
  if (await askWords(s, [w], AD.els ? AD.els.nta.value.trim() : '', self)) await pageRepaint();
}
async function adAskFix(s, w, self) {   // 有字：照批注改，只改说到的地方
  const note = AD.els.nta.value.trim();
  if (!note) { toast('先在批注里写哪里不对，再交给 AI 改', 'err'); AD.els.nta.focus(); return; }
  if (!(await adSave(s, w, true))) return;
  if (await (self ? startSelf : startJob)({ 事: '按批注改字', 段: s.段, 参数: { 字: w.txt } })) await pageRepaint();
}
async function adDraw(s, w) {   // 批准出图：照现在的字交给 Codex，一次一张；已经有图的，新图先当候选
  const v = adVals();
  if (!w.hasTxt && !v.body) { toast('还没有字：先让 AI 写，或者自己写好点「存」', 'err'); return; }
  const bad = w.frame && AD.base ? unconfirmedRefs(AD.base.head) : [];   // 关键帧：用到的人物、场景、道具图都确认可用了再出
  if (bad.length) { toast('这几张参考图还没确认可用：' + bad.map(x => '图' + x.n + '（' + baseOf(x.file) + '）').join('、') + '。先到资产那一步确认，再出这一帧', 'err'); return; }
  if (v.note && !(await confirmDlg({ title: '批注还没交给 AI', body: '批注里写的「' + v.note.slice(0, 40) + '」还没照着改。照现在的字出图？', ok: '照现在的字出' }))) return;
  if (!(await adSave(s, w, true))) return;
  if (await askDraw(s, w)) await pageRepaint();
}
/* 删掉这张关键帧：和资产页那一格的 × 一个做法（removeAsset）。删完去下一张，没有就去上一张，都没有就回到来的那一步 */
async function adDelete(s, it, w) {
  const list = adOrder(s, w), i = list.findIndex(x => x.w.img === w.img), to = list[i + 1] || list[i - 1];
  const cell = it || { 类别: '关键帧', 名称: w.stem, sub: '', at: w.img, 文件: w.img, own: true };   // 提示词那一步加的、资产格子里没有的
  if (!(await removeAsset(s, cell, true))) return;
  if (to) openWord(s, to.w); else go(adFrom(), { s: s.段 });
}
async function adEditImg(s, w) { if (await askEditImg(s, w)) await pageRepaint(); }
async function adConfirm(s, it, w, on) {
  if (it && it.at) confirmImg(s, it, on); else confirmW(s, w, on);
  await flush(); adRepaint();
  toast(on ? adLabel(w) + ' 确认可用了' : '取消了确认');
}
async function adUseCand(s, it, w) {
  if (!(await takeCand(w))) return;
  await pageRepaint();
}
async function adNoCand(s, w) { if (await dropCand(w)) await pageRepaint(); }
async function adUseScene(s, it, w) { useSceneImg(s, it.文字, w.img); await flush(); adRepaint(); toast('这一场改用「' + w.stem + '」这张图了'); }
/* 照图核 GEO（11-14 他要的）：图你满意了，让 AI 先判断 GEO 底稿和图对不对得上，对不上才照图改（改之前的那一版收进历史记录）。
   确认可用时自动核过一回；这里是你想再核一遍的时候点（比如自己改过底稿）。框里改了没存的先存上，AI 照存上的那一版核 */
async function adGeoCheck(s, w) {
  if (!(await adSave(s, w, true))) return;
  if (await startJob({ 事: '核GEO', 段: s.段, 参数: { 图: w.img } })) await pageRepaint();
}
/* 看一回 AI 任务留下的记录：任务书、它的回复（历史记录/AI任务/时间_事_第N段/ 里的几份） */
const RUN_LAB = { '任务书.md': '交给 AI 的任务书', '答卷.md': 'AI 的回复', '交给AI的话.txt': '交给 AI 的话', '回复.md': 'AI 写回来的', '交给AI的话_核图.txt': '核图时交给 AI 的话', '回复_核图.md': '核图时 AI 写回来的','发给Codex的话.txt': '对 Codex 说的话', 'Codex的回复.md': 'Codex 的回复', '任务书_核图.md': '核图的任务书', '答卷_核图.md': '核图时 AI 说的', '答卷_原样.md': 'AI 的原样回复' };
const RUN_ORDER = Object.keys(RUN_LAB);
async function adShowRun(dir, title) {
  let ents;
  try { ents = await FS.list(at([F.name, ...dir.split('/')])); } catch (e) { toast('这一回的记录打不开：' + e.message, 'err'); return; }
  const rank = n => { const i = RUN_ORDER.indexOf(n); return i < 0 ? 99 : i; };
  const names = ents.filter(e => e.kind === 'file' && /\.(md|txt)$/i.test(e.name)).map(e => e.name).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  await dialog(close => dlgShell(title, dir.split('/').join(' / '),
    [h('p', { class: 'fn-note' }, '这一回交给 AI 的话、它的回复都在这里，点一份打开看（只看，不改）。'),
      h('div', { class: 'ad-files' }, names.length ? names.map(n => h('button', { class: 'btn sm', type: 'button', onclick: () => { close(); showText(at([F.name, ...dir.split('/'), n])); } }, RUN_LAB[n] || n)) : h('p', { class: 'fn-note' }, '这一回的记录不在了'))],
    [h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close() }, '好了')]));
}
/* 以前的字、GEO 底稿：历史记录里同一处、名字后面带 __时间 的 */
async function adHist(w) {
  const key = w.txt + '@' + adStamp(w);
  if (AD.histKey === key) return;
  AD.histKey = key;
  const dir = w.txt.split('/').slice(0, -1), one = (n, re) => { const m = re.exec(n); return m ? { n, t: m[1], tx: m[1].slice(4, 6) + '-' + m[1].slice(6, 8) + ' ' + m[2].slice(0, 2) + ':' + m[2].slice(2, 4) } : null; };
  let ents = [];
  try { ents = await FS.list(at([F.name, '历史记录', ...dir])); } catch (e) { ents = []; }
  const reT = new RegExp('^' + escRe(w.stem) + '_提示词__(\\d{8})-(\\d{6})(?:_\\d+)?\\.txt$'), reG = new RegExp('^' + escRe(w.stem) + '_GEO底稿__(\\d{8})-(\\d{6})(?:_\\d+)?\\.md$');
  const files = ents.filter(e => e.kind === 'file').map(e => e.name), sort = a => a.filter(Boolean).sort((x, y) => (y.t + y.tx).localeCompare(x.t + x.tx)).slice(0, 8);
  AD.hist = { dir: ['历史记录', ...dir], txt: sort(files.map(n => one(n, reT))), geo: w.geo ? sort(files.map(n => one(n, reG))) : [] };
  adRepaint();
}
/* 以前没记「AI 做过的事」的（11-14 以前写的字、出的图）：翻 历史记录/AI任务 里这一场的写字、出图、改图，认出是这一样的那几回 */
async function adScan(s, w) {
  const key = s.段 + '|' + w.cat + '/' + w.stem;
  if (AD.scanKey === key) return;
  AD.scanKey = key; AD.scan = null;
  let ents = [];
  try { ents = await FS.list(at([F.name, '历史记录', 'AI任务'])); } catch (e) { AD.scan = []; adRepaint(); return; }
  const re = new RegExp('^(\\d{8})-(\\d{6})_(写字|出图|改图)_第' + escRe(s.段) + '段$'), tag = '【' + w.cat + '｜' + w.name + (w.state ? '｜' + w.state : '') + '】', out = [];
  const dirs = ents.filter(e => e.kind === 'directory' && re.test(e.name)).map(e => e.name).sort().reverse().slice(0, 20);
  const known = new Set((w.rec && Array.isArray(w.rec.过程) ? w.rec.过程 : []).map(x => x.目录));   // 「过程」里记了的不用再翻
  for (const d of dirs) {
    const m = re.exec(d), base = '历史记录/AI任务/' + d;
    if (known.has(base)) continue;
    let hit = false;
    if (m[3] === '写字') { const t = await readText(base + '/任务书.md'); hit = !!t && (t.split('## 要写的这几样')[1] || '').split('\n## ')[0].includes(tag); }
    else { const t = await readText(base + '/发给Codex的话.txt') || await readText(base + '/交给AI的话.txt'); hit =!!t && t.replace(/\\/g, '/').includes('/' + F.name + '/' + (m[3] === '出图' ? w.txt : w.img)); }
    if (hit) out.push({ 时间: m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6) + ' ' + m[2].slice(0, 2) + ':' + m[2].slice(2, 4) + ':' + m[2].slice(4), 事: m[3] === '改图' ? '照批注改图' : m[3], 渠道: '', 目录: base });
    if (out.length >= 8) break;
  }
  if (AD.scanKey !== key) return;
  AD.scan = out;
  adRepaint();
}

/* ---------- 摆出来 ---------- */
/* 标题那一行（上一张、下一张、删除）钉在步骤条下面，往下滚也看得见（11-15 他要的）。步骤条窄了会折成两行，钉的高度跟着量；钉住时底下一道线 */
function adPin() {
  const st = document.getElementById('wf-steps'), head = document.getElementById('ad-head');
  if (!head) return;
  const pin = st ? (parseFloat(getComputedStyle(st).top) || 0) + st.offsetHeight : 0;
  head.style.top = pin + 'px';
  head.classList.toggle('stuck', head.getBoundingClientRect().top <= pin + 1);
}
window.addEventListener('scroll', () => { if (adMode()) adPin(); }, { passive: true });
window.addEventListener('resize', () => { if (adMode()) adPin(); });
const AD_TRACK = ['AI 写字', '你批字', 'AI 出图', '你看图', '确认可用'];
function adTrackEls(w) {
  const at0 = { none: 0, 'ai-word': 0, word: 1, 'ai-img': 2, cand: 3, img: 3, ok: 5 }[w.step], ai = w.step === 'ai-word' || w.step === 'ai-img';
  return AD_TRACK.map((t, i) => [i ? h('span', { class: 'wf-arrow' }, '→') : null,
    h('span', { class: 'ad-st ' + (i < at0 ? 'ok' : i === at0 ? (ai ? 'ai' : 'you') : 'lock') }, h('i', null, i < at0 ? icon('check') : String(i + 1)), t)]);
}
function adHeadEls(s, it, w) {
  const from = adFrom(), list = adOrder(s, w), i = list.findIndex(x => x.w.img === w.img), u = adUnit(w);
  const prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null, users = w.frame ? [] : usersOf(w.img);
  const where = ['第' + s.段 + '场', w.frame && w.forPrompt ? vpLabel(w.forPrompt) + '的一刻' : '', users.length > 1 ? '用在 ' + users.map(x => '第' + x + '场').join('、') : ''].filter(Boolean).join(' · ');
  return [h('button', { class: 'btn sm ghost', type: 'button', onclick: () => go(from, { s: s.段 }) }, '← 回到' + from),
    h('div', { class: 'ad-title ' + kindCls(w.frame ? '关键帧' : w.cat) }, h('b', null, adLabel(w)), h('small', null, where)),
    h('span', { class: 'sp' }),
    list.length > 1 && i >= 0 ? h('span', { class: 'fn-note' }, '这一场第 ' + (i + 1) + ' / ' + list.length + ' ' + u) : null,
    prev ? h('button', { class: 'btn sm ghost', type: 'button', title: adLabel(prev.w), onclick: () => openWord(s, prev.w) }, '← 上一' + u) : null,
    next ? h('button', { class: 'btn sm ghost', type: 'button', title: adLabel(next.w), onclick: () => openWord(s, next.w) }, '下一' + u + ' →') : null,
    w.frame && w.hasImg ? h('button', { class: 'btn sm', type: 'button', disabled: adBusy(s, w), title: '删掉这张关键帧：只是这一场不用，或者图也不要了（移进历史记录）', onclick: () => adDelete(s, it, w) }, icon('x'), '删除') : null];
}
function adNowEls(s, it, w, jobs) {
  const txtScene = !!(it && it.文字 && w.hasImg);
  let t = { none: '还没写字。点「让 ' + chName() + ' 写字」，AI 读定稿的剧本，写清它要撑住什么戏，再写出图提示词' + (w.cat === '场景' ? '（场景先写 GEO 底稿）' : '') + '。也可以自己写，点「存」。',
    'ai-word': 'AI 在写字，写好了左边自动换上。',
    word: '字写好了，等你批。看一遍「要撑住」「AI 替你定的」和出图提示词：行就点「批准出图」；不行就写批注，点「交给 AI 改」，或者自己改了点「存」。',
    'ai-img': 'Codex 在出图，一次一张。出好了 AI 照字核一遍。',
    cand: w.hasImg ? '出了一张新图。和旧图比一比，在图下面挑：「用旧图」还是「用新图」。' : '出了一张新图。能用就点图下面「用新图」，不能用点「不要新图」。',
    img: '图出好了，等你看。能用就点「确认可用」；要改，点图框出来写批注，再点「照批注改图」，或者改字后点「批准出图」重出。',
    ok: '这张图确认可用了。要改：改字后点「批准出图」，新图出来和这张并排，你挑用哪张。' }[w.step];
  if (txtScene && w.step !== 'cand') t = '图出好了：点「用上这张图」，这一场改用图（全片设定里那一句还在）。不满意就照批注改图，或者改字重出。';
  if (w.step === 'img' && checkBad(w.checkImg)) t += 'AI 核图说有问题，看右边它怎么说。';
  if (w.step === 'ok' && !txtScene && w.cat === '场景' && w.hasGeo) t += '图和 GEO 底稿对不上，点右边「照图核 GEO」：AI 先判断要不要改，对不上才改。';
  if (w.geoBack) t += 'AI 照图核了 GEO，说要拿回去批图：' + w.geoBack;
  const hj = jobs.find(j => j.交给 && j.状态 === '在做');   // 在等交给 AI 的回复：给我提示词、Claude 桌面版、DeepSeek 窗口
  if (hj) t = { self: '等你把任务交给 AI：点下面「交给 AI 的话」，复制，贴进你自己开的对话' + (hj.事 === '出图' || hj.事 === '改图' ? '（出图、改图要贴进 Codex）' : '') + '。它做完，这里自动接着做。',
    claude: hj.交给.等 === '发送' ? '在 Claude 桌面版开了一个新对话，任务填好了：到 Claude 窗口里按发送。没看到就点下面「再开一次」。' : 'Claude 在做，在 Claude 窗口里看。它做完，这里自动接着做。',
    deepseek: 'DeepSeek 在它自己的窗口里做，做完这里自动接着做。' }[hj.交给.方式] || t;
  const bad = jobs.length ? null : adFailed(s, w), codex = jobs.some(j => j.渠道 === 'codex' || j.事 === '出图' || j.事 === '改图');
  const cls = jobs.length || w.step === 'ai-word' || w.step === 'ai-img' ? 'ai' : w.step === 'ok' && !txtScene ? 'ok' : 'you';
  return h('div', { class: 'ad-now ' + cls }, h('b', null, '眼下'), h('span', null, t),
    jobs.map(j => h('div', { class: 'ad-job' }, jobLine(j), h('span', { class: 'fn-note' }, j.标题))),
    codex ? h('span', { class: 'fn-note' }, 'Codex 会开一个看得见的对话，在 Codex 里能看它这会儿在做什么。') : null,
    bad ? h('div', { class: 'ad-job' }, h('span', { class: 'fn-note warn' }, '上一回' + (bad.事 === '出图' || bad.事 === '改图' ? ' Codex ' : ' ' + bad.渠道名 + ' ') + '没做成：' + bad.错误), relDir(bad.记录) ? h('button', { class: 'fl-link', type: 'button', onclick: () => adShowRun(relDir(bad.记录), bad.标题) }, '看过程') : null) : null);
}
const adRow = (lab, hint, body, warn) => h('div', { class: 'ad-row' + (warn ? ' warn' : '') }, h('b', null, lab, hint ? h('span', null, hint) : null), body);
function adInfoEls(s, w) {
  const b = AD.base, need = (b && b.need) || w.need, mine = w.rec && Array.isArray(w.rec.替人定的) ? w.rec.替人定的 : [];
  const head = b ? b.head : [], refs = headRefs(head), other = head.filter(l => !/^(用途|要撑住)[：:]/.test(l) && !headRefs([l]).length);
  const refEl = r => {
    const bm = BMF_RE.test(r.file), ok = bm || markOk(r.file, 0), el = h('button', { class: 'fl-asset ' + (bm ? 'k-zhen' : kindCls(r.file.startsWith('资产/全局资产/') && KINDS.includes(r.file.split('/')[2]) ? r.file.split('/')[2] : '')), type: 'button', title: r.file + '\n点一下看大图', onclick: () => openImage(r.file) },
      thumbImg(r.file), h('span', { class: 'nm' }, '图' + r.n + ' ' + (bm ? '白模这一刻' : baseOf(r.file)), h('small', null, ok ? (bm ? '构图、站位照它' : '确认过可用') : '还没确认可用')));
    if (!ok) el.classList.add('wd-bad');
    return el;
  };
  return [need ? adRow('要撑住', '这一场的戏要它做到什么。AI 读定稿的剧本写的，出图、核图都照它', need) : null,
    mine.length ? adRow('AI 替你定的', '剧本里没写、AI 替你拿的主意。不行就写在批注里', h('ul', null, mine.map(x => h('li', null, x)))) : null,
    refs.length ? adRow('参考图', '出图时一起交给 Codex，样子照它们', h('div', { class: 'ad-refs' }, refs.map(refEl)), refs.some(r => !BMF_RE.test(r.file) && !markOk(r.file, 0))) : null,
    other.length ? adRow('开头另外写的', '', other.join('\n')) : null];
}
/* 左边字那一块：框子只做一次（打字时不重做，光标不丢），会变的几样另外换 */
function adEls(w) {
  if (AD.els && AD.els.for === w.img) return AD.els;
  const mark = () => { AD.dirty = adChanged(); adPaintActs(); };
  const ta = h('textarea', { class: 'fl-ta ad-ta', spellcheck: 'false', placeholder: '出图提示词：画面里有什么、什么样、光从哪来。' });
  const gta = w.geo ? h('textarea', { class: 'fl-ta ad-ta geo', spellcheck: 'false', placeholder: 'GEO 底稿：空间里有什么、各在哪、从哪看得见什么、人往哪走。' }) : null;
  const nta = h('textarea', { class: 'fl-ta sm', spellcheck: 'false' });
  for (const x of [ta, gta, nta]) if (x) x.addEventListener('input', mark);
  const sub = h('div', { class: 'ad-sub' }), info = h('div', { class: 'ad-info' }), ban = h('div'), labTa = h('div', { class: 'ad-lab' }), labNote = h('div', { class: 'ad-lab' }), acts = h('div', { class: 'ad-acts' });
  const col = h('div', null, h('h4', { class: 'ad-h' }, '字', h('small', null, w.txt)), sub, info, ban,
    gta ? [h('div', { class: 'ad-lab' }, h('b', null, 'GEO 底稿'), h('span', null, '场景的空间：什么在哪、从哪看得见什么、人往哪走。只给人审，出图提示词照它写')), gta] : null,
    labTa, ta, labNote, nta, acts);
  AD.els = { for: w.img, ta, gta, nta, sub, info, ban, labTa, labNote, acts, col };
  return AD.els;
}
const adBusy = (s, w) => w.writing || w.drawing || adJobs(s, w).length > 0;
function adPaintActs() {
  const c = AD.cur, e = AD.els;
  if (!c || !e) return;
  const { s, w } = c, busy = adBusy(s, w), has = w.hasTxt || !!e.ta.value.trim(), noted = w.hasTxt && !!e.nta.value.trim();   // 写了批注：「交给 AI 改」当眼下那一件
  e.acts.replaceChildren(...[
    h('button', { class: 'btn', type: 'button', disabled: busy || !AD.dirty, title: '存上你改的（改之前的那一版收进历史记录）。Ctrl+S 也行', onclick: () => adSave(s, w) }, '存'),
    w.hasTxt ? h('button', { class: 'btn' + (noted ? ' ink' : ''), type: 'button', disabled: busy, title: '照批注改：只改你说到的地方', onclick: () => adAskFix(s, w) }, '交给 ' + chName() + ' 改')
      : h('button', { class: 'btn' + (has ? '' : ' ink'), type: 'button', disabled: busy, title: 'AI 读定稿的剧本写这一样的字；批注框里写的当要求', onclick: () => adWrite(s, w) }, '让 ' + chName() + ' 写字'),
    h('button', { class: 'btn' + (has && !noted && (w.step === 'word' || w.step === 'none') ? ' ink' : ''), type: 'button', disabled: busy || !has, title: '字定了：交给 Codex 照这份字出图，一次一张' + (w.hasImg ? '；已经有图，新图先当候选' : ''), onclick: () => adDraw(s, w) }, '批准出图'),
    h('span', { class: 'sp' }),
    busy ? h('span', { class: 'fn-note' }, 'AI 在做这一样，做完再改') : AD.dirty ? h('span', { class: 'ad-dirty' }, '改了还没存（离开这一页会自动存）') : null].filter(Boolean));
}
function adPaintWord(s, it, w) {
  const e = adEls(w), box = document.getElementById('ad-word');
  if (box && e.col.parentNode !== box) box.replaceChildren(e.col);
  const b = AD.base, purpose = b && b.head.find(l => /^用途[：:]/.test(l));
  e.sub.textContent = purpose ? purpose.replace(/^用途[：:]\s*/, '用途：') : '用途：' + purposeOf(w);
  e.info.replaceChildren(...adInfoEls(s, w).filter(Boolean));
  e.ban.replaceChildren(...(AD.outside ? [h('div', { class: 'ad-ban' }, '这一样的字在外面改过了（AI 改好了新的一版？）。你这边改的还没存。',
    h('button', { class: 'btn sm', type: 'button', onclick: () => { AD.dirty = false; AD.outside = false; adReload(w); } }, '换成新的（丢掉我没存的）'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { AD.outside = false; AD.mt = adStamp(w); adRepaint(); } }, '留着我的'))] : []));
  e.labTa.replaceChildren(h('b', null, '出图提示词'), h('span', null, w.hasTxt ? '批准出图时一字不改交给 Codex' : b ? '还没写：点「让 ' + chName() + ' 写字」，或者自己写了点「存」' : '在读…'));
  e.labNote.replaceChildren(h('b', null, w.hasTxt ? '批注' : '给 AI 的要求'), h('span', null, w.hasTxt ? '哪里不对写这里，点「交给 ' + chName() + ' 改」：只改你说到的地方，改之前的那一版收进历史记录' : '可以不写，AI 照定稿的剧本写'));
  e.nta.placeholder = w.hasTxt ? '比如：衣服换成旧的蓝色工装；桌上再乱一点' : '比如：四十岁，瘦，熬夜熬出来的黑眼圈';
  const ro = !b || adBusy(s, w);
  for (const x of [e.ta, e.gta, e.nta]) if (x) x.readOnly = ro;
  adPaintActs();
}
function adImgEls(s, it, w) {
  const out = [h('h4', { class: 'ad-h' }, '图', h('small', null, w.img))];
  const fig = (file, cap, acts) => h('figure', { class: 'ad-fig' }, h('button', { class: 'ad-pic', type: 'button', title: '点开看大图' + (acts ? '，能框出来写批注' : ''), onclick: () => openImage(file, acts) }, thumbImg(file, 900)), h('figcaption', null, cap));
  const note = (lab, t, warn) => h('p', { class: 'ad-note' + (warn ? ' warn' : '') }, h('b', null, lab + '：'), t);
  const busy = adBusy(s, w);
  if (w.hasCand) {   // 出了新图：旧图、新图并排，各自下面一个钮，用哪张点哪张下面的（11-15 他说「用这张」分不清是哪张）
    const users = w.frame ? [] : usersOf(w.img), old = w.hasImg;
    const noBtn = h('button', { class: 'btn', type: 'button', disabled: busy, title: old ? '用旧图：新图收进历史记录' : '不要新图：收进历史记录', onclick: () => adNoCand(s, w) }, old ? '用旧图' : '不要新图');
    const useBtn = h('button', { class: 'btn ink', type: 'button', disabled: busy, title: '用新图：' + (old ? '旧图连它的批注收进历史记录，' : '') + '新图算确认可用', onclick: () => adUseCand(s, it, w) }, '用新图');
    const pick = (file, cap, which, btns) => h('figure', { class: 'ad-fig' }, h('button', { class: 'ad-pic', type: 'button', title: '点开看大图', onclick: () => openImage(file, candActs(s, it, w, which)) }, thumbImg(file, 900)),
      h('figcaption', null, cap), h('div', { class: 'ad-use' }, btns));
    out.push(h('div', { class: 'ad-pair' }, old ? pick(w.img, '旧图 · 现在用着', 'old', [noBtn]) : null, pick(w.cand, old ? '新图 · 刚出的' : '新图', 'new', old ? [useBtn] : [noBtn, useBtn])));
    if (w.checkCand) out.push(note('AI 核图（新图）', w.checkCand, checkBad(w.checkCand)));
    out.push(note(users.length > 1 ? '共用' : '挑一张', users.length > 1 ? users.map(x => '第' + x + '场').join('、') + '都在用旧图：点「用新图」，几场一起换，用到它的提示词、样片标「待核对」' : old ? '两张挑一张用，没挑中的收进历史记录' : '不要的话，新图收进历史记录', users.length > 1));
  } else if (w.hasImg) {
    const ok = imgOk(it, w), txtScene = !!(it && it.文字);
    out.push(fig(w.img, ok ? '确认过可用 · 点开看大图、写批注' : '还没确认 · 点开看大图、写批注', shellActs(s, it, w)));
    if (w.checkImg) out.push(note('AI 核图', w.checkImg, checkBad(w.checkImg)));
    if (w.geoNote) out.push(note('照图核 GEO', w.geoNote + (w.geoBack ? '。要拿回去批图：' + w.geoBack : ''), !!w.geoBack));
    if (w.hasImgNote) out.push(note('图上的批注', '写好了，还没交给 Codex 照着改', true));
    out.push(h('div', { class: 'ad-acts' },
      txtScene ? h('button', { class: 'btn ink', type: 'button', onclick: () => adUseScene(s, it, w) }, '用上这张图') : null,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => openImage(w.img, shellActs(s, it, w)) }, '看大图、写批注'),
      h('button', { class: 'btn' + (w.hasImgNote && !txtScene ? ' ink' : ''), type: 'button', disabled: busy, title: '先点开图、框出来写好批注，再点这里：Codex 以这张为底只改你说到的地方，改出来的先当候选', onclick: () => adEditImg(s, w) }, '照批注改图'),
      txtScene ? null : ok ? h('button', { class: 'btn ghost', type: 'button', title: '确认的时间：' + (F.doc.可用[w.img] || '') + '。点一下取消', onclick: () => adConfirm(s, it, w, false) }, icon('check'), '确认过可用')
        : h('button', { class: 'btn' + (w.hasImgNote ? '' : ' ink'), type: 'button', disabled: busy, title: '这张图看过了、能用。确认过的图，别的场不用再确认', onclick: () => adConfirm(s, it, w, true) }, icon('check'), '确认可用'),
      ok && !txtScene && w.cat === '场景' && w.hasGeo ? h('button', { class: 'btn', type: 'button', disabled: busy, title: '图你满意了：让 AI 先判断 GEO 底稿和图对不对得上，对不上才照图改（改之前的那一版收进历史记录）。左边框里改了没存的，先存上再核', onclick: () => adGeoCheck(s, w) }, '照图核 GEO') : null));
  } else {
    out.push(h('div', { class: 'ad-ph' }, w.drawing ? [h('i', { class: 'wt-ring' }), h('span', { class: 'wt-t' }, 'Codex 在出图，出好了在这里')] : w.hasTxt || w.step === 'word' ? '还没出图：字批好了点「批准出图」，Codex 一次出一张' : '还没出图：先有字，你批过点「批准出图」'));
    if (it && KIND[it.类别] && it.own && !w.hasTxt && !w.writing) out.push(h('p', { class: 'fn-note' }, '已经有现成的图？', h('button', { class: 'fl-link', type: 'button', onclick: () => go('资产', { s: s.段 }, 'pick=' + it.类别 + '/' + it.名称) }, '回资产页挑一张')));
  }
  return out;
}
function adLogEls(s, w) {
  const rec = w.rec && Array.isArray(w.rec.过程) ? w.rec.过程 : [], seen = new Set(rec.map(x => x.目录));
  const all = [...rec, ...(AD.scan || []).filter(x => !seen.has(x.目录))].sort((a, b) => String(b.时间).localeCompare(String(a.时间))).slice(0, 12), H = AD.hist;
  const chip = (x, kind) => h('button', { class: 'btn sm ghost', type: 'button', title: x.n + '\n点一下看那一版', onclick: () => showText(at([F.name, ...H.dir, x.n])) }, kind + ' ' + x.tx);
  return [h('h4', { class: 'ad-h' }, 'AI 在这一样上做过的事', h('small', null, '每一回交给 AI 的任务书、它的回复都留在 历史记录 / AI任务 里')),
    all.length ? h('ol', { class: 'ad-steps' }, all.map(x => h('li', null, h('span', { class: 'ad-t' }, String(x.时间).slice(5, 16)), h('b', null, x.事), x.渠道 ? h('span', { class: 'fn-note' }, x.渠道) : null,
      x.目录 ? h('button', { class: 'fl-link', type: 'button', onclick: () => adShowRun(x.目录, x.事 + ' · ' + String(x.时间).slice(5, 16)) }, '看过程：任务书、回复') : null)))
      : h('p', { class: 'fn-note' }, !rec.length && AD.scan === null ? '在找以前的记录…' : '还没有记录：AI 写过字、出过图，这里就有一行。'),
    H && (H.txt.length || H.geo.length) ? h('div', { class: 'ad-hist' }, h('span', { class: 'fn-note' }, '以前的版本（收在历史记录里，点一下看）：'), H.txt.map(x => chip(x, '字')), H.geo.map(x => chip(x, 'GEO'))) : null];
}
function adFabEls(s, it, w) {
  const list = adOrder(s, w), i = list.findIndex(x => x.w.img === w.img);
  const todo = i >= 0 ? [...list.slice(i + 1), ...list.slice(0, i)].find(x => adNeedsYou(x.w)) : null, from = adFrom();
  const more = ink => todo ? h('button', { class: 'btn' + (ink ? ' ink' : ' sub'), type: 'button', title: adLabel(todo.w) + '：' + WORD_TX[todo.w.step], onclick: () => openWord(s, todo.w) }, '下一' + adUnit(w) + '要你看的 →')
    : h('button', { class: 'btn' + (ink ? ' ink' : ' sub'), type: 'button', onclick: () => go(from, { s: s.段 }) }, '回到' + from + ' →');
  if (adBusy(s, w)) return [h('div', { class: 'wf-fab-note' }, 'AI 在做这一样，做完这里自动换'), more(false)];
  if (it && it.文字 && w.hasImg && w.step !== 'cand') return [more(false), h('button', { class: 'btn ink', type: 'button', onclick: () => adUseScene(s, it, w) }, '用上这张图')];
  if (w.step === 'none') return [more(false), h('button', { class: 'btn ink', type: 'button', onclick: () => adWrite(s, w) }, '让 ' + chName() + ' 写字')];
  if (w.step === 'word') return [more(false), h('button', { class: 'btn ink', type: 'button', onclick: () => adDraw(s, w) }, '批准出图')];
  if (w.step === 'cand') return [h('div', { class: 'wf-fab-note' }, w.hasImg ? '用旧图还是新图：点图下面的钮' : '新图用不用：点图下面的钮'), more(false)];   // 挑哪张只在图下面按，这里不再摆
  if (w.step === 'img') return [more(false), h('button', { class: 'btn ink', type: 'button', onclick: () => adConfirm(s, it, w, true) }, icon('check'), '确认可用')];
  return [more(true)];
}
/* 只换会变的几块：字的框子不重做（正在写的字、光标都留着），图和记录变了才重做 */
function adRepaint() {
  const s = sceneNow(), root = document.getElementById('ad'), fab = document.getElementById('ad-fab');
  if (!s || !root || assetState(s).st === 'lock') return false;
  const r = adFind(s);
  if (!r) {
    const from = adFrom();
    root.replaceChildren(h('div', { class: 'wf-lock' }, '这一样不在第' + s.段 + '场里了：改了名、换了图，或者这一场不用它了。', h('button', { class: 'btn ink', type: 'button', onclick: () => go(from, { s: s.段 }) }, '← 回到' + from)));
    if (fab) fab.replaceChildren();
    AD.cur = null;
    return;
  }
  if (!document.getElementById('ad-head')) return false;   // 刚才「不在了」那一句把架子换掉了：整页重画
  const { it, w } = r, jobs = adJobs(s, w);
  AD.cur = { s, it, w };
  document.title = '流水线 · ' + adLabel(w);
  if (AD.key !== w.img) Object.assign(AD, { key: w.img, base: null, mt: '', failMt: '', dirty: false, outside: false, hist: null, histKey: '', imgSig: '', logSig: '' });
  const stamp = adStamp(w);
  if (!AD.loading && (!AD.base ? AD.failMt !== stamp : stamp !== AD.mt && !AD.outside)) { if (!AD.base || !AD.dirty) adReload(w); else AD.outside = true; }   // 字在外面改过：没改就换上，改了就提醒
  adHist(w);
  adScan(s, w);   // 以前没记进「过程」的那几回（一页只翻一次），和记了的合在一起摆
  const pt = [F.words.get(w.cand) || 0, fileTimeOf(w.img)].join('/');
  if (AD.picT && AD.picT !== pt) window.UI.dropThumbs();   // 图重出过、候选换了一张：缩小图重做
  AD.picT = pt;
  document.getElementById('ad-head').replaceChildren(...adHeadEls(s, it, w).filter(Boolean));
  adPin();
  document.getElementById('ad-track').replaceChildren(...adTrackEls(w).flat().filter(Boolean));
  document.getElementById('ad-now').replaceChildren(adNowEls(s, it, w, jobs));
  adPaintWord(s, it, w);
  const isig = [w.step, w.hasImg, w.hasCand, w.checkImg, w.checkCand, w.geoNote, w.geoBack, w.hasImgNote, imgOk(it, w), adBusy(s, w), pt, F.doc.可用[w.img] || ''].join('|');
  if (isig !== AD.imgSig) { AD.imgSig = isig; document.getElementById('ad-img').replaceChildren(...adImgEls(s, it, w).filter(Boolean)); }
  const lsig = JSON.stringify([w.rec && w.rec.过程, AD.scan, AD.hist && [AD.hist.txt, AD.hist.geo]]);
  if (lsig !== AD.logSig) { AD.logSig = lsig; document.getElementById('ad-log').replaceChildren(...adLogEls(s, w).filter(Boolean)); }
  if (fab) fab.replaceChildren(...adFabEls(s, it, w).filter(Boolean));
  paintSteps(); paintStatus();
}
function adRender() {
  const s = sceneNow(), from = adFrom();
  const lk = assetState(s);
  if (lk.st === 'lock') return assetLock(s, lk);
  AD.imgSig = ''; AD.logSig = '';   // 整页重画了：图和记录也要重摆
  setTimeout(adRepaint, 0);
  return [h('div', { class: 'ad', id: 'ad' },
    h('div', { class: 'ad-head', id: 'ad-head' }, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => go(from, { s: s.段 }) }, '← 回到' + from)),
    h('div', { class: 'ad-track', id: 'ad-track' }), h('div', { id: 'ad-now' }),
    h('div', { class: 'ad-cols' }, h('section', { class: 'ad-col', id: 'ad-word' }), h('section', { class: 'ad-col', id: 'ad-img' })),
    h('section', { class: 'ad-log', id: 'ad-log' })),
    h('div', { class: 'wf-fab', id: 'ad-fab' })];
}
