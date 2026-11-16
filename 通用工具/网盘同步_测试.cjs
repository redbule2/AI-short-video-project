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
const S = require('./网盘同步/网盘同步.js');
process.on('exit', () => fs.rmSync(TMP, { recursive: true, force: true }));

test('网盘管理.js 拿得到共用的那几样', () => {
  for (const k of ['COMMON', 'rcAsync', 'rcSpawn', 'rcLog', 'listFile', 'dropList', 'sum', 'under', 'sameL', 'sameContent']) assert.ok(S[k], '少了 ' + k);
  assert.equal(typeof require('./网盘同步/网盘管理.js'), 'function');
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
