'use strict';
/* 流水线/审片弹窗.js（2026-11-22 他定：审片改成提示词那一步每条上的弹窗，只摆这一条出的样片；「这条不要了」移进历史记录） */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const P = (key, ...more) => ({ key, name: more.length ? more[more.length - 1] : key, vers: [key, ...more], label: key });

/* 一页：成片里 here（名字 → 修改时间）、历史记录里 hist（名字 → 修改时间）、成片文件夹里还有 extra（批注、截图） */
function page({ here = {}, hist = {}, extra = [], jobs = [], sel = null, moveFail = null } = {}) {
  const log = [], els = [];
  const el = (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, children: kids.flat(Infinity).filter(x => x != null), listeners: {}, removed: false,
    addEventListener(t, fn) { this.listeners[t] = fn; }, remove() { this.removed = true; log.push(['收起', tag]); } });
  const ctx = {
    URLSearchParams, TextEncoder, TextDecoder, Map, Set, console,
    h: (tag, attrs, ...kids) => { const x = el(tag, attrs, ...kids); els.push(x); return x; },
    toast: (t, k) => log.push(['提示', t, k || '']), closePop: () => {}, hideHov: () => {},
    SHELL: null, F: { name: '试验' }, PAGE: { sides: w => log.push(['重读', [...w].join()]) },
    refresh: async () => { log.push(['刷新']); },
    clipsOf: () => ({ vids: Object.keys(here), all: new Set([...Object.keys(here), ...extra]), time: new Map(Object.entries(here)) }),
    shotRecOf: () => null,
    HistView: { clips: () => ({ items: Object.entries(hist).map(([name, mtime]) => ({ name, mtime, stamp: /__\d{8}-\d{6}/.test(name) ? 'x' : '' })) }), drop: () => log.push(['历史记录重读']) },
    document: { body: { append: x => log.push(['盖上', x.attrs.class]), classList: { add: c => log.push(['加', c]), remove: c => log.push(['去', c]) } } },
    AI: { jobs }, jobLive: () => true, segName: s => '第' + s + '段', at: parts => parts.join('/'),
    lister: () => { const fn = async () => [...Object.keys(here), ...extra].map(name => ({ name, kind: /截图$/.test(name) ? 'directory' : 'file' })); fn.failed = false; return fn; },
    FS: { move: async (a, b) => { if (moveFail && moveFail(a)) throw new Error(moveFail(a)); log.push(['挪', a, b]); } },
    touch: () => log.push(['改了流水线']), flush: async () => {},
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['公用/核心.js', '公用/样片归属.js', '流水线/审片弹窗.js']) vm.runInContext(read(f), ctx, { filename: f });
  const s = { 段: '3-4', 选定: sel || {} };
  return { ctx, log, els, s, RP: ctx.ReviewPop };
}
const L = [P('11-12.txt', '11-12_改1.txt', '11-12_改2.txt'), P('11-13.txt', '11-13_改1.txt', '11-13_改2.txt'), P('8-9.txt', '8-9_改1.txt', '8-9_改2.txt')];
const plain = x => JSON.parse(JSON.stringify(x));   // 审片弹窗.js 在另一个 vm 里跑：它给的数组比之前先换成这边的
const srcOf = els => { const f = els.find(x => x.tag === 'iframe'); return f ? new URLSearchParams(f.attrs.src.split('?')[1]) : null; };

test('只摆这一条出的样片：几版出的、历史记录里的都算，别的提示词的、删掉那一版的（带时间）不算', () => {
  const { RP, s } = page({ here: { '11-13_改2.mp4': 5, '11-13_改2_2.mp4': 9, '11-12_改1.mp4': 3, '8-9_改2.mp4': 1 }, hist: { '11-13_改1.mp4': 2, '11-13.mp4': 1, '11-13_改2__20261122-101010.mp4': 4 } });
  assert.deepEqual(plain(RP.clipsFor(s, L[1], L).map(x => [x.vid, x.ver, x.old, x.mtime])), [
    ['11-13_改2.mp4', '11-13_改2.txt', false, 5], ['11-13_改2_2.mp4', '11-13_改2.txt', false, 9],
    ['11-13_改1.mp4', '11-13_改1.txt', true, 2], ['11-13.mp4', '11-13.txt', true, 1]]);
  assert.deepEqual(plain(RP.clipsFor(s, L[0], L).map(x => x.vid)), ['11-12_改1.mp4']);   // 最新一版（改2）没出片，改1 出的照样摆
});

