'use strict';
/* 安装包里装哪些工具文件（开发规范第 15 条）：git 认得的 AGENTS.md、.agents、通用工具，去掉开发用的和大的。
   checkRefs：挑出来的脚本、页面用到的文件（require('./x')、<script src>、<link href>）都得在里面，不然换台电脑就开不起来。 */
const path = require('path').posix;

const SKIP = [
  /^通用工具\/桌面版\/(?!页面\/)/,                                  // 壳子自己的代码不进工作文件夹；登录页要经本机服务开，留着
  /^通用工具\/测试\//,
  /^通用工具\/(流水线教程|Codex教程|Seedance提示词教程)\//,           // 教程：配音是真人声音，只留本机
  /^通用工具\/AI短片风格库\/.+\.(mp4|mov|webm|wav|mp3)$/i,           // 风格库样片太大，页面没有样片也照样能看
  /(^|\/)__pycache__\//, /\.pyc$/i,
  /(^|\/)~\$/,                                                    // Word 开着时的临时文件
  /(^|\/)(Thumbs\.db|desktop\.ini|\.DS_Store)$/i,
];

const inScope = f => f === 'AGENTS.md' || f.startsWith('.agents/') || f.startsWith('通用工具/');

function pickFiles(list) {
  return [...new Set(list)].filter(f => inScope(f) && !SKIP.some(re => re.test(f))).sort();
}

/* 页面、脚本里写的相对路径 → 从总文件夹算起的路径；网址、/api/ 之类不管 */
function target(from, ref) {
  let r = ref.split(/[?#]/)[0];
  if (!r || /^[a-z][a-z0-9+.-]*:/i.test(r) || r.startsWith('//')) return null;
  try { r = decodeURI(r); } catch (e) { /* 照原样 */ }
  if (r.startsWith('/')) return r.startsWith('/通用工具/') ? r.slice(1) : null;
  return path.normalize(path.join(path.dirname(from), r));
}

function checkRefs(files, read) {
  const have = new Set(files);
  const missing = [];
  const need = (from, to) => { if (to && !have.has(to)) missing.push({ from, to }); };
  for (const f of files) {
    if (/\.(c?js|mjs)$/i.test(f)) {
      const src = read(f);
      for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
        const t = target(f, m[1]);
        need(f, t && !/\.[a-z0-9]+$/i.test(t) ? t + '.js' : t);
      }
    } else if (/\.html?$/i.test(f)) {
      const src = read(f);
      for (const m of src.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) need(f, target(f, m[1]));
      for (const m of src.matchAll(/<link\b[^>]*\bhref=["']([^"']+\.css)(?:[?#][^"']*)?["']/gi)) need(f, target(f, m[1]));
    }
  }
  return missing;
}

module.exports = { pickFiles, checkRefs, SKIP };
