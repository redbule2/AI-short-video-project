/* ============================================================
   流水线 · 各页共用（总览、设定、分场、剧本、资产 都先引这一份）
   流程：全片的梗概、人物、场景、道具 → 一场一场：写段落、定下来 → AI 扩写成剧本、你定稿 → 出资产图。
   这里放：流水线.json 怎么读、怎么存；各场走到哪一步；顶栏和步骤条；几页都用的小部件。
   每一页自己的东西写在那一页里。页面之间只靠网址（p＝项目，s＝第几场）和项目里的文件传话。
   一场就是一个「第N段」。东西放在哪：
     定稿的剧本/流水线.json              各页存的（页面写，AI 只读）：梗概、人物、场景、道具、每一场的剧本段落
     定稿的剧本/流水线_AI扩写.json        AI 补的人物、道具描写，照 GEO 写的场景段（AI 写，页面只读；你点「采用」才换进流水线）
     定稿的剧本/第N段/第N段_剧本.docx      AI 照这一场扩写（固定格式），在「剧本」那一步里看、写批注
     （镜头表那一步 2026-11-12 取消了：剧本定稿、资产确认以后直接写提示词，镜头在提示词的「分镜」里设计。老项目已有的镜头表不动，老页面里照旧能看）
     资产/第N段_资产清单.json             AI 列的：这一场还缺什么、出到哪一步（AI 写，页面只读）
   被换下来的剧本，和每定一场时的流水线，都留一版在 历史记录/定稿的剧本。
   这一份不包在函数里：下面起的名字各页直接用，各页自己的代码别再起一样的名字。
   ============================================================ */
'use strict';
const { C, LINK, FS, projects, scanScripts, two, stampNow, nowText, timeOf, debounce, isComposing, store, query, pageUrl, shellUrl } = window.Base;
const { h, icon, toast, dialog, dlgShell, confirmDlg, choiceDlg, field, copyText, hideHov, popover, closePop } = window.UI;
const RE_VP = /(^|_)视频提示词\.txt$/i;
const VID_RE = /\.(mp4|m4v|mov|webm)$/i;
const SHOTS_TAIL = '_批注截图';
const FILE = '流水线.json';
const NOTE_LINE = '项目管理「流水线」页存的。梗概：全片讲什么。人物、道具：全片的，一行一个，「资产」是它引用的那张图（引用了就是对上了）；道具有几个状态、引用了几张图时，「资产」是一个列表，一张图一个状态；「描写改」是这一行的描写最后改动的时间。场景：全片的场景描写；场景图：引用的场景图。可用：哪张图人看过、确认能用（图 → 确认的时间），确认过的图各场通用；图重出过、它那一行的描写改过，就要再确认。场：一场一场的，各场的「人物」「道具」写的是上面表里的名字，「场景图」是这一场用的场景图，「段落」是这一场的剧本段落（一段写什么、起什么作用），不是镜头；没有镜头表这一步，镜头在写提示词的时候设计，写在提示词的「分镜」里。「定稿」是这一场的段落定下来的时间；「剧本定稿」是人看过 AI 写的剧本以后点的时间，有它、而且不早于「定稿」和剧本最后改动的时间，才许出这一场的资产图；这一场要的图都确认可用了，才写提示词。人在页面上写，AI 只读；一场就是一个「第N段」。';
const IMG_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const CAT_ORDER = ['人物', '场景', '道具', '特效'];
const AI_FILE = '流水线_AI扩写.json';   // 定稿的剧本/流水线_AI扩写.json：AI 补的人物、道具描写，照 GEO 写的场景段（AI 写，页面只读；你点「采用」才换进流水线）
const GEO_ASK = '场景（照 scene-geo 用 GEO：先出 GEO 底稿给人审，再翻成场景段）';   // 交给 AI 时，场景这一样怎么说：明写用 GEO
const AI_OUT = '人物、道具、场景补出来的写进 定稿的剧本/' + AI_FILE + '，流水线.json 不改';   // 交给 AI 时，顺带说清写到哪
const GROWS = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('field-sizing', 'content');   // 文字框会不会自己长高
const BOM = String.fromCharCode(0xFEFF);
const unbom = t => t.startsWith(BOM) ? t.slice(1) : t;
/* 一行一个的两张表：人物、道具。cats：哪些类别的资产图归它引用 */
const LISTS = [
  { key: '人物', no: '二', title: '人　物', cats: c => c === '人物', nameLab: '叫法', namePh: '戏里怎么叫他，比如：爸爸', descPh: '多大年纪、长什么样、穿什么，一两处看得见的特征。', sub: '全片的，一行一个。引用了资产，就和那张图对上了', unit: '个' },
  { key: '道具', no: '四', title: '道　具', cats: c => c !== '人物' && c !== '场景', nameLab: '名字', namePh: '比如：面车', descPh: '什么样：结构、材质、颜色，新的还是用旧了的。', sub: '全片的，一行一个。有几个状态的，可以引用几张图', unit: '件', multi: true },   // multi：一个道具可以引用几张图，一个状态一张
];
const KIND = Object.fromEntries(LISTS.map(K => [K.key, K]));
const isSceneImg = it => it.类别 === '场景';

/* 这一页手上的东西：哪个项目、流水线.json 读出来的样子、存到哪一步了、AI 那边写好的各样 */
const F = {
  name: '', projects: [], pj: null, doc: null, bad: '', text: '', mtime: 0, exists: false,
  seg: '',   // 一场的页面（分场、剧本、资产）：正在做第几场
  ver: 0, savedVer: 0, saving: null, again: false, savedAt: null, err: '',
  assets: new Map(), names: new Map(), clips: new Map(), docs: new Map(), gone: new Set(), pool: [], dirs: new Set(), ticks: 0, tok: 0, checking: false,
  ai: { mtime: 0, data: null },
};
const at = parts => window.Base.at(parts);   // 项目名开头的路径 → 从总文件夹算起

const segOk = seg => /^[0-9]+(-[0-9]+)*$/.test(seg);
const segName = seg => '第' + seg + '段';
const stemOf = n => n.replace(/\.[^.]+$/, '');
const baseOf = file => stemOf(file.split('/').pop());
const str = v => typeof v === 'string' ? v : '';
const oneLine = t => String(t || '').trim().replace(/\s+/g, ' ');
const dirty = () => F.ver !== F.savedVer;
const flowRef = () => at([F.name, '定稿的剧本', FILE]).join('/');   // 交给 AI 时指的就是这一份
const scrollTop = () => document.scrollingElement.scrollTop;
const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && !!a.closest('.fl'); };
const cardOf = seg => document.querySelector('.fl-scene[data-seg="' + seg + '"]');
function fit(ta) { if (GROWS) return; ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; }
const fitAll = () => { if (!GROWS) setTimeout(() => document.querySelectorAll('.fl textarea').forEach(fit), 0); };
const byZh = (a, b) => a.localeCompare(b, 'zh', { numeric: true });
const catRank = c => CAT_ORDER.indexOf(c) + 1 || 99;
const OLD_NAME_CATS = ['人物', '道具', '场景', '特效'];
const tokenOf = it => {   // 文件名下划线前面那一段，就是戏里的叫法（童爸爸_三十出头 → 童爸爸）；老名字「项目_类别_叫法_资产」取当中的叫法
  let n = it.名称;
  for (const c of OLD_NAME_CATS) { const pre = F.name + '_' + c + '_'; if (F.name && n.startsWith(pre)) { n = n.slice(pre.length).replace(/_资产$/, ''); break; } }
  return n.split('_')[0];
};
const entryOf = (key, name) => F.doc[key].find(x => x.名 === name) || null;
const usedIn = (key, name) => F.doc.场.filter(s => s[key].includes(name)).map(s => s.段);

/* ---------- 流水线.json：读成能用的样子，写回去 ---------- */
const uniq = a => [...new Set((Array.isArray(a) ? a : []).map(x => str(x).trim()).filter(Boolean))];
const cleanFile = f => str(f).trim().replace(/\\/g, '/');
const files = v => uniq((Array.isArray(v) ? v : [v]).map(cleanFile));   // 「资产」：文件里一张图是一个字符串，几张图是一个列表；读进来一律当列表
/* 一个道具几张图时，这一张是哪个状态：文件名里叫法后面那一段（面车_夜里 → 夜里） */
const stateOf = (name, file) => { const b = baseOf(file); return b === name ? '' : b.startsWith(name + '_') ? b.slice(name.length + 1) : b; };
function normDoc(raw) {
  const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const { 说明, 梗概, 人物, 场景, 场景图, 道具, 场, 补细, 可用, ...rest } = d;   // 不认识的项原样留着
  const rows = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === 'object').map(x => { const { 名, 描写, 资产, ...more } = x; return { 名: str(名).trim(), 描写: str(描写), 资产: files(资产), ...more }; }).filter(x => x.名);
  const asked = o => Object.fromEntries(Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).filter(([k, v]) => k && typeof v === 'string' && v));
  const doc = { rest, 梗概: str(梗概), 人物: rows(人物), 场景: str(场景), 场景图: uniq(Array.isArray(场景图) ? 场景图.map(cleanFile) : []), 道具: rows(道具), 场: [],
    补细: { 人物: asked(补细 && 补细.人物), 道具: asked(补细 && 补细.道具), 场景: str(补细 && 补细.场景) } };   // 交给 AI 补过的：名字 → 什么时候交的
  doc.可用 = Object.fromEntries(Object.entries(可用 && typeof 可用 === 'object' && !Array.isArray(可用) ? 可用 : {}).filter(([k, v]) => k && typeof v === 'string' && v).map(([k, v]) => [cleanFile(k), v]));   // 哪张图你确认过可用：图 → 什么时候确认的
  const put = (key, 名, 描写, 资产) => {   // 以前写在各场里的，搬到全片的表里
    let e = doc[key].find(x => x.名 === 名);
    if (!e) doc[key].push(e = { 名, 描写: 描写 || '', 资产: 资产 ? [资产] : [] });
    else { if (!e.描写.trim() && 描写) e.描写 = 描写; if (!e.资产.length && 资产) e.资产 = [资产]; }
    return 名;
  };
  const seen = new Set();
  for (const s of Array.isArray(场) ? 场 : []) {
    if (!s || typeof s !== 'object') continue;
    const { 段, 名, 场景: 旧场景, 人物: 人, 道具: 物, 场景图: 图, 表达, 段落, 镜头: 旧镜头, 资产: 旧资产, 定稿, 扩写, 剧本定稿, ...more } = s;   // 「段落」早先叫「镜头」，里面的「写什么」早先叫「拍什么」
    const seg = C.normSeg(str(段));
    if (!segOk(seg) || seen.has(seg)) continue;
    seen.add(seg);
    const one = { 段: seg, 名: str(名), 人物: uniq(人), 道具: uniq(物), 场景图: uniq(Array.isArray(图) ? 图.map(cleanFile) : []), 表达: str(表达),
      段落: (Array.isArray(段落) && 段落.length ? 段落 : Array.isArray(旧镜头) ? 旧镜头 : []).filter(x => x && typeof x === 'object').map(x => { const { 写什么, 拍什么, 作用, ...m } = x; return { 写什么: str(写什么 !== undefined ? 写什么 : 拍什么), 作用: str(作用), ...m }; }),
      定稿: str(定稿), 扩写: str(扩写), 剧本定稿: str(剧本定稿), ...more };
    // 早几版把场景、人物写在每一场里：人物一行一个搬进人物表，场景那段话并进全片的场景，引入过的图各归各位
    if (typeof 人 === 'string') for (const line of 人.split(/\r?\n/)) {
      const m = /^([^，,：:（(\s]{1,12})[，,：:\s]*(.*)$/.exec(line.trim());
      if (m) one.人物.push(put('人物', m[1], m[2]));
    }
    if (typeof 旧场景 === 'string' && 旧场景.trim() && !doc.场景.includes(旧场景.trim())) doc.场景 = (doc.场景.trim() ? doc.场景.trim() + '\n' : '') + 旧场景.trim();
    for (const x of Array.isArray(旧资产) ? 旧资产 : []) {
      if (!x || typeof x !== 'object' || !cleanFile(x.文件)) continue;
      const file = cleanFile(x.文件), name = (str(x.名称).trim() || baseOf(file)).split('_')[0];
      if (x.类别 === '场景') { if (!doc.场景图.includes(file)) doc.场景图.push(file); one.场景图.push(file); }
      else { const key = x.类别 === '人物' ? '人物' : '道具'; one[key].push(put(key, name, '', file)); }
    }
    one.人物 = uniq(one.人物); one.道具 = uniq(one.道具); one.场景图 = uniq(one.场景图);
    doc.场.push(one);
  }
  doc.场.sort((a, b) => C.segCompare(a.段, b.段));
  return doc;
}
function serialize(doc) {
  const rows = a => a.filter(x => x.名.trim()).map(x => ({ ...x, 名: x.名.trim(), 描写: x.描写.trim(), 资产: x.资产.length > 1 ? x.资产 : x.资产[0] || '' }));   // 一张图还写成一个字符串（和以前一样），几张才写成列表
  const 场 = doc.场.map(s => ({ ...s, 名: s.名.trim(), 表达: s.表达.trim(), 段落: s.段落.map(x => ({ ...x, 写什么: x.写什么.trim(), 作用: x.作用.trim() })) }));
  const b = doc.补细, has = Object.keys(b.人物).length || Object.keys(b.道具).length || b.场景;
  return JSON.stringify({ 说明: NOTE_LINE, 梗概: doc.梗概.trim(), 人物: rows(doc.人物), 场景: doc.场景.trim(), 场景图: doc.场景图, 道具: rows(doc.道具), 场, ...(has ? { 补细: b } : {}), 可用: doc.可用, ...doc.rest }, null, 2) + '\n';   // 「可用」空了也写上：两个页面合并时，一边全取消了、一边新确认了，才分得清
}
const readJson = async p => JSON.parse(unbom(C.decodeText((await FS.read(p)).buf).text));
/* 看一个项目里的文件夹（路径从项目里面写起）：一层一层往下看，哪一层没有就当它是空的，不去碰不存在的 */
function lister(name) {   // 列不出来（本机服务断了、正在重开）记在 .failed 上：用的地方看到它，就别拿半截的当真
  const cache = new Map();
  const raw = k => { if (!cache.has(k)) cache.set(k, FS.list(at(k ? [name, ...k.split('/')] : [name])).catch(e => { if (!(e && e.message === '没有这个文件')) fn.failed = true; return []; })); return cache.get(k); };
  const fn = async k => {
    const parts = k.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) if (!(await raw(parts.slice(0, i).join('/'))).some(e => e.kind === 'directory' && e.name === parts[i])) return [];
    return raw(parts.join('/'));
  };
  fn.failed = false;
  return fn;
}
const hasFile = async (name, parts) => (await lister(name)(parts.slice(0, -1).join('/'))).some(e => e.kind === 'file' && e.name === parts[parts.length - 1]);
/* 项目里现成的资产：全局资产各类别里的图 */
async function loadPool(name) {
  const ls = lister(name), out = [];
  const cats = (await ls('资产/全局资产')).filter(e => e.kind === 'directory' && !e.name.endsWith(SHOTS_TAIL)).map(e => e.name).sort((a, b) => (catRank(a) - catRank(b)) || byZh(a, b));
  for (const c of cats) for (const e of (await ls('资产/全局资产/' + c)).filter(x => x.kind === 'file' && IMG_RE.test(x.name)).sort((a, b) => byZh(a.name, b.name)))
    out.push({ 类别: c, 名称: stemOf(e.name), 文件: '资产/全局资产/' + c + '/' + e.name });
  if (ls.failed) throw new Error('本机服务连不上');   // 有一层没列出来：留着手里原来的
  return out;
}

