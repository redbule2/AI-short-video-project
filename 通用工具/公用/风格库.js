/* ============================================================
   公用 · 风格库（页面里是 window.StyleLib，本机服务里 require 它）
   拍摄风格（2026-11-14 用户定）：剧本定稿以后照剧本挑，一部片子一个，个别场可以另选；记在 流水线.json 的「风格」（全片）和各场的「风格」（另选的）。
   风格库在 通用工具/AI短片风格库/AI短片风格库.txt：第二行写着哪几种已定（有样片）、哪几种是备选；一种一节，【名字】下面一行一项。
   照库里「怎么用」（11-14 照 sd2.5PE 和样片经验改）：影像风格、摄影、光色基调写成【基础设定】放在事件脚本前面（11-14 用户定），三样写全、质感写成看得见的；
   光色基调句末的〔〕换成这场的时间主光；声音进事件脚本最后一行「声音包括……」，表演进镜头；分镜常用拍法挑一两句；比例出片时选、不进提示词。
   「一眼认出」「容易跑偏」给人和 AI 对照、防跑偏，不粘进提示词。11-14 精简：AI圈怎么用、别和它混、AI圈例子挪进 风格来历.md（FIELDS 里留着名字不碍事）。
   「本项目自己的」：照这个项目的 提示词/全局资产/全片_光影总基调.txt。
   ============================================================ */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.StyleLib = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FIELDS = ['一句话', 'AI圈怎么用', '一眼认出', '别和它混', '影像风格', '摄影', '光色基调', '声音', '表演', '分镜常用拍法', '容易跑偏', '比例', '原片参考', 'AI圈例子', '样片提示词'];
  const OWN = '本项目自己的';
  const DIR = ['通用工具', 'AI短片风格库'], FILE = 'AI短片风格库.txt';   // 从总文件夹算起
  const T = v => String(v == null ? '' : v).trim();
  const names = s => T(s).split(/[、，,]/).map(T).filter(Boolean);

  /* 读风格库：{ list: [{ 名, 已定, 一句话, …, 样片 }], how: 「怎么用」那一段 } */
  function parse(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
    const head = lines.slice(0, 4).join('\n');
    const done = names((/已定[：:]([^；;\n]*)/.exec(head) || [])[1]);
    const list = [], how = [];
    let cur = null, inHow = false;
    for (const raw of lines) {
      const l = raw.trim();
      if (/^怎么用$/.test(l)) { inHow = true; continue; }
      if (/^═+/.test(l)) { inHow = false; continue; }
      if (inHow) { if (l) how.push(l); continue; }
      const m = /^【([^】]+)】$/.exec(l);
      if (m) { cur = { 名: m[1].trim() }; list.push(cur); continue; }
      if (!cur) continue;
      const f = /^([^：:]{1,8})[：:]\s*(.*)$/.exec(l);
      if (f && FIELDS.includes(f[1].trim())) cur[f[1].trim()] = f[2].trim();
    }
    for (const c of list) {
      c.已定 = done.includes(c.名);
      c.样片 = /\.txt$/i.test(c.样片提示词 || '') ? c.样片提示词.replace(/\.txt$/i, '.mp4') : '';
    }
    return { list, how: how.join('\n') };
  }
  const find = (lib, name) => (lib && lib.list || []).find(c => c.名 === T(name)) || null;
  /* 「一眼认出」拆成一条一条（①②③……） */
  const marks = t => T(t).split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/).map(T).filter(Boolean);

  /* 交给 AI 的那一段。x：{ 名, card（风格库里那一种；本项目自己的是 null）, tone（全片_光影总基调.txt）, scene（是不是这一场另选的） }
     use：写（写提示词、铺底）、批（AI 批提示词）、改（按批注改提示词）、图（写资产图的出图提示词）、审（看审片批注） */
  function bookPart(x, use) {
    if (!x || !T(x.名)) return '';
    const whose = x.scene ? '（这一场另选的）' : '（全片的）';
    const tone = T(x.tone);
    if (!x.card) {
      if (!tone) return '';
      const say = use === '图' ? '这张图的画面质感、颜色和光照下面这份写。' : use === '审' || use === '批' ? '对照下面这份看。' : '影像风格、画面质感、摄影、光色照下面这份写成【基础设定】，放在事件脚本前面，写全、写成看得见的样子，别缩成一句空话（旧格式的稿写进基础设定）；这一场的时间、主光写在光色基调句末。';
      return ['', '## 这部片子的拍摄风格：' + OWN + whose, say, tone].join('\n');
    }
    const c = x.card, L = k => c[k] ? k + '：' + c[k] : '';
    const toneTail = tone ? ['\n## 本项目的光影总基调（和上面的风格对不上的地方，以风格为准）', tone] : [];
    const head = '## 这部片子的拍摄风格：' + c.名 + whose;
    if (use === '审') return ['', head, '这几样是给人核片子像不像用的：', L('一眼认出'), L('别和它混'), L('容易跑偏')].filter(Boolean).join('\n');
    if (use === '图') return ['', head, L('一句话'), L('影像风格'), L('光色基调'),
      '这张图照这个风格的画面质感、颜色和光来写：影像风格、光色基调的意思写进去，光色基调句末的〔〕换成这张图的时间和光。急推、拖影、手持、快切这类镜头运动和剪辑的招牌是视频里的，资产图不用；人物、道具图照旧用中灰背景，风格落在质感、颜色、光和妆发、衣着的年代感上。', ...toneTail].filter(v => v !== '').join('\n');
    const how = use === '批' ? '批的时候也看风格用上没有：【基础设定】有没有放在事件脚本前面、照影像风格、摄影、光色基调写全（质感、拍法、光色都要有，不是一句空话）；光色基调句末写了这一场的时间、主光没有；声音、表演对不对得上；招牌拍法有没有至少用一次；有没有写进比例或 8K、超清这类画质词。「一眼认出」只是对照，提示词里不用照抄它的原句。'
      : use === '改' ? '批注说到风格、画面味道的，照这个风格改；批注没说到的不动。'
        : '怎么用：①影像风格、摄影、光色基调写成【基础设定】，放在事件脚本前面，一样一行（旧格式的稿写进基础设定）：风格名打头，后面跟着具体写法，三样都写全，质感写成看得见的（颗粒、褪色、划痕），别缩成一句空话；②光色基调句末的〔时间、主光方向按剧情〕换成这一场的；③声音写进事件脚本最后一行「声音包括……」，音乐用 ()、音效用 <> 写在发生处；表演写成人物看得见的动作、眼神和停顿；④分镜常用拍法挑一两句写进镜头，写清拍谁、多近、从哪到哪，招牌拍法至少用一次，不然认不出来；⑤比例出片时选，不写进提示词；不加 8K、超清这类画质词；⑥「一眼认出」「容易跑偏」只给你对照、防跑偏，原句别粘进提示词。';
    return ['', head, L('一句话'), L('影像风格'), L('摄影'), L('光色基调'), L('声音'), L('表演'), L('分镜常用拍法'), L('比例'),
      c.一眼认出 ? '一眼认出（招牌，只给你对照）：' + c.一眼认出 : '', c.容易跑偏 ? '容易跑偏（写的时候防着）：' + c.容易跑偏 : '', how, ...toneTail].filter(v => v !== '').join('\n');
  }
  return { FIELDS, OWN, DIR, FILE, parse, find, marks, bookPart };
});
