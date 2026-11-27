'use strict';
/* 流水线.js openWrite：写稿页盖上来，点「回到流水线」先存没存的字。
   11-26：本机服务断了两分钟，那会儿点开的写稿页没打开，框里是浏览器的出错页（不算同一网站，contentDocument 是 null，
   一读 contentWindow.save 就报 cross-origin）。原来当成「草稿没存上」拦着不让回，点几次弹几条。
   现在：没打开的不拦；顶上说一声，隔两秒问一回本机服务，回来了自己再开一次。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const fn = /^function openWrite\([\s\S]*?^\}$/m.exec(fs.readFileSync(path.join(__dirname, '../流水线/流水线.js'), 'utf8'));
assert.ok(fn, '流水线.js 里找不到 openWrite');

const CROSS = "Failed to read a named property 'save' from 'Window': Blocked a frame with origin \"http://127.0.0.1:8766\" from accessing a cross-origin frame.";
const DEAD = { contentDocument: null, contentWindow: { get save() { throw new Error(CROSS); } } };   // 出错页：一碰就报错

function page() {
  const log = [], els = [], timers = [], P = { up: null, asks: 0, opened: 0 };
  let gone = false;
  const h = (tag, attrs, ...kids) => {
    const children = kids.flat(Infinity).filter(k => k != null);
    const x = { tag, attrs: attrs || {}, children, className: (attrs || {}).class || '', textContent: children.filter(k => typeof k === 'string').join(''), listeners: {},
      addEventListener(t, f) { this.listeners[t] = f; }, remove() { gone = true; log.push(['收起']); } };
    els.push(x);
    return x;
  };
  const ctx = {
    encodeURI, encodeURIComponent, Set, h,
    setTimeout: (f, ms) => { timers.push([f, ms]); },
    toast: (t, k) => log.push(['提示', t, k || '']), closePop() {}, hideHov() {},
    SHELL: null, F: { name: '试验' }, PAGE: { sides: () => log.push(['重读']) }, C: { isPfFile: n => n === '初步剧本.txt' },
    LINK: { up: async () => { P.asks++; return P.up; } },
    segName: s => '第' + s + '段', vpLabel: n => n.replace(/\.txt$/, ''),
    refresh: async () => { log.push(['刷新']); },
    document: { body: { append() {}, classList: { add() {}, remove: c => log.push(['去', c]) } } },
  };
  vm.createContext(ctx);
  vm.runInContext(fn[0] + '\nglobalThis.openWrite = openWrite;', ctx, { filename: '流水线.js' });
  ctx.openWrite('1-1', '初步剧本.txt');
  const frame = els.find(x => x.tag === 'iframe');
  Object.defineProperty(frame, 'isConnected', { get: () => !gone });
  frame.parentNode = { append: x => { assert.equal(x, frame); P.opened++; } };   // 再开一次：把框拿下来再放回去
  const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };
  return Object.assign(P, { ctx, log, frame, timers,
    back: els.find(x => x.tag === 'button' && x.children.includes('← 回到流水线')).attrs.onclick,
    note: els.find(x => x.tag === 'span' && x.className === 'fn-note'),
    load: async over => { Object.assign(frame, over); frame.listeners.load(); await settle(); },
    tick: async () => { for (const [f] of timers.splice(0)) f(); await settle(); } });   // 两秒到了
}

test('写稿页没打开（出错页）：点「回到流水线」照样回去，不弹「草稿没存上」；回去以后不再问服务', async () => {
  const p = page();
  await p.load(DEAD);
  assert.equal(p.note.className, 'fn-note warn');
  assert.match(p.note.textContent, /本机服务断了，写稿页没打开/);
  assert.equal(await p.ctx.SHELL.leave(), true, '换页、换项目（go、pickProject）也不拦');
  await p.back();
  assert.equal(p.ctx.SHELL, null);
  assert.ok(p.log.some(x => x[0] === '收起') && p.log.some(x => x[0] === '刷新'));
  assert.ok(!p.log.some(x => x[0] === '提示'), JSON.stringify(p.log));
  await p.tick();
  assert.deepEqual([p.asks, p.opened, p.timers.length], [0, 0, 0]);
});

test('写稿页没打开：隔两秒问一回本机服务，回来了自己再开一次；打开了，顶上那句换回来', async () => {
  const p = page(), tip = p.note.textContent;
  assert.match(tip, /这是初稿/);
  await p.load(DEAD);
  assert.deepEqual(p.timers.map(x => x[1]), [2000]);
  await p.tick();
  assert.deepEqual([p.asks, p.opened], [1, 0], '服务还没回来：接着等');
  p.up = { v: 29 };
  await p.tick();
  assert.deepEqual([p.asks, p.opened, p.timers.length], [2, 1, 0], '服务回来了：把框拿下来再放回去（照原网址再走一遍出错页活不过来，实测过），不再问');
  await p.load({ contentDocument: {}, contentWindow: { save: async () => true } });
  assert.deepEqual([p.note.className, p.note.textContent], ['fn-note', tip]);
  assert.equal(p.timers.length, 0);
});

test('写稿页打开了：存不上的照旧拦着（save 说不行、存的时候出错），存上了才回', async () => {
  const p = page(), tip = p.note.textContent;
  let say = false;
  await p.load({ contentDocument: {}, contentWindow: { save: async () => { if (say instanceof Error) throw say; return say; } } });
  assert.deepEqual([p.note.className, p.note.textContent, p.timers.length], ['fn-note', tip, 0], '打开了的不改顶上那句，也不问服务');
  await p.back();
  assert.notEqual(p.ctx.SHELL, null);
  assert.match(p.log.at(-1)[1], /草稿还未保存/);
  say = new Error('Failed to fetch');
  await p.back();
  assert.notEqual(p.ctx.SHELL, null);
  assert.equal(p.log.at(-1)[1], '草稿没存上：Failed to fetch');
  say = true;
  await p.back();
  assert.equal(p.ctx.SHELL, null);
  assert.ok(p.log.some(x => x[0] === '收起'));
});
