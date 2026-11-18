'use strict';
/* 公用/关键帧绑定.js：镜头表的固定号、关键帧绑到「一镜一刻」（2026-11-16 他定，流程图 通用工具/流水线/关键帧绑定_流程图.html） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const SB = require('../公用/关键帧绑定.js');

const rows = (...ws) => ws.map(w => typeof w === 'string' ? { 写什么: w, 作用: '' } : w);

test('镜头号：没号的表 1、2、3；有号的照它，删了不挪', () => {
  assert.deepEqual(SB.nosOf(rows('a', 'b', 'c')), ['1', '2', '3']);
  assert.deepEqual(SB.nosOf([{ 号: '1' }, { 号: '2' }, { 号: 11 }, { 号: '镜头12' }]), ['1', '2', '11', '12']);
});

test('镜头号：中间加的是前一镜加 b、c；最后加的接着排；最前面加的是 0', () => {
  assert.deepEqual(SB.nosOf([{ 号: '3' }, {}, { 号: '4' }]), ['3', '3b', '4']);
  assert.deepEqual(SB.nosOf([{ 号: '3' }, {}, {}, { 号: '4' }]), ['3', '3b', '3c', '4']);
  assert.deepEqual(SB.nosOf([{ 号: '3' }, { 号: '3b' }, {}, { 号: '4' }]), ['3', '3b', '3c', '4']);
  assert.deepEqual(SB.nosOf([{ 号: '1' }, { 号: '19' }, {}, {}]), ['1', '19', '20', '21']);
  assert.deepEqual(SB.nosOf([{}, { 号: '1' }]), ['0', '1']);
  assert.deepEqual(SB.nosOf([{ 号: '2' }, { 号: '2' }]), ['2', '3']);   // 重了的当没有
  assert.deepEqual(SB.nosOf([{ 号: '9' }, {}, { 号: '11' }]), ['9', '9b', '11']);   // 删掉的 10 不再用
});

test('fillNos 把号写进表；keepNos 并进 AI 新提炼的表时留住原来的号', () => {
  const t = SB.fillNos(rows('a', 'b'));
  assert.deepEqual(t.map(x => x.号), ['1', '2']);
  const old = [{ 写什么: '甲', 作用: '', 号: '1' }, { 写什么: '乙', 作用: '', 号: '2' }, { 写什么: '丙', 作用: '', 号: '11' }];
  assert.deepEqual(SB.keepNos(rows('甲', '乙改', '丙'), old).map(x => x.号), ['1', '2', '11']);   // 一样多：改了字的照位置留号
  assert.deepEqual(SB.keepNos(rows('甲', '新', '乙', '丙'), old).map(x => x.号), ['1', '1b', '2', '11']);   // 中间加了一镜
  assert.deepEqual(SB.keepNos(rows('甲', '丙'), old).map(x => x.号), ['1', '11']);   // 删了一镜
  const why = rows('甲', '新', '乙', '丙').map((x, i) => ({ ...x, 作用: '铺垫｜改写的作用' + i }));
  assert.deepEqual(SB.keepNos(why, old).map(x => x.号), ['1', '1b', '2', '11']);   // 加了一镜、作用全改写了：写什么一样的还是原来那一镜
});

test('keepNos：删了一镜、又改了别的镜的字（11-18 药膳鸡 1-1），改字的那一镜认最像的，留原号', () => {
  const r = (w, y, no) => ({ 写什么: w, 作用: y, ...(no ? { 号: no } : {}) });
  const A = r('洪七公轻功踏雪，掠上山巅', '交代｜洪七公亮相，引出传闻，为镜2', '1'), B = r('破庙火光里，洪七公撕开烤鸡', '交代｜让人知道他最爱吃鸡，为镜3', '2'), C = r('奇花异草沉进翻滚的砂锅鸡汤', '铺垫｜至宝入汤，食方的门道，为镜4', '3');
  const old = [A, B, C, r('竹林里洪七公一掌，竹叶漫天飞起', '交代｜鸡汤能让内力大涨，接镜3', '4')];
  const fix1 = [r('洪七公轻功踏雪，落上坡顶山脊', '交代｜洪七公亮相，引出传闻，为镜2'), r(C.写什么, '铺垫｜至宝入汤，食方的门道，为镜3'), r(old[3].写什么, '交代｜鸡汤能让内力大涨，接镜2')];
  assert.deepEqual(SB.keepNos(fix1, old).map(x => x.号), ['1', '3', '4']);   // 删的是镜头2，镜头1 改了字
  const fix2 = [r('破庙火光里，洪七公撕开整只烤鸡', B.作用), r(C.写什么, C.作用)];
  assert.deepEqual(SB.keepNos(fix2, [A, B, C]).map(x => x.号), ['2', '3']);   // 删的是镜头1，镜头2 改了字
  assert.deepEqual(SB.keepNos([r('童大圣站在华山之巅', '铺垫｜食方之威'), r(C.写什么, C.作用)], [A, B, C]).map(x => x.号), ['0', '3']);   // 删了两镜、换上一镜不像的：算新加的
});

test('nosOk：AI 写的号能不能直接用', () => {
  const old = ['1', '3', '9', '9b', '11'];
  assert.equal(SB.nosOk(['1', '3', '3b', '9', '11', '12'], old), true);   // 中间加 3b、最后加 12
  assert.equal(SB.nosOk(['0', '1', '3'], old), true);   // 最前面加的 0
  assert.equal(SB.nosOk(['1', '2', '3'], old), false);   // 2 是删掉的号
  assert.equal(SB.nosOk(['1', '10', '11'], old), false);   // 10 也是删掉的号
  assert.equal(SB.nosOk(['1', '1'], old), false);
  assert.equal(SB.nosOk(['1', ''], old), false);
  assert.equal(SB.nosOk([], old), false);
});

test('提示词名字里的镜头号：照表里的先后展开、挨着的连起来', () => {
  const nos = ['1', '1b', '2', '3', '9', '11', '12'];
  assert.deepEqual(SB.expand('1-2.txt', nos), { nos: ['1', '1b', '2'], missing: [] });
  assert.deepEqual(SB.expand('9-11、3', nos), { nos: ['3', '9', '11'], missing: [] });
  assert.deepEqual(SB.expand('10', nos), { nos: [], missing: ['10'] });
  const cut = ['1', '3', '4', '9', '11'];   // 镜头2、10 删了
  assert.deepEqual(SB.expand('2-3', cut), { nos: ['3'], missing: [] });   // 一头删了：往里收（11-18）
  assert.deepEqual(SB.expand('1-2', cut), { nos: ['1'], missing: [] });
  assert.deepEqual(SB.expand('9-10', cut), { nos: ['9'], missing: [] });
  assert.deepEqual(SB.expand('2-4', cut), { nos: ['3', '4'], missing: [] });
  assert.deepEqual(SB.expand('5-8', cut), { nos: [], missing: ['5', '8'] });   // 中间一镜都不剩
  assert.deepEqual(SB.expand('2', cut), { nos: [], missing: ['2'] });   // 单拍删掉的那一镜
  assert.deepEqual(SB.expand('12-15', cut), { nos: [], missing: ['12', '15'] });
  assert.deepEqual(SB.shotsOf('9-11', '9-11.txt', nos), ['9', '11']);   // 名字是镜头号的照表认
  assert.deepEqual(SB.shotsOf('', '镜头1-2_视频提示词.txt', nos), ['1', '1b', '2']);   // 老稿照名字里的数认
  assert.equal(SB.shotsOf('', '视频提示词_02.txt', nos), null);
  assert.equal(SB.codeOf(['9', '11', '12'], nos), '9-12.txt');
  assert.equal(SB.codeOf(['3', '1', '1b'], nos), '1-1b、3.txt');
  assert.equal(SB.codeOf([], nos), '');
});

test('照名字猜：镜头11_首帧 → 镜头11 首帧；表里没有的号、看不出哪一刻的不猜', () => {
  const nos = ['1', '2', '11'];
  assert.deepEqual(SB.guess('资产/第3-4段/镜头11_首帧.png', nos), { 镜: '11', 刻: '首帧' });
  assert.deepEqual(SB.guess('资产/第3-4段/1-5_镜头2_尾帧.png', nos), { 镜: '2', 刻: '尾帧' });
  assert.deepEqual(SB.guess('资产/第3-4段/镜头1_关键帧.png', nos), { 镜: '1', 刻: '关键帧' });
  assert.equal(SB.guess('资产/第3-4段/镜头1b_首帧.png', nos), null);
  assert.equal(SB.guess('资产/第3-4段/镜头10_首帧.png', nos), null);
  assert.equal(SB.guess('资产/第3-4段/镜头1_白模底图.png', nos), null);
});

test('绑上、现用和备选、带哪几张、怎么说', () => {
  const paras = [{ 写什么: '打出末弹', 号: '1' }, { 写什么: '炸翻敌群', 号: '2' }, { 写什么: '喊冲锋', 号: '11' }];
  const s = {}, A = '资产/x/镜头1_首帧.png', B = '资产/x/镜头1_首帧_雾.png', C = '资产/x/镜头11_首帧.png', D = '资产/x/镜头11_尾帧.png';
  assert.ok(SB.bind(s, A, '1', '首帧', paras));
  assert.ok(SB.bind(s, B, '1', '首帧', paras));   // 同一刻已经有现用的：新绑的当备选
  assert.ok(SB.bind(s, C, '镜头11', '首帧', paras));
  assert.ok(SB.bind(s, D, '11', '尾帧', paras));
  assert.equal(SB.bind(s, 'z.png', '10', '首帧', paras), false);   // 表里没有镜头10
  assert.deepEqual(s.关键帧绑定[B], { 镜: '1', 刻: '首帧', 备选: true, 写什么: '打出末弹' });
  const frames = [A, B, C, D], binds = SB.bindsOf(s);
  assert.deepEqual(SB.forShots(['11', '1'], frames, paras, binds), [A, C, D]);
  SB.setCurrent(s, B);
  assert.deepEqual(SB.forShots(['1'], frames, paras, SB.bindsOf(s)), [B]);
  assert.equal(SB.say(binds[C], paras), '镜头11「喊冲锋」开头');
  assert.equal(SB.regName(binds[D]), '关键帧｜镜头11｜结尾');
  assert.deepEqual(SB.order([D, 'y.png', C, A], paras, binds), [A, C, D, 'y.png']);
});

test('按镜头表摆：没绑的、绑的镜头删了的放最下面，改过字的标出来', () => {
  const paras = [{ 写什么: '甲', 号: '1' }, { 写什么: '乙改了', 号: '2' }];
  const binds = { 'a/镜头1_首帧.png': { 镜: '1', 刻: '首帧', 写什么: '甲' }, 'a/镜头2_首帧.png': { 镜: '2', 刻: '首帧', 写什么: '乙' }, 'a/镜头10_首帧.png': { 镜: '10', 刻: '首帧', 写什么: '丙' } };
  const t = SB.table(['a/镜头1_首帧.png', 'a/镜头2_首帧.png', 'a/镜头10_首帧.png', 'a/镜头2_尾帧.png'], paras, binds);
  assert.deepEqual(t.rows.map(r => r.帧.map(x => [x.file, x.stale, x.current])), [[['a/镜头1_首帧.png', false, true]], [['a/镜头2_首帧.png', true, true]]]);
  assert.deepEqual(t.loose, [{ file: 'a/镜头10_首帧.png', gone: '10', guess: null }, { file: 'a/镜头2_尾帧.png', gone: '', guess: { 镜: '2', 刻: '尾帧' } }]);
});

test('资产页一镜三格：现用的在格里，别的是备选；拖到一格当现用', () => {
  const paras = [{ 写什么: '甲', 号: '1' }, { 写什么: '乙', 号: '2' }];
  const s = {}, A = 'a/镜头1_首帧.png', B = 'a/镜头1_首帧_雾.png', C = 'a/镜头1_尾帧.png';
  SB.bind(s, A, '1', '首帧', paras); SB.bind(s, B, '1', '首帧', paras); SB.bind(s, C, '1', '尾帧', paras);
  const one = () => SB.slots(SB.table([A, B, C], paras, SB.bindsOf(s)).rows[0]);
  let x = one();
  assert.equal(x.首帧.cur.file, A); assert.deepEqual(x.首帧.alts.map(y => y.file), [B]);
  assert.equal(x.关键帧.cur, null); assert.deepEqual(x.关键帧.alts, []);
  assert.equal(x.尾帧.cur.file, C);
  SB.bind(s, B, '1', '首帧', paras, true);   // 拖到已经有图的一格：拖过来的当现用，原来那张改备选
  x = one();
  assert.equal(x.首帧.cur.file, B); assert.deepEqual(x.首帧.alts.map(y => y.file), [A]);
  SB.bind(s, C, '2', '关键帧', paras, true);   // 拖到别的镜头：从原来那一格挪走
  assert.equal(one().尾帧.cur, null);
  assert.equal(SB.slots(SB.table([A, B, C], paras, SB.bindsOf(s)).rows[1]).关键帧.cur.file, C);
  assert.deepEqual(Object.keys(SB.slots(null)), ['首帧', '关键帧', '尾帧']);
});

test('一张一张看的先后：照镜头表，开头中间结尾，同一刻现用在前，没绑的最后', () => {
  const paras = [{ 写什么: '一', 号: '1' }, { 写什么: '二', 号: '2' }], s = {};
  const f = n => '资产/第1段/' + n + '.png';
  SB.bind(s, f('二尾'), '2', '尾帧', paras); SB.bind(s, f('一尾'), '1', '尾帧', paras);
  SB.bind(s, f('一首_雾'), '1', '首帧', paras); SB.bind(s, f('一首'), '1', '首帧', paras, true);   // 后绑的当现用，先绑的雾版改备选
  const t = SB.table([f('没绑'), f('二尾'), f('一尾'), f('一首_雾'), f('一首')], paras, SB.bindsOf(s));
  assert.deepEqual(SB.seq(t), [f('一首'), f('一首_雾'), f('一尾'), f('二尾'), f('没绑')]);
  assert.deepEqual(SB.seq(SB.table([], paras, {})), []);
});

test('出片前对一遍：没写到、没绑、绑的镜头不在这一条、字改过', () => {
  const paras = [{ 写什么: '八', 号: '8' }, { 写什么: '九改', 号: '9' }];
  const binds = { 'a/8.png': { 镜: '8', 刻: '首帧', 写什么: '八' }, 'a/9.png': { 镜: '9', 刻: '首帧', 写什么: '九' } };
  const hung = [{ ref: '@图片4', path: 'a/8.png' }, { ref: '@图片5', path: 'a/9.png' }, { ref: '@图片6', path: 'a/x.png' }];
  assert.deepEqual(SB.check({ hung, shots: ['9'], paras, binds, text: '@图片4作为首帧。@图片5定义第二个关键帧。@图片60' }), [
    '@图片4 是镜头8 的，这一条拍的是镜头9',
    '镜头9 的字改过，@图片5 还对得上吗',
    '@图片6 挂着，提示词里没写到它',
    '@图片6 还没绑到镜头表的哪一镜（资产那一步「关键帧」一块里绑）',
  ]);
  assert.deepEqual(SB.check({ hung: hung.slice(0, 1), shots: null, paras, binds, text: '@图片4' }), []);
});