/* 流水线.json 在不在、什么时候改的。要分清「没有这个文件」和「问不到」（本机服务断了、正在重开）：
   问不到的时候什么都别动，不能当成「没有」——那样页面会换成一张空白的流水线，再存一下就把真的冲掉了 */
async function flowStat(name) {
  try { const j = await (await LINK.req('GET', LINK.url(at([name, '定稿的剧本', FILE])) + '?stat')).json(); return { ok: true, has: true, mtime: j.mtime || 0 }; }
  catch (e) { return e && e.message === '没有这个文件' ? { ok: true, has: false, mtime: 0 } : { ok: false, has: false, mtime: 0 }; }
}
async function load(name, keep) {
  const tok = ++F.tok, v0 = F.ver, same = !!keep && F.name === name;
  let pj;
  try { pj = await scanScripts(name); }
  catch (e) { toast('读不了这个项目：' + e.message, 'err'); return false; }
  const p = at([name, '定稿的剧本', FILE]);
  const fst = await flowStat(name);
  if (!fst.ok) { if (!keep) toast('本机服务连不上，流水线没读出来。过一会儿刷新页面', 'err'); return false; }   // 问不到：留着手里原来的
  let doc = normDoc(null), text = '', mtime = 0, exists = false, bad = '';
  if (fst.has) {
    exists = true;
    let r;
    try { r = await FS.read(p); }
    catch (e) { if (!keep) toast('本机服务连不上，流水线没读出来。过一会儿刷新页面', 'err'); return false; }   // 问到了却没读到（服务正好断了、文件正被换上）：和问不到一样，下回再读，不当它坏了
    mtime = r.mtime || fst.mtime; text = C.decodeText(r.buf).text;
    try { doc = normDoc(JSON.parse(unbom(text))); } catch (e) { bad = e.message; }
  }
  if (tok !== F.tok) return false;
  if (same && (F.ver !== v0 || F.saving)) return false;   // 读的这一会儿你又动了：不拿盘上的整份换掉（存的时候两边会并在一起）
  if (!keep || F.name !== name) { F.assets.clear(); F.names.clear(); F.docs.clear(); F.gone = new Set(); F.dirs = new Set(); F.savedAt = null; F.ai = { mtime: 0, data: null }; }
  Object.assign(F, { name, pj, doc, bad, text, mtime, exists, ver: 0, savedVer: 0, err: '', seenAt: Date.now() });
  markBase();
  loadFolds(); loadNo();
  try { const pool = await loadPool(name); if (tok === F.tok) F.pool = pool; } catch (e) { if (tok === F.tok && !same) F.pool = []; }   // 同一个项目重读时没列出来：留着原来的
  await loadSides();
  return tok === F.tok;
}

/* 存盘：边写边存。只有动过才写；没有这个文件的项目，不写字就不建 */
/* 人物、道具哪一行的描写、图动过，哪一场换了出场的：各记一个时间。用到它的各场，资产那一步会标「待核对」 */
const rowSig = e => e.描写.trim() + '｜' + e.资产.join('、');
const castSig = s => LISTS.map(K => s[K.key].join('、')).join('｜') + '｜' + s.场景图.join('、');
function markBase() {
  F.base = new Map();
  if (!F.doc) return;
  for (const K of LISTS) for (const e of F.doc[K.key]) { F.base.set(K.key + '/' + e.名, rowSig(e)); F.base.set(K.key + '/' + e.名 + '/描写', e.描写.trim()); }
  for (const s of F.doc.场) F.base.set('场/' + s.段, castSig(s));
}
function stampChanges() {
  if (!F.base) return markBase();
  const now = nowText();
  for (const K of LISTS) for (const e of F.doc[K.key]) {
    const k = K.key + '/' + e.名, sig = rowSig(e), was = F.base.get(k);
    if (was !== undefined && was !== sig) e.改 = now;
    F.base.set(k, sig);
    const dk = k + '/描写', dsig = e.描写.trim(), dwas = F.base.get(dk);   // 只是描写改了：它的图对不对得上要再看，那张图的「可用」不算数了
    if (dwas !== undefined && dwas !== dsig) e.描写改 = now;
    F.base.set(dk, dsig);
  }
  for (const s of F.doc.场) {
    const k = '场/' + s.段, sig = castSig(s), was = F.base.get(k);
    if (was !== undefined && was !== sig) s.出场改 = now;
    F.base.set(k, sig);
  }
}
/* 两个页面同时开着同一个项目（右边窗格一个、Chrome 里一个）：后存的那一页不能拿自己手里旧的整份去盖。
   存之前看一眼盘上那份是不是这一页读过以后又被改了；是，就把两边的改动并在一起再写：
   这一页没动的地方用盘上的，这一页动过的用这一页的；人物、道具按名字一行一行比，场按第几场比，「可用」这类按键比 */
const isPlainObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const jsonSame = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const FLOW_ROW_KEY = { 人物: '名', 道具: '名', 场: '段' };   // 最外面这三样是一行一行的表：按这个键认行
function mergeFlow3(base, mine, theirs, depth, rowKey) {
  if (jsonSame(mine, base)) return theirs;      // 这一页没动：用盘上的
  if (jsonSame(theirs, base)) return mine;      // 盘上没动：用这一页的
  if (isPlainObj(mine) && isPlainObj(theirs)) {
    const b = isPlainObj(base) ? base : {}, out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs)])) { const v = mergeFlow3(b[k], mine[k], theirs[k], depth + 1, depth === 0 ? FLOW_ROW_KEY[k] : ''); if (v !== undefined) out[k] = v; }
    return out;
  }
  if (rowKey && Array.isArray(mine) && Array.isArray(theirs)) {
    const idx = a => new Map((Array.isArray(a) ? a : []).filter(isPlainObj).map(x => [x[rowKey], x]));
    const B = idx(base), M = idx(mine), T = idx(theirs), out = [];
    for (const [k, m] of M) { const v = mergeFlow3(B.get(k), m, T.get(k), depth + 1, ''); if (v !== undefined) out.push(v); }
    for (const [k, t] of T) if (!M.has(k)) { const v = mergeFlow3(B.get(k), undefined, t, depth + 1, ''); if (v !== undefined) out.push(v); }   // 盘上新加的行留下；这一页删掉的行不回来
    return out;
  }
  return mine;   // 同一处两边都改了：以这一页为准
}
/* 把并好的那份换进 F.doc：对象、表里的行尽量留着原来那个（各页的按钮手里抓着它们），只换里面的值 */
function syncFlowInto(dst, src, depth) {
  for (const k of Object.keys(dst)) if (!(k in src)) delete dst[k];
  for (const [k, v] of Object.entries(src)) {
    const d = dst[k], id = depth === 0 ? FLOW_ROW_KEY[k] : '';
    if (isPlainObj(v) && isPlainObj(d)) syncFlowInto(d, v, depth + 1);
    else if (Array.isArray(v) && Array.isArray(d)) {
      let next;
      if (id) next = v.map(x => { const old = isPlainObj(x) ? d.find(y => isPlainObj(y) && y[id] === x[id]) : null; if (old) { syncFlowInto(old, x, depth + 1); return old; } return x; });
      else if (v.length === d.length && v.every(isPlainObj) && d.every(isPlainObj)) { v.forEach((x, i) => syncFlowInto(d[i], x, depth + 1)); continue; }
      else next = v;
      d.length = 0; d.push(...next);
    } else dst[k] = v;
  }
}
async function save() {
  if (F.saving) { F.again = true; return F.saving; }
  if (!F.doc || F.bad || !dirty()) return;
  stampChanges();
  const name = F.name;
  let v = F.ver, merged = false;
  F.saving = (async () => {
    try {
      if (serialize(F.doc) !== F.text) {
        const p = at([name, '定稿的剧本', FILE]), fst = await flowStat(name);
        if (!fst.ok) throw new Error('本机服务连不上');
        if (F.name !== name) return;
        if (fst.has && !F.exists) throw new Error('盘上已经有一份流水线，这一页读的时候没读到。刷新页面重新读，再接着改');
        let theirs = null;
        if (fst.has && fst.mtime !== F.mtime) theirs = JSON.parse(unbom(C.decodeText((await FS.read(p)).buf).text));   // 别的页面改过了
        if (F.name !== name) return;
        // 从这里到发出去不再等：这一刻页面上是什么样，就存什么样
        stampChanges(); v = F.ver;
        let text = serialize(F.doc);
        if (theirs) {
          let base = {};
          try { base = JSON.parse(serialize(normDoc(JSON.parse(unbom(F.text) || '{}')))); } catch (e) { base = {}; }   // 三份都照这一版的样子规整一遍再比：盘上是老格式时，不把没动的地方当成这一页改的
          theirs = JSON.parse(serialize(normDoc(theirs)));
          syncFlowInto(F.doc, normDoc(mergeFlow3(base, JSON.parse(text), theirs, 0, '')), 0);
          text = serialize(F.doc); merged = true;
        }
        const st = await FS.write(p, C.encodeText(text));
        if (F.name !== name) return;
        F.text = text; F.mtime = st ? st.mtime : 0; F.savedAt = new Date(); F.seenAt = Date.now();
        F.exists = true;
        if (merged) markBase();   // 并进来的是别的页面的改动，不算这一页改的：不给它们记「改」的时间
      }
      if (F.name === name) { F.savedVer = v; F.err = ''; }
    } catch (e) { if (F.name === name) { const was = F.err; F.err = e.message; if (was !== e.message) toast('流水线没存上：' + e.message, 'err'); } }   // 隔两秒会再试：同一个错只说一回
  })();
  try { await F.saving; }
  finally {
    F.saving = null; paintStatus();
    if (merged) { toast('另一个页面也改了流水线，两边的改动并在一起了'); redrawSoon(); }
    if (F.again) { F.again = false; if (dirty()) save(); }
  }
}
/* 并进别的页面的改动以后马上重画：页面上的格子还连着换掉之前的那一份，不重画的话，接着写的字存不上，或者把对方的字盖掉。
   小窗、弹窗开着就等它们关了再画（F.redraw，tick 里补）；光标放回原来那一格 */
