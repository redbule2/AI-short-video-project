'use strict';
/* 公用/资产归类.js 的测试：node 通用工具/测试/资产归类_测试.cjs
   11-17 他要：提炼出来的人物、场景、道具分全局的（全片好几段都出场）、只这一段用的（用在哪几镜）；用不着的能删掉（全片也删）。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../公用/资产归类.js');

const KE = '资产/场景/客栈.png';
const NOS = ['1', '2', '3'];
function film() {
  return {
    梗概: '童大圣抢药膳鸡配方',
    人物: [{ 名: '童大圣', 描写: '小孩', 资产: ['资产/人物和道具/童大圣.png'] }, { 名: '洪七公', 描写: '老乞丐', 资产: [] }, { 名: '张三丰', 描写: '老道', 资产: [] }],
    道具: [{ 名: '配方', 描写: '一张黄纸', 资产: [] }, { 名: '扇子', 描写: '折扇', 资产: [] }],
    场景: '破庙：山脚下一座破庙\n光明顶：山顶大殿\n山道：上山的路',
    场景图: [KE],
    场: [
      { 段: '1-1', 人物: ['童大圣', '洪七公'], 道具: ['配方', '扇子'], 场景文字: ['破庙：山脚下一座破庙'], 场景图: [KE], 段落: [
        { 号: '1', 写什么: '童大圣进庙', 作用: '', 人物: ['童大圣'], 场景: ['破庙'] },
        { 号: '2', 写什么: '洪七公递配方', 作用: '', 人物: ['童大圣', '洪七公'], 场景: ['破庙'], 道具: ['配方'] },
        { 号: '3', 写什么: '洪七公到客栈', 作用: '', 人物: ['洪七公'], 场景: ['客栈'] }] },
      { 段: '1-2', 人物: ['童大圣', '张三丰'], 道具: [], 场景文字: ['光明顶：山顶大殿'], 场景图: [], 段落: [{ 号: '1', 写什么: '上光明顶', 作用: '' }] },
    ],
  };
}

test('每一镜出场的：去空、去重、场景只记地方名；没有的那一类不写', () => {
  assert.deepEqual(S.rowCast({ 人物: [' 童大圣 ', '童大圣', ''], 场景: ['破庙：山脚下一座破庙', '破庙'], 道具: [] }), { 人物: ['童大圣'], 场景: ['破庙'] });
  assert.deepEqual(S.rowCast({ 人物: '洪七公' }), { 人物: ['洪七公'] });
  assert.deepEqual(S.rowCast(null), {});
});

test('用在哪几镜：连着三镜以上写成「～」，号带 b 的照镜头表的先后算', () => {
  const nos = ['1', '2', '3', '3b', '4'];
  assert.equal(S.nosSay(['1', '2', '3', '3b'], nos), '镜1～3b');
  assert.equal(S.nosSay(['4', '1', '3b'], nos), '镜1、3b、4');
  assert.equal(S.nosSay(['1', '2'], nos), '镜1、2');
  assert.equal(S.nosSay(['9'], nos), '');
  const d = film(), s = d.场[0];
  assert.equal(S.say(d, s, NOS, '人物', '洪七公'), '镜2、3');
  assert.equal(S.say(d, s, NOS, '场景', '破庙：随便写的'), '镜1、2');   // 场景认地方名
  assert.equal(S.say(d, s, NOS, '场景', '客栈'), '镜3');
  assert.equal(S.say(d, s, NOS, '道具', '扇子'), '哪一镜都没用上');
  assert.equal(S.say(d, d.场[1], ['1'], '人物', '张三丰'), '');   // 这一段还没标过：不说
});

test('点镜头号：选上、去掉；一样不剩就把那一类去掉；没变回 false', () => {
  const x = { 人物: ['童大圣'] };
  assert.equal(S.setShot(x, '人物', '童大圣', true), false);
  assert.equal(S.setShot(x, '场景', '破庙：山脚下', true), true);
  assert.deepEqual(x.场景, ['破庙']);
  assert.equal(S.setShot(x, '人物', '童大圣', false), true);
  assert.equal(x.人物, undefined);
  assert.equal(S.setShot(x, '别的', '童大圣', true), false);
});

test('全局：好几段都选了它就算；只一段的看「全局」标没标；标在页面的 rest 里也认', () => {
  const d = film();
  assert.equal(S.isGlobal(d, '人物', '童大圣'), true);
  assert.equal(S.isGlobal(d, '人物', '洪七公'), false);
  assert.equal(S.setGlobal(d, '人物', '洪七公', true), true);
  assert.deepEqual(d.全局, { 人物: ['洪七公'] });
  assert.equal(S.isGlobal(d, '人物', '洪七公'), true);
  assert.equal(S.setGlobal(d, '人物', '洪七公', true), false);
  S.setGlobal(d, '人物', '洪七公', false);
  assert.equal(d.全局, undefined);   // 一样不剩就整个去掉
  const page = { ...film(), rest: {} };
  S.setGlobal(page, '场景', '破庙：山脚下', true);
  assert.deepEqual(page.rest.全局, { 场景: ['破庙'] });
  assert.equal(page.全局, undefined);
  assert.deepEqual(S.segGlobal(page, page.场[0]), { 人物: ['童大圣'], 场景: ['破庙'], 道具: [] });
});

test('并进 AI 标的全局：这一段出场的照 AI 换，别的段的不动；AI 没回全局就不动', () => {
  const d = film();
  d.全局 = { 人物: ['张三丰', '洪七公'], 道具: ['扇子'] };
  S.takeMarks(d, d.场[0], S.globalIn({ 全局: { 人物: ['童大圣'], 场景: ['破庙：山脚下'], 道具: '配方' } }));
  assert.deepEqual(d.全局, { 人物: ['张三丰', '童大圣'], 场景: ['破庙'], 道具: ['配方'] });
  S.takeMarks(d, d.场[0], S.globalIn({}));
  assert.deepEqual(d.全局, { 人物: ['张三丰', '童大圣'], 场景: ['破庙'], 道具: ['配方'] });
});

test('每一镜只留这一段选上的（AI 写了出场表里没有的名字，不要）', () => {
  const d = film(), s = d.场[0];
  s.段落[0].人物 = ['童大圣', '路人'];
  s.段落[2].道具 = ['不存在的'];
  S.fitRows(s);
  assert.deepEqual(s.段落[0].人物, ['童大圣']);
  assert.equal(s.段落[2].道具, undefined);
  assert.deepEqual(s.段落[2].场景, ['客栈']);   // 场景图也算这一段的场景
});

test('删掉：别的段没用它，全片设定也删；镜头、全局、不出图里也去掉；记进「删掉」，又加回来就不算', () => {
  const d = film(), s = d.场[0];
  s.不出图 = { 人物: ['洪七公'] };
  S.setGlobal(d, '人物', '洪七公', true);
  const r = S.drop(d, s, '人物', '洪七公');
  assert.deepEqual(r, { all: true, others: [] });
  assert.deepEqual(s.人物, ['童大圣']);
  assert.deepEqual(d.人物.map(x => x.名), ['童大圣', '张三丰']);
  assert.deepEqual(s.段落[1].人物, ['童大圣']);
  assert.equal(s.段落[2].人物, undefined);
  assert.equal(s.不出图, undefined);
  assert.equal(d.全局, undefined);
  assert.deepEqual(s.删掉, ['人物|洪七公']);
  assert.equal(S.isGone(s, '人物', '洪七公'), true);
  s.人物.push('洪七公');
  assert.equal(S.isGone(s, '人物', '洪七公'), false);
});

test('删掉：别的段还用着，只从这一段去掉，全片设定留着', () => {
  const d = film(), s = d.场[0];
  const r = S.drop(d, s, '人物', '童大圣');
  assert.deepEqual(r, { all: false, others: ['1-2'] });
  assert.deepEqual(s.人物, ['洪七公']);
  assert.ok(d.人物.some(x => x.名 === '童大圣'));
  assert.equal(s.段落[0].人物, undefined);
  assert.deepEqual(d.场[1].人物, ['童大圣', '张三丰']);
});

test('删掉场景：只用文字写的删那一句（不要GEO 也去掉），场景图从全片引用里去掉，图不删', () => {
  const d = film(), s = d.场[0];
  s.不要GEO = ['破庙'];
  S.drop(d, s, '场景', '破庙：山脚下一座破庙');
  assert.deepEqual(s.场景文字, []);
  assert.equal(d.场景, '光明顶：山顶大殿\n山道：上山的路');
  assert.equal(s.不要GEO, undefined);
  assert.equal(s.段落[0].场景, undefined);
  S.drop(d, s, '场景', '', KE);
  assert.deepEqual(s.场景图, []);
  assert.deepEqual(d.场景图, []);
  assert.equal(s.段落[2].场景, undefined);
  assert.deepEqual(s.删掉, ['场景|破庙', '场景|客栈']);
  assert.equal(S.isGone(s, '场景', '客栈'), true);
});

test('删掉前问的话：说清会不会全片也删、图在不在；点「取消」什么都不动', async () => {
  const d = film(), s = d.场[0];
  const a = S.dropSay(d, s, '人物', '洪七公');
  assert.equal(a.title, '删掉人物「洪七公」');
  assert.match(a.body, /全片设定里也删掉/);
  assert.doesNotMatch(a.body, /图还在原处/);
  const b = S.dropSay(d, s, '人物', '童大圣');
  assert.match(b.body, /第1-2段还用着/);
  assert.match(b.body, /图还在原处/);
  assert.match(S.dropSay(d, s, '场景', '', KE).body, /全片的场景图里也不再引用.*图还在原处/);
  assert.match(S.dropSay(d, s, '场景', '破庙：山脚下一座破庙').body, /全片设定的场景里，这一句也删掉/);
  assert.equal(await S.dropAsk(async () => false, d, s, '人物', '洪七公'), false);
  assert.deepEqual(s.人物, ['童大圣', '洪七公']);
  assert.equal(await S.dropAsk(async () => true, d, s, '人物', '洪七公'), true);
  assert.deepEqual(s.人物, ['童大圣']);
});

test('AI 重新提炼：人删掉的不再并进来（人物、道具、场景、镜头、全局都去掉）', () => {
  const d = film(), s = d.场[0];
  S.drop(d, s, '人物', '洪七公');
  S.drop(d, s, '场景', '破庙：山脚下一座破庙');
  const v = { 人物: [{ 名: '洪七公', 描写: '' }, { 名: '童大圣', 描写: '' }], 道具: [{ 名: '配方', 描写: '' }], 场景: ['破庙：换了个说法', '客栈：路边'],
    段落: [{ 写什么: 'a', 人物: ['洪七公', '童大圣'], 场景: ['破庙'] }, { 写什么: 'b', 人物: ['洪七公'] }], 全局: { 人物: ['洪七公', '童大圣'], 场景: ['破庙'], 道具: [] } };
  S.skipGone(s, v);
  assert.deepEqual(v.人物.map(x => x.名), ['童大圣']);
  assert.deepEqual(v.场景, ['客栈：路边']);
  assert.deepEqual(v.段落, [{ 写什么: 'a', 人物: ['童大圣'] }, { 写什么: 'b' }]);
  assert.deepEqual(v.全局, { 人物: ['童大圣'], 场景: [], 道具: [] });
  assert.match(S.goneLine(s), /人物「洪七公」、场景「破庙」/);
  s.人物.push('洪七公');   // 人又加回来了
  assert.match(S.goneLine(s), /^人删掉了.*场景「破庙」$/);
  assert.equal(S.goneLine(d.场[1]), '');
});

test('改名：各镜头里记的、全局、删掉 跟着换', () => {
  const d = film();
  S.setGlobal(d, '人物', '洪七公', true);
  d.场[1].删掉 = ['人物|洪七公'];
  assert.equal(S.rename(d, '人物', '洪七公', '洪老'), true);
  assert.deepEqual(d.场[0].段落[1].人物, ['童大圣', '洪老']);
  assert.deepEqual(d.全局, { 人物: ['洪老'] });
  assert.deepEqual(d.场[1].删掉, ['人物|洪老']);
  assert.equal(S.rename(d, '人物', '洪老', '洪老'), false);
});

test('场景改地方名跟着换；改着改着撞上别处的名字（或原来就有两句同名）不换，别把两处并成一处', () => {
  const d = film(), a = ['破庙：山脚下一座破庙', '光明顶：山顶大殿'];
  S.renameScenes(d, ['破庙：山脚下一座破庙'], ['土地庙：山脚下一座破庙'], a, ['土地庙：山脚下一座破庙', '光明顶：山顶大殿']);
  assert.deepEqual(d.场[0].段落[0].场景, ['土地庙']);
  const d2 = film();
  S.renameScenes(d2, ['破庙：山脚下一座破庙'], ['光明顶：山脚下一座破庙'], a, ['光明顶：山脚下一座破庙', '光明顶：山顶大殿']);
  assert.deepEqual(d2.场[0].段落[0].场景, ['破庙']);
  const d3 = film();
  S.renameScenes(d3, ['破庙：一'], ['土地庙：一'], ['破庙：一', '破庙：二'], ['土地庙：一', '破庙：二']);
  assert.deepEqual(d3.场[0].段落[0].场景, ['破庙']);
});

test('全片设定里删了一行：各镜头里记的、全局里的也去掉', () => {
  const d = film();
  S.setGlobal(d, '道具', '配方', true);
  S.forget(d, '道具', '配方');
  assert.equal(d.场[0].段落[1].道具, undefined);
  assert.equal(d.全局, undefined);
});

test('AI 只标了镜头、全局：定下来的照旧算数；镜头写什么改了就不算', () => {
  const d = film(), s = d.场[0], was = S.sig(d, s);
  s.段落[0].人物 = ['童大圣', '洪七公'];
  S.setGlobal(d, '人物', '洪七公', true);
  assert.equal(S.sig(d, s), was);
  s.段落[0].写什么 = '童大圣跑进庙';
  assert.notEqual(S.sig(d, s), was);
  const d2 = film(), w2 = S.sig(d2, d2.场[0]);
  d2.人物[1].描写 = '老叫花子';
  assert.notEqual(S.sig(d2, d2.场[0]), w2);
});

test('交给 AI 的：要求两条、回复的样子、现在的全局、每一镜出场的', () => {
  const [a, b] = S.rules(7);
  assert.match(a, /^7\. 镜头表每个镜头再写三个列表/);
  assert.match(b, /^8\. 「全局」/);
  assert.match(S.ruleFix(8), /^8\. .*原有的照抄.*还没标的、新加的照这个标/);
  const one = JSON.parse('{' + S.GLOBAL_JSON + ', ' + S.SHOT_JSON + '}');
  assert.deepEqual(Object.keys(one.全局), ['人物', '场景', '道具']);
  const d = film();
  S.setGlobal(d, '道具', '配方', true);
  assert.equal(S.globalLine(d), '全局（全片好几段都出场的）：人物：童大圣；场景：（没有）；道具：配方');
  assert.equal(S.castSay(d.场[0].段落[1]), '出场：童大圣、洪七公、破庙、配方');
  assert.equal(S.castSay({}), '');
});

test('场景图（11-17）：图名告诉 AI；标过了、场景图一镜都没标上的，提炼页提醒补标；页面收下 AI 写的图名', () => {
  const d = film(), s = d.场[0];
  assert.deepEqual(S.imgNames(s), ['客栈']);
  assert.equal(S.imgLine(s), '这一段挂了场景图，图名：客栈。照图名和剧本估，哪个镜头用得上哪张，就把图名写进这个镜头的「场景」，一个字不差。');
  assert.equal(S.imgLine(d.场[1]), '');
  assert.equal(S.imgsUntagged(s), false);   // 镜3 写了客栈
  S.setShot(s.段落[2], '场景', '客栈', false);
  assert.equal(S.imgsUntagged(s), true);
  assert.equal(S.imgsUntagged(d.场[1]), false);   // 没挂场景图
  assert.equal(S.imgsUntagged({ 场景图: [KE], 段落: [] }), false);   // 还没有镜头表
  const t = { 场景图: [KE], 人物: ['童大圣'], 段落: [{ 号: '1', 写什么: 'a', 人物: ['童大圣'], 场景: ['客栈'] }] };
  S.fitRows(t);
  assert.deepEqual(t.段落[0].场景, ['客栈']);
  assert.equal(S.imgsUntagged(t), false);
});

test('流水线的页面：读 流水线.js 的都先读 公用/资产归类.js（不然并进 AI 提炼的会丢掉每一镜出场的）', () => {
  const dir = path.resolve(__dirname, '../流水线');
  const pages = fs.readdirSync(dir).filter(f => f.endsWith('.html')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]).filter(([, t]) => t.includes('流水线.js"'));
  assert.ok(pages.length >= 9);
  for (const [f, t] of pages) {
    const at = t.indexOf('../公用/资产归类.js"');
    assert.ok(at >= 0 && at < t.indexOf('流水线.js"'), f + ' 没先读 公用/资产归类.js');
  }
});

test('用在哪几镜的小牌子只写一套（11-17 资产页也能手动绑镜头）：流水线.js 的 shotPicks，提炼页、资产页都用它', () => {
  const dir = path.resolve(__dirname, '../流水线'), read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  assert.match(read('流水线.js'), /function shotPicks\(s, who, done\)/);
  for (const f of ['分场.html', '资产.html']) assert.ok(read(f).includes('shotPicks(s, '), f + ' 没用 shotPicks');
  assert.ok(!read('分场.html').includes('pz-shots'), '分场.html 还留着自己那一套小牌子');
  assert.match(read('流水线.css'), /\.fl-shots button\.on/);
});
