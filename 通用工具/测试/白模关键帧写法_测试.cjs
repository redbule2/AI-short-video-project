'use strict';
/* 公用/白模关键帧写法.js 的测试：node --test 白模关键帧写法_测试.cjs */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const B = require('../公用/白模关键帧写法.js');

const frames = [1, 2, 3].map(n => ({ ref: '@图片' + (n + 3), name: '镜头' + n + '_首帧' }));
const cuts = B.cutsOf('# 白模说明\n镜头1：0-4秒\n镜头2：4-7秒\n镜头3：7-10秒\n');
/* 写法二、照 sd25-pe 写的普通稿（挂了白模又挂了关键帧，这次要换过去的那种） */
const two = [
  '【生成目标】', '生成三个镜头。', '',
  '【人物】', '士兵对应@图片1，只采用军装。', '',
  '【道具】', '炮对应@图片2，只采用炮身。', '飞碟对应@图片3，只采用碟身。', '',
  '【场景】', '以@图片4至@图片6的顺序作为关键帧。', '@图片4作为首帧。', '该首帧定义镜头1开场：装填手托着炮弹。', '@图片5定义第二个关键帧：镜头2开场。', '@图片6定义第三个关键帧：镜头3开场。', '炮阵南北排开。', '',
  '【动作与声音】', '@视频1是细粒度白模参考，一共三个镜头。', '@视频1里灰色的炮是榴弹炮。', '',
  '【事件脚本】', '镜头1：中景，装填手推弹。', '镜头2：大全景，炮弹落下。', '镜头3：特写，弹壳退出。', '最终画面采用写实质感。', '',
  '【保持一致】', '保持同一片炮阵。',
].join('\r\n');

test('切点：一镜一行「镜头N：a-b秒」，表格和全角也认', () => {
  assert.deepEqual(cuts.map(c => [c.no, c.a, c.b]), [[1, 0, 4], [2, 4, 7], [3, 7, 10]]);
  assert.deepEqual(B.cutsOf('| 镜头2 | 3-6秒 |\n| 镜头1 | 0-3秒 |').map(c => c.no), [1, 2]);
  assert.deepEqual(B.cutsOf('没有切点'), []);
});

test('写法二的普通稿换成白模＋关键帧：锚点句和白模那一句拿掉，三句照官方补上，每一镜开头写秒数和参考哪张', () => {
  const r = B.toBmk(two, { vid: '@视频1', frames, cuts });
  const L = r.text.split('\r\n');
  assert.ok(B.isBmk(r.text));
  assert.equal(r.removed.length, 6);
  assert.ok(r.removed.includes('@视频1是细粒度白模参考，一共三个镜头。'));
  const sc = L.indexOf('【场景】'), act = L.indexOf('【动作与声音】');
  assert.equal(L[sc + 1], B.GROUP(['@图片4', '@图片5', '@图片6']));
  assert.equal(L[sc + 2], '炮阵南北排开。');
  assert.deepEqual(L.slice(act + 1, act + 4), [B.LEAD('@视频1'), '@视频1里灰色的炮是榴弹炮。', B.END('@视频1')]);   // 人填的「@视频1里……」不补模板句，收尾那句在组末
  assert.equal(L[L.indexOf('【事件脚本】') + 1], '镜头1：0-4秒，首帧参考@图片4。中景，装填手推弹。');
  assert.equal(L[L.indexOf('【事件脚本】') + 2], '镜头2：4-7秒，开场参考@图片5。大全景，炮弹落下。');
  assert.deepEqual(B.check(B.shots(r.text), 10, cuts), []);
  assert.equal(B.toBmk(r.text, { vid: '@视频1', frames, cuts }).text, r.text);   // 再换一次不变
});

test('没有白模说明：秒数留〔起〕〔止〕，校对说没填', () => {
  const r = B.toBmk(two, { vid: '@视频1', frames, cuts: [] });
  assert.match(r.text, /镜头1：〔起〕-〔止〕秒，首帧参考@图片4。中景/);
  assert.equal(B.check(B.shots(r.text), 10).length, 3);
});

test('白模的镜头比稿子多：后面补上空镜头；空稿照官方骨架铺出来', () => {
  const r = B.toBmk(['【生成目标】', '', '【事件脚本】', '镜头1：中景。', '最终画面采用写实质感。', ''].join('\n'), { vid: '@视频1', frames, cuts });
  const L = r.text.split('\n'), s = L.indexOf('【事件脚本】');
  assert.deepEqual(L.slice(s + 1, s + 5), ['镜头1：0-4秒，首帧参考@图片4。中景。', '镜头2：4-7秒，开场参考@图片5。', '镜头3：7-10秒，开场参考@图片6。', '最终画面采用写实质感。']);
  assert.deepEqual(L.slice(0, 7), ['【生成目标】', '', '【参考素材职责】', B.LEAD('@视频1'), B.MAP('@视频1'), B.GROUP(['@图片4', '@图片5', '@图片6']), B.END('@视频1')]);
  assert.equal(L[7], '');
});

test('换回普通写法：三句拿掉、秒数去掉，关键帧照 sd25-pe 写回锚点句', () => {
  const r = B.toBmk(two, { vid: '@视频1', frames, cuts });
  const back = B.fromBmk(r.text, { frames, bmLines: ['@视频1是粗粒度白模参考。'] });
  assert.equal(back.shots, 3);
  assert.ok(!B.isBmk(back.text));
  assert.match(back.text, /以@图片4至@图片6的顺序作为关键帧。/);
  assert.match(back.text, /\r\n镜头1：中景，装填手推弹。\r\n/);
  assert.match(back.text, /【动作与声音】\r\n@视频1是粗粒度白模参考。\r\n@视频1里灰色的炮是榴弹炮。/);
});

