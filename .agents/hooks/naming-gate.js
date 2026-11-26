#!/usr/bin/env node
/* 命名门卫（2026-11-26 他定）：Claude、Codex 往 E:\AI短视频项目 里写文件时，照 通用工具\公用\命名规则.js 查名字和位置。
   现在是「提醒」：写完提醒 AI 改（PostToolUse），每轮结束再扫一遍这一轮新出的（Stop）。他看几天没冤枉人，把 MODE 改成「拦」：写之前就退回（PreToolUse）。
   改 MODE 不用重装：两边登记的命令一字不变（Codex 认登记的那几行，变了要他重新点信任）。
   11-09 那两个 Stop 检查（top-level-check.js、transitional-file-check.js）并进来了：一级目录多出来的空文件夹照旧直接删，有东西的提醒。
   事件：UserPromptSubmit 记下这一轮几点开始（Stop 只看这之后新出的）；PreToolUse、PostToolUse 查要写的文件（Claude 的 Write、Edit、MultiEdit、NotebookEdit，Codex 的 apply_patch）；
         跑脚本、Blender、出图这些间接写的，事先看不出，Stop 扫一遍补上。出了什么错都不挡 AI 干活：什么也不说就退出。
   装：node naming-gate.js install（写进 ~/.claude/settings.json 和 ~/.codex/hooks.json，已有的不重复，11-09 那两个顺手拿掉）；看装没装：node naming-gate.js status
   Codex 装上以后要他在 Codex 的 设置 > Hooks 里点一次信任，不点不跑。
   测试：node --test 通用工具/测试/命名门卫_测试.cjs */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const NR = require(path.join(__dirname, '..', '..', '通用工具', '公用', '命名规则.js'));

const MODE = '提醒';   // 「提醒」：写完提醒；「拦」：写之前退回
const ROOT = process.env.ANTOU_ROOT ? path.resolve(process.env.ANTOU_ROOT) : NR.ROOT;
const STAMPS = process.env.ANTOU_NAMING_STAMPS || path.join(os.tmpdir(), 'naming-gate');   // 每个对话这一轮从几点开始
const CLAUDE = process.env.ANTOU_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
const CODEX = process.env.ANTOU_CODEX_HOOKS || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'hooks.json');
const CMD = 'node "' + __filename.replace(/\\/g, '/') + '"';
const OLD_HOOKS = /top-level-check\.js|transitional-file-check\.js/;
const PLAN = {   // 两边各登记哪几样：[事件, 只管哪些工具]
  claude: [['UserPromptSubmit', null], ['PreToolUse', 'Write|Edit|MultiEdit|NotebookEdit'], ['PostToolUse', 'Write|Edit|MultiEdit|NotebookEdit'], ['Stop', null]],
  codex: [['UserPromptSubmit', null], ['PreToolUse', '^apply_patch$'], ['PostToolUse', '^apply_patch$'], ['Stop', null]],
};

const inside = p => { const r = path.relative(ROOT, path.resolve(p)); return !r || (!r.startsWith('..') && !path.isAbsolute(r)); };
const stampOf = id => path.join(STAMPS, String(id || 'x').replace(/[^\w.-]/g, '_') + '.txt');

/* 这一下要写哪几个文件：Claude 的 Write、Edit、MultiEdit、NotebookEdit 给路径；Codex 的 apply_patch 是补丁原文，认「*** Add File: 」「*** Move to: 」那几行（改原有的文件名字不变，不查） */
function pathsOf(j) {
  const t = String(j.tool_name || ''), inp = j.tool_input || {}, cwd = j.cwd || process.cwd();
  if (/^(Write|Edit|MultiEdit)$/.test(t)) return inp.file_path ? [path.resolve(cwd, String(inp.file_path))] : [];
  if (t === 'NotebookEdit') return inp.notebook_path ? [path.resolve(cwd, String(inp.notebook_path))] : [];
  if (t === 'apply_patch') {
    const text = typeof inp === 'string' ? inp : [inp.command, inp.input, inp.patch].find(x => typeof x === 'string') || '';
    return [...text.matchAll(/^\*\*\* (?:Add File|Move to): (.+?)\s*$/gm)].map(m => path.resolve(cwd, m[1]));
  }
  return [];
}

function problems(paths) {
  const old = NR.loadOld(), ctx = NR.stemsCtx(ROOT), seen = new Set(), out = [];
  for (const p of paths) {
    if (!inside(p)) continue;
    const w = NR.checkPath(p, { root: ROOT, old, ctx, dir: false });
    if (w && !seen.has(w.rel)) { seen.add(w.rel); out.push(w); }
  }
  return out;
}

const line = w => '- ' + w.rel + '：' + w.why + (w.fix ? '，照规矩叫「' + w.fix + '」' : '');
const RULES_AT = '规矩见 AGENTS.md「项目目录和资料规则」，程序查的那几条在 通用工具\\公用\\命名规则.js 开头。';
const say = (head, list, tail) => [head, ...list.slice(0, 12).map(line), list.length > 12 ? '- 等，一共 ' + list.length + ' 处' : '', tail + RULES_AT].filter(Boolean).join('\n');

