'use strict';
/* 写稿页里加减镜头（2026-11-20）：提示词.html 的 PromptShots —— 不加限制（出过片、改过几版的也能改，只有 AI 正在做这一条要等）；
   名字跟着改（每一版、写稿资料、批注、批注截图、出片任务书、参考素材映射的登记、「选定」「沿用」），改名记进这一场的「改名」，改不成挪回去。
   照 提示词.html 里「写稿页里加减镜头」那一段测，用的是真的 核心.js 和 关键帧绑定.js；文件在内存里，提示词照文件夹里的名字分条（Core.vpFams） */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const Core = require('../公用/核心.js');
const SB = require('../公用/关键帧绑定.js');

const page = process.env.PROMPT_TEST_PAGE || path.join(__dirname, '../流水线/提示词.html');
const html = fs.readFileSync(page, 'utf8');
const from = html.indexOf('/* ---------- 写稿页里加减镜头（'), to = html.indexOf('/* ---------- 写稿页里加减镜头：完 ---------- */');
assert.ok(from > 0 && to > from, '提示词.html 里找不到「写稿页里加减镜头」那一段');
const ownLine = /^const own = .*$/m.exec(html);
assert.ok(ownLine, '提示词.html 里找不到 own');

const DIR = '试片/提示词/第1-1段/', MAP = '试片/资产/参考素材映射.json';
const KEY = n => '提示词/第1-1段/' + n;
const FILES = ['9b-9d.txt', '9b-9d_写稿.json', '9b-9d_批注.md', '1.txt', '1_出片任务.txt', '2-3.txt', '2-3_改1.txt', '2-3_写稿.json', '2-3_改1_写稿.json', '2-3_改1_批注.md',
  '2-3_出片任务.txt', '2-3_出片任务_改1.txt', '2-3_首帧_提示词.txt', '视频提示词_02.txt'];

/* 一个小世界：一段镜头表、文件夹里的几条提示词。opt 里能放：坏在第几次挪、写不进、列不出、存不上、AI 任务 */
function world(opt = {}) {
  const mem = new Map();
  const put = (p, text, kind = 'file') => mem.set(p, { kind, text });
  for (const n of FILES) put(DIR + n, n);
  put(DIR + '9b-9d_批注截图', '', 'directory');
  for (const [n, t] of Object.entries(opt.files || {})) t === null ? mem.delete(DIR + n) : put(DIR + n, t);
  const reg = opt.reg || { prompts: { [KEY('9b-9d.txt')]: { 图片: ['资产/人物和道具/童晓晓.png'] }, [KEY('1.txt')]: { 图片: [] }, [KEY('2-3.txt')]: { 图片: ['a.png'] }, [KEY('2-3_改1.txt')]: { 图片: ['b.png'] } } };
  if (reg !== 'none') put(MAP, JSON.stringify(reg, null, 2) + '\n');
  const s = {
    段: '1-1', 段落: ['1', '2', '3', '4', '9b', '9c', '9d', '9e', '10'].map(号 => ({ 号, 写什么: '镜' + 号, 秒数: 2 })),
    选定: { '1.txt': '第1-1段_第2条_1_720p.mp4', '2-3.txt': '2-3_改1.mp4' },
    沿用: { '提示词/9b-9d.txt': '11-20 10:00', '白模/9b-9d.txt': '11-20 10:01', '提示词/1.txt': '11-19', '提示词/2-3_改1.txt': '11-20 09:00', '样片/2-3_改1.mp4': '11-20 09:30' },
    ...(opt.scene || {}),
  };
  const W = { mem, s, moves: [], touched: 0, flushed: 0, writes: 0, title: { textContent: '第1-1段 · 镜头9b-9d · 写稿' } };
  let n = 0;
  const F = { name: '试片', doc: { 场: [s, { 段: '2-1', 段落: [] }] }, err: '' };
  const inDir = () => [...mem.keys()].filter(p => p.startsWith(DIR) && !p.slice(DIR.length).includes('/')).map(p => p.slice(DIR.length));
  const lister = () => { const fn = async rel => { if (opt.listFail) { fn.failed = true; return []; } const d = '试片/' + rel + '/'; return [...mem.keys()].filter(p => p.startsWith(d) && !p.slice(d.length).includes('/')).map(p => ({ name: p.slice(d.length), kind: mem.get(p).kind })); }; fn.failed = false; return fn; };
  const ctx = vm.createContext({
    F, SB, KIN: [['_写稿.json', '写稿资料'], ['_批注.md', '批注'], ['_AI批注.md', 'AI 批注']], SHOTS_TAIL: '_批注截图',
    vpCode: Core.vpCode, vpLabel: Core.vpLabel, taskOf: Core.vpTask, segName: seg => '第' + seg + '段',
    promptsOf: () => Core.vpFams(inDir()).map(({ key, vers }) => ({ key, vers, name: vers[vers.length - 1] })), shotNos: x => SB.nosOf(x.段落),
    X: { tasks: new Set(), open: new Set(['9b-9d.txt', '2-3_改1.txt']) },
    AI: { jobs: opt.jobs || [] }, jobLive: j => !!j && (j.状态 === '排队' || j.状态 === '在做'),
    lister, at: parts => parts.join('/'), C: { encodeText: t => t },
    hasFile: async (name, parts) => { const e = mem.get([name, ...parts].join('/')); return !!e && e.kind === 'file'; },
    readJson: async p => JSON.parse(mem.get(p).text),
    FS: {
      move: async (a, b) => {
        n++;
        if (opt.moveFail === n) throw new Error('第' + n + '次挪坏了');
        if (!mem.has(a)) throw new Error('没有 ' + a);
        if (mem.has(b)) throw new Error('已经有 ' + b);
        mem.set(b, mem.get(a)); mem.delete(a); W.moves.push([a, b]);
      },
      write: async (p, t) => { if (opt.writeFail) throw new Error('写不进'); W.writes++; mem.set(p, { kind: 'file', text: t }); },
    },
    flush: async () => { W.flushed++; if (opt.flushErr || (opt.flushErrAfter && W.flushed > opt.flushErrAfter)) F.err = '磁盘满了'; },
    touch: () => { W.touched++; }, loadSides: async () => {}, loadExtra: async () => {}, rerender: () => {},
    document: { querySelector: q => q === '.wf-write .wf-shell-t' ? W.title : null },
    window: { Core },
  });
  vm.runInContext(ownLine[0] + '\n' + html.slice(from, to), ctx, { filename: page });
  W.api = ctx.window.PromptShots;
  W.X = ctx.X;
  W.has = nm => mem.has(DIR + nm);
  W.reg = () => JSON.parse(mem.get(MAP).text).prompts;
  return W;
}
const plain = x => JSON.parse(JSON.stringify(x));
const rejects = (p, re) => assert.rejects(p, e => { assert.match(e.message, re); return true; });

