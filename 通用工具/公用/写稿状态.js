/* 结构化提示词的无损读写。自由稿直接保存字符串，不经过本模块。
 * 认两种稿：
 *   pe   ：照 sd2.5PE 写的（2026-11-13 起新写的稿）。【生成目标】【参考素材职责】……【基础设定】【主体与关系】【事件脚本】【保持一致】，
 *          素材那几段（写法一的【参考素材职责】【未采用素材】，写法二的【人物】【道具】【场景】【动作与声音】【未采用素材】）连成一区，段名留在行里；
 *          【基础设定】写影像风格、摄影、光色基调，放在事件脚本前面（2026-11-14 用户定）；
 *          【事件脚本】里一镜一行「镜头1：……」，最后「声音包括……」那一行（老稿是「最终画面采用……」）也算进基础设定这一格，写回时仍跟在镜头后面。镜头标题不写进文件。
 *   merged：旧的六区稿（本段事件、素材、基础设定、本段、分镜、保持一致），照旧读写。
 * 两种读成同一组字段：event 生成目标/本段事件，refs 素材，seg 主体与关系/本段，basic 基础设定（PE 稿连同事件脚本最后那一行），shots 分镜，keep 保持一致。
 * _source 只属于编辑状态；保留它可在只改一格时复用其他区、其他镜头的原文。
 */
