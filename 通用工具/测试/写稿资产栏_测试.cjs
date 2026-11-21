'use strict';
/* 公用/写稿资产栏.js：写稿页右栏「资产」分 关键帧、人物道具、场景、已引用、未引用 几个小页签（2026-11-20） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const AR = require('../公用/写稿资产栏.js');

const a = (path, type, extra) => {
  const file = path.split('/').pop();
  return { path, file, name: file.replace(/\.[^.]+$/, ''), type: type || '图片', kind: 'prop', ...extra };
};
const names = xs => xs.map(x => x.name);

const 士兵 = a('资产/人物和道具/我军士兵.png', '图片', { kind: 'person' });
const 刀 = a('资产/人物和道具/大砍刀.png');
const 直升机 = a('资产/人物和道具/武装直升机.png');   // 挂上了、没确认可用
const 音色 = a('资产/人物和道具/老李_音色.mp3', '音频');
const 录音 = a('资产/人物和道具/街上录音.mp3', '音频');
const 首帧10 = a('资产/关键帧/第3-4段/镜头10_首帧.png', '图片', { kind: 'frame' });
const 首帧2 = a('资产/关键帧/第3-4段/镜头2_首帧.png', '图片', { kind: 'frame' });
const 空镜 = a('资产/关键帧/第3-4段/空镜/阵地_空镜.png', '图片', { kind: 'scene' });
const 白模 = a('资产/关键帧/第3-4段/镜头1-5_白模.mp4', '视频');
const 测试片 = a('资产/人物和道具/跑步测试.mp4', '视频');
const 街口 = a('资产/场景/街口.png', '图片', { kind: 'scene' });
const 别段 = a('资产/关键帧/第3-3段/火箭炮关键帧/镜头4_发射前.png', '图片', { kind: 'frame' });   // 登记在别处的：照路径认
const 成片截图 = a('成片/第1段/截图.png', '图片', { kind: 'scene' });   // 不在三处里的
const ALL = [士兵, 刀, 直升机, 音色, 录音, 首帧10, 首帧2, 空镜, 白模, 测试片, 街口, 别段, 成片截图];
const OK = new Set([士兵.path, 刀.path, 首帧10.path, 首帧2.path, 空镜.path, 街口.path]);
// 页面那套：只列确认可用的图；白模、人物音色照列；别的视频、音频不列
const show = x => x.type === '图片' ? OK.has(x.path) : x.type === '视频' ? AR.isBaimo(x) : x === 音色;

test('照放在哪个文件夹分：关键帧/第N段、人物和道具、场景；别处的照路径认', () => {
  assert.equal(AR.typeOf(首帧2), '关键帧');
  assert.equal(AR.typeOf(空镜), '关键帧');   // 段文件夹下一层的也算
  assert.equal(AR.typeOf(白模), '关键帧');
  assert.equal(AR.typeOf(士兵), '人物道具');
  assert.equal(AR.typeOf(音色), '人物道具');
  assert.equal(AR.typeOf(街口), '场景');
  assert.equal(AR.typeOf(别段), '关键帧');
  assert.equal(AR.typeOf(a('历史记录/资产/人物和道具/旧刀__20261101-120000.png')), '人物道具');
  assert.equal(AR.typeOf(成片截图), '');
});

test('已引用照编号排、挂上的不管确认没有都列；未引用只列能用的', () => {
  const used = [直升机, 首帧10, 别段];
  const s = AR.sort(ALL, { used, show });
  assert.deepEqual(names(s.lists.已引用), ['武装直升机', '镜头10_首帧', '镜头4_发射前']);
  assert.deepEqual(names(s.lists.未引用), ['我军士兵', '大砍刀', '街口', '镜头1-5_白模', '镜头2_首帧', '老李_音色', '阵地_空镜']);
  assert.ok(!s.lists.未引用.includes(录音) && !s.lists.未引用.includes(测试片), '没确认的录音、别的视频不该列');
});

test('类别页签：挂上的也在里面；人物排前面，镜头2 在镜头10 前面', () => {
  const s = AR.sort(ALL, { used: [直升机, 别段], show });
  assert.deepEqual(names(s.lists.关键帧), ['镜头1-5_白模', '镜头2_首帧', '镜头4_发射前', '镜头10_首帧', '阵地_空镜']);
  assert.deepEqual(names(s.lists.人物道具), ['我军士兵', '大砍刀', '老李_音色', '武装直升机']);
  assert.deepEqual(names(s.lists.场景), ['街口']);
  assert.deepEqual(s.n, { 关键帧: 5, 人物道具: 4, 场景: 1, 已引用: 2, 未引用: 8 });
});

test('场景页签只在有场景的时候摆；另外四个一直在', () => {
  assert.deepEqual(AR.sort(ALL, { show }).tabs, ['关键帧', '人物道具', '场景', '已引用', '未引用']);
  const none = AR.sort(ALL.filter(x => x !== 街口), { show });
  assert.deepEqual(none.tabs, ['关键帧', '人物道具', '已引用', '未引用']);
  assert.deepEqual(AR.sort([], {}).tabs, ['关键帧', '人物道具', '已引用', '未引用']);
  // 搜的时候场景里一个都不合，页签照摆（个数是 0）
  const s = AR.sort(ALL, { show, hit: x => x.name.includes('首帧') });
  assert.ok(s.tabs.includes('场景'));
  assert.equal(s.n.场景, 0);
  assert.equal(s.n.关键帧, 2);
});

test('一类里面分块：图片在前，再是白模视频、别的视频、声音；声音全是人物音色就这么叫', () => {
  const bs = AR.blocksOf([白模, 测试片, 首帧2, 音色], x => x === 音色);
  assert.deepEqual(bs.map(b => b.label), ['图片', '白模视频', '其他视频', '人物音色']);
  assert.deepEqual(bs.map(b => b.items.length), [1, 1, 1, 1]);
  assert.deepEqual(AR.blocksOf([测试片, 录音], x => x === 音色).map(b => b.label), ['视频', '音频']);
  assert.deepEqual(AR.blocksOf([], null), []);
});

/* ---------- 这一条拍的镜头排最前：只认流水线里的关键帧绑定，不看文件名（11-20 他定） ---------- */
const SB = require('../公用/关键帧绑定.js');
const 表 = ['1', '2', '3', '8', '9', '11'].map(号 => ({ 号, 写什么: '镜' + 号 + '的戏' }));
const kf = (n, type) => a('资产/关键帧/第3-4段/' + n + (type === '视频' ? '.mp4' : '.png'), type || '图片', { kind: 'frame' });
const 八首 = kf('镜头8_首帧'), 九首 = kf('镜头9_首帧'), 十一首 = kf('镜头11_首帧'), 十一雾 = kf('镜头11_首帧_雾'), 八尾 = kf('镜头8_尾帧');
const 开门 = kf('开门_特写'), 十首 = kf('镜头10_首帧'), 一首 = kf('镜头1_首帧'), 一全 = kf('镜头1_全景'), 白模11 = kf('镜头11-12_白模', '视频'), 阵地 = kf('阵地_空镜');
const 绑 = SB.bindsOf({ 关键帧绑定: {
  [八首.path]: { 镜: '9', 刻: '首帧', 写什么: '镜9的戏' },   // 名字是镜头8，绑在镜头9 开头
  [九首.path]: { 镜: '9', 刻: '尾帧', 写什么: '镜9的戏' },
  [十一首.path]: { 镜: '11', 刻: '首帧', 写什么: '镜11的戏' },
  [十一雾.path]: { 镜: '11', 刻: '首帧', 备选: true, 写什么: '镜11的戏' },
  [开门.path]: { 镜: '8', 刻: '关键帧', 写什么: '镜8的戏' },   // 名字里没有镜头号，绑在镜头8 中间
  [十首.path]: { 镜: '10', 刻: '首帧', 写什么: '删掉的那一镜' },   // 镜头10 从表里删了
  [一首.path]: { 镜: '1', 刻: '首帧', 写什么: '镜1的戏' },
  [一全.path]: { 镜: '1', 刻: '关键帧', 写什么: '镜1的戏' },
} });
const 帧们 = [阵地, 白模11, 八尾, 十首, 十一雾, 十一首, 九首, 八首, 开门, 一全, 一首];
const shots = mine => ({ paras: 表, mine, binds: 绑 });

