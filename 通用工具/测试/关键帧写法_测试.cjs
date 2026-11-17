'use strict';
/* 公用/关键帧写法.js 里往素材那一组放句子（提示词那一步、本机服务照方案改共用，2026-11-15 并成一份） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const KF = require('../公用/关键帧写法.js');

test('关键帧句子：写法一放【参考素材职责】最前面，写法二放【场景】最前面', () => {
  assert.deepEqual(KF.put(['【参考素材职责】', '@图片1是老李。', '', '【事件脚本】'], ['@图片2作为首帧。']),
    ['【参考素材职责】', '@图片2作为首帧。', '@图片1是老李。', '', '【事件脚本】']);
  assert.deepEqual(KF.put(['【人物】', '甲', '【场景】', '乙'], ['K']), ['【人物】', '甲', '【场景】', 'K', '乙']);
});

test('没有那一组：补上组名，放在后面几组前头', () => {
  assert.deepEqual(KF.put(['【生成目标】', '目标', '', '【事件脚本】', '镜头1'], ['K']), ['【生成目标】', '目标', '', '【参考素材职责】', 'K', '', '【事件脚本】', '镜头1']);
  assert.deepEqual(KF.put(['【人物】', '甲'], ['K']), ['【人物】', '甲', '【场景】', 'K', '']);
  const L = ['x'];
  assert.equal(KF.put(L, []), L);   // 没句子：原样
});

test('白模句子：放这一组最后（写法二进【动作与声音】）', () => {
  assert.deepEqual(KF.putRef(['【参考素材职责】', 'a', 'b', '', '【事件脚本】'], ['W']), ['【参考素材职责】', 'a', 'b', 'W', '', '【事件脚本】']);
  assert.deepEqual(KF.putRef(['【人物】', '甲', '【动作与声音】', '动', '【保持一致】'], ['W']), ['【人物】', '甲', '【动作与声音】', '动', 'W', '【保持一致】']);
});

test('组名认法、空组', () => {
  assert.ok(KF.isHead(' 【场 景】 ') && KF.isHead('\uFEFF【生成目标】') && !KF.isHead('【场景】里'));
  assert.equal(KF.headKey(null), '');
  const L = ['【参考素材职责】', '', '【场景】', '句子', '【事件脚本】'];
  assert.deepEqual([0, 2, 4].map(i => KF.groupEmpty(L, i)), [true, false, true]);   // 第 i 行是组名：底下有没有句子
  assert.equal(KF.HOLE, '〔原来的关键帧去掉了，改写这一处〕');
});

test('绑了镜头的关键帧：〔〕里写明是哪一镜哪一刻（ph）', () => {
  assert.deepEqual(KF.lines([{ ref: '@图片6', name: '镜头11_首帧', desc: '〔旧的空〕', ph: '〔镜头11「喊冲锋」开头：这一刻〕' }]), ['@图片6作为首帧。', '该首帧定义〔镜头11「喊冲锋」开头：这一刻〕。']);
  assert.deepEqual(KF.lines([{ ref: '@图片6', name: 'a', desc: '填过的' , ph: '〔x〕' }]), ['@图片6作为首帧。', '该首帧定义填过的。']);
});
