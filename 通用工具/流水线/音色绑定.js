/* 人物的音色：试听、挑一段、不用（11-15 加，资产页、设定页共用）。
   录音放 资产/人物和道具；挑了哪段记在流水线.json 人物那一行的「音色」（'' 是不用），没挑照文件名「叫法_音色.wav」认。认法在 公用/音色.js。
   要先引 公用/音色.js、流水线.js。
   VoiceBind.line(名, paint)：资产页人物卡底下那一行。VoiceBind.buttons(名, paint)：设定页人物那一行的按钮。VoiceBind.reset()：录音可能变了，下回重列 */
const VoiceBind = (() => {
  let NAMES = [], PJ = '', AT = 0, BUSY = null, PLAY = null;
  const stem = p => String(p || '').split('/').pop().replace(Voice.AUDIO_RE, '');
  async function listNow() {   // 人物文件夹里的录音（文件名）：列完记在 NAMES，给回有没有变；列不出来给 null
    const pj = F.name, ls = lister(pj), ents = await ls(Voice.DIR);
    if (ls.failed || pj !== F.name) return null;
    const next = ents.filter(e => e.kind === 'file' && Voice.AUDIO_RE.test(e.name)).map(e => e.name).sort(byZh);
    const same = PJ === pj && NAMES.join('|') === next.join('|');
    PJ = pj; AT = Date.now(); NAMES = next;
    return { changed: !same };
  }
  /* 画的时候顺手看一眼录音有没有变：变了就再画一遍。5 秒以内不重列 */
  function load(paint) {
    if (BUSY || (PJ === F.name && Date.now() - AT < 5000)) return;
    BUSY = listNow().then(r => { if (r && r.changed) paint(); }).catch(() => {}).finally(() => { BUSY = null; });
  }
  const reset = () => { AT = 0; };
  const table = () => Voice.tableOf(F.doc.人物, PJ === F.name ? NAMES : []);
  const stateOf = name => Voice.stateOf(F.doc.人物, PJ === F.name ? NAMES : [], name);   // 人物表里没有这一行的（旁白）照文件名认
  /* 试听：点一下放，再点停；放着别的就先停。页面重画过，按钮是新的：照 data-f 找 */
  const mark = f => { for (const x of document.querySelectorAll('.vb-play')) x.classList.toggle('on', !!f && x.dataset.f === f); };
  function stop() { if (!PLAY) return; PLAY.a.pause(); URL.revokeObjectURL(PLAY.a.src); PLAY = null; mark(''); }
  async function toggle(path) {
    const was = PLAY && PLAY.f;
    stop();
    if (was === path) return;
    try {
      const a = new Audio(URL.createObjectURL(await FS.file(at([F.name, ...path.split('/')]))));
      PLAY = { f: path, a }; mark(path);
      a.onended = () => { if (PLAY && PLAY.a === a) stop(); };
      await a.play();
    } catch (err) { stop(); toast('放不了：' + err.message, 'err'); }
  }
  const playBtn = (path, label, cls) => h('button', { class: 'vb-play ' + (cls || '') + (PLAY && PLAY.f === path ? ' on' : ''), type: 'button', 'data-f': path,
    title: stem(path) + '\n点一下试听，再点停', onclick: e => { e.stopPropagation(); toggle(path); } }, label);
  function set(name, path, paint) {
    let e = entryOf('人物', name);
    if (!e && name === Voice.NARRATOR) { e = { 名: name, 描写: '', 资产: [] }; F.doc.人物.push(e); }   // 旁白（11-17）：挑过的音色记在人物表「旁白」那一行，没有就加一行
    if (!e) return toast('人物表里没有「' + name + '」', 'err');
    e.音色 = path; touch(); paint();
    toast(path ? name + '的音色用「' + stem(path) + '」' : name + '不用音色了');
  }
  /* 挑一段：人物文件夹里的录音都列上，能试听；别人用着的不能挑（一段录音只给一个人） */
  async function pick(name, paint) {
    await listNow().catch(() => null);
    const t = table(), cur = stateOf(name).path || '';
    const owner = p => { for (const [k, v] of t) if (k !== name && v.path === p) return k; return ''; };
    const rows = NAMES.map(f => {
      const p = Voice.DIR + '/' + f, who = owner(p), mine = p === cur;
      return h('div', { class: 'vb-row' + (mine ? ' on' : '') }, playBtn(p, '试听'),
        h('span', { class: 'vb-nm', title: p }, stem(p), mine ? h('small', null, '现在用的') : who ? h('small', null, '给' + who + '用着') : null),
        mine || who ? null : h('button', { class: 'btn sm', type: 'button', 'data-use': p }, '给' + name + '用'));
    });
    const got = await dialog(close => {
      const body = NAMES.length ? h('div', { class: 'vb-list', onclick: e => { const b = e.target.closest('[data-use]'); if (b) close(b.dataset.use); } }, rows)
        : h('p', { class: 'fn-note' }, '人物和道具文件夹里还没有录音：把录音（wav、mp3 都行）放进 资产 / 人物和道具，再来挑。');
      return dlgShell('给「' + name + '」挑音色', '录音在 资产 / 人物和道具。写提示词时' + (name === Voice.NARRATOR ? '这一条有旁白才挂（画外音，画面里的人不开口）' : '他有台词才挂') + '：台词照文字写，录音只给音色、口音、语速和情绪。一段录音只给一个人。', body, [
        cur ? h('button', { class: 'btn ghost', type: 'button', onclick: () => close('') }, name + '不用音色') : null,
        h('button', { class: 'btn ink', type: 'button', 'data-focus': '', onclick: () => close(null) }, '关上')].filter(Boolean));
    });
    stop();
    if (got !== null && got !== undefined && got !== cur) set(name, got, paint);
  }
  const subOf = st => st.path ? stem(st.path) + (st.how === '文件名' ? ' · 照文件名认的' : '')
    : st.how === '不在了' ? '录音不在了：' + stem(st.want) : st.how === '不用' ? '不用音色' : '还没有音色';
  /* 资产页人物卡底下一行（11-16 资产页改版：原来单占一格）：音色叫什么、试听、换一段；没有的「挑一段」。不用音色在挑的小窗里点 */
  function line(name, paint) {
    load(paint);
    const st = stateOf(name), open = e => { e.stopPropagation(); pick(name, paint); };
    return h('div', { class: 'vb-line' + (st.how === '不在了' ? ' warn' : ''), title: st.path ? '音色：' + st.path : subOf(st), onclick: e => e.stopPropagation() },
      h('span', { class: 'vb-l' }, '音色'), h('span', { class: 'vb-n' }, st.path ? stem(st.path) : subOf(st)),
      st.path ? playBtn(st.path, '试听', 'vb-mini') : null,
      h('button', { class: 'vb-mini', type: 'button', title: st.path ? '另挑一段，或者不用音色' : '从 资产 / 人物和道具 的录音里挑一段给' + name, onclick: open }, st.path ? '换' : '挑一段'));
  }
  /* 设定页：有音色的摆「♪ 音色」试听、「换音色」；没有的摆「＋ 音色」 */
  function buttons(name, paint) {
    load(paint);
    const st = stateOf(name), open = e => { e.stopPropagation(); pick(name, paint); };
    if (st.path) return [playBtn(st.path, '♪ 音色', 'fr-use'), h('button', { class: 'fr-use vb-btn', type: 'button', title: '另挑一段，或者不用音色', onclick: open }, '换音色')];
    return [h('button', { class: 'fr-use vb-btn' + (st.how === '不在了' ? ' warn' : ''), type: 'button', title: subOf(st) + '：点一下从 资产 / 人物和道具 的录音里挑一段', onclick: open },
      st.how === '不在了' ? '♪ 录音不在了' : '＋ 音色')];
  }
  return Object.freeze({ line, buttons, reset });
})();
