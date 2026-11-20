'use strict';
/* .agents/skills/annotate-live/prompt-lib.js：写稿页「参考」列各项目现在的、历史记录里的视频提示词（2026-11-19）。
   跑：node --test 通用工具/测试/提示词库_测试.cjs */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const TOOLS = path.join(__dirname, '..');
const make = require('../../.agents/skills/annotate-live/prompt-lib.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '提示词库-'));
  const put = (rel, text) => { const f = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put('项目/甲/提示词/第1-1段/1-5.txt', '﻿【生成目标】\r\n炮阵同一瞬间齐射。\r\n');
  put('项目/甲/提示词/第1-1段/1-5_批注.md', '不是提示词');
  put('项目/甲/提示词/第1-1段/说明.txt', '不是提示词');
  put('项目/甲/历史记录/提示词/第1-1段/1-5__20261118-093000.txt', '【生成目标】\n老版本：逐排开火。\n');
  put('项目/甲/历史记录/提示词/第1-1段/1-5_改1__20261119-101500-ab12.txt', '【生成目标】\n改一：同一瞬间。\n');
  put('项目/甲/成片/第1-1段/1-5.mp4', 'x');
  put('项目/甲/历史记录/成片/第1-1段/1-5_2.mp4', 'x');
  put('项目/甲/历史记录/成片/第1-1段/1-5_改1.mp4', 'x');
  put('项目/甲/历史记录/成片/第1-1段/1-5_3.mp4', 'x');   // 11-18 早上出的：那时候用的还是 09:30 收进去的那一版
  const early = new Date(2026, 10, 18, 8, 0, 0);
  fs.utimesSync(path.join(root, '项目/甲/历史记录/成片/第1-1段/1-5_3.mp4'), early, early);
  put('项目/乙/提示词/第2段/视频提示词.txt', '雪地里站着一个人。');
  put('项目/乙/提示词/不是段/视频提示词.txt', '不在段落文件夹里');
  return root;
}
const lib = root => make({ ROOT: root, TOOLS });

test('列出各项目现在的和历史记录里的视频提示词，新的在前', async () => {
  const root = fixture();
  try {
    const all = await lib(root).search('');
    assert.deepEqual(all.map(x => x.p + '/' + x.file).sort(), [
      '乙/提示词/第2段/视频提示词.txt',
      '甲/历史记录/提示词/第1-1段/1-5_改1__20261119-101500-ab12.txt',
      '甲/历史记录/提示词/第1-1段/1-5__20261118-093000.txt',
      '甲/提示词/第1-1段/1-5.txt',
    ].sort());
    const old = all.find(x => x.name === '1-5_改1__20261119-101500-ab12.txt');
    assert.equal(old.old, true);
    assert.equal(old.orig, '1-5_改1.txt');
    assert.equal(old.when, '11-19 10:15');
    assert.equal(old.label, '镜头1-5 改1');
    assert.equal(old.seg, '1-1');
    assert.ok(all.indexOf(old) < all.findIndex(x => x.name === '1-5__20261118-093000.txt'), '老版本照收进去的时间排');
    assert.ok(!('abs' in old) && !('mtime' in old), '不把电脑上的完整路径给网页');
    assert.equal(all.find(x => x.file === '提示词/第1-1段/1-5.txt').lead, '炮阵同一瞬间齐射。', '一句话说它拍什么：生成目标那一句');
    assert.equal(all.find(x => x.p === '乙').lead, '雪地里站着一个人。', '没分区的：头一句');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('样片照名字认是哪一条，照时间认是哪一版出的', async () => {
  const root = fixture();
  try {
    const all = await lib(root).search('');
    const now = all.find(x => x.file === '提示词/第1-1段/1-5.txt'), was = all.find(x => x.name === '1-5__20261118-093000.txt'), v1 = all.find(x => x.orig === '1-5_改1.txt');
    assert.deepEqual(now.clips.map(c => c.file).sort(), ['历史记录/成片/第1-1段/1-5_2.mp4', '成片/第1-1段/1-5.mp4'], '收进去以后出的归现在这一版');
    assert.deepEqual(was.clips, [{ file: '历史记录/成片/第1-1段/1-5_3.mp4', old: true }], '收进去以前出的归那一版');
    assert.deepEqual(v1.clips, [{ file: '历史记录/成片/第1-1段/1-5_改1.mp4', old: true }], '现在没有这一条了：归最后收进去的那一版');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('按字找：几个词都要有，项目名、名字、正文都算，带一句「在哪」', async () => {
  const root = fixture();
  try {
    const L = lib(root);
    const hit = await L.search('同一瞬间');
    assert.deepEqual(hit.map(x => x.orig).sort(), ['1-5.txt', '1-5_改1.txt']);
    assert.ok(hit.every(x => x.hit.includes('同一瞬间')));
    assert.deepEqual((await L.search('乙 雪地')).map(x => x.p), ['乙']);
    assert.deepEqual((await L.search('甲 雪地')), []);
    assert.equal((await L.search('镜头1-5 改1')).length, 1, '照标签找');
    assert.ok(!(await L.search('同一瞬间'))[0].hit.startsWith('﻿'), '去掉开头的 BOM');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('接口只能读', async () => {
  const root = fixture();
  try {
    const L = lib(root);
    let got = null;
    const json = (res, v) => { got = v; };
    await L.handle({ method: 'GET' }, {}, new URL('http://x/api/prompts?q=' + encodeURIComponent('雪地')), { json });
    assert.equal(got.q, '雪地');
    assert.equal(got.n, 1);
    await assert.rejects(L.handle({ method: 'POST' }, {}, new URL('http://x/api/prompts'), { json }), e => e.status === 405);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
