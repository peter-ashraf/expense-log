// Runs apps-script/Api.gs against a minimal in-memory fake of the Sheets API.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Api.gs'), 'utf8')
  .replace("var API_KEY = 'PASTE-YOUR-SECRET-KEY-HERE';", "var API_KEY = 'test-key';");

class Range {
  constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  _each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() { const o = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); o.push(row); } return o; }
  getValue() { return this.sh.get(this.r, this.c); }
  setValues(v) { this._each((r, c, i, j) => this.sh.set(r, c, v[i][j])); return this; }
  setValue(v) { this._each((r, c) => this.sh.set(r, c, v)); return this; }
  setFormula(f) { this.sh.set(this.r, this.c, f); return this; }
  setFormulas(v) { this._each((r, c, i, j) => { this.sh.set(r, c, v[i][j]); }); return this; }
  clearContent() { this._each((r, c) => this.sh.set(r, c, '')); return this; }
  sort({ column }) {
    const rows = this.getValues();
    const val = (x) => (x[column - 1] instanceof Date ? x[column - 1].getTime() : x[column - 1]);
    rows.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0));
    this.setValues(rows); return this;
  }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
}
class Sheet {
  constructor(ss, name) { this.ss = ss; this.name = name; this.cells = new Map(); this.maxRows = 100; this.maxCols = 26; this.hidden = new Set(); this.rules = []; }
  get(r, c) { const v = this.cells.get(r + ':' + c); return v === undefined ? '' : v; }
  set(r, c, v) { if (v === '' || v === null || v === undefined) this.cells.delete(r + ':' + c); else this.cells.set(r + ':' + c, v); }
  getName() { return this.name; }
  setName(n) { this.name = n; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z])(\d+)(?::([A-Z])(\d+))?$/.exec(a);
      const c1 = m[1].charCodeAt(0) - 64, r1 = +m[2];
      const c2 = m[3] ? m[3].charCodeAt(0) - 64 : c1, r2 = m[4] ? +m[4] : r1;
      return new Range(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(':')[0]); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(':')[1]); return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(a, n) { this.maxCols += n; }
  deleteRow(row) {
    const nc = new Map();
    for (const [k, v] of this.cells) { const [r, c] = k.split(':').map(Number); if (r < row) nc.set(k, v); else if (r > row) nc.set((r - 1) + ':' + c, v); }
    this.cells = nc;
  }
  copyTo(ss) { const s = new Sheet(ss, 'Copy of ' + this.name); s.cells = new Map(this.cells); s.rules = this.rules.slice(); s.hidden = new Set(this.hidden); ss.sheets.push(s); return s; }
  getConditionalFormatRules() { return this.rules; }
  setConditionalFormatRules(r) { this.rules = r; }
  isColumnHiddenByUser(c) { return this.hidden.has(c); }
  hideColumns(c) { this.hidden.add(c); }
  setFrozenRows() {}
  setColumnWidths() {}
  getIndex() { return this.ss.sheets.indexOf(this) + 1; }
}
const ss = {
  sheets: [], active: null,
  getSheets() { return this.sheets; },
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; },
  insertSheet(n) { const s = new Sheet(this, n); this.sheets.push(s); return s; },
  setActiveSheet(s) { this.active = s; },
  moveActiveSheet(pos) { const i = this.sheets.indexOf(this.active); this.sheets.splice(i, 1); this.sheets.splice(pos - 1, 0, this.active); },
  getNumSheets() { return this.sheets.length; },
  getSpreadsheetTimeZone() { return 'UTC'; },
};
const rule = { whenFormulaSatisfied() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setRanges() { return this; }, build() { return {}; } };
let uuidN = 0;
const g = {
  SpreadsheetApp: { getActive: () => ss, newConditionalFormatRule: () => Object.assign({}, rule), flush() {} },
  Utilities: { getUuid: () => 'uuid-' + (++uuidN), formatDate: (d) => d.toISOString().slice(0, 10) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } },
  console,
};
const api = new Function(...Object.keys(g), src + ';return {doPost, doGet, setupAfterImport}')(...Object.values(g));

// ---- build a workbook shaped like the real one
const cat = ss.insertSheet('Categories');
['Categories', 'Bills', 'Food', 'Income'].forEach((v, i) => cat.set(1, i + 1, v));
['Mobile', 'Internet'].forEach((v, i) => cat.set(i + 2, 2, v));
['Groceries', 'Coffee'].forEach((v, i) => cat.set(i + 2, 3, v));
cat.set(2, 4, 'Income');
const summary = ss.insertSheet('Summary');
const mk = (name, start, rows) => {
  const s = ss.insertSheet(name);
  ['Starting Balance', 'Total Spent', 'Available Balance'].forEach((v, i) => s.set(1, i + 1, v));
  s.set(2, 1, start);
  ['Date', 'Description', 'Amount', 'Type', 'Category', 'Sub-Category'].forEach((v, i) => s.set(4, i + 1, v));
  rows.forEach((r, i) => r.forEach((v, j) => s.set(5 + i, j + 1, v)));
  return s;
};
mk('Aug-26', 150000, [
  [new Date('2026-08-16T12:00:00Z'), 'Gift', 1250, 'Expense', 'Food', 'Groceries'],
  [new Date('2026-08-02T12:00:00Z'), 'Pay', 5000, 'Income', 'Income', 'Income']]);
