'use strict';
// node 通用工具/测试/同一秒出图_测试.cjs
// 11-27 药膳鸡：资产页一次勾 8 样「出图」，8 个任务同一秒开工。任务文件夹原来只按「时间到秒_出图_第N段」起名，7 样挤进同一个文件夹，
// 交给 AI 的话一个盖一个；往 Codex 里排队发时才读文件，读到的都是最后那份，7 个对话全出了集市。
// 这里照页面那样走接口，把时间钉在同一刻，一次点 8 样：每样一个文件夹、话各是各的、发进 Codex 的 8 句话各是各的、对话号对得上；
// 那一秒的文件夹已经有了的，往后挪一秒。项目读写都在内存里；Codex 换成假的（和真的一样，发的那一刻才读文件）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const backend = path.resolve(__dirname, '../../.agents/skills/annotate-live/jobs.js');
const source = fs.readFileSync(backend, 'utf8');
const root = path.resolve(__dirname, '__内存测试根__');
const P = (...a) => path.join(root, '项目', '测试', ...a);
const CX = path.join(path.resolve(path.dirname(backend), '..'), 'codex-chat', 'codex-chat.ps1');   // jobs.js 里 codex-chat 的位置
const T0 = new Date(2026, 10, 27, 6, 35, 32, 990).getTime();   // 钉在一秒的末尾（那回张三丰就是早了 2 毫秒，单独占了一个文件夹）
const FIN = '2026-11-16 10:00:00', finMs = Date.parse('2026-11-16T10:00:00');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const err = code => Object.assign(new Error(code), { code });
const PEOPLE = ['张三丰', '小无忌', '童翠山', '殷素素', '绿袍老者', '白袍老者'];
const ITEMS = [...PEOPLE.map(名 => ({ 类别: '人物', 名, 图: '资产/人物和道具/' + 名 + '.png' })),
  { 类别: '道具', 名: '马车', 图: '资产/人物和道具/马车.png' }, { 类别: '场景', 名: '武当山脚集市', 图: '资产/场景/武当山脚集市.png' }];

