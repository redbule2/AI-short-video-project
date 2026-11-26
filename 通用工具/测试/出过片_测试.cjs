'use strict';
/* 出过片的提示词不能改，只能另存成新的一版（2026-11-22 他定；.agents/skills/annotate-live/filmed.js）：
   哪一版出过片、下一版叫什么、写给它的批注、另存、存稿拦下（draft-store.js）、按批注改另存成下一版、交给 AI 写完不写（jobs.js、pe-finish.js）；
   照审片批注另存（11-23 他定：「另存成改N」不许原样照抄，交给 AI 照批注改；review-fork.js）；
   写稿页另存（11-23 晚他定：另存不看审片、批注，提示词、素材都没变的不存）：POST /api/filmed 带着改好的字、twin 拦另存出来的一版改回原样。
   读写都在临时文件夹里，不碰真项目。node --test 通用工具/测试/出过片_测试.cjs */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const TOOLS = path.resolve(__dirname, '..');
const SKILL = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const makeFilmed = require(path.join(SKILL, 'filmed.js'));
const makeStore = require(path.join(SKILL, 'draft-store.js'));

const T0 = Date.UTC(2026, 10, 20, 2, 0, 0);   // 稿子的修改时间（另存以后要一样）
const NOTE = '# 批注｜第1段 提示词 11\r\n\r\n文件：试/提示词/第1段/11.txt\r\n\r\n## 1｜分镜\r\n原文：甲走进来。\r\n批注：慢一点\r\n';
async function setup(t, { live = [] } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), '出过片测试-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const P = (...p) => path.join(root, '项目', '试', ...p);
  const put = async (rel, data, mtime) => {
    const p = P(...rel.split('/'));
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, data);
    if (mtime) await fsp.utimes(p, mtime / 1000, mtime / 1000);
    return p;
  };
  const vp = '提示词/第1段/';
  await put(vp + '11.txt', '【事件脚本】\r\n甲走进来。\r\n', T0);
  await put(vp + '11_写稿.json', JSON.stringify({ 写法: '分镜', 挂图: { '@图片1': '资产/人物和道具/甲.png' } }), T0 + 5000);
  await put(vp + '11_AI批注.md', '总评：还行\n');
  await put(vp + '11_批注.md', NOTE);
  await put(vp + '11_批注截图/1.png', 'png');
  await put(vp + '11_出片任务.txt', '任务书');
  await put('成片/第1段/11.mp4', 'x');
  const shot = await put('成片/第1段/11_批注截图/0分01.0秒_第25帧.jpg', 'jpg');
  await put('成片/第1段/11_批注.md', '# 审片批注｜11.mp4\n\n视频：' + P('成片', '第1段', '11.mp4') + '\n\n## 1｜0:01.0\n镜头：01\n截图：' + shot + '\n结束截图：' + P('成片', '第1段', '11_批注截图', '没有这一张.jpg') + '\n批注：甲走得太快\n');   // 审片弹窗写的
  await put(vp + '7.txt', '没出过片');
  for (const n of ['8-9.txt', '8-9_改1.txt', '8-9_改2.txt']) await put(vp + n, n);
  await put('成片/第1段/8-9_改2.mp4', 'x');
  await put('成片/第1段/8-9_改2_后期补.mp4', 'x');   // 后期补的不算谁出的
  await put('历史记录/成片/第1段/8-9.mp4', 'x');
  await put('历史记录/成片/第1段/8-9_改1_2.mp4', 'x');
  await put('历史记录/成片/第1段/8-9_改1_2_批注.md', '# 审片批注｜8-9_改1_2.mp4\n');   // 收进历史记录的样片，批注跟着它
  await put('成片/第1段/8-9_改2_后期补_批注.md', '# 审片批注｜后期补\n');   // 后期补的样片不算谁出的：它的批注也不算
  await put(vp + '5_改1.txt', '老样片名');
  await put('历史记录/成片/第1段/第1段_第3条_5改1_480p.mp4', 'x');   // 11-18 以前的样片名：照记号认
  await put(vp + '9b-9e.txt', '改过名');
  await put('成片/第1段/9b-9d.mp4', 'x');   // 改名以前叫 9b-9d 时出的
  await put(vp + '12.txt', '十二');
  await put('成片/第1段/12.mp4', 'x');
  await put('历史记录/成片/第1段/12_改1.mp4', 'x');   // 以前有过 12_改1（删了），它出的样片还在：下一版让开这个名字
  await put(vp + '13_改1_写稿.json', '{}');   // 13 的下一版名字被留下的写稿资料占着
  await put(vp + '13.txt', '十三');
  await put('成片/第1段/13_2.mp4', 'x');
  await put(vp + '14.txt', '十四');   // 正在出片
  await put('定稿的剧本/流水线.json', JSON.stringify({ 场: [{ 段: '1', 改名: { '9b-9d.txt': '9b-9e.txt' } }] }));
  await put('资产/参考素材映射.json', JSON.stringify({ schema_version: 1, prompts: { '提示词/第1段/11.txt': { prompt_sha256: 'abc', references: [{ ref: '@图片1', name: '甲', path: '资产/人物和道具/甲.png' }], 秒数: { 镜头: [3] } } } }, null, 2) + '\n');
  const F = makeFilmed({ ROOT: root, TOOLS, live: () => live });
  return { root, P, put, F, read: rel => fs.readFileSync(P(...rel.split('/')), 'utf8'), has: rel => fs.existsSync(P(...rel.split('/'))) };
}

