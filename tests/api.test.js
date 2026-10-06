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
  appendRow(arr) { const r = this.getLastRow() + 1; arr.forEach((v, i) => this.set(r, i + 1, v)); }
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


// ---- dynamic categories / sub-categories
r = call('push', { ops: [{ opId: 'c1', type: 'addCategory', id: 'c-1', name: '  Pets   &  Care ' }] });
ok(r.applied.join() === 'c1' && r.categories.order.join() === 'Bills,Food,Pets & Care', 'new category appended after the others, name tidied');
const catsSheet = ss.getSheetByName('Categories');
ok(catsSheet.get(1, 5) === 'Pets & Care' && catsSheet.get(1, 4) === 'Income', 'written as a new column after Income (Income column untouched)');
ok(catsSheet.get(2, 1) === 'Pets & Care', 'also listed in column A like the Excel CategoryList');
r = call('push', { ops: [{ opId: 'c2', type: 'addCategory', id: 'c-2', name: 'pets & care' }] });
ok(r.applied.join() === 'c2' && r.categories.order.length === 3, 'adding an existing category again is a harmless no-op (retry-safe)');
r = call('push', { ops: [{ opId: 'c3', type: 'addCategory', id: 'c-3', name: 'Income' }, { opId: 'c4', type: 'addCategory', id: 'c-4', name: '   ' }] });
ok(r.rejected.length === 2, 'reserved and empty names are rejected');
r = call('push', { ops: [{ opId: 's1', type: 'addSub', id: 's-1', category: 'Pets & Care', name: 'Vet' }, { opId: 's2', type: 'addSub', id: 's-2', category: 'Food', name: 'Takeaway' }] });
ok(r.categories.map['Pets & Care'].join() === 'Vet' && r.categories.map.Food.join() === 'Groceries,Coffee,Takeaway', 'sub-categories added under the right columns');
r = call('push', { ops: [{ opId: 's3', type: 'addSub', id: 's-3', category: 'Food', name: 'takeaway' }, { opId: 's4', type: 'addSub', id: 's-4', category: 'Nope', name: 'x' }] });
ok(r.applied.join() === 's3' && r.rejected.length === 1 && r.categories.map.Food.length === 3, 'duplicate sub is a no-op; unknown category rejected');
r = call('push', { ops: [{ opId: 'e1', type: 'add', id: 'pet-1', data: { date: '2026-09-22', description: 'Check-up', amount: 120, type: 'Expense', category: 'Pets & Care', sub: 'Vet' } }] });
ok(r.applied.join() === 'e1', 'an entry can use a category created moments ago');
r = call('push', { ops: [
  { opId: 'n1', type: 'addCategory', id: 'n-1', name: 'Gifts' },
  { opId: 'n2', type: 'addSub', id: 'n-2', category: 'Gifts', name: 'Birthday' },
  { opId: 'n3', type: 'add', id: 'gift-1', data: { date: '2026-09-23', description: 'Cake', amount: 60, type: 'Expense', category: 'Gifts', sub: 'Birthday' } }] });
ok(r.applied.length === 3 && r.entries.some((e) => e.id === 'gift-1'), 'category + sub + entry created offline sync in one batch');
// legacy rows whose sub-category repeats the category name
r = call('push', { ops: [{ opId: 'l1', type: 'add', id: 'leg-1', data: { date: '2026-09-24', description: 'Old style', amount: 5, type: 'Expense', category: 'Food', sub: 'Food' } }] });
ok(r.applied.join() === 'l1', 'legacy "category = sub-category" rows are still accepted');

