'use strict';
/* 流水线/审片台这一条.js（2026-11-22 他定：审片弹窗只摆这一条提示词出的样片，进去以后换不到别的提示词） */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(TOOLS, f), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));   // 另一个 vm 里造的数组：比之前换成这边的
const textOf = n => typeof n === 'string' ? n : Array.isArray(n) ? n.map(textOf).join('') : n && typeof n === 'object' ? textOf(n.children) : '';
const all = (n, out = []) => { if (Array.isArray(n)) n.forEach(x => all(x, out)); else if (n && typeof n === 'object') { out.push(n); all(n.children, out); } return out; };

/* 审片台那一页：网址 q；成片里 here、历史记录里 hist（名字 → 修改时间，批注也写在里面）；prompts：提示词文件夹里的几版；
   dirs：别的文件夹里有什么（{ 文件夹: { 名字: 修改时间 } }，历史记录/提示词 用）；files：读得到的文件（{ 项目里的路径: 字 }） */
function desk({ q, here = {}, hist = {}, prompts, sel = null, host = null, confirm = true, v = 27, notes = 0, md = '# 批注\n- 00:01 太慢', dirs = {}, files = {} }) {
  const log = [], pops = [];
  const P = new URLSearchParams(q);
  const ctx = {
    URLSearchParams, TextEncoder, TextDecoder, Map, Set, console, crypto: require('node:crypto').webcrypto,
    location: { search: '?' + P, replace: u => log.push(['换', u]) },
    PJ: P.get('p'), SEG: P.get('s'), SEGD: '第' + P.get('s') + '段', VID: P.get('v'), OLD: P.get('old') === '1',
    VIDEO_RE: /\.(mp4|m4v|mov|webm)$/i,
    D: { prompt: '', promptKeep: '', prompts: (prompts || []).map(name => ({ name })), form: null, saveT: 0, q: Promise.resolve(), notes: Array(notes).fill({}), general: '', notesAt: ['项目', P.get('p'), '成片', 'x_批注.md'], shotsDir: ['项目', P.get('p'), '成片', 'x_批注截图'], checking: false },
    flowScene: () => (sel ? { 选定: sel } : {}),
    listRel: async dir => Object.entries(dirs[dir] || (dir.startsWith('历史记录/') ? hist : here)).map(([name, mtime]) => ({ name, kind: 'file', mtime })),
    readText: async rel => { if (!(rel in files)) throw new Error('没有这个文件'); return files[rel]; },
    leave: async () => { log.push(['存']); return true; }, host: () => host, goBack: () => log.push(['关']), saveNow: () => log.push(['马上存']),
    clipLabel: n => n.replace(/\.[^.]+$/, ''), baseName: n => n, unbom: t => t,
  };
  ctx.promptFams = () => ctx.Core.vpFams(prompts).map(({ key, vers }) => ({ key, name: vers[vers.length - 1], vers }));
  ctx.window = ctx;
  ctx.UI = {
    h: (tag, attrs, ...kids) => ({ tag, attrs: attrs || {}, children: kids.flat(Infinity).filter(x => x != null) }),
    toast: (t, k) => log.push(['提示', t, k || '']),
    popover: (anchor, build) => { const p = { anchor, closed: false }; p.el = build(() => { p.closed = true; }); pops.push(p); },
    confirmDlg: async o => { log.push(['问', o.title, o.body]); return confirm; },
    copyText: async (t, ok) => { log.push(['复制', t]); return true; },
  };
  ctx.Base = { C: { decodeText: () => ({ text: md }) }, LINK: { abs: 'E:\\AI短视频项目', v }, FS: { read: async () => ({ buf: new Uint8Array() }), isDir: async () => true } };
  vm.createContext(ctx);
  for (const f of ['公用/核心.js', '公用/资产路径.js', '公用/样片归属.js', '公用/历史记录.js', '流水线/审片台这一条.js']) vm.runInContext(read(f), ctx, { filename: f });
  ctx.RE_VP = ctx.Core.RE_VP;   // 审片台.html 从 Core 里取出来的
  return { ctx, log, pops, One: ctx.DeskOne };
}
const PR = ['11-12.txt', '11-12_改1.txt', '11-13.txt', '11-13_改1.txt', '11-13_改2.txt', '8-9.txt'];
const HERE = { '11-13_改2.mp4': 5, '11-13_改2_2.mp4': 9, '11-13_改2_2_批注.md': 9, '11-12_改1.mp4': 3, '8-9.mp4': 1 };
const HIST = { '11-13_改1.mp4': 2, '11-13_改2__20261122-101010.mp4': 4, '11-12.mp4': 1 };

