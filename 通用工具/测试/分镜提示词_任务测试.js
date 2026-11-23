'use strict';
// node 通用工具/测试/分镜提示词_任务测试.js
// 所有项目读写都在内存文件系统中，不访问或修改用户的提示词。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Secs = require('../公用/秒数.js');
const KeyFrames = require('../公用/关键帧写法.js'), PromptDraft = require('../公用/写稿状态.js');   // 人写稿的空骨架、自由模式拼正文（11-19）   // 每镜秒数（11-15）：本机服务记进参考素材映射，出片弹窗照它填
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const job = () => ({ 项目: '测试', 段: '1', 名: '视频提示词.txt', assets: [] });
const promptPath = path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词.txt');
const sidePath = promptPath.replace(/\.txt$/, '_写稿.json');
const mapPath = path.join(root, '项目', '测试', '资产', '参考素材映射.json');
const fail = code => Object.assign(new Error(code), { code });

function setup(raw, side, opts = {}) {   // opts.spawn：要读剧本 Word 的（交给 AI 写完的任务书）给一个假的子进程
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
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn: opts.spawn || (() => { throw Error('测试不能调用外部 AI'); }) } : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),   // jobs.js 里的 ./canvas.js 这种照 jobs.js 那边找
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
    assert.ok(reviewBook.includes('## sd25-pe（') && !reviewBook.includes('测试技能'));   // 旧格式稿照原格式批，也只给地图和 sd25-pe 的路径，不贴整份（11-18 晚）
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
  await check('照新资产改（11-17）：AI 回 []，稿子一字不动、只更新时间，批注收走；人写的批注回 [] 照旧算没改成', async () => {
    const AssetEdit = require('../公用/资产改过.js'), Core = require('../公用/核心.js');
    const notePath = path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词_批注.md'), j = { ...job(), rel: ['提示词', '第1段', '视频提示词_批注.md'] };
    const s = setup(pe, peSide());
    s.files.set(notePath, Buffer.from(AssetEdit.noteMd(Core, { title: 't', file: 'f', list: [{ 类别: '道具', 名称: '书', 改了: '文字描写', 字: '一本蓝皮线装书' }], old: '' })));
    const r = await s.K.按批注改提示词.apply(j, '都对得上。\n[]');
    assert.equal(s.raw(), pe); assert.ok(s.writes.includes(promptPath));   // 写回原样：时间新了
    assert.equal(s.files.has(notePath), false);   // 批注收进历史记录
    assert.match(r.结果, /一字没动/);
    const t = setup(pe, peSide());
    t.files.set(notePath, Buffer.from(Core.notesToMd({ title: 't', file: 'f', general: '', items: [{ where: '分镜', text: '甲递书', n: 1, note: '改成双手递' }] })));
    await assert.rejects(t.K.按批注改提示词.apply(j, '[]'), /没有要改的地方/);
    assert.equal(t.writes.length, 0); assert.equal(t.files.has(notePath), true);
  });
  await check('照新资产改回 []：后面接的【秒数】照样记，旧记号换成现在这份稿的；没估就不动旧的', async () => {
    const AssetEdit = require('../公用/资产改过.js'), Core = require('../公用/核心.js'), key = '提示词/第1段/视频提示词.txt';
    const notePath = path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词_批注.md'), j = { ...job(), rel: ['提示词', '第1段', '视频提示词_批注.md'] };
    const old = () => Buffer.from(JSON.stringify({ schema_version: 1, prompts: { [key]: { prompt_sha256: 'x', references: [], 秒数: { 镜头: { 1: 9 }, 记号: 'old' } } } }));
    const note = () => Buffer.from(AssetEdit.noteMd(Core, { title: 't', file: 'f', list: [{ 类别: '道具', 名称: '书', 改了: '文字描写', 字: '一本蓝皮线装书' }], old: '' }));
    const s = setup(pe, peSide());
    s.files.set(mapPath, old()); s.files.set(notePath, note());
    const r = await s.K.按批注改提示词.apply(j, '[]\n\n【秒数】\n镜头1：2\n镜头2：3');
    assert.equal(s.raw(), pe);   // 稿子还是一字不动
    const m = JSON.parse(s.files.get(mapPath).toString()).prompts[key];
    assert.deepEqual(m.秒数.镜头, { 1: 2, 2: 3 }); assert.equal(Secs.state(m.秒数, s.raw()).st, 'fresh');   // 出片弹窗不再说「估完以后改过」
    assert.match(r.结果, /一字没动.*共 5 秒/);
    const t = setup(pe, peSide());
    t.files.set(mapPath, old()); t.files.set(notePath, note());
    await t.K.按批注改提示词.apply(j, '[]');
    assert.equal(JSON.parse(t.files.get(mapPath).toString()).prompts[key].秒数.记号, 'old');
  });
  await check('PE 稿：AI 批注的原文抄了「镜头N：」也能对上，段名行不当原文', async () => {
    const s = setup(pe, peSide()), j = { ...job(), 渠道: 'claude' };
    const book = await s.K.批注提示词.book(j);
    assert.ok(book.includes('生成目标和事件脚本多半是人自己写的')); assert.doesNotMatch(book, /seedance-prompt-format/);
    const ref = book.indexOf('## sd25-pe（'), raw = book.indexOf('## 提示词（文件：');   // 11-18 晚：只给地图和 sd25-pe 的路径，放在稿子前面；测试里的假技能对不上地图，写明通读整份
    assert.ok(ref > 0 && ref < raw && !book.includes('## sd25-pe 摘录') && !book.includes('测试技能'));
    assert.match(book, /这回地图对不上：.*升级过.*通读整份/);
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
  const flowPath = path.join(root, '项目', '测试', '定稿的剧本', '流水线.json'), kf = '资产/关键帧/第1段/镜头4_首帧.png';
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
  /* 2026-11-18：按批注改也能新挂图（药膳鸡 2-3：换了砂锅图，自动对稿不许动挂图，只好手补，补成只照外形，锅里出成空的） */
  const bookImg = '资产/人物和道具/书.png', manImg = '资产/人物和道具/甲.png', otherImg = '资产/人物和道具/别的.png', key18 = '提示词/第1段/视频提示词.txt';
  const flow18 = () => JSON.stringify({ 人物: [{ 名: '甲', 资产: manImg }], 道具: [{ 名: '书', 资产: bookImg }, { 名: '别的', 资产: otherImg }], 场: [{ 段: '1', 人物: ['甲'], 道具: ['书'] }] });
  const setup18 = () => {
    const s = setup(pe, peSide()), at = f => path.join(root, '项目', '测试', ...f.split('/'));
    s.files.set(flowPath, Buffer.from(flow18()));
    for (const f of [bookImg, manImg, otherImg]) s.files.set(at(f), Buffer.from('png:' + f));
    s.files.set(mapPath, Buffer.from(JSON.stringify({ schema_version: 1, prompts: { [key18]: { prompt_sha256: 'x', references: [{ ref: '@图片1', name: '甲', path: manImg, sha256: 'y' }] } } })));
    s.files.set(path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词_批注.md'), Buffer.from('# 批注\n\n## 整体\n批注：书的图挂上\n'));
    return s;
  };
  const j18 = () => ({ ...job(), rel: ['提示词', '第1段', '视频提示词_批注.md'] });
  const line1 = '@图片1用于甲的五官、发型和服装，不采用图片背景。', line2 = '@图片2用于书的蓝色封皮、线装书脊和夹在书里的红色书签，不采用图片背景。';
  const addOp = JSON.stringify([{ 原文: line1, 第几处: 1, 改成: line1 + '\n' + line2 }]);
  await check('按批注改（11-18）：任务书列出这一场能挂的图，讲明新挂图照 sd25-pe 写、在【素材登记】里登记', async () => {
    const s = setup18(), book = await s.K.按批注改提示词.book(j18());
    assert.ok(book.includes('## 能挂的图（这一场的）\n人物「甲」：' + manImg + '\n道具「书」：' + bookImg + '\n'));
    assert.ok(!book.includes(otherImg));   // 不在这一场的不列
    assert.ok(book.includes('5. 要新挂图的') && book.includes('写法照 sd25-pe，写清图里要照的东西，装着东西的写上里面的') && book.includes('【素材登记】\n[{"ref": "@图片2"'));
    assert.ok(book.includes('6. JSON 后面另起一块【秒数】'));
  });
  await check('按批注改（11-18）：新挂的图登记了就记进参考素材映射，接在原来的后面；抄了整条 E:\\ 路径也认', async () => {
    const s = setup18();
    const r = await s.K.按批注改提示词.apply(j18(), addOp + '\n【素材登记】\n[{"ref": "@图片2", "name": "书", "path": "' + bookImg + '"}]\n【秒数】\n镜头1：2\n镜头2：3');
    assert.ok(s.raw().includes('\r\n' + line1 + '\r\n' + line2 + '\r\n'));
    const m = JSON.parse(s.files.get(mapPath).toString()).prompts[key18];
    assert.deepEqual(m.references.map(x => x.ref + ' ' + x.path), ['@图片1 ' + manImg, '@图片2 ' + bookImg]);
    assert.equal(m.references[1].name, '书'); assert.equal(m.references[1].sha256.length, 64);
    assert.deepEqual(m.秒数.镜头, { 1: 2, 2: 3 });
    assert.match(r.结果, /新挂了 @图片2（书）/);
    const t = setup18(), abs = path.join(root, '项目', '测试', ...bookImg.split('/'));
    await t.K.按批注改提示词.apply(j18(), addOp + '\n【素材登记】\n' + JSON.stringify([{ ref: '@图片2', name: '书', path: abs }]));
    assert.equal(JSON.parse(t.files.get(mapPath).toString()).prompts[key18].references[1].path, bookImg);
  });
  await check('按批注改（11-18）：新挂的图没登记、登记的不是这一场的图、把已有的编号换成别的图，都不改', async () => {
    for (const [reply, why] of [[addOp, /新挂了 @图片2.*没在【素材登记】里写/], [addOp + '\n【素材登记】\n[{"ref": "@图片2", "name": "别的", "path": "' + otherImg + '"}]', /新挂了 @图片2/],
      [addOp + '\n【素材登记】\n[{"ref": "@图片1", "name": "书", "path": "' + bookImg + '"}, {"ref": "@图片2", "name": "书", "path": "' + bookImg + '"}]', /@图片1 已经是/]]) {
      const s = setup18(), before = s.raw();
      await assert.rejects(s.K.按批注改提示词.apply(j18(), reply), why);
      assert.equal(s.raw(), before); assert.equal(s.writes.length, 0);
    }
  });
  /* 2026-11-18：sd25-pe 地图（pe-map.js，专门的测试在 sd25-pe地图_测试.cjs）：带哪几行看稿里挂了什么、批注说到什么 */
  await check('sd25-pe 地图（11-18 晚）：按批注改只给地图和 sd25-pe 的路径；批注说到首帧才点名关键帧那行；旧格式稿也一样', async () => {
    const notePath = path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词_批注.md');
    const s = setup18(), j = j18(), book = await s.K.按批注改提示词.book(j), at = t => book.indexOf(t);
    assert.ok(at('## sd25-pe（') > 0 && at('## sd25-pe（') < at('## 原文（文件：') && !book.includes('## sd25-pe 摘录') && !book.includes('测试技能'));
    assert.ok(book.includes('sd25-pe地图.md') && book.includes(path.join('sd25-pe', 'SKILL.md')) && book.includes('这一条没挂音色、白模、关键帧'));
    assert.match(book, /这回地图对不上：.*通读整份/);
    assert.match(j.摘不到, /sd25-pe 地图对不上/);   // work() 把它接在任务结果后面
    s.files.set(notePath, Buffer.from('# 批注\n\n## 整体\n批注：开头加一张首帧\n'));
    assert.match(await s.K.按批注改提示词.book(j18()), /这一条挂了素材·关键帧/);
    const t = setup(structured, sideData());
    t.files.set(notePath, Buffer.from('# 批注\n\n## 整体\n批注：慢一点\n'));
    const old = await t.K.按批注改提示词.book(j18());
    assert.ok(old.includes('## sd25-pe（') && !old.includes('测试技能'));
  });
  await check('教训只带公用的那一份（11-18 晚）：批注带它、去掉标题；没有这份就不带；真的那份两百字内', async () => {
    const lessonFile = path.join(path.dirname(backend), '公用教训.md'), s = setup(pe, peSide());
    assert.ok(!(await s.K.批注提示词.book(job())).includes('## 公用教训'));
    s.files.set(lessonFile, Buffer.from('# 公用教训（测试）\n\n1. 甲。\n2. 乙。\n'));
    const book = await s.K.批注提示词.book(job());
    assert.ok(book.includes('## 公用教训（批的时候记着）\n1. 甲。\n2. 乙。') && !book.includes('# 公用教训（测试）'));
    const real = fs.readFileSync(lessonFile, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n').slice(1).map(l => l.replace(/^\d+\.\s*/, '').trim()).join('');
    assert.ok(real.length > 0 && real.length <= 200, '公用教训要在两百字内，现在 ' + real.length + ' 字');
  });
  /* 2026-11-21 他定：人只写事件脚本，剩下的「交给 AI 写完」一次写完（pe-finish.js，以前的「AI 铺底」并进来了）。
     这里是已经一镜一镜写好的（镜头一个字不动）；自由模式写的一大段拆成镜头，在 分镜两种写法_任务测试.js */
  const { EventEmitter } = require('node:events');
  const fakeNode = out => () => { const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.stdin = { on() {}, end() {} }; setImmediate(() => { c.stdout.emit('data', Buffer.from(out)); c.emit('close', 0); }); return c; };   // 读剧本 Word 的那个子进程
  const handRaw = '【生成目标】\r\n\r\n【事件脚本】\r\n镜头1：甲递书。\r\n镜头2：乙接过。\r\n';   // 生成目标 11-21 起也归 AI 写
  const scriptAt = path.join(root, '项目', '测试', '定稿的剧本', '第1段', '第1段_剧本.docx');
  const setupFin = (raw = handRaw, side = { 写法: '分镜', 写法范围: '分镜', 分镜稿: raw, 自由稿: '', 镜头信息: [], 手写: true }) => {
    const s = setup(raw, side, { spawn: fakeNode('第1段｜递书\n正文\n△ 甲把书递给乙。') }), at = f => path.join(root, '项目', '测试', ...f.split('/'));
    s.files.set(flowPath, Buffer.from(JSON.stringify({ 人物: [{ 名: '甲', 资产: manImg }], 道具: [{ 名: '书', 资产: bookImg }], 场: [{ 段: '1', 人物: ['甲'], 道具: ['书'], 剧本定稿: '2026-11-19 00:00:00' }] })));
    s.files.set(scriptAt, Buffer.from('docx'));
    for (const f of [bookImg, manImg]) s.files.set(at(f), Buffer.from('png:' + f));
    return s;
  };
  const finReply = ['【生成目标】', '甲给乙递书。', '【素材】', '【参考素材职责】', line1, '@图片2用于书的外形和颜色，不采用图片背景。', '【基础设定】', '影像风格：写实。', '摄影：手持跟拍。', '光色基调：暖黄台灯。', '【主体与关系】', '甲坐在桌边，乙站在对面。',
    '【保持一致】', '保持书只有一本。', '【声音】', '声音包括翻书声。', '【素材登记】', JSON.stringify([{ ref: '@图片1', name: '甲', path: manImg }, { ref: '@图片2', name: '书', path: bookImg }]), '【秒数】', '镜头1：2', '镜头2：3'].join('\n');
  const booked = async (s, j = job()) => { await s.K.写完提示词.book(j); return j; };   // apply 要用 book 记下的几样：交出去的是哪一版、拆不拆、哪几块空着
  await check('交给 AI 写完（11-21）：任务书带人写的事件脚本、能挂的图、剧本，要写生成目标、要【秒数】；镜头不拆就不要两种写法；头一回写不先判断', async () => {
    const s = setupFin(), j = job(), book = await s.K.写完提示词.book(j);
    assert.ok(book.includes('## 这一条的事件脚本（人写的，一个字都不改）\n镜头1：甲递书。\n镜头2：乙接过。\n'));
    assert.ok(book.includes('【生成目标】照下面「提示词格式」写一段') && book.includes('【生成目标】\n……'));
    assert.ok(book.includes('人物「甲」：' + manImg) && book.includes('道具「书」：' + bookImg));
    assert.ok(book.includes('△ 甲把书递给乙。') && book.includes('## sd25-pe（') && book.includes('【秒数】'));
    assert.ok(!book.includes('【判断】') && !book.includes('【分区】') && !book.includes('## 写戏规矩'));
    assert.equal(j.已写, false); assert.equal(j.拆, false); assert.deepEqual(j.空, ['event', 'basic', 'keep']);
    assert.deepEqual(j.assets, [manImg, bookImg]); assert.match(j.底, /^[0-9a-f]{8}$/);
  });
  await check('交给 AI 写完：AI 写的几块（连生成目标）写进正文，人写的镜头一字不动；登记素材、记秒数、原稿留一版', async () => {
    const s = setupFin(), j = await booked(s);
    const r = await s.K.写完提示词.apply(j, finReply), out = s.raw(), at = t => out.indexOf(t);
    assert.ok(at('【生成目标】\r\n甲给乙递书。') === 0 && at('【参考素材职责】') > 0 && at('【基础设定】') > at('【参考素材职责】') && at('【主体与关系】') > at('【基础设定】') && at('【事件脚本】') > at('【主体与关系】'));
    assert.ok(out.includes('【事件脚本】\r\n镜头1：甲递书。\r\n镜头2：乙接过。\r\n声音包括翻书声。\r\n') && at('【保持一致】') > at('声音包括'));
    assert.equal(s.side().分镜稿, out); assert.equal(s.side().镜头写法, undefined);   // 分镜模式：写稿资料里存的就是正文；镜头没拆，不记写法
    const m = JSON.parse(s.files.get(mapPath).toString()).prompts['提示词/第1段/视频提示词.txt'];
    assert.deepEqual(m.references.map(x => x.ref + ' ' + x.path), ['@图片1 ' + manImg, '@图片2 ' + bookImg]);
    assert.deepEqual(m.秒数.镜头, { 1: 2, 2: 3 }); assert.equal(Secs.state(m.秒数, out).st, 'fresh');
    assert.ok([...s.files.keys()].some(p => p.includes('历史记录') && p.endsWith('.txt')));
    assert.deepEqual(s.locks[0], [promptPath, sidePath]);   // 和写稿页存盘同一把锁
    assert.match(r.结果, /^写好了：写了生成目标、素材、基础设定、主体与关系、保持一致、「声音包括」那一行，你写的镜头没动，登记了 2 个素材.*共 5 秒/);
  });
  await check('交给 AI 写完：写过的先判断，「对得上」一个字不动；生成目标还空着的（以前铺底时没写），判断对得上也要写上', async () => {
    const s = setupFin(), j = await booked(s);
    await s.K.写完提示词.apply(j, finReply);
    const done = s.raw(), n = s.writes.length, j2 = job(), book = await s.K.写完提示词.book(j2);
    assert.ok(book.includes('【判断】') && book.includes('## 你写过的几块（对得上的照留）\n【生成目标】\n甲给乙递书。\n【素材】\n【参考素材职责】'));
    assert.equal(j2.已写, true); assert.deepEqual(j2.空, []);
    assert.match((await s.K.写完提示词.apply(j2, '【判断】\n对得上\n剧本没动')).结果, /^对得上，没改：剧本没动/);
    assert.equal(s.raw(), done); assert.equal(s.writes.length, n);
    const d = PromptDraft.parse(done); d.event = '';
    const t = setupFin(PromptDraft.serialize(d)), k = await booked(t);
    assert.equal(k.已写, true); assert.deepEqual(k.空, ['event']);
    assert.ok((await t.K.写完提示词.book(job())).includes('还空着的生成目标不管怎么判断都要写。'));
    await assert.rejects(t.K.写完提示词.apply(k, '【判断】\n对得上\n都对得上'), /AI 没写全（缺生成目标）/);
    const r = await t.K.写完提示词.apply(k, '【判断】\n对得上\n都对得上\n【生成目标】\n甲把书递给乙。\n【素材】\n无\n【基础设定】\n影像风格：不该写进去。');
    d.event = '甲把书递给乙。';
    assert.equal(t.raw(), PromptDraft.serialize(d));   // 只写了生成目标，别的照原样
    assert.match(r.结果, /^写好了：写了生成目标（都对得上），你写的镜头没动/);
  });
  await check('交给 AI 写完（11-23）：对得上、一字没改的，回的【秒数】也记；没回秒数不动旧的；等 AI 的时候镜头又改过的不记', async () => {
    const s = setupFin(), j = await booked(s);
    await s.K.写完提示词.apply(j, finReply);
    const edited = s.raw().replace('乙接过。', '乙双手接过。');   // 人照批注改了一镜，再交给 AI 写完
    s.files.set(promptPath, Buffer.from(edited)); s.files.set(sidePath, Buffer.from(JSON.stringify({ ...s.side(), 分镜稿: edited })));
    const sec = () => JSON.parse(s.files.get(mapPath).toString()).prompts['提示词/第1段/视频提示词.txt'].秒数;
    assert.equal(Secs.state(sec(), edited).st, 'changed');
    const j2 = await booked(s), r = await s.K.写完提示词.apply(j2, '【判断】\n对得上\n只改了镜头2\n【生成目标】\n无\n【秒数】\n镜头1：2\n镜头2：4');
    assert.equal(s.raw(), edited);   // 稿子一字不动
    assert.deepEqual(sec().镜头, { 1: 2, 2: 4 }); assert.equal(Secs.state(sec(), edited).st, 'fresh');   // 出片弹窗不再说「估完以后改过」
    assert.equal(r.结果, '对得上，没改：只改了镜头2；每镜秒数估好了，共 6 秒');
    const j3 = await booked(s), n = s.writes.length;
    assert.equal((await s.K.写完提示词.apply(j3, '【判断】\n对得上\n都对得上')).结果, '对得上，没改：都对得上');   // 没回秒数：旧的照留，不多说
    assert.equal(s.writes.length, n);
    const j4 = await booked(s);
    s.files.set(promptPath, Buffer.from(edited.replace('甲递书。', '甲把书递过去。')));   // 等 AI 的时候人又改了镜头
    const r4 = await s.K.写完提示词.apply(j4, '【判断】\n对得上\n都对得上\n【秒数】\n镜头1：9\n镜头2：9');
    assert.match(r4.结果, /秒数没记$/); assert.deepEqual(sec().镜头, { 1: 2, 2: 4 });
  });
  await check('交给 AI 写完：回的不全、写稿资料坏了、关键帧句被改、等的时候人改了镜头，都不存；关键帧句只改了第几镜的照存', async () => {
    const s = setupFin(), j = await booked(s);
    await assert.rejects(s.K.写完提示词.apply(j, '【素材】\n无'), /AI 没写全（缺生成目标、基础设定、保持一致）/);
    assert.equal(s.raw(), handRaw); assert.equal(s.writes.length, 0);
    const b = setupFin(handRaw, '{broken');
    await assert.rejects(b.K.写完提示词.prep(job()), /保护现有内容/);   // 点的时候就说
    await assert.rejects(b.K.写完提示词.apply(j, finReply), /保护现有内容/);
    assert.equal(b.files.get(sidePath).toString(), '{broken'); assert.equal(b.raw(), handRaw); assert.equal(b.writes.length, 0);
    assert.deepEqual(b.locks, [[promptPath, sidePath]]);   // 和写稿页存盘同一把锁
    const kf0 = '【生成目标】\r\n\r\n【参考素材职责】\r\n@图片3作为首帧。\r\n该首帧定义镜头8开场甲拿着书站在桌边。\r\n\r\n【事件脚本】\r\n镜头1：甲递书。\r\n镜头2：乙接过。\r\n';
    const k = setupFin(kf0), kj = await booked(k);
    await assert.rejects(k.K.写完提示词.apply(kj, finReply), /白模、关键帧那几句改了/);
    assert.equal(k.raw(), kf0);
    await k.K.写完提示词.apply(kj, finReply.replace('【参考素材职责】\n', '【参考素材职责】\n@图片3作为首帧。\n该首帧定义镜头1开场甲拿着书站在桌边。\n'));   // 只把第几镜照事件脚本的镜头号改了：照存
    assert.ok(k.raw().includes('【参考素材职责】\r\n@图片3作为首帧。\r\n该首帧定义镜头1开场甲拿着书站在桌边。\r\n'));
    const c = setupFin(), cj = await booked(c);
    c.files.set(promptPath, Buffer.from(handRaw.replace('乙接过。', '乙接过来。')));
    await assert.rejects(c.K.写完提示词.apply(cj, finReply), /又改过/);
  });
  await check('交给 AI 写完：剧本没定稿、旧格式的稿、事件脚本空着，点的时候就说清', async () => {
    const s = setupFin(); s.files.delete(scriptAt);
    await assert.rejects(s.K.写完提示词.prep(job()), /剧本定稿以后才能交给 AI 写完/);
    await assert.rejects(setupFin(structured).K.写完提示词.prep(job()), /旧格式/);
    await assert.rejects(setupFin('【生成目标】\r\n甲给乙递书。\r\n\r\n【事件脚本】\r\n声音包括翻书声。\r\n').K.写完提示词.prep(job()), /事件脚本还空着/);   // 只有「声音包括」那一行也算空着
    await setupFin().K.写完提示词.prep(job());
  });
  await check('新建人写稿的空骨架（提示词.html 的 skeleton）：挂关键帧照 sd25-pe 锚点写，五份以内写法一、多于五份写法二；白模只补它自己的两句', () => {
    const html = fs.readFileSync(path.join(__dirname, '../流水线/提示词.html'), 'utf8');
    const box = { BM_LINES: ref => [ref + '白模句'], KeyFrames, PromptDraft }; vm.runInNewContext(html.match(/function skeleton\([^]*?\n}/)[0] + '\nthis.make = skeleton;', box);
    assert.equal(box.make('', []), '【生成目标】\r\n\r\n【事件脚本】\r\n');
    assert.equal(box.make('', [{ ref: '@图片1', name: '镜头1_首帧' }]), '【生成目标】\r\n\r\n【参考素材职责】\r\n@图片1作为首帧。\r\n该首帧定义〔视频开始时的构图、人物位置、姿态和镜头方向〕。\r\n\r\n【事件脚本】\r\n');
    assert.equal(box.make('@视频1', []), '【生成目标】\r\n\r\n【参考素材职责】\r\n@视频1白模句\r\n\r\n【事件脚本】\r\n');
    const six = [1, 2, 3, 4, 5, 6].map(n => ({ ref: '@图片' + n, name: '镜头' + n + (n === 6 ? '_尾帧' : '_首帧') }));
    const L = box.make('@视频1', six).split('\r\n');
    assert.deepEqual(L.slice(0, 4), ['【生成目标】', '', '【场景】', '以@图片1至@图片6的顺序作为关键帧。']);
    assert.ok(L.includes('@图片6作为尾帧。') && L.indexOf('@视频1白模句') === L.indexOf('【动作与声音】') + 1);
    assert.doesNotMatch(L.join('\n'), /【参考素材职责】/);
    assert.equal(PromptDraft.parse(box.make('', six)).fmt, 'pe');   // 写稿页认得出是新格式
  });
  console.log(tested + ' 项回归检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
