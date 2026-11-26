/* 人物卡（2026-11-26 他定）：每张人物资产图都要带高清脸部特写，和全身拼在一张里——
   一张横图，几格都是同一个人：正脸大特写、3/4 侧脸特写，加脖子以下的正、侧、背全身（无头三视图：全图只剩特写里的脸，脸的细节都从它来；
   只给正脸近景会发平，所以补一张侧脸）。当天先做的是「左脸右全身」，他看过调研说「直接改无头卡」。
   Seedance 2.5 官方：一条视频五个主体以内，多视图的人物图能用；无头是社区做法，官方没提。
   成群出现、一个样子代表一群人的（士兵、路人），资产卡上点「只要全身」：照旧出竖幅全身的定妆照，免得一群人长一张脸。记在人物那一行的「只全身」。
   以前出的竖幅全身照算「缺脸部特写」：资产卡上标出来，「出图」里默认勾上；重画时本机服务把原图交给 Codex，照它的长相、穿着出人物卡。
   用到的：流水线.js 的 wordFor（w.noFace）、资产.html、资产详情.js、一次出图.js；本机服务 jobs.js（写字的出图规矩、只要全身）、codex-draw.js（出图时的话）。
   测试：node 通用工具/测试/人物卡_测试.cjs */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FaceCard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  /* 人物卡长什么样：写字的出图规矩、发给 Codex 的话都用这一句；SHORT 是页面上提一句用的 */
  const CARD = '一张横幅 16:9 的图，从左到右五格，都是同一个人：第一格最宽，是正脸大特写（只拍头部，正脸平视镜头，表情平静，脸占满这一格）；'
    + '第二格是 3/4 侧脸特写（只拍头部，脸朝画面右前方）；后三格是正面、侧面、背面全身站立，取景从脖子到鞋底，头在画框外；'
    + '纯中灰色摄影棚背景，各格的光一样，图上不写字';
  const SHORT = '正脸大特写、侧脸特写，加脖子以下的正、侧、背全身';
  const RULE = '人物：人物卡，' + CARD + '；出图提示词里直接写画面，不写「人物卡」这个词；分「长相」「姿势」「穿着」「质感」几小段写；长相普通，不是明星脸，不是任何真人的肖像。'
    + '标了「只要全身」的（成群的路人）照旧出定妆照：画面里只有这一个人，正面全身站立，头到脚完整入画，竖幅 2:3，纯中灰色摄影棚背景。';
  /* 已经有竖幅全身照、还没有出图提示词的：交给 AI 写字时的要求 */
  const ASK = '这一样已经有图（竖幅全身照，没有脸部特写）：照出图规矩写成人物卡的出图提示词，长相、穿着照现在这张图和全片设定，别改样子';
  const tall = (w, h) => w > 0 && h > w * 1.1;   // 竖的：以前的全身照（人物卡是横的）
  const bodyOnly = e => !!(e && e.只全身);
  function setBodyOnly(e, on) { if (!e) return false; if (on) e.只全身 = true; else delete e.只全身; return true; }
  /* 图有多宽多高：读文件头（PNG、JPEG、WebP；本机服务用）。认不出回 null */
  function sizeOf(buf) {
    const u = buf instanceof Uint8Array ? buf : buf ? new Uint8Array(buf) : null;
    if (!u || u.length < 30) return null;
    const be16 = i => (u[i] << 8) | u[i + 1], be32 = i => (u[i] * 16777216) + (u[i + 1] << 16) + (u[i + 2] << 8) + u[i + 3];
    const le16 = i => u[i] | (u[i + 1] << 8), le24 = i => u[i] | (u[i + 1] << 8) | (u[i + 2] << 16);
    if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47) return { w: be32(16), h: be32(20) };   // PNG：IHDR 里的宽、高
    if (u[0] === 0xFF && u[1] === 0xD8) {   // JPEG：一段一段往后找 SOF
      let i = 2;
      while (i + 9 < u.length) {
        if (u[i] !== 0xFF) { i++; continue; }
        const m = u[i + 1];
        if (m === 0xFF) { i++; continue; }
        if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += 2; continue; }   // 没有长度的记号
        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: be16(i + 7), h: be16(i + 5) };
        i += 2 + be16(i + 2);
      }
      return null;
    }
    if (be32(0) === 0x52494646 && be32(8) === 0x57454250) {   // RIFF……WEBP
      const tag = String.fromCharCode(u[12], u[13], u[14], u[15]);
      if (tag === 'VP8X') return { w: le24(24) + 1, h: le24(27) + 1 };
      if (tag === 'VP8L') return { w: 1 + (((u[22] & 0x3F) << 8) | u[21]), h: 1 + (((u[24] & 0x0F) << 10) | (u[23] << 2) | ((u[22] & 0xC0) >> 6)) };
      if (tag === 'VP8 ') return { w: le16(26) & 0x3FFF, h: le16(28) & 0x3FFF };
    }
    return null;
  }
  /* 出图时往 Codex 的话里加的（不写列表、不空行）。old：竖幅原图的完整路径（要照它改成人物卡的），没有给空 */
  const drawLines = old => ['这一张是人物卡（照任务书「人物卡」那一节做）：' + CARD + '。', ...(old ? ['原图（竖幅全身照，还没有脸部特写；人物卡照它的长相、穿着出）：' + old] : [])];
  /* 页面：这张人物图缺不缺脸部特写。看资产卡上那张缩小图（宽 400）是不是竖的；没量过就量，量出竖的，again() 重画一回（几张一起量好只重画一回）。
     e：人物那一行（点了「只要全身」的不算缺）；parts：图在本机的路径（流水线.js 的 at）；t：图的文件时间（图换过重量） */
  const SHAPE = new Map();
  let soon = 0;
  function lacks(e, parts, t, again) {
    const UI = typeof window === 'object' && window ? window.UI : null;
    if (bodyOnly(e) || !UI || !UI.thumbOf || !UI.thumbSize || !Array.isArray(parts)) return false;
    const k = parts.join('/') + '@' + (t || 0);
    if (SHAPE.has(k)) return SHAPE.get(k) === 'tall';
    SHAPE.set(k, '');
    UI.thumbOf(parts, 400).then(u => {
      const z = UI.thumbSize(u), v = z ? (tall(z[0], z[1]) ? 'tall' : 'wide') : '?';
      SHAPE.set(k, v);
      if (v === 'tall' && typeof again === 'function') { clearTimeout(soon); soon = setTimeout(again, 60); }
    }, () => SHAPE.set(k, '?'));
    return false;
  }
  return Object.freeze({ CARD, SHORT, RULE, ASK, tall, bodyOnly, setBodyOnly, sizeOf, drawLines, lacks });
});
