'use strict';
/* ============================================================
   任务存盘（2026-11-18 他说：后台任务不能刷新就丢）
   AI 任务原来只记在本机服务的内存里：8766 一重开，后台任务抽屉、各页的任务行全空，Codex 做完回报也认不出号。
   现在每个项目最近 60 件记进 项目/<项目>/历史记录/AI任务/任务清单.json（一秒看一眼，变了才写）。
   服务重开时，jobs.js 的 resumeSelf 先把在等回复的接回来（同一个号，接着等；出片、出图、改图要清单里记着那会儿还在等，wasLive），这里再把清单里别的摆回去：
     做完、没成、停了的   照原样摆回去，只给页面看（jobs.js 的 pub 照存下的那份给）
     当时在做、排队的     自己交.json 里记着了结了的照它说；别的记成「没成：本机服务重开过……」，
                          结束时间算重开那一刻：抽屉「刚做完的」、各页都看得见，要的话再点一次
   测试：通用工具/测试/任务存盘_测试.cjs
   ============================================================ */
module.exports = function makeJobStore({ fsp, path, ROOT, HOME, pj, writeFile, log, pub, live, jobs, byId, MAX = 200, now = () => Date.now() }) {
  const FILE = ['历史记录', 'AI任务', '任务清单.json'];
  const KEEP = 60;   // 每个项目留几件：和 GET /api/job?p= 给页面的一样多
  const LOST = '本机服务重开过，这件没做完：要的话再点一次';
  const NOTE = '本机服务（8766）的 AI 任务，每个项目最近 ' + KEEP + ' 件。服务重开时读回来，后台任务抽屉和各页的任务行照它摆。本机服务自己写，手改会被盖掉。';
  const ENDS = ['做完', '没成', '停了'];
  const unbom = s => s.replace(/^\uFEFF/, '');
  const timeOf = t => { const n = Date.parse(String(t || '').trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const written = new Map();   // 项目 → 上回写进去的那份：一样就不写
  let busy = false, timer = null;

  /* 当时在做、排队的，没接回来：交给 AI 等回复的看它的 自己交.json 了结了没有（清单最多晚一秒，刚好在那一秒里做完的） */
  async function endOf(s, t0) {
    const base = { ...s, 步骤: '', 交给: null };
    if (typeof s.记录 === 'string' && s.记录) {
      try {
        const m = JSON.parse(unbom(await fsp.readFile(path.join(ROOT, ...s.记录.split('/'), '自己交.json'), 'utf8')));
        if (m.结束 && ENDS.includes(m.状态)) return { ...base, 状态: m.状态, 结束: timeOf(m.结束) || t0,
          结果: m.状态 === '做完' ? s.结果 || '做完了' : '', 错误: m.状态 === '停了' ? '你点了停' : m.状态 === '没成' ? '本机服务重开前就没成，为什么没记下' : '' };
      } catch (e) { /* 没有 自己交.json（不是交给 AI 等回复的），或者读不了 */ }
    }
    return { ...base, 状态: '没成', 结束: t0, 错误: LOST };
  }
  /* 最多留 MAX 件：太多了丢最早了结的，在做、排队的不丢（不然接着等的那件会被挤掉，回复来了认不出号） */
  function trim() {
    for (let i = 0; jobs.length > MAX && i < jobs.length;) if (live(jobs[i])) i++; else byId.delete(jobs.splice(i, 1)[0].id);
  }
  /* 各项目的清单：服务刚开时读一回，[项目, 任务[]] */
  let cache = null;
  function lists() {
    if (!cache) cache = (async () => {
      const out = [];
      for (const p of await fsp.readdir(HOME).catch(() => [])) {
        try { const t = JSON.parse(unbom(await fsp.readFile(pj(p, ...FILE), 'utf8'))).任务; if (Array.isArray(t)) out.push([p, t.slice(-KEEP)]); }
        catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') log('任务清单读不了：' + p + '　' + e.message); }   // 项目 下的散文件、还没有清单的项目：不管
      }
      return out;
    })();
    return cache;
  }
  /* 不止一步的事（出片、出图、改图）重开后接不接：清单里记着重开那会儿还在等的才接。
     没记着的是更早就断了的，多半已经在别处重出过，接回来会挂成「等你交给 AI」，再贴一回就再扣一回积分（11-18 李云龙 3-4 镜头1 改3） */
  async function wasLive(p, id) {
    for (const [q, list] of await lists()) if (q === p && list.some(s => s && s.id === id && live(s))) return true;
    return false;
  }
  /* 服务刚开：把各项目清单里还不在的摆回去 */
  async function restore() {
    const t0 = now(), back = [];
    let lost = 0;
    for (const [p, list] of await lists()) {
      for (const s of list) {
        if (!s || typeof s.id !== 'string' || !s.id || byId.has(s.id) || s.项目 !== p) continue;   // 在等回复的已经接回来了（同一个号）
        const snap = live(s) ? await endOf(s, t0) : s;
        if (!ENDS.includes(snap.状态)) continue;
        if (live(s) && snap.错误 === LOST) lost++;
        back.push({ id: s.id, 项目: p, 事: s.事, 段: s.段 || '', 标题: s.标题, 状态: snap.状态, 建: +s.建 || 0, 开始: +s.开始 || 0, 结束: +snap.结束 || 0, 旧: snap });
      }
    }
    for (const j of back) if (!byId.has(j.id)) { jobs.push(j); byId.set(j.id, j); }
    jobs.sort((a, b) => (+a.建 || 0) - (+b.建 || 0));   // 先开的在前：页面取最后 60 件
    trim();
    if (back.length) log('任务清单读回来 ' + back.length + ' 件' + (lost ? '，其中 ' + lost + ' 件重开前没做完、接不上：标成没成' : ''));
    return back;
  }
  /* 各项目的清单：变了才写。项目文件夹不在了（改名、删了）不替它建 */
  async function save() {
    if (busy) return;
    busy = true;
    try {
      const by = new Map();
      for (const j of jobs) if (typeof j.项目 === 'string' && j.项目) { if (!by.has(j.项目)) by.set(j.项目, []); by.get(j.项目).push(j); }
      for (const [p, list] of by) {
        const text = JSON.stringify({ 说明: NOTE, 任务: list.slice(-KEEP).map(pub) }, null, 1) + '\n';
        if (written.get(p) === text) continue;
        if (!(await fsp.stat(pj(p)).then(st => st.isDirectory(), () => false))) continue;
        await writeFile(pj(p, ...FILE), text);
        written.set(p, text);
      }
    } catch (e) { log('任务清单没存上：' + e.message); }
    finally { busy = false; }
  }
  /* 先读回来，再开始存（反过来会拿空清单把记下的盖掉） */
  async function start() {
    if (timer) return;
    try { await restore(); } catch (e) { log('任务清单没读回来：' + e.message); }
    timer = setInterval(save, 1000);
    if (timer.unref) timer.unref();   // 测试跑完能退出
    await save();
  }
  return { start, restore, save, trim, wasLive, LOST, FILE };
};
