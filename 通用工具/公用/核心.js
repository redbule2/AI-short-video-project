/* 核心逻辑（window.Core）：流水线各页、看文件的那一页（项目管理.html）、剧本读写.js 都用这一份，别处没有副本。 */
/* ============================================================
   案头 · 核心逻辑（不碰界面）
   ZIP 读写 · DOCX 读写 · 剧本 / 镜头表 / 提示词 的解析、生成与校对
   ============================================================ */
(function (G) {
'use strict';

const TE = new TextEncoder();
const TD = new TextDecoder('utf-8');

/* ---------- 小工具 ---------- */
const toHalf = s => String(s).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const normSeg = s => toHalf(s).replace(/\s+/g, '').replace(/[－—–]/g, '-');
const SEG_NUM = '[0-9０-９]+(?:\\s*[-－—–]\\s*[0-9０-９]+)*';
const RE_SEG_IN_NAME = new RegExp('第\\s*(' + SEG_NUM + ')\\s*段');
const RE_SEG_RANGE = new RegExp('第\\s*(' + SEG_NUM + ')\\s*[至到~～]\\s*(' + SEG_NUM + ')\\s*段');

function segFromName(name) {
  if (RE_SEG_RANGE.test(name)) return null;
  const m = RE_SEG_IN_NAME.exec(name);
  return m ? normSeg(m[1]) : null;
}
function isRangeName(name) { return RE_SEG_RANGE.test(name); }
function segCompare(a, b) {
  const pa = String(a).split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b).split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? -1, y = pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return String(a).localeCompare(String(b));
}
function nextSeg(segs) {
  const list = [...segs].filter(Boolean).sort(segCompare);
  if (!list.length) return '1-1';
  const parts = list[list.length - 1].split('-');
  parts[parts.length - 1] = String(Number(parts[parts.length - 1]) + 1);
  return parts.join('-');
}
let _uid = 0;
const uid = () => 'k' + (++_uid).toString(36);
const blk = text => ({ id: uid(), text: String(text) });
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const cleanPara = s => String(s || '').replace(/\u00A0/g, ' ').replace(/^[\s\u3000]+|[\s\u3000]+$/g, '');

/* 「标签：内容」——标签 1–10 个字，只能是汉字、字母、/、｜、· */
const RE_LABEL_HEAD = /^([^：:\n]{1,10})[：:]/;
const RE_LABEL_OK = /^[\u3400-\u9fff\uf900-\ufaffA-Za-z\/｜·]{1,10}$/;
function splitLabel(line) {
  const m = RE_LABEL_HEAD.exec(line);
  if (!m) return null;
  const label = m[1].trim();
  if (!RE_LABEL_OK.test(label)) return null;
  return { label, value: line.slice(m[0].length) };
}
function labelOf(text) { const f = splitLabel(text); return f ? f.label : ''; }

/* ---------- CRC32 / 压缩流 ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function pipe(u8, ts) {
  const out = await new Response(new Blob([u8]).stream().pipeThrough(ts)).arrayBuffer();
  return new Uint8Array(out);
}
const inflateRaw = u8 => pipe(u8, new DecompressionStream('deflate-raw'));
const deflateRaw = u8 => pipe(u8, new CompressionStream('deflate-raw'));
function concat(chunks) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

/* ---------- ZIP 读 ---------- */
async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 22) throw new Error('文件是空的，或者不是 DOCX');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 DOCX 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('DOCX 内部目录损坏');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = TD.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      if (dv.getUint32(e.off, true) !== 0x04034b50) throw new Error('DOCX 内部文件损坏：' + name);
      const ln = dv.getUint16(e.off + 26, true), lx = dv.getUint16(e.off + 28, true);
      const start = e.off + 30 + ln + lx;
      const data = u8.subarray(start, start + e.csize);
      if (e.method === 0) return data.slice();
      if (e.method === 8) return inflateRaw(data);
      throw new Error('不支持的压缩方式：' + e.method);
    },
    async text(name) { const b = await this.read(name); return b ? TD.decode(b) : null; },
  };
}

/* ---------- ZIP 写 ---------- */
async function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const canDeflate = typeof CompressionStream !== 'undefined';
  for (const f of files) {
    const nameU8 = TE.encode(f.name);
    const raw = typeof f.data === 'string' ? TE.encode(f.data) : f.data;
    const crc = crc32(raw);
    let method = 0, body = raw;
    if (canDeflate && raw.length > 128) {
      try { const z = await deflateRaw(raw); if (z.length < raw.length) { body = z; method = 8; } } catch (e) { /* 退回不压缩 */ }
    }
    const lh = new Uint8Array(30 + nameU8.length), lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true); lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, body.length, true); lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameU8.length, true); lv.setUint16(28, 0, true);
    lh.set(nameU8, 30);
    parts.push(lh, body);
    const ch = new Uint8Array(46 + nameU8.length), cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, method, true); cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true);
    cv.setUint32(24, raw.length, true); cv.setUint16(28, nameU8.length, true);
    cv.setUint32(42, offset, true);
    ch.set(nameU8, 46);
    central.push(ch);
    offset += lh.length + body.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const eocd = new Uint8Array(22), ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  return concat([...parts, ...central, eocd]);
}

/* ---------- XML ---------- */
const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const xmlEsc = s => String(s).replace(BAD_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xmlUnesc = s => s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (m, e) =>
  e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'amp' ? '&' : e === 'quot' ? '"' : e === 'apos' ? "'" :
  e[1] === 'x' ? String.fromCodePoint(parseInt(e.slice(2), 16)) : String.fromCodePoint(parseInt(e.slice(1), 10)));

function* xmlTokens(xml) {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) { yield { t: 'text', v: xml.slice(i) }; return; }
    if (lt > i) yield { t: 'text', v: xml.slice(i, lt) };
    if (xml.startsWith('<' + '!--', lt)) { const e = xml.indexOf('--' + '>', lt + 4); i = e < 0 ? n : e + 3; continue; }
    if (xml.startsWith('<?', lt)) { const e = xml.indexOf('?>', lt + 2); i = e < 0 ? n : e + 2; continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const e = xml.indexOf(']]>', lt + 9);
      yield { t: 'cdata', v: xml.slice(lt + 9, e < 0 ? n : e) };
      i = e < 0 ? n : e + 3; continue;
    }
    if (xml.startsWith('<!', lt)) { const e = xml.indexOf('>', lt + 2); i = e < 0 ? n : e + 1; continue; }
    let j = lt + 1, q = 0;
    while (j < n) {
      const c = xml.charCodeAt(j);
      if (q) { if (c === q) q = 0; } else if (c === 34 || c === 39) q = c; else if (c === 62) break;
      j++;
    }
    const raw = xml.slice(lt + 1, j);
    i = j + 1;
    const close = raw[0] === '/';
    const self = !close && raw[raw.length - 1] === '/';
    const body = raw.slice(close ? 1 : 0, self ? -1 : undefined).trim();
    const sp = body.search(/\s/);
    yield { t: close ? 'close' : self ? 'self' : 'open', name: sp < 0 ? body : body.slice(0, sp), attrs: sp < 0 ? '' : body.slice(sp) };
  }
}
function xmlAttr(attrs, key) {
  const re = new RegExp('(?:^|\\s)' + key.replace(/[:.]/g, '\\$&') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')');
  const m = re.exec(attrs);
  return m ? xmlUnesc(m[1] != null ? m[1] : m[2]) : null;
}

/* ---------- DOCX 读：段落 + 样式名 ---------- */
function styleNames(stylesXml) {
  const names = {};
  if (!stylesXml) return names;
  let cur = null;
  for (const tk of xmlTokens(stylesXml)) {
    if ((tk.t === 'open' || tk.t === 'self') && tk.name === 'w:style') cur = xmlAttr(tk.attrs, 'w:styleId');
    else if (tk.t === 'close' && tk.name === 'w:style') cur = null;
    else if (cur && (tk.t === 'self' || tk.t === 'open') && tk.name === 'w:name') names[cur] = xmlAttr(tk.attrs, 'w:val') || cur;
  }
  return names;
}
function docxXmlParagraphs(docXml, stylesXml) {
  const names = styleNames(stylesXml);
  const out = [];
  const stack = [];
  let cur = null, pDepth = 0, inT = 0, skip = 0;
  for (const tk of xmlTokens(docXml)) {
    if (tk.t === 'text' || tk.t === 'cdata') {
      if (cur && inT && !skip) cur.text += tk.t === 'text' ? xmlUnesc(tk.v) : tk.v;
      continue;
    }
    const nm = tk.name;
    if (tk.t === 'open') {
      const parent = stack[stack.length - 1];
      stack.push(nm);
      if (nm === 'mc:Fallback' || nm === 'w:txbxContent') skip++;
      else if (nm === 'w:p') { pDepth++; if (pDepth === 1) cur = { text: '', styleId: '' }; }
      else if (nm === 'w:t') inT++;
      void parent;
      continue;
    }
    if (tk.t === 'close') {
      for (let k = stack.length - 1; k >= 0; k--) { if (stack[k] === nm) { stack.length = k; break; } }
      if (nm === 'mc:Fallback' || nm === 'w:txbxContent') skip = Math.max(0, skip - 1);
      else if (nm === 'w:t') inT = Math.max(0, inT - 1);
      else if (nm === 'w:p') {
        pDepth = Math.max(0, pDepth - 1);
        if (pDepth === 0 && cur) { cur.style = names[cur.styleId] || cur.styleId; out.push(cur); cur = null; }
      }
      continue;
    }
    // self-closing
    const parent = stack[stack.length - 1];
    if (!cur || skip) continue;
    if (nm === 'w:pStyle' && parent === 'w:pPr') cur.styleId = xmlAttr(tk.attrs, 'w:val') || '';
    else if (parent === 'w:r') {
      if (nm === 'w:tab') cur.text += '\t';
      else if (nm === 'w:br' || nm === 'w:cr') { const ty = xmlAttr(tk.attrs, 'w:type'); if (!ty || ty === 'textWrapping') cur.text += '\n'; }
      else if (nm === 'w:noBreakHyphen') cur.text += '-';
    }
  }
  return out;
}
async function readDocx(buf) {
  const z = await unzip(buf);
  const docXml = await z.text('word/document.xml');
  if (!docXml) throw new Error('DOCX 里没有正文（word/document.xml）');
  const stylesXml = await z.text('word/styles.xml');
  return docxXmlParagraphs(docXml, stylesXml);
}