function redrawSoon() {
  if (window.UI.popOpen || document.querySelector('.mask:not(.out)')) { F.redraw = true; return; }
  const all = () => [...(document.getElementById('fl-body') || document.body).querySelectorAll('input, textarea')];
  const a = document.activeElement, i = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? all().indexOf(a) : -1;
  let s0 = null, s1 = null;
  try { if (i >= 0) { s0 = a.selectionStart; s1 = a.selectionEnd; } } catch (e) { /* 这种格子没有选区 */ }
  rerender();
  const b = i >= 0 ? all()[i] : null;
  if (b && b !== a) { b.focus(); try { if (s0 != null) b.setSelectionRange(s0, s1); } catch (e) { /* 同上 */ } }
}
const saveLater = debounce(save, 600);
function touch() { F.ver++; paintStatus(); saveLater(); }
async function flush() {
  for (let i = 0; i < 3 && (dirty() || F.saving); i++) { await save(); if (F.err) break; }
}

/* ---------- 收起：多行的格子写好了可以收成一行，点一下再展开。收没收起记在这台电脑的浏览器里 ---------- */
const FOLD = { key: '', set: new Set() };
function loadFolds() {
  FOLD.key = 'antou:flow:fold:' + LINK.root + '/' + F.name;
  try { const a = JSON.parse(localStorage.getItem(FOLD.key) || '[]'); FOLD.set = new Set(Array.isArray(a) ? a : []); } catch (e) { FOLD.set = new Set(); }
}
function setFold(k, on) {
  on ? FOLD.set.add(k) : FOLD.set.delete(k);
  try { localStorage.setItem(FOLD.key, JSON.stringify([...FOLD.set].slice(-400))); } catch (e) { /* 记不下就下回都展开 */ }
}
/* 一个能收起的格子：box 里是那个多行的字；收起来只留一行 peek() 给的字。返回「收起 / 展开」那个小按钮 */
function folder(k, box, peek, onOpen) {
  const line = h('button', { class: 'fl-peek', type: 'button', title: '点一下展开' });
  const tog = h('button', { class: 'fl-fold', type: 'button', tabindex: '-1' });
  const paint = () => {
    const f = FOLD.set.has(k);
    box.classList.toggle('fold', f);
    tog.textContent = f ? '展开' : '收起';
    if (f) line.textContent = oneLine(peek()) || '还没写';
  };
  const set = (on, focus) => { setFold(k, on); paint(); if (!on) { fitAll(); if (focus && onOpen) onOpen(); } };
  tog.addEventListener('click', () => set(!FOLD.set.has(k)));
  line.addEventListener('click', () => set(false, true));
  box.classList.add('fl-fb');
  box.append(line);
  paint();
  return tog;
}

/* ---------- 一场定下来以后的几样：剧本和镜头表、AI 列的资产清单、提示词文件夹里有哪些稿 ---------- */
function normAssets(j) {
  const arr = Array.isArray(j) ? j : j && Array.isArray(j.资产) ? j.资产 : [];
  return arr.filter(x => x && typeof x === 'object' && str(x.名称).trim())
    .map(x => ({ 类别: str(x.类别).trim(), 名称: str(x.名称).trim(), 文件: cleanFile(x.文件), 状态: str(x.状态).trim(), 说明: str(x.说明).trim(), at: '' }));
}
/* 写在清单、流水线里的路径 → 项目里的「资产/…」；不在 资产 里的不认 */
function assetParts(file) {
  const parts = String(file).split('/').filter(Boolean);
  if (parts[0] === '项目') parts.shift();
  if (parts[0] === F.name) parts.shift();
  return parts[0] === '资产' && parts.length > 1 && !parts.some(x => x === '.' || x === '..' || x.includes(':')) ? parts : null;
}
/* AI 清单里的每一样在不在：写了文件的看那个文件；没写的按名字去 全局资产/类别 和这一场的文件夹里找 */
async function resolveAssets(seg, rec, ls) {
  let changed = false;
  for (const it of rec.items) {
    let p = null;
    if (it.文件) {
      const parts = assetParts(it.文件);
      if (parts && (await ls(parts.slice(0, -1).join('/'))).some(e => e.kind === 'file' && e.name === parts[parts.length - 1])) p = parts;
    } else {
      for (const dir of [it.类别 ? '资产/全局资产/' + it.类别 : '', '资产/' + segName(seg)].filter(Boolean)) {
        const e = (await ls(dir)).find(x => x.kind === 'file' && IMG_RE.test(x.name) && stemOf(x.name) === it.名称);
        if (e) { p = [...dir.split('/'), e.name]; break; }
      }
    }
    const k = p ? p.join('/') : '';
    if (it.at !== k) { it.at = k; changed = true; }
  }
  return changed;
}
const aiKey = it => (it.类别 === '人物' ? '人物' : it.类别 === '场景' ? '场景' : '道具');
/* 读一遍：引用的图还在不在；定下来的各场的清单、剧本、提示词。有变化的那几场返回出来 */
async function loadSides() {
  const name = F.name, changed = new Set();
  if (!F.doc) return changed;
  const ls = lister(name);
  const fileTime = async f => { const parts = assetParts(f); if (!parts) return 0; const ent = (await ls(parts.slice(0, -1).join('/'))).find(e => e.kind === 'file' && e.name === parts[parts.length - 1]); return ent ? ent.mtime || 0 : 0; };
  let linked = false;
  const out = () => { if (linked && F.name === name) { linked = false; touch(); for (const s of F.doc.场) changed.add(s.段); changed.add('*'); } return changed; };   // 半路停下也把替你挂上的图存上
  const top = await ls('资产');
  if (F.name !== name || ls.failed) return changed;   // 列不出来（本机服务断了一下）：这一轮什么都不改，不把列不出来的当成没有
  F.dirs = new Set(top.filter(e => e.kind === 'directory').map(e => e.name));
  const lists = new Set(top.filter(e => e.kind === 'file').map(e => e.name));
  // 表里引用的图，文件还在不在
  const gone = new Set(), itime = new Map();
  for (const file of [...LISTS.flatMap(K => F.doc[K.key].flatMap(x => x.资产)), ...F.doc.场景图, ...F.doc.场.flatMap(s => s.场景图)].filter(Boolean)) {
    const parts = assetParts(file);
    const ent = parts ? (await ls(parts.slice(0, -1).join('/'))).find(e => e.kind === 'file' && e.name === parts[parts.length - 1]) : null;
    if (!ent) gone.add(file); else itime.set(file.toLowerCase(), ent.mtime || 0);
  }
  if (F.name !== name || ls.failed) return changed;
  const isig = [...itime].map(([k, v]) => k + '@' + v).sort().join('|');
  if (isig !== F.imgSig) { const first = F.imgSig === undefined; F.imgSig = isig; F.imgTime = itime; if (!first) { window.UI.dropThumbs(); for (const s of F.doc.场) changed.add(s.段); changed.add('*'); } }
  if ([...gone].sort().join('|') !== [...F.gone].sort().join('|')) { F.gone = gone; for (const s of F.doc.场) changed.add(s.段); changed.add('*'); }
  // AI 补的描写、照 GEO 写的场景段
  if ((await ls('定稿的剧本')).some(e => e.kind === 'file' && e.name === AI_FILE)) {
    const p = at([name, '定稿的剧本', AI_FILE]), st = await FS.stat(p);
    if (st && st.mtime !== F.ai.mtime) {
      let data = null;
      try { data = normAi(await readJson(p)); } catch (e) { /* 读不了就当没有 */ }
      if (F.name !== name) return changed;
      F.ai = { mtime: st.mtime, data }; changed.add('*');
    }
  } else if (F.ai.mtime) { F.ai = { mtime: 0, data: null }; changed.add('*'); }
  let rescan = false;
  for (const s of F.doc.场) {
    if (!s.定稿) continue;
    const seg = s.段, fn = segName(seg) + '_资产清单.json', old = F.assets.get(seg);
    // AI 列的资产清单
    if (!lists.has(fn)) { if (old) { F.assets.delete(seg); changed.add(seg); } }
    else {
      const p = at([name, '资产', fn]), st = await FS.stat(p);
      let rec = old;
      if (st && (!old || old.mtime !== st.mtime)) {
        rec = { mtime: st.mtime, items: [], bad: '' };
        try { rec.items = normAssets(await readJson(p)); } catch (e) { rec.bad = e.message; }
        if (F.name !== name) return out();
        F.assets.set(seg, rec); changed.add(seg);
      }
      const moved = rec ? await resolveAssets(seg, rec, ls) : false;
      if (ls.failed) return out();
      if (moved) changed.add(seg);
      // AI 把图出好了：表里同名的那一行还没有图（或者挂的图都不在了），替你对上
      if (rec) for (const it of rec.items) {
        if (!it.at || !KIND[aiKey(it)]) continue;
        const K = KIND[aiKey(it)], e = entryOf(K.key, it.名称);   // 道具可以几张图：清单里同一个名字的图，出好一张对上一张
        if (!e) continue;
        if (Array.isArray(e.不用) && e.不用.includes(it.at)) {   // 这张图你说过「不引用」：不再替你对上。除非后来重出过（让 AI 出的时候记下了旧图的时间，文件时间变了就是新出的那张）
          const was = e.不用时 && e.不用时[it.at], now = await fileTime(it.at);
          if (ls.failed) return out();
          if (!was || !now || now === was) continue;
          e.不用 = e.不用.filter(f => f !== it.at); if (!e.不用.length) delete e.不用;
          delete e.不用时[it.at]; if (!Object.keys(e.不用时).length) delete e.不用时;
          linked = true;
        }
        if (K.multi ? e.资产.some(f => f.toLowerCase() === it.at.toLowerCase()) : e.资产.some(f => !gone.has(f))) continue;
        e.资产 = K.multi ? [...e.资产, it.at] : [it.at];   // 人物只挂一张：原来挂的那张不在了，换成新出的
        const t = await fileTime(it.at);
        if (t && F.imgTime) F.imgTime.set(it.at.toLowerCase(), t);   // 新挂上的图是什么时候出的：「可用」要拿它比，不然一出来就显示确认过
        linked = true;
      }
    }
    // 剧本（Word）：AI 写好了、换过了，都要看得出来
    const docx = (await ls('定稿的剧本/' + segName(seg))).filter(e => e.kind === 'file' && /\.docx$/i.test(e.name) && !e.name.startsWith('~$'));
    const sts = await Promise.all(docx.map(e => FS.stat(at([name, '定稿的剧本', segName(seg), e.name]))));
    if (F.name !== name || ls.failed) return out();
    const dsig = docx.map((e, i) => e.name + '@' + (sts[i] ? sts[i].mtime : 0)).sort().join('|'), dwas = F.docs.get(seg);
    if (dwas !== dsig) { F.docs.set(seg, dsig); if (dwas !== undefined) { changed.add(seg); rescan = true; } }
    // 提示词文件夹里的稿
    const pfiles = (await ls('提示词/' + segName(seg))).filter(e => e.kind === 'file'), names = pfiles.map(e => e.name).sort();
    if (F.name !== name || ls.failed) return out();
    const sig = pfiles.map(e => e.name + '@' + (e.mtime || 0)).sort().join('|'), was = F.names.get(seg);
    if (!was || was.sig !== sig) { F.names.set(seg, { sig, set: new Set(names), time: new Map(pfiles.map(e => [e.name, e.mtime || 0])) }); changed.add(seg); }
    // 这一场的样片：成片/第N段 里的视频，和它们旁边的批注、AI 建议
    const vfiles = (await ls('成片/' + segName(seg))).filter(e => e.kind === 'file'), vf = vfiles.map(e => e.name).sort(byZh);
    if (F.name !== name || ls.failed) return out();
    const vsig = vfiles.map(e => e.name + '@' + (e.mtime || 0)).sort().join('|'), vwas = F.clips.get(seg);
    if (!vwas || vwas.sig !== vsig) { F.clips.set(seg, { sig: vsig, all: new Set(vf), vids: vf.filter(n => VID_RE.test(n)), time: new Map(vfiles.map(e => [e.name, e.mtime || 0])) }); changed.add(seg); }
  }
  out();
  if (rescan) { try { const pj = await scanScripts(name); if (F.name === name) F.pj = pj; } catch (e) { /* 下回再读 */ } }
  return changed;
}

