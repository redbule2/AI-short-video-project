// 过渡文件检查：Claude 每轮结束（Stop 钩子）时跑，只管开在 E:\AI短视频项目 里的会话
// 只看这一轮里新建、改过、改过名的：各项目 资产、提示词 里名字带版本号、像副本的，或 Blender 的 .blend1 备份，拦一次提醒 AI；不自动删
const fs = require('fs'), path = require('path');
const ROOT = 'E:\\AI短视频项目';
const SKIP = new Set(['历史记录', '.git', 'node_modules', '__pycache__']);
const BAD = [
  [/(^|[^a-z])v\d+([^a-z]|$)/i, '带版本号'],
  [/第\d+版/, '带版本号'],
  [/副本|[_\-\s](微调|旧版?|备份|bak|old|copy|backup)([_\-\s]|$)|\s\(\d+\)$/i, '像副本'],
];

function turnStart(tp) {   // 从对话记录末尾往回找这一轮开头那条（用户或别的会话发来的），找不到按两小时前算
  try {
    const fd = fs.openSync(tp, 'r'), size = fs.fstatSync(fd).size, len = Math.min(size, 8 << 20);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= (len < size ? 1 : 0); i--) {
      let j; try { j = JSON.parse(lines[i]); } catch (e) { continue; }
      if (j.type !== 'user' || !j.timestamp) continue;
      const c = j.message && j.message.content;
      if (Array.isArray(c) && c.some(x => x && x.type === 'tool_result')) continue;
      if (j.origin || (!j.isMeta && !j.isCompactSummary)) return Date.parse(j.timestamp);
    }
  } catch (e) {}
  return Date.now() - 2 * 3600e3;
}

function why(name, isDir) {
  if (!isDir && /\.blend\d+$/i.test(name)) return 'Blender 自动备份';
  const base = isDir ? name : name.replace(/\.[^.]+$/, '');
  const hit = BAD.find(([re]) => re.test(base));
  return hit && hit[1];
}

function walk(dir, since, hits) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name), isDir = e.isDirectory(), w = why(e.name, isDir);
    if (w) {
      try {
        const st = fs.statSync(p);
        if (Math.max(st.mtimeMs, st.ctimeMs, st.birthtimeMs) >= since - 2000) hits.push(path.relative(ROOT, p) + '（' + w + '）');
      } catch (err) {}
    }
    if (isDir) walk(p, since, hits);
  }
}

let input = '';
process.stdin.on('data', d => input += d).on('end', () => {
  let j = {};
  try { j = JSON.parse(input); } catch (e) {}
  const cwd = path.resolve(j.cwd || process.cwd()).toLowerCase(), root = ROOT.toLowerCase();
  if (cwd !== root && !cwd.startsWith(root + path.sep)) return;
  const since = turnStart(j.transcript_path || ''), hits = [];
  let projects = [];
  try { projects = fs.readdirSync(path.join(ROOT, '项目'), { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.')); } catch (e) { return; }
  for (const p of projects) for (const sub of ['资产', '提示词']) walk(path.join(ROOT, '项目', p.name, sub), since, hits);
  if (!hits.length) return;
  const msg = '这一轮 资产、提示词 里出现了过渡文件：' + hits.slice(0, 10).join('、') + (hits.length > 10 ? ' 等 ' + hits.length + ' 个' : '') +
    '。按 AGENTS.md「过程文件」：改动优先存回原文件，定稿只留一份、名字不带版本号、不另存副本。是你这轮弄出来的，就并回原名，淘汰的送回收站或移进 历史记录；不是你弄的或拿不准，告诉用户，别动。';
  if (j.stop_hook_active) { process.stdout.write(JSON.stringify({ systemMessage: msg })); return; }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: msg }));
});
