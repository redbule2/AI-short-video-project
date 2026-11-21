'use strict';
/* 公用/审片镜头表.js：审片台右栏的镜头表，放到第几秒标在镜头表哪一镜（nowOf） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const DS = require('../公用/审片镜头表.js');

// 删过镜头10，号不挪；镜头12 没估秒数
const LIST = [
  { 号: '1', 写什么: '炮兵打出末弹', 作用: '铺垫｜炮兵已在掏箱底，为镜4弹尽', 秒数: 4 },
  { 号: '2', 写什么: '末轮炮火炸翻敌群', 作用: '铺垫｜炮火还能压住敌人，为镜5沉寂', 秒数: 3 },
  { 号: '3', 写什么: '最后弹壳退膛', 作用: '铺垫｜一地弹壳显打得久', 秒数: 2 },
  { 号: '9', 写什么: '机枪全哑人人握刀', 作用: '反应｜枪声全停，接镜8', 秒数: 3 },
  { 号: '11', 写什么: '外星战士喊冲锋', 作用: '转折｜敌人看穿弹尽，接镜9', 秒数: 3 },
  { 号: '12', 写什么: '敌军扑向沙袋墙', 作用: '老写法的作用，没有标签' },
];
const at = (name, code, t, more) => DS.nowOf(Object.assign({ list: LIST, name, code, t, dur: 0, cuts: null }, more));

test('只拍一镜：放到哪都是它', () => {
  assert.deepEqual(at('1.txt', '1', 0), { no: '1', sure: true });
  assert.deepEqual(at('1_改3.txt', '1', 14.5, { dur: 15, cuts: [[0, 4], [4, 9], [9, 15]] }), { no: '1', sure: true });
});

test('提示词分的镜头和拍的几镜一样多：一镜对一镜，照提示词的秒数', () => {
  const cuts = [[0, 5], [5, 7], [7, 15]];
  assert.deepEqual(at('1-3.txt', '1-3', 0, { cuts }), { no: '1', sure: true });
  assert.deepEqual(at('1-3.txt', '1-3', 6.9, { cuts }), { no: '2', sure: true });
  assert.deepEqual(at('1-3.txt', '1-3', 7, { cuts }), { no: '3', sure: true });
  assert.deepEqual(at('9、11.txt', '9、11', 4, { cuts: [[0, 3], [3, 6]] }), { no: '11', sure: true });
});

test('对不上的照镜头表的秒数一镜接一镜排，样片长短不一样按比例伸缩', () => {
  // 1-3 估 4+3+2=9 秒，样片 18 秒：每一镜拉长一倍，0-8 秒镜1、8-14 秒镜2、14-18 秒镜3
  const a = { dur: 18, cuts: [[0, 9], [9, 18]] };
  assert.deepEqual(at('1-3.txt', '1-3', 7.9, a), { no: '1', sure: false });
  assert.deepEqual(at('1-3.txt', '1-3', 8, a), { no: '2', sure: false });
  assert.deepEqual(at('1-3.txt', '1-3', 15, a), { no: '3', sure: false });
  assert.deepEqual(at('1-3.txt', '1-3', 30, a), { no: '3', sure: false }, '放过头了算最后一镜');
  assert.deepEqual(at('1-3.txt', '1-3', 4.5, { dur: 0 }), { no: '2', sure: false }, '不知道样片多长：照估的秒数排');
});

test('中间删过的号照表里的先后排；有一镜没估秒数就排不出', () => {
  assert.deepEqual(at('3-11.txt', '3-11', 2.5), { no: '9', sure: false });
  assert.equal(at('9-12.txt', '9-12', 1), null);
});

test('认不出拍哪几镜、没有镜头表：不标', () => {
  assert.equal(at('视频提示词_02.txt', '', 3), null);
  assert.equal(at('20-21.txt', '20-21', 3), null);
  assert.equal(DS.nowOf({ list: [], name: '1.txt', code: '1', t: 0 }), null);
});
