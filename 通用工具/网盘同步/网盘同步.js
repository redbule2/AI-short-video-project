#!/usr/bin/env node
// 网盘同步：把「项目」文件夹推到阿里云 OSS，或从网盘挑着拉回来。
// 用法：node 网盘同步.js 推送 | 拉取 | 设置
//
// 每台电脑自己记着跟网盘对过哪些文件（%APPDATA%\aivideo-wangpan\state.json）。
// 靠这份记录分清「谁改的」：只拉了一部分的电脑推送时，不会删网盘上它没拉过的东西；
// 两边都改过的文件不会悄悄覆盖，先问人。网盘上被替换、被删的文件先存进「旧版」。
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const readline = require('readline');
const crypto = require('crypto');

const num = (k, d) => (process.env[k] ? Number(process.env[k]) : d);
const LOCAL = path.resolve(process.env.AIVIDEO_LOCAL || path.join(__dirname, '..', '..', '项目'));
const STATE_DIR = process.env.AIVIDEO_STATE || path.join(process.env.APPDATA || os.homedir(), 'aivideo-wangpan');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const LOCK_FILE = path.join(STATE_DIR, 'lock');
const LOG_FILE = path.join(STATE_DIR, '记录.log');
const RCLONE = process.env.AIVIDEO_RCLONE ||
  path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'rclone', 'rclone.exe');
const ALIAS = 'aivideo';            // rclone 里的网盘：指向 aivideo-oss:<bucket>
const OSS = 'aivideo-oss';          // rclone 里存钥匙的那一项
const REMOTE = `${ALIAS}:项目`;
const BACKUP = `${ALIAS}:旧版`;
const PRICE_DAY = 0.5, PRICE_NIGHT = 0.25;              // 拉取每 GB 的流量费（元）
const RENAME_MIN = num('AIVIDEO_RENAME_MIN', 1 << 20);  // 1MB 以上的文件才认「挪了位置」
const BIG_PROJECT = num('AIVIDEO_BIG_PROJECT', 1 << 30); // 1GB 以上的项目可以挑文件夹
const BIG_FOLDER = num('AIVIDEO_BIG_FOLDER', 500 << 20); // 500MB 以上的文件夹再往下分一层
const COMMON = ['--transfers', '6', '--checkers', '16', '--retries', '3', '--low-level-retries', '10'];

const SKIP_FILE = [/^~\$/, /^\.~lock\./, /^thumbs\.db$/i, /^desktop\.ini$/i, /\.tmp$/i, /\.partial$/i, /\.blend\d+$/i, /\.pyc$/i, /\.antou-tmp$/i];   // .antou-tmp：项目管理服务存文件时先写的临时文件
const SKIP_DIR = [/^__pycache__$/, /^\.git$/];
function skipped(rel) {
  const segs = rel.split('/');
  return segs.some((s, i) => (i < segs.length - 1 ? SKIP_DIR : SKIP_FILE).some(r => r.test(s)));
}

