'use strict';
// node 通用工具/测试/任务存盘_测试.cjs
// 11-18 他说：后台任务不能刷新就丢。本机服务的任务记进各项目的 历史记录/AI任务/任务清单.json，服务重开时读回来；
// 交给 AI 等回复的出片（还有改图、记着有没有图的出图）重开后接着等，同一个号。项目读写都在内存里，不碰真项目、不调外部程序。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const DIR = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const backend = path.join(DIR, 'jobs.js');
const makeStore = require(path.join(DIR, 'job-store.js'));
const root = path.resolve(__dirname, '__内存测试根__');
const HOME = path.join(root, '项目');
const pj = (name, ...parts) => path.join(HOME, name, ...parts);
const LIST = (p) => pj(p, '历史记录', 'AI任务', '任务清单.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
const two = n => String(n).padStart(2, '0');
const stampOf = d => d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
const nowText = d => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());

/* 内存里的文件：写文件时上面几层文件夹自动算上 */
function memFs() {
  const files = new Map(), dirs = new Set(), mtimes = new Map();
  let tick = 1;
  const addDirs = p => { for (let d = p; d.startsWith(root) && !dirs.has(d); d = path.dirname(d)) dirs.add(d); };
  const put = (p, data) => { files.set(p, Buffer.from(data)); mtimes.set(p, tick++); addDirs(path.dirname(p)); };
  const fsp = {
    async readFile(p, enc) { if (!files.has(p)) throw enoent(); return enc ? files.get(p).toString(enc) : Buffer.from(files.get(p)); },
    async writeFile(p, data) { put(p, data); },
    async stat(p) {
      if (dirs.has(p)) return { mtimeMs: 0, size: 0, isFile: () => false, isDirectory: () => true };
      if (!files.has(p)) throw enoent();
      return { mtimeMs: mtimes.get(p), size: files.get(p).length, isFile: () => true, isDirectory: () => false };
    },
    async mkdir(p) { addDirs(p); },
    async readdir(p) {
      if (!dirs.has(p)) throw enoent();
      return [...new Set([...files.keys(), ...dirs].filter(k => path.dirname(k) === p).map(k => path.basename(k)))];
    },
    async rename(a, b) { if (!files.has(a)) throw enoent(); put(b, files.get(a)); files.delete(a); },
    async unlink(p) { files.delete(p); },
    async utimes() {},
    async copyFile(a, b) { if (!files.has(a)) throw enoent(); put(b, files.get(a)); },
  };
  return { files, dirs, fsp, put, mkdir: p => addDirs(p), json: p => JSON.parse(files.get(p).toString('utf8')), mtime: p => mtimes.get(p) };
}

