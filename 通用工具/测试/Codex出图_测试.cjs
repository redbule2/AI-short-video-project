'use strict';
// node 通用工具/测试/Codex出图_测试.cjs
// 11-23 他定：出图一样开一个 Codex 新对话，话自动发进去，人在里面聊，说「定稿」就换上（.agents/skills/annotate-live/codex-draw.js）。
// 这里试：Codex 的回复怎么认、换图和收图、出图提示词跟着改、发话一次一个、发不出去改成给我提示词、报没发出其实发出去了、发进去的话的样子。
// 文件都写在系统临时文件夹里，不碰真项目，不调 Codex。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const DIR = path.resolve(__dirname, '../../.agents/skills/annotate-live');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'codex出图测试-'));
const HOME = path.join(TMP, '项目'), SESS = path.join(TMP, 'sessions'), TOOLS = path.join(TMP, '通用工具');
process.env.ANTOU_CODEX_SESSIONS = SESS;
const two = n => String(n).padStart(2, '0');
const stampOf = (d = new Date()) => d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
const nowText = (d = new Date()) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
const pj = (name, ...parts) => path.join(HOME, name, ...parts);
const exists = p => fsp.stat(p).then(() => true, () => false);
const str = v => (v == null ? '' : String(v));
const put = (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const read = p => fs.readFileSync(p, 'utf8');
const UUID = '019a1b2c-3d4e-5f60-7182-93a4b5c6d7e8';

/* 照 jobs.js 给的几样，换成测试里够用的 */
function deps(over = {}) {
  const notes = [], logs = [];
  const d = {
    fsp, pj, str, exists, nowText, stampOf,
    fail: m => Object.assign(new Error(m), { plain: true }),
    retry: m => Object.assign(new Error(m), { plain: true, retry: true }),
    unbom: t => str(t).replace(/^\uFEFF/, ''),
    oneLine: t => str(t).replace(/\s+/g, ' ').trim(),
    stemOf: f => path.basename(String(f)).replace(/\.[^.]+$/, ''),
    async archive(name, relParts, stamp) {
      const src = pj(name, ...relParts);
      if (!(await exists(src))) return '';
      const base = relParts[relParts.length - 1], dot = base.lastIndexOf('.');
      const dst = pj(name, '历史记录', ...relParts.slice(0, -1), (dot > 0 ? base.slice(0, dot) : base) + '__' + (stamp || stampOf()) + (dot > 0 ? base.slice(dot) : ''));
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.rename(src, dst);
      return dst;
    },
    writeFile: async (p, t) => { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, t); },
    readFlow: async () => ({}), needFinal: async () => ({}), wordPrep: async () => {},
    noteList: async (j, f) => { notes.push(f); },
    logOf: (j, 事, who) => ({ 事, 渠道: who }),
    mtimeOf: async p => { try { return Math.floor((await fsp.stat(p)).mtimeMs); } catch (e) { return 0; } },
    TxtWord: null, handoff: async () => { throw new Error('没给 handoff'); },
    withFileLocks: async (paths, fn) => fn(),
    sha256: buf => crypto.createHash('sha256').update(buf).digest('hex'),
    run: async () => ({ code: 1, out: '', err: '测试里不调 Codex' }),
    resultJson: out => { const m = /RESULT_JSON (\{.*\})\s*$/m.exec(out); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } },
    sleep: async () => {}, CX: 'codex-chat.ps1', HOME, TOOLS, log: m => logs.push(m), ...over };
  return { D: require(path.join(DIR, 'codex-draw.js'))(d), notes, logs };
}
const FILES = { txt: ['提示词', '全局资产', '人物', '简历_提示词.txt'], note: ['提示词', '全局资产', '人物', '简历_提示词_批注.md'], geo: null,
  img: ['资产', '人物和道具', '简历.png'], cand: ['资产', '人物和道具', '简历_候选.png'], imgNote: ['资产', '人物和道具', '简历_批注.md'], shots: ['资产', '人物和道具', '简历_批注截图'] };
const histOf = (P, ...parts) => { const d = pj(P, '历史记录', ...parts); return fs.existsSync(d) ? fs.readdirSync(d) : []; };

