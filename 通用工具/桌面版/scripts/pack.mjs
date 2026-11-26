/* 桌面版打包（开发规范第 15、21 条）
     node scripts/pack.mjs stage      挑工具文件进 build/tools、写 清单.json，备好 build/node/node.exe，再自检一回
     node scripts/pack.mjs dir        stage 后打成不用装的文件夹 release/win-unpacked（本机试用，不带更新通道）
     node scripts/pack.mjs installer  stage 后打安装包 build/installer/版本/Liushuixian-版本-x64.exe 和签好名的 latest.yml（只打不传）
                                      不打到 release：那里是平时开着用的那份，开着删不掉
     node scripts/pack.mjs publish    把打好的这一版传上更新源（开发规范第 21、30、34 条：先提交、本机装一遍点通、问过用户；后台先发）。
                                      先核签名、线上的版本比它旧；安装包传完核对了才换 latest.yml，再从网上取回来核一遍
     node scripts/pack.mjs trial 0.0.N  试装包：只在本机试升级用（scripts/try-update.mjs），打到 build/trial/0.0.N。
                                      叫 LiushuixianTrial，装的位置、设置文件夹、更新缓存都和正式版分开；更新源是本机 127.0.0.1:18681；
                                      工具里多两份试装记号（版本.txt 每版不同、只在0.0.N.txt 只这一版有），看升级换没换新、删没删旧
   安装包、试装包都签名（lib/updater.js 开头）：私钥在 %USERPROFILE%\.liushuixian\update-signing-key.pem（ANTOU_UPDATE_KEY 能换），不进 git、不进安装包。
   挑文件：stage、dir、trial 用工作区里 git 认得的（登记过的，加上没登记也没忽略的）；
           installer 只用登记过的，要装的工具文件有没提交的改动就停。
           考试页（页面/考试）不进 git：每回从 桌面版/考试 的源码现打一份装进去。 */
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { pickFiles, checkRefs } = require('./bundle-list.cjs');
const { safeRel, syncTools } = require('../lib/sync.js');
const { ping, killTree } = require('../lib/runner.js');
const { signedText, verifyPackage } = require('../lib/updater.js');

const DESK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(DESK, '..', '..');
const BUILD = path.join(DESK, 'build');
const TOOLS = path.join(BUILD, 'tools');
const NODE_DIR = path.join(BUILD, 'node');
const RELEASE = path.join(DESK, 'release');
const NODE_VERSION = process.env.ANTOU_NODE_VERSION || 'v26.13.0';   // 和开发机一样
const NODE_MIRROR = (process.env.ANTOU_NODE_MIRROR || 'https://npmmirror.com/mirrors/node').replace(/\/+$/, '');
const ELECTRON_MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';
const BUILDER_MIRROR = process.env.ELECTRON_BUILDER_BINARIES_MIRROR || 'https://npmmirror.com/mirrors/electron-builder-binaries/';
const SCOPE = ['AGENTS.md', '.agents', '通用工具'];
const EXAM_SRC = '通用工具/桌面版/考试';        // 考试、团队页的源码（从 new-video8-8 照搬的 Vue 页面）
const EXAM_OUT = '通用工具/桌面版/页面/考试';   // 打出来的那一页：不进 git，每回现打，和别的工具文件一起装进工作文件夹

const SIGN_KEY = process.env.ANTOU_UPDATE_KEY || path.join(os.homedir(), '.liushuixian', 'update-signing-key.pem');
const DEPLOY_SSH = process.env.ANTOU_DEPLOY_SSH || 'video8-deploy';   // 本机 ~/.ssh/config 里连服务器的别名
const DEPLOY_DIR = '/home/video8deploy/public/desktop-updates/liushuixian/win';

