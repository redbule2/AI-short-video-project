'use strict';
/* 公用/资产路径.js 的测试：node --test 资产路径_测试.cjs */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const A = require('../公用/资产路径.js');

test('三处文件夹：人物道具特效音色放一起，场景单放，这一段的在 关键帧/第N段', () => {
  assert.equal(A.catDir('人物'), '资产/人物和道具');
  assert.equal(A.catDir('道具'), '资产/人物和道具');
  assert.equal(A.catDir('特效'), '资产/人物和道具');
  assert.equal(A.catDir('场景'), '资产/场景');
  assert.equal(A.catDir('场景图'), '资产/场景');
  assert.deepEqual(A.catParts('道具'), ['资产', '人物和道具']);
  assert.equal(A.segDir('3-4'), '资产/关键帧/第3-4段');
  assert.deepEqual(A.segParts('1'), ['资产', '关键帧', '第1段']);
});

test('认一个文件在哪一处', () => {
  assert.deepEqual(A.placeOf('资产/人物和道具/童磊_6岁.png'), { where: '人物和道具', seg: '', depth: 0, hist: false });
  assert.deepEqual(A.placeOf('资产\\场景\\黑铁重炮18机位\\a.png'), { where: '场景', seg: '', depth: 1, hist: false });
  assert.deepEqual(A.placeOf('资产/关键帧/第3-4段/白模/a.blend'), { where: '关键帧', seg: '3-4', depth: 1, hist: false });
  assert.deepEqual(A.placeOf('历史记录/资产/关键帧/第1-1段/镜头1_首帧__20261117-090000.png'), { where: '关键帧', seg: '1-1', depth: 0, hist: true });
  assert.equal(A.placeOf('资产/参考素材映射.json').where, '');
  assert.equal(A.placeOf('资产/关键帧/白模.mp4').where, '');   // 关键帧 下面要先分段
  assert.equal(A.placeOf('提示词/第3-4段/1-5.txt').where, '');
  assert.ok(A.inSeg('资产/关键帧/第3-4段/镜头1_首帧.png', '3-4'));
  assert.ok(!A.inSeg('资产/关键帧/第3-4段/镜头1_首帧.png', '3-5'));
  assert.ok(!A.inSeg('历史记录/资产/关键帧/第3-4段/镜头1_首帧.png', '3-4'));
});

test('老路径换成新的', () => {
  assert.equal(A.fromOld('资产/全局资产/人物/童磊_6岁.png'), '资产/人物和道具/童磊_6岁.png');
  assert.equal(A.fromOld('资产/全局资产/道具/砂锅.png'), '资产/人物和道具/砂锅.png');
  assert.equal(A.fromOld('资产/全局资产/特效/重炮单发爆炸.png'), '资产/人物和道具/重炮单发爆炸.png');
  assert.equal(A.fromOld('资产/全局资产/声音/女声_人声.mp3'), '资产/人物和道具/女声_人声.mp3');
  assert.equal(A.fromOld('资产/全局资产/场景/菜市场路.png'), '资产/场景/菜市场路.png');
  assert.equal(A.fromOld('资产/全局资产/场景/黑铁重炮18机位/机位1.png'), '资产/场景/黑铁重炮18机位/机位1.png');
  assert.equal(A.fromOld('资产/全局资产/人物/外星战士_Tripo第一版/a.glb'), '资产/人物和道具/外星战士_Tripo第一版/a.glb');
  assert.equal(A.fromOld('资产/全局资产/参考影片/a.mp4'), '资产/人物和道具/参考影片/a.mp4');   // 别的类别文件夹整个挪进去
  assert.equal(A.fromOld('资产/第3-4段/镜头1_首帧.png'), '资产/关键帧/第3-4段/镜头1_首帧.png');
  assert.equal(A.fromOld('资产/第3-4段/白模/脚本/a.py'), '资产/关键帧/第3-4段/白模/脚本/a.py');
  assert.equal(A.fromOld('历史记录/资产/第1段/镜头1_首帧__20261116-100000.png'), '历史记录/资产/关键帧/第1段/镜头1_首帧__20261116-100000.png');
  assert.equal(A.fromOld('历史记录/资产/全局资产/人物/童磊__20261115-010000.png'), '历史记录/资产/人物和道具/童磊__20261115-010000.png');
});

