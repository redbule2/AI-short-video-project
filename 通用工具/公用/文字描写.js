/* 只用文字写、不出图的资产，也有自己的一份字：文字描写（2026-11-17 他要：纯文字资产也能先写好；写视频提示词照它写，不再只用全片设定里的一两句）。
   字和出图的放一处（他定的）：提示词/全局资产/类别/名字_提示词.txt。格式和出图提示词一样：开头几行（「用途：」那一行写明「只用文字」、「要撑住：」），
   单独一行「提示词」，下面是正文。正文只写样子，不写定妆照、画幅、背景：写视频提示词时照它写进【主体与关系】。以后改成出图，AI 照它改写成出图提示词。
   用到的：流水线 资产.html、资产详情.js（卡、弹窗：自己写、让 AI 写、写批注交给 AI 改），本机服务 jobs.js（让 AI 写、写视频提示词）。
   测试：node 通用工具/测试/文字描写_测试.cjs */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TxtWord = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const NAME = '文字描写', MARK = '只用文字';
  const str = v => String(v == null ? '' : v).trim();
  /* 「用途：」后面那一句 */
  const purpose = (cat, name, state) => cat + '「' + str(name) + '」' + (str(state) ? '（' + str(state) + '）' : '') + MARK + '，不出图：写视频提示词照这份字写';
  /* 这份字（开头几行，或者整份）是不是只用文字时写的：看开头「用途：」那一行（整份的只看单独一行「提示词」上面） */
  function isTxt(head) {
    let lines = Array.isArray(head) ? head : String(head || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
    if (!Array.isArray(head)) { const i = lines.findIndex(l => l.trim() === '提示词'); if (i >= 0) lines = lines.slice(0, i); }
    const u = lines.find(l => /^\s*用途[：:]/.test(String(l)));
    return !!u && u.includes(MARK);
  }
  /* 整份字 → 正文（单独一行「提示词」下面的；没有这一行就是整份） */
  function bodyOf(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n'), i = lines.findIndex(l => l.trim() === '提示词');
    return (i < 0 ? lines : lines.slice(i + 1)).join('\n').trim();
  }
  /* 让 AI 写（写字任务书）：要求里的一句、「文字描写规矩」一类一条 */
  const ASK = '标了「只用文字」的：不出图，写「文字描写」，照下面「文字描写规矩」：只写样子，能直接放进视频提示词；不写定妆照、画幅、背景，不写 GEO 底稿。';
  const RULE = {
    人物: '人物：年纪、身材、长相、头发胡子、穿着（颜色、料子、新旧）、随身带的东西，一百字上下；只写看得见、各镜头都不变的样子，不写姿势、表情、动作；长相普通，不是明星脸，不是任何真人的肖像。',
    道具: '道具：样子、大小（和人比，比如四尺来长）、结构、材质、颜色、新旧，五六十字；有状态的写那个状态。',
    场景: '场景：在哪、什么时候、有什么、各在哪、光从哪来，一百字上下；只写镜头拍得到的。',
  };
  /* 这一场只用文字写的几样：没挂图、标了「只用文字」的人物、道具，标了的场景（全片场景里的一句）。
     h：{ noImg, sceneStem, skip }（公用/核心.js 的两个；skip：不算的名字，比如旁白）。给 [{ 类别, 名称, 描写, rel }]，rel 是它那份字（项目里的路径，拆开的） */
  function itemsOf(flow, s, h) {
    const out = [], rows = k => (flow && Array.isArray(flow[k]) ? flow[k] : []), arr = a => Array.isArray(a) ? a : [];
    const imgs = e => arr(e && e.资产).length || (e && typeof e.资产 === 'string' && e.资产.trim()) ? 1 : 0;
    for (const k of ['人物', '道具']) for (const n of arr(s && s[k]).map(str).filter(Boolean)) {
      const e = rows(k).find(x => x && str(x.名) === n);
      if ((h.skip && h.skip(n)) || imgs(e) || !h.noImg(s, k, n)) continue;
      out.push({ 类别: k, 名称: n, 描写: str(e && e.描写), rel: ['提示词', '全局资产', k, n + '_提示词.txt'] });
    }
    for (const t of arr(s && s.场景文字).map(str).filter(Boolean)) {
      const st = h.sceneStem(t);
      if (st && h.noImg(s, '场景', st)) out.push({ 类别: '场景', 名称: st, 描写: t, rel: ['提示词', '全局资产', '场景', st + '_提示词.txt'] });
    }
    return out;
  }
  /* 写视频提示词：要求里的一句、任务书里「只用文字的资产」那一节。items：itemsOf 给的，各带上 字（文字描写的正文，还没写是 ''） */
  const PROMPT_RULE = '只用文字的几样（下面「只用文字的资产」）不挂图：【主体与关系】里照它的文字描写写，样子、颜色、材质不丢不改，不缩成一两句；【事件脚本】里写它的名字，不把长相、衣着整段抄进镜头。';
  function promptPart(items) {
    const list = (Array.isArray(items) ? items : []).filter(x => x && str(x.名称));
    if (!list.length) return '';
    return ['## 只用文字的资产（不挂图，照这几段字写）', ...list.map(x => '- ' + x.类别 + '「' + str(x.名称) + '」：' + (str(x.字) || '（还没写文字描写，照全片设定：' + (str(x.描写) || '没写') + '）'))].join('\n');
  }
  return Object.freeze({ NAME, MARK, purpose, isTxt, bodyOf, ASK, RULE, itemsOf, PROMPT_RULE, promptPart });
});
