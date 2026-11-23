/* 样片是哪一条提示词出的、照哪一版出的（2026-11-16 从 审片.html 挪出来：审片、提示词两页共用一套；提示词那一步筛「已出片 / 没出片」就照它）。
   样片名是本机服务起的：11-18 起和出它的提示词同名（1_改3.txt 出的叫 1_改3.mp4，同一版再出一条 1_改3_2.mp4），认法在 Core.clipTake；
   以前的叫 第N段_第M条_<记号>_480p.mp4，记号是 Core.vpTok（提示词01、提示词02改1、老稿 镜头1-5改1），名字不改，照记号认。
   一条提示词 e：{ key: 原稿名, name: 最新那一版, vers: [几版] }（流水线.js 的 promptsOf 给的）。
   ClipOf.scene(s) 在网页里用（要先引 流水线.js）：照这一场的选定、成片文件夹、出片记录认（prompt、ver、made、of）。别的在 node 里也能跑。
   2026-11-22 他定提示词和它出的样片一一绑定：ofPrompt 给审片弹窗摆这一条的样片；ownOf、retireAs 是删一版提示词时跟着进历史记录的样片和新名字。
   测试：node --test 通用工具/测试/样片归属_测试.cjs */
(function (G) {
'use strict';
const Core = G.Core || (typeof require === 'function' ? require('./核心.js') : null);
const stem = n => String(n).replace(/\.[^.]+$/, '');
/* 样片是不是 name 这一版出的：新名字照 Core.clipTake；老名字看带没带这一版的记号（两头是下划线，「镜头6-9拼接」不算「镜头6-9」）。
   老仓库的记号紧贴段号：李云龙大战奥特曼_第3-1段镜1补拍_第3条_样片480p.mp4 是 镜1补拍_视频提示词.txt 出的（11-19 3-1 段搬进来） */
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokIn = (vid, name) => {
  const t = Core.vpTok(name), v = '_' + stem(vid) + '_';
  return t !== '整场' && (v.includes('_' + t + '_') || new RegExp('_第[0-9]+(?:-[0-9]+)?段' + esc(t) + '_第[0-9]+条_').test(v));
};
const carries = (vid, name) => Core.clipOld(vid) ? tokIn(vid, name) : !!Core.clipTake(vid, name);
/* 改过名的（2026-11-20 写稿页里加减镜头，9b-9d.txt → 9b-9e.txt）：这一版以前叫过的名字出的样片也算。e.was：{ 现在的名字: [以前的名字…] }（流水线.js 的 promptsOf 给，没改过名的没有） */
const namesOf = (e, n) => [n, ...(e && e.was && Array.isArray(e.was[n]) ? e.was[n] : [])];
/* 哪一条：给这一条的原稿名 e.key；认不出给 ''。sel：这一场的选定（原稿名 → 样片名）。
   选定过的照选定的；没选过，和哪一版同名就是哪一条（视频提示词_02.mp4 是 视频提示词_02.txt 出的，不算 视频提示词.txt 再出的第 2 条），再看是哪一版出的；这一场只有一条提示词就是它 */
function promptOf(vid, list, sel) {
  const hit = list.find(e => !!sel && sel[e.key] === vid);
  if (hit) return hit.key;
  const by = byName(vid, list);
  return by ? by.key : list.length === 1 ? list[0].key : '';
}
/* 只照名字认是哪一条（不看选定、不猜）：历史记录里的样片用它 */
const byName = (vid, list) => list.find(e => e.vers.some(n => namesOf(e, n).some(m => Core.clipTake(vid, m) === 1))) || list.find(e => e.vers.some(n => namesOf(e, n).some(m => carries(vid, m)))) || null;
/* 哪一版：照名字认（几版都对得上取最新的）→ 出片记录（rec：样片下载下来以前批准出这一条的最后一回；给函数就等用到再算）→ 只有一版就是它；认不出给 '' */
function verOf(vid, e, rec) {
  if (!e) return '';
  const hit = e.vers.filter(n => namesOf(e, n).some(m => carries(vid, m)));
  if (hit.length) return hit[hit.length - 1];
  const r = typeof rec === 'function' ? rec() : rec;
  const rv = r ? e.vers.find(n => namesOf(e, n).includes(r.提示词)) : '';   // 出片记录里写的是旧名字也认
  if (rv) return rv;
  return e.vers.length === 1 ? e.vers[0] : '';
}
/* 这一条现在这一版（e.name）出过的样片：vids 是成片文件夹里的样片名；recOf(vid) 给这条样片的出片记录（可以不给） */
const madeOf = (e, vids, list, sel, recOf) => vids.filter(v => promptOf(v, list, sel) === e.key && verOf(v, e, recOf ? () => recOf(v, e) : null) === e.name);
/* 老样片自己是第几条：第3-4段_第14条_镜头1-5改6_样片480p.mp4 → 14；名字里没有（11-18 起和提示词同名的）给 0 */
const noOf = vid => +((/_第([0-9]+)条_/.exec(String(vid)) || [])[1] || 0);

/* ---------- 提示词和它出的样片一一绑定（2026-11-22 他定：删提示词，它出的样片一起删；审片改成提示词那一行的弹窗，只摆这一条的） ---------- */
/* 跟着一条样片的：同一个文件夹里名字是「样片名_……」的（批注、批注截图、后期补的片子、对照图……）。
   剩下那一截以「改N」「补N」「前半条」「后半条」开头的是别的提示词出的；「2.」「2_」开头的是同一版再出的第 2 条和它的；「_时间」开头的是收进历史记录的旧一份 */
const NOT_KIN = /^(?:改[0-9]+|补[0-9]+|前半条|后半条|[0-9]+(?:[._]|$)|_[0-9]{8}-[0-9]{6})/;
const kinName = (n, s) => { n = String(n); if (!n.startsWith(s + '_')) return false; const r = n.slice(s.length + 1); return !!r && !NOT_KIN.test(r); };
const kinOf = (vid, names) => { const s = stem(vid); return [...names].filter(n => n !== vid && kinName(n, s)); };
/* 跟着这条片子自己的（批注、截图……）：跟着它的片子（后期补的）和那些片子自己的不算 */
function ownKin(vid, names) {
  const ks = kinOf(vid, names), sub = ks.filter(n => Core.RE_CLIP.test(n)).map(stem);
  return ks.filter(n => !Core.RE_CLIP.test(n) && !sub.some(s => kinName(n, s)));
}
/* 片子是不是 name 这一版出的片子后来做的（1-5_改1_后期补.mp4；再出的第 2 条后来做的 1-5_改1_2_后期补.mp4）：只认新名字 */
const STEM_NOT_KIN = /^(?:改[0-9]+|补[0-9]+|前半条|后半条|_[0-9]{8}-[0-9]{6})/;
function kinCarries(vid, name) {
  if (Core.clipOld(vid)) return false;
  const p = String(name).replace(/\.txt$/i, ''), s = stem(vid);
  if (!s.startsWith(p + '_')) return false;
  let r = s.slice(p.length + 1);
  const t = /^[0-9]+(?:_(.*))?$/.exec(r);
  if (t) { if (!t[1]) return false; r = t[1]; }   // 1-5_改1_2 是再出的第 2 条（clipTake 认）；它后来做的看后面那一截
  return !!r && !STEM_NOT_KIN.test(r);
}
/* 这一版（name）自己出的样片，只认名字（1-5_改1.mp4、1-5_改1_2.mp4、老名字里的记号，改名以前的名字也认）。删这一版时跟着走的就是它们 */
const ownOf = (e, name, vids) => vids.filter(v => Core.RE_CLIP.test(v) && namesOf(e, name).some(m => carries(v, m)));
/* 一条提示词（e，几版）出过的样片：审片弹窗只摆这些。vids：成片里的名字（照 promptOf、verOf 认，和「已出片」一样）；
   olds：历史记录/成片 里的名字（只认名字：审完收进去的名字不改；带「__时间」的是删掉的那一版的，认不上）。片子后来做的（后期补的）也算它那一版的。
   给 [{ vid, ver, old }]：ver 是哪一版出的（认不出给 ''）；成片里的在前，新的一版在前 */
function ofPrompt(e, list, sel, vids, olds, recOf) {
  const out = [], kinVer = v => { const hit = e.vers.filter(n => namesOf(e, n).some(m => kinCarries(v, m))); return hit.length ? hit[hit.length - 1] : ''; };
  for (const [names, old] of [[vids || [], false], [olds || [], true]]) for (const v of names) {
    if (!Core.RE_CLIP.test(v)) continue;
    const k = old ? (byName(v, list) || {}).key || '' : promptOf(v, list, sel);
    if (k === e.key) out.push({ vid: v, ver: verOf(v, e, !old && recOf ? () => recOf(v, e) : null), old });
    else if (!k) { const ver = kinVer(v); if (ver) out.push({ vid: v, ver, old }); }
  }
  const vi = x => e.vers.indexOf(x.ver);
  return out.sort((a, b) => (a.old - b.old) || vi(b) - vi(a) || stem(a.vid).localeCompare(stem(b.vid), 'zh', { numeric: true }));
}
/* 删一版提示词时，它出的样片跟着进 历史记录/成片/第N段，和提示词用同一个时间：给 [[原名, 新名]]。
   片子叫 原名__时间.mp4（和删掉的 原名__时间.txt 对得上，以后写回同一个名字也不会算出过片）；跟着它的照它的新名字起（1-5__时间_批注.md、1-5__时间_批注截图），审片台认得回来。
   vids：这一版自己出的（ownOf）；names：成片/第N段 里的名字（文件、文件夹）；片子后来做的跟着走 */
function retireAs(vids, names, stamp) {
  const all = [...names], vs = [];
  for (const v of vids) for (const x of [v, ...kinOf(v, all).filter(n => Core.RE_CLIP.test(n))]) if (!vs.includes(x)) vs.push(x);
  const out = [];
  for (const v of vs) {
    const s = stem(v), to = s + '__' + stamp;
    out.push([v, to + v.slice(s.length)]);
    for (const n of ownKin(v, all)) out.push([n, to + n.slice(s.length)]);
  }
  return out;
}
/* 网页里：这一场的（clipsOf、shotRecOf 在 流水线.js） */
function scene(s) {
  const sel = s && s.选定 && typeof s.选定 === 'object' ? s.选定 : {}, c = clipsOf(s.段);
  const rec = (vid, e) => { const t = c.time.get(vid) || 0; return t ? shotRecOf(s.段, e.key, t) : null; };
  return {
    prompt: (vid, list) => promptOf(vid, list, sel),
    ver: (vid, e) => verOf(vid, e, () => rec(vid, e)),
    made: (e, list) => madeOf(e, c.vids, list, sel, rec),
    of: (e, list, olds) => ofPrompt(e, list, sel, c.vids, olds, rec),   // 审片弹窗摆的（olds：历史记录/成片 里的名字）
  };
}
const ClipOf = Object.freeze({ carries, namesOf, promptOf, byName, verOf, madeOf, noOf, scene, kinOf, ownKin, kinCarries, ownOf, ofPrompt, retireAs });
if (typeof module !== 'undefined' && module.exports) module.exports = ClipOf;
G.ClipOf = ClipOf;
})(typeof globalThis !== 'undefined' ? globalThis : this);