test('哪一版出过片：成片、历史记录里有这一版出的样片（老名字、改名以前的也认），后期补、别的版出的不算', async t => {
  const { F } = await setup(t);
  const s = n => F.state('试', '1', n);
  assert.deepEqual(await s('11.txt'), { 名: '11.txt', 出过片: true, 片: ['11.mp4'], 历史: [], 在出: false, 下一版: '11_改1.txt', 最新: '11.txt', 不能另存: '', 批注: ['成片/第1段/11_批注.md', '提示词/第1段/11_批注.md'] });
  assert.deepEqual((await s('8-9_改1.txt')).批注, ['历史记录/成片/第1段/8-9_改1_2_批注.md']);
  assert.deepEqual((await s('8-9_改2.txt')).批注, []);   // 后期补那一条的批注不算
  assert.equal((await s('7.txt')).出过片, false);
  assert.deepEqual((await s('8-9_改2.txt')).片, ['8-9_改2.mp4']);
  assert.deepEqual((await s('8-9_改1.txt')).历史, ['8-9_改1_2.mp4']);
  assert.match((await s('8-9_改1.txt')).不能另存, /更新的「8-9_改2\.txt」/);   // 不是最新那一版：不能另存
  assert.equal((await s('8-9_改1.txt')).最新, '8-9_改2.txt');
  assert.equal((await s('8-9_改2.txt')).下一版, '8-9_改3.txt');
  assert.deepEqual((await s('5_改1.txt')).历史, ['第1段_第3条_5改1_480p.mp4']);
  assert.deepEqual((await s('9b-9e.txt')).片, ['9b-9d.mp4']);
  assert.equal((await s('12.txt')).下一版, '12_改2.txt');
  assert.equal((await s('13.txt')).下一版, '13_改2.txt');
});

test('一段里出过片的几版（GET /api/filmed）：没出过片的不列', async t => {
  const { F } = await setup(t);
  let out = null;
  await F.handle({ method: 'GET' }, null, new URL('http://x/api/filmed?p=' + encodeURIComponent('试') + '&s=1'), { json: (res, o) => { out = o; } });
  assert.deepEqual(Object.keys(out.版).sort(), ['11.txt', '12.txt', '13.txt', '5_改1.txt', '8-9.txt', '8-9_改1.txt', '8-9_改2.txt', '9b-9e.txt'].sort());
  await assert.rejects(F.handle({ method: 'GET' }, null, new URL('http://x/api/filmed?p=a/b&s=1'), { json() {} }), e => e.status === 400);
});