/* ---------- DOCX 写 ---------- */
const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const FONT_CN = 'Noto Serif SC', FONT_LATIN = 'Georgia';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${NS_W}">
<w:docDefaults>
<w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT_LATIN}" w:hAnsi="${FONT_LATIN}" w:eastAsia="${FONT_CN}" w:cs="Times New Roman"/><w:color w:val="2A2622"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="380" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="360" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:color w:val="1F1B17"/><w:spacing w:val="30"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="4" w:color="CDBFA9"/></w:pBdr><w:spacing w:before="420" w:after="160" w:line="240" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="3A332C"/><w:spacing w:val="20"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="320" w:after="100" w:line="240" w:lineRule="auto"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="9E3B2E"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajMeta"><w:name w:val="案头·段头"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:color w:val="4A433B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajField"><w:name w:val="案头·字段"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="90"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajAction"><w:name w:val="案头·动作"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="40" w:after="120"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajLine"><w:name w:val="案头·台词"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120"/><w:ind w:leftChars="200" w:left="440"/></w:pPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajShot"><w:name w:val="案头·镜头"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="40" w:after="140"/></w:pPr><w:rPr><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajCue"><w:name w:val="案头·字幕音效"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="100"/></w:pPr><w:rPr><w:color w:val="6B6156"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:customStyle="1" w:styleId="ajNote"><w:name w:val="案头·备注"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:color w:val="7A7064"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="ajLabel"><w:name w:val="案头·标签"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:b/><w:color w:val="5A4A3A"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="ajSpeaker"><w:name w:val="案头·角色"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:b/><w:color w:val="2A2622"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="ajParen"><w:name w:val="案头·表演提示"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="8A7F72"/></w:rPr></w:style>
<w:style w:type="character" w:customStyle="1" w:styleId="ajMark"><w:name w:val="案头·记号"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="A8382A"/></w:rPr></w:style>
</w:styles>`;

const SETTINGS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="${NS_W}"><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

const FONTS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="${NS_W}"><w:font w:name="${FONT_CN}"><w:altName w:val="宋体"/><w:charset w:val="86"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font><w:font w:name="宋体"><w:altName w:val="SimSun"/><w:charset w:val="86"/><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font><w:font w:name="${FONT_LATIN}"><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font><w:font w:name="Times New Roman"><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font></w:fonts>`;

function runXml(text, rs) {
  const rPr = rs ? `<w:rPr><w:rStyle w:val="${rs}"/></w:rPr>` : '';
  let x = '';
  String(text).replace(BAD_XML, '').split('\n').forEach((line, i) => {
    if (i > 0) x += `<w:r>${rPr}<w:br/></w:r>`;
    line.split('\t').forEach((t, j) => {
      if (j > 0) x += `<w:r>${rPr}<w:tab/></w:r>`;
      if (t) x += `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r>`;
    });
  });
  return x;
}
const paraXml = p => `<w:p><w:pPr><w:pStyle w:val="${p.s}"/></w:pPr>${p.r.map(([t, rs]) => runXml(t, rs)).join('')}</w:p>`;

function headerXml(text) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:color w:val="A1968A"/><w:spacing w:val="20"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p></w:hdr>`;
}
function footerXml() {
  const rp = '<w:rPr><w:color w:val="A1968A"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:p><w:pPr><w:spacing w:after="0"/><w:jc w:val="center"/></w:pPr><w:r>${rp}<w:t xml:space="preserve">— </w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${rp}<w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r>${rp}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${rp}<w:t>1</w:t></w:r><w:r>${rp}<w:fldChar w:fldCharType="end"/></w:r><w:r>${rp}<w:t xml:space="preserve"> —</w:t></w:r></w:p></w:ftr>`;
}

async function writeDocx(paras, opt = {}) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const body = paras.map(paraXml).join('\n');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}"><w:body>
${body}
<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1531" w:right="1474" w:bottom="1417" w:left="1474" w:header="794" w:footer="737" w:gutter="0"/><w:cols w:space="425"/></w:sectPr>
</w:body></w:document>`;
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'word/document.xml', data: doc },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: STYLES_XML },
    { name: 'word/settings.xml', data: SETTINGS_XML },
    { name: 'word/fontTable.xml', data: FONTS_XML },
    { name: 'word/header1.xml', data: headerXml(opt.header || '') },
    { name: 'word/footer1.xml', data: footerXml() },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(opt.title || '')}</dc:title><dc:creator>案头</dc:creator><cp:lastModifiedBy>案头</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>案头</Application></Properties>` },
  ];
  return zip(files);
}

/* ============================================================
   剧本
   ============================================================ */
