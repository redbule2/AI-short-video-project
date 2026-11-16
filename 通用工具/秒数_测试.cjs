'use strict';
/* 公用/秒数.js：AI 写稿时估的每镜秒数（读【秒数】、记下来、出片弹窗算合计） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const S = require('./公用/秒数.js');

const PROMPT = ['【生成目标】', '一碗面。', '', '【事件脚本】', '镜头1：远景。', '镜头2：近景，{老板！}', '镜头 03：中景。', '声音包括环境声。'].join('\n');

test('提示词里有哪几镜：「镜头N：」开头的行，去零、去重', () => {
  assert.deepEqual(S.shotsOf(PROMPT), [1, 2, 3]);
  assert.deepEqual(S.shotsOf('镜头1：a\n镜头1：b\n说镜头2：不算'), [1]);
  assert.deepEqual(S.shotsOf(''), []);
});

test('读【秒数】：一镜一行，小数四舍五入，不到 1 秒算 1；后面另起一块就停', () => {
  const reply = '【提示词】\n……\n【秒数】\n镜头1：2\n镜头 02: 4.6 秒\n镜头3：0.2\n【素材登记】\n镜头9：9';
  assert.deepEqual(S.parse(reply), { 1: 2, 2: 5, 3: 1 });
  assert.equal(S.parse('没有这一块'), null);
  assert.equal(S.parse('【秒数】\n还没写'), null);
});

test('JSON 改动清单后面接【秒数】：方括号不打架', () => {
  const reply = '[{"原文": "镜头1：远景。", "第几处": 1, "改成": "镜头1：近景。"}]\n【秒数】\n镜头1：3\n镜头2：5';
  const a = reply.indexOf('['), z = reply.lastIndexOf(']');
  assert.equal(JSON.parse(reply.slice(a, z + 1)).length, 1);
  assert.deepEqual(S.parse(reply), { 1: 3, 2: 5 });
});

test('记下来：只留提示词里有的镜，没估的列出来；合计、说法', () => {
  const { rec, missing } = S.make({ 1: 2, 2: 5, 9: 7 }, PROMPT, '2026-11-15 23:30:00');
  assert.deepEqual(rec.镜头, { 1: 2, 2: 5 });
  assert.deepEqual(missing, [3]);
  assert.equal(rec.时间, '2026-11-15 23:30:00');
  assert.equal(S.total(rec), 7);
  assert.equal(S.say(rec), '镜头1 2 秒、镜头2 5 秒，共 7 秒');
  assert.equal(S.make(null, PROMPT).rec, null);
});

test('对不对得上：没动过 fresh；换行不同不算改；改了字 changed；镜没估全 missing', () => {
  const { rec } = S.make({ 1: 2, 2: 5, 3: 3 }, PROMPT);
  assert.equal(S.state(rec, PROMPT).st, 'fresh');
  assert.equal(S.state(rec, '﻿' + PROMPT.replace(/\n/g, '\r\n') + '\r\n').st, 'fresh');
  assert.equal(S.state(rec, PROMPT.replace('远景', '大远景')).st, 'changed');
  const part = S.make({ 1: 2 }, PROMPT).rec;
  assert.deepEqual(S.state(part, PROMPT), { st: 'missing', lack: [2, 3] });
  assert.equal(S.state(null, PROMPT).st, 'none');
});

test('能填的时长：4 到 30 秒', () => {
  assert.deepEqual([2, 4, 17.6, 45].map(S.fit), [4, 4, 18, 30]);
  assert.ok(S.ASK.includes('【秒数】') && S.ASK_EG[0] === '【秒数】');
});