test('新建一条叫什么（GET /api/filmed?new=1）：没用过的照用；改名走的旧名字、还有样片认的、已经有文件的往下排 _改N', async t => {
  const { F } = await setup(t);
  assert.deepEqual(await F.fresh('试', '1', '20.txt'), { 名: '20.txt', 用过: '' });
  const old = await F.fresh('试', '1', '9b-9d.txt');   // 改名成 9b-9e 了，9b-9d.mp4 还认这个名字（11-23 镜头11 就是这样被锁的）
  assert.equal(old.名, '9b-9d_改1.txt'); assert.match(old.用过, /改名成「9b-9e\.txt」/);
  const clip = await F.fresh('试', '1', '12_改1.txt');   // 文件删了，样片还在历史记录里
  assert.equal(clip.名, '12_改2.txt'); assert.match(clip.用过, /12_改1\.mp4/);
  assert.equal((await F.fresh('试', '1', '7.txt')).名, '7_改1.txt');
  let out = null;
  await F.handle({ method: 'GET' }, null, new URL('http://x/api/filmed?p=' + encodeURIComponent('试') + '&s=1&n=' + encodeURIComponent('9b-9d.txt') + '&new=1'), { json: (res, o) => { out = o; } });
  assert.equal(out.名, '9b-9d_改1.txt');
});

test('正在出片的也算出过片：等出完才能另存', async t => {
  const { F } = await setup(t, { live: [{ 事: '出片', 项目: '试', 段: '1', 名: '14_出片任务.txt' }, { 事: '出片任务书', 项目: '试', 段: '1', 名: '7.txt' }] });
  const f = await F.state('试', '1', '14.txt');
  assert.equal(f.出过片, true); assert.equal(f.在出, true); assert.match(f.不能另存, /正在出片/);
  assert.equal((await F.state('试', '1', '7.txt')).在出, true);
  await assert.rejects(F.fork('试', '1', '14.txt', { text: '改了' }), e => e.status === 409 && /正在出片/.test(e.message));
});

const NEW = '【事件脚本】\r\n甲慢慢走进来。\r\n';
test('另存成下一版（AI 照批注改好以后调，只给字）：写新的字，写稿资料照抄，参考素材登记抄过去，AI 批注挪过去，人写的批注留在原稿旁边', async t => {
  const { F, P, read, has } = await setup(t);
  const r = await F.fork('试', '1', '11.txt', { text: NEW });
  assert.deepEqual(r, { 名: '11_改1.txt', 挪了: ['AI 批注'], 没挪: [] });
  assert.equal(read('提示词/第1段/11_改1.txt'), NEW);
  assert.equal(read('提示词/第1段/11.txt'), '【事件脚本】\r\n甲走进来。\r\n');   // 原稿不动
  assert.equal(Math.floor(fs.statSync(P('提示词', '第1段', '11_改1_写稿.json')).mtimeMs), T0 + 5000);
  assert.deepEqual(JSON.parse(read('提示词/第1段/11_改1_写稿.json')).挂图, { '@图片1': '资产/人物和道具/甲.png' });
  const ps = JSON.parse(read('资产/参考素材映射.json')).prompts;
  assert.deepEqual(ps['提示词/第1段/11_改1.txt'], ps['提示词/第1段/11.txt']);
  assert.ok(has('提示词/第1段/11_改1_AI批注.md') && !has('提示词/第1段/11_AI批注.md'));
  assert.ok(has('提示词/第1段/11_批注.md') && !has('提示词/第1段/11_改1_批注.md'));
  assert.ok(has('提示词/第1段/11_出片任务.txt') && !has('提示词/第1段/11_改1_出片任务.txt'));   // 任务书是原稿那一回的
  assert.equal((await F.state('试', '1', '11.txt')).不能另存.includes('11_改1.txt'), true);   // 原稿还是出过片、已经有了更新的一版
  assert.equal((await F.state('试', '1', '11_改1.txt')).出过片, false);
  await assert.rejects(F.fork('试', '1', '11_改1.txt', { text: 'x' }), e => e.status === 409 && /还没出片/.test(e.message));
});

test('另存要带上字；字和素材都和这一版一样的不另存（只差 BOM、换行写法、行尾空格、头尾空行也算一样）', async t => {
  const { F, read, has } = await setup(t);
  await assert.rejects(F.fork('试', '1', '11.txt'), e => e.status === 400);
  for (const text of [read('提示词/第1段/11.txt'), String.fromCharCode(0xFEFF) + '【事件脚本】\n甲走进来。  \n\n'])
    await assert.rejects(F.fork('试', '1', '11.txt', { text }), e => e.status === 422 && /都和出过片的「11\.txt」一样/.test(e.message));
  assert.ok(!has('提示词/第1段/11_改1.txt') && has('提示词/第1段/11_AI批注.md'));
});