test('「关键帧」只摆这一条拍的：只看关键帧绑定，名字里的镜头号不算；白模、空镜、别的镜头的不摆', () => {
  const s = AR.sort([...帧们, 士兵, 刀], { shots: shots(['8', '11']) });
  assert.ok(s.sh.on);
  assert.deepEqual(names(s.lists.关键帧), ['开门_特写', '镜头11_首帧', '镜头11_首帧_雾']);   // 照镜头表：镜8 中间、镜11 开头（现用在前、备选在后）
  assert.equal(s.n.关键帧, 3);
  assert.deepEqual(names(s.lists.未引用.filter(x => AR.typeOf(x) === '关键帧')), ['开门_特写', '镜头11_首帧', '镜头11_首帧_雾'], '未引用里的关键帧也只摆这一条拍的');
  assert.equal(s.lists.未引用.length, 5, '未引用里人物道具照列');
  assert.deepEqual(names(s.lists.人物道具), ['我军士兵', '大砍刀'], '人物道具不受影响');
  assert.deepEqual(names(AR.sort(帧们, { shots: shots(['9']) }).lists.关键帧), ['镜头8_首帧', '镜头9_首帧'], '镜头8_首帧 绑在镜9 开头：拍镜9 的才摆它');
});

test('搜的时候别的镜头的、没绑的也搜，跟在这一条拍的后面；挂上的照样在已引用', () => {
  const s = AR.sort(帧们, { shots: shots(['8', '11']), q: '镜头', hit: x => x.name.includes('镜头') });
  const { mine, rest } = AR.split(s.lists.关键帧, s.sh);
  assert.deepEqual(names(mine), ['镜头11_首帧', '镜头11_首帧_雾']);
  assert.ok(rest.includes(八首) && rest.includes(八尾) && rest.includes(白模11) && !rest.includes(阵地), '搜到的别的该跟在后面：' + names(rest));
  const u = AR.sort(帧们, { shots: shots(['8', '11']), used: [阵地, 一首] });
  assert.deepEqual(names(u.lists.已引用), ['阵地_空镜', '镜头1_首帧'], '挂上的不管是不是这一条拍的，都在已引用');
  assert.ok(!u.lists.关键帧.includes(阵地) && !u.lists.未引用.includes(阵地));
});

