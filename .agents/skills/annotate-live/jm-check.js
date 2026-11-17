/* 出片前核对即梦账号和画布（jobs.js 用）：这个登录位登着，画布在这个号名下（canvas ls 列得出来才能改；列不出来的只能看）。
   11-14 出过一回：出片设置里的画布是奔跑号的，任务书写的是默认号，Codex 到了画布上才发现只能看。
   11-16 他嫌点「批准出片」到拿到提示词要等十几秒：三条命令一起跑（原来一条接一条，约 6 秒）；
   同一个号、同一张画布 10 分钟内核过就不再查（生成任务书、交给 AI 前各核一遍，原来两遍都真查）。没核过的不记。 */
'use strict';
module.exports = function ({ jm, fail, str, ttl = 10 * 60e3, now = Date.now }) {
  const seen = new Map();   // 登录位|画布 → { t, r }
  return async function jmCheck(canvasUrl, profile) {
    const id = (/ai-canvas\/([0-9a-f-]{36})/i.exec(str(canvasUrl)) || [])[1];
    if (!id) throw fail('资产/出片设置.json 里没写画布，或者画布网址不对（要 https://jimeng.jianying.com/ai-tool/ai-canvas/… 这种）');
    if (!/^[A-Za-z0-9_-]{0,40}$/.test(profile)) throw fail('资产/出片设置.json 里的「登录位」名字不对：只能是字母、数字、横线，默认号留空');
    const key = profile + '|' + id, old = seen.get(key);
    if (old && now() - old.t < ttl) return old.r;
    const pf = profile ? ['--profile', profile] : [], who = profile ? '登录位「' + profile + '」' : '默认号';
    const ls = cursor => jm([...pf, 'canvas', 'ls', '--limit', '100', '--format', 'json', ...(cursor ? ['--cursor', cursor] : [])]);
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