/* 写稿页另存（11-23 晚他定：另存不看审片、批注；「另存以后…如果发现提示词、素材都没有变，则不允许保存」） */
async function post(F, n, body) {
  let out = null;
  await F.handle({ method: 'POST' }, null, new URL('http://x/api/filmed?p=' + encodeURIComponent('试') + '&s=1&n=' + encodeURIComponent(n)),
    { json: (res, o) => { out = o; }, readBody: async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)) });
  return out;
}
test('写稿页另存（POST /api/filmed）：提示词、素材都没变回 422，什么都不建；没写批注也能另存', async t => {
  const { F, put, read, has } = await setup(t);
  await put('提示词/第1段/8-9_改2_写稿.json', JSON.stringify({ 写法: '分镜' }));
  assert.deepEqual((await F.state('试', '1', '8-9_改2.txt')).批注, []);   // 一份批注都没有
  const text = read('提示词/第1段/8-9_改2.txt');
  await assert.rejects(post(F, '8-9_改2.txt', { text, side: { 写法: '分镜', 分镜稿: text } }), e => e.status === 422);
  await assert.rejects(post(F, '8-9_改2.txt', { text: text + '\r\n', side: { 写法: '自由', 镜头信息: [] } }), e => e.status === 422);   // 只换了页面上的写法、多个空行：不算改
  assert.ok(!has('提示词/第1段/8-9_改3.txt') && !has('提示词/第1段/8-9_改3_写稿.json'));
  const r = await post(F, '8-9_改2.txt', { text: text + '多一句', side: { 写法: '分镜', 分镜稿: text + '多一句' } });
  assert.equal(r.名, '8-9_改3.txt');
  assert.equal(read('提示词/第1段/8-9_改3.txt'), text + '多一句');
  assert.equal(read('提示词/第1段/8-9_改2.txt'), text);
});
test('写稿页另存：素材换了也算改（挂上一张新的）；登记过的号照登记认，和写稿页一样', async t => {
  const { F, P, read, has } = await setup(t);
  const text = read('提示词/第1段/11.txt'), 挂图 = { '@图片1': '资产/人物和道具/甲.png' };
  await assert.rejects(post(F, '11.txt', { text, side: { 挂图: { '@图片1': '资产\\人物和道具\\乙.png' } } }), e => e.status === 422);   // @图片1 登记的是甲：写稿页也照登记显示
  const r = await post(F, '11.txt', { text, side: { 写法: '分镜', 挂图: { ...挂图, '@图片2': '资产/场景/街.png' } } });
  assert.equal(r.名, '11_改1.txt');
  assert.equal(read('提示词/第1段/11_改1.txt'), text);   // 字没改，素材多了一张
  const side = JSON.parse(read('提示词/第1段/11_改1_写稿.json'));
  assert.deepEqual(side, { 写法: '分镜', 挂图: { ...挂图, '@图片2': '资产/场景/街.png' } });
  assert.deepEqual(r.side, side);   // 写稿页照它接着存
  assert.equal(r.mtime, Math.floor(fs.statSync(P('提示词', '第1段', '11_改1.txt')).mtimeMs));
  assert.equal(r.sideMtime, Math.floor(fs.statSync(P('提示词', '第1段', '11_改1_写稿.json')).mtimeMs));
  assert.deepEqual(r.挪了, ['AI 批注']);
  assert.ok(has('提示词/第1段/11_批注.md'));   // 人写的批注留在原稿旁边
  const ps = JSON.parse(read('资产/参考素材映射.json')).prompts;
  assert.deepEqual(ps['提示词/第1段/11_改1.txt'], ps['提示词/第1段/11.txt']);
});
test('写稿页另存：请求不对的不收（不是 JSON、缺字或写稿资料、写稿资料里有页面不能改的、没写哪一版）', async t => {
  const { F, read, has } = await setup(t);
  const text = read('提示词/第1段/11.txt') + '改';
  await assert.rejects(post(F, '11.txt', '{坏的'), e => e.status === 400);
  await assert.rejects(post(F, '11.txt', { text }), e => e.status === 400);
  await assert.rejects(post(F, '11.txt', { side: {} }), e => e.status === 400);
  await assert.rejects(post(F, '11.txt', { text, side: { AI建议: [] } }), e => e.status === 400);
  await assert.rejects(post(F, '11.txt', { text, side: { 写法: '乱写' } }), e => e.status === 400);
  await assert.rejects(F.handle({ method: 'POST' }, null, new URL('http://x/api/filmed?p=' + encodeURIComponent('试') + '&s=1'), { json() {}, readBody: async () => Buffer.from('{}') }), e => e.status === 405);
  await assert.rejects(post(F, '7.txt', { text, side: {} }), e => e.status === 409 && /还没出片/.test(e.message));
  assert.ok(!has('提示词/第1段/11_改1.txt'));
});

