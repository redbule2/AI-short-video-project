'use strict';
// node 通用工具/测试/在别处做完_测试.cjs
// 11-17 他要的：交给 AI 等回复的任务，要做的事在别处已经做完了（另一个对话直接改了、人自己改了），流水线自己收掉，记成「做完：不用做了：……」。
// 逻辑在 .agents/skills/annotate-live/done-elsewhere.js，jobs.js 等回复时问它。第一部分在内存里假装文件；第二部分照 jobs.js 真的「写字」备材料，看两边字段对得上。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const LIVE = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const makeElsewhere = require(path.join(LIVE, 'done-elsewhere.js'));

const HOME = path.resolve(__dirname, '__内存测试根__', '项目');
const pj = (name, ...parts) => path.join(HOME, name, ...parts);
const vpPath = j => pj(j.项目, '提示词', '第' + j.段 + '段', String(j.名));
const T0 = Date.parse('2026-11-17T22:36:04'), MIN = 60e3;
function world(files = {}) {   // files：{ 项目里的相对路径: 修改时间 }；改 w.at 就是改文件，删 w.at 里的一项就是挪走
  const at = new Map(Object.entries(files).map(([k, t]) => [pj('甲', ...k.split('/')), t]));
  const fsp = { async stat(p) { if (!at.has(p)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { mtimeMs: at.get(p) + 0.4 }; } };
  return { at, set: (rel, t) => at.set(pj('甲', ...rel.split('/')), t), drop: rel => at.delete(pj('甲', ...rel.split('/'))), G: makeElsewhere({ fsp, pj, vpPath }) };
}
const parts = rel => rel.split('/');
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('照批注改的四种：批注还在就接着等；批注不在了，看到以后再等两分钟才收；中间批注又回来了，从头算', async () => {
    const cases = [
      ['按批注改', { rel: parts('定稿的剧本/第1-1段/第1-1段_剧本_批注.md') }],
      ['提炼按批注改', { rel: parts('定稿的剧本/第1-1段/第1-1段_提炼_批注.md') }],
      ['按批注改字', { 注: parts('提示词/全局资产/道具/砂锅_提示词_批注.md') }],
      ['按批注改提示词', { rel: parts('提示词/第1-1段/2-3_批注.md') }],
    ];
    for (const [事, more] of cases) {
      const note = (more.rel || more.注).join('/'), w = world({ [note]: T0 - MIN }), j = { 事, 项目: '甲', 段: '1-1', 开始: T0, ...more };
      assert.equal(await w.G.check(j, T0 + MIN), '', 事 + '：批注还在');
      w.drop(note);
      assert.equal(await w.G.check(j, T0 + 2 * MIN), '', 事 + '：刚看到批注不在，先等着');
      w.set(note, T0 + 2.5 * MIN);
      assert.equal(await w.G.check(j, T0 + 3 * MIN), '', 事 + '：批注又回来了');
      w.drop(note);
      assert.equal(await w.G.check(j, T0 + 4 * MIN), '', 事 + '：又不在了，从这回算起');
      assert.equal(await w.G.check(j, T0 + 5.9 * MIN), '', 事 + '：还不到两分钟');
      assert.equal(await w.G.check(j, T0 + 6 * MIN), '批注已经不在了，多半在别处照它改完了', 事);
    }
  });

  await check('写字（这回的情形）：只核砂锅旧图，图在别处换过了：服务重开以后接着等的，图是早换的，马上收', async () => {
    const img = '资产/全局资产/道具/砂锅.png', w = world({ [img]: T0 - 30 * MIN, '提示词/全局资产/道具/砂锅_提示词.txt': T0 - 30 * MIN });
    const j = { 事: '写字', 项目: '甲', 段: '1-1', 开始: T0, items: [{ 类别: '道具', 名称: '砂锅', 状态名: '', 写: false, 有图: true, f: { txt: parts('提示词/全局资产/道具/砂锅_提示词.txt'), img: parts(img) } }] };
    assert.equal(await w.G.check(j, T0 + 5 * MIN), '', '图没动：照旧等');
    w.set('提示词/全局资产/道具/砂锅_提示词.txt', T0 + 5 * MIN);
    assert.equal(await w.G.check(j, T0 + 30 * MIN), '', '只核图的：字改了不算，图还是那张');
    const at = T0 + 10 * MIN;
    w.set(img, at);
    assert.equal(await w.G.check(j, T0 + 35 * MIN), '砂锅的图 ' + hm(at) + ' 在别处改过了');
    const k = { ...j, 别处: null };
    assert.equal(await w.G.check(k, at + 30e3), '', '图刚换（AI 可能正要写回复）：先等');
    assert.equal(await w.G.check(k, at + 2 * MIN), '砂锅的图 ' + hm(at) + ' 在别处改过了', '两分钟里没回复：收');
  });

  await check('写字：几样里只改了一样，照旧等；要写字的看字不看图；没图也不用写字的，看字有没有人写了', async () => {
    const F = n => ({ txt: parts('提示词/全局资产/道具/' + n + '_提示词.txt'), img: parts('资产/全局资产/道具/' + n + '.png') });
    const w = world({ '资产/全局资产/道具/砂锅.png': T0 + MIN, '资产/全局资产/道具/竹棍.png': T0 - MIN, '提示词/全局资产/道具/竹棍_提示词.txt': T0 - MIN, '提示词/全局资产/道具/烤鸡_提示词.txt': T0 - MIN });
    const j = { 事: '写字', 项目: '甲', 段: '1-1', 开始: T0, items: [
      { 类别: '道具', 名称: '砂锅', 写: false, 有图: true, f: F('砂锅') },
      { 类别: '道具', 名称: '竹棍', 状态名: '断了', 写: true, 有图: true, f: F('竹棍') },
      { 类别: '道具', 名称: '烤鸡', 写: false, 有图: false, f: F('烤鸡') }] };
    assert.equal(await w.G.check(j, T0 + 60 * MIN), '', '竹棍、烤鸡还没人动');
    w.set('资产/全局资产/道具/竹棍.png', T0 + 2 * MIN);
    assert.equal(await w.G.check(j, T0 + 60 * MIN), '', '竹棍要写字：只换了图不算');
    w.set('提示词/全局资产/道具/竹棍_提示词.txt', T0 + 3 * MIN);
    assert.equal(await w.G.check(j, T0 + 60 * MIN), '', '烤鸡还没人动');
    w.set('提示词/全局资产/道具/烤鸡_提示词.txt', T0 + 4 * MIN);
    assert.equal(await w.G.check(j, T0 + 60 * MIN), '砂锅的图、竹棍（断了）的字、烤鸡的字 ' + hm(T0 + 4 * MIN) + ' 在别处改过了');
    assert.equal(await w.G.check({ ...j, items: [] }, T0 + 60 * MIN), '', '还没备好材料');
  });

  await check('写提示词：那一条在别处写好了才收；照图核 GEO：底稿或图开始以后改过了才收', async () => {
    const w = world({ '提示词/全局资产/场景/破庙_GEO底稿.md': T0 - MIN, '资产/全局资产/场景/破庙.png': T0 - MIN });
    const vp = { 事: '写提示词', 项目: '甲', 段: '1-1', 名: '1-5.txt', 开始: T0 };
    assert.equal(await w.G.check(vp, T0 + 60 * MIN), '');
    w.set('提示词/第1-1段/1-5.txt', T0 + 10 * MIN);
    assert.equal(await w.G.check(vp, T0 + 60 * MIN), '1-5.txt 在别处写好了');
    const geo = { 事: '核GEO', 项目: '甲', 段: '1-1', 名: '破庙', 开始: T0, files: { geo: parts('提示词/全局资产/场景/破庙_GEO底稿.md'), img: parts('资产/全局资产/场景/破庙.png') } };
    assert.equal(await w.G.check(geo, T0 + 60 * MIN), '');
    w.set('提示词/全局资产/场景/破庙_GEO底稿.md', T0 + 5 * MIN);
    assert.equal(await w.G.check(geo, T0 + 60 * MIN), '破庙的GEO 底稿 ' + hm(T0 + 5 * MIN) + ' 在别处改过了');
    w.set('资产/全局资产/场景/破庙.png', T0 + 6 * MIN);
    assert.equal(await w.G.check({ ...geo, 别处: null }, T0 + 60 * MIN), '破庙的图 ' + hm(T0 + 6 * MIN) + ' 在别处改过了');
  });

  await check('别的任务不看（与AI沟通剧本可能等很久、可以没有批注；出图、出片的图和片是它自己出的）；还没开始的不看', async () => {
    const w = world({});
    for (const 事 of ['与AI沟通剧本', '出图', '改图', '出片', '出片任务书', '提炼', '批注提示词', '影响清单', '推荐风格']) assert.equal(await w.G.check({ 事, 项目: '甲', 段: '1-1', 开始: T0, rel: parts('没有/这个_批注.md') }, T0 + 60 * MIN), '', 事);
    assert.equal(await w.G.check({ 事: '按批注改', 项目: '甲', 段: '1-1', 开始: 0, rel: parts('没有/这个_批注.md') }, T0 + 60 * MIN), '', '还没开始');
  });

  /* ---------- 照 jobs.js 真的「写字」备一回材料：它给的 items（写、有图、f.txt、f.img、名称），这里认得 ---------- */
  await check('jobs.js 写字备好的材料，这里认得：只核图的看图，要写字的看字', async () => {
    const backend = path.join(LIVE, 'jobs.js'), source = fs.readFileSync(backend, 'utf8'), root = path.resolve(__dirname, '__内存测试根__');
    const P = (...a) => path.join(root, '项目', '测试', ...a), FIN = '2026-11-16 10:00:00', finMs = Date.parse('2026-11-16T10:00:00');
    const flow = { 梗概: '小面摊', 人物: [], 道具: [{ 名: '面碗', 描写: '白瓷大碗', 资产: ['资产/全局资产/道具/面碗.png'] }, { 名: '旧招牌', 描写: '木牌' }], 场景: '面摊：路边一个小面摊',
      场: [{ 段: '1', 名: '吃面', 人物: [], 道具: ['面碗', '旧招牌'], 场景文字: [], 剧本定稿: FIN }] };
    const img = P('资产', '全局资产', '道具', '面碗.png'), txt = P('提示词', '全局资产', '道具', '面碗_提示词.txt'), txt2 = P('提示词', '全局资产', '道具', '旧招牌_提示词.txt');
    const files = new Map([[P('定稿的剧本', '流水线.json'), Buffer.from(JSON.stringify(flow))], [P('定稿的剧本', '第1段', '第1段_剧本.docx'), Buffer.from('docx')], [img, Buffer.from('png')], [txt, Buffer.from('用途：道具\n提示词\n白瓷大碗')]]);
    const mtimes = new Map([[P('定稿的剧本', '第1段', '第1段_剧本.docx'), finMs - 5000], [img, finMs], [txt, finMs]]);
    const fail = code => Object.assign(new Error(code), { code });
    const mockFs = { existsSync: p => files.has(p), promises: {
      async readFile(p, enc) { if (String(p).endsWith('SKILL.md')) return '测试技能'; if (!files.has(p)) throw fail('ENOENT'); return enc ? files.get(p).toString(enc) : Buffer.from(files.get(p)); },
      async stat(p) { if (!files.has(p)) throw fail('ENOENT'); return { mtimeMs: mtimes.get(p) || 0 }; },
      async mkdir() {}, async readdir() { return []; }, async writeFile(p, d) { files.set(p, Buffer.from(d)); },
      async rename(a, b) { files.set(b, files.get(a)); files.delete(a); }, async copyFile(a, b) { files.set(b, Buffer.from(files.get(a))); } } };
    const spawn = (cmd, args) => {
      if (!(args && args[1] === '读' && files.has(args[2]))) throw Error('测试不能调用外部程序：' + (args || []).join(' '));
      const child = new EventEmitter();
      Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
      setImmediate(() => { child.stdout.emit('data', Buffer.from('第1段｜吃面\n正文\n△ 老李端起面碗。\n')); child.exitCode = 0; child.emit('close', 0); });
      return child;
    };
    const box = { module: { exports: {} }, __dirname: LIVE, Buffer, process, setTimeout, clearTimeout, setImmediate,
      require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : require(name.startsWith('.') ? path.resolve(LIVE, name) : name) };
    vm.runInNewContext(source, box, { filename: backend });
    const K = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (ps, fn) => fn() }).KINDS;
    const j = { 项目: '测试', 段: '1', 渠道: 'self', 事: '写字' };
    await K.写字.prep(j); await K.写字.book(j);
    const by = n => j.items.find(x => x.名称 === n);
    assert.ok(by('面碗') && !by('面碗').写 && by('面碗').有图, '面碗：有图有字，只核图');
    assert.ok(by('旧招牌') && by('旧招牌').写, '旧招牌：没图没字，要写字');
    j.开始 = finMs + 60e3;
    const G = makeElsewhere({ fsp: mockFs.promises, pj: (name, ...ps) => path.join(root, '项目', name, ...ps), vpPath: () => '' });
    const late = finMs + 3600e3;
    assert.equal(await G.check(j, late), '', '都没人动');
    mtimes.set(img, finMs + 120e3); mtimes.set(txt, finMs + 120e3);
    assert.equal(await G.check(j, late), '', '面碗的图换了，旧招牌的字还没人写');
    files.set(txt2, Buffer.from('写好了')); mtimes.set(txt2, finMs + 180e3);
    assert.equal(await G.check(j, late), '面碗的图、旧招牌的字 ' + hm(finMs + 180e3) + ' 在别处改过了');
  });

  /* ---------- jobs.js 里接上了：等回复的循环问它，收掉时记成做完、不算没成 ---------- */
  await check('jobs.js 接上了：等回复时问 Gone.check，在别处做完的记成「做完：不用做了」', async () => {
    const src = fs.readFileSync(path.join(LIVE, 'jobs.js'), 'utf8');
    assert.match(src, /require\('\.\/done-elsewhere\.js'\)\(\{ fsp, pj, vpPath \}\)/);
    assert.match(src, /const why = await Gone\.check\(j\);[^\n]*\n\s*if \(why\) throw Object\.assign\(fail\(why\), \{ 别处: why \}\);/);
    assert.match(src, /if \(e\.别处 && !j\.停\) Object\.assign\(j, \{ 状态: '做完', 结果: '不用做了：' \+ e\.别处, 产出: \[\] \}\)/);
  });

  console.log('\n通过 ' + tested + ' 项');
})().catch(e => { console.error('✗ ' + (e.stack || e)); process.exit(1); });
