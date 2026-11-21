/* ============================================================
   公用 · 写稿页里改这一条拍哪几镜（2026-11-20 他要的：开头勾了镜头，进去写的时候想加镜头、去掉镜头都做不到）
   在右栏「镜头表」页签里勾（公用/写稿镜头表.js 画）；标题旁边「加减镜头」点了翻到那一页。
   名字就是镜头号，拍的镜头变了名字跟着变（9b-9d.txt → 9b-9e.txt）：先把这一页存好，再请流水线改名
   （流水线/提示词.html 的 PromptShots：写稿资料、批注、AI 批注一起改名，参考素材映射里的登记、流水线.json 的「沿用」换到新名字下），
   改完这一页换成新名字接着写，不重开：光标、滚动、没存的字都在。
   出过片、改过几版的也能改（2026-11-20 他定：不加限制）：前几版一起改名，以前的样片照流水线.json 里记的「改名」认回这一条。只有 AI 正在做这一条时等一等。
   事件脚本里的镜头不跟着加减（一镜可以拆几刀写，镜头卡和镜头表不一一对应），自己加减。
   单独打开的写稿页（不在流水线里）只看不改。用的是写稿页的东西（STEM、OPENPATH、save、PULLING……），只在画页签、点的时候用。
   写稿页过了 1500 行，新功能放这里，页面只挂几处：标题旁的 link()、画镜头表时的 opts()、换名字用的 setOpen()
   ============================================================ */
