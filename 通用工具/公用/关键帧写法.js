/* 关键帧的写法（sd25-pe「关键帧锚点」）：流水线「提示词」那一步挂关键帧、写稿页 @ 关键帧图，用同一套（2026-11-13 夜加）。
   一张：「@图片N作为首帧。」「该首帧定义……。」（名字带「尾帧」的当尾帧）。
   几张：先写「以@图片A至@图片B的顺序作为关键帧。」（编号不连着就用顿号一个个列），第一张首帧，中间「@图片N定义第几个关键帧：……。」，
     最后一张名字带「尾帧」的当尾帧。
   〔〕里是留给人填的空；重排的时候，原来填过的（这一张定义了什么）照旧带上。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KeyFrames = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const D = '〇一二三四五六七八九';
  const cn = n => n < 10 ? D[n] : (n >= 20 ? D[Math.floor(n / 10)] : '') + '十' + (n % 10 ? D[n % 10] : '');
  const ORDER = /^以@图片\d+(?:(?:至|、)@图片\d+)+的顺序作为关键帧。?$/;
  const END = /^(@图片\d+)作为([首尾])帧。?$/;
  const MID = /^(@图片\d+)定义(?:第[〇一二三四五六七八九十]+个|〔[^〔〕]*〕)关键帧[：:](.*?)。?$/;
  const PH = { 首: '〔视频开始时的构图、人物位置、姿态和镜头方向〕', 尾: '〔视频结束时的构图、人物位置、姿态和镜头方向〕', 中: '〔这一刻看得见的状态〕' };
  const noOf = name => { const m = /(?:镜头|段落)\s*0*([0-9]+)/.exec(String(name)); return m ? +m[1] : null; };
  const rank = name => /尾帧/.test(name) ? 2 : /首帧/.test(name) ? 0 : 1;
  /* 先后：名字里有镜头号的按镜头号（同一镜：首帧、关键帧、尾帧）；没有号的，首帧排最前、尾帧排最后、别的排在有号的后面，照原来的先后 */
  function order(items) {   // items：[{ name, … }]
    const key = (x, i) => { const n = noOf(x.name), k = rank(x.name); return [n != null ? n : k === 0 ? -1 : k === 2 ? 1e9 : 1e8, k, i]; };
    return items.map((x, i) => ({ x, k: key(x, i) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]).map(o => o.x);
  }
  /* 哪几行是关键帧的句子：顺序句、首帧尾帧的角色句（连同紧跟着的「该…帧定义」）、「定义第几个关键帧」。
     返回 refs：出现的先后；desc：编号 → 定义了什么；rows：行号 → 编号（顺序句是 ''） */
  function scan(lines) {
    const refs = [], desc = new Map(), rows = new Map(), t = i => String(lines[i] == null ? '' : lines[i]).trim();
    for (let i = 0; i < lines.length; i++) {
      const s = t(i);
      if (ORDER.test(s)) { rows.set(i, ''); continue; }
      let m = END.exec(s);
      if (m) {
        rows.set(i, m[1]); if (!refs.includes(m[1])) refs.push(m[1]);
        const d = new RegExp('^该' + m[2] + '帧定义(.*?)。?$').exec(t(i + 1));
        if (d) { rows.set(i + 1, m[1]); desc.set(m[1], d[1]); i++; }
        continue;
      }
      m = MID.exec(s);
      if (m) { rows.set(i, m[1]); if (!refs.includes(m[1])) refs.push(m[1]); desc.set(m[1], m[2]); }
    }
    return { refs, desc, rows };
  }
  /* 照 sd25-pe 写一组。list：排好先后的 [{ ref, name, desc }]；desc 空着或者只是一个〔〕，就放这个位置该填什么的提示 */
  function lines(list) {
    const out = [];
    if (!list.length) return out;
    if (list.length > 1) {
      const nos = list.map(x => +String(x.ref).replace(/\D+/g, '')), run = nos.every((n, i) => !i || n === nos[i - 1] + 1);
      out.push('以' + (run ? list[0].ref + '至' + list[list.length - 1].ref : list.map(x => x.ref).join('、')) + '的顺序作为关键帧。');
    }
    list.forEach((x, i) => {
      const tail = /尾帧/.test(x.name || '');
      const role = list.length === 1 ? (tail ? '尾' : '首') : i === 0 ? '首' : i === list.length - 1 && tail ? '尾' : '中';
      const d = x.desc && !/^〔[^〔〕]*〕$/.test(x.desc) ? x.desc : PH[role];
      if (role === '中') out.push(x.ref + '定义第' + cn(i + 1) + '个关键帧：' + d + '。');
      else out.push(x.ref + '作为' + role + '帧。', '该' + role + '帧定义' + d + '。');
    });
    return out;
  }
  /* 这一组里每一张当什么：首帧、尾帧、第几个关键帧（弹窗里给人看） */
  const roleOf = (list, i) => { const tail = /尾帧/.test(list[i].name || ''); return list.length === 1 ? (tail ? '尾帧' : '首帧') : i === 0 ? '首帧' : i === list.length - 1 && tail ? '尾帧' : '第' + cn(i + 1) + '个关键帧'; };
  /* 稿子里的组名（【参考素材职责】这种一行）：空白不算；第 i 行的组名底下没句子了 */
  const headKey = l => String(l == null ? '' : l).replace(/\s+/g, '');   // \s 也认开头的 BOM
  const isHead = l => /^【[^】]+】$/.test(headKey(l));
  const groupEmpty = (L, i) => { const n = L[i + 1]; return n === undefined || !n.trim() || isHead(n); };
  /* 往素材那一组里放几句（L 一行一项，原地改，也返回 L）；没有这一组就补上组名。
     put（关键帧句子）：写法二放【场景】最前面，写法一放【参考素材职责】最前面；
     putRef（白模这类别的素材）：写法二（有【人物】【道具】【场景】的）放【动作与声音】最后，写法一放【参考素材职责】最后 */
  function putIn(L, add, two, head, after, ends) {
    if (!add.length) return L;
    const g = L.findIndex(l => headKey(l) === head);
    if (g >= 0) {
      let k = g + 1;
      if (ends) while (k < L.length && L[k].trim() && !isHead(L[k])) k++;   // 这一组最后一句的后面
      L.splice(k, 0, ...add);
      return L;
    }
    let k = L.findIndex(l => after.test(headKey(l)));
    if (k < 0) k = L.length;
    L.splice(k, 0, head, ...add, '');
    return L;
  }
  const has = (L, heads) => heads.some(h => L.some(l => headKey(l) === h));
  function put(L, add) {
    const two = has(L, ['【人物】', '【道具】', '【场景】', '【动作与声音】']);
    return putIn(L, add, two, two ? '【场景】' : '【参考素材职责】', two ? /^【(动作与声音|未采用素材|主体与关系|事件脚本|保持一致)】$/ : /^【(未采用素材|主体与关系|事件脚本|保持一致)】$/, false);
  }
  function putRef(L, add) {
    const two = has(L, ['【人物】', '【道具】', '【场景】']);
    return putIn(L, add, two, two ? '【动作与声音】' : '【参考素材职责】', two ? /^【(未采用素材|事件脚本|保持一致)】$/ : /^【(未采用素材|主体与关系|事件脚本|保持一致)】$/, true);
  }
  /* 去掉的关键帧，别的句子里提到它的那一处换成这个，要人改写 */
  const HOLE = '〔原来的关键帧去掉了，改写这一处〕';
  return Object.freeze({ order, scan, lines, roleOf, noOf, cn, headKey, isHead, groupEmpty, put, putRef, HOLE });
});