const SCRIPT_HEAD = ['场景', '人物', '梗概'];
const SCRIPT_HEAD_SET = new Set(SCRIPT_HEAD);
const NOT_SPEAKER = /(特写|近景|中景|全景|远景|空镜|镜头|画面|转场|闪回|叠化|切至|切到|黑场|字幕|音效|场景|人物|时长|梗概|备注|时间|地点|注|定稿|审稿|草稿|说明|记录|提示)$/;
const NOTE_LABEL = /^(已定稿|定稿|待审稿?|草稿|审稿中|修改中|修改记录|备注|附注|注|说明)$/;
const RE_LINE = /^([^\s：:（(△▲，。；、！？,.;!?「」“”‘’"'…—]{1,12})\s*(?:[（(]([^）)]*)[）)])?\s*[：:]\s*([\s\S]*)$/;

function parseLine(text) {
  const m = RE_LINE.exec(text);
  if (!m || NOT_SPEAKER.test(m[1])) return null;
  return { who: m[1], how: (m[2] || '').trim(), say: m[3] };
}
function scriptRole(text, sec) {
  if (sec === 'head') {
    const f = splitLabel(text);
    if (!f) return 'plain';
    return f.label === '场景' ? 'scene' : f.label === '人物' ? 'cast' : 'meta';
  }
  if (sec === 'body') {
    if (/^[△▲]/.test(text)) return 'action';
    if (/^字幕[：:]/.test(text)) return 'sub';
    if (/^音效[：:]/.test(text)) return 'sfx';
    if (parseLine(text)) return 'line';
    return 'plain';
  }
  return 'note';
}
function parseCast(v) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of String(v)) {
    if (ch === '（' || ch === '(') depth++;
    else if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '、' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => {
    const m = /^\s*([^（(]+?)\s*(?:[（(]([\s\S]*)[）)])?\s*$/.exec(s);
    return m ? { name: m[1].trim(), desc: (m[2] || '').trim() } : { name: s.trim(), desc: '' };
  }).filter(c => c.name);
}
function newScriptDoc(seg, name) {
  return {
    kind: 'script', seg: seg || '', name: name || '', status: '',
    sections: [
      { key: 'head', head: '', blocks: [] },
      { key: 'body', head: '正文', blocks: [] },
      { key: 'notes', head: '备注', blocks: [] },
    ],
  };
}
function scriptTitle(doc) { return '第' + (doc.seg || '?') + '段' + (doc.name ? '｜' + doc.name : ''); }

function matchScriptHead(t) {
  let m = new RegExp('^第\\s*(' + SEG_NUM + ')\\s*段\\s*(?:[｜|]\\s*(.*))?$').exec(t);
  if (m && !/镜头表/.test(m[2] || '')) return { fixed: true, seg: normSeg(m[1]), name: (m[2] || '').trim() };
  m = /^([0-9０-９]+(?:[-－—–][0-9０-９]+)+)[\s\u3000]+(\S+)[\s\u3000]+(内外|外内|内|外|室内|室外)[\s\u3000]+(.+)$/.exec(t);
  if (m) {
    let place = m[4].trim(), status = '';
    const sm = /[（(]\s*((?:已)?定稿|待审稿?|草稿|审稿中|修改中)\s*[）)]\s*$/.exec(place);
    if (sm) { status = sm[1]; place = place.slice(0, sm.index).trim(); }
    return { fixed: false, seg: normSeg(m[1]), time: m[2], io: m[3], place, status };
  }
  return null;
}
function isScriptBodyLine(t) { return /^[△▲]/.test(t) || /^(字幕|音效)[：:]/.test(t) || !!parseLine(t); }

function buildScript(head, lines, fileSeg) {
  const doc = newScriptDoc((head && head.seg) || fileSeg || '', (head && head.name) || '');
  doc.status = (head && head.status) || '';
  const [H, B, N] = doc.sections.map(s => s.blocks);
  if (head && !head.fixed) H.push(blk(`场景：${head.time}｜${head.io}｜${head.place}`));
  let mode = 'head';
  for (const p of lines) {
    const t = p.text;
    if (!t) continue;
    if (/^正\s*文$/.test(t)) { mode = 'body'; continue; }
    if (/^(备注|修改记录|附注)$/.test(t)) { mode = 'notes'; continue; }
    if (mode === 'head') {
      const f = splitLabel(t);
      if (f && SCRIPT_HEAD_SET.has(f.label)) { H.push(blk(t)); continue; }
      if (f && NOTE_LABEL.test(f.label)) { N.push(blk(t)); continue; }
      if (isScriptBodyLine(t)) { mode = 'body'; B.push(blk(t)); continue; }
      if (f) { H.push(blk(t)); continue; }
      N.push(blk(t));
      continue;
    }
    (mode === 'body' ? B : N).push(blk(t));
  }
  const order = l => { const i = SCRIPT_HEAD.indexOf(labelOf(l.text)); return i < 0 ? 99 : i; };
  doc.sections[0].blocks = H.map((b, i) => [b, i]).sort((a, b) => order(a[0]) - order(b[0]) || a[1] - b[1]).map(x => x[0]);
  return doc;
}

/* 一份剧本 DOCX 可能是单段，也可能是好几段的汇总稿 */
function parseScripts(paras, fileSeg) {
  const P = paras.map(p => ({ text: cleanPara(p.text), style: String(p.style || '').toLowerCase() }));
  const heads = [];
  P.forEach((p, i) => { const h = p.text && matchScriptHead(p.text); if (h) heads.push({ i, h }); });
  if (!heads.length) {
    let start = 0;
    while (start < P.length && !P[start].text) start++;
    // 第一段是标题样式且不像正文时，当作文件标题略过
    const preface = [];
    if (start < P.length && /title|标题/.test(P[start].style) && !isScriptBodyLine(P[start].text) && !splitLabel(P[start].text)) { preface.push(P[start].text); start++; }
    return { preface, segs: [buildScript(null, P.slice(start), fileSeg)] };
  }
  const preface = P.slice(0, heads[0].i).map(p => p.text).filter(Boolean);
  const segs = heads.map((hd, k) => buildScript(hd.h, P.slice(hd.i + 1, k + 1 < heads.length ? heads[k + 1].i : P.length), fileSeg));
  return { preface, segs };
}
function scriptToParas(doc) {
  const out = [{ s: 'Title', r: [[scriptTitle(doc)]] }];
  const [H, B, N] = doc.sections.map(s => s.blocks);
  for (const b of H) {
    const f = splitLabel(b.text);
    out.push({ s: 'ajMeta', r: f ? [[f.label + '：', 'ajLabel'], [f.value]] : [[b.text]] });
  }
  out.push({ s: 'Heading1', r: [['正文']] });
  for (const b of B) {
    const t = b.text, role = scriptRole(t, 'body');
    if (role === 'action') out.push({ s: 'ajAction', r: [['△ ', 'ajMark'], [t.replace(/^[△▲]\s*/, '')]] });
    else if (role === 'line') {
      const L = parseLine(t);
      out.push({ s: 'ajLine', r: [[L.who, 'ajSpeaker'], ...(L.how ? [['（' + L.how + '）', 'ajParen']] : []), ['：' + L.say]] });
    } else if (role === 'sub' || role === 'sfx') {
      const f = splitLabel(t);
      out.push({ s: 'ajCue', r: [[f.label + '：', 'ajLabel'], [f.value]] });
    } else out.push({ s: 'Normal', r: [[t]] });
  }
  if (N.length) {
    out.push({ s: 'Heading1', r: [['备注']] });
    for (const b of N) out.push({ s: 'ajNote', r: [[b.text]] });
  }
  return out;
}
function scriptTemplate(seg, name) {
  const d = newScriptDoc(seg, name);
  d.sections[0].blocks = ['场景：', '人物：', '梗概：'].map(blk);
  d.sections[1].blocks = ['△ '].map(blk);
  return d;
}

/* ============================================================
   镜头表：标题下面一镜一行「镜头N｜概述」，概述不超过十个字
   旧格式里的其他内容原样留着（pre / 每镜的 blocks / post），不丢
   ============================================================ */
const SHOT_MAX = 10;
const countChars = s => [...String(s || '').replace(/\s/g, '')].length;
const RE_SHOT_HEAD = /^镜头\s*([0-9０-９]+[A-Za-z]?)\s*(?:[｜|：:]\s*|\s+|$)(.*)$/;
const RE_OLD_SECTION = /^[一二三四五六七八九十]+\s*[、.．]\s*\S/;

function newShotDoc(seg, name) { return { kind: 'shots', seg: seg || '', name: name || '', pre: [], shots: [], post: [] }; }
function shotTitle(doc) { return '第' + (doc.seg || '?') + '段｜镜头表' + (doc.name ? '｜' + doc.name : ''); }
function matchShotTitle(t) {
  let m = new RegExp('^第\\s*(' + SEG_NUM + ')\\s*段\\s*[｜|]\\s*镜头表\\s*(?:[｜|]\\s*(.*))?$').exec(t);
  if (m) return { seg: normSeg(m[1]), name: (m[2] || '').trim() };
  m = new RegExp('^第\\s*(' + SEG_NUM + ')\\s*段\\s*(?:[｜|]|\\s)\\s*(.*)$').exec(t);
  if (m && /镜头表|分镜/.test(m[2])) {
    const rest = m[2].trim();
    const pm = /[（(]([^）)]+)[）)]\s*$/.exec(rest);
    const name = pm ? pm[1].trim() : rest.replace(/\d*\s*镜?\s*(镜头表|分镜表?)/, '').replace(/^[｜|\s]+|[｜|\s]+$/g, '').trim();
    return { seg: normSeg(m[1]), name };
  }
  if (/镜头表/.test(t) && t.length < 40 && !splitLabel(t)) return { seg: null, name: t.replace(/镜头表/, '').replace(/^[｜|\s]+|[｜|\s]+$/g, '').trim() };
  return null;
}
function parseShotList(paras, fileSeg) {
  const P = paras.map(p => cleanPara(p.text));
  const doc = newShotDoc(fileSeg || '', '');
  let i = 0;
  while (i < P.length && !P[i]) i++;
  if (i < P.length) {
    const t = matchShotTitle(P[i]);
    if (t) { if (t.seg) doc.seg = t.seg; doc.name = t.name; i++; }
  }
  let shot = null, after = false;
  for (; i < P.length; i++) {
    const t = P[i];
    if (!t) continue;
    const m = !after && RE_SHOT_HEAD.exec(t);
    if (m) { shot = { id: uid(), title: m[2].trim(), blocks: [] }; doc.shots.push(shot); continue; }
    if (shot && RE_OLD_SECTION.test(t)) after = true;
    (after ? doc.post : shot ? shot.blocks : doc.pre).push(blk(t));
  }
  return doc;
}
function fieldPara(text, style) {
  const f = splitLabel(text);
  return f ? { s: style, r: [[f.label + '：', 'ajLabel'], [f.value]] } : { s: style, r: [[text]] };
}
const oldPara = t => RE_OLD_SECTION.test(t) && t.length <= 20 ? { s: 'Heading1', r: [[t]] } : fieldPara(t, 'ajField');
function shotsToParas(doc) {
  const out = [{ s: 'Title', r: [[shotTitle(doc)]] }];
  doc.pre.forEach(b => out.push(oldPara(b.text)));
  doc.shots.forEach((sh, k) => {
    out.push({ s: 'ajShot', r: [['镜头' + (k + 1), 'ajLabel'], ['｜' + sh.title.trim()]] });
    sh.blocks.forEach(b => out.push(fieldPara(b.text, 'ajNote')));
  });
  doc.post.forEach(b => out.push(oldPara(b.text)));
  return out;
}
function newShot(title) { return { id: uid(), title: title || '', blocks: [] }; }
function shotsTemplate(seg, name) { const d = newShotDoc(seg, name); d.shots = [newShot('')]; return d; }
/* 旧格式留下来的行数 */
function shotOldCount(doc) { return doc.pre.length + doc.post.length + doc.shots.reduce((a, s) => a + s.blocks.length, 0); }
function shotsOverLimit(doc) { return doc.shots.map((sh, k) => ({ sh, k, n: countChars(sh.title) })).filter(x => x.n > SHOT_MAX); }


/* ============================================================
   提示词（现行骨架；七分区旧稿照旧认）
   ============================================================ */
/* 现行骨架：本段事件、保持一致各是一行「标签：内容」，其余分区名独占一行；没有图的段可以不写「素材」 */
const PROMPT_SECTIONS_NEW = [
  { key: 'event', name: '本段事件', alias: [] },
  { key: 'refs', name: '素材', alias: ['素材'], optional: true },
  { key: 'basic', name: '基础设定', alias: ['基础设定'] },
  { key: 'seg', name: '本段', alias: ['本段'] },
  { key: 'shots', name: '分镜', alias: ['分镜'] },
  { key: 'keep', name: '保持一致', alias: ['保持一致'] },
];
/* 七分区旧稿才有的分区名 */
const PROMPT_OLD_ONLY = ['说明｜基础设定', '人物与参考图对应', '人物与参考图', '声音', '场景', '规则｜镜头原则', '镜头原则'];
const PROMPT_SECTIONS = [
  { key: 'basic', name: '说明｜基础设定', alias: ['说明｜基础设定', '基础设定'] },
  { key: 'cast', name: '人物与参考图对应', alias: ['人物与参考图对应', '人物与参考图'] },
  { key: 'sound', name: '声音', alias: ['声音'] },
  { key: 'scene', name: '场景', alias: ['场景'] },
  { key: 'rules', name: '规则｜镜头原则', alias: ['规则｜镜头原则', '镜头原则'] },
  { key: 'shots', name: '分镜', alias: ['分镜'] },
  { key: 'keep', name: '保持一致', alias: ['保持一致'] },
];
/* sd2.5PE 稿（2026-11-13 起新写的都是）：段名是独占一行的【】。
   写法一（带参考素材的生成）：生成目标、参考素材职责、未采用素材（有才写）、基础设定、主体与关系、事件脚本、保持一致；
   写法二（多素材组织，素材多于五份）：生成目标、人物、道具、场景、动作与声音、未采用素材、基础设定、事件脚本、保持一致。
   基础设定写影像风格、摄影、光色基调（2026-11-14 用户定：风格放在事件脚本前面）。
   事件脚本里一镜一行「镜头1：……」，最后一行「声音包括……」（老稿是「最终画面采用……，声音包括……」）；也可以写【阶段一】这样的阶段 */
const PROMPT_SECTIONS_PE = [
  { key: 'goal', name: '【生成目标】', alias: ['【生成目标】'] },
  { key: 'refs', name: '【参考素材职责】', alias: ['【参考素材职责】'], optional: true },
  { key: 'cast', name: '【人物】', alias: ['【人物】'], optional: true },
  { key: 'props', name: '【道具】', alias: ['【道具】'], optional: true },
  { key: 'scene', name: '【场景】', alias: ['【场景】'], optional: true },
  { key: 'avs', name: '【动作与声音】', alias: ['【动作与声音】'], optional: true },
  { key: 'unused', name: '【未采用素材】', alias: ['【未采用素材】'], optional: true },
  { key: 'basic', name: '【基础设定】', alias: ['【基础设定】'], optional: true },
  { key: 'rel', name: '【主体与关系】', alias: ['【主体与关系】'], optional: true },
  { key: 'script', name: '【事件脚本】', alias: ['【事件脚本】'] },
  { key: 'keep', name: '【保持一致】', alias: ['【保持一致】'] },
];
/* 有一个独占一行就是 PE 稿（旧稿的素材里也写【参考素材职责】【未采用素材】，这两个不算） */
const PE_MARKS = ['【生成目标】', '【基础设定】', '【主体与关系】', '【事件脚本】', '【保持一致】'];
const RE_PE_SUBJECT = /^【主体设定[：:][^】]*】$/;
const PROMPT_BASIC = ['影像风格', '摄影', '摄影与镜头', '光色基调', '核心氛围', '本段事件'];
const PROMPT_RULES = ['运镜', '构图', '轴线'];
const PROMPT_SHOT_HEAD = ['机位/景别/角度', '本镜调用', '画面构图', '环境音', '进入状态'];
const PROMPT_SUB = ['动作/表情', '音效', '镜头', '台词'];
const PROMPT_SHOT_TAIL = ['退出状态', '切点'];
const RE_PROMPT_SHOT = /^镜头\s*[0-9０-９]+/;
const RE_SUB = /^小节[一二三四五六七八九十0-9]+$/;

const headKey = line => String(line).trim().replace(/\s+/g, '').replace(/\|/g, '｜');
function promptSectionKey(line, table) {
  const t = headKey(line);
  for (const s of table || PROMPT_SECTIONS) if (s.alias.includes(t)) return s.key;
  if (table === PROMPT_SECTIONS_PE && RE_PE_SUBJECT.test(t)) return 'cast';   // 写法二的【主体设定：某某】和【人物】同一类
  return null;
}
/* 认格式：有独占一行的【生成目标】【基础设定】【主体与关系】【事件脚本】【保持一致】是 sd2.5PE 稿（pe，2026-11-13 起）；有七分区才有的分区名是旧稿（seven）；
   有独占一行的「本段」或「素材」是 11-13 以前的合并稿（merged）；都没有是自由格式（''） */
function promptFormat(lines) {
  const heads = new Set(lines.map(l => headKey(l.t)));
  if (PE_MARKS.some(a => heads.has(a))) return 'pe';
  if (PROMPT_OLD_ONLY.some(a => heads.has(a))) return 'seven';
  if (heads.has('本段') || heads.has('素材')) return 'merged';
  const first = lines.find(l => l.t.trim());
  if (first && labelOf(first.t.trim()) === '本段事件' && (heads.has('基础设定') || heads.has('分镜'))) return 'merged';
  return PROMPT_SECTIONS.some(s => s.alias.some(a => heads.has(a))) ? 'seven' : '';
}
const promptTable = doc => doc && doc.fmt === 'pe' ? PROMPT_SECTIONS_PE : doc && doc.fmt === 'merged' ? PROMPT_SECTIONS_NEW : PROMPT_SECTIONS;
/* 一段话在文件里常折成几行：上一行停在逗号、分号、顿号、冒号上，或是基础设定的一项还没写完，下一行就接在这一段里。
   下一行是「标签：」、@ 开头、某某对应@、分场景｜、小节、镜头几，都另起一段 */
function continues(first, prev, t) {
  const s = String(t).trim();
  if (!s || !String(prev).trim()) return false;
  if (splitLabel(s) || RE_SUB.test(s) || RE_PROMPT_SHOT.test(s) || /^@|^[^，。；：、]{0,12}对应@|^分场景[｜|]/.test(s)) return false;
  return /[，；：、]$/.test(String(prev).trim()) || PROMPT_BASIC.includes(labelOf(first));
}
/* 一行一条并成一段一段（旧版记下的红批原稿是一行一条） */
function joinLines(ts) {
  const out = [];
  let first = '', prev = '';
  for (const t of ts) {
    if (out.length && continues(first, prev, t)) { out[out.length - 1] += t; prev = t; continue; }
    out.push(t); first = prev = t;
  }
  return out;
}
/* 改过的一段超过 150 字：在 148 字以内最后一个逗号、分号、顿号、冒号后面折行，折下去的一行读回来还接在这一段 */
function wrapPara(t) {
  const out = [];
  while (t.length > 150) {
    let cut = 0;
    for (let i = 148; i > 74 && !cut; i--) if ('，；、：'.includes(t[i - 1]) && continues(t, t.slice(0, i), t.slice(i))) cut = i;
    if (!cut) break;
    out.push(t.slice(0, cut)); t = t.slice(cut);
  }
  out.push(t);
  return out;
}
/* 每一行连同自己的换行符一起记下来，空行也留着：没动过的行原样写回 */
function splitWithEol(text) {
  const out = [];
  let i = 0;
  for (;;) {
    let j = i;
    while (j < text.length && text[j] !== '\r' && text[j] !== '\n') j++;
    const e = j >= text.length ? '' : text[j] === '\r' && text[j + 1] === '\n' ? '\r\n' : text[j];
    out.push({ t: text.slice(i, j), e });
    if (!e) break;
    i = j + e.length;
    if (i >= text.length) break;
  }
  return out;
}
function parsePrompt(text) {
  const doc = { kind: 'prompt', fmt: '', bom: false, eol: '\r\n', finalNewline: false, finalEol: '', pre: [], sections: [] };
  text = String(text);
  if (text.charCodeAt(0) === 0xFEFF) { doc.bom = true; text = text.slice(1); }
  const lines = splitWithEol(text);
  const cnt = {};
  lines.forEach(l => { if (l.e) cnt[l.e] = (cnt[l.e] || 0) + 1; });
  const top = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  if (top) doc.eol = top;
  const last = lines[lines.length - 1];
  doc.finalNewline = !!last.e; doc.finalEol = last.e;
  doc.wrap = lines.every(l => l.t.length <= 150);   // 文件守着每行不超过 150 字的老规矩
  doc.fmt = promptFormat(lines);
  const merged = doc.fmt === 'merged', table = promptTable(doc);
  let sec = null, shot = null;
  for (const { t, e } of lines) {
    const key = promptSectionKey(t, table);
    if (key) {
      sec = { key, head: t, headEol: e, blocks: [] };
      if (key === 'shots') sec.shots = [];
      doc.sections.push(sec); shot = null; continue;
    }
    if (merged) {   // 「本段事件：」开头、「保持一致：」收尾，各自成区：这一行就是内容，没有单独的分区名（head 记成 null）
      const lab = labelOf(t.trim());
      const k = lab === '本段事件' && !sec ? 'event' : lab === '保持一致' && (!sec || sec.key !== 'keep') ? 'keep' : '';
      if (k) { sec = { key: k, head: null, headEol: '', blocks: [] }; doc.sections.push(sec); shot = null; }
    }
    if (sec && sec.key === 'shots' && RE_PROMPT_SHOT.test(t.trim())) { shot = { id: uid(), head: t, headEol: e, blocks: [] }; sec.shots.push(shot); continue; }
    const arr = !sec ? doc.pre : shot ? shot.blocks : sec.blocks, p = arr[arr.length - 1];
    // 折下来的一行接进上一段，原来的折行记在 lines 里
    if (p && continues(p.lines ? p.lines[0].t : p.text, p.lines ? p.lines[p.lines.length - 1].t : p.text, t)) {
      p.lines = p.lines || [{ t: p.text, e: p.eol }];
      p.lines.push({ t, e }); p.text += t; p.eol = e;
      continue;
    }
    const b = blk(t); b.eol = e;
    arr.push(b);
  }
  return doc;
}
function serializePrompt(doc) {
  const out = [];
  // 没改过的段落照原来的折行写回；改过的写成一行，文件本来守着 150 字规矩的就照样折
  const lines = bs => bs.forEach(b => {
    const ls = b.lines && b.text === b.lines.map(l => l.t).join('') ? b.lines
      : String(b.text).split(/\r\n|\n|\r/).flatMap(t => doc.wrap ? wrapPara(t) : [t]).map(t => ({ t, e: '' }));
    ls.forEach((l, k) => out.push([l.t, k === ls.length - 1 ? b.eol : l.e]));
  });
  lines(doc.pre);
  for (const s of doc.sections) {
    if (s.head != null) out.push([s.head, s.headEol]);
    lines(s.blocks);
    if (s.shots) for (const sh of s.shots) { out.push([sh.head, sh.headEol]); lines(sh.blocks); }
  }
  let text = '';
  out.forEach(([t, e], i) => {
    text += t;
    if (i < out.length - 1) text += e || doc.eol;
    else if (doc.finalNewline) text += e || doc.finalEol || doc.eol;
  });
  return (doc.bom ? '\uFEFF' : '') + text;
}
/* 界面上不显示一段开头、结尾的空行（它们只是分区之间的间隔） */
const isBlank = b => !String(b.text).trim();
function edgeRange(arr) {
  let a = 0, z = arr.length;
  while (a < z && isBlank(arr[a])) a++;
  while (z > a && isBlank(arr[z - 1])) z--;
  return [a, z];
}
/* 保证容器以一个空行结尾：新加的分区、镜头前后要隔开 */
function ensureTrailingBlank(arr) { if (!arr.length || !isBlank(arr[arr.length - 1])) arr.push(blk('')); }
function promptShotTitle(sh) { const m = /^镜头\s*[0-9０-９]+\s*[｜|：:]?\s*(.*)$/.exec(sh.head.trim()); return m ? m[1] : sh.head; }
function renumberPromptShots(sec) {
  sec.shots.forEach((sh, k) => { sh.head = sh.head.replace(/^(\s*)镜头\s*[0-9０-９]+/, '$1镜头' + (k + 1)); });
}
function newPromptShot(n, title) {
  return {
    id: uid(), head: '镜头' + n + '｜' + (title || ''),
    blocks: ['机位/景别/角度：', '本镜调用：', '画面构图：', '环境音：', '进入状态：', '小节一', '动作/表情：', '音效：', '镜头：', '台词：无', '退出状态：', '切点：', ''].map(blk),
  };
}
/* 空白模板：sd2.5PE 写法一（带参考素材的生成）。素材多于五份改用写法二：素材按【人物】【道具】【场景】【动作与声音】分组，不写【主体与关系】；
   挂了没用上的素材，在【主体与关系】前面加【未采用素材】逐个列出 */
const PROMPT_SKELETON = `【生成目标】
〔这条视频拍什么：谁要什么，所以发生了什么；结束时什么样〕。

【参考素材职责】
@图片N用于〔称谓〕的五官、发型和服装，不采用图片背景。
@图片N用于〔道具〕的〔结构、材质、颜色〕，不采用图中人物和背景。
@图片N用于〔场景叫法〕的〔空间布局、陈设、材质、灯光〕，不采用图中人物。
@图片N作为首帧。
该首帧定义视频开始时的〔构图、人物位置、姿态、道具状态、镜头方向〕。

【基础设定】
影像风格：〔风格名打头，画面质感写成看得见的〕。
摄影：〔常用景别、机位、运镜〕。
光色基调：〔主色和明暗〕；〔这场的时间、主光从哪来〕。

【主体与关系】
〔画面中共有几个人、各是谁；没有图的写长相和衣着；说话的人写声线〕。
〔开场时谁在哪、朝着谁、隔多远〕。〔道具几个、归谁〕。
〔场景空间：照项目 GEO 的场景段〕。

【事件脚本】
镜头1：〔景别、机位〕，〔谁要什么，所以做什么；台词 {}、音效 <> 写在发生处；听的人怎么反应〕。
镜头2：〔……〕
声音包括〔配乐或无背景音乐、环境声、音效〕。

【保持一致】
保持〔人物身份与数量、服装、道具归属、空间方向〕稳定。
`;
function promptTemplate() { const d = parsePrompt(PROMPT_SKELETON.replace(/\n/g, '\r\n')); return d; }

/* ============================================================
   校对
   ============================================================ */
function issue(level, msg, loc) { return { level, msg, loc: loc || null }; }

/* PE 稿照 sd25-pe 查：() 音乐、<> 音效、{} 台词、【】字幕都能用；台词别用引号 */
function lintPe(doc) {
  const out = [], table = PROMPT_SECTIONS_PE, keys = doc.sections.map(s => s.key), nameOf = k => (table.find(s => s.key === k) || {}).name || k;
  for (const s of table) if (!s.optional && !keys.includes(s.key)) out.push(issue(s.key === 'keep' ? 'info' : 'warn', '缺少分区：' + s.name, { sec: s.key, missing: true }));
  const idx = keys.map(k => table.findIndex(s => s.key === k));
  if (idx.some((v, i) => i && v < idx[i - 1])) out.push(issue('warn', '分区顺序和 sd2.5PE 不一致。写法一：生成目标 → 参考素材职责 → 未采用素材 → 基础设定 → 主体与关系 → 事件脚本 → 保持一致；写法二：生成目标 → 人物 → 道具 → 场景 → 动作与声音 → 未采用素材 → 基础设定 → 事件脚本 → 保持一致。'));
  if (keys.includes('rel') && ['cast', 'props', 'scene', 'avs'].some(k => keys.includes(k))) out.push(issue('info', '写法一用【主体与关系】，写法二用【人物】【道具】【场景】分组；一份稿里选一种。'));
  let ph = 0;
  doc.sections.forEach(s => {
    const lines = s.blocks.filter(b => b.text.trim());
    if (!lines.length) out.push(issue(s.key === 'goal' || s.key === 'script' ? 'warn' : 'info', nameOf(s.key) + ' 还空着', { sec: s.key }));
    lines.forEach(b => {
      const t = b.text, loc = { sec: s.key, block: b.id };
      if (/〔[^〕]*〕/.test(t)) { ph++; if (ph <= 6) out.push(issue('warn', '还有没填的〔 〕：' + t.slice(0, 18) + (t.length > 18 ? '…' : ''), loc)); }
      if (/[“”"‘’「」『』]/.test(t)) out.push(issue('warn', '台词放进 {}，不用引号', loc));
      if (/（[^（）]*）/.test(t)) out.push(issue('info', '圆括号在 Seedance 里是音乐的记号：音乐写成 (……)，别的说明不加括号', loc));
      if (/[0-9０-９]+(?:\.[0-9]+)?\s*秒|[0-9]{1,2}:[0-9]{2}(?![0-9])/.test(t) && !/16:9|9:16/.test(t)) out.push(issue('info', '不写时间码和秒数（时长在生成参数里设）', loc));
      if (/横屏|竖屏|16\s*[:：]\s*9|9\s*[:：]\s*16|720p|1080p|分辨率|画幅/i.test(t)) out.push(issue('warn', '画幅、分辨率这类生成参数不写进提示词', loc));
      if (/首帧参考|参考首帧|首帧构图参考|尾帧参考|参考尾帧/.test(t)) out.push(issue('warn', '固定首帧、尾帧单独写一句「@图片N作为首帧。」「@图片N作为尾帧。」', loc));
      if (s.key !== 'script') return;
      if (/^镜头\s*[0０][0-9０-９]/.test(t.trim())) out.push(issue('info', '镜头号写「镜头1：」，不补 0', loc));
      if (/^镜头\s*[0-9０-９]+/.test(t.trim()) && /(?<!其)[她他](?!们)/.test(t.replace(/吉他/g, '').replace(/\{[^{}]*\}/g, ''))) out.push(issue('info', '镜头里用称谓指人，不用她、他', loc));
      if (/^最终画面/.test(t.trim())) out.push(issue('info', '风格写进【基础设定】，放在事件脚本前面；事件脚本最后一行只写「声音包括……」', loc));
    });
    if (s.key === 'script') {
      const look = lines.filter(b => /^(最终画面|声音包括)/.test(b.text.trim()));
      if (look.length && lines[lines.length - 1] !== look[look.length - 1]) out.push(issue('info', '「声音包括……」放在事件脚本最后一行', { sec: 'script', block: look[0].id }));
    }
  });
  if (!keys.includes('basic') && !doc.sections.some(s => s.key === 'script' && s.blocks.some(b => /^最终画面/.test(b.text.trim()))))
    out.push(issue('info', '还没有【基础设定】：影像风格、摄影、光色基调写在事件脚本前面'));
  if (ph > 6) out.push(issue('warn', '另外还有 ' + (ph - 6) + ' 处没填的〔 〕'));
  return out;
}
function lintPrompt(doc, fileName) {
  if (doc.fmt === 'pe') return lintPe(doc);
  const out = [];
  if (!doc.sections.length) {
    doc.pre.forEach(b => { if (/〔[^〕]*〕/.test(b.text)) out.push(issue('warn', '还有没填的〔 〕：' + b.text.slice(0, 18) + (b.text.length > 18 ? '…' : ''), { sec: 'pre', block: b.id })); });
    if (/视频提示词/.test(fileName || '') || RE_VP.test(fileName || '') || segFromName(fileName || '')) out.push(issue('info', '没有认出分区；这份提示词按自由格式编辑（延长、编辑类提示词本来就不分区）。'));
    return out;
  }
  // 现行骨架和七分区旧稿各查各的：共用的几条在前，分开的看 merged
  const merged = doc.fmt === 'merged', table = promptTable(doc);
  const keys = doc.sections.map(s => s.key);
  for (const s of table) if (!keys.includes(s.key) && !s.optional) out.push(issue(merged && s.key === 'keep' ? 'info' : 'warn', '缺少分区：' + s.name, { sec: s.key, missing: true }));
  const idx = keys.map(k => table.findIndex(s => s.key === k));
  if (idx.some((v, i) => i && v < idx[i - 1])) out.push(issue('warn', '分区顺序和固定格式不一致（' + table.map(s => s.name).join(' → ') + '）。'));
  const each = (fn) => doc.sections.forEach(s => {
    s.blocks.forEach(b => fn(b, s, null));
    if (s.shots) s.shots.forEach(sh => sh.blocks.forEach(b => fn(b, s, sh)));
  });
  let ph = 0;
  each((b, s, sh) => {
    const t = b.text;
    if (!t.trim()) return;
    const loc = { sec: s.key, shot: sh && sh.id, block: b.id };
    if (/〔[^〕]*〕/.test(t)) { ph++; if (ph <= 6) out.push(issue('warn', '还有没填的〔 〕：' + t.slice(0, 18) + (t.length > 18 ? '…' : ''), loc)); }
    if (/[（）()“”"‘’「」『』]/.test(t)) out.push(issue('warn', '提示词里不用括号和引号', loc));
    const br = t.match(/【[^】]*】/g);
    if (br && br.some(x => x !== '【未采用素材】')) out.push(issue('warn', '【】只用在「【未采用素材】」这一处', loc));
    if (/[0-9０-９]+(?:\.[0-9]+)?\s*秒|[0-9]{1,2}:[0-9]{2}(?![0-9])/.test(t) && !/16:9|9:16/.test(t)) out.push(issue('info', '提示词里不写时间码和秒数（时长在生成参数里设）', loc));
    if (/横屏|竖屏|16\s*[:：]\s*9|9\s*[:：]\s*16|720p|1080p|分辨率|画幅/i.test(t)) out.push(issue('warn', '画幅、分辨率这类生成参数不写进提示词', loc));
    if (merged) {   // 镜头里只有「照@图片N」「对应@图片N」这类引用能带编号
      if (sh && /@(图片|视频|音频)\s*[0-9]+/.test(t.replace(/(?:照|对应|参考)\s*@(?:图片|视频|音频)\s*[0-9]+/g, ''))) out.push(issue('info', '镜头里人和道具用称谓；@编号只在「站位照@图片N」这类地方写', loc));
    } else {
      const refAllowed = s.key === 'cast' || s.key === 'keep' || (sh && /^本镜调用[：:]/.test(t));
      if (/@(图片|视频|音频)\s*[0-9]+/.test(t) && !refAllowed) out.push(issue('info', '@编号只写在人物与参考图对应、本镜调用、保持一致三处', loc));
    }
    const bad = t.match(/语速快|停一拍|拖一拍|没出声|没催|店里很安静|表演克制|寂静/g);
    if (bad) out.push(issue('warn', '避开「' + [...new Set(bad)].join('、') + '」这类写法', loc));
    if (!merged && sh && /^环境音[：:]/.test(t) && /安静/.test(t)) out.push(issue('warn', '环境音里写声源，不写「安静」', loc));
    if (!merged && sh && /^台词[：:]/.test(t) && !/^台词[：:]\s*无\s*$/.test(t) && !/\{[^}]*\}/.test(t)) out.push(issue('warn', '台词原文要放在 {} 里', loc));
    if (sh && /(?<!其)[她他](?!们)/.test(t.replace(/吉他/g, '').replace(/\{[^{}]*\}/g, ''))) out.push(issue('info', '分镜里用称谓指人，不用她、他', loc));
  });
  if (ph > 6) out.push(issue('warn', '另外还有 ' + (ph - 6) + ' 处没填的〔 〕'));
  const rows = k => doc.sections.filter(s => s.key === k).flatMap(s => s.blocks).filter(b => b.text.trim());
  let places = [];   // 本段写了几处分场景：各自的叫法
  if (merged) {
    const sceneRows = [...rows('basic'), ...rows('seg')].filter(b => /^(总场景[：:]|分场景[｜|])/.test(b.text.trim()));
    places = sceneRows.map(b => /^分场景[｜|]\s*([^：:]+?)\s*[：:]/.exec(b.text.trim())).filter(Boolean).map(m => m[1]);
    // 素材里的场景图，要在分场景那一行引用
    rows('refs').forEach(b => {
      const m = /^@图片\s*([0-9]+)\s*是.*样子/.exec(b.text.trim());
      if (m && !sceneRows.some(r => new RegExp('@图片\\s*' + m[1] + '(?![0-9])').test(r.text))) out.push(issue('info', `@图片${m[1]} 是场景图，要在分场景那一行开头引用`, { sec: 'refs', block: b.id }));
    });
  }
  const shotsSec = doc.sections.find(s => s.key === 'shots');
  if (shotsSec) {
    if (!shotsSec.shots.length) out.push(issue('warn', '分镜里还没有镜头', { sec: 'shots' }));
    shotsSec.shots.forEach((sh, k) => {
      const has = l => sh.blocks.some(b => new RegExp('^' + l + '[：:]').test(b.text));
      const loc = { sec: 'shots', shot: sh.id };
      if (merged) {   // 一镜一段话：不查七分区的那几栏
        const body = sh.blocks.filter(b => b.text.trim());
        if (!body.length) out.push(issue('warn', `镜头${k + 1} 还没写`, loc));
        else if (places.length > 1 && !places.some(n => body[0].text.split('。')[0].includes(n))) out.push(issue('info', `镜头${k + 1} 开头要写在哪个分场景`, loc));
        return;
      }
      if (!has('本镜调用')) out.push(issue('warn', `镜头${k + 1} 缺「本镜调用」`, loc));
      if (!has('环境音')) out.push(issue('warn', `镜头${k + 1} 缺「环境音」`, loc));
      if (!has('切点')) out.push(issue('info', `镜头${k + 1} 缺「切点」`, loc));
    });
  }
  return out;
}

function lintScript(doc) {
  const out = [];
  const [H, B] = doc.sections.map(s => s.blocks);
  const get = l => H.find(b => labelOf(b.text) === l);
  const scene = get('场景'), cast = get('人物');   // 段头的场景、人物可以没有（11-16 晚他定：剧本直接从正文写，场景、人物定稿以后 AI 提炼）；写了才查
  if (scene && splitLabel(scene.text).value.trim() && splitLabel(scene.text).value.split('｜').length < 3) out.push(issue('info', '场景按「时间｜内/外｜地点」三项写', { sec: 'head', block: scene.id }));
  const dur = get('时长');
  if (dur) out.push(issue('warn', '固定格式不写时长，这一行删掉', { sec: 'head', block: dur.id }));
  if (!B.some(b => b.text.replace(/^[△▲]\s*/, '').trim())) out.push(issue('warn', '正文还是空的', { sec: 'body' }));
  const names = cast ? parseCast(splitLabel(cast.text).value).map(c => c.name) : [];
  for (const b of B) {
    const role = scriptRole(b.text, 'body');
    const loc = { sec: 'body', block: b.id };
    if (role === 'plain' && b.text.trim()) out.push(issue('info', '这一行不是 △ 动作、台词、字幕、音效中的任何一种', loc));
    if (/[0-9０-９](?:\.[0-9]+)?\s*秒/.test(b.text)) out.push(issue('info', '剧本里不写秒数', loc));
    if (role === 'action' && !b.text.replace(/^[△▲]\s*/, '').trim()) out.push(issue('info', '空的 △ 动作行', loc));
    if (role === 'line' && names.length) {
      const who = parseLine(b.text).who;
      if (!names.some(n => n.includes(who) || who.includes(n.replace(/若干$/, '')))) out.push(issue('info', '台词角色「' + who + '」不在人物表里', loc));
    }
  }
  return out;
}

function lintShots(doc) {
  const out = [];
  if (!doc.shots.length) out.push(issue('warn', '还没有镜头', { sec: 'shots' }));
  doc.shots.forEach((sh, k) => {
    const loc = { shot: sh.id }, n = countChars(sh.title);
    if (!n) out.push(issue('warn', `镜头${k + 1} 还没写概述`, loc));
    else if (n > SHOT_MAX) out.push(issue('warn', `镜头${k + 1} 的概述有 ${n} 个字，不能超过十个字`, loc));
    if (/[0-9０-９]\s*秒/.test(sh.title)) out.push(issue('warn', `镜头${k + 1} 的概述里不写秒数`, loc));
  });
  const old = shotOldCount(doc);
  if (old) out.push(issue('warn', `还留着 ${old} 行旧格式的内容；固定格式只写每一镜的概述`, { sec: 'old' }));
  return out;
}

/* ---------- 文本编码 ---------- */
function decodeText(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'utf-8' }; }
  catch (e) {
    try { return { text: new TextDecoder('gb18030').decode(u8), encoding: 'gb18030' }; }
    catch (e2) { return { text: TD.decode(u8), encoding: 'utf-8' }; }
  }
}
/* TextDecoder 会吃掉开头的 BOM：先看原始字节 */
function hasBom(buf) { const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf); return u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF; }
const encodeText = s => TE.encode(s);

/* ---------- 红批：先按段对齐，再按字比对 ---------- */
// 文档里能改的文字，按显示顺序：每一行，加上镜头表的概述
function units(doc) {
  const out = [];
  (function walk(x) {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    if (typeof x.text === 'string') { out.push({ k: x.id, t: x.text }); return; }
    if (typeof x.title === 'string') out.push({ k: 't' + x.id, t: x.title });
    for (const v of Object.values(x)) if (v && typeof v === 'object') walk(v);
  })(doc);
  return out;
}
// 最长公共子序列：[[op, a 的下标, b 的下标]]，op 为 '=' '-' '+'
function lcsOps(a, b) {
  const n = a.length, m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) ops.push(['=', i++, j++]);
    else if (j < m && (i === n || L[i][j + 1] >= L[i + 1][j])) ops.push(['+', -1, j++]);
    else ops.push(['-', i++, -1]);
  }
  return ops;
}
// 两段文字有多像：相同的两字组合占多少
function similar(a, b) {
  if (a.length < 2 || b.length < 2) return 0;
  const g = new Map();
  for (let i = 0; i < a.length - 1; i++) { const k = a.substr(i, 2); g.set(k, (g.get(k) || 0) + 1); }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) { const k = b.substr(i, 2), c = g.get(k); if (c) { hit++; g.set(k, c - 1); } }
  return 2 * hit / (a.length + b.length - 2);
}
// base：原来的文字（数组）；doc：现在的文档
// 返回 Map(key → { was: 原文，新加的为 null；gone: 这一段前面删掉的段 })，没改过的段不在里面
function redline(base, doc) {
  const cur = units(doc), now = cur.map(u => u.t);
  const marks = new Map();
  let s = 0; while (s < base.length && s < now.length && base[s] === now[s]) s++;
  let e = 0; while (e < base.length - s && e < now.length - s && base[base.length - 1 - e] === now[now.length - 1 - e]) e++;
  const a = base.slice(s, base.length - e), b = now.slice(s, now.length - e);
  let gone = [], dels = [], adds = [];
  const put = (j, was) => {
    const u = cur[s + j];
    if (was === null && !u.t.trim() && !gone.length) return;   // 新加的空行不标
    if (was !== u.t || gone.length) marks.set(u.k, { was, gone });
    gone = [];
  };
  // 一处连续的改动里，删掉的和新加的按相似度配对：配上的算「改过」，配不上的算删了、加了
  const flush = () => {
    let from = 0;
    for (const x of dels) {
      let best = -1, bs = .3;
      for (let k = from; k < adds.length; k++) { const v = similar(a[x], b[adds[k]]); if (v > bs) { bs = v; best = k; } }
      if (best < 0) { if (a[x].trim()) gone.push(a[x]); continue; }
      for (let k = from; k < best; k++) put(adds[k], null);
      put(adds[best], a[x]); from = best + 1;
    }
    for (let k = from; k < adds.length; k++) put(adds[k], null);
    dels = []; adds = [];
  };
  for (const [op, i, j] of lcsOps(a, b)) {
    if (op === '=') { flush(); if (gone.length) put(j, a[i]); }
    else if (op === '-') dels.push(i); else adds.push(j);
  }
  flush();
  if (gone.length) {
    const nx = cur[s + b.length], u = cur[cur.length - 1];
    if (nx) marks.set(nx.k, { was: nx.t, gone });
    else if (u) { const m = marks.get(u.k); marks.set(u.k, { was: m ? m.was : u.t, gone: m ? m.gone : [], tail: gone }); }   // 删在全文最后的，跟在最后一段后面
  }
  return marks;
}
// 一段之内按字比对：[['=', 没动的], ['-', 删掉的], ['+', 添上的]]
function diffChars(a, b) {
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const x = a.slice(s, a.length - e), y = b.slice(s, b.length - e);
  const runs = [];
  const add = (op, t) => { const l = runs[runs.length - 1]; if (l && l[0] === op) l[1] += t; else runs.push([op, t]); };
  if (s) add('=', a.slice(0, s));
  if (x.length * y.length > 4e6) { add('-', x); add('+', y); }
  else for (const [op, i, j] of lcsOps(x, y)) add(op, op === '+' ? y[j] : x[i]);
  if (e) add('=', a.slice(a.length - e));
  // 夹在两处改动中间的一两个字并进改动里，红批读起来是一整处
  const out = [];
  let del = '', ins = '';
  const flush = () => { if (del) out.push(['-', del]); if (ins) out.push(['+', ins]); del = ins = ''; };
  runs.forEach(([op, t], k) => {
    if (op === '-') del += t;
    else if (op === '+') ins += t;
    else if ((del || ins) && t.length <= 2 && k < runs.length - 1) { del += t; ins += t; }
    else { flush(); out.push(['=', t]); }
  });
  flush();
  return out;
}