/* ---------- 一、job-store.js 自己：存、读回来、挤掉最早的 ---------- */
async function storeTests() {
  const F = memFs();
  F.mkdir(pj('甲')); F.mkdir(pj('乙'));
  F.put(path.join(HOME, '散文件.html'), '不是项目');
  const live = j => j.状态 === '排队' || j.状态 === '在做';
  const pub = j => j.旧 || { id: j.id, 事: j.事, 项目: j.项目, 段: j.段 || '', 标题: j.标题, 状态: j.状态, 步骤: j.步骤 || '', 建: j.建, 开始: j.开始 || 0, 结束: j.结束 || 0, 错误: j.错误 || '', 结果: j.结果 || '', 记录: j.记录 || '', 交给: j.交给 || null };
  const writeFile = (p, t) => F.fsp.writeFile(p, t);
  let T = 5000;
  const server = (MAX = 200) => {
    const jobs = [], byId = new Map(), logs = [];
    const S = makeStore({ fsp: F.fsp, path, ROOT: root, HOME, pj, writeFile, log: m => logs.push(m), pub, live, jobs, byId, MAX, now: () => T });
    const add = j => { jobs.push(j); byId.set(j.id, j); return j; };
    return { S, jobs, byId, logs, add };
  };

  // 存：各项目各一份；没变不重写；项目文件夹不在的不替它建
  const A = server();
  A.add({ id: 'a1', 事: '按批注改', 项目: '甲', 段: '1', 标题: '按批注改 · 第1段', 状态: '做完', 建: 100, 开始: 100, 结束: 200, 结果: '改好了' });
  A.add({ id: 'a2', 事: '提炼', 项目: '甲', 段: '1', 标题: '提炼 · 第1段', 状态: '在做', 步骤: 'AI 在写', 建: 300, 开始: 300 });
  A.add({ id: 'a3', 事: '出片', 项目: '甲', 段: '1', 标题: '出片 · 第1段', 状态: '在做', 建: 400, 开始: 400, 记录: '项目/甲/历史记录/AI任务/x_出片', 交给: { 方式: 'self', 等: '你' } });
  A.add({ id: 'a4', 事: '写字', 项目: '甲', 段: '1', 标题: '写字', 状态: '在做', 建: 500, 开始: 500, 记录: '项目/甲/历史记录/AI任务/y_写字', 交给: { 方式: 'self', 等: '你' } });
  A.add({ id: 'b1', 事: '出图', 项目: '乙', 段: '2', 标题: '出图 · 锅', 状态: '没成', 建: 150, 开始: 150, 结束: 160, 错误: '图没存到' });
  A.add({ id: 'c1', 事: '出图', 项目: '丙', 段: '1', 标题: '出图', 状态: '做完', 建: 10, 结束: 20 });
  await A.S.save();
  assert.deepEqual(F.json(LIST('甲')).任务.map(x => x.id), ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(F.json(LIST('乙')).任务.map(x => x.id), ['b1']);
  assert.ok(!F.files.has(LIST('丙')) && !F.dirs.has(pj('丙')), '项目文件夹不在：不替它建清单');
  const t1 = F.mtime(LIST('甲'));
  await A.S.save();
  assert.equal(F.mtime(LIST('甲')), t1, '没变不重写');
  A.byId.get('a2').步骤 = 'AI 在存盘';
  await A.S.save();
  assert.ok(F.mtime(LIST('甲')) > t1, '变了就写');

  // 重开：a3 是交给 AI 等回复的，resumeSelf 已经接回来了（同一个号）；a4 的 自己交.json 记着已经做完了；a2 接不上
  F.put(path.join(root, '项目', '甲', '历史记录', 'AI任务', 'y_写字', '自己交.json'), JSON.stringify({ id: 'a4', 结束: '2026-11-18 03:40:00', 状态: '做完' }));
  T = 9000;
  const B = server();
  B.add({ id: 'a3', 事: '出片', 项目: '甲', 段: '1', 标题: '出片 · 第1段', 状态: '在做', 建: 400, 开始: 400 });
  B.add({ id: 'n1', 事: '写字', 项目: '甲', 段: '1', 标题: '重开后新开的', 状态: '排队', 建: 8000 });
  const back = await B.S.restore();
  assert.deepEqual(back.map(j => j.id).sort(), ['a1', 'a2', 'a4', 'b1']);
  assert.deepEqual(B.jobs.map(j => j.id), ['a1', 'b1', 'a2', 'a3', 'a4', 'n1'], '照开的先后排');
  const got = id => pub(B.byId.get(id));
  assert.equal(got('a1').状态, '做完'); assert.equal(got('a1').结果, '改好了');
  assert.equal(got('b1').错误, '图没存到');
  assert.equal(got('a2').状态, '没成'); assert.equal(got('a2').错误, B.S.LOST); assert.equal(got('a2').结束, 9000, '接不上的结束时间算重开那一刻：抽屉「刚做完的」里看得见');
  assert.equal(got('a2').步骤, '');
  assert.equal(got('a4').状态, '做完'); assert.equal(got('a4').结束, new Date(2026, 10, 18, 3, 40, 0).getTime(), '自己交.json 里记着做完了：照它说');
  assert.equal(got('a4').交给, null);
  assert.ok(!live(B.byId.get('a2')) && !live(B.byId.get('a4')), '摆回去的不再算在做');
  assert.equal(B.byId.get('a3').旧, undefined, '接回来的照常做事');
  assert.ok(B.logs.some(m => /读回来 4 件，其中 1 件/.test(m)));
  assert.ok(!B.logs.some(m => /读不了/.test(m)), '项目 下的散文件不报错');
  assert.equal(await B.S.wasLive('甲', 'a3'), true, '清单里记着还在等');
  assert.equal(await B.S.wasLive('甲', 'a1'), false, '做完了的不算');
  assert.equal(await B.S.wasLive('乙', 'a3'), false, '别的项目的不算');

  // 先读回来再存：start 不会拿空清单把记下的盖掉
  const C = server();
  await C.S.start();
  assert.deepEqual(F.json(LIST('乙')).任务.map(x => x.id), ['b1']);
  assert.ok(F.json(LIST('甲')).任务.some(x => x.id === 'a1'));

  // 太多了丢最早了结的，在做的不丢
  const D = server(3);
  D.add({ id: 'L', 状态: '在做', 项目: '甲', 建: 1 });
  D.add({ id: 'o1', 状态: '做完', 项目: '甲', 建: 2 });
  D.add({ id: 'o2', 状态: '做完', 项目: '甲', 建: 3 });
  D.add({ id: 'o3', 状态: '做完', 项目: '甲', 建: 4 });
  D.S.trim();
  assert.deepEqual(D.jobs.map(j => j.id), ['L', 'o2', 'o3']);
  assert.ok(!D.byId.has('o1') && D.byId.has('L'));
  console.log('任务存盘：存、读回来、挤掉最早的 ✓');
}

/* 在内存里开一个本机服务（jobs.js），照页面那样调接口 */
function boot(F) {
  const spawn = (cmd, args) => { throw Error('测试不能调用外部程序：' + cmd + ' ' + (args || []).join(' ')); };
  const mockFs = { existsSync: p => F.files.has(p) || F.dirs.has(p), promises: F.fsp };
  const box = { module: { exports: {} }, __dirname: DIR, Buffer, process, URL, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : require(name.startsWith('.') ? path.resolve(DIR, name) : name) };
  vm.runInNewContext(fs.readFileSync(backend, 'utf8'), box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  async function call(method, url, body) {
    let out;
    const json = (res, obj) => { out = obj; };
    const readBody = async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}));
    const httpErr = (code, msg) => Object.assign(new Error(msg), { status: code });
    await api.handle({ method }, {}, new URL('http://127.0.0.1' + url), { json, readBody, httpErr });
    return out === undefined ? out : JSON.parse(JSON.stringify(out));   // 照页面收到的那样（也换成这边的数组）
  }
  return { call };
}

