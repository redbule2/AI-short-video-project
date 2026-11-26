'use strict';
// node --test 通用工具/测试/初步剧本页_测试.cjs
// 写初步剧本的那一页（公用/写稿自由稿.js，2026-11-26）：认哪份稿、人物小牌子上摆谁、字数怎么数。只在内存里跑，不开页面。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../公用/核心.js');

const src = fs.readFileSync(path.join(__dirname, '..', '公用', '写稿自由稿.js'), 'utf8');
function load(more = {}) {   // 页面里的几样全局：STEM（打开的是哪一份）、FLOW_ALL（流水线.json，全片人物表在里面）
  const ctx = { window: {}, Core, ...more };
  vm.runInNewContext(src, ctx);
  return ctx.window.FreeDraft;
}

test('认哪份稿：初步剧本.txt、老段的 自由稿.txt 是；视频提示词不是', () => {
  assert.equal(load({ STEM: '初步剧本' }).is(), true);
  assert.equal(load({ STEM: '自由稿' }).is(), true);
  for (const s of ['1-2', '视频提示词', '初步剧本_写稿']) assert.equal(load({ STEM: s }).is(), false, s);
  assert.equal(load().is(), false, '还没打开稿');
});

test('人物小牌子：这份稿里说过话的在前（说得多的更前），再接全片人物表；重名只摆一个', () => {
  const FD = load({ STEM: '初步剧本', FLOW_ALL: { 人物: [{ 名: '小磊' }, { 名: '老周' }, { 名: '' }, null] } });
  const text = '面馆门口，傍晚。\n老周：“饿了吧？”\n小男孩：“嗯。”\n　老周：“吃吧，不要钱。”\n地点：面馆\n旁边有人说：好香';
  assert.deepEqual(Array.from(FD.names(text)), ['老周', '小男孩', '小磊']);
  assert.deepEqual(Array.from(FD.names('')), ['小磊', '老周'], '还没写：只摆人物表里的');
  assert.deepEqual(Array.from(load({ STEM: '初步剧本' }).names('甲：“走”')), ['甲'], '没读到人物表也照样摆');
});

test('人物小牌子最多十个', () => {
  const text = Array.from({ length: 14 }, (_, i) => '人' + i + '：“话”').join('\n');
  assert.equal(load({ STEM: '初步剧本' }).names(text).length, 10);
});

test('字数：空格、换行不算', () => {
  const FD = load({ STEM: '初步剧本' });
  assert.equal(FD.countOf('老周：“吃吧。”\n\n  小男孩　埋头吃。\t'), 15);   // 老周：“吃吧。” 8 个，小男孩埋头吃。 7 个
  assert.equal(FD.countOf(''), 0);
});

test('空稿的提示：照这一页写的，告诉人写什么，不提「提示词」', () => {
  const { HINT } = load({ STEM: '初步剧本' });
  assert.ok(HINT.includes('想到哪写到哪') && HINT.includes('在哪、谁、做什么、说什么'));
  assert.ok(!/提示词/.test(HINT));
});