// ---------- 小工具 ----------
class Stop extends Error {}
const fail = msg => { throw new Stop(msg); };
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
const show = p => p.replace(/\//g, '\\');
const abs = p => path.join(LOCAL, ...p.split('/'));
const under = (p, d) => d === '' || p === d || p.startsWith(d + '/');
const inScope = (scope, p) => scope.include.some(d => under(p, d)) && !scope.exclude.some(d => under(p, d));
const width = s => [...s].reduce((w, ch) => w + (ch.codePointAt(0) > 0x2e80 ? 2 : 1), 0);
const lastLine = s => (s || '').trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || '';

function fmtSize(n) {
  if (n < 1024) return `${n}B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < units.length - 1);
  let s = n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s + units[i];
}
function fmtMoney(bytes, price) {
  const y = bytes / 1024 ** 3 * price;
  return y < 0.01 ? '不到 1 分钱' : `约 ${y.toFixed(2)} 元`;
}
function fmtEta(sec) {
  if (sec < 60) return `${Math.max(1, Math.round(sec))} 秒`;
  if (sec < 3600) return `${Math.round(sec / 60)} 分钟`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return `${h} 小时${m ? ` ${m} 分钟` : ''}`;
}
function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function writeLog(line) {
  try { fs.appendFileSync(LOG_FILE, `${new Date().toLocaleString('zh-CN')} ${line}\n`); } catch {}
}

// ---------- 问答 ----------
let rl = null, inputClosed = false;
const queued = [], waiting = [];
function input() {
  if (rl) return;
  rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', l => (waiting.length ? waiting.shift()(l) : queued.push(l)));
  rl.on('close', () => { inputClosed = true; while (waiting.length) waiting.shift()(null); });
}
function ask(q) {
  input();
  process.stdout.write(q);
  return new Promise(res => {
    const got = l => {
      if (!process.stdin.isTTY) process.stdout.write(`${l ?? ''}\n`);
      res((l ?? '').trim());
    };
    if (queued.length) got(queued.shift());
    else if (inputClosed) got(null);
    else waiting.push(got);
  });
}
const yes = a => /^(y|yes|是|好|要|拉|对)$/i.test(a);
const no = a => /^(n|no|不|否|不要|不拉|不推)$/i.test(a);
const pickNums = (a, max) => [...new Set((a.match(/\d+/g) || []).map(Number))].filter(n => n >= 1 && n <= max);

// 输入时只显示星号（粘贴钥匙用）
function askHidden(q) {
  const si = process.stdin;
  if (!si.isTTY) return ask(q);
  process.stdout.write(q);
  return new Promise(res => {
    let s = '';
    si.setRawMode(true); si.resume(); si.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          si.removeListener('data', onData); si.setRawMode(false); si.pause();
          process.stdout.write('\n'); res(s); return;
        }
        if (ch === '\u0003') { si.setRawMode(false); process.stdout.write('\n'); process.exit(1); }
        if (ch === '\b' || ch === '\u007f') { if (s) { s = s.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch < ' ') continue;
        s += ch; process.stdout.write('*');
      }
    };
    si.on('data', onData);
  });
}

// ---------- rclone ----------
function rcEnv() {
  const env = { ...process.env };
  // 阿里云在国内，直连最快，也不费代理流量
  if (!process.env.AIVIDEO_KEEP_PROXY) for (const k of Object.keys(env)) if (/^(https?|all|no)_proxy$/i.test(k)) delete env[k];
  return env;
}
function rc(args, opts = {}) {
  const r = cp.spawnSync(RCLONE, args, { encoding: 'utf8', env: rcEnv(), maxBuffer: 1 << 30, windowsHide: true, ...opts });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
function rcAsync(args) {
  return new Promise(res => cp.execFile(RCLONE, args, { encoding: 'utf8', env: rcEnv(), maxBuffer: 1 << 26, windowsHide: true },
    (e, out, err) => res({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, out, err })));
}
// 跑一条要传东西的 rclone，显示中文进度
function rcRun(args, title) {
  console.log(title);
  return new Promise(res => {
    const p = cp.spawn(RCLONE, [...args, ...COMMON, '--use-json-log', '--stats', '1s', '--stats-log-level', 'NOTICE'],
      { env: rcEnv(), windowsHide: true });
    const tty = process.stdout.isTTY;
    const errors = [];
    let buf = '', lastW = 0, stats = null;
    const draw = st => {
      const pct = st.totalBytes ? Math.floor((st.bytes / st.totalBytes) * 100) : 100;
      let s = `  已完成 ${pct}%（${fmtSize(st.bytes)} / ${fmtSize(st.totalBytes)}）`;
      if (st.speed > 0) s += `，每秒 ${fmtSize(Math.round(st.speed))}`;
      if (st.eta) s += `，还要 ${fmtEta(st.eta)}`;
      const w = width(s);
      process.stdout.write('\r' + s + ' '.repeat(Math.max(0, lastW - w)));
      lastW = w;
    };
    p.stdout.resume();
    p.stderr.setEncoding('utf8');
    p.stderr.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.stats) { stats = o.stats; if (tty) draw(stats); }
        else if (o.level === 'error' || o.level === 'critical') {
          errors.push(o);
          if (errors.length <= 10) {
            if (tty && lastW) { process.stdout.write('\n'); lastW = 0; }
            console.log(`  出错：${o.object ? show(o.object) + '：' : ''}${o.msg}`);
          }
        }
      }
    });
    p.on('close', code => {
      if (tty && lastW) process.stdout.write('\n');
      if (errors.length > 10) console.log(`  ……一共 ${errors.length} 处出错`);
      if (code !== 0 && !errors.length) console.log(`  没全成功（rclone 退出码 ${code}）`);
      res({ code, errors, stats });
    });
  });
}

const tempFiles = [];
process.on('exit', () => { for (const f of tempFiles) try { fs.rmSync(f, { force: true }); } catch {} });
// 关窗口、按 Ctrl+C 时也走正常退出，锁和临时清单才会收拾掉
if (require.main === module) for (const sig of ['SIGINT', 'SIGHUP', 'SIGBREAK', 'SIGTERM']) process.on(sig, () => process.exit(130));
function listFile(paths) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const f = path.join(STATE_DIR, `list-${process.pid}-${crypto.randomBytes(4).toString('hex')}.txt`);
  fs.writeFileSync(f, paths.join('\n') + '\n');
  tempFiles.push(f);
  return f;
}

// ---------- 两边的清单 ----------
function scanLocal() {
  const files = new Map();
  if (!fs.existsSync(LOCAL)) return files;
  const walk = (dir, rel) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { console.log(`  读不了：${show(rel) || '项目'}（${e.code}）`); return; }
    for (const e of ents) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP_DIR.some(x => x.test(e.name))) walk(path.join(dir, e.name), r); }
      else if (e.isFile() && !SKIP_FILE.some(x => x.test(e.name))) {
        try { const s = fs.statSync(path.join(dir, e.name)); files.set(r, { size: s.size, mtime: Math.round(s.mtimeMs) }); } catch {}
      }
    }
  };
  walk(LOCAL, '');
  return files;
}
function statRel(p) {
  try { const s = fs.statSync(abs(p)); return { size: s.size, mtime: Math.round(s.mtimeMs) }; } catch { return null; }
}
// serverTime=true：时间用网盘收到文件的时间（列清单就有，不用逐个问）
// serverTime=false：时间用文件原来的修改时间（要逐个问，只给少量文件用）
function listRemote(serverTime = true, only = null) {
  const args = ['lsjson', '-R', '--files-only', '--no-mimetype'];
  if (serverTime) args.push('--fast-list', '--use-server-modtime');
  if (only) args.push('--files-from-raw', listFile(only));
  args.push(REMOTE);
  const r = rc(args);
  if (r.code === 3) return new Map(); // 网盘上还没有「项目」
  if (r.code !== 0) fail(`读网盘清单没成功：${hint(r.err)}`);
  const m = new Map();
  for (const o of JSON.parse(r.out || '[]')) if (!o.IsDir && !skipped(o.Path)) m.set(o.Path, { size: o.Size, mtime: Date.parse(o.ModTime) });
  return m;
}
// 记录里一项：[本机大小, 本机修改时间, 网盘大小, 网盘收到的时间]
const sameL = (l, m) => !!m && l.size === m[0] && Math.abs(l.mtime - m[1]) <= 1;
const sameC = (c, m) => !!m && c.size === m[2] && c.mtime === m[3];
const sameContent = (l, c) => !!l && !!c && l.size === c.size && Math.abs(l.mtime - c.mtime) < 1000;

function hint(err) {
  const e = err || '';
  const code = (/api error (\w+)/.exec(e) || /\b((?:[A-Z][a-z]+){2,}): \1\b/.exec(e) ||
    /\b((?:[A-Z][a-z]+){2,}): [^\n]*\n\s*status code: \d+/.exec(e) || [])[1];
  const said = code ? `（阿里云返回：${code}）` : '';
  if (/InvalidAccessKeyId/i.test(e)) return `AccessKey ID 不对。${said}`;
  if (/SignatureDoesNotMatch/i.test(e)) return `AccessKey Secret 不对。${said}`;
  if (/UserDisable/i.test(e)) return '阿里云说这个账号现在用不了 OSS。最常见是还没开通 OSS：打开 https://oss.console.aliyun.com/ ，' +
    `要开通就点「立即开通」，开通后等一两分钟再试。少数是欠费或被安全限制，可以在费用中心看一眼。${said}`;
  if (/Arrear|overdue/i.test(e)) return `阿里云账号欠费了，充值后再试。${said}`;
  if (/AccessDenied|Forbidden|403/i.test(e)) return `没有权限。看看这个 RAM 用户有没有加 AliyunOSSFullAccess。${said}`;
  if (/no such host|dial tcp|timeout|connection/i.test(e)) return '连不上阿里云，检查一下网络。';
  if (/BucketAlreadyExists/i.test(e)) return '网盘名字被占了，再试一次会换个名字。';
  if (/TooManyBuckets/i.test(e)) return `网盘个数到上限了。${said}`;
  return lastLine(e).replace(/^\{.*"msg":"(.*?)".*$/, '$1').slice(0, 300);
}

// ---------- 这台电脑的记录 ----------
function loadState() {
  try { const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); if (s.v === 1) return s; } catch {}
  return null;
}
function saveState(st) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE + '.tmp', JSON.stringify(st));
  fs.renameSync(STATE_FILE + '.tmp', STATE_FILE);
}
function takeLock() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try { fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' }); }
  catch {
    let pid = 0, alive = false;
    try { pid = Number(fs.readFileSync(LOCK_FILE, 'utf8')); } catch {}
    try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
    if (alive) fail('另一个推送、拉取或网盘管理正在传东西，等它跑完再来。');
    fs.writeFileSync(LOCK_FILE, String(process.pid));
  }
  process.on('exit', () => { try { if (fs.readFileSync(LOCK_FILE, 'utf8') === String(process.pid)) fs.rmSync(LOCK_FILE); } catch {} });
}
function aliasTarget() {
  const r = rc(['config', 'show', ALIAS]);
  if (r.code !== 0) return null;
  const m = /^\s*remote\s*=\s*(.+?)\s*$/m.exec(r.out);
  return m ? m[1] : null;
}

async function prepare(title) {
  console.log(`== ${title} ==`);
  if (!fs.existsSync(RCLONE)) fail('这台电脑还没装好网盘工具。先双击「设置网盘.bat」。');
  const target = aliasTarget();
  if (!target) fail('还没设置网盘。先双击「设置网盘.bat」。');
  takeLock();
  let st = loadState() || { v: 1, target, scope: null, files: {} };
  if (st.target !== target) {
    if (Object.keys(st.files).length) console.log('网盘换过了，这台电脑的记录从头来。');
    st = { v: 1, target, scope: st.scope, files: {} };
  }
  console.log('正在看本机的文件……');
  const local = scanLocal();
  if (!st.scope) st.scope = { include: local.size ? [''] : [], exclude: [] }; // 有项目的电脑默认跟着全部
  console.log('正在读网盘上的清单……');
  const cloud = listRemote();
  console.log(`  本机 ${local.size} 个文件，网盘 ${cloud.size} 个文件。`);
  return { st, local, cloud };
}

// 说不准的（没记录、或两边都变了）：问网盘文件原来的修改时间，一样就当同一份
function resolveChecks(P, local, mode) {
  if (!P.check.length) return;
  console.log(`核对 ${P.check.length} 个说不准的文件……`);
  const meta = listRemote(false, P.check.map(x => x.p));
  for (const { p, kind } of P.check) {
    const l = local.get(p), c = meta.get(p);
    if (c && sameContent(l, c)) P.adopt.push(p);
    else if (kind === 'both' || !c) P.conflicts.push({ p, kind: 'both' });
    else if (c.mtime > l.mtime) (mode === 'push' ? P.behind : P.downSafe).push(p);
    else (mode === 'push' ? P.upMod : P.ahead).push(p);
  }
}
const WHY = { both: '两边都改过', goneThere: '网盘上删了，本机又改过', goneHere: '本机删了，网盘上又改过' };
function printConflicts(list) {
  console.log(`\n有 ${list.length} 个文件两边对不上（多半是两台电脑都动过）：`);
  for (const { p, kind } of list.slice(0, 10)) console.log(`  ${show(p)}（${WHY[kind]}）`);
  if (list.length > 10) console.log(`  ……一共 ${list.length} 个`);
}

// ---------- 推送 ----------
function planPush(local, cloud, man) {
  const P = { same: [], upNew: [], upMod: [], del: [], behind: [], behindDel: [], conflicts: [], check: [], drop: [], adopt: [], downSafe: [], ahead: [] };
  for (const p of new Set([...local.keys(), ...cloud.keys(), ...Object.keys(man)])) {
    const l = local.get(p), c = cloud.get(p), m = man[p];
    if (l && c) {
      if (!m) { P.check.push({ p, kind: 'unknown' }); continue; }
      const lc = !sameL(l, m), cc = !sameC(c, m);
      if (!lc && !cc) P.same.push(p);
      else if (lc && !cc) P.upMod.push(p);
      else if (!lc) P.behind.push(p);
      else P.check.push({ p, kind: 'both' });
    } else if (l) {
      if (!m) P.upNew.push(p);
      else if (sameL(l, m)) P.behindDel.push(p);
      else P.conflicts.push({ p, kind: 'goneThere' });
    } else if (c) {
      if (!m) continue;                        // 这台电脑从没拉过，不管
      if (sameC(c, m)) P.del.push(p);
      else P.conflicts.push({ p, kind: 'goneHere' });
    } else P.drop.push(p);
  }
  return P;
}

async function serverCopies(pairs) {
  console.log(`网盘里直接复制 ${pairs.length} 个挪过位置的文件（不用重传）……`);
  const queue = [...pairs], bad = [];
  let done = 0;
  const worker = async () => {
    while (queue.length) {
      const [s, d] = queue.shift();
      const r = await rcAsync(['copyto', `${REMOTE}/${s}`, `${REMOTE}/${d}`, '--retries', '3']);
      if (r.code !== 0) bad.push([s, d]);
      done++;
      if (process.stdout.isTTY) process.stdout.write(`\r  ${done} / ${pairs.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, pairs.length) }, worker));
  if (process.stdout.isTTY) process.stdout.write('\n');
  if (bad.length) console.log(`  有 ${bad.length} 个复制不成，改成直接上传。`);
  return bad;
}

