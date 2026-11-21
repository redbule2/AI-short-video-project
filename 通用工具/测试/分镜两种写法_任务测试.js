'use strict';
// node 通用工具/测试/分镜两种写法_任务测试.js
// 分镜的两种写法（2026-11-20 他定：合并、分区两种都写；11-21 起分区为主、合并备选；shot-styles.js）。拆镜头在「交给 AI 写完」里（pe-finish.js）。所有读写都在内存文件系统里，不碰真项目。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Secs = require('../公用/秒数.js');
const PromptDraft = require('../公用/写稿状态.js'), Z = PromptDraft.Zoned;
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const at = (...p) => path.join(root, '项目', '测试', ...p);
const promptPath = at('提示词', '第1段', '1-2.txt'), sidePath = promptPath.replace(/\.txt$/, '_写稿.json'), mapPath = at('资产', '参考素材映射.json');
const KEY = '提示词/第1段/1-2.txt';
const job = () => ({ 项目: '测试', 段: '1', 名: '1-2.txt' });
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const shaOf = t => crypto.createHash('sha256').update(Buffer.from(t.replace(/^﻿/, '').replace(/\r\n?/g, '\n'), 'utf8')).digest('hex');

function setup(raw, side, opts = {}) {   // opts.spawn：要读剧本 Word 的（交给 AI 写完的任务书）给一个假的子进程
  const files = new Map(), mt = new Map();
  let clock = 1;
  const put = (p, data) => { files.set(p, Buffer.from(data)); mt.set(p, clock++); };
  if (raw != null) put(promptPath, raw);
  if (side) put(sidePath, typeof side === 'string' ? side : JSON.stringify(side));
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
    },
  };
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn: opts.spawn || (() => { throw Error('测试不能调用外部 AI'); }) } : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name) };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  return { K: api.KINDS, files, put, raw: () => files.get(promptPath).toString(), side: () => JSON.parse(files.get(sidePath).toString()),
    map: () => JSON.parse(files.get(mapPath).toString()).prompts[KEY], hist: end => [...files.keys()].filter(p => p.includes('历史记录') && p.endsWith(end)) };
}

/* 人随手写的一段（还没分镜）。新稿是自由模式写的：正文里只有空着的生成目标和这一段，写稿资料记着「自由」（11-21 起生成目标也归 AI） */
const PARA = '甲走到桌边拿起书，转身递给乙，乙接过来翻开。';
const SKEL = '【生成目标】\r\n\r\n【事件脚本】\r\n', manImg = '资产/人物和道具/甲.png';
const freeRaw = PromptDraft.withShotText(PromptDraft.parse(SKEL), PARA);
const freeSide = () => ({ 写法: '自由', 写法范围: '分镜', 分镜稿: SKEL, 自由稿: PARA, 镜头信息: [], 手写: true, 挂图: { '@图片1': manImg } });
/* 以前铺过底的：分镜模式，别的几块写好了，镜头外面还有一段没分镜的字 */
const handRaw = ['【生成目标】', '甲给乙递书。', '', '【参考素材职责】', '@图片1用于甲的五官和服装，不采用图片背景。', '', '【基础设定】', '影像风格：写实。', '摄影：跟拍。', '光色基调：暖黄台灯。', '',
  '【事件脚本】', PARA, '声音包括翻书声。', '', '【保持一致】', '保持书只有一本。', ''].join('\r\n');
const handSide = () => ({ 写法: '分镜', 写法范围: '分镜', 分镜稿: handRaw, 自由稿: '', 镜头信息: [], 手写: true, 挂图: { '@图片1': manImg } });
const M1 = ['中景，甲走到桌边拿起书，转身。'], M2 = ['近景，甲把书递给乙，乙接过来翻开，说{谢谢。}'];
const Z1 = ['机位/景别/角度：中景，平视。', '本镜调用：甲；书。', '画面构图：甲在画面左边，桌子在右边。', '环境音：屋里安静。', '进入状态：甲站在门口。',
  '小节一', '动作/表情：甲走到桌边拿起书，转身。', '音效：<脚步声>。', '镜头：跟着甲。', '台词：无', '退出状态：甲拿着书转过身。', '切点：甲转身时切。'];
const Z2 = ['机位/景别/角度：近景，过肩。', '本镜调用：甲；乙；书。', '小节一', '动作/表情：甲把书递给乙，乙接过来翻开。', '音效：<翻书声>。', '镜头：固定。', '台词：乙说{谢谢。}',
  '退出状态：乙低头看书。', '切点：书翻开时切。'];
