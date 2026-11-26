'use strict';
/* 桌面版「视频教程」页的测试：node 通用工具/测试/视频教程_测试.cjs
   11-26 他定：教程视频先不上网，软件只认本机「通用工具」里的「…教程」文件夹。
   这里试认课、记看到哪（桌面版/页面/视频教程/教程目录.js），和这一页引的文件齐不齐、脚本顶层名字重不重。
   真放片在整套软件里试：桌面版/scripts/smoke.mjs（用旁边的 视频教程_样片.mp4）。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../桌面版/页面/视频教程/教程目录.js');

const PAGE_DIR = path.join(__dirname, '../桌面版/页面/视频教程');

test('哪些文件夹算一套课、一课', () => {
  assert.equal(L.isCourse('Codex教程'), true);
  assert.equal(L.isCourse('Seedance提示词教程'), true);
  assert.equal(L.isCourse('流水线'), false);
  assert.equal(L.isCourse('教程测试'), false);   // 「教程」得在末尾
  assert.equal(L.isCourse('.教程'), false);
  assert.deepEqual(L.lessonOf('第1课_界面和模型'), { no: 1, title: '界面和模型' });
  assert.deepEqual(L.lessonOf('第12课 保持一致'), { no: 12, title: '保持一致' });
  assert.deepEqual(L.lessonOf('第3课'), { no: 3, title: '第 3 课' });   // 没写标题的拿课号当名字
  assert.equal(L.lessonOf('__pycache__'), null);
  assert.equal(L.lessonOf('第一课_打开'), null);   // 课号要写数字
});

test('一课的视频：和文件夹同名的优先；配套材料只认文档', () => {
  const files = ['截图_首页.png', '配音.wav', '试片.mp4', '第2课_回复模式.mp4', '练习题.docx', '~$练习题.docx', '第2课_回复模式.pdf', '画面.json', '解说词.txt'];
  assert.equal(L.pickVideo('第2课_回复模式', files), '第2课_回复模式.mp4');
  assert.equal(L.pickVideo('第2课_回复模式', ['b.mp4', 'a.MP4']), 'a.MP4');   // 没有同名的拿头一个
  assert.equal(L.pickVideo('第2课_回复模式', ['配音.wav']), '');
  assert.deepEqual(L.materials(files), ['第2课_回复模式.pdf', '练习题.docx']);
});

const RAW = [
  { name: 'Seedance提示词教程', lessons: [{ dir: '第10课_视频编辑', files: ['第10课_视频编辑.mp4'] }, { dir: '第2课_参考素材职责', files: ['第2课_参考素材职责.mp4', '练习题.docx'] }, { dir: '第9课_首帧尾帧', files: ['解说词.txt'] }] },
  { name: '流水线教程', lessons: [{ dir: '__pycache__', files: ['x.pyc'] }, { dir: '第1课_打开流水线', files: ['第1课_打开流水线.mp4', '第1课_打开流水线.pdf'] }] },
  { name: 'Codex教程', lessons: [{ dir: '第1课_界面和模型', files: ['第1课_界面和模型.mp4'] }] },
  { name: '空教程', lessons: [{ dir: '第1课_还没做', files: ['解说词.txt'] }] },
  { name: '公用', lessons: [{ dir: '第1课_不是课', files: ['a.mp4'] }] },
];

test('课表：没视频的课、一课都没有的套、不是教程的文件夹都不摆；课照课号排', () => {
  const cs = L.build(RAW);
  assert.deepEqual(cs.map(c => c.name).sort(), ['Codex教程', 'Seedance提示词教程', '流水线教程']);
  assert.deepEqual(cs.map(c => c.name), [...cs.map(c => c.name)].sort((a, b) => a.localeCompare(b, 'zh', { numeric: true })));
  const sd = cs.find(c => c.name === 'Seedance提示词教程');
  assert.deepEqual(sd.lessons.map(l => l.no), [2, 10]);   // 第 10 课排在第 2 课后面，第 9 课没视频不摆
  assert.deepEqual(sd.lessons[0], { id: 'Seedance提示词教程/第2课_参考素材职责', course: 'Seedance提示词教程', dir: '第2课_参考素材职责', no: 2, title: '参考素材职责', video: '第2课_参考素材职责.mp4', materials: ['练习题.docx'] });
  assert.equal(L.flat(cs).length, 4);
  assert.equal(L.find(cs, '流水线教程/第1课_打开流水线').materials[0], '第1课_打开流水线.pdf');
  assert.equal(L.find(cs, '没有这一课'), null);
  assert.deepEqual(L.build([]), []);
});

test('上一课、下一课：跨着一套套课连着走', () => {
  const cs = L.build(RAW), all = L.flat(cs);
  assert.deepEqual(L.around(cs, all[0].id), { prev: null, next: all[1] });
  assert.deepEqual(L.around(cs, all[1].id), { prev: all[0], next: all[2] });
  assert.deepEqual(L.around(cs, all[3].id), { prev: all[2], next: null });
  assert.deepEqual(L.around(cs, '没有这一课'), { prev: null, next: null });
});

test('看到哪：记秒数；快到结尾、放到头算看完；看完过的再看还算看完', () => {
  let s = L.fix(null);
  assert.deepEqual(s, { last: '', seen: {} });
  s = L.mark(s, 'a', 30, 120);
  assert.deepEqual(s, { last: 'a', seen: { a: { t: 30, d: 120, done: false } } });
  assert.equal(L.resumeAt(s, 'a'), 30);
  assert.equal(L.isDone(s, 'a'), false);
  s = L.mark(s, 'a', 120 - L.DONE_LEFT, 120);
  assert.equal(L.isDone(s, 'a'), true);
  assert.equal(L.resumeAt(s, 'a'), 0);   // 看完了的下回从头
  s = L.mark(s, 'a', 10, 120);
  assert.equal(L.isDone(s, 'a'), true);   // 再看一遍，还算看完
  assert.equal(L.resumeAt(s, 'a'), 10);
  s = L.mark(s, 'b', 1, 60);
  assert.equal(L.resumeAt(s, 'b'), 0);   // 才看了一两秒，下回从头
  s = L.mark(s, 'c', 20, 60, true);
  assert.equal(L.isDone(s, 'c'), true);   // 放到头
  assert.equal(s.last, 'c');
  assert.equal(L.lengthOf(s, 'c'), 60);
  assert.equal(L.lengthOf(s, '没看过'), 0);
  assert.equal(L.doneCount(s, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]), 2);
  assert.equal(L.mark(s, 'e', 500, 60).seen.e.t, 60);   // 秒数不会超过全长
  assert.deepEqual(L.mark(L.fix(null), 'f', 5, NaN).seen.f, { t: 5, d: 0, done: false });   // 全长还不知道
});

test('存着的那一份读回来：坏的、认不出的当没看过', () => {
  assert.deepEqual(L.fix('乱写的'), { last: '', seen: {} });
  assert.deepEqual(L.fix({ last: 5, seen: [] }), { last: '', seen: {} });
  assert.deepEqual(L.fix({ last: 'a', seen: { a: { t: '3', d: -1, done: 1 }, b: null, c: { t: 4, d: 9 } } }), { last: 'a', seen: { a: { t: 0, d: 0, done: true }, c: { t: 4, d: 9, done: false } } });
  const back = JSON.parse(JSON.stringify(L.mark(L.fix(null), 'a', 30, 120)));
  assert.deepEqual(L.fix(back), { last: 'a', seen: { a: { t: 30, d: 120, done: false } } });
});

test('一打开先摆哪一课：上回看的；没有就头一课没看完的；都看完了就头一课', () => {
  const cs = L.build(RAW), all = L.flat(cs);
  assert.equal(L.first(cs, L.fix(null)), all[0]);
  assert.equal(L.first(cs, L.fix({ last: all[2].id })), all[2]);
  assert.equal(L.first(cs, L.fix({ last: '删掉了的课', seen: { [all[0].id]: { t: 9, d: 9, done: true } } })), all[1]);
  const seen = Object.fromEntries(all.map(l => [l.id, { t: 9, d: 9, done: true }]));
  assert.equal(L.first(cs, L.fix({ seen })), all[0]);
  assert.equal(L.first([], L.fix(null)), null);
});

test('秒数写成 分:秒', () => {
  assert.equal(L.clock(0), '0:00');
  assert.equal(L.clock(65.9), '1:05');
  assert.equal(L.clock(126.8), '2:06');
  assert.equal(L.clock(NaN), '0:00');
});

/* 这一页引的文件 */
const html = fs.readFileSync(path.join(PAGE_DIR, '视频教程.html'), 'utf8');
const refs = [...html.matchAll(/<(?:script\b[^>]*\bsrc|link\b[^>]*\bhref)="([^"]+)"/g)].map(m => path.resolve(PAGE_DIR, decodeURI(m[1])));

