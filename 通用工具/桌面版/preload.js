'use strict';
/* 桌面版给页面的几样（window.desk）：登录页用 login、register；别的页能看是谁登录、退出登录；考试页经 api 问服务器。
   页面里拿不到 Node，只能经这几样找壳子办事；壳子那头还会核对是不是本机服务的页面。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desk', {
  info: () => ipcRenderer.invoke('desk:info'),
  login: (username, password) => ipcRenderer.invoke('desk:login', String(username || ''), String(password || '')),
  register: (username, password, again, team) => ipcRenderer.invoke('desk:register', String(username || ''), String(password || ''), String(again || ''), String(team || '')),
  logout: () => ipcRenderer.invoke('desk:logout'),
  /* 问 video8.online（只许考试、团队那两块）：opts = { query, body, file: { name, type, bytes } }，回 { ok, status, data } */
  api: (method, pathname, opts) => ipcRenderer.invoke('desk:api', String(method || ''), String(pathname || ''), opts || {}),
});
