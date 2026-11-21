'use strict';
/* 公用/写稿镜头表.js：写稿页右栏的镜头表，这一条拍的几镜标亮、色带宽窄照秒数、合计那几句 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const WS = require('../公用/写稿镜头表.js');

// 第3-4段那样：删过镜头10，号不挪
const LIST = [
  { 号: '1', 写什么: '炮兵打出末弹', 作用: '铺垫｜炮兵已在掏箱底，为镜4弹尽', 秒数: 4 },
  { 号: '2', 写什么: '末轮炮火炸翻敌群', 作用: '铺垫｜炮火还能压住敌人，为镜5沉寂', 秒数: 3 },
  { 号: '3', 写什么: '最后弹壳退膛', 作用: '铺垫｜一地弹壳显打得久', 秒数: 2 },
  { 号: '9', 写什么: '机枪全哑人人握刀', 作用: '反应｜枪声全停，接镜8', 秒数: 3 },
  { 号: '11', 写什么: '外星战士喊冲锋', 作用: '转折｜敌人看穿弹尽，接镜9', 秒数: 3 },
  { 号: '12', 写什么: '敌军扑向沙袋墙', 作用: '老写法的作用，没有标签' },
];
const on = v => v.rows.filter(r => r.me).map(r => r.no);

test('照镜头号起名的：标出拍的那几镜，说几镜几秒', () => {
  const v = WS.view(LIST, '1.txt', '1');
  assert.deepEqual(on(v), ['1']);
  assert.equal(v.say, '这一条拍 镜1 · 约 4 秒');
  assert.equal(v.all, '6 镜 · 约 15 秒（1 镜没估）');
  const w = WS.view(LIST, '1-3_改1.txt', '1-3');
  assert.deepEqual(on(w), ['1', '2', '3']);
  assert.equal(w.say, '这一条拍 镜1-3（3 镜） · 约 9 秒');
});

test('中间删过的号照表里的先后连着拍', () => {
  const v = WS.view(LIST, '9-12.txt', '9-12');
  assert.deepEqual(on(v), ['9', '11', '12']);
  assert.equal(v.say, '这一条拍 镜9-12（3 镜） · 约 6 秒（1 镜没估）');
});

test('老稿照名字里的数认；视频提示词_02 这种认不出', () => {
  assert.deepEqual(on(WS.view(LIST, '镜头2-3_视频提示词.txt', '')), ['2', '3']);
  const v = WS.view(LIST, '视频提示词_02.txt', '');
  assert.deepEqual(on(v), []);
  assert.equal(v.say, '这一条没照镜头号起名，标不出拍哪几镜');
});

test('名字里的号表里没有：说出来', () => {
  assert.equal(WS.view(LIST, '20.txt', '20').say, '这一条的镜头号在表里找不到：镜20');
  assert.equal(WS.view(LIST, '1、20.txt', '1、20').say, '这一条拍 镜1 · 约 4 秒；表里没有 镜20');
});

test('色带：一块一镜，宽窄照秒数（没估的按平均），颜色照标签', () => {
  const v = WS.view(LIST, '1.txt', '1');
  assert.equal(v.blocks.length, 6);
  assert.deepEqual(v.blocks.map(b => b.cls), ['pd', 'pd', 'pd', 'fy', 'zz', '']);
  assert.deepEqual(v.blocks.map(b => b.me), [true, false, false, false, false, false]);
  assert.ok(Math.abs(v.blocks.reduce((a, b) => a + b.flex, 0) - 100) < 0.1);
  assert.ok(v.blocks[0].flex > v.blocks[2].flex);   // 4 秒比 2 秒宽
});

test('每一行：写什么、作用、秒数；老数据的「拍什么」照认，没估的秒数给 0', () => {
  const v = WS.view([{ 拍什么: '老写法', 作用: '' }, null, { 写什么: '新', 秒数: 2.4 }], '1.txt', '1');
  assert.deepEqual(v.rows.map(r => [r.what, r.sec]), [['老写法', 0], ['新', 2]]);
});

test('没有镜头表：什么都不画', () => {
  for (const x of [[], null, undefined, 'x']) assert.deepEqual(WS.view(x, '1.txt', '1'), { rows: [], blocks: [], mine: [], say: '', all: '' });
});

/* 写稿页里加减镜头（2026-11-20）：勾了哪几镜 → 改成什么名字、加了哪几镜、去掉哪几镜、改完拍几镜几秒 */
const pl = (name, code, picked) => JSON.parse(JSON.stringify(WS.plan(LIST, name, code, picked)));

