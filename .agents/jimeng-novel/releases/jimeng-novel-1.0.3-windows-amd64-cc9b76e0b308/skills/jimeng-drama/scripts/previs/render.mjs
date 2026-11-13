#!/usr/bin/env node
/* render.mjs — 预演 JSON → 自包含 HTML →（Playwright 逐帧截图 + ffmpeg）→ mp4
 *
 * 用法：
 *   node render.mjs <previs.json> -o out.mp4           渲染 mp4（默认带叠字）
 *   node render.mjs <previs.json> --report             只做校验 + 打印每个镜头的取景摘要（不需要浏览器）
 *   node render.mjs <previs.json> --html out.html      只输出自包含 HTML（浏览器打开可播放/录制 webm）
 *   node render.mjs <previs.json> --stills dir/        每个镜头首/中/尾各出一张 PNG，用于检查
 * 选项：
 *   --clean            不叠加镜头编号/时间/角色名
 *   --fps N            覆盖 fps；--short-side N 覆盖短边像素（默认 480）
 *   --crf N            x264 质量（默认 28，越大越小）
 *   --chrome PATH      指定 Chrome/Chromium 可执行文件（也可用环境变量 PREVIS_CHROME）
 * 环境变量：FFMPEG=/path/to/ffmpeg 指定 ffmpeg；否则自动探测 PATH / imageio-ffmpeg 并选版本最新且带 libx264 的。
 * 退出码：0 成功；2 预演 JSON 有错误；3 缺依赖（会尽量留下 HTML 作为降级产物）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const E = require('./previs_eval.cjs');

// ------------------------------------------------------------------ args
function parseArgs(argv) {
  const o = { input: null, out: null, html: null, stills: null, report: false, clean: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '-o' || a === '--out') o.out = next();
    else if (a === '--html') o.html = next();
    else if (a === '--stills') o.stills = next();
    else if (a === '--report') o.report = true;
    else if (a === '--clean') o.clean = true;
    else if (a === '--fps') o.fps = Number(next());
    else if (a === '--short-side') o.shortSide = Number(next());
    else if (a === '--crf') o.crf = Number(next());
    else if (a === '--chrome') o.chrome = next();
    else if (a === '-h' || a === '--help') { o.help = true; }
    else if (!o.input) o.input = a;
    else throw new Error('未知参数 ' + a);
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.input) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).join('\n').replace(/^ ?\*\/?/gm, ''));
  process.exit(args.help ? 0 : 1);
}

const raw = JSON.parse(fs.readFileSync(args.input, 'utf8'));
if (args.fps) raw.fps = args.fps;
if (args.shortSide) { raw.shortSide = args.shortSide; delete raw.resolution; }
if (args.clean) raw.overlay = Object.assign({}, raw.overlay, { enabled: false });
const { spec, errors, warnings } = E.normalize(raw);
warnings.forEach(w => console.error('[warn] ' + w));
if (errors.length) { errors.forEach(e => console.error('[error] ' + e)); process.exit(2); }
console.error(`[previs] ${spec.id || path.basename(args.input)}: ${spec.width}x${spec.height} ${spec.fps}fps ${spec.duration}s, ${spec.shots.length} 镜头, ${spec.characters.length} 角色`);

// ------------------------------------------------------------------ report（纯数学，不需要浏览器）
function fmt(v) { return '[' + v.map(x => x.toFixed(2)).join(', ') + ']'; }
function report() {
  const lines = [];
  for (const s of spec.shots) {
    lines.push(`镜头 ${s.id} ${s.label || ''} [${s.t[0]}–${s.t[1]}s]${s.shake ? ' 手持' + s.shake : ''}`);
    const ts = [s.t[0], (s.t[0] + s.t[1]) / 2, Math.min(s.t[1], spec.duration) - 1 / spec.fps];
    for (const [tag, t] of [['首', ts[0]], ['中', ts[1]], ['尾', ts[2]]]) {
      const cam = E.cameraState(spec, t);
      const vis = spec.characters.map(c => {
        const head = E.project(cam, spec.aspect, E.anchor(spec, c.id + ':head', t));
        const feet = E.project(cam, spec.aspect, E.anchor(spec, c.id + ':feet', t));
        const inside = p => p.depth > 0 && Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1;
        const st = E.charState(spec, c.id, t);
        const dist = Math.hypot(cam.pos[0] - st.pos[0], cam.pos[2] - st.pos[2]);
        if (dist < 0.25 && cam.pos[1] < st.pos[1] + c.height * st.poseFactor + 0.1) return `${c.name}:⚠相机在身体内(距${dist.toFixed(2)}m)`;
        if (head.depth <= 0 && feet.depth <= 0) return `${c.name}:身后`;
        const where = inside(head) ? (inside(feet) ? '全身入画' : '头在画内') : (inside(feet) ? '仅脚部' : '画外');
        const hx = isFinite(head.x) ? head.x.toFixed(2) : '-', hy = isFinite(head.y) ? head.y.toFixed(2) : '-';
        return `${c.name}:${where}(头 x=${hx},y=${hy}; 距${dist.toFixed(1)}m)`;
      });
      const focal = 43.27 / 2 / Math.tan(Math.atan(Math.tan(cam.vfov * Math.PI / 360) * Math.sqrt(1 + spec.aspect ** 2)));
      lines.push(`  ${tag} t=${t.toFixed(2)} cam=${fmt(cam.pos)} look=${fmt(cam.look)} 焦距≈${focal.toFixed(0)}mm vfov=${cam.vfov.toFixed(1)}°  ${vis.join('  ')}`);
    }
  }
  return lines.join('\n');
}
if (args.report) {
  console.log(report());
  if (!args.out && !args.html && !args.stills) process.exit(0);
}

// ------------------------------------------------------------------ HTML
function escapeHtmlText(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value ?? '').replace(/[&<>"']/g, char => entities[char]);
}

function buildHtml() {
  const read = f => fs.readFileSync(path.join(HERE, f), 'utf8');
  const safe = s => s.replace(/<\/script/gi, '<\\/script');
  const json = JSON.stringify(raw).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><title>previs ${escapeHtmlText(spec.id)}</title>
<style>html,body{margin:0;padding:0;background:#000}</style></head><body>
<script>${safe(read('vendor/three.min.js'))}</script>
<script>${safe(read('previs_eval.cjs'))}</script>
<script>window.PREVIS_SPEC=${json};</script>
<script>${safe(read('previs_view.js'))}</script>
</body></html>`;
}
const html = buildHtml();
if (args.html) {
  fs.mkdirSync(path.dirname(path.resolve(args.html)), { recursive: true });
  fs.writeFileSync(args.html, html);
  console.error(`[previs] HTML 已写出：${args.html}（浏览器打开即可播放；点「录制 webm」可导出视频）`);
  if (!args.out && !args.stills) process.exit(0);
}
if (!args.out && !args.stills) { console.error('需要 -o out.mp4、--stills dir、--html file 或 --report 之一'); process.exit(1); }

// ------------------------------------------------------------------ 依赖探测
function fallbackHtml(reason) {
  const p = args.html || (args.out ? args.out.replace(/\.[^.\/]+$/, '') + '.html' : path.join(args.stills, 'previs.html'));
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  if (!args.html) fs.writeFileSync(p, html);
  console.error(`[previs] ${reason}\n[previs] 已降级输出 HTML：${p} —— 在桌面浏览器打开，点「录制 webm」或用系统录屏得到预演视频。`);
  process.exit(3);
}

async function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { const m = await import(name); return m.default || m; } catch { /* next */ }
  }
  const roots = [];
  if (process.env.NODE_PATH) roots.push(...process.env.NODE_PATH.split(path.delimiter));
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8' });
  if (npm.status === 0) roots.push(npm.stdout.trim());
  for (const root of roots) {
    for (const name of ['playwright', 'playwright-core']) {
      if (fs.existsSync(path.join(root, name, 'package.json'))) {
        try { return createRequire(path.join(root, 'noop.js'))(name); } catch { /* next */ }
      }
    }
  }
  return null;
}

