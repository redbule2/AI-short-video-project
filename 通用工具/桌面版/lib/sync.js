'use strict';
/* 把安装包里的工具文件同步进工作文件夹（开发规范第 15、17 条）
   - 只动清单里的文件，路径第一段只许是 AGENTS.md、.agents、通用工具；「项目」一律不碰
   - 工作文件夹里有 .git 的是开发目录：整个跳过，不覆盖
   - 本机改过的工具文件：先备份到 backupDir，再换成新的
   - 新版不要了的文件：本机没改过才删；改过的留着
   bundle：安装包这一版的 { '通用工具/公用/底座.js': sha1, … }
   installed：上回装进去的那份（存在设置里），用来认「本机改没改过」 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOPS = new Set(['AGENTS.md', '.agents', '通用工具']);
const HASH = /^[0-9a-f]{40}$/;

function sha1File(p) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex'); }
  catch (e) { if (e.code === 'ENOENT' || e.code === 'EISDIR' || e.code === 'ENOTDIR') return null; throw e; }
}

/* 清单里的路径：用 / 分开的一串名字；不许 ..、盘符、反斜杠，第一段只许是三样之一 */
function safeRel(rel) {
  if (typeof rel !== 'string' || !rel || rel.includes('\\') || rel.includes('\0')) return null;
  const parts = rel.split('/');
  if (parts.some(s => !s || s === '.' || s === '..' || /[:*?"<>|]/.test(s) || /[. ]$/.test(s))) return null;
  if (!TOPS.has(parts[0])) return null;
  if ((parts[0] === 'AGENTS.md') !== (parts.length === 1)) return null;
  return parts;
}

const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/* 杀毒软件正扫着的文件换名会被拒：等一下再试几回 */
function retry(fn) {
  for (let i = 0; ; i++) {
    try { return fn(); }
    catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      pause(200 * (i + 1));
    }
  }
}

function copyAtomic(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const tmp = to + '.antou-tmp';
  fs.copyFileSync(from, tmp);
  retry(() => fs.renameSync(tmp, to));
}

/* 删完文件，往上把空了的文件夹也删掉；三样顶层文件夹本身留着 */
function pruneEmpty(dir, work) {
  for (let d = dir; ; d = path.dirname(d)) {
    const rel = path.relative(work, d);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !rel.includes(path.sep)) return;
    try { if (fs.readdirSync(d).length) return; fs.rmdirSync(d); } catch (e) { return; }
  }
}

function syncTools({ src, work, bundle, installed = {}, backupDir, log = () => {} }) {
  const res = { skipped: '', added: [], updated: [], backedUp: [], removed: [], kept: [], bad: [] };
  if (fs.existsSync(path.join(work, '.git'))) {
    res.skipped = '工作文件夹是开发目录（有 .git），工具不覆盖';
    return { ...res, installed };
  }
  fs.mkdirSync(path.join(work, '项目'), { recursive: true });
  const next = {};
  for (const [rel, hash] of Object.entries(bundle)) {
    const parts = safeRel(rel);
    if (!parts || !HASH.test(hash)) { res.bad.push(rel); continue; }
    const to = path.join(work, ...parts);
    const cur = sha1File(to);
    if (cur === hash) { next[rel] = hash; continue; }
    if (cur && installed[rel] !== cur) {   // 本机改过，或者认不出是哪一版：先备份
      const b = path.join(backupDir, ...parts);
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.copyFileSync(to, b);
      res.backedUp.push(rel);
    }
    copyAtomic(path.join(src, ...parts), to);
    if (sha1File(to) !== hash) throw new Error('装进去的文件和安装包里的对不上：' + rel);
    (cur ? res.updated : res.added).push(rel);
    next[rel] = hash;
  }
  for (const [rel, hash] of Object.entries(installed)) {
    if (Object.prototype.hasOwnProperty.call(bundle, rel)) continue;
    const parts = safeRel(rel);
    if (!parts) continue;
    const to = path.join(work, ...parts);
    const cur = sha1File(to);
    if (!cur) continue;
    if (cur === hash) { retry(() => fs.unlinkSync(to)); res.removed.push(rel); pruneEmpty(path.dirname(to), work); }
    else res.kept.push(rel);   // 新版不要了，可本机改过：留着
  }
  log('工具同步完', { 新加: res.added.length, 换新: res.updated.length, 备份: res.backedUp.length, 删掉: res.removed.length, 留着: res.kept.length, 不认: res.bad.length });
  return { ...res, installed: next };
}

module.exports = { syncTools, safeRel, sha1File };
