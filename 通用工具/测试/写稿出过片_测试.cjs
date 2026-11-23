'use strict';
/* 写稿页：出过片的那一版顶上那一条（公用/写稿出过片.js）。11-23 他定：「另存成改N」不许原样照抄，交给 AI 照审片批注改（本机服务「照审片批注另存」）。
   没写批注点不了；点了交给 AI（写稿页的 tellAI），做完换到另存的那一版，没存上的字（恢复草稿）跟过去。
   页面的东西都用假的（h、$、fetch、tellAI……），不开浏览器。node --test 通用工具/测试/写稿出过片_测试.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FILE = path.join(__dirname, '..', '公用', '写稿出过片.js');
const Core = require('../公用/核心.js');

const KIND = '照审片批注另存';
const BASE = { 名: '11.txt', 出过片: true, 片: ['11.mp4'], 历史: [], 在出: false, 下一版: '11_改1.txt', 最新: '11.txt', 不能另存: '' };
function page(f, { svc = 24, live = [] } = {}) {
  const els = new Map(), store = new Map(), calls = { ai: [], toast: [], status: [] };
  const node = (tag, attrs, children) => {
    const n = { tag, attrs: attrs || {}, children: children.flat(Infinity).filter(x => x != null), dataset: {}, disabled: false, inert: false };
    if (n.attrs['data-sig'] != null) n.dataset.sig = n.attrs['data-sig'];
    if (n.attrs.id) els.set('#' + n.attrs.id, n);
    n.replaceWith = x => { els.set('#' + n.attrs.id, x); };
    return n;
  };
  const box = {
    h: (tag, attrs, ...children) => node(tag, attrs, children),
    $: sel => els.get(sel) || (sel === '#canvas' ? { prepend: x => els.set('#filmedBar', x) } : sel === '#filmed-css' || sel === '#filmedBar' ? null : { inert: false, disabled: false }),   // 别的是锁着的那几块
    document: { head: { append() {} } },
    toast: t => calls.toast.push(t), setStatus: t => calls.status.push(t),
    fetch: async () => ({ ok: true, json: async () => f }),
    HDR: {}, PJ: '试', SEGDIR: '第1段', STEM: '11', OPENPATH: '项目/试/提示词/第1段/11.txt', HNF: ['项目', '试', '提示词', '第1段', '11_批注.md'],
    JOBS: { live }, SVC: svc, Core, vpShort: s => s,
    draftKey: () => 'xiegao:draft:' + box.OPENPATH,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash: '' },
    tellAI: async line => { calls.ai.push(line); return { say: '弹出来了' }; },
  };
  box.window = box; box.parent = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), box, { filename: FILE });
  const bar = () => els.get('#filmedBar');
  const btn = () => { const b = bar(); const walk = n => !n || typeof n !== 'object' ? null : n.tag === 'button' ? n : n.children.map(walk).find(Boolean) || null; return walk(b); };
  const text = n => typeof n === 'string' ? n : n && n.children ? n.children.map(text).join('') : '';
  return { box, calls, store, bar, btn, text, F: box.Filmed };
}

test('交给 AI 的那一行：认「照审片批注另存」，别的不认', () => {
  const { F } = page(BASE);
  const base = { 渠道: 'self', 项目: '试', 段: '1', 名: '11.txt' };
  assert.deepEqual({ ...F.jobBody(KIND + ' 项目/试/提示词/第1段/11.txt', base) }, { ...base, 事: KIND });
  assert.equal(F.jobBody('另写一种 x', base), null);
});

test('没写批注：「另存成…」点不了，说先去审片写批注；页面锁着', async () => {
  const { F, btn, bar, text, calls } = page({ ...BASE, 批注: [] });
  assert.equal(await F.init(), true);
  assert.equal(F.on(), true);
  assert.equal(text(btn()), '另存成「11 改1」');
  assert.equal(btn().disabled, true);
  assert.match(text(bar()), /还没写批注：先到流水线这一条点「审片」/);
  assert.match(text(bar()), /AI 照批注改出新的一版（不许原样照抄）/);
  assert.deepEqual(calls.ai, []);
});

test('写了批注：点了交给 AI（不再照抄一份），AI 在做这一条时又点不了', async () => {
  const s = page({ ...BASE, 批注: ['成片/第1段/11_批注.md'] });
  await s.F.init();
  assert.equal(s.btn().disabled, false);
  assert.match(s.btn().attrs.title, /照 11_批注\.md 改，改好的另存成「11_改1\.txt」.*不许原样照抄/);
  await s.btn().attrs.onclick();
  assert.deepEqual(s.calls.ai, [KIND + ' 项目/试/提示词/第1段/11.txt']);
  assert.deepEqual(s.calls.toast, ['弹出来了']);
  const busy = page({ ...BASE, 批注: ['成片/第1段/11_批注.md'] }, { live: [{ 名: '11.txt' }] });
  await busy.F.init();
  assert.equal(busy.btn().disabled, true);
  assert.match(busy.text(busy.bar()), /AI 正在做这一条/);
  const old = page({ ...BASE, 批注: ['成片/第1段/11_批注.md'] }, { svc: 23 });   // 本机服务还是第 23 版
  await old.F.init();
  assert.equal(old.btn().disabled, true);
});

test('照审片批注另存做完：换到另存的那一版，没存上的字跟过去；没成的、别的条的不换', async () => {
  const { F, box, store } = page({ ...BASE, 批注: ['成片/第1段/11_批注.md'] });
  await F.init();
  store.set('xiegao:draft:项目/试/提示词/第1段/11.txt', '没存上的字');
  assert.equal(F.done({ 事: KIND, 状态: '没成', 名: '11.txt' }), false);
  assert.equal(F.done({ 事: KIND, 状态: '做完', 名: '12_改1.txt' }), false);   // 别的一条
  assert.equal(F.done({ 事: KIND, 状态: '做完', 名: '11_改1.txt', 结果: '改好了' }), true);
  assert.equal(box.location.hash, 'open=' + ['项目', '试', '提示词', '第1段', '11_改1.txt'].map(encodeURIComponent).join('/'));
  assert.equal(store.get('xiegao:draft:项目/试/提示词/第1段/11_改1.txt'), '没存上的字');
  assert.equal(store.has('xiegao:draft:项目/试/提示词/第1段/11.txt'), false);
  assert.equal(F.done({ 事: '按批注改提示词', 状态: '做完', 名: '11_改1.txt' }), true);   // 按批注改的另存也照旧换
});