function normAi(j) {
  const d = j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  const rows = o => Object.fromEntries(Object.entries(o && typeof o === 'object' && !Array.isArray(o) ? o : {}).map(([k, v]) => [k, { 描写: str(v && v.描写).trim(), 时间: str(v && v.时间) }]).filter(([, v]) => v.描写));
  const sc = d.场景 && typeof d.场景 === 'object' ? d.场景 : {};
  return { 人物: rows(d.人物), 道具: rows(d.道具), 场景: { 描写: str(sc.描写).trim(), 底稿: cleanFile(sc.底稿), 时间: str(sc.时间) } };
}
/* AI 补的你说过「不要」的，记在这台电脑的浏览器里，不再摆出来 */
const NO = { key: '', set: new Set() };
function loadNo() {
  NO.key = 'antou:flow:no:' + LINK.root + '/' + F.name;
  try { const a = JSON.parse(localStorage.getItem(NO.key) || '[]'); NO.set = new Set(Array.isArray(a) ? a : []); } catch (e) { NO.set = new Set(); }
}
const noKey = (key, name, text) => key + '/' + name + '/' + text.length + ':' + text.slice(0, 16);
function sayNo(key, name, text) { NO.set.add(noKey(key, name, text)); try { localStorage.setItem(NO.key, JSON.stringify([...NO.set].slice(-300))); } catch (e) { /* 记不下就算了 */ } }
/* AI 给这一样补的字：还没采用、也没说过不要的才算 */
function aiText(key, name) {
  const a = F.ai.data, v = !a ? null : key === '场景' ? a.场景 : a[key] && a[key][name];
  const t = v && v.描写 || '';
  const cur = key === '场景' ? F.doc.场景 : (entryOf(key, name) || { 描写: '' }).描写;
  return t && t !== cur.trim() && !NO.set.has(noKey(key, name || '', t)) ? t : '';
}
/* 交给 AI 了、它还没补出来 */
function aiWaiting(key, name) {
  if (AI.ok) {   // 有 AI 任务的服务：看这一样是不是正有任务在做
    const j = key === '场景' ? jobOf('场景GEO') : jobOf('补细', null, x => (x[key] || []).includes(name));
    return jobLive(j) ? nowText(new Date(j.建)).slice(5, 16) : '';
  }
  const b = F.doc.补细, asked = timeOf(key === '场景' ? b.场景 : b[key][name]);
  if (!asked) return '';
  const a = F.ai.data, v = !a ? null : key === '场景' ? a.场景 : a[key] && a[key][name];
  const got = v && v.描写 ? (timeOf(v.时间) || F.ai.mtime) : 0;
  return got >= asked ? '' : (key === '场景' ? b.场景 : b[key][name]).slice(5, 16);
}
function promptsOf(seg) {
  const rec = F.names.get(seg);
  if (!rec) return [];
  return [...rec.set].filter(n => RE_VP.test(n)).map(n => {
    const stem = n.replace(/\.txt$/i, '');
    return { name: n, label: stem.replace(/_?视频提示词$/i, '').replace(/_/g, ' ') || '整场', draft: rec.set.has(stem + '_写稿.json') };
  });
}

/* ---------- 小图、悬停看大图：路径从项目里面写起（资产/全局资产/人物/x.png） ---------- */
const thumbImg = (file, w) => window.UI.thumbImg(at([F.name, ...file.split('/')]), w);
const hoverable = (el, file, title) => window.UI.hoverable(el, at([F.name, ...file.split('/')]), title || baseOf(file), file);

/* ---------- 借「项目管理」那一页的本事：看图写批注、看以前的剧本。整页盖上来，看完点「回到流水线」 ---------- */
let SHELL = null;
function openShell(parts, title, extra) {   // extra(close)：顶上那一条里另外摆的东西
  closePop(); hideHov();
  if (SHELL) SHELL.remove();
  const close = () => { if (!SHELL) return; SHELL.remove(); SHELL = null; document.body.classList.remove('wf-covered'); refresh(); };
  SHELL = h('div', { class: 'wf-shell' },
    h('div', { class: 'wf-shell-h' }, h('button', { class: 'btn sm ink', type: 'button', onclick: close }, '← 回到流水线'), h('span', { class: 'wf-shell-t' }, title || ''), h('span', { class: 'sp' }),
      extra ? [extra(close)].flat(Infinity).filter(Boolean) : null,
      h('a', { class: 'fl-link', href: shellUrl(parts), title: '到「项目管理」里打开：左边有菜单和文件夹' }, '到项目管理里打开')),
    h('iframe', { class: 'wf-shell-frame', title: title || '项目管理', src: shellUrl(parts, true) }));
  document.body.append(SHELL); document.body.classList.add('wf-covered');
}
const openImage = (file, extra) => openShell(at([F.name, ...file.split('/')]), baseOf(file), extra);
/* 你来写提示词：把写稿那一页（通用工具/项目管理_写稿试用.html）整页盖上来。它自己读写文件、自己开 AI 任务（请 AI 批、要关键词、把批注交给 AI 改）；
   写完点「回到流水线」，没存的字先存上 */
function openWrite(seg, name) {
  closePop(); hideHov();
  if (SHELL) SHELL.remove();
  const frame = h('iframe', { class: 'wf-shell-frame', title: '写提示词', src: encodeURI('/通用工具/项目管理_写稿试用.html') + '#open=' + [F.name, '提示词', segName(seg), name].map(encodeURIComponent).join('/') });
  const close = async () => {
    if (!SHELL) return;
    try { const w = frame.contentWindow; if (w && typeof w.save === 'function') await w.save(); } catch (e) { /* 那一页没开起来 */ }
    if (SHELL) SHELL.remove();
    SHELL = null; document.body.classList.remove('wf-covered'); refresh();
  };
  SHELL = h('div', { class: 'wf-shell' },
    h('div', { class: 'wf-shell-h' }, h('button', { class: 'btn sm ink', type: 'button', onclick: close }, '← 回到流水线'),
      h('span', { class: 'wf-shell-t' }, '第' + seg + '场 · ' + (name.replace(/_?视频提示词\.txt$/i, '').replace(/_/g, ' ') || '整场') + ' · 你来写'), h('span', { class: 'sp' }),
      h('span', { class: 'fn-note' }, '本段事件和每一镜你写；别的 AI 铺好，要它改就点那一行写批注。')),
    frame);
  document.body.append(SHELL); document.body.classList.add('wf-covered');
}
/* 看这一段现有的剧本、镜头表（在「项目管理」的剧本那一样里，能写批注） */
function seeOld(seg, kind) {
  const d = docsOf(seg), e = kind === 'shots' ? d.shots : d.script || d.combined;
  if (e) openShell(at(e.path), '第' + seg + '段 · ' + (kind === 'shots' ? '镜头表' : '剧本'));
}
/* 一份文字（GEO 底稿这类）：弹出来看 */
async function showText(parts) {
  let text;
  try { text = C.decodeText((await FS.read(parts)).buf).text; } catch (e) { toast('打不开：' + e.message, 'err'); return; }
  await dialog(close => { const el = dlgShell(parts[parts.length - 1], parts.slice(1).join(' / '), [h('pre', { class: 'mdview' }, text)], [h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close() }, '好了')]); el.classList.add('wide'); return el; });
}

/* ---------- AI 任务：交给本机的 AI（Claude、Codex、DeepSeek），页面上看得见它做到哪了 ----------
   点一下就在本机服务里开一个任务（POST /api/job），服务去调 AI、做完落盘；这里隔两秒问一次进度。
   用哪个 AI，在顶栏右边选，记在这台电脑的浏览器里。本机服务是旧版（没有 AI 任务）时，还是老办法：排进队里等对话里的 AI 来取 */