/* ---------- 一、Codex 的回复：定稿（核图、改了什么、样子改了的出图提示词）、不出了、格式不对 ---------- */
function parseTests() {
  const { D } = deps();
  const a = D.parse('定稿\n核图：没看出问题\n改了什么：头发改短\n出图提示词：\n一个三十岁的男人，短发，灰色西装，站在白墙前，正面半身照。\n第二行也算。');
  assert.equal(a.核图, '没看出问题'); assert.equal(a.改了什么, '头发改短');
  assert.equal(a.提示词, '一个三十岁的男人，短发，灰色西装，站在白墙前，正面半身照。\n第二行也算。', '出图提示词在最后：下面几行都算它的');
  assert.ok(!a.bad && !a.drop);
  const b = D.parse('```\n**定稿。**\n- 核图：手多了一只，修好了\n改了什么：没改\n出图提示词：没改\n```');
  assert.ok(!b.bad, 'Markdown 的加粗、列表、代码框不碍事'); assert.equal(b.核图, '手多了一只，修好了'); assert.equal(b.提示词, '', '没改就不动出图提示词');
  assert.deepEqual(D.parse('不出了：这个道具剧本里删了'), { drop: true, why: '这个道具剧本里删了' });
  assert.ok(D.parse('算了').drop);
  assert.match(D.parse('好的，图存好了').bad, /第一行要写「定稿」/);
  assert.match(D.parse('   \n').bad, /回复是空的/);
  assert.equal(D.parse('定稿\n出图提示词：太短').提示词, '', '太短的不当出图提示词');
  console.log('Codex 出图：回复怎么认 ✓');
}

/* ---------- 二、换图、收图、出图提示词跟着改 ---------- */
async function fileTests() {
  const P = '换图';
  put(pj(P, '定稿的剧本', '流水线.json'), JSON.stringify({ 可用: { '资产/人物和道具/别的.png': '2026-11-01 10:00:00' } }));
  put(pj(P, ...FILES.img), 'OLD'); put(pj(P, ...FILES.cand), 'NEW');
  put(pj(P, ...FILES.imgNote), '旧图的批注'); put(pj(P, ...FILES.shots, '1.jpg'), '截图');
  put(pj(P, '资产', '人物和道具', '简历_候选_批注.md'), '新图上的批注');
  put(pj(P, '资产', '参考素材映射.json'), JSON.stringify({ prompts: { '提示词/第1段/1-2.txt': { references: [{ path: '资产\\人物和道具\\简历.png', sha256: 'old' }, { path: '资产/场景/街.png', sha256: 'x' }] } } }));
  const { D } = deps();
  const r = await D.take(P, FILES);
  assert.equal(read(pj(P, ...FILES.img)), 'NEW', '新图换成原来的名字');
  assert.ok(!fs.existsSync(pj(P, ...FILES.cand)));
  const h = histOf(P, '资产', '人物和道具');
  assert.ok(h.includes('简历__' + r.stamp + '.png') && h.includes('简历_批注__' + r.stamp + '.md') && h.includes('简历_批注截图__' + r.stamp) && h.includes('简历_候选_批注__' + r.stamp + '.md'), '旧图、批注、批注截图、新图上的批注用同一个时间收进历史记录：' + h.join('、'));
  assert.equal(read(pj(P, '历史记录', '资产', '人物和道具', '简历__' + r.stamp + '.png')), 'OLD');
  const map = JSON.parse(read(pj(P, '资产', '参考素材映射.json'))), refs = map.prompts['提示词/第1段/1-2.txt'].references;
  assert.equal(refs[0].sha256, crypto.createHash('sha256').update('NEW').digest('hex'), '挂着这张图的提示词：SHA-256 换成新图的（反斜杠写的路径也认）');
  assert.equal(refs[1].sha256, 'x', '别的图不动');
  const flow = JSON.parse(read(pj(P, '定稿的剧本', '流水线.json')));
  assert.equal(flow.可用['资产/人物和道具/简历.png'], r.可用, '算确认可用'); assert.ok(flow.可用['资产/人物和道具/别的.png'], '别的确认照旧');
  assert.ok(r.旧图);
  // 页面点「用新图」：确认可用页面自己记，这边不写流水线.json
  put(pj(P, ...FILES.cand), 'NEWER');
  const before = read(pj(P, '定稿的剧本', '流水线.json'));
  await new Promise(res => setTimeout(res, 1100));   // 换一秒：收进历史记录的名字不撞
  const r2 = await D.take(P, FILES, false);
  assert.equal(read(pj(P, ...FILES.img)), 'NEWER'); assert.equal(read(pj(P, '定稿的剧本', '流水线.json')), before, 'mark 为 false：流水线.json 不动');
  assert.ok(r2.可用 && r2.旧图);
  await assert.rejects(D.take(P, FILES), /新图不在了/, '没有候选：不动原图');
  assert.equal(read(pj(P, ...FILES.img)), 'NEWER');
  // 不要新图：候选和它上面的批注收进历史记录，原图不动
  put(pj(P, ...FILES.cand), 'NO'); put(pj(P, '资产', '人物和道具', '简历_候选_批注截图', 'a.jpg'), 'x');
  await D.drop(P, FILES);
  assert.ok(!fs.existsSync(pj(P, ...FILES.cand)) && !fs.existsSync(pj(P, '资产', '人物和道具', '简历_候选_批注截图')));
  assert.equal(read(pj(P, ...FILES.img)), 'NEWER');
  assert.ok(histOf(P, '资产', '人物和道具').some(n => /^简历_候选__\d{8}-\d{6}\.png$/.test(n)));
  await D.drop(P, FILES);   // 没有候选：什么都不做，不报错
  console.log('Codex 出图：换图、收图 ✓');
}

