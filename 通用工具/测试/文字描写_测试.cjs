'use strict';
/* 公用/文字描写.js 的测试：node 通用工具/测试/文字描写_测试.cjs
   只用文字写、不出图的资产（11-17）：字和出图的放一处（名字_提示词.txt），「用途：」写明只用文字；写视频提示词照它写 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const T = require('../公用/文字描写.js');
const Core = require('../公用/核心.js');

test('用途那一句写明只用文字，认得出来', () => {
  const u = T.purpose('人物', ' 洪七公 ', '');
  assert.equal(u, '人物「洪七公」只用文字，不出图：写视频提示词照这份字写');
  assert.equal(T.purpose('道具', '面车', '夜里'), '道具「面车」（夜里）只用文字，不出图：写视频提示词照这份字写');
  assert.equal(T.isTxt(['用途：' + u, '要撑住：……']), true);
  assert.equal(T.isTxt('\uFEFF图1：x\r\n用途：' + u + '\r\n提示词\r\n正文'), true);
  assert.equal(T.isTxt(['用途：人物「洪七公」的定妆图，各段照它的样子']), false);
  assert.equal(T.isTxt('用途：人物「洪七公」的定妆图\n提示词\n用途：只用文字'), false);   // 正文里的不算
  assert.equal(T.isTxt(''), false);
  assert.equal(T.isTxt(null), false);
});

test('正文：单独一行「提示词」下面的；没有这一行就是整份', () => {
  assert.equal(T.bodyOf('\uFEFF用途：x\r\n要撑住：y\r\n提示词\r\n第一段\r\n\r\n第二段\r\n'), '第一段\n\n第二段');
  assert.equal(T.bodyOf('  只有正文  '), '只有正文');
  assert.equal(T.bodyOf(null), '');
});

test('这一场只用文字的几样：没挂图、标了不出图的；旁白不算；挂了图的不算', () => {
  const flow = { 人物: [{ 名: '洪七公', 描写: '老乞丐' }, { 名: '童大圣', 描写: '小乞丐', 资产: ['资产/人物和道具/童大圣.png'] }, { 名: '旁白', 描写: '' }], 道具: [{ 名: '竹棍', 描写: '' }] };
  const s = { 人物: ['洪七公', '童大圣', '旁白', '张三丰'], 道具: ['竹棍', '烤鸡'], 场景文字: ['破庙：山里一座破庙', '雪山：大雪山', '  '],
    不出图: { 人物: ['洪七公', '童大圣', '旁白', '张三丰'], 道具: ['竹棍'], 场景: ['破庙'] } };
  const got = T.itemsOf(flow, s, { noImg: Core.noImg, sceneStem: Core.sceneStem, skip: n => n === '旁白' });
  assert.deepEqual(got.map(x => x.类别 + '/' + x.名称), ['人物/洪七公', '人物/张三丰', '道具/竹棍', '场景/破庙']);
  assert.deepEqual(got[0], { 类别: '人物', 名称: '洪七公', 描写: '老乞丐', rel: ['提示词', '全局资产', '人物', '洪七公_提示词.txt'] });
  assert.equal(got[1].描写, '');   // 人物表里没有这一行
  assert.deepEqual(got[3], { 类别: '场景', 名称: '破庙', 描写: '破庙：山里一座破庙', rel: ['提示词', '全局资产', '场景', '破庙_提示词.txt'] });
  assert.deepEqual(T.itemsOf(null, null, { noImg: Core.noImg, sceneStem: Core.sceneStem }), []);
});

test('写视频提示词那一节：有字照字，没写的照全片设定', () => {
  assert.equal(T.promptPart([]), '');
  assert.equal(T.promptPart(null), '');
  const p = T.promptPart([{ 类别: '人物', 名称: '洪七公', 描写: '老乞丐', 字: '七十来岁，精瘦，白发蓬乱。' }, { 类别: '道具', 名称: '竹棍', 描写: '', 字: '' }]);
  assert.equal(p, '## 只用文字的资产（不挂图，照这几段字写）\n- 人物「洪七公」：七十来岁，精瘦，白发蓬乱。\n- 道具「竹棍」：（还没写文字描写，照全片设定：没写）');
  assert.ok(T.PROMPT_RULE.includes('【主体与关系】'));
  assert.deepEqual(Object.keys(T.RULE), ['人物', '道具', '场景']);
  assert.ok(T.ASK.includes('文字描写') && T.ASK.includes('不写 GEO'));
});