/* ---------- 二、本机服务重开：出片接着等，清单里别的摆回去 ---------- */
async function restartTests() {
  const F = memFs(), P = '药膳鸡配方--测试';   // 名字长、带「--」：交给 AI 的话头一行的对话名用简称（11-18）
  const now = new Date(), stamp = stampOf(new Date(now.getTime() - 5 * 60e3));
  const cutDir = pj(P, '历史记录', 'AI任务', stamp + '_出片_第1-1段'), imgDir = pj(P, '历史记录', 'AI任务', stamp + '_出图_第1-1段');
  const task = pj(P, '提示词', '第1-1段', '4-6_出片任务.txt');
  const rel = d => path.relative(root, d).split(path.sep).join('/');
  F.put(task, '画布：https://jimeng.jianying.com/ai-tool/ai-canvas/x\n照这份出片。\n');
  const 建 = now.getTime() - 5 * 60e3;
  F.put(path.join(cutDir, '自己交.json'), JSON.stringify({ id: 'cp1', 项目: P, 建, 开始: 建, 请求: { 事: '出片', 段: '1-1', 名: '4-6_出片任务.txt', 批准: '用户点了批准出片' }, 渠道: '自己交给 AI', 方式: 'self', 开: 建, 回复: path.join(cutDir, '回复.md'), run: true }));
  F.put(path.join(cutDir, '交给AI的话.txt'), '请照 ' + task + ' 执行。');
  // 更早一回重开就断了的出片：清单里没记着还在等，不接（多半已经在别处重出过，接回来挂成「等你交给 AI」会让人再贴一回、再扣积分）
  const oldDir = pj(P, '历史记录', 'AI任务', stampOf(new Date(now.getTime() - 26 * 3600e3)) + '_出片_第1-1段');
  F.put(path.join(oldDir, '自己交.json'), JSON.stringify({ id: 'cp0', 项目: P, 建: now.getTime() - 26 * 3600e3, 开始: now.getTime() - 26 * 3600e3, 请求: { 事: '出片', 段: '1-1', 名: '4-6_出片任务.txt', 批准: '用户点了批准出片' }, 渠道: '自己交给 AI', 方式: 'self', 开: 0, 回复: path.join(oldDir, '回复.md'), run: true }));
  // 11-18 以前交出去的出图：没记当初有没有图，接不上
  F.put(path.join(imgDir, '自己交.json'), JSON.stringify({ id: 'ct1', 项目: P, 建, 开始: 建, 请求: { 事: '出图', 段: '1-1', 类别: '道具', 名: '砂锅' }, 渠道: '自己交给 AI', 方式: 'self', 开: 建, 回复: path.join(imgDir, '回复.md'), run: true }));
  const snap = (id, 事, 状态, more) => ({ id, 事, 渠道: '自己交给 AI', 项目: P, 段: '1-1', 标题: 事 + ' · 第1-1段', 状态, 步骤: '', 建: 建 - 1000, 开始: 建 - 1000, 结束: 0, 错误: '', 结果: '', 产出: [], 记录: '', 交给: null, ...more });
  F.put(LIST(P), JSON.stringify({ 任务: [
    snap('ok1', '按批注改', '做完', { 建: 建 - 9000, 结束: 建 - 8000, 结果: '照批注改好了' }),
    snap('tl1', '提炼', '在做', { 步骤: 'AI 在写' }),
    snap('ct1', '出图', '在做', { 建: 建 - 500, 记录: rel(imgDir), 交给: { 方式: 'self', 等: '你' } }),
    snap('cp1', '出片', '在做', { 建, 记录: rel(cutDir), 交给: { 方式: 'self', 等: '你' } }),
  ] }));
  const { call } = boot(F);
  const list = async () => (await call('GET', '/api/job')).jobs;
  let js = [];
  for (let i = 0; i < 100; i++) {   // 服务开起来 300 毫秒后接回在等回复的，再读清单
    js = await list();
    const cp = js.find(j => j.id === 'cp1');
    if (cp && cp.交给 && js.length === 4) break;
    await sleep(30);
  }
  const by = id => js.find(j => j.id === id);
  assert.deepEqual(js.map(j => j.id), ['ok1', 'tl1', 'ct1', 'cp1'], '刷新以后四件都在');
  assert.ok(!by('cp0'), '清单里没记着还在等的出片不接');
  assert.equal(by('cp1').状态, '在做'); assert.deepEqual(by('cp1').交给, { 方式: 'self', 等: '你' }, '出片接着等 Codex 的回复，同一个号');
  assert.equal(by('ok1').状态, '做完'); assert.equal(by('ok1').结果, '照批注改好了');
  assert.equal(by('tl1').状态, '没成'); assert.match(by('tl1').错误, /本机服务重开过/);
  assert.equal(by('ct1').状态, '没成', '没记当初有没有图的出图接不上：写明要重点一次'); assert.match(by('ct1').错误, /要的话再点一次/);
  assert.ok(!F.files.has(pj(P, '资产', '第1-1段_出片记录.json')), '接着等的出片不再记一笔出片记录');
  assert.ok(!F.json(path.join(cutDir, '自己交.json')).结束);
  assert.match(F.files.get(path.join(cutDir, '交给AI的话.txt')).toString(), /请照 .*4-6_出片任务\.txt 执行。/);
  assert.equal(F.files.get(path.join(cutDir, '交给AI的话.txt')).toString().split('\n')[0], '【药膳鸡 · 出片 · 第1-1段 镜头4-6】先给这个对话改名，改成【】里的字：调 mcp__codex_app__set_thread_title，参数只填 title（不在 Codex 里就跳过这一步）。', 'Codex 对话名：项目简称 · 任务标题');
  const one = await call('GET', '/api/job/tl1');
  assert.equal(one.状态, '没成', '摆回去的按号也查得到');
  await call('POST', '/api/job/tl1?cancel');
  assert.equal((await call('GET', '/api/job/tl1')).状态, '没成', '摆回去的点停掉不出错');
  // Codex 出完片写回复、跑 reply：认得这个号，照常收
  F.put(path.join(cutDir, '回复.md'), '出好了：成片/第1-1段/4-6.mp4');
  const r = await call('POST', '/api/job/cp1?reply', '');
  assert.equal(r.状态, '做完'); assert.match(r.结果, /^Codex 做完了：出好了/);
  assert.ok(F.json(path.join(cutDir, '自己交.json')).结束 || (await sleep(50), F.json(path.join(cutDir, '自己交.json')).结束), '做完记进 自己交.json：再重开也不接着等');
  await sleep(1300);
  const saved = F.json(LIST(P)).任务;
  assert.deepEqual(saved.map(j => j.id + ':' + j.状态), ['ok1:做完', 'tl1:没成', 'ct1:没成', 'cp1:做完'], '清单跟着存');
  console.log('任务存盘：重开后出片接着等、别的摆回去 ✓');
}

