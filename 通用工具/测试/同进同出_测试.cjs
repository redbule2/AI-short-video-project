'use strict';
/* 提示词和它出的样片同进同出（2026-11-26 他定：「如果成片在历史记录，那么提示词也应该进历史记录，反之……」；又问别的 AI、人挪的怎么办）：
   公用/历史记录.js 的 pairs（哪些对不上）、promptKin、dated；.agents/skills/annotate-live/pair-keeper.js（跟着挪、盯文件夹、/api/pairs）。
   读写都在临时文件夹里，不碰真项目。node --test 通用工具/测试/同进同出_测试.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const TOOLS = path.resolve(__dirname, '..');
const SKILL = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const Hist = require(path.join(TOOLS, '公用', '历史记录.js'));
const makeFilmed = require(path.join(SKILL, 'filmed.js'));
const makePairs = require(path.join(SKILL, 'pair-keeper.js'));
const plain = x => JSON.parse(JSON.stringify(x));

test('pairs：提示词还在用、它的片全在历史记录（a）；片还在成片、提示词只在历史记录（b）', () => {
  const r = Hist.pairs({
    curs: ['15-16.txt', '15-16_改1.txt', '15-16_改2.txt', '15-16_写稿.json', '7.txt', '9.txt', '20.txt'],
    olds: ['8-9_改2__20261122-170134.txt', '8-9_改2__20261121-233848.txt', '15-16__20261124-175400.txt', '13b-14_改3__20261124-171553.txt'],
    here: ['15-16_改2.mp4', '15-16_改2_抽帧.jpg', '7_改1_后期补.mp4', '8-9_改2.mp4', '8-9_改2_后期补.mp4', '13b-14_改3_混剪_3.mp4', '孤儿.mp4', '20.mp4'],
    hist: ['15-16.mp4', '15-16_改1.mp4', '15-16_改1_批注.md', '9__20261120-101010.mp4', '7_改1.mp4', '20_2.mp4'],
  });
  assert.deepEqual(plain(r.a), [{ name: '15-16.txt', clips: ['15-16.mp4'] }, { name: '15-16_改1.txt', clips: ['15-16_改1.mp4'] }]);
  assert.deepEqual(plain(r.b), [
    { vid: '8-9_改2.mp4', from: ['8-9_改2__20261122-170134.txt', '8-9_改2__20261121-233848.txt'] },
    { vid: '8-9_改2_后期补.mp4', from: ['8-9_改2__20261122-170134.txt', '8-9_改2__20261121-233848.txt'] },
    { vid: '13b-14_改3_混剪_3.mp4', from: ['13b-14_改3__20261124-171553.txt'] }]);
  // 9.txt：历史记录里只有删掉那一版的（带时间）片，不算；20.txt：再出的第 2 条收进去了、第 1 条还在成片，不算；7.txt 没出过片（7_改1 是另一版）
});

test('pairs：同一版还有片在成片（后期补的）不算；改过名的照旧名字认；老名字（第N条）的不管', () => {
  const kin = Hist.pairs({ curs: ['2-4_改2.txt'], here: ['2-4_改2_后期补.mp4'], hist: ['2-4_改2.mp4'] });
  assert.deepEqual(plain(kin), { a: [], b: [] }, '后期补的片还在成片：提示词留着');
  const rn = { '13b-15b.txt': '13b-14.txt', '13b-15b_改1.txt': '13b-14_改1.txt' };
  const ren = Hist.pairs({ curs: ['13b-14.txt', '13b-14_改1.txt'], hist: ['13b-15b.mp4'], here: ['13b-15b_改1.mp4'], rn });
  assert.deepEqual(plain(ren.a), [{ name: '13b-14.txt', clips: ['13b-15b.mp4'] }]);
  const rb = Hist.pairs({ olds: ['13b-14_改1__20261126-100000.txt'], here: ['13b-15b_改1.mp4'], rn });
  assert.deepEqual(plain(rb.b), [{ vid: '13b-15b_改1.mp4', from: ['13b-14_改1__20261126-100000.txt'] }], '历史记录里的也照改名认');
  const old = Hist.pairs({ curs: ['2-3.txt'], olds: ['镜头4-5_视频提示词__20261113-064313.txt'], hist: ['第1-1段_第3条_2-3_720p.mp4'], here: ['第3-3段_第24条_镜头4-5_mini720p.mp4'] });
  assert.deepEqual(plain(old), { a: [], b: [] });
});

test('promptKin、dated：跟着提示词走的几样，收进去叫什么', () => {
  const names = ['1-5_改1.txt', '1-5_改1_写稿.json', '1-5_改1_批注.md', '1-5_改1_AI批注.md', '1-5_出片任务_改1.txt', '1-5_改1_批注截图', '1-5_改2.txt', '1-5_改2_写稿.json'];
  assert.deepEqual(Hist.promptKin('1-5_改1.txt', names), [['1-5_改1_写稿.json', '写稿资料'], ['1-5_改1_批注.md', '批注'], ['1-5_改1_AI批注.md', 'AI 批注'], ['1-5_出片任务_改1.txt', '出片任务书'], ['1-5_改1_批注截图', '批注截图']]);
  assert.equal(Hist.dated('1-5_改1.txt', '20261126-160000'), '1-5_改1__20261126-160000.txt');
  assert.equal(Hist.dated('1-5_改1_批注截图', '20261126-160000'), '1-5_改1_批注截图__20261126-160000');
  assert.equal(Hist.stampOf(new Date(2026, 10, 26, 9, 5, 7)), '20261126-090507');
});

/* 临时项目：试/第3-4段，files 是 项目里的路径 → 字（以 / 结尾的是文件夹） */
async function setup(t, files, { live = [], quiet = 60e3 } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), '同进同出测试-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const P = rel => path.join(root, '项目', '试', ...rel.split('/'));
  for (const [rel, text] of Object.entries(files)) {
    if (rel.endsWith('/')) { await fsp.mkdir(P(rel), { recursive: true }); continue; }
    await fsp.mkdir(path.dirname(P(rel)), { recursive: true });
    await fsp.writeFile(P(rel), text);
  }
  const logs = [];
  const filmed = makeFilmed({ ROOT: root, TOOLS, live: () => live });
  const keeper = makePairs({ ROOT: root, TOOLS, filmed, log: m => logs.push(m), quiet, clock: () => new Date(2026, 10, 26, 16, 0, 0) });
  t.after(() => keeper.close());
  const has = rel => fs.existsSync(P(rel));
  return { root, P, has, keeper, logs };
}
const ST = '20261126-160000';

