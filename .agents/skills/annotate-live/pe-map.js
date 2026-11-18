'use strict';
/* sd25-pe 地图：写提示词的 AI 写哪一块，就看 sd25-pe 的哪几节（2026-11-18）。
   地图在同一个文件夹的 sd25-pe地图.md：人能看、能改，每回现读，改了马上生效。
   出任务书时照地图从 sd25-pe 原文现摘那几节（2026-11-15 他定：不另存副本，技能更新了跟着变）。
   摘不到的（小标题改了、重名、地图写错），或者 sd25-pe 升级过、地图还没重核（地图里记的指纹对不上），
   都列进 missing：任务书里写明、附整份技能，任务结果里也报一句。
   测试：通用工具/测试/sd25-pe地图_测试.cjs（拿真的地图和真的 SKILL.md 查） */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAP_FILE = path.join(__dirname, 'sd25-pe地图.md');
const OWN = '本项目另加一条：一条最多 30 秒，按真人做事的快慢排镜头，不为装下而压快或删戏；戏多装不下，批注、方案里提醒人分成几条。';
/* 「挂了才看」那几行：块名里有这几个字，这一条挂了这样素材才带（has.voice / has.bm / has.frame） */
const WHEN = [['音色', 'voice'], ['白模', 'bm'], ['关键帧', 'frame']];

