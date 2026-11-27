'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const page = process.env.PROMPT_TEST_PAGE || path.join(__dirname, '../流水线/提示词.html');
const html = fs.readFileSync(page, 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const rowCode = script.slice(script.indexOf('function rowOf('), script.indexOf('/* ---------- 筛选'));

function buttonsOf(node) {
  if (Array.isArray(node)) return node.flatMap(buttonsOf);
  if (!node || typeof node !== 'object') return [];
  return [...(node.tag === 'button' ? [node] : []), ...node.children.flatMap(buttonsOf)];
}
const textOf = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node && typeof node === 'object' ? node.children.map(textOf).join('') : '';
const labelOf = b => b.attrs.class === 'fl-ib' ? '⋯' : textOf(b);

/* made：这一版出过的样片；task：上回排过任务书；filmed：本机服务说这一版出过片（11-22，原稿不能改，只能另存） */
function promptButtons(draft, busy, side, made = [], task = false, filmed = null, v = 25, lack = null) {   // v：本机服务第几版；lack：上一回出片停在「积分不够」的那个任务（11-26）
  const calls = [], fails = [], pops = [];
  const empty = () => [];
  const none = () => null;
  const context = {
    h: (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter(x => x != null) }),
    taskOf: () => '出片任务.txt', promptStale: () => false, PromptDraft: require('../公用/写稿状态.js'),
    X: { tasks: new Set(task ? ['出片任务.txt'] : []), notes: new Map(), side: new Map(side ? [['1-5.txt', side]] : []), filmed: new Map(filmed ? [['1-5.txt', filmed]] : []) },
    vpVer: require('../公用/核心.js').vpVer, vpLabel: require('../公用/核心.js').vpLabel, forkPrompt: (...args) => calls.push(['另存', ...args]),
    reviewFork: (...args) => calls.push(['照批注改', ...args]), chName: () => '我的 AI',
    AI: { ok: true, jobs: busy ? [{ 段: '1', 名: '1-5.txt', 标题: '正在写' }] : [] }, LINK: { v },
    jobLive: () => true, bmStale: () => false,
    vidRefs: empty, frameWs: empty, frameRefsOf: empty, framesOf: empty,
    verLine: none, patchesOf: empty, bmLine: none,
    frameLine: none, frameWordLine: none, jobFailed: k => { fails.push(k); return null; }, jobLine: none,
    icon: none, at: parts => parts, dirOf: () => ['提示词', '第1段'],
    promptsOf: () => ['这一段的几条'],
    ReviewPop: { btn: (s, e, list) => ({ tag: 'button', attrs: { class: 'btn sm', disabled: !made.length, onclick: () => calls.push(['审片', s, e, list]) }, children: ['审片'] }), tag: none },   // 审片弹窗（流水线/审片弹窗.js，11-22；「已出片」标签 11-25 也挪过去了）：它自己的测试在 审片弹窗_测试.cjs
    openWrite: (...args) => calls.push(['编辑', ...args]),
    openShell: (...args) => calls.push(['查看', ...args]),
    approve: (...args) => calls.push(['出片', ...args]),
    lackJob: () => lack, lackAsk: (...args) => calls.push(['换号', ...args]),
    go: (...args) => calls.push(['去', ...args]),
    outFrameDlg: (...args) => calls.push(['出关键帧', ...args]),
    removePrompt: (...args) => calls.push(['删除', ...args]),
    popover: (anchor, build) => { const p = { anchor, closed: false }; p.el = build(() => { p.closed = true; }); pops.push(p); },
  };
  vm.createContext(context);
  vm.runInContext(rowCode, context, { filename: page });
  const scene = { 段: '1' }, entry = { name: '1-5.txt', label: '镜头1-5', draft };
  const row = context.rowOf(scene, entry, made), buttons = buttonsOf(row);
  return { buttons, calls, scene, entry, row, fails, pops, context };
}

test('提示词页面脚本语法有效，页面说明不再引导点击已移除的按钮', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: page }));
  assert.doesNotMatch(html, /让\s*AI\s*批一批/);
  assert.match(html, /确认满意后点「批准出片」/);
  assert.doesNotMatch(script, /'(看排好的|挂白模…|挂关键帧…)'/);   // 11-21 他定：那一行不再摆
  assert.doesNotMatch(html, /点「打开看、写批注」|'打开看、写批注'|「打开看、写批注」在提示词上写/);   // 11-24 他定：这个按钮拿掉
  assert.doesNotMatch(script, /点「挂关键帧…」/);
});

