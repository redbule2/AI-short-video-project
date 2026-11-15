'use strict';
// 只使用内存文件系统，不读写任何项目正文。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { Readable } = require('node:stream');
const makeStore = require('../.agents/skills/annotate-live/draft-store.js');
const { pickEditor } = makeStore;
const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, '项目', '测试', '提示词', '第1段', '视频提示词.txt');
const SIDE = TARGET.replace(/\.txt$/, '_写稿.json');
const base = { 写法: '分镜', 分镜稿: '原文', 自由稿: '', 镜头信息: [{ id: 's1', no: '01', 作用: '原作用' }], 挂图: {} };
const body = (over = {}) => ({ text: '新文', baseText: '原文', sidePatch: { ...base, 分镜稿: '新文' }, baseEditor: structuredClone(base), ...over });

class MemoryFS {
  constructor(text = '原文', side = { ...base, 关键词: { 1: ['旧建议'] }, 分镜建议: [] }) {
    this.files = new Map(); this.clock = 1; this.hook = null;
    this.put(TARGET, text); if (side !== null) this.put(SIDE, JSON.stringify(side, null, 2) + '\n');
  }
  put(p, content) { this.files.set(p, { buf: Buffer.from(content), mtimeMs: ++this.clock }); }
  fail(code, message = code) { return Object.assign(new Error(message), { code }); }
  async readFile(p) { if (!this.files.has(p)) throw this.fail('ENOENT'); return Buffer.from(this.files.get(p).buf); }
  async writeFile(p, b, opts) { if (this.hook) await this.hook('write', p, b); if (opts?.flag === 'wx' && this.files.has(p)) throw this.fail('EEXIST'); this.put(p, b); }
  async rename(from, to) { if (this.hook) await this.hook('rename', from, to); const b = await this.readFile(from); this.put(to, b); this.files.delete(from); }
  async link(from, to) { if (this.files.has(to)) throw this.fail('EEXIST'); this.put(to, await this.readFile(from)); }
  async unlink(p) { if (!this.files.delete(p)) throw this.fail('ENOENT'); }
  async stat(p) { if (!this.files.has(p)) throw this.fail('ENOENT'); return { mtimeMs: this.files.get(p).mtimeMs }; }
  async mkdir() {}
  text(p) { return this.files.get(p)?.buf.toString('utf8'); }
  side() { return JSON.parse(this.text(SIDE)); }
  unchanged(before) { assert.deepEqual([...this.files].map(([p, v]) => [p, v.buf.toString()]), before); }
  snapshot() { return [...this.files].map(([p, v]) => [p, v.buf.toString()]); }
  noTemps() { assert.equal([...this.files.keys()].some(p => p.endsWith('.tmp')), false); }
}
const store = io => makeStore({ ROOT, io, now: () => new Date(2026, 10, 13, 8, 30, 0) });

test('原样保存 BOM、CRLF、空行与末尾空格，保留 AI 字段', async () => {
  const source = '\uFEFF原文\r\n\r\n  ', target = '\uFEFF自由写\r\n\r\n末尾  ';
  const io = new MemoryFS(source), s = store(io);
  const result = await s.save(TARGET, body({ baseText: source, text: target, sidePatch: { ...base, 写法: '自由', 自由稿: target } }));
  assert.equal(io.text(TARGET), target); assert.deepEqual(result.side.关键词, { 1: ['旧建议'] });
  assert.equal(result.side.自由稿, target); assert.ok(result.mtime > 0 && result.sideMtime > 0); io.noTemps();
});

test('分镜范围标记可随旧稿首次保存加入，公共区与 AI 字段保留', async () => {
  const publicHead = '\uFEFF本段事件：原事件\r\n素材\r\n@图片1 原图\r\n基础设定\r\n原风格\r\n本段\r\n原场景\r\n分镜\r\n';
  const publicTail = '\r\n保持一致：原约束\r\n';
  const original = publicHead + '镜头 01｜原镜头\r\n原动作' + publicTail;
  const freeShots = '自由分镜\r\n\r\n  原样缩进';
  const changed = publicHead + freeShots + publicTail;
  const io = new MemoryFS(original), s = store(io);
  const result = await s.save(TARGET, body({ baseText: original, text: changed,
    sidePatch: { ...base, 写法: '自由', 写法范围: '分镜', 分镜稿: original, 自由稿: freeShots } }));
  assert.equal(io.text(TARGET), changed); assert.equal(result.side.自由稿, freeShots);
  assert.equal(result.side.分镜稿, original); assert.equal(result.side.写法范围, '分镜');
  assert.deepEqual(result.side.关键词, { 1: ['旧建议'] });
  assert.equal(pickEditor(result.side).写法范围, '分镜'); io.noTemps();
});

test('无写法范围的旧保存请求继续兼容，非法范围拒绝且不改文件', async () => {
  const legacy = new MemoryFS(); await store(legacy).save(TARGET, body());
  assert.equal(Object.hasOwn(legacy.side(), '写法范围'), false);
  for (const invalid of ['整份', '', null, 1]) {
    const io = new MemoryFS(), before = io.snapshot();
    await assert.rejects(store(io).save(TARGET, body({ sidePatch: { ...base, 写法范围: invalid } })), { status: 400 });
    io.unchanged(before);
  }
});