test('只认网址里 k 那一条：几版出的、历史记录里的都摆，别的提示词的、删掉那一版的不摆', async () => {
  const { One } = desk({ q: { p: '试验', s: '3-4', v: '11-13_改2.mp4', k: '11-13.txt' }, here: HERE, hist: HIST, prompts: PR });
  const fam = await One.load();
  assert.equal(fam.key, '11-13.txt');
  assert.deepEqual(plain(One.items.map(x => [x.vid, x.ver, x.old, x.noted])), [
    ['11-13_改2.mp4', '11-13_改2.txt', false, false], ['11-13_改2_2.mp4', '11-13_改2.txt', false, true], ['11-13_改1.mp4', '11-13_改1.txt', true, false]]);
  assert.deepEqual(plain(One.others().map(x => [x.rel, x.ver])), [['成片/第3-4段/11-13_改2_2.mp4', '11-13_改2.txt'], ['历史记录/成片/第3-4段/11-13_改1.mp4', '11-13_改1.txt']]);
});

test('网址没给 k：照样片名字认是哪一条；历史记录里的只照名字认', async () => {
  const a = desk({ q: { p: '试验', s: '3-4', v: '11-12_改1.mp4' }, here: HERE, hist: HIST, prompts: PR });
  assert.equal((await a.One.load()).key, '11-12.txt');
  assert.deepEqual(plain(a.One.items.map(x => x.vid)), ['11-12_改1.mp4', '11-12.mp4']);
  const b = desk({ q: { p: '试验', s: '3-4', v: '11-13_改1.mp4', old: '1' }, here: HERE, hist: HIST, prompts: PR });
  assert.equal((await b.One.load()).key, '11-13.txt');
});

test('顶栏：没有挑提示词的下拉；样片只有一条不摆「换」；历史记录里的不摆「这条不要了」', async () => {
  const one = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR });
  await one.One.load();
  one.ctx.D.prompt = '8-9.txt';
  const top = one.One.top({ tag: 'div', attrs: {}, children: [] }), els = all(top);
  assert.ok(!els.some(x => x.tag === 'select'), '不能换到别的提示词');
  assert.deepEqual(els.filter(x => x.tag === 'button').map(textOf), ['关闭', '复制批注', '这条不要了']);
  assert.match(textOf(top), /审片 · 第3-4段 · 镜头8-9/);
  assert.match(textOf(top), /出自 镜头8-9/);
  const old = desk({ q: { p: '试验', s: '3-4', v: '11-13_改1.mp4', k: '11-13.txt', old: '1' }, here: HERE, hist: HIST, prompts: PR });
  await old.One.load();
  const b2 = all(old.One.top(null)).filter(x => x.tag === 'button').map(textOf);
  assert.deepEqual(b2, ['关闭', '11-13_改1　3 / 3 ▾', '复制批注']);
});

test('换一条：只摆这一条的；先存批注再换，网址带着 k 和哪一版', async () => {
  const { One, pops, log } = desk({ q: { p: '试验', s: '3-4', v: '11-13_改2.mp4', k: '11-13.txt' }, here: HERE, hist: HIST, prompts: PR });
  await One.load();
  const pick = all(One.top(null)).find(x => x.tag === 'button' && /▾/.test(textOf(x)));
  pick.attrs.onclick({ currentTarget: pick });
  const items = all(pops[0].el).filter(x => x.tag === 'button');
  assert.deepEqual(items.map(x => textOf(x.children[0].children[0])), ['11-13_改2', '11-13_改2_2', '11-13_改1']);
  items[2].attrs.onclick();
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(log.slice(-2).map(x => x[0]), ['存', '换']);
  const q = new URLSearchParams(log.at(-1)[1].split('?')[1]);
  assert.deepEqual([q.get('v'), q.get('k'), q.get('pr'), q.get('old')], ['11-13_改1.mp4', '11-13.txt', '11-13_改1.txt', '1']);
});

