'use strict';
/* 流水线/换号出片.js（11-26 他要）：原来的号没积分了，弹窗问要不要换到别的号——挑那个号名下的一张画布，没有就新建一张。
   假的页面零件（h、dialog、本机服务），不开浏览器、不连即梦。服务那头另有 出片任务书_任务测试.js（列画布、换过去）、流水线出片_测试.cjs（积分不够就停）。 */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const file = process.env.SWAP_TEST_FILE || path.join(__dirname, '../流水线/换号出片.js');
const code = fs.readFileSync(file, 'utf8');
const PRE = 'https://jimeng.jianying.com/ai-tool/ai-canvas/', OLD = '0a0a0a0a-1111-4111-8111-000000000001', B1 = '0b0b0b0b-2222-4222-8222-000000000002', B2 = '0b0b0b0b-2222-4222-8222-000000000003';

/* 页面上的东西：只留这一份用得到的 */
class El {
  constructor(tag, attrs, kids) { this.tag = tag; this.attrs = { ...(attrs || {}) }; this.children = kids; for (const k of ['disabled', 'checked', 'value', 'onclick', 'onchange']) if (k in this.attrs) this[k] = this.attrs[k]; }
  replaceChildren(...k) { this._text = null; this.children = k.flat(Infinity).filter(x => x != null); if (this.tag === 'select') this.value = this.children.length ? this.children[0].attrs.value : ''; }
  get textContent() { return this._text != null ? this._text : this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
  all(tag) { return this.children.flatMap(c => typeof c === 'string' ? [] : [...(c.tag === tag ? [c] : []), ...c.all(tag)]); }
}
const settle = () => new Promise(r => setTimeout(r, 10));

/* set：资产/出片设置.json 里现在记的；accounts：登录位 → { on, nick, credits }；canvases：登录位 → 它名下的画布；sw：换的时候服务回什么 */
function page({ set = { 画布: PRE + OLD, 登录位: '' }, names = ['benpao', 'xiaohao', 'qiong', 'guest'], accounts, canvases = {}, sw } = {}) {
  accounts = accounts || { '': { on: true, nick: '用户597', credits: 137 }, benpao: { on: true, nick: '奔跑', credits: 52643 }, xiaohao: { on: true, nick: '小号', credits: 30000 }, qiong: { on: true, nick: '穷号', credits: 20 }, guest: { on: false } };
  const calls = [], went = [], box = { shell: null, done: undefined };
  const route = (method, url) => {
    const q = new URL('http://x' + url).searchParams, p = q.get('profile') || '', a = accounts[p] || { on: false };
    calls.push(method + ' ' + decodeURIComponent(url.replace('/api/jimeng?', '')));
    if (method === 'GET' && q.has('x')) return { profile: p, status: { ok: true, data: { data: { loggedIn: !!a.on } } }, account: a.on ? { ok: true, data: { data: { displayName: a.nick, ...(a.credits == null ? {} : { availableCredits: String(a.credits) }) } } } : null };
    if (method === 'GET' && q.has('canvases')) return canvases[p] === '查不到' ? { ok: false, error: '查不到即梦登录位「' + p + '」名下有哪些画布：超时' } : { ok: true, items: canvases[p] || [] };
    if (method === 'POST' && q.has('switch')) return sw || { ok: true, 画布: PRE + (q.get('to') || 'new'), 登录位: p, 账号: a.nick, 画布名: q.get('to') ? '现成的' : q.get('p'), 新建: !q.get('to') };
    throw new Error('没想到的请求：' + url);
  };
  const ctx = {
    F: { name: '试验换号' }, URL, isFinite, encodeURIComponent, Promise, JSON, String, Array, Set,
    h: (tag, attrs, ...kids) => new El(tag, attrs, kids.flat(Infinity).filter(x => x != null)),
    dialog: build => new Promise(res => { box.shell = build(v => { box.done = v; res(v); }); }),
    dlgShell: (title, sub, body, acts) => ({ title, sub: [].concat(sub).filter(Boolean).map(x => x.textContent).join(''), body, acts }),
    LINK: { req: async (method, url) => ({ json: async () => route(method, url) }) },
    FS: { read: async () => { if (!set) throw new Error('没有这个文件'); return { buf: JSON.stringify(set) }; } },
    C: { decodeText: buf => ({ text: buf }) }, at: parts => parts, jmNames: () => names, go: p => went.push(p),
  };
  const Swap = vm.runInNewContext(code + '\n;JmSwap', ctx, { filename: file });
  const ui = () => {   // 弹窗里现在的样子
    const [acctFld, cvFld, err] = box.shell.body, list = acctFld.children[1], cv = cvFld.all('select')[0];
    return { title: box.shell.title, sub: box.shell.sub, rows: list.all('label').map(r => ({ text: r.all('span').map(s => s.textContent).join('　'), radio: r.all('input')[0] })), none: list.all('p').map(p => p.textContent).join(''), goHome: list.all('button')[0],
      cv, opts: cv.children.map(o => o.textContent), hint: cvFld.all('em')[0].textContent, err: err.textContent, cancel: box.shell.acts[0], ok: box.shell.acts[1] };
  };
  return { Swap, calls, went, ui, box };
}

test('now：这个项目现在用哪个号、还剩多少积分；还没有出片设置的算默认号；查不到余额是 null', async () => {
  const a = await page({ set: { 画布: PRE + B1, 登录位: 'benpao', 换下的: [{ 画布: PRE + OLD, 登录位: '' }] } }).Swap.now();
  assert.deepEqual({ p: a.p, on: a.on, nick: a.nick, credits: a.credits, 画布: a.画布, n: a.换下的.length }, { p: 'benpao', on: true, nick: '奔跑', credits: 52643, 画布: PRE + B1, n: 1 });
  const b = await page({ set: null }).Swap.now();
  assert.deepEqual({ p: b.p, on: b.on, credits: b.credits, 画布: b.画布 }, { p: '', on: true, credits: 137, 画布: '' });
  const c = await page({ set: { 登录位: 'default' }, accounts: { '': { on: true, nick: '甲' } } }).Swap.now();
  assert.deepEqual({ p: c.p, credits: c.credits }, { p: '', credits: null }, '登录位写成 default 就是默认号');
  assert.equal((await page({ set: { 登录位: 'guest' } }).Swap.now()).on, false);
  assert.equal(page().Swap.who('benpao', '奔跑'), '「benpao」号「奔跑」');
  assert.equal(page().Swap.who('', ''), '默认号');
});

/* 同一天他又要：批准出片的时候，把具体哪个号、哪张画布摆给他看（「批准出片」弹窗最上面那一块） */
test('now 连画布一起查：设置里那张画布叫什么；不在这个号名下的记「画布错」；没写画布的不查，没查到的两样都不记', async () => {
  const hit = page({ set: { 画布: PRE + B1.toUpperCase(), 登录位: 'benpao' }, canvases: { benpao: [{ id: B2, name: '别的项目' }, { id: B1, name: '药膳鸡配方' }] } }), a = await hit.Swap.now();
  assert.deepEqual([a.画布名, a.画布错, a.nick, a.credits], ['药膳鸡配方', undefined, '奔跑', 52643]);
  assert.ok(hit.calls.includes('GET canvases=1&profile=benpao'), '到这个号名下的画布里找');
  assert.equal((await page({ canvases: { '': [{ id: OLD, name: '' }] } }).Swap.now()).画布名, OLD.slice(0, 8), '画布没起名：写编号头八位');
  const wrong = await page({ canvases: { '': [{ id: B2, name: '别的项目' }] } }).Swap.now();
  assert.deepEqual([wrong.画布名, wrong.画布错], [undefined, true]);
  const none = page({ set: null }), n = await none.Swap.now();
  assert.deepEqual([n.画布名, n.画布错], [undefined, undefined]);
  assert.ok(!none.calls.some(c => /canvases/.test(c)), '没写画布：不查');
  const lost = await page({ set: { 画布: PRE + B1, 登录位: 'benpao' }, canvases: { benpao: '查不到' } }).Swap.now();
  assert.deepEqual([lost.画布名, lost.画布错, lost.nick], [undefined, undefined, '奔跑'], '画布没查到，不碍着号');
});

test('批准出片弹窗最上面那一块：写明哪个号（登录位、昵称、还剩多少积分）、哪张画布（名字）；估价比剩的多、没登录、画布对不上的标红；能点「换个号」', () => {
  const S = page().Swap;
  const view = (a, cost) => {
    const [label, box] = S.card(a, cost || 0, () => '点了换个号');
    return { label: label.children[0], rows: box.children.map(r => r.children.map(x => x.textContent).join('｜')), red: box.children.map(r => r.all('span').some(x => /warn/.test(x.attrs.class))), link: label.all('button')[0] };
  };
  const ok = { p: 'benpao', nick: '奔跑', on: true, credits: 52643, 画布: PRE + B1, 画布名: '药膳鸡配方' };
  let v = view(ok, 180);
  assert.equal(v.label, '用这个号、这张画布出');
  assert.deepEqual(v.rows, ['即梦号｜「benpao」号「奔跑」｜还剩 52643 积分', '画　布｜「药膳鸡配方」']);
  assert.deepEqual(v.red, [false, false]);
  assert.equal(v.link.textContent, '换个号');
  assert.equal(v.link.onclick(), '点了换个号');
  v = view({ ...ok, p: '', nick: '用户597', credits: 137 }, 180);
  assert.deepEqual([v.rows[0], v.red[0]], ['即梦号｜默认号「用户597」｜还剩 137 积分，估计不够出这一条', true]);
  assert.equal(view({ ...ok, credits: 137 }, 0).red[0], false, '估不出价的不标红');
  assert.equal(view({ ...ok, credits: null }, 180).rows[0], '即梦号｜「benpao」号「奔跑」', '查不到余额：不写积分');
  v = view({ ...ok, on: false, nick: '', credits: null }, 180);
  assert.deepEqual([v.rows[0], v.red[0]], ['即梦号｜「benpao」号｜没登录：到首页「即梦授权」登录，或者换个号', true]);
  v = view({ ...ok, 画布名: undefined, 画布错: true });
  assert.deepEqual([v.rows[1], v.red[1]], ['画　布｜编号 0b0b0b0b 的那张｜不在这个号名下，出片会被拦下：换个号', true]);
  assert.equal(view({ ...ok, 画布名: undefined }).rows[1], '画　布｜编号 0b0b0b0b 的那张｜名字没查到');
  assert.equal(view({ ...ok, 画布: '', 画布名: undefined }).rows[1], '画　布｜还没有｜批准以后新建一张，名字写「试验换号」');
  v = view({ ...ok, 画布: 'https://example.com/x', 画布名: undefined });
  assert.deepEqual([v.rows[1], v.red[1]], ['画　布｜网址不对｜资产/出片设置.json 里记的不是即梦画布的网址，出片会被拦下', true]);
  const [l0, wait] = S.card(null, 0, () => {});
  assert.equal(l0.textContent + '｜' + wait.textContent, '用哪个号、哪张画布出｜在查用哪个即梦号、哪张画布…');
});

test('积分不够弹出来：说清差多少、没花积分；别的号照积分多少排，不够的、没登录的点不了；头一个能换的先选上', async () => {
  const p = page({ canvases: { benpao: [{ id: B1, name: '持械入宋' }, { id: B2, name: '别的项目' }] } });
  p.Swap.dlg({ 要: 180, 有: 137, 登录位: '', 账号: '用户597' });
  await settle();
  const u = p.ui();
  assert.equal(u.title, '积分不够，换个号出？');
  assert.match(u.sub, /^默认号「用户597」只剩 137 积分，这一条报价 180。停在草稿，没花积分。/);
  assert.match(u.sub, /这个项目都用新号的这张画布出；用到的素材出片时在新画布上重新传一遍，不花积分。原来那张画布不动。$/);
  assert.deepEqual(u.rows.map(r => r.text), ['「benpao」号「奔跑」　还剩 52643 积分', '「xiaohao」号「小号」　还剩 30000 积分', '「qiong」号「穷号」　也不够，只剩 20 积分', '「guest」号　没登录']);
  assert.deepEqual(u.rows.map(r => [!!r.radio.disabled, !!r.radio.checked]), [[false, true], [false, false], [true, false], [true, false]]);
  assert.deepEqual(u.opts, ['新建一张，名字写「试验换号」', '持械入宋', '别的项目']);
  assert.equal(u.cv.value, '', '那个号上没有这个项目的画布：先选新建，别的项目的画布不替人挑');
  assert.match(u.hint, /^这个号名下有 2 张画布/);
  assert.equal(u.ok.textContent, '换到这个号，接着出');
  assert.equal(u.ok.disabled, false);
  assert.ok(!p.calls.some(c => c.startsWith('POST')), '没点以前不换');
});

test('挑画布：这个项目以前在那个号上用过的排头一个；没有就看有没有和项目同名的；那个号一张都没有就只能新建', async () => {
  const used = page({ set: { 画布: PRE + OLD, 登录位: '', 换下的: [{ 画布: PRE + B2.toUpperCase(), 登录位: 'benpao' }, { 画布: PRE + B1, 登录位: 'xiaohao' }] }, canvases: { benpao: [{ id: B1, name: '试验换号' }, { id: B2, name: '老画布' }] } });
  used.Swap.dlg(null);
  await settle();
  assert.equal(used.ui().cv.value, B2);
  assert.deepEqual(used.ui().opts, ['新建一张，名字写「试验换号」', '试验换号（和项目同名）', '老画布（这个项目以前用过）']);
  const same = page({ canvases: { benpao: [{ id: B1, name: '别的' }, { id: B2, name: '试验换号' }] } });
  same.Swap.dlg(null);
  await settle();
  assert.equal(same.ui().cv.value, B2);
  const none = page({ names: ['xiaohao'] });
  none.Swap.dlg(null);
  await settle();
  assert.deepEqual(none.ui().opts, ['新建一张，名字写「试验换号」']);
  assert.equal(none.ui().hint, '这个号还没有画布：新建一张');
  assert.equal(none.ui().ok.disabled, false);
});

test('自己点「换个号」进来的：不说积分不够；现在用的那个号不列，积分少的也能挑', async () => {
  const p = page({ set: { 画布: PRE + B1, 登录位: 'benpao' } });
  p.Swap.dlg(null);
  await settle();
  const u = p.ui();
  assert.equal(u.title, '换个即梦号出片');
  assert.doesNotMatch(u.sub, /只剩|报价/);
  assert.deepEqual(u.rows.map(r => r.text.split('　')[0]), ['「xiaohao」号「小号」', '默认号「用户597」', '「qiong」号「穷号」', '「guest」号']);
  assert.deepEqual(u.rows.map(r => !!r.radio.disabled), [false, false, false, true]);
  assert.equal(u.ok.textContent, '换到这个号');
});

test('点「换到这个号」：告诉服务换到哪个号、哪张画布（没挑画布就是新建），换好把结果交回去', async () => {
  const p = page({ canvases: { benpao: [{ id: B1, name: '试验换号' }] } });
  const done = p.Swap.dlg({ 要: 180, 有: 137, 登录位: '', 账号: '用户597' });
  await settle();
  assert.equal(p.ui().cv.value, B1);
  p.ui().ok.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(await done)), { ok: true, 画布: PRE + B1, 登录位: 'benpao', 账号: '奔跑', 画布名: '现成的', 新建: false });
  assert.equal(p.calls.filter(c => c.startsWith('POST')).join(), 'POST switch=1&p=试验换号&profile=benpao&to=' + B1);
  const q = page({ names: ['xiaohao'] }), made = q.Swap.dlg(null);
  await settle();
  q.ui().ok.onclick();
  assert.equal((await made).新建, true);
  assert.equal(q.calls.filter(c => c.startsWith('POST')).join(), 'POST switch=1&p=试验换号&profile=xiaohao');
});