test('bare 记下原来的秒数：重排关键帧以后照旧带上', () => {
  const first = B.toBmk(two, { vid: '@视频1', frames, cuts }).text;
  const b = B.bare(first);
  assert.deepEqual(b.secs, [{ a: 0, b: 4 }, { a: 4, b: 7 }, { a: 7, b: 10 }]);
  const again = B.toBmk(b.text, { vid: '@视频1', frames: frames.slice(0, 2), cuts: [], secs: b.secs });
  assert.match(again.text, /镜头3：7-10秒。特写/);   // 第三张去掉了：秒数还在，不写参考哪张
  assert.match(again.text, /@图片4至@图片5是各镜头的关键帧/);
});

test('关键帧按名字里的镜头号对上切点，对不上的按先后', () => {
  const p = B.plan(cuts, [{ ref: '@图片1', name: '镜头3_首帧' }, { ref: '@图片2', name: '镜头1_首帧' }]);
  assert.deepEqual(p.map(x => x.frames.map(f => f.ref)), [['@图片2'], [], ['@图片1']]);
  const q = B.plan(cuts, [{ ref: '@图片1', name: '开场' }, { ref: '@图片2', name: '中间' }]);
  assert.deepEqual(q.map(x => x.frames.map(f => f.ref)), [['@图片1'], ['@图片2'], []]);
  assert.equal(B.makeTag({ cut: { a: 7, b: 10 }, frames: [{ ref: '@图片9', name: '镜头3_尾帧' }] }, 2), '7-10秒，结尾参考@图片9。');
  const pick = [{ name: '镜头1_首帧' }, { name: '镜头3_尾帧' }, { name: '镜头7_首帧' }];
  assert.deepEqual(pick.map((x, i) => B.labelOf(cuts, pick, i)), ['镜头1 · 0-4秒 · 首帧', '镜头3 · 7-10秒 · 结尾', '白模里没有这一镜，不写进事件脚本']);
  assert.equal(B.labelOf([], pick, 1), '镜头2 · 结尾');   // 没有白模说明：一张一镜，按先后（事件脚本第二镜）
});

test('校对：只写整秒、从 0 接着往下、和白模一样长、和白模说明一样', () => {
  const c = list => B.check(list.map((body, i) => ({ no: i + 1, body })), 10, null).map(x => x.msg);
  assert.deepEqual(c(['0-4秒，首帧参考@图片1。', '4-7秒。', '7-10秒。']), []);
  assert.match(c(['0-3.5秒。', '3.5-7秒。', '7-10秒。'])[0], /只写整秒/);
  assert.match(c(['中景。', '4-7秒。', '7-10秒。'])[0], /开头没写/);
  assert.equal(c(['中景。', '4-7秒。', '7-10秒。']).length, 1);   // 前一镜没写，后一镜不算接不上
  assert.match(c(['0-4秒。', '5-7秒。', '7-10秒。'])[0], /接不上/);
  assert.match(c(['0-4秒。', '4-7秒。', '7-9秒。'])[0], /白模是 10 秒/);
  assert.match(B.check([{ no: 1, body: '0-5秒。' }, { no: 2, body: '5-10秒。' }], 10, cuts.slice(0, 2))[0].msg, /白模说明里是 0-4 秒/);
  assert.match(B.check([{ no: 1, body: '0-10秒。' }], 10, cuts)[0].msg, /3 个镜头/);
  assert.deepEqual(B.tagOf('0-3s（首帧参考 图1）') && [B.tagOf('0-3s，首帧参考@图片1。').a, B.tagOf('0-3s，首帧参考@图片1。').b], [0, 3]);
});

test('写法二只有【场景】的稿换过去：补上【动作与声音】，组和组之间只空一行', () => {
  const t = ['【生成目标】', '', '【场景】', '以@图片1至@图片2的顺序作为关键帧。', '@图片1作为首帧。', '该首帧定义〔视频开始时的构图、人物位置、姿态和镜头方向〕。', '@图片2定义第二个关键帧：〔这一刻看得见的状态〕。', '', '【事件脚本】', '镜头1：', '镜头2：', ''].join('\r\n');
  const r = B.toBmk(t, { vid: '@视频1', frames: [{ ref: '@图片1', name: '镜头1_首帧' }, { ref: '@图片2', name: '镜头2_首帧' }], cuts: [] });
  assert.doesNotMatch(r.text, /\r\n\r\n\r\n/);
  assert.match(r.text, /【场景】\r\n@图片1至@图片2是各镜头的关键帧[^\r\n]*\r\n\r\n【动作与声音】\r\n以@视频1/);
  assert.match(r.text, /不采用它的灰模外观、材质和空白背景。\r\n\r\n【事件脚本】\r\n镜头1：〔起〕-〔止〕秒，首帧参考@图片1。\r\n/);
});

test('只挂关键帧、没挂白模的普通稿不算这一套', () => {
  assert.ok(!B.isBmk(two));
  assert.ok(B.isBmk('【参考素材职责】\n' + B.GROUP(['@图片1'])));
});