for (const draft of [false, true]) {
  test((draft ? '改过的稿' : 'AI 初稿') + '：那一行只摆编辑、批准出片、审片和「⋯」；出关键帧、删除收在「⋯」里', () => {
    const { buttons, calls, scene, entry, pops } = promptButtons(draft, false);
    const labels = buttons.map(labelOf);
    for (const gone of ['看排好的', '挂白模…', '挂关键帧…', '出关键帧…', '删除']) assert.ok(!labels.includes(gone), gone + ' 不该摆在那一行');
    assert.ok(!labels.some(t => /批一批/.test(t)));
    buttons.find(b => labelOf(b) === '进去改').attrs.onclick();
    assert.deepEqual(calls.at(-1), ['编辑', '1', '1-5.txt']);
    assert.ok(!labels.includes('打开看、写批注'), '11-24 他定：「打开看、写批注」拿掉了');
    assert.ok(!labels.includes('进去看'), '没出片的不摆「进去看」');
    const approve = buttons.find(b => labelOf(b) === '批准出片');
    assert.equal(approve.attrs.disabled, false);
    approve.attrs.onclick();
    assert.deepEqual(calls.at(-1), ['出片', scene, entry]);
    const more = buttons.find(b => labelOf(b) === '⋯');
    more.attrs.onclick({ currentTarget: more });
    assert.equal(pops.length, 1);
    assert.equal(pops[0].anchor, more);
    const items = buttonsOf(pops[0].el);
    assert.deepEqual(items.map(b => textOf(b.children[0].children[0])), ['出关键帧…', '删除']);
    items[0].attrs.onclick();
    assert.deepEqual(calls.at(-1), ['出关键帧', scene, entry]);
    assert.equal(pops[0].closed, true);
    items[1].attrs.onclick();
    assert.deepEqual(calls.at(-1), ['删除', scene, entry]);
  });
}

test('手写稿那一行依次是 接着写、批准出片、看任务书、审片、⋯（11-21 他定）', () => {
  const { buttons } = promptButtons(true, false, { 手写: true }, ['1-5.mp4'], true);
  assert.deepEqual(buttons.map(labelOf), ['接着写', '批准出片', '看任务书', '审片', '⋯']);
});

test('出过片的那一版（11-22 他定：原稿不能改，只能另存）：接着写、进去改换成「另存成改N」和「进去看」（11-24：写稿页锁着只能看），批准出片灰掉，审片照旧', () => {
  const fz = { 出过片: true, 片: ['1-5.mp4'], 历史: [], 在出: false, 下一版: '1-5_改1.txt', 最新: '1-5.txt', 不能另存: '', 批注: ['成片/第1段/1-5_批注.md', '提示词/第1段/1-5_批注.md'] };
  const grey = (b, tip) => { assert.equal(labelOf(b), '批准出片'); assert.equal(b.attrs.disabled, true); assert.doesNotMatch(b.attrs.class, /zhu/); assert.match(b.attrs.title, tip); };
  for (const side of [{ 手写: true }, {}]) {
    const { buttons, calls, scene, entry } = promptButtons(true, false, side, ['1-5.mp4'], true, fz);
    assert.deepEqual(buttons.map(labelOf), ['另存成改1', '进去看', '批准出片', '看任务书', '审片', '⋯']);
    const fork = buttons[0];
    assert.equal(fork.attrs.disabled, false);
    assert.match(fork.attrs.title, /出过片（1-5\.mp4）.*点了打开写稿页照它接着改：改了提示词或素材才存成「1-5_改1\.txt」，一处没改就不另存；原稿和它出的样片都不动/);   // 11-23 晚他定：另存不看审片、批注
    assert.doesNotMatch(fork.attrs.title, /批注/);
    fork.attrs.onclick();
    assert.deepEqual(calls.at(-1), ['另存', scene, entry]);
    const look = buttons[1];   // 进去看：打开写稿页（不带 fork，写稿页自己锁着），顶上写「只能看」
    assert.equal(look.attrs.disabled, false);
    assert.match(look.attrs.title, /锁着，不能改.*另存成改1/);
    look.attrs.onclick();
    assert.deepEqual(calls.at(-1), ['编辑', '1', '1-5.txt', !!side.手写, false, true]);
    grey(buttons[2], /出过片了.*另存成改1/);   // 11-22 他定：出过片的不再批准出片，要再出先另存
    assert.equal(buttons[4].attrs.disabled, false);   // 审片照旧能点
  }
  assert.equal(promptButtons(true, true, { 手写: true }, ['1-5.mp4'], false, fz).buttons[0].attrs.disabled, true);   // AI 正在做这一条：等做完
  const bare = promptButtons(true, false, { 手写: true }, ['1-5.mp4'], false, { ...fz, 批注: [] }).buttons[0];   // 还没写批注：照样能另存（11-23 晚）
  assert.equal(labelOf(bare), '另存成改1'); assert.equal(bare.attrs.disabled, false);
  const oldSvc = promptButtons(true, false, { 手写: true }, ['1-5.mp4'], false, fz, 24).buttons[0];   // 本机服务还是第 24 版：另存不会带着写稿页改的字
  assert.equal(oldSvc.attrs.disabled, true); assert.match(oldSvc.attrs.title, /本机服务是旧的/);
  const old = promptButtons(false, false, null, ['1-5.mp4'], false, { ...fz, 下一版: '', 不能另存: '这一条已经有更新的「1-5_改2.txt」了：去改那一版' }).buttons;
  assert.equal(labelOf(old[0]), '另存'); assert.equal(old[0].attrs.disabled, true); assert.match(old[0].attrs.title, /更新的/);
  grey(old[2], /^这一版出过片了，不再出$/);
  grey(promptButtons(true, false, { 手写: true }, [], false, { ...fz, 片: [], 在出: true, 下一版: '', 不能另存: '这一版正在出片：出完再另存成新的一版' }).buttons[2], /正在出片/);
});

