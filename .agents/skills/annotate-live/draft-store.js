'use strict';
/* 双模式写稿的保存边界。编辑器字段做乐观锁，AI 字段在提交时合并。
   两个文件先暂存；第二次替换失败时恢复第一次替换。退出前未提交的输入由页面恢复稿保留。 */
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { isDeepStrictEqual } = require('util');

const EDITOR_FIELDS = ['写法', '写法范围', '分镜稿', '自由稿', '镜头信息', '挂图'];
const LATER_FIELDS = ['镜头写法'];   // 后加的（2026-11-20：分镜用合并还是分区写法）：没带它的老页面照旧存，页面带了才比
const own = (x, k) => Object.prototype.hasOwnProperty.call(x, k);
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const error = (status, message) => Object.assign(new Error(message), { status });
const decode = buf => buf.toString('utf8');
const mtime = st => Math.floor(st.mtimeMs);
const pickEditor = (side, more = []) => Object.fromEntries([...EDITOR_FIELDS, ...more].filter(k => own(side, k)).map(k => [k, side[k]]));
/* 页面能存的写稿资料那几样（存稿的 sidePatch；出过片另存的 side，filmed.js）：只认编辑器那几样，值的样子要对 */
function checkSide(patch, what = '草稿保存') {
  if (Object.keys(patch).some(k => !EDITOR_FIELDS.includes(k) && !LATER_FIELDS.includes(k))) throw error(400, what + '不能改 AI 建议等非编辑器字段');
  if (own(patch, '镜头写法') && !['合并', '分区'].includes(patch.镜头写法)) throw error(400, '镜头写法只能是合并或分区');
  if (own(patch, '写法') && !['分镜', '自由'].includes(patch.写法)) throw error(400, '写法只能是分镜或自由');
  if (own(patch, '写法范围') && patch.写法范围 !== '分镜') throw error(400, '写法范围只能是分镜');
  for (const k of ['分镜稿', '自由稿']) if (own(patch, k) && typeof patch[k] !== 'string') throw error(400, k + '必须是文字');
  if (own(patch, '镜头信息') && !Array.isArray(patch.镜头信息)) throw error(400, '镜头信息必须是列表');
  if (own(patch, '挂图') && !object(patch.挂图)) throw error(400, '挂图必须是对象');
}

