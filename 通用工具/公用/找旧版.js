/* ============================================================
   公用 · 找旧版（window.RefFile）
   参考素材映射里登记了每份素材的路径和 SHA-256。原处的文件换了新版、或者挪走了，登记的那一份多半在 历史记录 里：
     历史记录/同样的文件夹/原名__年月日-时分秒.后缀（单个文件收进去的）
     历史记录/…/文件夹名__时间/…/原名.后缀（整个文件夹收进去的）
     历史记录/原始资料/登记的路径（从老仓库原样搬来的，11-19 3-1 段老稿照老路径登记）
   2026-11-15 他说：就算去了历史记录，也应该能预览，除非文件真的删了。
   RefFile.find(fs, base, file, sha)：读出登记的那一份。原处的内容和登记的一样就用原处的；不一样、或者原处没有，到历史记录里从新到旧找。
     fs：这一页的 FS（要有 read、list，有 stat 更快）；base：项目文件夹的路径（照这一页 FS 的写法）；
     file：登记的路径（资产/第3-4段/x.mp4）；sha：登记的 SHA-256，没有就只看原处。
     给 { file, parts, bytes, old, here }：file 是读到的那一份在项目里的路径；old：是不是历史记录里的；
     here：原处怎样，'same' 就是它，'changed' 换成别的了，'gone' 没有了。哪儿都没有就报错（大白话）。
   RefFile.locate(fs, base, file, sha)：一样找，只给路径不给内容；核过的记在浏览器里，文件没动过下回不再读。
     原处还在、历史记录里又没有旧的：不读不核，当原处的。哪儿都没有给 null。
   RefFile.note(r)：一句小字，说这一份是哪儿来的；原处的给空串。
   不改登记，也不替你重新登记。
   ============================================================ */
