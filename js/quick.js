// Quick add: turns pasted bank SMS or a line of typed / spoken text into transactions.
// Pure functions (no DOM) so they can be tested on their own. English and Arabic (including Egyptian wording).
//
//   parseMessages(text, { today, categories, accounts, history }) -> rows
//   row = { source, raw, type, amount, currency, date, time, description, category, sub, account,
//           confidence: 'high' | 'medium' | 'low', ready, dup, why }
//
// A row is `ready` only when the amount, category and sub-category are all known AND we are confident about them,
// so "add all ready" can never silently file something under a wild guess.

const CUR = '(?:EGP|LE|L\\.E\\.?|USD|EUR|GBP|SAR|AED|KWD|QAR|جنيه|ج\\.م)';
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'via', 'card', 'credit', 'debit', 'charged', 'pay', 'payment', 'bill', 'was', 'your', 'ending', 'using', 'available', 'limit', 'more', 'details', 'please', 'visit', 'مبلغ', 'من', 'على', 'في']);

// ------------------------------------------------------------------ text helpers
export function norm(s) {
  return String(s || '')
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')        // invisible left/right marks around Arabic text
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')            // accents
    .replace(/[ً-ٰٟـ]/g, '')                    // Arabic diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/٫/g, '.').replace(/٬/g, ',')
    .toLowerCase();
}

const tokens = (s) => norm(s).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t));

