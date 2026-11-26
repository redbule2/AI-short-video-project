/* 命名规则（2026-11-26 他定：项目文件夹里，名字和位置不合 AGENTS.md 的，AI 写的时候门卫提醒，别的程序、手放进来的巡逻列出来）
   只在 Node 里用：Claude、Codex 的门卫（.agents/hooks/naming-gate.js）、本机服务的巡逻（.agents/skills/annotate-live/naming-patrol.js）都照这一份查。
   规矩照 AGENTS.md「项目目录和资料规则」，这里只写程序看得出来的（图上画的是人还是地方，程序看不出，不查）：
     1. 一级目录只许 .agents、.git、.gitignore、AGENTS.md、通用工具、项目
     2. 项目文件夹里只许 提示词、资产、成片、定稿的剧本、历史记录
     3. 资产 下只许 人物和道具、场景、关键帧 三个文件夹（记录文件放 资产 本层）；人物和道具 里不再分小文件夹；关键帧 下一段一个 第N段
     4. 提示词 下只许 全局资产 和 第N段；全局资产 下只许 人物、场景、道具、特效 四个文件夹
     5. 成片 下一段一个 第N段；样片照出它的提示词起名（1-5_改1.mp4、1-5_改1_2.mp4），批注、截图跟着视频名
     6. 历史记录 本层只许 提示词、资产、成片、定稿的剧本、整理记录、原始资料、AI任务、历史教训
     7. 名字不带版本号（v2、第2版、最终版）、不像副本（副本、(1)、备份、bak、old、copy）、不带时长（10秒、5s）；不留 Blender 自动备份（.blend1）
     8. 名字里不再写项目名（项目名四个字以上才查，短的常就是人名、菜名）；段落文件夹里不再写这一段（第3-4段 里不写 第3-4段，写别的段是在说来历，不管）；人物和道具、场景、全局资产 的类别文件夹里不带类别（人物_、道具_、场景_、特效_）
   不查：项目 这一层（各项目文件夹以外放的说明页）、历史记录 里面、通用工具、.agents、.claude、.codex，临时文件（~$、.tmp、.part）、系统文件；老文件名单上的（规矩定下以前就在的，记在 OLD_FILE）。
   命令行：node 命名规则.js 查 [路径…]       不写路径就查整个项目（老文件名单上的不算）
           node 命名规则.js 记老文件 [--重记]   把现在不合规的记成老文件（已经记过的不重记，除非 --重记）
   测试：node --test 通用工具/测试/命名规则_测试.cjs */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Core = require('./核心.js');

const ROOT = path.resolve(__dirname, '..', '..');   // E:\AI短视频项目
const OLD_FILE = process.env.ANTOU_NAMING_OLD || path.join(os.homedir(), '.antou', '命名老文件.json');

const TOP = ['.agents', '.git', '.gitignore', 'AGENTS.md', '通用工具', '项目'];
const PJ_DIRS = ['提示词', '资产', '成片', '定稿的剧本', '历史记录'];
const ASSET_DIRS = ['人物和道具', '场景', '关键帧'];
const GLOBAL_DIRS = ['人物', '场景', '道具', '特效'];
const HIST_DIRS = ['提示词', '资产', '成片', '定稿的剧本', '整理记录', '原始资料', 'AI任务', '历史教训'];
const APP_DIRS = ['.claude', '.codex'];   // 应用自己建的设置文件夹，里面不查
const NO_WALK = new Set(['.git', '.claude', '.codex', 'node_modules', '__pycache__']);
const SYS = /^(desktop\.ini|thumbs\.db|\.ds_store)$/i;
const TEMP = /^~\$|\.(tmp|part|crdownload)$/i;   // Word 开着时的锁文件、下到一半、存到一半的：一会儿就没了
const NUM = '[0-9]+(?:-[0-9]+)*[a-z]?';
const SEG = new RegExp('^第' + NUM + '(?:[至到~～]' + NUM + ')?段$', 'i');   // 第1段、第3-4段、第1至3段
const CAT = '(?:人物|道具|场景|特效)';
const SEP = '[_\\-\\s]';
const RULES = [
  [/(?:^|[^a-z])v[0-9]+(?![a-z0-9])/i, '名字带版本号'],
  [/第[0-9一二三四五六七八九十]+版|版本[0-9一二三四五六七八九十]*|最终版|(?:^|[_\-\s])final(?![a-z])/i, '名字带版本号'],
  [/副本|(?:^|[_\-\s])(?:微调|旧版?|备份|bak|old|copy|backup)(?=[_\-\s]|$)|\s\([0-9]+\)$/i, '名字像副本'],
  [/(?:^|[_\-\s])[0-9]+(?:\.[0-9]+)?(?:秒|s|sec)(?=[_\-\s]|$)/i, '名字带时长'],
];
const stemOf = (name, dir) => dir ? name : name.replace(/\.[^.]+$/, '');
const extOf = (name, dir) => dir ? '' : (/\.[^.]+$/.exec(name) || [''])[0];
const slash = p => String(p).replace(/\\/g, '/');