test('范围标记受乐观锁保护，旧页面不能覆盖已迁移的新稿', async () => {
  const io = new MemoryFS('原文', { ...base, 写法范围: '分镜' }), before = io.snapshot();
  await assert.rejects(store(io).save(TARGET, body()), { status: 409 }); io.unchanged(before);
  await store(io).save(TARGET, body({ baseEditor: { ...base, 写法范围: '分镜' } }));
  assert.equal(io.side().写法范围, '分镜');
});
test('TXT 冲突返回 409，两文件保持原样', async () => {
  const io = new MemoryFS('外部改文'), before = io.snapshot();
  await assert.rejects(store(io).save(TARGET, body()), { status: 409 }); io.unchanged(before);
});
test('只改作用等侧写字段也触发编辑器冲突，不能覆盖', async () => {
  const io = new MemoryFS('原文', { ...base, 镜头信息: [{ id: 's1', no: '01', 作用: '外部改作用' }] }), before = io.snapshot();
  await assert.rejects(store(io).save(TARGET, body()), { status: 409 }); io.unchanged(before);
});
test('缺失编辑器字段与 null 区分，旧稿可从空元数据迁移', async () => {
  const io = new MemoryFS('原文', { 关键词: { 1: ['参考'] } }), s = store(io);
  await assert.rejects(s.save(TARGET, body({ baseEditor: { 写法: null } })), { status: 409 });
  const result = await s.save(TARGET, body({ baseEditor: {} }));
  assert.equal(result.side.写法, '分镜'); assert.deepEqual(result.side.关键词, { 1: ['参考'] });
});
test('首次创建不存在的侧写文件', async () => {
  const io = new MemoryFS('原文', null); await store(io).save(TARGET, body({ baseEditor: {} }));
  assert.equal(io.side().分镜稿, '新文'); io.noTemps();
});
test('读取之后 AI 更新关键词，不构成编辑器冲突且合并保留', async () => {
  const io = new MemoryFS('原文', { ...base, 关键词: { 1: ['刚更新'] }, 分镜建议: ['新思路'], 未来字段: { x: 1 } });
  const result = await store(io).save(TARGET, body());
  assert.deepEqual(result.side.关键词, { 1: ['刚更新'] }); assert.deepEqual(result.side.分镜建议, ['新思路']); assert.deepEqual(result.side.未来字段, { x: 1 });
});
test('请求不能改写 AI 字段或越界文件', async () => {
  const io = new MemoryFS(), before = io.snapshot(), s = store(io);
  await assert.rejects(s.save(TARGET, body({ sidePatch: { ...base, 关键词: {} } })), { status: 400 });
  await assert.rejects(s.save(path.join(ROOT, 'AGENTS.md'), body()), { status: 400 }); io.unchanged(before);
});
test('并发请求串行化，过期第二次保存冲突而非覆盖', async () => {
  const io = new MemoryFS(), s = store(io);
  const result = await Promise.allSettled([s.save(TARGET, body({ text: '第一文' })), s.save(TARGET, body({ text: '第二文' }))]);
  assert.equal(result[0].status, 'fulfilled'); assert.equal(result[1].reason.status, 409); assert.equal(io.text(TARGET), '第一文'); io.noTemps();
});
test('写侧写临时文件失败，不改正文且清理临时文件', async () => {
  const io = new MemoryFS(), before = io.snapshot();
  io.hook = async (op, p) => { if (op === 'write' && p.startsWith(SIDE + '.')) throw new Error('模拟磁盘写失败'); };
  await assert.rejects(store(io).save(TARGET, body()), /磁盘写失败/); io.unchanged(before); io.noTemps();
});
test('替换侧写失败，正文回滚，之后可用原 base 重试', async () => {
  const io = new MemoryFS(), before = io.snapshot(), s = store(io); let fail = true;
  io.hook = async (op, from, to) => { if (op === 'rename' && to === SIDE && fail) { fail = false; throw new Error('模拟替换失败'); } };
  await assert.rejects(s.save(TARGET, body()), /替换失败/); io.unchanged(before); io.noTemps();
  await s.save(TARGET, body()); assert.equal(io.text(TARGET), '新文'); io.noTemps();
});
test('回滚失败明确报错，不假成功也不删可恢复内容', async () => {
  const io = new MemoryFS(); let textRenames = 0;
  io.hook = async (op, from, to) => { if (op !== 'rename') return; if (to === TARGET && ++textRenames > 1) throw new Error('模拟无法回滚'); if (to === SIDE) throw new Error('模拟侧写失败'); };
  await assert.rejects(store(io).save(TARGET, body()), /无法自动恢复/); assert.equal(io.text(TARGET), '新文'); assert.equal(io.side().分镜稿, '原文'); io.noTemps();
});
test('保存前归档两份原文件，重复归档不覆盖', async () => {
  const io = new MemoryFS(), oldSide = io.text(SIDE), s = store(io);
  await s.save(TARGET, body({ archive: true }));
  await s.save(TARGET, body({ baseText: '新文', text: '再改', baseEditor: pickEditor(io.side()), archive: true }));
  const hist = [...io.files].filter(([p]) => p.includes(path.sep + '历史记录' + path.sep));
  assert.equal(hist.length, 4); assert.ok(hist.some(([, v]) => v.buf.toString() === '原文')); assert.ok(hist.some(([, v]) => v.buf.toString() === oldSide)); io.noTemps();
});
test('无内容变化不生成历史版本', async () => {
  const io = new MemoryFS(), before = io.snapshot();
  await store(io).save(TARGET, body({ text: '原文', sidePatch: base, archive: true })); io.unchanged(before);
});
test('坏 JSON 停止保存，不吞错误和重置侧写', async () => {
  const io = new MemoryFS(); io.put(SIDE, '{broken'); const before = io.snapshot();
  await assert.rejects(store(io).save(TARGET, body()), { status: 409 }); io.unchanged(before);
});
test('暂存期间外部写入被提交前检查发现', async () => {
  const io = new MemoryFS();
  io.hook = async (op, p) => { if (op === 'write' && p.startsWith(SIDE + '.')) io.put(TARGET, '外部刚写'); };
  await assert.rejects(store(io).save(TARGET, body()), { status: 409 }); assert.equal(io.text(TARGET), '外部刚写'); assert.equal(io.side().分镜稿, '原文'); io.noTemps();
});
test('普通写入与草稿保存共享同一个路径锁', async () => {
  const io = new MemoryFS(), s = store(io); let release;
  const hold = new Promise(r => { release = r; });
  const normal = s.withLocks([SIDE], async () => { await hold; io.put(SIDE, JSON.stringify({ ...base, 关键词: { 1: ['排队更新'] } })); });
  const saving = s.save(TARGET, body()); release(); await normal;
  const result = await saving; assert.deepEqual(result.side.关键词, { 1: ['排队更新'] }); io.noTemps();
});

