'use strict';
// node --test 通用工具/测试/GEO底稿进任务书_测试.cjs
/* GEO 底稿贴进写提示词的任务书（jobs.js 的 geoPart）：给人核对的几节不贴（pe-map.js 的 geoForBook，2026-11-23 他定）。
   「依据」「来源」列的是 Blender 工程、几何数据、旧脚本，写提示词用不上，AI 点进去白费工夫；标了「只给人看」「不喂给模型」的也不贴。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../../.agents/skills/annotate-live/pe-map.js');

const DRAFT = [
  '# 面摊 GEO 底稿', '开头一句。', '',
  '## 依据', '| E1 | `资产/场景/面摊.blend` |', '### 依据里的小节', 'E2：几何证据.json', '',
  '## 一、方位', '北是马路，照依据 E1 读的。', '```', '## 依据（代码块里的不算小标题）', '```', '',
  '## 来源与版本', 'v3 从白模读的。', '',
  '## 十、俯视草稿（只给人看，不按比例，不喂给模型）', '  [锅]  [桌]', '',
  '## 十一、场景段（进提示词【场景】）', '夜里面摊，一口大锅冒白汽。', '',
  '## 九、容易画错的（核对用，不进场景段）', '锅在桌子左边。',
].join('\n');

test('依据、来源、只给人看的几节连小节一起去掉，别的一行不动', () => {
  const t = M.geoForBook(DRAFT), ls = t.split('\n');
  for (const s of ['## 依据', '面摊.blend', '### 依据里的小节', '几何证据.json', '## 来源与版本', '从白模读的', '俯视草稿', '[锅]']) assert.ok(!ls.some(l => l.includes(s) && !l.includes('代码块')), '还在：' + s);
  const kept = DRAFT.split('\n').filter(l => ls.includes(l));
  for (const s of ['# 面摊 GEO 底稿', '开头一句。', '## 一、方位', '北是马路，照依据 E1 读的。', '## 依据（代码块里的不算小标题）', '## 十一、场景段（进提示词【场景】）',
    '夜里面摊，一口大锅冒白汽。', '## 九、容易画错的（核对用，不进场景段）', '锅在桌子左边。']) assert.ok(kept.includes(s), '少了：' + s);
  assert.ok(t.indexOf('## 一、方位') < t.indexOf('## 十一、场景段') && t.indexOf('## 十一、场景段') < t.indexOf('## 九、容易画错的'), '次序乱了');
});

test('没有要去掉的节，原样返回（换行也不动）；空的也行', () => {
  const plain = '# 破庙 GEO 底稿\r\n## 一、方位\r\n门朝南。';
  assert.equal(M.geoForBook(plain), plain);
  assert.equal(M.geoForBook(''), '');
  assert.equal(M.dropSections('## 甲\n一\n## 乙\n二', h => h.t === '甲'), '## 乙\n二');
});

/* 本机有这几个项目才查（项目文件夹不上传） */
const P = (...a) => path.resolve(__dirname, '../../项目', ...a);
const REAL = [P('李云龙大战奥特曼', '提示词', '第3-4段', 'GEO底稿.md'), P('李云龙大战奥特曼', '提示词', '全局资产', '场景', '战场GEO底稿.md'), P('童晓晓', '提示词', '第1-1段', 'GEO底稿.md')];
test('真底稿：贴进任务书的不再点名工程、几何数据、脚本；场景段、逐镜机位、本段会变的都在', { skip: !REAL.every(f => fs.existsSync(f)) && '本机没有这几份底稿' }, () => {
  const [seg, all, xx] = REAL.map(f => M.geoForBook(fs.readFileSync(f, 'utf8')));
  for (const t of [seg, all]) assert.doesNotMatch(t, /[.](blend|json|py)\b/, '还点名了文件');
  for (const s of ['## 十一、场景段', '## 十二、逐镜机位', '## 八、本段会变的', '## 九、容易画错的']) assert.ok(seg.includes(s), '少了：' + s);
  assert.ok(!seg.includes('俯视草稿') && !xx.includes('俯视草稿') && !all.includes('## 来源与版本'));
  assert.ok(all.includes('## 地标、数量与朝向') && xx.length > 200);
});