/* ---------- 三、出图接着等：当初已经有图，新图存成候选。重开时候选已经存上了，不能当「上一张没用上的」收走 ---------- */
async function imageTests() {
  const F = memFs(), P = '测试';
  const now = new Date(), 建 = now.getTime() - 3 * 60e3, dir = pj(P, '历史记录', 'AI任务', stampOf(new Date(建)) + '_出图_第1-1段');
  F.put(pj(P, '定稿的剧本', '流水线.json'), JSON.stringify({ 场: [{ 段: '1-1', 剧本定稿: nowText(now) }] }));
  F.put(pj(P, '定稿的剧本', '第1-1段', '第1-1段_剧本.docx'), '剧本');
  F.put(pj(P, '提示词', '全局资产', '道具', '砂锅_提示词.txt'), '一只旧砂锅，黑褐色，锅沿有豁口。');
  F.put(pj(P, '资产', '人物和道具', '砂锅.png'), '旧图');
  F.put(pj(P, '资产', '人物和道具', '砂锅_候选.png'), '重开前 Codex 刚存上的新图');
  F.put(path.join(dir, '自己交.json'), JSON.stringify({ id: 'im1', 项目: P, 建, 开始: 建, 请求: { 事: '出图', 段: '1-1', 类别: '道具', 名: '砂锅' }, 渠道: '自己交给 AI', 方式: 'self', 开: 建, 回复: path.join(dir, '回复.md'), run: true, 接着: { 有图: true } }));
  F.put(LIST(P), JSON.stringify({ 任务: [{ id: 'im1', 事: '出图', 项目: P, 段: '1-1', 标题: '出图 · 砂锅', 状态: '在做', 建, 开始: 建, 交给: { 方式: 'self', 等: '你' } }] }));
  const { call } = boot(F);
  let j = null;
  for (let i = 0; i < 100 && !(j && j.交给); i++) { await sleep(30); j = (await call('GET', '/api/job')).jobs.find(x => x.id === 'im1'); }
  assert.ok(j && j.状态 === '在做' && j.交给 && j.交给.等 === '你', '记着有没有图的出图：重开后接着等');
  assert.ok(F.files.get(path.join(dir, '交给AI的话.txt')).toString().startsWith('【测试 · 出图 · 砂锅】先给这个对话改名'), '名字短的项目照写');
  assert.equal(F.files.get(pj(P, '资产', '人物和道具', '砂锅_候选.png')).toString(), '重开前 Codex 刚存上的新图', '候选没被收进历史记录');
  assert.ok(![...F.files.keys()].some(p => p.includes(path.join('历史记录', '资产'))), '什么都没收走');
  assert.deepEqual(F.json(path.join(dir, '自己交.json')).接着, { 有图: true }, '接着等时照旧记着');
  F.put(path.join(dir, '回复.md'), '核图：没看出问题\n存好了。');
  const r = await call('POST', '/api/job/im1?reply', '');
  assert.equal(r.状态, '做完', r.错误);
  assert.match(r.结果, /^新图出好了，先当候选/);
  assert.deepEqual(r.产出, ['资产/人物和道具/砂锅_候选.png']);
  console.log('任务存盘：重开后出图接着等、候选不收走 ✓');
}

(async () => {
  await storeTests();
  await restartTests();
  await imageTests();
  console.log('任务存盘_测试 全部通过');
})().catch(e => { console.error(e); process.exit(1); });