test('这一页引的脚本、样式都在；脚本接在一起顶层名字不重', () => {
  assert.ok(refs.length >= 7);
  for (const f of refs) assert.ok(fs.existsSync(f), '没有这个文件：' + f);
  const code = refs.filter(f => f.endsWith('.js')).map(f => fs.readFileSync(f, 'utf8')).join('\n;\n');
  assert.doesNotThrow(() => new vm.Script('void 0;\n' + code, { filename: '视频教程页的脚本.js' }));   // 只编译不运行：顶层 const、let 重名会在这里报
});

test('这一页的样式不写死颜色，只用 公用/样式.css 里的变量（颜色在它引的 皮肤.css；换皮肤跟着变）', () => {
  const css = fs.readFileSync(path.join(PAGE_DIR, '视频教程.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g), null);
  const known = new Set(['样式.css', '皮肤.css'].flatMap(f => [...fs.readFileSync(path.join(__dirname, '../公用', f), 'utf8').matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1])));
  for (const [, name] of css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(known.has(name), '样式.css、皮肤.css 里都没有这个变量：' + name);
});

test('菜单里有「视频教程」，指的就是这一页', () => {
  const { find } = require('../桌面版/lib/routes.js');
  const r = find('tutorial');
  assert.ok(r && r.名 === '视频教程');
  assert.equal(path.resolve(__dirname, '../..', r.页), path.join(PAGE_DIR, '视频教程.html'));
});
