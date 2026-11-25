import * as util from '../../../js/util.js';
import { catHue } from '../../../js/icons.js';

export const FUEL_DEFAULT_CUTOFF = 550;

export function formatAmt(n, currency = '') {
  const num = Math.round((Number(n) || 0) * 100) / 100;
  const formatted = Number.isInteger(num)
    ? Math.round(num).toLocaleString('en-US')
    : num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return formatted;
}

export function formatEGP(n) {
  return Math.round(Number(n) || 0).toLocaleString('en-US');
}

export function getMonthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

export function getDayLabel(dateStr) {
  return util.dayLabel(dateStr);
}

export function getCategoryColor(cat, order = []) {
  if (cat === 'Income') return '#10B981';
  const preset = {
    Food: '#F59E0B',
    Transport: '#3B82F6',
    Subscriptions: '#8B5CF6',
    Shopping: '#EC4899',
    Bills: '#EF4444',
    Entertainment: '#A855F7',
    Health: '#14B8A6',
    Education: '#06B6D4',
    Travel: '#0EA5E9',
    Miscellaneous: '#64748B',
    Salary: '#10B981',
    Refund: '#06B6D4',
    Freelance: '#3B82F6',
    Gift: '#EC4899',
  };
  if (preset[cat]) return preset[cat];
  const hue = catHue(cat, order);
  return `hsl(${hue}, 78%, 56%)`;
}

/**
 * Safe arithmetic parser (supports +, -, *, ×, /, ÷, decimals) without eval.
 */
export function safeEvalMath(expr) {
  if (!expr) return 0;
  const cleaned = String(expr)
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[^0-9+\-*/.]/g, '');

  if (!cleaned) return 0;

  const tokens = [];
  let numBuf = '';
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if ((ch >= '0' && ch <= '9') || ch === '.') {
      numBuf += ch;
    } else if ('+-*/'.includes(ch)) {
      if (numBuf === '' && ch === '-' && tokens.length === 0) {
        numBuf = '-';
      } else {
        if (numBuf !== '') {
          tokens.push(parseFloat(numBuf));
          numBuf = '';
        }
        if (typeof tokens[tokens.length - 1] === 'string') {
          tokens[tokens.length - 1] = ch;
        } else if (tokens.length > 0) {
          tokens.push(ch);
        }
      }
    }
  }
  if (numBuf !== '' && numBuf !== '-') {
    tokens.push(parseFloat(numBuf));
  }
  if (tokens.length === 0) return 0;
  if (typeof tokens[tokens.length - 1] === 'string') {
    tokens.pop();
  }
  if (tokens.length === 0 || Number.isNaN(tokens[0])) return 0;

  const pass1 = [tokens[0]];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const rhs = tokens[i + 1];
    if (typeof rhs !== 'number' || Number.isNaN(rhs)) break;
    if (op === '*' || op === '/') {
      const lhs = pass1.pop();
      const res = op === '*' ? lhs * rhs : rhs === 0 ? lhs : lhs / rhs;
      pass1.push(res);
    } else {
      pass1.push(op, rhs);
    }
  }

  let result = pass1[0];
  for (let i = 1; i < pass1.length; i += 2) {
    const op = pass1[i];
    const rhs = pass1[i + 1];
    if (typeof rhs !== 'number' || Number.isNaN(rhs)) break;
    result = op === '+' ? result + rhs : result - rhs;
  }

  return Number.isFinite(result) ? Math.max(0, Math.round(result * 100) / 100) : 0;
}

/**
 * Build cumulative spend curve points up to `maxDay` for Spending Pace Chart
 */
export function buildPaceSeries(entries, monthId, accountName, maxDay, daysInMonth) {
  const daily = new Array(daysInMonth + 1).fill(0);
  for (const tx of entries) {
    if (tx.type !== 'expense' && tx.type !== 'Expense') continue;
    if (getMonthKey(tx.date) !== monthId) continue;
    if (accountName && accountName !== 'all' && tx.account !== accountName) continue;
    const day = Number(String(tx.date || '').slice(8, 10));
    if (day >= 1 && day <= daysInMonth) {
      daily[day] += Number(tx.amount) || 0;
    }
  }
  const cum = [];
  let running = 0;
  for (let d = 1; d <= maxDay; d++) {
    running += daily[d];
    cum.push({ day: d, value: Math.round(running * 100) / 100 });
  }
  return cum;
}