module.exports = function makeDraftStore({ ROOT, io = fs.promises, now = () => new Date(), RE_VP = require(path.join(__dirname, '..', '..', '..', '通用工具', '公用', '核心.js')).RE_VP, PF_FILE = '', frozen = async () => '', twin = async () => '' }) {   // RE_VP：视频提示词的名字，和页面共用 公用/核心.js；PF_FILE：写初步剧本的段的初步剧本（11-21 起；11-26 起给一组名字：初步剧本.txt、老名字 自由稿.txt），也走这里存；frozen(abs)：出过片的稿给拦下的话（11-22，filmed.js），正文、挂图不许改；twin(abs, text, side)：出过片另存出来的一版，字和素材又和出片的那一版一样，给拦下的话（11-23 晚，filmed.js）
  const pending = new Map();
  const keyOf = p => path.resolve(p).toLowerCase();
  const pfOk = n => Array.isArray(PF_FILE) ? PF_FILE.includes(n) : !!PF_FILE && n === PF_FILE;   // 初步剧本（11-26）：新名字 初步剧本.txt、老名字 自由稿.txt 都认（服务传 PF_FILES）

  // 普通 PUT 和草稿事务共用此锁。多文件按固定顺序取锁，避免相互等待。
  function withLocks(paths, work) {
    const keys = [...new Set(paths.map(keyOf))].sort();
    const previous = keys.map(k => pending.get(k)).filter(Boolean);
    const result = Promise.all(previous.map(p => p.catch(() => {}))).then(work);
    const tail = result.catch(() => {});
    for (const k of keys) pending.set(k, tail);
    tail.then(() => { for (const k of keys) if (pending.get(k) === tail) pending.delete(k); });
    return result;
  }

  function pathsFor(abs) {
    const parts = path.relative(ROOT, abs).split(path.sep);
    if (parts.length !== 5 || parts[0] !== '项目' || !parts[1] || parts[2] !== '提示词' || !/^第[0-9]+(?:-[0-9]+)*段$/.test(parts[3]) || !(RE_VP.test(parts[4]) || pfOk(parts[4]))) {
      throw error(400, '草稿保存只支持 项目/项目名/提示词/第N段/ 里的视频提示词（照镜头号起名的 1-5.txt，照修改方案改出来的 1-5_改1.txt；老稿 视频提示词.txt、视频提示词_02.txt，老名字 4-6_补1.txt……）');
    }
    return { side: abs.replace(/\.txt$/i, '_写稿.json'), hist: path.join(ROOT, '项目', parts[1], '历史记录', ...parts.slice(2, -1)) };
  }
  async function optionalRead(p) {
    try { return await io.readFile(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  function parseSide(buf) {
    if (buf === null) return {};
    let side;
    try { side = JSON.parse(decode(buf).replace(/^\uFEFF/, '')); } catch (e) { throw error(409, '写稿记录不是有效 JSON，已停止保存，原文件未改动'); }
    if (!object(side)) throw error(409, '写稿记录格式不对，已停止保存，原文件未改动');
    return side;
  }
  async function tempFor(p, content) {
    const tmp = p + '.antou-draft-' + randomUUID() + '.tmp';
    try { await io.writeFile(tmp, content, { flag: 'wx' }); return tmp; }
    catch (e) { await io.unlink(tmp).catch(() => {}); throw e; }
  }
  async function restore(p, old) {
    if (old === null) return io.unlink(p);
    const tmp = await tempFor(p, old);
    try { await io.rename(tmp, p); } finally { await io.unlink(tmp).catch(() => {}); }
  }
  async function archive(abs, sidePath, hist, oldText, oldSide) {
    await io.mkdir(hist, { recursive: true });
    const date = now(), two = x => String(x).padStart(2, '0');
    for (let i = 0; i < 120; i++) {
      const d = new Date(date.getTime() + i * 1000);
      const stamp = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds());
      const history = p => path.join(hist, path.basename(p, path.extname(p)) + '__' + stamp + path.extname(p));
      const textHistory = history(abs), sideHistory = history(sidePath);
      if (await optionalRead(textHistory) !== null || await optionalRead(sideHistory) !== null) continue;
      try { await io.writeFile(textHistory, oldText, { flag: 'wx' }); }
      catch (e) { if (e.code === 'EEXIST') continue; throw e; }
      // 写稿 JSON 归档失败时不提交正文；已经保存的原文备份保留。
      if (oldSide !== null) await io.writeFile(sideHistory, oldSide, { flag: 'wx' });
      return;
    }
    throw error(409, '历史记录重名太多，未保存；请稍后再试');
  }

  async function save(abs, body) {
    const { side: sidePath, hist } = pathsFor(abs);
    if (!object(body) || typeof body.text !== 'string' || typeof body.baseText !== 'string' || !object(body.sidePatch) || !object(body.baseEditor)) throw error(400, '缺少 text、baseText、sidePatch 或 baseEditor');
    const more = LATER_FIELDS.filter(k => own(body.sidePatch, k) || own(body.baseEditor, k));
    if (Object.keys(body.baseEditor).some(k => !EDITOR_FIELDS.includes(k) && !LATER_FIELDS.includes(k))) throw error(400, '草稿保存不能改 AI 建议等非编辑器字段');
    checkSide(body.sidePatch);

    return withLocks([abs, sidePath], async () => {
      const oldText = await io.readFile(abs), oldSide = await optionalRead(sidePath);
      const current = parseSide(oldSide);
      if (decode(oldText) !== body.baseText) throw error(409, '提示词已在别处修改；未覆盖文件，页面输入已保留');
      if (!isDeepStrictEqual(pickEditor(current, more), body.baseEditor)) throw error(409, '写稿记录已在别处修改；未覆盖文件，页面输入已保留');
      const merged = { ...current, ...body.sidePatch };
      const newText = Buffer.from(body.text), newSide = Buffer.from(JSON.stringify(merged, null, 2) + '\n');
      const textChanged = !oldText.equals(newText), sideChanged = oldSide === null || !oldSide.equals(newSide);
      if (textChanged || !isDeepStrictEqual(current.挂图 || {}, merged.挂图 || {})) {
        const why = await frozen(abs); if (why) throw error(423, why);   // 出过片的稿：出它的那一份字、那几张图不许动（11-22 他定：只能另存新的一版）
        const same = await twin(abs, body.text, merged); if (same) throw error(422, same);   // 出过片另存出来的一版：字和素材又和出片的那一版一样，不存（11-23 晚他定）
      }
      if (!textChanged && !sideChanged) return { mtime: mtime(await io.stat(abs)), sideMtime: mtime(await io.stat(sidePath)), side: merged };
      let textTmp, sideTmp, textCommitted = false;
      try {
        if (textChanged) textTmp = await tempFor(abs, newText);
        if (sideChanged) sideTmp = await tempFor(sidePath, newSide);
        if (body.archive === true) await archive(abs, sidePath, hist, oldText, oldSide);
        // 文件系统外部写入者不经过队列，提交前再检查一次，冲突时留下它的新内容。
        const checkText = await io.readFile(abs), sideNow = await optionalRead(sidePath);
        if (!checkText.equals(oldText) || !isDeepStrictEqual(sideNow, oldSide)) throw error(409, '保存期间文件又被修改；未覆盖文件，页面输入已保留');
        if (textTmp) { await io.rename(textTmp, abs); textCommitted = true; }
        if (sideTmp) await io.rename(sideTmp, sidePath);
      } catch (e) {
        if (textCommitted) {
          try {
            // 只恢复本事务写下的版本，不覆盖事务外的新改动。
            if (!(await io.readFile(abs)).equals(newText)) throw new Error('正文又在别处变化');
            await restore(abs, oldText);
          } catch (rollback) {
            throw error(500, '保存中断且无法自动恢复（' + rollback.message + '）；请保留页面输入并重新核对正文与写稿记录');
          }
        }
        throw e;
      } finally {
        for (const tmp of [textTmp, sideTmp]) if (tmp) await io.unlink(tmp).catch(() => {});
      }
      return { mtime: mtime(await io.stat(abs)), sideMtime: mtime(await io.stat(sidePath)), side: merged };
    });
  }
  return { save, withLocks };
};
module.exports.pickEditor = pickEditor;
module.exports.checkSide = checkSide;