/* ---------- 批注：存成 Markdown，AI 照着改，编辑器也读得回来 ---------- */
// nt = { title, file, general, items: [{ where, text, n, note }] }；n：同样的原文是全文第几处
function notesToMd(nt) {
  const out = [`# 批注｜${nt.title}`, '', `文件：${nt.file}`, '',
    'AI 照 AGENTS.md 的「按批注修改」来改：只改批注说到的地方，别的一字不动；改版前原文件移进 历史记录，改完这份批注也移进去。',
    '批注要是把原文抄下来改过的，就是要这一段改成批注里写的样子。', ''];
  if (nt.general) out.push('## 整体', '批注：' + nt.general, '');
  nt.items.forEach((x, i) => out.push(`## ${i + 1}｜${x.where}`, `原文${x.n > 1 ? `（第${x.n}处）` : ''}：${x.text}`, '批注：' + x.note, ''));
  return out.join('\n');
}
function parseNotes(md) {
  const all = [];
  let cur = null;
  for (const line of String(md).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const hd = /^##\s*(整体|\d+)\s*(?:[｜|]\s*(.*))?$/.exec(line);
    if (hd) { all.push(cur = { where: hd[1] === '整体' ? null : (hd[2] || '').trim(), text: null, n: 1, note: null }); continue; }
    if (!cur) continue;
    if (cur.note !== null) { cur.note += '\n' + line; continue; }
    const m = /^批注：(.*)$/.exec(line), o = cur.text === null && /^原文(?:（第(\d+)处）)?：(.*)$/.exec(line);
    if (m) cur.note = m[1];
    else if (o) { cur.text = o[2]; cur.n = +o[1] || 1; }
    else if (cur.text !== null) cur.text += '\n' + line;   // 原文里本来就有换行
  }
  const done = all.filter(x => x.note !== null && x.note.trim()).map(x => ({ ...x, note: x.note.trim() }));
  const g = done.find(x => x.where === null);
  return { general: g ? g.note : '', items: done.filter(x => x.where !== null && x.text !== null) };
}

