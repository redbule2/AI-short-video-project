'use strict';
/* 核心.js 里各页共用的几样：认「标签：内容」、读 DOCX、读文字。写稿页、写稿状态.js 都改用这一份（2026-11-15） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Core = require('../公用/核心.js');
const PromptDraft = require('../公用/写稿状态.js');

test('splitLabel：标签 1–10 个字，只认汉字、字母、/、｜、·', () => {
  const cases = [
    ['风格 ： 写实', { label: '风格', value: ' 写实' }],
    ['风格:写实', { label: '风格', value: '写实' }],
    ['人物/道具｜说明·一：x', { label: '人物/道具｜说明·一', value: 'x' }],
    ['一二三四五六七八九十：x', { label: '一二三四五六七八九十', value: 'x' }],
    ['一二三四五六七八九十一：x', null],   // 11 个字
    ['镜头1：门开了', null],   // 带数字的不算标签
    ['\uF900：兼容汉字', { label: '\uF900', value: '兼容汉字' }],
    ['\uAC00：한국어', null],   // 韩文不算（写稿状态.js 原来那份会认）
    ['\uD842\uDFB7：生僻字', null],   // 基本平面以外的不算
    ['没有冒号', null],
  ];
  for (const [line, want] of cases) assert.deepEqual(Core.splitLabel(line), want, line);
});

test('写稿状态.js 认标签和 核心.js 一样：基础设定一行写回「标签：内容」', () => {
  const text = '【生成目标】\n夜里来人\n\n【基础设定】\n影像风格 : 写实\n\uAC00\uAC01 ： 값\n\n【事件脚本】\n镜头1：门开了。\n';
  const d = PromptDraft.parse(text);
  assert.equal(d.fmt, 'pe');
  const want = ['影像风格 : 写实', '\uAC00\uAC01 ： 값'].map(t => { const f = Core.splitLabel(t); return f ? f.label + '：' + f.value.trim() : t; });
  assert.deepEqual(d.basic, want);
  assert.deepEqual(d.basic, ['影像风格：写实', '\uAC00\uAC01 ： 값']);
  assert.equal(PromptDraft.serialize(d), text);   // 没改就原样写回
});

const docx = body => Core.zip([{ name: 'word/document.xml', data: '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>' }]);
/* 写稿页拿 DOCX 的字对照着看：段里的换行、制表符去掉，空段不要 */
const paras = async buf => (await Core.readDocx(buf)).map(p => p.text.replace(/[\t\n]/g, '')).filter(s => s.trim());

test('readDocx：制表符、换行、字符引用、空段', async () => {
  const buf = await docx('<w:p><w:r><w:t>甲</w:t><w:tab/><w:t>乙</w:t><w:br/><w:t>丙</w:t></w:r></w:p>'
    + '<w:p></w:p>'
    + '<w:p><w:r><w:t>&#x4E00;&amp;&#20108;</w:t></w:r></w:p>');
  const all = await Core.readDocx(buf);
  assert.deepEqual(all.map(p => p.text), ['甲\t乙\n丙', '', '一&二']);
  assert.deepEqual(await paras(buf), ['甲乙丙', '一&二']);
});

test('readDocx：段里套文本框，外面那段的字不丢', async () => {
  const buf = await docx('<w:p><w:r><w:t>前</w:t></w:r><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>框里</w:t></w:r></w:p></w:txbxContent></w:pict></w:r><w:r><w:t>后</w:t></w:r></w:p>');
  assert.ok((await paras(buf)).some(t => t.includes('前') && t.includes('后')));
});

test('decodeText：UTF-8 原样、开头的 BOM 另看 hasBom、不是 UTF-8 的照 GB18030', () => {
  const u8 = s => new TextEncoder().encode(s);
  assert.equal(Core.decodeText(u8('提示词')).text, '提示词');
  const withBom = new Uint8Array([0xEF, 0xBB, 0xBF, ...u8('甲')]);
  assert.equal(Core.hasBom(withBom), true);
  assert.equal(Core.decodeText(withBom).text, '甲');
  const gb = new Uint8Array([0xCC, 0xE1, 0xCA, 0xBE]);   // 「提示」的 GB18030
  assert.deepEqual(Core.decodeText(gb), { text: '提示', encoding: 'gb18030' });
});

test('文件名：Windows 能不能用、场景文字起名', () => {
  assert.ok(Core.nameOk('面摊') && Core.nameOk('第1-1段_第2条.mp4'));
  for (const bad of ['', '..', 'a/b', 'a:b', '尾巴有点.', '尾巴有空格 ', 'a\u0001b']) assert.equal(Core.nameOk(bad), false, bad);
  assert.equal(Core.sceneStem('面摊：傍晚，路灯刚亮'), '面摊');
  assert.equal(Core.sceneStem('一个出租屋内，一张床'), '一个出租屋内');
  assert.equal(Core.sceneStem('没有标点的一长串场景文字写到这里'), '没有标点的一长串场景文字');
  assert.equal(Core.sceneStem(null), '');
});

