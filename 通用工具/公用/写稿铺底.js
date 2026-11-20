/* 写稿页的「AI 铺底」（2026-11-19 他要回人写提示词：你写【生成目标】【事件脚本】，分镜模式、自由模式都行，其余几块交给 AI 补）。
   11-15 加在写稿页分区按钮那一行最右边，当晚提示词改成一律 AI 写就撤了；这回放回来，单放在这个文件（写稿页过了 1500 行，新功能不往里加）。
   AI 照定稿的剧本和这一段的资产，把素材、基础设定、主体与关系、保持一致和「声音包括」那一行写进正文；你写的两块不动，原来那一版先进历史记录。
   铺过的，AI 先判断要不要改，对得上一个字不动（本机服务「直接铺底」，.agents/skills/annotate-live/pe-lay.js）。
   交给 AI 照 11-15 的规矩一律复制：点了就把要交代的话备好，贴进你自己开的对话；它写好，这里自动换上。
   铺的时候不挡人：进度和「停掉」在左下角，这一页照样能写。AI 写进文件那一下你还有没存的字：AI 只动了它那几块、你只动了你那两块，
   就把 AI 写的换进这一页、和你写的一起存，不算冲突（merge）；两边动了同一块，照旧摆冲突条。
   用的是写稿页的东西（DOC、SIDE、save、poll……），只在点按钮、任务走完时用，载入时不碰。写稿页里调的是 window.Lay 的几样 */