test('不知道拍哪几镜、这一场一张没绑过：照旧全摆', () => {
  assert.equal(AR.sort(帧们, { shots: shots([]) }).lists.关键帧.length, 帧们.length, '老名字认不出镜头');
  assert.equal(AR.sort(帧们, { shots: { paras: 表, mine: ['8'], binds: {} } }).lists.关键帧.length, 帧们.length, '这一场没绑过');
  const gone = AR.sort([阵地, 八尾, 白模11], { shots: shots(['8']) });
  assert.ok(!gone.sh.on && gone.lists.关键帧.length === 3, '绑着的图一张都不在：照旧全摆');
});

test('一类里面：绑了的照镜头表、开头中间结尾排，没绑的和绑的镜头删了的放后面照名字', () => {
  const s = AR.sort(帧们, { shots: shots([]) });
  assert.deepEqual(names(s.lists.关键帧), ['镜头1_首帧', '镜头1_全景', '开门_特写', '镜头8_首帧', '镜头9_首帧', '镜头11_首帧', '镜头11_首帧_雾',
    '镜头8_尾帧', '镜头10_首帧', '镜头11-12_白模', '阵地_空镜']);
  assert.deepEqual(names(AR.sort(帧们, { shots: shots([]) }).lists.未引用), names(s.lists.关键帧), '未引用里也照这个排');
  assert.deepEqual(names(AR.sort(帧们, {}).lists.关键帧), ['镜头1_全景', '镜头1_首帧', '镜头8_首帧', '镜头8_尾帧', '镜头9_首帧', '镜头10_首帧', '镜头11_首帧', '镜头11_首帧_雾', '镜头11-12_白模', '开门_特写', '阵地_空镜'],
    '没给镜头和绑定：照名字排，和原来一样');
});

test('图上标绑在哪一镜；这一条的镜头一张都没绑的说出来，这一场没绑过的不说', () => {
  const sh = AR.sort(帧们, { shots: shots(['8', '9', '11', '99']) }).sh;
  assert.deepEqual(sh.mine, ['8', '9', '11'], '表里没有的号不算');
  assert.equal(AR.tagOf(八首, sh).text, '镜9 开头');
  assert.ok(AR.tagOf(八首, sh).title.includes('镜头9「镜9的戏」开头'));
  assert.equal(AR.tagOf(九首, sh).text, '镜9 结尾');
  assert.equal(AR.tagOf(十一雾, sh).text, '镜11 开头 · 备选');
  assert.equal(AR.tagOf(十首, sh).text, '镜10 开头（删了）');
  assert.equal(AR.tagOf(八尾, sh), null);
  assert.equal(AR.tagOf(白模11, sh), null);
  assert.deepEqual(AR.lackOf(帧们, AR.sort(帧们, { shots: shots(['2', '8', '3']) }).sh), ['2', '3']);
  assert.deepEqual(AR.lackOf(帧们.filter(x => x !== 开门), AR.sort(帧们, { shots: shots(['8']) }).sh), ['8'], '绑着的图不在了，也算没绑');
  assert.deepEqual(AR.lackOf([阵地, 八尾], AR.sort(帧们, { shots: shots(['8']) }).sh), [], '这一场一张都没绑过：不说');
  assert.deepEqual(AR.split([八首, 十一首], AR.sort([], {}).sh).mine, [], '没给镜头和绑定：不分');
});