test('settle：片全进了历史记录 → 提示词连写稿资料、批注、出片任务书、批注截图收进去（同一个时间）；片还在成片、提示词在历史记录 → 片连批注收进去（名字不改）', async t => {
  const { has, keeper, logs } = await setup(t, {
    '提示词/第3-4段/15-16_改1.txt': '稿', '提示词/第3-4段/15-16_改1_写稿.json': '{}', '提示词/第3-4段/15-16_改1_批注.md': '批', '提示词/第3-4段/15-16_出片任务_改1.txt': '任务',
    '提示词/第3-4段/15-16_改1_批注截图/1.png': 'png', '提示词/第3-4段/15-16_改2.txt': '新稿', '提示词/第3-4段/15-16_改2_写稿.json': '{}',
    '成片/第3-4段/15-16_改2.mp4': 'v', '历史记录/成片/第3-4段/15-16_改1.mp4': 'v',
    '历史记录/提示词/第3-4段/8-9_改2__20261122-170134.txt': '旧稿', '成片/第3-4段/8-9_改2.mp4': 'v', '成片/第3-4段/8-9_改2_批注.md': '批', '成片/第3-4段/8-9_改2_批注截图/1.jpg': 'j',
    '成片/第3-4段/8-9_改2_后期补.mp4': 'v',
  });
  const r = await keeper.settle('试', '3-4', '测试');
  assert.deepEqual(plain(r.提示词), ['15-16_改1.txt']);
  assert.deepEqual(plain(r.片), ['8-9_改2.mp4', '8-9_改2_后期补.mp4']);
  assert.deepEqual(r.没挪, []);
  for (const n of ['15-16_改1__' + ST + '.txt', '15-16_改1_写稿__' + ST + '.json', '15-16_改1_批注__' + ST + '.md', '15-16_出片任务_改1__' + ST + '.txt', '15-16_改1_批注截图__' + ST + '/1.png']) assert.ok(has('历史记录/提示词/第3-4段/' + n), n);
  assert.ok(has('提示词/第3-4段/15-16_改2.txt') && has('提示词/第3-4段/15-16_改2_写稿.json') && has('成片/第3-4段/15-16_改2.mp4'), '新的一版不动');
  for (const n of ['8-9_改2.mp4', '8-9_改2_批注.md', '8-9_改2_批注截图/1.jpg', '8-9_改2_后期补.mp4']) assert.ok(has('历史记录/成片/第3-4段/' + n), n);
  assert.ok(!has('成片/第3-4段/8-9_改2.mp4'));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /同进同出（试 第3-4段，测试）/);
  assert.deepEqual(plain(await keeper.scan('试', '3-4')), { a: [], b: [] }, '理完就对上了');
  assert.deepEqual(plain(await keeper.settle('试', '3-4')), { 提示词: [], 片: [], 挪了: [], 没挪: [] }, '再理一遍不动');
});

