/* 样片是哪一条提示词出的、照哪一版出的（2026-11-16 从 审片.html 挪出来：审片、提示词两页共用一套；提示词那一步筛「已出片 / 没出片」就照它）。
   样片名是本机服务起的：11-18 起和出它的提示词同名（1_改3.txt 出的叫 1_改3.mp4，同一版再出一条 1_改3_2.mp4），认法在 Core.clipTake；
   以前的叫 第N段_第M条_<记号>_480p.mp4，记号是 Core.vpTok（提示词01、提示词02改1、老稿 镜头1-5改1），名字不改，照记号认。
   一条提示词 e：{ key: 原稿名, name: 最新那一版, vers: [几版] }（流水线.js 的 promptsOf 给的）。
   ClipOf.scene(s) 在网页里用（要先引 流水线.js）：照这一场的选定、成片文件夹、出片记录认。别的在 node 里也能跑。
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
  const by = list.find(e => e.vers.some(n => namesOf(e, n).some(m => Core.clipTake(vid, m) === 1))) || list.find(e => e.vers.some(n => namesOf(e, n).some(m => carries(vid, m))));
  return by ? by.key : list.length === 1 ? list[0].key : '';
}
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
/* 网页里：这一场的（clipsOf、shotRecOf 在 流水线.js） */
function scene(s) {
  const sel = s && s.选定 && typeof s.选定 === 'object' ? s.选定 : {}, c = clipsOf(s.段);
  const rec = (vid, e) => { const t = c.time.get(vid) || 0; return t ? shotRecOf(s.段, e.key, t) : null; };
  return {
    prompt: (vid, list) => promptOf(vid, list, sel),
    ver: (vid, e) => verOf(vid, e, () => rec(vid, e)),
    made: (e, list) => madeOf(e, c.vids, list, sel, rec),
  };
}
const ClipOf = Object.freeze({ carries, namesOf, promptOf, verOf, madeOf, noOf, scene });
if (typeof module !== 'undefined' && module.exports) module.exports = ClipOf;
G.ClipOf = ClipOf;
})(typeof globalThis !== 'undefined' ? globalThis : this);
