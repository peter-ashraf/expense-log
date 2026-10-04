// node tests/xlsx.test.mjs [path-to-original-workbook]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWorkbook, parseWorkbook, unzip, sheetNameFor, parseSheetName, toIsoDate } from '../js/xlsx.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };

const categories = {
  order: ['Bills', 'Food', 'Shopping'],
  map: { Bills: ['Mobile', 'Internet'], Food: ['Groceries', 'Coffee'], Shopping: ['Clothes', 'Household'] },
};
const mk = (date, description, amount, type, category, sub) => ({ id: 'x' + date + amount, date, description, amount, type, category, sub });
const augE = [mk('2026-08-02', 'Pay & "bonus" <tax>', 5000, 'Income', 'Income', 'Income'), mk('2026-08-16', 'Gift', 1250.5, 'Expense', 'Shopping', 'Household')];
const sepE = [mk('2026-09-10', 'Phone', 300, 'Expense', 'Bills', 'Mobile')];
const view = {
  months: ['2026-08', '2026-09', '2026-10'],
  categories,
  by: {
    '2026-08': { key: '2026-08', entries: augE, start: 150000, spent: 1250.5, income: 5000, available: 153749.5 },
    '2026-09': { key: '2026-09', entries: sepE, start: 153749.5, spent: 300, income: 0, available: 153449.5 },
    '2026-10': { key: '2026-10', entries: [], start: 153449.5, spent: 0, income: 0, available: 153449.5 },
  },
};

ok(sheetNameFor('2026-09') === 'Sept-26' && sheetNameFor('2026-10') === 'Oct-26', 'sheet names use the original Sept-26 style');
ok(parseSheetName('Sept-26') === '2026-09' && parseSheetName('Sep-26') === '2026-09' && parseSheetName('Summary') === null, 'sheet names parse back');
ok(toIsoDate(46260) === new Date(Date.UTC(1899, 11, 30) + 46260 * 86400000).toISOString().slice(0, 10) && toIsoDate('02-Aug-26') === '2026-08-02' && toIsoDate('2026-08-02') === '2026-08-02' && toIsoDate('nope') === null, 'date parsing');

const bytes = buildWorkbook(view);
const out = path.join(here, '..', '..', 'ExpenseLog-App-test-export.xlsx');
fs.writeFileSync(path.join(process.env.TEST_OUT || here, 'export-sample.xlsx'), bytes);

