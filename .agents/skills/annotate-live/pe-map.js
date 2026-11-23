'use strict';
/* sd25-pe 地图：写提示词的 AI 写哪一块，就看 sd25-pe 的哪几节（2026-11-18）。
   地图在同一个文件夹的 sd25-pe地图.md：人能看、能改，每回现读，改了马上生效。
   任务书里只给地图和 sd25-pe 的路径，写的 AI 先看地图、照地图去读那几节（11-18 晚他定：不再把原文摘进任务书；
   11-15 定的照旧：不另存副本，技能更新了跟着变）。
   地图指的节在技能里找不到的（小标题改了、重名、地图写错），或者 sd25-pe 升级过、地图还没重核（地图里记的指纹对不上），
   都列进 missing：任务书里写明这回要通读整份，任务结果里也报一句。
   测试：通用工具/测试/sd25-pe地图_测试.cjs（拿真的地图和真的 SKILL.md 查）
   切节的办法也给 GEO 底稿用：贴进任务书时去掉给人核对的几节（geoForBook，测试：通用工具/测试/GEO底稿进任务书_测试.cjs） */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAP_FILE = path.join(__dirname, 'sd25-pe地图.md');
const SKILL_FILE = path.join(__dirname, '..', 'sd25-pe', 'SKILL.md');
const OWN = '本项目另加一条：一条最多 30 秒，按真人做事的快慢排镜头，不为装下而压快或删戏；戏多装不下，批注、方案里提醒人分成几条。';
/* 「挂了才看」那几行：块名里有这几个字，这一条挂了这样素材才带（has.voice / has.bm / has.frame） */
const WHEN = [['音色', 'voice'], ['白模', 'bm'], ['关键帧', 'frame']];

const linesOf = text => String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
const isFence = l => /^\s*```/.test(l);
/* 技能的指纹：换行统一、去掉首尾空白以后 sha256 的前 8 位（地图里记着核对过的那一份）。
   首尾空白不算：流水线读技能会去掉它（jobs.js 的 skill()），以前算进去，回回报对不上（11-21） */
const printOf = skillText => crypto.createHash('sha256').update(linesOf(skillText).join('\n').trim(), 'utf8').digest('hex').slice(0, 8);

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
   没有这个标题、重名、下面是空的，都算找不到（回 null） */
function rangeOf(ls, hs, title, intro) {
  const hit = hs.filter(h => h.t === title);
  if (hit.length !== 1) return null;
  const h = hit[0], next = hs.slice(hs.indexOf(h) + 1).find(x => intro || x.lv <= h.lv);
  const r = { a: h.i + 1, z: next ? next.i : ls.length };
  return ls.slice(r.a, r.z).join('').trim() ? r : null;
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

/* 任务书里讲 sd25-pe 的那一段：地图和 sd25-pe 的路径，先看地图、照地图读那几节；这一条挂了音色、白模、关键帧，点名「挂了才看」那几行。
   has：{ voice, bm, frame } 这一条挂了什么；md 不给就现读地图文件。对不上的列进 missing，写明这回通读整份 */
function bookRef(skillText, has, md) {
  if (md === undefined) { try { md = fs.readFileSync(MAP_FILE, 'utf8'); } catch (e) { md = ''; } }
  const all = parse(md), rows = pickRows(all, has), missing = [];
  if (!all.length) missing.push('地图（sd25-pe地图.md 读不了或是空的）');
  const was = checkedPrint(md), now = printOf(skillText);
  if (all.length && was !== now) missing.push('sd25-pe 升级过，地图还没照新原文重核（地图记的指纹 ' + (was || '没写') + '，现在是 ' + now + '）');
  for (const x of check(skillText, md)) missing.push('找不到' + x);
  const hung = rows.filter(r => r.组.startsWith('挂了')).map(r => r.块);
  const text = ['## sd25-pe（写视频提示词的规矩：先看地图，照地图读那几节，不用通读）',
    '1. 先读地图：' + MAP_FILE,
    '2. 写哪一块，就照地图里那一行，到 sd25-pe 原文里按「」里的小标题读那几节：' + SKILL_FILE,
    '3. 地图「每一条都看」那一组都看；' + (hung.length ? '这一条挂了' + hung.join('、') + '，「挂了才看」里这几行也看' : '这一条没挂音色、白模、关键帧，「挂了才看」不用看') + '；「用到再看」用到才看。',
    ...(missing.length ? ['这回地图对不上：' + missing.slice(0, 3).join('；') + (missing.length > 3 ? ' 等 ' + missing.length + ' 处' : '') + '。sd25-pe 要通读整份，对不上的地方照原文写。'] : []),   // 只列头几处，任务书别又变长；全部记在日志里
    OWN].join('\n');
  return { text, missing, rows };
}
/* 地图里每一行（三组都算）指的节，在这份技能里找不到的（「块：「节」」）；bookRef 和测试都拿它查 */
function check(skillText, md) {
  const ls = linesOf(skillText), hs = headsOf(ls);
  return parse(md).flatMap(r => r.节.filter(n => !rangeOf(ls, hs, n.t, n.开头)).map(n => r.块 + '：' + nameOf(n)));
}
/* 去掉小标题合 skip 的几节，连下面的小节（到下一个同级或更高一级的小标题之前）；一节没去就原样返回 */
function dropSections(text, skip) {
  const ls = linesOf(text), hs = headsOf(ls), cut = new Set();
  hs.forEach((h, k) => {
    if (!skip(h)) return;
    const next = hs.slice(k + 1).find(x => x.lv <= h.lv);
    for (let i = h.i; i < (next ? next.i : ls.length); i++) cut.add(i);
  });
  return cut.size ? ls.filter((_, i) => !cut.has(i)).join('\n') : text;
}
/* GEO 底稿贴进写提示词的任务书（jobs.js 的 geoPart）：给人核对的几节不贴（11-23 他定）。
   「依据」「来源」列的是 Blender 工程、几何数据、旧脚本，写提示词用不上，AI 点进去白费工夫；标了「只给人看」「不喂给模型」的也不贴 */
const GEO_HUMAN = /^(?:[一二三四五六七八九十]+、\s*)?(?:依据|来源)|只给人看|不喂给模型/;
const geoForBook = text => dropSections(text, h => GEO_HUMAN.test(h.t));

module.exports = { MAP_FILE, SKILL_FILE, OWN, WHEN, parse, pickRows, bookRef, check, printOf, checkedPrint, dropSections, geoForBook };
