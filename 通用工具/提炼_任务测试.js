'use strict';
// node 通用工具/提炼_任务测试.js
// 11-16 他定：第一步直接写剧本（不用先选出场的、不带段落）；剧本定稿以后 AI 一次提炼梗概、人物、道具、场景、段落，人改或批注交回 AI 改。项目读写都在内存里，不碰真项目。
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
const outPath = P('定稿的剧本', '第1段', '第1段_提炼.json');
const notePath = P('定稿的剧本', '第1段', '第1段_提炼_批注.md');
const SCRIPT = '第1段｜吃面\n正文\n△ 老李端起碗。\n老李：烫！';
const fail = code => Object.assign(new Error(code), { code });

function setup(scene, more = {}) {
  const files = new Map([[flowPath, Buffer.from(JSON.stringify({ 梗概: '小面摊', 人物: [{ 名: '老李', 描写: '五十岁' }], 道具: [{ 名: '面碗', 描写: '白瓷大碗' }], 场景: '面摊：路边一个小面摊', 场: [scene, { 段: '2', 名: '吵架', 表达: '老李和老婆吵' }] }))]]);
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
const scene = extra => ({ 段: '1', 名: '吃面', 表达: '老李嘴硬心软', 人物: [], 道具: [], 剧本定稿: FIN, ...extra });
const job = extra => ({ 项目: '测试', 段: '1', 渠道: 'self', ...extra });
const script = { [scriptPath]: { text: 'docx', mtime: finMs - 5000 } };
const REPLY = '好的\n' + JSON.stringify({ 梗概: ' 老李开面摊，嘴硬心软。 ', 人物: [{ 名: '老李', 描写: '五十岁' }, { 名: ' 小孩\n', 描写: '七八岁' }, { 名: '老李', 描写: '重复的' }, { 名: '', 描写: '没名字' }],
  道具: [{ 名: '面碗', 描写: '白瓷大碗' }], 场景: ['面摊：路边一个小面摊', '面摊：路边一个小面摊', ' '], 段落: [{ 写什么: '老李\n 端碗', 作用: ' 先让人看见他嘴硬 ' }, { 写什么: '', 作用: '' }, { 写什么: '烫着了', 作用: '心软露出来' }] });

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('AI 不写剧本（11-16 晚他定）：没有「扩写剧本」这件事；没写想写什么（新的一律没有），提炼任务书里不列那一行', async () => {
    const s = setup(scene({ 表达: '' }), script);
    assert.equal(s.K.扩写剧本, undefined);
    const book = await s.K.提炼.book(job());
    assert.ok(book.includes(SCRIPT));
    assert.doesNotMatch(book, /这一段想写什么|没写想写什么/);
  });

  await check('提炼：剧本没定稿、定稿后又改过剧本、没有剧本，都不提炼', async () => {
    await assert.rejects(setup(scene({ 剧本定稿: '' }), script).K.提炼.book(job()), /剧本定稿以后才能提炼/);
    await assert.rejects(setup(scene(), { [scriptPath]: { text: 'docx', mtime: finMs + 60e3 } }).K.提炼.book(job()), /剧本定稿以后才能提炼/);
    await assert.rejects(setup(scene()).K.提炼.book(job()), /还没有剧本/);
  });

  await check('提炼：任务书带定稿的剧本、现在的全片设定、别的段；回的去掉空的和重名的，写进 第N段_提炼.json，旧的一份收进历史记录', async () => {
    const s = setup(scene(), { ...script, [outPath]: { text: '{"段落": [{"写什么": "旧", "作用": "旧"}]}' } });
    const book = await s.K.提炼.book(job());
    assert.ok(book.includes(SCRIPT) && book.includes('这一段想写什么：老李嘴硬心软'));
    assert.ok(book.includes('老李：五十岁') && book.includes('面摊：路边一个小面摊'));   // 全片设定里有的给 AI 照抄
    assert.ok(book.includes('第2段 吵架：老李和老婆吵'));   // 别的段：写全片梗概用
    const r = await s.K.提炼.apply(job(), REPLY);
    assert.match(r.结果, /人物 2 个、道具 1 样、场景 1 处、段落 2 段/);
    assert.equal(JSON.stringify(r.产出), JSON.stringify(['定稿的剧本/第1段/第1段_提炼.json']));
    const got = s.json(outPath);
    assert.equal(got.梗概, '老李开面摊，嘴硬心软。');
    assert.deepEqual(got.人物, [{ 名: '老李', 描写: '五十岁' }, { 名: '小孩', 描写: '七八岁' }]);
    assert.deepEqual(got.场景, ['面摊：路边一个小面摊']);
    assert.deepEqual(got.段落, [{ 写什么: '老李 端碗', 作用: '先让人看见他嘴硬' }, { 写什么: '烫着了', 作用: '心软露出来' }]);
    assert.ok(got.时间 && got.渠道 === 'self');
    const old = s.hist(['定稿的剧本', '第1段']);
    assert.equal(old.length, 1); assert.match(path.basename(old[0]), /^第1段_提炼__\d{8}-\d{6}\.json$/);
  });

  await check('提炼：AI 没按格式回（一段段落都没有），不写文件', async () => {
    const s = setup(scene(), script);
    await assert.rejects(s.K.提炼.apply(job(), '{"梗概": "有", "段落": [{"写什么": " ", "作用": ""}]}'), /段落至少一段/);
    await assert.rejects(s.K.提炼.apply(job(), '提炼不了'), /JSON/);
    assert.ok(!s.files.has(outPath));
  });

  await check('提炼按批注改：没有批注文件不起；任务书带现在的提炼（描写从全片表里取）和批注；改完批注收进历史记录', async () => {
    const paras = [{ 写什么: '老李端碗', 作用: '嘴硬' }, { 写什么: '烫着了', 作用: '心软' }];
    const now = scene({ 段落: paras, 人物: ['老李'], 道具: ['面碗'], 场景文字: ['面摊：路边一个小面摊'] });
    await assert.rejects(setup(now, script).K.提炼按批注改.prep(job()), /批注文件不在了/);
    const s = setup(now, { ...script, [notePath]: { text: '## 人物「老李」\n批注：他六十了' } });
    const j = job(); await s.K.提炼按批注改.prep(j);
    const book = await s.K.提炼按批注改.book(j);
    assert.ok(book.includes('"描写": "五十岁"') && book.includes('"写什么": "老李端碗"') && book.includes('面摊：路边一个小面摊'));
    assert.ok(book.includes('他六十了') && book.includes(SCRIPT));
    await s.K.提炼按批注改.apply(j, REPLY);
    assert.equal(s.json(outPath).段落.length, 2);
    assert.ok(!s.files.has(notePath));
    assert.ok(s.hist(['定稿的剧本', '第1段']).some(p => /第1段_提炼_批注__\d{8}-\d{6}\.md$/.test(p)));
  });

  await check('提炼按批注改：这一段还没提炼过就不改', async () => {
    const s = setup(scene({ 段落: [] }), { ...script, [notePath]: { text: '批注' } });
    const j = job(); await s.K.提炼按批注改.prep(j);
    await assert.rejects(s.K.提炼按批注改.book(j), /还没有提炼/);
  });

  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exit(1); });
