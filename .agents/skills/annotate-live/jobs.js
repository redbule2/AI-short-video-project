'use strict';
/* ============================================================
   AI 任务：页面上点一下（扩写剧本、补细描写、按批注改、出图、批注提示词……），这里开一个任务，
   去调本机的 AI，做完按固定格式落盘。页面隔两秒来问一次进度，所以能显示「在做什么、做了多久」。

   三条通道，都只让 AI 回文字，落盘由这里做（剧本、镜头表走 通用工具/剧本读写.js，旧版自动进历史记录）：
     claude    本机的 Claude Code 命令行：claude -p --tools ""（不给它任何工具，只写字）
     codex     本机的 Codex 桌面版：经 codex-chat 开一个看得见的对话，读任务书、回复
     deepseek  DeepSeek 接口：经 deepseek.py
   每个任务在项目的 历史记录/AI任务/<时间>_<事>/ 里留一份 任务书.md 和 答卷.md，出了问题好查。

   接口（都要带 X-Antou 头，server.js 里已经查过）：
     POST /api/job            {事, 渠道, 项目, 段?, …}  → 开一个任务
     GET  /api/job?p=项目      这个项目最近的任务
     GET  /api/job?channels   哪几条通道能用
     GET  /api/job/<id>       一个任务现在什么样
     POST /api/job/<id>?cancel 停掉
   ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

module.exports = function makeJobs({ ROOT, TOOLS, log, withFileLocks = async (paths, fn) => fn() }) {
  const SKILLS = path.resolve(__dirname, '..');   // .agents/skills
  const HOME = path.join(ROOT, '项目');
  const RW = path.join(TOOLS, '剧本读写.js');
  const two = n => String(n).padStart(2, '0');
  const stampOf = (d = new Date()) => d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
  const nowText = (d = new Date()) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  const today = () => nowText().slice(0, 10);
  const mmdd = () => nowText().slice(5, 10);
  const timeOf = t => { const n = Date.parse(String(t || '').trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const unbom = s => s.replace(/^\uFEFF/, '');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const segOk = s => /^[0-9]+(-[0-9]+)*$/.test(s);
  const nameOk = s => !!s && !/[<>:"\\/|?*\u0000-\u001f]/.test(s) && !/^\.+$/.test(s) && !/[. ]$/.test(s);
  const exists = p => fsp.stat(p).then(() => true, () => false);
  const str = v => typeof v === 'string' ? v : '';
  const fail = msg => Object.assign(new Error(msg), { plain: true });
  const pj = (name, ...parts) => path.join(HOME, name, ...parts);
  const segDir = seg => '第' + seg + '段';
  async function writeFile(p, text) {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    const tmp = p + '.antou-tmp';
    await fsp.writeFile(tmp, text);
    await fsp.rename(tmp, p);
  }
  /* 改版前的那一份挪进历史记录：项目/历史记录/同样的路径/原名__时间.后缀 */
  async function archive(name, relParts, stamp) {   // stamp：几样一起收（图和它的批注）时用同一个时间，放回来时才对得上
    const src = pj(name, ...relParts);
    if (!(await exists(src))) return '';
    const base = relParts[relParts.length - 1], dot = base.lastIndexOf('.');
    const dst = pj(name, '历史记录', ...relParts.slice(0, -1), (dot > 0 ? base.slice(0, dot) : base) + '__' + (stamp || stampOf()) + (dot > 0 ? base.slice(dot) : ''));
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.rename(src, dst);
    return dst;
  }

  /* ---------- 起一个子进程，等它做完 ---------- */
  function kill(child) {
    if (!child || child.exitCode !== null) return;
    if (process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGKILL');
  }
  function run(cmd, args, { cwd, input, env, timeout = 25 * 60e3, job } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      try { child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true }); }
      catch (e) { reject(e); return; }
      if (job) job.child = child;
      const out = [], err = [];
      child.stdout.on('data', c => out.push(c));
      child.stderr.on('data', c => err.push(c));
      const timer = setTimeout(() => { kill(child); reject(fail('等了 ' + Math.round(timeout / 60e3) + ' 分钟还没好，停掉了')); }, timeout);
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => {
        clearTimeout(timer);
        if (job && job.child === child) job.child = null;
        resolve({ code, out: Buffer.concat(out).toString('utf8'), err: Buffer.concat(err).toString('utf8') });
      });
      child.stdin.on('error', () => { /* 对方先关了 */ });
      child.stdin.end(input == null ? '' : input);
    });
  }
  const node = (args, opt) => run(process.execPath, args, opt);

  /* ---------- 三条通道：给一份任务书，拿回一段文字 ---------- */
  const CLAUDE = process.env.ANTOU_CLAUDE || [path.join(os.homedir(), '.local', 'bin', 'claude.exe')].find(p => fs.existsSync(p)) || 'claude';
  const PY = [process.env.BRIDGE_PY, 'D:/Apps/Blender/blender-5.2.3-windows-x64/5.2/python/bin/python.exe'].find(p => p && fs.existsSync(p)) || '';
  const DS = path.join(SKILLS, 'deepseek', 'deepseek.py');
  const CX = path.join(SKILLS, 'codex-chat', 'codex-chat.ps1');
  const resultJson = out => { const m = /RESULT_JSON (\{.*\})\s*$/m.exec(out); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } };
  const SEE = imgs => '先用 Read 工具把下面 ' + imgs.length + ' 张图各看一遍（只读，不要动任何文件，不要用别的工具）：\n' + imgs.join('\n') + '\n\n看完再照下面的任务书做，回复里只要任务书要的内容。\n\n';
  const CHANNELS = {
    claude: {
      名: 'Claude', 说明: '本机的 Claude Code，只让它写字',
      ok: () => CLAUDE === 'claude' || fs.existsSync(CLAUDE),
      async ask(job, book, files, images) {
        const imgs = images || [];   // 要它看的图：只给它开「读文件」这一样工具，别的都不给
        const args = imgs.length ? ['-p', '--tools', 'Read', '--allowedTools', 'Read', '--add-dir', pj(job.项目), '--no-session-persistence', '--output-format', 'text'] : ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'text'];
        const r = await run(CLAUDE, args, { cwd: os.tmpdir(), input: imgs.length ? SEE(imgs) + book : book, job });
        if (r.code !== 0 || !r.out.trim()) throw fail('Claude 没答上来：' + (r.err.trim() || r.out.trim() || '退出码 ' + r.code).slice(0, 300));
        return r.out;
      },
    },
    codex: {
      名: 'Codex', 说明: '本机的 Codex 桌面版，会开一个看得见的对话',
      ok: () => process.platform === 'win32' && fs.existsSync(CX),
      async ask(job, book, files, images) {
        await writeFile(files.msg, '请读 ' + files.book + '，照里面的要求回复。只回复结果，不要改任何文件，不要运行命令。' + ((images || []).length ? '动笔前先把这几张图各打开看一遍：' + images.join('　') : ''));
        const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CX, '-PromptFile', files.msg, '-Path', HOME, '-Timeout', '1500'], { job, timeout: 27 * 60e3 });
        await fsp.unlink(files.msg).catch(() => {});
        const j = resultJson(r.out);
        if (!j || !j.ok) throw fail('Codex 没答上来：' + ((j && j.error) || r.err.trim() || r.out.trim() || '没有结果').slice(0, 300));
        const a = r.out.indexOf('=== Codex 回复 ==='), z = r.out.lastIndexOf('RESULT_JSON ');
        const text = a >= 0 && z > a ? r.out.slice(a + '=== Codex 回复 ==='.length, z) : '';
        if (!text.trim()) throw fail('Codex 回了空的');
        return text;
      },
    },
    deepseek: {
      名: 'DeepSeek', 说明: 'DeepSeek 接口，按量计费',
      ok: () => !!PY && fs.existsSync(DS),
      async ask(job, book, files, images) {
        const fwd = p => p.replace(/\\/g, '/');
        const r = await run(PY, ['-I', DS, '--effort', 'high', '-f', fwd(files.book), '--out', fwd(files.raw), ...(images || []).flatMap(p => ['--image', fwd(p)])], { env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MSYS_NO_PATHCONV: '1' }, job });
        const j = resultJson(r.out);
        if (!j || !j.ok) throw fail('DeepSeek 没答上来：' + ((j && j.error) || r.err.trim() || '没有结果').slice(0, 300));
        if (j.truncated) throw fail('DeepSeek 的回答太长，被截断了。换 Claude 或 Codex 试试');
        const text = await fsp.readFile(j.out || files.raw, 'utf8');
        await fsp.unlink(j.out || files.raw).catch(() => {});
        return text;
      },
    },
  };
  /* 试页面用的假通道：ANTOU_MOCK_DIR 里放 <事>.txt 当答卷（只在试验服务上开） */
  if (process.env.ANTOU_MOCK_DIR) CHANNELS.mock = {
    名: '假的（试页面用）', 说明: '', ok: () => true,
    async ask(job) { await sleep(Number(process.env.ANTOU_MOCK_MS) || 2500); return fsp.readFile(path.join(process.env.ANTOU_MOCK_DIR, job.事 + '.txt'), 'utf8'); },
  };

  /* ---------- 读项目里的东西 ---------- */
  const AI_FILE = '流水线_AI扩写.json';
  async function readFlow(name) {
    const p = pj(name, '定稿的剧本', '流水线.json');
    if (!(await exists(p))) throw fail('这个项目还没有流水线');
    return JSON.parse(unbom(await fsp.readFile(p, 'utf8')));
  }
  const sceneOf = (flow, seg) => (Array.isArray(flow.场) ? flow.场 : []).find(s => s && str(s.段) === seg) || null;
  const parasOf = s => (Array.isArray(s.段落) && s.段落.length ? s.段落 : Array.isArray(s.镜头) ? s.镜头 : []).map(x => ({ 写什么: str(x.写什么 !== undefined ? x.写什么 : x.拍什么).trim(), 作用: str(x.作用).trim() })).filter(x => x.写什么 || x.作用);
  const rowsText = (rows, pick) => (Array.isArray(rows) ? rows : []).filter(e => e && e.名 && (!pick || pick.includes(e.名))).map(e => e.名 + '：' + (str(e.描写).trim() || '（还没写）')).join('\n') || '（没有）';
  async function docText(file) {
    const r = await node([RW, '读', file]);
    if (r.code !== 0) throw fail('读不了 ' + path.basename(file) + '：' + (r.out + r.err).trim().slice(0, 200));
    return r.out.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  }
  const scriptPath = (name, seg) => pj(name, '定稿的剧本', segDir(seg), segDir(seg) + '_剧本.docx');
  const shotsPath = (name, seg) => pj(name, '定稿的剧本', segDir(seg), segDir(seg) + '_镜头表.docx');
  async function skill(name, from, to) {   // 技能说明里的一段：从哪个小标题到哪个小标题之前
    const t = unbom(await fsp.readFile(path.join(SKILLS, name, 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');
    const a = from ? t.indexOf(from) : 0, z = to ? t.indexOf(to, a + 1) : -1;
    return (a < 0 ? t : t.slice(a, z > a ? z : undefined)).trim();
  }
  /* AI 的回答里掐出正文：去掉代码块的围栏，从认得出的那一行开始 */
  function body(text, startRe) {
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter(l => !/^\s*```/.test(l));
    const i = startRe ? lines.findIndex(l => startRe.test(l.trim())) : 0;
    return lines.slice(i < 0 ? 0 : i).join('\n').trim();
  }
  function jsonIn(text) {
    const a = text.indexOf('{'), z = text.lastIndexOf('}');
    if (a < 0 || z <= a) throw fail('AI 没按要的格式回（要一段 JSON）');
    try { return JSON.parse(text.slice(a, z + 1)); } catch (e) { throw fail('AI 回的 JSON 读不了：' + e.message); }
  }
  /* 照固定格式查一遍，再写成 Word（那里已有的旧文件，剧本读写.js 会先挪进历史记录） */
  async function writeDoc(job, kind, file, text) {
    const tmp = path.join(job.dir, kind + '.txt');
    await writeFile(tmp, text + '\n');
    const c = await node([RW, '查', tmp, kind]);
    if (c.code !== 0) throw fail('AI 写的' + kind + '不合固定格式：' + (c.out + c.err).trim().split('\n').slice(0, 4).join('；').slice(0, 300));
    const w = await node([RW, kind === '剧本' ? '写剧本' : '写镜头表', file, tmp]);
    if (w.code !== 0) throw fail('没写成：' + (w.out + w.err).trim().slice(0, 300));
  }
  const settingText = flow => ['梗概：' + (str(flow.梗概).trim() || '（还没写）'), '', '人物（叫法：描写）：', rowsText(flow.人物), '', '场景：' + (str(flow.场景).trim() || '（还没写）'), '', '道具（名字：描写）：', rowsText(flow.道具)].join('\n');
  function sceneText(flow, s) {
    const ps = parasOf(s);
    return ['出场的人物：' + ((s.人物 || []).join('、') || '（没选）'), '出场的道具：' + ((s.道具 || []).join('、') || '（没选）'),
      '这一场主要表达：' + (str(s.表达).trim() || '（没写）'), '', '剧本段落（一共 ' + ps.length + ' 段，照这个顺序）：',
      ...ps.map((x, i) => '段落' + (i + 1) + '　写什么：' + (x.写什么 || '（空）') + '　起什么作用：' + (x.作用 || '（没写）'))].join('\n');
  }
  function finalOk(s, scriptMtime) {   // 剧本定稿了没有：有这个时间，不早于段落定下来的时间，也不早于剧本文件最后改动的时间
    const fin = timeOf(s.剧本定稿);
    return !!fin && fin >= timeOf(s.定稿) && fin + 999 >= scriptMtime;
  }

  /* ---------- 各样事：怎么写任务书（book），AI 答完怎么落盘（apply） ---------- */
  const TAIL = '\n\n只回复要的内容本身，不要解释，不要寒暄，不要用代码块围起来。';
  const KINDS = {
    扩写剧本: {
      title: j => '扩写剧本 · 第' + j.段 + '场', need: ['段'],
      async book(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段);
        if (!s) throw fail('流水线里没有第' + j.段 + '场');
        if (!s.定稿) throw fail('这一场的段落还没定下来');
        if (!parasOf(s).length) throw fail('这一场还没有剧本段落');
        const all = flow.场.filter(x => x && x.段), i = all.indexOf(s), near = [all[i - 1], all[i + 1]];
        const old = (await exists(scriptPath(j.项目, j.段))) ? await docText(scriptPath(j.项目, j.段)) : '';
        return ['# 任务：把一场的剧本段落写成剧本', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面有全片的设定、这一场要表达什么、和人写好的剧本段落。请照段落的顺序，把每个段落写成剧本：写出看得见的动作和台词。',
          '', '## 要求', '1. 只写剧本。不写镜头表，不写机位、运镜、时长。', '2. 段落的顺序不能改，每个段落要起到它写明的作用；一个段落可以写成好几行动作和台词。',
          '3. 人物用人物表里的叫法。表里没有的群众可以加，写成「路人若干」这一类。', '4. 严格照下面的「固定格式」写：第一行是标题「第' + j.段 + '段｜' + (str(s.名).trim() || '段名') + '」，接着场景、人物、梗概三行，然后单独一行「正文」，正文每一行只能是 △ 动作、角色：台词、字幕：、音效： 四种之一，最后单独一行「备注」，备注下面写一行：' + mmdd() + ' 照流水线第' + j.段 + '场扩写。',
          '5. 照「写戏规矩」写：人物的反应要合常理，不过度演绎。', '', '## 固定格式和写戏规矩', await skill('script-shotlist-format', '## 二、剧本骨架', '## 四、镜头表骨架'),
          '', '## 全片的设定', settingText(flow), '', '## 这一场：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'), sceneText(flow, s),
          '', '## 前后两场（只为了衔接，不要写进这一场）', near.map((x, k) => x ? (k ? '下一场' : '上一场') + '：第' + x.段 + '段 ' + str(x.名).trim() + '。' + str(x.表达).trim() : (k ? '下一场：没有' : '上一场：没有')).join('\n'),
          old ? '\n## 这一场现在的剧本（重新写，可以参考，不必照搬）\n' + old : '', TAIL + '从「第' + j.段 + '段｜」那一行开始。'].join('\n');
      },
      async apply(j, text) {
        await writeDoc(j, '剧本', scriptPath(j.项目, j.段), body(text, new RegExp('^第\\s*' + j.段.replace(/-/g, '\\s*[-－—–]\\s*') + '\\s*段')));
        return { 结果: '剧本写好了', 产出: ['定稿的剧本/' + segDir(j.段) + '/' + segDir(j.段) + '_剧本.docx'] };
      },
    },
    补细: {
      title: j => '补细描写 · ' + [...(j.人物 || []), ...(j.道具 || [])].join('、'), key: j => 'all',
      async book(j) {
        const flow = await readFlow(j.项目), ask = [];
        for (const k of ['人物', '道具']) for (const n of j[k] || []) {
          const e = (flow[k] || []).find(x => x && x.名 === n);
          if (!e) continue;
          const imgs = (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : []).map(f => path.basename(String(f)).replace(/\.[^.]+$/, ''));
          ask.push(k + '「' + n + '」：现在写的是「' + (str(e.描写).trim() || '（空）') + '」' + (imgs.length ? '；已经有图，图名：' + imgs.join('、') : ''));
        }
        if (!ask.length) throw fail('没有要补的');
        j.要补 = ask.length;
        return ['# 任务：把人物、道具的描写补细', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面几个人物、道具的描写太粗，请照全片的梗概把它们补细，后面要照这些描写出图。',
          '', '## 要求', '1. 只写看得见的。人物：年纪、长相、身材、穿着、一两处特征；道具：样子、结构、材质、颜色、新旧。两三句话，不写性格和心理。',
          '2. 现在写的那句要是个要求（比如「这辆车要重新生成，要能坐下父子两个人」），就写成满足这个要求的样子。', '3. 和梗概的年代、地方对得上；同一个人物、道具前后别矛盾。',
          '4. 回复一段 JSON，名字照抄，一个字不改，像这样：', '{"人物": {"名字": "补细后的描写"}, "道具": {"名字": "补细后的描写"}}', '', '## 全片的设定', settingText(flow), '', '## 要补细的', ask.join('\n'), TAIL].join('\n');
      },
      async apply(j, text) {
        const got = jsonIn(text), flow = await readFlow(j.项目), p = pj(j.项目, '定稿的剧本', AI_FILE);
        let cur = {};
        try { cur = JSON.parse(unbom(await fsp.readFile(p, 'utf8'))); } catch (e) { cur = {}; }
        let n = 0;
        for (const k of ['人物', '道具']) {
          const src = got[k] && typeof got[k] === 'object' ? got[k] : {};
          for (const name of j[k] || []) {
            const t = str(typeof src[name] === 'string' ? src[name] : src[name] && src[name].描写).trim();
            if (!t || !(flow[k] || []).some(e => e && e.名 === name)) continue;
            cur[k] = cur[k] && typeof cur[k] === 'object' ? cur[k] : {};
            cur[k][name] = { 描写: t, 时间: nowText() }; n++;
          }
        }
        if (!n) throw fail('AI 回的里面没有要补的那几样');
        await writeFile(p, JSON.stringify(cur, null, 2) + '\n');
        return { 结果: '补好了 ' + n + ' 样，到全片设定里点开看，合适再采用', 产出: ['定稿的剧本/' + AI_FILE] };
      },
    },
    场景GEO: {
      title: () => '场景照 GEO 扩写', key: j => 'all',
      async book(j) {
        const flow = await readFlow(j.项目);
        if (!str(flow.场景).trim() && !(flow.场景图 || []).length) throw fail('场景那一格还空着');
        const imgs = [];   // 引用的场景图：让 AI 看着图建底稿（GEO 要照生成好的参考图核）
        for (const g of flow.场景图 || []) { const p = pj(j.项目, ...String(g).replace(/\\/g, '/').split('/')); if (/\.(png|jpe?g|webp)$/i.test(p) && await exists(p)) imgs.push(p); }
        j.images = imgs;
        return ['# 任务：照 scene-geo 的办法，把全片的场景写清楚', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是人写的全片场景（比较粗），请照 scene-geo 技能的办法：先出 GEO 底稿（只给人审，核清楚空间关系），再翻成场景段（简短的中文句子，一处地方一段）。',
          '', '## 要求', '1. 人写了的地方不能丢，也别加梗概里没有的地方。' + (imgs.length ? '引用的场景图已经让你看过了：底稿照图核，图上有什么、各在哪、从哪往哪看，都以图为准；图和人写的对不上的地方，在底稿里单列出来。' : ''), '2. 回复只有两块，照这个样子：', '【GEO底稿】', '（底稿正文）', '【场景段】', '（场景段正文，一处地方一段）',
          '', '## 全片的设定', settingText(flow), '', '引用的场景图：' + ((flow.场景图 || []).map(f => path.basename(String(f))).join('、') || '（没有）'), '', '## scene-geo 技能', await skill('scene-geo'), TAIL].join('\n');
      },
      async apply(j, text) {
        const t = text.replace(/\r\n/g, '\n'), a = t.indexOf('【GEO底稿】'), z = t.indexOf('【场景段】');
        if (a < 0 || z < a) throw fail('AI 没按要的格式回（要【GEO底稿】和【场景段】两块）');
        const geo = t.slice(a + 7, z).trim(), seg = body(t.slice(z + 5));
        if (!seg) throw fail('AI 没写出场景段');
        const flow = await readFlow(j.项目), first = (flow.场景图 || [])[0];
        const rel = ['提示词', '全局资产', '场景', (first ? path.basename(String(first)).replace(/\.[^.]+$/, '') : '全片场景') + '_GEO底稿.md'];
        await archive(j.项目, rel);
        await writeFile(pj(j.项目, ...rel), geo + '\n');
        const p = pj(j.项目, '定稿的剧本', AI_FILE);
        let cur = {};
        try { cur = JSON.parse(unbom(await fsp.readFile(p, 'utf8'))); } catch (e) { cur = {}; }
        cur.场景 = { 描写: seg, 底稿: rel.join('/'), 时间: nowText() };
        await writeFile(p, JSON.stringify(cur, null, 2) + '\n');
        return { 结果: '场景写好了，到全片设定的「场景」里看，合适再采用', 产出: [rel.join('/'), '定稿的剧本/' + AI_FILE] };
      },
    },
    按批注改: {
      title: j => '按批注改 · ' + path.basename(str(j.批注)).replace(/_批注\.md$/, ''), key: j => str(j.批注),
      async prep(j) {
        const parts = str(j.批注).split('/').filter(Boolean);
        if (parts[0] === '项目') parts.shift();
        if (parts[0] !== j.项目 || parts[1] !== '定稿的剧本' || !/_批注\.md$/.test(parts[parts.length - 1]) || parts.some(x => !nameOk(x))) throw fail('这份批注不在这个项目的 定稿的剧本 里');
        j.rel = parts.slice(1);
        const doc = j.rel.slice(0, -1).concat(j.rel[j.rel.length - 1].replace(/_批注\.md$/, '.docx'));
        if (!(await exists(pj(j.项目, ...j.rel)))) throw fail('批注文件不在了');
        if (!(await exists(pj(j.项目, ...doc)))) throw fail('要改的那份 Word 不在了');
        j.doc = doc; j.kind = /镜头表/.test(doc[doc.length - 1]) ? '镜头表' : '剧本';
        const m = /第([0-9-]+)段/.exec(doc[doc.length - 1]); if (m) j.段 = m[1];
      },
      async book(j) {
        const note = unbom(await fsp.readFile(pj(j.项目, ...j.rel), 'utf8')), text = await docText(pj(j.项目, ...j.doc));
        return ['# 任务：按批注改' + j.kind, '', '今天 ' + today() + '。下面是一份' + j.kind + '的原文，和人写的批注。请照批注改。',
          '', '## 要求', '1. 只改批注说到的地方，别的一个字都不动（包括标点、空格）。', '2. 批注要是把原文抄下来改过的，就是要这一行改成批注里写的样子，照抄批注，不要再润色。',
          '3. 批注里那句话末尾没打标点的，沿用原句末尾的标点；明显的错别字（的地得、同音字）可以顺手改对；省略号写成「……」；动作行前面的「△ 」要留着。',
          '4. 批注是提要求的（比如「这句太夸张」），就照要求改这一处，改动尽量小。', j.kind === '剧本' ? '5. 在最后「备注」那一节末尾加一行：' + mmdd() + ' 按批注改：（用一句话说清改了哪几处）。原来的备注一行都不动。' : '5. 镜头从 1 连续编号，一镜一行，概述不超过十个字。',
          '6. 回复改好以后的整份' + j.kind + '，从第一行标题开始，格式和原文一样。', '', '## 原文', text, '', '## 批注', note, TAIL].join('\n');
      },
      async apply(j, text) {
        await writeDoc(j, j.kind, pj(j.项目, ...j.doc), body(text, /^第.+段/));
        await archive(j.项目, j.rel);
        return { 结果: j.kind + '按批注改好了，改动的地方显示成红批', 产出: [j.doc.join('/')] };
      },
    },
    批注段落: {
      title: j => 'AI 批注段落 · 第' + j.段 + '场', need: ['段'],
      async book(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段);
        if (!s) throw fail('流水线里没有第' + j.段 + '场');
        if (!parasOf(s).length) throw fail('这一场还没有剧本段落');
        return ['# 任务：给人写的剧本段落提意见', '', '今天 ' + today() + '。这是一个 AI 短视频项目。人给这一场写了「主要表达什么」和几个剧本段落（每段写什么、起什么作用）。请你当一个懂戏的编辑，看完提意见，帮他在定下来以前把段落理顺。',
          '', '## 怎么看', '1. 这几段连起来，能不能把「主要表达」讲出来？前因后果连不连得上？', '2. 每一段的作用清不清楚，有没有两段在干同一件事，有没有缺一段。',
          '3. 人物的反应合不合常理，有没有过度演绎（一上来就爆发）。', '4. 和全片的梗概、人物对不对得上。', '5. 意见要具体、能照着改，用大白话，每条一两句。写得好的地方不用夸，没意见的段落不用写。',
          '', '## 回复一段 JSON，像这样', '{"总评": "一两句话说这一场现在最要紧的问题；没有大问题就说可以定了", "各段": [{"段落": 2, "意见": "……"}]}',
          '', '## 全片的设定', settingText(flow), '', '## 这一场：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'), sceneText(flow, s), TAIL].join('\n');
      },
      async apply(j, text) {
        const got = jsonIn(text), flow = await readFlow(j.项目), n = parasOf(sceneOf(flow, j.段)).length;
        const list = (Array.isArray(got.各段) ? got.各段 : []).map(x => ({ 段落: Number(x && x.段落), 意见: str(x && x.意见).trim() })).filter(x => x.意见 && x.段落 >= 1 && x.段落 <= n);
        const rel = ['定稿的剧本', segDir(j.段), segDir(j.段) + '_段落_AI批注.json'];
        await writeFile(pj(j.项目, ...rel), JSON.stringify({ 说明: 'AI 给这一场的剧本段落提的意见（页面只读，看完可以收起）。', 时间: nowText(), 渠道: j.渠道, 总评: str(got.总评).trim(), 各段: list }, null, 2) + '\n');
        return { 结果: 'AI 看完了：' + (list.length ? list.length + ' 条意见' : '没有具体意见'), 产出: [rel.join('/')] };
      },
    },
  };

  /* ---------- 工序三：出图。先让选的那个 AI 把出图提示词写好，再交给 Codex 出图（出图只走 Codex） ---------- */
  const crypto = require('crypto');
  const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
  const CATS = { 人物: '人物', 道具: '道具', 场景: '场景' };
  const IMG_TASK = path.join(TOOLS, '流水线', '任务书', '资产出图任务.txt');
  async function codexDo(j, msg) {   // 让 Codex 真去做一件事（它会开一个看得见的对话）
    const f = path.join(j.dir, '发给Codex的话.txt');
    await writeFile(f, msg);
    const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CX, '-PromptFile', f, '-Path', HOME, '-Timeout', '1700'], { job: j, timeout: 30 * 60e3 });
    const res = resultJson(r.out);
    if (!res || !res.ok) throw fail('Codex 没做成：' + ((res && res.error) || r.err.trim() || r.out.trim() || '没有结果').slice(0, 300));
    const a = r.out.indexOf('=== Codex 回复 ==='), z = r.out.lastIndexOf('RESULT_JSON ');
    return a >= 0 && z > a ? r.out.slice(a + '=== Codex 回复 ==='.length, z).trim() : '';
  }
  async function askText(j, chId, book, tag) {   // 多一步的事：中间要 AI 写一段字
    const ch = CHANNELS[chId], files = { book: path.join(j.dir, '任务书_' + tag + '.md'), raw: path.join(j.dir, '答卷_' + tag + '_原样.md'), msg: path.join(j.dir, '发给Codex的话.txt') };
    await writeFile(files.book, book);
    j.步骤 = ch.名 + ' 在写' + tag;
    const text = await ch.ask(j, book, files);
    await writeFile(path.join(j.dir, '答卷_' + tag + '.md'), text);
    return text;
  }
  async function updateList(name, seg, item) {   // 资产清单里记一笔：页面看到图在了，会替人把它和表里那一行对上
    const p = pj(name, '资产', segDir(seg) + '_资产清单.json');
    let cur = { 资产: [] };
    try { const t = JSON.parse(unbom(await fsp.readFile(p, 'utf8'))); cur = Array.isArray(t) ? { 资产: t } : t; } catch (e) { /* 还没有清单 */ }
    cur.资产 = (Array.isArray(cur.资产) ? cur.资产 : []).filter(x => !(x && x.文件 === item.文件));
    cur.资产.push(item);
    await writeFile(p, JSON.stringify(cur, null, 2) + '\n');
  }
  Object.assign(KINDS, {
    出图: {
      title: j => '出图 · ' + j.名 + (j.状态名 ? '（' + j.状态名 + '）' : ''), need: ['段'], key: j => j.类别 + '/' + j.文件名, codex: true,
      async prep(j) {
        if (!CATS[j.类别]) throw fail('只出人物、道具、场景的图');
        j.文件名 = j.状态名 ? j.名 + '_' + j.状态名 : j.名;
        if (!nameOk(j.文件名)) throw fail('名字里有不能当文件名的字');
        if (!CHANNELS.codex.ok()) throw fail('出图要用 Codex，这台电脑上调不起来');
      },
      async run(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
        if (!s || !(await exists(sp)) || !finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs))) throw fail('剧本定稿以后才能出资产图');
        const img = ['资产', '全局资产', j.类别, j.文件名 + '.png'], prm = ['提示词', '全局资产', j.类别, j.文件名 + '_提示词.txt'];
        const e = j.类别 === '场景' ? null : (flow[j.类别] || []).find(x => x && x.名 === j.名);
        if (await exists(pj(j.项目, ...img))) {
          const mine = e ? (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : []).map(g => String(g).replace(/\\/g, '/')) : [];
          if (!e || mine.includes(img.join('/'))) throw fail('这张图已经有了：' + img.join('/') + '。不要的话先在资产页删掉再出');
          const stamp = stampOf(), dir = img.slice(0, -1);
          await archive(j.项目, img, stamp);   // 这一行已经不引用它了（点过「只是不引用」）：旧图收进历史记录，再出新的
          await archive(j.项目, [...dir, j.文件名 + '_批注.md'], stamp);   // 旧图的批注、批注截图跟着走：不然新图一打开就带着旧批注
          await archive(j.项目, [...dir, j.文件名 + '_批注截图'], stamp);
        }
        if (await exists(pj(j.项目, ...prm))) {   // 出图提示词已经有了：描写在它之后改过、或者人说了要重写，就把旧的收进历史记录，照现在的描写重写；不然用上一回的再出一张
          const pt = Math.floor((await fsp.stat(pj(j.项目, ...prm))).mtimeMs);
          if (j.重写 === '是' || (e && timeOf(e.描写改) > pt)) await archive(j.项目, prm);
        }
        if (!(await exists(pj(j.项目, ...prm)))) {
          const tone = pj(j.项目, '提示词', '全局资产', '全片_光影总基调.txt');
          const book = ['# 任务：给一张资产图写出图提示词', '', '今天 ' + today() + '。这是一个 AI 短视频项目。要出一张' + j.类别 + '的资产图（定妆图），后面各个镜头都拿它当长相、样子的依据。请写这张图的出图提示词。',
            '', '## 要求', '1. 真人写实的电影剧照质感，不要 AI 明信片感。先想清楚合不合理：东西摆在哪、光从哪来。',
            j.类别 === '人物' ? '2. 人物定妆照：画面里只有这一个人，正面全身站立，头到脚完整入画，竖幅 2:3，纯中灰色摄影棚背景；分「长相」「姿势」「穿着」「质感」几小段写；长相普通，不是明星脸，不是任何真人的肖像。'
              : j.类别 === '道具' ? '2. 道具图：画面里只有这一件道具，完整入画，四周留一点空，横幅 16:9，干净的中灰色背景或它平常所在的简单环境；写清结构、材质、颜色、新旧。' + (j.状态名 ? '这一张画的是它「' + j.状态名 + '」的样子。' : '')
                : '2. 场景图：空镜，横幅 16:9，不出现有名有姓的人物；写清是什么时候、在哪、有什么、光从哪来；地方和全片场景里写的对得上。',
            '3. 年代、地方、颜色基调要和全片对得上。', '4. 只写画面里有的东西，不写「没有什么」。', '5. 第一行写一句这张图是干什么用的，然后空一行接着写提示词正文。',
            '', '## 全片的设定', settingText(flow), (await exists(tone)) ? '\n## 全片的光影总基调\n' + unbom(await fsp.readFile(tone, 'utf8')).trim() : '',
            '', '## 这一张', j.类别 + '「' + j.名 + '」' + (j.状态名 ? '，状态：' + j.状态名 : '') + '。描写：' + (e ? str(e.描写).trim() || '（没写，照梗概来）' : '照上面全片的「场景」来') + (j.要求 ? '\n另外的要求：' + j.要求 : ''), TAIL].join('\n');
          const text = body(await askText(j, j.渠道, book, '出图提示词'));
          if (text.length < 40) throw fail('AI 写的出图提示词太短了');
          await writeFile(pj(j.项目, ...prm), text + '\n');
        }
        if (j.停) throw fail('停掉了');
        j.步骤 = 'Codex 在出图';
        const mine = pj(j.项目, '提示词', '全局资产', '资产出图任务.txt'), task = (await exists(mine)) ? mine : IMG_TASK;
        if (CHANNELS.mock && j.渠道 === 'mock') { await sleep(1500); await fsp.mkdir(path.dirname(pj(j.项目, ...img)), { recursive: true }); await fsp.copyFile(path.join(process.env.ANTOU_MOCK_DIR, '图.png'), pj(j.项目, ...img)); }
        else await writeFile(path.join(j.dir, 'Codex的回复.md'), (await codexDo(j, '请照 ' + task + ' 做这一张。提示词文件：' + pj(j.项目, ...prm) + '　存图路径：' + pj(j.项目, ...img))) + '\n');
        if (!(await exists(pj(j.项目, ...img)))) throw fail('Codex 说做完了，可是图没存到 ' + img.join('/'));
        { const t = new Date(); await fsp.utimes(pj(j.项目, ...img), t, t).catch(() => {}); }   // 文件时间记成现在：拷过来的图会带着原来的时间，页面上「可用」「不用」都靠它认是不是新出的
        await updateList(j.项目, j.段, { 类别: j.类别, 名称: j.名, 文件: img.join('/'), 状态: '待过目', 说明: (j.状态名 ? j.状态名 + '；' : '') + nowText().slice(5, 16) + ' 出的' });
        return { 结果: '图出好了，到资产那一步看一眼', 产出: [img.join('/'), prm.join('/')] };
      },
    },

    /* ---------- 工序四：提示词 ---------- */
    写提示词: {
      title: j => '写提示词 · 第' + j.段 + '场 ' + str(j.名).replace(/_?视频提示词\.txt$/, ''), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      async prep(j) {
        if (!nameOk(str(j.名)) || !/(^|_)视频提示词\.txt$/.test(j.名)) throw fail('提示词的文件名要以「视频提示词.txt」结尾');
        if (await exists(vpPath(j))) throw fail('这份提示词已经存在，请打开接着写；AI 初稿不会覆盖它');
      },
      async book(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
        if (!s) throw fail('流水线里没有第' + j.段 + '场');
        if (!(await exists(sp))) throw fail('要先有定稿的剧本，才能写提示词');
        const ps = parasOf(s), pa = Array.isArray(j.段落) && j.段落.length === 2 ? j.段落 : null;
        if (pa && !(pa[0] >= 1 && pa[1] >= pa[0] && pa[1] <= ps.length)) throw fail('段落的范围不对');
        const assets = [];
        for (const k of ['人物', '道具']) for (const n of s[k] || []) { const e = (flow[k] || []).find(x => x && x.名 === n); for (const f of (e && (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : [])) || []) assets.push(k + '「' + n + '」：' + f); }
        for (const f of s.场景图 || []) assets.push('场景图：' + f);
        j.assets = assets.map(x => x.split('：').pop());
        const tone = await toneOf(j.项目), lessons = await lessonsOf(j.项目), gp = await geoPart(j, s.场景图);
        j.images = gp.images;
        const range = pa ? '这一条只写段落 ' + pa[0] + (pa[1] > pa[0] ? ' 到段落 ' + pa[1] : '') + ' 的戏（一条视频最多 15 秒），别的段落留给别的条，不要写进来。' : '这一条写这一场全部段落的戏。';
        return ['# 任务：给一场戏写 Seedance 视频提示词', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面有定稿的剧本、人写的剧本段落、全片设定、这一场能用的资产图。请照 sd25-pe 和 seedance-prompt-format 两个技能写视频提示词。' + range,
          '', '## 要求', '1. 骨架、写法照两个技能；两个冲突时以 sd25-pe 为准。镜头由剧情需要来设计，不按剧本段落机械地一段一镜。写在「分镜」里，镜头号从 01 起连着编，一镜只讲一两件事。', '2. 素材行里用 @图片1、@图片2……引用资产图，只能用下面「能用的资产图」里的，镜头里看得见的人物、道具、场景都要挂。',
          '3. 不写时长秒数（时长在生成参数里设），不写画面里没有的东西。', '4. ' + gp.rule, '5. 回复' + (gp.make ? '三块（最前面是【GEO底稿】）' : '两块') + '，照这个样子：', ...(gp.make ? ['【GEO底稿】', '（照 scene-geo 第五节模板写的底稿）'] : []), '【提示词】', '（整份提示词，从「本段事件：」开始）', '【素材登记】', '[{"ref": "@图片1", "name": "叫法", "path": "资产/……png"}]',
          '', '## 能用的资产图', assets.join('\n') || '（没有）', '', '## 全片的设定', settingText(flow), tone ? '\n## 全片的光影总基调（基础设定里的影像风格、光色基调照它写）\n' + tone : '', gp.text,
          '', '## 这一场：第' + j.段 + '段｜' + str(s.名).trim(), sceneText(flow, s),
          '', '## 定稿的剧本', await docText(sp), lessons ? '\n## 这个项目的历史教训（写的时候记着）' + lessons : '', '', '## 技能：sd25-pe', await skill('sd25-pe'), '', '## 技能：seedance-prompt-format', await skill('seedance-prompt-format'), '', '## 技能：scene-geo', await skill('scene-geo'), TAIL].join('\n');
      },
      async apply(j, text) {
        const t = text.replace(/\r\n/g, '\n'), a = t.indexOf('【提示词】'), z = t.indexOf('【素材登记】');
        if (a < 0) throw fail('AI 没按要的格式回（没有【提示词】）');
        const prompt = body(t.slice(a + 5, z > a ? z : undefined), /^本段事件/);
        if (prompt.length < 80) throw fail('AI 写的提示词太短了');
        const rel = ['提示词', segDir(j.段), j.名];
        const buf = Buffer.from(prompt + '\n', 'utf8');
        await fsp.mkdir(path.dirname(vpPath(j)), { recursive: true });
        try { await fsp.writeFile(vpPath(j), buf, { flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') throw fail('等待 AI 时这份稿已被创建，保留现有内容；AI 答卷可在任务记录里查看'); throw e; }
        const g0 = t.indexOf('【GEO底稿】');
        const geoAt = g0 >= 0 && g0 < a ? await saveGeo(j, t.slice(g0 + 7, a)) : '';
        let refs = [];
        try { const m = /\[[\s\S]*\]/.exec(z > a ? t.slice(z) : ''); refs = m ? JSON.parse(m[0]) : []; } catch (e) { refs = []; }
        const list = [];
        for (const r of Array.isArray(refs) ? refs : []) {
          const p = str(r && r.path).replace(/\\/g, '/');
          if (!/^@(图片|视频|音频)\d+$/.test(str(r && r.ref)) || !(j.assets || []).includes(p) || !(await exists(pj(j.项目, ...p.split('/'))))) continue;
          list.push({ ref: r.ref, name: str(r.name), path: p, sha256: sha256(await fsp.readFile(pj(j.项目, ...p.split('/')))) });
        }
        const mp = pj(j.项目, '资产', '参考素材映射.json');
        let map = { schema_version: 1, prompts: {} };
        try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { /* 还没有 */ }
        map.prompts = map.prompts && typeof map.prompts === 'object' ? map.prompts : {};
        map.prompts[rel.join('/')] = { prompt_sha256: sha256(buf), references: list };
        await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
        return { 结果: '提示词写好了，挂了 ' + list.length + ' 张图' + (geoAt ? '；AI 看图新建了一份 GEO 底稿，等你审' : ''), 产出: [rel.join('/'), ...(geoAt ? [geoAt] : [])] };
      },
    },
    /* 生成出片任务书：不用 AI，照固定的样子把这一条要用的东西排好（提示词、挂哪几张图、画布、参数、存到哪） */
    出片任务书: {
      title: j => '生成出片任务书 · 第' + j.段 + '场 ' + str(j.名).replace(/_?视频提示词\.txt$/, ''), need: ['段'], key: j => j.段 + '/' + j.名, local: true,
      async run(j) {
        const rel = ['提示词', segDir(j.段), str(j.名)], p = pj(j.项目, ...rel);
        if (!nameOk(str(j.名)) || !(await exists(p))) throw fail('没有这份提示词');
        const buf = await fsp.readFile(p), text = unbom(buf.toString('utf8')), label = j.名.replace(/_?视频提示词\.txt$/, '') || '整场';
        let set = {}, map = {};
        try { set = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '出片设置.json'), 'utf8'))); } catch (e) { /* 没有就空着 */ }
        try { map = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '参考素材映射.json'), 'utf8'))); } catch (e) { /* 没有就空着 */ }
        let refs = (((map.prompts || {})[rel.join('/')] || {}).references || []).slice();
        try {   // 你来写的稿：在写稿页里新 @ 的图记在旁边的过程文件里（挂图），也算进来
          const side = JSON.parse(unbom(await fsp.readFile(p.replace(/\.txt$/, '_写稿.json'), 'utf8')));
          for (const [ref, file] of Object.entries(side.挂图 || {})) {
            const fp = String(file).replace(/\\/g, '/');
            if (refs.some(r => r.ref === ref) || !(await exists(pj(j.项目, ...fp.split('/'))))) continue;
            refs.push({ ref, name: path.basename(fp).replace(/\.[^.]+$/, '').split('_')[0], path: fp, sha256: sha256(await fsp.readFile(pj(j.项目, ...fp.split('/')))) });
          }
        } catch (e) { /* 没有过程文件 */ }
        const used = [...new Set(text.match(/@(?:图片|视频|音频)\d+/g) || [])];
        const lost = used.filter(u => !refs.some(r => r.ref === u));
        if (lost.length) throw fail('提示词里写了 ' + lost.join('、') + '，可是没登记它是哪个文件（资产/参考素材映射.json）。先让 AI 批一批或者重新铺底，把素材对上');
        refs = refs.filter(r => used.includes(r.ref)).sort((a, b) => a.ref.localeCompare(b.ref, 'zh', { numeric: true }));
        for (const r of refs) if (!(await exists(pj(j.项目, ...r.path.split('/'))))) throw fail(r.ref + ' 对的那张图不在了：' + r.path);
        let n = 0;   // 这一段已经出到第几条：成片和历史记录里的都算
        for (const d of [pj(j.项目, '成片', segDir(j.段)), pj(j.项目, '历史记录', '成片', segDir(j.段))]) { try { for (const f of await fsp.readdir(d)) { const m = /第(\d+)条/.exec(f); if (m) n = Math.max(n, +m[1]); } } catch (e) { /* 没有这个文件夹 */ } }
        const no = n + 1, P = Object.assign({ 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 15, 积分上限: 0, 登录位: '' }, j.参数 || {});
        if (!/^[A-Za-z0-9_-]{0,40}$/.test(str(P.登录位))) throw fail('登录位的名字不对');
        if (!/^(480p|720p|1080p)$/.test(str(P.清晰度)) || !(P.秒数 >= 4 && P.秒数 <= 30)) throw fail('清晰度或者时长不对');
        const tag = (/样片/.test(P.模型) ? '样片' : '') + P.清晰度;
        const out = ['成片', segDir(j.段), segDir(j.段) + '_第' + no + '条_' + label + '_' + tag + '.mp4'], abs = (...x) => pj(j.项目, ...x).replace(/\\/g, '/');
        const nodeName = f => { const q = f.split('/'); const base = q[q.length - 1].replace(/\.[^.]+$/, ''); return q[1] === '全局资产' ? q[2] + '_' + base : /^第.+段$/.test(q[1]) ? q[1] + '_' + base : base; };
        const lines = ['任务：在即梦画布上为《' + j.项目 + '》第' + j.段 + '段第' + no + '条出一条视频：' + label + '，' + P.模型 + '，' + P.清晰度 + '，' + P.秒数 + ' 秒。',
          '这份任务书是项目管理的流水线在 ' + nowText() + ' 生成的。用户在页面上点了「批准出片」才会交到你手上；这一条由你从头做到尾：建草稿、核对、报价、提交生成、等出片、下载。不要手改这份任务书。',
          '', '〇、本次可以用的工具', '用本项目的即梦快线 ' + path.join(SKILLS, 'dreamina-video-fastlane').replace(/\\/g, '/') + ' 和它要用的 dreamina-canvas-cli，只限这一次。不要运行任何更新、安装技能的命令。',
          '新素材明确用 CLI 传，每样只传一次；回了状态不明，就用原编号只读核查，查不到就停下告诉我。不要用桌面 Computer Use 去点 Windows 的文件选择对话框。网页要求登录、付费开通，或弹出权限、授权窗口时就停下告诉我，不要代点。',
          '即梦账号：' + (P.登录位 ? '用登录位「' + P.登录位 + '」，每一条 dreamina-canvas 命令都带上 --profile ' + P.登录位 + '。' : '用默认登录位（命令不带 --profile）。') + '开工前先用 auth status 看这个登录位是不是登录着；没登录就停下告诉我，不要自己登录、不要换账号。',
          '', '一、画布与节点', '画布：' + (set.画布 || '（资产/出片设置.json 里还没写画布网址：先停下问我）'), '新建一个视频节点，名字写：第' + j.段 + '段｜第' + no + '条｜' + label + '｜' + tag + '｜' + P.秒数 + '秒（下称节点A）。',
          '开工前先查画布上有没有同名节点：没有才新建；同名节点已经提交过，就停下告诉我；还是草稿，就在它上面接着做，不另建。这一条在画布上只新建节点A 这一个视频节点，别的节点一律不改、不删、不运行；引用已有的素材节点不算改动。',
          '', '二、模型与参数', P.模型 + '，' + P.清晰度 + '，16:9，生成 1 条，' + P.秒数 + ' 秒。全能参考。声音没有单独的开关就照默认，不要杜撰参数。',
          '', '三、参考：' + refs.length + ' 个，按顺序挂，编号要对上', refs.length ? '画布上已经有同名素材节点的（节点名写在括号里），回读确认还在、类型对，就直接引用，不重传；没有的才用 CLI 传成独立图片节点，节点名照括号里的写。节点A 里用「从画布选择」引用素材节点，不要直接上传进视频节点。' : '这一条没有登记参考素材（纯文字出片）。',
          ...refs.map(r => r.ref + ' ' + r.name + '：' + abs(...r.path.split('/')) + '，SHA-256 ' + r.sha256 + '（素材节点名：' + nodeName(r.path) + '）。'),
          '', '四、提示词', '文件：' + abs(...rel), '核对：非空行 ' + text.split(/\r?\n/).filter(l => l.trim()).length + ' 行，SHA-256 ' + sha256(buf) + '。', '全文原样填进节点A 的提示词，保留换行，不增删、不改字；存草稿后回读，和文件逐字比对一遍。装不下、被截断就停下告诉我，不要删减。',
          '', '五、核对、报价、提交', P.积分上限 > 0 ? '报价不超过 ' + P.积分上限 + ' 积分才提交；超过就停在草稿，告诉我报价多少。' : '用户没有给积分上限：存好草稿、报出价钱以后停下，等用户点头，不要提交。',
          '只提交节点A 这一次、生成 1 条。提交返回状态不明时先查节点状态，不重复提交。被版权限制或别的原因拦下就停下告诉我，不改提示词、不换参考、不重试。',
          '', '六、等待与下载', '提交后等它出完。等待查询超时不算失败，用同一个提交编号接着查，不重新提交。生成失败就停下把原因告诉我，不重试。', '成功后用 CLI 下载到 ' + abs(...out) + '。这个文件已经存在就停下告诉我，不覆盖。',
          '', '七、做完回复', '节点A 的编号、实际扣了多少积分、下载到的完整路径。'];
        const tf = ['提示词', segDir(j.段), (label === '整场' ? '' : label + '_') + '出片任务.txt'];
        await archive(j.项目, tf);
        await writeFile(pj(j.项目, ...tf), lines.join('\n') + '\n');
        return { 结果: '任务书写好了（第' + no + '条，挂 ' + refs.length + ' 个参考）', 产出: [tf.join('/')] };
      },
    },
    /* 出片：把任务书交给 Codex 真去做（要花积分；只在用户点了「批准出片」时才开） */
    出片: {
      title: j => '出片 · 第' + j.段 + '场 ' + str(j.名).replace(/_?出片任务\.txt$/, ''), need: ['段'], key: j => j.段 + '/' + j.名, codex: true,
      async run(j) {
        const p = pj(j.项目, '提示词', segDir(j.段), str(j.名));
        if (!nameOk(str(j.名)) || !/出片任务\.txt$/.test(j.名) || !(await exists(p))) throw fail('没有这份出片任务书');
        if (j.批准 !== '用户点了批准出片') throw fail('出片要用户在页面上点「批准出片」');
        j.步骤 = 'Codex 在出片（要等好几分钟）';
        const reply = await codexDo(j, '请照 ' + p + ' 执行。');
        await writeFile(path.join(j.dir, 'Codex的回复.md'), reply + '\n');
        return { 结果: 'Codex 做完了：' + reply.replace(/\s+/g, ' ').slice(0, 120), 产出: [] };
      },
    },
    /* ---------- 工序五：审片不满意，让 AI 照批注说说该回哪一道 ---------- */
    审片建议: {
      title: j => '审片建议 · 第' + j.段 + '场 ' + str(j.视频), need: ['段'], key: j => j.段 + '/' + j.视频,
      async book(j) {
        const v = str(j.视频), stem = v.replace(/\.[^.]+$/, ''), np = pj(j.项目, '成片', segDir(j.段), stem + '_批注.md');
        if (!nameOk(v) || !(await exists(np))) throw fail('这条视频还没有批注：先在审片里写批注');
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
        let prompts = '';
        try { for (const f of await fsp.readdir(pj(j.项目, '提示词', segDir(j.段)))) if (/(^|_)视频提示词\.txt$/.test(f)) prompts += '\n### ' + f + '\n' + unbom(await fsp.readFile(pj(j.项目, '提示词', segDir(j.段), f), 'utf8')); } catch (e) { /* 没有提示词 */ }
        return ['# 任务：看审片批注，说说该回哪一道工序改', '', '今天 ' + today() + '。这是一个 AI 短视频项目，一场戏分五道工序做：一 全片设定（梗概、人物、场景、道具）→ 二 段落、剧本 → 三 资产图 → 四 提示词 → 五 审片。下面是用户看完一条样片写的批注。请逐条说：要改的具体是什么，建议回哪一道工序改，会波及哪些已经做好的东西。',
          '', '## 要求', '1. 别按问题的种类硬套工序：表演不好可能只要改提示词；台词文字要改才回剧本；长相、道具样子不对回资产；只是这一条没抽好、东西都不用改的，就说「不用改，重出一条」。', '2. 用大白话，一条批注对一条建议，每条两三句。最后一行写总的建议：先做哪一件。',
          '', '## 审片批注', unbom(await fsp.readFile(np, 'utf8')), '', '## 这一场', s ? sceneText(flow, s) : '（流水线里没有这一场的段落）', (await exists(sp)) ? '\n## 剧本\n' + await docText(sp) : '', prompts ? '\n## 这一场的提示词' + prompts : '', TAIL].join('\n');
      },
      async apply(j, text) {
        const rel = ['成片', segDir(j.段), str(j.视频).replace(/\.[^.]+$/, '') + '_AI建议.md'];
        await writeFile(pj(j.项目, ...rel), '# AI 建议｜' + j.视频 + '\n\n' + nowText() + '　' + CHANNELS[j.渠道].名 + '\n\n' + body(text) + '\n');
        return { 结果: 'AI 的建议写好了，在这条视频下面', 产出: [rel.join('/')] };
      },
    },
  });

  /* ---------- 工序四：你来写提示词，AI 给建议、关键词、批注、按批注改 ----------
     只有分镜部分可在逐镜编辑、自由文本间切换；其余公共区共用。铺底任务仅更新侧栏建议，不改正文。
     读成几区、照原样写回去，和写稿页（通用工具/项目管理_写稿试用.html）是同一套读法 */
  const SEC_OF = { 素材: 'refs', 基础设定: 'basic', 本段: 'seg', 分镜: 'shots' }, BOMCH = String.fromCharCode(0xFEFF);
  function parsePrompt(text) {
    const d = { bom: false, eol: '\n', pre: [], event: '', refs: [], basic: [], seg: [], shotsPre: [], shots: [], keep: '', has: {} };
    if (text.charCodeAt(0) === 0xFEFF) { d.bom = true; text = text.slice(1); }
    if (/\r\n/.test(text)) d.eol = '\r\n';
    let sec = 'pre', shot = null;
    const lab = line => { const m = /^([^：:\n]{1,10})[：:]/.exec(line); return m ? { label: m[1].trim(), value: line.slice(m[0].length) } : null; };
    for (const raw of text.split(/\r\n|\n|\r/)) {
      const t = raw.trim(), key = SEC_OF[t.replace(/\s+/g, '')];
      if (key) { sec = key; d.has[key] = true; shot = null; continue; }
      const g = lab(t);
      if (g && g.label === '本段事件' && sec === 'pre') { d.event = g.value.trim(); sec = 'event'; continue; }
      if (g && g.label === '保持一致' && sec !== 'keep') { d.keep = g.value.trim(); d.has.keep = true; sec = 'keep'; shot = null; continue; }
      if (sec === 'shots' && /^镜头\s*[0-9０-９]+/.test(t)) { const m = /^镜头\s*([0-9０-９]+)\s*[｜|：:]?\s*(.*)$/.exec(t); shot = { no: m[1], title: m[2], lines: [] }; d.shots.push(shot); continue; }
      if (!t) continue;
      if (sec === 'event') d.event += t;
      else if (sec === 'keep') d.keep += t;
      else if (sec === 'shots') (shot ? shot.lines : d.shotsPre).push(t);
      else d[sec].push(t);
    }
    return d;
  }
  function serializePrompt(d) {
    const out = [];
    if (d.pre.length) out.push(...d.pre, '');
    out.push('本段事件：' + d.event, '');
    if (d.has.refs || d.refs.length) out.push('素材', ...d.refs, '');
    out.push('基础设定', ...d.basic, '', '本段', ...d.seg, '', '分镜', '');
    if (d.shotsPre.length) out.push(...d.shotsPre, '');
    for (const s of d.shots) out.push('镜头 ' + s.no + '｜' + s.title, ...s.lines, '');
    out.push('保持一致：' + d.keep);
    return (d.bom ? BOMCH : '') + out.join(d.eol) + d.eol;
  }
  const RE_VP = /(^|_)视频提示词\.txt$/;
  const vpPath = j => pj(j.项目, '提示词', segDir(j.段), str(j.名));
  const vpLabel = j => str(j.名).replace(/_?视频提示词\.txt$/, '') || '整场';
  async function vpNeed(j) { if (!nameOk(str(j.名)) || !RE_VP.test(j.名) || !(await exists(vpPath(j)))) throw fail('没有这份提示词'); }
  /* 改之前留一版（复制，不挪走：他可能正开着页面写）：历史记录/同样的路径/原名__时间.后缀 */
  async function keepCopy(name, relParts) {
    const src = pj(name, ...relParts);
    if (!(await exists(src))) return;
    const base = relParts[relParts.length - 1], dot = base.lastIndexOf('.');
    const dst = pj(name, '历史记录', ...relParts.slice(0, -1), (dot > 0 ? base.slice(0, dot) : base) + '__' + stampOf() + (dot > 0 ? base.slice(dot) : ''));
    await fsp.mkdir(path.dirname(dst), { recursive: true });
    await fsp.copyFile(src, dst);
  }
  /* 稿子改过以后：参考素材映射里这份稿的校验值跟着换（页面核对过校验值才肯显示 @图片 对的是哪张） */
  async function resha(name, rel, refs) {
    const mp = pj(name, '资产', '参考素材映射.json');
    let map = null;
    try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { map = null; }
    if (!map && !refs) return;
    map = map && typeof map === 'object' ? map : { schema_version: 1, prompts: {} };
    map.prompts = map.prompts && typeof map.prompts === 'object' ? map.prompts : {};
    const key = rel.join('/'), cur = map.prompts[key];
    if (!cur && !refs) return;
    map.prompts[key] = { ...(cur || {}), prompt_sha256: sha256(await fsp.readFile(pj(name, ...rel))), references: refs || (cur && cur.references) || [] };
    await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
  }
  /* 这一场能挂的图：出场的人物、道具各自引用的图，和这一场的场景图 */
  /* 这一场的 GEO 底稿（照 scene-geo 建的，人审用，不进提示词）：先找这一段文件夹里的，再找 提示词/全局资产/场景 里的；
     都没有，再看别的段里的（一张场景图几场共用时，底稿常放在头一场的文件夹里） */
  async function geoOf(name, seg) {
    const out = [];
    const take = async rel => { try { for (const g of (await fsp.readdir(pj(name, ...rel))).sort()) if (/GEO底稿[^/]*\.md$/i.test(g)) out.push({ rel: [...rel, g].join('/'), text: unbom(await fsp.readFile(pj(name, ...rel, g), 'utf8')).trim() }); } catch (e) { /* 没有这个文件夹 */ } };
    await take(['提示词', segDir(seg)]);
    await take(['提示词', '全局资产', '场景']);
    if (!out.length) { try { for (const d of (await fsp.readdir(pj(name, '提示词'))).sort()) if (/^第.+段$/.test(d) && d !== segDir(seg)) await take(['提示词', d]); } catch (e) { /* 没有提示词文件夹 */ } }
    return out.filter(x => x.text);
  }
  /* 任务书里讲场景的那几句、带的材料、要不要让 AI 看图：有底稿照底稿；没有底稿、有场景图，看图建一份 */
  async function geoPart(j, sceneImgs) {
    const geo = await geoOf(j.项目, j.段), imgs = [];
    for (const g of sceneImgs || []) { const p = pj(j.项目, ...String(g).replace(/\\/g, '/').split('/')); if (/\.(png|jpe?g|webp)$/i.test(p) && await exists(p)) imgs.push(p); }
    const make = !geo.length && imgs.length > 0;   // 没有底稿、有场景图：让 AI 看图先建一份
    return {
      make, images: make ? imgs : [],
      rule: geo.length ? '场景一律照 scene-geo：下面给了这一场的 GEO 底稿（照生成好的场景图核过、人审过的），「本段」里的分场景、轴线、站位、物件、光，都照底稿翻成场景段（scene-geo 第六节的办法）。底稿里的事实不许改、不许另编；底稿没写的地方不要自己添；底稿标了「逐镜状态」「待定」的照它的说明办。素材里场景图那一行照 scene-geo 第七节写（这张图是从哪往哪看的、只采用什么、不采用什么）。'
        : make ? '场景一律照 scene-geo：这一场还没有 GEO 底稿。你已经看过这一场的场景图了，先照 scene-geo 第五节的模板给它建一份 GEO 底稿（空间里有什么、各在哪、从哪往哪看；只写图上看得到的和剧本点了名的，图和剧本对不上的地方单列出来），放在回复最前面的【GEO底稿】一块里，给人审，不进提示词；再照这份底稿把「本段」里的分场景、轴线、站位、物件、光翻成场景段（第六节）。素材里场景图那一行照第七节写。'
          : '场景照 scene-geo 的办法想清楚再写：这一场没有场景图也没有 GEO 底稿，只照全片的场景描写和剧本写，不要编图上才有的细节。',
      text: geo.length ? geo.map(x => '\n## GEO 底稿（' + x.rel + '；人审用的底稿，照它翻，不要把底稿原文搬进提示词）\n' + x.text).join('\n') : make ? '\n## 这一场的场景图（已经让你看过）\n' + imgs.join('\n') : '',
    };
  }
  async function saveGeo(j, text) {   // AI 新建的底稿：存到这一段的文件夹里给人审；那里已经有就不动
    const t = (text || '').trim(), rel = ['提示词', segDir(j.段), 'GEO底稿.md'];
    if (t.length < 80 || await exists(pj(j.项目, ...rel))) return '';
    await writeFile(pj(j.项目, ...rel), '# 第' + j.段 + '段 GEO 底稿\n\n人审用，不进提示词。' + nowText() + ' ' + ((CHANNELS[j.渠道] || {}).名 || 'AI') + ' 看着场景图、照 scene-geo 建的，还没人审过：看完哪里不对，改这份底稿，再点「重新铺底」。\n\n' + t + '\n');
    return rel.join('/');
  }
  /* 这个项目定下来的全片光影总基调、踩过的坑（历史教训）：写提示词、铺底的时候带上 */
  async function toneOf(name) { const p = pj(name, '提示词', '全局资产', '全片_光影总基调.txt'); return (await exists(p)) ? unbom(await fsp.readFile(p, 'utf8')).trim() : ''; }
  async function lessonsOf(name) {
    let out = '';
    try { for (const g of await fsp.readdir(pj(name, '历史教训'))) if (/\.(md|txt)$/i.test(g)) out += '\n### ' + g + '\n' + unbom(await fsp.readFile(pj(name, '历史教训', g), 'utf8')).slice(0, 6000); } catch (e) { /* 这个项目没有历史教训 */ }
    return out;
  }
  function sceneAssets(flow, s) {
    const out = [];
    for (const k of ['人物', '道具']) for (const n of s[k] || []) { const e = (flow[k] || []).find(x => x && x.名 === n); for (const g of (e && (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : [])) || []) out.push({ line: k + '「' + n + '」：' + g, path: String(g).replace(/\\/g, '/') }); }
    for (const g of s.场景图 || []) out.push({ line: '场景图：' + g, path: String(g).replace(/\\/g, '/') });
    return out;
  }
  async function refsIn(j, text, allowed) {   // AI 回的【素材登记】：只认这一场能挂的、文件还在的
    let refs = [];
    try { const m = /\[[\s\S]*\]/.exec(text); refs = m ? JSON.parse(m[0]) : []; } catch (e) { refs = []; }
    const list = [];
    for (const r of Array.isArray(refs) ? refs : []) {
      const p = str(r && r.path).replace(/\\/g, '/');
      if (!/^@(图片|视频|音频)\d+$/.test(str(r && r.ref)) || !allowed.includes(p) || !(await exists(pj(j.项目, ...p.split('/'))))) continue;
      list.push({ ref: r.ref, name: str(r.name), path: p, sha256: sha256(await fsp.readFile(pj(j.项目, ...p.split('/')))) });
    }
    return list;
  }
  /* 别的段写好的基础设定：各段照抄（挑最近改过的一份） */
  async function basicOfOthers(j) {
    let best = null;
    try {
      for (const d of await fsp.readdir(pj(j.项目, '提示词'))) {
        if (!/^第.+段$/.test(d)) continue;
        for (const g of await fsp.readdir(pj(j.项目, '提示词', d)).catch(() => [])) {
          if (!RE_VP.test(g) || (d === segDir(j.段) && g === j.名)) continue;
          const p = pj(j.项目, '提示词', d, g), doc = parsePrompt(await fsp.readFile(p, 'utf8'));
          if (!doc.basic.length) continue;
          const t = (await fsp.stat(p)).mtimeMs;
          if (!best || t > best.t) best = { t, from: d + '/' + g, lines: doc.basic };
        }
      }
    } catch (e) { /* 还没有别的段 */ }
    return best;
  }
  const kwNorm = v => {   // 关键词：一组一组，每条不超过 10 个字；长的（台词）写成 {show, t, tip}
    const out = {};
    for (const [g, list] of Object.entries(v && typeof v === 'object' && !Array.isArray(v) ? v : {})) {
      const items = (Array.isArray(list) ? list : []).map(x => typeof x === 'string' ? x.trim() : x && typeof x === 'object' && str(x.t).trim() ? { show: str(x.show).trim().slice(0, 10) || str(x.t).trim().slice(0, 10), t: str(x.t).trim(), ...(str(x.tip).trim() ? { tip: str(x.tip).trim() } : {}) } : null)
        .filter(Boolean).filter(x => !/^(无|没有|暂无)(台词|对白)?$/.test(typeof x === 'string' ? x : x.t)).map(x => typeof x === 'string' && x.length > 10 ? { show: x.slice(0, 9) + '…', t: x } : x).slice(0, 6);
      if (items.length) out[str(g).trim().slice(0, 6) || '提示'] = items;
    }
    return out;
  };
  async function sideOf(j) {
    try {
      const value = JSON.parse(unbom(await fsp.readFile(vpPath(j).replace(/\.txt$/, '_写稿.json'), 'utf8')));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('不是对象');
      return value;
    } catch (e) { if (e.code === 'ENOENT') return {}; throw fail('写稿资料读不了，为保护现有内容没有改动：' + e.message); }
  }
  const recordOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  // 新格式的自由稿只含分镜；无范围标记的旧自由稿仍按原语义读取，避免截断旧内容。
  const freeShotText = (side, raw) => side.写法范围 === '分镜' ? str(side.自由稿) : raw;
  const shotInfo = side => Array.isArray(side.镜头信息) ? side.镜头信息 : [];
  const shotSignature = sh => JSON.stringify([sh.no, sh.title, sh.lines]);
  function keywordTargets(cur, side) {
    return cur.shots.map(sh => {
      const info = shotInfo(side).find(x => x && String(x.no) === String(sh.no));
      return { no: sh.no, id: info ? str(info.id) : '', signature: shotSignature(sh) };
    });
  }
  function applyKeywords(side, cur, targets, words) {
    let count = 0;
    for (const target of targets || []) {
      const got = kwNorm(words[target.no] || words[String(+target.no)] || words['镜头' + target.no] || words['镜头 ' + target.no]);
      if (!Object.keys(got).length) continue;
      if (target.id) {
        if (!shotInfo(side).some(x => x && x.id === target.id)) continue;
        side.镜头关键词 = recordOf(side.镜头关键词);
        side.镜头关键词[target.id] = got;
      } else {
        // 老稿没有稳定 ID 时，镜头内容和编号都未变化才接受旧请求的返回。
        if (!cur.shots.some(sh => shotSignature(sh) === target.signature)) continue;
        side.关键词 = recordOf(side.关键词);
        side.关键词[target.no] = got;
      }
      count++;
    }
    return count;
  }
  const blockOf = (t, name, next) => { const a = t.indexOf('【' + name + '】'); if (a < 0) return null; const rest = t.slice(a + name.length + 2); let z = rest.length; for (const n of next) { const i = rest.indexOf('【' + n + '】'); if (i >= 0 && i < z) z = i; } return rest.slice(0, z); };
  const linesOf = t => (t || '').split('\n').map(l => l.trim()).filter(l => l && !/^\x60\x60\x60/.test(l));
  /* 不是从流水线做起来的项目：没有「这一场出场的」可查，就把全局资产和这一段文件夹里的图都列给 AI 挑 */
  async function poolAssets(j) {
    const out = [], img = /\.(png|jpe?g|webp)$/i;
    try { for (const c of await fsp.readdir(pj(j.项目, '资产', '全局资产'))) for (const g of await fsp.readdir(pj(j.项目, '资产', '全局资产', c)).catch(() => [])) if (img.test(g)) out.push({ line: c + '：资产/全局资产/' + c + '/' + g, path: '资产/全局资产/' + c + '/' + g }); } catch (e) { /* 没有全局资产 */ }
    try { for (const g of await fsp.readdir(pj(j.项目, '资产', segDir(j.段)))) if (img.test(g)) out.push({ line: '这一段的图：资产/' + segDir(j.段) + '/' + g, path: '资产/' + segDir(j.段) + '/' + g }); } catch (e) { /* 这一段没有文件夹 */ }
    return out.slice(0, 200);
  }
  /* 这一场的材料：设定、段落、剧本、镜头表（有就带上），和能挂的图 */
  async function ctxOf(j) {
    const flow = await readFlow(j.项目).catch(() => null), s = flow ? sceneOf(flow, j.段) : null, sp = scriptPath(j.项目, j.段), hp = shotsPath(j.项目, j.段);
    const text = [flow ? '## 全片的设定\n' + settingText(flow) : '', s ? '\n## 这一场：第' + j.段 + '段｜' + str(s.名).trim() + '\n' + sceneText(flow, s) : '',
      (await exists(sp)) ? '\n## 定稿的剧本\n' + await docText(sp) : '', (await exists(hp)) ? '\n## 镜头表\n' + await docText(hp) : ''].filter(Boolean).join('\n');
    return { text: text || '（这一场还没有剧本和镜头表）', assets: s ? sceneAssets(flow, s) : await poolAssets(j) };
  }
  Object.assign(KINDS, {
    铺底: {
      title: j => 'AI 建议 · 第' + j.段 + '场 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      prep: vpNeed,
      async book(j) {
        const ctx = await ctxOf(j), assets = ctx.assets;
        const raw = await fsp.readFile(vpPath(j), 'utf8'), side = await sideOf(j);
        const cur = parsePrompt(side.写法 === '自由' ? str(side.分镜稿) : raw), other = await basicOfOthers(j);
        j.keywordTargets = side.写法 === '自由' ? [] : keywordTargets(cur, side);
        j.suggestionMode = side.写法 === '自由' ? '自由' : '分镜';
        j.assets = assets.map(x => x.path);
        const tone = await toneOf(j.项目), lessons = await lessonsOf(j.项目), geo = await geoOf(j.项目, j.段);
        return ['# 任务：给正在写的提示词提供侧栏建议', '', '今天 ' + today() + '。用户只在分镜部分采用' + j.suggestionMode + '模式，自行决定镜头数量、顺序、标题、作用和正文。本段事件、素材、基础设定、本段、保持一致是共用的公共内容，不随分镜写法切换。你只提供备选建议，用户点击采用以后才进入正文。',
          '', '## 要求', '1. 不重写整份稿，不要求用户按固定段落或镜头数量写，不把剧本段落机械映射成镜头。建议照 sd25-pe；结构化示例可参考 seedance-prompt-format。',
          '2. 分镜建议给二到四个有帮助的思路，每项包含标题、作用和可采用的正文，以及按机位、动作、台词分组的关键词；不要复述已有内容。对空白稿也只提供建议，不预填或代替用户定结构。',
          '3. 基础建议给公共区的本段事件、素材、基础设定、本段、保持一致提供可选文本。可留空。现有公共内容已合适就不必改，不因分镜采用自由文本而忽略或重建公共区。资产只能选下面给出的文件；素材登记记录建议里使用的素材，不能自行改用户已用的编号。',
          '4. 关键词每条不超过十个字。台词只用剧本里已有原话，长句写成 {"show":"台词提示","t":"台词原话","tip":"出处"}，没有台词就不提供。已有镜头的关键词以当前镜头号为键；自由分镜以“自由”为键。自由分镜不要求逐镜编号或作用字段，公共区仍共用。',
          '5. 回复一个 JSON 对象，不附加说明。结构如下：',
          '{"分镜建议":[{"标题":"建议标题","作用":"想达到什么效果","正文":"可以插入的文字","关键词":{"机位":["…"],"动作":["…"]}}],"基础建议":{"本段事件":"","素材":"","基础设定":"","本段":"","保持一致":""},"关键词":{"01":{"动作":["…"]}},"素材登记":[{"ref":"@图片1","name":"称谓","path":"资产/……png"}]}',
          '', '## 当前草稿（原样保留，仅供参考）', raw || '（空白稿）',
          shotInfo(side).length ? '\n## 用户自定的镜头作用\n' + JSON.stringify(shotInfo(side).map(x => ({ no: x.no, 作用: x.作用 }))) : '',
          '', '## 能用的资产', assets.map(x => x.line).join('\n') || '（没有）', other ? '\n## 本项目其他段的基础设定参考\n' + other.lines.join('\n') : '',
          tone ? '\n## 全片光影总基调\n' + tone : '', geo.length ? '\n## 已有场景空间资料\n' + geo.map(x => x.text).join('\n') : '',
          '', ctx.text, lessons ? '\n## 项目历史教训\n' + lessons : '', '', '## 技能：sd25-pe', await skill('sd25-pe'), '', '## 技能：seedance-prompt-format', await skill('seedance-prompt-format'), TAIL].join('\n');
      },
      async apply(j, text) {
        const data = recordOf(jsonIn(text));
        const suggestions = (Array.isArray(data.分镜建议) ? data.分镜建议 : []).filter(x => x && typeof x === 'object').map(x => ({ 标题: str(x.标题).trim(), 作用: str(x.作用).trim(), 正文: str(x.正文).trim(), 关键词: kwNorm(x.关键词) })).filter(x => x.正文 || x.标题).slice(0, 8);
        const basic = {};
        for (const key of ['本段事件', '素材', '基础设定', '本段', '保持一致']) {
          const value = recordOf(data.基础建议)[key];
          basic[key] = Array.isArray(value) ? value.filter(x => typeof x === 'string').join('\n') : str(value);
        }
        const words = recordOf(data.关键词);
        if (!suggestions.length && !Object.values(basic).some(Boolean) && !Object.keys(words).length) throw fail('AI 没有返回可用的建议');
        const refs = await refsIn(j, JSON.stringify(data.素材登记 || []), j.assets || []);
        return withFileLocks([vpPath(j), vpPath(j).replace(/\.txt$/, '_写稿.json')], async () => {
          // 与页面保存共用文件锁；仅改 AI 字段，正文、写法、快照与镜头信息保持原样。
          const raw = await fsp.readFile(vpPath(j), 'utf8'), side = await sideOf(j);
          const cur = parsePrompt(side.写法 === '自由' ? str(side.分镜稿) : raw);
          side.分镜建议 = suggestions;
          side.基础建议 = basic;
          side.建议素材 = refs;
          applyKeywords(side, cur, j.keywordTargets, words);
          if (j.suggestionMode === '自由' && words.自由) {
            side.关键词 = recordOf(side.关键词);
            side.关键词.自由 = kwNorm(words.自由);
          }
          await writeFile(vpPath(j).replace(/\.txt$/, '_写稿.json'), JSON.stringify(side, null, 2) + '\n');
          return { 结果: 'AI 建议已放到侧栏，正文保持原样', 产出: [] };
        });
      },
    },
    要关键词: {
      title: j => '给关键词 · 第' + j.段 + '场 ' + vpLabel(j) + (j.镜头号 === '自由' ? ' 自由分镜' : ' 镜头' + j.镜头号), need: ['段'], key: j => j.段 + '/' + j.名 + '/' + (j.镜头ID || j.镜头号), file: j => j.段 + '/' + j.名,
      async prep(j) {
        await vpNeed(j);
        if (j.镜头号 !== '自由' && !/^[0-9]{1,6}$/.test(str(j.镜头号))) throw fail('要说清是哪一镜');
        if (j.镜头ID && !/^[A-Za-z0-9_-]{1,100}$/.test(j.镜头ID)) throw fail('镜头标识不正确');
      },
      async book(j) {
        const ctx = await ctxOf(j), side = await sideOf(j), raw = await fsp.readFile(vpPath(j), 'utf8');
        const free = j.镜头号 === '自由', cur = parsePrompt(side.写法 === '自由' ? str(side.分镜稿) : raw);
        const info = j.镜头ID ? shotInfo(side).find(x => x && x.id === j.镜头ID) : null;
        if (j.镜头ID && !info) throw fail('这个镜头已经删除，请重新选择');
        const sh = free ? null : cur.shots.find(x => +x.no === +(info ? info.no : j.镜头号));
        if (!free && !sh) throw fail('这份稿里没有镜头 ' + j.镜头号);
        j.keywordTargets = sh ? [{ no: sh.no, id: j.镜头ID || '', signature: shotSignature(sh) }] : [];
        const old = free ? recordOf(side.关键词).自由 : info ? recordOf(side.镜头关键词)[info.id] : recordOf(side.关键词)[sh.no];
        return ['# 任务：给提示词几个可选关键词', '', '今天 ' + today() + '。用户在写' + (free ? '自由分镜文本' : '镜头 ' + sh.no + '｜' + sh.title) + '，想要几个关键词提示。只提供选项，由用户主动采用。素材、基础设定、本段、保持一致等公共区不随分镜写法切换。',
          '', '## 要求', '1. 分机位、动作、台词几组，每组一到四条，每条不超过十个字。以剧本和当前文字为准，不要求用户调整镜头数量或套固定格式。',
          '2. 台词只用剧本里已有原话，超过十个字时写成 {"show":"台词提示","t":"台词原话","tip":"出处"}。没有台词就不提供。', old ? '3. 已给过的关键词，换一批有用的：' + JSON.stringify(old) : '',
          '4. 回复 JSON 对象，如 {"机位":["…"],"动作":["…"]}。',
          info && str(info.作用) ? '\n## 用户写的本镜作用\n' + info.作用 : '',
          '', '## 当前文字', free ? freeShotText(side, raw) || '（分镜尚未填写）' : sh.lines.join('\n') || '（尚未填写正文）',
          free && side.写法范围 === '分镜' ? '\n## 整份提示词（公共区供对照）\n' + raw : '', '', ctx.text, TAIL].join('\n');
      },
      async apply(j, text) {
        const got = kwNorm(jsonIn(text));
        if (!Object.keys(got).length) throw fail('AI 没给出关键词');
        return withFileLocks([vpPath(j), vpPath(j).replace(/\.txt$/, '_写稿.json')], async () => {
          const raw = await fsp.readFile(vpPath(j), 'utf8'), side = await sideOf(j);
          if (j.镜头号 === '自由') {
            side.关键词 = recordOf(side.关键词);
            side.关键词.自由 = got;
          } else {
            const cur = parsePrompt(side.写法 === '自由' ? str(side.分镜稿) : raw);
            const target = (j.keywordTargets || [])[0];
            if (!target || !applyKeywords(side, cur, [target], { [target.no]: got })) return { 结果: '原镜头已删除或改变，这次建议保留在任务记录中', 产出: [] };
          }
          await writeFile(vpPath(j).replace(/\.txt$/, '_写稿.json'), JSON.stringify(side, null, 2) + '\n');
          return { 结果: '关键词已放到侧栏', 产出: [] };
        });
      },
    },
    /* AI 批注：只批不改。写成写稿页认的格式（总评一行，一条一节），最多 8 条 */
    批注提示词: {
      title: j => 'AI 批注 · 第' + j.段 + '场 ' + vpLabel(j) + (j.只批 ? ' 镜头' + j.只批 : ''), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      prep: vpNeed,
      async book(j) {
        const flow = await readFlow(j.项目).catch(() => null), s = flow && sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段), hp = shotsPath(j.项目, j.段);
        const side = await sideOf(j);
        let lessons = '';
        try { for (const g of await fsp.readdir(pj(j.项目, '历史教训'))) if (/\.(md|txt)$/i.test(g)) lessons += '\n### ' + g + '\n' + unbom(await fsp.readFile(pj(j.项目, '历史教训', g), 'utf8')).slice(0, 6000); } catch (e) { /* 这个项目没有历史教训 */ }
        return ['# 任务：给一份视频提示词写批注（只批不改）', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是一场戏的 Seedance 视频提示词（本段事件和分镜多半是人自己写的），和这一场的剧本（老项目有镜头表的也带上）。请你当一个懂 Seedance 的编辑，给它写批注。' + (j.只批 ? '这一回只批「镜头 ' + j.只批 + '」这一镜。' : ''),
          '', '## 怎么批', '1. 最多 8 条，要紧的排在前面。只批不改：稿子一个字都不动，你只写批注。写得好的地方不用夸，没问题就少写。',
          '2. 看这几样：和剧本对不对得上（漏戏、加戏、顺序）；人物想干什么、为什么这么反应写清楚没有（前因后果连不连得上）；一镜是不是只讲一两件事；有没有写一直不变的表情姿势、画面里没有的东西、时长秒数。' + (side.写法 === '自由' ? '用户只把分镜写成自由文本，不因分镜未逐镜分栏、缺少编号或作用字段批评格式。素材、基础设定、本段、保持一致等公共区仍然共用，照实际内容核对。' : '镜头数量、顺序、标题和作用由用户决定，不要求镜头与剧本段落一一对应。'),
          '3. 每条要具体、能照着改，用大白话，批注和原因各一句。能给出替换的句子就写「改成」（只写一行：替换「原文」那句话的新句子，照抄就能用）；只是提醒就不写「改成」这一行。',
          '4. 「原文」要从稿子里一字不差地抄：「本段事件：」后面的话、某一镜标题下面正文里的一句、或者素材、基础设定、本段、保持一致里的一整行，好让页面找到它在哪。不要抄镜头标题那一行（「镜头 01｜……」），不要抄「本段事件：」这几个字。',
          '   这一处还空着、没有原文可抄的（比如某一镜只有标题、本段事件没写）：不写「原文」和「改成」，在「批注」里直接给一句建议的写法。是对整份的意见，位置写「整体」，不写原文。',
          '5. 回复照这个样子，别的都不要：', '总评：一句话', '## 1', '- 位置：镜头 01（或者 本段事件、素材、基础设定、本段、保持一致、整体）', '- 级别：要改（或者 提醒）', '- 类别：对剧本（或者 写法、格式、资产、合理性）', '- 原文：稿子里的原话', '- 批注：一句', '- 原因：一句', '- 改成：整句替换的话', '## 2', '……',
          '', '## 提示词（文件：' + j.名 + '）', unbom(await fsp.readFile(vpPath(j), 'utf8')),
          s ? '\n## 这一场的段落\n' + sceneText(flow, s) : '', (await exists(sp)) ? '\n## 剧本\n' + await docText(sp) : '', (await exists(hp)) ? '\n## 镜头表\n' + await docText(hp) : '', lessons ? '\n## 这个项目的历史教训（批的时候记着）' + lessons : '',
          '', '## 技能：sd25-pe', await skill('sd25-pe'), '', '## 技能：seedance-prompt-format', await skill('seedance-prompt-format'), TAIL].join('\n');
      },
      async apply(j, text) {
        const t = body(text).replace(/\r\n/g, '\n'), sum = (/^总评[：:][ \t]*(.+)$/m.exec(t) || [])[1] || '';
        /* 一条一条理成页面认的样子：每项一行（AI 把「改成」写成了两行的，并成一行）；原文抄的是镜头标题、或者「本段事件：」这几个字的，页面找不到，
           当成「这一处还空着」：不留原文和改成，把建议的写法并进批注 */
        const KEYS = ['位置', '级别', '类别', '原文', '批注', '原因', '改成'];
        const parts = t.split(/^##[ \t]+/m).slice(1).map(p => {
          const g = {}; let cur = '';
          for (const line of p.split('\n').slice(1)) {
            const m = /^-[ \t]*(位置|级别|类别|原文|批注|原因|改成)[：:][ \t]*(.*)$/.exec(line.trim());
            if (m) { cur = m[1]; g[cur] = m[2].trim(); }
            else if (cur && line.trim() && !/^[（(]/.test(line.trim())) g[cur] += (cur === '改成' || cur === '原文' ? '\n' : '') + line.trim();
          }
          const title = /^镜头\s*[0-9０-９]+\s*[｜|]/;
          if (g.原文 && (title.test(g.原文) || /^本段事件[：:]\s*$/.test(g.原文) || g.原文.includes('\n'))) {
            const say = (g.改成 || '').split('\n').filter(l => l && !title.test(l)).join('').replace(/^本段事件[：:]\s*/, '');
            if (say && g.批注) g.批注 += ' 建议写：' + say;
            delete g.原文; delete g.改成;
          }
          if (g.改成) g.改成 = g.改成.split('\n').join('');
          return g.批注 ? KEYS.filter(k => g[k]).map(k => '- ' + k + '：' + g[k]).join('\n') : '';
        }).filter(Boolean).slice(0, 8);
        if (!sum && !parts.length) throw fail('AI 没按要的格式回（要「总评」和一条一节的批注）');
        const rel = ['提示词', segDir(j.段), j.名.replace(/\.txt$/, '') + '_AI批注.md'];
        await archive(j.项目, rel);   // 上一轮的批注收进历史记录
        await writeFile(pj(j.项目, ...rel), '总评：' + (sum || '见下面几条。') + '\n\n' + parts.map((p, i) => '## ' + (i + 1) + '\n' + p).join('\n\n') + '\n\n（' + nowText() + '　' + CHANNELS[j.渠道].名 + ' 批的' + (j.只批 ? '，只批了镜头 ' + j.只批 : '') + '）\n');
        await resha(j.项目, ['提示词', segDir(j.段), j.名]);
        return { 结果: 'AI 批了 ' + parts.length + ' 条，稿子没动', 产出: [rel.join('/')] };
      },
    },
    /* 按批注改提示词：人在页面上写的批注（原文件名_批注.md）。AI 只回「哪一行换成什么」，这里就地换，别的一个字不动 */
    按批注改提示词: {
      title: j => '按批注改 · ' + path.basename(str(j.批注)).replace(/_批注\.md$/, ''), key: j => str(j.批注), file: j => j.段 + '/' + j.名,
      async prep(j) {
        const parts = str(j.批注).split('/').filter(Boolean);
        if (parts[0] === '项目') parts.shift();
        if (parts.length !== 4 || parts[0] !== j.项目 || parts[1] !== '提示词' || !/^第[0-9-]+段$/.test(parts[2]) || !/_批注\.md$/.test(parts[3]) || parts.some(x => !nameOk(x))) throw fail('这份批注不在这个项目的 提示词/第N段 里');
        j.段 = parts[2].slice(1, -1); j.名 = parts[3].replace(/_批注\.md$/, '.txt'); j.rel = parts.slice(1);
        if (!(await exists(pj(j.项目, ...j.rel)))) throw fail('批注文件不在了');
        if (!(await exists(vpPath(j)))) throw fail('要改的那份提示词不在了');
      },
      async book(j) {
        const sp = scriptPath(j.项目, j.段);
        return ['# 任务：按批注改视频提示词', '', '今天 ' + today() + '。下面是一份 Seedance 视频提示词的原文，和人写的批注。请照批注改。',
          '', '## 要求', '1. 只改批注说到的地方，别的一个字都不动。批注里的「原文」照抄了要改的那一行；「原文（第N处）」指全文第 N 处一样的文字；「整体」是对整份的意见。',
          '2. 批注要是把原文抄下来改过的，就是要这一行改成批注里写的样子，照抄批注，不要再润色；批注里那句话末尾没打标点的，沿用原句末尾的标点。',
          '3. 批注是提要求的（比如「这句太夸张」「基础设定太长」），就照要求改，改动尽量小；写法照 sd25-pe 和 seedance-prompt-format（冲突时以 sd25-pe 为准）。',
          '4. 回复一段 JSON：一处改动一项。「原文」是要换掉的那一整行，从原文里一字不差地抄；「第几处」是全文第几处一样的行（只有一处就写 1）；「改成」是新的一整行，要拆成几行就用 \\n 隔开，要删掉这一行就写空字符串。像这样：',
          '[{"原文": "要换掉的那一整行", "第几处": 1, "改成": "新的一整行"}]',
          '', '## 原文（文件：' + j.名 + '）', unbom(await fsp.readFile(vpPath(j), 'utf8')), '', '## 批注', unbom(await fsp.readFile(pj(j.项目, ...j.rel), 'utf8')),
          (await exists(sp)) ? '\n## 这一场的剧本（对照用）\n' + await docText(sp) : '', '', '## 技能：sd25-pe', await skill('sd25-pe'), '', '## 技能：seedance-prompt-format', await skill('seedance-prompt-format'), TAIL].join('\n');
      },
      async apply(j, text) {
        const a = text.indexOf('['), z = text.lastIndexOf(']');
        let ops;
        try { ops = JSON.parse(text.slice(a, z + 1)); } catch (e) { throw fail('AI 没按要的格式回（要一段 JSON 列表）'); }
        ops = (Array.isArray(ops) ? ops : []).filter(o => o && typeof o.原文 === 'string' && o.原文.trim() && typeof o.改成 === 'string');
        if (!ops.length) throw fail('AI 说没有要改的地方');
        const rel = ['提示词', segDir(j.段), j.名], raw = await fsp.readFile(vpPath(j), 'utf8'), bom = raw.charCodeAt(0) === 0xFEFF, eol = /\r\n/.test(raw) ? '\r\n' : '\n';
        const lines = (bom ? raw.slice(1) : raw).split(/\r\n|\n|\r/), miss = [];
        for (const o of ops) {
          const want = o.原文.trim(), nth = Math.max(1, Number(o.第几处) || 1), put = o.改成.split(/\r?\n/).map(l => l.trim()).filter((l, i, arr) => l || arr.length === 1);
          let hit = -1, seen = 0;
          for (let i = 0; i < lines.length; i++) if (lines[i] !== null && lines[i].trim() === want && ++seen === nth) { hit = i; break; }
          if (hit < 0) {   // 没有一模一样的整行：AI 可能只抄了一行里的半句。全文只有一处含着它，就换那半句
            const idx = lines.map((l, i) => l !== null && l.includes(want) ? i : -1).filter(i => i >= 0);
            if (idx.length === 1 && lines[idx[0]].split(want).length === 2) { lines[idx[0]] = lines[idx[0]].replace(want, o.改成.replace(/\r?\n/g, '')); continue; }
            miss.push(want.slice(0, 20)); continue;
          }
          lines.splice(hit, 1, ...(put.length === 1 && !put[0] ? [null] : put));   // 删掉的先占着位，下面一起拿掉：不影响后面几处数第几处
        }
        if (miss.length) throw fail('有 ' + miss.length + ' 处在稿子里没找到原话（「' + miss[0] + '…」），这回没改。稿子可能刚改过，再交一次');
        await keepCopy(j.项目, rel);
        await writeFile(vpPath(j), (bom ? BOMCH : '') + lines.filter(l => l !== null).join(eol));
        await archive(j.项目, j.rel);
        await resha(j.项目, rel);
        return { 结果: '提示词按批注改好了，改了 ' + ops.length + ' 处', 产出: [rel.join('/')] };
      },
    },
  });

  /* ---------- 任务：排队、一个一个做 ---------- */
  const jobs = [], byId = new Map();
  let seq = 0;
  const lockOf = j => j.项目 + '｜' + j.事 + '｜' + (KINDS[j.事].key ? KINDS[j.事].key(j) : j.段 || '');
  const live = j => j.状态 === '排队' || j.状态 === '在做';
  const usesCodex = j => j.渠道 === 'codex' || !!KINDS[j.事].codex;
  const fileOf = j => KINDS[j.事].file ? j.项目 + '｜' + KINDS[j.事].file(j) : '';
  const pub = j => ({ id: j.id, 事: j.事, 渠道: j.渠道, 渠道名: (CHANNELS[j.渠道] || {}).名 || j.渠道, 项目: j.项目, 段: j.段 || '', 标题: j.标题, 状态: j.状态, 步骤: j.步骤, 建: j.建, 开始: j.开始, 结束: j.结束, 错误: j.错误, 结果: j.结果, 产出: j.产出,
    记录: j.dir ? path.relative(ROOT, j.dir).split(path.sep).join('/') : '', 人物: j.人物, 道具: j.道具, 批注: j.批注, 类别: j.类别, 名: j.名, 状态名: j.状态名, 视频: j.视频, 只批: j.只批, 镜头号: j.镜头号, 本机: !!KINDS[j.事].local });
  function pump() {
    for (const j of jobs) {
      if (j.状态 !== '排队') continue;
      const busy = jobs.filter(x => x.状态 === '在做');
      if (busy.length >= 3 || busy.some(x => lockOf(x) === lockOf(j)) || (usesCodex(j) && busy.some(usesCodex))) continue;   // Codex 桌面版一次只能做一件
      if (fileOf(j) && busy.some(x => fileOf(x) === fileOf(j))) continue;   // 同一份稿一次只做一件
      work(j);
    }
  }
  async function work(j) {
    const K = KINDS[j.事], ch = CHANNELS[j.渠道];
    j.状态 = '在做'; j.开始 = Date.now(); j.步骤 = '在备材料';
    try {
      j.dir = pj(j.项目, '历史记录', 'AI任务', stampOf() + '_' + j.事 + (j.段 ? '_第' + j.段 + '段' : ''));
      await fsp.mkdir(j.dir, { recursive: true });
      if (K.run) {   // 不止一步的事（出图、出片、生成任务书）：自己管自己
        const r0 = await K.run(j);
        Object.assign(j, { 状态: '做完', 结果: r0.结果, 产出: r0.产出 || [] });
        log('AI 任务做完：' + j.标题 + '（' + Math.round((Date.now() - j.开始) / 1000) + ' 秒）');
        return;
      }
      const book = await K.book(j);
      const files = { book: path.join(j.dir, '任务书.md'), answer: path.join(j.dir, '答卷.md'), raw: path.join(j.dir, '答卷_原样.md'), msg: path.join(j.dir, '发给Codex的话.txt') };
      await writeFile(files.book, book);
      if (j.停) throw fail('停掉了');
      j.步骤 = ch.名 + ' 在写';
      const text = await ch.ask(j, book, files, j.images || []);
      await writeFile(files.answer, text);
      if (j.停) throw fail('停掉了');
      j.步骤 = '在存盘';
      const r = await K.apply(j, text);
      Object.assign(j, { 状态: '做完', 结果: r.结果, 产出: r.产出 || [] });
      log('AI 任务做完：' + j.标题 + '（' + ch.名 + '，' + Math.round((Date.now() - j.开始) / 1000) + ' 秒）');
    } catch (e) {
      j.状态 = j.停 ? '停了' : '没成'; j.错误 = j.停 ? '你点了停' : (e.plain ? e.message : '出错了：' + e.message);
      log('AI 任务' + j.状态 + '：' + j.标题 + '　' + j.错误);
    } finally { j.结束 = Date.now(); j.步骤 = ''; j.child = null; pump(); }
  }
  async function create(b) {
    const K = KINDS[str(b.事)];
    if (!K) throw fail('不认识这件事：' + b.事);
    if (K.local) b.渠道 = b.渠道 && CHANNELS[b.渠道] ? b.渠道 : Object.keys(CHANNELS)[0];   // 不用 AI 的事：渠道随便挂一个
    const ch = CHANNELS[str(b.渠道)];
    if (!ch) throw fail('不认识这个渠道：' + b.渠道);
    if (!K.local && !ch.ok()) throw fail('这台电脑上 ' + ch.名 + ' 调不起来');
    if (!nameOk(str(b.项目)) || !(await exists(pj(b.项目)))) throw fail('没有这个项目：' + b.项目);
    const j = { id: Date.now().toString(36) + (++seq).toString(36), 事: b.事, 渠道: b.渠道, 项目: b.项目, 段: str(b.段), 状态: '排队', 步骤: '', 建: Date.now(), 开始: 0, 结束: 0, 错误: '', 结果: '', 产出: [], dir: '', child: null, 停: false };
    if ((K.need || []).includes('段') && !segOk(j.段)) throw fail('要说清是第几场');
    for (const k of ['人物', '道具']) if (Array.isArray(b[k])) j[k] = b[k].map(str).filter(Boolean);
    if (b.批注) j.批注 = str(b.批注);
    for (const k of ['类别', '名', '状态名', '要求', '视频', '批准', '只批', '镜头号', '镜头ID', '重写']) if (b[k] != null) j[k] = str(b[k]);
    if (Array.isArray(b.镜头)) j.镜头 = b.镜头.map(Number).filter(n => n > 0);
    if (Array.isArray(b.段落)) j.段落 = b.段落.map(Number).filter(n => n > 0);
    if (b.参数 && typeof b.参数 === 'object') j.参数 = b.参数;
    if (K.prep) await K.prep(j);
    j.标题 = K.title(j);
    const same = jobs.find(x => live(x) && lockOf(x) === lockOf(j));
    if (same) return same;   // 同一件事已经在做：不重开
    jobs.push(j); byId.set(j.id, j);
    while (jobs.length > 200) byId.delete(jobs.shift().id);
    log('开了一个 AI 任务：' + j.标题 + '（' + ch.名 + '）');
    pump();
    return j;
  }
  function cancel(j) {
    if (!live(j)) return;
    j.停 = true;
    if (j.状态 === '排队') { j.状态 = '停了'; j.错误 = '你点了停'; j.结束 = Date.now(); }
    else kill(j.child);
  }

  /* ---------- 即梦授权：看登没登录、是哪个号；要登录就拿一个授权链接，用户自己在浏览器里点同意 ---------- */
  const JM = process.env.ANTOU_JIMENG || path.join(os.homedir(), 'bin', 'dreamina-canvas.exe');
  async function jm(args, timeout) {
    if (!fs.existsSync(JM)) return { ok: false, error: '这台电脑上没找到即梦命令行（' + JM + '）' };
    try {
      const r = await run(JM, ['--non-interactive', ...args], { timeout: timeout || 40e3 });
      let data = null;
      try { data = JSON.parse(r.out); } catch (e) { /* 不是 JSON 就原样给 */ }
      return { ok: r.code === 0, code: r.code, data, raw: (r.out || r.err).trim().slice(0, 4000) };
    } catch (e) { return { ok: false, error: '即梦命令行调不起来：' + e.message }; }
  }
  async function jimeng(req, res, q, { json, httpErr }) {
    const profile = q.get('profile') || '';
    if (!/^[A-Za-z0-9_-]{0,40}$/.test(profile)) throw httpErr(400, '登录位的名字只能是字母、数字、横线');
    const pf = profile ? ['--profile', profile] : [];
    if (req.method === 'GET') {
      const status = await jm([...pf, 'auth', 'status']);
      const account = status.ok ? await jm([...pf, 'auth', 'account']) : null;
      return json(res, { profile, status, account });
    }
    if (req.method === 'POST' && q.has('login')) return json(res, await jm([...pf, 'auth', 'login']));
    if (req.method === 'POST' && q.has('wait')) {
      const code = q.get('code') || '';
      if (!/^[A-Za-z0-9_.~-]{6,200}$/.test(code)) throw httpErr(400, '授权码不对');
      return json(res, await jm([...pf, 'auth', 'wait', '--device-code', code, '--timeout', '50s'], 70e3));
    }
    throw httpErr(405, '不支持');
  }

  async function handle(req, res, url, { json, readBody, httpErr }) {
    const p = url.pathname, q = url.searchParams;
    try {
      if (p === '/api/jimeng') return await jimeng(req, res, q, { json, httpErr });
      if (req.method === 'GET' && p === '/api/job') {
        if (q.has('channels')) return json(res, { channels: Object.entries(CHANNELS).map(([id, c]) => ({ id, 名: c.名, 说明: c.说明, ok: c.ok() })) });
        const name = q.get('p') || '';
        return json(res, { now: Date.now(), jobs: jobs.filter(j => !name || j.项目 === name).slice(-60).map(pub) });
      }
      if (req.method === 'POST' && p === '/api/job') {
        let b;
        try { b = JSON.parse((await readBody(req, 1e6)).toString('utf8')); } catch (e) { throw fail('请求读不了'); }
        return json(res, pub(await create(b || {})));
      }
      const m = /^\/api\/job\/([a-z0-9]+)$/.exec(p);
      if (m) {
        const j = byId.get(m[1]);
        if (!j) throw httpErr(404, '没有这个任务（服务重开过的话，之前的任务记不住）');
        if (req.method === 'POST' && q.has('cancel')) cancel(j);
        return json(res, pub(j));
      }
      throw httpErr(404, '没有这个接口');
    } catch (e) {
      if (e.plain) throw httpErr(400, e.message);
      throw e;
    }
  }
  return { handle, KINDS, CHANNELS };
};