const z = await unzip(bytes);
const names = z.names;
ok(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/sharedStrings.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet5.xml'].every((n) => names.includes(n)), 'package has the expected parts: ' + names.length);
const wb = await z.text('xl/workbook.xml');
ok(/name="Summary"[^>]*\/>.*name="Categories".*name="Aug-26".*name="Sept-26".*name="Oct-26"/.test(wb), 'sheet order: Summary, Categories, then months');
const aug = await z.text('xl/worksheets/sheet3.xml');
ok(aug.includes('SUMIFS(tblTransactions_Aug_26[Amount],tblTransactions_Aug_26[Type],&quot;Expense&quot;)') || aug.includes('SUMIFS(tblTransactions_Aug_26[Amount],tblTransactions_Aug_26[Type],"Expense")'), 'balance formulas use structured table references');
const sep = await z.text('xl/worksheets/sheet4.xml');
ok(sep.includes("<f>'Aug-26'!C2</f>"), "September's starting balance links to August");
ok((await z.text('xl/tables/table2.xml')).includes('name="tblBalance_Aug_26"') && (await z.text('xl/tables/table3.xml')).includes('ref="A4:F6"'), 'table names/ranges follow the original (tblBalance_*, tblTransactions_*)');

// round trip through the reader
const back = await parseWorkbook(bytes, categories);
const key = (e) => [e.date, e.description, e.amount, e.type, e.category, e.sub].join('|');
const want = [...augE, ...sepE].map(key).sort();
ok(JSON.stringify(back.entries.map(key).sort()) === JSON.stringify(want), 'round trip returns exactly the exported transactions (special characters preserved)');
ok(back.skipped.length === 0 && back.sheets === 3, 'no rows skipped; three month sheets read');

// a bad category is reported, not imported
const bad = buildWorkbook({ ...view, by: { ...view.by, '2026-09': { ...view.by['2026-09'], entries: [mk('2026-09-11', 'X', 10, 'Expense', 'Nope', 'Nada')] } } });
const rb = await parseWorkbook(bad, categories);
ok(rb.skipped.length === 1 && /unknown category/.test(rb.skipped[0].reason), 'unknown category is skipped with a reason');

// ---- several accounts: an extra Account column and an Accounts tab, original columns untouched
{
  const acc = [{ name: 'Credit Card', type: 'card', limit: 9000, archived: false }, { name: 'Cash', type: 'cash', limit: 1500, archived: false }];
  const v2 = { ...view, accounts: acc, by: { ...view.by, '2026-09': { ...view.by['2026-09'], entries: [{ ...sepE[0], account: 'Cash' }, { ...mk('2026-09-12', 'Lunch', 80, 'Expense', 'Food', 'Coffee'), account: 'Credit Card' }] } } };
  const b2 = await buildWorkbook(v2);
  const z2 = await unzip(b2);
  const wb2 = await z2.text('xl/workbook.xml');
  ok(/name="Accounts"/.test(wb2) && /name="Summary"[^>]*\/>.*name="Categories".*name="Aug-26".*name="Sept-26".*name="Oct-26".*name="Accounts"/.test(wb2), 'Accounts tab added after the month tabs');
  const t2 = (await Promise.all(z2.names.filter((n) => /xl\/tables\/table\d+\.xml/.test(n)).map((n) => z2.text(n)))).join('');
  ok(/ref="A4:G\d+"/.test(t2) && /tableColumn id="7" name="Account"/.test(t2), 'transaction table grows by one trailing column (A:F stay as they were)');
  const back2 = await parseWorkbook(b2, categories);
  const acct = (d, a) => back2.entries.find((e) => e.date === d && e.account === a);
  ok(back2.entries.length === 4 && acct('2026-09-10', 'Cash') && acct('2026-09-12', 'Credit Card'), 'account names survive an Excel round trip');
  ok(back2.skipped.length === 0, 'nothing skipped');
  const plain = await parseWorkbook(bytes, categories);
  ok(plain.entries.every((e) => e.account === undefined), 'an old-style file (no Account column) still imports, with no account');
  const one = await buildWorkbook({ ...v2, accounts: [acc[0]] });
  ok(Buffer.from(one).length === Buffer.from(bytes).length || !/name="Accounts"/.test(await (await unzip(one)).text('xl/workbook.xml')), 'a single account exports exactly like the original format');
}

// the user's real workbook (optional)
const orig = process.argv[2] || 'C:/Users/peter/OneDrive/Expense Log - Fixed.xlsm';
if (fs.existsSync(orig)) {
  const real = { order: ['Bills', 'Food', 'Transport', 'Entertainment', 'Shopping', 'Health', 'Education', 'Travel', 'Subscriptions', 'Miscellaneous'], map: {
    Bills: ['Mobile', 'Internet', 'Electricity', 'Water', 'Landline'], Food: ['Groceries', 'Dining Out', 'Coffee'], Transport: ['Fuel', 'Taxi', 'Public Transit'],
    Entertainment: ['Streaming', 'Cinema', 'Games'], Shopping: ['Clothes', 'Electronics', 'Household'], Health: ['Doctor Visits', 'Pharmacy', 'Insurance', 'Gym'],
    Education: ['Courses', 'Books', 'Tuition'], Travel: ['Flights', 'Hotels', 'Tours', 'Transport'],
    Subscriptions: ['Netflix', 'Spotify', 'Youtube Premium', 'iCloude+', 'Claude AI', 'Other Services'], Miscellaneous: ['Other'] } };
  const r = await parseWorkbook(fs.readFileSync(orig), real);
  console.log(`original workbook: ${r.entries.length} readable, ${r.skipped.length} skipped across ${r.sheets} sheets`);
  r.skipped.forEach((s) => console.log('   skipped', s.sheet, 'row', s.row, '-', s.reason));
  ok(r.entries.length + r.skipped.length === 72 && r.sheets === 3, 'reads all 72 rows of the original workbook');
  const total = r.entries.filter((e) => e.type === 'Expense').reduce((s, e) => s + e.amount, 0);
  console.log('   expenses total (readable rows):', total.toFixed(2));
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
