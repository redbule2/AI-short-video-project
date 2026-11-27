/* 出片前核对即梦账号和画布（jobs.js 用）：这个登录位登着，画布在这个号名下（canvas ls 列得出来才能改；列不出来的只能看）。
   11-14 出过一回：出片设置里的画布是奔跑号的，任务书写的是默认号，Codex 到了画布上才发现只能看。
   11-16 他嫌点「批准出片」到拿到提示词要等十几秒：三条命令一起跑（原来一条接一条，约 6 秒）；
   同一个号、同一张画布 10 分钟内核过就不再查（生成任务书、交给 AI 前各核一遍，原来两遍都真查）。没核过的不记。
   11-17 他要：项目还没写画布，就新建一张（jmCheck.create，不花积分），名字写项目名；jobs.js 把网址记进出片设置。
   写了网址、核对不过的（不在这个号名下、网址不对）照旧停下，不另建：多半是号或网址写错了。
   11-26 他要：原来的号没积分了，换个号出——jmCheck.list 列出那个号名下的画布给他挑（没有就用 create 新建一张）。 */
'use strict';
const { randomUUID } = require('crypto');
const PREFIX = 'https://jimeng.jianying.com/ai-tool/ai-canvas/';
module.exports = function ({ jm, fail, str, ttl = 10 * 60e3, now = Date.now, uuid = randomUUID }) {
  const seen = new Map();   // 登录位|画布 → { t, r }
  const made = new Map();   // 登录位|项目名 → 建好的（或正在建的）：同一个项目连点两回、两段一起批准，只建一张
  jmCheck.create = function (name, profile) {
    const nm = str(name).trim(), pf = str(profile);
    if (!nm) return Promise.reject(fail('新建画布要有名字'));
    if (!/^[A-Za-z0-9_-]{0,40}$/.test(pf)) return Promise.reject(fail('资产/出片设置.json 里的「登录位」名字不对：只能是字母、数字、横线，默认号留空'));
    const key = pf + '|' + nm;
    if (made.has(key)) return made.get(key);
    const id = uuid(), p = (async () => {   // 自己给画布编号：命令行回的话读不出编号，也认得出是哪一张
      const r = await jm([...(pf ? ['--profile', pf] : []), 'canvas', 'create', nm, '--project-id', id, '--format', 'json']);
      if (r.error) throw fail(r.error);
      const d = (r.data && r.data.data) || {}, got = str(d.projectId) || (/ai-canvas\/([0-9a-f-]{36})/i.exec(str(d.webUrl)) || [])[1] || id;
      if (!r.ok) throw fail('即梦新建画布没成：' + (r.raw || '没有回音').slice(0, 200));
      return { id: got, url: PREFIX + got, name: str(d.name) || nm };
    })();
    made.set(key, p);
    p.catch(() => made.delete(key));   // 没建成的不记，下回再试
    return p;
  };
  const NAME = /^[A-Za-z0-9_-]{0,40}$/;
  const lsOf = pf => cursor => jm([...pf, 'canvas', 'ls', '--limit', '100', '--format', 'json', ...(cursor ? ['--cursor', cursor] : [])]);   // 一页最多 100 张
  jmCheck.urlOf = id => PREFIX + str(id).toLowerCase();
  /* 这个号名下的画布：[{ id, name, url, 改于 }]，新改的在前（翻到底，最多 20 页） */
  jmCheck.list = async function (profile) {
    const pf = str(profile);
    if (!NAME.test(pf)) throw fail('登录位的名字只能是字母、数字、横线');
    const ls = lsOf(pf ? ['--profile', pf] : []), out = [];
    let r = await ls('');
    for (let i = 0; i < 20; i++) {
      const d = r.data && r.data.data;
      if (r.error || !r.ok || !d || !Array.isArray(d.items)) throw fail('查不到即梦' + (pf ? '登录位「' + pf + '」' : '默认号') + '名下有哪些画布：' + (r.error || r.raw || '没有回音').slice(0, 200));
      for (const x of d.items) if (x && x.projectId) out.push({ id: str(x.projectId), name: str(x.name), url: PREFIX + x.projectId, 改于: Number(x.updatedAt) || 0 });
      if (!d.hasMore || !d.nextCursor) break;
      r = await ls(d.nextCursor);
    }
    return out.sort((a, b) => b.改于 - a.改于);
  };
  return jmCheck;
  async function jmCheck(canvasUrl, profile) {
    const id = (/ai-canvas\/([0-9a-f-]{36})/i.exec(str(canvasUrl)) || [])[1];
    if (!id) throw fail('资产/出片设置.json 里没写画布，或者画布网址不对（要 https://jimeng.jianying.com/ai-tool/ai-canvas/… 这种）');
    if (!/^[A-Za-z0-9_-]{0,40}$/.test(profile)) throw fail('资产/出片设置.json 里的「登录位」名字不对：只能是字母、数字、横线，默认号留空');
    const key = profile + '|' + id, old = seen.get(key);
    if (old && now() - old.t < ttl) return old.r;
    const pf = profile ? ['--profile', profile] : [], who = profile ? '登录位「' + profile + '」' : '默认号';
    const ls = lsOf(pf);
    const [st, ac, first] = await Promise.all([jm([...pf, 'auth', 'status']), jm([...pf, 'auth', 'account']), ls('')]);
    if (st.error) throw fail(st.error);
    if (!(st.data && st.data.data && st.data.data.loggedIn)) throw fail('即梦' + who + '没登录：先到首页「即梦授权」登录');
    const nick = str(((ac.data || {}).data || {}).displayName) || '读不出昵称';
    let r = first, hit = null;
    for (let i = 0; i < 20; i++) {   // 一页最多 100 张，翻到底
      const d = r.data && r.data.data;
      if (!r.ok || !d || !Array.isArray(d.items)) throw fail('查不到即梦' + who + '名下有哪些画布：' + (r.error || r.raw || '没有回音').slice(0, 200));
      hit = d.items.find(x => x && x.projectId === id) || null;
      if (hit || !d.hasMore || !d.nextCursor) break;
      r = await ls(d.nextCursor);
    }
    if (!hit) throw fail('画布 ' + id.slice(0, 8) + ' 不在即梦' + who + '（' + nick + '）名下，这个号只能看、不能改。资产/出片设置.json 里的「画布」和「登录位」要是同一个号的');
    const out = { id, nick, name: str(hit.name) || id.slice(0, 8) };
    seen.set(key, { t: now(), r: out });
    return out;
  };
};
