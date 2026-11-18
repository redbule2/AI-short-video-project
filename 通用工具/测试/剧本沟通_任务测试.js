'use strict';
// node 通用工具/测试/剧本沟通_任务测试.js
// 11-17 他定：剧本页「与AI继续沟通」——复制要交代的话，贴进自己的 AI 对话商量着改；他说「定稿」，AI 才把整份剧本写回来。没写批注也能点。
// 照页面那样走接口（开任务、拿交给 AI 的话、贴回复），项目读写都在内存里，不碰真项目。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const P = (...a) => path.join(root, '项目', '测试', ...a);
const docPath = P('定稿的剧本', '第1段', '第1段_剧本.docx');
const notePath = P('定稿的剧本', '第1段', '第1段_剧本_批注.md');
const NOTE = '项目/测试/定稿的剧本/第1段/第1段_剧本_批注.md';
const SCRIPT = '第1段｜吃面\n正文\n△ 老李端起碗。\n老李：烫！';
const NEW = '第1段｜吃面\n正文\n△ 老李端起碗，吹了一口。\n老李：烫！\n备注\n11-17 和 AI 商量改：加了吹一口';
const SELF = '自己交给 AI';
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

function setup(more = {}) {
  const files = new Map([[docPath, Buffer.from('DOCX:' + SCRIPT)]]), dirs = new Set([P()]);
  let tick = 1;
  const mtimes = new Map();
  const put = (p, data) => { files.set(p, Buffer.from(data)); mtimes.set(p, tick++); };
  for (const [p, v] of Object.entries(more)) v == null ? files.delete(p) : put(p, v);
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
  // 剧本读写.js 换成假的：读＝吐出文字；查＝第一行不是「第N段」就报格式不对；写剧本＝把文字存成「Word」
  const calls = [];
  const spawn = (cmd, args) => {
    const [, op, a, b] = args || [];
    let code = 0, out = '', err = '';
    if (op === '读' && files.has(a)) out = files.get(a).toString().replace(/^DOCX:/, '') + '\n';
    else if (op === '查' && files.has(a)) { if (!/^第.+段/.test(files.get(a).toString())) { code = 1; err = '没做成：第一行要写成「第N段｜段名」'; } }
    else if (op === '写剧本' && files.has(b)) { calls.push(a); put(a, 'DOCX:' + files.get(b).toString().trim()); }
    else throw Error('测试不能调用外部程序：' + (args || []).join(' '));
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
    setTimeout(() => { if (out) child.stdout.emit('data', Buffer.from(out)); if (err) child.stderr.emit('data', Buffer.from(err)); child.exitCode = code; child.emit('close', code); }, 5);   // 真起一个 node 要几十毫秒：同一毫秒里收到又报格式错，贴回复那头认不出是这一回的
    return child;
  };
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, URL, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  /* 照页面那样调接口 */
  async function call(method, url, body) {
    let out;
    const json = (res, obj) => { out = obj; };
    const readBody = async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}));
    const httpErr = (code, msg) => Object.assign(new Error(msg), { status: code });
    await api.handle({ method }, {}, new URL('http://127.0.0.1' + url), { json, readBody, httpErr });
    return out;
  }
  async function msgOf(id) {   // 交给 AI 的话备好要一会儿
    for (let i = 0; i < 100; i++) { try { return await call('GET', '/api/job/' + id + '?msg'); } catch (e) { await sleep(20); } }
    throw new Error('交给 AI 的话一直没备好');
  }
  const hist = () => [...files.keys()].filter(p => p.startsWith(P('历史记录', '定稿的剧本')));
  return { K: api.KINDS, files, calls, hist, call, msgOf, text: p => files.get(p).toString() };
}
const talk = extra => ({ 事: '与AI沟通剧本', 项目: '测试', 批注: NOTE, 渠道: SELF, ...extra });

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('开任务：没写批注也能开；不是这个项目定稿的剧本里的剧本、剧本文件不在，都不开', async () => {
    const s = setup();
    const j = await s.call('POST', '/api/job', talk());
    assert.equal(j.标题, '与AI沟通 · 第1段_剧本');
    assert.equal(j.段, '1');
    assert.equal(j.渠道, SELF);   // 页面传别的也一律给我提示词
    await assert.rejects(s.call('POST', '/api/job', talk({ 批注: '项目/别的/定稿的剧本/第1段/第1段_剧本_批注.md' })), /不是这个项目/);
    await assert.rejects(s.call('POST', '/api/job', talk({ 批注: '项目/测试/定稿的剧本/第1段/第1段_镜头表_批注.md' })), /不是这个项目/);
    await assert.rejects(s.call('POST', '/api/job', talk({ 批注: '项目/测试/提示词/第1段/1-5_批注.md' })), /不是这个项目/);
    const s2 = setup({ [docPath]: null });
    await assert.rejects(s2.call('POST', '/api/job', talk()), /还没有单独的剧本文件.*写剧本/);
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  await check('交给 AI 的话：先商量，说「定稿」才写回复文件；弹窗那一句另说；任务书带剧本，没写批注就写明', async () => {
    const s = setup();
    const j = await s.call('POST', '/api/job', talk());
    const m = await s.msgOf(j.id);
    assert.ok(m.话.startsWith('我写好了第1段的剧本，想先和你商量着改。'));
    assert.ok(m.话.includes('等我说「定稿」，再把改好的整份剧本') && m.话.includes('我没说「定稿」之前别写它') && m.话.includes('只写「不改」两个字'));
    assert.ok(m.话.includes(m.回复) && m.话.includes('server.js" reply ' + j.id));   // 写哪个文件、写完怎么告诉项目
    assert.equal(m.说, s.K.与AI沟通剧本.handSay);
    assert.match(m.说, /跟它说「定稿」/);
    const book = s.text(path.join(path.dirname(m.回复), '任务书.md'));
    assert.ok(m.话.includes(path.join(path.dirname(m.回复), '任务书.md')));
    assert.ok(book.includes(SCRIPT) && book.includes('## 批注\n（没写批注）'));
    assert.ok(book.includes('人说「定稿」以后，才把改好的整份剧本一次写进回复文件') && book.includes('只改商量定了的地方'));
    assert.ok(!book.includes('人还写了批注') && !book.includes('批注一条一条'));
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  await check('写了批注：任务书一起带上；定稿的剧本写回 Word（照固定格式查过），批注收进历史记录', async () => {
    const s = setup({ [notePath]: '## 第3行\n原文：老李：烫！\n批注：先吹一口' });
    const j = await s.call('POST', '/api/job', talk());
    const m = await s.msgOf(j.id);
    const book = s.text(path.join(path.dirname(m.回复), '任务书.md'));
    assert.ok(book.includes('人还写了批注') && book.includes('批注一条一条说打算怎么改') && book.includes('批注：先吹一口'));
    const r = await s.call('POST', '/api/job/' + j.id + '?reply', '好的，定稿如下：\n```\n' + NEW + '\n```');
    assert.equal(r.状态, '做完');
    assert.match(r.结果, /照商量的改好了/);
    assert.deepEqual(r.产出, ['定稿的剧本/第1段/第1段_剧本.docx']);
    assert.equal(s.text(docPath), 'DOCX:' + NEW);   // 前面的客套话、代码块围栏都去掉了
    assert.deepEqual(s.calls, [docPath]);
    assert.ok(!s.files.has(notePath));
    assert.ok(s.hist().some(p => /第1段_剧本_批注__\d{8}-\d{6}\.md$/.test(p)));
  });

  await check('商量下来不改：回「不改」，剧本、批注都不动', async () => {
    const s = setup({ [notePath]: '批注：看看' });
    const j = await s.call('POST', '/api/job', talk());
    await s.msgOf(j.id);
    const r = await s.call('POST', '/api/job/' + j.id + '?reply', '不改。');
    assert.equal(r.状态, '做完');
    assert.equal(r.结果, '商量下来不改：剧本没动，批注还留着');
    assert.equal(s.text(docPath), 'DOCX:' + SCRIPT);
    assert.ok(s.files.has(notePath));
    assert.deepEqual(s.calls, []);
  });

  await check('回的剧本格式不对：不算没成，接着等 AI 改好；改好了照常写回', async () => {
    const s = setup();
    const j = await s.call('POST', '/api/job', talk());
    await s.msgOf(j.id);
    const bad = await s.call('POST', '/api/job/' + j.id + '?reply', '老李端起碗');
    assert.equal(bad.状态, '在做');
    assert.match(bad.格式错, /AI 写的剧本没按要的格式/);
    assert.equal(s.text(docPath), 'DOCX:' + SCRIPT);
    const ok = await s.call('POST', '/api/job/' + j.id + '?reply', NEW);
    assert.equal(ok.状态, '做完');
    assert.equal(s.text(docPath), 'DOCX:' + NEW);
  });

  await check('同一份剧本再点一次：还是原来那个任务（弹出来的还是那段话）', async () => {
    const s = setup();
    const a = await s.call('POST', '/api/job', talk()), b = await s.call('POST', '/api/job', talk());
    assert.equal(a.id, b.id);
    await s.call('POST', '/api/job/' + a.id + '?cancel');
  });

  await check('别的事交给 AI 的话照旧（按批注改），弹窗那一句不另说', async () => {
    const s = setup({ [notePath]: '批注：先吹一口' });
    const j = await s.call('POST', '/api/job', { 事: '按批注改', 项目: '测试', 批注: NOTE, 渠道: SELF });
    const m = await s.msgOf(j.id);
    assert.ok(m.话.startsWith('请读这份任务书，照里面的要求做：'));
    assert.equal(m.说, '');
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  console.log(tested + ' 项检查通过；真实项目数据未读写。');
  process.exit(0);   // 停掉的任务还在等回复的两秒一看：不等它们
})().catch(e => { console.error(e); process.exit(1); });
