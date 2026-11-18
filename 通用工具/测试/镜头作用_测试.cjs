'use strict';
/* 公用/镜头作用.js：作用「标签｜目的，关系」怎么拆、提到哪几镜，秒数怎么加，AI 提炼的镜头表并进来时号和人定的秒数怎么留（2026-11-16） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const W = require('../公用/镜头作用.js');
const SB = require('../公用/关键帧绑定.js');

test('拆标签：认六个标签和半角竖线；没标签的老数据原样', () => {
  assert.deepEqual(W.split('铺垫｜阵地眼看守不住，为镜2救场'), { tag: '铺垫', rest: '阵地眼看守不住，为镜2救场' });
  assert.deepEqual(W.split(' 高潮 | 最爽一下 '), { tag: '高潮', rest: '最爽一下' });
  assert.deepEqual(W.split('接上一段的弹尽，敌人一窝蜂压到墙前'), { tag: '', rest: '接上一段的弹尽，敌人一窝蜂压到墙前' });
  assert.deepEqual(W.split('伏笔｜不是六个里的'), { tag: '', rest: '伏笔｜不是六个里的' });
  assert.equal(W.len('交代｜接镜2，救兵亮相：个小气势足'), 17);
});

test('提到哪几镜：镜N、镜头N、带字母的号；给了表只认表里有的', () => {
  assert.deepEqual(W.refs('接镜3，全段最爽；为镜头3b收'), ['3', '3b']);
  assert.deepEqual(W.refs('挡死镜01的冲锋，为镜20', ['1', '2']), ['1']);
  assert.deepEqual(W.refs('收尾｜引下段反攻'), []);
});

test('换号：按排第几写的镜N 换成固定号，换不了的不动', () => {
  assert.equal(W.renum('接镜9，为镜10开打，引下段', k => ({ 9: '9', 10: '11' })[k] || ''), '接镜9，为镜11开打，引下段');
  assert.equal(W.renum('为镜头2救场', () => '2b'), '为镜头2b救场');
});

test('秒数：整秒、不到 1 秒算 1 秒；合计、过 15 秒、过 30 秒', () => {
  assert.equal(W.secOf({ 秒数: 2.6 }), 3);
  assert.equal(W.secOf({ 秒数: 0.3 }), 1);
  assert.equal(W.secOf({ 秒数: '' }), 0);
  assert.equal(W.secOf({}), 0);
  assert.deepEqual(W.sum([{ 秒数: 3 }, { 秒数: 4 }, {}]), { total: 7, missing: 1, level: '', say: '约 7 秒（1 镜没估）' });
  assert.equal(W.pickSay([{ 秒数: 10 }, { 秒数: 6 }]).say, '约 16 秒：过了 15 秒（一条视频一般 15 秒）');
  assert.equal(W.pickSay([{ 秒数: 20 }, { 秒数: 11 }]).level, 'over');
  assert.equal(W.pickSay([{}, {}]).say, '没估秒数');
});

test('色带：宽窄照秒数，没估的按平均；每 15 秒一道线', () => {
  const st = W.strip([{ 秒数: 3, 作用: '铺垫｜a' }, { 秒数: 3, 作用: '转折｜b' }, { 秒数: 4 }, { 秒数: 4 }, { 秒数: 3 }, { 秒数: 5 }]);
  assert.equal(st.total, 22);
  assert.equal(st.blocks[0].tag, '铺垫');
  assert.equal(st.blocks[2].tag, '');
  assert.ok(Math.abs(st.marks[0] - 15 / 22) < 1e-9 && st.marks.length === 1);
  const half = W.strip([{ 秒数: 4 }, {}]);
  assert.deepEqual(half.blocks.map(b => b.w), [0.5, 0.5]);
  assert.equal(half.total, 4);
  assert.deepEqual(W.strip([{ 秒数: 15 }]).marks, []);   // 正好 15 秒：不画线
  assert.deepEqual(W.strip(Array.from({ length: 18 }, () => ({}))).marks, []);   // 一镜都没估：不画线
});

test('照批注改的并进来：AI 照抄的号直接用（3b 也认），人定的秒数照抄，批注说到秒数才换', () => {
  const old = [{ 号: '1', 写什么: 'a', 作用: '', 秒数: 3, 秒数人定: true }, { 号: '3', 写什么: 'b', 作用: '', 秒数: 4, 秒数人定: true, 批注: '这一镜给 6 秒' }, { 号: '4', 写什么: 'c', 作用: '' }];
  const fresh = [{ 号: '1', 写什么: 'a', 作用: '铺垫｜为镜3', 秒数: 5 }, { 号: '3', 写什么: 'b', 作用: '转折｜接镜1', 秒数: 6 }, { 号: '3b', 写什么: 'b2', 作用: '反应｜接镜3', 秒数: 2 }, { 号: '4', 写什么: 'c', 作用: '收尾｜引下段', 秒数: 3 }];
  W.merge(fresh, old, SB, '');
  assert.deepEqual(fresh.map(x => [x.号, x.作用, x.秒数, !!x.秒数人定]), [['1', '铺垫｜为镜3', 3, true], ['3', '转折｜接镜1', 6, false], ['3b', '反应｜接镜3', 2, false], ['4', '收尾｜引下段', 3, false]]);
  const again = [{ 号: '1', 写什么: 'a', 作用: '', 秒数: 5 }];
  W.merge(again, [old[0]], SB, '整体：秒数都重估');
  assert.equal(again[0].秒数, 5);
});

test('重新提炼的并进来：没有号，字一样的留原来的号；作用里按排第几写的镜N 换成号', () => {
  const old = [{ 号: '1', 写什么: '开枪', 作用: '' }, { 号: '2', 写什么: '弹尽', 作用: '' }, { 号: '4', 写什么: '冲锋', 作用: '', 秒数: 4, 秒数人定: true }];
  const fresh = [{ 写什么: '开枪', 作用: '' }, { 写什么: '新加的', 作用: '' }, { 写什么: '弹尽', 作用: '' }, { 写什么: '冲锋', 作用: '收尾｜接镜3，为镜2' }];
  W.merge(fresh, old, SB, '');
  assert.deepEqual(fresh.map(x => x.号), ['1', '1b', '2', '4']);
  assert.equal(fresh[3].作用, '收尾｜接镜2，为镜1b');
  assert.equal(fresh[3].秒数, 4);
  const bad = [{ 号: '1', 写什么: 'x', 作用: '为镜2' }, { 号: '1', 写什么: 'y', 作用: '' }];   // 号重了：当没有号
  W.merge(bad, [], SB, '');
  assert.deepEqual(bad.map(x => x.号), ['1', '2']);
});

test('删了一镜、改了一镜的字（11-18）：重新提炼没号的、AI 拿了删掉的号的，都照字认回原来的号', () => {
  const old = [{ 号: '1', 写什么: '洪七公轻功踏雪，掠上山巅', 作用: '交代｜洪七公亮相，引出传闻，为镜2' }, { 号: '2', 写什么: '破庙火光里，洪七公撕开烤鸡', 作用: '交代｜让人知道他最爱吃鸡，为镜3' },
    { 号: '3', 写什么: '奇花异草沉进翻滚的砂锅鸡汤', 作用: '铺垫｜至宝入汤，食方的门道，为镜4' }, { 号: '4', 写什么: '竹林里洪七公一掌，竹叶漫天飞起', 作用: '交代｜鸡汤能让内力大涨，接镜3' }];
  const fresh = [{ 写什么: '洪七公轻功踏雪，落上坡顶山脊', 作用: '交代｜洪七公亮相，引出传闻，为镜2' }, { 写什么: old[2].写什么, 作用: '铺垫｜至宝入汤，食方的门道，为镜3' }, { 写什么: old[3].写什么, 作用: '交代｜鸡汤能让内力大涨，接镜2' }];
  W.merge(fresh, old, SB, '');   // 没号：作用里的镜N 按排第几认
  assert.deepEqual(fresh.map(x => [x.号, x.作用]), [['1', '交代｜洪七公亮相，引出传闻，为镜3'], ['3', old[2].作用], ['4', old[3].作用]]);
  const reuse = [{ 号: '1', 写什么: '洪七公轻功踏雪，落上坡顶山脊', 作用: '交代｜洪七公亮相，引出传闻，为镜3' }, { 号: '2', 写什么: old[2].写什么, 作用: '铺垫｜至宝入汤，为镜4' }, { 号: '4', 写什么: old[3].写什么, 作用: '交代｜接镜2' }];
  W.merge(reuse, old.filter(x => x.号 !== '2'), SB, '');   // 原来的表里镜头2 已经删了，AI 又把 2 给了砂锅那一镜：号不认，照字认；作用里的镜N 照 AI 写的号换
  assert.deepEqual(reuse.map(x => [x.号, x.作用]), [['1', '交代｜洪七公亮相，引出传闻，为镜3'], ['3', '铺垫｜至宝入汤，为镜4'], ['4', '交代｜接镜3']]);
});

test('AI 改过的原来是什么：只说改了的那几样', () => {
  assert.equal(W.was({ 写什么: '开枪', 作用: '' }, { 写什么: '开枪', 作用: '铺垫｜为镜2' }), '作用：（原来没写）');
  assert.equal(W.was({ 写什么: '开枪', 作用: '老的' }, { 写什么: '开火', 作用: '老的' }), '写什么：开枪');
  assert.equal(W.was({ 写什么: 'a', 作用: 'b' }, { 写什么: 'c', 作用: 'd' }), '写什么：a　作用：b');
});

test('连着哪几镜：为是这一镜指过去，接是那一镜指过来；同一对同方向只画一个箭头', () => {
  const rows = [{ 作用: '铺垫｜炮兵已在掏箱底，为镜4弹尽' }, { 作用: '铺垫｜为镜头05沉寂' }, { 作用: '' }, { 作用: '转折｜炮弹打光，接镜1' }, { 作用: '反应｜接镜4，为镜10' }];
  assert.deepEqual(W.links(rows, ['1', '2', '3', '4', '5']), [
    { from: '1', to: '4', say: '镜1 为镜4；镜4 接镜1' },
    { from: '2', to: '5', say: '镜2 为镜5' },
    { from: '4', to: '5', say: '镜5 接镜4' },
  ]);
  assert.deepEqual(W.links([{ 作用: '接镜3b' }, { 作用: '' }], ['3', '3b']), [{ from: '3b', to: '3', say: '镜3 接镜3b' }]);
});

test('镜头表怎么排：宽的一镜一行，窄的两行格子，字都不截；高放不下才挤', () => {
  const need = { t: 610, c: 420 };
  const a = W.grid(19, 1452, 560, need);   // 宽屏 3-4：一镜一行、两栏
  assert.deepEqual([a.m, a.c, a.rows], ['t', 2, 10]);
  const b = W.grid(7, 1452, 560, { t: 760, c: 470 });   // 宽屏 3-5：镜头少、字长，一栏就够
  assert.deepEqual([b.m, b.c], ['t', 1]);
  const c = W.grid(19, 1030, 575, need);   // 窄窗口：一行装不下字，换两行的格子
  assert.deepEqual([c.m, c.c, c.hh], ['c', 2, 50]);
  const e = W.grid(19, 1034, 510, { t: 577, c: 416 });   // 再矮一点：两行格子两栏差一点高，宁可页面滚一点也不截字
  assert.deepEqual([e.m, e.c, e.hh], ['c', 2, 50]);
  const d = W.grid(40, 900, 300, { t: 2000, c: 2000 });   // 宽高怎么都放不下：最挤的那种
  assert.equal(d.m, 't'); assert.equal(d.hh, 32);
});

test('画作用：有标签出色块，没标签只出那句', () => {
  const h = (tag, a, ...kids) => ({ tag, a, kids });
  const [chip, rest] = W.bits('高潮｜接镜3，全段最爽', h);
  assert.equal(chip.a.class, 'sw-t gc');
  assert.deepEqual(chip.kids, ['高潮']);
  assert.deepEqual(rest.kids, ['接镜3，全段最爽']);
  assert.equal(W.bits('老写法的一句', h).length, 1);
});

test('交给 AI 的要求：二十个字、六个标签、关系的两种说法、秒数照真人快慢', () => {
  const t = W.ruleWhy('镜N 的 N 是排第几');
  for (const k of ['二十个字以内', '交代', '铺垫', '转折', '高潮', '反应', '收尾', '「接镜N」', '「为镜N」', '镜N 的 N 是排第几']) assert.ok(t.includes(k), k);
  assert.match(W.RULE_SEC, /整秒数/);
});