const linesOf = text => String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
const isFence = l => /^\s*```/.test(l);
/* 技能的指纹：换行统一以后 sha256 的前 8 位（地图里记着核对过的那一份） */
const printOf = skillText => crypto.createHash('sha256').update(linesOf(skillText).join('\n'), 'utf8').digest('hex').slice(0, 8);
const versionOf = skillText => (/^\s*skill_version:\s*(\S+)/m.exec(linesOf(skillText).join('\n')) || [])[1] || '';

/* 技能里的小标题（代码块里的 # 不算）：{ i: 第几行, lv: 几个 #, t: 标题字 } */
function headsOf(ls) {
  const out = []; let fence = false;
  ls.forEach((l, i) => {
    if (isFence(l)) { fence = !fence; return; }
    const m = !fence && /^(#+)\s+(.+?)\s*$/.exec(l);
    if (m) out.push({ i, lv: m[1].length, t: m[2] });
  });
  return out;
}
/* 一节从哪行到哪行：整节到下一个同级或更高一级的小标题之前；开头：到下一个任何小标题之前。
   没有这个标题、重名、摘出来是空的，都算摘不到（回 null） */
function rangeOf(ls, hs, title, intro) {
  const hit = hs.filter(h => h.t === title);
  if (hit.length !== 1) return null;
  const h = hit[0], next = hs.slice(hs.indexOf(h) + 1).find(x => intro || x.lv <= h.lv);
  const r = { a: h.i + 1, z: next ? next.i : ls.length };
  return ls.slice(r.a, r.z).join('').trim() ? r : null;
}
/* 摘出来的里面再有小标题，一律降到这一节下面 */
function demote(ls) {
  let fence = false;
  return ls.map(l => {
    if (isFence(l)) { fence = !fence; return l; }
    return !fence && /^#+\s/.test(l) ? '####' + l.replace(/^#+/, '') : l;
  });
}

/* 读地图：表里一行一块 { 组：在哪个 ## 下面, 块, 节：[{ t, 开头 }], 要点, 行：原样那一行 } */
function parse(md) {
  const rows = []; let grp = '';
  for (const l of linesOf(md)) {
    const g = /^##\s+(.+?)\s*$/.exec(l);
    if (g) { grp = g[1]; continue; }
    if (!/^\s*\|/.test(l)) continue;
    const c = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(s => s.trim());
    if (c.length < 2 || c[0] === '块' || /^:?-{2,}:?$/.test(c[0])) continue;
    const 节 = [...c[1].matchAll(/「([^」]+)」(开头)?/g)].map(m => ({ t: m[1], 开头: !!m[2] }));
    rows.push({ 组: grp, 块: c[0], 节, 要点: c[2] || '', 行: l.trim() });
  }
  return rows;
}
/* 地图里记的「核对过的 sd25-pe：版本，指纹 xxxxxxxx」 */
const checkedPrint = md => (/核对过的 sd25-pe[：:][^\n]*?指纹\s*([0-9a-f]{8})/.exec(linesOf(md).join('\n')) || [])[1] || '';
/* 这一条要带哪几行：「每一条都看」全带；「挂了才看」看挂了什么；别的组（用到再看）流水线不带 */
const pickRows = (rows, has) => rows.filter(r => r.组.startsWith('每一条') || (r.组.startsWith('挂了') && WHEN.some(([w, k]) => r.块.includes(w) && has && has[k])));
const nameOf = n => '「' + n.t + '」' + (n.开头 ? '开头' : '');

/* 任务书里的两段。has：{ voice, bm, frame } 这一条挂了什么；md 不给就现读地图文件。
   map：地图里用得上的几行（放在要求后面）；excerpt：照这几行摘的节（按技能里的先后，一节只摘一回，包在别的节里的不重摘），
   有 missing 的，后面附整份技能 */
function bookParts(skillText, has, md) {
  if (md === undefined) { try { md = fs.readFileSync(MAP_FILE, 'utf8'); } catch (e) { md = ''; } }
  const rows = pickRows(parse(md), has), ls = linesOf(skillText), hs = headsOf(ls), missing = [], spans = [];
  if (!rows.length) missing.push('地图（sd25-pe地图.md 读不了或是空的）');
  const was = checkedPrint(md), now = printOf(skillText);
  if (rows.length && was !== now) missing.push('sd25-pe 升级过，地图还没照新原文重核（地图记的指纹 ' + (was || '没写') + '，现在是 ' + now + '）');
  for (const r of rows) for (const n of r.节) {
    const name = nameOf(n);
    if (spans.some(s => s.name === name) || missing.includes('没摘到' + name)) continue;
    const g = rangeOf(ls, hs, n.t, n.开头);
    if (g) spans.push({ name, t: n.t, 开头: n.开头, ...g }); else missing.push('没摘到' + name);
  }
  const inside = (s, o) => o !== s && o.a <= s.a && s.z <= o.z && (o.z - o.a > s.z - s.a || spans.indexOf(o) < spans.indexOf(s));
  const keep = spans.filter(s => !spans.some(o => inside(s, o))).sort((x, y) => x.a - y.a);
  const map = ['## sd25-pe 地图（写哪一块，就看下面「sd25-pe 摘录」里的哪几节，不用通读）',
    '「」是 sd25-pe 的小标题，摘录里照这个标题找；「开头」是只摘这一节头一个下级小标题之前那几段。「素材·」那几行管素材里挂图、挂录音的那一句。写法一、写法二只照一个；批注、改稿时照批注说到的那一块找。要点只是提醒，和原文有出入以原文为准。写法一、写法二、【基础设定】是本项目定的，照「提示词格式」。',
    '', '| 块 | 看 sd25-pe 哪几节 | 要点 |', '|---|---|---|', ...rows.map(r => r.行), '', OWN].join('\n');
  const ver = versionOf(skillText);
  const excerpt = ['## sd25-pe 摘录（' + (ver ? '版本 ' + ver + '，' : '') + '出这个任务时从技能原文现摘，照上面的地图；包在别的节里的，到那一节里找）',
    ...(missing.length ? ['（这回对不上：' + missing.join('；') + '。后面附了整份技能，对不上的地方照整份写。）'] : []),
    ...keep.flatMap(s => ['', '### ' + s.t + (s.开头 ? '（开头）' : ''), demote(ls.slice(s.a, s.z)).join('\n').trim()]),
    ...(missing.length ? ['', '## 技能：sd25-pe（整份，因为上面有对不上的）', ls.join('\n').trim()] : [])].join('\n');
  return { map, excerpt, missing, rows };
}
/* 地图里每一行（三组都算）指的节，在这份技能里摘不到的；测试拿它查真的地图和技能 */
function check(skillText, md) {
  const ls = linesOf(skillText), hs = headsOf(ls);
  return parse(md).flatMap(r => r.节.filter(n => !rangeOf(ls, hs, n.t, n.开头)).map(n => r.块 + '：' + nameOf(n)));
}

module.exports = { MAP_FILE, OWN, WHEN, parse, pickRows, bookParts, check, printOf, checkedPrint };
