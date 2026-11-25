'use strict';
/* 本机服务：工作文件夹里的 .agents\skills\annotate-live\server.js，用安装包带的 Node 跑（开发规范第 12 条：流水线照旧跑）
   端口上已经开着同一个工作文件夹的服务就接着用（开发时 8766 常开着）；是别的文件夹的就停下说清楚。 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const samePath = (a, b) => !!a && !!b && path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/* 问服务在不在：回 { root, v, abs, … }；不在、不是流水线的服务都回 null */
function ping(port, timeout = 1500) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout, headers: { 'X-Antou': '1', Host: `127.0.0.1:${port}` } }, res => {
      let s = '';
      res.setEncoding('utf8');
      res.on('data', d => { s += d; if (s.length > 1e5) req.destroy(); });
      res.on('end', () => { try { resolve(res.statusCode === 200 ? JSON.parse(s) : null); } catch (e) { resolve(null); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/* 连子进程一起关（服务开的 ffmpeg 之类）；Windows 上 kill() 只关得了它自己 */
function killTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill();
}

async function startServer({ nodeExe, work, port, env, log, timeoutMs = 20000 }) {
  const p = await ping(port);
  if (p) {
    if (samePath(p.abs, work)) {
      log.info('本机服务已经开着，接着用', { port, abs: p.abs, v: p.v });
      return { owned: false, info: p, stop() {}, onExit() {} };
    }
    throw new Error(`端口 ${port} 被另一个流水线占着（总文件夹 ${p.abs || p.root}）。先关掉那个，或者在设置里换个端口。`);
  }
  const serverJs = path.join(work, '.agents', 'skills', 'annotate-live', 'server.js');
  if (!fs.existsSync(serverJs)) throw new Error('工作文件夹里没有流水线的本机服务：' + serverJs);
  const out = [];
  const keep = chunk => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      out.push(line);
      if (out.length > 40) out.shift();
      log.info('[服务] ' + line);
    }
  };
  const child = spawn(nodeExe, [serverJs], { cwd: work, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  let exited = null;
  const exitWatchers = [];
  child.on('error', e => { exited = { error: e.message }; log.error('本机服务没开起来', e); });
  child.on('exit', (code, sig) => {
    exited = exited || { code, sig };
    log.warn('本机服务退出了', { code, sig });
    for (const f of exitWatchers) { try { f(exited, out.slice(-12).join('\n')); } catch (e) { /* 各管各的 */ } }
  });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs && !exited) {
    const q = await ping(port, 800);
    if (q) {
      if (!samePath(q.abs, work)) { killTree(child); throw new Error(`端口 ${port} 上回话的不是这个工作文件夹的服务（${q.abs || q.root}）`); }
      log.info('本机服务开好了', { port, v: q.v, ms: Date.now() - t0 });
      return { owned: true, info: q, child, stop: () => killTree(child), onExit: f => exitWatchers.push(f) };
    }
    await sleep(250);
  }
  killTree(child);
  const why = exited ? (exited.error ? '：' + exited.error : `（退出码 ${exited.code}）`) : `（等了 ${Math.round(timeoutMs / 1000)} 秒没回话）`;
  throw new Error('本机服务没开起来' + why + (out.length ? '\n' + out.slice(-12).join('\n') : ''));
}

module.exports = { ping, startServer, killTree, samePath };
