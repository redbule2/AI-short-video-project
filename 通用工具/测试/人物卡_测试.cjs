'use strict';
// node 通用工具/测试/人物卡_测试.cjs
// 11-26 他定：每张人物资产图都是人物卡（一张横图：正脸大特写、侧脸特写，加脖子以下的正、侧、背全身）；成群的路人点「只要全身」照旧；竖幅全身照算缺脸部特写（公用/人物卡.js）。
// 这里试：规矩的字、竖不竖、只要全身、读文件头量大小、发给 Codex 的话、页面量缩小图。不碰真项目。
const assert = require('node:assert/strict');
const FaceCard = require('../公用/人物卡.js');

/* 做几种图的文件头 */
const png = (w, h) => { const b = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b, 0); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const jpg = (w, h) => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, ...Array(14).fill(0), 0xFF, 0xC4, 0x00, 0x04, 0x00, 0x00,   // APP0、DHT（不是 SOF，要跳过）
  0xFF, 0xFF, 0xC0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, ...Array(9).fill(0)]);   // 前面多一个填充的 FF，再是 SOF0
const webp = (w, h) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(30, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1'); b.writeUInt32LE(10, 16); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };

/* ---------- 一、规矩的字：写字和发给 Codex 的用同一句 ---------- */
assert.match(FaceCard.RULE, /^人物：人物卡，/);
assert.ok(FaceCard.RULE.includes(FaceCard.CARD), '写字的出图规矩和发给 Codex 的话用同一句人物卡');
assert.match(FaceCard.CARD, /横幅 16:9/); assert.match(FaceCard.CARD, /正脸大特写/); assert.ok(FaceCard.CARD.includes('3/4 侧脸特写')); assert.match(FaceCard.CARD, /取景从脖子到鞋底，头在画框外/, '无头三视图：全图只剩特写里的脸');
assert.match(FaceCard.SHORT, /脖子以下/); assert.match(FaceCard.CARD, /同一个人/);
assert.match(FaceCard.RULE, /不写「人物卡」这个词/, '出图提示词里别写「卡」：免得画成一张卡片');
assert.match(FaceCard.RULE, /标了「只要全身」的（成群的路人）照旧出定妆照.*竖幅 2:3/);
assert.match(FaceCard.ASK, /人物卡/); assert.match(FaceCard.ASK, /别改样子/);
console.log('人物卡：规矩的字 ✓');

/* ---------- 二、竖不竖、只要全身 ---------- */
assert.equal(FaceCard.tall(1024, 1536), true, '以前的竖幅全身照');
assert.equal(FaceCard.tall(1536, 864), false, '人物卡是横的');
assert.equal(FaceCard.tall(1024, 1024), false); assert.equal(FaceCard.tall(1000, 1080), false, '差不多方的不算竖');
assert.equal(FaceCard.tall(0, 100), false, '量不出宽：不算');
const e = { 名: '我军士兵' };
assert.equal(FaceCard.bodyOnly(e), false);
assert.equal(FaceCard.setBodyOnly(e, true), true); assert.equal(e.只全身, true); assert.equal(FaceCard.bodyOnly(e), true);
FaceCard.setBodyOnly(e, false); assert.ok(!('只全身' in e), '改回来就去掉，不留 false');
assert.equal(FaceCard.setBodyOnly(null, true), false); assert.equal(FaceCard.bodyOnly(null), false);
console.log('人物卡：竖不竖、只要全身 ✓');

/* ---------- 三、读文件头量大小（本机服务用） ---------- */
assert.deepEqual(FaceCard.sizeOf(png(1024, 1536)), { w: 1024, h: 1536 });
assert.deepEqual(FaceCard.sizeOf(jpg(1536, 864)), { w: 1536, h: 864 }, 'JPEG：跳过 APP0、DHT、填充的 FF，认 SOF0');
assert.deepEqual(FaceCard.sizeOf(webp(800, 1200)), { w: 800, h: 1200 });
assert.deepEqual(FaceCard.sizeOf(new Uint8Array(png(3, 4))), { w: 3, h: 4 }, 'Uint8Array 也认');
assert.equal(FaceCard.sizeOf(Buffer.from('not an image at all, just some plain text here')), null);
assert.equal(FaceCard.sizeOf(null), null); assert.equal(FaceCard.sizeOf(Buffer.alloc(5)), null);
console.log('人物卡：读文件头 ✓');

/* ---------- 四、发给 Codex 的话：一行一句，不空行、不写列表 ---------- */
const a = FaceCard.drawLines('');
assert.equal(a.length, 1); assert.equal(a[0], '这一张是人物卡（照任务书「人物卡」那一节做）：' + FaceCard.CARD + '。');
const b = FaceCard.drawLines('E:\\x\\资产\\人物和道具\\童磊.png');
assert.equal(b.length, 2); assert.equal(b[1], '原图（竖幅全身照，还没有脸部特写；人物卡照它的长相、穿着出）：E:\\x\\资产\\人物和道具\\童磊.png');
assert.ok([...a, ...b].every(l => l.trim() && !/^\s*[-*] /.test(l) && !l.includes('\n')));
console.log('人物卡：发给 Codex 的话 ✓');

/* ---------- 五、页面：看资产卡那张缩小图是不是竖的 ---------- */
(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  assert.equal(FaceCard.lacks({}, ['x.png'], 1, () => {}), false, '没有页面（本机服务里）：不算缺');
  const sizes = new Map([['a.png@400', [400, 600]], ['b.png@400', [400, 225]]]);
  let made = 0, again = 0;
  global.window = { UI: { thumbOf: async (parts, w) => { made++; return parts.join('/') + '@' + w; }, thumbSize: u => sizes.get(u) || null } };
  const bump = () => again++;
  assert.equal(FaceCard.lacks({}, ['a.png'], 1, bump), false, '头一回还没量：先不算缺');
  assert.equal(FaceCard.lacks({}, ['b.png'], 1, bump), false);
  await wait(150);
  assert.equal(FaceCard.lacks({}, ['a.png'], 1, bump), true, '竖的：缺脸部特写');
  assert.equal(FaceCard.lacks({}, ['b.png'], 1, bump), false, '横的：不缺');
  assert.equal(again, 1, '量出竖的才重画；几张一起量好只重画一回');
  assert.equal(made, 2, '量过的不再量');
  assert.equal(FaceCard.lacks({ 只全身: true }, ['a.png'], 1, bump), false, '只要全身的不算缺');
  FaceCard.lacks({}, ['a.png'], 2, bump);   // 图换过（文件时间变了）：重量
  await wait(150);
  assert.equal(made, 3);
  FaceCard.lacks({}, ['c.png'], 1, null);
  await wait(20);
  assert.equal(FaceCard.lacks({}, ['c.png'], 1, null), false, '量不出大小：不算缺');
  delete global.window;
  console.log('人物卡：页面量缩小图 ✓');
  console.log('人物卡_测试 全部通过');
})().catch(err => { console.error(err); process.exit(1); });