mk('Sept-26', 0, [[new Date('2026-09-10T12:00:00Z'), 'Phone', 300, 'Expense', 'Bills', 'Mobile']]);

const call = (action, extra = {}, key = 'test-key') =>
  JSON.parse(api.doPost({ postData: { contents: JSON.stringify({ key, action, ...extra }) } }).s);
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };

ok(call('pull', {}, 'bad').error === 'Unauthorized', 'wrong key rejected');
ok(call('nope').ok === false, 'unknown action rejected');

let snap = call('pull');
ok(snap.ok && snap.entries.length === 3, 'pull returns 3 existing entries');
ok(snap.entries.every((e) => e.id), 'every existing row got an ID');
ok(snap.firstStart === 150000 && snap.months.join() === '2026-08,2026-09', 'firstStart and months');
ok(snap.categories.order.join() === 'Bills,Food', 'categories exclude Income, keep order');
ok(ss.getSheetByName('Aug-26').hidden.has(7), 'ID column hidden');
const ids1 = snap.entries.map((e) => e.id).join();
ok(call('pull').entries.map((e) => e.id).join() === ids1, 'IDs are stable across pulls');

const add = { opId: 'o1', type: 'add', id: 'new-1', data: { date: '2026-09-20', description: 'Latte', amount: 4.5, type: 'Expense', category: 'Food', sub: 'Coffee' } };
let r = call('push', { ops: [add] });
ok(r.applied.join() === 'o1' && r.entries.filter((e) => e.id === 'new-1').length === 1, 'add applied');
r = call('push', { ops: [{ ...add, opId: 'o1b' }] });
ok(r.entries.filter((e) => e.id === 'new-1').length === 1, 'retried add does not duplicate');

r = call('push', { ops: [{ opId: 'o2', type: 'update', id: 'new-1', data: { ...add.data, amount: 9.25, description: 'Latte+' } }] });
const upd = r.entries.find((e) => e.id === 'new-1');
ok(upd.amount === 9.25 && upd.description === 'Latte+', 'update applied');

r = call('push', { ops: [{ opId: 'o3', type: 'update', id: 'new-1', data: { ...add.data, date: '2026-10-03' } }] });
ok(r.months.join() === '2026-08,2026-09,2026-10', 'October sheet created');
ok(r.entries.find((e) => e.id === 'new-1').date === '2026-10-03', 'entry moved to October');
const oct = ss.getSheetByName('Oct-26');
ok(oct && oct.get(2, 1) === "='Sept-26'!C2", 'Oct starting balance links to Sept');
ok(ss.sheets.map((s) => s.name).slice(-3).join() === 'Aug-26,Sept-26,Oct-26', 'tabs in chronological order');
ok(summary.get(6, 1) instanceof Date, 'summary row for October written');

r = call('push', { ops: [{ opId: 'o4', type: 'add', id: 'old-1', data: { date: '2026-07-04', description: 'Early', amount: 10, type: 'Expense', category: 'Bills', sub: 'Mobile' } }] });
ok(r.months[0] === '2026-07', 'July created');
ok(ss.sheets.map((s) => s.name).filter((n) => /-26$/.test(n)).join() === 'Jul-26,Aug-26,Sept-26,Oct-26', 'July placed before August');
ok(ss.getSheetByName('Aug-26').get(2, 1) === "='Jul-26'!C2", 'August now links to July');
ok(ss.getSheetByName('Jul-26').get(2, 1) === 0, 'first sheet starts at 0');

r = call('push', { ops: [{ opId: 'o5', type: 'delete', id: 'new-1' }, { opId: 'o6', type: 'delete', id: 'ghost' }] });
ok(r.applied.length === 2 && !r.entries.some((e) => e.id === 'new-1'), 'delete applied, missing id tolerated');

r = call('push', { ops: [
  { opId: 'b1', type: 'add', id: 'x1', data: { date: '2026-09-21', description: '', amount: -5, type: 'Expense', category: 'Food', sub: 'Coffee' } },
  { opId: 'b2', type: 'add', id: 'x2', data: { date: '2026-09-21', description: 'ok', amount: 5, type: 'Expense', category: 'Nope', sub: 'x' } },
  { opId: 'b3', type: 'add', id: 'x3', data: { date: '2026-02-31', description: 'ok', amount: 5, type: 'Income' } },
  { opId: 'g1', type: 'add', id: 'x4', data: { date: '2026-09-21', description: 'fine', amount: 1, type: 'Income' } }] });
ok(r.rejected.length === 3 && r.applied.join() === 'g1', 'bad ops rejected individually, good op applied');
ok(r.entries.find((e) => e.id === 'x4').category === 'Income', 'income forced to Income/Income');

const sept = ss.getSheetByName('Sept-26');
const dates = [];
for (let i = 5; i <= sept.getLastRow(); i++) dates.push(sept.get(i, 1).getTime());
ok(dates.every((d, i) => i === 0 || dates[i - 1] <= d), 'sheet rows sorted by date');
const byId = call('pull').entries.find((e) => e.id === 'x4');
ok(byId && byId.description === 'fine', 'ID travels with its row after sorting');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
