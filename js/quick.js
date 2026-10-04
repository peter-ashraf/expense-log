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
  { re: /\b(internet|wifi|wi-fi|adsl|fiber|tedata|te data)\b|انترنت|الانترنت|واي ?فاي/, cat: 'Bills', subs: ['Internet'] },
  { re: /\b(electric|electricity|power bill)\b|كهرباء|الكهرباء/, cat: 'Bills', subs: ['Electricity'] },
  { re: /\bwater (bill|company)\b|\bwater\b|مياه|ميه/, cat: 'Bills', subs: ['Water'] },
  { re: /\blandline\b|تليفون ارضي|خط ارضي/, cat: 'Bills', subs: ['Landline'] },
  { re: /\bbill payment\b|\bbill\b|\binvoice\b|فاتوره|فواتير/, cat: 'Bills', subs: ['Mobile'], vague: true },

  { re: /\b(coffee|cafe|starbucks|costa|cilantro|espresso|latte|cappuccino|tim hortons|brewing)\b|قهوه|كافيه|ستاربكس|نسكافيه/, cat: 'Food', subs: ['Coffee'] },
  { re: /\b(carrefour|spinneys|hyper ?one|kazyon|seoudi|metro market|gourmet|supermarket|grocer\w*|groceries|vegetables?|fruits?|bakery|milk|bread|eggs|cheese)\b|سوبر ?ماركت|ماركت|كارفور|خضار|فاكهه|عيش|لبن|بقاله|هايبر|بقال|جبنه|بيض/, cat: 'Food', subs: ['Groceries'] },
  { re: /\b(restaurant|dinner|lunch|breakfast|pizza|burger|kfc|mcdonalds?|mc ?donald'?s|hardees?|shawarma|koshary|kushari|talabat|elmenus|mrsool|sushi|cook ?door|food|meal|snack|ice cream)\b|مطعم|غدا|عشا|فطار|بيتزا|برجر|شاورما|كشري|طلبات|اكل/, cat: 'Food', subs: ['Dining Out'] },

  { re: /\b(fuel|petrol|gasoline|gas station|benzine|mobil|shell|totalenergies|wataniya|misr petroleum|chillout|cairo oil|coop petrol|petrotrade|emarat misr)\b|بنزين|بنزينه|وقود|موبيل|وطنيه|سولار/, cat: 'Transport', subs: ['Fuel'] },
  { re: /\b(taxi|uber|careem|indrive|indriver|swvl|cab|ride)\b|تاكسي|اوبر|كريم|انسايد/, cat: 'Transport', subs: ['Taxi'] },
  { re: /\b(metro|subway|bus|microbus|train|tram|parking|toll|ticket)\b|مترو|اتوبيس|ميكروباص|قطر|موقف|جراج|بوابه/, cat: 'Transport', subs: ['Public Transit'] },

  { re: /\b(clothes|clothing|shirt|shoes|sneakers|zara|h&m|defacto|lc waikiki|nike|adidas|jacket|jeans|dress|trousers)\b|هدوم|ملابس|حذاء|جزمه|قميص|بنطلون/, cat: 'Shopping', subs: ['Clothes'] },
  { re: /\b(phone|laptop|charger|headphones|earbuds|airpods|keyboard|mouse|monitor|tv|electronics|b\.?tech|raya|2b|samsung|apple store|noon electronics)\b|موبايل|لابتوب|شاحن|سماعه|شاشه/, cat: 'Shopping', subs: ['Electronics'] },
  { re: /\b(ikea|household|furniture|detergent|cleaning|kitchen|bedding|towels?)\b|منظفات|عفش|مطبخ|مفروشات/, cat: 'Shopping', subs: ['Household'] },
  { re: /\b(amazon|noon|jumia|aliexpress|shein|temu|ebay|souq|marketpl\w*|marketplace)\b|امازون|نون|جوميا/, cat: 'Shopping', subs: ['Household', 'Electronics', 'Clothes'], vague: true },

  { re: /\b(cinema|movie|movies|vox|imax|playstation|ps5|steam|xbox|game|games|concert|theatre|theater)\b|سينما|فيلم|العاب|لعبه/, cat: 'Entertainment', subs: ['Cinema', 'Games'] },
  { re: /\b(pharmacy|pharma|medicine|vitamins?|ezaby|el ezaby|seif|rushdy|dawaa)\b|صيدليه|دواء|علاج|عزبي|سيف/, cat: 'Health', subs: ['Pharmacy'] },
  { re: /\b(doctor|clinic|hospital|dentist|dental|lab|x-?ray|checkup|check-up)\b|دكتور|عياده|مستشفي|دكتوره|تحاليل|اشعه/, cat: 'Health', subs: ['Doctor Visits'] },
  { re: /\b(gym|fitness|crossfit|yoga)\b|جيم|نادي/, cat: 'Health', subs: ['Gym'] },
  { re: /\b(course|udemy|coursera|book|books|tuition|school|university|lesson)\b|كورس|كتاب|كتب|مدرسه|جامعه|دروس|درس/, cat: 'Education', subs: ['Courses', 'Books', 'Tuition'] },
  { re: /\b(flight|airline|egyptair|hotel|booking\.com|airbnb|tour|visa fee|airport)\b|طيران|فندق|رحله|سفر|مطار/, cat: 'Travel', subs: ['Flights', 'Hotels', 'Tours'] },
];

const INCOME_RE = /\b(salary|paycheck|pay ?day|bonus|refund(?:ed)?|reimburs\w*|income|received|deposit(?:ed)?|credited|got paid|freelance|cashback)\b|مرتب|راتب|قبضت|استلمت|مكافاه|دخل|ايراد|استرجاع|رجع لي|تحويل وارد/;
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

// ------------------------------------------------------------------ free text ("coffee 45", "taxi 80 cash", "قهوة ٤٥ امبارح")
function parseText(line, ctx, h) {
  let t = norm(line);
  let date = ctx.today;
  // explicit date first, so its digits are not mistaken for the amount
  const dm = /(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(t);
  if (dm) { const d = parseDate(dm[0], ctx.today); if (d) { date = d; t = t.replace(dm[0], ' '); } }
  for (const [re, off] of WHEN) if (re.test(t)) { date = shiftIso(ctx.today, off); t = t.replace(re, ' '); break; }

  const num = /(\d[\d,]*(?:\.\d+)?)\s*(k|الف)?(?![\d])/.exec(t.replace(new RegExp('(^|\\s)' + CUR.replace('\\.', '\\.') + '(?=\\s|$)', 'gi'), ' '));
  if (!num) return null;
  let amount = Number(num[1].replace(/,/g, ''));
  if (num[2]) amount *= 1000;
  if (!(amount > 0)) return null;
  const rest = (t.slice(0, num.index) + ' ' + t.slice(num.index + num[0].length))
    .replace(new RegExp('(^|\\s)' + CUR + '(?=\\s|$)', 'gi'), ' ')
    .replace(/\b(spent|paid|bought|buy|for|on|at|in|the|a|an|i|my|ive|i've|was|cost|costs)\b/g, ' ')
    .replace(/(^|\s)(صرفت|دفعت|اشتريت|على|في|من|عشان)(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const isIncome = INCOME_RE.test(t);
  const description = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
  const row = { source: 'text', raw: line.trim(), type: isIncome ? 'Income' : 'Expense', amount, currency: 'EGP', date, time: '', description, account: pickAccount(line, ctx, 'text') };
  if (isIncome) { Object.assign(row, { category: 'Income', sub: 'Income', confidence: 'high', why: 'money coming in' }); return row; }
  // keep the person's own wording (original script) for the note; use the normalised text only to recognise it
  Object.assign(row, decide(rest || t, ctx, h));
  row.description = originalNote(line, rest);
  return row;
}

// the note the user would expect to see: their own words minus the number, currency, date and account words
function originalNote(line, rest) {
  let s = String(line)
    .replace(/[٠-٩۰-۹]/g, (d) => String(d.charCodeAt(0) >= 0x06F0 ? d.charCodeAt(0) - 0x06F0 : d.charCodeAt(0) - 0x0660))
    .replace(/(\d{4}-\d{1,2}-\d{1,2})|(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|(\d{1,2}\.\d{1,2}\.\d{2,4})/g, ' ')
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:k|الف)?/i, ' ')
    .replace(new RegExp('(^|\\s)' + CUR + '(?=\\s|$)', 'gi'), ' ')
    .replace(/\b(today|yesterday|tonight|cash|spent|paid|bought|for|on|at|the|my)\b/gi, ' ')
    .replace(/(^|\s)(النهارده|النهاردة|اليوم|امبارح|أمس|امس|مبارح|كاش|نقدي|صرفت|دفعت|اشتريت|على)(?=\s|$)/g, ' ')
    .replace(/[,،.]+\s*$/g, '').replace(/\s+/g, ' ').trim();
  if (!s) s = rest;
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
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
      const r = parseText(line, ctx, h);
      if (r) rows.push(r);
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