test('视频提示词的名字（老稿）：第几条、改几、样片名里写的', () => {
  const t = n => [Core.RE_VP.test(n), Core.vpNo(n), Core.vpVer(n), Core.vpLabel(n), Core.vpTok(n)];
  assert.deepEqual(t('视频提示词.txt'), [true, 1, 0, '第1条', '提示词01']);
  assert.deepEqual(t('视频提示词_02_改3.txt'), [true, 2, 3, '第2条 改3', '提示词02改3']);
  assert.deepEqual(t('镜头1-3_视频提示词.TXT'), [true, 0, 0, '镜头1-3', '镜头1-3']);   // 老稿；后缀大写也认
  assert.deepEqual(t('甲_乙_视频提示词_改1.txt'), [true, 0, 1, '甲 乙 改1', '甲_乙改1']);
  assert.equal(Core.RE_VP.test('出片任务.txt'), false);
  assert.equal(Core.vpBase('视频提示词_02_改3.txt'), '视频提示词_02.txt');
});

test('视频提示词照镜头号起名（11-16）：1-5.txt、3.txt、1-3、5.txt', () => {
  const t = n => [Core.RE_VP.test(n), Core.vpNo(n), Core.vpVer(n), Core.vpLabel(n), Core.vpTok(n)];
  assert.deepEqual(t('1-5.txt'), [true, 0, 0, '镜头1-5', '1-5']);
  assert.deepEqual(t('4-9_改2.txt'), [true, 0, 2, '镜头4-9 改2', '4-9改2']);
  assert.deepEqual(t('3.txt'), [true, 0, 0, '镜头3', '3']);
  assert.deepEqual(t('1-3、5.txt'), [true, 0, 0, '镜头1-3、5', '1-3、5']);
  for (const bad of ['1-5_写稿.json', '1-5_批注.md', '1-5_出片任务.txt', '1-5_补1.txt', 'a1-5.txt', '1-.txt', '1-5_02.txt']) assert.equal(Core.RE_VP.test(bad), false, bad);
  assert.equal(Core.vpBase('4-9_改2.txt'), '4-9.txt');
  assert.deepEqual(t('3-3b.txt'), [true, 0, 0, '镜头3-3b', '3-3b']);   // 中间加的镜头号 3b（拍哪几镜照镜头表算，见 关键帧绑定_测试.cjs）
  assert.deepEqual(Core.vpPatchOf('1-5_改2_补1.txt'), { of: '1-5_改2.txt', no: 1 });
  assert.equal(Core.vpLabel('1-5_补3.txt'), '镜头1-5 补3');
  assert.equal(Core.vpTok('1-5_改2_补1.txt'), '1-5改2补1');
  const pairs = [['1-5.txt', '1-5_出片任务.txt'], ['1-5_改1.txt', '1-5_出片任务_改1.txt'], ['1-3、5_改2_补1.txt', '1-3、5_出片任务_改2_补1.txt']];
  for (const [vp, tf] of pairs) { assert.equal(Core.vpTask(vp), tf, vp); assert.equal(Core.taskVp(tf), vp, tf); assert.ok(Core.RE_TASK.test(tf), tf); }
  assert.equal(Core.patchOut('第3-5段', '1-5_补1.txt', ['第3-5段_第2条_1-5_样片480p.mp4', '第3-5段_第3条_1-5改1_样片480p.mp4']).no, 2);
});

test('补片稿：原名_补N.txt 不算一版，补的是原名那一版出的样片', () => {
  assert.equal(Core.RE_VP.test('视频提示词_改2_补1.txt'), false);   // 流水线、审片台、vpLatest 都不把它当新的一版
  assert.deepEqual(Core.vpPatchOf('视频提示词_改2_补1.txt'), { of: '视频提示词_改2.txt', no: 1 });
  assert.deepEqual(Core.vpPatchOf('视频提示词_02_补3.txt'), { of: '视频提示词_02.txt', no: 3 });
  assert.deepEqual(Core.vpPatchOf('镜头1-5_视频提示词_补1.txt'), { of: '镜头1-5_视频提示词.txt', no: 1 });
  assert.equal(Core.vpPatchOf('视频提示词_改2.txt'), null);
  assert.equal(Core.vpPatchOf('视频提示词_改2_补1_写稿.json'), null);
  assert.equal(Core.vpLabel('视频提示词_改2_补1.txt'), '第1条 改2 补1');
  assert.equal(Core.vpTok('视频提示词_改2_补1.txt'), '提示词01改2补1');
  assert.equal(Core.vpTok('视频提示词_02_补2.txt'), '提示词02补2');
  assert.equal(Core.vpLabel('视频提示词_改2.txt'), '第1条 改2');   // 不是补片的照旧
  assert.equal(Core.vpTok('镜头1-5_视频提示词_改1.txt'), '镜头1-5改1');
});

