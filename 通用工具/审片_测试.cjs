'use strict';
/* 公用/审片.js：审片台.html 和 项目管理.html 审片共用的那一份（2026-11-15 并成一份） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const R = require('./公用/审片.js');

/* 造一个最小的 mp4：只有 moov > trak > mdia > hdlr、mdhd、minf > stbl > stts */
function box(type, ...kids) {
  const body = Buffer.concat(kids);
  const head = Buffer.alloc(8); head.writeUInt32BE(8 + body.length, 0); head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}
function mp4({ scale, entries }) {
  const hdlr = Buffer.alloc(24); hdlr.write('vide', 8, 'latin1');
  const mdhd = Buffer.alloc(24); mdhd.writeUInt32BE(scale, 12);
  const stts = Buffer.alloc(8 + entries.length * 8); stts.writeUInt32BE(entries.length, 4);
  entries.forEach(([count, delta], i) => { stts.writeUInt32BE(count, 8 + i * 8); stts.writeUInt32BE(delta, 12 + i * 8); });
  const moov = box('moov', box('trak', box('mdia', box('hdlr', hdlr), box('mdhd', mdhd), box('minf', box('stbl', box('stts', stts))))));
  return new Blob([box('ftyp', Buffer.from('isom0000')), moov]);
}

test('从 mp4 头里读帧率、帧数；读不出给 null', async () => {
  assert.deepEqual(await R.videoInfo(mp4({ scale: 12288, entries: [[360, 512]] })), { frames: 360, fps: 24 });
  const ntsc = await R.videoInfo(mp4({ scale: 30000, entries: [[300, 1001]] }));
  assert.equal(ntsc.frames, 300); assert.equal(ntsc.fps, 30000 / 1001);
  assert.equal(await R.videoInfo(new Blob([Buffer.from('不是视频的东西')])), null);
});

test('时间、帧号、截图名', () => {
  assert.equal(R.fmt(75.25), '1:15.2');
  assert.equal(R.rangeText({ f: 36, f2: null }, 24), '0:01.5');
  assert.equal(R.rangeText({ f: 36, f2: 48 }, 24), '0:01.5～0:02.0');
  assert.equal(R.frameText({ f: 36, f2: 48 }), '第37～49帧');
  assert.equal(R.shotFileName(36, 24), '0分01.5秒_第37帧.jpg');
  assert.equal(R.fpsText(30000 / 1001), '29.97');
  assert.deepEqual(R.framesOf('0:01.5～0:02.0（第37～49帧）', 24), [36, 48]);
  assert.deepEqual(R.framesOf('0:01.5', 24), [36, null]);
  assert.equal(R.framesOf('没写时间', 24), null);
  assert.equal(R.brief({ f: 0, f2: null, text: '短' }, 24), '0:00.0　短');
  assert.equal(R.shotOf('３'), '03');
  assert.equal(R.shotOf(' 镜头2 '), '镜头2');
  assert.deepEqual(R.catsOf(new Set(['自己加的', '表演', '光影'])), ['光影', '表演', '自己加的']);
});

test('弃用关键帧那一行', () => {
  assert.deepEqual(R.kfParse('@图片9 E:\\AI\\项目\\李云龙\\资产\\第3-4段\\镜头4_首帧.png'), { ref: '@图片9', rel: '资产/第3-4段/镜头4_首帧.png', raw: 'E:\\AI\\项目\\李云龙\\资产\\第3-4段\\镜头4_首帧.png' });
  assert.equal(R.kfParse('不是图片编号'), null);
});

test('批注路径：有完整位置写 E:\\ 开头，没有写相对批注文件夹的', () => {
  const at = ['项目', '测试', '成片', '第1段', 'a_批注.md'];
  assert.equal(R.relPath(at, ['项目', '测试', '成片', '第1段', 'a.mp4'], ''), 'a.mp4');
  assert.equal(R.relPath(at, ['项目', '测试', '提示词', '第1段', '视频提示词.txt'], ''), '../../提示词/第1段/视频提示词.txt');
  assert.equal(R.relPath(at, ['项目', '测试', '成片', '第1段', 'a.mp4'], 'E:\\AI'), 'E:\\AI\\项目\\测试\\成片\\第1段\\a.mp4');
});

