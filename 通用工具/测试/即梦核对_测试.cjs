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

/* 11-17：项目还没写画布就新建一张 */
function fakeCreate({ ms = 30, ok = true, reply } = {}) {
  const calls = [];
  const jm = async args => { calls.push(args.join(' ')); await sleep(ms); return ok ? { ok: true, data: reply || { ok: true, data: {} } } : { ok: false, raw: '权限不够' }; };
  return { jm, calls };
}

test('新建画布：名字写项目名、自己给编号；网址照即梦画布的样子', async () => {
  const f = fakeCreate();
  const check = make({ jm: f.jm, fail, str, uuid: () => ID2 });
  const r = await check.create('药膳鸡配方--倚天屠龙记', '');
  assert.deepEqual(r, { id: ID2, url: URL2, name: '药膳鸡配方--倚天屠龙记' });
  assert.deepEqual(f.calls, ['canvas create 药膳鸡配方--倚天屠龙记 --project-id ' + ID2 + ' --format json']);
});

test('新建画布：命令行回了编号就用它的；带登录位', async () => {
  const f = fakeCreate({ reply: { ok: true, data: { projectId: ID, name: '甲' } } });
  const r = await make({ jm: f.jm, fail, str, uuid: () => ID2 }).create('甲', 'benpao');
  assert.equal(r.url, URL);
  assert.ok(f.calls[0].startsWith('--profile benpao canvas create 甲 '));
});

test('新建画布：同一个项目一起点两回、建好以后再点，都只建一张；没建成的下回再试', async () => {
  const f = fakeCreate();
  let n = 0;
  const check = make({ jm: f.jm, fail, str, uuid: () => (n++ ? ID : ID2) });
  const [a, b] = await Promise.all([check.create('甲', ''), check.create('甲', '')]);
  assert.equal(a.url, b.url);
  assert.equal((await check.create('甲', '')).url, a.url);
  assert.equal(f.calls.length, 1);
  const g = fakeCreate({ ok: false });
  const c2 = make({ jm: g.jm, fail, str });
  await assert.rejects(c2.create('乙', ''), e => e.plain && /新建画布没成：权限不够/.test(e.message));
  await assert.rejects(c2.create('乙', ''), /没成/);
  assert.equal(g.calls.length, 2);
});

test('新建画布：没名字、登录位不对，不调命令行', async () => {
  const f = fakeCreate();
  const check = make({ jm: f.jm, fail, str });
  await assert.rejects(check.create('  ', ''), /要有名字/);
  await assert.rejects(check.create('甲', 'a b'), /登录位/);
  assert.equal(f.calls.length, 0);
});
