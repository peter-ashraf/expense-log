// Minimal, dependency-free .xlsx writer/reader laid out like the original "Expense Log" workbook:
//   Summary | Categories | one sheet per month ("Aug-26", "Sept-26", ...) with
//   a balance table (A1:C2) and a transactions table (A4:F...).
// Writing uses an uncompressed ZIP; reading handles stored + deflated entries.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

export const sheetNameFor = (key) => {
  const [y, m] = key.split('-');
  return MONTHS[+m - 1] + '-' + y.slice(-2);
};

export function parseSheetName(name) {
  const parts = String(name).split('-');
  if (parts.length !== 2) return null;
  const mt = parts[0].trim().toLowerCase();
  const yt = parts[1].trim();
  if (!/^\d{2}$/.test(yt)) return null;
  let idx = MONTHS.findIndex((m) => m.toLowerCase() === mt);
  if (idx < 0 && mt === 'sep') idx = 8;
  if (idx < 0) return null;
  return `${2000 + Number(yt)}-${String(idx + 1).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ ZIP
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const u16 = (n) => [n & 255, (n >> 8) & 255];
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

function concat(chunks) {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;
    const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(crc), ...u32(size), ...u32(size), ...u16(name.length), ...u16(0)]);
    chunks.push(lh, name, f.data);
    central.push({ name, crc, size, offset });
    offset += lh.length + name.length + size;
  }
  const cdStart = offset;
  for (const c of central) {
    const h = new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(dosTime), ...u16(dosDate),
      ...u32(c.crc), ...u32(c.size), ...u32(c.size), ...u16(c.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(c.offset)]);
    chunks.push(h, c.name);
    offset += h.length + c.name.length;
  }
  chunks.push(new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(central.length), ...u16(central.length),
    ...u32(offset - cdStart), ...u32(cdStart), ...u16(0)]));
  return concat(chunks);
}

async function inflateRaw(u8) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function unzip(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not a valid .xlsx file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Corrupt file.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries[name] = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  const read = async (name) => {
    const e = entries[name];
    if (!e) return null;
    const lnlen = dv.getUint16(e.off + 26, true);
    const lelen = dv.getUint16(e.off + 28, true);
    const start = e.off + 30 + lnlen + lelen;
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method === 8) return inflateRaw(raw);
    throw new Error('Unsupported compression in this file.');
  };
  return { names: Object.keys(entries), read, text: async (n) => { const d = await read(n); return d ? dec.decode(d) : null; } };
}

// ------------------------------------------------------------------ XML helpers
const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// eslint-disable-next-line no-control-regex
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = (i) => String.fromCharCode(65 + i); // A..Z is enough here (<= 26 columns)
const serial = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
};
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

class Strings {
  constructor() { this.list = []; this.map = new Map(); this.count = 0; }
  id(s) {
    s = clean(s);
    this.count++;
    if (!this.map.has(s)) { this.map.set(s, this.list.length); this.list.push(s); }
    return this.map.get(s);
  }
  xml() {
    return `${XML_HEAD}<sst xmlns="${NS}" count="${this.count}" uniqueCount="${this.list.length}">${this.list
      .map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  }
}

// Cell builders (styles: 0 default, 1 date, 2 money, 3 bold, 4 month, 5 title)
const sCell = (sst, ref, text, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ''} t="s"><v>${sst.id(text)}</v></c>`;
const nCell = (ref, n, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${n}</v></c>`;
const fCell = (ref, formula, cached, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ''}><f>${xmlEsc(formula)}</f><v>${cached}</v></c>`;
const eCell = (ref, style = 0) => `<c r="${ref}"${style ? ` s="${style}"` : ''}/>`;

const STYLES = `${XML_HEAD}<styleSheet xmlns="${NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd\\-mmm\\-yy"/><numFmt numFmtId="165" formatCode="mmm\\ yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="2">
<dxf><font><b/><color rgb="FF16A34A"/></font><fill><patternFill><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FFDC2626"/></font><fill><patternFill><bgColor rgb="FFFEE2E2"/></patternFill></fill></dxf>
</dxfs>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