test('「审片」：最新这一版没出片是灰的（前几版出过也灰）；出过片的说成片里、历史记录里各几条', () => {
  const none = page();
  const b0 = none.RP.btn(none.s, L[1], L);
  assert.equal(b0.attrs.disabled, true);
  assert.match(b0.attrs.title, /还没出片/);
  const prev = page({ here: { '11-13_改1.mp4': 3 }, hist: { '11-13.mp4': 1 } });
  const bp = prev.RP.btn(prev.s, L[1], L);
  assert.equal(bp.attrs.disabled, true, '最新一版（改2）没出片：前几版出过也灰掉（11-22 晚他定）');
  assert.match(bp.attrs.title, /「11-13\.txt」还没出片.*前几版/);
  const gone = page({ hist: { '11-13_改2.mp4': 4 } });
  assert.equal(gone.RP.btn(gone.s, L[1], L).attrs.disabled, false, '最新一版出的片审完收进历史记录了：照样能点');
  const one = page({ here: { '11-13_改2.mp4': 5 }, hist: { '11-13_改1.mp4': 2 } });
  const b1 = one.RP.btn(one.s, L[1], L);
  assert.equal(b1.attrs.disabled, false);
  assert.match(b1.attrs.title, /成片里 1 条、历史记录里 1 条/);
  assert.deepEqual(b1.children, ['审片']);
});

test('madeOf：最新这一版出的样片，成片、历史记录里的都算；前几版的、删掉那一版的（带时间）不算。提示词页筛选、标签照它（11-24）', () => {
  const a = page({ hist: { '11-13_改2.mp4': 4, '11-13_改1.mp4': 2 } });
  assert.deepEqual(plain(a.RP.madeOf(a.s, L[1], L).map(x => [x.vid, x.old])), [['11-13_改2.mp4', true]]);
  assert.equal(a.RP.btn(a.s, L[1], L).attrs.disabled, false, '和「审片」能不能点对得上');
  const b = page({ here: { '11-13_改1.mp4': 3 }, hist: { '11-13_改2__20261122-101010.mp4': 4 } });
  assert.deepEqual(plain(b.RP.madeOf(b.s, L[1], L)), []);
  assert.equal(b.RP.btn(b.s, L[1], L).attrs.disabled, true);
  const c = page({ here: { '11-13_改2.mp4': 5 }, hist: { '11-13_改2_2.mp4': 6 } });
  assert.deepEqual(plain(c.RP.madeOf(c.s, L[1], L).map(x => [x.vid, x.old])), [['11-13_改2.mp4', false], ['11-13_改2_2.mp4', true]]);
});

test('点开：先放成片里新的一版最后出的那条；网址带这一条的原稿名（k）、哪一版（pr）', () => {
  const { RP, s, els, log, ctx } = page({ here: { '11-13_改1.mp4': 9, '11-13_改2.mp4': 5, '11-13_改2_2.mp4': 7 } });
  RP.open(s, L[1], L);
  const q = srcOf(els);
  assert.deepEqual([q.get('p'), q.get('s'), q.get('v'), q.get('k'), q.get('pr'), q.get('old')], ['试验', '3-4', '11-13_改2_2.mp4', '11-13.txt', '11-13_改2.txt', null]);
  assert.equal(ctx.SHELL.attrs.class, 'wf-shell wf-rv');
  assert.ok(log.some(x => x[0] === '加' && x[1] === 'wf-covered'));
  assert.equal(typeof ctx.DESK_HOST.close, 'function');
  assert.equal(typeof ctx.DESK_HOST.retire, 'function');
  assert.equal(typeof ctx.SHELL.leave, 'function');   // 换页、换项目以前先存批注（流水线.js 的 go、pickProject）
});

