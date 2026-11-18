'use strict';
// node 通用工具/测试/出片任务书_任务测试.js
// 出片任务书第五节（11-18 他定）：批准出片时不填积分上限，Codex 报完价直接提交，不再停下问；填了上限，报价超过才停。
// 样片名（11-18 他定）：下载下来的样片和提示词同名，4-6.txt 出的叫 4-6.mp4；同一版再出一条 4-6_2.mp4。
// 页面估价（提示词.html 的 priceOf）和任务书里的估价是同一张表，两边对一遍。
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
  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exitCode = 1; });
