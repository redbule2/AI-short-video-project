'use strict';
/* .agents/hooks/naming-gate.js：Claude、Codex 写进项目的文件名字、位置不合规矩时提醒；装进两边的设置。真起一个进程、喂事件，和两边调它一样 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const GATE = path.join(__dirname, '..', '..', '.agents', 'hooks', 'naming-gate.js');

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), '命名门卫测试-')), root = path.join(base, '总');
  for (const d of ['.agents', '通用工具', '项目/童晓晓/提示词/第1段', '项目/童晓晓/资产/人物和道具', '项目/童晓晓/成片/第1段', '项目/童晓晓/历史记录', '项目/童晓晓/定稿的剧本'])
    fs.mkdirSync(path.join(root, ...d.split('/')), { recursive: true });
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'x');
  const env = {
    ANTOU_ROOT: root, ANTOU_NAMING_OLD: path.join(base, '老文件.json'), ANTOU_NAMING_STAMPS: path.join(base, '几点开始'),
    ANTOU_CLAUDE_SETTINGS: path.join(base, 'claude', 'settings.json'), ANTOU_CODEX_HOOKS: path.join(base, 'codex', 'hooks.json'),
  };
  const run = (input, args = []) => {
    const r = spawnSync(process.execPath, [GATE, ...args], { input: input ? JSON.stringify(input) : '', env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    if (args.length) return r.stdout;
    return r.stdout ? JSON.parse(r.stdout) : null;
  };
  const pj = path.join(root, '项目', '童晓晓');
  return { base, root, pj, env, run, done: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test('Claude 写完：名字不合规矩就提醒，给出该叫什么；合规矩、写在项目外的不吭声；「提醒」时写之前不拦', () => {
  const t = setup();
  try {
    const bad = path.join(t.pj, '资产', '人物和道具', '小狗_v2.png');
    const out = t.run({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: t.pj, tool_name: 'Write', tool_input: { file_path: bad } });
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /项目\/童晓晓\/资产\/人物和道具\/小狗_v2\.png：名字带版本号，照规矩叫「小狗\.png」/);
    assert.equal(out.hookSpecificOutput.additionalContext, out.reason);
    assert.equal(t.run({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: t.pj, tool_name: 'Edit', tool_input: { file_path: path.join(t.pj, '资产', '人物和道具', '小狗.png') } }), null);
    assert.equal(t.run({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: t.pj, tool_name: 'Write', tool_input: { file_path: path.join(t.base, '别处_v2.png') } }), null);
    assert.equal(t.run({ hook_event_name: 'PreToolUse', session_id: 's1', cwd: t.pj, tool_name: 'Write', tool_input: { file_path: bad } }), null);
    const nb = t.run({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: t.pj, tool_name: 'NotebookEdit', tool_input: { notebook_path: path.join(t.pj, '历史教训', '笔记.ipynb') } });
    assert.match(nb.reason, /项目\/童晓晓\/历史教训：项目文件夹里只许放/);
  } finally { t.done(); }
});

test('Codex 的 apply_patch：认新建、改名那几行，路径照 cwd 算', () => {
  const t = setup();
  try {
    const patch = ['*** Begin Patch', '*** Add File: 资产/人物和道具/人物_小狗.txt', '+x', '*** Update File: 提示词/第1段/1-5.txt', '*** Move to: 提示词/第1段/第1段_1-5.txt', '@@', '-a', '+b', '*** End Patch'].join('\n');
    const out = t.run({ hook_event_name: 'PostToolUse', session_id: 'c1', turn_id: 't1', cwd: t.pj, tool_name: 'apply_patch', tool_input: { command: patch } });
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /人物_小狗\.txt：名字带了类别（看所在文件夹），照规矩叫「小狗\.txt」/);
    assert.match(out.reason, /第1段_1-5\.txt：名字里又写了这一段（看所在文件夹），照规矩叫「1-5\.txt」/);
    const fine = ['*** Begin Patch', '*** Add File: 提示词/第1段/1-5_改1.txt', '+x', '*** End Patch'].join('\n');
    assert.equal(t.run({ hook_event_name: 'PostToolUse', session_id: 'c1', turn_id: 't1', cwd: t.pj, tool_name: 'apply_patch', tool_input: { command: fine } }), null);
  } finally { t.done(); }
});

test('每轮结束：扫这一轮新出的，提醒一回；已经提醒过 Claude 只给用户看，Codex 不再说；对话不在项目里不管', () => {
  const t = setup();
  try {
    t.run({ hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: t.pj, prompt: '出一张图' });
    fs.writeFileSync(path.join(t.pj, '资产', '人物和道具', '飞碟 - 副本.png'), 'x');
    fs.mkdirSync(path.join(t.root, '空的临时文件夹'));
    fs.mkdirSync(path.join(t.root, '有东西的'));
    fs.writeFileSync(path.join(t.root, '有东西的', 'a.txt'), 'x');
    const out = t.run({ hook_event_name: 'Stop', session_id: 's2', cwd: t.pj, stop_hook_active: false });
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /飞碟 - 副本\.png：名字像副本，照规矩叫「飞碟\.png」/);
    assert.match(out.reason, /- 有东西的：一级目录只许放/);
    assert.equal(fs.existsSync(path.join(t.root, '空的临时文件夹')), false);   // 空的直接删
    assert.equal(t.run({ hook_event_name: 'Stop', session_id: 's2', cwd: t.pj, stop_hook_active: true }).systemMessage, out.reason);
    assert.equal(t.run({ hook_event_name: 'Stop', session_id: 's2', turn_id: 't9', cwd: t.pj, stop_hook_active: true }), null);
    assert.equal(t.run({ hook_event_name: 'Stop', session_id: 's2', cwd: t.base, stop_hook_active: false }), null);
  } finally { t.done(); }
});

test('装进两边：拿掉 11-09 那两个旧检查，别人的留着；装两回不重复；status 认得出', () => {
  const t = setup();
  try {
    fs.mkdirSync(path.dirname(t.env.ANTOU_CLAUDE_SETTINGS), { recursive: true });
    fs.writeFileSync(t.env.ANTOU_CLAUDE_SETTINGS, JSON.stringify({ theme: 'auto', hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'node E:\\AI短视频项目\\.agents\\hooks\\top-level-check.js' }, { type: 'command', command: 'node E:\\AI短视频项目\\.agents\\hooks\\transitional-file-check.js' }] }],
      PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo 别人的' }] }],
    } }));
    assert.match(t.run(null, ['status']), /Claude：没装；Codex：这台电脑没有/);   // 没有 Codex 的设置文件夹：不用门卫
    fs.mkdirSync(path.dirname(t.env.ANTOU_CODEX_HOOKS), { recursive: true });
    assert.match(t.run(null, ['status']), /Claude：没装；Codex：没装/);
    t.run(null, ['install']); t.run(null, ['install']);
    const c = JSON.parse(fs.readFileSync(t.env.ANTOU_CLAUDE_SETTINGS, 'utf8'));
    assert.equal(c.theme, 'auto');
    assert.deepEqual(Object.keys(c.hooks).sort(), ['PostToolUse', 'PreToolUse', 'Stop', 'UserPromptSubmit']);
    assert.equal(JSON.stringify(c).includes('top-level-check'), false);
    assert.equal(JSON.stringify(c).includes('transitional-file-check'), false);
    assert.equal(c.hooks.PostToolUse.filter(g => g.matcher === 'Bash').length, 1);
    for (const ev of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) assert.equal(c.hooks[ev].filter(g => g.hooks.some(h => h.command.includes('naming-gate.js'))).length, 1, ev);
    assert.equal(c.hooks.PreToolUse[0].matcher, 'Write|Edit|MultiEdit|NotebookEdit');
    const x = JSON.parse(fs.readFileSync(t.env.ANTOU_CODEX_HOOKS, 'utf8'));
    assert.equal(x.hooks.PostToolUse[0].matcher, '^apply_patch$');
    assert.match(x.hooks.Stop[0].hooks[0].command, /^node ".*naming-gate\.js"$/);
    assert.match(t.run(null, ['status']), /Claude：装着；Codex：装着/);
  } finally { t.done(); }
});