/* 一级目录多出来的空文件夹直接删（11-09 起就这样）；删不掉的（被占着）不管，下回再删 */
function sweepTop() {
  let names = [];
  try { names = fs.readdirSync(ROOT); } catch (e) { return; }
  for (const n of names) {
    if (NR.TOP.includes(n) || /^(desktop\.ini|thumbs\.db)$/i.test(n)) continue;
    const p = path.join(ROOT, n);
    try { if (fs.statSync(p).isDirectory() && !fs.readdirSync(p).length) fs.rmdirSync(p); } catch (e) {}
  }
}

/* 收到一回事件，给要回的话（null 就是什么也不说） */
function handle(j) {
  const ev = j.hook_event_name, codex = 'turn_id' in j, cwdIn = !!j.cwd && inside(j.cwd);
  if (ev === 'UserPromptSubmit') {
    if (!cwdIn) return null;
    fs.mkdirSync(STAMPS, { recursive: true });
    fs.writeFileSync(stampOf(j.session_id), String(Date.now()));
    return null;
  }
  if (ev === 'PreToolUse' || ev === 'PostToolUse') {
    if ((ev === 'PreToolUse') !== (MODE === '拦')) return null;
    const list = problems(pathsOf(j));
    if (!list.length) return null;
    if (ev === 'PreToolUse') {
      const msg = say('没写：名字或位置不合项目规矩。', list, '换成合规矩的名字或位置再写。');
      return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: msg } };
    }
    const msg = say('刚写的文件，名字或位置不合项目规矩：', list, '照规矩改名或挪到该放的地方（改名前先查有没有地方用到它，一起改）；拿不准就告诉用户，别乱挪。');
    return { decision: 'block', reason: msg, hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: msg } };
  }
  if (ev === 'Stop') {
    if (!cwdIn) return null;
    sweepTop();
    let since = 0;
    try { since = +fs.readFileSync(stampOf(j.session_id), 'utf8') || 0; } catch (e) {}
    const list = NR.scan({ root: ROOT, old: NR.loadOld(), since: since || Date.now() - 2 * 3600e3 });
    if (!list.length) return null;
    const msg = say('这一轮项目里新出了名字或位置不合规矩的：', list, '是你这一轮弄的，就照规矩改名或挪到该放的地方（改名前先查有没有地方用到它，一起改）；不是你弄的或拿不准，告诉用户，别动。');
    if (!j.stop_hook_active) return { decision: 'block', reason: msg };
    return codex ? null : { systemMessage: msg };   // 已经提醒过一回：Claude 只给用户看一眼，不再拦
  }
  return null;
}

/* ---------- 装、看装没装 ---------- */
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(f + ' 读不出来：' + e.message); } };
const ours = h => !!h && typeof h.command === 'string' && h.command.includes('naming-gate.js');
function installed(kind) {   // 装着给 true、没装给 false；这台电脑压根没有这个 AI（没有它的设置文件夹）给 null，不用门卫
  const file = kind === 'claude' ? CLAUDE : CODEX;
  if (!fs.existsSync(path.dirname(file))) return null;
  const hooks = (readJson(file).hooks) || {};
  return PLAN[kind].every(([ev, m]) => (hooks[ev] || []).some(g => (g.matcher || null) === m && (g.hooks || []).some(h => ours(h) && h.command === CMD)));
}
function install(kind) {
  const file = kind === 'claude' ? CLAUDE : CODEX, doc = readJson(file);
  const hooks = doc.hooks && typeof doc.hooks === 'object' ? doc.hooks : {};
  for (const ev of Object.keys(hooks)) {   // 先拿掉以前装的（我们的、11-09 那两个），别人的原样留着
    if (!Array.isArray(hooks[ev])) continue;
    hooks[ev] = hooks[ev].map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h) && !OLD_HOOKS.test(String(h && h.command))) })).filter(g => g.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  }
  for (const [ev, m] of PLAN[kind]) (hooks[ev] = hooks[ev] || []).push({ ...(m ? { matcher: m } : {}), hooks: [{ type: 'command', command: CMD, timeout: 30 }] });
  doc.hooks = hooks;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n');
  fs.renameSync(tmp, file);
  return file;
}
const status = () => ({ claude: installed('claude'), codex: installed('codex') });

module.exports = { MODE, CMD, pathsOf, problems, handle, install, installed, status };

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'install') {
    for (const k of ['claude', 'codex']) console.log((k === 'claude' ? 'Claude' : 'Codex') + '：' + install(k));
    console.log('装好了。Claude 新开的对话就有；Codex 要在 设置 > Hooks 里点一次信任。');
  } else if (cmd === 'status') {
    const s = status();
    const say = (v, ok) => v === null ? '这台电脑没有' : v ? ok : '没装';
    console.log('Claude：' + say(s.claude, '装着') + '；Codex：' + say(s.codex, '装着（信任要在 Codex 设置 > Hooks 里看）') + '；现在是「' + MODE + '」');
  } else {
    let input = '';
    process.stdin.on('data', d => { input += d; }).on('end', () => {
      try { const out = handle(JSON.parse(input || '{}')); if (out) process.stdout.write(JSON.stringify(out)); }
      catch (e) { process.stderr.write('命名门卫没查成：' + e.message + '\n'); }   // 出错不挡 AI 干活
    });
  }
}