const AI = { ok: false, channels: [], jobs: [] };
const CH_KEY = 'antou:flow:channel';
const chNow = () => { const v = localStorage.getItem(CH_KEY); return AI.channels.some(c => c.id === v) ? v : (AI.channels[0] || { id: 'claude' }).id; };
const chName = () => (AI.channels.find(c => c.id === chNow()) || { 名: 'AI' }).名;
const jobLive = j => !!j && (j.状态 === '排队' || j.状态 === '在做');
/* 这件事（这一场）最近的一个任务 */
const jobOf = (事, 段, pred) => AI.jobs.filter(j => j.事 === 事 && (段 == null || j.段 === 段) && (!pred || pred(j))).pop() || null;
function chPicker() {
  if (!AI.ok || !AI.channels.length) return null;
  const sel = h('select', { class: 'ai-ch-sel', title: '点「让 AI ……」的时候交给谁。出图只走 Codex' }, AI.channels.map(c => h('option', { value: c.id, title: c.说明 }, c.名)));
  sel.value = chNow();
  sel.addEventListener('change', () => { store(CH_KEY, sel.value); toast('以后交给 ' + chName()); });
  return h('label', { class: 'ai-ch' }, 'AI 用', sel);
}
/* 开一个任务。quiet：不单独提示（一次开好几个时最后统一说一句） */
async function startJob(body, quiet) {
  await flush();
  if (F.err) return null;
  try {
    const j = await (await LINK.req('POST', '/api/job', C.encodeText(JSON.stringify({ 项目: F.name, 渠道: chNow(), ...body })))).json();
    AI.jobs = AI.jobs.filter(x => x.id !== j.id).concat(j);
    if (!quiet) toast('交给 ' + j.渠道名 + ' 了。做完这里自动出现');
    return j;
  } catch (e) { toast('没交上：' + e.message, 'err'); return null; }
}
async function loadJobs(first) {
  let r;
  try { r = await (await LINK.req('GET', '/api/job?p=' + encodeURIComponent(F.name))).json(); } catch (e) { return; }
  const was = new Map(AI.jobs.map(j => [j.id, j.状态])), sig = AI.jobs.map(j => j.id + j.状态 + j.步骤).join();
  AI.jobs = r.jobs;
  if (first) return;
  const ended = AI.jobs.filter(j => !jobLive(j) && (was.get(j.id) === '排队' || was.get(j.id) === '在做'));
  for (const j of ended) toast(j.状态 === '做完' ? j.标题 + '：' + j.结果 : j.标题 + (j.状态 === '停了' ? ' 停掉了' : ' 没成：' + j.错误), j.状态 === '做完' ? '' : 'err');
  if (ended.length) { await refresh(); if (PAGE.jobDone) PAGE.jobDone(ended); }   // AI 写的东西落盘了：重新读一遍
  else if (sig !== AI.jobs.map(j => j.id + j.状态 + j.步骤).join() && !typing() && !window.UI.popOpen) rerender();
}
/* 正在做的任务画成一行：转圈、在做什么、用了多久、停掉 */
function jobLine(j) {
  return h('span', { class: 'ai-run' }, h('i', { class: 'ai-spin' }),
    h('span', null, j.状态 === '排队' ? j.渠道名 + ' 排着队，前面还有别的任务' : (j.步骤 || j.渠道名 + ' 在做')),
    h('b', { 'data-t0': String(j.开始 || j.建) }, ''),
    h('button', { class: 'fl-link', type: 'button', title: '不等了，停掉这个任务', onclick: async () => { await LINK.req('POST', '/api/job/' + j.id + '?cancel').catch(() => {}); loadJobs(); } }, '停掉'));
}
/* 上一回没做成：说一句为什么（做成过、或者过了半小时就不提了） */
function jobFailed(事, 段, pred) {
  const j = jobOf(事, 段, pred);
  return j && (j.状态 === '没成') && Date.now() - j.结束 < 30 * 60e3 ? h('span', { class: 'fn-note warn', title: '任务书和 AI 的回答留在：' + j.记录 }, '上一回 ' + j.渠道名 + ' 没做成：' + j.错误) : null;
}
setInterval(() => document.querySelectorAll('.ai-run b[data-t0]').forEach(b => {
  const s = Math.max(0, Math.round((Date.now() - +b.dataset.t0) / 1000));
  b.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}), 1000);

/* ---------- 各场走到哪一步：总览的进度表、一场页面顶上的步骤条都看它 ---------- */
const STEPS = [['分场', '二', '段落'], ['剧本', '二', '剧本'], ['资产', '三', '资产'], ['提示词', '四', '提示词'], ['审片', '五', '审片']];   // [哪一页, 第几道工序, 这一步叫什么]
const clipsOf = seg => (F.clips.get(seg) || { vids: [], all: new Set(), time: new Map() });
/* ---------- 待核对：前面确认过的东西后来又动过，后面用到它的要你看一眼。看过了选「沿用」（这里记一个时间），或者重做（文件新了自然就不算旧）。
   记在这一场的「沿用」里：{ '提示词/文件名': 时间, '样片/视频名': 时间 } ---------- */
const keptOf = s => (s.沿用 && typeof s.沿用 === 'object' && !Array.isArray(s.沿用) ? s.沿用 : (s.沿用 = {}));
function keepAsIs(s, key) { keptOf(s)[key] = nowText(); touch(); }
/* 这一场前面几道最后一次确认是什么时候：剧本定稿、这一场的图最后一次确认、换出场的 */
function upTime(s) {
  let t = Math.max(timeOf(s.剧本定稿), assetCheckTime(s), timeOf(s.出场改));
  for (const K of LISTS) for (const n of s[K.key]) { const e = entryOf(K.key, n); if (e) t = Math.max(t, timeOf(e.改)); }   // 出场的人物、道具那一行动过：描写、换了图、去掉一张图
  return t;
}
/* 这条提示词是不是前面又动过以前写的 */
function promptStale(s, name) {
  const rec = F.names.get(s.段), t = rec && rec.time ? rec.time.get(name) || 0 : 0;
  if (!t) return false;   // 不知道它什么时候写的（老版本的服务）：不乱标
  return Math.max(t, timeOf(keptOf(s)['提示词/' + name])) + 999 < upTime(s);
}
/* 选定的这条样片：它出了以后，那条提示词又改过，或者前面几道又动过 */
function clipStale(s, pname, vid) {
  const c = F.clips.get(s.段), p = F.names.get(s.段), t = c && c.time ? c.time.get(vid) || 0 : 0;
  if (!t) return false;
  return Math.max(t, timeOf(keptOf(s)['样片/' + vid])) + 999 < Math.max(upTime(s), p && p.time ? p.time.get(pname) || 0 : 0);
}
/* ---------- 一张图「可用」：你看过这张图、能用。记在全片（流水线.json 的「可用」：图 → 时间），所以确认过的图，别的场不用再确认。
   这张图后来重出过（文件比确认的时间新），或者它那一行的描写改过，就不算数了，要再确认一次 ---------- */
const imgTime = file => (F.imgTime && F.imgTime.get(file.toLowerCase())) || 0;   // 老版本的服务不给文件时间：当它没变过
function markOk(file, since) {
  const t = timeOf(F.doc.可用[file]);
  return !!t && t + 999 >= Math.max(imgTime(file), since || 0);
}
const UNMARKED = new Map();   // 这一页里刚取消确认的图：原来是什么时候确认的
function setMark(file, on, since) {
  if (on) {
    const old = UNMARKED.get(file);
    F.doc.可用[file] = old && timeOf(old) + 999 >= Math.max(imgTime(file), since || 0) ? old : nowText();   // 点错了再点回来：图和描写都没变，时间照旧
    UNMARKED.delete(file);
  } else { if (F.doc.可用[file]) UNMARKED.set(file, F.doc.可用[file]); delete F.doc.可用[file]; }
  touch();
}
/* 一格图（assetsOf 给的那种）：它所属的那一行描写最后是什么时候改的；这张图现在算不算确认过 */
const sinceOf = it => KIND[it.类别] && it.own ? timeOf((entryOf(it.类别, it.名称) || {}).描写改) : 0;
const okOf = it => !!it.at && markOk(it.at, sinceOf(it));
/* 这一场的图最后一次确认是什么时候：你点「还能用，确认」的时间，和各张图确认的时间里最晚的 */
function assetCheckTime(s) {
  let t = timeOf(s.资产确认);
  for (const it of assetsOf(s).list) if (it.at) t = Math.max(t, timeOf(F.doc.可用[it.at]));
  return t;
}
/* 工序三 资产：剧本定稿以后才开；这一场要的图都有了、每一张你都确认过可用，就算完（不用另外再点）。剧本重新定过稿，要再看一遍（待核对） */
function assetState(s) {
  if (!s.定稿 || scriptState(s).st !== 'final') return { st: 'lock', tx: '剧本定稿后' };
  if (jobLive(jobOf('出图', s.段))) return { st: 'ai', tx: 'AI 在出图' };
  const list = assetsOf(s).list, has = list.filter(x => x.at), lack = list.length - has.length, ok = has.filter(okOf).length;
  if (!list.length) return { st: 'you', tx: '没选出场的' };
  if (lack) return { st: 'you', tx: '缺 ' + lack + ' 张', ok, n: has.length };
  if (ok < has.length) return { st: 'you', tx: '确认 ' + ok + '/' + has.length, ok, n: has.length };
  const again = !!s.头回定稿 && timeOf(s.头回定稿) + 999 < timeOf(s.剧本定稿);   // 头回定稿：剧本头一回定稿的时间（剧本页点定稿时记的）
  if (again && assetCheckTime(s) + 999 < timeOf(s.剧本定稿)) return { st: 'you', tx: '待核对', why: '剧本重新定过稿了', ok, n: has.length };
  return { st: 'ok', tx: '确认了', ok, n: has.length };
}
/* 工序四 提示词：这一场的图都确认可用了才开；一场可以分几条。镜头在提示词的「分镜」里设计（镜头表那一步取消了） */
function promptState(s) {
  if (assetState(s).st !== 'ok') return { st: 'lock', tx: '资产确认后' };
  if (jobLive(jobOf('写提示词', s.段))) return { st: 'ai', tx: 'AI 在写' };
  const list = promptsOf(s.段), n = list.length;
  if (list.some(e => promptStale(s, e.name))) return { st: 'you', tx: '待核对', n };
  return n ? { st: 'ok', tx: n + ' 条', n } : { st: 'you', tx: '还没写', n };
}
/* 工序五 审片：每一条提示词都选定了一条样片、你点了「这一场定稿」才算完 */
function reviewState(s) {
  const ps = promptState(s);
  if (ps.st !== 'ok') return { st: 'lock', tx: promptsOf(s.段).length ? '前面核对后' : '有了提示词后' };
  if (jobLive(jobOf('出片', s.段))) return { st: 'ai', tx: '在出片' };
  const vids = clipsOf(s.段).vids, list = promptsOf(s.段), sel = s.选定 || {};
  if (!vids.length) return { st: 'you', tx: '还没出片' };
  const picked = list.filter(e => sel[e.name] && vids.includes(sel[e.name])), done = picked.length;
  if (picked.some(e => clipStale(s, e.name, sel[e.name]))) return { st: 'you', tx: '待核对' };
  if (done < list.length) return { st: 'you', tx: '选定 ' + done + '/' + list.length };
  return s.成片定稿 ? { st: 'ok', tx: '定稿了' } : { st: 'you', tx: '等你定稿' };
}
/* 一场的五步各是什么样：ok 做完了、you 等你、ai AI 在做、lock 前一步没完还不能做 */
function stepInfo(s) {
  const a = s.定稿 ? { st: 'ok', tx: '定了' } : { st: 'you', tx: s.段落.some(x => x.写什么.trim()) ? '在写' : '还没写' };
  const sc = s.定稿 ? scriptState(s) : null;
  const b = !sc ? { st: 'lock', tx: '先定段落' } : sc.st === 'none' ? { st: 'you', tx: '还没扩写' } : sc.st === 'wait' ? { st: 'ai', tx: 'AI 在写' } : sc.st === 'old' ? { st: 'you', tx: '剧本是旧的' }
    : sc.st !== 'final' ? { st: 'you', tx: sc.again ? '改过，再定稿' : '等你定稿' }
      : { st: 'ok', tx: '定稿了' };
  return [a, b, assetState(s), promptState(s), reviewState(s)];
}

/* ---------- 这一页：各页把自己登记进来（start），这里管顶栏、步骤条、存盘、隔一会儿看一眼 ---------- */
let PAGE = null;      // { name: 哪一页, scene: 是不是一场的页面, wide: 要不要宽一点, render(): 画出这一页的内容, repaint(): 只换会变的那几块（有就不整页重画）, sides(changed): AI 那边有变化时怎么办（不写就整页重画）, steps(): 步骤条换了以后顺带做的 }
const REPAINT = {};   // 人物、道具两张表，场景图那一排：各自怎么重画
const sceneNow = () => F.doc ? F.doc.场.find(x => x.段 === F.seg) || null : null;
/* 换一页：先把没存的存上 */
async function go(page, opts, hash) {
  closePop(); hideHov();
  await flush();
  location.href = pageUrl(page, { p: F.name, ...(opts || {}) }, hash);
}
const noneBox = msg => h('div', { class: 'welcome' }, h('div', { class: 'w-inner' }, h('div', { class: 'seal w-seal' }, '案'), h('div', { class: 'w-title sm' }, '流水线'), h('p', { class: 'w-note' }, msg), h('a', { class: 'btn', href: '/?shell=1' }, '去老页面')));
const badBox = () => h('div', { class: 'fl-bad' }, h('b', null, '流水线.json 读不了。'), h('p', null, F.bad),
  h('p', { class: 'faint small' }, '这个文件被改坏了，页面先不动它。让 AI 看一下，修好以后点「重新读」。'), h('button', { class: 'btn', onclick: () => location.reload() }, '重新读'));