/* ---------- 三、整条：出图（先收掉上一张没用上的候选，聊完说定稿就换上，样子改了出图提示词跟着改）、照批注改图、说不出了 ---------- */
async function drawTests() {
  const P = '出一张';
  put(pj(P, ...FILES.txt), '图1：E:\\x\\资产\\人物和道具\\简历.png（原来的样子）\n用途：人物「简历」的定妆图\n提示词\n一个三十岁的男人，长发，灰色西装。\n');
  put(pj(P, ...FILES.img), 'OLD'); put(pj(P, ...FILES.cand), 'STALE');
  put(pj(P, '定稿的剧本', '流水线.json'), '{}');
  const said = [];
  const reply = '定稿\n核图：没看出问题\n改了什么：头发改短\n出图提示词：\n一个三十岁的男人，短发，灰色西装，站在白墙前，正面半身照。';
  const { D, notes } = deps({ async handoff(j, files, how, imgs, check) {
    assert.equal(how, 'codex');
    said.push(D.KINDS[j.事].codexMsg(j, { reply: path.join(TMP, '回复.md') }, ['写完跑下面这一句', 'node "server.js" reply ' + j.id]));
    assert.ok(!fs.existsSync(pj(P, ...FILES.cand)), '交出去以前：上一张没用上的候选收进历史记录');
    await assert.rejects(check('好的'), e => e.retry && /定稿/.test(e.message), '格式不对：接着等');
    await assert.rejects(check('定稿'), e => e.retry && /候选图路径上没有图/.test(e.message), '说了定稿、图没存：接着等');
    put(pj(P, ...FILES.cand), 'CHAT');   // 在 Codex 里聊着改，定下来的那张存在候选图路径上
    await check(reply);
    return reply;
  } });
  const j = { id: 'job1', 事: '出图', 项目: P, 段: '1', 类别: '人物', 名: '简历', 状态名: '', files: FILES, dir: path.join(TMP, 'job1') };
  const out = await D.KINDS.出图.run(j);
  assert.match(out.结果, /^在 Codex 里定稿了，换上了，算确认可用（旧图收进了历史记录）；聊的时候样子改了，出图提示词照着改了/);
  assert.deepEqual(out.产出, ['资产/人物和道具/简历.png']);
  assert.equal(read(pj(P, ...FILES.img)), 'CHAT');
  const h = histOf(P, '资产', '人物和道具');
  assert.ok(h.some(n => /^简历_候选__/.test(n)) && h.some(n => /^简历__\d{8}-\d{6}\.png$/.test(n)), '上一张候选、旧图都在历史记录：' + h.join('、'));
  assert.equal(read(pj(P, ...FILES.txt)), '图1：E:\\x\\资产\\人物和道具\\简历.png（原来的样子）\n用途：人物「简历」的定妆图\n提示词\n一个三十岁的男人，短发，灰色西装，站在白墙前，正面半身照。\n', '开头几行照旧，正文换成聊出来的');
  assert.equal(histOf(P, '提示词', '全局资产', '人物').filter(n => /^简历_提示词__/.test(n)).length, 1, '原来的出图提示词收进历史记录');
  assert.equal(notes[0].状态, '有了'); assert.equal(notes[0].核图, '没看出问题'); assert.match(notes[0].说明, /在 Codex 里定稿$/); assert.equal(notes[0].候选, '');
  assert.equal(read(path.join(TMP, 'job1', 'Codex的回复.md')).trim(), reply, 'Codex 的回复留在这一回的文件夹里');
  // 发进去的话：头一行对话名 handoff 加；不空行、不写 Markdown 列表（codex-chat 才核得上输入框），任务书、文件都写全路径
  const lines = said[0].split('\n');
  assert.ok(lines.every(l => l.trim()) && !lines.some(l => /^\s*[-*] /.test(l)), '不空行、不写列表');
  assert.equal(lines[0], '请照这份任务书做这一张图（先完整读一遍再动手）：' + path.join(TOOLS, '流水线', '任务书', '资产出图任务.txt'));
  assert.ok(lines.includes('这一张：人物「简历」') && lines.includes('提示词文件：' + pj(P, ...FILES.txt)) && lines.includes('候选图路径：' + pj(P, ...FILES.cand)));
  assert.ok(lines.includes('旧候选挪进：' + pj(P, '历史记录', '资产', '人物和道具')) && lines.includes('node "server.js" reply job1'));
  assert.equal(lines[lines.length - 1], '先出第一张给我看。');
  console.log('Codex 出图：出图、定稿换上 ✓');

  // 照批注改图：以原图为底；话里带原图、批注、标注图；不出了就收掉候选、原图不动
  put(pj(P, ...FILES.imgNote), '## 整体\n领带换成红的');
  put(pj(P, ...FILES.shots, '标注图.jpg'), 'x');
  const { D: E, notes: n2 } = deps({ async handoff(j, files, how, imgs, check) {
    said.push(E.KINDS[j.事].codexMsg(j, { reply: 'R' }, ['', 'node reply ' + j.id]));
    put(pj(P, ...FILES.cand), 'TRY');
    await check('不出了：先不改了');
    return '不出了：先不改了';
  } });
  const k = { id: 'job2', 事: '改图', 项目: P, 段: '1', 类别: '人物', 名: '简历', 状态名: '', files: FILES, dir: path.join(TMP, 'job2') };
  const o2 = await E.KINDS.改图.run(k);
  assert.equal(o2.结果, '在 Codex 里说不出了：先不改了');
  assert.equal(read(pj(P, ...FILES.img)), 'CHAT', '原图不动'); assert.ok(!fs.existsSync(pj(P, ...FILES.cand)), '聊出来的候选收进历史记录');
  assert.ok(!n2[0].状态, '不出了：资产清单只记一笔过程');
  const l2 = said[1].split('\n');
  assert.ok(l2.includes('这回先照图上的批注改。原图：' + pj(P, ...FILES.img)) && l2.includes('批注：' + pj(P, ...FILES.imgNote)) && l2.includes('标注图：' + pj(P, ...FILES.shots, '标注图.jpg')));
  assert.ok(l2.some(l => l.startsWith('提示词文件（这张图本来要画什么，只用来了解，别照它重画）：')));
  assert.equal(l2[l2.length - 1], '先改出第一张给我看。');
  await assert.rejects(E.KINDS.改图.run({ ...k, id: 'job3', files: { ...FILES, imgNote: ['资产', '人物和道具', '没有.md'] } }), /还没在图上写批注/);
  console.log('Codex 出图：照批注改图、不出了 ✓');
}

