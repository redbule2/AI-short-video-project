'use strict';
/* 网盘同步\网盘同步.js 里推送、拉取和「网盘」那一页（网盘管理.js）共用的小工具（2026-11-15 并成一份）。
   不碰网盘：rclone 换成 node 自己，记录放临时文件夹 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs'), os = require('os'), path = require('path');
const { PassThrough } = require('stream');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), '网盘测试-'));
process.env.AIVIDEO_STATE = TMP;
process.env.AIVIDEO_LOCAL = TMP;
process.env.AIVIDEO_RCLONE = process.execPath;
const S = require('../网盘同步/网盘同步.js');
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

test('网盘管理.js 拿得到共用的那几样', () => {
  for (const k of ['COMMON', 'rcAsync', 'rcSpawn', 'rcLog', 'listFile', 'dropList', 'sum', 'under', 'sameL', 'sameContent']) assert.ok(S[k], '少了 ' + k);
  assert.equal(typeof require('../网盘同步/网盘管理.js'), 'function');
});

test('rclone 的 JSON 输出：一行断成几段也认，进度、出错分开给，别的不管', () => {
  const s = new PassThrough(), got = { stats: [], error: [] };
  S.rcLog(s, { stats: x => got.stats.push(x), error: x => got.error.push(x.msg) });
  s.write('{"stats":{"bytes":1');
  s.write('0}}\n不是 JSON 的一行\n{"level":"info","msg":"不管"}\n');
  s.write('{"level":"error","msg":"传不上去","object":"a/b.png"}\n{"level":"critical","msg":"坏了"}\n{"stats":{"bytes":20}}');
  assert.deepEqual(got.stats, [{ bytes: 10 }]);   // 最后一行还没换行：等它说完
  assert.deepEqual(got.error, ['传不上去', '坏了']);
  s.write('\n');
  assert.deepEqual(got.stats, [{ bytes: 10 }, { bytes: 20 }]);
});

test('rcAsync：收全输出、带回退出码', async () => {
  const r = await S.rcAsync(['-e', 'process.stdout.write("中文".repeat(50000)); process.stderr.write("错"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.out, '中文'.repeat(50000));
  assert.equal(r.err, '错');
});

test('rcSpawn 加上并发、进度那几个参数，rcLog 读得到', async () => {
  const p = S.rcSpawn(['-e', 'console.error(JSON.stringify({ stats: { argv: process.argv.slice(1) } }))', '--']);   // -- 以后的才是给它的参数
  const seen = [];
  p.stdout.resume();
  S.rcLog(p.stderr, { stats: x => seen.push(x.argv), error: () => {} });
  await new Promise(res => p.on('close', res));
  assert.deepEqual(seen, [[...S.COMMON, '--use-json-log', '--stats', '1s', '--stats-log-level', 'NOTICE']]);
});

test('清单文件：写得出来，dropList 收掉', () => {
  const f = S.listFile(['a/1.png', '第1段/2.png']);
  assert.equal(fs.readFileSync(f, 'utf8'), 'a/1.png\n第1段/2.png\n');
  S.dropList(f);
  assert.equal(fs.existsSync(f), false);
});

test('对账小工具', () => {
  assert.equal(S.sum([{ n: 2 }, { n: 3 }], x => x.n), 5);
  assert.ok(S.under('第1段/a.png', '第1段') && S.under('a', '') && !S.under('第1段x/a', '第1段'));
  assert.ok(S.sameL({ size: 5, mtime: 1000 }, [5, 1001]) && !S.sameL({ size: 5, mtime: 1000 }, null));
  assert.ok(S.sameContent({ size: 5, mtime: 1000 }, { size: 5, mtime: 1999 }));
  assert.ok(!S.sameContent({ size: 5, mtime: 1000 }, { size: 5, mtime: 2000 }) && !S.sameContent(null, { size: 5, mtime: 1000 }));
});

test('网盘的活存盘（11-18）：本机服务重开读回来，那会儿在做的记成没做完，再重开不重复记', async () => {
  const mount = require('../网盘同步/网盘管理.js');
  const file = path.join(TMP, '网盘任务_测试.json');
  fs.writeFileSync(file, JSON.stringify({ jobs: [
    { id: 3, kind: 'del', p: '甲', title: '删掉网盘上的 1 个', state: 'done', started: 1, ended: 2, done: 1, total: 1, errors: [], nErrors: 0, notes: [], req: { kind: 'del', p: '甲', names: ['a.png'] } },
    { id: 7, kind: 'up', p: '甲', title: '上传 9 个文件', state: 'running', started: 5, done: 4, total: 9, speed: 99, errors: ['b.png：传不上去'], nErrors: 1, notes: [], req: { kind: 'up', p: '甲', names: ['b'] } },
  ] }));
  const jobsOf = async m => {
    let out;
    const res = { headersSent: false, writeHead() {}, end(t) { out = JSON.parse(t); } };
    await m.handle({ method: 'GET' }, res, new URL('http://127.0.0.1/api/wangpan/jobs'));
    return out.jobs;
  };
  let js = await jobsOf(mount({ local: TMP, jobsFile: file }));
  assert.deepEqual(js.map(j => [j.id, j.state]), [[3, 'done'], [7, 'failed']]);
  assert.equal(js[1].restarted, true);
  assert.match(js[1].errors[0], /本机服务重开过/);
  assert.equal(js[1].errors[1], 'b.png：传不上去');
  assert.equal(js[1].nErrors, 2);
  assert.equal(js[1].speed, 0);
  assert.ok(js[1].ended > 5, '结束时间算重开那一刻：抽屉「刚做完的」里看得见');
  assert.deepEqual(js[1].req, { kind: 'up', p: '甲', names: ['b'] }, '「再来一次」照它只做还没做好的');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).jobs[1].state, 'failed', '读回来就记上');
  js = await jobsOf(mount({ local: TMP, jobsFile: file }));
  assert.equal(js[1].nErrors, 2, '再重开一回不再加一遍');
  assert.equal(js[1].errors.filter(e => /本机服务重开过/.test(e)).length, 1);
  assert.deepEqual(await jobsOf(mount({ local: path.join(TMP, '别的文件夹') })), [], '拿别的文件夹试页面：不读也不记');
});
