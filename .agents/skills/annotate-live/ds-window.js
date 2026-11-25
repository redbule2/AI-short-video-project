'use strict';
/* ============================================================
   DeepSeek Harness 的窗口（2026-11-14 他定：项目直接调 AI 一律看得见）
   jobs.js 用 Start-Process 开一个控制台窗口跑这个脚本：
     读这一回文件夹里的 窗口.json（要交代的话在哪、回复写到哪、任务号、服务端口）
     → 跑 DeepSeek Harness 的命令行（headless，只读：只能读文件、不能改），一路把它想什么、读什么、写什么打在窗口里
     → 做完把它的回答写进 回复.md，告诉服务（POST /api/job/<号>?reply），服务接着落盘。
   对话存在 DeepSeek Harness 里（~/.dsh/sessions，按项目文件夹分），之后在它的桌面版里也能翻到、接着聊。
   窗口状态写在 窗口状态.json：{ 状态: 在做|做完|出错, 错误, pid, 会话 }，服务看它知道做没做完。
   ============================================================ */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const DIR = process.env.ANTOU_DSW_DIR || '';
const C = { dim: '\x1b[90m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', off: '\x1b[0m' };
const say = (s = '') => process.stdout.write(s + '\n');
let stateNow = {};
function state(s) {
  stateNow = { ...stateNow, ...s, pid: process.pid, 时间: Date.now() };
  try { fs.writeFileSync(path.join(DIR, '窗口状态.json'), JSON.stringify(stateNow, null, 1) + '\n'); } catch (e) { /* 写不了：服务那边等窗口关了也会知道 */ }
}
function holdOpen(code) {   // 做完不马上关：让人看得到结果。按回车关，十分钟后自己关
  say('');
  say(C.dim + '按回车关这个窗口（十分钟后自己关）。' + C.off);
  const t = setTimeout(() => process.exit(code), 10 * 60e3);
  process.stdin.resume();
  process.stdin.once('data', () => { clearTimeout(t); process.exit(code); });
}
function fail(msg) {
  state({ 状态: '出错', 错误: msg });
  say('');
  say(C.red + '没做成：' + msg + C.off);
  holdOpen(1);
}
function post(port, id) {   // 告诉服务做完了（服务自己也会看到 回复.md，告诉它只是快一点）
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/job/' + id + '?reply', method: 'POST', timeout: 130e3,
      headers: { 'X-Antou': '1', Host: '127.0.0.1:' + port, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': 0 } }, res => {
      const out = [];
      res.on('data', c => out.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}
const short = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
const TOOL = { read: '读', glob: '找文件', grep: '搜', ls: '看文件夹', list: '看文件夹', web_fetch: '上网看', web_search: '上网搜' };
function toolLine(ev) {
  const inp = ev.input || {}, what = inp.file_path || inp.path || inp.pattern || inp.url || inp.query || inp.command || '';
  return C.cyan + '→ ' + (TOOL[ev.tool] || ev.tool || '用工具') + (what ? '：' + short(what, 140) : '') + C.off;
}

async function main() {
  if (!DIR) { say('没有告诉我是哪一回任务（ANTOU_DSW_DIR）'); holdOpen(2); return; }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(DIR, '窗口.json'), 'utf8')); } catch (e) { fail('读不了 窗口.json：' + e.message); return; }
  process.title = 'DeepSeek · ' + (cfg.标题 || '流水线的任务');
  state({ 状态: '在做', 错误: '' });
  let msg;
  try { const raw = fs.readFileSync(cfg.话, 'utf8'); msg = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw; } catch (e) { fail('读不了要交代的话：' + e.message); return; }
  say(C.bold + '流水线交给 DeepSeek Harness：' + (cfg.标题 || '') + C.off);
  say(C.dim + '只读：它只能读项目里的文件，回答由这个窗口写进 ' + cfg.回复 + '，再告诉流水线。' + C.off);
  say(C.dim + '交代给它的话：' + C.off);
  say(msg.trim());
  say(C.dim + '─'.repeat(40) + C.off);

  let patch = '';
  try { patch = namePatch(cfg.标题); } catch (e) { /* 起名的补丁写不了：照它自己起的名 */ }
  let r = await runOnce(cfg, msg, patch);
  if (r.error) { fail('DeepSeek Harness 起不来：' + r.error); return; }
  if (!r.sid && patch) {   // 新版认不得这份补丁、没开起会话：不带它再跑一回
    say(C.dim + '（对话名没用上，照 DeepSeek 自己起的名，再开一回）' + C.off);
    r = await runOnce(cfg, msg, '');
    if (r.error) { fail('DeepSeek Harness 起不来：' + r.error); return; }
  }
  const { final, errs, code } = r;
  const ok = final && final.reason && final.reason.kind === 'completed' && String(final.text || '').trim();
  if (!ok) {
    const why = (final && final.reason && final.reason.error && final.reason.error.message) || errs.slice(-3).join('；') || '退出码 ' + code;
    fail(/MISSING_CREDENTIAL|no API key/i.test(why) ? 'DeepSeek Harness 的命令行没有 API key：在它的设置「模型」页填 key，或者照 deepseek 技能那样放好 key 文件' : short(why, 400));
    return;
  }
  try {
    const cur = fs.existsSync(cfg.回复) ? fs.readFileSync(cfg.回复, 'utf8').trim() : '';
    if (!cur) fs.writeFileSync(cfg.回复, String(final.text).trim() + '\n');
  } catch (e) { fail('回复写不进 ' + cfg.回复 + '：' + e.message); return; }
  state({ 状态: '做完' });
  say('');
  say(C.green + '做完了，回复写进了 ' + cfg.回复 + C.off);
  const back = await post(cfg.port, cfg.id);
  if (back && back.格式错) say(C.yellow + '流水线说回复的格式不对：' + back.格式错 + C.off);
  else if (back && back.状态 === '做完') say(C.green + '流水线接上了：' + (back.结果 || '') + C.off);
  else if (back && (back.状态 === '没成' || back.状态 === '停了')) say(C.red + '流水线那边没成：' + (back.错误 || back.状态) + C.off);
  else say(C.dim + '流水线自己会看到这个回复文件。' + C.off);
  holdOpen(0);
}