test('另存不了的：没出片、不是最新一版、名字不对', async t => {
  const { F } = await setup(t);
  await assert.rejects(F.fork('试', '1', '7.txt', { text: 'x' }), e => e.status === 409);
  await assert.rejects(F.fork('试', '1', '8-9_改1.txt', { text: 'x' }), e => e.status === 409 && /8-9_改2/.test(e.message));
  await assert.rejects(F.fork('试', '1', '../x.txt', { text: 'x' }), e => e.status === 400);
  await assert.rejects(F.fork('试', '1', '11_写稿.json', { text: 'x' }), e => e.status === 400);
});

test('另存出来的一版接着存（twin）：字和素材又改回和出过片的上一版一样，给拦下的话；改得不一样、原稿、上一版没出片的给空', async t => {
  const { F, P, read } = await setup(t);
  const orig = read('提示词/第1段/11.txt');
  await F.fork('试', '1', '11.txt', { text: NEW });
  const at = P('提示词', '第1段', '11_改1.txt');
  assert.match(await F.twin(at, orig), /都和出过片的「11\.txt」一样/);
  assert.match(await F.twin(at, orig.replace(/\r\n/g, '\n') + '\n\n'), /一样/);
  assert.equal(await F.twin(at, NEW), '');
  assert.equal(await F.twin(at, orig, { 挂图: { '@图片1': '资产/人物和道具/甲.png', '@图片2': '资产/场景/街.png' } }), '');   // 素材多了一张
  assert.equal(await F.twin(P('提示词', '第1段', '11.txt'), orig), '');   // 原稿：没有上一版
  assert.match(await F.twin(P('提示词', '第1段', '8-9_改2.txt'), read('提示词/第1段/8-9_改1.txt')), /出过片的「8-9_改1.txt」/);   // 上一版 8-9_改1 出过片：改回它那样也拦
  assert.equal(await F.twin(P('提示词', '第1段', '8-9_改2.txt'), '8-9_改2 又改了'), '');
  assert.equal(await F.twin(P('提示词', '第1段', '7.txt'), '没出过片'), '');
});
test('另存出来的一版存稿（draft-store）：改回和出过片的上一版一样回 422、文件不动；改得不一样照存', async t => {
  const { F, P, read } = await setup(t);
  const orig = read('提示词/第1段/11.txt');
  await F.fork('试', '1', '11.txt', { text: NEW });
  const store = makeStore({ ROOT: path.dirname(path.dirname(P())), frozen: abs => F.frozen(abs), twin: (abs, text, side) => F.twin(abs, text, side) });
  const side = JSON.parse(read('提示词/第1段/11_改1_写稿.json')), base = { 写法: side.写法, 挂图: side.挂图 };
  const save = text => store.save(P('提示词', '第1段', '11_改1.txt'), { text, baseText: read('提示词/第1段/11_改1.txt'), sidePatch: { ...base }, baseEditor: { ...base } });
  await assert.rejects(save(orig), e => e.status === 422 && /都和出过片的「11\.txt」一样/.test(e.message));
  assert.equal(read('提示词/第1段/11_改1.txt'), NEW);
  await save(NEW + '又改了');
  assert.equal(read('提示词/第1段/11_改1.txt'), NEW + '又改了');
});

test('存稿前问一声（frozen）：出过片的视频提示词给拦下的话，别的给空', async t => {
  const { F, P } = await setup(t);
  assert.match(await F.frozen(P('提示词', '第1段', '11.txt')), /出过片（11\.mp4）.*另存成「11_改1\.txt」/);
  assert.match(await F.frozen(P('提示词', '第1段', '8-9_改1.txt')), /历史记录里/);
  assert.equal(await F.frozen(P('提示词', '第1段', '7.txt')), '');
  assert.equal(await F.frozen(P('提示词', '第1段', '11_写稿.json')), '');   // 不是视频提示词
  assert.equal(await F.frozen(P('提示词', '第1段', '20.txt')), '');   // 还没有这个文件：新建不拦
});

