'use strict';
/* annotate-live/jm-video.js（11-21）：流水线自己出片，不再交给 Codex。
   认素材（同名直接用、老名字先改名、没有才传）、存视频草稿、报价、确认积分、提交一次、等出完、下载核对、记生成记录；
   出错就停、说清花没花积分；服务重开后照 出片进度.json 接着做，提交过的只等、只下载。
   假的即梦命令行（照 dreamina-canvas 1.3.0 回话的样子），真的临时文件夹；不连即梦、不花积分。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const make = require('../../.agents/skills/annotate-live/jm-video.js');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const CID = '7bec76b5-4184-4d2c-9b1e-a332e7317853', NAME = '试片', TOKEN = 'TOKEN-只给这一回-9f8e7d';
const BOM = String.fromCharCode(0xFEFF);
const PROMPT = '【基础设定】\r\n写实。\r\n\r\n【素材】\r\n洪七公@图片1，砂锅@图片2，首帧@图片3。\r\n\r\n【事件脚本】\r\n0-10秒：洪七公把草药投进砂锅。\r\n';
const MODELS = [{ model: 'seedance_2.5_draft', modes: ['m2v', 't2v'].map(name => ({ name,
  flags: [{ flag: '--prompt', maxLength: 15000 }, { flag: '--resolution', values: ['480p'] }, { flag: '--duration', min: 4, max: 30 }],
  references: name === 'm2v' ? { max: 50, types: [{ mediaType: 'image', max: 30 }, { mediaType: 'video', max: 10 }, { mediaType: 'audio', max: 10 }] } : { max: 0 } })) }];

/* 一个临时项目：一份提示词、三张图（洪七公、砂锅、首帧），和照它排的出片计划（出片任务书同一回写的那份） */
function project() {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), '流水线出片-'));
  const HOME = path.join(TMP, '项目'), P = (...x) => path.join(HOME, NAME, ...x);
  const put = (rel, buf) => { const f = P(...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); return buf; };
  const prompt = put('提示词/第1-1段/4-6.txt', Buffer.from(BOM + PROMPT));
  const imgs = { 洪七公: put('资产/人物和道具/洪七公.png', Buffer.from('洪七公图')), 砂锅: put('资产/人物和道具/砂锅.png', Buffer.from('砂锅图')), 首帧: put('资产/关键帧/第1-1段/镜头1_首帧.png', Buffer.from('首帧图')) };
  const plan = { 说明: '测试', 任务书: '提示词/第1-1段/4-6_出片任务.txt', 任务书SHA: 'a'.repeat(64), 项目: NAME, 段: '1-1', 画布: 'https://jimeng.jianying.com/ai-tool/ai-canvas/' + CID, 画布号: CID, 登录位: '',
    账号: '测试号', 画布名: '测试画布', 节点名: '第1-1段｜4-6｜样片480p｜10秒', 模型: 'Seedance 2.5 样片', 清晰度: '480p', 秒数: 10, 积分上限: 0,
    提示词: { 路径: '提示词/第1-1段/4-6.txt', sha256: sha(prompt) }, 存到: '成片/第1-1段/4-6.mp4',
    素材: [
      { ref: '@图片1', name: '洪七公', path: '资产/人物和道具/洪七公.png', sha256: sha(imgs.洪七公), 节点名: '人物和道具_洪七公', 老名: ['人物_洪七公', '道具_洪七公'] },
      { ref: '@图片2', name: '砂锅', path: '资产/人物和道具/砂锅.png', sha256: sha(imgs.砂锅), 节点名: '人物和道具_砂锅', 老名: ['人物_砂锅', '道具_砂锅'] },
      { ref: '@图片3', name: '镜头1_首帧', path: '资产/关键帧/第1-1段/镜头1_首帧.png', sha256: sha(imgs.首帧), 节点名: '第1-1段_镜头1_首帧', 老名: [] }] };
  const dirOf = tag => { const d = P('历史记录', 'AI任务', '20261121-1200' + tag + '_出片_第1-1段'); fs.mkdirSync(d, { recursive: true }); return d; };
  return { TMP, HOME, P, put, plan, dir: dirOf('00'), dirOf, imgs };
}

