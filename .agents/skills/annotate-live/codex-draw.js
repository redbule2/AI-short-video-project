'use strict';
/* 出图、照批注改图在 Codex 里聊着定（2026-11-23 他定）：
   资产页勾好要出的几样，一样开一个 Codex 新对话，话自动发进去（codex-chat.ps1 -NoWait，一次发一个：用的是同一个输入框）。
   Codex 先照字出第一张（照批注改图：以原图为底照批注改），人在那个对话里聊、让它接着改，满意了说「定稿」。
   Codex 把定下来的那张放在候选图路径、写回复、跑一句告诉项目；这边把它换成正式的图（旧图连批注收进历史记录）、
   参考素材映射里的 SHA-256 跟着换、算确认可用；聊的时候样子改了，出图提示词照 Codex 写的改（原来的收进历史记录）。
   发不出去（Codex 没开、输入框对不上）：改成给我提示词，人点「交给 AI 的话」复制，贴进 Codex 新对话，往后一样。
   资产页的「用新图」「用旧图 / 不要新图」也用这里的 take、drop：同一件事只写一套。
   资产跟着改（11-23，公用/资产照的.js）：页面点出图时交过来照的是哪一句（照的）、和原来比变了什么（变了）。变了的话里带上原来、现在、多了的镜头，
   Codex 先照新描写改出图提示词、告诉人改了哪几句再出；定稿时先换字再换图，图和字都记下照的那一句（照批注改的图照留原来那一句）。
   任务书：通用工具/流水线/任务书/资产出图任务.txt（出图、照批注改图共用） */
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = function makeDraw(d) {
  const { fsp, pj, str, fail, retry, exists, unbom, oneLine, nowText, stampOf, stemOf, archive, writeFile, readFlow, needFinal, wordPrep, noteList, logOf, mtimeOf,
    TxtWord, handoff, withFileLocks, sha256, run, resultJson, sleep, CX, HOME, TOOLS, log, Src, FaceCard } = d;
  const TASK = path.join(TOOLS, '流水线', '任务书', '资产出图任务.txt');
  const SESSIONS = process.env.ANTOU_CODEX_SESSIONS || path.join(os.homedir(), '.codex', 'sessions');   // Codex 的会话记录；ANTOU_CODEX_SESSIONS：试验服务上换成假的
  const two = n => String(n).padStart(2, '0');
  const label = j => j.名 + (j.状态名 ? '（' + j.状态名 + '）' : '');
  const candSide = f => { const dir = f.cand.slice(0, -1), b = stemOf(f.cand[f.cand.length - 1]); return [[...dir, b + '_批注.md'], [...dir, b + '_批注截图']]; };   // 候选图上写的批注、批注截图

  /* ---------- 往 Codex 里发：一次发一个。发出去了给对话号；发不出去给原因 ---------- */
  const line = [];
  let sending = false;
  const tellLine = () => line.forEach((x, i) => { x.j.步骤 = '排队往 Codex 里发：前面还有 ' + (i + 1) + ' 个'; });
  function send(j, msgFile) {
    return new Promise((resolve, reject) => { line.push({ j, msgFile, resolve, reject }); tellLine(); next(); });
  }
  async function next() {
    if (sending || !line.length) return;
    sending = true;
    const x = line.shift();
    tellLine();
    try { x.resolve(await sendNow(x.j, x.msgFile)); } catch (e) { x.reject(e); }
    finally { sending = false; next(); }
  }
  /* 发之前核对（11-27）：话里「reply 号」得是这一样自己的。被别的任务盖了（那回 7 样挤一个文件夹，7 个对话全出了集市）就不发、算没成。
     没有这个文件的照旧交给 codex-chat 去报 */
  async function ownMsg(j, msgFile) {
    let t;
    try { t = await fsp.readFile(msgFile, 'utf8'); } catch (e) { return; }
    if (![...t.matchAll(/\breply\s+(\S+)\s*$/gm)].some(m => m[1] === j.id)) throw fail('交给 Codex 的话不是「' + label(j) + '」这一样的（被别的任务盖了），没发：再点一次出图');
  }
  async function sendNow(j, msgFile) {
    if (j.停) throw fail('停掉了');
    await ownMsg(j, msgFile);
    j.步骤 = '在往 Codex 里发：开一个新对话';
    const t0 = Date.now();
    let res = null, why = '';
    try {   // 对话开在 项目 文件夹：Codex 只认登记过的文件夹，项目里的 .codex 设置（模型、推理、速度；11-24 起 GPT-6.2 Sol、极高、超快）也只在这里面生效
      const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CX, '-PromptFile', msgFile, '-Path', HOME, '-NoWait'], { job: j, timeout: 5 * 60e3 });
      res = resultJson(r.out);
      if (!res) why = (r.err.trim() || r.out.trim()).slice(0, 200) || '退出码 ' + r.code;
    } catch (e) { why = e.message; }
    if (j.停) throw fail('停掉了');
    if (res && res.ok && res.thread_id) return { thread: String(res.thread_id), why: '' };
    for (let i = 0; i < 8; i++) {   // 报没发出也可能其实发出去了（11-23 碰到过「找不到发送按钮」，对话照样出了图）：会话记录里找这一句
      const thread = started(j.id, t0);
      if (thread) return { thread, why: '' };
      if (j.停) throw fail('停掉了');
      await sleep(2500);
    }
    return { thread: '', why: oneLine((res && res.error) || why || '没有结果').slice(0, 160) };
  }
  /* Codex 的会话记录里找发出去的那一句：话里带着任务号（reply <号>）。只看 since 以后新建的记录，开头 2 MB 里就有第一句话 */
  function started(id, since) {
    const want = Buffer.from('reply ' + id), dirs = new Set();
    for (const t of [since - 864e5, since, Date.now()]) {
      const x = new Date(t);
      dirs.add(path.join(SESSIONS, String(x.getFullYear()), two(x.getMonth() + 1), two(x.getDate())));
      dirs.add(path.join(SESSIONS, String(x.getUTCFullYear()), two(x.getUTCMonth() + 1), two(x.getUTCDate())));
    }
    for (const dir of dirs) {
      let names;
      try { names = fs.readdirSync(dir); } catch (e) { continue; }
      for (const n of names) {
        const m = /^rollout-.*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(n);
        if (!m) continue;
        const fp = path.join(dir, n);
        try {
          const st = fs.statSync(fp);
          if (st.mtimeMs < since - 5000 || st.birthtimeMs < since - 5000) continue;   // 老对话里提到这个号的不算
          const fd = fs.openSync(fp, 'r'), buf = Buffer.alloc(Math.min(st.size, 2 * 1024 * 1024));
          try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
          if (buf.indexOf(want) >= 0) return m[1];
        } catch (e) { /* 正写着、读不了：下回再看 */ }
      }
    }
    return '';
  }
  /* 交给 AI 那一步（jobs.js 的 handoff）用：发出去、认出对话号；服务重开后接着等的，认出原来那个对话。发不出去改成给我提示词，不算没成 */
  async function link(j, msgFile) {
    const g = j.交给, meta = path.join(j.dir, '自己交.json');
    let thread = '', why = '';
    if (j.续) { thread = str(j.会话0) || started(j.id, (g.开 || Date.now()) - 60e3); why = thread ? '' : '服务重开前还没发出去'; }
    else ({ thread, why } = await send(j, msgFile));
    if (j.停) throw fail('停掉了');
    if (thread) { g.会话 = thread; g.等 = '你'; }
    else { g.方式 = 'self'; g.等 = '你'; g.没发出 = why; log('没自动发进 Codex：' + j.标题 + '　' + why); }
    try { const m = JSON.parse(unbom(await fsp.readFile(meta, 'utf8'))); await writeFile(meta, JSON.stringify({ ...m, 方式: g.方式, 聊: true, ...(thread ? { 会话: thread } : {}) }, null, 1) + '\n'); }   // 聊：11-23 起在 Codex 里聊的，服务重开后接得上
    catch (e) { /* 没记上：服务重开后照给我提示词接着等 */ }
  }
  /* 页面「去 Codex 看」：切到那个对话 */
  async function openThread(thread) {
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(str(thread))) throw fail('不知道是 Codex 里哪个对话');
    const url = 'codex://threads/' + thread;
    if (process.env.ANTOU_CODEX_LINK_LOG) { await fsp.appendFile(process.env.ANTOU_CODEX_LINK_LOG, url + '\n'); return; }   // 试验服务上不真开
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Start-Process -FilePath $env:ANTOU_URL'], { env: { ANTOU_URL: url }, timeout: 20e3 });
    if (r.code !== 0) throw fail('Codex 没打开：' + (r.err.trim() || '退出码 ' + r.code).slice(0, 200));
  }

  /* ---------- 换图：用新图、不要新图 ---------- */
  /* 新图换上：旧图和它的批注、批注截图（候选图上写的也算）用同一个时间收进历史记录，候选换成原来的名字，算确认可用；
     参考素材映射里挂着这张图的，SHA-256 换成新图的（那几条提示词会标「待核对」）。f：wordFiles 给的几样。
     mark：流水线.json 里记上确认可用（在 Codex 里定稿的）；资产页点「用新图」的不记，页面自己记（它手里那份流水线是新的，这边写了它要并一回）。
     src：{ 照: 照的哪一句（null：照批注改的，照留原来那一句）, 字: 出图提示词在项目里的路径 }，mark 的时候一起记 */
  async function take(name, f, mark = true, src = null) {
    const abs = parts => pj(name, ...parts), img = abs(f.img), cand = abs(f.cand), rel = f.img.join('/');
    const flowP = pj(name, '定稿的剧本', '流水线.json'), mapP = pj(name, '资产', '参考素材映射.json');
    return withFileLocks([img, cand, flowP, mapP], async () => {
      if (!(await exists(cand))) throw fail('新图不在了：' + f.cand.join('/'));
      const flow = mark ? JSON.parse(unbom(await fsp.readFile(flowP, 'utf8'))) : null;   // 先读：读不了就别动图
      const stamp = stampOf(), old = await archive(name, f.img, stamp);
      try { await fsp.rename(cand, img); }
      catch (e) { if (old) await fsp.rename(old, img).catch(() => {}); throw fail('没换上：' + e.message); }
      const t = new Date();
      await fsp.utimes(img, t, t).catch(() => {});   // 文件时间记成现在：页面上「可用」「不用」都靠它认是不是新出的
      for (const p of [f.imgNote, f.shots, ...candSide(f)]) await archive(name, p, stamp).catch(e => log('没收走 ' + p.join('/') + '：' + e.message));
      try {
        const map = JSON.parse(unbom(await fsp.readFile(mapP, 'utf8'))), hex = sha256(await fsp.readFile(img));
        let n = 0;
        for (const v of Object.values(map && map.prompts && typeof map.prompts === 'object' ? map.prompts : {}))
          for (const x of (v && Array.isArray(v.references) ? v.references : [])) if (x && str(x.path).trim().replace(/\\/g, '/') === rel && x.sha256 !== hex) { x.sha256 = hex; n++; }
        if (n) await writeFile(mapP, JSON.stringify(map, null, 2) + '\n');
      } catch (e) { if (e.code !== 'ENOENT') log('参考素材映射没跟着改：' + e.message); }
      const 可用 = nowText(t);
      if (flow) {
        flow.可用 = { ...(flow.可用 && typeof flow.可用 === 'object' && !Array.isArray(flow.可用) ? flow.可用 : {}), [rel]: 可用 };
        if (Src && src) {   // 照的哪一句（11-23）
          if (src.照 === null) Src.restamp(flow, rel, 可用);
          else if (src.照) { Src.record(flow, rel, src.照, 可用); if (src.字) Src.record(flow, src.字, src.照, 可用); }
        }
        await writeFile(flowP, JSON.stringify(flow, null, 2) + '\n');
      }
      return { 可用, stamp, 旧图: !!old };
    });
  }
  /* 不要新图：候选和它上面写的批注收进历史记录（同一个时间），旧图不动 */
  async function drop(name, f) {
    return withFileLocks([pj(name, ...f.cand)], async () => {
      const stamp = stampOf();
      for (const p of [f.cand, ...candSide(f)]) await archive(name, p, stamp);
      return { ok: true };
    });
  }
  /* 聊的时候样子改了：出图提示词照 Codex 写的换掉正文（开头「图1：」「用途：」那几行照旧），原来的收进历史记录 */
  async function putPrompt(name, parts, body) {
    const p = pj(name, ...parts);
    return withFileLocks([p], async () => {
      const old = unbom(await fsp.readFile(p, 'utf8')).replace(/\r\n?/g, '\n'), lines = old.split('\n'), i = lines.findIndex(l => l.trim() === '提示词');
      if (oneLine(i < 0 ? old : lines.slice(i + 1).join('\n')) === oneLine(body)) return false;
      await archive(name, parts);
      await writeFile(p, (i < 0 ? '' : lines.slice(0, i + 1).join('\n') + '\n') + body.trim() + '\n');
      return true;
    });
  }

  /* ---------- Codex 的回复：第一行「定稿」（下面 核图：、改了什么：、样子改了才有的 出图提示词：），或者「不出了：原因」 ---------- */
  function parse(text) {
    const lines = str(text).replace(/\r\n?/g, '\n').split('\n').filter(l => !/^\s*```/.test(l));
    const bare = l => l.replace(/^[\s>#*_-]+/, '').replace(/[\s*_]+$/, '');   // 去掉 Markdown 的标题、引用、加粗
    const i = lines.findIndex(l => bare(l));
    if (i < 0) return { bad: '回复是空的：第一行写「定稿」，或者「不出了：一句原因」' };
    const head = bare(lines[i]), no = /^(不出了|不要了|算了)[：:，,。\s]*(.*)$/.exec(head);
    if (no) return { drop: true, why: oneLine(no[2]).slice(0, 200) };
    if (!/^定稿([。.！!：:，,\s]|$)/.test(head)) return { bad: '回复第一行要写「定稿」，或者「不出了：一句原因」' };
    const v = {};
    let cur = null;
    for (const l of lines.slice(i + 1)) {
      const m = cur === '出图提示词' ? null : /^[\s>#*_-]*(核图|改了什么|出图提示词)[*_]*[：:][*_]*\s*(.*)$/.exec(l);   // 出图提示词在最后：它下面的都算它的
      if (m) { cur = m[1]; v[cur] = m[2] ? [m[2]] : []; } else if (cur) v[cur].push(l);
    }
    const one = k => oneLine((v[k] || []).join(' ')).slice(0, 300), p = (v.出图提示词 || []).join('\n').trim();
    return { 核图: one('核图'), 改了什么: one('改了什么'), 提示词: p.length >= 20 && !/^[（(]?(没改|不改|无|没有|不用改|样子没改)/.test(p) ? p : '' };
  }

  /* ---------- 出图、照批注改图 ---------- */
  function msgOf(j, mode, files, tell) {   // 发进 Codex 的话（头一行的对话名 handoff 加）：不写 Markdown 列表、不空行，codex-chat 才核得上输入框
    const f = j.files, abs = parts => pj(j.项目, ...parts);
    return ['请照这份任务书做这一张图（先完整读一遍再动手）：' + TASK,
      '这一张：' + j.类别 + '「' + label(j) + '」',
      ...(mode === 'edit' ? ['这回先照图上的批注改。原图：' + abs(f.img), '批注：' + abs(f.imgNote), ...(j.有标注 ? ['标注图：' + abs([...f.shots, '标注图.jpg'])] : [])] : []),
      ...(j.有字 ? [(mode === 'edit' ? '提示词文件（这张图本来要画什么，只用来了解，别照它重画）：' : '提示词文件：') + abs(f.txt)] : []),
      ...(mode === 'edit' || !Src ? [] : Src.msgLines(j.变了)),   // 描写改了、镜头多了（11-23）：先照现在的改字再出
      ...(mode === 'edit' || !j.卡 || !FaceCard ? [] : FaceCard.drawLines(j.卡.原图)),   // 人物卡（11-26）：字没写成人物卡的先改；竖幅原图交过去照它出
      '候选图路径：' + abs(f.cand),
      '旧候选挪进：' + pj(j.项目, '历史记录', ...f.cand.slice(0, -1)),
      '回复文件：' + files.reply,
      '定稿或者不出了，写好回复文件以后跑这一句告诉项目（跑不了也没关系，项目自己会看到回复文件）：',
      tell[tell.length - 1],
      mode === 'edit' ? '先改出第一张给我看。' : '先出第一张给我看。'].join('\n');
  }
  async function draw(j, mode) {
    const flow = await readFlow(j.项目);
    await needFinal(j, flow);
    const f = j.files, abs = parts => pj(j.项目, ...parts), what = mode === 'edit' ? '照批注改图' : '出图';
    j.有字 = await exists(abs(f.txt));
    if (mode === 'edit') {
      if (!(await exists(abs(f.img)))) throw fail('图不在了：' + f.img.join('/'));
      if (!(await exists(abs(f.imgNote)))) throw fail('还没在图上写批注：点开这张图，框出来写');
      j.有标注 = await exists(abs([...f.shots, '标注图.jpg']));
    } else {
      if (!j.有字) throw fail('还没有出图提示词：先让 AI 写，你看过再出图');
      if (TxtWord && TxtWord.isTxt(unbom(await fsp.readFile(abs(f.txt), 'utf8')))) throw fail('这份是只用文字时写的文字描写，不是出图提示词：先让 AI 改成出图提示词，再出图');   // 11-17
      delete j.卡;
      const e = FaceCard && j.类别 === '人物' ? (Array.isArray(flow.人物) ? flow.人物 : []).find(x => x && x.名 === j.名) : null;
      if (FaceCard && j.类别 === '人物' && !FaceCard.bodyOnly(e)) {   // 人物卡（11-26，公用/人物卡.js）：点了「只要全身」的照旧；原图是竖幅全身照的，交给 Codex 照它改成人物卡
        const z = await fsp.readFile(abs(f.img)).then(FaceCard.sizeOf, () => null);
        j.卡 = { 原图: z && FaceCard.tall(z.w, z.h) ? abs(f.img) : '' };
      }
    }
    if (!j.续) await drop(j.项目, f);   // 上一张候选没用上：收进历史记录。服务重开后接着等的不收：那一张可能就是聊出来的
    if (j.停) throw fail('停掉了');
    const check = async text => {   // 回复到了先查：格式对不对、定下来的那张在不在。不对就接着等 Codex 改好
      const r = parse(text);
      if (r.bad) throw retry(r.bad);
      if (!r.drop && !(await exists(abs(f.cand)))) throw retry('候选图路径上没有图：' + abs(f.cand) + '。把定下来的那张放到这里，再跑一次那一句');
    };
    const said = (await handoff(j, {}, 'codex', [], check)).trim();
    await writeFile(path.join(j.dir, 'Codex的回复.md'), said + '\n');
    const r = parse(said);
    if (r.drop) {
      await drop(j.项目, f);
      await noteList(j, { _log: logOf(j, what + '（在 Codex 里说不出了）', 'Codex') });
      return { 结果: '在 Codex 里说不出了' + (r.why ? '：' + r.why : ''), 产出: [] };
    }
    const wrote = r.提示词 && j.有字 ? await putPrompt(j.项目, f.txt, r.提示词) : false;   // 先换字再换图（11-23）：图确认的时间在字后面，不然一换上就算「字改了」
    const snap = mode === 'edit' ? null : j.照 || (Src && Src.KINDS.includes(j.类别) ? Src.nowOf(await readFlow(j.项目), j.类别, j.名) : undefined);   // 照的哪一句：点出图那一刻的；照批注改的照留原来的
    const got = await take(j.项目, f, true, { 照: snap, 字: mode === 'edit' || !j.有字 ? '' : f.txt.join('/') });
    await noteList(j, { 状态: '有了', 候选: '', 核图: r.核图, 核图时间: await mtimeOf(abs(f.img)), 说明: (j.状态名 ? j.状态名 + '；' : '') + nowText().slice(5, 16) + ' 在 Codex 里定稿',
      _log: logOf(j, what + '（在 Codex 里定稿）', 'Codex') });
    return { 结果: '在 Codex 里定稿了，换上了，算确认可用' + (got.旧图 ? '（旧图收进了历史记录）' : '') + (wrote ? '；聊的时候样子改了，出图提示词照着改了' : '')
      + (r.核图 && !/没看出问题/.test(r.核图) ? '。核图：' + r.核图 : ''), 产出: [f.img.join('/')] };
  }
  /* 页面点出图时交过来的：照现在哪一句出（照的）、和原来比变了什么（变了）。字数有上限，只留认得的 */
  function srcPrep(j) {
    const p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {}, a = Src ? Src.cleanSnap(p.照) : null, b = Src ? Src.cleanDiff(p.变了) : null;
    if (a) j.照 = a; else delete j.照;
    if (b) j.变了 = b; else delete j.变了;
  }
  const chat = m => m.方式 === 'codex' || !!m.聊;   // 服务重开后接着等：11-23 起在 Codex 里聊的才接（聊出来的一直存在候选图路径上）；以前一次出一张的任务书不一样了，不接
  const KINDS = {
    出图: {
      title: j => '出图 · ' + label(j), need: ['段'], key: j => j.类别 + '/' + j.文件名, codex: true, 接得上: chat,
      prep: async j => { await wordPrep(j); srcPrep(j); }, run: j => draw(j, 'draw'), codexMsg: (j, files, tell) => msgOf(j, 'draw', files, tell),
    },
    改图: {
      title: j => '照批注改图 · ' + label(j), need: ['段'], key: j => j.类别 + '/' + j.文件名, codex: true, 接得上: chat,
      prep: wordPrep, run: j => draw(j, 'edit'), codexMsg: (j, files, tell) => msgOf(j, 'edit', files, tell),
    },
  };
  return { KINDS, link, take, drop, openThread, parse, started };
};
