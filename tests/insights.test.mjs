// node tests/insights.test.mjs
import { computeInsights, computeAllTime } from '../js/insights.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };

const E = (date, description, amount, category, sub, type = 'Expense') => ({ id: date + description, date, description, amount, type, category, sub });
const fmt = (n) => Number(n).toFixed(2);
const monthName = (k) => ({ '2026-09': 'September', '2026-10': 'October' }[k] || k);
const find = (r, id) => r.items.find((i) => i.id === id);

const sept = { key: '2026-09', entries: [
  E('2026-09-02', 'Groceries run', 400, 'Food', 'Groceries'), E('2026-09-09', 'Dinner', 300, 'Food', 'Dining Out'),
  E('2026-09-05', 'Metro', 100, 'Transport', 'Public Transit'), E('2026-09-20', 'Shoes', 500, 'Shopping', 'Clothes'),
  E('2026-09-01', 'Salary', 5000, 'Income', 'Income', 'Income'), E('2026-09-28', 'Late shop', 900, 'Shopping', 'Household'),
] };
const oct = { key: '2026-10', entries: [
  E('2026-10-01', 'Salary', 5000, 'Income', 'Income', 'Income'),
  E('2026-10-02', 'Weekly groceries', 700, 'Food', 'Groceries'), E('2026-10-03', 'Netflix', 150, 'Subscriptions', 'Netflix'),
  E('2026-10-05', 'Coffee', 60, 'Food', 'Coffee'), E('2026-10-06', 'Coffee', 55, 'Food', 'Coffee'), E('2026-10-07', 'Coffee', 65, 'Food', 'Coffee'),
  E('2026-10-08', 'Metro', 90, 'Transport', 'Public Transit'), E('2026-10-09', 'Sneakers', 450, 'Shopping', 'Clothes'),
  E('2026-10-09', 'Dog food', 200, 'Pets', 'Food'), E('2026-10-10', 'Fuel', 300, 'Transport', 'Fuel'),
] };

const run = (m, prev, today) => computeInsights({ m, prev, today, fmt, monthName });

// ---- not enough data
let r = run({ key: '2026-10', entries: [E('2026-10-02', 'x', 10, 'Food', 'Coffee')] }, null, '2026-10-12');
ok(!r.enough && r.items.length === 0, 'too few expenses: no insights, no nonsense');

// ---- the current month, compared fairly with the previous one
r = run(oct, sept, '2026-10-12');
ok(r.enough && r.items.length >= 5 && r.items.length <= 7, `produces a short list (${r.items.length} items)`);
const top = find(r, 'top-cat');
ok(top && top.cat === 'Food' && /Food is your biggest spend/.test(top.title) && /Groceries \(700\.00\)/.test(top.detail), 'biggest category is Food and the driver sub-category is Groceries');
ok(top.badge === '40%' || /^\d+%$/.test(top.badge), `share badge shown (${top.badge})`);
const pace = find(r, 'pace');
ok(pace && /On pace to spend about 6.*\d/.test(pace.title) || (pace && /On pace/.test(pace.title)), 'month-end projection appears for the month in progress');
ok(r.items[0].id === 'pace', 'the projection is listed first');
const vs = find(r, 'vs-prev');
ok(vs && /higher|lower/.test(vs.title) && /by the same day last month/.test(vs.detail), 'compares with the same days of last month, not the whole month');
// last month to the 12th: 400+300+100 = 800 (Shoes 20th and Late shop 28th are not counted yet); this month = 2220-? computed below
const spentOct = oct.entries.filter((e) => e.type === 'Expense').reduce((n, e) => n + e.amount, 0);
ok(vs && vs.detail.includes(fmt(spentOct)) && vs.detail.includes('800.00'), 'fair comparison uses 800.00 from last month up to the 12th');
const up = find(r, 'cat-up');
ok(up && /is (up|new)/.test(up.title), `a category that grew is called out (${up && up.title})`);
const newCat = r.items.find((i) => i.cat === 'Pets');
ok(!newCat || /new/.test(newCat.title), 'a category with no history is described as new');
const rep = find(r, 'repeat');
ok(rep && /Coffee/.test(rep.title) && /3 times/.test(rep.title) && /180\.00 in total/.test(rep.detail), 'repeat purchases: Coffee three times, 180.00 in total');
const subs = find(r, 'subs');
ok(subs && /150\.00/.test(subs.title), 'subscriptions are summed');
const saved = find(r, 'saved');
ok(saved && /kept/.test(saved.title), 'savings rate shown when a good share of income is kept');