const tidyReply = (z = [Z1, Z2]) => ['好的。', '【标题】', '镜头1：甲拿书', '镜头2：乙接书', '【合并】', '镜头1：' + M1[0], '镜头2：' + M2[0],
  '【分区】', ...z.flatMap((ls, i) => ['镜头' + (i + 1) + '：', ...ls, '']), '【秒数】', '镜头1：3', '镜头2：4'].join('\n');   // 只回分镜那几块和秒数
const REST = ['【生成目标】', '甲给乙递书。', '【素材】', '【参考素材职责】', '@图片1用于甲的五官和服装，不采用图片背景。', '【基础设定】', '影像风格：写实。', '摄影：跟拍。', '光色基调：暖黄台灯。',
  '【主体与关系】', '甲站在桌边，乙站在对面。', '【保持一致】', '保持书只有一本。', '【声音】', '声音包括翻书声。', '【素材登记】', JSON.stringify([{ ref: '@图片1', name: '甲', path: manImg }])].join('\n');
const fullReply = z => tidyReply(z).replace('【秒数】', REST + '\n【秒数】');   // 一次写完：分镜和别的几块都回
const regOf = () => JSON.stringify({ schema_version: 1, prompts: { [KEY]: { prompt_sha256: 'x', references: [{ ref: '@图片1', name: '甲', path: manImg }] } } });
const { EventEmitter } = require('node:events');
const fakeNode = out => () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { on() {}, end() {} }; setImmediate(() => { c.stdout.emit('data', Buffer.from(out)); c.emit('close', 0); }); return c; };   // 读剧本 Word 的那个子进程
const flowPath = at('定稿的剧本', '流水线.json'), scriptAt = at('定稿的剧本', '第1段', '第1段_剧本.docx');
function setupFree(raw = freeRaw, side = freeSide()) {   // 交给 AI 写完要剧本定稿：流水线、剧本、这一场能挂的图都放上
  const s = setup(raw, side, { spawn: fakeNode('第1段｜递书\n正文\n△ 甲把书递给乙。') });
  s.put(flowPath, JSON.stringify({ 人物: [{ 名: '甲', 资产: manImg }], 场: [{ 段: '1', 人物: ['甲'], 剧本定稿: '2026-11-19 00:00:00' }] }));
  s.put(scriptAt, 'docx'); s.put(at(...manImg.split('/')), 'png');
  return s;
}

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('交给 AI 写完（拆镜头）：任务书带人写的那段、两种写法的样子、写戏规矩，要写生成目标、要【秒数】', async () => {
    const s = setupFree(), j = job();
    await s.K.写完提示词.prep(j);
    const book = await s.K.写完提示词.book(j);
    assert.ok(book.includes('## 人写的事件脚本（要拆成分镜的就是它）\n' + PARA + '\n'));
    assert.ok(book.includes('【合并】\n镜头1：……') && book.includes('【分区】\n镜头1：\n机位/景别/角度：……') && book.includes('小节一\n动作/表情：……') && book.includes('【标题】'));
    assert.ok(book.includes('【生成目标】\n……') && book.includes('【秒数】') && book.includes('不写 @图片N') && book.includes('## 写戏规矩'));
    assert.ok(!book.includes('【判断】'), '头一回写不先判断');
    assert.equal(j.拆, true); assert.equal(j.已写, false); assert.match(j.底, /^[0-9a-f]{8}$/);
  });

  await check('交给 AI 写完（拆镜头）：分区放进提示词、合并记进写稿资料备选，别的几块一起写上；写稿资料换成分镜模式、人写的那段留在自由稿；留历史、记秒数、换校验值', async () => {
    const s = setupFree(), j = job();
    await s.K.写完提示词.book(j);
    const r = await s.K.写完提示词.apply(j, fullReply()), out = s.raw(), doc = PromptDraft.parse(out);
    assert.ok(out.startsWith('【生成目标】\r\n甲给乙递书。\r\n\r\n【参考素材职责】\r\n@图片1用于甲的五官和服装，不采用图片背景。\r\n\r\n【基础设定】\r\n影像风格：写实。\r\n'));
    assert.ok(out.includes('【事件脚本】\r\n镜头1：\r\n机位/景别/角度：中景，平视。\r\n') && out.includes('切点：书翻开时切。\r\n声音包括翻书声。\r\n') && out.endsWith('【保持一致】\r\n保持书只有一本。'));
    assert.ok(!out.includes(PARA), '人写的那一段换成了分镜');
    assert.deepEqual(doc.shots.map(x => x.lines), [Z1, Z2]);
    const side = s.side();
    assert.deepEqual([side.写法, side.写法范围, side.自由稿, side.镜头写法, side.手写], ['分镜', '分镜', PARA, '分区', true]);
    assert.equal(side.分镜稿, out); assert.deepEqual(side.挂图, freeSide().挂图);
    assert.deepEqual(side.镜头信息.map(m => [m.no, m.标题, m.另一种, m.另一种据]), [['1', '甲拿书', M1, Z.key(Z1)], ['2', '乙接书', M2, Z.key(Z2)]]);
    const m = s.map();
    assert.equal(m.prompt_sha256, shaOf(out)); assert.deepEqual(m.references.map(x => x.ref + ' ' + x.path), ['@图片1 ' + manImg]);
    assert.deepEqual(m.秒数.镜头, { 1: 3, 2: 4 }); assert.equal(Secs.state(m.秒数, out).st, 'fresh');
    assert.equal(s.hist('.txt').length, 1); assert.equal(s.hist('.json').length, 1);
    assert.match(r.结果, /^写好了：拆成 2 镜（提示词里放的是分区，合并的另存一份备选），写了生成目标、素材、基础设定、主体与关系、保持一致、「声音包括」那一行，你写的那一段留在自由模式里，登记了 1 个素材.*共 7 秒/);
  });

  await check('交给 AI 写完（拆镜头）：这一条拨成了合并的，提示词里放合并，分区记进写稿资料', async () => {
    const s = setupFree(freeRaw, { ...freeSide(), 镜头写法: '合并' }), j = job();
    await s.K.写完提示词.book(j);
    const r = await s.K.写完提示词.apply(j, fullReply());
    assert.ok(s.raw().includes('【事件脚本】\r\n镜头1：' + M1[0] + '\r\n镜头2：' + M2[0] + '\r\n声音包括翻书声。'));
    assert.deepEqual(s.side().镜头信息.map(m => [m.另一种, m.另一种据]), [[Z1, Z.key(M1)], [Z2, Z.key(M2)]]);
    assert.equal(s.side().镜头写法, '合并'); assert.match(r.结果, /提示词里放的是合并，分区的另存一份备选/);
  });

  await check('交给 AI 写完（拆镜头）：新稿一律先放分区（11-21），别的条拨成合并的不跟着；老稿一镜一段、没记写法的，也放分区', async () => {
    const s = setupFree(), j = job();
    s.put(at('提示词', '第2段', '3-4_写稿.json'), JSON.stringify({ 镜头写法: '合并' }));   // 比这一条的写稿资料晚存
    await s.K.写完提示词.book(j);
    await s.K.写完提示词.apply(j, fullReply());
    assert.equal(s.side().镜头写法, '分区'); assert.ok(s.raw().includes('【事件脚本】\r\n镜头1：\r\n机位/景别/角度：中景，平视。'));
    const old = handRaw.replace(PARA, PARA + '\r\n镜头1：甲拿书。');
    const t = setupFree(old, { ...handSide(), 分镜稿: old }), k = job();
    await t.K.写完提示词.book(k); assert.equal(k.拆, true);
    await t.K.写完提示词.apply(k, '【判断】\n对得上\n别的几块都对得上\n' + tidyReply());
    assert.ok(t.raw().includes('【事件脚本】\r\n镜头1：\r\n机位/景别/角度：中景，平视。\r\n'));
    assert.equal(t.side().镜头写法, '分区'); assert.deepEqual(t.side().镜头信息.map(m => m.另一种), [M1, M2]);
  });

  await check('交给 AI 写完（拆镜头）：写过的几块先判断，「对得上」一字不动、「声音包括」照留，分镜照样换上新拆的', async () => {
    const s = setupFree(handRaw, handSide()), j = job();
    s.put(mapPath, regOf());
    const book = await s.K.写完提示词.book(j);
    assert.equal(j.已写, true); assert.deepEqual(j.空, []);
    assert.ok(book.includes('【判断】') && book.includes('分镜是新拆的，不管怎么判断都要写。'));
    const r = await s.K.写完提示词.apply(j, '【判断】\n对得上\n剧本没动\n' + tidyReply()), out = s.raw();
    assert.ok(out.startsWith('【生成目标】\r\n甲给乙递书。\r\n\r\n【参考素材职责】\r\n@图片1用于甲的五官和服装，不采用图片背景。\r\n\r\n【基础设定】\r\n影像风格：写实。\r\n'));
    assert.ok(/切点：书翻开时切。(\r\n)+声音包括翻书声。\r\n/.test(out) && out.trimEnd().endsWith('【保持一致】\r\n保持书只有一本。') && !out.includes(PARA));
    assert.deepEqual(PromptDraft.parse(out).shots.map(x => x.lines), [Z1, Z2]);
    assert.equal(s.side().自由稿, PARA, '分镜模式写的那一段也留进自由稿');
    assert.equal(s.map().prompt_sha256, shaOf(out));
    assert.match(r.结果, /^写好了：拆成 2 镜（提示词里放的是分区，合并的另存一份备选），你写的那一段留在自由模式里/);
  });

  await check('交给 AI 写完（拆镜头）：等 AI 时人又改了事件脚本、两份镜头对不上、分区没照分区写，都不写', async () => {
    const s = setupFree(), j = job();
    await s.K.写完提示词.book(j);
    const changed = freeRaw.replace(PARA, PARA + '乙笑了。');
    s.put(promptPath, changed);
    await assert.rejects(s.K.写完提示词.apply(j, fullReply()), /又改过/);
    assert.equal(s.raw(), changed);
    const t = setupFree(), k = job();
    await t.K.写完提示词.book(k);
    await assert.rejects(t.K.写完提示词.apply(k, fullReply([Z1])), /对不上/);
    await assert.rejects(t.K.写完提示词.apply(k, fullReply([Z1, ['近景，乙接过。']])), /镜头2没照分区写/);
    assert.equal(t.raw(), freeRaw); assert.equal(t.hist('.txt').length, 0);
    await assert.rejects(setupFree(freeRaw.replace(PARA, ''), freeSide()).K.写完提示词.prep(job()), /还空着/);
  });

  /* 写完的一条：分区在提示词里，合并在写稿资料里 */
  const tidied = async () => { const s = setupFree(), j = job(); await s.K.写完提示词.book(j); await s.K.写完提示词.apply(j, fullReply()); return s; };

  await check('另写一种：两种都照现在这版写的不用重写；改了一镜只重写那一镜，「据」记交出去那一版', async () => {
    const s = await tidied();
    await assert.rejects(s.K.另写一种.prep(job()), /不用重写/);
    const now = s.raw().replace('切点：书翻开时切。', '切点：乙一抬头就切。');
    s.put(promptPath, now);
    const j = job();
    await s.K.另写一种.prep(j);
    const book = await s.K.另写一种.book(j);
    assert.equal(j.从, '分区'); assert.deepEqual(Object.keys(j.据), ['2']);
    assert.ok(book.includes('镜头 2 另用合并写法写一份') && book.includes('切点：乙一抬头就切。') && book.includes('## 以前写的合并') && book.includes('镜头2：' + M2[0]));
    assert.ok(book.includes('【合并】\n镜头1：……'));
    const before = s.files.get(sidePath).toString();
    const r = await s.K.另写一种.apply(j, '【合并】\n镜头2：近景，甲把书递给乙，乙一抬头。\n镜头1：不该写这一镜。');
    const meta = s.side().镜头信息;
    assert.deepEqual(meta[1].另一种, ['近景，甲把书递给乙，乙一抬头。']);
    assert.equal(meta[1].另一种据, Z.key(PromptDraft.parse(now).shots[1].lines));
    assert.deepEqual(meta[0].另一种, M1, '没让写的那一镜不动');
    assert.equal(s.raw(), now, '提示词不动');
    assert.ok(s.hist('.json').some(p => s.files.get(p).toString() === before), '改之前的写稿资料留了一份'); assert.match(r.结果, /照分区重写好了合并那种（镜头2）/);
    await assert.rejects(s.K.另写一种.prep(job()), /不用重写/);
  });

  await check('另写一种：AI 写成了别的写法、等的时候换了写法，都不写', async () => {
    const s = await tidied();
    s.put(promptPath, s.raw().replace('切点：书翻开时切。', '切点：别处切。'));
    const j = job();
    await s.K.另写一种.book(j);
    await assert.rejects(s.K.另写一种.apply(j, '【合并】\n镜头2：\n' + Z2.join('\n')), /没照合并写法/);
    s.put(sidePath, JSON.stringify({ ...s.side(), 镜头写法: '合并' }));
    await assert.rejects(s.K.另写一种.apply(j, '【合并】\n镜头2：近景。'), /换了写法/);
  });

  await check('另写一种：等的时候镜头挪了，照镜头认（不照号）；没记写法的不添「镜头写法」', async () => {
    const s = await tidied();
    s.put(promptPath, s.raw().replace('切点：书翻开时切。', '切点：乙一抬头就切。'));
    const j = job();
    await s.K.另写一种.book(j);
    assert.deepEqual(Object.keys(j.号), ['2']); assert.match(j.号['2'], /^shot-/);
    const doc = PromptDraft.parse(s.raw()), side = s.side();   // 写稿页把镜头2挪到最前面、存了
    [doc.shots[0], doc.shots[1]] = [doc.shots[1], doc.shots[0]]; doc.shots.forEach((x, i) => { x.no = String(i + 1); });
    s.put(promptPath, PromptDraft.serialize(doc));
    s.put(sidePath, JSON.stringify({ ...side, 镜头信息: [{ ...side.镜头信息[1], no: '1' }, { ...side.镜头信息[0], no: '2' }] }));
    const r = await s.K.另写一种.apply(j, '【合并】\n镜头2：近景，乙一抬头。');
    const meta = s.side().镜头信息;
    assert.deepEqual(meta[0].另一种, ['近景，乙一抬头。']); assert.equal(meta[0].id, j.号['2']);
    assert.deepEqual(meta[1].另一种, M1);
    assert.match(r.结果, /（镜头1）/);
    const t = setup(handRaw.replace(PARA, '镜头1：甲拿书。\r\n镜头2：乙接书。'), { 写法: '分镜', 镜头信息: [] }), k = job();
    await t.K.另写一种.book(k);
    await t.K.另写一种.apply(k, '【分区】\n镜头1：\n' + Z1.join('\n') + '\n\n镜头2：\n' + Z2.join('\n'));
    assert.equal(t.side().镜头写法, undefined); assert.deepEqual(t.side().镜头信息.map(m => m.另一种), [Z1, Z2]);
  });

  const aiPrompt = ['【生成目标】', '甲给乙递书。'.repeat(20), '', '【事件脚本】', '镜头1：甲递书。', '镜头2：乙接过，说{谢谢}。', '声音包括翻书声。', '', '【保持一致】', '保持书只有一本。'].join('\n');
  const zonedOfAi = ['【分区】', '镜头1：', '机位/景别/角度：中景。', '小节一', '动作/表情：甲递书。', '台词：无', '', '镜头2：', '机位/景别/角度：近景。', '小节一', '动作/表情：乙接过。', '台词：乙说{谢谢}', '【标题】', '镜头1：递书', '镜头2：接书'].join('\n');
  await check('写提示词（AI 先写）：两种一起写，默认分区放进提示词，合并和标题记进写稿资料；校验值、秒数照放进去的那份', async () => {
    const s = setup(null, null);
    const r = await s.K.写提示词.apply({ ...job(), assets: [] }, '【提示词】\n' + aiPrompt + '\n【素材登记】\n[]\n【秒数】\n镜头1：2\n镜头2：3\n' + zonedOfAi);
    const out = s.raw();
    assert.ok(out.includes('【事件脚本】\n镜头1：\n机位/景别/角度：中景。\n小节一\n') && out.includes('台词：乙说{谢谢}\n\n声音包括翻书声。'));
    assert.ok(!/【分区】|【标题】|镜头1：2/.test(out));
    const side = s.side();
    assert.equal(side.镜头写法, '分区'); assert.equal(side.分镜稿, out); assert.equal(side.手写, undefined, '流水线照旧当 AI 写的初稿');
    assert.deepEqual(side.镜头信息.map(m => [m.标题, m.另一种]), [['递书', ['甲递书。']], ['接书', ['乙接过，说{谢谢}。']]]);
    const m = s.map();
    assert.equal(m.prompt_sha256, shaOf(out)); assert.equal(Secs.state(m.秒数, out).st, 'fresh');
    assert.match(r.结果, /两种都写了，提示词里放的是分区这种/);
    assert.ok(source.includes('Styles.writeRule') && source.includes('...Styles.writeEg()'));
  });

  await check('写提示词：分区那份对不上就只放合并的，不建写稿资料；没写分区的照旧', async () => {
    const s = setup(null, null);
    const r = await s.K.写提示词.apply({ ...job(), assets: [] }, '【提示词】\n' + aiPrompt + '\n【素材登记】\n[]\n【分区】\n镜头1：\n机位/景别/角度：中景。\n小节一\n动作/表情：甲递书。');
    assert.ok(s.raw().includes('镜头1：甲递书。\n镜头2：乙接过'));
    assert.ok(!s.files.has(sidePath)); assert.match(r.结果, /对不上，只放了合并的/);
    const t = setup(null, null);
    const q = await t.K.写提示词.apply({ ...job(), assets: [] }, '【提示词】\n' + aiPrompt + '\n【素材登记】\n[]');
    assert.ok(t.raw().startsWith('【生成目标】') && !t.files.has(sidePath)); assert.doesNotMatch(q.结果, /分区/);
  });

  await check('按批注改提示词：存着另一种的，任务书摆出来；回的【另一种】掐出来（带 {} 也不碍素材登记），改到的那镜跟着换、「据」照改好的', async () => {
    const s = await tidied(), j = { ...job(), rel: ['提示词', '第1段', '1-2_批注.md'] };
    s.put(at('提示词', '第1段', '1-2_批注.md'), '# 批注\n\n## 原文\n切点：甲转身时切。\n批注：转身一半就切\n');
    const book = await s.K.按批注改提示词.book(j);
    assert.equal(j.另一种, '合并');
    assert.ok(book.includes('## 另一种写法（存在写稿资料里，出片用的是上面原文里的分区写法）') && book.includes('镜头1：' + M1[0]) && book.includes('【另一种】'));
    const op = JSON.stringify([{ 原文: '切点：甲转身时切。', 第几处: 1, 改成: '切点：甲转身一半就切。' }]);
    const r = await s.K.按批注改提示词.apply(j, op + '\n【素材登记】\n[]\n【另一种】\n镜头1：中景，甲走到桌边拿起书，转身一半。\n镜头2：近景，乙说{谢谢。}\n镜头9：没有这一镜。\n【秒数】\n镜头1：3\n镜头2：4');
    const out = s.raw(), meta = s.side().镜头信息;
    assert.ok(out.includes('切点：甲转身一半就切。') && !out.includes('【另一种】') && !out.includes('镜头9'));
    assert.deepEqual(meta[0].另一种, ['中景，甲走到桌边拿起书，转身一半。']);
    assert.equal(meta[0].另一种据, Z.key(PromptDraft.parse(out).shots[0].lines));
    assert.deepEqual(meta[1].另一种, ['近景，乙说{谢谢。}']);
    assert.equal(Secs.state(s.map().秒数, out).st, 'fresh');
    assert.match(r.结果, /改了 1 处.*另一种（合并）也跟着改了镜头1、2/);
  });

  await check('按批注改提示词：没回【另一种】的，改到的那镜在写稿页显示「旧了」（据对不上），别的照旧', async () => {
    const s = await tidied(), j = { ...job(), rel: ['提示词', '第1段', '1-2_批注.md'] };
    s.put(at('提示词', '第1段', '1-2_批注.md'), '# 批注\n');
    await s.K.按批注改提示词.book(j);
    const r = await s.K.按批注改提示词.apply(j, JSON.stringify([{ 原文: '切点：甲转身时切。', 第几处: 1, 改成: '切点：别处切。' }]));
    const meta = s.side().镜头信息, now = PromptDraft.parse(s.raw()).shots;
    assert.notEqual(meta[0].另一种据, Z.key(now[0].lines)); assert.equal(meta[1].另一种据, Z.key(now[1].lines));
    assert.doesNotMatch(r.结果, /另一种/);
    const t = setup(handRaw, handSide()), k = { ...job(), rel: ['提示词', '第1段', '1-2_批注.md'] };
    t.put(at('提示词', '第1段', '1-2_批注.md'), '# 批注\n');
    assert.doesNotMatch(await t.K.按批注改提示词.book(k), /另一种写法/);   // 没存另一种的照旧
    assert.equal(k.另一种, undefined);
  });

  console.log(tested + ' 项回归检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