/* 假的即梦命令行。o.hook(命令, 参数, ctx)：回一个结果就顶替这一条（ctx.def() 照常做），回 undefined 照常做 */
function fakeJimeng(o = {}) {
  const nodes = new Map(), res = new Map(), ops = new Map(), calls = [];
  let seq = 0;
  const nid = () => 'node_t' + String(++seq).padStart(9, '0');
  const addNode = x => { nodes.set(x.nodeId, { status: 'success', resources: [], upstreamNodeIds: [], ...x }); return x.nodeId; };
  const addImage = title => { const rid = crypto.randomUUID(); res.set(rid, { resourceId: rid, type: 'image', status: 'success' }); return addNode({ nodeId: nid(), type: 'image', title, resources: [{ resourceId: rid, type: 'image', status: 'success' }] }); };
  const finish = op => {
    op.state = 'succeeded';
    Object.assign(res.get(op.rid), { status: 'success' });
    Object.assign(nodes.get(op.node), { status: 'success', resources: [{ resourceId: op.rid, type: 'video', status: 'success' }] });
  };
  const addVideo = (title, gen, state) => {   // 画布上早就有的视频节点（state：草稿 / 在出 / 出好）
    const id = addNode({ nodeId: nid(), type: 'video', title, status: 'empty', upstreamNodeIds: gen.references.map(r => r.id), generation: gen });
    if (state !== '草稿') {
      const rid = crypto.randomUUID(), op = { state: 'running', rid, polls: o.polls == null ? 2 : o.polls, node: id };
      res.set(rid, { resourceId: rid, type: 'video', status: 'running', creditsAmount: 90, video: { durationSeconds: 10.04 } });
      Object.assign(nodes.get(id), { status: 'running', resources: [{ resourceId: rid, type: 'video', status: 'running' }], op });
      if (state === '出好') finish(op);
    }
    return id;
  };
  const meta = () => ({ requestId: 'req-' + calls.length });
  const ok = data => ({ code: 0, out: JSON.stringify({ ok: true, data, meta: meta() }), err: '' });
  const bad = (code, message, extra = {}) => ({ code, out: JSON.stringify({ ok: false, error: { message, ...extra }, meta: meta() }), err: '' });
  function handle(a) {
    const f = k => { const i = a.indexOf(k); return i < 0 ? undefined : a[i + 1]; }, all = k => a.flatMap((x, i) => x === k ? [a[i + 1]] : []);
    const cmd = a[0] + ' ' + a[1];
    if (cmd === 'model list') return ok({ items: MODELS });
    if (cmd === 'node find') {   // 和真的一样：名字、提示词里带这个词的都算
      const t = f('--name'), ty = f('--type'), off = +f('--offset') || 0;
      const hit = [...nodes.values()].filter(x => x.type === ty && (x.title.includes(t) || String((x.generation || {}).prompt || '').includes(t)));
      return ok({ items: hit.slice(off, off + 50).map(x => ({ nodeId: x.nodeId, type: x.type, title: x.title, status: x.status })), hasMore: off + 50 < hit.length });
    }
    if (cmd === 'node show') {
      return ok({ nodes: all('--node-id').map(id => {
        const x = nodes.get(id);
        if (!x) return { result: 'NOT_FOUND', nodeId: id };
        if (x.op && x.op.state === 'running' && !(x.op.polls-- > 0)) finish(x.op);   // 画布上早就提交过的：看几回就出好
        const { op, ...pub } = x;
        return { result: 'FOUND', node: JSON.parse(JSON.stringify(pub)) };
      }) });
    }
    if (cmd === 'resource upload') {
      const rid = f('--resource-id'), b = fs.readFileSync(f('--file'));
      res.set(rid, { resourceId: rid, type: f('--type'), status: 'success', sha: sha(b) });
      return ok({ resourceId: rid, status: 'success' });
    }
    if (cmd === 'resource get') { const r = res.get(a[2]); return r ? ok(r) : bad(1, 'resource not found'); }
    if ((cmd === 'node create' || cmd === 'node edit') && a[2] === 'video' && f('--mode')) {   // 视频草稿
      const id = f('--node-id'), had = nodes.get(id);
      if (cmd === 'node create' && had) return bad(1, 'node already exists');
      if (cmd === 'node edit' && !had) return bad(1, 'node not found');
      if (had && had.status !== 'empty') return bad(1, 'node is not editable');
      const refs = all('--ref').map(r => ({ kind: 'node', id: r.slice(5), type: 'image' }));
      nodes.set(id, { ...(had || {}), nodeId: id, type: 'video', title: f('--title'), status: 'empty', resources: [], upstreamNodeIds: refs.map(r => r.id),
        generation: { mode: f('--mode'), model: f('--model'), prompt: f('--prompt'), references: refs, ratio: f('--ratio'), resolution: f('--resolution'), durationSeconds: +f('--duration'), outputCount: +f('--count') } });
      return ok({ nodeId: id });
    }
    if (cmd === 'node create') {   // 素材节点
      const id = f('--node-id');
      if (nodes.has(id)) return bad(1, 'node already exists');
      if (!res.has(f('--resource-id'))) return bad(1, 'resource not found');
      addNode({ nodeId: id, type: a[2], title: f('--title'), resources: [{ resourceId: f('--resource-id'), type: a[2], status: 'success' }] });
      return ok({ nodeId: id });
    }
    if (cmd === 'node edit') { const x = nodes.get(f('--node-id')); if (!x) return bad(1, 'node not found'); x.title = f('--title'); return ok({ nodeId: x.nodeId }); }   // 改名
    if (cmd === 'node quote') { const q = o.quote == null ? 90 : o.quote; return ok({ totalMaxCredits: q, items: [{ nodeId: f('--node-id'), maxCredits: q }], confirmable: true, confirmationRequired: true }); }
    if (cmd === 'node confirm') return ok({ creditConfirmationToken: TOKEN, creditCeiling: +f('--credit-ceiling'), expiresAt: '2026-11-21T12:10:00Z' });
    if (cmd === 'node run') {
      assert.equal(f('--credit-token'), TOKEN);
      const sid = f('--submit-id'), id = f('--node-id'), x = nodes.get(id);
      if (o.reject) return ok({ items: [{ nodeId: id, state: 'rejected', error: { message: 'blocked by copyright policy' } }] });
      const rid = crypto.randomUUID();
      res.set(rid, { resourceId: rid, type: 'video', status: 'running', creditsAmount: 90, video: { durationSeconds: 10.04 } });
      const op = { state: 'running', rid, polls: o.polls == null ? 2 : o.polls, node: id };
      Object.assign(x, { status: 'running', resources: [{ resourceId: rid, type: 'video', status: 'running' }], op });   // 等出完：查提交编号、看节点都会往前走
      ops.set(sid, op);
      return ok({ items: [{ nodeId: id, state: 'accepted', resources: [{ resourceId: rid }] }] });
    }
    if (cmd === 'operation wait') {
      const op = ops.get(a[2]);
      if (!op) return bad(1, 'operation not found');
      if (op.state === 'running' && op.polls-- > 0) return bad(20, 'operation not finished before timeout', { code: 40011 });
      if (op.state === 'running') finish(op);
      return ok({ state: 'succeeded', resources: [{ resourceId: op.rid, state: 'succeeded' }] });
    }
    if (cmd === 'operation status') { const op = ops.get(a[2]); return op ? ok({ state: op.state }) : bad(1, 'operation not found'); }
    if (cmd === 'resource download') {
      const b = Buffer.from('片子:' + a[2]);
      fs.writeFileSync(f('--output'), b);
      return ok({ resourceId: a[2], path: f('--output'), size: b.length, sha256: sha(b) });
    }
    return { code: 2, out: '', err: '没想到的命令：' + a.join(' ') };
  }
  async function run(exe, full) {
    assert.equal(full[0], '--non-interactive');
    assert.deepEqual(full.slice(-2), ['--format', 'json']);
    let a = full.slice(1, -2);
    if (a[0] === '--profile') a = a.slice(2);
    calls.push(a);
    const ctx = { nodes, res, ops, calls, def: () => handle(a) };
    const r = o.hook && await o.hook(a[0] + ' ' + a[1] + (a[0] === 'node' && /^(create|edit)$/.test(a[1]) ? ' ' + a[2] : ''), a, ctx);
    return r || handle(a);
  }
  const canvas = { each: async (list, n, fn) => Promise.all(list.map(fn)), versions: o.versions || (async () => { throw new Error('这一条不该再认版本'); }) };
  const named = c => calls.filter(a => (a[0] + ' ' + a[1] + (a[0] === 'node' && /^(create|edit)$/.test(a[1]) ? ' ' + a[2] : '')) === c);
  return { run, canvas, nodes, res, ops, calls, named, addImage, addVideo, nid };
}
/* 和 draft-store.js 的 withLocks 一样：同一把锁的排着做 */
function locks() {
  const pending = new Map();
  return (paths, work) => {
    const keys = [...new Set(paths.map(p => path.resolve(p).toLowerCase()))].sort();
    const result = Promise.all(keys.map(k => pending.get(k)).filter(Boolean).map(p => p.catch(() => {}))).then(work);
    const tail = result.catch(() => {});
    for (const k of keys) pending.set(k, tail);
    return result;
  };
}
const go = (pr, jm, { plan = pr.plan, dir = pr.dir, j = { id: 'j1' }, lock, now, WAIT_MAX } = {}) =>
  make({ JM: 'dreamina-canvas', run: jm.run, HOME: pr.HOME, canvas: jm.canvas, PAUSE: 0, TICK: 0, withFileLocks: lock, ...(now ? { now } : {}), ...(WAIT_MAX ? { WAIT_MAX } : {}) }).go(j, plan, dir);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const gen = (pr, refs, over = {}) => ({ mode: 'm2v', model: 'seedance_2.5_draft', prompt: PROMPT, references: refs.map(id => ({ kind: 'node', id, type: 'image' })), ratio: '16:9', resolution: '480p', durationSeconds: 10, outputCount: 1, ...over });

