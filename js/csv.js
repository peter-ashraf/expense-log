// Tolerant CSV reader for importing transactions.
// Understands this app's own export (Date, Description, Amount, Type, Category, Sub-Category) and typical
// bank / card exports: comma, semicolon or tab separated, quoted fields, UTF-8 or Windows-1252, a BOM,
// flexible header names, separate Debit / Credit columns, "(12.50)" or "-12.50" amounts.
import { toIsoDate, matchCategory, matchSub } from './xlsx.js';

export function decodeText(buffer) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
  } catch (e) {
    return new TextDecoder('windows-1252').decode(u8);
  }
}

function detectDelimiter(text) {
  let inQ = false;
  const count = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ && (ch === '\n' || ch === '\r')) break;
    else if (!inQ && ch in count) count[ch]++;
  }
  return Object.keys(count).sort((a, b) => count[b] - count[a])[0] || ',';
}

/** RFC 4180-style parser. Returns an array of rows; each row is an array of strings. */
export function parseCsv(text) {
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQ = true;
    } else if (ch === delim) {
      row.push(cell); cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

const HEADERS = {
  date: ['date', 'day', 'transaction date', 'trans date', 'posting date', 'posted', 'posted date', 'booking date', 'value date'],
  description: ['description', 'note', 'notes', 'memo', 'details', 'detail', 'merchant', 'payee', 'name', 'narrative', 'reference'],
  amount: ['amount', 'value', 'sum', 'total', 'transaction amount'],
  debit: ['debit', 'withdrawal', 'withdrawals', 'paid out', 'money out', 'charge'],
  credit: ['credit', 'deposit', 'deposits', 'paid in', 'money in', 'payment'],
  type: ['type', 'kind', 'direction', 'transaction type'],
  category: ['category'],
  sub: ['sub category', 'subcategory', 'sub', 'sub cat'],
};

function mapColumns(header) {
  const idx = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [key, names] of Object.entries(HEADERS)) {
      if (idx[key] === undefined && names.includes(n)) idx[key] = i;
    }
  });
  const hasDate = idx.date !== undefined;
  const hasAmount = idx.amount !== undefined || idx.debit !== undefined || idx.credit !== undefined;
  return hasDate && hasAmount ? idx : null;
}

/** Parses an amount like "1,234.56", "1.234,56", "(12.50)", "-12.5", "EGP 12". Returns a number or NaN. */
export function parseAmount(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^-/.test(s) || /-$/.test(s)) neg = !neg;
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return NaN;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    s = s.replace(dec === '.' ? /,/g : /\./g, '').replace(dec, '.');
  } else if (lastComma >= 0) {
    s = /,\d{1,2}$/.test(s) && (s.match(/,/g) || []).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : NaN;
}