function renderTop() {
  const s = PAGE.scene ? sceneNow() : null;
  return h('header', { class: 'top wf-top' },
    PAGE.name === '总览' ? h('a', { class: 'wf-back', href: '/?shell=1', title: '原来的页面：审片、剧本、提示词、图片几个菜单都还在那里' }, '老页面')
      : h('a', { class: 'wf-back', href: pageUrl('总览', { p: F.name }), title: '回首页：看各场走到哪一道工序', onclick: e => { e.preventDefault(); go('总览'); } }, '← 首页'),
    h('div', { class: 'crumb' },
      h('button', { class: 'ptitle', title: '换一个项目', onclick: pickProject }, F.name),
      PAGE.name === '总览' ? h('span', { class: 'crumb-seg' }, '流水线') : h('a', { class: 'crumb-seg wf-home', href: pageUrl('总览', { p: F.name }), title: '回流水线首页：看各场走到哪一步', onclick: e => { e.preventDefault(); go('总览'); } }, '流水线'),
      PAGE.name === '设定' ? h('span', { class: 'crumb-seg' }, '全片设定') : null,
      s ? h('span', { class: 'crumb-seg' }, '第' + s.段 + '场' + (s.名.trim() ? ' ' + s.名.trim() : '')) : null),
    h('div', { class: 'top-right' }, chPicker(), h('div', { class: 'status', id: 'fl-status' })));
}
/* 一场的页面顶上：写段落 → 剧本 → 资产，现在在哪一步、各步什么样；右边换上一场、下一场 */
function stepsEls() {
  const s = sceneNow();
  if (!s) return [];
  const info = stepInfo(s), i0 = F.doc.场.indexOf(s), prev = F.doc.场[i0 - 1], next = F.doc.场[i0 + 1], out = [];
  STEPS.forEach(([page, no, label], i) => {
    const x = info[i], on = PAGE.name === page;
    if (i) out.push(h('span', { class: 'wf-arrow' }, '→'));
    out.push(h('button', { class: 'wf-step ' + x.st + (on ? ' on' : ''), type: 'button', title: x.st === 'lock' ? x.tx + '才能做这一步' : null, onclick: () => { if (!on) go(page, { s: s.段 }); } },
      h('i', null, x.st === 'ok' ? icon('check') : no), label, h('small', null, x.tx)));
  });
  out.push(h('span', { class: 'sp' }));
  if (prev) out.push(h('button', { class: 'btn ghost sm', type: 'button', title: '第' + prev.段 + '场 ' + prev.名, onclick: () => go(PAGE.name, { s: prev.段 }) }, '← 上一场'));
  if (next) out.push(h('button', { class: 'btn ghost sm', type: 'button', title: '第' + next.段 + '场 ' + next.名, onclick: () => go(PAGE.name, { s: next.段 }) }, '下一场 →'));
  return out;
}
function paintSteps() {
  const el = document.getElementById('wf-steps');
  if (el) el.replaceChildren(...stepsEls());
  if (PAGE && PAGE.steps) PAGE.steps();
}
function paintStatus() {
  const el = document.getElementById('fl-status');
  if (!el) return;
  const t = F.err ? '没存上：' + F.err : dirty() || F.saving ? '正在保存…' : F.savedAt ? '已保存 ' + two(F.savedAt.getHours()) + ':' + two(F.savedAt.getMinutes()) : F.bad ? '' : '边写边自动保存';
  el.className = 'status' + (F.err ? ' noted' : '');
  el.replaceChildren(...(t ? [h('i', { class: 'dot' }), t] : []));
}
function renderAll() {
  closePop(); hideHov();
  for (const k of Object.keys(REPAINT)) delete REPAINT[k];
  const root = document.getElementById('wf');
  root.replaceChildren(...[renderTop(),
    PAGE.scene && !F.bad ? h('nav', { class: 'wf-steps', id: 'wf-steps' }, stepsEls()) : null,
    h('main', { class: 'wf-main' }, h('div', { class: 'fl' + (PAGE.wide ? ' wide' : ''), id: 'fl-body' }, F.bad ? badBox() : PAGE.render()))].filter(Boolean));
  paintStatus(); fitAll();
}
function rerender(sc) {
  F.redraw = F.later = false;
  if (PAGE.scene && F.doc && !F.bad && !sceneNow()) { location.replace(pageUrl('总览', { p: F.name })); return; }   // 这一场没了（别的页面删掉、两边一合并就没了）：回首页
  if (PAGE.repaint && !F.bad && document.getElementById('fl-body') && PAGE.repaint() !== false) { paintSteps(); paintStatus(); return; }   // 这一页嵌着别的页面：不整页重画，只换会变的那几块
  const top = sc == null ? scrollTop() : sc;
  renderAll();
  document.scrollingElement.scrollTop = top;
}
/* 表里改了名字、换了图：两张表、场景图、这一场卡片上挂着的跟着换 */
function repaintRefs() {
  for (const k of Object.keys(REPAINT)) REPAINT[k]();
  for (const el of document.querySelectorAll('.fl-scene')) if (el.repaintRefs) el.repaintRefs();
  paintSteps();
}
async function pickProject() {
  const r = await dialog(close => dlgShell('换一个项目', '每个项目有自己的流水线。现在是「' + F.name + '」。新建项目到「项目管理」里建。',
    [h('div', { class: 'chips' }, F.projects.map(n => h('button', { class: 'chip' + (n === F.name ? ' on' : ''), type: 'button', onclick: () => close(n) }, n)))],
    [h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close(null) }, '不换')]));
  if (r && r !== F.name) { await flush(); location.href = pageUrl('总览', { p: r }); }
}
/* 每一页最后调一次：认项目、读流水线、画出来，然后隔两秒看一眼外面变了没有 */
async function start(page) {
  PAGE = page;
  document.title = '流水线 · ' + page.name;
  const root = document.getElementById('wf');
  if (!(await LINK.up())) { root.replaceChildren(noneBox('这几页要经本机服务打开：在 Claude 里说「打开项目管理」，再点左边的「流水线」。')); return; }
  F.projects = await projects();
  AI.ok = LINK.v >= 5;   // 本机服务第 5 版起有 AI 任务
  if (AI.ok) { try { AI.channels = (await (await LINK.req('GET', '/api/job?channels')).json()).channels.filter(c => c.ok); } catch (e) { AI.ok = false; } }
  const q = query(), has = n => !!n && F.projects.includes(n);
  const name = has(q.p) ? q.p : [localStorage.getItem('antou:last:' + LINK.root)].find(has) || F.projects[0];
  if (!name) { root.replaceChildren(noneBox('这里还没有项目。先到项目管理里建一个。')); return; }
  F.seg = C.normSeg(q.s || '');
  if (!(await load(name))) { root.replaceChildren(noneBox('这个项目没读出来，过一会儿再试。')); return; }
  store('antou:last:' + LINK.root, name);
  if (AI.ok) await loadJobs(true);
  if (page.scene && !F.bad && !sceneNow()) { location.replace(pageUrl('总览', { p: name })); return; }   // 没有这一场：回首页
  if (q.p !== name) history.replaceState(null, '', pageUrl(page.name, { p: name, s: page.scene ? F.seg : '' }) + location.hash);
  renderAll();
  setInterval(tick, 2000);
}
/* 每两秒看一眼：流水线.json 在外面改了就换上；隔几次看一遍剧本、资产清单这些 AI 写的 */
async function tick(force) {
  if (document.hidden || SHELL || !F.name || (!F.doc && !F.bad) || F.checking) return;
  F.checking = true;
  const name = F.name;
  try {
    const busy = () => dirty() || !!F.saving || typing() || window.UI.popOpen || !!document.querySelector('.mask:not(.out)');
    const fst = await flowStat(name);
    if (!fst.ok || F.name !== name) return;   // 本机服务问不到（断了、正在重开）：这一轮什么都不动，留着页面上的
    if (fst.mtime === F.mtime) F.seenAt = Date.now();   // 刚核对过盘上没被别的页面改：关页面那一下可以直接写
    else if (!busy()) {
      const sc = scrollTop();
      if (await load(name, true)) {
        if (PAGE.scene && !F.bad && !sceneNow()) { location.replace(pageUrl('总览', { p: name })); return; }
        rerender(sc); toast('流水线在外面改过了，已经换上');
      }
      return;
    }
    if (F.err && dirty() && !F.saving && !/盘上已经有一份流水线/.test(F.err)) save();   // 上回没存上（本机服务断了一下）：问得到了就接着存
    if (F.redraw) redrawSoon();   // 并进别的页面的改动时小窗开着、没重画：关了就补上
    else if (F.later && !busy()) rerender();   // 前几回看到有变化时你正在写：写完了补画
    if (AI.ok && (AI.jobs.some(jobLive) || F.ticks % 3 === 2)) await loadJobs();   // 有任务在做就每两秒问一次，没有就隔几次看一眼
    if (force === true || ++F.ticks % 3 === 0) {
      const changed = await loadSides();
      if (changed.size) { if (PAGE.sides) PAGE.sides(changed); else if (!busy()) rerender(); else F.later = true; paintSteps(); }
    }
  } catch (e) { /* 下回再看 */ }
  finally { F.checking = false; }
}
/* 从「项目管理」那一页回来：重新看一遍剧本、镜头表、现成的资产 */
async function refresh() {
  const name = F.name;
  try {
    const pj = await scanScripts(name), pool = await loadPool(name);
    if (F.name !== name) return;
    F.pj = pj; F.pool = pool;
    await loadSides();
    if (!typing()) rerender();
  } catch (e) { /* 下回再看 */ }
}
window.addEventListener('pageshow', e => { if (e.persisted) location.reload(); });   // 按「后退」回来的旧页面：重新读
window.addEventListener('pagehide', () => {   // 关页面、刷新、后退：当场写（等不及先问盘上，问完页面已经没了）。几秒内刚核对过盘上没被别的页面改才这样写，不然照常存
  if (!F.doc || F.bad || !dirty()) return;
  if (Date.now() - (F.seenAt || 0) > 5000) { save(); return; }
  stampChanges();
  const text = serialize(F.doc);
  if (text !== F.text) FS.write(at([F.name, '定稿的剧本', FILE]), C.encodeText(text)).catch(() => {});
});

/* ---------- 几页都用的小部件 ---------- */
/* 一场的剧本段落，一段一行：写什么、起什么作用 */
function paraList(s) {
  return [h('ol', { class: 'fs-list' }, s.段落.map((x, i) => h('li', null, h('span', { class: 'n' }, '段落' + (i + 1)), h('span', null, x.写什么.trim() || '—'), h('span', { class: 'y' }, x.作用.trim() || h('span', { class: 'faint' }, '没写作用')))))];
}
const secHead = (no, name, sub, ...btns) => h('div', { class: 'fl-sec-h' }, no ? h('span', { class: 'sec-no' }, no) : null, h('span', null, name), sub ? h('em', null, sub) : null, h('span', { class: 'ln' }), btns);
const poolOf = K => F.pool.filter(x => K.cats(x.类别));

