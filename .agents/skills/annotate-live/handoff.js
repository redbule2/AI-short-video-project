'use strict';
/* ============================================================
   看得见地交给本机的 AI（2026-11-14 他定）
   项目直接调 AI 一律看得见：
     Claude    在 Claude 桌面版新开一个 Code 对话（claude://code/new，任务和文件夹填好）。
               Claude 规定外面带进来的话要人按一下发送，这边不替人按。
               人按了发送以后，这边从 Claude 的会话记录（~/.claude/projects）认出它开工了。
     DeepSeek  装了 DeepSeek Harness：开一个窗口跑它的命令行（只读），边想边写都在窗口里；对话存在 DeepSeek Harness 里。
               没装：照旧走 deepseek.py 接口（他说没装就不要求看得见）。
     Codex     本来就是看得见的对话（codex-chat），不经这里。
   AI 做完把回复写进这一回文件夹里的 回复.md、跑一句 node server.js reply <任务号>，和「给我提示词」是同一套（jobs.js 的 waitReply）。
   这里只管「装没装、怎么开、开工了没有」，不碰任务本身。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

/* 注册表里某个链接（claude://、dsh://）是哪个程序在接：拿 (默认) 那一行里第一个带引号的路径 */
function protocolExe(scheme) {
  for (const key of ['HKCU\\Software\\Classes\\' + scheme + '\\shell\\open\\command', 'HKCR\\' + scheme + '\\shell\\open\\command']) {
    try {
      const r = spawnSync('reg', ['query', key, '/ve'], { windowsHide: true, encoding: 'utf8', timeout: 8000 });
      if (r.status !== 0) continue;
      const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/m.exec(r.stdout || '');
      if (!m) continue;
      const v = m[1].trim(), q = /^"([^"]+)"/.exec(v), exe = q ? q[1] : v.split(/\s+/)[0];
      if (exe && fs.existsSync(exe)) return exe;
    } catch (e) { /* 查不了就当没装 */ }
  }
  return '';
}

/* 用 PowerShell 的 Start-Process 开一个链接或程序：网址、路径都经环境变量传，不经命令行拼，免得引号、& 、% 出岔子 */
function startProcess(command, env) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (e) { reject(e); return; }
    const err = [];
    child.stderr.on('data', c => err.push(c));
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(Buffer.concat(err).toString('utf8').trim().slice(0, 300) || 'PowerShell 退出码 ' + code)));
  });
}