test('加一镜：名字照表里的先后连着写，说加了哪一镜、改完几镜几秒', () => {
  const p = pl('1-3.txt', '1-3', ['1', '2', '3', '9']);
  assert.deepEqual([p.to, p.add, p.drop, p.same], ['1-9.txt', ['9'], [], false]);   // 4 到 8 删了，3 和 9 在表里挨着
  assert.equal(p.say, '加 镜9');
  assert.equal(p.sum, '4 镜 · 约 12 秒');
});

test('去掉中间一镜：断开写；又加又去：两样都说', () => {
  const p = pl('1-3.txt', '1-3', ['3', '1']);
  assert.deepEqual([p.to, p.add, p.drop], ['1、3.txt', [], ['2']]);
  assert.equal(p.say, '去掉 镜2');
  assert.equal(p.sum, '2 镜 · 约 6 秒');
  const q = pl('1-3.txt', '1-3', ['2', '3', '9']);
  assert.deepEqual([q.to, q.pick], ['2-9.txt', ['2', '3', '9']]);
  assert.equal(q.say, '加 镜9，去掉 镜1');
});

test('勾的和原来一样：same；表里没有的号不算；没估秒数的照说', () => {
  const p = pl('1-3.txt', '1-3', ['3', '2', '1', '20']);
  assert.deepEqual([p.to, p.same, p.say], ['1-3.txt', true, '']);
  assert.equal(pl('9-12.txt', '9-12', ['9', '11', '12']).same, true);
  assert.equal(pl('11.txt', '11', ['11', '12']).sum, '2 镜 · 约 3 秒（1 镜没估）');
});

test('一镜都没勾：没有名字，说至少留一镜', () => {
  for (const x of [[], null, ['20']]) {
    const p = pl('1-3.txt', '1-3', x);
    assert.deepEqual([p.to, p.say, p.sum], ['', '一镜都没勾：至少留一镜', '']);
  }
});

test('带字母的号（9b、9c）照认', () => {
  const L = ['9', '9b', '9c', '9d', '9e', '10'].map(号 => ({ 号, 写什么: '镜' + 号, 秒数: 2 }));
  const p = JSON.parse(JSON.stringify(WS.plan(L, '9b-9d.txt', '9b-9d', ['9b', '9c', '9d', '9e'])));
  assert.deepEqual([p.to, p.add, p.drop], ['9b-9e.txt', ['9e'], []]);
  assert.equal(WS.plan(L, '9b-9d.txt', '9b-9d', ['9', '9b']).to, '9-9b.txt');
});

test('改过几版的：改完的名字带着它是第几版（1-3_改1.txt → 1-9_改1.txt），按钮上只写镜头号', () => {
  const p = pl('1-3_改1.txt', '1-3', ['1', '2', '3', '9']);
  assert.deepEqual([p.to, p.code, p.name], ['1-9.txt', '1-9', '1-9_改1.txt']);
  assert.equal(pl('1-3.txt', '1-3', ['1', '3']).name, '1、3.txt');
  assert.equal(pl('1_后半条.txt', '1', ['1', '2']).name, '1-2_后半条.txt');
  assert.equal(pl('1-3_改1.txt', '1-3', []).name, '');
});