function dateOrderOf(values) {
  let dmy = false;
  let mdy = false;
  for (const v of values) {
    const m = /^\s*(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\s*$/.exec(String(v || ''));
    if (!m) continue;
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  if (dmy && !mdy) return { order: 'dmy', ambiguous: false };
  if (mdy && !dmy) return { order: 'mdy', ambiguous: false };
  return { order: 'dmy', ambiguous: !dmy && !mdy }; // nothing decides it: read as day/month/year
}

function parseDateCell(raw, order) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) return toIsoDate(Math.floor(Number(s))); // Excel serial
  let m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return order === 'mdy' ? valid(y, a, b) : valid(y, b, a);
  }
  const iso = toIsoDate(s);
  if (iso) return iso;
  const t = Date.parse(s);
  if (!Number.isNaN(t)) { const d = new Date(t); return valid(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
  return null;
}

function valid(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const EXPENSE_WORDS = ['expense', 'expenses', 'debit', 'out', 'spend', 'spent', 'withdrawal', 'payment', 'purchase', 'charge', 'sale'];
const INCOME_WORDS = ['income', 'credit', 'in', 'deposit', 'refund', 'salary', 'received', 'return'];
const typeOf = (t) => {
  const n = norm(t);
  if (EXPENSE_WORDS.includes(n)) return 'Expense';
  if (INCOME_WORDS.includes(n)) return 'Income';
  return null;
};

/**
 * Turns CSV text into transactions.
 * Returns { entries, skipped, notes, dateOrder }.
 * A skipped row that only failed on an unknown category / sub-category carries `fix` (the parsed entry), so the
 * importer can offer to create the missing categories.
 */
export function readCsvEntries(text, categories) {
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!rows.length) throw new Error('That file is empty.');
  let idx = mapColumns(rows[0]);
  let first = 1;
  if (!idx) {
    // no recognisable header: assume this app's own column order
    const r = rows[0];
    if (r.length >= 3 && Number.isFinite(parseAmount(r[2])) && (parseDateCell(r[0], 'dmy') || /\d/.test(r[0]))) {
      idx = { date: 0, description: 1, amount: 2, type: 3, category: 4, sub: 5 };
      first = 0;
    } else {
      throw new Error('Could not find the Date and Amount columns. The first row should be a header like: Date, Description, Amount, Type, Category, Sub-Category.');
    }
  }
  const notes = [];
  const dateInfo = dateOrderOf(rows.slice(first).map((r) => r[idx.date]));
  if (dateInfo.ambiguous) notes.push('Dates like 03/04/2026 were read as day/month/year.');
  const noType = idx.type === undefined && idx.debit === undefined && idx.credit === undefined;
  if (noType) notes.push('No Type column: positive amounts are imported as expenses, negative amounts as income (refunds).');

  const entries = [];
  const skipped = [];
  const misc = matchCategory(categories, 'Miscellaneous');
  let usedMisc = false;
  rows.slice(first).forEach((r, k) => {
    const line = k + first + 1;
    const get = (key) => (idx[key] === undefined ? '' : String(r[idx[key]] ?? '').trim());
    const bad = (reason, fix) => skipped.push({ sheet: 'CSV', row: line, reason, ...(fix ? { fix } : {}) });
    const date = parseDateCell(get('date'), dateInfo.order);
    if (!date) { bad('unreadable date'); return; }

    // amount + type
    let amount;
    let type = null;
    const debit = idx.debit !== undefined ? parseAmount(get('debit')) : NaN;
    const credit = idx.credit !== undefined ? parseAmount(get('credit')) : NaN;
    if (idx.amount === undefined || get('amount') === '') {
      if (Number.isFinite(debit) && debit !== 0) { amount = Math.abs(debit); type = 'Expense'; }
      else if (Number.isFinite(credit) && credit !== 0) { amount = Math.abs(credit); type = 'Income'; }
      else { bad('no amount'); return; }
    } else {
      const raw = parseAmount(get('amount'));
      if (!Number.isFinite(raw) || raw === 0) { bad('amount must be above zero'); return; }
      amount = Math.abs(raw);
      if (idx.type !== undefined) {
        type = typeOf(get('type'));
        if (!type) { bad('type must be Expense or Income'); return; }
      } else if (idx.debit !== undefined || idx.credit !== undefined) {
        type = raw < 0 ? 'Expense' : 'Income';
      } else {
        type = raw < 0 ? 'Income' : 'Expense';
      }
    }
    amount = Math.round(amount * 100) / 100;
    const base = { date, description: get('description'), amount, type, sheet: 'CSV', row: line };

    if (type === 'Income') { entries.push({ ...base, category: 'Income', sub: 'Income' }); return; }

    let category = get('category');
    let sub = get('sub');
    if (!category) {
      if (misc && matchSub(categories.map[misc], 'Other')) { category = misc; sub = 'Other'; usedMisc = true; }
      else { bad('missing category'); return; }
    }
    const canon = matchCategory(categories, category);
    if (!canon) { bad(`unknown category "${category}"`, { ...base, category, sub }); return; }
    const list = categories.map[canon];
    let canonSub = sub ? matchSub(list, sub) : null;
    if (!sub) canonSub = canon; // category only: use the category name as the sub-category
    if (!canonSub && sub === canon) canonSub = canon;
    if (!canonSub) { bad(`unknown sub-category "${sub}" under ${canon}`, { ...base, category: canon, sub }); return; }
    entries.push({ ...base, category: canon, sub: canonSub });
  });
  if (usedMisc) notes.push('Rows without a category go to Miscellaneous › Other.');
  return { entries, skipped, notes, dateOrder: dateInfo.order };
}
