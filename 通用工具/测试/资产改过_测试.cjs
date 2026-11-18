'use strict';
/* 公用/资产改过.js 的测试：node 通用工具/测试/资产改过_测试.cjs
   资产改了（11-17）：提示词写好以后资产又改了，标出改了哪几样；一键照新资产改：写一份批注交给 AI，都对得上 AI 回 [] */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const A = require('../公用/资产改过.js');
const Core = require('../公用/核心.js');

const times = { '提示词/全局资产/道具/竹棍_提示词.txt': 5000, '资产/全局资产/人物/洪七公.png': 3000, '资产/全局资产/场景/破庙.png': 1000, '提示词/全局资产/场景/破庙_GEO底稿.md': 7000, '资产/第1段/镜头1_首帧.png': 9000 };
const time = f => times[f] || 0;

test('资产格子：只用文字的看文字描写，有图的看图，场景图另看 GEO 底稿；关键帧、AI 另外列的不算', () => {
  const items = [
    { 类别: '道具', 名称: '竹棍', own: true, 只字: true },
    { 类别: '人物', 名称: '洪七公', own: true, at: '资产/全局资产/人物/洪七公.png' },
    { 类别: '场景图', 名称: '破庙', own: true, at: '资产/全局资产/场景/破庙.png' },
    { 类别: '关键帧', 名称: '镜头1_首帧', own: true, at: '资产/第1段/镜头1_首帧.png' },
    { 类别: '道具', 名称: '烤鸡', own: false, at: '资产/全局资产/人物/洪七公.png' },
    { 类别: '道具', 名称: '砂锅', own: true, 只字: true },   // 还没写文字描写
  ];
  const look = it => it.名称 === '竹棍' ? { cat: '道具', name: '竹棍', txtOnly: true, txt: '提示词/全局资产/道具/竹棍_提示词.txt', hasTxt: true }
    : it.名称 === '砂锅' ? { cat: '道具', name: '砂锅', txtOnly: true, txt: '提示词/全局资产/道具/砂锅_提示词.txt', hasTxt: false }
      : it.名称 === '破庙' ? { cat: '场景', name: '破庙', txtOnly: false, geo: '提示词/全局资产/场景/破庙_GEO底稿.md', hasGeo: true } : null;
  const got = A.editsOf(items, look, time).map(p => p.类别 + '/' + p.名称 + '/' + p.改了 + '/' + p.时间);
  assert.deepEqual(got, ['道具/竹棍/文字描写/5000', '人物/洪七公/图/3000', '场景/破庙/图/1000', '场景/破庙/GEO底稿/7000']);
  assert.deepEqual(A.editsOf(null, look, time), []);
});

test('那一行：描写改了带上新描写；后来又动过（图、音色）另算一样', () => {
  const got = A.rowEdits([{ 类别: '人物', 名称: '洪七公', 改: 8000, 描写改: 2000, 描写: ' 老乞丐 ' }, { 类别: '道具', 名称: '竹棍', 改: 4000, 描写改: 4000, 描写: '青竹棍' }, { 类别: '人物', 名称: '张三丰' }, null]);
  assert.deepEqual(got, [
    { 类别: '人物', 名称: '洪七公', 改了: '描写', 时间: 2000, 字: '老乞丐' },
    { 类别: '人物', 名称: '洪七公', 改了: '图或音色', 时间: 8000 },
    { 类别: '道具', 名称: '竹棍', 改了: '描写', 时间: 4000, 字: '青竹棍' },
  ]);
});

test('since 以后改的：差不到一秒不算，同一样只留最后一回，按先后排', () => {
  const parts = [{ 类别: '道具', 名称: '竹棍', 改了: '文字描写', 时间: 5000 }, { 类别: '道具', 名称: '竹棍', 改了: '文字描写', 时间: 9000 },
    { 类别: '人物', 名称: '洪七公', 改了: '图', 时间: 3500 }, { 类别: '人物', 名称: '童大圣', 改了: '图', 时间: 3000 }, { 类别: '', 名称: '', 改了: '出场', 时间: 6000 }];
  assert.deepEqual(A.after(parts, 2400).map(p => p.名称 + p.时间), ['洪七公3500', '6000', '竹棍9000']);
  assert.deepEqual(A.after(parts, 9000), []);
});