const T = (name, fn) => test(name, { timeout: 30e3 }, fn);   // 卡住的不等到天亮

T('顺利出片：同名的直接用、老名字的先改名、没有的才传；报价、确认、只提交一次；下载核对，记生成记录；凭证和提示词全文不进记录', async () => {
  const pr = project(), jm = fakeJimeng();
  const man = jm.addImage('人物和道具_洪七公'), pot = jm.addImage('道具_砂锅');
  jm.addImage('人物和道具_洪七公_旧');   // 名字里带这个词的：不是同名，不用
  const r = await go(pr, jm);
  assert.match(r.结果, /^出好了：4-6\.mp4（10 秒，扣 90 积分）；新传了 1 样素材，画布上 1 个节点改了名$/);
  assert.deepEqual(r.产出, ['成片/第1-1段/4-6.mp4']);
  assert.equal(jm.nodes.get(pot).title, '人物和道具_砂锅');   // 老名字改成新名字，不重传
  const ups = jm.named('resource upload');
  assert.equal(ups.length, 1);
  const up = ups[0], upRid = up[up.indexOf('--resource-id') + 1];
  assert.equal(jm.res.get(upRid).sha, sha(pr.imgs.首帧));
  const frame = [...jm.nodes.values()].find(x => x.title === '第1-1段_镜头1_首帧');
  assert.ok(frame && frame.type === 'image');
  const A = [...jm.nodes.values()].find(x => x.type === 'video');
  assert.equal(A.title, '第1-1段｜4-6｜样片480p｜10秒');
  assert.match(A.nodeId, /^node_[0-9abcdefghjkmnpqrstvwxyz]{10}$/);   // 即梦命令行自己核的格式
  assert.equal(A.generation.prompt, PROMPT);   // 提示词原样（去掉开头的 BOM，换行照旧）
  assert.deepEqual(A.generation.references.map(x => x.id), [man, pot, frame.nodeId]);   // 照 @图片1、2、3 的先后挂
  assert.deepEqual([A.generation.mode, A.generation.model, A.generation.resolution, A.generation.durationSeconds, A.generation.ratio], ['m2v', 'seedance_2.5_draft', '480p', 10, '16:9']);
  const order = jm.calls.map(a => a[0] + ' ' + a[1]).filter(c => /quote|confirm|node run/.test(c));
  assert.deepEqual(order, ['node quote', 'node confirm', 'node run']);   // 只提交一次
  assert.equal(jm.named('node confirm')[0][jm.named('node confirm')[0].indexOf('--credit-ceiling') + 1], '90');   // 没填上限：照报价
  const out = pr.P('成片', '第1-1段', '4-6.mp4');
  assert.equal(fs.readFileSync(out, 'utf8'), '片子:' + A.resources[0].resourceId);
  assert.deepEqual(fs.readdirSync(pr.dir).filter(f => /\.part$|antou-tmp/.test(f)), []);
  const log = fs.readFileSync(path.join(pr.dir, '出片记录.log'), 'utf8'), stText = fs.readFileSync(path.join(pr.dir, '出片进度.json'), 'utf8');
  for (const t of [log, stText]) { assert.ok(!t.includes(TOKEN), '积分凭证不记'); assert.ok(!t.includes('洪七公把草药投进砂锅'), '提示词全文不记'); }
  assert.match(log, /--credit-token <略>/);
  assert.match(log, /--prompt <提示词 \d+ 字>/);
  const st = JSON.parse(stText);
  assert.equal(st.已提交, true);
  assert.deepEqual(st.文件, { 路径: '成片/第1-1段/4-6.mp4', 大小: fs.statSync(out).size, sha256: sha(fs.readFileSync(out)), 秒: 10.04, 积分: 90 });
  const recText = fs.readFileSync(pr.P('资产', '生成记录.json'), 'utf8'), rec = JSON.parse(recText)['出片_第1-1段_4-6'];
  assert.match(recText, /^\{\n  "出片_第1-1段_4-6": \{/);   // 和 Codex 记的同一个样子（两格缩进）
  assert.equal(rec.status, 'downloaded_verified');
  assert.equal(rec.nodeId, A.nodeId);
  assert.equal(rec.submitId, st.提交);
  assert.deepEqual(rec.references.map(x => x.method), ['reused', 'reused', 'uploaded_cli']);
  assert.ok(!recText.includes(TOKEN));
});

T('报价超过填的上限：停在草稿，不确认积分、不提交', async () => {
  const pr = project(), jm = fakeJimeng({ quote: 90 });
  await assert.rejects(go(pr, jm, { plan: { ...pr.plan, 积分上限: 50 } }), /报价 90 积分，超过你填的上限 50：停在草稿，没花积分/);
  assert.equal(jm.named('node confirm').length + jm.named('node run').length, 0);
  assert.equal([...jm.nodes.values()].filter(x => x.type === 'video' && x.status === 'empty').length, 1);
});

T('传素材回话不明（超时）：用同一个编号再传一回，不传出两份', async () => {
  const pr = project();
  let once = false;
  const jm = fakeJimeng({ hook: c => { if (c === 'resource upload' && !once) { once = true; return { code: -1, out: '', err: '等了 10 分钟还没好，停掉了' }; } } });
  await go(pr, jm);
  const ups = jm.named('resource upload').map(a => a[a.indexOf('--resource-id') + 1]);
  assert.equal(ups.length, 4);   // 三张都没有：头一张传两回，后两张各一回
  assert.equal(ups[0], ups[1]);
  assert.equal(jm.named('node create image').length, 3);
  assert.equal(new Set([...jm.nodes.values()].filter(x => x.type === 'image').map(x => x.title)).size, 3);
});

T('存视频草稿头一回「参数不对」：歇一下同样的再存一回，成了接着走', async () => {
  const pr = project();
  let once = false;
  const jm = fakeJimeng({ hook: c => { if (c === 'node create video' && !once) { once = true; return { code: 1, out: JSON.stringify({ ok: false, error: { message: 'The request parameters are invalid' } }), err: '' }; } } });
  const r = await go(pr, jm);
  assert.match(r.结果, /^出好了/);
  const mk = jm.named('node create video');
  assert.equal(mk.length, 2);
  assert.deepEqual(mk.map(a => a[a.indexOf('--update-id') + 1] + a[a.indexOf('--node-id') + 1]), [0, 1].map(i => mk[0][mk[0].indexOf('--update-id') + 1] + mk[0][mk[0].indexOf('--node-id') + 1]));
});

T('存上去回读和稿子对不上（提示词被截了）：停在草稿，不报价', async () => {
  const pr = project();
  const jm = fakeJimeng({ hook: (c, a, ctx) => { if (c === 'node create video') { const r = ctx.def(); const x = ctx.nodes.get(a[a.indexOf('--node-id') + 1]); x.generation.prompt = x.generation.prompt.slice(0, 20); return r; } } });
  await assert.rejects(go(pr, jm), /回读，和稿子对不上（提示词不是一字不差/);
  assert.equal(jm.named('node quote').length, 0);
});

T('即梦没收（版权这类）：停下说原因，不再提交、不等', async () => {
  const pr = project(), jm = fakeJimeng({ reject: true });
  await assert.rejects(go(pr, jm), /即梦没收这一条：blocked by copyright policy（请求号 req-\d+）。没扣积分/);
  assert.equal(jm.named('node run').length, 1);
  assert.equal(jm.named('operation wait').length, 0);
});

T('本机先核：成片里已有同名的、提示词或素材在排好任务书以后改过、提示词里有 {{，都不连即梦就停', async () => {
  let pr = project(), jm = fakeJimeng();
  pr.put('成片/第1-1段/4-6.mp4', Buffer.from('上一条'));
  await assert.rejects(go(pr, jm), /成片里已经有 4-6\.mp4 了：没出片、没花积分/);
  pr = project(); pr.put('提示词/第1-1段/4-6.txt', Buffer.from(PROMPT + '多一句。'));
  await assert.rejects(go(pr, jm), /提示词在排好任务书以后又改过/);
  pr = project(); pr.put('资产/人物和道具/砂锅.png', Buffer.from('换过的砂锅'));
  await assert.rejects(go(pr, jm), /素材「砂锅」在排好任务书以后又换过/);
  pr = project(); const b = pr.put('提示词/第1-1段/4-6.txt', Buffer.from(PROMPT + '{{node:x}}'));
  await assert.rejects(go(pr, jm, { plan: { ...pr.plan, 提示词: { ...pr.plan.提示词, sha256: sha(b) } } }), /提示词里有「\{\{」/);
  assert.equal(jm.calls.length, 0);
});

T('即梦不收这样出（样片只有 480p）：认素材之前就停，不传、不建', async () => {
  const pr = project(), jm = fakeJimeng();
  await assert.rejects(go(pr, jm, { plan: { ...pr.plan, 清晰度: '720p' } }), /即梦不收这样出：Seedance 2\.5 样片 只出 480p/);
  assert.equal(jm.named('resource upload').length + jm.named('node create video').length, 0);
});

T('提交的回话丢了：用原编号只读查到收了，只等、不重提', async () => {
  const pr = project();
  const jm = fakeJimeng({ hook: (c, a, ctx) => { if (c === 'node run') { ctx.def(); return { code: -1, out: '', err: '等了 2 分钟还没好，停掉了' }; } } });
  const r = await go(pr, jm);
  assert.match(r.结果, /^出好了/);
  assert.equal(jm.named('node run').length, 1);
  assert.equal(jm.named('operation status').length, 1);
});

T('等出片时点了停：说清已经提交、即梦照样在出；服务重开后照进度接着等，只下载，不再报价、提交', async () => {
  const pr = project(), j = { id: 'j1' };
  const jm = fakeJimeng({ polls: 3, hook: c => { if (c === 'operation wait' && jm.named('operation wait').length === 1) j.停 = true; } });
  await assert.rejects(go(pr, jm, { j }), /停掉了：已经提交了，即梦那边照样在出（节点 node_[0-9a-z]{10}）。出好以后再点「批准出片」会直接下载，不再扣积分/);
  const before = jm.calls.length;
  const r = await go(pr, jm, { plan: null, j: { id: 'j1' } });   // 服务重开后接着做：plan 传 null，照 出片进度.json
  assert.match(r.结果, /^出好了：4-6\.mp4/);
  const again = jm.calls.slice(before).map(a => a[0] + ' ' + a[1]);
  assert.ok(!again.some(c => /quote|confirm|node run|upload|node create|node find/.test(c)), again.join('，'));
  assert.ok(fs.existsSync(pr.P('成片', '第1-1段', '4-6.mp4')));
});

T('停掉以后再点批准出片（新的一回）：画布上同名的那条照样在出，接着等它，出好直接下载，不再扣积分', async () => {
  const pr = project(), j = { id: 'j1' };
  const jm = fakeJimeng({ polls: 2, hook: c => { if (c === 'operation wait') j.停 = true; } });
  await assert.rejects(go(pr, jm, { j }), /停掉了：已经提交了/);
  const before = jm.calls.length;
  const r = await go(pr, jm, { dir: pr.dirOf('30'), j: { id: 'j2' } });
  assert.match(r.结果, /^出好了：4-6\.mp4/);
  const again = jm.calls.slice(before).map(a => a[0] + ' ' + a[1]);
  assert.ok(!again.some(c => /quote|confirm|node run|upload/.test(c)), again.join('，'));
});

T('画布上同名的视频节点早就出好了（稿子一样）：直接下载，不报价、不提交', async () => {
  const pr = project(), jm = fakeJimeng();
  const ids = [jm.addImage('人物和道具_洪七公'), jm.addImage('人物和道具_砂锅'), jm.addImage('第1-1段_镜头1_首帧')];
  jm.addVideo(pr.plan.节点名, gen(pr, ids), '出好');
  const r = await go(pr, jm);
  assert.match(r.结果, /^出好了：4-6\.mp4（10 秒，扣 90 积分）；画布上同名的这一条早就出好了，直接下载$/);
  assert.equal(jm.named('node quote').length + jm.named('node run').length + jm.named('node create video').length + jm.named('node edit video').length, 0);
});

T('画布上同名的视频节点提交过、稿子不一样：停下叫人改名，不动它', async () => {
  const pr = project(), jm = fakeJimeng();
  const ids = [jm.addImage('人物和道具_洪七公'), jm.addImage('人物和道具_砂锅'), jm.addImage('第1-1段_镜头1_首帧')];
  jm.addVideo(pr.plan.节点名, gen(pr, ids, { prompt: '别的稿' }), '在出');
  await assert.rejects(go(pr, jm), /已经有叫「第1-1段｜4-6｜样片480p｜10秒」的视频节点，提交过，和这回的稿不一样（提示词不是一字不差/);
  assert.equal(jm.named('node run').length + jm.named('node edit video').length, 0);
});

T('画布上同名的还是草稿：在它上面接着存，不另建', async () => {
  const pr = project(), jm = fakeJimeng();
  const ids = [jm.addImage('人物和道具_洪七公'), jm.addImage('人物和道具_砂锅'), jm.addImage('第1-1段_镜头1_首帧')];
  const draft = jm.addVideo(pr.plan.节点名, gen(pr, ids, { prompt: '上回存了一半' }), '草稿');
  await go(pr, jm);
  assert.equal(jm.named('node create video').length, 0);
  assert.equal(jm.named('node edit video')[0][jm.named('node edit video')[0].indexOf('--node-id') + 1], draft);
  assert.equal([...jm.nodes.values()].filter(x => x.type === 'video').length, 1);
});

T('同名的素材节点有两个：不知道用哪个，停下', async () => {
  const pr = project(), jm = fakeJimeng();
  jm.addImage('人物和道具_洪七公'); jm.addImage('人物和道具_洪七公');
  await assert.rejects(go(pr, jm), /画布上有 2 个叫「人物和道具_洪七公」的节点，不知道该用哪个/);
  assert.equal(jm.named('resource upload').length, 0);
});

T('文件换过新的：画布上的旧版改成「名字__那一版的时间」，再传新的；多出排任务书时没有的同名节点就停', async () => {
  const pr = project(), jm = fakeJimeng();
  const old = jm.addImage('第1-1段_镜头1_首帧');
  const plan = { ...pr.plan, 素材: pr.plan.素材.map(r => r.ref === '@图片3' ? { ...r, 换: [{ t: '20261117-085959', f: 'x', sha: 'b'.repeat(64) }], 节点: [{ node: old, 版: '20261117-085959', 凭: '画面' }] } : r) };
  await go(pr, jm, { plan });
  assert.equal(jm.nodes.get(old).title, '第1-1段_镜头1_首帧__20261117-085959');
  const now = [...jm.nodes.values()].filter(x => x.title === '第1-1段_镜头1_首帧');
  assert.equal(now.length, 1);
  assert.notEqual(now[0].nodeId, old);
  const pr2 = project(), jm2 = fakeJimeng();
  const o2 = jm2.addImage('第1-1段_镜头1_首帧'); jm2.addImage('第1-1段_镜头1_首帧');
  const plan2 = { ...pr2.plan, 素材: pr2.plan.素材.map(r => r.ref === '@图片3' ? { ...r, 换: [{ t: '20261117-085959', f: 'x', sha: 'b'.repeat(64) }], 节点: [{ node: o2, 版: '20261117-085959' }] } : r) };
  await assert.rejects(go(pr2, jm2, { plan: plan2 }), /画布上又多出了叫「第1-1段_镜头1_首帧」的节点/);
  assert.equal(jm2.named('node edit image').length, 0);
});

T('两条一起出、要传同一张图：同一张画布一次只一条认素材，只传一回', async () => {
  const pr = project(), jm = fakeJimeng();
  jm.addImage('人物和道具_洪七公'); jm.addImage('人物和道具_砂锅');
  const b = pr.put('提示词/第1-1段/4-7.txt', Buffer.from(PROMPT.replace('投进砂锅', '搅了搅砂锅')));
  const planB = { ...pr.plan, 节点名: '第1-1段｜4-7｜样片480p｜10秒', 提示词: { 路径: '提示词/第1-1段/4-7.txt', sha256: sha(b) }, 存到: '成片/第1-1段/4-7.mp4' };
  const lock = locks();
  const [r1, r2] = await Promise.all([go(pr, jm, { lock }), go(pr, jm, { plan: planB, dir: pr.dirOf('10'), j: { id: 'j2' }, lock })]);
  assert.match(r1.结果, /^出好了：4-6\.mp4/);
  assert.match(r2.结果, /^出好了：4-7\.mp4/);
  assert.equal(jm.named('resource upload').length, 1);
  const vids = [...jm.nodes.values()].filter(x => x.type === 'video');
  assert.equal(vids.length, 2);
  assert.equal(vids[0].generation.references[2].id, vids[1].generation.references[2].id);
});

T('等太久：说清即梦照样在出，过一会儿再点会直接下载', async () => {
  const pr = project(), jm = fakeJimeng({ polls: 1000 });
  let t = Date.parse('2026-11-21T12:00:00+08:00');
  await assert.rejects(go(pr, jm, { now: () => (t += 1000), WAIT_MAX: 60e3 }), /等了 1 分钟还没出完：即梦那边照样在出（节点 node_[0-9a-z]{10}）/);
  assert.equal(jm.named('node run').length, 1);
});

T('生成记录：原来的条目照留、换行照原文件（CRLF 的还是 CRLF）；读不懂的不冲掉，片子照样算出好', async () => {
  let pr = project(), jm = fakeJimeng();
  pr.put('资产/生成记录.json', Buffer.from('{\r\n  "出片_第1-1段_4-5": {\r\n    "status": "downloaded_verified"\r\n  }\r\n}\r\n'));
  await go(pr, jm);
  const t = fs.readFileSync(pr.P('资产', '生成记录.json'), 'utf8');
  assert.equal(t.split('\n').length - 1, t.split('\r\n').length - 1);   // 全是 CRLF
  assert.deepEqual(Object.keys(JSON.parse(t)), ['出片_第1-1段_4-5', '出片_第1-1段_4-6']);
  pr = project(); jm = fakeJimeng();
  pr.put('资产/生成记录.json', Buffer.from('{ 写坏了'));
  const r = await go(pr, jm);
  assert.match(r.结果, /^出好了/);
  assert.equal(fs.readFileSync(pr.P('资产', '生成记录.json'), 'utf8'), '{ 写坏了');
});

T('纯文字出片（没挂素材）：t2v，不带 --ref', async () => {
  const pr = project(), jm = fakeJimeng();
  const b = pr.put('提示词/第1-1段/4-6.txt', Buffer.from('【事件脚本】\r\n0-10秒：大雪落在空街上。\r\n'));
  await go(pr, jm, { plan: { ...pr.plan, 素材: [], 提示词: { ...pr.plan.提示词, sha256: sha(b) } } });
  const mk = jm.named('node create video')[0];
  assert.equal(mk[mk.indexOf('--mode') + 1], 't2v');
  assert.ok(!mk.includes('--ref'));
});
