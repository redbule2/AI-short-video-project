/* ============================================================
   流水线 · 一样东西的弹窗（2026-11-16 他要的：点一样资产不再换页，弹一个大窗盖在上面；设计稿 资产详情弹窗_设计稿.html。11-14 到 11-16 是单独一页）
   资产那一步点一张卡、提示词那一步点一张关键帧，都弹这一个（流水线.js 的 openWord → adOpen）。后面那一页不动：页签、滚到哪都留着。
   弹窗里：
     顶上：哪一样、第几段，第几 / 共几样，‹ › 换一样（键盘 ← →），关键帧有「删除」，× 关掉（Esc、点暗处也行）；
     「眼下」：走到哪一步（五个小点：AI 写字 → 你批字 → AI 出图 → 你看图 → 确认可用），眼下该做的那一件；
     左边是图，不跟着滚：现在的图、AI 核图说了什么，点图看大图、写批注（盖在弹窗上面）；出了新图，旧图、新图并排，各自下面一个钮「用旧图」「用新图」；
     右边是字，自己滚：要撑住什么戏、AI 替你定的、参考图、GEO 底稿（场景）、出图提示词、批注；最下面折着 AI 做过的事、以前的字；
     底边：存没存、键盘怎么按；右边是这一步要按的那一个（深色，只摆这一处）和「下一样要你看的」。
   关键帧（11-16 他要的：镜头当主角）：标题是「镜头11 · 开头」和这一镜写的什么；下面一排是这一镜开头、中间、结尾的几张，点哪张看哪张，
     旁边是这一张的「当现用」「解绑」；没绑的那一排给「绑到哪一镜」。上一张、下一张照镜头表排。
   点「确认可用」（关键帧、人物、场景、道具都是）：自动换到下一张要确认的，都确认了就关掉。
   网址带 #a=图的路径（|哪一条提示词）：刷新还开着，按「后退」关掉。老网址 资产.html?a=… 也认，换成 #a=…。
   改了的字，关掉、换一样、去别的页时自动存上（改之前的那一版收进历史记录）；存不上不关，说为什么；Ctrl+S 也能存。
   写字、出图、候选、确认这些做法和资产格子共用，在 流水线.js「文生资产」那一节；删一张图（removeAsset）资产格子也用，放在这里
   ============================================================ */
'use strict';
const AD = { q: null, pushed: false, skipPop: false, urlDone: false, closing: false, root: null, ui: null, title: '', nav: null,
  key: '', base: null, mt: '', failMt: '', dirty: false, saveErr: '', loading: false, outside: false, els: null, cur: null, hist: null, histKey: '', scan: null, scanKey: '', imgSig: '', logSig: '', shotSig: '', picT: '' };
