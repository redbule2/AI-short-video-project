'use strict';
// node 通用工具/测试/资产开关_测试.cjs
// 资产那一步的两个开关（11-17 他要），项目读写都在内存里，不碰真项目：
// 只用文字：只出现一次的人物、道具、场景，用文字锁就行，不出图。记在这一场的「不出图」（公用/核心.js 的 noImg、setNoImg）；
//   资产那一步不算缺图；「让 AI 写」给它们写文字描写（公用/文字描写.js），不写出图提示词；写视频提示词照文字描写写。
// 旁白（11-17）：剧本里有「旁白：」的台词，写视频提示词时挂旁白的录音（公用/音色.js）。
// 不要GEO：只用一次、没有严格站位的场景，只写出图提示词、不写 GEO 底稿，写视频提示词也不用 GEO。记在这一场的「不要GEO」（noGeo、setNoGeo）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const Core = require('../公用/核心.js');
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const P = (...a) => path.join(root, '项目', '测试', ...a);
const flowPath = P('定稿的剧本', '流水线.json');
const scriptPath = P('定稿的剧本', '第1段', '第1段_剧本.docx');
const SCRIPT = '第1段｜吃面\n正文\n△ 老李端起碗，巷口一个路人探头看招牌。\n老李：烫！';
const fail = code => Object.assign(new Error(code), { code });
const FIN = '2026-11-16 10:00:00', finMs = Date.parse('2026-11-16T10:00:00');

