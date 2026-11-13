#!/usr/bin/env node
/* 技能修改批注页：把提示词格式技能的现状嵌进 通用工具/技能修改批注_提示词格式.html，
   用户在页面上直接改字、加、删、写批注；页面只收改动（存在浏览器里），真文件由 AI 照着改。
     node 技能修改批注.js          技能文件改过以后跑一次，页面换成新的
     node 技能修改批注.js serve    开本机只读服务 http://127.0.0.1:8781/ ，每次打开都是技能文件的现状
   读批注：在右边窗格里跑 skillEdit.text()；或用户点「复制批注」贴进对话。 */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SKILL = { name: 'seedance-prompt-format', title: '提示词格式技能', short: '提示词格式', file: '.agents/skills/seedance-prompt-format/SKILL.md' };
const PAGE = path.join(__dirname, '技能修改批注_' + SKILL.short + '.html');
const PORT = Number(process.env.SKILLEDIT_PORT) || 8781;
const BLOCK = /(<script id="skill-data" type="application\/json">)[\s\S]*?(<\/script>)/;

const two = n => String(n).padStart(2, '0');

/* 页面本身当模板，只换里面那块数据 */
function build() {
  const abs = path.join(ROOT, SKILL.file);
  const buf = fs.readFileSync(abs), d = fs.statSync(abs).mtime;
  const data = {
    name: SKILL.name, title: SKILL.title, short: SKILL.short, file: SKILL.file,
    sha: crypto.createHash('sha256').update(buf).digest('hex'),   // 页面拿它当存批注的钥匙：技能文件一变，旧批注不会套到新行号上
    mtime: `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`,
    text: buf.toString('utf8').replace(/^\uFEFF/, ''),
  };
  const html = fs.readFileSync(PAGE, 'utf8');
  if (!BLOCK.test(html)) throw new Error('页面里没找到 skill-data 块：' + PAGE);
  return html.replace(BLOCK, (m, a, b) => a + JSON.stringify(data).replace(/</g, '\\u003c') + b);
}

function serve() {
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const server = http.createServer((req, res) => {
    const send = (status, body, type) => { res.writeHead(status, { 'Content-Type': (type || 'text/plain') + '; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };
    try {
      if (!hosts.has(req.headers.host || '')) return send(403, 'Host 不对');
      const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (req.method !== 'GET' || (p !== '/' && p !== '/' + path.basename(PAGE))) return send(404, '这里只放 ' + path.basename(PAGE));
      send(200, build(), 'text/html');
    } catch (e) { send(500, e.message || String(e)); }
  });
  server.on('error', e => { console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已经被占了，可能别的会话开着这页` : e.message); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => console.log(`http://127.0.0.1:${PORT}/`));
}

const cmd = process.argv[2];
if (cmd === 'serve') serve();
else if (!cmd) {
  const html = build();
  if (fs.readFileSync(PAGE, 'utf8') === html) console.log('没变化：' + PAGE);
  else { fs.writeFileSync(PAGE, html); console.log('已换成技能文件的现状：' + PAGE); }
} else { console.error('只认两种：不带参数（重嵌）、serve（开服务）'); process.exit(3); }
