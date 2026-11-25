/* 资产放在哪（2026-11-20 他定三个文件夹；2026-11-25 他定照图上画的是什么放，不看哪一段、哪一条提示词先要的；以 AGENTS.md 为准）。资产 下三个文件夹：
     人物和道具       一个人或一样东西：人物图、道具图、特效图、音色录音、单样东西的参考图，放在一起，不再分小文件夹
     场景             一个地方、里面没人在演戏：场景图、空镜（GEO 用的 Blender 战场也在这）
     关键帧/第N段     某个镜头里的一刻：首帧、尾帧、关键帧，和这一段镜头的白模、参考视频（原来的 资产/第N段 整个挪进来，里面不动；11-25 以前放在这里的空镜、头像、道具图先不挪）
   参考素材映射.json、出片设置.json、第N段_出片记录.json 这类记录照旧放 资产 本层。历史记录/资产 照一样的分法放旧版。
   老路径（11-20 以前的 资产/全局资产/类别、资产/第N段）在记录、任务书、历史记录里还写着：fromOld、fixText 换成新的。
   画布节点名（AGENTS.md「即梦画布」）：人物和道具_文件名、场景_文件名、第N段_文件名；老名字 人物_、道具_、特效_ 开头的也认（parseTitle、titlesOf）。
   rowKind：人物和道具里的图归人物表还是道具表；promptPaths：资产图的出图提示词在哪（提示词 的分法没改）。
   用到的：流水线各页、审片台、项目管理两页、本机服务 jobs.js、canvas.js。测试：node --test 通用工具/测试/资产路径_测试.cjs */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AssetPath = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CP = '人物和道具', SC = '场景', KF = '关键帧';
  const OLD_CP = ['人物', '道具', '特效'];   // 画布老节点名里的类别：都算 人物和道具
  const norm = p => String(p == null ? '' : p).replace(/\\/g, '/');
  const segName = seg => '第' + seg + '段';
  const stem = n => String(n).replace(/\.[^.]+$/, '');
  /* 全片的一类东西放哪个文件夹：场景（场景图、只用文字的场景）→ 场景；人物、道具、特效、音色 → 人物和道具 */
  const dirName = cat => /^场景/.test(String(cat || '')) ? SC : CP;
  const catParts = cat => ['资产', dirName(cat)];
  const catDir = cat => catParts(cat).join('/');
  /* 只给这一段用的：资产/关键帧/第N段 */
  const segParts = seg => ['资产', KF, segName(seg)];
  const segDir = seg => segParts(seg).join('/');
  /* 一个文件在哪一处（从项目里面写起；历史记录/资产/… 也认）：
     where 人物和道具｜场景｜关键帧｜''；seg 关键帧是哪一段；depth 在那一处往下第几层（0 是本层）；hist 在历史记录里 */
  function placeOf(p) {
    let q = norm(p).split('/').filter(Boolean);
    const hist = q[0] === '历史记录';
    if (hist) q = q.slice(1);
    const none = { where: '', seg: '', depth: -1, hist };
    if (q[0] !== '资产' || q.length < 3) return none;
    if (q[1] === CP || q[1] === SC) return { where: q[1], seg: '', depth: q.length - 3, hist };
    const m = q[1] === KF && q.length >= 4 ? /^第([0-9]+(?:-[0-9]+)*)段$/.exec(q[2]) : null;
    return m ? { where: KF, seg: m[1], depth: q.length - 4, hist } : none;
  }
  const inSeg = (p, seg) => { const a = placeOf(p); return a.where === KF && a.seg === String(seg) && !a.hist; };
  /* 老路径 → 新路径。前面可以带 历史记录/、项目名、盘符；/ 和 \（JSON 里的 \\ 也算）照原样留；不是老路径的原样回。
     「资产」前面得是分隔符、引号、括号这类，不是字（「提示词/全局资产」不动）；第N段 后面跟 _ 的是记录文件（第3-4段_出片记录.json），不动 */
  const PRE = '(?<![A-Za-z0-9_.\\-\\u4e00-\\u9fff])资产([\\\\/]+)';
  const CAT_RE = new RegExp(PRE + '全局资产([\\\\/]+)(人物|道具|特效|声音|场景)(?![A-Za-z0-9_.\\-\\u4e00-\\u9fff])', 'g');
  const OTHER_RE = new RegExp(PRE + '全局资产([\\\\/]+)(?=[^\\\\/\\s"\'<>|]+[\\\\/])', 'g');   // 别的类别文件夹（参考影片……）：整个放进 人物和道具 下面
  const SEG_RE = new RegExp(PRE + '(第[0-9]+(?:-[0-9]+)*段)(?![A-Za-z0-9_.\\-])', 'g');
  const fixText = t => String(t == null ? '' : t)
    .replace(CAT_RE, (m, s1, s2, cat) => '资产' + s1 + (cat === '场景' ? SC : CP))
    .replace(OTHER_RE, (m, s1) => '资产' + s1 + CP + s1)
    .replace(SEG_RE, (m, s1, seg) => '资产' + s1 + KF + s1 + seg);
  const fromOld = p => fixText(p);
  const isOld = p => fixText(p) !== String(p == null ? '' : p);
  /* 画布节点名：人物和道具_文件名、场景_文件名、第N段_文件名（下一层文件夹里的也照这一处起名）；别处的就是文件名 */
  function nodeTitle(p) {
    const n = norm(fromOld(p)), base = stem(n.split('/').pop() || ''), at = placeOf(n);
    if (at.where === CP || at.where === SC) return at.where + '_' + base;
    if (at.where === KF) return segName(at.seg) + '_' + base;
    return base;
  }
  /* 这个文件在画布上可能叫的名字：现在的在前；人物和道具里的，11-20 以前叫 人物_、道具_、特效_ 开头 */
  function titlesOf(p) {
    const t = nodeTitle(p), at = placeOf(fromOld(p));
    if (at.where !== CP) return [t];
    const base = t.slice(CP.length + 1);
    return [t, ...OLD_CP.map(c => c + '_' + base)];
  }
  /* 画布节点名 → { where, seg, 名称, 类别, old }；认不出回 null。类别：人物和道具、场景、人物、道具、特效（老名字照老的），关键帧的是 '' */
  function parseTitle(title) {
    const t = String(title == null ? '' : title).trim();
    let m = /^(人物和道具|场景)_(.+)$/.exec(t);
    if (m) return { where: m[1], seg: '', 名称: m[2], 类别: m[1], old: false };
    m = /^(人物|道具|特效)_(.+)$/.exec(t);
    if (m) return { where: CP, seg: '', 名称: m[2], 类别: m[1], old: true };
    m = /^第([0-9]+(?:-[0-9]+)*)段_(.+)$/.exec(t);
    if (m) return { where: KF, seg: m[1], 名称: m[2], 类别: '', old: false };
    return null;
  }
  /* 人物和道具里的一张图是人物还是道具：流水线.json（doc）的人物表、道具表哪一行挂着它（资产 一张写成字符串、几张写成数组，音色也算）；都没挂回 '' */
  function rowKind(doc, file) {
    const f = norm(fromOld(file)), same = x => !!x && norm(fromOld(x)) === f;
    const has = r => !!r && [...(Array.isArray(r.资产) ? r.资产 : [r.资产]), r.音色].some(same);
    for (const k of ['人物', '道具']) if (doc && Array.isArray(doc[k]) && doc[k].some(has)) return k;
    return '';
  }
  /* 资产图的出图提示词可能在哪几处（提示词 的分法没改：全片的在 提示词/全局资产/类别/…，这一段的在 提示词/第N段/…，名字 图名_提示词.txt）。
     img：路径，或一节一节的数组（前面带项目名、历史记录 都照原样留；给什么回什么）。人物和道具里的分不出人物、道具还是特效：cat 给了只回那一处，没给三处都回 */
  function promptPaths(img, cat) {
    const arr = Array.isArray(img), q = arr ? img.map(String) : norm(fromOld(img)).split('/');
    const i = q.lastIndexOf('资产'), at = i < 0 ? null : placeOf(q.slice(i).join('/'));
    if (!at || !at.where) return [];
    const pre = q.slice(0, i), mid = q.slice(i + (at.where === KF ? 3 : 2), -1), tail = stem(q[q.length - 1]) + '_提示词.txt';
    const heads = at.where === KF ? [[segName(at.seg)]] : at.where === SC ? [['全局资产', SC]] : (OLD_CP.includes(cat) ? [cat] : OLD_CP).map(c => ['全局资产', c]);
    const out = heads.map(hd => [...pre, '提示词', ...hd, ...mid, tail]);
    return arr ? out : out.map(x => x.join('/'));
  }
  return Object.freeze({ CP, SC, KF, OLD_CP, segName, dirName, catParts, catDir, segParts, segDir, placeOf, inSeg, fixText, fromOld, isOld, nodeTitle, titlesOf, parseTitle, rowKind, promptPaths });
});
