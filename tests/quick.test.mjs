// node tests/quick.test.mjs
import { parseMessages, parseDate, norm } from '../js/quick.js';

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL:', m); } else console.log('ok  :', m); };

// the user's real categories
const categories = {
  order: ['Bills', 'Food', 'Transport', 'Entertainment', 'Shopping', 'Health', 'Education', 'Travel', 'Subscriptions', 'Miscellaneous'],
  map: {
    Bills: ['Mobile', 'Internet', 'Electricity', 'Water', 'Landline'], Food: ['Groceries', 'Dining Out', 'Coffee'], Transport: ['Fuel', 'Taxi', 'Public Transit'],
    Entertainment: ['Streaming', 'Cinema', 'Games'], Shopping: ['Clothes', 'Electronics', 'Household'], Health: ['Doctor Visits', 'Pharmacy', 'Insurance', 'Gym'],
    Education: ['Courses', 'Books', 'Tuition'], Travel: ['Flights', 'Hotels', 'Tours', 'Transport'],
    Subscriptions: ['Netflix', 'Spotify', 'Youtube Premium', 'iCloude+', 'Claude AI', 'Other Services'], Miscellaneous: ['Other'],
  },
};
const accounts = [{ name: 'Credit Card', type: 'card', archived: false }, { name: 'Cash', type: 'cash', archived: false }];
const E = (date, description, amount, category, sub, type = 'Expense') => ({ id: date + description, date, description, amount, type, category, sub, account: 'Credit Card' });
const today = '2026-10-04';
const run = (text, history = []) => parseMessages(text, { today, categories, accounts, history });

// ---- the five real CIB messages, pasted together
const SMS = `Your credit card ending with#6262 using Apple Pay was charged for EGP 1405.00 at MAHMOUD A MAHMO on 03/10/26  at 19:56. Card available limit is EGP  144263.10. For more details, please visit https://cib.eg/mb

Your credit card ending with#6262 was charged for EGP 889.00 at Amazon Marketpl on 03/10/26  at 17:24. Card available limit is EGP  145668.10. For more details, please visit https://cib.eg/mb

Your credit card ending with#6262 using Apple Pay was charged for EGP 430.00 at MOBIL ADEL MOKH on 01/10/26  at 19:41. Card available limit is EGP  149400.00. For more details, please visit https://cib.eg/mb

Your credit card ending with#6262 using Apple Pay was charged for EGP 1812.21 at Bill Payment Vo on 02/10/26  at 13:31. Card available limit is EGP  147562.79. For more details, please visit https://cib.eg/mb

Your credit card #6262 was charged for EGP 999.99 at APPLE.COM BILL on 02/10/26  at 14:22. Available limit is  146562.80 and the available international limit to use is EGP 153053`;

let rows = run(SMS);
ok(rows.length === 5, 'five messages in one paste become five rows');
const by = (amt) => rows.find((r) => r.amount === amt);
ok(rows.every((r) => r.source === 'sms' && r.type === 'Expense' && r.currency === 'EGP' && r.account === 'Credit Card'), 'all are card expenses in EGP, filed under the Credit Card account');
ok(by(1405).date === '2026-10-03' && by(1405).time === '19:56' && by(430).date === '2026-10-01' && by(1812.21).date === '2026-10-02', 'dates read as dd/mm/yy, times kept');
ok(by(1405).description === 'Mahmoud A Mahmo' && by(889).description === 'Amazon Marketpl' && by(999.99).description === 'Apple.com Bill', 'merchant names tidied (ALL CAPS become readable, truncation left alone)');
ok(by(430).category === 'Transport' && by(430).sub === 'Fuel' && by(430).confidence === 'high' && by(430).ready, 'MOBIL is recognised as a fuel station: Transport > Fuel, ready');
ok(by(889).category === 'Shopping' && by(889).confidence === 'medium' && !by(889).ready, 'Amazon is Shopping, but which sub-category is only a guess, so it needs a look');
ok(by(1812.21).category === 'Bills' && by(1812.21).confidence === 'medium' && !by(1812.21).ready, '"Bill Payment" is Bills, flagged for a check');
ok(by(999.99).category === 'Subscriptions' && by(999.99).sub === 'iCloude+' && !by(999.99).ready, 'APPLE.COM/BILL is Subscriptions > iCloude+, flagged for a check');
ok(by(1405).category === '' && by(1405).confidence === 'low' && !by(1405).ready, 'an unknown person/shop is left for you to choose, not guessed');

// ---- it learns from the user's own history
const history = [
  E('2026-09-10', 'Amazon order', 300, 'Shopping', 'Electronics'), E('2026-09-12', 'Amazon cables', 120, 'Shopping', 'Electronics'),
  E('2026-09-14', 'Mahmoud milk', 80, 'Food', 'Groceries'), E('2026-09-20', 'Mahmoud milk', 95, 'Food', 'Groceries'),
];
rows = run(SMS, history);
ok(by(889).sub === 'Electronics' && by(889).confidence === 'high' && by(889).ready, 'after two Amazon > Electronics entries, Amazon is filed there with confidence');
ok(by(1405).category === 'Food' && by(1405).sub === 'Groceries' && by(1405).ready, 'a truncated merchant ("MAHMOUD A MAHMO") matches your earlier "Mahmoud milk" entries');