/* ---------- 文件名（流水线各页、审片台、本机服务 jobs.js 都用这一份） ---------- */
/* Windows 文件名里能不能用 */
const nameOk = n => !!n && !/[<>:"\\/|?*\u0000-\u001f]/.test(n) && !/^\.+$/.test(n) && !/[. ]$/.test(n);
/* 只用文字写的场景起个名：「面摊：傍晚……」叫「面摊」，「一个出租屋内，一张床……」叫「一个出租屋内」；起不出来给空 */
function sceneStem(t) {
  const x = (typeof t === 'string' ? t : '').trim(), c = x.search(/[：:]/), p = x.search(/[，,。；;\n]/);
  const a = (c >= 1 && c <= 12 && (p < 0 || c < p) ? x.slice(0, c) : p >= 2 && p <= 14 ? x.slice(0, p) : x.slice(0, 12)).replace(/[<>:"\\/|?*\u0000-\u001f]/g, '').trim().replace(/[. ]+$/, '');
  return nameOk(a) ? a : '';
}
/* 只用文字写、不出图（2026-11-17 他要：只出现一次的人物、道具、场景，用文字锁就行）。记在这一场的「不出图」：{ 人物: [名字], 道具: [名字], 场景: [地方名] }。
   资产那一步不算缺图、不写出图提示词；写视频提示词时照全片设定里的描写写。挂上了图的照图，这一条不管。页面和本机服务共用这一份 */
const NO_IMG_KINDS = ['人物', '道具', '场景'];
const strList = a => Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))] : [];
function noImgList(s, k) { const m = s && s.不出图; return strList(m && typeof m === 'object' && !Array.isArray(m) ? m[k] : null); }
const noImg = (s, k, name) => NO_IMG_KINDS.includes(k) && typeof name === 'string' && !!name.trim() && noImgList(s, k).includes(name.trim());
function setNoImg(s, k, name, on) {   // 改了回 true；一样都不剩就把「不出图」整个去掉
  const n = typeof name === 'string' ? name.trim() : '';
  if (!s || typeof s !== 'object' || !NO_IMG_KINDS.includes(k) || !n) return false;
  const cur = noImgList(s, k), next = on ? [...new Set([...cur, n])] : cur.filter(x => x !== n);
  if (next.length === cur.length) return false;
  const m = {};
  for (const x of NO_IMG_KINDS) { const a = x === k ? next : noImgList(s, x); if (a.length) m[x] = a; }
  if (Object.keys(m).length) s.不出图 = m; else delete s.不出图;
  return true;
}
/* 不要 GEO（2026-11-17 他要：只用一次、没有严格站位的场景用不着 GEO）。记在这一场的「不要GEO」：[地方名]（场景图写图名，只用文字写的写冒号前的地方名）。
   写出图提示词不写 GEO 底稿，出了图不核 GEO，写视频提示词不用 GEO。只用文字写、不出图的场景也算不要 */