function chromeCandidates() {
  const list = [];
  for (const v of [args.chrome, process.env.PREVIS_CHROME]) if (v && !fs.existsSync(v)) console.error(`[warn] 指定的 Chrome 不存在：${v}，改为自动查找`);
  for (const v of [args.chrome, process.env.PREVIS_CHROME, process.env.CHROME_PATH]) if (v) list.push(v);
  const home = os.homedir();
  const globDirs = (base, sub) => {
    try { return fs.readdirSync(base).sort().reverse().map(d => path.join(base, d, sub)); } catch { return []; }
  };
  list.push(...globDirs(path.join(home, '.cache/puppeteer/chrome-headless-shell'), 'chrome-headless-shell-linux64/chrome-headless-shell'));
  list.push(...globDirs(path.join(home, '.cache/puppeteer/chrome'), 'chrome-linux64/chrome'));
  list.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
  return list.filter(p => { try { return fs.statSync(p).isFile(); } catch { return false; } });
}

const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'];
async function launchBrowser(pw) {
  const errs = [];
  const explicit = args.chrome || process.env.PREVIS_CHROME;
  if (!explicit) {
    try { return await pw.chromium.launch({ headless: true, args: GL_ARGS }); } catch (e) { errs.push(String(e.message).split('\n')[0]); }
  }
  for (const exe of chromeCandidates()) {
    try { return await pw.chromium.launch({ headless: true, executablePath: exe, args: GL_ARGS }); } catch (e) { errs.push(exe + ': ' + String(e.message).split('\n')[0]); }
  }
  throw new Error('无法启动 Chromium：\n  ' + errs.join('\n  ') + '\n  可执行 `npx playwright install chromium`，或用 --chrome / PREVIS_CHROME 指定本机 Chrome。');
}

