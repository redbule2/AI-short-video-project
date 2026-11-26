'use strict';
/* 提示词和它出的样片同进同出（2026-11-26 他定：「提示词和对应生成的成片，必须保持一致，如果成片在历史记录，那么提示词也应该进历史记录，反之……」；
   又问「其他 agent 移动，或者人为移动怎么办」）。不管谁挪的（流水线、别的 AI、人在文件夹里拖），本机服务开着就盯着各项目的
   提示词、成片 和 历史记录 里的这两处：哪一段动了，静下来 20 秒再对一遍（对法在 公用/历史记录.js 的 pairs），对不上的只往历史记录里跟：
     提示词还在用、它出的片全进了历史记录 → 提示词连写稿资料、批注、AI 批注、出片任务书、批注截图收进 历史记录/提示词/第N段，名字加同一个 __时间；
     片还在成片、出它的那一版提示词只在历史记录 → 片连它的批注、截图收进 历史记录/成片/第N段，名字不改。
   要拿回来，提示词和片一起拿；只拿回一样，静下来以后又会收回去。正在出片的那一版、AI 正在照它做事的片不动；那里有同名的不盖，记下没挪。
   服务开起来先把各项目对一遍（服务关着的时候挪的也补上）。审片弹窗「这条不要了」挪完片子马上叫一次（POST）。
   接口（server.js 查过 X-Antou）：
     GET  /api/pairs?p=项目&s=段   这一段对不上的 { a, b }
     POST /api/pairs?p=项目&s=段   马上理一遍：{ 提示词: [收进去的提示词], 片: [收进去的片], 挪了: [...], 没挪: [...] }
   测试：node --test 通用工具/测试/同进同出_测试.cjs */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