/* 照规矩改名：去掉版本号、副本、时长、项目名、第几段、类别这些多写的，剩下的就是该叫的名字；去完是空的或没变，给 '' */
function fixStem(stem, z) {
  let s = stem
    .replace(/\s*-\s*副本(?:\s*\([0-9]+\))?$/, '').replace(/\s\([0-9]+\)$/, '')
    .replace(/(^|[^a-z])v[0-9]+(?![a-z0-9])/gi, '$1')
    .replace(/第[0-9一二三四五六七八九十]+版|版本[0-9一二三四五六七八九十]*|最终版/g, '')
    .replace(/(^|[_\-\s])final(?![a-z])/gi, '$1')
    .replace(/(^|[_\-\s])(?:微调|旧版?|备份|bak|old|copy|backup)(?=[_\-\s]|$)/gi, '$1').replace(/副本/g, '')
    .replace(/(^|[_\-\s])[0-9]+(?:\.[0-9]+)?(?:秒|s|sec)(?=[_\-\s]|$)/gi, '$1');
  if (z.proj && z.proj.length >= 4) s = s.split(z.proj).join('');
  if (z.seg) s = s.split(z.seg).join('');
  if (z.cat) s = s.replace(new RegExp('^' + CAT + '(?=' + SEP + ')'), '').replace(new RegExp('(?<=' + SEP + ')' + CAT + '$'), '');
  s = s.replace(/[_\-\s]{2,}/g, m => m[0]).replace(/^[_\-\s]+|[_\-\s]+$/g, '');
  return s && s !== stem ? s : '';
}

/* 名字本身（不看放在哪）：z.proj 项目名，z.seg 所在的段落文件夹名（名字里不该再写它），z.cat 这里不该带类别 */
function nameWhy(name, dir, z) {
  if (!dir && /\.blend[0-9]+$/i.test(name)) return { why: 'Blender 自动备份（.blend1），用完删掉', fix: '' };
  const stem = stemOf(name, dir), whys = [];
  for (const [re, w] of RULES) if (re.test(stem) && !whys.includes(w)) whys.push(w);
  if (z.proj && z.proj.length >= 4 && stem.includes(z.proj)) whys.push('名字里又写了项目名');
  if (z.seg && stem.includes(z.seg)) whys.push('名字里又写了这一段（看所在文件夹）');
  if (z.cat && (new RegExp('^' + CAT + SEP).test(stem) || new RegExp(SEP + CAT + '$').test(stem))) whys.push('名字带了类别（看所在文件夹）');
  if (!whys.length) return null;
  const f = fixStem(stem, z), fixed = f && f + extOf(name, dir);
  return { why: whys.join('、'), fix: fixed && !nameWhy(fixed, dir, z) ? fixed : '' };
}

/* 样片、批注、截图要以出它的提示词名开头（1-5_改1.mp4、1-5_改1_2.mp4、1-5_改1_批注.md、1-5_改1_批注截图）；提示词名后面紧跟的不能是数字、字母、- */
function clipOk(name, dir, stems) {
  const s = stemOf(name, dir);
  for (const p of stems) if (s === p || (s.startsWith(p) && !/^[0-9a-z\-、.]/i.test(s.slice(p.length)))) return true;
  return false;
}

/* 一样东西合不合规矩。parts：从总文件夹往下的每一节（['项目', '童晓晓', '资产', '人物和道具', '童爸爸.png']）；dir：是不是文件夹；
   ctx.stems(项目, 第N段)：这一段提示词的名字（不带 .txt；历史记录里的去掉 __时间），查样片名用。合规矩给 null，不合给 { why, fix }（fix 是照规矩改好的名字，改不出给 ''） */
