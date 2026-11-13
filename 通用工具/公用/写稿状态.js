/* 结构化提示词的无损读写。自由稿直接保存字符串，不经过本模块。
 * _source 只属于编辑状态；保留它可在只改一格时复用其他区、其他镜头的原文。
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PromptDraft = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BOM = '\uFEFF';
  const ORDER = ['pre', 'event', 'refs', 'basic', 'seg', 'shots', 'keep'];
  const HEADS = { refs: '素材', basic: '基础设定', seg: '本段', shots: '分镜' };
  const KEYS = Object.fromEntries(Object.entries(HEADS).map(([key, name]) => [name, key]));
  const strings = value => Array.isArray(value) ? value.map(x => String(x)) : [];
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const clone = value => JSON.parse(JSON.stringify(value));
  const rawOf = tokens => tokens.map(t => t.text + t.eol).join('');
  const trim = text => text.trim();

  function labelOf(text) {
    const m = /^([^：:\n]{1,10})[：:]/.exec(text);
    if (!m) return null;
    const label = m[1].trim();
    return /^[㐀-鿿豈-﫿A-Za-z\/｜·]{1,10}$/.test(label) ? { label, value: text.slice(m[0].length) } : null;
  }

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

  function shotValue(shot) {
    return { no: String(shot.no == null ? '' : shot.no), title: String(shot.title || ''), lines: strings(shot.lines) };
  }

  function contentOf(doc) {
    return {
      pre: strings(doc.pre), event: String(doc.event || ''), refs: strings(doc.refs),
      basic: strings(doc.basic), seg: strings(doc.seg), shotsPre: strings(doc.shotsPre),
      shots: (doc.shots || []).map(shotValue), keep: String(doc.keep || ''),
    };
  }

  function parse(value) {
    if (typeof value !== 'string') throw new TypeError('提示词必须是字符串');
    const doc = { bom: value.startsWith(BOM), eol: /\r\n/.test(value) ? '\r\n' : /\r/.test(value) ? '\r' : '\n',
      pre: [], event: '', refs: [], basic: [], seg: [], shotsPre: [], shots: [], keep: '', has: {} };
    const text = doc.bom ? value.slice(1) : value;
    const parts = [];
    let part = { key: 'pre', tokens: [], header: null }, shot = null;
    parts.push(part);
    const start = (key, token) => {
      part = { key, tokens: [token], header: token };
      if (key === 'shots') part.preTokens = [];
      parts.push(part); shot = null;
    };
    for (const token of tokenize(text)) {
      const t = token.text.trim(), heading = t.replace(/\s+/g, '');
      const key = Object.prototype.hasOwnProperty.call(KEYS, heading) ? KEYS[heading] : null;
      const label = labelOf(t);
      if (key) { start(key, token); doc.has[key] = true; continue; }
      if (label && label.label === '本段事件' && part.key === 'pre') {
        start('event', token); doc.event = label.value.trim(); continue;
      }
      if (label && label.label === '保持一致' && part.key !== 'keep') {
        start('keep', token); doc.keep = label.value.trim(); doc.has.keep = true; continue;
      }
      part.tokens.push(token);
      const match = part.key === 'shots' && /^镜头\s*([0-9０-９]+)\s*[｜|：:]?\s*(.*)$/.exec(t);
      if (match) {
        shot = { no: match[1], title: match[2], lines: [], _source: { tokens: [token] } };
        doc.shots.push(shot); continue;
      }
      if (part.key === 'shots') (shot ? shot._source.tokens : part.preTokens).push(token);
      if (!t) continue;
      if (part.key === 'event' || part.key === 'keep') doc[part.key] += t;
      else if (part.key === 'shots') (shot ? shot.lines : doc.shotsPre).push(t);
      else doc[part.key].push(normalizeLine(t, part.key));
    }
    for (const current of doc.shots) {
      current._source.raw = rawOf(current._source.tokens);
      current._source.value = shotValue(current);
    }
    for (const current of parts) current.raw = rawOf(current.tokens);
    doc._source = { text, parts, value: clone(contentOf(doc)) };
    return doc;
  }

  function withEol(text, eol) { return text && !/[\r\n]$/.test(text) ? text + eol : text; }

  function replaceLine(token, value, eol, needsBreak) {
    const leading = /^\s*/.exec(token.text)[0], trailing = /\s*$/.exec(token.text)[0];
    return leading + value + trailing + (token.eol || (needsBreak ? eol : ''));
  }

  // 通常是同一行改了几个字：其他行连空格、行尾都不动。
  // 插删行时用共同子序列对齐，保留仍在原稿中的行及其前面的空行。
  function renderLines(tokens, values, key, eol) {
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
      return line + (needsBreak || tokens.some(t => t.eol) ? eol : '');
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

  function changed(doc, key, source) {
    const now = contentOf(doc);
    return key === 'shots' ? !equal(now.shots, source.value.shots) || !equal(now.shotsPre, source.value.shotsPre)
      : !equal(now[key], source.value[key]);
  }

  function renderSection(doc, key, parts, eol) {
    const first = parts[0];
    if (key === 'shots') {
      const header = first && first.header ? rawOf([first.header]) : HEADS.shots + eol;
      const pre = renderLines(parts.flatMap(p => p.preTokens || []), doc.shotsPre, 'shots', eol);
      const chunks = [header, pre, ...(doc.shots || []).map(s => renderShot(s, eol))].filter(Boolean);
      return chunks.map((chunk, i) => i < chunks.length - 1 ? withEol(chunk, eol) : chunk).join('');
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
    const tokens = parts.flatMap(p => p.header ? p.tokens.slice(1) : p.tokens);
    const header = key === 'pre' ? '' : first && first.header ? rawOf([first.header]) : HEADS[key] + eol;
    const body = renderLines(tokens, doc[key], key, eol);
    return (body ? withEol(header, eol) : header) + body;
  }

  function documentText(doc, replacement) {
    if (!doc || typeof doc !== 'object') throw new TypeError('提示词文档无效');
    const replaceShots = replacement !== undefined;
    const eol = ['\n', '\r\n', '\r'].includes(doc.eol) ? doc.eol : '\n';
    const source = doc._source;
    const prefix = doc.bom ? BOM : '';
    const render = (key, parts) => {
      if (key !== 'shots' || !replaceShots) return renderSection(doc, key, parts, eol);
      const first = parts[0];
      const header = first && first.header ? rawOf([first.header]) : HEADS.shots + eol;
      return (replacement ? withEol(header, eol) : header) + replacement;
    };
    if (source && !replaceShots && equal(contentOf(doc), source.value)) return prefix + source.text;
    if (!source) {
      const keys = ORDER.filter(k => k !== 'pre' || strings(doc.pre).length);
      return prefix + keys.map(k => render(k, [])).map(text => withEol(text, eol)).join(eol);
    }
    const present = new Set(source.parts.map(p => p.key)), emitted = new Set(), output = [];
    const needed = ORDER.filter(key => !present.has(key) && (key === 'shots'
      ? replaceShots || (doc.shots || []).length || strings(doc.shotsPre).length
      : Array.isArray(doc[key]) ? doc[key].length : !!doc[key]));
    for (const part of source.parts) {
      for (const key of needed) if (!emitted.has(key) && ORDER.indexOf(key) < ORDER.indexOf(part.key)) {
        output.push(render(key, [])); emitted.add(key);
      }
      if (!(replaceShots && part.key === 'shots') && !changed(doc, part.key, source)) output.push(part.raw);
      else if (!emitted.has(part.key)) {
        output.push(render(part.key, source.parts.filter(p => p.key === part.key)));
        emitted.add(part.key);
      }
    }
    for (const key of needed) if (!emitted.has(key)) output.push(render(key, []));
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

  return Object.freeze({ parse, serialize, shotText, withShotText });
});
