'use strict';
/* ============================================================
   对剧本（2026-11-16 他定）：片子定稿了、审片写了批注，和定稿的剧本对一对；对不上的，替他在剧本旁边写剧本批注。
   AI 不改剧本：批注写进 定稿的剧本/第N段/第N段_剧本_批注.md（和他在剧本页写的是同一份，那一行已经有批注的接在后面），
   他在剧本页看过、删掉不同意的，再照老办法交给 AI 照批注改、重新定稿。
   两件事，审片页自动开，不用复制给 AI：
     定稿对剧本  点「满意，选定」、「这一段定稿」时：那条样片当初照哪一版提示词出的，和剧本比。以片子为准，剧本跟着改
     审片对剧本  写完审片批注、从审片台回来时：这条样片的批注里，哪几条其实是剧本的毛病
   谁来对：先本机 Codex 命令行（codex exec，只读、不开窗口、照 JSON 格式回）；Codex 没成、超时，换内置的 DeepSeek 接口。
   DeepSeek 的 key 每台电脑自己填（流水线顶栏「内置 AI」），存在 用户目录\.antou\内置AI.json，不进仓库、不上网盘。
   每回对了什么记在 定稿的剧本/第N段/第N段_对剧本.json（AI 写，页面只读）；同样的材料、剧本也没动过，就不再对。
   接口：GET /api/builtin-ai 看 Codex 在不在、key 填没填（不回 key 本身）；POST 填 key（先查余额，对得上才存）；POST ?test 查余额；DELETE 删 key
   ============================================================ */
const path = require('path');
const os = require('os');
const crypto = require('crypto');