(function () {
  'use strict';
  const S = { fin: false, sync: false, grace: 0 };   // fin：剧本定稿了（打开时、点的时候各查一次）；sync：铺完了、正在把 AI 写的换上；grace：铺完以后再照看一会儿，晚到的存盘撞上了也照样合
  const AI_KEYS = ['refs', 'basic', 'seg', 'keep'];
  const segNo = () => SEGDIR.replace(/^第|段$/g, '');
  const isJob = j => !!j && j.事 === '直接铺底' && j.段 === segNo() && j.名 === STEM + '.txt';
  const liveJob = () => JOBS.live.find(isJob) || null;
  const busy = () => !!liveJob() || S.sync;
  const watching = () => busy() || Date.now() < S.grace;
  const humanOf = d => ({ event: String(d.event || '').trim(), shots: PromptDraft.shotText(d).split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l && !PromptDraft.isLook(l)) });   // 你写的两块（和本机服务一个算法）
  const laidOf = d => !!d && (!!String(d.keep || '').trim() || (d.basic || []).some(l => !PromptDraft.isLook(l)));   // 铺过了：基础设定、保持一致有字
  const aiSig = d => JSON.stringify(AI_KEYS.map(k => [].concat(d[k] || []).map(l => String(l).trim()).filter(Boolean)));
  const whyNot = () => '剧本定稿以后才能铺：回流水线，到剧本那一步点「剧本定稿」';
  /* 分区头上、引导条上写谁写的：你来写的稿（写稿资料里记着「手写」）是「你写」「AI 铺底」，AI 写的稿照旧「AI 写」 */
  const whoOf = by => !PromptDraft.isHand(SIDE) ? 'AI 写' : by === 'ai' ? 'AI 铺底' : '你写';
  const guideName = (key, name) => name.replace(/ · AI 写$/, ' · ' + whoOf((SECS.find(s => s.key === key) || {}).by));
  async function scriptFinal() {   // 剧本定稿了没有：现读流水线和剧本文件的时间，和流水线、本机服务一个算法（公用/核心.js 的 scriptFinal）
    let s = FLOW;
    try { const j = JSON.parse((await FS.text([HOME, PJ, '定稿的剧本', '流水线.json'])).text.replace(BOM, '')); s = (Array.isArray(j.场) ? j.场 : []).find(x => x && '第' + x.段 + '段' === SEGDIR) || null; } catch (e) { /* 读不了照打开时读的 */ }
    if (!s || !s.剧本定稿) return false;
    const st = await FS.stat([HOME, PJ, '定稿的剧本', SEGDIR, SEGDIR + '_剧本.docx']).catch(() => null);
    return !!st && Core.scriptFinal(s.剧本定稿, s.回填, st.mtime);
  }
  function nav() {   // 分区按钮那一行，最右边摆「AI 铺底」；旧格式的稿、没有流水线的老项目不摆
    const n = commonControls();
    if (isPe() && FLOW) n.append(h('button', { id: 'layBtn', class: 'btn sm lay-b', type: 'button', onclick: ask }, 'AI 铺底'));
    return n;
  }
  function paint() {   // 按钮的样子：在铺的时候按钮上转个圈（进度、停掉在左下角那一条里）
    setAsk();
    const b = $('#layBtn');
    if (!b) return;
    const on = busy();
    b.disabled = !READY || on || !S.fin;
    b.classList.toggle('dian', !b.disabled && !laidOf(DOC));   // 你写好了、AI 那几块还空着：这一步就该点它
    b.title = on ? 'AI 在铺底：进度和「停掉」在左下角。这一页照样能写，铺好自动换上'
      : !S.fin ? whyNot() : 'AI 照定稿的剧本和这一段的资产，把素材、基础设定、主体与关系、保持一致写进正文；你写的生成目标、事件脚本不动。铺过的，AI 先看要不要改，对得上一个字不动';
    if (b.dataset.on !== String(on)) { b.dataset.on = String(on); b.replaceChildren(...(on ? [h('i', { class: 'wt-ring' }), 'AI 在铺底'] : ['AI 铺底'])); }   // 变了才换：每秒都来，换了转着的环会跳回原处
  }
  async function ask() {
    if (!READY || busy()) return;
    if (CONFLICT) return toast('这份稿有修改冲突：先在上面处理好，再铺');
    const hm = humanOf(PromptDraft.parse(activeText()));
    if (!hm.event && !hm.shots.length) return toast('生成目标、事件脚本都还空着：先写好再铺底');
    S.fin = await scriptFinal(); paint();
    if (!S.fin) return toast(whyNot());
    if (SVC == null) { try { SVC = (await (await fetch('/api/ping', { headers: HDR })).json()).v || 0; } catch (e) { SVC = 0; } }
    if (SVC < 5) return toast('本机服务是老版本，铺不了：重开本机服务再试');
    try {
      clearTimeout(ST); if (!await save()) return toast('稿子还没存上，先存好再铺');
      const r = await tellAI('直接铺底 ' + OPENPATH);
      toast(r.say || '交给 AI 了：进度在左下角，铺好自动换上。这一页照样能写');
    } catch (e) { toast('没交上：' + e.message); }
  }
  async function done(j) {   // 铺完了（没成、停掉也一样）：把 AI 写的换进这一页
    S.sync = true; S.grace = Date.now() + 20e3; paint();
    try {
      for (let i = 0; i < 80 && (POLLING || PULLING || SAVING); i++) await new Promise(r => setTimeout(r, 100));   // 正在读、正在存的先让它做完
      if (CONFLICT) { if (await heal()) await save(); }   // 存盘撞上了 AI 写文件的那一下：合上接着存
      else await poll();   // 文件变了就换上；你有没存的字，走 merge 只换 AI 那几块
    } finally {
      S.sync = false; paint();
      toast(j.状态 === '做完' ? j.结果 : j.标题 + (j.状态 === '停了' ? ' 停掉了' : ' 没成：' + j.错误));
    }
  }
  /* AI 写进文件了，这一页还是它写之前的底：AI 只动了它那几块、你只动了你那两块，就把 AI 写的换进来（你在写的地方不重画、光标不丢），你没存的字接着存。
     返回 true：换好了，或者文件本来就和这一页的底一样（是一笔过时的存盘撞上的），接着存就行；false：两边动了同一块，照旧摆冲突条 */
  async function merge(r, ss) {
    if (!r) [r, ss] = await Promise.all([FS.text(PROMPT), readSideState()]);
    if (r.text === LASTTEXT) return JSON.stringify(editorPart(ss.side)) === JSON.stringify(BASE_EDITOR);
    const scoped = MODE !== '自由' || (ss.side.写法 === '自由' && ss.side.写法范围 === '分镜' && typeof ss.side.分镜稿 === 'string');
    if (!scoped) return false;   // 老的整页自由稿：照原来的办法整页换
    const base = parsePrompt(LASTTEXT), disk = parsePrompt(r.text), mine = parsePrompt(activeText());
    if (JSON.stringify(humanOf(disk)) !== JSON.stringify(humanOf(base)) || aiSig(mine) !== aiSig(base)) return false;
    const src = MODE === '自由' ? parsePrompt(ss.side.分镜稿) : disk;   // 自由写法：AI 那几块照写稿资料里的结构化稿取（和整页换上时一样）
    const wrote = dirty(), binding = editorSnapshot().挂图;   // 你刚挂、还没存的图留着
    LASTTEXT = r.text; MTIME = r.mtime; SIDE = { ...ss.side, 挂图: { ...ss.side.挂图, ...binding } }; SIDE_MT = ss.mtime; BASE_EDITOR = structuredClone(editorPart(ss.side));
    for (const k of AI_KEYS) DOC[k] = src[k];
    paintAi();
    if (wrote) touch();   // 你写的两块还没存：和 AI 写的几块一起存
    await loadRefs(); fixChips(); paintSum(); paintMarks(); paintAssets();
    return true;
  }
  /* AI 这回新登记的图：画 AI 那几区时编号还没读进来，画成了「还没挂上图」的红线；读进来以后就地换成带图的小牌（不重画，免得丢你刚打的字） */
  function fixChips() {
    for (const el of $$('#sheet .ed .m-lint')) { const ref = el.textContent.trim(); if (/^@(图片|视频|音频)[0-9]+$/.test(ref) && assetOfRef(ref)) el.replaceWith(chip(ref)); }
  }
  async function heal() {   // 冲突条是 AI 铺底写文件撞出来的：能合就合上、收起冲突条
    try { if (!await merge()) return false; } catch (e) { return false; }
    CONFLICT = false; $('#saveConflict')?.remove(); setStatus('正在保存…');
    return true;
  }
  function paintAi() {   // 只换 AI 那几区；生成目标、事件脚本不重画
    const keys = SECS.map(s => s.key).join(), box = $('.shared-settings'), ev = box && $('section[data-sec="event"]', box);
    if (!ev) return;
    pickSecs();
    for (const el of [...box.children]) if (el !== ev) el.remove();
    ev.after(...SECS.filter(s => s.key !== 'shots').map((s, i) => s.key === 'event' ? null : secEl(s, i)).filter(Boolean));
    if (SECS.map(s => s.key).join() !== keys) {   // 写法一、写法二换了（主体与关系那一区有没有）：分区按钮、事件脚本的序号跟着换
      $('#sheet .section-nav').replaceWith(nav());
      const no = $('section[data-sec="shots"] .sec-no'); if (no) no.textContent = CN[SECS.findIndex(s => s.key === 'shots')];
    }
    paintSum(); updateCommonSections(); paintHNotes(); paint();
  }
  async function init() { S.fin = await scriptFinal(); paint(); }   // 打开时查一次剧本定稿了没有
  window.Lay = { isJob, busy, watching, whoOf, guideName, nav, paint, done, merge, heal, init };
})();
