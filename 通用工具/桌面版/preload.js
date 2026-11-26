'use strict';
/* 桌面版给页面的几样（window.desk）：登录页用 login、register；别的页能看是谁登录、退出登录；考试页经 api 问服务器；「消息」页经 onChat 收新消息。
   页面里拿不到 Node，只能经这几样找壳子办事；壳子那头还会核对是不是本机服务的页面。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  info: () => ipcRenderer.invoke('desk:info'),
  login: (username, password) => ipcRenderer.invoke('desk:login', String(username || ''), String(password || '')),
  register: (username, password, again, team) => ipcRenderer.invoke('desk:register', String(username || ''), String(password || ''), String(again || ''), String(team || '')),
  logout: () => ipcRenderer.invoke('desk:logout'),
  /* 问 video8.online（只许考试、团队那两块）：opts = { query, body, file: { name, type, bytes } }，回 { ok, status, data } */
  api: (method, pathname, opts) => ipcRenderer.invoke('desk:api', String(method || ''), String(pathname || ''), opts || {}),
  /* 消息（团队聊天）：壳子在后台收新消息，经这里转给「消息」那一页（只发给它）：fn({ messages }) 来了新消息、fn({ open }) 要打开哪个会话。
     调了就算这一页准备好收了；openChat 叫壳子打开「消息」、进和这个人的私聊（「我的团队」里的「发消息」） */
  onChat: fn => { ipcRenderer.on('desk:chat', (e, m) => fn(m)); ipcRenderer.send('desk:chat-ready'); },
  openChat: username => ipcRenderer.send('desk:open-chat', String(username || '')),
});

/* ---------- 皮肤 ----------
   壳子说现在用哪一套（{ 名, 纸面 }，lib/routes.js 的 skinForPage），这里写到 <html data-skin> 上，页面的样式照它换颜色（公用/皮肤.css）。
   默认那一套（宣纸）名字是空的，不写。换了皮肤壳子会再说一声（desk:skin），页面不用重开。

   「纸面」的皮肤（校样台：深桌子上铺亮纸）多一步。它的颜色变量写成 light-dark(纸上, 桌上)，整页是深的，哪些东西算纸面得在这里标出来：
   照页面样式的原顺序，把每条给了底色的规则抄一遍选择器——拿纸色（--sheet、--white、--warm）做底的标成亮的（color-scheme: light），
   给了别的底（透明、墨色、朱砂……）的跟它外面那一层走（inherit）：按钮本来是纸色，可「透明按钮」「墨色按钮」得跟着所在的地方。
   顺序和选择器照抄，两条规则谁压谁，就和页面自己定底色时一模一样。
   字的颜色是算好了往下传的：纸面上自己没说颜色的，替它说一遍「用墨色」，不然会接着用桌面上那种浅字。 */
const PAPER_BG = /var\(--(sheet|white|warm)\)/;
const MARK = 'desk-paper';   // 标纸面的那一段样式挂在页面上的名字
let skin = null;

function paperCss(sheets) {
  const walk = rules => {
    let css = '';
    for (const r of rules) {
      if (r.styleSheet) { try { css += walk(r.styleSheet.cssRules); } catch (e) { /* 读不了的样式表跳过 */ } }
      if (r.selectorText && r.style) {
        const bg = r.style.getPropertyValue('background-color') || r.style.getPropertyValue('background');
        if (!bg) continue;
        if (!PAPER_BG.test(bg)) css += r.selectorText + ' { color-scheme: inherit; }\n';
        else css += r.selectorText + ' { color-scheme: light;' + (r.style.getPropertyValue('color') || /:(hover|active|focus)/.test(r.selectorText) ? '' : ' color: var(--ink);') + ' }\n';
      } else if (r.cssRules && !r.selectorText) {   // @media 这一类：里面的照样抄，外面那一句也带上
        const inner = walk(r.cssRules);
        if (inner) css += r.cssText.slice(0, r.cssText.indexOf('{')) + '{\n' + inner + '}\n';
      }
    }
    return css;
  };
  let all = '';
  for (const s of sheets) {
    if (s.ownerNode && s.ownerNode.id === MARK) continue;
    try { all += walk(s.cssRules); } catch (e) { /* 还没读完的样式表：它读完时会再来一遍 */ }
  }
  return all;
}

function paint() {
  const root = document.documentElement;
  if (!root) return;
  if (skin && skin.名) root.dataset.skin = skin.名; else delete root.dataset.skin;
  let tag = document.getElementById(MARK);
  if (!skin || !skin.纸面) { if (tag) tag.remove(); return; }
  if (!document.head) return;
  if (!tag) { tag = document.createElement('style'); tag.id = MARK; }
  const css = paperCss(document.styleSheets);
  if (tag.textContent !== css) tag.textContent = css;
  if (document.head.lastElementChild !== tag) document.head.append(tag);   // 放在最后：分量一样的规则，后写的算数
}

skin = ipcRenderer.sendSync('desk:skin');   // 不是本机服务的页面壳子不答（null）：什么也不做
if (skin) {
  ipcRenderer.on('desk:skin', (e, s) => { skin = s; paint(); });
  let queued = false;
  const soon = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); };
  const watchHead = () => { if (document.head && !watchHead.on) { watchHead.on = true; new MutationObserver(soon).observe(document.head, { childList: true }); } };
  /* 页面刚开头还没有 <html>：它一出来就写上，免得先闪一下默认的颜色 */
  if (document.documentElement) paint();
  else new MutationObserver((_, ob) => { if (document.documentElement) { ob.disconnect(); paint(); } }).observe(document, { childList: true });
  document.addEventListener('readystatechange', () => { paint(); watchHead(); });                                   // 页面的样式读进来了：标纸面
  document.addEventListener('load', e => { if (e.target && e.target.tagName === 'LINK') soon(); }, true);          // 后来才读完的样式表
}