async function push() {
  const { st, local, cloud } = await prepare('推送：本机 → 网盘');
  if (!local.size) fail('本机的「项目」文件夹是空的，没东西可推。');
  if (!cloud.size && Object.keys(st.files).length) {
    const a = await ask('网盘上是空的，可这台电脑记得推送过。要把本机的全部重新传上去吗？（y=重传，直接回车=不推）：');
    if (!yes(a)) fail('没推。');
    st.files = {};
  }
  const man = st.files;
  const P = planPush(local, cloud, man);
  resolveChecks(P, local, 'push');
  if (P.conflicts.length) {
    printConflicts(P.conflicts);
    const a = await ask('用本机的覆盖网盘吗？网盘那份会先存进「旧版」。（y=用本机的，直接回车=这次先不动）：');
    if (yes(a)) {
      for (const { p, kind } of P.conflicts) (kind === 'goneHere' ? P.del : kind === 'goneThere' ? P.upNew : P.upMod).push(p);
      P.conflicts = [];
    }
  }

  // 挪了位置的（比如旧版挪进历史记录）：内容网盘上已经有，直接在网盘里复制
  const src = new Map();
  for (const [p, m] of Object.entries(man)) {
    const c = cloud.get(p);
    if (c && sameC(c, m) && m[0] >= RENAME_MIN) src.set(`${m[0]}:${m[1]}`, p);
  }
  const copies = [], upNew = [], kept = new Set();
  for (const p of P.upNew) {
    const l = local.get(p);
    const s = l.size >= RENAME_MIN && src.get(`${l.size}:${l.mtime}`);
    if (s && s !== p) { copies.push([s, p]); kept.add(s); } else upNew.push(p);
  }
  // 原来那份已经复制到新位置的，替换、删除时就不用再存「旧版」
  const upKeep = P.upMod.filter(p => kept.has(p)), upBak = P.upMod.filter(p => !kept.has(p));
  const delKeep = P.del.filter(p => kept.has(p)), delBak = P.del.filter(p => !kept.has(p));

  const sz = arr => fmtSize(sum(arr, p => local.get(p).size));
  const skippedN = P.behind.length + P.behindDel.length + P.conflicts.length;
  if (upNew.length || P.upMod.length || copies.length || P.del.length || skippedN) console.log('');
  if (upNew.length) console.log(`  新文件 ${upNew.length} 个（${sz(upNew)}）`);
  if (P.upMod.length) console.log(`  改过的 ${P.upMod.length} 个（${sz(P.upMod)}）`);
  if (copies.length) console.log(`  挪了位置的 ${copies.length} 个（网盘里直接复制，不用重传）`);
  if (P.del.length) console.log(`  网盘上要删 ${P.del.length} 个${delBak.length ? '（删之前先存进「旧版」）' : ''}`);
  if (P.behind.length) console.log(`  网盘上比本机新的 ${P.behind.length} 个，这次不动（先拉取）`);
  if (P.behindDel.length) console.log(`  网盘上已经删了的 ${P.behindDel.length} 个，这次不动（拉取时本机也会删）`);
  if (P.conflicts.length) console.log(`  两边对不上的 ${P.conflicts.length} 个，这次不动`);

  const nf = st.files;
  for (const p of P.adopt) { const l = local.get(p), c = cloud.get(p); nf[p] = [l.size, l.mtime, c.size, c.mtime]; }
  for (const p of P.drop) delete nf[p];
  if (!upNew.length && !P.upMod.length && !copies.length && !P.del.length) {
    saveState(st);
    console.log(skippedN ? '\n这次没有能推的。' : '\n网盘已经和本机一样了。');
    return;
  }
  if (P.del.length) {
    const a = await ask(`\n网盘上要删 ${P.del.length} 个文件，继续推送吗？（直接回车=继续，n=不推）：`);
    if (no(a)) fail('没推。');
  }
  const upBytes = sum([...upNew, ...P.upMod], p => local.get(p).size);
  if (upBytes > 5 * 1024 ** 3) console.log(`\n要传 ${fmtSize(upBytes)}，会比较久。窗口别关；中途关了也没事，下次再双击推送会接着传。`);
  console.log('');

  const ts = stamp(), bdir = `${BACKUP}/${ts}_推送`;
  const failed = new Set();
  let errors = 0;
  const collect = r => { errors += r.errors.length + (r.code !== 0 && !r.errors.length ? 1 : 0); for (const e of r.errors) if (e.object) failed.add(e.object); };
  if (copies.length) for (const [, d] of await serverCopies(copies)) upNew.push(d);
  const upPlain = [...upNew, ...upKeep];
  if (upPlain.length) collect(await rcRun(['copy', LOCAL, REMOTE, '--files-from-raw', listFile(upPlain), '--ignore-times'],
    `上传 ${upPlain.length} 个文件（${sz(upPlain)}）……`));
  if (upBak.length) collect(await rcRun(['copy', LOCAL, REMOTE, '--files-from-raw', listFile(upBak), '--ignore-times', '--backup-dir', bdir],
    `上传改过的 ${upBak.length} 个（网盘上原来那份先存进「旧版」）……`));
  if (delKeep.length) collect(await rcRun(['delete', REMOTE, '--files-from-raw', listFile(delKeep)],
    `网盘上删掉 ${delKeep.length} 个已经挪走的……`));
  if (delBak.length) collect(await rcRun(['move', REMOTE, bdir, '--files-from-raw', listFile(delBak)],
    `网盘上删掉 ${delBak.length} 个（先存进「旧版」）……`));

  console.log('核对网盘……');
  const cloud2 = listRemote();
  let ok = 0;
  for (const p of [...upPlain, ...upBak, ...copies.map(x => x[1])]) {
    const l = local.get(p), c2 = cloud2.get(p), c1 = cloud.get(p);
    if (!failed.has(p) && c2 && c2.size === l.size && (!c1 || c2.mtime !== c1.mtime || c2.size !== c1.size)) {
      nf[p] = [l.size, l.mtime, c2.size, c2.mtime];
      ok++;
    }
  }
  let gone = 0;
  for (const p of P.del) if (!cloud2.has(p)) { delete nf[p]; gone++; }
  saveState(st);
  const total = upPlain.length + upBak.length + copies.length;
  const miss = total - ok + (P.del.length - gone);
  console.log(`\n推送好了：传上去 ${ok} 个，网盘上删掉 ${gone} 个。`);
  if (miss || errors) console.log(`有 ${miss || errors} 个没成功，再双击一次「推送.bat」会接着传。`);
  if (P.behind.length || P.behindDel.length) console.log('网盘上有别的电脑推的新东西，记得双击「拉取.bat」。');
  writeLog(`推送：新 ${upNew.length}、改 ${P.upMod.length}、挪 ${copies.length}、删 ${P.del.length}、成功 ${ok}、没成 ${miss}`);
}