test('不加限制：出过片、排过任务书、改过几版的都能改', () => {
  const W = world();
  for (const n of ['9b-9d.txt', '1.txt', '2-3.txt', '2-3_改1.txt']) assert.equal(W.api.lock('1-1', n), '', n);
});

test('只等 AI 正在做这一条（哪一版都算）；别的说清楚为什么动不了', () => {
  const busy = jobs => world({ jobs }).api.lock('1-1', '2-3_改1.txt');
  assert.match(busy([{ 事: '出片任务书', 段: '1-1', 名: '2-3.txt', 状态: '在做' }]), /AI 正在做/);
  assert.match(busy([{ 事: '出片', 段: '1-1', 名: '2-3_出片任务_改1.txt', 状态: '排队' }]), /AI 正在做/);
  assert.match(busy([{ 事: '按批注改提示词', 段: '1-1', 批注: '项目/试片/提示词/第1-1段/2-3_改1_批注.md', 状态: '在做' }]), /AI 正在做/);
  assert.match(busy([{ 事: '写字', 段: '1-1', 只提示词: ['2-3_改1.txt'], 状态: '在做' }]), /AI 正在做/);
  assert.equal(busy([{ 事: '出片任务书', 段: '1-1', 名: '2-3.txt', 状态: '做完' }]), '');   // 做完的不算
  assert.equal(busy([{ 事: '出片任务书', 段: '1-1', 名: '1.txt', 状态: '在做' }]), '');   // 别的条不管
  assert.match(world().api.lock('1-1', '视频提示词_02.txt'), /不是照镜头号起的名字/);
  assert.match(world().api.lock('9-9', '1.txt'), /找不到这一段/);
  assert.match(world().api.lock('2-1', '1.txt'), /还没有镜头表/);
  assert.match(world().api.lock('1-1', '5.txt'), /找不到这一条/);
});