/* 审片台写出来的样子（有对照、弃用关键帧） */
const DESK = [
  '# 审片批注｜第1段_第1条_样片480p.mp4', '', '视频：第1段_第1条_样片480p.mp4', '提示词：../../提示词/第1段/视频提示词.txt', '',
  '用户在流水线「审片」里边看这条样片边写的批注。时间是样片里的位置（分:秒.十分之一秒），括号里是第几帧（从 1 数，每秒 24 帧）；「镜头」对应提示词里的「镜头 N」；'
  + '「对照」是写这一条时旁边摆着对照的东西（白模、另一条样片是同一时刻的画面，关键帧是这一镜开头那一刻该有的样子）；'
  + '写了「弃用关键帧」的，是用户不要这张关键帧了，「批注」写的是为什么；照方案改的时候照新稿重出一张换上，理由说这一镜不要关键帧的就从新稿里拿掉；'
  + '截图是写这条批注时停住的那一帧，先看截图再读批注。路径都相对这份批注所在的文件夹。', '',
  '## 整体', '批注：节奏太慢', '',
  '## 1｜0:01.5～0:02.0', '时间：0:01.5～0:02.0（第37～49帧）', '分类：光影、表演', '镜头：02', '对照：白模 ../../资产/第1段/白模.mp4（同一时刻）', '截图：第1段_第1条_样片480p_批注截图/0分01.5秒_第37帧.jpg', '结束截图：第1段_第1条_样片480p_批注截图/0分02.0秒_第49帧.jpg', '批注：脸太暗', '＃不是标题', '',
  '## 2｜0:03.0', '时间：0:03.0（第73帧）', '弃用关键帧：@图片3 ../../资产/第1段/镜头3_首帧.png', '截图：第1段_第1条_样片480p_批注截图/0分03.0秒_第73帧.jpg', '批注：这张人画大了', '',
].join('\n');
const show = parts => R.relPath(['项目', '测试', '成片', '第1段', '第1段_第1条_样片480p_批注.md'], parts, '');
const shotsDir = ['项目', '测试', '成片', '第1段', '第1段_第1条_样片480p_批注截图'];
const deskOpts = p => ({ title: '第1段_第1条_样片480p.mp4', video: '第1段_第1条_样片480p.mp4', prompt: p.promptLine, fps: 24, general: p.general, notes: p.notes,
  where: '流水线「审片」', shotWord: '镜头 N', rel: true, show, shotsDir, kfShow: kf => kf.raw });

test('读得回来：对照、弃用关键帧、多行批注', () => {
  const p = R.parseNotes('\uFEFF' + DESK, 24);
  assert.equal(p.prompt, '视频提示词.txt');
  assert.equal(p.general, '节奏太慢');
  assert.equal(p.notes.length, 2);
  const [a, b] = p.notes;
  assert.deepEqual({ f: a.f, f2: a.f2, cats: a.cats, shot: a.shot, cmp: a.cmp, img: a.img, img2: a.img2, text: a.text },
    { f: 36, f2: 48, cats: ['光影', '表演'], shot: '02', cmp: '白模 ../../资产/第1段/白模.mp4（同一时刻）', img: '0分01.5秒_第37帧.jpg', img2: '0分02.0秒_第49帧.jpg', text: '脸太暗\n＃不是标题' });
  assert.deepEqual(b.kf, { ref: '@图片3', rel: '资产/第1段/镜头3_首帧.png', raw: '../../资产/第1段/镜头3_首帧.png' });
});

test('读了再写回去一字不差（另一页改了也不丢对照、弃用关键帧）', () => {
  const p = R.parseNotes(DESK, 24);
  assert.equal(R.notesText(deskOpts(p)), DESK);
});

test('看文件那一页写的：开头那句写它的页名、「镜头 NN」，没有对照、弃用关键帧就不说那两句', () => {
  const p = R.parseNotes(DESK, 24);
  p.notes = p.notes.slice(0, 1).map(n => ({ ...n, cmp: '' }));
  const t = R.notesText({ ...deskOpts(p), where: ' 项目管理.html ', shotWord: '镜头 NN', rel: false });
  assert.ok(t.includes('用户在 项目管理.html 里边看这条样片边写的批注。'));
  assert.ok(t.includes('「镜头」对应提示词里的「镜头 NN」；截图是写这条批注时停住的那一帧，先看截图再读批注。\n'));
  assert.ok(!t.includes('对照') && !t.includes('弃用关键帧') && !t.includes('路径都相对'));
});

test('修改方案：头上几行、一条一条（引号去掉、写「删掉」当删）、写回去', () => {
  const md = '\uFEFF视频：第1段_第1条_样片480p.mp4\r\n提示词：视频提示词.txt\r\n出方案：11-15 20:00\r\n总的看法：节奏慢\r\n改成了：视频提示词_改1.txt\r\n\r\n## 1\r\n- **原文**：「老李坐下」\r\n- 改成：删掉\r\n- 原因：多余\r\n\r\n## 第2条\r\n- 怎么改：加一句\r\n  接着写\r\n';
  const p = R.parsePlan(md);
  assert.deepEqual([p.视频, p.提示词, p.出方案, p.总, p.done], ['第1段_第1条_样片480p.mp4', '视频提示词.txt', '11-15 20:00', '节奏慢', ['视频提示词_改1.txt']]);
  assert.deepEqual(p.items, [{ no: 1, 原文: '老李坐下', 改成: '', 原因: '多余' }, { no: 2, 怎么改: '加一句接着写' }]);
  assert.equal(R.planText(p.items[0]), '## 1\n- 原因：多余\n- 原文：老李坐下\n- 改成：（删掉）');
});

test('你定的：「定」「批注」（批注后面几行都算它的），「整体」那一节', () => {
  const n = R.parsePlanNote('\uFEFF## 整体\n批注：都慢一点\n\n## 1\n定：照我说的改\n批注：改成站着\n第二行\n\n## 2\n定：不改\n');
  assert.equal(n.general, '都慢一点');
  assert.deepEqual([...n.items], [[1, { 定: '照我说的改', 批注: '改成站着\n第二行' }], [2, { 定: '不改', 批注: '' }]]);
});