/* ---------- 四、往 Codex 里发：一次一个；发不出去改成给我提示词；报没发出、其实发出去了的认出来；服务重开后认出原来那个对话 ---------- */
async function sendTests() {
  const meta = async (j, m) => { j.dir = path.join(TMP, j.id); put(path.join(j.dir, '自己交.json'), JSON.stringify(m)); };
  const job = id => ({ id, 名: '图' + id, 标题: '出图 · ' + id, 交给: { 方式: 'codex', 等: '发送', 开: Date.now() } });
  const talk = (j, id = j.id) => put(path.join(j.dir, '交给AI的话.txt'), '【对话名】\n这一张：人物「' + j.名 + '」\nnode "server.js" reply ' + id + '\n先出第一张给我看。\n');
  // 一次一个
  let now = 0, most = 0, runs = 0;
  const { D } = deps({ async run(cmd, args) {
    runs++; now++; most = Math.max(most, now);
    await new Promise(r => setTimeout(r, 30));
    now--;
    const id = path.basename(path.dirname(args[args.indexOf('-PromptFile') + 1]));
    return { code: 0, out: 'RESULT_JSON {"ok":true,"status":"sent","thread_id":"' + UUID.slice(0, -2) + String(id).slice(-2).padStart(2, '0') + '"}', err: '' };
  } });
  const a = job('aa01'), b = job('bb02'), c = job('cc03');
  for (const j of [a, b, c]) { await meta(j, { id: j.id, 方式: 'codex' }); talk(j); }
  await Promise.all([a, b, c].map(j => D.link(j, path.join(j.dir, '交给AI的话.txt'))));
  assert.equal(most, 1, '一次只往 Codex 里发一个：用的是同一个输入框');
  // 发之前核对（11-27）：话被别的任务盖了（reply 号不是自己的）就不发，算没成；号是前缀相同的别的号也不算
  for (const other of ['zz10', 'zz0', 'zz09x']) {
    const z = job('zz09'); await meta(z, { id: z.id, 方式: 'codex' }); talk(z, other);
    const before = runs;
    await assert.rejects(D.link(z, path.join(z.dir, '交给AI的话.txt')), /交给 Codex 的话不是「图zz09」这一样的（被别的任务盖了），没发/, other);
    assert.equal(runs, before, '没往 Codex 里发：' + other);
    assert.ok(!z.交给.会话, '没记对话号');
  }
  assert.ok(a.交给.会话.endsWith('01') && b.交给.会话.endsWith('02') && a.交给.等 === '你');
  const m = JSON.parse(read(path.join(a.dir, '自己交.json')));
  assert.equal(m.会话, a.交给.会话); assert.equal(m.聊, true, '记下在 Codex 里聊：服务重开后接得上');
  assert.ok(D.KINDS.出图.接得上({ 方式: 'self', 聊: true }) && D.KINDS.出图.接得上({ 方式: 'codex' }) && !D.KINDS.出图.接得上({ 方式: 'self' }), '以前一次出一张的不接');
  // 发不出去：改成给我提示词，记下为什么
  const { D: F2, logs } = deps({ run: async () => ({ code: 1, out: '', err: 'Codex 没开着' }) });
  const d = job('dd04'); await meta(d, { id: d.id, 方式: 'codex' });
  await F2.link(d, path.join(d.dir, 'x.txt'));
  assert.equal(d.交给.方式, 'self'); assert.equal(d.交给.没发出, 'Codex 没开着'); assert.equal(d.交给.等, '你');
  assert.equal(JSON.parse(read(path.join(d.dir, '自己交.json'))).方式, 'self'); assert.ok(logs.some(l => /没自动发进 Codex/.test(l)));
  // 报没发出，其实发出去了（11-23 碰到过「找不到发送按钮」）：在 Codex 的会话记录里认出那一句
  const e = job('ee05'); await meta(e, { id: e.id, 方式: 'codex' });
  const { D: F3 } = deps({ async run() {
    const t = new Date(), dir = path.join(SESS, String(t.getFullYear()), two(t.getMonth() + 1), two(t.getDate()));
    put(path.join(dir, 'rollout-2026-11-23T10-00-00-' + UUID + '.jsonl'), '{"type":"session_meta"}\n{"type":"user_message","message":"…跑 node server.js reply ee05 …"}\n');
    return { code: 1, out: 'RESULT_JSON {"ok":false,"error":"找不到发送按钮，没有发送"}', err: '' };
  } });
  await F3.link(e, path.join(e.dir, 'x.txt'));
  assert.equal(e.交给.方式, 'codex'); assert.equal(e.交给.会话, UUID, '会话记录里找到了：算发出去了');
  // 老对话里提到这个号的不算
  const old = path.join(SESS, '2026', '01', '01', 'rollout-2026-01-01T10-00-00-' + UUID.replace('019a', '0000') + '.jsonl');
  put(old, 'reply ff06'); const past = new Date(Date.now() - 3 * 864e5); fs.utimesSync(old, past, past);
  assert.equal(F3.started('ff06', Date.now() - 60e3), '');
  // 服务重开后接着等的：认出原来那个对话，不再发
  const { D: F4 } = deps({ run: async () => { throw new Error('重开后不该再发'); } });
  const g = { ...job('gg07'), 续: true, 会话0: UUID }; await meta(g, { id: g.id, 方式: 'codex' });
  await F4.link(g, 'x');
  assert.equal(g.交给.会话, UUID); assert.equal(g.交给.方式, 'codex');
  const h = { ...job('hh08'), 续: true }; await meta(h, { id: h.id, 方式: 'codex' });
  await F4.link(h, 'x');
  assert.equal(h.交给.方式, 'self', '重开前还没发出去：改成给我提示词'); assert.match(h.交给.没发出, /服务重开前还没发出去/);
  // 去 Codex 看：对话号不对不开
  await assert.rejects(F4.openThread('不是号'), /不知道是 Codex 里哪个对话/);
  process.env.ANTOU_CODEX_LINK_LOG = path.join(TMP, 'links.txt');
  await F4.openThread(UUID);
  assert.equal(read(process.env.ANTOU_CODEX_LINK_LOG).trim(), 'codex://threads/' + UUID);
  console.log('Codex 出图：一次发一个、发不出去改成给我提示词、认出发出去的对话 ✓');
}

