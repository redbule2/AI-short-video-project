/* ============================================================
   公用 · 说明页（流水线里那几张设计稿、流程图共用：照方案改_说明、局部替换_说明、文生资产_流程图）
   页面只写内容：window.DOC = { 名, 题, 存, 轮, 副题, 脚注, 先选, 段 }，再引 底座.js、界面.js 和这个文件。
     名：批注存成 通用工具/流水线/<名>_批注.json（本机服务）；存：浏览器里留一份用的键（后面自动加 :r轮）
     段：[{ h: 标题, note: 小字, fig: 页面里 <template> 或元素的 id（图、示例）, cards: [{ id, no, t, p: [段落], opts: [{ v, t, rec }] }] }]
   卡片、单选、批注框照 段 摆出来；选的、写的自动存；「复制批注」拼成一段字贴回对话。
   ============================================================ */
(function () {
'use strict';
const { h } = window.UI, { FS, nowText } = window.Base;
const D = window.DOC;
const FILE = ['通用工具', '流水线', D.名 + '_批注.json'];
const LS = D.存 + ':r' + D.轮;
let S = { 轮: D.轮, 时间: '', 批注: {}, 选择: { ...(D.先选 || {}) }, 其他: '' };
const $ = s => document.querySelector(s);
const cards = () => D.段.flatMap(s => s.cards || []);
const mark = t => t.classList.toggle('has', !!t.value.trim());

function cardEl(c) {
  return h('div', { class: 'card' },
    h('h3', null, c.no ? h('span', { class: 'no' }, c.no) : null, c.t),
    c.p.map(x => h('p', null, x)),
    c.opts ? h('div', { class: 'opts' }, c.opts.map(o => h('label', null, h('input', { type: 'radio', name: c.id, value: o.v }), o.v + '　' + o.t, o.rec ? h('span', { class: 'rec' }, '（推荐）') : null))) : null,
    h('textarea', { 'data-k': c.id, placeholder: '批注（可以不写）' }));
}
/* 图、示例：页面里的 <template> 拿里面那一份，别的元素拿它的子元素，都复制一份摆上 */
function figEl(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  return el.content ? el.content.cloneNode(true) : [...el.childNodes].map(n => n.cloneNode(true));
}
function paint() {
  $('#sub').textContent = D.副题;
  $('#foot').textContent = D.脚注;
  $('#sections').replaceChildren(...D.段.flatMap(s => [h('h2', null, s.h), s.note ? h('p', { class: 'sub' }, s.note) : null, s.fig ? figEl(s.fig) : null, ...(s.cards || []).map(cardEl)].flat().filter(Boolean)));
  document.querySelectorAll('textarea').forEach(t => {
    const k = t.dataset.k; t.value = (k === '其他' ? S.其他 : S.批注[k]) || ''; mark(t);
    t.addEventListener('input', () => { if (k === '其他') S.其他 = t.value; else S.批注[k] = t.value; mark(t); changed(); });
  });
  document.querySelectorAll('.opts input').forEach(r => {
    if (S.选择[r.name] === r.value) r.checked = true;
    r.addEventListener('change', () => { S.选择[r.name] = r.value; changed(); });
  });
}
let timer = 0;
function changed() {
  S.时间 = nowText();
  try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { /* 存不了就算了 */ }
  clearTimeout(timer); timer = setTimeout(save, 700);
  $('#st').textContent = '正在存…';
}
async function save() {
  try {
    await FS.write(FILE, JSON.stringify(S, null, 2) + '\n');
    $('#st').textContent = '已存好（' + S.时间.slice(11, 16) + '）。批完回到对话说一声「批完了」';
  } catch (e) { $('#st').textContent = '没连上本机服务，只存在这个浏览器里。批完点「复制批注」贴给我'; }
}
async function load() {
  try { const t = JSON.parse(new TextDecoder().decode((await FS.read(FILE)).buf)); if (t && t.轮 === D.轮) S = Object.assign(S, t); } catch (e) { /* 没有就是还没批 */ }
  try { const t = JSON.parse(localStorage.getItem(LS) || 'null'); if (t && t.轮 === D.轮 && (t.时间 || '') > (S.时间 || '')) S = Object.assign(S, t); } catch (e) { /* 不管 */ }
  paint();
}
function text() {
  const out = [D.题 + ' · 第 ' + D.轮 + ' 轮批注（' + (S.时间 || nowText()) + '）'];
  for (const c of cards()) {
    const n = (S.批注[c.id] || '').trim(), v = S.选择[c.id];
    if (!n && !v) continue;
    const o = v && c.opts ? c.opts.find(x => x.v === v) : null;
    out.push((c.no + ' ' + c.t).trim() + (v ? '　选了 ' + v + (o ? '：' + o.t : '') : '') + (n ? '\n　' + n.replace(/\n/g, '\n　') : ''));
  }
  if ((S.其他 || '').trim()) out.push('其他意见：' + S.其他.trim());
  return out.join('\n');
}
$('#copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(text()); $('#st').textContent = '复制好了，贴到对话里就行'; }
  catch (e) { prompt('复制下面这段：', text()); }
});

load();
})();