test('成片里没有、只在历史记录里的：照样打开，网址带 old=1', () => {
  const { RP, s, els } = page({ hist: { '11-13_改1.mp4': 2 } });
  RP.open(s, L[1], L);
  const q = srcOf(els);
  assert.equal(q.get('v'), '11-13_改1.mp4');
  assert.equal(q.get('old'), '1');
});

test('收起：先问审片台（没存的批注先存上），它说不行就留着；收起以后重读', async () => {
  const { RP, s, els, log, ctx } = page({ here: { '11-13_改2.mp4': 5 } });
  RP.open(s, L[1], L);
  const frame = els.find(x => x.tag === 'iframe');
  let ok = false;
  frame.contentWindow = { DESK: { leave: async () => ok } };
  await ctx.DESK_HOST.close();
  assert.notEqual(ctx.SHELL, null, '审片台说不行：不收');
  ok = true;
  await ctx.DESK_HOST.close();
  assert.equal(ctx.SHELL, null);
  assert.equal(ctx.DESK_HOST, null);
  assert.ok(log.some(x => x[0] === '去' && x[1] === 'wf-covered'));
  assert.ok(log.some(x => x[0] === '刷新') && log.some(x => x[0] === '重读' && x[1] === '*'));
});

test('这条不要了：样片和它的批注、截图移进 历史记录/成片/第N段，名字不改；后期补的片子、别的版本的批注不动；选定跟着去掉', async () => {
  const { RP, s, log } = page({ here: { '11-13_改2.mp4': 5, '11-13_改2_后期补.mp4': 6, '11-13_改2_2.mp4': 7 }, extra: ['11-13_改2_批注.md', '11-13_改2_批注截图', '11-13_改2_2_批注.md'], sel: { '11-13.txt': '11-13_改2.mp4' } });
  assert.equal(await RP.retire(s, '11-13_改2.mp4'), '');
  assert.deepEqual(log.filter(x => x[0] === '挪').map(x => [x[1], x[2]]), [
    ['试验/成片/第3-4段/11-13_改2.mp4', '试验/历史记录/成片/第3-4段/11-13_改2.mp4'],
    ['试验/成片/第3-4段/11-13_改2_批注.md', '试验/历史记录/成片/第3-4段/11-13_改2_批注.md'],
    ['试验/成片/第3-4段/11-13_改2_批注截图', '试验/历史记录/成片/第3-4段/11-13_改2_批注截图']]);
  assert.deepEqual({ ...s.选定 }, {});
  assert.ok(log.some(x => x[0] === '改了流水线'));
});

test('这条不要了，挪不成的说为什么：已经不在了、AI 在用、剪映占着', async () => {
  const a = page({ here: { '1.mp4': 1 } });
  assert.match(await a.RP.retire(a.s, '2.mp4'), /已经不在成片里了/);
  const b = page({ here: { '1.mp4': 1 }, jobs: [{ 段: '3-4', 视频: '1.mp4' }] });
  assert.match(await b.RP.retire(b.s, '1.mp4'), /AI 正在照这条样片做事/);
  const c = page({ here: { '1.mp4': 1 }, moveFail: () => 'EBUSY: resource busy or locked' });
  assert.match(await c.RP.retire(c.s, '1.mp4'), /没移走：EBUSY.*剪映/);
  const d = page({ here: { '1.mp4': 1 }, moveFail: () => '那里已经有同名的了' });
  assert.doesNotMatch(await d.RP.retire(d.s, '1.mp4'), /剪映/);
});

test('提示词那一页引了它；审片那一整页（第五步）删了', () => {
  assert.match(read('流水线/提示词.html'), /<script src="审片弹窗\.js"><\/script>/);
  assert.ok(!fs.existsSync(path.join(TOOLS, '流水线', '审片.html')));
  assert.doesNotMatch(read('流水线/流水线.js'), /\['审片', '五', '审片'\]/);
});
