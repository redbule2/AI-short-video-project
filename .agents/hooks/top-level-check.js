// 一级目录检查：Claude 每轮结束（Stop 钩子）时跑，只管开在 E:\AI短视频项目 里的会话
// 空文件夹直接删（rmdir 只删得掉空的）；有东西的多余项拦一次，让 AI 挪进对应项目或告诉用户
const fs = require('fs'), path = require('path');
const ROOT = 'E:\\AI短视频项目';
const ALLOW = ['.agents', '.git', '.gitignore', 'AGENTS.md', '通用工具', '项目'];
const OS_FILES = ['desktop.ini', 'thumbs.db'];
let input = '';
process.stdin.on('data', d => input += d).on('end', () => {
  let j = {};
  try { j = JSON.parse(input); } catch (e) {}
  const cwd = path.resolve(j.cwd || process.cwd()).toLowerCase();
  const root = ROOT.toLowerCase();
  if (cwd !== root && !cwd.startsWith(root + path.sep)) return;
  let names;
  try { names = fs.readdirSync(ROOT); } catch (e) { return; }
  const extra = [];
  for (const n of names) {
    if (ALLOW.includes(n) || OS_FILES.includes(n.toLowerCase())) continue;
    const p = path.join(ROOT, n);
    try { if (fs.statSync(p).isDirectory() && fs.readdirSync(p).length === 0) { fs.rmdirSync(p); continue; } } catch (e) {
      try { if (fs.readdirSync(p).length === 0) continue; } catch (e2) {}   // 空壳被占用删不掉：不拦，等下次
    }
    extra.push(n);
  }
  if (!extra.length) return;
  const msg = '一级目录 ' + ROOT + ' 多出了：' + extra.join('、') + '。一级目录只许放 ' + ALLOW.join('、') +
    '。是你建的，就挪进 项目\\对应项目 里该放的位置；不是你建的或拿不准，告诉用户，别删。';
  if (j.stop_hook_active) { process.stdout.write(JSON.stringify({ systemMessage: msg })); return; }
  process.stdout.write(JSON.stringify({ decision: 'block', reason: msg }));
});
