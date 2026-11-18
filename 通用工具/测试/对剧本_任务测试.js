'use strict';
// node 通用工具/测试/对剧本_任务测试.js
// 11-16 他定：片子定稿了、审片写了批注，项目自己调 AI 和剧本对一对（先本机 Codex 命令行，不行换 DeepSeek 接口），对不上的写成剧本批注，不改剧本。
// 在系统临时文件夹里搭一个假项目，Codex、DeepSeek 都换成假的，不碰真项目、不花钱。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const C = require('../公用/核心.js');
const make = require('../../.agents/skills/annotate-live/script-check.js');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), '对剧本测试_'));
const HOME = path.join(ROOT, '项目');
const pj = (n, ...a) => path.join(HOME, n, ...a);
const P = (...a) => pj('测试', ...a);
const CONF = path.join(ROOT, '内置AI.json');
const SCRIPT = ['第1段｜吃面', '场景：傍晚｜外｜面摊', '人物：老李、小孩', '梗概：老李嘴硬心软。', '正文', '△ 全景：老李端起碗。', '老李：烫！', '△ 近景：小孩看着老李。', '老李：烫！', '备注', '11-16 新写'].join('\n');
const fail = msg => Object.assign(new Error(msg), { plain: true });
const two = n => String(n).padStart(2, '0');
const nowText = (d = new Date()) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
async function writeFile(p, t) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, t); }

