'use strict';
/* 写稿页：出过片的那一版（公用/写稿出过片.js）。11-23 晚他定：「另存成改N」不看审片、批注；
   「另存以后…如果发现提示词、素材都没有变，则不允许保存」。点了另存放开这一页照它改，改了头一回存就另存成下一版（POST /api/filmed），
   这一页换成新的一版；没改的不存（服务回 422，写稿交互.js 的 saveEditor 照它不存、不挡着离开）。
   照审片批注另存、按批注改提示词（别处交的）做完，换到另存的那一版，没存上的字（恢复草稿）跟过去。
   11-24 他说「放开看图」：锁着也能看图，资产栏不锁（插入、挂上的钮藏起来），正文里点、停在图上转给那张图。
   页面的东西都用假的（h、$、fetch……），不开浏览器。node --test 通用工具/测试/写稿出过片_测试.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const FILE = path.join(__dirname, '..', '公用', '写稿出过片.js');
const SAVE_FILE = path.join(__dirname, '..', '公用', '写稿交互.js');
const Core = require('../公用/核心.js');

const KIND = '照审片批注另存';
const OPEN = '项目/试/提示词/第1段/11.txt';
const BASE = { 名: '11.txt', 出过片: true, 片: ['11.mp4'], 历史: [], 在出: false, 下一版: '11_改1.txt', 最新: '11.txt', 不能另存: '', 批注: [] };
const LOCK = ['#sheet', '#editor-mode', '#pane-ai', '#pane-lint', '#pane-shots'], OFF = ['#askAll', '#sendNotes'];
const FREE = ['#pane-assets'];   // 锁着也不锁：资产栏照常点图、钉住
function page(f, { svc = 25, live = [], hash = '' } = {}) {
  const els = new Map(), locks = new Map(), store = new Map(), cur = { f, post: null };
  const calls = { toast: [], status: [], fetch: [], retarget: [], retitle: [], recover: 0, ask: 0, send: 0, fin: 0 };
  for (const s of [...LOCK, ...OFF, ...FREE]) locks.set(s, { inert: false, disabled: false });
  const cls = () => { const set = new Set(); return { has: c => set.has(c), classList: { toggle: (c, on) => { if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c); }, add: c => set.add(c), remove: c => set.delete(c) } }; };
  const body = cls(), canvas = Object.assign(cls(), { prepend: x => els.set('#filmedBar', x) }), listeners = [];
  const node = (tag, attrs, children) => {
    const n = { tag, attrs: attrs || {}, children: children.flat(Infinity).filter(x => x != null), dataset: {}, disabled: false, inert: false };
    if (n.attrs['data-sig'] != null) n.dataset.sig = n.attrs['data-sig'];
    if (n.attrs.id) els.set('#' + n.attrs.id, n);
    n.replaceWith = x => { els.set('#' + n.attrs.id, x); };
    n.remove = () => { els.delete('#' + n.attrs.id); };
    return n;
  };
  const box = {
    h: (tag, attrs, ...children) => node(tag, attrs, children),
    $: sel => els.get(sel) || locks.get(sel) || (sel === '#canvas' ? canvas : null),
    $$: sel => (box.SHEET && box.SHEET[sel]) || [], SHEET: null,
    document: { head: { append() {} }, body },
    addEventListener: (t, fn, cap) => listeners.push([t, fn, cap]),
    MouseEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } },
    toast: t => calls.toast.push(t), setStatus: t => calls.status.push(t),
    fetch: async (url, opts) => {
      calls.fetch.push([url, opts]);
      if (opts && opts.method === 'POST') return cur.post;
      return { ok: true, json: async () => cur.f };
    },
    HDR: { 'X-Antou': '1' }, PJ: '试', SEGDIR: '第1段', STEM: '11', OPENPATH: OPEN, HNF: ['项目', '试', '提示词', '第1段', '11_批注.md'],
    JOBS: { live }, SVC: svc, Core, vpShort: s => s,
    SNAP: { 写法: '分镜', 分镜稿: '原文', 挂图: {} },
    editorSnapshot: () => JSON.parse(JSON.stringify(box.SNAP)),
    draftKey: () => 'xiegao:draft:' + box.OPENPATH,
    offerRecovery: () => { calls.recover++; },
    setAsk: () => { calls.ask++; }, paintSend: () => { calls.send++; }, Finish: { paint: () => { calls.fin++; } },
    ShotEdit: { retarget: (name, was) => { calls.retarget.push([name, was]); box.OPENPATH = [...was.split('/').slice(0, -1), name].join('/'); box.STEM = name.replace(/\.txt$/, ''); } },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    location: { hash },
  };
  box.window = box;
  box.parent = { retitleWrite: (a, b) => calls.retitle.push([a, b]) };   // 在流水线里开的
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), box, { filename: FILE });
  const bar = () => els.get('#filmedBar');
  const btn = () => { const walk = n => !n || typeof n !== 'object' ? null : n.tag === 'button' ? n : n.children.map(walk).find(Boolean) || null; return walk(bar()); };
  const text = n => typeof n === 'string' ? n : n && n.children ? n.children.map(text).join('') : '';
  const locked = () => Object.fromEntries([...LOCK.map(s => [s, locks.get(s).inert]), ...OFF.map(s => [s, locks.get(s).disabled])]);
  return { box, cur, calls, store, bar, btn, text, locked, locks, body, canvas, listeners, F: box.Filmed };
}
const allLocked = Object.fromEntries([...LOCK, ...OFF].map(s => [s, true]));
const allOpen = Object.fromEntries([...LOCK, ...OFF].map(s => [s, false]));
const lockOpen = { ...allOpen, '#askAll': true, '#sendNotes': true };   // 改的地方全放开；请 AI 批、交给 AI 改的按钮由写稿页 setAsk、Finish.paint 照它们自己的条件放开
const pendLocked = { ...allOpen, '#pane-shots': true, '#askAll': true, '#sendNotes': true };   // 另存还没存成：只关加减镜头、请 AI 批、交给 AI 改

test('出过片的那一版：整页锁着；「另存成…」不用先写批注就能点', async () => {
  const { F, btn, bar, text, locked, calls } = page(BASE);
  assert.equal(await F.init(), true);
  assert.equal(F.on(), true);
  assert.equal(F.pending(), '');
  assert.deepEqual(locked(), allLocked);
  assert.equal(text(btn()), '另存成「11 改1」');
  assert.equal(btn().disabled, false);
  assert.match(btn().attrs.title, /改了提示词或素材才存成「11_改1\.txt」，一处没改就不另存/);
  assert.match(text(bar()), /要改就点「另存」.*改了提示词或素材才存成新的一版/);
  assert.doesNotMatch(text(bar()), /审片|批注/);
  assert.equal(calls.recover, 0);   // 锁着的不问恢复草稿（写稿页照 init 给的 true 不问）
});

test('点了另存：改字、挂图的地方放开，加减镜头、请 AI 批、交给 AI 改还关着；横条换成「正在另存」，接着问恢复草稿', async () => {
  const { F, btn, bar, text, locked, calls, box } = page(BASE);
  await F.init();
  btn().attrs.onclick();
  assert.equal(F.on(), false);
  assert.match(F.pending(), /还没另存成「11 改1」：先改一处提示词或素材/);
  assert.deepEqual(locked(), pendLocked);
  assert.match(text(bar()), /正在另存成「11 改1」，原稿「11」不动。/);
  assert.match(text(bar()), /一处没改不另存，回到流水线也不会多出一版/);
  assert.equal(btn(), null);
  assert.equal(F.base(), JSON.stringify(box.SNAP));   // 点另存那一刻的样子：存的时候和它比
  assert.equal(calls.recover, 1);
  assert.match(calls.status.at(-1), /另存成「11 改1」：改了才存/);
  F.paint();   // 每秒都来：照旧只锁那几样
  assert.deepEqual(locked(), pendLocked);
});

test('网址带 fork=1（流水线那一行点「另存成改N」开的）：一打开就是另存，init 给 false（写稿页接着问恢复草稿）', async () => {
  const { F, locked, calls } = page(BASE, { hash: '#open=' + encodeURIComponent('项目') + '/x&fork=1' });
  assert.equal(await F.init(), false);
  assert.match(F.pending(), /11 改1/);
  assert.deepEqual(locked(), pendLocked);
  assert.equal(calls.recover, 0);   // 写稿页自己问
  const no = page(BASE, { hash: '#open=x&fork=12' });
  assert.equal(await no.F.init(), true);   // 不是 fork=1
  assert.equal(no.F.pending(), '');
});

test('另存不了的：AI 正在做这一条、本机服务是旧的、不是最新一版、正在出片', async () => {
  const busy = page(BASE, { live: [{ 名: '11.txt' }] });
  await busy.F.init();
  assert.equal(busy.btn().disabled, true);
  assert.match(busy.text(busy.bar()), /AI 正在做这一条/);
  busy.btn().attrs.onclick();
  assert.equal(busy.F.pending(), '');
  const old = page(BASE, { svc: 24 });   // 本机服务还是第 24 版：不会带着字另存
  await old.F.init();
  assert.equal(old.btn().disabled, true);
  assert.match(old.text(old.bar()), /本机服务是旧的/);
  const url = page(BASE, { svc: 24, hash: '#open=x&fork=1' });
  assert.equal(await url.F.init(), true);   // 网址带了也不放开
  assert.equal(url.F.pending(), '');
  const top = page({ ...BASE, 下一版: '', 最新: '11_改1.txt', 不能另存: '这一条已经有更新的「11_改1.txt」了：去改那一版' });
  await top.F.init();
  assert.equal(top.text(top.btn()), '打开最新的「11 改1」');
  const on = page({ ...BASE, 在出: true, 下一版: '', 不能另存: '这一版正在出片：出完再另存成新的一版' });
  await on.F.init();
  assert.match(on.text(on.bar()), /这一版正在出片，原稿不能改/);
  assert.equal(on.btn(), null);
});

test('锁着能看图：资产栏不锁；插入、挂上的钮藏起来（body 挂 filmed-ro），点了另存、另存成了就露出来', async () => {
  const s = page(BASE);
  await s.F.init();
  assert.equal(s.locks.get('#pane-assets').inert, false);
  assert.equal(s.body.has('filmed-ro'), true);
  s.F.paint();
  assert.equal(s.locks.get('#pane-assets').inert, false);
  s.btn().attrs.onclick();   // 点另存：能插了
  assert.equal(s.body.has('filmed-ro'), false);
  s.F.paint();
  assert.equal(s.body.has('filmed-ro'), false);
  s.F.made({ 名: '11_改1.txt' });
  assert.equal(s.body.has('filmed-ro'), false);
  const t = page({ ...BASE, 出过片: false, 片: [], 下一版: '' });   // 没出过片的：不挂
  assert.equal(await t.F.init(), false);
  assert.equal(t.body.has('filmed-ro'), false);
  const u = page(BASE);   // 存稿撞上 423 锁上的：一样藏
  await u.F.hit('这一版刚出了片');
  assert.equal(u.body.has('filmed-ro'), true);
});

test('锁着能看图：正文里点、停在图上的这一下转给那张图（照写稿页自己的看大图、悬停小图走），别处不管', async () => {
  const s = page(BASE);
  await s.F.init();
  const [click, move] = ['click', 'mousemove'].map(t => s.listeners.find(l => l[0] === t && l[2] === true)[1]);
  const got = [];
  const el = (c, r) => ({ getClientRects: () => [r], matches: sel => sel === '.' + c, dispatchEvent: e => got.push([c, e]) });
  s.box.SHEET = { '#sheet .wr-ta': [el('wr-ta', { left: 0, right: 100, top: 0, bottom: 50 })], '#sheet .ref': [el('ref', { left: 0, right: 40, top: 60, bottom: 80 })] };
  const ev = (type, x, y, more) => ({ type, isTrusted: true, target: s.canvas, clientX: x, clientY: y, screenX: x, screenY: y, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false,
    button: 0, buttons: 0, detail: 1, stopped: 0, stopPropagation() { this.stopped++; }, ...more });
  let e = ev('click', 10, 70);   // 点 @图片N 小牌子
  click(e);
  assert.equal(e.stopped, 1);
  assert.equal(got.length, 1);
  assert.equal(got[0][0], 'ref');
  assert.equal(got[0][1].type, 'click'); assert.equal(got[0][1].clientX, 10); assert.equal(got[0][1].clientY, 70); assert.equal(got[0][1].bubbles, true);
  click(ev('click', 50, 20, { ctrlKey: true }));   // 按住 Ctrl 点文字框里的 @图片N：Ctrl 跟着转（写稿页照它认是看图）
  assert.equal(got.at(-1)[0], 'wr-ta'); assert.equal(got.at(-1)[1].ctrlKey, true);
  for (const x of [ev('click', 300, 300), ev('click', 10, 70, { isTrusted: false }), ev('click', 10, 70, { target: {} }), ev('mousemove', 10, 70, { buttons: 1 })]) {   // 别处、转出来的、没落在 #canvas 上的、按着键拖的：不管
    const n = got.length;
    (x.type === 'click' ? click : move)(x);
    assert.equal(got.length, n); assert.equal(x.stopped, 0);
  }
  move(ev('mousemove', 10, 70));   // 停在小牌子上：转过去出小图，鼠标是放大镜
  assert.equal(got.at(-1)[0], 'ref'); assert.equal(got.at(-1)[1].type, 'mousemove');
  assert.equal(s.canvas.has('filmed-pic'), true);
  move(ev('mousemove', 50, 20));   // 文字框上：转过去，鼠标照旧
  assert.equal(got.at(-1)[0], 'wr-ta'); assert.equal(s.canvas.has('filmed-pic'), false);
  move(ev('mousemove', 10, 70)); move(ev('mousemove', 300, 300));
  assert.equal(s.canvas.has('filmed-pic'), false);
  s.btn().attrs.onclick();   // 点了另存：正文放开了，写稿页自己接得住，不再转
  const n = got.length;
  e = ev('click', 10, 70);
  click(e);
  assert.equal(got.length, n); assert.equal(e.stopped, 0);
});

test('写稿页：插入、挂上的钮都带 data-ins（锁着藏起来），看图那一格的「插入」也带；insertFromRail 锁着拦下', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '项目管理_写稿试用.html'), 'utf8');
  const btns = src.match(/h\('button', \{[^}]*insertFromRail\(a\)[^}]*\}/g) || [];
  assert.equal(btns.length, 4);
  for (const b of btns) assert.match(b, /'data-ins': ''/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', '公用', '写稿看图.js'), 'utf8'), /'data-ins': '', title: '放到稿子里光标停的地方'/);
  assert.match(fs.readFileSync(FILE, 'utf8'), /\.filmed-ro \[data-ins\]\{display:none!important\}/);
  const fn = src.match(/\nfunction insertFromRail\(a\) \{[\s\S]*?\n\}\n/)[0];
  const run = locked => {
    const box = { Filmed: { on: () => locked }, toasts: [], ins: [], LASTF: { isConnected: true, selectionStart: 1, selectionEnd: 1 }, LAST: null, isVoice: () => false };
    box.toast = t => box.toasts.push(t); box.insertAsset = (a, w) => box.ins.push(a);
    vm.createContext(box); vm.runInContext(fn + 'insertFromRail({ path: \'a.png\' });', box);
    return box;
  };
  const on = run(true);
  assert.deepEqual(on.ins, []);
  assert.match(on.toasts[0], /出过片，原稿不能改/);
  const off = run(false);
  assert.equal(off.ins.length, 1); assert.deepEqual(off.toasts, []);
});

test('post：带着这一页的字和写稿资料 POST 到 /api/filmed（问的是出过片的那一版）', async () => {
  const { F, calls, cur } = page(BASE);
  await F.init();
  cur.post = { status: 200 };
  assert.equal(await F.post('新字', { 写法: '分镜' }), cur.post);
  const [url, opts] = calls.fetch.at(-1);
  assert.equal(url, '/api/filmed?p=' + encodeURIComponent('试') + '&s=1&n=11.txt');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers['X-Antou'], '1');
  assert.deepEqual(JSON.parse(opts.body), { text: '新字', side: { 写法: '分镜' } });
});

test('made：另存成了，这一页换成新的一版接着写：retarget、流水线顶上那一行换名字、全放开、横条拿掉', async () => {
  const s = page(BASE);
  await s.F.init();
  s.btn().attrs.onclick();   // 点另存
  s.F.made({ 名: '11_改1.txt' });
  assert.deepEqual(s.calls.retarget, [['11_改1.txt', OPEN]]);
  assert.deepEqual(s.calls.retitle, [['11.txt', '11.txt'], ['11.txt', '11_改1.txt']]);   // 点另存那一下先叫一回（流水线「进去看」开的：顶上「只能看」换成「另存」，11-24），存成了再换名字
  assert.equal(s.F.pending(), ''); assert.equal(s.F.on(), false); assert.equal(s.F.base(), '');
  assert.deepEqual(s.locked(), lockOpen);
  assert.equal(s.bar(), undefined);
  assert.ok(s.calls.ask && s.calls.send && s.calls.fin);
  assert.match(s.calls.toast.at(-1), /另存成「11 改1」了：原稿「11」和它出的样片都不动/);
  s.F.paint();   // 之后每秒照常：不再锁
  assert.deepEqual(s.locked(), lockOpen);
});

test('made：网址带 fork=1 开的，顶上那一行一开始就写着下一版，名字没变不改；改了名（miss 以后）照改', async () => {
  const s = page(BASE, { hash: '#open=x&fork=1' });
  await s.F.init();
  s.F.made({ 名: '11_改1.txt' });
  assert.deepEqual(s.calls.retitle, []);
  const t = page(BASE, { hash: '#open=x&fork=1' });
  await t.F.init();
  t.cur.f = { ...BASE, 下一版: '11_改2.txt' };
  await t.F.miss('「11_改1.txt」刚有了：刷新再试');
  t.F.made({ 名: '11_改2.txt' });
  assert.deepEqual(t.calls.retitle, [['11_改1.txt', '11_改2.txt']]);
});

test('miss：名字被占了照新排的名字接着另存；另存不了的锁回去；不算出过片了的全放开', async () => {
  const s = page(BASE);
  await s.F.init();
  s.btn().attrs.onclick();
  s.cur.f = { ...BASE, 下一版: '11_改2.txt' };
  await s.F.miss('「11_改1.txt」刚有了：刷新再试');
  assert.match(s.F.pending(), /11 改2/);
  assert.deepEqual(s.locked(), pendLocked);
  assert.equal(s.calls.toast.at(-1), '没另存成：「11_改1.txt」刚有了：刷新再试');
  assert.match(s.calls.status.at(-1), /你写的留在浏览器里/);
  s.cur.f = { ...BASE, 在出: true, 下一版: '', 不能另存: '这一版正在出片：出完再另存成新的一版' };
  await s.F.miss('这一版正在出片');
  assert.equal(s.F.pending(), ''); assert.equal(s.F.on(), true);
  assert.deepEqual(s.locked(), allLocked);
  const g = page(BASE);
  await g.F.init();
  g.btn().attrs.onclick();
  g.cur.f = { ...BASE, 出过片: false, 片: [], 下一版: '' };
  await g.F.miss('这一版还没出片，直接改就行');
  assert.equal(g.F.pending(), ''); assert.equal(g.F.on(), false);
  assert.deepEqual(g.locked(), lockOpen);
  assert.ok(g.calls.ask && g.calls.send && g.calls.fin);
  assert.equal(g.bar(), undefined);
});

test('照审片批注另存、按批注改提示词做完：换到另存的那一版，没存上的字跟过去；没成的、别的条的不换', async () => {
  const { F, box, store, calls } = page({ ...BASE, 批注: ['成片/第1段/11_批注.md'] });
  await F.init();
  store.set('xiegao:draft:' + OPEN, '没存上的字');
  assert.equal(F.done({ 事: KIND, 状态: '没成', 名: '11.txt' }), false);
  assert.equal(F.done({ 事: KIND, 状态: '做完', 名: '12_改1.txt' }), false);   // 别的一条
  assert.equal(F.done({ 事: '另写一种', 状态: '做完', 名: '11_改1.txt' }), false);
  assert.equal(F.done({ 事: KIND, 状态: '做完', 名: '11_改1.txt', 结果: '改好了' }), true);
  assert.equal(box.location.hash, 'open=' + ['项目', '试', '提示词', '第1段', '11_改1.txt'].map(encodeURIComponent).join('/'));
  assert.equal(store.get('xiegao:draft:项目/试/提示词/第1段/11_改1.txt'), '没存上的字');
  assert.equal(store.has('xiegao:draft:' + OPEN), false);
  assert.deepEqual(calls.retitle, [['11.txt', '11_改1.txt']]);
  assert.equal(F.done({ 事: '按批注改提示词', 状态: '做完', 名: '11_改1.txt' }), true);   // 按批注改的另存也照旧换
});

/* ---------- 写稿页存稿（公用/写稿交互.js 的 saveEditor）：另存还没存成的走 Filmed.post；服务回 422 不存、不挡着离开 ---------- */
function saver({ pend = '', base = null } = {}) {
  const calls = { post: [], made: [], miss: [], draft: [], status: [], remember: 0, conflict: 0 };
  const store = new Map([['k', '恢复草稿']]);
  const res = (status, body) => ({ status, ok: status >= 200 && status < 300, text: async () => typeof body === 'string' ? body : JSON.stringify(body), json: async () => body });
  const box = {
    READY: true, CONFLICT: false, RECOVERY_PENDING: false, PULLING: false, SAVE_PROMISE: null, AGAIN: false, SAVING: false, SAVE_RETRY: false,
    VER: 0, SAVEDVER: 0, LASTTEXT: '原文', MTIME: 1, SIDE_MT: 1, SIDE: { 挂图: {} }, BASE_EDITOR: { 写法: '分镜' }, ARCHIVED: false, SAVED_AT: null, ST: 0,
    SNAP: { 写法: '分镜' }, TEXT: '原文', next: null, HDR: {},
    editorSnapshot: () => JSON.parse(JSON.stringify(box.SNAP)), activeText: () => box.TEXT, editorPart: s => ({ 写法: s.写法 }),
    dirty: () => box.VER !== box.SAVEDVER, api: () => '/api/fs/x?draft', PROMPT: [], save: () => {},
    fetch: async (url, opts) => { calls.draft.push(JSON.parse(opts.body)); return box.next; },
    rememberDraft: () => { calls.remember++; }, setStatus: (t, err) => calls.status.push([t, !!err]),
    savedText: () => '已保存', draftKey: () => 'k', structuredClone,
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) },
    clearTimeout() {}, setTimeout() {},
    Filmed: {
      on: () => false, pending: () => box.pend ? '还没另存成「11 改1」' : '', base: () => base || JSON.stringify({ 写法: '分镜' }),
      post: async (text, side) => { calls.post.push({ text, side }); return box.next; },
      made: r => { calls.made.push(r); box.pend = ''; }, miss: async m => { calls.miss.push(m); }, hit: async () => {},
    },
    pend,
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(fs.readFileSync(SAVE_FILE, 'utf8'), box, { filename: SAVE_FILE });
  box.reportConflict = () => { calls.conflict++; };   // 写稿交互.js 自己也有一个（要摆冲突条），换成记一笔
  return { box, calls, store, res };
}
test('存稿：另存还没存成、没改过（和点另存那一刻一样）不存，也不另存', async () => {
  const { box, calls } = saver({ pend: '11_改1.txt' });
  assert.equal(await box.saveEditor(), true);
  assert.deepEqual(calls.post, []); assert.deepEqual(calls.draft, []);
});
test('存稿：另存还没存成，拨了合并、分区这类（没打字，写稿资料变了）也算改过，走另存', async () => {
  const { box, calls, res } = saver({ pend: '11_改1.txt' });
  box.SNAP = { 写法: '分镜', 镜头写法: '合并' }; box.TEXT = '换了写法的字';
  box.next = res(200, { 名: '11_改1.txt', side: { 写法: '分镜', 镜头写法: '合并' }, mtime: 5, sideMtime: 6 });
  assert.equal(await box.saveEditor(), true);
  assert.deepEqual(calls.post, [{ text: '换了写法的字', side: { 写法: '分镜', 镜头写法: '合并' } }]);
  assert.equal(calls.made.length, 1);
});
test('存稿：另存还没存成、改了字：POST 另存，成了换成新的一版接着记（字、修改时间、写稿资料）', async () => {
  const { box, calls, store, res } = saver({ pend: '11_改1.txt' });
  box.VER = 1; box.TEXT = '新字';
  box.next = res(200, { 名: '11_改1.txt', side: { 写法: '分镜', 挂图: {} }, mtime: 9, sideMtime: 10 });
  assert.equal(await box.saveEditor(), true);
  assert.deepEqual(calls.post, [{ text: '新字', side: { 写法: '分镜' } }]);
  assert.deepEqual(calls.draft, []);   // 不走普通存稿
  assert.deepEqual(calls.made.map(r => r.名), ['11_改1.txt']);
  assert.equal(box.LASTTEXT, '新字'); assert.equal(box.MTIME, 9); assert.equal(box.SIDE_MT, 10);
  assert.equal(box.SAVEDVER, 1); assert.equal(box.ARCHIVED, true);
  assert.equal(store.has('k'), false);
});
test('存稿：提示词、素材都没变（服务回 422）：不存、不挡着离开，说一句；恢复草稿清掉', async () => {
  const { box, calls, store, res } = saver({ pend: '11_改1.txt' });
  box.VER = 3; box.next = res(422, '提示词和素材都和出过片的「11.txt」一样：一处没改的不存成新的一版。改了提示词或换了素材再存');
  assert.equal(await box.saveEditor(), true);
  assert.equal(box.SAVEDVER, 3);
  assert.deepEqual(calls.made, []);
  assert.deepEqual(calls.status.at(-1), ['提示词和素材都和出过片的「11.txt」一样：一处没改的不存成新的一版。改了提示词或换了素材再存', true]);
  assert.equal(store.has('k'), false);
  assert.equal(box.LASTTEXT, '原文');   // 文件没动：照旧拿它当底
  const after = saver();   // 另存出来的一版改回原样：普通存稿回 422，一样处理
  after.box.VER = 2; after.box.next = after.res(422, '一样');
  assert.equal(await after.box.saveEditor(), true);
  assert.equal(after.box.SAVEDVER, 2);
  assert.equal(after.calls.draft.length, 1);
});
test('存稿：另存撞上名字刚被占（409）：交给 Filmed.miss，字记进恢复草稿，这回没存上', async () => {
  const { box, calls, res } = saver({ pend: '11_改1.txt' });
  box.VER = 1; box.next = res(409, '「11_改1.txt」刚有了：刷新再试');
  assert.equal(await box.saveEditor(), false);
  assert.deepEqual(calls.miss, ['「11_改1.txt」刚有了：刷新再试']);
  assert.equal(calls.remember, 1); assert.equal(calls.conflict, 0);
  assert.equal(box.SAVEDVER, 0);
  const plain = saver();   // 不是另存：409 照旧当冲突
  plain.box.VER = 1; plain.box.next = plain.res(409, '冲突');
  assert.equal(await plain.box.saveEditor(), false);
  assert.equal(plain.calls.conflict, 1); assert.deepEqual(plain.calls.miss, []);
});