function routeFor(io) {
  const serverPath = path.join(ROOT, '.agents', 'skills', 'annotate-live', 'server.js');
  const src = fs.readFileSync(serverPath, 'utf8').split('const [cmd, arg] = process.argv.slice(2);')[0] + '\nmodule.exports = handle;';
  const context = { module: { exports: {} }, Buffer, URL, JSON, console: { log() {}, error() {} }, __dirname: path.dirname(serverPath),
    process: { env: { ANTOU_ROOT: ROOT, ANTOU_PORT: '18761' } },
    require: name => name === 'fs' ? { promises: io } : name === './jobs.js' || name === './pc-files.js' ? () => ({}) : name === './draft-store.js' ? opts => makeStore({ ...opts, io }) : require(name) };
  vm.runInNewContext(src, context, { filename: serverPath });
  return async (url, payload, headers = {}, method = 'POST') => {
    const req = Readable.from([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]);
    Object.assign(req, { url, method, headers: { host: '127.0.0.1:18761', 'x-antou': '1', ...headers } });
    const res = { headersSent: false, writeHead(status, h) { this.status = status; this.headers = h; this.headersSent = true; }, end(b) { this.body = b; }, destroy() { throw new Error('unexpected response destroy'); } };
    await context.module.exports(req, res); return res;
  };
}
const API = '/api/fs/' + path.relative(ROOT, TARGET).split(path.sep).map(encodeURIComponent).join('/');
test('HTTP draft 路由：请求校验、能力声明及冲突状态均实际返回', async () => {
  const io = new MemoryFS(), call = routeFor(io);
  const ping = await call('/api/ping', '', {}, 'GET'); assert.equal(JSON.parse(ping.body).draftSave, true);
  assert.equal((await call(API + '?draft', body(), { 'x-antou': '' })).status, 403);
  assert.equal((await call(API + '?draft', '{bad')).status, 400);
  assert.equal((await call(API + '?draft', body())).status, 200);
  assert.equal((await call(API + '?draft', body())).status, 409);
});
test('HTTP 条件创建：已有文件 412，缺失文件原样写入，均无临时残留', async () => {
  const io = new MemoryFS(), call = routeFor(io), before = io.text(TARGET);
  assert.equal((await call(API, '不能覆盖', { 'if-none-match': '*' }, 'PUT')).status, 412);
  assert.equal(io.text(TARGET), before);
  const newApi = API.replace(encodeURIComponent('视频提示词.txt'), encodeURIComponent('段落2_视频提示词.txt'));
  assert.equal((await call(newApi, '新建\r\n', { 'if-none-match': '*' }, 'PUT')).status, 200);
  assert.equal(io.text(path.join(path.dirname(TARGET), '段落2_视频提示词.txt')), '新建\r\n');
  assert.equal([...io.files.keys()].some(p => p.endsWith('.antou-tmp')), false);
});
