'use strict';
/* annotate-live/canvas.js 的 versions、plan（11-17 加）：出片任务书生成时，认画布上和本地文件同名的节点是哪一版、写给 Codex 怎么办。
   假的即梦命令行，真的临时文件（图是自己拼的小 PNG，视频是几个字节）。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), '画布认版本-'));
process.env.ANTOU_CANVAS_CACHE = path.join(TMP, '缓存');
const make = require('../../.agents/skills/annotate-live/canvas.js');
const { missing } = require('../../.agents/skills/annotate-live/jm-cmds.js');
const HOME = path.join(TMP, '项目'), NAME = '试片', CANVAS = '8fc4ccbd-cd27-4f1b-a4a6-f13c0e9b50d3';
const P = (...x) => path.join(HOME, NAME, ...x);
const put = (f, buf, mtime) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); if (mtime) fs.utimesSync(f, mtime / 1000, mtime / 1000); return f; };
const T = s => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)$/.exec(s); return new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(); };
const sha = buf => require('node:crypto').createHash('sha256').update(buf).digest('hex');

/* 拼一张 RGB 小图；extra：多塞一段说明，像素不变、文件不一样（像即梦重压过的） */
function png(seed, extra) {
  const w = 6, h = 4, raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = (x * 40 + seed) & 255; raw[o + 1] = (y * 60 + seed * 3) & 255; raw[o + 2] = seed & 255; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]); };   // 校验码不看，写 0
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), ...(extra ? [chunk('tEXt', Buffer.from('jimeng'))] : []), chunk('IDAT', zlib.deflateSync(raw, { level: extra ? 1 : 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* 本地：首帧现在一版、历史两版；白模现在一版、历史一版 */
const IMG = '第1段_镜头1_首帧', VID = '第1段_镜头1_白模';
const imgCur = put(P('资产', '关键帧', '第1段', '镜头1_首帧.png'), png(3), T('20261117-090000'));
const imgOld1 = put(P('历史记录', '资产', '关键帧', '第1段', '镜头1_首帧__20261116-100000.png'), png(1), T('20261115-120000'));
const imgOld2 = put(P('历史记录', '资产', '关键帧', '第1段', '镜头1_首帧__20261117-085959.png'), png(2), T('20261116-110000'));
const vidCur = put(P('资产', '关键帧', '第1段', '镜头1_白模.mp4'), Buffer.from('白模第三版'), T('20261117-080000'));
const vidOld = put(P('历史记录', '资产', '关键帧', '第1段', '镜头1_白模__20261117-080000.mp4'), Buffer.from('白模第二版'), T('20261116-200000'));
const item = (title, cur, olds) => ({ title, cur, sha: sha(fs.readFileSync(cur)), olds: olds.map(([t, f]) => ({ t, f, sha: sha(fs.readFileSync(f)) })) });
const IMG_ITEM = item(IMG, imgCur, [['20261117-085959', imgOld2], ['20261116-100000', imgOld1]]);
const VID_ITEM = item(VID, vidCur, [['20261117-080000', vidOld]]);

/* 假的即梦命令行：nodes 是画布上的节点 { id, title, type, rid, at, bytes（下回来的样子，没有就下不下来） } */
function fake(nodes) {
  const calls = [];
  const run = async (exe, args) => {
    calls.push(args.join(' '));
    const ok = data => ({ code: 0, out: JSON.stringify({ ok: true, data }), err: '' });
    const at = k => args[args.indexOf(k) + 1];
    assert.equal(missing(args), '');   // 流水线用到的命令都要记在 jm-cmds.js 的 USED 里
    if (args.includes('ls')) { const name = at('--name'); return ok({ items: nodes.filter(n => n.title.includes(name)).map(n => ({ nodeId: n.id, type: n.type, status: 'success', title: n.title })), hasMore: false }); }
    if (args.includes('show')) {
      const ids = args.filter((a, i) => args[i - 1] === '--node-id');
      return ok({ nodes: ids.map(id => nodes.find(n => n.id === id)).filter(Boolean).map(n => ({ result: 'FOUND', node: { nodeId: n.id, type: n.type, title: n.title, status: 'success', resources: n.rid ? [{ resourceId: n.rid, type: n.type, status: 'success', createdAt: n.at || 0, [n.type]: {} }] : [] } })) });
    }
    if (args.includes('download')) {
      const n = nodes.find(x => x.rid === at('download'));
      if (!n || !n.bytes) return { code: 1, out: JSON.stringify({ ok: false, error: { message: '下载超时' } }), err: '' };
      fs.writeFileSync(at('-o'), n.bytes);
      return ok({ resourceId: n.rid, path: at('-o') });
    }
    return { code: 2, out: '', err: '没想到的命令：' + args.join(' ') };
  };
  return { run, calls };
}
let k = 0;
const canvasOf = nodes => { const f = fake(nodes); return { f, c: make({ HOME, JM: process.execPath, run: f.run, log() {} }) }; };
const rid = () => '00000000-0000-4000-8000-' + String(++k).padStart(12, '0');
const ask = (c, items) => c.versions({ name: NAME, canvas: CANVAS, profile: '', items });

test('图：比像素认版本，文件重压过也认得出；哪一版都不像就是认不出', async () => {
  const { c } = canvasOf([
    { id: 'node_old1', title: IMG, type: 'image', rid: rid(), bytes: png(1, true) },
    { id: 'node_cur', title: IMG, type: 'image', rid: rid(), bytes: png(3, true) },
    { id: 'node_odd', title: IMG, type: 'image', rid: rid(), bytes: png(9, true) },
  ]);
  const [got] = await ask(c, [IMG_ITEM]);
  assert.deepEqual(got, [{ node: 'node_old1', 版: '20261116-100000', 凭: '画面' }, { node: 'node_cur', 版: 'cur', 凭: '画面' }, { node: 'node_odd', 版: '', 凭: '对不上' }]);
});

test('只认名字一字不差的节点：名字__时间、名字_上层 不算', async () => {
  const { c } = canvasOf([
    { id: 'node_hist', title: IMG + '__20261116-100000', type: 'image', rid: rid(), bytes: png(1, true) },
    { id: 'node_layer', title: IMG + '_上层', type: 'image', rid: rid(), bytes: png(1, true) },
    { id: 'node_old2', title: IMG, type: 'image', rid: rid(), bytes: png(2, true) },
  ]);
  const [got] = await ask(c, [IMG_ITEM]);
  assert.deepEqual(got, [{ node: 'node_old2', 版: '20261117-085959', 凭: '画面' }]);
});

test('视频：下下来比文件；下不下来照上传时间认', async () => {
  const { c } = canvasOf([
    { id: 'node_v_old', title: VID, type: 'video', rid: rid(), bytes: Buffer.from('白模第二版') },
    { id: 'node_v_cur', title: VID, type: 'video', rid: rid(), bytes: Buffer.from('白模第三版') },
    { id: 'node_v_t_old', title: VID, type: 'video', rid: rid(), at: T('20261116-213000') },   // 第二版写好以后、换下来以前传的
    { id: 'node_v_t_cur', title: VID, type: 'video', rid: rid(), at: T('20261117-100000') },   // 第三版写好以后传的
    { id: 'node_v_t_early', title: VID, type: 'video', rid: rid(), at: T('20261116-150000') },   // 第二版还没写出来就传了：传的不是它
  ]);
  const [got] = await ask(c, [VID_ITEM]);
  assert.deepEqual(got, [
    { node: 'node_v_old', 版: '20261117-080000', 凭: '文件' }, { node: 'node_v_cur', 版: 'cur', 凭: '文件' },
    { node: 'node_v_t_old', 版: '20261117-080000', 凭: '时间' }, { node: 'node_v_t_cur', 版: 'cur', 凭: '时间' }, { node: 'node_v_t_early', 版: '', 凭: '' },
  ]);
});

test('上传以后文件又改过、没进历史记录：照时间认不出', async () => {
  const cur = put(P('资产', '关键帧', '第1段', '镜头2_白模.mp4'), Buffer.from('改过的'), T('20261117-120000'));
  const { c } = canvasOf([{ id: 'node_x', title: '第1段_镜头2_白模', type: 'video', rid: rid(), at: T('20261117-110000') }]);
  const [got] = await ask(c, [item('第1段_镜头2_白模', cur, [])]);
  assert.deepEqual(got, [{ node: 'node_x', 版: '', 凭: '' }]);
});

test('画布上没有同名节点：回空的；几样一起认，各回各的', async () => {
  const { c } = canvasOf([{ id: 'node_v', title: VID, type: 'video', rid: rid(), bytes: Buffer.from('白模第三版') }]);
  const got = await ask(c, [IMG_ITEM, VID_ITEM]);
  assert.deepEqual(got, [[], [{ node: 'node_v', 版: 'cur', 凭: '文件' }]]);
});

test('认过的记在缓存里：再认一遍不再下载', async () => {
  const nodes = [{ id: 'node_a', title: IMG, type: 'image', rid: rid(), bytes: png(1, true) }, { id: 'node_b', title: VID, type: 'video', rid: rid(), bytes: Buffer.from('白模第二版') }];
  const { c, f } = canvasOf(nodes);
  const first = await ask(c, [IMG_ITEM, VID_ITEM]);
  assert.equal(f.calls.filter(x => x.includes('download')).length, 2);
  const again = make({ HOME, JM: process.execPath, run: f.run, log() {} });   // 服务重开过也一样
  assert.deepEqual(await ask(again, [IMG_ITEM, VID_ITEM]), first);
  assert.equal(f.calls.filter(x => x.includes('download')).length, 2, '第二遍不该再下载');
  assert.ok(!fs.readdirSync(path.join(process.env.ANTOU_CANVAS_CACHE, CANVAS)).some(n => n.endsWith('.part')), '下下来的视频算完要删掉');
});

test('即梦命令行出错：整个认版本报错（任务书照旧叫 Codex 去认）', async () => {
  const c = make({ HOME, JM: process.execPath, run: async () => ({ code: 1, out: JSON.stringify({ ok: false, error: { message: '没登录' } }), err: '' }), log() {} });
  await assert.rejects(ask(c, [IMG_ITEM]), /没登录/);
});

test('plan：写给 Codex 的那一句', () => {
  const { c } = canvasOf([]);
  const none = c.plan(IMG, []);
  assert.match(none, /没有叫「第1段_镜头1_首帧」的节点：照这个文件传一个新节点/);
  const old = c.plan(IMG, [{ node: 'node_a', 版: '20261116-100000', 凭: '画面' }]);
  assert.match(old, /node_a 是旧版（下载下来比过画面），先把它改名成「第1段_镜头1_首帧__20261116-100000」（照 AGENTS\.md，只改名，不删）/);
  assert.match(old, /改好名再照这个文件传一个新节点，名字写「第1段_镜头1_首帧」/);
  assert.doesNotMatch(old, /生成记录/);   // 不再叫 Codex 去生成记录里查
  const both = c.plan(IMG, [{ node: 'node_a', 版: '20261116-100000', 凭: '时间' }, { node: 'node_b', 版: 'cur', 凭: '画面' }, { node: 'node_c', 版: 'cur', 凭: '文件' }]);
  assert.match(both, /node_a 是旧版（照上传时间认的）/);
  assert.match(both, /node_b 就是现在这个文件（下载下来比过画面），直接引用，不重传/);
  assert.match(both, /node_c 就是现在这个文件（下载下来比过文件），不用管它/);
  assert.doesNotMatch(both, /传一个新节点/);
  const odd = c.plan(IMG, [{ node: 'node_a', 版: '20261116-100000', 凭: '画面' }, { node: 'node_d', 版: '', 凭: '对不上' }, { node: 'node_e', 版: '', 凭: '' }]);
  assert.match(odd, /node_d 认不出是哪一版（下载下来比过，和本地哪一版都对不上）/);
  assert.match(odd, /node_e 认不出是哪一版（下不下来，也没法照上传时间认）/);
  assert.match(odd, /有认不出的：这一样先别改名、别传，停下问我/);
  assert.doesNotMatch(odd, /传一个新节点/);
  for (const s of [none, old, both, odd]) assert.match(s, /^这个文件换过新的，旧版收在历史记录。.*开工时画布上要是多出这里没写的「第1段_镜头1_首帧」，也停下问我。$/);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('画布上还叫 11-20 以前的老名字（道具_砂锅）：也认出来，任务书叫先改成新名字再引用', async () => {
  const cur = put(P('资产', '人物和道具', '砂锅.png'), png(5), T('20261117-090000'));
  const { c } = canvasOf([{ id: 'node_pot', title: '道具_砂锅', type: 'image', rid: rid(), bytes: png(5, true) }]);
  const it = { title: '人物和道具_砂锅', titles: ['人物和道具_砂锅', '人物_砂锅', '道具_砂锅', '特效_砂锅'], cur, sha: sha(fs.readFileSync(cur)), olds: [] };
  const [got] = await ask(c, [it]);
  assert.deepEqual(got, [{ node: 'node_pot', 版: 'cur', 凭: '画面', 名: '道具_砂锅' }]);
  const say = c.plan('人物和道具_砂锅', got);
  assert.match(say, /画布上还叫老名字「道具_砂锅」/);
  assert.match(say, /先把它改名成「人物和道具_砂锅」再引用，不重传/);
});

/* 11-21 提速：新名、老名、几样素材的名字一起查，不再一个查完才查下一个。slow：查名字时等 ms(名字) 毫秒，记最多同时开了几条 */
function slowRun(nodes, ms) {
  const f = fake(nodes), seen = { now: 0, peak: 0 };
  const run = async (exe, args) => {
    seen.now++; seen.peak = Math.max(seen.peak, seen.now);
    try { if (args.includes('ls')) await new Promise(r => setTimeout(r, ms(args[args.indexOf('--name') + 1]))); return await f.run(exe, args); }
    finally { seen.now--; }
  };
  return { c: make({ HOME, JM: process.execPath, run, log() {} }), seen };
}

test('几个名字一起查：头一个名字最后查完，结果也照名字的先后排', async () => {
  const cur = put(P('资产', '人物和道具', '战士.png'), png(6), T('20261117-090000'));
  const { c, seen } = slowRun([
    { id: 'node_new', title: '人物和道具_战士', type: 'image', rid: rid(), bytes: png(6, true) },
    { id: 'node_oldname', title: '人物_战士', type: 'image', rid: rid(), bytes: png(6, true) },
  ], n => n.startsWith('人物和道具') ? 80 : 10);
  const it = { title: '人物和道具_战士', titles: ['人物和道具_战士', '人物_战士', '道具_战士', '特效_战士'], cur, sha: sha(fs.readFileSync(cur)), olds: [] };
  const t0 = Date.now(), got = await ask(c, [it, VID_ITEM]);
  assert.equal(seen.peak, 5, '四个名字和白模那一样，五条要同时查');
  assert.ok(Date.now() - t0 < 80 + 4 * 10 + 60, '一起查只等最慢的那一条');
  assert.deepEqual(got, [[{ node: 'node_new', 版: 'cur', 凭: '画面' }, { node: 'node_oldname', 版: 'cur', 凭: '画面', 名: '人物_战士' }], []]);
});

test('名字再多也一次最多查 8 条', async () => {
  const { c, seen } = slowRun([], () => 15);
  const items = ['甲', '乙', '丙'].map(x => ({ title: '人物和道具_' + x, titles: ['人物和道具_', '人物_', '道具_', '特效_'].map(h => h + x), cur: imgCur, sha: IMG_ITEM.sha, olds: [] }));
  assert.deepEqual(await ask(c, items), [[], [], []]);
  assert.equal(seen.peak, 8);
});

/* 11-26：即梦命令行升级后「node find」改叫「node ls」。命令行不认这句命令时照实说，不说成没登录、网不好 */
test('即梦命令行不认这句命令（升级后改了名）：照实说是哪句，叫人发给 AI', async () => {
  const run = async () => ({ code: 0, out: JSON.stringify({ schemaVersion: '2', ok: false, error: { code: 2, message: 'The request parameters are invalid.', diagnostics: [{ detail: 'The command contains an unrecognized subcommand.' }] } }), err: '' });
  const c = make({ HOME, JM: process.execPath, run, log() {} });
  await assert.rejects(ask(c, [IMG_ITEM]), e => e.plain && e.cmd && /^即梦命令行不认「node ls」这句命令了，多半是它升级后改了名：把这句话发给 AI/.test(e.message));
});
