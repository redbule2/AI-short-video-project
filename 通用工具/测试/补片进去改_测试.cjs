'use strict';
// node --test 通用工具/测试/补片进去改_测试.cjs
// 补片稿 原名_补1.txt（11-18 他要）：提示词页那一行的「看稿」换成「进去改」，进去和别的提示词是同一个写稿页；
// 写稿页认它，「请 AI 批」「按批注改」也认它。批准出片照普通的一条走。
// 只读页面和后台的代码，项目读写都在内存里，不碰真项目。
// 先在副本上试：PATCH_TEST_PROMPT_PAGE、PATCH_TEST_WRITE_PAGE、PATCH_TEST_JOBS 指到副本。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const Core = require('../公用/核心.js');

const promptPage = process.env.PATCH_TEST_PROMPT_PAGE || path.join(__dirname, '../流水线/提示词.html');
const writePage = process.env.PATCH_TEST_WRITE_PAGE || path.join(__dirname, '../项目管理_写稿试用.html');
const liveDir = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const backend = process.env.PATCH_TEST_JOBS || path.join(liveDir, 'jobs.js');
const root = path.resolve(__dirname, '__内存测试根__');
const segPath = (...x) => path.join(root, '项目', '测试', '提示词', '第1-1段', ...x);

function buttonsOf(node) {
  if (!node || typeof node !== 'object') return [];
  return [...(node.tag === 'button' ? [node] : []), ...node.children.flatMap(buttonsOf)];
}

/* 提示词页里补片稿那一行：names 是这一段 提示词 文件夹里有的文件 */
function patchRow(names) {
  const html = fs.readFileSync(promptPage, 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const a = script.indexOf('function patchRow('), b = script.indexOf('/* 出过片的那一条标出来', a);
  assert.ok(a > 0 && b > a, '提示词页要有 patchRow');
  const calls = [];
  const context = {
    window: { Core: { vpPatchOf: Core.vpPatchOf, patchOut: () => ({ no: 4, sample: '4-6.mp4', dir: '4-6_补片', file: '补1.mp4' }) } },
    h: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(x => x != null) }),
    segName: d => '第' + d + '段', clipsOf: () => ({ vids: [] }), taskOf: n => n.replace(/\.txt$/, '_出片任务.txt'), vpLabel: Core.vpLabel,
    F: { names: new Map([['1-1', { set: new Set(names) }]]) }, AI: { ok: true, jobs: [] }, jobLive: () => true, X: { tasks: new Set() },
    jobLine: () => null, jobFailed: () => null, showText: () => {}, at: parts => parts, dirOf: () => ['提示词', '第1-1段'],
    openWrite: (...args) => calls.push(['编辑', ...args]),
    openShell: (...args) => calls.push(['查看', ...args]),
    approve: (...args) => calls.push(['出片', ...args]),
  };
  vm.createContext(context);
  vm.runInContext(script.slice(a, b), context, { filename: promptPage });
  const scene = { 段: '1-1' };
  const buttons = [context.patchRow(scene, '4-6_补1.txt')].flat().flatMap(buttonsOf);
  return { buttons, calls, scene, label: t => buttons.find(x => x.children.join('') === t) };
}

/* 后台的 jobs.js：文件都在内存里，不调外部命令 */
function kindsWith(files) {
  const fail = code => Object.assign(new Error(code), { code });
  const mockFs = {
    existsSync: p => files.has(p),
    promises: {
      async readFile(p, enc) { if (!files.has(p)) throw fail('ENOENT'); return enc ? files.get(p).toString(enc) : Buffer.from(files.get(p)); },
      async stat(p) { if (!files.has(p)) throw fail('ENOENT'); return { mtimeMs: 0 }; },
      async mkdir() {}, async readdir() { return []; },
      async writeFile(p, d) { files.set(p, Buffer.from(d)); },
      async rename() { throw Error('测试不挪文件'); }, async copyFile() { throw Error('测试不复制文件'); },
    },
  };
  const box = { module: { exports: {} }, __dirname: liveDir, Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn() { throw Error('测试不能调用外部命令'); } }
      : name === './jm-check.js' ? () => async () => ({}) : name === './canvas.js' ? () => ({ versions: async () => [], plan: () => '' })
      : require(name.startsWith('.') ? path.resolve(liveDir, name) : name),
  };
  vm.runInNewContext(fs.readFileSync(backend, 'utf8'), box, { filename: backend });
  return box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (p, fn) => fn() }).KINDS;
}

