import { uid } from './util.js';

// Transport layer: real Apps Script endpoint, or a local in-browser demo server.
export function makeTransport(cfg) {
  return cfg.demo ? demoTransport() : remoteTransport(cfg);
}

function remoteTransport(cfg) {
  return {
    async call(action, body = {}) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 30000);
      try {
        // text/plain keeps this a "simple" request: no CORS preflight (Apps Script can't answer one).
        const res = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ key: cfg.key, action, ...body }),
          redirect: 'follow',
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error('Server responded ' + res.status);
        const json = await res.json();
        if (!json.ok) throw new Error(json.error || 'Server error');
        return json;
      } catch (e) {
        if (e.name === 'AbortError') throw new Error('Request timed out');
        throw e;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

// ------------------------------------------------------------------ demo server
const DEMO_KEY = 'el_demo_server';
const CATS = {
  Food: ['Groceries', 'Dining Out', 'Coffee'],
  Transport: ['Fuel', 'Taxi', 'Public Transit'],
  Bills: ['Mobile', 'Internet', 'Electricity', 'Water', 'Landline'],
  Shopping: ['Clothes', 'Electronics', 'Household'],
  Entertainment: ['Streaming', 'Cinema', 'Games'],
  Health: ['Doctor Visits', 'Pharmacy', 'Insurance', 'Gym'],
  Education: ['Courses', 'Books', 'Tuition'],
  Travel: ['Flights', 'Hotels', 'Tours', 'Transport'],
  Subscriptions: ['Netflix', 'Spotify', 'Youtube Premium', 'Claude AI', 'Other Services'],
  Miscellaneous: ['Other'],
};

function seed() {
  const e = (date, description, amount, type, category, sub) => ({ id: uid(), date, description, amount, type, category, sub });
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  const mk = (back) => {
    const d = new Date(y, m - 1 - back, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const entries = [];
  [2, 1, 0].forEach((back) => {
    const k = mk(back);
    entries.push(e(k + '-01', 'Salary', 16500, 'Income', 'Income', 'Income'));
    entries.push(e(k + '-02', 'Rent', 4200, 'Expense', 'Bills', 'Internet'));
    entries.push(e(k + '-03', 'Weekly groceries', 612.4, 'Expense', 'Food', 'Groceries'));
    entries.push(e(k + '-05', 'Metro card', 180, 'Expense', 'Transport', 'Public Transit'));
    entries.push(e(k + '-06', 'Netflix', 149.99, 'Expense', 'Subscriptions', 'Netflix'));
    entries.push(e(k + '-08', 'Dinner with friends', 435, 'Expense', 'Food', 'Dining Out'));
    entries.push(e(k + '-11', 'Gym membership', 320, 'Expense', 'Health', 'Gym'));
    entries.push(e(k + '-14', 'Headphones', 899, 'Expense', 'Shopping', 'Electronics'));
    entries.push(e(k + '-18', 'Fuel', 310, 'Expense', 'Transport', 'Fuel'));
  });
  return { firstStart: 150000, months: [mk(2), mk(1), mk(0)], entries };
}

function demoTransport() {
  const load = () => {
    try { const s = JSON.parse(localStorage.getItem(DEMO_KEY)); if (s) return s; } catch (e) { /* fallthrough */ }
    const s = seed();
    localStorage.setItem(DEMO_KEY, JSON.stringify(s));
    return s;
  };
  const payload = (s) => ({
    ok: true,
    categories: { order: Object.keys(CATS), map: CATS },
    firstStart: s.firstStart,
    months: s.months.slice().sort(),
    entries: s.entries,
    serverTime: Date.now(),
  });
  return {
    async call(action, body = {}) {
      await new Promise((r) => setTimeout(r, 350));
      if (localStorage.getItem('el_demo_offline') === '1') throw new Error('Network request failed');
      const s = load();
      const applied = [];
      const rejected = [];
      if (action === 'push') {
        for (const op of body.ops || []) {
          try {
            if (op.type === 'delete') {
              s.entries = s.entries.filter((x) => x.id !== op.id);
            } else {
              const d = op.data;
              if (!(Number(d.amount) > 0)) throw new Error('Amount must be greater than zero.');
              const row = { id: op.id, date: d.date, description: d.description || '', amount: Number(d.amount), type: d.type, category: d.category, sub: d.sub };
              const i = s.entries.findIndex((x) => x.id === op.id);
              if (i >= 0) s.entries[i] = row; else s.entries.push(row);
              const k = row.date.slice(0, 7);
              if (!s.months.includes(k)) s.months.push(k);
            }
            applied.push(op.opId);
          } catch (err) {
            rejected.push({ opId: op.opId, error: err.message });
          }
        }
        localStorage.setItem(DEMO_KEY, JSON.stringify(s));
      }
      return { ...payload(s), applied, rejected };
    },
  };
}