test('换另一个号：重查那个号的画布；先点的那个号回得慢也不串', async () => {
  const p = page({ canvases: { benpao: [{ id: B1, name: '试验换号' }], xiaohao: [] } });
  p.Swap.dlg(null);
  await settle();
  const rows = p.ui().rows;
  rows[1].radio.onchange();   // 改挑小号
  await settle();
  assert.deepEqual(p.ui().opts, ['新建一张，名字写「试验换号」']);
  p.ui().ok.onclick();
  await settle();
  assert.match(p.calls.filter(c => c.startsWith('POST')).join(), /profile=xiaohao$/);
});

test('没换成、画布查不到：照实写在弹窗里，弹窗不关，能再点', async () => {
  const p = page({ sw: { ok: false, error: '画布不在即梦登录位「benpao」名下' } });
  p.Swap.dlg(null);
  await settle();
  p.ui().ok.onclick();
  await settle();
  assert.equal(p.ui().err, '没换成：画布不在即梦登录位「benpao」名下');
  assert.equal(p.box.done, undefined, '弹窗还开着');
  assert.equal(p.ui().ok.disabled, false);
  const q = page({ canvases: { benpao: '查不到' } });
  q.Swap.dlg(null);
  await settle();
  assert.equal(q.ui().err, '查不到即梦登录位「benpao」名下有哪些画布：超时');
  assert.equal(q.ui().ok.disabled, true, '画布没查到：不让点');
});

test('没有能换的号：说清去哪加（首页「即梦授权」），不让点「换」；点「先不出」什么都不换', async () => {
  const p = page({ names: [] });   // 这台电脑只有默认号，现在用的就是它
  const done = p.Swap.dlg({ 要: 180, 有: 137, 登录位: '', 账号: '用户597' });
  await settle();
  assert.match(p.ui().none, /这台电脑上还没有别的即梦号。到首页的「即梦授权」加一个登录位、登录好（或者给现在这个号充积分），再回来点「批准出片」。/);
  assert.equal(p.ui().ok.disabled, true);
  p.ui().goHome.onclick();
  assert.equal(await done, null);
  assert.deepEqual(p.went, ['总览']);
  const q = page({ names: ['qiong', 'guest'] }), d2 = q.Swap.dlg({ 要: 180, 有: 137, 登录位: '', 账号: '用户597' });
  await settle();
  assert.match(q.ui().none, /^这几个号都换不了。/);
  assert.equal(q.ui().cancel.textContent, '先不出');
  q.ui().cancel.onclick();
  assert.equal(await d2, null);
  assert.ok(!q.calls.some(c => c.startsWith('POST')));
});
