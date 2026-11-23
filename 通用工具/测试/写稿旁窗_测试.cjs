'use strict';
/* 公用/写稿旁窗.js：写稿页稿子旁边那一格，参考、看图都摆在这里（2026-11-22 他说写提示词时看图不影响看字）。
   一份假的页面：只够它用的几样（元素增删、class、事件），在 node 里跑真的脚本 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const CODE = fs.readFileSync(path.join(__dirname, '..', '公用', '写稿旁窗.js'), 'utf8');

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null; this.className = ''; this.dataset = {}; this.attrs = {}; this.listeners = {}; this.clientWidth = 0; this.scrollTop = 0; this.scrollLeft = 0; this.rect = null; this.title = ''; this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } }; }
  get classList() {
    const el = this, list = () => el.className.split(/\s+/).filter(Boolean);
    return {
      contains: c => list().includes(c),
      toggle: (c, force) => { const has = list().includes(c), want = force === undefined ? !has : !!force; if (want !== has) el.className = (want ? [...list(), c] : list().filter(x => x !== c)).join(' '); return want; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter(f => f !== fn); }
  fire(t, ev) { for (const fn of [...(this.listeners[t] || [])]) fn(Object.assign({ preventDefault() {}, target: this }, ev)); }
  click() { this.fire('click'); }
  append(...ns) { for (const n of ns) { if (n.parentElement) n.remove(); n.parentElement = this; this.children.push(n); } }
  remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null; } }
  before(n) { const p = this.parentElement; if (n.parentElement) n.remove(); n.parentElement = p; p.children.splice(p.children.indexOf(this), 0, n); }
  replaceWith(n) { const p = this.parentElement; if (n.parentElement) n.remove(); n.parentElement = p; p.children.splice(p.children.indexOf(this), 1, n); this.parentElement = null; }
  replaceChildren(...ns) { for (const c of [...this.children]) c.remove(); this.append(...ns); }
  querySelectorAll(sel) { const cls = sel.replace(/^\./, ''), out = [], walk = el => { for (const c of el.children) { if (c.classList.contains(cls)) out.push(c); walk(c); } }; walk(this); return out; }
  contains(n) { for (let x = n; x; x = x.parentElement) if (x === this) return true; return false; }
  getBoundingClientRect() { const r = this.rect || { left: 0, top: 0, width: this.clientWidth, height: 600 }; return Object.assign({ right: r.left + r.width, bottom: r.top + r.height }, r); }
  setPointerCapture() {}
}

/* 一页：.col 里一个 #canvas（稿子）。load 跑一遍真的脚本，给回 SideDock 和几样摸得着的 */
function load(width = 1000) {
  const col = new El('div'), canvas = new El('div'), docListeners = {};
  col.className = 'col'; canvas.className = 'canvas'; canvas.id = 'canvas'; col.append(canvas);
  const document = {
    getElementById: id => id === 'canvas' && col.contains(canvas) ? canvas : null,
    createElement: tag => new El(tag),
    addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  };
  const window = { UI: { icon: (name, cls) => { const s = new El('svg'); s.className = cls; s.dataset.icon = name; return s; } } };
  const ctx = { window, document, ResizeObserver: class { observe() {} }, Date, Math };
  vm.runInNewContext(CODE, ctx, { filename: '写稿旁窗.js' });
  const split = canvas.parentElement;
  split.clientWidth = width;
  const dock = name => { const el = new El('aside'); el.className = 'rf-dock'; el.name = name; return el; };
  const pointer = (target, y) => { for (const fn of docListeners.pointerdown || []) fn({ target, clientY: y }); };
  return { D: window.SideDock, canvas, split, col, dock, pointer };
}
const st = (mode, size) => ({ mode, side: size || 0.42, bottom: size || 0.42 });
const under = el => el.classList.contains('rf-under');

test('摆哪边：auto 照稿子这一块多宽（880 起摆右边），点过换边的照点的', () => {
  const { D } = load();
  assert.equal(D.modeFor(st('auto'), 879), 'bottom');
  assert.equal(D.modeFor(st('auto'), 880), 'side');
  assert.equal(D.modeFor(st('side'), 400), 'side');
  assert.equal(D.modeFor(st('bottom'), 2000), 'bottom');
  assert.equal(D.modeFor(null, 1200), 'side');
});

test('拖宽窄：照鼠标算占多少，限在 20%～72%', () => {
  const { D } = load();
  const box = { right: 1000, width: 1000, bottom: 800, height: 800 };
  assert.equal(D.sizeAt('side', box, 500, 0), 0.5);
  assert.equal(D.sizeAt('side', box, 995, 0), 0.2);
  assert.equal(D.sizeAt('side', box, 0, 0), 0.72);
  assert.equal(D.sizeAt('bottom', box, 0, 400), 0.5);
});