test('settle：正在出片的那一版、AI 在用的片不动；那里有同名的不盖，记下没挪', async t => {
  const { has, keeper } = await setup(t, {
    '提示词/第3-4段/1.txt': '稿', '历史记录/成片/第3-4段/1.mp4': 'v', '提示词/第3-4段/1_出片任务.txt': '任务',
    '提示词/第3-4段/2.txt': '稿', '历史记录/成片/第3-4段/2.mp4': 'v', ['历史记录/提示词/第3-4段/2__' + ST + '.txt']: '同名的',
    '历史记录/提示词/第3-4段/3__20261120-101010.txt': '旧稿', '成片/第3-4段/3.mp4': 'v',
  }, { live: [{ 项目: '试', 段: '3-4', 事: '出片', 名: '1_出片任务.txt' }, { 项目: '试', 段: '3-4', 事: '审片', 视频: '3.mp4' }] });
  const r = await keeper.settle('试', '3-4');
  assert.deepEqual(plain(r.提示词), []);
  assert.deepEqual(plain(r.片), []);
  assert.equal(r.没挪.length, 3);
  assert.match(r.没挪.join('\n'), /「1\.txt」正在出片/);
  assert.match(r.没挪.join('\n'), /「2\.txt」：那里已经有同名的了/);
  assert.match(r.没挪.join('\n'), /「3\.mp4」AI 正在照它做事/);
  assert.ok(has('提示词/第3-4段/1.txt') && has('提示词/第3-4段/2.txt') && has('成片/第3-4段/3.mp4'));
});

test('盯着文件夹：人或别的 AI 把片挪进历史记录，静下来以后提示词跟着进；挪的是提示词，片跟着进', async t => {
  const { P, has, keeper } = await setup(t, {
    '提示词/第3-4段/5.txt': '稿', '成片/第3-4段/5.mp4': 'v', '提示词/第3-4段/6.txt': '稿', '成片/第3-4段/6.mp4': 'v', '成片/第3-4段/6_批注.md': '批',
    '历史记录/成片/第3-4段/': '', '历史记录/提示词/第3-4段/': '',
  }, { quiet: 150 });
  keeper.watch({ sweepAfter: -1 });
  await new Promise(r => setTimeout(r, 300));
  await fsp.rename(P('成片/第3-4段/5.mp4'), P('历史记录/成片/第3-4段/5.mp4'));   // 人把片拖进历史记录
  await fsp.rename(P('提示词/第3-4段/6.txt'), P('历史记录/提示词/第3-4段/6__20261126-150000.txt'));   // 别的 AI 只挪了提示词
  for (let i = 0; i < 60 && !(has('历史记录/提示词/第3-4段/5__' + ST + '.txt') && has('历史记录/成片/第3-4段/6.mp4')); i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(has('历史记录/提示词/第3-4段/5__' + ST + '.txt'), '提示词跟着片进了历史记录');
  assert.ok(!has('提示词/第3-4段/5.txt'));
  assert.ok(has('历史记录/成片/第3-4段/6.mp4') && has('历史记录/成片/第3-4段/6_批注.md'), '片连批注跟着提示词进了历史记录');
});

test('服务开起来先对一遍：关着的时候挪的也补上；认得出的段才理', async t => {
  const { has, keeper } = await setup(t, { '提示词/第1-2段/3.txt': '稿', '历史记录/成片/第1-2段/3.mp4': 'v', '提示词/别的/3.txt': '稿' });
  await keeper.sweep('测试');
  assert.ok(has('历史记录/提示词/第1-2段/3__' + ST + '.txt'));
  assert.ok(has('提示词/别的/3.txt'));
  assert.deepEqual(plain(keeper.seen('试\\历史记录\\成片\\第1-2段\\3.mp4')), { p: '试', s: '1-2' });
  assert.deepEqual(plain(keeper.seen('试/提示词/第3-4段/1-5.txt')), { p: '试', s: '3-4' });
  for (const rel of ['试/资产/人物和道具/a.png', '试/提示词/全局资产/人物/a.txt', '试/成片/第3-4段', '试/提示词/第3-4段/1-5.txt.antou-tmp']) assert.equal(keeper.seen(rel), null, rel);
});

test('/api/pairs：GET 看对不上的，POST 马上理一遍；项目、段名字不对回 400', async t => {
  const { keeper } = await setup(t, { '提示词/第3-4段/3.txt': '稿', '历史记录/成片/第3-4段/3.mp4': 'v' });
  const call = async (method, q) => { let out; await keeper.handle({ method }, null, new URL('http://x/api/pairs?' + q), { json: (res, o) => { out = o; } }); return plain(out); };
  assert.deepEqual(await call('GET', 'p=试&s=3-4'), { a: [{ name: '3.txt', clips: ['3.mp4'] }], b: [] });
  assert.deepEqual((await call('POST', 'p=试&s=3-4')).提示词, ['3.txt']);
  await assert.rejects(call('GET', 'p=..&s=3-4'), e => e.status === 400);
  await assert.rejects(call('GET', 'p=试&s=第3段'), e => e.status === 400);
});

test('本机服务接上了：第 27 版，/api/pairs，开好就盯着', () => {
  const src = fs.readFileSync(path.join(SKILL, 'server.js'), 'utf8');
  assert.match(src, /const VERSION = (2[7-9]|[3-9][0-9]);/);
  assert.match(src, /url\.pathname === '\/api\/pairs'\) return await pairs\.handle/);
  assert.match(src, /pairs\.watch\(\)/);
});