test('出过片的那一版：「⋯」里多一样「照审片批注交给 AI 改」（11-23 晚从另存按钮挪过来），没写批注、AI 在做、服务旧的点不了', () => {
  const fz = { 出过片: true, 片: ['1-5.mp4'], 历史: [], 在出: false, 下一版: '1-5_改1.txt', 最新: '1-5.txt', 不能另存: '', 批注: ['成片/第1段/1-5_批注.md', '提示词/第1段/1-5_批注.md'] };
  const menu = (busy, f, v) => {
    const r = promptButtons(true, busy, { 手写: true }, ['1-5.mp4'], false, f, v);
    const more = r.buttons.find(b => labelOf(b) === '⋯');
    more.attrs.onclick({ currentTarget: more });
    const items = buttonsOf(r.pops[0].el);
    return { ...r, more, items, labels: items.map(b => textOf(b.children[0].children[0])), tips: items.map(b => textOf(b.children[0].children[1])) };
  };
  const m = menu(false, fz);
  assert.deepEqual(m.labels, ['照审片批注交给 AI 改', '出关键帧…', '删除']);
  assert.match(m.more.attrs.title, /^照审片批注交给 AI 改、出关键帧…、删除$/);
  assert.equal(m.items[0].attrs.disabled, false);
  assert.match(m.tips[0], /把样片「1-5」的审片批注、提示词上写的批注交给 我的 AI，改好的另存成「镜头1-5 改1」；AI 一处没改就不另存/);
  m.items[0].attrs.onclick();
  assert.deepEqual(m.calls.at(-1), ['照批注改', m.scene, m.entry]);
  const bare = menu(false, { ...fz, 批注: [] });
  assert.equal(bare.items[0].attrs.disabled, true); assert.match(bare.tips[0], /还没写批注：先点「审片」/);
  const busy = menu(true, fz);
  assert.equal(busy.items[0].attrs.disabled, true); assert.match(busy.tips[0], /AI 正在做这一条/);
  const old = menu(false, fz, 24);
  assert.equal(old.items[0].attrs.disabled, true); assert.match(old.tips[0], /本机服务是旧的/);
  const top = menu(false, { ...fz, 下一版: '', 不能另存: '这一条已经有更新的「1-5_改2.txt」了：去改那一版' });
  assert.equal(top.items[0].attrs.disabled, true); assert.match(top.tips[0], /更新的/);
  assert.equal(promptButtons(true, false).buttons.find(b => labelOf(b) === '⋯').attrs.title, '出关键帧…、删除');   // 没出片的照旧
});

