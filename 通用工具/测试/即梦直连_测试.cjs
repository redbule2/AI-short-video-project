'use strict';
/* jobs.js 跑即梦命令行一律直连（11-21）：服务从 Git Bash 起会带上 18778 代理，一条命令慢一倍。
   核对账号（jm）和认画布节点（canvas.js 拿到的 run）都不带 http_proxy、https_proxy、ALL_PROXY，别的环境变量照旧。
   假的 child_process：只记下每回起命令时的环境，不真跑即梦命令行。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');

const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const JM = path.join(__dirname, '__假的即梦命令行__.exe');

function load() {
  const spawned = [];
  let canvasOpts = null;
  const spawn = (cmd, args, opts) => {
    spawned.push({ cmd, args, env: opts.env });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdin = { on() {}, end() { setImmediate(() => { child.stdout.emit('data', Buffer.from(JSON.stringify({ ok: true, data: { data: { loggedIn: true, displayName: '测试号' } } }))); child.emit('close', 0); }); } };
    return child;
  };
  const mockFs = { existsSync: p => p === JM, promises: { async readFile() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); }, async readdir() { return []; }, async mkdir() {}, async writeFile() {}, async stat() { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); } } };
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn }
      : name === './canvas.js' ? o => { canvasOpts = o; return { versions: async () => [], plan: () => '', handle: async () => null }; }
      : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(fs.readFileSync(backend, 'utf8'), box, { filename: backend });
  const api = box.module.exports({ ROOT: path.join(__dirname, '__内存测试根__'), TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (p, fn) => fn() });
  return { api, spawned, canvasOpts: () => canvasOpts };
}
const proxyOf = env => Object.entries(env || {}).filter(([k, v]) => /^(https?|all)_proxy$/i.test(k) && v !== undefined).map(([k]) => k);

test('核对即梦账号、认画布节点：起命令时不带代理，别的环境变量照旧', async () => {
  const keep = { ANTOU_JIMENG: process.env.ANTOU_JIMENG, https_proxy: process.env.https_proxy, HTTP_PROXY: process.env.HTTP_PROXY, ALL_PROXY: process.env.ALL_PROXY, ANTOU_测试变量: process.env.ANTOU_测试变量 };
  Object.assign(process.env, { ANTOU_JIMENG: JM, https_proxy: 'http://127.0.0.1:18778', HTTP_PROXY: 'http://127.0.0.1:18778', ALL_PROXY: 'http://127.0.0.1:18778', ANTOU_测试变量: '留着' });
  try {
    const { api, spawned, canvasOpts } = load();
    const got = await api.handle({ method: 'GET' }, {}, new URL('http://x/api/jimeng'), { json: (res, o) => o, readBody: async () => '', httpErr: (c, m) => new Error(m) });
    assert.equal(got.status.ok, true);
    assert.equal(spawned.length, 2, 'auth status、auth account 各一条');
    for (const s of spawned) {
      assert.equal(s.cmd, JM);
      assert.deepEqual(proxyOf(s.env), [], '即梦命令行不该走代理：' + s.args.join(' '));
      assert.equal(s.env.ANTOU_测试变量, '留着');
    }
    await canvasOpts().run(JM, ['--non-interactive', 'node', 'find'], { timeout: 1000 });   // canvas.js 拿到的 run 也一样
    assert.deepEqual(proxyOf(spawned[2].env), []);
    assert.equal(spawned[2].env.ANTOU_测试变量, '留着');
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
