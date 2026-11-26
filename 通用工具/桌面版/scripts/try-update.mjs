/* 试升级（开发规范第 21 条「本机装一遍点通」的升级那一半）：不碰 video8.online，也不碰正式版
     node scripts/try-update.mjs          缺哪个试装包先打哪个（pack.mjs trial 0.0.1、0.0.2），再试
     node scripts/try-update.mjs --new    两个试装包都重打
     node scripts/try-update.mjs --keep   试完不卸，留着人自己点（再跑 --clean 卸掉、删干净）
     node scripts/try-update.mjs --clean  只卸掉、删干净
     node scripts/try-update.mjs --bad-sign  更新源摆一个签名不对的 0.0.2：该下完验不过、报错、不装，装着的还是 0.0.1
     加 --outside：在 Claude 应用（或别的商店版软件）的命令行里跑必须加。商店版软件开出来的程序，往 AppData 写的是它私下的一份；
                   升级后软件自己重开那回走的是系统，看的是真的那份，两边对不上（11-24 头两回就栽在这里：重开后找不到设置、脚本读不到日志）。
                   加了它，脚本经 WMI 把自己在外面重开一遍，这边只跟着念日志。
                   外面那一遍找不到 pnpm（11-26：它装在商店版私下的那份 AppData 里），试装包先在这边打好：pack.mjs trial 0.0.1、trial 0.0.2。
   做法：本机开个假更新源摆 0.0.2 → 装 0.0.1 → 开起来，它自己查到 0.0.2、下好、问要不要「现在重启装上」→ 替人点（人先点了也认）
   → 看它自己重开成 0.0.2：工具换新了（本机改过的先备份）、旧版才有的删了、「项目」一个字没动、再查更新说已经最新。
   试装版叫 LiushuixianTrial：装在 LOCALAPPDATA 的 Programs 里，设置在 APPDATA 的 LiushuixianTrial，和正式版各管各的。
   截图放 build/trial/截图。 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shotWindows, clickDialog } from './win-helpers.mjs';

const DESK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRIAL = path.join(DESK, 'build', 'trial');
const SHOTS = path.join(TRIAL, '截图');
const OLD = '0.0.1', NEW = '0.0.2';
const EXE = 'LiushuixianTrial';
const INSTALL = path.join(process.env.LOCALAPPDATA, 'Programs', EXE);
const DATA = path.join(process.env.APPDATA, EXE);
const TMP = path.join(os.tmpdir(), 'antou-try-update');
const WORK = path.join(TMP, 'AI短视频项目');
const KEEP = path.join(WORK, '项目', '试装', '别动我.txt');
const KEEP_TEXT = '这是项目里的文件，升级不许动它\n';
const MARK = path.join(WORK, '通用工具', '桌面版', '试装');
const SHORTCUT = path.join(os.homedir(), 'Desktop', EXE + '.lnk');
const flags = new Set(process.argv.slice(2));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } };
const LOG_FILE = process.argv.includes('--log') ? process.argv[process.argv.indexOf('--log') + 1] : '';   // 在外面重开的那一遍：没有命令行窗口，话都写进这个文件
if (LOG_FILE) {
  fs.writeFileSync(LOG_FILE, '');
  console.log = console.error = (...a) => fs.appendFileSync(LOG_FILE, a.join(' ') + '\n');
}
let failed = 0;
function check(ok, text, detail) {
  console.log((ok ? '✔ ' : '✖ ') + text);
  if (!ok) { failed++; if (detail) console.log('　' + String(detail).split('\n').join('\n　')); }
  return ok;
}

/* ---------- 试装包 ---------- */
const yml = (file, k) => (((read(file) || '').match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '').trim().replace(/^['"]|['"]$/g, '');
const setupOf = v => path.join(TRIAL, v, yml(path.join(TRIAL, v, 'latest.yml'), 'path'));
const haveBuild = v => yml(path.join(TRIAL, v, 'latest.yml'), 'version') === v && !!yml(path.join(TRIAL, v, 'latest.yml'), 'signature') && fs.existsSync(setupOf(v));   // 没签名的老试装包重打
/* 签名不对的更新源：新版的安装包原样，latest.yml 的签名换成一串全零 */
function badFeed() {
  const dir = path.join(TRIAL, 'bad-sign'), name = path.basename(setupOf(NEW));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of [name, name + '.blockmap']) fs.copyFileSync(path.join(TRIAL, NEW, f), path.join(dir, f));
  fs.writeFileSync(path.join(dir, 'latest.yml'), read(path.join(TRIAL, NEW, 'latest.yml')).replace(/^signature:.*$/m, `signature: '${Buffer.alloc(64).toString('base64')}'`));
  return dir;
}
function build(v) {
  console.log(`打试装包 ${v}…`);
  const r = spawnSync(process.execPath, [path.join(DESK, 'scripts', 'pack.mjs'), 'trial', v], { cwd: DESK, stdio: LOG_FILE ? 'pipe' : 'inherit', encoding: 'utf8' });
  if (LOG_FILE) console.log(((r.stdout || '') + (r.stderr || '')).split('\n').filter(l => l.trim() && !/^\s*•/.test(l)).join('\n'));
  if (r.status !== 0) throw new Error(`试装包 ${v} 没打成`);
}
/* 打进包里的更新源和更新缓存文件夹名（resources\app-update.yml） */
function feedOf(v) {
  const f = path.join(TRIAL, v, 'win-unpacked', 'resources', 'app-update.yml');
  return { url: yml(f, 'url'), cache: yml(f, 'updaterCacheDirName') };
}

/* ---------- 试装版开着没有、关掉、卸掉 ---------- */
function running() {
  const r = spawnSync('tasklist', ['/FI', `IMAGENAME eq ${EXE}.exe`, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
  return (r.stdout || '').toLowerCase().includes(EXE.toLowerCase() + '.exe');
}
/* 装的位置里还在跑的（带的 node.exe 开的本机服务之类）：卸之前都关掉 */
function killUnder(dir) {
  spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($env:ANTOU_DIR, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'],
    { windowsHide: true, env: { ...process.env, ANTOU_DIR: dir + path.sep } });
}
async function closeApp() {
  if (!running()) return;
  spawnSync('taskkill', ['/IM', EXE + '.exe'], { windowsHide: true });   // 先好好关：本机服务跟着关
  for (let i = 0; i < 40 && running(); i++) await sleep(250);
  if (running()) spawnSync('taskkill', ['/IM', EXE + '.exe', '/T', '/F'], { windowsHide: true });
  for (let i = 0; i < 20 && running(); i++) await sleep(250);
}
/* 跟试装有关、正在跑的程序：试装版本身、安装程序（Liushuixian-0.0.N-x64）、NSIS 拷到临时文件夹跑的卸载（Un_A）、安装（Au_） */
function procs() {
  const r = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  const names = (r.stdout || '').split(/\r?\n/).map(l => (l.match(/^"([^"]+)"/) || [])[1] || '');
  return [...new Set(names.filter(n => /^(LiushuixianTrial\.exe|Liushuixian-[\d.]+-x64\.exe|Un_[A-Z]\.exe|Au_\.exe)$/i.test(n)))];
}
const setupRunning = () => procs().some(n => !/^LiushuixianTrial\.exe$/i.test(n));
async function clean(cache) {
  for (let i = 0; i < 180 && setupRunning(); i++) await sleep(1000);   // 安装、卸载程序还在跑：等它跑完再动，别两个一起改同一个文件夹
  await closeApp();
  killUnder(INSTALL);
  const un = path.join(INSTALL, `Uninstall ${EXE}.exe`);
  if (fs.existsSync(un)) {
    spawnSync(un, ['/S'], { windowsHide: true, timeout: 60000 });   // 卸载程序会把自己拷到临时文件夹再跑：等它跑完、装的文件没了才算完
    for (let i = 0; i < 120 && (setupRunning() || fs.existsSync(path.join(INSTALL, EXE + '.exe'))); i++) await sleep(500);
  }
  const gone = !fs.existsSync(path.join(INSTALL, EXE + '.exe'));
  const dirs = [INSTALL, DATA, TMP];
  if (cache && /-trial-updater$/.test(cache)) dirs.push(path.join(process.env.LOCALAPPDATA, cache));
  for (const d of dirs) {
    try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); }
    catch (e) { console.log(`　删不掉 ${d}（${e.code}），还有程序占着`); }
  }
  return gone;
}

/* ---------- 假更新源：只摆新版那几个文件 ---------- */
function startFeed(port, dir) {
  const served = [];
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(dir, name);
    const ok = !!name && !/[\\/]/.test(name) && fs.existsSync(file) && fs.statSync(file).isFile();
    served.push(`${req.method} /${name} → ${ok ? 200 : 404}`);
    if (!ok) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Length': fs.statSync(file).size, 'Content-Type': name.endsWith('.yml') ? 'text/yaml; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    srv.on('error', e => reject(new Error(`假更新源开不起来（端口 ${port}）：${e.message}`)));
    srv.listen(port, '127.0.0.1', () => resolve({ served, close: () => srv.close() }));
  });
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

/* ---------- 看日志、截图、替人点按钮 ---------- */
function logText() {
  const dir = path.join(DATA, 'logs');
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join(''); } catch (e) { return ''; }
}
async function waitLog(text, ms, from = 0) {
  for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(500)) if (logText().slice(from).includes(text)) return true;
  return false;
}
const tail = (n = 15) => logText().split('\n').filter(Boolean).slice(-n).join('\n');

