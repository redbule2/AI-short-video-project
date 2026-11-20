/* ============================================================
   公用 · 历史记录（Hist）：提示词、审片、资产三页的「历史记录」筛选共用（2026-11-19 他要的：默认不摆历史记录，点一下只看历史记录里的）。
   收进去的文件：历史记录/同样的路径/原名__年月日-时分秒.后缀（有的时间后面还带几位随机字：__20261111-075528-9139db.json）；
   审完没选上的样片收进去名字不改。
     Hist.parse(name)：{ name, orig: 原名（带后缀）, stamp: '20261119-163701', when: '11-19 16:37' }；名字里没带时间的 stamp、when 是空串，orig 就是它。
     Hist.newer(a, b)：排先后用，新的在前（带时间的照时间；没带的照修改时间 mtime）。
     Hist.promptSha(text)：提示词的 SHA-256（去掉 BOM、换行统一成 \n，和 通用工具/核对参考素材.py 一样），给 Promise。
     Hist.refsBySha(maps, key, sha)：几份参考素材映射（现在的和 历史记录/资产/参考素材映射__时间.json 留的底）里，
       哪一份登记的这一条（key：提示词/第N段/原名）正好是这一版的字（prompt_sha256 对得上）；给 { refs, from } 或 null。
     Hist.mapsOf(io)、Hist.refsFor(io, maps, it, text)：一条提示词（现在的、历史记录里的一版）挂的是哪几张图（流水线历史记录、写稿页「参考」共用）。
   网页里、node 里都能用。测试：node --test 通用工具/测试/历史记录_测试.cjs
   ============================================================ */
(function (G) {
'use strict';
const AP = () => G.AssetPath || require('./资产路径.js');   // 资产放哪（公用/资产路径.js）：老登记里的路径换成新的
const RE = /^(.+)__([0-9]{8})-([0-9]{6})(?:-[0-9a-z]+)?(\.[^./\\]+)?$/i;
const when = stamp => /^[0-9]{8}-[0-9]{6}$/.test(stamp || '') ? stamp.slice(4, 6) + '-' + stamp.slice(6, 8) + ' ' + stamp.slice(9, 11) + ':' + stamp.slice(11, 13) : '';
function parse(name) {
  const n = String(name || ''), m = RE.exec(n);
  if (!m) return { name: n, orig: n, stamp: '', when: '' };
  const stamp = m[2] + '-' + m[3];
  return { name: n, orig: m[1] + (m[4] || ''), stamp, when: when(stamp) };
}
/* 新的在前：都带时间照时间比；有一个没带，照修改时间（毫秒）；再一样照名字 */
const newer = (a, b) => (a.stamp && b.stamp ? b.stamp.localeCompare(a.stamp) : 0) || (b.mtime || 0) - (a.mtime || 0) || String(a.name).localeCompare(String(b.name), 'zh', { numeric: true });
const norm = t => { const x = String(t); return (x.charCodeAt(0) === 0xfeff ? x.slice(1) : x).replace(/\r\n?/g, '\n'); };
async function promptSha(text) {
  const bytes = new TextEncoder().encode(norm(text)), sub = G.crypto && G.crypto.subtle;
  if (!sub) throw new Error('这个浏览器核不了文件内容，请用 Chrome 或 Edge 打开');
  return [...new Uint8Array(await sub.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
}
/* maps：[{ from: '资产/参考素材映射.json', prompts: {...} }, ...]，先给的先认 */
function refsBySha(maps, key, sha) {
  if (!sha) return null;
  for (const m of maps || []) {
    const v = m && m.prompts && m.prompts[key];
    if (v && String(v.prompt_sha256 || '').toLowerCase() === sha.toLowerCase() && Array.isArray(v.references)) return { refs: v.references, from: m.from || '' };
  }
  return null;
}
/* 一个项目的几份参考素材映射：现在那一份在前，历史记录/资产 里留的底从新到旧。
   io.readJson(项目里的路径)、io.list(项目里的文件夹) → [{ name, kind, mtime }]；读不了的跳过 */
async function mapsOf(io) {
  const out = [], take = async rel => { try { const j = await io.readJson(rel); out.push({ from: rel, prompts: (j && j.prompts) || {} }); } catch (e) { /* 没有、坏了 */ } };
  await take('资产/参考素材映射.json');
  let ents = [];
  try { ents = await io.list('历史记录/资产'); } catch (e) { /* 没有 */ }
  const snaps = ents.filter(e => e.kind === 'file' && /^参考素材映射__.+\.json$/i.test(e.name)).map(e => ({ ...parse(e.name), mtime: e.mtime || 0 })).sort(newer);
  for (const x of snaps) await take('历史记录/资产/' + x.name);
  return out;
}
/* 一条视频提示词挂的图（现在用的，或者历史记录里的一版）：{ refs: [{ ref, path, sha }], note }。
   it：{ seg: '3-1', orig: 原名, file: 项目里的路径, old: 历史记录里的, stamp }；maps：mapsOf 给的；text：这一版的字。
   照这一版自己的登记认：字正好对得上的那一份映射 → 认不出照现在同名那一条的登记（老版本标 note：可能不是那时候挂的）；
   写稿资料（现在的 原名_写稿.json，老版本是同一时间收进去的 原名_写稿__时间.json）里的挂图，同一个编号以它为准 */
async function refsFor(io, maps, it, text) {
  const out = new Map(), key = '提示词/第' + it.seg + '段/' + it.orig, ok = r => r && /^@(图片|视频|音频)[0-9]+$/.test(r.ref);
  const hit = refsBySha(maps, key, await promptSha(text)), now = maps[0] && maps[0].prompts[key];
  const reg = hit ? hit.refs : now && Array.isArray(now.references) ? now.references : [];
  let note = !hit && it.old && reg.length ? '这一版没找到当时的登记，@图片 照现在「' + it.orig + '」的登记认，可能不是那时候挂的' : '';
  for (const r of reg) if (ok(r)) out.set(r.ref, { ref: r.ref, path: AP().fromOld(String(r.path || '')).replace(/\\/g, '/'), sha: r.sha256 || '' });
  const dir = String(it.file).split('/').slice(0, -1).join('/'), side = it.orig.replace(/\.txt$/i, '') + '_写稿' + (it.old && it.stamp ? '__' + it.stamp : '') + '.json';
  if (!it.old || it.stamp) {
    try {
      const pics = ((await io.readJson(dir + '/' + side)) || {}).挂图 || {};
      for (const [ref, p] of Object.entries(pics)) if (ok({ ref })) { const o = out.get(ref), path = AP().fromOld(String(p)).replace(/\\/g, '/'); out.set(ref, { ref, path, sha: o && o.path === path ? o.sha : '' }); }
      if (Object.keys(pics).length) note = '';
    } catch (e) { /* 不是网页上写的稿 */ }
  }
  return { refs: [...out.values()], note };
}
const Hist = Object.freeze({ parse, when, newer, promptSha, refsBySha, mapsOf, refsFor });
if (typeof module !== 'undefined' && module.exports) module.exports = Hist;
G.Hist = Hist;
})(typeof globalThis !== 'undefined' ? globalThis : this);
