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

function promptButtons(draft, busy) {
  const calls = [];
  const empty = () => [];
  const none = () => null;
  const context = {
    h: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(x => x != null) }),
    taskOf: () => '出片任务.txt', promptStale: () => false,
    X: { tasks: new Set(), notes: new Map() },
    AI: { ok: true, jobs: busy ? [{ 段: '1', 名: '1-5.txt', 标题: '正在写' }] : [] },
    jobLive: () => true, bmStale: () => false,
    vidRefs: empty, frameWs: empty, frameRefsOf: empty, framesOf: empty,
    madeTag: none, verLine: none, patchesOf: empty, bmLine: none,
    frameLine: none, frameWordLine: none, jobFailed: none, jobLine: none,
    icon: none, at: parts => parts, dirOf: () => ['提示词', '第1段'],
    openWrite: (...args) => calls.push(['编辑', ...args]),
    openShell: (...args) => calls.push(['查看', ...args]),
    approve: (...args) => calls.push(['出片', ...args]),
  };
  vm.createContext(context);
  vm.runInContext(rowCode, context, { filename: page });
  const scene = { 段: '1' }, entry = { name: '1-5.txt', label: '镜头1-5', draft };
  const buttons = buttonsOf(context.rowOf(scene, entry, []));
  return { buttons, calls, scene, entry };
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
