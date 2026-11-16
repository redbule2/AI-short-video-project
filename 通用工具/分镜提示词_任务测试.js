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
  await check('自由模式的稿：AI 批注不挑分镜格式，公共区照实核对，稿子不动', async () => {
    const freeShots = '先看向门口\r\n\r\n  停顿，然后开口。';
    const raw = '\uFEFF本段事件：原事件\r\n素材\r\n@图片1 原图\r\n基础设定\r\n原风格\r\n本段\r\n原场景\r\n分镜\r\n' + freeShots + '\r\n保持一致：原约束\r\n';
    const s = setup(raw, { ...sideData(), 写法: '自由', 写法范围: '分镜', 自由稿: freeShots });
    const reviewBook = await s.K.批注提示词.book(job());
    assert.ok(reviewBook.includes('用户只把分镜写成自由文本'));
    assert.ok(reviewBook.includes('公共区仍然共用'));
    assert.ok(reviewBook.includes(raw.slice(1)));   // 整份稿（连公共区）都给 AI 看
    assert.equal(s.raw(), raw); assert.equal(s.writes.length, 0);
  });
  await check('AI 初稿禁止覆盖已有提示词（含排队后的新建）', async () => {
    const s = setup(structured, sideData()); await assert.rejects(s.K.写提示词.prep(job()), /已经存在/);
    await assert.rejects(s.K.写提示词.apply(job(), '【提示词】\n本段事件：' + '测试内容'.repeat(50) + '\n【素材登记】\n[]'), /保留现有内容/);
    assert.equal(s.raw(), structured); assert.equal(s.writes.length, 0);
  });
  const pe = '\uFEFF【生成目标】\r\n甲给乙递书。\r\n\r\n【参考素材职责】\r\n@图片1用于甲的五官、发型和服装，不采用图片背景。\r\n\r\n【事件脚本】\r\n镜头1：甲递书。\r\n镜头2：乙接过。\r\n最终画面采用写实质感，声音包括无背景音乐。\r\n\r\n【保持一致】\r\n保持书只有一本。\r\n';
  const peSide = () => ({ 写法: '分镜', 分镜稿: pe, 自由稿: '', 镜头信息: [{ id: 'pe-a', no: '1', 作用: '', 标题: '递书' }, { id: 'pe-b', no: '2', 作用: '', 标题: '' }] });
  await check('坏 JSON 不会被空对象覆盖：AI 铺底读不了写稿资料就不存', async () => {
    const s = setup(pe, '{broken');
    await assert.rejects(s.K.直接铺底.apply(job(), '【基础设定】\n影像风格：写实。\n【保持一致】\n保持书只有一本。'), /保护现有内容/);
    assert.equal(s.files.get(sidePath).toString(), '{broken'); assert.equal(s.raw(), pe); assert.equal(s.writes.length, 0);
    assert.equal(s.locks.length, 1);   // 和页面存盘同一把锁
  });
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
  await check('写提示词：没写哪段戏就写整段、别的条不附；写了哪段才只写那段、附上别的条', () => {
    const sc = setup(structured, sideData()).K.写提示词.scope, two = [{ f: '视频提示词.txt', no: 1, text: '第一条' }];
    const whole = sc(2, two, '', null);
    assert.match(whole.text, /这一份是第 2 条，写这一场整段戏，从开头写到结尾。/); assert.equal(whole.others.length, 0);
    assert.doesNotMatch(whole.text, /接着|留给下一条|留给别的条/);
    const part = sc(2, two, '小磊进门到坐下', null);
    assert.match(part.text, /这一条写这段戏：小磊进门到坐下。/); assert.match(part.text, /另外还有 1 条/); assert.equal(part.others, two);
    assert.match(sc(1, [], '', [2, 3]).text, /只写段落 2 到段落 3/);   // 老请求带着段落范围的照旧
  });
  console.log(tested + ' 项回归检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
