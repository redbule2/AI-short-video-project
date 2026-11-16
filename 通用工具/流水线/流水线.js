/* ============================================================
   流水线 · 各页共用（总览、设定、分场、剧本、资产 都先引这一份）
   流程：全片的梗概、人物、场景、道具（只写粗的） → 一场一场：写段落、定下来 → AI 扩写成剧本、你定稿 → 资产字先定、图后出 → 写提示词（要关键帧的在这一步出） → 审片。
   这里放：流水线.json 怎么读、怎么存；各场走到哪一步；顶栏和步骤条；几页都用的小部件。
   每一页自己的东西写在那一页里。页面之间只靠网址（p＝项目，s＝第几场）和项目里的文件传话。
   一场就是一个「第N段」。东西放在哪：
     定稿的剧本/流水线.json              各页存的（页面写，AI 只读）：梗概、人物、场景、道具、每一场的剧本段落
     定稿的剧本/流水线_AI扩写.json        AI 补的人物、道具描写，照 GEO 写的场景段（AI 写，页面只读；你点「采用」才换进流水线）
     定稿的剧本/第N段/第N段_剧本.docx      AI 照这一场扩写（固定格式），在「剧本」那一步里看、写批注
     （镜头表那一步 2026-11-12 取消了：剧本定稿、资产确认以后直接写提示词，镜头在提示词的「分镜」里设计。老项目已有的镜头表不动，在「剧本」那一步照旧能看）
     资产/第N段_资产清单.json             AI 列的：这一场还缺什么、出到哪一步，写字记的要撑住、核图（AI 写，页面只读）
     提示词/全局资产/类别/图名_提示词.txt   资产的字（出图提示词；场景另有 图名_GEO底稿.md）；关键帧的字在 提示词/第N段
     定稿的剧本/第N段/第N段_影响清单.json  剧本重新定稿以后 AI 列的：哪些资产、提示词要再看（AI 写，页面只读）
     资产/第N段_出片记录.json             批准出片时记的：哪一条、那时候提示词的版本（本机服务写，页面只读）
   被换下来的剧本，和每定一场时的流水线，都留一版在 历史记录/定稿的剧本。
   这一份不包在函数里：下面起的名字各页直接用，各页自己的代码别再起一样的名字。
   ============================================================ */
'use strict';
const { C, LINK, FS, projects, scanScripts, two, stampNow, nowText, timeOf, debounce, isComposing, store, query, pageUrl, shellUrl } = window.Base;
const { h, icon, toast, dialog, dlgShell, confirmDlg, choiceDlg, field, copyText, hideHov, popover, closePop } = window.UI;
/* 交给 AI 的话（给我提示词、Claude 桌面版等你按发送）：各页共用 公用/交给AI.js 的弹窗，这里替各页引好 */
if (!window.HandAI && document.currentScript) document.head.append(Object.assign(document.createElement('script'), { src: new URL('../公用/交给AI.js', document.currentScript.src).href }));
/* 等 AI 做事时的样子（转着的墨环、字上扫光）：公用/等待.js，这里替各页引好；页面里摆 <i class="wt-ring">、<span class="wt-t"> 就行 */
if (!window.Wait && document.currentScript) document.head.append(Object.assign(document.createElement('script'), { src: new URL('../公用/等待.js', document.currentScript.src).href }));
/* 提示词的名字：一场写几条就分几条。第一条叫 视频提示词.txt，第二条起 视频提示词_02.txt、_03.txt……（2026-11-13 他定的：加第二条时第一条不改名）。
   老稿还有 段落a-b_视频提示词.txt、镜头a-b_视频提示词.txt，照旧认。
   审片以后照修改方案改的另存一份，名字后面加 _改1、_改2……（2026-11-14 他定）：原稿、前几版留在原处；一条只摆最新那一版，出片也用它 */
const { RE_VP, vpVer, vpBase, vpNo, vpLabel, vpTok, vpNext, nameOk, sceneStem } = window.Core;   // 视频提示词怎么起名、文件名能不能用：和审片台、本机服务共用 公用/核心.js 那一份
const VID_RE = /\.(mp4|m4v|mov|webm)$/i;
const SHOTS_TAIL = '_批注截图';
const FILE = '流水线.json';
const NOTE_LINE = '项目管理「流水线」页存的。梗概：全片讲什么。人物、道具：全片的，一行一个，「资产」是它引用的那张图（引用了就是对上了）；道具有几个状态、引用了几张图时，「资产」是一个列表，一张图一个状态；「描写改」是这一行的描写最后改动的时间。场景：全片的场景描写，一行写一处地方；场景图：引用的场景图。可用：哪张图人看过、确认能用（图 → 确认的时间），确认过的图各场通用；图重出过、它那一行的描写改过，就要再确认。场：一场一场的，各场的「人物」「道具」写的是上面表里的名字，「场景图」是这一场用的场景图，「场景文字」是这一场用的、只用文字写的地方（全片「场景」里的原句，没有图也算），「段落」是这一场的剧本段落（一段写什么、起什么作用），不是镜头；没有镜头表这一步，镜头在写提示词的时候设计，写在提示词的「分镜」里。「定稿」是这一场的段落定下来的时间；「剧本定稿」是人看过 AI 写的剧本以后点的时间，有它、而且不早于「定稿」和剧本最后改动的时间，才许出这一场的资产图；这一场要的图都确认可用了，才写提示词。风格：全片的拍摄风格，「名」是 通用工具/AI短片风格库 里的一种，或者「本项目自己的」（照 提示词/全局资产/全片_光影总基调.txt），「定」是定下来的时间，「换」是从别的风格换过来的时间；一场另选的写在那一场的「风格」里（「风格换」是这一场换风格的时间），没写就照全片的；出资产图、写提示词照它写。「先写提示词」是 true 的场倒着走：人先选出场的人物、写提示词里人写的两块（生成目标、事件脚本），AI 照提示词反推剧本，段落、表达、出场的列在 定稿的剧本/第N段/第N段_反推.json，人点「采用」才写进这一场（「反推采用」是采用的那一份的时间）；剧本定稿以后 AI 再把提示词里它写的几块铺进正文。人在页面上写，AI 只读；一场就是一个「第N段」。';
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
  { key: '人物', no: '二', title: '人　物', cats: c => c === '人物', nameLab: '叫法', namePh: '戏里怎么叫他，比如：爸爸', descPh: '是谁、多大、和别人什么关系，会影响写戏的特点。长相、穿着的细节，剧本定稿后在资产那一步写。', sub: '全片的，一行一个。引用了资产，就和那张图对上了', unit: '个' },
  { key: '道具', no: '四', title: '道　具', cats: c => c !== '人物' && c !== '场景', nameLab: '名字', namePh: '比如：面车', descPh: '干什么用，会影响写戏的条件（比如能推着跑）。样子、材质的细节，剧本定稿后在资产那一步写。', sub: '全片的，一行一个。有几个状态的，可以引用几张图', unit: '件', multi: true },   // multi：一个道具可以引用几张图，一个状态一张
];
const KIND = Object.fromEntries(LISTS.map(K => [K.key, K]));
const isSceneImg = it => it.类别 === '场景';
/* 三种素材：人物、场景、道具（特效归道具）。各一个颜色：人物紫、场景蓝、道具赭，各页都照这个先后摆（11-13 他要「明确区分」） */
const KINDS = ['人物', '场景', '道具'];
const kindOf = c => c === '人物' || c === '人物图' ? '人物' : c === '场景' || c === '场景图' || c === '场景文字' ? '场景' : c === '关键帧' ? '关键帧' : '道具';
const kindCls = c => c && c !== '这一段' ? ({ 人物: 'k-ren', 场景: 'k-jing', 道具: 'k-dao', 关键帧: 'k-zhen' })[kindOf(c)] : '';   // 这一段文件夹里还没定当什么的图：不带颜色
/* 第四样：关键帧（11-13 夜他要的）。只给这一场用，图都在 资产/第N段（含下一层文件夹）。
   名字或它那一层文件夹的名字带「首帧」「尾帧」「关键帧」的自动算（这一场的「关键帧不用」里记着的除外，当了人物、场景、道具的也除外）；
   别的图在资产页点「＋ 新增关键帧」挑，记在这一场的「关键帧」里。挂到哪条提示词、当首帧还是第几个关键帧，在提示词那一步定 */
const FRAME_RE = /首帧|尾帧|关键帧/;
const arrOf = v => Array.isArray(v) ? v : [];
const frameNo = f => { const m = /(?:镜头|段落)\s*0*([0-9]+)/.exec(String(f).split('/').pop()); return m ? +m[1] : null; };   // 镜头3_首帧.png → 3
const frameSort = (a, b) => (frameNo(a) ?? 1e9) - (frameNo(b) ?? 1e9) || a.localeCompare(b, 'zh', { numeric: true });
function framesOf(s) {
  const skip = new Set(arrOf(s.关键帧不用)), others = new Set(KINDS.flatMap(k => arrOf(k === '场景' ? s.场景图 : s[SEG_FIELD[k]])));
  const auto = (F.frames.get(s.段) || []).map(x => x.file).filter(f => !skip.has(f) && !others.has(f));
  return [...new Set([...arrOf(s.关键帧), ...auto])].sort(frameSort);
}
const isAutoFrame = (s, f) => (F.frames.get(s.段) || []).some(x => x.file === f);
/* 这一场自己文件夹里的图（资产/第N段/… 和下一层文件夹里的，比如空镜、单样参考）：只给这一场用，挑的时候定它当人物、场景还是道具。
   当场景的记在这一场的「场景图」里（和全片引用的场景图放一起）；当人物、道具的记在这一场的「人物图」「道具图」里，不挂到全片人物表、道具表的哪一行 */
const SEG_FIELD = { 人物: '人物图', 场景: '场景图', 道具: '道具图' };
const segImg = (s, f) => String(f).startsWith('资产/' + segName(s.段) + '/');
const ownSegImgs = s => s.场景图.filter(f => segImg(s, f) && !F.doc.场景图.includes(f));
const segOf = (s, k) => k === '场景' ? ownSegImgs(s) : s[SEG_FIELD[k]];   // 这一场挑的这一段的图：当 k 用的那几张
const segKind = (s, f) => KINDS.find(k => segOf(s, k).includes(f)) || (framesOf(s).includes(f) ? '关键帧' : '');   // 这一段的这张图，这一场当什么用着
function putSeg(s, k, f) {   // 这一段的一张图，这一场当 k 用（原来当别的用的，挪过来）
  for (const x of KINDS) if (x !== k) s[SEG_FIELD[x]] = s[SEG_FIELD[x]].filter(g => g !== f);
  s.关键帧 = arrOf(s.关键帧).filter(g => g !== f); s.关键帧不用 = arrOf(s.关键帧不用).filter(g => g !== f);
  if (k === '关键帧') { if (!isAutoFrame(s, f)) s.关键帧.push(f); return; }   // 名字带首帧、关键帧的本来就算，不用另记
  if (isAutoFrame(s, f)) s.关键帧不用.push(f);   // 名字带首帧的图改当别的用：以后这一场不用它了，也别再自己冒回关键帧里
  if (!s[SEG_FIELD[k]].includes(f)) s[SEG_FIELD[k]].push(f);
}
/* 关键帧这一场不用了（图还在 资产/第N段 里） */
function dropFrame(s, f) {
  s.关键帧 = arrOf(s.关键帧).filter(g => g !== f);
  if (isAutoFrame(s, f) && !arrOf(s.关键帧不用).includes(f)) s.关键帧不用 = [...arrOf(s.关键帧不用), f];
}

