/**
 * Expense Log API (container-bound Apps Script) — JSON over POST, used by the offline-first PWA.
 *
 * Actions:  pull  -> full snapshot
 *           push  -> apply queued ops [{opId, type: add|update|delete, id, data}] idempotently, then snapshot
 *
 * Sheet layout is unchanged (Summary / Categories / one tab per month). Each month tab gets a hidden
 * column G "ID" so edits, deletes and retried uploads can never duplicate or misplace a row.
 */

var API_KEY = 'PASTE-YOUR-SECRET-KEY-HERE';

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
var HEADERS = ['Date', 'Description', 'Amount', 'Type', 'Category', 'Sub-Category', 'ID'];
var BALANCE_LABELS = ['Starting Balance', 'Total Spent', 'Available Balance'];
var HEADER_ROW = 4;
var FIRST_ROW = 5;
var NCOLS = 7;          // A:F data + G id
var ID_COL = 7;

// ------------------------------------------------------------------ HTTP entry points

function doGet() {
  return json_({ ok: true, service: 'Expense Log API' });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    if (!API_KEY || API_KEY === 'PASTE-YOUR-SECRET-KEY-HERE') throw new Error('API key is not set on the server.');
    if (req.key !== API_KEY) throw new Error('Unauthorized');
    out = withLock_(function () {
      if (req.action === 'push') return push_(req.ops || []);
      if (req.action === 'pull') return snapshot_();
      throw new Error('Unknown action');
    });
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return json_(out);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

// ------------------------------------------------------------------ snapshot / push

function snapshot_() {
  var cats = readCategories_();
  var sheets = listMonthSheets_();
  var entries = [];
  var firstStart = 0;
  sheets.forEach(function (m, i) {
    ensureIds_(m.sheet);
    entries = entries.concat(readEntries_(m.sheet));
    if (i === 0) firstStart = Number(m.sheet.getRange('A2').getValue()) || 0;
  });
  return {
    ok: true,
    categories: { order: cats.order, map: cats.map },
    firstStart: firstStart,
    months: sheets.map(function (m) { return m.key; }),
    entries: entries,
    serverTime: Date.now()
  };
}

function push_(ops) {
  var applied = [];
  var rejected = [];
  ops.forEach(function (op) {
    try {
      applyOp_(op);
      applied.push(op.opId);
    } catch (err) {
      rejected.push({ opId: op.opId, error: String(err && err.message || err) });
    }
  });
  SpreadsheetApp.flush();
  var snap = snapshot_();
  snap.applied = applied;
  snap.rejected = rejected;
  return snap;
}

function applyOp_(op) {
  if (!op || !op.id) throw new Error('Bad operation.');
  if (op.type === 'addCategory') return addCategory_(op.name);
  if (op.type === 'addSub') return addSub_(op.category, op.name);
  var loc = findById_(op.id);
  if (op.type === 'delete') {
    if (loc) loc.sheet.deleteRow(loc.row);
    return;
  }
  if (op.type !== 'add' && op.type !== 'update') throw new Error('Unknown operation type.');
  var v = validate_(op.data || {});
  var targetKey = monthKey_(v.year, v.month0);
  if (loc && loc.key === targetKey) {            // update in place (also covers a retried add)
    writeRow_(loc.sheet, loc.row, v, op.id);
    sortSheet_(loc.sheet);
    return;
  }
  // New entry, or the date moved to another month: write the new row first, then remove the old one,
  // so a failure part-way can never lose the entry.
  var ws = getOrCreateMonthSheet_(v.year, v.month0);
  writeRow_(ws, lastDataRow_(ws) + 1, v, op.id);
  if (loc) loc.sheet.deleteRow(loc.row);
  sortSheet_(ws);
}

// ------------------------------------------------------------------ month sheets

function monthSheetName_(year, month0) {
  return MONTHS[month0] + '-' + String(year).slice(-2);
}

function parseSheetName_(name) {
  var parts = String(name).split('-');
  if (parts.length !== 2) return null;
  var m = parts[0].trim().toLowerCase();
  var y = parts[1].trim();
  if (!/^\d{2}$/.test(y)) return null;
  var idx = -1;
  for (var i = 0; i < 12; i++) if (MONTHS[i].toLowerCase() === m) idx = i;
  if (idx < 0 && (m === 'sep' || m === 'sept')) idx = 8;
  if (idx < 0) return null;
  return { year: 2000 + parseInt(y, 10), month0: idx };
}

function monthKey_(year, month0) {
  return year + '-' + ('0' + (month0 + 1)).slice(-2);
}

function listMonthSheets_() {
  var out = [];
  SpreadsheetApp.getActive().getSheets().forEach(function (sh) {
    var p = parseSheetName_(sh.getName());
    if (p) out.push({ sheet: sh, year: p.year, month0: p.month0, key: monthKey_(p.year, p.month0) });
  });
  out.sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  return out;
}

function findMonthSheet_(year, month0) {
  var key = monthKey_(year, month0);
  var all = listMonthSheets_();
  for (var i = 0; i < all.length; i++) if (all[i].key === key) return all[i].sheet;
  return null;
}

function getOrCreateMonthSheet_(year, month0) {
  var existing = findMonthSheet_(year, month0);
  if (existing) return existing;

  var ss = SpreadsheetApp.getActive();
  var key = monthKey_(year, month0);
  var name = monthSheetName_(year, month0);
  var all = listMonthSheets_();
  var prev = null, next = null;
  all.forEach(function (m) {
    if (m.key < key) prev = m;
    if (m.key > key && !next) next = m;
  });

  var ws;
  if (prev) {
    ws = prev.sheet.copyTo(ss);
    ws.setName(name);
    var rows = ws.getMaxRows();
    if (rows >= FIRST_ROW) ws.getRange(FIRST_ROW, 1, rows - FIRST_ROW + 1, ws.getMaxColumns()).clearContent();
  } else {
    ws = ss.insertSheet(name);
    ws.getRange(1, 1, 1, 3).setValues([BALANCE_LABELS]).setFontWeight('bold');
    ws.setFrozenRows(HEADER_ROW);
    ws.setColumnWidths(1, 6, 140);
  }
  prepareHeaders_(ws);

  ss.setActiveSheet(ws);
  if (next) ss.moveActiveSheet(next.sheet.getIndex());
  else ss.moveActiveSheet(ss.getNumSheets());

  if (prev) ws.getRange('A2').setFormula("='" + prev.sheet.getName().replace(/'/g, "''") + "'!C2");
  else ws.getRange('A2').setValue(0);
  writeBalanceFormulas_(ws);
  applyColorRules_(ws);

  if (next) next.sheet.getRange('A2').setFormula("='" + name + "'!C2");   // re-link the following month

  rebuildSummary_();
  return ws;
}

function prepareHeaders_(ws) {
  if (ws.getMaxColumns() < NCOLS) ws.insertColumnsAfter(ws.getMaxColumns(), NCOLS - ws.getMaxColumns());
  ws.getRange(HEADER_ROW, 1, 1, NCOLS).setValues([HEADERS]);
  ws.getRange(HEADER_ROW, 1, 1, 6).setFontWeight('bold');
  try { if (!ws.isColumnHiddenByUser(ID_COL)) ws.hideColumns(ID_COL); } catch (e) { /* ignore */ }
}

function writeBalanceFormulas_(ws) {
  ws.getRange('B2').setFormula('=SUMIFS(C' + FIRST_ROW + ':C,D' + FIRST_ROW + ':D,"Expense")');
  ws.getRange('C2').setFormula('=A2-B2+SUMIFS(C' + FIRST_ROW + ':C,D' + FIRST_ROW + ':D,"Income")');
  ws.getRange('A2:C2').setNumberFormat('#,##0.00');
}

function applyColorRules_(ws) {
  try {
    if (ws.getConditionalFormatRules().length) return;     // keep colours that came with the sheet
    var rng = ws.getRange(FIRST_ROW, 1, Math.max(ws.getMaxRows() - FIRST_ROW + 1, 1), 6);
    var income = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$D' + FIRST_ROW + '="Income"')
      .setBackground('#DCFCE7').setFontColor('#16A34A').setRanges([rng]).build();
    var expense = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$D' + FIRST_ROW + '="Expense"')
      .setBackground('#FEE2E2').setFontColor('#DC2626').setRanges([rng]).build();
    ws.setConditionalFormatRules([income, expense]);
  } catch (e) {
    console.log('Colour rules skipped for ' + ws.getName() + ': ' + e.message);
  }
}

function rebuildSummary_() {
  var sh = SpreadsheetApp.getActive().getSheetByName('Summary');
  if (!sh) return;
  var months = listMonthSheets_();
  var old = sh.getMaxRows() - 3;
  if (old > 0) sh.getRange(4, 1, old, 4).clearContent();
  if (!months.length) return;
  var rows = months.map(function (m) {
    var q = "'" + m.sheet.getName().replace(/'/g, "''") + "'!";
    return [new Date(m.year, m.month0, 1, 12), '=' + q + 'A2', '=' + q + 'B2', '=' + q + 'C2'];
  });
  sh.getRange(4, 2, rows.length, 3).setFormulas(rows.map(function (r) { return [r[1], r[2], r[3]]; }));
  sh.getRange(4, 1, rows.length, 1).setValues(rows.map(function (r) { return [r[0]]; })).setNumberFormat('mmm yyyy');
  sh.getRange(4, 2, rows.length, 3).setNumberFormat('#,##0.00');
}

/** Run once from the editor after pasting this file: normalises headers, IDs, formulas and the summary. */
function setupAfterImport() {
  var all = listMonthSheets_();
  all.forEach(function (m, i) {
    var ws = m.sheet;
    if (!ws.getRange('A1').getValue()) ws.getRange(1, 1, 1, 3).setValues([BALANCE_LABELS]);
    prepareHeaders_(ws);
    ensureIds_(ws);
    if (i > 0) ws.getRange('A2').setFormula("='" + all[i - 1].sheet.getName().replace(/'/g, "''") + "'!C2");
    writeBalanceFormulas_(ws);
    applyColorRules_(ws);
  });
  rebuildSummary_();
  SpreadsheetApp.flush();
  return 'Set up ' + all.length + ' month sheets.';
}

// ------------------------------------------------------------------ rows

var _catsCache = null;   // one Categories read per request

function readCategories_() {
  if (_catsCache) return _catsCache;
  var sh = SpreadsheetApp.getActive().getSheetByName('Categories');
  var lastCol = sh.getLastColumn();
  var lastRow = sh.getLastRow();
  var vals = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var cats = {}, order = [];
  for (var c = 1; c < lastCol; c++) {
    var name = String(vals[0][c]).trim();
    if (!name || name.toLowerCase() === 'categories' || name === 'Income') continue;
    var subs = [];
    for (var r = 1; r < lastRow; r++) {
      var v = String(vals[r][c]).trim();
      if (v) subs.push(v);
    }
    cats[name] = subs;
    order.push(name);
  }
  _catsCache = { map: cats, order: order };
  return _catsCache;
}

// ---- adding categories / sub-categories (written into the Categories sheet, same layout as the Excel file)

function cleanName_(n) {
  n = String(n || '').replace(/\s+/g, ' ').trim();
  if (!n) throw new Error('Name cannot be empty.');
  if (n.length > 30) throw new Error('Name is too long (30 characters max).');
  return n;
}

function copyFormat_(from, to) {
  try { from.copyTo(to, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) { /* cosmetic only */ }
}

function lastFilledRow_(sh, col) {
  var n = sh.getLastRow();
  if (n < 1) return 0;
  var vals = sh.getRange(1, col, n, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim() !== '') return i + 1;
  return 0;
}

function addCategory_(name) {
  name = cleanName_(name);
  var low = name.toLowerCase();
  if (low === 'income' || low === 'categories') throw new Error('"' + name + '" is reserved.');
  var cats = readCategories_();
  for (var i = 0; i < cats.order.length; i++) if (cats.order[i].toLowerCase() === low) return;   // already there (retry-safe)
  var sh = SpreadsheetApp.getActive().getSheetByName('Categories');
  var lastCol = sh.getLastColumn();
  var col = lastCol + 1;                                   // new column after the last one (Income stays in place)
  sh.getRange(1, col).setValue(name);
  copyFormat_(sh.getRange(1, lastCol), sh.getRange(1, col));
  var listRow = lastFilledRow_(sh, 1) + 1;                 // also list it in column A, like the Excel CategoryList
  sh.getRange(listRow, 1).setValue(name);
  if (listRow > 2) copyFormat_(sh.getRange(listRow - 1, 1), sh.getRange(listRow, 1));
  _catsCache = null;
}

function addSub_(category, name) {
  name = cleanName_(name);
  var cats = readCategories_();
  if (!cats.map[category]) throw new Error('Unknown category "' + category + '".');
  var low = name.toLowerCase();
  var subs = cats.map[category];
  for (var i = 0; i < subs.length; i++) if (subs[i].toLowerCase() === low) return;   // already there (retry-safe)
  var sh = SpreadsheetApp.getActive().getSheetByName('Categories');
  var lastCol = sh.getLastColumn();
  var head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = -1;
  for (var c = 1; c < head.length; c++) if (String(head[c]).trim() === category) { col = c + 1; break; }
  if (col < 0) throw new Error('Unknown category "' + category + '".');
  var row = lastFilledRow_(sh, col) + 1;
  sh.getRange(row, col).setValue(name);
  if (row > 2) copyFormat_(sh.getRange(row - 1, col), sh.getRange(row, col));
  _catsCache = null;
}

function fmtDate_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, SpreadsheetApp.getActive().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  return String(v);
}

function dataValues_(ws) {
  var n = ws.getLastRow() - FIRST_ROW + 1;
  if (n < 1) return [];
  if (ws.getMaxColumns() < NCOLS) prepareHeaders_(ws);
  return ws.getRange(FIRST_ROW, 1, n, NCOLS).getValues();
}

function isDataRow_(v) { return v[0] !== '' || v[2] !== ''; }

/** Gives every existing row a stable ID (rows that predate this app, or were typed by hand). */
function ensureIds_(ws) {
  var vals = dataValues_(ws);
  var changed = false;
  var ids = vals.map(function (v) {
    if (isDataRow_(v) && !v[ID_COL - 1]) { changed = true; return [Utilities.getUuid()]; }
    return [v[ID_COL - 1]];
  });
  if (changed) ws.getRange(FIRST_ROW, ID_COL, ids.length, 1).setValues(ids);
  try { if (!ws.isColumnHiddenByUser(ID_COL)) ws.hideColumns(ID_COL); } catch (e) { /* ignore */ }
}

function readEntries_(ws) {
  var vals = dataValues_(ws);
  var out = [];
  vals.forEach(function (v) {
    if (!isDataRow_(v)) return;
    out.push({ id: String(v[6]), date: fmtDate_(v[0]), description: String(v[1]), amount: Number(v[2]) || 0,
               type: String(v[3]), category: String(v[4]), sub: String(v[5]) });
  });
  return out;
}

function lastDataRow_(ws) {
  var vals = dataValues_(ws);
  for (var i = vals.length - 1; i >= 0; i--) if (isDataRow_(vals[i])) return FIRST_ROW + i;
  return FIRST_ROW - 1;
}

function findById_(id) {
  var all = listMonthSheets_();
  for (var s = 0; s < all.length; s++) {
    var vals = dataValues_(all[s].sheet);
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][ID_COL - 1]) === String(id)) return { sheet: all[s].sheet, key: all[s].key, row: FIRST_ROW + i };
    }
  }
  return null;
}

function sortSheet_(ws) {
  var last = lastDataRow_(ws);
  if (last > FIRST_ROW) ws.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, NCOLS).sort({ column: 1, ascending: true });
}

function writeRow_(ws, row, v, id) {
  ws.getRange(row, 1, 1, NCOLS).setValues([[v.date, v.description, v.amount, v.type, v.category, v.sub, id]]);
  ws.getRange(row, 1).setNumberFormat('dd-mmm-yy');
}

function validate_(t) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(t.date || ''));
  if (!m) throw new Error('Invalid date.');
  var y = +m[1], mo = +m[2], d = +m[3];
  var dt = new Date(y, mo - 1, d, 12);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) throw new Error('That date does not exist.');
  var amount = Number(t.amount);
  if (!isFinite(amount) || amount <= 0) throw new Error('Amount must be greater than zero.');
  amount = Math.round(amount * 100) / 100;
  if (t.type !== 'Expense' && t.type !== 'Income') throw new Error('Invalid type.');
  var category = 'Income', sub = 'Income';
  if (t.type === 'Expense') {
    var cats = readCategories_().map;
    category = String(t.category || '');
    sub = String(t.sub || '');
    if (!cats[category]) throw new Error('Unknown category "' + category + '".');
    // older rows sometimes repeat the category as the sub-category; keep accepting those
    if (cats[category].indexOf(sub) < 0 && sub !== category) throw new Error('Unknown sub-category "' + sub + '".');
  }
  return { year: y, month0: mo - 1, date: dt, description: String(t.description || '').trim().slice(0, 200),
           amount: amount, type: t.type, category: category, sub: sub };
}
