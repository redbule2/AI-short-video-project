'use strict';
// node 通用工具/测试/先写提示词_任务测试.js
// 先写提示词的段（2026-11-21 他定）：没有剧本，人先写一段自由模式的提示词（提示词/第N段/自由稿.txt），点「提炼分镜」记成这一场的「剧本定稿」，
// AI 照自由稿提炼分镜；分镜「定下来」以后才出资产图、照镜头表交给 AI 写完。服务这头在 prompt-first.js。所有读写都在内存里，不碰真项目。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const Core = require('../公用/核心.js');
const AL = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const backend = path.join(AL, 'jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const makePF = require(path.join(AL, 'prompt-first.js'));
const makeStore = require(path.join(AL, 'draft-store.js'));
const root = path.resolve(__dirname, '__内存测试根__');
const P = (...a) => path.join(root, '项目', '测试', ...a);
const flowPath = P('定稿的剧本', '流水线.json'), docxPath = P('定稿的剧本', '第1段', '第1段_剧本.docx');
const freePath = P('提示词', '第1段', '自由稿.txt'), freeSide = P('提示词', '第1段', '自由稿_写稿.json');
const promptPath = P('提示词', '第1段', '1-2.txt'), sidePath = promptPath.replace(/\.txt$/, '_写稿.json');
const FREE = '夜里面摊。小男孩盯着锅咽口水。\n周师傅下了一把面，端到他面前：“吃吧，不要钱。”近景跟着碗。\n小男孩埋头吃，老周看着笑。';
const SCRIPT = '第1段｜面摊\n正文\n△ 老周端起碗。';
const FIN = '2026-11-21 06:00:00', finMs = Date.parse('2026-11-21T06:00:00'), DONE = '2026-11-21 06:10:00';
const ROWS = [{ 号: '1', 写什么: '小男孩咽口水', 作用: '交代｜孩子饿了' }, { 号: '2', 写什么: '老周端面', 作用: '转折｜老周心软，接镜1' }, { 号: '3', 写什么: '埋头吃面', 作用: '收尾｜暖起来，接镜2' }];
const scene = extra => ({ 段: '1', 名: '面摊', 先写提示词: true, 人物: ['老周'], 道具: [], 场景图: [], 段落: ROWS, 剧本定稿: FIN, 头回定稿: FIN, 定稿: DONE, ...extra });
const oldWay = extra => { const s = scene(extra); delete s.先写提示词; return s; };   // 先写剧本的段（老路）
const job = extra => ({ 项目: '测试', 段: '1', 渠道: 'self', ...extra });
const free = (mtime = finMs - 5000) => ({ [freePath]: { text: FREE, mtime } });
const docx = { [docxPath]: { text: 'docx', mtime: finMs - 5000 } };
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

function setup(sc, more = {}) {   // more：{ 路径: { text, mtime } }
  const files = new Map(), mt = new Map();
  let clock = 1;
  const put = (p, data, m) => { files.set(p, Buffer.from(data)); mt.set(p, m || clock++); };
  put(flowPath, JSON.stringify({ 梗概: '', 人物: [{ 名: '老周', 描写: '六十岁，白围裙' }], 道具: [], 场景: '', 场: [sc] }));
  for (const [p, v] of Object.entries(more)) put(p, v.text, v.mtime);
  const spawned = [];
  const mockFs = {
    existsSync: p => files.has(p),
    promises: {
      async readFile(p, encoding) {
        if (String(p).endsWith('SKILL.md')) return '测试技能';
        if (!files.has(p)) throw enoent();
        return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p));
      },
      async stat(p) { if (!files.has(p)) throw enoent(); return { mtimeMs: mt.get(p) || 0 }; },
      async mkdir() {},
      async readdir(p, o) {   // 照内存里的文件列出这一层
        const dir = path.resolve(p), got = new Map();
        for (const f of files.keys()) { const r = path.relative(dir, f); if (!r || r.startsWith('..') || path.isAbsolute(r)) continue; const parts = r.split(path.sep); got.set(parts[0], parts.length > 1); }
        if (!got.size) throw enoent();
        return o && o.withFileTypes ? [...got].map(([name, d]) => ({ name, isDirectory: () => d, isFile: () => !d })) : [...got.keys()];
      },
      async writeFile(p, data, opts) { if (opts && opts.flag === 'wx' && files.has(p)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); put(p, data); },
      async rename(from, to) { if (!files.has(from)) throw enoent(); put(to, files.get(from)); files.delete(from); },
      async copyFile(from, to) { if (!files.has(from)) throw enoent(); put(to, files.get(from)); },
      async unlink(p) { files.delete(p); },
    },
  };
  const spawn = (cmd, args) => {   // 读剧本 Word 的子进程：照原样吐出 SCRIPT（先写提示词的段不该叫它）
    spawned.push(args);
    if (!(args && args[1] === '读' && files.has(args[2]))) throw Error('测试不能调用外部程序：' + (args || []).join(' '));
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
    setImmediate(() => { child.stdout.emit('data', Buffer.from(SCRIPT + '\n')); child.exitCode = 0; child.emit('close', 0); });
    return child;
  };
  const box = { module: { exports: {} }, __dirname: AL, Buffer, process, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : require(name.startsWith('.') ? path.resolve(AL, name) : name) };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  return { K: api.KINDS, files, spawned, raw: () => files.get(promptPath).toString() };
}

