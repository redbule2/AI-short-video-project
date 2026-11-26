/* ============================================================
   嵌在流水线里的页面跟着外面那一页换皮肤（2026-11-26 他要编辑器也跟着换肤色）
   写稿页（项目管理_写稿试用.html）、看文件的那一页（项目管理.html）是嵌在流水线页面里的 iframe。
   桌面版的壳子只给最外面那一页写 <html data-skin>（preload.js 不进 iframe），这里照外面那一页抄过来，外面换了跟着换。
   纸面的皮肤（校样台：深桌子上铺亮纸，外面那一页挂着 #desk-paper）：嵌着的这一页整页当一张纸，颜色取纸上那一档（color-scheme: light）。
   不是嵌着的、外面不是同一个网站的（读不了 parent.document），什么也不做。
   在 <head> 最前面引，页面画出来以前就换好，不闪一下宣纸。测试：通用工具/测试/跟着外面换皮肤_测试.cjs
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else api.watch(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  /* 外面那一页什么样，这一页就写成什么样：{ skin: 名字或 ''，paper: 是不是纸面 } */
  function read(up) {
    const skin = (up.documentElement && up.documentElement.dataset.skin) || '';
    return { skin, paper: !!skin && !!up.getElementById('desk-paper') };
  }
  function paint(doc, look) {
    const el = doc.documentElement;
    if (look.skin) el.dataset.skin = look.skin; else delete el.dataset.skin;
    el.style.colorScheme = look.paper ? 'light' : '';
  }
  function watch(win) {
    let up = null;
    try { up = win.parent && win.parent !== win ? win.parent.document : null; } catch (e) { up = null; }   // 外面不是同一个网站：读不了
    if (!up || !up.documentElement) return false;
    const sync = () => paint(win.document, read(up));
    sync();
    const Ob = win.MutationObserver;
    if (Ob) {
      new Ob(sync).observe(up.documentElement, { attributes: true, attributeFilter: ['data-skin'] });
      if (up.head) new Ob(sync).observe(up.head, { childList: true });   // 纸面那一段样式挂上、拿掉
    }
    return true;
  }
  return Object.freeze({ read, paint, watch });
});
