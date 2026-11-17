'use strict';
// node 通用工具/测试/分镜提示词_任务测试.js
// 所有项目读写都在内存文件系统中，不访问或修改用户的提示词。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Secs = require('../公用/秒数.js');   // 每镜秒数（11-15）：本机服务记进参考素材映射，出片弹窗照它填
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const job = () => ({ 项目: '测试', 段: '1', 名: '视频提示词.txt', assets: [] });
const promptPath = path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词.txt');
const sidePath = promptPath.replace(/\.txt$/, '_写稿.json');
const mapPath = path.join(root, '项目', '测试', '资产', '参考素材映射.json');
const fail = code => Object.assign(new Error(code), { code });

function setup(raw, side) {
  const files = new Map([[promptPath, Buffer.from(raw)], [sidePath, Buffer.from(typeof side === 'string' ? side : JSON.stringify(side))]]);
  const writes = [], locks = [];
  const mockFs = {
    existsSync: p => files.has(p),
    promises: {
      async readFile(p, encoding) {
        if (String(p).endsWith('SKILL.md')) return '测试技能';
        if (!files.has(p)) throw fail('ENOENT');
        return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p));
      },
      async stat(p) { if (!files.has(p)) throw fail('ENOENT'); return { mtimeMs: 0 }; },
      async mkdir() {}, async readdir() { return []; },
      async writeFile(p, data, opts) {
        if (opts && opts.flag === 'wx' && files.has(p)) throw fail('EEXIST');
        writes.push(p); files.set(p, Buffer.from(data));
      },
      async rename(from, to) { if (!files.has(from)) throw fail('ENOENT'); files.set(to, files.get(from)); files.delete(from); writes.push(to); },
      async copyFile(from, to) { if (!files.has(from)) throw fail('ENOENT'); files.set(to, Buffer.from(files.get(from))); writes.push(to); },
    },
  };
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn() { throw Error('测试不能调用外部 AI'); } } : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),   // jobs.js 里的 ./canvas.js 这种照 jobs.js 那边找
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => { locks.push(paths); return fn(); } });
  return { K: api.KINDS, files, writes, locks, side: () => JSON.parse(files.get(sidePath).toString()), raw: () => files.get(promptPath).toString() };
}

