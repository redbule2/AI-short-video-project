'use strict';
/* 桌面版/lib/sync.js：工具文件同步进工作文件夹——新装、换新、本机改过先备份、新版不要的删掉、「项目」不碰、开发目录跳过 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { syncTools, safeRel } = require('../桌面版/lib/sync.js');

const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), '桌面版同步-'));
const at = (root, rel) => path.join(root, ...rel.split('/'));
const put = (root, rel, text) => { fs.mkdirSync(path.dirname(at(root, rel)), { recursive: true }); fs.writeFileSync(at(root, rel), text); };
const read = (root, rel) => fs.readFileSync(at(root, rel), 'utf8');
const has = (root, rel) => fs.existsSync(at(root, rel));
function bundleOf(src, files) {
  fs.rmSync(src, { recursive: true, force: true });
  const b = {};
  for (const [rel, text] of Object.entries(files)) { put(src, rel, text); b[rel] = sha1(text); }
  return b;
}
function setup() {
  const t = tmp();
  return { t, src: path.join(t, 'src'), work: path.join(t, 'work'), bak: path.join(t, 'bak') };
}

test('新装：清单里的都装进去，建好「项目」', () => {
  const { src, work, bak } = setup();
  const bundle = bundleOf(src, { 'AGENTS.md': 'a', '通用工具/公用/底座.js': 'b', '.agents/skills/x/SKILL.md': 'c' });
  const r = syncTools({ src, work, bundle, installed: {}, backupDir: bak });
  assert.equal(r.added.length, 3);
  assert.equal(read(work, '通用工具/公用/底座.js'), 'b');
  assert.ok(has(work, '项目'));
  assert.deepEqual(r.installed, bundle);
  assert.equal(has(bak, '通用工具'), false);
});

test('升级：没改过的直接换新；本机改过的先备份再换新', () => {
  const { src, work, bak } = setup();
  const v1 = bundleOf(src, { '通用工具/a.js': 'a1', '通用工具/b.js': 'b1' });
  const first = syncTools({ src, work, bundle: v1, installed: {}, backupDir: bak });
  put(work, '通用工具/b.js', '本机改的');
  const v2 = bundleOf(src, { '通用工具/a.js': 'a2', '通用工具/b.js': 'b2' });
  const r = syncTools({ src, work, bundle: v2, installed: first.installed, backupDir: bak });
  assert.deepEqual(r.updated.sort(), ['通用工具/a.js', '通用工具/b.js']);
  assert.deepEqual(r.backedUp, ['通用工具/b.js']);
  assert.equal(read(work, '通用工具/a.js'), 'a2');
  assert.equal(read(work, '通用工具/b.js'), 'b2');
  assert.equal(read(bak, '通用工具/b.js'), '本机改的');
});

test('不知道上回装的是哪一版：和清单不一样的都先备份', () => {
  const { src, work, bak } = setup();
  put(work, '通用工具/a.js', '老的');
  const bundle = bundleOf(src, { '通用工具/a.js': '新的' });
  const r = syncTools({ src, work, bundle, installed: {}, backupDir: bak });
  assert.deepEqual(r.backedUp, ['通用工具/a.js']);
  assert.equal(read(work, '通用工具/a.js'), '新的');
});

test('新版不要的：没改过的删掉、空文件夹一起删；改过的留着', () => {
  const { src, work, bak } = setup();
  const v1 = bundleOf(src, { '通用工具/留/a.js': 'a', '通用工具/旧/b.js': 'b', '通用工具/旧2/c.js': 'c' });
  const first = syncTools({ src, work, bundle: v1, installed: {}, backupDir: bak });
  put(work, '通用工具/旧2/c.js', '本机改的');
  const v2 = bundleOf(src, { '通用工具/留/a.js': 'a' });
  const r = syncTools({ src, work, bundle: v2, installed: first.installed, backupDir: bak });
  assert.deepEqual(r.removed, ['通用工具/旧/b.js']);
  assert.deepEqual(r.kept, ['通用工具/旧2/c.js']);
  assert.equal(has(work, '通用工具/旧'), false);
  assert.equal(read(work, '通用工具/旧2/c.js'), '本机改的');
  assert.ok(has(work, '通用工具/留/a.js'));
  assert.deepEqual(Object.keys(r.installed), ['通用工具/留/a.js']);
});

test('「项目」一律不碰：清单里写了也不装，上回记着的也不删', () => {
  const { src, work, bak } = setup();
  put(work, '项目/童晓晓/提示词/1-5.txt', '他写的稿');
  put(src, '项目/童晓晓/提示词/1-5.txt', '安装包里的');
  const bundle = { '项目/童晓晓/提示词/1-5.txt': sha1('安装包里的'), ...bundleOf(path.join(src, 'x'), {}) };
  const r = syncTools({ src, work, bundle, installed: { '项目/童晓晓/提示词/1-5.txt': sha1('他写的稿') }, backupDir: bak });
  assert.deepEqual(r.bad, ['项目/童晓晓/提示词/1-5.txt']);
  assert.equal(read(work, '项目/童晓晓/提示词/1-5.txt'), '他写的稿');
  assert.deepEqual(r.removed, []);
});

test('有 .git 的开发目录：整个跳过', () => {
  const { src, work, bak } = setup();
  fs.mkdirSync(path.join(work, '.git'), { recursive: true });
  put(work, '通用工具/a.js', '开发中的');
  const bundle = bundleOf(src, { '通用工具/a.js': '安装包里的' });
  const r = syncTools({ src, work, bundle, installed: {}, backupDir: bak });
  assert.match(r.skipped, /开发目录/);
  assert.equal(read(work, '通用工具/a.js'), '开发中的');
});

test('装进去的和清单对不上就停', () => {
  const { src, work, bak } = setup();
  put(src, '通用工具/a.js', '坏了的');
  assert.throws(() => syncTools({ src, work, bundle: { '通用工具/a.js': sha1('本该是这个') }, installed: {}, backupDir: bak }), /对不上/);
});

test('safeRel：只认三样开头、不许 ..、盘符、反斜杠', () => {
  assert.deepEqual(safeRel('通用工具/公用/底座.js'), ['通用工具', '公用', '底座.js']);
  assert.deepEqual(safeRel('AGENTS.md'), ['AGENTS.md']);
  assert.deepEqual(safeRel('.agents/skills/a/SKILL.md'), ['.agents', 'skills', 'a', 'SKILL.md']);
  for (const bad of ['项目/a.txt', '通用工具/../项目/a.txt', 'C:/a.js', '通用工具\\a.js', '/通用工具/a.js', 'AGENTS.md/x', '通用工具/a.js ', '通用工具//a.js', '.gitignore', '']) {
    assert.equal(safeRel(bad), null, bad);
  }
});
