/* 镜头表每一镜的「作用」和「秒数」（2026-11-16 他定，照 通用工具/流水线/镜头表秒数和作用_设计稿.html）。
   作用：二十个字以内（连标签算），写成「标签｜目的，关系」。标签六个，页面画成色块，一列看下来就是这段戏的起伏；
     关系写跟它连得最紧的那一镜：「接镜N」「为镜N」，段头段尾「接上段」「引下段」。镜N 的 N 是镜头表的固定号（关键帧绑定.js）。
   秒数：每一镜一个整秒数，AI 提炼时照真人快慢估；人在提炼页改过的记「秒数人定」，AI 照批注改时照抄（批注说到秒数才改）。
   本机服务（jobs.js 交给 AI 的要求）、提炼页、写提示词勾镜头、镜头表小窗、流水线.js 并进 AI 提炼的，同一套。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShotWhy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MAX = 20;            // 作用最多几个字
  const ONE = 15, LONGEST = 30;   // 一条视频一般 15 秒；即梦最长 30 秒（和 秒数.js 的 MAX 一样）
  const TAGS = Object.freeze({ 交代: 'jd', 铺垫: 'pd', 转折: 'zz', 高潮: 'gc', 反应: 'fy', 收尾: 'sw' });   // 标签 → 色块的样式（流水线.css 的 .sw-t.jd……）
  const NAMES = Object.freeze(Object.keys(TAGS));
  const SAY = Object.freeze({ 交代: '让人知道谁、在哪、出了什么事，人物亮相也算', 铺垫: '给后面某一镜攒劲', 转折: '局面翻过来', 高潮: '这一段最狠、最爽的那一下，一段一般一个', 反应: '前面那一下落到人身上，看他怎么接', 收尾: '这段戏落下来，交给下一段' });
  const str = v => typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '';
  const TAG_RE = new RegExp('^(' + NAMES.join('|') + ')\\s*[｜|]\\s*');
  const REF_RE = /镜(?:头)?\s*0*([0-9]+)([a-z]?)(?![0-9a-z])/gi;

  /* 交给 AI 的要求（提炼、提炼按批注改共用）。how：镜N 的 N 怎么认 */
  const ruleWhy = how => '「作用」二十个字以内（连标签算），写成「标签｜目的，关系」：标签从' + NAMES.join('、') + '里挑一个（' + NAMES.map(n => n + '：' + SAY[n]).join('；') + '）；目的写观众看到、明白、觉得什么，不写怎么拍；关系写跟它连得最紧的那一镜（不一定挨着），只用「接镜N」（因为镜N 才有这一镜）、「为镜N」（给镜N 做准备），段头段尾可以写「接上段」「引下段」；' + how + '。像「铺垫｜阵地眼看守不住，为镜2救场」。';
  const RULE_SEC = '「秒数」照真人做事的快慢，给这个镜头估一个整秒数：说话照这个人平常的语速，动作照生活里的快慢；快动作别给多，时间给多了 Seedance 会把动作放慢。';

  /* 「铺垫｜阵地眼看守不住」→ { tag: '铺垫', rest: '阵地眼看守不住' }；没写标签的（老数据）tag 是 '' */
  function split(why) {
    const t = str(why).trim(), m = TAG_RE.exec(t);
    return m ? { tag: m[1], rest: t.slice(m[0].length).trim() } : { tag: '', rest: t };
  }
  const len = why => [...str(why).trim()].length;
  /* 作用里提到了哪几镜（号）。nos：镜头表的号，给了就只认表里有的 */
  function refs(why, nos) {
    const out = [];
    for (const m of str(why).matchAll(REF_RE)) { const n = +m[1] + m[2].toLowerCase(); if ((!nos || nos.includes(n)) && !out.includes(n)) out.push(n); }
    return out;
  }
  /* 作用里的镜N 换个号：to(N) 给新号，给空的不换。AI 重新提炼时按排第几写的，并进来以后换成镜头表的固定号 */
  const renum = (why, to) => str(why).replace(REF_RE, (all, n, l) => { const v = to(+n + l.toLowerCase()); return v ? all.replace(/[0-9]+[a-z]?$/i, v) : all; });
  /* 一镜的秒数：整秒，不到 1 秒算 1 秒；没估、不是数给 0 */
  const secOf = x => { const v = Number(x && typeof x === 'object' ? x.秒数 : x); return v > 0 && isFinite(v) ? Math.max(1, Math.round(v)) : 0; };
  /* 几镜一共几秒：{ total, missing（没估的几镜）, level: '' | 'long'（过了 15 秒）| 'over'（过了 30 秒）, say } */
  function sum(rows) {
    let total = 0, missing = 0;
    for (const x of rows || []) { const v = secOf(x); if (v) total += v; else missing++; }
    const level = total > LONGEST ? 'over' : total > ONE ? 'long' : '';
    const say = !total ? (missing ? '没估秒数' : '') : '约 ' + total + ' 秒' + (missing ? '（' + missing + ' 镜没估）' : '');
    return { total, missing, level, say };
  }
  /* 勾镜头写提示词时那一句 */
  function pickSay(rows) {
    const r = sum(rows);
    return { ...r, say: r.say + (r.level === 'over' ? '：超过 30 秒，一条装不下' : r.level === 'long' ? '：过了 15 秒（一条视频一般 15 秒）' : '') };
  }
  /* 镜头表顶上的色带：一镜一块，宽窄照秒数（没估的按平均）；每 15 秒一道线。给 { blocks: [{ i, tag, sec, w }], marks: [0～1] } */
  function strip(rows) {
    const list = rows || [], got = list.map(secOf), known = got.filter(Boolean), avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 3;
    const w = got.map(v => v || avg), all = w.reduce((a, b) => a + b, 0), marks = [];
    for (let t = ONE; known.length && all && t < all - 0.01; t += ONE) marks.push(t / all);   // 一镜都没估：不画线，免得猜的像真的
    return { blocks: list.map((x, i) => ({ i, tag: split(x && x.作用).tag, sec: got[i], w: all ? w[i] / all : 0 })), marks, total: known.length ? sum(list).total : 0 };
  }
  /* AI 改完并进来时：人改过的秒数照抄，除非这一镜的批注或整体批注说到了秒数。fresh 已经有号；old：原来的表，oldNos：它的号 */
  function keepSecs(fresh, old, oldNos, all) {
    const byNo = new Map();
    (old || []).forEach((o, i) => { if (o && oldNos[i]) byNo.set(String(oldNos[i]), o); });
    for (const x of fresh || []) {
      const o = byNo.get(str(x && x.号));
      if (!o || !o.秒数人定 || !secOf(o) || /秒/.test(str(o.批注) + '\n' + str(all))) continue;
      x.秒数 = secOf(o); x.秒数人定 = true;
    }
    return fresh;
  }
  /* AI 提炼的镜头表并进这一场，定下每一镜的号。照批注改的，AI 照抄了原来的号（新加的照规矩起，3b）：号都对、不重就用；
     重新提炼的没有号（或者号不对）：照 关键帧绑定.js 的 keepNos 留原来的号，作用里按排第几写的镜N 换成号。最后人改过的秒数照抄。SB：关键帧绑定.js */
  function merge(fresh, old, SB, all) {
    const oldNos = SB.nosOf(old || []), got = fresh.map(x => SB.normNo(x.号));
    if (fresh.length && got.every(Boolean) && new Set(got).size === got.length) fresh.forEach((x, i) => { x.号 = got[i]; });
    else {
      fresh.forEach(x => { delete x.号; });
      SB.keepNos(fresh, old || []);
      const nos = fresh.map(x => x.号);
      fresh.forEach(x => { x.作用 = renum(x.作用, k => /^[0-9]+$/.test(k) ? nos[+k - 1] || '' : ''); });
    }
    return keepSecs(fresh, old, oldNos, all);
  }
  /* 页面上画作用：色块＋后面那句。h：界面.js 的 h；cls：后面那句的样式 */
  function bits(why, h, cls) {
    const { tag, rest } = split(why);
    return [tag ? h('span', { class: 'sw-t ' + TAGS[tag], title: tag + '：' + SAY[tag] }, tag) : null, h('span', { class: cls || 'sw-r' }, rest)].filter(Boolean);
  }
  return Object.freeze({ MAX, ONE, LONGEST, TAGS, NAMES, SAY, ruleWhy, RULE_SEC, split, len, refs, renum, secOf, sum, pickSay, strip, keepSecs, merge, bits });
});