(function () {
  'use strict';
  const flow = () => { try { return window.parent !== window ? window.parent.PromptShots || null : null; } catch (e) { return null; } };   // 流水线那一页（同一个网站才看得见）
  const segNo = () => SEGDIR.replace(/^第|段$/g, '');
  const coded = () => !!Core.vpCode(STEM + '.txt') && flowParas().length > 0;   // 照镜头号起名的稿，这一段也有镜头表
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const S = { note: '', noteFor: '', busy: false };   // 改完提醒的一句（关键帧），只给改的那一份看；busy：正在改，别再点一回

  /* 为什么改不了（能改给 ''） */
  function lock() {
    const p = flow();
    if (!p) return '单独打开的写稿页只看不改：从流水线「提示词」那一步进来，才能加减镜头。';
    try { return String(p.lock(segNo(), STEM + '.txt') || ''); } catch (e) { return '流水线那一页读不了：' + e.message; }
  }
  /* 画镜头表页签时给 写稿镜头表.js 的几样；没照镜头号起名的稿给 null（照旧只看） */
  function opts() {
    return coded() ? { lock: lock(), apply, note: S.noteFor === OPENPATH ? S.note : '' } : null;
  }
  /* 标题旁边的小链接：点了翻到右栏「镜头表」（右栏收着就先展开） */
  function link() {
    if (!coded()) return null;
    return window.UI.h('button', { class: 'linkb shot-edit-b', type: 'button', tabindex: '-1', title: '在右栏「镜头表」里勾：加一镜、去掉一镜，名字跟着改',
      onclick: () => { if (document.body.classList.contains('norail')) $('#railBtn').click(); showRail('shots'); } }, '加减镜头');
  }

  /* 这台浏览器里照稿子路径记的（收起了哪几镜、恢复草稿、AI 批注的处理、参考哪一条……）跟着换到新路径。
     认法：键里「:路径」后面要么完了、要么接「:」，2-4_改1.txt 那一份的不算 */
  function moveKeys(was, now) {
    try {
      for (const k of Object.keys(localStorage)) {
        const i = k.indexOf(':' + was), rest = i < 0 ? '' : k.slice(i + 1 + was.length);
        if (i < 0 || (rest && rest[0] !== ':')) continue;
        localStorage.setItem(k.slice(0, i + 1) + now + rest, localStorage.getItem(k));
        localStorage.removeItem(k);
      }
    } catch (e) { /* 记不住就算了：收起的几镜下回都展开 */ }
  }
  /* 改了名：这一页换成新名字（不重画正文） */
  function retarget(name, was) {
    const open = was.split('/');
    open[open.length - 1] = name;
    setOpen(open);   // 写稿页：路径跟着换的几样（STEM、SIDEF、HNF……）、顶上的名字
    history.replaceState(history.state, '', '#open=' + open.map(encodeURIComponent).join('/'));   // 刷新还开这一份（换网址不触发 hashchange，页面不重开）
    moveKeys(was, OPENPATH);
    const t = $('#sheet .doc-name-t'), f = $('#sheet .sheet-foot');
    if (t) t.textContent = vpShort(STEM).replace(/_/g, ' · ');
    if (f) f.textContent = OPENPATH.split('/').join(' / ');
  }
  /* 改完提醒一句关键帧（旧关键帧别默默挂着）：加的镜头绑着现用的关键帧、这一条还没挂的；去掉的镜头的关键帧、这一条还挂着的 */
  function framesSay(add, drop) {
    if (!FLOW) return '';
    const binds = ShotBind.bindsOf(FLOW), files = Object.keys(binds).filter(f => A[f]), nm = f => '「' + f.split('/').pop().replace(/\.[^.]+$/, '') + '」';
    const lack = ShotBind.forShots(add, files, flowParas(), binds).filter(f => !NUM.图片.includes(f));
    const stay = NUM.图片.map((f, i) => f && binds[f] && drop.includes(binds[f].镜) ? '@图片' + (i + 1) + nm(f) : '').filter(Boolean);
    return (lack.length ? '加的镜头有关键帧还没挂：' + lack.map(nm).join('、') + '，要用就到「资产」里点它，插进素材。' : '')
      + (stay.length ? '去掉的镜头的关键帧还挂着：' + stay.join('、') + '，不用了就把素材里那一句删掉。' : '');
  }
  /* 照勾的改：先存好，请流水线改名，再换成新名字。改成了给 true */
  async function apply(picked) {
    if (S.busy) return false;
    S.busy = true;
    try { return await change(picked); } finally { S.busy = false; }
  }
  async function change(picked) {
    const p = flow(), toast = window.UI.toast;
    if (!p) { toast(lock()); return false; }
    if (!READY || CONFLICT || RECOVERY_PENDING) { toast('这份稿还有冲突或恢复草稿没处理：先处理好再改'); return false; }
    if (Lay.watching() || JOBS.live.length) { toast('AI 正在做这一条（左下角那一条）：做完再改'); return false; }
    const from = STEM + '.txt', was = OPENPATH, pl = WriteShots.plan(flowParas(), from, Core.vpCode(from), picked);
    if (!pl.to) { toast(pl.say); return false; }
    if (pl.same) return true;
    clearTimeout(ST);
    if (!await save()) { toast('稿子还没存上：先存好再改'); return false; }
    for (let i = 0; POLLING && i < 50; i++) await sleep(100);   // 正在看外面改没改的那一轮，先等它走完
    let r = null;
    PULLING = true;   // 改名这一下不存、不看外面：要存的晚 0.3 秒再试，那时候已经是新名字
    try { r = await p.rename(segNo(), from, pl.pick); }
    catch (e) { PULLING = false; toast('没改成：' + e.message); return false; }
    if (!r || !r.name) { PULLING = false; toast('没改成：流水线那一页没回话'); return false; }
    try { if (r.name !== from) retarget(r.name, was); }
    finally { PULLING = false; }
    S.note = framesSay(pl.add, pl.drop); S.noteFor = OPENPATH;
    paintShots(); Lay.paint();
    toast('改好了：这一条拍 镜' + Core.vpCode(r.name) + '，名字改成 ' + r.name + (r.vers > 1 ? '（前几版一起改了名）' : '') + (r.warn ? '。' + r.warn : ''));
    return true;
  }
  window.ShotEdit = Object.freeze({ link, opts, lock });
})();
