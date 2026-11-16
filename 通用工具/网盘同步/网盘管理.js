// 网盘管理：项目管理（流水线）里「网盘」那一页的后台。挂在项目管理服务（.agents/skills/annotate-live/server.js）的 /api/wangpan/ 下面，
// 跟着项目管理服务一起开，自己不单独开。只管「项目」文件夹，一次看一个项目：
//   · 每个文件本机和网盘上一不一样：没传上去、本机改过、网盘上的新、只在网盘、两边都改过；
//   · 上传＝把本机这份传上去；下载＝把网盘上那份拿下来；删除＝只删网盘上的，本机的不动；
//   · 网盘「旧版」里这个项目换下来、删掉的，能拿回本机、能彻底删掉；网盘上有、本机没有的项目，能整个拉下来。
// 和推送、拉取一起用也不会乱：
//   · 网盘上被换掉、被删的，先放进「旧版」（删的时候可以选彻底删掉）；本机被换掉的，先挪进这个项目的「历史记录」（同样的位置，名字后面加时间）；
//   · 传完、拿完两边一样的，记进这台电脑的对账记录（和推送、拉取是同一份）；网盘上删掉的从记录里拿掉，本机还有的下次推送会再传上去；
//   · 推送、拉取在跑的时候这里只能看；这里在传、在删的时候，推送、拉取等着（共用一把锁）。
'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const S = require('./网盘同步.js');
const { COMMON, rcAsync, listFile, dropList, sum, under, sameL, sameContent } = S;   // 和推送、拉取共用的，只在 网盘同步.js 写一份

const PROJ = '项目', OLD = '旧版', HIST = '历史记录';
const PRICE_STORE = 0.12; // 元/GB/月：阿里云官网标价，标准存储（本地冗余）
const BAD_SEG = /^\.+$|[<>:"\\/|?*\u0000-\u001f]|[. ]$/;   // Windows 文件名里不许有的
const R = p => `${S.ALIAS}:${p}`;
const inHist = r => r.startsWith(HIST + '/');
// 记录里一项：[本机大小, 本机修改时间, 网盘大小, 网盘收到的时间]（和 网盘同步.js 一样；这里网盘上的时间叫 stime）
const sameC = (c, m) => !!m && c.size === m[2] && c.stime === m[3];

class Bad extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }

// 名字、路径：只能是项目里的相对路径，用 / 隔开
const seg = s => typeof s === 'string' && s !== '' && !BAD_SEG.test(s);
function relOf(s, allowEmpty) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!t) return allowEmpty ? '' : null;
  const parts = t.split('/');
  return parts.every(seg) ? parts.join('/') : null;
}
function projOf(b) {
  const p = typeof b.p === 'string' ? b.p.trim() : '';
  if (!seg(p) || p.startsWith('.')) throw new Bad('项目名不对。');
  return p;
}
function namesOf(b) {
  const a = Array.isArray(b.names) ? b.names : [];
  const out = [];
  for (const n of a) { const r = relOf(n, true); if (r === null) throw new Bad('选的东西名字不对。'); out.push(r); }
  if (!out.length) throw new Bad('没选东西。');
  return [...new Set(out)];
}

