'use strict';
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '风格库_空项目_测试.cjs'), 'utf8');
const at = source.indexOf("test('没有创作项目");
if (at < 0) throw new Error('风格库测试夹具未找到');
new Function('require', '__dirname', 'process', source.slice(0, at) + "\ntest('合并清宫画风且下架国漫，保留两条样片和色卡', async () => {\n  const x=await open();let sections=[];walk(x.root,n=>{if(n.attrs.class?.startsWith('fg-sty'))sections.push(n)});\n  const names=sections.map(n=>n.attrs['data-name']);assert.equal(names.filter(n=>n==='清宫古装剧风').length,1);assert.ok(!names.includes('现代清装轻喜'));assert.ok(!names.includes('清宫古偶甜宠'));assert.ok(!names.includes('国漫3D高清渲染风'));\n  const sec=sections.find(n=>n.attrs['data-name']==='清宫古装剧风');let play=[],colors=[];walk(sec,n=>{if(n.attrs.class==='fg-play')play.push(n);if(n.tag==='button'&&textOf(n)==='看色卡')colors.push(n)});assert.equal(play.length,2);assert.equal(colors.length,1);assert.match(textOf(sec),/色卡参考/);assert.match(textOf(sec),/人物参考图/);assert.ok(!textOf(x.root).includes('追逐破境'));\n  await play[0].dispatch('click');await play[1].dispatch('click');assert.equal(new Set(x.mediaReads.map(p=>p.at(-1))).size,2);assert.ok(x.mediaReads.every(p=>p.at(-1).includes('清宫古装剧风')));walk(sec,n=>{if(n.tag==='video')URL.revokeObjectURL(n.attrs.src)});\n});\n")(require, __dirname, process);
