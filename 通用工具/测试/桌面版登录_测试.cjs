'use strict';
/* 桌面版/lib：登录（auth.js）、日志打码（log.js）、更新大小和升级包签名（updater.js） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeAuth, decide, multipart, OFFLINE_DAYS } = require('../桌面版/lib/auth.js');
const { scrub } = require('../桌面版/lib/log.js');
const { packageBytes, MAX_BYTES } = require('../桌面版/lib/updater.js');

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 24);
const quiet = { info() {}, warn() {}, error() {} };
const memStore = (init = null) => { let v = init; return { read: () => v, write: x => { v = x; }, remove: () => { v = null; }, get v() { return v; } }; };
const reply = (body, status = 200) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const AUTH = { accessToken: 'eyJaaaaaaaaaa.bbbbbbbbbb.cccccccccc', refreshToken: 'r1', expires: '2026-11-25', username: 'lili', nickname: '莉莉', avatar: '', accountType: 'owner', ownerUsername: 'lili', roles: ['x'] };

test('续期：续上了换新凭证；连不上 7 天内照用；过了 7 天不删凭证；被拒就要重登', () => {
  const saved = { refreshToken: 'r1', username: 'lili', lastOk: NOW - 2 * DAY };
  const ok = decide(saved, { ok: true, data: { accessToken: 'a2', refreshToken: 'r2', expires: 'e2' } }, NOW);
  assert.equal(ok.ok, true);
  assert.equal(ok.saved.refreshToken, 'r2');
  assert.equal(ok.saved.lastOk, NOW);
  assert.deepEqual(decide(saved, { ok: false, offline: true }, NOW), { ok: true, offline: true, saved });
  const late = decide({ ...saved, lastOk: NOW - (OFFLINE_DAYS + 1) * DAY }, { ok: false, offline: true }, NOW);
  assert.equal(late.ok, false);
  assert.equal(late.keep, true);
  assert.deepEqual(decide(saved, { ok: false, message: '当前账号已停用，请联系主账号。' }, NOW), { ok: false, why: '当前账号已停用，请联系主账号。' });
  assert.deepEqual(decide(null, { ok: true }, NOW), { ok: false, why: '' });
});

test('登录：账号密码不许空、注册两遍要一样还要填团队；成功只存要用的，回给页面的不带凭证', async () => {
  const calls = [];
  const store = memStore();
  const auth = makeAuth({ api: 'https://video8.online', store, log: quiet, now: () => NOW, fetch: async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body) }); return reply({ success: true, message: '登录成功。', data: AUTH })(); } });
  assert.deepEqual(await auth.login('  ', 'x'), { ok: false, message: '请输入账号' });
  assert.deepEqual(await auth.login('lili', ''), { ok: false, message: '请输入密码' });
  assert.deepEqual(await auth.register('lili', 'a', 'b'), { ok: false, message: '两次输入的密码不一致' });
  assert.equal(calls.length, 0);
  const r = await auth.login(' lili ', 'pw');
  assert.deepEqual(calls[0], { url: 'https://video8.online/api/auth/login', body: { username: 'lili', password: 'pw' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.user, { username: 'lili', nickname: '莉莉', avatar: '', accountType: 'owner', ownerUsername: 'lili', offline: false });
  assert.equal(JSON.stringify(r).includes('r1'), false);
  assert.equal(store.v.refreshToken, 'r1');
  assert.equal(store.v.lastOk, NOW);
  assert.equal('roles' in store.v, false);
  assert.deepEqual(await auth.register('new1', 'pw', 'pw', '  '), { ok: false, message: '请输入团队' });
  assert.equal(calls.length, 1);
  await auth.register('new1', 'pw', 'pw', ' boss ');
  assert.deepEqual(calls[1], { url: 'https://video8.online/api/auth/register', body: { username: 'new1', password: 'pw', ownerUsername: 'boss' } });
});

test('登录没成：照服务器的话说；连不上说看看网络；500 算连不上', async () => {
  const mk = fetch => makeAuth({ api: 'https://x', store: memStore(), log: quiet, now: () => NOW, fetch });
  assert.deepEqual(await mk(reply({ success: false, message: '账号或密码错误。', data: null })).login('a', 'b'), { ok: false, message: '账号或密码错误。' });
  assert.deepEqual(await mk(async () => { throw new Error('net::ERR_CONNECTION_RESET'); }).login('a', 'b'), { ok: false, message: '连不上服务器，看看网络' });
  const s = memStore({ refreshToken: 'r1', username: 'a', lastOk: NOW - DAY });
  const r = await makeAuth({ api: 'https://x', store: s, log: quiet, now: () => NOW, fetch: reply({}, 502) }).resume();
  assert.equal(r.ok, true);
  assert.equal(r.user.offline, true);
  assert.equal(s.v.refreshToken, 'r1');
});

test('启动续期：被拒就删掉本机凭证', async () => {
  const s = memStore({ refreshToken: 'bad', username: 'a', lastOk: NOW });
  const r = await makeAuth({ api: 'https://x', store: s, log: quiet, now: () => NOW, fetch: reply({ success: false, message: '刷新令牌无效，请重新登录。' }) }).resume();
  assert.deepEqual(r, { ok: false, why: '刷新令牌无效，请重新登录。' });
  assert.equal(s.v, null);
});

test('日志打码：凭证、密码按键名打码，字符串里的 Bearer 和 JWT 也打码', () => {
  const out = scrub({ username: 'lili', password: 'pw', refreshToken: 'r1', nested: { Authorization: 'x', note: 'Bearer abc.def-123 走了' }, list: ['eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl'] });
  assert.deepEqual(out, { username: 'lili', password: '***', refreshToken: '***', nested: { Authorization: '***', note: 'Bearer *** 走了' }, list: ['***'] });
  assert.equal(scrub(new Error('Bearer abc')).message, 'Bearer ***');
});

test('更新大小：缺了、不是正整数的不下；合计含 blockmap', () => {
  assert.equal(packageBytes({ files: [{ size: 100, blockMapSize: 10 }, { size: 5 }] }), 115);
  assert.equal(packageBytes({ files: [] }), null);
  assert.equal(packageBytes({ files: [{ size: 0 }] }), null);
  assert.equal(packageBytes({ files: [{ size: 1.5 }] }), null);
  assert.equal(packageBytes({ files: [{ size: 1, blockMapSize: -1 }] }), null);
  assert.equal(MAX_BYTES, 1073741824);
});

test('升级包的签名：签的是「版本号 + 安装包的 sha512」；包改过、版本换过、没签名、签名是乱的都不装', async () => {
  const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { verifyPackage, signedText, UPDATE_KEY } = require('../桌面版/lib/updater.js');
  assert.equal(crypto.createPublicKey(UPDATE_KEY).asymmetricKeyType, 'ed25519');   // 软件里那把是 ed25519 的公钥
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');   // 试用的一对，不是发版那把
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'antou-sign-'));
  try {
    const file = path.join(dir, 'Liushuixian-1.2.3-x64.exe');
    fs.writeFileSync(file, Buffer.from('假装是安装包'));
    const sum = crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
    const sig = crypto.sign(null, Buffer.from(signedText('1.2.3', sum)), privateKey).toString('base64');
    assert.equal(await verifyPackage(file, { version: '1.2.3', signature: sig }, publicKey), null);
    assert.match(await verifyPackage(file, { version: '1.2.4', signature: sig }, publicKey), /签名对不上/);   // 拿旧包冒充新版本
    assert.match(await verifyPackage(file, { version: '1.2.3', signature: sig }), /签名对不上/);              // 别的钥匙签的
    assert.match(await verifyPackage(file, { version: '1.2.3' }, publicKey), /没有签名/);
    assert.match(await verifyPackage(file, { version: '1.2.3', signature: '乱写的' }, publicKey), /签名对不上/);
    assert.match(await verifyPackage(file, null, publicKey), /没有签名/);
    fs.appendFileSync(file, 'x');   // 下好的包被改过一个字节
    assert.match(await verifyPackage(file, { version: '1.2.3', signature: sig }, publicKey), /签名对不上/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  /* 打包那头：正式包、试装包都签；有 publisherName 软件才验；私钥不在仓库里 */
  const pack = fs.readFileSync(path.join(__dirname, '../桌面版/scripts/pack.mjs'), 'utf8');
  assert.equal((pack.match(/await signFeed\(out, /g) || []).length, 2);
  assert.match(fs.readFileSync(path.join(__dirname, '../桌面版/electron-builder.yml'), 'utf8'), /^publish:\n(?:\s+.*\n)*?\s+publisherName:\n\s+- \S+/m);
  assert.match(fs.readFileSync(path.join(__dirname, '../桌面版/lib/updater.js'), 'utf8'), /up\.verifyUpdateCodeSignature = /);
  assert.match(pack, /os\.homedir\(\), '\.liushuixian'/);
});