test('一引就把稿子包好：等写着字再挪，光标会丢', () => {
  const { canvas, split, col } = load();
  assert.equal(split.className, 'rf-split');
  assert.equal(split.parentElement, col);
  assert.deepEqual(split.children, [canvas]);
});

test('一次只露一个：后摆上来的盖在上面，收掉它露出底下那个；同一块换新的还在原来那一层', () => {
  const { D, split, dock } = load(1000);
  const ref = dock('参考'), view = dock('看图'), refOpt = { st: st('side', 0.4) };
  D.put('ref', ref, refOpt);
  assert.equal(D.top(), 'ref');
  assert.equal(split.className, 'rf-split side');
  assert.equal(split.style.props['--rf-size'], '40%');
  D.put('view', view, { st: st('bottom', 0.5) });
  assert.equal(D.top(), 'view');
  assert.ok(under(ref) && !under(view), '参考该盖在底下');
  assert.equal(split.className, 'rf-split bottom');   // 照露着的那一块摆
  assert.equal(split.style.props['--rf-size'], '50%');
  const ref2 = dock('参考换了一条');
  D.put('ref', ref2, refOpt);
  assert.equal(D.top(), 'view', '换了内容的参考不该翻到上面来');
  assert.ok(under(ref2) && !ref.parentElement, '新的那块换掉旧的，还在底下');
  D.drop('view');
  assert.equal(D.top(), 'ref');
  assert.ok(!under(ref2) && !view.parentElement);
  assert.equal(split.className, 'rf-split side');
  assert.equal(split.querySelectorAll('.rf-grip').length, 1, '拖宽窄的那条跟着收掉');
  D.drop('ref');
  assert.equal(D.top(), '');
  assert.equal(split.className, 'rf-split');
  assert.equal(split.children.length, 1);
});

test('raise：底下那块翻到上面来', () => {
  const { D, dock } = load();
  const ref = dock('参考'), view = dock('看图');
  D.put('ref', ref, { st: st('auto') }); D.put('view', view, { st: st('auto') });
  D.raise('ref');
  assert.equal(D.top(), 'ref');
  assert.ok(!under(ref) && under(view));
});

test('换边的钮：点了换边、记下来，图标和提示跟着变', () => {
  const { D, split, dock } = load(1000);
  const s = st('auto'); let saved = 0;
  const btn = D.swapBtn('view', s), el = dock('看图');
  el.append(btn);
  assert.equal(btn.title, '摆到稿子下面');   // 1000 宽：在右边
  D.put('view', el, { st: s, save: () => saved++ });
  btn.click();
  assert.equal(s.mode, 'bottom'); assert.equal(saved, 1);
  assert.equal(split.className, 'rf-split bottom');
  assert.equal(btn.title, '摆到稿子右边');
  assert.equal(btn.children[0].dataset.icon, 'dockR');
  btn.click();
  assert.equal(s.mode, 'side'); assert.equal(btn.title, '摆到稿子下面');
});

test('摆好以后：各块收到自己摆在哪边（盖着的收到空），onLayout 挂的每回都叫', () => {
  const { D, dock } = load(1000);
  const got = { ref: [], view: [] }; let hooks = 0;
  D.onLayout(() => hooks++);
  D.put('ref', dock('参考'), { st: st('side'), onLayout: m => got.ref.push(m) });
  D.put('view', dock('看图'), { st: st('bottom'), onLayout: m => got.view.push(m) });
  assert.deepEqual(got.ref, ['side', '']);
  assert.deepEqual(got.view, ['bottom']);
  D.drop('view');
  assert.equal(got.ref.at(-1), 'side');
  assert.equal(hooks, 3);
});

test('稿子里刚点的那一处：摆到下面被挤住了，稿子往上挪到露出来', () => {
  const { D, canvas, dock, pointer } = load(600);
  const line = new El('textarea'); canvas.append(line);
  canvas.rect = { left: 0, top: 0, width: 600, height: 400 };   // 下面摆上来以后稿子只剩 400 高
  pointer(line, 580);   // 按住 Ctrl 点的是 580 那一行
  D.put('view', dock('看图'), { st: st('bottom') });
  assert.equal(canvas.scrollTop, 580 - (400 - 60));
  pointer(new El('div'), 590);   // 点的不在稿子里：不挪
  D.drop('view'); canvas.scrollTop = 0;
  D.put('view', dock('看图'), { st: st('bottom') });
  assert.equal(canvas.scrollTop, 0);
});