module.exports = function makePairs({ ROOT, TOOLS, filmed, log = () => {}, withLocks = (paths, fn) => fn(), quiet = 20e3, clock = () => new Date() }) {
  const Core = require(path.join(TOOLS, '公用', '核心.js'));
  const ClipOf = require(path.join(TOOLS, '公用', '样片归属.js'));
  const Hist = require(path.join(TOOLS, '公用', '历史记录.js'));
  const HOME = path.join(ROOT, '项目');
  const segDir = s => '第' + s + '段';
  const segOk = s => /^[0-9]+(?:-[0-9]+)*$/.test(s);
  const err = (status, msg) => Object.assign(new Error(msg), { status });
  const at = (p, ...parts) => path.join(HOME, p, ...parts);
  async function ls(dir) {
    try { return (await fsp.readdir(dir, { withFileTypes: true })).map(e => ({ name: e.name, dir: e.isDirectory() })); }
    catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return []; throw e; }
  }
  const exists = p => fsp.stat(p).then(() => true, () => false);
  /* 这一段现在什么样（filmed.js 的 seg：提示词文件夹、两处的样片、改名、在做的任务），加上历史记录里的提示词；found 是对不上的 */
  async function look(p, s) {
    const st = await filmed.seg(p, s), olds = (await ls(at(p, '历史记录', '提示词', segDir(s)))).filter(x => !x.dir).map(x => x.name);
    const found = Hist.pairs({ curs: [...st.files], olds, here: st.clips.filter(c => !c.old).map(c => c.name), hist: st.clips.filter(c => c.old).map(c => c.name), rn: st.rn });
    return { st, found };
  }
  const scan = async (p, s) => (await look(p, s)).found;

  /* 理一遍：同一段一回只理一次，排着队来 */
  const queue = new Map();
  function settle(p, s, why = '') {
    const k = p + '|' + s, run = (queue.get(k) || Promise.resolve()).catch(() => {}).then(() => settleNow(p, s, why));
    queue.set(k, run);
    run.then(() => { if (queue.get(k) === run) queue.delete(k); }, () => { if (queue.get(k) === run) queue.delete(k); });
    return run;
  }
  async function settleNow(p, s, why) {
    const out = { 提示词: [], 片: [], 挪了: [], 没挪: [] };
    const { st, found } = await look(p, s);
    if (!found.a.length && !found.b.length) return out;
    const d = segDir(s), stamp = Hist.stampOf(clock());
    const move = async (from, to) => {   // 那里有同名的不盖
      if (await exists(to)) throw new Error('那里已经有同名的了');
      await fsp.mkdir(path.dirname(to), { recursive: true });
      await fsp.rename(from, to);
    };
    const filming = n => st.jobs.some(j => (j.事 === '出片任务书' && j.名 === n) || (j.事 === '出片' && Core.taskVp(String(j.名 || '')) === n));
    /* 提示词还在用、片全在历史记录：提示词先挪，挪不动整份不挪；跟着它的几样一样一样挪 */
    for (const { name } of found.a) {
      if (filming(name)) { out.没挪.push('提示词「' + name + '」正在出片，出完再收'); continue; }
      const src = at(p, '提示词', d), dst = at(p, '历史记录', '提示词', d), kin = Hist.promptKin(name, [...st.files]);
      await withLocks([name, ...kin.map(x => x[0])].map(n => path.join(src, n)), async () => {
        try { await move(path.join(src, name), path.join(dst, Hist.dated(name, stamp))); }
        catch (e) { out.没挪.push('提示词「' + name + '」：' + e.message); return; }
        out.提示词.push(name);
        out.挪了.push(['提示词', d, name].join('/') + ' → ' + ['历史记录', '提示词', d, Hist.dated(name, stamp)].join('/'));
        for (const [n, lab] of kin) {
          try { await move(path.join(src, n), path.join(dst, Hist.dated(n, stamp))); out.挪了.push(['提示词', d, n].join('/') + ' → 历史记录（' + lab + '）'); }
          catch (e) { out.没挪.push(lab + '「' + n + '」：' + e.message); }
        }
      });
    }
    /* 片还在成片、提示词只在历史记录：片连它的批注、截图收进去，名字不改 */
    if (found.b.length) {
      const names = (await ls(at(p, '成片', d))).map(x => x.name);
      for (const { vid } of found.b) {
        if (st.jobs.some(j => j.视频 === vid)) { out.没挪.push('片「' + vid + '」AI 正在照它做事，做完再收'); continue; }
        try { await move(at(p, '成片', d, vid), at(p, '历史记录', '成片', d, vid)); }
        catch (e) { out.没挪.push('片「' + vid + '」：' + e.message + (/同名/.test(e.message) ? '' : '（剪映开着它的话先关掉）')); continue; }
        out.片.push(vid);
        out.挪了.push(['成片', d, vid].join('/') + ' → ' + ['历史记录', '成片', d, vid].join('/'));
        for (const n of ClipOf.ownKin(vid, names)) {
          try { await move(at(p, '成片', d, n), at(p, '历史记录', '成片', d, n)); out.挪了.push(['成片', d, n].join('/') + ' → 历史记录'); }
          catch (e) { out.没挪.push('「' + n + '」：' + e.message); }
        }
      }
    }
    if (out.挪了.length || out.没挪.length) log('提示词和样片同进同出（' + p + ' 第' + s + '段' + (why ? '，' + why : '') + '）：' + [...out.挪了, ...out.没挪.map(x => '没挪：' + x)].join('；'));
    return out;
  }

  /* 各项目各段都对一遍（服务开起来时：关着的时候挪的也补上） */
  async function sweep(why = '') {
    for (const pe of await ls(HOME)) {
      if (!pe.dir || !Core.nameOk(pe.name)) continue;
      const segs = new Set();
      for (const rel of [['提示词'], ['成片'], ['历史记录', '提示词'], ['历史记录', '成片']]) {
        for (const e of await ls(at(pe.name, ...rel))) { const m = e.dir && /^第(.+)段$/.exec(e.name); if (m && segOk(m[1])) segs.add(m[1]); }
      }
      for (const s of segs) { try { await settle(pe.name, s, why); } catch (e) { log('提示词和样片同进同出没理成（' + pe.name + ' 第' + s + '段）：' + e.message); } }
    }
  }

  /* 盯着文件夹：项目名/提示词|成片/第N段/…，项目名/历史记录/提示词|成片/第N段/…；一段静下来 quiet 毫秒再理 */
  const timers = new Map();
  function poke(p, s) {
    const k = p + '|' + s;
    clearTimeout(timers.get(k));
    const t = setTimeout(() => { timers.delete(k); settle(p, s, '有文件挪过').catch(e => log('提示词和样片同进同出没理成（' + p + ' 第' + s + '段）：' + e.message)); }, quiet);
    if (t.unref) t.unref();
    timers.set(k, t);
  }
  function seen(rel) {
    const parts = String(rel || '').split(/[\\/]/).filter(Boolean);
    let i = 1;
    if (parts[i] === '历史记录') i++;
    const m = (parts[i] === '提示词' || parts[i] === '成片') && /^第(.+)段$/.exec(parts[i + 1] || '');
    if (!m || !segOk(m[1]) || parts.length < i + 3 || !Core.nameOk(parts[0]) || /\.antou-tmp$/i.test(rel)) return null;
    return { p: parts[0], s: m[1] };
  }
  let watcher = null, closed = false;
  function watch({ sweepAfter = 5e3 } = {}) {
    if (closed) return;
    try {
      watcher = fs.watch(HOME, { recursive: true, persistent: false }, (ev, rel) => { const x = seen(rel); if (x) poke(x.p, x.s); });
      watcher.on('error', e => { log('盯 项目 文件夹出错（' + e.message + '），一分钟后再盯'); try { watcher.close(); } catch (x) { /* 已经关了 */ } again(); });
    } catch (e) { log('盯不了 项目 文件夹（' + e.message + '），一分钟后再试'); again(); return; }
    if (sweepAfter >= 0) { const t = setTimeout(() => sweep('本机服务开起来对一遍').catch(e => log('提示词和样片同进同出没对成：' + e.message)), sweepAfter); if (t.unref) t.unref(); }
  }
  function again() { if (closed) return; const t = setTimeout(() => watch({ sweepAfter: 0 }), 60e3); if (t.unref) t.unref(); }
  function close() { closed = true; try { if (watcher) watcher.close(); } catch (e) { /* 已经关了 */ } for (const t of timers.values()) clearTimeout(t); timers.clear(); }

  async function handle(req, res, url, { json }) {
    const q = url.searchParams, p = String(q.get('p') || ''), s = String(q.get('s') || '');
    if (!Core.nameOk(p) || !segOk(s)) throw err(400, '要写项目 p、段 s');
    if (req.method === 'GET') return json(res, await scan(p, s));
    if (req.method === 'POST') return json(res, await settle(p, s, '流水线叫的'));
    throw err(405, '只能看（GET）或马上理一遍（POST）');
  }
  return { scan, settle, sweep, watch, close, handle, seen };
};
