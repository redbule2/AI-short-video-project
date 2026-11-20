'use strict';
/* 提示词页「写一条提示词」的框（2026-11-19 改成两步走）里的两样小算法：这一镜已经写进哪几条、一段白模管到勾的哪几镜。
   照 提示词.html 里「写一条提示词的框：两样小算法」那一段测，用的是真的 核心.js 和 关键帧绑定.js */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const Core = require('../公用/核心.js');
const SB = require('../公用/关键帧绑定.js');

const page = process.env.PROMPT_TEST_PAGE || path.join(__dirname, '../流水线/提示词.html');
const html = fs.readFileSync(page, 'utf8');
const from = html.indexOf('/* ---------- 写一条提示词的框：两样小算法'), to = html.indexOf('/* ---------- 写一条提示词的框 ----------');
assert.ok(from > 0 && to > from, '提示词.html 里找不到「写一条提示词的框：两样小算法」那一段');
const ctx = vm.createContext({ vpCode: Core.vpCode, vpLabel: Core.vpLabel, SB });
vm.runInContext(html.slice(from, to) + '\n;globalThis.out = { hadOf, bmCover };', ctx, { filename: page });
const { hadOf, bmCover } = ctx.out;
const plain = x => JSON.parse(JSON.stringify(x));   // vm 里造的数组，换成这边的才好比

const nos = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '11', '12'];   // 第3-4段那样：镜头10 删了，号不挪
const have = ['1_前半条.txt', '1_后半条.txt', '2-4.txt', '7、9.txt', '镜头6-7_视频提示词.txt', '视频提示词_02.txt'].map(key => ({ key }));

test('同一镜两条接力稿写全，不再都写成 1；前半条排在后半条前头', () => {
  assert.deepEqual(plain(hadOf(have, '1', nos)), ['1 前半条', '1 后半条']);
  assert.deepEqual(plain(hadOf([{ key: '1_后半条.txt' }, { key: '1_前半条.txt' }], '1', nos)), ['1 前半条', '1 后半条']);
});

test('一镜写进好几条的，照镜头表的先后排', () => {
  assert.deepEqual(plain(hadOf([{ key: '3-5.txt' }, { key: '1-3.txt' }, { key: '3.txt' }], '3', nos)), ['1-3', '3-5', '3']);
});

test('一条拍几镜的，每一镜都标上它；一镜都没写的给空', () => {
  for (const n of ['2', '3', '4']) assert.deepEqual(plain(hadOf(have, n, nos)), ['2-4']);
  assert.deepEqual(plain(hadOf(have, '7', nos)), ['7、9']);
  assert.deepEqual(plain(hadOf(have, '9', nos)), ['7、9']);
  assert.deepEqual(plain(hadOf(have, '8', nos)), []);
});

test('老稿（镜头6-7_视频提示词、视频提示词_02）不算，名字重了只写一回', () => {
  assert.deepEqual(plain(hadOf(have, '6', nos)), []);
  assert.deepEqual(plain(hadOf([{ key: '2-4.txt' }, { key: '2-4.txt' }], '3', nos)), ['2-4']);
});

test('中间删过镜头：9-11 拍镜头9、11，照表里认', () => {
  assert.deepEqual(plain(hadOf([{ key: '9-11.txt' }], '11', nos)), ['9-11']);
  assert.deepEqual(plain(hadOf([{ key: '9-11.txt' }], '8', nos)), []);
});

test('白模管到勾的哪几镜：照名字里的镜头号认', () => {
  const picked = ['5', '6'];
  assert.deepEqual(plain(bmCover({ name: '镜头6-10_白模.mp4' }, picked, nos)), ['6']);
  assert.deepEqual(plain(bmCover({ name: '镜头1-5_白模.mp4' }, picked, nos)), ['5']);
  assert.deepEqual(plain(bmCover({ name: '镜头6_白模.mp4' }, picked, nos)), ['6']);
  assert.deepEqual(plain(bmCover({ name: '镜头5_白模_雾.mp4' }, ['5', '6'], nos)), ['5']);
});

test('管不到的、名字里认不出号的给空', () => {
  assert.deepEqual(plain(bmCover({ name: '镜头16-19_白模.mp4' }, ['5', '6'], nos)), []);
  assert.deepEqual(plain(bmCover({ name: '镜头1b_白模.mp4' }, ['1'], nos)), []);
  assert.deepEqual(plain(bmCover({ name: '空镜_白模.mp4' }, ['5'], nos)), []);
});
