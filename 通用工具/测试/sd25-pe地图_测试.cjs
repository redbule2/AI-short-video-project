'use strict';
/* .agents/skills/annotate-live/pe-map.js 和 sd25-pe地图.md：写哪一块看 sd25-pe 哪几节（2026-11-18）。
   11-18 晚起任务书只给地图和 sd25-pe 的路径，写的 AI 先看地图、照地图去读那几节，不再把原文摘进任务书。
   头一项拿真的地图、真的 SKILL.md 查：sd25-pe 升级了（指纹变了）、改了小标题、地图写错了，这里会先报出来。
   升级以后：照新的原文把地图一行一行重核，改好地图里「核对过的 sd25-pe」那一行，再跑这个测试 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../.agents/skills/annotate-live/pe-map.js');
const SKILL = fs.readFileSync(path.resolve(__dirname, '../../.agents/skills/sd25-pe/SKILL.md'), 'utf8');
const MAP = fs.readFileSync(M.MAP_FILE, 'utf8');

test('真的地图对得上真的 sd25-pe：指纹一样；三组都在；每一行（流水线不带的也算）指的节都摘得到', () => {
  assert.equal(M.checkedPrint(MAP), M.printOf(SKILL), 'sd25-pe 升级过：照新原文重核地图，再改地图里「核对过的 sd25-pe」那一行');
  const rows = M.parse(MAP);
  for (const g of ['每一条都看', '挂了才看', '用到再看']) assert.ok(rows.some(r => r.组.startsWith(g)), '少了一组：' + g);
  for (const r of rows) assert.ok(r.节.length, r.块 + '：没指节');
  assert.deepEqual(M.check(SKILL, MAP), []);
  for (const r of rows.filter(x => x.组.startsWith('挂了'))) assert.ok(M.WHEN.some(([w]) => r.块.includes(w)), '「挂了才看」认不出这一行挂的是什么：' + r.块);
  for (const b of ['总则', '写法一', '写法二', '【生成目标】', '素材·人物', '素材·道具', '素材·场景', '【未采用素材】', '【基础设定】', '【主体与关系】', '【事件脚本】', '【保持一致】', '交稿前',
    '素材·音色', '素材·白模', '素材·关键帧', '宫格分镜', '视频编辑', '视频延长'])
    assert.ok(rows.some(r => r.块.includes(b)), '地图里少了：' + b);
});

test('任务书只给地图和 sd25-pe 的路径，不贴原文；挂了哪样才点名哪一行', () => {
  const plain = M.bookRef(SKILL, {});
  assert.deepEqual(plain.missing, []);
  assert.equal(M.SKILL_FILE, path.resolve(__dirname, '../../.agents/skills/sd25-pe/SKILL.md'));
  assert.ok(plain.text.includes(M.MAP_FILE) && plain.text.includes(M.SKILL_FILE), '没给两个路径');
  assert.ok(plain.text.includes('先读地图') && plain.text.includes(M.OWN));
  assert.ok(plain.text.length < 600, '又把原文贴进来了：' + plain.text.length + ' 字');
  for (const s of ['所有 `<占位符>` 必须替换为具体内容', '旧木椅的弧形椅背', 'npx --yes skills@latest', '| 块 |']) assert.ok(!plain.text.includes(s), '不该贴：' + s);
  assert.ok(plain.rows.length && plain.rows.every(r => r.组.startsWith('每一条')));
  assert.match(plain.text, /没挂音色、白模、关键帧/);
  const all = M.bookRef(SKILL, { voice: true, bm: true, frame: true });
  for (const b of ['素材·音色', '素材·白模', '素材·关键帧']) assert.ok(all.text.includes(b), '挂了没点名：' + b);
  const bm = M.bookRef(SKILL, { bm: true }).text;
  assert.ok(bm.includes('素材·白模') && !bm.includes('素材·关键帧'));
});

test('砂锅那一句（药膳鸡 2-3）：地图还指着写具体东西的规矩，sd25-pe 里还有那几句', () => {
  const row = M.parse(MAP).find(r => r.块 === '素材·道具');
  assert.ok(row && /装着东西的写上里面的/.test(row.要点));
  for (const t of ['3. 盘点和理解素材', '4. 建立素材职责和主体映射', '带参考素材的生成']) assert.ok(row.节.some(n => n.t === t), t);
  for (const s of ['所有 `<占位符>` 必须替换为具体内容', '旧木椅的弧形椅背、深色木纹和磨损位置', '素材只补充能够直接观察到的特征', '只使用文字中能够确认的信息'])
    assert.ok(SKILL.includes(s), 'sd25-pe 里没有了：' + s);
});

test('找不到的节算对不上：代码块里的 # 不当小标题、下面是空的、重名', () => {
  const skill = '## 甲\n开头一段。\n```text\n### 假的\n```\n还是开头。\n### 乙\n乙的话。\n## 丙\n\n';
  const md = x => '核对过的 sd25-pe：试，指纹 ' + M.printOf(skill) + '\n## 每一条都看\n| 块 | 看哪几节 | 要点 |\n|---|---|---|\n| 一 | ' + x + ' | 无 |\n';
  assert.deepEqual(M.bookRef(skill, {}, md('「甲」开头「乙」')).missing, []);
  assert.deepEqual(M.bookRef(skill, {}, md('「假的」')).missing, ['找不到一：「假的」']);   // 代码块里的不算
  assert.deepEqual(M.bookRef(skill, {}, md('「丙」')).missing, ['找不到一：「丙」']);   // 下面是空的
  const twice = skill + '## 甲\n又一个甲。\n', r = M.bookRef(twice, {}, md('「甲」开头').replace(M.printOf(skill), M.printOf(twice)));
  assert.deepEqual(r.missing, ['找不到一：「甲」开头']);   // 重名
  assert.match(r.text, /这回地图对不上：找不到一：「甲」开头。sd25-pe 要通读整份/);
});

test('对不上就写明通读整份：地图读不了、sd25-pe 升级过；换行、BOM、首尾空行不算升级', () => {
  const none = M.bookRef(SKILL, {}, '');
  assert.match(none.missing[0], /地图/); assert.match(none.text, /这回地图对不上：.*通读整份/);
  const bumped = SKILL + '\n新加的一条。\n', up = M.bookRef(bumped, {});
  assert.equal(up.missing.length, 1); assert.match(up.missing[0], /升级过/);
  assert.ok(!up.text.includes('新加的一条'));   // 照样只给路径，不贴原文
  const fake = M.bookRef('别的技能', {});   // 小标题全对不上：只列头几处
  assert.ok(fake.missing.length > 3 && fake.text.includes('等 ' + fake.missing.length + ' 处') && fake.text.length < 700, fake.text.length + ' 字');
  assert.deepEqual(M.bookRef('\uFEFF' + SKILL.replace(/\r?\n/g, '\r\n'), {}).missing, []);
  assert.deepEqual(M.bookRef(SKILL.replace(/\r\n/g, '\n').trim(), {}).missing, []);   // 流水线的读法（jobs.js 的 skill() 去掉首尾空白）：11-21 以前回回报对不上
});
