'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '风格库_空项目_测试.cjs'), 'utf8');
const at = source.indexOf("test('没有创作项目");
if (at < 0) throw new Error('风格库测试夹具未找到');
new Function('require', '__dirname', 'process', source.slice(0, at) + "\ntest('样片绑定色卡时显示色卡入口，色卡缺失时不显示', async () => {\n  function getSection(x) { let section=null; walk(x.root,n=>{if(n.attrs['data-name']==='清宫古装剧风')section=n});return section; }\n  function paletteButtons(section) { let buttons=[]; walk(section,n=>{if(n.tag==='button'&&textOf(n)==='看色卡')buttons.push(n)});return buttons; }\n  let a=await open(), section=getSection(a); assert.ok(section); assert.equal(paletteButtons(section).length,1); assert.match(textOf(section),/色卡参考/);\n  const name='素材_清宫古装剧风_色卡参考.png', index=entries.indexOf(name); assert.ok(index>=0); entries.splice(index,1);\n  try { let b=await open(); assert.equal(paletteButtons(getSection(b)).length,0); } finally { entries.splice(index,0,name); }\n});\n")(require, __dirname, process);