// ---- spotting what is already logged
rows = run(SMS, [E('2026-10-03', "Rafi's from Amazon", 889, 'Shopping', 'Household'), E('2026-10-01', 'Fuel', 430, 'Transport', 'Fuel')]);
ok(by(889).dup && by(430).dup && !by(1405).dup && !by(889).ready && !by(430).ready, 'already-logged purchases (same day and amount) are marked and never ready');
rows = run(SMS + '\n\n' + SMS.split('\n\n')[1], [E('2026-10-03', 'x', 889, 'Shopping', 'Household')]);
ok(rows.filter((r) => r.amount === 889 && r.dup).length === 1 && rows.filter((r) => r.amount === 889 && !r.dup).length === 1, 'one existing entry matches only one of two identical messages');

// ---- other bank message shapes
rows = run('Your credit card ending with#6262 was charged for USD 12.99 at SPOTIFY on 02/10/26 at 10:00.');
ok(rows[0].currency === 'USD' && rows[0].category === 'Subscriptions' && rows[0].sub === 'Spotify' && !rows[0].ready, 'foreign-currency charges are recognised but never auto-ready');
rows = run('Your credit card ending with#6262 was credited with EGP 250.00 from AMAZON REFUND on 03/10/26 at 12:00. Available limit is 1.');
ok(rows[0] && rows[0].type === 'Income' && rows[0].amount === 250 && rows[0].ready, 'a refund / credit message becomes income');

// ---- typed text, English
rows = run('coffee 45');
ok(rows.length === 1 && rows[0].amount === 45 && rows[0].category === 'Food' && rows[0].sub === 'Coffee' && rows[0].date === today && rows[0].ready, '"coffee 45" is Food > Coffee today');
rows = run('taxi 80 cash yesterday');
ok(rows[0].amount === 80 && rows[0].sub === 'Taxi' && rows[0].account === 'Cash' && rows[0].date === '2026-10-03', '"taxi 80 cash yesterday": Taxi, Cash account, yesterday');
rows = run('spent 1,250.50 on groceries at carrefour');
ok(rows[0].amount === 1250.5 && rows[0].sub === 'Groceries', 'thousands separators and decimals; "spent ... on" filler is ignored');
rows = run('45 coffee\nuber 120\nnetflix 149.99');
ok(rows.length === 3 && rows.map((r) => r.sub).join() === 'Coffee,Taxi,Netflix', 'one entry per line');
rows = run('salary 15000');
ok(rows[0].type === 'Income' && rows[0].amount === 15000 && rows[0].ready, '"salary 15000" is income');
rows = run('lunch 2.5k');
ok(rows[0].amount === 2500 && rows[0].sub === 'Dining Out', '"2.5k" means 2500');
rows = run('shoes 600 on 28/09');
ok(rows[0].date === '2026-09-28' && rows[0].sub === 'Clothes', 'explicit date in the text is not confused with the amount');
rows = run('hello there');
ok(rows.length === 0, 'text with no amount produces nothing');
rows = run('gizmo 99');
ok(rows.length === 1 && rows[0].category === '' && !rows[0].ready && rows[0].description === 'Gizmo', 'unknown thing: kept for you to categorise, note preserved');

// ---- Arabic / Egyptian
rows = run('قهوة ٤٥');
ok(rows[0].amount === 45 && rows[0].sub === 'Coffee' && rows[0].ready, 'Arabic: قهوة ٤٥ -> Coffee 45 (Arabic-Indic digits)');
rows = run('تاكسي ٨٠ كاش امبارح');
ok(rows[0].amount === 80 && rows[0].sub === 'Taxi' && rows[0].account === 'Cash' && rows[0].date === '2026-10-03', 'Arabic: taxi, cash, yesterday');
rows = run('بنزين 500');
ok(rows[0].sub === 'Fuel' && rows[0].amount === 500, 'Arabic: بنزين -> Fuel');
rows = run('صرفت 200 على سوبر ماركت');
ok(rows[0].amount === 200 && rows[0].sub === 'Groceries', 'Arabic: "spent 200 on supermarket"');
rows = run('قبضت مرتب 12000');
ok(rows[0].type === 'Income' && rows[0].amount === 12000, 'Arabic: salary received is income');
rows = run('فاتورة فودافون 350');
ok(rows[0].category === 'Bills' && rows[0].sub === 'Mobile' && rows[0].amount === 350, 'Arabic: Vodafone bill');
rows = run('قهوة ٤٥');
ok(rows[0].description.length > 0, 'the note keeps the original (Arabic) words');

// ---- helpers
ok(parseDate('03/10/26', today) === '2026-10-03' && parseDate('2026-09-30', today) === '2026-09-30' && parseDate('31/12', today) === '2026-12-31' && parseDate('13/12/2025', today) === '2025-12-13', 'date formats');
ok(parseDate('31/02/26', today) === null, 'an impossible date is rejected');
ok(norm('قَهْوَة ٤٥') === 'قهوه 45', 'Arabic text is normalised (diacritics, ta marbuta, digits)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