const shot = (prefix, proc = EXE) => shotWindows(proc, SHOTS, prefix);
const dialog = (title, click, wait) => clickDialog(EXE, title, click, wait);
function findBackup() {
  const root = path.join(DATA, '升级备份');
  try {
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, '通用工具', '桌面版', '试装', '版本.txt');
      if (fs.existsSync(f)) return f;
    }
  } catch (e) { /* 没有备份文件夹 */ }
  return '';
}

/* ---------- 在商店版软件的命令行里跑：经 WMI 把自己在外面重开一遍，这边只跟着念它写的日志 ---------- */
async function outside() {
  const log = path.join(os.tmpdir(), 'antou-try-update.log');
  fs.rmSync(log, { force: true });
  const rest = process.argv.slice(2).filter(a => a !== '--outside');
  const cl = [process.execPath, fileURLToPath(import.meta.url), ...rest, '--log', log].map(a => `"${a}"`).join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $env:ANTOU_CL; CurrentDirectory = $env:ANTOU_CWD }).ReturnValue'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ANTOU_CL: cl, ANTOU_CWD: DESK } });
  if ((r.stdout || '').trim() !== '0') throw new Error('没能在外面开起来：' + ((r.stdout || '') + (r.stderr || '')).trim());
  let at = 0, end = null;
  for (const t0 = Date.now(); Date.now() - t0 < 30 * 60000 && !end; await sleep(1000)) {
    const s = read(log) || '';
    if (s.length > at) { process.stdout.write(s.slice(at)); at = s.length; }
    end = s.match(/\n(全过了|有 \d+ 处不对)\s*$/);
  }
  if (!end) throw new Error('外面那一遍半小时没跑完，日志：' + log);
  process.exit(end[1] === '全过了' ? 0 : 1);
}

