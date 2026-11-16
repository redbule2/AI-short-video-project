'use strict';
/* 核心.js 里各页共用的几样：认「标签：内容」、读 DOCX、读文字。写稿页、写稿状态.js 都改用这一份（2026-11-15） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const Core = require('./公用/核心.js');
const PromptDraft = require('./公用/写稿状态.js');

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

test('视频提示词的名字：第几条、改几、样片名里写的、下一条', () => {
  const t = n => [Core.RE_VP.test(n), Core.vpNo(n), Core.vpVer(n), Core.vpLabel(n), Core.vpTok(n)];
  assert.deepEqual(t('视频提示词.txt'), [true, 1, 0, '第1条', '提示词01']);
  assert.deepEqual(t('视频提示词_02_改3.txt'), [true, 2, 3, '第2条 改3', '提示词02改3']);
  assert.deepEqual(t('镜头1-3_视频提示词.TXT'), [true, 0, 0, '镜头1-3', '镜头1-3']);   // 老稿；后缀大写也认
  assert.deepEqual(t('甲_乙_视频提示词_改1.txt'), [true, 0, 1, '甲 乙 改1', '甲_乙改1']);
  assert.equal(Core.RE_VP.test('出片任务.txt'), false);
  assert.equal(Core.vpBase('视频提示词_02_改3.txt'), '视频提示词_02.txt');
  assert.equal(Core.vpNext([]), '视频提示词.txt');
  assert.equal(Core.vpNext(['视频提示词.txt', '视频提示词_02_改1.txt', '老_视频提示词.txt']), '视频提示词_03.txt');
});
