'use strict';
/* annotate-live/jm-cmds.js（11-26）：即梦命令行还认不认流水线的命令。
   来历：命令行 1.3.0 升到 1.4.2，「node find」改叫「node ls」，流水线还喊老名字，点「批准出片」回回停在「没查成…过一会儿再点」。
   前面几条用假的命令清单（照 1.4.2 的 schema 回话的样子）；最后一条拿这台电脑上真的命令行核（没装就跳过）——升级命令行以后跑它。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const make = require('../../.agents/skills/annotate-live/jm-cmds.js');
const { USED, GLOBAL, gaps, missing, unknown } = make;

/* 照 USED 拼一份命令行自己的清单。drop：没有了的命令；strip：{ 命令: [没有了的参数] }；extra：多出来的命令；noGlobal：没有了的公共参数 */
function schema({ drop = [], strip = {}, extra = {}, noGlobal = [] } = {}) {
  const root = { globalFlags: GLOBAL.filter(f => !noGlobal.includes(f)).map(name => ({ name })), subcommands: [] };
  for (const [cmd, flags] of Object.entries({ ...USED, ...extra })) {
    if (drop.includes(cmd)) continue;
    let at = root;
    for (const w of cmd.split(' ')) {
      let n = at.subcommands.find(s => s.name === w);
      if (!n) at.subcommands.push(n = { name: w, flags: [], subcommands: [] });
      at = n;
    }
    at.flags = flags.filter(f => !(strip[cmd] || []).includes(f)).map(name => ({ name }));
  }
  return root;
}
/* 假的即梦命令行：只答 schema、version；记下问了几回 */
function fake({ data = schema(), version = '1.4.2', bad = '' } = {}) {
  const calls = [];
  const run = async (exe, args) => {
    calls.push(args.join(' '));
    assert.equal(missing(args), '');
    if (bad === '跑不起来') throw new Error('spawn EPERM');
    if (bad === '不是 JSON') return { code: 0, out: '用法：dreamina-canvas …', err: '' };
    if (args.includes('schema')) return { code: 0, out: JSON.stringify({ schemaVersion: '2', ok: true, data }), err: '' };
    return { code: 0, out: JSON.stringify({ schemaVersion: '2', ok: true, data: { version } }), err: '' };
  };
  return { run, calls };
}
const exe = () => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), '即梦命令清单-')), 'dreamina-canvas.exe'); fs.writeFileSync(f, 'v1'); return f; };

test('都认：没有对不上的', () => {
  assert.deepEqual(gaps(schema()), []);
  assert.deepEqual(gaps(schema({ extra: { 'node find': ['name'], 'director': [] } })), [], '命令行多出来的命令不管');
});

test('11-26 那回：命令行还叫老名字（node find、model list），新名字它不认——点得出是哪两句', () => {
  const old = schema({ drop: ['node ls', 'model ls'], extra: { 'node find': USED['node ls'], 'model list': USED['model ls'] } });
  assert.deepEqual(gaps(old), ['「model ls」', '「node ls」']);
});

test('命令还在、少了参数：点得出是哪句的哪个参数；每句都带的参数少了也说', () => {
  assert.deepEqual(gaps(schema({ strip: { 'node ls': ['name', 'offset'], 'node run': ['credit-token'] } })), ['「node ls」的 --name、--offset', '「node run」的 --credit-token']);
  assert.deepEqual(gaps(schema({ noGlobal: ['profile'] })), ['每句都带的 --profile']);
  assert.deepEqual(gaps(schema({ drop: ['node create video'] })), ['「node create video」'], '三个词的命令少了最后一层也认得出');
  assert.ok(gaps(null).length && gaps({}).length, '清单是空的：全算对不上（check 那边读不到清单不会走到这里）');
});

test('missing：一条要跑的命令，清单里记没记', () => {
  assert.equal(missing(['--non-interactive', '--profile', 'benpao', 'node', 'ls', '--project-id', 'x', '--name', '人物和道具_我军士兵', '--type', 'image', '--limit', '50', '--offset', '0', '--format', 'json']), '');
  assert.equal(missing(['--non-interactive', 'resource', 'download', 'rid-1', '--project-id', 'x', '-o', 'a.part']), '', '-o 就是 --output');
  assert.equal(missing(['node', 'create', 'video', '--project-id', 'x', '--node-id', 'n', '--update-id', 'u', '--title', 't', '--mode', 'm2v', '--model', 'm', '--ratio', '16:9', '--resolution', '480p', '--duration', '10', '--count', '1', '--prompt', '【基础设定】', '--ref', 'node:a', '--ref', 'node:b']), '');
  assert.equal(missing(['canvas', 'create', '项目名', '--project-id', 'x', '--format', 'json']), '');
  assert.match(missing(['--non-interactive', 'node', 'find', '--name', 'x']), /没有「node find --name」/);
  assert.match(missing(['node', 'ls', '--project-id', 'x', '--status', 'success']), /「node ls」没有 --status/);
});

