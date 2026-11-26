'use strict';
/* 桌面版/lib/chat.js：壳子在后台收聊天消息——数没看的条数、该提醒的提醒、页面标了已读跟着减、
   同一时间只挂一个请求、连不上越等越久、换人登录旧的那一轮就停（2026-11-26） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { makeChat, BASE, WAIT, RETRY, MISSING, MIN_GAP } = require('../桌面版/lib/chat.js');

const quiet = { info() {}, warn() {}, error() {} };
const ok = data => ({ ok: true, status: 200, data: { success: true, message: '', data } });
const msg = (seq, conversationId, sender, text = '你好', kind = 'text') => ({ id: 'm' + seq, seq, conversationId, sender, kind, text: kind === 'text' ? text : null, image: kind === 'image' ? { bytes: 9, width: 1, height: 1 } : null, clientId: null, sentAt: '2026-11-26T10:00:00' });
const INBOX = ok({
  currentUsername: 'boss',
  cursor: 7,
  storageWarning: null,
  conversations: [
    { id: 'team_1', kind: 'team', peerUsername: null, lastSeq: 7, lastMessage: null, readSeq: 4, unread: 2 },
    { id: 'dm_wang', kind: 'direct', peerUsername: 'wang', lastSeq: 5, lastMessage: null, readSeq: 5, unread: 0 },
  ],
});
const TEAM = ok({ members: [{ username: 'boss', displayName: '老板' }, { username: 'wang', displayName: '小王' }, { username: 'li', displayName: '小李' }] });
const tick = () => new Promise(r => setImmediate(r));
async function settle(n = 8) { for (let i = 0; i < n; i++) await tick(); }

/* 假的服务器：按顺序一问一答；答完了就一直挂着（像在等新消息）。记下每一回问的什么、同一时间最多几个在路上 */
function harness(replies, extra = {}) {
  const calls = [], waits = [], notices = [], pushed = [];
  let changes = 0, inFlight = 0, peak = 0, clock = 0;
  const ask = (method, path, opts) => {
    calls.push({ method, path, query: opts && opts.query });
    inFlight++;
    peak = Math.max(peak, inFlight);
    const next = replies.shift();
    if (!next) return new Promise(() => {});
    return Promise.resolve(typeof next === 'function' ? next() : next).then(r => { inFlight--; return r; });
  };
  const chat = makeChat({
    ask, log: quiet,
    onChange: () => { changes++; },
    onMessages: list => pushed.push(list),
    onNotice: n => notices.push(n),
    sleep: ms => { waits.push(ms); clock += ms; return Promise.resolve(); },
    now: () => clock,
    ...extra,
  });
  return { chat, calls, waits, notices, pushed, get changes() { return changes; }, get peak() { return peak; }, tick: ms => { clock += ms; } };
}

test('登录后：先问一次聊天首页，数出没看的条数，接着从首页给的那条往后等，最多挂 25 秒', async () => {
  const h = harness([INBOX]);
  h.chat.start('boss');
  await settle();
  assert.deepEqual(h.calls.map(c => c.path), [BASE + '/inbox', BASE + '/updates']);
  assert.deepEqual(h.calls[1].query, { after: 7, wait: WAIT });
  assert.equal(WAIT, 25);
  assert.equal(h.chat.unread(), 2);
  assert.ok(h.changes >= 1);
  assert.equal(h.peak, 1, '同一时间只挂一个请求');
});

test('来了新消息：别人发的、没看过的才算；自己发的、首页已经算过的、已读过的不算；都转给页面；提醒写清是谁、说了什么', async () => {
  const batch = [msg(6, 'team_1', 'wang'), msg(8, 'team_1', 'boss'), msg(9, 'dm_wang', 'wang', '晚上\n开会'), msg(5, 'dm_wang', 'wang')];
  const h = harness([INBOX, ok({ messages: batch, cursor: 9, more: false }), TEAM]);
  h.chat.start('boss');
  await settle();
  assert.equal(h.chat.unread(), 3, '首页的 2 条 + 小王私聊里新来的 1 条（6 号在首页里算过了，8 号是自己发的，5 号早读过）');
  assert.deepEqual(h.pushed, [batch]);
  assert.deepEqual(h.calls.map(c => c.path), [BASE + '/inbox', BASE + '/updates', '/api/collaboration/team', BASE + '/updates']);
  assert.deepEqual(h.notices, [{ title: '小王', body: '晚上 开会', conversationId: 'dm_wang', count: 1 }]);
  assert.deepEqual(h.calls[3].query, { after: 9, wait: WAIT });
});

test('提醒的话：同一个会话好几条写条数；几个会话一起来写谁发来的；全员群标上；图片写 [图片]；名字认得就不再问名单', async () => {
  const h = harness([INBOX, ok({ messages: [msg(10, 'team_1', 'wang'), msg(11, 'team_1', 'li', '', 'image')], cursor: 11, more: false }), TEAM, ok({ messages: [msg(12, 'team_1', 'li', 'a'), msg(13, 'dm_wang', 'wang', 'b')], cursor: 13, more: false })]);
  h.chat.start('boss');
  await settle(12);
  assert.deepEqual(h.notices, [
    { title: '全员群 · 小李', body: '2 条新消息：[图片]', conversationId: 'team_1', count: 2 },
    { title: '新消息', body: '小李、小王发来 2 条新消息', conversationId: 'dm_wang', count: 2 },
  ]);
  assert.equal(h.calls.filter(c => c.path === '/api/collaboration/team').length, 1);
});

