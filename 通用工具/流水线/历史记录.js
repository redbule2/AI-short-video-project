/* ============================================================
   流水线 · 历史记录（window.HistView）：提示词、审片、资产三页的「历史记录」筛选（2026-11-19 他要的）。
   默认不摆历史记录里的东西；点顶上「历史记录」只看历史记录里的，再点一下回来（不记住：换一页、刷新就回到不看）。
   只看、不改、不挪：
     提示词：历史记录/提示词/第N段 里收进去的视频提示词（改版、删掉时收进去的，原名__时间.txt）。点「看」看字，@图片 能点开，
       认图照那一版自己的登记：同一时间收进去的写稿资料里的挂图 → 参考素材映射（现在的、历史记录/资产 里留的底）里字正好对得上的那一份
       → 都没有，照现在同名那一条的登记（标出来：可能不是那时候挂的）。还能和现在那一版比。
     审片：历史记录/成片/第N段 里的样片（审完没选上的，名字不改）。点开在审片台对照看、写批注，批注存在它旁边（审片台.html?old=1）。
     资产：这一页签里各样的旧图（历史记录/同样的文件夹/图名__时间.png，换下来的候选图也算）；关键帧页签是 历史记录/资产/关键帧/第N段 里的图。
   名字怎么认在 公用/历史记录.js（Hist）。要先引 流水线.js、公用/历史记录.js。
   ============================================================ */
