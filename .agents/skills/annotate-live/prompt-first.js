'use strict';
/* ============================================================
   写初步剧本的段：人先在写稿页写这一段的初步剧本（提示词/第N段/初步剧本.txt；11-21～11-26 建的段叫 自由稿.txt，照认），
   AI 照它提炼分镜（梗概、出场的人物场景道具、镜头表），分镜定下来以后出资产，再照镜头表交给 AI 写完、出片。
   11-21 他定「先写提示词」；2026-11-26 他定改回先写剧本、叫「初步剧本」：它只是初稿，成片是照它二次创作，可以不一样，也不回头改它。
   流水线.json 这一段记着「先写提示词: true」（老名字），「剧本定稿」记的是人点「提炼分镜」的时间（公用/核心.js 的 isPF）。
   服务这头：读「剧本」的地方，这一段读初步剧本（srcPath；docText 认 .txt）；任务书开头说一句「剧本」指的就是初步剧本、成片可以不一样（lead）。
   写完照镜头表拆在 pe-finish.js。
   测试：通用工具/测试/先写提示词_任务测试.js
   ============================================================ */
module.exports = function makePF(d) {
  const { Core, pj, segDir, scriptPath, readFlow, sceneOf, has = () => false } = d;   // has(路径)：文件在不在（jobs.js 给 fs.existsSync）
  const isPF = s => !!(Core && Core.isPF && Core.isPF(s));
  /* 这一段的初步剧本：有 初步剧本.txt 用它；只有老名字 自由稿.txt 的用老的 */
  const freePath = (name, seg) => {
    const at = f => pj(name, '提示词', segDir(seg), f), now = at(Core.PF_FILE);
    return !Core.PF_OLD || has(now) || !has(at(Core.PF_OLD)) ? now : at(Core.PF_OLD);
  };
  /* 这一段的「剧本」在哪：写初步剧本的段是初步剧本 */
  const srcPath = (name, s, seg) => isPF(s) ? freePath(name, seg) : scriptPath(name, seg);
  const NOTE = '注意：这一段的剧本是人自己写的初步剧本（初稿），下面说到「剧本」「定稿的剧本」的地方，指的都是这份初步剧本。成片是照它二次创作的：人后来在提示词、批注里改的，照人最新的来，和初步剧本不一样不算错，也不用回头改初步剧本。';
  const DISTILL = '提炼时：初步剧本里同一个人换了叫法的（比如「老周」「周师傅」），是全片人物表里的哪一个就用表里的名字，算一个人；初步剧本里已经分了镜头的，镜头表照人分的来；机位、运镜、声音不写进镜头表，后面写提示词时照初步剧本带上。';
  /* 任务书标题下面说一句（书里提到剧本的才说） */
  async function lead(j, book) {
    if (typeof book !== 'string' || !j || !j.段 || !/剧本/.test(book)) return book;
    let s = null;
    try { s = sceneOf(await readFlow(j.项目), j.段); } catch (e) { return book; }
    if (!isPF(s)) return book;
    const i = book.indexOf('\n'), add = NOTE + (/^提炼/.test(String(j.事)) ? DISTILL : '');
    return i < 0 ? book + '\n\n' + add : book.slice(0, i + 1) + '\n' + add + '\n' + book.slice(i + 1);
  }
  /* 各样事的任务书都过一遍 lead：各样事都登记好以后调一次 */
  function wrap(KINDS) {
    for (const K of Object.values(KINDS)) {
      if (!K || typeof K.book !== 'function' || K.book.pf) continue;
      const b = K.book;
      K.book = Object.assign(async function (j) { return lead(j, await b.call(this, j)); }, { pf: true });
    }
  }
  return { isPF, freePath, srcPath, lead, wrap, NOTE };
};