test('页面标了已读（POST …/read 成功）：数字跟着减；没成的、别的地址不算；还不认识的会话先记下读到哪', async () => {
  const h = harness([INBOX, ok({ messages: [msg(9, 'dm_new', 'li')], cursor: 9, more: false })]);
  h.chat.observe('POST', BASE + '/conversations/team_1/read', { body: { upToSeq: 7 } }, ok(true));   // 还没开始等：不算
  h.chat.start('boss');
  await settle();
  assert.equal(h.chat.unread(), 3);
  h.chat.observe('POST', BASE + '/conversations/team_1/read', { body: { upToSeq: 7 } }, { ok: true, status: 200, data: { success: false, message: '不行' } });
  h.chat.observe('GET', BASE + '/conversations/team_1/read', { body: { upToSeq: 7 } }, ok(true));
  assert.equal(h.chat.unread(), 3);
  h.chat.observe('POST', BASE + '/conversations/team_1/read', { body: { upToSeq: 7 } }, ok(true));
  assert.equal(h.chat.unread(), 1);
  h.chat.observe('POST', BASE + '/conversations/dm_new/read', { body: { upToSeq: 9 } }, ok(true));
  assert.equal(h.chat.unread(), 0);
  h.chat.observe('POST', BASE + '/conversations/dm_later/read', { body: { upToSeq: 20 } }, ok(true));   // 页面先读到了，壳子的消息后到
  const late = harness([INBOX, ok({ messages: [msg(20, 'dm_later', 'li')], cursor: 20, more: false })]);
  late.chat.start('boss');
  late.chat.observe('POST', BASE + '/conversations/dm_later/read', { body: { upToSeq: 20 } }, ok(true));
  await settle();
  assert.equal(late.chat.unread(), 2, '20 号页面已经读了：不算没看');
  assert.equal(late.notices.length, 0);
});

test('连不上：隔 2、5、10、30、60、60 秒再试；成了从头算；服务器还没有聊天（404）十分钟看一眼', async () => {
  const off = { ok: false, status: 0, data: null };
  const h = harness([off, off, off, off, off, off, INBOX, off, ok({ messages: [], cursor: 7, more: false })]);
  h.chat.start('boss');
  await settle(30);
  assert.deepEqual(RETRY, [2, 5, 10, 30, 60]);
  assert.deepEqual(h.waits, [2000, 5000, 10000, 30000, 60000, 60000, 2000, MIN_GAP], '最后那 1 秒：空着回来得快，歇一下');
  const m = harness([{ ok: false, status: 404, data: null }, INBOX, { ok: false, status: 404, data: null }, INBOX]);
  m.chat.start('boss');
  await settle(20);
  assert.deepEqual(m.waits, [MISSING * 1000, MISSING * 1000]);
  assert.deepEqual(m.calls.map(c => c.path), [BASE + '/inbox', BASE + '/inbox', BASE + '/updates', BASE + '/inbox', BASE + '/updates']);
});

test('凭证续不上（401）就停，不再问；一回什么也没等到就回来了，至少隔 1 秒再问', async () => {
  const h = harness([INBOX, { ok: false, status: 401, data: null }, INBOX]);
  h.chat.start('boss');
  await settle();
  assert.deepEqual(h.calls.map(c => c.path), [BASE + '/inbox', BASE + '/updates']);
  const q = harness([INBOX, ok({ messages: [], cursor: 7, more: false }), ok({ messages: [], cursor: 8, more: true })]);
  q.chat.start('boss');
  await settle();
  assert.deepEqual(q.waits, [MIN_GAP], '回来得快又是空的：歇 1 秒；说了还有（more）就马上再要');
  assert.deepEqual(q.calls.slice(1).map(c => c.query.after), [7, 7, 8]);
});

test('退出登录、换人登录：旧的那一轮挂着的回来了也不认，不再问；数字清零', async () => {
  let release;
  const h = harness([INBOX, () => new Promise(r => { release = r; })]);
  h.chat.start('boss');
  await settle();
  assert.equal(h.chat.unread(), 2);
  h.chat.stop();
  assert.equal(h.chat.unread(), 0);
  release(ok({ messages: [msg(30, 'team_1', 'wang')], cursor: 30, more: false }));
  await settle();
  assert.equal(h.calls.length, 2);
  assert.equal(h.pushed.length, 0);
  assert.equal(h.notices.length, 0);
  h.chat.observe('POST', BASE + '/conversations/team_1/read', { body: { upToSeq: 7 } }, ok(true));
  assert.equal(h.chat.unread(), 0);
});

test('团队负责人：服务器硬盘快满了，首页一拿到就提醒一回', async () => {
  const warn = ok({ ...INBOX.data.data, storageWarning: { freeBytes: 3.5 * 1073741824, imagesBlocked: false } });
  const h = harness([warn]);
  h.chat.start('boss');
  await settle();
  assert.equal(h.notices.length, 1);
  assert.equal(h.notices[0].storage, true);
  assert.equal(h.notices[0].title, '服务器硬盘快满了');
  assert.match(h.notices[0].body, /只剩 3\.5 GB/);
  const full = harness([ok({ ...INBOX.data.data, storageWarning: { freeBytes: 0.5 * 1073741824, imagesBlocked: true } })]);
  full.chat.start('boss');
  await settle();
  assert.match(full.notices[0].body, /图片已经发不了了（文字照常）/);
});
