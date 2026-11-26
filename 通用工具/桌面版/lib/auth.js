'use strict';
/* 登录 video8 的服务器（new-video8-8 后端 AuthController；地址在 main.js 的 API，现在直接连 IP）：
   POST /api/auth/login 带 { username, password }；/api/auth/register 多带 ownerUsername（团队负责人的账号）；/api/auth/refresh-token 带 { refreshToken }
   回的都是 { success, message, data }；账号密码不对、账号停用、凭证过期也是 200 + success:false。
   规矩：账号、密码不许空，注册要再输一遍密码、还要填对一个团队（注册完是这个团队的成员，不能自己新建团队）。
   凭证只存本机、加密存（开发规范第 16 条）；页面要问服务器（考试、团队）经 api() 走，凭证不给页面。 */
const OFFLINE_DAYS = 7;   // 连不上服务器时：上回联网登录成功 7 天之内照样能用
const API_OK = ['/api/exam/', '/api/collaboration/'];   // 页面能经 api() 问的只有这两块
const CRLF = String.fromCharCode(13, 10);
const SLOW = 120000;   // 毫秒：传图、拿图等这么久（别的 10 秒，main.js 里定的）
const LONG = { '/api/collaboration/chat/updates': 40000 };   // 等新消息：服务器最多挂 25 秒才回，这边多等一截

const KEEP = ['accessToken', 'refreshToken', 'expires', 'username', 'nickname', 'avatar', 'accountType', 'ownerUsername'];
const pick = d => Object.fromEntries(KEEP.filter(k => d && d[k] != null).map(k => [k, d[k]]));
const who = s => (s ? { username: s.username || '', nickname: s.nickname || s.username || '', avatar: s.avatar || '', accountType: s.accountType || '', ownerUsername: s.ownerUsername || '', offline: !!s.offline } : null);

/* 启动时续期的结果 r 出来以后怎么办：saved 是本机存的那份 */
function decide(saved, r, now) {
  if (!saved || !saved.refreshToken) return { ok: false, why: '' };
  if (r.ok) return { ok: true, saved: { ...saved, ...pick(r.data), lastOk: now } };
  if (r.offline) {
    if ((saved.lastOk || 0) + OFFLINE_DAYS * 864e5 > now) return { ok: true, offline: true, saved };
    return { ok: false, keep: true, why: `连不上服务器，离上回联网登录已过 ${OFFLINE_DAYS} 天。联上网再开，或者重新登录。` };
  }
  return { ok: false, why: r.message || '登录过期了，请重新登录' };
}

