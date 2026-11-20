'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { parse, serialize, shotText, withShotText, isHand } = require('../公用/写稿状态.js');

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

/* ---------- sd2.5PE 格式（2026-11-13 起新写的稿） ---------- */
const { skeleton } = require('../公用/写稿状态.js');
const PEBOM = String.fromCharCode(0xFEFF);
const pe = PEBOM + '【生成目标】  \r\n生成咖啡师递咖啡的视频。  \r\n\r\n【参考素材职责】\r\n@图片1用于咖啡师的五官。  \r\n【未采用素材】\r\n@图片2未参与本任务。\r\n\r\n【主体与关系】\r\n咖啡师：  站在吧台内侧。\r\n\r\n【事件脚本】\r\n镜头1：  咖啡师注水。  \r\n镜头2：咖啡师递杯。\r\n最终画面采用写实质感，声音包括注水声。\r\n\r\n【保持一致】\r\n保持杯子只有一个。';
test('PE 稿认得出格式和各区内容', () => {
  const d = parse(pe);
  assert.equal(d.fmt, 'pe');
  assert.equal(d.event, '生成咖啡师递咖啡的视频。');
  assert.deepEqual(d.refs, ['【参考素材职责】', '@图片1用于咖啡师的五官。', '【未采用素材】', '@图片2未参与本任务。']);
  assert.deepEqual(d.seg, ['咖啡师：站在吧台内侧。']);
  assert.deepEqual(d.shots.map(s => [s.no, s.title, s.lines]), [['1', '', ['咖啡师注水。']], ['2', '', ['咖啡师递杯。']]]);
  assert.deepEqual(d.basic, ['最终画面采用写实质感，声音包括注水声。']);
  assert.equal(d.keep, '保持杯子只有一个。');
});
test('PE 稿没改原样写回，改镜头标题、作用也不动文件', () => {
  assert.equal(serialize(parse(pe)), pe);
  const d = parse(pe); d.shots[0].title = '注水'; d.shots[0].purpose = '交代手法';
  assert.equal(serialize(d), pe);
});
test('PE 稿改一镜只动这一行', () => {
  const d = parse(pe); d.shots[1].lines = ['咖啡师双手递杯。'];
  assert.equal(serialize(d), pe.replace('镜头2：咖啡师递杯。', '镜头2：咖啡师双手递杯。'));
});
test('PE 稿调换镜头重新编号，最终画面那一行留在最后', () => {
  const d = parse(pe); d.shots.reverse(); d.shots.forEach((s, i) => { s.no = String(i + 1); });
  const out = serialize(d), next = parse(out);
  assert.deepEqual(next.shots.map(s => [s.no, s.lines[0]]), [['1', '咖啡师递杯。'], ['2', '咖啡师注水。']]);
  assert.ok(out.includes('镜头1：咖啡师递杯。\r\n镜头2：  咖啡师注水。  \r\n最终画面采用'));
  assert.deepEqual(next.basic, d.basic);
});
test('PE 稿加一镜接在最后一镜后面', () => {
  const d = parse(pe); d.shots.push({ no: '3', title: '', lines: ['顾客接过。'] });
  const out = serialize(d);
  assert.ok(out.includes('镜头2：咖啡师递杯。\r\n镜头3：顾客接过。\r\n最终画面采用'));
  assert.equal(parse(out).shots.length, 3);
});
test('PE 稿改生成目标、保持一致只动正文', () => {
  const d = parse(pe); d.event = '生成咖啡师做手冲的视频。'; d.keep = '保持咖啡师和杯子不变。';
  assert.equal(serialize(d), pe.replace('生成咖啡师递咖啡的视频。', '生成咖啡师做手冲的视频。').replace('保持杯子只有一个。', '保持咖啡师和杯子不变。'));
});
test('PE 稿 AI 写的段清空了，连段名一起去掉', () => {
  const d = parse(pe); d.seg = [];
  const out = serialize(d);
  assert.ok(!out.includes('【主体与关系】') && out.includes('【未采用素材】\r\n@图片2未参与本任务。\r\n\r\n【事件脚本】'));
});
test('空骨架加上 AI 写的几段，段序和空行都对', () => {
  const d = parse(skeleton('\n'));
  assert.equal(d.fmt, 'pe');
  d.event = '生成一段视频。'; d.refs = ['@图片1用于小磊的五官。']; d.seg = ['小磊坐在门边。'];
  d.shots = [{ no: '1', title: '', lines: ['小磊抬头。'] }]; d.basic = ['最终画面采用冷灰写实，声音包括街声。']; d.keep = '保持小磊的校服。';
  const out = serialize(d);
  assert.equal(out, '【生成目标】\n生成一段视频。\n\n【参考素材职责】\n@图片1用于小磊的五官。\n\n【主体与关系】\n小磊坐在门边。\n\n【事件脚本】\n镜头1：小磊抬头。\n最终画面采用冷灰写实，声音包括街声。\n\n【保持一致】\n保持小磊的校服。');
  const back = parse(out);
  assert.deepEqual([back.event, back.refs, back.seg, back.shots[0].lines, back.basic, back.keep],
    ['生成一段视频。', ['【参考素材职责】', '@图片1用于小磊的五官。'], ['小磊坐在门边。'], ['小磊抬头。'], ['最终画面采用冷灰写实，声音包括街声。'], '保持小磊的校服。']);
});
test('写法二的分组段名都归素材，前后不乱', () => {
  const text = '【生成目标】\n甲给乙一本书。\n\n【人物】\n甲对应@图片1。\n【道具】\n书对应@图片2，只属于甲。\n【场景】\n书房参考@图片3。\n【动作与声音】\n@音频1用于乙的音色。\n【未采用素材】\n@图片4未参与本任务。\n\n【事件脚本】\n镜头1：甲递书。\n\n【保持一致】\n保持书只有一本。\n';
  const d = parse(text);
  assert.equal(d.refs.length, 10); assert.equal(d.refs[0], '【人物】'); assert.equal(d.refs[8], '【未采用素材】');
  assert.equal(serialize(d), text);
  d.refs.splice(4, 0, '桌子对应@图片5。');
  assert.ok(serialize(d).includes('【道具】\n书对应@图片2，只属于甲。\n桌子对应@图片5。\n【场景】'));
});
test('写法二新补的分组名前面空一行，旧稿素材不加空行', () => {
  const NL = String.fromCharCode(10), j = (...a) => a.join(NL);
  const text = j('【生成目标】', '甲给乙一本书。', '', '【人物】', '甲对应@图片1。', '', '【场景】', '书房参考@图片3。', '', '【事件脚本】', '镜头1：甲递书。', '');
  const d = parse(text);
  d.refs.splice(2, 0, '【道具】', '书对应@图片2。');
  assert.equal(serialize(d), text.replace(j('甲对应@图片1。', '', '【场景】'), j('甲对应@图片1。', '', '【道具】', '书对应@图片2。', '', '【场景】')));
  const old = j('本段事件：来人', '', '素材', '@图片1是门。', '', '分镜', '镜头 01｜开门', '门开了。', '');
  const o = parse(old);
  o.refs.push('【未采用素材】');
  assert.ok(serialize(o).includes(j('@图片1是门。', '【未采用素材】', '')));
});
test('PE 稿自由写分镜：只换事件脚本里的镜头，最终画面和保持一致不动', () => {
  const d = parse(pe);
  assert.equal(shotText(d), '镜头1：  咖啡师注水。  \r\n镜头2：咖啡师递杯。\r\n');
  const out = withShotText(d, '【阶段一】\r\n开始时：杯子在吧台上。\r\n');
  assert.equal(out, pe.replace('镜头1：  咖啡师注水。  \r\n镜头2：咖啡师递杯。\r\n', '【阶段一】\r\n开始时：杯子在吧台上。\r\n'));
});
test('旧稿素材里写了【参考素材职责】【未采用素材】，照旧按旧稿读', () => {
  const text = '本段事件：来人\n\n素材\n【参考素材职责】\n@图片1是门。\n【未采用素材】\n@图片2不用。\n\n分镜\n镜头 01｜开门\n门开了。\n\n保持一致：门不变';
  const d = parse(text);
  assert.equal(d.fmt, 'merged'); assert.equal(d.refs.length, 4); assert.equal(d.shots[0].title, '开门');
  assert.equal(serialize(d), text);
});