function picEl(file, name, ph) {
  if (!file) return h('span', { class: 'fr-pic none' }, ph || '没有图');
  if (F.gone.has(file)) return h('span', { class: 'fr-pic none', title: '这张图不在了：' + file }, '图不在了');
  const el = h('span', { class: 'fr-pic' }, thumbImg(file));
  hoverable(el, file, name);
  return el;
}
/* 一行前头的小图：道具引用了几张就摆几张（最多三张，多的写个数） */
function picsEl(it) {
  const show = it.资产.slice(0, 3), more = it.资产.length - show.length;
  const label = f => it.名 + (it.资产.length > 1 && stateOf(it.名, f) ? ' · ' + stateOf(it.名, f) : '');
  return h('span', { class: 'fr-pics' }, show.length ? show.map(f => picEl(f, label(f), '没有图')) : picEl('', it.名, '没有图'), more > 0 ? h('span', { class: 'fr-more', title: '一共引用了 ' + it.资产.length + ' 张' }, '+' + more) : null);
}

/* 资产小格子：点一下选上 */
function tileEl(x, on, note, onclick) {
  const b = h('button', { type: 'button', class: 'fl-at' + (on ? ' on' : ''), title: x.文件 + (note ? '\n' + note : ''), onclick }, thumbImg(x.文件), h('span', null, x.名称), note ? h('small', null, note) : null, h('i', null, icon('check')));
  hoverable(b, x.文件, x.名称);
  return b;
}
/* 弹窗：加一行、改一行。叫法、描写、引用哪张图。存好了返回叫法 */
async function entryDlg(K, it) {
  closePop(); hideHov();
  try { F.pool = await loadPool(F.name); } catch (e) { /* 读不出来就用手里的 */ }   // 页面开着的时候放进来的图也要列出来
  const isNew = !it, list = F.doc[K.key];
  let picks = it ? [...it.资产] : [], auto = false;   // 引用的图：人物一张；道具可以几张，一个状态一张
  const nameIn = h('input', { class: 'inp fl-in', value: it ? it.名 : '', placeholder: K.namePh, maxlength: '16', spellcheck: 'false', 'data-focus': '' });
  const descIn = h('textarea', { class: 'fl-ta sm', spellcheck: 'false', placeholder: K.descPh });
  descIn.value = it ? it.描写 : '';
  const err = h('div', { class: 'fld-err' }), grid = h('div', { class: 'fl-ag' });
  const sug = it ? aiText(K.key, it.名) : '';
  const sugBox = sug ? h('div', { class: 'fl-aibox' }, h('div', { class: 'fl-aibox-h' }, 'AI 补的', h('span', { class: 'sp' }),
    h('button', { class: 'btn sm', type: 'button', onclick: () => { descIn.value = sug; sugBox.remove(); descIn.focus(); } }, '用这一版'),
    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { sayNo(K.key, it.名, sug); sugBox.remove(); repaintRefs(); } }, '不要')), h('p', null, sug)) : null;
  const items = poolOf(K);
  const owner = x => { const e = list.find(e => e !== it && e.资产.includes(x.文件)); return e ? e.名 + ' 在用' : ''; };
  const flip = x => {   // 人物：点哪张就是哪张。道具：点一下选上，再点一下去掉
    if (!K.multi) picks = [x.文件];
    else if (picks.includes(x.文件)) picks = picks.filter(f => f !== x.文件);
    else picks = [...picks, x.文件];
    auto = false; if (!nameIn.value.trim()) nameIn.value = tokenOf(x); paintGrid();
  };
  const paintGrid = () => grid.replaceChildren(
    h('button', { type: 'button', class: 'fl-at blank' + (picks.length ? '' : ' on'), onclick: () => { picks = []; auto = false; paintGrid(); } }, h('span', { class: 'fl-at-no' }, '不引用'), h('span', null, '还没有图'), h('i', null, icon('check'))),
    ...picks.filter(f => !items.some(x => x.文件 === f)).map(f => h('button', { type: 'button', class: 'fl-at on', title: '这张图不在了：' + f + '。点一下去掉', onclick: () => { picks = picks.filter(x => x !== f); auto = false; paintGrid(); } }, h('span', { class: 'fl-at-no' }, '图不在了'), h('span', null, baseOf(f)), h('i', null, icon('check')))),
    ...items.map(x => tileEl(x, picks.includes(x.文件), owner(x), () => flip(x))));
  nameIn.addEventListener('input', () => {   // 写的叫法正好对得上一张图：先替你选上
    err.textContent = '';
    if (picks.length && !auto) return;
    const v = nameIn.value.trim(), hit = items.filter(x => !owner(x) && (tokenOf(x) === v || x.名称 === v));
    picks = hit.length === 1 || (K.multi && hit.length) ? hit.map(x => x.文件) : []; auto = !!picks.length;   // 道具：同一个名字的几张图一起选上
    paintGrid();
  });
  paintGrid();
  const r = await dialog(close => {
    const ok = again => {
      const name = nameIn.value.trim();
      if (!name) { err.textContent = K.nameLab + '不能空着'; nameIn.focus(); return; }
      if (list.some(e => e !== it && e.名 === name)) { err.textContent = '已经有「' + name + '」了'; nameIn.focus(); return; }
      close({ name, again });
    };
    nameIn.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); descIn.focus(); } });
    descIn.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isComposing(e)) { e.preventDefault(); ok(false); } });
    const el = dlgShell((isNew ? '加' : '改') + K.key, '写完点「' + (isNew ? '加上' : '改好') + '」。引用了哪张图，这个' + K.key + '就和那张图对上了，后面出片认的就是它。' + (K.multi ? '一个' + K.key + '有几个状态（比如新的、用旧了的），就把几张图都选上。' : ''),
      [field(K.nameLab, nameIn), h('div', { class: 'fld' }, h('span', null, '描写'), descIn, sugBox),
        h('div', { class: 'fld' }, h('span', null, K.multi ? '引用资产（可以选几张，一个状态一张）' : '引用资产'), items.length ? h('div', { class: 'fl-apick' }, grid) : h('p', { class: 'fn-note' }, '项目的 资产 / 全局资产 里还没有' + K.key + '图。先写上，定下一场以后让 AI 出。')), err],
      [it ? h('button', { class: 'btn ghost', style: 'margin-right:auto', onclick: () => close({ del: true }) }, '删掉这一行') : null,
        h('button', { class: 'btn ghost', onclick: () => close(null) }, '取消'),
        isNew ? h('button', { class: 'btn', title: '加上这一个，接着加下一个', onclick: () => ok(true) }, '加上，再加一个') : null,
        h('button', { class: 'btn ink', onclick: () => ok(false) }, isNew ? '加上' : '改好')]);
    el.classList.add('wide');
    return el;
  });
  if (!r) return null;
  if (r.del) { await delEntry(K, it); return null; }
  if (isNew) list.push({ 名: r.name, 描写: descIn.value, 资产: picks });
  else {
    if (it.名 !== r.name) {
      for (const s of F.doc.场) s[K.key] = s[K.key].map(n => n === it.名 ? r.name : n);   // 改了叫法：各场里选的跟着改
      for (const suf of ['', '/描写']) { const k0 = K.key + '/' + it.名 + suf; if (F.base && F.base.has(k0)) { F.base.set(K.key + '/' + r.name + suf, F.base.get(k0)); F.base.delete(k0); } }   // 存盘时比「上一回的样子」也跟着换名字，不然同时改了描写记不上
    }
    const dropped = it.资产.filter(f => !picks.includes(f));   // 这回去掉的图
    Object.assign(it, { 名: r.name, 描写: descIn.value, 资产: picks });
    const no = [...new Set([...(Array.isArray(it.不用) ? it.不用 : []), ...dropped])].filter(f => !picks.includes(f));   // 去掉的记进「不用」；又选回来的不算数了
    if (no.length) it.不用 = no; else delete it.不用;
  }
  touch(); repaintRefs();
  if (r.again) { await entryDlg(K); }
  return r.name;
}
async function delEntry(K, it) {
  const used = usedIn(K.key, it.名);
  if (!(await confirmDlg({ title: '删掉「' + it.名 + '」', body: (used.length ? '第 ' + used.join('、') + ' 场选了它，会一起去掉。' : '') + '引用的图还在原处，不会删。', ok: '删掉', danger: true }))) return;
  const i = F.doc[K.key].indexOf(it);
  if (i >= 0) F.doc[K.key].splice(i, 1);
  for (const s of F.doc.场) s[K.key] = s[K.key].filter(n => n !== it.名);
  touch(); repaintRefs();
}

/* 一张引用的图：小图、名字，点开去「图片」里看；x：拿掉 */
function imgChip(file, small, onRemove) {
  const gone = F.gone.has(file);
  const el = h('div', { class: 'fl-asset' + (gone ? ' todo' : ''), role: gone ? null : 'button', tabindex: gone ? null : '0', title: gone ? '这张图不在了：' + file : '点开看、写批注：' + file, onclick: gone ? null : () => openImage(file) },
    gone ? h('span', { class: 'ph' }, '不在了') : thumbImg(file), h('span', { class: 'nm' }, baseOf(file), h('small', null, gone ? '文件不在了' : small)));
  if (!gone) hoverable(el, file, baseOf(file));
  if (onRemove) el.append(h('button', { class: 'fl-asset-x', type: 'button', title: '不引用了（图还在原处）', onclick: e => { e.stopPropagation(); onRemove(); } }, icon('x')));
  return el;
}

const sceneText = s => [s.名, s.表达, ...s.段落.flatMap(x => [x.写什么, x.作用])].join('\n');
/* 这一场的字里提到了、还没选上的：人物、道具按叫法认，场景图按图名认 */
function mentioned(s) {
  const text = sceneText(s), out = [];
  for (const K of LISTS) for (const e of F.doc[K.key]) if (e.名.length >= 2 && !s[K.key].includes(e.名) && text.includes(e.名)) out.push({ key: K.key, id: e.名, name: e.名, file: e.资产[0] || '' });
  for (const f of F.doc.场景图) { const t = baseOf(f).split('_')[0]; if (t.length >= 2 && !s.场景图.includes(f) && text.includes(t)) out.push({ key: '场景图', id: f, name: baseOf(f), file: f }); }
  if (F.doc.场景图.length === 1 && !s.场景图.length && !out.some(x => x.key === '场景图')) out.push({ key: '场景图', id: F.doc.场景图[0], name: baseOf(F.doc.场景图[0]), file: F.doc.场景图[0], only: true });   // 全片只引用了一张场景图：多半就是它
  return out;
}
const pickCount = s => s.人物.length + s.道具.length + s.场景图.length;
function missing(s) {
  const out = [];
  if (!s.人物.length && F.doc.人物.length) out.push('没选出场的人物');
  if (!s.表达.trim()) out.push('没写这一场表达什么');
  if (!s.段落.length) { out.push('还没有剧本段落'); return out; }
  const nos = k => s.段落.map((x, i) => x[k].trim() ? 0 : i + 1).filter(Boolean);
  const a = nos('写什么'), b = nos('作用');
  if (a.length) out.push('段落 ' + a.join('、') + ' 还空着');
  if (b.length) out.push('段落 ' + b.join('、') + ' 没写作用');
  return out;
}
const ibtn = (ic, title, fn, off) => h('button', { class: 'fl-ib', type: 'button', tabindex: '-1', title, disabled: !!off, onclick: fn }, icon(ic));
/* 这一场现有的剧本、镜头表（汇总稿不算这一场自己的） */
function docsOf(seg) {
  const sl = F.pj && F.pj.segs.get(seg);
  return { script: (sl && sl.script.find(e => !e.combined)) || null, shots: (sl && sl.shots[0]) || null, combined: (sl && sl.script.find(e => e.combined)) || null };
}

