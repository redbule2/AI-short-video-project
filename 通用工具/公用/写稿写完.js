/* 写稿页的「交给 AI 写完」（2026-11-21 他定：「没有 AI 铺底这一说，人写了分镜以后，剩下工作 AI 一次性完结」）。
   你只写事件脚本（新稿在自由模式写一大段；分镜模式一镜一镜写的也行），点它：AI 照定稿的剧本和这一段的资产，
   把你写的拆成一镜一镜、扩写（分区写法放进提示词，合并的另存一份备选；已经一镜一镜的，镜头一个字不动），
   再写生成目标、素材、基础设定、主体与关系、保持一致和「声音包括」那一行。写过的几块 AI 先判断要不要改，对得上一个字不动；
   原来那一版先进历史记录（本机服务「写完提示词」，.agents/skills/annotate-live/pe-finish.js）。以前的「AI 铺底」「AI 整理成分镜」并进来了。
   交给 AI 照 11-15 的规矩一律复制：点了就把要交代的话备好，贴进你自己开的对话；它写好，这里整页换上。
   AI 写的时候这一页锁着（改了也写不进去）：进度和「停掉」在左下角，要改先停掉。
   写稿页过了 1500 行，新功能放这里；用的是写稿页的东西（DOC、SIDE、save、poll、tellAI……），只在点按钮、任务走完时用，载入时不碰。写稿页里调的是 window.Finish 的几样 */
