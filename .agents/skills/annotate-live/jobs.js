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
     交给 AI 等回复的（给我提示词、Claude 桌面版、DeepSeek 窗口，下面「交给 AI」那一节）：
     GET  /api/job/<id>?msg    要交代的话；POST ?reply 回复到了（带回复＝页面贴回来的）；POST ?reopen Claude 再开一次
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
  /* 白模＋关键帧的写法（2026-11-14 他定：和普通写法分开，照官方指南）：句子和校对和流水线、写稿页同一套 */
  const BmKey = (() => { try { return require(path.join(TOOLS, '公用', '白模关键帧写法.js')); } catch (e) { log('读不了 公用/白模关键帧写法.js：' + e.message); return null; } })();
  /* 关键帧的写法（sd25-pe 关键帧锚点）：审片时弃用的关键帧，照方案改的时候照它去掉（和提示词那一步「改关键帧」同一套） */
  const KeyFrames = (() => { try { return require(path.join(TOOLS, '公用', '关键帧写法.js')); } catch (e) { log('读不了 公用/关键帧写法.js：' + e.message); return null; } })();
  /* 拍摄风格（2026-11-14 他定：剧本定稿以后照剧本挑，记在流水线.json 的「风格」）：风格库怎么读、交给 AI 时写哪几行，和页面同一套 */
  const Style = (() => { try { return require(path.join(TOOLS, '公用', '风格库.js')); } catch (e) { log('读不了 公用/风格库.js：' + e.message); return null; } })();
  /* 提示词的无损读写（和写稿页同一套）：先写提示词的场，反推剧本只读人写的两块，直接铺底只改 AI 写的几块（11-14） */
  const PromptDraft = (() => { try { return require(path.join(TOOLS, '公用', '写稿状态.js')); } catch (e) { log('读不了 公用/写稿状态.js：' + e.message); return null; } })();
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
  const retry = msg => Object.assign(new Error(msg), { plain: true, retry: true });   // 交给 AI 等回复的：还差一点（图还没存好），接着等，不算没成
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
  const CX = process.env.ANTOU_CODEX_CHAT || path.join(SKILLS, 'codex-chat', 'codex-chat.ps1');   // ANTOU_CODEX_CHAT：试验服务上换成假的，免得试页面时真去出片
  /* 2026-11-14 他定：用 AI 的地方都有两种——「给我提示词」（人贴进自己开的对话）、项目直接调；直接调一律看得见：
     Claude 在 Claude 桌面版开新对话（人按发送），DeepSeek 在 DeepSeek Harness 的窗口里做，Codex 本来就是看得见的对话。
     桌面版、Harness 没装的，照旧后台调（他说没装就不要求看得见）。装没装、怎么开在 handoff.js；等回复和「给我提示词」是同一套（下面「交给 AI」那一节） */
  const HAND = require('./handoff.js')({ log });
  const SELF = '自己交给 AI';   // 「给我提示词」的渠道号（11-14 头一版叫「自己交给 AI」，页面、记录里都认这个号，名字改了号不改）
  const resultJson =out => { const m = /RESULT_JSON (\{.*\})\s*$/m.exec(out); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } };
  const SEE = imgs => '先用 Read 工具把下面 ' + imgs.length + ' 张图各看一遍（只读，不要动任何文件，不要用别的工具）：\n' + imgs.join('\n') + '\n\n看完再照下面的任务书做，回复里只要任务书要的内容。\n\n';
  /* 推理深度（2026-11-14 加，页面顶栏「推理」选，跟着「AI 用」选的那个 AI 走）：Claude、DeepSeek 每个任务能定。
     Codex 定不了：深链接没有这一项；临时改 项目\.codex\config.toml 试过，输入框会记住改过的那一档、下一个对话也跟着错。
     Codex 照它自己的设置，做完从会话记录读出这一回实际用的档（codex-chat 回的 effort）
     模型（11-14 同一天加，顶栏「模型」选）：Claude 传 --model，DeepSeek 传 deepseek.py 的 --model；Codex 跟上面一样定不了，做完读实际用的（model_id）。
     Claude 改成回 JSON，从 modelUsage 读出这一回实际是哪个模型答的 */
  const DEPTH_NAME = { none: '不推理', low: '低', medium: '中', high: '高', xhigh: '很高', max: '最高', ultra: 'Ultra' };
  const depthName = d => DEPTH_NAME[d] || d;
  const MODEL_NAME = { 'deepseek-flash': 'Flash', 'deepseek-v4-pro': 'V4 Pro' };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const modelName = m => {   // claude-opus-5-5 → Opus 5.5；gpt-6.1-terra → Terra
    if (!m) return '';
    if (MODEL_NAME[m]) return MODEL_NAME[m];
    let x = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(m);
    if (x) return cap(x[1]) + ' ' + x[2] + '.' + x[3];
    x = /^gpt-[\d.]+-([a-z]+)$/.exec(m);
    return x ? cap(x[1]) : m;
  };
  const cxConf = k => { try { return (new RegExp('^[ \\t]*' + k + '[ \\t]*=[ \\t]*"([^"]+)"', 'm').exec(fs.readFileSync(path.join(HOME, '.codex', 'config.toml'), 'utf8')) || [])[1] || ''; } catch (e) { return ''; } };
  const seen = { codex: {}, claude: {} };   // 开服务以来最近一回实际用的：Codex 的模型和档；Claude 不指定模型时是哪个
  const cxNow = k => seen.codex[k] || cxConf(k === 'model' ? 'model' : 'model_reasoning_effort');   // Codex 输入框里换过，做完一回就跟上
  const cxSeen = (j, res) => {   // Codex 做完：记下这一回实际用的模型和档；选的是 Codex 时才记到任务上（选别的 AI 时，模型、推理说的是那个 AI）
    if (!res) return;
    if (res.effort) seen.codex.effort = String(res.effort);
    if (res.model_id) seen.codex.model = String(res.model_id);
    if (j.渠道 !== 'codex') return;
    if (res.effort) j.实际深度 = String(res.effort);
    if (res.model_id) j.实际模型 = String(res.model_id);
  };
  const depthOf = j => j.深度 || j.实际深度 || '';   // 这个任务用的推理深度：选了的，或者做完读出来的
  const modelOf = j => j.模型 || j.实际模型 || '';   // 这个任务用的模型：选了的，或者做完读出来的
  const chLabel = j => { if (j.渠道 === SELF) return '你自己交的 AI'; const t = [modelName(modelOf(j)), depthName(depthOf(j))].filter(Boolean).join(' · '); return ((CHANNELS[j.渠道] || {}).名 || j.渠道) + (t ? '（' + t + '）' : ''); };
  const CHANNELS = {
    claude: HAND.claudeDesktop ? {
      名: 'Claude', 说明: '在 Claude 桌面版新开一个对话，任务填好，你按一下发送；看得见、能插话，做完它告诉项目', hand: 'claude',
      模型: [], 默认模型: () => '', 模型说明: '在 Claude 新开的那个对话里，按发送前用输入框下面的按钮换',
      深度: [], 默认深度: () => '', 深度说明: '在 Claude 新开的那个对话里，按发送前用输入框下面的按钮换',
      ok: () => true,
      ask: (job, book, files, images) => handoff(job, files, 'claude', images, files.check),
    } : {
      名: 'Claude', 说明: '本机的 Claude Code，只让它写字（没装 Claude 桌面版，在后台写）',
      模型: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],   // 11-14 四个都实测能用
      默认模型: () => seen.claude.model || 'claude-opus-5-5', 模型说明: '默认＝不指定，照 Claude Code 自己的默认（11-14 实测是 Opus 5.5）。Fable 最强，也最费额度',
      深度: ['low', 'medium', 'high', 'xhigh', 'max'], 默认深度: () => '', 深度说明: '默认＝不指定，照 Claude Code 自己的默认档',
      ok: () => CLAUDE === 'claude' || fs.existsSync(CLAUDE),
      async ask(job, book, files, images) {
        const imgs = images || [];   // 要它看的图：只给它开「读文件」这一样工具，别的都不给
        const args = imgs.length ? ['-p', '--tools', 'Read', '--allowedTools', 'Read', '--add-dir', pj(job.项目), '--no-session-persistence', '--output-format', 'json'] : ['-p', '--tools', '', '--no-session-persistence', '--output-format', 'json'];
        const mine = job.渠道 === 'claude';   // 选的是 Claude 时才用页面上选的模型和档（选别的 AI 时，那两样说的是那个 AI）
        if (mine && job.模型) args.push('--model', job.模型);
        if (mine && job.深度) args.push('--effort', job.深度);
        const r = await run(CLAUDE, args, { cwd: os.tmpdir(), input: imgs.length ? SEE(imgs) + book : book, job });
        const s = r.out.trim();
        let o = null;
        try { o = JSON.parse(s); } catch (e) { try { o = JSON.parse(s.slice(s.lastIndexOf('\n{') + 1)); } catch (e2) {} }
        if (!o) throw fail('Claude 没答上来：' + (r.err.trim() || s || '退出码 ' + r.code).slice(0, 300));
        const used = Object.entries(o.modelUsage || {}).sort((a, b) => ((b[1] || {}).outputTokens || 0) - ((a[1] || {}).outputTokens || 0))[0];
        if (used && mine) { job.实际模型 = used[0]; if (!job.模型) seen.claude.model = used[0]; }
        const text = typeof o.result === 'string' ? o.result : '';
        if (o.is_error || r.code !== 0 || !text.trim()) throw fail('Claude 没答上来：' + (text.trim() || r.err.trim() || '退出码 ' + r.code).slice(0, 300));
        return text;
      },
    },
    codex: {
      名: 'Codex', 说明: '本机的 Codex 桌面版，会开一个看得见的对话',
      模型: [], 默认模型: () => cxNow('model'), 模型说明: '这里定不了，照 Codex 自己的设置（在 Codex 输入框下面的模型按钮里换）',
      深度: [], 默认深度: () => cxNow('effort'), 深度说明: '这里定不了，照 Codex 自己的设置（在 Codex 输入框下面的模型按钮里换）',
      ok: () => process.platform === 'win32' && fs.existsSync(CX),
      async ask(job, book, files, images) {
        // 11-14：原来写「不要运行命令」，Codex 读不了文件，就用 Computer Use 开记事本一份一份读。读文件让它用命令行，只是不许写
        await writeFile(files.msg, '请读 ' + files.book + '，照里面的要求回复。' + ((images || []).length ? '动笔前先用 view_image 把这几张图各看一遍：' + images.join('　') + '。' : '')
          + '读文件用命令行（Get-Content -Raw -Encoding UTF8），要用的材料任务书里都带齐了。只读不写：不要改、不要新建任何文件。不要用 Computer Use，不要打开记事本或别的软件、窗口。只回复结果。');
        const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CX, '-PromptFile', files.msg, '-Path', HOME, '-Timeout', '1500'], { job, timeout: 27 * 60e3 });
        await fsp.unlink(files.msg).catch(() => {});
        const j = resultJson(r.out);
        cxSeen(job, j);
        if (!j || !j.ok) throw fail('Codex 没答上来：' + ((j && j.error) || r.err.trim() || r.out.trim() || '没有结果').slice(0, 300));
        const a = r.out.indexOf('=== Codex 回复 ==='), z = r.out.lastIndexOf('RESULT_JSON ');
        const text = a >= 0 && z > a ? r.out.slice(a + '=== Codex 回复 ==='.length, z) : '';
        if (!text.trim()) throw fail('Codex 回了空的');
        return text;
      },
    },
    deepseek: HAND.dsHarness ? {
      名: 'DeepSeek', 说明: '在 DeepSeek Harness 的窗口里做（只读），看得见它想什么、读什么；对话存在 DeepSeek Harness 里，按量计费', hand: 'deepseek',
      模型: [], 默认模型: () => '', 模型说明: '照 DeepSeek Harness 自己的设置',
      深度: [], 默认深度: () => '', 深度说明: '照 DeepSeek Harness 自己的设置',
      ok: () => true,
      ask: (job, book, files, images) => handoff(job, files, 'deepseek', images, files.check),
    } : {
      名: 'DeepSeek', 说明: 'DeepSeek 接口，按量计费（没装 DeepSeek Harness，在后台调）',
      模型: ['deepseek-flash', 'deepseek-v4-pro'], 默认模型: () => 'deepseek-flash', 模型说明: '默认＝Flash，能看图。V4 Pro 看不了图，贵三四倍',
      深度: ['none', 'low', 'high', 'max'], 默认深度: () => 'high', 深度说明: '默认＝高。越深越慢、花钱越多',
      ok: () => !!PY && fs.existsSync(DS),
      async ask(job, book, files, images) {
        const fwd = p => p.replace(/\\/g, '/');
        const mine = job.渠道 === 'deepseek', m = (mine && job.模型) || 'deepseek-flash';
        if (m === 'deepseek-v4-pro' && (images || []).length) throw fail('DeepSeek V4 Pro 看不了图，这件事要看图：模型换成 Flash 再点一次');
        const r = await run(PY, ['-I', DS, '--model', m, '--effort', (mine && job.深度) || 'high', '-f', fwd(files.book), '--out', fwd(files.raw), ...(images || []).flatMap(p => ['--image', fwd(p)])], { env: { PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', MSYS_NO_PATHCONV: '1' }, job });
        const j = resultJson(r.out);
        if (j && mine) { if (j.model) job.实际模型 = String(j.model); if (j.effort) job.实际深度 = String(j.effort); }
        if (!j || !j.ok) throw fail('DeepSeek 没答上来：' + ((j && j.error) || r.err.trim() || '没有结果').slice(0, 300));
        if (j.truncated) throw fail('DeepSeek 的回答太长，被截断了。换 Claude 或 Codex 试试');
        const text = await fsp.readFile(j.out || files.raw, 'utf8');
        await fsp.unlink(j.out || files.raw).catch(() => {});
        return text;
      },
    },
    [SELF]: {   // 给我提示词：不调 AI，人把话贴进自己开的对话（下面「交给 AI」那一节）
      名: '给我提示词', 说明: '不调 AI：把要交代的话给你，贴进你自己开的对话（Codex、Claude、DeepSeek 都行）；它做完告诉项目，这里自动接着做', hand: 'self',
      模型: [], 默认模型: () => '', 模型说明: '', 深度: [], 默认深度: () => '', 深度说明: '',
      ok: () => true,
      ask: (job, book, files, images) => handoff(job, files, 'self', images, files.check),
    },
  };
  /* 试页面用的假通道：ANTOU_MOCK_DIR 里放 <事>.txt 当答卷；一个任务里问几回的，<事>_<这一回的名>.txt（比如 按方案改提示词_核图.txt），没有就用 <事>.txt（只在试验服务上开） */
  if (process.env.ANTOU_MOCK_DIR) CHANNELS.mock = {
    名: '假的（试页面用）', 说明: '', ok: () => true, 模型: ['mock-a', 'mock-b'], 默认模型: () => '', 模型说明: '试页面用', 深度: ['low', 'high'], 默认深度: () => '', 深度说明: '试页面用',
    async ask(job, book, files) {
      await sleep(Number(process.env.ANTOU_MOCK_MS) || 2500);
      const d = process.env.ANTOU_MOCK_DIR, one = files && files.tag ? path.join(d, job.事 + '_' + files.tag + '.txt') : '';
      return fsp.readFile(one && (await exists(one)) ? one : path.join(d, job.事 + '.txt'), 'utf8');
    },
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
  const segRefs = s => ['人物', '道具'].flatMap(k => (Array.isArray(s[k + '图']) ? s[k + '图'] : []).map(f => ({ k, f: String(f).replace(/\\/g, '/'), n: path.basename(String(f)).replace(/\.[^.]+$/, '') })));   // 这一段文件夹里的图，这一场当人物、道具用的（流水线 11-13 起有；不挂表里哪一行）
  function sceneText(flow, s) {
    const ps = parasOf(s), seg = segRefs(s);
    return ['出场的人物：' + ((s.人物 || []).join('、') || '（没选）'), '出场的道具：' + ((s.道具 || []).join('、') || '（没选）'),
      ...(seg.length ? ['这一场另挂的参考图（这一段文件夹里的，只这一场用）：' + seg.map(x => x.k + '「' + x.n + '」').join('、')] : []),
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
  async function codexDo(j, msg, opt = {}) {   // 让 Codex 真去做一件事（它会开一个看得见的对话）
    /* 给我提示词：这件事人贴进自己的 Codex 去做（要用它的出图工具、操作即梦）；opt.核图：出完图顺手对着字核一遍，写进回复；
       opt.check：回复到了先查一遍（图存到了没有），不对就接着等它改好，不算没成 */
    if (j.渠道 === SELF) return (await handoff(j, { codex: msg, 核图: !!opt.核图, ...(opt.tag ? { tag: opt.tag } : {}) }, 'self', [], opt.check)).trim();   // tag：一个任务里交几回的（照方案改一张张出图），回复文件各叫各的
    const f = path.join(j.dir, '发给Codex的话.txt');
    await writeFile(f, msg);
    const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CX, '-PromptFile', f, '-Path', HOME, '-Timeout', '1700'], { job: j, timeout: 30 * 60e3 });
    const res = resultJson(r.out);
    cxSeen(j, res);
    if (!res || !res.ok) throw fail('Codex 没做成：' + ((res && res.error) || r.err.trim() || r.out.trim() || '没有结果').slice(0, 300));
    const a = r.out.indexOf('=== Codex 回复 ==='), z = r.out.lastIndexOf('RESULT_JSON ');
    return a >= 0 && z > a ? r.out.slice(a + '=== Codex 回复 ==='.length, z).trim() : '';
  }
  async function askText(j, chId, book, tag, images, check) {   // 多一步的事：中间要 AI 写一段字。images：要它看的图；check：交给人、Claude 桌面版的，回复格式不对就接着等它改好
    const ch = CHANNELS[chId], files = { book: path.join(j.dir, '任务书_' + tag + '.md'), raw: path.join(j.dir, '答卷_' + tag + '_原样.md'), msg: path.join(j.dir, '发给Codex的话.txt'), tag, ...(check ? { check } : {}) };
    await writeFile(files.book, book);
    j.步骤 = (chId === j.渠道 ? chLabel(j) : ch.名) + ' 在写' + tag;
    const text = await ch.ask(j, book, files, images || []);
    await writeFile(path.join(j.dir, '答卷_' + tag + '.md'), text);
    return text;
  }
  async function updateList(name, seg, item) {   // 资产清单里记一笔：页面看到图在了，会替人把它和表里那一行对上
    const p = pj(name, '资产', segDir(seg) + '_资产清单.json');
    let cur = { 资产: [] };
    try { const t = JSON.parse(unbom(await fsp.readFile(p, 'utf8'))); cur = Array.isArray(t) ? { 资产: t } : t; } catch (e) { /* 还没有清单 */ }
    const list = Array.isArray(cur.资产) ? cur.资产 : [], old = list.find(x => x && x.文件 === item.文件);   // 同一张图记一条：前面一步记的（要撑住、核图）留着，这一步的盖上去
    const { _log, ...rest } = item, next = old ? { ...old, ...rest } : rest;
    if (_log) next.过程 = [...(old && Array.isArray(old.过程) ? old.过程 : []), _log].slice(-12);   // AI 在这一样上做过的事：资产那一页列出来，任务书、回复能点开看（11-14 他嫌太黑盒）
    cur.资产 = list.filter(x => x !== old);
    cur.资产.push(next);
    await writeFile(p, JSON.stringify(cur, null, 2) + '\n');
  }
  /* 记一笔「AI 做过的事」：什么时候、做的什么、谁做的、任务书和回复放在哪（项目里的路径） */
  const logOf = (j, 事, who) => ({ 时间: nowText(), 事: 事 || j.事, 渠道: who || chLabel(j), 目录: j.dir ? path.relative(pj(j.项目), j.dir).split(path.sep).join('/') : '' });
  async function logWord(j, txt, 事, fields) {   // 按字找资产清单里那一条（照批注改字只知道字在哪）：记一笔，fields 一起盖上
    const p = pj(j.项目, '资产', segDir(j.段) + '_资产清单.json');
    try {
      const cur = JSON.parse(unbom(await fsp.readFile(p, 'utf8'))), list = Array.isArray(cur) ? cur : Array.isArray(cur.资产) ? cur.资产 : [];
      const hit = list.filter(x => x && x.字 === txt);
      if (!hit.length) return;
      for (const x of hit) { Object.assign(x, fields || {}); x.过程 = [...(Array.isArray(x.过程) ? x.过程 : []), logOf(j, 事)].slice(-12); }
      await writeFile(p, JSON.stringify(Array.isArray(cur) ? { 资产: list } : cur, null, 2) + '\n');
    } catch (e) { /* 还没有清单：不记 */ }
  }
  /* ---------- 文生资产（2026-11-14 他定的流程，讨论记录 通用工具/流水线/文生资产_讨论.md）：字先定，图后出。
     这一场剧本定稿以后：写字（AI 读定稿的剧本：每样写清要撑住什么、核旧图撑不撑得住，没图的写出图提示词，场景先做 GEO）
     → 人批字（自己改，或写批注交给 AI 改）→ 人点「照这个出图」→ 出图（Codex 一次一张；已经有图的，新图先存成候选，人点「用这张」才换上）
     → AI 核图 → 人批图（照批注改图，或回去改字）→ 确认可用 → 场景图确认以后照图再核一遍 GEO。
     关键帧也走这一套：在提示词那一步做，字和图放在这一段的文件夹里 ---------- */
  const WORD_CATS = ['人物', '道具', '场景', '关键帧'];
  const EDIT_TASK = path.join(TOOLS, '流水线', '任务书', '按批注改图任务.txt');
  const stemOf = f => path.basename(String(f)).replace(/\.[^.]+$/, '');
  const imgsOf = e => (!e ? [] : Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : []).map(g => String(g).replace(/\\/g, '/'));
  const stateOfImg = (name, file) => { const b = stemOf(file); return b === name ? '' : b.startsWith(name + '_') ? b.slice(name.length + 1) : b; };
  const oneLine = t => str(t).replace(/\s+/g, ' ').trim();
  /* 只用文字写的场景（全片设定「场景」里的一行）要出图时用的名字：冒号前那一段。页面（流水线.js 的 sceneStem）和这里一样算 */
  function sceneStem(t) {   // 「面摊：傍晚……」叫「面摊」，「一个出租屋内，一张床……」叫「一个出租屋内」
    const x = str(t).trim(), c = x.search(/[：:]/), p = x.search(/[，,。；;\n]/);
    const a = (c >= 1 && c <= 12 && (p < 0 || c < p) ? x.slice(0, c) : p >= 2 && p <= 14 ? x.slice(0, p) : x.slice(0, 12)).replace(/[<>:"\\/|?*\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, '');
    return nameOk(a) ? a : '';
  }
  const mtimeOf = async p => { try { return Math.floor((await fsp.stat(p)).mtimeMs); } catch (e) { return 0; } };   // 核图记下核的是哪一张（图的修改时间）：页面照它分清说的是原图还是候选
  /* 一样东西的几个文件：字（出图提示词）、GEO 底稿（场景）、字的批注、图、候选图、图的批注（看大图时写的） */
  function wordFiles(cat, stem, seg, img) {
    const p = cat === '关键帧' ? ['提示词', segDir(seg)] : ['提示词', '全局资产', cat], a = cat === '关键帧' ? ['资产', segDir(seg)] : ['资产', '全局资产', cat];
    return { txt: [...p, stem + '_提示词.txt'], note: [...p, stem + '_提示词_批注.md'], geo: cat === '场景' ? [...p, stem + '_GEO底稿.md'] : null,
      img: img || [...a, stem + '.png'], cand: [...a, stem + '_候选.png'], imgNote: [...a, stem + '_批注.md'], shots: [...a, stem + '_批注截图'] };
  }
  /* 页面给的那张图（已经挂着的，名字不一定是「叫法.png」，比如 童爸爸_三十出头.png）：要在这一类的文件夹里 */
  function imgParts(cat, seg, file) {
    const img = str(file).replace(/\\/g, '/').split('/').filter(Boolean);
    if (!img.length) return null;
    const dir = cat === '关键帧' ? ['资产', segDir(seg)] : ['资产', '全局资产', cat];
    if (img.length !== dir.length + 1 || dir.some((x, i) => img[i] !== x) || !/\.(png|jpe?g|webp)$/i.test(img[img.length - 1]) || !img.every(nameOk)) throw fail('这张图不在 ' + dir.join('/') + ' 里');
    return img;
  }
  async function wordPrep(j) {
    if (!WORD_CATS.includes(j.类别)) throw fail('只出人物、道具、场景、关键帧的图');
    const p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {}, img = imgParts(j.类别, j.段, p.图);
    j.文件名 = img ? stemOf(img[img.length - 1]) : j.状态名 ? str(j.名) + '_' + j.状态名 : str(j.名);
    if (!nameOk(str(j.名)) || !nameOk(j.文件名) || /_候选$/.test(j.文件名)) throw fail('名字里有不能当文件名的字');
    j.files = wordFiles(j.类别, j.文件名, j.段, img);
  }
  async function needFinal(j, flow) {   // 剧本定稿了才写字、出图
    const s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
    if (!s || !(await exists(sp)) || !finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs))) throw fail('剧本定稿以后才能写字、出图');
    return s;
  }
  async function mockImage(p) { await sleep(1500); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.copyFile(path.join(process.env.ANTOU_MOCK_DIR, '图.png'), p); }
  async function noteList(j, fields) {   // 资产清单里这一张记一笔（关键帧也记，页面照它摆 AI 核图的话）
    await updateList(j.项目, j.段, { 类别: j.类别, 名称: str(j.名), ...(j.状态名 ? { 状态名: j.状态名 } : {}), 文件: j.files.img.join('/'), 字: j.files.txt.join('/'), ...fields });
  }
  /* 图出好了，让顶栏选的那个 AI 对着字核一遍：缺的、多的（视频会照抄）。没核成不挡出图 */
  async function checkImage(j, txt, out) {
    try {
      const ch = CHANNELS[j.渠道] || CHANNELS.codex, word = unbom(await fsp.readFile(pj(j.项目, ...txt), 'utf8'));
      const refs = [];   // 字开头「图1：完整路径（说明）」那几行：参考图跟着一起给它看（关键帧照参考图的长相、样子）
      for (const m of word.matchAll(/^图(\d+)：(.+?)（[^（）\n]*）[ \t]*$/gm)) if (path.isAbsolute(m[2].trim()) && await exists(m[2].trim())) refs.push(m[2].trim());
      const book = ['# 任务：核一张刚出的图', '', '这是一个 AI 短视频项目。下面是这张图的字（出图提示词，开头写着它要撑住什么）。' + (refs.length ? '给你看的第一张是刚出的图，后面几张依次是字里的「图1」「图2」……（参考图）。' : '图已经让你看过了。') + '请核：',
        '1. 字里要的、要撑住的，图里有没有缺的、画错的' + (refs.length ? '；长相、衣着、样子和参考图对不对得上' : '') + '；', '2. 图里有没有多出字里没有、又不该有的东西（视频会照抄）；', '3. 合不合理：东西摆在哪、光从哪来。',
        '只回一两句大白话，说最要紧的；没问题就回「没看出问题」。', '', '## 字', word, TAIL].join('\n');
      const files = { book: path.join(j.dir, '任务书_核图.md'), raw: path.join(j.dir, '答卷_核图_原样.md'), msg: path.join(j.dir, '发给Codex的话_核图.txt'), tag: '核图' };
      await writeFile(files.book, book);
      j.步骤 = ch.名 + ' 在核图';
      const text = await ch.ask(j, book, files, [pj(j.项目, ...out), ...refs.slice(0, 5)]);
      await writeFile(path.join(j.dir, '答卷_核图.md'), text);
      return oneLine(body(text)).slice(0, 300);
    } catch (e) { if (j.停) throw e; log('核图没做成：' + e.message); return ''; }   // 人点了停：别当成核图没成接着往下走
  }
  /* 这一场要写字、要核的几样：出场的人物、道具（全片的图），场景（全片的场景图、只用文字写的场景）。这一段文件夹里的图不走这一步。
     只：页面点名的那几样，照点名的来，原来有字的也重写（照「要求」改） */
  async function wordItems(j, flow, s) {
    const out = [], seen = new Set();
    const read = async parts => parts && (await exists(pj(j.项目, ...parts))) ? unbom(await fsp.readFile(pj(j.项目, ...parts), 'utf8')).trim() : '';
    const add = async x => {
      const f = wordFiles(x.类别, x.stem, j.段, x.图 ? x.图.split('/') : null), key = f.txt.join('/');
      if (seen.has(key)) return;
      seen.add(key);
      const imgP = pj(j.项目, ...f.img), 有图 = await exists(imgP), 有字 = await exists(pj(j.项目, ...f.txt));
      const mt = 有图 ? Math.floor((await fsp.stat(imgP)).mtimeMs) : 0;
      const 确认 = 有图 && timeOf((flow.可用 || {})[f.img.join('/')]) + 999 >= Math.max(mt, x.描写改 || 0);
      const 写 = !!x.只 || (!有字 && !有图);
      out.push({ 参考: [], 要求: '', ...x, f, 图: f.img.join('/'), 有图, 有字, 确认, 写, 旧字: 写 ? await read(f.txt) : '', 旧GEO: 写 ? await read(f.geo) : '' });
    };
    const entry = (k, n) => (Array.isArray(flow[k]) ? flow[k] : []).find(e => e && e.名 === n) || null;
    const inGlobal = (k, g) => g.startsWith('资产/全局资产/' + k + '/') && !g.slice(('资产/全局资产/' + k + '/').length).includes('/');
    if (j.只.length) {
      for (const x of j.只) {
        const e = x.类别 === '人物' || x.类别 === '道具' ? entry(x.类别, x.名称) : null;
        let img = null;
        try { img = imgParts(x.类别, j.段, x.图); } catch (err) { continue; }
        const stem = img ? stemOf(img[img.length - 1]) : x.状态名 ? x.名称 + '_' + x.状态名 : x.名称;
        if (!nameOk(stem) || /_候选$/.test(stem)) continue;
        const 参考 = [];
        for (const g of x.参考) { const parts = g.split('/').filter(Boolean); if (parts[0] === '资产' && parts.every(nameOk) && /\.(png|jpe?g|webp)$/i.test(g) && await exists(pj(j.项目, ...parts))) 参考.push(parts.join('/')); }
        await add({ 类别: x.类别, 名称: x.名称, 状态名: x.状态名, stem, 图: img ? img.join('/') : '', 描写: e ? str(e.描写).trim() : x.文字, 描写改: e ? timeOf(e.描写改) : 0, 要求: x.要求, 参考, 提示词: x.提示词 || '', 只: true });
      }
      return out;
    }
    for (const k of ['人物', '道具']) for (const n of Array.isArray(s[k]) ? s[k] : []) {
      const e = entry(k, n), all = imgsOf(e), mine = all.filter(g => inGlobal(k, g));
      if (mine.length) { for (const g of mine) await add({ 类别: k, 名称: n, 状态名: mine.length > 1 ? stateOfImg(n, g) : '', stem: stemOf(g), 图: g, 描写: e ? str(e.描写).trim() : '', 描写改: e ? timeOf(e.描写改) : 0 }); }
      else if (!all.length && nameOk(n)) await add({ 类别: k, 名称: n, 状态名: '', stem: n, 图: '', 描写: e ? str(e.描写).trim() : '', 描写改: e ? timeOf(e.描写改) : 0 });
    }
    for (const g of (Array.isArray(s.场景图) ? s.场景图 : []).map(x => String(x).replace(/\\/g, '/')).filter(g => inGlobal('场景', g))) await add({ 类别: '场景', 名称: stemOf(g), 状态名: '', stem: stemOf(g), 图: g, 描写: '' });
    for (const t of (Array.isArray(s.场景文字) ? s.场景文字 : []).map(str).filter(Boolean)) { const st = sceneStem(t); if (st) await add({ 类别: '场景', 名称: st, 状态名: '', stem: st, 图: '', 描写: t.trim() }); }
    return out;
  }
  function otherScenes(flow, s, items) {   // 别的场也用这几样的：剧本定稿了的一起照顾到，没定稿的只预留
    const lines = [];
    for (const x of Array.isArray(flow.场) ? flow.场 : []) {
      if (!x || x === s || !x.定稿) continue;
      const uses = items.filter(it => it.类别 === '人物' || it.类别 === '道具' ? (x[it.类别] || []).includes(it.名称)
        : it.类别 === '场景' ? (x.场景图 || []).some(g => String(g).replace(/\\/g, '/') === it.图) || (x.场景文字 || []).some(t => sceneStem(t) === it.名称) : false);
      if (uses.length) lines.push('第' + x.段 + '场（' + (x.剧本定稿 ? '剧本定稿了' : '剧本还没定稿，只预留') + '）用到：' + [...new Set(uses.map(it => it.名称))].join('、') + '。这一场主要表达：' + (oneLine(x.表达) || '（没写）').slice(0, 200));
    }
    return lines.join('\n') || '（没有别的场用到这几样）';
  }
  /* 写字的回复：一样一节，【类别｜名称】或【类别｜名称｜状态】开头，里面「要撑住：」「核图：」「GEO底稿：」「出图提示词：」 */
  function wordSecs(text) {
    const t = text.replace(/\r\n/g, '\n').replace(/^\s*```.*$/gm, ''), re = /^[ \t]*【(人物|道具|场景|关键帧)｜([^｜】\n]+)(?:｜([^】\n]+))?】[ \t]*$/gm;
    const heads = [...t.matchAll(re)];
    return heads.map((m, i) => {
      const part = t.slice(m.index + m[0].length, i + 1 < heads.length ? heads[i + 1].index : t.length), v = {};
      let cur = null;
      for (const l of part.split('\n')) {
        const k = /^\s*(要撑住|核图|替人定的|GEO底稿|出图提示词)[：:]\s*(.*)$/.exec(l);
        if (k) { cur = k[1]; v[cur] = k[2] ? [k[2]] : []; } else if (cur) v[cur].push(l);
      }
      for (const k of Object.keys(v)) v[k] = v[k].join('\n').trim();
      return { 类别: m[1], 名称: m[2].trim(), 状态名: (m[3] || '').trim(), v };
    });
  }
  /* 批准出片时记一笔：那一回用的是哪一版提示词（11-14 和 Codex 定的：样片是不是旧的，照提交时的版本算，不照样片下载下来的时间）。
     记在 资产/第N段_出片记录.json（工具文件，照 AGENTS.md 放 资产 根目录） */
  async function noteShot(j) {
    try {
      const pname = str(j.名).replace(/出片任务(_[0-9]+)?(_改[0-9]+)?\.txt$/, '视频提示词$1$2.txt'), pp = pj(j.项目, '提示词', segDir(j.段), pname), rec = pj(j.项目, '资产', segDir(j.段) + '_出片记录.json');
      let cur = { 说明: '流水线每回批准出片记一笔（页面只读）：时间、哪一条提示词、那时候提示词文件的修改时间。样片是不是旧的照它算。', 记录: [] };
      try { const t = JSON.parse(unbom(await fsp.readFile(rec, 'utf8'))); if (t && Array.isArray(t.记录)) cur = t; } catch (e) { /* 还没有 */ }
      cur.记录.push({ 时间: nowText(), 提示词: pname, 提示词时间: (await exists(pp)) ? Math.floor((await fsp.stat(pp)).mtimeMs) : 0, 任务书: str(j.名) });
      cur.记录 = cur.记录.slice(-200);
      await writeFile(rec, JSON.stringify(cur, null, 2) + '\n');
    } catch (e) { log('出片记录没记上：' + e.message); }
  }
  Object.assign(KINDS, {
    出图: {
      title: j => '出图 · ' + j.名 + (j.状态名 ? '（' + j.状态名 + '）' : ''), need: ['段'], key: j => j.类别 + '/' + j.文件名, codex: true,
      async prep(j) {
        await wordPrep(j);
        if (!CHANNELS.codex.ok()) throw fail('出图要用 Codex，这台电脑上调不起来');
      },
      async run(j) {   // 照人批过的字出：字不在就不出（字先定，图后出）；已经有图的，新图先存成候选
        const flow = await readFlow(j.项目);
        await needFinal(j, flow);
        const f = j.files, abs = parts => pj(j.项目, ...parts);
        if (!(await exists(abs(f.txt)))) throw fail('还没有字：先让 AI 写字，你看过、点「照这个出图」再出');
        const has = await exists(abs(f.img)), out = has ? f.cand : f.img;
        if (has) await archive(j.项目, f.cand);   // 上一张候选没用上：收进历史记录（没有就不动）
        if (j.停) throw fail('停掉了');
        j.步骤 = 'Codex 在出图';
        const mine = pj(j.项目, '提示词', '全局资产', '资产出图任务.txt'), task = (await exists(mine)) ? mine : IMG_TASK;
        let said = '';   // Codex 的回复（给我提示词时，里面带着它顺手核图的那一句）
        if (CHANNELS.mock && j.渠道 === 'mock') await mockImage(abs(out));
        else {
          said = await codexDo(j, '请照 ' + task + ' 做这一张。提示词文件：' + abs(f.txt) + '　存图路径：' + abs(out), { 核图: true, check: async () => { if (!(await exists(abs(out)))) throw retry('图还没存到 ' + abs(out) + '：存好了再告诉项目'); } });
          await writeFile(path.join(j.dir, 'Codex的回复.md'), said + '\n');
        }
        if (!(await exists(abs(out)))) throw fail('Codex 说做完了，可是图没存到 ' + out.join('/'));
        { const t = new Date(); await fsp.utimes(abs(out), t, t).catch(() => {}); }   // 文件时间记成现在：拷过来的图会带着原来的时间，页面上「可用」「不用」都靠它认是不是新出的
        const note = j.渠道 === SELF ? selfNote(said) : await checkImage(j, f.txt, out);
        await noteList(j, { 状态: '待过目', 候选: has ? out.join('/') : '', 核图: note, 核图时间: await mtimeOf(abs(out)), 说明: (j.状态名 ? j.状态名 + '；' : '') + nowText().slice(5, 16) + ' 出的', _log: logOf(j, has ? '出图（新图当候选）' : '出图', j.渠道 === SELF ? '你自己交的 AI' + (note ? '（顺手核了图）' : '') : 'Codex' + (note ? '，' + chLabel(j) + ' 核图' : '')) });
        const where = j.类别 === '关键帧' ? '提示词' : '资产';
        return { 结果: (has ? '新图出好了，先当候选：到' + where + '那一步看，点「用这张」才换上' : '图出好了，到' + where + '那一步看一眼') + (note ? '。AI 核图：' + note : ''), 产出: [out.join('/')] };
      },
    },
    改图: {
      title: j => '照批注改图 · ' + j.名 + (j.状态名 ? '（' + j.状态名 + '）' : ''), need: ['段'], key: j => j.类别 + '/' + j.文件名, codex: true,
      async prep(j) {
        await wordPrep(j);
        if (!CHANNELS.codex.ok()) throw fail('改图要用 Codex，这台电脑上调不起来');
      },
      async run(j) {   // 照人在图上写的批注改：以原图为底只改说到的地方；改出来的先当候选
        const flow = await readFlow(j.项目);
        await needFinal(j, flow);
        const f = j.files, abs = parts => pj(j.项目, ...parts), mark = [...f.shots, '标注图.jpg'];
        if (!(await exists(abs(f.img)))) throw fail('图不在了：' + f.img.join('/'));
        if (!(await exists(abs(f.imgNote)))) throw fail('还没在图上写批注：点开这张图，框出来写');
        await archive(j.项目, f.cand);
        if (j.停) throw fail('停掉了');
        j.步骤 = 'Codex 在照批注改图';
        let said = '';
        if (CHANNELS.mock && j.渠道 === 'mock') await mockImage(abs(f.cand));
        else {
          said = await codexDo(j, '请照 ' + EDIT_TASK + ' 做这一张。原图：' + abs(f.img) + '　批注：' + abs(f.imgNote)
            + ((await exists(abs(mark))) ? '　标注图：' + abs(mark) : '') + ((await exists(abs(f.txt))) ? '　出图提示词：' + abs(f.txt) : '') + '　存图路径：' + abs(f.cand),
            { 核图: await exists(abs(f.txt)), check: async () => { if (!(await exists(abs(f.cand)))) throw retry('图还没存到 ' + abs(f.cand) + '：存好了再告诉项目'); } });
          await writeFile(path.join(j.dir, 'Codex的回复.md'), said + '\n');
        }
        if (!(await exists(abs(f.cand)))) throw fail('Codex 说做完了，可是图没存到 ' + f.cand.join('/'));
        { const t = new Date(); await fsp.utimes(abs(f.cand), t, t).catch(() => {}); }
        const note = j.渠道 === SELF ? selfNote(said) : (await exists(abs(f.txt))) ? await checkImage(j, f.txt, f.cand) : '';
        await noteList(j, { 状态: '待过目', 候选: f.cand.join('/'), 核图: note, 核图时间: await mtimeOf(abs(f.cand)), _log: logOf(j, '照批注改图', j.渠道 === SELF ? '你自己交的 AI' + (note ? '（顺手核了图）' : '') : 'Codex' + (note ? '，' + chLabel(j) + ' 核图' : '')) });
        return { 结果: '照批注改好了，先当候选：到' + (j.类别 === '关键帧' ? '提示词' : '资产') + '那一步看，点「用这张」才换上' + (note ? '。AI 核图：' + note : ''), 产出: [f.cand.join('/')] };
      },
    },
    写字: {
      title: j => '写字 · ' + (j.只名 || '第' + j.段 + '场'), need: ['段'], key: j => j.段 + '/' + (j.只名 || '*'),
      async prep(j) {
        const p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {}, raw = Array.isArray(p.只) ? p.只 : [];
        j.只 = raw.slice(0, 12).map(x => ({ 类别: str(x && x.类别), 名称: str(x && x.名称).trim(), 状态名: str(x && x.状态名).trim(), 图: str(x && x.图), 文字: str(x && x.文字).trim().slice(0, 600),
          要求: str(x && x.要求).trim().slice(0, 1500), 参考: (Array.isArray(x && x.参考) ? x.参考 : []).map(g => str(g).replace(/\\/g, '/')).slice(0, 8),
          提示词: x && x.类别 === '关键帧' && RE_VP.test(str(x.提示词)) && nameOk(str(x.提示词)) ? str(x.提示词) : '' }))   // 关键帧对着哪一条视频提示词（提示词那一步点的）
          .filter(x => WORD_CATS.includes(x.类别) && nameOk(x.名称) && (!x.状态名 || nameOk(x.状态名)));
        if (raw.length && !j.只.length) throw fail('要写字的那几样，名字不对');
        j.只名 = j.只.map(x => x.名称 + (x.状态名 ? '（' + x.状态名 + '）' : '')).join('、').slice(0, 60);
      },
      async book(j) {
        const flow = await readFlow(j.项目), s = await needFinal(j, flow), items = await wordItems(j, flow, s);
        if (!items.length) throw fail('这一场没有要写字的（这一段文件夹里的图不走这一步）');
        j.items = items;
        j.images = [...items.filter(x => x.有图).map(x => pj(j.项目, ...x.图.split('/'))), ...items.flatMap(x => x.参考.map(g => pj(j.项目, ...g.split('/'))))];
        const RULE = { 人物: '人物：定妆照，画面里只有这一个人，正面全身站立，头到脚完整入画，竖幅 2:3，纯中灰色摄影棚背景；分「长相」「姿势」「穿着」「质感」几小段写；长相普通，不是明星脸，不是任何真人的肖像。',
          道具: '道具：画面里只有这一件道具，完整入画，四周留一点空，横幅 16:9，干净的中灰色背景或它平常所在的简单环境；写清结构、材质、颜色、新旧；有状态的画那个状态。',
          场景: '场景：空镜，横幅 16:9，不出现有名有姓的人物；写清是什么时候、在哪、有什么、各在哪、光从哪来。先照 scene-geo 写 GEO 底稿（只给人审：什么在哪、从哪看得见什么、人往哪走），出图提示词照底稿写，两边对得上。',
          关键帧: '关键帧：这一条视频里某一刻的画面（要求里写着是哪一刻），横幅 16:9；人物、道具、场景的样子照给的参考图，正文里用「图1」「图2」……指它们，长相衣着不再用字描一遍；写清这一刻谁在哪、在做什么、朝哪、镜头从哪拍、光从哪来；画动着的那一刻，别画成摆拍。' };
        const cats = [...new Set(items.filter(x => x.写).map(x => x.类别))];
        const tag = x => '【' + x.类别 + '｜' + x.名称 + (x.状态名 ? '｜' + x.状态名 : '') + '】';
        const line = x => '- ' + tag(x) + [x.描写 ? '描写：' + x.描写 : '', x.有图 ? '有图：' + x.图 + '（' + (x.确认 ? '人确认过可用' : '人还没确认') + '）' : '还没有图',
          x.写 ? '要写字' + (x.旧字 ? '（原来的字在最后，照要求改）' : '') : '不用写字', x.提示词 ? '是「' + x.提示词 + '」这一条视频里的一刻（这一条的提示词在下面）' : '', x.要求 ? '要求：' + x.要求 : '', x.参考.length ? '参考图：' + x.参考.map((g, i) => '图' + (i + 1) + '＝' + g).join('、') : ''].filter(Boolean).join('；');
        const olds = items.filter(x => x.写 && (x.旧字 || x.旧GEO)).map(x => '### ' + tag(x) + '\n' + (x.旧GEO ? '原来的 GEO 底稿：\n' + x.旧GEO + '\n\n' : '') + (x.旧字 ? '原来的字：\n' + x.旧字 : ''));
        const vps = [];   // 关键帧对着的那几条视频提示词：照它的分镜定这一刻
        for (const n of [...new Set(items.map(x => x.提示词).filter(Boolean))]) {
          const p = pj(j.项目, '提示词', segDir(j.段), n);
          if (await exists(p)) vps.push('### ' + n + '\n' + unbom(await fsp.readFile(p, 'utf8')).trim().slice(0, 8000));
        }
        return ['# 任务：写字（资产图的出图提示词），核一遍已经有的图', '', '今天 ' + today() + '。这是一个 AI 短视频项目，流程是「字先定，图后出」：这一场的剧本定稿了，你先给要用的东西写字，人看过、批过，再照字出图。',
          '', '## 每一样要做的',
          '1. 要撑住：这一场的戏要它做到什么（谁要看得见谁、人往哪走、东西怎么用、在哪儿、什么时候），一两句，只写剧本里有的。「别的场」里剧本定稿了的也用它，一起照顾到；没定稿的不管。',
          '2. 有图的：图已经让你看过了，核它撑不撑得住：写「核图：撑得住」，或者「核图：撑不住：缺什么、哪里不对」，一句话。人确认过的图，没有大问题就算撑得住。',
          '3. 标了「要写字」的：写出图提示词，画面照下面「出图规矩」。原来有字的，照「要求」改，没说到的地方别动。剧本没写到的样子、布局，你出主意（场景在底稿里标【待拍板】），在「替人定的」里一处一行列出来，人会一条一条看。',
          '4. 只写画面里有的东西，不写「没有什么」。真人写实的电影剧照质感，不要 AI 明信片感；先想清楚合不合理：东西摆在哪、光从哪来。年代、地方、颜色基调和全片对得上。',
          ...(cats.length ? ['', '## 出图规矩', ...cats.map(c => RULE[c])] : []),
          '', '## 回复的格式（一样一节，标记照抄，名字一个字不改）', '【人物｜童爸爸】', '要撑住：……', '核图：撑得住', '替人定的：', '……（剧本没写、你替人定的样子，一处一行，几个字说清；都照剧本写的就不写这一项）', '出图提示词：', '……（正文，可以几段）', '【场景｜面摊】', '要撑住：……', 'GEO底稿：', '……', '出图提示词：', '……',
          '没有图的不写「核图」；不用写字的不写「替人定的」「GEO底稿」「出图提示词」；道具有状态的，标记写成【道具｜名字｜状态】。不要开场白和总结。',
          '', '## 要写的这几样', ...items.map(line),
          '', '## 全片的设定', settingText(flow), await lookPart(j.项目, flow, null, '图', '全片的光影总基调'),
          '', '## 这一场：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'), sceneText(flow, s),
          '', '## 这一场定稿的剧本', await docText(scriptPath(j.项目, j.段)),
          '', '## 别的场', otherScenes(flow, s, items),
          ...(vps.length ? ['', '## 关键帧对着的视频提示词（照它的分镜定是哪一刻、画面里有什么）', ...vps] : []),
          ...(olds.length ? ['', '## 原来的字（要改的那几样）', ...olds] : []),
          ...(items.some(x => x.写 && x.类别 === '场景') ? ['', '## scene-geo 技能（场景照它写 GEO 底稿）', await skill('scene-geo')] : []), TAIL].join('\n');
      },
      async apply(j, text) {
        const secs = wordSecs(text), stamp = stampOf(), 产出 = [], done = [], miss = [], bad = [];
        if (!secs.length) throw fail('AI 没按要的格式回（要【人物｜名字】这样一样一节）');
        for (const x of j.items) {
          const sec = secs.find(g => g.类别 === x.类别 && g.名称 === x.名称 && g.状态名 === (x.状态名 || '')) || secs.find(g => g.类别 === x.类别 && g.名称 === x.名称);
          if (!sec) { miss.push(x.名称); continue; }
          const v = sec.v, 撑 = oneLine(v.要撑住), 核 = x.有图 ? oneLine(v.核图) : '';
          if (x.有图 && /撑不住/.test(核)) bad.push(x.名称);
          if (x.写) {
            const word = str(v.出图提示词).trim();
            if (word.length < 40) miss.push(x.名称 + '（字太短）');
            else {
              const head = [...x.参考.map((g, i) => '图' + (i + 1) + '：' + pj(j.项目, ...g.split('/')) + '（' + stemOf(g) + '）'),
                '用途：' + (x.类别 === '关键帧' ? '第' + j.段 + '场' + (x.提示词 ? '「' + x.提示词 + '」' : '') + '的关键帧' :x.类别 + '「' + x.名称 + '」' + (x.状态名 ? '（' + x.状态名 + '）' : '') + '的定妆图，各场照它的样子'), ...(撑 ? ['要撑住：' + 撑] : []), '提示词'];
              await archive(j.项目, x.f.txt, stamp);
              await writeFile(pj(j.项目, ...x.f.txt), head.join('\n') + '\n' + word + '\n');
              产出.push(x.f.txt.join('/'));
              const geo = str(v.GEO底稿).trim();
              if (x.f.geo && geo.length > 40) { await archive(j.项目, x.f.geo, stamp); await writeFile(pj(j.项目, ...x.f.geo), geo + '\n'); 产出.push(x.f.geo.join('/')); }
              done.push(x.名称 + (x.状态名 ? '（' + x.状态名 + '）' : ''));
            }
          }
          await updateList(j.项目, j.段, { 类别: x.类别, 名称: x.名称, ...(x.状态名 ? { 状态名: x.状态名 } : {}), 文件: x.图, ...(x.写 || x.有字 ? { 字: x.f.txt.join('/') } : {}), ...(x.提示词 ? { 提示词: x.提示词 } : {}),
            状态: x.有图 ? (x.确认 ? '有了' : '待过目') : '字等你批', 要撑住: 撑, 核图: 核, ...(x.有图 ? { 核图时间: await mtimeOf(pj(j.项目, ...x.图.split('/'))) } : {}),
            ...(x.写 ? { 替人定的: str(v.替人定的).split('\n').map(l => l.replace(/^[-·•\d.、\s]+/, '').trim()).filter(Boolean).slice(0, 12) } : {}), _log: logOf(j, x.写 ? (x.旧字 ? '照要求改字' : '写字') : '核图') });
        }
        if (!done.length && j.items.every(x => x.写)) throw fail('一样都没写成：' + miss.join('、'));
        return { 结果: (done.length ? '字写好了：' + done.join('、') + '，到' + (j.items.every(x => x.类别 === '关键帧') ? '提示词' : '资产') + '那一步批' : '核过了') + (bad.length ? '；AI 说撑不住：' + bad.join('、') : '') + (miss.length ? '；没写成：' + miss.join('、') : ''),
          产出: [...产出, '资产/' + segDir(j.段) + '_资产清单.json'] };
      },
    },
    按批注改字: {
      title: j => '按批注改字 · ' + j.名, need: ['段'], key: j => j.字.join('/'), file: j => j.字.join('/'),
      async prep(j) {
        const p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {}, parts = str(p.字).replace(/\\/g, '/').split('/').filter(Boolean);
        const okDir = (parts.length === 4 && parts[0] === '提示词' && parts[1] === '全局资产' && ['人物', '道具', '场景'].includes(parts[2])) || (parts.length === 3 && parts[0] === '提示词' && parts[1] === segDir(j.段));
        if (!okDir || !parts.every(nameOk) || !/_提示词\.txt$/.test(parts[parts.length - 1])) throw fail('这份字不在资产提示词该在的地方');
        j.字 = parts; j.名 = parts[parts.length - 1].replace(/_提示词\.txt$/, '');
        j.注 = [...parts.slice(0, -1), j.名 + '_提示词_批注.md'];
        j.geo = parts.length === 4 && parts[2] === '场景' ? [...parts.slice(0, -1), j.名 + '_GEO底稿.md'] : null;
        if (!(await exists(pj(j.项目, ...j.字)))) throw fail('字不在了');
        if (!(await exists(pj(j.项目, ...j.注)))) throw fail('还没写批注');
      },
      async book(j) {
        const read = async parts => unbom(await fsp.readFile(pj(j.项目, ...parts), 'utf8')).trim();
        const word = await read(j.字), note = await read(j.注), geo = j.geo && (await exists(pj(j.项目, ...j.geo))) ? await read(j.geo) : '';
        j.旧字 = word; j.旧GEO = geo;
        return ['# 任务：按批注改一张图的字（出图提示词）', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是一张图的字' + (geo ? '和它的 GEO 底稿' : '') + '，和人写的批注。请照批注改。',
          '', '## 要求', '1. 只改批注说到的地方，别的一个字都不动（开头「图1：」「用途：」「要撑住：」「提示词」这几行也照抄，批注说到的除外）。', '2. 批注把原文抄下来改过的，照抄批注，不要再润色。', '3. 批注是提要求的，照要求改这一处，改动尽量小。',
          ...(geo ? ['4. 这是场景：批注说到空间、布局的，GEO 底稿和字一起改，两边对得上。'] : []),
          '5. 回复照这个样子：', '【字】', '（改好的整份字，从第一行起）', ...(geo ? ['【GEO底稿】', '（改好的整份底稿；没改就原样抄）'] : []),
          '', '## 原来的字', word, ...(geo ? ['', '## 原来的 GEO 底稿', geo] : []), '', '## 批注', note, TAIL].join('\n');
      },
      async apply(j, text) {
        const t = text.replace(/\r\n/g, '\n'), a = t.indexOf('【字】'), g = t.indexOf('【GEO底稿】');
        if (a < 0) throw fail('AI 没按要的格式回（要【字】那一块）');
        const word = body(t.slice(a + 3, g > a ? g : undefined)), geo = g > a ? body(t.slice(g + 7)) : '';
        if (word.length < 40) throw fail('AI 改出来的字太短了');
        const stamp = stampOf(), 产出 = [];
        if (word !== j.旧字) { await archive(j.项目, j.字, stamp); await writeFile(pj(j.项目, ...j.字), word + '\n'); 产出.push(j.字.join('/')); }
        if (j.geo && j.旧GEO && geo.length > 40 && geo !== j.旧GEO) { await archive(j.项目, j.geo, stamp); await writeFile(pj(j.项目, ...j.geo), geo + '\n'); 产出.push(j.geo.join('/')); }
        await archive(j.项目, j.注, stamp);
        const need = /^要撑住[：:]\s*(.+)$/m.exec(word.split(/^提示词$/m)[0] || '');
        await logWord(j, j.字.join('/'), '按批注改字', need ? { 要撑住: oneLine(need[1]) } : null);
        return { 结果: 产出.length ? '字照批注改好了，回资产那一步看' : 'AI 看了批注，说不用改（批注收进历史记录了）', 产出 };
      },
    },
    核GEO: {
      title: j => '照图核 GEO · ' + j.名, need: ['段'], key: j => j.名,
      async prep(j) {
        const p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {};
        j.类别 = '场景';
        const img = imgParts('场景', j.段, p.图);
        if (!img) throw fail('没说核哪一张场景图');
        j.名 = stemOf(img[img.length - 1]); j.files = wordFiles('场景', j.名, j.段, img);
        if (!(await exists(pj(j.项目, ...j.files.geo)))) throw fail('这张场景图还没有 GEO 底稿');
      },
      async book(j) {
        const flow = await readFlow(j.项目), img = j.files.img.join('/');
        j.images = [pj(j.项目, ...j.files.img)];
        j.旧GEO = unbom(await fsp.readFile(pj(j.项目, ...j.files.geo), 'utf8')).trim();
        const users = (Array.isArray(flow.场) ? flow.场 : []).filter(x => x && (x.场景图 || []).some(g => String(g).replace(/\\/g, '/') === img));
        let script = '';
        try { script = await docText(scriptPath(j.项目, j.段)); } catch (e) { /* 读不了就不带 */ }
        return ['# 任务：场景图确认了，照图把 GEO 底稿再核一遍', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这张场景图人已经确认可用了（图已经让你看过）。GEO 底稿是出图前写的方案，现在照图核：图上有什么、各在哪、从哪往哪看，都以图为准。写提示词时，场景那一段照这份底稿翻。',
          '', '## 要求（先判断要不要改，要改才改）',
          '1. 先判断：拿底稿一条一条对图，只看空间：墙、门、窗、床、桌、灯这些固定的东西在哪、朝哪、有没有。颜色、新旧、质感、桌上摆的小东西不算；看不清、说不准的也不算对不上。',
          '2. 都对得上：【不一样的地方】只写「对得上」，【GEO底稿】只写「不用改」，什么都不动。',
          '3. 有对不上的才改：照 scene-geo 的办法，只改对不上的那几行，改成图上的样子，别的一个字不动（记号、标签照抄）；图上没画出来、底稿里有的，标【待拍板】，别删。',
          '4. 看下面用到这张图的戏，判断这些对不上的地方会不会影响走位、谁看得见谁、剧情。会影响的写「要：……」，不影响写「不用」。',
          '5. 回复只有三块，按这个顺序：', '【不一样的地方】', '（一处一行，大白话；都对得上就只写「对得上」）', '【要不要拿回去批图】', '（「不用」，或者「要：……」）', '【GEO底稿】', '（有对不上的：改好的整份底稿；都对得上：只写「不用改」）',
          '', '## 原来的 GEO 底稿', j.旧GEO, '', '## 用到这张图的场', users.map(x => '第' + x.段 + '场：' + (oneLine(x.表达) || '（没写表达）')).join('\n') || '（只有这一场）',
          ...(script ? ['', '## 第' + j.段 + '场定稿的剧本', script] : []), '', '## scene-geo 技能', await skill('scene-geo'), TAIL].join('\n');
      },
      async apply(j, text) {   // 11-14 他要的：先判断要不要改，要改才改。AI 说对得上，底稿一个字不动（以前它回的底稿只要和原来不一样就盖上去）
        const t = text.replace(/\r\n/g, '\n'), tags = ['【不一样的地方】', '【要不要拿回去批图】', '【GEO底稿】'], pos = tags.map(x => t.indexOf(x));
        if (pos.some(i => i < 0)) throw fail('AI 没按要的格式回（要【不一样的地方】【要不要拿回去批图】【GEO底稿】三块）');
        const part = k => { const ends = pos.filter(x => x > pos[k]); return body(t.slice(pos[k] + tags[k].length, ends.length ? Math.min(...ends) : undefined)); };
        const diff = part(0).split('\n').map(x => x.replace(/^[-·•\d.、\s]+/, '').trim()).filter(Boolean), back = oneLine(part(1)), geo = part(2);
        const 产出 = [], same = !diff.length || (diff.length === 1 && /对得上/.test(diff[0])), need = !same && /^要/.test(back);
        const fixed = !same && geo.length > 40 && !/^不用改/.test(geo) && geo !== j.旧GEO;
        if (fixed) { await archive(j.项目, j.files.geo); await writeFile(pj(j.项目, ...j.files.geo), geo + '\n'); 产出.push(j.files.geo.join('/')); }
        const n = diff.length, 事 = same ? '照图核 GEO：对得上，没改' : fixed ? '照图核 GEO：' + n + ' 处对不上，改了' : '照图核 GEO：' + n + ' 处对不上，底稿没改';
        await updateList(j.项目, j.段, { 类别: '场景', 名称: j.名, 文件: j.files.img.join('/'), 核GEO: same ? '对得上' : diff.join('；').slice(0, 600) + (fixed ? '' : '（AI 没给改好的底稿，底稿没改）'), 拿回去批图: need ? back.replace(/^要[：:]?/, '').trim() || '要' : '', 核GEO时间: nowText(), _log: logOf(j, 事) });
        return { 结果: same ? '照图核过 GEO：对得上，底稿没动' : fixed ? '照图核过 GEO：' + n + ' 处对不上，底稿照图改了（改之前的那一版收进历史记录）' + (need ? '。有影响走位、视线的，先去批图' : '') : '照图核过 GEO：' + n + ' 处对不上，可 AI 没给改好的底稿，底稿没动', 产出 };
      },
    },
    影响清单: {
      title: j => '改了剧本，看影响到哪些 · 第' + j.段 + '场', need: ['段'],
      async book(j) {
        const flow = await readFlow(j.项目), s = await needFinal(j, flow), p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {}, since = timeOf(p.上回);
        const hdir = pj(j.项目, '历史记录', '定稿的剧本', segDir(j.段)), re = new RegExp('^' + segDir(j.段) + '_剧本__(\\d{4})(\\d{2})(\\d{2})-(\\d{2})(\\d{2})(\\d{2})(_\\d+)?\\.docx$');
        const olds = (await fsp.readdir(hdir).catch(() => [])).map(n => { const m = re.exec(n); return m ? { n, t: Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6]) } : null; }).filter(Boolean).sort((a, b) => a.t - b.t);
        const pick = (since ? olds.find(x => x.t + 999 >= since) : null) || olds[olds.length - 1];   // 上回定稿以后头一回改的时候存下来的那一份，就是上回定稿的样子
        if (!pick) throw fail('历史记录里找不到改之前的剧本，没法比');
        j.依据 = pick.n;
        const before = await docText(path.join(hdir, pick.n)), after = await docText(scriptPath(j.项目, j.段));
        const rec = await fsp.readFile(pj(j.项目, '资产', segDir(j.段) + '_资产清单.json'), 'utf8').then(t => JSON.parse(unbom(t)), () => ({}));
        const need = new Map((Array.isArray(rec.资产) ? rec.资产 : []).filter(x => x && x.要撑住).map(x => [str(x.类别) + '/' + str(x.名称), str(x.要撑住)]));
        const items = [...['人物', '道具'].flatMap(k => (s[k] || []).map(n => k + '「' + n + '」' + (need.get(k + '/' + n) ? '：要撑住 ' + need.get(k + '/' + n) : ''))),
          ...(s.场景图 || []).map(g => '场景「' + stemOf(g) + '」' + (need.get('场景/' + stemOf(g)) ? '：要撑住 ' + need.get('场景/' + stemOf(g)) : '')), ...(s.场景文字 || []).map(t => '场景（只用文字写的）「' + oneLine(t).slice(0, 60) + '」')];
        const pdir = pj(j.项目, '提示词', segDir(j.段)), names = vpLatest(await fsp.readdir(pdir).catch(() => [])).sort();   // 改过几版的只看最新那一版
        j.提示词 = names;
        const texts = [];
        for (const n of names) texts.push('### ' + n + '\n' + unbom(await fsp.readFile(path.join(pdir, n), 'utf8')).trim().slice(0, 3000));
        return ['# 任务：剧本改了，看影响到哪些', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这一场的剧本改过、又定稿了。下面是改之前和改之后的剧本，还有这一场的资产和已经写好的视频提示词。请列出哪些要再看、为什么；没受影响的不列。',
          '', '## 要求', '1. 资产：哪样要改（写清哪里对不上新剧本）、要加（新剧本多出来的人物、道具、场景）、不用了（新剧本里没有了）。', '2. 提示词：哪几条写的戏和新剧本对不上，说清是哪几镜、为什么。', '3. 拿不准的也列上，为什么里写「拿不准」。只看改了的地方，别把没改的戏也列进来。',
          '4. 回复一段 JSON，像这样：', '{"总": "一两句话说这次改了什么", "资产": [{"类别": "人物", "名称": "童爸爸", "影响": "要改", "为什么": "……"}], "提示词": [{"文件": "视频提示词.txt", "为什么": "……"}]}', '「影响」只写 要改、要加、不用了 三种之一；提示词「文件」照下面的名字抄。',
          '', '## 改之前的剧本（' + pick.n + '）', before, '', '## 改之后的剧本', after, '', '## 这一场的资产', items.join('\n') || '（没选）', '', '## 这一场的提示词', texts.join('\n\n') || '（还没写）', TAIL].join('\n');
      },
      async apply(j, text) {
        const got = jsonIn(text);
        const 资产 = (Array.isArray(got.资产) ? got.资产 : []).map(x => ({ 类别: str(x && x.类别).trim(), 名称: str(x && x.名称).trim(), 影响: str(x && x.影响).trim(), 为什么: oneLine(x && x.为什么) })).filter(x => x.名称 && ['要改', '要加', '不用了'].includes(x.影响));
        const 提示词 = (Array.isArray(got.提示词) ? got.提示词 : []).map(x => ({ 文件: str(x && x.文件).trim(), 为什么: oneLine(x && x.为什么) })).filter(x => j.提示词.includes(x.文件));
        const rel = ['定稿的剧本', segDir(j.段), segDir(j.段) + '_影响清单.json'];
        await writeFile(pj(j.项目, ...rel), JSON.stringify({ 说明: '剧本重新定稿以后 AI 列的影响清单（页面只读）：资产、提示词里哪些要再看、为什么；没列上的照旧。', 时间: nowText(), 上回: str((j.参数 || {}).上回), 依据: '历史记录/定稿的剧本/' + segDir(j.段) + '/' + j.依据, 渠道: j.渠道, 总: oneLine(got.总), 资产, 提示词 }, null, 2) + '\n');   // 上回：上回定稿的时间（没列上的提示词，页面照它算没受影响）
        return { 结果: '影响清单列好了：资产 ' + 资产.length + ' 样、提示词 ' + 提示词.length + ' 条要再看', 产出: [rel.join('/')] };
      },
    },

    /* ---------- 工序四：提示词 ---------- */
    写提示词: {
      title: j => '写提示词 · 第' + j.段 + '场 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      async prep(j) {
        if (!nameOk(str(j.名)) || !RE_VP.test(j.名) || vpVer(j.名)) throw fail('提示词的文件名要是「视频提示词.txt」「视频提示词_02.txt」这样的');
        if (await exists(vpPath(j))) throw fail('这份提示词已经存在，请打开接着写；AI 初稿不会覆盖它');
        if (j.白模) {   // 这一条要挂的白模：只认这一段文件夹（含下一层）里的视频
          const f = str(j.白模).replace(/\\/g, '/'), q = f.split('/');
          if (q[0] !== '资产' || q[1] !== segDir(j.段) || q.length > 4 || !VIDEO_RE.test(f) || q.some(x => !nameOk(x)) || !(await exists(pj(j.项目, ...q)))) throw fail('白模要是 资产/' + segDir(j.段) + ' 里的视频');
          j.白模 = f;
        }
        if (j.关键帧 != null) {   // 这一条要挂的关键帧：只认这一段文件夹（含下一层）里的图，照页面排好的先后
          if (!Array.isArray(j.关键帧) || j.关键帧.length > 30) throw fail('关键帧的清单不对');
          const out = [];
          for (const x of j.关键帧) {
            const f = str(x).replace(/\\/g, '/'), q = f.split('/');
            if (q[0] !== '资产' || q[1] !== segDir(j.段) || q.length > 4 || !/\.(png|jpe?g|webp)$/i.test(f) || q.some(y => !nameOk(y)) || !(await exists(pj(j.项目, ...q)))) throw fail('关键帧要是 资产/' + segDir(j.段) + ' 里的图');
            if (!out.includes(f)) out.push(f);
          }
          j.关键帧 = out;
        }
      },
      async book(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
        if (!s) throw fail('流水线里没有第' + j.段 + '场');
        if (!(await exists(sp))) throw fail('要先有定稿的剧本，才能写提示词');
        const ps = parasOf(s), pa = Array.isArray(j.段落) && j.段落.length === 2 ? j.段落 : null;
        if (pa && !(pa[0] >= 1 && pa[1] >= pa[0] && pa[1] <= ps.length)) throw fail('段落的范围不对');
        const assets = [];
        for (const k of ['人物', '道具']) for (const n of s[k] || []) { const e = (flow[k] || []).find(x => x && x.名 === n); for (const f of (e && (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : [])) || []) assets.push(k + '「' + n + '」：' + f); }
        for (const x of segRefs(s)) assets.push(x.k + '参考「' + x.n + '」（这一段的图）：' + x.f);
        for (const f of s.场景图 || []) assets.push('场景图：' + f);
        if (j.白模) assets.push('白模视频（这一条要挂，写成 @视频1）：' + j.白模);
        const frames = Array.isArray(j.关键帧) ? j.关键帧 : [];
        frames.forEach((f, i) => assets.push('关键帧（这一条要挂，第 ' + (i + 1) + ' 张）：' + f));
        j.assets = assets.map(x => x.split('：').pop());
        const bmk = !!j.白模 && frames.length > 0 && !!BmKey;   // 既挂白模又挂关键帧：照官方「白模＋关键帧」的写法（11-14）
        const look = await lookPart(j.项目, flow, s, '写', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'), lessons = await lessonsOf(j.项目), gp = await geoPart(j, s.场景图, s), bm = await bmPart(j, j.白模 ? [{ ref: '@视频1', path: j.白模 }] : [], frames.map(() => null));
        const fp = framePart(frames, bmk ? '图已经让你看过：事件脚本里参考它的那一镜，戏要和它对得上。' : '每张定义了什么照图写（图已经让你看过）：这一刻的构图、人物位置、姿态、镜头方向；事件脚本里对应那一镜的开场要和它对得上。', bmk);
        j.images = [...gp.images, ...frameImgs(j, frames)];
        /* 一场写几条由人定（2026-11-13 起页面不再选段落范围）：人写了这一条写哪段戏就照它；没写，第一条从这一场开头写，后面的接着前面几条往下写。老请求带着段落范围的照旧 */
        const others = [];
        try {
          for (const f of vpLatest(await fsp.readdir(pj(j.项目, '提示词', segDir(j.段))))) {
            if (f === j.名) continue;
            others.push({ f, no: vpNo(f), text: unbom(await fsp.readFile(pj(j.项目, '提示词', segDir(j.段), f), 'utf8')).trim() });
          }
        } catch (e) { /* 还没有别的条 */ }
        others.sort((a, b) => (a.no || 1e9) - (b.no || 1e9) || a.f.localeCompare(b.f, 'zh', { numeric: true }));
        const me = vpNo(str(j.名)), what = str(j.写什么).trim();
        const where = pa ? '这一条只写段落 ' + pa[0] + (pa[1] > pa[0] ? ' 到段落 ' + pa[1] : '') + ' 的戏，别的段落留给别的条，不要写进来。'
          : what ? '这一条写这段戏：' + what + '。别的戏留给别的条，不要写进来。'
            : others.length ? '这一条接着前面几条往下写：前面已经写过的戏不要重写，从它们停下的地方接着写。'
              : '这一条从这一场开头写起。';
        const range = '这一场的戏分几条写由人定，这一份是' + (me ? '第 ' + me + ' 条' : '其中一条') + (others.length ? '，这一场另外还有 ' + others.length + ' 条（附在后面，接头处要接得上）' : '') + '。' + where + '一条视频一般 15 秒、最长 30 秒，装不下的戏留给下一条。' + (j.白模 ? '这一条挂白模视频 @视频1，镜头的切分、机位、运镜照白模。' : '') + (frames.length ? '这一条挂 ' + frames.length + ' 张关键帧（见下面「这一条挂的关键帧」），对应镜头的开场照关键帧。' : '');
        const otherText = others.length ? ['', '## 这一场的其他几条提示词（只看，别改；接头处的人物位置、动作、光线要接得上）', ...others.map(o => '### ' + o.f + (o.no ? '（第 ' + o.no + ' 条）' : '') + '\n' + (o.text || '（还是空的）'))].join('\n') : '';
        return ['# 任务：给一场戏写 Seedance 视频提示词', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面有定稿的剧本、人写的剧本段落、全片设定、这一场能用的资产图。请照 sd25-pe 的格式写视频提示词。' + range,
          '', '## 要求', '1. 格式照下面「提示词格式」：这一条挂的素材五份以内用写法一，多于五份用写法二。镜头由剧情需要来设计，不按剧本段落机械地一段一镜，写在【事件脚本】里，一镜一行，一镜只讲一两件事；戏照「写戏规矩」写。', '2. 素材职责里用 @图片1、@图片2……引用资产图，只能用下面「能用的资产图」里的，镜头里看得见的人物、道具、场景都要挂。',
          bmk ? '3. 不写时长秒数（时长在生成参数里设；这一条挂了白模又挂了关键帧，每一镜开头照下面「白模＋关键帧的写法」写它在白模里的整秒），不写画面里没有的东西。' : '3. 不写时长秒数（时长在生成参数里设），不写画面里没有的东西。', '4. ' + gp.rule, '5. 回复' + (gp.make ? '三块（最前面是【GEO底稿】）' : '两块') + '，照这个样子：', ...(gp.make ? ['【GEO底稿】', '（照 scene-geo 第五节模板写的底稿）'] : []), '【提示词】', '（整份提示词，从「【生成目标】」开始）', '【素材登记】', '[{"ref": "@图片1", "name": "叫法", "path": "资产/……png"}]',
          ...(j.白模 ? ['6. 白模视频 @视频1 要挂：素材职责里照下面「这一条挂的白模视频」那一段写，【素材登记】里也登记它（{"ref": "@视频1", "name": "白模", "path": "' + j.白模 + '"}）。'] : []),
          ...(frames.length ? [(j.白模 ? '7' : '6') + '. 关键帧要挂：照下面「这一条挂的关键帧」那一段写，【素材登记】里也登记它们（name 写「关键帧」）。'] : []),
          '', '## 能用的资产图', assets.join('\n') || '（没有）', bm, fp, '', '## 全片的设定', settingText(flow), look, gp.text,
          '', '## 这一场：第' + j.段 + '段｜' + str(s.名).trim(), sceneText(flow, s),
          '', '## 定稿的剧本', await docText(sp), otherText, lessons ? '\n## 这个项目的历史教训（写的时候记着）' + lessons : '', '', PE_FORMAT, '', PE_DRAMA, '', '## 技能：sd25-pe', await skill('sd25-pe'), '', '## 技能：scene-geo', await skill('scene-geo'), TAIL].join('\n');
      },
      async apply(j, text) {
        const t = text.replace(/\r\n/g, '\n'), a = t.indexOf('【提示词】'), z = t.indexOf('【素材登记】');
        if (a < 0) throw fail('AI 没按要的格式回（没有【提示词】）');
        const prompt = body(t.slice(a + 5, z > a ? z : undefined), /^本段事件|^【生成目标】/);
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
        let bmNote = '';
        if (j.白模 && !list.some(r => r.path === j.白模)) {   // AI 没登记白模：照提示词里写的视频编号替它登记；一句都没写，也登记上（生成任务书时会拦下，提醒补那几句）
          const m = /@视频(\d+)/.exec(prompt), ref = m ? '@视频' + m[1] : '@视频1';
          if (!list.some(r => r.ref === ref)) list.push({ ref, name: path.basename(j.白模).replace(/\.[^.]+$/, ''), path: j.白模, sha256: sha256(await fsp.readFile(pj(j.项目, ...j.白模.split('/')))) });
          if (!m) bmNote = '；注意：AI 没写白模那几句（@视频1），生成任务书前要补上';
        }
        const mp = pj(j.项目, '资产', '参考素材映射.json');
        let map = { schema_version: 1, prompts: {} };
        try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { /* 还没有 */ }
        map.prompts = map.prompts && typeof map.prompts === 'object' ? map.prompts : {};
        map.prompts[rel.join('/')] = { prompt_sha256: sha256(buf), references: list };
        await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
        const nv = list.filter(r => /^@视频/.test(r.ref)).length, lostF = (Array.isArray(j.关键帧) ? j.关键帧 : []).filter(f => !list.some(r => r.path === f));
        const fNote = lostF.length ? '；注意：关键帧 ' + lostF.map(f => path.basename(f).replace(/\.[^.]+$/, '')).join('、') + ' AI 没登记，打开看一眼，生成任务书前要补上' : '';
        const kNote = j.白模 && (j.关键帧 || []).length && BmKey && !BmKey.isBmk(prompt) ? '；注意：AI 没照「白模＋关键帧」的写法写，生成任务书前要换（进去改，或者写批注让 AI 改）' : '';
        return { 结果: '提示词写好了，挂了 ' + (list.length - nv) + ' 张图' + (nv ? '、' + nv + ' 段白模' : '') + bmNote + fNote + kNote + (geoAt ? '；AI 看图新建了一份 GEO 底稿，等你审' : ''), 产出: [rel.join('/'), ...(geoAt ? [geoAt] : [])] };
      },
    },
    /* 生成出片任务书：不用 AI，照固定的样子把这一条要用的东西排好（提示词、挂哪几张图、画布、参数、存到哪） */
    出片任务书: {
      title: j => '生成出片任务书 · 第' + j.段 + '场 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, local: true,
      async run(j) {
        const rel = ['提示词', segDir(j.段), str(j.名)], p = pj(j.项目, ...rel);
        if (!nameOk(str(j.名)) || !RE_VP.test(j.名) || !(await exists(p))) throw fail('没有这份提示词');
        const buf = await fsp.readFile(p), text = unbom(buf.toString('utf8')), label = vpTok(j.名);   // 样片名、节点名里写的：提示词01、提示词02……；老稿是 段落a-b、镜头a-b
        let set = {}, map = {};
        try { set = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '出片设置.json'), 'utf8'))); } catch (e) { /* 没有就空着 */ }
        const prof = str(set.登录位).trim();   // 用哪个即梦账号：和画布一起记在出片设置里，空着是默认号（11-14 起页面不再另选，免得和画布对不上）
        try { map = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '参考素材映射.json'), 'utf8'))); } catch (e) { /* 没有就空着 */ }
        let refs = (((map.prompts || {})[rel.join('/')] || {}).references || []).slice();
        try {   // 你来写的稿：在写稿页里新 @ 的图、挂上的白模记在旁边的过程文件里（挂图），也算进来
          const side = JSON.parse(unbom(await fsp.readFile(p.replace(/\.txt$/, '_写稿.json'), 'utf8')));
          for (const [ref, file] of Object.entries(side.挂图 || {})) {
            const fp = String(file).replace(/\\/g, '/'), old = refs.find(r => r.ref === ref);
            if (old) {   // 同一个编号两处都记了：对的是同一个文件就行，不是就拦下（不知道该信哪一处）
              if (str(old.path).replace(/\\/g, '/') !== fp) throw fail(ref + ' 在参考素材映射里是 ' + old.path + '，在写稿记录的挂图里是 ' + fp + '：两处对的不是同一个文件。打开稿子核对一下再生成');
              continue;
            }
            if (!(await exists(pj(j.项目, ...fp.split('/'))))) continue;
            const stem = path.basename(fp).replace(/\.[^.]+$/, '');
            refs.push({ ref, name: VIDEO_RE.test(fp) ? stem : stem.split('_')[0], path: fp, sha256: sha256(await fsp.readFile(pj(j.项目, ...fp.split('/')))) });
          }
        } catch (e) { if (e.plain) throw e; /* 没有过程文件 */ }
        const holes = text.split(/\r?\n/).filter(l => /〔[^〔〕]*〕/.test(l));   // 模板句里留给人填的空
        if (holes.length) throw fail('提示词里还有 ' + holes.length + ' 句留着〔〕没填（「' + holes[0].trim().slice(0, 50) + '」）：填好再生成任务书');
        const bmV = vidsOf(refs), bmF = bmV.length && BmKey ? framesOf(j, refs, sceneOf((await readFlow(j.项目).catch(() => null)) || {}, j.段)) : [];
        if (bmV.length && bmF.length && BmKey) {   // 既挂白模又挂关键帧：要照官方「白模＋关键帧」的写法，每一镜开头的整秒和白模对得上（2026-11-14 他定）
          if (!BmKey.isBmk(text)) throw fail('这一条挂了白模又挂了关键帧，要照官方「白模＋关键帧」的写法写：素材里写白模、关键帧、收尾三句，每一镜开头写它在白模里的整秒和参考哪张。你来写的稿在流水线这一条点「换写法…」；AI 写的稿点「进去改」换，或者写批注让 AI 改');
          const n0 = await bmNote(j, bmV[0]), bad = BmKey.check(BmKey.shots(text), await vidSecs(n0.abs), n0.cuts);
          if (bad.length) throw fail('白模＋关键帧的秒数不对：' + bad.slice(0, 3).map(x => x.msg).join('；') + (bad.length > 3 ? '……一共 ' + bad.length + ' 处' : '') + '。改好再生成任务书');
        }
        const used = [...new Set(text.match(/@(?:图片|视频|音频)\d+/g) || [])];
        const lost = used.filter(u => !refs.some(r => r.ref === u));
        if (lost.length) throw fail('提示词里写了 ' + lost.join('、') + '，可是没登记它是哪个文件（资产/参考素材映射.json）。先让 AI 批一批或者重新铺底，把素材对上');
        const idle = refs.filter(r => /^@视频\d+$/.test(r.ref) && !used.includes(r.ref));
        if (idle.length) throw fail('挂了白模 ' + idle.map(r => path.basename(str(r.path))).join('、') + '（' + idle.map(r => r.ref).join('、') + '），可是提示词里没写它的编号：在素材里补上白模那几句，或者去掉白模，再生成任务书');
        refs = refs.filter(r => used.includes(r.ref)).sort((a, b) => a.ref.localeCompare(b.ref, 'zh', { numeric: true }));
        for (const t of ['图片', '视频', '音频']) {   // 即梦照挂的先后编号：@图片1、@图片2……要从 1 连着，缺一个号，后面的就全对错了（11-13 夜加）
          const nos = refs.filter(r => r.ref.startsWith('@' + t)).map(r => +r.ref.slice(t.length + 1)).sort((a, b) => a - b);
          if (nos.some((n, i) => n !== i + 1)) throw fail('提示词里的 @' + t + ' 没从 1 连着编（现在是 ' + nos.map(n => '@' + t + n).join('、') + '）：即梦照挂的先后编号，缺一个号，后面的就全对错了。你来写的稿：刷新流水线页面，再点「生成任务书」，页面先往前挪号（正文、挂图、参考素材映射一起挪）；AI 写的稿：写批注让 AI 改');
        }
        for (const r of refs) if (!(await exists(pj(j.项目, ...r.path.split('/'))))) throw fail(r.ref + ' 对的那个文件不在了：' + r.path);
        for (const r of refs) {   // SHA-256 照现在的文件算（登记以后可能换过：文生资产里候选图「用这张」换上的、白模重渲的）；换过的把历史记录里各版旧的列出来（时间＋SHA-256），画布上的旧节点照 AGENTS.md 加那一版的 __时间
          const q = r.path.split('/'), now = sha256(await fsp.readFile(pj(j.项目, ...q))), name = q[q.length - 1], dot = name.lastIndexOf('.');
          if (dot > 0) {   // 11-15 起图片、白模视频都查：以前只查图片，重渲的白模任务书里没写改名，Codex 在画布上碰到同名的旧白模就停下来问
            const re = new RegExp('^' + name.slice(0, dot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '__(\\d{8}-\\d{6})' + name.slice(dot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
            const hd = pj(j.项目, '历史记录', ...q.slice(0, -1));
            const olds = (await fsp.readdir(hd).catch(() => [])).map(n => [n, (re.exec(n) || [])[1]]).filter(x => x[1]).sort((a, b) => b[1].localeCompare(a[1]));   // 新的在前
            if (olds.length) r.换 = await Promise.all(olds.map(async ([n, t]) => ({ t, sha: sha256(await fsp.readFile(path.join(hd, n))) })));   // 历史记录里有同名的旧版：这个名字的文件换过
          }
          r.sha256 = now;
        }
        const vrefs = refs.filter(r => /^@视频\d+$/.test(r.ref));
        for (const r of vrefs) r.secs = await vidSecs(pj(j.项目, ...r.path.split('/')));
        const vshort = vrefs.filter(r => r.secs && r.secs < 2), vtotal = vrefs.reduce((x, r) => x + (r.secs || 0), 0);
        if (vshort.length) throw fail('参考视频每段至少 2 秒即梦才收：' + vshort.map(r => r.ref + ' 只有 ' + r.secs.toFixed(1) + ' 秒').join('、'));
        if (vrefs.length > 10 || vtotal > 30.05) throw fail('参考视频最多 10 段、合计不超过 30 秒（现在 ' + vrefs.length + ' 段、' + vtotal.toFixed(1) + ' 秒），即梦不收');
        let n = 0;   // 这一段已经出到第几条：成片和历史记录里的都算
        for (const d of [pj(j.项目, '成片', segDir(j.段)), pj(j.项目, '历史记录', '成片', segDir(j.段))]) { try { for (const f of await fsp.readdir(d)) { const m = /第(\d+)条/.exec(f); if (m) n = Math.max(n, +m[1]); } } catch (e) { /* 没有这个文件夹 */ } }
        const no = n + 1, P = Object.assign({ 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 15, 积分上限: 0 }, j.参数 || {});
        if (!/^(480p|720p|1080p)$/.test(str(P.清晰度)) || !(P.秒数 >= 4 && P.秒数 <= 30)) throw fail('清晰度或者时长不对');
        j.步骤 = '在核对即梦账号和画布';
        const JMOK = await jmCheck(set.画布, prof);   // 这个号登着、画布在它名下才写任务书
        const tag = (/样片/.test(P.模型) ? '样片' : '') + P.清晰度;
        const out = ['成片', segDir(j.段), segDir(j.段) + '_第' + no + '条_' + label + '_' + tag + '.mp4'], abs = (...x) => pj(j.项目, ...x).replace(/\\/g, '/');
        const nodeName = f => { const q = f.split('/'); const base = q[q.length - 1].replace(/\.[^.]+$/, ''); return q[1] === '全局资产' ? q[2] + '_' + base : /^第.+段$/.test(q[1]) ? q[1] + '_' + base : base; };
        const per = /样片/.test(P.模型) && P.清晰度 === '480p' ? (vrefs.length ? 18 : 9) : /2\.0 mini/.test(P.模型) && P.清晰度 === '720p' && vrefs.length ? 12 : /2\.0 VIP/.test(P.模型) && P.清晰度 === '720p' && vrefs.length ? 28 : 0;   // 以往实扣的价（2026-11-11～13）
        const lines = ['任务：在即梦画布上为《' + j.项目 + '》第' + j.段 + '段第' + no + '条出一条视频：' + label + '，' + P.模型 + '，' + P.清晰度 + '，' + P.秒数 + ' 秒。',
          '这份任务书是项目管理的流水线在 ' + nowText() + ' 生成的。用户在页面上点了「批准出片」才会交到你手上；这一条由你从头做到尾：建草稿、核对、报价、提交生成、等出片、下载。不要手改这份任务书。',
          '', '〇、本次可以用的工具', '用本项目的即梦快线 ' + path.join(SKILLS, 'dreamina-video-fastlane').replace(/\\/g, '/') + ' 和它要用的 dreamina-canvas-cli，只限这一次。不要运行任何更新、安装技能的命令。',
          '新素材明确用 CLI 传，每样只传一次；回了状态不明，就用原编号只读核查，查不到就停下告诉我。不要用桌面 Computer Use 去点 Windows 的文件选择对话框。网页要求登录、付费开通，或弹出权限、授权窗口时就停下告诉我，不要代点。',
          '即梦账号：' + (prof ? '用登录位「' + prof + '」，每一条 dreamina-canvas 命令都带上 --profile ' + prof + '。' : '用默认登录位（命令不带 --profile）。') + '这个登录位应是「' + JMOK.nick + '」，画布「' + JMOK.name + '」在它名下（生成任务书时核对过）。开工前先用 auth status 看它是不是登录着、auth account 看是不是这个号；没登录或者不是这个号，就停下告诉我，不要自己登录、不要换账号。',
          ...(vrefs.length ? ['白模：这一条挂了参考视频 ' + vrefs.map(r => r.ref).join('、') + '（白模）。本项目没有白模核验工具，这份任务书没有「〇 核验回执」；用户定了带白模的条不做核验，点了「批准出片」就是跳过核验，交给你的那条消息里写着「白模我看过了，跳过核验」。消息里没有这句就停下问我，不要往下做。'] : []),
          '', '一、画布与节点', '画布：' + (set.画布 || '（资产/出片设置.json 里还没写画布网址：先停下问我）'), '新建一个视频节点，名字写：第' + j.段 + '段｜第' + no + '条｜' + label + '｜' + tag + '｜' + P.秒数 + '秒（下称节点A）。',
          '开工前先查画布上有没有同名节点：没有才新建；同名节点已经提交过，就停下告诉我；还是草稿，就在它上面接着做，不另建。这一条在画布上只新建节点A 这一个视频节点，别的节点一律不改、不删、不运行；引用已有的素材节点不算改动。',
          '', '二、模型与参数', P.模型 + '，' + P.清晰度 + '，16:9，生成 1 条，' + P.秒数 + ' 秒。全能参考。声音没有单独的开关就照默认，不要杜撰参数。',
          ...(per ? ['照以往实扣，' + (vrefs.length ? '带参考视频的' : '') + '这种出法每秒约 ' + per + ' 积分，这一条预计约 ' + per * P.秒数 + ' 积分；以报价为准。'] : []),
          ...(vrefs.length && vtotal && Math.abs(vtotal - P.秒数) > 1 ? ['白模合计 ' + vtotal.toFixed(1) + ' 秒，这一条照用户填的出 ' + P.秒数 + ' 秒，不要改。'] : []),
          '', '三、参考：' + refs.length + ' 个，按顺序挂，编号要对上', refs.length ? '画布上已经有同名素材节点的（节点名写在括号里），回读确认还在、类型对，就直接引用，不重传；没有的才用 CLI 传：图片传成独立图片节点' + (vrefs.length ? '，视频传成独立视频素材节点（resource upload --type video，再 node create video）' : '') + '，节点名照括号里的写。节点A 里用「从画布选择」引用素材节点，不要直接上传进视频节点。' : '这一条没有登记参考素材（纯文字出片）。',
          ...refs.map(r => r.ref + ' ' + r.name + '：' + abs(...r.path.split('/')) + (r.secs ? '，' + r.secs.toFixed(1) + ' 秒' : '') + '，SHA-256 ' + r.sha256 + '（素材节点名：' + nodeName(r.path) + '）。'
            + (r.换 ? '这个文件换过新的，旧版收在历史记录。画布上的同名节点照生成记录里的 SHA-256 认：是下面哪一版旧的，就先把它改成那一版的名字（照 AGENTS.md，只改名，不删）：' + r.换.map(o => '「' + nodeName(r.path) + '__' + o.t + '」（SHA-256 ' + o.sha + '）').join('、') + '；改好再照这个文件传一个新节点，名字写「' + nodeName(r.path) + '」。是现在这个文件的，直接引用；哪一版都对不上、查不到，就停下问我。' : '')),
          ...(refs.some(r => r.换) ? ['给上面写着「换过新的」的旧节点改名，是「别的节点一律不改」唯一的例外。'] : []),
          '', '四、提示词', '文件：' + abs(...rel), '核对：非空行 ' + text.split(/\r?\n/).filter(l => l.trim()).length + ' 行，SHA-256 ' + sha256(buf) + '。', '全文原样填进节点A 的提示词，保留换行，不增删、不改字；存草稿后回读，和文件逐字比对一遍。装不下、被截断就停下告诉我，不要删减。',
          '', '五、核对、报价、提交', P.积分上限 > 0 ? '报价不超过 ' + P.积分上限 + ' 积分才提交；超过就停在草稿，告诉我报价多少。' : '用户没有给积分上限：存好草稿、报出价钱以后停下，等用户点头，不要提交。',
          '只提交节点A 这一次、生成 1 条。提交返回状态不明时先查节点状态，不重复提交。被版权限制或别的原因拦下就停下告诉我，不改提示词、不换参考、不重试。',
          '', '六、等待与下载', '提交后等它出完。等待查询超时不算失败，用同一个提交编号接着查，不重新提交。生成失败就停下把原因告诉我，不重试。', '成功后用 CLI 下载到 ' + abs(...out) + '。这个文件已经存在就停下告诉我，不覆盖。',
          '', '七、做完回复', '节点A 的编号、实际扣了多少积分、下载到的完整路径。'];
        const tf = ['提示词', segDir(j.段), taskOfVp(j.名)];
        await archive(j.项目, tf);
        await writeFile(pj(j.项目, ...tf), lines.join('\n') + '\n');
        return { 结果: '任务书写好了（第' + no + '条，挂 ' + refs.length + ' 个参考' + (vrefs.length ? '，含 ' + vrefs.length + ' 段白模' : '') + '；即梦用' + (prof ? '「' + prof + '」号' : '默认号') + '「' + JMOK.nick + '」，画布「' + JMOK.name + '」）' + (prof ? '。注意：Codex 那边也要登着这个号，没登它会停下' : ''), 产出: [tf.join('/')] };
      },
    },
    /* 出片：把任务书交给 Codex 真去做（要花积分；只在用户点了「批准出片」时才开） */
    出片: {
      title: j => '出片 · 第' + j.段 + '场 ' + vpLabelOf(str(j.名).replace(/出片任务(_[0-9]+)?(_改[0-9]+)?\.txt$/, '视频提示词$1$2.txt')), need: ['段'], key: j => j.段 + '/' + j.名, codex: true,
      async run(j) {
        const p = pj(j.项目, '提示词', segDir(j.段), str(j.名));
        if (!nameOk(str(j.名)) || !/出片任务(_[0-9]+)?(_改[0-9]+)?\.txt$/.test(j.名) || !(await exists(p))) throw fail('没有这份出片任务书');
        if (j.批准 !== '用户点了批准出片') throw fail('出片要用户在页面上点「批准出片」');
        const tt = unbom(await fsp.readFile(p, 'utf8'));
        const vid = /^@视频\d+ /m.test(tt);   // 挂了白模：11-15 他定了不再要勾，点了批准出片就跳过核验；即梦快线要人当面说跳过的那句，下面替他带给 Codex
        j.步骤 = '在核对即梦账号和画布';   // 交给 Codex 之前照任务书里写的再核一遍：任务书生成以后改过号、画布，或者是 11-14 以前的旧任务书
        const cv = (/^画布：(\S+)/m.exec(tt) || [])[1] || '', tp = (/^即梦账号：用登录位「([A-Za-z0-9_-]{1,40})」/m.exec(tt) || [])[1] || '';
        try { await jmCheck(cv, tp); } catch (e) { throw e.plain ? fail(e.message + '。没交给 Codex，也没花积分；出片设置对上以后，重新生成任务书') : e; }
        await noteShot(j);   // 记下这一回用的是哪一版提示词：样片待不待核对照它算
        j.步骤 = 'Codex 在出片（要等好几分钟）';
        const reply = await codexDo(j, '请照 ' + p + ' 执行。' + (vid ? '用户点了批准出片，白模我看过了，跳过核验：这一条的白模不用核验回执，照任务书做。' : ''));
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
        try { for (const f of vpLatest(await fsp.readdir(pj(j.项目, '提示词', segDir(j.段))))) prompts += '\n### ' + f + '\n' + unbom(await fsp.readFile(pj(j.项目, '提示词', segDir(j.段), f), 'utf8')); } catch (e) { /* 没有提示词 */ }
        const look = await lookPart(j.项目, flow, s, '审', '全片的光影总基调');   // 定了拍摄风格：带上风格库里给人核片子用的招牌（11-14）
        return ['# 任务：看审片批注，说说该回哪一道工序改', '', '今天 ' + today() + '。这是一个 AI 短视频项目，一场戏分五道工序做：一 全片设定（梗概、人物、场景、道具、拍摄风格）→ 二 段落、剧本 → 三 资产图 → 四 提示词 → 五 审片。下面是用户看完一条样片写的批注。请逐条说：要改的具体是什么，建议回哪一道工序改，会波及哪些已经做好的东西。',
          '', '## 要求', '1. 别按问题的种类硬套工序：表演不好可能只要改提示词；台词文字要改才回剧本；长相、道具样子不对回资产；只是这一条没抽好、东西都不用改的，就说「不用改，重出一条」。', '2. 用大白话，一条批注对一条建议，每条两三句。最后一行写总的建议：先做哪一件。',
          ...(look ? ['3. 批注说到风格、画面味道的，对照下面「拍摄风格」那几样说：是提示词没写到、是这一条没抽好，还是这种风格本身不合这场戏（那就回全片设定换风格）。'] : []),
          '', '## 审片批注', unbom(await fsp.readFile(np, 'utf8')), '', '## 这一场', s ? sceneText(flow, s) : '（流水线里没有这一场的段落）', look, (await exists(sp)) ? '\n## 剧本\n' + await docText(sp) : '', prompts ? '\n## 这一场的提示词' + prompts : '', TAIL].join('\n');
      },
      async apply(j, text) {
        const rel = ['成片', segDir(j.段), str(j.视频).replace(/\.[^.]+$/, '') + '_AI建议.md'];
        await writeFile(pj(j.项目, ...rel), '# AI 建议｜' + j.视频 + '\n\n' + nowText() + '　' + chLabel(j) + '\n\n' + body(text) + '\n');
        return { 结果: 'AI 的建议写好了，在这条视频下面', 产出: [rel.join('/')] };
      },
    },
    /* ---------- 拍摄风格：剧本定稿以后，AI 读梗概和剧本，从风格库里挑一种推荐（11-14 加）。挑哪个还是人定；推荐写进 定稿的剧本/流水线_AI扩写.json 的「风格」 ---------- */
    推荐风格: {
      title: j => '推荐拍摄风格' + (j.段 ? ' · 第' + j.段 + '场' : ''), key: j => j.段 || 'all',
      async book(j) {
        if (!Style) throw fail('读不了 公用/风格库.js');
        if (j.段 && !segOk(j.段)) throw fail('要说清是第几场');
        const flow = await readFlow(j.项目), lib = await styleLib().catch(e => { throw fail('风格库读不了：' + e.message); });
        if (!lib.list.length) throw fail('风格库里还没有风格');
        const tone = await toneOf(j.项目), film = flow.风格 && typeof flow.风格 === 'object' ? str(flow.风格.名).trim() : '';
        j.风格名 = [...lib.list.map(c => c.名), ...(tone ? [Style.OWN] : [])];
        let scripts = '';
        for (const s of (Array.isArray(flow.场) ? flow.场 : []).filter(x => x && x.段 && (!j.段 || str(x.段) === j.段))) {
          const sp = scriptPath(j.项目, str(s.段));
          if (await exists(sp)) scripts += '\n### 第' + s.段 + '段' + (finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs)) ? '（定稿了）' : '（还没定稿）') + '\n' + (await docText(sp)).slice(0, 8000);
        }
        const card = c => ['### ' + c.名 + (c.已定 ? '' : '（备选：还没出样片验过）'), ...['一句话', 'AI圈怎么用', '一眼认出', '别和它混', '容易跑偏'].filter(k => c[k]).map(k => k + '：' + c[k])].join('\n');
        return ['# 任务：照剧本给这部片子挑一种拍摄风格', '', '今天 ' + today() + '。这是一个 AI 短视频项目（用 Seedance 出片）。剧本定稿了，要定' + (j.段 ? '第' + j.段 + '场另用' : '全片') + '的拍摄风格。请读梗概和剧本，从下面的风格库里挑一种最合适的推荐；挑哪个由人定。',
          '', '## 要求', '1. 只能从这几种里挑，名字照抄：' + j.风格名.join('、') + '。',
          '2. 看合不合这部戏：年代、地方、人物身份、故事的味道（喜剧、温情、动作、悬疑……），这种风格的招牌用进来会不会别扭。出过样片验过的优先；备选的也能推荐，理由里说一句还没出样片。',
          tone ? '3. 「' + Style.OWN + '」是这个项目自己定的光影总基调（附在最后），合适也可以推荐它。' : '3. 不推荐风格库以外的。',
          '4. 理由用大白话写两三句：为什么合这部戏，用它要注意什么。再给一个备选，没有就空着。' + (film ? '现在定的是「' + film + '」，可以照样推荐它，也可以推荐换一个。' : ''),
          '5. 回复一段 JSON，像这样：', '{"推荐": "风格名", "理由": "两三句", "备选": "另一个风格名，或者空着"}',
          '', '## 全片的设定', settingText(flow), '', '## 剧本' + (scripts || '\n（还没有剧本：只看梗概和设定）'),
          '', '## 风格库', ...lib.list.map(card), tone ? '\n### ' + Style.OWN + '\n' + tone : '', TAIL].join('\n');
      },
      async apply(j, text) {
        const got = jsonIn(text), pick = str(got.推荐).trim(), alt = str(got.备选).trim(), names = j.风格名 || [];
        if (!names.includes(pick)) throw fail('AI 推荐的「' + pick.slice(0, 20) + '」不在风格库里');
        const p = pj(j.项目, '定稿的剧本', AI_FILE);
        return withFileLocks([p], async () => {
          let cur = {};
          try { cur = JSON.parse(unbom(await fsp.readFile(p, 'utf8'))); } catch (e) { cur = {}; }
          if (!cur || typeof cur !== 'object' || Array.isArray(cur)) cur = {};
          cur.风格 = { 推荐: pick, 理由: str(got.理由).trim().slice(0, 600), 备选: names.includes(alt) && alt !== pick ? alt : '', 段: j.段 || '', 时间: nowText() };
          await writeFile(p, JSON.stringify(cur, null, 2) + '\n');
          return { 结果: 'AI 推荐「' + pick + '」，挑哪个你定', 产出: ['定稿的剧本/' + AI_FILE] };
        });
      },
    },
  });

  /* ---------- 提示词的格式和写戏规矩（2026-11-13 起照 sd25-pe；seedance-prompt-format 技能删了，它的写戏规矩并进这里） ---------- */
  const PE_FORMAT = ['## 提示词格式（照 sd25-pe）',
    '1. 段名独占一行。这一条挂的素材五份以内用写法一「带参考素材的生成」：【生成目标】【参考素材职责】【未采用素材】（挂了没用上的才写）【基础设定】【主体与关系】【事件脚本】【保持一致】。',
    '2. 素材多于五份用写法二「多素材组织」：【生成目标】【人物】【道具】【场景】【动作与声音】【未采用素材】【基础设定】【事件脚本】【保持一致】，不写【主体与关系】；首帧、尾帧那几句放在【场景】最前面，开场站位放在【场景】最后。',
    '3. 素材职责一份一句。写法一：「@图片1用于〔称谓〕的五官、发型和服装，不采用图片背景。」写法二：「〔称谓〕对应@图片1，只采用五官、发型和服装。」首帧写「@图片N作为首帧。」，下一句写「该首帧定义……」。',
    '4. 【主体与关系】写几个人、各是谁（没图的写长相衣着，说话的写声线），开场谁在哪、朝着谁，道具几个、归谁，场景空间。',
    '5. 【事件脚本】一镜一行「镜头1：……」，镜头号从 1 连着编、不补 0，不写镜头标题；人和道具用称谓。台词 {}、音效 <>、音乐 ()、字幕【】写在发生处，不用引号。最后一行写「声音包括〔配乐或无背景音乐、环境声、音效〕。」；影像风格、光色不写在这里，写进【基础设定】（第 10 条）。',
    '6. 【保持一致】写「保持……稳定。」，只写最怕错的两三样。',
    '7. 不写时长秒数、画幅分辨率（在生成参数里设），不写画面里没有的东西。（既挂白模又挂关键帧的，每一镜开头写它在白模里的整秒，见第 9 条）',
    '8. 稿子已经是旧格式（「本段事件：」开头的，或七分区的）：照它原来的格式改，不改成新格式。',
    '9. 既挂白模又挂关键帧的（2026-11-14 起）：照官方指南「粗粒度白模 + 阶段关键帧」写，见「白模＋关键帧的写法」那一段；和上面第 2、3、7 条不一样的地方以它为准。',
    '10. 【基础设定】放在事件脚本前面（2026-11-14 用户定）：一样一行「影像风格：……」「摄影：……」「光色基调：……」，风格名打头，质感、拍法、光色写成看得见的样子；光色基调句末写这一场的时间和主光。老稿已经写成「最终画面采用……」那一行的，没让改风格就不挪。'].join('\n');
  const PE_DRAMA = ['## 写戏规矩',
    '1. 目标导向：要什么、怕什么？真人会怎么做？', '2. 反应要由刚发生的事引起。', '3. 听的人给一拍反应，不无故不动。', '4. 反应写成看得见的动作。',
    '5. 不过度演绎：被逼到了才爆发。', '6. 最重的那句，写被什么点着。', '7. 再写身体怎么使劲、话怎么往上冲。', '8. 夸张放在事上，人按常理反应。',
    '9. 禁止写一直不变的表情姿势。', '10. 禁止堆表情小动作，挑最清楚的一两处。', '11. 说话做事朝着对方，不无故冲镜头。', '12. 人多只写主要人物，次要人物各忙各的。',
    '13. 人少要写明具体人数。', '14. 放手：表情、小动作的细节。', '15. 不放手：人数、站位、道具。', '16. 不放手：台词原文、镜头顺序。', '17. 放手的底：一句台词配一个看得见的动作。'].join('\n');
  /* 稿子是不是 sd2.5PE 格式：有独占一行的【生成目标】【基础设定】【主体与关系】【事件脚本】【保持一致】之一（旧稿素材里也写【参考素材职责】【未采用素材】，不算） */
  const PE_HEAD = { '【生成目标】': 'event', '【基础设定】': 'basic', '【主体与关系】': 'seg', '【事件脚本】': 'shots', '【保持一致】': 'keep' };
  const RE_PE_REF = /^【(参考素材职责|人物|道具|场景|动作与声音|未采用素材|主体设定[：:][^】]*)】$/;
  const isPeText = t => String(t || '').split(/\r\n|\n|\r/).some(l => PE_HEAD[l.replace(/\s+/g, '')]);

  /* ---------- 工序四：你来写提示词，AI 给建议、关键词、批注、按批注改 ----------
     只有分镜部分可在逐镜编辑、自由文本间切换；其余公共区共用。铺底任务仅更新侧栏建议，不改正文。
     读成几区、照原样写回去，和写稿页（通用工具/项目管理_写稿试用.html）是同一套读法 */
  const SEC_OF = { 素材: 'refs', 基础设定: 'basic', 本段: 'seg', 分镜: 'shots' }, BOMCH = String.fromCharCode(0xFEFF);
  function parsePrompt(text) {
    const d = { bom: false, eol: '\n', pre: [], event: '', refs: [], basic: [], seg: [], shotsPre: [], shots: [], keep: '', has: {} };
    if (text.charCodeAt(0) === 0xFEFF) { d.bom = true; text = text.slice(1); }
    if (/\r\n/.test(text)) d.eol = '\r\n';
    let sec = 'pre', shot = null;
    if (isPeText(text)) {   // sd2.5PE 稿：事件脚本里「镜头1：……」一行一镜，没有标题；【基础设定】和事件脚本最后「声音包括……」（老稿「最终画面采用……」）那一行都记在 basic
      d.fmt = 'pe';
      for (const raw of text.split(/\r\n|\n|\r/)) {
        const t = raw.trim(), hk = t.replace(/\s+/g, '');
        if (PE_HEAD[hk]) { sec = PE_HEAD[hk]; d.has[sec] = true; shot = null; continue; }
        if (RE_PE_REF.test(hk)) { sec = 'refs'; d.has.refs = true; d.refs.push(t); shot = null; continue; }
        if (!t) continue;
        if (sec === 'shots' && /^(最终画面|声音包括)/.test(t)) { d.basic.push(t); shot = null; continue; }
        const m = sec === 'shots' ? /^镜头\s*([0-9０-９]+)\s*[：:｜|]?\s*(.*)$/.exec(t) : null;
        if (m) { shot = { no: m[1], title: '', lines: m[2] ? [m[2]] : [] }; d.shots.push(shot); continue; }
        if (sec === 'event') d.event += t;
        else if (sec === 'keep') d.keep += t;
        else if (sec === 'shots') (shot ? shot.lines : d.shotsPre).push(t);
        else d[sec].push(t);
      }
      return d;
    }
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
  /* 提示词的名字：一场写几条就分几条，第一条 视频提示词.txt，第二条起 视频提示词_02.txt、_03.txt……（2026-11-13 定，加第二条时第一条不改名）；
     老稿 段落a-b_视频提示词.txt、镜头a-b_视频提示词.txt 照旧认。和 通用工具/流水线/流水线.js 里的 vpNo、vpLabel、vpTok 一个算法 */
  /* 审片以后照修改方案改出来的另存一份，名字后面加 _改1、_改2……（2026-11-14 他定）：视频提示词_改1.txt、视频提示词_02_改1.txt、镜头1-5_视频提示词_改1.txt。
     原稿和前几版留在原处不动；流水线里一条只摆最新的那一版，出片也用它 */
  const RE_VP = /(^|_)视频提示词(_[0-9]+)?(_改[0-9]+)?\.txt$/;
  const vpPath = j => pj(j.项目, '提示词', segDir(j.段), str(j.名));
  const vpVer = name => +((/_改([0-9]+)\.txt$/.exec(str(name)) || [])[1] || 0);   // 改的第几版；原稿是 0
  const vpBase = name => str(name).replace(/_改[0-9]+(\.txt)$/, '$1');   // 这一条的原稿名
  const vpNo = name => { const b = vpBase(name); return /^视频提示词\.txt$/.test(b) ? 1 : +((/^视频提示词_([0-9]+)\.txt$/.exec(b) || [])[1] || 0); };   // 第几条；老稿是 0
  const vpLabelOf = name => { const b = vpBase(name), n = vpNo(b), v = vpVer(name); return (n ? '第' + n + '条' : b.replace(/_?视频提示词\.txt$/, '') || '整场') + (v ? ' 改' + v : ''); };
  const vpLabel = j => vpLabelOf(str(j.名));
  const vpTok = name => { const b = vpBase(name), n = vpNo(b), v = vpVer(name); return (n ? '提示词' + two(n) : b.replace(/_?视频提示词\.txt$/, '') || '整场') + (v ? '改' + v : ''); };   // 样片名、画布节点名里写的（和样片自己的「第N条」分开）
  const taskOfVp = name => name.replace(/视频提示词(_[0-9]+)?(_改[0-9]+)?\.txt$/, '出片任务$1$2.txt');   // 视频提示词_02.txt → 出片任务_02.txt；视频提示词_改1.txt → 出片任务_改1.txt
  const vpLatest = names => { const by = new Map(); for (const n of names) if (RE_VP.test(n)) { const b = vpBase(n), o = by.get(b); if (!o || vpVer(n) > vpVer(o)) by.set(b, n); } return [...by.values()]; };   // 一条只留最新那一版
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
  async function geoOf(name, seg, s) {   // s：这一场。全局资产/场景 里「图名_GEO底稿.md」（文生资产一样一份）只要这一场用到的那几处
    const out = [], stems = s ? new Set([...(Array.isArray(s.场景图) ? s.场景图 : []).map(g => stemOf(g)), ...(Array.isArray(s.场景文字) ? s.场景文字 : []).map(sceneStem).filter(Boolean)]) : null;
    const take = async (rel, ok) => { try { for (const g of (await fsp.readdir(pj(name, ...rel))).sort()) if (/GEO底稿[^/]*\.md$/i.test(g) && (!ok || ok(g))) out.push({ rel: [...rel, g].join('/'), text: unbom(await fsp.readFile(pj(name, ...rel, g), 'utf8')).trim() }); } catch (e) { /* 没有这个文件夹 */ } };
    await take(['提示词', segDir(seg)]);
    await take(['提示词', '全局资产', '场景'], g => { const m = /^(.+)_GEO底稿\.md$/i.exec(g); return !m || !stems || stems.has(m[1]); });   // 老的（战场GEO底稿.md 这类）照旧都要
    if (!out.length) { try { for (const d of (await fsp.readdir(pj(name, '提示词'))).sort()) if (/^第.+段$/.test(d) && d !== segDir(seg)) await take(['提示词', d]); } catch (e) { /* 没有提示词文件夹 */ } }
    return out.filter(x => x.text);
  }
  /* 任务书里讲场景的那几句、带的材料、要不要让 AI 看图：有底稿照底稿；没有底稿、有场景图，看图建一份 */
  async function geoPart(j, sceneImgs, s) {
    const geo = await geoOf(j.项目, j.段, s), imgs = [];
    for (const g of sceneImgs || []) { const p = pj(j.项目, ...String(g).replace(/\\/g, '/').split('/')); if (/\.(png|jpe?g|webp)$/i.test(p) && await exists(p)) imgs.push(p); }
    const make = !geo.length && imgs.length > 0;   // 没有底稿、有场景图：让 AI 看图先建一份
    return {
      make, images: make ? imgs : [],
      rule: geo.length ? '场景一律照 scene-geo：下面给了这一场的 GEO 底稿（照生成好的场景图核过、人审过的），场景空间、轴线、站位、物件、光，都照底稿翻成场景段（scene-geo 第六节的办法），写进【主体与关系】（写法二写进【场景】）。底稿里的事实不许改、不许另编；底稿没写的地方不要自己添；底稿标了「逐镜状态」「待定」的照它的说明办。素材职责里场景图那一句照 scene-geo 第七节写（这张图是从哪往哪看的、只采用什么、不采用什么）。'
        : make ? '场景一律照 scene-geo：这一场还没有 GEO 底稿。你已经看过这一场的场景图了，先照 scene-geo 第五节的模板给它建一份 GEO 底稿（空间里有什么、各在哪、从哪往哪看；只写图上看得到的和剧本点了名的，图和剧本对不上的地方单列出来），放在回复最前面的【GEO底稿】一块里，给人审，不进提示词；再照这份底稿把场景空间、轴线、站位、物件、光翻成场景段（第六节），写进【主体与关系】（写法二写进【场景】）。素材职责里场景图那一句照第七节写。'
          : '场景照 scene-geo 的办法想清楚再写：这一场没有场景图也没有 GEO 底稿，只照全片的场景描写和剧本写，不要编图上才有的细节。',
      text: geo.length ? geo.map(x => '\n## GEO 底稿（' + x.rel + '；人审用的底稿，照它翻，不要把底稿原文搬进提示词）\n' + x.text).join('\n') : make ? '\n## 这一场的场景图（已经让你看过）\n' + imgs.join('\n') : '',
    };
  }
  async function saveGeo(j, text) {   // AI 新建的底稿：存到这一段的文件夹里给人审；那里已经有就不动
    const t = (text || '').trim(), rel = ['提示词', segDir(j.段), 'GEO底稿.md'];
    if (t.length < 80 || await exists(pj(j.项目, ...rel))) return '';
    await writeFile(pj(j.项目, ...rel), '# 第' + j.段 + '段 GEO 底稿\n\n人审用，不进提示词。' + nowText() + ' ' + chLabel(j) + ' 看着场景图、照 scene-geo 建的，还没人审过：看完哪里不对，改这份底稿，再点「重新铺底」。\n\n' + t + '\n');
    return rel.join('/');
  }
  /* 这个项目定下来的全片光影总基调、踩过的坑（历史教训）：写提示词、铺底的时候带上 */
  async function toneOf(name) { const p = pj(name, '提示词', '全局资产', '全片_光影总基调.txt'); return (await exists(p)) ? unbom(await fsp.readFile(p, 'utf8')).trim() : ''; }
  /* 交给 AI 的「拍摄风格」那一段（11-14 加）：这一场另选的先算，没有就照全片的（s 不给：只看全片的，资产图是各场共用的）。
     风格库里的一种：带上它的写法；「本项目自己的」：照光影总基调；没定风格：照旧只带光影总基调（有的话），小标题用 toneHead。
     use：写（写提示词、铺底）、批、改、图（出图提示词）、审（审片建议），各带哪几行见 公用/风格库.js */
  const styleLib = async () => Style.parse(unbom(await fsp.readFile(path.join(TOOLS, Style.DIR[1], Style.FILE), 'utf8')));
  async function lookPart(name, flow, s, use, toneHead) {
    if (flow === null) flow = await readFlow(name).catch(() => null);
    const film = flow && flow.风格 && typeof flow.风格 === 'object' ? str(flow.风格.名).trim() : '';
    const mine = s ? str(s.风格).trim() : '', n = mine || film, tone = await toneOf(name);
    const plain = tone ? '\n## ' + toneHead + '\n' + tone : '';
    if (!n || !Style) return plain;
    let card = null;
    if (n !== Style.OWN) {
      try { card = Style.find(await styleLib(), n); } catch (e) { log('读不了风格库：' + e.message); }
      if (!card) return '\n## 这部片子的拍摄风格：' + n + '\n（风格库里没找到这一种的写法，照这个名字的意思写）' + plain;
    }
    return Style.bookPart({ 名: n, card, tone, scene: !!mine }, use);
  }
  async function lessonsOf(name) {
    let out = '';
    try { for (const g of await fsp.readdir(pj(name, '历史教训'))) if (/\.(md|txt)$/i.test(g)) out += '\n### ' + g + '\n' + unbom(await fsp.readFile(pj(name, '历史教训', g), 'utf8')).slice(0, 6000); } catch (e) { /* 这个项目没有历史教训 */ }
    return out;
  }
  function sceneAssets(flow, s) {
    const out = [];
    for (const k of ['人物', '道具']) for (const n of s[k] || []) { const e = (flow[k] || []).find(x => x && x.名 === n); for (const g of (e && (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : [])) || []) out.push({ line: k + '「' + n + '」：' + g, path: String(g).replace(/\\/g, '/') }); }
    for (const x of segRefs(s)) out.push({ line: x.k + '参考「' + x.n + '」（这一段的图）：' + x.f, path: x.f });
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
  /* ---------- 白模视频（2026-11-13 起，见 通用工具/流水线/白模与分段_讨论.md）：挂在某一条提示词上的 @视频N ----------
     你来写的稿记在写稿过程文件的「挂图」里，AI 写的稿记在参考素材映射里；同一个编号以挂图为准 */
  const VIDEO_RE = /\.(mp4|mov|m4v|webm)$/i;
  const FFMPEG = process.env.ANTOU_FFMPEG || (() => {   // 这台电脑上的 ffmpeg 是剪映带的
    try { const d = 'D:/Apps/JianyingPro'; for (const v of fs.readdirSync(d).sort().reverse()) { const p = path.join(d, v, 'ffmpeg.exe'); if (fs.existsSync(p)) return p; } } catch (e) { /* 没装剪映 */ }
    return '';
  })();
  async function vidSecs(abs) {   // 视频多长（秒）：ffmpeg -i 打出来的 Duration；没有 ffmpeg、读不出就是 0（不拦）
    if (!FFMPEG) return 0;
    try { const r = await run(FFMPEG, ['-hide_banner', '-i', abs], { timeout: 30e3 }); const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.err + r.out); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0; } catch (e) { return 0; }
  }
  async function regOf(j) {   // 这份稿登记了哪些素材：映射里的，加上挂图里的
    const rel = ['提示词', segDir(j.段), str(j.名)].join('/'), out = new Map();
    let map = {};
    try { map = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '参考素材映射.json'), 'utf8'))); } catch (e) { /* 还没有 */ }
    for (const r of (((map.prompts || {})[rel] || {}).references || [])) if (r && /^@(图片|视频|音频)\d+$/.test(str(r.ref))) out.set(r.ref, { ref: r.ref, path: str(r.path).replace(/\\/g, '/'), name: str(r.name), from: '映射' });
    try { const side = JSON.parse(unbom(await fsp.readFile(vpPath(j).replace(/\.txt$/, '_写稿.json'), 'utf8'))); for (const [ref, f] of Object.entries((side && side.挂图) || {})) if (/^@(图片|视频|音频)\d+$/.test(ref)) out.set(ref, { ref, path: String(f).replace(/\\/g, '/'), name: '', from: '挂图' }); } catch (e) { /* 没有过程文件 */ }
    return [...out.values()];
  }
  const vidsOf = regs => regs.filter(r => /^@视频\d+$/.test(r.ref) && VIDEO_RE.test(r.path));
  /* 这一条挂的关键帧（11-13 夜加，流水线资产那一步「关键帧」一块里的图）：这一段文件夹里的图，名字带首帧、尾帧、关键帧的，或者这一场挑进「关键帧」的 */
  const FRAME_RE = /首帧|尾帧|关键帧/;
  const framesOf = (j, regs, s) => regs.filter(r => /^@图片\d+$/.test(r.ref) && r.path.startsWith('资产/' + segDir(j.段) + '/') && (FRAME_RE.test(path.basename(r.path)) || (!!s && Array.isArray(s.关键帧) && s.关键帧.includes(r.path))));
  const frameImgs = (j, frames) => frames.map(f => pj(j.项目, ...(f.path || f).split('/'))).filter(p => /\.(png|jpe?g|webp)$/i.test(p));
  const FRAME_HOW = '写法照 sd25-pe「关键帧锚点」：一张的写「@图片N作为首帧。」，另起一句「该首帧定义……。」（名字带「尾帧」的当尾帧）；几张的照上面的先后，先写「以@图片A至@图片B的顺序作为关键帧。」（编号不连着就用顿号一个个列），第一张当首帧，中间的写「@图片N定义第二个关键帧：……。」，最后一张名字带「尾帧」的当尾帧。写法二放【场景】最前面，写法一放【参考素材职责】最前面。';
  const FRAME_HOW_BMK = '这一条还挂了白模：关键帧照「白模＋关键帧的写法」那一段写，不用 sd25-pe 的关键帧锚点句。';
  /* ---------- 审片时弃用的关键帧（2026-11-14 他定：新的一版去掉，图留着）----------
     审片台记在样片的批注里：一条批注多一行「弃用关键帧：@图片9 路径」，理由写在「批注」。
     照方案改的时候，照方案、照你说的都改完以后去掉：它自己那几句删掉，别的句子里提到它的那一处换成〔〕要人改写，后面的 @图片 往前挪、不留空号；
     普通写法的关键帧句子照剩下的重写（谁当首帧、第几个关键帧跟着变）；白模＋关键帧的稿只改关键帧那一句和每一镜开头参考的那几张，秒数不动。
     和提示词那一步「改关键帧」同一套（提示词.html 的 framePlan） */
  const KF_HOLE = '〔原来的关键帧去掉了，改写这一处〕';
  const KF_SHOT = /^(\s*镜头\s*)([0-9０-９]+)(\s*[：:]\s*)(.*)$/;
  const kfKey = l => String(l == null ? '' : l).replace(/\s+/g, '');
  const kfIsHead = l => /^【[^】]+】$/.test(kfKey(l));
  const kfEmpty = (L, i) => { const n = L[i + 1]; return n === undefined || !n.trim() || kfIsHead(n); };
  const spanRefs = s => { const out = []; for (const m of String(s).matchAll(/@图片(\d+)(?:至@图片(\d+))?/g)) { const a = +m[1], b = m[2] ? +m[2] : a; for (let n = Math.min(a, b); n <= Math.max(a, b) && out.length < 99; n++) out.push('@图片' + n); } return out; };   // 「@图片6至@图片10」「@图片6、@图片8」→ 一个一个
  function goneFrames(notesMd, regs) {   // 批注里弃用的那几张：照路径认，认不出照编号（名字也得对上）。{ list：登记里的那几项, miss：认不出的编号 }
    const list = [], miss = [];
    for (const m of str(notesMd).matchAll(/^弃用关键帧[：:][ \t]*(@图片\d+)[ \t]*(.*)$/gm)) {
      const p = m[2].trim().replace(/\\/g, '/'), k = p.lastIndexOf('/资产/'), rel = k >= 0 ? p.slice(k + 1) : p.startsWith('资产/') ? p : '';
      const r = regs.find(x => rel && x.path === rel) || regs.find(x => x.ref === m[1] && (!rel || path.basename(x.path) === path.basename(rel)));
      if (r && /^@图片\d+$/.test(r.ref)) { if (!list.includes(r)) list.push(r); } else if (!miss.includes(m[1])) miss.push(m[1]);
    }
    return { list, miss };
  }
  function kfPut(L, add) {   // 关键帧句子放哪：写法二放【场景】最前面，写法一放【参考素材职责】最前面；没有这一组就补上组名
    if (!add.length) return L;
    const find = g => L.findIndex(l => kfKey(l) === g);
    const two = ['【人物】', '【道具】', '【场景】', '【动作与声音】'].some(g => find(g) >= 0), g = find(two ? '【场景】' : '【参考素材职责】');
    if (g >= 0) { L.splice(g + 1, 0, ...add); return L; }
    let k = L.findIndex(l => (two ? /^【(动作与声音|未采用素材|主体与关系|事件脚本|保持一致)】$/ : /^【(未采用素材|主体与关系|事件脚本|保持一致)】$/).test(kfKey(l)));
    if (k < 0) k = L.length;
    L.splice(k, 0, two ? '【场景】' : '【参考素材职责】', ...add, '');
    return L;
  }
  function kfBmBack(L, v) {   // 白模＋关键帧的稿，关键帧一张不剩：换回普通的白模写法（白模那句、几何体对应，和提示词那一步 BM_LINES 一样）
    const T = L.map(l => l.trim()), add = [];
    if (!T.some(l => l.startsWith(v + '是'))) add.push(v + '是粗粒度白模参考，仅提供〔动作路径、主体站位、机位、运镜和切镜〕，不采用其中的白模外观、材质和场景。');
    if (!T.some(l => l.startsWith(v + '中的') || l.startsWith(v + '里'))) add.push(v + '中的〔哪个白模几何体〕对应〔哪个人物或道具〕。');
    if (!add.length) return L;
    const find = g => L.findIndex(l => kfKey(l) === g);
    const two = ['【人物】', '【道具】', '【场景】'].some(g => find(g) >= 0), g = find(two ? '【动作与声音】' : '【参考素材职责】');
    if (g >= 0) { let k = g + 1; while (k < L.length && L[k].trim() && !kfIsHead(L[k])) k++; L.splice(k, 0, ...add); return L; }
    let k = L.findIndex(l => (two ? /^【(未采用素材|事件脚本|保持一致)】$/ : /^【(未采用素材|主体与关系|事件脚本|保持一致)】$/).test(kfKey(l)));
    if (k < 0) k = L.length;
    L.splice(k, 0, two ? '【动作与声音】' : '【参考素材职责】', ...add, '');
    return L;
  }
  /* 去掉弃用的关键帧。lines：改好的稿（一行一项）；regs：原稿登记的素材；gone：弃用的那几项；s：流水线里这一场。
     返回 { lines 新稿, regs 新的一版登记的素材（编号照挪过的）, gone 去掉的编号, removed 删掉的句子, holed 换成〔〕的句子, moved 编号挪过没有 } */
  async function dropFrames(j, lines, regs, gone, s) {
    if (!KeyFrames) throw fail('读不了 公用/关键帧写法.js，去不了弃用的关键帧');
    const goneRefs = gone.map(r => r.ref), vids = vidsOf(regs), frames = framesOf(j, regs, s), src = lines.join('\n');
    const bmk = !!BmKey && vids.length > 0 && BmKey.isBmk(src), used = new Set(), removed = [], holed = [];
    const isGroup = l => !!BmKey && BmKey.isOwn(l) && /@图片/.test(l);   // 白模＋关键帧：「@图片6至@图片10是各镜头的关键帧……」
    let L = src.split('\n');
    if (bmk) {   // 挂着的关键帧：关键帧那一句、每一镜开头参考的
      for (const l of L) if (isGroup(l)) spanRefs(l).forEach(r => used.add(r));
      for (const l of L) { const m = KF_SHOT.exec(l), t = m && BmKey.tagOf(m[4]); if (t) t.refs.forEach(r => used.add(r)); }
    }
    const sc = KeyFrames.scan(L);
    if (!bmk) sc.refs.forEach(r => used.add(r));
    const kfs = regs.filter(r => /^@图片\d+$/.test(r.ref) && (frames.includes(r) || used.has(r.ref) || goneRefs.includes(r.ref))), olds = kfs.map(r => r.ref);
    let list = KeyFrames.order(kfs.filter(r => !goneRefs.includes(r.ref) && used.has(r.ref)).map(r => ({ ref: r.ref, name: path.basename(r.path).replace(/\.[^.]+$/, ''), desc: sc.desc.get(r.ref) || '' })));
    const filled = new Set(L.map((l, i) => kfIsHead(l) && !kfEmpty(L, i) ? kfKey(l) : '').filter(Boolean));
    if (bmk && !list.length) L = BmKey.bare(src).text.split('\n');   // 一张不剩：白模＋关键帧那几句、每一镜开头的秒数都拿掉，下面换回普通的白模写法
    else if (bmk) {   // 关键帧那一句先换成记号（编号排好了写回原处）；每一镜开头参考的，去掉弃用的那几张
      let had = false;
      L = L.flatMap(l => {
        if (isGroup(l)) { if (had) return []; had = true; return ['\u0000KF']; }
        const m = KF_SHOT.exec(l), t = m && BmKey.tagOf(m[4]);
        if (!t || !t.refs.some(r => goneRefs.includes(r))) return [l];
        let tag = t.text;
        for (const g of goneRefs) tag = tag.replace(new RegExp('[，,、]\\s*(?:首帧|开场|结尾)?参考\\s*' + g + '(?![0-9])', 'g'), '');
        return [m[1] + m[2] + m[3] + tag.replace(/秒\s*、/, '秒，') + m[4].slice(t.len)];
      });
    } else if (sc.rows.size) L = L.filter((l, i) => {   // 普通写法：原来的顺序句和这几张的句子先拿掉，下面照剩下的重写
      if (!sc.rows.has(i)) return true;
      const r = sc.rows.get(i);
      if (r && !olds.includes(r)) return true;
      if (goneRefs.includes(r)) removed.push(l.trim());
      return false;
    });
    for (const r of gone) {   // 别处提到它的：以它开头的句子删掉，别的那一处换成〔〕
      const has = new RegExp(r.ref + '(?![0-9])'), all = new RegExp(r.ref + '(?![0-9])', 'g');
      L = L.flatMap(l => { if (!has.test(l)) return [l]; if (l.trim().startsWith(r.ref)) { removed.push(l.trim()); return []; } const n = l.replace(all, KF_HOLE); holed.push(n.trim()); return [n]; });
    }
    if (!bmk && sc.rows.size) L = kfPut(L, KeyFrames.lines(list));
    for (let i = L.length - 1; i >= 0; i--) if (/^【(参考素材职责|场景)】$/.test(kfKey(L[i])) && filled.has(kfKey(L[i])) && kfEmpty(L, i)) L.splice(i, L[i + 1] !== undefined && !L[i + 1].trim() ? 2 : 1);   // 原来有句子、这回删空了的组
    // 编号别留空号：出片任务书照编号挂素材，空一个号后面就全对错了
    const nums = new Set([...(L.join('\n').match(/@图片\d+/g) || []), ...list.map(x => x.ref)].map(r => +r.slice(3))), move = new Map();
    [...nums].sort((a, b) => a - b).forEach((n, i) => { if (n !== i + 1) move.set('@图片' + n, '@图片' + (i + 1)); });
    const mv = r => move.get(r) || r;
    if (move.size) L = L.map(l => l.replace(/@图片(\d+)/g, (m, d) => mv('@图片' + d)));
    list = list.map(x => ({ ...x, ref: mv(x.ref) }));
    if (bmk && list.length) L = L.map(l => l === '\u0000KF' ? BmKey.GROUP(list.map(x => x.ref)) : l);
    else if (bmk) L = kfBmBack(L, vids[0].ref);
    else if (move.size && list.length > 1) { const first = KeyFrames.lines(list)[0]; for (const [i, r] of KeyFrames.scan(L).rows) if (r === '') L[i] = first; }   // 挪过号的，顺序句照新编号再写一遍
    // 新的一版登记的素材：去掉弃用的，编号照挪过的；正文用着的先排，没用着的号撞上了就不要
    const inText = new Set(L.join('\n').match(/@(?:图片|视频|音频)\d+/g) || []), regs2 = [];
    const rest = regs.filter(r => !goneRefs.includes(r.ref)).map(r => ({ ...r, ref: /^@图片\d+$/.test(r.ref) ? mv(r.ref) : r.ref }));
    for (const r of [...rest.filter(x => inText.has(x.ref)), ...rest.filter(x => !inText.has(x.ref))]) if (!regs2.some(x => x.ref === r.ref)) regs2.push(r);
    return { lines: L, regs: regs2, gone: goneRefs, removed, holed, moved: move.size > 0 };
  }
  /* 出修改方案时给 AI 看的：这一条的关键帧图上写的批注（图名_批注.md，看大图时框出来写的）和标注图，审片时弃用的那几张图。room：还能给它看几张图 */
  async function kfNotesOf(j, frames, gone, room) {
    const out = [], images = [], said = [], seen = new Set();
    for (const f of [...gone, ...frames]) {
      if (seen.has(f.path)) continue;
      seen.add(f.path);
      const q = f.path.split('/').filter(Boolean), st = q[q.length - 1].replace(/\.[^.]+$/, ''), dir = q.slice(0, -1), isGone = gone.includes(f);
      const img = pj(j.项目, ...q), note = pj(j.项目, ...dir, st + '_批注.md'), mark = pj(j.项目, ...dir, st + '_批注截图', '标注图.jpg');
      if (isGone && images.length < room && await exists(img)) { images.push(img); said.push('弃用的关键帧 ' + f.ref + '（' + q[q.length - 1] + '）'); }
      if (!(await exists(note))) continue;
      out.push('### ' + f.ref + '（' + f.path + '）' + (isGone ? '，这张弃用了' : ''), unbom(await fsp.readFile(note, 'utf8')).trim().slice(0, 3000));
      if (images.length < room && await exists(mark)) { images.push(mark); said.push(f.ref + ' 的标注图（框出来的地方）'); }
    }
    return { text: out.length ? '\n## 关键帧图上的批注（用户在关键帧图上框出来写的，说的是这张图哪里不对）\n' + out.join('\n') : '', images, said };
  }
  function framePart(frames, how, bmk) {   // 任务书里讲关键帧的那一段；bmk：这一条还挂了白模
    if (!frames.length) return '';
    return ['', '## 这一条挂的关键帧（按先后）', ...frames.map((f, i) => (f.ref ? f.ref : '第 ' + (i + 1) + ' 张') + '：' + (f.path || f)), bmk ? FRAME_HOW_BMK : FRAME_HOW, how].join('\n');
  }
  /* 白模旁边同名的「_说明.md」：人写的（几何体各是什么、几个镜头），切点一镜一行「镜头1：0-4秒」 */
  async function bmNote(j, v) {
    const abs = pj(j.项目, ...v.path.split('/')), note = abs.replace(/\.[^.]+$/, '') + '_说明.md';
    const text = (await exists(note)) ? unbom(await fsp.readFile(note, 'utf8')).trim() : '';
    return { abs, note, text, cuts: BmKey && text ? BmKey.cutsOf(text) : [] };
  }
  /* 白模＋关键帧的写法（2026-11-14 他定：照官方《Doubao Seedance 2.5 提示词指南》「粗粒度白模 + 阶段关键帧」）。frames：[{ ref }]，编号还没定的给 null */
  function bmkHow(v, frames, cuts, secs) {
    const refs = frames && frames.length && frames.every(f => f.ref) ? frames.map(f => f.ref) : '@图片A至@图片B';
    return ['', '## 白模＋关键帧的写法（这一条既挂白模又挂关键帧：照官方指南，和普通写法不一样）',
      '不用 sd25-pe 的关键帧锚点句（「以……的顺序作为关键帧」「@图片N作为首帧」「该首帧定义……」「@图片N定义第几个关键帧」），也不写「' + v + '是粗粒度白模参考……」那一句。',
      '① 素材里写这三句，一字照抄' + (typeof refs === 'string' ? '（A、B 换成这几张关键帧的编号，编号不连着就用顿号一个个列）' : '') + '：',
      '「' + BmKey.LEAD(v) + '」', '「' + BmKey.GROUP(refs) + '」', '「' + BmKey.END(v) + '」',
      '写法一都放【参考素材职责】：白模那句、几何体对应、关键帧那句排最前面，收尾那句放这一组最后。写法二：关键帧那句放【场景】最前面；白模那句、几何体对应放【动作与声音】最前面，收尾那句放【动作与声音】最后。',
      '几何体各对应谁照白模说明写成「' + v + '中的……对应……。」，说明里没写到的写「' + BmKey.MAP(v) + '」留给人填，不要猜。',
      '② 事件脚本一镜一行，镜头和白模的镜头一样多、先后一样。每一镜开头先写它在白模里的整秒和参考哪张关键帧，再写这一镜的戏：「镜头1：0-4秒，首帧参考@图片N。……」；后面的镜头写「开场参考@图片N」，名字带尾帧的写「结尾参考@图片N」，这一镜没有关键帧的只写秒数（「镜头3：6-8秒。……」）。',
      '③ 秒数只写整数：' + (cuts.length ? '照白模说明里的切点（' + cuts.map(c => '镜头' + c.no + ' ' + c.a + '-' + c.b + '秒').join('、') + '）' : '白模说明里没有切点，就写成「〔起〕-〔止〕秒」留给人填，不要自己猜') + '；第一镜从 0 起，一镜接着一镜，最后一镜到白模结束' + (secs ? '（白模 ' + secs.toFixed(1) + ' 秒）' : '') + '。别处「不写时长秒数」的规矩不管每一镜开头这几个秒数。'].join('\n');
  }
  /* 任务书里讲白模的那一段：挂了哪段、多长；白模旁边有同名的「_说明.md」（人写的：几何体各是什么、几个镜头）就带上。
     frames：这一条挂的关键帧（[{ ref }]，编号还没定的给 [null…]），有就照「白模＋关键帧」的写法 */
  async function bmPart(j, vids, frames = []) {
    if (!vids.length) return '';
    const out = ['', '## 这一条挂的白模视频'];
    let first = null;
    for (const v of vids) {
      const n = await bmNote(j, v), secs = await vidSecs(n.abs);
      out.push(v.ref + '：' + v.path + (secs ? '，时长 ' + secs.toFixed(1) + ' 秒' : ''));
      if (n.text) out.push('白模说明（' + path.basename(n.note) + '）：', n.text.slice(0, 4000));
      if (!first) first = { ...n, secs };
    }
    if (frames.length && BmKey) { out.push(bmkHow(vids[0].ref, frames.every(Boolean) ? frames : null, first.cuts, first.secs)); return out.join('\n'); }
    out.push('写法照 sd25-pe「白模参考与渲染」：白模是生成参考，不是编辑母版；先判断粗粒度还是细粒度；写明只采用它的什么（动作路径、站位、机位、运镜、切镜……），不采用白模外观、材质和场景；几何体逐个对应到最终的人物或道具。',
      '几何体各对应谁：照上面的白模说明写；没有说明、或说明里没写到的，写成「' + vids[0].ref + '中的〔哪个白模几何体〕对应〔哪个人物或道具〕。」留给人填，不要猜。镜头的切分和长短照白模，不另编。');
    return out.join('\n');
  }
  /* 这一场的材料：设定、段落、剧本、镜头表（有就带上），和能挂的图 */
  async function ctxOf(j) {
    const flow = await readFlow(j.项目).catch(() => null), s = flow ? sceneOf(flow, j.段) : null, sp = scriptPath(j.项目, j.段), hp = shotsPath(j.项目, j.段);
    const text = [flow ? '## 全片的设定\n' + settingText(flow) : '', s ? '\n## 这一场：第' + j.段 + '段｜' + str(s.名).trim() + '\n' + sceneText(flow, s) : '',
      (await exists(sp)) ? '\n## 定稿的剧本\n' + await docText(sp) : '', (await exists(hp)) ? '\n## 镜头表\n' + await docText(hp) : ''].filter(Boolean).join('\n');
    return { text: text || '（这一场还没有剧本和镜头表）', assets: s ? sceneAssets(flow, s) : await poolAssets(j), s };
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
        const regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, ctx.s);   // 这一条挂的白模、关键帧：也算能用的素材（素材登记可以写它），任务书里另说怎么写
        for (const v of vids) assets.push({ line: '白模视频（这一条已经挂成 ' + v.ref + '）：' + v.path, path: v.path });
        for (const f of frames) assets.push({ line: '关键帧（这一条已经挂成 ' + f.ref + '）：' + f.path, path: f.path });
        j.assets = assets.map(x => x.path);
        j.images = frameImgs(j, frames);
        const bmk = vids.length > 0 && frames.length > 0 && !!BmKey;   // 既挂白模又挂关键帧：照官方「白模＋关键帧」的写法（11-14）
        const look = await lookPart(j.项目, null, ctx.s, '写', '全片光影总基调'), lessons = await lessonsOf(j.项目), geo = await geoOf(j.项目, j.段, ctx.s), bm = await bmPart(j, vids, frames)
          + framePart(frames, bmk ? '素材建议里白模、关键帧、收尾那三句照原样留着（编号和先后都不改），还是 sd25-pe 关键帧锚点句的换成这三句；每一镜开头的秒数和参考哪张由人定，分镜建议的正文不带秒数。'
            : '素材建议里关键帧那几句照原样留着（顺序句、首帧尾帧、第几个关键帧；编号和先后都不改）；还留着〔〕的，照图把这一刻看得见的构图、人物位置、姿态、镜头方向填上（图已经让你看过），别的字不动。', bmk);
        const pe = isPeText(raw) || !raw.trim();   // 新稿都是 sd2.5PE 格式；11-13 以前的旧稿照旧格式给建议
        const head = pe ? ['# 任务：给正在写的提示词提供侧栏建议', '', '今天 ' + today() + '。这份稿照 sd25-pe 的格式写。用户自己写【生成目标】和【事件脚本】里的镜头，事件脚本采用' + j.suggestionMode + '模式，自行决定镜头数量、顺序和正文。生成目标、素材、基础设定、主体与关系、保持一致是共用的公共内容，不随写法切换。你只提供备选建议，用户点击采用以后才进入正文。',
          '', '## 要求', '1. 不重写整份稿，不要求用户按固定段落或镜头数量写，不把剧本段落机械映射成镜头。格式照下面「提示词格式」，戏照「写戏规矩」。',
          '2. 分镜建议给二到四个有帮助的思路，每项包含标题、作用和可采用的正文（正文是一镜的一句话，不带「镜头N：」，页面会自己编号），以及按机位、动作、台词分组的关键词；不要复述已有内容。对空白稿也只提供建议，不预填或代替用户定结构。',
          '3. 基础建议给公共区提供可选文本，可留空：「生成目标」一两句；「素材」写整段、带段名（写法一从【参考素材职责】起，挂了没用上的接【未采用素材】；写法二从【人物】起，按【人物】【道具】【场景】【动作与声音】分组）；「主体与关系」只在写法一给，写法二把这些写进素材的【人物】【场景】里；「基础设定」写「影像风格：……」「摄影：……」「光色基调：……」三行，再加一行「声音包括……。」（这一行存的时候跟在事件脚本最后）；「保持一致」写「保持……稳定。」。现有公共内容已合适就不必改。资产只能选下面给出的文件；素材登记记录建议里使用的素材，不能自行改用户已用的编号。',
          '4. 关键词每条不超过十个字。台词只用剧本里已有原话，长句写成 {"show":"台词提示","t":"台词原话","tip":"出处"}，没有台词就不提供。已有镜头的关键词以当前镜头号为键（如 "1"）；自由写的事件脚本以“自由”为键。',
          '5. 回复一个 JSON 对象，不附加说明。结构如下：',
          '{"分镜建议":[{"标题":"建议标题","作用":"想达到什么效果","正文":"可以插入的一句话","关键词":{"机位":["…"],"动作":["…"]}}],"基础建议":{"生成目标":"","素材":"","基础设定":"","主体与关系":"","保持一致":""},"关键词":{"1":{"动作":["…"]}},"素材登记":[{"ref":"@图片1","name":"称谓","path":"资产/……png"}]}']
          : ['# 任务：给正在写的提示词提供侧栏建议', '', '今天 ' + today() + '。用户只在分镜部分采用' + j.suggestionMode + '模式，自行决定镜头数量、顺序、标题、作用和正文。本段事件、素材、基础设定、本段、保持一致是共用的公共内容，不随分镜写法切换。你只提供备选建议，用户点击采用以后才进入正文。',
          '', '## 要求', '1. 不重写整份稿，不要求用户按固定段落或镜头数量写，不把剧本段落机械映射成镜头。这份是 11-13 以前的旧格式稿，照它原来的格式（本段事件、素材、基础设定、本段、分镜、保持一致）给建议；写法照 sd25-pe 和下面的「写戏规矩」。',
          '2. 分镜建议给二到四个有帮助的思路，每项包含标题、作用和可采用的正文，以及按机位、动作、台词分组的关键词；不要复述已有内容。对空白稿也只提供建议，不预填或代替用户定结构。',
          '3. 基础建议给公共区的本段事件、素材、基础设定、本段、保持一致提供可选文本。可留空。现有公共内容已合适就不必改，不因分镜采用自由文本而忽略或重建公共区。资产只能选下面给出的文件；素材登记记录建议里使用的素材，不能自行改用户已用的编号。',
          '4. 关键词每条不超过十个字。台词只用剧本里已有原话，长句写成 {"show":"台词提示","t":"台词原话","tip":"出处"}，没有台词就不提供。已有镜头的关键词以当前镜头号为键；自由分镜以“自由”为键。自由分镜不要求逐镜编号或作用字段，公共区仍共用。',
          '5. 回复一个 JSON 对象，不附加说明。结构如下：',
          '{"分镜建议":[{"标题":"建议标题","作用":"想达到什么效果","正文":"可以插入的文字","关键词":{"机位":["…"],"动作":["…"]}}],"基础建议":{"本段事件":"","素材":"","基础设定":"","本段":"","保持一致":""},"关键词":{"01":{"动作":["…"]}},"素材登记":[{"ref":"@图片1","name":"称谓","path":"资产/……png"}]}'];
        return [...head,
          '', '## 当前草稿（原样保留，仅供参考）', raw || '（空白稿）',
          shotInfo(side).length ? '\n## 用户自定的镜头作用\n' + JSON.stringify(shotInfo(side).map(x => ({ no: x.no, 作用: x.作用 }))) : '',
          '', '## 能用的资产', assets.map(x => x.line).join('\n') || '（没有）', bm, other ? '\n## 本项目其他段写过的画面风格（旧稿是基础设定，11-13～11-14 的稿是「最终画面采用……」一行，11-14 起是【基础设定】；照它统一，和这部片子定的拍摄风格对不上的以拍摄风格为准）\n' + other.lines.join('\n') : '',
          look, geo.length ? '\n## 已有场景空间资料\n' + geo.map(x => x.text).join('\n') : '',
          '', ctx.text, lessons ? '\n## 项目历史教训\n' + lessons : '', '', ...(pe ? [PE_FORMAT, ''] : []), PE_DRAMA, '', '## 技能：sd25-pe', await skill('sd25-pe'), TAIL].join('\n');
      },
      async apply(j, text) {
        const data = recordOf(jsonIn(text));
        const suggestions = (Array.isArray(data.分镜建议) ? data.分镜建议 : []).filter(x => x && typeof x === 'object').map(x => ({ 标题: str(x.标题).trim(), 作用: str(x.作用).trim(), 正文: str(x.正文).trim(), 关键词: kwNorm(x.关键词) })).filter(x => x.正文 || x.标题).slice(0, 8);
        const basic = {};
        for (const key of ['本段事件', '生成目标', '素材', '基础设定', '画面与声音', '本段', '主体与关系', '保持一致']) {   // 旧稿、PE 稿的分区名都认；空的不留
          const value = recordOf(data.基础建议)[key];
          const v = Array.isArray(value) ? value.filter(x => typeof x === 'string').join('\n') : str(value);
          if (v.trim()) basic[key] = v;
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
        const shotName = sh ? '镜头' + (cur.fmt === 'pe' ? sh.no + (info && str(info.标题) ? '｜' + str(info.标题) : '') : ' ' + sh.no + '｜' + sh.title) : '';
        return ['# 任务：给提示词几个可选关键词', '', '今天 ' + today() + '。用户在写' + (free ? '自由分镜文本' : shotName) + '，想要几个关键词提示。只提供选项，由用户主动采用。素材等公共区不随写法切换。',
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
        const raw = unbom(await fsp.readFile(vpPath(j), 'utf8')), pe = isPeText(raw), regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, s);
        const bmk = vids.length > 0 && frames.length > 0 && !!BmKey;   // 既挂白模又挂关键帧：照官方「白模＋关键帧」的写法批（11-14）
        const bm = await bmPart(j, vids, frames) + framePart(frames, '图已经让你看过。', bmk);
        j.images = frameImgs(j, frames);
        return ['# 任务：给一份视频提示词写批注（只批不改）', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是一场戏的 Seedance 视频提示词（' + (pe ? '生成目标和事件脚本' : '本段事件和分镜') + '多半是人自己写的），和这一场的剧本（老项目有镜头表的也带上）。请你当一个懂 Seedance 的编辑，给它写批注。' + (j.只批 ? '这一回只批「镜头 ' + j.只批 + '」这一镜。' : ''),
          '', '## 怎么批', '1. 最多 8 条，要紧的排在前面。只批不改：稿子一个字都不动，你只写批注。写得好的地方不用夸，没问题就少写。',
          '2. 看这几样：和剧本对不对得上（漏戏、加戏、顺序）；人物想干什么、为什么这么反应写清楚没有（前因后果连不连得上）；一镜是不是只讲一两件事；有没有写一直不变的表情姿势、画面里没有的东西、时长秒数。' + (side.写法 === '自由' ? '用户只把分镜写成自由文本，不因分镜未逐镜分栏、缺少编号或作用字段批评格式。素材等公共区仍然共用，照实际内容核对。' : '镜头数量、顺序、标题和作用由用户决定，不要求镜头与剧本段落一一对应。') + '人物的戏照「写戏规矩」看。',
          ...(bmk ? ['   这一条既挂白模又挂关键帧（见下面「白模＋关键帧的写法」）：看素材里有没有那三句、几何体各对应谁填了没有；每一镜开头有没有写它在白模里的整秒和参考哪张，秒数是不是整数、一镜接着一镜、和白模的切点对得上（每一镜开头的这几个秒数不算「写了时长秒数」）；还在用 sd25-pe 关键帧锚点句、「@视频N是粗粒度白模参考」那一句的，要提醒换掉；参考的关键帧和那一镜的戏对不对得上；图里画了爆炸、烟、火这类会动的东西，挂上会被钉住不动，也要提醒。']
            : [...(vids.length ? ['   这一条挂了白模（见下面「这一条挂的白模视频」）：还要看素材里有没有照 sd25-pe 写白模那几句（只采用什么、不采用白模外观材质场景、几何体各对应谁），还留着〔〕没填的要提醒。'] : []),
              ...(frames.length ? ['   这一条挂了关键帧（见下面「这一条挂的关键帧」）：看关键帧那几句照 sd25-pe 写了没有（顺序句、首帧尾帧的角色句、第几个关键帧），定义的状态和图、和事件脚本那一镜的开场对不对得上，还留着〔〕没填的要提醒；图里画了爆炸、烟、火这类会动的东西，挂上会被钉住不动，也要提醒。'] : [])]),
          '3. 每条要具体、能照着改，用大白话，批注和原因各一句。能给出替换的句子就写「改成」（只写一行：替换「原文」那句话的新句子，照抄就能用）；只是提醒就不写「改成」这一行。',
          ...(pe ? ['4. 「原文」要从稿子里一字不差地抄一句：【生成目标】下面的话、某一镜「镜头N：」后面的一句、或者素材、主体与关系、保持一致里的一整行，好让页面找到它在哪。不要抄「镜头N：」这几个字，不要抄【】段名那一行。',
            '   这一处还空着、没有原文可抄的（比如某一镜还没写、生成目标没写）：不写「原文」和「改成」，在「批注」里直接给一句建议的写法。是对整份的意见，位置写「整体」，不写原文。',
            '5. 回复照这个样子，别的都不要：', '总评：一句话', '## 1', '- 位置：镜头1（或者 生成目标、素材、基础设定、主体与关系、保持一致、整体）']
          : ['4. 「原文」要从稿子里一字不差地抄：「本段事件：」后面的话、某一镜标题下面正文里的一句、或者素材、基础设定、本段、保持一致里的一整行，好让页面找到它在哪。不要抄镜头标题那一行（「镜头 01｜……」），不要抄「本段事件：」这几个字。',
            '   这一处还空着、没有原文可抄的（比如某一镜只有标题、本段事件没写）：不写「原文」和「改成」，在「批注」里直接给一句建议的写法。是对整份的意见，位置写「整体」，不写原文。',
            '5. 回复照这个样子，别的都不要：', '总评：一句话', '## 1', '- 位置：镜头 01（或者 本段事件、素材、基础设定、本段、保持一致、整体）']), '- 级别：要改（或者 提醒）', '- 类别：对剧本（或者 写法、格式、资产、合理性）', '- 原文：稿子里的原话', '- 批注：一句', '- 原因：一句', '- 改成：整句替换的话', '## 2', '……',
          '', '## 提示词（文件：' + j.名 + '）', raw, bm, await lookPart(j.项目, flow, s, '批', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'),
          s ? '\n## 这一场的段落\n' + sceneText(flow, s) : '', (await exists(sp)) ? '\n## 剧本\n' + await docText(sp) : '', (await exists(hp)) ? '\n## 镜头表\n' + await docText(hp) : '', lessons ? '\n## 这个项目的历史教训（批的时候记着）' + lessons : '',
          '', ...(pe ? [PE_FORMAT, ''] : []), PE_DRAMA, '', '## 技能：sd25-pe', await skill('sd25-pe'), TAIL].join('\n');
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
          const title = /^镜头\s*[0-9０-９]+\s*[｜|]/, peShot = /^镜头\s*[0-9０-９]+\s*[：:]\s*/;
          if (g.原文 && peShot.test(g.原文)) { g.原文 = g.原文.replace(peShot, ''); if (g.改成) g.改成 = g.改成.replace(peShot, ''); }   // PE 稿的一镜：页面的框里没有「镜头N：」，抄进来的去掉
          if (g.原文 && (title.test(g.原文) || /^本段事件[：:]\s*$/.test(g.原文) || /^【[^】]+】$/.test(g.原文.trim()) || g.原文.includes('\n'))) {
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
        await writeFile(pj(j.项目, ...rel), '总评：' + (sum || '见下面几条。') + '\n\n' + parts.map((p, i) => '## ' + (i + 1) + '\n' + p).join('\n\n') + '\n\n（' + nowText() + '　' + chLabel(j) + ' 批的' + (j.只批 ? '，只批了镜头 ' + j.只批 : '') + '）\n');
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
        const sp = scriptPath(j.项目, j.段), regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, null), bmk = vids.length > 0 && frames.length > 0 && !!BmKey;   // 既挂白模又挂关键帧：照官方「白模＋关键帧」的写法改（11-14）
        return ['# 任务：按批注改视频提示词', '', '今天 ' + today() + '。下面是一份 Seedance 视频提示词的原文，和人写的批注。请照批注改。',
          '', '## 要求', '1. 只改批注说到的地方，别的一个字都不动。批注里的「原文」照抄了要改的那一行；「原文（第N处）」指全文第 N 处一样的文字；「整体」是对整份的意见。',
          '2. 批注要是把原文抄下来改过的，就是要这一行改成批注里写的样子，照抄批注，不要再润色；批注里那句话末尾没打标点的，沿用原句末尾的标点。',
          '3. 批注是提要求的（比如「这句太夸张」「素材写多了」），就照要求改，改动尽量小；写法照 sd25-pe 和下面的「提示词格式」「写戏规矩」，稿子是旧格式（「本段事件：」开头的）就照它原来的格式改。',
          '4. 回复一段 JSON：一处改动一项。「原文」是要换掉的那一整行，从原文里一字不差地抄；「第几处」是全文第几处一样的行（只有一处就写 1）；「改成」是新的一整行，要拆成几行就用 \\n 隔开，要删掉这一行就写空字符串。像这样：',
          '[{"原文": "要换掉的那一整行", "第几处": 1, "改成": "新的一整行"}]',
          '', '## 原文（文件：' + j.名 + '）', unbom(await fsp.readFile(vpPath(j), 'utf8')), await bmPart(j, vids, frames),
          framePart(frames, bmk ? '白模、关键帧、收尾那三句和每一镜开头的秒数、参考哪张，批注没说到的不动；批注要换成「白模＋关键帧」的写法，就照上面那一段换。' : '关键帧那几句的编号和先后别改，批注没说到的不动。', bmk), await lookPart(j.项目, null, sceneOf((await readFlow(j.项目).catch(() => null)) || {}, j.段), '改', '全片的光影总基调（批注说到画面味道时照它改）'), '', '## 批注', unbom(await fsp.readFile(pj(j.项目, ...j.rel), 'utf8')),
          (await exists(sp)) ? '\n## 这一场的剧本（对照用）\n' + await docText(sp) : '', '', PE_FORMAT, '', PE_DRAMA, '', '## 技能：sd25-pe', await skill('sd25-pe'), TAIL].join('\n');
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
    /* ---------- 工序五：审片以后照批注改提示词（2026-11-14 他定）：先让 AI 出修改方案（这一回不改稿）→ 人在审片台「方案」那一页逐条定 → 照方案改，
       另存一份「原名_改N.txt」，原稿不动。方案：成片/第N段/视频名_修改方案.md（AI 出的）；人定的：视频名_修改方案_批注.md（审片台写的），两样跟着样片走 ---------- */
    修改方案: {
      title: j => '修改方案 · 第' + j.段 + '场 ' + str(j.视频), need: ['段'], key: j => j.段 + '/' + j.视频,
      async prep(j) {
        const v = str(j.视频), np = pj(j.项目, '成片', segDir(j.段), stemOf(v) + '_批注.md');
        if (!nameOk(v) || !VIDEO_RE.test(v)) throw fail('样片的名字不对');
        if (!(await exists(np))) throw fail('这条样片还没有批注：先在审片台写批注');
        j.名 = await srcOfClip(j, unbom(await fsp.readFile(np, 'utf8')));
      },
      async book(j) {
        const v = str(j.视频), np = pj(j.项目, '成片', segDir(j.段), stemOf(v) + '_批注.md'), notes = unbom(await fsp.readFile(np, 'utf8'));
        const flow = await readFlow(j.项目).catch(() => null), s = flow ? sceneOf(flow, j.段) : null, sp = scriptPath(j.项目, j.段);
        const regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, s), bmk = vids.length > 0 && frames.length > 0 && !!BmKey, lessons = await lessonsOf(j.项目);
        j.images = await shotsIn(j, notes, path.dirname(np));   // 写批注时停住的那几帧：让 AI 先看看用户看到的样子
        const shotN = j.images.length, gf = goneFrames(notes, regs), kn = await kfNotesOf(j, frames, gf.list, 10 - shotN);   // 弃用的关键帧、关键帧图上写的批注（图一起给它看）
        j.images = [...j.images, ...kn.images];
        const said = '让你看过的图依次是：' + [shotN ? '写批注时停住的 ' + shotN + ' 帧截图' : '', ...kn.said].filter(Boolean).join('；') + '。先对着图看懂批注说的是哪里。';
        const pe = isPeText(unbom(await fsp.readFile(vpPath(j), 'utf8')));
        return ['# 任务：照审片批注出一份修改方案（这一回不改稿）', '', '今天 ' + today() + '。这是一个 AI 短视频项目，用 Seedance 2.5 出片。用户看完一条样片，写了下面的批注。请照批注出一份修改方案给用户审：每一条说清片子哪里不对、为什么会这样、提示词怎么改。用户看过、批过，才照方案正式改，改出来另存一份新的，所以这一回不改稿。',
          ...(j.images.length ? [kn.images.length ? said : '写批注时停住的那几帧截图已经让你看过了：先对着截图看懂批注说的是哪里。'] : []),
          '', '## 要求', '1. 一条批注出一条方案；几条批注说的是同一个毛病，可以并成一条。一句话只在一条方案里改。最多 8 条。',
          '2. 先想清楚原因再开方子：是提示词哪一句写得不对、没写到，还是 Seedance 的老毛病（参考图压过文字、快动作给的时间长了会慢放、带人的首帧开头半秒几乎不动……下面的历史教训里有），还是这一条没抽好、东西都不用改（重出一条就行）。',
          '3. 能在提示词里改的，写「原文」和「改成」：「原文」从下面的稿子里一字不差地抄要换掉的那一句（可以是一整行，也可以是一行里的一句，要在全文里只出现一次）' + (pe ? '，不要抄「镜头N：」、秒数和【】段名' : '') + '；「改成」写换上去的话，照抄就能用；要删掉这一句就写「改成：（删掉）」；要加一句，「原文」抄它前面那一句，「改成」写那一句再接上新的。',
          '4. 改法照 sd25-pe 和下面的「提示词格式」「写戏规矩」。不写「没有……」「不要出现……」这类负断言（会把东西请进画面），要写成画面里有什么、人要干什么。不加新的 @图片、@视频 编号；镜头号、每一镜开头的秒数、关键帧那几句不动，除非批注说的就是它们。',
          '5. 不在提示词里改的（长相、衣服、道具的样子不对，要回资产改图；台词要改，要回剧本；这一条只是没抽好，重出就行），「位置」写「不改提示词」，「怎么改」写回哪一道工序、做什么，不写「原文」「改成」。' + (kn.text ? '关键帧图哪里画得不对（下面「关键帧图上的批注」）：照方案改的时候，字改完以后 AI 会把这一条的关键帧一张张看过，照图上的批注小改或者重出，也算不改提示词；提示词里跟着要改的句子照常写。' : ''),
          ...(gf.list.length ? ['   批注里写了「弃用关键帧」的，是用户不要这张图了：照方案改的时候，字改完以后 AI 照新稿重出一张换上；弃用的理由说这一镜不要关键帧的，就从新稿里拿掉（它自己那几句删掉、后面的编号往前挪）。不用为它写「原文」「改成」，讲关键帧的那几句别动。理由里说到这一刻的戏要变（站位、动作、机位），提示词里那一镜跟着要改的字照常写「原文」「改成」。'] : []),
          '6. 用大白话。问题、原因、怎么改各一句。',
          '7. 回复照这个样子，别的都不要：', '总的看法：一两句', '## 1', '- 批注：1（对应第几条批注，几条就写 1、3；对整条片子的意见写 整体）', '- 位置：' + (pe ? '镜头2（或者 生成目标、素材、基础设定、主体与关系、保持一致、整体、不改提示词）' : '镜头 02（或者 本段事件、素材、基础设定、本段、保持一致、整体、不改提示词）'),
          '- 问题：片子里哪里不对', '- 原因：为什么会这样', '- 怎么改：一句大白话', '- 原文：稿子里的原话', '- 改成：换上去的话', '## 2', '……',
          '', '## 审片批注', notes, kn.text, '', '## 提示词（文件：' + j.名 + '；这条样片就是照它出的）', unbom(await fsp.readFile(vpPath(j), 'utf8')),
          await bmPart(j, vids, frames), framePart(frames, '', bmk), await lookPart(j.项目, flow, s, '审', '全片的光影总基调'),
          s ? '\n## 这一场的段落\n' + sceneText(flow, s) : '', (await exists(sp)) ? '\n## 剧本\n' + await docText(sp) : '', lessons ? '\n## 这个项目的历史教训（开方子的时候记着）' + lessons : '',
          '', ...(pe ? [PE_FORMAT, ''] : []), PE_DRAMA, '', '## 技能：sd25-pe', await skill('sd25-pe'), TAIL].join('\n');
      },
      async apply(j, text) {
        const t = body(text).replace(/\r\n/g, '\n'), sum = ((/^总的看法[：:][ \t]*(.+)$/m.exec(t) || [])[1] || '').trim();
        const lines = unbom(await fsp.readFile(vpPath(j), 'utf8')).split(/\r\n|\n|\r/);
        const items = planItems(t).map(it => {
          if (it.原文 != null) {   // 原话在稿子里找不到（或者找到好几处）：照不了，改成只给建议，免得正式改的时候对错地方
            if (it.原文.includes('\n') || !applyOne(lines, it.原文, it.改成 || '') || it.原文.trim() === str(it.改成).trim()) {
              if (it.改成 && it.原文.trim() !== it.改成.trim()) it.怎么改 = (it.怎么改 ? it.怎么改 + ' ' : '') + '建议写：' + it.改成.replace(/\n/g, ' ');
              delete it.原文; delete it.改成;
            }
          }
          return it;
        }).filter(it => it.问题 || it.怎么改 || it.原文 != null).slice(0, 8);
        if (!items.length) throw fail('AI 没按要的格式回（要「总的看法」和一条一节的方案）');
        items.forEach((it, i) => { it.no = i + 1; });   // 去掉了空的几条：号重新连着编（你定的时候照这个号记）
        const dir = ['成片', segDir(j.段)], stem = stemOf(str(j.视频)), rel = [...dir, stem + PLAN_TAIL], stamp = stampOf();
        await archive(j.项目, rel, stamp); await archive(j.项目, [...dir, stem + PLAN_NOTE_TAIL], stamp);   // 上一回的方案和你批的一起收进历史记录
        const md = ['# 修改方案｜' + j.视频, '', '视频：' + [...dir, j.视频].join('/'), '提示词：' + ['提示词', segDir(j.段), j.名].join('/'), '批注：' + [...dir, stem + '_批注.md'].join('/'), '出方案：' + nowText() + '　' + chLabel(j), '',
          'AI 照审片批注出的修改方案，还没改稿。在审片台「方案」那一页逐条定：照这样改、不改，或者写你的意见；定好点「照方案改」，另存成「' + vpBase(j.名).replace(/\.txt$/, '') + '_改N.txt」，原稿不动。', '',
          '总的看法：' + (sum || '见下面几条。'), '', ...items.flatMap(it => [planText(it), ''])].join('\n');
        await writeFile(pj(j.项目, ...rel), md);
        return { 结果: 'AI 出了 ' + items.length + ' 条修改方案：在审片台「方案」那一页看、逐条定', 产出: [rel.join('/')] };
      },
    },
    按方案改提示词: {
      title: j => '照方案改 · 第' + j.段 + '场 ' + str(j.视频), need: ['段'], key: j => j.段 + '/' + vpBase(str(j.名)), file: j => j.段 + '/' + vpBase(str(j.名)),
      async prep(j) {
        const v = str(j.视频), pp = pj(j.项目, '成片', segDir(j.段), stemOf(v) + PLAN_TAIL);
        if (!nameOk(v) || !VIDEO_RE.test(v)) throw fail('样片的名字不对');
        if (!(await exists(pp))) throw fail('这条样片还没有修改方案：先让 AI 出一份');
        const plan = parsePlan(unbom(await fsp.readFile(pp, 'utf8'))), src = path.basename(plan.提示词.replace(/\\/g, '/'));
        if (!nameOk(src) || !RE_VP.test(src) || !(await exists(pj(j.项目, '提示词', segDir(j.段), src)))) throw fail('方案照的那份提示词（' + (src || '没写') + '）不在了');
        if (plan.done.length && j.重写 !== '再改一份') throw fail('这份方案已经照着改过了（' + plan.done[plan.done.length - 1] + '）');
        j.名 = src;
      },
      async run(j) {
        const seg = segDir(j.段), stem = stemOf(str(j.视频)), dir = pj(j.项目, '成片', seg), planP = path.join(dir, stem + PLAN_TAIL), noteP = path.join(dir, stem + PLAN_NOTE_TAIL);
        const planMd = unbom(await fsp.readFile(planP, 'utf8')), plan = parsePlan(planMd), dec = (await exists(noteP)) ? parsePlanNote(unbom(await fsp.readFile(noteP, 'utf8'))) : { items: new Map(), general: '' };
        const raw = await fsp.readFile(vpPath(j), 'utf8'), bom = raw.charCodeAt(0) === 0xFEFF, eol = /\r\n/.test(raw) ? '\r\n' : '\n';
        let lines = (bom ? raw.slice(1) : raw).split(/\r\n|\n|\r/);
        const auto = [], ask = [];
        for (const it of plan.items) {   // 你同意的照方案原样换上（不经 AI，一字不改）；写了意见的、原话找不到的交给 AI
          const d = dec.items.get(it.no) || {}, say = str(d.批注).trim(), how = d.定 || (it.原文 != null ? '照这样改' : '知道了');
          if (how === '不改' || (how !== '照我说的改' && it.原文 == null)) continue;
          if (how === '照这样改' && it.原文 != null) {
            const got = applyOne(lines, it.原文, it.改成 || '');
            if (got) { lines = got; auto.push(it); } else ask.push({ it, say: '', miss: true });
            continue;
          }
          if (say) ask.push({ it, say });
        }
        const notesMd = await fsp.readFile(path.join(dir, stem + '_批注.md'), 'utf8').then(unbom, () => ''), regs0 = await regOf(j), gf = goneFrames(notesMd, regs0);   // 审片时弃用的关键帧：字改完以后，关键帧那一段重出或拿掉
        const general = str(dec.general).trim(), changes = auto.map(it => '- 照方案：「' + it.原文 + '」→「' + (it.改成 || '（删掉）') + '」');
        const step = (名, 说, 态) => {   // 做到哪一步（审片台照它一行一行摆）：态 在做 / 做完 / 没成 / 空＝还没轮到
          const a = j.分步 || (j.分步 = []), x = a.find(y => y.名 === 名);
          if (x) Object.assign(x, { 说, 态 }); else a.push({ 名, 说, 态 });
          if (态 === '在做') j.步骤 = 说;
        };
        let aiN = 0;
        step('改字', auto.length ? '照方案换上了 ' + auto.length + ' 处' : '在看要改哪几处', '在做');
        if (ask.length || general) {
          const notes = await fsp.readFile(path.join(dir, stem + '_批注.md'), 'utf8').then(unbom, () => '');
          const regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, null), sp = scriptPath(j.项目, j.段);
          const book = ['# 任务：照修改方案和用户的意见改视频提示词', '', '今天 ' + today() + '。这是一个 AI 短视频项目。用户看完一条样片写了批注，AI 照批注出了一份修改方案，用户逐条定过了。' + (auto.length ? '用户同意的 ' + auto.length + ' 处已经照方案改进下面的稿子里了；' : '') + '「要你改的」这几条，是用户写了自己意见的，或者方案里的原话在稿子里没找到的。请只改这几条。',
            '', '## 要求', '1. 只改「要你改的」说到的地方，别的一个字都不动' + (auto.length ? '（已经照方案改好的那几处也不动）' : '') + '。', '2. 用户写了要改成的句子，就照抄，不要再润色；末尾没打标点的，沿用原句末尾的标点。用户只提了要求，就照要求改，改动尽量小。用户的意见和方案不一样的，听用户的。',
            '3. 写法照 sd25-pe 和下面的「提示词格式」「写戏规矩」，稿子是旧格式（「本段事件：」开头的）就照它原来的格式改。不加新的 @图片、@视频 编号；不写「没有……」「不要出现……」这类负断言。' + (gf.list.length ? '用户弃用了关键帧 ' + gf.list.map(r => r.ref).join('、') + '：你改完以后另外处理（照新稿重出一张换上，或者从新稿里拿掉），讲关键帧的那几句别动。' : ''),
            '4. 回复一段 JSON：一处改动一项。「原文」是要换掉的那一整行（或者一行里只出现一次的那一句），从下面的稿子里一字不差地抄；「第几处」是全文第几处一样的行（只有一处就写 1）；「改成」是换上去的话，要拆成几行就用 \\n 隔开，要删掉就写空字符串。像这样：',
            '[{"原文": "要换掉的那一句", "第几处": 1, "改成": "换上去的话"}]',
            '', '## 要你改的', ...ask.flatMap(({ it, say, miss }) => ['### 方案第 ' + it.no + ' 条（' + (it.位置 || '没写位置') + '）', it.问题 ? '- 方案说的问题：' + it.问题 : '', it.原因 ? '- 方案说的原因：' + it.原因 : '', it.怎么改 ? '- 方案的改法：' + it.怎么改 : '',
              it.原文 != null ? '- 方案要换的：原文「' + it.原文 + '」改成「' + (it.改成 || '（删掉）') + '」' : '', miss ? '- 方案里的原话在稿子里没找到（稿子可能后来改过）：用户同意照方案改，照方案的意思改' : '- 用户的意见：' + say].filter(Boolean)),
            ...(general ? ['### 用户对整份的意见（方案里没有、还要改的）', general] : []),
            '', '## 现在的稿子（文件：' + j.名 + (auto.length ? '，已经照方案改好了 ' + auto.length + ' 处' : '') + '；改好另存成新的一版）', lines.join('\n'),
            await bmPart(j, vids, frames), framePart(frames, '白模、关键帧那几句和每一镜开头的秒数，用户没说到的不动。', vids.length > 0 && frames.length > 0 && !!BmKey),
            '', '## 修改方案（对照用）', planMd, notes ? '\n## 审片批注（对照用）\n' + notes : '', (await exists(sp)) ? '\n## 这一场的剧本（对照用）\n' + await docText(sp) : '',
            '', PE_FORMAT, '', PE_DRAMA, '', '## 技能：sd25-pe', await skill('sd25-pe'), TAIL].join('\n');
          step('改字', chLabel(j) + ' 在改你说的 ' + (ask.length + (general ? 1 : 0)) + ' 处', '在做');
          const opsOf = t => { const a = t.indexOf('['), z = t.lastIndexOf(']'); try { return JSON.parse(t.slice(a, z + 1)); } catch (e) { throw fail('AI 没按要的格式回（要一段 JSON 列表）'); } };
          let ops = opsOf(await askText(j, j.渠道, book, '照方案改', [], fmtRetry(opsOf)));
          ops = (Array.isArray(ops) ? ops : []).filter(o => o && typeof o.原文 === 'string' && o.原文.trim() && typeof o.改成 === 'string');
          const miss = [];
          for (const o of ops) {
            const got = applyOne(lines, o.原文, o.改成, Math.max(1, Number(o.第几处) || 1));
            if (got) { lines = got; aiN++; changes.push('- 照你说的：「' + o.原文.trim() + '」→「' + (o.改成.trim() || '（删掉）') + '」'); } else miss.push(o.原文.trim().slice(0, 20));
          }
          if (miss.length) throw fail('AI 改的有 ' + miss.length + ' 处在稿子里没找到原话（「' + miss[0] + '…」），这回没存。再点一次「照方案改」');
        }
        step('改字', [auto.length ? '照方案 ' + auto.length + ' 处' : '', aiN ? '照你说的 ' + aiN + ' 处' : ''].filter(Boolean).join('，') || '字不用改', '做完');
        if (j.停) throw fail('停掉了');
        const wanted = !!general || gf.list.length > 0 || plan.items.some(it => (dec.items.get(it.no) || {}).定 !== '不改');
        if (!auto.length && !aiN && !wanted) throw fail('没有要改的：方案里每一条都选了「不改」');   // 都不改：关键帧也不用看
        /* 关键帧：AI 看、出、核，好了才换上（上面「照方案改：关键帧一起改到位」）。没出成的、要等白模的，和拿掉的一样从新稿里去掉 */
        const fl = await readFlow(j.项目).catch(() => null), s = fl ? sceneOf(fl, j.段) : null;
        const name = await nextVer(j.项目, seg, j.名), rel = ['提示词', seg, name];   // 新的一版叫什么：关键帧的字里「用途」要写
        const kf = await kfStage(j, { lines, regs: regs0, gone: gf.list, notesMd, planMd, plan, dec, s, name, changes, step }), fr = kf.frames;
        if (j.停) throw fail('停掉了');
        const stamp = stampOf(), swapped = [];
        for (const f of fr.filter(x => x.结果 === '换上')) {
          j.步骤 = '在换上新的关键帧';
          try { await kfSwap(j, f, stamp, name); swapped.push(f); step(f.步名, '换上了' + (f.核图 ? '，核图：' + f.核图 : ''), '做完'); }
          catch (e) { Object.assign(f, { 结果: '没出成', 为什么: '新图没换上：' + e.message }); step(f.步名, f.为什么, '没成'); }
        }
        const removes = fr.filter(f => f.结果 === '拿掉' || f.结果 === '没出成');
        let drop = null;
        if (removes.length) { j.步骤 = '在从新稿里拿掉 ' + removes.length + ' 张关键帧'; drop = await dropFrames(j, lines, regs0, removes.map(f => f.reg), s); lines = drop.lines; }
        if (!auto.length && !aiN && !drop && !swapped.length) throw fail((ask.length || general ? 'AI 说字没有要改的地方' : '字不用改') + (fr.length ? '，关键帧 AI 看过也都留着' : '，这一条也没挂关键帧') + '：没有存新的一版');
        const out = (bom ? BOMCH : '') + lines.join(eol);
        if (out === raw && !swapped.length) throw fail('改完和原稿一样，没有存');
        j.步骤 = '在存盘';
        await writeFile(pj(j.项目, ...rel), out);
        { const t = new Date(); for (const f of swapped) for (const p of f.touch) await fsp.utimes(p, t, t).catch(() => {}); }   // 新图、新字记成比新稿新：提示词那一步不会把它们标成「这一条改过，看一眼」
        const refs = [];   // 参考素材映射：照原稿登记的（映射里的，和写稿页挂的），给新的这一版也登记一份
        for (const r of drop ? drop.regs : await regOf(j)) {   // 拿掉了关键帧：编号照挪过的
          const q = r.path.split('/').filter(Boolean);
          if (!q.length || !(await exists(pj(j.项目, ...q)))) continue;
          const st = path.basename(r.path).replace(/\.[^.]+$/, '');
          refs.push({ ref: r.ref, name: r.name || (VIDEO_RE.test(r.path) ? st : st.split('_')[0]), path: r.path, sha256: sha256(await fsp.readFile(pj(j.项目, ...q))) });
        }
        const mp = pj(j.项目, '资产', '参考素材映射.json');
        await withFileLocks([mp], async () => {
          let map = null;
          try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { map = null; }
          map = map && typeof map === 'object' && !Array.isArray(map) ? map : { schema_version: 1, prompts: {} };
          map.prompts = map.prompts && typeof map.prompts === 'object' ? map.prompts : {};
          map.prompts[rel.join('/')] = { prompt_sha256: sha256(await fsp.readFile(pj(j.项目, ...rel))), references: refs };
          for (const f of swapped) {   // 别的提示词也挂着换下来的那张图：登记的 SHA-256 换成新图的（和「用这张」一样，那几条会标待核对）
            const hex = sha256(await fsp.readFile(pj(j.项目, ...f.path.split('/'))));
            for (const [k, v] of Object.entries(map.prompts)) {
              if (k.startsWith('提示词/' + seg + '/') && vpBase(k.slice(k.lastIndexOf('/') + 1)) === vpBase(j.名)) continue;   // 这一条以前的几版：样片照旧图出的，登记的不动（审片台照它找出旧图对照）
              for (const x of (v && Array.isArray(v.references) ? v.references : [])) if (x && str(x.path).replace(/\\/g, '/') === f.path) x.sha256 = hex;
            }
          }
          await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
        });
        for (const f of swapped) await updateList(j.项目, j.段, { 类别: '关键帧', 名称: f.stem, 文件: f.path, ...(f.字 ? { 字: f.字 } : {}), 提示词: name, 状态: '待过目', 核图: f.核图 === '没核成' || f.核图 === 'AI 没核这张' ? '' : f.核图 || '',
          核图时间: await mtimeOf(pj(j.项目, ...f.path.split('/'))), 说明: nowText().slice(5, 16) + ' 照方案' + f.做法, _log: logOf(j, '照方案改：' + f.做法 + '关键帧', (j.渠道 === SELF ? chLabel(j) + ' 出图' : 'Codex 出图') + (f.核图 && f.核图 !== '没核成' && f.核图 !== 'AI 没核这张' ? '，' + chLabel(j) + ' 核图' : '')) }).catch(e => log('资产清单没记上：' + e.message));
        const cnt = k => fr.filter(f => f.结果 === k).length, gone2 = cnt('拿掉') + cnt('没出成');
        const how = [auto.length || !(aiN || drop || swapped.length) ? '照方案 ' + auto.length + ' 处' : '', aiN ? '照你说的 ' + aiN + ' 处' : '', swapped.length ? '关键帧换上 ' + swapped.length + ' 张' : '', gone2 ? '拿掉 ' + gone2 + ' 张' : ''].filter(Boolean).join('、');
        const recRel = path.relative(pj(j.项目), j.dir).split(path.sep).join('/');
        const line = '改成了：' + rel.join('/') + '（' + nowText() + '，' + how + '；记录：' + recRel + '）';
        await writeFile(planP, /^总的看法[：:]/m.test(planMd) ? planMd.replace(/^总的看法[：:]/m, m => line + '\n\n' + m) : planMd.replace(/\n*$/, '\n\n' + line + '\n'));
        const used = [...new Set(lines.join('\n').match(/@(?:图片|视频|音频)\d+/g) || [])], lost = used.filter(u => !refs.some(r => r.ref === u));
        const bmText = kf.vid && kf.bm.length ? bmAsk(j, kf.vid, kf.bm) : '', newRef = f => !drop ? f.ref : (drop.regs.find(x => x.path === f.path) || {}).ref || '';
        await writeFile(path.join(j.dir, '结果.json'), JSON.stringify({ 说明: '照方案改这一回做了什么（审片台「改好了」那一屏照它摆）', 时间: nowText(), 视频: ['成片', seg, str(j.视频)].join('/'), 原稿: j.名, 新稿: name, 记录: recRel,
          改字: { 照方案: auto.length, 照你说的: aiN }, 关键帧: fr.map(f => ({ 编号: f.ref, 新编号: f.结果 === '留着' || f.结果 === '换上' ? newRef(f) : '', 图: f.path, 名: f.stem, 时刻: f.时刻, 做法: f.做法 || '', 结果: f.结果 || '', 为什么: f.为什么 || '',
            核图: f.核图 || '', 再出: !!f.再出, 第一回核图: f.第一回核图 || '', 改哪儿: f.做法 === '小改' ? f.改哪儿 || '照图上的批注' : '', 旧图: f.旧图 || '', 字: f.字 || '', 弃用: !!f.gone, 等白模: !!f.等白模 })),
          白模: kf.vid ? { 路径: kf.vid.path, 重渲过: kf.vid.newer, 要改: kf.bm, 话: bmText } : null, 要加: kf.add, 拿掉的句子: drop ? drop.removed : [], 留空: drop ? drop.holed : [], 没登记: lost }, null, 1) + '\n');
        return { 结果: '照方案改好了：' + vpLabelOf(name) + '（' + name + '，' + how + '）。原稿没动'
          + (fr.length ? '；关键帧' + [swapped.length ? '换上 ' + swapped.length + ' 张' : '', cnt('留着') ? '留着 ' + cnt('留着') + ' 张' : '', cnt('拿掉') ? '拿掉 ' + cnt('拿掉') + ' 张' : '', cnt('没出成') ? cnt('没出成') + ' 张没出成、从新稿里拿掉了' : ''].filter(Boolean).join('、') : '')
          + (bmText ? '；白模有 ' + kf.bm.length + ' 处要改，这里改不了：在审片台复制交给 Claude 的话' : '')
          + (lost.length ? '；注意：新稿写了 ' + lost.join('、') + '，可是没登记是哪个文件，生成任务书前要补上' : '')
          + (drop && drop.moved ? '；拿掉 ' + drop.gone.join('、') + ' 以后，后面的 @图片 编号往前挪了' : '') + (drop && drop.holed.length ? '；有 ' + drop.holed.length + ' 句提到拿掉的关键帧，那一处换成了〔〕，生成任务书前要改写' : '')
          + (gf.miss.length ? '；批注里弃用的 ' + gf.miss.join('、') + ' 这一版里没认出来，没管' : ''),
          产出: [rel.join('/'), ...swapped.flatMap(f => [f.path, ...(f.做法 === '重出' && f.字 ? [f.字] : [])]), ...(swapped.length ? ['资产/' + seg + '_资产清单.json'] : [])] };
      },
    },
  });
  /* ---------- 先写提示词（2026-11-14 他要的倒着走，流程图 通用工具/流水线/先写提示词_流程图.html 他批过） ----------
     这一场先选人物，人只写提示词里人写的两块（【生成目标】【事件脚本】）。
     反推剧本：AI 照这一场的几条提示词写剧本（不加戏不删戏，补的写进备注），段落、表达、出场的另列一份（定稿的剧本/第N段/第N段_反推.json），人在剧本页点「采用」才写进流水线。
     直接铺底：剧本定稿以后，AI 把提示词里它写的几块（素材、基础设定、主体与关系、保持一致、「声音包括」那一行）直接写进正文，人写的两块一个字不动 */
  const REV_TAIL = '_反推.json';
  const PE_HEAD_SET = new Set(Object.keys(PE_HEAD));
  const humanOf = d => ({ event: str(d.event).trim(), shots: PromptDraft.shotText(d).split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l && !PromptDraft.isLook(l)).join('\n') });   // 人写的两块
  const sameHuman = (a, b) => a.event === b.event && a.shots === b.shots;
  function aiPartsText(d) {   // 提示词里 AI 写的几块现在什么样（重铺的时候给 AI 看）
    const basic = d.basic.filter(l => !PromptDraft.isLook(l)), look = d.basic.filter(l => PromptDraft.isLook(l));
    return [d.refs.length ? '【素材】\n' + d.refs.join('\n') : '', basic.length ? '【基础设定】\n' + basic.join('\n') : '', d.seg.length ? '【主体与关系】\n' + d.seg.join('\n') : '', d.keep ? '【保持一致】\n' + d.keep : '', look.length ? '【声音】\n' + look.join('\n') : ''].filter(Boolean).join('\n') || '（还空着）';
  }
  async function revPrompts(j) {   // 这一场的几条提示词（一条只看最新那一版），照第几条排
    const dir = pj(j.项目, '提示词', segDir(j.段)), out = [];
    for (const f of vpLatest(await fsp.readdir(dir).catch(() => []))) {
      const p = path.join(dir, f), d = PromptDraft.parse(unbom(await fsp.readFile(p, 'utf8')));
      out.push({ f, no: vpNo(f), mt: await mtimeOf(p), ...humanOf(d) });
    }
    return out.sort((a, b) => (a.no || 1e9) - (b.no || 1e9) || a.f.localeCompare(b.f, 'zh', { numeric: true }));
  }
  /* 直接铺底能不能铺（11-14 起正着走、倒着走的场都能铺）：剧本定稿了、新格式的稿、人写的两块不全空。点的时候 prep 就查，当场说清 */
  async function layCheck(j) {
    const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
    if (!s || !(await exists(sp)) || !finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs))) throw fail('剧本定稿以后才铺底：先到剧本页点「剧本定稿」');
    const raw = unbom(await fsp.readFile(vpPath(j), 'utf8'));
    if (raw.trim() && !isPeText(raw)) throw fail('这一条是旧格式的稿，不走这里：在写稿页里请 AI 给建议');
    const d = PromptDraft.parse(raw), hm = humanOf(d);
    if (!hm.event && !hm.shots) throw fail('这一条的生成目标、事件脚本都还空着：先写好再铺底');
    return { flow, s, d, hm };
  }
  const laidOf = d => !!str(d.keep).trim() || d.basic.some(l => !PromptDraft.isLook(l));   // AI 写的几块铺过了（基础设定、保持一致有字）
  const LAY_PARTS = [['refs', '素材'], ['basic', '基础设定'], ['seg', '主体与关系'], ['keep', '保持一致'], ['look', '「声音包括」那一行']];
  const layParts = d => ({ refs: d.refs.join('\n'), basic: d.basic.filter(l => !PromptDraft.isLook(l)).join('\n'), seg: d.seg.join('\n'), keep: str(d.keep), look: d.basic.filter(l => PromptDraft.isLook(l)).join('\n') });
  Object.assign(KINDS, {
    反推剧本: {
      title: j => '照提示词反推剧本 · 第' + j.段 + '场', need: ['段'],
      async prep() { if (!PromptDraft) throw fail('读不了 公用/写稿状态.js'); },
      async book(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段);
        if (!s) throw fail('流水线里没有第' + j.段 + '场');
        const ps = await revPrompts(j);
        if (!ps.some(x => x.event || x.shots)) throw fail('这一场的提示词还空着：先写生成目标、事件脚本，再反推');
        j.提示词 = ps.map(x => ({ 文件: x.f, 改: x.mt }));
        const all = flow.场.filter(x => x && x.段), i = all.indexOf(s), near = [all[i - 1], all[i + 1]];
        const old = (await exists(scriptPath(j.项目, j.段))) ? await docText(scriptPath(j.项目, j.段)) : '';
        const lines = str(flow.场景).split(/\r?\n/).map(x => x.trim()).filter(Boolean), imgs = (flow.场景图 || []).map(g => stemOf(g));
        const mine = ['这一场选的出场人物：' + ((s.人物 || []).join('、') || '（没选）'), (s.道具 || []).length ? '这一场选的道具：' + s.道具.join('、') : '', (s.场景文字 || []).length ? '这一场选的场景：' + s.场景文字.join('；') : '',
          (s.场景图 || []).length ? '这一场选的场景图：' + s.场景图.map(stemOf).join('、') : '', str(s.名).trim() ? '人起的场名：' + str(s.名).trim() : '', str(s.表达).trim() ? '人写的这一场要表达的：' + str(s.表达).trim() : ''].filter(Boolean);
        const head = '第' + j.段 + '段｜' + (str(s.名).trim() || '段名');
        return ['# 任务：照提示词反推一场的剧本', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这一场是倒着走的：人先写了视频提示词里的【生成目标】和【事件脚本】（下面一共 ' + ps.length + ' 条，一条出一条视频，照先后连起来就是这一场）。请照它们反推这一场的剧本，再把剧本分成段落，列出出场的人物、道具、场景。',
          '', '## 要求',
          '1. 提示词里的戏一样都不能落，先后照提示词（第 1 条在前）；不加戏、不删戏。台词（{} 里的）一字照抄，写成「角色：台词」；音效（<> 里的）写成「音效：」，字幕（【】里的）写成「字幕：」。',
          '2. 提示词没写、可剧本得有的（谁在哪、怎么来的、前因后果接不上的地方），只补最少的几句；补了什么，在备注里一行一条写「补：……」。',
          '3. 镜头号、机位、景别、运镜、时长都不进剧本，只写看得见的动作和台词；人物用全片人物表里的叫法。照「写戏规矩」：人物的反应要合常理，不过度演绎。',
          '4. 剧本严格照下面「固定格式」写：第一行是标题「' + head + '」，接着场景、人物、梗概三行，然后单独一行「正文」，正文每一行只能是 △ 动作、角色：台词、字幕：、音效： 四种之一；最后单独一行「备注」，备注第一行写：' + mmdd() + ' 照提示词反推。',
          '5. 再把剧本分成段落：一段写一件事，「写什么」一句话，「作用」一句话（为什么要有这一段：它让观众看到什么、明白什么），照剧本的先后。「表达」写这一场主要表达什么，一两句。',
          '6. 出场的：人物写叫法；全片人物表里没有、又是有戏的角色，列进「新人物」（描写写是谁、多大、和别人什么关系），路人、群众这类不算。道具同样，表里没有的列进「新道具」。场景：全片场景里有的那一行，一字照抄；没有的写一句新的（「地点：时间、样子」）。场景图：只写下面列着的图名。',
          '7. 回复两块，照这个样子：', '【剧本】', head, '场景：……', '人物：……', '梗概：……', '正文', '△ ……', '备注', mmdd() + ' 照提示词反推', '补：……（补了才写）', '【反推】',
          '{"段名": "四到八个字", "表达": "一两句", "段落": [{"写什么": "一句话", "作用": "一句话"}], "人物": ["叫法"], "新人物": [{"名": "叫法", "描写": "是谁、多大、和别人什么关系"}], "道具": ["名字"], "新道具": [{"名": "名字", "描写": "干什么用"}], "场景": ["全片场景里的那一行，或者新写的一句"], "场景图": ["图名"], "补的": ["补了什么，一句话"]}',
          '', '## 固定格式和写戏规矩', await skill('script-shotlist-format', '## 二、剧本骨架', '## 四、镜头表骨架'),
          '', '## 全片的设定', settingText(flow), '', '全片的场景（一行一处）：', lines.join('\n') || '（还没写）', '', '能用的场景图：' + (imgs.join('、') || '（没有）'),
          '', '## 这一场：第' + j.段 + '段', mine.join('\n'),
          '', '## 这一场的提示词（人写的两块）', ...ps.map(x => '### ' + x.f + (x.no ? '（第 ' + x.no + ' 条）' : '') + '\n【生成目标】\n' + (x.event || '（空）') + '\n【事件脚本】\n' + (x.shots || '（空）')),
          '', '## 前后两场（只为了衔接，不要写进这一场）', near.map((x, k) => x ? (k ? '下一场' : '上一场') + '：第' + x.段 + '段 ' + str(x.名).trim() + '。' + str(x.表达).trim() : (k ? '下一场：没有' : '上一场：没有')).join('\n'),
          old ? '\n## 这一场现在的剧本（以前写的，人可能改过：提示词没改到的地方，照它原来的写法）\n' + old : '', TAIL].join('\n');
      },
      async apply(j, text) {
        const t = text.replace(/\r\n/g, '\n'), a = t.indexOf('【剧本】'), z = t.indexOf('【反推】');
        if (a < 0 || z < a) throw fail('AI 没按要的格式回（要【剧本】和【反推】两块）');
        const got = jsonIn(t.slice(z + 4)), flow = await readFlow(j.项目);
        const paras = (Array.isArray(got.段落) ? got.段落 : []).map(x => ({ 写什么: oneLine(x && x.写什么), 作用: str(x && x.作用).trim() })).filter(x => x.写什么);
        if (!paras.length) throw fail('AI 没分出段落');
        const at0 = nowText();   // 剧本写下去以前的这一刻：采用时记成段落定下来的时间，剧本才不算「旧的」
        await writeDoc(j, '剧本', scriptPath(j.项目, j.段), body(t.slice(a + 4, z), new RegExp('^第\\s*' + j.段.replace(/-/g, '\\s*[-－—–]\\s*') + '\\s*段')));
        const names = k => (Array.isArray(flow[k]) ? flow[k] : []).map(e => e && str(e.名).trim()).filter(Boolean);
        const split = k => {   // 表里有的、表里没有的
          const have = names(k), on = [], add = [];
          const put = (n, d) => { const x = oneLine(n); if (!x) return; if (have.includes(x)) { if (!on.includes(x)) on.push(x); } else if (!add.some(y => y.名 === x)) add.push({ 名: x, 描写: oneLine(d) }); };
          for (const n of Array.isArray(got[k]) ? got[k] : []) put(typeof n === 'string' ? n : n && n.名, n && typeof n === 'object' ? n.描写 : '');
          for (const x of Array.isArray(got['新' + k]) ? got['新' + k] : []) put(x && x.名, x && x.描写);
          return [on, add];
        };
        const [人物, 新人物] = split('人物'), [道具, 新道具] = split('道具');
        const lines = str(flow.场景).split(/\r?\n/).map(x => x.trim()).filter(Boolean), 场景文字 = [], 新场景 = [];
        for (const x of (Array.isArray(got.场景) ? got.场景 : []).map(oneLine).filter(Boolean)) {
          const hit = lines.find(l => l === x) || lines.find(l => l.startsWith(x) || x.startsWith(l) || (!!sceneStem(l) && sceneStem(l) === sceneStem(x)));
          if (hit) { if (!场景文字.includes(hit)) 场景文字.push(hit); } else if (!新场景.includes(x)) 新场景.push(x);
        }
        const imgs = (flow.场景图 || []).map(g => String(g).replace(/\\/g, '/'));
        const 场景图 = [...new Set((Array.isArray(got.场景图) ? got.场景图 : []).map(n => imgs.find(g => stemOf(g) === oneLine(n) || g === oneLine(n))).filter(Boolean))];
        const 补的 = [], bare = x => x.replace(/[，。；、！？,.;!?\s]+$/, '');   // 备注里的「补：」和 JSON 里的常是同一处：一句包含另一句的只留长的
        for (const x of [...(Array.isArray(got.补的) ? got.补的 : []).map(oneLine), ...t.slice(a, z).split('\n').map(l => (/^补[：:]\s*(.+)$/.exec(l.trim()) || [])[1]).filter(Boolean).map(oneLine)]) {
          const k = bare(x);
          if (!k) continue;
          const i = 补的.findIndex(y => bare(y).includes(k) || k.includes(bare(y)));
          if (i < 0) 补的.push(x); else if (x.length > 补的[i].length) 补的[i] = x;
        }
        补的.splice(20);
        const rel = ['定稿的剧本', segDir(j.段), segDir(j.段) + REV_TAIL];
        await writeFile(pj(j.项目, ...rel), JSON.stringify({ 说明: '先写提示词的场：AI 照这一场的提示词反推的（页面只读）。段落、表达、出场的，人在剧本页点「采用」才写进流水线；新人物、新道具、新场景，勾上的才加进全片设定。剧本时间：AI 写剧本以前的那一刻。提示词：反推时照的那几条和它们的修改时间。',
          时间: nowText(), 剧本时间: at0, 渠道: j.渠道, 提示词: j.提示词 || [], 段名: oneLine(got.段名), 表达: str(got.表达).trim(), 段落: paras, 人物, 新人物, 道具, 新道具, 场景文字, 新场景, 场景图, 补的 }, null, 2) + '\n');
        const nNew = 新人物.length + 新道具.length + 新场景.length;
        return { 结果: '剧本反推好了：' + paras.length + ' 个段落' + (nNew ? '，全片设定里还没有的 ' + nNew + ' 样' : '') + (补的.length ? '，补了 ' + 补的.length + ' 处（写在备注里）' : '') + '。到剧本页看，点「采用」', 产出: ['定稿的剧本/' + segDir(j.段) + '/' + segDir(j.段) + '_剧本.docx', rel.join('/')] };
      },
    },
    直接铺底: {
      title: j => 'AI 铺底 · 第' + j.段 + '场 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      async prep(j) { await vpNeed(j); if (!PromptDraft) throw fail('读不了 公用/写稿状态.js'); await layCheck(j); },
      async book(j) {
        const { flow, s, d, hm } = await layCheck(j);
        j.已铺 = laidOf(d);   // 铺过的：先判断要不要改，对得上就一个字不动（11-14 他定的规矩）
        const ctx = await ctxOf(j), assets = ctx.assets, regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, s);
        for (const v of vids) assets.push({ line: '白模视频（这一条已经挂成 ' + v.ref + '）：' + v.path, path: v.path });
        for (const f of frames) assets.push({ line: '关键帧（这一条已经挂成 ' + f.ref + '）：' + f.path, path: f.path });
        j.assets = assets.map(x => x.path);
        const bmk = vids.length > 0 && frames.length > 0 && !!BmKey, gp = await geoPart(j, s.场景图, s);
        j.images = [...gp.images, ...frameImgs(j, frames)];
        j.geoMake = gp.make;
        const bm = await bmPart(j, vids, frames) + framePart(frames, bmk ? '白模、关键帧、收尾那三句已经在素材里的照原样留着，编号和先后都不改。'
          : '关键帧那几句已经在素材里的照原样留着（顺序句、首帧尾帧、第几个关键帧；编号和先后都不改）；还留着〔〕的，照图把这一刻看得见的构图、人物位置、姿态、镜头方向填上（图已经让你看过）。', bmk);
        const look = await lookPart(j.项目, flow, s, '写', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'), lessons = await lessonsOf(j.项目);
        const hasLook = d.basic.some(l => PromptDraft.isLook(l));
        const rev = s.先写提示词 === true;
        return ['# 任务：给人写好的提示词铺底（只写 AI 写的那几块）', '', '今天 ' + today() + '。这是一个 AI 短视频项目。' + (rev ? '这一场是倒着走的：人先写了视频提示词里的【生成目标】和【事件脚本】，AI 照它反推出剧本，剧本已经定稿。' : '这一场的剧本已经定稿，人照剧本写了视频提示词里的【生成目标】和【事件脚本】。') + '请照 sd25-pe，把这一条提示词里 AI 写的几块写出来：素材、基础设定、主体与关系、保持一致' + (hasLook ? '' : '，和事件脚本最后那一行「声音包括……」') + '。',
          ...(j.已铺 ? ['', '这一条以前铺过（见下面「AI 写的几块现在的样子」）。先判断它们和现在的剧本、资产、人写的两块还对不对得上：对得上就不用改，程序一个字都不动；对不上才改，没问题的那几块照原样留着。'] : []),
          '', '## 要求',
          ...(j.已铺 ? ['0. 回复最前面先写【判断】：第一行只写「对得上」或「要改」，第二行一句话说为什么（要改就说改哪几块）。对得上的，后面几块都不用写；要改的，要改的那几块整块写全，没问题的那几块回「无」，程序照原样留着。'] : []),
          '1. 人写的【生成目标】【事件脚本】一个字都不改，也不要抄进回复；镜头里的人物、道具、场景照他写的称谓对上素材。',
          '2. 素材照下面「提示词格式」第 1、2、3 条：这一条挂的素材五份以内用写法一（从【参考素材职责】起，挂了没用上的接【未采用素材】），多于五份用写法二（从【人物】起，按【人物】【道具】【场景】【动作与声音】分组，不写【主体与关系】）。只能挂下面「能用的资产」里的，镜头里看得见的人物、道具、场景都要挂；@图片 从 1 连着编。',
          '3. 下面「已经挂好的」编号不能改，同一个文件就用这个编号。素材里已经有的白模、关键帧那几句一字照抄，留在原来的位置。',
          '4. 【基础设定】照第 10 条写三行：影像风格、摄影、光色基调。【主体与关系】照第 4 条写（写法二回「无」）。【保持一致】照第 6 条写一句。' + (hasLook ? '' : '【声音】写一行「声音包括……。」（事件脚本最后那一行），照镜头里写到的声音写。'),
          '5. ' + gp.rule,
          '6. 回复照这个样子，段名照抄，不写的块回「无」：', ...(j.已铺 ? ['【判断】', '对得上（或：要改）', '一句话说为什么'] : []), ...(gp.make ? ['【GEO底稿】', '（照 scene-geo 第五节模板写的底稿）'] : []),
          '【素材】', '（素材那几段，带段名：写法一从【参考素材职责】起，写法二从【人物】起）', '【基础设定】', '影像风格：……', '摄影：……', '光色基调：……', '【主体与关系】', '（几个人、各是谁，开场谁在哪、朝着谁，道具，场景空间）', '【保持一致】', '保持……稳定。', ...(hasLook ? [] : ['【声音】', '声音包括……。']), '【素材登记】', '[{"ref": "@图片1", "name": "称谓", "path": "资产/……png"}]',
          '', '## 这一条提示词（文件：' + j.名 + '）', '【生成目标】', hm.event || '（空）', '【事件脚本】', hm.shots || '（空）',
          '', '## AI 写的几块现在的样子（没问题的照留）', aiPartsText(d),
          '', '## 已经挂好的', regs.map(r => r.ref + '：' + r.path + (r.from === '挂图' ? '（人在写稿页挂的）' : '')).join('\n') || '（还没有）',
          '', '## 能用的资产', assets.map(x => x.line).join('\n') || '（没有）', bm, look, gp.text,
          '', ctx.text, lessons ? '\n## 这个项目的历史教训（写的时候记着）' + lessons : '', '', PE_FORMAT, '', '## 技能：sd25-pe', await skill('sd25-pe'), ...(gp.text || gp.make ? ['', '## 技能：scene-geo', await skill('scene-geo')] : []), TAIL].join('\n');
      },
      async apply(j, text) {
        const t = text.replace(/\r\n/g, '\n'), NAMES = ['判断', 'GEO底稿', '素材', '基础设定', '主体与关系', '保持一致', '声音', '素材登记'];
        const blk = n => { const b = blockOf(t, n, NAMES.filter(x => x !== n)); return b == null ? [] : linesOf(b); };
        const none = ls => ls.length === 1 && /^[（(]?(无|没有|不写|不用)[）)]?[。.]?$/.test(ls[0]);
        const clean = ls => none(ls) ? [] : ls.filter(l => !PE_HEAD_SET.has(l.replace(/\s+/g, '')) && !/^镜头\s*[0-9０-９]+\s*[：:]/.test(l));   // 人写的两块的段名、镜头行混进来的不要
        const judge = blk('判断'), same = !!j.已铺 && /^对得上/.test(judge[0] || ''), why = oneLine(judge.slice(1).join(' ')).slice(0, 120);   // 铺过的先判断（11-14 他定的）：对得上就一个字不动
        const geoAt = j.geoMake && t.indexOf('【GEO底稿】') >= 0 ? await saveGeo(j, blockOf(t, 'GEO底稿', NAMES.filter(x => x !== 'GEO底稿'))) : '';
        const geoSay = geoAt ? '；AI 看图新建了一份 GEO 底稿，等你审' : '';
        if (same) return { 结果: '对得上，没改' + (why ? '：' + why : '') + geoSay, 产出: geoAt ? [geoAt] : [] };
        const refsL = clean(blk('素材')), basicL = clean(blk('基础设定')).filter(l => !PromptDraft.isLook(l)), segL = clean(blk('主体与关系')), keepL = clean(blk('保持一致'));
        const soundL = [...clean(blk('声音')), ...clean(blk('基础设定'))].filter(l => /^声音包括/.test(l)).slice(0, 1);
        if (!j.已铺 && (!basicL.length || !keepL.length)) throw fail('AI 没按要的格式回（要【基础设定】【保持一致】这几块）');
        const keepOld = !!j.已铺, gaveRefs = !keepOld || refsL.length > 0, gaveBasic = !keepOld || basicL.length > 0, gaveSeg = !keepOld || segL.length > 0, gaveKeep = !keepOld || keepL.length > 0;   // 铺过的：AI 回「无」、没回的那几块照原样留着
        const isTwo = refs => refs.some(l => /^【(人物|道具|场景|动作与声音)】$/.test(l.replace(/\s+/g, '')));   // 写法二：不写【主体与关系】
        let two = false, changed = [];
        const aiRefs = await refsIn(j, blockOf(t, '素材登记', []) || '', j.assets || []);
        const txt = vpPath(j), sidep = txt.replace(/\.txt$/, '_写稿.json'), rel = ['提示词', segDir(j.段), j.名];
        const n = await withFileLocks([txt, sidep], async () => {   // 和写稿页存盘共用文件锁：拿到锁以后照盘上最新的那一份改
          const d = PromptDraft.parse(await fsp.readFile(txt, 'utf8')), before = humanOf(d), side = await sideOf(j);
          const kept = d.refs.filter(l => /@视频\d+|首帧|尾帧|关键帧/.test(l) && !/〔[^〕]*〕/.test(l));   // 白模、关键帧那几句：要一字不差地还在（留着〔〕的可以填）
          const lost = gaveRefs ? kept.filter(l => !refsL.includes(l)) : [];
          if (lost.length) throw fail('AI 把素材里白模、关键帧那几句改了（「' + lost[0].slice(0, 40) + '」），没存。再点一次「AI 铺底」');
          const put = (doc, lk) => {
            if (gaveRefs) doc.refs = refsL;
            doc.basic = [...(gaveBasic ? basicL : doc.basic.filter(l => !PromptDraft.isLook(l))), ...lk];
            if (isTwo(doc.refs)) doc.seg = []; else if (gaveSeg) doc.seg = segL;
            if (gaveKeep) doc.keep = keepL.join('');
          };
          const look = d.basic.filter(l => PromptDraft.isLook(l)), p0 = layParts(d);
          put(d, look.length ? look : soundL);
          two = isTwo(d.refs);
          const p1 = layParts(d);
          changed = LAY_PARTS.filter(([k]) => p0[k] !== p1[k]).map(([, name]) => name);
          if (!changed.length) return -1;   // 和现在一字不差：不写，也不多留一版历史记录
          if (!p1.basic || !p1.keep) throw fail('AI 没按要的格式回（要【基础设定】【保持一致】这几块）');
          const out = PromptDraft.serialize(d);
          if (!sameHuman(humanOf(PromptDraft.parse(out)), before)) throw fail('铺进去会动到你写的两块，没存。打开看一眼格式，再点「AI 铺底」');
          let sideOut = false;
          if (typeof side.分镜稿 === 'string') {   // 写稿页的过程文件：分镜模式存的就是正文；自由模式存结构化的那一份，页面照它和自由稿拼正文，AI 写的几块也要在里面
            if (side.写法 === '自由') {
              const ds = PromptDraft.parse(side.分镜稿 || PromptDraft.skeleton(d.eol)), lookS = ds.basic.filter(l => PromptDraft.isLook(l)), free = str(side.自由稿);
              put(ds, lookS.length ? lookS : d.basic.filter(l => PromptDraft.isLook(l) && !free.includes(l)));
              side.分镜稿 = PromptDraft.serialize(ds);
            } else side.分镜稿 = out;
            sideOut = true;
          }
          await keepCopy(j.项目, rel);   // 原来那一版先留一份进历史记录
          await writeFile(txt, out);
          if (sideOut) await writeFile(sidep, JSON.stringify(side, null, 2) + '\n');
          /* 素材登记：AI 登的（人在写稿页挂过的编号以挂图为准），加上原来登记过、正文里还在用的 */
          const hang = Object.fromEntries(Object.entries(side.挂图 && typeof side.挂图 === 'object' ? side.挂图 : {}).map(([k, v]) => [k, String(v).replace(/\\/g, '/')]));
          let map = {};
          try { map = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '参考素材映射.json'), 'utf8'))); } catch (e) { /* 还没有 */ }
          const used = new Set(out.match(/@(?:图片|视频|音频)\d+/g) || []), olds = ((((map && map.prompts) || {})[rel.join('/')] || {}).references || []).filter(r => r && used.has(str(r.ref)));
          const list = [];
          for (const r of aiRefs) if ((!hang[r.ref] || hang[r.ref] === r.path) && !list.some(x => x.ref === r.ref)) list.push(r);
          for (const r of olds) if (!hang[r.ref] && !list.some(x => x.ref === r.ref)) list.push(r);
          await resha(j.项目, rel, list);
          return list.length;
        });
        if (n < 0) return { 结果: '对得上，没改：AI 回的和现在一样' + geoSay, 产出: geoAt ? [geoAt] : [] };
        return { 结果: (keepOld ? '重新铺了：改了' + changed.join('、') + (why ? '（' + why + '）' : '') + '，原来那一版进了历史记录' : '铺好了：素材、基础设定、' + (two ? '' : '主体与关系、') + '保持一致写进了' + vpLabel(j)) + '，你写的两块没动' + (n ? '，登记了 ' + n + ' 个素材' : '') + geoSay, 产出: [rel.join('/'), ...(geoAt ? [geoAt] : [])] };
      },
    },
  });
  /* ---------- 修改方案读写（页面 审片台.html 用同一个格式） ---------- */
  const PLAN_TAIL = '_修改方案.md', PLAN_NOTE_TAIL = '_修改方案_批注.md', PLAN_KEYS = ['批注', '位置', '问题', '原因', '怎么改', '原文', '改成'];
  const DEL_RE = /^[（(]?(删掉|删除|删去|去掉)[）)]?$/;
  const unq = s => { const t = str(s).trim(), m = /^[「“"『](.*)[」”"』]$/s.exec(t); return m && !/[「“"『」”"』]/.test(m[1]) ? m[1] : t; };   // AI 爱给原话加引号
  function planItems(t) {   // 「## 1」一节一条，「- 键：值」；原文、改成可以接着写几行
    return t.replace(/\r\n?/g, '\n').split(/^#{2,3}[ \t]+/m).slice(1).map(p => {
      const no = parseInt(p.replace(/^[^0-9\n]*/, ''), 10), g = { no };   // 「## 1」；AI 写成「## 第1条」也认
      let cur = '';
      for (const line of p.split('\n').slice(1)) {
        const s = line.trim(), m = /^(?:[-*•]|\d+[.、])?[ \t]*\**[ \t]*(批注|位置|问题|原因|怎么改|原文|改成)[ \t]*\**[ \t]*[：:][ \t]*\**[ \t]*(.*)$/.exec(s);   // 「- 原文：」；带 **加粗** 的也认
        if (m) { cur = m[1]; g[cur] = m[2].trim(); }
        else if (/^改成了[：:]/.test(s)) cur = '';
        else if (cur && s) g[cur] += (cur === '原文' || cur === '改成' ? '\n' : '') + s;
      }
      if (!(no > 0)) return null;
      if (g.原文 != null) { g.原文 = unq(g.原文); if (!g.原文) delete g.原文; }
      if (g.改成 != null) g.改成 = DEL_RE.test(g.改成.trim()) ? '' : unq(g.改成);
      if (g.原文 == null) delete g.改成; else if (g.改成 == null) g.改成 = '';   // 有原文没写改成：当删掉
      return g;
    }).filter(Boolean).map((g, i) => ({ ...g, no: i + 1 }));
  }
  function planText(it) {
    const out = ['## ' + it.no];
    for (const k of PLAN_KEYS) {
      if (it[k] == null || (k !== '改成' && !str(it[k]).trim())) continue;
      const v = k === '改成' && !it[k] ? '（删掉）' : str(it[k]);
      const ls = v.split('\n');
      out.push('- ' + k + '：' + ls[0], ...ls.slice(1).map(l => '  ' + l));
    }
    return out.join('\n');
  }
  function parsePlan(md) {
    const t = str(md).replace(/\r\n?/g, '\n'), head = t.split(/^##[ \t]+/m)[0];
    const get = k => ((new RegExp('^' + k + '[：:][ \\t]*(.*)$', 'm')).exec(head) || [])[1] || '';
    return { 视频: get('视频').trim(), 提示词: get('提示词').trim(), 总: get('总的看法').trim(), done: [...t.matchAll(/^改成了[：:][ \t]*(.+)$/gm)].map(m => m[1].trim()), items: planItems(t) };
  }
  function parsePlanNote(md) {   // 「## 1」下面「定：照这样改 / 不改 / 照我说的改」「批注：……」；「## 整体」下面「批注：……」
    const out = { items: new Map(), general: '' };
    for (const p of str(md).replace(/\r\n?/g, '\n').split(/^##[ \t]+/m).slice(1)) {
      const head = p.split('\n')[0].trim(), d = { 定: '', 批注: '' };
      let inNote = false;
      for (const line of p.split('\n').slice(1)) {   // 「批注：」写在最后，后面几行都算它的
        if (inNote) { d.批注 += '\n' + line; continue; }
        const m = /^(定|批注)[：:][ \t]*(.*)$/.exec(line.trim());
        if (!m) continue;
        if (m[1] === '定') d.定 = m[2].trim(); else { d.批注 = m[2]; inNote = true; }
      }
      d.批注 = d.批注.trim();
      if (/^整体/.test(head)) out.general = d.批注;
      else if (parseInt(head, 10) > 0) out.items.set(parseInt(head, 10), d);
    }
    return out;
  }
  /* 换一处：一模一样的整行（第 nth 处）换掉整行；不然，全文只有一行含着这一句、而且只含一次，就换这一句。找不到给 null */
  function applyOne(lines, find, put, nth = 1) {
    const want = str(find).trim(), L = lines.slice();
    if (!want) return null;
    let hit = -1, seen = 0;
    for (let i = 0; i < L.length; i++) if (L[i].trim() === want && ++seen === nth) { hit = i; break; }
    if (hit >= 0) {
      const ps = str(put).split(/\r?\n/).map(l => l.trim()).filter((l, i, a) => l || a.length === 1);
      L.splice(hit, 1, ...(ps.length === 1 && !ps[0] ? [] : ps));
      return L;
    }
    const idx = L.map((l, i) => l.includes(want) ? i : -1).filter(i => i >= 0);
    if (idx.length !== 1 || L[idx[0]].split(want).length !== 2) return null;
    L[idx[0]] = L[idx[0]].replace(want, () => str(put).replace(/\r?\n/g, ''));
    return L;
  }
  /* 这条样片是照哪一份提示词出的：批注里记的（审片台上选的「出自」）→ 页面给的 → 名字里带的「镜头1-5」「提示词01改1」→ 只有一份就是它 */
  async function srcOfClip(j, notesMd) {
    const dir = pj(j.项目, '提示词', segDir(j.段)), files = (await fsp.readdir(dir).catch(() => [])).filter(n => RE_VP.test(n) && nameOk(n));
    const said = path.basename(((/^提示词[：:][ \t]*(.+)$/m.exec(notesMd) || [])[1] || '').trim().replace(/\\/g, '/'));
    for (const n of [said, str(j.名)]) if (n && files.includes(n)) return n;
    const parts = '_' + stemOf(str(j.视频)) + '_', hit = files.filter(n => vpTok(n) !== '整场' && parts.includes('_' + vpTok(n) + '_'));
    if (hit.length === 1) return hit[0];
    if (files.length === 1) return files[0];
    throw fail('认不出这条样片是哪一份提示词出的：在审片台上面「出自」那里选一条');
  }
  /* 批注里的截图（写批注时停住的那一帧）：只认这个项目里还在的，最多 8 张 */
  async function shotsIn(j, notesMd, base) {
    const out = [], root = path.resolve(pj(j.项目)) + path.sep;
    for (const m of str(notesMd).matchAll(/^截图[：:][ \t]*(.+)$/gm)) {
      const raw = m[1].trim(), q = raw.split(/[\\/]/);
      let p = path.resolve(/^[A-Za-z]:[\\/]/.test(raw) ? raw : path.join(base, raw));
      if (!(p.startsWith(root) && await exists(p)) && q.length >= 2) p = path.resolve(base, q[q.length - 2], q[q.length - 1]);   // 项目挪过地方：照「视频名_批注截图/那一帧.jpg」在批注旁边找
      if (p.startsWith(root) && /\.(png|jpe?g|webp)$/i.test(p) && !out.includes(p) && await exists(p)) out.push(p);
      if (out.length >= 8) break;
    }
    return out;
  }
  /* 下一版叫什么：这一条（原稿名去掉 _改N）在 提示词/第N段、历史记录/提示词/第N段 里改到第几版了，再加一 */
  async function nextVer(name, seg, file) {
    const base = vpBase(file).replace(/\.txt$/, ''), esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp('^' + esc + '_改([0-9]+)(__[0-9]{8}-[0-9]{6})?\\.txt$');
    let n = 0;
    for (const d of [pj(name, '提示词', seg), pj(name, '历史记录', '提示词', seg)]) for (const f of await fsp.readdir(d).catch(() => [])) { const m = re.exec(f); if (m) n = Math.max(n, +m[1]); }
    return base + '_改' + (n + 1) + '.txt';
  }
  /* ---------- 照方案改：关键帧一起改到位（2026-11-15 他定：「审片之后照方案改，要一次性改到位，包括关键帧的生成；方案复杂就开几个对话同时改」。
     设计稿 通用工具/流水线/照方案改_说明.html，他选的：出不了的关键帧从新稿里拿掉、编号往前挪、标红写为什么；核图说不行自动再出一回，还不行照拿掉办）----------
     字改好以后：AI 对着新稿把这一条挂的关键帧一张张看（挂了白模的，先截白模那一秒给它看），定留着、小改、重出、拿掉，要重出的同一回写好字
     → 小改、重出的几张同时开几个 Codex 对话一起出（最多 3 个；给我提示词的一张一张交）→ AI 一回核完新图，不行的带上毛病再出一回
     → 还不行的、没出成的、白模要先改的，从新稿里拿掉 → 新图用原来的名字换上，旧图连它的字、批注、白模截图同一个时间进历史记录。
     新图、新字先放在这一回的任务文件夹里，都好了才换上：中途停了、没成，资产和提示词一样都不动。
     白模这里改不了：方案说要回白模改、白模在出方案以后又没重渲过的，列出来，附一段交给 Claude 的话；那几镜的关键帧先拿掉 */
  const KF_WAYS = ['留着', '小改', '重出', '拿掉'];
  const KF_PAR = 3, KF_SEE = 12, KF_REFS = 5;   // 同时开几个 Codex 对话出图；看关键帧时最多给 AI 看几张图；出一张图最多垫几张参考图（Codex 一次最多垫 5 张）
  const KF_RULE = '关键帧是这一条视频里某一刻的画面，横幅 16:9；人物、道具、场景的样子照参考图，正文里用「图1」「图2」……指它们，长相衣着不再用字描一遍；写清这一刻谁在哪、在做什么、朝哪、镜头从哪拍、光从哪来；画动着的那一刻，别画成摆拍；真人写实的电影剧照质感。';
  const kfNo = r => +String(r).replace(/\D+/g, '');
  function goneNotes(notesMd) {   // 批注里弃用关键帧的那几条：{ ref, rel（从「资产/」写起，认不出空着）, why 理由 }
    const out = [];
    for (const p of str(notesMd).replace(/\r\n?/g, '\n').split(/^##[ \t]+/m).slice(1)) {
      const m = /^弃用关键帧[：:][ \t]*(@图片\d+)[ \t]*(.*)$/m.exec(p);
      if (!m) continue;
      const q = m[2].trim().replace(/\\/g, '/'), k = q.lastIndexOf('/资产/'), w = /^批注[：:][ \t]*([\s\S]*)$/m.exec(p);
      out.push({ ref: m[1], rel: k >= 0 ? q.slice(k + 1) : q.startsWith('资产/') ? q : '', why: w ? w[1].trim().slice(0, 600) : '' });
    }
    return out;
  }
  /* 这一条挂的白模：在哪、切点、多长；newer：出方案以后又重渲过（方案说的白模的毛病当已经改好了） */
  async function kfVid(j, regs, planMd) {
    const v = vidsOf(regs)[0];
    if (!v) return null;
    const n = await bmNote(j, v), mt = await mtimeOf(n.abs), t = timeOf((/^出方案[：:][ \t]*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/m.exec(planMd) || [])[1]);
    return { ref: v.ref, path: v.path, abs: n.abs, has: await exists(n.abs), cuts: n.cuts, text: n.text, note: n.note, secs: await vidSecs(n.abs), mt, newer: !!t && !!mt && mt > t + 999 };
  }
  /* 方案里要回白模改的：只给建议（不改提示词）、你点了「知道了」、「怎么改」说到白模的。{ no 方案第几条, shots 说到的镜头, text } */
  function bmFixes(plan, dec) {
    const out = [];
    for (const it of plan.items) {
      const d = dec.items.get(it.no) || {};
      if (it.原文 != null || (d.定 || '知道了') !== '知道了' || !/白模/.test(str(it.怎么改) + str(it.位置))) continue;
      const t = [it.位置, it.问题, it.怎么改].map(str).join(' ');
      out.push({ no: it.no, shots: [...new Set([...t.matchAll(/镜头\s*0*([0-9]+)/g)].map(m => +m[1]))], text: oneLine(it.怎么改 || it.问题).slice(0, 300) });
    }
    return out;
  }
  /* 这一条挂的关键帧，各是哪一镜、哪一刻（挂了白模的：白模第几秒），原来的字、图上的批注、弃用的理由 */
  async function kfList(j, lines, regs, s, gone, notesMd, vid) {
    const tagged = new Map();   // 白模＋关键帧的稿：每一镜开头写着参考哪张。编号 → { no, a, b, role }
    if (BmKey && BmKey.isBmk(lines)) for (const l of lines) {
      const m = KF_SHOT.exec(l), t = m && BmKey.tagOf(m[4]);
      if (!t) continue;
      const no = +m[2].replace(/[０-９]/g, c => String(c.charCodeAt(0) - 0xFF10));
      for (const r of t.refs) if (!tagged.has(r)) tagged.set(r, { no, a: t.a, b: t.b, role: (new RegExp('(首帧|开场|结尾)?参考\\s*' + r + '(?![0-9])').exec(t.text) || [])[1] || '' });
    }
    const base = framesOf(j, regs, s), gn = goneNotes(notesMd), out = [];
    const list = regs.filter(r => /^@图片\d+$/.test(r.ref) && /\.(png|jpe?g|webp)$/i.test(r.path) && (base.includes(r) || gone.includes(r) || tagged.has(r.ref)));
    for (const r of list) {
      const q = r.path.split('/').filter(Boolean), d = q.slice(0, -1), file = q[q.length - 1], stem = file.replace(/\.[^.]+$/, '');
      const tg = tagged.get(r.ref), no = tg ? tg.no : KeyFrames ? KeyFrames.noOf(stem) : null;
      const cut = tg && tg.a != null && tg.b != null ? { a: tg.a, b: tg.b } : vid && no != null ? vid.cuts.find(c => c.no === no) || null : null;
      const role = (tg && tg.role) || (/尾帧/.test(stem) ? '结尾' : /首帧/.test(stem) ? '首帧' : '');   // 首帧、开场：这一镜开头；结尾；空的是中间那一刻
      const sec = !cut ? null : role === '结尾' ? Math.max(cut.a, cut.b - 0.5) : role ? cut.a : (cut.a + cut.b) / 2;
      const words = [];
      for (const t of [stem + '_提示词.txt', stem + '_改图提示词.txt']) if (await exists(pj(j.项目, '提示词', segDir(j.段), t))) words.push(['提示词', segDir(j.段), t].join('/'));
      const noteAbs = pj(j.项目, ...d, stem + '_批注.md'), mark = pj(j.项目, ...d, stem + '_批注截图', '标注图.jpg'), g = gone.includes(r);
      const gw = g ? gn.find(x => x.rel && x.rel === r.path) || gn.find(x => x.ref === r.ref && (!x.rel || path.basename(x.rel) === file)) : null;
      out.push({ reg: r, ref: r.ref, path: r.path, stem, ext: path.extname(file).toLowerCase(), img: pj(j.项目, ...q), has: await exists(pj(j.项目, ...q)),
        no, cut, role, sec, 时刻: no != null ? '镜头' + no + ' ' + (role === '结尾' ? '结尾' : role ? '开头' : '中间') : '',
        words, wordText: words.length ? unbom(await fsp.readFile(pj(j.项目, ...words[0].split('/')), 'utf8')).trim() : '',
        noteAbs: (await exists(noteAbs)) ? noteAbs : '', note: (await exists(noteAbs)) ? unbom(await fsp.readFile(noteAbs, 'utf8')).trim().slice(0, 3000) : '', mark: (await exists(mark)) ? mark : '',
        gone: g, why: gw ? gw.why : '', refs: [], touch: [] });
    }
    return out.sort((a, b) => ((a.no == null ? 1e9 : a.no) - (b.no == null ? 1e9 : b.no)) || (kfNo(a.ref) - kfNo(b.ref)));
  }
  async function grabAt(video, sec, out) {   // 截白模第几秒那一帧（PNG）；没有 ffmpeg、截不出给 ''
    if (!FFMPEG) return '';
    try {
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(sec), '-i', video, '-frames:v', '1', '-y', out], { timeout: 60e3 });
      return (await exists(out)) ? out : '';
    } catch (e) { return ''; }
  }
  async function overlay(a, b, out) {   // 新图和白模那一帧叠在一起（各一半）：核图时看机位、构图对不对得上（11-12 他定的「出完叠图核对」）
    if (!FFMPEG) return '';
    try {
      await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', a, '-i', b, '-filter_complex', '[0:v]scale=1280:720,format=rgb24[a];[1:v]scale=1280:720,format=rgb24[b];[a][b]blend=all_mode=average', '-frames:v', '1', '-y', out], { timeout: 60e3 });
      return (await exists(out)) ? out : '';
    } catch (e) { return ''; }
  }
  async function kfPool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); })); }   // 最多 n 个一起做
  /* 重出的字：开头「图N：完整路径（说明）」，用途、要撑住，「提示词」下面是正文（和写字那一步一样，资产出图任务照它出）。bmf：白模那一帧放在哪 */
  function kfWordText(j, f, name, bmf) {
    const refs = [...(bmf ? [{ abs: bmf, what: '白模第 ' + f.sec + ' 秒的画面：构图、机位、人和东西站在哪照它，灰模的外观、材质不要' }] : []), ...f.refs.map(r => ({ abs: pj(j.项目, ...r.split('/')), what: stemOf(r) }))];
    return [...refs.map((r, i) => '图' + (i + 1) + '：' + r.abs + '（' + r.what + '）'), '用途：第' + j.段 + '场「' + name + '」的关键帧' + (f.时刻 ? '（' + f.时刻 + '）' : '') + '，照修改方案重出',
      ...(f.keep ? ['要撑住：' + f.keep] : []), '提示词', f.promptNow || f.prompt].join('\n') + '\n';
  }
  /* 出图要的字、小改的批注，先放在任务文件夹里（换上的时候才写进提示词文件夹）。extra：核图说的毛病，再出一回时带上 */
  async function kfWords(j, f, kdir, name, extra) {
    const tail = extra ? '_再出' : '';
    if (f.做法 === '重出') {
      f.promptNow = f.prompt + (extra ? '\n' + extra : '');
      f.wordFile = path.join(kdir, f.stem + '_提示词' + tail + '.txt');
      await writeFile(f.wordFile, kfWordText(j, f, name, f.bmf));
      return;
    }
    const say = [f.改哪儿, extra].filter(Boolean).join('；'), user = f.noteAbs ? unbom(await fsp.readFile(f.noteAbs, 'utf8')) : '', k = user.search(/^##[ \t]/m);
    f.noteFile = path.join(kdir, f.stem + '_改哪儿' + tail + '.md');
    await writeFile(f.noteFile, ['# 批注｜' + f.stem, '', '照修改方案小改这张关键帧（' + nowText() + '）。', '', ...(say ? ['## 整体（照修改方案）', '批注：' + say, ''] : []), ...(user && k >= 0 ? [user.slice(k).trim(), ''] : [])].join('\n'));
  }
  /* 出一张：重出照字出，小改以原图为底只改说到的地方；存到任务文件夹里。几张一起出的，每张一个自己的小任务（自己的文件夹、自己的 Codex 进程，点停一起停） */
  async function kfDraw(j, f, kdir, round) {
    const tail = round ? '_再出' : '', out = path.join(kdir, f.stem + tail + '.png'), self = j.渠道 === SELF;
    const sub = self ? j : Object.assign(Object.create(j), { dir: path.join(kdir, f.stem + tail), child: null });
    if (!self) { await fsp.mkdir(sub.dir, { recursive: true }); j.subs.push(sub); }
    await fsp.unlink(out).catch(() => {});
    if (j.停) throw fail('停掉了');
    if (CHANNELS.mock && j.渠道 === 'mock') { await mockImage(out); return out; }
    const mine = pj(j.项目, '提示词', '全局资产', '资产出图任务.txt'), task = (await exists(mine)) ? mine : IMG_TASK;
    const msg = f.做法 === '重出' ? '请照 ' + task + ' 做这一张。提示词文件：' + f.wordFile + '　存图路径：' + out
      : '请照 ' + EDIT_TASK + ' 做这一张。原图：' + f.img + '　批注：' + f.noteFile + (f.mark ? '　标注图：' + f.mark : '') + (f.words.length ? '　出图提示词：' + pj(j.项目, ...f.words[0].split('/')) : '') + '　存图路径：' + out;
    const said = await codexDo(sub, msg, { tag: self ? '出图_' + f.stem + tail : '', check: async () => { if (!(await exists(out))) throw retry('图还没存到 ' + out + '：存好了再告诉项目'); } });
    await writeFile(path.join(kdir, f.stem + tail + '_Codex的回复.md'), said + '\n');
    if (!(await exists(out))) throw fail('Codex 说做完了，可是图没存到');
    return out;
  }
  /* 看关键帧的任务书 */
  function kfBook(j, o) {
    const { frames, vid, bm } = o;
    const fx = f => ['### ' + f.ref + '（' + f.path + '）' + (f.时刻 ? '：' + f.时刻 : ''),
      ...(f.has ? [] : ['- 图不在了']),
      vid ? (f.bmf ? '- 挂了白模：这一刻是白模第 ' + f.sec + ' 秒，那一帧给你看过了；重出时它是图1，你挑的参考图从图2 排起' : '- 白模里是哪一秒认不出：重出时不垫白模，你挑的参考图从图1 排起') : '- 没挂白模：重出时你挑的参考图从图1 排起',
      ...(f.gone ? ['- 用户审片时弃用了这张，理由：' + (f.why || '（没写）') + '。只能重出或拿掉'] : []),
      ...(f.note ? ['- 用户在这张图上写的批注' + (f.mark ? '（标注图给你看过了，红框旁边的数字是第几条）' : '') + '：', f.note] : []),
      ...(f.wordText ? ['- 原来的字（' + f.words[0] + '）：', f.wordText.slice(0, 3000)] : [])].join('\n');
    return ['# 任务：照方案改完字以后，看这一条挂的关键帧要不要跟着改', '',
      '今天 ' + today() + '。这是一个 AI 短视频项目，用 Seedance 2.5 出片。用户看完一条样片写了批注，AI 出了修改方案，用户逐条定过，字已经照方案改好了（下面「改好的新稿」，还没存）。这一条挂着 ' + frames.length + ' 张关键帧：关键帧是某一镜某一刻的画面，视频照它画，图里有的会被照抄。请一张一张定怎么办，要重出的同一回把出图提示词写好。',
      ...(o.said ? [o.said] : []),
      '', '## 四种做法',
      '- 留着：这一刻的画面在新稿里没变，图还对得上。都对得上就都留着，一张不动。',
      '- 小改：机位、构图都对，只差一两样（多画了、少画了一样东西，样子不对）。以原图为底只改说到的地方，最像原来那张。用户在图上写了批注的，多半走这条。',
      '- 重出：这一刻的机位、动作、站位在新稿里变了，或者用户弃用了这张。' + (vid ? '白模那一秒和原图的机位、构图对不上的，一律重出，不在旧图上改。' : ''),
      '- 拿掉：新稿里这一镜不该再有关键帧（用户弃用时说了这一镜不要关键帧，或者这一镜删了）。拿掉的从新稿里去掉，后面的编号往前挪。',
      ...(vid && vid.newer ? ['- 白模在出方案以后重渲过（' + nowText(new Date(vid.mt)) + '）：方案说的白模的毛病当已经改好了，照新白模那一秒看。'] : []),
      ...(bm.length ? ['- 下面「要回白模改的」这几处，白模在出方案以后还没重渲：说到的那几镜，关键帧一律拿掉（照旧白模出会对不上，等白模改好再补）。'] : []),
      '', '## 重出要写的',
      '1. 出图提示词：' + KF_RULE + '只写画面里有的东西，不写「没有……」「不要……」（会把东西请进画面）。',
      '2. 爆炸、火光、硝烟、炮口焰这类一闪就变的，画进关键帧会被钉住不动：画它出现前一瞬或者散了以后的样子，交给视频去画。人和东西的大小照真实比例。',
      '3. 参考图：从下面「能挑的参考图」里挑这一刻画面里有的人物、道具、场景，写路径；连白模那一张一起最多 ' + KF_REFS + ' 张。',
      '4. 要撑住：一句话，这一刻要让人看明白什么。',
      '', '## 小改要写的', '改哪儿：一两句说清改哪儿、改成什么。照图上的批注改的，只写批注以外还要改的，没有就写空字符串。',
      '', '## 回复一段 JSON，别的都不要',
      '{"关键帧": [{"编号": "@图片6", "做法": "留着", "为什么": "一句大白话"}, {"编号": "@图片9", "做法": "重出", "为什么": "……", "要撑住": "……", "参考图": ["资产/全局资产/人物/我军士兵.png"], "出图提示词": "……"}, {"编号": "@图片7", "做法": "小改", "为什么": "……", "改哪儿": "……"}], "要加": [{"镜头": 2, "为什么": "原来没有关键帧、你觉得该加一张的（只列出来，不自动加）"}]}',
      '每一张关键帧都要有一项，编号照抄。「要加」没有就写空列表。',
      '', '## 这一条挂的关键帧（按先后）', ...frames.map(fx),
      ...(bm.length ? ['', '## 要回白模改的（白模还没重渲）', ...bm.map(b => '- 方案第 ' + b.no + ' 条' + (b.shots.length ? '（镜头' + b.shots.join('、') + '）' : '') + '：' + b.text)] : []),
      '', '## 改好的新稿（' + o.name + '，还没存）', o.lines.join('\n'),
      ...(o.changes.length ? ['', '## 这一回字改了哪几处', ...o.changes] : []),
      ...(vid ? ['', '## 这一条挂的白模视频', vid.ref + '：' + vid.path + (vid.secs ? '，时长 ' + vid.secs.toFixed(1) + ' 秒' : ''), ...(vid.text ? ['白模说明（' + path.basename(vid.note) + '）：', vid.text.slice(0, 4000)] : [])] : []),
      '', '## 能挑的参考图', ...(o.pool.length ? o.pool.map(p => '- ' + p.path + '（' + p.what + '）') : ['（没有：重出时只能照字出）']),
      '', '## 修改方案（对照用）', o.planMd,
      '', '## 用户对方案逐条定的（选了「不改」的那几条，关键帧也别照它改；写了意见的听用户的）', ...o.plan.items.map(it => { const d = o.dec.items.get(it.no) || {}, say = oneLine(d.批注).slice(0, 300); return '- 第 ' + it.no + ' 条：' + (d.定 || (it.原文 != null ? '照这样改' : '知道了')) + (say ? '（用户的意见：' + say + '）' : ''); }),
      ...(str(o.dec.general).trim() ? ['- 对整份的意见：' + oneLine(o.dec.general).slice(0, 600)] : []),
      ...(o.notesMd ? ['', '## 审片批注（对照用）', o.notesMd] : []),
      ...(o.lessons ? ['', '## 这个项目的历史教训（定做法、写字的时候记着）' + o.lessons] : []), TAIL].join('\n');
  }
  function kfCheckBook(list, said) {
    return ['# 任务：核几张刚出的关键帧', '', '今天 ' + today() + '。这是一个 AI 短视频项目，用 Seedance 2.5 出片。照修改方案改完提示词，下面这几张关键帧刚重出或者小改过。关键帧是视频里某一镜某一刻的画面，视频照它画，图里有的会被照抄。' + said,
      '', '## 一张一张核', '1. 和它的字（重出的看出图提示词，小改的看改哪儿）对不对得上：要的有没有缺、画错；', '2. 挂了白模的：和白模那一秒对不对得上：机位、构图、人和东西站在哪（看叠在一起的那张）；',
      '3. 有没有画进爆炸、火光、硝烟这类一闪就变的东西（画进关键帧会被钉住不动）；', '4. 合不合理：东西摆在哪、光从哪来，人和东西的大小对不对。', '小毛病不算不行；会让视频出错的才算不行。',
      '', '## 回复一段 JSON，别的都不要', '[{"编号": "@图片9", "行": true, "毛病": "没看出问题"}, {"编号": "@图片10", "行": false, "毛病": "一两句大白话", "怎么改": "写成画面里该有什么，一句话，不写「没有……」「不要……」"}]',
      ...list.flatMap(f => ['', '## ' + f.ref + (f.时刻 ? ' ' + f.时刻 : '') + '（' + f.做法 + '）', f.做法 === '重出' ? '出图提示词：\n' + (f.promptNow || f.prompt) : '改哪儿：' + (f.改哪儿 || '照图上的批注') + (f.note ? '\n图上的批注：\n' + f.note : '')]), TAIL].join('\n');
  }
  function kfCheckParse(text) {   // 核图的回复：编号 → { ok, bad 毛病, fix 怎么改 }
    const a = text.indexOf('['), z = text.lastIndexOf(']');
    if (a < 0 || z <= a) throw fail('AI 没按要的格式回（要一段 JSON 列表）');
    let arr;
    try { arr = JSON.parse(text.slice(a, z + 1)); } catch (e) { throw fail('AI 回的 JSON 读不了：' + e.message); }
    const out = new Map();
    for (const x of Array.isArray(arr) ? arr : []) if (x && /^@图片\d+$/.test(str(x.编号).trim())) out.set(str(x.编号).trim(), { ok: x.行 !== false && str(x.行).trim() !== 'false', bad: oneLine(x.毛病).slice(0, 200), fix: oneLine(x.怎么改).slice(0, 300) });
    return out;
  }
  const fmtRetry = parse => t => { try { parse(t); } catch (e) { throw retry(e.message + '：改好回复文件再告诉项目'); } };   // 交给人、Claude 桌面版的：格式不对接着等它改好
  /* AI 一回核完这几张新图（新图、那一刻的白模、两张叠在一起的）；没核成给 null（不挡） */
  async function kfCheck(j, list, kdir, round, step) {
    const imgs = [], said = [], see = (p, t) => { if (p && imgs.length < KF_SEE) { imgs.push(p); said.push(t); } };
    for (const f of list) {
      see(f.新图, f.ref + ' 新出的图');
      if (f.bmf) { see(f.bmf, f.ref + ' 那一刻的白模'); see(await overlay(f.新图, f.bmf, path.join(kdir, f.stem + (round ? '_再出' : '') + '_叠图.jpg')), f.ref + ' 新图和白模叠在一起'); }
      else if (f.做法 === '小改' && f.has) see(f.img, f.ref + ' 原来的图');
      step(f.步名, '在核图', '在做');
    }
    try {
      const text = await askText(j, j.渠道, kfCheckBook(list, '让你看过的图依次是：' + said.join('；') + '。'), round ? '核图2' : '核图', imgs, fmtRetry(kfCheckParse));
      return kfCheckParse(text);
    } catch (e) { if (j.停) throw e; log('关键帧核图没做成：' + e.message); return null; }
  }
  /* 关键帧那一段：看 → 出 → 核（不行的再出一回）。返回 { frames, vid, bm, add }；新图、新字都还在任务文件夹里，换上在后面 */
  async function kfStage(j, o) {
    const { regs, name, step } = o;
    const vid = await kfVid(j, regs, o.planMd), bm = vid && !vid.newer ? bmFixes(o.plan, o.dec) : [];
    const frames = await kfList(j, o.lines, regs, o.s, o.gone, o.notesMd, vid), res = { frames, vid, bm, add: [] };
    if (vid) step('白模', vid.newer ? '出方案以后重渲过，当改好了' : bm.length ? bm.length + ' 处要回白模改：这里改不了，改完给你一段交给 Claude 的话' : '不用改', '做完');
    if (!frames.length) return res;
    if (!KeyFrames) throw fail('读不了 公用/关键帧写法.js，关键帧这一段做不了');
    const kdir = path.join(j.dir, '关键帧');
    await fsp.mkdir(kdir, { recursive: true });
    step('看关键帧', '在截白模、备材料', '在做');
    for (const f of frames) if (vid && vid.has && f.sec != null) f.bmf = await grabAt(vid.abs, vid.secs ? Math.min(f.sec, Math.max(0, vid.secs - 0.05)) : f.sec, path.join(kdir, f.stem + '_白模帧.png'));
    const imgs = [], said = [], see = (p, t) => { if (p && imgs.length < KF_SEE) { imgs.push(p); said.push(t); } };
    for (const f of frames) if (f.has) see(f.img, f.ref + ' 原来的图');
    for (const f of frames) if (f.bmf) see(f.bmf, f.ref + ' 那一刻的白模（第 ' + f.sec + ' 秒）');
    for (const f of frames) if (f.mark) see(f.mark, f.ref + ' 图上批注的标注图');
    const pool = [];
    for (const r of regs) if (/^@图片\d+$/.test(r.ref) && /\.(png|jpe?g|webp)$/i.test(r.path) && !frames.some(f => f.ref === r.ref) && await exists(pj(j.项目, ...r.path.split('/')))) pool.push({ path: r.path, what: r.ref + (r.name ? '，' + r.name : '') });
    const book = kfBook(j, { ...o, frames, vid, bm, pool, lessons: await lessonsOf(j.项目), said: imgs.length ? '让你看过的图依次是：' + said.join('；') + '。先对着图看。' : '' });
    if (j.停) throw fail('停掉了');
    step('看关键帧', (j.渠道 === SELF ? '你的 AI' : chLabel(j)) + ' 在看 ' + frames.length + ' 张关键帧', '在做');
    const got = jsonIn(await askText(j, j.渠道, book, '看关键帧', imgs, fmtRetry(jsonIn))), arr = Array.isArray(got.关键帧) ? got.关键帧 : [];
    const bmShots = new Set(bm.flatMap(b => b.shots));
    for (const f of frames) {
      const x = arr.find(y => y && str(y.编号).trim() === f.ref) || null;
      let way = x && KF_WAYS.includes(str(x.做法).trim()) ? str(x.做法).trim() : '';
      Object.assign(f, { 为什么: x ? oneLine(x.为什么).slice(0, 300) : '', prompt: x ? str(x.出图提示词).trim() : '', keep: x ? oneLine(x.要撑住).slice(0, 200) : '', 改哪儿: x ? oneLine(x.改哪儿).slice(0, 400) : '' });
      for (const g of (x && Array.isArray(x.参考图) ? x.参考图 : [])) {   // 只认项目 资产 里还在的图，不要关键帧自己
        const p = str(g).trim().replace(/\\/g, '/'), k = p.indexOf('资产/'), r = k >= 0 ? p.slice(k) : '';
        if (f.refs.length < KF_REFS - (f.bmf ? 1 : 0) && r && /\.(png|jpe?g|webp)$/i.test(r) && r.split('/').every(nameOk) && !f.refs.includes(r) && !frames.some(z => z.path === r) && await exists(pj(j.项目, ...r.split('/')))) f.refs.push(r);
      }
      if (!way) { way = f.gone ? '拿掉' : '留着'; f.为什么 = f.gone ? '你弃用了这张，AI 没给新的字，先拿掉' : 'AI 没说这张，照旧留着'; }
      if (way === '小改' && (!f.has || f.gone)) way = '重出';   // 弃用了的不在旧图上改
      if (way === '留着' && f.gone) way = '重出';
      if (way === '小改' && !f.改哪儿 && !f.note) way = '留着';   // 没说改哪儿：照旧
      if (way === '重出' && f.prompt.length < 40) { way = '拿掉'; f.失败 = true; f.为什么 = (f.为什么 ? f.为什么 + '；' : '') + 'AI 没写出图提示词，先拿掉'; }
      if ((way === '重出' || way === '小改') && f.no != null && bmShots.has(f.no)) { way = '拿掉'; f.等白模 = true; f.为什么 = '白模镜头' + f.no + '要先改：白模改好，到「提示词」那一步补'; }
      f.做法 = way;
      if (way === '留着') f.结果 = '留着';
      else if (way === '拿掉') f.结果 = f.失败 ? '没出成' : '拿掉';
    }
    res.add = (Array.isArray(got.要加) ? got.要加 : []).map(a => ({ 镜头: Number(a && a.镜头) || 0, 为什么: oneLine(a && a.为什么).slice(0, 200) })).filter(a => a.为什么).slice(0, 8);
    const cnt = k => frames.filter(f => f.做法 === k).length;
    step('看关键帧', 'AI 看完了：' + KF_WAYS.map(k => cnt(k) ? k + ' ' + cnt(k) + ' 张' : '').filter(Boolean).join('、'), '做完');
    const todo = frames.filter(f => f.做法 === '重出' || f.做法 === '小改');
    if (!todo.length) return res;
    if (!(j.渠道 === SELF || (CHANNELS.mock && j.渠道 === 'mock') || CHANNELS.codex.ok())) {
      for (const f of todo) Object.assign(f, { 结果: '没出成', 为什么: '这台电脑上调不起 Codex，出不了图' });
      return res;
    }
    j.subs = [];
    const width = j.渠道 === SELF ? 1 : KF_PAR;
    for (const f of todo) { f.步名 = f.ref + (f.时刻 ? ' ' + f.时刻 : ''); await kfWords(j, f, kdir, name); step(f.步名, f.做法 + '，排着队', ''); }
    const draw = async (f, round) => {
      step(f.步名, round ? '核图说不行，Codex 在再出一回' : f.做法 === '小改' ? 'Codex 在小改' : 'Codex 在出图', '在做');
      try { f.新图 = await kfDraw(j, f, kdir, round); step(f.步名, '出好了，等核图', '在做'); }
      catch (e) { if (j.停) throw e; Object.assign(f, { 新图: '', 结果: '没出成', 为什么: (round ? '再出一回' : '出图') + '没成：' + (e.plain ? e.message : '出错了：' + e.message) }); step(f.步名, f.为什么, '没成'); }
    };
    j.步骤 = '在出图：' + todo.length + ' 张，' + (width > 1 ? '最多 ' + width + ' 张一起出' : '一张一张交');
    await kfPool(todo, width, f => draw(f, 0));
    if (j.停) throw fail('停掉了');
    let list = todo.filter(f => f.新图);
    for (let round = 0; list.length && round < 2; round++) {
      j.步骤 = (j.渠道 === SELF ? '你的 AI' : chLabel(j)) + ' 在核 ' + list.length + ' 张新图';
      const v = await kfCheck(j, list, kdir, round, step), bad = [];
      for (const f of list) {
        const x = v && v.get(f.ref);
        f.核图 = !v ? '没核成' : !x ? 'AI 没核这张' : !x.ok ? x.bad || '不行' : !x.bad || /没看出问题/.test(x.bad) ? '没看出问题' : '没看出问题；小毛病：' + x.bad;   // 过了的带上「没看出问题」：提示词那一步照它认是不是有问题
        if (x && !x.ok) bad.push(Object.assign(f, { 毛病: x.bad || '不行', 怎么改: x.fix }));
        else { f.结果 = '换上'; step(f.步名, (round ? '再出一回，' : '') + '核图：' + f.核图, '做完'); }
      }
      if (!bad.length) break;
      if (round) { for (const f of bad) { Object.assign(f, { 结果: '没出成', 新图: '', 为什么: '再出一回核图还是不行：' + f.毛病 }); step(f.步名, f.为什么, '没成'); } break; }
      for (const f of bad) { Object.assign(f, { 再出: true, 第一回: f.新图, 第一回核图: f.核图, 新图: '' }); await kfWords(j, f, kdir, name, f.怎么改 || f.毛病); }
      await kfPool(bad, width, f => draw(f, 1));
      if (j.停) throw fail('停掉了');
      list = bad.filter(f => f.新图);
    }
    return res;
  }
  /* 换上一张：旧图连它的批注（重出的还有字、白模截图）用同一个时间进历史记录，新图用原来的名字放回去（任务文件夹里留一份）。换不上就都放回去 */
  async function kfSwap(j, f, stamp, name) {
    const q = f.path.split('/'), d = q.slice(0, -1), abs = pj(j.项目, ...q), wd = ['提示词', segDir(j.段)], back = [], made = [];
    const away = async parts => { const a = await archive(j.项目, parts, stamp); if (a) back.push([a, pj(j.项目, ...parts)]); return a; };
    const put = async (p, fn) => { const had = await exists(p); await fn(); if (!had) made.push(p); f.touch.push(p); };
    try {
      const old = await away(q);
      f.旧图 = old ? path.relative(pj(j.项目), old).split(path.sep).join('/') : '';
      await put(abs, async () => {
        if (f.ext === '.png' || !FFMPEG) await fsp.copyFile(f.新图, abs);
        else { await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', f.新图, '-y', abs], { timeout: 60e3 }); if (!(await exists(abs))) await fsp.copyFile(f.新图, abs); }   // 原来是 jpg 的照旧存成 jpg
      });
      for (const t of [f.stem + '_批注.md', f.stem + '_批注截图', f.stem + '_候选.png']) await away([...d, t]);   // 图上的批注、照批注改出的候选，说的都是旧图
      if (f.做法 === '重出') {
        for (const w of f.words) await away(w.split('/'));   // 旧的字（_提示词.txt，手写的 _改图提示词.txt）
        await away([...wd, f.stem + '_提示词_批注.md']);
        await away([...d, f.stem + '_白模帧.png']);
        const bmf = f.bmf ? pj(j.项目, ...d, f.stem + '_白模帧.png') : '', wr = [...wd, f.stem + '_提示词.txt'];
        if (bmf) await put(bmf, () => fsp.copyFile(f.bmf, bmf));
        await put(pj(j.项目, ...wr), () => writeFile(pj(j.项目, ...wr), kfWordText(j, f, name, bmf)));
        f.字 = wr.join('/');
      } else f.字 = f.words[0] || '';
    } catch (e) {
      for (const p of made) await fsp.unlink(p).catch(() => {});
      for (const [a, b] of back.reverse()) await fsp.rename(a, b).catch(() => {});
      f.touch = [];
      throw e;
    }
  }
  /* 交给 Claude 改白模的一段话（页面上点「复制」） */
  function bmAsk(j, vid, bm) {
    return ['请改「' + j.项目 + '」第' + j.段 + '段的白模：' + vid.abs + (vid.text ? '（说明：' + vid.note + '）' : '') + '。审片以后照修改方案，要改这几处：',
      ...bm.map((b, i) => '①②③④⑤⑥⑦⑧⑨'.charAt(i) + (b.shots.length ? ' 镜头' + b.shots.join('、') + '：' : ' ') + b.text),
      '就地改原工程、只重渲受影响的镜头，出图照本机的渲染排队规则；改完把白模说明里的切点、说明跟着改好。改好告诉我，这几镜的关键帧我到流水线「提示词」那一步点「出关键帧…」补。'].join('\n');
  }

  /* ---------- 任务：排队、一个一个做 ---------- */
  const jobs = [], byId = new Map();
  let seq = 0;
  const lockOf = j => j.项目 + '｜' + j.事 + '｜' + (KINDS[j.事].key ? KINDS[j.事].key(j) : j.段 || '');
  const live = j => j.状态 === '排队' || j.状态 === '在做';
  const usesCodex = j => j.渠道 === 'codex' || (!!KINDS[j.事].codex && j.渠道 !== SELF);   // 给我提示词的：人贴进自己的 Codex，不经 codex-chat
  /* 这会儿只是在等人、等看得见的 AI 回话（给我提示词、Claude 桌面版），不占那三个位子、不占 Codex。DeepSeek 的窗口是真在算，照旧占位子（免得一下弹十个窗口） */
  const idle = x => (!!x.交给 && !!x.交给.等 && x.交给.方式 !== 'deepseek') || !!x.等Claude;
  const fileOf = j => KINDS[j.事].file ? j.项目 + '｜' + KINDS[j.事].file(j) : '';
  const pub = j => ({ id: j.id, 事: j.事, 渠道: j.渠道, 渠道名: chLabel(j), 深度: depthOf(j), 模型: modelOf(j), 项目: j.项目, 段: j.段 || '', 标题: j.标题, 状态: j.状态, 步骤: j.步骤, 建: j.建, 开始: j.开始, 结束: j.结束, 错误: j.错误, 结果: j.结果, 产出: j.产出,
    记录: j.dir ? path.relative(ROOT, j.dir).split(path.sep).join('/') : '', 人物: j.人物, 道具: j.道具, 批注: j.批注, 类别: j.类别, 名: j.名, 状态名: j.状态名, 视频: j.视频, 只批: j.只批, 镜头号: j.镜头号, 文件名: j.文件名, 只名: j.只名, 只: (j.只 || []).map(x => x.类别 + '/' + (x.图 ? stemOf(x.图) : x.状态名 ? x.名称 + '_' + x.状态名 : x.名称)), 只提示词: (j.只 || []).map(x => x.提示词 || ''), 本机: !!KINDS[j.事].local,
    分步: j.分步 || null,   // 照方案改：改字、白模、看关键帧、每一张关键帧各做到哪（审片台一行一行摆）
    交给: j.交给 && j.交给.等 ? { 方式: j.交给.方式, 等: j.交给.等 } : null });   // 在等交给 AI 的回复：怎么交的（self 给我提示词 / claude / deepseek）、等什么（你 / 发送 / 做）
  function pump() {
    for (const j of jobs) {
      if (j.状态 !== '排队') continue;
      const busy = jobs.filter(x => x.状态 === '在做'), heavy = busy.filter(x => !idle(x));
      const light = ['self', 'claude'].includes((CHANNELS[j.渠道] || {}).hand) && !KINDS[j.事].run;   // 交给人、交给 Claude 桌面版的一步事：开起来就是等，不占位子
      if ((!light && heavy.length >= 3) || busy.some(x => lockOf(x) === lockOf(j)) || (usesCodex(j) && busy.some(x => usesCodex(x) && !idle(x)))) continue;   // Codex 桌面版一次只能做一件
      if (fileOf(j) && busy.some(x => fileOf(x) === fileOf(j))) continue;   // 同一份稿一次只做一件
      work(j);
    }
  }
  async function work(j) {
    const K = KINDS[j.事], ch = CHANNELS[j.渠道];
    j.状态 = '在做'; j.开始 = j.开始0 || Date.now(); j.步骤 = '在备材料';
    try {
      if (!j.dir) j.dir = pj(j.项目, '历史记录', 'AI任务', stampOf() + '_' + j.事 + (j.段 ? '_第' + j.段 + '段' : ''));   // 服务重开后接着等回复的：还是原来那个文件夹
      await fsp.mkdir(j.dir, { recursive: true });
      if (K.run) {   // 不止一步的事（出图、出片、生成任务书）：自己管自己
        const r0 = await K.run(j);
        Object.assign(j, { 状态: '做完', 结果: r0.结果, 产出: r0.产出 || [] });
        log('AI 任务做完：' + j.标题 + '（' + Math.round((Date.now() - j.开始) / 1000) + ' 秒）');
        return;
      }
      const book = await K.book(j);
      const files = { book: path.join(j.dir, '任务书.md'), answer: path.join(j.dir, '答卷.md'), raw: path.join(j.dir, '答卷_原样.md'), msg: path.join(j.dir, '发给Codex的话.txt') };
      if (!j.续) await writeFile(files.book, book);   // 接着等的：任务书 AI 已经照着做了，不重写
      if (j.停) throw fail('停掉了');
      j.步骤 = chLabel(j) + ' 在写';
      let r;
      for (;;) {
        const text = await ch.ask(j, book, files, j.images || []);
        await writeFile(files.answer, text);
        if (j.停) throw fail('停掉了');
        j.步骤 = '在存盘';
        try { r = await K.apply(j, text); break; }
        catch (e) {   // 交给人、交给 Claude 桌面版的：回复格式不对，接着等 AI 改好回复文件（别的照旧算没成；DeepSeek 的窗口做完就关了，也算没成）
          if (!j.交给 || j.交给.方式 === 'deepseek' || !e.plain || !/没按要的格式|JSON 读不了/.test(e.message)) throw e;
          j.格式错 = e.message; j.格式错时 = Date.now();
        }
      }
      Object.assign(j, { 状态: '做完', 结果: r.结果, 产出: r.产出 || [] });
      log('AI 任务做完：' + j.标题 + '（' + chLabel(j) + '，' + Math.round((Date.now() - j.开始) / 1000) + ' 秒）');
    } catch (e) {
      j.状态 = j.停 ? '停了' : '没成'; j.错误 = j.停 ? '你点了停' : (e.plain ? e.message : '出错了：' + e.message);
      log('AI 任务' + j.状态 + '：' + j.标题 + '　' + j.错误);
    } finally { j.结束 = Date.now(); j.步骤 = ''; j.child = null; j.等Claude = false; if (j.dir && (j.交给 || j.续)) selfDone(j); pump(); }
  }
  /* resume：服务重开后接着等回复的（resumeSelf 给的，网页上来的请求没有这一样） */
  async function create(b, resume) {
    const K = KINDS[str(b.事)];
    if (!K) throw fail('不认识这件事：' + b.事);
    if (K.local) b.渠道 = b.渠道 && CHANNELS[b.渠道] ? b.渠道 : Object.keys(CHANNELS)[0];   // 不用 AI 的事：渠道随便挂一个
    const ch = CHANNELS[str(b.渠道)];
    if (!ch) throw fail('不认识这个渠道：' + b.渠道);
    if (!K.local && !ch.ok()) throw fail('这台电脑上 ' + ch.名 + ' 调不起来');
    if (!nameOk(str(b.项目)) || !(await exists(pj(b.项目)))) throw fail('没有这个项目：' + b.项目);
    /* 推理深度、模型：只认这个 AI 能定的那几样；空＝照它的默认。这里定不了的（Codex、Claude 桌面版、DeepSeek 窗口、给我提示词），页面传了也不用 */
    const dp = K.local || !(ch.深度 || []).length ? '' : str(b.深度).trim();
    if (dp && !ch.深度.includes(dp)) throw fail(ch.名 + ' 的推理深度只能是 ' + ch.深度.map(depthName).join('、'));
    const md = K.local || !(ch.模型 || []).length ? '' : str(b.模型).trim();
    if (md && !ch.模型.includes(md)) throw fail(ch.名 + ' 的模型只能是 ' + ch.模型.map(modelName).join('、'));
    const j = { id: Date.now().toString(36) + (++seq).toString(36), 事: b.事, 渠道: b.渠道, 项目: b.项目, 段: str(b.段), 状态: '排队', 步骤: '', 建: Date.now(), 开始: 0, 结束: 0, 错误: '', 结果: '', 产出: [], dir: '', child: null, 停: false };
    if (dp) j.深度 = dp;
    if (md) j.模型 = md;
    j.请求 = Object.fromEntries(Object.entries(b).filter(([k]) => k !== '项目' && k !== '渠道'));   // 记下当初的请求：交给 AI 等回复的，服务重开以后照它接着等
    if (resume) Object.assign(j, { id: resume.id, dir: resume.dir, 建: resume.建 || j.建, 开始0: resume.开始 || 0, 开0: resume.开 || 0, 续: true });
    if ((K.need || []).includes('段') && !segOk(j.段)) throw fail('要说清是第几场');
    for (const k of ['人物', '道具']) if (Array.isArray(b[k])) j[k] = b[k].map(str).filter(Boolean);
    if (b.批注) j.批注 = str(b.批注);
    for (const k of ['类别', '名', '状态名', '要求', '视频', '批准', '只批', '镜头号', '镜头ID', '重写', '白模', '跳过核验']) if (b[k] != null) j[k] = str(b[k]);
    if (b.写什么 != null) j.写什么 = str(b.写什么).trim().slice(0, 500);   // 写提示词：这一条写哪段戏（人写的一句话，可以不写）
    if (b.关键帧 != null) j.关键帧 = Array.isArray(b.关键帧) ? b.关键帧.map(str) : str(b.关键帧);   // 写提示词：这一条挂的关键帧（是不是这一段的图，prep 里查）
    if (Array.isArray(b.镜头)) j.镜头 = b.镜头.map(Number).filter(n => n > 0);
    if (Array.isArray(b.段落)) j.段落 = b.段落.map(Number).filter(n => n > 0);
    if (b.参数 && typeof b.参数 === 'object') j.参数 = b.参数;
    if (K.prep) await K.prep(j);
    j.标题 = K.title(j);
    const same = jobs.find(x => live(x) && lockOf(x) === lockOf(j));
    if (same) return same;   // 同一件事已经在做：不重开
    jobs.push(j); byId.set(j.id, j);
    while (jobs.length > 200) byId.delete(jobs.shift().id);
    log('开了一个 AI 任务：' + j.标题 + '（' + chLabel(j) + '）');
    pump();
    return j;
  }
  function cancel(j) {
    if (!live(j)) return;
    j.停 = true;
    if (j.状态 === '排队') { j.状态 = '停了'; j.错误 = '你点了停'; j.结束 = Date.now(); }
    else {
      kill(j.child);
      for (const s of j.subs || []) kill(s.child);   // 照方案改几张图一起出的：每张自己的 Codex 进程一起停
      if (j.交给 && j.交给.方式 === 'deepseek' && j.dir) HAND.dsStop(j.dir);   // DeepSeek 的窗口连它跑的一起关掉
      if (j.醒) j.醒();   // 在等回复的：叫醒它，马上停
    }
  }

  /* ---------- 交给 AI（11-14 他定：用 AI 的地方都有两种——给我提示词、项目直接调；直接调一律看得见）----------
     三种交法，等回复是同一套：
       self      给我提示词：不调 AI，人把「交给 AI 的话」贴进自己开的对话（Codex、Claude、DeepSeek 都行；出图、改图、出片要贴进 Codex）
       claude    在 Claude 桌面版新开一个对话，话填好，人按一下发送（Claude 的规矩：外面带进来的话要人按，这边不替人按）
       deepseek  开一个窗口跑 DeepSeek Harness（只读），窗口把它的回答写进回复文件、告诉这边
     AI 做完把回复写进这一回文件夹里的 回复.md：这边两秒看一眼，文件停住三秒不动就接着落盘；
     AI 能跑命令的，再跑一句 node server.js reply <任务号> 告诉这边，不用等那三秒；
     AI 写不了文件，人把它的回复贴回页面也行（POST /api/job/<号>?reply）。回复格式不对就接着等它改好（DeepSeek 的窗口做完就关了，格式不对算没成）。
     一个任务里交几回的（核图、照方案改）：每回带个名，文件叫 回复_<名>.md、交给AI的话_<名>.txt。
     服务重开过：三天内没了结的，开起来接着等（文件夹里的 自己交.json 记着当初的请求；出图这类不止一步的接不上，要重点一次） */
  const SERVER_JS = path.join(__dirname, 'server.js').replace(/\\/g, '/');
  const PORT = Number(process.env.ANTOU_PORT) || 8766;   // 和 server.js 一样算：DeepSeek 的窗口做完照它告诉这边
  const tellLines = j => ['写完跑下面这一句，告诉项目做完了（跑不了也没关系，项目自己会看到这个文件）：', 'node "' + SERVER_JS + '" reply ' + j.id];
  const seeLines = imgs => imgs.length ? ['动笔前先把这几张图各看一遍：', ...imgs] : [];
  function selfMsg(j, files, imgs) {   // 给我提示词、Claude 桌面版：读任务书、写回复文件、跑一句告诉项目
    return ['请读这份任务书，照里面的要求做：', files.book, ...seeLines(imgs),
      '读文件用命令行或者读文件的工具，要用的材料任务书里都带齐了。不要用 Computer Use，不要打开别的软件、窗口。',
      '做完把回复（照任务书里「回复的格式」，只要那几块）一次写进下面这个文件，用 UTF-8。除了它，别的文件一律不改、不新建：', files.reply,
      ...tellLines(j)].join('\n');
  }
  function dsMsg(j, files, imgs) {   // DeepSeek 的窗口：它只读，回答由窗口写进回复文件，所以不叫它写文件、跑命令
    return ['请读这份任务书，照里面的要求做：', files.book, ...seeLines(imgs),
      '只读：用读文件的工具读，要用的材料任务书里都带齐了；不要改、不要新建任何文件，不要跑命令。',
      '读完直接回复：照任务书里「回复的格式」，只要那几块，前后不加别的话。你的回复会原样交给项目。'].join('\n');
  }
  function codexMsg(j, files) {   // 给我提示词时要用 Codex 做的事（出图、改图、出片）：照原来交给 Codex 的话，再写清做完写回复、告诉项目
    return [files.codex, '',
      ...(files.核图 ? ['图存好以后，对着提示词文件核一遍：字里要的、要撑住的，图里有没有缺的、画错的；有没有多出字里没有、又不该有的东西（视频会照抄）；合不合理（东西摆在哪、光从哪来）。'] : []),
      '做完把回复（任务书里要你回复的那几样）写进下面这个文件，用 UTF-8；任务书说别的文件都不动，这一个除外' + (files.核图 ? '。第一行写「核图：」加一两句大白话说最要紧的问题，没问题就写「核图：没看出问题」' : '') + '：', files.reply,
      ...tellLines(j)].join('\n');
  }
  const selfNote = t => { const m = /^[ \t>*#-]*核图[：:][ \t]*(.+)$/m.exec(str(t)); return m ? oneLine(m[1]).slice(0, 300) : ''; };   // 给我提示词出的图：回复里顺手核图的那一句
  const nap = (j, ms) => new Promise(r => { j.醒 = r; setTimeout(r, ms); });
  const sayOf = j => j.格式错 ? '还差一点，等 AI 改好再告诉项目：' + j.格式错
    : j.交给.方式 === 'claude' ? (j.交给.等 === '发送' ? '等你在 Claude 里按发送' : 'Claude 在做（在 Claude 窗口里看）')
    : j.交给.方式 === 'deepseek' ? 'DeepSeek 在做（在它的窗口里看）' : '等你交给 AI';
  /* 交出去，等回复。how：self / claude / deepseek。check：回复到了先查一遍（图存到了没有），查出 retry 的接着等，不算没成 */
  async function handoff(j, files, how, images, check) {
    const tag = files.tag ? '_' + files.tag : '', imgs = images || [];
    files.reply = path.join(j.dir, '回复' + tag + '.md');
    const msgFile = path.join(j.dir, '交给AI的话' + tag + '.txt');
    if (j.交给 && j.交给.回复 === files.reply) j.交给.等 = how === 'self' ? '你' : '做';   // 回复格式不对、接着等的：不重开
    else {
      if (how === 'claude' && !j.续) {   // Claude 桌面版一次只摆一个等人按发送的新对话：再开一个会把前一个盖掉
        j.等Claude = true; j.步骤 = '等前一个 Claude 对话按了发送，再开这一个';
        try {
          while (jobs.some(x => x !== j && live(x) && x.交给 && x.交给.方式 === 'claude' && x.交给.等 === '发送')) {
            if (j.停) throw fail('停掉了');
            await nap(j, 2000);
          }
        } finally { j.等Claude = false; }
      }
      const text = files.codex ? codexMsg(j, files) : how === 'deepseek' ? dsMsg(j, files, imgs) : selfMsg(j, files, imgs);
      const 开 = j.续 ? (j.开0 || j.开始 || Date.now()) : Date.now();
      Object.assign(j, { 交代: text, 读过: '', 格式错: '', 格式错时: 0 });
      j.交给 = { 方式: how, 等: how === 'self' ? '你' : how === 'claude' ? '发送' : '做', 回复: files.reply, 开, 要Codex: !!files.codex };   // 先占上（同步）：别的任务看得到这一个在等发送
      if (j.续 && how === 'claude' && HAND.claudeStarted(j.id, 开)) j.交给.等 = '做';
      j.步骤 = sayOf(j);
      await writeFile(msgFile, text + '\n');
      await writeFile(path.join(j.dir, '自己交.json'), JSON.stringify({ id: j.id, 项目: j.项目, 建: j.建, 开始: j.开始, 请求: j.请求, 渠道: j.渠道, 方式: how, 开, 回复: files.reply, run: !!KINDS[j.事].run }, null, 1) + '\n');
      if (!j.续) {
        try {
          if (how === 'claude') await HAND.openClaude(text, pj(j.项目));
          else if (how === 'deepseek') await HAND.openDeepSeek({ dir: j.dir, cwd: pj(j.项目), title: j.标题, msgFile, replyFile: files.reply, id: j.id, port: PORT });
        } catch (e) { throw fail((how === 'claude' ? 'Claude 桌面版的新对话' : 'DeepSeek Harness 的窗口') + '没开起来：' + e.message); }
      }
      j.续 = false;
    }
    for (;;) {
      const text = await waitReply(j, files);
      j.格式错 = '';
      if (check) {
        try { await check(text); }
        catch (e) {
          if (!e.retry || how === 'deepseek') throw e;
          Object.assign(j, { 格式错: e.message, 格式错时: Date.now(), 读过: '' });   // 回复留着，过一会儿再看一回（图存好了就接着走）
          j.交给.等 = how === 'self' ? '你' : '做';
          await nap(j, 3000);
          continue;
        }
      }
      j.交给.等 = '';
      return text;
    }
  }
  function tick(j) {   // 等回复时顺便看：Claude 那边按了发送没有、DeepSeek 的窗口还在不在
    const g = j.交给;
    if (g.方式 === 'claude' && g.等 === '发送') {
      const s = HAND.claudeStarted(j.id, g.开);
      if (s) { g.等 = '做'; g.会话 = s.session; j.步骤 = sayOf(j); }
    } else if (g.方式 === 'deepseek') {
      const s = HAND.dsState(j.dir);
      if (s && s.状态 === '出错') throw fail('DeepSeek 没做成：' + (s.错误 || '在它的窗口里看'));
      if (!s && Date.now() - g.开 > 90e3) throw fail('DeepSeek Harness 的窗口没开起来');
    }
  }
  async function readReply(file) {   // AI 写的回复：UTF-8；PowerShell 写成 UTF-16 的也认；别的编码读出乱码的不收
    const buf = await fsp.readFile(file);
    const t = buf[0] === 0xFF && buf[1] === 0xFE ? buf.slice(2).toString('utf16le') : unbom(buf.toString('utf8'));
    return t.includes('\uFFFD') ? null : t;
  }
  async function waitReply(j, files) {
    const say = () => sayOf(j);
    j.步骤 = say();
    let sig = '', since = 0;
    for (;;) {
      if (j.停) throw fail('停掉了');
      if (j.贴的 != null) {   // 页面贴回来的：也存成 回复.md（存下的这一版算读过，格式不对时不再收它）
        const t = j.贴的; j.贴的 = null;
        await writeFile(files.reply, t);
        const s2 = await fsp.stat(files.reply).catch(() => null);
        j.读过 = s2 ? s2.size + ':' + s2.mtimeMs : '';
        return t;
      }
      const st = await fsp.stat(files.reply).catch(() => null), now = st && st.isFile() && st.size > 0 ? st.size + ':' + st.mtimeMs : '';
      if (now && now !== j.读过) {   // 读过的那一版（格式不对的）不再收，等它改
        if (now !== sig) { sig = now; since = Date.now(); j.步骤 = j.格式错 ? say() : 'AI 在写回复'; }
        if (j.催 || Date.now() - since >= 3000) {
          j.催 = false;
          const t = await readReply(files.reply);
          j.读过 = now;
          if (t != null && t.trim()) return t;
          j.格式错 = path.basename(files.reply) + ' 读出来是乱码，要用 UTF-8 写'; j.格式错时 = Date.now(); j.步骤 = say();
        }
      } else { j.催 = false; if (!now) j.步骤 = say(); }
      tick(j);
      await nap(j, 2000);
    }
  }
  /* AI 跑了 node server.js reply（不带回复：去看回复文件），DeepSeek 的窗口做完了，或者页面把回复贴回来了：等这边落完盘再回话 */
  async function takeReply(j, text) {
    if (!j.交给) throw fail('这个任务不是交给 AI 等回复的');
    if (!live(j)) return pub(j);   // 已经接上了（这边自己看到了回复文件），或者停了
    const t0 = Date.now(), file = j.交给.回复;
    if (text.trim()) {
      if (!j.交给.等) throw fail('这一回的回复已经收到了，在接着做');
      j.贴的 = text;
    } else {
      const st = await fsp.stat(file).catch(() => null);
      if (!st || !st.size) throw fail('没看到回复文件：' + file + '。先把回复写进这个文件，再跑这一句');
      if (j.读过 && st.size + ':' + st.mtimeMs === j.读过) return { ...pub(j), 格式错: j.格式错 || '回复文件还是上回收过的那一版' };   // 没改过：照上回说
      j.催 = true;
    }
    if (j.醒) j.醒();
    for (let i = 0; i < 480 && live(j) && !(j.格式错时 > t0) && j.交给.回复 === file; i++) await sleep(250);   // 换到下一回交给 AI 了（照方案改这类不止交一回的）：先回话
    return { ...pub(j), 格式错: j.格式错时 > t0 ? j.格式错 : '' };
  }
  function selfDone(j) {   // 这一回了结了（做完、没成、停了）：服务再重开也不接着等
    const meta = path.join(j.dir, '自己交.json');
    fsp.readFile(meta, 'utf8').then(t => writeFile(meta, JSON.stringify({ ...JSON.parse(unbom(t)), 结束: nowText(), 状态: j.状态 }, null, 1) + '\n')).catch(() => {});
  }
  async function resumeSelf() {
    const old = Date.now() - 3 * 864e5;
    for (const p of await fsp.readdir(HOME).catch(() => [])) {
      const base = pj(p, '历史记录', 'AI任务');
      for (const d of await fsp.readdir(base).catch(() => [])) {
        const t = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})_/.exec(d);
        if (!t || new Date(+t[1], t[2] - 1, +t[3], +t[4], +t[5], +t[6]).getTime() < old) continue;
        const dir = path.join(base, d), meta = path.join(dir, '自己交.json');
        if (!(await exists(meta))) continue;
        try {
          const m = JSON.parse(unbom(await fsp.readFile(meta, 'utf8')));
          if (m.结束 || !m.id || byId.has(m.id) || !m.请求 || m.run) continue;   // 出图这类不止一步的：接不上，要重点一次
          const chId = str(m.渠道) || SELF, ch = CHANNELS[chId];   // 11-14 头一版的 自己交.json 没写渠道：都是给我提示词
          if (!ch || (ch.hand || '') !== (str(m.方式) || 'self')) continue;   // 这台电脑上那种交法没了（比如卸了 Claude 桌面版）：不接
          const j = await create({ ...m.请求, 项目: p, 渠道: chId }, { id: str(m.id), dir, 建: m.建, 开始: m.开始, 开: m.开 });
          log('服务重开前没等到回复的，接着等：' + j.标题);
        } catch (e) { log('交给 AI 等回复的没接上：' + d + '　' + (e.message || e)); }
      }
    }
  }
  setTimeout(() => resumeSelf().catch(e => log('接着等回复时出错：' + e.message)), 300);

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
  /* 出片前核对即梦账号和画布：这个登录位登着，画布在这个号名下（canvas ls 列得出来才能改；列不出来的只能看）。
     11-14 出过一回：出片设置里的画布是奔跑号的，任务书写的是默认号，Codex 到了画布上才发现只能看 */
  async function jmCheck(canvasUrl, profile) {
    const id = (/ai-canvas\/([0-9a-f-]{36})/i.exec(str(canvasUrl)) || [])[1];
    if (!id) throw fail('资产/出片设置.json 里没写画布，或者画布网址不对（要 https://jimeng.jianying.com/ai-tool/ai-canvas/… 这种）');
    if (!/^[A-Za-z0-9_-]{0,40}$/.test(profile)) throw fail('资产/出片设置.json 里的「登录位」名字不对：只能是字母、数字、横线，默认号留空');
    const pf = profile ? ['--profile', profile] : [], who = profile ? '登录位「' + profile + '」' : '默认号';
    const st = await jm([...pf, 'auth', 'status']);
    if (st.error) throw fail(st.error);
    if (!(st.data && st.data.data && st.data.data.loggedIn)) throw fail('即梦' + who + '没登录：先到首页「即梦授权」登录');
    const ac = await jm([...pf, 'auth', 'account']);
    const nick = str(((ac.data || {}).data || {}).displayName) || '读不出昵称';
    let cursor = '', hit = null;
    for (let i = 0; i < 20 && !hit; i++) {   // 一页最多 100 张，翻到底
      const r = await jm([...pf, 'canvas', 'ls', '--limit', '100', '--format', 'json', ...(cursor ? ['--cursor', cursor] : [])]);
      const d = r.data && r.data.data;
      if (!r.ok || !d || !Array.isArray(d.items)) throw fail('查不到即梦' + who + '名下有哪些画布：' + (r.error || r.raw || '没有回音').slice(0, 200));
      hit = d.items.find(x => x && x.projectId === id) || null;
      if (!d.hasMore || !d.nextCursor) break;
      cursor = d.nextCursor;
    }
    if (!hit) throw fail('画布 ' + id.slice(0, 8) + ' 不在即梦' + who + '（' + nick + '）名下，这个号只能看、不能改。资产/出片设置.json 里的「画布」和「登录位」要是同一个号的');
    return { id, nick, name: str(hit.name) || id.slice(0, 8) };
  }
  const canvas = require('./canvas.js')({ HOME, JM, run, log });   // 资产页看画布上的图（只读画布，11-14 加）
  async function jimeng(req, res, q, { json, httpErr }) {
    if (req.method === 'GET' && (q.has('canvas') || q.has('img'))) return canvas.handle(req, res, q, { json, httpErr });
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
        if (q.has('channels')) return json(res, { channels: Object.entries(CHANNELS).map(([id, c]) => {
          const d = c.默认深度 ? c.默认深度() : '';   // 推理深度：能选哪几档、不选时用哪档（空＝照那个 AI 自己的默认，说不准是哪档）
          const m = c.默认模型 ? c.默认模型() : '';   // 模型：同上
          return { id, 名: c.名, 说明: c.说明, ok: c.ok(), hand: c.hand || '', 模型: (c.模型 || []).map(x => ({ id: x, 名: modelName(x) })), 默认模型: m, 默认模型名: modelName(m), 模型说明: c.模型说明 || '',
            深度: (c.深度 || []).map(x => ({ id: x, 名: depthName(x) })), 默认深度: d, 默认深度名: d ? depthName(d) : '', 深度说明: c.深度说明 || '' };
        }) });
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
        if (req.method === 'POST' && q.has('reply')) return json(res, await takeReply(j, (await readBody(req, 4e6)).toString('utf8')));   // 交给 AI 的：回复到了
        if (req.method === 'GET' && q.has('msg')) {   // 交给 AI 的话：页面弹出来给人复制（给我提示词），Claude 没开出来时也能看、能复制
          if (!j.交给 || !j.交代) throw httpErr(409, '要交代的话还没备好，等一两秒');
          return json(res, { 话: j.交代, 方式: j.交给.方式, 等: j.交给.等, 标题: j.标题, 要Codex: !!j.交给.要Codex, 回复: j.交给.回复 });
        }
        if (req.method === 'POST' && q.has('reopen')) {   // Claude 里没看到新开的对话：再开一次（还没按发送的才行）
          if (!live(j) || !j.交给 || j.交给.方式 !== 'claude' || j.交给.等 !== '发送') throw fail('这一个不用再开了');
          try { await HAND.openClaude(j.交代, pj(j.项目)); } catch (e) { throw fail('Claude 桌面版的新对话没开起来：' + e.message); }
          return json(res, pub(j));
        }
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
