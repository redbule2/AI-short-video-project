'use strict';
/* 公用/历史记录.js：历史记录里的名字怎么认、先后怎么排、老版本的字配哪一份登记（11-19 三页加「历史记录」筛选） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const H = require('../公用/历史记录.js');

test('原名__时间.后缀：认出原名和时间', () => {
  assert.deepEqual(H.parse('1_改3__20261117-201249.txt'), { name: '1_改3__20261117-201249.txt', orig: '1_改3.txt', stamp: '20261117-201249', when: '11-17 20:12' });
  assert.equal(H.parse('1_改3_写稿__20261117-201249.json').orig, '1_改3_写稿.json');
  assert.equal(H.parse('参考素材映射__20261111-075528-9139db.json').orig, '参考素材映射.json');   // 时间后面带随机字
  assert.equal(H.parse('镜头1-5_白模__20261114-020123.mp4').orig, '镜头1-5_白模.mp4');
  assert.equal(H.parse('镜头2_首帧_批注截图__20261119-165053').orig, '镜头2_首帧_批注截图');   // 收进去的文件夹没有后缀
});

test('名字里没带时间（审完收进去的样片）：原名就是它', () => {
  assert.deepEqual(H.parse('李云龙大战奥特曼_第3-1段镜1补拍_第3条_样片480p.mp4'), { name: '李云龙大战奥特曼_第3-1段镜1补拍_第3条_样片480p.mp4', orig: '李云龙大战奥特曼_第3-1段镜1补拍_第3条_样片480p.mp4', stamp: '', when: '' });
  assert.equal(H.parse('a__b.txt').stamp, '');
});

test('新的在前：带时间照时间，没带的照修改时间', () => {
  const a = { ...H.parse('1__20261116-195607.txt'), mtime: 9 }, b = { ...H.parse('1__20261116-204841.txt'), mtime: 1 }, c = { ...H.parse('x.mp4'), mtime: 5 }, d = { ...H.parse('y.mp4'), mtime: 7 };
  assert.deepEqual([a, b].sort(H.newer).map(x => x.name), [b.name, a.name]);
  assert.deepEqual([c, d].sort(H.newer).map(x => x.name), ['y.mp4', 'x.mp4']);
});

test('老版本的字配哪一份登记：照 prompt_sha256 认，和 核对参考素材.py 算法一样', async () => {
  const text = String.fromCharCode(0xfeff) + '第一行\r\n第二行\r\n', want = crypto.createHash('sha256').update('第一行\n第二行\n').digest('hex');
  const sha = await H.promptSha(text);
  assert.equal(sha, want);
  const key = '提示词/第3-1段/1.txt', refs = [{ ref: '@图片1', path: '资产/x.png' }];
  const maps = [{ from: '现在', prompts: { [key]: { prompt_sha256: 'f'.repeat(64), references: [] } } }, { from: '留底', prompts: { [key]: { prompt_sha256: want, references: refs } } }];
  assert.deepEqual(H.refsBySha(maps, key, sha), { refs, from: '留底' });
  assert.equal(H.refsBySha(maps, '提示词/第3-1段/2.txt', sha), null);
  assert.equal(H.refsBySha(maps, key, ''), null);
});

/* 假的项目：files 是 { 项目里的路径: 对象 }（读成 JSON） */
const fakeIo = files => ({
  readJson: async rel => { if (!(rel in files)) throw new Error('没有'); return files[rel]; },
  list: async dir => Object.keys(files).filter(k => k.startsWith(dir + '/') && !k.slice(dir.length + 1).includes('/')).map(k => ({ name: k.slice(dir.length + 1), kind: 'file', mtime: 0 })),
});

test('几份映射：现在的在前，留的底从新到旧', async () => {
  const io = fakeIo({ '资产/参考素材映射.json': { prompts: { a: 1 } }, '历史记录/资产/参考素材映射__20261110-234824.json': { prompts: { b: 1 } }, '历史记录/资产/参考素材映射__20261115-023358.json': { prompts: { c: 1 } }, '历史记录/资产/出片设置__20261114-005906.json': {} });
  assert.deepEqual((await H.mapsOf(io)).map(m => m.from), ['资产/参考素材映射.json', '历史记录/资产/参考素材映射__20261115-023358.json', '历史记录/资产/参考素材映射__20261110-234824.json']);
});

test('老版本挂的图：字对得上的那一份登记；同一时间收进去的写稿资料里的挂图为准；都没有照现在的登记并标出来', async () => {
  const text = '老的字', sha = crypto.createHash('sha256').update(text).digest('hex'), key = '提示词/第3-4段/1_改3.txt';
  const it = { seg: '3-4', orig: '1_改3.txt', file: '历史记录/提示词/第3-4段/1_改3__20261117-201249.txt', old: true, stamp: '20261117-201249' };
  const maps = [{ from: '现在', prompts: { [key]: { prompt_sha256: 'f'.repeat(64), references: [{ ref: '@图片1', path: '资产/新.png', sha256: 'n' }] } } },
    { from: '留底', prompts: { [key]: { prompt_sha256: sha, references: [{ ref: '@图片1', path: '资产/旧.png', sha256: 'o' }, { ref: '@图片2', path: '资产/兵.png', sha256: 'b' }] } } }];
  let r = await H.refsFor(fakeIo({}), maps, it, text);
  assert.deepEqual(r.refs, [{ ref: '@图片1', path: '资产/旧.png', sha: 'o' }, { ref: '@图片2', path: '资产/兵.png', sha: 'b' }]);
  assert.equal(r.note, '');
  r = await H.refsFor(fakeIo({ '历史记录/提示词/第3-4段/1_改3_写稿__20261117-201249.json': { 挂图: { '@图片2': '资产/第3-4段/首帧.png' } } }), maps, it, text);
  assert.deepEqual(r.refs[1], { ref: '@图片2', path: '资产/第3-4段/首帧.png', sha: '' });
  r = await H.refsFor(fakeIo({}), maps.slice(0, 1), it, text);
  assert.equal(r.refs[0].path, '资产/新.png');
  assert.match(r.note, /可能不是那时候挂的/);
  r = await H.refsFor(fakeIo({}), maps.slice(0, 1), { ...it, old: false, file: '提示词/第3-4段/1_改3.txt', stamp: '' }, text);   // 现在用的：照现在的登记，不标
  assert.equal(r.note, '');
});
