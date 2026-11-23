'use strict';
/* 写稿页 AI 批注说的那一句在哪、AI 写的一行怎么换字（公用/写稿批注定位.js 里不碰页面的两样）。页面上全稿找、照改、撤回在 写稿编辑器_测试.html */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pick, cut } = require('../公用/写稿批注定位.js');

test('照先后找头一个有这句的；哪儿都没有给 null', () => {
  const texts = ['机位：中景。', '', '声音包括脚步声、钟声。', '声音包括脚步声、钟声。'];
  assert.deepEqual(pick(texts, '脚步声'), { i: 2, s: 4, e: 7 });
  assert.equal(pick(texts, '没有这句'), null);
  assert.equal(pick(texts, ''), null);
  assert.equal(pick([null, undefined, '有'], '有').i, 2);
});

test('撤回认原来那一处：同一句在一行里出现几回，at 对得上用 at，对不上照头一处', () => {
  assert.deepEqual(pick(['脚步声，脚步声'], '脚步声', 4), { i: 0, s: 4, e: 7 });
  assert.deepEqual(pick(['脚步声，脚步声'], '脚步声', 2), { i: 0, s: 0, e: 3 });
  assert.deepEqual(pick(['别处', '脚步声'], '脚步声', 0), { i: 1, s: 0, e: 3 });
});

test('AI 写的一行换字：带标签的照换；老稿保持一致开头的「保持一致：」不进这一行', () => {
  const full = '摄影：运镜又急又猛，紧跟冲锋的速度，带自然的晃动。', find = '紧跟冲锋的速度，', s = full.indexOf(find);
  assert.equal(cut(full, '', s, s + find.length, ''), '摄影：运镜又急又猛，带自然的晃动。');
  assert.equal(cut(full, '', 0, full.length, '摄影：运镜又急又猛。'), '摄影：运镜又急又猛。');
  assert.equal(cut('保持一致：光线不变', '保持一致：', 5, 9, '光线一直偏冷'), '光线一直偏冷');
  assert.equal(cut('保持一致：光线不变', '保持一致：', 0, 9, '光线一直偏冷'), '光线一直偏冷', '连「保持一致：」一起换掉的，换好的字照样放进这一行');
});
