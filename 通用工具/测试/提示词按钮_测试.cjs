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
  if (!node || typeof node !== 'object') return [];
  return [...(node.tag === 'button' ? [node] : []), ...node.children.flatMap(buttonsOf)];
}

function promptButtons(draft, busy, side) {
  const calls = [], fails = [];
  const empty = () => [];
  const none = () => null;
  const context = {
    h: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(x => x != null) }),
    taskOf: () => '出片任务.txt', promptStale: () => false, PromptDraft: require('../公用/写稿状态.js'),
    X: { tasks: new Set(), notes: new Map(), side: new Map(side ? [['1-5.txt', side]] : []) },
    AI: { ok: true, jobs: busy ? [{ 段: '1', 名: '1-5.txt', 标题: '正在写' }] : [] },
    jobLive: () => true, bmStale: () => false,
    vidRefs: empty, frameWs: empty, frameRefsOf: empty, framesOf: empty,
    madeTag: none, verLine: none, patchesOf: empty, bmLine: none,
    frameLine: none, frameWordLine: none, jobFailed: k => { fails.push(k); return null; }, jobLine: none,
    icon: none, at: parts => parts, dirOf: () => ['提示词', '第1段'],
    openWrite: (...args) => calls.push(['编辑', ...args]),
    openShell: (...args) => calls.push(['查看', ...args]),
    approve: (...args) => calls.push(['出片', ...args]),
  };
  vm.createContext(context);
  vm.runInContext(rowCode, context, { filename: page });
  const scene = { 段: '1' }, entry = { name: '1-5.txt', label: '镜头1-5', draft };
  const row = context.rowOf(scene, entry, []), buttons = buttonsOf(row);
  return { buttons, calls, scene, entry, row, fails };
}

test('提示词页面脚本语法有效，页面说明不再引导点击已移除的按钮', () => {
  assert.doesNotThrow(() => new vm.Script(script, { filename: page }));
  assert.doesNotMatch(html, /让\s*AI\s*批一批/);
  assert.match(html, /确认满意后点「批准出片」/);
});

for (const draft of [false, true]) {
  test((draft ? '改过的稿' : 'AI 初稿') + '只去掉 AI 批一批，编辑、查看与出片入口可用', () => {
    const { buttons, calls, scene, entry } = promptButtons(draft, false);
    const labels = buttons.map(b => b.children.join(''));
    assert.ok(!labels.some(t => /批一批/.test(t)));
    assert.ok(labels.includes('出关键帧…'));
    assert.ok(labels.includes('删除'));
    const edit = buttons.find(b => b.children.includes('进去改'));
    edit.attrs.onclick();
    assert.deepEqual(calls[0], ['编辑', '1', '1-5.txt']);
    const view = buttons.find(b => b.children.includes(draft ? '看排好的' : '打开看、写批注'));
    view.attrs.onclick();
    assert.equal(calls[1][0], '查看');
    const approve = buttons.find(b => b.children.includes('批准出片'));
    assert.equal(approve.attrs.disabled, false);
    approve.attrs.onclick();
    assert.deepEqual(calls[2], ['出片', scene, entry]);
  });
}

const textOf = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.children.map(textOf).join('') : '';

test('你来写的稿（写稿资料记「手写」，老稿记「流水线」）标「手写稿」、按钮「接着写」；AI 写的改过的照旧「改过」「进去改」；铺底没成也摆出来', () => {
  for (const side of [{ 手写: true }, { 流水线: '这一份是从「流水线」开的稿' }]) {
    const { buttons, calls, row, fails } = promptButtons(true, false, side);
    const labels = buttons.map(b => b.children.join(''));
    assert.ok(labels.includes('接着写') && !labels.includes('进去改'));
    buttons.find(b => b.children.includes('接着写')).attrs.onclick();
    assert.deepEqual(calls[0], ['编辑', '1', '1-5.txt', true]);   // 写稿页顶上写「接着写」
    assert.match(textOf(row), /手写稿/);
    assert.doesNotMatch(textOf(row), /改过/);
    assert.ok(fails.includes('直接铺底'));
  }
  const { row, buttons } = promptButtons(true, false, { 写法: '分镜', 分镜稿: '' });
  assert.match(textOf(row), /改过/);
  assert.doesNotMatch(textOf(row), /手写稿/);
  assert.ok(buttons.some(b => b.children.includes('进去改')));
  assert.doesNotMatch(textOf(promptButtons(false, false, { 手写: true }).row), /手写稿/);   // 没有写稿资料的（AI 初稿）不看 X.side
});

test('已有任务执行时，批准出片仍禁用', () => {
  const { buttons } = promptButtons(true, true);
  assert.equal(buttons.find(b => b.children.includes('批准出片')).attrs.disabled, true);
});

test('「下一步：审片」照审片那一步锁不锁摆（11-18：别的提示词待核对，出好的样片也要能去审）', () => {
  const line = script.split('\n').find(l => l.includes('下一步：审片'));
  assert.ok(line, '提示词那一步要有「下一步：审片」');
  assert.match(line, /reviewState\(s\)\.st !== 'lock'/);
  assert.doesNotMatch(line, /!stale\.length \?/);
});