test('点「另存成改N」：打开写稿页照这一版接着改，带上下一版的名字；「照审片批注交给 AI 改」开「照审片批注另存」的任务', async () => {
  const fz = { 出过片: true, 片: ['1-5.mp4'], 历史: [], 在出: false, 下一版: '1-5_改1.txt', 最新: '1-5.txt', 不能另存: '', 批注: [] };
  const start = script.indexOf('function forkPrompt('), end = script.indexOf('\n}\n', script.indexOf('async function reviewFork(')) + 3;
  assert.ok(start > 0 && end > start);
  const r = promptButtons(true, false, { 手写: true }, ['1-5.mp4'], false, fz), jobs = [];
  Object.assign(r.context, { startJob: async j => { jobs.push(j); return true; }, rerender: () => r.calls.push(['重画']) });
  vm.runInContext(script.slice(start, end), r.context);
  r.context.forkPrompt(r.scene, r.entry);
  assert.deepEqual(r.calls.at(-1), ['编辑', '1', '1-5.txt', false, '1-5_改1.txt']);
  await r.context.reviewFork(r.scene, r.entry);   // 没写批注：不开
  assert.deepEqual(jobs, []);
  r.context.X.filmed.set('1-5.txt', { ...fz, 批注: ['成片/第1段/1-5_批注.md'] });
  await r.context.reviewFork(r.scene, r.entry);
  assert.deepEqual(jobs.map(j => ({ ...j })), [{ 事: '照审片批注另存', 段: '1', 名: '1-5.txt' }]);   // vm 里建的对象：先摊开再比
  assert.deepEqual(r.calls.at(-1), ['重画']);
});

test('只有「已出片」标签、本机服务不算出过片的（老名字的样片认到这一条上）：批准出片照常能点', () => {
  const b = promptButtons(true, false, { 手写: true }, ['第1-1段_第3条_定稿.mp4']).buttons.find(x => labelOf(x) === '批准出片');
  assert.equal(b.attrs.disabled, false);
  assert.match(b.attrs.class, /zhu/);
});

test('审片（11-22 改成弹窗）：那一行的「审片」交给审片弹窗，带上这一条和这一段的几条；不再去审片那一页', () => {
  const { buttons, calls, scene, entry } = promptButtons(true, false, { 手写: true }, ['1-5.mp4']);
  const rv = buttons.find(b => labelOf(b) === '审片');
  rv.attrs.onclick({ currentTarget: rv });
  assert.equal(calls.at(-1)[0], '审片');
  assert.equal(calls.at(-1)[1], scene);
  assert.equal(calls.at(-1)[2], entry);
  assert.deepEqual([...calls.at(-1)[3]], ['这一段的几条']);   // render 没给 list：照 promptsOf 认
  assert.ok(!calls.some(c => c[0] === '去'));
  assert.match(script, /\(e\.old \? oldRowOf : rowOf\)\(s, e, made\.get\(e\.name\), list\)/);   // render 把这一段的几条带进去（前几版那一行也是，11-26）
  assert.match(html, /<script src="审片弹窗\.js"><\/script>/);
});

test('你来写的稿（写稿资料记「手写」，老稿记「流水线」）标「手写稿」、按钮「接着写」；AI 写的改过的照旧「改过」「进去改」；交给 AI 写完没成也摆出来', () => {
  for (const side of [{ 手写: true }, { 流水线: '这一份是从「流水线」开的稿' }]) {
    const { buttons, calls, row, fails } = promptButtons(true, false, side);
    const labels = buttons.map(labelOf);
    assert.ok(labels.includes('接着写') && !labels.includes('进去改'));
    buttons.find(b => labelOf(b) === '接着写').attrs.onclick();
    assert.deepEqual(calls[0], ['编辑', '1', '1-5.txt', true]);   // 写稿页顶上写「接着写」
    assert.match(textOf(row), /手写稿/);
    assert.doesNotMatch(textOf(row), /改过/);
    assert.ok(fails.includes('写完提示词'));
  }
  const { row, buttons } = promptButtons(true, false, { 写法: '分镜', 分镜稿: '' });
  assert.match(textOf(row), /改过/);
  assert.doesNotMatch(textOf(row), /手写稿/);
  assert.ok(buttons.some(b => labelOf(b) === '进去改'));
  assert.doesNotMatch(textOf(promptButtons(false, false, { 手写: true }).row), /手写稿/);   // 没有写稿资料的（AI 初稿）不看 X.side
});

test('已有任务执行时，批准出片仍禁用', () => {
  const { buttons } = promptButtons(true, true);
  assert.equal(buttons.find(b => labelOf(b) === '批准出片').attrs.disabled, true);
});

