'use strict';
/* 公用/样片归属.js：样片是哪一条提示词、哪一版出的（审片、提示词两页共用；2026-11-16 从 审片.html 挪出来） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const C = require('../公用/样片归属.js');

const P = (key, ...more) => ({ key, name: more.length ? more[more.length - 1] : key, vers: [key, ...more] });
const list = [
  P('镜头1-5_视频提示词.txt', '镜头1-5_视频提示词_改1.txt', '镜头1-5_视频提示词_改6.txt'),
  P('镜头6-9_视频提示词.txt'),
  P('镜头7_视频提示词.txt'),
  P('视频提示词.txt'),
  P('视频提示词_02.txt', '视频提示词_02_改1.txt'),
];
const [a15, a69, a7, p1, p2] = list;

test('哪一条：名字里带记号就认它；「镜头6-9拼接」不算「镜头6-9」', () => {
  assert.equal(C.promptOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4', list, {}), a15.key);
  assert.equal(C.promptOf('第3-4段_第11条_镜头6-9_720p.mp4', list, {}), a69.key);
  assert.equal(C.promptOf('第3-4段_第13条_镜头6-9拼接_720p.mp4', list, {}), '');
  assert.equal(C.promptOf('第1-1段_第3条_提示词02改1_480p.mp4', list, {}), p2.key);
  assert.equal(C.promptOf('第1-1段_第1条_提示词01_480p.mp4', list, {}), p1.key);
});

test('照镜头号起名的（11-16）：样片里记 1-5、1-5改1；老稿 镜头1-5 出的不算它的', () => {
  const n15 = P('1-5.txt', '1-5_改1.txt'), n3 = P('3.txt'), all = [...list, n15, n3];
  assert.equal(C.promptOf('第3-4段_第20条_1-5改1_样片480p.mp4', all, {}), n15.key);
  assert.equal(C.verOf('第3-4段_第20条_1-5改1_样片480p.mp4', n15), '1-5_改1.txt');
  assert.equal(C.promptOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4', all, {}), a15.key);
  assert.equal(C.promptOf('第3-4段_第21条_3_样片480p.mp4', all, {}), n3.key);
  assert.equal(C.promptOf('第3-4段_第22条_13_样片480p.mp4', all, {}), '');   // 「13」不算「3」
});

test('哪一条：选定过的照选定的；只有一条提示词就是它', () => {
  assert.equal(C.promptOf('第3-4段_第12条_镜头1快剪_推弹_样片480p.mp4', list, { [a7.key]: '第3-4段_第12条_镜头1快剪_推弹_样片480p.mp4' }), a7.key);
  assert.equal(C.promptOf('随便起的名字.mp4', [a7], {}), a7.key);
  assert.equal(C.promptOf('随便起的名字.mp4', list, null), '');
});

test('哪一版：记号 → 出片记录 → 只有一版', () => {
  assert.equal(C.verOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4', a15), '镜头1-5_视频提示词_改6.txt');
  assert.equal(C.verOf('第3-4段_第1条_镜头1-5_样片480p.mp4', a15), a15.key);
  assert.equal(C.verOf('第3-4段_第9条_别的名字.mp4', a15, () => ({ 提示词: '镜头1-5_视频提示词_改1.txt' })), '镜头1-5_视频提示词_改1.txt');
  assert.equal(C.verOf('第3-4段_第9条_别的名字.mp4', a15, null), '');
  assert.equal(C.verOf('第3-4段_第9条_别的名字.mp4', a69, null), a69.key);
  let asked = 0;
  C.verOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4', a15, () => { asked++; return null; });
  assert.equal(asked, 0, '名字认出来了就不去翻出片记录');
});

test('这一版出过的样片：只算现在这一版，前几版的不算', () => {
  const vids = ['第3-4段_第5条_镜头1-5改1_样片480p.mp4', '第3-4段_第14条_镜头1-5改6_样片480p.mp4', '第3-4段_第11条_镜头6-9_720p.mp4', '第3-4段_第13条_镜头6-9拼接_720p.mp4'];
  assert.deepEqual(C.madeOf(a15, vids, list, {}), ['第3-4段_第14条_镜头1-5改6_样片480p.mp4']);
  assert.deepEqual(C.madeOf(a69, vids, list, {}), ['第3-4段_第11条_镜头6-9_720p.mp4']);
  assert.deepEqual(C.madeOf(a7, vids, list, {}), []);
  const old = P('镜头1-5_视频提示词.txt', '镜头1-5_视频提示词_改1.txt');
  assert.deepEqual(C.madeOf(old, vids, [old], {}), ['第3-4段_第5条_镜头1-5改1_样片480p.mp4']);
});

test('11-18 起样片和提示词同名：1_改3.mp4 是 1.txt 那一条的改3 出的', () => {
  const n1 = P('1.txt', '1_改1.txt', '1_改3.txt'), n15 = P('1-5.txt'), n3 = P('3.txt'), n2 = P('2.txt');
  const all = [n1, n15, n3, n2];
  assert.equal(C.promptOf('1_改3.mp4', all, {}), n1.key);
  assert.equal(C.verOf('1_改3.mp4', n1), '1_改3.txt');
  assert.equal(C.promptOf('1_改3_2.mp4', all, {}), n1.key);   // 同一版再出的一条
  assert.equal(C.verOf('1_改3_2.mp4', n1), '1_改3.txt');
  assert.equal(C.verOf('1_2.mp4', n1), '1.txt');
  assert.equal(C.promptOf('1_改3_补1.mp4', all, {}), '');   // 11-18 起没有补片：它是 1_改3_补1.txt 出的，不算这一条的
  const b46 = P('4-6.txt'), b461 = P('4-6_补1.txt'), b462 = P('4-6_补2.txt'), bu = [b46, b461, b462];
  assert.equal(C.promptOf('4-6_补1.mp4', bu, {}), b461.key);   // 以前的补片稿是单独的一条
  assert.equal(C.promptOf('4-6_补2_2.mp4', bu, {}), b462.key);
  assert.equal(C.promptOf('4-6.mp4', bu, {}), b46.key);
  assert.equal(C.promptOf('第1-1段_第4条_4-6_720p.mp4', bu, {}), b46.key);   // 老名字照记号认：记号 4-6补1 不算 4-6
  assert.equal(C.promptOf('1-5.mp4', all, {}), n15.key);   // 「1-5」不算「1」
  assert.equal(C.promptOf('3_2.mp4', all, {}), n3.key);   // 3.txt 再出的一条，不是 2.txt 出的（老名字的认法会认成 2）
  assert.equal(C.promptOf('4.mp4', all, {}), '');
  assert.deepEqual(C.madeOf(n1, ['1.mp4', '1_改3.mp4', '1_改3_2.mp4', '1-5.mp4', '第3-4段_第20条_1改3_720p.mp4'], all, {}),
    ['1_改3.mp4', '1_改3_2.mp4', '第3-4段_第20条_1改3_720p.mp4']);   // 老名字的照旧认
  assert.equal(C.carries('3_2.mp4', '2.txt'), false);
  assert.equal(C.noOf('1_改3.mp4'), 0);
});

test('和哪一版同名先算：视频提示词_02.mp4 是第 2 条出的，不算第 1 条再出的', () => {
  const a = P('视频提示词.txt'), b = P('视频提示词_02.txt');
  assert.equal(C.promptOf('视频提示词_02.mp4', [a, b], {}), b.key);
  assert.equal(C.promptOf('视频提示词_02.mp4', [b, a], {}), b.key);
  assert.equal(C.promptOf('视频提示词_2.mp4', [a, b], {}), a.key);
  assert.equal(C.promptOf('视频提示词.mp4', [a, b], {}), a.key);
});

test('接力稿（11-19）：前半条、后半条出的样片各归各的那一条；两条接起来的不算哪一条', () => {
  const Core = require('../公用/核心.js');
  const fams = Core.vpFams(['1_改5.txt', '1_改6_前半条.txt', '1_改7_前半条.txt', '1_改6_后半条.txt', '1_改7_后半条.txt', '1_改8_后半条.txt', '2-4.txt'])
    .map(f => ({ key: f.key, name: f.vers[f.vers.length - 1], vers: f.vers }));   // 和 流水线.js 的 promptsOf 一样
  const front = fams.find(e => e.key === '1_前半条.txt'), back = fams.find(e => e.key === '1_后半条.txt');
  assert.equal(fams.length, 3);   // 整条稿 1_改5 比接力稿旧：不摆
  assert.equal(C.promptOf('1_改7_前半条.mp4', fams, {}), front.key);
  assert.equal(C.verOf('1_改7_前半条.mp4', front), '1_改7_前半条.txt');
  assert.equal(C.promptOf('1_改8_后半条_2.mp4', fams, {}), back.key);
  assert.equal(C.verOf('1_改7_后半条.mp4', back), '1_改7_后半条.txt');
  assert.equal(C.promptOf('1_改8_前后接起来.mp4', fams, {}), '');
  assert.deepEqual(C.madeOf(back, ['1_改7_前半条.mp4', '1_改7_后半条.mp4', '1_改8_后半条.mp4', '1_改8_前后接起来.mp4'], fams, {}), ['1_改8_后半条.mp4']);   // 现在这一版（改8）出的
});

test('样片自己是第几条', () => {
  assert.equal(C.noOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4'), 14);
  assert.equal(C.noOf('没有条号.mp4'), 0);
});

test('老仓库的名字（11-19 3-1 段搬进来）：记号紧贴段号，后面接第几条', () => {
  const j1 = P('镜1补拍_视频提示词.txt'), j5 = P('镜5补拍_视频提示词.txt'), j52 = P('镜5两轮递射_视频提示词.txt'), all = [j1, j5, j52, P('视频提示词.txt')];
  assert.equal(C.promptOf('李云龙大战奥特曼_第3-1段镜1补拍_第4条_用户重试_样片480p.mp4', all, {}), j1.key);
  assert.equal(C.promptOf('李云龙大战奥特曼_第3-1段镜5补拍_第2条_样片480p.mp4', all, {}), j5.key);
  assert.equal(C.promptOf('李云龙大战奥特曼_第3-1段镜5两轮递射_第4条_正片720p.mp4', all, {}), j52.key);
  assert.equal(C.verOf('李云龙大战奥特曼_第3-1段镜5补拍_第2条_样片480p.mp4', j5), j5.key);
  assert.equal(C.noOf('李云龙大战奥特曼_第3-1段镜5补拍_第2条_样片480p.mp4'), 2);
  assert.equal(C.promptOf('李云龙大战奥特曼_第3-1段镜6两轮炮击_第1条_样片480p.mp4', all, {}), '');   // 没这条提示词的不乱认
  assert.equal(C.carries('李云龙大战奥特曼_第3-1段镜1补拍改1_第4条_样片480p.mp4', j1.key), false);   // 记号要整个对上
});

/* 写稿页里加减镜头（2026-11-20）：2-3 连前几版改名成 2-4，旧名字出的样片照样算这一条的、照样认得是哪一版 */
test('改过名的：旧名字出的样片照 was 认回来，出片记录写旧名字也认', () => {
  const e = { key: '2-4.txt', name: '2-4_改1.txt', vers: ['2-4.txt', '2-4_改1.txt'], was: { '2-4.txt': ['2-3.txt'], '2-4_改1.txt': ['2-3_改1.txt'] } };
  const ls = [e, P('1.txt')];
  for (const [vid, ver] of [['2-3_改1.mp4', '2-4_改1.txt'], ['2-3_改1_2.mp4', '2-4_改1.txt'], ['2-3.mp4', '2-4.txt'], ['2-4_改1.mp4', '2-4_改1.txt'], ['第1-1段_第3条_2-3_720p.mp4', '2-4.txt']]) {
    assert.equal(C.promptOf(vid, ls, {}), '2-4.txt', vid);
    assert.equal(C.verOf(vid, e, null), ver, vid);
  }
  assert.equal(C.verOf('看不出来.mp4', e, { 提示词: '2-3_改1.txt' }), '2-4_改1.txt');
  assert.deepEqual(C.madeOf(e, ['2-3_改1.mp4', '2-3.mp4', '1.mp4'], ls, {}), ['2-3_改1.mp4']);
  assert.deepEqual(C.namesOf(P('1.txt'), '1.txt'), ['1.txt']);   // 没改过名的只认自己
});