test('出片任务书和提示词一一对应，补片也是', () => {
  const pairs = [['视频提示词.txt', '出片任务.txt'], ['视频提示词_02.txt', '出片任务_02.txt'], ['视频提示词_改2.txt', '出片任务_改2.txt'],
    ['视频提示词_02_改1_补3.txt', '出片任务_02_改1_补3.txt'], ['视频提示词_改2_补1.txt', '出片任务_改2_补1.txt'], ['镜头1-5_视频提示词_改1.txt', '镜头1-5_出片任务_改1.txt']];
  for (const [vp, tf] of pairs) { assert.equal(Core.vpTask(vp), tf, vp); assert.equal(Core.taskVp(tf), vp, tf); assert.ok(Core.RE_TASK.test(tf), tf); }
  assert.equal(Core.RE_TASK.test('出片任务_改2_补1_旧.txt'), false);
});

test('补片出到哪：那一版出的样片里第几条最大的，旁边的 样片名_补片/补N.mp4', () => {
  const names = ['第1-1段_第2条_提示词01改1_720p.mp4', '第1-1段_第3条_提示词01改2_样片480p.mp4', '第1-1段_第3条_提示词01改2_样片480p_批注.md',
    '第1-1段_第3条_提示词01改2_样片480p_批注截图', '第1-1段_第4条_第3条补片_720p.mp4', '第1-1段_第5条_提示词01改21_样片480p.mp4', '第1-1段_第6条_提示词01_样片480p.mp4'];
  assert.deepEqual(Core.patchOut('第1-1段', '视频提示词_改2_补1.txt', names),
    { no: 3, sample: '第1-1段_第3条_提示词01改2_样片480p.mp4', dir: '第1-1段_第3条_提示词01改2_样片480p_补片', file: '补1.mp4', patch: 1 });
  assert.equal(Core.patchOut('第1-1段', '视频提示词_改2_补1.txt', names.concat('第1-1段_第7条_提示词01改2_720p.mp4')).no, 7);   // 那一版出过几条：取最后一条
  assert.equal(Core.patchOut('第1-1段', '视频提示词_改3_补1.txt', names), null);   // 改3 还没出过样片
  assert.equal(Core.patchOut('第1-2段', '视频提示词_改2_补1.txt', names), null);   // 别的段的不算
  assert.equal(Core.patchOut('第1-1段', '视频提示词_改2.txt', names), null);   // 不是补片稿
});

test('样片和提示词同名（11-18 他定：好找）：1_改3.txt 出的叫 1_改3.mp4，同一版再出一条 _2、_3', () => {
  assert.equal(Core.clipName('1_改3.txt', []), '1_改3.mp4');
  assert.equal(Core.clipName('1_改3.txt', ['1_改3.mp4', '1_改3_批注.md', '1_改3_批注截图', '第3-4段_第20条_1改3_720p.mp4']), '1_改3_2.mp4');
  assert.equal(Core.clipName('1_改3.txt', ['1_改3.mp4', '1_改3_3.mp4']), '1_改3_4.mp4');   // 移进历史记录的也让开
  assert.equal(Core.clipName('1.txt', ['1_改3.mp4', '1-5.mp4', '1_补1.mp4']), '1.mp4');   // 别的版、别的条、补片拼的不算
  assert.equal(Core.clipName('视频提示词_02.txt', ['视频提示词.mp4']), '视频提示词_02.mp4');
  assert.equal(Core.clipTake('1_改3.mp4', '1_改3.txt'), 1);
  assert.equal(Core.clipTake('1_改3_2.mp4', '1_改3.txt'), 2);
  assert.equal(Core.clipTake('1_改3_2.mp4', '1.txt'), 0);
  assert.equal(Core.clipTake('1_改3_补1.mp4', '1_改3.txt'), 0);
  assert.equal(Core.clipTake('1_改3.md', '1_改3.txt'), 0);
  assert.equal(Core.clipTake('1-5.mp4', '1.txt'), 0);
  assert.equal(Core.clipOfVer('1_改3_补1.mp4', '1_改3.txt'), true);   // 补片拼好的和补片稿同名，也算这一版的
  assert.equal(Core.clipOfVer('1_改3_补1_2.mp4', '1_改3.txt'), true);
  assert.equal(Core.clipOfVer('1_改3_补片.mp4', '1_改3.txt'), false);
  assert.equal(Core.clipOfVer('1_改3.mp4', '1.txt'), false);
  assert.equal(Core.clipOfVer('第3-4段_第20条_1改3_720p.mp4', '1_改3.txt'), false);   // 老名字照记号认（公用/样片归属.js）
  assert.equal(Core.clipOld('第3-4段_第20条_1改3_720p.mp4'), true);
  assert.equal(Core.clipOld('1_改3.mp4'), false);
});