test('加一镜：几样一起改名，登记、沿用跟过去，记下改名，别的不动', async () => {
  const W = world();
  const r = await W.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']);
  assert.deepEqual(plain(r), { name: '9b-9e.txt', warn: '', vers: 1 });
  for (const nm of ['9b-9e.txt', '9b-9e_写稿.json', '9b-9e_批注.md', '9b-9e_批注截图']) assert.ok(W.has(nm), '没改成 ' + nm);
  for (const nm of ['9b-9d.txt', '9b-9d_写稿.json', '9b-9d_批注.md', '9b-9d_批注截图']) assert.ok(!W.has(nm), '还在 ' + nm);
  assert.equal(W.mem.get(DIR + '9b-9e.txt').text, '9b-9d.txt');   // 挪过去的就是原来那份
  const ps = W.reg();
  assert.deepEqual(ps[KEY('9b-9e.txt')], { 图片: ['资产/人物和道具/童晓晓.png'] });
  assert.ok(!(KEY('9b-9d.txt') in ps) && KEY('1.txt') in ps);
  assert.ok(W.mem.get(MAP).text.endsWith('\n'));
  assert.equal(W.s.沿用['提示词/9b-9e.txt'], '11-20 10:00');
  assert.equal(W.s.沿用['白模/9b-9e.txt'], '11-20 10:01');
  assert.ok(!('提示词/9b-9d.txt' in W.s.沿用));
  assert.deepEqual(plain(W.s.改名), { '9b-9d.txt': '9b-9e.txt' });
  assert.equal(W.touched, 1);
  assert.ok(W.flushed >= 2);   // 挪之前存一回，改了流水线.json 再存一回
  assert.equal(W.title.textContent, '第1-1段 · 镜头9b-9e · 写稿');
  assert.ok(W.X.open.has('9b-9e.txt') && !W.X.open.has('9b-9d.txt'));
});

test('改过几版、出过片、排过任务书的：前几版一起改名，任务书、选定、沿用、登记跟着走，关键帧的字不动', async () => {
  const W = world();
  const r = await W.api.rename('1-1', '2-3_改1.txt', ['2', '3', '4']);
  assert.deepEqual(plain(r), { name: '2-4_改1.txt', warn: '', vers: 2 });
  for (const nm of ['2-4.txt', '2-4_改1.txt', '2-4_写稿.json', '2-4_改1_写稿.json', '2-4_改1_批注.md', '2-4_出片任务.txt', '2-4_出片任务_改1.txt']) assert.ok(W.has(nm), '没改成 ' + nm);
  for (const nm of ['2-3.txt', '2-3_改1.txt', '2-3_出片任务.txt', '2-3_出片任务_改1.txt']) assert.ok(!W.has(nm), '还在 ' + nm);
  assert.ok(W.has('2-3_首帧_提示词.txt'));   // 关键帧的字是关键帧的名字，不跟着改
  assert.deepEqual(plain(W.s.选定), { '1.txt': '第1-1段_第2条_1_720p.mp4', '2-4.txt': '2-3_改1.mp4' });   // 样片名不改
  assert.equal(W.s.沿用['提示词/2-4_改1.txt'], '11-20 09:00');
  assert.equal(W.s.沿用['样片/2-3_改1.mp4'], '11-20 09:30');
  assert.deepEqual(plain(W.s.改名), { '2-3.txt': '2-4.txt', '2-3_改1.txt': '2-4_改1.txt' });
  const ps = W.reg();
  assert.deepEqual([ps[KEY('2-4.txt')], ps[KEY('2-4_改1.txt')]], [{ 图片: ['a.png'] }, { 图片: ['b.png'] }]);
  assert.ok(W.X.open.has('2-4_改1.txt'));
  // 再改一回、再改回去：改名记录接得上
  await W.api.rename('1-1', '2-4_改1.txt', ['2', '3']);
  assert.deepEqual(plain(W.s.改名), { '2-4.txt': '2-3.txt', '2-4_改1.txt': '2-3_改1.txt' });
  assert.ok(W.has('2-3_改1.txt') && W.has('2-3_出片任务_改1.txt'));
  assert.deepEqual(plain(W.s.选定)['2-3.txt'], '2-3_改1.mp4');
});

test('去掉中间一镜：名字照表里的先后写（9b、9d）', async () => {
  const W = world();
  assert.equal((await W.api.rename('1-1', '9b-9d.txt', ['9d', '9b'])).name, '9b、9d.txt');
  assert.ok(W.has('9b、9d.txt') && !W.has('9b-9d.txt'));
});

test('勾的和原来一样：什么都不动；一镜都没勾：不改', async () => {
  const W = world();
  assert.deepEqual(plain(await W.api.rename('1-1', '9b-9d.txt', ['9c', '9b', '9d'])), { name: '9b-9d.txt', warn: '', vers: 0 });
  assert.equal(W.moves.length, 0);
  await rejects(W.api.rename('1-1', '9b-9d.txt', []), /一镜都没勾/);
  await rejects(W.api.rename('1-1', '9b-9d.txt', ['20']), /一镜都没勾/);   // 表里没有的号不算
  assert.equal(W.moves.length, 0);
  assert.equal(W.s.改名, undefined);
});

