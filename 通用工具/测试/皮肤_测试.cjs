'use strict';
/* 皮肤（开发规范第 25、31–33 条）：
   四套的名字各处对得上（lib/routes.js 的 SKINS、外框.css、外框.html、公用/皮肤.css）；每套颜色都给全；
   换过的样式里不再写死颜色；校样台的「纸面」标得对（桌面版/preload.js）。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SKINS, skinOf, skinForPage } = require('../桌面版/lib/routes.js');
const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const others = SKINS.slice(1).map(s => s.名);

/* 样式里某个选择器那一段（头一个 { 到配对的 }）里写了哪些变量 */
function block(css, selector) {
  const i = css.indexOf(selector + ' {');
  assert.ok(i >= 0, '没有这一段：' + selector);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('\n}', i));
  return new Set([...body.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
}

test('皮肤的名字不重样；头一套是默认的；认不出的名字换回默认', () => {
  assert.equal(new Set(SKINS.map(s => s.名)).size, SKINS.length);
  for (const s of SKINS) assert.match(s.底, /^#[0-9a-f]{6}$/, s.名 + ' 的底色');
  assert.equal(skinOf('没有这一套'), SKINS[0]);
  assert.equal(skinOf(SKINS[1].名), SKINS[1]);
  assert.deepEqual(skinForPage(SKINS[0]), { 名: '', 纸面: false });   // 默认那一套不写名字：页面的样式本来就是它
  for (const s of SKINS.slice(1)) assert.deepEqual(skinForPage(s), { 名: s.名, 纸面: !!s.纸面 });
});

test('外框：每套皮肤一段，--k- 的颜色给全；设置里每套一个钮、一张小样', () => {
  const css = read('桌面版/外框/外框.css'), html = read('桌面版/外框/外框.html');
  const need = [...block(css, ':root')].filter(k => k.startsWith('--k-') && !['--k-serif', '--k-sans', '--k-close-ink'].includes(k));
  assert.ok(need.length >= 10);
  for (const name of others) {
    const got = block(css, `:root[data-skin="${name}"]`);
    for (const k of need) assert.ok(got.has(k), `外框.css「${name}」少了 ${k}`);
  }
  const btns = [...html.matchAll(/data-do="skin" data-arg="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(btns, SKINS.map(s => s.名));
  for (const s of SKINS) assert.ok(css.includes(`.pick [data-arg="${s.名}"] {`), `外框.css 没有「${s.名}」的小样`);
  assert.ok(read('桌面版/外框/外框.js').includes('root.dataset.skin = s.skin'));
});

/* 每套皮肤都得给的颜色（宣纸的在 皮肤.css 头一段 :root；--toast-bg 提示条里带着默认的，:root 不用写） */
const SKIN_KEYS = `paper paper-2 paper-3 sheet white ink ink-2 ink-3 ink-4 line line-2
  zhu zhu-soft zhu-line dai dai-soft dai-line zhe zhe-soft zhe-line jin zi zi-soft zi-line
  zi2 lv lan cheng on-ink on-accent on-dai shade toast-bg grain`.split(/\s+/).map(k => '--' + k);
/* 不是宣纸的几套共用的那一段：从主色算出来的 */
const SHARED_KEYS = `paper-up ink-up zhu-up warm scroll shadow tag-jd tag-jd-ink tag-pd tag-pd-ink tag-zz tag-zz-ink tag-fy tag-fy-ink tag-sw tag-sw-ink`.split(/\s+/).map(k => '--' + k);

test('颜色都在 皮肤.css 一份：头一段 :root 是宣纸，另外每套各一段，颜色给全、名字都认得', () => {
  const css = read('公用/皮肤.css'), base = block(css, ':root');
  for (const k of [...SKIN_KEYS, ...SHARED_KEYS]) if (k !== '--toast-bg') assert.ok(base.has(k), '皮肤.css 头一段 :root 少了 ' + k);
  const style = block(read('公用/样式.css'), ':root');   // 考试页只引 皮肤.css：颜色另写在 样式.css 里，考试页就拿不到
  for (const k of [...SKIN_KEYS, ...SHARED_KEYS]) assert.ok(!style.has(k), '样式.css 的 :root 又写了 ' + k + '：颜色只放 皮肤.css');
  const shared = block(css, ':root[data-skin]');
  for (const k of SHARED_KEYS) assert.ok(shared.has(k), '皮肤.css 共用的那一段少了 ' + k);
  for (const name of others) {
    const got = block(css, `:root[data-skin="${name}"]`);
    for (const k of SKIN_KEYS) assert.ok(got.has(k), `皮肤.css「${name}」少了 ${k}`);
    for (const k of got) assert.ok(base.has(k) || k === '--toast-bg', `皮肤.css「${name}」里的 ${k}，头一段 :root 里没有这个名字`);
  }
  assert.deepEqual([...css.matchAll(/^:root\[data-skin="([^"]+)"\] \{/gm)].map(m => m[1]), others);   // 不多不少，就是这几套（考试页照原版那几段带着别的选择器，不算）
  assert.ok(read('公用/样式.css').includes('@import url("皮肤.css")'));
  assert.ok(read('桌面版/页面/登录.html').includes('公用/皮肤.css'), '登录页自己一份样式，得另引皮肤');
});

/* 一份文件里写死的颜色。不算的：:root 那一组（皮肤的颜色本身）、var(--名字, 默认色) 里的默认色、纯黑（放片子的黑底、影子）、内嵌的小图、注释 */
function hardColors(text, allowLine = () => false) {
  const out = [];
  let inRoot = false, inNote = false;
  text.split('\n').forEach((raw, i) => {
    let ln = '';   // 去掉 /* … */ 注释（可以跨行）
    for (let k = 0; k < raw.length;) {
      const end = raw.indexOf(inNote ? '*/' : '/*', k);
      if (!inNote) ln += raw.slice(k, end < 0 ? raw.length : end);
      if (end < 0) break;
      inNote = !inNote; k = end + 2;
    }
    if (/^\s*:root\b[^{]*\{/.test(ln)) inRoot = true;
    const skip = inRoot || allowLine(ln);
    if (inRoot && /\}/.test(ln)) inRoot = false;
    if (skip) return;
    const s = ln.replace(/url\("data:[^"]*"\)|url\('data:[^']*'\)/g, '').replace(/var\(\s*--[\w-]+\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\s*\)/g, 'var()')
      .replace(/#(000|000000|111|111111)(?![0-9a-zA-Z_-])/g, '').replace(/rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\s*(?:[,/]\s*[\d.]+%?\s*)?\)/g, '');
    for (const m of s.matchAll(/(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])|rgba?\(\s*\d+\s*[, ]\s*\d+\s*[, ]\s*\d+[^)]*\)/g)) out.push((i + 1) + '：' + m[0]);
  });
  return out;
}

test('换过的样式里不再写死颜色：一律用变量，换皮肤才跟得上', () => {
  const pages = `公用/样式.css 公用/提示条.css 流水线/流水线.css 流水线/后台任务.js 桌面版/页面/登录.html
    流水线/总览.html 流水线/剧本.html 流水线/分场.html 流水线/设定.html 流水线/资产.html 流水线/提示词.html 流水线/风格.html 流水线/网盘.html`.split(/\s+/);
  for (const f of pages) assert.deepEqual(hardColors(read(f)), [], f + ' 里还写死着颜色');
  /* 外框：只许 :root 各段和设置里那四张皮肤小样写颜色 */
  assert.deepEqual(hardColors(read('桌面版/外框/外框.css'), ln => /^\.pick \[data-arg="[^"]+"\] \{ --s-/.test(ln) || /^\s+--k-[\w-]+:/.test(ln)), []);
  /* 认得出毛病：这几句该被数出来；带默认色的变量、纯黑不算 */
  assert.equal(hardColors('.a { color: #a83a2c; background: rgba(42, 38, 34, .5); border-color: #fff; }').length, 3);
  assert.deepEqual(hardColors(':root {\n  --ink: #2a2622;\n}\n.b { color: var(--x, #28231e); background: #000; box-shadow: 0 0 2px rgba(0, 0, 0, .3); } &#8226;'), []);
  assert.deepEqual(hardColors('/* 默认白底 #fff，\n   落在纸上 #eee */ .c { color: var(--ink); } /* #abc */'), []);
});

/* .vue 只看 <style> 那几段，行号照旧 */
const styleOnly = vue => { let on = false; return vue.split('\n').map(ln => { if (/<\/style>/.test(ln)) { on = false; return ''; } if (/<style\b/.test(ln)) { on = true; return ''; } return on ? ln : ''; }).join('\n'); };

test('考试、团队、消息各页（桌面版/考试）：样式里不写死颜色，颜色接在 公用/皮肤.css 上', () => {
  const SRC = path.join(__dirname, '..', '桌面版', '考试', 'src');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(SRC).filter(f => /\.(css|vue)$/.test(f));
  assert.ok(files.length >= 20, '考试页的样式少得不对：' + files.length);
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.deepEqual(hardColors(f.endsWith('.vue') ? styleOnly(t) : t), [], path.relative(SRC, f) + ' 里还写死着颜色');
  }
  /* 接皮肤的那一份：引的就是 公用/皮肤.css；main.ts 在 Element Plus 自己的样式后面引它，才压得住它的默认色 */
  const bridge = path.join(SRC, 'style', '皮肤.css');
  const imp = /@import "([^"]+)"/.exec(fs.readFileSync(bridge, 'utf8'));
  assert.ok(imp && path.resolve(path.dirname(bridge), imp[1]) === path.join(__dirname, '..', '公用', '皮肤.css'), '考试/src/style/皮肤.css 得引 公用/皮肤.css');
  const main = fs.readFileSync(path.join(SRC, 'main.ts'), 'utf8');
  const ep = main.indexOf('import "element-plus/dist/index.css"'), mine = main.indexOf('import "./style/皮肤.css"');
  assert.ok(ep >= 0 && mine > ep, 'main.ts 得在 Element Plus 的样式后面引 ./style/皮肤.css');
  /* 校样台认纸面只认 --sheet、--white、--warm：考试页别再拿自己起名的变量做纸面的底 */
  for (const f of files) assert.ok(!fs.readFileSync(f, 'utf8').includes('--paper-hi'), path.relative(SRC, f) + ' 又用了 --paper-hi：纸面的底写 var(--white)');
});

test('考试各页在校样台下照原版：考试页自己那组颜色，原版的值一个不少；Element Plus 也用回它自己的', () => {
  const skin = read('公用/皮肤.css');
  const own = block(skin, ':root[data-skin="校样台"] :is(.exam-page, .exam-popper, .exam-assign-dialog)');
  const shared = read('桌面版/考试/src/views/exam/exam-shared.css');
  const tokens = [...block(shared, '.exam-page')].filter(k => !k.startsWith('--exam-') && !k.startsWith('--el-'));   // 字体（--exam-sans 这些）不算颜色
  assert.ok(tokens.length >= 15, '考试页那组颜色少得不对：' + tokens.length);
  for (const k of tokens) assert.ok(own.has(k), `exam-shared.css 的 .exam-page 有 ${k}，皮肤.css 校样台照原版那段没给它原来的值`);
  for (const k of ['--ink-2', '--paper-up', '--g-paper-2', '--white', '--hi']) assert.ok(own.has(k), '校样台照原版那段少了 ' + k + '（考试页直接借的皮肤变量）');
  const page = block(skin, ':root[data-skin="校样台"]:has(.exam-page)');
  for (const k of ['--shell-desk', '--shell-text', '--shell-ink', '--shell-mark']) assert.ok(page.has(k), '整页那段少了 ' + k + '（顶上那排菜单）');
  /* Element Plus 接皮肤的那两段，正开着考试页又是校样台时不接：它用回自己原来的颜色，和原版一样 */
  const bridge = read('桌面版/考试/src/style/皮肤.css');
  assert.ok(bridge.includes(':root:not([data-skin="校样台"]:has(.exam-page)) {\n  --el-color-white'), 'Element Plus 的颜色那段得避开校样台下的考试页');
  assert.equal((bridge.match(/:root\[data-skin="校样台"\]:not\(:has\(\.exam-page\)\) :is\(/g) || []).length, 2, '校样台的弹层那两段也得避开考试页');
});

/* 把 preload.js 放进一个假页面里跑：壳子说用哪套皮肤（first），页面的样式表是 rules */
function runPreload(first, rules) {
  const on = {};
  const head = { tag: null, get lastElementChild() { return this.tag; }, append(t) { this.tag = t; } };
  const document = {
    documentElement: { dataset: {} }, head, styleSheets: [{ ownerNode: null, cssRules: rules }],
    getElementById: id => (head.tag && head.tag.id === id ? head.tag : null),
    createElement: () => ({ id: '', textContent: '', remove() { head.tag = null; } }),
    addEventListener() {},
  };
  const electron = { contextBridge: { exposeInMainWorld() {} }, ipcRenderer: { invoke() {}, sendSync: ch => (ch === 'desk:skin' ? first : undefined), on(ch, fn) { on[ch] = fn; } } };
  vm.runInNewContext(read('桌面版/preload.js'), { require: () => electron, document, MutationObserver: class { observe() {} disconnect() {} }, requestAnimationFrame: fn => fn() });
  return { root: document.documentElement, head, say: s => on['desk:skin'](null, s), listening: !!on['desk:skin'] };
}
const rule = (selectorText, style) => ({ selectorText, style: { getPropertyValue: k => style[k] || '' } });

test('页面这头：照壳子说的写 <html data-skin>；默认那一套不写；不是本机页面的（壳子不答）什么也不做', () => {
  let p = runPreload({ 名: '墨夜', 纸面: false }, []);
  assert.equal(p.root.dataset.skin, '墨夜');
  assert.equal(p.head.tag, null);   // 不是纸面的皮肤：不用标
  p.say({ 名: '', 纸面: false });
  assert.equal('skin' in p.root.dataset, false);
  p = runPreload(null, []);
  assert.equal('skin' in p.root.dataset, false);
  assert.equal(p.listening, false);
});

test('校样台：拿纸色做底的标成亮的，别的底跟外面走；顺序、选择器照抄；纸面上没说颜色的补一句「用墨色」', () => {
  const rules = [
    rule('.card', { background: 'var(--sheet)' }),
    rule('.btn', { 'background-color': 'var(--sheet)', color: 'var(--ink)' }),           // 自己说了颜色：不补
    rule('.btn.ghost', { background: 'transparent' }),
    rule('.btn.ink', { background: 'var(--ink)' }),
    rule('.btn:hover', { background: 'var(--white)' }),                                  // 指上去那一下：不补颜色，免得压掉别的
    rule('.glass', { background: 'rgb(from var(--sheet) r g b / .7)' }),
    rule('.pick.on', { background: 'var(--warm)' }),
    rule('.plain', { color: 'var(--ink-3)' }),                                           // 没给底色：不管
    { styleSheet: { cssRules: [rule('.toast', { background: 'rgb(from var(--toast-bg, #28231e) r g b / .93)' })] } },   // @import 进来的
    { cssText: '@media (max-width: 900px) { .x { } }', cssRules: [rule('.x', { background: 'var(--sheet)' })] },
    { cssText: '@keyframes flash { 0% { } }', cssRules: [{ keyText: '0%', style: { getPropertyValue: () => 'transparent' } }] },   // 动效里的不算
  ];
  const p = runPreload({ 名: '校样台', 纸面: true }, rules);
  assert.equal(p.root.dataset.skin, '校样台');
  assert.equal(p.head.tag.id, 'desk-paper');
  assert.equal(p.head.tag.textContent, [
    '.card { color-scheme: light; color: var(--ink); }',
    '.btn { color-scheme: light; }',
    '.btn.ghost { color-scheme: inherit; }',
    '.btn.ink { color-scheme: inherit; }',
    '.btn:hover { color-scheme: light; }',
    '.glass { color-scheme: light; color: var(--ink); }',
    '.pick.on { color-scheme: light; color: var(--ink); }',
    '.toast { color-scheme: inherit; }',
    '@media (max-width: 900px) {',
    '.x { color-scheme: light; color: var(--ink); }',
    '}',
    '',
  ].join('\n'));
  p.say({ 名: '青瓷', 纸面: false });   // 换成不是纸面的：那一段样式拿掉
  assert.equal(p.root.dataset.skin, '青瓷');
  assert.equal(p.head.tag, null);
});

test('校样台的颜色：桌面和纸面各一组，写成 light-dark(纸上, 桌上)；整页说自己是深的', () => {
  const css = read('公用/皮肤.css');
  const i = css.indexOf(':root[data-skin="校样台"] {'), body = css.slice(i, css.indexOf('\n}', i));
  assert.match(body, /color-scheme: dark;/);
  for (const k of ['paper', 'ink', 'ink-2', 'ink-3', 'line', 'zhu', 'dai', 'on-ink']) assert.match(body, new RegExp(`--${k}: light-dark\\(#[0-9a-f]{6}, #[0-9a-f]{6}\\);`), '--' + k + ' 该是 light-dark(纸上, 桌上)');
  assert.match(body, /--sheet: #[0-9a-f]{6};/);   // 纸面的底色本身哪边都一样
  assert.equal(SKINS.filter(s => s.纸面).map(s => s.名).join(), '校样台');
});
