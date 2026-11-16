'use strict';
/* .agents/skills/annotate-live/pe-shots.js：出提示词任务时从 sd25-pe 原文现摘分镜那几节（2026-11-15 他定，不另存副本）
   第一项拿真的 SKILL.md 查：sd25-pe 更新后改了小标题、摘不到了，这里会先报出来 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../.agents/skills/annotate-live/pe-shots.js');
const SKILL = path.resolve(__dirname, '../.agents/skills/sd25-pe/SKILL.md');

test('真的 sd25-pe：七节都摘得到，起止对', () => {
  const { parts, missing } = P.pick(fs.readFileSync(SKILL, 'utf8'));
  assert.deepEqual(missing, []);
  assert.equal(parts.length, P.PARTS.length);
  const at = t => parts.find(p => p.startsWith('### ' + t + '\n'));
  assert.match(at('先拍原因，再拍反应'), /触发原因/);
  assert.match(at('空间与站位'), /不要只写屏幕左侧或右侧/);
  assert.match(at('长视频与时间段'), /#### 目标时长覆盖/);   // 下一级的小标题跟着摘，降一级
  assert.doesNotMatch(at('长视频与时间段'), /视频编辑模板/);   // 到下一个同级小标题就停
  assert.match(at('宫格分镜与故事板'), /镜头1：/);
  assert.doesNotMatch(at('宫格分镜与故事板'), /白模参考与渲染/);
  assert.match(at('情绪与可观察表现'), /触发事件/);
  assert.match(at('专业摄影表达'), /热门运镜方式/);
  assert.match(at('声音、台词和文字'), /\| 台词 \| `\{\}`/);
  assert.doesNotMatch(at('声音、台词和文字'), /产品与实体流程/);
});

test('任务书那一段：标题、本项目那一条、摘到的几节都在', () => {
  const { text, missing } = P.peShots(fs.readFileSync(SKILL, 'utf8'));
  assert.deepEqual(missing, []);
  assert.ok(text.startsWith('## 分镜写法（摘自 sd25-pe'));
  assert.ok(text.includes(P.OWN));
  assert.doesNotMatch(text, /没摘到/);
  for (const p of P.PARTS) assert.ok(text.includes('\n### ' + p.title + '\n'), p.title);
});

test('小标题改了摘不到：列出来，任务书里写明，不报错', () => {
  const { text, missing } = P.peShots('\uFEFF# 别的技能\r\n\r\n### 空间与站位\r\n围着桌子写。\r\n\r\n### 下一节\r\n别的。\r\n');
  assert.deepEqual(missing, P.PARTS.filter(p => p.title !== '空间与站位').map(p => p.title));
  assert.match(text, /没摘到：先拍原因，再拍反应、长视频与时间段/);
  assert.ok(text.includes('### 空间与站位\n围着桌子写。'));
  assert.doesNotMatch(text, /别的。/);
});

test('代码块里的 # 不当小标题', () => {
  const src = '### 专业摄影表达\n要点\n```text\n### 假的小标题\n## 也是假的\n```\n还在这一节\n### 下一节\n不要';
  const got = P.pick(src).parts.find(p => p.startsWith('### 专业摄影表达'));
  assert.ok(got.includes('### 假的小标题') && got.includes('还在这一节'));   // 代码块原样保留
  assert.doesNotMatch(got, /不要/);
});