(function (root, factory) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./核心.js') : root.Core);   // 网页里要先引 核心.js
  if (node) module.exports = api;
  else root.PromptDraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
  'use strict';
  if (!Core) throw new Error('写稿状态.js 要先引 核心.js');

  const BOM = String.fromCharCode(0xFEFF);
  const ORDER = ['pre', 'event', 'refs', 'basic', 'seg', 'shots', 'keep'];
  // look：PE 稿事件脚本最后「声音包括……」（老稿「最终画面采用……」）那一行的位置；内容记在 basic 里
  const PE_ORDER = ['pre', 'event', 'refs', 'basic', 'seg', 'shots', 'look', 'keep'];
  const HEADS = { refs: '素材', basic: '基础设定', seg: '本段', shots: '分镜' };
  const KEYS = Object.fromEntries(Object.entries(HEADS).map(([key, name]) => [name, key]));
  const PE_HEADS = { event: '【生成目标】', basic: '【基础设定】', seg: '【主体与关系】', shots: '【事件脚本】', keep: '【保持一致】' };
  const PE_KEYS = Object.fromEntries(Object.entries(PE_HEADS).map(([key, name]) => [name, key]));
  const PE_REFS = ['【参考素材职责】', '【人物】', '【道具】', '【场景】', '【动作与声音】', '【未采用素材】'];
  const isPeRefHead = heading => PE_REFS.includes(heading) || /^【主体设定[：:][^】]*】$/.test(heading);
  const isLook = text => /^(最终画面|声音包括)/.test(text);
  const strings = value => Array.isArray(value) ? value.map(x => String(x)) : [];
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = value => JSON.parse(JSON.stringify(value));
  const rawOf = tokens => tokens.map(t => t.text + t.eol).join('');
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  const labelOf = Core.splitLabel;   // 「标签：内容」照 核心.js 的认法（和编辑器、流水线一套）

  // 与编辑器的标签/正文两格保持一致。原来的空格仍在 _source 中，回写时复用。
  function normalizeLine(text, key) {
    const value = text.trim();
    const label = key === 'basic' || key === 'seg' ? labelOf(value) : null;
    return label ? label.label + '：' + label.value.trim() : value;
  }

  function tokenize(text) {
    const result = [];
    const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
    let match;
    while ((match = re.exec(text)) && match[0]) result.push({ text: match[1], eol: match[2] });
    return result;
  }

  /* 有一行是 sd2.5PE 才有的段名（【生成目标】【基础设定】【主体与关系】【事件脚本】【保持一致】）就是 pe 稿。
     旧稿的「素材」里也写【参考素材职责】【未采用素材】，所以这两个不算 */
  function formatOf(text) {
    for (const line of text.split(/\r\n|\n|\r/)) if (has(PE_KEYS, line.trim().replace(/\s+/g, ''))) return 'pe';
    return 'merged';
  }

  // pe 稿的镜头标题不在文件里：只比编号和正文
  function shotValue(shot, pe) {
    return { no: String(shot.no == null ? '' : shot.no), title: pe ? '' : String(shot.title || ''), lines: strings(shot.lines) };
  }

  function contentOf(doc) {
    const pe = doc.fmt === 'pe';
    return {
      pre: strings(doc.pre), event: String(doc.event || ''), refs: strings(doc.refs),
      basic: strings(doc.basic), seg: strings(doc.seg), shotsPre: strings(doc.shotsPre),
      shots: (doc.shots || []).map(s => shotValue(s, pe)), keep: String(doc.keep || ''),
    };
  }

  function parse(value) {
    if (typeof value !== 'string') throw new TypeError('提示词必须是字符串');
    const doc = { fmt: 'merged', bom: value.startsWith(BOM), eol: /\r\n/.test(value) ? '\r\n' : /\r/.test(value) ? '\r' : '\n',
      pre: [], event: '', refs: [], basic: [], seg: [], shotsPre: [], shots: [], keep: '', has: {} };
    const text = doc.bom ? value.slice(1) : value;
    const pe = (doc.fmt = formatOf(text)) === 'pe';
    const parts = [];
    let part = { key: 'pre', tokens: [], header: null }, shot = null;
    parts.push(part);
    const start = (key, token, header) => {
      part = { key, tokens: [token], header: header === undefined ? token : header };
      if (key === 'shots') part.preTokens = [];
      parts.push(part); shot = null;
    };
    for (const token of tokenize(text)) {
      const t = token.text.trim(), heading = t.replace(/\s+/g, '');
      if (pe) {
        if (has(PE_KEYS, heading)) { start(PE_KEYS[heading], token); doc.has[PE_KEYS[heading]] = true; continue; }
        if (isPeRefHead(heading)) {   // 素材那几段连成一区；段名没有单独的 header，当一行留在 refs 里
          if (part.key !== 'refs') start('refs', token, null); else part.tokens.push(token);
          doc.refs.push(t); doc.has.refs = true; continue;
        }
        if ((part.key === 'shots' || part.key === 'look') && isLook(t)) {   // 事件脚本最后的「声音包括……」（老稿「最终画面采用……」），内容记在 basic
          if (part.key !== 'look') start('look', token, null); else part.tokens.push(token);
          doc.basic.push(normalizeLine(t, 'basic')); doc.has.basic = true; continue;
        }
      } else {
        const key = has(KEYS, heading) ? KEYS[heading] : null;
        const label = labelOf(t);
        if (key) { start(key, token); doc.has[key] = true; continue; }
        if (label && label.label === '本段事件' && part.key === 'pre') {
          start('event', token); doc.event = label.value.trim(); continue;
        }
        if (label && label.label === '保持一致' && part.key !== 'keep') {
          start('keep', token); doc.keep = label.value.trim(); doc.has.keep = true; continue;
        }
      }
      part.tokens.push(token);
      const match = part.key === 'shots' && /^镜头\s*([0-9０-９]+)\s*[｜|：:]?\s*(.*)$/.exec(t);
      if (match) {
        shot = pe ? { no: match[1], title: '', lines: match[2] ? [match[2]] : [], _source: { tokens: [token] } }
          : { no: match[1], title: match[2], lines: [], _source: { tokens: [token] } };
        doc.shots.push(shot); continue;
      }
      if (part.key === 'shots') (shot ? shot._source.tokens : part.preTokens).push(token);
      if (!t) continue;
      if (part.key === 'event' || part.key === 'keep') doc[part.key] += t;
      else if (part.key === 'shots') (shot ? shot.lines : doc.shotsPre).push(t);
      else if (part.key === 'look') doc.basic.push(normalizeLine(t, 'basic'));
      else doc[part.key].push(normalizeLine(t, part.key));
    }
    for (const current of doc.shots) {
      current._source.raw = rawOf(current._source.tokens);
      current._source.value = shotValue(current, pe);
    }
    for (const current of parts) current.raw = rawOf(current.tokens);
    doc._source = { text, parts, value: clone(contentOf(doc)) };
    return doc;
  }

  function withEol(text, eol) { return text && !/[\r\n]$/.test(text) ? text + eol : text; }
  const endsBlank = text => !text || /\n[ \t]*\n$/.test(text.replace(/\r\n?/g, '\n'));   // 先统一换行：不然一个 \r\n 会被当成两次换行

  function replaceLine(token, value, eol, needsBreak) {
    const leading = /^\s*/.exec(token.text)[0], trailing = /\s*$/.exec(token.text)[0];
    return leading + value + trailing + (token.eol || (needsBreak ? eol : ''));
  }

  // 通常是同一行改了几个字：其他行连空格、行尾都不动。
  // 插删行时用共同子序列对齐，保留仍在原稿中的行及其前面的空行。
  // gapHead：PE 稿的素材里新插进来的分组名（【道具】等）前面空一行，和别的分组一样
  function renderLines(tokens, values, key, eol, gapHead) {
    const next = strings(values), meaningful = tokens.filter(t => t.text.trim());
    const previous = meaningful.map(t => normalizeLine(t.text, key));
    if (equal(previous, next)) return rawOf(tokens);
    if (previous.length === next.length) {
      let index = 0;
      return tokens.map((token, i) => {
        if (!token.text.trim()) return token.text + token.eol;
        const n = index++;
        return previous[n] === next[n] ? token.text + token.eol : replaceLine(token, next[n], eol, i < tokens.length - 1);
      }).join('');
    }
    const groups = [], pending = [];
    for (const token of tokens) {
      if (!token.text.trim()) pending.push(token);
      else { groups.push({ before: pending.splice(0), token }); }
    }
    const matches = new Map();
    // 防止意外粘贴超大文本造成二维矩阵占满内存；大稿采用有序匹配。
    if (previous.length * next.length <= 1000000) {
      const rows = Array.from({ length: previous.length + 1 }, () => new Uint32Array(next.length + 1));
      for (let i = previous.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--)
        rows[i][j] = previous[i] === next[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
      for (let i = 0, j = 0; i < previous.length && j < next.length;) {
        if (previous[i] === next[j]) { matches.set(j++, i++); }
        else if (rows[i + 1][j] >= rows[i][j + 1]) i++; else j++;
      }
    } else {
      let from = 0;
      for (let j = 0; j < next.length; j++) {
        const at = previous.indexOf(next[j], from);
        if (at >= 0) { matches.set(j, at); from = at + 1; }
      }
    }
    const tail = rawOf(pending);
    return next.map((line, i) => {
      const at = matches.get(i), needsBreak = i < next.length - 1 || !!tail;
      if (at !== undefined) {
        const group = groups[at], raw = rawOf(group.before) + rawOf([group.token]);
        return needsBreak ? withEol(raw, eol) : raw;
      }
      const gap = gapHead && i > 0 && isPeRefHead(line.replace(/\s+/g, '')) ? eol : '';
      return gap + line + (needsBreak || tokens.some(t => t.eol) ? eol : '');
    }).join('') + tail;
  }

  function renderShot(shot, eol) {
    const value = shotValue(shot), source = shot._source;
    if (!source || !Array.isArray(source.tokens) || !source.tokens.length)
      return '镜头 ' + value.no + '｜' + value.title + eol + value.lines.join(eol) + eol + eol;
    if (equal(source.value, value)) return source.raw;
    const token = source.tokens[0];
    let heading = token.text;
    if (source.value.no !== value.no || source.value.title !== value.title) {
      const m = /^(\s*镜头\s*)([0-9０-９]+)(.*)$/.exec(heading);
      if (m) {
        let suffix = m[3];
        if (source.value.title !== value.title) {
          const rest = /^(\s*[｜|：:]\s*|\s*)(.*?)(\s*)$/.exec(suffix);
          suffix = (rest[1] || (value.title ? '｜' : '')) + value.title + rest[3];
        }
        heading = m[1] + value.no + suffix;
      } else heading = '镜头 ' + value.no + '｜' + value.title;
    }
    const body = renderLines(source.tokens.slice(1), value.lines, 'shot', eol);
    return heading + (token.eol || (body ? eol : '')) + body;
  }

  // pe 稿一镜一行「镜头1：正文」；改过的镜头整镜重写，镜头后面原有的空行留着
  function renderPeShot(shot, eol) {
    const value = shotValue(shot, true), source = shot._source;
    if (!source || !Array.isArray(source.tokens) || !source.tokens.length) return '镜头' + value.no + '：' + value.lines.join(eol) + eol;
    if (equal(source.value, value)) return source.raw;
    const tokens = source.tokens;
    let end = tokens.length;
    while (end > 1 && !tokens[end - 1].text.trim()) end--;
    const m = /^(\s*镜头\s*)[0-9０-９]+(\s*[｜|：:]?\s*)/.exec(tokens[0].text), trailing = /\s*$/.exec(tokens[end - 1].text)[0];
    const head = m ? m[1] + value.no + (m[2].trim() ? m[2] : '：') : '镜头' + value.no + '：';
    return head + value.lines.join(eol) + (value.lines.length ? trailing : '') + (tokens[end - 1].eol || (end < tokens.length ? eol : '')) + rawOf(tokens.slice(end));
  }

  function changed(doc, key, source) {
    const now = contentOf(doc);
    if (key === 'look') key = 'basic';   // 事件脚本最后那一行记在 basic 里
    return key === 'shots' ? !equal(now.shots, source.value.shots) || !equal(now.shotsPre, source.value.shotsPre)
      : !equal(now[key], source.value[key]);
  }

  const headOf = (doc, key) => (doc.fmt === 'pe' ? PE_HEADS : HEADS)[key];

  // PE 稿的 basic 分两处写：「声音包括……」「最终画面采用……」跟在镜头后面（look），其余写进【基础设定】
  function linesOf(doc, key) {
    if (doc.fmt === 'pe' && (key === 'basic' || key === 'look')) return strings(doc.basic).filter(line => isLook(line) === (key === 'look'));
    return strings(doc[key]);
  }

  function renderSection(doc, key, parts, eol) {
    const pe = doc.fmt === 'pe', first = parts[0];
    if (key === 'shots') {
      const header = first && first.header ? rawOf([first.header]) : headOf(doc, 'shots') + eol;
      const pre = renderLines(parts.flatMap(p => p.preTokens || []), doc.shotsPre, 'shots', eol);
      const chunks = [header, pre, ...(doc.shots || []).map(s => pe ? renderPeShot(s, eol) : renderShot(s, eol))].filter(Boolean);
      return chunks.map((chunk, i) => i < chunks.length - 1 ? withEol(chunk, eol) : chunk).join('');
    }
    if ((key === 'event' || key === 'keep') && pe) {   // 段名独占一行，下面一段话
      const token = first && first.header, value = String(doc[key] || '');
      const header = token ? rawOf([token]) : PE_HEADS[key] + eol;
      const body = renderLines(first ? first.tokens.slice(1) : [], value ? [value] : [], key, eol);
      return (body ? withEol(header, eol) : header) + body;
    }
    if (key === 'event' || key === 'keep') {
      const label = key === 'event' ? '本段事件' : '保持一致';
      const token = first && first.header;
      const prefix = token && new RegExp('^(\\s*' + label + '\\s*[：:]\\s*)').exec(token.text);
      const trailing = token ? /\s*$/.exec(token.text)[0] : '';
      const body = first ? first.tokens.slice(1) : [];
      const tail = [];
      for (let i = body.length - 1; i >= 0 && !body[i].text.trim(); i--) tail.unshift(body[i]);
      return (prefix ? prefix[1] : label + '：') + String(doc[key] || '') + trailing +
        (token ? token.eol || (tail.length ? eol : '') : eol) + rawOf(tail);
    }
    let lines = linesOf(doc, key);
    if (pe && key !== 'pre' && !lines.length) return '';   // pe 稿里 AI 写的段清空了：连段名一起不写
    // 素材前面一定要有段名，读回来才不会并进生成目标
    if (pe && key === 'refs' && !isPeRefHead(lines[0].replace(/\s+/g, ''))) lines = ['【参考素材职责】', ...lines];
    const tokens = parts.flatMap(p => p.header ? p.tokens.slice(1) : p.tokens);
    const header = key === 'pre' || (pe && (key === 'refs' || key === 'look')) ? ''
      : first && first.header ? rawOf([first.header]) : headOf(doc, key) + eol;
    const body = renderLines(tokens, lines, key === 'look' ? 'basic' : key, eol, pe && key === 'refs');
    return (body ? withEol(header, eol) : header) + body;
  }

  function documentText(doc, replacement) {
    if (!doc || typeof doc !== 'object') throw new TypeError('提示词文档无效');
    const replaceShots = replacement !== undefined;
    const eol = ['\n', '\r\n', '\r'].includes(doc.eol) ? doc.eol : '\n';
    const pe = doc.fmt === 'pe', order = pe ? PE_ORDER : ORDER;
    const source = doc._source;
    const prefix = doc.bom ? BOM : '';
    const render = (key, parts) => {
      if (key !== 'shots' || !replaceShots) return renderSection(doc, key, parts, eol);
      const first = parts[0];
      const header = first && first.header ? rawOf([first.header]) : headOf(doc, 'shots') + eol;
      return (replacement ? withEol(header, eol) : header) + replacement;
    };
    if (source && !replaceShots && equal(contentOf(doc), source.value)) return prefix + source.text;
    if (!source) {
      const keys = order.filter(k => k !== 'pre' || strings(doc.pre).length);
      return prefix + keys.map(k => render(k, [])).filter(text => !pe || text).map(text => withEol(text, eol)).join(eol);
    }
    const present = new Set(source.parts.map(p => p.key)), emitted = new Set(), output = [];
    // PE 稿的基础设定没改时，各行都还在原处（哪怕「声音包括」写在【基础设定】里），不另长新段
    const lookMoves = pe && changed(doc, 'basic', source);
    const needed = order.filter(key => !present.has(key) && (key === 'shots'
      ? replaceShots || (doc.shots || []).length || strings(doc.shotsPre).length
      : pe && (key === 'basic' || key === 'look') ? lookMoves && linesOf(doc, key).length > 0
      : Array.isArray(doc[key]) ? doc[key].length : !!doc[key]));
    // pe 稿新长出来的段，前后各隔一个空行
    const fresh = key => { const text = render(key, []); return pe && text ? withEol(text, eol) + eol : text; };
    // 新长出来的「声音包括……」紧跟最后一镜，不隔空行；最后一镜后面原有的空行挪到它后面，后面还有段就至少空一行
    const glueLook = more => {
      const text = render('look', []);
      let i = output.length - 1;
      while (i >= 0 && !output[i]) i--;
      const m = i >= 0 && /(\r\n|\n|\r)((?:[ \t]*(?:\r\n|\n|\r))*)$/.exec(output[i]);
      if (!m) { output.push(more ? withEol(text, eol) + eol : text); return; }   // 最后一镜没有换行：拼起来时会补一个，这里不再多加
      output[i] = output[i].slice(0, m.index) + m[1] + withEol(text, eol) + (m[2] || (more ? eol : ''));
    };
    for (const part of source.parts) {
      for (const key of needed) if (!emitted.has(key) && order.indexOf(key) < order.indexOf(part.key)) {
        if (pe && key === 'look') glueLook(true); else output.push(fresh(key));
        emitted.add(key);
      }
      if (!(replaceShots && part.key === 'shots') && !changed(doc, part.key, source)) output.push(part.raw);
      else if (!emitted.has(part.key)) {
        const text = render(part.key, source.parts.filter(p => p.key === part.key));
        // 事件脚本最后那一行删光了：留下它后面的空行，免得最后一镜和【保持一致】挤在一起
        output.push(text || (part.key === 'look' ? rawOf(part.tokens.filter(t => !t.text.trim())) : ''));
        emitted.add(part.key);
      }
    }
    for (const key of needed) if (!emitted.has(key)) {
      if (pe && key === 'look') { glueLook(false); continue; }
      const last = output.filter(Boolean).pop();
      output.push((pe && last && !endsBlank(withEol(last, eol)) ? eol : '') + render(key, []));
    }
    const chunks = output.filter(Boolean);
    return prefix + chunks.map((chunk, i) => i < chunks.length - 1 ? withEol(chunk, eol) : chunk).join('');
  }

  function serialize(doc) { return documentText(doc); }

  // 只读取分镜标题之下的正文，公共区完全不参与模式转换。
  function shotText(doc) {
    if (!doc || typeof doc !== 'object') throw new TypeError('提示词文档无效');
    const source = doc._source;
    const parts = source ? source.parts.filter(part => part.key === 'shots') : [];
    if (!parts.length && !(doc.shots || []).length && !strings(doc.shotsPre).length) return '';
    if (source && !changed(doc, 'shots', source))
      return parts.map(part => part.raw.slice(part.header ? rawOf([part.header]).length : 0)).join('');
    const text = renderSection(doc, 'shots', parts, ['\n', '\r\n', '\r'].includes(doc.eol) ? doc.eol : '\n');
    return text.replace(/^[^\r\n]*(?:\r\n|\n|\r|$)/, '');
  }

  // 按结构化稿的已知边界替换。不可 parse(rawText)，否则用户正文中的标题会被误识别。
  function withShotText(doc, rawText) {
    if (typeof rawText !== 'string') throw new TypeError('自由分镜必须是字符串');
    if (rawText === shotText(doc)) return serialize(doc);
    return documentText(doc, rawText);
  }

  /* 新写的稿用的空骨架：只有你写的两段，AI 写的段采用建议时自动长出来 */
  const PE_SKELETON = ['【生成目标】', '', '【事件脚本】', ''];
  function skeleton(eol) { return PE_SKELETON.join(eol || '\r\n'); }

  return Object.freeze({ parse, serialize, shotText, withShotText, skeleton, formatOf, isPeRefHead, isLook, PE_HEADS, PE_REFS });
});