// ---------- 拉取 ----------
function planPull(local, cloud, man, want) {
  const P = { same: [], down: [], downSafe: [], delLocal: [], delSafe: [], ahead: [], aheadDel: [], newHere: [], conflicts: [], check: [], drop: [], adopt: [], behind: [], upMod: [] };
  for (const p of new Set([...local.keys(), ...cloud.keys(), ...Object.keys(man)])) {
    const l = local.get(p), c = cloud.get(p), m = man[p];
    if (!m && !want(p)) continue;
    if (l && c) {
      if (!m) { P.check.push({ p, kind: 'unknown' }); continue; }
      const lc = !sameL(l, m), cc = !sameC(c, m);
      if (!lc && !cc) P.same.push(p);
      else if (cc && !lc) P.down.push(p);
      else if (!cc) P.ahead.push(p);
      else P.check.push({ p, kind: 'both' });
    } else if (c) {
      if (!m) P.down.push(p);
      else if (sameC(c, m)) P.aheadDel.push(p);
      else P.conflicts.push({ p, kind: 'goneHere' });
    } else if (l) {
      if (!m) P.newHere.push(p);
      else if (sameL(l, m)) P.delLocal.push(p);
      else P.conflicts.push({ p, kind: 'goneThere' });
    } else P.drop.push(p);
  }
  return P;
}

