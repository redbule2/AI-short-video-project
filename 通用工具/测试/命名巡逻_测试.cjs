'use strict';
/* .agents/skills/annotate-live/naming-patrol.js：本机服务的巡逻——扫出新出的不合规的、照规矩改名（有地方写着它、有同名的不改）、不用改、门卫掉了再装 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = fs.mkdtempSync(path.join(os.tmpdir(), '命名巡逻测试-')), root = path.join(base, '总');
process.env.ANTOU_NAMING_OLD = path.join(base, '老文件.json');
process.env.ANTOU_CLAUDE_SETTINGS = path.join(base, 'claude', 'settings.json');
process.env.ANTOU_CODEX_HOOKS = path.join(base, 'codex', 'hooks.json');
const P = require('../../.agents/skills/annotate-live/naming-patrol.js');

const pj = (...p) => path.join(root, '项目', '童晓晓', ...p);
const put = (p, body = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body); };
for (const d of ['.agents', '通用工具', '项目/童晓晓/提示词/第1段', '项目/童晓晓/资产/人物和道具', '项目/童晓晓/成片/第1段', '项目/童晓晓/历史记录']) fs.mkdirSync(path.join(root, ...d.split('/')), { recursive: true });
put(path.join(root, 'AGENTS.md'));
put(pj('资产', '人物和道具', '老的_v1.png'));   // 头一回开以前就在：记成老文件

const patrol = P({ ROOT: root, TOOLS: path.join(__dirname, '..'), log: () => {}, withLocks: (paths, fn) => fn(), noWatch: true });
async function call(method, body, q = '') {
  const res = {};
  await patrol.handle({ method }, res, new URL('http://x/api/naming' + q), { json: (r, obj) => { r.out = obj; }, readBody: async () => Buffer.from(body ? JSON.stringify(body) : '') });
  return res.out;
}
const rels = d => (d.问题 || []).map(x => x.rel);
test.after(() => fs.rmSync(base, { recursive: true, force: true }));

test('头一回开：现有不合规的记成老文件，只报以后新出的', async () => {
  assert.deepEqual(rels(await call('GET', null, '?fresh')), []);
  assert.ok(JSON.parse(fs.readFileSync(process.env.ANTOU_NAMING_OLD, 'utf8')).老文件.includes('项目/童晓晓/资产/人物和道具/老的_v1.png'));
  put(pj('资产', '人物和道具', '小狗_v2.png'));
  const d = await call('GET', null, '?fresh');
  assert.deepEqual(d.问题, [{ rel: '项目/童晓晓/资产/人物和道具/小狗_v2.png', dir: false, why: '名字带版本号', fix: '小狗.png' }]);
});

test('照规矩改名：只许改成规矩给的名字', async () => {
  await assert.rejects(call('POST', { rel: '项目/童晓晓/资产/人物和道具/小狗_v2.png', 改成: '小狗狗.png' }), e => e.status === 400);
  const d = await call('POST', { rel: '项目/童晓晓/资产/人物和道具/小狗_v2.png', 改成: '小狗.png' });
  assert.deepEqual(rels(d), []);
  assert.ok(fs.existsSync(pj('资产', '人物和道具', '小狗.png')));
  assert.ok(!fs.existsSync(pj('资产', '人物和道具', '小狗_v2.png')));
});

test('有地方写着它、那里已有同名的：不改，说出在哪', async () => {
  put(pj('资产', '人物和道具', '猫_v2.png'));
  put(pj('资产', '参考素材映射.json'), JSON.stringify({ 图片1: '资产/人物和道具/猫_v2.png' }));
  put(pj('历史记录', '提示词', '第1段', '旧稿__20261120-150604.txt'), '鸟_v2.png');   // 历史记录里写着的不算
  put(pj('资产', '人物和道具', '鸟_v2.png'));
  put(pj('资产', '人物和道具', '鸟.png'));
  await call('GET', null, '?fresh');
  await assert.rejects(call('POST', { rel: '项目/童晓晓/资产/人物和道具/猫_v2.png', 改成: '猫.png' }), e => e.status === 409 && /有地方写着它.*项目\/童晓晓\/资产\/参考素材映射\.json/.test(e.message));
  await assert.rejects(call('POST', { rel: '项目/童晓晓/资产/人物和道具/鸟_v2.png', 改成: '鸟.png' }), e => e.status === 409 && /已经有「鸟\.png」/.test(e.message));
  assert.ok(fs.existsSync(pj('资产', '人物和道具', '猫_v2.png')) && fs.existsSync(pj('资产', '人物和道具', '鸟_v2.png')));
  assert.deepEqual(patrol.findRefs('项目/童晓晓/资产/人物和道具/鸟_v2.png'), []);
});

test('不用改：记进老文件名单，不再提；路径不对的不认', async () => {
  const d = await call('POST', { rel: '项目/童晓晓/资产/人物和道具/猫_v2.png', 不用改: true });
  assert.deepEqual(rels(d), ['项目/童晓晓/资产/人物和道具/鸟_v2.png']);
  assert.ok(JSON.parse(fs.readFileSync(process.env.ANTOU_NAMING_OLD, 'utf8')).老文件.includes('项目/童晓晓/资产/人物和道具/猫_v2.png'));
  await assert.rejects(call('POST', { rel: '项目/../x', 不用改: true }), e => e.status === 400);
  await assert.rejects(call('POST', { rel: '项目/童晓晓/资产/人物和道具/没有这个.png', 不用改: true }), e => e.status === 409);
});

test('门卫掉了：看得出，点了再装上；这台电脑没有的 AI 不算掉', async () => {
  assert.deepEqual((await call('GET')).门卫, { claude: null, codex: null });
  fs.mkdirSync(path.dirname(process.env.ANTOU_CLAUDE_SETTINGS), { recursive: true });
  fs.mkdirSync(path.dirname(process.env.ANTOU_CODEX_HOOKS), { recursive: true });
  assert.deepEqual((await call('GET')).门卫, { claude: false, codex: false });
  assert.deepEqual((await call('POST', { 装门卫: true })).门卫, { claude: true, codex: true });
  assert.ok(fs.existsSync(process.env.ANTOU_CLAUDE_SETTINGS) && fs.existsSync(process.env.ANTOU_CODEX_HOOKS));
});
