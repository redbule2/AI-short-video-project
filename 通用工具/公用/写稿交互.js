/* 写稿页交互。只操作用户当前选择的稿。 */
'use strict';

/* 新稿只替换分镜正文。旧版整页自由稿原样保留在自由分镜里，首次保存才迁移。 */
function readEditorDraft(text, side) {
  const parsed = parsePrompt(text);
  const mode = side.写法 === '自由' || (!side.写法 && !parsed.has.shots) ? '自由' : '分镜';
  if (mode === '分镜') return { mode, doc: parsed, free: String(side.自由稿 || ''), conflict: false };
  let doc = parsePrompt(side.分镜稿 || (parsed.fmt === 'pe' ? PromptDraft.skeleton('\n') : '本段事件：\n\n素材\n\n基础设定\n\n本段\n\n分镜\n\n保持一致：\n'));
  const scoped = side.写法范围 === '分镜';
  let free = scoped ? String(side.自由稿 || '') : text;
  // 标准旧稿可确认边界：采用当前文件的公共区，并继续保留备用结构化镜头。
  if (!scoped && parsed._source.parts.map(part => part.key).join(',') === 'pre,event,refs,basic,seg,shots,keep') {
    free = PromptDraft.shotText(parsed);
    doc = parsePrompt(PromptDraft.withShotText(parsed, PromptDraft.shotText(doc)));
  }
  return { mode, doc, free, conflict: scoped && PromptDraft.withShotText(doc, free) !== text };
}

