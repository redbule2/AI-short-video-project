/* ============================================================
   分镜的两种写法（2026-11-20 他定）：合并＝一镜一行「镜头N：……」；分区＝「镜头N：」独占一行，下面一栏一行、几个小节（公用/写稿状态.js 的 Zoned）。
   每条提示词的分镜两种都留着：提示词文件里放挑中的那种（出片就用它）；另一种存在写稿资料（_写稿.json）的「镜头信息」里，
   一镜一项：另一种（几行字）、另一种据（照挑中那种的哪一版写的，Zoned.key）。挑中那种后来改过、和「据」对不上，另一种就「旧了」。
   2026-11-21 他定：分区为主，合并留着备选。新稿一律先放分区；哪一条拨成了合并，写稿资料的「镜头写法」记着，这一条以后照合并（styleFor）。
   这里有一个任务：另写一种（「照分区重写合并」那类按钮）；还有别处用的几样：写提示词（AI 先写）、交给 AI 写完（pe-finish.js：
   人写的一大段拆成镜头、扩写，两种一起写）、按批注改提示词（两种一起改）。jobs.js 过了 1500 行，只挂几处钩子
   ============================================================ */
'use strict';
const crypto = require('crypto');
const path = require('path');

module.exports = function (d) {
  const { fsp, str, fail, segDir, unbom, today, TAIL, PromptDraft, exists, vpNeed, vpPath, vpLabel, withFileLocks, sideOf, keepCopy, writeFile, isPeText } = d;
  const Z = PromptDraft ? PromptDraft.Zoned : null;
  const STYLES = ['合并', '分区'];
  const otherOf = s => s === '合并' ? '分区' : '合并';
  const REPLY_NAMES = ['提示词', '素材登记', '秒数', 'GEO底稿', '判断', '标题', '合并', '分区', '另一种'];
  const sidePath = j => vpPath(j).replace(/\.txt$/, '_写稿.json');
  const relOf = j => ['提示词', segDir(j.段), str(j.名)];
  const noOf = n => String(Number(n) || n);
  const need = () => { if (!Z) throw fail('读不了 公用/写稿状态.js'); };
  const how = to => to === '合并' ? '一镜一行「镜头N：……」，一段话写完这一镜。'
    : '「镜头N：」独占一行，下面一栏一行：' + Z.HEAD.join('、') + '；接着小节一、小节二……，每个小节四栏：' + Z.SUB.join('、') + '（没台词写「台词：无」）；最后' + Z.TAIL.join('、') + '。一栏只写一行。';
  const NAME_RULE = '人物、道具只写称谓（照这一条素材里的叫法），不写 @图片N；场景图、首帧、关键帧这类才写 @图片N，编号照素材里已经挂好的。台词原文写在 {} 里，音效写在 <> 里。';
  const EG = {
    合并: ['镜头1：……', '镜头2：……'],
    分区: () => ['镜头1：', ...Z.HEAD.map(k => k + '：……'), '小节一', ...Z.SUB.map(k => k + '：……'), ...Z.TAIL.map(k => k + '：……'), '', '镜头2：', '……'],
  };
  const egOf = to => to === '合并' ? EG.合并 : EG.分区();
  const styleOf = (side, doc) => STYLES.includes(side.镜头写法) ? side.镜头写法 : doc.shots.some(s => Z.isZoned(s.lines)) ? '分区' : '合并';
  /* 新写的镜头放哪种（2026-11-21 他定：分区为主、合并备选）：这一条记着的那种；没记的用分区 */
  const styleFor = side => STYLES.includes(side && side.镜头写法) ? side.镜头写法 : '分区';

  /* AI 回复里掐出几块（【标题】【合并】【分区】【另一种】），剩下的照原样交给原来的读法（免得混进提示词、秒数、素材登记） */
  function takeBlocks(text, names) {
    let rest = String(text || '').replace(/\r\n/g, '\n');
    const got = {};
    for (const n of names) {
      const a = rest.indexOf('【' + n + '】');
      if (a < 0) continue;
      const from = a + n.length + 2;
      let z = rest.length;
      for (const m of REPLY_NAMES) { const i = rest.indexOf('\n【' + m + '】', from); if (i >= 0 && i < z) z = i; }
      got[n] = rest.slice(from, z);
      rest = rest.slice(0, a) + rest.slice(z);
    }
    return { rest, got };
  }
  /* 一块里的镜头：「镜头N：」开头，下面几行都算这一镜（读法照 写稿状态.js）。代码块的围栏、「声音包括」那一行不要 */
  function shotsIn(block) {
    if (block == null) return [];
    const t = String(block).split(/\r?\n/).filter(l => !/^\s*```/.test(l) && !PromptDraft.isLook(l.trim())).join('\n');
    return PromptDraft.parse('【事件脚本】\n' + t).shots.map(s => ({ no: noOf(s.no), lines: s.lines }));
  }
  function titlesIn(block) {
    const out = {};
    for (const l of String(block || '').split(/\r?\n/)) { const m = /^\s*镜头\s*([0-9０-９]+)\s*[：:｜|]\s*(.+?)\s*$/.exec(l); if (m) out[noOf(m[1])] = m[2].slice(0, 20); }
    return out;
  }
  /* 两份是不是同一组镜头、各照各的写法写的：对得上给 ''，不然说哪里不对 */
  function pairOk(merged, zoned) {
    if (!merged.length) return '合并那份一镜都没有';
    if (merged.map(s => s.no).join() !== zoned.map(s => s.no).join()) return '合并、分区两份的镜头对不上（' + merged.map(s => s.no).join('、') + ' 和 ' + (zoned.map(s => s.no).join('、') || '没有') + '）';
    const bm = merged.find(s => !s.lines.length || Z.isZoned(s.lines));
    if (bm) return '合并那份的镜头' + bm.no + '写得不对';
    const bz = zoned.find(s => !Z.isZoned(s.lines));
    return bz ? '分区那份的镜头' + bz.no + '没照分区写' : '';
  }
  /* 事件脚本换成这几镜（原来的镜头都换掉，人写的一整段也换掉，keepPre 的留着；最后「声音包括」那一行和别的几块不动） */
  function withShots(raw, shots, keepPre) {
    const doc = PromptDraft.parse(raw);
    if (!keepPre) doc.shotsPre = [];
    doc.shots = shots.map(s => ({ no: s.no, title: '', lines: [...s.lines] }));
    return PromptDraft.serialize(doc);
  }
  /* 写稿资料的「镜头信息」：一镜一项，另一种和它的「据」一起记 */
  function metaOf(chosen, alt, titles) {
    return chosen.map(s => {
      const a = alt.find(x => x.no === s.no);
      return { id: 'shot-' + crypto.randomUUID(), no: s.no, 作用: '', 关键词: {}, 原编号: '', 标题: str(titles[s.no]).trim(), ...(a ? { 另一种: a.lines, 另一种据: Z.key(s.lines) } : {}) };
    });
  }
  /* 哪几镜要另写：另一种还没有，或者旧了（挑中那种后来改过） */
  function needOf(doc, side) {
    const meta = Array.isArray(side.镜头信息) ? side.镜头信息 : [];
    return doc.shots.filter(s => s.lines.length).map(s => {
      const m = meta.find(x => x && String(x.no) === String(s.no)), old = m && Array.isArray(m.另一种) && m.另一种.length ? m.另一种 : null;
      return { no: noOf(s.no), lines: s.lines, old, stale: !!old && m.另一种据 !== Z.key(s.lines) };
    }).filter(x => !x.old || x.stale);
  }
  const readNow = async j => { const raw = await fsp.readFile(vpPath(j), 'utf8'); return { raw, doc: PromptDraft.parse(unbom(raw)) }; };

  /* ---------- 「照分区重写合并」那类按钮：照提示词里挑中的那种，把另一种还没有、旧了的几镜重写 ---------- */
  const 另写一种 = {
    title: j => '重写另一种写法 · 第' + j.段 + '段 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
    async prep(j) {
      await vpNeed(j); need();
      const { doc } = await readNow(j), side = await sideOf(j);
      if (!doc.shots.length) throw fail('事件脚本里还没有镜头：先写成一镜一镜的，或者点「AI 整理成分镜」');
      if (!needOf(doc, side).length) throw fail('两种都是照现在这版写的，不用重写');
    },
    async book(j) {
      const { raw, doc } = await readNow(j), side = await sideOf(j), from = styleOf(side, doc), to = otherOf(from), list = needOf(doc, side), meta = Array.isArray(side.镜头信息) ? side.镜头信息 : [];
      j.从 = from; j.据 = Object.fromEntries(list.map(x => [x.no, Z.key(x.lines)]));   // 照的是哪一版：回来的时候人又改过，这一镜照样显示旧了
      j.号 = Object.fromEntries(list.map(x => { const m = meta.find(y => y && String(y.no) === x.no); return [x.no, m && m.id ? String(m.id) : '']; }));   // 是哪一镜：等的时候挪了、删了，照这个认
      const nos = list.map(x => x.no), olds = list.filter(x => x.old);
      const rules = ['把下面「现在用的写法」里镜头 ' + nos.join('、') + ' 另用' + to + '写法写一份：意思、先后、每一镜拍的东西都一样，只是换个写法；不加不减事情，台词原文一字不改。',
        to + '写法：' + how(to), NAME_RULE, '只写这几镜，别的镜头不写。', '回复照下面这个样子，块名照抄：'].map((t, i) => (i + 1) + '. ' + t);
      return ['# 任务：把视频提示词的分镜换个写法另写一份', '',
        '今天 ' + today() + '。这是一个 AI 短视频项目。这一条视频提示词（文件：' + j.名 + '）的分镜现在用' + from + '写法写，人还要一份' + to + '写法的对照着挑。',
        '', '## 要求', ...rules, '【' + to + '】', ...egOf(to),
        '', '## 现在用的写法（' + from + '，提示词里就是它）', ...doc.shots.flatMap(s => Z.shotLines(noOf(s.no), s.lines)),
        ...(olds.length ? ['', '## 以前写的' + to + '（照旧的那一版写的，已经对不上了，可以照着改）', ...olds.flatMap(x => Z.shotLines(x.no, x.old))] : []),
        '', '## 这一条现在的全文（只看；镜头里的称谓照素材里的叫法）', unbom(raw).trim(), TAIL].join('\n');
    },
    async apply(j, text) {
      need();
      const to = otherOf(j.从), { got } = takeBlocks(text, [to]), shots = shotsIn(got[to]), wantZ = to === '分区';
      if (!shots.length) throw fail('AI 没按要的格式回（要【' + to + '】）');
      const bad = shots.find(s => !s.lines.length || Z.isZoned(s.lines) !== wantZ);
      if (bad) throw fail('AI 写的镜头' + bad.no + '没照' + to + '写法写');
      const rel = relOf(j), txt = vpPath(j), sp = sidePath(j), done = [];
      await withFileLocks([txt, sp], async () => {
        const { doc } = await readNow(j), side = await sideOf(j);
        if (styleOf(side, doc) !== j.从) throw fail('等 AI 的时候换了写法，这回没写进去');
        const meta = Array.isArray(side.镜头信息) ? side.镜头信息.map(x => ({ ...x })) : [], took = new Set();
        for (const s of shots) {
          if (!j.据 || !j.据[s.no] || took.has(s.no)) continue;   // 没让写的不要
          const id = j.号 && j.号[s.no];
          let m = id ? meta.find(x => x && x.id === id) : meta.find(x => x && String(x.no) === s.no);
          if (id && !m) continue;   // 等的时候删掉了
          const no = m ? noOf(m.no) : s.no;
          if (!doc.shots.some(x => noOf(x.no) === no)) continue;
          if (!m) { m = { id: 'shot-' + crypto.randomUUID(), no, 作用: '', 关键词: {}, 原编号: '', 标题: '' }; meta.push(m); }
          m.另一种 = s.lines; m.另一种据 = j.据[s.no]; took.add(s.no); done.push(no);   // 挪过的，照现在的号报
        }
        if (!done.length) throw fail('AI 写的镜头和要写的对不上');
        await keepCopy(j.项目, [...rel.slice(0, -1), path.basename(sp)]);
        await writeFile(sp, JSON.stringify({ ...side, 镜头信息: meta }, null, 2) + '\n');   // 「镜头写法」不添：没记的照旧由镜头的样子认（只记挑过的）
      });
      return { 结果: '照' + j.从 + '重写好了' + to + '那种（镜头' + done.join('、') + '）', 产出: [rel.join('/')] };
    },
  };

  /* ---------- 写提示词（AI 先写）：要求第 1 条后面接一句，回复多【分区】【标题】两块；写的时候分区放进提示词（styleFor） ---------- */
  const writeRule = Z ? '同一组镜头再用分区写法另写一份，放在回复的【分区】块里：镜头数、先后、每一镜拍的东西和【提示词】里的一样，只是换个写法——' + how('分区') + '每一镜再起个短标题（10 个字以内，只给人看），放在【标题】块里。' : '';
  const writeMore = Z ? 2 : 0;   // 回复多几块
  const writeEg = () => Z ? ['【分区】', ...egOf('分区'), '【标题】', '镜头1：……'] : [];
  /* prompt：AI 写的整份（合并写法）；got：掐出来的【分区】【标题】。给 { text：写进文件的正文, side：写稿资料（没有分区那份就是 null）, say：结果里补一句 } */
  async function forNew(j, prompt, got) {
    if (!Z) return { text: prompt, side: null, say: '' };
    const zoned = shotsIn(got && got.分区), merged = PromptDraft.parse(prompt).shots.map(s => ({ no: noOf(s.no), lines: s.lines }));
    if (!zoned.length) return { text: prompt, side: null, say: '' };
    if (pairOk(merged, zoned)) return { text: prompt, side: null, say: '；分区那份和提示词对不上，只放了合并的' };
    let had = {};
    try { if (await exists(sidePath(j))) had = await sideOf(j); } catch (e) { had = {}; }
    const style = styleFor(had), chosen = style === '分区' ? zoned : merged, alt = style === '分区' ? merged : zoned;
    const text = (style === '分区' ? withShots(prompt, zoned, true) : prompt).replace(/\s+$/, '');
    return { text, side: { 写法: '分镜', 写法范围: '分镜', 分镜稿: text + '\n', 自由稿: '', 镜头信息: metaOf(chosen, alt, titlesIn(got.标题)), 镜头写法: style }, say: '；合并、分区两种都写了，提示词里放的是' + style + '这种' };
  }
  /* 写进写稿资料（不记「手写」：流水线照旧当 AI 写的初稿）；早有一份的，别的几样（挂图这些）照留 */
  async function putSide(j, side) {
    if (!side) return;
    const sp = sidePath(j);
    await withFileLocks([sp], async () => { const old = (await exists(sp)) ? await sideOf(j) : {}; await writeFile(sp, JSON.stringify({ ...old, ...side }, null, 2) + '\n'); });
  }

  /* ---------- 按批注改提示词：存着另一种写法的，任务书里摆出来，改到哪一镜另一种跟着改 ---------- */
  async function fixPart(j, vpText) {   // 给任务书的几行（没存另一种的给 []）
    if (!Z || !isPeText(vpText)) return [];
    let side = {};
    try { side = await sideOf(j); } catch (e) { return []; }
    const doc = PromptDraft.parse(vpText), meta = Array.isArray(side.镜头信息) ? side.镜头信息 : [];
    const alts = doc.shots.map(s => { const m = meta.find(x => x && String(x.no) === String(s.no)); return m && Array.isArray(m.另一种) && m.另一种.length ? { no: noOf(s.no), lines: m.另一种 } : null; }).filter(Boolean);
    if (!alts.length) return [];
    const from = styleOf(side, doc), to = otherOf(from);
    j.另一种 = to;
    return ['', '## 另一种写法（存在写稿资料里，出片用的是上面原文里的' + from + '写法）',
      '这一条的分镜还另存着一份' + to + '写法（' + how(to) + '）。批注改到哪一镜，另一种里同一镜也照着改，意思一样、写法照' + to + '。回复最后另起一块【另一种】，只写改到的那几镜（「镜头N：」开头的整镜）；没改到镜头就不写这一块。',
      ...alts.flatMap(a => Z.shotLines(a.no, a.lines))];
  }
  /* 按批注改写好以后：【另一种】里的几镜记进写稿资料，「据」照改好的这一版 */
  async function fixApply(j, block, out) {
    if (!Z || !j.另一种 || block == null) return '';
    const shots = shotsIn(block), wantZ = j.另一种 === '分区', doc = PromptDraft.parse(unbom(out)), sp = sidePath(j), done = [];
    if (!shots.length) return '';
    await withFileLocks([sp], async () => {
      const side = await sideOf(j), meta = Array.isArray(side.镜头信息) ? side.镜头信息.map(x => ({ ...x })) : [];
      for (const s of shots) {
        const cur = doc.shots.find(x => noOf(x.no) === s.no), m = meta.find(x => x && String(x.no) === s.no);
        if (!cur || !m || !s.lines.length || Z.isZoned(s.lines) !== wantZ || done.includes(s.no)) continue;
        m.另一种 = s.lines; m.另一种据 = Z.key(cur.lines); done.push(s.no);
      }
      if (done.length) await writeFile(sp, JSON.stringify({ ...side, 镜头信息: meta }, null, 2) + '\n');
    });
    return done.length ? '；另一种（' + j.另一种 + '）也跟着改了镜头' + done.join('、') : '';
  }

  return { KINDS: { 另写一种 }, STYLES, how, egOf, NAME_RULE, styleFor, takeBlocks, shotsIn, titlesIn, pairOk, withShots, metaOf, needOf, writeRule, writeMore, writeEg, forNew, putSide, fixPart, fixApply };
};
