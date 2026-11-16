'use strict';
/* 公用/素材编号.js 的测试：node --test 素材编号_测试.cjs */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const R = require('../公用/素材编号.js');
const B = require('../公用/白模关键帧写法.js');

/* 3-4 镜头1-5 的样子：白模＋关键帧，五张首帧 @图片6～10，镜头4 那张（@图片9）在写稿页里删了 */
const regs = [
  ['@视频1', '资产/第3-4段/镜头1-5_白模.mp4'],
  ['@图片1', '资产/全局资产/人物/我军士兵.png'], ['@图片2', '资产/全局资产/人物/外星战士.png'], ['@图片3', '资产/全局资产/道具/榴弹炮.png'],
  ['@图片4', '资产/全局资产/道具/飞碟.png'], ['@图片5', '资产/全局资产/特效/重炮单发爆炸.png'],
  ['@图片6', '资产/第3-4段/镜头1_首帧.png'], ['@图片7', '资产/第3-4段/镜头2_首帧.png'], ['@图片8', '资产/第3-4段/镜头3_首帧.png'],
  ['@图片9', '资产/第3-4段/镜头4_首帧.png'], ['@图片10', '资产/第3-4段/镜头5_首帧.png'],
  ['@图片11', '资产/第3-4段/镜头1_空镜.png'], ['@图片12', '资产/第3-4段/镜头5_空镜.png'], ['@图片13', '资产/全局资产/道具/大砍刀.png'],
].map(([ref, path]) => ({ ref, path }));
const text = [
  '【人物】', '我军士兵对应@图片1。', '外星战士对应@图片2。', '装填手长相照@图片6里的两人。', '',
  '【道具】', '榴弹炮对应@图片3。', '飞碟对应@图片4。', '炸点对应@图片5。', '大砍刀对应@图片13。', '',
  '【场景】', '@图片6至@图片10是各镜头的关键帧，分别约束对应那一镜的构图、人物造型、环境和色彩；每一镜参考哪一张，写在事件脚本那一镜的开头。',
  '@图片11：主角那门榴弹炮。', '@图片12：从炮阵西边朝东看。', '开场站位照@图片6。', '',
  '【动作与声音】', '以@视频1作为整支视频唯一的运镜、镜头节奏、景别变化、主体运动轨迹和镜头调度参考，严格保持@视频1的镜头顺序、切点、机位变化、运动方式和节奏，不改变镜头结构，不新增镜头。',
  '所有画面照对应的关键帧；@视频1只作运镜、镜头运动和动作参考，不采用它的灰模外观、材质和空白背景。', '',
  '【事件脚本】',
  '镜头1：0-4秒，首帧参考@图片6。中景。', '镜头2：4-6秒，开场参考@图片7。开场照@图片7。', '镜头3：6-8秒，开场参考@图片8。开场照@图片8。',
  '镜头4：8-12秒。全景。', '镜头5：12-15秒，开场参考@图片10。开场照@图片10。', '',
].join('\r\n');

