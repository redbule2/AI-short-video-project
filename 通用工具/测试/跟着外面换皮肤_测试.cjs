'use strict';
/* 公用/跟着外面换皮肤.js：嵌在流水线里的页面（写稿页、看文件的那一页）照外面那一页的皮肤写 data-skin；纸面的皮肤整页取纸上那一档 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Follow = require('../公用/跟着外面换皮肤.js');

/* 一个假的 document：只要 documentElement（dataset、style）、getElementById、head */
function doc(skin, paper) {
  const el = { dataset: skin ? { skin } : {}, style: { colorScheme: '' } };
  return { documentElement: el, head: {}, getElementById: id => (id === 'desk-paper' && paper ? {} : null) };
}

test('照外面那一页：有皮肤写上、没有（宣纸）拿掉；纸面的整页取亮的那一档', () => {
  assert.deepEqual(Follow.read(doc('墨夜', false)), { skin: '墨夜', paper: false });
  assert.deepEqual(Follow.read(doc('校样台', true)), { skin: '校样台', paper: true });
  assert.deepEqual(Follow.read(doc('', true)), { skin: '', paper: false });   // 宣纸：纸面那一段就算挂着也不管
  const me = doc('墨夜', false);
  Follow.paint(me, { skin: '校样台', paper: true });
  assert.equal(me.documentElement.dataset.skin, '校样台');
  assert.equal(me.documentElement.style.colorScheme, 'light');
  Follow.paint(me, { skin: '', paper: false });
  assert.equal('skin' in me.documentElement.dataset, false);
  assert.equal(me.documentElement.style.colorScheme, '');
});

test('不是嵌着的、外面读不了（别的网站）：什么也不做', () => {
  const self = { document: doc('', false) };
  self.parent = self;
  assert.equal(Follow.watch(self), false);
  const blocked = { document: doc('', false), get parent() { return { get document() { throw new Error('跨网站'); } }; } };
  assert.equal(Follow.watch(blocked), false);
  assert.equal('skin' in blocked.document.documentElement.dataset, false);
});

test('嵌着的：马上照外面写上；外面换了皮肤跟着换', () => {
  const up = doc('墨夜', false), obs = [];
  const win = { document: doc('', false), parent: { document: up }, MutationObserver: class { constructor(fn) { this.fn = fn; obs.push(this); } observe() {} } };
  assert.equal(Follow.watch(win), true);
  assert.equal(win.document.documentElement.dataset.skin, '墨夜');
  up.documentElement.dataset.skin = '青瓷';
  obs[0].fn();
  assert.equal(win.document.documentElement.dataset.skin, '青瓷');
});
