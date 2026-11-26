/* 命名巡逻（2026-11-26 他定）：本机服务隔五分钟把项目文件夹扫一遍，名字、位置不合 AGENTS.md 规矩的（老文件名单上的不算）列出来，流水线顶栏亮个数，点开一条条看。
   AI 写的时候门卫（.agents/hooks/naming-gate.js）已经提醒过；这里管别的程序存的、人手放进来的，还有门卫掉了以后漏的。规矩只有一份：通用工具/公用/命名规则.js。
   头一回开（还没有老文件名单）：把那时候不合规的都记成老文件，以后只报新出的。
   GET  /api/naming                 { 时间, 问题: [{ rel, dir, why, fix }], 出错, 门卫: { claude, codex } }；?fresh 先扫一遍再给
   POST /api/naming { rel, 改成 }   照规矩改名：只许改成规矩给的那个名字；那里已经有同名的、项目里有字提到它（参考素材映射、提示词、流水线.json…）、文件正被别的程序开着，都不改，说清楚
   POST /api/naming { rel, 不用改 }  记进老文件名单，以后不再提
   POST /api/naming { 装门卫 }       门卫掉了（Claude、Codex 的设置被重置过）再装上
   页面那一半：通用工具/流水线/命名巡逻.js。测试：node --test 通用工具/测试/命名巡逻_测试.cjs */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

module.exports = function ({ ROOT, TOOLS, log, withLocks, noWatch }) {
  const NR = require(path.join(TOOLS, '公用', '命名规则.js'));
  const GATE = path.join(__dirname, '..', '..', 'hooks', 'naming-gate.js');
  const EVERY = 5 * 60e3;
  const TEXT = /\.(txt|md|json|html?)$/i;
  const NOT_IN = new Set(['历史记录', '.claude', '.codex', 'node_modules', '__pycache__']);
  const httpErr = (status, msg) => Object.assign(new Error(msg), { status });
  let last = { at: 0, items: [], err: '' };

  function oldSet() {
    let old = NR.loadOld();
    if (!old) {
      old = new Set(NR.scan({ root: ROOT }).map(x => x.rel));
      NR.saveOld(old, undefined, ROOT);
      log('命名巡逻：头一回开，现在不合规的 ' + old.size + ' 处记成老文件，以后只报新出的');
    }
    return old;
  }
  function run() {
    try { last = { at: Date.now(), items: NR.scan({ root: ROOT, old: oldSet() }).map(({ rel, dir, why, fix }) => ({ rel, dir, why, fix })), err: '' }; }
    catch (e) { last = { ...last, at: Date.now(), err: e.message }; log('命名巡逻没扫成：' + e.message); }
    return last;
  }
  function gate() {
    try { return require(GATE).status(); } catch (e) { return { claude: null, codex: null, err: e.message }; }
  }

  /* 项目里哪些字提到了这个名字（历史记录里的不算）：有就不替他改，免得改了名、那边断了 */
  function findRefs(rel) {
    const parts = rel.split('/'), name = parts[parts.length - 1], hits = [];
    if (parts[0] !== '项目' || parts.length < 3) return hits;
    const walk = (dir, depth) => {
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of ents) {
        if (hits.length >= 8) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!NOT_IN.has(e.name) && depth < 8) walk(p, depth + 1); continue; }
        if (!TEXT.test(e.name)) continue;
        const r = path.relative(ROOT, p).split(path.sep).join('/');
        if (r === rel) continue;
        try { if (fs.statSync(p).size <= 4e6 && fs.readFileSync(p, 'utf8').includes(name)) hits.push(r); } catch (e2) {}
      }
    };
    walk(path.join(ROOT, '项目', parts[1]), 0);
    return hits;
  }

  async function rename(rel, to) {
    const abs = path.join(ROOT, ...rel.split('/'));
    const w = NR.checkPath(abs, { root: ROOT, old: oldSet() });
    if (!w || w.rel !== rel) throw httpErr(409, '这一样现在合规矩了，或者已经挪走了。刷新看看');
    if (!w.fix || w.fix !== to) throw httpErr(400, w.fix ? '只能照规矩改成「' + w.fix + '」' : '这一样给不出照规矩的名字，要你自己定');
    const dest = path.join(path.dirname(abs), to);
    if (fs.existsSync(dest)) throw httpErr(409, '那里已经有「' + to + '」了，没改。两样留哪个，你来定');
    const refs = findRefs(rel);
    if (refs.length) throw httpErr(409, '有地方写着它，没改（改名要连那里一起改，交给 AI 或你自己来）：' + refs.join('、'));
    try { await withLocks([abs, dest], () => fsp.rename(abs, dest)); }
    catch (e) { if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw httpErr(409, '它正被别的程序开着（剪映、Blender、WPS…），关掉再改'); throw e; }
    log('命名巡逻：' + rel + ' 改名成 ' + to);
    return run();
  }
  function keep(rel) {
    if (!last.items.some(x => x.rel === rel) && !run().items.some(x => x.rel === rel)) throw httpErr(409, '这一样已经不在单子上了。刷新看看');
    const old = oldSet();
    old.add(rel);
    NR.saveOld(old, undefined, ROOT);
    log('命名巡逻：' + rel + ' 记成不用改');
    return run();
  }

  async function handle(req, res, url, { json, readBody }) {
    if (req.method === 'GET') {
      if (url.searchParams.has('fresh') || Date.now() - last.at > EVERY) run();
      return json(res, { 时间: last.at, 问题: last.items, 出错: last.err, 门卫: gate() });
    }
    if (req.method !== 'POST') throw httpErr(405, '只认 GET、POST');
    let b;
    try { b = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}'); } catch (e) { if (e.status) throw e; throw httpErr(400, '请求不是有效 JSON'); }
    if (b.装门卫) {
      const G = require(GATE);
      G.install('claude'); G.install('codex');
      log('命名巡逻：门卫重新装上');
      return json(res, { 门卫: G.status() });
    }
    const rel = typeof b.rel === 'string' ? b.rel : '';
    if (!rel || rel.split('/').some(s => !s || s === '.' || s === '..' || /[\\:]/.test(s))) throw httpErr(400, '路径不对');
    if (b.不用改) return json(res, { 问题: keep(rel).items });
    if (typeof b.改成 === 'string') return json(res, { 问题: (await rename(rel, b.改成)).items });
    throw httpErr(400, '要改名还是不用改？');
  }

  if (!noWatch) { setTimeout(run, 3000).unref(); setInterval(run, EVERY).unref(); }
  return { handle, run, findRefs };
};