const noGeo = (s, stem) => typeof stem === 'string' && !!stem.trim() && (strList(s && s.不要GEO).includes(stem.trim()) || noImg(s, '场景', stem));
function setNoGeo(s, stem, on) {   // 改了回 true；一个不剩就把「不要GEO」去掉
  const n = typeof stem === 'string' ? stem.trim() : '';
  if (!s || typeof s !== 'object' || !n) return false;
  const cur = strList(s.不要GEO), next = on ? [...new Set([...cur, n])] : cur.filter(x => x !== n);
  if (next.length === cur.length) return false;
  if (next.length) s.不要GEO = next; else delete s.不要GEO;
  return true;
}
/* 视频提示词（2026-11-16 他定）：名字就是这一条拍的镜头表镜头号，1-5.txt、4-9.txt；只拍一个镜头 3.txt；勾的不连着 1-3、5.txt。
   审片以后照修改方案另存的 _改1、_改2 也算。老稿照旧认：视频提示词.txt 第 1 条、视频提示词_02.txt 第 2 条，名字前面带别的（镜头1-5_视频提示词.txt）。
   以前的补片稿（4-6_补1.txt、视频提示词_改2_补1.txt）11-18 起也是正片提示词（他定，不再剪进样片）：名字照旧，各算单独的一条，改了另存 4-6_补1_改1.txt。
   接力稿（11-19）：一个镜头拆成前后两条出片，名字最后加 _前半条、_后半条（1_改6_前半条.txt、1_改6_后半条.txt；没改过的 1_前半条.txt）。
   前半条、后半条各算一条，改了另存 1_改9_后半条.txt；出片任务书 1_出片任务_改8_后半条.txt，样片 1_改8_后半条.mp4 */
