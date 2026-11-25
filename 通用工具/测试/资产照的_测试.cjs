'use strict';
/* 公用/资产照的.js 的测试：node 通用工具/测试/资产照的_测试.cjs
   资产跟着改（11-23）：每张图、每份字记下照的哪一句描写（场景还记用到它的镜头）；描写改了、镜头多了、图出好以后字又改过，就算旧了 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const S = require('../公用/资产照的.js');

const T0 = '2026-11-23 06:50:14', ms = t => Date.parse(t.replace(' ', 'T'));
const flow = () => ({
  人物: [{ 名: '童磊', 描写: '二十八岁，瘦，穿旧西装' }],
  道具: [{ 名: '简历', 描写: '一叠打印的简历' }],
  场景: '出租屋：一张床，一盏台灯\n第二家面试单位：写字楼前台，玻璃门，前台小姐坐着',
  场: [{ 段: '1-1', 场景文字: ['第二家面试单位：写字楼前台，玻璃门，前台小姐坐着'], 场景图: [],
    段落: [{ 号: '1', 写什么: '童磊推开玻璃门', 场景: ['第二家面试单位'] }, { 号: '2', 写什么: '童磊在出租屋里改简历', 场景: ['出租屋'] }, { 号: '3', 写什么: '前台小姐抬头看他', 场景: ['第二家面试单位'] }] }],
});

test('现在的样子：人物道具照那一行，场景照地方名对上的那一句、全片用到它的镜头', () => {
  const d = flow();
  assert.equal(S.descOf(d, '人物', '童磊'), '二十八岁，瘦，穿旧西装');
  assert.equal(S.descOf(d, '场景', '第二家面试单位'), '第二家面试单位：写字楼前台，玻璃门，前台小姐坐着');
  assert.equal(S.descOf(d, '场景', '没有的地方'), '');
  assert.deepEqual(S.shotsOf(d, '第二家面试单位'), ['童磊推开玻璃门', '前台小姐抬头看他']);
  assert.deepEqual(S.nowOf(d, '道具', '简历'), { 描写: '一叠打印的简历' });
  // 一镜都没标出场的老提炼：选了这处场景的段，整段都算
  const old = flow();
  for (const x of old.场[0].段落) delete x.场景;
  assert.deepEqual(S.shotsOf(old, '第二家面试单位'), ['童磊推开玻璃门', '童磊在出租屋里改简历', '前台小姐抬头看他']);
});

test('会议室改成前台：图照旧那一句记下的，算描写改了，原来、现在都给', () => {
  const d = flow(), img = '资产/场景/第二家面试单位.png';
  d.照的 = { [img]: { 描写: '第二家面试单位：会议室，长桌，三个面试官', 镜头: ['童磊推开玻璃门'], 时间: T0 } };
  const got = S.imgStale(d, img, '场景', '第二家面试单位', ms(T0) + 500);
  assert.equal(got.描写.原来, '第二家面试单位：会议室，长桌，三个面试官');
  assert.equal(got.描写.现在, '第二家面试单位：写字楼前台，玻璃门，前台小姐坐着');
  assert.deepEqual(got.镜头, ['前台小姐抬头看他']);
  assert.equal(S.tagOf(got), '描写改了');
  // 记下以后图又换过（别处挑来的）：不知道照的哪一句，不标
  assert.equal(S.imgStale(d, img, '场景', '第二家面试单位', ms(T0) + 5000), null);
  // 关键帧不归这里管
  assert.equal(S.imgStale(d, img, '关键帧', '第二家面试单位', 0), null);
});

test('只差空格换行不算改；删了镜头不算；记的时候没记镜头的不比镜头', () => {
  const d = flow(), img = '资产/场景/第二家面试单位.png';
  d.照的 = { [img]: { 描写: '第二家面试单位：写字楼前台，玻璃门，\n前台小姐坐着', 镜头: ['童磊推开玻璃门', '前台小姐抬头看他', '删掉的那一镜'], 时间: T0 } };
  assert.equal(S.imgStale(d, img, '场景', '第二家面试单位', 0), null);
  d.照的[img] = { 描写: '第二家面试单位：写字楼前台，玻璃门，前台小姐坐着', 时间: T0 };
  assert.equal(S.imgStale(d, img, '场景', '第二家面试单位', 0), null);
  d.照的[img].镜头 = ['童磊推开玻璃门'];
  assert.equal(S.tagOf(S.imgStale(d, img, '场景', '第二家面试单位', 0)), '镜头改了');
  // 原来没写描写的（图先有、字后写的）：不知道照的哪一句，不算描写改了
  d.照的[img] = { 描写: '', 镜头: ['童磊推开玻璃门', '前台小姐抬头看他'], 时间: T0 };
  assert.equal(S.imgStale(d, img, '场景', '第二家面试单位', 0), null);
});

test('记下、照批注改图换时间、页面交过来的要洗一遍', () => {
  const d = { rest: {}, 人物: [{ 名: '童磊', 描写: '瘦' }] }, img = '资产/人物和道具/童磊.png';
  assert.equal(S.record(d, img, S.nowOf(d, '人物', '童磊'), T0), true);
  assert.deepEqual(d.rest.照的[img], { 描写: '瘦', 时间: T0 });   // 页面那份：记在 rest 里
  assert.equal(S.record(d, img, { 描写: ' ' }, T0), false);   // 空的不记
  d.人物[0].描写 = '胖';
  assert.equal(S.tagOf(S.imgStale(d, img, '人物', '童磊', ms(T0))), '描写改了');
  assert.equal(S.restamp(d, img, '2026-11-23 18:00:00'), true);   // 照批注改出来的：照的还是原来那一句
  assert.equal(S.tagOf(S.imgStale(d, img, '人物', '童磊', ms('2026-11-23 18:00:00'))), '描写改了');
  assert.equal(S.restamp(d, '资产/人物和道具/没记过.png', T0), false);
  assert.deepEqual(S.cleanSnap({ 描写: 'x'.repeat(5000), 镜头: ['a', ' ', 7], 别的: 1 }), { 描写: 'x'.repeat(4000), 镜头: ['a', '7'] });
  assert.equal(S.cleanSnap({ 描写: '' }), null);
  assert.deepEqual(S.cleanDiff({ 描写: { 原来: '会议室', 现在: '前台' }, 镜头: [] }), { 描写: { 原来: '会议室', 现在: '前台' } });
  assert.equal(S.cleanDiff({ 描写: { 原来: '', 现在: '前台' } }), null);
});

test('字改了：图确认、记下以后出图提示词又改过；没确认也没记的不算', () => {
  const d = flow(), img = '资产/人物和道具/童磊.png';
  assert.equal(S.wordEdited(d, img, ms(T0), ms(T0) + 5000), true);
  assert.equal(S.wordEdited(d, img, ms(T0), ms(T0) + 500), false);
  assert.equal(S.wordEdited(d, img, 0, ms(T0) + 5000), false);
  d.照的 = { [img]: { 描写: '二十八岁，瘦，穿旧西装', 时间: '2026-11-23 07:00:00' } };   // 旧图还能用：重新记下的时间也算
  assert.equal(S.wordEdited(d, img, ms(T0), ms('2026-11-23 06:59:00')), false);
  assert.equal(S.tagOf({ 字: true }), '字改了');
});

test('出图以前字旧了没有：看字记下的；字手改过、没记的，看图（字比图早才算）', () => {
  const d = flow(), word = '提示词/全局资产/场景/第二家面试单位_提示词.txt', img = '资产/场景/第二家面试单位.png';
  d.照的 = { [word]: { 描写: '第二家面试单位：会议室', 时间: T0 } };
  assert.equal(S.tagOf(S.wordStale(d, word, '场景', '第二家面试单位', ms(T0), img, 0)), '描写改了');
  assert.equal(S.wordStale(d, word, '场景', '第二家面试单位', ms(T0) + 60e3, img, 0), null);   // 记下以后手改过：不知道
  d.照的 = { [img]: { 描写: '第二家面试单位：会议室', 时间: T0 } };
  assert.equal(S.tagOf(S.wordStale(d, word, '场景', '第二家面试单位', ms(T0) - 60e3, img, ms(T0))), '描写改了');   // 字比图早：图就是照它出的
  assert.equal(S.wordStale(d, word, '场景', '第二家面试单位', ms(T0) + 60e3, img, ms(T0)), null);   // 字比图晚：不知道
  assert.deepEqual(S.msgLines({ 描写: { 原来: '会议室\n长桌', 现在: '前台' }, 镜头: ['前台小姐抬头看他'] }),
    ['这回描写改了。原来：会议室 长桌', '现在：前台', '用到它的镜头多了：前台小姐抬头看他']);
  assert.deepEqual(S.msgLines(null), []);
});