function check(parts, dir, ctx) {
  const n = parts.length, name = parts[n - 1];
  if (!n || SYS.test(name) || TEMP.test(name)) return null;
  if (n === 1) return TOP.includes(name) ? null : { why: '一级目录只许放 ' + TOP.join('、'), fix: '' };
  if (dir && NO_WALK.has(name)) return null;   // 工具自己建的缓存、仓库、应用设置文件夹（一级目录的 .claude 上面已经拦了）
  if (parts[0] !== '项目') return null;   // 通用工具、.agents 是代码，不归这里管
  if (n === 2) return null;   // 项目 这一层：各项目文件夹、.codex，还有他放的说明页（工序图.html），AGENTS.md 没管
  const proj = parts[1];
  if (proj.startsWith('.') || APP_DIRS.includes(parts[2])) return null;
  if (n === 3) return dir && PJ_DIRS.includes(name) ? null : { why: '项目文件夹里只许放 ' + PJ_DIRS.join('、'), fix: '' };
  const area = parts[2], sub = parts[3];
  if (area === '历史记录') return n === 4 && !(dir && HIST_DIRS.includes(name)) ? { why: '历史记录 本层只许放 ' + HIST_DIRS.join('、'), fix: '' } : null;
  if (area === '定稿的剧本') return nameWhy(name, dir, { proj });
  if (area === '资产') {
    if (n === 4) return dir ? (ASSET_DIRS.includes(name) ? null : { why: '资产 下只许放 ' + ASSET_DIRS.join('、') + ' 三个文件夹', fix: '' }) : nameWhy(name, dir, { proj });
    if (sub === '人物和道具') return n === 5 && dir ? { why: '人物和道具 里不再分小文件夹', fix: '' } : nameWhy(name, dir, { proj, cat: n === 5 });
    if (sub === '场景') return nameWhy(name, dir, { proj, cat: n === 5 });
    if (sub === '关键帧') return n === 5 && !(dir && SEG.test(name)) ? { why: '关键帧 下一段一个 第N段 文件夹', fix: '' } : n === 5 ? null : nameWhy(name, dir, { proj, seg: parts[4] });
    return null;
  }
  if (area === '提示词') {
    if (n === 4) return dir && (name === '全局资产' || SEG.test(name)) ? null : { why: '提示词 下只许放 全局资产 和 第N段 文件夹', fix: '' };
    if (sub === '全局资产') return n === 5 && dir ? (GLOBAL_DIRS.includes(name) ? null : { why: '全局资产 下只许放 ' + GLOBAL_DIRS.join('、') + ' 四个文件夹', fix: '' }) : nameWhy(name, dir, { proj, cat: n === 6 });
    return nameWhy(name, dir, { proj, seg: sub });
  }
  if (area === '成片') {
    if (n === 4) return dir && SEG.test(name) ? null : { why: '成片 要按段放：一段一个 第N段 文件夹', fix: '' };
    if (n === 5) {
      if (Core.clipOld(name)) return null;   // 11-18 以前的样片名（第3-4段_第20条_1改3_720p.mp4），流水线照旧认
      const w = nameWhy(name, dir, { proj, seg: sub });
      if (w) return w;
      return ctx && ctx.stems && !clipOk(name, dir, ctx.stems(proj, sub)) ? { why: '样片名要和出它的提示词一样（' + sub + ' 里没有叫这个名字开头的提示词）', fix: '' } : null;
    }
    return null;   // 批注截图里面是审片台自己起的名字
  }
  return null;
}

/* 查样片名用的：一段的提示词名，现在的和历史记录里的（去掉 __时间），读一回记着 */
function stemsCtx(root) {
  const memo = new Map();
  const names = dir => { try { return fs.readdirSync(dir); } catch (e) { return []; } };
  return {
    stems(proj, seg) {
      const k = proj + '/' + seg;
      if (!memo.has(k)) {
        const pj = path.join(root, '项目', proj), out = new Set();
        for (const f of names(path.join(pj, '提示词', seg))) if (/\.txt$/i.test(f)) out.add(f.replace(/\.txt$/i, ''));
        for (const f of names(path.join(pj, '历史记录', '提示词', seg))) if (/\.txt$/i.test(f)) out.add(f.replace(/\.txt$/i, '').replace(/__[0-9]{8}-[0-9]{6}$/, ''));
        memo.set(k, [...out].sort((a, b) => b.length - a.length));
      }
      return memo.get(k);
    },
  };
}

