'use strict';
/* ============================================================
   照审片批注另存（2026-11-23 他定：「一个提示词一旦出片了，不能修改编辑，但是可以点进去看。针对其成片的批注，AI 可以基于批注新增一条提示词；
     点另存成改几这个按钮的时候，给出的是提示词，AI 根据提示词改，不允许原封不动地复制一份」）。
   出过片的那一版点「另存成改N」：开一个任务，把这一版出的样片的审片批注（和这一版提示词上写的批注）交给 AI（照例复制给你自己的 AI），
     AI 回改动清单，改好的另存成下一版 _改N；原稿、样片、审片批注都不动，提示词上写的批注照旧收进历史记录。
   AI 一处没改、改完和原稿一字不差：不另存，说一句。一份批注都没有：不开，先去审片写批注。
   认哪几份批注：filmed.js 的 state().批注（样片旁边的「视频名_批注.md」，成片里的、历史记录里的；加上 提示词/第N段/名_批注.md）。
   怎么改、怎么落盘都借「按批注改提示词」（jobs.js）：任务书换开头、批注换成拼好的这几份；落盘多一条「一定要改出新东西」。
   页面：流水线/提示词.html 那一行的「另存成改N」、写稿页顶上那一条（公用/写稿出过片.js）。测试：node --test 通用工具/测试/出过片_测试.cjs
   ============================================================ */
module.exports = function makeReviewFork({ fsp, pj, str, fail, exists, unbom, today, nameOk, RE_VP, vpPath, filmed, edit }) {
  /* edit：jobs.js 的「按批注改提示词」。这会儿先拿住它的 book、apply：jobs.js 后面 PF.wrap 会把各样事的 book 包一层（只传一个参数、开头加一句），
     包过的再调就丢了这里给的开头和批注，那一句还会加两回。这一样自己的 book 照样被包一回 */
  const { book: editBook, apply: editApply } = edit;
  const NAME = '照审片批注另存';
  const NO_NOTE = '这一版出的样片还没写批注：先点「审片」，边看边写哪里不对（或者「打开看、写批注」在提示词上写），再点「另存成改N」';
  const MUST = '没照批注改出新的东西（AI 一处没改，或者改完和原稿一字不差）：原样照抄不算新的一版，这回没另存。把批注写具体些，再点一次「另存成改N」';
  const stem = n => str(n).replace(/\.txt$/i, '');
  const isPrompt = rel => rel.startsWith('提示词/');
  const sink = md => md.replace(/^(#+)(?=[ \t])/gm, '###$1');   // 批注里的标题降三级：摆进任务书「## 批注」下面不乱
  const SHOT_RE = /^(?:结束)?截图[：:][ \t]*(.+?)[ \t]*$/gm;   // 审片批注里每一条停住的那一帧（审片台写的完整路径）
  /* 拼好的批注：审片批注一份一段（成片里的在前），再是提示词上写的；顺手记下截图，交给 AI 的话里叫它先看 */
  async function noteText(j) {
    const parts = [], shots = [];
    for (const rel of j.审片 || []) {
      const p = pj(j.项目, ...rel.split('/'));
      if (!(await exists(p))) continue;
      const md = unbom(await fsp.readFile(p, 'utf8')).trim(), clip = rel.split('/').pop().replace(/_批注\.md$/, '');
      for (const m of md.matchAll(SHOT_RE)) if (!shots.includes(m[1]) && await exists(m[1])) shots.push(m[1]);
      parts.push('### 审片批注：样片「' + clip + '」' + (rel.startsWith('历史记录/') ? '（这条样片收进了历史记录）' : ''), '文件：' + p, '', sink(md), '');
    }
    const pn = j.rel ? pj(j.项目, ...j.rel) : '';
    if (pn && await exists(pn)) parts.push('### 提示词批注（在这一版提示词上写的）', '', sink(unbom(await fsp.readFile(pn, 'utf8')).trim()), '');
    if (!parts.length) throw fail(NO_NOTE);
    j.images = shots;
    return parts.join('\n');
  }
  return { KINDS: { [NAME]: {
    title: j => '照审片批注改 · ' + stem(j.名), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,   // file 和按批注改提示词一样：同一份稿一次只做一件
    async prep(j) {
      if (!filmed) throw fail('本机服务没有认出过片的那一块，重开一次再试');
      if (!nameOk(str(j.名)) || !RE_VP.test(j.名)) throw fail('要说清是哪一条视频提示词');
      if (!(await exists(vpPath(j)))) throw fail('这一版提示词不在了');
      const f = await filmed.state(j.项目, j.段, j.名);
      if (!f.出过片) throw fail('这一版还没出片：直接改就行，不用另存');
      if (f.不能另存) throw fail(f.不能另存);
      const ns = f.批注 || [];
      if (!ns.length) throw fail(NO_NOTE);
      j.审片 = ns.filter(r => !isPrompt(r));
      const pn = ns.find(isPrompt);
      j.rel = pn ? pn.split('/') : null;
      j.下一版 = f.下一版;
    },
    async book(j) {
      const note = await noteText(j);
      return editBook(j, { note, head: [
        '# 任务：照审片批注改视频提示词，改好另存成新的一版',
        '',
        '今天 ' + today() + '。下面这份 Seedance 视频提示词「' + j.名 + '」已经出过片，用户看了样片写了批注（见下面「批注」）。请照批注改：项目把改好的另存成「' + j.下一版 + '」，原稿和样片都不动，你只回改动清单。',
        '审片批注说的是片子哪里不对：时间是样片里的位置，「镜头」对应提示词里的镜头N，截图是写批注时停住的那一帧，先打开截图看，再读批注。找到提示词里管那一处的句子（哪一镜、素材、主体与关系、基础设定……），改到下回出片能照批注变好。',
        '不许原样照抄：批注说到的每一处都要落到改动上。实在一处都改不了，回空列表 []，项目会告诉用户这回没另存。'] });
    },
    apply: (j, text) => editApply(j, text, { must: MUST }),
  } } };
};