test('第五步审片拿掉了（11-22 他定：审片是每条上的弹窗）：不再摆「下一步：审片」，也不去审片那一页', () => {
  assert.doesNotMatch(script, /下一步：审片/);
  assert.doesNotMatch(script, /go\('审片'/);
  assert.doesNotMatch(script, /reviewState|reviewBtn/);
  assert.ok(!fs.existsSync(path.join(path.dirname(page), '审片.html')), '审片.html 该删了');
});

test('AI 批注怎么照改（11-24 拿掉「打开看、写批注」以后）：出过片的点「另存成改N」，你来写的接着写，AI 写的进去改', () => {
  const r = promptButtons(true, false, { 手写: true });
  const at = script.indexOf('function notesHow('), end = script.indexOf('\n}\n', at) + 3;
  assert.ok(at > 0);
  vm.runInContext(script.slice(at, end), r.context);
  const how = (fz, draft, side) => { r.context.X.filmed = new Map(fz ? [['1-5.txt', fz]] : []); r.context.X.side = new Map(side ? [['1-5.txt', side]] : []); return r.context.notesHow({ name: '1-5.txt', draft }); };
  assert.match(how({ 下一版: '1-5_改1.txt' }, true, { 手写: true }), /^点「另存成改1」.*改了才存成新的一版/);
  assert.match(how({ 下一版: '', 不能另存: '这一版正在出片：出完再另存成新的一版' }, true), /^这一版正在出片/);
  assert.match(how(null, true, { 手写: true }), /^点「接着写」/);
  assert.match(how(null, false), /^点「进去改」/);
});

test('「已出片 / 没出片」筛选和标签照「审片」能不能点同一套算（11-24：审完收进历史记录的也算）', () => {
  const r = script.slice(script.indexOf('function render('));
  assert.match(r, /ReviewPop\.madeOf\(s, e, list\)/);
  assert.doesNotMatch(r, /cl\.made\(/);
  assert.match(html, /成片、历史记录里有这一版的样片就算/);
  assert.doesNotMatch(script, /function madeTag\(/, '「已出片」标签 11-25 挪进 审片弹窗.js 的 ReviewPop.tag，历史记录那一页也用');
  assert.match(rowCode, /ReviewPop\.tag\(made\)/);
});

test('历史记录里也能筛「已出片 / 没出片」（11-25）：数法照 HistView.made，列表照同一个筛子摆', () => {
  const r = script.slice(script.indexOf('function render(')), fb = script.slice(script.indexOf('function filterBar('), script.indexOf('function render('));
  assert.match(fb, /HistView\.made\(s\)/);
  assert.match(fb, /出片时用的是这一版就算/);
  assert.match(r, /HistView\.promptView\(s, hc, pf, /);
  assert.match(r, /filterBar\(s, rows, made, pf, hc\)/);   // 11-26 起一版一行：数的是摆出来的几行
});

test('几版都摆，一版一行（11-26 他定：删 11-12 点了五回删除，每回一版顶上来，看着像没删）：前几版那一行只有 进去看、看任务书、审片、⋯', () => {
  const Core = require('../公用/核心.js'), calls = [];
  const fam = { name: '11-12_改2.txt', key: '11-12.txt', ver: 2, vers: ['11-12.txt', '11-12_改1.txt', '11-12_改2.txt'], label: '镜头11-12 改2', draft: true };
  const one = { name: '15.txt', key: '15.txt', ver: 0, vers: ['15.txt'], label: '镜头15', draft: false };
  const ctx = {
    h: (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter(x => x != null) }),
    vpVer: Core.vpVer, vpLabel: Core.vpLabel, vpTok: Core.vpTok, taskOf: Core.vpTask,
    F: { names: new Map([['3-4', { set: new Set(['11-12_改1_写稿.json']) }]]) },
    famOf: (s, n) => [fam, one].find(x => x.vers.includes(n)) || null,
    X: { filmed: new Map([['11-12_改1.txt', { 出过片: true }]]), tasks: new Set([Core.vpTask('11-12_改1.txt')]) },
    AI: { jobs: [] }, jobLive: () => true, icon: () => null, at: p => p, dirOf: () => ['提示词', '第3-4段'],
    ReviewPop: { tag: () => null, open: (...a) => calls.push(['审片', ...a]) },
    openWrite: (...a) => calls.push(['进去看', ...a]), openShell: (...a) => calls.push(['看字', ...a]), showText: (...a) => calls.push(['任务书', ...a]),
    moreMenu: (...a) => calls.push(['⋯', ...a]),
  };
  vm.createContext(ctx);
  vm.runInContext(script.slice(script.indexOf('function oldVer('), script.indexOf('async function diffDlg(')) + '\nObject.assign(globalThis, { verRows, rowEntry });', ctx, { filename: page });
  const s = { 段: '3-4' }, rows = ctx.verRows(s, [fam, one]);
  assert.deepEqual(rows.map(e => e.name), ['11-12_改2.txt', '11-12_改1.txt', '11-12.txt', '15.txt']);   // 最新的在前，前几版跟着
  assert.equal(rows[0], fam);
  assert.deepEqual(rows.map(e => e.old || ''), ['', '11-12_改2.txt', '11-12_改2.txt', '']);
  assert.deepEqual(rows.map(e => e.label), ['镜头11-12 改2', '镜头11-12 改1', '镜头11-12', '镜头15']);
  assert.deepEqual(rows.map(e => e.draft), [true, true, false, false]);
  assert.equal(ctx.rowEntry(s, '11-12_改1.txt').old, '11-12_改2.txt');   // 鼠标停在前几版那一行、点 @图片N：认得出是哪一版
  assert.equal(ctx.rowEntry(s, '11-12_改2.txt'), fam);
  assert.equal(ctx.rowEntry(s, '9.txt'), null);

  const made = [{ vid: '11-12_改1.mp4', ver: '11-12_改1.txt', old: true }], bs = buttonsOf(ctx.oldRowOf(s, rows[1], made, 'list'));
  assert.deepEqual(bs.map(labelOf), ['进去看', '看任务书', '审片', '⋯']);   // 不能改、不能批准出片：改稿、出片用最新那一版
  bs[0].attrs.onclick();
  assert.deepEqual(calls.at(-1), ['进去看', '3-4', '11-12_改1.txt', false, false, true]);   // 出过片的：写稿页锁着只能看
  bs[2].attrs.onclick();
  assert.deepEqual(calls.at(-1), ['审片', s, rows[1], 'list', made[0]]);   // 先开这一版出的片
  bs[3].attrs.onclick({ currentTarget: bs[3] });
  assert.deepEqual(calls.at(-1), ['⋯', bs[3], s, rows[1], false]);

  const bare = buttonsOf(ctx.oldRowOf(s, rows[2], [], 'list'));
  assert.deepEqual(bare.map(labelOf), ['进去看', '审片', '⋯']);
  assert.equal(bare[1].attrs.disabled, true);   // 没出过片：审片灰着
  bare[0].attrs.onclick();
  assert.equal(calls.at(-1)[0], '看字');   // 没出过片的前几版只给看字，不进写稿页改

  const menu = script.slice(script.indexOf('function moreMenu('), script.indexOf('/* 你来写的稿（11-19 又能写了）'));
  assert.match(menu, /e\.old \? null : item\('出关键帧…'/);   // 前几版的「⋯」里只有删除
  const del = script.slice(script.indexOf('async function removePrompt('), script.indexOf('/* ---------- 写稿页里加减镜头'));
  assert.match(del, /只删「' \+ vpLabel\(e\.name\) \+ '」这一版、这一行/);
  assert.doesNotMatch(del, /这一条回到「/);   // 删了不再是上一版顶上来
});

/* 11-26 他要：原来的号没积分了，弹窗问要不要换个号出（流水线/换号出片.js，另有 换号出片_测试.cjs） */
test('积分不够：出片报完价这个号不够，这一条上多一个「换个号出」，点了问换不换号；没这回事、正在做的时候不摆', () => {
  const lack = { 事: '出片', 状态: '没成', 缺积分: { 要: 180, 有: 137, 登录位: '', 账号: '测试号', 参数: { 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0 } } };
  const a = promptButtons(false, false, null, [], true, null, 25, lack), b = a.buttons.find(x => labelOf(x) === '换个号出');
  assert.ok(b, a.buttons.map(labelOf).join('、'));
  b.attrs.onclick();
  assert.deepEqual(a.calls.pop(), ['换号', a.scene, a.entry, lack]);
  assert.ok(!promptButtons(false, false).buttons.some(x => labelOf(x) === '换个号出'));
  assert.ok(!promptButtons(false, true, null, [], true, null, 25, lack).buttons.some(x => labelOf(x) === '换个号出'), '正在做的时候不摆');
});