function tidyMerchant(m) {
  let s = String(m || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  if (s && s === s.toUpperCase() && /[A-Z]/.test(s)) s = s.toLowerCase().replace(/(^|[\s/&-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  return s;
}

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d, 12);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// dd/mm/yy (the usual order in Egypt and in these bank messages); swaps only when it can't be a day/month otherwise
export function parseDate(str, today) {
  const t = norm(str);
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m && validDate(+m[1], +m[2], +m[3])) return iso(+m[1], +m[2], +m[3]);
  m = /(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/.exec(t);
  if (m) {
    let d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : +today.slice(0, 4);
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (validDate(y, mo, d)) return iso(y, mo, d);
  }
  return null;
}

function shiftIso(d, n) {
  const [y, m, dd] = d.split('-').map(Number);
  const dt = new Date(y, m - 1, dd + n, 12);
  return iso(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

const WHEN = [
  [/\b(day before yesterday|2 days ago|two days ago)\b|اول امبارح|اول امس|اول من امس|قبل امس/, -2],
  [/\byesterday\b|امبارح|امس|مبارح/, -1],
  [/\b(today|tonight|this morning|just now)\b|النهارده|النهاردة|انهارده|اليوم|دلوقتي/, 0],
];

// ------------------------------------------------------------------ keyword guesses (English + Arabic / Egyptian)
// { re, cat, subs (first one that exists in the user's categories wins), vague: true when the category is a good guess but the sub is not }
const KW = [
  // subscriptions first, so "Apple.com/bill" isn't mistaken for electronics
  { re: /\bnetflix\b|نتفلكس/, cat: 'Subscriptions', subs: ['Netflix'] },
  { re: /\bspotify\b|سبوتيفاي/, cat: 'Subscriptions', subs: ['Spotify'] },
  { re: /\byoutube\b|يوتيوب/, cat: 'Subscriptions', subs: ['Youtube Premium', 'Other Services'] },
  { re: /\b(claude|anthropic)\b/, cat: 'Subscriptions', subs: ['Claude AI', 'Other Services'] },
  { re: /\b(openai|chatgpt|midjourney|github|notion|canva|adobe|dropbox|google one|disney|shahid|osn|anghami)\b|شاهد|انغامي/, cat: 'Subscriptions', subs: ['Other Services'] },
  { re: /\bicloud\b|apple\.com ?\/? ?bill|\bitunes\b|app ?store|apple\.com/, cat: 'Subscriptions', subs: ['iCloude+', 'iCloud+', 'Other Services'], vague: true },
  { re: /\bsubscription\b|\bmembership\b|اشتراك/, cat: 'Subscriptions', subs: ['Other Services'], vague: true },

  { re: /\b(vodafone|orange|etisalat|telecom egypt|recharge|top ?up|airtime)\b|\bmobile (bill|credit|balance)\b|فودافون|اورنج|اتصالات|شحن|رصيد|كارت شحن/, cat: 'Bills', subs: ['Mobile'] },
  { re: /\b(internet|wifi|wi-fi|adsl|fiber|tedata|te data)\b|انترنت|الانترنت|واي ?فاي|راوتر|(?:^| )(?:ال)?نت(?= |$)|فاتوره النت/, cat: 'Bills', subs: ['Internet'] },
  { re: /\b(electric|electricity|power bill)\b|كهرباء|الكهرباء|كهربا|النور|فاتوره النور/, cat: 'Bills', subs: ['Electricity'] },
  { re: /\bwater (bill|company)\b|\bwater\b|مياه|ميه/, cat: 'Bills', subs: ['Water'] },
  { re: /\blandline\b|تليفون ارضي|خط ارضي/, cat: 'Bills', subs: ['Landline'] },
  { re: /\bbill payment\b|\bbill\b|\binvoice\b|فاتوره|فواتير/, cat: 'Bills', subs: ['Mobile'], vague: true },

  { re: /\b(coffee|cafe|starbucks|costa|cilantro|espresso|latte|cappuccino|tim hortons|brewing)\b|قهوه|كافيه|ستاربكس|نسكافيه|شاي|عصير|كابتشينو|لاتيه|ينسون|سحلب/, cat: 'Food', subs: ['Coffee'] },
  { re: /\b(carrefour|spinneys|hyper ?one|kazyon|seoudi|metro market|gourmet|supermarket|grocer\w*|groceries|vegetables?|fruits?|bakery|milk|bread|eggs|cheese)\b|سوبر ?ماركت|ماركت|كارفور|خضار|فاكهه|عيش|لبن|بقاله|لحمه|فراخ|سمك|مكرونه|زيت|فول|اولاد رجب|خير زمان|سعودي|هايبر|بقال|جبنه|بيض/, cat: 'Food', subs: ['Groceries'] },
  { re: /\b(restaurant|dinner|lunch|breakfast|pizza|burger|kfc|mcdonalds?|mc ?donald'?s|hardees?|shawarma|koshary|kushari|talabat|elmenus|mrsool|sushi|cook ?door|food|meal|snack|ice cream)\b|مطعم|غدا|عشا|فطار|بيتزا|برجر|شاورما|كشري|طلبات|اكل|سندوتش|ساندوتش|كباب|كفته|حلويات|بقشيش|طعميه|مشويات|فرخه|حلو/, cat: 'Food', subs: ['Dining Out'] },

  { re: /\b(fuel|petrol|gasoline|gas station|benzine|mobil|shell|totalenergies|wataniya|misr petroleum|chillout|cairo oil|coop petrol|petrotrade|emarat misr)\b|بنزين|بنزينه|وقود|موبيل|وطنيه|سولار/, cat: 'Transport', subs: ['Fuel'] },
  { re: /\b(taxi|uber|careem|indrive|indriver|swvl|cab|ride)\b|تاكسي|اوبر|كريم|انسايد/, cat: 'Transport', subs: ['Taxi'] },
  { re: /\b(metro|subway|bus|microbus|train|tram|parking|toll|ticket)\b|مترو|اتوبيس|ميكروباص|قطر|موقف|جراج|بوابه|توك ?توك|تكتك|مواصلات|ترام|ركوبه|سوبر ?جيت|اتوبيس/, cat: 'Transport', subs: ['Public Transit'] },

  { re: /\b(clothes|clothing|shirt|shoes|sneakers|zara|h&m|defacto|lc waikiki|nike|adidas|jacket|jeans|dress|trousers)\b|هدوم|ملابس|حذاء|جزمه|قميص|بنطلون|لبس|شنطه|بدله|فستان|تيشيرت|شراب/, cat: 'Shopping', subs: ['Clothes'] },
  { re: /\b(phone|laptop|charger|headphones|earbuds|airpods|keyboard|mouse|monitor|tv|electronics|b\.?tech|raya|2b|samsung|apple store|noon electronics)\b|موبايل|لابتوب|شاحن|سماعه|شاشه/, cat: 'Shopping', subs: ['Electronics'] },
  { re: /\b(ikea|household|furniture|detergent|cleaning|kitchen|bedding|towels?)\b|منظفات|عفش|مطبخ|مفروشات/, cat: 'Shopping', subs: ['Household'] },
  { re: /\b(amazon|noon|jumia|aliexpress|shein|temu|ebay|souq|marketpl\w*|marketplace)\b|امازون|نون|جوميا/, cat: 'Shopping', subs: ['Household', 'Electronics', 'Clothes'], vague: true },

  { re: /\b(cinema|movie|movies|vox|imax|playstation|ps5|steam|xbox|game|games|concert|theatre|theater)\b|سينما|فيلم|العاب|لعبه|مسرح|حفله|بلايستيشن/, cat: 'Entertainment', subs: ['Cinema', 'Games'] },
  { re: /\b(pharmacy|pharma|medicine|vitamins?|ezaby|el ezaby|seif|rushdy|dawaa)\b|صيدليه|دواء|دوا|علاج|عزبي|سيف|فيتامين/, cat: 'Health', subs: ['Pharmacy'] },
  { re: /\b(doctor|clinic|hospital|dentist|dental|lab|x-?ray|checkup|check-up)\b|دكتور|عياده|مستشفي|دكتوره|تحاليل|اشعه|كشف|اسنان|نظاره|نظارات/, cat: 'Health', subs: ['Doctor Visits'] },
  { re: /\b(gym|fitness|crossfit|yoga)\b|جيم|نادي/, cat: 'Health', subs: ['Gym'] },
  { re: /\b(barber|haircut|salon|gift|donation|charity)\b|حلاق|كوافير|صالون|صدقه|زكاه|هديه|عيديه|تبرع/, cat: 'Miscellaneous', subs: ['Other'] },
  { re: /\b(course|udemy|coursera|book|books|tuition|school|university|lesson)\b|كورس|كتاب|كتب|مدرسه|جامعه|دروس|درس|مصروفات|مصاريف المدرسه|ملازم|سنتر/, cat: 'Education', subs: ['Courses', 'Books', 'Tuition'] },
  { re: /\b(flight|airline|egyptair|hotel|booking\.com|airbnb|tour|visa fee|airport)\b|طيران|فندق|رحله|سفر|مطار/, cat: 'Travel', subs: ['Flights', 'Hotels', 'Tours'] },
];

const INCOME_RE = /\b(salary|paycheck|pay ?day|bonus|refund(?:ed)?|reimburs\w*|income|received|deposit(?:ed)?|credited|got paid|freelance|cashback)\b|مرتب|راتب|قبضت|استلمت|مكافاه|(?:^|\s)(?:ال)?دخل(?:ي)?(?=\s|$)|دخلت (?:ال)?(?:فلوس|مبلغ|مرتب)|ايراد|استرجاع|رجع لي|تحويل وارد/;
const CASH_RE = /\b(cash|in cash)\b|\bكاش\b|نقدي|نقدا|كاش/;
const CARD_RE = /\b(card|visa|mastercard|master card|credit|apple ?pay|debit)\b|كارت|فيزا|ماستر|كريدت|بطاق/;

// ------------------------------------------------------------------ history: what the user usually files things under
function buildHistory(history) {
  const byToken = new Map();   // token -> Map(key -> count)
  const exact = new Map();     // normalized description -> Map(key -> count)
  const catSubs = new Map();   // category -> Map(sub -> count)
  const bump = (m, k, key) => { const inner = m.get(k) || new Map(); inner.set(key, (inner.get(key) || 0) + 1); m.set(k, inner); };
  for (const e of history || []) {
    if (e.type !== 'Expense' || !e.category) continue;
    const key = e.category + '\u0001' + e.sub;
    bump(catSubs, e.category, e.sub);
    const d = norm(e.description).replace(/\s+/g, ' ').trim();
    if (d) bump(exact, d, key);
    for (const t of new Set(tokens(e.description))) bump(byToken, t, key);
  }
  return { byToken, exact, catSubs };
}

function bestOf(m) {
  let best = null, total = 0;
  for (const [k, n] of m) { total += n; if (!best || n > best[1]) best = [k, n]; }
  return best ? { key: best[0], n: best[1], total, share: best[1] / total } : null;
}

function historyGuess(h, text) {
  const d = norm(text).replace(/\s+/g, ' ').trim();
  const ex = h.exact.get(d);
  if (ex) { const b = bestOf(ex); return { ...b, exact: true }; }
  const tally = new Map();
  for (const t of new Set(tokens(text))) {
    for (const [tok, keys] of h.byToken) {
      const hit = tok === t || (t.length >= 5 && tok.length >= 5 && (tok.startsWith(t) || t.startsWith(tok)));   // bank messages cut merchant names short
      if (!hit) continue;
      for (const [k, n] of keys) tally.set(k, (tally.get(k) || 0) + n);
    }
  }
  return tally.size ? bestOf(tally) : null;
}

// ------------------------------------------------------------------ resolving against the user's real categories
function findCat(categories, name) {
  const low = String(name).toLowerCase();
  return categories.order.find((c) => c.toLowerCase() === low) || null;
}

function resolveKw(categories, kw, h) {
  const cat = findCat(categories, kw.cat);
  if (!cat) return null;
  const list = categories.map[cat] || [];
  for (const s of kw.subs) {
    const hit = list.find((x) => x.toLowerCase() === s.toLowerCase());
    if (hit) return { category: cat, sub: hit, subKnown: true };
  }
  // category right, sub unknown: use the one this person uses most in that category, else the first
  const used = h.catSubs.get(cat);
  const top = used ? bestOf(used) : null;
  return { category: cat, sub: top && list.includes(top.key) ? top.key : (list[0] || ''), subKnown: false };
}

function decide(text, ctx, h) {
  const hist = historyGuess(h, text);
  const split = (k) => { const [category, sub] = k.split('\u0001'); return { category, sub }; };
  const valid = (k) => { const { category, sub } = split(k); const c = findCat(ctx.categories, category); return c && (ctx.categories.map[c] || []).some((x) => x.toLowerCase() === String(sub).toLowerCase()) ? { category: c, sub: ctx.categories.map[c].find((x) => x.toLowerCase() === String(sub).toLowerCase()) } : null; };

  if (hist && hist.exact && valid(hist.key)) return { ...valid(hist.key), confidence: 'high', why: 'same note as before' };

  const t = norm(text);
  const kw = KW.find((k) => k.re.test(t));
  const kwRes = kw ? resolveKw(ctx.categories, kw, h) : null;

  if (kwRes && kwRes.subKnown && !kw.vague) return { category: kwRes.category, sub: kwRes.sub, confidence: 'high', why: 'recognised the name' };
  if (hist && hist.n >= 2 && hist.share >= 0.7 && valid(hist.key)) return { ...valid(hist.key), confidence: 'high', why: 'matches your past entries' };
  if (hist && hist.share >= 0.6 && valid(hist.key)) return { ...valid(hist.key), confidence: 'medium', why: 'looks like an earlier entry' };
  if (kwRes) return { category: kwRes.category, sub: kwRes.sub, confidence: 'medium', why: kwRes.subKnown ? 'best guess' : 'category guess, please check the sub-category' };
  return { category: '', sub: '', confidence: 'low', why: '' };
}

// ------------------------------------------------------------------ number words ("forty five", "two hundred and fifty")
// Speech engines sometimes hand back words instead of digits. A lone small number ("two coffees") is left alone so it
// can't be mistaken for the price; anything from eleven up, or with tens / hundreds / thousands, is converted.
const W_UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const W_TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

// ------------------------------------------------------------------ accounts
function pickAccount(text, ctx, source) {
  const live = (ctx.accounts || []).filter((a) => !a.archived);
  if (!live.length) return '';
  const t = norm(text);
  for (const a of live) {
    const n = norm(a.name);
    if (n.length >= 3 && new RegExp('(^|[^\\p{L}\\p{N}])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}\\p{N}])', 'u').test(t)) return a.name;
  }
  if (CASH_RE.test(t)) { const c = live.find((a) => a.type === 'cash'); if (c) return c.name; }
  if (source === 'sms' || CARD_RE.test(t)) { const c = live.find((a) => a.type === 'card'); if (c) return c.name; }
  return '';
}

// ------------------------------------------------------------------ bank SMS
const SMS_SPEND = new RegExp(
  '(?:charged|purchase|purchased|spent|paid|debited|withdrawn|withdrawal)\\s+(?:for|of|with|amount)?\\s*(?:' + CUR + '\\s*)?([\\d,]+(?:\\.\\d{1,2})?)\\s*(' + CUR + ')?' +
  '(?:\\s+(?:at|in|to|from)\\s+(.+?))?\\s+on\\s+(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4})(?:\\s+at\\s+(\\d{1,2}:\\d{2}))?', 'is');
const SMS_CREDIT = new RegExp(
  '(?:credited|refund(?:ed)?|deposit(?:ed)?|received)\\s+(?:with|for|of|amount)?\\s*(?:' + CUR + '\\s*)?([\\d,]+(?:\\.\\d{1,2})?)\\s*(' + CUR + ')?' +
  '(?:\\s+(?:from|by|at)\\s+(.+?))?(?:\\s+on\\s+(\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{2,4})(?:\\s+at\\s+(\\d{1,2}:\\d{2}))?)?(?:[.,]|\\s+Available|\\s+Your|$)', 'is');

function currencyOf(full, after) {
  const c = (/\b(EGP|LE|USD|EUR|GBP|SAR|AED|KWD|QAR)\b/i.exec(full) || [])[1];
  const a = (after || '').toUpperCase().replace(/\./g, '');
  return (c || a || 'EGP').toUpperCase().replace('LE', 'EGP');
}

function parseSms(chunk, ctx, h) {
  const flat = chunk.replace(/\s+/g, ' ').trim();
  let m = SMS_SPEND.exec(flat);
  let type = 'Expense';
  if (!m) { m = SMS_CREDIT.exec(flat); type = 'Income'; }
  if (!m) return null;
  const amount = Number(m[1].replace(/,/g, ''));
  if (!(amount > 0)) return null;
  const merchant = tidyMerchant(m[3] || '');
  const date = (m[4] && parseDate(m[4], ctx.today)) || ctx.today;
  const row = {
    source: 'sms', raw: chunk.trim(), type, amount, currency: currencyOf(flat.slice(Math.max(0, m.index - 4), m.index + m[0].length), m[2]),
    date, time: m[5] || '', description: merchant || (type === 'Income' ? 'Refund' : ''), account: pickAccount(flat, ctx, 'sms'),
  };
  if (type === 'Income') { Object.assign(row, { category: 'Income', sub: 'Income', confidence: 'high', why: 'money coming in' }); return row; }
  Object.assign(row, decide(merchant || flat, ctx, h));
  return row;
}

// ------------------------------------------------------------------ spoken / typed text: tokens, number words, several purchases in one sentence
// A token keeps the person's own spelling (raw, used for the note) next to a normalised form (n, used to recognise things).
const mkTok = (raw) => ({ raw, n: norm(raw) });

function tokenize(line) {
  return String(line)
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/([،,؛;])(?=\s|$)/g, ' $1 ')                 // a comma between phrases is a separator; one inside 1,250 is not
    .trim().split(/\s+/).filter(Boolean).map(mkTok);
}

// ---- English number words (what an English speech engine may return)
const isEnNum = (w) => w in W_UNITS || w in W_TENS || w === 'hundred' || w === 'thousand';

function evalEnglish(words) {
  let total = 0, cur = 0, big = false;
  for (const w of words) {
    if (w in W_UNITS) cur += W_UNITS[w];
    else if (w in W_TENS) { cur += W_TENS[w]; big = true; }
    else if (w === 'hundred') { cur = (cur || 1) * 100; big = true; }
    else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; big = true; }
  }
  return { value: total + cur, big };
}

function englishRunAt(toks, i) {
  let j = i;
  if (toks[j].n === 'a' && j + 1 < toks.length && (toks[j + 1].n === 'hundred' || toks[j + 1].n === 'thousand')) j++;
  const words = [];
  while (j < toks.length) {
    const w = toks[j].n;
    if (isEnNum(w)) { words.push(w); j++; }
    else if (w === 'and' && words.length && j + 1 < toks.length && isEnNum(toks[j + 1].n)) j++;
    else break;
  }
  if (!words.length) return null;
  const { value, big } = evalEnglish(words);
  return { end: j, numbers: [value], convert: big || value > 10 };
}

// ---- Egyptian / Arabic number words (spellings as they are after norm())
const AR_UNIT = { واحد: 1, واحده: 1, اتنين: 2, اثنين: 2, تنين: 2, ثنين: 2, تلاته: 3, ثلاثه: 3, تلات: 3, ثلاث: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6, سبعه: 7, سبع: 7, تمانيه: 8, ثمانيه: 8, تمان: 8, ثمان: 8, تسعه: 9, تسع: 9, عشره: 10, عشر: 10 };
const AR_TEEN = { احداشر: 11, حداشر: 11, اتناشر: 12, اطناشر: 12, تلتاشر: 13, تلاتاشر: 13, اربعتاشر: 14, خمستاشر: 15, ستاشر: 16, سبعتاشر: 17, تمنتاشر: 18, تمانتاشر: 18, تسعتاشر: 19 };
const AR_TENS = { عشرين: 20, عشرون: 20, تلاتين: 30, ثلاثين: 30, ثلاثون: 30, اربعين: 40, اربعون: 40, خمسين: 50, خمسون: 50, ستين: 60, ستون: 60, سبعين: 70, سبعون: 70, تمانين: 80, ثمانين: 80, ثمانون: 80, تسعين: 90, تسعون: 90 };
const AR_HUND = { ميه: 100, مايه: 100, مائه: 100, مئه: 100, ميت: 100, ميتين: 200, مئتين: 200, متين: 200, مائتين: 200, تلتميه: 300, تلاتميه: 300, ثلاثميه: 300, ثلاثمائه: 300, تلتمائه: 300, ربعميه: 400, اربعميه: 400, اربعمائه: 400, خمسميه: 500, خمسمائه: 500, ستميه: 600, ستمائه: 600, سبعميه: 700, سبعمائه: 700, تمنميه: 800, تمانميه: 800, ثمانميه: 800, ثمانمائه: 800, تسعميه: 900, تسعمائه: 900 };
const AR_K = new Set(['الف', 'الفا', 'الفين', 'الاف', 'تلاف']);
const isArNum = (w) => w in AR_UNIT || w in AR_TEEN || w in AR_TENS || w in AR_HUND || AR_K.has(w);
function arBase(n) {
  if (isArNum(n)) return n;
  const m = /^[بلوف](.+)$/.exec(n);                                    // بخمسين، وخمسين، لتمانين
  return m && isArNum(m[1]) ? m[1] : null;
}

// Reads a run like "ميه وخمسين" (150) or "تلات تلاف وخمسميه" (3500). Numbers that don't follow the usual big-to-small order
// ("خمسين وتمانين") are two separate prices.
// iOS writes "أربعمية وتلاتين" as the word "اربع" followed by the digits 130 (it converted "مية وتلاتين" but left the 4 as a
// word), so a small unit followed by 100-199 means unit x 100 + the rest: اربع 130 = 430, الف واربع 105 = 1405.
function evalArabic(words) {
  const out = [];
  let total = 0, cur = 0, started = false, lastMag = 99, prevVal = 0;
  const flush = () => { if (started) out.push(total + cur); total = 0; cur = 0; started = false; lastMag = 99; prevVal = 0; };
  for (const w of words) {
    if (typeof w === 'number') {                                   // digits from the speech engine
      if (lastMag === 1 && prevVal >= 2 && prevVal <= 9 && w >= 100 && w < 200 && cur >= prevVal) {
        cur = cur - prevVal + prevVal * 100 + (w - 100); lastMag = 3; prevVal = w; continue;
      }
      const m = w >= 100 ? 3 : w >= 10 ? 2 : 1;
      if (started && m >= lastMag && !(lastMag === 1 && prevVal < 10 && m === 2)) flush();
      cur += w; started = true; lastMag = m; prevVal = w;
      continue;
    }
    if (AR_K.has(w)) {
      if (started && lastMag === 4) flush();
      total += w === 'الفين' ? 2000 : (cur || 1) * 1000;
      cur = 0; started = true; lastMag = 4; prevVal = 1000;
      continue;
    }
    const v = AR_UNIT[w] ?? AR_TEEN[w] ?? AR_TENS[w] ?? AR_HUND[w];
    const mag = w in AR_HUND ? 3 : w in AR_TENS ? 2 : 1;
    const unitThenTens = lastMag === 1 && prevVal < 10 && mag === 2;
    if (started && mag >= lastMag && !unitThenTens) flush();
    cur += v; started = true; lastMag = mag; prevVal = v;
  }
  flush();
  return out;
}

const isDigitGroup = (n) => /^\d{1,3}$/.test(n);

function arabicRunAt(toks, i) {
  let j = i;
  const words = [];
  while (j < toks.length) {
    const b = arBase(toks[j].n);
    if (b) { words.push(b); j++; continue; }
    const afterWord = words.length && typeof words[words.length - 1] === 'string';
    if (toks[j].n === 'و' && words.length && j + 1 < toks.length && (arBase(toks[j + 1].n) || (afterWord && isDigitGroup(toks[j + 1].n)))) { j++; continue; }
    if (afterWord && isDigitGroup(toks[j].n)) { words.push(Number(toks[j].n)); j++; continue; }   // digits right after a number word belong to the same price
    break;
  }
  if (!words.length) return null;
  const numbers = evalArabic(words);
  return { end: j, numbers, convert: numbers.length > 1 || numbers[0] > 10 };   // a lone 1-10 is a quantity ("اتنين قهوة")
}

// Turns number words into digit tokens; leaves quantities such as "two coffees" alone.
function convertNumbers(tokens) {
  const toks = [];
  for (const t of tokens) {
    const m = /^([a-z]+)-([a-z]+)$/.exec(t.n);
    if (m && isEnNum(m[1]) && isEnNum(m[2])) toks.push(mkTok(m[1]), mkTok(m[2])); else toks.push(t);
  }
  const out = [];
  for (let i = 0; i < toks.length;) {
    const run = englishRunAt(toks, i) || arabicRunAt(toks, i);
    if (run && run.convert) { run.numbers.forEach((v) => out.push(mkTok(String(v)))); i = run.end; continue; }
    if (run) { for (let k = i; k < run.end; k++) out.push(toks[k]); i = run.end; continue; }
    out.push(toks[i]); i++;
  }
  // "2 الف" / "2 thousand" written with digits
  const merged = [];
  for (let i = 0; i < out.length; i++) {
    if (/^\d+(\.\d+)?$/.test(out[i].n) && i + 1 < out.length && (out[i + 1].n === 'الف' || out[i + 1].n === 'الاف')) { merged.push(mkTok(String(Number(out[i].n) * 1000))); i++; }
    else merged.push(out[i]);
  }
  return merged;
}

export function wordsToDigits(text) {
  return convertNumbers(tokenize(text)).map((t) => t.raw).join(' ');
}

// ---- recognising which account / wallet was mentioned
const TRANSLIT = { vodafone: 'فودافون', orange: 'اورنج', etisalat: 'اتصالات', cash: 'كاش', visa: 'فيزا', credit: 'كريدت', card: 'كارت', instapay: 'انستاباي', fawry: 'فوري', we: 'وي', wallet: 'محفظه', bank: 'بنك', travel: 'سفر', mastercard: 'ماستر' };
const TYPE_ALIASES = {
  cash: ['cash', 'كاش', 'نقدي', 'نقدا', 'كاش ماني', 'من جيبي'],
  card: ['credit card', 'card', 'visa', 'mastercard', 'كارت', 'الكارت', 'فيزا', 'كريدت', 'ماستر', 'بطاقه', 'البطاقه'],
};

function accountAliases(a) {
  const base = norm(a.name).trim();
  const named = new Set([base]);
  const tr = base.split(/\s+/).map((w) => TRANSLIT[w] || w).join(' ');
  named.add(tr);
  return { named: [...named].filter((x) => x.length >= 2), byType: TYPE_ALIASES[a.type === 'cash' ? 'cash' : 'card'] };
}

const matchesWord = (tok, alias) => tok === alias || tok === 'ال' + alias || tok === 'بال' + alias || tok === 'ب' + alias || tok === 'و' + alias || tok === 'وال' + alias || tok === 'لل' + alias || tok === 'من' + alias;
const FROM_PREP = new Set(['من', 'ب', 'في', 'علي', 'على', 'by', 'from', 'with', 'using', 'via', 'on', 'in', 'through', 'عن', 'بواسطه']);

// finds account mentions in a token list: [{ start, end, account, specific }]
function findAccounts(toks, ctx) {
  const live = (ctx.accounts || []).filter((a) => !a.archived);
  const found = [];
  const tryAlias = (alias, a, specific) => {
    const parts = alias.split(/\s+/);
    for (let i = 0; i + parts.length <= toks.length; i++) {
      if (parts.every((p, k) => matchesWord(toks[i + k].n, p))) {
        let start = i;
        if (start > 0 && FROM_PREP.has(toks[start - 1].n)) start--;
        found.push({ start, end: i + parts.length, account: a.name, specific, len: parts.length });
      }
    }
  };
  live.forEach((a) => { const al = accountAliases(a); al.named.forEach((x) => tryAlias(x, a, true)); });
  const firstOf = (type) => live.find((a) => a.type === type);
  ['cash', 'card'].forEach((type) => { const a = firstOf(type); if (a) TYPE_ALIASES[type].forEach((x) => tryAlias(x, a, false)); });
  // overlapping hits: prefer the longer / named alias
  found.sort((x, y) => (y.len - x.len) || (Number(y.specific) - Number(x.specific)) || (x.start - y.start));
  const kept = [];
  for (const f of found) if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  return kept.sort((x, y) => x.start - y.start);
}

export function defaultAccount(ctx) {
  const live = (ctx.accounts || []).filter((a) => !a.archived);
  return (live.find((a) => a.type === 'card') || live[0] || {}).name || '';
}

// ---- splitting one sentence into several purchases
const CONNECT = new Set(['و', 'وبعدين', 'بعدين', 'وكمان', 'كمان', 'وبرضه', 'برضه', 'ثم', 'وايضا', 'ايضا', 'وبعد', 'and', 'then', 'also', 'plus', '&', '،', ',', '؛', ';', 'والتاني', 'تاني']);
const NOT_GLUED = new Set(['وقود', 'واي', 'وطنيه', 'واحد', 'واحده', 'والد', 'والده', 'وجبه', 'وجبات', 'ورق', 'وردي', 'ورده', 'وفر', 'وصله', 'وصلات', 'وزن', 'وقت', 'وكاله', 'ويفر', 'وي']);
const CURRENCY_TOK = new Set(['egp', 'le', 'l.e', 'l.e.', 'جنيه', 'جنيها', 'جنية', 'جنيهات', 'ج', 'ج.م', 'pound', 'pounds', 'bucks', 'usd', 'eur', 'gbp', 'sar', 'aed']);
const FILLER = new Set(['دفعت', 'صرفت', 'اشتريت', 'جبت', 'حطيت', 'حطيتلي', 'ضربت', 'عبيت', 'خدت', 'اخدت', 'حاسبت', 'عملت', 'كلت', 'شربت', 'ركبت', 'ملات', 'انا', 'بقي', 'يعني', 'تقريبا', 'حوالي', 'دفعنا', 'صرفنا', 'paid', 'spent', 'bought', 'buy', 'got', 'i', "i've", 'ive', 'my', 'was', 'cost', 'costs', 'for', 'on', 'at', 'in', 'the', 'a', 'an', 'to', 'في', 'علي', 'على', 'من', 'عشان', 'ل', 'ب', 'بتاع', 'عن', 'ده', 'دي', 'كله', 'كلهم', 'كلها', 'الكل', 'all', 'everything', 'both', 'مع', 'جوا']);
const GLOBAL_ALL = new Set(['كله', 'كلهم', 'كلها', 'الكل', 'all', 'everything', 'both']);
const DATE_TEXT = [
  [/(?:^| )(?:اول امبارح|اول من امس|قبل امس|day before yesterday|2 days ago|two days ago)(?= |$)/, -2],
  [/(?:^| )(?:yesterday|امبارح|مبارح|امس)(?= |$)/, -1],
  [/(?:^| )(?:today|tonight|this morning|just now|النهارده|النهارده|انهارده|اليوم|دلوقتي)(?= |$)/, 0],
];
const DATE_NUM = /(?:^| )((?:\d{4}-\d{1,2}-\d{1,2})|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(?:\d{1,2}\.\d{1,2}\.\d{2,4}))(?= |$)/;
const PRICE = /^\d[\d,]*(?:\.\d+)?k?$/i;

// removes the part of the token list that a pattern matches in the joined normalised text; returns { toks, m }
function takeMatch(toks, re) {
  const joined = toks.map((t) => t.n).join(' ');
  const m = re.exec(joined);
  if (!m) return { toks, m: null };
  const s = m.index + (m[0].startsWith(' ') ? 1 : 0), e = m.index + m[0].length;
  const out = [];
  let pos = 0;
  toks.forEach((t) => { const a = pos, b = pos + t.n.length; pos = b + 1; if (!(a < e && s < b)) out.push(t); });
  return { toks: out, m };
}

const isMoney = (t) => PRICE.test(t.n) && !/\//.test(t.n);

// Indexes of tokens that are prices. A small whole number right before a word, with another price still to come, is a
// quantity ("2 قهوة 50", "two coffees 45"), not a price.
function priceAnchors(toks) {
  const idx = [];
  toks.forEach((t, i) => { if (isMoney(t)) idx.push(i); });
  return idx.filter((i, k) => {
    const v = Number(toks[i].n.replace(/,/g, ''));
    const next = toks[i + 1];
    const laterPrice = idx.slice(k + 1).length > 0;
    const quantity = Number.isInteger(v) && v <= 10 && laterPrice && next && !CURRENCY_TOK.has(next.n) && !CONNECT.has(next.n) && !isMoney(next);
    return !quantity;
  });
}

const isGlued = (t) => t.n.length > 2 && t.n[0] === 'و' && !NOT_GLUED.has(t.n) && !isMoney(t);
const isConnector = (t) => CONNECT.has(t.n);

function splitPurchases(toks, ctx) {
  const anchors = priceAnchors(toks);
  if (anchors.length <= 1) return [toks];
  const acc = findAccounts(toks, ctx);
  const inAcc = (i) => acc.some((a) => i >= a.start && i < a.end);
  // does the sentence start with the item ("قهوة بخمسين") or with the price ("دفعت خمسين في القهوة")?
  const lead = toks.slice(0, anchors[0]).filter((t, i) => !FILLER.has(t.n) && !CONNECT.has(t.n) && !CURRENCY_TOK.has(t.n) && !inAcc(i) && !DATE_TEXT.some(([re]) => re.test(t.n)) && t.n.length > 1);
  const itemFirst = lead.length > 0;
  const cuts = [];                                           // [index where the next purchase starts, replacement token or null]
  for (let k = 0; k + 1 < anchors.length; k++) {
    const a = anchors[k], b = anchors[k + 1];
    let j = a + 1;
    while (j < b && (CURRENCY_TOK.has(toks[j].n) || inAcc(j))) j++;      // "50 جنيه من الكاش" stays with the first purchase
    let cut = null;
    for (let x = b - 1; x >= j; x--) {
      if (isConnector(toks[x])) { cut = [x + 1, null]; break; }
      if (isGlued(toks[x])) { cut = [x, mkTok(toks[x].raw.replace(/^و/, ''))]; break; }
    }
    if (!cut) cut = [itemFirst ? j : b, null];
    cuts.push(cut);
  }
  const chunks = [];
  let from = 0;
  cuts.forEach(([at, repl]) => {
    chunks.push(toks.slice(from, at - (repl ? 0 : 0)));
    from = at;
    if (repl) { toks = toks.slice(); toks[at] = repl; }
  });
  chunks.push(toks.slice(from));
  return chunks.map((c) => c.filter((t, i) => !(CONNECT.has(t.n) && (i === 0 || i === c.length - 1)))).filter((c) => c.some(isMoney));
}

function capitalise(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

function parseChunk(ctoks, ctx, h, g) {
  let toks = ctoks;
  // date: this purchase's own words win, otherwise the one said at the start of the sentence
  let date = g.date;
  const own = takeMatch(toks, DATE_NUM);
  if (own.m) { const d = parseDate(own.m[1], ctx.today); if (d) { date = d; toks = own.toks; } }
  for (const [re, off] of DATE_TEXT) { const r = takeMatch(toks, re); if (r.m) { date = shiftIso(ctx.today, off); toks = r.toks; break; } }

  const anchorIdx = priceAnchors(toks)[0] ?? toks.findIndex(isMoney);
  if (anchorIdx < 0) return null;
  const at = toks[anchorIdx].n.replace(/,/g, '');
  const amount = Math.round(Number(at.replace(/k$/i, '')) * (/k$/i.test(at) ? 1000 : 1) * 100) / 100;
  if (!(amount > 0)) return null;

  // account / wallet mentioned for this purchase
  const accs = findAccounts(toks, ctx);
  const acc = accs[0];
  const drop = new Set([anchorIdx]);
  accs.forEach((a) => { for (let i = a.start; i < a.end; i++) drop.add(i); });
  let currency = 'EGP';
  toks.forEach((t, i) => {
    if (CURRENCY_TOK.has(t.n)) { drop.add(i); if (/^(usd|eur|gbp|sar|aed)$/.test(t.n)) currency = t.n.toUpperCase(); }
  });
  const kept = toks.filter((t, i) => !drop.has(i));
  const words = kept.filter((t) => !FILLER.has(t.n) && !CONNECT.has(t.n));
  const noteRaw = words.map((t) => t.raw).join(' ').replace(/[،,؛;.]+$/g, '').trim();
  const nText = words.map((t) => t.n).join(' ');
  const whole = toks.map((t) => t.n).join(' ');
  const isIncome = INCOME_RE.test(whole);

  const row = {
    source: 'text', raw: toks.map((t) => t.raw).join(' '), type: isIncome ? 'Income' : 'Expense', amount, currency, date, time: '',
    description: capitalise(noteRaw), account: acc ? acc.account : (g.account || defaultAccount(ctx)),
  };
  if (isIncome) { Object.assign(row, { category: 'Income', sub: 'Income', confidence: 'high', why: 'money coming in' }); return row; }
  Object.assign(row, decide(nText || whole, ctx, h));
  return row;
}

// One typed or spoken line -> one or more purchases.
function parseUtterance(line, ctx, h) {
  const toks = convertNumbers(tokenize(line));
  if (!toks.some(isMoney)) return [];
  // said once for the whole sentence: the day before the first price, and "all of it from cash"
  const firstPrice = priceAnchors(toks)[0] ?? toks.findIndex(isMoney);
  const preamble = toks.slice(0, Math.max(0, firstPrice));
  let date = ctx.today;
  let pre = takeMatch(preamble, DATE_NUM);
  if (pre.m) { const d = parseDate(pre.m[1], ctx.today); if (d) date = d; }
  for (const [re, off] of DATE_TEXT) { const r = takeMatch(preamble, re); if (r.m) { date = shiftIso(ctx.today, off); break; } }
  const global = { date, account: '' };
  if (toks.some((t) => GLOBAL_ALL.has(t.n))) { const a = findAccounts(toks, ctx)[0]; if (a) global.account = a.account; }
  return splitPurchases(toks, ctx).map((c) => parseChunk(c, ctx, h, global)).filter(Boolean);
}

// ------------------------------------------------------------------ public entry point
function splitChunks(text) {
  const base = String(text || '').replace(/\r/g, '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const c of base) {
    const parts = c.split(/(?=(?:^|\s)Your (?:credit|debit|prepaid) card)/i).map((s) => s.trim()).filter(Boolean);
    out.push(...(parts.length > 1 ? parts : [c]));
  }
  return out;
}

export function parseMessages(text, ctx) {
  const h = buildHistory(ctx.history);
  const rows = [];
  for (const chunk of splitChunks(text)) {
    const sms = parseSms(chunk, ctx, h);
    if (sms) { rows.push(sms); continue; }
    // not a bank message: every non-empty line is its own entry
    for (const line of chunk.split('\n').map((s) => s.trim()).filter(Boolean)) {
      rows.push(...parseUtterance(line, ctx, h));
    }
  }
  // already logged? same day, same amount, same kind (you may have typed it in before the SMS arrived)
  const seen = new Map();
  for (const e of ctx.history || []) {
    const k = [e.date, Number(e.amount).toFixed(2), e.type].join('|');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  for (const r of rows) {
    const k = [r.date, Number(r.amount).toFixed(2), r.type].join('|');
    r.dup = (seen.get(k) || 0) > 0;
    if (r.dup) seen.set(k, seen.get(k) - 1);   // two identical SMS only match two existing entries
    r.ready = !r.dup && r.confidence === 'high' && !!r.amount && (r.type === 'Income' || (!!r.category && !!r.sub)) && r.currency === 'EGP';
  }
  return rows;
}
