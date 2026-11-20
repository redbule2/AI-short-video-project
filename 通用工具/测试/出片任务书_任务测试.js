'use strict';
// node 通用工具/测试/出片任务书_任务测试.js
// 出片任务书第五节（11-18 他定）：批准出片时不填积分上限，Codex 报完价直接提交，不再停下问；填了上限，报价超过才停。
// 样片名（11-18 他定）：下载下来的样片和提示词同名，4-6.txt 出的叫 4-6.mp4；同一版再出一条 4-6_2.mp4。
// 页面估价（提示词.html 的 priceOf）和任务书里的估价是同一张表，两边对一遍。
// 登记照任务书写齐（11-19）：批准出片时参考素材映射里这一条改成和任务书一样，正文指纹和 核对参考素材.py 同一算法，Codex 不再因登记对不上停下。
// 项目读写都在内存里；即梦核对、认画布节点换成假的，不碰真项目，不调即梦命令行。
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
const fail = code => Object.assign(new Error(code), { code });

function setup(dirs = {}) {
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
  const jm = Object.assign(async () => ({ nick: '测试号', name: '测试画布' }), { create: async () => { throw Error('测试不新建画布'); } });
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn() { throw Error('测试不能调用外部命令'); } }
      : name === './jm-check.js' ? () => jm : name === './canvas.js' ? () => ({ versions: async () => [], plan: () => '' })
      : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  return { K: api.KINDS, files };
}
async function bookOf(参数, dirs) {
  const s = setup(dirs);
  await s.K.出片任务书.run({ 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数 });
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
    await s.K.出片任务书.run({ 项目: '测试', 段: '1-1', 名: '4-6_补1.txt', 参数: { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 } });
    const book = s.files.get(pjt('提示词', '第1-1段', '4-6_出片任务_补1.txt')).toString('utf8');
    assert.match(book, /第1-1段出一条视频：4-6_补1，/);
    assert.match(book, /下载到 \S*\/成片\/第1-1段\/4-6_补1\.mp4。/);
    assert.match(book, /名字写：第1-1段｜4-6_补1｜样片480p｜10秒/);
    assert.doesNotMatch(book, /补片|剪进/);
  });
  await check('接力稿（11-19）：1_改8_后半条.txt 的任务书叫 1_出片任务_改8_后半条.txt，样片 1_改8_后半条.mp4，出过了接着排 _2', async () => {
    const s = setup({ [pjt('成片', '第1-1段')]: ['1_改7_前半条.mp4', '1_改8_前后接起来.mp4'], [pjt('历史记录', '成片', '第1-1段')]: ['1_改8_后半条.mp4'] });
    s.files.set(pjt('提示词', '第1-1段', '1_改8_后半条.txt'), s.files.get(promptPath));
    await s.K.出片任务书.run({ 项目: '测试', 段: '1-1', 名: '1_改8_后半条.txt', 参数: { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 } });
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
  const manAt = '资产/全局资产/人物/洪七公.png', potAt = '资产/全局资产/道具/砂锅.png';
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
    const r = await s.K.出片任务书.run({ 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 });
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
    const r = await s.K.出片任务书.run({ 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 });
    assert.equal(s.files.get(mapPath), before);   // 没重写
    assert.doesNotMatch(r.结果, /补好/);
    assert.match(s.files.get(taskPath).toString('utf8'), /登记：资产\/参考素材映射\.json/);
  });
  await check('没挂素材的稿：不新建登记，任务书也不写登记那一句', async () => {
    const s = setup();
    await s.K.出片任务书.run({ 项目: '测试', 段: '1-1', 名: '4-6.txt', 参数: P480 });
    assert.equal(s.files.has(mapPath), false);
    assert.doesNotMatch(s.files.get(taskPath).toString('utf8'), /登记：/);
  });
  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
