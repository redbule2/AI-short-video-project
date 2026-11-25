'use strict';
/* 公用/资产认图.js 的测试：node --test 通用工具/测试/资产认图_测试.cjs
   项目里本来就有的图，照名字认上（2026-11-25）：人物、道具表里没图的行认同名的图，只用文字写的场景认同名的场景图；认上的算确认可用；
   提炼的任务书带上「项目里已经有图、全片设定里还没列的名字」。另外查一遍：引了 流水线.js 的页面都引了它 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const M = require('../公用/资产认图.js');

const CP = '人物和道具', SC = '场景';
const img = (c, name, ext = 'png') => ({ 类别: c, 名称: name, 文件: '资产/' + c + '/' + name + '.' + ext, mtime: 1000 });
const f = (c, name, ext = 'png') => '资产/' + c + '/' + name + '.' + ext;
const flow = more => ({ 人物: [{ 名: '李云龙', 描写: '团长', 资产: [] }, { 名: '童爸爸', 描写: '', 资产: [] }], 道具: [{ 名: '榴弹炮', 描写: '', 资产: [] }], 场景: '', 场景图: [], 场: [], 可用: {}, ...more });

test('人物、道具：图名和这一行的名字一模一样就认；没有一样的，叫法对得上、只有一张的也认', () => {
  const pool = [img(CP, '李云龙'), img(CP, '童爸爸_三十出头'), img(CP, '榴弹炮'), img(CP, '飞碟')];
  assert.deepEqual(M.rowPicks(flow(), pool), [{ 类别: '人物', 名: '李云龙', 文件: f(CP, '李云龙') }, { 类别: '人物', 名: '童爸爸', 文件: f(CP, '童爸爸_三十出头') }, { 类别: '道具', 名: '榴弹炮', 文件: f(CP, '榴弹炮') }]);
  // 有一模一样的：只认它，带状态的那几张留给人加
  assert.equal(M.pickRow('面车', [img(CP, '面车'), img(CP, '面车_骑行状态')]), f(CP, '面车'));
});

test('拿不准的不认：好几张叫法都对得上、同名不同后缀的两张、做图过程里的文件', () => {
  assert.equal(M.pickRow('童爸爸', [img(CP, '童爸爸_三十出头'), img(CP, '童爸爸_老年')]), '');
  assert.equal(M.pickRow('李云龙', [img(CP, '李云龙'), img(CP, '李云龙', 'jpg')]), '');
  for (const tail of ['底图', '白模', 'Tripo第一版_姿势测试', '正面_叠图', '对照']) assert.equal(M.pickRow('榴弹炮', [img(CP, '榴弹炮_' + tail)]), '', tail);
  // 过程文件旁边有成品：认成品
  assert.equal(M.pickRow('武装直升机', [img(CP, '武装直升机_底图'), img(CP, '武装直升机')]), f(CP, '武装直升机'));
  // 场景文件夹里的图不拿来挂人物、道具
  assert.deepEqual(M.rowPicks(flow(), [img(SC, '李云龙')]), []);
});

test('不认的几种：这一行已经有图、图挂在别的行、这一行说过不用、哪一段标了只用文字；挂的图不在了的重新认', () => {
  const pool = [img(CP, '李云龙'), img(CP, '榴弹炮')];
  const has = flow(); has.人物[0].资产 = [f(CP, '李云龙_旧')];
  assert.deepEqual(M.rowPicks(has, pool).map(x => x.名), ['榴弹炮']);
  assert.deepEqual(M.rowPicks(has, pool, new Set([f(CP, '李云龙_旧')])).map(x => x.名), ['李云龙', '榴弹炮']);   // 原来挂的那张文件不在了
  const taken = flow(); taken.道具.push({ 名: '重炮', 描写: '', 资产: f(CP, '榴弹炮') });   // 一张图写成字符串的也认
  assert.deepEqual(M.rowPicks(taken, pool).map(x => x.名), ['李云龙']);
  const no = flow(); no.人物[0].不用 = ['资产/人物和道具/李云龙.PNG'];   // 大小写不一样也算同一张
  assert.deepEqual(M.rowPicks(no, pool).map(x => x.名), ['榴弹炮']);
  const txt = flow({ 场: [{ 段: '1', 不出图: { 道具: ['榴弹炮'] } }] });
  assert.deepEqual(M.rowPicks(txt, pool).map(x => x.名), ['李云龙']);
  // 一张图只给一行：人物表、道具表里同名的，先到的拿走
  const twice = flow(); twice.道具.push({ 名: '李云龙', 描写: '', 资产: [] });
  assert.deepEqual(M.rowPicks(twice, pool).map(x => x.类别 + x.名), ['人物李云龙', '道具榴弹炮']);
});

test('只用文字写的场景：场景文件夹里正好有一张同名的图就认；标了只用文字的、图旧了的、同名两张的不认', () => {
  const d = flow({ 场: [{ 段: '1-1', 场景文字: ['菜市场路：傍晚，路两边挤满摊子', '出租屋：一张床'] }, { 段: '1-2', 场景文字: ['菜市场路：傍晚，路两边挤满摊子'], 不出图: { 场景: ['菜市场路'] } }] });
  const pool = [img(SC, '菜市场路'), img(CP, '出租屋')];
  assert.deepEqual(M.scenePicks(d, pool), [{ 段: '1-1', 文字: '菜市场路：傍晚，路两边挤满摊子', 名: '菜市场路', 文件: f(SC, '菜市场路') }]);
  assert.deepEqual(M.scenePicks(d, pool, (file, k) => file === f(SC, '菜市场路') && k[0] === '场景' && k[1] === '菜市场路'), []);
  assert.deepEqual(M.scenePicks(d, [img(SC, '菜市场路'), img(SC, '菜市场路', 'jpg')]), []);
});

test('认上：人物换成认上的那张、道具接在后面，算确认可用（时间照图的），各样都交回页面去记', () => {
  const d = flow({ 场: [{ 段: '1', 场景文字: ['面摊：路边一个小面摊'], 场景图: [] }] });
  d.道具[0].资产 = [f(CP, '榴弹炮_没了')];
  d.可用[f(CP, '榴弹炮')] = '2026-11-25 08:00:00';   // 以前确认过、比图的时间还新：照旧
  const pool = [img(CP, '李云龙'), img(CP, '榴弹炮'), img(SC, '面摊')], log = [];
  const got = M.apply(d, pool, { gone: new Set([f(CP, '榴弹炮_没了')]), old: () => false, when: (file, e) => { log.push(['when', file, e ? e.名 : null]); return '2026-11-20 10:00:00'; },
    note: (file, k) => log.push(['note', file, k.join('/')]), row: (k, e, t) => log.push(['row', k, e.名, t]),
    scene: (s, line, file, t) => { s.场景图.push(file); s.场景文字 = []; log.push(['scene', s.段, line, file, t]); } });
  assert.deepEqual(got, [{ 类别: '人物', 名: '李云龙', 文件: f(CP, '李云龙') }, { 类别: '道具', 名: '榴弹炮', 文件: f(CP, '榴弹炮') }, { 类别: '场景', 名: '面摊', 文件: f(SC, '面摊') }]);
  assert.deepEqual(d.人物[0].资产, [f(CP, '李云龙')]);
  assert.deepEqual(d.道具[0].资产, [f(CP, '榴弹炮_没了'), f(CP, '榴弹炮')]);
  assert.deepEqual(d.可用, { [f(CP, '榴弹炮')]: '2026-11-25 08:00:00', [f(CP, '李云龙')]: '2026-11-20 10:00:00', [f(SC, '面摊')]: '2026-11-20 10:00:00' });
  assert.deepEqual(log.filter(x => x[0] === 'row'), [['row', '人物', '李云龙', '2026-11-20 10:00:00'], ['row', '道具', '榴弹炮', '2026-11-20 10:00:00']]);
  assert.deepEqual(log.filter(x => x[0] === 'scene'), [['scene', '1', '面摊：路边一个小面摊', f(SC, '面摊'), '2026-11-20 10:00:00']]);
  assert.deepEqual(log.filter(x => x[0] === 'note'), [['note', f(CP, '李云龙'), '人物/李云龙'], ['note', f(CP, '榴弹炮'), '道具/榴弹炮'], ['note', f(SC, '面摊'), '场景/面摊']]);
  assert.deepEqual(log.filter(x => x[0] === 'when'), [['when', f(CP, '李云龙'), '李云龙'], ['when', f(CP, '榴弹炮'), '榴弹炮'], ['when', f(SC, '面摊'), null]]);   // 记什么时间由页面定：人物、道具把那一行交过去（描写改过的照改的时间），场景没有那一行
  // 再认一遍：没有可认的了，什么都不动
  assert.deepEqual(M.apply(d, pool, { gone: new Set([f(CP, '榴弹炮_没了')]), old: () => false, when: () => 'x', note() { assert.fail('不该再记'); }, row() {}, scene() {} }), []);
});

test('跟人说的那一句：同一张图几段都用上只说一回；一张都没认上不说', () => {
  assert.equal(M.say([]), '');
  const one = { 类别: '场景', 名: '面摊', 文件: f(SC, '面摊') };
  assert.equal(M.say([{ 类别: '人物', 名: '李云龙', 文件: f(CP, '李云龙') }, one, one]), '照名字认上了 2 张图：人物「李云龙」、场景「面摊」。都算确认可用；认错了的，点那张卡上的 × 取下。');
  assert.match(M.say(Array.from({ length: 8 }, (x, i) => ({ 类别: '道具', 名: '炮' + i, 文件: f(CP, '炮' + i) }))), /^照名字认上了 8 张图：.*道具「炮5」 等。/);
});

test('提炼的任务书：列出有图、全片设定里还没列的名字；表里有的、过程文件、场景里已经写了的地方、用着的场景图不列', () => {
  const d = { 人物: [{ 名: '李云龙', 资产: f(CP, '李云龙') }], 道具: [{ 名: '大砍刀', 资产: [] }], 场景: '面摊：路边一个小面摊', 场景图: [f(SC, '榴弹炮局部俯拍')], 场: [{ 段: '1', 场景图: [f(SC, '战场')] }] };
  const pool = [img(CP, '李云龙'), img(CP, '大砍刀'), img(CP, '童爸爸_三十出头'), img(CP, '外星战士'), img(CP, '外星战士_Tripo第一版_四视图'), img(CP, '飞碟_底图'),
    img(SC, '菜市场路'), img(SC, '面摊'), img(SC, '我方半场_反向_白模'), img(SC, '榴弹炮局部俯拍'), img(SC, '战场')];
  const names = M.freeNames(d, pool);
  assert.deepEqual(names, { 物: ['童爸爸', '外星战士'], 景: ['菜市场路'] });   // 大砍刀表里有这一行（没图）：页面自己认，不用告诉 AI
  assert.equal(M.bookLine(names), '项目里已经有现成的图、全片设定里还没列的：人物和道具「童爸爸」「外星战士」；场景「菜市场路」。剧本里出场的要是其中哪一样，名字就照这个写（场景是冒号前面的地方名），一个字不差，好和图对上；剧本里没有的不要列。');
  assert.equal(M.bookLine(M.freeNames(d, [])), '');
  assert.equal(M.bookLine({ 物: [], 景: ['菜市场路'] }), '项目里已经有现成的图、全片设定里还没列的：场景「菜市场路」。剧本里出场的要是其中哪一样，名字就照这个写（场景是冒号前面的地方名），一个字不差，好和图对上；剧本里没有的不要列。');
});

test('本机服务读文件夹：只要 人物和道具、场景 本层的图，候选图、别的文件不算', async () => {
  const dirs = { 'X/人物和道具': ['李云龙.png', '李云龙_候选.png', '李云龙.png_生成记录.json', '外星战士.webp', 'rq'], 'X/场景': ['菜市场路.JPG'] };
  const pool = await M.poolOn(async d => dirs[d], c => 'X/' + c);
  assert.deepEqual(pool, [{ 类别: CP, 名称: '外星战士', 文件: f(CP, '外星战士', 'webp') }, { 类别: CP, 名称: '李云龙', 文件: f(CP, '李云龙') }, { 类别: SC, 名称: '菜市场路', 文件: f(SC, '菜市场路', 'JPG') }]);
  assert.deepEqual(await M.poolOn(async () => null, c => c), []);   // 没有这个文件夹
});

test('引了 流水线.js 的页面，都在它前面引了 公用/资产认图.js（少引一页，那一页就不认图）', () => {
  const dir = path.join(__dirname, '..', '流水线');
  const pages = fs.readdirSync(dir).filter(n => n.endsWith('.html')).filter(n => /<script src="流水线\.js"><\/script>/.test(fs.readFileSync(path.join(dir, n), 'utf8')));
  assert.ok(pages.length >= 8, '该有八页：' + pages.join('、'));
  for (const n of pages) {
    const html = fs.readFileSync(path.join(dir, n), 'utf8'), a = html.indexOf('<script src="../公用/资产认图.js"></script>'), b = html.indexOf('<script src="流水线.js"></script>');
    assert.ok(a > 0 && a < b, n + ' 没在 流水线.js 前面引 公用/资产认图.js');
  }
});
