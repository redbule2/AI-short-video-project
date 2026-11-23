'use strict';
/* ============================================================
   流水线自己出片（2026-11-21 他要的：原来交给 Codex 一步一步做，一条三到五分钟，大半在「想」；
   这些固定的步骤改成流水线自己跑，出了错才停下告诉他）。
   照「出片任务书」同一回排的 出片计划.json 做（jobs.js 的 出片任务书 写、出片 交过来），
   即梦命令和 dreamina-video-fastlane 快线、Codex 以往的日志是同一套：
     一  本机先核：成片里没有同名的、提示词和素材和排任务书时一样（SHA-256）
     二  素材：画布上有同名节点的直接引用，还叫老名字的先改名，换过新文件的旧版改成「名字__时间」；
         没有的才传（resource upload 加同一个编号，再 node create 成独立素材节点）
     三  视频节点：没有就新建草稿，同名的草稿就在它上面接着做；存好回读，提示词一字不差、素材先后、参数都要对
     四  报价，不超过上限（没填就照报价）才确认积分，提交一次（提交编号先记下，回话丢了用原编号只读查，不重提）
     五  等出完（等待超时不算失败，接着等），下载到 成片/第N段，核大小和 SHA-256
   每一步记进这一回任务文件夹：出片进度.json（编号、到哪一步；不记积分凭证）、出片记录.log（跑过的命令，凭证和提示词全文不记）。
   服务重开后照 出片进度.json 接着做；提交过的只等、只下载，不再花积分。做完在 资产/生成记录.json 记一条（和 Codex 记的同一个样子）。
   出错就停：说清楚花没花积分、要人做什么。不改提示词、不换素材、不重试花钱的那一步。
   测试：通用工具/测试/流水线出片_测试.cjs（假的即梦命令行）；批准出片怎么交到这里：出片任务书_任务测试.js
   ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

module.exports = function makeJmVideo({ JM, run, HOME, log = () => {}, canvas, withFileLocks = async (paths, fn) => fn(), now = () => Date.now(), WAIT_MAX = 40 * 60e3, PAUSE = 5000, TICK = 1000 }) {
  /* 页面上的叫法 → 即梦命令行的模型名（2026-11-21 照 model list --type video） */
  const MODELS = { 'Seedance 2.5 样片': 'seedance_2.5_draft', 'Seedance 2.5': 'seedance_2.5', 'Seedance 2.0 mini': 'seedance_2.0_mini', 'Seedance 2.0 VIP': 'seedance_2.0_vip' };
  const KIND = { 图片: 'image', 视频: 'video', 音频: 'audio' };
  const B32 = '0123456789abcdefghjkmnpqrstvwxyz';   // 节点编号：node_ 加 10 个小写 Crockford Base32（即梦命令行自己核这个格式）
  const fail = m => Object.assign(new Error(m), { plain: true });
  const unbom = s => { s = String(s); return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; };   // 去掉开头的 BOM
  const sha = buf => crypto.createHash('sha256').update(buf).digest('hex');
  const fileSha = f => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('error', no).on('data', c => h.update(c)).on('end', () => ok(h.digest('hex'))); });
  const exists = p => fsp.stat(p).then(() => true, () => false);
  const uuid = () => crypto.randomUUID();
  const newNode = () => 'node_' + Array.from(crypto.randomBytes(10), b => B32[b & 31]).join('');
  const two = n => String(n).padStart(2, '0');
  const stamp = (d = new Date(now())) => d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  const mins = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '钟') : s + ' 秒'; };   // 40 分钟、2 分 13 秒、9 秒
  const kindOf = ref => KIND[(/^@(图片|视频|音频)\d+$/.exec(String(ref)) || [])[1]] || '';
  const isDraft = n => !!n && String(n.status) === 'empty' && !(n.resources || []).length;
  const SUBMITTED = /^(accepted|pending|running|succeeded|success|failed|canceled|cancelled)$/i;
  async function readJson(f) { try { return JSON.parse(unbom(await fsp.readFile(f, 'utf8'))); } catch (e) { return null; } }
  async function writeText(f, text) {   // 先写临时文件再换上：写到一半断了不留半截
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const t = f + '.antou-tmp';
    await fsp.writeFile(t, text);
    await fsp.rename(t, f);
  }
  const writeJson = (f, o) => writeText(f, JSON.stringify(o, null, 1) + '\n');
  /* 即梦回的错：英文摘要＋已知原因，带请求号（反馈问题时用） */
  const why = r => {
    if (!r) return '没有回话';
    const e = r.error || {}, d = (e.diagnostics || []).map(x => x && x.detail).filter(Boolean).join('；');
    return ([e.message || (r.code != null ? '退出码 ' + r.code : ''), d].filter(Boolean).join('：') || '说不清').slice(0, 300) + (r.req ? '（请求号 ' + r.req + '）' : '');
  };
  const whyRes = d => {   // 生成没成：素材上、提交上记的原因
    const x = (d.resources || []).find(v => v && (v.message || v.serviceCode)) || {}, se = d.submissionError || {};
    return [x.message, x.serviceCode && '代码 ' + x.serviceCode, se.message, ...((x.diagnostics || []).concat(se.diagnostics || []).map(v => v && v.detail))].filter(Boolean).join('；').slice(0, 300) || '即梦没说原因';
  };
  /* 记命令：积分凭证不记，提示词只记多少字 */
  const scrub = args => 'dreamina-canvas ' + args.map((a, i) => args[i - 1] === '--credit-token' ? '<略>' : args[i - 1] === '--prompt' ? '<提示词 ' + a.length + ' 字>' : /\s/.test(a) ? JSON.stringify(a) : a).join(' ');

  /* 模型收不收：照即梦现在的 model list 核分辨率、时长、提示词长短、素材多少（读不到就不核，存草稿时服务端还会核） */
  function specGap(list, P, M, text, n) {
    const m = (Array.isArray(list) ? list : []).find(x => x && x.model === M);
    if (!m) return '即梦现在没有「' + P.模型 + '」这个模型';
    const mode = n.total ? 'm2v' : 't2v', md = (m.modes || []).find(x => x && (x.name || x.mode) === mode);
    if (!md) return P.模型 + ' 不能' + (n.total ? '挂素材' : '纯文字') + '出片';
    const fl = k => (md.flags || []).find(x => x && x.flag === k) || {};
    const rs = fl('--resolution').values;
    if (Array.isArray(rs) && !rs.some(v => String(v).toLowerCase() === String(P.清晰度).toLowerCase())) return P.模型 + ' 只出 ' + rs.join('、');
    const du = fl('--duration');
    if (du.min != null && (P.秒数 < du.min || P.秒数 > du.max)) return P.模型 + ' 只能出 ' + du.min + '～' + du.max + ' 秒';
    const pl = fl('--prompt');
    if (pl.maxLength && text.length > pl.maxLength) return '提示词 ' + text.length + ' 字，' + P.模型 + ' 最多收 ' + pl.maxLength + ' 字';
    const rf = md.references || {}, say = { image: '图', video: '视频', audio: '音频' };
    for (const t of rf.types || []) if (t && t.max != null && (n[t.mediaType] || 0) > t.max) return P.模型 + ' 最多挂 ' + t.max + ' 个' + (say[t.mediaType] || t.mediaType);
    if (rf.max != null && n.total > rf.max) return P.模型 + ' 最多挂 ' + rf.max + ' 个素材';
    return '';
  }
  /* 存上去的视频节点和要的一样不一样：一样回空 */
  function genGap(n, w) {
    if (!n) return '画布上没有这个节点';
    const g = n.generation || {}, refs = g.references || [], up = new Set(n.upstreamNodeIds || []);
    if (n.type !== 'video') return '它不是视频节点';
    if (String(n.title || '').trim() !== w.title) return '名字不对';
    const norm = s => String(s == null ? '' : s).replace(/\r\n/g, '\n').replace(/\s+$/, '');   // 换行写法、末尾空白不算（即梦存的可能不一样，对模型没分别）
    if (norm(g.prompt) !== norm(w.prompt)) return '提示词不是一字不差（画布上 ' + String(g.prompt || '').length + ' 字，稿子 ' + w.prompt.length + ' 字）';
    if (refs.length !== w.refs.length || refs.some((r, i) => !r || r.kind !== 'node' || r.id !== w.refs[i])) return '挂的素材或先后不对';
    if (w.refs.some(id => !up.has(id))) return '素材没连上线';
    if (g.mode !== w.mode) return '出片方式不对';
    if (String(g.model || '').replace(/_/g, '') !== w.model.replace(/_/g, '')) return '模型不对';
    if (String(g.ratio) !== w.ratio) return '画面比例不对';
    if (String(g.resolution || '').toLowerCase() !== w.resolution.toLowerCase()) return '清晰度不对';
    if (Number(g.durationSeconds) !== w.secs) return '时长不对';
    if (Number(g.outputCount == null ? 1 : g.outputCount) !== 1) return '条数不对';
    return '';
  }

  /* j：jobs.js 的任务（步骤、停、醒、child 照它的规矩用）；plan：出片计划（服务重开后接着做的传 null，照 出片进度.json 里存的那份）；dir：这一回的任务文件夹 */
  async function go(j, plan, dir) {
    const stFile = path.join(dir, '出片进度.json'), logFile = path.join(dir, '出片记录.log');
    let st = await readJson(stFile);
    if (!st || !st.计划) {
      if (!plan) throw fail('服务重开前这一条还没开始出：没出片、没花积分。再点一次「批准出片」');
      st = { 说明: '流水线自己出片的进度（jm-video.js 写；服务重开后照它接着做）。不记积分凭证', 计划: plan, 开始: stamp(), 素材: {}, 传: {}, 改名: {} };
    }
    const P = st.计划, base = path.join(HOME, P.项目), abs = rel => path.join(base, ...String(rel).split('/'));
    const save = () => writeJson(stFile, st);
    const note = line => fsp.appendFile(logFile, '[' + stamp() + '] ' + line + '\n').catch(() => {});
    const cid = String(P.画布号 || '').toLowerCase(), profile = String(P.登录位 || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cid)) throw fail('出片设置里的画布网址认不出是哪张画布：没出片、没花积分');
    if (!/^[A-Za-z0-9_-]{0,40}$/.test(profile)) throw fail('出片设置里的登录位名字不对：没出片、没花积分');
    const step = t => { j.步骤 = t; note('== ' + t); };
    const nap = ms => new Promise(r => { j.醒 = r; setTimeout(r, ms); });   // 点了停就叫醒（jobs.js 的 cancel）
    const left = () => st.已提交 ? '已经提交了，即梦那边照样在出（节点 ' + st.节点.id + '）' : '还没提交，没花积分';
    const halt = () => { if (j.停) throw fail('停掉了：' + left() + (st.已提交 ? '。出好以后再点「批准出片」会直接下载，不再扣积分' : '')); };
    async function cli(args, { timeout = 90e3, job } = {}) {
      const full = ['--non-interactive', ...(profile ? ['--profile', profile] : []), ...args, '--format', 'json'];
      let r;
      try { r = await run(JM, full, { timeout, job }); } catch (e) { r = { code: -1, out: '', err: e.message }; }
      let o = null;
      try { o = JSON.parse(r.out); } catch (e) { /* 不是 JSON */ }
      const res = { code: r.code, ok: r.code === 0 && !!o && o.ok !== false, data: (o && o.data) || null, partial: (o && o.partialData) || null,
        error: (o && o.error) || (r.code === 0 && o ? null : { message: String(r.err || r.out || '').trim().slice(0, 300) || '即梦命令行没回话' }), req: (o && o.meta && o.meta.requestId) || '' };
      await note(scrub(args) + ' → ' + (res.ok ? '好' : '没成：' + why(res)) + (res.ok && res.req ? '（' + res.req + '）' : ''));
      return res;
    }
    async function show(ids) {   // 节点编号 → 节点（画布上没有的不在里面）
      const m = new Map();
      for (let i = 0; i < ids.length; i += 20) {
        const r = await cli(['node', 'show', '--project-id', cid, ...ids.slice(i, i + 20).flatMap(id => ['--node-id', id])]);
        if (!r.ok) throw fail('读画布上的节点没读成：' + why(r) + '。' + left());
        for (const x of (r.data && r.data.nodes) || []) if (x && x.result === 'FOUND' && x.node && x.node.nodeId) m.set(x.node.nodeId, x.node);
      }
      return m;
    }
    async function findExact(t, type) {   // 按名字查（也会查到提示词里带这个词的），只留名字一字不差、类型对的
      const got = [];
      for (let off = 0; off <= 1000;) {
        const r = await cli(['node', 'find', '--project-id', cid, '--name', t, '--type', type, '--limit', '50', '--offset', String(off)], { timeout: 60e3 });
        if (!r.ok) throw fail('查画布上的「' + t + '」没查成：' + why(r) + '。没出片、没花积分，过一会儿再点「批准出片」');
        const page = (r.data && r.data.items) || [];
        page.filter(n => n && n.nodeId && n.type === type && String(n.title || '').trim() === t).forEach(n => got.push(n));
        if (!(r.data && r.data.hasMore) || !page.length) break;
        off += page.length;
      }
      return got;
    }
    async function rename(id, type, to, from) {
      const k = id + '→' + to;
      if (!st.改名[k]) { st.改名[k] = uuid(); await save(); }
      step('在给画布上的「' + from + '」改名');
      const r = await cli(['node', 'edit', type, '--project-id', cid, '--node-id', id, '--update-id', st.改名[k], '--title', to]);
      if (r.ok) return;
      const n = (await show([id])).get(id);   // 命令报错也可能改成了（11-16 实测过）：回读看名字
      if (n && String(n.title || '').trim() === to) return;
      throw fail('画布上「' + from + '」（' + id + '）改名成「' + to + '」没改成：' + why(r) + '。没出片、没花积分，过一会儿再点「批准出片」');
    }
    async function resOf(rid, type, ms) {   // 素材登记好了没有：success 回素材，失败、查不到回 null；还在登记的等一会儿
      for (const t0 = now(); ;) {
        const r = await cli(['resource', 'get', rid, '--project-id', cid]);
        const d = r.ok && r.data;
        if (d && d.status === 'success') return d.type === type ? d : null;
        if (!d || !/running|pending/i.test(String(d.status)) || now() - t0 >= ms) return null;
        await nap(3 * TICK);
        halt();
      }
    }
    async function upload(r, type, nm) {
      if (!st.传[r.ref]) { st.传[r.ref] = { 素材: uuid(), 节点: newNode(), 更新: uuid(), 提交: uuid() }; await save(); }   // 编号先记下：断了用同一个编号接着传，不重复
      const u = st.传[r.ref], file = abs(r.path);
      step('在传素材：' + r.name);
      const up = () => cli(['resource', 'upload', '--project-id', cid, '--resource-id', u.素材, '--file', file, '--type', type, '--import-kind', 'local_upload'], { timeout: 10 * 60e3, job: j });
      let res = await up(), d = await resOf(u.素材, type, res.ok ? 60e3 : 10e3);
      if (!d) {   // 回了状态不明、查不到：同一个编号再传一回（传素材不花积分；编号就是防重复的钥匙。11-16 走代理超时，直连同号再传就成了）
        halt();
        res = await up();
        d = await resOf(u.素材, type, 60e3);
      }
      if (!d) throw fail('素材「' + r.name + '」没传上：' + why(res) + '。没出片、没花积分，过一会儿再点「批准出片」');
      halt();
      const mk = () => cli(['node', 'create', type, '--project-id', cid, '--node-id', u.节点, '--update-id', u.更新, '--submit-id', u.提交, '--title', nm, '--resource-id', u.素材, '--import-kind', 'local_upload']);
      let nc = await mk(), n = nc.ok ? null : (await show([u.节点])).get(u.节点);
      if (!nc.ok && !n) { await nap(PAUSE); halt(); nc = await mk(); }
      n = (await show([u.节点])).get(u.节点);
      const ok = n && n.type === type && String(n.title || '').trim() === nm && (n.resources || []).some(x => x && x.resourceId === u.素材 && x.status === 'success');
      if (!ok) throw fail('素材「' + r.name + '」传上去了，画布上的节点没建好：' + why(nc) + '。没出片、没花积分，过一会儿再点「批准出片」');
      return u.节点;
    }
    const late = (t0, id) => { if (now() - t0 > WAIT_MAX) throw fail('等了 ' + mins(WAIT_MAX) + '还没出完：即梦那边照样在出（节点 ' + id + '）。过一会儿再点「批准出片」，出好了会直接下载，不再扣积分'); };
    async function waitOp(sid, t0) {   // 等出完：一回最多等一分钟，等待超时（退出码 20）接着等，不重提。先查一回再看过没过时（服务停了很久再接着的，片子可能早好了）
      for (let errs = 0; ;) {
        halt();
        step('即梦在出片，等了 ' + mins(now() - t0));
        j.等即梦 = true;
        const r = await cli(['operation', 'wait', sid, '--project-id', cid, '--timeout', '60s', '--interval', '10s'], { timeout: 150e3, job: j });
        j.等即梦 = false;
        halt();
        const d = r.data || r.partial || {}, s = String(d.state || '').toLowerCase();
        if (r.ok && /^(succeeded|success)$/.test(s)) {
          const x = (d.resources || []).find(v => v && v.resourceId && /^(succeeded|success)$/i.test(String(v.state || v.status || 'succeeded')));
          if (x) return x.resourceId;
          throw fail('即梦说出好了，可是没给片子的编号：去画布上看节点 ' + st.节点.id);
        }
        if (/^(failed|canceled|cancelled|rejected)$/.test(s)) throw fail('即梦没出成：' + whyRes(d) + '（节点 ' + st.节点.id + '）。提示词、素材都没改；积分一般会退回，以即梦账单为准');
        if (r.code === 20 || (r.error && r.error.code === 40011) || /^(accepted|pending|running)$/.test(s)) errs = 0;
        else if (++errs >= 5) throw fail('一直查不到出片进度：' + why(r) + '。即梦那边可能还在出（节点 ' + st.节点.id + '）：过一会儿再点「批准出片」，出好了会直接下载，不再扣积分');
        late(t0, st.节点.id);
        j.等即梦 = true; await nap(errs ? PAUSE : TICK); j.等即梦 = false;
      }
    }
    async function waitNode(id, t0) {   // 画布上早就提交过的（不是这一回提交的，没有提交编号）：看节点上的片子
      for (;;) {
        halt();
        step('画布上这一条早就提交过了，在等它出完（等了 ' + mins(now() - t0) + '）');
        const n = (await show([id])).get(id), rs = (n && n.resources) || [];
        const ok = rs.find(v => v && v.type === 'video' && v.status === 'success');
        if (ok) return ok.resourceId;
        if (!rs.length || rs.every(v => v && /failed|canceled/i.test(String(v.status)))) throw fail('画布上这一条（节点 ' + id + '）没在出了，也没有出好的片子：再点一次「批准出片」');
        late(t0, id);
        j.等即梦 = true; await nap(10 * TICK); j.等即梦 = false;
      }
    }
    const opDone = async sid => {   // 用原编号只读查：服务端收没收这次提交
      const s = await cli(['operation', 'status', sid, '--project-id', cid]);
      const d = (s.ok && s.data) || {};
      return SUBMITTED.test(String(d.state || '')) || /^(completed|in_progress)$/i.test(String((d.submission || {}).state || ''));
    };

    await save();
    const out = abs(P.存到), clip = path.basename(out);
    const want = { title: P.节点名, prompt: '', mode: P.素材.length ? 'm2v' : 't2v', model: MODELS[P.模型] || '', ratio: '16:9', resolution: String(P.清晰度 || ''), secs: Number(P.秒数), refs: [] };
    const used = { 原有: 0, 改名: 0, 新传: 0 };
    if (st.提交 && !st.已提交 && await opDone(st.提交)) { st.已提交 = true; await save(); }   // 服务重开前提交到一半：先用原编号查，收了就只等
    if (!st.已提交 && !st.片) {
      /* 一、本机先核（不连即梦） */
      step('在核对提示词和素材');
      if (await exists(out)) throw fail('成片里已经有 ' + clip + ' 了：没出片、没花积分。要再出一条，刷新页面再点「批准出片」，会排成下一个名字');
      const pbuf = await fsp.readFile(abs(P.提示词.路径)).catch(() => null);
      if (!pbuf) throw fail('提示词文件不在了（' + P.提示词.路径 + '）：没出片、没花积分');
      if (sha(pbuf) !== P.提示词.sha256) throw fail('提示词在排好任务书以后又改过：没出片、没花积分。改完了再点一次「批准出片」');
      want.prompt = unbom(pbuf.toString('utf8'));
      if (want.prompt.includes('{{')) throw fail('提示词里有「{{」，即梦会当成挂素材的记号：改掉再点「批准出片」。没出片、没花积分');
      if (!want.model) throw fail('流水线还不会自己出「' + P.模型 + '」：没出片、没花积分');
      if (!(want.secs >= 4 && want.secs <= 30) || !/^(480p|720p|1080p)$/i.test(want.resolution)) throw fail('时长或清晰度不对：没出片、没花积分');
      const n = { total: P.素材.length };
      for (const r of P.素材) {
        const k = kindOf(r.ref);
        if (!k) throw fail('认不出素材编号 ' + r.ref + '：没出片、没花积分');
        n[k] = (n[k] || 0) + 1;
        const b = await fsp.readFile(abs(r.path)).catch(() => null);
        if (!b) throw fail('素材「' + r.name + '」的文件不在了（' + r.path + '）：没出片、没花积分');
        if (sha(b) !== r.sha256) throw fail('素材「' + r.name + '」在排好任务书以后又换过：没出片、没花积分。再点一次「批准出片」');
      }
      halt();
      /* 二、素材：几个名字一起查（只读），改名、传图一样一样来。同一张画布一次只一条在认素材：两条一起查都没有、一起传，会传出两个同名节点 */
      const specP = cli(['model', 'list', '--type', 'video'], { timeout: 60e3 });
      j.步骤 = '在等同一张画布上的另一条出片认完素材';
      await withFileLocks([path.join(base, '资产', '.即梦画布素材_' + cid)], async () => {
        step('在认画布上的素材');
        const todo = P.素材.filter(r => !st.素材[r.ref]), asks = todo.flatMap(r => [r.节点名, ...(r.老名 || [])].map(t => ({ r, t })));
        const hits = await canvas.each(asks, 8, a => findExact(a.t, kindOf(a.r.ref)));
        const spec = await specP, gap = spec.ok ? specGap(spec.data && (spec.data.items || spec.data.models), P, want.model, want.prompt, n) : '';
        if (gap) throw fail('即梦不收这样出：' + gap + '。没出片、没花积分');
        for (const r of todo) {
          halt();
          const type = kindOf(r.ref), nm = r.节点名, by = new Map();
          asks.forEach((a, i) => { if (a.r === r) by.set(a.t, hits[i]); });
          const cur = by.get(nm) || [], olds = (r.老名 || []).flatMap(t => (by.get(t) || []).map(x => ({ ...x, 老名: t })));
          let use = '';
          if (r.换) {   // 这个文件换过新的：画布上同名的各是哪一版，排任务书时认好了（没认成的这里再认一回）
            let v = r.节点;
            if (!Array.isArray(v)) {
              step('在认画布上「' + nm + '」是哪一版');
              v = await canvas.versions({ name: P.项目, canvas: cid, profile, items: [{ title: nm, titles: [nm, ...(r.老名 || [])], cur: abs(r.path), sha: r.sha256, olds: r.换 }] }).then(x => x[0])
                .catch(e => { throw fail('画布上「' + nm + '」是哪一版没认出来：' + e.message + '。没出片、没花积分'); });
            }
            const known = new Set(v.map(x => x.node)), extra = [...cur, ...olds].filter(x => !known.has(x.nodeId));
            if (extra.length) throw fail('画布上又多出了叫「' + nm + '」的节点（' + extra.map(x => x.nodeId).join('、') + '），排任务书时还没有：没出片、没花积分。到画布上看一眼，再点「批准出片」');
            const odd = v.filter(x => !x.版);
            if (odd.length) throw fail('画布上叫「' + nm + '」的节点有认不出是哪一版的（' + odd.map(x => x.node).join('、') + '）：没出片、没花积分。到画布上看一眼，留下对的那个，再点「批准出片」');
            const curs = v.filter(x => x.版 === 'cur');
            if (curs.length > 1) throw fail('画布上有 ' + curs.length + ' 个「' + nm + '」都是现在这一版（' + curs.map(x => x.node).join('、') + '），不知道该用哪个：没出片、没花积分。到画布上只留一个，再点「批准出片」');
            for (const x of v.filter(x => x.版 !== 'cur')) { await rename(x.node, type, nm + '__' + x.版, x.名 || nm); used.改名++; }   // 旧版照 AGENTS.md 改成那一版的名字，只改名、不删
            const c0 = curs[0];
            if (c0) { if (c0.名 && c0.名 !== nm) { await rename(c0.node, type, nm, c0.名); used.改名++; } use = c0.node; used.原有++; }
          } else {
            const okOf = x => { if (String(x.status) !== 'success') throw fail('画布上的「' + x.title + '」（' + x.nodeId + '）没有能用的素材：没出片、没花积分。到画布上看一眼，再点「批准出片」'); return x.nodeId; };
            if (cur.length > 1 || (!cur.length && olds.length > 1)) throw fail('画布上有 ' + (cur.length || olds.length) + ' 个叫「' + (cur.length ? nm : olds[0].老名) + '」的节点，不知道该用哪个：没出片、没花积分。到画布上只留一个，再点「批准出片」');
            if (cur.length) { use = okOf(cur[0]); used.原有++; }
            else if (olds.length) { use = okOf(olds[0]); await rename(use, type, nm, olds[0].老名); used.改名++; used.原有++; }
          }
          if (!use) { use = await upload(r, type, nm); used.新传++; }
          st.素材[r.ref] = use;
          await save();
        }
      });
      want.refs = P.素材.map(r => st.素材[r.ref]);
      /* 三、视频节点：同名的草稿接着用，同名提交过的看是不是同一条 */
      halt();
      if (!st.节点) {
        step('在查画布上有没有同名的视频节点');
        const same = await findExact(want.title, 'video');
        if (same.length > 1) throw fail('画布上有 ' + same.length + ' 个叫「' + want.title + '」的视频节点：没出片、没花积分。到画布上只留一个，再点「批准出片」');
        st.节点 = same.length ? { id: same[0].nodeId, 更新: uuid(), 原有: true } : { id: newNode(), 更新: uuid() };
        await save();
      }
      let A = (await show([st.节点.id])).get(st.节点.id) || null, again = false;
      if (A && !isDraft(A)) {
        const bad = genGap(A, want);
        if (bad) throw fail('画布上已经有叫「' + want.title + '」的视频节点，提交过，和这回的稿不一样（' + bad + '）：没出片、没花积分。到画布上给它改个名，再点「批准出片」');
        const rs = A.resources || [], good = rs.find(v => v && v.type === 'video' && v.status === 'success');
        if (good) { st.片 = good.resourceId; st.沿用 = '画布上同名的这一条早就出好了，直接下载'; }
        else if (rs.some(v => v && /running|pending/i.test(String(v.status)))) st.等节点 = true;
        else again = true;   // 上回出失败了：照这回的批准在它上面再出一回
        await save();
      }
      if (!st.片 && !st.等节点) {
        if (!again && !(A && isDraft(A) && !genGap(A, want))) {   // 画布上的草稿已经和稿子一样（服务重开前存好的）就不再存
          step('在存视频草稿');
          const gen = ['--mode', want.mode, '--model', want.model, '--ratio', want.ratio, '--resolution', want.resolution, '--duration', String(want.secs), '--count', '1', '--prompt', want.prompt, ...want.refs.flatMap(id => ['--ref', 'node:' + id])];
          const put = (verb, upd) => cli(['node', verb, 'video', '--project-id', cid, '--node-id', st.节点.id, '--update-id', upd, '--title', want.title, ...gen], { timeout: 120e3 });
          let r = await put(A ? 'edit' : 'create', st.节点.更新);
          if (!r.ok) {
            A = (await show([st.节点.id])).get(st.节点.id) || null;
            if (!(A && isDraft(A) && !genGap(A, want))) {   // 回读没存上：歇一下同样的再存一回（11-21 实测：头一回「参数不对」，同样的再存就成了）
              await nap(PAUSE); halt();
              if (A && !st.节点.更新2) { st.节点.更新2 = uuid(); await save(); }
              r = await put(A ? 'edit' : 'create', A ? st.节点.更新2 : st.节点.更新);
              if (!r.ok) throw fail('即梦不收这个视频草稿：' + why(r) + '。没花积分。过一会儿再点「批准出片」；还不行，把这句话告诉 AI');
            }
          }
          A = (await show([st.节点.id])).get(st.节点.id) || null;
          const bad = genGap(A, want) || (isDraft(A) ? '' : '它已经不是草稿了');
          if (bad) throw fail('视频草稿存上去以后回读，和稿子对不上（' + bad + '）：停在草稿（节点 ' + st.节点.id + '），没花积分');
        }
        /* 四、报价 → 确认积分 → 提交一次 */
        halt();
        step('在报价');
        const q = await cli(['node', 'quote', '--project-id', cid, '--node-id', st.节点.id]);
        const total = q.ok && q.data && q.data.totalMaxCredits != null ? Number(q.data.totalMaxCredits) : NaN;
        if (!Number.isFinite(total)) throw fail('即梦这回报不出价：' + why(q) + '。草稿在画布上（节点 ' + st.节点.id + '），没花积分');
        const cap = P.积分上限 > 0 ? Number(P.积分上限) : total;
        if (total > cap) throw fail('报价 ' + total + ' 积分，超过你填的上限 ' + cap + '：停在草稿，没花积分。要出就把上限改大，再点「批准出片」');
        Object.assign(st, { 报价: total, 上限: cap });
        if (!st.提交 || again) st.提交 = uuid();   // 提交编号先记下：回话丢了用它只读查，不重提
        await save();
        halt();
        step('在确认积分、提交（报价 ' + total + ' 积分）');
        const cf = await cli(['node', 'confirm', '--project-id', cid, '--node-id', st.节点.id, '--credit-ceiling', String(cap)]);
        const token = cf.ok && cf.data && cf.data.creditConfirmationToken;   // 只交给这一回提交，不记
        if (!token) throw fail('即梦没批这次的积分（上限 ' + cap + '）：' + why(cf) + '。草稿在画布上，没花积分');
        const rn = await cli(['node', 'run', '--project-id', cid, '--node-id', st.节点.id, '--submit-id', st.提交, '--credit-token', token], { timeout: 120e3 });
        const it = ((rn.data || rn.partial || {}).items || [])[0] || {}, s = String(it.state || '');
        if (/^accepted$/i.test(s)) st.已提交 = true;
        else if (/^rejected$/i.test(s)) throw fail('即梦没收这一条：' + why({ error: it.error || rn.error, req: rn.req }) + '。没扣积分；提示词、素材都没改');
        else if (await opDone(st.提交)) st.已提交 = true;
        else throw fail('提交以后没确认下来即梦收没收：' + why(rn) + '。先别再点，去画布上看节点 ' + st.节点.id + ' 有没有在出；没在出再点「批准出片」');
        st.提交时间 = stamp();
        await save();
      }
    }
    /* 五、等出完 → 下载 */
    if (!st.片) {
      if (!st.等起) { st.等起 = now(); await save(); }
      st.片 = st.已提交 && st.提交 ? await waitOp(st.提交, st.等起) : await waitNode(st.节点.id, st.等起);
      await save();
    }
    if (!st.文件) {
      halt();
      step('出好了，在下载');
      const g = await cli(['resource', 'get', st.片, '--project-id', cid]), gd = (g.ok && g.data) || {};
      if (gd.type !== 'video' || gd.status !== 'success') throw fail('片子的状态不对（' + (gd.status || why(g)) + '）：去画布上看节点 ' + st.节点.id);
      if (await exists(out)) throw fail('片子出好了，可是成片里已经有 ' + clip + ' 了（别处先下好了？）：没下载。片子在画布上（节点 ' + st.节点.id + '）');
      const part = path.join(dir, clip + '.part');
      const dl = async () => { await fsp.rm(part, { force: true }); return cli(['resource', 'download', st.片, '--project-id', cid, '--output', part], { timeout: 10 * 60e3, job: j }); };
      let r = await dl();
      if (!r.ok) { halt(); await nap(PAUSE); r = await dl(); }
      if (!r.ok) throw fail('片子出好了，下载没成：' + why(r) + '。片子在画布上（节点 ' + st.节点.id + '），过一会儿再点「批准出片」会直接下载，不再扣积分');
      const size = (await fsp.stat(part).catch(() => ({ size: 0 }))).size, h = size ? await fileSha(part) : '';
      if (!size || size !== Number(r.data && r.data.size) || h !== String((r.data && r.data.sha256) || '').toLowerCase()) throw fail('下下来的文件和即梦说的对不上（大小或 SHA-256）：没放进成片，下了一半的在 ' + part);
      if (await exists(out)) throw fail('下好了，可是成片里刚有了同名的 ' + clip + '（别处先下好了？）：新下的在 ' + part);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.rename(part, out);
      st.文件 = { 路径: P.存到, 大小: size, sha256: h, 秒: gd.video && gd.video.durationSeconds, 积分: gd.creditsAmount };
      st.结束 = stamp();
      await save();
    }
    /* 六、记进 资产/生成记录.json（和 Codex 记的同一个样子；记不上不算没成） */
    await record(P, st, want).catch(e => log('生成记录没记上：' + e.message));
    const f = st.文件, extra = [used.新传 && '新传了 ' + used.新传 + ' 样素材', used.改名 && '画布上 ' + used.改名 + ' 个节点改了名', st.沿用].filter(Boolean);
    return { 结果: '出好了：' + clip + '（' + (f.秒 ? Math.round(f.秒 * 10) / 10 + ' 秒' : P.秒数 + ' 秒') + (f.积分 != null ? '，扣 ' + f.积分 + ' 积分' : st.报价 != null ? '，报价 ' + st.报价 + ' 积分' : '') + '）' + (extra.length ? '；' + extra.join('，') : ''), 产出: [P.存到] };
  }
  async function record(P, st, want) {
    const f = path.join(HOME, P.项目, '资产', '生成记录.json'), key = '出片_第' + P.段 + '段_' + path.basename(P.存到).replace(/\.mp4$/i, '');
    await withFileLocks([f], async () => {
      const raw = await fsp.readFile(f, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
      const all = raw.trim() ? JSON.parse(unbom(raw)) : {};   // 读不懂就不写（报出去，记不上不算没成），免得把以前的记录冲掉
      if (!all || typeof all !== 'object' || Array.isArray(all)) throw new Error('生成记录.json 不是一张表');
      all[key] = { status: 'downloaded_verified', by: '流水线自己出片（jm-video.js）', projectId: String(P.画布号).toLowerCase(), account: P.账号 || '', profile: P.登录位 || 'default', region: 'cn',
        taskFile: P.任务书, promptFile: P.提示词.路径, promptSha256: P.提示词.sha256, model: want.model || MODELS[P.模型] || P.模型, mode: P.素材.length ? 'm2v' : 't2v', ratio: '16:9', resolution: P.清晰度, durationSeconds: P.秒数, count: 1,
        approvedCeiling: st.上限, quote: st.报价, authorization: '用户在流水线页面点了批准出片' + (P.积分上限 > 0 ? '，上限 ' + P.积分上限 + ' 积分' : '，按报价提交'),
        nodeId: st.节点 && st.节点.id, submitId: st.提交 || null, title: P.节点名,
        references: P.素材.map(r => ({ ref: r.ref, name: r.name, file: r.path, sha256: r.sha256, nodeId: st.素材[r.ref] || null, method: st.传[r.ref] ? 'uploaded_cli' : 'reused' })),
        resourceId: st.片, output: { file: st.文件.路径, size: st.文件.大小, sha256: st.文件.sha256, durationSeconds: st.文件.秒 }, creditsAmount: st.文件.积分, submittedAt: st.提交时间 || null, doneAt: st.结束 };
      const text = JSON.stringify(all, null, 2) + '\n';   // 两格缩进，和 Codex 记的一样
      await writeText(f, /\r\n/.test(raw) ? text.replace(/\n/g, '\r\n') : text);   // 换行照原文件（童晓晓、骑手困境的是 CRLF）
    });
  }
  return { go, MODELS, genGap, specGap };
};
