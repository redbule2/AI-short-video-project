'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse, serialize, shotText, withShotText } = require('./公用/写稿状态.js');

const fixture = '\uFEFF说明  \r\n\r\n本段事件：  夜里来人  \r\n\r\n素材\r\n  @图片1 是场景。  \r\n\r\n基础设定\r\n风格:  写实  \r\n\r\n本段\r\n人物：  两个人  \r\n\r\n分镜\r\n说明文字\r\n\r\n  镜头 01 | 开门  \r\n  门开了。  \r\n\r\n\r\n镜头 02｜回头\r\n屋里人回头。\r\n\r\n保持一致：  光线一致';

test('未修改稿件保留 BOM、CRLF、空格、空行与无末尾换行', () => {
  assert.equal(serialize(parse(fixture)), fixture);
});
test('JSON 持久化与对象展开不破坏原始片段', () => {
  const doc = JSON.parse(JSON.stringify(parse(fixture)));
  doc.shots = doc.shots.map(shot => ({ ...shot, purpose: '自定作用', id: 'id-' + shot.no, keywords: {} }));
  assert.equal(serialize({ ...doc }), fixture);
});
test('编辑作用和镜头身份不改变生成提示词', () => {
  const doc = parse(fixture);
  doc.shots[0].purpose = '换成别的作用'; doc.shots[0].id = 'new-id'; doc.shots[0].sourceNo = '1';
  assert.equal(serialize(doc), fixture);
});
test('仅修改镜头正文保留全部其他原文', () => {
  const doc = parse(fixture); doc.shots[0].lines[0] = '门没有开。';
  assert.equal(serialize(doc), fixture.replace('  门开了。  ', '  门没有开。  '));
});
test('仅修改镜头标题保留原分隔符与其他原文', () => {
  const doc = parse(fixture); doc.shots[0].title = '敲门';
  assert.equal(serialize(doc), fixture.replace('  镜头 01 | 开门  ', '  镜头 01 | 敲门  '));
});
test('编辑一个区块保留其他区块，标签空格不误判改动', () => {
  const doc = parse(fixture);
  assert.deepEqual(doc.basic, ['风格：写实']);
  assert.equal(serialize(doc), fixture);
  doc.basic[0] = '风格：黑白';
  assert.equal(serialize(doc), fixture.replace('风格:  写实  ', '风格：黑白  '));
});
test('修改本段事件保留后续区块原文', () => {
  const doc = parse(fixture); doc.event = '白天来人';
  assert.equal(serialize(doc), fixture.replace('本段事件：  夜里来人  ', '本段事件：  白天来人  '));
});
test('调换顺序并重新编号，原文随镜头移动', () => {
  const doc = parse(fixture);
  doc.shots.reverse(); doc.shots.forEach((s, i) => s.no = String(i + 1).padStart(2, '0'));
  const out = serialize(doc), next = parse(out);
  assert.deepEqual(next.shots.map(s => [s.no, s.title, s.lines[0]]), [['01', '回头', '屋里人回头。'], ['02', '开门', '门开了。']]);
  assert.equal(out.slice(0, out.indexOf('分镜')), fixture.slice(0, fixture.indexOf('分镜')));
  assert.ok(out.includes('  镜头 02 | 开门  \r\n  门开了。  \r\n\r\n\r\n'));
  assert.ok(out.endsWith('保持一致：  光线一致'));
});
test('删除一镜保留另一镜原文与分镜前言', () => {
  const doc = parse(fixture); doc.shots.shift();
  const out = serialize(doc);
  assert.ok(out.includes('分镜\r\n说明文字\r\n\r\n镜头 02｜回头\r\n屋里人回头。\r\n\r\n'));
  assert.ok(!out.includes('门开了。'));
  assert.ok(out.endsWith('保持一致：  光线一致'));
});
test('新增空白镜头可以重新解析', () => {
  const doc = parse(fixture); doc.shots.push({ no: '03', title: '', lines: [] });
  const next = parse(serialize(doc));
  assert.equal(next.shots.length, 3); assert.equal(next.shots[2].no, '03');
  assert.deepEqual(next.shots[2].lines, []);
});
test('插入行保留匹配行原有空格', () => {
  const doc = parse(fixture); doc.shots[0].lines.push('门外无人。');
  const out = serialize(doc);
  assert.ok(out.includes('  门开了。  \r\n门外无人。\r\n\r\n\r\n'));
});
test('没有末尾换行的镜头挪到前面不会与下一镜粘连', () => {
  const doc = parse('分镜\n镜头 01｜一\n正文一\n镜头 02｜二\n正文二');
  doc.shots.reverse();
  assert.equal(parse(serialize(doc)).shots.length, 2);
});
test('只有 CR 的稿也能原样保存并编辑', () => {
  const text = '分镜\r镜头１：标题\r内容\r', doc = parse(text);
  assert.equal(serialize(doc), text); doc.shots[0].lines[0] = '改内容';
  assert.equal(serialize(doc), text.replace('内容', '改内容'));
});
test('空文本不自动加模板，新增结构化内容才写相应区块', () => {
  const doc = parse(''); assert.equal(serialize(doc), '');
  doc.shots.push({ no: '01', title: '开始', lines: ['画面'] });
  assert.equal(parse(serialize(doc)).shots[0].lines[0], '画面');
});
test('重复区块未改时原样保留，其他字段可独立编辑', () => {
  const text = '素材\n甲\n\n素材\n乙\n\n分镜\n镜头 01｜开始\n正文\n';
  const doc = parse(text); assert.equal(serialize(doc), text);
  doc.shots[0].title = '继续'; assert.equal(serialize(doc), text.replace('开始', '继续'));
});
test('拒绝非字符串，避免悄悄将错误输入存成空稿', () => {
  assert.throws(() => parse(null), TypeError); assert.throws(() => serialize(null), TypeError);
});
test('JavaScript 属性名也是普通正文', () => {
  const text = 'constructor\n素材\ntoString\n分镜\n镜头 01｜正文\n__proto__\n';
  assert.equal(serialize(parse(text)), text);
});

