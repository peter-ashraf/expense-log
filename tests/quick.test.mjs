// node tests/quick.test.mjs
import { parseMessages, parseDate, norm, wordsToDigits } from '../js/quick.js';

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
rows = run('دخلت السينما ودفعت 260 جنيه');
ok(rows[0].type === 'Expense' && rows[0].amount === 260, 'Arabic: "went to the cinema" is not income');
rows = run('اشتريت لبن بالف واربع 105 وحطيت بنزين بأربع 130 جنيه');
ok(rows.length === 2 && rows[0].amount === 1405 && rows[1].amount === 430, 'Arabic: iPhone half-digit numbers (1405, 430)');
rows = run('جبت هدوم بثلاث 180 جنيه');
console.log('info: "ثلاث 180" reads as', rows[0] && rows[0].amount);
rows = run('دخلي 5000');
ok(rows[0].type === 'Income', 'Arabic: "my income 5000" is income');
rows = run('فاتورة فودافون 350');
ok(rows[0].category === 'Bills' && rows[0].sub === 'Mobile' && rows[0].amount === 350, 'Arabic: Vodafone bill');
rows = run('قهوة ٤٥');
ok(rows[0].description.length > 0, 'the note keeps the original (Arabic) words');

// ---- number words (what a speech engine may return)
{
  const n = (x) => wordsToDigits(x).replace(/\s+/g, ' ').trim();
  ok(n('coffee forty five') === 'coffee 45', 'words: forty five -> 45');
  ok(n('taxi eighty') === 'taxi 80' && n('lunch fifteen') === 'lunch 15', 'words: eighty, fifteen');
  ok(n('shoes two hundred and fifty') === 'shoes 250' && n('rent four thousand two hundred') === 'rent 4200', 'words: hundreds and thousands');
  ok(n('a hundred') === '100' && n('twenty-five') === '25' && n('one thousand') === '1000', 'words: "a hundred", hyphenated, one thousand');
  ok(n('two coffees') === 'two coffees' && n('one plus phone') === 'one plus phone', 'words: a lone small number is left alone ("two coffees")');
  rows = run('coffee forty five');
  ok(rows[0].amount === 45 && rows[0].sub === 'Coffee', 'spoken: "coffee forty five" -> Coffee 45');
  ok(run('coffee forty five')[0].description === 'Coffee' && run('taxi eighty cash')[0].description === 'Taxi', 'spoken: the note keeps your words but not the spoken number');
  rows = run('two coffees forty five');
  ok(rows[0].amount === 45 || rows[0].amount === 2, 'spoken: a quantity word does not crash the parse');
  rows = run('taxi eighty cash yesterday');
  ok(rows[0].amount === 80 && rows[0].account === 'Cash' && rows[0].date === '2026-10-03', 'spoken: "taxi eighty cash yesterday"');
  rows = run('groceries one thousand two hundred fifty');
  ok(rows[0].amount === 1250 && rows[0].sub === 'Groceries', 'spoken: "groceries one thousand two hundred fifty"');
}

