'use strict';
/* 流水线/初步剧本.js：「初步剧本」「提炼分镜」两步共用的提炼分镜（2026-11-26 他要提炼那一步也能直接点，不用退回去） */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

/* 把 初步剧本.js 放进一个假的流水线里跑：text 是初步剧本里的字，paras 是不是提炼过 */
function run(text, { paras = false, live = false, confirm = true, style = '电影感' } = {}) {
  const calls = [], scene = { 段: '1-1' };
  const ctx = {
    window: {}, SHELL: null, F: { name: '测试3', names: new Map([['1-1', { set: ['初步剧本.txt'] }]]) }, LINK: { v: 30 },
    C: { pfFileIn: () => '初步剧本.txt', PF_FILE: '初步剧本.txt', decodeText: buf => ({ text: buf }), isPF: () => true },
    FS: { read: async () => ({ buf: text }) }, at: parts => parts, segName: seg => '第' + seg + '段',
    toast: (m, k) => calls.push(['提示', m, k]), go: (page, q) => calls.push(['去', page, q.s]),
    jobOf: () => null, jobLive: () => live, hasParas: () => paras,
    confirmDlg: async o => { calls.push(['问', o.title]); return confirm; }, nowText: () => '2026-11-26 20:00:00',
    touch: () => calls.push(['存']), startJob: async j => { calls.push(['交给 AI', j.事, j.段]); return true; },
    filmStyle: () => style, styleDlg: async () => calls.push(['定风格']), sceneNow: () => scene,
  };
  vm.runInNewContext(read('流水线/初步剧本.js'), ctx);
  return { ctx, calls, scene };
}

test('有字：记下时间当剧本定稿，交给 AI 提炼，去「提炼分镜」那一步', async () => {
  const { ctx, calls, scene } = run('面馆门口，傍晚。');
  await ctx.pfExtract(scene);
  assert.equal(scene.剧本定稿, '2026-11-26 20:00:00');
  assert.equal(scene.头回定稿, '2026-11-26 20:00:00');
  assert.deepEqual(calls, [['存'], ['交给 AI', '提炼', '1-1'], ['去', '分场', '1-1']]);
});

test('还空着：说一声，不交', async () => {
  const { ctx, calls, scene } = run('  \n ');
  await ctx.pfExtract(scene);
  assert.deepEqual(calls, [['提示', '初步剧本还空着：先写好这一段的戏', 'err']]);
  assert.equal(scene.剧本定稿, undefined);
});

test('提炼过的：先问一声；不点就不动。还没定拍摄风格的，交出去以后接着定', async () => {
  const a = run('改过的戏', { paras: true, confirm: false });
  await a.ctx.pfExtract(a.scene);
  assert.deepEqual(a.calls, [['问', '照新的初步剧本重新提炼']]);
  const b = run('新的戏', { style: '' });
  await b.ctx.pfExtract(b.scene);
  assert.deepEqual(b.calls.map(x => x[0]), ['存', '交给 AI', '定风格', '去']);
});

test('两页都引它；提炼那一步锁着时摆「提炼分镜」；写稿页顶上那个钮照旧叫得到', () => {
  const fc = read('流水线/分场.html'), jb = read('流水线/剧本.html');
  for (const page of [fc, jb]) assert.ok(page.includes('<script src="流水线.js"></script>\n<script src="初步剧本.js"></script>'));
  assert.ok(!/async function pfExtract/.test(jb), '剧本.html 还留着一份');
  assert.match(fc, /onclick: \(\) => pfExtract\(s\) \}, '提炼分镜'\)/);
  const { ctx } = run('x');
  assert.equal(typeof ctx.window.wfFreeExtract, 'function');
});