function probeFfmpeg(exe) {
  const r = spawnSync(exe, ['-version'], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) return null;
  const m = /ffmpeg version \D*(\d+)\.(\d+)/.exec(r.stdout);
  const enc = spawnSync(exe, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return { exe, major: m ? Number(m[1]) + Number(m[2]) / 100 : 0, x264: /libx264/.test(enc.stdout || ''), line: r.stdout.split('\n')[0] };
}
function findFfmpeg() {
  if (process.env.FFMPEG) {
    const p = probeFfmpeg(process.env.FFMPEG);
    if (!p) throw new Error('FFMPEG=' + process.env.FFMPEG + ' 无法执行');
    return p;
  }
  const cands = new Set(['ffmpeg']);
  const py = spawnSync('python3', ['-I', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) cands.add(py.stdout.trim());
  const libDir = path.join(os.homedir(), '.local/lib');
  try {
    for (const d of fs.readdirSync(libDir)) {
      const b = path.join(libDir, d, 'site-packages/imageio_ffmpeg/binaries');
      try { for (const f of fs.readdirSync(b)) if (f.startsWith('ffmpeg')) cands.add(path.join(b, f)); } catch { /* none */ }
    }
  } catch { /* none */ }
  const found = [...cands].map(probeFfmpeg).filter(Boolean);
  found.sort((a, b) => (b.x264 - a.x264) || (b.major - a.major));
  return found[0] || null;
}

// ------------------------------------------------------------------ render
async function main() {
  const pw = await loadPlaywright();
  if (!pw) fallbackHtml('未找到 Playwright（npm i -g playwright 或在本目录 npm i playwright）。');
  let ff = null;
  if (args.out) {
    ff = findFfmpeg();
    if (!ff) fallbackHtml('未找到 ffmpeg（设置 FFMPEG=/path/to/ffmpeg，或 pip install imageio-ffmpeg）。');
    console.error(`[previs] ffmpeg: ${ff.exe} (${ff.line}${ff.x264 ? '' : '，无 libx264，改用 mpeg4'})`);
  }
  const t0 = Date.now();
  let browser;
  try { browser = await launchBrowser(pw); } catch (e) { fallbackHtml(e.message); }
  const page = await browser.newPage({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: 1 });
  const consoleErrs = [];
  page.on('pageerror', e => consoleErrs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') consoleErrs.push(m.text()); });
  await page.route('**/*', r => r.abort());  // 页面全内联，不需要任何网络请求
  await page.addInitScript(() => { window.__PREVIS_HEADLESS = true; });
  await page.setContent(html, { waitUntil: 'load' });
  try { await page.waitForFunction(() => window.previs && window.previs.ready, null, { timeout: 30000 }); }
  catch { await browser.close(); throw new Error('页面初始化失败（WebGL 不可用？）：' + consoleErrs.join(' | ')); }
  const tLoad = Date.now();

  // 视频帧走 JPEG（浏览器端编码比 PNG 快约一倍），stills 用 PNG
  const grab = async (t, jpeg) => {
    const url = await page.evaluate(([tt, j]) => window.previs.capture(tt, j ? 'image/jpeg' : 'image/png', 0.92), [t, !!jpeg]);
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };

  if (args.stills) {
    fs.mkdirSync(args.stills, { recursive: true });
    for (const s of spec.shots) {
      const ts = { start: s.t[0], mid: (s.t[0] + s.t[1]) / 2, end: Math.min(s.t[1], spec.duration) - 1 / spec.fps };
      for (const [k, t] of Object.entries(ts)) {
        const f = path.join(args.stills, `shot${String(s.id).replace(/[^\w.-]/g, '_')}_${k}.png`);
        fs.writeFileSync(f, await grab(t));
      }
    }
    console.error(`[previs] stills → ${args.stills}（每镜头 start/mid/end）`);
  }

  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    const n = Math.round(spec.duration * spec.fps);
    const venc = ff.x264
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(args.crf || 28), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
      : ['-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p'];
    const ffArgs = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(spec.fps), '-c:v', 'mjpeg', '-i', '-',
      ...venc, '-r', String(spec.fps), '-frames:v', String(n), path.resolve(args.out)];
    const proc = spawn(ff.exe, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((res, rej) => { proc.on('error', rej); proc.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg 退出码 ' + c))); });
    for (let i = 0; i < n; i++) {
      const buf = await grab(i / spec.fps, true);
      if (!proc.stdin.write(buf)) await new Promise(r => proc.stdin.once('drain', r));
      if (i % spec.fps === 0) process.stderr.write(`\r[previs] 渲染 ${i}/${n}`);
    }
    proc.stdin.end();
    await done;
    process.stderr.write(`\r[previs] 渲染 ${n}/${n}\n`);
    const tEnd = Date.now();
    console.error(`[previs] 完成 ${args.out}  ${(fs.statSync(args.out).size / 1024).toFixed(0)}KB  启动 ${(tLoad - t0) / 1000}s + 渲染编码 ${(tEnd - tLoad) / 1000}s`);
  }
  if (consoleErrs.length) console.error('[previs] 页面报错：' + consoleErrs.join(' | '));
  await browser.close();
}

main().catch(e => { console.error('[previs] 失败：' + (e && e.message || e)); process.exit(1); });