function setup(before = []) {   // before：AI任务 里已经有的文件夹
  const flow = { 梗概: '集市遇袭', 人物: PEOPLE.map(名 => ({ 名, 描写: 名 + '的样子' })), 道具: [{ 名: '马车', 描写: '卸了马的马车' }], 场景: '武当山脚集市：黄土长街',
    场: [{ 段: '1', 名: '集市遇袭', 人物: PEOPLE, 道具: ['马车'], 场景文字: ['武当山脚集市：黄土长街'], 剧本定稿: FIN }] };
  const files = new Map(), dirs = new Set(), mtimes = new Map();
  const R = p => path.resolve(String(p));
  const addDir = d => { for (let p = R(d); !dirs.has(p); p = path.dirname(p)) { dirs.add(p); if (path.dirname(p) === p) break; } };
  const put = (p, data) => { files.set(R(p), Buffer.from(data)); addDir(path.dirname(R(p))); };
  put(P('定稿的剧本', '流水线.json'), JSON.stringify(flow));
  put(P('定稿的剧本', '第1段', '第1段_剧本.docx'), 'docx'); mtimes.set(R(P('定稿的剧本', '第1段', '第1段_剧本.docx')), finMs - 5000);
  for (const x of ITEMS) put(P('提示词', '全局资产', x.类别, x.名 + '_提示词.txt'), '用途：' + x.类别 + '「' + x.名 + '」的定妆图\n提示词\n' + x.名 + '，纯中灰色摄影棚背景。\n');
  put(CX, '假的');
  for (const d of before) addDir(P('历史记录', 'AI任务', d));
  const list = dir => { const d = R(dir) + path.sep; return [...new Set([...files.keys(), ...dirs].filter(p => p.startsWith(d)).map(p => p.slice(d.length).split(path.sep)[0]))]; };
  const mockFs = {
    existsSync: p => files.has(R(p)) || dirs.has(R(p)),
    readFileSync(p, enc) { if (!files.has(R(p))) throw err('ENOENT'); return enc ? files.get(R(p)).toString(enc) : Buffer.from(files.get(R(p))); },
    readdirSync: dir => { if (!dirs.has(R(dir))) throw err('ENOENT'); return list(dir); },
    promises: {
      async readFile(p, enc) { if (!files.has(R(p))) throw err('ENOENT'); return enc ? files.get(R(p)).toString(enc) : Buffer.from(files.get(R(p))); },
      async stat(p) {
        if (dirs.has(R(p))) return { mtimeMs: 0, size: 0, isFile: () => false, isDirectory: () => true };
        if (!files.has(R(p))) throw err('ENOENT');
        return { mtimeMs: mtimes.get(R(p)) || 0, size: files.get(R(p)).length, isFile: () => true, isDirectory: () => false };
      },
      async mkdir(p, o) {   // 和真的一样：不带 recursive 的，已经有了就报 EEXIST
        if (o && o.recursive) return void addDir(p);
        if (dirs.has(R(p)) || files.has(R(p))) throw err('EEXIST');
        if (!dirs.has(path.dirname(R(p)))) throw err('ENOENT');
        dirs.add(R(p));
      },
      async readdir(dir) { if (!dirs.has(R(dir))) throw err('ENOENT'); return list(dir); },
      async writeFile(p, data) { put(p, data); },
      async appendFile(p, data) { put(p, Buffer.concat([files.get(R(p)) || Buffer.alloc(0), Buffer.from(data)])); },
      async rename(from, to) { if (!files.has(R(from))) throw err('ENOENT'); put(to, files.get(R(from))); files.delete(R(from)); },
      async unlink(p) { if (!files.delete(R(p))) throw err('ENOENT'); },
      async copyFile(from, to) { if (!files.has(R(from))) throw err('ENOENT'); put(to, files.get(R(from))); },
      async utimes() {},
    },
  };
  const sent = [];   // 发进假 Codex 的话：发的那一刻才读文件
  const spawn = (cmd, args) => {
    if (!(/powershell/i.test(cmd) && (args || []).includes('-PromptFile'))) throw Error('测试不能调用外部程序：' + cmd + ' ' + (args || []).join(' '));
    const f = R(args[args.indexOf('-PromptFile') + 1]), thread = '019a0000-0000-7000-8000-' + String(sent.length + 1).padStart(12, '0');
    sent.push({ text: files.has(f) ? files.get(f).toString() : '', thread });
    const child = new EventEmitter();
    Object.assign(child, { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, pid: 1, stdin: { on() {}, end() {} } });
    setTimeout(() => { child.stdout.emit('data', Buffer.from('RESULT_JSON ' + JSON.stringify({ ok: true, status: 'sent', thread_id: thread }) + '\n')); child.exitCode = 0; child.emit('close', 0); }, 5);
    return child;
  };
  const fakeHand = () => ({ claudeDesktop: false, openClaude: async () => {}, claudeStarted: () => null, codexDesktop: true, dsHarness: false,
    openDeepSeek: async () => {}, dsState: () => ({}), dsStop() {}, doubaoWork: false, openDoubao: async () => {} });
  class FakeDate extends Date {   // 钟停在 T0：一次点的几样都在同一秒
    constructor(...a) { if (a.length) super(...a); else super(T0); }
    static now() { return T0; }
  }
  const box = { module: { exports: {} }, __dirname: path.dirname(backend), Buffer, process, URL, setTimeout, clearTimeout, setImmediate, setInterval, clearInterval, Date: FakeDate,
    require: name => name === 'fs' ? mockFs : name === 'child_process' ? { spawn } : name === './handoff.js' ? fakeHand : require(name.startsWith('.') ? path.resolve(path.dirname(backend), name) : name),
  };
  vm.runInNewContext(source, box, { filename: backend });
  const api = box.module.exports({ ROOT: root, TOOLS: path.resolve(__dirname, '..'), log() {}, withFileLocks: async (paths, fn) => fn() });
  async function call(method, url, body) {
    let out;
    const json = (res, obj) => { out = obj; };
    const readBody = async () => Buffer.from(typeof body === 'string' ? body : JSON.stringify(body || {}));
    const httpErr = (code, msg) => Object.assign(new Error(msg), { status: code });
    await api.handle({ method }, {}, new URL('http://127.0.0.1' + url), { json, readBody, httpErr });
    return out === undefined ? out : JSON.parse(JSON.stringify(out));   // 沙箱里的数组不是这边的 Array：转一道再比
  }
  const text = rel => { const p = R(path.join(root, ...rel.split('/'))); return files.has(p) ? files.get(p).toString() : ''; };
  return { call, sent, text };
}
const ask = x => ({ 事: '出图', 项目: '测试', 段: '1', 类别: x.类别, 名: x.名, 渠道: 'codex', 参数: { 图: x.图 } });
async function allSent(s, ids) {   // 都发进 Codex、记下对话号
  for (let i = 0; i < 300; i++) {
    const js = await Promise.all(ids.map(id => s.call('GET', '/api/job/' + id)));
    if (js.every(j => j.交给 && j.交给.会话)) return js;
    if (js.some(j => j.状态 === '没成')) throw new Error('有任务没成：' + js.filter(j => j.状态 === '没成').map(j => j.名 + '：' + j.错误).join('；'));
    await sleep(10);
  }
  throw new Error('一直没都发出去');
}
const stampOf = t => { const d = new Date(t), two = n => String(n).padStart(2, '0'); return d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' + two(d.getHours()) + two(d.getMinutes()) + two(d.getSeconds()); };

(async () => {
  let tested = 0;
  const check = async (name, fn) => { await fn(); tested++; console.log('✓ ' + name); };

  await check('同一秒点 8 样：一样一个文件夹，名字照旧「时间_出图_第N段」，撞了往后挪一秒', async () => {
    const s = setup();
    const made = await Promise.all(ITEMS.map(x => s.call('POST', '/api/job', ask(x))));
    assert.deepEqual(made.map(j => j.渠道), ITEMS.map(() => 'codex'));
    const js = await allSent(s, made.map(j => j.id));
    const dirs = js.map(j => j.记录.split('/').pop());
    assert.equal(new Set(dirs).size, 8, '8 样 8 个文件夹：' + dirs.join('、'));
    assert.deepEqual([...dirs].sort(), ITEMS.map((x, i) => stampOf(T0 + i * 1000) + '_出图_第1段'), '同一秒的往后挪：' + dirs.join('、'));
    for (const d of dirs) assert.match(d, /^\d{8}-\d{6}_出图_第1段$/, '还是「时间_事_第N段」：资产详情.js、resumeSelf 照这个认');
    for (const j of js) {
      const msg = s.text(j.记录 + '/交给AI的话.txt'), meta = JSON.parse(s.text(j.记录 + '/自己交.json'));
      assert.ok(msg.includes('这一张：' + j.类别 + '「' + j.名 + '」') && msg.includes(' reply ' + j.id + '\n'), j.名 + '：文件夹里的话是它自己的');
      assert.equal(meta.id, j.id); assert.equal(meta.会话, j.交给.会话, j.名 + '：自己交.json 记的是它自己的对话');
    }
    assert.equal(js.filter(j => s.text(j.记录 + '/交给AI的话.txt').includes('「武当山脚集市」')).length, 1, '只有集市那一份话里是集市');
    await Promise.all(made.map(j => s.call('POST', '/api/job/' + j.id + '?cancel')));
  });

  await check('发进 Codex 的 8 句话各是各的：对话号对得上那一样，没有一句是别人的', async () => {
    const s = setup();
    const made = await Promise.all(ITEMS.map(x => s.call('POST', '/api/job', ask(x))));
    const js = await allSent(s, made.map(j => j.id));
    assert.equal(s.sent.length, 8, '一样只发一回');
    assert.equal(new Set(s.sent.map(x => x.text)).size, 8, '8 句话不一样');
    for (const j of js) {
      const got = s.sent.find(x => x.thread === j.交给.会话);
      assert.ok(got, j.名 + '：认得出是哪个对话');
      assert.ok(got.text.includes('这一张：' + j.类别 + '「' + j.名 + '」'), j.名 + '：发进它那个对话的是它自己');
      assert.ok(got.text.includes(' reply ' + j.id + '\n'), j.名 + '：话里的号是它自己的');
      assert.ok(got.text.startsWith('【测试 · '), '头一行还是对话名');
    }
    assert.equal(s.sent.filter(x => x.text.includes('「武当山脚集市」')).length, 1, '集市只发一回');
    await Promise.all(made.map(j => s.call('POST', '/api/job/' + j.id + '?cancel')));
  });

  await check('那一秒的文件夹已经有了（上一回留下的）：往后挪一秒，不往别人的文件夹里写', async () => {
    const old = stampOf(T0) + '_出图_第1段', s = setup([old]);
    const j = await s.call('POST', '/api/job', ask(ITEMS[0]));
    const [got] = await allSent(s, [j.id]);
    assert.equal(got.记录.split('/').pop(), stampOf(T0 + 1000) + '_出图_第1段');
    assert.equal(s.text('项目/测试/历史记录/AI任务/' + old + '/交给AI的话.txt'), '', '原来那个文件夹没被写');
    await s.call('POST', '/api/job/' + j.id + '?cancel');
  });

  console.log('同一秒出图_测试 ' + tested + ' 项全部通过');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