/* 这一场选上的一样：人物、道具是表里的一行，场景图是一张图 */
function refChip(key, id, onRemove) {
  const e = KIND[key] ? entryOf(key, id) : null, all = KIND[key] ? (e ? e.资产 : []) : [id], file = all.find(f => !F.gone.has(f)) || all[0] || '', name = KIND[key] ? id : baseOf(id);   // 道具引用了几张：小图摆头一张，后面写几张
  const lost = KIND[key] && !e, ok = !!file && !F.gone.has(file);
  const el = h('span', { class: 'fl-ref' + (lost ? ' lost' : ''), title: lost ? '上面的「' + key + '」里没有这一行了' : KIND[key] ? key + '：' + oneLine(e.描写) + (all.length ? '\n图：' + all.join('、') : '\n还没有图') : '场景图：' + file },
    ok ? thumbImg(file) : h('i', { class: 'ph' }, key[0]), h('span', null, name), h('small', null, key + (all.length > 1 ? ' · ' + all.length + ' 张' : '')));
  if (ok) hoverable(el, file, name);
  if (onRemove) el.append(h('button', { class: 'fl-ref-x', type: 'button', tabindex: '-1', title: '这一场不用它', onclick: onRemove }, icon('x')));
  return el;
}

/* ---------- 定下来以后，交给 AI 的事都从这里说（对话里的 AI 挂着等；没在等就先排着） ---------- */
async function sendAI(line, ok) {
  if (!LINK.on) { await copyText(line, '复制好了，贴给 Claude 或 Codex'); return; }
  try {
    const r = await (await LINK.req('POST', '/api/ai', line)).json();
    toast(r.online ? ok : '记下了。AI 这会儿没在等，去对话里说一声「看右边」');
  } catch (e) { toast('没交上：' + e.message, 'err'); }
}
const nextRow = (label, body) => h('div', { class: 'fn' }, h('div', { class: 'fn-lab' }, label), body);

/* ---------- 批量让 AI 扩写：各场写成剧本；人物、道具补细描写；场景照 GEO 写清空间 ---------- */
/* 一句话交出去：批量扩写 <流水线>｜人物：甲、乙｜场景（照 scene-geo 用 GEO…）｜道具：丙｜各场：第1-1段、第1-2段 */
async function batchSend(pick) {
  const d = F.doc;
  if (pick.场景 && !d.场景.trim() && !d.场景图.length) { toast('场景那一格还空着。先写几句有哪些地方，或者引用一张场景图，再让 AI 照 GEO 扩写', 'err'); return false; }
  const parts = [];
  if (pick.人物.length) parts.push('人物：' + pick.人物.join('、'));
  if (pick.场景) parts.push(GEO_ASK);
  if (pick.道具.length) parts.push('道具：' + pick.道具.join('、'));
  if (pick.场.length) parts.push('各场：' + pick.场.map(segName).join('、'));
  if (!parts.length) return false;
  if (pick.人物.length || pick.道具.length || pick.场景) parts.push(AI_OUT);
  const now = nowText();
  for (const n of pick.人物) d.补细.人物[n] = now;
  for (const n of pick.道具) d.补细.道具[n] = now;
  if (pick.场景) d.补细.场景 = now;
  for (const seg of pick.场) { const s = d.场.find(x => x.段 === seg); if (s) { if (!s.头回定稿 && s.剧本定稿) s.头回定稿 = s.剧本定稿; s.扩写 = now; s.剧本定稿 = ''; } }   // 以前定过稿的：头一回定稿的时间先记下，再定稿就算「重新定稿」
  touch();
  await flush();
  if (F.err) return false;
  if (AI.ok) {   // 一样一个任务：补细的并成一个，场景一个，各场各一个
    if (pick.人物.length || pick.道具.length) await startJob({ 事: '补细', 人物: pick.人物, 道具: pick.道具 }, true);
    if (pick.场景) await startJob({ 事: '场景GEO' }, true);
    for (const seg of pick.场) await startJob({ 事: '扩写剧本', 段: seg }, true);
    toast('交给 ' + chName() + ' 了。做完这里自动出现');
  } else await sendAI('批量扩写 ' + flowRef() + '｜' + parts.join('｜'), '交给 AI 了。各场写好剧本、别的补好描写，这里都会自动出现');
  rerender();
  return true;
}

/* 剧本定稿（final）：你看过 AI 写的剧本，点了「剧本定稿」，之后剧本、这一场的段落都没再动。定稿了才许出资产图 */
function scriptState(s) {
  const d = docsOf(s.段), asked = timeOf(s.扩写), job = jobOf('扩写剧本', s.段);
  if (jobLive(job)) return { d, st: 'wait', job };   // AI 正在写
  if (!AI.ok) {   // 老办法（排队等对话里的 AI）：说过了、新的还没写出来，就算在等
    if (!d.script) return { d, st: asked ? 'wait' : 'none' };
    if (asked && d.script.mtime < asked) return { d, st: 'wait' };
  }
  if (!d.script) return { d, st: 'none' };
  const fin = timeOf(s.剧本定稿);   // 记到秒，文件时间到毫秒：比的时候让一秒
  if (fin && fin + 999 >= d.script.mtime && fin >= timeOf(s.定稿)) return { d, st: 'final' };
  if (d.script.mtime < timeOf(s.定稿)) return { d, st: 'old' };   // 剧本是这一场定下来以前写的
  return { d, st: 'ok', again: !!fin };   // again：定稿以后剧本又改过
}
/* ---------- 选这一场出场的：人物、道具从全片的表里选，场景图从引用的场景图里选。分场页、资产页都用这一个小窗 ---------- */
function orderCast(s) {   // 选上的照表里的先后排
  for (const K of LISTS) s[K.key] = F.doc[K.key].map(e => e.名).filter(n => s[K.key].includes(n));
  s.场景图 = F.doc.场景图.filter(f => s.场景图.includes(f));
}
function openPickPop(anchor, s, after) {
  popover(anchor, close => {
    const body = h('div', { class: 'fl-pl' });
    const flip = (key, id) => { s[key].includes(id) ? (s[key] = s[key].filter(x => x !== id)) : s[key].push(id); orderCast(s); touch(); paint(); after(); };
    const item = (key, id, name, desc, file) => h('button', { type: 'button', class: 'fl-pi' + (s[key].includes(id) ? ' on' : ''), onclick: () => flip(key, id) },
      file && !F.gone.has(file) ? thumbImg(file) : h('span', { class: 'ph' }, key[0]), h('span', { class: 'pn' }, h('b', null, name), desc ? h('small', null, desc) : null), h('i', null, icon('check')));
    const paint = () => {
      const out = [];
      for (const K of LISTS) {
        out.push(h('div', { class: 'fl-pop-g' }, K.key, h('button', { class: 'fl-link', type: 'button', onclick: async () => { close(); const n = await entryDlg(K); if (n && !s[K.key].includes(n)) { s[K.key].push(n); touch(); } after(); } }, '＋ 新加一个')));
        out.push(...F.doc[K.key].map(e => item(K.key, e.名, e.名, oneLine(e.描写), e.资产.find(f => !F.gone.has(f)) || '')));
        if (!F.doc[K.key].length) out.push(h('p', { class: 'fl-pop-e' }, '全片设定里的「' + K.key + '」还是空的。'));
      }
      out.push(h('div', { class: 'fl-pop-g' }, '场景图'));
      out.push(...F.doc.场景图.map(f => item('场景图', f, baseOf(f), '', f)));
      if (!F.doc.场景图.length) out.push(h('p', { class: 'fl-pop-e' }, '全片设定里的「场景」还没引用场景图。'));
      body.replaceChildren(...out);
    };
    paint();
    return [h('div', { class: 'fl-pop-h' }, '第' + s.段 + '场出场的'), body, h('div', { class: 'fl-pop-f' }, h('button', { class: 'btn sm ink', type: 'button', onclick: close }, '好了'))];
  });
}

/* ---------- 资产：这一场出场的人物、道具、场景图各对着哪张图；还没有图的让 AI 出 ---------- */
/* 认资产和提示词那边是一个路子：图放在 资产/全局资产/类别/名字.png；哪个人物、道具对哪张图，记在 流水线.json 的表里（那一行的「资产」） */
function assetsOf(s) {
  const out = [], seen = new Set(), rec = F.assets.get(s.段), ai = rec && !rec.bad ? rec.items : [];
  for (const K of LISTS) for (const n of s[K.key]) {
    const e = entryOf(K.key, n), imgs = e ? e.资产 : [];
    for (const file of imgs) { seen.add(file.toLowerCase()); out.push({ 类别: K.key, 名称: n, sub: imgs.length > 1 ? stateOf(n, file) : '', at: F.gone.has(file) ? '' : file, 状态: F.gone.has(file) ? '图不在了' : '', 说明: baseOf(file), 文件: file, own: true }); }
    const no = e && Array.isArray(e.不用) ? e.不用 : [];
    const todo = K.multi ? ai.filter(x => aiKey(x) === K.key && x.名称 === n && !x.at && !no.includes(x.文件)) : [];   // 道具：AI 清单里对着这一行、图还没出好的，一个状态一格（那一格点过 × 的不算）
    const wait = a => a && a.状态 && a.状态 !== '有了' && a.状态 !== '待过目' ? a.状态 : '';   // 清单上写着「有了」「待过目」、文件却不在（删掉了、挪走了）：当它还没出
    for (const a of todo) out.push({ 类别: K.key, 名称: n, sub: a.文件 ? stateOf(n, a.文件) : '', at: '', 状态: wait(a) || '还没出', 说明: a.说明, 文件: a.文件, own: true });
    if (!imgs.length && !todo.length) { const a = ai.find(x => aiKey(x) === K.key && x.名称 === n); out.push({ 类别: K.key, 名称: n, at: '', 状态: !e ? '表里没有这一行' : wait(a) || '还没有图', 说明: a ? a.说明 : '', own: true }); }
  }
  for (const f of s.场景图) { seen.add(f.toLowerCase()); out.push({ 类别: '场景图', 名称: baseOf(f), at: F.gone.has(f) ? '' : f, 状态: F.gone.has(f) ? '图不在了' : '', 说明: '', own: true }); }
  const named = new Set(out.map(x => x.类别 + '/' + x.名称));
  const inTable = new Set([...LISTS.flatMap(K => F.doc[K.key].flatMap(e => e.资产)), ...F.doc.场景图].map(f => f.toLowerCase()));
  for (const x of ai) {   // AI 另外列的：表里没有的东西
    if ((x.at && seen.has(x.at.toLowerCase())) || named.has(aiKey(x) + '/' + x.名称)) continue;
    if (KIND[aiKey(x)] && entryOf(aiKey(x), x.名称)) continue;   // 表里有这一行：这一场用不用它，看「选出场的」
    if (x.at && inTable.has(x.at.toLowerCase())) continue;       // 这张图表里哪一行引用着：同上
    if (!x.at && x.文件 && (x.状态 === '有了' || x.状态 === '待过目')) continue;   // 出过图、后来删了或者那一行改了名：不算这一场缺的
    out.push({ ...x, own: false });
  }
  return { list: out, rec };
}
function assetChip(it, opener) {   // opener：点开这一格时另有做法（资产页：看大图时顶上带「这张确认可用」）
  const has = !!it.at, img = has && IMG_RE.test(it.at);
  const open = opener || (() => img ? openImage(it.at) : showText(at([F.name, ...it.at.split('/')])));
  const el = h('div', { class: 'fl-asset' + (has ? '' : ' todo'), role: has ? 'button' : null, tabindex: has ? '0' : null,
    title: has ? '点开看、写批注：' + it.at : (it.说明 || it.状态 || '还没有图'), onclick: has ? open : null },
    img ? thumbImg(it.at) : h('span', { class: 'ph' }, has ? '文件' : '待出'),
    h('span', { class: 'nm' }, it.名称, h('small', null, [it.类别, it.sub, it.own ? '' : 'AI 列的', has ? (it.状态 && it.状态 !== '有了' ? it.状态 : '') : (it.状态 || '还没出')].filter(Boolean).join(' · '))));
  if (has) { el.addEventListener('keydown', e => { if (e.key === 'Enter') open(); }); if (img) hoverable(el, it.at, it.名称); }
  return el;
}
