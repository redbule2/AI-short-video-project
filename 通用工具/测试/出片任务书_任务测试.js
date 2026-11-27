'use strict';
// node 通用工具/测试/出片任务书_任务测试.js
// 出片任务书第五节（11-18 他定）：批准出片时不填积分上限，Codex 报完价直接提交，不再停下问；填了上限，报价超过才停。
// 样片名（11-18 他定）：下载下来的样片和提示词同名，4-6.txt 出的叫 4-6.mp4；同一版再出一条 4-6_2.mp4。
// 页面估价（提示词.html 的 priceOf）和任务书里的估价是同一张表，两边对一遍。
// 登记照任务书写齐（11-19）：批准出片时参考素材映射里这一条改成和任务书一样，正文指纹和 核对参考素材.py 同一算法，Codex 不再因登记对不上停下。
// 出片计划（11-21）：任务书同一回写一份机器读的 出片计划.json；批准出片照任务书的 SHA-256 认出它，交给流水线自己出（jm-video.js，另有 流水线出片_测试.cjs）。
// 项目读写都在内存里；即梦核对、认画布节点、自己出片换成假的，不碰真项目，不调即梦命令行。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const pjt = (...x) => path.join(root, '项目', '测试', ...x);
const promptPath = pjt('提示词', '第1-1段', '4-6.txt');
const taskPath = pjt('提示词', '第1-1段', '4-6_出片任务.txt');
const DIR = pjt('历史记录', 'AI任务', '20261121-120000_出片任务书_第1-1段');   // 这一回的任务文件夹：出片计划.json 写在这里（11-21）
const fail = code => Object.assign(new Error(code), { code });