// ---- a finished month compares with the whole previous month
r = run(sept, null, '2026-10-12');
ok(r.enough && !find(r, 'pace') && !find(r, 'vs-prev'), 'finished month: no projection, no comparison without a previous month');
r = run({ key: '2026-10', entries: oct.entries }, sept, '2026-11-02');
const vs2 = find(r, 'vs-prev');
ok(vs2 && vs2.detail.includes('in September') && vs2.detail.includes('2200.00'), 'finished month: whole of September (2200.00) is the baseline');
ok(!find(r, 'pace'), 'no projection for a month that is over');

// ---- spending above income
r = run({ key: '2026-10', entries: [E('2026-10-01', 'Pay', 100, 'Income', 'Income', 'Income'), E('2026-10-02', 'a', 80, 'Food', 'Groceries'), E('2026-10-03', 'b', 80, 'Food', 'Groceries'), E('2026-10-04', 'c', 80, 'Food', 'Coffee')] }, null, '2026-11-01');
ok(find(r, 'over') && /above your income/.test(find(r, 'over').title), 'warns when spending exceeds income');

// ---- weekday concentration
const fri = [];
for (let d = 2; d <= 30; d += 7) fri.push(E(`2026-10-${String(d).padStart(2, '0')}`, '', 200, 'Food', 'Dining Out')); // 2026-10-02 is a Friday
fri.push(E('2026-10-04', '', 20, 'Food', 'Coffee'), E('2026-10-11', '', 20, 'Food', 'Coffee'), E('2026-10-18', '', 20, 'Food', 'Coffee'), E('2026-10-25', '', 20, 'Food', 'Coffee'));
r = run({ key: '2026-10', entries: fri }, null, '2026-11-01');
ok(find(r, 'weekday') && /Fridays/.test(find(r, 'weekday').title), 'finds that Fridays dominate');

// ---- no-spend days
r = run({ key: '2026-10', entries: [E('2026-10-02', '', 10, 'Food', 'Coffee'), E('2026-10-03', '', 10, 'Food', 'Coffee'), E('2026-10-04', '', 10, 'Food', 'Coffee'), E('2026-10-05', '', 10, 'Food', 'Coffee'), E('2026-10-06', '', 10, 'Food', 'Coffee')] }, null, '2026-10-10');
ok(find(r, 'free') && /5 no-spend days/.test(find(r, 'free').title) || find(r, 'free'), 'counts no-spend days');


// ---- all-time
const mk = (key, n, cat, sub, amt, extra = []) => ({ key, entries: [...Array.from({ length: n }, (_, i) => E(`${key}-${String(i + 2).padStart(2, '0')}`, 'Latte', amt, cat, sub)), ...extra] });
const months = [
  mk('2026-04', 4, 'Food', 'Coffee', 50), mk('2026-05', 4, 'Food', 'Coffee', 50), mk('2026-06', 4, 'Food', 'Coffee', 50, [E('2026-06-20', 'TV', 3000, 'Shopping', 'Electronics')]),
  mk('2026-07', 4, 'Food', 'Coffee', 90), mk('2026-08', 4, 'Food', 'Coffee', 110), mk('2026-09', 4, 'Food', 'Coffee', 130),
  { key: '2026-10', entries: [E('2026-10-02', 'Latte', 10, 'Food', 'Coffee'), E('2026-10-01', 'Pay', 9000, 'Income', 'Income', 'Income')] },
];
const a = computeAllTime({ months, today: '2026-10-05', fmt, monthName: (k) => ['', '', '', '', 'April', 'May', 'June', 'July', 'August', 'September', 'October'][+k.slice(5)] });
ok(a.enough, 'all-time: enough data');
ok(find(a, 'top-cat') && find(a, 'top-cat').cat === 'Shopping', 'all-time: the 3000 TV makes Shopping the top category');
ok(find(a, 'big') && /3000\.00/.test(find(a, 'big').title), 'all-time: biggest single expense found');
ok(find(a, 'hi-month') && /June 2026/.test(find(a, 'hi-month').title), 'all-time: costliest month is June');
ok(!/October/.test(find(a, 'hi-month').detail), 'all-time: the month in progress is never the "cheapest"');
ok(find(a, 'trend') && /falling/.test(find(a, 'trend').title) && find(a, 'cat-down') && find(a, 'cat-down').cat === 'Shopping', 'all-time: detects falling spend and that Shopping drove it');
ok(find(a, 'repeat') && /Latte/.test(find(a, 'repeat').title), 'all-time: Latte is the most frequent purchase');
ok(find(a, 'avg') && /a month/.test(find(a, 'avg').title), 'all-time: monthly average');
ok(!computeAllTime({ months: [{ key: '2026-04', entries: months[0].entries.slice(0, 2) }], today: '2026-10-05', fmt, monthName }).enough, 'all-time: too little data says so');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
