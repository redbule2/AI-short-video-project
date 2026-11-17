/* 公用 · 审片台里一镜的秒数和关键帧（审片台.html 用；测试 测试\审片关键帧_测试.cjs）。
   2026-11-16 加：他审 3-4 第17条（1.txt）时右边关键帧不出来。正文没写秒数，审片台不知道哪一秒是哪一镜；
   一镜又挂了开头、中间、结尾三张，原来一镜只认一张开头的。
   秒数：正文没写，照 资产/参考素材映射.json 这一条登记的「秒数」（写稿时估的一镜几秒），从第 0 秒一镜接一镜排。
   关键帧：登记名「关键帧｜镜头1｜开头」（公用/关键帧绑定.js 的 regName）认是哪一镜哪一刻。
     开头在这一镜开头，结尾在这一镜最后；中间照「@图片4定义第二个关键帧：第2秒……」里写的第几秒，没写就匀着摆在中间。
   放到哪一秒旁边摆哪一张：每张从它那一刻起；结尾那张从前一张和这一镜结尾的正中间起。 */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./关键帧写法.js') : root.KeyFrames);
  if (node) module.exports = api;
  else root.DeskFrames = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (KeyFrames) {
  'use strict';
  const RANK = { 开头: 0, 中间: 1, 结尾: 2 };
  const RE_NAME = /^关键帧｜镜头([0-9A-Za-z]+)｜(开头|中间|结尾)$/;
  const num = ref => +String(ref).replace(/\D+/g, '') || 0;

  /* 正文一镜都没写秒数：照登记的秒数排。secs：{ 镜头: { '1': 4, … } }。每一镜都有秒数才排，排了给 true */
  function fillSecs(shots, secs) {
    const m = secs && secs.镜头;
    if (!shots.length || !m || typeof m !== 'object' || shots.some(s => s.a != null || s.b != null)) return false;
    const n = shots.map(s => +m[String(s.no)]);
    if (n.some(x => !(x > 0))) return false;
    let t = 0;
    shots.forEach((s, i) => { s.a = t; t += n[i]; s.b = t; });
    return true;
  }

  /* 中间那张写的第几秒：先当整条片子里的第几秒，不在这一镜里就当这一镜开头往后数 */
  const secIn = (desc, s) => {
    const m = /第\s*(\d+(?:\.\d+)?)\s*秒/.exec(String(desc || ''));
    if (!m || s.a == null) return null;
    const x = +m[1];
    return x >= s.a && x <= s.b ? x : s.a + x <= s.b ? s.a + x : null;
  };
  /* 一镜的几张排好时刻：t 这一张管的那一刻，from 旁边从第几秒起摆它（没秒数的都是 null） */
  function place(list, s) {
    list.sort((x, y) => RANK[x.刻] - RANK[y.刻] || num(x.ref) - num(y.ref));
    const timed = s.a != null && s.b != null;
    const mids = list.filter(x => x.刻 === '中间');
    for (const x of list) x.t = !timed ? null : x.刻 === '开头' ? s.a : x.刻 === '结尾' ? s.b : secIn(x.desc, s);
    const free = mids.filter(x => x.t == null);
    if (timed) free.forEach((x, k) => { x.t = s.a + (s.b - s.a) * (k + 1) / (free.length + 1); });
    if (timed) list.sort((x, y) => x.t - y.t || RANK[x.刻] - RANK[y.刻]);
    list.forEach((x, k) => { x.from = !timed ? null : x.刻 === '结尾' && k ? (list[k - 1].t + s.b) / 2 : k ? x.t : s.a; });
    list.forEach(x => { delete x.desc; });
    return list;
  }

  /* 每一镜挂的关键帧：[[{ ref, 刻, t, from }]]，和 shots 一一对应。
     refs：这条挂的素材 [{ ref, name }]；text：提示词全文（读「定义第几个关键帧：第2秒……」）。
     登记名不是「关键帧｜镜头N｜…」的不认，审片台照原来的办法认（文件名里的镜头号） */
  function framesOf(shots, refs, text) {
    const desc = KeyFrames.scan(String(text || '').split(/\r\n|\n|\r/)).desc;
    const out = shots.map(() => []);
    for (const r of refs || []) {
      const m = RE_NAME.exec(String((r && r.name) || '').trim());
      if (!m) continue;
      const i = shots.findIndex(s => String(s.no) === m[1]);
      if (i >= 0 && !out[i].some(x => x.ref === r.ref)) out[i].push({ ref: r.ref, 刻: m[2], desc: desc.get(r.ref) || '' });
    }
    return out.map((list, i) => place(list, shots[i]));
  }

  /* 放到第 t 秒，这一镜旁边摆哪一张：从它那一刻起管；没秒数（t 是 null）摆 pin 那张，没有 pin 摆头一张 */
  function pick(list, t, pin) {
    if (!list || !list.length) return null;
    if (t == null) return list.find(x => x.ref === pin) || list[0];
    let cur = list[0];
    for (const x of list) if (x.from != null && t + 1e-6 >= x.from) cur = x;
    return cur;
  }

  /* 图下面那一句：开头、中间（第2秒）、结尾 */
  const label = x => x.刻 + (x.刻 === '中间' && x.t != null ? '（第' + Math.round(x.t * 10) / 10 + '秒）' : '');

  return Object.freeze({ fillSecs, framesOf, place, pick, label });
});
