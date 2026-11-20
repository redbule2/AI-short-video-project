'use strict';
/* 一页引的几个脚本顶层名字不能重（2026-11-19：提示词页新加的 handOf 和 流水线.js 里的重了，整页白屏）。
   网页里各个脚本的顶层 const、let、class 共用一处，重了后来那个脚本整个不跑。这里把一页引的脚本照先后接成一份编译一遍（不运行），重了就报 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const TOOLS = path.join(__dirname, '..');
const pages = [...fs.readdirSync(path.join(TOOLS, '流水线')).filter(f => f.endsWith('.html')).map(f => path.join(TOOLS, '流水线', f)), path.join(TOOLS, '项目管理_写稿试用.html')];

/* 一页的脚本照出现的先后：外引的读文件，写在页里的照原样 */
function scriptsOf(page) {
  const html = fs.readFileSync(page, 'utf8'), out = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1], src = /\bsrc="([^"]+)"/.exec(attrs), type = /\btype="([^"]+)"/.exec(attrs);
    if (type && !/javascript/i.test(type[1])) continue;   // 模块、JSON 这些不算
    if (src) {
      if (/^(https?:)?\/\//.test(src[1])) continue;
      const file = path.resolve(path.dirname(page), decodeURI(src[1]));
      out.push({ name: path.relative(TOOLS, file), code: fs.readFileSync(file, 'utf8') });
    } else out.push({ name: path.relative(TOOLS, page) + '（页里的）', code: m[2] });
  }
  return out;
}
const compile = list => new vm.Script('void 0;\n' + list.map(s => s.code).join('\n;\n'), { filename: 'joined.js' });   // 开头垫一句：免得头一个文件的 'use strict' 管到后面所有的

for (const page of pages) {
  test(path.relative(TOOLS, page) + '：引的脚本顶层名字不重', () => {
    const list = scriptsOf(page);   // 只是说明、没有脚本的页：一份空的，照样编译得过
    try { compile(list); }
    catch (e) {
      const name = (/Identifier '([^']+)' has already been declared/.exec(e.message) || [])[1];
      const where = name ? list.filter(s => new RegExp('^(?:const|let|var|class|function|async function)\\s+' + name + '\\b|^(?:const|let|var)\\s.*[\\s,]' + name + '\\s*=', 'm').test(s.code)).map(s => s.name) : [];
      assert.fail(e.message + (where.length ? '：在 ' + where.join('、') : ''));
    }
  });
}

test('真重名能查出来', () => {
  assert.throws(() => compile([{ code: 'const handOf = 1;' }, { code: 'const x = 1, handOf = 2;' }]), /handOf/);
});