(function () {
'use strict';
const HV = { on: false, cache: new Map(), refs: new Map(), maps: null, mapsOf: '', seq: 0, ready: null };
const IMG = /\.(png|jpe?g|webp|gif|avif|bmp)$/i, VID = /\.(mp4|m4v|mov|webm)$/i, Core = window.Core;
const dirOfFile = f => f.split('/').slice(0, -1).join('/');
const fileName = f => f.split('/').pop();
const textOf = async rel => C.decodeText((await FS.read(at([F.name, ...rel.split('/')]))).buf).text;

/* ---------- 读：一样东西读一回，读好了叫页面重画（HistView.ready） ---------- */
function get(kind, s, load) {
  const k = kind + '|' + F.name + '|' + s.段;
  let c = HV.cache.get(k);
  if (!c) {
    c = { items: null, err: '' };
    HV.cache.set(k, c);
    load().then(v => { c.items = v; }, e => { c.items = []; c.err = e && e.message || String(e); }).then(() => { if (HV.ready) HV.ready(); });
  }
  return c;
}
/* 文件夹里变了（页面的 sides 来了）：下回重读 */
const drop = () => { HV.cache.clear(); HV.maps = null; };

/* ---------- 提示词 ---------- */
function prompts(s) {
  return get('prompt', s, async () => {
    const dir = '历史记录/提示词/' + segName(s.段), ls = lister(F.name), out = [];
    for (const e of await ls(dir)) {
      if (e.kind !== 'file') continue;
      const p = Hist.parse(e.name);
      if (!Core.RE_VP.test(p.orig)) continue;
      out.push({ ...p, file: dir + '/' + e.name, mtime: e.mtime || 0, key: Core.vpBase(nowName(s.段, p.orig)), label: Core.vpLabel(p.orig) });   // 改过名的（写稿页里加减镜头）：旧名字留的底也归到现在这一条
    }
    return out.sort(Hist.newer);
  });
}
/* 几份参考素材映射：现在的在前，历史记录/资产 里留的底从新到旧（一个项目读一回） */
/* 这一版挂的图：{ refs: [{ ref, path, sha }], note }（认法在 公用/历史记录.js，写稿页「参考」同一套）；几份映射一个项目读一回 */
const io = () => { const name = F.name; return { readJson: rel => readJson(at([name, ...rel.split('/')])), list: rel => lister(name)(rel) }; };
async function refsFor(s, it, text) {
  if (!HV.maps || HV.mapsOf !== F.name) { HV.maps = await Hist.mapsOf(io()); HV.mapsOf = F.name; }
  return Hist.refsFor(io(), HV.maps, { ...it, seg: s.段 }, text);
}
/* 现在这一条（同一个原稿名）摆的那一版 */
const nowOf = (s, it) => { const e = promptsOf(s.段).find(x => x.key === it.key); return e ? e.name : ''; };
async function viewPrompt(s, it) {
  let text, R;
  try { text = await textOf(it.file); R = await refsFor(s, it, text); } catch (e) { toast('读不了：' + e.message, 'err'); return; }
  const id = 'h' + (++HV.seq), cur = nowOf(s, it);
  HV.refs.set(id, R.refs);
  const sub = it.file + (it.when ? '（' + it.when + ' 收进去的）' : '');
  await dialog(close => {
    const el = dlgShell(it.label + ' · 历史记录里的一版', sub, [
      R.note ? h('p', { class: 'fn-note warn', style: 'margin:0 0 8px' }, R.note) : null,
      h('pre', { class: 'mdview', 'data-hist-refs': id }, text)],
    [cur ? h('button', { class: 'btn ghost', type: 'button', title: '一行一行比：删的划掉，加的标绿', onclick: () => { close(); diffNow(s, it, text, cur); } }, '和现在的「' + vpLabel(cur) + '」比') : null,
      h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close() }, '看完了')]);
    el.classList.add('wide');
    return el;
  });
  HV.refs.delete(id);
}
async function diffNow(s, it, text, cur) {
  let tb;
  try { tb = await textOf('提示词/' + segName(s.段) + '/' + cur); } catch (e) { toast('读不了：' + e.message, 'err'); return; }
  await dialog(close => { const el = dlgShell('历史记录里的一版 → 现在 · ' + it.label + ' → ' + vpLabel(cur), it.name + ' → ' + cur, [window.Diff.view(text, tb, h)], [h('button', { class: 'btn ink', 'data-focus': '', onclick: () => close() }, '看完了')]); el.classList.add('wide'); return el; });
}
/* 提示词那一页：历史记录里的一条一行，同一条（原稿名）的几版挨着，新的在前 */
function promptView(s, c) {
  if (!c.items) return h('p', { class: 'fn-note wf-none' }, '正在看历史记录…');
  if (c.err) return h('p', { class: 'fn-note wf-none warn' }, '历史记录读不了：' + c.err);
  if (!c.items.length) return h('p', { class: 'fn-note wf-none' }, '这一段的历史记录里没有视频提示词。');
  const order = [...new Set(c.items.map(x => x.key))].sort(Core.vpSort), rows = [];
  for (const k of order) {
    const vers = c.items.filter(x => x.key === k), cur = nowOf(s, vers[0]);
    rows.push(h('div', { class: 'hist-fam' }, h('b', null, Core.vpLabel(k)), h('span', { class: 'faint small' }, cur ? '现在用的是「' + vpLabel(cur) + '」' : '这一条现在没有了')));
    for (const it of vers) rows.push(h('div', { class: 'wf-item hist', 'data-hist': it.file },
      h('div', { class: 'wf-item-h' }, h('b', null, it.label), h('span', { class: 'faint small' }, it.name), it.when ? h('span', { class: 'fs-state', title: '收进历史记录的时间' }, it.when) : null, h('span', { class: 'sp' }),
        h('button', { class: 'btn sm ink', type: 'button', title: '看这一版的字；@图片 点一下看那时候挂的图', onclick: () => viewPrompt(s, it) }, '看'),
        cur ? h('button', { class: 'fl-link', type: 'button', title: '一行一行比：删的划掉，加的标绿', onclick: async () => { try { diffNow(s, it, await textOf(it.file), cur); } catch (e) { toast('读不了：' + e.message, 'err'); } } }, '和现在的比') : null)));
  }
  return [h('p', { class: 'fn-note wf-hist-note' }, '历史记录里的 ' + c.items.length + ' 版：改版、删掉时收进去的。只看不改；要写新的，在写稿页点「参考」把它摆在旁边。'), h('div', { class: 'wf-items' }, rows)];
}
/* 字里的 @图片N（公用/点图.js）：在历史记录的一版里的，照那一版挂的图认；不在里面给 undefined，页面照自己的认 */
function refAt(ref, el) {
  const box = el && el.closest && el.closest('[data-hist-refs]');
  if (!box) return undefined;
  const r = (HV.refs.get(box.dataset.histRefs) || []).find(x => x.ref === ref);
  if (!r || !IMG.test(r.path)) return null;
  const label = ref + ' · ' + fileName(r.path).replace(/\.[^.]+$/, ''), type = f => 'image/' + (/\.jpe?g$/i.test(f) ? 'jpeg' : f.split('.').pop().toLowerCase());
  return { tip: label + '　点开看大图', open: async () => {
    let g;
    try { g = await RefFile.find(FS, at([F.name]), r.path, r.sha); } catch (err) { RefPic.show(Promise.reject(err), label, r.path); return; }
    RefPic.show(Promise.resolve(URL.createObjectURL(new Blob([g.bytes], { type: type(g.file) }))), label, g.old ? RefFile.note(g) + '：' + g.file : r.path);
  } };
}