module.exports = function mount(opt = {}) {
  const LOCAL = path.resolve(opt.local || S.LOCAL);
  // 对账记录只认 网盘同步.js 管的那个「项目」文件夹：拿别的文件夹试页面时不碰记录
  const MAN = LOCAL.toLowerCase() === path.resolve(S.LOCAL).toLowerCase();
  const say = opt.log || (() => {});

  // ---------- 网盘设置好了没有（问一次 rclone 要一会儿，记半分钟） ----------
  let tgt = { at: 0, v: null };
  function target() {
    if (Date.now() - tgt.at > 30e3) tgt = { at: Date.now(), v: fs.existsSync(S.RCLONE) ? S.aliasTarget() : null };
    return tgt.v;
  }

  // ---------- 和推送、拉取共用的锁 ----------
  const lockPid = () => { try { return Number(fs.readFileSync(S.LOCK_FILE, 'utf8').trim()) || 0; } catch { return 0; } };
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
  const engineBusy = () => { const pid = lockPid(); return !!pid && pid !== process.pid && alive(pid); };
  let lockRefs = 0, lockTimer = null;
  function acquire() {
    clearTimeout(lockTimer);
    lockTimer = null;
    if (lockPid() !== process.pid) {
      fs.mkdirSync(S.STATE_DIR, { recursive: true });
      try { fs.writeFileSync(S.LOCK_FILE, String(process.pid), { flag: 'wx' }); }
      catch {
        if (engineBusy()) throw new Bad('推送或拉取正在跑，等它跑完再来。', 409);
        fs.writeFileSync(S.LOCK_FILE, String(process.pid)); // 旧锁：那个进程已经不在了
      }
    }
    lockRefs++;
  }
  function release() {
    lockRefs = Math.max(0, lockRefs - 1);
    if (lockRefs) return;
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => { lockTimer = null; if (!lockRefs) dropLock(); }, 5000);
  }
  function dropLock() { try { if (lockPid() === process.pid) fs.rmSync(S.LOCK_FILE); } catch {} }
  process.on('exit', dropLock);

  // ---------- 这台电脑的对账记录（改的时候要拿着锁） ----------
  function manFiles() {
    if (!MAN) return {};
    const st = S.loadState();
    return st && st.target === target() && st.files ? st.files : {};
  }
  function manEdit(fn) {
    if (!MAN) return;
    const t = target();
    if (!t) return;
    let st = S.loadState();
    if (st && st.target !== t) return;   // 网盘换过了：推送、拉取会自己从头来，这里不动
    if (!st) st = { v: 1, target: t, scope: null, files: {} };
    if (!st.files) st.files = {};
    fn(st.files);
    S.saveState(st);
  }
  function manTry(fn) {   // 顺手记一笔：推送、拉取在跑就算了，下回再记
    if (!MAN || engineBusy()) return;
    try { acquire(); } catch { return; }
    try { manEdit(fn); } catch {} finally { release(); }
  }

  // ---------- 两边的清单 ----------
  async function scanLocal(p) {
    const out = new Map();
    const walk = async (dir, rel) => {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      await Promise.all(ents.map(async e => {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { if (!S.SKIP_DIR.some(x => x.test(e.name))) await walk(path.join(dir, e.name), r); }
        else if (e.isFile() && !S.SKIP_FILE.some(x => x.test(e.name))) {
          try { const st = await fsp.stat(path.join(dir, e.name)); out.set(r, { size: st.size, mtime: Math.round(st.mtimeMs) }); } catch {}
        }
      }));
    };
    await walk(path.join(LOCAL, p), '');
    return out;
  }
  const statNow = (p, r) => { try { const s = fs.statSync(path.join(LOCAL, p, ...r.split('/'))); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch { return null; } };
  // 网盘上这个文件夹里的：大小、网盘收到的时间（列清单就有，不用一个一个问）
  async function lsCloud(dir) {
    const r = await rcAsync(['lsjson', '-R', '--files-only', '--no-mimetype', '--fast-list', '--use-server-modtime', R(dir)]);
    if (r.code === 3) return new Map();
    if (r.code !== 0) throw new Bad(`读网盘没成功：${S.hint(r.err)}`, 502);
    const m = new Map();
    for (const o of JSON.parse(r.out || '[]')) if (!o.IsDir && !S.skipped(o.Path)) m.set(o.Path, { size: o.Size, stime: Date.parse(o.ModTime) });
    return m;
  }
  // 这几个文件原来的修改时间（要一个一个问网盘，只给说不准的用）
  async function metaTimes(p, rels) {
    const m = new Map();
    if (!rels.length) return m;
    const lf = listFile(rels.map(r => `${p}/${r}`));
    try {
      const r = await rcAsync(['lsjson', '-R', '--files-only', '--no-mimetype', '--checkers', '16', '--files-from-raw', lf, R(PROJ)]);
      if (r.code !== 0 && r.code !== 3) return m;
      for (const o of JSON.parse(r.out || '[]')) if (o.Path.startsWith(p + '/')) m.set(o.Path.slice(p.length + 1), { size: o.Size, mtime: Date.parse(o.ModTime) });
    } catch {} finally { dropList(lf); }
    return m;
  }
  // 本机、网盘各有什么，每个文件算一个结果：
  //   same 一样 · local 没传上去 · lnew 本机改过 · cloud 只在网盘 · cnew 网盘上的新 · both 两边都改过（或说不准哪边新）
  async function compare(p) {
    const [local, cloud] = await Promise.all([scanLocal(p), lsCloud(`${PROJ}/${p}`)]);
    const man = manFiles(), rows = new Map(), unsure = [];
    for (const r of new Set([...local.keys(), ...cloud.keys()])) {
      const l = local.get(r), c = cloud.get(r), m = man[`${p}/${r}`];
      let s;
      if (l && c) {
        const lc = !sameL(l, m), cc = !sameC(c, m);
        if (m && !lc && !cc) s = 'same';
        else if (m && !lc) s = 'cnew';
        else if (m && !cc) s = 'lnew';
        else { s = '?'; unsure.push(r); }   // 没记录，或两边都变了：问网盘原来的修改时间，一样就当同一份
      } else s = l ? 'local' : 'cloud';
      rows.set(r, { l, c, s });
    }
    if (unsure.length) {
      const meta = await metaTimes(p, unsure), adopt = [];
      for (const r of unsure) {
        const x = rows.get(r), c = meta.get(r);
        if (c && sameContent(x.l, c)) { x.s = 'same'; adopt.push(r); }
        else if (man[`${p}/${r}`] || !c) x.s = 'both';
        else x.s = c.mtime > x.l.mtime ? 'cnew' : 'lnew';
      }
      if (adopt.length) manTry(f => { for (const r of adopt) { const x = rows.get(r); f[`${p}/${r}`] = [x.l.size, x.l.mtime, x.c.size, x.c.stime]; } });
    }
    return rows;
  }
  const pickOf = (rows, names) => [...rows].filter(([r]) => names.some(n => under(r, n)));
  async function cloudProjects() {
    const r = await rcAsync(['lsjson', '--dirs-only', '--no-mimetype', R(PROJ)]);
    if (r.code !== 0) return [];
    try { return JSON.parse(r.out || '[]').map(o => o.Path).filter(n => seg(n) && !n.startsWith('.')); } catch { return []; }
  }
  async function countFragments() {
    const t = target();
    if (!t) return 0;
    const r = await rcAsync(['backend', 'list-multipart-uploads', t]);
    if (r.code !== 0) return 0;
    try { return Object.values(JSON.parse(r.out)).reduce((n, a) => n + (Array.isArray(a) ? a.length : 0), 0); } catch { return 0; }
  }
  // 网盘「旧版」里这个项目的：旧版/<时间>_<怎么来的>/<项目>/<路径> → [时间_怎么来的, 路径, 大小, 放进去的时间]
  async function oldOf(p) {
    const all = await lsCloud(OLD), out = [];
    for (const [k, c] of all) {
      const i = k.indexOf('/'), j = k.indexOf('/', i + 1);
      if (i < 0 || j < 0 || k.slice(i + 1, j) !== p) continue;
      out.push([k.slice(0, i), k.slice(j + 1), c.size, c.stime]);
    }
    return out;
  }

  // ---------- 后台的活：一次只做一件 ----------
  const jobs = [];
  let seq = 0, claimed = false;
  const running = () => jobs.find(j => j.state === 'running');
  async function exclusive(fn) {
    if (claimed || running()) throw new Bad('上一件还没做完，等它做完再来。', 409);
    if (!target()) throw new Bad('这台电脑还没设置网盘。', 409);
    if (engineBusy()) throw new Bad('推送或拉取正在跑，等它跑完再来。', 409);
    claimed = true;
    try { return await fn(); } finally { claimed = false; }
  }
  function newJob(o) {
    const j = { id: ++seq, state: 'running', started: Date.now(), bytes: 0, totalBytes: 0, done: 0, total: 0, speed: 0, eta: null, errors: [], nErrors: 0, notes: [], ...o };
    jobs.push(j);
    while (jobs.length > 30) { const k = jobs.findIndex(x => x.state !== 'running'); if (k < 0) break; jobs.splice(k, 1); }
    return j;
  }
  const pub = j => { const { proc, bytes0, ...o } = j; return o; };
  function finishJob(job, ok) {
    job.state = job.stopped ? 'stopped' : ok ? 'done' : 'failed';
    job.ended = Date.now();
    job.speed = 0;
    job.eta = null;
  }
  // 跑一条 rclone，进度记进 job；count(stats) = 这一步做完了几个
  function rcJob(job, args, count) {
    return new Promise(res => {
      if (job.stopped) return res(-2);
      const p = S.rcSpawn(args);
      job.proc = p;
      const base = job.done, b0 = job.bytes0 || 0;
      p.stdout.resume();
      S.rcLog(p.stderr, {
        stats: s => {
          if (count) job.done = base + count(s);
          if (job.moves) { job.bytes = b0 + (s.bytes || 0); job.speed = s.speed || 0; job.eta = s.eta ?? null; }
        },
        error: o => {
          job.nErrors++;
          if (job.errors.length < 20) job.errors.push(`${o.object ? o.object + '：' : ''}${o.msg}`);
        },
      });
      p.on('error', e => { job.nErrors++; job.errors.push(String(e)); job.proc = null; res(-1); });
      p.on('close', code => { job.proc = null; job.bytes0 = job.bytes; res(code); });
    });
  }
  function stopJob(id) {
    const j = jobs.find(x => x.id === Number(id));
    if (!j || j.state !== 'running') return;
    j.stopped = true;
    if (j.proc) j.proc.kill();
  }
  // 拿到一半停了：rclone 在本机留下的 名字.xxxx.partial 收拾掉
  function dropPartials(p, rels) {
    const dirs = new Map();
    for (const r of rels) {
      const i = r.lastIndexOf('/'), d = path.join(LOCAL, p, ...(i < 0 ? [] : r.slice(0, i).split('/')));
      if (!dirs.has(d)) dirs.set(d, new Set());
      dirs.get(d).add(i < 0 ? r : r.slice(i + 1));
    }
    for (const [d, names] of dirs) {
      let ents = [];
      try { ents = fs.readdirSync(d); } catch { continue; }
      for (const e of ents) if (/\.partial$/i.test(e) && [...names].some(n => e.startsWith(n + '.'))) try { fs.rmSync(path.join(d, e), { force: true }); } catch {}
    }
  }
  // 拿下来：rels 是项目里的路径，src 是网盘上对着这个项目的那个文件夹。
  // 本机那份不一样的，先挪进这个项目的「历史记录」（同样的位置，名字后面加时间）；本来就在历史记录里的，在旁边改名留着
  async function fetchInto(job, p, src, rels, sfx) {
    const dst = path.join(LOCAL, p);
    fs.mkdirSync(dst, { recursive: true });
    const had = new Set(rels.filter(r => statNow(p, r)));
    const keep = ['--suffix', sfx, '--suffix-keep-extension'];
    for (const [list, extra] of [[rels.filter(r => !inHist(r)), ['--backup-dir', path.join(dst, HIST)]], [rels.filter(inHist), []]]) {
      if (!list.length || job.stopped) continue;
      const lf = listFile(list);
      await rcJob(job, ['copy', R(src), dst, '--files-from-raw', lf, '--ignore-times', ...extra, ...keep], s => s.transfers || 0);
      dropList(lf);
    }
    if (job.stopped) dropPartials(p, rels);
    // 停了、没拿成的：本机原来那份已经先挪走了，挪回原处（rclone 先挪旧的、再拿新的）
    for (const r of had) {
      if (statNow(p, r)) continue;
      const segs = r.split('/'), base = segs.pop(), ext = path.extname(base);
      const bak = path.join(dst, ...(inHist(r) ? [] : [HIST]), ...segs, base.slice(0, base.length - ext.length) + sfx + ext);
      try { fs.renameSync(bak, path.join(dst, ...segs, base)); } catch { continue; }
      if (inHist(r)) continue;
      // 挪旧的时在「历史记录」里建出来的空文件夹，一层层收掉（「历史记录」本身留着）
      for (let d = path.dirname(bak), top = path.join(dst, HIST); d.length > top.length && d.startsWith(top); d = path.dirname(d)) {
        try { fs.rmdirSync(d); } catch { break; }
      }
    }
  }
  const nameOf = (names, n) => names.length === 1 ? `「${names[0] ? names[0].split('/').pop() : '整个项目'}」` : ` ${n} 个`;

  // ---------- 上传：本机这份传上去；网盘上不一样的那份先放进「旧版」 ----------
  async function up(b) {
    const p = projOf(b), names = namesOf(b);
    if (!fs.existsSync(path.join(LOCAL, p))) throw new Bad('这台电脑没有这个项目。');
    return exclusive(async () => {
      const pick = new Map(pickOf(await compare(p), names).filter(([, x]) => x.l && x.s !== 'same'));
      if (!pick.size) return { nothing: '选的这些两边已经一样了，不用传。' };
      acquire();
      const ts = S.stamp(), bdir = `${OLD}/${ts}_网盘管理上传`, list = [...pick];
      const over = list.filter(([, x]) => x.c).length, planBytes = sum(list, ([, x]) => x.l.size);
      const job = newJob({ kind: 'up', p, req: { kind: 'up', p, names }, moves: true, total: pick.size, planBytes, totalBytes: planBytes,
        title: `上传${nameOf(names, pick.size)}` });
      (async () => {
        let ok = 0, moved = 0;
        try {
          const lf = listFile(list.map(([r]) => `${p}/${r}`));
          await rcJob(job, ['copy', LOCAL, R(PROJ), '--files-from-raw', lf, '--ignore-times', ...(over ? ['--backup-dir', R(bdir)] : [])], s => s.transfers || 0);
          dropList(lf);
          let cloud2 = await lsCloud(`${PROJ}/${p}`);
          // 停了、没传成的：网盘上原来那份已经先挪进「旧版」，挪回原处（rclone 先挪旧的、再传新的）
          const lost = list.filter(([r, x]) => x.c && !cloud2.has(r));
          if (lost.length) {
            const lf2 = listFile(lost.map(([r]) => `${p}/${r}`));
            await rcAsync(['move', R(bdir), R(PROJ), '--files-from-raw', lf2, ...COMMON]);
            dropList(lf2);
            cloud2 = await lsCloud(`${PROJ}/${p}`);
          }
          // 大文件分块传到一半停了：网盘上留下的碎片当场清掉
          const t = target();
          for (const [r, x] of list) if (x.l.size >= 100 << 20 && !(cloud2.get(r) && cloud2.get(r).size === x.l.size)) await rcAsync(['backend', 'cleanup', `${t}/${PROJ}/${p}/${r}`, '-o', 'max-age=1s']);
          // 核对：网盘上大小对上了、网盘收到的时间变了，才算传上去，记进对账记录（挪回原处的那几个是原来那份，不算）
          const done = [], back = new Set(lost.map(([r]) => r));
          for (const [r, x] of list) {
            if (back.has(r)) continue;
            const c2 = cloud2.get(r), l2 = statNow(p, r);
            if (c2 && l2 && c2.size === l2.size && (!x.c || c2.stime !== x.c.stime || c2.size !== x.c.size)) done.push([r, l2, c2]);
          }
          manEdit(f => { for (const [r, l2, c2] of done) f[`${p}/${r}`] = [l2.size, l2.mtime, c2.size, c2.stime]; });
          ok = job.done = done.length;
          moved = done.filter(([r]) => pick.get(r).c).length;
          if (moved) job.notes.push(`网盘上换下来的 ${moved} 个放进了「旧版」`);
        } catch (e) { job.errors.push(String(e.message || e)); }
        finishJob(job, ok === pick.size);
        release();
        S.writeLog(`网盘管理：上传 ${p} 的 ${ok}/${pick.size} 个（${S.fmtSize(planBytes)}）${moved ? `，网盘上原来的 ${moved} 个放进 ${bdir}` : ''}`);
      })();
      return { id: job.id };
    });
  }

  // ---------- 下载：网盘上那份拿下来；本机不一样的那份先挪进「历史记录」 ----------
  async function down(b) {
    const p = projOf(b), names = namesOf(b);
    return exclusive(async () => {
      let list = pickOf(await compare(p), names).filter(([, x]) => x.c && x.s !== 'same');
      if (b.noHist) list = list.filter(([r]) => !inHist(r));
      if (!list.length) return { nothing: '选的这些两边已经一样了，不用拿。' };
      acquire();
      const pick = new Map(list), ts = S.stamp(), planBytes = sum(list, ([, x]) => x.c.size);
      const whole = names.length === 1 && names[0] === '' && !fs.existsSync(path.join(LOCAL, p));
      const job = newJob({ kind: 'down', p, req: { kind: 'down', p, names, noHist: !!b.noHist }, moves: true, total: pick.size, planBytes, totalBytes: planBytes,
        title: whole ? `拉下整个「${p}」` : `下载${nameOf(names, pick.size)}`, whole });
      (async () => {
        let ok = 0, moved = 0;
        try {
          await fetchInto(job, p, `${PROJ}/${p}`, [...pick.keys()], `__${ts}`);
          const done = [];
          for (const [r, x] of list) { const l2 = statNow(p, r); if (l2 && l2.size === x.c.size && (!x.l || l2.mtime !== x.l.mtime || l2.size !== x.l.size)) done.push([r, l2, x.c]); }
          manEdit(f => { for (const [r, l2, c] of done) f[`${p}/${r}`] = [l2.size, l2.mtime, c.size, c.stime]; });
          ok = job.done = done.length;
          moved = done.filter(([r]) => pick.get(r).l).length;
          if (moved) job.notes.push(`本机换下来的 ${moved} 个挪进了这个项目的「${HIST}」，名字后面加了 __${ts}`);
        } catch (e) { job.errors.push(String(e.message || e)); }
        finishJob(job, ok === pick.size);
        release();
        S.writeLog(`网盘管理：下载 ${p} 的 ${ok}/${pick.size} 个（${S.fmtSize(planBytes)}）${moved ? `，本机原来的 ${moved} 个挪进 ${HIST}` : ''}`);
      })();
      return { id: job.id };
    });
  }

  // ---------- 删除：只删网盘上的；默认放进「旧版」 ----------
  async function del(b) {
    const p = projOf(b), names = namesOf(b), permanent = !!b.permanent;
    return exclusive(async () => {
      const cloud = await lsCloud(`${PROJ}/${p}`);
      const rels = [...cloud.keys()].filter(r => names.some(n => under(r, n)));
      if (!rels.length) return { nothing: '网盘上没有选的这些，可能已经删了。' };
      acquire();
      const oldDir = `${OLD}/${S.stamp()}_网盘管理删除`, planBytes = sum(rels, r => cloud.get(r).size);
      const job = newJob({ kind: 'del', p, req: { kind: 'del', p, names, permanent }, total: rels.length, planBytes,
        title: `${permanent ? '彻底删掉' : '删掉'}网盘上的${nameOf(names, rels.length)}` });
      (async () => {
        let gone = [];
        try {
          const lf = listFile(rels);
          if (permanent) await rcJob(job, ['delete', R(`${PROJ}/${p}`), '--files-from-raw', lf], s => s.deletes || 0);
          else await rcJob(job, ['move', R(`${PROJ}/${p}`), R(`${oldDir}/${p}`), '--files-from-raw', lf],
            s => Math.max(s.transfers || 0, (s.serverSideCopies || 0) + (s.serverSideMoves || 0), s.renames || 0));
          dropList(lf);
          const left = await lsCloud(`${PROJ}/${p}`);
          gone = rels.filter(r => !left.has(r));
          manEdit(f => { for (const r of gone) delete f[`${p}/${r}`]; });   // 本机还有的，推送会再传上去
          job.done = gone.length;
          if (!permanent && gone.length) job.notes.push('删下来的放进了网盘「旧版」，在这一页下面「旧版」里能拿回来');
        } catch (e) { job.errors.push(String(e.message || e)); }
        finishJob(job, gone.length === rels.length);
        release();
        S.writeLog(`网盘管理：删掉网盘上 ${p} 的 ${gone.length}/${rels.length} 个${permanent ? '（彻底删）' : `（放进 ${oldDir}）`}`);
      })();
      return { id: job.id };
    });
  }

  // ---------- 旧版：拿回本机、彻底删掉 ----------
  function itemsOf(b) {
    const a = Array.isArray(b.items) ? b.items : [];
    const out = [];
    for (const it of a) {
      const bt = Array.isArray(it) && typeof it[0] === 'string' && /^\d{8}-\d{6}_/.test(it[0]) && seg(it[0]) ? it[0] : null;
      const r = Array.isArray(it) ? relOf(it[1]) : null;
      if (!bt || !r) throw new Bad('选的旧版不对。');
      out.push([bt, r]);
    }
    if (!out.length) throw new Bad('没选东西。');
    return out;
  }
  async function oldGet(b) {
    const p = projOf(b), items = itemsOf(b);
    const seen = new Set();
    for (const [, r] of items) { if (seen.has(r)) throw new Bad(`「${r.split('/').pop()}」选了不止一个旧版，一次只能拿回一个。`); seen.add(r); }
    return exclusive(async () => {
      const have = new Map((await oldOf(p)).map(x => [`${x[0]}/${x[1]}`, x]));
      const ok = items.filter(([bt, r]) => have.has(`${bt}/${r}`));
      if (!ok.length) return { nothing: '网盘上没有选的这些旧版了，可能已经删了。' };
      acquire();
      const ts = S.stamp(), planBytes = sum(ok, ([bt, r]) => have.get(`${bt}/${r}`)[2]);
      const job = newJob({ kind: 'oldget', p, req: { kind: 'oldget', p, items: ok }, moves: true, total: ok.length, planBytes, totalBytes: planBytes,
        title: `拿回旧版${ok.length === 1 ? `「${ok[0][1].split('/').pop()}」` : ` ${ok.length} 个`}` });
      (async () => {
        let n = 0;
        try {
          const before = new Map(ok.map(([, r]) => [r, statNow(p, r)]));
          const groups = new Map();
          for (const [bt, r] of ok) { if (!groups.has(bt)) groups.set(bt, []); groups.get(bt).push(r); }
          for (const [bt, rels] of groups) await fetchInto(job, p, `${OLD}/${bt}/${p}`, rels, `__${ts}`);
          const back = ok.filter(([bt, r]) => { const l = statNow(p, r), o = before.get(r); return l && l.size === have.get(`${bt}/${r}`)[2] && (!o || o.mtime !== l.mtime || o.size !== l.size); });
          n = job.done = back.length;
          const moved = back.filter(([, r]) => before.get(r)).length;
          if (moved) job.notes.push(`本机原来那份 ${moved} 个先挪进了「${HIST}」`);
          if (n) job.notes.push('要网盘上也换成拿回来的这份，再点「上传」');
        } catch (e) { job.errors.push(String(e.message || e)); }
        finishJob(job, n === ok.length);
        release();
        S.writeLog(`网盘管理：从旧版拿回 ${p} 的 ${n}/${ok.length} 个`);
      })();
      return { id: job.id };
    });
  }
  async function oldDel(b) {
    const p = projOf(b), items = itemsOf(b);
    return exclusive(async () => {
      const have = new Set((await oldOf(p)).map(x => `${x[0]}/${x[1]}`));
      const keys = items.filter(([bt, r]) => have.has(`${bt}/${r}`)).map(([bt, r]) => `${bt}/${p}/${r}`);
      if (!keys.length) return { nothing: '选的这些旧版已经没有了。' };
      acquire();
      const job = newJob({ kind: 'olddel', p, req: { kind: 'olddel', p, items }, total: keys.length, title: `彻底删掉 ${keys.length} 个旧版` });
      (async () => {
        let n = 0;
        try {
          const lf = listFile(keys);
          await rcJob(job, ['delete', R(OLD), '--files-from-raw', lf], s => s.deletes || 0);
          dropList(lf);
          const left = new Set((await oldOf(p)).map(x => `${x[0]}/${p}/${x[1]}`));
          n = job.done = keys.filter(k => !left.has(k)).length;
        } catch (e) { job.errors.push(String(e.message || e)); }
        finishJob(job, n === keys.length);
        release();
        S.writeLog(`网盘管理：彻底删掉 ${p} 的旧版 ${n}/${keys.length} 个`);
      })();
      return { id: job.id };
    });
  }

  async function cleanFragments() {
    return exclusive(async () => {
      const r = await rcAsync(['backend', 'cleanup', target(), '-o', 'max-age=1s']);
      if (r.code !== 0) throw new Bad(`清理没成功：${S.hint(r.err)}`, 502);
      S.writeLog('网盘管理：清理没传完的碎片');
      return { ok: true };
    });
  }

  // ---------- 网页来问 ----------
  function send(res, code, obj) {
    if (res.headersSent) return;
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let n = 0;
      req.on('data', c => { n += c.length; if (n > 5e6) { reject(new Bad('请求太大。')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Bad('请求看不懂。')); } });
      req.on('error', reject);
    });
  }
  const price = { store: PRICE_STORE, day: S.PRICE_DAY, night: S.PRICE_NIGHT };
  async function route(req, res, url) {
    const api = `${req.method} ${url.pathname.slice('/api/wangpan/'.length)}`;
    const q = url.searchParams;
    if (api === 'GET jobs') return send(res, 200, { jobs: jobs.map(pub), engineBusy: engineBusy() });
    if (req.method === 'GET') {
      const t = target();
      if (!t) return send(res, 200, { configured: false });
      const p = projOf({ p: q.get('p') });
      if (api === 'GET list') {
        const [rows, all, fragments] = await Promise.all([compare(p), cloudProjects(), countFragments()]);
        const others = all.filter(n => n !== p && !fs.existsSync(path.join(LOCAL, n)));
        return send(res, 200, { configured: true, bucket: t.split(':').pop(), engineBusy: engineBusy(), fragments, price, others,
          rows: [...rows].map(([r, x]) => [r, x.l ? x.l.size : -1, x.l ? x.l.mtime : 0, x.c ? x.c.size : -1, x.c ? x.c.stime : 0, x.s]) });
      }
      if (api === 'GET old') return send(res, 200, { configured: true, rows: await oldOf(p) });
      if (api === 'GET size') {   // 网盘上有、本机没有的项目：拉之前先看多大
        const all = [...(await lsCloud(`${PROJ}/${p}`))], hs = all.filter(([r]) => inHist(r));
        return send(res, 200, { configured: true, n: all.length, size: sum(all, x => x[1].size), histN: hs.length, hist: sum(hs, x => x[1].size), price });
      }
      return send(res, 404, { error: '没有这个功能。' });
    }
    if (req.method !== 'POST') return send(res, 404, { error: '没有这个功能。' });
    const b = await readJson(req);
    if (api === 'POST up') return send(res, 200, await up(b));
    if (api === 'POST down') return send(res, 200, await down(b));
    if (api === 'POST del') return send(res, 200, await del(b));
    if (api === 'POST old-get') return send(res, 200, await oldGet(b));
    if (api === 'POST old-del') return send(res, 200, await oldDel(b));
    if (api === 'POST stop') { stopJob(b.id); return send(res, 200, { ok: true }); }
    if (api === 'POST clean-fragments') return send(res, 200, await cleanFragments());
    send(res, 404, { error: '没有这个功能。' });
  }
  async function handle(req, res, url) {
    try { await route(req, res, url); }
    catch (e) {
      if (e instanceof Bad) return send(res, e.code, { error: e.message });
      say('网盘管理出错：' + ((e && e.stack) || e));
      send(res, 500, { error: String((e && e.message) || e) });
    }
  }
  return { handle };
};