test('分隔符照原样留：\\、JSON 里的 \\\\、盘符、项目名', () => {
  assert.equal(A.fromOld('E:\\AI短视频项目\\项目\\李云龙\\资产\\第3-4段\\镜头4_首帧.png'), 'E:\\AI短视频项目\\项目\\李云龙\\资产\\关键帧\\第3-4段\\镜头4_首帧.png');
  assert.equal(A.fromOld('E:\\AI\\项目\\童晓晓\\资产\\全局资产\\人物\\童磊_6岁.png'), 'E:\\AI\\项目\\童晓晓\\资产\\人物和道具\\童磊_6岁.png');
  assert.equal(A.fixText('{"path": "资产\\\\第1-1段\\\\白模.mp4"}'), '{"path": "资产\\\\关键帧\\\\第1-1段\\\\白模.mp4"}');
  assert.equal(A.fixText('{"path": "资产\\\\全局资产\\\\场景\\\\面摊.png"}'), '{"path": "资产\\\\场景\\\\面摊.png"}');
});

test('不是老路径的不动', () => {
  for (const p of ['资产/人物和道具/童磊_6岁.png', '资产/场景/面摊.png', '资产/关键帧/第3-4段/镜头1_首帧.png', '资产/第3-4段_出片记录.json', '资产/参考素材映射.json',
    '提示词/全局资产/人物/童磊_6岁_提示词.txt', '提示词/第3-4段/1-5.txt', '成片/第3-4段/1_改3.mp4', '历史记录/资产/参考素材映射__20261111-000514.json', '定稿的剧本/第1-1段/第1-1段_剧本.docx'])
    assert.equal(A.fromOld(p), p, p);
  assert.ok(!A.isOld('资产/关键帧/第1段/a.png'));
  assert.ok(A.isOld('资产/第1段/a.png'));
});

test('一段话里的老路径都换掉，别的字不动', () => {
  assert.equal(A.fixText('弃用关键帧：@图片9 E:\\AI\\项目\\李云龙\\资产\\第3-4段\\镜头4_首帧.png'), '弃用关键帧：@图片9 E:\\AI\\项目\\李云龙\\资产\\关键帧\\第3-4段\\镜头4_首帧.png');
  assert.equal(A.fixText('@图片1：外星战士（资产/全局资产/人物/外星战士.png）\n@视频1：白模（资产/第3-3段/镜头4-5_白模.mp4）'),
    '@图片1：外星战士（资产/人物和道具/外星战士.png）\n@视频1：白模（资产/关键帧/第3-3段/镜头4-5_白模.mp4）');
  assert.equal(A.fixText('对照：白模 ../../资产/第1段/白模.mp4（同一时刻）'), '对照：白模 ../../资产/关键帧/第1段/白模.mp4（同一时刻）');
  assert.equal(A.fixText('「资产\\第3-4段」里的图'), '「资产\\关键帧\\第3-4段」里的图');
  assert.equal(A.fixText('提示词/全局资产/场景/破庙_GEO底稿.md 和 资产/全局资产/场景/破庙.png'), '提示词/全局资产/场景/破庙_GEO底稿.md 和 资产/场景/破庙.png');
  assert.equal(A.fixText('记在 资产/第N段_出片记录.json'), '记在 资产/第N段_出片记录.json');
  assert.equal(A.fixText(A.fixText('资产/第3-4段/a.png')), '资产/关键帧/第3-4段/a.png');   // 换两遍和换一遍一样
});

