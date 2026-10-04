// Smart insights: plain-language observations computed from a month's transactions.
// Pure functions (no DOM) so they can be tested on their own.

const sum = (list) => list.reduce((n, e) => n + e.amount, 0);
const pct = (n) => Math.round(Math.abs(n) * 100);
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

function groupBy(list, keyFn) {
  const m = new Map();
  list.forEach((e) => {
    const k = keyFn(e);
    const cur = m.get(k) || { key: k, amt: 0, n: 0, items: [] };
    cur.amt += e.amount;
    cur.n++;
    cur.items.push(e);
    m.set(k, cur);
  });
  return [...m.values()].sort((a, b) => b.amt - a.amt);
}

/**
 * m     : { key: '2026-10', entries: [...] }          the month being viewed
 * prev  : the previous month (same shape) or null
 * today : 'YYYY-MM-DD'
 * fmt   : amount formatter, monthName: (key) => 'September'
 * Returns { enough: boolean, items: [{ id, icon, cat, tone, title, detail, badge, q }] }
 */
export function computeInsights({ m, prev, today, fmt, monthName }) {
  const exp = m.entries.filter((e) => e.type === 'Expense');
  const income = sum(m.entries.filter((e) => e.type === 'Income'));
  const spent = sum(exp);
  if (exp.length < 3 || spent <= 0) return { enough: false, items: [] };

  const [yy, mm] = m.key.split('-').map(Number);
  const dim = new Date(yy, mm, 0).getDate();
  const isCurrent = today.slice(0, 7) === m.key;
  const day = isCurrent ? Number(today.slice(8, 10)) : dim;
  const prevName = prev ? monthName(prev.key) : '';

  // the previous month, limited to the same days when the viewed month is still in progress (fair comparison)
  const prevExp = prev ? prev.entries.filter((e) => e.type === 'Expense' && (!isCurrent || Number(e.date.slice(8, 10)) <= day)) : [];
  const prevSpent = sum(prevExp);
  const when = isCurrent ? 'so far' : '';

  const cats = groupBy(exp, (e) => e.category);
  const subs = groupBy(exp, (e) => e.category + '\u0001' + e.sub);
  const items = [];
  const add = (it) => items.push(it);

  // 1) pace for the rest of the month
  if (isCurrent && day >= 5 && day < dim) {
    const projected = (spent / day) * dim;
    const lastTotal = prev ? sum(prev.entries.filter((e) => e.type === 'Expense')) : 0;
    let tail = `You’ve averaged ${fmt(spent / day)} a day over ${day} days.`;
    let badge = null;
    let tone = 'info';
    if (lastTotal > 0) {
      const d = (projected - lastTotal) / lastTotal;
      if (Math.abs(d) >= 0.05) {
        tail += ` That’s ${pct(d)}% ${d > 0 ? 'more' : 'less'} than all of ${prevName}.`;
        badge = `${d > 0 ? '+' : '−'}${pct(d)}%`;
        tone = d > 0 ? 'warn' : 'good';
      }
    }
    add({ id: 'pace', icon: 'chart', tone, title: `On pace to spend about ${fmt(projected)} this month`, detail: tail, badge });
  }

  // 2) biggest category and what drives it
  const top = cats[0];
  const topSubs = groupBy(top.items, (e) => e.sub);
  const topSub = topSubs[0];
  add({
    id: 'top-cat', icon: top.key, cat: top.key, tone: 'info', q: top.key,
    title: `${top.key} is your biggest spend`,
    detail: `${fmt(top.amt)}, ${pct(top.amt / spent)}% of everything${topSubs.length > 1 ? `. Most of it is ${topSub.key} (${fmt(topSub.amt)}).` : '.'}`,
    badge: `${pct(top.amt / spent)}%`,
  });

  // 3) top sub-category overall (when it isn't just the answer above)
  const topOverall = subs[0];
  const [oc, os] = topOverall.key.split('\u0001');
  if (oc !== top.key && topOverall.amt >= spent * 0.1) {
    add({ id: 'top-sub', icon: oc, cat: oc, tone: 'info', q: os, title: `${os} is your top sub-category`, detail: `${fmt(topOverall.amt)} across ${topOverall.n} purchase${topOverall.n === 1 ? '' : 's'} (in ${oc}).` });
  }

  // 4) overall change vs the previous month
  if (prev && prevSpent > 0) {
    const d = (spent - prevSpent) / prevSpent;
    if (Math.abs(d) >= 0.05) {
      add({
        id: 'vs-prev', icon: 'chart', tone: d > 0 ? 'warn' : 'good',
        title: `Spending is ${pct(d)}% ${d > 0 ? 'higher' : 'lower'} than ${prevName}${isCurrent ? ' at this point' : ''}`,
        detail: `${fmt(spent)} ${when || 'in total'} versus ${fmt(prevSpent)} ${isCurrent ? 'by the same day last month' : 'in ' + prevName}.`,
        badge: `${d > 0 ? '+' : '−'}${pct(d)}%`,
      });
    }
  }

  // 5) categories that moved the most
  if (prev) {
    const before = new Map(groupBy(prevExp, (e) => e.category).map((g) => [g.key, g.amt]));
    const moves = cats.map((c) => ({ cat: c.key, now: c.amt, was: before.get(c.key) || 0 }));
    before.forEach((was, cat) => { if (!cats.some((c) => c.key === cat)) moves.push({ cat, now: 0, was }); });
    const material = moves.filter((x) => Math.max(x.now, x.was) >= spent * 0.04);
    const up = material.filter((x) => x.now > x.was).sort((a, b) => (b.now - b.was) - (a.now - a.was))[0];
    const down = material.filter((x) => x.now < x.was).sort((a, b) => (a.now - a.was) - (b.now - b.was))[0];
    if (up) {
      const brandNew = up.was === 0;
      const d = brandNew ? 1 : (up.now - up.was) / up.was;
      if (brandNew || d >= 0.2) add({ id: 'cat-up', icon: up.cat, cat: up.cat, tone: 'warn', q: up.cat, title: brandNew ? `${up.cat} is new compared with ${prevName}` : `${up.cat} is up ${pct(d)}% on ${prevName}`, detail: brandNew ? `${fmt(up.now)} ${when || 'this month'}, and nothing ${isCurrent ? 'by this day' : 'in'} ${prevName}.` : `${fmt(up.now)} ${when} versus ${fmt(up.was)} ${isCurrent ? 'by this day last month' : 'last month'} (+${fmt(up.now - up.was)}).`, badge: brandNew ? 'new' : `+${pct(d)}%` });
    }
    if (down) {
      const d = (down.was - down.now) / down.was;
      if (d >= 0.2) add({ id: 'cat-down', icon: down.cat, cat: down.cat, tone: 'good', q: down.cat, title: `${down.cat} is down ${pct(d)}% on ${prevName}`, detail: `${fmt(down.now)} ${when} versus ${fmt(down.was)} ${isCurrent ? 'by this day last month' : 'last month'} (you spent ${fmt(down.was - down.now)} less).`, badge: `−${pct(d)}%` });
    }
  }

  // 6) the weekday you spend the most on
  if (exp.length >= 8) {
    const wd = groupBy(exp, (e) => new Date(e.date + 'T12:00:00').getDay());
    const best = wd[0];
    const share = best.amt / spent;
    if (share >= 0.28) add({ id: 'weekday', icon: 'calendar', tone: 'info', title: `You spend the most on ${WEEKDAYS[best.key]}`, detail: `${pct(share)}% of your spending (${fmt(best.amt)}) happens on ${WEEKDAYS[best.key]}.` });
  }

  // 7) things you keep buying
  const rep = groupBy(exp.filter((e) => (e.description || '').trim()), (e) => e.description.trim().toLowerCase())
    .filter((g) => g.n >= 2)[0];
  if (rep) {
    const label = rep.items[0].description.trim();
    add({ id: 'repeat', icon: rep.items[0].category, cat: rep.items[0].category, tone: 'info', q: label, title: `“${label}” came up ${rep.n} times`, detail: `${fmt(rep.amt)} in total, about ${fmt(rep.amt / rep.n)} each.` });
  }

  // 8) subscriptions
  const subCat = cats.find((c) => /subscri/i.test(c.key));
  if (subCat && subCat.key !== top.key && subCat.amt > 0) {
    add({ id: 'subs', icon: subCat.key, cat: subCat.key, tone: 'info', q: subCat.key, title: `Subscriptions cost ${fmt(subCat.amt)}`, detail: `That’s ${pct(subCat.amt / spent)}% of your spending, and it repeats every month.` });
  }

  // 9) days with no spending
  if (exp.length >= 5) {
    const spentDays = new Set(exp.map((e) => e.date));
    let free = 0;
    for (let d = 1; d <= day; d++) if (!spentDays.has(`${m.key}-${String(d).padStart(2, '0')}`)) free++;
    if (free >= 3) add({ id: 'free', icon: 'check', tone: 'good', title: `${free} no-spend day${free === 1 ? '' : 's'} ${isCurrent ? 'so far' : 'this month'}`, detail: `You didn’t spend anything on ${free} of ${day} days.` });
  }

  // 10) how much of the income was kept
  if (income > 0) {
    const kept = (income - spent) / income;
    if (kept >= 0.2) add({ id: 'saved', icon: 'income', tone: 'good', title: `You’ve kept ${pct(kept)}% of your income`, detail: `${fmt(income - spent)} left from ${fmt(income)} earned.`, badge: `${pct(kept)}%` });
    else if (kept < 0) add({ id: 'over', icon: 'income', tone: 'warn', title: 'Spending is above your income', detail: `${fmt(spent - income)} more went out than came in this month.` });
  }

  // keep the list short and put the most useful first
  const order = ['pace', 'top-cat', 'vs-prev', 'cat-up', 'cat-down', 'saved', 'over', 'subs', 'repeat', 'weekday', 'top-sub', 'free'];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { enough: true, items: items.slice(0, 7) };
}

