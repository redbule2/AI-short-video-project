'use strict';
/* ============================================================
   AI 任务：页面上点一下（按批注改、提炼、出图、批注提示词……），这里开一个任务，
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

module.exports = function makeJobs({ ROOT, TOOLS, log, withFileLocks = async (paths, fn) => fn(), filmed = null }) {   // filmed：出过片的提示词（11-22，filmed.js）
  const SKILLS = path.resolve(__dirname, '..');   // .agents/skills
  const HOME = path.join(ROOT, '项目');
  const RW = path.join(TOOLS, '剧本读写.js');
  /* 白模＋关键帧的写法（2026-11-14 他定：和普通写法分开，照官方指南）。2026-11-15 他定不再用：白模只当普通素材，可以只管其中几秒；
     这里只剩认老稿：已经一镜一镜写参考哪张的（「@图片…是各镜头的关键帧」），关键帧照这个写法留着、去掉关键帧时照它重排 */
  const BmKey = (() => { try { return require(path.join(TOOLS, '公用', '白模关键帧写法.js')); } catch (e) { log('读不了 公用/白模关键帧写法.js：' + e.message); return null; } })();
  /* 拍摄风格（2026-11-14 他定：剧本定稿以后照剧本挑，记在流水线.json 的「风格」）：风格库怎么读、交给 AI 时写哪几行，和页面同一套 */
  const Style = (() => { try { return require(path.join(TOOLS, '公用', '风格库.js')); } catch (e) { log('读不了 公用/风格库.js：' + e.message); return null; } })();
  /* 提示词的无损读写（和写稿页同一套） */
  const PromptDraft = (() => { try { return require(path.join(TOOLS, '公用', '写稿状态.js')); } catch (e) { log('读不了 公用/写稿状态.js：' + e.message); return null; } })();
  const Core = (() => { try { return require(path.join(TOOLS, '公用', '核心.js')); } catch (e) { log('读不了 公用/核心.js：' + e.message); return null; } })();
  /* 镜头表的固定号、关键帧绑在哪一镜哪一刻（2026-11-16 他定：号不挪，中间加的是 3b）：和流水线各页同一套 */
  const SB = (() => { try { return require(path.join(TOOLS, '公用', '关键帧绑定.js')); } catch (e) { log('读不了 公用/关键帧绑定.js：' + e.message); return null; } })();
  /* 每镜几秒（11-15 他定：AI 写稿、照批注改稿时顺手估，出片弹窗照它填时长）：和提示词那一步同一套 */
  const Secs = (() => { try { return require(path.join(TOOLS, '公用', '秒数.js')); } catch (e) { log('读不了 公用/秒数.js：' + e.message); return null; } })();
  /* 镜头表每一镜的作用（「标签｜目的，关系」）和预估秒数（11-16 他定）：和提炼页、写提示词勾镜头同一套 */
  const Why = (() => { try { return require(path.join(TOOLS, '公用', '镜头作用.js')); } catch (e) { log('读不了 公用/镜头作用.js：' + e.message); return null; } })();
  const secOf = x => Why ? Why.secOf(x) : 0;
  const Voice = (() => { try { return require(path.join(TOOLS, '公用', '音色.js')); } catch (e) { log('读不了 公用/音色.js：' + e.message); return null; } })();
  const isNarr = n => !!Voice && n === Voice.NARRATOR;   // 旁白是画外音（11-17）：不写字、不出图，只挂音色
  const TxtWord = (() => { try { return require(path.join(TOOLS, '公用', '文字描写.js')); } catch (e) { log('读不了 公用/文字描写.js：' + e.message); return null; } })();   // 只用文字写的资产的文字描写（11-17）
  const AssetEdit = (() => { try { return require(path.join(TOOLS, '公用', '资产改过.js')); } catch (e) { log('读不了 公用/资产改过.js：' + e.message); return null; } })();   // 资产改了，照新资产改提示词（11-17）
  const AP = require(path.join(TOOLS, '公用', '资产路径.js'));   // 资产放哪（2026-11-20：人物和道具、场景、关键帧/第N段）；老路径换新的、画布节点名也照它
  const Scope = (() => { try { return require(path.join(TOOLS, '公用', '资产归类.js')); } catch (e) { log('读不了 公用/资产归类.js：' + e.message); return null; } })();   // 出场的分全局、用在哪几镜，删掉的（11-17）
  const two = n => String(n).padStart(2, '0');
  const stampOf = (d = new Date()) => d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
  const nowText = (d = new Date()) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  const today = () => nowText().slice(0, 10);
  const mmdd = () => nowText().slice(5, 10);
  const timeOf = t => { const n = Date.parse(String(t || '').trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const unbom = s => s.replace(/^\uFEFF/, '');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const segOk = s => /^[0-9]+(-[0-9]+)*$/.test(s);
  /* 文件名能不能用、场景文字起名、视频提示词第几条改几：和流水线各页、审片台同一份（公用/核心.js）；读不了它就报错，服务照开 */
  const core = k => Core ? Core[k] : () => { throw fail('读不了 公用/核心.js'); };
  const nameOk = core('nameOk'), sceneStem = core('sceneStem');
  const exists = p => fsp.stat(p).then(() => true, () => false);
  const str = v => typeof v === 'string' ? v : '';
  const fail = msg => Object.assign(new Error(msg), { plain: true });
  const retry = msg => Object.assign(new Error(msg), { plain: true, retry: true });   // 交给 AI 等回复的：还差一点（图还没存好），接着等，不算没成
  const pj = (name, ...parts) => path.join(HOME, name, ...parts);
  const segDir = seg => '第' + seg + '段';
  const stemOf = f => path.basename(String(f)).replace(/\.[^.]+$/, '');   // 文件名去掉后缀
  const IMG_RE = /\.(png|jpe?g|webp)$/i;   // 认的图
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
  /* 跑一回 codex-chat：话在 file 里；secs 是它自己最多等几秒，ms 是这边最多等多久。顺手记下这一回实际用的模型和档 */
  async function cxRun(job, file, secs, ms) {
    const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', CX, '-PromptFile', file, '-Path', HOME, '-Timeout', String(secs)], { job, timeout: ms });
    const res = resultJson(r.out);
    cxSeen(job, res);
    return { ...r, res };
  }
  const CX_HEAD = '=== Codex 回复 ===';
  const cxReply = out => { const a = out.indexOf(CX_HEAD), z = out.lastIndexOf('RESULT_JSON '); return a >= 0 && z > a ? out.slice(a + CX_HEAD.length, z) : ''; };   // Codex 回的那一段
  const depthOf = j => j.深度 || j.实际深度 || '';   // 这个任务用的推理深度：选了的，或者做完读出来的
  const modelOf = j => j.模型 || j.实际模型 || '';   // 这个任务用的模型：选了的，或者做完读出来的
  const chLabel = j => { if (KINDS[j.事] && KINDS[j.事].local) return '流水线'; if (j.渠道 === SELF) return '你自己交的 AI'; const t = [modelName(modelOf(j)), depthName(depthOf(j))].filter(Boolean).join(' · '); return ((CHANNELS[j.渠道] || {}).名 || j.渠道) + (t ? '（' + t + '）' : ''); };   // 本机的活（排任务书、出片）不经 AI，叫「流水线」
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
        const r = await cxRun(job, files.msg, 1500, 27 * 60e3);
        await fsp.unlink(files.msg).catch(() => {});
        if (!r.res || !r.res.ok) throw fail('Codex 没答上来：' + ((r.res && r.res.error) || r.err.trim() || r.out.trim() || '没有结果').slice(0, 300));
        const text = cxReply(r.out);
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
  /* 试页面用的假通道：ANTOU_MOCK_DIR 里放 <事>.txt 当答卷；一个任务里问几回的，<事>_<这一回的名>.txt（比如 出图_核图.txt），没有就用 <事>.txt（只在试验服务上开） */
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
  async function imgsAt(name, list) {   // 流水线里记的几张图（项目里的路径）：还在的，换成完整路径
    const out = [];
    for (const g of list || []) { const p = pj(name, ...String(g).replace(/\\/g, '/').split('/')); if (IMG_RE.test(p) && await exists(p)) out.push(p); }
    return out;
  }
  const sceneOf = (flow, seg) => (Array.isArray(flow.场) ? flow.场 : []).find(s => s && str(s.段) === seg) || null;
  const parasOf = s => {   // 号：镜头表的固定号（页面存的；老数据没有就照先后补）
    const raw = (Array.isArray(s.段落) && s.段落.length ? s.段落 : Array.isArray(s.镜头) ? s.镜头 : []).filter(x => x && typeof x === 'object'), nos = SB ? SB.nosOf(raw) : raw.map((x, i) => String(i + 1));
    return raw.map((x, i) => ({ 号: nos[i], 写什么: str(x.写什么 !== undefined ? x.写什么 : x.拍什么).trim(), 作用: str(x.作用).trim(), 秒数: secOf(x), ...(x.秒数人定 && secOf(x) ? { 秒数人定: true } : {}), ...(Scope ? Scope.rowCast(x) : {}) })).filter(x => x.写什么 || x.作用);   // 人物、场景、道具：这一镜出场的（11-17）
  };
  const shotsOf = (s, name) => s && SB ? SB.shotsOf(vpCode(name), name, parasOf(s).map(x => x.号)) : null;   // 这份稿拍的是哪几镜：名字是镜头号的照镜头表认，老稿「镜头6-9_视频提示词」照名字里的数认，认不出给 null
  const rowsText = (rows, pick) => (Array.isArray(rows) ? rows : []).filter(e => e && e.名 && (!pick || pick.includes(e.名))).map(e => e.名 + '：' + (str(e.描写).trim() || '（还没写）')).join('\n') || '（没有）';
  async function docText(file) {
    if (/\.txt$/i.test(file)) return unbom(await fsp.readFile(file, 'utf8')).replace(/\r\n/g, '\n').replace(/\n+$/, '');   // 自由稿（先写提示词的段，11-21）
    const r = await node([RW, '读', file]);
    if (r.code !== 0) throw fail('读不了 ' + path.basename(file) + '：' + (r.out + r.err).trim().slice(0, 200));
    return r.out.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  }
  const scriptPath = (name, seg) => pj(name, '定稿的剧本', segDir(seg), segDir(seg) + '_剧本.docx');
  const shotsPath = (name, seg) => pj(name, '定稿的剧本', segDir(seg), segDir(seg) + '_镜头表.docx');
  const PF = require('./prompt-first.js')({ Core, pj, segDir, scriptPath, readFlow, sceneOf }), srcPath = PF.srcPath;   // 先写提示词的段（11-21）：「剧本」是自由稿
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
  const settingText = flow => ['梗概：' + (str(flow.梗概).trim() || '（还没写）'), '', '人物（叫法：描写）：', rowsText(flow.人物), '', '场景：' + (str(flow.场景).trim() || '（还没写）'), '', '道具（名字：描写）：', rowsText(flow.道具), ...(Scope ? ['', Scope.globalLine(flow)] : [])].join('\n');
  const segRefs = s => ['人物', '道具'].flatMap(k => (Array.isArray(s[k + '图']) ? s[k + '图'] : []).map(f => ({ k, f: String(f).replace(/\\/g, '/'), n: stemOf(f) })));   // 这一段文件夹里的图，这一场当人物、道具用的（流水线 11-13 起有；不挂表里哪一行）
  function sceneText(flow, s) {
    const ps = parasOf(s), seg = segRefs(s), say = str(s.表达).trim();   // 表达：老数据里的「想写什么」（11-16 晚删了这一格），有才列
    return ['出场的人物：' + ((s.人物 || []).join('、') || '（没选）'), '出场的道具：' + ((s.道具 || []).join('、') || '（没选）'),
      ...(seg.length ? ['这一段另挂的参考图（这一段文件夹里的，只这一段用）：' + seg.map(x => x.k + '「' + x.n + '」').join('、')] : []),
      ...(say ? ['这一段主要表达：' + say] : []), '', '镜头表（一共 ' + ps.length + ' 个镜头，照这个顺序；镜头号是固定的：删过的镜头不挪号，中间加的带字母，像 3b。作用写成「标签｜目的，关系」，关系里的镜N 是镜头号；秒数是提炼时照真人快慢估的，只作参考）：',
      ...ps.map(x => '镜头' + x.号 + '　写什么：' + (x.写什么 || '（空）') + '　起什么作用：' + (x.作用 || '（没写）') + (x.秒数 ? '　约 ' + x.秒数 + ' 秒' : '') + (Scope && Scope.castSay(x) ? '　' + Scope.castSay(x) : ''))].join('\n');   // 出场：这一镜出场的（提炼时标的，11-17）
  }
  function finalOk(s, scriptMtime) {   // 剧本定稿了没有：有这个时间，也不早于剧本文件最后改动的时间（11-16 起剧本在段落前面，不再和段落定下来的时间比）；之后只是照片子改过（回填，11-18）也算，和页面同一条（公用/核心.js）
    if (Core && Core.scriptFinal) return Core.scriptFinal(s.剧本定稿, s.回填, scriptMtime);
    const fin = timeOf(s.剧本定稿);
    return !!fin && fin + 999 >= scriptMtime;
  }

  /* ---------- 各样事：怎么写任务书（book），AI 答完怎么落盘（apply） ---------- */
  const TAIL = '\n\n只回复要的内容本身，不要解释，不要寒暄，不要用代码块围起来。';
  /* 提炼、提炼按批注改共用（11-16 他定：先写剧本，剧本定稿以后 AI 一次提炼出梗概、人物、场景、道具和镜头表）。
     AI 回的写进 定稿的剧本/第N段/第N段_提炼.json（原来那一份先收进历史记录）；页面看到新的一版，并进全片设定和这一场，人再改、写批注 */
  const DISTILL_RULES = ['1. 梗概：全片讲什么，三五句话。现在的梗概写过的，照这一段的剧本补上，改动尽量小，别的段的内容留着；还没写的，照这一段写。',
    '2. 人物：这一段剧本里出场的人（有台词、有动作的），一人一项。全片人物表里有的，名字和描写都照抄表里的，一个字不改；表里没有的新写：名字用剧本里的叫法，描写只写看得见的（年纪、长相、身材、穿着、一两处特征），两三句话，不写性格和心理。群众（路人若干这一类）不列。',
    '3. 道具：这一段剧情用到、要出图的东西（人拿着用的、剧情围着它转的；特效也算），一样一项。表里有的照抄名字和描写；新的写样子、结构、材质、颜色、新旧，两三句话。背景里随手的杂物不列。',
    '4. 场景：这一段在哪儿，一处地方一行，写成「地方名：一句话写在哪、什么样」。全片场景里有的那一行一个字不改照抄；没有的新写。',
    shotRule('镜N 的 N 是这个镜头在你回复的镜头表里排第几（从 1 数）'),
    '6. 都照剧本来：不改剧本内容，不加剧本里没有的；不写机位、运镜；秒数只写在「秒数」里。', ...(Scope ? Scope.rules(7) : [])];   // 7、8：每一镜出场的，哪些是全局的（11-17）
  /* 镜头表那一条（11-16 他定：作用二十个字以内写成「标签｜目的，关系」，每镜一个预估秒数；公用/镜头作用.js）。how：镜N 的 N 怎么认 */
  function shotRule(how) {
    return '5. 镜头表：照剧本正文的先后分镜头，每个镜头是连着的一段戏、讲一件事（一个小目的、一个转折）。镜头数照戏来，别硬凑，也别切得太碎。几个镜头连起来要盖住整个剧本：不漏、不重。每个镜头写三样：「写什么」一句话，这个镜头发生了什么，二十个字以内；'
      + (Why ? Why.ruleWhy(how) + Why.RULE_SEC : '「作用」一两句，为什么要有这个镜头，它让观众看到什么、明白什么、感觉到什么；「秒数」照真人做事的快慢估一个整秒数。');
  }
  const distillJson = withNo => '{"梗概": "……", "人物": [{"名": "……", "描写": "……"}], "道具": [{"名": "……", "描写": "……"}], "场景": ["地方名：……"], ' + (Scope ? Scope.GLOBAL_JSON + ', ' : '') + '"镜头表": [' + [1, 2].map(n => '{' + (withNo ? '"号": "' + n + '", ' : '') + '"写什么": "……", "作用": "……", "秒数": ' + (n + 2) + (Scope ? ', ' + Scope.SHOT_JSON : '') + '}').join(', ') + ']}';   // 「镜头表」11-16 以前叫「段落」：AI 回的两个都认；全局、每一镜的人物场景道具 11-17 加
  const distillRel = seg => ['定稿的剧本', segDir(seg), segDir(seg) + '_提炼.json'];
  async function distillBase(j) {
    const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = srcPath(j.项目, s, j.段), pf = PF.isPF(s);
    if (!s) throw fail('流水线里没有第' + j.段 + '段');
    if (!(await exists(sp))) throw fail(pf ? '这一段还没有自由稿' : '这一段还没有剧本');
    if (!finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs))) throw fail(pf ? '自由稿写好、点了「提炼分镜」才能提炼' : '剧本定稿以后才能提炼');
    return { flow, s, script: await docText(sp) };
  }
  const restScenes = (flow, s) => (Array.isArray(flow.场) ? flow.场 : []).filter(x => x && x !== s && x.段).map(x => '第' + x.段 + '段 ' + (str(x.名).trim() || '（没起名）') + (str(x.表达).trim() ? '：' + str(x.表达).trim() : '')).join('\n') || '（没有别的段）';   // 表达：老数据里的「想写什么」，有才带
  const rowsOf = list => { const seen = new Set(); return (Array.isArray(list) ? list : []).filter(x => x && typeof x === 'object').map(x => ({ 名: oneLine(x.名), 描写: str(x.描写).trim() })).filter(x => x.名 && !seen.has(x.名) && seen.add(x.名)); };
  /* keepNo：照批注改的、有镜头表以后重新提炼的，AI 照抄了原来的号（新加的照规矩起）：写了的号留着，页面看号都对就照它并，不对就照字认（镜N 照 AI 写的号换）；
     第一回提炼的不留号，页面照字认原来的号。byNotes：照批注改的（人删掉的又列回来，是批注要加回来） */
  async function putDistill(j, text, done, keepNo, byNotes) {
    const got = jsonIn(text);
    const paras = (Array.isArray(got.镜头表) ? got.镜头表 : Array.isArray(got.段落) ? got.段落 : []).filter(x => x && typeof x === 'object').map(x => ({ 号: keepNo && SB ? SB.normNo(x.号) : '', 写什么: oneLine(x.写什么), 作用: str(x.作用).trim(), 秒数: secOf(x), ...(Scope ? Scope.rowCast(x) : {}) })).filter(x => x.写什么 || x.作用);
    if (!paras.length) throw fail('AI 没按要的格式回（要 {"梗概", "人物", "道具", "场景", "镜头表"}，镜头表至少一个镜头）');
    for (const x of paras) { if (!x.号) delete x.号; if (!x.秒数) delete x.秒数; }
    const g = Scope ? Scope.globalIn(got) : null;   // AI 说哪些是全局的（11-17）；没回就不写，页面照旧
    const out = { 梗概: str(got.梗概).trim(), 人物: rowsOf(got.人物), 道具: rowsOf(got.道具), 场景: [...new Set((Array.isArray(got.场景) ? got.场景 : []).map(oneLine).filter(Boolean))], ...(g ? { 全局: g } : {}), 镜头表: paras };
    const rel = distillRel(j.段);
    await archive(j.项目, rel);
    await writeFile(pj(j.项目, ...rel), JSON.stringify({ 说明: 'AI 照定稿的剧本提炼的（页面只读：流水线看到新的一版，就把梗概、人物、道具、场景并进全片设定，这一段的出场和镜头表照它换，人再改）。', 时间: nowText(), 渠道: j.渠道, ...(byNotes ? { 照批注改: true } : {}), ...out }, null, 2) + '\n');   // 照批注改的：人删掉的又列回来，是批注要加回来（11-17）
    return { 结果: done + '：人物 ' + out.人物.length + ' 个、道具 ' + out.道具.length + ' 样、场景 ' + out.场景.length + ' 处、镜头表 ' + paras.length + ' 个镜头，到这一段的「提炼」那一步看', 产出: [rel.join('/')] };
  }
  const distillNoteRel = seg => ['定稿的剧本', segDir(seg), segDir(seg) + '_提炼_批注.md'];   // 提炼页写的批注
  const readNote = async (name, rel) => rel && (await exists(pj(name, ...rel))) ? unbom(await fsp.readFile(pj(name, ...rel), 'utf8')) : '';
  /* 现在这一段的提炼（人可能改过；号是镜头表的固定号）：照批注改、重新提炼都在它上面改 */
  const distillNow = (flow, s, ps) => ({ 梗概: str(flow.梗概).trim(), ...Object.fromEntries(['人物', '道具'].map(k => [k, (s[k] || []).map(n => { const e = (flow[k] || []).find(x => x && x.名 === n); return { 名: n, 描写: e ? str(e.描写).trim() : '' }; })])),
    场景: (s.场景文字 || []).map(oneLine).filter(Boolean), ...(Scope ? { 全局: Scope.segGlobal(flow, s) } : {}),
    镜头表: ps.map(x => ({ 号: x.号, 写什么: x.写什么, 作用: x.作用, ...(x.秒数 ? { 秒数: x.秒数 } : {}), ...(x.秒数人定 ? { 秒数人定: true } : {}), ...(Scope ? Scope.rowCast(x) : {}) })) });
  const NO_RULE = '镜头表每个镜头带「号」：原有的照抄；新加的照规矩起：插在中间的是前一镜的号加 b、c（镜头3 后面加的是 3b），加在最前面的是 0、0b，加在最后的接着最大的号往后排；删掉的号不再用。';
  const newRules = () => [...DISTILL_RULES.slice(1, 4), shotRule('镜N 的 N 是镜头的「号」')].map(x => x.replace(/^\d\. /, '')).join(' ');
  /* 有镜头表以后重新提炼（11-18：原来照排第几重新认号，改了字的那一镜号丢了，提示词名字、关键帧对不上；页面上没交的批注也没带上）：
     在现在的上面改，没变的照抄，号照抄；note：页面上没交的批注，一起交 */
  function redoBook(j, flow, s, script, ps, note) {
    const rules = ['剧本里没变的戏：现在的提炼照抄，一个字都不动（包括标点）。',
      '剧本改了的戏：只改用到它的那几镜（写什么、作用、出场的人物场景道具）和那几样，改动尽量小；剧本删掉的戏：那几镜删掉；剧本新加的戏：加镜头。镜头的先后照剧本正文，几个镜头连起来要盖住整个剧本：不漏、不重。',
      NO_RULE + '作用里的「镜N」也是这个号。',
      '梗概：剧本改的地方梗概里写到了的，照着改，改动尽量小，别的段的内容留着。人物、道具、场景：这一段还出场的照抄，不出场了的删掉。',
      '新加的照这几条写：' + newRules(),
      '秒数：标了「秒数人定」的是人定的，照抄' + (note ? '，除非批注说到这一镜的秒数' : '') + '；没标的，这一镜的写什么改了就重估，别的照抄；还没有秒数的补上。回复里不写「秒数人定」。',
      ...(note ? ['下面「批注」那一节是人写的，一并照改：批注说到的地方照批注改，批注把原文改写好了的照抄批注，不要再润色；批注说的那场戏剧本里删掉了的，不用管。'] : []),
      DISTILL_RULES[5].replace(/^\d\. /, ''), '回复改好以后的全部内容（没改的照抄），格式照下面。',
      ...(Scope ? [Scope.goneLine(s), Scope.imgLine(s)].filter(Boolean) : [])].map((t, i) => (i + 1) + '. ' + t);
    if (Scope) rules.push(Scope.ruleFix(rules.length + 1));
    return ['# 任务：照定稿的剧本重新对一遍这一段的提炼', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这一段已经提炼过（下面「现在的提炼」，人可能改过' + (note ? '，还写了批注' : '') + '），剧本可能改过。请照这一段定稿的剧本，在现在的上面改。后面的视频提示词、关键帧都认镜头的「号」，没变的要照抄，号不能乱。',
      '', '## 要求', ...rules, '', '## 回复一段 JSON，像这样', distillJson(true),
      '', '## 现在的提炼', JSON.stringify(distillNow(flow, s, ps), null, 2), ...(note ? ['', '## 批注', note] : []),
      '', '## 这一段：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'), ...(str(s.表达).trim() ? ['这一段想写什么：' + str(s.表达).trim()] : []),
      '', '## 定稿的剧本', script, '', '## 现在的全片设定', settingText(flow), '', '## 别的段（只为了写全片梗概）', restScenes(flow, s), TAIL].join('\n');
  }
  const KINDS = {
    补细: {
      title: j => '补细描写 · ' + [...(j.人物 || []), ...(j.道具 || [])].join('、'), key: j => 'all',
      async book(j) {
        const flow = await readFlow(j.项目), ask = [];
        for (const k of ['人物', '道具']) for (const n of j[k] || []) {
          const e = (flow[k] || []).find(x => x && x.名 === n);
          if (!e) continue;
          const imgs = (Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : []).map(f => stemOf(f));
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
        const imgs = await imgsAt(j.项目, flow.场景图);   // 引用的场景图：让 AI 看着图建底稿（GEO 要照生成好的参考图核）
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
        const rel = ['提示词', '全局资产', '场景', (first ? stemOf(first) : '全片场景') + '_GEO底稿.md'];
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
    /* 提炼（11-16 他定：先写剧本，剧本定稿以后 AI 一次提炼）：梗概、这一场的人物道具场景、镜头表。
       已经有镜头表的（11-18）：照新剧本在现在的上面改（redoBook）；页面上还有没交的批注，页面先存成 第N段_提炼_批注.md、传 批注，一起交，改完收进历史记录 */
    提炼: {
      title: j => 'AI 提炼 · 第' + j.段 + '段', need: ['段'],
      async prep(j) { if (j.批注 && (await exists(pj(j.项目, ...distillNoteRel(j.段))))) j.rel = distillNoteRel(j.段); },
      async book(j) {
        const { flow, s, script } = await distillBase(j), ps = parasOf(s), note = await readNote(j.项目, j.rel);
        j.重提 = ps.length > 0;
        if (j.重提) return redoBook(j, flow, s, script, ps, note);
        const more = [...(Scope ? [Scope.goneLine(s), Scope.imgLine(s)] : []), note ? '下面「批注」那一节是人写的要求，提炼时照着办。' : ''].filter(Boolean);   // 挂了场景图的，告诉 AI 图名（11-17）
        return ['# 任务：照定稿的剧本提炼梗概、人物、道具、场景和镜头表', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是这一段定稿的剧本，和现在已有的全片设定（前面几段定稿以后提炼的，可能还空着）。请照剧本提炼下面五样，后面照它出人物、道具、场景图，写视频提示词时照镜头表的先后拍。',
          '', '## 要求', ...DISTILL_RULES, ...more.map((t, i) => (DISTILL_RULES.length + 1 + i) + '. ' + t), '', '## 回复一段 JSON，像这样', distillJson(false), ...(note ? ['', '## 批注', note] : []),
          '', '## 这一段：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'), ...(str(s.表达).trim() ? ['这一段想写什么：' + str(s.表达).trim()] : []),
          '', '## 定稿的剧本', script, '', '## 现在的全片设定', settingText(flow), '', '## 别的段（只为了写全片梗概）', restScenes(flow, s), TAIL].join('\n');
      },
      async apply(j, text) {
        const r = await putDistill(j, text, j.重提 ? '重新提炼好了' : '提炼好了', !!j.重提);
        if (j.rel) await archive(j.项目, j.rel);
        return r;
      },
    },
    /* 提炼按批注改：人在提炼那一步写的批注（页面存成 第N段_提炼_批注.md），AI 照着改，改完批注收进历史记录 */
    提炼按批注改: {
      title: j => '提炼按批注改 · 第' + j.段 + '段', need: ['段'],
      async prep(j) {
        j.rel = distillNoteRel(j.段);
        if (!(await exists(pj(j.项目, ...j.rel)))) throw fail('批注文件不在了：' + j.rel.join('/'));
      },
      async book(j) {
        const { flow, s, script } = await distillBase(j), ps = parasOf(s);
        if (!ps.length) throw fail('这一段还没有提炼');
        const note = unbom(await fsp.readFile(pj(j.项目, ...j.rel), 'utf8')), now = distillNow(flow, s, ps);
        return ['# 任务：按批注改一段戏的提炼', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是照这一段定稿的剧本提炼出来的梗概、人物、道具、场景和镜头表（人可能改过），和人写的批注。请照批注改。',
          '', '## 要求', '1. 只改批注说到的地方，别的一个字都不动（包括标点）。', '2. 批注要加一项、删一项、拆开、并起来的，照做；镜头的先后照剧本正文。',
          '3. 批注是提要求的，照要求改这一处，改动尽量小；批注把原文改写好了的，照抄批注，不要再润色。', '4. 新加的照这几条写：' + newRules(),
          '5. ' + NO_RULE + '批注里的「镜头N」也是这个号。',
          '6. 秒数：标了「秒数人定」的是人定的，照抄，除非批注说到这一镜的秒数；没标的，批注说到这一镜、或者这一镜的写什么改了，就重估，别的照抄；还没有秒数的补上。回复里不写「秒数人定」。',
          '7. 回复改好以后的全部内容（没改的照抄），格式照下面。', ...(Scope ? [Scope.ruleFix(8), ...(Scope.imgLine(s) ? ['9. ' + Scope.imgLine(s)] : [])] : []), '', '## 回复一段 JSON，像这样', distillJson(true),   // 9：挂了场景图的，告诉 AI 图名（11-17）
          '', '## 现在的提炼', JSON.stringify(now, null, 2), '', '## 批注', note, '', '## 这一段：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'),
          '', '## 定稿的剧本', script, '', '## 全片的设定（只为了认人物、道具）', settingText(flow), TAIL].join('\n');
      },
      async apply(j, text) {
        const r = await putDistill(j, text, '照批注改好了', true, true);
        await archive(j.项目, j.rel);
        return r;
      },
    },
  };

  /* ---------- 工序三：出图。先让选的那个 AI 把出图提示词写好，再交给 Codex 出图（出图只走 Codex） ---------- */
  const crypto = require('crypto');
  const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
  const IMG_TASK = path.join(TOOLS, '流水线', '任务书', '资产出图任务.txt');
  async function codexDo(j, msg, opt = {}) {   // 让 Codex 真去做一件事（它会开一个看得见的对话）
    /* 给我提示词：这件事人贴进自己的 Codex 去做（要用它的出图工具、操作即梦）；opt.核图：出完图顺手对着字核一遍，写进回复；
       opt.check：回复到了先查一遍（图存到了没有），不对就接着等它改好，不算没成 */
    if (j.渠道 === SELF) return (await handoff(j, { codex: msg, 核图: !!opt.核图, ...(opt.tag ? { tag: opt.tag } : {}) }, 'self', [], opt.check)).trim();   // tag：一个任务里交几回的，回复文件各叫各的
    const f = path.join(j.dir, '发给Codex的话.txt');
    await writeFile(f, msg);
    const r = await cxRun(j, f, 1700, 30 * 60e3);
    if (!r.res || !r.res.ok) throw fail('Codex 没做成：' + ((r.res && r.res.error) || r.err.trim() || r.out.trim() || '没有结果').slice(0, 300));
    return cxReply(r.out).trim();
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
  const imgsOf = e => (!e ? [] : Array.isArray(e.资产) ? e.资产 : e.资产 ? [e.资产] : []).map(g => String(g).replace(/\\/g, '/'));
  const stateOfImg = (name, file) => { const b = stemOf(file); return b === name ? '' : b.startsWith(name + '_') ? b.slice(name.length + 1) : b; };
  const oneLine = t => str(t).replace(/\s+/g, ' ').trim();
  const mtimeOf = async p => { try { return Math.floor((await fsp.stat(p)).mtimeMs); } catch (e) { return 0; } };   // 核图记下核的是哪一张（图的修改时间）：页面照它分清说的是原图还是候选
  /* 一样东西的几个文件：字（出图提示词）、GEO 底稿（场景）、字的批注、图、候选图、图的批注（看大图时写的） */
  function wordFiles(cat, stem, seg, img) {
    const p = cat === '关键帧' ? ['提示词', segDir(seg)] : ['提示词', '全局资产', cat], a = cat === '关键帧' ? AP.segParts(seg) : AP.catParts(cat);
    return { txt: [...p, stem + '_提示词.txt'], note: [...p, stem + '_提示词_批注.md'], geo: cat === '场景' ? [...p, stem + '_GEO底稿.md'] : null,
      img: img || [...a, stem + '.png'], cand: [...a, stem + '_候选.png'], imgNote: [...a, stem + '_批注.md'], shots: [...a, stem + '_批注截图'] };
  }
  /* 页面给的那张图（已经挂着的，名字不一定是「叫法.png」，比如 童爸爸_三十出头.png）：要在这一类的文件夹里 */
  function imgParts(cat, seg, file) {
    const img = AP.fromOld(str(file)).replace(/\\/g, '/').split('/').filter(Boolean);
    if (!img.length) return null;
    const dir = cat === '关键帧' ? AP.segParts(seg) : AP.catParts(cat);
    if (img.length !== dir.length + 1 || dir.some((x, i) => img[i] !== x) || !IMG_RE.test(img[img.length - 1]) || !img.every(nameOk)) throw fail('这张图不在 ' + dir.join('/') + ' 里');
    return img;
  }
  async function wordPrep(j) {
    if (!WORD_CATS.includes(j.类别)) throw fail('只出人物、道具、场景、关键帧的图');
    const p = j.参数 && typeof j.参数 === 'object' ? j.参数 : {}, img = imgParts(j.类别, j.段, p.图);
    j.文件名 = img ? stemOf(img[img.length - 1]) : j.状态名 ? str(j.名) + '_' + j.状态名 : str(j.名);
    if (!nameOk(str(j.名)) || !nameOk(j.文件名) || /_候选$/.test(j.文件名)) throw fail('名字里有不能当文件名的字');
    j.files = wordFiles(j.类别, j.文件名, j.段, img);
  }
  async function needFinal(j, flow) {   // 剧本定稿了才写字、出图（先写提示词的段：分镜定下来了才出，11-21 他定）
    const s = sceneOf(flow, j.段), sp = srcPath(j.项目, s, j.段);
    if (!s || !(await exists(sp)) || !finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs)) || (PF.isPF(s) && !s.定稿)) throw fail(PF.isPF(s) ? '分镜定下来以后才能写字、出图（自由稿改过的，先到「提炼分镜」点「照旧」或「重新提炼」）' : '剧本定稿以后才能写字、出图');
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
     只用文字写、不出图的（这一场的「不出图」，公用/核心.js 的 noImg）：没图的写文字描写（只字，公用/文字描写.js），不写出图提示词；已经有字的不再写，点名的才改。旁白不算
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
      const 写 = !!x.只 || (!有字 && !有图), 不写GEO = x.类别 === '场景' && core('noGeo')(s, x.stem);   // 不要 GEO 的场景（11-17）：只写出图提示词
      if (x.只字 && !写) return;   // 只用文字的已经有文字描写：没图可核，不用再写
      out.push({ 参考: [], 要求: '', ...x, f, 图: f.img.join('/'), 有图, 有字, 确认, 写, 不写GEO, 旧字: 写 ? await read(f.txt) : '', 旧GEO: 写 && !不写GEO ? await read(f.geo) : '' });
    };
    const entry = (k, n) => (Array.isArray(flow[k]) ? flow[k] : []).find(e => e && e.名 === n) || null;
    const inGlobal = (k, g) => { const d = AP.catDir(k) + '/'; return g.startsWith(d) && !g.slice(d.length).includes('/'); };   // 人物、道具都在 资产/人物和道具，场景在 资产/场景（本层）
    if (j.只.length) {
      for (const x of j.只) {
        const e = x.类别 === '人物' || x.类别 === '道具' ? entry(x.类别, x.名称) : null, 只字 = !!TxtWord && core('noImg')(s, x.类别, x.名称) && !imgsOf(e).length;
        if (x.类别 === '人物' && isNarr(x.名称)) continue;
        let img = null;
        try { img = imgParts(x.类别, j.段, x.图); } catch (err) { continue; }
        const stem = img ? stemOf(img[img.length - 1]) : x.状态名 ? x.名称 + '_' + x.状态名 : x.名称;
        if (!nameOk(stem) || /_候选$/.test(stem)) continue;
        const 参考 = [];
        for (const g of x.参考) { const parts = g.split('/').filter(Boolean); if (parts[0] === '资产' && parts.every(nameOk) && IMG_RE.test(g) && await exists(pj(j.项目, ...parts))) 参考.push(parts.join('/')); }
        await add({ 类别: x.类别, 名称: x.名称, 状态名: x.状态名, stem, 图: img ? img.join('/') : '', 描写: e ? str(e.描写).trim() : x.文字, 描写改: e ? timeOf(e.描写改) : 0, 要求: x.要求, 参考, 提示词: x.提示词 || '', 只: true, ...(只字 ? { 只字 } : {}) });
      }
      return out;
    }
    const txt = (k, n) => core('noImg')(s, k, n) ? (TxtWord ? { 只字: true } : null) : {};   // 只用文字的：写文字描写（读不了 公用/文字描写.js 就照以前跳过）
    for (const k of ['人物', '道具']) for (const n of Array.isArray(s[k]) ? s[k] : []) {
      if (k === '人物' && isNarr(n)) continue;
      const e = entry(k, n), all = imgsOf(e), mine = all.filter(g => inGlobal(k, g));
      if (mine.length) { for (const g of mine) await add({ 类别: k, 名称: n, 状态名: mine.length > 1 ? stateOfImg(n, g) : '', stem: stemOf(g), 图: g, 描写: e ? str(e.描写).trim() : '', 描写改: e ? timeOf(e.描写改) : 0 }); }
      else if (!all.length && nameOk(n) && txt(k, n)) await add({ 类别: k, 名称: n, 状态名: '', stem: n, 图: '', 描写: e ? str(e.描写).trim() : '', 描写改: e ? timeOf(e.描写改) : 0, ...txt(k, n) });
    }
    for (const g of (Array.isArray(s.场景图) ? s.场景图 : []).map(x => String(x).replace(/\\/g, '/')).filter(g => inGlobal('场景', g))) await add({ 类别: '场景', 名称: stemOf(g), 状态名: '', stem: stemOf(g), 图: g, 描写: '' });
    for (const t of (Array.isArray(s.场景文字) ? s.场景文字 : []).map(str).filter(Boolean)) { const st = sceneStem(t); if (st && txt('场景', st)) await add({ 类别: '场景', 名称: st, 状态名: '', stem: st, 图: '', 描写: t.trim(), ...txt('场景', st) }); }
    return out;
  }
  function otherScenes(flow, s, items) {   // 别的场也用这几样的：剧本定稿了的一起照顾到，没定稿的只预留
    const lines = [];
    for (const x of Array.isArray(flow.场) ? flow.场 : []) {
      if (!x || x === s || !x.定稿) continue;
      const uses = items.filter(it => it.类别 === '人物' || it.类别 === '道具' ? (x[it.类别] || []).includes(it.名称)
        : it.类别 === '场景' ? (x.场景图 || []).some(g => String(g).replace(/\\/g, '/') === it.图) || (x.场景文字 || []).some(t => sceneStem(t) === it.名称) : false);
      if (uses.length) lines.push('第' + x.段 + '段（' + (x.剧本定稿 ? '剧本定稿了' : '剧本还没定稿，只预留') + '）用到：' + [...new Set(uses.map(it => it.名称))].join('、') + '。这一段主要表达：' + (oneLine(x.表达) || '（没写）').slice(0, 200));
    }
    return lines.join('\n') || '（没有别的段用到这几样）';
  }
  /* 写字的回复：一样一节，【类别｜名称】或【类别｜名称｜状态】开头，里面「要撑住：」「核图：」「GEO底稿：」「出图提示词：」 */
  function wordSecs(text) {
    const t = text.replace(/\r\n/g, '\n').replace(/^\s*```.*$/gm, ''), re = /^[ \t]*【(人物|道具|场景|关键帧)｜([^｜】\n]+)(?:｜([^】\n]+))?】[ \t]*$/gm;
    const heads = [...t.matchAll(re)];
    return heads.map((m, i) => {
      const part = t.slice(m.index + m[0].length, i + 1 < heads.length ? heads[i + 1].index : t.length), v = {};
      let cur = null;
      for (const l of part.split('\n')) {
        const k = /^\s*(要撑住|核图|替人定的|GEO底稿|出图提示词|文字描写)[：:]\s*(.*)$/.exec(l);   // 文字描写：只用文字写的那几样（11-17）
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
      const pname = core('taskVp')(str(j.名)), pp = pj(j.项目, '提示词', segDir(j.段), pname), rec = pj(j.项目, '资产', segDir(j.段) + '_出片记录.json');
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
      接得上: m => !!m.接着,   // 服务重开后接着等回复（11-18）：要记着当初有没有图，11-18 以前交出去的没记，接不上
      async prep(j) {
        await wordPrep(j);
        if (j.渠道 !== SELF && j.渠道 !== 'mock' && !CHANNELS.codex.ok()) throw fail('出图要用 Codex，这台电脑上调不起来');
      },
      async run(j) {   // 照人批过的字出：字不在就不出（字先定，图后出）；已经有图的，新图先存成候选
        const flow = await readFlow(j.项目);
        await needFinal(j, flow);
        const f = j.files, abs = parts => pj(j.项目, ...parts);
        if (!(await exists(abs(f.txt)))) throw fail('还没有字：先让 AI 写字，你看过、点「照这个出图」再出');
        if (TxtWord && TxtWord.isTxt(unbom(await fsp.readFile(abs(f.txt), 'utf8')))) throw fail('这份字是只用文字时写的文字描写，不是出图提示词：先让 AI 改成出图提示词，再出图');   // 11-17
        const has = j.续 && j.接着 ? !!j.接着.有图 : await exists(abs(f.img)), out = has ? f.cand : f.img;   // 服务重开后接着等的：照当初认的（新图这会儿可能已经存上了）
        if (has && !j.续) await archive(j.项目, f.cand);   // 上一张候选没用上：收进历史记录（没有就不动）。接着等的不收：那一张可能就是刚出的
        j.接着 = { 有图: has };
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
      接得上: true,   // 服务重开后接着等回复（11-18）
      async prep(j) {
        await wordPrep(j);
        if (j.渠道 !== SELF && j.渠道 !== 'mock' && !CHANNELS.codex.ok()) throw fail('改图要用 Codex，这台电脑上调不起来');
      },
      async run(j) {   // 照人在图上写的批注改：以原图为底只改说到的地方；改出来的先当候选
        const flow = await readFlow(j.项目);
        await needFinal(j, flow);
        const f = j.files, abs = parts => pj(j.项目, ...parts), mark = [...f.shots, '标注图.jpg'];
        if (!(await exists(abs(f.img)))) throw fail('图不在了：' + f.img.join('/'));
        if (!(await exists(abs(f.imgNote)))) throw fail('还没在图上写批注：点开这张图，框出来写');
        if (!j.续) await archive(j.项目, f.cand);   // 服务重开后接着等的不收：候选可能就是刚改好的
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
      title: j => '写字 · ' + (j.只名 || '第' + j.段 + '段'), need: ['段'], key: j => j.段 + '/' + (j.只名 || '*'),
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
        if (!items.length) throw fail('这一段没有要写的（只用文字写的已经有文字描写；这一段文件夹里的图不走这一步）');
        j.items = items;
        j.images = [...items.filter(x => x.有图).map(x => pj(j.项目, ...x.图.split('/'))), ...items.flatMap(x => x.参考.map(g => pj(j.项目, ...g.split('/'))))];
        const geoW = items.some(x => x.写 && x.类别 === '场景' && !x.不写GEO), noGeoW = items.some(x => x.写 && x.不写GEO && !x.只字);   // 有没有要写 GEO 底稿的场景、有没有不写的（只用文字的本来就不写）
        const RULE = { 人物: '人物：定妆照，画面里只有这一个人，正面全身站立，头到脚完整入画，竖幅 2:3，纯中灰色摄影棚背景；分「长相」「姿势」「穿着」「质感」几小段写；长相普通，不是明星脸，不是任何真人的肖像。',
          道具: '道具：画面里只有这一件道具，完整入画，四周留一点空，横幅 16:9，干净的中灰色背景或它平常所在的简单环境；写清结构、材质、颜色、新旧；有状态的画那个状态。',
          场景: '场景：空镜，横幅 16:9，不出现有名有姓的人物；写清是什么时候、在哪、有什么、各在哪、光从哪来。' + (geoW ? '先照 scene-geo 写 GEO 底稿（只给人审：什么在哪、从哪看得见什么、人往哪走），出图提示词照底稿写，两边对得上。' + (noGeoW ? '标了「不写 GEO 底稿」的不写底稿，直接写出图提示词。' : '') : ''),
          关键帧: '关键帧：这一条视频里某一刻的画面（要求里写着是哪一刻），横幅 16:9；人物、道具、场景的样子照给的参考图，正文里用「图1」「图2」……指它们，长相衣着不再用字描一遍；写清这一刻谁在哪、在做什么、朝哪、镜头从哪拍、光从哪来；画动着的那一刻，别画成摆拍。' };
        const cats = [...new Set(items.filter(x => x.写 && !x.只字).map(x => x.类别))], tcats = [...new Set(items.filter(x => x.写 && x.只字).map(x => x.类别))];   // tcats：只用文字、写文字描写的（11-17）
        const tag = x => '【' + x.类别 + '｜' + x.名称 + (x.状态名 ? '｜' + x.状态名 : '') + '】';
        const line = x => '- ' + tag(x) + [x.描写 ? '描写：' + x.描写 : '', x.只字 ? '' : x.有图 ? '有图：' + x.图 + '（' + (x.确认 ? '人确认过可用' : '人还没确认') + '）' : '还没有图',
          x.写 ? (x.只字 ? '只用文字，不出图：要写文字描写' : '要写字' + (x.不写GEO ? '（不写 GEO 底稿：没有严格站位）' : '')) + (x.旧字 ? '（原来的字在最后，照要求改）' : '') : '不用写字', x.提示词 ? '是「' + x.提示词 + '」这一条视频里的一刻（这一条的提示词在下面）' : '', x.要求 ? '要求：' + x.要求 : '', x.参考.length ? '参考图：' + x.参考.map((g, i) => '图' + (i + 1) + '＝' + g).join('、') : ''].filter(Boolean).join('；');
        const olds = items.filter(x => x.写 && (x.旧字 || x.旧GEO)).map(x => '### ' + tag(x) + '\n' + (x.旧GEO ? '原来的 GEO 底稿：\n' + x.旧GEO + '\n\n' : '') + (x.旧字 ? '原来的字：\n' + x.旧字 : ''));
        const vps = [];   // 关键帧对着的那几条视频提示词：照它的分镜定这一刻
        for (const n of [...new Set(items.map(x => x.提示词).filter(Boolean))]) {
          const p = pj(j.项目, '提示词', segDir(j.段), n);
          if (await exists(p)) vps.push('### ' + n + '\n' + unbom(await fsp.readFile(p, 'utf8')).trim().slice(0, 8000));
        }
        return ['# 任务：写字（资产图的出图提示词' + (tcats.length ? '；只用文字的写文字描写' : '') + '），核一遍已经有的图', '','今天 ' + today() + '。这是一个 AI 短视频项目，流程是「字先定，图后出」：这一段的剧本定稿了，你先给要用的东西写字，人看过、批过，再照字出图。',
          '', '## 每一样要做的',
          '1. 要撑住：这一段的戏要它做到什么（谁要看得见谁、人往哪走、东西怎么用、在哪儿、什么时候），一两句，只写剧本里有的。「别的段」里剧本定稿了的也用它，一起照顾到；没定稿的不管。',
          '2. 有图的：图已经让你看过了，核它撑不撑得住：写「核图：撑得住」，或者「核图：撑不住：缺什么、哪里不对」，一句话。人确认过的图，没有大问题就算撑得住。',
          '3. 标了「要写字」的：写出图提示词，画面照下面「出图规矩」。原来有字的，照「要求」改，没说到的地方别动。剧本没写到的样子、布局，你出主意' + (geoW ? '（场景在底稿里标【待拍板】）' : '') + '，在「替人定的」里一处一行列出来，人会一条一条看。',
          '4. 只写画面里有的东西，不写「没有什么」。真人写实的电影剧照质感，不要 AI 明信片感；先想清楚合不合理：东西摆在哪、光从哪来。年代、地方、颜色基调和全片对得上。',
          ...(tcats.length ? ['5. ' + TxtWord.ASK] : []),
          ...(cats.length ? ['', '## 出图规矩', ...cats.map(c => RULE[c])] : []),
          ...(tcats.length ? ['', '## 文字描写规矩（只用文字的）', ...tcats.map(c => TxtWord.RULE[c])] : []),
          '', '## 回复的格式（一样一节，标记照抄，名字一个字不改）', ...(cats.length || !tcats.length ? ['【人物｜童爸爸】', '要撑住：……', '核图：撑得住', '替人定的：', '……（剧本没写、你替人定的样子，一处一行，几个字说清；都照剧本写的就不写这一项）', '出图提示词：', '……（正文，可以几段）', '【场景｜面摊】', '要撑住：……', 'GEO底稿：', '……', '出图提示词：', '……'] : []),
          ...(tcats.length ? ['【道具｜竹棍】', '要撑住：……', '替人定的：', '……', '文字描写：', '……（正文，一段）'] : []),
          '没有图的不写「核图」；不用写字的不写「替人定的」「GEO底稿」「出图提示词」；' + (tcats.length ? '只用文字的写「文字描写」，不写「出图提示词」「GEO底稿」；' : '') + (noGeoW ? '标了「不写 GEO 底稿」的场景不写「GEO底稿」这一项；' : '') + '道具有状态的，标记写成【道具｜名字｜状态】。不要开场白和总结。',
          '', '## 要写的这几样', ...items.map(line),
          '', '## 全片的设定', settingText(flow), await lookPart(j.项目, flow, null, '图', '全片的光影总基调'),
          '', '## 这一段：第' + j.段 + '段｜' + (str(s.名).trim() || '（没起名）'), sceneText(flow, s),
          '', '## 这一段定稿的剧本', await docText(srcPath(j.项目, s, j.段)),
          '', '## 别的段', otherScenes(flow, s, items),
          ...(vps.length ? ['', '## 关键帧对着的视频提示词（照它的分镜定是哪一刻、画面里有什么）', ...vps] : []),
          ...(olds.length ? ['', '## 原来的字（要改的那几样）', ...olds] : []),
          ...(geoW ? ['', '## scene-geo 技能（场景照它写 GEO 底稿）', await skill('scene-geo')] : []), TAIL].join('\n');
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
            const word = str(x.只字 ? v.文字描写 || v.出图提示词 : v.出图提示词).trim();   // 只用文字的写的是「文字描写」
            if (word.length < (x.只字 ? 10 : 40)) miss.push(x.名称 + '（字太短）');
            else {
              const head = [...x.参考.map((g, i) => '图' + (i + 1) + '：' + pj(j.项目, ...g.split('/')) + '（' + stemOf(g) + '）'),
                '用途：' + (x.只字 ? TxtWord.purpose(x.类别, x.名称, x.状态名) : x.类别 === '关键帧' ? '第' + j.段 + '段' + (x.提示词 ? '「' + x.提示词 + '」' : '') + '的关键帧' :x.类别 + '「' + x.名称 + '」' + (x.状态名 ? '（' + x.状态名 + '）' : '') + '的定妆图，各段照它的样子'), ...(撑 ? ['要撑住：' + 撑] : []), '提示词'];
              await archive(j.项目, x.f.txt, stamp);
              await writeFile(pj(j.项目, ...x.f.txt), head.join('\n') + '\n' + word + '\n');
              产出.push(x.f.txt.join('/'));
              const geo = str(v.GEO底稿).trim();
              if (x.f.geo && !x.不写GEO && geo.length > 40) { await archive(j.项目, x.f.geo, stamp); await writeFile(pj(j.项目, ...x.f.geo), geo + '\n'); 产出.push(x.f.geo.join('/')); }
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
        const s = j.geo ? sceneOf(await readFlow(j.项目), j.段) : null, off = !!s && core('noGeo')(s, j.名);   // 这一段标了不要 GEO（11-17）：只改字
        const word = await read(j.字), note = await read(j.注), geo = j.geo && !off && (await exists(pj(j.项目, ...j.geo))) ? await read(j.geo) : '';
        j.旧字 = word; j.旧GEO = geo;
        const tx = !!TxtWord && TxtWord.isTxt(word);   // 只用文字、不出图的文字描写（11-17）
        return ['# 任务：按批注改' + (tx ? '文字描写（只用文字写、不出图的）' : '一张图的字（出图提示词）'), '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是' + (tx ? '一样东西的文字描写（写视频提示词时照它写）' : '一张图的字') + (geo ? '和它的 GEO 底稿' : '') + '，和人写的批注。请照批注改。',
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
        try { script = await docText(srcPath(j.项目, sceneOf(flow, j.段), j.段)); } catch (e) { /* 读不了就不带 */ }
        return ['# 任务：场景图确认了，照图把 GEO 底稿再核一遍', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这张场景图人已经确认可用了（图已经让你看过）。GEO 底稿是出图前写的方案，现在照图核：图上有什么、各在哪、从哪往哪看，都以图为准。写提示词时，场景那一段照这份底稿翻。',
          '', '## 要求（先判断要不要改，要改才改）',
          '1. 先判断：拿底稿一条一条对图，只看空间：墙、门、窗、床、桌、灯这些固定的东西在哪、朝哪、有没有。颜色、新旧、质感、桌上摆的小东西不算；看不清、说不准的也不算对不上。',
          '2. 都对得上：【不一样的地方】只写「对得上」，【GEO底稿】只写「不用改」，什么都不动。',
          '3. 有对不上的才改：照 scene-geo 的办法，只改对不上的那几行，改成图上的样子，别的一个字不动（记号、标签照抄）；图上没画出来、底稿里有的，标【待拍板】，别删。',
          '4. 看下面用到这张图的戏，判断这些对不上的地方会不会影响走位、谁看得见谁、剧情。会影响的写「要：……」，不影响写「不用」。',
          '5. 回复只有三块，按这个顺序：', '【不一样的地方】', '（一处一行，大白话；都对得上就只写「对得上」）', '【要不要拿回去批图】', '（「不用」，或者「要：……」）', '【GEO底稿】', '（有对不上的：改好的整份底稿；都对得上：只写「不用改」）',
          '', '## 原来的 GEO 底稿', j.旧GEO, '', '## 用到这张图的段', users.map(x => '第' + x.段 + '段：' + (oneLine(x.表达) || '（没写表达）')).join('\n') || '（只有这一段）',
          ...(script ? ['', '## 第' + j.段 + '段定稿的剧本', script] : []), '', '## scene-geo 技能', await skill('scene-geo'), TAIL].join('\n');
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
      title: j => '改了剧本，看影响到哪些 · 第' + j.段 + '段', need: ['段'],
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
        return ['# 任务：剧本改了，看影响到哪些', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这一段的剧本改过、又定稿了。下面是改之前和改之后的剧本，还有这一段的资产和已经写好的视频提示词。请列出哪些要再看、为什么；没受影响的不列。',
          '', '## 要求', '1. 资产：哪样要改（写清哪里对不上新剧本）、要加（新剧本多出来的人物、道具、场景）、不用了（新剧本里没有了）。', '2. 提示词：哪几条写的戏和新剧本对不上，说清是哪几镜、为什么。', '3. 拿不准的也列上，为什么里写「拿不准」。只看改了的地方，别把没改的戏也列进来。',
          '4. 回复一段 JSON，像这样：', '{"总": "一两句话说这次改了什么", "资产": [{"类别": "人物", "名称": "童爸爸", "影响": "要改", "为什么": "……"}], "提示词": [{"文件": "视频提示词.txt", "为什么": "……"}]}', '「影响」只写 要改、要加、不用了 三种之一；提示词「文件」照下面的名字抄。',
          '', '## 改之前的剧本（' + pick.n + '）', before, '', '## 改之后的剧本', after, '', '## 这一段的资产', items.join('\n') || '（没选）', '', '## 这一段的提示词', texts.join('\n\n') || '（还没写）', TAIL].join('\n');
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
      title: j => '写提示词 · 第' + j.段 + '段 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      /* 这一条写哪段戏：11-16 他定，写的时候勾镜头表里的镜头，名字就是镜头号（1-5.txt），只写勾的那几个镜头，别的条附在后面好接上。
         老稿（视频提示词.txt……）照 11-15 的：人没写就写这一场整段，别的条不附；写了哪段（老请求带着段落范围的也一样）就只写那段。
         me：第几条；others：这一场别的条 [{ f, no, text }]；shots：勾的镜头号 [1, 2, 3]。给 { text：任务书里说范围的那几句, others：要附上的别的条 } */
      scope(me, others, what, shots) {
        const no = shots ? '拍镜头 ' + shots.join('、') + ' 的一条' : me ? '第 ' + me + ' 条' : '其中一条';
        if (!shots && !what) return { text: '这一份是' + no + '，写这一段的整段戏，从开头写到结尾。一条视频一般 15 秒、最长 30 秒。', others: [] };
        const where = shots ? '这一条只写镜头表里镜头 ' + shots.join('、') + ' 的戏，别的镜头留给别的条，不要写进来。' + (what ? '人另外交代：' + what + '。' : '')
          : '这一条写这段戏：' + what + '。别的戏留给别的条，不要写进来。';
        return { text: '这一段的戏分几条写由人定，这一份是' + no + (others.length ? '，这一段另外还有 ' + others.length + ' 条（附在后面，接头处要接得上）' : '') + '。' + where + '一条视频一般 15 秒、最长 30 秒，装不下的戏留给下一条。', others };
      },
      async prep(j) {
        if (!nameOk(str(j.名)) || !RE_VP.test(j.名) || vpVer(j.名)) throw fail('提示词的文件名要是镜头号，像「1-5.txt」「4-9.txt」');
        if (await exists(vpPath(j))) throw fail('这份提示词已经存在，请打开接着写；AI 初稿不会覆盖它');
        if (j.白模) {   // 这一条要挂的白模：只认这一段文件夹（含下一层）里的视频
          const f = str(j.白模).replace(/\\/g, '/'), q = f.split('/');
          if (!AP.inSeg(f, j.段) || AP.placeOf(f).depth > 1 || !VIDEO_RE.test(f) || q.some(x => !nameOk(x)) || !(await exists(pj(j.项目, ...q)))) throw fail('白模要是 ' + AP.segDir(j.段) + ' 里的视频');
          j.白模 = f;
        }
        if (j.关键帧 != null) {   // 这一条要挂的关键帧：只认这一段文件夹（含下一层）里的图，照页面排好的先后
          if (!Array.isArray(j.关键帧) || j.关键帧.length > 30) throw fail('关键帧的清单不对');
          const out = [];
          for (const x of j.关键帧) {
            const f = str(x).replace(/\\/g, '/'), q = f.split('/');
            if (!AP.inSeg(f, j.段) || AP.placeOf(f).depth > 1 || !IMG_RE.test(f) || q.some(y => !nameOk(y)) || !(await exists(pj(j.项目, ...q)))) throw fail('关键帧要是 ' + AP.segDir(j.段) + ' 里的图');
            if (!out.includes(f)) out.push(f);
          }
          j.关键帧 = out;
        }
      },
      async book(j) {
        const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = srcPath(j.项目, s, j.段);
        if (!s) throw fail('流水线里没有第' + j.段 + '段');
        if (!(await exists(sp))) throw fail(PF.isPF(s) ? '要先有自由稿，才能写提示词' : '要先有定稿的剧本，才能写提示词');
        if (!SB) throw fail('读不了 公用/关键帧绑定.js');
        const ps = parasOf(s), nos = ps.map(x => x.号), pa = Array.isArray(j.段落) && j.段落.length === 2 ? j.段落 : null;   // 段落：老请求带着的范围 [从, 到]（第几行）
        const code = vpCode(str(j.名)), ex = code ? SB.expand(code, nos) : null;   // 名字就是镜头号（11-16），照镜头表的固定号认：1-5 是镜头表里从镜头1 到镜头5 那几行
        if (ex && (ex.missing.length || !ex.nos.length)) throw fail('镜头表里没有镜头 ' + (ex.missing.join('、') || code) + '（现在的镜头表：' + (nos.join('、') || '空的') + '）');
        const shots = ex ? ex.nos : pa && pa[1] >= pa[0] ? nos.slice(pa[0] - 1, pa[1]) : null;
        if (!ex && pa && shots.length !== pa[1] - pa[0] + 1) throw fail('镜头表只有 ' + ps.length + ' 个镜头');
        const binds = SB.bindsOf(s);
        const assets = sceneImgs(flow, s).map(x => x.行);
        const scriptTx = await docText(sp), narr = !!Voice && (Voice.narrates(scriptTx) || (s.人物 || []).some(isNarr));   // 剧本里有旁白（11-17）
        const vo = await voiceAssets(j.项目, s, flow, narr);   // 出场人物指定的音色（11-15）、旁白的（11-17）
        for (const v of vo) assets.push(v.line);
        const txts = await txtsOf(j, flow, s);
        if (j.白模) assets.push('白模视频（这一条要挂，写成 @视频1）：' + j.白模);
        const frames = Array.isArray(j.关键帧) ? j.关键帧 : [];
        frames.forEach((f, i) => assets.push('关键帧（这一条要挂，第 ' + (i + 1) + ' 张' + (binds[f] ? '，镜头表' + SB.say(binds[f], s.段落) : '') + '）：' + f));
        j.assets = assets.map(x => x.split('：').pop());
        const look = await lookPart(j.项目, flow, s, '写', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'), lessons = await lessonsOf(), gp = await geoPart(j, s.场景图, s), bm = await bmPart(j, j.白模 ? [{ ref: '@视频1', path: j.白模 }] : []);
        const fp = framePart(frames, '每张定义了什么照图写（图已经让你看过）：这一刻的构图、人物位置、姿态、镜头方向；事件脚本里对应那一镜的开场要和它对得上。', '', s, shots);
        j.images = [...gp.images, ...frameImgs(j, frames)];
        const others = [];
        try {
          for (const f of vpLatest(await fsp.readdir(pj(j.项目, '提示词', segDir(j.段))))) {
            if (f === j.名) continue;
            others.push({ f, no: vpNo(f), text: unbom(await fsp.readFile(pj(j.项目, '提示词', segDir(j.段), f), 'utf8')).trim() });
          }
        } catch (e) { /* 还没有别的条 */ }
        others.sort(byNo);
        const sc = KINDS.写提示词.scope(vpNo(str(j.名)), others, str(j.写什么).trim(), shots);
        const range = sc.text + (j.白模 ? '这一条挂白模视频 @视频1：它和别的素材一样，管哪几秒、参考它什么照下面「这一条挂的白模视频」写，可以只管其中几秒。' : '') + (frames.length ? '这一条挂 ' + frames.length + ' 张关键帧（见下面「这一条挂的关键帧」），对应镜头的开场照关键帧。' : '');
        const otherText = sc.others.length ? ['', '## 这一段的其他几条提示词（只看，别改；接头处的人物位置、动作、光线要接得上）', ...sc.others.map(o => '### ' + o.f + (o.no ? '（第 ' + o.no + ' 条）' : '') + '\n' + (o.text || '（还是空的）'))].join('\n') : '';
        const pm = await pePart(j, { voice: vo.length > 0, bm: !!j.白模, frame: frames.length > 0 });
        return ['# 任务：给一段戏写 Seedance 视频提示词', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面有定稿的剧本、镜头表、全片设定、这一段能用的资产图。请照 sd25-pe 的格式写视频提示词。' + range,
          '', '## 要求', '1. 格式照下面「提示词格式」：这一条挂的素材五份以内用写法一，多于五份用写法二。镜头由剧情需要来设计，不必和镜头表一一对应，写在【事件脚本】里，一镜一行，一镜只讲一两件事；戏照「写戏规矩」写。' + Styles.writeRule, '2. 素材职责里用 @图片1、@图片2……引用资产图，只能用下面「能用的资产图」里的，镜头里看得见的人物、道具、场景都要挂。' + (txts.length ? TxtWord.PROMPT_RULE : ''),
          '3. 不写总时长（在生成参数里设）；要说清某一段在第几秒（比如白模只管的那几秒），写整秒「第2-4秒」。不写画面里没有的东西。' + (Secs ? Secs.ASK : ''), '4. ' + gp.rule, '5. 回复' + ['两', '三', '四', '五', '六'][(gp.make ? 1 : 0) + (Secs ? 1 : 0) + Styles.writeMore] + '块' + (gp.make ? '（最前面是【GEO底稿】）' : '') + '，照这个样子：', ...(gp.make ? ['【GEO底稿】', '（照 scene-geo 第五节模板写的底稿）'] : []), '【提示词】', '（整份提示词，从「【生成目标】」开始）', '【素材登记】', '[{"ref": "@图片1", "name": "叫法", "path": "资产/……png"}]', ...(Secs ? Secs.ASK_EG : []), ...Styles.writeEg(),
          ...(j.白模 ? ['6. 白模视频 @视频1 要挂：素材职责里照下面「这一条挂的白模视频」那一段写，【素材登记】里也登记它（{"ref": "@视频1", "name": "白模", "path": "' + j.白模 + '"}）。'] : []),
          ...(frames.length ? [(j.白模 ? '7' : '6') + '. 关键帧要挂：照下面「这一条挂的关键帧」那一段写，【素材登记】里也登记它们（name 写「关键帧」）。'] : []),
          ...(vo.length ? [(6 + (j.白模 ? 1 : 0) + (frames.length ? 1 : 0)) + '. ' + voiceRule(vo)] : []),
          '', pm.text, '', '## 能用的资产图', assets.join('\n') || '（没有）', ...(txts.length ? ['', TxtWord.promptPart(txts)] : []), bm, fp, '', '## 全片的设定', settingText(flow), look, gp.text,
          '', '## 这一段：第' + j.段 + '段｜' + str(s.名).trim(), sceneText(flow, s),
          '', '## 定稿的剧本', scriptTx, otherText, lessons ? '\n## 公用教训（写的时候记着）\n' + lessons : '', '', PE_FORMAT, '', PE_DRAMA, ...(gp.ref ? ['', gp.ref] : []), TAIL].join('\n');
      },
      async apply(j, text) {
        const sz = Styles.takeBlocks(text, ['分区', '标题']), t = sz.rest, a = t.indexOf('【提示词】'), z = t.indexOf('【素材登记】'), q = t.indexOf('【秒数】', a);   // 分区写法那份、标题先掐出来（shot-styles.js），别混进提示词、素材登记
        if (a < 0) throw fail('AI 没按要的格式回（没有【提示词】）');
        const end = Math.min(...[z, q].filter(x => x > a), t.length);
        const prompt = body(t.slice(a + 5, end), /^本段事件|^【生成目标】/);
        if (prompt.length < 80) throw fail('AI 写的提示词太短了');
        const rel = ['提示词', segDir(j.段), j.名];
        const fx = await Styles.forNew(j, prompt, sz.got), buf = Buffer.from(fx.text + '\n', 'utf8');   // 分区写进去（这一条拨成合并的照合并），另一种记进写稿资料备选
        await fsp.mkdir(path.dirname(vpPath(j)), { recursive: true });
        try { await fsp.writeFile(vpPath(j), buf, { flag: 'wx' }); }
        catch (e) { if (e.code === 'EEXIST') throw fail('等待 AI 时这份稿已被创建，保留现有内容；AI 答卷可在任务记录里查看'); throw e; }
        const g0 = t.indexOf('【GEO底稿】');
        const geoAt = g0 >= 0 && g0 < a ? await saveGeo(j, t.slice(g0 + 7, a)) : '';
        const list = await refsIn(j, z > a ? t.slice(z, q > z ? q : undefined) : '', j.assets || []);
        const fb = SB ? SB.bindsOf(sceneOf((await readFlow(j.项目).catch(() => null)) || {}, j.段) || {}) : {};
        for (const r of list) if (/^@图片/.test(r.ref) && fb[r.path]) r.name = SB.regName(fb[r.path]);   // 关键帧｜镜头11｜开头
        let bmNote = '';
        if (j.白模 && !list.some(r => r.path === j.白模)) {   // AI 没登记白模：照提示词里写的视频编号替它登记；一句都没写，也登记上（生成任务书时会拦下，提醒补那几句）
          const m = /@视频(\d+)/.exec(prompt), ref = m ? '@视频' + m[1] : '@视频1';
          if (!list.some(r => r.ref === ref)) list.push({ ref, name: stemOf(j.白模), path: j.白模, sha256: sha256(await fsp.readFile(pj(j.项目, ...j.白模.split('/')))) });
          if (!m) bmNote = '；注意：AI 没写白模那几句（@视频1），出片前要补上';
        }
        const mp = pj(j.项目, '资产', '参考素材映射.json');
        let map = { schema_version: 1, prompts: {} };
        try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { /* 还没有 */ }
        map.prompts = map.prompts && typeof map.prompts === 'object' ? map.prompts : {};
        map.prompts[rel.join('/')] = { prompt_sha256: sha256(buf), references: list };
        await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
        await Styles.putSide(j, fx.side);
        const secs = await putSecs(j.项目, rel, t);
        const nv = list.filter(r => /^@视频/.test(r.ref)).length, lostF = (Array.isArray(j.关键帧) ? j.关键帧 : []).filter(f => !list.some(r => r.path === f));
        const fNote = lostF.length ? '；注意：关键帧 ' + lostF.map(f => stemOf(f)).join('、') + ' AI 没登记，打开看一眼，出片前要补上' : '';
        return { 结果: '提示词写好了，挂了 ' + (list.length - nv) + ' 张图' + (nv ? '、' + nv + ' 段白模' : '') + bmNote + fNote + (geoAt ? '；AI 看图新建了一份 GEO 底稿，等你审' : '') + secsSay(secs) + fx.say, 产出: [rel.join('/'), ...(geoAt ? [geoAt] : [])] };
      },
    },
    /* 生成出片任务书：不用 AI，照固定的样子把这一条要用的东西排好（提示词、挂哪几张图、画布、参数、存到哪） */
    出片任务书: {
      title: j => '生成出片任务书 · 第' + j.段 + '段 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, local: true,
      async run(j) {
        const rel = ['提示词', segDir(j.段), str(j.名)], p = pj(j.项目, ...rel);
        if (!nameOk(str(j.名)) || !RE_VP.test(j.名) || !(await exists(p))) throw fail('没有这份提示词');
        const buf = await fsp.readFile(p), text = unbom(buf.toString('utf8')), label = str(j.名).replace(/\.txt$/i, '');   // 任务书、节点名里写的：提示词的名字（11-18 起样片也和它同名：公用/核心.js clipName）
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
              if (str(old.path).replace(/\\/g, '/') !== fp) throw fail(ref + ' 在参考素材映射里是 ' + old.path + '，在写稿记录的挂图里是 ' + fp + '：两处对的不是同一个文件。打开稿子核对一下再出片');
              continue;
            }
            if (!(await exists(pj(j.项目, ...fp.split('/'))))) continue;
            const stem = stemOf(fp);
            refs.push({ ref, name: VIDEO_RE.test(fp) ? stem : stem.split('_')[0], path: fp, sha256: sha256(await fsp.readFile(pj(j.项目, ...fp.split('/')))) });
          }
        } catch (e) { if (e.plain) throw e; /* 没有过程文件 */ }
        const holes = text.split(/\r?\n/).filter(l => /〔[^〔〕]*〕/.test(l));   // 模板句里留给人填的空
        if (holes.length) throw fail('提示词里还有 ' + holes.length + ' 句留着〔〕没填（「' + holes[0].trim().slice(0, 50) + '」）：填好再点「批准出片」');
        // 2026-11-15 他定：白模当普通素材，可以只管其中几秒；不再要「白模＋关键帧」的写法，不再拿白模的镜头、长短比稿子
        const used = [...new Set(text.match(/@(?:图片|视频|音频)\d+/g) || [])];
        const lost = used.filter(u => !refs.some(r => r.ref === u));
        if (lost.length) throw fail('提示词里写了 ' + lost.join('、') + '，可是没登记它是哪个文件（资产/参考素材映射.json）。先让 AI 批一批，或者写批注让 AI 改，把素材对上');
        const idle = refs.filter(r => /^@视频\d+$/.test(r.ref) && !used.includes(r.ref));
        if (idle.length) throw fail('挂了白模 ' + idle.map(r => path.basename(str(r.path))).join('、') + '（' + idle.map(r => r.ref).join('、') + '），可是提示词里没写它的编号：在素材里补上白模那几句，或者去掉白模，再点「批准出片」');
        refs = refs.filter(r => used.includes(r.ref)).sort((a, b) => a.ref.localeCompare(b.ref, 'zh', { numeric: true }));
        for (const t of ['图片', '视频', '音频']) {   // 即梦照挂的先后编号：@图片1、@图片2……要从 1 连着，缺一个号，后面的就全对错了（11-13 夜加）
          const nos = refs.filter(r => r.ref.startsWith('@' + t)).map(r => +r.ref.slice(t.length + 1)).sort((a, b) => a - b);
          if (nos.some((n, i) => n !== i + 1)) throw fail('提示词里的 @' + t + ' 没从 1 连着编（现在是 ' + nos.map(n => '@' + t + n).join('、') + '）：即梦照挂的先后编号，缺一个号，后面的就全对错了。你来写的稿：刷新流水线页面，再点「批准出片」，页面先往前挪号（正文、挂图、参考素材映射一起挪）；AI 写的稿：写批注让 AI 改');
        }
        for (const r of refs) if (!(await exists(pj(j.项目, ...r.path.split('/'))))) throw fail(r.ref + ' 对的那个文件不在了：' + r.path);
        for (const r of refs) {   // SHA-256 照现在的文件算（登记以后可能换过：文生资产里候选图「用这张」换上的、白模重渲的）；换过的把历史记录里各版旧的列出来（时间＋SHA-256），画布上的旧节点照 AGENTS.md 加那一版的 __时间
          const q = r.path.split('/'), now = sha256(await fsp.readFile(pj(j.项目, ...q))), name = q[q.length - 1], dot = name.lastIndexOf('.');
          if (dot > 0) {   // 11-15 起图片、白模视频都查：以前只查图片，重渲的白模任务书里没写改名，Codex 在画布上碰到同名的旧白模就停下来问
            const re = new RegExp('^' + name.slice(0, dot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '__(\\d{8}-\\d{6})' + name.slice(dot).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
            const hd = pj(j.项目, '历史记录', ...q.slice(0, -1));
            const olds = (await fsp.readdir(hd).catch(() => [])).map(n => [n, (re.exec(n) || [])[1]]).filter(x => x[1]).sort((a, b) => b[1].localeCompare(a[1]));   // 新的在前
            if (olds.length) r.换 = await Promise.all(olds.map(async ([n, t]) => ({ t, f: path.join(hd, n), sha: sha256(await fsp.readFile(path.join(hd, n))) })));   // 历史记录里有同名的旧版：这个名字的文件换过（f：认画布节点时比画面用）
          }
          r.sha256 = now;
        }
        const vrefs = refs.filter(r => /^@视频\d+$/.test(r.ref));
        for (const r of vrefs) r.secs = await vidSecs(pj(j.项目, ...r.path.split('/')));
        const vshort = vrefs.filter(r => r.secs && r.secs < 2), vtotal = vrefs.reduce((x, r) => x + (r.secs || 0), 0);
        if (vshort.length) throw fail('参考视频每段至少 2 秒即梦才收：' + vshort.map(r => r.ref + ' 只有 ' + r.secs.toFixed(1) + ' 秒').join('、'));
        if (vrefs.length > 10 || vtotal > 30.05) throw fail('参考视频最多 10 段、合计不超过 30 秒（现在 ' + vrefs.length + ' 段、' + vtotal.toFixed(1) + ' 秒），即梦不收');
        const done = [];   // 这一段出过的样片：成片和历史记录里的都算（移进历史记录名字不改），同一版再出一条接着排 _2、_3
        for (const d of [pj(j.项目, '成片', segDir(j.段)), pj(j.项目, '历史记录', '成片', segDir(j.段))]) { try { done.push(...await fsp.readdir(d)); } catch (e) { /* 没有这个文件夹 */ } }
        const clipFile = core('clipName')(j.名, done), P = Object.assign({ 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 15, 积分上限: 0 }, j.参数 || {});   // 样片和提示词同名（11-18 他定）：1_改3.txt 出的叫 1_改3.mp4
        const nth = clipFile.replace(/\.mp4$/i, '');   // 画布节点名里认它
        if (!/^(480p|720p|1080p)$/.test(str(P.清晰度)) || !(P.秒数 >= 4 && P.秒数 <= 30)) throw fail('清晰度或者时长不对');
        if (!str(set.画布).trim()) {   // 项目还没写画布：新建一张、记进出片设置（11-17 他要；jm-check.js 的 create）
          j.步骤 = '项目还没有即梦画布，在新建';
          const nc = await jmCheck.create(j.项目, prof);
          set = { ...set, 画布: nc.url, 登录位: prof, 任务书目录: set.任务书目录 || '项目/' + j.项目 + '/提示词', 下载目录: set.下载目录 || '项目/' + j.项目 + '/资产' };
          await writeFile(pj(j.项目, '资产', '出片设置.json'), JSON.stringify(set, null, 2) + '\n');
          log('新建了即梦画布「' + nc.name + '」：' + nc.url);
        }
        j.步骤 = '在核对即梦账号和画布';
        const nodeName = f => AP.nodeTitle(f);   // 素材节点名照 AGENTS.md「即梦画布」：人物和道具_文件名、场景_文件名、第N段_文件名（公用/资产路径.js）
        const nodeNote = f => { const [t, ...old] = AP.titlesOf(f); return '素材节点名：' + t + (old.length ? '；画布上要是还叫 11-20 以前的老名字（' + old.map(x => '「' + x + '」').join('或') + '），先把它改名成「' + t + '」再引用，不重传' : ''); };
        const swapped = refs.filter(r => r.换), cid = (/ai-canvas\/([0-9a-f-]{36})/i.exec(str(set.画布)) || [])[1];   // 换过新的：画布上同名的节点各是哪一版，先认好写进任务书，和核对账号一起查（11-17：原来叫 Codex 去生成记录里查，没记的它就停下问人）
        const seenP = swapped.length && cid ? canvas.versions({ name: j.项目, canvas: cid.toLowerCase(), profile: prof, items: swapped.map(r => ({ title: nodeName(r.path), titles: AP.titlesOf(r.path), cur: pj(j.项目, ...r.path.split('/')), sha: r.sha256, olds: r.换 })) })
          .catch(e => { log('画布上同名的节点没认成，任务书照旧叫 Codex 去认：' + e.message); return null; }) : null;
        const JMOK = await jmCheck(set.画布, prof);   // 这个号登着、画布在它名下才写任务书
        if (seenP) { j.步骤 = '在认画布上同名的节点是哪一版'; (await seenP || []).forEach((v, i) => { swapped[i].节点 = v; }); }
        // 登记照任务书写齐（11-19）：写稿页改了字、挪了号，白模重渲、换了图，参考素材映射这一条没跟着换，Codex 跑 核对参考素材.py 就停下。
        // 编号、文件上面都核过了：这一条登记改成和任务书一样（正文指纹、只留正文用到的编号、每样现在的 SHA-256），秒数这些别的不动
        const regFixed = refs.length ? await resha(j.项目, rel, refs.map(r => ({ ref: r.ref, name: r.name, path: r.path, sha256: r.sha256 })), undefined, text) : false;
        const tag = (/样片/.test(P.模型) ? '样片' : '') + P.清晰度, nodeA = '第' + j.段 + '段｜' + nth + '｜' + tag + '｜' + P.秒数 + '秒';   // 节点A 的名字：任务书、出片计划同一个
        const out = ['成片', segDir(j.段), clipFile], abs = (...x) => pj(j.项目, ...x).replace(/\\/g, '/');
        const per = /样片/.test(P.模型) && P.清晰度 === '480p' ? (vrefs.length ? 18 : 9) : /^Seedance 2\.5$/.test(P.模型) && P.清晰度 === '720p' ? (vrefs.length ? 26 : 13) : /2\.0 mini/.test(P.模型) && P.清晰度 === '720p' && vrefs.length ? 12 : /2\.0 VIP/.test(P.模型) && P.清晰度 === '720p' && vrefs.length ? 28 : 0;   // 以往实扣的价（2026-11-11～13；2.5 720p 照 11-17 的四回）；提示词.html 的 priceOf 是同一张表，改要两处一起改
        const lines = ['任务：在即梦画布上为《' + j.项目 + '》第' + j.段 + '段出一条视频：' + label + '，' + P.模型 + '，' + P.清晰度 + '，' + P.秒数 + ' 秒。',
          '这份任务书是项目管理的流水线在 ' + nowText() + ' 生成的。用户在页面上点了「批准出片」才会交到你手上；这一条由你从头做到尾：建草稿、核对、报价、提交生成、等出片、下载。不要手改这份任务书。',
          '', '〇、本次可以用的工具', '用本项目的即梦快线 ' + path.join(SKILLS, 'dreamina-video-fastlane').replace(/\\/g, '/') + ' 和它要用的 dreamina-canvas-cli，只限这一次。不要运行任何更新、安装技能的命令。',
          '新素材明确用 CLI 传，每样只传一次；回了状态不明，就用原编号只读核查，查不到就停下告诉我。不要用桌面 Computer Use 去点 Windows 的文件选择对话框。网页要求登录、付费开通，或弹出权限、授权窗口时就停下告诉我，不要代点。',
          '即梦账号：' + (prof ? '用登录位「' + prof + '」，每一条 dreamina-canvas 命令都带上 --profile ' + prof + '。' : '用默认登录位（命令不带 --profile）。') + '这个登录位应是「' + JMOK.nick + '」，画布「' + JMOK.name + '」在它名下（生成任务书时核对过）。开工前先用 auth status 看它是不是登录着、auth account 看是不是这个号；没登录或者不是这个号，就停下告诉我，不要自己登录、不要换账号。',
          ...(vrefs.length ? ['白模：这一条挂了参考视频 ' + vrefs.map(r => r.ref).join('、') + '（白模）。本项目没有白模核验工具，这份任务书没有「〇 核验回执」；用户定了带白模的条不做核验，点了「批准出片」就是跳过核验，交给你的那条消息里写着「白模我看过了，跳过核验」。消息里没有这句就停下问我，不要往下做。'] : []),
          '', '一、画布与节点', '画布：' + (set.画布 || '（资产/出片设置.json 里还没写画布网址：先停下问我）'), '新建一个视频节点，名字写：' + nodeA + '（下称节点A）。',
          '开工前先查画布上有没有同名节点：没有才新建；同名节点已经提交过，就停下告诉我；还是草稿，就在它上面接着做，不另建。这一条在画布上只新建节点A 这一个视频节点，别的节点一律不改、不删、不运行；引用已有的素材节点不算改动。',
          '', '二、模型与参数', P.模型 + '，' + P.清晰度 + '，16:9，生成 1 条，' + P.秒数 + ' 秒。全能参考。声音没有单独的开关就照默认，不要杜撰参数。',
          ...(per ? ['照以往实扣，' + (vrefs.length ? '带参考视频的' : '') + '这种出法每秒约 ' + per + ' 积分，这一条预计约 ' + per * P.秒数 + ' 积分；以报价为准。'] : []),
          ...(vrefs.length && vtotal && Math.abs(vtotal - P.秒数) > 1 ? ['白模合计 ' + vtotal.toFixed(1) + ' 秒，这一条照用户填的出 ' + P.秒数 + ' 秒，不要改。'] : []),
          '', '三、参考：' + refs.length + ' 个，按顺序挂，编号要对上', refs.length ? '画布上已经有同名素材节点的（节点名写在括号里），回读确认还在、类型对，就直接引用，不重传；没有的才用 CLI 传：图片传成独立图片节点' + (vrefs.length ? '，视频传成独立视频素材节点（resource upload --type video，再 node create video）' : '') + (refs.some(r => /^@音频\d+$/.test(r.ref)) ? '，音频传成独立音频素材节点（resource upload --type audio，再 node create audio，不带 --run）' : '') + '，节点名照括号里的写。节点A 里用「从画布选择」引用素材节点，不要直接上传进视频节点。' : '这一条没有登记参考素材（纯文字出片）。',
          ...refs.map(r => r.ref + ' ' + r.name + '：' + abs(...r.path.split('/')) + (r.secs ? '，' + r.secs.toFixed(1) + ' 秒' : '') + '，SHA-256 ' + r.sha256 + '（' + nodeNote(r.path) + '）。'
            + (r.节点 ? canvas.plan(nodeName(r.path), r.节点) : r.换 ? '这个文件换过新的，旧版收在历史记录。画布上的同名节点照生成记录里的 SHA-256 认：是下面哪一版旧的，就先把它改成那一版的名字（照 AGENTS.md，只改名，不删）：' + r.换.map(o => '「' + nodeName(r.path) + '__' + o.t + '」（SHA-256 ' + o.sha + '）').join('、') + '；改好再照这个文件传一个新节点，名字写「' + nodeName(r.path) + '」。是现在这个文件的，直接引用；哪一版都对不上、查不到，就停下问我。' : '')),
          ...(refs.some(r => r.换 || AP.titlesOf(r.path).length > 1) ? ['给' + [refs.some(r => r.换) ? '上面写着「换过新的」的旧节点改名' : '', refs.some(r => AP.titlesOf(r.path).length > 1) ? '把还叫老名字的素材节点改成新名字' : ''].filter(Boolean).join('、') + '，是「别的节点一律不改」仅有的例外。'] : []),
          '', '四、提示词', '文件：' + abs(...rel), '核对：非空行 ' + text.split(/\r?\n/).filter(l => l.trim()).length + ' 行，SHA-256 ' + sha256(buf) + '。',
          ...(refs.length ? ['登记：资产/参考素材映射.json 里这份稿的登记，生成任务书时已照这份任务书写齐（正文 SHA-256、第三节的编号和每样的 SHA-256）。跑 核对参考素材.py 不通过，就是任务书生成以后又有人改过：停下告诉我，不要自己改登记。'] : []),'全文原样填进节点A 的提示词，保留换行，不增删、不改字；存草稿后回读，和文件逐字比对一遍。装不下、被截断就停下告诉我，不要删减。',
          '', '五、核对、报价、提交', P.积分上限 > 0 ? '用户批准的积分上限是 ' + P.积分上限 + '：报价不超过它，就直接完成服务端确认、提交，不用再问我；超过就停在草稿，告诉我报价多少。'
            : '用户点了「批准出片」，就是同意按即梦报价出这一条：存好草稿、拿到报价，不用再问我，把这次的报价当作批准的积分上限，直接完成服务端确认、提交（照即梦快线第 4 节「已获明确金额上限」办；服务端要确认，不算要停下问我的情况）。',   // 11-18 他嫌每回都要在 Codex 里再点头：没填上限也直接提交
          '只提交节点A 这一次、生成 1 条。提交返回状态不明时先查节点状态，不重复提交。被版权限制或别的原因拦下就停下告诉我，不改提示词、不换参考、不重试。',
          '', '六、等待与下载', '提交后等它出完。等待查询超时不算失败，用同一个提交编号接着查，不重新提交。生成失败就停下把原因告诉我，不重试。', '成功后用 CLI 下载到 ' + abs(...out) + '。这个文件已经存在就停下告诉我，不覆盖。',
          '', '七、做完回复', '节点A 的编号、实际扣了多少积分、下载到的完整路径。'];
        const tf = ['提示词', segDir(j.段), taskOfVp(j.名)], book = lines.join('\n') + '\n';
        await archive(j.项目, tf);
        await writeFile(pj(j.项目, ...tf), book);
        /* 同一份任务书的机器读版本（11-21 起出片由流水线自己做，jm-video.js 照它跑）：放这一回的任务文件夹，出片时照任务书的 SHA-256 认 */
        await writeFile(path.join(j.dir, '出片计划.json'), JSON.stringify({ 说明: '出片任务书的机器读版本：流水线自己出片照它做（jm-video.js），和任务书同一回写的', 任务书: tf.join('/'), 任务书SHA: sha256(Buffer.from(book, 'utf8')), 写于: nowText(),
          项目: j.项目, 段: j.段, 画布: str(set.画布), 画布号: cid ? cid.toLowerCase() : '', 登录位: prof, 账号: JMOK.nick, 画布名: JMOK.name, 节点名: nodeA,
          模型: P.模型, 清晰度: P.清晰度, 秒数: P.秒数, 积分上限: P.积分上限, 提示词: { 路径: rel.join('/'), sha256: sha256(buf) }, 存到: out.join('/'),
          素材: refs.map(r => ({ ref: r.ref, name: r.name, path: r.path, sha256: r.sha256, ...(r.secs ? { secs: r.secs } : {}), 节点名: nodeName(r.path), 老名: AP.titlesOf(r.path).slice(1),
            ...(r.换 ? { 换: r.换.map(o => ({ t: o.t, f: o.f, sha: o.sha })) } : {}), ...(r.节点 ? { 节点: r.节点 } : {}) })) }, null, 1) + '\n');
        const ren = swapped.reduce((n, r) => n + (r.节点 || []).filter(x => x.版 && x.版 !== 'cur').length, 0), odd = swapped.filter(r => (r.节点 || []).some(x => !x.版)).map(r => nodeName(r.path));
        const seen = (ren ? '。画布上 ' + ren + ' 个旧节点要改名，已认好是哪一版' : '') + (odd.length ? '。注意：画布上「' + odd.join('」「') + '」认不出是哪一版，出片会停下问你' : '') + (swapped.some(r => !r.节点) ? '。画布上的旧节点这回没认成，出片时再认' : '');
        return { 结果: '任务书写好了（出 ' + clipFile + '，挂 ' + refs.length + ' 个参考' + (vrefs.length ? '，含 ' + vrefs.length + ' 段白模' : '') + '；即梦用' + (prof ? '「' + prof + '」号' : '默认号') + '「' + JMOK.nick + '」，画布「' + JMOK.name + '」）' + seen + (regFixed ? '。提示词或素材在登记以后改过，登记已照任务书补好' : ''), 产出: [tf.join('/')] };
      },
    },
    /* 出片（要花积分；只在用户点了「批准出片」时才开）：11-21 起流水线自己照任务书做（jm-video.js），不再交给 Codex；出了错停下说为什么。
       任务书照旧写全，要 Codex 接手的照样能贴给它 */
    出片: {
      title: j => '出片 · 第' + j.段 + '段 ' + vpLabelOf(vpOfTask(j.名)), need: ['段'], key: j => j.段 + '/' + j.名, local: true,
      接得上: true,   // 服务重开后照这一回文件夹里的 出片进度.json 接着做：提交过的只等、只下载，不再花积分
      async run(j) {
        const p = pj(j.项目, '提示词', segDir(j.段), str(j.名));
        if (!nameOk(str(j.名)) || !RE_TASK.test(j.名) || !(await exists(p))) throw fail('没有这份出片任务书');
        if (j.批准 !== '用户点了批准出片') throw fail('出片要用户在页面上点「批准出片」');
        if ((process.env.ANTOU_MOCK_DIR || process.env.ANTOU_CODEX_CHAT) && !process.env.ANTOU_JIMENG) throw fail('这是试验服务：不真出片（要试，设 ANTOU_JIMENG 换成假的即梦命令行）');
        let plan = null;
        if (!j.续) {
          plan = await planOf(j.项目, j.段, sha256(await fsp.readFile(p)));
          if (!plan) throw fail('没找到这份任务书排的出片计划（任务书是旧的，或者排好以后又改过）：没出片、没花积分。刷新页面，再点一次「批准出片」');
          j.步骤 = '在核对即梦账号和画布';   // 任务书排好以后改过号、画布的，这里拦下
          try { await jmCheck(plan.画布, plan.登录位); } catch (e) { throw e.plain ? fail(e.message + '。没出片，也没花积分；出片设置对上以后，再点「批准出片」') : e; }
          await noteShot(j);   // 记下这一回用的是哪一版提示词：样片待不待核对照它算
          await writeFile(path.join(j.dir, '自己交.json'), JSON.stringify({ id: j.id, 项目: j.项目, 建: j.建, 开始: j.开始, 请求: j.请求, 渠道: j.渠道, 方式: 'self', 开: Date.now(), 回复: '', run: true, 本机: true }, null, 1) + '\n');   // 服务重开后照它接回来（resumeSelf）
          j.本机交 = true;
        } else if (!(await exists(path.join(j.dir, '出片进度.json'))) && await exists(path.join(j.dir, '交给AI的话.txt'))) {   // 11-21 以前交给 Codex 的、服务重开前还在等它回话：照旧接着等（只为接得上那几条）
          j.步骤 = 'Codex 在出片（11-21 以前交出去的，接着等它回话）';
          const reply = await codexDo(j, '请照 ' + p + ' 执行。');
          await writeFile(path.join(j.dir, 'Codex的回复.md'), reply + '\n');
          return { 结果: 'Codex 做完了：' + reply.replace(/\s+/g, ' ').slice(0, 120), 产出: [] };
        }
        return await JV.go(j, plan, j.dir);
      },
    },
    /* ---------- 拍摄风格：剧本定稿以后，AI 读梗概和剧本，从风格库里挑一种推荐（11-14 加）。挑哪个还是人定；推荐写进 定稿的剧本/流水线_AI扩写.json 的「风格」 ---------- */
    推荐风格: {
      title: j => '推荐拍摄风格' + (j.段 ? ' · 第' + j.段 + '段' : ''), key: j => j.段 || 'all',
      async book(j) {
        if (!Style) throw fail('读不了 公用/风格库.js');
        if (j.段 && !segOk(j.段)) throw fail('要说清是第几段');
        const flow = await readFlow(j.项目), lib = await styleLib().catch(e => { throw fail('风格库读不了：' + e.message); });
        if (!lib.list.length) throw fail('风格库里还没有风格');
        const tone = await toneOf(j.项目), film = flow.风格 && typeof flow.风格 === 'object' ? str(flow.风格.名).trim() : '';
        j.风格名 = [...lib.list.map(c => c.名), ...(tone ? [Style.OWN] : [])];
        let scripts = '';
        for (const s of (Array.isArray(flow.场) ? flow.场 : []).filter(x => x && x.段 && (!j.段 || str(x.段) === j.段))) {
          const sp = srcPath(j.项目, s, str(s.段));
          if (await exists(sp)) scripts += '\n### 第' + s.段 + '段' + (finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs)) ? '（定稿了）' : '（还没定稿）') + '\n' + (await docText(sp)).slice(0, 8000);
        }
        const card = c => ['### ' + c.名 + (c.已定 ? '' : '（备选：还没出样片验过）'), ...['一句话', 'AI圈怎么用', '一眼认出', '别和它混', '容易跑偏'].filter(k => c[k]).map(k => k + '：' + c[k])].join('\n');
        return ['# 任务：照剧本给这部片子挑一种拍摄风格', '', '今天 ' + today() + '。这是一个 AI 短视频项目（用 Seedance 出片）。剧本定稿了，要定' + (j.段 ? '第' + j.段 + '段另用' : '全片') + '的拍摄风格。请读梗概和剧本，从下面的风格库里挑一种最合适的推荐；挑哪个由人定。',
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
    '5. 【事件脚本】一镜一行「镜头1：……」，镜头号从 1 连着编、不补 0，不写镜头标题；人和道具用称谓，镜头里指人写名字，不写他、她（台词、旁白里的照原文）。台词 {}、音效 <>、音乐 ()、字幕【】写在发生处，不用引号。最后一行写「声音包括〔配乐或无背景音乐、环境声、音效〕。」；影像风格、光色不写在这里，写进【基础设定】（第 10 条）。',
    '6. 【保持一致】写「保持……稳定。」，只写最怕错的两三样。',
    '7. 不写总时长、画幅分辨率（在生成参数里设），不写画面里没有的东西。要说清某一段在第几秒（比如白模只管的那几秒），写整秒「第2-4秒」。',
    '8. 稿子已经是旧格式（「本段事件：」开头的，或七分区的）：照它原来的格式改，不改成新格式。',
    '9. 白模视频和别的素材一样（2026-11-15 起）：素材里一句写清它用在第几秒到第几秒（整条都用就写整条）、只采用它的什么，可以只管其中几秒，别的秒数不参考它；关键帧照关键帧的写法，不因为挂了白模换写法。稿子已经一镜一镜写参考哪张的（「@图片…是各镜头的关键帧」），照它原来的写法改。',
    '10. 【基础设定】放在事件脚本前面（2026-11-14 用户定）：一样一行「影像风格：……」「摄影：……」「光色基调：……」，风格名打头，质感、拍法、光色写成看得见的样子；光色基调句末写这一段的时间和主光。老稿已经写成「最终画面采用……」那一行的，没让改风格就不挪。'].join('\n');
  const PE_DRAMA = ['## 写戏规矩',
    '1. 目标导向：要什么、怕什么？真人会怎么做？', '2. 反应要由刚发生的事引起。', '3. 听的人给一拍反应，不无故不动。', '4. 反应写成看得见的动作。',
    '5. 不过度演绎：被逼到了才爆发。', '6. 最重的那句，写被什么点着。', '7. 再写身体怎么使劲、话怎么往上冲。', '8. 夸张放在事上，人按常理反应。',
    '9. 禁止写一直不变的表情姿势。', '10. 禁止堆表情小动作，挑最清楚的一两处。', '11. 说话做事朝着对方，不无故冲镜头。', '12. 人多只写主要人物，次要人物各忙各的。',
    '13. 人少要写明具体人数。', '14. 放手：表情、小动作的细节。', '15. 不放手：人数、站位、道具。', '16. 不放手：台词原文、镜头顺序。', '17. 放手的底：一句台词配一个看得见的动作。'].join('\n');
  /* sd25-pe 地图（11-18 他定）：写哪一块看 sd25-pe 哪几节，地图是 sd25-pe地图.md（pe-map.js 读）。has：这一条挂了什么 { voice, bm, frame }。
     11-18 晚他定：任务书里只给地图和 sd25-pe 的路径（r.text，放在要求后面），写的 AI 先看地图、照地图去读那几节，不再把原文摘进来；旧格式稿也一样。
     对不上的（地图指的节找不到、sd25-pe 升级过地图没重核）：写明这回通读整份，记日志，任务结果里也报一句（j.摘不到） */
  const PeMap = require('./pe-map.js');
  async function pePart(j, has) {
    const r = PeMap.bookRef(await skill('sd25-pe'), has);
    j.摘不到 = r.missing.length ? '（sd25-pe 地图对不上，这回让 AI 通读整份技能：' + r.missing.slice(0, 2).join('；') + (r.missing.length > 2 ? ' 等 ' + r.missing.length + ' 处' : '') + '）' : '';
    if (r.missing.length) log('sd25-pe 地图对不上：' + r.missing.join('；'));
    return r;
  }
  /* 稿子是不是 sd2.5PE 格式（有独占一行的【生成目标】【基础设定】【主体与关系】【事件脚本】【保持一致】之一）、怎么读成几区：
     都照 公用/写稿状态.js（写稿页同一套），这里不另写 */
  const draft = () => { if (!PromptDraft) throw fail('读不了 公用/写稿状态.js'); return PromptDraft; };
  const isPeText = t => draft().formatOf(String(t || '')) === 'pe';

  /* ---------- 工序四：你来写提示词，AI 批注、按批注改 ----------
     只有分镜部分可在逐镜编辑、自由文本间切换；其余公共区共用。
     读成几区、照原样写回去，和写稿页（通用工具/项目管理_写稿试用.html）是同一套读法 */
  const BOMCH = String.fromCharCode(0xFEFF);
  /* 提示词的名字（11-16 他定）：就是这一条拍的镜头表镜头号，1-5.txt、4-9.txt；老稿 视频提示词.txt、视频提示词_02.txt、镜头a-b_视频提示词.txt 照旧认。
     算法都在 公用/核心.js（和流水线各页共用）。审片以后改出来的另存一份，名字后面加 _改1、_改2……（2026-11-14 他定）：1-5_改1.txt。
     原稿和前几版留在原处不动；流水线里一条只摆最新的那一版，出片也用它 */
  const RE_VP = Core ? Core.RE_VP : { test: core('RE_VP') };
  const vpPath = j => pj(j.项目, '提示词', segDir(j.段), str(j.名));
  const viaStr = f => n => f(str(n));   // 不是字的当空字
  const vpVer = viaStr(core('vpVer')), vpNo = viaStr(core('vpNo')), vpCode = viaStr(core('vpCode')), vpLabelOf = viaStr(core('vpLabel'));
  const vpLabel = j => vpLabelOf(j.名);
  const taskOfVp = viaStr(core('vpTask')), vpOfTask = viaStr(core('taskVp'));   // 视频提示词_改1.txt ↔ 出片任务_改1.txt；老名字 4-6_补1.txt ↔ 4-6_出片任务_补1.txt
  const RE_TASK = Core ? Core.RE_TASK : { test: core('RE_TASK') };
  const vpLatest = names => core('vpFams')(names).map(f => f.vers[f.vers.length - 1]);   // 一条只留最新那一版（接力稿比整条稿新的，整条稿不算：公用/核心.js vpFams）
  const byNo = (a, b) => (a.no || 1e9) - (b.no || 1e9) || a.f.localeCompare(b.f, 'zh', { numeric: true });   // 几条提示词照第几条排，老稿排后面
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
  /* 稿子改过以后：参考素材映射里这份稿的校验值跟着换（页面核对过校验值才肯显示 @图片 对的是哪张）。
     正文指纹和 通用工具/核对参考素材.py 同一算法：去掉开头的 BOM、换行统一成 LF 再算（11-19：以前照原样字节算，CRLF 的稿 Codex 一核就对不上）。
     text：算指纹用的正文（出片任务书照它写的那一份），不给就现读文件。改了登记返回 true，本来就对的一个字不动 */
  const promptSha = t => sha256(Buffer.from(unbom(unbom(t)).replace(/\r\n?/g, '\n'), 'utf8'));   // 读文件时去一个 BOM、算之前再去一个：和 核对参考素材.py 一样
  async function resha(name, rel, refs, more, text) {   // more：新挂的几样，接在原来登记的后面（按批注改新挂图，11-18）
    const mp = pj(name, '资产', '参考素材映射.json');
    return withFileLocks([mp], async () => {   // 页面写登记（挪编号、用新图）也走这把锁
      let map = null;
      try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { map = null; }
      if (!map && !refs && !more) return false;
      map = map && typeof map === 'object' ? map : { schema_version: 1, prompts: {} };
      map.prompts = map.prompts && typeof map.prompts === 'object' ? map.prompts : {};
      const key = rel.join('/'), cur = map.prompts[key];
      if (!cur && !refs && !more) return false;
      const next = { ...(cur || {}), prompt_sha256: promptSha(typeof text === 'string' ? text : await fsp.readFile(pj(name, ...rel), 'utf8')), references: refs || [...((cur && cur.references) || []), ...(more || [])] };
      if (cur && JSON.stringify(next) === JSON.stringify(cur)) return false;
      map.prompts[key] = next;
      await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
      return true;
    });
  }
  /* AI 估的每镜秒数（回复里的【秒数】）：记进参考素材映射这一条的「秒数」，带着估的那一刻整份稿的记号。
     没估就不动：旧的记号对不上新稿，出片弹窗会提醒「估完以后改过」 */
  async function putSecs(name, rel, reply) {
    if (!Secs) return null;
    const got = Secs.make(Secs.parse(reply), unbom(await fsp.readFile(pj(name, ...rel), 'utf8')), nowText());
    if (!got.rec) return got;
    const mp = pj(name, '资产', '参考素材映射.json');
    let map = null;
    try { map = JSON.parse(unbom(await fsp.readFile(mp, 'utf8'))); } catch (e) { return got; }
    const cur = map && map.prompts && map.prompts[rel.join('/')];
    if (!cur) return got;
    cur.秒数 = got.rec;
    await writeFile(mp, JSON.stringify(map, null, 2) + '\n');
    return got;
  }
  const secsSay = g => !g ? '' : !g.rec ? '；AI 没估每镜秒数，出片时自己填时长' : '；每镜秒数估好了，共 ' + Secs.total(g.rec) + ' 秒' + (g.missing.length ? '（镜头' + g.missing.join('、') + ' 没估）' : '');
  /* 这一场能挂的图：出场的人物、道具各自引用的图，这一段当人物、道具用的图，和这一场的场景图。一样一项 { 行：任务书里那一行, f：文件 }。
     写提示词、按批注改提示词（新挂图，11-18）共用 */
  const sceneImgs = (flow, s) => [
    ...['人物', '道具'].flatMap(k => Array.from(s[k] || []).flatMap(n => imgsOf((flow[k] || []).find(x => x && x.名 === n)).map(f => ({ 行: k + '「' + n + '」：' + f, f })))),
    ...segRefs(s).map(x => ({ 行: x.k + '参考「' + x.n + '」（这一段的图）：' + x.f, f: x.f })),
    ...Array.from(s.场景图 || []).map(f => ({ 行: '场景图：' + f, f })),
  ];
  /* 只用文字写、不出图的几样（11-17）：照它们的文字描写写（还是出图提示词的不算，照全片设定）。写提示词、交给 AI 写完共用 */
  async function txtsOf(j, flow, s) {
    const out = [];
    if (TxtWord) for (const x of TxtWord.itemsOf(flow, s, { noImg: core('noImg'), sceneStem, skip: isNarr })) {
      const p = pj(j.项目, ...x.rel), t = (await exists(p)) ? unbom(await fsp.readFile(p, 'utf8')) : '';
      out.push({ ...x, 字: t && TxtWord.isTxt(t) ? TxtWord.bodyOf(t) : '' });
    }
    return out;
  }
  const ADD_IMG = '要新挂图的（批注要你挂，或者说这一条该挂上）：素材里加一句，写法照 sd25-pe，写清图里要照的东西，装着东西的写上里面的；编号接着往后编，只挂下面「能挂的图」里的。JSON 后面另起一块【素材登记】，只写新挂的，path 照「能挂的图」里的写，像这样：';
  /* 这一场的 GEO 底稿（照 scene-geo 建的，人审用，不进提示词）：先找这一段文件夹里的，再找 提示词/全局资产/场景 里的；
     都没有，再看别的段里的（一张场景图几场共用时，底稿常放在头一场的文件夹里） */
  const sceneStems = s => s ? [...new Set([...(Array.isArray(s.场景图) ? s.场景图 : []).map(g => stemOf(g)), ...(Array.isArray(s.场景文字) ? s.场景文字 : []).map(sceneStem).filter(Boolean)])] : [];   // 这一场用到的几处地方
  async function geoOf(name, seg, s) {   // s：这一场。全局资产/场景 里「图名_GEO底稿.md」（文生资产一样一份）只要这一场用到的那几处；标了不要 GEO 的（11-17）不算
    const all = sceneStems(s), want = all.filter(st => !core('noGeo')(s, st)), out = [], stems = s ? new Set(want) : null;
    const take = async (rel, ok) => { try { for (const g of (await fsp.readdir(pj(name, ...rel))).sort()) if (/GEO底稿[^/]*\.md$/i.test(g) && (!ok || ok(g))) out.push({ rel: [...rel, g].join('/'), text: unbom(await fsp.readFile(pj(name, ...rel, g), 'utf8')).trim() }); } catch (e) { /* 没有这个文件夹 */ } };
    await take(['提示词', segDir(seg)]);
    await take(['提示词', '全局资产', '场景'], g => { const m = /^(.+)_GEO底稿\.md$/i.exec(g); return !m || !stems || stems.has(m[1]); });   // 老的（战场GEO底稿.md 这类）照旧都要
    if (!out.length && (!all.length || want.length)) { try { for (const d of (await fsp.readdir(pj(name, '提示词'))).sort()) if (/^第.+段$/.test(d) && d !== segDir(seg)) await take(['提示词', d]); } catch (e) { /* 没有提示词文件夹 */ } }
    return out.filter(x => x.text);
  }
  /* 写视频提示词用得上 scene-geo 的时候（11-18 晚他定：GEO 只在要用时带、只为场景带）：只给路径和要读的几节（ref），不把整份贴进任务书。
     有底稿：照底稿翻成场景段、写场景图那一句，读六、七两节；没底稿、看图现建：再加第五节的模板 */
  const GEO_PARTS = ['五、GEO 底稿模板（人审用，不进提示词）', '六、翻译成场景段（喂给模型的那一段）', '七、场景参考图的写法（按 sd25-pe）'];
  const geoRef = make => '## scene-geo（场景照它写：只读这几节，不用通读）\n' + path.join(SKILLS, 'scene-geo', 'SKILL.md') + ' 里的' + GEO_PARTS.slice(make ? 0 : 1).map(x => '「' + x + '」').join('') + '。';
  /* 任务书里讲场景的那几句、带的材料、要不要让 AI 看图：有底稿照底稿；没有底稿、有场景图，看图建一份；两样都没有就不讲 GEO */
  async function geoPart(j, sceneImgs, s) {
    const all = sceneStems(s), off = all.length > 0 && all.every(st => core('noGeo')(s, st));   // 人定的不要 GEO（11-17）：这一段的场景都标了
    if (off) return { make: false, images: [], text: '', ref: '', rule: '这一段的场景不用 GEO（人定的：没有严格站位）：场景照全片的场景描写、剧本写，挂了场景图的照图，不建 GEO 底稿，不要编图上才有的细节。' };
    const geo = await geoOf(j.项目, j.段, s), imgs = await imgsAt(j.项目, (Array.isArray(sceneImgs) ? sceneImgs : []).filter(g => !s || !core('noGeo')(s, stemOf(g))));   // 标了不要 GEO 的场景图不拿来建底稿
    const make = !geo.length && imgs.length > 0;   // 没有底稿、有场景图：让 AI 看图先建一份
    return {
      make, images: make ? imgs : [],
      rule: geo.length ? '场景一律照 scene-geo：下面给了这一段的 GEO 底稿（照生成好的场景图核过、人审过的），场景空间、轴线、站位、物件、光，都照底稿翻成场景段（scene-geo 第六节的办法），写进【主体与关系】（写法二写进【场景】）。底稿里的事实不许改、不许另编；底稿没写的地方不要自己添；底稿标了「逐镜状态」「待定」的照它的说明办。素材职责里场景图那一句照 scene-geo 第七节写（这张图是从哪往哪看的、只采用什么、不采用什么）。'
        : make ? '场景一律照 scene-geo：这一段还没有 GEO 底稿。你已经看过这一段的场景图了，先照 scene-geo 第五节的模板给它建一份 GEO 底稿（空间里有什么、各在哪、从哪往哪看；只写图上看得到的和剧本点了名的，图和剧本对不上的地方单列出来），放在回复最前面的【GEO底稿】一块里，给人审，不进提示词；再照这份底稿把场景空间、轴线、站位、物件、光翻成场景段（第六节），写进【主体与关系】（写法二写进【场景】）。素材职责里场景图那一句照第七节写。'
          : '这一段没有场景图也没有 GEO 底稿：场景只照全片的场景描写和剧本写，不要编图上才有的细节。',
      text: geo.length ? geo.map(x => {   // 给人核对的几节（依据、来源、只给人看的）不贴：点名的工程、数据、脚本写提示词用不上（11-23）
        const t = PeMap.geoForBook(x.text);
        return '\n## GEO 底稿（' + x.rel + '；人审用的底稿，照它翻，不要把底稿原文搬进提示词' + (t !== x.text ? '；依据、来源这类给人核对的几节没贴，用不上，不用去翻原文' : '') + '）\n' + t;
      }).join('\n') : make ? '\n## 这一段的场景图（已经让你看过）\n' + imgs.join('\n') : '',
      ref: geo.length || make ? geoRef(make) : '',
    };
  }
  async function saveGeo(j, text) {   // AI 新建的底稿：存到这一段的文件夹里给人审；那里已经有就不动
    const t = (text || '').trim(), rel = ['提示词', segDir(j.段), 'GEO底稿.md'];
    if (t.length < 80 || await exists(pj(j.项目, ...rel))) return '';
    await writeFile(pj(j.项目, ...rel), '# 第' + j.段 + '段 GEO 底稿\n\n人审用，不进提示词。' + nowText() + ' ' + chLabel(j) + ' 看着场景图、照 scene-geo 建的，还没人审过：看完哪里不对，改这份底稿，再写批注让 AI 照它改提示词。\n\n' + t + '\n');
    return rel.join('/');
  }
  /* 这个项目定下来的全片光影总基调：写提示词的时候带上 */
  async function toneOf(name) { const p = pj(name, '提示词', '全局资产', '全片_光影总基调.txt'); return (await exists(p)) ? unbom(await fsp.readFile(p, 'utf8')).trim() : ''; }
  /* 交给 AI 的「拍摄风格」那一段（11-14 加）：这一场另选的先算，没有就照全片的（s 不给：只看全片的，资产图是各场共用的）。
     风格库里的一种：带上它的写法；「本项目自己的」：照光影总基调；没定风格：照旧只带光影总基调（有的话），小标题用 toneHead。
     use：写（写提示词）、批、改、图（出图提示词），各带哪几行见 公用/风格库.js */
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
  /* 写、批提示词带的教训只有公用的这一份（11-18 晚他定：各项目都用得上的，两百字内；项目自己的「历史教训」留给人看、出问题再查，不进任务书）。
     在 annotate-live/公用教训.md：人能改，每回现读，去掉标题那一行；没有这份就不带 */
  async function lessonsOf() {
    try { return unbom(await fsp.readFile(path.join(__dirname, '公用教训.md'), 'utf8')).replace(/\r\n/g, '\n').replace(/^#[^\n]*\n+/, '').trim(); } catch (e) { return ''; }
  }
  /* 出场人物的音色（录音在 资产/人物和道具；流水线人物表里挑给谁的，没挑照「叫法_音色.wav」认，认法在 公用/音色.js；2026-11-15 加）：写提示词时当能用的素材，这一条里他有台词才挂 */
  /* narr：这一段有旁白（剧本里有「旁白：」的台词行，或人物里手加了「旁白」；11-17）：旁白的录音也挂，排在人物后面 */
  async function voiceAssets(name, s, flow, narr) {
    if (!Voice || !s) return [];
    const names = await fsp.readdir(pj(name, ...Voice.DIR.split('/'))).catch(() => []), rows = flow && flow.人物;
    const out = Voice.ofPeople((s.人物 || []).filter(n => !isNarr(n)), names, rows).map(v => ({ 名: v.名, path: v.path, 音色: true, line: '人物「' + v.名 + '」的音色（录音）：' + v.path }));
    const nv = narr ? Voice.ofPeople([Voice.NARRATOR], names, rows)[0] : null;
    if (nv) out.push({ 名: nv.名, path: nv.path, 音色: true, 旁白: true, line: '旁白（画外音，不出镜）的音色（录音）：' + nv.path });
    return out;
  }
  /* 挂音色的规矩照 sd25-pe：有台词才挂、一人一段一行；台词照文字，录音只给音色、口音、语速和情绪；说话那一镜写明谁说、别人闭口听。旁白另一句（公用/音色.js 的 narrRule） */
  const voiceRule = vo => {
    const ppl = vo.filter(v => !v.旁白), nv = vo.find(v => v.旁白);
    return [ppl.length ? '人物' + ppl.map(v => '「' + v.名 + '」').join('') + '指定了音色（「能用的」里写着「的音色」那几行）：这一条里他有台词才挂，不说话就不挂；挂成 @音频1、@音频2……（从 1 连着编，一个人一段），素材里一人一行「' + Voice.line(ppl[0].名, '@音频1') + '」（写法二放【动作与声音】），【素材登记】里也登记（{"ref": "@音频1", "name": "' + ppl[0].名 + '", "path": "' + ppl[0].path + '"}）。事件脚本里他说话那一句写明是他说的（叫法和素材里一样，不用再写 @音频），同一镜别的人自然闭口听；台词照文字，录音不定台词；没写说哪种话就别补普通话、方言。' : '',
      nv ? Voice.narrRule(nv.path, ppl.length > 0) : ''].filter(Boolean).join('');
  };
  async function refsIn(j, text, allowed) {   // AI 回的【素材登记】：只认这一场能挂的、文件还在的
    let refs = [];
    try { const m = /\[[\s\S]*\]/.exec(text); refs = m ? JSON.parse(m[0]) : []; } catch (e) { refs = []; }
    const list = [];
    for (const r of Array.isArray(refs) ? refs : []) {
      const p0 = str(r && r.path).replace(/\\/g, '/'), base = pj(j.项目).replace(/\\/g, '/').replace(/\/?$/, '/'), p = p0.toLowerCase().startsWith(base.toLowerCase()) ? p0.slice(base.length) : p0;   // AI 抄了 E:\… 的整条路径也认（11-18）
      if (!/^@(图片|视频|音频)\d+$/.test(str(r && r.ref)) || !allowed.includes(p) || !(await exists(pj(j.项目, ...p.split('/'))))) continue;
      list.push({ ref: r.ref, name: str(r.name), path: p, sha256: sha256(await fsp.readFile(pj(j.项目, ...p.split('/')))) });
    }
    return list;
  }
  /* 按批注改新挂的图（11-18）：改好的稿里新出现的 @图片N 这些，要在 AI 回的【素材登记】里登记、是这一场能挂的图；已经登记过的编号不许换成别的文件。
     登记不全就不改（不然要到出片才拦下）。回新登记的几样（登记了、稿子里没写到的不记） */
  async function newRefs(j, before, after, reg) {
    const tags = t => new Set(String(t).match(/@(图片|视频|音频)\d+/g) || []), had = tags(before), now = tags(after);
    if (![...now].some(t => !had.has(t)) && !str(reg)) return [];
    const flow = (await readFlow(j.项目).catch(() => null)) || {}, s = sceneOf(flow, j.段), regs = new Map((await regOf(j)).map(r => [r.ref, r.path])), add = [];
    for (const r of await refsIn(j, reg, s ? sceneImgs(flow, s).map(x => x.f) : [])) {
      if (regs.has(r.ref) && regs.get(r.ref) !== r.path) throw fail('AI 登记的 ' + r.ref + ' 是 ' + r.path + '，可这一条的 ' + r.ref + ' 已经是 ' + regs.get(r.ref) + '，这回没改');
      if (!regs.has(r.ref) && now.has(r.ref) && !add.some(x => x.ref === r.ref)) add.push(r);
    }
    const lost = [...now].filter(t => !had.has(t) && !regs.has(t) && !add.some(r => r.ref === t));
    if (lost.length) throw fail('AI 新挂了 ' + lost.join('、') + '，可没在【素材登记】里写是哪张图（只能挂这一场能挂的图），这回没改');
    return add;
  }
  async function sideOf(j) {
    try {
      const value = JSON.parse(unbom(await fsp.readFile(vpPath(j).replace(/\.txt$/, '_写稿.json'), 'utf8')));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('不是对象');
      return value;
    } catch (e) { if (e.code === 'ENOENT') return {}; throw fail('写稿资料读不了，为保护现有内容没有改动：' + e.message); }
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
  const framesOf = (j, regs, s) => regs.filter(r => /^@图片\d+$/.test(r.ref) && AP.inSeg(r.path, j.段) && (FRAME_RE.test(path.basename(r.path)) || (!!s && Array.isArray(s.关键帧) && s.关键帧.includes(r.path))));
  const frameImgs = (j, frames) => frames.map(f => pj(j.项目, ...(f.path || f).split('/'))).filter(p => IMG_RE.test(p));
  const FRAME_HOW = '写法照 sd25-pe「关键帧锚点」：一张的写「@图片N作为首帧。」，另起一句「该首帧定义……。」（绑在结尾的、名字带「尾帧」的当尾帧）；几张的照上面的先后，先写「以@图片A至@图片B的顺序作为关键帧。」（编号不连着就用顿号一个个列），第一张当首帧，中间的写「@图片N定义第二个关键帧：……。」，最后一张绑在结尾、名字带「尾帧」的当尾帧。写法二放【场景】最前面，写法一放【参考素材职责】最前面。';
  const FRAME_HOW_SHOT = '这一条的关键帧是一镜一镜写参考哪张的（「@图片…是各镜头的关键帧」那一句，和每一镜开头的「参考@图片N」）：照这个写法留着、接着写，不换成 sd25-pe 的锚点句。';
  const FRAME_BIND = '每张后面括号里写着它绑在镜头表哪一镜的哪一刻（人在资产那一步绑的）：开头的是那一镜开场的画面，中间的是那一镜当中的一刻，结尾的是那一镜收尾的画面。事件脚本里演到镜头表那一镜的戏时照它对上，关键帧那几句（「该首帧定义……」「定义第二个关键帧：……」）也照那一镜那一刻写，不要挪去别的镜头。';
  /* 任务书里讲关键帧的那一段。text：现在的稿（一镜一镜写参考哪张的老稿，照它的写法留着）；s：这一场（有就写明每张绑在哪一镜哪一刻）；shots：这一条拍的镜头号 */
  function framePart(frames, how, text, s, shots) {
    if (!frames.length) return '';
    const shot = !!text && !!BmKey && BmKey.isBmk(text), binds = s && SB ? SB.bindsOf(s) : {}, paras = s && Array.isArray(s.段落) ? s.段落 : [];
    const line = (f, i) => { const p = f.path || f, b = binds[p];
      return (f.ref ? f.ref : '第 ' + (i + 1) + ' 张') + '：' + p + (b ? '（镜头表' + SB.say(b, paras) + (b.备选 ? '；备选的一版' : '') + (shots && !shots.includes(b.镜) ? '；不在这一条拍的镜头里' : '') + '）' : s ? '（没绑镜头表）' : ''); };
    return ['', '## 这一条挂的关键帧（按先后）', ...frames.map(line), ...(frames.some(f => binds[f.path || f]) ? [FRAME_BIND] : []), shot ? FRAME_HOW_SHOT : FRAME_HOW, how].join('\n');
  }
  /* 白模旁边同名的「_说明.md」：人写的（几何体各是什么、几个镜头），切点一镜一行「镜头1：0-4秒」 */
  async function bmNote(j, v) {
    const abs = pj(j.项目, ...v.path.split('/')), note = abs.replace(/\.[^.]+$/, '') + '_说明.md';
    const text = (await exists(note)) ? unbom(await fsp.readFile(note, 'utf8')).trim() : '';
    return { abs, note, text, cuts: BmKey && text ? BmKey.cutsOf(text) : [] };
  }
  /* 任务书里讲白模的那一段：挂了哪段、多长；白模旁边有同名的「_说明.md」（人写的：几何体各是什么、管成片哪几秒）就带上。
     2026-11-15 起白模是普通素材，可以只管其中几秒 */
  async function bmPart(j, vids) {
    if (!vids.length) return '';
    const out = ['', '## 这一条挂的白模视频'];
    for (const v of vids) {
      const n = await bmNote(j, v), secs = await vidSecs(n.abs);
      out.push(v.ref + '：' + v.path + (secs ? '，时长 ' + secs.toFixed(1) + ' 秒' : ''));
      if (n.text) out.push('白模说明（' + path.basename(n.note) + '）：', n.text.slice(0, 4000));
    }
    out.push('写法照 sd25-pe「白模参考与渲染」：白模是生成参考，不是编辑母版；先判断粗粒度还是细粒度；写明只采用它的什么（动作路径、站位、机位、运镜、切镜……），不采用白模外观、材质和场景；几何体逐个对应到最终的人物或道具。',
      '白模和别的素材一样，可以只管其中几秒：白模那一句写清它用在第几秒到第几秒（整秒；整条都用就写整条；白模说明里写了管成片哪几秒就照写），别的秒数不参考它；它管的那几镜，事件脚本里也写「机位和运镜照' + vids[0].ref + '」。',
      '几何体各对应谁：照上面的白模说明写；没有说明、或说明里没写到的，写成「' + vids[0].ref + '中的〔哪个白模几何体〕对应〔哪个人物或道具〕。」留给人填，不要猜。');
    return out.join('\n');
  }
  Object.assign(KINDS, {
    /* AI 批注：只批不改。写成写稿页认的格式（总评一行，一条一节），最多 8 条 */
    批注提示词: {
      title: j => 'AI 批注 · 第' + j.段 + '段 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
      prep: vpNeed,
      async book(j) {
        const flow = await readFlow(j.项目).catch(() => null), s = flow && sceneOf(flow, j.段), sp = srcPath(j.项目, s, j.段), hp = shotsPath(j.项目, j.段);
        const side = await sideOf(j), lessons = await lessonsOf();
        const raw = unbom(await fsp.readFile(vpPath(j), 'utf8')), pe = isPeText(raw), regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, s);
        const perShot = !!BmKey && BmKey.isBmk(raw);   // 一镜一镜写参考哪张的老稿：关键帧照它的写法批（11-15）
        const pm = await pePart(j, { voice: /@音频\d/.test(raw) || regs.some(r => /^@音频\d+$/.test(r.ref)), bm: vids.length > 0, frame: frames.length > 0 && !perShot });   // 旧格式稿也只给地图和 sd25-pe 的路径（11-18 晚）
        const bm = await bmPart(j, vids) + framePart(frames, '图已经让你看过。', raw, s, shotsOf(s, j.名));
        j.images = frameImgs(j, frames);
        return ['# 任务：给一份视频提示词写批注（只批不改）', '', '今天 ' + today() + '。这是一个 AI 短视频项目。下面是一段戏的 Seedance 视频提示词（' + (pe ? '生成目标和事件脚本' : '本段事件和分镜') + '多半是人自己写的），和这一段的剧本（老项目有镜头表的也带上）。请你当一个懂 Seedance 的编辑，给它写批注。',
          '', '## 怎么批', '1. 最多 8 条，要紧的排在前面。只批不改：稿子一个字都不动，你只写批注。写得好的地方不用夸，没问题就少写。',
          '2. 看这几样：和剧本对不对得上（漏戏、加戏、顺序）；人物想干什么、为什么这么反应写清楚没有（前因后果连不连得上）；一镜是不是只讲一两件事；有没有写一直不变的表情姿势、画面里没有的东西、总时长（说清某一段在第几秒的整秒不算）。' + (side.写法 === '自由' ? '用户只把分镜写成自由文本，不因分镜未逐镜分栏、缺少编号或作用字段批评格式。素材等公共区仍然共用，照实际内容核对。' : '镜头数量、顺序、标题和作用由用户决定，不要求镜头和镜头表一一对应。') + '人物的戏照「写戏规矩」看。',
          ...(vids.length ? ['   这一条挂了白模（见下面「这一条挂的白模视频」）：白模和别的素材一样，可以只管其中几秒。看素材里有没有照 sd25-pe 写白模那几句（用在哪几秒、只采用什么、不采用白模外观材质场景、几何体各对应谁），还留着〔〕没填的要提醒；没写清它管哪几秒的，提醒补上。'] : []),
          ...(frames.length ? [perShot ? '   这一条挂了关键帧，是一镜一镜写参考哪张的（见下面「这一条挂的关键帧」）：看每一镜参考的那张和这一镜的戏对不对得上，每一镜开头的秒数是不是整数、一镜接着一镜；不要提醒改成 sd25-pe 的锚点句；图里画了爆炸、烟、火这类会动的东西，挂上会被钉住不动，也要提醒。'
            : '   这一条挂了关键帧（见下面「这一条挂的关键帧」）：看关键帧那几句照 sd25-pe 写了没有（顺序句、首帧尾帧的角色句、第几个关键帧），定义的状态和图、和事件脚本那一镜的开场对不对得上，还留着〔〕没填的要提醒；每张绑在镜头表哪一镜哪一刻（括号里写着），看它用的位置对不对得上那一镜那一刻，绑的是别的镜头、没绑的也提醒；图里画了爆炸、烟、火这类会动的东西，挂上会被钉住不动，也要提醒。'] : []),
          '3. 每条要具体、能照着改，用大白话，批注和原因各一句。能给出替换的句子就写「改成」（只写一行：替换「原文」那句话的新句子，照抄就能用）；只是提醒就不写「改成」这一行。',
          ...(pe ? ['4. 「原文」要从稿子里一字不差地抄一句：【生成目标】下面的话、某一镜「镜头N：」后面的一句、或者素材、主体与关系、保持一致里的一整行，好让页面找到它在哪。不要抄「镜头N：」这几个字，不要抄【】段名那一行。',
            '   这一处还空着、没有原文可抄的（比如某一镜还没写、生成目标没写）：不写「原文」和「改成」，在「批注」里直接给一句建议的写法。是对整份的意见，位置写「整体」，不写原文。',
            '5. 回复照这个样子，别的都不要：', '总评：一句话', '## 1', '- 位置：镜头1（或者 生成目标、素材、基础设定、主体与关系、保持一致、整体）']
          : ['4. 「原文」要从稿子里一字不差地抄：「本段事件：」后面的话、某一镜标题下面正文里的一句、或者素材、基础设定、本段、保持一致里的一整行，好让页面找到它在哪。不要抄镜头标题那一行（「镜头 01｜……」），不要抄「本段事件：」这几个字。',
            '   这一处还空着、没有原文可抄的（比如某一镜只有标题、本段事件没写）：不写「原文」和「改成」，在「批注」里直接给一句建议的写法。是对整份的意见，位置写「整体」，不写原文。',
            '5. 回复照这个样子，别的都不要：', '总评：一句话', '## 1', '- 位置：镜头 01（或者 本段事件、素材、基础设定、本段、保持一致、整体）']), '- 级别：要改（或者 提醒）', '- 类别：对剧本（或者 写法、格式、资产、合理性）', '- 原文：稿子里的原话', '- 批注：一句', '- 原因：一句', '- 改成：整句替换的话', '## 2', '……',
          '', pm.text,
          '', '## 提示词（文件：' + j.名 + '）', raw, bm, await lookPart(j.项目, flow, s, '批', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'),
          s ? '\n## 这一段出场的和镜头表\n' + sceneText(flow, s) : '', (await exists(sp)) ? '\n## 剧本\n' + await docText(sp) : '', (await exists(hp)) ? '\n## 老的镜头表（Word 文件）\n' + await docText(hp) : '', lessons ? '\n## 公用教训（批的时候记着）\n' + lessons : '',
          '', ...(pe ? [PE_FORMAT, ''] : []), PE_DRAMA, TAIL].join('\n');
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
        await writeFile(pj(j.项目, ...rel), '总评：' + (sum || '见下面几条。') + '\n\n' + parts.map((p, i) => '## ' + (i + 1) + '\n' + p).join('\n\n') + '\n\n（' + nowText() + '　' + chLabel(j) + ' 批的）\n');
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
        const f = await filmedOf(j);   // 出过片的照改，改好另存成下一版（11-22）：另存不了的现在就说
        if (f && f.出过片 && f.不能另存) throw fail(f.在出 ? '这一版正在出片：出完再交给 AI 改（改好另存成新的一版，原稿不动）' : '这一版出过片，原稿不能改，也另存不了：' + f.不能另存);
      },
      async book(j, opt = {}) {   // opt：照审片批注另存（review-fork.js）给的 { head：开头几行, note：拼好的批注 }
        const regs = await regOf(j), vids = vidsOf(regs), vpText = unbom(await fsp.readFile(vpPath(j), 'utf8'));
        const flow = (await readFlow(j.项目).catch(() => null)) || {}, s = sceneOf(flow, j.段), sp = srcPath(j.项目, s, j.段), frames = framesOf(j, regs, s), imgs = s ? sceneImgs(flow, s) : [];
        const note = opt.note != null ? opt.note : unbom(await fsp.readFile(pj(j.项目, ...j.rel), 'utf8'));   // 地图点名哪几行：稿里挂了的，加上批注说到的；旧格式稿也只给路径（11-18 晚）
        const pm = await pePart(j, { voice: /@音频\d|音色/.test(vpText + note) || regs.some(r => /^@音频\d+$/.test(r.ref)), bm: vids.length > 0 || /白模/.test(note), frame: (frames.length > 0 || /关键帧|首帧|尾帧/.test(note)) && !(BmKey && BmKey.isBmk(vpText)) });
        return [...(opt.head || ['# 任务：按批注改视频提示词', '', '今天 ' + today() + '。下面是一份 Seedance 视频提示词的原文，和人写的批注。请照批注改。']),
          '', '## 要求', '1. 只改批注说到的地方，别的一个字都不动。批注里的「原文」照抄了要改的那一行；「原文（第N处）」指全文第 N 处一样的文字；「整体」是对整份的意见。',
          '2. 批注要是把原文抄下来改过的，就是要这一行改成批注里写的样子，照抄批注，不要再润色；批注里那句话末尾没打标点的，沿用原句末尾的标点。',
          '3. 批注是提要求的（比如「这句太夸张」「素材写多了」），就照要求改，改动尽量小；写法照 sd25-pe 和下面的「提示词格式」「写戏规矩」，稿子是旧格式（「本段事件：」开头的）就照它原来的格式改。',
          '4. 回复一段 JSON：一处改动一项。「原文」是要换掉的那一整行，从原文里一字不差地抄；「第几处」是全文第几处一样的行（只有一处就写 1）；「改成」是新的一整行，要拆成几行就用 \\n 隔开，要删掉这一行就写空字符串。像这样：',
          '[{"原文": "要换掉的那一整行", "第几处": 1, "改成": "新的一整行"}]',
          '5. ' + ADD_IMG, '【素材登记】', '[{"ref": "@图片2", "name": "叫法", "path": "资产/……png"}]',
          ...(Secs ? ['6. ' + Secs.ASK.replace('回复最后', 'JSON 后面'), ...Secs.ASK_EG] : []),
          '', pm.text,
          '', '## 原文（文件：' + j.名 + '）', vpText, ...await Styles.fixPart(j, vpText), await bmPart(j, vids),
          framePart(frames, '关键帧那几句的编号和先后、每一镜开头的秒数和参考哪张，批注没说到的不动。', vpText, s, shotsOf(s, j.名)), await lookPart(j.项目, null, s, '改', '全片的光影总基调（批注说到画面味道时照它改）'), '', '## 能挂的图（这一场的）', imgs.map(x => x.行).join('\n') || '（没有）', '', '## 批注', note,
          (await exists(sp)) ? '\n## 这一段的剧本（对照用）\n' + await docText(sp) : '', '', PE_FORMAT, '', PE_DRAMA, TAIL].join('\n');
      },
      async apply(j, text, opt = {}) {   // opt.must：一定要改出新东西（照审片批注另存，review-fork.js）：没改就说这一句，不另存
        const alt = Styles.takeBlocks(text, ['另一种']);   // 另一种写法跟着改的几镜（shot-styles.js）：先掐出来，别混进 JSON、素材登记
        text = alt.rest;
        const z = text.indexOf('【素材登记】'), q = text.indexOf('【秒数】'), reg = z >= 0 ? text.slice(z, q > z ? q : undefined) : '';   // 新挂的图（11-18）登记在 JSON 后面的【素材登记】
        const ops = opsOf(z >= 0 ? text.slice(0, z) : text), rel = ['提示词', segDir(j.段), j.名];
        if (!ops.length && opt.must) throw fail(opt.must);
        if (!ops.length) {   // 照新资产改（11-17，公用/资产改过.js）：AI 对过说都对得上。稿子一字不动，只把时间更新（不再标「资产改了」），批注照旧收走
          const note = pj(j.项目, ...j.rel), md = (await exists(note)) ? unbom(await fsp.readFile(note, 'utf8')) : '';
          if (!AssetEdit || !AssetEdit.onlyAuto(md)) throw fail('AI 说没有要改的地方');
          await writeFile(vpPath(j), await fsp.readFile(vpPath(j)));
          await archive(j.项目, j.rel);
          const secs = await putSecs(j.项目, rel, text);   // 回的【秒数】照样记（11-17 晚他要）：不记的话，稿子估完以后改过的，出片弹窗一直说「估完以后改过」
          return { 结果: '对过改了的资产：这一条没有要改的，提示词一字没动，不再标待核对' + secsSay(secs), 产出: [rel.join('/')] };
        }
        const raw = await fsp.readFile(vpPath(j), 'utf8'), bom = raw.charCodeAt(0) === 0xFEFF, eol = /\r\n/.test(raw) ? '\r\n' : '\n';
        const lines = (bom ? raw.slice(1) : raw).split(/\r\n|\n|\r/), miss = [];
        for (const o of ops) {
          const want = o.原文.trim(), nth = Math.max(1, Number(o.第几处) || 1), put = o.改成.split(/\r?\n/).map(l => l.trim()).filter((l, i, arr) => l || arr.length === 1);
          let hit = -1, seen = 0;
          for (let i = 0; i < lines.length; i++) if (lines[i] !== null && lines[i].trim() === want && ++seen === nth) { hit = i; break; }
          if (hit < 0) {   // 没有一模一样的整行：AI 可能只抄了一行里的半句。全文只有一处含着它，就换那半句
            const idx = lines.map((l, i) => l !== null && l.includes(want) ? i : -1).filter(i => i >= 0);
            if (idx.length === 1 && lines[idx[0]].split(want).length === 2) { lines[idx[0]] = lines[idx[0]].replace(want, () => o.改成.replace(/\r?\n/g, '')); continue; }   // 用函数换：AI 的话里有 $& 这类记号也照原样放
            miss.push(want.slice(0, 20)); continue;
          }
          lines.splice(hit, 1, ...(put.length === 1 && !put[0] ? [null] : put));   // 删掉的先占着位，下面一起拿掉：不影响后面几处数第几处
        }
        if (miss.length) throw fail('有 ' + miss.length + ' 处在稿子里没找到原话（「' + miss[0] + '…」），这回没改。稿子可能刚改过，再交一次');
        const out = (bom ? BOMCH : '') + lines.filter(l => l !== null).join(eol), add = await newRefs(j, raw, out, reg);   // 新挂的图登记不全就不改（11-18）
        const f = await filmedOf(j), was = f && f.出过片 ? j.名 : '';   // 出过片的（11-22 他定）：原稿不动，先另存成下一版，改的是新的这一版
        if ((was || opt.must) && sameText(out, raw)) throw fail(opt.must || '改出来和原稿一字不差：出过片的要改出新的一版，原样照抄不算（11-23 他定），这回没另存');
        if (was) {
          if (f.不能另存) throw fail(f.在出 ? '这一版正在出片：出完再交给 AI 改' : '这一版出过片，原稿不能改，也另存不了：' + f.不能另存);
          try { j.名 = (await filmed.fork(j.项目, j.段, j.名, { text: out })).名; } catch (e) { throw fail('这一版出过片，要另存成新的一版，没存成：' + e.message); }   // 带着改好的字另存（filmed.js 再比一遍，和原稿一样的不另存）
          rel[2] = j.名;
        } else await keepCopy(j.项目, rel);
        await writeFile(vpPath(j), out);
        if (j.rel) await archive(j.项目, j.rel);   // 照审片批注另存的：这一版提示词上没写批注就没有（审片批注留在样片旁边）
        await resha(j.项目, rel, undefined, add.length ? add : undefined);
        const secs = await putSecs(j.项目, rel, text), altSay = await Styles.fixApply(j, alt.got.另一种, out);
        return { 结果: (was ? '「' + was + '」出过片，原稿没动；改好的另存成「' + j.名 + '」，' : '提示词按批注改好了，') + '改了 ' + ops.length + ' 处' + (add.length ? '，新挂了 ' + add.map(r => r.ref + '（' + (r.name || stemOf(r.path)) + '）').join('、') : '') + secsSay(secs) + altSay, 产出: [rel.join('/')] };
      },
    },
  });
  /* AI 回的改动清单（一段 JSON 列表，一处一项）：读不了就是格式不对；缺原文、改成的项不要 */
  const opsOf = t => {
    const a = t.indexOf('['), z = t.lastIndexOf(']');
    let ops;
    try { ops = JSON.parse(t.slice(a, z + 1)); } catch (e) { throw fail('AI 没按要的格式回（要一段 JSON 列表）'); }
    return (Array.isArray(ops) ? ops : []).filter(o => o && typeof o.原文 === 'string' && o.原文.trim() && typeof o.改成 === 'string');
  };
  /* 两份稿的字一样不一样：开头的 BOM、换行的写法、行尾的空格、头尾的空行不算 */
  const plainText = t => unbom(String(t)).split(/\r\n|\n|\r/).map(l => l.trimEnd()).join('\n').trim();
  const sameText = (a, b) => plainText(a) === plainText(b);
  /* ---------- 分镜两种写法（11-20 他定；11-21 分区为主、合并备选）：另写一种，写提示词、按批注改提示词、交给 AI 写完里的几处钩子。都在 shot-styles.js ---------- */
  const Styles = require('./shot-styles.js')({ fsp, str, fail, segDir, unbom, today, TAIL, PromptDraft, exists, vpNeed, vpPath, vpLabel, withFileLocks, sideOf, keepCopy, writeFile, isPeText });
  Object.assign(KINDS, Styles.KINDS);
  /* ---------- 出过片的提示词（11-22 他定：「已经出片的提示词不能改，只能新增提示词」）：认法、另存都在 filmed.js ---------- */
  async function filmedOf(j) { return filmed && nameOk(str(j.名)) && RE_VP.test(j.名) ? filmed.state(j.项目, j.段, j.名) : null; }
  async function noFilmed(j) { const f = await filmedOf(j); if (f && f.出过片) throw fail(filmed.say(f)); }   // 交给 AI 写完：出过片的不写
  /* 照审片批注另存（11-23 他定：「另存成改N」不许原样照抄，交给 AI 照审片批注改出新的一版）。都在 review-fork.js；怎么改、怎么落盘借「按批注改提示词」（要在下面 PF.wrap 以前登记） */
  Object.assign(KINDS, require('./review-fork.js')({ fsp, pj, str, fail, exists, unbom, today, nameOk, RE_VP, vpPath, filmed, edit: KINDS.按批注改提示词 }).KINDS);
  /* ---------- 交给 AI 写完（11-21 他定：没有「AI 铺底」，人写好事件脚本，剩下的 AI 一次写完；以前的直接铺底、整理分镜并进来了）。都在 pe-finish.js ---------- */
  Object.assign(KINDS, require('./pe-finish.js')({ fsp, pj, str, fail, segDir, exists, unbom, oneLine, today, TAIL, PromptDraft, Secs, Voice, BmKey, isNarr,
    readFlow, sceneOf, scriptPath, srcPath, isPF: PF.isPF, finalOk, isPeText, vpNeed, vpPath, vpLabel, regOf, vidsOf, framesOf, frameImgs, framePart, bmPart,
    geoPart, saveGeo, lookPart, lessonsOf, pePart, PE_FORMAT, PE_DRAMA, sceneImgs, txtsOf, TxtWord, voiceAssets, voiceRule, settingText, sceneText, docText, shotsOf,
    refsIn, withFileLocks, sideOf, keepCopy, writeFile, resha, putSecs, secsSay, Styles, noFilmed }).KINDS);
  /* 11-16 加的「对剧本」（审片、定稿后项目自己调 Codex 拿片子对剧本、写剧本批注）11-22 删了：他定以后都先写提示词，不再对剧本 */
  /* ---------- 与AI沟通剧本（11-17 他定）：剧本页「与AI继续沟通」，先和人商量，他说「定稿」才写回来。都在 script-talk.js ---------- */
  Object.assign(KINDS, require('./script-talk.js')({ fsp, pj, str, fail, exists, unbom, nameOk, docText, writeDoc, archive, body, today, mmdd }).KINDS);
  PF.wrap(KINDS);   // 先写提示词的段（11-21）：各样事的任务书开头说一句「剧本」指的是自由稿

  /* ---------- 任务：排队、一个一个做 ---------- */
  const jobs = [], byId = new Map();
  let seq = 0;
  const lockOf = j => j.项目 + '｜' + j.事 + '｜' + (KINDS[j.事].key ? KINDS[j.事].key(j) : j.段 || '');
  const live = j => j.状态 === '排队' || j.状态 === '在做';
  const usesCodex = j => j.渠道 === 'codex' || (!!KINDS[j.事].codex && j.渠道 !== SELF);   // 给我提示词的：人贴进自己的 Codex，不经 codex-chat
  /* 这会儿只是在等人、等看得见的 AI 回话（给我提示词、Claude 桌面版），不占那三个位子、不占 Codex。DeepSeek 的窗口是真在算，照旧占位子（免得一下弹十个窗口） */
  const idle = x => (!!x.交给 && !!x.交给.等 && x.交给.方式 !== 'deepseek') || !!x.等Claude || !!x.等即梦;   // 等即梦：流水线自己出片、在等即梦出完（11-21）
  const fileOf = j => KINDS[j.事].file ? j.项目 + '｜' + KINDS[j.事].file(j) : '';
  /* 旧：服务重开前了结的，照存下的那份给（job-store.js） */
  const pub = j => j.旧 || ({ id: j.id, 事: j.事, 渠道: j.渠道, 渠道名: chLabel(j), 深度: depthOf(j), 模型: modelOf(j), 项目: j.项目, 段: j.段 || '', 标题: j.标题, 状态: j.状态, 步骤: j.步骤, 建: j.建, 开始: j.开始, 结束: j.结束, 错误: j.错误, 结果: j.结果, 产出: j.产出,
    记录: j.dir ? path.relative(ROOT, j.dir).split(path.sep).join('/') : '', 人物: j.人物, 道具: j.道具, 批注: j.批注, 类别: j.类别, 名: j.名, 状态名: j.状态名, 视频: j.视频, 文件名: j.文件名, 只名: j.只名, 只: (j.只 || []).map(x => x.类别 + '/' + (x.图 ? stemOf(x.图) : x.状态名 ? x.名称 + '_' + x.状态名 : x.名称)), 只提示词: (j.只 || []).map(x => x.提示词 || ''), 本机: !!KINDS[j.事].local,
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
      Object.assign(j, { 状态: '做完', 结果: j.摘不到 ? (r.结果 || '') + j.摘不到 : r.结果, 产出: r.产出 || [] });   // sd25-pe 地图对不上的，结果里报一句（pePart）
      log('AI 任务做完：' + j.标题 + '（' + chLabel(j) + '，' + Math.round((Date.now() - j.开始) / 1000) + ' 秒）');
    } catch (e) {
      if (e.别处 && !j.停) Object.assign(j, { 状态: '做完', 结果: '不用做了：' + e.别处, 产出: [] });   // 要做的事在别处做完了（11-17，done-elsewhere.js）：不算没成
      else { j.状态 = j.停 ? '停了' : '没成'; j.错误 = j.停 ? '你点了停' : (e.plain ? e.message : '出错了：' + e.message); }
      log('AI 任务' + j.状态 + '：' + j.标题 + '　' + (j.错误 || j.结果));
    } finally { j.结束 = Date.now(); j.步骤 = ''; j.child = null; j.等Claude = false; j.等即梦 = false; if (j.dir && (j.交给 || j.续 || j.本机交)) selfDone(j); pump(); }   // 本机交：流水线自己出片的（重开后接着做靠 自己交.json）
  }
  /* resume：服务重开后接着等回复的（resumeSelf 给的，网页上来的请求没有这一样） */
  async function create(b, resume) {
    const K = KINDS[str(b.事)];
    if (!K) throw fail('不认识这件事：' + b.事);
    /* 11-15 他定：流水线不再直接调 AI，用 AI 的地方一律「给我提示词」——人复制，贴进自己开的对话（页面传别的也照这个；假通道只在试验服务上有） */
    b.渠道 = CHANNELS.mock && b.渠道 === 'mock' ? 'mock' : SELF;
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
    if (resume) Object.assign(j, { id: resume.id, dir: resume.dir, 建: resume.建 || j.建, 开始0: resume.开始 || 0, 开0: resume.开 || 0, 续: true, ...(resume.接着 ? { 接着: resume.接着 } : {}) });   // 接着：不止一步的事交出去时记下的（出图当初有没有图）
    if ((K.need || []).includes('段') && !segOk(j.段)) throw fail('要说清是第几段');
    for (const k of ['人物', '道具']) if (Array.isArray(b[k])) j[k] = b[k].map(str).filter(Boolean);
    if (b.批注) j.批注 = str(b.批注);
    for (const k of ['类别', '名', '状态名', '要求', '视频', '批准', '重写', '白模', '跳过核验']) if (b[k] != null) j[k] = str(b[k]);
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
    Store.trim();   // 最多留 200 件：丢最早了结的，在做的不丢
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
      if (j.交给 && j.交给.方式 === 'deepseek' && j.dir) HAND.dsStop(j.dir);   // DeepSeek 的窗口连它跑的一起关掉
      if (j.醒) j.醒();   // 在等回复的：叫醒它，马上停
    }
  }

  /* ---------- 交给 AI（11-14 他定：用 AI 的地方都有两种——给我提示词、项目直接调；直接调一律看得见）----------
     三种交法，等回复是同一套：
       self      给我提示词：不调 AI，人把「交给 AI 的话」贴进自己开的对话（Codex、Claude、DeepSeek 都行；出图、改图要贴进 Codex。11-21 起出片由流水线自己做）
       claude    在 Claude 桌面版新开一个对话，话填好，人按一下发送（Claude 的规矩：外面带进来的话要人按，这边不替人按）
       deepseek  开一个窗口跑 DeepSeek Harness（只读），窗口把它的回答写进回复文件、告诉这边
     AI 做完把回复写进这一回文件夹里的 回复.md：这边两秒看一眼，文件停住三秒不动就接着落盘；
     AI 能跑命令的，再跑一句 node server.js reply <任务号> 告诉这边，不用等那三秒；
     AI 写不了文件，人把它的回复贴回页面也行（POST /api/job/<号>?reply）。回复格式不对就接着等它改好（DeepSeek 的窗口做完就关了，格式不对算没成）。
     一个任务里交几回的（核图这类）：每回带个名，文件叫 回复_<名>.md、交给AI的话_<名>.txt。
     服务重开过：三天内没了结的，开起来接着等（文件夹里的 自己交.json 记着当初的请求；出图这类不止一步的接不上，要重点一次） */
  const SERVER_JS = path.join(__dirname, 'server.js').replace(/\\/g, '/');
  const Gone = require('./done-elsewhere.js')({ fsp, pj, vpPath });   // 等回复时看要做的事是不是在别处做完了（11-17）
  const PORT = Number(process.env.ANTOU_PORT) || 8766;   // 和 server.js 一样算：DeepSeek 的窗口做完照它告诉这边
  const tellLines = j => ['写完跑下面这一句，告诉项目做完了（跑不了也没关系，项目自己会看到这个文件）：', 'node "' + SERVER_JS + '" reply ' + j.id];
  /* 对话名（11-18 他嫌 Codex 侧栏的对话名太长：默认取第一句话前 60 个字）：话的头一行写短名，叫 Codex 先用自带的 set_thread_title 改成它（实测不用给对话号）。
     短名＝项目简称 · 任务标题（和后台任务抽屉里一样），一个任务交几回的带上 tag。项目简称：「--」前面那截，四个字以内照写，再长取前三个字（李云龙、药膳鸡） */
  const shortProject = name => { const a = [...str(name).split('--')[0]]; return (a.length > 4 ? a.slice(0, 3) : a).join(''); };
  const chatName = (j, tag) => [shortProject(j.项目), j.标题, tag].filter(Boolean).join(' · ');
  const nameLine = (j, tag) => '【' + chatName(j, tag) + '】先给这个对话改名，改成【】里的字：调 mcp__codex_app__set_thread_title，参数只填 title（不在 Codex 里就跳过这一步）。';
  const seeLines = imgs => imgs.length ? ['动笔前先把这几张图各看一遍：', ...imgs] : [];
  function selfMsg(j, files, imgs) {   // 给我提示词、Claude 桌面版：读任务书、写回复文件、跑一句告诉项目
    if (KINDS[j.事].selfMsg) return KINDS[j.事].selfMsg(j, files, tellLines(j));   // 要先和人商量的（与AI沟通剧本）：这段话它自己说
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
  function codexMsg(j, files) {   // 给我提示词时要用 Codex 做的事（出图、改图；11-21 以前的出片）：照原来交给 Codex 的话，再写清做完写回复、告诉项目
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
      const said = files.codex ? codexMsg(j, files) : how === 'deepseek' ? dsMsg(j, files, imgs) : selfMsg(j, files, imgs);
      const text = how === 'deepseek' ? said : nameLine(j, files.tag) + '\n' + said;   // DeepSeek 的窗口标题本来就是任务标题，不用改名
      const 开 = j.续 ? (j.开0 || j.开始 || Date.now()) : Date.now();
      Object.assign(j, { 交代: text, 读过: '', 格式错: '', 格式错时: 0 });
      j.交给 = { 方式: how, 等: how === 'self' ? '你' : how === 'claude' ? '发送' : '做', 回复: files.reply, 开, 要Codex: !!files.codex };   // 先占上（同步）：别的任务看得到这一个在等发送
      if (j.续 && how === 'claude' && HAND.claudeStarted(j.id, 开)) j.交给.等 = '做';
      j.步骤 = sayOf(j);
      await writeFile(msgFile, text + '\n');
      await writeFile(path.join(j.dir, '自己交.json'), JSON.stringify({ id: j.id, 项目: j.项目, 建: j.建, 开始: j.开始, 请求: j.请求, 渠道: j.渠道, 方式: how, 开, 回复: files.reply, run: !!KINDS[j.事].run, ...(j.接着 ? { 接着: j.接着 } : {}) }, null, 1) + '\n');
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
      } else {
        j.催 = false; if (!now) j.步骤 = say();
        const why = await Gone.check(j);   // 没有新回复：要做的事在别处做完了，就不等了
        if (why) throw Object.assign(fail(why), { 别处: why });
      }
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
    for (let i = 0; i < 480 && live(j) && !(j.格式错时 > t0) && j.交给.回复 === file; i++) await sleep(250);   // 换到下一回交给 AI 了（核图这类不止交一回的）：先回话
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
          if (m.结束 || !m.id || byId.has(m.id) || !m.请求) continue;
          const K = KINDS[str(m.请求.事)], can = !!K && (typeof K.接得上 === 'function' ? K.接得上(m) : !!K.接得上);
          if (m.run && !(can && await Store.wasLive(p, str(m.id)))) continue;   // 不止一步的事：标了接得上（11-18：出片、改图，记着有没有图的出图）、任务清单里记着重开那会儿还在等的才接，别的要重点一次
          const chId = str(m.渠道) || SELF, ch = CHANNELS[chId];   // 11-14 头一版的 自己交.json 没写渠道：都是给我提示词
          if (!ch || (ch.hand || '') !== (str(m.方式) || 'self')) continue;   // 这台电脑上那种交法没了（比如卸了 Claude 桌面版）：不接
          const j = await create({ ...m.请求, 项目: p, 渠道: chId }, { id: str(m.id), dir, 建: m.建, 开始: m.开始, 开: m.开, 接着: m.接着 });
          log('服务重开前没等到回复的，接着等：' + j.标题);
        } catch (e) { log('交给 AI 等回复的没接上：' + d + '　' + (e.message || e)); }
      }
    }
  }
  /* 任务存盘（11-18 他说：后台任务不能刷新就丢）：先接回在等回复的，再把清单里别的摆回去，然后开始存。都在 job-store.js */
  const Store = require('./job-store.js')({ fsp, path, ROOT, HOME, pj, writeFile, log, pub, live, jobs, byId });
  setTimeout(() => resumeSelf().catch(e => log('接着等回复时出错：' + e.message)).then(() => Store.start()), 300);

  /* ---------- 即梦授权：看登没登录、是哪个号；要登录就拿一个授权链接，用户自己在浏览器里点同意 ---------- */
  const JM = process.env.ANTOU_JIMENG || path.join(os.homedir(), 'bin', 'dreamina-canvas.exe');
  // 即梦命令行一律直连：服务从 Git Bash 起会带上 18778 代理，11-21 实测走代理一条 3.4 秒、直连 1.8 秒（传图也是直连稳）
  const jmRun = (cmd, args, opt = {}) => run(cmd, args, { ...opt, env: { ...Object.fromEntries(Object.keys(process.env).filter(k => /^(https?|all)_proxy$/i.test(k)).map(k => [k, undefined])), ...opt.env } });
  async function jm(args, timeout) {
    if (!fs.existsSync(JM)) return { ok: false, error: '这台电脑上没找到即梦命令行（' + JM + '）' };
    try {
      const r = await jmRun(JM, ['--non-interactive', ...args], { timeout: timeout || 40e3 });
      let data = null;
      try { data = JSON.parse(r.out); } catch (e) { /* 不是 JSON 就原样给 */ }
      return { ok: r.code === 0, code: r.code, data, raw: (r.out || r.err).trim().slice(0, 4000) };
    } catch (e) { return { ok: false, error: '即梦命令行调不起来：' + e.message }; }
  }
  const jmCheck = require('./jm-check.js')({ jm, fail, str });   // 出片前核对即梦账号和画布（三条命令一起查，10 分钟内同号同画布不重查；11-16 挪出去）
  const canvas = require('./canvas.js')({ HOME, JM, run: jmRun, log, AP });   // 资产页看画布上的图（只读画布，11-14 加）；它只跑即梦命令行，一样直连
  const JV = require('./jm-video.js')({ JM, run: jmRun, HOME, log, canvas, withFileLocks });   // 流水线自己出片（11-21）：传素材、建节点、报价、提交、等出完、下载
  /* 出片计划：出片任务书写在它那一回的任务文件夹（出片计划.json），照任务书的 SHA-256 认是哪一回排的（新的在前，最多看 60 个） */
  async function planOf(name, seg, bookSha) {
    const base = pj(name, '历史记录', 'AI任务'), tail = '_出片任务书_第' + seg + '段';
    const ds = (await fsp.readdir(base).catch(() => [])).filter(d => /^\d{8}-\d{6}_/.test(d) && d.endsWith(tail)).sort().reverse().slice(0, 60);
    for (const d of ds) {
      try { const p = JSON.parse(unbom(await fsp.readFile(path.join(base, d, '出片计划.json'), 'utf8'))); if (p && p.任务书SHA === bookSha) return p; } catch (e) { /* 这一回没写出片计划（11-21 以前排的） */ }
    }
    return null;
  }
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
        if (q.has('channels')) return json(res, { channels: Object.entries(CHANNELS).filter(([id]) => id === SELF || id === 'mock').map(([id, c]) => {   // 11-15 起只剩给我提示词（试验服务多一个假通道）
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
        if (!j) throw httpErr(404, '没有这个任务（每个项目只留最近 60 件）');
        if (req.method === 'POST' && q.has('cancel')) cancel(j);
        if (req.method === 'POST' && q.has('reply')) return json(res, await takeReply(j, (await readBody(req, 4e6)).toString('utf8')));   // 交给 AI 的：回复到了
        if (req.method === 'GET' && q.has('msg')) {   // 交给 AI 的话：页面弹出来给人复制（给我提示词），Claude 没开出来时也能看、能复制
          if (!j.交给 || !j.交代) throw httpErr(409, '要交代的话还没备好，等一两秒');
          return json(res, { 话: j.交代, 方式: j.交给.方式, 等: j.交给.等, 标题: j.标题, 要Codex: !!j.交给.要Codex, 回复: j.交给.回复, 说: KINDS[j.事].handSay || '' });   // 说：弹窗上那一句，这件事另有说法的（与AI沟通剧本）
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
  const liveJobs = () => jobs.filter(live).map(j => ({ 事: j.事, 项目: j.项目, 段: j.段 || '', 名: str(j.名) }));   // 在做、排着的（filmed.js 看哪一版正在出片）
  return { handle, KINDS, liveJobs };
};
