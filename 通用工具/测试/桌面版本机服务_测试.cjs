'use strict';
/* 桌面版/lib/runner.js 的 keepServer：桌面软件开着，本机服务就一直开着（2026-11-26）——
   自己开的停了自己重开、别人开的接着用（那个停了自己开一个）、开不起来越隔越久再试、改好了自己开起来、
   别人开的只是忙不另开、停下软件只关自己开的。用一个假的 server.js（只回 /api/ping）代替流水线的本机服务 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { keepServer, ping, samePath } = require('../桌面版/lib/runner.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(50)) { const v = await fn(); if (v) return v; }
  return null;
}
function freePort() {
  return new Promise(resolve => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
}

/* 假的本机服务：回 /api/ping（带上自己的进程号，看换没换人）；/block?ms=N 让它忙 N 毫秒；开着时在 FAKE_LOG 记一行几点开的 */
const GOOD = `
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.env.ANTOU_ROOT;
if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, Date.now() + '\\n');
const s = http.createServer((req, res) => {
  if (req.url.startsWith('/block')) { const end = Date.now() + Number(req.url.split('=')[1]); while (Date.now() < end); return res.end('ok'); }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ root: path.basename(root), v: 1, abs: root, pid: process.pid }));
});
s.on('error', e => { console.error(e.code); process.exit(1); });
s.listen(Number(process.env.ANTOU_PORT), '127.0.0.1');
`;
const BROKEN = `throw new Error('代码改坏了');`;
const CRASHY = GOOD + `setTimeout(() => process.exit(2), 150);`;   // 开起来没一会儿就退

function setup(t, code = GOOD) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'antou-keep-'));
  const js = path.join(work, '.agents', 'skills', 'annotate-live', 'server.js');
  fs.mkdirSync(path.dirname(js), { recursive: true });
  fs.writeFileSync(js, code);
  const changes = [], warns = [], kids = [], outs = [];
  const log = { info() {}, warn: m => warns.push(m), error: m => warns.push(m) };
  t.after(async () => {   // 先把开着的都停了（它们的工作目录在这个文件夹里），再删文件夹
    for (const k of kids) k.stop();
    for (const c of outs) if (c.exitCode === null && c.signalCode === null) { c.kill(); await once(c, 'exit'); }
    fs.rmSync(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  });
  return {
    work, js, changes, warns,
    async keep(port, { env, ...extra } = {}) {
      const k = await keepServer({ nodeExe: process.execPath, work, port, env: { ...process.env, ANTOU_ROOT: work, ANTOU_PORT: String(port), ...env }, log, every: 100, retry: 50, onChange: c => changes.push(c), ...extra });
      kids.push(k);
      return k;
    },
    outside(port) {   // 别人开的（像别的会话跑 node server.js open 开的那个）
      const c = spawn(process.execPath, [js], { cwd: work, env: { ...process.env, ANTOU_ROOT: work, ANTOU_PORT: String(port) }, stdio: 'ignore', windowsHide: true });
      outs.push(c);
      return c;
    },
  };
}
const pidOn = async port => { const p = await ping(port); return p ? p.pid : 0; };
const changedPid = (port, old, ms = 8000) => until(async () => { const p = await pidOn(port); return p && p !== old ? p : 0; }, ms);

test('自己开的被停了：马上自己重开，先说停了、再说好了', async t => {
  const s = setup(t), port = await freePort();
  await s.keep(port);
  const p = await ping(port);
  assert.ok(p && samePath(p.abs, s.work), '开起来了，认的是这个工作文件夹');
  process.kill(p.pid);   // 像别的 AI 改完代码那样，只停服务那一个号
  assert.ok(await changedPid(port, p.pid), '几秒内换了一个新的开着');
  await until(() => s.changes.length >= 2, 2000);
  assert.deepEqual(s.changes, [{ up: false }, { up: true }]);
});

test('接着用别人开的；那个停了，自己开一个；停下软件只关自己开的', async t => {
  const s = setup(t), port = await freePort();
  const other = s.outside(port);
  assert.ok(await until(() => ping(port), 5000), '别人开的先开着');
  const k = await s.keep(port);
  assert.equal(await pidOn(port), other.pid, '没另开，接着用别人那个');
  other.kill();
  const mine = await changedPid(port, other.pid);
  assert.ok(mine, '别人那个停了：自己开一个');
  k.stop();
  assert.equal(await ping(port), null, '停下软件：自己开的那个也关了');
  await sleep(500);
  assert.equal(await ping(port), null, '停下以后不再重开');
});

test('停下软件时，别人开的那个不关', async t => {
  const s = setup(t), port = await freePort();
  const other = s.outside(port);
  await until(() => ping(port), 5000);
  const k = await s.keep(port);
  k.stop();
  await sleep(300);
  assert.equal(await pidOn(port), other.pid);
});

test('开不起来就隔一会儿再试，说清为什么；改好了自己开起来', async t => {
  const s = setup(t), port = await freePort();
  await s.keep(port, { most: 400 });
  const p = await ping(port);
  fs.writeFileSync(s.js, BROKEN);   // 别的会话正改着 server.js，改了一半
  process.kill(p.pid);
  assert.ok(await until(() => s.changes.find(c => c.error), 8000), '没开起来：告诉壳子');
  const bad = s.changes.find(c => c.error);
  assert.equal(bad.up, false);
  assert.match(bad.error, /本机服务没开起来/);
  assert.match(bad.error, /代码改坏了/, '把服务自己说的出错带上');
  assert.equal(await ping(port), null);
  fs.writeFileSync(s.js, GOOD);
  assert.ok(await until(() => ping(port), 8000), '改好了：自己开起来');
  await until(() => s.changes.at(-1).up, 2000);
  assert.deepEqual(s.changes.at(-1), { up: true });
  assert.ok(s.warns.includes('本机服务没开起来，等一会儿再试'));
});

test('开起来没几秒又退了：越隔越久再试，不一秒一回地重开', async t => {
  const s = setup(t), port = await freePort();
  const starts = path.join(s.work, '开了几回.txt');
  await s.keep(port, { most: 5000, env: { FAKE_LOG: starts } });
  fs.writeFileSync(s.js, CRASHY);
  process.kill(await pidOn(port));
  await sleep(5000);
  const times = fs.readFileSync(starts, 'utf8').trim().split('\n').map(Number).slice(1);   // 头一行是好好开的那一回
  const gaps = times.slice(1).map((x, i) => x - times[i]);
  assert.ok(times.length >= 3 && times.length <= 6, `5 秒里重开了 ${times.length} 回`);
  assert.ok(gaps.at(-1) > gaps[0] * 2, `隔得越来越久：${gaps.join('、')} 毫秒`);
});

test('别人开的只是忙一会儿：不另开，也不说停了', async t => {
  const s = setup(t), port = await freePort();
  const other = s.outside(port);
  await until(() => ping(port), 5000);
  await s.keep(port);
  http.get({ host: '127.0.0.1', port, path: '/block?ms=2500' }).on('error', () => {});
  await sleep(3500);
  assert.equal(await pidOn(port), other.pid);
  assert.deepEqual(s.changes, []);
});

test('头一回就开不起来：照旧抛出去，说清为什么', async t => {
  const s = setup(t), port = await freePort();
  fs.rmSync(s.js);
  await assert.rejects(s.keep(port), /工作文件夹里没有流水线的本机服务/);
});
