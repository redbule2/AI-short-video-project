'use strict';
/* annotate-live/jm-check.js：出片前核对即梦账号和画布（三条命令一起查；10 分钟内同号同画布不重查） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const make = require('../../.agents/skills/annotate-live/jm-check.js');

const ID = '8fc4ccbd-cd27-4f1b-a4a6-f13c0e9b50d3', ID2 = '4433355f-0000-4000-8000-000000000000';
const URL = 'https://jimeng.jianying.com/ai-tool/ai-canvas/' + ID, URL2 = 'https://jimeng.jianying.com/ai-tool/ai-canvas/' + ID2;
const str = v => typeof v === 'string' ? v : '';
const fail = msg => Object.assign(new Error(msg), { plain: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 假的即梦命令行：每条等 ms 毫秒；pages 是画布列表一页一页的 items；记下调了哪些 */
function fake({ ms = 60, loggedIn = true, pages = [[{ projectId: ID, name: '李云龙大战外星人' }]] } = {}) {
  const calls = [];
  const jm = async args => {
    calls.push(args.join(' '));
    await sleep(ms);
    if (args.includes('status')) return { ok: true, data: { data: { loggedIn } } };
    if (args.includes('account')) return { ok: true, data: { data: { displayName: '用户5970650407395' } } };
    const i = args.includes('--cursor') ? +args[args.indexOf('--cursor') + 1] : 0;
    return { ok: true, data: { data: { items: pages[i] || [], hasMore: i + 1 < pages.length, nextCursor: i + 1 < pages.length ? String(i + 1) : '' } } };
  };
  return { jm, calls };
}

test('三条命令一起跑：总用时约一条的时间', async () => {
  const f = fake({ ms: 120 });
  const check = make({ jm: f.jm, fail, str });
  const t0 = Date.now();
  const r = await check(URL, '');
  assert.ok(Date.now() - t0 < 300, '三条应同时跑，用了 ' + (Date.now() - t0) + ' 毫秒');
  assert.deepEqual(r, { id: ID, nick: '用户5970650407395', name: '李云龙大战外星人' });
  assert.equal(f.calls.length, 3);
});

test('10 分钟内同号同画布不重查；换画布、换号、过了 10 分钟都重查', async () => {
  let t = 1e6;
  const f = fake({ ms: 1, pages: [[{ projectId: ID, name: 'A' }, { projectId: ID2, name: 'B' }]] });
  const check = make({ jm: f.jm, fail, str, now: () => t });
  await check(URL, '');
  await check(URL, '');
  assert.equal(f.calls.length, 3, '第二遍不该再调命令行');
  await check(URL2, '');
  assert.equal(f.calls.length, 6, '换了画布要重查');
  await check(URL, 'benpao');
  assert.equal(f.calls.length, 9, '换了登录位要重查');
  assert.ok(f.calls.slice(6).every(c => c.startsWith('--profile benpao ')));
  t += 10 * 60e3;
  await check(URL, '');
  assert.equal(f.calls.length, 12, '过了 10 分钟要重查');
});

test('没核过的不记：没登录、画布不在名下，下回照样真查', async () => {
  const f = fake({ ms: 1, loggedIn: false });
  const check = make({ jm: f.jm, fail, str });
  await assert.rejects(check(URL, ''), e => e.plain && /没登录/.test(e.message));
  await assert.rejects(check(URL, ''), /没登录/);
  assert.equal(f.calls.length, 6);
  const g = fake({ ms: 1, pages: [[{ projectId: ID2, name: 'B' }]] });
  await assert.rejects(make({ jm: g.jm, fail, str })(URL, ''), e => /不在即梦默认号（用户5970650407395）名下/.test(e.message));
});

test('画布在第二页：接着翻；翻到就停', async () => {
  const f = fake({ ms: 1, pages: [[{ projectId: ID2, name: 'B' }], [{ projectId: ID, name: 'A' }], [{ projectId: 'x', name: 'C' }]] });
  const r = await make({ jm: f.jm, fail, str })(URL, '');
  assert.equal(r.name, 'A');
  assert.equal(f.calls.filter(c => c.includes('canvas ls')).length, 2);
});

test('网址、登录位不对：不调命令行就拦下', async () => {
  const f = fake();
  const check = make({ jm: f.jm, fail, str });
  await assert.rejects(check('https://example.com/x', ''), /画布网址不对/);
  await assert.rejects(check(URL, 'a b'), /登录位/);
  assert.equal(f.calls.length, 0);
});
