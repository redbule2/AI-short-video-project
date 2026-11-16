/* 每镜几秒（2026-11-15 他定：AI 写提示词时顺手估，点「批准出片」时自动填好合计，他只看不算）。
   AI 写稿、照批注改稿时，回复里另起一块【秒数】，一镜一行「镜头1：2」；秒数不写进提示词。
   本机服务读出来，记在 资产/参考素材映射.json 这一条的「秒数」：{ 镜头: { '1': 2, … }, 记号, 时间 }；
   记号是估的那一刻整份提示词的指纹，稿子后来又改过（比如「进去改」手改了）就对不上，出片弹窗提醒「估完以后改过」。
   本机服务（jobs.js）、提示词那一步（提示词.html）同一套。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Secs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MIN = 4, MAX = 30;   // 即梦能填的时长
  const SHOT = /^\s*镜头\s*0*([0-9]+)\s*[：:]/;
  /* 交给 AI 的那句（写提示词、按批注改提示词共用） */
  const ASK = '回复最后另起一块【秒数】：照写好（改好）的整份提示词，给【事件脚本】里每一镜估一个整秒数，一镜一行，像「镜头1：2」。照真人做事的快慢估：说话照这个人平常的语速，动作照生活里的快慢；快动作别给多，时间给多了 Seedance 会把动作放慢。秒数只写在这一块，不写进提示词。';
  const ASK_EG = ['【秒数】', '镜头1：2', '镜头2：5'];
  /* 提示词里有哪几镜（照【事件脚本】里「镜头N：」开头的行，去掉重复，照先后） */
  function shotsOf(text) {
    const out = [];
    for (const l of String(text || '').split(/\r?\n/)) { const m = SHOT.exec(l); if (m && !out.includes(+m[1])) out.push(+m[1]); }
    return out;
  }
  /* AI 回复里的【秒数】：{ '1': 2, … }；没有这一块、一行都读不出给 null。小数四舍五入，不到 1 秒算 1 秒 */
  function parse(reply) {
    const t = String(reply || ''), a = t.indexOf('【秒数】');
    if (a < 0) return null;
    const rest = t.slice(a + 4), z = rest.search(/【[^】\n]{1,12}】/), body = z >= 0 ? rest.slice(0, z) : rest, out = {};
    for (const l of body.split(/\r?\n/)) {
      const m = /镜头\s*0*([0-9]+)\s*[：:]\s*([0-9]+(?:\.[0-9]+)?)/.exec(l);
      if (m) out[String(+m[1])] = Math.max(1, Math.round(+m[2]));
    }
    return Object.keys(out).length ? out : null;
  }
  /* 整份提示词的指纹（FNV-1a）：换行、开头的 BOM、末尾空白不算 */
  function mark(text) {
    const s = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return s.length + '-' + h.toString(16).padStart(8, '0');
  }
  /* 记下来的样子：只留提示词里有的那几镜。missing：提示词里有、AI 没估的镜 */
  function make(per, text, time) {
    const shots = shotsOf(text), got = {}, missing = [];
    for (const n of shots) { const v = per && per[String(n)]; if (v > 0) got[String(n)] = v; else missing.push(n); }
    return { rec: Object.keys(got).length ? { 镜头: got, 记号: mark(text), ...(time ? { 时间: time } : {}) } : null, missing };
  }
  const total = rec => rec && rec.镜头 ? Object.values(rec.镜头).reduce((x, y) => x + (+y || 0), 0) : 0;
  const fit = n => Math.min(MAX, Math.max(MIN, Math.round(n)));
  /* 弹窗里那一句：镜头1 2 秒、镜头2 5 秒，共 7 秒 */
  function say(rec) {
    if (!rec || !rec.镜头) return '';
    const ks = Object.keys(rec.镜头).sort((a, b) => a - b);
    return ks.map(k => '镜头' + k + ' ' + rec.镜头[k] + ' 秒').join('、') + '，共 ' + total(rec) + ' 秒';
  }
  /* 这份稿现在的样子对不对得上：fresh 估完没动过；changed 估完以后改过；missing 提示词里有的镜没估全 */
  function state(rec, text) {
    if (!rec || !rec.镜头) return { st: 'none' };
    const lack = shotsOf(text).filter(n => !(rec.镜头[String(n)] > 0));
    return { st: rec.记号 === mark(text) ? (lack.length ? 'missing' : 'fresh') : 'changed', lack };
  }
  return Object.freeze({ MIN, MAX, ASK, ASK_EG, shotsOf, parse, mark, make, total, fit, say, state });
});
