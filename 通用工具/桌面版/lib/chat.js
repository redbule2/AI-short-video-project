'use strict';
/* 团队聊天（2026-11-26）：壳子在后台一直等新消息——数没看的条数（左边菜单「消息」上的数字），
   软件不在眼前时右下角提醒，把新消息转给「消息」那一页（页面自己不等新消息）。
   后台在 new-video8-8 的 CollaborationChatController：GET inbox 拿到各会话没看的条数和从哪条往后等，
   再一回接一回 GET updates?after=…&wait=25（没新消息时服务器挂住最多 25 秒）。
   问服务器的次数：登录后 1 次（聊天首页）；之后同一时间只挂着 1 个等新消息的请求；
   要提醒时发消息的人名字不认识，才问 1 次团队名单（5 分钟内最多 1 次）。
   连不上隔 2、5、10、30、60 秒再试；服务器还没有聊天（404）十分钟看一眼；凭证续不上（401）就停，main.js 那头回登录页。
   页面标了已读（POST …/read 成功）main.js 经 observe() 告诉这里，数字跟着减。 */
const BASE = '/api/collaboration/chat';
const WAIT = 25;                       // 秒：服务器最多挂这么久（后台 TeamChatRules.MaxWaitSeconds）
const RETRY = [2, 5, 10, 30, 60];      // 秒：连不上时隔多久再试，一回比一回久
const MISSING = 600;                   // 秒：服务器还没有聊天（后台没升级）时，隔多久再看
const MIN_GAP = 1000;                  // 毫秒：一回什么也没等到就回来了（被别人的私聊叫醒），至少隔这么久再问，免得空转
const NAME_EVERY = 5 * 60e3;           // 毫秒：团队名单最多这么久问一回
const READ = new RegExp('^' + BASE + '/conversations/([^/]+)/read$');

const low = s => String(s || '').toLowerCase();
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
/* 提醒里写的那一句：图片写「[图片]」，字的把换行换成空格 */
const preview = m => (m.kind === 'image' ? '[图片]' : String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 60));

/* ask：问服务器（main.js 的 serverApi，回 { ok, status, data }）；onChange：没看的条数变了；
   onMessages：收到新消息（转给页面）；onNotice：要提醒 { title, body, conversationId, count, storage } */