const mode = process.argv[2] || 'stage';
if (!['stage', 'dir', 'installer', 'publish', 'trial'].includes(mode)) { console.error('用法：node scripts/pack.mjs stage|dir|installer|publish|trial 0.0.N'); process.exit(1); }
const TRIAL = mode === 'trial' ? process.argv[3] || '' : '';
if (mode === 'trial' && !/^0\.0\.\d+$/.test(TRIAL)) { console.error('试装包的版本号只用 0.0.N，一看就知道是试装的：node scripts/pack.mjs trial 0.0.1'); process.exit(1); }
const TRIAL_FEED = 'http://127.0.0.1:18681/';
const pkg = JSON.parse(fs.readFileSync(path.join(DESK, 'package.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = (algo, buf, enc = 'hex') => crypto.createHash(algo).update(buf).digest(enc);
const rel = f => path.join(REPO, ...f.split('/'));

function git(args) {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' 没成：' + (r.stderr || r.error));
  return r.stdout;
}

/* 要装的文件里有没提交的改动（改了、删了、加进暂存没提交的） */
function dirtyFiles() {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=no', '--', ...SCOPE]).split('\0');
  const dirty = [];
  for (let i = 0; i < out.length; i++) {
    const e = out[i];
    if (!e) continue;
    const xy = e.slice(0, 2), p = e.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++;   // 改名的后面还跟着原名
    if (pickFiles([p]).length) dirty.push(xy + ' ' + p);
  }
  return dirty;
}

/* 考试页现打一份，回打出来的文件。打安装包时源码得是提交过的 */
function buildExam() {
  const dirty = mode === 'installer' ? git(['status', '--porcelain=v1', '--', EXAM_SRC]).trim() : '';
  if (dirty) throw new Error('考试页的源码有没提交的改动，先提交再打安装包（开发规范第 21 条）：\n' + dirty);
  const r = spawnSync(process.execPath, [path.join(DESK, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--config', path.join(DESK, '考试', 'vite.config.mjs'), '--logLevel', 'warn'], { cwd: DESK, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('考试页没打出来（先在 桌面版 里 pnpm install）');
  const out = [];
  const walk = d => { for (const e of fs.readdirSync(rel(d), { withFileTypes: true })) (e.isDirectory() ? walk : f => out.push(f))(d + '/' + e.name); };
  walk(EXAM_OUT);
  return out;
}

function listFiles() {
  const tracked = git(['ls-files', '-z', '--', ...SCOPE]).split('\0').filter(Boolean);
  const others = mode === 'installer' ? [] : git(['ls-files', '-z', '--others', '--exclude-standard', '--', ...SCOPE]).split('\0').filter(Boolean);
  return pickFiles([...tracked, ...others, ...buildExam()]).filter(f => fs.existsSync(rel(f)));
}

function stage() {
  const dirty = dirtyFiles();
  if (mode === 'installer' && dirty.length) throw new Error('要装的工具文件有没提交的改动，先提交再打安装包（开发规范第 21 条）：\n' + dirty.slice(0, 30).join('\n') + (dirty.length > 30 ? `\n……一共 ${dirty.length} 个` : ''));
  const files = listFiles();
  const bad = files.filter(f => !safeRel(f));
  if (bad.length) throw new Error('这些路径装不进工作文件夹：\n' + bad.join('\n'));
  const missing = checkRefs(files, f => fs.readFileSync(rel(f), 'utf8'));
  if (missing.length) throw new Error('这些文件用到的文件没进安装包（多半是还没进 git，或者被挑掉了）：\n' + missing.map(m => m.from + ' → ' + m.to).join('\n'));
  fs.rmSync(TOOLS, { recursive: true, force: true });
  const list = {};
  let bytes = 0;
  for (const f of files) {
    const buf = fs.readFileSync(rel(f));
    const to = path.join(TOOLS, ...f.split('/'));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf);
    list[f] = hash('sha1', buf);
    bytes += buf.length;
  }
  if (TRIAL) {   // 试装记号：版本.txt 每版内容不同（看换新），只在0.0.N.txt 只这一版有（看删旧）
    for (const [f, text] of [['通用工具/桌面版/试装/版本.txt', `试装 ${TRIAL}\n`], [`通用工具/桌面版/试装/只在${TRIAL}.txt`, `这个文件只在试装 ${TRIAL} 里\n`]]) {
      const buf = Buffer.from(text, 'utf8');
      const to = path.join(TOOLS, ...f.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, buf);
      list[f] = hash('sha1', buf);
    }
  }
  const untracked = mode === 'installer' ? [] : git(['ls-files', '-z', '--others', '--exclude-standard', '--', ...SCOPE]).split('\0').filter(f => f && list[f]);
  const manifest = { 版本: TRIAL || pkg.version, 提交: git(['rev-parse', 'HEAD']).trim(), 改过: dirty.length + untracked.length > 0, 时间: new Date().toISOString(), 文件: list };
  fs.writeFileSync(path.join(TOOLS, '清单.json'), JSON.stringify(manifest, null, 1));
  console.log(`工具文件 ${files.length} 个，${(bytes / 1048576).toFixed(1)} MB → build/tools`);
  if (manifest.改过) console.log(`　其中没提交的改动 ${dirty.length} 个、没进 git 的 ${untracked.length} 个：只能本机试，打安装包前要先提交`);
  return manifest;
}

async function getBuf(url) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`下载没成（${r.status}）：${url}`);
  return Buffer.from(await r.arrayBuffer());
}

/* 校验码先找 nodejs.org 官网要；官网连不上才用镜像的（那样只防得了下坏，提醒一声） */
async function nodeSum() {
  const name = 'win-x64/node.exe';
  for (const base of ['https://nodejs.org/dist', NODE_MIRROR]) {
    try {
      const text = (await getBuf(`${base}/${NODE_VERSION}/SHASUMS256.txt`)).toString('utf8');
      const line = text.split('\n').find(l => l.trim().endsWith(' ' + name));
      if (line) { if (base !== 'https://nodejs.org/dist') console.log('　官网连不上，校验码用的镜像的'); return line.trim().split(/\s+/)[0]; }
    } catch (e) { /* 换下一个 */ }
  }
  throw new Error('拿不到 Node 的校验码');
}

async function ensureNode() {
  const exe = path.join(NODE_DIR, 'node.exe');
  const want = await nodeSum();
  if (fs.existsSync(exe) && hash('sha256', fs.readFileSync(exe)) === want) return exe;
  console.log(`下 Node ${NODE_VERSION}（win-x64/node.exe）…`);
  const buf = await getBuf(`${NODE_MIRROR}/${NODE_VERSION}/win-x64/node.exe`);
  if (hash('sha256', buf) !== want) throw new Error('下下来的 node.exe 校验对不上，不用');
  fs.mkdirSync(NODE_DIR, { recursive: true });
  fs.writeFileSync(exe, buf);
  return exe;
}

function status(port, pathname) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 3000, headers: { Host: `127.0.0.1:${port}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

/* 自检：照装机那样同步进一个空的工作文件夹，用带的 Node 开本机服务，看总览、登录页打不打得开 */
async function selfCheck(manifest, nodeExe) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'antou-pack-'));
  const work = path.join(tmp, 'AI短视频项目');
  let child = null;
  try {
    fs.mkdirSync(work);
    const r = syncTools({ src: TOOLS, work, bundle: manifest.文件, installed: {}, backupDir: path.join(tmp, '备份') });
    if (r.added.length !== Object.keys(manifest.文件).length) throw new Error('自检：同步进去的文件数不对');
    const port = 18700 + Math.floor(Math.random() * 200);
    child = spawn(nodeExe, [path.join(work, '.agents', 'skills', 'annotate-live', 'server.js')], { cwd: work, env: { ...process.env, ANTOU_ROOT: work, ANTOU_PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    let p = null;
    for (let i = 0; i < 80 && child.exitCode === null && !p; i++) { p = await ping(port, 800); if (!p) await sleep(250); }
    if (!p) throw new Error('自检：本机服务没开起来\n' + out.slice(-2000));
    if (path.resolve(p.abs).toLowerCase() !== path.resolve(work).toLowerCase()) throw new Error('自检：服务认的总文件夹不对：' + p.abs);
    for (const page of ['通用工具/流水线/总览.html', '通用工具/桌面版/页面/登录.html', '通用工具/公用/底座.js', '通用工具/公用/界面.js']) {
      const code = await status(port, '/' + page.split('/').map(encodeURIComponent).join('/'));
      if (code !== 200) throw new Error(`自检：${page} 打不开（${code}）`);
    }
    console.log(`自检过了：本机服务第 ${p.v} 版开得起来，总览、登录页都打得开`);
  } finally {
    if (child) killTree(child);
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  }
}

function run(cmd, args, opt = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: 'inherit', windowsHide: true, ...opt });
    c.on('error', reject);
    c.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} ${args.slice(0, 4).join(' ')} … 退出码 ${code}`))));
  });
}