/* ---------- 五、资产跟着改（11-23）：描写改了，话里带上原来、现在、多了的镜头；定稿先换字再换图，图和字都记下照的那一句；照批注改的照留原来那一句 ---------- */
async function followTests() {
  const Src = require('../公用/资产照的.js'), P = '跟着改';
  const FS2 = { ...FILES, txt: ['提示词', '全局资产', '场景', '前台_提示词.txt'], img: ['资产', '场景', '前台.png'], cand: ['资产', '场景', '前台_候选.png'], imgNote: ['资产', '场景', '前台_批注.md'], shots: ['资产', '场景', '前台_批注截图'] };
  const flowP = pj(P, '定稿的剧本', '流水线.json');
  put(pj(P, ...FS2.txt), '用途：场景「前台」\n提示词\n会议室，长桌，三个面试官坐成一排，白墙，顶灯。\n');
  put(pj(P, ...FS2.img), 'OLD');
  const doc = { 场景: '前台：写字楼前台，玻璃门，前台小姐坐着', 场: [{ 段: '1', 场景文字: ['前台：写字楼前台，玻璃门，前台小姐坐着'], 段落: [{ 写什么: '童磊推开玻璃门', 场景: ['前台'] }] }], 可用: {} };
  put(flowP, JSON.stringify(doc));
  const said = [];
  const reply = '定稿\n核图：没看出问题\n改了什么：照现在的描写改成前台\n出图提示词：\n写字楼前台，玻璃门，前台小姐坐在台后，白天，顶灯照着大理石台面。';
  const { D } = deps({ Src, readFlow: async () => JSON.parse(read(flowP)), async handoff(j, files, how, imgs, check) {
    said.push(D.KINDS[j.事].codexMsg(j, { reply: 'R' }, ['', 'node reply ' + j.id]));
    put(pj(P, ...FS2.cand), 'NEW');
    await check(reply);
    return reply;
  } });
  const j = { id: 'job9', 事: '出图', 项目: P, 段: '1', 类别: '场景', 名: '前台', 状态名: '', files: FS2, dir: path.join(TMP, 'job9'),
    参数: { 照: Src.nowOf(doc, '场景', '前台'), 变了: { 描写: { 原来: '前台：会议室，长桌', 现在: '前台：写字楼前台，玻璃门，前台小姐坐着' }, 镜头: ['童磊推开玻璃门'], 字: true }, 别的: 1 } };
  await D.KINDS.出图.prep(j);
  assert.deepEqual(j.变了, { 描写: { 原来: '前台：会议室，长桌', 现在: '前台：写字楼前台，玻璃门，前台小姐坐着' }, 镜头: ['童磊推开玻璃门'] }, '页面交过来的洗过一遍');
  await D.KINDS.出图.run(j);
  const lines = said[0].split('\n');
  assert.ok(lines.includes('这回描写改了。原来：前台：会议室，长桌') && lines.includes('现在：前台：写字楼前台，玻璃门，前台小姐坐着') && lines.includes('用到它的镜头多了：童磊推开玻璃门'));
  assert.ok(lines.every(l => l.trim()), '还是不空行');
  const flow = JSON.parse(read(flowP)), img = FS2.img.join('/'), txt = FS2.txt.join('/');
  assert.equal(flow.照的[img].描写, '前台：写字楼前台，玻璃门，前台小姐坐着', '图记下照的是现在那一句');
  assert.deepEqual(flow.照的[txt], flow.照的[img], '字也记下');
  const t = p => Math.floor(fs.statSync(pj(P, ...p)).mtimeMs);
  assert.equal(Src.imgStale(flow, img, '场景', '前台', t(FS2.img)), null, '刚定稿的不算旧');
  assert.equal(Src.wordEdited(flow, img, Date.parse(flow.可用[img].replace(' ', 'T')), t(FS2.txt)), false, '先换字再换图：不算「字改了」');
  assert.match(read(pj(P, ...FS2.txt)), /写字楼前台，玻璃门/);
  // 照批注改图：照的还是原来那一句，时间换成现在（图换过也认得出旧了）
  const f2 = JSON.parse(read(flowP));
  f2.照的[img] = { 描写: '前台：会议室，长桌', 时间: '2026-11-01 10:00:00' };
  put(flowP, JSON.stringify(f2));
  put(pj(P, ...FS2.imgNote), '## 整体\n灯再亮一点');
  const { D: E } = deps({ Src, readFlow: async () => JSON.parse(read(flowP)), async handoff(k, files, how, imgs, check) {
    said.push(E.KINDS[k.事].codexMsg(k, { reply: 'R' }, ['', 'node reply ' + k.id]));
    put(pj(P, ...FS2.cand), 'EDIT');
    await check('定稿\n核图：没看出问题\n改了什么：灯亮了\n出图提示词：没改');
    return '定稿\n核图：没看出问题\n改了什么：灯亮了\n出图提示词：没改';
  } });
  const k = { id: 'job10', 事: '改图', 项目: P, 段: '1', 类别: '场景', 名: '前台', 状态名: '', files: FS2, dir: path.join(TMP, 'job10') };
  await E.KINDS.改图.run(k);
  const f3 = JSON.parse(read(flowP));
  assert.equal(f3.照的[img].描写, '前台：会议室，长桌', '照批注改的：照的还是原来那一句');
  assert.equal(f3.照的[img].时间, f3.可用[img], '时间换成这回换上的');
  assert.equal(Src.tagOf(Src.imgStale(f3, img, '场景', '前台', t(FS2.img))), '描写改了', '照批注改出来的照样算旧');
  assert.ok(!said[1].includes('这回描写改了'), '照批注改图的话里不带');
  console.log('Codex 出图：描写改了先改字、定稿记下照的哪一句 ✓');
}

