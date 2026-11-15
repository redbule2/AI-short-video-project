#!/usr/bin/env node
/* 剧本、镜头表的 Word 文件，和「一行一段」的文字互相转。给 AI 写剧本、改剧本用：
   用的就是页面里读写 Word 的那一套（公用/核心.js），写出来的文件页面一定读得回来。
     node 剧本读写.js 读 <剧本或镜头表.docx>
         打印成文字，一行一段（就是固定格式的那个样子）
     node 剧本读写.js 写剧本 <第N段_剧本.docx> <文字.txt>
     node 剧本读写.js 写镜头表 <第N段_镜头表.docx> <文字.txt>
         文字照固定格式写（.agents/skills/script-shotlist-format）。那里已经有同名文件的，
         先把它挪进项目的 历史记录 下同样的路径（原名__年月日-时分秒.docx），再写新的。
     node 剧本读写.js 查 <文字.txt> 剧本|镜头表
         只照固定格式查一遍，不写文件 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 读写的核心就是 公用/核心.js（流水线各页、看文件的那一页用的都是它），直接拿来用 */
function loadCore() {
  return require(path.join(__dirname, '公用', '核心.js'));
}
const two = n => String(n).padStart(2, '0');
const stamp = () => { const d = new Date(); return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()); };
const readLines = f => fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r\n|\n|\r/).map(t => ({ text: t }));
/* …\项目\<项目名>\定稿的剧本\… → 项目名、项目文件夹、它在项目里面的路径 */
function whereIs(file) {
  const parts = path.resolve(file).split(path.sep), i = parts.lastIndexOf('定稿的剧本');
  if (i < 1) throw new Error('这个文件不在哪个项目的 定稿的剧本 里：' + file);
  return { pj: parts[i - 1], pjDir: parts.slice(0, i).join(path.sep), rel: parts.slice(i) };
}
function report(list) {
  for (const x of list) console.log((x.level === 'warn' ? '要改：' : '提示：') + x.msg);
  return list.filter(x => x.level === 'warn').length;
}

(async () => {
  const C = loadCore();
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === '读' && a) {
    const paras = await C.readDocx(fs.readFileSync(a));
    console.log(paras.map(p => C.cleanPara(p.text)).filter(Boolean).join('\n'));
    return;
  }
  if ((cmd === '写剧本' || cmd === '写镜头表' || cmd === '查') && a && b) {
    const isScript = cmd === '写剧本' || (cmd === '查' && b === '剧本');
    const txt = cmd === '查' ? a : b, out = cmd === '查' ? null : path.resolve(a);
    const fseg = out ? C.segFromName(path.basename(out)) || C.segFromName(path.basename(path.dirname(out))) : null;
    let doc, bytes;
    if (isScript) {
      const r = C.parseScripts(readLines(txt), fseg);
      if (r.segs.length !== 1) throw new Error('这份文字里有 ' + r.segs.length + ' 段，一个文件只写一段');
      doc = r.segs[0];
      if (!doc.seg) throw new Error('第一行要写成「第N段｜段名」');
      if (fseg && doc.seg !== fseg) throw new Error(`文字里是第${doc.seg}段，文件名是第${fseg}段，对不上`);
      const bad = report(C.lintScript(doc));
      if (out) bytes = await C.writeDocx(C.scriptToParas(doc), { title: C.scriptTitle(doc), header: `${whereIs(out).pj} · 第${doc.seg}段 · 剧本` });
      console.log(`剧本：第${doc.seg}段｜${doc.name || '（没写段名）'}，正文 ${doc.sections[1].blocks.length} 行` + (bad ? `，有 ${bad} 处要改` : ''));
    } else {
      doc = C.parseShotList(readLines(txt), fseg);
      if (!doc.seg) throw new Error('第一行要写成「第N段｜镜头表｜段名」');
      if (fseg && doc.seg !== fseg) throw new Error(`文字里是第${doc.seg}段，文件名是第${fseg}段，对不上`);
      const bad = report(C.lintShots(doc));
      if (out) bytes = await C.writeDocx(C.shotsToParas(doc), { title: C.shotTitle(doc), header: `${whereIs(out).pj} · 第${doc.seg}段 · 镜头表` });
      console.log(`镜头表：第${doc.seg}段，${doc.shots.length} 镜` + (bad ? `，有 ${bad} 处要改` : ''));
    }
    if (!out) return;
    if (fs.existsSync(out)) {   // 原来那一份先进历史记录
      const w = whereIs(out), name = path.basename(out, '.docx');
      const dest = path.join(w.pjDir, '历史记录', ...w.rel.slice(0, -1), name + '__' + stamp() + '.docx');
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(out, dest);
      console.log('原来那一份挪进历史记录了：' + dest);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(bytes));
    console.log('写好了：' + out);
    return;
  }
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\* ?/, ''));
  process.exitCode = 2;
})().catch(e => { console.error('没做成：' + e.message); process.exit(1); });