const tableXml = (id, name, ref, cols, style) =>
  `${XML_HEAD}<table xmlns="${NS}" id="${id}" name="${name}" displayName="${name}" ref="${ref}" totalsRowShown="0">` +
  `<autoFilter ref="${ref}"/><tableColumns count="${cols.length}">${cols.map((c, i) => `<tableColumn id="${i + 1}" name="${xmlEsc(c)}"/>`).join('')}</tableColumns>` +
  `<tableStyleInfo name="${style}" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;

const sheetXml = ({ views, cols, rows, extra = '', tables = 0 }) =>
  `${XML_HEAD}<worksheet xmlns="${NS}" xmlns:r="${NS_R}"><sheetViews>${views}</sheetViews><sheetFormatPr defaultRowHeight="15"/>` +
  `<cols>${cols.map(([a, b, w]) => `<col min="${a}" max="${b}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
  `<sheetData>${rows.join('')}</sheetData>${extra}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>` +
  (tables ? `<tableParts count="${tables}">${Array.from({ length: tables }, (_, i) => `<tablePart r:id="rId${i + 1}"/>`).join('')}</tableParts>` : '') +
  '</worksheet>';

const relsXml = (items) =>
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items
    .map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;

/**
 * view: { months: ['2026-08', ...], by: { key: { entries, start, spent, income, available } }, categories: { order, map }, ... }
 * Returns a Uint8Array containing the .xlsx file.
 */
export function buildWorkbook(view) {
  const enc = new TextEncoder();
  const sst = new Strings();
  const parts = [];
  const add = (name, text) => parts.push({ name, data: enc.encode(text) });
  const sheets = []; // { name, file }
  const tableList = []; // { file, xml, sheetIdx }
  let tableId = 0;

  const cats = view.categories || { order: [], map: {} };
  const keys = view.months.slice();
  const monthSheetNames = keys.map(sheetNameFor);

  // ---- Summary
  {
    const rows = [];
    rows.push(`<row r="1">${sCell(sst, 'A1', 'ANNUAL EXPENSE & INCOME SUMMARY', 5)}${eCell('B1', 5)}${eCell('C1', 5)}${eCell('D1', 5)}</row>`);
    rows.push(`<row r="3">${['Month', 'Starting Balance', 'Total Spent', 'Available Balance'].map((h, i) => sCell(sst, colName(i) + 3, h, 3)).join('')}</row>`);
    keys.forEach((k, i) => {
      const r = 4 + i;
      const m = view.by[k];
      const q = `'${monthSheetNames[i]}'!`;
      rows.push(`<row r="${r}">${nCell('A' + r, serial(k + '-01'), 4)}${fCell('B' + r, `${q}A2`, m.start, 2)}${fCell('C' + r, `${q}B2`, m.spent, 2)}${fCell('D' + r, `${q}C2`, m.available, 2)}</row>`);
    });
    sheets.push({
      name: 'Summary',
      xml: sheetXml({
        views: '<sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView>',
        cols: [[1, 1, 14], [2, 4, 22]], rows,
        extra: '<mergeCells count="1"><mergeCell ref="A1:D1"/></mergeCells>',
      }),
    });
  }

  // ---- Categories
  {
    const order = cats.order.slice();
    const all = order.concat(['Income']);
    const map = Object.assign({}, cats.map, { Income: ['Income'] });
    const maxSubs = Math.max(0, ...all.map((c) => (map[c] || []).length));
    const nRows = Math.max(all.length, maxSubs) + 1;
    const rows = [];
    for (let r = 1; r <= nRows; r++) {
      let cells = '';
      // column A: the CategoryList table (header + category names)
      if (r === 1) cells += sCell(sst, 'A1', 'Categories');
      else if (all[r - 2] !== undefined) cells += sCell(sst, 'A' + r, all[r - 2]);
      // columns B..: one column per category (header = name, below = sub-categories)
      all.forEach((c, i) => {
        const ref = colName(i + 1) + r;
        if (r === 1) cells += sCell(sst, ref, c, 3);
        else if ((map[c] || [])[r - 2] !== undefined) cells += sCell(sst, ref, map[c][r - 2]);
      });
      rows.push(`<row r="${r}">${cells}</row>`);
    }
    tableId++;
    tableList.push({ sheetIdx: 1, file: `table${tableId}.xml`, xml: tableXml(tableId, 'CategoryList', `A1:A${all.length + 1}`, ['Categories'], 'TableStyleMedium2') });
    sheets.push({
      name: 'Categories',
      xml: sheetXml({
        views: '<sheetView workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView>',
        cols: [[1, 1, 18], [2, 12, 18]], rows, tables: 1,
      }),
    });
  }

  // ---- One sheet per month
  keys.forEach((k, i) => {
    const m = view.by[k];
    const sname = monthSheetNames[i];
    const suffix = sname.replace(/-/g, '_');
    const tx = `tblTransactions_${suffix}`;
    const bal = `tblBalance_${suffix}`;
    const entries = m.entries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const n = Math.max(entries.length, 1);
    const rows = [];
    rows.push(`<row r="1">${['Starting Balance', 'Total Spent', 'Available Balance'].map((h, j) => sCell(sst, colName(j) + 1, h)).join('')}</row>`);
    const startCell = i === 0 ? nCell('A2', m.start, 2) : fCell('A2', `'${monthSheetNames[i - 1]}'!C2`, m.start, 2);
    rows.push(`<row r="2">${startCell}${fCell('B2', `SUMIFS(${tx}[Amount],${tx}[Type],"Expense")`, m.spent, 2)}${fCell('C2', `A2-B2+SUMIFS(${tx}[Amount],${tx}[Type],"Income")`, m.available, 2)}</row>`);
    rows.push(`<row r="4">${['Date', 'Description', 'Amount', 'Type', 'Category', 'Sub-Category'].map((h, j) => sCell(sst, colName(j) + 4, h)).join('')}</row>`);
    for (let j = 0; j < n; j++) {
      const r = 5 + j;
      const e = entries[j];
      rows.push(e
        ? `<row r="${r}">${nCell('A' + r, serial(e.date), 1)}${sCell(sst, 'B' + r, e.description || '')}${nCell('C' + r, e.amount, 2)}${sCell(sst, 'D' + r, e.type)}${sCell(sst, 'E' + r, e.category)}${sCell(sst, 'F' + r, e.sub)}</row>`
        : `<row r="${r}">${eCell('A' + r, 1)}${eCell('B' + r)}${eCell('C' + r, 2)}${eCell('D' + r)}${eCell('E' + r)}${eCell('F' + r)}</row>`);
    }
    const sheetIdx = sheets.length;
    tableId++;
    tableList.push({ sheetIdx, file: `table${tableId}.xml`, xml: tableXml(tableId, bal, 'A1:C2', ['Starting Balance', 'Total Spent', 'Available Balance'], 'TableStyleMedium2') });
    tableId++;
    tableList.push({ sheetIdx, file: `table${tableId}.xml`, xml: tableXml(tableId, tx, `A4:F${4 + n}`, ['Date', 'Description', 'Amount', 'Type', 'Category', 'Sub-Category'], 'TableStyleMedium9') });
    const cf = `<conditionalFormatting sqref="A5:F${Math.max(1016, 4 + n)}"><cfRule type="expression" dxfId="0" priority="1"><formula>$D5="Income"</formula></cfRule><cfRule type="expression" dxfId="1" priority="2"><formula>$D5="Expense"</formula></cfRule></conditionalFormatting>`;
    sheets.push({
      name: sname,
      xml: sheetXml({
        views: '<sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView>',
        cols: [[1, 1, 22], [2, 2, 32], [3, 3, 22], [4, 4, 14], [5, 5, 18], [6, 6, 18]],
        rows, extra: cf, tables: 2,
      }),
    });
  });

  // ---- package parts
  add('[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
    tableList.map((t) => `<Override PartName="/xl/tables/${t.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join('') +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>');
  add('_rels/.rels', relsXml([['rId1', 'officeDocument', 'xl/workbook.xml']]));
  add('xl/workbook.xml',
    `${XML_HEAD}<workbook xmlns="${NS}" xmlns:r="${NS_R}"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="23000" windowHeight="12000" activeTab="${sheets.length - 1}"/></bookViews><sheets>` +
    sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>');
  add('xl/_rels/workbook.xml.rels', relsXml([
    ...sheets.map((_, i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`]),
    [`rId${sheets.length + 1}`, 'styles', 'styles.xml'],
    [`rId${sheets.length + 2}`, 'sharedStrings', 'sharedStrings.xml'],
  ]));
  add('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, s.xml));
  sheets.forEach((s, i) => {
    const mine = tableList.filter((t) => t.sheetIdx === i);
    if (mine.length) add(`xl/worksheets/_rels/sheet${i + 1}.xml.rels`, relsXml(mine.map((t, j) => [`rId${j + 1}`, 'table', `../tables/${t.file}`])));
  });
  tableList.forEach((t) => add(`xl/tables/${t.file}`, t.xml));
  add('xl/sharedStrings.xml', sst.xml()); // last: every sheet has registered its strings by now
  return zip(parts);
}

// ------------------------------------------------------------------ reading
const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
});

const attrs = (s) => {
  const o = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) o[m[1]] = unesc(m[2]);
  return o;
};

const textOf = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unesc(m[1])).join('');

function parseShared(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

function parseSheetCells(xml, shared) {
  const rows = new Map();
  for (const m of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const a = attrs(m[1]);
    const ref = a.r;
    if (!ref || m[2] === undefined) continue;
    const col = ref.replace(/\d+/g, '');
    const row = Number(ref.replace(/\D+/g, ''));
    const inner = m[2];
    const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
    let val = null;
    if (a.t === 's' && v) val = shared[Number(v[1])] ?? '';
    else if (a.t === 'inlineStr') val = textOf(inner);
    else if (a.t === 'str' && v) val = unesc(v[1]);
    else if (a.t === 'b' && v) val = v[1] === '1';
    else if (v && v[1] !== '') val = Number(v[1]);
    if (val === null || val === undefined || val === '') continue;
    if (!rows.has(row)) rows.set(row, {});
    rows.get(row)[col] = val;
  }
  return rows;
}

const MONTH_RX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

export function matchCategory(categories, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || !categories || !categories.map) return null;
  return Object.keys(categories.map).find((k) => k.toLowerCase() === n) || null;
}

export function matchSub(list, name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || !list) return null;
  return list.find((x) => x.toLowerCase() === n) || null;
}

export function toIsoDate(v) {
  if (typeof v === 'number' && isFinite(v)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})$/.exec(s);
  if (m) {
    const mo = MONTH_RX[m[2].toLowerCase()] || MONTH_RX[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return `${y}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  return null;
}

/**
 * Reads an .xlsx/.xlsm exported by this app or by the original Excel log.
 * Returns { entries: [{date, description, amount, type, category, sub, sheet, row}], skipped: [{sheet,row,reason}], sheets: n }
 */
export async function parseWorkbook(buffer, categories) {
  const z = await unzip(buffer);
  const wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('This file does not look like an Excel workbook.');
  const relsXml0 = (await z.text('xl/_rels/workbook.xml.rels')) || '';
  const rels = {};
  for (const m of relsXml0.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const a = attrs(m[1]);
    if (a.Id && a.Target) rels[a.Id] = a.Target.replace(/^\/?(xl\/)?/, '');
  }
  const shared = parseShared(await z.text('xl/sharedStrings.xml'));
  const sheets = [...wb.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => attrs(m[1]));
  const entries = [];
  const skipped = [];
  let used = 0;
  for (const sh of sheets) {
    if (!parseSheetName(sh.name)) continue;
    const target = rels[sh['r:id']];
    const xml = target && (await z.text('xl/' + target));
    if (!xml) continue;
    used++;
    const rows = parseSheetCells(xml, shared);
    // data starts under the header row ("Date" in A, "Amount" in C); default row 4
    let headerRow = 4;
    for (const [r, cells] of rows) {
      if (String(cells.A || '').toLowerCase() === 'date' && String(cells.C || '').toLowerCase() === 'amount') { headerRow = r; break; }
    }
    const sorted = [...rows.keys()].filter((r) => r > headerRow).sort((a, b) => a - b);
    for (const r of sorted) {
      const c = rows.get(r);
      if (c.A === undefined && c.C === undefined) continue;
      const bad = (reason, fix) => skipped.push({ sheet: sh.name, row: r, reason, ...(fix ? { fix } : {}) });
      const date = toIsoDate(c.A);
      if (!date) { bad('unreadable date'); continue; }
      let amount = c.C;
      if (typeof amount === 'string') amount = Number(amount.replace(/[, ]/g, ''));
      if (!(Number(amount) > 0)) { bad('amount must be above zero'); continue; }
      amount = Math.round(Number(amount) * 100) / 100;
      const t = String(c.D || '').trim().toLowerCase();
      const type = t === 'income' ? 'Income' : t === 'expense' ? 'Expense' : null;
      if (!type) { bad('type must be Expense or Income'); continue; }
      let category = 'Income';
      let sub = 'Income';
      if (type === 'Expense') {
        const typedCat = String(c.E || '').trim();
        const typedSub = String(c.F || '').trim();
        const base = { date, description: String(c.B || '').trim(), amount, type, sheet: sh.name, row: r };
        const canon = matchCategory(categories, typedCat);
        if (!canon) { bad(`unknown category "${typedCat}"`, { ...base, category: typedCat, sub: typedSub }); continue; }
        const canonSub = matchSub(categories.map[canon], typedSub) || (typedSub.toLowerCase() === canon.toLowerCase() ? canon : null);
        // older rows sometimes repeat the category as the sub-category; keep those
        if (!canonSub) { bad(`unknown sub-category "${typedSub}" under ${canon}`, { ...base, category: canon, sub: typedSub }); continue; }
        category = canon;
        sub = canonSub;
      }
      entries.push({ date, description: String(c.B || '').trim(), amount, type, category, sub, sheet: sh.name, row: r });
    }
  }
  return { entries, skipped, sheets: used };
}
