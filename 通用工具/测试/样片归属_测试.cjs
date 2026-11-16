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

test('样片自己是第几条', () => {
  assert.equal(C.noOf('第3-4段_第14条_镜头1-5改6_样片480p.mp4'), 14);
  assert.equal(C.noOf('没有条号.mp4'), 0);
});
