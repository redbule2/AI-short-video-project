'use strict';
/* 自动更新：照 new-video8-8 的 desktop/electron/main/updater.ts、updaterPolicy.ts 改的 JS 版。
   正式安装版每次启动查一次；有新版本就在后台下，下好了问要不要现在重启装；选「稍后」就在正常退出时自动装。
   更新源是 electron-builder.yml 里 publish 那一条，打包时写进 resources\app-update.yml。
   装的时候不出安装向导（静默装）、装完自己重开：我们的安装包能选装哪（oneClick 关着），不静默的话升级也会停在向导最后一页等人点「完成」
   （11-24 试升级时看到；new-video8-8 那边是 quitAndInstall(false, true)，没照它）。
   开发规范第 21 条：版本号只升不降（allowDowngrade 关着）。 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1073741824;   // 一次更新的文件合计不超过 1 GiB

/* 升级包的签名（开发规范第 34 条）：线路不加密，路上的人能把升级包调包，所以每个包都签名，软件验过才装。
   发版时 scripts/pack.mjs 拿发版电脑上的私钥（%USERPROFILE%\.liushuixian\update-signing-key.pem，不进 git、不进安装包）
   签「版本号 + 安装包的 sha512」，写进 latest.yml 的 signature 一行；这里拿公钥验下好的安装包。
   私钥丢了只能换一对：新公钥写在这里，装着旧版的人得手动重装一次。 */
const UPDATE_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAXUxCfHH3yRxtxjYFqnAWEby8eqzm0KOA6N4WCTLDvZk=
-----END PUBLIC KEY-----
`;
const signedText = (version, sha512) => `liushuixian-update\n${version}\n${sha512}`;

/* 下好的安装包和签名对不对得上：对得上回 null，对不上回原因（electron-updater 的约定：回原因它就删掉这个包、报错） */
async function verifyPackage(file, info, key = UPDATE_KEY) {
  const sig = info && typeof info.signature === 'string' ? info.signature.trim() : '';
  if (!sig) return '升级包没有签名';
  if (!info.version) return '升级信息里没有版本号';
  const sum = await new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('error', reject).on('data', d => h.update(d)).on('end', () => resolve(h.digest('base64')));
  });
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(signedText(String(info.version), sum)), key, Buffer.from(sig, 'base64')); } catch (e) { ok = false; }
  return ok ? null : '升级包的签名对不上，可能被人改过';
}

/* 这一版要下的文件合计多大；大小缺了、不是正整数的回 null（不下） */
function packageBytes(info) {
  const files = info && Array.isArray(info.files) ? info.files : [];
  if (!files.length) return null;
  let total = 0;
  for (const f of files) {
    if (!Number.isSafeInteger(f.size) || f.size <= 0) return null;
    total += f.size;
    if (f.blockMapSize !== undefined) {
      if (!Number.isSafeInteger(f.blockMapSize) || f.blockMapSize <= 0) return null;
      total += f.blockMapSize;
    }
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

function makeUpdater({ app, dialog, getWindow, log, onChange }) {
  let up = null, enabled = false, status = 'disabled', message = '';
  let checking = null, downloading = null, allowed = false, prompted = false, pending = null;
  const set = (s, m = '') => { status = s; message = m; log.info('更新：' + s + (m ? '　' + m : '')); if (onChange) onChange(); };   // 一变就说一声：设置里「版本」那一行跟着变
  const result = () => ({ status, message });

  async function promptInstall(version) {
    if (prompted) return;
    prompted = true;
    const opts = { type: 'info', title: '新版本下好了', message: `新版本 ${version} 已经下好`, detail: '现在重启：软件先关掉，自己装好，大约半分钟后重新打开。\n选「稍后」：下回正常关掉软件时自动装。', buttons: ['现在重启装上', '稍后'], defaultId: 0, cancelId: 1, noLink: true };
    const w = getWindow();
    const r = w && !w.isDestroyed() ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    if (r.response === 0) install();
  }

  function configure() {
    if (!app.isPackaged) return set('unsupported', '开发时不查更新');
    if (process.env.ANTOU_DESK_NO_UPDATE === '1') return set('disabled', '环境变量关了更新');
    const feed = path.join(process.resourcesPath, 'app-update.yml');
    if (!fs.existsSync(feed)) return set('disabled', '这个包没带更新通道');
    /* electron-updater 只在 app-update.yml 有 publisherName 时才验下好的包（electron-builder.yml 的 publish 里写着）：没有就不查，免得装没验过的 */
    if (!/^publisherName:/m.test(fs.readFileSync(feed, 'utf8'))) return set('disabled', '这个包不验升级包的签名，不查更新');
    up = require('electron-updater').autoUpdater;
    up.verifyUpdateCodeSignature = (names, file) => verifyPackage(file, pending);   // 换掉它自带的（那个认 Windows 的证书，我们没买）
    enabled = true;
    set('idle');
    up.logger = { info: m => log.info('[更新] ' + m), warn: m => log.warn('[更新] ' + m), error: m => log.error('[更新] ' + m), debug() {} };
    up.autoDownload = false;
    up.autoInstallOnAppQuit = true;
    up.autoRunAppAfterInstall = true;
    up.allowDowngrade = false;
    up.allowPrerelease = false;
    up.on('checking-for-update', () => set('checking'));
    up.on('update-available', info => {
      const n = packageBytes(info);
      if (n === null) { allowed = false; return set('error', '更新文件缺少大小信息，没下'); }
      if (n > MAX_BYTES) { allowed = false; return set('error', '更新文件超过 1 GiB，没下'); }
      allowed = true;
      pending = info;   // 带着 latest.yml 里的签名：下好以后拿它验
      set('available', '发现新版本 ' + info.version);
      download();
    });
    up.on('update-not-available', () => { allowed = false; set('not-available'); });
    up.on('download-progress', p => set('downloading', `正在下新版本 ${Math.floor(p.percent)}%`));
    up.on('update-downloaded', info => {
      allowed = false;
      set('downloaded', `新版本 ${info.version} 下好了`);
      promptInstall(info.version).catch(e => log.error('问装不装没弹出来', e));
    });
    up.on('update-cancelled', () => { allowed = false; set('idle', '下载取消了'); });
    up.on('error', e => { allowed = false; set('error', '自动更新没成，稍后再试'); log.error('自动更新出错', { name: e && e.name, message: e && e.message }); });
    check();
  }

  function check() {
    if (!enabled) return Promise.resolve(result());
    if (checking) return checking;
    checking = (async () => {
      try { await up.checkForUpdates(); } catch (e) { set('error', '查更新没成，稍后再试'); log.error('查更新出错', e); }
      return result();
    })().finally(() => { checking = null; });
    return checking;
  }

  function download() {
    if (!enabled) return Promise.resolve(result());
    if (status === 'downloaded') return Promise.resolve(result());
    if (!allowed) return Promise.resolve({ status, message: '现在没有能下的新版本' });
    if (downloading) return downloading;
    downloading = (async () => {
      try { set('downloading', '正在下新版本'); await up.downloadUpdate(); } catch (e) { set('error', '新版本没下成，稍后再试'); log.error('下更新出错', e); }
      return result();
    })().finally(() => { downloading = null; });
    return downloading;
  }

  function install() {
    if (!enabled || status !== 'downloaded') return false;
    up.quitAndInstall(true, true);   // 静默装、装完自己重开
    return true;
  }

  return { configure, check, status: result, install, get enabled() { return enabled; } };
}

module.exports = { makeUpdater, packageBytes, MAX_BYTES, UPDATE_KEY, signedText, verifyPackage };