function groupsOf(cloud) {
  const g = new Map();
  for (const [p, c] of cloud) {
    const i = p.indexOf('/');
    const key = i < 0 || p.startsWith('.') ? '' : p.slice(0, i); // '' = 项目文件夹里的散文件和设置
    if (!g.has(key)) g.set(key, { key, size: 0, hist: 0, paths: [] });
    const e = g.get(key);
    e.paths.push(p);
    if (key && p.startsWith(`${key}/历史记录/`)) e.hist += c.size; else e.size += c.size;
  }
  return [...g.values()].sort((a, b) => (a.key === '') - (b.key === '') || a.key.localeCompare(b.key, 'zh'));
}
function foldersOf(e, cloud) {
  const P = e.key, d1 = new Map(), d2 = new Map(), loose1 = new Map(), rootLoose = [];
  const add = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  for (const p of e.paths) {
    const segs = p.slice(P.length + 1).split('/');
    if (segs[0] === '历史记录') continue;
    const size = cloud.get(p).size;
    if (segs.length === 1) { rootLoose.push(p); continue; }
    add(d1, segs[0], size);
    if (segs.length === 2) loose1.set(segs[0], [...(loose1.get(segs[0]) || []), p]);
    else add(d2, `${segs[0]}/${segs[1]}`, size);
  }
  const byName = (a, b) => a[0].localeCompare(b[0], 'zh');
  const items = [];
  for (const [f, size] of [...d1].sort(byName)) {
    const subs = [...d2].filter(([k]) => k.startsWith(f + '/')).sort(byName);
    if (size > BIG_FOLDER && subs.length) {
      for (const [k, s2] of subs) items.push({ label: k, size: s2, include: [`${P}/${k}`] });
      const lo = loose1.get(f);
      if (lo) items.push({ label: `${f} 里直接放的文件`, size: sum(lo, p => cloud.get(p).size), include: lo });
    } else items.push({ label: f, size, include: [`${P}/${f}`] });
  }
  if (rootLoose.length) items.push({ label: '直接放在项目里的文件', size: sum(rootLoose, p => cloud.get(p).size), include: rootLoose });
  return items;
}
function addToScope(scope, inc, exc = []) {
  for (const d of inc) {
    if (scope.include.some(x => under(d, x)) && !scope.exclude.some(x => under(d, x))) continue; // 已经包含
    scope.include = scope.include.filter(x => !under(x, d));
    scope.include.push(d);
    scope.exclude = scope.exclude.filter(x => !under(x, d));
  }
  for (const d of exc) if (!scope.exclude.includes(d)) scope.exclude.push(d);
}

