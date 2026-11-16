'use strict';
/* sd25-pe 里讲分镜（【事件脚本】各镜）怎么写的几节。
   2026-11-15 他定：不另存副本，出提示词任务时从技能原文现摘，技能更新了跟着变。
   按小标题摘；摘不到的列进 missing，任务书里写明，后面照样附整份技能。
   测试：通用工具/分镜写法摘录_测试.cjs（拿真的 SKILL.md 查每一节都摘得到） */

const PARTS = [
  { title: '先拍原因，再拍反应', para: '遇到“出现原因后' },
  { title: '空间与站位', head: '### 空间与站位' },
  { title: '长视频与时间段', head: '## 长视频与时间段' },
  { title: '宫格分镜与故事板', head: '### 宫格分镜与故事板' },
  { title: '情绪与可观察表现', head: '### 情绪与可观察表现' },
  { title: '专业摄影表达', head: '### 专业摄影表达' },
  { title: '声音、台词和文字', head: '### 声音、台词和文字' },
];
const OWN = '本项目另加一条：一条最多 30 秒，按真人做事的快慢排镜头，不为装下而压快或删戏；戏多装不下，批注、方案里提醒人分成几条。';

const linesOf = text => String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
const isFence = l => /^\s*```/.test(l);

/* 一行一行走，代码块里的 # 不当小标题 */
function walk(ls, fn) {
  let fence = false;
  for (let i = 0; i < ls.length; i++) {
    if (isFence(ls[i])) { fence = !fence; continue; }
    if (!fence && fn(ls[i], i) === false) return;
  }
}

/* 从这个小标题到下一个同级或更高一级的小标题之前 */
function section(ls, head) {
  const level = /^#+/.exec(head)[0].length;
  let a = -1, z = ls.length;
  walk(ls, (l, i) => {
    if (a < 0) { if (l.trim() === head) a = i; return; }
    const m = /^(#+)\s/.exec(l);
    if (m && m[1].length <= level) { z = i; return false; }
  });
  return a < 0 ? null : ls.slice(a + 1, z);
}

/* 以这几个字开头的那一段（技能里一段就是一行） */
function paragraph(ls, start) {
  let hit = null;
  walk(ls, l => { if (l.trim().startsWith(start)) { hit = [l.trim()]; return false; } });
  return hit;
}

/* 摘出来的里面再有小标题，降到这一节下面 */
function demote(ls) {
  let fence = false;
  return ls.map(l => {
    if (isFence(l)) { fence = !fence; return l; }
    return !fence && /^#+\s/.test(l) ? '####' + l.replace(/^#+/, '') : l;
  });
}

function pick(skillText) {
  const ls = linesOf(skillText), parts = [], missing = [];
  for (const p of PARTS) {
    const got = p.head ? section(ls, p.head) : paragraph(ls, p.para);
    const body = got ? demote(got).join('\n').trim() : '';
    if (!body) { missing.push(p.title); continue; }
    parts.push('### ' + p.title + '\n' + body);
  }
  return { parts, missing };
}

/* 任务书里的那一段 */
function peShots(skillText) {
  const { parts, missing } = pick(skillText);
  const text = ['## 分镜写法（摘自 sd25-pe，写【事件脚本】各镜时照这几节）',
    '下面几节是出这个任务时从 sd25-pe 原文现摘的；后面附了整份技能，两边有出入以整份为准。',
    OWN,
    ...(missing.length ? ['（sd25-pe 里没摘到：' + missing.join('、') + '。技能可能改了小标题，照后面整份技能写。）'] : []),
    ...parts.flatMap(p => ['', p])].join('\n');
  return { text, missing };
}

module.exports = { PARTS, OWN, pick, peShots };