module.exports = function makeScriptCheck(d) {
  const { fsp, pj, run, writeFile, withFileLocks, Core, log, nowText, today, str, fail, segDir, scriptPath, exists, unbom } = d;
  const env = d.env || process.env;
  const fetchFn = d.fetch || ((...a) => fetch(...a));
  const CONF = env.ANTOU_BUILTIN_AI || path.join(os.homedir(), '.antou', '内置AI.json');
  /* DeepSeek 接口的地址：ANTOU_DEEPSEEK_URL 只给测试（本机假服务）用，只认 127.0.0.1 / localhost，免得 key 被发到别处 */
  const DS_BASE = (() => { const u = str(env.ANTOU_DEEPSEEK_URL).replace(/\/+$/, ''); return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u) ? u : 'https://api.deepseek.com'; })();
  const DS_MODEL = 'deepseek-flash';
  const CODEX_MS = Number(env.ANTOU_CHECK_CODEX_MS) || 6 * 60e3;   // Codex 这么久还没对完，算它没及时批注，换 DeepSeek
  const DS_MS = Number(env.ANTOU_CHECK_DS_MS) || 6 * 60e3;
  const oneLine = v => str(v).replace(/\s+/g, ' ').trim();
  const sha = t => crypto.createHash('sha1').update(t).digest('hex').slice(0, 16);

  /* ---------- 本机设置：DeepSeek 的 key ---------- */
  async function readConf() {
    try { const c = JSON.parse(unbom(await fsp.readFile(CONF, 'utf8'))); return c && typeof c === 'object' && !Array.isArray(c) ? c : {}; } catch (e) { return {}; }
  }
  const dsKey = async () => str(((await readConf()).DeepSeek || {}).key).trim();
  async function balance(key) {   // 查余额（不花钱）：key 对不对、还有没有钱
    let r;
    try { r = await fetchFn(DS_BASE + '/user/balance', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(20e3) }); }
    catch (e) { throw fail('连不上 DeepSeek：' + e.message); }
    if (r.status === 401) throw fail('这个 key 不对（DeepSeek 说 401）');
    if (!r.ok) throw fail('DeepSeek 查余额出错 ' + r.status);
    const j = await r.json().catch(() => ({}));
    const b = (Array.isArray(j.balance_infos) ? j.balance_infos : [])[0] || {};
    return { 能用: !!j.is_available, 余额: str(b.total_balance) + (b.currency === 'CNY' ? ' 元' : b.currency ? ' ' + b.currency : '') };
  }
  function codexExe() {   // Codex 桌面版带的命令行：%LOCALAPPDATA%\OpenAI\Codex\bin\<一串>\codex.exe，几份取最新的
    if (env.ANTOU_CODEX_EXE) return env.ANTOU_CODEX_EXE;
    const bin = path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenAI', 'Codex', 'bin');
    const fs = require('fs');
    let best = '', t = 0;
    try { for (const n of fs.readdirSync(bin)) { const p = path.join(bin, n, 'codex.exe'); try { const m = fs.statSync(p).mtimeMs; if (m > t) { t = m; best = p; } } catch (e) { /* 这一份没有 */ } } } catch (e) { /* 没装 */ }
    return best;
  }
  async function handle(req, res, url, { json, readBody }) {
    if (req.method === 'GET') {
      const key = await dsKey();
      return json(res, { codex: !!codexExe(), deepseek: { 填了: !!key, 尾号: key ? key.slice(-4) : '', 时间: str(((await readConf()).DeepSeek || {}).填的时间) } });
    }
    if (req.method === 'POST' && url.searchParams.has('test')) {
      const key = await dsKey();
      if (!key) throw fail('还没填 DeepSeek 的 key');
      return json(res, await balance(key));
    }
    if (req.method === 'POST') {
      let b;
      try { b = JSON.parse((await readBody(req, 1e4)).toString('utf8')); } catch (e) { throw fail('请求读不了'); }
      const key = str(b && b.key).trim();
      if (!/^sk-[A-Za-z0-9]{16,}$/.test(key)) throw fail('key 的样子不对：DeepSeek 的 key 是 sk- 开头的一串字母数字');
      const bal = await balance(key);
      const c = await readConf();
      c.说明 = '流水线内置 AI 的设置（这台电脑自己的，不进仓库）：对剧本先用本机 Codex 命令行，Codex 没对成换 DeepSeek，用这个 key';
      c.DeepSeek = { key, 填的时间: nowText() };
      await writeFile(CONF, JSON.stringify(c, null, 2) + '\n');
      log('内置 AI：DeepSeek 的 key 换了（尾号 ' + key.slice(-4) + '）');
      return json(res, { ok: true, 尾号: key.slice(-4), ...bal });
    }
    if (req.method === 'DELETE') {
      const c = await readConf();
      delete c.DeepSeek;
      await writeFile(CONF, JSON.stringify(c, null, 2) + '\n');
      return json(res, { ok: true });
    }
    throw fail('不支持');
  }

  /* ---------- 材料：剧本（一段一行，前面标行号）、提示词、审片批注 ---------- */
  const WHERE = { head: '段头', body: '正文', notes: '备注' };
  /* 剧本拆成一段一段：和剧本页批注认的是同一套（公用/核心.js 读 Word、分段头正文备注；同样的字出现几次记第几处） */
  async function scriptUnits(name, seg) {
    const p = scriptPath(name, seg);
    if (!(await exists(p))) throw fail('第' + seg + '段还没有剧本');
    const doc = (Core.parseScripts(await Core.readDocx(await fsp.readFile(p)), seg).segs || [])[0];
    if (!doc) throw fail('第' + seg + '段的剧本读不出来');
    const whereOf = new Map();
    for (const sec of doc.sections || []) for (const u of Core.units(sec)) whereOf.set(u.k, WHERE[sec.key] || '正文');
    const seen = new Map();
    const all = Core.units(doc).map(u => { const n = (seen.get(u.t) || 0) + 1; seen.set(u.t, n); return { t: u.t, n, where: whereOf.get(u.k) || '正文' }; });
    const lines = all.filter(u => u.where !== '备注' && u.t.trim());   // 备注不让 AI 批
    return { mtime: Math.floor((await fsp.stat(p)).mtimeMs), lines };
  }
  const notesRel = seg => ['定稿的剧本', segDir(seg), segDir(seg) + '_剧本_批注.md'];
  const ledgerRel = seg => ['定稿的剧本', segDir(seg), segDir(seg) + '_对剧本.json'];
  async function readText(p) { return unbom(Core.decodeText(await fsp.readFile(p)).text).replace(/\r\n/g, '\n').trim(); }
  async function readLedger(name, seg) {
    try { const j = JSON.parse(unbom(await fsp.readFile(pj(name, ...ledgerRel(seg)), 'utf8'))); return Array.isArray(j.记录) ? j.记录 : []; } catch (e) { return []; }
  }
  const stemOf = f => path.basename(str(f)).replace(/\.[^.]+$/, '');
  const vpLabel = n => (Core.vpLabel ? Core.vpLabel(n) : stemOf(n));

  /* 开任务时备材料（create 里先调）：认不出、没东西可对、上回对过一样的，j.跳过 写为什么，这一回不开 */
  async function prep(j, kind) {
    const v = str(j.视频).trim(), n = str(j.名).trim();
    if (kind === '定稿') {
      if (!Core.RE_VP.test(n) || !Core.nameOk(n)) throw fail('不认识这条提示词：' + n);
      const p = pj(j.项目, '提示词', segDir(j.段), n);
      if (!(await exists(p))) throw fail('提示词不在了：' + n);
      j.材料 = await readText(p);
    } else {
      if (!/\.mp4$/i.test(v) || !Core.nameOk(v)) throw fail('不认识这条样片：' + v);
      const p = pj(j.项目, '成片', segDir(j.段), stemOf(v) + '_批注.md');
      if (!(await exists(p))) { j.跳过 = '这条样片还没写批注'; return; }
      j.材料 = (await readText(p)).split('\n').filter(l => !/^(结束)?截图：/.test(l)).join('\n');   // 截图路径对 AI 没用
      if (n && Core.RE_VP.test(n) && Core.nameOk(n)) { const pp = pj(j.项目, '提示词', segDir(j.段), n); if (await exists(pp)) j.提示词原文 = await readText(pp); }
    }
    const sc = await scriptUnits(j.项目, j.段);
    j.剧本 = sc;
    j.依据 = sha(kind + '\n' + n + '\n' + v + '\n' + j.材料 + '\n' + sc.mtime);
    const was = (await readLedger(j.项目, j.段)).find(r => r.依据 === j.依据);
    if (was) j.跳过 = '上回（' + str(was.时间).slice(5, 16) + '）对过一样的，剧本也没动，不再对：' + str(was.结果);
  }

  const RULES = {
    定稿: ['2. 这条片子已经定稿，以片子为准：剧本写的和提示词拍的不一样，就让剧本改成提示词拍的样子。提示词里写的是怎么拍（参考图、镜头、声音），你只看它拍出来的戏。',
      '3. 提示词只拍了剧本的一部分：只比它拍到的那几场戏，剧本里它没拍到的不管。'],
    审片: ['2. 审片批注是人看片时写的意见。一条一条分：是剧本本身的毛病（剧本就是这么写的、人不要；人要的戏剧本里没有，或者和剧本冲突），才写剧本批注；提示词没写好、模型没演好、长相道具画错、画面声音质量这类，剧本不用改，放进「不归剧本」。',
      '3. 附的提示词只是帮你看懂这条样片拍的是哪几场戏，不用对它。'],
  };
  const FORMAT = '{"判断": "对得上 或 要改剧本", "说明": "一两句话", "批注": [{"行号": 3, "批注": "……", "依据": "……"}], "不归剧本": [{"依据": "……", "为什么": "……"}]}';
  function book(j, kind) {
    const src = kind === '定稿' ? '这一段有一条样片定稿了，下面是它当初照着出的那一版视频提示词' : '人审一条样片时写了批注，下面是批注原文';
    return ['# 任务：对一对剧本（只判断、写批注，不改剧本）', '',
      '今天 ' + today() + '。这是一个 AI 短视频项目。第' + j.段 + '段的剧本已经定稿；' + src + '。请判断剧本要不要跟着改；要改的，替人写剧本批注。人看过批注，再交给 AI 照批注改剧本。',
      '材料都在下面，不用读文件、不用跑命令。', '', '## 要求',
      '1. 只认这几种对不上：谁在场、谁做什么、先后、台词、结果、在哪儿。镜头、景别、运镜、光线、音效、动作细节、长相服装这些剧本本来不写的，不算对不上，也不往剧本里搬。',
      ...RULES[kind],
      '4. 批注写在剧本的哪一段：照下面剧本前面的行号（【3】）。一段只写一条，同一段几处要改就并成一条。要加剧本里没有的戏，写在它前面那一段，批注里说「这一段后面加：……」。',
      '5. 批注用大白话，一两句，直接说改成什么样（像人写的：「不拿电话，直接喊一句」），不写「建议」「可以考虑」。「依据」只写照哪一条，十个字以内（像「' + (kind === '定稿' ? '提示词镜头2' : '审片批注第2条') + '」）。',
      '6. 拿不准是不是剧本的毛病，就不写批注，放进「不归剧本」，为什么写「拿不准：……」。',
      '7. 先判断：一条批注都不用写，「判断」就写「对得上」。', '',
      '## 回复格式：只回一段 JSON，像这样', FORMAT, '',
      '## 剧本（第' + j.段 + '段；每段前面是行号）', j.剧本.lines.map((u, i) => '【' + (i + 1) + '】' + u.t).join('\n'), '',
      kind === '定稿' ? '## 定稿的提示词（' + j.名 + '，样片 ' + j.视频 + '）' : '## 审片批注（样片 ' + j.视频 + '）', j.材料,
      ...(kind === '审片' && j.提示词原文 ? ['', '## 这条样片照的提示词（' + j.名 + '，只帮你看懂拍的是什么）', j.提示词原文] : []),
    ].join('\n');
  }
  const SCHEMA = {
    type: 'object', additionalProperties: false, required: ['判断', '说明', '批注', '不归剧本'],
    properties: {
      判断: { type: 'string', enum: ['对得上', '要改剧本'] }, 说明: { type: 'string' },
      批注: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['行号', '批注', '依据'], properties: { 行号: { type: 'integer' }, 批注: { type: 'string' }, 依据: { type: 'string' } } } },
      不归剧本: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['依据', '为什么'], properties: { 依据: { type: 'string' }, 为什么: { type: 'string' } } } },
    },
  };
  function parseReply(text) {
    const t = str(text), a = t.indexOf('{'), z = t.lastIndexOf('}');
    if (a < 0 || z <= a) throw fail('没按要的格式回（要一段 JSON）');
    let o;
    try { o = JSON.parse(t.slice(a, z + 1)); } catch (e) { throw fail('回的 JSON 读不了：' + e.message); }
    if (!o || !['对得上', '要改剧本'].includes(str(o.判断).trim())) throw fail('没按要的格式回（「判断」要写 对得上 或 要改剧本）');
    return {
      判断: str(o.判断).trim(), 说明: oneLine(o.说明).slice(0, 400),
      批注: (Array.isArray(o.批注) ? o.批注 : []).filter(x => x && typeof x === 'object').map(x => ({ 行号: Math.round(Number(x.行号)), 批注: str(x.批注).trim().slice(0, 600), 依据: oneLine(x.依据).slice(0, 120) })).filter(x => x.批注),
      不归剧本: (Array.isArray(o.不归剧本) ? o.不归剧本 : []).filter(x => x && typeof x === 'object').map(x => ({ 依据: oneLine(x.依据).slice(0, 120), 为什么: oneLine(x.为什么).slice(0, 300) })),
    };
  }

  /* ---------- 两个 AI：先 Codex 命令行，不行换 DeepSeek ---------- */
  async function askCodex(j, text) {
    const exe = codexExe();
    if (!exe) throw fail('这台电脑上找不到 Codex 命令行');
    const schema = path.join(j.dir, '回复格式.json'), out = path.join(j.dir, 'Codex回复.json');
    await writeFile(schema, JSON.stringify(SCHEMA, null, 1) + '\n');
    j.步骤 = '本机 Codex 在对剧本';
    const r = await run(exe, ['exec', '-s', 'read-only', '--ephemeral', '--skip-git-repo-check', '-c', 'model_reasoning_effort="high"', '--output-schema', schema, '-o', out, '--color', 'never', '-'],
      { cwd: d.HOME, input: text, job: j, timeout: CODEX_MS });
    await writeFile(path.join(j.dir, 'Codex输出.txt'), r.out + (r.err ? '\n--- stderr ---\n' + r.err : ''));
    const log2 = r.out + '\n' + r.err, m = /^model:\s*(\S+)/m.exec(log2);
    if (r.code !== 0) throw fail('Codex 退出码 ' + r.code + '：' + (log2.trim().split('\n').filter(Boolean).pop() || '').slice(0, 160));
    const ans = await fsp.readFile(out, 'utf8').catch(() => '');
    if (!ans.trim()) throw fail('Codex 回了空的');
    return { text: ans, who: 'Codex', model: m ? m[1] : '' };
  }
  async function askDeepSeek(j, text) {
    const key = await dsKey();
    if (!key) throw fail('没填 DeepSeek 的 key（流水线顶栏「内置 AI」里填）');
    j.步骤 = 'DeepSeek 在对剧本';
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), DS_MS), stop = setInterval(() => { if (j.停) ctl.abort(); }, 500);
    try {
      for (let k = 1; ; k++) {
        let r;
        try {
          r = await fetchFn(DS_BASE + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: DS_MODEL, stream: false, max_tokens: 32768, thinking: { type: 'enabled' }, reasoning_effort: 'high', response_format: { type: 'json_object' },
              messages: [{ role: 'system', content: '你帮一个 AI 短视频项目核对剧本。只回一段 JSON（json），照用户给的格式，不加别的话。' }, { role: 'user', content: text }] }) });
        } catch (e) { throw fail(j.停 ? '停掉了' : ctl.signal.aborted ? 'DeepSeek 等了 ' + Math.round(DS_MS / 60e3) + ' 分钟还没回' : '连不上 DeepSeek：' + e.message); }
        if (r.status === 401) throw fail('DeepSeek 的 key 不对（401），在顶栏「内置 AI」里重填');
        if (r.status === 402) throw fail('DeepSeek 余额不足（402），要先充值');
        if (!r.ok) throw fail('DeepSeek 出错 ' + r.status + '：' + (await r.text().catch(() => '')).slice(0, 160));
        const o = await r.json().catch(() => ({})), c = ((o.choices || [])[0] || {}).message || {};
        await writeFile(path.join(j.dir, 'DeepSeek回复_' + k + '.json'), JSON.stringify(o, null, 1) + '\n');
        if (str(c.content).trim()) return { text: str(c.content), who: 'DeepSeek', model: str(o.model) };
        if (k >= 2) throw fail('DeepSeek 两回都回了空的');   // 官方说 JSON 模式偶尔回空：再问一回
      }
    } finally { clearTimeout(timer); clearInterval(stop); }
  }
  /* 先 Codex；它没成（找不到、出错、超时、格式不对）换 DeepSeek。两个都没成，报两边各自为什么 */
  async function ask(j, text) {
    let why = '';
    try { const a = await askCodex(j, text); return { ...a, got: parseReply(a.text) }; }
    catch (e) { if (j.停) throw e; why = e.message; log('对剧本：Codex 没成（' + why + '），换 DeepSeek'); }
    j.换过 = 'Codex 没成：' + why;
    try { const b = await askDeepSeek(j, text); return { ...b, got: parseReply(b.text) }; }
    catch (e) { if (j.停) throw e; throw fail('Codex 没成（' + why + '）；DeepSeek 也没成（' + e.message + '）'); }
  }

  /* ---------- 写剧本批注：并进 第N段_剧本_批注.md（照 公用/核心.js 的格式，剧本页读得回来） ---------- */
  async function putNotes(j, items) {
    const rel = notesRel(j.段), p = pj(j.项目, ...rel);
    return withFileLocks([p], async () => {
      let nt = { general: '', items: [] };
      if (await exists(p)) nt = Core.parseNotes(await readText(p));
      const all = j.剧本.lines, cur = nt.items.map(x => ({ ...x }));
      let added = 0;
      for (const x of items) {
        const u = all[x.行号 - 1], have = cur.find(y => y.text === u.t && (y.n || 1) === u.n);
        if (have) { if (have.note.includes(x.批注)) continue; have.note += '\n' + x.note; }
        else cur.push({ where: u.where, text: u.t, n: u.n, note: x.note });
        added++;
      }
      if (!added) return 0;
      const order = new Map(all.map((u, i) => [u.t + '\n' + u.n, i]));   // 照剧本的先后排；对不上的（原文改过了）照旧放在后面
      cur.sort((a, b) => (order.has(a.text + '\n' + (a.n || 1)) ? order.get(a.text + '\n' + (a.n || 1)) : 1e9) - (order.has(b.text + '\n' + (b.n || 1)) ? order.get(b.text + '\n' + (b.n || 1)) : 1e9));
      await writeFile(p, Core.notesToMd({ title: '第' + j.段 + '段 剧本', file: [j.项目, ...rel.slice(0, -1), segDir(j.段) + '_剧本.docx'].join('/'), general: nt.general, items: cur }));
      return added;
    });
  }
  async function putLedger(j, rec) {
    const p = pj(j.项目, ...ledgerRel(j.段));
    await withFileLocks([p], async () => {
      const list = (await readLedger(j.项目, j.段)).concat(rec).slice(-100);
      await writeFile(p, JSON.stringify({ 说明: '对剧本的记录（AI 写，页面只读）：片子定稿、审片写了批注以后，和剧本对一对；对不上的写进剧本批注（剧本没改）。同样的材料、剧本也没动过，就不再对。', 记录: list }, null, 2) + '\n');
    });
  }
  async function check(j, kind) {
    const text = book(j, kind);
    await writeFile(path.join(j.dir, '任务书.md'), text);
    const a = await ask(j, text);
    j.实际模型 = a.who;   // 任务那一行写「内置 AI（Codex）」；具体模型记在对剧本记录里
    j.步骤 = '在写批注';
    const lines = j.剧本.lines, src = kind === '定稿' ? '定稿的样片' : '审片批注';
    const items = a.got.判断 === '对得上' ? [] : a.got.批注.filter(x => x.行号 >= 1 && x.行号 <= lines.length).map(x => ({ ...x, note: x.批注 + '〔AI 照' + src + '写：' + stemOf(j.视频) + (x.依据 ? ' ' + x.依据.replace(/[。，；、\s]+$/, '').slice(0, 30) : '') + '〕' }));
    const added = items.length ? await putNotes(j, items) : 0;   // 判断是对得上：AI 顺手写了批注也不写（先判断再动手）
    const 结果 = added ? '剧本有 ' + added + ' 处要跟着改，写了剧本批注，到剧本页看'
      : a.got.判断 === '对得上' ? '对得上，剧本不用改'
        : items.length ? '要改的这几处，剧本批注里已经写过了，没再写' : 'AI 说要改剧本，可是没指对是哪一段，没写批注（回复留在任务记录里）';
    await putLedger(j, { 时间: nowText(), 事: j.事, 视频: str(j.视频), 提示词: str(j.名), 依据: j.依据, 谁: a.who, 模型: a.model, 换过: j.换过 || '', 判断: a.got.判断, 说明: a.got.说明,
      写了: added ? items.map(x => ({ 原文: lines[x.行号 - 1].t, 批注: x.批注, 依据: x.依据 })) : [], 不归剧本: a.got.不归剧本, 结果, 记录: path.relative(d.ROOT, j.dir).split(path.sep).join('/') });
    return { 结果: 结果 + '（' + a.who + (j.换过 ? '，' + j.换过 : '') + '）', 产出: added ? [notesRel(j.段).join('/')] : [] };
  }

  const KINDS = {
    定稿对剧本: { title: j => '对剧本 · 第' + j.段 + '段 · 定稿的' + vpLabel(j.名), need: ['段'], builtin: true, local: true, key: j => str(j.名), prep: j => prep(j, '定稿'), run: j => check(j, '定稿') },
    审片对剧本: { title: j => '对剧本 · 第' + j.段 + '段 · ' + stemOf(j.视频) + ' 的审片批注', need: ['段'], builtin: true, local: true, key: j => str(j.视频), prep: j => prep(j, '审片'), run: j => check(j, '审片') },
  };
  return { KINDS, handle, parseReply, codexExe, CONF };
};