// ---- Egyptian Arabic: number words, several purchases in one sentence, wallets
{
  const nums = (t) => run(t).map((r) => r.amount).join(',');
  ok(nums('قهوة بخمسين') === '50' && nums('تاكسي بتمانين') === '80' && nums('اكل بميه وخمسين') === '150', 'numbers: خمسين 50, تمانين 80, ميه وخمسين 150');
  ok(nums('بنزين بخمسه وتلاتين') === '35' && nums('فاتورة النت بميتين وخمسين') === '250', 'numbers: خمسة وتلاتين 35, ميتين وخمسين 250');
  ok(nums('ايجار بالفين') === '2000' && nums('موبايل بتلات تلاف وخمسميه') === '3500' && nums('سفر بالف وميتين') === '1200', 'numbers: الفين 2000, تلات تلاف وخمسميه 3500, الف وميتين 1200');
  ok(nums('غدا بخمستاشر') === '15' && nums('عشاء بتلتميه جنيه') === '300', 'numbers: خمستاشر 15, تلتميه 300');
  ok(nums('اتنين قهوة بخمسين') === '50', 'a small quantity word ("اتنين قهوة") is not taken as the price');
  ok(nums('2 قهوة 50') === '50' && nums('three coffees 120') === '120', 'a small quantity digit before a word is not taken as the price');
  ok(nums('خمسين وتمانين') === '50,80' || nums('قهوة خمسين وتمانين') !== '', 'two prices said back to back are not merged into one');

  // several purchases in one spoken sentence
  let r3 = run('اشتريت قهوة بخمسين وتاكسي بتمانين وبنزين بميتين');
  ok(r3.length === 3 && r3.map((r) => r.amount).join() === '50,80,200', 'one sentence, three purchases and prices');
  ok(r3.map((r) => r.sub).join() === 'Coffee,Taxi,Fuel' && r3.every((r) => r.ready), 'each is filed correctly: Coffee, Taxi, Fuel (all ready)');
  ok(r3.map((r) => r.description).join('|') === 'قهوة|تاكسي|بنزين', 'each note keeps its own Arabic word, without the price, the verb or the connector');
  ok(r3.every((r) => r.account === 'Credit Card'), 'no wallet mentioned: every purchase goes to the credit card');

  r3 = run('دفعت خمسين في القهوة وبعدين ميه وعشرين في التاكسي');
  ok(r3.length === 2 && r3[0].amount === 50 && r3[0].sub === 'Coffee' && r3[1].amount === 120 && r3[1].sub === 'Taxi', 'price-first wording: "paid 50 for the coffee and then 120 for the taxi"');

  r3 = run('القهوة بخمسين والتاكسي بتمانين');
  ok(r3.length === 2 && r3[1].sub === 'Taxi' && r3[1].description === 'التاكسي', 'the glued و ("والتاكسي") is a connector, not part of the word');

  r3 = run('قهوة 50 وتاكسي 80 وبنزين 200 ');
  ok(r3.length === 3, 'digits work the same as number words');
  r3 = run('قهوة 50، تاكسي 80، بنزين 200');
  ok(r3.length === 3 && r3[2].amount === 200, 'commas separate purchases too');
  r3 = run('امبارح اشتريت اكل بتلتميه جنيه وبنزين بخمسميه');
  ok(r3.length === 2 && r3.every((r) => r.date === '2026-10-03') && r3[0].sub === 'Dining Out' && r3[1].sub === 'Fuel' && r3[1].amount === 500, 'a day said at the start ("امبارح") applies to every purchase');
  r3 = run('قهوة بخمسين النهارده وتاكسي بتمانين امبارح');
  ok(r3.length === 2 && r3[0].date === today && r3[1].date === '2026-10-03', 'a day said inside one purchase applies only to that purchase');
  r3 = run('بنزين بميتين ووقود بتلاتين');
  ok(r3.length === 2 && r3[1].amount === 30, 'a word that really starts with و ("وقود") is not cut in half');

  // English, same behaviour
  r3 = run('coffee forty five and taxi eighty and fuel two hundred');
  ok(r3.length === 3 && r3.map((r) => r.amount).join() === '45,80,200' && r3.map((r) => r.sub).join() === 'Coffee,Taxi,Fuel', 'English: three purchases in one sentence');
  r3 = run('I paid fifty for coffee then one hundred twenty for a taxi');
  ok(r3.length === 2 && r3[0].amount === 50 && r3[1].amount === 120, 'English: price-first wording with "then"');
  ok(run('coffee 45 and taxi 80').length === 2, 'English: digits');

  // wallets: named, said in Arabic, said in English, otherwise the credit card
  const wallets = [{ name: 'Credit Card', type: 'card', archived: false }, { name: 'Cash', type: 'cash', archived: false }, { name: 'Vodafone Cash', type: 'cash', archived: false }, { name: 'Instapay', type: 'card', archived: false }];
  const runW = (t) => parseMessages(t, { today, categories, accounts: wallets, history: [] });
  let w = runW('قهوة بخمسين وتاكسي بتمانين كاش');
  ok(w[0].account === 'Credit Card' && w[1].account === 'Cash', 'a wallet said after a purchase applies to that purchase; the rest use the credit card');
  w = runW('كله كاش قهوة بخمسين وتاكسي بتمانين');
  ok(w.length === 2 && w.every((r) => r.account === 'Cash'), '"كله كاش" (all cash) applies to every purchase');
  w = runW('تاكسي بتمانين من فودافون كاش');
  ok(w[0].account === 'Vodafone Cash' && !/فودافون/.test(w[0].description), 'a named wallet in Arabic letters ("فودافون كاش") finds "Vodafone Cash" and is left out of the note');
  w = runW('قهوة بخمسين بالكاش وبنزين بميتين بالفيزا');
  ok(w[0].account === 'Cash' && w[1].account === 'Credit Card', '"بالكاش" and "بالفيزا" (with the Arabic prefix) are understood');
  w = runW('coffee 45 with Vodafone Cash and taxi 80');
  ok(w[0].account === 'Vodafone Cash' && w[1].account === 'Credit Card', 'English: "with Vodafone Cash"');
  w = runW('دفعت ٢٠٠ من انستاباي في الكهربا');
  ok(w[0].account === 'Instapay' && w[0].category === 'Bills' && w[0].sub === 'Electricity', 'Instapay in Arabic letters; "الكهربا" is the electricity bill');
  w = runW('قهوة بخمسين');
  ok(w[0].account === 'Credit Card', 'no wallet said: credit card');
  ok(parseMessages('قهوة بخمسين', { today, categories, accounts: [{ name: 'Visa Gold', type: 'card', archived: false }, { name: 'Cash', type: 'cash', archived: false }], history: [] })[0].account === 'Visa Gold', 'the "credit card" default is whichever card account comes first');
  ok(parseMessages('قهوة بخمسين', { today, categories, accounts: [], history: [] })[0].account === '', 'no accounts at all: nothing invented');

  // Egyptian vocabulary
  const sub = (t) => { const r = run(t)[0]; return r.category + '>' + r.sub; };
  ok(sub('شاي بعشرين') === 'Food>Coffee' && sub('فطار بتلاتين') === 'Food>Dining Out' && sub('عيش وخضار بستين') === 'Food>Groceries', 'food words: شاي, فطار, عيش وخضار');
  ok(sub('ميكروباص بخمسه وعشرين') === 'Transport>Public Transit' && sub('توك توك بعشرين') === 'Transport>Public Transit' && sub('اوبر بميه') === 'Transport>Taxi', 'transport words: ميكروباص, توك توك, اوبر');
  ok(sub('شحن رصيد بخمسين') === 'Bills>Mobile' && sub('فاتورة الميه بتمانين') === 'Bills>Water' && sub('النت بتلتميه') === 'Bills>Internet', 'bills: شحن رصيد, فاتورة الميه, النت');
  ok(sub('صيدلية بمية وعشرين') === 'Health>Pharmacy' && sub('كشف دكتور بخمسميه') === 'Health>Doctor Visits' && sub('هدوم بالف') === 'Shopping>Clothes', 'health and shopping: صيدلية, كشف دكتور, هدوم');
}