const SHOT_CODE = '[0-9]+[a-z]?(?:-[0-9]+[a-z]?)?(?:、[0-9]+[a-z]?(?:-[0-9]+[a-z]?)?)*';   // 镜头表的固定号：中间加的镜头是 3b（公用/关键帧绑定.js）
const VP_HALF = '_[前后]半条';   // 接力稿的前半条、后半条：在名字最后，改几的后面
const VP_TAIL = '(?:(?:_改[0-9]+)?_补[0-9]+)?(?:_改[0-9]+)?(?:' + VP_HALF + ')?';   // 老名字里的「补几」算这一条名字的一部分，后面才是改几，最后是接力稿的前半条、后半条
const RE_VP = new RegExp('(?:(?:^|_)视频提示词(?:_[0-9]+)?|^' + SHOT_CODE + ')' + VP_TAIL + '\\.txt$', 'i');
const RE_VER = new RegExp('_改([0-9]+)((?:' + VP_HALF + ')?\\.txt)$', 'i');   // 改几：接力稿的在前半条、后半条前面
const vpVer = name => +((RE_VER.exec(String(name)) || [])[1] || 0);   // 改的第几版；原稿是 0
const vpBase = name => String(name).replace(RE_VER, '$2');   // 这一条的原稿名：1_改6_前半条.txt → 1_前半条.txt
const RE_HALF = new RegExp('(' + VP_HALF + ')(\\.txt)$', 'i');
const vpHalf = name => { const m = RE_HALF.exec(String(name)); return m ? m[1].slice(1) : ''; };   // 接力稿是「前半条」还是「后半条」；不是接力稿给 ''
const vpWhole = name => String(name).replace(RE_HALF, '$2');   // 去掉前半条、后半条：同一镜头的整条稿（1_改6_前半条.txt → 1_改6.txt）
const vpNo = name => { const b = vpWhole(vpBase(name)); return /^视频提示词\.txt$/i.test(b) ? 1 : +((/^视频提示词_([0-9]+)\.txt$/i.exec(b) || [])[1] || 0); };   // 老稿第几条；镜头号起名的、别的老稿是 0
/* 镜头号起名的：1-5.txt（改几的、老名字补几的也算）→ '1-5'；不是这样起名的给 '' */
const vpCode = name => { const m = new RegExp('^(' + SHOT_CODE + ')' + VP_TAIL + '\\.txt$', 'i').exec(String(name)); return m ? m[1] : ''; };
/* 名字里的镜头号拍哪几镜、勾了哪几镜起什么名：照镜头表的固定号算，在 公用/关键帧绑定.js（ShotBind.expand、ShotBind.codeOf） */
/* 老名字带「补几」的，标签、记号照前半截起，后面接上补几、改几：4-6_补1.txt → 镜头4-6 补1；4-6_补1_改1.txt → 镜头4-6 补1 改1。接力稿最后接上前半条、后半条：1_改6_前半条.txt → 镜头1 改6 前半条 */
const buOf = name => { const m = /^(.*?)_补([0-9]+)(?:_改[0-9]+)?\.txt$/i.exec(String(name)); return m ? { head: m[1] + '.txt', no: +m[2] } : null; };
const vpLabel = name => { const hf = vpHalf(name); if (hf) return vpLabel(vpWhole(name)) + ' ' + hf; const u = buOf(name), v = vpVer(name); if (u) return vpLabel(u.head) + ' 补' + u.no + (v ? ' 改' + v : ''); const b = vpBase(name), n = vpNo(b), c = vpCode(b); return (c ? '镜头' + c : n ? '第' + n + '条' : b.replace(/_?视频提示词\.txt$/i, '').replace(/_/g, ' ') || '整场') + (v ? ' 改' + v : ''); };
/* 记号：1-5、1-5改1；老稿 提示词01、镜头1-5改1。镜头号起名的不加「镜头」，免得和老稿 镜头1-5 撞上。11-18 以前的样片名里写的是它（第3-4段_第20条_1改3_720p.mp4），认老样片还用它 */
const vpTok = name => { const hf = vpHalf(name); if (hf) return vpTok(vpWhole(name)) + hf; const u = buOf(name), v = vpVer(name); if (u) return vpTok(u.head) + '补' + u.no + (v ? '改' + v : ''); const b = vpBase(name), n = vpNo(b), c = vpCode(b); return (c || (n ? '提示词' + String(n).padStart(2, '0') : b.replace(/_?视频提示词\.txt$/i, '') || '整场')) + (v ? '改' + v : ''); };
/* 一条只留最新那一版（流水线各页、本机服务 jobs.js 共用）：names 里的视频提示词照这一条的原稿名（vpBase）分开，给 [{ key: 原稿名, vers: 几版，照改几从旧到新排 }]，最后一版就是现在用的。
   接力稿（11-19）：前半条、后半条各算一条。同一镜头的接力稿改到的版比整条稿新，整条稿那一条不再摆（1_改5.txt 和 1_改8_后半条.txt：只摆接力稿）；
   反过来整条稿比接力稿新，接力稿不摆；一样新的都摆 */