'use strict';
(function () {
  const H = '历史记录';
  const low = s => String(s).toLowerCase();
  const isSha = s => typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
  const bufOf = r => r && r.buf ? r.buf : r;   // FS.read 给 { buf, mtime, size }
  async function hex(bytes) {
    if (!globalThis.crypto || !crypto.subtle) throw new Error('这个浏览器核不了文件内容，请用 Chrome 或 Edge 打开');
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  function relOf(file) {
    const rel = String(file || '').replace(/\\/g, '/').split('/').filter(Boolean);
    if (!rel.length || rel.some(p => p === '.' || p === '..' || /[:\u0000]/.test(p))) throw new Error('登记的路径不对：' + file);
    return rel;
  }
  const show = rel => rel.join('/');
  const nowhere = (rel, cur) => new Error('登记的那份找不到了，原处和历史记录里都没有' + (cur ? '（原处现在是另一份）' : '') + '：' + show(rel));

  /* ---------- 核过的记着：路径、大小、修改时间都没变，就不再读一遍 ---------- */
  const MEM = new Map();
  const keyOf = parts => 'antou:sha:' + parts.join('/');
  function known(parts, st) {
    if (!st) return '';
    const k = keyOf(parts);
    let v = MEM.get(k);
    if (!v) { try { v = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { v = null; } }
    return v && v.size === st.size && v.mtime === st.mtime && isSha(v.sha) ? v.sha : '';
  }
  function remember(parts, r, sha) {
    const st = { size: r.size != null ? r.size : bufOf(r).length, mtime: r.mtime || 0 };
    if (!st.mtime) return;
    const k = keyOf(parts), v = { ...st, sha };
    MEM.set(k, v);
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 记不下就算了 */ }
  }
  const statOf = async (fs, parts) => { try { return fs.stat ? await fs.stat(parts) : undefined; } catch (e) { return null; } };   // undefined：这一页的 FS 没有 stat
  const readOf = async (fs, parts) => { try { return await fs.read(parts); } catch (e) { return null; } };
  /* 这一份的 SHA-256：null 是没这个文件；want 给了、记着的又不一样，就不用读了 */
  async function shaOf(fs, parts) {
    const st = await statOf(fs, parts);
    if (st === null) return null;
    const k = known(parts, st);
    if (k) return k;
    const r = await readOf(fs, parts);
    if (!r) return null;
    const s = await hex(bufOf(r));
    remember(parts, r, s);
    return s;
  }

  /* ---------- 历史记录里可能是它的那几份，新的在前 ---------- */
  async function olds(fs, base, rel) {
    const ls = new Map(), list = parts => {
      const k = parts.join('/');
      if (!ls.has(k)) ls.set(k, Promise.resolve().then(() => fs.list([...base, ...parts])).catch(() => []));
      return ls.get(k);
    };
    const name = rel[rel.length - 1], dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    const dir = rel.slice(0, -1), out = [], pre = low(stem + '__'), tail = low(ext);
    const stamp = n => n.slice(stem.length + 2, n.length - ext.length);   // 原名__20261114-222759.mp4 → 20261114-222759
    const ents = await list([H, ...dir]);
    ents.filter(e => e.kind === 'file' && low(e.name).startsWith(pre) && low(e.name).endsWith(tail) && e.name.length > stem.length + 2 + ext.length)
      .sort((a, b) => stamp(b.name).localeCompare(stamp(a.name))).forEach(e => out.push([H, ...dir, e.name]));
    const same = ents.find(e => e.kind === 'file' && low(e.name) === low(name));   // 收进去没改名的
    if (same) out.push([H, ...dir, same.name]);
    for (let i = dir.length - 1; i >= 0; i--) {   // 整个文件夹收进去的：从里往外一层一层找
      const p2 = low(dir[i] + '__');
      (await list([H, ...dir.slice(0, i)])).filter(e => e.kind === 'directory' && low(e.name).startsWith(p2))
        .sort((a, b) => b.name.localeCompare(a.name)).forEach(d => out.push([H, ...dir.slice(0, i), d.name, ...dir.slice(i + 1), name]));
    }
    const raw = (await list([H, '原始资料', ...dir])).find(e => e.kind === 'file' && low(e.name) === low(name));   // 老仓库原样搬来的
    if (raw) out.push([H, '原始资料', ...dir, raw.name]);
    return out;
  }

  async function find(fs, base, file, sha) {
    const rel = relOf(file), want = isSha(sha) ? sha.toLowerCase() : '';
    const hit = (p, r, old, here) => ({ file: show(p), parts: [...base, ...p], bytes: bufOf(r), old, here });
    const cur = await readOf(fs, [...base, ...rel]);
    if (cur) {
      if (!want) return hit(rel, cur, false, 'same');
      const s = await hex(bufOf(cur));
      remember([...base, ...rel], cur, s);
      if (s === want) return hit(rel, cur, false, 'same');
    } else if (!want) throw new Error('文件找不到了：' + show(rel));
    for (const p of await olds(fs, base, rel)) {
      const parts = [...base, ...p], k = known(parts, await statOf(fs, parts));
      if (k && k !== want) continue;
      const r = await readOf(fs, parts);
      if (!r) continue;
      const s = await hex(bufOf(r));
      remember(parts, r, s);
      if (s === want) return hit(p, r, true, cur ? 'changed' : 'gone');
    }
    throw nowhere(rel, !!cur);
  }

  async function locate(fs, base, file, sha) {
    const rel = relOf(file), want = isSha(sha) ? sha.toLowerCase() : '';
    const at = (p, old, here) => ({ file: show(p), parts: [...base, ...p], old, here });
    const st = await statOf(fs, [...base, ...rel]);
    if (!want) return st === null ? null : at(rel, false, 'same');
    const list = await olds(fs, base, rel);
    if (st !== null && !list.length) return at(rel, false, 'same');   // 没有旧的可换：照原处的
    const s = st === null ? null : await shaOf(fs, [...base, ...rel]);
    if (s === want) return at(rel, false, 'same');
    for (const p of list) if (await shaOf(fs, [...base, ...p]) === want) return at(p, true, s === null ? 'gone' : 'changed');
    return s === null ? null : at(rel, false, 'changed');   // 登记的那份哪儿都没有：原处还有就照原处的（没核上）
  }

  const note = r => !r || !r.old ? '' : '历史记录里的那一版' + (r.here === 'gone' ? '（原处已经没有了）' : '（原处换成了新版）');

  window.RefFile = { find, locate, note };
})();