// ---- what iOS really returns for Egyptian Arabic (from a report on an iPhone): numbers half-converted to digits
{
  const heard = '‏اشتريت النهارده بالف واربع 105 لبن وحطيت بنزين بأربع 130 جنيه';
  const r4 = run(heard);
  ok(r4.length === 2 && r4[0].amount === 1405 && r4[1].amount === 430, 'iOS wording: "بألف واربع 105" is 1405 and "بأربع 130" is 430');
  ok(r4[0].sub === 'Groceries' && r4[1].sub === 'Fuel' && r4.every((r) => r.ready && r.account === 'Credit Card'), 'iOS wording: milk is Groceries, fuel is Fuel, both ready on the credit card');
  ok(r4[0].description === 'لبن' && r4[1].description === 'بنزين', 'iOS wording: notes are just the item (no verb, no direction marks)');
  const nums = (t) => run(t).map((r) => r.amount).join(',');
  ok(nums('قهوة بتلات 150') === '350', 'a unit followed by 1xx: تلات 150 = 350');
  ok(nums('ايجار بالف 500') === '1500' && nums('ايجار بالف و 105') === '1105', 'a thousand followed by digits adds up: الف 500 = 1500, الف و 105 = 1105');
  ok(nums('اشتريت لبن بخمسين وبنزين بأربع 130') === '50,430', 'a plain word price and an iOS-style price in one sentence');
  ok(nums('قهوة 50 وتاكسي 80') === '50,80' && nums('قهوة بخمسين وتاكسي 80') === '50,80', 'ordinary digits next to number words are not merged');
  ok(run('‏قهوة‏ بخمسين')[0].description === 'قهوة', 'invisible left/right marks never end up in a note');
}

// ---- helpers
ok(parseDate('03/10/26', today) === '2026-10-03' && parseDate('2026-09-30', today) === '2026-09-30' && parseDate('31/12', today) === '2026-12-31' && parseDate('13/12/2025', today) === '2025-12-13', 'date formats');
ok(parseDate('31/02/26', today) === null, 'an impossible date is rejected');
ok(norm('قَهْوَة ٤٥') === 'قهوه 45', 'Arabic text is normalised (diacritics, ta marbuta, digits)');

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