const structured = '\uFEFF本段事件：原文  保留\r\n\r\n素材\r\n\r\n基础设定\r\n\r\n本段\r\n\r\n分镜\r\n镜头 01｜第一镜\r\n甲原文。\r\n\r\n镜头 02｜第二镜\r\n乙原文。\r\n\r\n保持一致：原样\r\n';
const sideData = () => ({ 写法: '分镜', 分镜稿: structured, 自由稿: '自由稿备份\n  保留缩进', 镜头信息: [{ id: 'shot-a', no: '01', 作用: '用户作用甲' }, { id: 'shot-b', no: '02', 作用: '用户作用乙' }], 挂图: { '@图片1': '资产/图.png' }, 额外字段: { 保留: true } });

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };
  await check('自由模式的稿：AI 批注不挑分镜格式，公共区照实核对，稿子不动', async () => {
    const freeShots = '先看向门口\r\n\r\n  停顿，然后开口。';
    const raw = '\uFEFF本段事件：原事件\r\n素材\r\n@图片1 原图\r\n基础设定\r\n原风格\r\n本段\r\n原场景\r\n分镜\r\n' + freeShots + '\r\n保持一致：原约束\r\n';
    const s = setup(raw, { ...sideData(), 写法: '自由', 写法范围: '分镜', 自由稿: freeShots });
    const reviewBook = await s.K.批注提示词.book(job());
    assert.ok(reviewBook.includes('用户只把分镜写成自由文本'));
    assert.ok(reviewBook.includes('公共区仍然共用'));
    assert.ok(reviewBook.includes(raw.slice(1)));   // 整份稿（连公共区）都给 AI 看
    assert.doesNotMatch(reviewBook, /## 分镜写法/);   // 旧格式稿照原格式批，不附 sd25-pe 分镜写法
    assert.equal(s.raw(), raw); assert.equal(s.writes.length, 0);
  });
  await check('AI 初稿禁止覆盖已有提示词（含排队后的新建）', async () => {
    const s = setup(structured, sideData()); await assert.rejects(s.K.写提示词.prep(job()), /已经存在/);
    await assert.rejects(s.K.写提示词.apply(job(), '【提示词】\n本段事件：' + '测试内容'.repeat(50) + '\n【素材登记】\n[]'), /保留现有内容/);
    assert.equal(s.raw(), structured); assert.equal(s.writes.length, 0);
  });
  const pe = '\uFEFF【生成目标】\r\n甲给乙递书。\r\n\r\n【参考素材职责】\r\n@图片1用于甲的五官、发型和服装，不采用图片背景。\r\n\r\n【事件脚本】\r\n镜头1：甲递书。\r\n镜头2：乙接过。\r\n最终画面采用写实质感，声音包括无背景音乐。\r\n\r\n【保持一致】\r\n保持书只有一本。\r\n';
  const peSide = () => ({ 写法: '分镜', 分镜稿: pe, 自由稿: '', 镜头信息: [{ id: 'pe-a', no: '1', 作用: '', 标题: '递书' }, { id: 'pe-b', no: '2', 作用: '', 标题: '' }] });
  await check('按批注改：只换半句时，AI 的话里有 $& 也照原样放进去', async () => {
    const s = setup(pe, peSide()), j = { ...job(), rel: ['提示词', '第1段', '视频提示词_批注.md'] };
    await s.K.按批注改提示词.apply(j, '[{"原文": "甲递书", "第几处": 1, "改成": "甲把书递过去，标价 $& 元"}]');
    assert.ok(s.raw().includes('\r\n镜头1：甲把书递过去，标价 $& 元。\r\n'));
    assert.ok(s.raw().includes('\r\n镜头2：乙接过。\r\n'));
  });
  await check('PE 稿：AI 批注的原文抄了「镜头N：」也能对上，段名行不当原文', async () => {
    const s = setup(pe, peSide()), j = { ...job(), 渠道: 'claude' };
    const book = await s.K.批注提示词.book(j);
    assert.ok(book.includes('生成目标和事件脚本多半是人自己写的')); assert.doesNotMatch(book, /seedance-prompt-format/);
    const shots = book.indexOf('## 分镜写法（摘自 sd25-pe');   // 11-15：分镜那几节现摘，放在稿子前面；测试里的假技能摘不到，写明
    assert.ok(shots > 0 && shots < book.indexOf('## 提示词（文件：')); assert.match(book, /没摘到/);
    await s.K.批注提示词.apply(j, '总评：还行\n## 1\n- 位置：镜头1\n- 级别：提醒\n- 原文：镜头1：甲递书。\n- 批注：写清怎么递\n- 改成：镜头1：甲双手把书递过去。\n## 2\n- 位置：保持一致\n- 原文：【保持一致】\n- 批注：再加一条');
    const md = [...s.files.entries()].find(([p]) => p.endsWith('_AI批注.md'))[1].toString();
    assert.ok(md.includes('- 原文：甲递书。')); assert.ok(md.includes('- 改成：甲双手把书递过去。'));
    assert.doesNotMatch(md, /原文：【保持一致】/);
  });
  await check('写提示词：名字要是镜头号（11-16），改几的不让 AI 新写', async () => {
    const s = setup(structured, sideData());
    await s.K.写提示词.prep({ ...job(), 名: '1-5.txt' });
    await s.K.写提示词.prep({ ...job(), 名: '1-3、5.txt' });
    await assert.rejects(s.K.写提示词.prep({ ...job(), 名: '1-5_改1.txt' }), /镜头号/);
    await assert.rejects(s.K.写提示词.prep({ ...job(), 名: '第一条.txt' }), /镜头号/);
  });
  await check('写提示词任务书只照 sd25-pe，回的稿从【生成目标】读起', async () => {
    const book = fs.readFileSync(backend, 'utf8');
    assert.doesNotMatch(book, /seedance-prompt-format'\)/);
    const s = setup(structured, sideData());
    s.files.delete(promptPath);
    await s.K.写提示词.apply(job(), '好的，下面是稿子\n【提示词】\n【生成目标】\n' + '甲给乙递书。'.repeat(20) + '\n\n【事件脚本】\n镜头1：甲递书。\n【素材登记】\n[]');
    assert.ok(s.raw().startsWith('【生成目标】\n'));
  });
  await check('写提示词：没写哪段戏就写整段、别的条不附；写了哪段才只写那段、附上别的条', () => {
    const sc = setup(structured, sideData()).K.写提示词.scope, two = [{ f: '视频提示词.txt', no: 1, text: '第一条' }];
    const whole = sc(2, two, '', null);
    assert.match(whole.text, /这一份是第 2 条，写这一段的整段戏，从开头写到结尾。/); assert.equal(whole.others.length, 0);
    assert.doesNotMatch(whole.text, /接着|留给下一条|留给别的条/);
    const part = sc(2, two, '小磊进门到坐下', null);
    assert.match(part.text, /这一条写这段戏：小磊进门到坐下。/); assert.match(part.text, /另外还有 1 条/); assert.equal(part.others, two);
    const shot = sc(0, two, '镜头3慢一点', [2, 3, 5]);   // 11-16：名字是镜头号的，只写勾的那几个镜头
    assert.match(shot.text, /这一份是拍镜头 2、3、5 的一条/); assert.match(shot.text, /只写镜头表里镜头 2、3、5 的戏/); assert.match(shot.text, /人另外交代：镜头3慢一点。/); assert.equal(shot.others, two);
  });
  /* 11-15：AI 写稿、照批注改稿时顺手估每镜几秒，回复最后另起一块【秒数】；秒数不进稿子，记进参考素材映射 */
  await check('写提示词：任务书要【秒数】；回的【秒数】不进稿子，记进映射，和稿子对得上', async () => {
    assert.ok(fs.readFileSync(backend, 'utf8').includes('Secs.ASK'));
    const s = setup(structured, sideData());
    s.files.delete(promptPath);
    const r = await s.K.写提示词.apply(job(), '【提示词】\n【生成目标】\n' + '甲给乙递书。'.repeat(20) + '\n\n【事件脚本】\n镜头1：甲递书。\n镜头2：乙接过。\n【素材登记】\n[]\n【秒数】\n镜头1：2\n镜头2：3');
    assert.doesNotMatch(s.raw(), /秒数|镜头1：2/);
    const m = JSON.parse(s.files.get(mapPath).toString()).prompts['提示词/第1段/视频提示词.txt'];
    assert.deepEqual(m.秒数.镜头, { 1: 2, 2: 3 }); assert.match(r.结果, /共 5 秒/);
    assert.equal(Secs.state(m.秒数, s.raw()).st, 'fresh');
  });
  await check('写提示词：【秒数】写在【素材登记】前面也不进稿子；没写【秒数】就说一声', async () => {
    const s = setup(structured, sideData());
    s.files.delete(promptPath);
    await s.K.写提示词.apply(job(), '【提示词】\n【生成目标】\n' + '甲给乙递书。'.repeat(20) + '\n\n【事件脚本】\n镜头1：甲递书。\n【秒数】\n镜头1：2\n【素材登记】\n[]');
    assert.doesNotMatch(s.raw(), /秒数/);
    const t = setup(structured, sideData());
    t.files.delete(promptPath);
    const r = await t.K.写提示词.apply(job(), '【提示词】\n【生成目标】\n' + '甲给乙递书。'.repeat(20) + '\n\n【事件脚本】\n镜头1：甲递书。\n【素材登记】\n[]');
    assert.match(r.结果, /没估每镜秒数/);
    assert.equal(JSON.parse(t.files.get(mapPath).toString()).prompts['提示词/第1段/视频提示词.txt'].秒数, undefined);
  });
  await check('按批注改：JSON 后面接【秒数】，照改好的稿记；没估全的镜说一声；没估就不动旧的', async () => {
    const key = '提示词/第1段/视频提示词.txt', j = { ...job(), rel: ['提示词', '第1段', '视频提示词_批注.md'] };
    const s = setup(pe, peSide());
    s.files.set(mapPath, Buffer.from(JSON.stringify({ schema_version: 1, prompts: { [key]: { prompt_sha256: 'x', references: [], 秒数: { 镜头: { 1: 9 }, 记号: 'old' } } } })));
    const r = await s.K.按批注改提示词.apply(j, '[{"原文": "甲递书", "第几处": 1, "改成": "甲把书递过去"}]\n【秒数】\n镜头1：3');
    const m = JSON.parse(s.files.get(mapPath).toString()).prompts[key];
    assert.deepEqual(m.秒数.镜头, { 1: 3 }); assert.equal(m.秒数.记号, Secs.mark(s.raw()));
    assert.match(r.结果, /共 3 秒（镜头2 没估）/);
    const t = setup(pe, peSide());
    t.files.set(mapPath, Buffer.from(JSON.stringify({ schema_version: 1, prompts: { [key]: { prompt_sha256: 'x', references: [], 秒数: { 镜头: { 1: 9 }, 记号: 'old' } } } })));
    await t.K.按批注改提示词.apply(j, '[{"原文": "甲递书", "第几处": 1, "改成": "甲把书递过去"}]');
    const n = JSON.parse(t.files.get(mapPath).toString()).prompts[key];
    assert.equal(n.秒数.记号, 'old'); assert.equal(Secs.state(n.秒数, t.raw()).st, 'changed');   // 出片弹窗会说「估完以后改过」
  });
  /* 2026-11-16：镜头表固定号（删过的不挪），关键帧绑在哪一镜哪一刻要写进任务书、素材登记 */
  const flowPath = path.join(root, '项目', '测试', '定稿的剧本', '流水线.json'), kf = '资产/第1段/镜头4_首帧.png';
  const flowWith = () => JSON.stringify({ 场: [{ 段: '1', 段落: [{ 号: '1', 写什么: '甲进门' }, { 号: '2', 写什么: '乙抬头' }, { 号: '4', 写什么: '丙递书' }],
    关键帧绑定: { [kf]: { 镜: '4', 刻: '首帧', 写什么: '丙递书' } } }] });
  await check('批提示词：挂的关键帧写明绑在镜头表哪一镜哪一刻，号照镜头表的固定号', async () => {
    const s = setup(pe, { ...peSide(), 挂图: { '@图片1': kf } });
    s.files.set(flowPath, Buffer.from(flowWith()));
    const book = await s.K.批注提示词.book(job());
    assert.ok(book.includes('@图片1：' + kf + '（镜头表镜头4「丙递书」开头）'));
    assert.match(book, /绑在镜头表哪一镜的哪一刻/);
    assert.match(book, /看它用的位置对不对得上那一镜那一刻/);
  });
  await check('写提示词：绑了镜头的关键帧，素材登记里写明「关键帧｜镜头4｜开头」', async () => {
    const s = setup(structured, sideData());
    s.files.delete(promptPath);
    s.files.set(flowPath, Buffer.from(flowWith()));
    s.files.set(path.join(root, '项目', '测试', ...kf.split('/')), Buffer.from('png'));
    await s.K.写提示词.apply({ ...job(), assets: [kf] }, '【提示词】\n【生成目标】\n' + '甲给乙递书。'.repeat(20) + '\n\n【事件脚本】\n镜头1：甲递书。\n【素材登记】\n[{"ref": "@图片1", "name": "关键帧", "path": "' + kf + '"}]');
    const refs = JSON.parse(s.files.get(mapPath).toString()).prompts['提示词/第1段/视频提示词.txt'].references;
    assert.equal(refs.length, 1); assert.equal(refs[0].name, '关键帧｜镜头4｜开头');
  });
  console.log(tested + ' 项回归检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
