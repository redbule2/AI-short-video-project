'use strict';
/* 公用/找旧版.js：登记的那一份原处换了、挪走了，到历史记录里找（11-19 加：历史记录/原始资料 里老仓库原样搬来的） */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
globalThis.window = globalThis;
require('../公用/找旧版.js');
const R = globalThis.RefFile;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

/* 假的 FS：files 是 { 'a/b/c.png': '内容' } */
function fakeFs(files) {
  const has = p => Object.prototype.hasOwnProperty.call(files, p.join('/'));
  return {
    read: async p => { if (!has(p)) throw new Error('没有'); const b = Buffer.from(files[p.join('/')]); return { buf: new Uint8Array(b), size: b.length, mtime: 0 }; },
    list: async p => {
      const pre = p.join('/') + '/', seen = new Map();
      for (const k of Object.keys(files)) if (k.startsWith(pre)) { const rest = k.slice(pre.length).split('/'); seen.set(rest[0], rest.length > 1 ? 'directory' : 'file'); }
      return [...seen].map(([name, kind]) => ({ name, kind }));
    },
  };
}

test('原处换了新版：先找 历史记录/同样的文件夹/原名__时间', async () => {
  const fs = fakeFs({ '项目/资产/人物/兵.png': '新', '项目/历史记录/资产/人物/兵__20261111-181917.png': '旧' });
  const r = await R.find(fs, ['项目'], '资产/人物/兵.png', sha('旧'));
  assert.equal(r.file, '历史记录/资产/人物/兵__20261111-181917.png');
  assert.equal(r.here, 'changed');
});

test('老仓库搬来的：照老路径登记，到 历史记录/原始资料/老路径 找', async () => {
  const fs = fakeFs({ '项目/历史记录/原始资料/资产/参考图/加人/K1.png': '老图' });
  const r = await R.find(fs, ['项目'], '资产/参考图/加人/K1.png', sha('老图'));
  assert.equal(r.file, '历史记录/原始资料/资产/参考图/加人/K1.png');
  assert.equal(r.old, true);
  assert.equal(r.here, 'gone');
  const l = await R.locate(fs, ['项目'], '资产/参考图/加人/K1.png', sha('老图'));
  assert.equal(l.file, '历史记录/原始资料/资产/参考图/加人/K1.png');
});

test('内容对不上的不认：哪儿都没有就报错', async () => {
  const fs = fakeFs({ '项目/历史记录/原始资料/资产/参考图/加人/K1.png': '别的' });
  await assert.rejects(R.find(fs, ['项目'], '资产/参考图/加人/K1.png', sha('老图')), /找不到/);
  assert.equal(await R.locate(fs, ['项目'], '资产/参考图/加人/K1.png', sha('老图')), null);
});