test('一句话说改了哪几样；多了只列前几个', () => {
  const ls = [{ 类别: '道具', 名称: '竹棍', 改了: '文字描写' }, { 类别: '人物', 名称: '洪七公', 改了: '文字描写' }, { 类别: '场景', 名称: '破庙', 改了: 'GEO底稿' }, { 类别: '', 名称: '', 改了: '出场' }];
  assert.equal(A.say(ls), '竹棍、洪七公的文字描写；破庙的 GEO 底稿；换了出场的');
  const many = Array.from({ length: 9 }, (_, i) => ({ 类别: '道具', 名称: '物' + i, 改了: '文字描写' }));
  assert.equal(A.say(many, 3), '物0、物1、物2等 9 样的文字描写');
  assert.equal(A.say([]), '');
});

test('照新资产改的批注：MARK 开头，一样一段（缩进，底稿里的 ## 不会被当成段头）；没有字的那一样不写', () => {
  const list = [{ 类别: '道具', 名称: '竹棍', 改了: '文字描写', 字: '一根四尺来长的青竹棍。' }, { 类别: '场景', 名称: '破庙', 改了: 'GEO底稿', 字: '## 1｜空间\n门朝南' },
    { 类别: '人物', 名称: '洪七公', 改了: '图' }, { 类别: '人物', 名称: '童大圣', 改了: '描写', 字: '' }];
  const md = A.noteMd(Core, { title: '第1段 提示词 1-7', file: '项目/测试/提示词/第1段/1-7.txt', list, old: '' });
  assert.ok(md.startsWith('# 批注｜第1段 提示词 1-7\n\n文件：项目/测试/提示词/第1段/1-7.txt'));
  assert.ok(md.includes('## 整体\n批注：' + A.MARK));
  assert.ok(md.includes('1. 道具「竹棍」的文字描写（现在的）：\n  一根四尺来长的青竹棍。'));
  assert.ok(md.includes('2. 场景「破庙」的 GEO 底稿（现在的）：\n  ## 1｜空间\n  门朝南'));
  assert.ok(!md.includes('洪七公') && !md.includes('童大圣'));   // 页面没给「字」（图在哪、新描写）的不写
  assert.ok(!md.includes('换过的图') && !md.includes('换了出场的'));   // 没有这两种，就不说怎么对
  assert.ok(md.includes('都对得上，就回一个空列表 []') && md.includes('@图片、@视频、@音频的编号和挂的文件不动'));
  assert.ok(md.includes('不写他、她') && md.includes('只改它在【主体与关系】里的那一行') && !md.includes('各镜头写成一样'));   // 11-17 第二版：长相不抄进镜头、写名字
  const back = Core.parseNotes(md);
  assert.equal(back.items.length, 0);
  assert.ok(back.general.includes('门朝南'));
  assert.equal(A.isAuto(md), true); assert.equal(A.onlyAuto(md), true);
});

test('原来有人写的批注：逐条、整体都留着；原来这里写过的整体换成新的', () => {
  const mine = Core.notesToMd({ title: 't', file: 'f', general: '整体再紧凑点', items: [{ where: '分镜', text: '镜头1：甲递书。', n: 1, note: '改成双手递' }] });
  const list = [{ 类别: '道具', 名称: '竹棍', 改了: '文字描写', 字: '新竹棍' }];
  const md = A.noteMd(Core, { title: 't', file: 'f', list, old: mine });
  const back = Core.parseNotes(md);
  assert.deepEqual(back.items.map(x => [x.where, x.text, x.note]), [['分镜', '镜头1：甲递书。', '改成双手递']]);
  assert.ok(back.general.startsWith(A.MARK) && back.general.endsWith('整体再紧凑点'));
  assert.equal(A.onlyAuto(md), false);   // 有人写的逐条：AI 回 [] 不能当都对得上
  const again = A.noteMd(Core, { title: 't', file: 'f', list: [{ 类别: '道具', 名称: '竹棍', 改了: '文字描写', 字: '更新的竹棍' }], old: A.noteMd(Core, { title: 't', file: 'f', list, old: '' }) });
  assert.equal(again.split(A.MARK).length, 2);   // 只有一段
  assert.ok(again.includes('更新的竹棍') && !again.includes('  新竹棍'));
  assert.equal(A.isAuto(mine), false); assert.equal(A.onlyAuto(''), false);
});