test('新名字有人占了：已有的一条、AI 正在写的一条、留在文件夹里的同名文件，都不改', async () => {
  const W1 = world({ files: { '9b-9e.txt': '另一条' } });
  await rejects(W1.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /已经有「镜头9b-9e」这一条了/);
  const W2 = world({ jobs: [{ 事: '写提示词', 段: '1-1', 名: '9b-9e.txt', 状态: '在做' }] });
  await rejects(W2.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /已经有「镜头9b-9e」这一条了/);
  const W3 = world({ files: { '9b-9e_批注.md': '删剩的' } });
  await rejects(W3.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /已经有「9b-9e_批注.md」/);
  const W4 = world({ files: { '9b-9e_出片任务.txt': '老任务书' } });
  await rejects(W4.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /已经有「9b-9e_出片任务.txt」/);
  const W5 = world({ files: { '2-4_改1.txt': '另一条的改1' } });   // 前几版改过去的名字也不能占着
  await rejects(W5.api.rename('1-1', '2-3_改1.txt', ['2', '3', '4']), /已经有/);
  for (const W of [W1, W2, W3, W4]) { assert.equal(W.moves.length, 0); assert.ok(W.has('9b-9d.txt')); }
  assert.equal(W5.moves.length, 0);
});

test('AI 在做、列不出文件、流水线存不上：都不动文件', async () => {
  const W1 = world({ jobs: [{ 事: '按批注改提示词', 段: '1-1', 批注: '项目/试片/提示词/第1-1段/9b-9d_批注.md', 状态: '在做' }] });
  await rejects(W1.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /AI 正在做/);
  const W2 = world({ listFail: true });
  await rejects(W2.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /本机服务连不上/);
  const W3 = world({ flushErr: true });
  await rejects(W3.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /流水线没存上/);
  for (const W of [W1, W2, W3]) assert.equal(W.moves.length, 0);
});

test('挪到一半坏了：挪过的挪回去，登记、沿用、改名都不动', async () => {
  const W = world({ moveFail: 4 });
  await rejects(W.api.rename('1-1', '2-3_改1.txt', ['2', '3', '4']), /改名没改成，已经挪回去/);
  for (const nm of FILES) assert.ok(W.has(nm), '没挪回 ' + nm);
  assert.ok(!W.has('2-4.txt') && !W.has('2-4_写稿.json'));
  assert.ok(W.reg()[KEY('2-3.txt')]);
  assert.ok(W.s.沿用['提示词/2-3_改1.txt']);
  assert.equal(W.s.改名, undefined);
});

test('参考素材映射写不进：名字挪回去', async () => {
  const W = world({ writeFail: true });
  await rejects(W.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']), /参考素材映射没改上/);
  assert.ok(W.has('9b-9d.txt') && W.has('9b-9d_批注截图') && !W.has('9b-9e.txt'));
  assert.ok(W.s.沿用['提示词/9b-9d.txt']);
});

test('新名字下留着删掉的旧稿的登记、沿用：去掉，不算这一条的', async () => {
  const W = world({
    reg: { prompts: { [KEY('9b-9e.txt')]: { 图片: ['旧的.png'] } } },
    scene: { 沿用: { '提示词/9b-9e.txt': '老的' } },
  });
  await W.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']);
  assert.deepEqual(plain(W.reg()), {});
  assert.deepEqual(plain(W.s.沿用), {});
});

test('没有登记、没有沿用、没有选定：不新建，只记改名', async () => {
  const W = world({ reg: 'none', scene: { 沿用: undefined, 选定: undefined } });
  const r = await W.api.rename('1-1', '9b-9d.txt', ['3', '4', '9b', '9c', '9d']);
  assert.equal(r.name, '3-9d.txt');
  assert.equal(W.writes, 0);
  assert.equal(W.s.沿用, undefined);
  assert.equal(W.s.选定, undefined);
  assert.deepEqual(plain(W.s.改名), { '9b-9d.txt': '3-9d.txt' });
});

test('流水线改完存不上：文件已经改了名，说一声（页面过一会儿自己再存）', async () => {
  const W = world({ flushErrAfter: 1 });   // 挪之前那一回存上了，改了流水线.json 那一回没存上
  const r = await W.api.rename('1-1', '9b-9d.txt', ['9b', '9c', '9d', '9e']);
  assert.equal(r.name, '9b-9e.txt');
  assert.match(r.warn, /还没存上/);
  assert.ok(W.has('9b-9e.txt') && !W.has('9b-9d.txt'));
  assert.deepEqual(plain(W.s.改名), { '9b-9d.txt': '9b-9e.txt' });   // 记在页面上了，页面接着存
});

test('只有一个文件（没写稿资料、没批注）也照改', async () => {
  const W = world({ files: { '9b-9d_写稿.json': null, '9b-9d_批注.md': null } });
  W.mem.delete(DIR + '9b-9d_批注截图');
  assert.equal((await W.api.rename('1-1', '9b-9d.txt', ['9c', '9d'])).name, '9c-9d.txt');
  assert.deepEqual(W.moves.map(m => m[1].split('/').pop()), ['9c-9d.txt']);
});
