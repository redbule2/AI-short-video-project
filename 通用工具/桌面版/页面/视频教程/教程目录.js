/* 视频教程页认课、记看到哪（window.Lessons）。只算，不碰页面和文件。
   一套课：通用工具 里名字以「教程」结尾的文件夹（Codex教程、流水线教程……）。
   一节课：里面的「第N课_标题」文件夹；视频是和文件夹同名的那个，没有同名的就拿头一个视频。没有视频的节不摆。
   配套材料：这一节文件夹里的 PDF、Word、表格、幻灯片（做课时留下的截图、配音不算）。
   看到哪：{ last: 上回看的那一节, seen: { 节: { t: 看到第几秒, d: 全长几秒, done: 看完了 } } }，页面存在这台电脑的浏览器里。
   用到的：桌面版/页面/视频教程/视频教程.js。测试：node 通用工具/测试/视频教程_测试.cjs */
(function (root, factory) {
  const node = typeof module === 'object' && !!module.exports;
  const api = factory();
  if (node) module.exports = api; else root.Lessons = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const RE_LESSON = /^第\s*(\d+)\s*课(?:[_\s·.、-]+(.*))?$/;
const RE_VIDEO = /\.(mp4|m4v|webm|mov)$/i;
const RE_DOC = /\.(pdf|docx?|xlsx?|pptx?)$/i;
const DONE_LEFT = 5;   // 离结尾不到这么多秒就算看完，片尾那一下不用等
const RESUME_MIN = 3;  // 才看了这么几秒的，下回从头放

const hidden = n => /^[.~]/.test(n);   // 「~$」开头的是 Word 开着时的临时文件
const stem = n => n.replace(/\.[^.]+$/, '');
const byName = (a, b) => a.localeCompare(b, 'zh', { numeric: true });

const isCourse = name => /教程$/.test(name) && !hidden(name);
function lessonOf(dir) {
  const m = RE_LESSON.exec(dir);
  return m ? { no: Number(m[1]), title: (m[2] || '').trim() || '第 ' + Number(m[1]) + ' 课' } : null;
}
function pickVideo(dir, files) {
  const vs = files.filter(f => RE_VIDEO.test(f) && !hidden(f)).sort(byName);
  return vs.find(f => stem(f) === dir) || vs[0] || '';
}
const materials = files => files.filter(f => RE_DOC.test(f) && !hidden(f)).sort(byName);

/* 扫出来的文件夹 → 课表。raw：[{ name: 一套课的文件夹名, lessons: [{ dir: 节的文件夹名, files: [文件名] }] }] */
function build(raw) {
  return raw.filter(c => isCourse(c.name)).map(c => ({
    name: c.name,
    lessons: c.lessons.map(l => {
      const at = lessonOf(l.dir), video = at ? pickVideo(l.dir, l.files) : '';
      return video ? { id: c.name + '/' + l.dir, course: c.name, dir: l.dir, no: at.no, title: at.title, video, materials: materials(l.files) } : null;
    }).filter(Boolean).sort((a, b) => a.no - b.no || byName(a.dir, b.dir)),
  })).filter(c => c.lessons.length).sort((a, b) => byName(a.name, b.name));
}
const flat = courses => courses.flatMap(c => c.lessons);
const find = (courses, id) => flat(courses).find(l => l.id === id) || null;
function around(courses, id) {
  const all = flat(courses), i = all.findIndex(l => l.id === id);
  return { prev: i > 0 ? all[i - 1] : null, next: i >= 0 && i < all.length - 1 ? all[i + 1] : null };
}

/* ---------- 看到哪 ---------- */
const num = v => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
/* 存着的那一份读回来：认不出的当没看过 */
function fix(saved) {
  const s = saved && typeof saved === 'object' ? saved : {}, seen = {};
  if (s.seen && typeof s.seen === 'object') for (const id of Object.keys(s.seen)) {
    const v = s.seen[id];
    if (v && typeof v === 'object') seen[id] = { t: num(v.t), d: num(v.d), done: !!v.done };
  }
  return { last: typeof s.last === 'string' ? s.last : '', seen };
}
/* 这一节看到第 t 秒（全长 d 秒）；ended：放到头了。看完过的再看也还算看完 */
function mark(state, id, t, d, ended) {
  const old = state.seen[id] || { t: 0, d: 0, done: false };
  const len = num(d) || old.d, at = Math.min(num(t), len || num(t));
  const done = old.done || !!ended || (len > 0 && at >= len - DONE_LEFT);
  return { last: id, seen: { ...state.seen, [id]: { t: at, d: len, done } } };
}
/* 接着看从第几秒起：没看过、看完了、才看了几秒的都从头 */
function resumeAt(state, id) {
  const v = state.seen[id];
  if (!v || !v.d || v.t < RESUME_MIN || v.t >= v.d - DONE_LEFT) return 0;
  return v.t;
}
const isDone = (state, id) => !!(state.seen[id] && state.seen[id].done);
const doneCount = (state, lessons) => lessons.filter(l => isDone(state, l.id)).length;
const lengthOf = (state, id) => (state.seen[id] ? state.seen[id].d : 0);
/* 一打开先摆哪一节：上回看的那一节；没有就头一节没看完的；都看完了就头一节 */
function first(courses, state) {
  const all = flat(courses);
  return find(courses, state.last) || all.find(l => !isDone(state, l.id)) || all[0] || null;
}
/* 秒 → 1:05 */
function clock(sec) {
  const s = Math.floor(num(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

return Object.freeze({ isCourse, lessonOf, pickVideo, materials, build, flat, find, around, fix, mark, resumeAt, isDone, doneCount, lengthOf, first, clock, DONE_LEFT, RESUME_MIN });
});