async function ensureElectron() {
  const exe = path.join(DESK, 'node_modules', 'electron', 'dist', 'electron.exe');
  fs.rmSync(path.join(path.dirname(exe), 'debug.log'), { force: true });   // 开发版试跑时 Chromium 写在旁边的，别打进安装包
  if (fs.existsSync(exe)) return;
  console.log('Electron 本体还没下，照镜像下…');
  await run(process.execPath, [path.join(DESK, 'node_modules', 'electron', 'install.js')], { cwd: path.join(DESK, 'node_modules', 'electron'), env: { ...process.env, ELECTRON_MIRROR } });
  if (!fs.existsSync(exe)) throw new Error('Electron 本体没下成');
}

async function builder(extra, out = RELEASE) {
  if (!path.resolve(out).startsWith(DESK + path.sep)) throw new Error('不删桌面版以外的文件夹：' + out);
  fs.rmSync(out, { recursive: true, force: true });
  const args = ['exec', 'electron-builder', '--win', '--x64', '--publish', 'never', '--config.electronDist=node_modules/electron/dist', '--config.directories.output=' + path.relative(DESK, out).split(path.sep).join('/'), ...extra];
  const env = { ...process.env, USE_HARD_LINKS: 'false', CSC_IDENTITY_AUTO_DISCOVERY: 'false', ELECTRON_MIRROR, ELECTRON_BUILDER_BINARIES_MIRROR: BUILDER_MIRROR };
  if (process.platform === 'win32') await run('cmd.exe', ['/d', '/s', '/c', 'pnpm', ...args], { cwd: DESK, env });
  else await run('pnpm', args, { cwd: DESK, env });
}