/* 替页面问服务器（考试、团队页）：假服务器照 plan 里排好的一个个回 */
function apiAuth(plan, saved = { accessToken: 'a1', refreshToken: 'r1', username: 'lili' }) {
  const calls = [];
  const store = memStore(saved);
  const auth = makeAuth({ api: 'https://x', store, log: quiet, now: () => NOW, fetch: async (url, opt) => { calls.push({ url, ...opt }); const step = plan.shift(); if (step instanceof Error) throw step; return step(); } });
  return { auth, calls, store };
}

test('问服务器：只许考试、团队两块；没登录不问；带上凭证、查询和内容', async () => {
  const { auth, calls } = apiAuth([reply({ success: true, data: { items: [] } }), reply({ success: true })]);
  for (const [m, p] of [['GET', '/api/auth/login'], ['GET', '/api/exam/../auth/x'], ['GET', '/api/exam/my?x=1'], ['TRACE', '/api/exam/my'], ['GET', 'https://evil/api/exam/my']]) assert.equal((await auth.api(m, p)).status, 400, m + ' ' + p);
  assert.equal(calls.length, 0);
  assert.deepEqual(await apiAuth([], null).auth.api('GET', '/api/exam/my'), { ok: false, status: 401, data: null });
  assert.deepEqual(await auth.api('get', '/api/exam/papers', { query: { pageIndex: 1, pageSize: 20, skip: null } }), { ok: true, status: 200, data: { success: true, data: { items: [] } } });
  assert.equal(calls[0].url, 'https://x/api/exam/papers?pageIndex=1&pageSize=20');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Authorization, 'Bearer a1');
  assert.equal(calls[0].body, undefined);
  await auth.api('PUT', '/api/exam/sheets/s1/answers', { body: { answers: { q1: { answer: 'A' } } } });
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.equal(calls[1].body, '{"answers":{"q1":{"answer":"A"}}}');
});