function makeChat({ ask, log, onChange = () => {}, onMessages = () => {}, onNotice = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), now = () => Date.now() }) {
  let run = 0, on = false;     // 第几轮：退出登录、换人登录时换一轮，旧的那一轮自己停；on：现在在不在等
  let me = '', teamId = '';
  let convs = new Map();       // 会话ID → { kind, peer, base（首页给的没看条数）, baseSeq（那时最后一条）, fresh（后来到的、没看的顺序号）, readSeq }
  let names = new Map(), namesAt = -Infinity;

  const entry = id => {
    let c = convs.get(id);
    if (!c) { c = { kind: id === teamId ? 'team' : 'direct', peer: '', base: 0, baseSeq: 0, fresh: new Set(), readSeq: 0 }; convs.set(id, c); }
    return c;
  };
  const unread = () => { let n = 0; for (const c of convs.values()) n += c.base + c.fresh.size; return n; };
  const nameOf = u => names.get(low(u)) || u;

  function takeInbox(d) {
    me = d.currentUsername || me;
    const old = convs;
    convs = new Map();
    for (const c of d.conversations || []) {
      if (c.kind === 'team') teamId = c.id;
      const was = old.get(c.id);
      convs.set(c.id, { kind: c.kind, peer: c.peerUsername || '', base: Math.max(0, Math.trunc(num(c.unread))), baseSeq: num(c.lastSeq), fresh: new Set(), readSeq: Math.max(num(c.readSeq), was ? was.readSeq : 0) });
    }
    for (const [id, c] of old) if (!convs.has(id)) convs.set(id, { ...c, base: 0, baseSeq: 0, fresh: new Set() });   // 首页里还没有、页面已经读过的：读到哪留着
    onChange();
    if (d.storageWarning) {   // 只有团队负责人拿得到：硬盘快满了
      const gb = (num(d.storageWarning.freeBytes) / 1073741824).toFixed(1);
      onNotice({ storage: true, title: '服务器硬盘快满了', body: d.storageWarning.imagesBlocked ? `只剩 ${gb} GB，聊天里的图片已经发不了了（文字照常）。请清理服务器或加硬盘。` : `只剩 ${gb} GB。剩不到 1 GB 时聊天里的图片就发不了了（文字照常）。`, conversationId: '', count: 0 });
    }
    return num(d.cursor);
  }

  async function loadNames(id) {
    if (now() - namesAt < NAME_EVERY) return;
    namesAt = now();
    const r = await ask('GET', '/api/collaboration/team');
    if (id !== run || !r.ok || !r.data || r.data.success !== true || !r.data.data) return;
    names = new Map((r.data.data.members || []).map(m => [low(m.username), m.displayName || m.username]));
  }

  /* 一批新消息：别人发的、还没看的记下来；要提醒的拼成一句 */
  async function take(list, id) {
    const fresh = [];
    for (const m of list) {
      const c = entry(m.conversationId);
      const mine = low(m.sender) === low(me);
      if (c.kind === 'direct' && !c.peer && !mine) c.peer = m.sender;
      if (mine || m.seq <= c.readSeq || m.seq <= c.baseSeq || c.fresh.has(m.seq)) continue;
      c.fresh.add(m.seq);
      fresh.push(m);
    }
    onMessages(list);
    if (!fresh.length) return;
    onChange();
    if (fresh.some(m => !names.has(low(m.sender)))) await loadNames(id);
    if (id !== run) return;
    const last = fresh[fresh.length - 1];
    const where = new Set(fresh.map(m => m.conversationId));
    const who = [...new Set(fresh.map(m => nameOf(m.sender)))];
    let title, body;
    if (where.size === 1) {
      title = (last.conversationId === teamId ? '全员群 · ' : '') + nameOf(last.sender);
      body = fresh.length === 1 ? preview(last) : `${fresh.length} 条新消息：${preview(last)}`;
    } else {
      title = '新消息';
      body = `${who.slice(0, 3).join('、')}${who.length > 3 ? ' 等' : ''}发来 ${fresh.length} 条新消息`;
    }
    onNotice({ title, body, conversationId: last.conversationId, count: fresh.length });
  }

  /* 一直等新消息，直到换了一轮 */
  async function loop(id) {
    let cursor = null, fails = 0;
    const retry = async (status, what) => {
      const sec = status === 404 ? MISSING : RETRY[Math.min(fails++, RETRY.length - 1)];
      if (status === 404) log.info('服务器上还没有聊天，过一会儿再看');
      else log.warn(what + '没成，过一会儿再试', { status, 秒: sec });
      await sleep(sec * 1000);
    };
    while (id === run) {
      if (cursor === null) {
        const r = await ask('GET', BASE + '/inbox');
        if (id !== run) return;
        if (r.status === 401) return;
        if (!r.ok || !r.data || r.data.success !== true || !r.data.data) { await retry(r.status, '聊天首页'); continue; }
        fails = 0;
        cursor = takeInbox(r.data.data);
        continue;
      }
      const t0 = now();
      const r = await ask('GET', BASE + '/updates', { query: { after: cursor, wait: WAIT } });
      if (id !== run) return;
      if (r.status === 401) return;
      if (!r.ok || !r.data || r.data.success !== true || !r.data.data) {
        if (r.status === 404) cursor = null;   // 后台退回了没有聊天的版本：回头从首页重来
        await retry(r.status, '等新消息');
        continue;
      }
      fails = 0;
      const d = r.data.data, list = Array.isArray(d.messages) ? d.messages : [];
      if (list.length) await take(list, id);
      if (id !== run) return;
      cursor = Math.max(cursor, num(d.cursor));
      if (!d.more && !list.length && now() - t0 < MIN_GAP) await sleep(MIN_GAP);
    }
  }

  function stop() {
    run++;
    on = false;
    me = ''; teamId = '';
    convs = new Map();
    names = new Map(); namesAt = -Infinity;
    onChange();
  }

  return {
    /* 登录了（或续上了登录）：开始等新消息 */
    start(username) {
      stop();
      me = username || '';
      on = true;
      const id = run;
      loop(id).catch(e => log.error('聊天收消息出错', e));
    },
    stop,
    /* 一共几条没看 */
    unread,
    /* main.js 替页面问完服务器告诉这里：页面标了已读，数字跟着减 */
    observe(method, pathname, opts, r) {
      const m = READ.exec(String(pathname || ''));
      if (!m || String(method || '').toUpperCase() !== 'POST' || !r || !r.ok || !r.data || r.data.success !== true || !on) return;
      const upTo = num(opts && opts.body && opts.body.upToSeq);
      const c = entry(decodeURIComponent(m[1]));
      const before = c.base + c.fresh.size;
      c.readSeq = Math.max(c.readSeq, upTo);
      if (upTo >= c.baseSeq) c.base = 0;
      for (const s of [...c.fresh]) if (s <= upTo) c.fresh.delete(s);
      if (c.base + c.fresh.size !== before) onChange();
    },
  };
}

module.exports = { makeChat, BASE, WAIT, RETRY, MISSING, MIN_GAP, NAME_EVERY };