async function chooseScope(st, cloud) {
  const have = p => inScope(st.scope, p) || !!st.files[p];
  const gs = groupsOf(cloud);
  console.log('\n网盘上有：');
  gs.forEach((e, i) => {
    const cur = e.paths.filter(p => !e.key || !p.startsWith(`${e.key}/历史记录/`));
    const n = cur.filter(have).length;
    let mine = n === 0 ? '本机没有' : n === cur.length ? '本机已有' : '本机有一部分';
    if (n && e.hist && !e.paths.some(p => p.startsWith(`${e.key}/历史记录/`) && have(p))) mine += '（不含历史记录）';
    const name = e.key || '其他（项目文件夹里的散文件和 .codex 设置）';
    console.log(`  ${i + 1}. ${name} — ${fmtSize(e.size)}${e.hist ? `，历史记录另有 ${fmtSize(e.hist)}` : ''} — ${mine}`);
  });
  const a = await ask('\n要拉哪个？输入编号，可以输几个，用空格隔开。\n直接回车 = 只更新本机已有的：');
  const nums = pickNums(a, gs.length);
  if (a && !nums.length) fail('没看懂输入的编号，没拉。');
  for (const n of nums) {
    const e = gs[n - 1];
    if (!e.key) { addToScope(st.scope, [...new Set(e.paths.map(p => p.split('/')[0]))]); continue; }
    const P = e.key, hp = `${P}/历史记录`;
    let inc = [P];
    if (e.size > BIG_PROJECT) {
      const items = foldersOf(e, cloud);
      console.log(`\n${P} 有 ${fmtSize(e.size)}（不算历史记录），可以只拉一部分：`);
      items.forEach((it, i) => console.log(`  ${i + 1}. ${show(it.label)} — ${fmtSize(it.size)}`));
      const picks = pickNums(await ask('直接回车 = 整个项目都拉；只拉一部分就输入编号：'), items.length);
      if (picks.length) inc = picks.flatMap(k => items[k - 1].include);
    }
    const exc = [];
    if (e.hist && !inScope(st.scope, `${hp}/_`)) {
      const h = await ask(`${P} 的历史记录有 ${fmtSize(e.hist)}，也拉吗？（y=拉，直接回车=不拉）：`);
      if (yes(h)) inc.push(hp); else if (inc.includes(P)) exc.push(hp);
    }
    addToScope(st.scope, inc, exc);
  }
}

function pruneDirs(rel) {
  const segs = rel.split('/');
  segs.pop();
  while (segs.length > 2) { // 项目和它下面一层（提示词、资产……）不删
    const d = path.join(LOCAL, ...segs);
    try { if (fs.readdirSync(d).length) break; fs.rmdirSync(d); } catch { break; }
    segs.pop();
  }
}

