// node tests/csv.test.mjs
import { parseCsv, readCsvEntries, parseAmount, decodeText } from '../js/csv.js';
import { csvEscape } from '../js/util.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const categories = {
  order: ['Bills', 'Food', 'Miscellaneous', 'Shopping'],
  map: { Bills: ['Mobile', 'Internet'], Food: ['Groceries', 'Coffee'], Miscellaneous: ['Other'], Shopping: ['Clothes', 'Household'] },
};
const strip = (e) => [e.date, e.description, e.amount, e.type, e.category, e.sub].join('|');

// ---- amounts
ok(parseAmount('1,234.56') === 1234.56 && parseAmount('1.234,56') === 1234.56 && parseAmount('12,5') === 12.5, 'amounts: thousands/decimal separators in both styles');
ok(parseAmount('(12.50)') === -12.5 && parseAmount('-7') === -7 && parseAmount('EGP 1,200') === 1200 && Number.isNaN(parseAmount('abc')), 'amounts: negatives, currency text, junk');

// ---- parser basics
ok(eq(parseCsv('a,b\n"x, y","he said ""hi"""\r\n3,4'), [['a', 'b'], ['x, y', 'he said "hi"'], ['3', '4']]), 'quotes, escaped quotes, commas and CRLF');
ok(eq(parseCsv('a;b;c\n1;2;3'), [['a', 'b', 'c'], ['1', '2', '3']]), 'semicolon delimiter detected');
ok(parseCsv('x,"line1\nline2",y')[0][1] === 'line1\nline2', 'quoted field with a line break');

// ---- the app's own export round-trips
const rows = [['Date', 'Description', 'Amount', 'Type', 'Category', 'Sub-Category'],
  ['2026-08-02', 'Pay, "bonus"', 5000, 'Income', 'Income', 'Income'],
  ['2026-08-16', 'Gift', 1250.5, 'Expense', 'Shopping', 'Household'],
  ['2026-09-10', 'Phone', 300, 'Expense', 'Bills', 'Mobile']];
const exported = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
let r = readCsvEntries(exported, categories);
ok(eq(r.entries.map(strip), rows.slice(1).map((x) => x.join('|'))) && r.skipped.length === 0, "round trip of the app's own CSV export");

// ---- BOM + semicolons + dd/mm/yyyy + case-insensitive categories
const bomBytes = new TextEncoder().encode('﻿Date;Description;Amount;Type;Category;Sub-Category\r\n13/08/2026;Coffee;45,50;expense;food;COFFEE\r\n02/09/2026;Salary;12.000,00;Income;;\r\n');
r = readCsvEntries(decodeText(bomBytes), categories);
ok(strip(r.entries[0]) === '2026-08-13|Coffee|45.5|Expense|Food|Coffee', 'BOM stripped, semicolon + comma decimals, categories matched ignoring case');
ok(strip(r.entries[1]) === '2026-09-02|Salary|12000|Income|Income|Income', 'income row with thousands dots');
ok(r.dateOrder === 'dmy' && !r.notes.some((n) => /read as day\/month/.test(n)), 'day/month order detected from a day above 12 (no warning)');

// ---- US style detected from a second value above 12
r = readCsvEntries('Date,Amount,Description\n03/14/2026,10,A\n03/02/2026,20,B', categories);
ok(r.dateOrder === 'mdy' && r.entries[0].date === '2026-03-14' && r.entries[1].date === '2026-03-02', 'month/day/year detected when the second part exceeds 12');

// ---- ambiguous dates get a visible note
r = readCsvEntries('Date,Amount\n03/04/2026,10', categories);
ok(r.entries[0].date === '2026-04-03' && r.notes.some((n) => /day\/month\/year/.test(n)), 'ambiguous dates read as day/month and flagged');

// ---- bank export: Debit / Credit columns, no category
r = readCsvEntries('Posting Date,Merchant,Debit,Credit\n2026-09-05,Cafe,12.40,\n2026-09-06,Refund,,30', categories);
ok(r.entries.length === 2 && r.entries[0].type === 'Expense' && r.entries[1].type === 'Income' && r.entries[0].category === 'Miscellaneous', 'debit/credit columns; uncategorised expense goes to Miscellaneous > Other');
ok(r.notes.some((n) => /Miscellaneous/.test(n)), 'uncategorised note shown');

// ---- amount sign when there is no Type column
r = readCsvEntries('Date,Description,Amount\n2026-09-01,Shop,-25\n2026-09-02,Refund,(10.00)\n2026-09-03,Cafe,8', categories);
ok(eq(r.entries.map((e) => e.type), ['Income', 'Income', 'Expense']) || eq(r.entries.map((e) => e.type), ['Income', 'Income', 'Expense']), 'no Type column: negative = income/refund, positive = expense');
ok(r.notes.some((n) => /No Type column/.test(n)), 'sign rule is announced in the notes');

// ---- unknown categories are skipped but marked fixable
r = readCsvEntries('Date,Description,Amount,Type,Category,Sub-Category\n2026-09-01,Dog food,40,Expense,Pets,Food\n2026-09-02,Lunch,15,Expense,Food,Fancy\n2026-09-03,Ok,5,Expense,Food,Coffee', categories);
ok(r.entries.length === 1 && r.skipped.length === 2 && r.skipped.every((s) => s.fix), 'unknown category / sub-category rows are skipped with a fix payload');
ok(r.skipped[0].fix.category === 'Pets' && r.skipped[1].fix.category === 'Food' && r.skipped[1].fix.sub === 'Fancy', 'fix payload keeps what the file said');

// ---- bad rows
r = readCsvEntries('Date,Description,Amount,Type\nnot a date,x,5,Expense\n2026-09-01,x,0,Expense\n2026-09-01,x,5,Gift', categories);
ok(r.entries.length === 0 && r.skipped.length === 3, 'bad date, zero amount and unknown type are skipped');

// ---- no header: positional columns; and a useful error otherwise
r = readCsvEntries('2026-09-01,Lunch,15,Expense,Food,Coffee', categories);
ok(r.entries.length === 1 && r.entries[0].sub === 'Coffee', 'headerless file uses the app column order');
let threw = false;
try { readCsvEntries('foo,bar\n1,2', categories); } catch (e) { threw = /Date and Amount/.test(e.message); }
ok(threw, 'unrecognisable file gives a clear error');

// ---- Windows-1252 text still decodes
const win = new Uint8Array([...new TextEncoder().encode('Date,Amount,Description\n2026-09-01,10,Caf'), 0xe9]);
r = readCsvEntries(decodeText(win), categories);
ok(r.entries[0].description === 'Café', 'Windows-1252 file decoded correctly');

// ---- optional Account column
{
  const r2 = readCsvEntries('Date,Description,Amount,Type,Category,Sub-Category,Account\n2026-09-01,Taxi,50,Expense,Shopping,Clothes,Cash\n2026-09-02,Lunch,20,Expense,Food,Coffee,\n', categories);
  ok(r2.entries.length === 2 && r2.entries[0].account === 'Cash' && r2.entries[1].account === undefined, 'CSV: Account column is read; blank means default');
  const r3 = readCsvEntries('Date,Description,Amount,Type,Category,Sub-Category\n2026-09-01,Taxi,50,Expense,Shopping,Clothes\n', categories);
  ok(r3.entries.length === 1 && r3.entries[0].account === undefined, 'CSV without an Account column is unchanged');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
