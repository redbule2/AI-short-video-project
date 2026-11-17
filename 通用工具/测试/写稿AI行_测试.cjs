'use strict';
/* 公用/写稿AI行.js：写稿页 AI 写的那几区能直接改（11-16），批注跟着改过的原文走 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const L = require('../公用/写稿AI行.js');

const blk = (text, hk) => ({ text, dataset: hk ? { hk } : {} });
const fullOf = b => b.text;

test('照 GEO 放的行：总场景、分场景、轴线开头的标签', () => {
  assert.equal(L.isGeo('总场景'), true);
  assert.equal(L.isGeo('分场景2'), true);
  assert.equal(L.isGeo('轴线'), true);
  assert.equal(L.isGeo('人物'), false);
  assert.equal(L.isGeo(''), false);
  assert.equal(L.isGeo(undefined), false);
});

test('能写批注的：AI 写的、有字的行', () => {
  assert.equal(L.notable(true, '画面偏冷'), true);
  assert.equal(L.notable(true, '  '), false);
  assert.equal(L.notable(false, '画面偏冷'), false);
  assert.equal(L.notable(true, '人物：李云龙@图片1〔这一刻在做什么〕'), true);   // 带〔〕的也能批（以前只能填不能批）
});

test('批注挪到改后的原文上；改成和别的有批注的一样就接在后面', () => {
  const by = new Map([['甲', '太长'], ['乙', '换人']]);
  assert.equal(L.moveNote(by, '甲', '甲改'), 'moved');
  assert.deepEqual([...by], [['乙', '换人'], ['甲改', '太长']]);
  assert.equal(L.moveNote(by, '甲改', '乙'), 'merged');
  assert.deepEqual([...by], [['乙', '换人；太长']]);
  assert.equal(L.moveNote(by, '没有', '丙'), '');
  assert.equal(L.moveNote(by, '乙', '乙'), '');
  assert.equal(L.moveNote(by, '乙', ''), '');
  assert.deepEqual([...by], [['乙', '换人；太长']]);
});

test('改了一行：批注跟着走，那一行记的原文也换成新的', () => {
  const by = new Map([['画面偏冷', '再暗一点']]);
  const a = blk('画面偏冷，夜里', '画面偏冷'), b = blk('别的行');
  assert.equal(L.rekey([a, b], by, fullOf), 1);
  assert.deepEqual([...by], [['画面偏冷，夜里', '再暗一点']]);
  assert.equal(a.dataset.hk, '画面偏冷，夜里');
  assert.equal(L.rekey([a, b], by, fullOf), 0);   // 没再改：不动
});

test('删空了还没删行：批注先留着，接着打字还跟着走', () => {
  const by = new Map([['画面偏冷', '再暗一点']]);
  const a = blk('', '画面偏冷');
  assert.equal(L.rekey([a], by, fullOf), 0);
  assert.deepEqual([...by], [['画面偏冷', '再暗一点']]);
  a.text = '画面偏暖';
  assert.equal(L.rekey([a], by, fullOf), 1);
  assert.deepEqual([...by], [['画面偏暖', '再暗一点']]);
});

test('那一行删掉了：批注跟着去掉；别的行的批注不动', () => {
  const by = new Map([['甲', '太长'], ['乙', '换人']]);
  const b = blk('乙', '乙');
  assert.equal(L.rekey([b], by, fullOf), 1);
  assert.deepEqual([...by], [['乙', '换人']]);
});

test('还没记原文的行（刚读进来、还没摆批注）：原文对得上的批注照旧留着', () => {
  const by = new Map([['甲', '太长']]);
  assert.equal(L.rekey([blk('甲'), blk('乙')], by, fullOf), 0);
  assert.deepEqual([...by], [['甲', '太长']]);
});

test('两行一样、只改了其中一行：批注跟着改的那一行走', () => {
  const by = new Map([['同一句', '删掉']]);
  const a = blk('同一句改了', '同一句'), b = blk('同一句', '同一句');
  L.rekey([a, b], by, fullOf);
  assert.deepEqual([...by], [['同一句改了', '删掉']]);
  assert.equal(a.dataset.hk, '同一句改了');
});