/* 提示词页「照自由稿，交给 AI 写完」建的新稿：事件脚本先放整份自由稿，写稿资料记「自由」 */
const BODY = FREE.split('\n').join('\r\n');
const RAW = ['【生成目标】', '', '【事件脚本】', BODY].join('\r\n');
const draft = () => ({ [promptPath]: { text: RAW }, [sidePath]: { text: JSON.stringify({ 写法: '自由', 写法范围: '分镜', 分镜稿: RAW, 自由稿: BODY, 镜头信息: [], 手写: true }) } });
const Z1 = ['机位/景别/角度：中景，平视。', '本镜调用：小男孩。', '小节一', '动作/表情：小男孩盯着锅里的热气咽口水。', '音效：<锅里咕嘟声>。', '镜头：固定。', '台词：无', '切点：咽口水时切。'];
const Z2 = ['机位/景别/角度：近景，过肩。', '本镜调用：老周；小男孩。', '小节一', '动作/表情：老周下了一把面，端到他面前。', '音效：<碗放到桌上的轻响>。', '镜头：跟着碗走。', '台词：老周说{吃吧，不要钱。}', '切点：碗落桌时切。'];
const REPLY = ['【标题】', '镜头1：孩子咽口水', '镜头2：老周端面', '【合并】', '镜头1：中景，小男孩盯着锅咽口水。', '镜头2：近景，老周端面过来，说{吃吧，不要钱。}',
  '【分区】', '镜头1：', ...Z1, '', '镜头2：', ...Z2, '', '【生成目标】', '夜里面摊，老周给饿肚子的小男孩端来一碗面。', '【素材】', '【参考素材职责】', '（这一段还没有资产图）',
  '【基础设定】', '影像风格：写实电影感。', '摄影：手持跟拍。', '光色基调：夜里暖黄灯泡。', '【主体与关系】', '老周在锅后面，小男孩站在摊前。', '【保持一致】', '保持老周的白围裙稳定。',
  '【声音】', '声音包括锅里咕嘟声、碗放到桌上的轻响。', '【素材登记】', '[]', '【秒数】', '镜头1：3', '镜头2：4'].join('\n');

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('核心：自由稿叫 自由稿.txt；「先写提示词」是 true 才算；自由稿不算视频提示词', async () => {
    assert.equal(Core.PF_FILE, '自由稿.txt');
    assert.equal(Core.isPF({ 先写提示词: true }), true);
    for (const s of [{ 先写提示词: 'true' }, { 先写提示词: 1 }, {}, null, undefined]) assert.equal(Core.isPF(s), false);
    assert.equal(Core.RE_VP.test(Core.PF_FILE), false, '提示词页、写稿页的清单里不该把自由稿当成一条提示词');
  });

  await check('核心：段全是先写提示词的才换表头叫法（一段都没有、混着的不换）；自由稿没建、建了没写字算「还没写」，写了没提炼、提炼过、提炼后又改过分得开', async () => {
    assert.equal(Core.pfAll([]), false);
    assert.equal(Core.pfAll(null), false);
    assert.equal(Core.pfAll([scene(), oldWay({ 段: '2' })]), false);
    assert.equal(Core.pfAll([scene(), scene({ 段: '2' })]), true);
    assert.deepEqual(Core.pfState(null, ''), { st: 'none' });
    assert.deepEqual(Core.pfState(null, FIN), { st: 'none' });
    assert.deepEqual(Core.pfState({ mtime: finMs + 60000, size: 0 }, FIN), { st: 'none' }, '剧本页点「写自由稿」先建一个空文件');
    assert.deepEqual(Core.pfState({ mtime: finMs - 5000, size: 30 }, ''), { st: 'ok', again: false });
    assert.deepEqual(Core.pfState({ mtime: finMs - 5000, size: 30 }, FIN), { st: 'final' });
    assert.deepEqual(Core.pfState({ mtime: finMs + 999, size: 30 }, FIN), { st: 'final' }, '点提炼的时间只记到秒');
    assert.deepEqual(Core.pfState({ mtime: finMs + 60000, size: 30 }, FIN), { st: 'ok', again: true });
    assert.deepEqual(Core.pfState({ mtime: finMs - 5000 }, FIN), { st: 'final' }, '不知道大小的照写了算');
    assert.deepEqual(Core.pfState({ mtime: finMs + 60000 }, ''), { st: 'ok', again: false });
  });

  await check('prompt-first.js：先写提示词的段从自由稿读；任务书标题下面说一句「剧本」指自由稿，提炼的再交代叫法和镜头；别的段、没说剧本的任务书照旧', async () => {
    const flows = { 测试: { 场: [scene(), oldWay({ 段: '2' })] } };
    const pf = makePF({ Core, pj: (n, ...a) => path.join(root, '项目', n, ...a), segDir: s => '第' + s + '段', scriptPath: (n, s) => path.join(root, '项目', n, '定稿的剧本', '第' + s + '段', '第' + s + '段_剧本.docx'),
      readFlow: async n => { if (!flows[n]) throw enoent(); return flows[n]; }, sceneOf: (f, seg) => f.场.find(x => x.段 === seg) || null });
    assert.equal(pf.srcPath('测试', scene(), '1'), freePath);
    assert.equal(pf.srcPath('测试', oldWay({ 段: '2' }), '2'), P('定稿的剧本', '第2段', '第2段_剧本.docx'));
    const book = '# 任务：照定稿的剧本写字\n\n正文';
    assert.equal(await pf.lead({ 项目: '测试', 段: '1', 事: '写字' }, book), '# 任务：照定稿的剧本写字\n\n' + pf.NOTE + '\n\n正文');
    const d = await pf.lead({ 项目: '测试', 段: '1', 事: '提炼按批注改' }, book);
    assert.ok(d.includes(pf.NOTE + '提炼时：') && d.includes('同一个人换了叫法') && d.includes('机位、运镜、声音不写进镜头表'));
    for (const [j, b] of [[{ 项目: '测试', 段: '2', 事: '写字' }, book], [{ 项目: '测试', 段: '1', 事: '出图' }, '# 出图\n照字出'], [{ 项目: '测试', 事: '写字' }, book], [{ 项目: '没有', 段: '1', 事: '写字' }, book], [{ 项目: '测试', 段: '1' }, { 不是: '字' }]])
      assert.deepEqual(await pf.lead(j, b), b);
    const K = { 甲: { book: async () => '# 照剧本\n正文' }, 乙: { run() {} }, 丙: null };
    pf.wrap(K); const once = K.甲.book; pf.wrap(K);
    assert.equal(K.甲.book, once, '包过的不再包');
    assert.match(await K.甲.book({ 项目: '测试', 段: '1', 事: '甲' }), /^# 照剧本\n\n注意：这一段没有剧本/);
  });

  await check('提炼：照自由稿提炼（不读 Word），任务书标题下面带说明；重新提炼的也带', async () => {
    const s = setup(scene({ 段落: [], 定稿: '' }), { ...free(), ...docx });
    const book = await s.K.提炼.book(job({ 事: '提炼' }));
    assert.ok(book.includes(FREE) && !book.includes(SCRIPT), '有 Word 也照自由稿');
    assert.ok(book.split('\n')[2].startsWith('注意：这一段没有剧本') && book.includes('同一个人换了叫法'));
    assert.equal(s.spawned.length, 0, '自由稿直接读，不叫读 Word 的程序');
    const t = setup(scene({ 定稿: '' }), free());
    const again = await t.K.提炼.book(job({ 事: '提炼' }));
    assert.ok(again.includes(FREE) && again.split('\n')[2].startsWith('注意：这一段没有剧本'));
  });

  await check('提炼：没有自由稿、没点「提炼分镜」、点了以后自由稿又改过，都不提炼', async () => {
    await assert.rejects(setup(scene()).K.提炼.book(job({ 事: '提炼' })), /这一段还没有自由稿/);
    await assert.rejects(setup(scene({ 剧本定稿: '' }), free()).K.提炼.book(job({ 事: '提炼' })), /自由稿写好、点了「提炼分镜」才能提炼/);
    await assert.rejects(setup(scene(), free(finMs + 60e3)).K.提炼.book(job({ 事: '提炼' })), /自由稿写好、点了「提炼分镜」才能提炼/);
  });

  await check('先写剧本的段照旧：读 Word，任务书不提自由稿；没有剧本还是「还没有剧本」', async () => {
    const s = setup(oldWay({ 段落: [], 定稿: '' }), docx);
    const book = await s.K.提炼.book(job({ 事: '提炼' }));
    assert.ok(book.includes(SCRIPT));
    assert.doesNotMatch(book, /这一段没有剧本|自由稿/);
    await assert.rejects(setup(oldWay(), free()).K.提炼.book(job({ 事: '提炼' })), /这一段还没有剧本/);
  });

  await check('写字、出图（11-21 乙 A）：先写提示词的段分镜定下来了才做，自由稿改过没核对的也不做；先写剧本的段照旧只看剧本定稿', async () => {
    const probe = (sc, more) => setup(sc, more).K.影响清单.book(job({ 事: '影响清单' }));   // 影响清单头一步就是这一关：过了关，接着找历史记录里的旧剧本
    await assert.rejects(probe(scene({ 定稿: '' }), free()), /分镜定下来以后才能写字、出图/);
    await assert.rejects(probe(scene(), free(finMs + 60e3)), /分镜定下来以后才能写字、出图（自由稿改过的/);
    await assert.rejects(probe(scene(), free()), /历史记录里找不到改之前的剧本/);
    await assert.rejects(probe(oldWay({ 定稿: '' }), docx), /历史记录里找不到改之前的剧本/);
  });

  await check('各样事的任务书都包上了（服务里没有漏的）', async () => {
    const s = setup(scene(), free());
    const bare = Object.entries(s.K).filter(([, K]) => K && typeof K.book === 'function' && !K.book.pf).map(([k]) => k);
    assert.deepEqual(bare, []);
  });

  await check('交给 AI 写完：照镜头表拆这一条的几镜、戏照自由稿；任务书带说明、事件脚本是照自由稿备的', async () => {
    const s = setup(scene(), { ...free(), ...draft() }), j = job({ 事: '写完提示词', 名: '1-2.txt' });
    await s.K.写完提示词.prep(j);
    const book = await s.K.写完提示词.book(j);
    assert.ok(book.split('\n')[2].startsWith('注意：这一段没有剧本'));
    assert.ok(book.includes('照镜头表拆：这一条拍镜头表里的镜头 1、2（') && book.includes('镜头1 是镜头表的镜头1') && book.includes('台词原话、机位、运镜、声音都带上'));
    assert.ok(book.includes('## 人写的事件脚本（照自由稿备的；这一条只写上面说的那几镜）\n' + FREE + '\n'));
    assert.doesNotMatch(book, /照人写的来：/);
    assert.equal(s.spawned.length, 0);
    assert.equal(j.拆, true);
    const r = await s.K.写完提示词.apply(j, REPLY), out = s.raw();
    assert.match(r.结果, /^写好了：拆成 2 镜/);
    assert.ok(out.includes('【事件脚本】\r\n镜头1：\r\n机位/景别/角度：中景，平视。\r\n') && out.includes('台词：老周说{吃吧，不要钱。}'));
    assert.ok(!out.includes('夜里面摊。小男孩盯着锅咽口水。'), '自由稿换成了分镜');
  });

  await check('交给 AI 写完：分镜没定下来、自由稿改过没核对的，都不交', async () => {
    await assert.rejects(setup(scene({ 定稿: '' }), { ...free(), ...draft() }).K.写完提示词.prep(job({ 事: '写完提示词', 名: '1-2.txt' })), /分镜定下来以后才能交给 AI 写完：先到「提炼分镜」那一步点「定下来」/);
    await assert.rejects(setup(scene(), { ...free(finMs + 60e3), ...draft() }).K.写完提示词.prep(job({ 事: '写完提示词', 名: '1-2.txt' })), /分镜定下来以后才能交给 AI 写完（自由稿改过的/);
  });

  await check('写稿页存自由稿：服务传了 PF_FILE 才认 自由稿.txt；别的名字、老服务照旧不认', async () => {
    const files = new Map(); let clock = 1;
    const io = {
      put(p, c) { files.set(p, { buf: Buffer.from(c), mtimeMs: ++clock }); },
      async readFile(p) { if (!files.has(p)) throw enoent(); return Buffer.from(files.get(p).buf); },
      async writeFile(p, b, o) { if (o && o.flag === 'wx' && files.has(p)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); this.put(p, b); },
      async rename(a, b) { this.put(b, await this.readFile(a)); files.delete(a); },
      async unlink(p) { if (!files.delete(p)) throw enoent(); },
      async stat(p) { if (!files.has(p)) throw enoent(); return { mtimeMs: files.get(p).mtimeMs }; },
      async mkdir() {},
    };
    const side0 = { 说明: '写稿页的过程文件', 写法: '自由', 手写: true };
    io.put(freePath, ''); io.put(freeSide, JSON.stringify(side0));
    const body = { text: FREE, baseText: '', sidePatch: { 写法: '自由', 自由稿: FREE }, baseEditor: makeStore.pickEditor(side0) };
    const store = makeStore({ ROOT: root, io, PF_FILE: Core.PF_FILE, now: () => new Date(2026, 10, 21, 6, 0, 0) });
    await store.save(freePath, body);
    assert.equal(files.get(freePath).buf.toString(), FREE);
    const side = JSON.parse(files.get(freeSide).buf.toString());
    assert.deepEqual([side.说明, side.写法, side.自由稿, side.手写], ['写稿页的过程文件', '自由', FREE, true]);
    await assert.rejects(store.save(P('提示词', '第1段', '笔记.txt'), body), /草稿保存只支持/);
    await assert.rejects(makeStore({ ROOT: root, io }).save(freePath, { ...body, baseText: FREE }), /草稿保存只支持/);
  });

  console.log('先写提示词：' + tested + ' 项都过了');
})().catch(e => { console.error(e); process.exit(1); });