/**
 * Insights across every month on record.
 * months : [{ key, entries }] oldest first.  Same return shape as computeInsights.
 */
export function computeAllTime({ months, today, fmt, monthName }) {
  const all = months.flatMap((mo) => mo.entries);
  const exp = all.filter((e) => e.type === 'Expense');
  const income = sum(all.filter((e) => e.type === 'Income'));
  const spent = sum(exp);
  const active = months.filter((mo) => mo.entries.some((e) => e.type === 'Expense'));
  if (exp.length < 5 || spent <= 0) return { enough: false, items: [] };

  const cur = today.slice(0, 7);
  const nm = (k) => `${monthName(k)} ${k.slice(0, 4)}`;
  const items = [];
  const add = (it) => items.push(it);
  const cats = groupBy(exp, (e) => e.category);
  const subs = groupBy(exp, (e) => e.category + '\u0001' + e.sub);
  const perMonth = active.map((mo) => ({ key: mo.key, amt: sum(mo.entries.filter((e) => e.type === 'Expense')) }));
  const count = perMonth.length;
  const total = (list) => list.reduce((n, x) => n + x.amt, 0);

  // 1) overall favourite category and its driver
  const top = cats[0];
  const topSubs = groupBy(top.items, (e) => e.sub);
  add({
    id: 'top-cat', icon: top.key, cat: top.key, tone: 'info', q: top.key,
    title: `${top.key} is where most of your money goes`,
    detail: `${fmt(top.amt)} overall, ${pct(top.amt / spent)}% of everything you’ve spent${topSubs.length > 1 ? `. Mostly ${topSubs[0].key} (${fmt(topSubs[0].amt)}).` : '.'}`,
    badge: `${pct(top.amt / spent)}%`,
  });

  // 2) top sub-category overall
  const [oc, os] = subs[0].key.split('\u0001');
  if (oc !== top.key) {
    add({ id: 'top-sub', icon: oc, cat: oc, tone: 'info', q: os, title: `${os} is your top sub-category`, detail: `${fmt(subs[0].amt)} across ${subs[0].n} purchase${subs[0].n === 1 ? '' : 's'} (in ${oc}).` });
  }

  // 3) average month
  if (count >= 2) {
    add({ id: 'avg', icon: 'chart', tone: 'info', title: `You spend about ${fmt(spent / count)} a month`, detail: `${fmt(spent)} over ${count} months with spending, from ${nm(active[0].key)} to ${nm(active[count - 1].key)}.` });
  }

  // 4) costliest month (and cheapest finished month)
  if (count >= 3) {
    const sorted = perMonth.slice().sort((a, b) => b.amt - a.amt);
    const hi = sorted[0];
    const complete = sorted.filter((x) => x.key !== cur); // the month in progress would always look cheap
    const lo = complete[complete.length - 1];
    add({ id: 'hi-month', icon: 'calendar', tone: 'warn', title: `${nm(hi.key)} was your costliest month`, detail: `${fmt(hi.amt)}${lo && lo.key !== hi.key && lo.amt < hi.amt * 0.97 ? `, versus ${fmt(lo.amt)} in your cheapest, ${nm(lo.key)}` : ''}.`, badge: fmt(hi.amt) });
  }

  // 5) recent trend: last finished months vs the same number before
  const done = perMonth.filter((x) => x.key !== cur);
  if (done.length >= 4) {
    const n = Math.min(3, Math.floor(done.length / 2));
    const recent = done.slice(-n), before = done.slice(-2 * n, -n);
    const r = total(recent) / n, b = total(before) / n;
    if (b > 0 && Math.abs((r - b) / b) >= 0.08) {
      const d = (r - b) / b;
      add({ id: 'trend', icon: 'chart', tone: d > 0 ? 'warn' : 'good', title: `Your monthly spending is ${d > 0 ? 'rising' : 'falling'}`, detail: `Averaging ${fmt(r)} over the last ${n} months, ${pct(d)}% ${d > 0 ? 'more' : 'less'} than the ${n} before (${fmt(b)}).`, badge: `${d > 0 ? '+' : '−'}${pct(d)}%` });
    }

    // 6) which categories are behind it
    const catAvg = (ms) => {
      const out = new Map();
      months.filter((mo) => ms.some((x) => x.key === mo.key)).forEach((mo) => mo.entries.filter((e) => e.type === 'Expense').forEach((e) => out.set(e.category, (out.get(e.category) || 0) + e.amount / ms.length)));
      return out;
    };
    const rc = catAvg(recent), bc = catAvg(before);
    const moves = [...new Set([...rc.keys(), ...bc.keys()])].map((c) => ({ c, d: (rc.get(c) || 0) - (bc.get(c) || 0), now: rc.get(c) || 0, was: bc.get(c) || 0 }));
    const floor = (spent / count) * 0.04;
    const up = moves.slice().sort((a, b2) => b2.d - a.d)[0];
    if (up && up.d >= floor && up.was > 0) add({ id: 'cat-up', icon: up.c, cat: up.c, tone: 'warn', q: up.c, title: `${up.c} is growing the fastest`, detail: `Now ${fmt(up.now)} a month on average, up from ${fmt(up.was)} (+${fmt(up.d)}).`, badge: `+${pct(up.d / up.was)}%` });
    const dn = moves.slice().sort((a, b2) => a.d - b2.d)[0];
    if (dn && -dn.d >= floor && dn.was > 0) add({ id: 'cat-down', icon: dn.c, cat: dn.c, tone: 'good', q: dn.c, title: `${dn.c} is shrinking`, detail: `Now ${fmt(dn.now)} a month on average, down from ${fmt(dn.was)} (−${fmt(-dn.d)}).`, badge: `−${pct(-dn.d / dn.was)}%` });
  }

  // 7) biggest single expense ever
  const big = exp.slice().sort((a, b) => b.amount - a.amount)[0];
  const bigLabel = (big.description || '').trim() || big.sub;
  add({ id: 'big', icon: big.category, cat: big.category, tone: 'info', q: bigLabel, title: `Biggest single expense: ${fmt(big.amount)}`, detail: `${bigLabel} (${big.category}) on ${big.date}.` });

  // 8) most frequent purchase
  const rep = groupBy(exp.filter((e) => (e.description || '').trim()), (e) => e.description.trim().toLowerCase())
    .filter((g) => g.n >= 3).sort((a, b) => b.n - a.n || b.amt - a.amt)[0];
  if (rep) {
    const label = rep.items[0].description.trim();
    add({ id: 'repeat', icon: rep.items[0].category, cat: rep.items[0].category, tone: 'info', q: label, title: `“${label}” is your most frequent purchase`, detail: `${rep.n} times, ${fmt(rep.amt)} in total (about ${fmt(rep.amt / rep.n)} each).` });
  }

  // 9) weekday
  if (exp.length >= 20) {
    const best = groupBy(exp, (e) => new Date(e.date + 'T12:00:00').getDay())[0];
    if (best.amt / spent >= 0.2) add({ id: 'weekday', icon: 'calendar', tone: 'info', title: `${WEEKDAYS[best.key]} are your biggest spending day`, detail: `${pct(best.amt / spent)}% of all spending (${fmt(best.amt)}) happens on ${WEEKDAYS[best.key]}.` });
  }

  // 10) subscriptions
  const subCat = cats.find((c) => /subscri/i.test(c.key));
  if (subCat && subCat.key !== top.key) add({ id: 'subs', icon: subCat.key, cat: subCat.key, tone: 'info', q: subCat.key, title: `Subscriptions have cost ${fmt(subCat.amt)}`, detail: `About ${fmt(subCat.amt / count)} a month, ${pct(subCat.amt / spent)}% of your spending.` });

  // 11) income kept
  if (income > 0) {
    const kept = (income - spent) / income;
    if (kept >= 0.1) add({ id: 'saved', icon: 'income', tone: 'good', title: `You’ve kept ${pct(kept)}% of everything you earned`, detail: `${fmt(income - spent)} left from ${fmt(income)} in income.`, badge: `${pct(kept)}%` });
    else if (kept < 0) add({ id: 'over', icon: 'income', tone: 'warn', title: 'Overall you’ve spent more than you earned', detail: `${fmt(spent - income)} more went out than came in across all months.` });
  }

  const order = ['top-cat', 'avg', 'trend', 'cat-up', 'cat-down', 'hi-month', 'saved', 'over', 'top-sub', 'big', 'repeat', 'subs', 'weekday'];
  items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { enough: true, items: items.slice(0, 9) };
}