/* latest.yml 里顶层的一行 */
const ymlGet = (yml, k) => ((yml.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '').trim().replace(/^['"]|['"]$/g, '');

/* 安装包和 latest.yml 对得上：文件名、大小、sha512 */
function verifyFeed(dir, version = pkg.version) {
  const yml = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  const name = ymlGet(yml, 'path'), sum = ymlGet(yml, 'sha512'), ver = ymlGet(yml, 'version');
  if (ver !== version) throw new Error(`latest.yml 的版本 ${ver} 和要打的 ${version} 不一样`);
  const buf = fs.readFileSync(path.join(dir, name));
  if (hash('sha512', buf, 'base64') !== sum) throw new Error('latest.yml 的 sha512 和安装包对不上');
  console.log(`安装包：${path.relative(DESK, path.join(dir, name)).split(path.sep).join('/')}（${(buf.length / 1048576).toFixed(1)} MB），latest.yml 对得上`);
  return { name, buf };
}

/* 签名（开发规范第 34 条）：签「版本号 + 安装包的 sha512」，写进 latest.yml 的 signature 一行；签完拿软件里那把公钥验一遍 */
async function signFeed(dir, version) {
  if (!fs.existsSync(SIGN_KEY)) throw new Error('没有升级签名的私钥：' + SIGN_KEY + '（丢了只能换一对，见 lib/updater.js 开头）');
  const { name, buf } = verifyFeed(dir, version);
  const file = path.join(dir, 'latest.yml');
  const sig = crypto.sign(null, Buffer.from(signedText(version, hash('sha512', buf, 'base64'))), fs.readFileSync(SIGN_KEY)).toString('base64');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^signature:.*\r?\n?/m, '').replace(/\s*$/, '\n') + `signature: '${sig}'\n`);
  if ((await verifyPackage(path.join(dir, name), { version, signature: sig })) !== null) throw new Error('签名和软件里的公钥对不上：私钥换过？');
  const feedYml = fs.readFileSync(path.join(dir, 'win-unpacked', 'resources', 'app-update.yml'), 'utf8');
  if (!/^publisherName:/m.test(feedYml)) throw new Error('包里的 app-update.yml 没有 publisherName：装上的软件不会验签名（electron-builder.yml 的 publish.publisherName）');
  console.log('签好名了，软件里的公钥验得过');
}

/* 在服务器上跑一句；有 input 就把这个本机文件从标准输入灌进去（不用 scp：本机路径有中文） */
function ssh(cmd, input) {
  return new Promise((resolve, reject) => {
    const c = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', DEPLOY_SSH, cmd], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    c.stdout.on('data', d => { out += d; });
    c.stderr.on('data', d => { err += d; });
    c.on('error', reject);
    c.on('exit', code => (code === 0 ? resolve(out) : reject(new Error(`服务器上「${cmd.slice(0, 80)}」没成（${code}）：${err.trim()}`))));
    if (input) fs.createReadStream(input).on('error', reject).pipe(c.stdin);
  });
}
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

/* 传上更新源：安装包、blockmap 先传成 .part、核对了才改名，最后换 latest.yml（传到一半时别人查到的还是旧的那版）；Liushuixian-Setup.exe 指着最新的，给同事一个不变的下载地址 */
async function publish() {
  const dir = path.join(BUILD, 'installer', pkg.version);
  const yml = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  const { name, buf } = verifyFeed(dir);
  if ((await verifyPackage(path.join(dir, name), { version: pkg.version, signature: ymlGet(yml, 'signature') })) !== null) throw new Error('安装包的签名验不过，不传（先 pack.mjs installer）');
  const feed = ((fs.readFileSync(path.join(DESK, 'electron-builder.yml'), 'utf8').match(/^\s+url:\s*(http\S+)/m) || [])[1] || '').replace(/\/*$/, '/');
  if (!feed) throw new Error('electron-builder.yml 里找不到更新源的地址');
  const live = await fetch(feed + 'latest.yml', { cache: 'no-store' }).then(r => (r.ok ? r.text() : '')).catch(() => '');
  const liveVer = /^version:/m.test(live) ? ymlGet(live, 'version') : '';   // 没有这个文件时服务器回的是网站首页
  if (liveVer && !newer(pkg.version, liveVer)) throw new Error(`线上已经是 ${liveVer}，要传的 ${pkg.version} 不比它新（开发规范第 21 条：版本号只升不降）`);
  console.log(`线上现在：${liveVer || '还没有'}，要传：${pkg.version}`);
  await ssh(`mkdir -p ${DEPLOY_DIR}`);
  for (const f of [name, name + '.blockmap']) {
    const local = path.join(dir, f), want = hash('sha512', fs.readFileSync(local));
    console.log(`传 ${f}（${(fs.statSync(local).size / 1048576).toFixed(1)} MB）…`);
    await ssh(`cat > ${DEPLOY_DIR}/${f}.part`, local);
    const got = (await ssh(`sha512sum ${DEPLOY_DIR}/${f}.part`)).trim().split(/\s+/)[0];
    if (got !== want) throw new Error(`${f} 传上去的和本机的对不上`);
    await ssh(`mv -f ${DEPLOY_DIR}/${f}.part ${DEPLOY_DIR}/${f}`);
  }
  await ssh(`cat > ${DEPLOY_DIR}/latest.yml.part`, path.join(dir, 'latest.yml'));
  await ssh(`cd ${DEPLOY_DIR} && mv -f latest.yml.part latest.yml && ln -sfn ${name} Liushuixian-Setup.exe`);
  const back = await fetch(feed + 'latest.yml', { cache: 'no-store' }).then(r => r.text());
  if (back !== yml) throw new Error('从网上取回来的 latest.yml 和本机的不一样');
  const head = await fetch(feed + name, { method: 'HEAD' });
  if (!head.ok || Number(head.headers.get('content-length')) !== buf.length) throw new Error(`网上取 ${name} 不对（${head.status}，${head.headers.get('content-length')} 字节）`);
  console.log(`发好了：${feed}${name}\n给同事的下载地址：${feed}Liushuixian-Setup.exe`);
}

try {
  if (mode === 'publish') { await publish(); process.exit(0); }
  const manifest = stage();
  const nodeExe = await ensureNode();
  await selfCheck(manifest, nodeExe);
  if (mode === 'dir') {
    await ensureElectron();
    await builder(['--dir', '--config.publish=null']);
    console.log('打好了：release/win-unpacked/Liushuixian.exe（本机试用，不带更新通道）');
  } else if (mode === 'installer') {
    await ensureElectron();
    const out = path.join(BUILD, 'installer', pkg.version);
    await builder([], out);
    await signFeed(out, pkg.version);
    console.log(`只打了没传：build/installer/${pkg.version}。本机装一遍点通、问过用户，再 pack.mjs publish（开发规范第 21 条）`);
  } else if (mode === 'trial') {
    await ensureElectron();
    const out = path.join(BUILD, 'trial', TRIAL);
    await builder([
      '--config.extraMetadata.version=' + TRIAL,
      '--config.extraMetadata.name=antou-pipeline-desktop-trial',   // 更新缓存文件夹是「名字-updater」：也和正式版分开
      '--config.extraMetadata.dataDirName=LiushuixianTrial',        // main.js 认它：设置、登录、日志放 %APPDATA%\LiushuixianTrial
      '--config.appId=online.video8.liushuixian.trial',
      '--config.productName=LiushuixianTrial',
      '--config.executableName=LiushuixianTrial',
      '--config.nsis.shortcutName=LiushuixianTrial',
      '--config.publish.provider=generic',
      '--config.publish.url=' + TRIAL_FEED,
    ], out);
    await signFeed(out, TRIAL);
    console.log(`试装包打好了：build/trial/${TRIAL}（只在本机试，不传）`);
  }
} catch (e) {
  console.error('\n没打成：' + e.message);
  process.exit(1);
}
