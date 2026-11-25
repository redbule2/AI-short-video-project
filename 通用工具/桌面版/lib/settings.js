'use strict';
/* 设置：userData\设置.json
   工作文件夹、端口、几样工具的路径（开发规范第 14 条：先看设置、再自动找）、上回装进工作文件夹的工具清单 */
const fs = require('fs');
const path = require('path');

const unbom = s => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

/* 先写到旁边的临时文件再换名：写到一半断电也不会留下半份 */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function makeSettings(file) {
  let data = {};
  try { data = JSON.parse(unbom(fs.readFileSync(file, 'utf8'))) || {}; } catch (e) { data = {}; }
  const save = () => writeAtomic(file, JSON.stringify(data, null, 2));
  return {
    file,
    get: k => data[k],
    set(k, v) {
      if (v === undefined) delete data[k]; else data[k] = v;
      save();
    },
    all: () => JSON.parse(JSON.stringify(data)),
  };
}

module.exports = { makeSettings, writeAtomic, unbom };
