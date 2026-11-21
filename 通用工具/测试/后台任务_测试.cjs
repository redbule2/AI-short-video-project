'use strict';
/* 流水线/后台任务.js：顶栏「后台任务」抽屉里，一件事去哪一页、怎么排、怎么说 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const B = require('../流水线/后台任务.js');

const NOW = 1_800_000_000_000;
const job = o => ({ id: 'j' + Math.random().toString(36).slice(2, 8), 渠道名: 'Codex', 状态: '在做', 建: NOW - 60e3, 开始: NOW - 50e3, 结束: 0, 步骤: '', 交给: null, ...o });
const go = o => { const t = B.targetOf(job(o)); return [t.page, t.s, t.hash]; };

test('一场里的事：去那一场的那一步', () => {
  assert.deepEqual(go({ 事: '出图', 段: '3-4' }), ['资产', '3-4', '']);
  assert.deepEqual(go({ 事: '写字', 段: '1-1' }), ['资产', '1-1', '']);
  assert.deepEqual(go({ 事: '核GEO', 段: '1-1' }), ['资产', '1-1', '']);
  assert.deepEqual(go({ 事: '写提示词', 段: '3-4' }), ['提示词', '3-4', '']);
  assert.deepEqual(go({ 事: '写完提示词', 段: '3-4' }), ['提示词', '3-4', '']);   // 交给 AI 写完（11-21，以前的 AI 铺底、整理分镜并进来了）
  assert.deepEqual(go({ 事: '出片', 段: '3-4' }), ['提示词', '3-4', '']);
  assert.deepEqual(go({ 事: '批注提示词', 段: '3-4' }), ['提示词', '3-4', '']);
  assert.deepEqual(go({ 事: '提炼', 段: '2' }), ['分场', '2', '']);
  assert.deepEqual(go({ 事: '影响清单', 段: '1-2' }), ['剧本', '1-2', '']);
  assert.deepEqual(go({ 事: '定稿对剧本', 段: '1-1' }), ['审片', '1-1', '']);
});

test('按剧本批注改：任务上没写第几段，从批注文件名认', () => {
  assert.deepEqual(go({ 事: '按批注改', 段: '', 批注: '定稿的剧本/第1-2段/第1-2段_剧本_批注.md' }), ['剧本', '1-2', '']);
  assert.deepEqual(go({ 事: '与AI沟通剧本', 段: '1-1' }), ['剧本', '1-1', '']);   // 剧本页「与AI继续沟通」开的（11-17）
  assert.equal(B.segOf({ 段: '', 标题: '按批注改 · 第3-4段_剧本' }), '3-4');
  assert.equal(B.segOf({ 段: '第五段' }), '');
});

test('全片的事：去全片设定的那个分页；一段另选的风格去那一段', () => {
  assert.deepEqual(go({ 事: '补细', 人物: ['童爸爸'], 道具: [] }), ['设定', '', '人物']);
  assert.deepEqual(go({ 事: '补细', 人物: [], 道具: ['面车'] }), ['设定', '', '道具']);
  assert.deepEqual(go({ 事: '场景GEO' }), ['设定', '', '场景']);
  assert.deepEqual(go({ 事: '推荐风格', 段: '' }), ['设定', '', '风格']);
  assert.deepEqual(go({ 事: '推荐风格', 段: '1-1' }), ['剧本', '1-1', '']);
});

test('认不出的事、一场里的事没说第几段：回首页', () => {
  assert.deepEqual(go({ 事: '以后新加的事', 段: '1-1' }), ['总览', '', '']);
  assert.deepEqual(go({ 事: '出图', 段: '' }), ['总览', '', '']);
});

test('去哪儿的说法', () => {
  assert.equal(B.whereOf({ page: '资产', s: '3-4', hash: '' }), '第3-4段 · 资产');
  assert.equal(B.whereOf({ page: '分场', s: '2', hash: '' }), '第2段 · 提炼');
  assert.equal(B.whereOf({ page: '设定', s: '', hash: '人物' }), '全片设定 · 人物');
  assert.equal(B.whereOf({ page: '总览', s: '', hash: '' }), '首页');
});

test('在做的这会儿在干什么', () => {
  assert.equal(B.sayOf(job({ 状态: '排队' })), '排着队，前面还有别的任务');
  assert.equal(B.sayOf(job({ 交给: { 方式: 'self', 等: '你' } })), '等你交给 AI');
  assert.equal(B.sayOf(job({ 交给: { 方式: 'claude', 等: '发送' } })), '等你在 Claude 里按发送');
  assert.equal(B.sayOf(job({ 步骤: 'Codex 在出图' })), 'Codex 在出图');
  assert.equal(B.sayOf(job({ 步骤: '', 渠道名: 'DeepSeek' })), 'DeepSeek 在做');
});

test('做完的一句：结果、停掉、没成的原因', () => {
  assert.equal(B.endOf({ 状态: '做完', 结果: '任务书写好了' }), '任务书写好了');
  assert.equal(B.endOf({ 状态: '做完', 结果: '' }), '做完了');
  assert.equal(B.endOf({ 状态: '停了' }), '停掉了');
  assert.equal(B.endOf({ 状态: '没成', 错误: '画布不对' }), '没成：画布不对');
});

test('怎么排：这个项目的在前、同一项目挨着；等你的在前，排队的在后，先开的在前', () => {
  const ai = [
    job({ id: 'b1', 项目: '乙', 事: '出图', 段: '1-1', 开始: NOW - 9e5 }),
    job({ id: 'a1', 项目: '甲', 事: '写提示词', 段: '1-1', 开始: NOW - 3e5 }),
    job({ id: 'a2', 项目: '甲', 事: '出图', 段: '1-1', 状态: '排队', 开始: 0, 建: NOW - 9e5 }),
    job({ id: 'a3', 项目: '甲', 事: '出片', 段: '1-1', 开始: NOW - 1e5, 交给: { 方式: 'self', 等: '你' } }),
    job({ id: 'a4', 项目: '甲', 事: '写字', 段: '1-1', 开始: NOW - 6e5 }),
    job({ id: 'c1', 项目: '丙', 事: '提炼', 段: '2', 开始: NOW - 1e5 }),
  ];
  const { live } = B.rowsOf(ai, [], '甲', NOW);
  assert.equal(live.length, 6);
  assert.deepEqual(live.slice(0, 4).map(r => r.id), ['a3', 'a4', 'a1', 'a2']);
  assert.deepEqual(new Set(live.slice(4).map(r => r.p)), new Set(['乙', '丙']));
  assert.equal(live[0].wait, true);
  assert.equal(live[0].where, '第1-1段 · 提示词');
});

test('刚做完的：半小时里的，新的在前，最多 6 件；停掉的任务身上还挂着「交给」也不算等你', () => {
  const ai = [
    job({ id: 'd1', 项目: '甲', 状态: '做完', 结束: NOW - 5 * 60e3, 结果: '好了' }),
    job({ id: 'd2', 项目: '甲', 状态: '停了', 结束: NOW - 60e3, 交给: { 方式: 'self', 等: '你' } }),
    job({ id: 'd3', 项目: '乙', 状态: '没成', 结束: NOW - 31 * 60e3, 错误: '太久了' }),
    ...Array.from({ length: 8 }, (_, i) => job({ id: 'e' + i, 项目: '甲', 状态: '做完', 结束: NOW - (10 + i) * 60e3 })),
  ];
  const { live, done } = B.rowsOf(ai, [], '甲', NOW);
  assert.equal(live.length, 0);
  assert.deepEqual(done.map(r => r.id), ['d2', 'd1', 'e0', 'e1', 'e2', 'e3']);
  assert.equal(done[0].wait, false);
  assert.equal(done[0].say, '停掉了');
});

test('网盘的活：做到几个、好了、出错几处，点了去网盘那一页', () => {
  const pan = [
    { id: 1, kind: 'up', p: '甲', title: '上传 3 个文件', state: 'running', started: NOW - 2e4, done: 2, total: 5 },
    { id: 2, kind: 'down', p: '乙', title: '', state: 'failed', started: NOW - 9e5, ended: NOW - 6e4, nErrors: 3 },
    { id: 3, kind: 'del', p: '甲', title: '删掉网盘上的 1 个', state: 'done', started: NOW - 9e5, ended: NOW - 2e5 },
  ];
  const { live, done } = B.rowsOf([], pan, '甲', NOW);
  assert.equal(live.length, 1);
  assert.equal(live[0].say, '做了 2 / 5');
  assert.equal(live[0].page, '网盘');
  assert.equal(live[0].where, '网盘');
  assert.deepEqual(done.map(r => [r.title, r.say, r.ok]), [['网盘 · 拿下来', '没全做成（3 处出错）', false], ['删掉网盘上的 1 个', '好了', true]]);
  // 11-18：本机服务重开时那件在做，跟着断了：说清楚，别只说出错几处
  const cut = B.rowsOf([], [{ id: 4, kind: 'up', p: '甲', title: '上传 9 个文件', state: 'failed', restarted: true, started: NOW - 9e4, ended: NOW - 1e3, nErrors: 1 }], '甲', NOW).done;
  assert.deepEqual(cut.map(r => r.say), ['本机服务重开过，没做完：点进去「再来一次」']);
});

test('做了多久、几分钟前', () => {
  assert.equal(B.durText(0), '0:00');
  assert.equal(B.durText(65e3), '1:05');
  assert.equal(B.durText(3725e3), '1:02:05');
  assert.equal(B.durText(-5e3), '0:00');
  assert.equal(B.agoText(30e3), '刚刚');
  assert.equal(B.agoText(5 * 60e3 + 10e3), '5 分钟前');
});
