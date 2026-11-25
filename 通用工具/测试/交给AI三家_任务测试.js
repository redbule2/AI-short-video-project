'use strict';
// node 通用工具/测试/交给AI三家_任务测试.js
// 11-24 他定（开发规范第 18、19 条）：交给 AI 一律开看得见的新对话，开不了才给提示词复制；对话名照【项目简称 · 做什么 · 哪一样】。
// 照页面那样走接口：「AI 用」摆哪几个、选的开不了改成给我提示词、Codex、DeepSeek、豆包工作的话头一行是对话名。
// 项目读写都在内存里；Codex、DeepSeek、豆包工作换成假的，不真开对话、不花钱、不动剪贴板。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const P = (...a) => path.join(root, '项目', '测试', ...a);
const docPath = P('定稿的剧本', '第1段', '第1段_剧本.docx');
const NOTE = '项目/测试/定稿的剧本/第1段/第1段_剧本_批注.md';
const SCRIPT = '第1段｜吃面\n正文\n△ 老李端起碗。\n老李：烫！';
const SELF = '自己交给 AI';
const CX = path.join(path.resolve(path.dirname(backend), '..'), 'codex-chat', 'codex-chat.ps1');   // jobs.js 里 codex-chat 的位置
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* hand：假的 handoff.js 装了哪几样；codex：假的 codex-chat 回什么（ok、thread_id、reply） */
function setup({ hand = {}, codex = null } = {}) {
  const files = new Map([[docPath, Buffer.from('DOCX:' + SCRIPT)], [CX, Buffer.from('假的')]]), dirs = new Set([P()]);
  let tick = 1;
  const mtimes = new Map();
  const put = (p, data) => { files.set(p, Buffer.from(data)); mtimes.set(p, tick++); };
  const mockFs = {
    existsSync: p => files.has(p) || dirs.has(p),
    promises: {
      async readFile(p, encoding) {
        if (String(p).endsWith('SKILL.md')) return '测试技能';
        if (!files.has(p)) throw enoent();
        return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p));
      },
      async stat(p) {
        if (dirs.has(p)) return { mtimeMs: 0, size: 0, isFile: () => false, isDirectory: () => true };
        if (!files.has(p)) throw enoent();
        return { mtimeMs: mtimes.get(p) || 0, size: files.get(p).length, isFile: () => true, isDirectory: () => false };
      },
      async mkdir() {}, async readdir() { return []; }, async unlink(p) { files.delete(p); },
      async writeFile(p, data) { put(p, data); },
      async rename(from, to) { if (!files.has(from)) throw enoent(); files.set(to, files.get(from)); mtimes.set(to, tick++); files.delete(from); },
    },
  };
  const sent = [];   // 交给假 Codex 的话
  const spawn = (cmd, args) => {
    const [, op, a] = args || [];
    let code = 0, out = '';
    if (/powershell/i.test(cmd) && args.includes('-PromptFile')) {   // 假的 codex-chat：记下发进去的话，照 codex 回
      sent.push(files.get(args[args.indexOf('-PromptFile') + 1]).toString());
      const c = codex || {};
      out = (c.reply ? '=== Codex 回复 ===\n' + c.reply + '\n' : '') + 'RESULT_JSON ' + JSON.stringify({ ok: !!c.ok, thread_id: c.thread_id || null, error: c.error || null }) + '\n';
    } else if (op === '读' && files.has(a)) out = files.get(a).toString().replace(/^DOCX:/, '') + '\n';
    else if (op === '查' && files.has(a)) { /* 格式对 */ }
    else throw Error('测试不能调用外部程序：' + cmd + ' ' + (args || []).join(' '));
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
    setTimeout(() => { if (out) child.stdout.emit('data', Buffer.from(out)); child.exitCode = code; child.emit('close', code); }, 5);
    return child;
  };
  const opened = [];   // 假的 DeepSeek 窗口：开了几回、标题是什么
  const doubao = [], raised = [];   // 假的豆包工作：叫出来几回、复制的是什么话、抢没抢前台
  const fakeHand = () => ({
    claudeDesktop: false, openClaude: async () => {}, claudeStarted: () => null,
    codexDesktop: !!hand.codex, dsHarness: !!hand.deepseek,
    async openDeepSeek(o) { if (hand.dsFail) throw new Error('窗口起不来'); opened.push(o); },
    dsState: () => ({ 状态: '在做' }), dsStop() {},
    doubaoWork: !!hand.doubao,
    async openDoubao(text, o = {}) { if (hand.dbFail) throw new Error('豆包起不来'); doubao.push(text); raised.push(!!o.raise); },
  });
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, URL, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : name === './handoff.js' ? fakeHand : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  async function call(method, url, body) {
    let out;
    const json = (res, obj) => { out = obj; };
    const readBody = async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}));
    const httpErr = (code, msg) => Object.assign(new Error(msg), { status: code });
    await api.handle({ method }, {}, new URL('http://127.0.0.1' + url), { json, readBody, httpErr });
    return out === undefined ? out : JSON.parse(JSON.stringify(out));   // 沙箱里的数组不是这边的 Array：转一道再比
  }
  async function msgOf(id) {   // 交给 AI 的话备好要一会儿
    for (let i = 0; i < 100; i++) { try { return await call('GET', '/api/job/' + id + '?msg'); } catch (e) { await sleep(20); } }
    throw new Error('交给 AI 的话一直没备好');
  }
  async function until(id, ok) {   // 等任务走到某一步
    for (let i = 0; i < 150; i++) { const j = await call('GET', '/api/job/' + id); if (ok(j)) return j; await sleep(20); }
    throw new Error('任务一直没走到要的那一步');
  }
  return { call, msgOf, until, sent, opened, doubao, raised };
}
const talk = 渠道 => ({ 事: '与AI沟通剧本', 项目: '测试', 批注: NOTE, 渠道 });

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('「AI 用」照顺序摆 Codex、DeepSeek、豆包工作、给我提示词，不摆 Claude；没装的标开不了', async () => {
    const all = (await setup({ hand: { codex: true, deepseek: true, doubao: true } }).call('GET', '/api/job?channels')).channels;
    assert.deepEqual(all.map(c => c.id), ['codex', 'deepseek', 'doubao', SELF]);
    assert.deepEqual(all.map(c => c.ok), [true, true, true, true]);
    const none = (await setup().call('GET', '/api/job?channels')).channels;
    assert.deepEqual(none.filter(c => c.ok).map(c => c.id), [SELF]);   // 都没装：只剩给我提示词
  });

  await check('选的开不了（没装、不摆的 Claude）：改成给我提示词', async () => {
    const s = setup();
    for (const ch of ['codex', 'deepseek', 'doubao', 'claude']) {
      const j = await s.call('POST', '/api/job', talk(ch));
      assert.equal(j.渠道, SELF, ch);
      await s.call('POST', '/api/job/' + j.id + '?cancel');
    }
  });

  await check('DeepSeek：话的头一行就是对话名，窗口标题也是它', async () => {
    const s = setup({ hand: { deepseek: true } });
    const j = await s.call('POST', '/api/job', talk('deepseek'));
    assert.equal(j.渠道, 'deepseek');
    const m = await s.msgOf(j.id), name = '测试 · ' + j.标题;
    assert.equal(m.方式, 'deepseek');
    assert.equal(m.话.split('\n')[0], name);
    assert.ok(!m.话.includes('set_thread_title'));   // 不是 Codex，不叫它改名
    assert.equal(s.opened.length, 1);
    assert.equal(s.opened[0].title, name);
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  await check('DeepSeek 的窗口开不起来：改成给我提示词，话照给我提示词那样带对话名', async () => {
    const s = setup({ hand: { deepseek: true, dsFail: true } });
    const j = await s.call('POST', '/api/job', talk('deepseek'));
    const m = await s.msgOf(j.id);
    assert.equal(m.方式, 'self');
    assert.ok(m.话.startsWith('【测试 · ' + j.标题 + '】先给这个对话改名'));
    const now = await s.until(j.id, x => /改成给我提示词/.test(x.步骤 || ''));
    assert.match(now.步骤, /DeepSeek 的窗口没开起来（窗口起不来）/);
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  await check('Codex：发进去的话头一行叫它改成对话名，回复照常接上', async () => {
    const s = setup({ hand: { codex: true }, codex: { ok: true, thread_id: 't1', reply: '不改。' } });
    const j = await s.call('POST', '/api/job', talk('codex'));
    assert.equal(j.渠道, 'codex');
    const done = await s.until(j.id, x => x.状态 !== '排队' && x.状态 !== '在做');
    assert.equal(done.状态, '做完', done.错误);
    assert.equal(s.sent.length, 1);
    assert.ok(s.sent[0].startsWith('【测试 · ' + j.标题 + '】先给这个对话改名'));
    assert.ok(s.sent[0].split('\n')[0].includes('set_thread_title'));
  });

  await check('Codex 没发进去（找不到窗口）：改成给我提示词，等人复制', async () => {
    const s = setup({ hand: { codex: true }, codex: { ok: false, error: '没找到 Codex 的窗口' } });
    const j = await s.call('POST', '/api/job', talk('codex'));
    const now = await s.until(j.id, x => !!x.交给 || x.状态 === '没成');
    assert.equal(now.状态, '在做', now.错误);
    const m = await s.msgOf(j.id);
    assert.equal(m.方式, 'self');
    assert.ok(m.话.startsWith('【测试 · ' + j.标题 + '】'));
    assert.match((await s.until(j.id, x => /改成给我提示词/.test(x.步骤 || ''))).步骤, /Codex 没开起来（没找到 Codex 的窗口）/);
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  await check('豆包工作：话头一行是【对话名】，复制好、叫出来；弹窗给对话名；再叫一次；回复照常接上', async () => {
    const s = setup({ hand: { doubao: true } });
    const j = await s.call('POST', '/api/job', talk('doubao'));
    assert.equal(j.渠道, 'doubao');
    const m = await s.msgOf(j.id), name = '测试 · ' + j.标题;
    assert.equal(m.方式, 'doubao');
    assert.equal(m.等, '你');
    assert.equal(m.话.split('\n')[0], '【' + name + '】');
    assert.ok(!m.话.includes('set_thread_title'));   // 豆包改不了自己的名：人改，不叫它调 Codex 的工具
    assert.ok(m.话.includes('reply ' + j.id));   // 和给我提示词一样：做完写回复文件、跑一句告诉项目
    assert.equal(m.对话名, name);
    assert.match(m.接着, /定稿/);   // 这件事要先商量：弹窗告诉人贴进去以后跟它商量、说「定稿」
    await s.until(j.id, () => s.doubao.length === 1);
    assert.equal(s.doubao[0], m.话);   // 复制进剪贴板的就是弹窗里那段话
    assert.match((await s.call('GET', '/api/job/' + j.id)).步骤, /新工作任务.*Ctrl\+V/);
    await s.call('POST', '/api/job/' + j.id + '?reopen');
    assert.equal(s.doubao.length, 2);
    assert.deepEqual(s.raised, [true, true]);   // 刚点的、人点「再叫一次」的：都叫到最前面
    await s.call('POST', '/api/job/' + j.id + '?reply', '不改。');
    const done = await s.until(j.id, x => x.状态 !== '排队' && x.状态 !== '在做');
    assert.equal(done.状态, '做完', done.错误);
  });

  await check('豆包工作叫不出来：改成给我提示词，话照给我提示词那样带对话名', async () => {
    const s = setup({ hand: { doubao: true, dbFail: true } });
    const j = await s.call('POST', '/api/job', talk('doubao'));
    const now = await s.until(j.id, x => /改成给我提示词/.test(x.步骤 || ''));
    assert.match(now.步骤, /豆包工作没开起来（豆包起不来）/);
    const m = await s.msgOf(j.id);
    assert.equal(m.方式, 'self');
    assert.ok(m.话.startsWith('【测试 · ' + j.标题 + '】先给这个对话改名'));
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  await check('DeepSeek 起名的补丁：头几个词就是对话名，只关它自己起名那一样', async () => {
    const { namePatch } = require('../../.agents/skills/annotate-live/ds-window.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-name-'));
    try {
      const name = '李云龙 · 写稿 · 第3-4段 镜头1', file = namePatch(name, dir);
      const t = fs.readFileSync(file, 'utf8');
      assert.match(t, /^- id: session-title\n {2}config:\n {4}fallbackMaxWords: 6\n/);
      assert.match(t, /fallbackMaxBytes: (\d+)\n {4}maxTitleBytes: \1\n/);
      assert.ok(Number(/maxTitleBytes: (\d+)/.exec(t)[1]) >= Buffer.byteLength(name));
      assert.match(t, /- id: session-title-llm\n {2}disabled: true\n$/);
      assert.equal(namePatch('', dir), '');   // 没有名字：不带补丁
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log('通过 ' + tested + ' 项');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