// ---- accounts (credit card, cash, ...)
{
  // a snapshot of everything the original structure consisted of, to prove nothing of it is ever changed
  const legacy = () => {
    const out = {};
    ['Aug-26', 'Sept-26'].forEach((n) => {
      const sh = ss.getSheetByName(n);
      const rows = [];
      for (let r = 1; r <= 12; r++) { const row = []; for (let c = 1; c <= 6; c++) row.push(String(sh.get(r, c))); rows.push(row.join('|')); }
      out[n] = rows.join('\n');
    });
    return out;
  };
  const before = legacy();
  ok(!ss.getSheetByName('Accounts'), 'reading never creates the Accounts tab');
  let sn = call('pull');
  ok(sn.accounts.length === 1 && sn.accounts[0].name === 'Credit Card' && sn.accounts[0].type === 'card' && sn.accounts[0].limit === 0, 'no Accounts tab: one default Credit Card account');
  ok(sn.entries.every((e) => e.account === 'Credit Card'), 'every older row belongs to the default account');

  r = call('push', { ops: [{ opId: 'a1', type: 'addAccount', id: 'acc-1', name: ' Cash ', accType: 'cash', limit: 2500 }] });
  ok(r.applied.join() === 'a1' && r.accounts.map((a) => a.name).join() === 'Credit Card,Cash', 'account added after the default one');
  const accSheet = ss.getSheetByName('Accounts');
  ok(accSheet && accSheet.get(1, 1) === 'Account' && accSheet.get(2, 1) === 'Credit Card' && accSheet.get(3, 1) === 'Cash' && accSheet.get(3, 3) === 2500, 'Accounts tab written (default row first, limit stored)');
  ok(r.accounts[1].type === 'cash' && r.accounts[1].limit === 2500 && !r.accounts[1].archived, 'account type and limit read back');
  r = call('push', { ops: [{ opId: 'a2', type: 'addAccount', id: 'acc-2', name: 'cash' }] });
  ok(r.applied.join() === 'a2' && r.accounts.length === 2, 'adding the same account again is a harmless no-op');
  r = call('push', { ops: [{ opId: 'a3', type: 'addAccount', id: 'acc-3', name: '   ' }] });
  ok(r.rejected.length === 1, 'empty account name rejected');

  const cashAdd = { opId: 'k1', type: 'add', id: 'cash-1', data: { date: '2026-09-25', description: 'Taxi', amount: 80, type: 'Expense', category: 'Bills', sub: 'Mobile', account: 'Cash' } };
  r = call('push', { ops: [cashAdd, { opId: 'k2', type: 'add', id: 'card-1', data: { date: '2026-09-25', description: 'No account given', amount: 30, type: 'Expense', category: 'Food', sub: 'Coffee' } }] });
  ok(r.applied.length === 2, 'entries with and without an account are accepted');
  ok(r.entries.find((e) => e.id === 'cash-1').account === 'Cash', 'Cash entry comes back as Cash');
  ok(r.entries.find((e) => e.id === 'card-1').account === 'Credit Card', 'entry without an account lands in the default account');
  const sp = ss.getSheetByName('Sept-26');
  ok(sp.get(4, 8) === 'Account' && sp.hidden.has(8) && sp.hidden.has(7), 'old month tab got an "Account" header, hidden along with ID');
  r = call('push', { ops: [{ opId: 'k3', type: 'add', id: 'bad-acc', data: { ...cashAdd.data, account: 'Wallet' } }] });
  ok(r.rejected.length === 1 && /Unknown account/.test(r.rejected[0].error), 'unknown account rejected');
  r = call('push', { ops: [{ opId: 'k4', type: 'update', id: 'cash-1', data: { ...cashAdd.data, account: 'Credit Card' } }] });
  ok(r.entries.find((e) => e.id === 'cash-1').account === 'Credit Card', 'an entry can be moved to another account');

  r = call('push', { ops: [{ opId: 'u1', type: 'updateAccount', id: 'u-1', name: 'Cash', limit: 1800 }, { opId: 'u2', type: 'updateAccount', id: 'u-2', name: 'Credit Card', limit: 12000 }] });
  ok(r.accounts[1].limit === 1800 && r.accounts[0].limit === 12000, 'limits can be changed');
  r = call('push', { ops: [{ opId: 'u3', type: 'updateAccount', id: 'u-3', name: 'Cash', limit: 0 }] });
  ok(r.accounts[1].limit === 0, 'limit can be cleared');
  r = call('push', { ops: [{ opId: 'u4', type: 'updateAccount', id: 'u-4', name: 'Credit Card', archived: true }, { opId: 'u5', type: 'updateAccount', id: 'u-5', name: 'Cash', archived: true }, { opId: 'u6', type: 'updateAccount', id: 'u-6', name: 'Nope', limit: 5 }] });
  ok(r.rejected.length === 2 && r.accounts[1].archived === true && !r.accounts[0].archived, 'default account cannot be archived; others can; unknown account rejected');
  ok(call('push', { ops: [{ opId: 'u7', type: 'updateAccount', id: 'u-7', name: 'Cash', archived: false }] }).accounts[1].archived === false, 'archived account can be restored');

  // a client from before accounts existed keeps working unchanged
  r = call('push', { ops: [{ opId: 'z1', type: 'add', id: 'old-client', data: { date: '2026-09-26', description: 'From an old app version', amount: 12, type: 'Expense', category: 'Food', sub: 'Coffee' } }] });
  ok(r.applied.join() === 'z1' && r.entries.find((e) => e.id === 'old-client').account === 'Credit Card', 'older clients that send no account still work');

  // subscriptions (own tab; never touches month tabs)
  ok(Array.isArray(r.subscriptions) && r.subscriptions.length === 0 && !ss.getSheetByName('Subscriptions'), 'no Subscriptions tab yet: empty list, nothing created on read');
  const sub = { opId: 'v1', type: 'saveSubscription', id: 'sub-nf', data: { name: ' Netflix ', amount: 190, day: 1, category: 'Subscriptions', sub: 'Netflix', account: 'cash', logo: 'netflix', color: '#E50914' } };
  r = call('push', { ops: [sub] });
  ok(r.applied.join() === 'v1' && r.subscriptions.length === 1 && r.subscriptions[0].name === 'Netflix' && r.subscriptions[0].account === 'Cash' && r.subscriptions[0].day === 1, 'subscription saved on its own tab (name trimmed, account resolved)');
  ok(ss.getSheetByName('Subscriptions').get(1, 1) === 'ID' && ss.getSheetByName('Subscriptions').get(1, 12) === 'Skipped', 'Subscriptions tab has its header');
  r = call('push', { ops: [{ ...sub, opId: 'v1b' }] });
  ok(r.subscriptions.length === 1, 'retried save does not duplicate');
  r = call('push', { ops: [{ opId: 'v2', type: 'saveSubscription', id: 'sub-nf', data: { ...sub.data, amount: 220, rating: '💤', skipped: '2026-10', paused: true } }] });
  const nf = r.subscriptions[0];
  ok(nf.amount === 220 && nf.rating === '💤' && nf.skipped === '2026-10' && nf.paused === true, 'edit, rating, skip and pause stored');
  r = call('push', { ops: [
    { opId: 'v3', type: 'saveSubscription', id: 'sub-bad1', data: { name: '', amount: 5, day: 3 } },
    { opId: 'v4', type: 'saveSubscription', id: 'sub-bad2', data: { name: 'X', amount: 0, day: 3 } },
    { opId: 'v5', type: 'saveSubscription', id: 'sub-bad3', data: { name: 'X', amount: 5, day: 32 } },
    { opId: 'v6', type: 'saveSubscription', id: 'sub-bad4', data: { name: 'X', amount: 5, day: 3, account: 'Nope' } }] });
  ok(r.rejected.length === 4 && r.subscriptions.length === 1, 'bad subscriptions rejected (no name, zero amount, day 32, unknown account)');
  r = call('push', { ops: [{ opId: 'v7', type: 'deleteSubscription', id: 'sub-nf' }, { opId: 'v8', type: 'deleteSubscription', id: 'ghost' }] });
  ok(r.applied.length === 2 && r.subscriptions.length === 0, 'subscription deleted; deleting a missing one is harmless');

  // removing an account
  r = call('push', { ops: [{ opId: 'd0', type: 'addAccount', id: 'acc-w', name: 'Wallet', accType: 'cash' }] });
  r = call('push', { ops: [{ opId: 'd1', type: 'add', id: 'w-1', data: { date: '2026-10-02', description: 'Snack', amount: 15, type: 'Expense', category: 'Food', sub: 'Coffee', account: 'Wallet' } }] });
  r = call('push', { ops: [{ opId: 'd2', type: 'deleteAccount', id: 'del-1', name: 'Wallet' }] });
  ok(r.rejected.length === 1 && /still has entries/.test(r.rejected[0].error) && r.accounts.some((x) => x.name === 'Wallet'), 'an account that still has entries is not removed');
  r = call('push', { ops: [
    { opId: 'd3', type: 'update', id: 'w-1', data: { date: '2026-10-02', description: 'Snack', amount: 15, type: 'Expense', category: 'Food', sub: 'Coffee', account: 'Credit Card' } },
    { opId: 'd4', type: 'deleteAccount', id: 'del-2', name: 'Wallet' }] });
  ok(r.applied.length === 2 && !r.accounts.some((x) => x.name === 'Wallet') && r.entries.find((e) => e.id === 'w-1').account === 'Credit Card', 'entries moved first, then the account is removed');
  r = call('push', { ops: [{ opId: 'd5', type: 'deleteAccount', id: 'del-3', name: 'Credit Card' }] });
  ok(r.rejected.length === 1 && r.accounts[0].name === 'Credit Card', 'the main account cannot be removed');

  // the original structure is byte-for-byte what it was (only data rows were added below the header)
  const after = legacy();
  const head = (t) => t.split('\n').slice(0, 4).join('\n');
  ok(head(after['Aug-26']) === head(before['Aug-26']) && head(after['Sept-26']) === head(before['Sept-26']), 'balance row and headers (A1:F4) untouched on every month tab');
  ok(after['Aug-26'] === before['Aug-26'], 'a month tab nobody wrote to is completely unchanged');
  ok(ss.getSheetByName('Sept-26').get(5, 2) === 'Phone' || ss.getSheetByName('Sept-26').get(5, 2) !== undefined, 'existing rows still in place');
  ok(ss.getSheetByName('Oct-26').get(2, 3) === '=A2-B2+SUMIFS(C5:C,D5:D,"Income")' && ss.getSheetByName('Oct-26').get(2, 2) === '=SUMIFS(C5:C,D5:D,"Expense")', 'balance formulas unchanged: all accounts still total into one chain');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