/* ---------- 六、人物卡（11-26，公用/人物卡.js）：人物出图的话里带人物卡那一句；原图是竖幅的交过去照它出；只要全身的、道具、照批注改图不带 ---------- */
async function faceCardTests() {
  const FaceCard = require('../公用/人物卡.js'), P = '人物卡';
  const filesOf = (cat, name) => { const d = cat === '场景' ? '场景' : '人物和道具'; return { txt: ['提示词', '全局资产', cat, name + '_提示词.txt'], note: ['提示词', '全局资产', cat, name + '_提示词_批注.md'], geo: null,
    img: ['资产', d, name + '.png'], cand: ['资产', d, name + '_候选.png'], imgNote: ['资产', d, name + '_批注.md'], shots: ['资产', d, name + '_批注截图'] }; };
  const png = (w, h) => { const b = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  const flowP = pj(P, '定稿的剧本', '流水线.json');
  put(flowP, JSON.stringify({ 人物: [{ 名: '童磊', 描写: '六岁', 资产: '资产/人物和道具/童磊.png' }, { 名: '我军士兵', 描写: '军装', 资产: '资产/人物和道具/我军士兵.png', 只全身: true }], 道具: [{ 名: '碗', 描写: '白瓷碗', 资产: '资产/人物和道具/碗.png' }] }));
  const F1 = filesOf('人物', '童磊'), F2 = filesOf('人物', '我军士兵'), F3 = filesOf('道具', '碗');
  for (const f of [F1, F2, F3]) { put(pj(P, ...f.txt), '用途：定妆图\n提示词\n正面全身站立，竖幅 2:3，纯中灰色摄影棚背景。\n'); put(pj(P, ...f.img), png(1024, 1536)); }
  const reply = '定稿\n核图：没看出问题\n改了什么：改成人物卡\n出图提示词：\n一张横幅 16:9 的图，从左到右五格都是这个六岁男孩：正脸大特写、3/4 侧脸特写，后三格是脖子以下的正面、侧面、背面全身。';
  let n = 0;
  async function go(files, cat, name, kind = '出图') {
    let said = '', D;
    ({ D } = deps({ FaceCard, readFlow: async () => JSON.parse(read(flowP)), async handoff(j, f, how, imgs, check) {
      said = D.KINDS[j.事].codexMsg(j, { reply: 'R' }, ['', 'node reply ' + j.id]);
      put(pj(P, ...files.cand), 'NEW');
      await check(reply);
      return reply;
    } }));
    const j = { id: 'card' + (++n), 事: kind, 项目: P, 段: '1', 类别: cat, 名: name, 状态名: '', files, dir: path.join(TMP, 'card' + n) };
    await D.KINDS[kind].run(j);
    const lines = said.split('\n');
    assert.ok(lines.every(l => l.trim()) && !lines.some(l => /^\s*[-*] /.test(l)), '还是不空行、不写列表');
    return lines;
  }
  const [card, old] = FaceCard.drawLines(pj(P, ...F1.img));
  let lines = await go(F1, '人物', '童磊');
  assert.ok(lines.includes(card) && lines.includes(old), '竖幅原图：话里带人物卡那一句和原图的完整路径');
  assert.ok(lines.indexOf(card) < lines.findIndex(l => l.startsWith('候选图路径：')), '写在候选图路径前面');
  assert.ok(read(pj(P, ...F1.txt)).includes('正脸大特写、3/4 侧脸特写'), '定稿：出图提示词换成改好的人物卡');
  lines = await go(F1, '人物', '童磊');   // 换上的这张不是竖的（测试里写的不是图）：只带人物卡那一句
  assert.ok(lines.includes(card) && !lines.some(l => l.startsWith('原图（')), '原图不是竖幅的：不交原图');
  lines = await go(F2, '人物', '我军士兵');
  assert.ok(!lines.some(l => l.startsWith('这一张是人物卡') || l.startsWith('原图（')), '只要全身的：不带人物卡');
  lines = await go(F3, '道具', '碗');
  assert.ok(!lines.some(l => l.startsWith('这一张是人物卡') || l.startsWith('原图（')), '道具不带');
  put(pj(P, ...F1.img), png(1024, 1536)); put(pj(P, ...F1.imgNote), '## 整体\n头发短一点');
  lines = await go(F1, '人物', '童磊', '改图');
  assert.ok(!lines.some(l => l.startsWith('这一张是人物卡') || l.startsWith('原图（')), '照批注改图不带：只改说到的地方');
  console.log('Codex 出图：人物卡那一句、竖幅原图交过去 ✓');
}

(async () => {
  try {
    parseTests();
    await fileTests();
    await drawTests();
    await sendTests();
    await followTests();
    await faceCardTests();
    console.log('Codex出图_测试 全部通过');
  } finally { fs.rmSync(TMP, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
