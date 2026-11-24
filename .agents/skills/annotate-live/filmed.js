'use strict';
/* 出过片的提示词不能改，只能另存成新的一版（2026-11-22 他定：「已经出片的提示词不能改，只能新增提示词」）。
   出过片：成片/第N段、历史记录/成片/第N段 里有这一版出的样片（照 公用/样片归属.js 认，改过名的连以前的名字一起认），
     或者这一版正在出片（出片任务书、出片排着或在做）。
   本机服务这头拦：写稿页、提示词页存稿（draft-store.js）、PUT、DELETE（server.js）、交给 AI 写完（pe-finish.js）；
     按批注改提示词照改，改好另存成下一版，原稿不动（jobs.js）。加减镜头改名照旧能改（改名记录认得回来）。
   另存成下一版（fork）：带着新的一版的字来另存；字和素材都和这一版一样的不另存（回 422）。
     2026-11-23 他定「另存成改N」不许原样照抄；当晚又定：另存不看审片、批注，「另存以后…如果发现提示词、素材都没有变，则不允许保存」。
     写稿页改了，头一回存就另存（POST /api/filmed，公用/写稿出过片.js）；按批注改提示词、照审片批注另存是 AI 改好以后另存（jobs.js、review-fork.js）。
     名字接着这一条最新那一版往下排（_改N），让开已经有的、出过片的、改名记录里的名字。
     写稿资料：写稿页给的那几样（写法、分镜稿、挂图……）换上，别的照原稿抄；AI 改的不给，整份照抄。参考素材映射这一条抄到新名字下；AI 批注挪过去；人写的批注留在原稿旁边。
     只有一条的最新那一版能另存（不然新的一版会盖住更新的那一版）；正在出片的等出完。
   另存出来的那一版接着存（twin：draft-store.js、server.js 的 PUT 问）：字和素材又和上一版（出过片的）一模一样了，也不存（回 422）。
   一样不一样：字不算开头的 BOM、换行的写法、行尾的空格、头尾的空行；素材是 @图片N、@视频N、@音频N 各对哪个文件，
     参考素材映射里登记的在前，写稿页挂的补没登记的号（写稿页也这么认）。
   批注：写给这一版的几份（项目里的相对路径）：它出的样片旁边的审片批注（成片里的在前、再是历史记录里的），加上这一版提示词上写的批注。
   接口（server.js 查过 X-Antou）：
     GET  /api/filmed?p=项目&s=段          这一段出过片的几版：{ 版: { 名字: { 名, 出过片, 片, 历史, 在出, 下一版, 最新, 不能另存, 批注 } } }，没出过片的不列
     GET  /api/filmed?p=项目&s=段&n=名字   这一版：{ 名, 出过片, 片, 历史, 在出, 下一版, 最新, 不能另存, 批注 }
     POST /api/filmed?p=项目&s=段&n=名字   { text, side }（写稿页的字、写稿资料那几样）：另存成下一版，给 { 名, mtime, sideMtime, side, 挪了, 没挪 }
   测试：node --test 通用工具/测试/出过片_测试.cjs */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { checkSide } = require('./draft-store.js');   // 页面能存的写稿资料那几样：和存稿同一套查法