const adIsOpen = () => !!AD.q;
const escRe = t => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const adBind = w => w.frame ? SB.bindsOf(w.s)[w.img] || null : null;   // 关键帧绑在哪一镜哪一刻
const adLabel = w => { const b = adBind(w); return b ? '镜头' + b.镜 + ' ' + SB.SAY[b.刻] + (b.备选 ? '（备选）' : '') : (w.frame ? '关键帧' : w.cat) + '「' + (w.frame ? w.stem : w.name + (w.state ? '（' + w.state + '）' : '')) + '」'; };
const adStamp = w => [F.words.get(w.txt) || 0, w.geo ? F.words.get(w.geo) || 0 : 0, F.words.get(w.note) || 0].join('/');
const adNeedsYou = w => w.step === 'word' || w.step === 'cand' || w.step === 'img';
/* 只用文字的（11-17）：这一份字是不是文字描写（「用途：」写着只用文字，公用/文字描写.js）。和眼下的做法对不上（只用文字的还是以前的出图提示词、改回要出图的还是文字描写）：让 AI 改过来 */
const adIsTxt = () => !!AD.base && typeof TxtWord === 'object' && TxtWord.isTxt(AD.base.head);
const adMismatch = w => !!AD.base && w.hasTxt && !w.frame && adIsTxt() !== !!w.txtOnly;
const relDir = r => { const p = '项目/' + F.name + '/'; return r && r.startsWith(p) ? r.slice(p.length) : ''; };   // 任务记录（从总文件夹算起）→ 项目里的路径
/* 网址里记着开着的是哪一样：#a=图的路径|哪一条提示词（整段编码，和 pageUrl 的 hash 一个做法；路径、文件名里不会有 |） */
const adHash = q => 'a=' + q.a + (q.v ? '|' + q.v : '');
const adUrl = q => location.pathname + location.search + (q ? '#' + encodeURIComponent(adHash(q)) : '');
function adParse(hs) {
  let t = '';
  try { t = decodeURIComponent(String(hs || '').replace(/^#/, '')); } catch (e) { return null; }
  const m = /^a=([^|]+)(?:\|(.+))?$/.exec(t);
  return m ? { a: m[1], v: m[2] || '' } : null;
}

/* 开着的那一样：先在这一场的格子里找，找不到再当提示词那一步出的关键帧 */
function adFind(s) {
  const q = AD.q, a = q && q.a;
  if (!a) return null;
  for (const it of assetsOf(s).list) { const w = wordOf(s, it); if (w && w.img === a) { if (w.frame) w.forPrompt = q.v || (w.rec && w.rec.提示词) || ''; return { it, w }; } }
  const ad = AP.segDir(s.段) + '/';
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
/* 上一样、下一样用：人物、场景、道具照资产格子的先后排；关键帧只在这一场的关键帧里排（照镜头表：每一镜开头、中间、结尾，没绑的最后，SB.seq） */
function adOrder(s, w) {
  const list = assetsOf(s).list, wrap = mine => mine.map(it => ({ it, w: wordOf(s, it) })).filter(x => x.w);
  if (!w.frame) return wrap(KINDS.flatMap(k => list.filter(it => kindOf(it.类别) === k)));
  const by = new Map(list.filter(it => it.类别 === '关键帧').map(it => [it.文件, it]));
  return wrap(SB.seq(SB.table([...by.keys()], s.段落, SB.bindsOf(s))).map(f => by.get(f)));
}
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

/* ---------- 开、关 ---------- */
/* 弹出一样（openWord 调）。已经开着别的：先把那一样没存的存上，存不上不换 */
async function adOpen(s, w) {
  const lk = assetState(s);
  if (lk.st === 'lock') { toast(lk.tx + '才能看这一样的字和图', 'err'); return; }
  if (AD.q && AD.q.a === w.img) return;
  if (AD.q && AD.dirty && AD.cur && !(await adSave(AD.cur.s, AD.cur.w, true))) return;
  closePop(); hideHov();
  const was = !!AD.q;
  AD.q = { a: w.img, v: w.forPrompt || '' };
  if (was) history.replaceState(null, '', adUrl(AD.q));   // 换一样不记进「后退」：后退一下就关掉
  else { history.pushState(null, '', adUrl(AD.q)); AD.pushed = true; }
  adMount();
  adRepaint();
}
/* 关掉：没存的先存上，存不上问一句改的还要不要。fromPop：按了浏览器「后退」，网址已经回去了 */
async function adClose(fromPop) {
  if (!AD.q || AD.closing) return !AD.q;
  const c = AD.cur;
  if (c && AD.dirty) {
    AD.closing = true;   // 存的时候页面重画（adSync）又叫关：不再存一遍
    const ok = await adSave(c.s, c.w, 'ask'), drop = ok || await confirmDlg({ title: '字没存上', body: AD.saveErr + '。改的不要了，直接关掉？', ok: '不要了，关掉', cancel: '回去接着改' });
    AD.closing = false;
    if (!drop) { if (fromPop) { history.pushState(null, '', adUrl(AD.q)); AD.pushed = true; } return false; }
  }
  const img = c ? c.w.img : AD.q.a;
  adUnmount();
  if (!fromPop) { if (AD.pushed) { AD.skipPop = true; history.back(); } else history.replaceState(null, '', adUrl(null)); }
  AD.pushed = false;
  pageNow();   // 后面那一页照弹窗里做过的换上
  adFlash(img);
  return true;
}
function adMount() {
  if (AD.root) return;
  AD.title = document.title;
  const ui = { head: h('div', { class: 'adm-h' }), shot: h('div', { class: 'adm-shot' }), now: h('div', { class: 'adm-now' }), img: h('section', { class: 'adm-img' }), word: h('div'),
    logSum: h('summary'), logBody: h('div', { class: 'adm-logb' }), gone: h('div', { class: 'adm-gone' }), foot: h('div', { class: 'adm-f' }) };
  ui.txt = h('section', { class: 'adm-txt' }, ui.word, h('details', { class: 'adm-log' }, ui.logSum, ui.logBody));
  ui.box = h('div', { class: 'adm-box', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' }, ui.head, ui.shot, ui.now, h('div', { class: 'adm-b' }, ui.img, ui.txt), ui.gone, ui.foot);
  AD.ui = ui;
  AD.root = h('div', { class: 'adm' }, h('div', { class: 'adm-dim', title: '点这里关掉', onclick: () => adClose() }), ui.box);
  const sw = window.innerWidth - document.documentElement.clientWidth;   // 滚动条收起来了：后面那一页别往右跳
  if (sw > 0) document.body.style.paddingRight = sw + 'px';
  document.body.classList.add('ad-open');
  const wf = document.getElementById('wf');
  if (wf) wf.inert = true;   // 后面那一页点不着，Tab 也跳不过去
  document.body.append(AD.root);
  void AD.root.offsetWidth; AD.root.classList.add('on');   // 先量一下再加 on：淡入有过渡（不靠下一帧，页面藏着时也弹得出来）
  ui.box.focus({ preventScroll: true });
}
function adUnmount() {
  if (AD.root) AD.root.remove();
  document.body.classList.remove('ad-open');
  document.body.style.paddingRight = '';
  const wf = document.getElementById('wf');
  if (wf) wf.inert = false;
  if (AD.title) document.title = AD.title;
  Object.assign(AD, { q: null, root: null, ui: null, nav: null, cur: null, els: null, key: '', base: null, mt: '', failMt: '', dirty: false, saveErr: '', outside: false, hist: null, histKey: '', scan: null, scanKey: '', imgSig: '', logSig: '', shotSig: '' });
}
/* 关掉以后，后面那一页上这一样的卡闪一下（翻到别的页签去了、不在眼前的，不闪） */
function adFlash(img) {
  const el = [...document.querySelectorAll('#wf [data-img], #wf [data-file]')].find(e => (e.dataset.img || e.dataset.file) === img);
  if (!el) return;
  el.scrollIntoView({ block: 'nearest' });
  if (el.tabIndex >= 0) el.focus({ preventScroll: true });
  el.classList.remove('ad-flash'); void el.offsetWidth; el.classList.add('ad-flash');
}
/* 页面每回重画都叫一次（资产那一页的 repaint、整页重画 renderAll）：头一回看网址要不要弹出来；开着就跟着换 */
function adSync() {
  if (!AD.urlDone && F.doc) { AD.urlDone = true; adFromUrl(); }
  if (AD.q) adRepaint();
}
function adFromUrl() {
  const q = query(), old = q.a ? { a: q.a, v: q.v } : null, want = old || adParse(location.hash);
  if (!want) return;
  if (old) history.replaceState(null, '', pageUrl(PAGE.name, { p: F.name, s: F.seg }, adHash(old)));   // 老网址 ?a=…：换成 #a=…
  AD.q = want; AD.pushed = false;
  adMount();
}
window.addEventListener('popstate', async () => {
  if (AD.skipPop) { AD.skipPop = false; return; }
  const q = adParse(location.hash);
  if (AD.q && !q) adClose(true);
  else if (q && !AD.q && F.doc) { AD.q = q; AD.pushed = true; adMount(); adRepaint(); }   // 按「前进」回到开着的
  else if (q && AD.q && q.a !== AD.q.a) {   // 网址里改成了别的一样：没存的先存上，再换
    if (AD.dirty && AD.cur && !(await adSave(AD.cur.s, AD.cur.w, true))) { history.replaceState(null, '', adUrl(AD.q)); return; }
    AD.q = q; adRepaint();
  }
});
window.addEventListener('beforeunload', e => { if (AD.q && AD.dirty) { e.preventDefault(); e.returnValue = ''; } });
/* 键盘：Esc 关、Ctrl+S 存、← → 换一样（在框里打字时不换）。弹窗上面又盖了东西（对话框、小窗、看大图），键盘归它 */
const adCovered = () => !!document.querySelector('.mask:not(.out)') || window.UI.popOpen || !!SHELL;
const adTyping = () => { const a = document.activeElement; return !!a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) || a.isContentEditable); };
document.addEventListener('keydown', e => {
  if (!AD.q || adCovered() || isComposing(e)) return;
  const k = e.key;
  if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'S')) { e.preventDefault(); e.stopPropagation(); if (AD.cur) adSave(AD.cur.s, AD.cur.w); return; }
  if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); adClose(); return; }
  if ((k === 'ArrowLeft' || k === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !adTyping() && AD.ui) {
    const b = AD.ui.head.querySelector(k === 'ArrowLeft' ? '.adm-prev' : '.adm-next');
    if (b && !b.disabled) { e.preventDefault(); b.click(); }
  }
}, true);

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
/* 存上改了的：字、GEO 底稿改之前的那一版收进历史记录（putText）；批注是过程文件，直接盖。
   quiet：存上了不另外提示；'ask'：存不上也不弹提示（关弹窗时问一句，adClose） */
async function adSave(s, w, quiet) {
  if (!AD.base || !AD.els) return true;
  const v = adVals(), b = AD.base, stamp = stampNow();
  const ch = { body: v.body !== b.body, geo: !!AD.els.gta && v.geo !== b.geo, note: v.note !== b.note };
  const fail = m => { AD.saveErr = m; if (quiet !== 'ask') toast(m, 'err'); adPaintActs(); return false; };
  if (!ch.body && !ch.geo && !ch.note) { AD.dirty = false; AD.saveErr = ''; adPaintActs(); return true; }
  if (ch.body && !v.body) return fail((w.txtOnly ? '文字描写' : '出图提示词') + '空着，没存。不要这一样：关掉弹窗，点那一格的 ×');
  if (ch.geo && !v.geo) return fail('GEO 底稿空着，没存');
  try {
    if (ch.body) await putText(w.txt, adText(w, b.head, v.body), stamp);
    if (ch.geo) await putText(w.geo, v.geo + '\n', stamp);
    if (ch.note) {
      if (v.note) await FS.write(at([F.name, ...w.note.split('/')]), C.encodeText('# 字的批注｜' + w.stem + '\n文件：' + w.txt + '\n\n## 整体\n' + v.note + '\n'));
      else if (w.hasNote) await archiveFile(w.note, stamp);
    }
  } catch (e) { return fail('没存上：' + e.message); }
  AD.base = { ...b, body: v.body, geo: AD.els.gta ? v.geo : b.geo, note: v.note, head: ch.body && !b.head.length ? adHead(w) : b.head };
  AD.dirty = adChanged(); AD.saveErr = '';
  await loadSides();
  const r = adFind(s);
  if (r) AD.mt = adStamp(r.w);   // 自己存的不算「外面改过」
  if (!quiet) toast('存上了' + (ch.body || ch.geo ? '，改之前的那一版收进了历史记录' : ''));
  pageNow();   // 后面那一页的卡（「批注没交」这些）跟着换，弹窗也跟着重摆（adSync）
  return true;
}
async function adLeave() {   // 换页前（go）：没存的先存上，存不上就不走
  const c = AD.cur;
  if (!c || !AD.dirty) return;
  if (!(await adSave(c.s, c.w, true))) throw new Error('字没存上');
}

/* ---------- 几样事：写字、交给 AI 改、在 Codex 里出图、确认、候选、删除 ---------- */
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
async function adConvert(s, w, self) {   // 字和眼下的做法对不上：AI 照原来的字改写（改之前的那一版收进历史记录）；批注框里写的一起交过去
  if (!(await adSave(s, w, true))) return;
  const add = AD.els ? AD.els.nta.value.trim() : '';
  const req = (w.txtOnly ? '把原来的出图提示词改写成文字描写：样子照原来的，只写样子；定妆照、画幅、背景这些出图的话去掉' : '把原来的文字描写改写成出图提示词：样子照原来的，照出图规矩写') + (add ? '。另外：' + add : '');
  if (await askWords(s, [w], req, self)) await pageRepaint();
}
async function adDraw(s, w) {   // 在 Codex 里出图：开一个 Codex 新对话，照现在的字出第一张，你在里面聊、说「定稿」就换上；定稿前旧图照用
  if (w.txtOnly || adIsTxt()) { toast('这一份是只用文字时写的文字描写，不能直接出图' + (w.txtOnly ? '' : '：先点「让 ' + chName() + ' 改成出图提示词」'), 'err'); return; }
  const v = adVals();
  if (!w.hasTxt && !v.body) { toast('还没有字：先让 AI 写，或者自己写好点「存」', 'err'); return; }
  const bad = w.frame && AD.base ? unconfirmedRefs(AD.base.head) : [];   // 关键帧：用到的人物、场景、道具图都确认可用了再出
  if (bad.length) { toast('这几张参考图还没确认可用：' + bad.map(x => '图' + x.n + '（' + baseOf(x.file) + '）').join('、') + '。先到资产那一步确认，再出这一帧', 'err'); return; }
  if (v.note && !(await confirmDlg({ title: '批注还没交给 AI', body: '批注里写的「' + v.note.slice(0, 40) + '」还没照着改。照现在的字出图？', ok: '照现在的字出' }))) return;
  if (!(await adSave(s, w, true))) return;
  if (await askDraw(s, w)) await pageRepaint();
}
/* 删掉这张图：和资产页那一格的 × 一个做法（removeAsset）。关键帧删完换到下一张，没有就上一张，都没有就关掉；
   人物、道具、场景删完留在这一样上：字还在，能再出（11-23 他要弹窗里也能删） */
async function adDelete(s, it, w) {
  const { list, i } = AD.nav || { list: [], i: -1 }, to = list[i + 1] || list[i - 1];
  const cell = it && it.at === w.img ? it   // 资产格子里没挂着这张的：提示词那一步加的关键帧、只用文字写的场景旁边那张图
    : { 类别: w.frame ? '关键帧' : w.cat === '场景' ? '场景图' : w.cat + '图', 名称: w.frame ? w.stem : w.name, sub: w.frame ? '' : w.state || '', at: w.img, 文件: w.img, own: true };
  if (AD.dirty && !(await adSave(s, w, true))) return;
  const r = await removeAsset(s, cell, true);
  if (!r) return;
  if (w.frame) { if (to) { await adOpen(s, to.w); pageNow(); } else await adClose(); return; }
  toast(r === 'del' ? '「' + w.stem + '」这张图移进历史记录了：字还在，能再出' : '「' + cell.名称 + '」不挂这张图了');
  const x = it ? assetsOf(s).list.find(y => y.类别 === it.类别 && y.名称 === it.名称 && (y.sub || '') === (it.sub || '') && (!it.文字 || y.文字 === it.文字)) : null, nw = x && wordOf(s, x);
  if (nw && nw.img !== w.img) await adOpen(s, nw);   // 图名和叫法不一样的（书包挂的是 黑色单肩包.png）：换成删了以后的那一格
  pageNow();
}
async function adEditImg(s, w) { if (await askEditImg(s, w)) await pageRepaint(); }
async function adConfirm(s, it, w, on) {
  if (it && it.at) confirmImg(s, it, on); else confirmW(s, w, on);
  await flush(); pageNow();
  if (on && AD.q) {   // 11-16 他要的：确认了自动换到下一张要你看的图（关键帧照镜头表，人物场景道具照格子的先后，往后找，到头从头接着找）；都确认了就关掉
    const { list, i } = AD.nav || { list: [], i: -1 };
    const next = [...list.slice(i + 1), ...list.slice(0, Math.max(i, 0))].find(x => x.w.img !== w.img && !(x.it && x.it.文字) && (x.w.step === 'img' || x.w.step === 'cand'));   // 只用文字写的场景不算：它那张图是「用上这张图」，不是确认
    if (next) { toast(adLabel(w) + ' 确认可用了，换到' + adLabel(next.w)); await adOpen(s, next.w); return; }
    const rest = w.frame ? 0 : assetsOf(s).list.filter(x => x.类别 !== '关键帧' && x.at && x.at !== w.img && !okOf(x)).length;   // 弹不出来的（这一段文件夹里当人物用的图这类）：在卡上确认
    toast(adLabel(w) + ' 确认可用了。' + (rest ? '弹窗里的都看完了，还有 ' + rest + ' 张没确认，在卡上点「确认可用」' : '这一段' + (w.frame ? '有图的关键帧' : '人物、场景、道具有图的') + '都确认过了'));
    await adClose();
    return;
  }
  toast(on ? adLabel(w) + ' 确认可用了' : '取消了确认');
}
/* 关键帧换一镜、换现用、解绑、绑上：改这一场的「关键帧绑定」（公用/关键帧绑定.js），后面那一页和弹窗跟着重摆 */
function adRebind(fn, say) { fn(); touch(); pageNow(); if (say) toast(say); }
async function adUseCand(s, it, w) {
  if (!(await takeCand(w))) return;
  await pageRepaint();
}
async function adNoCand(s, w) { if (await dropCand(w)) await pageRepaint(); }
async function adUseScene(s, it, w) { useSceneImg(s, it.文字, w.img); await flush(); pageNow(); toast('这一段改用「' + w.stem + '」这张图了'); }
/* 照图核 GEO（11-14 他要的）：图你满意了，让 AI 先判断 GEO 底稿和图对不对得上，对不上才照图改（改之前的那一版收进历史记录）。
   确认可用时自动核过一回；这里是你想再核一遍的时候点（比如自己改过底稿）。框里改了没存的先存上，AI 照存上的那一版核 */
async function adGeoCheck(s, w) {
  if (!(await adSave(s, w, true))) return;
  if (await startJob({ 事: '核GEO', 段: s.段, 参数: { 图: w.img } })) await pageRepaint();
}
/* 已经有现成的图：关掉弹窗，打开资产那一步右边的挑图栏（资产.html 的 pickFor） */
async function adPick(s, it) { if (await adClose()) pickFor(s, it); }

/* 这张图有没有提示词挂着：看 资产/参考素材映射.json（AI 写提示词时登记的） */
async function usedByPrompts(file) {
  try {
    if (!(await hasFile(F.name, ['资产', '参考素材映射.json']))) return [];
    const j = await readJson(at([F.name, '资产', '参考素材映射.json']));
    return Object.entries(j.prompts || {}).filter(([, v]) => (v && v.references || []).some(r => r && cleanFile(r.path) === file)).map(([k]) => k);
  } catch (e) { return []; }
}
/* 删一张图（资产格子的 ×、弹窗里的「删除」）。几种删法：这一段不用它（人物、道具：这一段不出场，全片表里还在）；只是不引用（图还在原处，以后点「挑现成的图」能再挂回来）；
   图不要了（移进这个项目的 历史记录，全片各处都不再引用它；想重出：那一格的字还在，点「批字」→「在 Codex 里出图」；想要回来，挑图那一栏「删掉的」里放回来） */
async function removeAsset(s, it, stay) {   // stay：在弹窗里删的，删完弹窗自己换到别的，这里不重画。回 'drop'、'unref'、'del'，没删回 false
  const file = it.at, isRow = !!KIND[it.类别], e = isRow ? entryOf(it.类别, it.名称) : null, k = kindOf(it.类别), frame = it.类别 === '关键帧';
  const field = isRow || frame ? '' : it.类别 === '人物图' || it.类别 === '道具图' ? it.类别 : '场景图';   // 不是表里一行的：这一场哪一格记着它
  const canUnref = it.own && (frame || (isRow ? !!e && e.资产.includes(file) : s[field].includes(file)));
  const canDrop = isRow && it.own && !stay && s[it.类别].includes(it.名称);
  const used = await usedByPrompts(file), mineImg = !isRow && segImg(s, file) && !F.doc.场景图.includes(file);   // mineImg：这一段文件夹里的图，只这一场用
  const r = await dialog(close => dlgShell('删掉这张图 · ' + it.名称 + (it.sub ? ' · ' + it.sub : ''), file,
    [canDrop ? h('p', { class: 'fn-note' }, '这一段不用「' + it.名称 + '」：这一段不出场，全片的' + k + '表里还在，图也还挂着。') : null,
      h('p', { class: 'fn-note' }, mineImg ? '图不要了：移进这个项目的「历史记录」（照原来的文件夹放），这一段不再用它。' : '图不要了：移进这个项目的「历史记录」，全片各处都不再引用它。想重出一张：它的字还在，删完点那一格的「批字」→「在 Codex 里出图」；后悔了，在挑图那一栏的「删掉的」里放回来。'),
      canUnref ? h('p', { class: 'fn-note' }, isRow ? '只是不引用：图还留在原处，「' + it.名称 + '」不再挂它（各段都不挂）。以后点「挑现成的图」能再挂回来。' : frame ? '只是这一段不当关键帧：图还留在 资产 / ' + segName(s.段) + ' 里。' : mineImg ? '只是这一段不用：图还留在 资产 / ' + segName(s.段) + ' 里，以后点「＋ 加' + k + '」能再挑回来。' : '只是这一段不用：图还留在原处，全片还引用着，只是这一段不挂它。') : null,
      used.length ? h('p', { class: 'fn-note warn' }, '有提示词挂着这张图：' + used.join('、') + '。移走以后，那边要重新挂图。') : null],
    [h('button', { class: 'btn ghost', 'data-focus': '', onclick: () => close(null) }, '取消'),
      canDrop ? h('button', { class: 'btn', onclick: () => close('drop') }, '这一段不用它') : null,
      canUnref ? h('button', { class: 'btn', onclick: () => close('unref') }, isRow ? '只是不引用' : frame ? '不当关键帧' : '只是这一段不用') : null,
      h('button', { class: 'btn zhu', onclick: () => close('del') }, '图不要了')]));
  if (!r) return false;
  if (r === 'drop') { s[it.类别] = s[it.类别].filter(n => n !== it.名称); touch(); pageNow(); return r; }
  if (r === 'unref') {
    if (isRow) { e.资产 = e.资产.filter(f => f !== file); e.不用 = [...new Set([...(Array.isArray(e.不用) ? e.不用 : []), file])]; }   // 记下「不用」：AI 清单里再列着它，也不替你对回去
    else if (frame) dropFrame(s, file);   // 名字带首帧的：记进这一场的「关键帧不用」，不再自己冒出来
    else s[field] = s[field].filter(f => f !== file);
    touch(); if (!stay) pageNow();
    return r;
  }
  const parts = file.split('/'), dir = parts.slice(0, -1), name = parts[parts.length - 1], dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, stamp = stampNow();
  const dest = [F.name, '历史记录', ...dir, stem + '__' + stamp + (dot > 0 ? name.slice(dot) : '')];
  try { await FS.move(at([F.name, ...parts]), at(dest)); }
  catch (err) { toast('没移走：' + err.message, 'err'); return false; }
  // 看大图时写的批注、批注截图跟着一起收走：不然重出的同名图一打开就带着旧批注
  try { if (await hasFile(F.name, [...dir, stem + '_批注.md'])) await FS.move(at([F.name, ...dir, stem + '_批注.md']), at([F.name, '历史记录', ...dir, stem + '_批注__' + stamp + '.md'])); } catch (err) { /* 挪不动就留着 */ }
  try { if (await FS.isDir(at([F.name, ...dir, stem + SHOTS_TAIL]))) await FS.move(at([F.name, ...dir, stem + SHOTS_TAIL]), at([F.name, '历史记录', ...dir, stem + SHOTS_TAIL + '__' + stamp])); } catch (err) { /* 挪不动就留着 */ }
  for (const K of LISTS) for (const x of F.doc[K.key]) x.资产 = x.资产.filter(f => f !== file);
  F.doc.场景图 = F.doc.场景图.filter(f => f !== file);
  for (const x of F.doc.场) { for (const f2 of ['场景图', '人物图', '道具图', '关键帧', '关键帧不用']) x[f2] = arrOf(x[f2]).filter(f => f !== file); SB.unbind(x, file); }
  delete F.doc.可用[file];   // 图不在了，它的「可用」也不留：重出的那一张要重新确认
  if (isPlainObj(F.doc.rest.照的)) delete F.doc.rest.照的[file];   // 照的哪一句（11-23）也不留
  touch();
  await flush();
  window.UI.dropThumbs();   // 重出的图会回到同一个名字：做好的缩小图不能再用
  try { F.pool = await loadPool(F.name); } catch (err) { /* 下回再读 */ }
  await loadSides();
  if (stay) return r;
  rerender();
  toast('移进历史记录了：' + dest.slice(1).join(' / '));
  return r;
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
  if (AD.histKey !== key) return;   // 读的时候换了一样、关掉了
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
  try { ents = await FS.list(at([F.name, '历史记录', 'AI任务'])); } catch (e) { if (AD.scanKey === key) { AD.scan = []; adRepaint(); } return; }
  const re = new RegExp('^(\\d{8})-(\\d{6})_(写字|出图|改图)_第' + escRe(s.段) + '段$'), tag = '【' + w.cat + '｜' + w.name + (w.state ? '｜' + w.state : '') + '】', out = [];
  const dirs = ents.filter(e => e.kind === 'directory' && re.test(e.name)).map(e => e.name).sort().reverse().slice(0, 20);
  const known = new Set((w.rec && Array.isArray(w.rec.过程) ? w.rec.过程 : []).map(x => x.目录));   // 「过程」里记了的不用再翻
  for (const d of dirs) {
    const m = re.exec(d), base = '历史记录/AI任务/' + d;
    if (known.has(base)) continue;
    let hit = false;
    if (m[3] === '写字') { const t = await readText(base + '/任务书.md'); hit = !!t && (t.split('## 要写的这几样')[1] || '').split('\n## ')[0].includes(tag); }
    else { const t = await readText(base + '/发给Codex的话.txt') || await readText(base + '/交给AI的话.txt'); hit = !!t && t.replace(/\\/g, '/').includes('/' + F.name + '/' + (m[3] === '出图' ? w.txt : w.img)); }
    if (hit) out.push({ 时间: m[1].slice(0, 4) + '-' + m[1].slice(4, 6) + '-' + m[1].slice(6) + ' ' + m[2].slice(0, 2) + ':' + m[2].slice(2, 4) + ':' + m[2].slice(4), 事: m[3] === '改图' ? '照批注改图' : m[3], 渠道: '', 目录: base });
    if (out.length >= 8) break;
  }
  if (AD.scanKey !== key) return;
  AD.scan = out;
  adRepaint();
}

/* ---------- 摆出来 ---------- */
const AD_TRACK = ['AI 写字', '你批字', '在 Codex 里出图', '你看图', '确认可用'], AD_TRACK_TXT = ['写文字描写', '写视频提示词照它写'];   // 只用文字的（11-17）：写好了就算完
function adTrackEl(w) {   // 五步缩成五个小点，后面写现在是哪一步
  const T = w.txtOnly ? AD_TRACK_TXT : AD_TRACK, at0 = (w.txtOnly ? { none: 0, 'ai-word': 0, txt: 2 } : { none: 0, 'ai-word': 0, word: 1, 'ai-img': 2, cand: 3, img: 3, ok: 5 })[w.step], ai = w.step === 'ai-word' || w.step === 'ai-img', done = at0 >= T.length;
  return h('div', { class: 'adm-trk', title: T.map((t, i) => (i < at0 ? '✓ ' : i === at0 ? '● ' : '　 ') + t).join('\n') },
    T.map((t, i) => [i ? h('em') : null, h('i', { class: i < at0 ? 'ok' : i === at0 ? (ai ? 'ai' : 'you') : '' })]),
    h('b', { class: done ? 'ok' : ai ? 'ai' : '' }, done ? (w.txtOnly ? '文字写好了' : '确认可用了') : '第 ' + (at0 + 1) + ' 步 · ' + T[at0]));
}
const adX = () => h('button', { class: 'adm-rb x', type: 'button', title: '关掉（Esc）', 'aria-label': '关掉', onclick: () => adClose() }, icon('x'));
function adHeadEls(s, it, w) {
  const { list, i } = AD.nav, u = adUnit(w), prev = i > 0 ? list[i - 1] : null, next = i >= 0 && i < list.length - 1 ? list[i + 1] : null, users = w.frame ? [] : usersOf(w.img);
  const where = ['第' + s.段 + '段', w.frame && w.forPrompt ? vpLabel(w.forPrompt) + '的一刻' : '', users.length > 1 ? '用在 ' + users.map(x => '第' + x + '段').join('、') : ''].filter(Boolean).join(' · ');
  const nav = (txt, x, cls, lab, key) => h('button', { class: 'adm-rb ' + cls, type: 'button', disabled: !x, 'aria-label': lab, title: x ? lab + '：' + adLabel(x.w) + '（键盘 ' + key + '）' : '这一段没有' + lab + '了', onclick: () => { if (x) adOpen(s, x.w); } }, txt);
  const sh = w.frame ? adShotOf(s, w) : null;
  return [sh ? adShotTitle(s, w, sh) : h('div', { class: 'ad-title ' + kindCls(w.cat) }, h('b', null, adLabel(w)), h('small', null, where)),
    h('span', { class: 'sp' }),
    w.hasImg ? h('button', { class: 'btn sm ghost', type: 'button', disabled: adBusy(s, w), title: w.frame ? '删掉这张关键帧：只是这一段不用，或者图也不要了（移进历史记录）'
      : '删掉这张图：图不要了就移进历史记录（字还在，能再出；后悔了在挑图栏「删掉的」里放回来）' + (it && it.at === w.img ? '，或者只是不挂它' : '') + (adBusy(s, w) ? '。AI 在做这一样，做完才能删' : ''), onclick: () => adDelete(s, it, w) }, '删除这张') : null,
    sh && sh.row ? h('span', { class: 'adm-n', title: '这一段镜头表的第几镜。‹ › 一张一张换，照镜头表排' }, '镜头表第 ' + (sh.T.rows.indexOf(sh.row) + 1) + ' / ' + sh.T.rows.length + ' 镜')
      : list.length > 1 && i >= 0 ? h('span', { class: 'adm-n' }, '第 ' + (i + 1) + ' / ' + list.length + ' ' + u) : null,
    list.length > 1 ? nav('‹', prev, 'adm-prev', '上一' + u, '←') : null,
    list.length > 1 ? nav('›', next, 'adm-next', '下一' + u, '→') : null,
    adX()];
}
/* ---------- 关键帧：镜头当主角（11-16 他要的）。标题是这一镜，下面一排是这一镜的几张 ---------- */
/* 这一张绑在哪一镜、那一镜的字、这一场关键帧按镜头表摆的样子（SB.table）；by：图 → 它的 { it, w }（缩略图点了换过去用） */
function adShotOf(s, w) {
  const by = new Map(adOrder(s, w).map(x => [x.w.img, x]));
  if (!by.has(w.img)) by.set(w.img, { it: null, w });   // 提示词那一步加的、资产格子里没有的
  const T = SB.table([...by.keys()], s.段落, SB.bindsOf(s)), b = adBind(w);
  return { T, b, by, row: b ? T.rows.find(r => r.号 === b.镜) || null : null };
}
function adShotTitle(s, w, { b, row }) {
  const where = ['第' + s.段 + '段', row && row.作用 ? '作用：' + row.作用 : '', w.forPrompt ? '用在 ' + vpLabel(w.forPrompt) : '', w.stem].filter(Boolean).join(' · ');
  if (!b) return h('div', { class: 'ad-title ad-shot-t k-zhen' }, h('div', { class: 'l1' }, h('b', null, '还没绑镜头')), h('div', { class: 'w' }, '这一张还不知道是哪一镜：在下面选好镜头，再点开头、中间或结尾'), h('small', null, where));
  return h('div', { class: 'ad-title ad-shot-t k-zhen' },
    h('div', { class: 'l1' }, h('b', null, '镜头' + b.镜), h('span', { class: 'm', title: SB.SAY[b.刻] + '：' + b.刻 }, SB.SAY[b.刻]), b.备选 ? h('span', { class: 'alt', title: '这一刻有几张，写提示词带的是现用那张' }, '备选') : null),
    h('div', { class: 'w', title: row ? row.写什么 : '' }, row ? row.写什么 || '（这一镜还没写什么）' : '这一镜已经从镜头表里删了'),
    h('small', null, where));
}
const adThumbOk = x => !!x && x.w.hasImg && x.w.ok;
/* 一张小图：点了换过去。on：开着的就是它 */
function adThumb(s, w, file, by, tag) {
  const x = by.get(file), on = file === w.img, ok = adThumbOk(x), todo = !!x && x.w.hasImg && !x.w.ok;
  return h('button', { class: 'adm-th' + (on ? ' on' : ''), type: 'button', 'aria-current': on ? 'true' : null,
      title: baseOf(file) + (tag ? '（' + tag + '）' : '') + '\n' + (ok ? '确认过可用' : todo ? '还没确认' : x ? WORD_TX[x.w.step] : '') + (on ? '' : '\n点一下看这一张'),
      onclick: () => { if (!on && x) adOpen(s, x.w); } },
    x && x.w.hasImg ? thumbImg(file, 300) : h('span', null, x && x.w.hasTxt ? '有字没图' : '图不在了'),
    ok ? h('i', { class: 'adm-th-ok', title: '确认过可用' }, icon('check')) : todo ? h('i', { class: 'adm-th-todo', title: '还没确认' }) : null,
    tag ? h('em', null, tag) : null);
}
/* 标题下面那一排：绑了的是这一镜开头、中间、结尾各几张（现用在前），右边这一张的「还对得上」「当现用」「解绑」；
   没绑的是「还没绑」的那几张，右边「绑到 镜头几 · 开头／中间／结尾」 */
function adShotEls(s, w, sh) {
  const { T, b, by, row } = sh, btn = (tx, title, fn, cls) => h('button', { class: 'btn sm' + (cls ? ' ' + cls : ''), type: 'button', title, onclick: fn }, tx);
  if (b && row) {
    const sl = SB.slots(row), cur = w.img;
    const group = m => {
      const all = [sl[m].cur, ...sl[m].alts].filter(Boolean), many = all.length > 1;
      const empty = typeof PickBar !== 'undefined'
        ? h('button', { class: 'adm-th none', type: 'button', title: '镜头' + row.号 + ' ' + SB.SAY[m] + '还没有关键帧：点一下关掉弹窗，从这一段文件夹里挑一张绑上', onclick: async () => { if (await adClose()) PickBar.open({ s, mode: 'slot', slot: { no: row.号, 刻: m } }); } }, '没有')
        : h('span', { class: 'adm-th none' }, '没有');
      return h('div', { class: 'adm-g' }, h('b', null, SB.SAY[m]), h('div', { class: 'adm-g-r' }, all.length ? all.map(x => adThumb(s, w, x.file, by, many ? (x === sl[m].cur ? '现用' : '备选') : '')) : empty));
    };
    const me = row.帧.find(x => x.file === cur);
    return [h('span', { class: 'adm-shot-lab' }, '这一镜的关键帧'), ...SB.MOMENTS.map(group), h('span', { class: 'sp' }),
      me && me.stale ? btn('还对得上', '镜头表里这一镜的字改过了（绑的时候是「' + b.写什么 + '」）：看过这张图还对得上就点', () => adRebind(() => SB.keep(s, cur, s.段落), '记下了：还对得上'), 'ink') : null,
      b.备选 ? btn('当现用', '写提示词时带这一张（这一刻原来那张改成备选）', () => adRebind(() => SB.setCurrent(s, cur), adLabel(w).replace('（备选）', '') + ' 换成这一张')) : null,
      btn('解绑', '从这一镜拿下来，放回「还没绑」那一排（图不动）', () => adRebind(() => SB.unbind(s, cur), '解绑了，放回「还没绑」'), 'ghost')];
  }
  /* 没绑的（或者绑的那一镜删了）：这几张一排，右边选一镜绑上 */
  if (!T.rows.length) return [h('span', { class: 'adm-shot-lab' }, '还没绑镜头'), h('span', { class: 'fn-note' }, '镜头表还空着：先到「提炼」那一步写好镜头表，关键帧绑在镜头表的一镜一刻上。')];
  const loose = T.loose.map(x => x.file), g = (T.loose.find(x => x.file === w.img) || {}).guess;
  const sel = h('select', { class: 'inp sm adm-bind-sel', title: '绑到哪一镜' }, T.rows.map(r => h('option', { value: r.号, selected: g && g.镜 === r.号 ? true : null }, '镜头' + r.号 + (r.写什么 ? '　' + clipNote(r.写什么, 14) : ''))));
  return [h('span', { class: 'adm-shot-lab' }, '还没绑的'), h('div', { class: 'adm-g-r' }, loose.map(f => adThumb(s, w, f, by, ''))), h('span', { class: 'sp' }),
    h('span', { class: 'adm-bind' }, h('span', { class: 'fn-note' }, g ? '照名字猜：镜头' + g.镜 + ' ' + SB.SAY[g.刻] + '。绑到' : '绑到'), sel,
      SB.MOMENTS.map(m => btn(SB.SAY[m], '绑到选的那一镜的' + SB.SAY[m] + '，当现用（那一刻原来有图的改成备选）', () => adRebind(() => SB.bind(s, w.img, sel.value, m, s.段落, true), '绑到镜头' + sel.value + ' ' + SB.SAY[m] + '，当现用'))))];
}
function adNowEls(s, it, w, jobs) {
  const txtScene = !!(it && it.文字 && w.hasImg);
  let t = { none: '还没写字（字就是出图提示词）。点「让 ' + chName() + ' 写出图提示词」，AI 读定稿的剧本，写清它要撑住什么戏，再写出图提示词' + (w.geo ? '（场景先写 GEO 底稿）' : '') + '。也可以自己写字，点「存」。',
    'ai-word': 'AI 在写字，写好了自动换上。',
    word: '字写好了，等你批。看一遍「要撑住」「AI 替你定的」和出图提示词：行就点「在 Codex 里出图」；不行就写批注，点「交给 AI 改」，或者自己改了点「存」。',
    'ai-img': '在 Codex 里出图：到那个对话里看图，要改就在那里说，满意了说「定稿」，这里自动换上、算确认可用。',
    cand: w.hasImg ? '出了一张新图。和旧图比一比，在图下面挑：「用旧图」还是「用新图」。' : '出了一张新图。能用就点图下面「用新图」，不能用点「不要新图」。',
    img: '图出好了，等你看。能用就点「确认可用」；要改，点图框出来写批注，再点「照批注改图」，或者改字后点「在 Codex 里出图」重出。',
    ok: '这张图确认可用了。要改：改字后点「在 Codex 里出图」，在 Codex 里定稿前这张照用。' }[w.step];
  if (w.txtOnly) t = { none: '只用文字写、不出图：这一样只要一份文字描写，只写样子，写视频提示词时照它写。点「让 ' + chName() + ' 写文字描写」，AI 读定稿的剧本写；也可以自己写好点「存」。',
    'ai-word': 'AI 在写文字描写，写好了自动换上。', txt: '文字描写写好了，写视频提示词时照它写。要改：自己改了点「存」，或者写批注点「交给 ' + chName() + ' 改」。' }[w.step] || t;
  if (adMismatch(w)) t = w.txtOnly ? '这一份是以前写的出图提示词，这一样现在只用文字写：点「让 ' + chName() + ' 改成文字描写」，AI 照它改成只写样子的一段。' : '这一份是只用文字时写的文字描写，不能直接出图：点「让 ' + chName() + ' 改成出图提示词」，AI 照它改写。';
  if (txtScene && w.step !== 'cand') t = '图出好了：点「用上这张图」，这一段改用图（全片设定里那一句还在）。不满意就照批注改图，或者改字重出。';
  const old = OldImg.of(w), d = old ? w.follow || w.wordFollow : null;   // 旧了（11-23，资产旧图.js）
  if (old) t = !w.follow ? OldImg.tag(w) + '：这份字照的是原来那一句（下面并排写着）。出图时 Codex 先照现在的描写改字，告诉你改了哪几句再出；字照样对得上就点「字还能用」。'
    : d.描写 || d.镜头 ? OldImg.tag(w) + '：这张图照的是原来那一句' + (d.镜头 && !d.描写 ? '，后来用到它的镜头多了' : '') + '（下面并排写着）。点「重画」：开一个 Codex 新对话，先照现在的' + (d.描写 ? '描写' : '镜头') + '改出图提示词，告诉你改了哪几句再出；旧图照样能用就点图下面「旧图还能用」。'
      : '字改了：出图提示词在这张图出好以后又改过。照新字重出点「重画」；旧图照样能用就点图下面「旧图还能用」。';
  if (w.step === 'img' && checkBad(w.checkImg)) t += 'AI 核图说有问题，看图下面它怎么说。';
  if (w.step === 'ok' && !txtScene && w.cat === '场景' && w.hasGeo) t += '图和 GEO 底稿对不上，点图下面「照图核 GEO」：AI 先判断要不要改，对不上才改。';
  if (w.geoBack) t += 'AI 照图核了 GEO，说要拿回去批图：' + w.geoBack;
  const hj = jobs.find(j => j.交给 && j.状态 === '在做'), cx = !!hj && (hj.事 === '出图' || hj.事 === '改图');   // 在等交给 AI 的回复：给我提示词、Claude 桌面版、DeepSeek 窗口、自动发进去的 Codex 对话
  if (hj) t = { self: cx ? '没自动发进 Codex：点下面「交给 AI 的话」，复制，贴进 Codex 的新对话发出去。在那个对话里聊，满意了说「定稿」，这里自动换上。' : '等你把任务交给 AI：点下面「交给 AI 的话」，复制，贴进你自己开的对话。它做完，这里自动接着做。',
    codex: hj.交给.等 === '发送' ? '在往 Codex 里发：开一个新对话，把出图的话发进去。' : '在 Codex 里聊着：点下面「去 Codex 看」切过去。要改就在那个对话里说，满意了说「定稿」，这里自动换上、算确认可用。',
    claude: hj.交给.等 === '发送' ? '在 Claude 桌面版开了一个新对话，任务填好了：到 Claude 窗口里按发送。没看到就点下面「再开一次」。' : 'Claude 在做，在 Claude 窗口里看。它做完，这里自动接着做。',
    deepseek: 'DeepSeek 在它自己的窗口里做，做完这里自动接着做。' }[hj.交给.方式] || t;
  const bad = jobs.length ? null : adFailed(s, w), codex = jobs.some(j => j.渠道 === 'codex');   // 11-21 以前交给 Codex 做的
  const cls = jobs.length || w.step === 'ai-word' || w.step === 'ai-img' ? 'ai' : (w.step === 'ok' && !txtScene && !old) || (w.step === 'txt' && !adMismatch(w)) ? 'ok' : 'you';
  return { cls, kids: [adTrackEl(w), h('span', null, t), old ? OldImg.compare(w) : null,
    ...jobs.map(j => h('div', { class: 'ad-job' }, jobLine(j), h('span', { class: 'fn-note' }, j.标题))),
    codex ? h('span', { class: 'fn-note' }, 'Codex 会开一个看得见的对话，在 Codex 里能看它这会儿在做什么。') : null,
    bad ? h('div', { class: 'ad-job' }, h('span', { class: 'fn-note warn' }, '上一回' + (bad.事 === '出图' || bad.事 === '改图' ? ' Codex ' : ' ' + bad.渠道名 + ' ') + '没做成：' + bad.错误), relDir(bad.记录) ? h('button', { class: 'fl-link', type: 'button', onclick: () => adShowRun(relDir(bad.记录), bad.标题) }, '看过程') : null) : null] };
}
const adRow = (lab, hint, body, warn) => h('div', { class: 'ad-row' + (warn ? ' warn' : '') }, h('b', null, lab, hint ? h('span', null, hint) : null), body);
/* 出图提示词里挂的一张图是哪一类（上颜色用）：场景看文件夹；人物和道具里的看哪一行引用着（listFor）；别处的不上色 */
const refKind = f => { const a = AP.placeOf(f); return a.hist || a.depth ? '' : a.where === AP.SC ? '场景' : a.where === AP.CP ? listFor({ 类别: AP.CP, 文件: f }).key : ''; };
function adInfoEls(s, w) {
  const b = AD.base, need = (b && b.need) || w.need, mine = w.rec && Array.isArray(w.rec.替人定的) ? w.rec.替人定的 : [];
  const head = b ? b.head : [], refs = headRefs(head), other = head.filter(l => !/^(用途|要撑住)[：:]/.test(l) && !headRefs([l]).length);
  const refEl = r => {
    const bm = BMF_RE.test(r.file), ok = bm || fileOk(r.file), el = h('button', { class: 'fl-asset ' + (bm ? 'k-zhen' : kindCls(refKind(r.file))), type: 'button', title: r.file + '\n点一下看大图', onclick: () => openImage(r.file) },
      thumbImg(r.file), h('span', { class: 'nm' }, '图' + r.n + ' ' + (bm ? '白模这一刻' : baseOf(r.file)), h('small', null, ok ? (bm ? '构图、站位照它' : '确认过可用') : markOk(r.file, 0) ? '旧了：' + AssetSrc.tagOf(oldOf(r.file, srcOfFile(r.file))) : '还没确认可用')));
    if (!ok) el.classList.add('wd-bad');
    return el;
  };
  return [need ? adRow('要撑住', '这一段的戏要它做到什么。AI 读定稿的剧本写的，出图、核图都照它', need) : null,
    mine.length ? adRow('AI 替你定的', '剧本里没写、AI 替你拿的主意。不行就写在批注里', h('ul', null, mine.map(x => h('li', null, x)))) : null,
    refs.length ? adRow('参考图', '出图时一起交给 Codex，样子照它们', h('div', { class: 'ad-refs' }, refs.map(refEl)), refs.some(r => !BMF_RE.test(r.file) && !fileOk(r.file))) : null,
    other.length ? adRow('开头另外写的', '', other.join('\n')) : null];
}
/* 右边字那一块：框子只做一次（打字时不重做，光标不丢），会变的几样另外换 */
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
/* 这一步要按的那一个：摆在底边右边（深色），别处不再摆。key：图、字那两块里跳过哪个钮 */
function adMain(s, it, w) {
  if (adBusy(s, w)) return null;
  const e = AD.els, typed = k => !!e && !!e[k].value.trim();
  const b = (key, label, fn, title) => ({ key, el: h('button', { class: 'btn ink', type: 'button', title, onclick: fn }, label) });
  if (adMismatch(w)) return b('conv', '让 ' + chName() + ' 改成' + (w.txtOnly ? '文字描写' : '出图提示词'), () => adConvert(s, w), 'AI 照这一份改写，改之前的那一版收进历史记录；批注框里写的一起交过去');
  if (w.txtOnly) return w.step === 'none' ? (typed('ta') ? b('save', '存', () => adSave(s, w), '存上你写的文字描写') : b('write', '让 ' + chName() + ' 写文字描写', () => adWrite(s, w), 'AI 读定稿的剧本写这一样的文字描写；批注框里写的当要求'))
    : typed('nta') ? b('fix', '交给 ' + chName() + ' 改', () => adAskFix(s, w), '照批注改：只改你说到的地方，改之前的那一版收进历史记录') : null;
  if (w.follow && OldImg.of(w)) return b('draw', '重画', () => adDraw(s, w), '开一个 Codex 新对话：先照现在的描写、镜头改出图提示词，告诉你改了哪几句，再出图。满意了在那个对话里说「定稿」，定稿前旧图照用');   // 旧了（11-23）
  if (it && it.文字 && w.hasImg && w.step !== 'cand') return b('scene', '用上这张图', () => adUseScene(s, it, w), '这一段改用这张图（全片设定里那一句还在）');
  if (w.step === 'none') return typed('ta') ? b('draw', '在 Codex 里出图', () => adDraw(s, w), '字定了：先存上，再开一个 Codex 新对话照这份字出图。在那个对话里聊，满意了说「定稿」')
    : b('write', '让 ' + chName() + ' 写出图提示词', () => adWrite(s, w), 'AI 读定稿的剧本写这一样的出图提示词；批注框里写的当要求');
  if (w.step === 'word') return typed('nta') ? b('fix', '交给 ' + chName() + ' 改', () => adAskFix(s, w), '照批注改：只改你说到的地方，改之前的那一版收进历史记录')
    : b('draw', '在 Codex 里出图', () => adDraw(s, w), '字定了：开一个 Codex 新对话照这份字出图。在那个对话里聊，满意了说「定稿」' + (w.hasImg ? '；定稿前旧图照用' : ''));
  if (w.step === 'img') return w.hasImgNote ? b('edit', '照批注改图', () => adEditImg(s, w), '开一个 Codex 新对话：以这张为底，只改你在图上批注的地方。在那个对话里接着聊，满意了说「定稿」就换上')
    : b('confirm', [icon('check'), '确认可用'], () => adConfirm(s, it, w, true), '这张图看过了、能用。确认过的图，别的段不用再确认');
  return null;
}
const kbd = t => h('kbd', null, t);
function adPaintActs() {
  const c = AD.cur, e = AD.els;
  if (!c || !e || !AD.ui) return;
  const { s, it, w } = c, busy = adBusy(s, w), has = w.hasTxt || !!e.ta.value.trim(), main = adMain(s, it, w), skip = main ? main.key : '';
  const noun = w.txtOnly ? '文字描写' : '出图提示词', noDraw = w.txtOnly || adIsTxt();   // 文字描写不出图（11-17）
  e.acts.replaceChildren(...[
    skip === 'save' ? null : h('button', { class: 'btn', type: 'button', disabled: busy || !AD.dirty, title: '存上你改的（改之前的那一版收进历史记录）。Ctrl+S 也行', onclick: () => adSave(s, w) }, '存'),
    w.hasTxt ? (skip === 'fix' ? null : h('button', { class: 'btn', type: 'button', disabled: busy, title: '照批注改：只改你说到的地方', onclick: () => adAskFix(s, w) }, '交给 ' + chName() + ' 改'))
      : skip === 'write' ? null : h('button', { class: 'btn', type: 'button', disabled: busy, title: 'AI 读定稿的剧本写这一样的' + noun + '；批注框里写的当要求', onclick: () => adWrite(s, w) }, '让 ' + chName() + ' 写' + noun),
    skip === 'draw' || noDraw ? null : h('button', { class: 'btn', type: 'button', disabled: busy || !has, title: '字定了：开一个 Codex 新对话照这份字出图。在那个对话里聊，满意了说「定稿」' + (w.hasImg ? '；定稿前旧图照用' : ''), onclick: () => adDraw(s, w) }, '在 Codex 里出图')].filter(Boolean));
  /* 底边：左边存没存、键盘；右边下一样要你看的、这一步要按的那一个 */
  const { list, todo } = AD.nav, u = adUnit(w);
  const st = busy ? ['AI 在做这一样，做完这里自动换', ''] : AD.saveErr ? ['没存上：' + AD.saveErr, 'bad'] : AD.dirty ? ['改了还没存：关掉、换一' + u + '时自动存', 'dirty'] : AD.base ? ['都存上了', ''] : ['在读…', ''];
  const more = todo ? h('button', { class: 'btn' + (main || w.step === 'cand' ? ' ghost' : ' ink'), type: 'button', title: adLabel(todo.w) + '：' + WORD_TX[todo.w.step], onclick: () => adOpen(s, todo.w) }, '下一' + u + '要你看的 →')
    : w.step === 'ok' && !main ? h('button', { class: 'btn ink', type: 'button', onclick: () => adClose() }, '都看完了，关掉') : null;
  AD.ui.foot.replaceChildren(...[h('span', { class: 'adm-save ' + st[1] }, st[0]),
    h('span', { class: 'adm-kbd' }, list.length > 1 ? [kbd('←'), ' ', kbd('→'), ' 换一' + u + '　'] : null, kbd('Esc'), ' 关　', kbd('Ctrl'), '+', kbd('S'), ' 存'),
    h('span', { class: 'sp' }),
    w.step === 'cand' && !busy ? h('span', { class: 'fn-note' }, w.hasImg ? '用旧图还是新图：点图下面的钮' : '新图用不用：点图下面的钮') : null,
    more, main ? main.el : null].filter(Boolean));
}
function adPaintWord(s, it, w) {
  const e = adEls(w), box = AD.ui.word;
  if (e.col.parentNode !== box) box.replaceChildren(e.col);
  const b = AD.base, purpose = b && b.head.find(l => /^用途[：:]/.test(l));
  e.sub.textContent = purpose ? purpose.replace(/^用途[：:]\s*/, '用途：') : '用途：' + purposeOf(w);
  e.info.replaceChildren(...adInfoEls(s, w).filter(Boolean));
  e.ban.replaceChildren(...(AD.outside ? [h('div', { class: 'ad-ban' }, '这一样的字在外面改过了（AI 改好了新的一版？）。你这边改的还没存。',
    h('button', { class: 'btn sm', type: 'button', onclick: () => { AD.dirty = false; AD.outside = false; adReload(w); } }, '换成新的（丢掉我没存的）'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { AD.outside = false; AD.mt = adStamp(w); adRepaint(); } }, '留着我的'))] : []));
  e.ta.placeholder = w.txtOnly ? '文字描写：只写样子（人物的年纪、长相、穿着；道具的样子、大小；场景有什么、光从哪来），不写画幅、背景。' : '出图提示词：画面里有什么、什么样、光从哪来。';
  e.labTa.replaceChildren(h('b', null, w.txtOnly ? '文字描写' : '出图提示词'), h('span', null, w.txtOnly && w.hasTxt ? '只写样子，写视频提示词时照它写进【主体与关系】' : w.txtOnly && b ? '还没写：点「让 ' + chName() + ' 写文字描写」，或者自己写了点「存」' : adMismatch(w) ? '这一份还是文字描写：先让 AI 改成出图提示词' : w.hasTxt ? '出图时一字不改发给 Codex' : b ? '还没写：点「让 ' + chName() + ' 写字」，或者自己写了点「存」' : '在读…'));
  e.labNote.replaceChildren(h('b', null, w.hasTxt ? '批注' : '给 AI 的要求'), h('span', null, w.hasTxt ? '哪里不对写这里，点「交给 ' + chName() + ' 改」：只改你说到的地方，改之前的那一版收进历史记录' : '可以不写，AI 照定稿的剧本写'));
  e.nta.placeholder = w.txtOnly ? (w.hasTxt ? '比如：胡子再白一点；衣服打满补丁' : '比如：七十来岁，精瘦，白发蓬乱') : w.hasTxt ? '比如：衣服换成旧的蓝色工装；桌上再乱一点' : '比如：四十岁，瘦，熬夜熬出来的黑眼圈';
  const ro = !b || adBusy(s, w);
  for (const x of [e.ta, e.gta, e.nta]) if (x) x.readOnly = ro;
  adPaintActs();
}
/* 左边图那一块。skip：底边已经摆了的那一个，这里不再摆 */
function adImgEls(s, it, w, skip) {
  const out = [];
  const fig = (file, cap, acts) => h('figure', { class: 'ad-fig' }, h('button', { class: 'ad-pic', type: 'button', title: file + '\n点开看大图' + (acts ? '，能框出来写批注' : ''), onclick: () => openImage(file, acts) }, thumbImg(file, 900)), h('figcaption', null, cap));
  const note = (lab, t, warn) => h('p', { class: 'ad-note' + (warn ? ' warn' : '') }, h('b', null, lab + '：'), t);
  const busy = adBusy(s, w);
  if (w.txtOnly) return [h('div', { class: 'ad-ph' }, '只用文字写，不出图'),   // 11-17
    h('p', { class: 'fn-note' }, '写视频提示词时，照右边的文字描写写进【主体与关系】。要出图：', h('button', { class: 'fl-link', type: 'button', title: '这一样改回要出图：「让 AI 写出图提示词」算上它；右边的文字描写可以让 AI 改成出图提示词', onclick: () => { setNoImg(s, w.cat, w.name, false); touch(); pageNow(); } }, '改成要出图'))];
  if (w.hasCand) {   // 出了新图：旧图、新图并排，各自下面一个钮，用哪张点哪张下面的（11-15 他说「用这张」分不清是哪张）
    const users = w.frame ? [] : usersOf(w.img), old = w.hasImg;
    const noBtn = h('button', { class: 'btn', type: 'button', disabled: busy, title: old ? '用旧图：新图收进历史记录' : '不要新图：收进历史记录', onclick: () => adNoCand(s, w) }, old ? '用旧图' : '不要新图');
    const useBtn = h('button', { class: 'btn ink', type: 'button', disabled: busy, title: '用新图：' + (old ? '旧图连它的批注收进历史记录，' : '') + '新图算确认可用', onclick: () => adUseCand(s, it, w) }, '用新图');
    const pick = (file, cap, which, btns) => h('figure', { class: 'ad-fig' }, h('button', { class: 'ad-pic', type: 'button', title: file + '\n点开看大图', onclick: () => openImage(file, candActs(s, it, w, which)) }, thumbImg(file, 900)),
      h('figcaption', null, cap), h('div', { class: 'ad-use' }, btns));
    out.push(h('div', { class: 'ad-pair' }, old ? pick(w.img, '旧图 · 现在用着', 'old', [noBtn]) : null, pick(w.cand, old ? '新图 · 刚出的' : '新图', 'new', old ? [useBtn] : [noBtn, useBtn])));
    if (w.checkCand) out.push(note('AI 核图（新图）', w.checkCand, checkBad(w.checkCand)));
    out.push(note(users.length > 1 ? '共用' : '挑一张', users.length > 1 ? users.map(x => '第' + x + '段').join('、') + '都在用旧图：点「用新图」，几段一起换，用到它的提示词、样片标「待核对」' : old ? '两张挑一张用，没挑中的收进历史记录' : '不要的话，新图收进历史记录', users.length > 1));
  } else if (w.hasImg) {
    const ok = imgOk(it, w), txtScene = !!(it && it.文字), old = !!w.follow && OldImg.of(w);   // 旧了（11-23）
    out.push(fig(w.img, (old ? OldImg.tag(w) : ok ? '确认过可用' : '还没确认') + ' · 点图看大图、写批注', shellActs(s, it, w)));
    if (w.checkImg) out.push(note('AI 核图', w.checkImg, checkBad(w.checkImg)));
    if (w.geoNote) out.push(note('照图核 GEO', w.geoNote + (w.geoBack ? '。要拿回去批图：' + w.geoBack : ''), !!w.geoBack));
    if (w.hasImgNote) out.push(note('图上的批注', '写好了，还没交给 Codex 照着改', true));
    out.push(h('div', { class: 'ad-acts' }, ...[
      txtScene && skip !== 'scene' && !old ? h('button', { class: 'btn', type: 'button', onclick: () => adUseScene(s, it, w) }, '用上这张图') : null,
      old ? h('button', { class: 'btn', type: 'button', disabled: busy, title: '这张图照现在的' + (w.follow.描写 ? '描写' : w.follow.镜头 ? '镜头' : '字') + '也能用：算确认可用，不再标出来' + (txtScene ? '；这一段改用这张图' : ''), onclick: async () => { OldImg.keep(s, it, w); await flush(); pageNow(); } }, '旧图还能用') : null,
      skip === 'edit' || old && !w.hasImgNote ? null : h('button', { class: 'btn', type: 'button', disabled: busy, title: '先点开图、框出来写好批注，再点这里：开一个 Codex 新对话，以这张为底只改你说到的地方；在那个对话里接着聊，满意了说「定稿」就换上', onclick: () => adEditImg(s, w) }, '照批注改图'),
      txtScene || old ? null : ok ? h('button', { class: 'btn ghost', type: 'button', title: '确认的时间：' + (F.doc.可用[w.img] || '') + '。点一下取消', onclick: () => adConfirm(s, it, w, false) }, icon('check'), '确认过可用')
        : skip === 'confirm' ? null : h('button', { class: 'btn', type: 'button', disabled: busy, title: '这张图看过了、能用。确认过的图，别的段不用再确认', onclick: () => adConfirm(s, it, w, true) }, icon('check'), '确认可用'),
      ok && !txtScene && w.cat === '场景' && w.hasGeo ? h('button', { class: 'btn', type: 'button', disabled: busy, title: '图你满意了：让 AI 先判断 GEO 底稿和图对不对得上，对不上才照图改（改之前的那一版收进历史记录）。字框里改了没存的，先存上再核', onclick: () => adGeoCheck(s, w) }, '照图核 GEO') : null].filter(Boolean)));
  } else {
    out.push(h('div', { class: 'ad-ph' }, w.drawing ? [h('i', { class: 'wt-ring' }), h('span', { class: 'wt-t' }, '在 Codex 里出图：满意了在那个对话里说「定稿」，图换到这里')] : adIsTxt() ? '还没出图：这一份还是文字描写，先让 AI 改成出图提示词' : w.hasTxt || w.step === 'word' ? '还没出图：字批好了点「在 Codex 里出图」' : '还没出图：先有字，你批过点「在 Codex 里出图」'));
    if (it && KIND[it.类别] && it.own && !w.hasTxt && !w.writing && typeof pickFor === 'function') out.push(h('p', { class: 'fn-note' }, '已经有现成的图？', h('button', { class: 'fl-link', type: 'button', title: '关掉弹窗，在右边的挑图栏里挑', onclick: () => adPick(s, it) }, '挑现成的图')));
  }
  return out;
}
function adLogEls(s, w) {
  const rec = w.rec && Array.isArray(w.rec.过程) ? w.rec.过程 : [], seen = new Set(rec.map(x => x.目录));
  const all = [...rec, ...(AD.scan || []).filter(x => !seen.has(x.目录))].sort((a, b) => String(b.时间).localeCompare(String(a.时间))).slice(0, 12), H = AD.hist;
  const chip = (x, kind) => h('button', { class: 'btn sm ghost', type: 'button', title: x.n + '\n点一下看那一版', onclick: () => showText(at([F.name, ...H.dir, x.n])) }, kind + ' ' + x.tx);
  return { n: all.length, kids: [
    all.length ? h('ol', { class: 'ad-steps' }, all.map(x => h('li', null, h('span', { class: 'ad-t' }, String(x.时间).slice(5, 16)), h('b', null, x.事), x.渠道 ? h('span', { class: 'fn-note' }, x.渠道) : null,
      x.目录 ? h('button', { class: 'fl-link', type: 'button', onclick: () => adShowRun(x.目录, x.事 + ' · ' + String(x.时间).slice(5, 16)) }, '看过程：任务书、回复') : null)))
      : h('p', { class: 'fn-note' }, !rec.length && AD.scan === null ? '在找以前的记录…' : '还没有记录：AI 写过字、出过图，这里就有一行。'),
    H && (H.txt.length || H.geo.length) ? h('div', { class: 'ad-hist' }, h('span', { class: 'fn-note' }, '以前的版本（收在历史记录里，点一下看）：'), H.txt.map(x => chip(x, '字')), H.geo.map(x => chip(x, 'GEO'))) : null] };
}
/* 开着就跟着换：字的框子不重做（正在写的字、光标都留着），图和记录变了才重做 */
function adRepaint() {
  const u = AD.ui, s = sceneNow();
  if (!AD.q || !u || !s) return;
  if (assetState(s).st === 'lock') { adClose(); return; }   // 剧本又不算定稿了：资产锁上，弹窗也关掉
  const r = adFind(s);
  u.box.classList.toggle('gone', !r);
  if (!r) {
    AD.cur = null; AD.shotSig = ''; u.shot.replaceChildren();
    u.head.replaceChildren(h('div', { class: 'ad-title' }, h('b', null, '这一样不在了')), h('span', { class: 'sp' }), adX());
    u.gone.replaceChildren(h('p', null, '这一样不在第' + s.段 + '段里了：改了名、换了图，或者这一段不用它了。'), h('button', { class: 'btn ink', type: 'button', onclick: () => adClose() }, '关掉'));
    return;
  }
  const { it, w } = r, jobs = adJobs(s, w), list = adOrder(s, w), i = list.findIndex(x => x.w.img === w.img);
  AD.cur = { s, it, w };
  AD.nav = { list, i, todo: i >= 0 ? [...list.slice(i + 1), ...list.slice(0, i)].find(x => adNeedsYou(x.w)) || null : null };
  if (AD.key !== w.img) { Object.assign(AD, { key: w.img, base: null, mt: '', failMt: '', dirty: false, saveErr: '', outside: false, hist: null, histKey: '', imgSig: '', logSig: '' }); u.txt.scrollTop = 0; }
  document.title = '流水线 · ' + adLabel(w);
  u.box.setAttribute('aria-label', adLabel(w));
  const stamp = adStamp(w);
  if (!AD.loading && (!AD.base ? AD.failMt !== stamp : stamp !== AD.mt && !AD.outside)) { if (!AD.base || !AD.dirty) adReload(w); else AD.outside = true; }   // 字在外面改过：没改就换上，改了就提醒
  adHist(w);
  adScan(s, w);   // 以前没记进「过程」的那几回（一样只翻一次），和记了的合在一起摆
  const pt = [F.words.get(w.cand) || 0, fileTimeOf(w.img)].join('/');
  if (AD.picT && AD.picT !== pt) window.UI.dropThumbs();   // 图重出过、候选换了一张：缩小图重做
  AD.picT = pt;
  u.head.replaceChildren(...adHeadEls(s, it, w).filter(Boolean));
  u.box.classList.toggle('frame', !!w.frame);
  u.shot.classList.toggle('k-zhen', !!w.frame);   // 关键帧的颜色（--k）
  const sh = w.frame ? adShotOf(s, w) : null;   // 关键帧：标题下面那一排，变了才重摆（「绑到」选的那一镜不丢）
  const ssig = sh ? JSON.stringify([w.img, sh.b, sh.row, sh.T.loose, sh.T.rows.map(r => r.号 + r.写什么), [...sh.by.values()].map(x => [x.w.img, x.w.step, x.w.hasImg, x.w.hasTxt])]) : '';
  if (ssig !== AD.shotSig) { AD.shotSig = ssig; u.shot.replaceChildren(...(sh ? adShotEls(s, w, sh) : []).flat(Infinity).filter(Boolean)); }
  const now = adNowEls(s, it, w, jobs);
  u.now.className = 'adm-now ' + now.cls;
  u.now.replaceChildren(...now.kids.filter(Boolean));
  adPaintWord(s, it, w);   // 字，连底边（adPaintActs）
  const main = adMain(s, it, w), skip = main ? main.key : '';
  const isig = [skip, w.step, !!w.txtOnly, adIsTxt(), w.hasImg, w.hasCand, w.checkImg, w.checkCand, w.geoNote, w.geoBack, w.hasImgNote, imgOk(it, w), adBusy(s, w), pt, F.doc.可用[w.img] || '', OldImg.of(w) ? OldImg.tag(w) : ''].join('|');
  if (isig !== AD.imgSig) { AD.imgSig = isig; u.img.replaceChildren(...adImgEls(s, it, w, skip).filter(Boolean)); }
  const lsig = JSON.stringify([w.rec && w.rec.过程, AD.scan, AD.hist && [AD.hist.txt, AD.hist.geo]]);
  if (lsig !== AD.logSig) {
    AD.logSig = lsig;
    const lg = adLogEls(s, w);
    u.logSum.replaceChildren('AI 在这一样上做过的事' + (lg.n ? '（' + lg.n + ' 回）' : ''), h('small', null, '每一回的任务书、它的回复都留在 历史记录 / AI任务 里'));
    u.logBody.replaceChildren(...lg.kids.filter(Boolean));
  }
}
