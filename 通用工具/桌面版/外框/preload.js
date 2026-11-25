'use strict';
/* 外框页（外框.html）经这几样找壳子办事（window.deskFrame）：问现在什么样、窗口三个按钮、去哪一页、设置里的各个钮。
   壳子那头只认外框页自己发来的（main.js 的 fromFrame）。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskFrame', {
  state: () => ipcRenderer.invoke('frame:state'),
  onState: fn => { ipcRenderer.on('frame:state', (e, s) => fn(s)); },
  win: what => ipcRenderer.send('frame:win', String(what)),   // min、max、close
  go: id => ipcRenderer.send('frame:go', String(id)),         // 菜单里的一项；settings 是设置（开着时再叫一回就回去）
  do: (what, arg) => ipcRenderer.send('frame:do', String(what), arg === undefined ? '' : String(arg)),   // 设置里的钮：main.js 的 DO
});
