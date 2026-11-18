'use strict';
/* ============================================================
   与AI沟通剧本（2026-11-17 他定）：人写完剧本，在剧本那一页右上角点「与AI继续沟通」，
   复制要交代的话，贴进自己开的 AI 对话，和它商量着改；他说「定稿」，AI 才把改好的整份剧本写进回复文件，
   这里照固定格式查过，写回 第N段_剧本.docx（旧的进历史记录），页面换上红批。
   没写批注也能点；写了的一起带上，改完批注收进历史记录。商量下来不改：回复只写「不改」，剧本、批注都不动。
   jobs.js 把这里的 KINDS 并进去；交给 AI 的话（selfMsg）、弹窗上那一句（handSay）也从这里拿。
   ============================================================ */
module.exports = function makeTalk({ fsp, pj, str, fail, exists, unbom, nameOk, docText, writeDoc, archive, body, today, mmdd }) {
  const NO_CHANGE = /^\s*不改\s*[。.！!]?\s*$/;
  const 与AI沟通剧本 = {
    title: j => '与AI沟通 · ' + j.doc[j.doc.length - 1].replace(/\.docx$/, ''),
    key: j => j.doc.join('/'),
    /* 页面给的是这一份剧本的批注放在哪（定稿的剧本/第N段/第N段_剧本_批注.md）；没写批注就还没有这个文件 */
    async prep(j) {
      const parts = str(j.批注).split('/').filter(Boolean);
      if (parts[0] === '项目') parts.shift();
      const last = parts[parts.length - 1] || '';
      if (parts[0] !== j.项目 || parts[1] !== '定稿的剧本' || !/_剧本_批注\.md$/.test(last) || parts.some(x => !nameOk(x))) throw fail('这一份不是这个项目 定稿的剧本 里的剧本');
      j.rel = parts.slice(1);
      j.doc = j.rel.slice(0, -1).concat(last.replace(/_批注\.md$/, '.docx'));
      if (!(await exists(pj(j.项目, ...j.doc)))) throw fail('这一段还没有单独的剧本文件（' + j.doc.join('/') + '）：先在剧本那一页点「写剧本」存一份');
      const m = /第([0-9-]+)段/.exec(last);
      if (m) j.段 = m[1];
    },
    async book(j) {
      const text = await docText(pj(j.项目, ...j.doc)), np = pj(j.项目, ...j.rel);
      const note = (await exists(np)) ? unbom(await fsp.readFile(np, 'utf8')).trim() : '';
      return ['# 任务：和人商量着改剧本', '',
        '今天 ' + today() + '。这是一个 AI 短视频项目。下面是第' + j.段 + '段的剧本，是人自己写的' + (note ? '，人还写了批注' : '') + '。人想先在对话里和你商量，商量定了再改。',
        '', '## 怎么商量',
        '1. 先读剧本' + (note ? '和批注' : '') + '，在对话里说你的看法：' + (note ? '批注一条一条说打算怎么改；' : '') + '你觉得要改、要补的，说清哪一处、为什么、怎么改。',
        '2. 一次说几件要紧的，别一上来把整份重写一遍。',
        '3. 改不改人定，人没同意的不改。',
        '4. 人说「定稿」以后，才把改好的整份剧本一次写进回复文件。没说之前别写：一写，项目马上就收走，当成定稿。',
        '5. 商量下来不用改的，回复文件里只写「不改」两个字。',
        '6. 要看全片和前后几段的，在 ' + pj(j.项目, '定稿的剧本') + '（流水线.json 和各段的剧本），只读。',
        '', '## 改的时候',
        '1. 只改商量定了的地方，别的一个字都不动（包括标点、空格）。',
        '2. 批注是把原文抄下来改过的，照抄批注，不再润色；批注末尾没打标点的，沿用原句末尾的标点。',
        '3. 省略号写成「……」；动作行前面的「△ 」要留着。',
        '4. 在最后「备注」那一节（没有就加上）末尾加一行：' + mmdd() + ' 和 AI 商量改：（一句话说清改了哪几处）。原来的备注一行都不动。',
        '', '## 回复的格式',
        '改好以后的整份剧本，从第一行标题开始，格式和原文一样。只写剧本本身，不要解释，不要寒暄，不要用代码块围起来。',
        '', '## 剧本原文', text, '', '## 批注', note || '（没写批注）'].join('\n');
    },
    async apply(j, text) {
      if (NO_CHANGE.test(text)) return { 结果: '商量下来不改：剧本没动' + ((await exists(pj(j.项目, ...j.rel))) ? '，批注还留着' : ''), 产出: [] };
      try { await writeDoc(j, '剧本', pj(j.项目, ...j.doc), body(text, /^第.+段/)); }
      catch (e) {   // 格式不对：接着等 AI 改好回复文件（jobs.js 认「没按要的格式」），不算没成
        if (/^AI 写的剧本不合固定格式/.test(e.message)) throw fail('AI 写的剧本没按要的格式：' + e.message.replace(/^AI 写的剧本不合固定格式：/, ''));
        throw e;
      }
      await archive(j.项目, j.rel);
      return { 结果: '剧本照商量的改好了，改动的地方显示成红批', 产出: [j.doc.join('/')] };
    },
    /* 交给 AI 的话：先商量，他说「定稿」才写回复文件（tell：写完跑一句告诉项目，jobs.js 给的） */
    selfMsg(j, files, tell) {
      return ['我写好了第' + j.段 + '段的剧本，想先和你商量着改。请读这份任务书，剧本原文、我的批注、要求都在里面：', files.book,
        '读文件用命令行或者读文件的工具。不要用 Computer Use，不要打开别的软件、窗口。',
        '读完先在对话里跟我说你的看法，我们一起商量。等我说「定稿」，再把改好的整份剧本（照任务书里「回复的格式」）一次写进下面这个文件，用 UTF-8；商量下来不用改，就只写「不改」两个字。我没说「定稿」之前别写它：一写，项目马上就收走。除了它，别的文件一律不改、不新建：', files.reply,
        ...tell].join('\n');
    },
    handSay: '复制下面的话，贴进你自己的 AI 对话（Claude、Codex、DeepSeek 都行），和它商量着改。商量好了跟它说「定稿」，它把剧本写回项目，这里自动换上，改动的地方显示成红批。',
  };
  return { KINDS: { 与AI沟通剧本 } };
};