function setup(dirs = {}, opt = {}) {
  const files = new Map([
    [promptPath, Buffer.from('【基础设定】\n写实。\n\n【事件脚本】\n0-13秒：洪七公把草药投进砂锅。\n')],
    [pjt('资产', '出片设置.json'), Buffer.from(JSON.stringify({ 画布: 'https://jimeng.jianying.com/ai-tool/ai-canvas/7bec76b5-4184-4d2c-9b1e-a332e7317853' }))],
  ]);
  const mockFs = {
    existsSync: p => files.has(p),
    promises: {
      async readFile(p, encoding) {
        if (!files.has(p)) throw fail('ENOENT');
        return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p));
      },
      async stat(p) { if (!files.has(p)) throw fail('ENOENT'); return { mtimeMs: 0 }; },
      async mkdir() {}, async readdir(p) { return dirs[p] || []; },
      async writeFile(p, data) { files.set(p, Buffer.from(data)); },
      async rename(from, to) { if (!files.has(from)) throw fail('ENOENT'); files.set(to, files.get(from)); files.delete(from); },
      async copyFile(from, to) { if (!files.has(from)) throw fail('ENOENT'); files.set(to, Buffer.from(files.get(from))); },
    },
  };
  const jm = opt.jm || Object.assign(async () => ({ nick: '测试号', name: '测试画布' }), { create: async () => { throw Error('测试不新建画布'); } });   // opt.jm：换个假的即梦核对（换号出片那几条用）
  const gone = [];   // 交给 jm-video.js 出片的
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn() { throw Error('测试不能调用外部命令'); } }
      : name === './jm-check.js' ? () => jm : name === './canvas.js' ? () => ({ versions: async () => [], plan: () => '' })
      : name === './jm-video.js' ? () => ({ go: async (j, plan, dir) => { gone.push({ j, plan, dir }); return { 结果: '出好了（假的）', 产出: [] }; } })   // 真出片的那一截另有测试（流水线出片_测试.cjs）
      : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  return { K: api.KINDS, files, gone, handle: api.handle };
}
async function bookOf(参数, dirs) {
  const s = setup(dirs);
  await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数 });
  return s.files.get(taskPath).toString('utf8');
}
const html = fs.readFileSync(path.join(__dirname, '../流水线/提示词.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const priceCode = script.slice(script.indexOf('function priceOf('), script.indexOf('\n/* 批准出片', script.indexOf('function priceOf(')));
const priceOf = vm.runInNewContext(priceCode + '\npriceOf;', {});

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };
  await check('没填积分上限：报完价直接提交，不再等人点头', async () => {
    const book = await bookOf({ 模型: 'Seedance 2.5', 清晰度: '720p', 秒数: 13, 积分上限: 0 });
    const five = book.slice(book.indexOf('五、核对、报价、提交'), book.indexOf('六、等待与下载'));
    assert.match(five, /不用再问我/);
    assert.match(five, /把这次的报价当作批准的积分上限，直接完成服务端确认、提交/);
    assert.match(five, /服务端要确认，不算要停下问我的情况/);
    assert.doesNotMatch(five, /点头|不要提交|报出价钱以后停下/);
  });
  await check('填了积分上限：不超过就直接提交，超过才停在草稿', async () => {
    const book = await bookOf({ 模型: 'Seedance 2.5', 清晰度: '720p', 秒数: 13, 积分上限: 300 });
    const five = book.slice(book.indexOf('五、核对、报价、提交'), book.indexOf('六、等待与下载'));
    assert.match(five, /用户批准的积分上限是 300：报价不超过它，就直接完成服务端确认、提交，不用再问我；超过就停在草稿/);
    assert.doesNotMatch(five, /当作批准的积分上限/);
  });
  await check('页面估价：2.5 720p 每秒 13，带白模 26；没实扣过的不估', async () => {
    assert.deepEqual({ ...priceOf('Seedance 2.5', '720p', 13, false) }, { per: 13, total: 169 });
    assert.deepEqual({ ...priceOf('Seedance 2.5', '720p', 6, true) }, { per: 26, total: 156 });
    assert.deepEqual({ ...priceOf('Seedance 2.5 样片', '480p', 10, true) }, { per: 18, total: 180 });
    assert.equal(priceOf('Seedance 2.5', '1080p', 10, false), null);
  });
  await check('页面估价和任务书写的预计积分对得上（不带白模的几种）', async () => {
    for (const [模型, 清晰度] of [['Seedance 2.5', '720p'], ['Seedance 2.5 样片', '480p'], ['Seedance 2.5', '1080p'], ['Seedance 2.0 mini', '720p']]) {
      const book = await bookOf({ 模型, 清晰度, 秒数: 10, 积分上限: 0 }), p = priceOf(模型, 清晰度, 10, false);
      const m = /这一条预计约 (\d+) 积分/.exec(book);
      assert.equal(m ? +m[1] : null, p ? p.total : null, 模型 + ' ' + 清晰度);
    }
  });
  await check('样片和提示词同名：4-6.txt 出的下载成 4-6.mp4，节点名也写 4-6；同一版再出一条接着排 _2、_3', async () => {
    const P = { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 };
    const book = await bookOf(P);
    assert.match(book, /下载到 \S*\/项目\/测试\/成片\/第1-1段\/4-6\.mp4。/);
    assert.match(book, /名字写：第1-1段｜4-6｜样片480p｜10秒（下称节点A）/);
    assert.doesNotMatch(book, /第[0-9]+条/);
    const again = await bookOf(P, { [pjt('成片', '第1-1段')]: ['4-6.mp4', '4-6_批注.md', '4-5.mp4'], [pjt('历史记录', '成片', '第1-1段')]: ['4-6_2.mp4', '第1-1段_第7条_4-6_样片480p.mp4'] });
    assert.match(again, /下载到 \S*\/成片\/第1-1段\/4-6_3\.mp4。/);   // 移进历史记录的名字不改，也让开
    assert.match(again, /名字写：第1-1段｜4-6_3｜/);
  });
  await check('以前的补片稿照正片出（11-18 他定）：4-6_补1.txt 出的下载成 4-6_补1.mp4，任务书 4-6_出片任务_补1.txt，不剪进样片', async () => {
    const s = setup({ [pjt('成片', '第1-1段')]: ['4-6.mp4', '第1-1段_第4条_4-6_720p.mp4'] });
    s.files.set(pjt('提示词', '第1-1段', '4-6_补1.txt'), s.files.get(promptPath));
    await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6_补1.txt', 参数: { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 } });
    const book = s.files.get(pjt('提示词', '第1-1段', '4-6_出片任务_补1.txt')).toString('utf8');
    assert.match(book, /第1-1段出一条视频：4-6_补1，/);
    assert.match(book, /下载到 \S*\/成片\/第1-1段\/4-6_补1\.mp4。/);
    assert.match(book, /名字写：第1-1段｜4-6_补1｜样片480p｜10秒/);
    assert.doesNotMatch(book, /补片|剪进/);
  });
  await check('接力稿（11-19）：1_改8_后半条.txt 的任务书叫 1_出片任务_改8_后半条.txt，样片 1_改8_后半条.mp4，出过了接着排 _2', async () => {
    const s = setup({ [pjt('成片', '第1-1段')]: ['1_改7_前半条.mp4', '1_改8_前后接起来.mp4'], [pjt('历史记录', '成片', '第1-1段')]: ['1_改8_后半条.mp4'] });
    s.files.set(pjt('提示词', '第1-1段', '1_改8_后半条.txt'), s.files.get(promptPath));
    await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '1_改8_后半条.txt', 参数: { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 } });
    const book = s.files.get(pjt('提示词', '第1-1段', '1_出片任务_改8_后半条.txt')).toString('utf8');
    assert.match(book, /第1-1段出一条视频：1_改8_后半条，/);
    assert.match(book, /下载到 \S*\/成片\/第1-1段\/1_改8_后半条_2\.mp4。/);   // 移进历史记录的 1_改8_后半条.mp4 也让开
    assert.match(book, /名字写：第1-1段｜1_改8_后半条_2｜样片480p｜10秒/);
    assert.equal(s.K.出片.title({ 段: '1-1', 名: '1_出片任务_改8_后半条.txt' }), '出片 · 第1-1段 镜头1 改8 后半条');   // 任务书认回提示词
  });
  // 登记照任务书写齐（11-19）：写稿页改了字，登记还是旧指纹，Codex 跑 核对参考素材.py 就停下。批准出片时登记改成和任务书一样
  const crypto = require('node:crypto'), sha = b => crypto.createHash('sha256').update(b).digest('hex'), BOM = String.fromCharCode(0xFEFF);
  const pyHash = t => sha(Buffer.from((t.startsWith(BOM) ? t.slice(1) : t).replace(/\r\n/g, '\n').replace(/\r/g, '\n'), 'utf8'));   // 照抄 核对参考素材.py 的 normalize_prompt（读文件时 utf-8-sig 已去掉一个 BOM）
  const key = '提示词/第1-1段/4-6.txt', mapPath = pjt('资产', '参考素材映射.json'), P480 = { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 };
  const manAt = '资产/人物和道具/洪七公.png', potAt = '资产/人物和道具/砂锅.png';
  const refText = '【基础设定】\r\n写实。\r\n\r\n【素材】\r\n洪七公@图片1，砂锅@图片2。\r\n\r\n【事件脚本】\r\n0-13秒：洪七公把草药投进砂锅。\r\n';   // CRLF：指纹要照 LF 算
  const withRefs = (entry, text = refText) => {
    const s = setup();
    s.files.set(promptPath, Buffer.from(BOM + text));
    s.files.set(pjt(...manAt.split('/')), Buffer.from('新换的洪七公图')); s.files.set(pjt(...potAt.split('/')), Buffer.from('砂锅图'));
    if (entry) s.files.set(mapPath, Buffer.from(JSON.stringify({ schema_version: 1, prompts: { [key]: entry, '提示词/第1-1段/别的.txt': { prompt_sha256: 'a'.repeat(64), references: [] } } }, null, 2) + '\n'));
    return s;
  };
  const regOf = s => JSON.parse(s.files.get(mapPath).toString('utf8')).prompts;
  await check('登记过时（字改过、图换过、多登了正文不用的号）：批准出片后登记和任务书一样，指纹和 核对参考素材.py 同一算法', async () => {
    const s = withRefs({ prompt_sha256: 'f'.repeat(64), references: [
      { ref: '@图片1', name: '洪七公', path: manAt, sha256: 'e'.repeat(64) },
      { ref: '@图片2', name: '砂锅', path: potAt, sha256: sha(Buffer.from('砂锅图')) },
      { ref: '@图片3', name: '删掉的那张', path: potAt, sha256: 'd'.repeat(64) }], 秒数: { 镜头: { 1: 13 }, 记号: 'k' } });
    const r = await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 });
    const reg = regOf(s), e = reg[key];
    assert.equal(e.prompt_sha256, pyHash(refText));
    assert.notEqual(e.prompt_sha256, sha(s.files.get(promptPath)));   // 不再照原样字节算（带 BOM、CRLF 的稿以前就对不上）
    assert.deepEqual(e.references, [{ ref: '@图片1', name: '洪七公', path: manAt, sha256: sha(Buffer.from('新换的洪七公图')) }, { ref: '@图片2', name: '砂锅', path: potAt, sha256: sha(Buffer.from('砂锅图')) }]);   // 只留正文用到的；任务书里的「换」「节点」不进登记
    assert.deepEqual(e.秒数, { 镜头: { 1: 13 }, 记号: 'k' });   // 别的不动
    assert.deepEqual(reg['提示词/第1-1段/别的.txt'], { prompt_sha256: 'a'.repeat(64), references: [] });   // 别的稿不动
    const book = s.files.get(taskPath).toString('utf8');
    assert.match(book, /SHA-256 (\w+)。\n登记：资产\/参考素材映射\.json 里这份稿的登记，生成任务书时已照这份任务书写齐/);
    assert.equal(/核对：非空行 \d+ 行，SHA-256 (\w+)。/.exec(book)[1], sha(s.files.get(promptPath)));   // 任务书照旧写文件原样的指纹（Codex 拿文件比）
    assert.match(book, /不要自己改登记/);
    assert.match(r.结果, /登记已照任务书补好/);
  });
  await check('登记本来就对：登记文件一个字不动，结果里也不说补登记', async () => {
    const s = withRefs({ prompt_sha256: pyHash(refText), references: [
      { ref: '@图片1', name: '洪七公', path: manAt, sha256: sha(Buffer.from('新换的洪七公图')) },
      { ref: '@图片2', name: '砂锅', path: potAt, sha256: sha(Buffer.from('砂锅图')) }] });
    const before = s.files.get(mapPath);
    const r = await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 });
    assert.equal(s.files.get(mapPath), before);   // 没重写
    assert.doesNotMatch(r.结果, /补好/);
    assert.match(s.files.get(taskPath).toString('utf8'), /登记：资产\/参考素材映射\.json/);
  });
  await check('出片计划（11-21 起流水线自己出片照它做）：和任务书同一回写在任务文件夹，任务书指纹、节点名、存到、素材都和任务书一样', async () => {
    const s = withRefs({ prompt_sha256: pyHash(refText), references: [
      { ref: '@图片1', name: '洪七公', path: manAt, sha256: sha(Buffer.from('新换的洪七公图')) },
      { ref: '@图片2', name: '砂锅', path: potAt, sha256: sha(Buffer.from('砂锅图')) }] });
    await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: { ...P480, 积分上限: 200 } });
    const book = s.files.get(taskPath), plan = JSON.parse(s.files.get(path.join(DIR, '出片计划.json')).toString('utf8'));
    assert.equal(plan.任务书SHA, sha(book));   // 出片时照任务书的 SHA-256 认是哪一回排的
    assert.equal(plan.任务书, '提示词/第1-1段/4-6_出片任务.txt');
    assert.equal(plan.画布号, '7bec76b5-4184-4d2c-9b1e-a332e7317853');
    assert.equal(plan.节点名, '第1-1段｜4-6｜样片480p｜10秒');
    assert.match(book.toString('utf8'), new RegExp('名字写：' + plan.节点名 + '（下称节点A）'));
    assert.equal(plan.存到, '成片/第1-1段/4-6.mp4');
    assert.deepEqual([plan.模型, plan.清晰度, plan.秒数, plan.积分上限], ['Seedance 2.5 样片', '480p', 10, 200]);
    assert.deepEqual(plan.提示词, { 路径: '提示词/第1-1段/4-6.txt', sha256: sha(s.files.get(promptPath)) });
    assert.deepEqual(plan.素材.map(r => [r.ref, r.name, r.path, r.sha256]), [['@图片1', '洪七公', manAt, sha(Buffer.from('新换的洪七公图'))], ['@图片2', '砂锅', potAt, sha(Buffer.from('砂锅图'))]]);
    assert.equal(plan.素材[0].节点名, '人物和道具_洪七公');
  });
  await check('没挂素材的稿：不新建登记，任务书也不写登记那一句', async () => {
    const s = setup();
    await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 });
    assert.equal(s.files.has(mapPath), false);
    assert.doesNotMatch(s.files.get(taskPath).toString('utf8'), /登记：/);
  });
  // 出片（11-21 起流水线自己做）：照任务书的 SHA-256 找同一回排的出片计划，交给 jm-video.js；服务重开后接着做
  const runDir = pjt('历史记录', 'AI任务', '20261121-120100_出片_第1-1段'), ok = { 项目: '测试', 段: '1-1', 名: '4-6_出片任务.txt', 批准: '用户点了批准出片', dir: runDir };
  const planned = async () => { const s = setup({ [pjt('历史记录', 'AI任务')]: ['20261121-115900_出片任务书_第1-1段', '20261121-120000_出片任务书_第1-1段', '20261121-120000_出图_第1-1段'] }); await s.K.出片任务书.run({ dir: DIR, 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 }); return s; };
  await check('批准出片：照任务书指纹认出同一回排的出片计划，交给流水线自己出；记下接着做要的 自己交.json', async () => {
    const s = await planned();
    const r = await s.K.出片.run({ ...ok });
    assert.equal(r.结果, '出好了（假的）');
    assert.equal(s.gone.length, 1);
    assert.equal(s.gone[0].plan.任务书SHA, sha(s.files.get(taskPath)));
    assert.equal(s.gone[0].dir, runDir);
    const m = JSON.parse(s.files.get(path.join(runDir, '自己交.json')).toString('utf8'));
    assert.deepEqual([m.方式, m.run, m.本机], ['self', true, true]);
    assert.equal(s.K.出片.local, true);   // 后台任务里写「流水线」，不写 AI
  });
  await check('任务书排好以后又改过、没点批准、试验服务：都不出片', async () => {
    let s = await planned();
    s.files.set(taskPath, Buffer.from(s.files.get(taskPath).toString('utf8') + '多一句\n'));
    await assert.rejects(s.K.出片.run({ ...ok }), /没找到这份任务书排的出片计划/);
    s = await planned();
    await assert.rejects(s.K.出片.run({ ...ok, 批准: '' }), /出片要用户在页面上点「批准出片」/);
    process.env.ANTOU_MOCK_DIR = 'x';
    try { await assert.rejects(s.K.出片.run({ ...ok }), /这是试验服务：不真出片/); } finally { delete process.env.ANTOU_MOCK_DIR; }
    assert.equal(s.gone.length, 0);
  });
  await check('服务重开后接着做：有 出片进度.json 的交给流水线接着做（不再核账号、不再记出片记录）', async () => {
    const s = await planned();
    s.files.set(path.join(runDir, '出片进度.json'), Buffer.from('{}'));
    await s.K.出片.run({ ...ok, 续: true });
    assert.equal(s.gone.length, 1);
    assert.equal(s.gone[0].plan, null);   // 照 出片进度.json 里存的那份
    assert.equal(s.files.has(pjt('资产', '第1-1段_出片记录.json')), false);
    // 11-21 以前交给 Codex、重开前还在等它回话的：照旧接着等，任务存盘_测试.cjs 里试
  });
  /* 11-26 他要：原来的号没积分了，换个号出。页面问服务：那个号名下有哪些画布（GET canvases）、换过去（POST switch） */
  const PRE = 'https://jimeng.jianying.com/ai-tool/ai-canvas/', OLD = '7bec76b5-4184-4d2c-9b1e-a332e7317853', NEW = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', MADE = '11111111-2222-4333-8444-555555555555';
  const swapSetup = () => {
    const calls = [], plain = m => Object.assign(new Error(m), { plain: true });
    const jm = Object.assign(async (url, pf) => { calls.push('核对 ' + url.slice(-36) + ' ' + (pf || '默认')); if (pf === 'guest') throw plain('画布不在即梦登录位「guest」名下'); return { nick: pf ? '奔跑' : '测试号', name: url.endsWith(MADE) ? '测试' : '新号的画布' }; }, {
      create: async (name, pf) => { calls.push('新建 ' + name + ' ' + (pf || '默认')); return { id: MADE, url: PRE + MADE, name }; },
      urlOf: id => PRE + String(id).toLowerCase(),
      list: async pf => { if (pf === 'guest') throw plain('查不到即梦登录位「guest」名下有哪些画布：没登录'); return [{ id: NEW, name: '新号的画布', url: PRE + NEW, 改于: 2 }]; },
    });
    const s = setup({}, { jm });
    s.files.set(pjt(), Buffer.alloc(0));   // 内存里的假文件夹：项目在
    const ask = async (method, qs) => { let out; await s.handle({ method }, {}, new URL('http://x/api/jimeng?' + qs), { json: (res, o) => { out = JSON.parse(JSON.stringify(o)); }, httpErr: (code, m) => Object.assign(new Error(m), { status: code }), readBody: async () => Buffer.alloc(0) }); return out; };
    const setOf = () => JSON.parse(s.files.get(pjt('资产', '出片设置.json')).toString('utf8'));
    return { s, calls, ask, setOf };
  };
  const P = 'p=' + encodeURIComponent('测试');
  await check('换号出片：列出那个号名下的画布；查不到的照实说，不当成服务出错', async () => {
    const { ask } = swapSetup();
    assert.deepEqual(await ask('GET', 'canvases=1&profile=benpao'), { ok: true, items: [{ id: NEW, name: '新号的画布', url: PRE + NEW, 改于: 2 }] });
    assert.deepEqual(await ask('GET', 'canvases=1&profile=guest'), { ok: false, error: '查不到即梦登录位「guest」名下有哪些画布：没登录' });
  });
  await check('换号出片：挑了那个号名下的一张——出片设置换成新的一对，换下来的记在「换下的」里；别的设置照留', async () => {
    const { ask, setOf, calls } = swapSetup();
    const r = await ask('POST', 'switch=1&' + P + '&profile=benpao&to=' + NEW.toUpperCase());
    assert.deepEqual(r, { ok: true, 画布: PRE + NEW, 登录位: 'benpao', 账号: '奔跑', 画布名: '新号的画布', 新建: false });
    const set = setOf();
    assert.equal(set.画布, PRE + NEW);
    assert.equal(set.登录位, 'benpao');
    assert.equal(set.换下的.length, 1);
    assert.deepEqual({ 画布: set.换下的[0].画布, 登录位: set.换下的[0].登录位 }, { 画布: PRE + OLD, 登录位: '' });
    assert.match(set.换下的[0].换于, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    assert.deepEqual(calls, ['核对 ' + NEW + ' benpao'], '挑现成的不新建');
    await ask('POST', 'switch=1&' + P + '&profile=&to=' + OLD);   // 充了积分，换回原来的号
    const back = setOf();
    assert.equal(back.画布, PRE + OLD);
    assert.equal(back.登录位, '');
    assert.deepEqual(back.换下的.map(x => [x.画布, x.登录位]), [[PRE + NEW, 'benpao']], '换回去：原来那一对从「换下的」里拿掉，刚换下的记上，不越记越长');
    await ask('POST', 'switch=1&' + P + '&profile=&to=' + OLD);   // 再点一回同样的：什么都不变
    assert.deepEqual(setOf(), back);
  });
  await check('换号出片：没挑画布（那个号没有画布）——新建一张、名字写项目名，再换过去', async () => {
    const { ask, setOf, calls } = swapSetup();
    const r = await ask('POST', 'switch=1&' + P + '&profile=benpao');
    assert.deepEqual(r, { ok: true, 画布: PRE + MADE, 登录位: 'benpao', 账号: '奔跑', 画布名: '测试', 新建: true });
    assert.deepEqual(calls, ['新建 测试 benpao', '核对 ' + MADE + ' benpao']);
    assert.equal(setOf().画布, PRE + MADE);
  });
  await check('换号出片：画布不在那个号名下、编号不对、没有这个项目——照实说，出片设置一个字不动', async () => {
    const { ask, setOf } = swapSetup(), before = JSON.stringify(setOf());
    assert.deepEqual(await ask('POST', 'switch=1&' + P + '&profile=guest&to=' + NEW), { ok: false, error: '画布不在即梦登录位「guest」名下' });
    assert.deepEqual(await ask('POST', 'switch=1&' + P + '&profile=benpao&to=不是编号'), { ok: false, error: '画布编号不对' });
    assert.deepEqual(await ask('POST', 'switch=1&p=' + encodeURIComponent('没有的项目') + '&profile=benpao&to=' + NEW), { ok: false, error: '没有这个项目' });
    assert.equal(JSON.stringify(setOf()), before);
  });
  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