/* 11-17 晚他问「资产改了，怎么没有按钮更新提示词」：换图、换音色、换出场的也写进批注，交给 AI 对 */
const full = f => '项目/测试/' + f;
test('现在出场的：一类一行；有图写路径，只用文字的写文字描写在哪，文字写的场景照抄那一句；关键帧、AI 另外列的不算', () => {
  const items = [
    { 类别: '人物', 名称: '我军士兵', own: true, at: '资产/全局资产/人物/我军士兵.png' },
    { 类别: '人物', 名称: '炮手', own: true, at: '', 状态: '', 只字: true },
    { 类别: '人物', 名称: '驾驶员', own: true, at: '', 状态: '', 只字: true },
    { 类别: '道具', 名称: '大砍刀', sub: '出鞘', own: true, at: '资产/全局资产/道具/大砍刀_出鞘.png' },
    { 类别: '道具', 名称: '重机枪', own: true, at: '', 状态: '还没有图' },
    { 类别: '场景图', 名称: '镜头1_空镜', sub: '这一段的', own: true, at: '资产/第3-4段/镜头1_空镜.png' },   // 这一段的图：sub 不带
    { 类别: '场景文字', 名称: '江边', own: true, at: '', 文字: '江边码头，傍晚' },
    { 类别: '关键帧', 名称: '镜头1_首帧', own: true, at: '资产/第3-4段/镜头1_首帧.png' },
    { 类别: '道具', 名称: '烤鸡', own: false, at: '资产/全局资产/道具/烤鸡.png' },
    null,
  ];
  const look = it => it.名称 === '炮手' ? { txtOnly: true, hasTxt: true, txt: '提示词/全局资产/人物/炮手_提示词.txt' } : it.名称 === '驾驶员' ? { txtOnly: true, hasTxt: false, txt: 'x' } : null;
  assert.equal(A.castText(items, look, full), [
    '人物：我军士兵（图 项目/测试/资产/全局资产/人物/我军士兵.png）、炮手（只用文字，文字描写 项目/测试/提示词/全局资产/人物/炮手_提示词.txt）、驾驶员（只用文字，还没写文字描写）',
    '道具：大砍刀·出鞘（图 项目/测试/资产/全局资产/道具/大砍刀_出鞘.png）、重机枪（还没有图）',
    '场景：镜头1_空镜（图 项目/测试/资产/第3-4段/镜头1_空镜.png）、江边（文字写的：江边码头，傍晚）'].join('\n'));
  assert.equal(A.castText([], null, full), '');
});

test('那一行现在的图和音色：几张图都列；音色写成空是不用；没有音色这一项就不写', () => {
  assert.equal(A.rowText({ 资产: ['资产/全局资产/人物/甲.png', '', '资产/全局资产/人物/甲_老年.png'], 音色: '资产/全局资产/人物/甲_音色.wav' }, full),
    '图：项目/测试/资产/全局资产/人物/甲.png、项目/测试/资产/全局资产/人物/甲_老年.png\n音色：项目/测试/资产/全局资产/人物/甲_音色.wav');
  assert.equal(A.rowText({ 资产: [], 音色: '' }, full), '图：没有\n音色：不用');
  assert.equal(A.rowText({ 资产: ['a.png'] }), '图：a.png');
  assert.equal(A.rowText(null), '图：没有');
});

test('换图、换音色、换出场的也写进批注：先打开新图看，只对这一条写到的；都对得上照旧回 []', () => {
  const list = [{ 类别: '场景', 名称: '镜头1_空镜', 改了: '图', 字: '项目/测试/资产/第3-4段/镜头1_空镜.png' },
    { 类别: '人物', 名称: '我军士兵', 改了: '图或音色', 字: '图：项目/测试/资产/全局资产/人物/我军士兵.png' },
    { 类别: '', 名称: '', 改了: '出场', 字: '人物：我军士兵（图 …）\n道具：榴弹炮（图 …）' }];
  const md = A.noteMd(Core, { title: 't', file: 'f', list, old: '' });
  assert.ok(md.includes('1. 场景「镜头1_空镜」的图（换过了，打开看现在这张）：\n  项目/测试/资产/第3-4段/镜头1_空镜.png'));
  assert.ok(md.includes('2. 人物「我军士兵」那一行的图或音色（换过了，现在的）：\n  图：项目/测试/资产/全局资产/人物/我军士兵.png'));
  assert.ok(md.includes('3. 这一场出场的（换过了，现在的）：\n  人物：我军士兵（图 …）\n  道具：榴弹炮（图 …）'));
  assert.ok(md.includes('- 换过的图：先打开下面写的那张图看') && md.includes('- 换了出场的：只看这一条已经写到的人物、道具、场景') && md.includes('这一条没写到的不加'));
  const back = Core.parseNotes(md);
  assert.equal(back.items.length, 0);   // 缩进的几行不会被当成人写的逐条批注
  assert.ok(back.general.includes('道具：榴弹炮'));
  assert.equal(A.onlyAuto(md), true);   // AI 回 [] 时本机服务照旧只更新时间
  assert.equal(A.say(list), '镜头1_空镜的图；我军士兵的图或音色；换了出场的');
});
