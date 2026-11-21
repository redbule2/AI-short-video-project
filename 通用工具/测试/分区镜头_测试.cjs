'use strict';
/* 分区写法的镜头（2026-11-20）：写稿状态.js 的 Zoned —— 认得出、读成栏、写回来一字不差、贴进来能拆；pe 稿里改了分区的一镜，「镜头N：」照旧独占一行 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse, serialize, Zoned } = require('../公用/写稿状态.js');

const SHOT = [
  '机位/景别/角度：第一视角，从沙袋墙后一名半跪的我军士兵的眼睛看出去。',
  '本镜调用：这名我军士兵只露出握刀的双手；钢刀；外星人战士。',
  '画面构图：画面下沿是握刀的双手和墙头的沙袋。',
  '环境音：风声，墙外成片的脚步声越来越急。',
  '进入状态：机枪都停了火。',
  '小节一',
  '动作/表情：冲在最前头的一个外星人战士扬起手臂朝身后一挥。',
  '音效：成片的<吼声>。',
  '镜头：跟着这名士兵的视线。',
  '台词：领头的外星人战士用日语高喊{弾切れだ！突撃！}',
  '小节二',
  '动作/表情：当先一排外星人战士蹬地跃起。',
  '音效：身后传来<旋翼轰鸣>。',
  '镜头：视线往上抬。',
  '台词：无',
  '退出状态：半空的外星人战士都被打飞。',
  '切点：旋翼声最响时切。',
];

test('认得出分区写法：有小节、或者第一行是开头那几栏', () => {
  assert.equal(Zoned.isZoned(SHOT), true);
  assert.equal(Zoned.isZoned(['小节一', '动作/表情：跑']), true);
  assert.equal(Zoned.isZoned(['第一视角，外星人战士扑上墙头。']), false);
  assert.equal(Zoned.isZoned(['动作/表情：跑']), false);
  assert.equal(Zoned.isZoned([]), false);
});

test('读成栏、写回来一字不差', () => {
  const z = Zoned.of(SHOT);
  assert.ok(z);
  assert.equal(z.head['机位/景别/角度'], '第一视角，从沙袋墙后一名半跪的我军士兵的眼睛看出去。');
  assert.equal(z.subs.length, 2);
  assert.equal(z.subs[0].name, '小节一');
  assert.equal(z.subs[1].f['台词'], '无');
  assert.equal(z.tail['切点'], '旋翼声最响时切。');
  assert.deepEqual(Zoned.lines(z), SHOT);
});

test('一栏写了几行：接在这一栏里，写回来照旧几行', () => {
  const ls = [...SHOT.slice(0, 2), '（墙头还插着一面旗）', ...SHOT.slice(2)];
  const z = Zoned.of(ls);
  assert.equal(z.head['本镜调用'], '这名我军士兵只露出握刀的双手；钢刀；外星人战士。\n（墙头还插着一面旗）');
  assert.deepEqual(Zoned.lines(z), ls);
});

test('不是标准样子的给 null（页面照旧一个框写，不替人改字）', () => {
  assert.equal(Zoned.of([SHOT[1], SHOT[0], ...SHOT.slice(2)]), null, '栏的先后换了');
  assert.equal(Zoned.of(['说明一句', ...SHOT]), null, '第一栏前面还有字');
  assert.equal(Zoned.of([...SHOT.slice(0, 5), SHOT[0], ...SHOT.slice(5)]), null, '同一栏写了两回');
  assert.equal(Zoned.of([...SHOT, '小节三']), null, '切点后面又来小节');
  assert.equal(Zoned.of([SHOT[0].replace('：', ':'), ...SHOT.slice(1)]), null, '半角冒号写回来不一样');
  assert.equal(Zoned.of(['第一视角，外星人战士扑上墙头。']), null);
});

test('写回：空栏不写，没起名的小节照先后叫', () => {
  const z = Zoned.of(SHOT);
  z.head['环境音'] = '';
  z.subs.push({ name: '', f: { '动作/表情': '直升机掠过墙头', '音效': '', '镜头': '', '台词': '' } });
  const out = Zoned.lines(z);
  assert.ok(!out.some(l => l.startsWith('环境音')));
  assert.deepEqual(out.slice(-4), ['小节三', '动作/表情：直升机掠过墙头', '退出状态：半空的外星人战士都被打飞。', '切点：旋翼声最响时切。']);
  assert.equal(Zoned.subName(0), '小节一');
  assert.equal(Zoned.subName(11), '小节12');
});

test('贴进来的整段：开头的「镜头N：」不要，认得出两栏以上才拆', () => {
  const z = Zoned.of(['镜头2：', ...SHOT], true);
  assert.ok(z);
  assert.equal(z.subs.length, 2);
  assert.equal(Zoned.of(['一句话的镜头'], true), null);
  assert.equal(Zoned.of(['机位/景别/角度：全景'], true), null, '只认得一栏：照常贴');
  assert.equal(Zoned.of(['前面一句没有栏名', ...SHOT], true), null, '第一栏前面有字：照常贴');
});

test('这一镜在文件里是哪几行', () => {
  assert.deepEqual(Zoned.shotLines('2', SHOT).slice(0, 2), ['镜头2：', SHOT[0]]);
  assert.deepEqual(Zoned.shotLines('3', ['全景，机群飞过墙头。', '尘土横飞。']), ['镜头3：全景，机群飞过墙头。', '尘土横飞。']);
  assert.deepEqual(Zoned.shotLines('4', []), ['镜头4：']);
});

test('指纹：同一镜一样，前后空格和空行不算', () => {
  assert.equal(Zoned.key(SHOT), Zoned.key(['', ...SHOT.map(l => ' ' + l + ' '), '']));
  assert.notEqual(Zoned.key(SHOT), Zoned.key([...SHOT.slice(0, -1), '切点：别处切。']));
  assert.match(Zoned.key(SHOT), /^[0-9a-f]{8}$/);
});

const EOL = '\r\n';
const doc = shots => ['【生成目标】', '扑墙', '', '【事件脚本】', ...shots, '声音包括风声，无背景音乐。', '', '【保持一致】', '同一道沙袋墙。', ''].join(EOL);
const ZONED_DOC = doc(['镜头1：', ...SHOT, '', '镜头2：', ...SHOT.slice(0, 5), '']);

test('pe 稿里的分区镜头：没改原样写回', () => {
  const d = parse(ZONED_DOC);
  assert.equal(d.fmt, 'pe');
  assert.equal(d.shots.length, 2);
  assert.deepEqual(d.shots[0].lines, SHOT);
  assert.equal(serialize(d), ZONED_DOC);
});

test('改了一镜：「镜头N：」照旧独占一行，后面的空行、别的镜头不动', () => {
  const d = parse(ZONED_DOC);
  d.shots[0].lines = [...SHOT.slice(0, -1), '切点：别处切。'];
  const out = serialize(d);
  assert.ok(out.includes(EOL + '镜头1：' + EOL + SHOT[0] + EOL), '第一栏没挤上镜头那一行');
  assert.ok(out.includes('切点：别处切。' + EOL + EOL + '镜头2：' + EOL));
  assert.equal(out.replace('切点：别处切。', SHOT[SHOT.length - 1]), ZONED_DOC);
});

test('一镜一行换成分区：镜头那一行单独一行，镜头之间空一行', () => {
  const merged = doc(['镜头1：全景，敌人扑上墙头。', '镜头2：直升机掠过。']);
  const d = parse(merged);
  d.shots[0].lines = [...SHOT];
  d.shots[1].lines = [...SHOT.slice(0, 5)];
  const out = serialize(d);
  assert.ok(out.includes('【事件脚本】' + EOL + '镜头1：' + EOL + SHOT[0]));
  assert.ok(out.includes(SHOT[SHOT.length - 1] + EOL + EOL + '镜头2：' + EOL));
  const back = parse(out);
  assert.deepEqual(back.shots.map(s => s.lines), [SHOT, SHOT.slice(0, 5)]);
  assert.deepEqual(back.basic, ['声音包括风声，无背景音乐。']);
});

test('分区换回一镜一行：正文接在镜头那一行后面', () => {
  const d = parse(ZONED_DOC);
  d.shots[0].lines = ['全景，敌人扑上墙头。'];
  d.shots[1].lines = ['直升机掠过。'];
  const back = parse(serialize(d));
  assert.deepEqual(back.shots.map(s => s.lines), [['全景，敌人扑上墙头。'], ['直升机掠过。']]);
  assert.ok(serialize(d).includes('镜头1：全景，敌人扑上墙头。'));
});

test('新加的分区镜头：镜头那一行单独一行，后面空一行', () => {
  const d = parse(doc(['镜头1：全景。']));
  d.shots.push({ no: '2', title: '', lines: [...SHOT.slice(0, 5)] });
  const out = serialize(d);
  assert.ok(out.includes('镜头1：全景。' + EOL + '镜头2：' + EOL + SHOT[0]));
  assert.deepEqual(parse(out).shots[1].lines, SHOT.slice(0, 5));
});