async function project() {
  await fsp.rm(HOME, { recursive: true, force: true });
  const doc = C.parseScripts(SCRIPT.split('\n').map(text => ({ text })), '1').segs[0];
  await writeFile(P('定稿的剧本', '第1段', '第1段_剧本.docx'), Buffer.from(await C.writeDocx(C.scriptToParas(doc), { title: C.scriptTitle(doc), header: '测试' })));
  await writeFile(P('提示词', '第1段', '1-2.txt'), '【事件脚本】\n镜头1：老李端起碗，一口喝下去，什么也没说。');
  await writeFile(P('成片', '第1段', '第1段_第1条_480p_批注.md'), '# 审片批注\n\n## 1｜0:02.0\n截图：x.jpg\n批注：老李不要说烫，直接喝\n\n## 2｜0:03.0\n批注：画面太暗');
}
/* Codex、DeepSeek 都是假的：codex 给 run 一个答卷（或者一个错），fetch 照 ds 回 */
function setup({ codex, ds, key = 'sk-0123456789abcdef0123', bal = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '9.90' }] }, deps = {} } = {}) {
  const calls = { codex: 0, ds: 0, books: [] };
  const run = async (exe, args, opt) => {
    calls.codex++; calls.books.push(opt.input);
    assert.ok(args.includes('read-only') && args.includes('--output-schema'), 'Codex 只读、照格式回');
    if (codex instanceof Error) throw codex;
    await fsp.writeFile(args[args.indexOf('-o') + 1], typeof codex === 'string' ? codex : JSON.stringify(codex));
    return { code: 0, out: 'model: gpt-test\n', err: '' };
  };
  const fetch = async (url, opt = {}) => {
    if (url.endsWith('/user/balance')) return { status: 200, ok: true, json: async () => bal };
    calls.ds++; calls.dsBody = JSON.parse(opt.body);
    if (typeof ds === 'number') return { status: ds, ok: false, text: async () => 'err' };
    return { status: 200, ok: true, json: async () => ({ model: 'deepseek-flash', choices: [{ message: { content: typeof ds === 'string' ? ds : JSON.stringify(ds) } }] }) };
  };
  if (key) fs.writeFileSync(CONF, JSON.stringify({ DeepSeek: { key } })); else fs.rmSync(CONF, { force: true });
  const env = { ANTOU_BUILTIN_AI: CONF, ANTOU_CODEX_EXE: codex === undefined ? '' : 'codex.exe', LOCALAPPDATA: path.join(ROOT, '没有') };
  const api = make({ ROOT, HOME, fsp, pj, run, writeFile, withFileLocks: async (ps, fn) => fn(), Core: C, log() {}, nowText, today: () => nowText().slice(0, 10), str: v => typeof v === 'string' ? v : '',
    fail, segDir: s => '第' + s + '段', scriptPath: (n, s) => pj(n, '定稿的剧本', '第' + s + '段', '第' + s + '段_剧本.docx'), exists: p => fsp.stat(p).then(() => true, () => false), unbom: s => s.replace(/^\uFEFF/, ''), env, fetch, ...deps });
  return { api, calls };
}
async function go(api, 事, extra) {
  const j = { 事, 项目: '测试', 段: '1', 视频: '第1段_第1条_480p.mp4', 名: '1-2.txt', ...extra };
  await api.KINDS[事].prep(j);
  if (j.跳过) return { j, r: { 结果: j.跳过 } };
  j.dir = path.join(HOME, '测试', '历史记录', 'AI任务', 'x' + Math.random());
  await fsp.mkdir(j.dir, { recursive: true });
  return { j, r: await api.KINDS[事].run(j) };
}
const notes = async () => C.parseNotes(await fsp.readFile(P('定稿的剧本', '第1段', '第1段_剧本_批注.md'), 'utf8'));
const ledger = async () => JSON.parse(await fsp.readFile(P('定稿的剧本', '第1段', '第1段_对剧本.json'), 'utf8')).记录;
const ANS = (批注, 判断 = '要改剧本') => ({ 判断, 说明: '测试', 批注, 不归剧本: [] });

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };
  try {
    await check('定稿对剧本：Codex 指出第几段，写成剧本批注（原文是那一整段、第几处对得上，剧本页认得回来）；剧本不动', async () => {
      await project();
      const before = await fsp.readFile(P('定稿的剧本', '第1段', '第1段_剧本.docx'));
      const { api, calls } = setup({ codex: ANS([{ 行号: 5, 批注: '老李不说话，直接喝', 依据: '提示词镜头1。' }]) });
      const { r } = await go(api, '定稿对剧本');
      assert.equal(calls.codex, 1); assert.equal(calls.ds, 0);
      assert.match(r.结果, /1 处要跟着改/);
      const book = calls.books[0];
      assert.match(book, /【1】场景：傍晚｜外｜面摊/); assert.match(book, /【5】老李：烫！/); assert.doesNotMatch(book, /11-16 新写/, '备注不给 AI 批');
      const nt = await notes();
      assert.equal(nt.items.length, 1);
      assert.deepEqual([nt.items[0].text, nt.items[0].n, nt.items[0].where], ['老李：烫！', 1, '正文']);
      assert.equal(nt.items[0].note, '老李不说话，直接喝〔AI 照定稿的样片写：第1段_第1条_480p 提示词镜头1〕');
      assert.deepEqual(await fsp.readFile(P('定稿的剧本', '第1段', '第1段_剧本.docx')), before);
      const lg = await ledger();
      assert.equal(lg[0].谁, 'Codex'); assert.equal(lg[0].写了[0].原文, '老李：烫！');
    });

    await check('同样的提示词、剧本也没动：不再对；同一段同一条批注不写两回', async () => {
      const { api, calls } = setup({ codex: ANS([{ 行号: 5, 批注: '老李不说话，直接喝', 依据: '' }]) });
      const { r } = await go(api, '定稿对剧本');
      assert.match(r.结果, /对过一样的/); assert.equal(calls.codex, 0);
      await fsp.writeFile(P('提示词', '第1段', '1-2.txt'), '【事件脚本】\n镜头1：老李端起碗，一口喝下去。');
      const again = await go(api, '定稿对剧本');
      assert.match(again.r.结果, /已经写过了/);
      assert.equal((await notes()).items.length, 1);
    });

    await check('审片对剧本：同一段已经有批注的接在后面；第二处一样的字记成第2处；判断是对得上就一条不写', async () => {
      const { api } = setup({ codex: ANS([{ 行号: 5, 批注: '台词去掉', 依据: '审片批注第1条' }, { 行号: 7, 批注: '这句也去掉', 依据: '审片批注第1条' }, { 行号: 99, 批注: '行号不对', 依据: '' }]) });
      const { r } = await go(api, '审片对剧本');
      assert.match(r.结果, /2 处要跟着改/);
      const nt = await notes();
      assert.equal(nt.items.length, 2);
      assert.match(nt.items[0].note, /^老李不说话，直接喝〔.+〕\n台词去掉〔AI 照审片批注写：第1段_第1条_480p 审片批注第1条〕$/);
      assert.deepEqual([nt.items[1].text, nt.items[1].n], ['老李：烫！', 2]);
      await fsp.appendFile(P('成片', '第1段', '第1段_第1条_480p_批注.md'), '\n\n## 3｜0:04.0\n批注：声音小');
      const ok = setup({ codex: ANS([{ 行号: 3, 批注: '顺手写的', 依据: '' }], '对得上') });
      assert.match((await go(ok.api, '审片对剧本')).r.结果, /对得上/);
      assert.equal((await notes()).items.length, 2);
    });

    await check('审片对剧本：截图路径不给 AI；没写批注的样片不开', async () => {
      await project();
      const { api, calls } = setup({ codex: ANS([], '对得上') });
      await go(api, '审片对剧本');
      assert.doesNotMatch(calls.books[0], /截图：/); assert.match(calls.books[0], /老李不要说烫/);
      const r = await go(api, '审片对剧本', { 视频: '第1段_第2条_480p.mp4' });
      assert.match(r.r.结果, /还没写批注/);
    });

    await check('Codex 没成（出错、格式不对、找不到）换 DeepSeek：照 JSON 模式问；两个都没成，两边的原因都说', async () => {
      await project();
      const a = setup({ codex: new Error('超时了'), ds: ANS([{ 行号: 6, 批注: '改', 依据: '' }]) });
      const { r } = await go(a.api, '定稿对剧本');
      assert.equal(a.calls.ds, 1); assert.match(r.结果, /DeepSeek，Codex 没成：超时了/);
      assert.equal(a.calls.dsBody.response_format.type, 'json_object'); assert.equal(a.calls.dsBody.model, 'deepseek-flash');
      assert.equal((await ledger()).pop().谁, 'DeepSeek');
      await project();
      const b = setup({ codex: '{"判断": "不知道"}', ds: ANS([], '对得上') });
      assert.match((await go(b.api, '定稿对剧本')).r.结果, /对得上.*DeepSeek/);
      await project();
      const c = setup({ ds: ANS([], '对得上') });   // 没装 Codex
      assert.match((await go(c.api, '定稿对剧本')).r.结果, /找不到 Codex/);
      await project();
      await assert.rejects(go(setup({ codex: new Error('坏了'), ds: 402 }).api, '定稿对剧本'), /Codex 没成（坏了）；DeepSeek 也没成（DeepSeek 余额不足/);
      await project();
      await assert.rejects(go(setup({ codex: new Error('坏了'), ds: ANS([]), key: '' }).api, '定稿对剧本'), /没填 DeepSeek 的 key/);
    });

    await check('内置 AI 的设置：看的时候不回 key；样子不对不存；存之前先查余额', async () => {
      const { api } = setup({ codex: ANS([], '对得上') });
      const out = [];
      const json = (res, o) => out.push(o);
      const req = (method, body) => ({ method, body });
      const readBody = async r => Buffer.from(JSON.stringify(r.body));
      await api.handle(req('GET'), null, new URL('http://x/api/builtin-ai'), { json, readBody });
      assert.deepEqual(out.pop().deepseek.尾号, '0123');
      assert.doesNotMatch(JSON.stringify(out), /sk-/);
      await assert.rejects(api.handle(req('POST', { key: 'abc' }), null, new URL('http://x/api/builtin-ai'), { json, readBody }), /样子不对/);
      await api.handle(req('POST', { key: 'sk-ffffffffffffffffffff9999' }), null, new URL('http://x/api/builtin-ai'), { json, readBody });
      assert.equal(out.pop().余额, '9.90 元');
      assert.equal(JSON.parse(fs.readFileSync(CONF, 'utf8')).DeepSeek.key, 'sk-ffffffffffffffffffff9999');
    });

    await check('回复格式：判断只认两种；行号、批注都整理好', async () => {
      const { api } = setup();
      assert.throws(() => api.parseReply('没有 JSON'), /要一段 JSON/);
      assert.throws(() => api.parseReply('{"判断": "也许"}'), /对得上 或 要改剧本/);
      const g = api.parseReply('好的 {"判断": "要改剧本", "批注": [{"行号": "3", "批注": " 改 "}, {"行号": 4, "批注": ""}], "不归剧本": [{"依据": "第2条", "为什么": "长相"}]}');
      assert.deepEqual(g.批注, [{ 行号: 3, 批注: '改', 依据: '', 改成: null, 删镜头: '' }]);   // 没回「改成」的记 null：这一条不能照片子直接改
      assert.equal(g.不归剧本.length, 1);
    });
    /* ---------- 照片子改剧本（11-18）：真的用 剧本读写.js 读写 Word ---------- */
    const RW = path.join(__dirname, '..', '剧本读写.js');
    const { execFileSync } = require('node:child_process');
    const docText = async f => execFileSync(process.execPath, [RW, '读', f], { encoding: 'utf8' }).replace(/\r\n/g, '\n').replace(/\n+$/, '');
    const writeDoc = async (job, kind, f, text) => { const tmp = path.join(job.dir, kind + '.txt'); await writeFile(tmp, text + '\n'); execFileSync(process.execPath, [RW, '查', tmp, kind]); execFileSync(process.execPath, [RW, '写剧本', f, tmp]); };
    const archive = async (n, rel) => { const src = pj(n, ...rel); if (!fs.existsSync(src)) return; const b = rel[rel.length - 1].replace(/(\.[^.]+)$/, '__' + Date.now() + '$1'); const dst = pj(n, '历史记录', ...rel.slice(0, -1), b); await fsp.mkdir(path.dirname(dst), { recursive: true }); await fsp.rename(src, dst); };
    let SCENE = {};
    const deps = { docText, writeDoc, archive, mmdd: () => '11-18', sceneFor: async () => SCENE, shotRows: async () => [{ 号: '1', 写什么: '老李端碗' }, { 号: '2', 写什么: '小孩看老李' }] };
    const NOTES = P('定稿的剧本', '第1段', '第1段_剧本_批注.md');
    const DROP = ANS([{ 行号: 6, 批注: '镜头2 不要了，这一段删掉', 依据: '提示词没拍镜头2', 改成: '', 删镜头: '2' }, { 行号: 7, 批注: '跟着删掉', 依据: '提示词没拍镜头2', 改成: '', 删镜头: '2' },
      { 行号: 5, 批注: '老李不说话，直接喝', 依据: '提示词镜头1', 改成: '△ 老李一口喝下去，什么也没说。', 删镜头: '' }]);

    await check('定稿对剧本：附上照名字认的那几镜，说清整镜没拍的要删；回的「改成」「删镜头」记进对剧本记录', async () => {
      await project();
      const { api, calls } = setup({ codex: DROP, deps });
      await go(api, '定稿对剧本');
      assert.match(calls.books[0], /## 这条提示词拍的镜头[^\n]*\n镜头1：老李端碗\n镜头2：小孩看老李/);
      assert.match(calls.books[0], /整镜在提示词里根本没拍/); assert.match(calls.books[0], /"改成"/);
      const w = (await ledger()).pop().写了;
      assert.deepEqual(w.map(x => [x.原文, x.改成, x.删镜头 || '']), [['△ 近景：小孩看着老李。', '', '2'], ['老李：烫！', '', '2'], ['老李：烫！', '△ 老李一口喝下去，什么也没说。', '']]);
    });

    await check('照片子改剧本：照改成改剧本、备注记一笔，批注整份收走；剧本定稿照旧、删掉的镜头记进对剧本记录', async () => {
      SCENE = { 剧本定稿: nowText(new Date(Date.now() + 1000)) };
      const { api, calls } = setup({ codex: DROP, deps });
      const { r } = await go(api, '照片子改剧本');
      assert.equal(calls.codex + calls.ds, 0, '不调 AI');
      assert.match(r.结果, /改了 3 处，镜头表删掉镜头2；剧本定稿照旧算数$/);
      const now = await docText(P('定稿的剧本', '第1段', '第1段_剧本.docx'));
      assert.match(now, /△ 全景：老李端起碗。\n△ 老李一口喝下去，什么也没说。\n备注\n11-16 新写\n11-18 照定稿的样片改/);
      assert.doesNotMatch(now.split('\n备注\n')[0], /老李：烫！|小孩看着/);
      assert.ok(!fs.existsSync(NOTES), '批注都照改了，整份收进历史记录');
      assert.equal(fs.readdirSync(P('历史记录', '定稿的剧本', '第1段')).filter(f => /_剧本__.+\.docx$/.test(f)).length, 1, '原来的剧本收进历史记录');
      const rec = (await ledger()).pop();
      assert.deepEqual([rec.事, rec.定稿照旧, rec.删镜头, rec.改了], ['照片子改剧本', true, ['2'], 3]);
      await assert.rejects(go(api, '照片子改剧本'), /没有照定稿样片写、能直接改的/);
    });

    await check('照片子改剧本：人写的批注、没回改成的留着；改之前没定稿的照改，说要重新定稿', async () => {
      await project();
      SCENE = { 剧本定稿: '2020-01-01 00:00:00' };
      await go(setup({ codex: ANS([{ 行号: 5, 批注: '老李不说话', 依据: '', 改成: '△ 老李喝了一口。', 删镜头: '' }, { 行号: 3, 批注: '梗概没回改成', 依据: '' }]), deps }).api, '定稿对剧本');
      const nt = C.parseNotes(await fsp.readFile(NOTES, 'utf8'));
      nt.items.push({ where: '正文', text: '△ 近景：小孩看着老李。', n: 1, note: '人写的：小孩笑一下' });
      await fsp.writeFile(NOTES, C.notesToMd({ title: '第1段 剧本', file: 'x', general: '', items: nt.items }));
      const { r } = await go(setup({ deps }).api, '照片子改剧本');
      assert.match(r.结果, /改了 1 处；改之前剧本就没定稿，要再点「剧本定稿」。还有 2 条批注要照老办法交给 AI 改/);
      assert.deepEqual(C.parseNotes(await fsp.readFile(NOTES, 'utf8')).items.map(x => x.text), ['梗概：老李嘴硬心软。', '△ 近景：小孩看着老李。']);
      assert.equal((await ledger()).pop().定稿照旧, false);
    });

    await check('剧本定稿了没有（公用/核心.js scriptFinal，服务和页面共用）：定稿后没再动，或者只是照片子改过', async () => {
      const t = s => Date.parse(s.replace(' ', 'T'));
      assert.equal(C.scriptFinal('2026-11-18 10:00:00', '', t('2026-11-18 10:00:00') + 500), true);
      assert.equal(C.scriptFinal('2026-11-18 10:00:00', '', t('2026-11-18 10:05:00')), false, '定稿以后剧本又改过');
      assert.equal(C.scriptFinal('2026-11-18 10:00:00', '2026-11-18 10:05:00', t('2026-11-18 10:05:00') + 300), true, '只是照片子改过');
      assert.equal(C.scriptFinal('2026-11-18 10:00:00', '2026-11-18 10:05:00', t('2026-11-18 10:09:00')), false, '照片子改过以后又动了');
      assert.equal(C.scriptFinal('2026-11-18 10:00:00', '2026-11-18 09:00:00', t('2026-11-18 09:00:00')), true);
      assert.equal(C.scriptFinal('', '2026-11-18 10:05:00', t('2026-11-18 10:05:00')), false, '没点过剧本定稿');
    });

    await check('页面照对剧本记录跟着记（公用/核心.js applyBack）：记上回填、删掉的镜头拿掉、后面不挪号；记过的、改之前没定稿的不动', async () => {
      const rows = () => [{ 写什么: 'a' }, { 写什么: 'b' }, { 写什么: 'c' }];
      const s = { 回填: '', 段落: rows() }, list = [{ 事: '定稿对剧本', 时间: '2026-11-18 10:00:00' }, { 事: '照片子改剧本', 时间: '2026-11-18 10:05:00', 定稿照旧: true, 删镜头: ['2'] }];
      assert.equal(C.applyBack(s, list, ['1', '2', '3']), true);
      assert.equal(s.回填, '2026-11-18 10:05:00');
      assert.deepEqual(s.段落.map(x => [x.号, x.写什么]), [['1', 'a'], ['3', 'c']]);
      assert.equal(C.applyBack(s, list, ['1', '3']), false, '记过的不再动');
      const u = { 回填: '', 段落: rows() };
      assert.equal(C.applyBack(u, [{ 事: '照片子改剧本', 时间: '2026-11-18 10:05:00', 定稿照旧: false, 删镜头: ['2'] }], ['1', '2', '3']), false, '改之前没定稿：要人重新定稿，镜头表也不动');
      assert.equal(u.段落.length, 3);
    });
    console.log('\n全部通过：' + tested + ' 项');
  } finally { fs.rmSync(ROOT, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