/* ---------- 2026-11-14：风格写成【基础设定】放在事件脚本前面，「声音包括……」仍跟在镜头后面 ---------- */
const peNew = '【生成目标】\r\n生成咖啡师递咖啡的视频。\r\n\r\n【参考素材职责】\r\n@图片1用于咖啡师的五官。\r\n\r\n【基础设定】\r\n影像风格：王家卫电影风格，粗颗粒。\r\n摄影：广角贴脸。\r\n光色基调：墨绿昏黄；深夜，灯泡是主光。\r\n\r\n【主体与关系】\r\n咖啡师站在吧台内侧。\r\n\r\n【事件脚本】\r\n镜头1：咖啡师注水。\r\n镜头2：咖啡师递杯。\r\n声音包括注水声，(萨克斯)。\r\n\r\n【保持一致】\r\n保持杯子只有一个。';
test('【基础设定】读成基础设定，事件脚本最后的「声音包括」也算进来；没改原样写回', () => {
  const d = parse(peNew);
  assert.equal(d.fmt, 'pe');
  assert.deepEqual(d.basic, ['影像风格：王家卫电影风格，粗颗粒。', '摄影：广角贴脸。', '光色基调：墨绿昏黄；深夜，灯泡是主光。', '声音包括注水声，(萨克斯)。']);
  assert.deepEqual(d.seg, ['咖啡师站在吧台内侧。']);
  assert.deepEqual(d.shots.map(s => s.lines), [['咖啡师注水。'], ['咖啡师递杯。']]);
  assert.equal(serialize(d), peNew);
  assert.equal(parse('【基础设定】\n影像风格：写实。\n').fmt, 'pe');
});
test('改基础设定的一行、改声音那一行，都只动这一行', () => {
  const d = parse(peNew); d.basic[1] = '摄影：长焦隔着玻璃。';
  assert.equal(serialize(d), peNew.replace('摄影：广角贴脸。', '摄影：长焦隔着玻璃。'));
  const e = parse(peNew); e.basic[3] = '声音包括注水声。';
  assert.equal(serialize(e), peNew.replace('声音包括注水声，(萨克斯)。', '声音包括注水声。'));
});
test('老稿改了风格：写成【基础设定】放到主体与关系前面，「最终画面」那行换成声音那行', () => {
  const d = parse(pe);
  d.basic = ['影像风格：写实。', '摄影：中景。', '光色基调：暖黄；清晨，窗光。', '声音包括注水声。'];
  const out = serialize(d);
  assert.equal(out, pe.replace('【主体与关系】', '【基础设定】\r\n影像风格：写实。\r\n摄影：中景。\r\n光色基调：暖黄；清晨，窗光。\r\n\r\n【主体与关系】')
    .replace('最终画面采用写实质感，声音包括注水声。', '声音包括注水声。'));
  assert.deepEqual(parse(out).basic, d.basic);
});
test('老稿删掉最后那一行，镜头和【保持一致】之间还空一行', () => {
  const d = parse(pe); d.basic = [];
  assert.equal(serialize(d), pe.replace('最终画面采用写实质感，声音包括注水声。\r\n', ''));
});
test('空骨架加上基础设定：段在素材后面、主体与关系前面，声音那行紧跟最后一镜', () => {
  const d = parse(skeleton('\n'));
  d.event = '生成一段视频。'; d.refs = ['@图片1用于小磊的五官。']; d.seg = ['小磊坐在门边。'];
  d.shots = [{ no: '1', title: '', lines: ['小磊抬头。'] }];
  d.basic = ['影像风格：冷灰写实。', '摄影：手持。', '光色基调：冷灰；傍晚，路灯是主光。', '声音包括街声。']; d.keep = '保持小磊的校服。';
  const out = serialize(d);
  assert.equal(out, '【生成目标】\n生成一段视频。\n\n【参考素材职责】\n@图片1用于小磊的五官。\n\n【基础设定】\n影像风格：冷灰写实。\n摄影：手持。\n光色基调：冷灰；傍晚，路灯是主光。\n\n【主体与关系】\n小磊坐在门边。\n\n【事件脚本】\n镜头1：小磊抬头。\n声音包括街声。\n\n【保持一致】\n保持小磊的校服。');
  assert.deepEqual(parse(out).basic, d.basic);
});
test('「声音包括」写在【基础设定】里：没改不动；改了风格，声音那行挪到最后一镜后面', () => {
  const text = '【生成目标】\n甲递书。\n\n【基础设定】\n影像风格：写实。\n摄影：中景。\n声音包括翻书声。\n\n【事件脚本】\n镜头1：甲递书。\n\n【保持一致】\n保持书只有一本。\n';
  const d = parse(text);
  assert.deepEqual(d.basic, ['影像风格：写实。', '摄影：中景。', '声音包括翻书声。']);
  d.shots[0].lines = ['甲把书递给乙。'];
  assert.equal(serialize(d), text.replace('镜头1：甲递书。', '镜头1：甲把书递给乙。'));
  const e = parse(text); e.basic[1] = '摄影：近景。';
  assert.equal(serialize(e), '【生成目标】\n甲递书。\n\n【基础设定】\n影像风格：写实。\n摄影：近景。\n\n【事件脚本】\n镜头1：甲递书。\n声音包括翻书声。\n\n【保持一致】\n保持书只有一本。\n');
});

test('你来写的稿（11-19）：写稿资料记「手写」、老稿记「流水线」才算；AI 写的稿改过的、坏的写稿资料不算', () => {
  assert.equal(isHand({ 手写: true, 写法: '分镜' }), true);
  assert.equal(isHand({ 流水线: '这一份是从「流水线」开的稿' }), true);
  for (const side of [{ 写法: '自由', 分镜稿: '' }, { 手写: 'true' }, null, undefined, '手写', []]) assert.equal(isHand(side), false);
});