(function () {
  'use strict';
  const S = { fin: false, sync: false, locked: false };   // fin：剧本定稿了（打开时、点的时候各查一次）；sync：写完了、正在把 AI 写的换上；locked：这一页是不是这里锁上的
  const segNo = () => SEGDIR.replace(/^第|段$/g, '');
  const isJob = j => !!j && j.事 === '写完提示词' && j.段 === segNo() && j.名 === STEM + '.txt';
  const busy = () => JOBS.live.some(isJob) || S.sync;
  const humanOf = d => PromptDraft.shotText(d).split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l && !PromptDraft.isLook(l));   // 你写的事件脚本（和本机服务一个算法）
  const loose = d => (d.shotsPre || []).some(l => String(l).trim() && !PromptDraft.isLook(String(l).trim()));   // 事件脚本里还有一段没分镜的字
  const doneOf = d => !!String(d.event || '').trim() && !!String(d.keep || '').trim() && (d.basic || []).some(l => !PromptDraft.isLook(l));   // 写完了：生成目标、基础设定、保持一致都有字
  const pfSeg = () => !!FLOW && Core.isPF(FLOW);   // 写初步剧本的段（11-21）：剧本就是初步剧本，分镜还要定下来
  const whyNot = () => pfSeg() ? '分镜定下来以后才能交给 AI 写完：回流水线，到「提炼分镜」那一步点「定下来」（初步剧本改过的，点「照旧」或「重新提炼」）' : '剧本定稿以后才能交给 AI 写完：回流水线，到剧本那一步点「剧本定稿」';
  /* 分区头上、引导条上写谁写的：你来写的稿（写稿资料里记着「手写」）只有事件脚本是你写的，别的都是 AI 写 */
  const whoOf = by => by === 'me' && PromptDraft.isHand(SIDE) ? '你写' : 'AI 写';
  const guideName = (key, name) => name.replace(/ · AI 写$/, ' · ' + whoOf((SECS.find(s => s.key === key) || {}).by));
  async function scriptFinal() {   // 剧本定稿了没有：现读流水线和剧本文件的时间，和流水线、本机服务一个算法（公用/核心.js 的 scriptFinal）
    let s = FLOW;
    try { const j = JSON.parse((await FS.text([HOME, PJ, '定稿的剧本', '流水线.json'])).text.replace(BOM, '')); s = (Array.isArray(j.场) ? j.场 : []).find(x => x && '第' + x.段 + '段' === SEGDIR) || null; } catch (e) { /* 读不了照打开时读的 */ }
    if (!s || !s.剧本定稿) return false;
    const pf = Core.isPF(s);
    if (pf && !s.定稿) return false;
    const st = pf ? (await FS.stat([HOME, PJ, '提示词', SEGDIR, Core.PF_FILE]).catch(() => null)) || (await FS.stat([HOME, PJ, '提示词', SEGDIR, Core.PF_OLD]).catch(() => null))   // 老段的初步剧本叫 自由稿.txt（11-26）
      : await FS.stat([HOME, PJ, '定稿的剧本', SEGDIR, SEGDIR + '_剧本.docx']).catch(() => null);
    return !!st && Core.scriptFinal(s.剧本定稿, s.回填, st.mtime);
  }
  function nav() {   // 分区按钮那一行，最右边摆「交给 AI 写完」；旧格式的稿、没有流水线的老项目不摆
    const n = commonControls();
    if (isPe() && FLOW) n.append(h('button', { id: 'finBtn', class: 'btn sm fin-b', type: 'button', onclick: ask }, '交给 AI 写完'));
    return n;
  }
  function paint() {   // 按钮的样子、锁不锁：AI 在写的时候按钮上转个圈，这一页锁着（进度、停掉在左下角那一条里）
    setAsk();
    const on = busy();
    const sheet = $('#sheet'), mode = $('#editor-mode');
    if (on) { for (const el of [sheet, mode]) if (el && !el.inert) el.inert = true; }
    else if (S.locked) { if (sheet) sheet.inert = !!RECOVERY_PENDING; if (mode) mode.inert = false; }   // 只放开自己锁的：恢复草稿待选择时 #sheet 也锁着（写稿交互.js），别替它放开
    S.locked = on;
    if (sheet) sheet.classList.toggle('fin-lock', on);
    const send = $('#sendNotes'); if (send) send.disabled = on;
    const b = $('#finBtn');
    if (!b) return;
    b.disabled = !READY || on || !S.fin;
    b.classList.toggle('dian', !b.disabled && !!DOC && (MODE === '自由' || loose(DOC) || !doneOf(DOC)));   // 你写好了、AI 那几块还空着（或者还有没拆的一段）：这一步就该点它
    b.title = on ? 'AI 在写完：进度和「停掉」在左下角。写好整页换上；这时候先别改，要改先点「停掉」'
      : !S.fin ? whyNot() : (pfSeg() ? 'AI 照镜头表、你写的初步剧本和这一段的资产，把这几镜拆好、写完' : 'AI 照定稿的剧本和这一段的资产，把你写的事件脚本拆成一镜一镜、扩写（已经一镜一镜的不动），再写生成目标、素材、基础设定这几块。写过的，AI 先看要不要改，对得上一个字不动');
    if (b.dataset.on !== String(on)) { b.dataset.on = String(on); b.replaceChildren(...(on ? [h('i', { class: 'wt-ring' }), 'AI 在写完'] : ['交给 AI 写完'])); }   // 变了才换：每秒都来，换了转着的环会跳回原处
  }
  async function ask() {
    if (!READY || busy()) return;
    if (CONFLICT) return toast('这份稿有修改冲突：先在上面处理好，再交给 AI');
    if (JOBS.live.length) return toast('AI 正在做这一条（左下角那一条）：做完再交');
    const d = PromptDraft.parse(activeText());
    if (!humanOf(d).length) return toast('事件脚本还空着：先写好这几镜里发生什么，再交给 AI 写完');
    S.fin = await scriptFinal(); paint();
    if (!S.fin) return toast(whyNot());
    if (SVC == null) { try { SVC = (await (await fetch('/api/ping', { headers: HDR })).json()).v || 0; } catch (e) { SVC = 0; } }
    if (SVC < 20) return toast('本机服务是老版本，没有「交给 AI 写完」：重开本机服务再试');
    const had = (DOC.shots || []).filter(s => s.lines && s.lines.length).length;   // 分镜模式里已经有的镜头：这回重新拆，会换掉
    if ((MODE === '自由' || loose(d)) && had && !confirm('AI 照你写的这一段重新拆镜头，换掉分镜模式里现在的 ' + had + ' 镜（原来那一版先进历史记录）。')) return;
    try {
      clearTimeout(ST); if (!await save()) return toast('稿子还没存上，先存好再交给 AI');
      const r = await tellAI('写完提示词 ' + OPENPATH);
      toast(r.say || '交给 AI 了：进度在左下角，写好整页换上');
    } catch (e) { toast('没交上：' + e.message); }
    paint();
  }
  async function done(j) {   // 写完了（没成、停掉也一样）：文件变了就整页换上（锁着的时候没改过，不会撞上），再放开这一页
    S.sync = true; paint();
    try {
      for (let i = 0; i < 80 && (POLLING || PULLING || SAVING); i++) await new Promise(r => setTimeout(r, 100));   // 正在读、正在存的先让它做完
      await poll();
    } finally {
      S.sync = false; paint();
      toast(j.状态 === '做完' ? j.结果 : j.标题 + (j.状态 === '停了' ? ' 停掉了' : ' 没成：' + j.错误));
    }
  }
  async function init() { S.fin = await scriptFinal(); paint(); }   // 打开时查一次剧本定稿了没有
  window.Finish = Object.freeze({ isJob, busy, whoOf, guideName, nav, paint, done, init });
})();
