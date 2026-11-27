'use strict';
/* ============================================================
   即梦命令行还认不认流水线的命令（2026-11-26）。
   来历：11-26 命令行从 1.3.0 升到 1.4.2，「node find」改叫「node ls」、「model list」改叫「model ls」，老名字不认了。
   流水线还喊老名字，点「批准出片」回回停在「查画布上的…没查成…过一会儿再点」——其实再点多少回都一样。
   现在：流水线用到的每一句命令、每个参数都记在 USED。出片前问命令行要一份它自己的命令清单
   （schema：本机就答，不联网，约一秒），有一句对不上就先停，明说是命令行升级后对不上了、叫 AI 来改——花积分以前就拦住。
   命令行文件没换过（大小、修改时间一样）就不重问；清单读不到的不拦、不记（没有 schema 的老版本照旧往下走）。
   流水线新用了哪句即梦命令，要在 USED 里补上：各测试里假的即梦命令行每条都拿 missing 核，漏了测试不过。
   升级命令行以后跑一遍 通用工具/测试/即梦命令清单_测试.cjs，里面有一条是拿这台电脑上真的命令行核的。
   ============================================================ */
const fsp = require('fs').promises;

const ASSET = ['project-id', 'node-id', 'update-id', 'submit-id', 'title', 'resource-id', 'import-kind'];   // 把传好的素材挂成独立节点
const RENAME = ['project-id', 'node-id', 'update-id', 'title'];                                              // 给节点改名
const GEN = ['mode', 'model', 'ratio', 'resolution', 'duration', 'count', 'prompt', 'ref'];                   // 视频草稿的生成参数
/* 流水线用到的每一句命令：命令 → 带的参数（不写前面的 --）。后面写的是谁在用 */
const USED = {
  'schema': [], 'version': [],                                    // 这里自己用
  'auth status': [], 'auth account': [],                           // 即梦授权、出片前核对账号（jobs.js、jm-check.js）
  'auth login': [], 'auth wait': ['device-code', 'timeout'],       // 即梦授权：登录
  'canvas ls': ['limit', 'cursor'],                                // 画布在不在这个号名下（jm-check.js）
  'canvas create': ['project-id'],                                 // 项目还没画布：新建一张（jm-check.js）
  'model ls': ['type'],                                            // 模型收不收这样出（jm-video.js；1.4.2 以前叫 model list）
  'node ls': ['project-id', 'name', 'type', 'limit', 'offset'],    // 按名字查节点（jm-video.js、canvas.js；1.4.2 以前叫 node find）
  'node show': ['project-id', 'node-id'],
  'node create image': ASSET, 'node create audio': ASSET, 'node create video': [...ASSET, ...GEN],
  'node edit image': RENAME, 'node edit audio': RENAME, 'node edit video': [...RENAME, ...GEN],
  'node quote': ['project-id', 'node-id'],
  'node confirm': ['project-id', 'node-id', 'credit-ceiling'],
  'node run': ['project-id', 'node-id', 'submit-id', 'credit-token'],
  'operation wait': ['project-id', 'timeout', 'interval'],
  'operation status': ['project-id'],
  'resource get': ['project-id'],
  'resource upload': ['project-id', 'resource-id', 'file', 'type', 'import-kind'],
  'resource download': ['project-id', 'output'],
};
const GLOBAL = ['non-interactive', 'profile', 'format'];           // 每句都可能带的

/* 命令行自己的清单（schema 回的 data）里，USED 的哪几样没有了：['「node find」', '「node ls」的 --name', …]，都在就回空的 */
function gaps(data) {
  const out = [], names = list => new Set((Array.isArray(list) ? list : []).map(f => f && f.name));
  const g = names(data && data.globalFlags), lostG = GLOBAL.filter(f => !g.has(f));
  if (lostG.length) out.push('每句都带的 ' + lostG.map(f => '--' + f).join('、'));
  for (const [cmd, flags] of Object.entries(USED)) {
    let subs = (data && data.subcommands) || [], node = null;
    for (const w of cmd.split(' ')) { node = (Array.isArray(subs) ? subs : []).find(s => s && s.name === w) || null; if (!node) break; subs = node.subcommands; }
    if (!node) { out.push('「' + cmd + '」'); continue; }
    const has = names(node.flags), lost = flags.filter(f => !has.has(f));
    if (lost.length) out.push('「' + cmd + '」的 ' + lost.map(f => '--' + f).join('、'));
  }
  return out;
}
/* 一条要跑的命令（参数数组）USED 里记没记：记了回空，没记回一句话。测试里假的即梦命令行拿它核每一条 */
function missing(args) {
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--non-interactive' || args[i] === '--yes') continue;
    if (args[i] === '--profile' || args[i] === '--format') { i++; continue; }
    rest.push(String(args[i]));
  }
  const key = [3, 2, 1].map(n => rest.slice(0, n).join(' ')).find(k => Object.prototype.hasOwnProperty.call(USED, k));
  if (!key) return '命令清单（jm-cmds.js 的 USED）里没有「' + rest.slice(0, 3).join(' ') + '」';
  const flags = rest.slice(key.split(' ').length).filter(x => /^--[a-z][a-z-]*$/.test(x) || x === '-o').map(x => x === '-o' ? 'output' : x.slice(2));
  const lost = [...new Set(flags)].filter(f => !USED[key].includes(f));
  return lost.length ? '命令清单（jm-cmds.js 的 USED）里「' + key + '」没有 ' + lost.map(f => '--' + f).join('、') : '';
}
/* 即梦回的错是不是「不认这句命令、这个参数」（本机就拦下的，再试也一样） */
const unknown = er => !!er && Number(er.code) === 2 && (Array.isArray(er.diagnostics) ? er.diagnostics : []).some(d => /unrecognized (subcommand|option)/i.test(String(d && d.detail)));

module.exports = function makeJmCmds({ JM, run, log = () => {} }) {
  let seen = null, flying = null;   // seen：{ key 命令行文件的大小和修改时间, msg }；flying：正在问的那一回（几处一起问只问一回）
  async function read() {
    let key;
    try { const s = await fsp.stat(JM); key = s.size + '|' + s.mtimeMs; } catch (e) { return ''; }   // 没装命令行：别处会说
    if (seen && seen.key === key) return seen.msg;
    const ask = async cmd => { const r = await run(JM, ['--non-interactive', cmd, '--format', 'json'], { timeout: 30e3 }); return (JSON.parse(r.out) || {}).data || null; };
    const [data, ver] = await Promise.all([ask('schema').catch(e => { log('即梦命令行的命令清单没读到，这回不核：' + e.message); return null; }), ask('version').catch(() => null)]);
    if (!data || !Array.isArray(data.subcommands)) return '';
    const lost = gaps(data), v = ver && ver.version ? '（现在是 ' + ver.version + ' 版）' : '';
    const msg = lost.length ? '即梦命令行升级了' + v + '，流水线有 ' + lost.length + ' 处它不认了：' + lost.join('、') + '。再点也没用，把这句话发给 AI，让它照新版改' : '';
    if (lost.length) log('即梦命令行和流水线对不上：' + lost.join('、'));
    seen = { key, msg };
    return msg;
  }
  /* 对得上回空；对不上回一句给人看的话（哪几句不认了、该怎么办） */
  const check = () => flying || (flying = read().finally(() => { flying = null; }));
  return { check };
};
Object.assign(module.exports, { USED, GLOBAL, gaps, missing, unknown });