test('问服务器：凭证过期续一回再问；续不上回 401；连不上回 0', async () => {
  const fresh = reply({ success: true, data: { accessToken: 'a2', refreshToken: 'r2', expires: 'e2' } });
  const a = apiAuth([reply(null, 401), fresh, reply({ success: true, data: 1 })]);
  assert.deepEqual(await a.auth.api('GET', '/api/exam/my'), { ok: true, status: 200, data: { success: true, data: 1 } });
  assert.deepEqual(a.calls.map(c => c.url), ['https://x/api/exam/my', 'https://x/api/auth/refresh-token', 'https://x/api/exam/my']);
  assert.equal(a.calls[2].headers.Authorization, 'Bearer a2');
  assert.equal(a.store.v.refreshToken, 'r2');
  const b = apiAuth([reply(null, 401), reply({ success: false, message: '刷新令牌无效，请重新登录。' })]);
  assert.equal((await b.auth.api('GET', '/api/exam/my')).status, 401);
  const c = apiAuth([reply(null, 401), new Error('断网')]);
  assert.equal((await c.auth.api('GET', '/api/exam/my')).status, 0);
  assert.deepEqual(await apiAuth([new Error('断网')]).auth.api('GET', '/api/exam/my'), { ok: false, status: 0, data: null });
  const d = apiAuth([reply(null, 401), fresh, reply(null, 401)]);   // 续上了还是 401：照 401 回，不再续
  assert.equal((await d.auth.api('GET', '/api/exam/my')).status, 401);
  assert.equal(d.calls.length, 3);
});

