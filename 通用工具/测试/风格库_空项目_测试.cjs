'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const SL = require('../公用/风格库.js');
const libDir = path.join(__dirname, '..', 'AI短片风格库');
const entries = fs.readdirSync(libDir).filter(n => fs.statSync(path.join(libDir, n)).isFile());
const fixtures = new Map(entries.filter(n => /\.(txt|json|md)$/i.test(n)).map(n => [n, fs.readFileSync(path.join(libDir, n))]));
const sourceFile = path.resolve(process.env.STYLE_TEST_PAGE || path.join(__dirname, '..', '流水线', '风格.html'));
const source = fs.readFileSync(sourceFile, 'utf8').match(/<script>\s*([\s\S]*?)<\/script>/)[1];
function node(tag, attrs, ...children) {
  const out = { tag, attrs: attrs || {}, children: [], events: {}, addEventListener(type, listener) { this.events[type] = listener; }, async dispatch(type) { if (this.events[type]) await this.events[type](); }, append(...xs) { this.children.push(...xs.flat(Infinity).filter(x => x !== null && x !== undefined)); }, replaceChildren(...xs) { this.children = []; this.append(...xs); } };
  out.append(...children);
  return out;
}
function walk(n, fn) { if (!n || typeof n !== 'object') return; fn(n); for (const c of n.children || []) walk(c, fn); }
function textOf(n) { return n && typeof n === 'object' ? (n.children || []).map(textOf).join(' ') : String(n ?? ''); }
async function open({ project = '', online = true, failRead = false, includeMedia = true } = {}) {
  const root = node('div', { id: 'wf' });
  const getById = id => { let found = null; walk(root, n => { if (n.attrs.id === id) found = n; }); return found; };
  const reads = [], writes = [], mediaReads = [];
  const context = {
    console, Date, Map, Set, URL, setTimeout, clearTimeout,
    window: { StyleLib: SL, addEventListener() {} },
    document: { getElementById: getById, querySelectorAll: () => [] }, location: { hash: '' },
    LINK: { on: online }, F: { name: project, projects: project ? [project] : [], doc: project ? { 场: [], rest: {} } : null },
    C: { decodeText: buf => ({ text: Buffer.from(buf).toString('utf8') }) },
    FS: {
      async read(parts) { reads.push(parts); if (failRead) throw new Error('模拟风格库读取失败'); const buf = fixtures.get(parts.at(-1)); if (!buf) throw new Error('没有这个文件'); return { buf }; },
      async list() { return entries.filter(name => includeMedia || !/\.mp4$/i.test(name)).map(name => ({ name, kind: 'file', mtime: 0 })); },
      async file(parts) { mediaReads.push(parts); return new Blob(['sample'], { type: 'video/mp4' }); },
      async write(...args) { writes.push(args); }, async mkdir(...args) { writes.push(args); }
    },
    h: node, icon: name => node('i', null, name),
    secHead: (...xs) => node('header', null, ...xs),
    str: v => String(v == null ? '' : v), two: v => String(v).padStart(2, '0'),
    timeOf: v => Date.parse(String(v || '').replace(' ', 'T')) || 0, unbom: s => s.replace(/^\uFEFF/, ''),
    filmStyle: () => null, newProject: () => { throw new Error('浏览风格库不应自动创建项目'); },
    async start(page) {
      if (!online) { root.replaceChildren(node('p', null, '本机服务未连接')); return; }
      root.replaceChildren(project ? page.render() : node('p', null, '这里还没有项目。'));
    }
  };
  vm.runInNewContext(source, context, { filename: sourceFile });
  await new Promise(resolve => setImmediate(resolve));
  return { root, getById, reads, writes, mediaReads };
}
test('没有创作项目也能浏览公共风格卡片，不新建项目或写文件', async () => {
  const x = await open();
  assert.ok(x.getById('fg-main'), '应显示公共风格库，不能停在没有项目的提示上');
  assert.ok(x.getById('fg-s0'), '应读取并呈现真实风格卡片');
  assert.match(textOf(x.root), /邵氏港片/);
  assert.match(textOf(x.root), /王家卫/);
  assert.equal(x.writes.length, 0);
});
test('已有项目时沿用原有风格浏览入口', async () => {
  const x = await open({ project: '测试项目' });
  assert.ok(x.getById('fg-main'));
  assert.ok(x.getById('fg-s0'));
  assert.equal(x.writes.length, 0);
});
test('服务未连接时保留连接提示，不读取风格文件', async () => {
  const x = await open({ online: false });
  assert.equal(x.getById('fg-main'), null);
  assert.equal(x.reads.length, 0);
});
test('风格文件读取失败时显示实际错误', async () => {
  const x = await open({ failRead: true });
  assert.match(textOf(x.root), /模拟风格库读取失败/);
  assert.equal(x.writes.length, 0);
});

test('有样片时生成播放入口，点击后建立视频播放器', { skip: !entries.some(n => /\.mp4$/i.test(n)) }, async () => {
  const x = await open();
  const playButtons = [];
  walk(x.root, n => { if (n.attrs.class === 'fg-play') playButtons.push(n); });
  assert.equal(playButtons.length, entries.filter(n => /\.mp4$/i.test(n)).length);
  await playButtons[0].dispatch('click');
  let player = null;
  walk(x.root, n => { if (n.tag === 'video') player = n; });
  assert.ok(player, '点击放这条应建立视频元素');
  assert.match(player.attrs.src, /^blob:/);
  assert.ok(Object.hasOwn(player.attrs, 'controls'));
  assert.ok(Object.hasOwn(player.attrs, 'autoplay'));
  assert.equal(x.mediaReads.length, 1);
  assert.equal(x.writes.length, 0);
  URL.revokeObjectURL(player.attrs.src);
});

test('尚未下载样片时仍能显示风格文字，不创建空的播放入口', async () => {
  const x = await open({ includeMedia: false });
  assert.ok(x.getById('fg-s0'));
  let buttons = 0;
  walk(x.root, n => { if (n.attrs.class === 'fg-play') buttons++; });
  assert.equal(buttons, 0);
  assert.equal(x.writes.length, 0);
});
