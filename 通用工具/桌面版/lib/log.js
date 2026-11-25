'use strict';
/* 桌面版的日志：userData\logs\桌面版-年月日.log，一天一份，留 14 天。
   密钥、密码、登录凭证一律打码再记（开发规范第 16、20 条）。 */
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 14;
const SECRET_KEY = /(token|password|passwd|secret|authorization|cookie|api[-_]?key|密码|密钥)/i;
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const hms = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/* 像密钥的值换成 ***：对象按键名认；字符串里的 Bearer 凭证、长 JWT 也打码 */
function scrub(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === 'string') return v.replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer ***').replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '***');
  if (v instanceof Error) return { name: v.name, message: scrub(v.message), stack: scrub(String(v.stack || '')) };
  if (typeof v !== 'object' || depth > 5) return v;
  if (Array.isArray(v)) return v.map(x => scrub(x, depth + 1));
  const o = {};
  for (const k of Object.keys(v)) o[k] = SECRET_KEY.test(k) ? '***' : scrub(v[k], depth + 1);
  return o;
}

function makeLog(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* 建不了就只是记不下 */ }
  const fileOf = d => path.join(dir, '桌面版-' + ymd(d) + '.log');
  function write(level, msg, extra) {
    const d = new Date();
    let line = `${hms(d)} ${level} ${scrub(String(msg))}`;
    if (extra !== undefined) {
      try { line += ' ' + (typeof extra === 'string' ? scrub(extra) : JSON.stringify(scrub(extra))); }
      catch (e) { line += ' [记不下]'; }
    }
    try { fs.appendFileSync(fileOf(d), line + '\n', 'utf8'); } catch (e) { /* 盘满了之类：不影响用 */ }
  }
  try {   // 14 天前的删掉
    const cut = Date.now() - KEEP_DAYS * 864e5;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (/^桌面版-\d{8}\.log$/.test(f) && fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p);
    }
  } catch (e) { /* 不要紧 */ }
  return {
    dir,
    file: () => fileOf(new Date()),
    info: (m, x) => write('INFO', m, x),
    warn: (m, x) => write('WARN', m, x),
    error: (m, x) => write('ERROR', m, x),
    /* 今天的最后几行：出错时摆给人看 */
    tail(n = 30) {
      try { return fs.readFileSync(fileOf(new Date()), 'utf8').split('\n').filter(Boolean).slice(-n).join('\n'); }
      catch (e) { return ''; }
    },
  };
}

module.exports = { makeLog, scrub };
