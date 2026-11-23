/* ============================================================
   字里的 @图片N：点一下看大图（2026-11-14 他说「整个项目只要文字里出现 @图片 这种，都应该可以点击放大预览」）
   RefPic.watch(resolve, skip)：盯着整页，摆出来的字里有 @图片N、又认得是哪张图的，就换成能点的。
     输入框、能编辑的地方、已经是小牌子的（.rf .ref .tk-ref）不动；skip 是这一页另外不动的地方（CSS 选择器）。
     resolve(ref, el)：认得就给一个函数（点了做什么），或 { open, tip }；不认得给 null，这处照旧是字。
     el 是这处字所在的元素，用来看它属于哪一条提示词。
   RefPic.also(resolve)：另外加一个认图的，先问它（2026-11-19：写稿页旁边摆的参考提示词、流水线里历史记录的老版本，@图片N 照它们自己那一条认）。
     它给 undefined 是不归它管，接着问 watch 给的；给 null 是归它管、可认不出，这处照旧是字。
   RefPic.scan()：认图的资料（参考素材映射、挂图）读好了、换了，再扫一遍整页。
   RefPic.show(图的地址或 Promise, 标题, 小字)：这一页没有自己的看大图，用这个：黑底、大图、标题；点一下或按 Esc 关。
   RefPic.useViewer(fn)：这一页有自己摆图的地方，show 交给它 fn(图的地址或 Promise, 标题, 小字)（2026-11-22 写稿页：摆在稿子旁边，不盖住字，公用/写稿看图.js）。
   ============================================================ */
'use strict';
(function () {
  const RE = /@图片\s*([0-9]+)/g;
  const BASE_SKIP = 'textarea, input, select, option, script, style, svg, [contenteditable], .rl, .rf, .ref, .tk-ref, .rl-box, .fl-hov, [data-no-ref]';
  let RES = null, SKIP = BASE_SKIP, MO = null, BOX = null, VIEW = null;
  const EXTRA = [];
  const on = () => !!RES || EXTRA.length > 0;
  function style() {
    if (document.getElementById('rl-style')) return;
    const el = document.createElement('style');
    el.id = 'rl-style';
    el.textContent = '.rl{cursor:zoom-in;border-radius:3px;background:rgba(47,109,138,.12);box-shadow:inset 0 -1px 0 rgba(47,109,138,.6);transition:background .15s}'
      + '.rl:hover{background:rgba(47,109,138,.26)}'
      + '.rl-box{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;background:rgba(20,18,16,.84);cursor:zoom-out;animation:rlin .15s ease}'
      + '@keyframes rlin{from{opacity:0}}'
      + '.rl-box figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px;max-width:94vw}'
      + '.rl-box img{display:block;max-width:92vw;max-height:84vh;min-width:120px;min-height:80px;border-radius:6px;background:#2a2622;box-shadow:0 30px 80px -20px rgba(0,0,0,.6)}'
      + '.rl-box figcaption{font:14px/1.6 system-ui,sans-serif;color:#f3ead9;text-align:center}'
      + '.rl-box figcaption small{display:block;font-size:12px;color:rgba(243,234,217,.62);word-break:break-all}';
    document.head.append(el);
  }
  const got = (ref, el) => {
    try { for (const f of EXTRA) { const g = f(ref, el); if (g !== undefined) return g; } return RES ? RES(ref, el) : null; } catch (e) { return null; }
  };
  function linkText(tn) {
    const t = tn.data, p = tn.parentElement;
    if (!on() || t.indexOf('@') < 0 || !p || !tn.isConnected || p.closest(SKIP)) return;
    const frag = document.createDocumentFragment();
    let last = 0, hit = false;
    for (const m of t.matchAll(RE)) {
      const ref = '@图片' + m[1], g = got(ref, p);
      if (!g) continue;
      if (m.index > last) frag.append(t.slice(last, m.index));
      const a = document.createElement('span');
      a.className = 'rl'; a.dataset.ref = ref; a.textContent = m[0];
      a.title = (g && g.tip) || '点开看大图';
      frag.append(a);
      last = m.index + m[0].length; hit = true;
    }
    if (!hit) return;
    if (last < t.length) frag.append(t.slice(last));
    tn.replaceWith(frag);
  }
  function scan(root) {
    if (!on()) return;
    root = root || document.body;
    if (root.nodeType === 3) { linkText(root); return; }
    if (root.nodeType !== 1 || !root.isConnected || root.closest(SKIP)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.data.indexOf('@') >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    const list = [];
    while (w.nextNode()) list.push(w.currentNode);
    list.forEach(linkText);
  }
  function onClick(e) {
    const a = e.target && e.target.closest ? e.target.closest('.rl') : null;
    if (!a || !on()) return;
    e.preventDefault(); e.stopPropagation();
    const g = got(a.dataset.ref, a.parentElement), fn = typeof g === 'function' ? g : g && g.open;
    if (fn) fn();
  }
  function watch(resolve, skip) {
    RES = resolve; SKIP = skip ? BASE_SKIP + ', ' + skip : BASE_SKIP;
    start();
    scan(document.body);
  }
  function also(resolve) {
    EXTRA.push(resolve);
    start();
    scan(document.body);
  }
  function start() {
    style();
    if (!MO) {
      document.addEventListener('click', onClick, true);   // 抢在整行、整格的点击前面：点的是图就只看图
      MO = new MutationObserver(recs => {
        for (const r of recs) {
          if (r.type === 'characterData') linkText(r.target);
          else for (const n of r.addedNodes) scan(n);
        }
      });
      MO.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }
  function close() {
    if (!BOX) return;
    BOX.el.remove(); removeEventListener('keydown', BOX.key, true); removeEventListener('mousedown', BOX.down, true);
    if (BOX.url && BOX.own) URL.revokeObjectURL(BOX.url);
    BOX = null;
  }
  function useViewer(fn) { VIEW = typeof fn === 'function' ? fn : null; }
  function show(src, title, sub) {
    if (VIEW) return VIEW(src, title, sub);
    style(); close();
    const img = document.createElement('img'), cap = document.createElement('figcaption'), fig = document.createElement('figure'), el = document.createElement('div');
    img.alt = title || '';
    cap.append(title || '');
    if (sub) { const s = document.createElement('small'); s.textContent = sub; cap.append(s); }
    fig.append(img, cap); el.className = 'rl-box'; el.append(fig);
    // 挂在 window 上抢先收：Esc、按鼠标只关大图，底下的弹窗、小窗不跟着关
    const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    const down = e => { if (el.contains(e.target)) e.stopPropagation(); };
    el.addEventListener('click', close);
    addEventListener('keydown', key, true); addEventListener('mousedown', down, true);
    document.body.append(el);
    const me = BOX = { el, key, down, url: '', own: false };
    Promise.resolve(src).then(u => {
      if (BOX !== me) { if (typeof src !== 'string' && /^blob:/.test(u)) URL.revokeObjectURL(u); return; }
      me.url = u; me.own = typeof src !== 'string' && /^blob:/.test(u); img.src = u;
    }).catch(err => { cap.append(document.createElement('br'), '打不开：' + (err && err.message || err)); });
  }
  window.RefPic = { watch, also, scan, show, close, useViewer };
})();