test('提示词页补片稿那一行：「看稿」换成「进去改」，点了进同一个写稿页', () => {
  const { buttons, calls, label } = patchRow(['4-6.txt', '4-6_补1.txt']);
  const labels = buttons.map(b => b.children.join(''));
  assert.ok(!labels.includes('看稿'), '不再有「看稿」');
  label('进去改').attrs.onclick();
  assert.deepEqual(calls, [['编辑', '1-1', '4-6_补1.txt']]);
});

test('补片稿批准出片照普通的一条走：没进去改过不算你写的稿，进去改过（有 _写稿.json）就算', () => {
  for (const [names, draft] of [[['4-6.txt', '4-6_补1.txt'], false], [['4-6.txt', '4-6_补1.txt', '4-6_补1_写稿.json'], true]]) {
    const { calls, scene, label } = patchRow(names);
    const go = label('批准出片');
    assert.equal(go.attrs.disabled, false);
    go.attrs.onclick();
    assert.equal(calls.length, 1);
    const [kind, s, e] = calls[0];
    assert.equal(kind, '出片');
    assert.equal(s, scene);
    assert.equal(e.name, '4-6_补1.txt');
    assert.equal(e.patch, true);
    assert.equal(e.draft, draft, names.join('、'));
    assert.deepEqual([...e.vers], ['4-6_补1.txt']);
  }
});

test('写稿页认补片稿：网址里点名开 4-6_补1.txt 就开它', () => {
  const html = fs.readFileSync(writePage, 'utf8');
  const line = html.split('\n').find(l => /const vpOk = /.test(l));
  assert.ok(line, '写稿页要有 vpOk');
  const vpOk = vm.runInNewContext(line.replace(/\/\/.*$/, '') + '\nvpOk;', { Core });
  for (const n of ['4-6.txt', '4-6_改1.txt', '4-6_补1.txt', '4-6_改1_补2.txt']) assert.equal(vpOk(n), true, n);
  for (const n of ['4-6_出片任务.txt', '4-6_补1_写稿.json', '4-6_补1_AI批注.md', '4-6_批注.md']) assert.equal(vpOk(n), false, n);
  assert.match(html, /if \(open\.length < 3 \|\| !vpOk\(open\[open\.length - 1\]\)\)/);
});

test('「请 AI 批」认补片稿；不是提示词的、文件不在的照旧拦下', async () => {
  const files = new Map([[segPath('4-6_补1.txt'), Buffer.from('【事件脚本】\n镜头1：洪七公出掌。\n')], [segPath('4-6_出片任务.txt'), Buffer.from('任务书')]]);
  const K = kindsWith(files), job = 名 => ({ 项目: '测试', 段: '1-1', 名 });
  await K.批注提示词.prep(job('4-6_补1.txt'));
  assert.equal(K.批注提示词.title(job('4-6_补1.txt')), 'AI 批注 · 第1-1段 镜头4-6 补1');
  for (const n of ['4-6_出片任务.txt', '4-6_补2.txt', '../4-6_补1.txt']) await assert.rejects(K.批注提示词.prep(job(n)), /没有这份提示词/, n);
});

test('「按批注改」认补片稿的批注：改的是 4-6_补1.txt', async () => {
  const files = new Map([[segPath('4-6_补1.txt'), Buffer.from('【事件脚本】\n镜头1：洪七公出掌。\n')], [segPath('4-6_补1_批注.md'), Buffer.from('## 1\n- 位置：镜头1\n- 批注：再猛一点\n')]]);
  const K = kindsWith(files), j = { 项目: '测试', 批注: '测试/提示词/第1-1段/4-6_补1_批注.md' };
  await K.按批注改提示词.prep(j);
  assert.equal(j.段, '1-1');
  assert.equal(j.名, '4-6_补1.txt');
});