/* ---------- 审片 ---------- */
function clips(s) {
  return get('clip', s, async () => {
    const dir = '历史记录/成片/' + segName(s.段), ents = await lister(F.name)(dir), names = new Set(ents.map(e => e.name));
    return ents.filter(e => e.kind === 'file' && VID.test(e.name)).map(e => ({ ...Hist.parse(e.name), file: dir + '/' + e.name, mtime: e.mtime || 0, noted: names.has(stemOf(e.name) + '_批注.md') })).sort(Hist.newer);
  });
}
/* 审片那一页：一条样片一张卡。open(vid)：在审片台打开；label(vid)：它是哪一条提示词出的（认不出给 ''） */
function clipView(s, c, open, label) {
  if (!c.items) return h('p', { class: 'fn-note wf-none' }, '正在看历史记录…');
  if (c.err) return h('p', { class: 'fn-note wf-none warn' }, '历史记录读不了：' + c.err);
  if (!c.items.length) return h('p', { class: 'fn-note wf-none' }, '这一段的历史记录里没有样片。');
  const day = t => { const d = new Date(t); return two(d.getMonth() + 1) + '-' + two(d.getDate()); };
  return [h('p', { class: 'fn-note wf-hist-note' }, '历史记录里的 ' + c.items.length + ' 条样片：审完没选上的。点开对照看、写批注，批注存在它旁边；不在这里选定、不挪。'),
    h('div', { class: 'wf-items' }, c.items.map(it => {
      const lb = label(it.name);
      return h('div', { class: 'wf-item hist', 'data-vid': it.name, 'data-old': '1' },
        h('div', { class: 'wf-item-h' }, h('b', null, stemOf(it.name)), lb ? h('span', { class: 'fs-state', title: '照名字认的：这条是哪一条提示词出的' }, '出自 ' + lb) : null,
          it.noted ? h('span', { class: 'fs-state', title: '这条写过批注' }, '有批注') : null,
          h('span', { class: 'faint small', title: it.when ? '收进历史记录的时间' : '文件的修改时间' }, it.when || (it.mtime ? day(it.mtime) : '')), h('span', { class: 'sp' }),
          h('button', { class: 'btn sm ink', type: 'button', title: '看样片，旁边对照提示词、白模、关键帧和资产图；停在哪一帧就在哪一帧写批注', onclick: () => open(it.name) }, icon('play'), '对照看片、写批注')));
    }))];
}