test('这条不要了：问过、存好批注，交给弹窗那一页挪；挪好换到成片里的下一条，没有了就收起；挪不成留着说为什么', async () => {
  const moved = [];
  const host = { retire: async v => { moved.push(v); return ''; }, close: () => moved.push('收起') };
  const a = desk({ q: { p: '试验', s: '3-4', v: '11-13_改2.mp4', k: '11-13.txt' }, here: HERE, hist: HIST, prompts: PR, host });
  await a.One.load();
  await all(a.One.top(null)).find(x => textOf(x) === '这条不要了').attrs.onclick();
  assert.deepEqual(moved, ['11-13_改2.mp4']);
  assert.match(a.log.at(-1)[1], /v=11-13_%E6%94%B92_2\.mp4/);   // 下一条：11-13_改2_2
  const b = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR, host });
  await b.One.load();
  await all(b.One.top(null)).find(x => textOf(x) === '这条不要了').attrs.onclick();
  assert.deepEqual(moved.slice(-2), ['8-9.mp4', '收起']);
  const c = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR, host: { retire: async () => '没移走：剪映开着', close: () => {} } });
  await c.One.load();
  await all(c.One.top(null)).find(x => textOf(x) === '这条不要了').attrs.onclick();
  assert.deepEqual(plain(c.log.at(-1)), ['提示', '没移走：剪映开着', 'err']);
  assert.equal(c.ctx.D.checking, false);
  const d = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR, host, confirm: false });
  await d.One.load();
  await all(d.One.top(null)).find(x => textOf(x) === '这条不要了').attrs.onclick();
  assert.ok(!d.log.some(x => x[0] === '存'), '没点「移进历史记录」：不动');
});

test('这条不要了，问的时候说清提示词怎么办（11-26 同进同出）：这一版还有片在成片里就留着；是最后一条，提示词跟着进历史记录，这一条回到上一版或者没了', async () => {
  const ask = async (opt) => { const x = desk({ here: HERE, hist: HIST, prompts: PR, host: { retire: async () => '', close: () => {} }, ...opt }); await x.One.load(); await all(x.One.top(null)).find(n => textOf(n) === '这条不要了').attrs.onclick(); return x.log.find(l => l[0] === '问')[2]; };
  assert.match(await ask({ q: { p: '试验', s: '3-4', v: '11-13_改2.mp4', k: '11-13.txt' } }), /「镜头11-13 改2」还有 1 条片在成片里，提示词留着/);
  const only = await ask({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' } });
  assert.match(only, /出它的提示词 8-9\.txt 也一起收进历史记录/);
  assert.match(only, /这一条在提示词页就没了/);
  const back = await ask({ q: { p: '试验', s: '3-4', v: '11-13_改2.mp4', k: '11-13.txt' }, here: { '11-13_改2.mp4': 5 } });
  assert.match(back, /出它的提示词 11-13_改2\.txt 也一起收进历史记录.*这一条回到「镜头11-13 改1」/);
  const older = await ask({ q: { p: '试验', s: '3-4', v: '11-12_改1.mp4', k: '11-12.txt' }, prompts: [...PR, '11-12_改2.txt'] });
  assert.match(older, /出它的提示词 11-12_改1\.txt 也一起收进历史记录/);
  assert.doesNotMatch(older, /回到|没了/, '不是最新一版：这一条照旧');
  assert.match(await ask({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, v: 26 }), /提示词留在原处/, '本机服务还是老的：不说跟着挪');
});

test('复制批注：没批注说一声；有批注连完整路径一起复制', async () => {
  const none = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR });
  await none.One.load();
  await all(none.One.top(null)).find(x => textOf(x) === '复制批注').attrs.onclick();
  assert.equal(none.log.at(-1)[0], '提示');
  const some = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR, notes: 2 });
  await some.One.load();
  await all(some.One.top(null)).find(x => textOf(x) === '复制批注').attrs.onclick();
  const [kind, text] = some.log.at(-1);
  assert.equal(kind, '复制');
  assert.match(text, /^我审第3-4段的样片「8-9\.mp4」写了批注，文件在 E:\\AI短视频项目\\项目\\试验\\成片\\x_批注\.md，截图在 .*x_批注截图。/);
  assert.match(text, /- 00:01 太慢/);
});

test('审片台引了它，网址里的 k 只认这一条（不再有「出自」的下拉、不再回审片那一页）', () => {
  const html = read('流水线/审片台.html');
  assert.match(html, /<script src="审片台这一条\.js"><\/script>/);
  assert.doesNotMatch(html, /setPrompt|paintSel|审片\.html|guessPrompt/);
  assert.match(html, /DeskOne\.load\(\)/);
});