test('写稿页、提示词页存稿（draft-store）：出过片的正文、挂图改了回 423，别的照存；没出片的照旧', async t => {
  const { F, P, read } = await setup(t);
  const store = makeStore({ ROOT: path.dirname(path.dirname(P())), frozen: abs => F.frozen(abs) });
  const side = JSON.parse(read('提示词/第1段/11_写稿.json')), base = { 写法: side.写法, 挂图: side.挂图 }, text = read('提示词/第1段/11.txt');
  const save = (n, over) => store.save(P('提示词', '第1段', n), { text, baseText: text, sidePatch: { ...base }, baseEditor: { ...base }, ...over });
  await assert.rejects(save('11.txt', { text: text + '多一句' }), e => e.status === 423 && /另存成「11_改1\.txt」/.test(e.message));
  await assert.rejects(save('11.txt', { sidePatch: { ...base, 挂图: { '@图片1': '资产/人物和道具/乙.png' } } }), e => e.status === 423);
  assert.equal(read('提示词/第1段/11.txt'), text);
  const r = await save('11.txt', { sidePatch: { ...base, 镜头写法: '分区' } });   // 只换了页面上的写法：照存
  assert.equal(r.side.镜头写法, '分区');
  const t7 = read('提示词/第1段/7.txt');
  await store.save(P('提示词', '第1段', '7.txt'), { text: t7 + '改了', baseText: t7, sidePatch: {}, baseEditor: {} });
  assert.equal(read('提示词/第1段/7.txt'), t7 + '改了');
});

/* jobs.js 照真的文件夹跑（vm 载入，挡掉开服务时接着等回复的那个定时器） */
function jobsOf(root, F) {
  const file = path.join(SKILL, 'jobs.js');
  const box = { module: { exports: {} }, __dirname: SKILL, Buffer, process, console, clearTimeout, setTimeout: (fn, ms, ...a) => ms === 300 ? 0 : setTimeout(fn, ms, ...a),
    require: n => require(n.startsWith('.') ? path.resolve(SKILL, n) : n) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), box, { filename: file });
  return box.module.exports({ ROOT: root, TOOLS, log() {}, filmed: F }).KINDS;
}
test('按批注改提示词：出过片的照改，改好另存成下一版，原稿一字不动；批注照旧收进历史记录', async t => {
  const { root, F, read, has } = await setup(t);
  const K = jobsOf(root, F), orig = read('提示词/第1段/11.txt');
  const j = { 项目: '试', 批注: '项目/试/提示词/第1段/11_批注.md' };
  await K.按批注改提示词.prep(j);
  const r = await K.按批注改提示词.apply(j, JSON.stringify([{ 原文: '甲走进来。', 第几处: 1, 改成: '甲慢慢走进来。' }]));
  assert.equal(read('提示词/第1段/11.txt'), orig);
  assert.equal(read('提示词/第1段/11_改1.txt'), '【事件脚本】\r\n甲慢慢走进来。\r\n');
  assert.equal(j.名, '11_改1.txt');
  assert.deepEqual([...r.产出], ['提示词/第1段/11_改1.txt']);   // vm 里建的数组：先摊开再比
  assert.match(r.结果, /「11\.txt」出过片，原稿没动；改好的另存成「11_改1\.txt」，改了 1 处/);
  assert.ok(!has('提示词/第1段/11_批注.md'));   // 批注照旧收走
  const ps = JSON.parse(read('资产/参考素材映射.json')).prompts;
  assert.equal(ps['提示词/第1段/11.txt'].prompt_sha256, 'abc');   // 原稿的登记不动
  assert.notEqual(ps['提示词/第1段/11_改1.txt'].prompt_sha256, 'abc');   // 新的一版照改好的字重算
  assert.deepEqual(ps['提示词/第1段/11_改1.txt'].references, ps['提示词/第1段/11.txt'].references);
});
test('按批注改提示词：出过片又另存不了的（不是最新一版、正在出片），点的时候就说', async t => {
  const { root, F, put } = await setup(t);
  await put('提示词/第1段/8-9_改1_批注.md', '# 批注\n');
  const K = jobsOf(root, F);
  await assert.rejects(K.按批注改提示词.prep({ 项目: '试', 批注: '项目/试/提示词/第1段/8-9_改1_批注.md' }), /原稿不能改，也另存不了：这一条已经有更新的/);
  const live = [{ 事: '出片', 项目: '试', 段: '1', 名: '7_出片任务.txt' }];
  const G = makeFilmed({ ROOT: root, TOOLS, live: () => live });
  await put('提示词/第1段/7_批注.md', '# 批注\n');
  await assert.rejects(jobsOf(root, G).按批注改提示词.prep({ 项目: '试', 批注: '项目/试/提示词/第1段/7_批注.md' }), /正在出片/);
});
test('交给 AI 写完：出过片的不写（点的时候就说要另存）', async t => {
  const { root, F } = await setup(t);
  const K = jobsOf(root, F);
  await assert.rejects(K.写完提示词.prep({ 项目: '试', 段: '1', 名: '11.txt' }), /出过片（11\.mp4）.*另存成「11_改1\.txt」/);
});
test('按批注改提示词：出过片的，AI 改完和原稿一字不差（只多了行尾空格）就不另存', async t => {
  const { root, F, has } = await setup(t);
  const K = jobsOf(root, F), j = { 项目: '试', 批注: '项目/试/提示词/第1段/11_批注.md' };
  await K.按批注改提示词.prep(j);
  await assert.rejects(K.按批注改提示词.apply(j, JSON.stringify([{ 原文: '甲走进来。', 第几处: 1, 改成: '甲走进来。  ' }])), /一字不差.*没另存/);
  assert.ok(!has('提示词/第1段/11_改1.txt') && has('提示词/第1段/11_批注.md'));
});

