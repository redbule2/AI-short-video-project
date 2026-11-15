#!/usr/bin/env node
/* 给流水线教程截图：开一个无头 Chrome，照「截图步骤.json」一步一步点页面、截图，
   每张图旁边记下要画框的那几样东西在图上的位置（框.json），视频和 PDF 照它画框、放大。
     node 截图.js <课的文件夹>
   截图步骤.json：
     { "网址": "http://localhost:8797/通用工具/流水线/",   ← 截图用试验服务（项目副本），别拿正式项目点
       "视口": [1280, 720], "倍数": 3,                      ← 页面按 1280×720 排，图按 3 倍出（放大也清楚）
       "假接口": { "/api/jimeng": {…} },                    ← 这些接口不真去问，回这里写的（如即梦账号名）
       "步骤": [ { "开": "总览.html?p=童晓晓", "等": 1500 },
                 { "跑": "页面里执行的 JS", "等": 600 },
                 { "截": "首页", "整页": true, "框": { "换项目": "text:换项目", "设定": ".wf-tiles" } } ] }
   框的写法：CSS 选择器取第一个；"text:字" 取文字正好是这几个字的最小那一个元素；"js:表达式" 取表达式算出的元素。位置按页面像素（没乘倍数）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const dir = path.resolve(process.argv[2] || '.');
const plan = JSON.parse(fs.readFileSync(path.join(dir, '截图步骤.json'), 'utf8'));
const [VW, VH] = plan.视口 || [1280, 720];
const DPR = plan.倍数 || 3;
const PORT = 9300 + Math.floor(Math.random() * 500);
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--window-size=' + VW + ',' + VH,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  try {
    let list = null;
    for (let i = 0; i < 50 && !list; i++) { await sleep(200); try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); } catch (e) { list = null; } }
    const page = list.find(t => t.type === 'page');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
    let seq = 0; const wait = new Map(), on = new Map();
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && wait.has(m.id)) { const w = wait.get(m.id); wait.delete(m.id); m.error ? w.bad(new Error(m.error.message)) : w.ok(m.result); }
      else if (m.method && on.has(m.method)) on.get(m.method)(m.params);
    };
    const cdp = (method, params = {}) => new Promise((ok, bad) => { const id = ++seq; wait.set(id, { ok, bad }); ws.send(JSON.stringify({ id, method, params })); });
    const fakes = plan.假接口 || {};
    on.set('Fetch.requestPaused', p => {
      const hit = Object.keys(fakes).find(k => p.request.url.includes(k));
      if (!hit) return cdp('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
      cdp('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
        body: Buffer.from(JSON.stringify(fakes[hit]), 'utf8').toString('base64') }).catch(() => {});
    });
    let loaded = null; on.set('Page.loadEventFired', () => { if (loaded) loaded(); });
    await cdp('Page.enable'); await cdp('Runtime.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false });
    if (Object.keys(fakes).length) await cdp('Fetch.enable', { patterns: Object.keys(fakes).map(k => ({ urlPattern: '*' + k + '*' })) });
    const js = async expr => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text)); return r.result.value; };
    const boxes = fs.existsSync(path.join(dir, '框.json')) ? JSON.parse(fs.readFileSync(path.join(dir, '框.json'), 'utf8')) : {};
    for (const st of plan.步骤) {
      if (st.开) { const p = new Promise(r => { loaded = r; }); await cdp('Page.navigate', { url: plan.网址 + st.开 }); await Promise.race([p, sleep(15000)]); loaded = null; }
      if (st.跑) await js('(async () => { ' + st.跑 + ' })()');
      if (st.等) await sleep(st.等);
      if (st.截) {
        const want = st.框 || {};
        const found = await js('(' + findBoxes.toString() + ')(' + JSON.stringify(want) + ')');
        const H = st.整页 ? Math.ceil(await js('Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)')) : VH;
        if (st.整页) await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: H, deviceScaleFactor: DPR, mobile: false });
        await sleep(st.整页 ? 400 : 50);
        const shot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
        if (st.整页) await cdp('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: DPR, mobile: false });
        const file = '截图_' + st.截 + '.png';
        fs.writeFileSync(path.join(dir, file), Buffer.from(shot.data, 'base64'));
        boxes[st.截] = { 图: file, 宽: VW, 高: H, 倍数: DPR, 框: found };
        const miss = Object.keys(want).filter(k => !found[k]);
        console.log('截好', file, VW + '×' + H, miss.length ? '　没找到：' + miss.join('、') : '');
      }
    }
    fs.writeFileSync(path.join(dir, '框.json'), JSON.stringify(boxes, null, 1));
    ws.close();
  } finally {
    chrome.kill();
    await sleep(500);
    try { fs.rmSync(prof, { recursive: true, force: true }); } catch (e) { /* Chrome 还占着就留给系统清 */ }
  }
}

/* 在页面里跑：按名字找元素，回 {名: [x, y, w, h]}（页面坐标，含滚动） */
function findBoxes(want) {
  const out = {};
  const all = [...document.querySelectorAll('body *')];
  for (const [name, sel] of Object.entries(want)) {
    let el = null;
    if (sel.startsWith('js:')) { try { el = (0, eval)(sel.slice(3)) || null; } catch (e) { el = null; } }
    else if (sel.startsWith('text:')) {
      const t = sel.slice(5);
      const hits = all.filter(e => e.offsetParent !== null && e.textContent.replace(/\s+/g, '') === t.replace(/\s+/g, ''));
      el = hits.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0] || null;
      if (el) { const b = el.closest('button, a, .wf-pill, .wf-tile'); if (b && b.textContent.replace(/\s+/g, '') === t.replace(/\s+/g, '')) el = b; }
    } else el = document.querySelector(sel);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out[name] = [Math.round(r.left + scrollX), Math.round(r.top + scrollY), Math.round(r.width), Math.round(r.height)];
  }
  return out;
}

main().catch(e => { console.error(e.stack || e.message); process.exit(1); });
