'use strict';
/* 公用/音色.js 的测试：node --test 音色_测试.cjs */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const V = require('../公用/音色.js');

test('照文件名认人：叫法_音色.wav', () => {
  assert.equal(V.whoOf('童爸爸_音色.wav'), '童爸爸');
  assert.equal(V.whoOf('资产/全局资产/人物/童爸爸_音色.MP3'), '童爸爸');
  assert.equal(V.whoOf('资产\\全局资产\\人物\\童磊_音色.m4a'), '童磊');
  assert.equal(V.whoOf('胡立成_九品芝麻官_求食.wav'), '');   // 原始录音，不是哪个人物的音色
  assert.equal(V.whoOf('童爸爸_音色'), '童爸爸');   // 写稿页给的是不带后缀的名字
  assert.equal(V.whoOf('童爸爸_音色.png'), '');
  assert.equal(V.whoOf('_音色.wav'), '');
  assert.equal(V.whoOf(null), '');
});

test('一个人几种格式取 wav', () => {
  const m = V.mapOf(['童爸爸_音色.mp3', '童爸爸_音色.wav', '童爸爸_三十出头.png', '胡立成_赌侠_声线参考.wav']);
  assert.deepEqual([...m], [['童爸爸', '资产/全局资产/人物/童爸爸_音色.wav']]);
});

test('只给出场的、有音色的人', () => {
  const names = ['童爸爸_音色.wav', '童爸爸_三十出头.png', '童磊_6岁.png', '食客_卷毛.png'];
  assert.deepEqual(V.ofPeople(['食客', '童爸爸', '童磊', '童爸爸'], names), [{ 名: '童爸爸', path: '资产/全局资产/人物/童爸爸_音色.wav' }]);
  assert.deepEqual(V.ofPeople([], names), []);
  assert.deepEqual(V.ofPeople(['童爸爸'], []), []);
});

test('人物表里挑的、不用的、不在了的', () => {
  const D = '资产/全局资产/人物/', names = ['童爸爸_音色.wav', '胡立成_九品芝麻官_求食.wav', '童磊_音色.wav', '童磊_6岁.png'];
  const rows = [{ 名: '童爸爸', 音色: D + '胡立成_九品芝麻官_求食.wav' }, { 名: '童磊', 音色: '' }, { 名: '食客' }, { 名: '老李', 音色: D + '没有这段.wav' }];
  const t = V.tableOf(rows, names);
  assert.deepEqual(t.get('童爸爸'), { path: D + '胡立成_九品芝麻官_求食.wav', how: '挑的' });
  assert.deepEqual(t.get('童磊'), { path: '', how: '不用' });   // 有 童磊_音色.wav，可他说不用
  assert.deepEqual(t.get('食客'), { path: '', how: '' });
  assert.deepEqual(t.get('老李'), { path: '', how: '不在了', want: D + '没有这段.wav' });
  assert.deepEqual(V.ofPeople(['童磊', '童爸爸', '食客'], names, rows), [{ 名: '童爸爸', path: D + '胡立成_九品芝麻官_求食.wav' }]);
  assert.equal(V.ownerOf(D + '胡立成_九品芝麻官_求食.wav', rows, names), '童爸爸');
  assert.equal(V.ownerOf(D + '童爸爸_音色.wav', rows, names), '');   // 童爸爸挑了别的，这段不算谁的
  assert.equal(V.ownerOf(D + '童磊_音色.wav', rows, names), '');
});

