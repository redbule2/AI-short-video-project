'use strict';
/* ============================================================
   提示词库（2026-11-19 他要的：写提示词时点「参考」，哪个项目的视频提示词都能挑一条摆在旁边，现在用的、历史记录里收进去的老版本都算）。
   页面那头在 通用工具\公用\写稿参考.js。只读：不改、不挪。
   接口（server.js 转过来，已经查过 Host、X-Antou 头）：
     GET /api/prompts            各项目 提示词/第N段 里现在的、历史记录/提示词/第N段 里收进去的视频提示词，新的在前
     GET /api/prompts?q=词 词     项目名、段、名字、正文里这几个词都有的（不分大小写），带一句「在哪」；最多 300 条
   一条：{ p: 项目, seg: '3-1', name: 文件名, orig: 原名, file: 项目里的路径, old: 历史记录里的, when: '11-19 16:37', t: 毫秒（老版本照收进去的时间）,
          size, label: 镜头1 改3, clips: [{ file: 样片在项目里的路径, old }], lead: 一句话说它拍什么（挑的时候每行底下摆着，好认）, hit: 「在哪」那一句（有 q 才有） }
   样片照名字认是哪一条出的（公用/样片归属.js，和审片那一步同一套），再照时间认是哪一版（见 attach）。
   正文记在内存里，文件没动过不再读；目录二十秒内再问用记下的。
   测试：node --test 通用工具/测试/提示词库_测试.cjs
   ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

module.exports = function makePromptLib({ ROOT, TOOLS, log = () => {} }) {
  const Core = require(path.join(TOOLS, '公用', '核心.js'));
  const Hist = require(path.join(TOOLS, '公用', '历史记录.js'));
  const ClipOf = (() => { try { return require(path.join(TOOLS, '公用', '样片归属.js')); } catch (e) { log('读不了 公用/样片归属.js：' + e.message); return null; } })();
  const PROJ = path.join(ROOT, '项目'), SEG = /^第([0-9]+(?:-[0-9]+)*)段$/, VID = /\.(mp4|m4v|mov|webm)$/i;
  const FRESH = 20e3, MAX = 300;
  let idx = null, idxAt = 0, building = null;
  const texts = new Map();   // 完整路径 → { mtime, text }
  const ls = async dir => { try { return await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { return []; } };
  const stampMs = st => { const m = /^([0-9]{4})([0-9]{2})([0-9]{2})-([0-9]{2})([0-9]{2})([0-9]{2})$/.exec(st || ''); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : 0; };

  async function build() {
    const out = [];
    for (const pd of await ls(PROJ)) {
      if (!pd.isDirectory() || pd.name.startsWith('.')) continue;
      const p = pd.name, base = path.join(PROJ, p), mine = [];
      for (const [rel, old] of [['提示词', false], ['历史记录/提示词', true]]) {
        for (const sd of await ls(path.join(base, ...rel.split('/')))) {
          const m = sd.isDirectory() ? SEG.exec(sd.name) : null;
          if (!m) continue;
          const dir = path.join(base, ...rel.split('/'), sd.name);
          for (const f of await ls(dir)) {
            if (!f.isFile()) continue;
            const hp = Hist.parse(f.name), orig = old ? hp.orig : f.name;
            if (!Core.RE_VP.test(orig) || (!old && hp.stamp)) continue;
            let st;
            try { st = await fsp.stat(path.join(dir, f.name)); } catch (e) { continue; }
            mine.push({ p, seg: m[1], segDir: sd.name, name: f.name, orig, file: rel + '/' + sd.name + '/' + f.name, old, when: old ? hp.when : '', t: (old && stampMs(hp.stamp)) || Math.floor(st.mtimeMs), size: st.size, label: Core.vpLabel(orig), clips: [], abs: path.join(dir, f.name), mtime: Math.floor(st.mtimeMs) });
          }
        }
      }
      if (ClipOf) await attach(base, mine);
      for (const it of mine) it.lead = leadOf(await textOf(it));
      out.push(...mine);
    }
    return out.sort((a, b) => b.t - a.t || a.p.localeCompare(b.p, 'zh') || a.file.localeCompare(b.file, 'zh', { numeric: true }));
  }
  /* 样片归哪一版：照名字认是哪一条（公用/样片归属.js，和审片那一步同一套），再照时间认是哪一版——
     收进历史记录的那一版管到它被收进去的那一刻，之后出的归现在这一版（现在没有了就归最后收进去的那一版） */
  async function attach(base, items) {
    const segs = new Map();
    for (const it of items) { if (!segs.has(it.segDir)) segs.set(it.segDir, new Map()); const fams = segs.get(it.segDir); if (!fams.has(it.orig)) fams.set(it.orig, []); fams.get(it.orig).push(it); }
    for (const [segDir, fams] of segs) {
      for (const [rel, old] of [['成片', false], ['历史记录/成片', true]]) {
        const dir = path.join(base, ...rel.split('/'), segDir);
        for (const f of await ls(dir)) {
          if (!f.isFile() || !VID.test(f.name)) continue;
          let mt;
          try { mt = (await fsp.stat(path.join(dir, f.name))).mtimeMs; } catch (e) { continue; }
          for (const [orig, vers] of fams) {
            if (!ClipOf.carries(f.name, orig)) continue;
            const olds = vers.filter(v => v.old).sort((a, b) => a.t - b.t);
            const to = olds.find(v => v.t > mt) || vers.find(v => !v.old) || olds[olds.length - 1];
            to.clips.push({ file: rel + '/' + segDir + '/' + f.name, old });
          }
        }
      }
    }
  }
  async function index() {
    if (idx && Date.now() - idxAt < FRESH) return idx;
    if (!building) building = build().then(v => { idx = v; idxAt = Date.now(); return v; }).finally(() => { building = null; });
    return building;
  }
  async function textOf(it) {
    const c = texts.get(it.abs);
    if (c && c.mtime === it.mtime) return c.text;
    let text = '';
    try { text = Core.decodeText(await fsp.readFile(it.abs)).text; } catch (e) { /* 读不了就当空的（TextDecoder 已经去掉开头的 BOM） */ }
    texts.set(it.abs, { mtime: it.mtime, text });
    return text;
  }
  /* 一句话说它拍什么：生成目标、本段事件那一句；空着的，事件脚本头一句；再不然头一句不是讲风格、素材的 */
  const STYLE = /^(影像风格|画面风格|风格|光影|光线|色调|声音|音效|摄影|镜头语言|画质|素材|【)/;
  function leadOf(text) {
    let doc = null;
    try { doc = Core.parsePrompt(text); } catch (e) { /* 认不出分区：一行一行看 */ }
    const all = [], blocks = s => s.blocks.map(b => b.text).concat(...(s.shots || []).map(x => [x.head, ...x.blocks.map(b => b.text)]));
    if (doc) { all.push(...doc.pre.map(b => b.text)); for (const s of doc.sections) all.push(...blocks(s)); }
    else all.push(...String(text).split(/\r?\n/));
    const ls = all.map(l => String(l || '').trim()).filter(Boolean), sec = keys => doc ? doc.sections.filter(s => keys.includes(s.key)).flatMap(blocks) : [];
    for (const l of [...sec(['goal', 'event']), ...ls.filter(l => /^(本段事件|生成目标|生成)/.test(l)), ...sec(['script', 'shots']), ...ls.filter(l => !STYLE.test(l)), ...ls]) {
      const t = String(l || '').trim().replace(/^(本段事件|生成目标)\s*[：:]\s*/, '').replace(/\s+/g, ' ').trim();
      if (t) return t.length > 90 ? t.slice(0, 90) + '…' : t;
    }
    return '';
  }
  /* 「在哪」：头一个词在正文里头一回出现的那一行，前后各留一截 */
  function snippet(text, terms) {
    const low = text.toLowerCase();
    let at = -1, len = 0;
    for (const w of terms) { const i = low.indexOf(w); if (i >= 0 && (at < 0 || i < at)) { at = i; len = w.length; } }
    if (at < 0) return '';
    const ls0 = text.lastIndexOf('\n', at) + 1, le0 = text.indexOf('\n', at), le = le0 < 0 ? text.length : le0;
    const a = Math.max(ls0, at - 36), b = Math.min(le, at + len + 60);
    return (a > ls0 ? '…' : '') + text.slice(a, b).trim() + (b < le ? '…' : '');
  }
  const pub = ({ abs, mtime, segDir, ...it }) => it;
  async function search(q) {
    const all = await index(), terms = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return all.map(pub);
    const out = [];
    for (const it of all) {
      const hay = (it.p + ' 第' + it.seg + '段 ' + it.orig + ' ' + it.label).toLowerCase(), text = await textOf(it), low = text.toLowerCase();
      if (!terms.every(w => hay.includes(w) || low.includes(w))) continue;
      out.push({ ...pub(it), hit: snippet(text, terms.filter(w => low.includes(w))) });
      if (out.length >= MAX) break;
    }
    return out;
  }
  async function handle(req, res, url, { json }) {
    if (req.method !== 'GET') throw Object.assign(new Error('只能读'), { status: 405 });
    const q = url.searchParams.get('q') || '';
    const list = await search(q);
    return json(res, { q, n: list.length, list });
  }
  return { handle, search, index };
};