let COMMON_SECTION = '';
function commonControls() {
  return h('nav', { class: 'section-nav', 'aria-label': '各区快捷入口' },
    SECS.filter(s => s.key !== 'shots').map(s => h('button', { class: 'mini-b', 'data-common': s.key, 'aria-expanded': 'false', onclick: () => {
      if (COMMON_SECTION === s.key) { COMMON_SECTION = ''; updateCommonSections(); }
      else openCommonSection(s.key);
    } }, s.name, h('span', { class: 'faint' }, ' ▾'))),
    h('button', { class: 'linkb', onclick: editGNote }, '＋ 整体批注'));
}
function updateCommonSections() {
  for (const el of $$('.shared-settings > section')) {
    el.hidden = el.dataset.sec !== COMMON_SECTION;
    if (!el.hidden) {
      if (el.dataset.sec === 'event') foldMine(el, false, true);
      else toggleFold(el, true);
      $$('.wr-ta', el).forEach(grow);
    }
  }
  for (const button of $$('[data-common]')) {
    const active = button.dataset.common === COMMON_SECTION;
    button.classList.toggle('on', active); button.setAttribute('aria-expanded', String(active));
  }
}
function openCommonSection(key) {
  const el = $('.shared-settings > section[data-sec="' + key + '"]');
  if (!el) return;
  COMMON_SECTION = key; updateCommonSections();
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function paintOutline() {
  const nav = $('#editor-outline');
  if (!nav || !DOC) return;
  nav.replaceChildren(h('p', { class: 'faint small' }, '本条提示词'),
    ...SECS.filter(s => s.key !== 'shots').map(s => h('button', { class: 'outline-link', onclick: () => openCommonSection(s.key) }, s.name)),
    h('button', { class: 'outline-link on', onclick: () => $('[data-sec="shots"]').scrollIntoView({ behavior: 'smooth', block: 'start' }) }, '分镜' + (MODE === '分镜' ? ' ' + $$('.p-shot').length : ' · 自由')),
    ...$$('.p-shot').map(el => h('button', { class: 'outline-link outline-shot' + (el.dataset.id === SELECTED_ID ? ' selected' : ''), onclick: () => {
      foldMine(el, false); selectShot(el.dataset.id); el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } }, el.dataset.no + ' ' + ($('.shot-title', el).value || $('.wr-ta', el).value.trim().slice(0, 14) || '未命名镜头'))));
}

function renderMode() {
  for (const [id, mode] of [['modeStructured', '分镜'], ['modeFree', '自由']]) {
    if (!$('#' + id)) continue;
    $('#' + id).classList.toggle('on', MODE === mode);
    $('#' + id).setAttribute('aria-selected', String(MODE === mode));
    $('#' + id).disabled = !DOC;
  }
  if ($('#importStructured')) $('#importStructured').hidden = MODE !== '自由';
}
function modeControls() {   // 摆在左栏最上面（2026-11-15）；说明收进鼠标悬停提示
  return h('div', { class: 'mode-bar' },
    h('div', { class: 'mode-tabs', role: 'tablist', 'aria-label': '分镜写法', title: '只换分镜的写法；生成目标、素材等其他几块两种写法共用' },
      h('button', { id: 'modeStructured', class: 'mini-b', role: 'tab', onclick: () => switchMode('分镜') }, '分镜模式'),
      h('button', { id: 'modeFree', class: 'mini-b', role: 'tab', onclick: () => switchMode('自由') }, '自由模式')),
    h('button', { id: 'importStructured', class: 'mini-b', title: '把分镜模式里各镜的文字接到自由稿后面', onclick: () => { const ta = $('#freeText'); typeInto(ta, ta.value.length, ta.value.length, (ta.value ? '\n\n' : '') + PromptDraft.shotText(collect())); } }, '带入分镜文字'));
}
function renderFree() {
  const wr = writer('free', 12, isPe() ? '在这里自由写事件脚本……\n\n可以一镜一行写「镜头1：……」，也可以写【阶段一】开始时、主要事件、结束时。\n素材、主体与关系等统一使用上方的设置。' : '在这里自由写分镜……\n\n可以写一整段，也可以自己分行、分镜。\n素材、基础设定等统一使用上方的设置。', FREE);
  $('.wr-ta', wr).id = 'freeText';
  $('.wr-ta', wr).setAttribute('aria-label', '自由提示词');
  $('#shot-editor').replaceChildren(h('div', { class: 'free-section' },
    wr, h('div', { class: 'free-footer' }, '分镜正文 · 输入 @ 引用素材', h('span', { id: 'freeCount' }, FREE.length + ' 字'))));
  grow($('#freeText'));
  LASTF = $('#freeText'); LAST = null;
}
function renderShotEditor() {
  renderMode();
  if (MODE === '自由') renderFree();
  else {
    $('#shot-editor').replaceChildren(h('div', { class: 'pshots' }, DOC.shots.length ? DOC.shots.flatMap((s, i) => [shotEl(s), i < DOC.shots.length - 1 ? h('button', { class: 'mini-b insert-shot', onclick: () => insertShot(i + 1) }, '＋ 在这里插入一镜') : null]) : h('p', { class: 'empty-shots' }, '还没有镜头，从空白开始写。')), h('button', { class: 'add-shot', onclick: () => addShot() }, '＋ 添加空白镜头'));
    $$('.wr-ta', $('#shot-editor')).forEach(grow); updateShotControls();
  }
  paintOutline();
}
let switchingMode = false;
async function switchMode(mode) {
  if (!READY || switchingMode || mode === MODE) return;
  switchingMode = true;
  try {
    if (!await save()) return;
    DOC = collect(); if (MODE === '自由') FREE = freeText();
    MODE = mode; LASTF = null; LAST = null;
    closeAt(); renderShotEditor(); setAsk(); paintMarks(); renderNotes(); touch(); await save();
  } finally { switchingMode = false; }
}
function selectShot(id) {
  SELECTED_ID = id;
  $$('.p-shot').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  setAsk(); paintOutline();
}
function updateShotControls() {
  const list = $$('.p-shot');
  list.forEach((el, i) => {
    $('[data-move="-1"]', el).disabled = i === 0;
    $('[data-move="1"]', el).disabled = i === list.length - 1;
  });
  if (!list.some(el => el.dataset.id === SELECTED_ID)) SELECTED_ID = list[0]?.dataset.id || '';
  selectShot(SELECTED_ID);
}
function refreshShotList(focusId) {
  DOC.shots.forEach((s, i) => { s.no = DOC.fmt === 'pe' ? String(i + 1) : two(i + 1); });   // PE 稿写「镜头1：」，旧稿写「镜头 01｜」
  const list = $('.pshots');
  list.replaceChildren(...(DOC.shots.length ? DOC.shots.flatMap((s, i) => [shotEl(s), i < DOC.shots.length - 1 ? h('button', { class: 'mini-b insert-shot', onclick: () => insertShot(i + 1) }, '＋ 在这里插入一镜') : null]).filter(Boolean) : [h('p', { class: 'empty-shots' }, '还没有镜头，从空白开始写。')]));
  if (focusId) SELECTED_ID = focusId;
  $$('.wr-ta', list).forEach(grow); updateShotControls(); touch(); paintMarks(); renderNotes();
  if (focusId) {
    const el = list.querySelector('[data-id="' + CSS.escape(focusId) + '"]');
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (el) $('.shot-title', el).focus();
  }
}
function insertShot(index, content = {}) {
  if (MODE !== '分镜') return;
  DOC = collect();
  const s = { no: '', title: '', lines: [], purpose: '', keywords: {}, sourceNo: '', ...content, id: newShotId() };
  DOC.shots.splice(index === undefined ? DOC.shots.length : index, 0, s);
  refreshShotList(s.id);
}
function moveShot(el, step) {
  DOC = collect();
  const from = DOC.shots.findIndex(s => s.id === el.dataset.id), to = from + step;
  if (from < 0 || to < 0 || to >= DOC.shots.length) return;
  DOC.shots.splice(to, 0, DOC.shots.splice(from, 1)[0]);
  refreshShotList(el.dataset.id);
}
function copyShot(el) {
  DOC = collect();
  const index = DOC.shots.findIndex(s => s.id === el.dataset.id), src = DOC.shots[index];
  if (!src) return;
  insertShot(index + 1, { title: src.title, lines: [...src.lines], purpose: src.purpose, keywords: structuredClone(src.keywords || {}) });
}
function previewDraft() {
  showEditorDialog('当前草稿预览', activeText());
}
function showEditorDialog(title, text) {
  const dialog = h('dialog', { class: 'editor-dialog' }, h('b', null, title), h('pre', null, text));
  dialog.append(h('footer', null, btn('关闭', () => dialog.close())));
  dialog.addEventListener('close', () => dialog.remove()); document.body.append(dialog); dialog.showModal();
}
function reportConflict(message) {
  CONFLICT = true; rememberDraft(); setStatus(message || '检测到其他修改，当前草稿已保留', true);
  if ($('#saveConflict')) return;
  const box = h('div', { id: 'saveConflict', class: 'save-conflict' },
    h('b', null, '这份稿在别处也改过。'), h('div', null, '当前输入保留在本页和浏览器恢复草稿中。先查看两份内容，再决定如何处理。'),
    btn('查看我的草稿', previewDraft),
    btn('查看文件内容', async () => { try { showEditorDialog('文件里的最新内容', (await FS.text(PROMPT)).text); } catch (e) { toast(e.message); } }),
    btn('以我的草稿保存', async () => {
      if (!confirm('先将文件里的最新版本归入历史记录，再保存当前页面草稿？')) return;
      try {
        const [r, state] = await Promise.all([FS.text(PROMPT), readSideState()]);
        const binding = editorSnapshot().挂图;
        LASTTEXT = r.text; MTIME = r.mtime; BASE_EDITOR = structuredClone(editorPart(state.side));
        SIDE = { ...state.side, 挂图: { ...state.side.挂图, ...binding } }; SIDE_MT = state.mtime;
        CONFLICT = false; ARCHIVED = false; box.remove(); touch(); await save();
      } catch (e) { toast(e.message); }
    }));
  $('#canvas').prepend(box);
}
async function saveEditor() {
  if (!READY || CONFLICT || RECOVERY_PENDING) return false;
  if (PULLING) { clearTimeout(ST); ST = setTimeout(save, 300); return false; }
  if (SAVE_PROMISE) { AGAIN = true; return SAVE_PROMISE; }
  SAVE_PROMISE = (async () => {
    SAVING = true;
    let ok = true;
    do {
      AGAIN = false;
      const version = VER, snapshot = editorSnapshot(), text = activeText();
      if (!dirty() && JSON.stringify(snapshot) === JSON.stringify(BASE_EDITOR)) break;
      try {
        const r = await fetch(api(PROMPT, '?draft'), { method: 'POST', headers: { ...HDR, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, baseText: LASTTEXT, sidePatch: snapshot, baseEditor: BASE_EDITOR, archive: !ARCHIVED }) });
        if (r.status === 409) { reportConflict('检测到其他修改，当前草稿已保留'); ok = false; break; }
        if (!r.ok) throw new Error((await r.text()) || String(r.status));
        const result = await r.json();
        if (!result.side || typeof result.mtime !== 'number') throw new Error('服务尚未支持新的保存方式，请更新本机服务');
        LASTTEXT = text; MTIME = result.mtime; SIDE_MT = result.sideMtime; BASE_EDITOR = structuredClone(editorPart(result.side));
        const pendingBindings = SIDE.挂图; SIDE = result.side;
        if (VER !== version) SIDE.挂图 = { ...SIDE.挂图, ...pendingBindings };
        ARCHIVED = true; SAVEDVER = version; SAVED_AT = new Date();
        if (!dirty()) { try { localStorage.removeItem(draftKey()); } catch (e) { /* 下次打开会比较内容 */ } }
        setStatus(dirty() ? '正在保存…' : savedText());
        AGAIN = AGAIN || VER !== version;
      } catch (e) { rememberDraft(); setStatus('没存上：' + e.message + '；输入已保留', true); ok = false; break; }
    } while (AGAIN && !CONFLICT);
    SAVING = false; return ok;
  })();
  try { return await SAVE_PROMISE; } finally { SAVE_PROMISE = null; }
}
async function offerRecovery() {
  let recovery;
  try { recovery = JSON.parse(localStorage.getItem(draftKey()) || 'null'); } catch (e) { return; }
  if (!recovery?.editor) return;
  if (JSON.stringify(recovery.editor) === JSON.stringify(editorSnapshot())) { localStorage.removeItem(draftKey()); return; }
  RECOVERY_PENDING = true; $('#sheet').inert = true;
  const unlock = () => { RECOVERY_PENDING = false; $('#sheet').inert = false; };
  const bar = h('div', { class: 'save-conflict' }, '发现此前未保存的浏览器草稿。',
    btn('查看恢复草稿', () => showEditorDialog('浏览器里的恢复草稿', recovery.editor.写法 === '自由' && recovery.editor.写法范围 === '分镜' ? PromptDraft.withShotText(parsePrompt(recovery.editor.分镜稿 || ''), recovery.editor.自由稿 || '') : recovery.editor.写法 === '自由' ? recovery.editor.自由稿 : recovery.editor.分镜稿)),
    btn('恢复到页面', () => {
      unlock();
      const s = recovery.editor;
      const text = s.写法 === '自由' ? s.写法范围 === '分镜' ? PromptDraft.withShotText(parsePrompt(s.分镜稿 || ''), s.自由稿 || '') : s.自由稿 || '' : s.分镜稿 || '';
      const draft = readEditorDraft(text, s);
      MODE = draft.mode; FREE = draft.free;
      DOC = hydrateShots(draft.doc, s.镜头信息, false); SIDE.挂图 = { ...SIDE.挂图, ...s.挂图 };
      render(); touch(); bar.remove();
      if (recovery.baseText !== LASTTEXT) reportConflict('恢复草稿和文件内容有差异，请核对后保存');
    }),
    btn('继续使用文件内容', () => { if (confirm('清除此浏览器恢复草稿，并继续使用文件里的内容？')) { localStorage.removeItem(draftKey()); unlock(); bar.remove(); } }));
  $('#canvas').prepend(bar);
}