function vpFams(names) {
  const by = new Map(), top = new Map();   // top：同一镜头（去掉前半条、后半条）整条稿、接力稿各改到第几版
  for (const n of names || []) if (RE_VP.test(n)) { const b = vpBase(n); if (!by.has(b)) by.set(b, []); by.get(b).push(n); }
  for (const [b, vers] of by) {
    vers.sort((x, y) => vpVer(x) - vpVer(y));
    const w = vpWhole(b), t = top.get(w) || [-1, -1], i = w === b ? 0 : 1;
    t[i] = Math.max(t[i], vpVer(vers[vers.length - 1]));
    top.set(w, t);
  }
  return [...by].filter(([b]) => { const w = vpWhole(b), t = top.get(w); return w === b ? !(t[1] > t[0]) : !(t[0] > t[1]); }).map(([key, vers]) => ({ key, vers }));
}
/* 几条提示词摆的先后（两个名字比）：照原稿名排，镜头号照数比，4-6 在 4-6_补1 前面；接力稿跟在同一镜头的整条稿后面，前半条在后半条前面（照拼音排，「后」会跑到「前」前面） */
const HALF_NO = { 前半条: 1, 后半条: 2 };
const vpSort = (a, b) => { const k = n => vpWhole(n).replace(/\.txt$/i, ''); return k(a).localeCompare(k(b), 'zh', { numeric: true }) || (HALF_NO[vpHalf(a)] || 0) - (HALF_NO[vpHalf(b)] || 0); };
/* 出片任务书和提示词一一对应：1-5_改1.txt ↔ 1-5_出片任务_改1.txt，老名字 4-6_补1.txt ↔ 4-6_出片任务_补1.txt；老稿 视频提示词_02_改1.txt ↔ 出片任务_02_改1.txt（页面、本机服务都用这一份） */
const RE_TASK = new RegExp('出片任务(_[0-9]+)?(' + VP_TAIL + ')\\.txt$', 'i');
const vpTask = name => { const c = vpCode(name); return c ? String(name).replace(new RegExp('^[^_.]+(' + VP_TAIL + ')\\.txt$', 'i'), c + '_出片任务$1.txt') : String(name).replace(new RegExp('视频提示词(_[0-9]+)?(' + VP_TAIL + ')\\.txt$', 'i'), '出片任务$1$2.txt'); };
const taskVp = name => { const m = new RegExp('^(' + SHOT_CODE + ')_出片任务(' + VP_TAIL + ')\\.txt$', 'i').exec(String(name)); return m ? m[1] + m[2] + '.txt' : String(name).replace(RE_TASK, '视频提示词$1$2.txt'); };
/* 样片名（2026-11-18 他定：和出它的提示词一模一样，好找）：1_改3.txt 出的叫 1_改3.mp4，同一版再出一条叫 1_改3_2.mp4、_3……；老名字 4-6_补1.txt 出的叫 4-6_补1.mp4。
   以前的样片名字不改（第3-4段_第20条_1改3_720p.mp4，clipOld 认得出），照名字里的记号 vpTok 认 */
const RE_CLIP = /\.(mp4|m4v|mov|webm)$/i;
const clipOld = vid => /_第[0-9]+条_/.test(String(vid));
/* 样片 vid 是 name 这一版出的第几条：1_改3.mp4 → 1，1_改3_2.mp4 → 2；不是这一版出的给 0（4-6_补1.mp4 是 4-6_补1.txt 出的，不算 4-6.txt 的） */
function clipTake(vid, name) {
  const v = String(vid), p = String(name).replace(/\.txt$/i, ''), r = v.replace(RE_CLIP, '');
  if (!p || !RE_CLIP.test(v)) return 0;
  if (r === p) return 1;
  const m = r.startsWith(p + '_') ? /^_([0-9]+)$/.exec(r.slice(p.length)) : null;
  return m ? +m[1] : 0;
}
/* 这一版下一条样片叫什么：names 是这一段 成片、历史记录/成片 里的文件名（移进历史记录的名字不改，也要让开） */
const clipName = (name, names) => { const k = [...(names || [])].reduce((m, n) => Math.max(m, clipTake(n, name)), 0); return String(name).replace(/\.txt$/i, '') + (k ? '_' + (k + 1) : '') + '.mp4'; };
/* 审片那一步锁不锁（11-18 他定：出好的样片随时能审）。n：这一场几条提示词；vids：几条样片；st：提示词那一步的状态（ok、ai AI 在写、you 待核对）。
   有样片就不锁：提示词待核对、AI 在写都不挡，待核对标在那条样片上。没提示词锁（'none'）；没样片时提示词那一步没好也锁（'ai'、'stale'）。不锁给 '' */
const reviewLock = (n, vids, st) => !n ? 'none' : vids || st === 'ok' ? '' : st === 'ai' ? 'ai' : 'stale';

/* 剧本定稿了没有（服务、页面共用）：点过「剧本定稿」（fin），之后剧本没再动；或者之后只是照定稿的片子改过（back：那一回改完的时间，11-18 他定「照片子改剧本」不用重新定稿）。
   时间写成「2026-11-18 03:00:00」，剧本文件时间到毫秒：比的时候让一秒 */
function scriptFinal(fin, back, mtime) {
  const t = v => { const n = Date.parse(String(v || '').trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const f = t(fin), b = t(back);
  return !!f && (f + 999 >= mtime || (b >= f && b + 999 >= mtime));
}
/* 照片子改剧本以后，这一场跟着记（页面用，对剧本.js）：list 是对剧本记录，nos 是镜头表各镜的号。
   最新一笔「照片子改剧本」改之前剧本是定稿的、比这一场记的「回填」新：记上「回填」，删掉的镜头从镜头表拿掉（号先写死，后面的不挪号）。改了给 true */
function applyBack(s, list, nos) {
  const t = v => { const n = Date.parse(String(v || '').trim().replace(' ', 'T')); return isNaN(n) ? 0 : n; };
  const r = (Array.isArray(list) ? list : []).filter(x => x && x.事 === '照片子改剧本' && x.定稿照旧).pop();
  if (!s || !r || t(r.时间) <= t(s.回填)) return false;
  s.回填 = r.时间;
  const gone = new Set((Array.isArray(r.删镜头) ? r.删镜头 : []).map(String));
  if (gone.size && Array.isArray(s.段落)) { s.段落.forEach((x, i) => { if (x && nos && nos[i]) x.号 = nos[i]; }); s.段落 = s.段落.filter(x => !gone.has(String(x && x.号))); }
  return true;
}

/* ---------- 深拷贝 / 复制 ---------- */
function cloneDoc(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  const re = o => { if (Array.isArray(o)) o.forEach(re); else if (o && typeof o === 'object') { if ('id' in o) o.id = uid(); Object.values(o).forEach(re); } };
  re(d);
  return d;
}

const Core = {
  version: '1.0',
  uid, blk, toHalf, normSeg, segFromName, isRangeName, segCompare, nextSeg, splitLabel, labelOf, cleanPara, CN_NUM,
  crc32, unzip, zip, readDocx, writeDocx, docxXmlParagraphs,
  SCRIPT_HEAD, parseScripts, scriptToParas, scriptTemplate, scriptRole, parseLine, parseCast, scriptTitle, newScriptDoc,
  SHOT_MAX, countChars, parseShotList, shotsToParas, shotsTemplate, shotTitle, newShot, newShotDoc, shotOldCount, shotsOverLimit,
  PROMPT_SECTIONS, PROMPT_SECTIONS_NEW, PROMPT_SECTIONS_PE, PE_MARKS, promptFormat, promptTable, PROMPT_BASIC, PROMPT_RULES, PROMPT_SHOT_HEAD, PROMPT_SUB, PROMPT_SHOT_TAIL, RE_SUB,
  parsePrompt, serializePrompt, splitWithEol, joinLines, wrapPara, isBlank, edgeRange, ensureTrailingBlank, promptTemplate, promptSectionKey, promptShotTitle, renumberPromptShots, newPromptShot, PROMPT_SKELETON,
  lintPrompt, lintScript, lintShots, decodeText, hasBom, encodeText, cloneDoc,
  units, redline, diffChars, notesToMd, parseNotes,
  nameOk, sceneStem, NO_IMG_KINDS, noImgList, noImg, setNoImg, noGeo, setNoGeo, SHOT_CODE, RE_VP, vpVer, vpBase, vpNo, vpCode, vpLabel, vpTok, vpFams, vpSort, RE_TASK, vpTask, taskVp, RE_CLIP, clipOld, clipTake, clipName, reviewLock,
};
Core.scriptFinal = scriptFinal; Core.applyBack = applyBack;
if (typeof module !== 'undefined' && module.exports) module.exports = Core;
G.Core = Core;
})(typeof globalThis !== 'undefined' ? globalThis : this);
