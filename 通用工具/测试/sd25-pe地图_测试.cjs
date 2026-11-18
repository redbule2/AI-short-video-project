'use strict';
/* .agents/skills/annotate-live/pe-map.js 和 sd25-pe地图.md：写哪一块看 sd25-pe 哪几节，出任务书时照地图从技能原文现摘（2026-11-18）
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

test('没挂音色、白模、关键帧：只带「每一条都看」；挂了哪样才带哪一行；「用到再看」都不带', () => {
  const plain = M.bookParts(SKILL, {});
  assert.deepEqual(plain.missing, []);
  assert.ok(plain.rows.length && plain.rows.every(r => r.组.startsWith('每一条')));
  for (const t of ['白模参考与渲染', '首帧加其他参考', '宫格分镜与故事板', '视频编辑模板', '视频延长模板', '触发前的自升级', '产品与实体流程', '6. 选择唯一主任务'])
    assert.ok(!plain.excerpt.includes('### ' + t), '不该摘：' + t);
  assert.doesNotMatch(plain.excerpt, /npx --yes skills@latest/);   // 技能自升级那条命令不进任务书
  assert.doesNotMatch(plain.excerpt, /## 技能：sd25-pe/);   // 对得上就不附整份
  const all = M.bookParts(SKILL, { voice: true, bm: true, frame: true });
  for (const b of ['素材·音色', '素材·白模', '素材·关键帧']) assert.ok(all.map.includes('| ' + b), '挂了没带：' + b);
  for (const t of ['白模参考与渲染', '6. 选择唯一主任务', '关键帧锚点（开头）', '多关键帧顺序控制']) assert.ok(all.excerpt.includes('### ' + t), '挂了没摘：' + t);
  assert.ok(all.excerpt.length < SKILL.length * 0.75, '摘得太多，和整份差不多了');
  assert.ok(!M.bookParts(SKILL, { bm: true }).map.includes('素材·关键帧'));
});

test('一节只摘一回；包在别的节里的不重摘；按技能里的先后', () => {
  const { excerpt } = M.bookParts(SKILL, {});
  assert.equal(excerpt.split('### 带参考素材的生成\n').length, 2);
  assert.doesNotMatch(excerpt, /^### (空间与站位|多素材组织（开头）)$/m);   // 都在「多素材组织」里面
  assert.equal(excerpt.split('#### 空间与站位').length, 2);
  const at = t => excerpt.indexOf('### ' + t);
  assert.ok(at('不可违反的原则') < at('1. 解析用户目标') && at('1. 解析用户目标') < at('带参考素材的生成') && at('带参考素材的生成') < at('最终自检'));
  assert.match(excerpt.split('\n')[0], /版本 0\.1\.1|版本 \S+/);
});

test('砂锅那一句（药膳鸡 2-3）：照地图找得到写具体东西的规矩和例子', () => {
  const { map, excerpt } = M.bookParts(SKILL, {});
  const row = M.parse(map).find(r => r.块 === '素材·道具');
  assert.ok(row && /装着东西的写上里面的/.test(row.要点));
  for (const t of ['3. 盘点和理解素材', '4. 建立素材职责和主体映射', '带参考素材的生成']) assert.ok(row.节.some(n => n.t === t), t);
  assert.ok(excerpt.includes('所有 `<占位符>` 必须替换为具体内容'));   // 「8. 套用模板并净化」
  assert.ok(excerpt.includes('旧木椅的弧形椅背、深色木纹和磨损位置'));   // 「带参考素材的生成」的填写示例
  assert.ok(excerpt.includes('素材只补充能够直接观察到的特征'));
  assert.ok(excerpt.includes('只使用文字中能够确认的信息'));   // 「输入状态」：AI 看不到道具图，就照文字写
});

test('「开头」只摘到头一个下级小标题之前；代码块里的 # 不当小标题；重名算摘不到', () => {
  const skill = '## 甲\n开头一段。\n```text\n### 假的\n```\n还是开头。\n### 乙\n乙的话。\n## 丙\n丙的话。\n';
  const md = '核对过的 sd25-pe：试，指纹 ' + M.printOf(skill) + '\n## 每一条都看\n| 块 | 看哪几节 | 要点 |\n|---|---|---|\n| 一 | 「甲」开头 | 无 |\n';
  const { excerpt, missing } = M.bookParts(skill, {}, md);
  assert.deepEqual(missing, []);
  assert.ok(excerpt.includes('### 甲（开头）') && excerpt.includes('### 假的') && excerpt.includes('还是开头。'));
  assert.ok(!excerpt.includes('乙的话') && !excerpt.includes('丙的话'));
  const whole = M.bookParts(skill, {}, md.replace('」开头', '」'));
  assert.ok(whole.excerpt.includes('#### 乙') && whole.excerpt.includes('乙的话') && !whole.excerpt.includes('丙的话'));
  const twice = skill + '## 甲\n又一个甲。\n';
  assert.deepEqual(M.bookParts(twice, {}, md.replace(M.printOf(skill), M.printOf(twice))).missing, ['没摘到「甲」开头']);
});

test('对不上就附整份并写明：摘不到、地图读不了、sd25-pe 升级过', () => {
  const skill = '\uFEFF# 别的技能\r\n\r\n## 不可违反的原则\r\n守规矩。\r\n';
  const r = M.bookParts(skill, {});
  assert.ok(r.missing.some(x => /升级过/.test(x)) && r.missing.includes('没摘到「1. 解析用户目标」') && !r.missing.includes('没摘到「不可违反的原则」'));
  assert.match(r.excerpt, /这回对不上：.*没摘到「1\. 解析用户目标」/);
  assert.ok(r.excerpt.includes('守规矩。') && r.excerpt.includes('## 技能：sd25-pe（整份') && !/\r/.test(r.excerpt));
  const none = M.bookParts(SKILL, {}, '');
  assert.match(none.missing[0], /地图/);
  assert.ok(none.excerpt.includes('## 技能：sd25-pe（整份') && none.excerpt.includes('## 不可违反的原则'));
  const bumped = SKILL + '\n新加的一条。\n', up = M.bookParts(bumped, {});
  assert.equal(up.missing.length, 1); assert.match(up.missing[0], /升级过/);
  assert.ok(up.excerpt.includes('### 带参考素材的生成') && up.excerpt.includes('新加的一条。'));   // 照样摘，后面再附整份
});
