'use strict';
// node 通用工具/分镜提示词_任务测试.js
// 所有项目读写都在内存文件系统中，不访问或修改用户的提示词。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const KeyFrames = require('./公用/关键帧写法.js');   // 提示词.html 的 skeleton 用它写关键帧句（页面里是同一份）
const BmKey = require('./公用/白模关键帧写法.js');   // 挂了白模又挂了关键帧的，skeleton 照它写（11-14）
const backend = path.resolve(__dirname, '../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const job = () => ({ 项目: '测试', 段: '1', 名: '视频提示词.txt', assets: [] });
const promptPath = path.join(root, '项目', '测试', '提示词', '第1段', '视频提示词.txt');
const sidePath = promptPath.replace(/\.txt$/, '_写稿.json');
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
  const api = box.module.exports({ ROOT: root, TOOLS: __dirname, log() {}, withFileLocks: async (paths, fn) => { locks.push(paths); return fn(); } });
  return { K: api.KINDS, files, writes, locks, side: () => JSON.parse(files.get(sidePath).toString()), raw: () => files.get(promptPath).toString() };
}

const structured = '\uFEFF本段事件：原文  保留\r\n\r\n素材\r\n\r\n基础设定\r\n\r\n本段\r\n\r\n分镜\r\n镜头 01｜第一镜\r\n甲原文。\r\n\r\n镜头 02｜第二镜\r\n乙原文。\r\n\r\n保持一致：原样\r\n';
const sideData = () => ({ 写法: '分镜', 分镜稿: structured, 自由稿: '自由稿备份\n  保留缩进', 镜头信息: [{ id: 'shot-a', no: '01', 作用: '用户作用甲' }, { id: 'shot-b', no: '02', 作用: '用户作用乙' }], 挂图: { '@图片1': '资产/图.png' }, 额外字段: { 保留: true } });
const suggestion = JSON.stringify({ 分镜建议: [{ 标题: '建议', 作用: '作用', 正文: '可选正文', 关键词: { 动作: ['停顿'] } }], 基础建议: { 本段: '建议内容' }, 关键词: { '01': { 动作: ['回头'] } } });

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };
  await check('新建的稿是 sd2.5PE 格式：只有生成目标、事件脚本两个段名，镜头留空', () => {
    const html = fs.readFileSync(path.join(__dirname, '流水线/提示词.html'), 'utf8');
    const script = html.match(/function skeleton\([^]*?\n}/)[0];
    const box = { BM_LINES: ref => [ref + '白模句'], KeyFrames, BmKey }; vm.runInNewContext(script + '\nthis.make = skeleton;', box);   // 11-13 起 skeleton 的参数是挂的白模编号、挂的关键帧
    assert.equal(box.make(''), '【生成目标】\r\n\r\n【事件脚本】\r\n'); assert.doesNotMatch(box.make(''), /镜头/);
    assert.equal(box.make('@视频1'), '【生成目标】\r\n\r\n【参考素材职责】\r\n@视频1白模句\r\n\r\n【事件脚本】\r\n');
  });
  await check('新建的稿挂关键帧：照 sd25-pe 关键帧锚点写；素材五份以内放【参考素材职责】最前，多于五份用写法二放【场景】最前', () => {
    const html = fs.readFileSync(path.join(__dirname, '流水线/提示词.html'), 'utf8');
    const box = { BM_LINES: ref => [ref + '白模句'], KeyFrames, BmKey }; vm.runInNewContext(html.match(/function skeleton\([^]*?\n}/)[0] + '\nthis.make = skeleton;', box);
    assert.equal(box.make('', [{ ref: '@图片1', name: '镜头1_首帧' }]), '【生成目标】\r\n\r\n【参考素材职责】\r\n@图片1作为首帧。\r\n该首帧定义〔视频开始时的构图、人物位置、姿态和镜头方向〕。\r\n\r\n【事件脚本】\r\n');
    const six = KeyFrames.order([3, 1, 6, 2, 5, 4].map(n => ({ name: '镜头' + n + (n === 6 ? '_尾帧' : '_首帧') }))).map((x, i) => ({ ...x, ref: '@图片' + (i + 1) }));
    assert.deepEqual(six.map(x => x.name.slice(0, 3)), ['镜头1', '镜头2', '镜头3', '镜头4', '镜头5', '镜头6']);
    const L = box.make('', six).split('\r\n');   // 只挂关键帧（没挂白模）：照 sd25-pe 锚点写
    assert.deepEqual(L.slice(0, 4), ['【生成目标】', '', '【场景】', '以@图片1至@图片6的顺序作为关键帧。']);
    assert.ok(L.includes('@图片3定义第三个关键帧：〔这一刻看得见的状态〕。')); assert.ok(L.includes('@图片6作为尾帧。'));
    assert.doesNotMatch(L.join('\n'), /【参考素材职责】|【动作与声音】/);
    const M = box.make('@视频1', six).split('\r\n');   // 白模＋关键帧（11-14 起）：照官方指南写，不用锚点句；事件脚本一张关键帧一镜，秒数留〔〕
    assert.deepEqual(M.slice(0, 4), ['【生成目标】', '', '【场景】', BmKey.GROUP(six.map(x => x.ref))]);
    assert.ok(M.indexOf(BmKey.LEAD('@视频1')) === M.indexOf('【动作与声音】') + 1 && M.includes(BmKey.END('@视频1')));
    assert.ok(!M.some(l => /作为[首尾]帧|的顺序作为关键帧|白模句/.test(l)));
    assert.equal(M[M.indexOf('【事件脚本】') + 1], '镜头1：〔起〕-〔止〕秒，首帧参考@图片1。');
    assert.equal(M[M.indexOf('【事件脚本】') + 6], '镜头6：〔起〕-〔止〕秒，结尾参考@图片6。');
    const sc = KeyFrames.scan(L);   // 写稿页、去掉关键帧时认句子靠它：顺序句、角色句和「该…帧定义」都要认出来
    assert.deepEqual(sc.refs, six.map(x => x.ref)); assert.equal(sc.rows.get(3), '');
  });
  await check('侧栏建议不修改正文、草稿快照、作用或附加字段', async () => {
    const s = setup(structured, sideData()), j = job();
    await s.K.铺底.book(j); await s.K.铺底.apply(j, suggestion);
    assert.equal(s.raw(), structured);
    for (const [key, value] of Object.entries(sideData())) assert.deepEqual(s.side()[key], value);
    assert.equal(s.side().分镜建议[0].正文, '可选正文');
    assert.deepEqual(s.side().镜头关键词['shot-a'], { 动作: ['回头'] });
    assert(s.writes.every(p => p === sidePath || p === sidePath + '.antou-tmp'));
    assert.equal(s.locks.length, 1); assert.equal(s.locks[0].length, 2);
  });
  await check('异步关键词返回后仍跟随原镜头 ID', async () => {
    const s = setup(structured, sideData()), j = { ...job(), 镜头号: '01', 镜头ID: 'shot-a' };
    await s.K.要关键词.prep(j); await s.K.要关键词.book(j);
    const edited = sideData(); edited.镜头信息.reverse(); edited.镜头信息[0].no = '01'; edited.镜头信息[1].no = '02';
    edited.自由稿 = '用户等待期间又写了'; s.files.set(sidePath, Buffer.from(JSON.stringify(edited)));
    await s.K.要关键词.apply(j, '{"动作":["停住"]}');
    assert.deepEqual(s.side().镜头关键词['shot-a'], { 动作: ['停住'] });
    assert.equal(s.side().镜头关键词['shot-b'], undefined); assert.equal(s.side().自由稿, edited.自由稿);
    assert.equal(s.raw(), structured); assert.equal(s.locks.length, 1);
  });
  await check('已删除镜头不会把旧请求关键词移给别的镜头', async () => {
    const s = setup(structured, sideData()), j = { ...job(), 镜头号: '01', 镜头ID: 'shot-a' };
    await s.K.要关键词.book(j);
    const edited = sideData(); edited.镜头信息.shift(); s.files.set(sidePath, Buffer.from(JSON.stringify(edited)));
    const result = await s.K.要关键词.apply(j, '{"动作":["停住"]}');
    assert.match(result.结果, /删除或改变/); assert.equal(s.writes.length, 0);
  });
  await check('自由稿的空行、缩进和旧结构稿快照均保持原样', async () => {
    const raw = '\uFEFF任意格式\r\n\r\n   原样\r\n', side = sideData(); side.写法 = '自由'; side.自由稿 = raw;
    const s = setup(raw, side), j = job(); await s.K.铺底.book(j);
    await s.K.铺底.apply(j, '{"分镜建议":[{"标题":"自选","正文":"例子"}],"关键词":{"自由":{"动作":["停顿"]}}}');
    const keyJob = { ...job(), 镜头号: '自由' }; await s.K.要关键词.prep(keyJob); await s.K.要关键词.book(keyJob); await s.K.要关键词.apply(keyJob, '{"机位":["近景"]}');
    assert.equal(s.raw(), raw); assert.equal(s.side().自由稿, raw); assert.equal(s.side().分镜稿, structured);
    assert.deepEqual(s.side().关键词.自由, { 机位: ['近景'] });
  });
  await check('分镜自由模式只建议分镜，完整公共内容与范围标记保持原样', async () => {
    const freeShots = '先看向门口\r\n\r\n  停顿，然后开口。';
    const commonHead = '\uFEFF本段事件：原事件\r\n素材\r\n@图片1 原图\r\n基础设定\r\n原风格\r\n本段\r\n原场景\r\n分镜\r\n';
    const commonTail = '\r\n保持一致：原约束\r\n';
    const raw = commonHead + freeShots + commonTail;
    const side = { ...sideData(), 写法: '自由', 写法范围: '分镜', 自由稿: freeShots };
    const s = setup(raw, side), j = job(); const book = await s.K.铺底.book(j);
    assert.ok(book.includes('是共用的公共内容，不随分镜写法切换')); assert.ok(book.includes(raw));
    await s.K.铺底.apply(j, suggestion);
    const keyJob = { ...job(), 镜头号: '自由' }; const keywordsBook = await s.K.要关键词.book(keyJob);
    assert.ok(keywordsBook.includes('## 当前文字\n' + freeShots + '\n'));
    assert.ok(keywordsBook.includes('## 整份提示词（公共区供对照）\n' + raw));
    await s.K.要关键词.apply(keyJob, '{"动作":["停顿"]}');
    assert.equal(s.raw(), raw);
    for (const [key, value] of Object.entries(side)) assert.deepEqual(s.side()[key], value);
    const reviewBook = await s.K.批注提示词.book(job());
    assert.ok(reviewBook.includes('用户只把分镜写成自由文本'));
    assert.ok(reviewBook.includes('公共区仍然共用'));
  });
  await check('坏 JSON 不会被空对象覆盖', async () => {
    const s = setup(structured, '{broken');
    await assert.rejects(s.K.铺底.apply(job(), suggestion), /保护现有内容/);
    assert.equal(s.files.get(sidePath).toString(), '{broken'); assert.equal(s.writes.length, 0);
  });
  await check('AI 初稿禁止覆盖已有提示词（含排队后的新建）', async () => {
    const s = setup(structured, sideData()); await assert.rejects(s.K.写提示词.prep(job()), /已经存在/);
    await assert.rejects(s.K.写提示词.apply(job(), '【提示词】\n本段事件：' + '测试内容'.repeat(50) + '\n【素材登记】\n[]'), /保留现有内容/);
    assert.equal(s.raw(), structured); assert.equal(s.writes.length, 0);
  });
  const pe = '\uFEFF【生成目标】\r\n甲给乙递书。\r\n\r\n【参考素材职责】\r\n@图片1用于甲的五官、发型和服装，不采用图片背景。\r\n\r\n【事件脚本】\r\n镜头1：甲递书。\r\n镜头2：乙接过。\r\n最终画面采用写实质感，声音包括无背景音乐。\r\n\r\n【保持一致】\r\n保持书只有一本。\r\n';
  const peSide = () => ({ 写法: '分镜', 分镜稿: pe, 自由稿: '', 镜头信息: [{ id: 'pe-a', no: '1', 作用: '', 标题: '递书' }, { id: 'pe-b', no: '2', 作用: '', 标题: '' }] });
  await check('PE 稿：铺底任务书照 PE 格式、建议的分区名照收，正文不动', async () => {
    const s = setup(pe, peSide()), j = job();
    const book = await s.K.铺底.book(j);
    assert.ok(book.includes('## 提示词格式（照 sd25-pe）')); assert.ok(book.includes('## 写戏规矩')); assert.ok(book.includes('"主体与关系"'));
    assert.doesNotMatch(book, /seedance-prompt-format/);
    await s.K.铺底.apply(j, JSON.stringify({ 基础建议: { 主体与关系: '画面中共有两个人。', 画面与声音: '' }, 关键词: { 1: { 动作: ['递书'] } } }));
    assert.deepEqual(s.side().基础建议, { 主体与关系: '画面中共有两个人。' });
    assert.deepEqual(s.side().镜头关键词['pe-a'], { 动作: ['递书'] });
    assert.equal(s.raw(), pe);
  });
  await check('PE 稿：要关键词认「镜头1：」一行一镜，标题取写稿资料', async () => {
    const s = setup(pe, peSide()), j = { ...job(), 镜头号: '1', 镜头ID: 'pe-a' };
    await s.K.要关键词.prep(j); const book = await s.K.要关键词.book(j);
    assert.ok(book.includes('用户在写镜头1｜递书')); assert.ok(book.includes('## 当前文字\n甲递书。\n'));
  });
  await check('PE 稿：AI 批注的原文抄了「镜头N：」也能对上，段名行不当原文', async () => {
    const s = setup(pe, peSide()), j = { ...job(), 渠道: 'claude' };
    const book = await s.K.批注提示词.book(j);
    assert.ok(book.includes('生成目标和事件脚本多半是人自己写的')); assert.doesNotMatch(book, /seedance-prompt-format/);
    await s.K.批注提示词.apply(j, '总评：还行\n## 1\n- 位置：镜头1\n- 级别：提醒\n- 原文：镜头1：甲递书。\n- 批注：写清怎么递\n- 改成：镜头1：甲双手把书递过去。\n## 2\n- 位置：保持一致\n- 原文：【保持一致】\n- 批注：再加一条');
    const md = [...s.files.entries()].find(([p]) => p.endsWith('_AI批注.md'))[1].toString();
    assert.ok(md.includes('- 原文：甲递书。')); assert.ok(md.includes('- 改成：甲双手把书递过去。'));
    assert.doesNotMatch(md, /原文：【保持一致】/);
  });
  await check('写提示词任务书只照 sd25-pe，回的稿从【生成目标】读起', async () => {
    const book = fs.readFileSync(backend, 'utf8');
    assert.doesNotMatch(book, /seedance-prompt-format'\)/);
    const s = setup(structured, sideData());
    s.files.delete(promptPath);
    await s.K.写提示词.apply(job(), '好的，下面是稿子\n【提示词】\n【生成目标】\n' + '甲给乙递书。'.repeat(20) + '\n\n【事件脚本】\n镜头1：甲递书。\n【素材登记】\n[]');
    assert.ok(s.raw().startsWith('【生成目标】\n'));
  });
  console.log(tested + ' 项回归检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