async function pull() {
  const { st, local, cloud } = await prepare('拉取：网盘 → 本机');
  if (!cloud.size) fail('网盘上还是空的。先在有项目的电脑上双击「推送.bat」。');
  await chooseScope(st, cloud);
  if (!st.scope.include.length && !Object.keys(st.files).length) fail('什么都没选，没拉。');
  const P = planPull(local, cloud, st.files, p => inScope(st.scope, p));
  resolveChecks(P, local, 'pull');
  if (P.conflicts.length) {
    printConflicts(P.conflicts);
    const a = await ask('用网盘的覆盖本机吗？本机那份会先存进网盘「旧版」。（y=用网盘的，直接回车=这次先不动）：');
    if (yes(a)) {
      for (const { p, kind } of P.conflicts) (kind === 'goneHere' ? P.down : kind === 'goneThere' ? P.delSafe : P.downSafe).push(p);
      P.conflicts = [];
    }
  }

  const downAll = [...P.down, ...P.downSafe], dels = [...P.delLocal, ...P.delSafe];
  const bytes = sum(downAll, p => cloud.get(p).size);
  const skippedN = P.ahead.length + P.aheadDel.length + P.newHere.length + P.conflicts.length;
  if (downAll.length || dels.length || skippedN) console.log('');
  if (downAll.length) {
    console.log(`  要下载 ${downAll.length} 个文件，共 ${fmtSize(bytes)}`);
    const big = [...downAll].sort((a, b) => cloud.get(b).size - cloud.get(a).size).slice(0, 3).filter(p => cloud.get(p).size >= 50 << 20);
    if (big.length) console.log(`    最大的：${big.map(p => `${show(p)}（${fmtSize(cloud.get(p).size)}）`).join('、')}`);
    console.log(`  流量费：白天${fmtMoney(bytes, PRICE_DAY)}，半夜 0～8 点${fmtMoney(bytes, PRICE_NIGHT)}`);
  }
  if (P.downSafe.length) console.log(`  其中 ${P.downSafe.length} 个本机那份会先存进网盘「旧版」`);
  if (dels.length) console.log(`  本机要删 ${dels.length} 个（网盘上已经删了，网盘「旧版」里能找回）`);
  if (P.ahead.length) console.log(`  本机改过、还没推送的 ${P.ahead.length} 个，这次不动`);
  if (P.aheadDel.length) console.log(`  本机删了、还没推送的 ${P.aheadDel.length} 个，这次不动`);
  if (P.newHere.length) console.log(`  本机新加、还没推送的 ${P.newHere.length} 个`);
  if (P.conflicts.length) console.log(`  两边对不上的 ${P.conflicts.length} 个，这次不动`);

  const nf = st.files;
  for (const p of P.adopt) { const l = local.get(p), c = cloud.get(p); nf[p] = [l.size, l.mtime, c.size, c.mtime]; }
  for (const p of P.drop) delete nf[p];
  if (!downAll.length && !dels.length) {
    saveState(st);
    console.log(P.ahead.length + P.aheadDel.length + P.conflicts.length ? '\n这次没有能拉的。' : '\n本机已经是最新的。');
    return;
  }
  const go = await ask('\n开始拉取吗？（直接回车=开始，n=不拉）：');
  if (no(go)) fail('没拉。');
  console.log('');

  const ts = stamp();
  const safe = [...P.downSafe, ...P.delSafe];
  if (safe.length) {
    const r = await rcRun(['copy', LOCAL, `${BACKUP}/${ts}_拉取前`, '--files-from-raw', listFile(safe)],
      `先把本机那 ${safe.length} 份存进网盘「旧版」……`);
    if (r.code !== 0) fail('存「旧版」没成功，为了安全这次没拉。');
  }
  const failed = new Set();
  if (downAll.length) {
    const r = await rcRun(['copy', REMOTE, LOCAL, '--files-from-raw', listFile(downAll), '--ignore-times'],
      `下载 ${downAll.length} 个文件（${fmtSize(bytes)}）……`);
    for (const e of r.errors) if (e.object) failed.add(e.object);
  }
  let ok = 0, gone = 0;
  for (const p of downAll) {
    const s = statRel(p), c = cloud.get(p), l = local.get(p);
    if (!failed.has(p) && s && s.size === c.size && (!l || s.mtime !== l.mtime || s.size !== l.size)) {
      nf[p] = [s.size, s.mtime, c.size, c.mtime];
      ok++;
    }
  }
  for (const p of dels) {
    try { fs.rmSync(abs(p), { force: true }); pruneDirs(p); } catch (e) { console.log(`  删不掉：${show(p)}（${e.code}）`); }
    if (!fs.existsSync(abs(p))) { delete nf[p]; gone++; }
  }
  saveState(st);
  const miss = downAll.length - ok + (dels.length - gone);
  console.log(`\n拉取好了：下载 ${ok} 个，本机删掉 ${gone} 个。`);
  if (miss) console.log(`有 ${miss} 个没成功，再双击一次「拉取.bat」会接着拉。`);
  writeLog(`拉取：下载 ${downAll.length}（${fmtSize(bytes)}）、删 ${dels.length}、成功 ${ok}、没成 ${miss}`);
}

