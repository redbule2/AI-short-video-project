'use strict';
/* ============================================================
   在别处做完了（2026-11-17 他定）：交给 AI、等回复的任务，要做的事在别处已经做了（另一个对话直接改了、人自己改了），
   就不再等，记成做完：「不用做了：……」。jobs.js 等回复时隔两秒问一次 check(j)。
   只看这件任务要动的那几个文件：
     照批注改的（按批注改、提炼按批注改、按批注改字、按批注改提示词）：批注不在了（别处照它改完，收进历史记录了）
     写提示词：要写的那一条已经有了
     写字：每一样要写的字、只核图的那张图，任务开始以后都改过了（只改了几样的照旧等）
     照图核 GEO：底稿或图，任务开始以后改过了
   别的任务（与AI沟通剧本、出图、出片……）不看。
   看到以后再等两分钟：AI 有时先改了文件才写回复，两分钟里回复到了照常收。改动在两分钟以前的（服务重开以后接着等的），不用再等。
   测试：通用工具/测试/在别处做完_测试.cjs
   ============================================================ */
module.exports = function makeElsewhere({ fsp, pj, vpPath, wait = 120e3 }) {
  const mtime = async p => { try { return Math.floor((await fsp.stat(p)).mtimeMs); } catch (e) { return -1; } };   // -1：不在
  const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const NOTE = { 按批注改: j => j.rel, 提炼按批注改: j => j.rel, 按批注改字: j => j.注, 按批注改提示词: j => j.rel };   // 批注文件（项目里的相对路径）
  const label = x => x.名称 + (x.状态名 ? '（' + x.状态名 + '）' : '');
  /* 现在看着是不是在别处做完了：{ why, at（什么时候改的；批注不在了的不知道，空着） }，不是就回 null */
  async function seen(j) {
    const base = +j.开始 || 0;
    if (!base) return null;
    if (NOTE[j.事]) {
      const rel = NOTE[j.事](j);
      if (!Array.isArray(rel) || !rel.length || await mtime(pj(j.项目, ...rel)) >= 0) return null;
      return { why: '批注已经不在了，多半在别处照它改完了', at: 0 };
    }
    if (j.事 === '写提示词') {
      const t = vpPath ? await mtime(vpPath(j)) : -1;
      return t < 0 ? null : { why: j.名 + ' 在别处写好了', at: t };
    }
    if (j.事 === '写字') {   // 要写字的看字，只核图的看图；没图也不用写字的（只写要撑住），看字有没有人写了
      const items = Array.isArray(j.items) ? j.items : [], parts = [];
      let at = 0;
      if (!items.length) return null;
      for (const x of items) {
        const img = !x.写 && !!x.有图, f = x.f && (img ? x.f.img : x.f.txt);
        if (!Array.isArray(f)) return null;
        const t = await mtime(pj(j.项目, ...f));
        if (t <= base) return null;   // 有一样还没人动过：照旧等
        parts.push(label(x) + (img ? '的图' : '的字'));
        at = Math.max(at, t);
      }
      return { why: parts.join('、') + ' ' + hm(at) + ' 在别处改过了', at };
    }
    if (j.事 === '核GEO') {
      const f = j.files || {}, geo = Array.isArray(f.geo) ? await mtime(pj(j.项目, ...f.geo)) : -1, img = Array.isArray(f.img) ? await mtime(pj(j.项目, ...f.img)) : -1, t = Math.max(geo, img);
      return t > base ? { why: j.名 + '的' + (geo >= img ? 'GEO 底稿' : '图') + ' ' + hm(t) + ' 在别处改过了', at: t } : null;
    }
    return null;
  }
  /* 等回复的时候问：该收掉了回一句为什么，还不到回空。头一回看到的样子记在 j.别处 */
  async function check(j, now = Date.now()) {
    const s = await seen(j);
    if (!s) { j.别处 = null; return ''; }
    if (!j.别处 || j.别处.why !== s.why) j.别处 = { why: s.why, at: s.at || now };
    return now - j.别处.at >= wait ? s.why : '';
  }
  return Object.freeze({ check, seen });
};