test('写稿页删了 @图片9：去掉它，@图片10～13 往前挪一号，范围句跟着变', () => {
  const p = R.plan(text, regs);
  assert.equal(p.blocked, '');
  assert.deepEqual([...p.moves], [['@图片10', '@图片9'], ['@图片11', '@图片10'], ['@图片12', '@图片11'], ['@图片13', '@图片12']]);
  assert.deepEqual(p.dropped, [{ ref: '@图片9', path: '资产/第3-4段/镜头4_首帧.png' }]);
  const t2 = R.apply(text, p), L = t2.split('\r\n');
  assert.ok(L.includes('@图片6至@图片9是各镜头的关键帧，分别约束对应那一镜的构图、人物造型、环境和色彩；每一镜参考哪一张，写在事件脚本那一镜的开头。'));
  assert.ok(L.includes('大砍刀对应@图片12。') && L.includes('@图片10：主角那门榴弹炮。') && L.includes('@图片11：从炮阵西边朝东看。'));
  assert.ok(L.includes('镜头5：12-15秒，开场参考@图片9。开场照@图片9。'));
  assert.ok(L.includes('我军士兵对应@图片1。') && L.includes('镜头1：0-4秒，首帧参考@图片6。中景。'));
  assert.equal(t2.replace(/@图片\d+/g, ''), text.replace(/@图片\d+/g, ''));   // 编号以外一个字不动
  assert.ok(t2.includes('\r\n') && !/[^\r]\n/.test(t2));
  assert.deepEqual(R.usedOf(t2).图片, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.ok(B.isBmk(t2));
  assert.deepEqual(B.check(B.shots(t2), 15, []), []);
  assert.equal(R.plan(t2, R.regs(regs, p)).moves.size, 0);   // 挪完再算：不用挪了
});

test('登记跟着挪：映射里的换编号、去掉空号；挂图只放挪过的，和映射对得上', () => {
  const p = R.plan(text, regs), r2 = R.regs(regs, p);
  const at = ref => (r2.find(r => r.ref === ref) || {}).path;
  assert.equal(r2.length, 13);
  assert.equal(at('@图片9'), '资产/第3-4段/镜头5_首帧.png');
  assert.equal(at('@图片10'), '资产/第3-4段/镜头1_空镜.png');
  assert.equal(at('@图片12'), '资产/全局资产/道具/大砍刀.png');
  assert.equal(at('@图片13'), undefined);
  assert.equal(at('@图片8'), '资产/第3-4段/镜头3_首帧.png');
  assert.equal(at('@视频1'), '资产/第3-4段/镜头1-5_白模.mp4');
  const h = R.hang({}, p, regs);
  assert.deepEqual(h, { '@图片9': '资产/第3-4段/镜头5_首帧.png', '@图片10': '资产/第3-4段/镜头1_空镜.png', '@图片11': '资产/第3-4段/镜头5_空镜.png', '@图片12': '资产/全局资产/道具/大砍刀.png' });
  for (const [ref, file] of Object.entries(h)) assert.equal(at(ref), file);
});

test('挂图里原来就有的：空号上的去掉，挪过的换编号，别的照旧', () => {
  const rg = [{ ref: '@图片1', path: 'a.png' }, { ref: '@图片2', path: 'b.png' }, { ref: '@图片3', path: 'c.png' }, { ref: '@图片5', path: 'e.png' }];
  const hg = { '@图片2': 'b.png', '@图片3': 'c.png', '@图片5': 'e.png', '@视频1': 'v.mp4' };
  const p = R.plan('@图片1、@图片3、@图片5 和 @视频1', [...rg, ...Object.entries(hg).map(([ref, path]) => ({ ref, path }))]);
  assert.deepEqual([...p.moves], [['@图片3', '@图片2'], ['@图片5', '@图片3']]);
  assert.deepEqual(p.dropped.map(r => r.ref), ['@图片2']);
  assert.deepEqual(R.hang(hg, p, rg), { '@视频1': 'v.mp4', '@图片2': 'c.png', '@图片3': 'e.png' });
  assert.equal(R.apply('@图片1、@图片3、@图片5 和 @视频1', p), '@图片1、@图片2、@图片3 和 @视频1');
});

test('去掉的是第一张、中间两张：照样连着排', () => {
  const rg = [1, 2, 3, 4, 5, 6, 7].map(n => ({ ref: '@图片' + n, path: n + '.png' }));
  const p = R.plan('@图片2 @图片4 @图片5 @图片7', rg);
  assert.deepEqual([...p.moves], [['@图片2', '@图片1'], ['@图片4', '@图片2'], ['@图片5', '@图片3'], ['@图片7', '@图片4']]);
  assert.deepEqual(p.dropped.map(r => r.ref), ['@图片1', '@图片3', '@图片6']);
  assert.equal(R.apply('@图片2 @图片4 @图片5 @图片7', p), '@图片1 @图片2 @图片3 @图片4');
  assert.deepEqual(R.regs(rg, p).map(r => r.ref + '=' + r.path), ['@图片1=2.png', '@图片2=4.png', '@图片3=5.png', '@图片4=7.png']);
});

test('@图片1 和 @图片13 分得清；最后一张不写了不算空号', () => {
  const rg = [1, 2, 3].map(n => ({ ref: '@图片' + n, path: n + '.png' }));
  assert.equal(R.plan('@图片1、@图片2', rg).moves.size, 0);
  const p = R.plan('@图片1、@图片13', [...rg, { ref: '@图片13', path: '13.png' }]);
  assert.deepEqual([...p.moves], [['@图片13', '@图片2']]);
  assert.equal(R.apply('@图片1、@图片13。@图片13', p), '@图片1、@图片2。@图片2');
});

test('挪不了的：挪的号没登记、白模没写、两处登记对不上', () => {
  assert.match(R.plan('@图片1 @图片3', [{ ref: '@图片1', path: 'a.png' }]).blocked, /@图片3.*没登记/);
  assert.match(R.plan('@视频2', [{ ref: '@视频1', path: 'bm.mp4' }, { ref: '@视频2', path: 'b2.mp4' }]).blocked, /白模 @视频1/);
  assert.match(R.plan('@图片2', [{ ref: '@图片1', path: 'a.png' }, { ref: '@图片2', path: 'b.png' }, { ref: '@图片2', path: 'c.png' }]).blocked, /@图片2.*不是同一个文件/);
  assert.equal(R.plan('@图片1 @图片2', [{ ref: '@图片2', path: 'b.png' }, { ref: '@图片2', path: 'c.png' }]).blocked, '');   // 编号连着的不管登记（交给本机服务）
  const p = R.plan('@视频2', [{ ref: '@视频2', path: 'b2.mp4' }]);   // 白模空号上没登记：照样往前挪
  assert.deepEqual([...p.moves], [['@视频2', '@视频1']]);
});

test('只管 @图片：视频的空号、视频登记对不上都不碍事', () => {
  const rg = [{ ref: '@图片1', path: 'a.png' }, { ref: '@图片2', path: 'b.png' }, { ref: '@图片3', path: 'c.png' }, { ref: '@视频1', path: 'v.mp4' }, { ref: '@视频1', path: 'w.mp4' }, { ref: '@视频2', path: 'x.mp4' }];
  const p = R.plan('@图片1 @图片3 @视频2', rg, ['图片']);
  assert.equal(p.blocked, '');
  assert.deepEqual([...p.moves], [['@图片3', '@图片2']]);
  assert.equal(R.apply('@图片1 @图片3 @视频2', p), '@图片1 @图片2 @视频2');
  assert.match(R.plan('@图片1 @图片3 @视频2', rg).blocked, /@视频1/);   // 三种都管：视频那两处登记对不上，挪不了
});

test('给人看的一句', () => {
  const p = R.plan(text, regs);
  assert.equal(R.say(p), '提示词里不再用 @图片9（镜头4_首帧）。即梦照挂的先后编号认图，后面的往前挪：@图片10→9、@图片11→10、@图片12→11、@图片13→12，挂的图跟着挪。');
});