test('unknown：只认「不认这句命令、这个参数」，别的错不算', () => {
  const er = d => ({ code: 2, message: 'The request parameters are invalid.', diagnostics: [{ detail: d }] });
  assert.ok(unknown(er('The command contains an unrecognized subcommand.')));
  assert.ok(unknown(er('The command contains an unrecognized option.')));
  assert.ok(!unknown({ code: 2, message: 'The request parameters are invalid.' }), '服务端说参数不对（11-21 存草稿头一回就这样，再存就成）不算');
  assert.ok(!unknown({ code: 40012, message: 'The operation outcome could not be confirmed.', diagnostics: [{ detail: 'timeout' }] }));
  assert.ok(!unknown(null) && !unknown(undefined) && !unknown({}));
});

test('check：对得上回空；命令行文件没换不重问，换了（升级）才重问', async () => {
  const JM = exe(), f = fake();
  const c = make({ JM, run: f.run });
  assert.equal(await c.check(), '');
  assert.equal(f.calls.length, 2, '问一回清单、一回版本');
  assert.ok(f.calls.every(x => x.startsWith('--non-interactive ') && x.endsWith(' --format json')));
  assert.equal(await c.check(), '');
  assert.equal(f.calls.length, 2, '文件没换：不重问');
  fs.writeFileSync(JM, '升级过的新版本');
  assert.equal(await c.check(), '');
  assert.equal(f.calls.length, 4, '文件换了：重问');
});

test('check：对不上回一句给人看的话——哪个版本、哪几句、再点也没用、发给 AI；同一版不重问', async () => {
  const JM = exe(), f = fake({ version: '9.9.9', data: schema({ drop: ['node ls'], strip: { 'node quote': ['node-id'] } }) }), logs = [];
  const c = make({ JM, run: f.run, log: m => logs.push(m) });
  const msg = await c.check();
  assert.equal(msg, '即梦命令行升级了（现在是 9.9.9 版），流水线有 2 处它不认了：「node ls」、「node quote」的 --node-id。再点也没用，把这句话发给 AI，让它照新版改');
  assert.equal(await c.check(), msg);
  assert.equal(f.calls.length, 2);
  assert.equal(logs.length, 1);
});

test('check：清单读不到（老版本没有 schema、命令行跑不起来）不拦，也不记——下回照样再问', async () => {
  for (const bad of ['跑不起来', '不是 JSON']) {
    const JM = exe(), f = fake({ bad }), logs = [];
    const c = make({ JM, run: f.run, log: m => logs.push(m) });
    assert.equal(await c.check(), '', bad);
    assert.equal(await c.check(), '', bad);
    assert.equal(f.calls.length, 4, bad + '：没读到的不记');
  }
  const none = fake();
  assert.equal(await make({ JM: path.join(os.tmpdir(), '没有这个文件', 'dreamina-canvas.exe'), run: none.run }).check(), '');
  assert.equal(none.calls.length, 0, '没装命令行：不问（别处会说没装）');
});

test('check：几处同时问，只问命令行一回', async () => {
  const JM = exe(), f = fake();
  const c = make({ JM, run: async (e, a) => { await new Promise(r => setTimeout(r, 30)); return f.run(e, a); } });
  assert.deepEqual(await Promise.all([c.check(), c.check(), c.check()]), ['', '', '']);
  assert.equal(f.calls.length, 2);
});

/* 升级即梦命令行以后跑这一条：拿这台电脑上真的命令行核。只问它自己的命令清单（本机就答，不联网、不花积分） */
const REAL = process.env.ANTOU_JIMENG || path.join(os.homedir(), 'bin', 'dreamina-canvas.exe');
test('这台电脑上真的即梦命令行：流水线用到的命令、参数它都认', { skip: !fs.existsSync(REAL) && '这台电脑没装即梦命令行', timeout: 60e3 }, async () => {
  const run = (cmd, args, { timeout } = {}) => new Promise((ok, no) => execFile(cmd, args, { timeout, maxBuffer: 64 << 20, windowsHide: true }, (e, out, err) => e && e.code == null ? no(e) : ok({ code: e ? e.code : 0, out, err })));
  const r = await run(REAL, ['--non-interactive', 'schema', '--format', 'json'], { timeout: 30e3 });
  let data = null;
  try { data = JSON.parse(r.out).data; } catch (e) { /* 老版本没有 schema */ }
  if (!data || !Array.isArray(data.subcommands)) return;   // 读不到清单：没法核，不算不过（check 那边也不拦）
  assert.deepEqual(gaps(data), [], '即梦命令行升级后对不上了：照新版改 jm-cmds.js 的 USED 和用到这几句的地方（jm-video.js、canvas.js、jm-check.js、jobs.js）');
  assert.equal(await make({ JM: REAL, run }).check(), '');
});
