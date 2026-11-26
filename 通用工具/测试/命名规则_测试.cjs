'use strict';
/* 公用/命名规则.js：项目文件夹里的名字和位置合不合 AGENTS.md（门卫、巡逻共用这一份） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const N = require('../公用/命名规则.js');

const STEMS = { '童晓晓/第3-4段': ['15-16_改2', '1-5_改1', '1-5', '1'] };
const ctx = { stems: (p, s) => STEMS[p + '/' + s] || [] };
const at = (rel, dir = false) => N.check(rel.split('/'), dir, ctx);
const ok = (rel, dir) => assert.equal(at(rel, dir), null, rel + ' 应该合规矩');
const bad = (rel, dir, fix) => { const w = at(rel, dir); assert.ok(w, rel + ' 应该不合规矩'); if (fix !== undefined) assert.equal(w.fix, fix, rel + ' 的改法'); return w; };

test('一级目录只许五样，一级目录的 .claude 也不行', () => {
  for (const n of ['.agents', '.git', 'AGENTS.md', '.gitignore', '通用工具', '项目']) ok(n, n !== 'AGENTS.md' && n !== '.gitignore');
  bad('新建文件夹', true);
  bad('.claude', true);
  bad('说明.html', false);
  ok('desktop.ini');
  ok('通用工具/流水线/随便叫什么_v2.js');   // 代码不归这里管
});

test('项目 这一层不管；项目文件夹里只许五样', () => {
  ok('项目/工序图.html');
  ok('项目/.codex', true);
  ok('项目/童晓晓/提示词', true);
  ok('项目/童晓晓/.claude', true);
  bad('项目/童晓晓/历史教训', true);
  bad('项目/童晓晓/笔记.md');
  ok('项目/童晓晓/历史记录/历史教训', true);
  bad('项目/童晓晓/历史记录/随便放的', true);
  ok('项目/童晓晓/历史记录/资产/人物和道具/童爸爸_v2__20261120-150604.png');   // 历史记录里面不查
});

test('资产：三个文件夹，记录文件放本层', () => {
  ok('项目/童晓晓/资产/参考素材映射.json');
  ok('项目/童晓晓/资产/第1-1段_出片记录.json');   // 不在段落文件夹里的照旧带第几段
  bad('项目/童晓晓/资产/全局资产', true);
  ok('项目/童晓晓/资产/人物和道具/童爸爸_三十出头.png');
  ok('项目/童晓晓/资产/人物和道具/童家面车_骑行状态.png');
  ok('项目/童晓晓/资产/人物和道具/飞碟_第3-1段参考.png');
  bad('项目/童晓晓/资产/人物和道具/外星战士_模型', true);
  ok('项目/童晓晓/资产/人物和道具/__pycache__', true);
  ok('项目/童晓晓/资产/场景/菜市场路.png');
  bad('项目/童晓晓/资产/场景/场景_菜市场路.png', false, '菜市场路.png');
  bad('项目/童晓晓/资产/人物和道具/人物_童爸爸.png', false, '童爸爸.png');
  bad('项目/童晓晓/资产/关键帧/截图.png');
  bad('项目/童晓晓/资产/关键帧/空镜', true);
  ok('项目/童晓晓/资产/关键帧/第3-4段/镜头1_首帧.png');
  ok('项目/童晓晓/资产/关键帧/第3-4段/镜头1_首帧_候选.png');
  ok('项目/童晓晓/资产/关键帧/第3-3段/第3-1段飞碟_截图.png');   // 写别的段是在说来历
  bad('项目/童晓晓/资产/关键帧/第3-4段/第3-4段_镜头1_首帧.png', false, '镜头1_首帧.png');
  ok('项目/童晓晓/资产/关键帧/第3-4段/白模/齐射.blend');
  assert.match(bad('项目/童晓晓/资产/关键帧/第3-4段/白模/齐射.blend1', false, '').why, /Blender/);
  ok('项目/童晓晓/资产/关键帧/第3-4段/0分08.0秒_第1帧.jpg');   // 时间点不是时长
  ok('项目/童晓晓/资产/关键帧/第3-4段/第2.5秒.png');
});

test('名字：版本号、副本、时长、项目名', () => {
  const p = '项目/童晓晓/资产/人物和道具/';
  bad(p + '童爸爸_v2.png', false, '童爸爸.png');
  bad(p + '童爸爸V3.png', false, '童爸爸.png');
  bad(p + '童爸爸_第2版.png', false, '童爸爸.png');
  bad(p + '童爸爸_最终版.png', false, '童爸爸.png');
  bad(p + '童爸爸_final.png', false, '童爸爸.png');
  bad(p + '小狗 - 副本.png', false, '小狗.png');
  bad(p + '小狗 - 副本 (2).png', false, '小狗.png');
  bad(p + '小狗 (1).png', false, '小狗.png');
  bad(p + '小狗_备份.png', false, '小狗.png');
  bad(p + '小狗_bak.png', false, '小狗.png');
  bad(p + '小狗_10秒.mp4', false, '小狗.mp4');
  bad(p + '小狗_5s.mp4', false, '小狗.mp4');
  ok(p + '童爸爸_旧衣服.png');
  ok(p + 'MV2截图.png');
  ok(p + 'gold_coin.png');
  bad('项目/李云龙大战奥特曼/资产/人物和道具/李云龙大战奥特曼_飞碟.png', false, '飞碟.png');
  ok('项目/霍元甲/资产/人物和道具/霍元甲.png');   // 项目名短，常就是人名
  ok('项目/食神/定稿的剧本/食神_原片剧本整理.docx');
  bad(p + 'v2.png', false, '');   // 去完是空的：给不出改法
  ok(p + '~$小狗.docx');
  ok(p + '下载中.part');
});

test('提示词：全局资产和第N段', () => {
  const s = '项目/童晓晓/提示词/';
  ok(s + '第3-4段', true);
  ok(s + '第1至3段', true);
  ok(s + '全局资产', true);
  bad(s + '笔记.txt');
  bad(s + '第三段', true);
  ok(s + '全局资产/全片_光影总基调.txt');
  ok(s + '全局资产/资产出图任务.txt');
  bad(s + '全局资产/音色', true);
  ok(s + '全局资产/人物/童爸爸_三十出头_提示词.txt');
  bad(s + '全局资产/人物/人物_童爸爸_提示词.txt', false, '童爸爸_提示词.txt');
  for (const n of ['1-5_改1.txt', '1-5_出片任务_改1.txt', '1-5_改1_写稿.json', '1-5_改1_批注.md', '自由稿.txt', 'GEO底稿.md', '镜头1_首帧_改图提示词.txt', '视频提示词_02.txt', '1_改6_前半条.txt'])
    ok(s + '第3-4段/' + n);
  bad(s + '第3-4段/1-5_10秒.txt', false, '1-5.txt');
  bad(s + '第3-4段/第3-4段_1-5.txt', false, '1-5.txt');
});

test('成片：一段一个文件夹，样片照提示词起名', () => {
  const c = '项目/童晓晓/成片/';
  bad(c + '随便.mp4');
  bad(c + '样片', true);
  ok(c + '第3-4段', true);
  for (const n of ['1-5_改1.mp4', '1-5_改1_2.mp4', '1-5_改1_批注.md', '15-16_改2_后期补.mp4', '1_改3.mp4', '1-5.mp4', '第3-4段_第20条_1改3_720p.mp4']) ok(c + '第3-4段/' + n);
  ok(c + '第3-4段/1-5_改1_批注截图', true);
  ok(c + '第3-4段/1-5_改1_批注截图/0分08.0秒_第193帧.jpg');
  bad(c + '第3-4段/1-5b.mp4');   // 1-5b 是另一个镜头
  bad(c + '第3-4段/15-17.mp4');
  bad(c + '第3-4段/混剪.mp4');
  bad(c + '第3-4段/第3-4段_1-5_改1.mp4', false, '1-5_改1.mp4');
  bad(c + '第9段/1-5_改1.mp4');   // 第9段没有提示词
});

test('定稿的剧本：照旧带第几段，只查版本号这些', () => {
  ok('项目/童晓晓/定稿的剧本/第1-1段/第1-1段_剧本.docx');
  ok('项目/童晓晓/定稿的剧本/流水线.json');
  bad('项目/童晓晓/定稿的剧本/第1-1段_剧本_最终版.docx', false, '第1-1段_剧本.docx');
});

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '命名规则测试-'));
  const mk = (rel, body) => { const p = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); if (body !== undefined) fs.writeFileSync(p, body); else fs.mkdirSync(p, { recursive: true }); return p; };
  for (const d of ['.agents', '通用工具', '项目/童晓晓/提示词/第1段', '项目/童晓晓/资产/人物和道具', '项目/童晓晓/成片/第1段', '项目/童晓晓/历史记录/提示词/第1段', '项目/童晓晓/定稿的剧本']) mk(d);
  mk('AGENTS.md', 'x');
  mk('项目/童晓晓/提示词/第1段/1-5_改1.txt', 'x');
  mk('项目/童晓晓/历史记录/提示词/第1段/2__20261120-150604.txt', 'x');
  return { root, mk };
}

test('查一个路径：从上往下给最上面那一处；老文件名单上的不算', () => {
  const { root, mk } = tmpRoot();
  try {
    const deep = path.join(root, '项目', '童晓晓', '资产', '人物和道具', '外星战士_模型', 'a_v2.png');
    mk('项目/童晓晓/资产/人物和道具/外星战士_模型/a_v2.png', 'x');
    assert.equal(N.checkPath(deep, { root }).rel, '项目/童晓晓/资产/人物和道具/外星战士_模型');
    assert.equal(N.checkPath(deep, { root, old: new Set(['项目/童晓晓/资产/人物和道具/外星战士_模型']) }), null);
    assert.equal(N.checkPath(path.join(os.tmpdir(), '别处.png'), { root }), null);
    assert.equal(N.checkPath(path.join(root, '项目', '童晓晓', '成片', '第1段', '1-5_改1_2.mp4'), { root, dir: false }), null);   // 还没有的文件也能查
    assert.equal(N.checkPath(path.join(root, '项目', '童晓晓', '成片', '第1段', '2_2.mp4'), { root, dir: false }), null);     // 提示词进了历史记录，样片照认
    assert.ok(N.checkPath(path.join(root, '项目', '童晓晓', '成片', '第1段', '3.mp4'), { root, dir: false }));
    assert.equal(N.checkPath(path.join(root, '.claude', 'x.json'), { root, dir: false }).rel, '.claude');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('整个扫一遍、老文件名单存取', () => {
  const { root, mk } = tmpRoot();
  try {
    mk('项目/童晓晓/资产/人物和道具/小狗_v2.png', 'x');
    mk('项目/童晓晓/资产/人物和道具/外星战士_模型/里面_v3.png', 'x');
    mk('项目/童晓晓/历史教训/经验.md', 'x');
    mk('项目/童晓晓/成片/第1段/1-5_改1.mp4', 'x');
    mk('项目/童晓晓/历史记录/资产/随便_v9.png', 'x');   // 历史记录里面不查
    mk('新建文件夹');
    const rels = N.scan({ root }).map(x => x.rel).sort();
    assert.deepEqual(rels, ['新建文件夹', '项目/童晓晓/历史教训', '项目/童晓晓/资产/人物和道具/外星战士_模型', '项目/童晓晓/资产/人物和道具/小狗_v2.png'].sort());
    assert.deepEqual(N.scan({ root, since: Date.now() + 60e3 }), []);   // 只要以后的：没有
    const file = path.join(root + '-老文件', '老文件.json');
    assert.equal(N.loadOld(file), null);
    N.saveOld(new Set(rels.slice(0, 2)), file, root);
    const old = N.loadOld(file);
    assert.deepEqual([...old].sort(), rels.slice(0, 2).sort());
    assert.equal(N.scan({ root, old }).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(root + '-老文件', { recursive: true, force: true }); }
});
