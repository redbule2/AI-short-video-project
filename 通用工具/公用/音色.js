/* 人物的音色（2026-11-15 加：他给童爸爸指定了音色，流水线认不出来）。
   录音都放 资产/全局资产/人物。哪段给谁用：
   · 流水线.json 人物那一行写了「音色」就照它（资产页、设定页挑的，存的是录音的路径；写成 '' 是说这个人不用音色）；
   · 没写就照文件名认：叫法_音色.wav（mp3、m4a…也行），叫法和人物表一字不差。
   一段录音只给一个人（sd25-pe：不同人物用不同的素材）：挑过的那段，别人照文件名也认不走。
   写提示词时（sd25-pe）：出场的人物有音色、这一条里他有台词，就挂成 @音频N，素材里一人一行；台词照文字，录音只给音色、口音、语速和情绪。
   用到的：流水线 资产.html、设定.html（音色绑定.js：试听、挑一段、不用）、写稿页（资产栏列出来、挂上）、本机服务 jobs.js（AI 写提示词时当能用的素材）。
   旁白（2026-11-17 他要：剧本有旁白就自动挂）：画外音，不出镜、不出图。剧本里有「旁白：」那样的台词行（narrates），资产页人物那一页自动有一张旁白卡，
     音色照上面一样认（旁白_音色.wav；挑过的记在人物表「旁白」那一行）；写提示词时这一条有旁白就挂，写明画外音、画面里的人不开口（narrRule）。
   测试：node --test 通用工具/测试/音色_测试.cjs */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Voice = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const EXTS = ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus'];
  const AUDIO_RE = new RegExp('\\.(' + EXTS.join('|') + ')$', 'i');
  const DIR = '资产/全局资产/人物';
  const TAIL = '_音色';
  const str = v => String(v == null ? '' : v).trim();
  const norm = p => str(p).replace(/\\/g, '/');
  /* 文件名（或路径、不带后缀的名字）→ 叫法：童爸爸_音色.wav、童爸爸_音色 → 童爸爸；不是音色文件给 '' */
  function whoOf(file) {
    const base = norm(file).split('/').pop();
    if (/\.[^.]+$/.test(base) && !AUDIO_RE.test(base)) return '';
    const stem = base.replace(AUDIO_RE, '');
    return stem.endsWith(TAIL) && stem.length > TAIL.length ? stem.slice(0, -TAIL.length).trim() : '';
  }
  const audios = names => (Array.isArray(names) ? names : []).map(String).filter(f => AUDIO_RE.test(f));
  /* 人物文件夹里的文件名 → Map(叫法 → 路径)，只认文件名。同一个人有几种格式的，取 wav、mp3……排前面的那个 */
  function mapOf(names) {
    const out = new Map(), rank = f => EXTS.indexOf(f.split('.').pop().toLowerCase());
    for (const f of audios(names)) {
      const who = whoOf(f);
      if (!who) continue;
      const had = out.get(who);
      if (!had || rank(f) < rank(had.split('/').pop())) out.set(who, DIR + '/' + f);
    }
    return out;
  }
  /* 人物表（流水线.json 的「人物」）＋人物文件夹里的文件名 → Map(叫法 → { path, how, want })
     how：'挑的'（行里写了、录音在）、'不在了'（行里写了、录音没了，want 是原来那段）、'不用'（行里写成 ''）、'文件名'（照叫法_音色认的）、''（没有） */
  function tableOf(rows, names) {
    const list = audios(names), auto = mapOf(list), out = new Map(), taken = new Set();
    const rs = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && str(r.名));
    for (const r of rs) {
      if (typeof r.音色 !== 'string' || out.has(str(r.名))) continue;
      const p = norm(r.音色), base = p.split('/').pop();
      if (!p) { out.set(str(r.名), { path: '', how: '不用' }); continue; }
      const ok = AUDIO_RE.test(base) && p === DIR + '/' + base && list.includes(base);
      out.set(str(r.名), ok ? { path: p, how: '挑的' } : { path: '', how: '不在了', want: p });
      if (ok) taken.add(p);
    }
    for (const r of rs) {
      const k = str(r.名);
      if (out.has(k)) continue;
      const p = auto.get(k) || '';
      out.set(k, p && !taken.has(p) ? { path: p, how: '文件名' } : { path: '', how: '' });
    }
    return out;
  }
  /* 一个叫法的音色（和 tableOf 给的一样）：人物表里没有这一行的（比如旁白），照文件名认；那段录音人物表里有人挑走了就不算 */
  function stateOf(rows, names, who) {
    const t = tableOf(rows, names), k = str(who);
    if (t.has(k)) return t.get(k);
    const p = mapOf(names).get(k) || '';
    return p && ![...t.values()].some(v => v.path === p) ? { path: p, how: '文件名' } : { path: '', how: '' };
  }
  /* 这几个人物里有音色的：[{ 名, path }]，照给的先后。rows 不给就只照文件名认 */
  function ofPeople(people, names, rows) {
    const seen = new Set(), out = [];
    for (const n of Array.isArray(people) ? people : []) {
      const k = str(n);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const p = stateOf(rows, names, k).path;
      if (p) out.push({ 名: k, path: p });
    }
    return out;
  }
  /* 这段录音（项目里的路径）是谁的音色：人物表里挑了它、或照文件名认到的那个人；人物表里没有这个叫法的，照文件名认 */
  function ownerOf(file, rows, names) {
    const p = norm(file), t = tableOf(rows, names);
    for (const [k, v] of t) if (v.path && v.path === p) return k;
    const who = whoOf(p);
    return who && !t.has(who) && p === DIR + '/' + p.split('/').pop() ? who : '';
  }
  /* 旁白（11-17）：剧本里有说话的是「旁白」的台词行（旁白：……、旁白（画外）：……），就算这一段有旁白 */
  const NARRATOR = '旁白';
  const NARR_RE = /^[ \t　]*旁白[ \t　]*(?:[（(][^）)\n]{0,12}[）)])?[ \t　]*[：:]/m;
  const narrates = text => NARR_RE.test(String(text == null ? '' : text));
  /* 素材里那一句（写法一、写法二一样）。sd25-pe：@音频1用于<人物>的<音色……>；台词以文字为准，录音默认只给音色、口音、语速和情绪 */
  const line = (name, ref) => ref + '用于' + (str(name) === NARRATOR ? '画外旁白' : str(name) || '〔称谓〕') + '的音色、口音、语速和情绪，台词以事件脚本为准。';
  /* 写提示词时交代旁白的那几句。path：旁白那段录音；after：前面还有人物的音色（旁白接着编号） */
  const narrRule = (path, after) => {
    const ref = after ? '@音频N' : '@音频1';
    return '旁白是画外音、不出镜（「能用的」里写着「旁白」的那一行）：这一条里有旁白就挂这段录音，' + (after ? '和人物的音色接着编号（@音频N）' : '挂成 @音频1') + '，素材里一行「' + line(NARRATOR, ref)
      + '」（写法二放【动作与声音】），【素材登记】里也登记（{"ref": "' + ref + '", "name": "旁白", "path": "' + norm(path) + '"}）。事件脚本里旁白那一句写成「旁白：{台词}」，台词照剧本；画面里的人自然闭口。';
  };
  return Object.freeze({ AUDIO_RE, DIR, TAIL, NARRATOR, whoOf, mapOf, tableOf, stateOf, ofPeople, ownerOf, narrates, line, narrRule });
});
