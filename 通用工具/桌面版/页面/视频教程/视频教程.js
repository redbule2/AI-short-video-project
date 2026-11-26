/* 视频教程页：左边课表，右边放片。
   课在本机：通用工具 里的「…教程」文件夹（怎么认见 教程目录.js），经本机服务读——和流水线放样片同一条路：整份取来再放，进度条随便拖。
   看到哪记在这台电脑的浏览器里；切到别的页（这一页藏起来）自己停。 */
(function () {
'use strict';
const { LINK, FS, store } = window.Base;
const { h, icon, toast } = window.UI;
const L = window.Lessons;
const HOME = ['通用工具'];   // 一套套课放在这里面
const KEY = 'antou:tutorial:seen';
const SAVE_MS = 3000;       // 放着的时候隔这么久记一回看到哪
const $ = id => document.getElementById(id);

let courses = [];
let state = L.fix(readSaved());
let cur = null;      // 右边摆着的那一课
let url = '';        // 正放着的那一份，用完要还
let ticket = 0;      // 取片要等：等回来时人已经点了别的课，这一份就不要了
let savedAt = 0;
const rows = new Map();    // 课 → 课表里它那一行
const heads = new Map();   // 一套课 → 标题上的「看完 x / y」

function readSaved() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
const save = () => store(KEY, JSON.stringify(state));
const partsOf = (l, name) => [...HOME, l.course, l.dir, name];

const video = h('video', { controls: true, playsinline: true, preload: 'auto' });
const cover = h('div', { class: 'vt-cover' });
const info = h('div', { class: 'vt-info' });
const list = h('nav', { class: 'vt-list' });
const view = h('section', { class: 'vt-view' }, h('div', { class: 'vt-col' }, h('div', { class: 'vt-stage' }, video, cover), info));
const main = $('vt-main');

/* ---------- 找课：通用工具 → 一套套课 → 一课课 → 里面的文件。哪一层读不出来就当它是空的 ---------- */
const names = (ents, kind) => ents.filter(e => e.kind === kind).map(e => e.name);
async function scan() {
  const tops = names(await FS.list(HOME), 'directory').filter(L.isCourse);
  return L.build(await Promise.all(tops.map(async name => {
    const dirs = names(await FS.list([...HOME, name]).catch(() => []), 'directory').filter(L.lessonOf);
    return { name, lessons: await Promise.all(dirs.map(async dir => ({ dir, files: names(await FS.list([...HOME, name, dir]).catch(() => []), 'file') }))) };
  })));
}

/* ---------- 记看到哪 ---------- */
function note(ended) {
  if (!cur || !url || !video.duration) return;   // 没在放的不记
  state = L.mark(state, cur.id, video.currentTime, video.duration, ended);
  save();
  savedAt = Date.now();
  syncRow(cur.id);
}
function drop() {
  video.onloadedmetadata = video.onerror = null;
  video.pause();
  if (!url) return;
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(url);
  url = '';
}

/* ---------- 盖在片子上的一层 ---------- */
function setCover(kind, why) {
  cover.hidden = kind === 'off';
  if (kind === 'off') return cover.replaceChildren();
  if (kind === 'loading') return cover.replaceChildren(h('p', { class: 'vt-say' }, '正在打开…'));
  if (kind === 'error') return cover.replaceChildren(h('p', { class: 'vt-say' }, '打不开这一课：' + why), h('button', { type: 'button', class: 'btn', onclick: () => play() }, '再试一次'));
  if (kind === 'ended') {
    const { next } = L.around(courses, cur.id);
    return cover.replaceChildren(h('p', { class: 'vt-say' }, '这一课看完了'), h('div', { class: 'acts' },
      h('button', { type: 'button', class: 'btn', onclick: () => play(0) }, '再看一遍'),
      next ? h('button', { type: 'button', class: 'btn zhu', onclick: () => go(next) }, '下一课：' + next.title) : null));
  }
  const at = L.resumeAt(state, cur.id);   // start：还没点开
  cover.replaceChildren(
    h('button', { type: 'button', class: 'vt-go', title: '开始看', onclick: () => play() }, icon('play')),
    h('p', { class: 'vt-say' }, at ? '接着看（上回看到 ' + L.clock(at) + '）' : L.isDone(state, cur.id) ? '看过了，再看一遍' : '开始看'));
}

/* ---------- 放片 ---------- */
/* from：从第几秒起；不写就接着上回 */
async function play(from) {
  const l = cur, my = ++ticket;
  if (!l) return;
  drop();
  setCover('loading');
  try {
    const file = await FS.file(partsOf(l, l.video));
    if (my !== ticket) return;
    url = URL.createObjectURL(file);
    await new Promise((ok, bad) => {
      video.onloadedmetadata = ok;
      video.onerror = () => bad(new Error('这个视频放不了'));
      video.src = url;
    });
    if (my !== ticket) return;
    const at = from != null ? from : L.resumeAt(state, l.id);
    if (at) video.currentTime = at;
    setCover('off');
    note(false);   // 一点开就记下全长，课表上跟着显示
    video.play().catch(() => {});   // 不让自己放的时候就停在那儿，人点一下就放
  } catch (e) {
    if (my === ticket) setCover('error', e.message || String(e));
  }
}
/* 右边换成这一课：先不取片，等人点「开始看」 */
function show(l) {
  note(false);
  ticket++;
  drop();
  cur = l;
  state = { ...state, last: l.id };
  save();
  for (const [id, row] of rows) row.classList.toggle('on', id === l.id);
  drawInfo();
  setCover('start');
  const row = rows.get(l.id);
  if (row) row.scrollIntoView({ block: 'nearest' });
}
const go = l => { show(l); play(); };

video.addEventListener('timeupdate', () => { if (Date.now() - savedAt >= SAVE_MS) note(false); });
video.addEventListener('pause', () => note(false));
video.addEventListener('ended', () => { note(true); setCover('ended'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) video.pause(); });
window.addEventListener('pagehide', () => note(false));

/* ---------- 画 ---------- */
function syncRow(id) {
  const row = rows.get(id), l = L.find(courses, id);
  if (!row || !l) return;
  const done = L.isDone(state, id), len = L.lengthOf(state, id), no = row.querySelector('.vt-no');
  if (row.classList.contains('done') !== done || !no.firstChild) { row.classList.toggle('done', done); no.replaceChildren(done ? icon('check') : String(l.no)); }
  row.querySelector('.vt-dur').textContent = len ? L.clock(len) : '';
  const c = courses.find(x => x.name === l.course);
  heads.get(l.course).textContent = '看完 ' + L.doneCount(state, c.lessons) + ' / ' + c.lessons.length;
  drawSum();
}
function drawSum() {
  const all = L.flat(courses), sum = $('vt-sum');
  sum.hidden = !all.length;
  sum.textContent = courses.length + ' 套 · ' + all.length + ' 课 · 看完 ' + L.doneCount(state, all) + ' 课';
}
function drawList() {
  rows.clear();
  heads.clear();
  list.replaceChildren(...courses.map(c => {
    const seen = h('span', { class: 'vt-seen' });
    heads.set(c.name, seen);
    return h('section', { class: 'vt-course' }, h('h2', null, h('span', null, c.name), seen), c.lessons.map(l => {
      const row = h('button', { type: 'button', class: 'vt-row', title: l.title, 'data-id': l.id, onclick: () => go(l) },
        h('span', { class: 'vt-no' }), h('span', { class: 'vt-name' }, l.title), h('span', { class: 'vt-dur' }));
      rows.set(l.id, row);
      return row;
    }));
  }));
  for (const l of L.flat(courses)) syncRow(l.id);
}
const reveal = (parts, name, say) => LINK.req('POST', LINK.url(parts) + '?reveal').then(() => toast(say || '在资源管理器里选中了「' + name + '」'), e => toast('打不开文件夹：' + e.message, 'err'));
function drawInfo() {
  const l = cur, { prev, next } = L.around(courses, l.id);
  info.replaceChildren(
    h('div', { class: 'vt-head' },
      h('div', null, h('p', { class: 'vt-lead' }, l.course + ' · 第 ' + l.no + ' 课'), h('h2', { class: 'vt-h' }, l.title)),
      h('div', { class: 'vt-nav' },
        h('button', { type: 'button', class: 'btn sm', disabled: !prev, title: prev ? prev.title : '', onclick: () => prev && go(prev) }, icon('chevL'), '上一课'),
        h('button', { type: 'button', class: 'btn sm', disabled: !next, title: next ? next.title : '', onclick: () => next && go(next) }, '下一课', icon('chev')))),
    l.materials.length ? h('div', { class: 'vt-mats' }, h('h3', null, '配套材料'), l.materials.map(name =>
      h('div', { class: 'vt-mat' }, icon('doc'), h('span', { title: name }, name),
        h('button', { type: 'button', class: 'btn sm ghost', onclick: () => reveal(partsOf(l, name), name) }, '在文件夹里找到它')))) : null);
}
/* 一课都没有：告诉人课该放哪 */
function drawEmpty(title, say) {
  $('vt-sum').hidden = true;
  main.replaceChildren(h('div', { class: 'welcome' }, h('div', { class: 'w-inner' },
    h('p', { class: 'w-title sm' }, title),
    h('p', { class: 'w-note' }, say),
    h('div', { class: 'acts' },
      LINK.on ? h('button', { type: 'button', class: 'btn', onclick: () => reveal(HOME, '通用工具', '在资源管理器里选中了「通用工具」：双击进去，把教程文件夹放在里面') }, icon('folderOpen'), '打开放教程的地方') : null,
      h('button', { type: 'button', class: 'btn ink', onclick: load }, icon('refresh'), '重新找一遍')))));
}

/* ---------- 开头、重新找一遍 ---------- */
async function load() {
  const btn = $('vt-rescan');
  btn.disabled = true;
  let found = null, why = '';
  try {
    if (LINK.on || await LINK.up()) found = await scan();
  } catch (e) { why = e.message || String(e); }
  btn.disabled = false;
  if (!found || !found.length) {
    note(false);
    ticket++;
    drop();
    cur = null;
    courses = [];
    if (!LINK.on) return drawEmpty('本机服务没开', '教程是经本机服务读的。从软件里打开这一页，或者先把流水线开起来。');
    return drawEmpty(why ? '找教程时出错了' : '这台电脑上还没有教程', why || '把拿到的教程文件夹（比如「Codex教程」）放进工作文件夹的「通用工具」里，再点「重新找一遍」。');
  }
  courses = found;
  const top = list.scrollTop;
  if (list.parentNode !== main) main.replaceChildren(list, view);   // 已经摆着的不重摆：重摆会把正放着的片子停掉
  drawList();
  list.scrollTop = top;
  const keep = cur && L.find(courses, cur.id);
  if (!keep) return show(L.first(courses, state));
  cur = keep;   // 正看着的那一课还在：不打断，只把课表和下面的字换新
  rows.get(keep.id).classList.add('on');
  drawInfo();
}

$('vt-rescan').addEventListener('click', load);
load();
})();