const originalShots = '说明文字\r\n\r\n  镜头 01 | 开门  \r\n  门开了。  \r\n\r\n\r\n镜头 02｜回头\r\n屋里人回头。\r\n\r\n';
test('只提取分镜正文，保留空行空格而不带分镜标题和公共区', () => {
  assert.equal(shotText(parse(fixture)), originalShots);
});
test('把原分镜正文放回去完全不改变全稿', () => {
  const doc = parse(fixture);
  assert.equal(withShotText(doc, shotText(doc)), fixture);
});
test('只替换分镜正文，公共区及其格式逐字保留', () => {
  const raw = '\r\n我自己的分镜写法。\r\n\r\n';
  assert.equal(withShotText(parse(fixture), raw), fixture.replace(originalShots, raw));
});
test('自由分镜里的公共区标题及镜头样式文字都作为普通正文保留', () => {
  const raw = '素材\n我在正文里讨论素材。\n保持一致：这一句仍是正文\n分镜\n镜头 99｜自由文字\n本段\n基础设定\n';
  assert.equal(withShotText(parse(fixture), raw), fixture.replace(originalShots, raw));
});
test('修改公共字段时自由分镜原样保留，其他公共区原样保留', () => {
  const doc = parse(fixture); doc.event = '事件改了'; doc.basic[0] = '风格：黑白'; doc.keep = '保持新的光线';
  const raw = '自由分镜只在这里\r\n';
  const expected = fixture.replace(originalShots, raw).replace('夜里来人', '事件改了')
    .replace('风格:  写实  ', '风格：黑白  ').replace('光线一致', '保持新的光线');
  assert.equal(withShotText(doc, raw), expected);
});
test('修改后的结构化镜头可以提取为自由文本', () => {
  const doc = parse(fixture); doc.shots[0].title = '新标题';
  assert.equal(shotText(doc), originalShots.replace('开门', '新标题'));
});
test('空分镜和无镜头编号的自由文字可独立保存', () => {
  const text = '本段事件：旧事\n分镜\n\n保持一致：旧约定\n';
  assert.equal(shotText(parse(text)), '\n');
  assert.equal(withShotText(parse(text), ''), '本段事件：旧事\n分镜\n保持一致：旧约定\n');
  assert.equal(withShotText(parse(text), '只有一段，不写编号。\n'), text.replace('分镜\n\n', '分镜\n只有一段，不写编号。\n'));
});
test('原稿没有分镜区时在公共区之间插入，公共文字不变', () => {
  const text = '本段事件：事件\n\n素材\n原素材\n保持一致：同一人';
  const doc = parse(text); assert.equal(shotText(doc), '');
  assert.equal(withShotText(doc, '新分镜'), '本段事件：事件\n\n素材\n原素材\n分镜\n新分镜\n保持一致：同一人');
});
test('自由正文末尾无换行时只补公共区边界所需换行', () => {
  assert.equal(withShotText(parse(fixture), '尾部没换行'), fixture.replace(originalShots, '尾部没换行\r\n'));
  assert.equal(withShotText(parse('素材\n原素材\n分镜\n旧分镜'), '尾部没换行'), '素材\n原素材\n分镜\n尾部没换行');
});
test('末尾只有分镜标题没有换行也能接入自由正文', () => {
  const doc = parse('本段事件：事件\n分镜');
  assert.equal(shotText(doc), '');
  assert.equal(withShotText(doc, '正文'), '本段事件：事件\n分镜\n正文');
});
test('替换自由分镜不改变传入文档及备用结构化镜头', () => {
  const doc = parse(fixture), before = JSON.stringify(doc);
  withShotText(doc, '另一个版本');
  assert.equal(JSON.stringify(doc), before); assert.equal(serialize(doc), fixture);
});
test('自由分镜拒绝非字符串，避免误清空正文', () => {
  assert.throws(() => withShotText(parse(fixture), null), TypeError);
});
