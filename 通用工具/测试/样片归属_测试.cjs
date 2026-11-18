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
  assert.equal(C.promptOf('1_改3_补1.mp4', all, {}), n1.key);   // 补片拼好的
  assert.equal(C.verOf('1_改3_补1.mp4', n1), '1_改3.txt');
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

test('样片自己是第几条', () => {
  assert.equal(C.noOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4'), 14);
  assert.equal(C.noOf('没有条号.mp4'), 0);
});