function setup(scene, more = {}, rows = {}, script = SCRIPT) {   // rows：换掉全片的人物表、道具表；script：剧本的字
  const flow = { 梗概: '小面摊', 人物: [{ 名: '老李', 描写: '五十岁' }, { 名: '路人甲', 描写: '三十岁' }], 道具: [{ 名: '面碗', 描写: '白瓷大碗' }, { 名: '旧招牌', 描写: '木牌' }],
    场景: '面摊：路边一个小面摊\n巷口：窄巷子口', 场: [scene], ...rows };
  const files = new Map([[flowPath, Buffer.from(JSON.stringify(flow))], [scriptPath, Buffer.from('docx')]]);
  const mtimes = new Map([[scriptPath, finMs - 5000]]);
  for (const [p, v] of Object.entries(more)) files.set(p, Buffer.from(v));
  const mockFs = {
    existsSync: p => files.has(p),
    promises: {
      async readFile(p, encoding) {
        if (String(p).endsWith('SKILL.md')) return '测试技能';
        if (!files.has(p)) throw fail('ENOENT');
        return encoding ? files.get(p).toString(encoding) : Buffer.from(files.get(p));
      },
      async stat(p) { if (!files.has(p)) throw fail('ENOENT'); return { mtimeMs: mtimes.get(p) || 0 }; },
      async mkdir() {},
      async readdir(dir) { const d = path.resolve(String(dir)) + path.sep; return [...new Set([...files.keys()].filter(p => p.startsWith(d)).map(p => p.slice(d.length).split(path.sep)[0]))]; },
      async writeFile(p, data) { files.set(p, Buffer.from(data)); },
      async rename(from, to) { if (!files.has(from)) throw fail('ENOENT'); files.set(to, files.get(from)); files.delete(from); },
      async copyFile(from, to) { files.set(to, Buffer.from(files.get(from))); },
    },
  };
  const spawn = (cmd, args) => {   // 读剧本（剧本读写.js 读）换成假的：照原样吐出 script
    if (!(args && args[1] === '读' && files.has(args[2]))) throw Error('测试不能调用外部程序：' + (args || []).join(' '));
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
    setImmediate(() => { child.stdout.emit('data', Buffer.from(script + '\n')); child.exitCode = 0; child.emit('close', 0); });
    return child;
  };
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, setTimeout, clearTimeout, setImmediate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  return { K: api.KINDS, files };
}
const scene = extra => ({ 段: '1', 名: '吃面', 人物: ['老李', '路人甲'], 道具: ['面碗', '旧招牌'], 场景文字: ['面摊：路边一个小面摊', '巷口：窄巷子口'], 剧本定稿: FIN, ...extra });
const job = () => ({ 项目: '测试', 段: '1', 渠道: 'self' });
const toWrite = book => (book.split('## 要写的这几样')[1] || '').split('\n## ')[0];   // 任务书里「要写的这几样」那一块
async function bookOf(s) { const j = job(); await s.K.写字.prep(j); return s.K.写字.book(j); }

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('noImg：只认这一场「不出图」里写着的；乱写的、别的类别、空名字都不算', async () => {
    const s = { 不出图: { 人物: [' 路人甲 ', '路人甲', 3, ''], 道具: '旧招牌', 场景: ['巷口'], 特效: ['火'] } };
    assert.deepEqual(Core.noImgList(s, '人物'), ['路人甲']);
    assert.deepEqual(Core.noImgList(s, '道具'), []);   // 不是列表：当没写
    assert.equal(Core.noImg(s, '人物', '路人甲'), true);
    assert.equal(Core.noImg(s, '人物', ' 路人甲'), true);
    assert.equal(Core.noImg(s, '场景', '巷口'), true);
    assert.equal(Core.noImg(s, '特效', '火'), false);
    assert.equal(Core.noImg(s, '人物', '老李'), false);
    assert.equal(Core.noImg(s, '人物', ''), false);
    for (const bad of [null, undefined, {}, { 不出图: null }, { 不出图: ['路人甲'] }, { 不出图: '路人甲' }]) assert.equal(Core.noImg(bad, '人物', '路人甲'), false);
  });

  await check('setNoImg：点「只用文字」记上，点「要出图」去掉；一样不剩整个去掉；没变回 false', async () => {
    const s = {};
    assert.equal(Core.setNoImg(s, '人物', '路人甲', true), true);
    assert.deepEqual(s.不出图, { 人物: ['路人甲'] });
    assert.equal(Core.setNoImg(s, '人物', '路人甲', true), false);   // 已经记着
    assert.equal(Core.setNoImg(s, '场景', '巷口', true), true);
    assert.deepEqual(s.不出图, { 人物: ['路人甲'], 场景: ['巷口'] });
    assert.equal(Core.setNoImg(s, '人物', '路人甲', false), true);
    assert.deepEqual(s.不出图, { 场景: ['巷口'] });
    assert.equal(Core.setNoImg(s, '人物', '老李', false), false);   // 本来就没记
    assert.equal(Core.setNoImg(s, '场景', '巷口', false), true);
    assert.equal('不出图' in s, false);
    assert.equal(Core.setNoImg(s, '特效', '火', true), false);
    assert.equal(Core.setNoImg(s, '人物', '  ', true), false);
    assert.equal(Core.setNoImg(null, '人物', '路人甲', true), false);
    assert.equal('不出图' in s, false);
  });

  await check('让 AI 写字：不出图的人物、道具、场景写文字描写，不写出图提示词；别的照旧', async () => {
    const book = await bookOf(setup(scene({ 不出图: { 人物: ['路人甲'], 道具: ['旧招牌'], 场景: ['巷口'] } }))), part = toWrite(book);
    const line = x => part.split('\n').find(l => l.includes(x)) || '';
    for (const x of ['【人物｜老李】', '【道具｜面碗】', '【场景｜面摊】']) assert.match(line(x), /要写字/, '该写出图提示词的没写：' + x);
    for (const x of ['【人物｜路人甲】', '【道具｜旧招牌】', '【场景｜巷口】']) assert.match(line(x), /只用文字，不出图：要写文字描写/, '不出图的没写文字描写：' + x);
    assert.ok(book.includes('## 出图规矩') && book.includes('## 文字描写规矩（只用文字的）') && book.includes('文字描写：\n'), '两样规矩、回复的样子都要有');
  });

  await check('没记「不出图」的：一样不少（和以前一样）', async () => {
    const part = toWrite(await bookOf(setup(scene())));
    for (const t of ['【人物｜老李】', '【人物｜路人甲】', '【道具｜面碗】', '【道具｜旧招牌】', '【场景｜面摊】', '【场景｜巷口】']) assert.ok(part.includes(t), '少了：' + t);
  });

  await check('不出图的后来挂上了图：照图核，不当它只用文字', async () => {
    const img = '资产/全局资产/人物/老李.png';
    const s = setup(scene({ 人物: ['老李'], 道具: [], 场景文字: [], 不出图: { 人物: ['老李'] } }), { [P(...img.split('/'))]: 'png' }, { 人物: [{ 名: '老李', 描写: '五十岁', 资产: img }] });
    const part = toWrite(await bookOf(s));
    assert.ok(part.includes('【人物｜老李】') && part.includes('有图：' + img), part);
  });

  const ALL = { 不出图: { 人物: ['老李', '路人甲'], 道具: ['面碗', '旧招牌'], 场景: ['面摊', '巷口'] } };
  const txtOf = (k, n) => P('提示词', '全局资产', k, n + '_提示词.txt'), TXT = (k, n, body) => ({ [txtOf(k, n)]: '用途：' + k + '「' + n + '」只用文字，不出图：写视频提示词照这份字写\n提示词\n' + body });
  await check('全都不出图：只写文字描写，不讲出图、GEO；都写好了才不起任务', async () => {
    const book = await bookOf(setup(scene(ALL)));
    assert.ok(book.includes('## 文字描写规矩') && !book.includes('## 出图规矩') && !book.includes('scene-geo') && !book.includes('出图提示词：'), '只用文字的还在讲出图');
    const had = Object.assign({}, ...[['人物', '老李'], ['人物', '路人甲'], ['道具', '面碗'], ['道具', '旧招牌'], ['场景', '面摊'], ['场景', '巷口']].map(([k, n]) => TXT(k, n, '写好了的样子')));
    await assert.rejects(bookOf(setup(scene(ALL), had)), /没有要写的（只用文字写的已经有文字描写/);
  });

  await check('只用文字的：文字描写存进「名字_提示词.txt」，用途写明只用文字；场景不落 GEO 底稿', async () => {
    const s = setup(scene({ 人物: ['路人甲'], 道具: [], 不出图: { 人物: ['路人甲'], 场景: ['面摊', '巷口'] } })), j = job();
    await s.K.写字.prep(j); await s.K.写字.book(j);
    const reply = ['【人物｜路人甲】', '要撑住：从巷口探头看招牌', '替人定的：', '穿旧蓝布褂', '文字描写：', '三十来岁的瘦高男人，旧蓝布褂，背着布包。',
      '【场景｜面摊】', '要撑住：老李在摊前吃面', '文字描写：', '傍晚路边的小面摊，灶台冒白汽，暖黄的灯只照着摊子一圈。',
      '【场景｜巷口】', '要撑住：路人探头', 'GEO底稿：', '这里不该有底稿。'.repeat(10), '文字描写：', '窄巷子口，两边灰砖墙，左墙挂旧木招牌。'].join('\n');
    const r = await s.K.写字.apply(j, reply), read = p => s.files.get(p).toString('utf8');
    const tx = read(txtOf('人物', '路人甲'));
    assert.match(tx, /^用途：人物「路人甲」只用文字，不出图/m);
    assert.match(tx, /^要撑住：从巷口探头看招牌$/m);
    assert.ok(tx.endsWith('\n提示词\n三十来岁的瘦高男人，旧蓝布褂，背着布包。\n'), tx);
    assert.ok(read(txtOf('场景', '面摊')).includes('暖黄的灯'));
    const geoAt = n => P('提示词', '全局资产', '场景', n + '_GEO底稿.md');
    assert.ok(!s.files.has(geoAt('巷口')) && !s.files.has(geoAt('面摊')), '只用文字的场景落了底稿');
    assert.match(r.结果, /字写好了：路人甲、面摊、巷口/);
  });

  await check('只用文字的已经有文字描写：整段写字时不重写；点名的才照要求改', async () => {
    const more = TXT('人物', '路人甲', '原来写好的样子'), sc = scene({ 不出图: { 人物: ['路人甲'] } });
    assert.ok(!toWrite(await bookOf(setup(sc, more))).includes('【人物｜路人甲】'), '写好了的又写一遍');
    const s = setup(sc, more), j = { ...job(), 参数: { 只: [{ 类别: '人物', 名称: '路人甲', 图: '资产/全局资产/人物/路人甲.png', 要求: '胡子再多一点' }] } };
    await s.K.写字.prep(j);
    const book = await s.K.写字.book(j);
    assert.match(toWrite(book), /【人物｜路人甲】.*只用文字，不出图：要写文字描写（原来的字在最后/);
    assert.ok(book.includes('原来写好的样子') && book.includes('## 文字描写规矩') && book.includes('胡子再多一点'));
  });

  await check('出图：字是文字描写（只用文字时写的）就不出，先让 AI 改成出图提示词', async () => {
    const s = setup(scene(), TXT('人物', '路人甲', '三十来岁的瘦高男人。')), j = { ...job(), 渠道: '自己交给 AI', 类别: '人物', 名: '路人甲', 参数: { 图: '资产/全局资产/人物/路人甲.png' } };   // 「给我提示词」：不用调 Codex
    await s.K.出图.prep(j);
    await assert.rejects(s.K.出图.run(j), /文字描写，不是出图提示词/);
  });

  await check('按批注改字：文字描写照文字描写改，不当出图提示词', async () => {
    const more = { ...TXT('人物', '路人甲', '三十来岁的瘦高男人。'.repeat(3)), [P('提示词', '全局资产', '人物', '路人甲_提示词_批注.md')]: '胡子再多一点' };
    const s = setup(scene(), more), j = { 项目: '测试', 段: '1', 参数: { 字: '提示词/全局资产/人物/路人甲_提示词.txt' } };
    await s.K.按批注改字.prep(j);
    assert.match(await s.K.按批注改字.book(j), /^# 任务：按批注改文字描写/);
  });

  await check('noGeo、setNoGeo：只认这一场「不要GEO」里写着的；只用文字写的场景也算不要；一个不剩整个去掉', async () => {
    const s = {};
    assert.equal(Core.setNoGeo(s, ' 面摊 ', true), true);
    assert.deepEqual(s.不要GEO, ['面摊']);
    assert.equal(Core.setNoGeo(s, '面摊', true), false);   // 已经记着
    assert.equal(Core.noGeo(s, '面摊'), true);
    assert.equal(Core.noGeo(s, '巷口'), false);
    assert.equal(Core.noGeo({ 不出图: { 场景: ['巷口'] } }, '巷口'), true);   // 不出图的场景用不着 GEO
    assert.equal(Core.noGeo({ 不出图: { 人物: ['巷口'] } }, '巷口'), false);
    assert.equal(Core.setNoGeo(s, '巷口', false), false);   // 本来就没记
    assert.equal(Core.setNoGeo(s, '面摊', false), true);
    assert.equal('不要GEO' in s, false);
    assert.equal(Core.setNoGeo(s, '  ', true), false);
    assert.equal(Core.setNoGeo(null, '面摊', true), false);
    for (const bad of [null, undefined, {}, { 不要GEO: '面摊' }, { 不要GEO: { 面摊: 1 } }]) assert.equal(Core.noGeo(bad, '面摊'), false);
    assert.equal(Core.noGeo({ 不要GEO: ['面摊'] }, ''), false);
  });

  const geoReply = ['【场景｜面摊】', '要撑住：老李坐在摊前吃面，巷口的路人看得见他', 'GEO底稿：', '面摊在路边，灶台在左边冒白汽，两张矮桌在右边，摊子背后是窄巷子口；从街对面往里看，能看见整个摊子，也能看见后面的巷子口。',
    '出图提示词：', '傍晚路边一个小面摊，灶台冒着白汽，两张矮木桌，背后是一条窄巷子口，暖黄的灯只照着摊子一圈，真人写实的电影剧照质感。',
    '【场景｜巷口】', '要撑住：路人从巷口探头看招牌', 'GEO底稿：', '巷口很窄，两边是灰砖墙，左边墙上挂着旧木招牌，巷子往里延伸、越往里越暗；从面摊这边看过去，能看见巷口和招牌。',
    '出图提示词：', '一条窄巷子口，两边灰砖墙，左边墙上挂一块旧木招牌，巷子深处有点暗，地上有积水，真人写实的电影剧照质感。'].join('\n');
  const sceneOnly = extra => scene({ 人物: [], 道具: [], ...extra });
  const geoFile = n => P('提示词', '全局资产', '场景', n + '_GEO底稿.md'), txtFile = n => P('提示词', '全局资产', '场景', n + '_提示词.txt');

  await check('让 AI 写出图提示词：标了不要 GEO 的场景，只写出图提示词，不写底稿、也不落底稿', async () => {
    const s = setup(sceneOnly({ 不要GEO: ['面摊'] })), j = job();
    await s.K.写字.prep(j);
    const book = await s.K.写字.book(j), part = toWrite(book);
    const line = n => part.split('\n').find(l => l.includes('【场景｜' + n + '】')) || '';
    assert.match(line('面摊'), /要写字（不写 GEO 底稿/);
    assert.doesNotMatch(line('巷口'), /不写 GEO/);
    assert.ok(book.includes('先照 scene-geo 写 GEO 底稿') && book.includes('标了「不写 GEO 底稿」的不写底稿'), '要写底稿的那几句不对');
    assert.ok(book.includes('## scene-geo 技能'), '巷口还要 GEO，技能要带上');
    await s.K.写字.apply(j, geoReply);
    assert.ok(s.files.has(txtFile('面摊')) && s.files.has(txtFile('巷口')), '出图提示词都要写');
    assert.ok(!s.files.has(geoFile('面摊')), '不要 GEO 的落了底稿');
    assert.ok(s.files.has(geoFile('巷口')), '要 GEO 的没落底稿');
  });

  await check('让 AI 写出图提示词：场景都不要 GEO，任务书不讲 GEO、不带 scene-geo 技能', async () => {
    const s = setup(sceneOnly({ 不要GEO: ['面摊'], 不出图: { 场景: ['巷口'] } })), j = job();
    await s.K.写字.prep(j);
    const book = await s.K.写字.book(j), part = toWrite(book);
    assert.ok(part.includes('【场景｜面摊】') && /【场景｜巷口】.*只用文字，不出图：要写文字描写/.test(part), part);   // 不出图的巷口写文字描写（11-17）
    assert.ok(!book.includes('先照 scene-geo') && !book.includes('## scene-geo 技能') && !book.includes('场景在底稿里标'), '还在讲 GEO');
  });

  await check('没标的场景：和以前一样写 GEO 底稿', async () => {
    const s = setup(sceneOnly()), j = job();
    await s.K.写字.prep(j);
    const book = await s.K.写字.book(j);
    assert.ok(book.includes('先照 scene-geo 写 GEO 底稿') && book.includes('## scene-geo 技能') && !book.includes('不写 GEO'), '没标也变了');
    await s.K.写字.apply(j, geoReply);
    assert.ok(s.files.has(geoFile('面摊')) && s.files.has(geoFile('巷口')));
  });

  await check('按批注改字：这一段标了不要 GEO 的场景，不带原来的底稿', async () => {
    const more = { [txtFile('面摊')]: '用途：场景「面摊」\n提示词\n' + '路边小面摊'.repeat(10), [P('提示词', '全局资产', '场景', '面摊_提示词_批注.md')]: '灯再暗一点', [geoFile('面摊')]: '面摊在路边，灶台在左。'.repeat(5) };
    const run = async extra => { const s = setup(sceneOnly(extra), more), j = { 项目: '测试', 段: '1', 参数: { 字: '提示词/全局资产/场景/面摊_提示词.txt' } }; await s.K.按批注改字.prep(j); return s.K.按批注改字.book(j); };
    assert.ok((await run({})).includes('## 原来的 GEO 底稿'), '没标的要带底稿');
    const off = await run({ 不要GEO: ['面摊'] });
    assert.ok(!off.includes('## 原来的 GEO 底稿') && !off.includes('【GEO底稿】'), '标了不要 GEO 还带底稿');
  });

  const vpScene = extra => sceneOnly({ 段落: [{ 号: '1', 写什么: '老李端起碗吃面', 作用: '交代｜老李爱吃面' }], ...extra });
  const vpBook = async (extra, more = {}) => { const s = setup(vpScene(extra), { [geoFile('面摊')]: '【面摊底稿】灶台在左，矮桌在右。', [geoFile('巷口')]: '【巷口底稿】两边灰砖墙，招牌在左。', ...more }), j = { 项目: '测试', 段: '1', 名: '1.txt', 渠道: 'self' }; await s.K.写提示词.prep(j); return s.K.写提示词.book(j); };

  const GEO_SKILL = path.resolve(__dirname, '../../.agents/skills/scene-geo/SKILL.md');
  const geoParts = book => [...((book.split('## scene-geo（')[1] || '').split('\n## ')[0].matchAll(/「([^」]+)」/g))].map(m => m[1]);
  await check('写视频提示词：有底稿就带底稿；scene-geo 只给路径和六、七两节，不贴整份（11-18 晚）', async () => {
    const book = await vpBook({});
    assert.ok(book.includes('【面摊底稿】') && book.includes('【巷口底稿】') && book.includes('## scene-geo（') && book.includes(GEO_SKILL), '没标也变了');
    assert.ok(!book.includes('## 技能：scene-geo') && !book.includes('测试技能'), '又把 scene-geo 整份贴进来了');
    assert.deepEqual(geoParts(book).map(x => x.slice(0, 2)), ['六、', '七、']);
  });

  await check('写视频提示词：没底稿、有场景图，看图现建，再加第五节；两样都没有，不讲 GEO（11-18 晚）', async () => {
    const run = async (extra, more) => { const s = setup(vpScene(extra), more), j = { 项目: '测试', 段: '1', 名: '1.txt', 渠道: 'self' }; await s.K.写提示词.prep(j); return s.K.写提示词.book(j); };
    const img = '资产/全局资产/场景/面摊.png', make = await run({ 场景图: [img] }, { [P(...img.split('/'))]: 'PNG' });
    assert.ok(make.includes('【GEO底稿】'), '没让 AI 看图现建底稿');
    assert.deepEqual(geoParts(make).map(x => x.slice(0, 2)), ['五、', '六、', '七、']);
    const real = fs.readFileSync(GEO_SKILL, 'utf8').replace(/\r\n/g, '\n');
    for (const x of geoParts(make)) assert.ok(real.includes('\n## ' + x + '\n'), 'scene-geo 里找不到这一节，任务书指错了：' + x);
    const none = await run({}, {});
    assert.ok(!/scene-geo/.test(none) && none.includes('这一段没有场景图也没有 GEO 底稿'), '没图没底稿还在讲 GEO');
  });

  await check('写视频提示词：标了不要 GEO 的场景，不带它的底稿', async () => {
    const book = await vpBook({ 不要GEO: ['面摊'] });
    assert.ok(!book.includes('【面摊底稿】') && book.includes('【巷口底稿】'), '底稿带错了');
    assert.ok(book.includes('## scene-geo（'));
  });

  await check('写视频提示词：这一段的场景都不要 GEO，不讲 GEO、不建底稿、不带 scene-geo', async () => {
    const book = await vpBook({ 不要GEO: ['面摊'], 不出图: { 场景: ['巷口'] } });
    assert.ok(book.includes('这一段的场景不用 GEO（人定的'), '没说不用 GEO');
    assert.ok(!book.includes('底稿】') && !book.includes('## scene-geo（') && !book.includes('【GEO底稿】'), '还在讲 GEO');
  });

  await check('写视频提示词：教训只带公用的那一份（11-18 晚），项目自己的历史教训不带', async () => {
    const lessonFile = path.join(path.dirname(backend), '公用教训.md');
    const book = await vpBook({}, { [lessonFile]: '# 公用教训（测试）\n\n1. 甲。\n', [P('历史教训', '旧的.md')]: '项目自己的教训' });
    assert.ok(book.includes('## 公用教训（写的时候记着）\n1. 甲。') && !book.includes('项目自己的教训') && !book.includes('# 公用教训（测试）'));
  });

  await check('写视频提示词：只用文字的几样照它们的文字描写写；还没写的、还是出图提示词的照全片设定', async () => {
    const more = { ...TXT('人物', '路人甲', '三十来岁的瘦高男人，旧蓝布褂。'), [txtOf('道具', '旧招牌')]: '用途：道具「旧招牌」的定妆图，各段照它的样子\n提示词\n定妆照，纯中灰色背景，一块旧木牌。' };
    const book = await vpBook({ 人物: ['老李', '路人甲'], 道具: ['旧招牌'], 不出图: { 人物: ['路人甲'], 道具: ['旧招牌'], 场景: ['巷口'] } }, more);
    const part = (book.split('## 只用文字的资产')[1] || '').split('\n## ')[0];
    assert.ok(part.includes('人物「路人甲」：三十来岁的瘦高男人，旧蓝布褂。'), part);
    assert.ok(part.includes('道具「旧招牌」：（还没写文字描写，照全片设定：木牌）'), '还是出图提示词的不算：' + part);
    assert.ok(part.includes('场景「巷口」：（还没写文字描写，照全片设定：巷口：窄巷子口）'), part);
    assert.ok(!part.includes('老李') && !part.includes('纯中灰色'), part);
    assert.ok(book.includes('【主体与关系】里照它的文字描写写'), '要求里没说照文字描写写');
    assert.ok(!(await vpBook({})).includes('只用文字的资产'), '没有只用文字的也列了');
  });

  await check('写视频提示词：剧本里有旁白，挂旁白的录音、写明画外音；人物里手加的「旁白」不当人物挂', async () => {
    const more = { [P('资产', '全局资产', '人物', '旁白_音色.wav')]: 'RIFF' }, NARR = SCRIPT + '\n旁白：江湖传闻，面摊老李一碗面吃了三十年。';
    const run = async (extra, script) => { const s = setup(vpScene(extra), more, {}, script), j = { 项目: '测试', 段: '1', 名: '1.txt', 渠道: 'self' }; await s.K.写提示词.prep(j); return s.K.写提示词.book(j); };
    const book = await run({}, NARR);
    assert.ok(book.includes('旁白（画外音，不出镜）的音色（录音）：资产/全局资产/人物/旁白_音色.wav'), '没列旁白的录音');
    assert.ok(book.includes('@音频1用于画外旁白的音色') && book.includes('「旁白：{台词}」'), '没说怎么挂旁白');
    assert.ok(!(await run({}, SCRIPT)).includes('旁白_音色.wav'), '剧本没旁白也挂了');
    const hand = await run({ 人物: ['旁白'] }, SCRIPT);
    assert.ok(hand.includes('旁白（画外音，不出镜）的音色') && !hand.includes('人物「旁白」的音色'), '手加的旁白挂错了');
  });

  console.log(tested + ' 项检查通过；真实项目数据未读写。');
})().catch(e => { console.error(e); process.exit(1); });
