'use strict';
/* 桌面版/scripts/bundle-list.cjs：安装包装哪些工具文件；用到的文件不在里面要报出来 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pickFiles, checkRefs } = require('../桌面版/scripts/bundle-list.cjs');

test('挑掉开发用的、教程、风格库样片、项目和三样以外的', () => {
  const got = pickFiles([
    'AGENTS.md', '.agents/skills/annotate-live/server.js', '.gitignore', '项目/童晓晓/提示词/1-5.txt',
    '通用工具/桌面版/main.js', '通用工具/桌面版/lib/sync.js', '通用工具/桌面版/页面/登录.html',
    '通用工具/测试/桌面版同步_测试.cjs', '通用工具/流水线教程/第1课_打开流水线/图文.html', '通用工具/Codex教程/a.png',
    '通用工具/Seedance提示词教程/第1课_生成目标/~$练习题.docx', '通用工具/AI短片风格库/样片_a.mp4', '通用工具/AI短片风格库/样片_a.txt',
    '通用工具/公用/__pycache__/a.cpython-312.pyc', '通用工具/流水线/总览.html', '通用工具/流水线/总览.html',
  ]);
  assert.deepEqual(got, ['.agents/skills/annotate-live/server.js', 'AGENTS.md', '通用工具/AI短片风格库/样片_a.txt', '通用工具/桌面版/页面/登录.html', '通用工具/流水线/总览.html'].sort());
});

test('用到的文件不在里面就报出来：require、script、样式', () => {
  const files = {
    '.agents/skills/annotate-live/jobs.js': "require('./codex-draw.js')({}); require('./filmed'); require('fs'); require(path.join(TOOLS, 'x.js'));",
    '.agents/skills/annotate-live/filmed.js': '',
    '通用工具/流水线/总览.html': '<script src="../公用/底座.js"></script><script src="https://cdn.example.com/x.js"></script><link rel="stylesheet" href="/通用工具/公用/样式.css?v=2"><script src="总览.js"></script>',
    '通用工具/流水线/总览.js': '',
    '通用工具/公用/底座.js': '',
  };
  const missing = checkRefs(Object.keys(files), f => files[f]);
  assert.deepEqual(missing.map(m => m.from + ' → ' + m.to).sort(), [
    '.agents/skills/annotate-live/jobs.js → .agents/skills/annotate-live/codex-draw.js',
    '通用工具/流水线/总览.html → 通用工具/公用/样式.css',
  ]);
});