module.exports = function makeHandoff({ log = () => {} } = {}) {
  /* ---------- Claude 桌面版 ---------- */
  const claudeExe = process.platform === 'win32' && process.env.ANTOU_CLAUDE_DESKTOP !== '0' ? protocolExe('claude') : '';
  const CLAUDE_PROJECTS = process.env.ANTOU_CLAUDE_PROJECTS || path.join(os.homedir(), '.claude', 'projects');   // ANTOU_CLAUDE_PROJECTS、ANTOU_CLAUDE_LINK_LOG：试验服务上用，不真开 Claude
  /* 开一个新对话：任务填好、文件夹选好。窗口会跳到这个新对话 */
  async function openClaude(text, folder) {
    const url = 'claude://code/new?q=' + encodeURIComponent(text) + '&folder=' + encodeURIComponent(folder);
    if (process.env.ANTOU_CLAUDE_LINK_LOG) { fs.appendFileSync(process.env.ANTOU_CLAUDE_LINK_LOG, url + '\n'); return; }
    await startProcess('Start-Process -FilePath $env:ANTOU_URL', { ANTOU_URL: url });
  }
  /* 人按了发送没有：发出去的话里带着任务号（reply <任务号>），Claude 的会话记录里出现了这一句就是开工了。
     新建了会话记录的文件夹，修改时间会跟着变，所以只翻 since 以后动过的文件夹 */
  function claudeStarted(id, since) {
    const want = Buffer.from('reply ' + id);
    let dirs;
    try { dirs = fs.readdirSync(CLAUDE_PROJECTS); } catch (e) { return null; }
    for (const d of dirs) {
      const dp = path.join(CLAUDE_PROJECTS, d);
      let st;
      try { st = fs.statSync(dp); } catch (e) { continue; }
      if (!st.isDirectory() || st.mtimeMs < since - 5000) continue;
      let files;
      try { files = fs.readdirSync(dp); } catch (e) { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const fp = path.join(dp, f);
        try {
          const s2 = fs.statSync(fp);
          if (s2.mtimeMs < since - 5000 || s2.birthtimeMs < since - 5000) continue;   // 老对话里提到这个号的不算：要这一回开了链接以后新建的
          const fd = fs.openSync(fp, 'r'), buf = Buffer.alloc(Math.min(s2.size, 512 * 1024));
          fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
          if (buf.indexOf(want) >= 0) return { file: fp, session: f.slice(0, -6) };
        } catch (e) { /* 正写着、读不了：下回再看 */ }
      }
    }
    return null;
  }

  /* ---------- DeepSeek Harness ---------- */
  const dshExe = process.platform === 'win32' && process.env.ANTOU_DSH !== '0' ? (process.env.ANTOU_DSH_EXE || protocolExe('dsh')) : '';
  const dshCli = dshExe ? path.join(path.dirname(dshExe), 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js') : '';
  const dshOk = !!dshExe && fs.existsSync(path.join(path.dirname(dshExe), 'resources', 'app.asar'));
  const WINDOW_JS = path.join(__dirname, 'ds-window.js');
  /* DeepSeek 的 key：和 deepseek.py 同一处（环境变量 DEEPSEEK_API_KEY，或 DEEPSEEK_KEY_FILE，或 E:/ai-bridge/deepseek.key）。
     Harness 的命令行没登账号，要这个 key；它自己存过 key 的，读不到也照样能跑 */
  function dsKey() {
    if ((process.env.DEEPSEEK_API_KEY || '').trim()) return process.env.DEEPSEEK_API_KEY.trim();
    const f = process.env.DEEPSEEK_KEY_FILE || 'E:/ai-bridge/deepseek.key';
    try { const k = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').trim().replace(/^["']|["']$/g, '').trim(); return /^[\x21-\x7e]+$/.test(k) ? k : ''; } catch (e) { return ''; }
  }
  /* 开窗口：ds-window.js 读 dir 里的 窗口.json（要交代的话、回复写到哪、任务号），跑完把回复写进 回复.md、告诉服务 */
  async function openDeepSeek({ dir, cwd, title, msgFile, replyFile, id, port }) {
    const cfg = { exe: dshExe, cli: dshCli, cwd, 标题: title, 话: msgFile, 回复: replyFile, id, port, 开: Date.now() };
    fs.writeFileSync(path.join(dir, '窗口.json'), JSON.stringify(cfg, null, 1) + '\n');
    try { fs.unlinkSync(path.join(dir, '窗口状态.json')); } catch (e) { /* 头一回开 */ }
    const key = dsKey();
    await startProcess('Start-Process -FilePath $env:ANTOU_DSW_NODE -ArgumentList (\'"\' + $env:ANTOU_DSW_JS + \'"\') -WorkingDirectory $env:ANTOU_DSW_CWD',
      { ANTOU_DSW_NODE: process.execPath, ANTOU_DSW_JS: WINDOW_JS, ANTOU_DSW_CWD: cwd, ANTOU_DSW_DIR: dir, ...(key ? { DEEPSEEK_API_KEY: key } : {}) });
  }
  /* 窗口现在什么样：{ 状态: 在做|做完|出错, 错误, pid, 会话 }；窗口被关掉（进程没了、又没写完）当出错 */
  function dsState(dir) {
    let s = null;
    try { s = JSON.parse(fs.readFileSync(path.join(dir, '窗口状态.json'), 'utf8')); } catch (e) { return null; }
    if (s && s.状态 === '在做' && s.pid) {
      try { process.kill(s.pid, 0); } catch (e) { return { ...s, 状态: '出错', 错误: 'DeepSeek 的窗口关掉了，没做完' }; }
    }
    return s;
  }
  function dsStop(dir) {   // 页面点了停：把窗口连同它跑的 DeepSeek 一起关掉
    const s = dsState(dir);
    if (s && s.pid && s.状态 === '在做') spawn('taskkill', ['/PID', String(s.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }

  log('看得见的 AI：Claude 桌面版' + (claudeExe ? '有' : '没装（Claude 照旧后台写）') + '，DeepSeek Harness' + (dshOk ? '有' : '没装（DeepSeek 照旧走接口）'));
  return { claudeDesktop: !!claudeExe, openClaude, claudeStarted, dsHarness: dshOk, openDeepSeek, dsState, dsStop };
};