/* ---------- 老文件名单：规矩定下以前就在的，不算 ---------- */
function loadOld(file = OLD_FILE) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return new Set(Array.isArray(j.老文件) ? j.老文件 : []); }
  catch (e) { return null; }   // 还没记过
}
function saveOld(set, file = OLD_FILE, root = ROOT) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = new Date(), two = x => String(x).padStart(2, '0');
  const at = t.getFullYear() + '-' + two(t.getMonth() + 1) + '-' + two(t.getDate()) + ' ' + two(t.getHours()) + ':' + two(t.getMinutes()) + ':' + two(t.getSeconds());
  const body = { 说明: '命名规则.js 的老文件名单：这里的（连同下面的东西）规矩定下以前就在，门卫、巡逻都不提。删掉一行就又会查它', 根: slash(root), 记于: at, 老文件: [...set].sort() };
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(body, null, 1) + '\n');
  fs.renameSync(tmp, file);
}
const isOld = (old, rel) => { if (!old || !old.size) return false; const p = rel.split('/'); for (let i = 1; i <= p.length; i++) if (old.has(p.slice(0, i).join('/'))) return true; return false; };

/* 一个路径（文件或文件夹，可以还不存在）：从上往下一节一节查，给最上面那一处不合的 { rel, why, fix }；合规矩、不在总文件夹里、在老文件名单上给 null */
function checkPath(abs, { root = ROOT, old = null, dir = null, ctx = null } = {}) {
  const rel = path.relative(root, path.resolve(abs));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const parts = rel.split(path.sep).filter(Boolean);
  ctx = ctx || stemsCtx(root);
  for (let i = 1; i <= parts.length; i++) {
    const r = parts.slice(0, i).join('/');
    if (isOld(old, r)) return null;
    let isDir = i < parts.length;
    if (i === parts.length) { if (dir != null) isDir = dir; else { try { isDir = fs.statSync(abs).isDirectory(); } catch (e) { isDir = false; } } }
    const w = check(parts.slice(0, i), isDir, ctx);
    if (w) return { rel: r, ...w };
    if (i < parts.length && NO_WALK.has(parts[i - 1])) return null;   // 缓存、仓库、应用设置文件夹里面不查
  }
  return null;
}

/* 整个查一遍：一级目录、项目 下面（历史记录只看本层）。不合的文件夹不往里查（改好它就行）。
   old：老文件名单（null 就全报）；since：只要这之后新建、改过、改过名的（毫秒，0 是都要） */
function scan({ root = ROOT, old = null, since = 0 } = {}) {
  const out = [], ctx = stemsCtx(root);
  const recent = abs => { if (!since) return true; try { const st = fs.statSync(abs); return Math.max(st.mtimeMs, st.ctimeMs, st.birthtimeMs) >= since - 2000; } catch (e) { return false; } };
  const walk = (abs, parts) => {
    let ents; try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (!e.isFile() && !e.isDirectory()) continue;
      const p = parts.concat(e.name), rel = p.join('/'), dir = e.isDirectory(), full = path.join(abs, e.name);
      if (isOld(old, rel)) continue;
      const w = check(p, dir, ctx);
      if (w) { if (recent(full)) out.push({ rel, dir, ...w }); continue; }
      if (!dir || NO_WALK.has(e.name)) continue;
      if (p.length === 1 && e.name !== '项目') continue;               // 通用工具、.agents
      if (p.length === 2 && e.name.startsWith('.')) continue;         // 项目\.codex
      if (p.length === 4 && p[2] === '历史记录') continue;             // 历史记录里面
      if (p.length === 5 && p[2] === '成片') continue;                 // 批注截图里面
      walk(full, p);
    }
  };
  walk(root, []);
  return out;
}

module.exports = { ROOT, OLD_FILE, TOP, PJ_DIRS, ASSET_DIRS, GLOBAL_DIRS, HIST_DIRS, SEG, check, checkPath, nameWhy, fixStem, clipOk, stemsCtx, scan, loadOld, saveOld, isOld };

if (require.main === module) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === '查') {
    const old = loadOld();
    const hits = args.length ? args.map(a => checkPath(a, { old })).filter(Boolean) : scan({ old });
    for (const x of hits) console.log(x.rel + '　' + x.why + (x.fix ? '　→ ' + x.fix : ''));
    console.log(hits.length ? '不合规矩的 ' + hits.length + ' 处' : '都合规矩');
  } else if (cmd === '记老文件') {
    if (loadOld() && !args.includes('--重记')) { console.log('已经记过了：' + OLD_FILE + '（要重记加 --重记）'); process.exit(0); }
    const hits = scan({});
    saveOld(new Set(hits.map(x => x.rel)));
    console.log('记了 ' + hits.length + ' 处老文件：' + OLD_FILE);
  } else {
    console.log('用法：node 命名规则.js 查 [路径…] ｜ node 命名规则.js 记老文件 [--重记]');
  }
}