/* 对话名（11-24）：DeepSeek Harness 默认让模型照第一句话另起一个名，起出来没有「 · 」。这一回不让它起，名字就用话的头几个词——
   流水线把对话名写在话的头一行。补丁只管这一回（--patch），不动它自己的设置 */
function namePatch(name, dir = DIR) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean).length;
  if (!words) return '';
  const bytes = Math.max(80, Buffer.byteLength(String(name), 'utf8') + 8);
  const file = path.join(dir, '对话名.yml');
  fs.writeFileSync(file, ['- id: session-title', '  config:', '    fallbackMaxWords: ' + words, '    fallbackMaxBytes: ' + bytes, '    maxTitleBytes: ' + bytes,
    '- id: session-title-llm', '  disabled: true', ''].join('\n'));
  return file;
}

/* 跑一回 DeepSeek Harness 的命令行，一路打在窗口里。回 { final, sid, errs, code }；起不来回 { error } */
function runOnce(cfg, msg, patch) {
  return new Promise(resolve => {
    const args = ['--expose-internals', cfg.cli, '--profile', 'headless', ...(patch ? ['--patch', patch] : []), '--json', '--permission-mode', 'read-only', '--approval-policy', 'never', '-'];
    let child;
    try { child = spawn(cfg.exe, args, { cwd: cfg.cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }); }
    catch (e) { resolve({ error: e.message }); return; }
    running = child;
    child.stdin.on('error', () => {});
    child.stdin.end(msg);
    let buf = '', final = null, sid = '', lastThink = false, done = false;
    const errs = [];
    child.stdout.on('data', c => {
      buf += c.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { say(line); continue; }
        if (ev.type === 'session') { sid = ev.sessionId || ''; state({ 会话: sid }); say(C.dim + 'DeepSeek Harness 会话：' + sid + C.off); }
        else if (ev.type === 'thinking') { if (ev.text && ev.text.trim()) { say(C.dim + '（想）' + short(ev.text, 400) + C.off); lastThink = true; } }
        else if (ev.type === 'tool_call') say(toolLine(ev));
        else if (ev.type === 'tool_result') { if (ev.status && ev.status !== 'completed') say(C.yellow + '  （没成：' + short(ev.result, 160) + '）' + C.off); }
        else if (ev.type === 'text') { if (ev.text) { if (lastThink) say(''); say(ev.text); lastThink = false; } }
        else if (ev.type === 'status' && ev.phase === 'step_end' && ev.usage) say(C.dim + '（这一步 ' + (ev.usage.totalTokens || 0) + ' 个字元）' + C.off);
        else if (ev.type === 'final') final = ev;
      }
    });
    child.stderr.on('data', c => { for (const l of c.toString('utf8').split(/\r?\n/)) if (l.trim() && !/crashpad|registration_protocol_win/.test(l)) { errs.push(l.trim()); if (errs.length > 20) errs.shift(); } });
    child.on('error', e => { if (!done) { done = true; resolve({ error: e.message }); } });
    child.on('close', code => { if (!done) { done = true; running = null; resolve({ final, sid, errs, code }); } });
  });
}
let running = null;
if (require.main === module) {
  process.on('SIGINT', () => { try { if (running) running.kill(); } catch (e) { /* 已经停了 */ } fail('在窗口里按了停'); });
  main().catch(e => fail(e.message));
} else module.exports = { namePatch };   // 测试用：只拿起名的补丁