test('画布节点名：照文件夹起，老名字也认', () => {
  assert.equal(A.nodeTitle('资产/人物和道具/童磊_6岁.png'), '人物和道具_童磊_6岁');
  assert.equal(A.nodeTitle('资产/场景/菜市场路_1996_傍晚.png'), '场景_菜市场路_1996_傍晚');
  assert.equal(A.nodeTitle('资产/关键帧/第3-4段/镜头1_首帧.png'), '第3-4段_镜头1_首帧');
  assert.equal(A.nodeTitle('资产/关键帧/第3-3段/单样参考/飞碟碟顶.png'), '第3-3段_飞碟碟顶');
  assert.equal(A.nodeTitle('资产/全局资产/道具/砂锅.png'), '人物和道具_砂锅');   // 老路径先换成新的
  assert.equal(A.nodeTitle('资产/第1段/镜头1-5_白模.mp4'), '第1段_镜头1-5_白模');
  assert.deepEqual(A.titlesOf('资产/人物和道具/砂锅.png'), ['人物和道具_砂锅', '人物_砂锅', '道具_砂锅', '特效_砂锅']);
  assert.deepEqual(A.titlesOf('资产/关键帧/第1段/a.png'), ['第1段_a']);
  assert.deepEqual(A.parseTitle('人物和道具_童磊_6岁'), { where: '人物和道具', seg: '', 名称: '童磊_6岁', 类别: '人物和道具', old: false });
  assert.deepEqual(A.parseTitle('特效_重炮单发爆炸'), { where: '人物和道具', seg: '', 名称: '重炮单发爆炸', 类别: '特效', old: true });
  assert.deepEqual(A.parseTitle('场景_破庙'), { where: '场景', seg: '', 名称: '破庙', 类别: '场景', old: false });
  assert.deepEqual(A.parseTitle('第3-4段_镜头1_首帧'), { where: '关键帧', seg: '3-4', 名称: '镜头1_首帧', 类别: '', old: false });
  assert.equal(A.parseTitle('第3-4段｜1_改3｜样片480p｜4秒'), null);
});

test('人物和道具里的图归哪张表：看哪一行挂着它', () => {
  const doc = { 人物: [{ 名: '童磊', 资产: '资产/人物和道具/童磊_6岁.png', 音色: '资产/人物和道具/童磊_音色.wav' }],
    道具: [{ 名: '面车', 资产: ['资产/人物和道具/面车_白天.png', '资产/人物和道具/面车_夜里.png'] }, { 名: '砂锅', 资产: '资产/全局资产/道具/砂锅.png' }] };
  assert.equal(A.rowKind(doc, '资产/人物和道具/童磊_6岁.png'), '人物');
  assert.equal(A.rowKind(doc, '资产\\人物和道具\\童磊_音色.wav'), '人物');
  assert.equal(A.rowKind(doc, '资产/人物和道具/面车_夜里.png'), '道具');
  assert.equal(A.rowKind(doc, '资产/人物和道具/砂锅.png'), '道具');   // 还没换的老登记也认
  assert.equal(A.rowKind(doc, '资产/人物和道具/没人挂.png'), '');
  assert.equal(A.rowKind(null, '资产/人物和道具/童磊_6岁.png'), '');
});

test('资产图的出图提示词在哪：提示词 的分法没改', () => {
  assert.deepEqual(A.promptPaths('资产/场景/破庙.png'), ['提示词/全局资产/场景/破庙_提示词.txt']);
  assert.deepEqual(A.promptPaths('资产/场景/黑铁重炮18机位/机位1.png'), ['提示词/全局资产/场景/黑铁重炮18机位/机位1_提示词.txt']);
  assert.deepEqual(A.promptPaths('资产/人物和道具/砂锅.png', '道具'), ['提示词/全局资产/道具/砂锅_提示词.txt']);
  assert.deepEqual(A.promptPaths('资产/人物和道具/砂锅.png'), ['提示词/全局资产/人物/砂锅_提示词.txt', '提示词/全局资产/道具/砂锅_提示词.txt', '提示词/全局资产/特效/砂锅_提示词.txt']);
  assert.deepEqual(A.promptPaths('资产/关键帧/第3-4段/镜头1_首帧.png'), ['提示词/第3-4段/镜头1_首帧_提示词.txt']);
  assert.deepEqual(A.promptPaths(['童晓晓', '资产', '关键帧', '第1-1段', '单样参考', 'a.png']), [['童晓晓', '提示词', '第1-1段', '单样参考', 'a_提示词.txt']]);
  assert.deepEqual(A.promptPaths('资产/全局资产/人物/童磊_6岁.png', '人物'), ['提示词/全局资产/人物/童磊_6岁_提示词.txt']);   // 老路径先换成新的
  assert.deepEqual(A.promptPaths('资产/参考素材映射.json'), []);
  assert.deepEqual(A.promptPaths('成片/第1-1段/1.mp4'), []);
});
