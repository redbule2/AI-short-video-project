'use strict';
// node 通用工具/段落_任务测试.js
// 11-16 剧本挪到段落前面：写剧本不带段落；剧本定稿以后 AI 分段落、照批注改段落。项目读写都在内存里，不碰真项目。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const backend = path.resolve(__dirname, '../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const P = (...a) => path.join(root, '项目', '测试', ...a);
const flowPath = P('定稿的剧本', '流水线.json');
const scriptPath = P('定稿的剧本', '第1段', '第1段_剧本.docx');
const parasPath = P('定稿的剧本', '第1段', '第1段_段落.json');
const notePath = P('定稿的剧本', '第1段', '第1段_段落_批注.md');
const SCRIPT = '第1段｜吃面\n正文\n△ 老李端起碗。\n老李：烫！';
const fail = code => Object.assign(new Error(code), { code });

function setup(scene, more = {}) {
  const files = new Map([[flowPath, Buffer.from(JSON.stringify({ 梗概: '小面摊', 人物: [{ 名: '老李', 描写: '五十岁' }], 场: [scene] }))]]);
  const mtimes = new Map();
  for (const [p, v] of Object.entries(more)) { files.set(p, Buffer.from(v.text)); if (v.mtime) mtimes.set(p, v.mtime); }
  const mockFs = {
    existsSync: p => files.has(p),
    promises: {
      async readFile(p, encoding) {
        if (String(p).endsWith('SKILL.md')) return '测试技能';
        if (!files.has(p)) throw fail('ENOENT');
        return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p));
      },
      async stat(p) { if (!files.has(p)) throw fail('ENOENT'); return { mtimeMs: mtimes.get(p) || 0 }; },
      async mkdir() {}, async readdir() { return []; },
      async writeFile(p, data) { files.set(p, Buffer.from(data)); },
      async rename(from, to) { if (!files.has(from)) throw fail('ENOENT'); files.set(to, files.get(from)); files.delete(from); },
      async copyFile(from, to) { files.set(to, Buffer.from(files.get(from))); },
    },
  };
  // 读剧本（剧本读写.js 读）换成假的：照原样吐出 SCRIPT
  const spawn = (cmd, args) => {
    if (!(args && args[1] === '读' && files.has(args[2]))) throw Error('测试不能调用外部程序：' + (args || []).join(' '));
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
    setImmediate(() => { child.stdout.emit('data', Buffer.from(SCRIPT + '\n')); child.exitCode = 0; child.emit('close', 0); });
    return child;
  };
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: __dirname, log() {}, withFileLocks: async (paths, fn) => fn() });
  const hist = dir => [...files.keys()].filter(p => p.startsWith(P('历史记录', ...dir)));
  return { K: api.KINDS, files, hist, json: p => JSON.parse(files.get(p).toString()) };
}

const FIN = '2026-11-16 10:00:00', finMs = Date.parse('2026-11-16T10:00:00');
const scene = extra => ({ 段: '1', 名: '吃面', 表达: '老李嘴硬心软', 人物: ['老李'], 剧本定稿: FIN, ...extra });
const job = extra => ({ 项目: '测试', 段: '1', 渠道: 'self', ...extra });
const script = { [scriptPath]: { text: 'docx', mtime: finMs - 5000 } };
const REPLY = '好的\n{"段落": [{"写什么": "老李\\n 端碗", "作用": " 先让人看见他嘴硬 "}, {"写什么": "", "作用": ""}, {"写什么": "烫着了", "作用": "心软露出来"}]}';

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('写剧本：要先写这一场表达什么；任务书里不带段落', async () => {
    await assert.rejects(setup(scene({ 表达: '  ' })).K.扩写剧本.book(job()), /还没写主要表达什么/);
    const book = await setup(scene({ 段落: [{ 写什么: '旧段落甲', 作用: '旧作用' }] })).K.扩写剧本.book(job());
    assert.ok(book.includes('这一场主要表达：老李嘴硬心软'));
    assert.doesNotMatch(book, /剧本段落|旧段落甲/);
  });

  await check('分段落：剧本没定稿、定稿后又改过剧本，都不分', async () => {
    await assert.rejects(setup(scene({ 剧本定稿: '' }), script).K.分段落.book(job()), /剧本定稿以后才能分段落/);
    await assert.rejects(setup(scene(), { [scriptPath]: { text: 'docx', mtime: finMs + 60e3 } }).K.分段落.book(job()), /剧本定稿以后才能分段落/);
    await assert.rejects(setup(scene()).K.分段落.book(job()), /还没有剧本/);
  });

  await check('分段落：任务书带定稿的剧本；回的段落去掉空段、写进 第N段_段落.json，旧的一份收进历史记录', async () => {
    const s = setup(scene(), { ...script, [parasPath]: { text: '{"段落": [{"写什么": "旧", "作用": "旧"}]}' } });
    const book = await s.K.分段落.book(job());
    assert.ok(book.includes(SCRIPT) && book.includes('这一场主要表达：老李嘴硬心软'));
    const r = await s.K.分段落.apply(job(), REPLY);
    assert.match(r.结果, /2 段/);
    assert.equal(JSON.stringify(r.产出), JSON.stringify(['定稿的剧本/第1段/第1段_段落.json']));
    const got = s.json(parasPath);
    assert.deepEqual(got.段落, [{ 写什么: '老李 端碗', 作用: '先让人看见他嘴硬' }, { 写什么: '烫着了', 作用: '心软露出来' }]);
    assert.ok(got.时间 && got.渠道 === 'self');
    const old = s.hist(['定稿的剧本', '第1段']);
    assert.equal(old.length, 1); assert.match(path.basename(old[0]), /^第1段_段落__\d{8}-\d{6}\.json$/);
  });

  await check('分段落：AI 没按格式回（没有一段），不写文件', async () => {
    const s = setup(scene(), script);
    await assert.rejects(s.K.分段落.apply(job(), '{"段落": [{"写什么": " ", "作用": ""}]}'), /至少一段/);
    await assert.rejects(s.K.分段落.apply(job(), '分不了'), /JSON/);
    assert.ok(!s.files.has(parasPath));
  });

  await check('段落按批注改：没有批注文件不起；任务书带现在的段落和批注；改完批注收进历史记录', async () => {
    const paras = [{ 写什么: '老李端碗', 作用: '嘴硬' }, { 写什么: '烫着了', 作用: '心软' }];
    await assert.rejects(setup(scene({ 段落: paras }), script).K.段落按批注改.prep(job()), /批注文件不在了/);
    const s = setup(scene({ 段落: paras }), { ...script, [notePath]: { text: '## 段落2\n批注：加一句他偷偷吹凉' } });
    const j = job(); await s.K.段落按批注改.prep(j);
    const book = await s.K.段落按批注改.book(j);
    assert.ok(book.includes('段落1　写什么：老李端碗　作用：嘴硬') && book.includes('加一句他偷偷吹凉') && book.includes(SCRIPT));
    await s.K.段落按批注改.apply(j, REPLY);
    assert.equal(s.json(parasPath).段落.length, 2);
    assert.ok(!s.files.has(notePath));
    assert.ok(s.hist(['定稿的剧本', '第1段']).some(p => /第1段_段落_批注__\d{8}-\d{6}\.md$/.test(p)));
  });

  await check('段落按批注改：这一场还没有段落就不改', async () => {
    const s = setup(scene({ 段落: [] }), { ...script, [notePath]: { text: '批注' } });
    const j = job(); await s.K.段落按批注改.prep(j);
    await assert.rejects(s.K.段落按批注改.book(j), /还没有段落/);
  });

  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exit(1); });