/* 历史记录里的一版（11-25 他要的：流水线历史记录那一页点「审片」，网址带 hp） */
const T = require('../公用/历史记录.js').ms;
const HPD = '历史记录/提示词/第3-4段', HP1 = HPD + '/11-13_改1__20261120-101010.txt';
const HDIRS = { [HPD]: { '11-13_改1__20261120-101010.txt': 1, '11-13_改1__20261121-101010.txt': 1, '11-13_改1_写稿__20261120-101010.json': 1 } };
const HHERE = { '11-13_改1_4.mp4': T('20261118-000000'), '11-13_改1_2.mp4': T('20261120-120000'), '11-13_改2.mp4': T('20261123-000000') };
const HHIST = { '11-13_改1.mp4': T('20261119-000000'), '11-13_改1_3.mp4': T('20261122-000000') };
const hdesk = (more = {}) => desk({ q: { p: '试验', s: '3-4', v: '11-13_改1.mp4', old: '1', hp: HP1 }, here: HHERE, hist: HHIST, prompts: PR, dirs: HDIRS, ...more });

test('hp：只摆那一版出的样片（收进去以前出的，成片、历史记录里的都算），换一条网址带着 hp、不带 k 和 pr', async () => {
  const { One, pops, log } = hdesk();
  assert.equal((await One.load()).key, '11-13_改1.txt');
  assert.deepEqual(plain(One.items.map(x => [x.vid, x.old])), [['11-13_改1_4.mp4', false], ['11-13_改1.mp4', true]], '11-20 以后出的（改1_2、改1_3）是后几版的');
  assert.deepEqual(plain(One.others().map(x => x.rel)), ['成片/第3-4段/11-13_改1_4.mp4']);
  const pick = all(One.top(null)).find(x => x.tag === 'button' && /▾/.test(textOf(x)));
  pick.attrs.onclick({ currentTarget: pick });
  assert.match(textOf(pops[0].el), /只摆历史记录里这一版出的/);
  assert.doesNotMatch(textOf(pops[0].el), /认不出是哪一版出的/);
  all(pops[0].el).filter(x => x.tag === 'button')[0].attrs.onclick();
  await new Promise(r => setTimeout(r, 0));
  const q = new URLSearchParams(log.at(-1)[1].split('?')[1]);
  assert.deepEqual([q.get('v'), q.get('hp'), q.get('k'), q.get('pr'), q.get('old')], ['11-13_改1_4.mp4', HP1, null, null, null]);
});

test('hp：顶栏写「收进历史记录的那一版」，不摆「这条不要了」；字读不了照实说', async () => {
  const { One, ctx } = hdesk();
  await One.load();
  ctx.D.prompt = '11-13_改1.txt';
  const top = One.top(null);
  assert.match(textOf(top), /出自 镜头11-13 改1 · 11-20 10:10 收进历史记录的那一版/);
  assert.deepEqual(all(top).filter(x => x.tag === 'button').map(textOf), ['关闭', '11-13_改1　2 / 2 ▾', '复制批注']);
  const one = hdesk({ q: { p: '试验', s: '3-4', v: '11-13_改1_4.mp4', hp: HP1 } });
  await one.One.load();
  assert.ok(!all(one.One.top(null)).some(x => textOf(x) === '这条不要了'), '成片里的也不摆：历史记录里的一版只看');
  assert.match(textOf(one.One.top(null)), /历史记录里的这一版读不了/);
});

test('hp：那一版的字和挂的图照它自己的登记（oldPrompt）；读不了给 err；不是历史记录里的一版给 null', async () => {
  const text = '老的字', sha = require('node:crypto').createHash('sha256').update(text).digest('hex');
  const map = { prompts: { '提示词/第3-4段/11-13_改1.txt': { prompt_sha256: sha, references: [{ ref: '@图片1', path: '资产/人物和道具/兵.png', sha256: 'b' }], 秒数: [3, 4] } } };
  const a = hdesk({ files: { [HP1]: text, '资产/参考素材映射.json': JSON.stringify(map) } });
  assert.deepEqual(plain(await a.One.oldPrompt()), { rel: HP1, text, refs: [{ ref: '@图片1', path: '资产/人物和道具/兵.png', sha: 'b' }], secs: [3, 4] });
  const b = hdesk();
  assert.deepEqual(plain(await b.One.oldPrompt()), { rel: HP1, err: '没有这个文件' });
  const c = desk({ q: { p: '试验', s: '3-4', v: '8-9.mp4', k: '8-9.txt' }, here: HERE, prompts: PR });
  assert.equal(await c.One.oldPrompt(), null);
});

test('审片台照 hp 摆那一版的字：引了 公用/历史记录.js，loadPrompt 收 oldPrompt 给的字和挂图', () => {
  const html = read('流水线/审片台.html');
  assert.match(html, /<script src="\.\.\/公用\/历史记录\.js"><\/script>/);
  assert.match(html, /await DeskOne\.oldPrompt\(\)/);
  assert.match(html, /loadPrompt\(want, old\)/);
});
