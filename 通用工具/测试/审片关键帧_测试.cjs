'use strict';
/* 公用/审片关键帧.js：审片台里正文没写秒数照登记的秒数排、一镜几张关键帧放到哪一秒摆哪一张（2026-11-16 加） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const F = require('../公用/审片关键帧.js');

const TEXT = [
  '【参考素材职责】',
  '以@图片3至@图片5的顺序作为关键帧。',
  '@图片3作为首帧。',
  '该首帧定义镜头1开场：机位在炮尾旁低处。',
  '@图片4定义第二个关键帧：第2秒硬切后的第一帧，主角那门炮的正侧面。',
  '@图片5作为尾帧。',
  '该尾帧定义镜头1结尾：炮口拖着硝烟。',
].join('\n');
const REFS = [
  { ref: '@图片1', name: '我军士兵' },
  { ref: '@图片5', name: '关键帧｜镜头1｜结尾' },
  { ref: '@图片3', name: '关键帧｜镜头1｜开头' },
  { ref: '@图片4', name: '关键帧｜镜头1｜中间' },
];
const shot = (no, a = null, b = null) => ({ no, a, b });

test('正文没写秒数：照登记的秒数一镜接一镜排', () => {
  const sh = [shot(1), shot(2)];
  assert.equal(F.fillSecs(sh, { 镜头: { 1: 4, 2: '2' } }), true);
  assert.deepEqual(sh.map(s => [s.a, s.b]), [[0, 4], [4, 6]]);
});

test('登记的秒数缺一镜、没登记、正文写过秒数：不动', () => {
  const a = [shot(1), shot(2)];
  assert.equal(F.fillSecs(a, { 镜头: { 1: 4 } }), false);
  assert.deepEqual(a.map(s => s.a), [null, null]);
  assert.equal(F.fillSecs([shot(1)], null), false);
  assert.equal(F.fillSecs([shot(1)], {}), false);
  const c = [shot(1, 0, 3)];
  assert.equal(F.fillSecs(c, { 镜头: { 1: 4 } }), false);
  assert.equal(c[0].b, 3);
});

test('一镜三张：开头、第2秒、结尾；放到哪一秒摆哪一张', () => {
  const [list] = F.framesOf([shot(1, 0, 4)], REFS, TEXT);
  assert.deepEqual(list.map(x => [x.ref, x.刻, x.t, x.from]), [['@图片3', '开头', 0, 0], ['@图片4', '中间', 2, 2], ['@图片5', '结尾', 4, 3]]);
  assert.equal(F.pick(list, 0).ref, '@图片3');
  assert.equal(F.pick(list, 1.9).ref, '@图片3');
  assert.equal(F.pick(list, 2).ref, '@图片4');
  assert.equal(F.pick(list, 2.9).ref, '@图片4');
  assert.equal(F.pick(list, 3).ref, '@图片5');
  assert.equal(F.pick(list, 4.06).ref, '@图片5');
  assert.equal(F.label(list[1]), '中间（第2秒）');
  assert.equal(F.label(list[2]), '结尾');
});

test('第二镜里的中间那张：写的秒数不在这一镜里就从这一镜开头数', () => {
  const text = '@图片2定义第二个关键帧：第1秒炮口喷火。';
  const [, b] = F.framesOf([shot(1, 0, 4), shot(2, 4, 7)], [{ ref: '@图片2', name: '关键帧｜镜头2｜中间' }, { ref: '@图片1', name: '关键帧｜镜头2｜开头' }], text);
  assert.deepEqual(b.map(x => [x.ref, x.t]), [['@图片1', 4], ['@图片2', 5]]);
});

test('中间没写秒数：匀着摆；只有开头结尾：结尾从这一镜一半起', () => {
  const [a] = F.framesOf([shot(1, 0, 6)], [{ ref: '@图片1', name: '关键帧｜镜头1｜中间' }, { ref: '@图片2', name: '关键帧｜镜头1｜中间' }], '');
  assert.deepEqual(a.map(x => x.t), [2, 4]);
  const [b] = F.framesOf([shot(1, 0, 4)], [{ ref: '@图片1', name: '关键帧｜镜头1｜开头' }, { ref: '@图片2', name: '关键帧｜镜头1｜结尾' }], '');
  assert.deepEqual(b.map(x => x.from), [0, 2]);
});

test('没秒数：按开头、中间、结尾排；摆钉住的那张，没钉摆头一张', () => {
  const [list] = F.framesOf([shot(1)], REFS, TEXT);
  assert.deepEqual(list.map(x => [x.ref, x.t, x.from]), [['@图片3', null, null], ['@图片4', null, null], ['@图片5', null, null]]);
  assert.equal(F.pick(list, null).ref, '@图片3');
  assert.equal(F.pick(list, null, '@图片5').ref, '@图片5');
  assert.equal(F.pick([], 1), null);
});

test('登记名认不出、镜头号对不上：不认', () => {
  const out = F.framesOf([shot(1, 0, 4)], [{ ref: '@图片3', name: '镜头1_首帧' }, { ref: '@图片4', name: '关键帧｜镜头9｜开头' }], TEXT);
  assert.deepEqual(out, [[]]);
});
