'use strict';
/* ============================================================
   先写提示词的段（2026-11-21 他定）：没有剧本，人先在写稿页写一段自由模式的提示词（提示词/第N段/自由稿.txt），
   AI 照它提炼分镜（梗概、出场的人物场景道具、镜头表），分镜定下来以后出资产，再照镜头表交给 AI 写完、出片。
   流水线.json 这一段记着「先写提示词: true」，「剧本定稿」记的是人点「提炼分镜」的时间（公用/核心.js 的 isPF）。
   服务这头：读「剧本」的地方，这一段读自由稿（srcPath；docText 认 .txt）；任务书开头说一句「剧本」指的就是自由稿（lead）。
   写完照镜头表拆在 pe-finish.js。
   测试：通用工具/测试/先写提示词_任务测试.js
   ============================================================ */
module.exports = function makePF(d) {
  const { Core, pj, segDir, scriptPath, readFlow, sceneOf } = d;
  const isPF = s => !!(Core && Core.isPF && Core.isPF(s));
  const freePath = (name, seg) => pj(name, '提示词', segDir(seg), Core.PF_FILE);
  /* 这一段的「剧本」在哪：先写提示词的段是自由稿 */
  const srcPath = (name, s, seg) => isPF(s) ? freePath(name, seg) : scriptPath(name, seg);
  const NOTE = '注意：这一段没有剧本。人先写了一段自由模式的视频提示词（下面叫「自由稿」），下面说到「剧本」「定稿的剧本」的地方，指的都是这份自由稿。';
  const DISTILL = '提炼时：自由稿里同一个人换了叫法的（比如「老周」「周师傅」），是全片人物表里的哪一个就用表里的名字，算一个人；自由稿里已经分了镜头的，镜头表照人分的来；机位、运镜、声音不写进镜头表，后面写提示词时照自由稿带上。';
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