module.exports = function makeFilmed({ ROOT, TOOLS, live = () => [], withLocks = (paths, fn) => fn(), log = () => {} }) {
  const Core = require(path.join(TOOLS, '公用', '核心.js'));
  const ClipOf = require(path.join(TOOLS, '公用', '样片归属.js'));
  const HOME = path.join(ROOT, '项目');
  const pj = (p, ...parts) => path.join(HOME, p, ...parts);
  const segDir = s => '第' + s + '段';
  const err = (status, msg) => Object.assign(new Error(msg), { status });
  const str = v => typeof v === 'string' ? v : '';
  const unbom = s => s.replace(/^\uFEFF/, '');
  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  const stemOf = n => String(n).replace(/\.txt$/i, '');
  const SHOTS = '_批注截图', NOTE = '_批注.md';
  const segOk = s => /^[0-9]+(?:-[0-9]+)*$/.test(s);
  const vpOk = n => Core.nameOk(n) && Core.RE_VP.test(n);
  const REF_RE = /^@(图片|视频|音频)[0-9]+$/;

  /* 总文件夹里的路径是不是 项目/项目名/提示词/第N段/ 里的视频提示词：是给 { p, s, n }，不是给 null */
  function promptAt(abs) {
    const parts = path.relative(ROOT, path.resolve(abs)).split(path.sep);
    if (parts.length !== 5 || parts[0] !== '项目' || parts[2] !== '提示词' || !Core.nameOk(parts[1])) return null;
    const m = /^第([0-9]+(?:-[0-9]+)*)段$/.exec(parts[3]);
    return m && vpOk(parts[4]) ? { p: parts[1], s: m[1], n: parts[4] } : null;
  }
  async function ls(dir) {
    try { return (await fsp.readdir(dir, { withFileTypes: true })).map(e => ({ name: e.name, dir: e.isDirectory() })); }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e; }
  }
  /* 这一段现在什么样：提示词文件夹里有哪些、两处的样片和它们旁边的审片批注、改名记录、在做的任务 */
  async function segState(p, s) {
    const here = await ls(pj(p, '提示词', segDir(s))), files = new Set(here.map(x => x.name));
    const clips = [], notes = new Set();   // notes：「成片/第N段/名_批注.md」这样记（和 批注 给的一样）
    for (const [at, old] of [[['成片', segDir(s)], false], [['历史记录', '成片', segDir(s)], true]]) {
      for (const x of await ls(pj(p, ...at))) {
        if (x.dir) continue;
        if (Core.RE_CLIP.test(x.name)) clips.push({ name: x.name, old });
        else if (x.name.endsWith(NOTE)) notes.add([...at, x.name].join('/'));
      }
    }
    let rn = null;
    try {
      const flow = JSON.parse(unbom(await fsp.readFile(pj(p, '定稿的剧本', '流水线.json'), 'utf8')));
      const sc = (Array.isArray(flow && flow.场) ? flow.场 : []).find(x => x && String(x.段) === s);
      rn = sc && sc.改名 && typeof sc.改名 === 'object' && !Array.isArray(sc.改名) ? sc.改名 : null;
    } catch (e) { /* 没有流水线，或者读不了：不认改名 */ }
    const jobs = (live() || []).filter(j => j && j.项目 === p && String(j.段) === s);
    return { seg: s, files, clips, notes, rn, jobs };
  }
  /* 这一版出的样片：现在的名字，加上改名以前叫过的 */
  const namesOf = (st, n) => [n, ...(st.rn ? Core.vpWas(st.rn, n, x => st.files.has(x)) : [])];
  const clipsOf = (st, n) => { const ns = namesOf(st, n); return st.clips.filter(c => ns.some(m => ClipOf.carries(c.name, m))); };
  const filming = (st, n) => st.jobs.some(j => (j.事 === '出片任务书' && j.名 === n) || (j.事 === '出片' && Core.taskVp(str(j.名)) === n));
  const famOf = (st, n) => { const b = Core.vpBase(n); return [...st.files].filter(x => vpOk(x) && Core.vpBase(x) === b).sort((a, c) => Core.vpVer(a) - Core.vpVer(c)); };
  /* 这一条里比 n 早的最近一版：另存出来的一版，上一版就是它出自的那一版 */
  const prevOf = (st, n) => { const v = Core.vpVer(n), lower = famOf(st, n).filter(x => Core.vpVer(x) < v); return lower[lower.length - 1] || ''; };
  /* 下一版叫什么：接着最新那一版往下排；名字已经有人用（文件、写稿资料、批注）、改名记录里有、以前同名的一版出过片的，让开 */
  function nextOf(st, n) {
    const fam = famOf(st, n);
    for (let k = Core.vpVer(fam.length ? fam[fam.length - 1] : n) + 1; k < 1000; k++) {
      const c = Core.vpVerName(n, k), cs = stemOf(c);
      if ([c, cs + '_写稿.json', cs + '_批注.md', cs + '_AI批注.md', cs + SHOTS].some(x => st.files.has(x)) || own(st.rn, c) || clipsOf(st, c).length) continue;
      return c;
    }
    return '';
  }
  /* 写给这一版的批注（项目里的相对路径）：它出的样片旁边的审片批注（成片里的在前），再加上这一版提示词上写的批注 */
  function notesOf(st, n, cs) {
    const clipNote = c => [...(c.old ? ['历史记录'] : []), '成片', segDir(st.seg), c.name.replace(/\.[^.]+$/, '') + NOTE].join('/');
    const out = cs.map(clipNote).filter(r => st.notes.has(r));
    if (st.files.has(stemOf(n) + NOTE)) out.push(['提示词', segDir(st.seg), stemOf(n) + NOTE].join('/'));
    return out;
  }
  function stateOf(st, n) {
    const cs = clipsOf(st, n), 在出 = filming(st, n), 出过片 = cs.length > 0 || 在出, fam = famOf(st, n), top = fam[fam.length - 1] || '';
    let 下一版 = '', 不能另存 = '';
    if (出过片) {
      if (在出) 不能另存 = '这一版正在出片：出完再另存成新的一版';
      else if (!st.files.has(n)) 不能另存 = '这一版的文件不在了';
      else if (top !== n) 不能另存 = '这一条已经有更新的「' + top + '」了：去改那一版';
      else if (!(下一版 = nextOf(st, n))) 不能另存 = '起不出下一版的名字';
    }
    return { 名: n, 出过片, 片: cs.filter(c => !c.old).map(c => c.name), 历史: cs.filter(c => c.old).map(c => c.name), 在出, 下一版, 最新: top, 不能另存, 批注: notesOf(st, n, cs) };   // 最新：这一条最新那一版
  }
  const state = async (p, s, n) => stateOf(await segState(p, s), n);
  /* 拦下来时说的话：这一版出过片（哪几条样片），要改另存成哪一版 */
  function say(f) {
    if (!f || !f.出过片) return '';
    if (f.在出) return '这一版正在出片，不能改：出完以后另存成新的一版再改';
    const vids = [...f.片, ...f.历史.map(v => v + '（历史记录里）')];
    return '这一版出过片（' + vids.slice(0, 3).join('、') + (vids.length > 3 ? ' 等 ' + vids.length + ' 条' : '') + '），原稿不能改，只能另存成新的一版：'
      + (f.下一版 ? '点「另存成「' + f.下一版 + '」」照它改，改了提示词或素材才存成新的一版' : f.不能另存);
  }
  /* 存盘前问一声（draft-store.js、server.js 的 PUT、DELETE）：abs 是出过片的视频提示词，给拦下的话；别的给 '' */
  async function frozen(abs) {
    const at = promptAt(abs);
    if (!at) return '';
    try { await fsp.stat(abs); } catch (e) { return ''; }   // 还没有这个文件（新建）不拦
    return say(await state(at.p, at.s, at.n));
  }

  /* ---------- 两份稿一样不一样：字和素材 ---------- */
  const plainText = t => unbom(String(t)).split(/\r\n|\n|\r/).map(l => l.trimEnd()).join('\n').trim();
  const slash = p => String(p || '').replace(/\\/g, '/');
  async function readSide(p, s, n) {   // 这一版的写稿资料；没有给 {}
    let raw;
    try { raw = await fsp.readFile(pj(p, '提示词', segDir(s), stemOf(n) + '_写稿.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
    let side;
    try { side = JSON.parse(unbom(raw)); } catch (e) { throw err(409, '「' + stemOf(n) + '_写稿.json」读不了（' + e.message + '），这回没存'); }
    return side && typeof side === 'object' && !Array.isArray(side) ? side : {};
  }
  async function readMap(p) {   // 参考素材映射；没有给 null
    let raw;
    try { raw = await fsp.readFile(pj(p, '资产', '参考素材映射.json'), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    try { return JSON.parse(unbom(raw)); } catch (e) { throw err(409, '参考素材映射读不了（' + e.message + '），这回没存'); }
  }
  const regOf = (map, s, n) => { const ps = map && map.prompts, k = ['提示词', segDir(s), n].join('/'); return own(ps, k) ? ps[k] : null; };
  /* 素材：@图片N 这些各对哪个文件。登记的在前，挂图补没登记的号 */
  function refsOf(reg, side) {
    const out = new Map(), hung = side && side.挂图 && typeof side.挂图 === 'object' && !Array.isArray(side.挂图) ? side.挂图 : {};
    for (const it of reg && Array.isArray(reg.references) ? reg.references : []) if (it && REF_RE.test(it.ref) && !out.has(it.ref)) out.set(it.ref, slash(it.path));
    for (const [ref, p] of Object.entries(hung)) if (REF_RE.test(ref) && !out.has(ref)) out.set(ref, slash(p));
    return JSON.stringify([...out].sort());
  }
  const same = (a, b) => plainText(a.text) === plainText(b.text) && refsOf(a.reg, a.side) === refsOf(b.reg, b.side);   // a、b：{ text, side, reg }
  const sameSay = n => '提示词和素材都和出过片的「' + n + '」一样：一处没改的不存成新的一版。改了提示词或换了素材再存';
  /* 存稿前再问一声（draft-store.js、server.js 的 PUT）：abs 是另存出来的一版（上一版出过片），这回要存的字和素材又和上一版一模一样，给拦下的话；别的给 ''。
     side：要存的写稿资料（不给就照文件里的）。读不了上一版、映射的不拦（拦下要有把握） */
  async function twin(abs, text, side) {
    const at = promptAt(abs);
    if (!at || !Core.vpVer(at.n)) return '';   // 原稿（不带 _改N）没有上一版
    try {
      const st = await segState(at.p, at.s), prev = prevOf(st, at.n);
      if (!prev || !stateOf(st, prev).出过片) return '';
      const map = await readMap(at.p);
      const was = { text: await fsp.readFile(pj(at.p, '提示词', segDir(at.s), prev), 'utf8'), side: await readSide(at.p, at.s, prev), reg: regOf(map, at.s, prev) };
      return same({ text, side: side || await readSide(at.p, at.s, at.n), reg: regOf(map, at.s, at.n) }, was) ? sameSay(prev) : '';
    } catch (e) { log('比上一版没比成（' + at.n + '）：' + e.message); return ''; }
  }

  async function writeAtomic(p, text) {
    const tmp = p + '.antou-tmp';
    await fsp.writeFile(tmp, text);
    try { await fsp.rename(tmp, p); } catch (e) { await fsp.unlink(tmp).catch(() => {}); throw e; }
  }
  async function writeNew(p, text) {   // 新建：先写在旁边再挂上去，那里已经有了不盖
    const tmp = p + '.antou-tmp';
    await fsp.writeFile(tmp, text);
    try { await fsp.link(tmp, p); }
    catch (e) { if (e.code === 'EEXIST') throw err(409, '「' + path.basename(p) + '」刚有了：刷新再试'); throw e; }
    finally { await fsp.unlink(tmp).catch(() => {}); }
  }
  async function copyKeep(a, b) {   // 照抄，修改时间照旧（AI 改的另存：写稿资料和原稿一样）
    const st = await fsp.stat(a);
    await fsp.copyFile(a, b, fs.constants.COPYFILE_EXCL);
    await fsp.utimes(b, st.atimeMs / 1000, st.mtimeMs / 1000);
  }
  /* 参考素材映射：这一条的登记抄到新名字下（指纹、秒数照抄，批准出片时照新的字补）。没有映射、没登记的不抄；映射读不了就不另存 */
  async function cloneReg(p, s, n, to) {
    const mp = pj(p, '资产', '参考素材映射.json');
    let raw;
    try { raw = await fsp.readFile(mp, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
    let map;
    try { map = JSON.parse(unbom(raw)); } catch (e) { throw err(409, '参考素材映射读不了（' + e.message + '），这回没另存'); }
    const ps = map && map.prompts, k0 = ['提示词', segDir(s), n].join('/'), k1 = ['提示词', segDir(s), to].join('/');
    if (!own(ps, k0)) return false;
    ps[k1] = JSON.parse(JSON.stringify(ps[k0]));
    await writeAtomic(mp, JSON.stringify(map, null, 2) + '\n');
    return true;
  }
  /* 另存成下一版：这一版出过片、是这一条最新的一版、没在出片。text：新的一版的字；side：写稿页给的写稿资料那几样（AI 改的不给，整份照抄原稿的）。
     字和素材都和这一版一样的不另存（422） */
  async function fork(p, s, n, { text, side = null } = {}) {
    if (!Core.nameOk(p) || !segOk(s) || !vpOk(n)) throw err(400, '项目、段、提示词的名字不对');
    if (typeof text !== 'string') throw err(400, '另存要带上新的一版的字');
    if (side !== null) checkSide(side, '另存');
    const first = await state(p, s, n);
    if (!first.出过片) throw err(409, '这一版还没出片，直接改就行');
    if (first.不能另存) throw err(409, first.不能另存);
    const to = first.下一版, A = stemOf(n), B = stemOf(to), dir = pj(p, '提示词', segDir(s)), P = x => path.join(dir, x);
    return withLocks([P(n), P(A + '_写稿.json'), P(to), P(B + '_写稿.json'), pj(p, '资产', '参考素材映射.json')], async () => {   // 和存稿、改登记共用一把锁
      const st = await segState(p, s), f = stateOf(st, n);   // 拿到锁以后再看一遍
      if (f.不能另存 || f.下一版 !== to) throw err(409, f.不能另存 || '这一条刚有了新的一版：刷新再试');
      const old = await readSide(p, s, n), reg = regOf(await readMap(p), s, n), mine = side ? { ...old, ...side } : null;   // mine：写稿页给的那几样换上，别的照原稿
      if (same({ text, side: mine || old, reg }, { text: await fsp.readFile(P(n), 'utf8'), side: old, reg })) throw err(422, sameSay(n));
      const made = [];
      try {
        await writeNew(P(to), text); made.push(P(to));
        if (mine) { await writeNew(P(B + '_写稿.json'), JSON.stringify(mine, null, 2) + '\n'); made.push(P(B + '_写稿.json')); }
        else if (st.files.has(A + '_写稿.json')) { await copyKeep(P(A + '_写稿.json'), P(B + '_写稿.json')); made.push(P(B + '_写稿.json')); }
        await cloneReg(p, s, n, to);
      } catch (e) {
        for (const x of made.reverse()) await fsp.unlink(x).catch(() => {});
        throw e.status ? e : err(500, '没另存成：' + e.message);
      }
      const moved = [], left = [];
      const mv = async (lab, work) => { try { await work(); moved.push(lab); } catch (e) { left.push(lab); log('另存时' + lab + '没挪过去：' + e.message); } };
      if (st.files.has(A + '_AI批注.md')) await mv('AI 批注', () => fsp.rename(P(A + '_AI批注.md'), P(B + '_AI批注.md')));
      log('出过片，另存成新的一版：' + [p, '提示词', segDir(s), n].join('/') + ' → ' + to + (mine ? '（写稿页改的）' : '') + (moved.length ? '（' + moved.join('、') + '跟着挪过去）' : ''));
      const out = { 名: to, 挪了: moved, 没挪: left };
      if (mine) Object.assign(out, { side: mine, mtime: Math.floor((await fsp.stat(P(to))).mtimeMs), sideMtime: Math.floor((await fsp.stat(P(B + '_写稿.json'))).mtimeMs) });   // 写稿页照它接着存
      return out;
    });
  }

  async function handle(req, res, url, { json, readBody }) {
    const q = url.searchParams, p = str(q.get('p')), s = str(q.get('s')), n = q.has('n') ? str(q.get('n')) : null;
    if (!Core.nameOk(p) || !segOk(s) || (n !== null && !vpOk(n))) throw err(400, '要写项目 p、段 s，一版的名字 n');
    if (req.method === 'GET') {
      const st = await segState(p, s);
      if (n !== null) return json(res, stateOf(st, n));
      const 版 = {};
      for (const x of st.files) if (vpOk(x)) { const f = stateOf(st, x); if (f.出过片) 版[x] = f; }
      return json(res, { 版 });
    }
    if (req.method === 'POST' && n !== null && readBody) {   // 写稿页另存：带着改好的字、写稿资料那几样
      let body;
      try { body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8')); }
      catch (e) { if (e.status) throw e; throw err(400, '另存的请求不是有效 JSON'); }
      const side = body && body.side;
      if (!body || typeof body.text !== 'string' || !side || typeof side !== 'object' || Array.isArray(side)) throw err(400, '另存要带上 text、side');
      return json(res, await fork(p, s, n, { text: body.text, side }));
    }
    throw err(405, '只能问，或者带着改好的字另存（POST，写 n）');
  }
  return { promptAt, state, say, frozen, twin, fork, handle };
};