/* 传一张图（考试的题图、答题图）：拼成表单的样子，字段名 file */
function multipart(file) {
  const boundary = '----antou' + Date.now().toString(16) + Math.random().toString(16).slice(2);
  const name = [...String(file.name || 'file')].map(c => (c === '"' || c.charCodeAt(0) < 32 ? '_' : c)).join('');
  const head = `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${name}"${CRLF}Content-Type: ${file.type || 'application/octet-stream'}${CRLF}${CRLF}`;
  return { type: 'multipart/form-data; boundary=' + boundary, body: Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(file.bytes), Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8')]) };
}

/* fetch：主进程里用 Electron 的 net.fetch（走系统代理）；store：读、写、删本机加密存的那份 */
function makeAuth({ api, fetch, store, log, now = () => Date.now() }) {
  async function call(pathname, body) {
    let res;
    try {
      res = await fetch(api + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    } catch (e) {
      log.warn('连不上服务器', { path: pathname, error: String(e && e.message || e) });
      return { ok: false, offline: true, message: '连不上服务器，看看网络' };
    }
    let j = null;
    try { j = await res.json(); } catch (e) { /* 不是 JSON */ }
    if (!res.ok) {
      log.warn('服务器回了 ' + res.status, { path: pathname, message: j && j.message });
      return { ok: false, offline: res.status >= 500, message: (j && j.message) || `服务器出错了（${res.status}），稍后再试` };
    }
    if (!j || j.success !== true || !j.data) return { ok: false, message: (j && j.message) || '服务器的回答看不懂' };
    return { ok: true, data: j.data, message: j.message || '' };
  }

  async function enter(kind, username, password, again, team) {
    const u = String(username || '').trim();
    if (!u) return { ok: false, message: '请输入账号' };
    if (!password) return { ok: false, message: '请输入密码' };
    const body = { username: u, password };
    if (kind === 'register') {
      if (password !== again) return { ok: false, message: '两次输入的密码不一致' };
      body.ownerUsername = String(team || '').trim();
      if (!body.ownerUsername) return { ok: false, message: '请输入团队' };
    }
    const r = await call(kind === 'register' ? '/api/auth/register' : '/api/auth/login', body);
    if (!r.ok) return { ok: false, message: r.message };
    const saved = { ...pick(r.data), lastOk: now() };
    store.write(saved);
    log.info(kind === 'register' ? '注册并登录了' : '登录了', { username: saved.username });
    return { ok: true, user: who(saved) };
  }

  /* 用着用着凭证过期了：续一回。同时好几个请求过期也只续一回。回 true 续上了、false 续不上（要重新登录）、null 连不上 */
  let renewing = null;
  function renew() {
    if (!renewing) renewing = (async () => {
      const saved = store.read();
      if (!saved || !saved.refreshToken) return false;
      const r = await call('/api/auth/refresh-token', { refreshToken: saved.refreshToken });
      if (r.ok) store.write({ ...saved, ...pick(r.data), lastOk: now() });
      return r.ok ? true : r.offline ? null : false;
    })().finally(() => { renewing = null; });
    return renewing;
  }

  /* 替页面问服务器：method、路径、{ query, body, file, binary }。回 { ok, status, data }；status 0 连不上，401 要重新登录。
     binary：要的是一张图（聊天里的图片），回的 data 是 { type, bytes } */
  async function ask(method, pathname, opts, again) {
    const saved = store.read();
    if (!saved || !saved.accessToken) return { ok: false, status: 401, data: null };
    const q = new URLSearchParams(Object.entries((opts && opts.query) || {}).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString();
    const init = { method, headers: { Accept: opts && opts.binary ? '*/*' : 'application/json', Authorization: 'Bearer ' + saved.accessToken } };
    if (LONG[pathname]) init.timeout = LONG[pathname];
    if (opts && opts.binary) init.timeout = SLOW;
    if (opts && opts.file) {
      const m = multipart(opts.file);
      init.headers['Content-Type'] = m.type;
      init.body = m.body;
      init.timeout = SLOW;
    } else if (opts && opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    let res;
    try { res = await fetch(api + pathname + (q ? '?' + q : ''), init); }
    catch (e) {
      log.warn('连不上服务器', { path: pathname, error: String(e && e.message || e) });
      return { ok: false, status: 0, data: null };
    }
    if (res.status === 401 && !again) {
      const ok = await renew();
      if (ok) return ask(method, pathname, opts, true);
      if (ok === null) return { ok: false, status: 0, data: null };
    }
    if (opts && opts.binary && res.ok) {
      try { return { ok: true, status: res.status, data: { type: (res.headers && res.headers.get('content-type')) || '', bytes: new Uint8Array(await res.arrayBuffer()) } }; }
      catch (e) { log.warn('图没拿全', { path: pathname, error: String(e && e.message || e) }); return { ok: false, status: 0, data: null }; }
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 不是 JSON */ }
    if (!res.ok) log.warn('服务器回了 ' + res.status, { path: pathname, message: data && data.message });
    return { ok: res.ok, status: res.status, data };
  }

  return {
    login: (u, p) => enter('login', u, p),
    register: (u, p, again, team) => enter('register', u, p, again, team),
    /* 启动时：本机有存着的就续期；连不上服务器的按 7 天宽限 */
    async resume() {
      const saved = store.read();
      if (!saved || !saved.refreshToken) return { ok: false, why: '' };
      const r = await call('/api/auth/refresh-token', { refreshToken: saved.refreshToken });
      const d = decide(saved, r, now());
      if (d.ok && !d.offline) store.write(d.saved);
      if (!d.ok && !d.keep) store.remove();
      if (d.ok) log.info(d.offline ? '连不上服务器，按上回的登录接着用' : '续上了登录', { username: saved.username });
      else log.info('要重新登录', { why: d.why });
      return d.ok ? { ok: true, user: who({ ...(d.saved || saved), offline: !!d.offline }) } : { ok: false, why: d.why };
    },
    /* 页面（考试、团队、消息）、壳子收消息（lib/chat.js）问服务器：只许 API_OK 里的地址 */
    api(method, pathname, opts) {
      const m = String(method || '').toUpperCase(), p = String(pathname || '');
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m) || !API_OK.some(x => p.startsWith(x)) || p.includes('..') || /[?#]/.test(p)) {
        log.warn('拦下了页面要问的地址', { method: m, path: p });
        return Promise.resolve({ ok: false, status: 400, data: { success: false, message: '这个地址不许问' } });
      }
      return ask(m, p, opts);
    },
    logout() { store.remove(); log.info('退出登录'); },
    user: () => who(store.read()),
  };
}

module.exports = { makeAuth, decide, multipart, OFFLINE_DAYS };
