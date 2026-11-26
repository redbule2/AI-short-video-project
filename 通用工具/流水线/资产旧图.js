/* ============================================================
   旧图（2026-11-23 他定「资产跟着改」；照的哪一句、旧没旧在 公用/资产照的.js 算）。
   一张图记下它照的哪一句描写（场景还记用到它的镜头）。描写变了、场景多了镜头、图出好以后字又改过：这张图旧了，不算确认过。
   卡上、弹窗里标「描写改了」「镜头改了」「字改了」，原来和现在并排，只给两个钮：
     重画：照旧开一个 Codex 新对话（流水线.js 的 askDraw），话里带上原来、现在和多了的镜头，Codex 先照新描写改出图提示词、给你看一眼再出；
     旧图还能用：照现在的描写、镜头重新记下，算确认可用；只用文字写的场景，这一场改用这张图。
   字还没出图就旧了（字照的那一句改了）：也标出来；出图时一样带上，Codex 先改字。字照样能用的点「字还能用」。
   流水线各页都引它：流水线.js 的 okOf、wordFor、确认可用、用新图、出图都用这里的
   ============================================================ */
'use strict';
/* 一格资产是哪一样：[类别, 名字]（场景写地方名）。关键帧、这一段文件夹里挑来的不归这里管 */
const srcOfIt = it => !it ? null : KIND[it.类别] && it.own ? [it.类别, it.名称] : it.类别 === '场景图' && it.own ? ['场景', baseOf(it.文件)] : it.类别 === '场景文字' ? ['场景', sceneStem(it.文字)] : null;
/* 一张图是哪一样的：场景图看文件夹，人物、道具看哪一行引用着它 */
function srcOfFile(f) {
  if (inCatDir('场景', f)) return ['场景', baseOf(f)];
  for (const K of LISTS) { const e = F.doc[K.key].find(x => x.资产.includes(f)); if (e) return [K.key, e.名]; }
  return null;
}
const wordPath = (cat, img) => '提示词/全局资产/' + cat + '/' + baseOf(img) + '_提示词.txt';
/* 这张图旧了没有：{ 描写, 镜头, 字 } 里有的几样；没旧回 null */
function oldOf(img, k) {
  if (!img || !k || !k[1]) return null;
  const t = imgTime(img), d = { ...(AssetSrc.imgStale(F.doc, img, k[0], k[1], t) || {}) };
  if (AssetSrc.wordEdited(F.doc, img, timeOf(F.doc.可用[img]), F.words.get(wordPath(k[0], img)) || 0, t)) d.字 = true;   // 图比字新的不算字改了
  return d.描写 || d.镜头 || d.字 ? d : null;
}
const fileOk = f => markOk(f, 0) && !oldOf(f, srcOfFile(f));   // 关键帧挂的参考图：确认过，也没旧
/* 记下这个文件照的是现在哪一句（确认可用、旧图还能用、用新图、字还能用） */
function noteSrc(file, k, t) { if (file && k && k[1]) AssetSrc.record(F.doc, file, AssetSrc.nowOf(F.doc, k[0], k[1]), t || nowText()); }
/* 照它出图以前要告诉 Codex 的：字旧了说字的；字没记下的说图的（图旧了，字多半也是照旧的那一句写的） */
const changeOf = w => w.wordFollow || (w.follow && (w.follow.描写 || w.follow.镜头) ? w.follow : null);

const OldImg = (() => {
  const clip = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return n && x.length > n ? x.slice(0, n - 1) + '…' : x; };
  const diffOf = w => !w ? null : w.follow || (!w.hasImg ? w.wordFollow : null);   // 有图看图；还没图看字
  const of = w => !!diffOf(w) && !['ai-img', 'ai-word', 'cand'].includes(w.step);   // 卡上、弹窗里要摆出来（AI 在做、出了新图等你挑的，先办那个）
  const tag = w => AssetSrc.tagOf(diffOf(w));
  /* 两句开头一样的有多长（卡上地方小，从不一样的那个字摆起；一句是另一句的开头，从最后一小句摆起） */
  const lead = (a, b) => { const x = String(a || ''), y = String(b || ''); let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++; if (i < x.length && i < y.length) return i; let k = i - 1; while (k >= 0 && !'，。；：、,;: '.includes(x[k])) k--; return k + 1; };
  /* 原来、现在并排。n：每边最多几个字（卡上短一点；弹窗里不给，全写） */
  function compare(w, n) {
    const d = diffOf(w);
    if (!d) return null;
    const cut = n && d.描写 ? lead(d.描写.原来, d.描写.现在) : 0, part = t => cut ? '…' + t.slice(cut) : t;
    const col = (lab, t, cls, show = t) => h('div', { class: 'oi-c ' + cls, title: lab + '：' + t }, h('b', null, lab), h('span', null, clip(show, n)));
    return h('div', { class: 'oi' + (n ? ' sm' : '') },
      d.描写 ? [col('原来', d.描写.原来, 'was', part(d.描写.原来)), col('现在', d.描写.现在, 'now', part(d.描写.现在))] : null,
      d.镜头 ? col('多了的镜头', d.镜头.join('；'), 'now wide') : null,
      d.字 && !d.描写 && !d.镜头 ? h('div', { class: 'oi-c wide' }, h('span', null, '出图提示词在这张图出好以后又改过')) : null);
  }
  async function redraw(s, w) { if (await askDraw(s, w)) await pageRepaint(); }
  function keep(s, it, w) {   // 旧图还能用
    confirmW(s, w, true);
    if (it && it.文字 && w.hasImg) useSceneImg(s, it.文字, w.img);
    toast('「' + w.stem + '」旧图还能用：算确认可用');
  }
  function keepWord(w) { noteSrc(w.txt, [w.cat, w.name]); touch(); toast('「' + w.stem + '」的字还能用'); }
  /* 眼下的钮。mk(label, title, fn, main)：各处自己的钮样子（main：深色那个） */
  function acts(s, it, w, mk) {
    const d = w.follow;
    if (d) {
      const what = d.描写 ? '描写' : d.镜头 ? '镜头' : '字';
      return [mk('重画', '开一个 Codex 新对话：' + (what === '字' ? '照现在的出图提示词出' : '先照现在的' + what + '改出图提示词，告诉你改了哪几句，再出图') + '。满意了在那个对话里说「定稿」，定稿前旧图照用', () => redraw(s, w), true),
        mk('旧图还能用', '这张图照现在的' + what + '也能用：算确认可用，不再标出来', () => { keep(s, it, w); pageNow(); })];
    }
    return diffOf(w) ? [mk('字还能用', '出图提示词照现在的描写也对得上：不再标出来。出图时 Codex 照原字出', () => { keepWord(w); pageNow(); })] : [];
  }
  return { of, tag, compare, acts, keep, redraw };
})();