/* ---------- 资产 ---------- */
/* 这一页签各样的旧图：[{ title, cur, olds: [{ file, name, when }] }]；关键帧页签是这一段文件夹收进去的图，一个文件夹一组 */
function assets(s, k, items) {
  return get('asset:' + k, s, async () => {
    const ls = lister(F.name), groups = [];
    if (k === '关键帧') {
      const base = '历史记录/' + AP.segDir(s.段), walk = async (dir, depth) => {
        const ents = await ls(dir), olds = ents.filter(e => e.kind === 'file' && IMG.test(e.name)).map(e => ({ ...Hist.parse(e.name), file: dir + '/' + e.name, mtime: e.mtime || 0 })).sort(Hist.newer);
        if (olds.length) groups.push({ title: dir === base ? segName(s.段) + ' 文件夹' : dir.slice(base.length + 1), cur: '', olds });
        if (depth < 2) for (const d of ents.filter(e => e.kind === 'directory')) await walk(dir + '/' + d.name, depth + 1);
      };
      await walk(base, 0);
      return groups;
    }
    const seen = new Set();
    for (const it of items) {
      const p = String(it.at || it.文件 || '');
      if (!IMG.test(p) || seen.has(p)) continue;
      seen.add(p);
      const name = fileName(p), dot = name.lastIndexOf('.'), stem = name.slice(0, dot), ext = name.slice(dot).toLowerCase();
      const olds = (await ls('历史记录/' + dirOfFile(p))).filter(e => e.kind === 'file' && IMG.test(e.name)).map(e => ({ ...Hist.parse(e.name), file: '历史记录/' + dirOfFile(p) + '/' + e.name, mtime: e.mtime || 0 }))
        .filter(x => { const o = x.orig.toLowerCase(); return o === name.toLowerCase() || o === (stem + '_候选' + ext).toLowerCase(); }).sort(Hist.newer);
      if (olds.length) groups.push({ title: it.名称 + (it.sub ? ' · ' + it.sub : ''), cur: it.at && IMG.test(it.at) ? it.at : '', olds });
    }
    return groups;
  });
}
const count = c => !c.items ? null : c.items.reduce((n, x) => n + (Array.isArray(x.olds) ? x.olds.length : 1), 0);
function assetView(s, k, c) {
  if (!c.items) return h('p', { class: 'fn-note wf-none' }, '正在看历史记录…');
  if (c.err) return h('p', { class: 'fn-note wf-none warn' }, '历史记录读不了：' + c.err);
  if (!c.items.length) return h('p', { class: 'fn-note wf-none' }, k === '关键帧' ? '这一段文件夹的历史记录里没有图。' : '这一页签里的' + k + '，历史记录里没有旧图。');
  const tile = (file, name, tag, cls) => { const el = h('div', { class: 'hist-tile' + (cls ? ' ' + cls : ''), role: 'button', tabindex: '0', title: file + '\n点开看大图', onclick: () => openImage(file), onkeydown: ev => { if (ev.key === 'Enter') openImage(file); } },
    h('div', { class: 'hist-im' }, thumbImg(file, 300)), h('div', { class: 'hist-nm' }, name), tag ? h('small', null, tag) : null); hoverable(el, file, name); return el; };
  return [h('p', { class: 'as-hint' }, k === '关键帧' ? '这一段文件夹收进历史记录的图（换下来的关键帧、底图、对照图），新的在前。只看不改。' : '这一页签里各样换下来的旧图，新的在前；最前面一张是现在用的。只看不改。'),
    ...c.items.map(g => h('div', { class: 'hist-group' }, h('div', { class: 'hist-fam' }, h('b', null, g.title), h('span', { class: 'faint small' }, g.olds.length + ' 张')),
      h('div', { class: 'hist-grid' }, g.cur ? tile(g.cur, '现在用的', baseOf(g.cur), 'now') : null, ...g.olds.map(x => tile(x.file, x.orig.replace(/\.[^.]+$/, ''), x.when ? x.when + ' 收进去' : '', '')))))];
}

/* ---------- 顶上那个开关 ---------- */
function chip(n, onToggle, what) {
  return h('button', { class: 'chip wf-hist' + (HV.on ? ' on' : ''), type: 'button', 'aria-pressed': String(HV.on),
      title: HV.on ? '回到现在的' + what : '只看收进历史记录的' + what + '（默认不摆）。只看、不改',
      onclick: () => { HV.on = !HV.on; if (HV.on) drop(); onToggle(); } },   // 每回打开都现读一遍
    icon('clock'), '历史记录', n == null ? '' : ' ' + n);
}

if (window.RefPic && RefPic.also) RefPic.also(refAt);   // 历史记录里那一版的 @图片N：先问这里，不在里面的照页面自己的认
window.HistView = {
  get on() { return HV.on; }, set on(v) { HV.on = !!v; },
  set ready(fn) { HV.ready = fn; },
  drop, chip, count, prompts, promptView, clips, clipView, assets, assetView,
};
})();