test('补片出到哪（新名字）：那一版最后出的那条，1_改3_2.mp4 比 1_改3.mp4 新，也比老名字的新', () => {
  const names = ['第3-4段_第20条_1改3_720p.mp4', '1_改3.mp4', '1_改3_2.mp4', '1_改3_批注.md', '1_改3_补1.mp4', '1-5.mp4'];
  assert.deepEqual(Core.patchOut('第3-4段', '1_改3_补1.txt', names), { no: 0, sample: '1_改3_2.mp4', dir: '1_改3_2_补片', file: '补1.mp4', patch: 1 });
  assert.deepEqual(Core.patchOut('第3-4段', '1_改3_补2.txt', ['1_改3.mp4']), { no: 0, sample: '1_改3.mp4', dir: '1_改3_补片', file: '补2.mp4', patch: 2 });
  assert.equal(Core.patchOut('第3-4段', '1_改3_补1.txt', ['第3-4段_第20条_1改3_720p.mp4']).no, 20);   // 只有老名字的：照旧
  assert.equal(Core.patchOut('第3-4段', '1_补1.txt', ['1_改3.mp4', '1-5.mp4']), null);   // 1.txt 那一版没出过
});

test('审片锁不锁（11-18：3-4 镜头1 改3 出了片，别的几条提示词待核对，审片整页锁住看不了）：有样片就能审', () => {
  assert.equal(Core.reviewLock(5, 7, 'you'), '');   // 提示词待核对：不挡已经出好的样片
  assert.equal(Core.reviewLock(5, 7, 'ai'), '');    // AI 在写提示词：也不挡
  assert.equal(Core.reviewLock(5, 7, 'ok'), '');
  assert.equal(Core.reviewLock(5, 0, 'ok'), '');    // 没样片、提示词都好了：照旧进得去（页面说「还没有样片」）
  assert.equal(Core.reviewLock(5, 0, 'you'), 'stale');   // 没样片：照旧先回提示词那一步
  assert.equal(Core.reviewLock(5, 0, 'ai'), 'ai');
  assert.equal(Core.reviewLock(0, 3, 'you'), 'none');    // 还没有提示词：锁
});

test('剧本可以没有段头（11-16 晚：直接从正文写）：没写场景、人物不算毛病；写回去再读出来，正文、备注照旧', async () => {
  const doc = Core.newScriptDoc('1-1', '吃白食');
  doc.sections[1].blocks = [{ id: 'b0', text: '△ 老李端上一碗面。' }, { id: 'b1', text: '老李（小声）：吃吧。' }];
  doc.sections[2].blocks = [{ id: 'n0', text: '11-16 自己写' }];
  assert.deepEqual(Core.lintScript(doc).filter(x => x.level === 'warn').map(x => x.msg), []);
  const back = Core.parseScripts(Core.scriptToParas(doc).map(p => ({ text: p.r.map(r => r[0]).join(''), style: p.s })), '1-1').segs[0];
  assert.equal(back.name, '吃白食');
  assert.deepEqual(back.sections[0].blocks.map(b => b.text), []);
  assert.deepEqual(back.sections[1].blocks.map(b => b.text), ['△ 老李端上一碗面。', '老李（小声）：吃吧。']);
  assert.deepEqual(back.sections[2].blocks.map(b => b.text), ['11-16 自己写']);
  const head = Core.newScriptDoc('1-1', '');
  head.sections[0].blocks = [{ id: 'h0', text: '场景：夜' }];
  head.sections[1].blocks = [{ id: 'b0', text: '△ 门开了。' }];
  assert.deepEqual(Core.lintScript(head).map(x => x.msg), ['场景按「时间｜内/外｜地点」三项写']);   // 写了场景还照旧查
});

test('镜头里的他、她要报，台词旁白 {} 里的不报（11-17：旁白「{他发现天地间…}」被误报）', () => {
  const text = ['【事件脚本】', '镜头1：洪七公推出一掌；旁白：{他发现天地间，藏有至宝，}', '镜头2：童大圣捧着食方，他低头看。'].join('\r\n');
  const doc = Core.parsePrompt(text);
  assert.equal(doc.fmt, 'pe');
  const hits = Core.lintPrompt(doc, '1-7.txt').filter(x => x.msg.includes('称谓指人'));
  assert.equal(hits.length, 1);
  assert.ok(hits[0].loc && JSON.stringify(hits[0].loc).length);
});
