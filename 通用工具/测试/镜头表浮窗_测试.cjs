'use strict';
/* 流水线/镜头表浮窗.js：左边空得下就摆、空不下先收着、点开过就盖在正文上、收起过就一直收着 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const SF = require('../流水线/镜头表浮窗.js');

test('左边空得下：摆在空白里，宽 200～300', () => {
  assert.deepEqual(SF.layout(460, '', 1920), { mode: 'dock', width: 300 });
  assert.deepEqual(SF.layout(260, '', 1440), { mode: 'dock', width: 228 });
  assert.deepEqual(SF.layout(232, 'on', 1400), { mode: 'dock', width: 200 });
});

test('空不下：没动过先收着，点开过就盖在正文上', () => {
  assert.deepEqual(SF.layout(231, '', 1400), { mode: 'tab', width: 0 });
  assert.deepEqual(SF.layout(40, 'on', 1100), { mode: 'float', width: 300 });
  assert.deepEqual(SF.layout(0, 'on', 280), { mode: 'float', width: 248 });
  assert.deepEqual(SF.layout(0, 'on', 100), { mode: 'float', width: 160 });
});

test('收起过：多宽的窗口都收着', () => {
  assert.deepEqual(SF.layout(460, 'off', 1920), { mode: 'tab', width: 0 });
  assert.deepEqual(SF.layout(0, 'off', 800), { mode: 'tab', width: 0 });
});
