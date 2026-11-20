'use strict';
// node 通用工具/测试/提炼_任务测试.js
// 11-16 他定：第一步直接写剧本（不用先选出场的、不带段落）；剧本定稿以后 AI 一次提炼梗概、人物、道具、场景、段落，人改或批注交回 AI 改。项目读写都在内存里，不碰真项目。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
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
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  const hist = dir => [...files.keys()].filter(p => p.startsWith(P('历史记录', ...dir)));
  return { K: api.KINDS, files, hist, json: p => JSON.parse(files.get(p).toString()) };
}

const FIN = '2026-11-16 10:00:00', finMs = Date.parse('2026-11-16T10:00:00');
const scene = extra => ({ 段: '1', 名: '吃面', 表达: '老李嘴硬心软', 人物: [], 道具: [], 剧本定稿: FIN, ...extra });
const job = extra => ({ 项目: '测试', 段: '1', 渠道: 'self', ...extra });
const script = { [scriptPath]: { text: 'docx', mtime: finMs - 5000 } };
const REPLY = '好的\n' + JSON.stringify({ 梗概: ' 老李开面摊，嘴硬心软。 ', 人物: [{ 名: '老李', 描写: '五十岁' }, { 名: ' 小孩\n', 描写: '七八岁' }, { 名: '老李', 描写: '重复的' }, { 名: '', 描写: '没名字' }],
  道具: [{ 名: '面碗', 描写: '白瓷大碗' }], 场景: ['面摊：路边一个小面摊', '面摊：路边一个小面摊', ' '], 镜头表: [{ 写什么: '老李\n 端碗', 作用: ' 先让人看见他嘴硬 ' }, { 写什么: '', 作用: '' }, { 写什么: '烫着了', 作用: '心软露出来' }] });

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
    assert.ok(book.includes('5. 镜头表：') && book.includes('"镜头表": [') && !book.includes('段落'));   // 11-16：段落改叫镜头表
    const r = await s.K.提炼.apply(job(), REPLY);
    assert.match(r.结果, /人物 2 个、道具 1 样、场景 1 处、镜头表 2 个镜头/);
    assert.equal(JSON.stringify(r.产出), JSON.stringify(['定稿的剧本/第1段/第1段_提炼.json']));
    const got = s.json(outPath);
    assert.equal(got.梗概, '老李开面摊，嘴硬心软。');
    assert.deepEqual(got.人物, [{ 名: '老李', 描写: '五十岁' }, { 名: '小孩', 描写: '七八岁' }]);
    assert.deepEqual(got.场景, ['面摊：路边一个小面摊']);
    assert.deepEqual(got.镜头表, [{ 写什么: '老李 端碗', 作用: '先让人看见他嘴硬' }, { 写什么: '烫着了', 作用: '心软露出来' }]);
    assert.ok(got.时间 && got.渠道 === 'self');
    const old = s.hist(['定稿的剧本', '第1段']);
    assert.equal(old.length, 1); assert.match(path.basename(old[0]), /^第1段_提炼__\d{8}-\d{6}\.json$/);
  });

  await check('提炼：AI 没按格式回（一个镜头都没有），不写文件', async () => {
    const s = setup(scene(), script);
    await assert.rejects(s.K.提炼.apply(job(), '{"梗概": "有", "镜头表": [{"写什么": " ", "作用": ""}]}'), /镜头表至少一个镜头/);
    await assert.rejects(s.K.提炼.apply(job(), '提炼不了'), /JSON/);
    assert.ok(!s.files.has(outPath));
  });

  await check('提炼：AI 照老叫法回「段落」也认，写进文件叫「镜头表」', async () => {
    const s = setup(scene(), script);
    await s.K.提炼.apply(job(), '{"梗概": "有", "段落": [{"写什么": "端碗", "作用": "嘴硬"}]}');
    assert.deepEqual(s.json(outPath).镜头表, [{ 写什么: '端碗', 作用: '嘴硬' }]);
    assert.equal(s.json(outPath).段落, undefined);
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
    assert.equal(s.json(outPath).镜头表.length, 2);
    assert.ok(!s.files.has(notePath));
    assert.ok(s.hist(['定稿的剧本', '第1段']).some(p => /第1段_提炼_批注__\d{8}-\d{6}\.md$/.test(p)));
  });

  await check('镜头表的作用和秒数（11-16）：要求里写作用的格式、按排第几认镜N、估秒数；回的秒数取整，重新提炼不留 AI 写的号', async () => {
    const s = setup(scene(), script);
    const book = await s.K.提炼.book(job());
    assert.ok(book.includes('二十个字以内') && book.includes('标签｜目的，关系') && book.includes('排第几') && book.includes('"秒数": 3'));
    assert.ok(!book.includes('不写机位、运镜、时长'));
    await s.K.提炼.apply(job(), JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: '端碗', 作用: '铺垫｜为镜2', 秒数: 2.4 }, { 号: '2', 写什么: '烫着', 作用: '转折｜接镜1', 秒数: '' }] }));
    assert.deepEqual(s.json(outPath).镜头表, [{ 写什么: '端碗', 作用: '铺垫｜为镜2', 秒数: 2 }, { 写什么: '烫着', 作用: '转折｜接镜1' }]);
  });

  await check('提炼按批注改（11-16）：现在的镜头表带号、秒数、人定；要求照抄号、人定的秒数；回的号照写（11-18：重了也照写，页面看号不对就照字认，镜N 照 AI 写的号换）', async () => {
    const paras = [{ 号: '1', 写什么: '老李端碗', 作用: '铺垫｜为镜3', 秒数: 3, 秒数人定: true }, { 号: '3', 写什么: '烫着了', 作用: '', 秒数: 2 }];
    const s = setup(scene({ 段落: paras }), { ...script, [notePath]: { text: '## 整体\n批注：只补秒数' } });
    const j = job(); await s.K.提炼按批注改.prep(j);
    const book = await s.K.提炼按批注改.book(j);
    assert.ok(book.includes('"号": "1"') && book.includes('"号": "3"') && book.includes('"秒数人定": true') && book.includes('"秒数": 2'));
    assert.ok(book.includes('原有的照抄') && book.includes('3b') && book.includes('标了「秒数人定」的是人定的') && book.includes('镜N 的 N 是镜头的「号」'));
    await s.K.提炼按批注改.apply(j, JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: '老李端碗', 作用: '铺垫｜为镜3', 秒数: 3 }, { 号: '1b', 写什么: '吹一吹', 作用: '反应｜接镜1', 秒数: 1 }, { 号: '3', 写什么: '烫着了', 作用: '转折｜接镜1b', 秒数: 2 }] }));
    assert.deepEqual(s.json(outPath).镜头表.map(x => x.号), ['1', '1b', '3']);
    const s2 = setup(scene({ 段落: paras }), { ...script, [notePath]: { text: '批注' } });
    const j2 = job(); await s2.K.提炼按批注改.prep(j2);
    await s2.K.提炼按批注改.apply(j2, JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: 'a', 作用: '' }, { 号: '1', 写什么: 'b', 作用: '' }] }));
    assert.deepEqual(s2.json(outPath).镜头表.map(x => x.号), ['1', '1']);
  });

  await check('全局、每一镜出场的（11-17）：要求里多 7、8 两条，回复的样子带「全局」和每一镜的人物场景道具；全片设定列出全局；人删掉的叫 AI 别再列', async () => {
    const s = setup(scene({ 人物: ['老李'], 道具: ['面碗'], 删掉: ['人物|小孩', '道具|面碗'] }), script);
    const book = await s.K.提炼.book(job());
    assert.ok(book.includes('\n7. 镜头表每个镜头再写三个列表：「人物」「场景」「道具」') && book.includes('\n8. 「全局」：'));
    assert.ok(book.includes('"全局": {"人物": ["……"], "场景": [], "道具": []}, "镜头表": [') && book.includes('"秒数": 3, "人物": ["……"], "场景": ["……"], "道具": []}'));
    assert.ok(book.includes('全局（全片好几段都出场的）：人物：（没有）；场景：（没有）；道具：（没有）'));
    assert.ok(book.includes('\n9. 人删掉了、这一段用不着的，别再列，镜头里也别写：人物「小孩」\n'));   // 面碗还在出场的里头：又加回来了，不算删掉
    const plain = await setup(scene(), script).K.提炼.book(job());
    assert.ok(!plain.includes('人删掉了') && !plain.includes('\n9. '));
  });

  await check('提炼回的（11-17）：每一镜出场的、全局照写进 第N段_提炼.json（场景记地方名、去重）；没回全局就不写', async () => {
    const s = setup(scene(), script);
    await s.K.提炼.apply(job(), JSON.stringify({ 梗概: '有', 人物: [{ 名: '老李', 描写: '五十岁' }], 场景: ['面摊：路边'], 全局: { 人物: ['老李'], 场景: ['面摊：路边'] },
      镜头表: [{ 写什么: '端碗', 作用: '', 人物: ['老李', '老李'], 场景: ['面摊：路边'], 道具: [] }, { 写什么: '烫着', 作用: '' }] }));
    const got = s.json(outPath);
    assert.deepEqual(got.全局, { 人物: ['老李'], 场景: ['面摊'], 道具: [] });
    assert.deepEqual(got.镜头表, [{ 写什么: '端碗', 作用: '', 人物: ['老李'], 场景: ['面摊'] }, { 写什么: '烫着', 作用: '' }]);
    assert.equal(got.照批注改, undefined);
    await s.K.提炼.apply(job(), '{"梗概": "有", "镜头表": [{"写什么": "端碗", "作用": ""}]}');
    assert.equal(s.json(outPath).全局, undefined);
  });

  await check('提炼按批注改（11-17）：现在的提炼带全局、每一镜出场的；要求原有的照抄、还没标的补上；回的记一笔「照批注改」（人删掉的又列回来，页面就认）', async () => {
    const paras = [{ 号: '1', 写什么: '老李端碗', 作用: '', 人物: ['老李'], 场景: ['面摊'] }, { 号: '2', 写什么: '烫着了', 作用: '' }];
    const s = setup(scene({ 段落: paras, 人物: ['老李'], 道具: ['面碗'], 场景文字: ['面摊：路边一个小面摊'] }), { ...script, [notePath]: { text: '## 整体\n批注：只标两样' } });
    const j = job(); await s.K.提炼按批注改.prep(j);
    const book = await s.K.提炼按批注改.book(j);
    const now = JSON.parse(book.split('## 现在的提炼\n')[1].split('\n\n## 批注')[0]);
    assert.deepEqual(now.全局, { 人物: [], 场景: [], 道具: [] });
    assert.deepEqual(now.镜头表.map(x => [x.人物, x.场景, x.道具]), [[['老李'], ['面摊'], undefined], [undefined, undefined, undefined]]);
    assert.ok(book.includes('\n8. 镜头的「人物」「场景」「道具」和「全局」：原有的照抄，批注说到的照改；还没标的、新加的照这个标：'));
    assert.ok(book.includes('全局（全片好几段都出场的）：'));
    await s.K.提炼按批注改.apply(j, JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: '老李端碗', 作用: '', 人物: ['老李'] }] }));
    assert.equal(s.json(outPath).照批注改, true);
    assert.deepEqual(s.json(outPath).镜头表, [{ 号: '1', 写什么: '老李端碗', 作用: '', 人物: ['老李'] }]);
  });

  await check('挂了场景图的（11-17）：提炼、提炼按批注改的要求里告诉 AI 图名，镜头的「场景」能写图名，回的照写；没挂的不提', async () => {
    const paras = [{ 号: '1', 写什么: '老李端碗', 作用: '', 人物: ['老李'] }, { 号: '2', 写什么: '烫着了', 作用: '' }];
    const s = setup(scene({ 段落: paras, 人物: ['老李'], 场景图: ['资产/关键帧/第1段/镜头1_空镜.png', '资产/场景/面摊.png'] }), { ...script, [notePath]: { text: '批注' } });
    assert.ok((await s.K.提炼.book(job())).includes('\n9. 这一段挂了场景图，图名：镜头1_空镜、面摊。'));
    const j = job(); await s.K.提炼按批注改.prep(j);
    assert.ok((await s.K.提炼按批注改.book(j)).includes('\n9. 这一段挂了场景图，图名：镜头1_空镜、面摊。'));
    await s.K.提炼按批注改.apply(j, JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: '老李端碗', 作用: '', 人物: ['老李'], 场景: ['镜头1_空镜'] }, { 号: '2', 写什么: '烫着了', 作用: '' }] }));
    assert.deepEqual(s.json(outPath).镜头表[0].场景, ['镜头1_空镜']);
    const plain = setup(scene({ 段落: paras }), { ...script, [notePath]: { text: '批注' } }), j2 = job();
    await plain.K.提炼按批注改.prep(j2);
    assert.ok(!(await plain.K.提炼按批注改.book(j2)).includes('挂了场景图'));
  });

  await check('提炼按批注改：这一段还没提炼过就不改', async () => {
    const s = setup(scene({ 段落: [] }), { ...script, [notePath]: { text: '批注' } });
    const j = job(); await s.K.提炼按批注改.prep(j);
    await assert.rejects(s.K.提炼按批注改.book(j), /还没有提炼/);
  });

  const had = [{ 号: '1', 写什么: '老李端碗', 作用: '铺垫｜为镜3', 秒数: 3, 秒数人定: true }, { 号: '3', 写什么: '烫着了', 作用: '转折｜接镜1', 秒数: 2 }];
  const redoReply = JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: '老李端碗', 作用: '铺垫｜为镜3', 秒数: 3 }, { 号: '3', 写什么: '烫着了', 作用: '转折｜接镜1', 秒数: 2 }, { 号: '3b', 写什么: '老李吹碗', 作用: '反应｜接镜3', 秒数: 1 }] });
  await check('重新提炼（11-18）：已经有镜头表的，在现在的上面改：任务书带现在的提炼（号、人定的秒数），要求没变的照抄、号照抄、删掉的号不再用；回的号照写', async () => {
    const s = setup(scene({ 段落: had, 人物: ['老李'] }), script);
    const j = job(); await s.K.提炼.prep(j);
    const book = await s.K.提炼.book(j);
    assert.ok(book.includes('照定稿的剧本重新对一遍') && book.includes('"号": "3"') && book.includes('"秒数人定": true') && book.includes('"写什么": "老李端碗"'));
    assert.ok(book.includes('剧本里没变的戏：现在的提炼照抄') && book.includes('删掉的号不再用') && book.includes('0、0b') && book.includes('镜N 的 N 是镜头的「号」') && book.includes('"号": "1", "写什么"'));
    assert.ok(book.includes(SCRIPT) && !book.includes('## 批注'));
    const r = await s.K.提炼.apply(j, redoReply);
    assert.match(r.结果, /^重新提炼好了/);
    assert.deepEqual(s.json(outPath).镜头表.map(x => x.号), ['1', '3', '3b']);
    assert.equal(s.json(outPath).照批注改, undefined);   // 人删掉的又列回来：不是批注要加的，页面照旧不要
  });

  await check('重新提炼带批注（11-18）：页面传了批注、文件在，任务书带批注、要求一并照改，改完收进历史记录；没传批注（旧文件放着）、传了文件不在的，照没批注做', async () => {
    const files = { ...script, [notePath]: { text: '## 镜头1\n原文：写什么：老李端碗\n批注：改成老李捧碗' } };
    const s = setup(scene({ 段落: had }), files);
    const j = job({ 批注: '第1段_提炼_批注.md' }); await s.K.提炼.prep(j);
    const book = await s.K.提炼.book(j);
    assert.ok(book.includes('\n## 批注\n## 镜头1') && book.includes('改成老李捧碗') && book.includes('一并照改') && book.includes('除非批注说到这一镜的秒数'));
    await s.K.提炼.apply(j, redoReply);
    assert.ok(!s.files.has(notePath));
    assert.ok(s.hist(['定稿的剧本', '第1段']).some(p => /第1段_提炼_批注__\d{8}-\d{6}\.md$/.test(p)));
    const old = setup(scene({ 段落: had }), files), j0 = job(); await old.K.提炼.prep(j0);
    assert.ok(!(await old.K.提炼.book(j0)).includes('老李捧碗'));
    await old.K.提炼.apply(j0, redoReply);
    assert.ok(old.files.has(notePath));
    const none = setup(scene({ 段落: had }), script), j2 = job({ 批注: '第1段_提炼_批注.md' }); await none.K.提炼.prep(j2);
    assert.ok(!(await none.K.提炼.book(j2)).includes('## 批注'));
  });

  await check('第一回提炼带批注（11-18）：任务书带批注，要求照着办；照旧不留号', async () => {
    const s = setup(scene(), { ...script, [notePath]: { text: '## 整体\n批注：镜头别切太碎' } });
    const j = job({ 批注: '第1段_提炼_批注.md' }); await s.K.提炼.prep(j);
    const book = await s.K.提炼.book(j);
    assert.ok(book.includes('照定稿的剧本提炼梗概') && book.includes('\n9. 下面「批注」那一节是人写的要求') && book.includes('镜头别切太碎'));
    await s.K.提炼.apply(j, JSON.stringify({ 梗概: '有', 镜头表: [{ 号: '1', 写什么: '端碗', 作用: '' }] }));
    assert.deepEqual(s.json(outPath).镜头表, [{ 写什么: '端碗', 作用: '' }]);
    assert.ok(!s.files.has(notePath));
  });

  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exit(1); });
