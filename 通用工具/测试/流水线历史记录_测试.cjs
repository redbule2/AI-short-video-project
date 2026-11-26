'use strict';
/* 流水线/历史记录.js（HistView）：11-25 起历史记录里的视频提示词也筛「已出片 / 没出片」，出过片的能「审片」（左边放片、右边那一版的字） */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const T = require('../公用/历史记录.js').ms;
const plain = x => JSON.parse(JSON.stringify(x));   // 另一个 vm 里造的：比之前换成这边的
const textOf = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : n && typeof n === 'object' ? textOf(n.children) : '';
const all = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => all(x, out)); else if (n && typeof n === 'object') { out.push(n); all(n.children, out); } return out; };
const tick = () => new Promise(r => setTimeout(r, 0));

/* 一页：dirs 是 { 项目里的文件夹: { 名字: 修改时间 } }；cur：提示词/第N段 里现在的几条；here：成片里（名字 → 修改时间） */
function page({ dirs = {}, cur = [], here = {} } = {}) {
  const cl = { vids: Object.keys(here), time: new Map(Object.entries(here)) };   // 流水线.js 的 clipsOf：读好了是同一个
  const ctx = {
    URLSearchParams, Map, Set, console, TextEncoder, TextDecoder,
    F: { name: '试验', names: new Map([['3-4', { set: new Set([...cur, '1-5_写稿.json']) }]]) },
    segName: s => '第' + s + '段', stemOf: n => n.replace(/\.[^.]+$/, ''),
    lister: () => async dir => Object.entries(dirs[dir] || {}).map(([name, mtime]) => ({ name, kind: 'file', mtime })),
    clipsOf: () => cl,
    nowName: (seg, o) => o, promptsOf: () => cur.map(n => ({ key: n, name: n })),
    h: (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, children: kids.flat(Infinity).filter(x => x != null) }),
    toast: () => {}, vpLabel: n => n,
    ReviewPop: {   // 它自己的测试在 审片弹窗_测试.cjs：这里只看给它的是哪几条
      tag: (made, inHist) => (made.length ? { tag: 'span', attrs: { class: 'fs-state ok', inHist }, children: ['已出片'] } : null),
      oldBtn: (s, it, items) => ({ tag: 'button', attrs: { disabled: !items.length, hp: it.file, vids: items.map(x => x.vid) }, children: ['审片'] }),
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ['公用/核心.js', '公用/资产路径.js', '公用/样片归属.js', '公用/历史记录.js', '流水线/历史记录.js']) vm.runInContext(read(f), ctx, { filename: f });
  return { ctx, HV: ctx.HistView, s: { 段: '3-4' } };
}
const PD = '历史记录/提示词/第3-4段', CD = '历史记录/成片/第3-4段';
const DIRS = { [PD]: { '1-5__20261120-100000.txt': 1, '1-5__20261122-100000.txt': 1, '1-5_写稿__20261120-100000.json': 1, '2-1__20261121-000000.txt': 1 }, [CD]: { '1-5_3.mp4': T('20261119-090000'), '1-5_3_批注.md': 1 } };
const HERE = { '1-5_2.mp4': T('20261121-090000'), '1-5.mp4': T('20261123-090000') };
const rowsOf = v => all(v).filter(x => x.attrs && x.attrs['data-hist']).map(x => x.attrs['data-hist']);

test('哪一版出过片（made）：历史记录还没读好给 null；读好了照 公用/历史记录.js 的 made 认（成片、历史记录里的都算）', async () => {
  const { HV, s } = page({ dirs: DIRS, cur: ['1-5.txt'], here: HERE });
  assert.equal(HV.made(s), null);
  await tick();
  const m = HV.made(s);
  assert.deepEqual([...m.keys()].sort(), ['1-5__20261120-100000.txt', '1-5__20261122-100000.txt', '2-1__20261121-000000.txt'], '写稿资料不算提示词');
  assert.deepEqual(plain(m.get('1-5__20261120-100000.txt').map(x => [x.vid, x.old])), [['1-5_3.mp4', true]]);
  assert.deepEqual(plain(m.get('1-5__20261122-100000.txt').map(x => [x.vid, x.old])), [['1-5_2.mp4', false]]);
  assert.deepEqual(plain(m.get('2-1__20261121-000000.txt')), []);
  assert.equal(HV.made(s), m, '没变：不重算');
  HV.drop();
  assert.equal(HV.made(s), null, '文件夹里变了：重读');
});

test('历史记录那一页筛「已出片 / 没出片」：出过片的标「已出片」、「审片」带它出的那几条，没出过的灰', async () => {
  const { HV, s } = page({ dirs: DIRS, cur: ['1-5.txt'], here: HERE });
  const c = HV.prompts(s);
  HV.made(s);
  await tick();
  const v = HV.promptView(s, c, '全部');
  assert.deepEqual(rowsOf(v), [PD + '/1-5__20261122-100000.txt', PD + '/1-5__20261120-100000.txt', PD + '/2-1__20261121-000000.txt']);
  assert.match(textOf(v), /历史记录里的 3 版：.*出过片的点「审片」，左边放片、右边是那一版的字/);
  assert.deepEqual(plain(all(v).filter(x => x.tag === 'button' && textOf(x) === '审片').map(b => [b.attrs.hp.split('/').pop(), b.attrs.disabled, b.attrs.vids])), [
    ['1-5__20261122-100000.txt', false, ['1-5_2.mp4']], ['1-5__20261120-100000.txt', false, ['1-5_3.mp4']], ['2-1__20261121-000000.txt', true, []]]);
  assert.equal(all(v).filter(x => x.attrs && x.attrs.class === 'fs-state ok' && x.attrs.inHist === true).length, 2);
  const yes = HV.promptView(s, c, '已出片');
  assert.deepEqual(rowsOf(yes), [PD + '/1-5__20261122-100000.txt', PD + '/1-5__20261120-100000.txt']);
  assert.match(textOf(yes), /筛出 2 版（一共 3 版）/);
  assert.deepEqual(rowsOf(HV.promptView(s, c, '没出片')), [PD + '/2-1__20261121-000000.txt']);
});

test('筛完一条不剩：说一声，给「看全部」；样片还没读好照全部摆、不摆「审片」', async () => {
  const one = page({ dirs: { [PD]: { '1-5__20261120-100000.txt': 1 }, [CD]: { '1-5_3.mp4': T('20261119-090000') } }, cur: ['1-5.txt'] });
  const c = one.HV.prompts(one.s);
  one.HV.made(one.s);
  await tick();
  let back = 0;
  const v = one.HV.promptView(one.s, c, '没出片', () => { back++; });
  assert.match(textOf(v), /历史记录里的这几版都出过片/);
  all(v).find(x => x.tag === 'button' && textOf(x) === '看全部').attrs.onclick();
  assert.equal(back, 1);
  const two = page({ dirs: DIRS, cur: ['1-5.txt'], here: HERE }), ls = two.ctx.lister;
  two.ctx.lister = name => dir => (dir === CD ? new Promise(() => {}) : ls(name)(dir));   // 样片的历史记录一直没读好
  const c2 = two.HV.prompts(two.s);
  await tick();
  const w = two.HV.promptView(two.s, c2, '已出片');
  assert.equal(two.HV.made(two.s), null);
  assert.equal(rowsOf(w).length, 3, '认不出哪一版出过片：先都摆上');
  assert.ok(!all(w).some(x => x.tag === 'button' && textOf(x) === '审片'));
});