/* ---------- 照审片批注另存（11-23 他定：「另存成改N」不许原样照抄，交给 AI 照这一版的批注改；review-fork.js） ---------- */
test('照审片批注另存：开的时候认这一版的批注（样片旁边的审片批注、提示词上写的）；没出片、不是最新一版、一份批注都没有的不开', async t => {
  const { root, F, put } = await setup(t);
  const K = jobsOf(root, F), J = n => ({ 项目: '试', 段: '1', 名: n });
  const j = J('11.txt');
  await K.照审片批注另存.prep(j);
  assert.deepEqual([...j.审片], ['成片/第1段/11_批注.md']);
  assert.deepEqual([...j.rel], ['提示词', '第1段', '11_批注.md']);
  assert.equal(j.下一版, '11_改1.txt');
  assert.match(K.照审片批注另存.title(j), /照审片批注改 · 11$/);
  await assert.rejects(K.照审片批注另存.prep(J('7.txt')), /还没出片/);
  await assert.rejects(K.照审片批注另存.prep(J('8-9_改1.txt')), /更新的「8-9_改2\.txt」/);
  await assert.rejects(K.照审片批注另存.prep(J('8-9_改2.txt')), /还没写批注：先点「审片」/);   // 出过片、是最新一版，可是没写批注
  const k = J('8-9_改2.txt');
  await put('成片/第1段/8-9_改2_批注.md', '# 审片批注｜8-9_改2.mp4\n## 1｜0:00.0\n批注：太暗\n');
  await K.照审片批注另存.prep(k);   // 写了就能开：只有审片批注，没有提示词批注
  assert.deepEqual([...k.审片], ['成片/第1段/8-9_改2_批注.md']);
  assert.equal(k.rel, null);
});
test('照审片批注另存：任务书说清出过片、要另存成哪一版、不许照抄；审片批注、提示词批注都在里面（标题降了级），截图叫 AI 先看', async t => {
  const { root, F, P } = await setup(t);
  const K = jobsOf(root, F), j = { 项目: '试', 段: '1', 名: '11.txt' };
  await K.照审片批注另存.prep(j);
  const book = await K.照审片批注另存.book(j);
  assert.match(book, /^# 任务：照审片批注改视频提示词，改好另存成新的一版/);
  assert.match(book, /「11\.txt」已经出过片.*另存成「11_改1\.txt」/);
  assert.match(book, /不许原样照抄/);
  assert.match(book, /## 要求\n1\. 只改批注说到的地方/);   // 后面照「按批注改提示词」那一套
  assert.match(book, /### 审片批注：样片「11」/);
  assert.match(book, /^#### 审片批注｜11\.mp4$/m);
  assert.match(book, /^##### 1｜0:01\.0$/m);
  assert.match(book, /批注：甲走得太快/);
  assert.match(book, /### 提示词批注（在这一版提示词上写的）[\s\S]*原文：甲走进来。/);
  assert.match(book, /## 原文（文件：11\.txt）\n【事件脚本】/);
  assert.deepEqual([...j.images], [P('成片', '第1段', '11_批注截图', '0分01.0秒_第25帧.jpg')]);   // 不在的那一张不叫它看
});
test('照审片批注另存：写初步剧本的段（老段的 自由稿.txt），任务书开头「剧本指初步剧本」那一句只说一回（借来的那一套没被包两层）', async t => {
  const { root, F, put } = await setup(t);
  await put('定稿的剧本/流水线.json', JSON.stringify({ 场: [{ 段: '1', 先写提示词: true }] }));
  await put('提示词/第1段/自由稿.txt', '甲走进来。');
  const K = jobsOf(root, F), j = { 项目: '试', 段: '1', 名: '11.txt' };
  await K.照审片批注另存.prep(j);
  const book = await K.照审片批注另存.book(j);
  assert.equal(book.split('这一段的剧本是人自己写的初步剧本').length, 2);
  assert.match(book, /^# 任务：照审片批注改视频提示词/);
});
test('照审片批注另存：AI 回空列表、改完一字不差，都不另存；原稿、批注照旧', async t => {
  const { root, F, has, read } = await setup(t);
  const K = jobsOf(root, F), j = { 项目: '试', 段: '1', 名: '11.txt' }, orig = read('提示词/第1段/11.txt');
  await K.照审片批注另存.prep(j);
  await assert.rejects(K.照审片批注另存.apply(j, '[]'), /原样照抄不算新的一版，这回没另存/);
  await assert.rejects(K.照审片批注另存.apply(j, JSON.stringify([{ 原文: '甲走进来。', 第几处: 1, 改成: '甲走进来。' }])), /原样照抄不算新的一版/);
  assert.ok(!has('提示词/第1段/11_改1.txt') && !has('提示词/第1段/11_改1_写稿.json'));
  assert.equal(read('提示词/第1段/11.txt'), orig);
  assert.ok(has('提示词/第1段/11_批注.md') && has('成片/第1段/11_批注.md'));
  assert.equal(JSON.parse(read('资产/参考素材映射.json')).prompts['提示词/第1段/11_改1.txt'], undefined);
});
test('照审片批注另存：改了的另存成下一版，原稿、样片、审片批注不动，提示词批注收进历史记录，登记照新字重算', async t => {
  const { root, F, has, read } = await setup(t);
  const K = jobsOf(root, F), j = { 项目: '试', 段: '1', 名: '11.txt' }, orig = read('提示词/第1段/11.txt'), review = read('成片/第1段/11_批注.md');
  await K.照审片批注另存.prep(j);
  const r = await K.照审片批注另存.apply(j, JSON.stringify([{ 原文: '甲走进来。', 第几处: 1, 改成: '甲慢慢走进来，停在门口。' }]));
  assert.equal(read('提示词/第1段/11.txt'), orig);
  assert.equal(read('提示词/第1段/11_改1.txt'), '【事件脚本】\r\n甲慢慢走进来，停在门口。\r\n');
  assert.equal(j.名, '11_改1.txt');
  assert.match(r.结果, /「11\.txt」出过片，原稿没动；改好的另存成「11_改1\.txt」，改了 1 处/);
  assert.equal(read('成片/第1段/11_批注.md'), review);   // 审片批注跟着样片，不动
  assert.ok(has('成片/第1段/11.mp4') && !has('提示词/第1段/11_批注.md') && has('提示词/第1段/11_改1_AI批注.md'));
  assert.ok(fs.readdirSync(path.join(root, '项目', '试', '历史记录', '提示词', '第1段')).some(n => /^11_批注__\d{8}-\d{6}\.md$/.test(n)));
  const ps = JSON.parse(read('资产/参考素材映射.json')).prompts;
  assert.equal(ps['提示词/第1段/11.txt'].prompt_sha256, 'abc');
  assert.notEqual(ps['提示词/第1段/11_改1.txt'].prompt_sha256, 'abc');
  assert.equal((await F.state('试', '1', '11_改1.txt')).出过片, false);   // 新的一版没出过片：能改、能批准出片
});