test('问服务器：同时过期的几个请求只续一回', async () => {
  const urls = [];
  const token = 'a2';   // 服务器只认新凭证：本机存的 a1 过期了
  const store = memStore({ accessToken: 'a1', refreshToken: 'r1' });
  const auth = makeAuth({ api: 'https://x', store, log: quiet, now: () => NOW, fetch: async (url, opt) => {
    urls.push(url);
    if (url.endsWith('/refresh-token')) { await new Promise(r => setTimeout(r, 5)); return reply({ success: true, data: { accessToken: 'a2', refreshToken: 'r2' } })(); }
    return opt.headers.Authorization === 'Bearer ' + token ? reply({ success: true })() : reply(null, 401)();
  } });
  const rs = await Promise.all([auth.api('GET', '/api/exam/my'), auth.api('GET', '/api/exam/papers'), auth.api('GET', '/api/collaboration/accounts')]);
  assert.deepEqual(rs.map(r => r.status), [200, 200, 200]);
  assert.equal(urls.filter(u => u.endsWith('/refresh-token')).length, 1);
});

test('问服务器：传图拼成表单，名字里的引号换掉，等得久一点', async () => {
  const { auth, calls } = apiAuth([reply({ success: true, data: { url: '/uploads/exam/s1/a.png' } })]);
  const r = await auth.api('POST', '/api/exam/sheets/s1/uploads', { file: { name: '我的"图".png', type: 'image/png', bytes: new Uint8Array([1, 2, 3]).buffer } });
  assert.equal(r.data.data.url, '/uploads/exam/s1/a.png');
  const c = calls[0];
  const boundary = c.headers['Content-Type'].replace('multipart/form-data; boundary=', '');
  const text = c.body.toString('latin1');
  assert.equal(c.timeout, 120000);
  assert.ok(text.startsWith('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename='));
  assert.ok(c.body.toString('utf8').includes('filename="我的_图_.png"\r\nContent-Type: image/png\r\n\r\n'));
  assert.ok(text.endsWith('\x01\x02\x03\r\n--' + boundary + '--\r\n'));
  assert.equal(multipart({ bytes: new Uint8Array(0) }).body.toString('utf8').includes('filename="file"\r\nContent-Type: application/octet-stream'), true);
});

test('问服务器：等新消息（聊天）多等一截；拿图回的是图本身（类型和字节），拿不到照状态码回', async () => {
  const png = new Uint8Array([137, 80, 78, 71]);
  const pic = () => ({ ok: true, status: 200, headers: { get: k => (k === 'content-type' ? 'image/png' : null) }, arrayBuffer: async () => png.buffer, json: async () => { throw new Error('不是 JSON'); } });
  const { auth, calls } = apiAuth([reply({ success: true, data: { messages: [] } }), pic, reply(null, 404), reply({ success: true })]);
  await auth.api('GET', '/api/collaboration/chat/updates', { query: { after: 7, wait: 25 } });
  assert.equal(calls[0].url, 'https://x/api/collaboration/chat/updates?after=7&wait=25');
  assert.equal(calls[0].timeout, 40000);
  const got = await auth.api('GET', '/api/collaboration/chat/messages/m1/image', { binary: true });
  assert.equal(got.ok, true);
  assert.equal(got.data.type, 'image/png');
  assert.deepEqual([...got.data.bytes], [137, 80, 78, 71]);
  assert.equal(calls[1].timeout, 120000);
  assert.equal(calls[1].headers.Accept, '*/*');
  assert.deepEqual(await auth.api('GET', '/api/collaboration/chat/messages/m2/image', { binary: true }), { ok: false, status: 404, data: null });
  await auth.api('GET', '/api/collaboration/chat/inbox');
  assert.equal(calls[3].timeout, undefined, '别的照常 10 秒（main.js 里定的）');
});

test('问服务器：培训「保存并发卷」多等一截（最多 30 张卷逐张发）；读列表、读排名、删培训照常 10 秒', async () => {
  const ok = () => reply({ success: true });
  const { auth, calls } = apiAuth([ok(), ok(), ok(), ok(), ok()]);
  await auth.api('post', '/api/exam/trainings', { body: { name: '第一期' } });
  await auth.api('PUT', '/api/exam/trainings/t1', { body: { name: '第一期' } });
  await auth.api('GET', '/api/exam/trainings');
  await auth.api('get', '/api/exam/trainings/t1/ranking');
  await auth.api('DELETE', '/api/exam/trainings/t1');
  assert.deepEqual(calls.map(c => c.timeout), [90000, 90000, undefined, undefined, undefined]);
});