/* ---------- 试一遍 ---------- */
async function main() {
  if (flags.has('--outside')) return outside();
  if (flags.has('--clean')) {
    const { cache } = fs.existsSync(path.join(TRIAL, OLD)) ? feedOf(OLD) : {};
    console.log((await clean(cache)) ? '试装版卸掉了，设置、工作文件夹、更新缓存都删了' : '没卸干净：' + INSTALL);
    return;
  }
  for (const v of [OLD, NEW]) if (flags.has('--new') || !haveBuild(v)) build(v);
  const { url, cache } = feedOf(OLD);
  const feedPort = Number(new URL(url).port);
  if (running() || fs.existsSync(INSTALL) || fs.existsSync(DATA)) { console.log('上回试装的还在，先卸掉、删干净'); await clean(cache); }

  /* 工作文件夹先放一份「项目」里的文件；设置先写好工作文件夹和端口：升级后自己重开那回不带环境变量，也得认得 */
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(KEEP), { recursive: true });
  fs.writeFileSync(KEEP, KEEP_TEXT);
  const keepTime = fs.statSync(KEEP).mtimeMs;
  const port = await freePort();
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(path.join(DATA, '设置.json'), JSON.stringify({ 工作文件夹: WORK, 端口: port }, null, 2));
  const bad = flags.has('--bad-sign');
  const feed = await startFeed(feedPort, bad ? badFeed() : path.join(TRIAL, NEW));
  console.log(`假更新源 ${url} 摆着 ${NEW}${bad ? '（签名不对的）' : ''}；工作文件夹 ${WORK}；端口 ${port}`);
  let sawShortcut = false;
  try {
    const r = spawnSync(setupOf(OLD), ['/S', '/currentuser'], { windowsHide: true, timeout: 180000 });
    if (!check(r.status === 0 && fs.existsSync(path.join(INSTALL, EXE + '.exe')), `装好了试装版 ${OLD}`, r.error ? r.error.message : '退出码 ' + r.status)) return;
    sawShortcut = fs.existsSync(SHORTCUT);

    const env = { ...process.env, ANTOU_DESK_NO_FOCUS: '1' };
    for (const k of Object.keys(env)) if ((/^ANTOU_/.test(k) && k !== 'ANTOU_DESK_NO_FOCUS') || /^ELECTRON_/.test(k)) delete env[k];
    spawn(path.join(INSTALL, EXE + '.exe'), [], { env, detached: true, stdio: 'ignore' }).unref();

    if (!check(await waitLog(`启动 {"版本":"${OLD}"`, 60000), `${OLD} 开起来了`, tail())) return;
    if (!check(await waitLog('工具同步完', 60000), '工具同步进工作文件夹了', tail())) return;
    check(read(path.join(MARK, '版本.txt')) === `试装 ${OLD}\n` && fs.existsSync(path.join(MARK, `只在${OLD}.txt`)), `工作文件夹里是 ${OLD} 的工具`);
    fs.appendFileSync(path.join(MARK, '版本.txt'), '本机改过\n');   // 用着用着本机改了一个工具文件：升级时要先备份它
    if (bad) {
      check(await waitLog('更新：error', 240000), '签名不对的升级包：下完验不过、报错了', tail() + '\n更新源被要过：\n' + feed.served.join('\n'));
      check(logText().includes('签名对不上'), '日志里写着「签名对不上」', tail());
      await sleep(3000);
      check(!logText().includes('更新：downloaded'), '没说「下好了」，也就不会问装不装、关软件时也不装');
      const man = JSON.parse(read(path.join(INSTALL, 'resources', 'tools', '清单.json')) || '{}');
      check(man.版本 === OLD, `装着的还是 ${OLD}`, '装着的是 ' + man.版本);
      check(feed.served.some(s => s.startsWith(`GET /${path.basename(setupOf(NEW))} → 200`)), '安装包是下完了的（验的就是下好的这个）', feed.served.join('\n'));
      return;
    }
    if (!check(await waitLog('更新：downloaded', 240000), `自己查到 ${NEW}、在后台下好了`, tail() + '\n更新源被要过：\n' + feed.served.join('\n'))) return;

    const mark = logText().length;
    const byHand = () => logText().slice(mark).includes('Install on explicit quitAndInstall');   // 人先点了也认
    let how = '';
    if (dialog('新版本下好了', -1, 30) === 'seen') {
      console.log('　截图：' + shot('1_新版本下好了').join('、'));
      const mine = !byHand() && dialog('新版本下好了', 0, 3) === 'clicked';   // 第 0 个按钮就是「现在重启装上」
      for (let i = 0; i < 20 && !byHand(); i++) await sleep(500);
      if (byHand()) how = mine ? '替人点了' : '有人先点了';
    } else if (byHand()) how = '有人先点了';
    if (!check(!!how, `弹出了「新版本下好了」，${how || '没点成'}「现在重启装上」`)) return;

    /* 点了以后：旧版退出 → 安装程序装新版 → 安装程序把新版开起来。每两秒看一眼谁在跑，装的时候截一张 */
    const t0 = Date.now(), seenProcs = new Set();
    let relaunched = false, setupShot = false;
    while (Date.now() - t0 < 240000 && !relaunched) {
      for (const p of procs()) {
        if (seenProcs.has(p)) continue;
        seenProcs.add(p);
        console.log(`　第 ${Math.round((Date.now() - t0) / 1000)} 秒：${p} 在跑`);
        if (!setupShot && /^Liushuixian-/i.test(p)) { await sleep(1500); const s = shot('2_安装中', p.replace(/\.exe$/i, '')); setupShot = s.length > 0; if (setupShot) console.log('　截图：' + s.join('、')); }
      }
      relaunched = logText().slice(mark).includes(`启动 {"版本":"${NEW}"`);
      if (!relaunched) await sleep(2000);
    }
    if (!check(relaunched, `自己装好、重开成 ${NEW} 了（点完 ${Math.round((Date.now() - t0) / 1000)} 秒）`, tail())) {
      for (let i = 0; i < 120 && setupRunning(); i++) await sleep(1000);
      const man = JSON.parse(read(path.join(INSTALL, 'resources', 'tools', '清单.json')) || '{}');
      console.log(`　装着的是：${man.版本 || '（没装上）'}；现在还开着：${procs().join('、') || '没有'}`);
      if (man.版本 !== NEW) return;
      const env = { ...process.env };
      for (const k of Object.keys(env)) if (/^(ANTOU_|ELECTRON_)/.test(k)) delete env[k];
      spawn(path.join(INSTALL, EXE + '.exe'), [], { env, detached: true, stdio: 'ignore' }).unref();
      if (!check(await waitLog(`启动 {"版本":"${NEW}"`, 60000, mark), `新版是装上了，手动开得起来`, tail())) return;
    }
    check(await waitLog(`"port":${port}`, 30000, mark), '重开后认得原来的工作文件夹和端口，没再问放哪');
    check(await waitLog('工具同步完', 60000, mark), '新版的工具同步进去了', tail());
    check(await waitLog('更新：not-available', 120000, mark), '新版再查更新：已经是最新的', tail());
    await sleep(2500);
    console.log('　截图：' + shot('3_升级后').join('、'));

    const ver = read(path.join(MARK, '版本.txt'));
    check(ver === `试装 ${NEW}\n`, '工具换成新版的了（版本.txt）', ver);
    check(!fs.existsSync(path.join(MARK, `只在${OLD}.txt`)), '只在旧版有的工具文件删了');
    check(fs.existsSync(path.join(MARK, `只在${NEW}.txt`)), '新版才有的工具文件加上了');
    const bak = findBackup();
    check(!!bak && (read(bak) || '').includes('本机改过'), '本机改过的工具文件先备份了', bak || '没找到备份');
    check(read(KEEP) === KEEP_TEXT && fs.statSync(KEEP).mtimeMs === keepTime, '「项目」里的文件一个字没动');
    const man = JSON.parse(read(path.join(INSTALL, 'resources', 'tools', '清单.json')) || '{}');
    check(man.版本 === NEW, `装着的是 ${NEW}`);
    const asked = feed.served.filter(s => s.startsWith('GET /latest.yml')).length;
    check(asked >= 2 && feed.served.some(s => s.startsWith(`GET /${path.basename(setupOf(NEW))} → 200`)), `更新源被问过 ${asked} 回、新版安装包下过`, feed.served.join('\n'));
  } finally {
    feed.close();
    console.log('更新源被要过：\n　' + feed.served.join('\n　'));
    if (flags.has('--keep')) console.log(`试装版留着：${INSTALL}。看完跑 node scripts/try-update.mjs --clean`);
    else {
      check(await clean(cache), '试装版卸掉了，设置、工作文件夹、更新缓存都删了');
      if (sawShortcut) check(!fs.existsSync(SHORTCUT), '桌面上的试装版图标也没了');
    }
  }
}

try { await main(); }
catch (e) { failed++; console.error('\n没试成：' + e.message); }
console.log(failed ? `\n有 ${failed} 处不对` : '\n全过了');
process.exit(failed ? 1 : 0);