/* 这一页手上的东西：哪个项目、流水线.json 读出来的样子、存到哪一步了、AI 那边写好的各样 */
const F = {
  name: '', projects: [], pj: null, doc: null, bad: '', text: '', mtime: 0, exists: false,
  seg: '',   // 一场的页面（分场、剧本、资产）：正在做第几场
  ver: 0, savedVer: 0, saving: null, again: false, savedAt: null, err: '',
  assets: new Map(), names: new Map(), clips: new Map(), docs: new Map(), gone: new Set(), pool: [], dirs: new Set(), ticks: 0, tok: 0, checking: false,
  frames: new Map(),   // 各场文件夹里名字带首帧、关键帧的图：段 → [{ file, mtime }]
  impact: new Map(),   // 剧本重新定稿以后 AI 列的影响清单：段 → { mtime, 时间, 上回, 总, 资产, 提示词 }
  shotLog: new Map(),  // 批准出片时记的：段 → { mtime, 记录: [{ 时间, 提示词, 提示词时间 }] }
  rev: new Map(),      // 先写提示词的场：AI 照提示词反推的（定稿的剧本/第N段/第N段_反推.json）：段 → { mtime, 时间, 段落, 人物, 新人物…… }
  words: new Map(),    // 文生资产：字（图名_提示词.txt）、GEO 底稿、字的批注、候选图、图的批注，各场文件夹里的图：路径 → 修改时间

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
    const { 段, 名, 场景: 旧场景, 人物: 人, 道具: 物, 场景图: 图, 场景文字: 景字, 人物图: 人图, 道具图: 物图, 关键帧: 帧, 关键帧不用: 帧不用, 表达, 段落, 镜头: 旧镜头, 资产: 旧资产, 定稿, 扩写, 剧本定稿, ...more } = s;   // 「段落」早先叫「镜头」，里面的「写什么」早先叫「拍什么」
    const seg = C.normSeg(str(段));
    if (!segOk(seg) || seen.has(seg)) continue;
    seen.add(seg);
    const paths = a => uniq(Array.isArray(a) ? a.map(cleanFile) : []);
    const one = { 段: seg, 名: str(名), 人物: uniq(人), 道具: uniq(物), 场景图: paths(图), 场景文字: uniq(景字), 人物图: paths(人图), 道具图: paths(物图), 关键帧: paths(帧), 关键帧不用: paths(帧不用), 表达: str(表达),
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
  const 场 = doc.场.map(({ 人物图, 道具图, 关键帧, 关键帧不用, 场景文字, ...s }) => ({ ...s, ...(uniq(场景文字).length ? { 场景文字: uniq(场景文字) } : {}), ...(人物图.length ? { 人物图 } : {}), ...(道具图.length ? { 道具图 } : {}), ...(arrOf(关键帧).length ? { 关键帧 } : {}), ...(arrOf(关键帧不用).length ? { 关键帧不用 } : {}), 名: s.名.trim(), 表达: s.表达.trim(), 段落: s.段落.map(x => ({ ...x, 写什么: x.写什么.trim(), 作用: x.作用.trim() })) }));   // 人物图、道具图（这一段的图当人物、道具用）空着就不写
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
async function loadPool(name, lsIn) {   // lsIn：loadSides 那一轮的 lister（列过的不再列）
  const ls = lsIn || lister(name), out = [];
  const cats = (await ls('资产/全局资产')).filter(e => e.kind === 'directory' && !e.name.endsWith(SHOTS_TAIL)).map(e => e.name).sort((a, b) => (catRank(a) - catRank(b)) || byZh(a, b));
  for (const c of cats) for (const e of (await ls('资产/全局资产/' + c)).filter(x => x.kind === 'file' && IMG_RE.test(x.name) && !CAND_RE.test(x.name)).sort((a, b) => byZh(a.name, b.name)))   // 候选图（图名_候选.png）不算现成的图
    out.push({ 类别: c, 名称: stemOf(e.name), 文件: '资产/全局资产/' + c + '/' + e.name, mtime: e.mtime || 0 });
  if (ls.failed) throw new Error('本机服务连不上');   // 有一层没列出来：留着手里原来的
  return out;
}
/* 这一场文件夹里的图：资产/第N段 本层，和下一层的文件夹（空镜、关键帧、参考……）。组：在哪个文件夹，本层是空的 */
async function loadSegPool(name, seg) {
  const ls = lister(name), base = '资产/' + segName(seg), top = await ls(base);
  const imgs = (list, dir) => list.filter(x => x.kind === 'file' && IMG_RE.test(x.name) && !CAND_RE.test(x.name)).sort((a, b) => byZh(a.name, b.name))
    .map(x => ({ 类别: '这一段', 组: dir, 名称: stemOf(x.name), 文件: base + '/' + (dir ? dir + '/' : '') + x.name }));
  const out = imgs(top, '');
  for (const d of top.filter(e => e.kind === 'directory' && !e.name.endsWith(SHOTS_TAIL)).map(e => e.name).sort(byZh)) out.push(...imgs(await ls(base + '/' + d), d));
  if (ls.failed) throw new Error('本机服务连不上');
  return out;
}
/* 按文件夹分组：名字里有「空镜」「场景」的文件夹排最前，再是本层，再是别的文件夹 */
function segGroups(items) {
  const m = new Map();
  for (const x of items) { if (!m.has(x.组)) m.set(x.组, []); m.get(x.组).push(x); }
  const rank = g => /空镜|场景/.test(g) ? 0 : g ? 2 : 1;
  return [...m].sort((a, b) => rank(a[0]) - rank(b[0]) || byZh(a[0], b[0]));
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
  if (!keep || F.name !== name) { F.assets.clear(); F.names.clear(); F.docs.clear(); F.frames.clear(); F.impact.clear(); F.shotLog.clear(); F.rev.clear(); F.gone = new Set(); F.dirs = new Set(); F.savedAt = null; F.ai = { mtime: 0, data: null }; F.words = new Map(); F.wordSig = undefined; F.poolSig = undefined; }
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
const castSig = s => LISTS.map(K => s[K.key].join('、')).join('｜') + '｜' + s.场景图.join('、') + '｜' + s.人物图.join('、') + '｜' + s.道具图.join('、') + '｜' + uniq(s.场景文字).join('、');
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
    .map(x => ({ 类别: str(x.类别).trim(), 名称: str(x.名称).trim(), 文件: cleanFile(x.文件), 状态: str(x.状态).trim(), 说明: str(x.说明).trim(), at: '',
      状态名: str(x.状态名).trim(), 要撑住: str(x.要撑住).trim(), 核图: str(x.核图).trim(), 核图时间: +x.核图时间 || 0, 核GEO: str(x.核GEO).trim(), 拿回去批图: str(x.拿回去批图).trim(), 核GEO时间: str(x.核GEO时间), 提示词: str(x.提示词).trim(),
      替人定的: (Array.isArray(x.替人定的) ? x.替人定的 : []).map(t => str(t).trim()).filter(Boolean).slice(0, 12),
      过程: (Array.isArray(x.过程) ? x.过程 : []).filter(p => p && typeof p === 'object').map(p => ({ 时间: str(p.时间), 事: str(p.事), 渠道: str(p.渠道), 目录: str(p.目录).replace(/\\/g, '/') })).filter(p => p.事).slice(-12) }));   // 后面几样是文生资产那一套记的（写字、出图、核图、核 GEO；关键帧对着哪一条提示词；AI 替人定的、AI 在这一样上做过的事）
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
  for (const file of [...LISTS.flatMap(K => F.doc[K.key].flatMap(x => x.资产)), ...F.doc.场景图, ...F.doc.场.flatMap(s => [...s.场景图, ...s.人物图, ...s.道具图, ...arrOf(s.关键帧)])].filter(Boolean)) {
    const parts = assetParts(file);
    const ent = parts ? (await ls(parts.slice(0, -1).join('/'))).find(e => e.kind === 'file' && e.name === parts[parts.length - 1]) : null;
    if (!ent) gone.add(file); else itime.set(file.toLowerCase(), ent.mtime || 0);
  }
  // 各场文件夹里名字（或那一层文件夹的名字）带首帧、尾帧、关键帧的图：自动算这一场的关键帧
  const frames = new Map();
  for (const s of F.doc.场) {
    const base = '资产/' + segName(s.段), list = [];
    if (!F.dirs.has(segName(s.段))) { frames.set(s.段, list); continue; }
    const top = await ls(base);
    const take = (ents, dir) => { for (const e of ents) if (e.kind === 'file' && IMG_RE.test(e.name) && !CAND_RE.test(e.name) && !BMF_RE.test(e.name) && FRAME_RE.test(dir + '/' + stemOf(e.name))) { const file = base + '/' + (dir ? dir + '/' : '') + e.name; list.push({ file, mtime: e.mtime || 0 }); itime.set(file.toLowerCase(), e.mtime || 0); } };
    take(top, '');
    for (const d of top.filter(e => e.kind === 'directory' && !e.name.endsWith(SHOTS_TAIL))) take(await ls(base + '/' + d.name), d.name);
    frames.set(s.段, list.sort((a, b) => frameSort(a.file, b.file)));
    for (const x of list) if (!itime.has(x.file.toLowerCase())) itime.set(x.file.toLowerCase(), x.mtime || 0);   // 关键帧重出过：确认要重来
  }
  // 文生资产：字（图名_提示词.txt）、GEO 底稿、字的批注在不在；候选图（图名_候选.png）、图上写的批注在不在；各场文件夹本层的图（关键帧）
  const words = new Map(), PW = /(_提示词\.txt|_提示词_批注\.md|_GEO底稿\.md)$/i;
  for (const c of ['人物', '道具', '场景']) {
    for (const e of await ls('提示词/全局资产/' + c)) if (e.kind === 'file' && PW.test(e.name)) words.set('提示词/全局资产/' + c + '/' + e.name, e.mtime || 0);
    for (const e of await ls('资产/全局资产/' + c)) if (e.kind === 'file' && (CAND_RE.test(e.name) || /_批注\.md$/i.test(e.name))) words.set('资产/全局资产/' + c + '/' + e.name, e.mtime || 0);
  }
  for (const s of F.doc.场) {
    if (!s.定稿) continue;
    const pd = '提示词/' + segName(s.段), ad = '资产/' + segName(s.段);
    for (const e of await ls(pd)) if (e.kind === 'file' && PW.test(e.name)) words.set(pd + '/' + e.name, e.mtime || 0);
    if (F.dirs.has(segName(s.段))) for (const e of await ls(ad)) if (e.kind === 'file' && (IMG_RE.test(e.name) || /_批注\.md$/i.test(e.name))) words.set(ad + '/' + e.name, e.mtime || 0);
  }
  try {   // 全局资产里现成的图也重读一遍：AI 新出的图（只用文字写的场景出了图）要看得见
    const pool = await loadPool(name, ls), psig = pool.map(x => x.文件 + '@' + x.mtime).join('|');
    if (psig !== F.poolSig) { const first = F.poolSig === undefined; F.poolSig = psig; F.pool = pool; if (!first) changed.add('*'); }
  } catch (e) { /* 列不出来：下面就停 */ }
  if (F.name !== name || ls.failed) return changed;
  const wsig = [...words].map(([k, v]) => k + '@' + v).sort().join('|');
  if (wsig !== F.wordSig) { const first = F.wordSig === undefined; F.wordSig = wsig; F.words = words; if (!first) { for (const s of F.doc.场) changed.add(s.段); changed.add('*'); } }
  const fsig = m => [...m].map(([k, v]) => k + ':' + v.map(x => x.file).join(',')).sort().join('|');
  if (fsig(frames) !== fsig(F.frames)) { F.frames = frames; for (const s of F.doc.场) changed.add(s.段); changed.add('*'); }
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
    if (!s.定稿 && !isRev(s)) continue;   // 先写提示词的场：段落还没定也要看提示词、反推出来的剧本
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
        if (!it.at || it.类别 === '关键帧' || !KIND[aiKey(it)]) continue;
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
    const dents = await ls('定稿的剧本/' + segName(seg)), docx = dents.filter(e => e.kind === 'file' && /\.docx$/i.test(e.name) && !e.name.startsWith('~$'));
    const sts = await Promise.all(docx.map(e => FS.stat(at([name, '定稿的剧本', segName(seg), e.name]))));
    if (F.name !== name || ls.failed) return out();
    const dsig = docx.map((e, i) => e.name + '@' + (sts[i] ? sts[i].mtime : 0)).sort().join('|'), dwas = F.docs.get(seg);
    if (dwas !== dsig) { F.docs.set(seg, dsig); if (dwas !== undefined) { changed.add(seg); rescan = true; } }
    // 剧本重新定稿以后 AI 列的影响清单（定稿的剧本/第N段/第N段_影响清单.json）、批准出片时记的出片记录（资产/第N段_出片记录.json）：页面只读
    const ifn = segName(seg) + '_影响清单.json', ient = dents.find(e => e.kind === 'file' && e.name === ifn), iwas = F.impact.get(seg);
    if (!ient) { if (iwas) { F.impact.delete(seg); changed.add(seg); changed.add('*'); } }
    else {
      const ist = await FS.stat(at([name, '定稿的剧本', segName(seg), ifn]));
      if (ist && (!iwas || iwas.mtime !== ist.mtime)) {
        let v = null;
        try { v = normImpact(await readJson(at([name, '定稿的剧本', segName(seg), ifn]))); } catch (e) { /* 读不了就当没有 */ }
        if (F.name !== name) return out();
        if (v) { F.impact.set(seg, { mtime: ist.mtime, ...v }); changed.add(seg); changed.add('*'); }
      }
    }
    // 先写提示词的场：AI 照提示词反推的段落、出场的（定稿的剧本/第N段/第N段_反推.json）：页面只读，你点「采用」才写进这一场
    const rfn = segName(seg) + REV_TAIL, rent = dents.find(e => e.kind === 'file' && e.name === rfn), rwas = F.rev.get(seg);
    if (!rent) { if (rwas) { F.rev.delete(seg); changed.add(seg); changed.add('*'); } }
    else {
      const rp = at([name, '定稿的剧本', segName(seg), rfn]), rst = await FS.stat(rp);
      if (rst && (!rwas || rwas.mtime !== rst.mtime)) {
        let v = null;
        try { v = normRev(await readJson(rp)); } catch (e) { /* 读不了就当没有 */ }
        if (F.name !== name) return out();
        if (v) { F.rev.set(seg, { mtime: rst.mtime, ...v }); changed.add(seg); changed.add('*'); }
      }
    }
    const sfn = segName(seg) + '_出片记录.json', swas = F.shotLog.get(seg);
    if (!lists.has(sfn)) { if (swas) { F.shotLog.delete(seg); changed.add(seg); } }
    else {
      const sp = at([name, '资产', sfn]), sst = await FS.stat(sp);
      if (sst && (!swas || swas.mtime !== sst.mtime)) {
        let rows = [];
        try { const j = await readJson(sp); rows = (j && Array.isArray(j.记录) ? j.记录 : []).filter(x => x && x.提示词).map(x => ({ 时间: str(x.时间), 提示词: str(x.提示词), 提示词时间: +x.提示词时间 || 0 })); } catch (e) { /* 读不了就当没有 */ }
        if (F.name !== name) return out();
        F.shotLog.set(seg, { mtime: sst.mtime, 记录: rows }); changed.add(seg);
      }
    }
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
  const fg = d.风格 && typeof d.风格 === 'object' ? d.风格 : {};   // AI 推荐的拍摄风格（推荐风格那件事写的）
  return { 人物: rows(d.人物), 道具: rows(d.道具), 场景: { 描写: str(sc.描写).trim(), 底稿: cleanFile(sc.底稿), 时间: str(sc.时间) }, 风格: { 推荐: str(fg.推荐).trim(), 理由: str(fg.理由).trim(), 备选: str(fg.备选).trim(), 段: str(fg.段).trim(), 时间: str(fg.时间) } };
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
  const by = new Map();   // 一条（原稿名）→ 它的几版：原稿、_改1、_改2……
  for (const n of rec.set) if (RE_VP.test(n)) { const b = vpBase(n); if (!by.has(b)) by.set(b, []); by.get(b).push(n); }
  return [...by].map(([key, vers]) => {
    vers.sort((a, b) => vpVer(a) - vpVer(b));
    const n = vers[vers.length - 1], stem = n.replace(/\.txt$/i, '');   // 摆最新的那一版：改稿、批注、生成任务书、出片都对着它
    return { name: n, key, ver: vpVer(n), vers, label: vpLabel(n), tok: vpTok(n), draft: rec.set.has(stem + '_写稿.json') };
  });
}

/* ---------- 小图、悬停看大图：路径从项目里面写起（资产/全局资产/人物/x.png） ---------- */
const thumbImg = (file, w) => window.UI.thumbImg(at([F.name, ...file.split('/')]), w);
const hoverable = (el, file, title) => window.UI.hoverable(el, at([F.name, ...file.split('/')]), title || baseOf(file), file);

/* ---------- 看文件：剧本、提示词、图、样片整页盖上来（通用工具/项目管理.html 嵌着用），能写批注；看完点「回到流水线」 ---------- */
let SHELL = null;
function openShell(parts, title, extra) {   // extra(close)：顶上那一条里另外摆的东西
  closePop(); hideHov();
  if (SHELL) SHELL.remove();
  const close = () => { if (!SHELL) return; SHELL.remove(); SHELL = null; document.body.classList.remove('wf-covered'); refresh(); };
  SHELL = h('div', { class: 'wf-shell' },
    h('div', { class: 'wf-shell-h' }, h('button', { class: 'btn sm ink', type: 'button', onclick: close }, '← 回到流水线'), h('span', { class: 'wf-shell-t' }, title || ''), h('span', { class: 'sp' }),
      extra ? [extra(close)].flat(Infinity).filter(Boolean) : null),
    h('iframe', { class: 'wf-shell-frame', title: title || '看文件', src: shellUrl(parts) }));
  document.body.append(SHELL); document.body.classList.add('wf-covered');
}
const openImage = (file, extra) => openShell(at([F.name, ...file.split('/')]), baseOf(file), extra);
/* 你来写提示词：把写稿那一页（通用工具/项目管理_写稿试用.html）盖上来。它自己读写文件、自己开 AI 任务（请 AI 批、把批注交给 AI 改）；
   写完点「回到流水线」，没存的字先存上。
   页头不盖（2026-11-15 他要的：写提示词时也得看得见「AI 用」选的是谁、能换）：从页头下面盖起（wf-write）；
   写稿页交 AI 的活现读页头选的 AI、模型、推理（同一份本机记录）。点页头去别的页、换项目，也先把写稿页存上（SHELL.leave，go、pickProject 里调） */
function openWrite(seg, name) {
  closePop(); hideHov();
  if (SHELL) SHELL.remove();
  const frame = h('iframe', { class: 'wf-shell-frame', title: '写提示词', src: encodeURI('/通用工具/项目管理_写稿试用.html') + '#open=' + [F.name, '提示词', segName(seg), name].map(encodeURIComponent).join('/') });
  const keep = async () => {   // 写稿页没存的字先存上；存不上返回 false，留在写稿页
    try {
      const w = frame.contentWindow;
      if (w && typeof w.save === 'function' && await w.save() === false) { toast('草稿还未保存，请在写稿页处理后再离开', 'err'); return false; }
    } catch (e) { toast('草稿没存上：' + e.message, 'err'); return false; }
    return true;
  };
  const close = async () => {
    if (!SHELL) return;
    if (!await keep()) return;
    if (SHELL) SHELL.remove();
    SHELL = null; document.body.classList.remove('wf-covered'); await refresh();
    if (PAGE.sides) PAGE.sides(new Set(['*']));   // 写稿页里挂的图、白模记在过程文件里：回来就重读，不等下一轮
  };
  SHELL = h('div', { class: 'wf-shell wf-write' },
    h('div', { class: 'wf-shell-h' }, h('button', { class: 'btn sm ink', type: 'button', onclick: close }, '← 回到流水线'),
      h('span', { class: 'wf-shell-t' }, '第' + seg + '场 · ' + vpLabel(name) + ' · 你来写'), h('span', { class: 'sp' }),
      h('span', { class: 'fn-note' }, [F.doc ? F.doc.场.find(x => x.段 === seg) : null].map(s => s && isRev(s) && !s.剧本定稿 ? '这一场先写提示词：写好了点右上角「让 AI 反推剧本」，不用回流水线。' : '写好生成目标、事件脚本，点「AI 铺底」让 AI 补上其余几块。')[0])),
    frame);
  SHELL.leave = keep;
  document.body.append(SHELL); document.body.classList.add('wf-covered');
}
/* 看这一段现有的剧本、镜头表（整页盖上来看，能写批注） */
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
const AI = { ok: false, jobs: [] };
const CH = window.Base.CH;   // 用哪个 AI、它的模型和推理深度：各页共用 底座.js 的那一份
const SELF_CH = CH.SELF;   // 「给我提示词」的渠道号
const chNow = CH.now, chName = CH.name, handOf = CH.hand;
const jobLive = j => !!j && (j.状态 === '排队' || j.状态 === '在做');
/* 这件事（这一场）最近的一个任务 */
const jobOf = (事, 段, pred) => AI.jobs.filter(j => j.事 === 事 && (段 == null || j.段 === 段) && (!pred || pred(j))).pop() || null;
const chPicker = () => AI.ok ? window.UI.aiPicker('ai-ch', '点「让 AI ……」的时候交给谁。选「给我提示词」就不调 AI：把要交代的话给你，贴进你自己开的对话，它做完告诉项目。出图、出片走 Codex') : null;
/* 开一个任务。quiet：不单独提示（一次开好几个时最后统一说一句） */
async function startJob(body, quiet) {
  await flush();
  if (F.err) return null;
  try {
    const b = CH.fill({ 项目: F.name, 渠道: chNow(), ...body });   // 模型、推理深度只说「AI 用」选的那一个（出片这类指定了 Codex 的不带）
    const j = await (await LINK.req('POST', '/api/job', C.encodeText(JSON.stringify(b)))).json();
    AI.jobs = AI.jobs.filter(x => x.id !== j.id).concat(j);
    const hand = j.渠道 === b.渠道 ? handOf(j.渠道) : '';   // 同一件事已经在做的，服务给的是原来那个任务
    if (hand === 'self' && window.HandAI) HandAI.wait(j, () => loadJobs());   // 给我提示词：话备好就弹出来给你复制
    if (!quiet) toast(hand === 'self' ? '要交代的话备好就弹出来：复制，贴进你自己开的对话。它做完这里自动出现'
      : hand === 'claude' ? '在 Claude 桌面版开了一个新对话，任务填好了：到 Claude 窗口里按发送。做完这里自动出现'
      : hand === 'deepseek' ? '交给 DeepSeek 了：它在自己的窗口里做，做完这里自动出现'
      : '交给 ' + j.渠道名 + ' 了。做完这里自动出现');
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
  return h('span', { class: 'ai-run' }, h('i', { class: 'wt-ring' }),
    h('span', { class: 'wt-t' }, j.状态 === '排队' ? j.渠道名 + ' 排着队，前面还有别的任务' : (j.步骤 || j.渠道名 + ' 在做')),
    h('b', { 'data-t0': String(j.开始 || j.建) }, ''),
    ...(window.HandAI ? HandAI.buttons(j, () => loadJobs()) : []),   // 等你交给 AI 的、Claude 等你按发送的：「交给 AI 的话」「再开一次」
    h('button', { class: 'fl-link', type: 'button', title: '不等了，停掉这个任务', onclick: async () => { await LINK.req('POST', '/api/job/' + j.id + '?cancel').catch(() => {}); loadJobs(); } }, '停掉'));
}
/* ---------- 给我提示词（11-14 他定：用 AI 的地方都有两种——给我提示词、项目直接调；在顶栏「AI 用」里选）：
   不经这里调 AI，要交代的话弹出来（公用/交给AI.js），你贴进自己开的 Codex、Claude、DeepSeek 对话。
   AI 把回复写进这一回文件夹里的回复文件（或者跑一句命令告诉服务），这里自动接着做；它写不了文件，把回复贴回来也行。
   有几处原来单独摆了「自己交给 AI」的按钮（startSelf），照旧能用：这一回不管顶栏选的是谁，都给我提示词 ---------- */
const isSelf = j => !!j && j.渠道 === SELF_CH;
const selfOk = () => AI.ok && CH.list.some(c => c.id === SELF_CH);   // 本机服务 11-14 晚那一版起，「AI 用」里有这一项
async function startSelf(body) {
  if (!selfOk()) { toast('本机服务是旧的，重开一次才能给你提示词', 'err'); return null; }
  const j = await startJob({ ...body, 渠道: SELF_CH }, true);
  if (j && !isSelf(j)) toast('这一样已经交给 ' + j.渠道名 + ' 在做了', 'err');
  return j;
}
/* 上一回没做成：说一句为什么（做成过、或者过了半小时就不提了） */
function jobFailed(事, 段, pred) {
  const j = jobOf(事, 段, pred);
  return j && (j.状态 === '没成') && Date.now() - j.结束 < 30 * 60e3 ? h('span', { class: 'fn-note warn', title: '任务书和 AI 的回答留在：' + j.记录 }, '上一回' + (j.本机 ? '' : ' ' + (j.事 === '出片' ? 'Codex' : j.渠道名) + ' ') + '没做成：' + j.错误) : null;   // 本机的活（生成任务书）不经 AI；出片是 Codex 做的
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
function upTime(s, name) {   // name：哪一条提示词。剧本重新定稿、影响清单没列上这一条的：剧本照上回定稿的时间算（没受影响，不用你再看）
  const v = name ? impactOf(s) : null, fin = v && !v.提示词.some(x => vpBase(x.文件) === vpBase(name)) ? timeOf(v.上回) : timeOf(s.剧本定稿);
  let t = Math.max(fin, assetCheckTime(s), timeOf(s.出场改), styleChangedAt(s));   // 换了拍摄风格也算
  for (const K of LISTS) for (const n of s[K.key]) { const e = entryOf(K.key, n); if (e) t = Math.max(t, timeOf(e.改)); }   // 出场的人物、道具那一行动过：描写、换了图、去掉一张图
  return t;
}
/* 这条提示词是不是前面又动过以前写的 */
function promptStale(s, name) {
  if (isRev(s) && !s.剧本定稿) return false;   // 先写提示词的场：剧本定稿以前提示词就是源头，前面没有能让它过时的
  if (jobLive(jobOf('直接铺底', s.段, j => j.名 === name))) return false;   // AI 正在把它写的几块铺进去：铺完文件就是新的
  const rec = F.names.get(s.段), t = rec && rec.time ? rec.time.get(name) || 0 : 0;
  if (!t) return false;   // 不知道它什么时候写的（老版本的服务）：不乱标
  return Math.max(t, timeOf(keptOf(s)['提示词/' + name])) + 999 < upTime(s, name);
}
/* 选定的这条样片：它出了以后，那条提示词又改过（照修改方案改出了新的一版也算），或者前面几道又动过。pname：这一条的原稿名（哪一版的名字都行） */
function clipStale(s, pname, vid) {
  const c = F.clips.get(s.段), p = F.names.get(s.段), t = c && c.time ? c.time.get(vid) || 0 : 0;
  if (!t) return false;
  const e = promptsOf(s.段).find(x => x.key === vpBase(pname)), cur = e ? e.name : pname;   // 这一条现在最新的那一版
  const kept = timeOf(keptOf(s)['样片/' + vid]), pt = p && p.time ? p.time.get(cur) || 0 : 0, rec = shotRecOf(s.段, cur, t);
  if (rec) return Math.max(timeOf(rec.时间), kept) + 999 < upTime(s, cur) || (rec.提示词 === cur ? !!rec.提示词时间 && Math.max(rec.提示词时间, kept) + 999 < pt : Math.max(timeOf(rec.时间), kept) + 999 < pt);   // 照批准出片时那一版提示词算（11-14 和 Codex 定的），不照样片下载下来的时间；照的是旧的一版，新的一版就是后来改的
  return Math.max(t, kept) + 999 < Math.max(upTime(s, cur), pt);
}
/* 这条样片当初照哪一版出的：出片记录里，样片下载下来以前批准出这一条（哪一版都算）的最后一回 */
function shotRecOf(seg, pname, t) {
  const r = F.shotLog.get(seg), b = vpBase(pname), xs = r ? r.记录.filter(x => vpBase(String(x.提示词 || '')) === b && timeOf(x.时间) <= t + 999) : [];
  return xs.length ? xs[xs.length - 1] : null;
}
/* ---------- 影响清单（2026-11-14 文生资产流程图「中途改剧本」）：剧本重新定稿以后，AI 对一遍新旧剧本，列出哪些资产、提示词要再看、为什么。
   列上的标出来，没列上的照旧（不用你一样一样再看）；也可以点「全部重看」，照老办法这一场的图全都再核一遍。
   清单在 定稿的剧本/第N段/第N段_影响清单.json（AI 写，页面只读）；看过了的记在这一场的「沿用」里（'影响/类别/名称'） ---------- */
function normImpact(j) {
  if (!j || typeof j !== 'object') return null;
  return { 时间: str(j.时间), 上回: str(j.上回), 总: str(j.总).trim(),
    资产: (Array.isArray(j.资产) ? j.资产 : []).filter(x => x && str(x.名称).trim()).map(x => ({ 类别: str(x.类别).trim(), 名称: str(x.名称).trim(), 影响: str(x.影响).trim(), 为什么: str(x.为什么).trim() })),
    提示词: (Array.isArray(j.提示词) ? j.提示词 : []).filter(x => x && str(x.文件).trim()).map(x => ({ 文件: str(x.文件).trim(), 为什么: str(x.为什么).trim() })) };
}
/* 眼下算数的影响清单：这一回定稿以后列的；点过「全部重看」就不算 */
function impactOf(s) {
  const v = F.impact.get(s.段);
  return !v || !s.剧本定稿 || timeOf(v.时间) + 999 < timeOf(s.剧本定稿) || s.影响全看 === v.时间 ? null : v;
}
const impactKey = x => '影响/' + kindOf(x.类别) + '/' + x.名称;
const impactPrompt = (s, name) => { const v = impactOf(s); return v ? v.提示词.find(x => vpBase(x.文件) === vpBase(name)) || null : null; };   // 改过几版的：清单上写哪一版都算这一条
/* 清单上列的资产，还没处理的。处理了：要改的那张图后来又确认过；要加的这一场选上了；不用了的这一场去掉了；或者你点了「看过了」 */
function impactTodo(s, v) {
  v = v || impactOf(s);
  if (!v) return [];
  const t = timeOf(v.时间), list = assetsOf(s).list;
  const mine = x => list.filter(it => kindOf(it.类别) === kindOf(x.类别) && (it.名称 === x.名称 || (!!it.文字 && sceneStem(it.文字) === x.名称)));
  return v.资产.filter(x => {
    if (timeOf(keptOf(s)[impactKey(x)]) + 999 >= t) return false;
    const m = mine(x);
    return x.影响 === '要加' ? !m.length : x.影响 === '不用了' ? m.length > 0 : !m.some(it => it.at && timeOf(F.doc.可用[it.at]) > t + 999);
  });
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
  for (const it of assetsOf(s).list) if (it.at && it.类别 !== '关键帧') t = Math.max(t, timeOf(F.doc.可用[it.at]));   // 关键帧只管挂了它的那一条，确认它不让这一场所有提示词都待核对
  return t;
}
/* 工序三 资产：剧本定稿以后才开；这一场要的图都有了、每一张你都确认过可用，就算完（不用另外再点）。剧本重新定过稿，要再看一遍（待核对） */
function assetState(s) {
  if (!s.定稿 || scriptState(s).st !== 'final') return { st: 'lock', tx: '剧本定稿后' };
  if (jobLive(jobOf('出图', s.段))) return { st: 'ai', tx: 'AI 在出图' };
  if (jobLive(jobOf('写字', s.段))) return { st: 'ai', tx: 'AI 在写字' };
  if (jobLive(jobOf('影响清单', s.段))) return { st: 'ai', tx: 'AI 在对剧本' };
  const list = assetsOf(s).list.filter(x => x.类别 !== '关键帧'), has = list.filter(x => x.at), lack = list.filter(x => !x.at && !x.文字).length, ok = has.filter(okOf).length;   // 只用文字写的场景不算缺；关键帧在提示词那一步做、在那一步确认，不算这一步的（11-14 流程图丙）
  if (!list.length) return { st: 'you', tx: '没选出场的' };   // 光有关键帧（文件夹里自动列上的）不算选了出场的
  if (lack) return { st: 'you', tx: '缺 ' + lack + ' 张', ok, n: has.length };
  if (ok < has.length) return { st: 'you', tx: '确认 ' + ok + '/' + has.length, ok, n: has.length };
  const again = !!s.头回定稿 && timeOf(s.头回定稿) + 999 < timeOf(s.剧本定稿);   // 头回定稿：剧本头一回定稿的时间（剧本页点定稿时记的）
  const im = again ? impactOf(s) : null, todo = im ? impactTodo(s, im) : [];   // 有影响清单：只看列上的
  if (todo.length) return { st: 'you', tx: '待核对', why: '剧本改了，AI 列了 ' + todo.length + ' 样要再看', impact: todo, ok, n: has.length };
  if (again && !im && assetCheckTime(s) + 999 < timeOf(s.剧本定稿)) return { st: 'you', tx: '待核对', why: '剧本重新定过稿了', ok, n: has.length };
  if (has.length && assetCheckTime(s) + 999 < styleChangedAt(s)) return { st: 'you', tx: '待核对', why: '拍摄风格换过了', ok, n: has.length };   // 图是照原来的风格出的
  return { st: 'ok', tx: '确认了', ok, n: has.length };
}
/* 工序四 提示词：不等前面，什么时候写你自己定（11-13 他说：有的资产用文字锁，资产没出全、没确认也能写）；一场可以分几条。镜头在提示词的「分镜」里设计（镜头表那一步取消了） */
function promptState(s) {
  if (jobLive(jobOf('写提示词', s.段))) return { st: 'ai', tx: 'AI 在写' };
  if (jobLive(jobOf('直接铺底', s.段))) return { st: 'ai', tx: 'AI 在铺底' };
  const list = promptsOf(s.段), n = list.length;
  if (isRev(s) && scriptState(s).st !== 'final') return { st: 'lock', tx: '剧本定稿后', n };   // 先写提示词的场：你写的那两块在第一步写，AI 写的几块剧本定稿了才铺
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
  const picked = list.filter(e => sel[e.key] && vids.includes(sel[e.key])), done = picked.length;   // 选定记在这一条的原稿名下：改出了新的一版，选定还在
  if (picked.some(e => clipStale(s, e.key, sel[e.key]))) return { st: 'you', tx: '待核对' };
  if (done < list.length) return { st: 'you', tx: '选定 ' + done + '/' + list.length };
  return s.成片定稿 ? { st: 'ok', tx: '定稿了' } : { st: 'you', tx: '等你定稿' };
}
/* 一场的五步各是什么样：ok 做完了、you 等你、ai AI 在做、lock 前一步没完还不能做 */
function stepInfo(s) {
  if (revFront(s)) {   // 先写提示词、还没采用过反推的：第一步是选人物、写提示词、让 AI 反推；反推好了到剧本那一步去采用
    const n = promptsOf(s.段).length, rj = revJob(s), rv = revPending(s);
    const a = rj ? { st: 'ai', tx: 'AI 在反推' } : rv ? { st: 'ok', tx: '反推好了' } : n ? { st: 'you', tx: n + ' 条，可以反推' } : { st: 'you', tx: s.人物.length ? '写提示词' : '先选人物' };
    const b = rj ? { st: 'ai', tx: 'AI 在反推' } : rv ? { st: 'you', tx: '等你采用' } : { st: 'lock', tx: '反推以后' };
    return [a, b, assetState(s), promptState(s), reviewState(s)];
  }
  const a = s.定稿 ? { st: 'ok', tx: '定了' } : { st: 'you', tx: s.段落.some(x => x.写什么.trim()) ? '在写' : '还没写' };
  const sc = s.定稿 ? scriptState(s) : null;
  const b = !sc ? { st: 'lock', tx: '先定段落' } : sc.st === 'none' ? { st: 'you', tx: '还没写' } : sc.st === 'wait' ? { st: 'ai', tx: 'AI 在写' } : sc.st === 'old' ? { st: 'you', tx: '剧本是旧的' }
    : sc.st !== 'final' ? { st: 'you', tx: sc.again ? '改过，再定稿' : '等你定稿' }
      : { st: 'ok', tx: '定稿了' };
  return [a, sc && sc.st !== 'wait' && isRev(s) && revPending(s) ? { st: 'you', tx: '等你采用' } : b, assetState(s), promptState(s), reviewState(s)];   // 又反推了一回、还没采用：先采用再定稿
}

/* ---------- 这一页：各页把自己登记进来（start），这里管顶栏、步骤条、存盘、隔一会儿看一眼 ---------- */
let PAGE = null;      // { name: 哪一页, scene: 是不是一场的页面, wide: 要不要宽一点, render(): 画出这一页的内容, repaint(): 只换会变的那几块（有就不整页重画）, sides(changed): AI 那边有变化时怎么办（不写就整页重画）, steps(): 步骤条换了以后顺带做的, leave(): 换页前这一页自己先存的 }
const REPAINT = {};   // 人物、道具两张表，场景图那一排：各自怎么重画
const sceneNow = () => F.doc ? F.doc.场.find(x => x.段 === F.seg) || null : null;
/* 换一页：先把没存的存上 */
async function go(page, opts, hash) {
  closePop(); hideHov();
  if (SHELL && SHELL.leave && !await SHELL.leave()) return;   // 写稿页盖着（页头露着，能直接点去别处）：先把它没存的字存上
  if (PAGE && PAGE.leave) await PAGE.leave();   // 这一页自己还有没存的（剧本页自己写的剧本）：先存上
  await flush();
  location.href = pageUrl(page, { p: F.name, ...(opts || {}) }, hash);
}
const noneBox = (msg, ...acts) => h('div', { class: 'welcome' }, h('div', { class: 'w-inner' }, h('div', { class: 'seal w-seal' }, '案'), h('div', { class: 'w-title sm' }, '流水线'), h('p', { class: 'w-note' }, msg), ...acts));
const againBtn = () => h('button', { class: 'btn', type: 'button', onclick: () => location.reload() }, '再试一次');
const badBox = () => h('div', { class: 'fl-bad' }, h('b', null, '流水线.json 读不了。'), h('p', null, F.bad),
  h('p', { class: 'faint small' }, '这个文件被改坏了，页面先不动它。让 AI 看一下，修好以后点「重新读」。'), h('button', { class: 'btn', onclick: () => location.reload() }, '重新读'));
function renderTop() {
  const s = PAGE.scene ? sceneNow() : null;
  return h('header', { class: 'top wf-top' },
    PAGE.name === '总览' ? h('div', { class: 'seal sm', title: '项目管理 · 流水线' }, '案')
      : h('a', { class: 'wf-back', href: pageUrl('总览', { p: F.name }), title: '回首页：看各场走到哪一道工序', onclick: e => { e.preventDefault(); go('总览'); } }, '← 首页'),
    h('div', { class: 'crumb' },
      h('button', { class: 'ptitle', title: '换一个项目', onclick: pickProject }, F.name),
      PAGE.name === '总览' ? h('span', { class: 'crumb-seg' }, '流水线') : h('a', { class: 'crumb-seg wf-home', href: pageUrl('总览', { p: F.name }), title: '回流水线首页：看各场走到哪一步', onclick: e => { e.preventDefault(); go('总览'); } }, '流水线'),
      PAGE.name === '设定' ? h('span', { class: 'crumb-seg' }, '全片设定') : PAGE.crumb ? h('span', { class: 'crumb-seg' }, PAGE.crumb) : null,
      s ? h('span', { class: 'crumb-seg' }, '第' + s.段 + '场' + (s.名.trim() ? ' ' + s.名.trim() : '')) : null),
    h('div', { class: 'top-right' },
      PAGE.name === '风格' ? null : h('a', { class: 'btn ghost sm wf-styles', href: pageUrl('风格', { p: F.name }), title: '风格库：每种风格现存的几条样片，都能在这里放', onclick: e => { e.preventDefault(); go('风格'); } }, icon('film'), '风格'),   // 11-14 加：风格.html
      PAGE.name === '网盘' ? null : h('a', { class: 'btn ghost sm wf-cloud', href: pageUrl('网盘', { p: F.name }), title: '这个项目在网盘上的那一份：传上去、拿下来、删网盘上的', onclick: e => { e.preventDefault(); go('网盘'); } }, icon('cloud'), '网盘'),
      chPicker(), h('div', { class: 'status', id: 'fl-status' })));
}
/* 一场的页面顶上：写段落 → 剧本 → 资产，现在在哪一步、各步什么样；右边换上一场、下一场 */
function stepsEls() {
  const s = sceneNow();
  if (!s) return [];
  const info = stepInfo(s), i0 = F.doc.场.indexOf(s), prev = F.doc.场[i0 - 1], next = F.doc.场[i0 + 1], out = [];
  STEPS.forEach(([page, no, label], i) => {
    const x = info[i], on = (PAGE.step || PAGE.name) === page;   // PAGE.step：一页里的小页（资产那一页点开的一样东西）算哪一步；PAGE.sub：在小页里，点这一步回到它的大页
    if (i) out.push(h('span', { class: 'wf-arrow' }, '→'));
    out.push(h('button', { class: 'wf-step ' + x.st + (on ? ' on' : ''), type: 'button', title: x.st === 'lock' ? x.tx + '才能做这一步' : null, onclick: () => { if (!on || PAGE.sub) go(page, { s: s.段 }); } },
      h('i', null, x.st === 'ok' ? icon('check') : no), i === 0 && revFront(s) ? '人物·提示词' : label, h('small', null, x.tx)));   // 先写提示词的场：第一步是选人物、写提示词
  });
  out.push(h('span', { class: 'sp' }));
  const sty = styleChip(s);
  if (sty) out.push(sty);
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
  if (SHELL && SHELL.leave && !await SHELL.leave()) return;   // 写稿页盖着：先存上再换
  const r = await dialog(close => dlgShell('换一个项目', '每个项目有自己的流水线。现在是「' + F.name + '」。',
    [h('div', { class: 'chips' }, F.projects.map(n => h('button', { class: 'chip' + (n === F.name ? ' on' : ''), type: 'button', onclick: () => close(n) }, n)))],
    [h('button', { class: 'btn ghost', type: 'button', onclick: () => close('+') }, '＋ 新建项目'), h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close(null) }, '不换')]));
  if (r === '+') return newProject();
  // 留在这一页，只换项目（11-14 他要的）；新项目没有这一场，start 里会回它的首页
  if (r && r !== F.name) { await flush(); location.href = pageUrl(PAGE.name, { p: r, s: PAGE.scene ? F.seg : '' }); }
}
/* 新建项目：在 项目 下面建一个以项目名命名的文件夹，带好五个标准文件夹（原来在老页面里建，老页面 2026-11-13 下掉后挪到这里） */
const STD_DIRS = ['定稿的剧本', '提示词', '资产', '成片', '历史记录'];
async function newProject() {
  const inp = h('input', { class: 'inp', placeholder: '项目名称', spellcheck: 'false', 'data-focus': '' }), err = h('div', { class: 'fld-err' });
  const name = await dialog(close => {
    const ok = () => {
      const v = inp.value.trim();
      if (!v || /[\\/:*?"<>|\u0000-\u001f]/.test(v) || /[. ]$/.test(v) || /^\.+$/.test(v)) { err.textContent = '名称不能空着，不能有 \\ / : * ? " < > |，结尾不能是点或空格'; return; }
      if ((F.projects || []).some(n => n.toLowerCase() === v.toLowerCase())) { err.textContent = '已经有这个项目了'; return; }
      close(v);
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !isComposing(e)) { e.preventDefault(); ok(); } });
    inp.addEventListener('input', () => { err.textContent = ''; });
    return dlgShell('新建项目', '在「项目」下面建一个以项目名命名的文件夹，里面带好 定稿的剧本、提示词、资产、成片、历史记录。',
      [field('项目名称', inp), err],
      [h('button', { class: 'btn ghost', type: 'button', onclick: () => close(null) }, '取消'), h('button', { class: 'btn ink', type: 'button', onclick: ok }, '建好')]);
  });
  if (!name) return;
  try { for (const d of STD_DIRS) await FS.mkdir(['项目', name, d]); }
  catch (e) { toast('没建成：' + e.message, 'err'); return; }
  if (F.name) await flush();
  location.href = pageUrl('总览', { p: name });
}
/* 每一页最后调一次：认项目、读流水线、画出来，然后隔两秒看一眼外面变了没有 */
async function start(page) {
  PAGE = page;
  document.title = '流水线 · ' + page.name;
  const root = document.getElementById('wf');
  if (!(await LINK.up())) { root.replaceChildren(noneBox('这几页要经本机服务打开：在 Claude 里说「打开项目管理」，开好以后点「再试一次」。', againBtn())); return; }
  F.projects = await projects();
  AI.ok = LINK.v >= 5;   // 本机服务第 5 版起有 AI 任务
  if (AI.ok) { try { await CH.load(); } catch (e) { AI.ok = false; } }
  const q = query(), has = n => !!n && F.projects.includes(n);
  const name = has(q.p) ? q.p : [localStorage.getItem('antou:last:' + LINK.root)].find(has) || F.projects[0];
  if (!name) { root.replaceChildren(noneBox('这里还没有项目。', h('button', { class: 'btn ink', type: 'button', onclick: newProject }, '新建项目'))); return; }
  F.seg = C.normSeg(q.s || '');
  if (!(await load(name))) { root.replaceChildren(noneBox('这个项目没读出来，过一会儿再试。', againBtn())); return; }
  store('antou:last:' + LINK.root, name);
  if (AI.ok) await loadJobs(true);
  if (page.scene && !F.bad && !sceneNow()) { location.replace(pageUrl('总览', { p: name })); return; }   // 没有这一场：回首页
  if (q.p !== name) history.replaceState(null, '', pageUrl(page.name, { p: name, s: page.scene ? F.seg : '' }) + location.hash);
  renderAll();
  if (!q.p || q.p === name) openFromHash();
  else history.replaceState(null, '', location.pathname + location.search);   // 网址里点名的项目不在：不盖上来
  setInterval(tick, 2000);
}
/* 网址带 #open=…（AI 点名要你看的一份；老的项目管理网址也转到这里）：把这一份盖上来看 */
function openFromHash() {
  const m = /^#open=(.+)$/.exec(location.hash);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);   // 收掉：刷新不再盖一次
  let parts;
  try { parts = decodeURIComponent(m[1]).split('/').filter(Boolean); } catch (e) { return; }
  if (parts[0] === '项目') parts.shift();
  if (parts[0] === F.name && parts.length > 1) parts.shift();   // 写成 项目名/… 的也认
  if (parts.length) openShell(at([F.name, ...parts]), parts[parts.length - 1]);
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
  const b = h('button', { type: 'button', class: 'fl-at ' + kindCls(x.类别) + (on ? ' on' : ''), title: x.文件 + (note ? '\n' + note : ''), onclick }, thumbImg(x.文件), h('span', null, x.名称), note ? h('small', null, note) : null, h('i', null, icon('check')));
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
  const L = sceneLines();
  if (L.length === 1 && !uniq(s.场景文字).length && !s.场景图.length && !out.some(x => x.key === '场景图')) out.push({ key: '场景文字', id: L[0], name: sceneLabel(L[0]), file: '', only: true });   // 全片的场景只写了一处、这一场还没选场景：多半就是它
  return out;
}
const pickCount = s => s.人物.length + s.道具.length + s.场景图.length + uniq(s.场景文字).length + s.人物图.length + s.道具图.length;
function missing(s) {
  const out = [];
  if (!s.人物.length && !s.人物图.length && F.doc.人物.length) out.push('没选出场的人物');
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

/* 这一场选上的一样：人物、道具是表里的一行，场景图是一张图，场景文字是全片场景里的一句（没有图） */
function refChip(key, id, onRemove) {
  if (key === '场景文字') {
    const gone = !sceneLines().includes(id);
    const el = h('span', { class: 'fl-ref k-jing' + (gone ? ' lost' : ''), title: (gone ? '全片设定的「场景」里已经没有这一句了：' : '场景（只用文字写的，没有图）：') + id },
      h('i', { class: 'ph' }, '场'), h('span', null, sceneLabel(id)), h('small', null, '场景 · 文字'));
    if (onRemove) el.append(h('button', { class: 'fl-ref-x', type: 'button', tabindex: '-1', title: '这一场不用它', onclick: onRemove }, icon('x')));
    return el;
  }
  const e = KIND[key] ? entryOf(key, id) : null, all = KIND[key] ? (e ? e.资产 : []) : [id], file = all.find(f => !F.gone.has(f)) || all[0] || '', name = KIND[key] ? id : baseOf(id);   // 道具引用了几张：小图摆头一张，后面写几张
  const lost = KIND[key] && !e, ok = !!file && !F.gone.has(file);
  const el = h('span', { class: 'fl-ref ' + kindCls(key) + (lost ? ' lost' : ''), title: lost ? '上面的「' + key + '」里没有这一行了' : KIND[key] ? key + '：' + oneLine(e.描写) + (all.length ? '\n图：' + all.join('、') : '\n还没有图') : kindOf(key) + '图：' + file },
    ok ? thumbImg(file) : h('i', { class: 'ph' }, kindOf(key)[0]), h('span', null, name), h('small', null, kindOf(key) + (all.length > 1 ? ' · ' + all.length + ' 张' : '')));
  if (ok) hoverable(el, file, name);
  if (onRemove) el.append(h('button', { class: 'fl-ref-x', type: 'button', tabindex: '-1', title: '这一场不用它', onclick: onRemove }, icon('x')));
  return el;
}
/* 这一场选上的，照 人物、场景、道具 的先后摆（这一段的图当人物、道具用的，跟在表里那几个后面）。onRemove(键, 哪一个)：每一个后面带 × */
const castRefs = (s, onRemove) => [...s.人物.map(n => ['人物', n]), ...s.人物图.map(f => ['人物图', f]), ...s.场景图.map(f => ['场景图', f]), ...uniq(s.场景文字).map(t => ['场景文字', t]), ...s.道具.map(n => ['道具', n]), ...s.道具图.map(f => ['道具图', f])]
  .map(([k, id]) => refChip(k, id, onRemove ? () => onRemove(k, id) : null));

/* ---------- 定下来以后，交给 AI 的事都从这里说（对话里的 AI 挂着等；没在等就先排着） ---------- */
async function sendAI(line, ok) {
  if (!LINK.on) { await copyText(line, '复制好了，贴给 Claude 或 Codex'); return; }
  try {
    const r = await (await LINK.req('POST', '/api/ai', line)).json();
    toast(r.online ? ok : '记下了。AI 这会儿没在等，去对话里说一声「看右边」');
  } catch (e) { toast('没交上：' + e.message, 'err'); }
}

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
  for (const seg of pick.场) { const s = d.场.find(x => x.段 === seg); if (s) { if (!s.头回定稿 && s.剧本定稿) s.头回定稿 = s.剧本定稿; if (s.剧本定稿) s.上回定稿 = s.剧本定稿; s.扩写 = now; s.剧本定稿 = ''; } }   // 以前定过稿的：头一回定稿的时间先记下，再定稿就算「重新定稿」
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
  const d = docsOf(s.段), asked = timeOf(s.扩写), job = jobOf('扩写剧本', s.段), rj = revJob(s);
  if (rj) return { d, st: 'wait', job: rj };   // 先写提示词的场：AI 正照提示词反推
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
/* ---------- 只用文字写的场景（11-14 他要：出场的人物、场景、道具，全片设定里写过就能选，不用先有图）。
   全片的「场景」是一段话，一行写一处地方：每一行就是一个能选的场景。各场选上的记在这一场的「场景文字」里（那一行的原文）。
   全片的场景改了（手改、采用 AI 写的），各场选上的跟着换：改的是哪几行，就换成新写的那几行；整行删掉就不选了（删了马上在原处重写，还认它） ---------- */
const sceneLinesIn = t => str(t).split(/\r?\n/).map(x => x.trim()).filter(Boolean);
const sceneLines = () => uniq(sceneLinesIn(F.doc.场景));
function sceneLabel(t) {   // 一行太长，摆出来只用前头：「面摊：傍晚……」取「面摊」，「一个出租屋内，一张床……」取「一个出租屋内」
  const c = t.search(/[：:]/), p = t.search(/[，,。；;]/);
  if (c >= 1 && c <= 12 && (p < 0 || c < p)) return t.slice(0, c);
  if (p >= 4 && p <= 14) return t.slice(0, p);
  return t.length > 14 ? t.slice(0, 13) + '…' : t;
}
const sceneRest = t => { const l = sceneLabel(t); return l.endsWith('…') ? '' : oneLine(t.slice(l.length).replace(/^[：:，,。；;\s]+/, '')); };
let SCENE_GONE = null;   // 刚整行删掉的那一处：{ at: 第几行, list: 选了它的那几场 }
function setScene(text) {
  const a = sceneLinesIn(F.doc.场景), b = sceneLinesIn(text);
  F.doc.场景 = text;
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0; while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  const was = a.slice(p, a.length - q), now = b.slice(p, b.length - q);
  const put = (s, list) => { const L = uniq(b), cur = uniq(list); s.场景文字 = [...L.filter(t => cur.includes(t)), ...cur.filter(t => !L.includes(t))]; };   // 照全片场景里的先后
  if (!was.length) {   // 只是加了几行：刚删掉的那一行又在原处写上了，还当它
    if (now.length && SCENE_GONE && SCENE_GONE.at === p) for (const s of SCENE_GONE.list) if (F.doc.场.includes(s)) put(s, [...uniq(s.场景文字), now[0]]);
    SCENE_GONE = null;
    return;
  }
  SCENE_GONE = now.length ? null : { at: p, list: [] };
  for (const s of F.doc.场) {
    const cur = uniq(s.场景文字);
    if (!cur.some(t => was.includes(t))) continue;
    if (!now.length) SCENE_GONE.list.push(s);
    put(s, cur.map(t => { const i = was.indexOf(t); return i < 0 ? t : now.length ? now[Math.min(i, now.length - 1)] : ''; }));
  }
}
/* 新加一处场景：一句话，记进全片的「场景」（加一行），这一场也选上 */
async function addSceneLine(s) {
  const t = await window.UI.inputDlg({ title: '新加一个场景', body: '一句话写这个地方：在哪、什么样（比如：出租屋：十来平米，没有窗户，一张床，一套旧桌椅）。记进全片设定的「场景」，加一行；这一场也选上。不用先有图。', label: '场景', ok: '加上',
    check: v => v ? '' : '写一句' });
  if (!t) return false;
  const line = t.replace(/\s*[\r\n]+\s*/g, ' ');
  if (!sceneLines().includes(line)) setScene((F.doc.场景.trim() ? F.doc.场景.trim() + '\n' : '') + line);   // 全片里已经有这一句：只选上
  s.场景文字 = uniq([...uniq(s.场景文字), line]);
  orderCast(s); touch();
  return true;
}
/* ---------- 选这一场出场的：人物、道具从全片的表里选，场景从全片写的场景、引用的场景图里选。分场页、资产页都用这一个小窗 ---------- */
function orderCast(s) {   // 选上的照表里的先后排
  for (const K of LISTS) s[K.key] = F.doc[K.key].map(e => e.名).filter(n => s[K.key].includes(n));
  s.场景图 = [...F.doc.场景图.filter(f => s.场景图.includes(f)), ...ownSegImgs(s)];   // 全片引用的排前面，这一段文件夹里的跟在后面
  const L = sceneLines(), cur = uniq(s.场景文字);
  s.场景文字 = [...L.filter(t => cur.includes(t)), ...cur.filter(t => !L.includes(t))];   // 照全片场景里的先后；全片里已经没有的那几句跟在后面（摆出来让你去掉）
}
/* 从这一段的文件夹里挑几张给这一场当 k（人物、场景、道具）用。只记在这一场，不进全片；图还在原处 */
async function pickSegImgs(s, k = '场景') {
  closePop(); hideHov();
  let items = [];
  try { items = await loadSegPool(F.name, s.段); } catch (e) { toast('没读出来：' + e.message, 'err'); return false; }
  if (!items.length) { toast('资产 / ' + segName(s.段) + ' 里还没有图。空镜、参考图放进去（可以再分一层文件夹，比如「空镜」），再来挑'); return false; }
  const field = SEG_FIELD[k], picked = new Set(segOf(s, k)), count = h('span'), box = h('div', { class: 'fl-apick' });
  const paint = () => {
    count.textContent = '用这 ' + items.filter(x => picked.has(x.文件)).length + ' 张';
    box.replaceChildren(...segGroups(items).flatMap(([g, list]) => [h('div', { class: 'pick-lab' }, g || segName(s.段) + ' 本层'),
      h('div', { class: 'fl-ag' }, list.map(x => { const on = picked.has(x.文件), other = !on && segKind(s, x.文件);
        return tileEl({ ...x, 类别: on ? field : '这一段' }, on, other ? '这一场当' + other + '用着，点了改当' + k : '', () => { on ? picked.delete(x.文件) : picked.add(x.文件); paint(); }); }))]));
  };
  paint();
  const ok = await dialog(close => {
    const el = dlgShell('这一段的图当' + k + ' · 第' + s.段 + '场', '资产 / ' + segName(s.段) + ' 里的图，连下一层文件夹。点一下选上，再点一下去掉。选上的只给这一场当' + k + '用，图还在原处。', [box],
      [h('button', { class: 'btn ghost', onclick: () => close(false) }, '取消'), h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close(true) }, count)]);
    el.classList.add('wide');
    return el;
  });
  if (!ok) return false;
  const shown = new Set(items.map(x => x.文件));
  const keep = s[field].filter(f => !shown.has(f) || picked.has(f));   // 原来挑的照原来的先后，新挑的照窗里的先后（空镜在前）跟在后面
  const add = segGroups(items).flatMap(([, l]) => l).filter(x => picked.has(x.文件) && !keep.includes(x.文件)).map(x => x.文件);
  s[field] = keep;
  for (const f of add) putSeg(s, k, f);   // 原来当别的用的，挪过来
  orderCast(s); touch();
  return true;
}
function openPickPop(anchor, s, after) {
  s.场景文字 = uniq(s.场景文字);
  popover(anchor, close => {
    const body = h('div', { class: 'fl-pl' }), mine = { 人物: [], 场景: [], 道具: [] };   // 这一场挑过的这一段的图：去掉了也留在这里，能再点回来
    const flip = (key, id) => {
      if (s[key].includes(id)) s[key] = s[key].filter(x => x !== id);
      else if (!KIND[key] && segImg(s, id) && !F.doc.场景图.includes(id)) putSeg(s, kindOf(key), id);   // 这一段的图：原来当别的用的挪过来
      else s[key].push(id);
      orderCast(s); touch(); paint(); after();
    };
    const item = (key, id, name, desc, file) => h('button', { type: 'button', class: 'fl-pi ' + kindCls(key) + (s[key].includes(id) ? ' on' : ''), onclick: () => flip(key, id) },
      file && !F.gone.has(file) ? thumbImg(file) : h('span', { class: 'ph' }, kindOf(key)[0]), h('span', { class: 'pn' }, h('b', null, name), desc ? h('small', null, desc) : null), h('i', null, icon('check')));
    const segPart = k => { for (const f of segOf(s, k)) if (!mine[k].includes(f)) mine[k].push(f); return mine[k].map(f => item(SEG_FIELD[k], f, baseOf(f), '这一段的', f)); };
    const segLink = k => h('button', { class: 'fl-link', type: 'button', title: '资产 / ' + segName(s.段) + ' 里的图，只给这一场当' + k + '用', onclick: async () => { close(); await pickSegImgs(s, k); after(); } }, '＋ 这一段文件夹里的');
    const listPart = K => [h('div', { class: 'fl-pop-g ' + kindCls(K.key) }, K.key, h('span', { class: 'fl-pop-acts' }, h('button', { class: 'fl-link', type: 'button', title: '写' + K.nameLab + '、描写，记进全片设定的「' + K.key + '」，这一场也选上。不用先有图', onclick: async () => { close(); const n = await entryDlg(K); if (n && !s[K.key].includes(n)) { s[K.key].push(n); touch(); } after(); } }, '＋ 新加一个'), segLink(K.key))),
      ...F.doc[K.key].map(e => item(K.key, e.名, e.名, oneLine(e.描写), e.资产.find(f => !F.gone.has(f)) || '')), ...segPart(K.key),
      F.doc[K.key].length || mine[K.key].length ? null : h('p', { class: 'fl-pop-e' }, '还没有' + K.key + '。点「＋ 新加一个」用文字写，不用先有图。')];
    /* 场景：全片场景里文字写的每一处（没有图也能选）、引用的场景图、这一段文件夹里的图 */
    const textItem = (t, gone) => item('场景文字', t, sceneLabel(t), gone ? '全片设定里已经没有这一句了，点一下去掉' : sceneRest(t) || '只用文字写的', '');
    const scenePart = () => {
      const own = segPart('场景'), L = sceneLines(), gone = uniq(s.场景文字).filter(t => !L.includes(t));
      return [h('div', { class: 'fl-pop-g k-jing' }, '场景', h('span', { class: 'fl-pop-acts' },
          h('button', { class: 'fl-link', type: 'button', title: '一句话写这个地方，记进全片设定的「场景」，这一场也选上。不用先有图', onclick: async () => { close(); await addSceneLine(s); after(); } }, '＋ 新加一个'), segLink('场景'))),
        ...L.map(t => textItem(t)), ...gone.map(t => textItem(t, true)),
        ...F.doc.场景图.map(f => item('场景图', f, baseOf(f), '', f)), ...own,
        L.length || gone.length || F.doc.场景图.length || own.length ? null : h('p', { class: 'fl-pop-e' }, '还没有场景。点「＋ 新加一个」用一句话写，不用先有图。')];
    };
    const paint = () => body.replaceChildren(...[...listPart(KIND.人物), ...scenePart(), ...listPart(KIND.道具)].filter(Boolean));   // 人物、场景、道具
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
  for (const k of ['人物', '道具']) for (const f of s[SEG_FIELD[k]]) { seen.add(f.toLowerCase()); out.push({ 类别: SEG_FIELD[k], 名称: baseOf(f), sub: '这一段的', at: F.gone.has(f) ? '' : f, 状态: F.gone.has(f) ? '图不在了' : '', 说明: '', 文件: f, own: true }); }   // 这一段的图当人物、道具用的：不挂表里哪一行
  for (const f of s.场景图) { seen.add(f.toLowerCase()); out.push({ 类别: '场景图', 名称: baseOf(f), sub: segImg(s, f) && !F.doc.场景图.includes(f) ? '这一段的' : '', at: F.gone.has(f) ? '' : f, 状态: F.gone.has(f) ? '图不在了' : '', 说明: '', 文件: f, own: true }); }
  for (const t of uniq(s.场景文字)) out.push({ 类别: '场景文字', 名称: sceneLabel(t), sub: '', at: '', 状态: '', 说明: t, 文字: t, own: true });   // 只用文字写的场景：不要图，不算缺图，也不用确认
  for (const f of framesOf(s)) { seen.add(f.toLowerCase()); const dir = f.split('/').slice(2, -1).join('/'); out.push({ 类别: '关键帧', 名称: baseOf(f), sub: dir, at: F.gone.has(f) ? '' : f, 状态: F.gone.has(f) ? '图不在了' : '', 说明: '', 文件: f, own: true }); }   // 关键帧：只这一场用
  const named = new Set(out.map(x => x.类别 + '/' + x.名称));
  const inTable = new Set([...LISTS.flatMap(K => F.doc[K.key].flatMap(e => e.资产)), ...F.doc.场景图].map(f => f.toLowerCase()));
  const textStems = new Set(uniq(s.场景文字).map(sceneStem).filter(Boolean));
  for (const x of ai) {   // AI 另外列的：表里没有的东西
    if (x.类别 === '关键帧' || (x.类别 === '场景' && textStems.has(x.名称))) continue;   // 写字记的关键帧、只用文字写的场景：格子里已经有了
    if ((x.at && seen.has(x.at.toLowerCase())) || named.has(aiKey(x) + '/' + x.名称)) continue;
    if (KIND[aiKey(x)] && entryOf(aiKey(x), x.名称)) continue;   // 表里有这一行：这一场用不用它，看「选出场的」
    if (x.at && inTable.has(x.at.toLowerCase())) continue;       // 这张图表里哪一行引用着：同上
    if (!x.at && x.文件 && (x.状态 === '有了' || x.状态 === '待过目')) continue;   // 出过图、后来删了或者那一行改了名：不算这一场缺的
    out.push({ ...x, own: false });
  }
  return { list: out, rec };
}
function assetChip(it, opener) {   // opener：点开这一格时另有做法（资产页：看大图时顶上带「这张确认可用」）
  if (it.文字) {   // 只用文字写的场景：没有图，也不缺
    const gone = !sceneLines().includes(it.文字);
    return h('div', { class: 'fl-asset txt ' + kindCls(it.类别) + (gone ? ' todo' : ''), title: (gone ? '全片设定的「场景」里已经没有这一句了：' : '场景，只用文字写的，不用图：') + it.文字 },
      h('span', { class: 'ph' }, '文字'), h('span', { class: 'nm' }, it.名称, h('small', null, h('b', { class: 'k-w' }, '场景'), gone ? ' · 全片里已经没有这一句' : ' · 文字写的，不用图')));
  }
  const has = !!it.at, img = has && IMG_RE.test(it.at);
  const open = opener || (() => img ? openImage(it.at) : showText(at([F.name, ...it.at.split('/')])));
  const rest = [it.sub, it.own ? '' : 'AI 列的', has ? (it.状态 && it.状态 !== '有了' ? it.状态 : '') : (it.状态 || '还没出')].filter(Boolean).join(' · ');
  const el = h('div', { class: 'fl-asset ' + kindCls(it.类别) + (has ? '' : ' todo'), role: has ? 'button' : null, tabindex: has ? '0' : null,
    title: has ? '点开看、写批注：' + it.at : (it.说明 || it.状态 || '还没有图'), onclick: has ? open : null },
    img ? thumbImg(it.at) : h('span', { class: 'ph' }, has ? '文件' : '待出'),
    h('span', { class: 'nm' }, it.名称, h('small', null, h('b', { class: 'k-w' }, kindOf(it.类别)), rest ? ' · ' + rest : '')));
  if (has) { el.addEventListener('keydown', e => { if (e.key === 'Enter') open(); }); if (img) hoverable(el, it.at, it.名称); }
  return el;
}

/* ---------- 文生资产（2026-11-14 他定的：字先定，图后出。讨论记录 通用工具/流水线/文生资产_讨论.md，流程图 文生资产_流程图.html）----------
   剧本定稿以后，每一样（人物、道具、场景；关键帧在提示词那一步）走同一条线：
   AI 写字（读定稿的剧本：写清要撑住什么戏；已经有图的核一遍撑不撑得住；没图的写出图提示词，场景先写 GEO 底稿）
   → 你批字（自己改，或写批注交给 AI 改）→ 点「照这个出图」（Codex 一次一张；已经有图的，新图先存成「图名_候选.png」，和旧图并排，你点「用新图」才换上）
   → AI 核图 → 你批图（点开图框出来写批注，交给 Codex 照批注改；或者回去改字）→ 确认可用。场景图确认以后，AI 照图再核一遍 GEO 底稿。
   字：提示词/全局资产/类别/图名_提示词.txt（关键帧：提示词/第N段/图名_提示词.txt）；GEO 底稿：同一处「图名_GEO底稿.md」；字的批注：「图名_提示词_批注.md」。
   AI 写的「要撑住」「核图」「核GEO」记在 资产/第N段_资产清单.json 里这张图的那一条（页面只读） ---------- */
const CAND_RE = /_候选\.(png|jpe?g|webp)$/i;
const BMF_RE = /_白模帧\.(png|jpe?g|webp)$/i;   // 出关键帧时从白模截的那一刻（过程文件，放在关键帧旁边）：不算关键帧
const inCatDir = (cat, f) => { const q = String(f).split('/'); return q.length === 4 && q[0] === '资产' && q[1] === '全局资产' && q[2] === cat && nameOk(q[3]); };
const fileTimeOf = f => (F.imgTime && F.imgTime.get(String(f).toLowerCase())) || (F.pool.find(p => p.文件 === f) || {}).mtime || F.words.get(f) || 0;
const nearTime = (a, b) => !!a && !!b && Math.abs(a - b) < 3000;
const checkBad = t => !!t && !(/没看出问题|撑得住/.test(t) && !/撑不住/.test(t));   // AI 核图说的是有问题
const WORD_TX = { 'ai-img': 'AI 在出图', 'ai-word': 'AI 在写字', cand: '新图等你看', ok: '可用', img: '图等你看', word: '字等你批', none: '还没写字' };
/* 一格资产（assetsOf 给的）走这一套用的几个文件、眼下走到哪了。不走这一套的（这一段文件夹里当人物、道具、场景用的图，全局资产别的文件夹里的图）回 null */
function wordOf(s, it) {
  let cat = '', stem = '', img = '';
  if (KIND[it.类别] && it.own) {
    cat = it.类别;
    if (it.文件) { if (!inCatDir(cat, it.文件)) return null; img = it.文件; stem = baseOf(img); }
    else stem = it.名称 + (it.sub ? '_' + it.sub : '');
  } else if (it.类别 === '场景图' && it.own) { if (!inCatDir('场景', it.文件)) return null; cat = '场景'; img = it.文件; stem = baseOf(img); }
  else if (it.类别 === '场景文字') { cat = '场景'; stem = sceneStem(it.文字); }
  else if (it.类别 === '关键帧') { const q = String(it.文件).split('/'); if (q.length !== 3 || q[0] !== '资产' || q[1] !== segName(s.段) || !nameOk(q[2])) return null; cat = '关键帧'; img = it.文件; stem = baseOf(img); }
  if (!cat || !nameOk(stem) || /_(候选|白模帧)$/.test(stem)) return null;
  return wordFor(s, cat, stem, img, it);
}
/* 不在资产格子里的（提示词那一步新加的关键帧）也用它：cat 关键帧、stem 图名 */
function wordFor(s, cat, stem, img, it) {
  const seg = s.段, frame = cat === '关键帧';
  const pdir = frame ? '提示词/' + segName(seg) : '提示词/全局资产/' + cat, adir = frame ? '资产/' + segName(seg) : '资产/全局资产/' + cat;
  img = img || adir + '/' + stem + '.png';
  const w = { s, seg, cat, stem, img, it: it || null, frame,
    name: it && KIND[it.类别] ? it.名称 : stem, state: it && KIND[it.类别] && it.sub ? it.sub : '', text: it && it.文字 || '',
    txt: pdir + '/' + stem + '_提示词.txt', note: pdir + '/' + stem + '_提示词_批注.md', geo: cat === '场景' ? pdir + '/' + stem + '_GEO底稿.md' : '',
    cand: adir + '/' + stem + '_候选.png', imgNote: adir + '/' + stem + '_批注.md', shots: adir + '/' + stem + SHOTS_TAIL };
  const has = p => F.words.has(p);
  Object.assign(w, { hasTxt: has(w.txt), hasNote: has(w.note), hasGeo: !!w.geo && has(w.geo), hasCand: has(w.cand), hasImgNote: has(w.imgNote) });
  w.hasImg = frame ? has(img) : !!(it && it.at && it.at === img) || F.pool.some(p => p.文件 === img);
  const rec = F.assets.get(seg), list = rec && !rec.bad ? rec.items : [];
  w.rec = list.find(x => x.文件 && x.文件.toLowerCase() === img.toLowerCase()) || null;
  const r = w.rec || {}, ct = r.核图时间 || 0;
  w.need = r.要撑住 || '';
  w.checkCand = r.核图 && w.hasCand && nearTime(ct, F.words.get(w.cand)) ? r.核图 : '';
  w.checkImg = r.核图 && w.hasImg && !w.checkCand && (!ct || nearTime(ct, fileTimeOf(img))) ? r.核图 : '';
  const gt = timeOf(r.核GEO时间), gok = !!gt && gt + 999 >= fileTimeOf(img);   // 照图核 GEO：核的是现在这张图才算
  w.geoNote = gok ? r.核GEO || '' : ''; w.geoBack = gok ? r.拿回去批图 || '' : '';
  const live = (k, pred) => AI.jobs.some(j => j.事 === k && jobLive(j) && pred(j)), key = cat + '/' + stem;
  w.drawing = live('出图', j => j.类别 === cat && j.文件名 === stem) || live('改图', j => j.类别 === cat && j.文件名 === stem);
  w.writing = live('写字', j => j.段 === seg && (Array.isArray(j.只) && j.只.length ? j.只.includes(key) : !frame && !w.hasTxt && !w.hasImg)) || live('按批注改字', j => j.名 === stem && (!frame || j.段 === seg));
  w.geoing = cat === '场景' && live('核GEO', j => j.名 === stem);
  w.ok = w.hasImg && (it && it.at === img ? okOf(it) : markOk(img, 0));
  w.step = w.drawing ? 'ai-img' : w.writing ? 'ai-word' : w.hasCand ? 'cand' : w.hasImg ? (w.ok ? 'ok' : 'img') : w.hasTxt ? 'word' : 'none';
  return w;
}
const wordTx = w => w.step === 'word' && w.hasNote ? '批注还没交给 AI' : w.step === 'img' && checkBad(w.checkImg) ? 'AI 核图说有问题' : WORD_TX[w.step];
/* 交给 AI 写字。ws：wordOf 给的几样，空着就是这一场全部（没字没图的写字，有图的核一遍撑不撑得住）。req：人写的要求 */
async function askWords(s, ws, req, self) {   // self：自己交给 AI（复制任务贴进自己开的对话）
  if (scriptState(s).st !== 'final') { toast('剧本定稿以后才能写字', 'err'); return null; }
  if (!AI.ok) { toast('本机服务是旧的，重开一次才能让 AI 写字', 'err'); return null; }
  const only = (ws || []).map(w => ({ 类别: w.cat, 名称: w.name, 状态名: w.state, 图: w.img, 文字: w.text, 要求: req || w.req || '', 参考: w.refs || [], ...(w.forPrompt ? { 提示词: w.forPrompt } : {}) }));
  return (self ? startSelf : startJob)({ 事: '写字', 段: s.段, ...(only.length ? { 参数: { 只: only } } : {}) });
}
/* 照字出图：Codex 一次一张；已经有图的，新图先存成候选 */
async function askDraw(s, w) {
  if (scriptState(s).st !== 'final') { toast('剧本定稿以后才能出图', 'err'); return null; }
  return startJob({ 事: '出图', 段: s.段, 类别: w.cat, 名: w.name, 状态名: w.state, 参数: { 图: w.img } });
}
/* 照图上写的批注改图：以这张为底只改说到的地方，改出来的先当候选 */
async function askEditImg(s, w) {
  if (!(await hasFile(F.name, w.imgNote.split('/')))) { toast('还没在图上写批注：点开这张图，框出来写好，再点「照批注改图」', 'err'); return null; }
  return startJob({ 事: '改图', 段: s.段, 类别: w.cat, 名: w.name, 状态名: w.state, 参数: { 图: w.img } });
}
/* 场景图确认可用了：AI 照图把 GEO 底稿再核一遍（没有底稿、正在核、核过这一张的不再开） */
async function askGeoCheck(s, w) {
  if (!w || w.cat !== '场景' || !w.hasGeo || !w.hasImg || w.geoing || (w.rec && timeOf(w.rec.核GEO时间) + 999 >= fileTimeOf(w.img))) return null;   // 核过这一张的不再核
  return startJob({ 事: '核GEO', 段: s.段, 参数: { 图: w.img } }, true);
}
/* 字的开头几行（图1：……、用途：……、要撑住：……）和正文（单独一行「提示词」下面）分开：开头几行只给看，正文给改 */
function splitWord(t) {
  const lines = String(t || '').replace(/\r\n/g, '\n').split('\n'), i = lines.findIndex(l => l.trim() === '提示词');
  return i < 0 ? { head: [], body: lines.join('\n').trim() } : { head: lines.slice(0, i).filter(l => l.trim()), body: lines.slice(i + 1).join('\n').trim() };
}
/* 开头「图1：完整路径（说明）」那几行 → 项目里的「资产/…」（关键帧照这几张的样子出：出图以前它们要确认可用）。白模截的那一刻不用确认 */
function headRefs(head) {
  const out = [];
  for (const l of head) {
    const m = /^图(\d+)：(.+?)（[^（）]*）\s*$/.exec(l), p = m ? m[2].trim().replace(/\\/g, '/') : '', i = p.indexOf('/' + F.name + '/资产/');
    if (i >= 0) out.push({ n: +m[1], file: p.slice(i + F.name.length + 2) });
  }
  return out;
}
const unconfirmedRefs = head => headRefs(head).filter(r => !BMF_RE.test(r.file) && !markOk(r.file, 0));
const purposeOf = w => w.frame ? '第' + w.seg + '场' + (w.forPrompt ? '「' + w.forPrompt + '」' : '') + '的关键帧' : w.cat + '「' + w.name + '」' + (w.state ? '（' + w.state + '）' : '') + '的定妆图，各场照它的样子';
const readText = async rel => { try { return unbom(C.decodeText((await FS.read(at([F.name, ...rel.split('/')]))).buf).text); } catch (e) { return e && e.message === '没有这个文件' ? '' : null; } };
const noteBody = t => { const m = /^##\s*整体\s*$/m.exec(t || ''); return (m ? t.slice(m.index + m[0].length) : t || '').trim(); };
/* 改一份文字以前：原来的移进 历史记录（同样的路径，名字加 __时间），再写新的（AGENTS.md：改版前先把原文件移进历史记录） */
async function putText(rel, text, stamp) {
  const parts = rel.split('/'), name = parts.pop(), dot = name.lastIndexOf('.');
  if (await hasFile(F.name, [...parts, name])) await FS.move(at([F.name, ...parts, name]), at([F.name, '历史记录', ...parts, name.slice(0, dot) + '__' + stamp + name.slice(dot)]));
  await FS.write(at([F.name, ...parts, name]), C.encodeText(text));
}
async function archiveFile(rel, stamp, tail) {   // 收进历史记录（照原来的文件夹放）。tail：名字后面另加的（候选图的批注截图这类文件夹也能收）
  const parts = rel.split('/'), name = parts.pop(), dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  await FS.move(at([F.name, ...parts, name]), at([F.name, '历史记录', ...parts, base + '__' + stamp + (tail || '') + ext]));
}
const pageRepaint = async () => { await loadSides(); if (!(PAGE.repaint && PAGE.repaint() !== false)) rerender(); };
/* 看字、批字、批准出图：点一样东西，进它自己的那一页（资产.html?a=图的路径，写在 资产详情.js）。
   11-14 他说原来的小窗太黑盒：AI 写了什么、照什么写的、做到哪了，都要在一页里看得见 */
function openWord(s, w) {
  const kf = w.frame && (PAGE.name === '提示词' || query().from === '提示词');   // 关键帧从提示词那一步点进来的：看完回提示词
  go('资产', { s: s.段, a: w.img, ...(kf ? { from: '提示词', v: w.forPrompt || '' } : {}) });
}
/* 「用新图」：旧图和它的批注、批注截图用同一个时间收进历史记录，新图（候选）换成原来的名字，算确认可用；参考素材映射里这张图的 SHA-256 跟着换。
   画布上的旧节点：出片任务书里会让 Codex 照 AGENTS.md 改名（加同一个 __时间）再传新的 */
async function takeCand(w) {
  const stamp = stampNow(), P = rel => at([F.name, ...rel.split('/')]);
  let moved = false;
  try { if (await hasFile(F.name, w.img.split('/'))) { await archiveFile(w.img, stamp); moved = true; } }
  catch (e) { toast('原来的图没收走：' + e.message, 'err'); return false; }
  try { await FS.move(P(w.cand), P(w.img)); }
  catch (e) {
    if (moved) { const q = w.img.split('/'), n = q.pop(), d = n.lastIndexOf('.'); try { await FS.move(at([F.name, '历史记录', ...q, n.slice(0, d) + '__' + stamp + n.slice(d)]), P(w.img)); } catch (e2) { /* 放不回去：历史记录里还在 */ } }
    toast('没换上：' + e.message, 'err'); return false;
  }
  const side = [[w.imgNote, ''], [w.shots, '']], cn = w.cand.replace(/\.[^.]+$/, '');
  side.push([cn + '_批注.md', ''], [cn + SHOTS_TAIL, '']);
  for (const [rel] of side) { try { const q = rel.split('/'); if (await hasFile(F.name, q) || await FS.isDir(P(rel))) await archiveFile(rel, stamp); } catch (e) { /* 挪不动就留着 */ } }
  try {   // 参考素材映射：挂着这张图的提示词，登记的 SHA-256 换成新图的（那几条提示词会标「待核对」）
    if (await hasFile(F.name, ['资产', '参考素材映射.json'])) {
      const mp = at([F.name, '资产', '参考素材映射.json']), j = await readJson(mp), buf = (await FS.read(P(w.img))).buf;
      const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
      let n = 0;
      for (const v of Object.values(j.prompts || {})) for (const x of (v && Array.isArray(v.references) ? v.references : [])) if (x && cleanFile(x.path) === w.img && x.sha256 !== hex) { x.sha256 = hex; n++; }
      if (n) await FS.write(mp, C.encodeText(JSON.stringify(j, null, 2) + '\n'));
    }
  } catch (e) { toast('参考素材映射没跟着改：' + e.message, 'err'); }
  F.doc.可用[w.img] = nowText(); touch();
  window.UI.dropThumbs();
  await flush();
  toast(moved ? '用新图了。旧图收在 历史记录 / ' + w.img.split('/').slice(0, -1).join(' / ') + '，名字后面加了 __' + stamp : '用新图了');
  return true;
}
/* 「用旧图」（没有旧图时叫「不要新图」）：新图（候选）收进历史记录，旧图不动 */
async function dropCand(w) {
  const stamp = stampNow(), cn = w.cand.replace(/\.[^.]+$/, '');
  try { await archiveFile(w.cand, stamp); } catch (e) { toast('没收走：' + e.message, 'err'); return false; }
  for (const rel of [cn + '_批注.md', cn + SHOTS_TAIL]) { try { if (await hasFile(F.name, rel.split('/')) || await FS.isDir(at([F.name, ...rel.split('/')]))) await archiveFile(rel, stamp); } catch (e) { /* 挪不动就留着 */ } }
  toast(w.hasImg ? '用旧图。新图收进历史记录了' : '新图收进历史记录了');
  return true;
}

/* 资产格子、提示词那一步的关键帧都用的几样：确认、看大图时顶上那一条、候选图、格子右边眼下该做的那一件 */
const pageNow = () => { if (!(PAGE.repaint && PAGE.repaint() !== false)) rerender(); };
/* 确认一张图可用（on：确认；不然取消）。场景图确认了：AI 照图把 GEO 底稿再核一遍 */
function confirmImg(s, it, on) {
  setMark(it.at, on, sinceOf(it));
  if (on) { const w = wordOf(s, it); if (w) askGeoCheck(s, w); }
}
function confirmW(s, w, on) {   // 不在资产格子里的（提示词那一步的关键帧）
  if (w.it && w.it.at === w.img) return confirmImg(s, w.it, on);
  setMark(w.img, on, 0);
  if (on) askGeoCheck(s, w);
}
const imgOk = (it, w) => it && it.at ? okOf(it) : !!w && w.ok;
const clipNote = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;
const noteEl = (lab, t) => h('span', { class: 'fn-note as-note' + (checkBad(t) ? ' warn' : ''), title: lab + '：' + t }, lab + '：' + clipNote(t, 48));
/* 点开看大图时，顶上那一条：AI 核图说了什么、看字、照批注改图、这张确认可用。it：资产格子（提示词那一步的关键帧没有，空着） */
const shellActs = (s, it, w) => close => {
  const ok = imgOk(it, w), file = it && it.at || (w && w.img), label = it ? it.名称 + (it.sub ? '（' + it.sub + '）' : '') : w ? w.stem : '';
  return [
    w && w.checkImg ? noteEl('AI 核图', w.checkImg) : null,
    w && w.geoBack ? h('span', { class: 'fn-note as-note warn', title: w.geoBack }, 'GEO 对不上：要拿回去批图') : null,
    w && !PAGE.sub ? h('button', { class: 'btn sm ghost', type: 'button', title: '进这一样的那一页：看字（出图提示词' + (w.cat === '场景' ? '、GEO 底稿' : '') + '）、AI 做过什么。改了字点「批准出图」，新图先当候选', onclick: () => { close(); openWord(s, w); } }, '看字') : null,
    w ? h('button', { class: 'btn sm', type: 'button', disabled: w.drawing, title: '先在图上框出来、写好批注，再点这里：Codex 以这张为底只改你说到的地方，改出来的先当候选', onclick: async () => { if (await askEditImg(s, w)) close(); } }, '照批注改图') : null,
    ok ? h('span', { class: 'fs-state ok', title: '确认的时间：' + F.doc.可用[file] }, icon('check'), '确认过可用')
      : h('button', { class: 'btn sm', type: 'button', title: '这张图看过了、能用。确认过的图，别的场不用再确认', onclick: () => { it && it.at ? confirmImg(s, it, true) : confirmW(s, w, true); toast('「' + label + '」确认可用'); close(); } }, icon('check'), '这张确认可用')];
};
/* 出了新图（候选）：旧图、新图挑一张用（11-15 他说「用这张」分不清是哪张）。点开哪一张看大图，顶上都是「用旧图」「用新图」，前面写明看的是哪张。
   which：'old' 看的是旧图，不写是新图。没有旧图时是「不要新图」「用新图」 */
const usersOf = file => F.doc.场.filter(x => x.定稿 && assetsOf(x).list.some(it => it.at === file)).map(x => x.段);   // 哪几场用着这张图
const candActs = (s, it, w, which) => close => {
  const segs = w.frame ? [] : usersOf(w.img), old = w.hasImg;
  return [
    h('span', { class: 'fn-note' }, which === 'old' ? '这是旧图（现在用着）' : old ? '这是新图（刚出的）' : '这是新图'),
    which !== 'old' && w.checkCand ? noteEl('AI 核图', w.checkCand) : null,
    segs.length > 1 ? h('span', { class: 'fn-note warn', title: '共用的图换了，用到它的提示词、样片都标「待核对」' }, segs.map(segName).join('、') + '都在用旧图：用新图，几场一起换') : null,
    h('button', { class: 'btn sm', type: 'button', title: old ? '用旧图：新图收进历史记录' : '不要新图：收进历史记录', onclick: async () => { close(); if (await dropCand(w)) await pageRepaint(); } }, old ? '用旧图' : '不要新图'),
    h('button', { class: 'btn sm ink', type: 'button', title: '用新图：' + (old ? '旧图连它的批注收进历史记录，' : '') + '新图算确认可用', onclick: async () => {
      close();
      if (!(await takeCand(w))) return;
      await pageRepaint();
      const w2 = it ? wordOf(s, it) : wordFor(s, w.cat, w.stem, w.img, null);
      if (w2) askGeoCheck(s, w2);
    } }, '用新图')];
};
/* 只用文字写的场景出了图：这一场改用这张图（全片设定里那一句还在） */
function useSceneImg(s, t, file) {
  if (!F.doc.场景图.includes(file)) F.doc.场景图.push(file);
  if (!s.场景图.includes(file)) s.场景图.push(file);
  s.场景文字 = uniq(s.场景文字).filter(x => x !== t);
  orderCast(s); touch();
}
/* 一格右边：这一样眼下该做的（写字、批字、看新图；AI 在做就转圈）。有图的「确认可用」另外摆 */
function wordPills(s, it, w) {
  const stop = ev => ev.stopPropagation();
  const b = (label, title, fn) => h('button', { class: 'fl-asset-ok go', type: 'button', title, onkeydown: stop, onclick: ev => { stop(ev); fn(); } }, label);
  if (w.step === 'ai-img' || w.step === 'ai-word') return [h('span', { class: 'fl-asset-ok busy', title: '做完这里自动换' }, h('i', { class: 'wt-ring' }), WORD_TX[w.step])];
  if (it && it.文字 && w.hasImg) return [b('用上这张图', '图出好了：这一场改用这张图（全片设定里那一句还在）', () => { useSceneImg(s, it.文字, w.img); pageNow(); })];
  if (w.step === 'cand') return [b('看新图', w.hasImg ? '出了一张新图：点开和旧图并排比，挑「用旧图」或「用新图」' : '出了一张新图：点开看，用不用', () => openWord(s, w))];
  if (w.step === 'word') return [b(w.hasNote ? '批注没交' : '批字', '进这一样的那一页看字：自己改，或者写批注交给 AI 改；字定了点「批准出图」', () => openWord(s, w))];
  if (w.step === 'none') return [b('写字', '交给 AI 写这一样的字（出图提示词' + (w.cat === '场景' ? '，先写 GEO 底稿' : '') + '）：读定稿的剧本，写清要撑住什么戏。写好你批，点「照这个出图」才出图', async () => { if (await askWords(s, [w])) pageNow(); })];
  return [];
}
/* 格子底下那一行小字：这一样走到哪了 */
function chipTx(it, w) {
  const has = it ? !!it.at : w.hasImg;
  const parts = has ? [w.step === 'cand' || w.step === 'ai-img' || w.step === 'ai-word' ? WORD_TX[w.step] : checkBad(w.checkImg) ? 'AI 核图说有问题' : '']
    : [it && (it.状态 === '图不在了' || it.状态 === '表里没有这一行') ? it.状态 : '', wordTx(w)];
  if (w.geoing) parts.push('AI 在照图核 GEO');
  else if (w.geoBack) parts.push('GEO 对不上');
  if (w.frameStale) parts.push(w.staleTx || '提示词改过，看一眼');   // 提示词那一步的关键帧：这一条改过、参考图换过
  return parts.filter(Boolean).join(' · ');
}

/* ---------- 拍摄风格（2026-11-14 他要：剧本定稿以后照剧本挑，一部片子一个，个别场可以另选）。
   全片的记在流水线.json 的「风格」：{ 名, 定：什么时候定的, 换：从别的风格换过来的时间（头一回定不算换） }；
   一场另选的，名字记在那一场的「风格」，换过的时间记在「风格换」。名字是风格库（通用工具/AI短片风格库）里的一种，或者「本项目自己的」（照 提示词/全局资产/全片_光影总基调.txt）。
   出资产图、写提示词、铺底、批注都照它写；中途换了，已经出的图、写好的提示词、样片标「待核对」。没定也不拦着，只提醒 ---------- */
const OWN_STYLE = '本项目自己的';
const filmStyle = () => { const v = F.doc && F.doc.rest.风格; return isPlainObj(v) && str(v.名).trim() ? v : null; };
const styleName = s => (s && str(s.风格).trim()) || str((filmStyle() || {}).名).trim();
/* 这一场的风格什么时候换过：跟着全片的看全片换的时间，另选了的看这一场换的时间 */
const styleChangedAt = s => Math.max(s && str(s.风格).trim() ? 0 : timeOf((filmStyle() || {}).换), timeOf(s && s.风格换));
function setFilmStyle(name) {
  const old = filmStyle(), now = nowText();
  if (old && old.名 === name) return;
  F.doc.rest.风格 = { 名: name, 定: now, ...(old ? { 换: now } : {}) };
  touch();
}
function setSceneStyle(s, name) {   // name 空着：这一场跟着全片
  const was = styleName(s);
  if (name) s.风格 = name; else delete s.风格;
  if (was && styleName(s) !== was) s.风格换 = nowText();
  touch();
}
/* 风格库：页面要用时才读（库里的字、哪几种有样片、这个项目的光影总基调），一分钟内不重读 */
const STYLE = { lib: null, at: 0, vids: new Set(), own: '', js: null };
function styleJs() {
  if (window.StyleLib) return Promise.resolve(window.StyleLib);
  return STYLE.js || (STYLE.js = new Promise((ok, no) => {
    const sc = document.createElement('script');
    sc.src = '../公用/风格库.js';
    sc.onload = () => window.StyleLib ? ok(window.StyleLib) : no(new Error('公用/风格库.js 没读出来'));
    sc.onerror = () => { STYLE.js = null; no(new Error('读不了 公用/风格库.js')); };
    document.head.append(sc);
  }));
}
async function loadStyles(force) {
  if (!force && STYLE.lib && Date.now() - STYLE.at < 60e3) return STYLE;
  const SL = await styleJs(), r = await FS.read([...SL.DIR, SL.FILE]);
  STYLE.lib = SL.parse(C.decodeText(r.buf).text);
  try { STYLE.vids = new Set((await FS.list(SL.DIR)).filter(e => e.kind === 'file' && VID_RE.test(e.name)).map(e => e.name)); } catch (e) { STYLE.vids = new Set(); }
  try { STYLE.own = unbom(C.decodeText((await FS.read(at([F.name, '提示词', '全局资产', '全片_光影总基调.txt']))).buf).text).trim(); } catch (e) { STYLE.own = ''; }
  STYLE.at = Date.now();
  return STYLE;
}
/* 看样片：风格库里同一场戏（深夜小面馆）用这种风格出的 10 秒样片，点了才读进来，在 media 里放 */
function sampleBtn(vid, media, urls) {
  const b = h('button', { class: 'fl-link', type: 'button', title: '同一场戏（深夜小面馆）用这种风格出的 10 秒样片', onclick: async () => {
    b.disabled = true; b.textContent = '在读样片…';
    try {
      const r = await FS.read([...window.StyleLib.DIR, vid]), u = URL.createObjectURL(new Blob([r.buf], { type: 'video/mp4' }));
      if (urls) urls.push(u);
      media.replaceChildren(h('video', { src: u, controls: '', autoplay: '', playsinline: '' })); b.remove();
    } catch (e) { b.disabled = false; b.textContent = '看样片'; toast('样片读不了：' + e.message, 'err'); }
  } }, '看样片');
  return b;
}
/* 一场的页面顶上、步骤条右边：这一场照什么风格拍。剧本还没定稿、也还没定风格的，先不催 */
function styleChip(s) {
  const n = styleName(s), mine = !!str(s.风格).trim();
  if (!n && scriptState(s).st !== 'final') return null;
  return h('button', { class: 'wf-style' + (n ? '' : ' todo'), type: 'button', onclick: () => styleDlg(s),
    title: n ? (mine ? '这一场另选的拍摄风格' : '全片的拍摄风格') + '：出资产图、写提示词都照它。点一下看、换' : '这部片子还没定拍摄风格：出资产图、写提示词以前定下来（不定也能接着做）' }, '风格', h('b', null, n ? n + (mine ? '（这一场）' : '') : '还没定'));
}
/* 有没有已经做出来的东西（换风格时要提醒它们会标「待核对」） */
const styleWork = list => list.some(x => promptsOf(x.段).length || assetCheckTime(x) || clipsOf(x.段).vids.length);
/* AI 推荐的风格（推荐风格这件事写在 定稿的剧本/流水线_AI扩写.json 的「风格」） */
const styleRec = seg => { const r = F.ai.data && F.ai.data.风格; return r && r.推荐 && (r.段 || '') === (seg || '') ? r : null; };
/* 挑风格的弹窗。s：从一场点进来的（全片已经定了风格时，挑的是这一场另选的）；film：不管从哪进来，都挑全片的；first：剧本头一回定稿时弹的 */
async function styleDlg(s, opt) {
  opt = opt || {};
  let st;
  try { st = await loadStyles(true); } catch (e) { toast('风格库读不了：' + e.message, 'err'); return; }
  const film = filmStyle(), one = !!s && !!film && !opt.film, seg = one ? s.段 : '';
  const now = one ? str(s.风格).trim() || film.名 : film ? film.名 : '';
  const urls = [], aiBox = h('div'), grid = h('div', { class: 'sty-grid' });
  const cards = [...st.lib.list.filter(c => c.已定), ...st.lib.list.filter(c => !c.已定)];
  if (st.own) cards.push({ 名: OWN_STYLE, 一句话: '照这个项目自己定的「全片光影总基调」（提示词/全局资产/全片_光影总基调.txt）。', own: st.own, 已定: true });
  let picked = null, sig = '', recSig = null;
  const pick = name => { picked = name; done(true); };
  const card = c => {
    const rec = styleRec(seg), on = c.名 === now, media = h('div', { class: 'sty-media' }), more = h('div', { class: 'sty-more', hidden: '' });
    const lines = c.own ? [c.own] : [c.一眼认出 ? '一眼认出：' + c.一眼认出 : '', c.比例 ? '比例：' + c.比例 : '', c.原片参考 ? '原片参考：' + c.原片参考 : ''].filter(Boolean);
    more.append(...lines.map(t => h('p', null, t)));
    const play = c.样片 && st.vids.has(c.样片) ? sampleBtn(c.样片, media, urls) : null;
    const moreBtn = h('button', { class: 'fl-link', type: 'button', onclick: () => { more.hidden = !more.hidden; moreBtn.textContent = more.hidden ? (c.own ? '看全文' : '看招牌') : '收起'; } }, c.own ? '看全文' : '看招牌');
    return h('div', { class: 'sty-card' + (on ? ' on' : '') + (rec && rec.推荐 === c.名 ? ' rec' : '') },
      h('h4', null, c.名, on ? h('span', { class: 'sty-tag on' }, '现在用的') : null, rec && rec.推荐 === c.名 ? h('span', { class: 'sty-tag rec' }, 'AI 推荐') : null, !c.已定 ? h('span', { class: 'sty-tag', title: '风格库里的备选：还没出样片，没验过' }, '还没出样片') : null),
      h('p', null, c.own ? oneLine(c.own).slice(0, 80) + (oneLine(c.own).length > 80 ? '…' : '') : c.一句话 || ''), media, more,
      h('div', { class: 'sty-acts' }, play, moreBtn, h('span', { class: 'sp' }), on ? null : h('button', { class: 'btn sm ink', type: 'button', onclick: () => pick(c.名) }, '用这个')));
  };
  const paint = () => {
    const j = jobOf('推荐风格', null, x => (x.段 || '') === seg), rec = styleRec(seg);
    const r2 = rec ? rec.时间 + rec.推荐 : '', s2 = (j ? j.id + j.状态 : '') + '|' + r2;
    if (s2 === sig) return;
    sig = s2;
    if (r2 !== recSig) { recSig = r2; grid.replaceChildren(...cards.map(card)); }   // 只在 AI 的推荐变了时重摆卡片：正在放的样片不打断
    aiBox.replaceChildren(...[rec ? h('div', { class: 'fl-aibox' }, h('div', { class: 'fl-aibox-h' }, 'AI 看了剧本，推荐「' + rec.推荐 + '」'), h('p', null, rec.理由 + (rec.备选 ? '\n也可以考虑：' + rec.备选 : ''))) : null,
      h('div', { class: 'sty-ai' }, jobLive(j) ? jobLine(j) : AI.ok ? h('button', { class: 'btn sm', type: 'button', title: '交给顶栏选的那个 AI：读梗概和剧本，从下面几种里挑一种合适的，说说为什么。挑哪个还是你定', onclick: async () => { await startJob({ 事: '推荐风格', 段: seg }); sig = ''; paint(); } }, rec ? '让 AI 重新看一遍' : '让 AI 看剧本推荐') : null,
        jobLive(j) ? null : jobFailed('推荐风格', null, x => (x.段 || '') === seg))].filter(Boolean));
  };
  let done = () => {};
  const timer = setInterval(paint, 1000);
  paint();
  const subOf = () => one ? '全片是「' + film.名 + '」。这一场要另选就点下面一种；' + (str(s.风格).trim() ? '跟回全片点左下角「跟全片」。' : '不另选就关上。')
    : (opt.first ? '剧本定稿了，接着定这部片子的拍摄风格（以后能换）。' : '') + '一部片子一个风格，个别场可以另选。出资产图、写提示词、铺底都照它写；审片时对着「一眼认出」看像不像。' + (film ? '中途换了，已经出的图、写好的提示词和样片会标「待核对」。' : '');
  await dialog(close => {
    done = close;
    const el = dlgShell(one ? '第' + s.段 + '场的拍摄风格' : '定这部片子的拍摄风格', subOf(), [aiBox, grid],
      [one && str(s.风格).trim() ? h('button', { class: 'btn ghost', type: 'button', onclick: () => pick('') }, '跟全片（' + film.名 + '）') : null,
        one ? h('button', { class: 'btn ghost', type: 'button', title: '换的是全片的风格：没另选的场都跟着换', onclick: () => { picked = null; close('film'); } }, '换全片的') : null,
        h('span', { class: 'sp' }), h('button', { class: 'btn ' + (film ? 'ink' : 'ghost'), type: 'button', onclick: () => close(null) }, film ? '关上' : '以后再定')].filter(Boolean));   // 不抢焦点：弹窗高，抢了会滚到底，看不见上面的说明
    el.classList.add('wide', 'sty-dlg');
    return el;
  }).then(r => { if (r === 'film') picked = 'film'; });
  clearInterval(timer);
  for (const u of urls) URL.revokeObjectURL(u);
  if (picked === 'film') return styleDlg(s, { film: true });
  if (picked == null) return;
  if (one) {
    setSceneStyle(s, picked);
    toast(picked ? '第' + s.段 + '场另用「' + picked + '」' : '第' + s.段 + '场跟着全片用「' + film.名 + '」');
  } else {
    const follow = F.doc.场.filter(x => !str(x.风格).trim());
    if (film && styleWork(follow) && !(await confirmDlg({ title: '换成「' + picked + '」？', body: '没另选风格的场，已经出的资产图、写好的提示词和样片都会标「待核对」，要你看一遍还合不合适。', ok: '换' }))) return;
    setFilmStyle(picked);
    toast('这部片子的拍摄风格定成「' + picked + '」了' + (film ? '' : '。出资产图、写提示词都照它写'));
  }
  await flush();
  rerender();
}

/* ---------- 先写提示词（2026-11-14 他要的倒着走；流程图 先写提示词_流程图.html 他批过：每一场自己选，剧本定稿就铺底） ----------
   添加分场时选「先写提示词」，这一场记「先写提示词」: true。分场页先只摆人物（点名字选上，没有的就地加）和「开始写提示词」，别的收起来。
   人写提示词里人写的两块（【生成目标】【事件脚本】，分镜模式、自由模式都行），写好点「让 AI 反推剧本」：
     AI 照这一场的几条提示词写剧本（定稿的剧本/第N段/第N段_剧本.docx，和扩写的一样，原来的进历史记录），
     段落、要表达的、出场的人物场景道具、表里还没有的另列一份（定稿的剧本/第N段/第N段_反推.json，页面只读）。
   在剧本页看剧本，点「采用」：段落、表达、出场的写进这一场，勾上的新人物、道具、场景加进全片设定。采用以后和正着走一样（批注、自己改、定稿）。
   剧本定稿时：这一场的每一条提示词交给 AI「直接铺底」，素材、基础设定、主体与关系、保持一致写进正文，人写的两块不动。
   图后来才确认的，那一条标「待核对」，在提示词那一步点「重铺」再铺一次 ---------- */
const REV_TAIL = '_反推.json';
const isRev = s => !!s && s.先写提示词 === true;
const revFront = s => isRev(s) && !s.定稿 && !s.反推采用;   // 还在前半段：没采用过反推（采用过、后来点了「再改」的，照正着走改段落）
function normRev(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const rows = a => (Array.isArray(a) ? a : []).filter(x => x && str(x.名).trim()).map(x => ({ 名: str(x.名).trim(), 描写: str(x.描写).trim() }));
  return { 时间: str(j.时间), 剧本时间: str(j.剧本时间), 段名: str(j.段名).trim(), 表达: str(j.表达).trim(),
    段落: (Array.isArray(j.段落) ? j.段落 : []).filter(x => x && str(x.写什么).trim()).map(x => ({ 写什么: oneLine(x.写什么), 作用: str(x.作用).trim() })),
    人物: uniq(j.人物), 新人物: rows(j.新人物), 道具: uniq(j.道具), 新道具: rows(j.新道具), 场景文字: uniq(j.场景文字), 新场景: uniq(j.新场景), 场景图: uniq(j.场景图).map(cleanFile),
    补的: uniq(j.补的), 提示词: (Array.isArray(j.提示词) ? j.提示词 : []).filter(x => x && str(x.文件)).map(x => ({ 文件: str(x.文件), 改: +x.改 || 0 })) };
}
const revOf = s => F.rev.get(s.段) || null;
/* 反推好了、还没采用的那一份 */
function revPending(s) {
  const v = revOf(s);
  return v && v.时间 && v.段落.length && (!s.反推采用 || timeOf(v.时间) > timeOf(s.反推采用) + 999) ? v : null;
}
const revJob = s => { const j = jobOf('反推剧本', s.段); return jobLive(j) ? j : null; };
/* 反推以后又改过、新写的提示词（剧本头一回定稿以前才看：定稿以后 AI 铺底也改提示词，看文件时间就不准了） */
function revStale(s) {
  const v = revOf(s), rec = F.names.get(s.段);
  if (!v || s.头回定稿 || !rec || !rec.time) return [];
  return promptsOf(s.段).filter(e => { const x = v.提示词.find(p => p.文件 === e.name); return !x || (rec.time.get(e.name) || 0) > (x.改 || timeOf(v.时间)) + 999; });
}
/* 让 AI 照提示词反推剧本（再反推也是它）。定过稿的：反推完再定稿就算「重新定稿」，照旧列影响清单 */
async function revStart(s) {
  if (!AI.ok) { toast('本机服务是旧版，没有 AI 任务：在 Claude 里说「打开项目管理」，重开以后再点', 'err'); return; }
  if (!promptsOf(s.段).length) { toast('先写一条提示词，再让 AI 反推', 'err'); return; }
  await flush();
  if (F.err) return;
  if (s.剧本定稿) { if (!s.头回定稿) s.头回定稿 = s.剧本定稿; s.上回定稿 = s.剧本定稿; s.剧本定稿 = ''; touch(); await flush(); if (F.err) return; }
  await startJob({ 事: '反推剧本', 段: s.段 });
  rerender();
}
/* 采用：段落、表达照反推的换上；出场的并进这一场；skip 里勾掉的新人物、新道具、新场景不加。段落定下来的时间记成 AI 写剧本以前的那一刻（剧本才不算旧） */
function revAdopt(s, v, skip) {
  const d = F.doc, on = (k, n) => !(skip && skip[k] && skip[k].has(n));
  s.段落 = v.段落.map(x => ({ 写什么: x.写什么, 作用: x.作用 }));
  if (v.表达) s.表达 = v.表达;
  if (v.段名 && !s.名.trim()) s.名 = v.段名;
  for (const K of LISTS) {   // 人物、道具：表里有的选上；表里没有的加进表（勾掉的不加）
    for (const n of v[K.key]) if (entryOf(K.key, n) && !s[K.key].includes(n)) s[K.key].push(n);
    for (const x of v['新' + K.key]) {
      if (!on('新' + K.key, x.名)) continue;
      if (!entryOf(K.key, x.名)) d[K.key].push({ 名: x.名, 描写: x.描写, 资产: [] });
      if (!s[K.key].includes(x.名)) s[K.key].push(x.名);
    }
  }
  const mine = uniq(s.场景文字);   // 场景：全片场景里有的那一行选上；新的一句加进全片的场景
  for (const t of v.场景文字) if (sceneLines().includes(t) && !mine.includes(t)) mine.push(t);
  for (const t of v.新场景) {
    if (!on('新场景', t)) continue;
    if (!sceneLines().includes(t)) d.场景 = (d.场景.trim() ? d.场景.trim() + '\n' : '') + t;
    if (!mine.includes(t)) mine.push(t);
  }
  s.场景文字 = mine;
  for (const f of v.场景图) if (d.场景图.includes(f) && !s.场景图.includes(f)) s.场景图.push(f);
  orderCast(s);
  s.定稿 = v.剧本时间 || v.时间;
  s.反推采用 = v.时间;
  touch();
}
/* 先写提示词的场新开一条：只摆你写的两块（【生成目标】【事件脚本】），记好用分镜模式还是自由模式，直接打开写稿页 */
const REV_SIDE_NOTE = '写稿页的过程文件，不是提示词。这一场先写提示词：人只写【生成目标】和【事件脚本】（分镜模式一镜一行，自由模式一大段），AI 照它们反推剧本；剧本定稿以后 AI 再把素材、基础设定、主体与关系、保持一致铺进正文。写法、写法范围、分镜稿、自由稿、镜头信息由页面保存；挂图由页面记录。';
async function revDraft(s, mode) {
  await flush();
  if (F.err) return;
  const busy = AI.jobs.filter(j => j.事 === '写提示词' && j.段 === s.段 && jobLive(j)).map(j => j.名);
  const name = vpNext([...promptsOf(s.段).map(e => e.name), ...busy]), dir = [F.name, '提示词', segName(s.段)], text = ['【生成目标】', '', '【事件脚本】', ''].join('\r\n');
  const put = async (n, body) => {   // 新建用独占写入：那里已经有了就不写
    const r = await fetch(LINK.url(at([...dir, n])), { method: 'PUT', headers: { 'X-Antou': '1', 'If-None-Match': '*' }, body: C.encodeText(body), cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 412 ? '「' + n + '」已经有了' : (await r.text()) || '没建成');
  };
  try {
    await put(name, text);
    await put(name.replace(/\.txt$/i, '') + '_写稿.json', JSON.stringify({ 说明: REV_SIDE_NOTE,
      流水线: '这一份是从「流水线」开的稿。这一场（' + segName(s.段) + '）先写提示词：全片的梗概、人物、场景、道具，和这一场出场的人物，都写在 定稿的剧本/流水线.json 里；AI 照这一场写好的几条提示词反推剧本（定稿的剧本/' + segName(s.段) + '），人采用以后段落、出场的才写进流水线。这一份是' + vpLabel(name) + '。',
      写法: mode === '自由' ? '自由' : '分镜', 写法范围: '分镜', 分镜稿: text, 自由稿: '', 镜头信息: [], 关键词: {} }, null, 2) + '\n');
  } catch (e) { toast('没建成：' + e.message, 'err'); await loadSides(); rerender(); return; }
  await loadSides();
  openWrite(s.段, name);
}
/* 剧本定稿以后：这一场的每一条提示词交给 AI 直接铺底（AI 写的几块写进正文，人写的两块不动）。返回交出去几条 */
async function revLay(s, list) {
  if (!AI.ok) return 0;
  let n = 0;
  for (const e of list || promptsOf(s.段)) if (await startJob({ 事: '直接铺底', 段: s.段, 名: e.name }, true)) n++;
  return n;
}