// ---------- 设置（每台电脑做一次）----------
const REGIONS = [
  ['cn-hangzhou', '华东1（杭州）'], ['cn-shanghai', '华东2（上海）'], ['cn-beijing', '华北2（北京）'],
  ['cn-shenzhen', '华南1（深圳）'], ['cn-guangzhou', '华南3（广州）'], ['cn-chengdu', '西南1（成都）'], ['cn-qingdao', '华北1（青岛）'],
];
function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } }
function setSections(text, sections) {
  const names = new Set(Object.keys(sections));
  const out = [];
  let skip = false;
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*\[(.+?)\]\s*$/.exec(line);
    if (m) skip = names.has(m[1]);
    if (!skip) out.push(line);
  }
  let t = out.join('\n').replace(/\s+$/, '');
  for (const [name, kv] of Object.entries(sections)) {
    if (kv) t += `\n\n[${name}]\n` + Object.entries(kv).map(([k, v]) => `${k} = ${v}`).join('\n');
  }
  return t.replace(/^\s+/, '') + '\n';
}
function ps(cmd) {
  return cp.spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { encoding: 'utf8', windowsHide: true });
}
async function installRclone() {
  const a = await ask('这台电脑还没有同步工具 rclone。要从官网 downloads.rclone.org 下载吗（约 31MB）？（直接回车=下载，n=不下）：');
  if (no(a)) fail('没下载，先退出。');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rclone-dl-'));
  try {
    const head = "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12';";
    const ver = (/rclone (v[\d.]+)/.exec(ps(`${head} (Invoke-WebRequest -UseBasicParsing https://downloads.rclone.org/version.txt).Content`).stdout) || [])[1];
    if (!ver) fail('连不上 rclone 官网，检查一下网络再试。');
    const name = `rclone-${ver}-windows-amd64`;
    const zip = path.join(tmp, `${name}.zip`), sums = path.join(tmp, 'SHA256SUMS');
    console.log(`正在下载 ${name}.zip……`);
    ps(`${head} Invoke-WebRequest -UseBasicParsing https://downloads.rclone.org/${ver}/${name}.zip -OutFile '${zip}';` +
       ` Invoke-WebRequest -UseBasicParsing https://downloads.rclone.org/${ver}/SHA256SUMS -OutFile '${sums}'`);
    const want = (new RegExp(`^([0-9a-f]{64})\\s+\\*?${name.replace(/\./g, '\\.')}\\.zip$`, 'm').exec(readText(sums)) || [])[1];
    const got = fs.existsSync(zip) ? crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex') : '';
    if (!want || want !== got) fail('下载的文件校验对不上，没装。');
    ps(`Expand-Archive -LiteralPath '${zip}' -DestinationPath '${path.join(tmp, 'x')}' -Force`);
    fs.mkdirSync(path.dirname(RCLONE), { recursive: true });
    fs.copyFileSync(path.join(tmp, 'x', name, 'rclone.exe'), RCLONE);
    console.log(`装好了：${RCLONE}`);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function setup() {
  console.log('== 设置网盘（每台电脑做一次）==');
  if (!fs.existsSync(RCLONE)) await installRclone();
  const confPath = lastLine(rc(['config', 'file']).out);
  const clean = s => (s || '').replace(/\[20[01]~/g, '').replace(/[\s\u0000-\u001f\u007f]/g, '');
  console.log('\n请粘贴阿里云 RAM 用户的 AccessKey（粘贴：右键，或 Ctrl+V）。屏幕上只显示星号。');
  const id = clean(await askHidden('AccessKey ID：'));
  const secret = clean(await askHidden('AccessKey Secret：'));
  if (!id || !secret) fail('钥匙没填全，先退出。');
  const base = { type: 's3', provider: 'Alibaba', access_key_id: id, secret_access_key: secret, acl: 'private', bucket_acl: 'private', chunk_size: '16Mi' };
  const sections = (region, bucket) => {
    const conf = { ...base, endpoint: `oss-${region}.aliyuncs.com` };
    if (process.env.AIVIDEO_OSS_ENDPOINT) Object.assign(conf, { endpoint: process.env.AIVIDEO_OSS_ENDPOINT, force_path_style: 'true' }); // 只给测试用
    if (bucket) conf.no_check_bucket = 'true'; // 建好以后就不用每次查网盘在不在
    return { [OSS]: conf, [ALIAS]: bucket ? { type: 'alias', remote: `${OSS}:${bucket}` } : null };
  };
  // 先在临时配置里试，钥匙对了、网盘建好了，才写进正式配置
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmpConf = path.join(STATE_DIR, `setup-${process.pid}.conf`);
  tempFiles.push(tmpConf);
  const write = (region, bucket) => fs.writeFileSync(tmpConf, setSections('', sections(region, bucket)));
  const trc = (args, o = {}) => rc(args, { ...o, env: { ...rcEnv(), RCLONE_CONFIG: tmpConf } });
  write('cn-hangzhou', null);
  console.log('正在用钥匙登录……');
  let r = trc(['lsjson', '--no-mimetype', '--no-modtime', `${OSS}:`]);
  if (r.code !== 0) fail(`登录不上：${hint(r.err)}`);
  const ours = JSON.parse(r.out || '[]').filter(b => b.IsDir && /^aivideo-cn-[a-z]+-[0-9a-f]{6}$/.test(b.Name)).map(b => b.Name);
  let bucket;
  if (ours.length === 1) { bucket = ours[0]; console.log(`找到网盘 ${bucket}，就用它。`); }
  else if (ours.length > 1) {
    console.log('找到几个网盘：');
    ours.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
    const k = pickNums(await ask('用哪个？输入编号：'), ours.length)[0];
    if (!k) fail('没选，先退出。');
    bucket = ours[k - 1];
  } else {
    console.log('\n还没有网盘，现在新建一个。选一个离你近的地方：');
    REGIONS.forEach(([, n], i) => console.log(`  ${i + 1}. ${n}`));
    const k = pickNums(await ask('输入编号（直接回车 = 1）：'), REGIONS.length)[0] || 1;
    const region = REGIONS[k - 1][0];
    bucket = `aivideo-${region}-${crypto.randomBytes(3).toString('hex')}`;
    write(region, null);
    r = trc(['mkdir', `${OSS}:${bucket}`]);
    if (r.code !== 0) fail(`新建网盘没成功：${hint(r.err)}`);
    console.log(`新建好了：${bucket}（${REGIONS[k - 1][1]}，只有你自己能看）`);
  }
  const region = /^aivideo-(cn-[a-z]+)-/.exec(bucket)[1];
  write(region, bucket);
  r = trc(['rcat', `${ALIAS}:设置测试.txt`], { input: 'ok' });
  const r2 = r.code === 0 ? trc(['deletefile', `${ALIAS}:设置测试.txt`]) : r;
  if (r.code !== 0 || r2.code !== 0) fail(`能登录，但写不进去：${hint(r.err || r2.err)}`);
  fs.mkdirSync(path.dirname(confPath), { recursive: true });
  fs.writeFileSync(confPath, setSections(readText(confPath), sections(region, bucket)));
  console.log('\n设置好了。改完东西双击「推送.bat」；要拿别的电脑的改动，双击「拉取.bat」。');
  writeLog(`设置：网盘 ${bucket}`);
}

async function main() {
  const cmd = process.argv[2];
  try {
    if (cmd === '推送' || cmd === 'push') await push();
    else if (cmd === '拉取' || cmd === 'pull') await pull();
    else if (cmd === '设置' || cmd === 'setup') await setup();
    else console.log('用法：node 网盘同步.js 推送 | 拉取 | 设置');
  } catch (e) {
    if (e instanceof Stop) { console.log(`\n${e.message}`); process.exitCode = 2; }
    else { console.log(`\n出错了：${(e && e.stack) || e}`); process.exitCode = 1; }
  } finally {
    if (rl) rl.close();
  }
}
if (require.main === module) main();

// 网盘管理.js（项目管理里「网盘」那一页的后台）用的
module.exports = {
  LOCAL, STATE_DIR, STATE_FILE, LOCK_FILE, RCLONE, ALIAS, OSS, PRICE_DAY, PRICE_NIGHT,
  rcEnv, hint, fmtSize, fmtMoney, stamp, writeLog, aliasTarget, loadState, saveState, SKIP_FILE, SKIP_DIR, skipped,
};