test('挑过的那段，别人照文件名认不走；行里写的路径不对不算', () => {
  const D = '资产/全局资产/人物/', names = ['童爸爸_音色.wav', '童磊_音色.wav'];
  const rows = [{ 名: '童爸爸' }, { 名: '童磊', 音色: D + '童爸爸_音色.wav' }, { 名: '食客', 音色: '别处/童磊_音色.wav' }];
  const t = V.tableOf(rows, names);
  assert.deepEqual(t.get('童磊'), { path: D + '童爸爸_音色.wav', how: '挑的' });
  assert.deepEqual(t.get('童爸爸'), { path: '', how: '' });
  assert.equal(t.get('食客').how, '不在了');
  assert.equal(V.ownerOf(D + '童爸爸_音色.wav', rows, names), '童磊');
  assert.equal(V.ownerOf(D + '童磊_音色.wav', [{ 名: '童爸爸' }], names), '童磊');   // 人物表里没有童磊：照文件名
  assert.equal(V.ownerOf('资产/全局资产/人物/旧的/童磊_音色.wav', [], names), '');   // 不在人物文件夹本层
  assert.deepEqual(V.ofPeople(['童爸爸'], names), [{ 名: '童爸爸', path: D + '童爸爸_音色.wav' }]);   // 不给人物表：只照文件名
});

test('素材里那一句', () => {
  assert.equal(V.line('童爸爸', '@音频1'), '@音频1用于童爸爸的音色、口音、语速和情绪，台词以事件脚本为准。');
  assert.equal(V.line('', '@音频2'), '@音频2用于〔称谓〕的音色、口音、语速和情绪，台词以事件脚本为准。');
});

/* 旁白（11-17）：剧本有旁白就自动挂；画外音，不出镜、不出图 */
test('旁白：剧本里有一行「旁白：」开头的台词才算', () => {
  assert.equal(V.narrates('△ 雪山。\n旁白：江湖传闻……'), true);
  assert.equal(V.narrates('旁白（画外）：他十三岁便天下无敌'), true);
  assert.equal(V.narrates('　旁白:后来'), true);
  assert.equal(V.narrates('老李：旁白：不算'), false);   // 不在一行开头
  assert.equal(V.narrates('旁白是画外音'), false);
  assert.equal(V.narrates(''), false);
  assert.equal(V.narrates(null), false);
});

test('旁白的音色：人物表里没有这一行也照文件名认；别人挑走了、说了不用就没有', () => {
  const D = '资产/全局资产/人物/', names = ['旁白_音色.wav', '童爸爸_音色.wav'];
  assert.deepEqual(V.stateOf([], names, '旁白'), { path: D + '旁白_音色.wav', how: '文件名' });
  assert.deepEqual(V.stateOf([{ 名: '童爸爸', 音色: D + '旁白_音色.wav' }], names, '旁白'), { path: '', how: '' });
  assert.deepEqual(V.stateOf([{ 名: '旁白', 音色: '' }], names, '旁白'), { path: '', how: '不用' });
  assert.deepEqual(V.stateOf([{ 名: '旁白', 音色: D + '童爸爸_音色.wav' }], names, '旁白'), { path: D + '童爸爸_音色.wav', how: '挑的' });
  assert.deepEqual(V.ofPeople(['旁白'], names), [{ 名: '旁白', path: D + '旁白_音色.wav' }]);
  assert.deepEqual(V.ofPeople(['旁白'], names, [{ 名: '童爸爸', 音色: D + '旁白_音色.wav' }]), []);
});

test('旁白那一句、写提示词时交代的几句', () => {
  assert.equal(V.line('旁白', '@音频2'), '@音频2用于画外旁白的音色、口音、语速和情绪，台词以事件脚本为准。');
  const a = V.narrRule('资产\\全局资产\\人物\\旁白_音色.wav', false), b = V.narrRule('资产/全局资产/人物/旁白_音色.wav', true);
  assert.ok(a.includes('挂成 @音频1') && a.includes('"ref": "@音频1"') && a.includes('"path": "资产/全局资产/人物/旁白_音色.wav"') && a.includes('「旁白：{台词}」') && a.includes('画面里的人自然闭口'), a);
  assert.ok(b.includes('和人物的音色接着编号') && b.includes('"ref": "@音频N"') && b.includes('@音频N用于画外旁白'), b);
});
