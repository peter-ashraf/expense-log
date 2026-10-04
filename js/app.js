import * as store from './store.js';
import { icon, catHue } from './icons.js';
import { computeInsights, computeAllTime, computeStreak, weeklySeries, topMerchants } from './insights.js';
import { parseMessages } from './quick.js';
import { esc, num as rawNum, num0 as rawNum0, money as rawMoney, keyLabel, keyShort, todayStr, dayLabel, dateLong, dateShort, shiftDate, weekStart, monthKeyOf, haptic, csvEscape, saveFile } from './util.js';
import { buildWorkbook, parseWorkbook } from './xlsx.js';
import { readCsvEntries, decodeText } from './csv.js';
import * as lk from './lockui.js';
import * as vault from './vault.js';
import { promptUnlock } from './vaultui.js';
import { hardReload } from './refresh.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- privacy mode: tap the main balance to hide every other number -------------------------------
// The numbers are replaced in the page itself (not just blurred), so they are not readable in the browser's
// inspector either. The balance on the main card stays visible: it is the switch.
const priv = () => document.documentElement.classList.contains('privacy');
const MASK = '••••';
const num = (n) => (priv() ? MASK : rawNum(n));
const num0 = (n) => (priv() ? MASK : rawNum0(n));
const money = (n, c) => (priv() ? MASK : rawMoney(n, c));
const dots = (s) => (priv() ? '••' : s);                                   // a percentage or a count
const maskTxt = (s) => (priv() ? String(s).replace(/\d[\d,.]*/g, '••') : s);   // a sentence with numbers in it

const APP_VERSION = '3.5.2';

const ui = { settingsPage: null, account: (() => { try { return localStorage.getItem('el_acc') || 'all'; } catch (e) { return 'all'; } })(), insScope: (() => { try { return localStorage.getItem('el_ins') === 'all' ? 'all' : 'month'; } catch (e) { return 'month'; } })(), tab: 'home', month: null, filter: 'all', q: '', animate: true, form: null, armedDelete: false, adding: null, newName: '', menuOpen: false, noClickUntil: 0, picking: false, calMonth: '' };

// ---------------------------------------------------------------- helpers
const cur = () => store.getState().settings.currency || '';
const fmt = (n) => money(n, cur());

// ---- spending accounts (credit card, cash, ...) ----
const accList = () => store.view().accounts;
const liveAccts = () => accList().filter((a) => !a.archived);
const multiAcc = () => liveAccts().length > 1;
const accOf = (name) => accList().find((a) => a.name === name) || null;
const accHue = (a) => (a && a.type === 'cash' ? 150 : 255);
const sumBy = (list, type) => list.reduce((n, e) => n + (e.type === type ? e.amount : 0), 0);

// A month limited to the selected account (the same shape as a normal month), or the month itself for "All".
function scoped(m) {
  if (!m) return m;
  if (ui.account !== 'all' && !liveAccts().some((a) => a.name === ui.account)) ui.account = 'all';
  if (ui.account === 'all') return m;
  const entries = m.entries.filter((e) => e.account === ui.account);
  const spent = Math.round(sumBy(entries, 'Expense') * 100) / 100;
  const income = Math.round(sumBy(entries, 'Income') * 100) / 100;
  return { key: m.key, entries, spent, income, start: 0, available: Math.round((income - spent) * 100) / 100, scoped: true };
}

function accChips() {
  if (!multiAcc()) return '';
  const all = [['all', 'All accounts', null]].concat(liveAccts().map((a) => [a.name, a.name, a]));
  return `<div class="chips acc-chips" role="tablist" aria-label="Account">${all.map(([k, l, a]) =>
    `<button class="chip ${ui.account === k ? 'on' : ''}" role="tab" aria-selected="${ui.account === k}" data-act="acc" data-v="${esc(k)}">${a ? icon(a.type === 'cash' ? 'cash' : 'card', 16) : ''}${esc(l)}</button>`).join('')}</div>`;
}

// What the insights compare spending against: the account's own limit, or the overall budget / the limits added up.
function budgetFor() {
  if (ui.account !== 'all') { const a = accOf(ui.account); return a ? a.limit || 0 : 0; }
  const own = Number(store.getState().settings.budget) || 0;
  if (own > 0) return own;
  const live = liveAccts();
  return live.length && live.every((a) => a.limit > 0) ? live.reduce((n, a) => n + a.limit, 0) : 0;
}

function rawMonth() {
  const v = store.view();
  if (!v.months.length) return null;
  if (!ui.month || !v.by[ui.month]) {
    const now = todayStr().slice(0, 7);
    ui.month = v.by[now] ? now : v.months.filter((k) => k <= now).pop() || v.months[v.months.length - 1];
  }
  return v.by[ui.month];
}

function activeMonth() { return scoped(rawMonth()); }

function splitAmount(n) {
  const s = rawNum(n);
  const hasDec = s.length > 3 && /\D/.test(s[s.length - 3]);
  return hasDec ? [s.slice(0, -3), s.slice(-3)] : [s, ''];
}

function heroHTML(n) {
  if (priv()) return '••••••';
  const [i, d] = splitAmount(n);
  return `${cur() ? `<span class="cur">${esc(cur())}</span>` : ''}${esc(i)}<small>${esc(d)}</small>`;
}

// Runs of dots are wrapped in a blurred span (the digits are already gone from the page; this just makes it soft).
let pvObs = null;
function blurMasks(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue.includes('•') && !(n.parentElement && n.parentElement.closest('.pv')) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  while (w.nextNode()) nodes.push(w.currentNode);
  nodes.forEach((n) => {
    const frag = document.createDocumentFragment();
    n.nodeValue.split(/(•+)/).forEach((part) => {
      if (!part) return;
      if (part[0] === '•') { const sp = document.createElement('span'); sp.className = 'pv'; sp.textContent = part; frag.appendChild(sp); }
      else frag.appendChild(document.createTextNode(part));
    });
    n.parentNode.replaceChild(frag, n);
  });
}

function watchPrivacy(on) {
  if (pvObs) { pvObs.disconnect(); pvObs = null; }
  if (!on) return;
  const opts = { childList: true, subtree: true, characterData: true };
  pvObs = new MutationObserver(() => { pvObs.disconnect(); blurMasks(document.body); pvObs.observe(document.body, opts); });
  blurMasks(document.body);
  pvObs.observe(document.body, opts);
}

function setPrivacy(on) {
  document.documentElement.classList.toggle('privacy', on);
  try { localStorage.setItem('el_priv', on ? '1' : '0'); } catch (e) { /* ignore */ }
  store.saveSettings({ hideBalance: on });
  haptic(10);
  ui.animate = false;
  render();
  watchPrivacy(on);
  // the hint is only for the very first time it is ever shown
  if (on) {
    let seen = false;
    try { seen = localStorage.getItem('el_priv_hint') === '1'; } catch (e) { /* ignore */ }
    if (!seen) {
      try { localStorage.setItem('el_priv_hint', '1'); } catch (e) { /* ignore */ }
      toast('Numbers hidden. Tap the balance again to show them');
    }
  }
}

function countUp(el, to) {
  if (!el) return;
  if (priv()) { el.textContent = '••••••'; return; }
  if (reduceMotion || !ui.animate) { el.innerHTML = heroHTML(to); return; }
  const t0 = performance.now();
  const dur = 700;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    el.innerHTML = heroHTML(to * e);
    if (p < 1) requestAnimationFrame(step); else el.innerHTML = heroHTML(to);
  };
  requestAnimationFrame(step);
}

function toast(msg, kind = '', action = null) {
  const t = $('#toast');
  t.textContent = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => { t.className = ''; action.fn(); });
    t.appendChild(btn);
  }
  t.className = 'show ' + kind + (action ? ' has-action' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, action ? 7000 : kind === 'err' ? 4200 : 2200);
}

function hueStyle(name) {
  const order = store.view().categories.order;
  return `--h:${catHue(name, order)}`;
}

function entryRow(e, pending) {
  const isInc = e.type === 'Income';
  const title = e.description || (isInc ? 'Income' : e.sub);
  const subtitle = (isInc ? 'Income' : `${e.category} · ${e.sub}`) + (ui.account === 'all' && multiAcc() && e.account ? ` · ${e.account}` : '');
  return `<button class="row ${isInc ? 'inc' : 'exp'}" data-act="edit" data-id="${esc(e.id)}">
    <span class="bubble" style="${hueStyle(isInc ? 'Income' : e.category)}">${icon(isInc ? 'income' : e.category, 20)}</span>
    <span class="row-main"><span class="row-t">${esc(title)}</span><span class="row-s">${esc(subtitle)}${pending.has(e.id) ? '<i class="pend" title="Waiting to sync"></i>' : ''}</span></span>
    <span class="row-amt">${isInc ? '+' : '−'}${esc(num(e.amount))}</span>
  </button>`;
}

// ---------------------------------------------------------------- top bar
function renderTop() {
  const st = store.getState();
  const v = store.view();
  const m = activeMonth();
  const left = ui.tab === 'settings'
    ? (ui.settingsPage ? `<button class="month-pill back" data-act="settings-back" aria-label="Back to Settings">${icon('back', 16, 2.4)}<span>Settings</span></button>` : '<h1 class="title">Settings</h1>')
    : `<button class="month-pill ${ui.menuOpen ? 'open' : ''}" data-act="months" aria-haspopup="listbox" aria-expanded="${ui.menuOpen}" ${v.months.length ? '' : 'disabled'}>
        <span>${m ? esc(keyLabel(m.key)) : 'No data'}</span>${icon('chevron', 16, 2.2)}</button>`;
  const n = st.queue.length;
  let label = '';
  let cls = st.status;
  if (st.status === 'syncing') label = 'Syncing…';
  else if (st.status === 'offline') label = n ? `Offline · ${n} pending` : 'Offline';
  else if (st.status === 'retrying') { label = n ? `Reconnecting · ${n} pending` : 'Reconnecting…'; cls = 'offline'; }
  else if (st.status === 'error') label = n ? `Sync issue · ${n} pending` : 'Sync issue';
  else if (n) { label = `${n} pending`; cls = 'pending'; }
  else if (st.status === 'synced') label = 'Synced';
  $('#topbar').innerHTML = `${left}
    <button class="sync ${cls}" data-act="sync" aria-label="Sync now"><i></i><span>${esc(label)}</span></button>`;
  document.documentElement.style.setProperty('--top-h', $('#topbar').offsetHeight + 'px');
}

// ---------------------------------------------------------------- tab bar
function renderTabbar() {
  const tabs = [['home', 'Home', 'home'], ['activity', 'Activity', 'list'], ['add', '', 'plus'], ['insights', 'Insights', 'chart'], ['settings', 'Settings', 'gear']];
  $('#tabbar').innerHTML = tabs.map(([id, label, ic]) =>
    id === 'add'
      ? `<button class="fab" data-act="new" aria-label="Add transaction">${icon('plus', 26, 2.4)}</button>`
      : `<button class="tab ${ui.tab === id ? 'on' : ''}" data-act="tab" data-tab="${id}">${icon(ic, 22)}<span>${label}</span></button>`
  ).join('');
}

// ---------------------------------------------------------------- views
function renderTab() {
  const view = $('#view');
  const y = view.scrollTop;
  const m = activeMonth();
  if (!m && store.getState().cfg) {
    view.innerHTML = `<div class="empty-big">${icon('cloud', 40, 1.5)}<h2>Nothing here yet</h2><p>Tap the + button to add your first transaction.</p></div>`;
    return;
  }
  if (ui.tab === 'home') renderHome(view, m);
  else if (ui.tab === 'activity') renderActivity(view, m);
  else if (ui.tab === 'insights') renderInsights(view, m);
  else renderSettings(view);
  if (ui.tab !== 'activity') view.scrollTop = y;
  ui.animate = false;
}

function catTotals(m) {
  const t = {};
  m.entries.forEach((e) => { if (e.type === 'Expense') t[e.category] = (t[e.category] || 0) + e.amount; });
  return Object.entries(t).sort((a, b) => b[1] - a[1]);
}

function renderHome(view, m) {
  const v = store.view();
  const funds = m.start + m.income;
  const pct = funds > 0 ? Math.max(0, Math.min(100, (m.spent / funds) * 100)) : 0;
  const cats = catTotals(m).slice(0, 5);
  const top = cats.length ? cats[0][1] : 1;
  const acc = m.scoped ? accOf(ui.account) : null;
  const lim = acc ? acc.limit : 0;
  const heroLabel = acc ? `${acc.name} · ${lim > 0 ? 'left this month' : 'spent this month'}` : 'Available balance';
  const heroAmount = acc ? (lim > 0 ? lim - m.spent : m.spent) : m.available;
  const heroSub = acc
    ? (lim > 0 ? (m.spent > lim ? `Over the ${fmt(lim)} limit by ${fmt(m.spent - lim)}` : `Monthly limit ${fmt(lim)}`) : 'No limit set. You can add one in Settings')
    : `Opened the month with ${fmt(m.start)}`;
  const meterShown = acc ? lim > 0 : true;
  const meterPct = acc ? Math.max(0, Math.min(100, (m.spent / (lim || 1)) * 100)) : pct;
  const meterCap = acc ? `${dots(Math.round((m.spent / (lim || 1)) * 100))}% of the limit used` : `${dots(Math.round(pct))}% of available funds spent`;
  const rawM = rawMonth();
  const allDates = new Set();
  v.months.forEach((k) => v.by[k].entries.forEach((e) => allDates.add(e.date)));
  const sk = computeStreak(allDates, todayStr(), weekStart());
  const dowName = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(iso + 'T12:00:00'));
  const streakCard = v.months.length ? `<section class="card streak">
      <div class="streak-h"><span class="flame ${sk.streak ? 'lit' : ''}">${icon('flame', 22, 1.8)}</span>
        <div class="streak-t"><b>${sk.streak ? `${sk.streak}-day streak` : 'Start a streak'}</b>
        <small>${sk.streak ? (sk.loggedToday ? `Best so far: ${sk.best} day${sk.best === 1 ? '' : 's'}` : 'Log something today to keep it going') : 'Log an entry today to begin'}</small></div></div>
      <div class="week">${sk.week.map((d) => `<span class="wd ${d.on ? 'on' : ''} ${d.today ? 'today' : ''} ${d.future ? 'future' : ''}"><i>${d.on ? icon('check', 12, 3) : ''}</i><em>${esc(dowName(d.date))}</em></span>`).join('')}</div>
    </section>` : '';
  const accCard = !m.scoped && multiAcc() ? `<section class="card">
      <div class="card-h"><h3>Accounts</h3></div>
      ${liveAccts().map((a) => {
        const sp = sumBy(rawM.entries.filter((e) => e.account === a.name), 'Expense');
        const r = a.limit > 0 ? sp / a.limit : 0;
        return `<button class="bar-row acc-row ${r > 1 ? 'over' : r > 0.85 ? 'near' : ''}" data-act="acc" data-v="${esc(a.name)}" style="--h:${accHue(a)}">
          <span class="bubble sm">${icon(a.type === 'cash' ? 'cash' : 'card', 16)}</span>
          <span class="bar-main"><span class="bar-top"><span>${esc(a.name)}</span><b>${esc(num(sp))}${a.limit > 0 ? `<small> / ${esc(num0(a.limit))}</small>` : ''}</b></span>
          <span class="bar"><i style="width:${a.limit > 0 ? Math.min(100, Math.max(3, r * 100)).toFixed(1) : 0}%"></i></span></span></button>`;
      }).join('')}
    </section>` : '';
  view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
    ${accChips()}
    <section class="hero">
      <div class="hero-label">${esc(heroLabel)}</div>
      <div class="hero-amt" id="heroAmt" data-act="privacy" role="button" tabindex="0" aria-pressed="${priv()}" aria-label="Balance. Tap to hide or show every other number">${heroHTML(heroAmount)}</div>
      <div class="hero-sub">${esc(heroSub)}</div>
      <div class="hero-row">
        <button class="mini" data-act="flip" data-kind="income" aria-label="Show income breakdown"><span>${icon('income', 14, 2.2).replace('class="ic"', 'class="ic up"')}Income</span><b>${esc(fmt(m.income))}</b></button>
        <button class="mini" data-act="flip" data-kind="spent" aria-label="Show spending breakdown"><span>${icon('income', 14, 2.2).replace('class="ic"', 'class="ic down"')}Spent</span><b>${esc(fmt(m.spent))}</b></button>
      </div>
      ${meterShown ? `<div class="meter"><i style="width:${meterPct.toFixed(1)}%"></i></div>
      <div class="meter-cap">${esc(meterCap)}</div>` : ''}
    </section>
    ${streakCard}
    ${accCard}
    ${cats.length ? `<section class="card">
      <div class="card-h"><h3>Where it went</h3><button class="link" data-act="tab" data-tab="insights">See all</button></div>
      ${cats.map(([name, amt]) => `<div class="bar-row" style="${hueStyle(name)}">
        <span class="bubble sm">${icon(name, 16)}</span>
        <div class="bar-main"><div class="bar-top"><span>${esc(name)}</span><b>${esc(num(amt))}</b></div>
        <div class="bar"><i style="width:${Math.max(4, (amt / top) * 100).toFixed(1)}%"></i></div></div></div>`).join('')}
    </section>` : ''}
    <section class="card">
      <div class="card-h"><h3>Latest</h3><button class="link" data-act="tab" data-tab="activity">View all</button></div>
      ${m.entries.length ? m.entries.slice(0, 5).map((e) => entryRow(e, v.pending)).join('') : '<p class="muted pad">No transactions this month.</p>'}
    </section>
  </div>`;
  countUp($('#heroAmt'), heroAmount);
}

function renderActivity(view, m) {
  if (!$('#actList')) {
    view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
      <div id="accChips"></div>
      <div class="search">${icon('search', 18)}<input id="q" type="search" placeholder="Search transactions" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips" id="filters"></div>
      <div id="actList"></div></div>`;
    $('#q').addEventListener('input', (e) => { ui.q = e.target.value; fillActivity(); });
  }
  $('#accChips').innerHTML = accChips();
  $('#filters').innerHTML = [['all', 'All'], ['Expense', 'Expenses'], ['Income', 'Income']]
    .map(([k, l]) => `<button class="chip ${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`).join('');
  fillActivity();
}

function fillActivity() {
  const m = activeMonth();
  if (!m) return;
  const v = store.view();
  const q = ui.q.trim().toLowerCase();
  const list = m.entries.filter((e) =>
    (ui.filter === 'all' || e.type === ui.filter) &&
    (!q || `${e.description} ${e.category} ${e.sub} ${e.amount}`.toLowerCase().includes(q)));
  if (!list.length) {
    $('#actList').innerHTML = `<div class="empty-big small">${icon('search', 32, 1.5)}<p>${q || ui.filter !== 'all' ? 'No matches.' : 'No transactions this month.'}</p></div>`;
    return;
  }
  const groups = [];
  list.forEach((e) => {
    const g = groups[groups.length - 1];
    if (g && g.date === e.date) g.items.push(e); else groups.push({ date: e.date, items: [e] });
  });
  $('#actList').innerHTML = groups.map((g) => {
    const net = g.items.reduce((s, e) => s + (e.type === 'Income' ? e.amount : -e.amount), 0);
    return `<div class="day"><span>${esc(dayLabel(g.date))}</span><span class="${net < 0 ? 'neg' : 'pos'}">${net < 0 ? '−' : '+'}${esc(num(Math.abs(net)))}</span></div>
      <div class="card flush">${g.items.map((e) => entryRow(e, v.pending)).join('')}</div>`;
  }).join('');
}

function donut(parts, total, hueOf) {
  const r = 62;
  const c = 2 * Math.PI * r;
  let off = 0;
  const order = store.view().categories.order;
  const segs = parts.map(([name, amt]) => {
    const len = (amt / total) * c;
    const s = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="hsl(${hueOf ? hueOf(name, parts) : catHue(name, order)} 70% 58%)" stroke-width="18"
      stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(c - Math.max(0, len - 2)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)" stroke-linecap="butt"/>`;
    off += len;
    return s;
  }).join('');
  return `<svg viewBox="0 0 160 160" class="donut"><circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--track)" stroke-width="18"/>${segs}</svg>`;
}

// ---- flip card: Income / Spent breakdown --------------------------------------------------------
let flipKind = null;
let flipAnim = null;
let flipSeq = 0; // each open/close gets a number; stale timers and animation callbacks from older ones are ignored

function incomeSources(m) {
  const map = new Map();
  m.entries.forEach((e) => {
    if (e.type !== 'Income') return;
    const name = (e.description || '').trim() || 'Income';
    const k = name.toLowerCase();
    const cur = map.get(k) || { name, amt: 0 };
    cur.amt += e.amount;
    map.set(k, cur);
  });
  let list = [...map.values()].sort((a, b) => b.amt - a.amt);
  if (list.length > 6) {
    const rest = list.slice(5).reduce((n, x) => n + x.amt, 0);
    list = list.slice(0, 5).concat([{ name: 'Other', amt: rest }]);
  }
  return list.map((x) => [x.name, x.amt]);
}

const INCOME_HUES = [152, 176, 198, 222, 262, 300];

function flipMarkup(kind, m) {
  const spent = kind === 'spent';
  const parts = spent ? catTotals(m) : incomeSources(m);
  const total = parts.reduce((n, p) => n + p[1], 0);
  const order = store.view().categories.order;
  const hueOf = spent ? (name) => catHue(name, order) : (name, list) => INCOME_HUES[list.findIndex((p) => p[0] === name) % INCOME_HUES.length];
  const rows = parts.map(([name, amt]) => `<div class="flip-row" style="--c:hsl(${hueOf(name, parts)} 70% 58%)">
      <i></i><span class="n">${esc(name)}</span><b>${esc(num(amt))}</b><em>${dots(Math.round((amt / total) * 100))}%</em></div>`).join('');
  return `<div class="flip-face flip-front">
      <div class="flip-head">
        <div><h3>${spent ? 'Spent' : 'Income'}</h3><small>${esc(keyLabel(m.key))} · ${spent ? 'by category' : 'by source'}</small></div>
        <button class="close" data-act="flip-close" aria-label="Close">${icon('close', 20, 2.2)}</button>
      </div>
      ${parts.length ? `<div class="donut-box flip-donut">${donut(parts, total, hueOf)}<div class="donut-c"><small>Total</small><b>${esc(num0(total))}</b></div></div>
        <div class="flip-list">${rows}</div>` : `<div class="empty-big small">${icon('chart', 32, 1.5)}<p>${spent ? 'No expenses' : 'No income'} in ${esc(keyLabel(m.key))}.</p></div>`}
    </div>
    <div class="flip-face flip-back" aria-hidden="true"></div>`;
}

// the transform that makes the card look like the tile it came from (position + size), flipped over
function flipFrom(card, origin) {
  const fr = card.getBoundingClientRect();
  const or = origin.getBoundingClientRect();
  const dx = or.left + or.width / 2 - (fr.left + fr.width / 2);
  const dy = or.top + or.height / 2 - (fr.top + fr.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${(or.width / fr.width).toFixed(4)}, ${(or.height / fr.height).toFixed(4)}) rotateY(-180deg)`;
}

function openFlip(kind, origin) {
  const m = activeMonth();
  if (!m || flipKind) return;
  const seq = ++flipSeq;
  const root = $('#flip');
  if (flipAnim) { flipAnim.cancel(); flipAnim = null; }
  flipKind = kind;
  root.innerHTML = `<div class="flip-scrim"></div><div class="flip-card ${kind}">${flipMarkup(kind, m)}</div>`;
  root.className = 'open';
  $('#app').setAttribute('data-flip', kind); // hides the tile so it looks like the tile itself turns into the card
  const card = $('.flip-card', root);
  haptic(8);
  tweenTheme(1);
  const canAnimate = !reduceMotion && !!card.animate;
  const start = flipFrom(card, origin);
  if (canAnimate) card.style.transform = start; // no flash before the animation starts
  const go = () => {
    if (seq !== flipSeq || !card.isConnected || root.classList.contains('shown')) return;
    root.classList.add('shown');
    card.style.transform = '';
    if (!canAnimate) return;
    flipAnim = card.animate([{ transform: start }, { transform: 'none' }], { duration: 680, easing: 'cubic-bezier(.2, .85, .25, 1)', fill: 'both' });
  };
  requestAnimationFrame(go);
  setTimeout(go, 80);
}

function closeFlip() {
  if (!flipKind) return;
  const kind = flipKind;
  flipKind = null;
  const seq = ++flipSeq;
  const root = $('#flip');
  const card = $('.flip-card', root);
  const origin = $(`.mini[data-kind="${kind}"]`);
  tweenTheme(0);
  root.classList.remove('shown');
  const done = () => {
    if (seq !== flipSeq) return; // a newer open/close took over
    root.className = '';
    root.innerHTML = '';
    $('#app').removeAttribute('data-flip');
    flipAnim = null;
  };
  if (!card || !origin || reduceMotion || !card.animate) { setTimeout(done, reduceMotion ? 0 : 300); return; }
  if (flipAnim) flipAnim.cancel();
  const end = flipFrom(card, origin);
  flipAnim = card.animate(
    [{ transform: 'none' }, { transform: end }],
    { duration: 560, easing: 'cubic-bezier(.55, .05, .2, 1)', fill: 'forwards' }
  );
  // fade only the back face: opacity on the card itself would flatten its 3D and show the front's mirrored text
  const back = $('.flip-back', card);
  if (back) back.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { duration: 620, easing: 'ease-out', fill: 'forwards' });
  // the real tile comes back just before the card lands, and the card melts into it (no hard swap)
  setTimeout(() => { if (seq === flipSeq) $('#app').removeAttribute('data-flip'); }, 420);
  flipAnim.onfinish = done;
  setTimeout(done, 950); // safety net if the animation clock is throttled
}

function insightsCard(v, m) {
  const all = ui.insScope === 'all';
  let r;
  if (all) {
    r = computeAllTime({
      months: v.months.map((k) => ({ key: k, entries: scoped(v.by[k]).entries })),
      today: todayStr(), fmt: num0, monthName: (k) => keyLabel(k).split(' ')[0],
    });
  } else {
    const i = v.months.indexOf(m.key);
    r = computeInsights({
      m, prev: i > 0 ? scoped(v.by[v.months[i - 1]]) : null, today: todayStr(), fmt: num0,
      budget: budgetFor(),
      history: v.months.flatMap((k) => scoped(v.by[k]).entries.filter((e) => e.type === 'Expense')),
      monthName: (k) => keyLabel(k).split(' ')[0],
    });
  }
  const seg = `<div class="seg two ins-seg" role="radiogroup" aria-label="Insights range">${[['month', keyLabel(m.key)], ['all', 'All time']]
    .map(([k, l]) => `<button role="radio" aria-checked="${(all ? 'all' : 'month') === k}" class="${(all ? 'all' : 'month') === k ? 'on' : ''}" data-act="ins-scope" data-v="${k}">${esc(l)}</button>`).join('')}</div>`;
  const head = `<div class="card-h"><h3>Smart insights</h3></div>${seg}`;
  if (!r.enough) return `<section class="card insights">${head}<p class="muted pad">${all ? 'Add a few more expenses and I’ll start spotting patterns across your history.' : `Add a few more expenses in ${esc(keyLabel(m.key))} and I’ll start spotting patterns.`}</p></section>`;
  return `<section class="card insights">
      ${head}
      ${r.items.map((it) => { const link = it.q && !all; return `<${link ? 'button' : 'div'} class="ins ${it.tone}" ${link ? `data-act="ins-open" data-q="${esc(it.q)}"` : ''} style="${it.cat ? hueStyle(it.cat) : ''}">
        <span class="bubble">${icon(it.icon, 20)}</span>
        <span class="ins-t"><b>${esc(maskTxt(it.title))}</b><small>${esc(maskTxt(it.detail))}</small>${it.bar != null ? `<span class="ins-bar"><i style="width:${Math.min(100, it.bar * 100).toFixed(1)}%"></i></span>` : ''}</span>
        ${it.badge ? `<em>${esc(maskTxt(it.badge))}</em>` : ''}
      </${link ? 'button' : 'div'}>`; }).join('')}
    </section>`;
}

function renderInsights(view, m) {
  const v = store.view();
  const cats = catTotals(m);
  const total = m.spent || 1;
  const expenses = m.entries.filter((e) => e.type === 'Expense');
  const biggest = expenses.slice().sort((a, b) => b.amount - a.amount).slice(0, 3);
  const days = (() => {
    const [y, mo] = m.key.split('-').map(Number);
    const dim = new Date(y, mo, 0).getDate();
    const now = new Date();
    return now.getFullYear() === y && now.getMonth() + 1 === mo ? now.getDate() : dim;
  })();
  const saved = m.income > 0 ? Math.round(((m.income - m.spent) / m.income) * 100) : null;
  const last = v.months.slice(-6);
  const sc = {};
  last.forEach((k) => { sc[k] = scoped(v.by[k]); });
  // the last 7 days: ending today for the current month, else on the last day of the month being viewed
  const today = todayStr();
  const endDay = today.slice(0, 7) === m.key ? today : `${m.key}-${String(new Date(+m.key.slice(0, 4), +m.key.slice(5), 0).getDate()).padStart(2, '0')}`;
  const allSpend = v.months.flatMap((k) => scoped(v.by[k]).entries);
  const wk = weeklySeries(allSpend, endDay);
  const wkMax = Math.max(1, ...wk.days.map((d) => d.amt));
  const wkDelta = wk.prevTotal > 0 ? Math.round(((wk.total - wk.prevTotal) / wk.prevTotal) * 100) : null;
  const dayLetter = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(iso + 'T12:00:00'));
  const weekCard = wk.total > 0 || wk.prevTotal > 0 ? `<section class="card">
      <div class="card-h"><h3>Last 7 days</h3><span class="muted sm">${wkDelta === null ? '' : `${wkDelta > 0 ? '+' : wkDelta < 0 ? '−' : ''}${dots(Math.abs(wkDelta))}% vs the week before`}</span></div>
      <div class="trend week7">${wk.days.map((d) => `<div class="tcol ${d.date === endDay ? 'on' : ''}"><b>${d.amt ? esc(num0(d.amt)) : ''}</b><div class="tbar"><i style="height:${d.amt ? Math.max(4, (d.amt / wkMax) * 100).toFixed(1) : 0}%"></i></div><span>${esc(dayLetter(d.date))}</span></div>`).join('')}</div>
      <p class="muted sm" style="margin-top:8px">${esc(num0(wk.total))} spent in these 7 days${wk.prevTotal > 0 ? `, ${esc(num0(wk.prevTotal))} the week before` : ''}.</p>
    </section>` : '';
  const merch = topMerchants(m.entries, 5);
  const merchTop = merch.length ? merch[0].amt : 1;
  const merchCard = merch.length ? `<section class="card">
      <div class="card-h"><h3>Top merchants</h3><span class="muted sm">by note · ${esc(keyLabel(m.key))}</span></div>
      ${merch.map((x) => `<button class="bar-row acc-row" data-act="ins-open" data-q="${esc(x.name)}"><span class="bar-main"><span class="bar-top"><span>${esc(x.name)}<small class="muted"> · ${dots(x.n)}×</small></span><b>${esc(num(x.amt))}</b></span><span class="bar"><i style="width:${Math.max(4, (x.amt / merchTop) * 100).toFixed(1)}%"></i></span></span></button>`).join('')}
    </section>` : '';
  const maxSpent = Math.max(1, ...last.map((k) => sc[k].spent));
  view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
    ${accChips()}
    <section class="card">
      <div class="card-h"><h3>Spending split</h3></div>
      ${cats.length ? `<div class="donut-wrap">
        <div class="donut-box">${donut(cats, total)}<div class="donut-c"><small>Spent</small><b>${esc(num0(m.spent))}</b></div></div>
        <div class="legend">${cats.slice(0, 6).map(([n, a]) => `<div style="${hueStyle(n)}"><i></i><span>${esc(n)}</span><b>${dots(Math.round((a / total) * 100))}%</b></div>`).join('')}</div>
      </div>` : '<p class="muted pad">No expenses this month.</p>'}
    </section>
    <section class="stats">
      <div class="stat"><span>Daily average</span><b>${esc(num0(m.spent / Math.max(1, days)))}</b></div>
      <div class="stat"><span>Transactions</span><b>${dots(m.entries.length)}</b></div>
      <div class="stat"><span>Largest expense</span><b>${biggest[0] ? esc(num0(biggest[0].amount)) : '—'}</b></div>
      <div class="stat"><span>Saved</span><b class="${saved !== null && saved < 0 ? 'neg' : 'pos'}">${saved === null ? '—' : dots(saved) + '%'}</b></div>
    </section>
    <section class="card">
      <div class="card-h"><h3>Monthly trend</h3><span class="muted sm">Spent per month</span></div>
      <div class="trend">${last.map((k) => {
        const mm = sc[k];
        const h = Math.max(4, (mm.spent / maxSpent) * 100);
        return `<button class="tcol ${k === m.key ? 'on' : ''}" data-act="pick-month" data-key="${k}"><b>${esc(num0(mm.spent))}</b><div class="tbar"><i style="height:${h.toFixed(1)}%"></i></div><span>${esc(keyShort(k))}</span></button>`;
      }).join('')}</div>
    </section>
    ${weekCard}
    ${merchCard}
    ${biggest.length ? `<section class="card"><div class="card-h"><h3>Biggest expenses</h3></div>${biggest.map((e) => entryRow(e, v.pending)).join('')}</section>` : ''}
    ${insightsCard(v, m)}
  </div>`;
}

function securityCard(st) {
  const lock = st.settings.lock || { method: 'off', delay: 60 };
  const on = lock.method === 'bio' || lock.method === 'pin';
  const delays = [[0, 'Instantly'], [60, '1 min'], [300, '5 min'], [900, '15 min']];
  const cur = lock.delay == null ? 60 : lock.delay;
  return `<section class="card">
      <div class="card-h"><h3>Security</h3><span class="badge ${on ? 'synced' : ''}">${on ? 'Lock on' : 'Off'}</span></div>
      <div class="seg three" role="radiogroup" aria-label="App lock">${[['off', 'Off', 'unlock'], ['bio', 'Face ID', 'face'], ['pin', 'PIN', 'keypad']]
        .map(([k, l, ic]) => `<button role="radio" aria-checked="${lock.method === k}" class="${lock.method === k ? 'on' : ''}" data-act="lock-method" data-v="${k}">${icon(ic, 18)}${l}</button>`).join('')}</div>
      ${on ? `<div class="lbl">Lock when I’ve been away for</div>
        <div class="seg four">${delays.map(([sec, l]) => `<button class="${cur === sec ? 'on' : ''}" data-act="lock-delay" data-v="${sec}">${l}</button>`).join('')}</div>
        <div class="row-btns"><button class="btn ghost" data-act="lock-now">${icon('lock', 18)}Lock now</button>${lock.method === 'pin' ? '<button class="btn ghost" data-act="pin-change">Change PIN</button>' : ''}</div>` : ''}
      <p class="muted sm" style="margin-top:10px">${lock.method === 'bio' ? 'Uses Face ID or Touch ID through your phone’s passkey. ' : ''}This keeps others out of the app. It doesn’t encrypt the data on your phone.</p>
    </section>`;
}

function accountsCard(st) {
  const v = store.view();
  const t = ui.newAccType || 'card';
  const rows = v.accounts.map((a, i) => `<div class="acc-set ${a.archived ? 'off' : ''}">
      <span class="bubble sm" style="--h:${accHue(a)}">${icon(a.type === 'cash' ? 'cash' : 'card', 16)}</span>
      <span class="acc-name"><b>${esc(a.name)}</b><small>${a.type === 'cash' ? 'Cash' : 'Card'}${i === 0 ? ' · main' : ''}${a.archived ? ' · archived' : ''}</small></span>
      <input class="acc-limit" inputmode="decimal" placeholder="No limit" data-name="${esc(a.name)}" value="${priv() ? MASK : a.limit > 0 ? esc(String(a.limit)) : ''}" ${priv() ? 'readonly' : ''} aria-label="Monthly limit for ${esc(a.name)}" autocomplete="off">
      ${i === 0 ? '' : `<button class="chip" data-act="acc-archive" data-v="${esc(a.name)}">${a.archived ? 'Restore' : 'Archive'}</button>`}
    </div>`).join('');
  return `<section class="card">
      <div class="card-h"><h3>Accounts</h3><span class="badge ${v.accounts.length > 1 ? 'synced' : ''}">${v.accounts.length}</span></div>
      ${v.accountsSupported ? '' : '<p class="warn">Your Google Sheet script doesn’t support accounts yet. Paste the updated script (Api.gs) and deploy a new version, then sync.</p>'}
      ${rows}
      <div class="lbl">Add an account</div>
      <div class="seg two"><button class="${t === 'card' ? 'on' : ''}" data-act="acc-type" data-v="card">${icon('card', 18)}Card</button><button class="${t === 'cash' ? 'on' : ''}" data-act="acc-type" data-v="cash">${icon('cash', 18)}Cash</button></div>
      <div class="acc-new"><label class="field"><span>Name</span><input id="accName" maxlength="30" placeholder="e.g. Cash" autocomplete="off"></label>
      <label class="field"><span>Monthly limit</span><input id="accLimit" inputmode="decimal" placeholder="Optional" autocomplete="off"></label></div>
      <button class="btn" data-act="acc-add">${icon('plus', 18)}Add account</button>
      <p class="muted sm" style="margin-top:10px">Every entry belongs to one account. Limits are per month. Totals and the balance in your sheet still add up all accounts together.</p>
    </section>`;
}

function encryptionCard() {
  const m = vault.mode();
  const on = m !== null;
  const intro = m === 'device'
    ? 'Everything this app saves on your phone (entries, settings, your sheet address and key) is stored scrambled. The app looks after the key itself, so there is nothing to remember and nothing extra to type.'
    : m === 'passphrase'
      ? 'Everything saved on this phone is scrambled with your passphrase. The app asks for it when it starts, and again after about 10 minutes away.'
      : 'Store everything this app saves on your phone scrambled, so it can’t be read by browsing the app’s stored data. The app creates and looks after the key itself: nothing to remember, nothing extra to type.';
  const buttons = m === 'device'
    ? '<button class="btn ghost" data-act="enc-auto-off">Turn off encryption</button>'
    : m === 'passphrase'
      ? `<button class="btn ghost" data-act="enc-lock">${icon('lock', 18)}Lock and encrypt now</button>
        <button class="btn ghost" data-act="enc-open" data-m="change">Change passphrase</button>
        <button class="btn ghost" data-act="enc-open" data-m="off">Turn off encryption</button>`
      : `<button class="btn" data-act="enc-auto-on">${icon('lock', 18)}Turn on encryption</button>
        <button class="linkbtn" data-act="enc-open" data-m="on">Prefer a passphrase of your own? (stronger)</button>`;
  const note = m === 'device'
    ? 'This hides your numbers from anyone looking through the app’s stored data. It can’t stop someone who can run code inside the unlocked app. If the phone clears this app’s data, the local copy is gone; your Google Sheet is unaffected.'
    : m === 'passphrase'
      ? 'If you forget the passphrase there is no way to recover this phone’s copy. Your Google Sheet is unaffected, and you can reconnect.'
      : 'A passphrase is stronger, because the key then exists only in your head, but you have to type it.';
  return `<section class="card">
      <div class="card-h"><h3>Encryption</h3><span class="badge ${on ? 'synced' : ''}">${on ? (m === 'device' ? 'On · automatic' : 'On · passphrase') : 'Off'}</span></div>
      <p class="muted sm" style="margin-top:0">${intro}</p>
      ${buttons}
      <p class="muted sm" style="margin-top:10px">${note}</p>
    </section>`;
}

function encSheet(mode) {
  ui.encMode = mode;
  const title = mode === 'on' ? 'Encrypt data' : mode === 'change' ? 'Change passphrase' : 'Turn off encryption';
  const f = (id, label, ac) => `<label class="field"><span>${label}</span><input id="${id}" type="password" autocomplete="${ac}" autocapitalize="off" spellcheck="false" placeholder="••••••••"></label>`;
  const body = mode === 'on'
    ? `<p class="muted pad">Choose a passphrase of at least 8 characters, such as a few random words. You’ll type it when the app starts. It is never stored, and nobody can recover it for you.</p>${f('encA', 'Passphrase', 'new-password')}${f('encB', 'Repeat passphrase', 'new-password')}`
    : mode === 'change'
      ? `${f('encCur', 'Current passphrase', 'current-password')}${f('encA', 'New passphrase (8+ characters)', 'new-password')}${f('encB', 'Repeat new passphrase', 'new-password')}`
      : `<p class="muted pad">The data on this phone will be stored unscrambled again. Enter your passphrase to confirm.</p>${f('encCur', 'Passphrase', 'current-password')}`;
  present(title, '', body, 'small', `<button class="btn primary big" data-act="enc-save" id="encBtn">${mode === 'on' ? 'Encrypt' : mode === 'change' ? 'Change passphrase' : 'Turn off'}</button>`);
  setTimeout(() => { const i = $('#encCur') || $('#encA'); if (i) i.focus(); }, 350);
}

async function saveEncryption() {
  const mode = ui.encMode;
  const val = (id) => (($('#' + id) || {}).value || '');
  const btn = $('#encBtn');
  const fail = (m) => { toast(m, 'err'); shake(); if (btn) { btn.disabled = false; } };
  if (btn) btn.disabled = true;
  try {
    if (mode === 'off') {
      if (!(await vault.check(val('encCur')))) return fail('Wrong passphrase.');
      vault.forget();
      await store.persistEverything();
      closeSheet(); renderSettings($('#view')); toast('Encryption is off', 'ok');
      return;
    }
    const a = val('encA'), b = val('encB');
    if (a.length < vault.MIN_LENGTH) return fail(`Use at least ${vault.MIN_LENGTH} characters.`);
    if (/^\d+$/.test(a) && a.length < 12) return fail('Digits alone are easy to guess. Add letters or make it longer.');
    if (a !== b) return fail('The two passphrases don’t match.');
    if (mode === 'change') {
      await vault.changePassphrase(val('encCur'), a);
      closeSheet(); toast('Passphrase changed', 'ok');
      return;
    }
    toast('Encrypting…');
    await vault.create(a);
    await store.persistEverything();
    haptic(12);
    closeSheet(); renderSettings($('#view')); toast('Your data is encrypted', 'ok');
  } catch (err) { fail(err.message || 'Something went wrong.'); }
}

// ---------------------------------------------------------------- settings: a short top level, then one page per topic
const SET_TITLES = { accounts: 'Accounts & budget', appearance: 'Appearance', security: 'Privacy & security', data: 'Data', about: 'About' };

function srow(page, ic, hue, title, sub) {
  return `<button class="srow" data-act="settings-go" data-p="${page}">
      <span class="bubble" style="--h:${hue}">${icon(ic, 20)}</span>
      <span class="srow-t"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <span class="srow-go">${icon('chevron', 16, 2.4)}</span>
    </button>`;
}

function settingsHome(st) {
  const n = st.queue.length;
  const last = st.lastSync ? new Date(st.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
  const demo = st.cfg && st.cfg.demo;
  const host = demo ? 'Demo mode (data stays on this device)' : (() => { try { return new URL(st.cfg.url).host; } catch (e) { return 'Connected'; } })();
  const v = store.view();
  const live = v.accounts.filter((a) => !a.archived);
  const budget = Number(st.settings.budget) || 0;
  const accSub = `${live.length} account${live.length === 1 ? '' : 's'}${budget > 0 ? ` · budget ${num0(budget)}` : ''}`;
  const theme = { light: 'Light', dark: 'Dark', system: 'Match my phone' }[st.settings.theme || 'system'];
  const lock = lockCfg();
  const lockLabel = { bio: 'Face ID', pin: 'PIN', off: 'No lock' }[lock.method || 'off'] || 'No lock';
  const secSub = `${lockLabel} · ${vault.isEnabled() ? 'Encrypted' : 'Not encrypted'}`;
  const dataSub = st.trash.length ? `Export, import, ${st.trash.length} recently deleted` : 'Export, import, recently deleted';
  return `<div class="page ${ui.animate ? 'enter' : ''}">
    <section class="card sync-card">
      <div class="card-h"><h3>Sync</h3><span class="badge ${st.status}">${esc(st.status === 'idle' ? 'ready' : st.status)}</span></div>
      <div class="kv"><span>Source</span><b>${esc(host)}</b></div>
      <div class="kv"><span>Last synced</span><b>${esc(last)}</b></div>
      ${n ? `<div class="kv"><span>Waiting to upload</span><b>${n}</b></div>` : ''}
      ${st.error && (st.status === 'error' || st.status === 'retrying') ? `<p class="warn">${esc(st.error)}</p>` : ''}
      <button class="btn" data-act="sync">${icon('cloud', 18)}Sync now</button>
    </section>
    <p class="set-h">General</p>
    <div class="slist">
      ${srow('accounts', 'card', 255, 'Accounts & budget', accSub)}
      ${srow('appearance', 'sun', 40, 'Appearance', theme)}
    </div>
    <p class="set-h">Protection</p>
    <div class="slist">
      ${srow('security', 'lock', 150, 'Privacy & security', secSub)}
    </div>
    <p class="set-h">More</p>
    <div class="slist">
      ${srow('data', 'file', 200, 'Data', dataSub)}
      ${srow('about', 'device', 300, 'About', `v${APP_VERSION} · update, disconnect`)}
    </div>
  </div>`;
}

function renderSettings(view) {
  const st = store.getState();
  const p = SET_TITLES[ui.settingsPage] ? ui.settingsPage : null;
  if (!p) { ui.settingsPage = null; view.innerHTML = settingsHome(st); return; }
  const demo = st.cfg && st.cfg.demo;
  const head = `<h2 class="page-title">${esc(SET_TITLES[p])}</h2>`;
  let body = '';

  if (p === 'accounts') {
    body = `${accountsCard(st)}
    <section class="card">
      <div class="card-h"><h3>Monthly budget</h3><span class="badge ${Number(st.settings.budget) > 0 ? 'synced' : ''}">${Number(st.settings.budget) > 0 ? 'On' : 'Off'}</span></div>
      <label class="field"><span>Spending limit per month</span><input id="budgetInput" type="text" inputmode="decimal" placeholder="e.g. 15000" value="${priv() ? MASK : Number(st.settings.budget) > 0 ? esc(String(st.settings.budget)) : ''}" ${priv() ? 'readonly' : ''} autocomplete="off"></label>
      <p class="muted sm" style="margin-top:10px">Smart insights will show how much is left, the daily amount to stay within it, and warn you when you’re heading over. Leave empty to turn it off.</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>Currency</h3></div>
      <label class="field"><span>Currency symbol</span><input id="curInput" maxlength="4" placeholder="e.g. $, €, EGP" value="${esc(st.settings.currency)}" autocomplete="off"></label>
      <p class="muted sm">Shown next to amounts. Doesn’t change your data.</p>
    </section>`;
  } else if (p === 'appearance') {
    body = `<section class="card">
      <div class="card-h"><h3>Theme</h3></div>
      <div class="seg three" role="radiogroup" aria-label="Theme">${[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'device']]
        .map(([k, l, ic]) => `<button role="radio" aria-checked="${(st.settings.theme || 'system') === k}" class="${(st.settings.theme || 'system') === k ? 'on' : ''}" data-act="theme" data-v="${k}">${icon(ic, 18)}${l}</button>`).join('')}</div>
      <p class="muted sm" style="margin-top:10px">System follows your phone’s light/dark setting automatically.</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>Bars</h3></div>
      <label class="switch block"><input type="checkbox" id="glassSwitch" ${st.settings.glass === false ? '' : 'checked'}><span>Glass bars <small class="muted">(blurred top bar and tab bar)</small></span></label>
      <button class="btn ghost" data-act="refresh-view">Status bar not matching? Refresh</button>
    </section>`;
  } else if (p === 'security') {
    body = `${securityCard(st)}
    ${encryptionCard()}
    <section class="card">
      <div class="card-h"><h3>Hide numbers</h3></div>
      <p class="muted sm" style="margin-top:0">Tap the big balance on Home to hide every number in the app, then tap it again to show them. Handy when someone is looking over your shoulder.</p>
    </section>`;
  } else if (p === 'data') {
    body = `<section class="card">
      <div class="card-h"><h3>Excel</h3></div>
      <button class="btn ghost" data-act="export-xlsx">${icon('download', 18)}Export to Excel (.xlsx)</button>
      <button class="btn ghost" data-act="import-xlsx">${icon('download', 18).replace('class="ic"', 'class="ic flip"')}Import from Excel</button>
    </section>
    <section class="card">
      <div class="card-h"><h3>CSV</h3></div>
      <button class="btn ghost" data-act="export">${icon('download', 18)}Export as CSV</button>
      <button class="btn ghost" data-act="import-csv">${icon('file', 18)}Import from CSV</button>
    </section>
    <section class="card">
      <div class="card-h"><h3>Recently deleted</h3></div>
      <button class="btn ghost" data-act="trash">${icon('trash', 18)}Open recently deleted${st.trash.length ? ` (${st.trash.length})` : ''}</button>
      <p class="muted sm">Deleted entries stay here for 60 days so you can bring them back.</p>
      ${demo ? `<label class="switch"><input type="checkbox" id="offSim" ${localStorage.getItem('el_demo_offline') === '1' ? 'checked' : ''}><span>Simulate offline (demo)</span></label>` : ''}
    </section>`;
  } else if (p === 'about') {
    body = `<section class="card">
      <div class="card-h"><h3>Credit Card Expenses</h3><span class="badge">v${APP_VERSION}</span></div>
      <button class="btn ghost" data-act="update-now">${icon('cloud', 18)}Update app now</button>
      <p class="muted sm" style="margin-top:8px">Gets the newest version immediately and reloads. Your data is not touched.</p>
      <p class="muted xs">${esc(fitApp.info || '')}</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>This device</h3></div>
      <button class="btn danger" data-act="disconnect">${demo ? 'Exit demo' : 'Disconnect this device'}</button>
      <p class="muted sm">Disconnecting removes the local copy from this device. Your Google Sheet is untouched.</p>
    </section>`;
  }
  view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">${head}${body}</div>`;
  const cur = $('#curInput');
  if (cur) cur.addEventListener('change', (e) => store.saveSettings({ currency: e.target.value.trim() }));
  const sim = $('#offSim');
  if (sim) sim.addEventListener('change', (e) => { localStorage.setItem('el_demo_offline', e.target.checked ? '1' : '0'); if (!e.target.checked) store.sync(); else { toast('Offline simulation on'); } });
}

// ---------------------------------------------------------------- onboarding
function renderOnboarding(prefill = {}) {
  document.body.classList.add('onboard');
  $('#topbar').innerHTML = '';
  $('#tabbar').innerHTML = '';
  $('#view').innerHTML = `<div class="onb">
    <img class="logo" src="icons/icon.svg" alt="" width="72" height="72">
    <h1>Your money,<br>always with you.</h1>
    <p>Log expenses anywhere — even offline. Everything syncs to your Google Sheet when you’re back online.</p>
    <form id="connectForm" autocomplete="off">
      <label class="field"><span>Sheet API address</span><input id="cUrl" inputmode="url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(prefill.url || '')}" required></label>
      <label class="field"><span>Access key</span><input id="cKey" type="password" placeholder="Your secret key" value="${esc(prefill.key || '')}" required></label>
      <button class="btn primary" type="submit" id="cBtn">Connect</button>
    </form>
    <button class="btn ghost" data-act="demo">Try the demo</button>
  </div>`;
  $('#connectForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#cBtn');
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      await store.connect({ url: $('#cUrl').value.trim(), key: $('#cKey').value.trim() });
      toast('Connected');
    } catch (err) {
      toast(err.message || 'Could not connect', 'err');
      btn.disabled = false;
      btn.textContent = 'Connect';
    }
  });
}

// ---------------------------------------------------------------- add / edit sheet
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];

// Which account a new entry starts in: the one being viewed, else the one used last, else the main one.
function defaultFormAccount() {
  const live = liveAccts();
  if (ui.account !== 'all' && live.some((a) => a.name === ui.account)) return ui.account;
  const last = store.getState().settings.lastAccount;
  const hit = live.find((a) => a.name === last);
  return hit ? hit.name : (accList()[0] || {}).name || '';
}

function openSheet(id) {
  const v = store.view();
  let e = null;
  if (id) for (const k of v.months) { const f = v.by[k].entries.find((x) => x.id === id); if (f) { e = f; break; } }
  const m = activeMonth();
  const defDate = (() => {
    const t = todayStr();
    return m && t.slice(0, 7) !== m.key ? m.key + '-01' : t;
  })();
  ui.form = e
    ? { id: e.id, type: e.type, amt: String(e.amount), category: e.category, sub: e.sub, date: e.date, desc: e.description, account: e.account }
    : { id: null, type: 'Expense', amt: '', category: '', sub: '', date: defDate, desc: '', account: defaultFormAccount() };
  ui.armedDelete = false;
  const body = `<div id="formMain"><div class="seg" id="fType"></div>
      <div class="amt" id="fAmt"></div>
      <div class="keypad" id="keypad">${KEYS.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === 'del' ? 'Delete digit' : k}">${k === 'del' ? icon('backspace', 20) : k}</button>`).join('')}</div>
      <div id="fCatWrap"><div class="lbl">Category</div><div class="chips hs" id="fCats"></div>
      <div class="lbl">Sub-category</div><div class="chips hs" id="fSubs"></div></div>
      <div class="lbl">Date</div>
      <div class="chips datechips" id="fDates"></div>
      <div class="chips acc-pick" id="fAccts" aria-label="Account"></div>
      <label class="note"><input id="fDesc" placeholder="Add a note" value="${esc(ui.form.desc)}" autocomplete="off" maxlength="120"></label></div>
      <div id="calWrap"></div><div id="quickWrap"></div>`;
  const foot = (e ? '' : `<button class="btn ghost sq" id="quickToggle" data-act="quick-open" aria-label="Quick add: paste a bank message or type it">${icon('spark', 24)}</button>`) +
    `<button class="btn primary big" data-act="save" id="saveBtn">${e ? 'Save changes' : 'Add transaction'}</button>` +
    (e ? '' : '<button class="btn primary big" data-act="quick-add" id="quickBtn">Add selected</button>');
  present(e ? 'Edit transaction' : 'New transaction',
    e ? `<button class="icon-btn danger" id="delBtn" data-act="delete" aria-label="Delete">${icon('trash', 20)}</button>` : '', body, 'compact', foot);
  $('#fDesc').addEventListener('input', (ev) => { ui.form.desc = ev.target.value; });
  ui.adding = null;
  ui.newName = '';
  ui.picking = false;
  $('#fCatWrap').addEventListener('input', (ev) => { if (ev.target.id === 'newName') ui.newName = ev.target.value; });
  $('#fCatWrap').addEventListener('keydown', (ev) => {
    if (ev.target.id !== 'newName') return;
    if (ev.key === 'Enter') { ev.preventDefault(); confirmNew(); }
    if (ev.key === 'Escape') { ev.stopPropagation(); ui.adding = null; refreshForm(); }
  });
  refreshForm();
}

// ---- Quick add: paste bank SMS, or type / say it ---------------------------------------------------------------
const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

function quickCtx() {
  const v = store.view();
  return { today: todayStr(), categories: v.categories, accounts: v.accounts, history: v.months.flatMap((k) => v.by[k].entries) };
}

const quickData = (r) => ({
  date: r.date, description: r.description, amount: r.amount, type: r.type,
  category: r.type === 'Income' ? 'Income' : r.category, sub: r.type === 'Income' ? 'Income' : r.sub,
  account: r.account || defaultFormAccount(),
});
const quickCanAdd = (r) => !!r.amount && r.currency === 'EGP' && (r.type === 'Income' || (!!r.category && !!r.sub));

// The toggle sits in the bottom bar beside the main button, where a thumb reaches it on a large phone.
function setQuickHeader(on) {
  const t = $('#quickToggle');
  if (!t) return;
  t.dataset.act = on ? 'quick-back' : 'quick-open';
  t.setAttribute('aria-label', on ? 'Back to the keypad' : 'Quick add: paste a bank message or type it');
  t.innerHTML = icon(on ? 'keypad' : 'spark', 24);
}

function enterQuick() {
  const sheet = $('.sheet');
  if (!sheet || !ui.form || ui.form.id) return;
  if (!ui.quick) ui.quick = { text: '', rows: [], sel: new Set(), current: null };
  sheet.classList.add('quickmode');
  $('.sheet-h h2', sheet).textContent = 'Quick add';
  setQuickHeader(true);
  const lang = store.getState().settings.voiceLang || 'ar-EG';
  $('#quickWrap').innerHTML = `
    <textarea id="qText" rows="3" spellcheck="false" autocapitalize="off" placeholder="قول أو اكتب: «قهوة بخمسين وتاكسي بتمانين كاش»، أو الصق رسائل البنك.&#10;Say or type: “coffee 45 and taxi 80 cash”, or paste bank messages.">${esc(ui.quick.text)}</textarea>
    <div class="q-tools">
      <button class="chip" data-act="quick-paste">${icon('paste', 16)}Paste</button>
      ${SpeechRec ? `<button class="chip" id="qMic" data-act="quick-mic">${icon('mic', 16)}Speak</button>
        <span class="q-lang"><button class="chip ${lang === 'ar-EG' ? 'on' : ''}" data-act="quick-lang" data-v="ar-EG">عربي</button><button class="chip ${lang === 'en-US' ? 'on' : ''}" data-act="quick-lang" data-v="en-US">EN</button></span>` : ''}
    </div>
    <p class="muted sm q-hint" id="qHint">${SpeechRec ? '' : 'To dictate, tap the microphone on your keyboard. '}Nothing is saved until you add it.</p>
    <div id="qRows"></div>`;
  $('#qText').addEventListener('input', (e) => { ui.quick.text = e.target.value; updateQuickRows(); });
  if (ui.quick.text && !ui.quick.rows.length) updateQuickRows(); else renderQuickRows();
  haptic(6);
}

function leaveQuick() {
  stopMic();
  const sheet = $('.sheet');
  if (!sheet) return;
  sheet.classList.remove('quickmode');
  $('.sheet-h h2', sheet).textContent = 'New transaction';
  setQuickHeader(false);
  refreshForm();
}

function updateQuickRows() {
  const rows = parseMessages(ui.quick.text, quickCtx());
  ui.quick.rows = rows;
  ui.quick.sel = new Set(rows.filter((r) => r.ready));
  renderQuickRows();
}

function quickBadge(r) {
  if (r.dup) return ['Already logged', 'dup'];
  if (r.currency !== 'EGP') return [`${r.currency} amount, check it`, 'warn'];
  if (!r.category || !r.sub) return ['Pick a category', 'warn'];
  if (!r.ready) return ['Check the category', 'check'];
  return ['', ''];
}

function renderQuickRows() {
  const q = ui.quick;
  const box = $('#qRows');
  if (!box) return;
  if (!q.rows.length) {
    box.innerHTML = q.text.trim() ? '<p class="muted pad">I couldn’t find an amount in that. Try “coffee 45”.</p>' : '';
  } else {
    box.innerHTML = q.rows.map((r, i) => {
      const [badge, tone] = quickBadge(r);
      const can = quickCanAdd(r);
      const where = r.type === 'Income' ? 'Income' : (r.category ? `${r.category} › ${r.sub}` : 'No category yet');
      return `<div class="q-row t-${tone}">
        <input type="checkbox" class="q-check" data-qsel="${i}" ${q.sel.has(r) ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="Select">
        <button class="q-main" data-act="quick-edit" data-i="${i}">
          <b>${esc(r.description || (r.type === 'Income' ? 'Income' : 'No note'))}</b>
          <small>${esc(where)}${multiAcc() && r.account ? ' · ' + esc(r.account) : ''} · ${esc(dateShort(r.date))}${badge ? ` <i class="q-badge t-${tone}">${esc(badge)}</i>` : ''}</small>
        </button>
        <span class="q-amt ${r.type === 'Income' ? 'inc' : ''}">${r.type === 'Income' ? '+' : '−'}${esc(num(r.amount))}</span>
      </div>`;
    }).join('');
  }
  const n = q.sel.size;
  const btn = $('#quickBtn');
  if (btn) {
    btn.disabled = n === 0;
    btn.textContent = n === 0 ? (q.rows.length ? 'Tap a message to review it' : 'Add selected') : `Add ${n} transaction${n === 1 ? '' : 's'}`;
  }
}

function addQuickSelected() {
  const q = ui.quick;
  const picks = q.rows.filter((r) => q.sel.has(r) && quickCanAdd(r));
  if (!picks.length) return;
  store.addMany(picks.map(quickData));
  ui.month = monthKeyOf(picks[picks.length - 1].date);
  q.rows = q.rows.filter((r) => !picks.includes(r));
  q.sel = new Set();
  haptic(14);
  toast(`${picks.length} transaction${picks.length === 1 ? '' : 's'} added`, 'ok');
  if (!q.rows.length) { closeSheet(); ui.animate = false; return; }
  renderQuickRows();
}

function editQuickRow(i) {
  const r = ui.quick.rows[i];
  if (!r) return;
  ui.quick.current = r;
  ui.form = { id: null, type: r.type, amt: String(r.amount), category: r.type === 'Income' ? '' : r.category, sub: r.type === 'Income' ? '' : r.sub, date: r.date, desc: r.description, account: r.account || defaultFormAccount() };
  const d = $('#fDesc');
  if (d) d.value = r.description;
  leaveQuick();
}

function quickHint(msg) { const h = $('#qHint'); if (h) h.textContent = msg; }

let micWanted = false;         // the person has not tapped stop yet

function stopMic() {
  micWanted = false;
  if (rec) { try { rec.abort(); } catch (e) { /* ignore */ } rec = null; }
  const b = $('#qMic');
  if (b) { b.classList.remove('on'); b.lastChild.textContent = 'Speak'; }
}

const MIC_ERRORS = {
  'not-allowed': 'Microphone access is off for this app. You can dictate with the microphone on your keyboard instead.',
  'service-not-allowed': 'Voice input isn’t available inside this app on your phone. Tap the microphone on your keyboard to dictate instead.',
  'no-speech': 'I didn’t hear anything. Tap Speak and try again.',
  'audio-capture': 'No microphone was found.',
  'network': 'Voice input needs an internet connection. You can still type it.',
};

function startMic() {
  if (!SpeechRec || !ui.quick) return;
  if (rec) { stopMic(); return; }
  micWanted = true;
  listenOnce();
}

// iPhone ends a session at the first pause even in "continuous" mode, so the next one starts by itself until you tap stop.
function listenOnce() {
  const r = new SpeechRec();
  r.lang = store.getState().settings.voiceLang || 'ar-EG';
  r.interimResults = true;
  r.continuous = true;                                       // a long sentence with pauses stays open; tap again to stop
  const base = ui.quick.text.trim() ? ui.quick.text.replace(/\s+$/, '') + ' ' : '';   // a pause in the middle of a sentence keeps it one sentence
  let gotAny = false;
  r.onresult = (ev) => {
    gotAny = true;
    let t = '';
    for (let i = 0; i < ev.results.length; i++) t += (i ? ' ' : '') + ev.results[i][0].transcript.trim();
    ui.quick.text = base + t;
    const ta = $('#qText');
    if (ta) ta.value = ui.quick.text;
    updateQuickRows();
  };
  r.onerror = (ev) => { quickHint(MIC_ERRORS[ev.error] || 'Voice input stopped. You can type it instead.'); };
  r.onend = () => {
    if (rec !== r) return;
    rec = null;
    if (micWanted && gotAny) { try { listenOnce(); return; } catch (e) { /* fall through and stop */ } }   // heard something and not stopped: carry on
    stopMic();
  };
  try {
    r.start();
    rec = r;
    const b = $('#qMic');
    if (b) { b.classList.add('on'); b.lastChild.textContent = 'Listening…'; }
    quickHint('Listening… say something like “coffee forty five”.');
    haptic(8);
  } catch (e) {
    quickHint(MIC_ERRORS['service-not-allowed']);
  }
}

// ---- in-app calendar (shown inside the add sheet, replacing the form while a day is being chosen) ------------
function renderCal() {
  const v = store.view();
  const [Y, M] = ui.calMonth.split('-').map(Number);
  const ws = weekStart();
  const first = new Date(Y, M - 1, 1);
  const dim = new Date(Y, M, 0).getDate();
  const lead = (first.getDay() - ws + 7) % 7;
  const sel = ui.form.date;
  const today = todayStr();
  const marked = new Set((v.by[ui.calMonth] ? v.by[ui.calMonth].entries : []).map((e) => e.date));
  const dows = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(new Date(2023, 0, 1 + ((ws + i) % 7))));
  let cells = dows.map((d) => `<div class="cal-dow">${esc(d)}</div>`).join('');
  for (let i = 0; i < lead; i++) cells += '<i></i>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${Y}-${String(M).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells += `<button class="cal-day ${ds === sel ? 'sel' : ''} ${ds === today ? 'today' : ''} ${marked.has(ds) ? 'dot' : ''}" data-act="cal-day" data-date="${ds}" aria-label="${esc(dateLong(ds))}">${d}</button>`;
  }
  $('#calWrap').innerHTML = `<div class="cal-head">
      <button class="cal-nav" data-act="cal-prev" aria-label="Previous month">${icon('back', 18, 2.4)}</button>
      <b>${esc(keyLabel(ui.calMonth))}</b>
      <button class="cal-nav" data-act="cal-next" aria-label="Next month">${icon('back', 18, 2.4).replace('class="ic"', 'class="ic flip"')}</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-quick"><button class="chip" data-act="cal-today">Jump to today</button></div>`;
}

function openCal() {
  const sheet = $('.sheet');
  if (!sheet || !ui.form) return;
  ui.picking = true;
  ui.calMonth = ui.form.date.slice(0, 7);
  sheet.classList.add('picking');
  $('.sheet-h h2', sheet).textContent = 'Select date';
  renderCal();
  const body = $('.sheet-body', sheet);
  if (body) body.scrollTop = 0;
}

function closeCal() {
  const sheet = $('.sheet');
  ui.picking = false;
  if (!sheet || !ui.form) return;
  sheet.classList.remove('picking');
  $('.sheet-h h2', sheet).textContent = ui.form.id ? 'Edit transaction' : 'New transaction';
  refreshForm();
}

function shiftCalMonth(delta) {
  const [Y, M] = ui.calMonth.split('-').map(Number);
  const d = new Date(Y, M - 1 + delta, 1);
  ui.calMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderCal();
  haptic(5);
}

function confirmNew() {
  const f = ui.form;
  if (!f || !ui.adding) return;
  const v = store.view();
  const kind = ui.adding;
  const err = kind === 'cat'
    ? store.nameError(ui.newName, v.categories.order, ['Income', 'Categories'])
    : store.nameError(ui.newName, v.categories.map[f.category] || []);
  if (err) { toast(err, 'err'); shake(); return; }
  if (kind === 'cat') {
    f.category = store.addCategory(ui.newName);
    f.sub = '';
    toast('Category added', 'ok');
  } else {
    f.sub = store.addSub(f.category, ui.newName);
    toast('Sub-category added', 'ok');
  }
  haptic(10);
  ui.adding = null;
  ui.newName = '';
  refreshForm();
}

// ---- iOS-style sheet presentation ------------------------------------------------------------
// Opens with a spring slide-up while the app behind scales back; dragging follows the finger
// (by the grey pill only); a flick or a long
// pull dismisses it, a short pull springs back.
let sheetClosing = false;

// The system status bar takes its colour from <meta name="theme-color">; keep it in step with the dimmed backdrop.
let themeMeta = $('meta[name="theme-color"]');
if (!themeMeta) {
  themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  document.head.appendChild(themeMeta);
}
const THEME_BG = { light: '#F4F5FA', dark: '#0A0B10' };
let themeMode = 'system';
let themeNow = 0;
let themeRaf = 0;
const SCRIM_ALPHA = 0.42;

const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
const effectiveTheme = () => (themeMode === 'light' || themeMode === 'dark' ? themeMode : (prefersDark() ? 'dark' : 'light'));

// iOS only follows live changes to a single <meta name="theme-color"> (no media attribute) via setAttribute.
function setStatusColor(hex) { themeMeta.setAttribute('content', hex); }

function paintTheme(p) {
  themeNow = p;
  const base = THEME_BG[effectiveTheme()].replace('#', '');
  if (p <= 0.001) { setStatusColor('#' + base); tintPage(''); return; }
  const k = 1 - SCRIM_ALPHA * p;
  const c = [0, 2, 4].map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  setStatusColor('#' + c);
  tintPage('#' + c);
}

// iOS reads the page background for the status bar; tint it together with the dimming scrim.
function tintPage(color) {
  document.documentElement.style.backgroundColor = color;
  document.body.style.backgroundColor = color;
}

function tweenTheme(target) {
  cancelAnimationFrame(themeRaf);
  if (reduceMotion) { paintTheme(target); return; }
  const from = themeNow;
  const t0 = performance.now();
  const dur = 460;
  const step = (t) => {
    const x = Math.min(1, (t - t0) / dur);
    paintTheme(from + (target - from) * (1 - Math.pow(1 - x, 3.2)));
    if (x < 1) themeRaf = requestAnimationFrame(step);
  };
  themeRaf = requestAnimationFrame(step);
  setTimeout(() => { if (Math.abs(themeNow - target) > 0.01) paintTheme(target); }, dur + 80); // if frames are throttled
}

// Manual escape hatch: reload and come back to the same screen (re-reads the theme for the status bar).
function refreshView() {
  try { sessionStorage.setItem('el_resume', JSON.stringify({ tab: ui.tab, month: ui.month })); } catch (e) { /* ignore */ }
  document.body.classList.add('reloading');
  vault.stashForReload();
  setTimeout(() => location.reload(), 220);
}

// ---- appearance: light / dark / follow the phone -----------------------------------------------
function applyTheme(mode) {
  const root = document.documentElement;
  themeMode = mode === 'light' || mode === 'dark' ? mode : 'system';
  if (themeMode === 'system') { root.removeAttribute('data-theme'); root.style.colorScheme = ''; }
  else { root.setAttribute('data-theme', themeMode); root.style.colorScheme = themeMode; }
  try { localStorage.setItem('el_theme', themeMode); } catch (e) { /* private mode */ }
  paintTheme(themeNow); // new base colour (keeps any open-sheet dimming)
}

// When following the phone, flip the status bar the moment the phone's appearance changes.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (themeMode === 'system') paintTheme(themeNow); });

function setProgress(p) {
  p = Math.max(0, Math.min(1, p));
  $('#app').style.setProperty('--p', String(p));
  $('#app').classList.toggle('dim', p > 0.001);
  if ($('#app').classList.contains('dragging')) { cancelAnimationFrame(themeRaf); paintTheme(p); } else tweenTheme(p);
}

function present(title, headExtra, body, cls = '', foot = '') {
  const layer = $('#layer');
  sheetClosing = false;
  layer.className = 'open';
  layer.innerHTML = `<div class="scrim"></div>
    <div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-top">
        <div class="grab-zone" aria-hidden="true"><div class="grab"></div></div>
        <div class="sheet-h">
          <button class="close" data-act="close" aria-label="Close">${icon('close', 20, 2.2)}</button>
          <h2>${esc(title)}</h2>
          <div class="hbtns">${headExtra}</div>
        </div>
      </div>
      <div class="sheet-body">${body}</div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ''}
    </div>`;
  document.body.classList.add('noscroll');
  const sheet = $('.sheet');
  const scrim = $('.scrim');
  sheet.style.transform = 'translateY(110%)';
  void sheet.offsetHeight; // commit the starting position
  let started = false;
  const go = () => {
    if (started || !sheet.isConnected) return;
    started = true;
    sheet.classList.add('animating');
    sheet.style.transform = 'translateY(0)';
    scrim.style.opacity = '1';
    setProgress(1);
  };
  requestAnimationFrame(go);
  setTimeout(go, 60); // fallback if the browser delays animation frames
  attachDrag(sheet, scrim);
}

function attachDrag(sheet, scrim) {
  const app = $('#app');
  const handle = $('.sheet-top', sheet);
  let startY = 0;
  let dy = 0;
  let vel = 0;
  let lastY = 0;
  let lastT = 0;
  let active = false;

  const begin = (y) => {
    active = true;
    startY = lastY = y;
    lastT = performance.now();
    dy = 0;
    vel = 0;
    app.classList.add('dragging');
    sheet.classList.remove('animating');
  };
  const move = (y) => {
    dy = y - startY;
    const now = performance.now();
    vel = (y - lastY) / Math.max(1, now - lastT); // px per ms, positive = downward
    lastY = y;
    lastT = now;
    const ty = dy >= 0 ? dy : -Math.sqrt(-dy) * 3; // rubber-band when pulled upward
    sheet.style.transform = `translateY(${ty}px)`;
    const p = 1 - Math.max(0, dy) / (sheet.offsetHeight || 1);
    scrim.style.opacity = String(Math.max(0, p));
    setProgress(p);
  };
  const end = () => {
    if (!active) return;
    active = false;
    app.classList.remove('dragging');
    if (dy > (sheet.offsetHeight || 1) * 0.25 || vel > 0.5) { closeSheet(); return; }
    sheet.classList.add('animating'); // spring back
    sheet.style.transform = 'translateY(0)';
    scrim.style.opacity = '1';
    setProgress(1);
    haptic(6);
  };

  // The whole top strip (grey pill + title row) is the handle; its buttons stay normal taps and the content never starts a drag.
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or already released */ }
    begin(e.clientY);
  });
  handle.addEventListener('pointermove', (e) => { if (active) move(e.clientY); });
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function closeSheet() {
  const sheet = $('.sheet');
  const layer = $('#layer');
  if (!sheet || sheetClosing) return;
  sheetClosing = true;
  stopMic();
  ui.quick = null;
  const scrim = $('.scrim');
  $('#app').classList.remove('dragging');
  sheet.classList.add('animating');
  sheet.style.transform = 'translateY(110%)';
  if (scrim) scrim.style.opacity = '0';
  setProgress(0);
  ui.form = null;
  ui.picking = false;
  setTimeout(() => {
    layer.className = '';
    layer.innerHTML = '';
    document.body.classList.remove('noscroll');
    sheetClosing = false;
    if (pinAskResolve) { const r = pinAskResolve; pinAskResolve = null; r(null); }
  }, reduceMotion ? 0 : 480);
}

function fmtTyped(s) {
  if (!s) return '0';
  const [i, d] = s.split('.');
  const head = Number(i || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  return s.includes('.') ? head + (navigator.language && /^(de|fr|es|it|pt|ru|tr)/.test(navigator.language) ? ',' : '.') + (d || '') : head;
}

function setChips(sel, html) {
  const el = $(sel);
  const left = el.scrollLeft;
  el.innerHTML = html;
  el.scrollLeft = left;
  const on = $('.chip.on', el);
  if (on) {
    const r = on.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (r.left < c.left + 8) el.scrollLeft -= c.left + 8 - r.left;
    else if (r.right > c.right - 8) el.scrollLeft += r.right - (c.right - 8);
  }
}

function refreshForm() {
  const f = ui.form;
  if (!f) return;
  const v = store.view();
  $('#fType').innerHTML = ['Expense', 'Income'].map((t) => `<button class="${f.type === t ? 'on ' + t.toLowerCase() : ''}" data-act="type" data-t="${t}">${t}</button>`).join('');
  $('#fAmt').className = 'amt ' + f.type.toLowerCase() + (f.amt ? '' : ' empty');
  $('#fAmt').innerHTML = `<span class="cur">${esc(cur())}</span><span>${esc(fmtTyped(f.amt))}</span>`;
  const isExp = f.type === 'Expense';
  $('#fCatWrap').style.display = isExp ? '' : 'none';
  if (isExp) {
    const newField = (kind) => `<span class="chip-input"><input id="newName" maxlength="30" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="${kind === 'cat' ? 'New category' : 'New sub-category'}" value="${esc(ui.newName)}"><button class="ok" data-act="new-ok" aria-label="Add">${icon('check', 16, 2.6)}</button><button data-act="new-cancel" aria-label="Cancel">${icon('close', 16, 2.4)}</button></span>`;
    setChips('#fCats', ui.adding === 'cat' ? newField('cat')
      : v.categories.order.map((n) => `<button class="chip cat ${f.category === n ? 'on' : ''}" style="${hueStyle(n)}" data-act="cat" data-v="${esc(n)}">${icon(n, 16)}${esc(n)}</button>`).join('')
        + `<button class="chip add" data-act="new-cat">${icon('plus', 14, 2.4)}New</button>`);
    const subs = v.categories.map[f.category] || [];
    setChips('#fSubs', !f.category ? '<span class="hint">Pick a category first</span>'
      : ui.adding === 'sub' ? newField('sub')
      : subs.map((n) => `<button class="chip ${f.sub === n ? 'on' : ''}" data-act="sub" data-v="${esc(n)}">${esc(n)}</button>`).join('')
        + `<button class="chip add" data-act="new-sub">${icon('plus', 14, 2.4)}New</button>`);
    if (ui.adding) {
      const inp = $('#newName');
      if (inp && document.activeElement !== inp) { inp.focus(); inp.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }
    }
  }
  const showAcc = multiAcc() || (f.account && f.account !== (accList()[0] || {}).name);
  $('#fAccts').style.display = showAcc ? '' : 'none';
  if (showAcc) {
    const opts = liveAccts().slice();
    const cur = accOf(f.account);
    if (cur && !opts.includes(cur)) opts.push(cur);   // keep an archived account usable on entries that already have it
    $('#fAccts').innerHTML = opts.map((a) => `<button class="chip ${f.account === a.name ? 'on' : ''}" data-act="facc" data-v="${esc(a.name)}">${icon(a.type === 'cash' ? 'cash' : 'card', 16)}${esc(a.name)}</button>`).join('');
  }
  const today = todayStr();
  const yest = shiftDate(today, -1);
  const custom = f.date !== today && f.date !== yest;
  $('#fDates').innerHTML =
    `<button class="chip ${f.date === today ? 'on' : ''}" data-act="date-today">Today</button>` +
    `<button class="chip ${f.date === yest ? 'on' : ''}" data-act="date-yesterday">Yesterday</button>` +
    `<button class="chip pick ${custom ? 'on' : ''}" data-act="date-pick">${icon('calendar', 16)}${custom ? esc(dateShort(f.date)) : 'Pick date'}</button>`;
}

function pressKey(k) {
  const f = ui.form;
  let a = f.amt;
  if (k === 'del') a = a.slice(0, -1);
  else if (k === '.') { if (!a.includes('.')) a = (a || '0') + '.'; }
  else {
    if (a.includes('.') && a.split('.')[1].length >= 2) return;
    if (a.replace('.', '').length >= 10) return;
    a = a === '0' ? k : a + k;
  }
  f.amt = a;
  haptic(6);
  refreshForm();
}

function shake() {
  const s = $('.sheet');
  if (!s) return;
  s.classList.remove('shake');
  void s.offsetWidth;
  s.classList.add('shake');
  haptic(20);
}

function saveForm() {
  const f = ui.form;
  const amount = Number(f.amt);
  const fail = (msg) => { toast(msg, 'err'); shake(); };
  if (!(amount > 0)) return fail('Enter an amount greater than zero.');
  if (!f.date) return fail('Choose a date.');
  if (f.type === 'Expense' && !f.category) return fail('Pick a category.');
  if (f.type === 'Expense' && !f.sub) return fail('Pick a sub-category.');
  const data = {
    date: f.date, description: f.desc, amount, type: f.type,
    category: f.type === 'Income' ? 'Income' : f.category,
    sub: f.type === 'Income' ? 'Income' : f.sub,
    account: f.account || undefined,
  };
  if (f.account && multiAcc()) store.saveSettings({ lastAccount: f.account });
  if (f.id) store.updateEntry(f.id, data); else store.addEntry(data);
  ui.month = monthKeyOf(f.date);
  let again = null;
  if (!f.id && ui.quick && ui.quick.current) {
    ui.quick.rows = ui.quick.rows.filter((r) => r !== ui.quick.current);
    ui.quick.current = null;
    if (ui.quick.rows.length) again = ui.quick;
  }
  haptic(14);
  toast(f.id ? 'Changes saved' : 'Transaction added', 'ok');
  closeSheet();
  ui.animate = false;
  if (again) setTimeout(() => { openSheet(null); ui.quick = again; enterQuick(); }, 480);
}

// ---- month dropdown (anchored to the month pill) ---------------------------------------------
function syncPill() {
  const pill = $('.month-pill');
  if (!pill) return;
  pill.classList.toggle('open', ui.menuOpen);
  pill.setAttribute('aria-expanded', String(ui.menuOpen));
}

function toggleMonthMenu(pill) {
  if (ui.menuOpen) closeMonthMenu(); else openMonthMenu(pill);
}

function openMonthMenu(pill) {
  const v = store.view();
  if (!v.months.length) return;
  const root = $('#menu');
  const app = $('#app').getBoundingClientRect();
  const r = pill.getBoundingClientRect();
  const width = Math.min(300, app.width - 24);
  const left = Math.max(12, Math.min(r.left - app.left, app.width - 12 - width));
  const top = r.bottom - app.top + 8;
  const originX = Math.max(16, Math.min(width - 16, r.left - app.left + r.width / 2 - left));
  const rows = v.months.slice().reverse().map((k, i) => {
    const on = k === ui.month;
    return `<button class="menu-row ${on ? 'on' : ''}" style="--i:${i}" role="option" aria-selected="${on}" data-act="pick-month" data-key="${k}">
      <span class="m">${esc(keyLabel(k))}</span><b>${esc(fmt(v.by[k].available))}</b>${on ? icon('check', 18, 2.6) : '<i class="ph"></i>'}</button>`;
  }).join('');
  root.innerHTML = `<div class="menu-backdrop" data-act="menu-close"></div>
    <div class="menu ${v.months.length > 7 ? 'scroll' : ''}" role="listbox" style="left:${left}px;top:${top}px;width:${width}px;transform-origin:${originX}px 0;max-height:${Math.max(160, app.height - top - 110)}px"><i class="menu-hl"></i>${rows}</div>`;
  root.className = 'open';
  ui.menuOpen = true;
  syncPill();
  const menu = $('.menu', root);
  let started = false;
  const go = () => { if (started || !menu.isConnected) return; started = true; menu.classList.add('in'); };
  requestAnimationFrame(go);
  setTimeout(go, 50);
  haptic(6);
}

function pickMonth(key) {
  ui.month = key;
  ui.animate = true;
  closeMonthMenu();
  if ($('.sheet')) closeSheet();
  render();
}

// Press-and-slide, like a native iOS menu: hold the pill (or press a row) and slide; a highlight follows the finger,
// releasing on a row selects it, releasing elsewhere closes the menu. A plain tap keeps working as before.
(function menuGestures() {
  const g = { source: null, pill: null, timer: 0, holding: false, x: 0, y: 0, x0: 0, y0: 0, row: null };

  const moveHighlight = (row) => {
    const hl = $('.menu-hl');
    if (!hl) return;
    if (row === g.row) return;
    g.row = row;
    if (!row) { hl.classList.remove('show'); return; }
    hl.style.height = row.offsetHeight + 'px';
    hl.style.transform = `translateY(${row.offsetTop}px)`;
    hl.classList.add('show');
    haptic(4);
  };

  const track = () => {
    const el = document.elementFromPoint(g.x, g.y);
    const row = el && el.closest ? el.closest('.menu-row') : null;
    moveHighlight(row && $('#menu').contains(row) ? row : null);
  };

  const reset = () => {
    clearTimeout(g.timer);
    g.source = null; g.pill = null; g.holding = false;
    const hl = $('.menu-hl');
    if (hl) hl.classList.remove('show');
    g.row = null;
  };

  const startHold = () => {
    if (!g.pill || !g.pill.isConnected || ui.menuOpen) return;
    g.holding = true;
    openMonthMenu(g.pill);
    setTimeout(track, 30);
  };

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g.x = g.x0 = e.clientX; g.y = g.y0 = e.clientY;
    const pill = e.target.closest && e.target.closest('.month-pill');
    const row = e.target.closest && e.target.closest('.menu-row');
    if (pill && !pill.disabled && !ui.menuOpen) {
      g.source = 'pill'; g.pill = pill; g.holding = false;
      g.timer = setTimeout(startHold, 260);
    } else if (row && ui.menuOpen && !$('.menu.scroll')) {
      g.source = 'menu'; g.holding = true;
      track();
    }
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!g.source) return;
    g.x = e.clientX; g.y = e.clientY;
    if (g.source === 'pill' && !g.holding) {
      if (Math.hypot(g.x - g.x0, g.y - g.y0) > 12) { clearTimeout(g.timer); startHold(); } // a drag opens it right away
      return;
    }
    if (g.holding) track();
  }, true);

  const finish = (e, cancelled) => {
    if (!g.source) return;
    g.x = e.clientX ?? g.x; g.y = e.clientY ?? g.y;
    const wasHolding = g.holding;
    const source = g.source;
    const pill = g.pill;
    if (wasHolding && !cancelled) {
      track();
      const row = g.row;
      ui.noClickUntil = performance.now() + 500; // swallow the click the browser sends after this release
      if (row) pickMonth(row.dataset.key);
      else if (source === 'pill') {
        const r = pill && pill.isConnected ? pill.getBoundingClientRect() : null;
        const overPill = r && g.x >= r.left && g.x <= r.right && g.y >= r.top && g.y <= r.bottom;
        if (!overPill) closeMonthMenu(); // let go over empty space: dismiss; over the pill: leave the menu open
      }
    } else if (wasHolding && cancelled && source === 'pill') {
      closeMonthMenu();
    }
    reset();
  };
  document.addEventListener('pointerup', (e) => finish(e, false), true);
  document.addEventListener('pointercancel', (e) => finish(e, true), true);
})();

function closeMonthMenu() {
  if (!ui.menuOpen) return;
  ui.menuOpen = false;
  const root = $('#menu');
  const menu = $('.menu', root);
  if (menu) { menu.classList.remove('in'); menu.classList.add('out'); }
  syncPill();
  setTimeout(() => { if (!ui.menuOpen) { root.className = ''; root.innerHTML = ''; } }, reduceMotion ? 0 : 220);
}

// ---- app lock: PIN sheets and actions ------------------------------------------------------------
let pinAskResolve = null;

function askPin() {
  return new Promise((resolve) => {
    pinAskResolve = resolve;
    present('Enter your PIN', '', `<p class="muted pad">Confirm it’s you to continue.</p>
      <label class="field"><input id="pinAsk" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="PIN"></label>`,
      'small', '<button class="btn primary big" data-act="pin-ask-ok">Continue</button>');
    setTimeout(() => { const i = $('#pinAsk'); if (i) i.focus(); }, 350);
  });
}

function pinSetupSheet(then) {
  present(then === 'change' ? 'Change PIN' : 'Set a PIN', '', `<p class="muted pad">Choose 4 to 8 digits. You’ll type it to open the app.</p>
    <label class="field"><span>New PIN</span><input id="pinA" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="••••"></label>
    <label class="field"><span>Repeat PIN</span><input id="pinB" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off" placeholder="••••"></label>`,
    'small', '<button class="btn primary big" data-act="pin-save">Save PIN</button>');
  setTimeout(() => { const i = $('#pinA'); if (i) i.focus(); }, 350);
}

const lockCfg = () => store.getState().settings.lock || { method: 'off', delay: 60 };

// ---- Import (Excel or CSV) ---------------------------------------------------------------------
async function readImportFile(file) {
  try {
    toast('Reading ' + file.name + '…');
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    const isZip = head[0] === 0x50 && head[1] === 0x4b; // "PK": an .xlsx / .xlsm
    const cats = store.view().categories;
    const res = isZip ? await parseWorkbook(buf, cats) : readCsvEntries(decodeText(buf), cats);
    const kind = isZip ? 'Excel' : 'CSV';
    ui.importData = { name: file.name, kind, res, create: false, notes: res.notes || [] };
    computeImportPlan();
    $('#toast').className = '';
    renderImportPreview();
  } catch (err) {
    toast(err.message || 'Could not read that file', 'err');
  }
}

// Works out what an import would do right now: new rows, duplicates, skipped rows, and (optionally) the new
// categories / sub-categories it would create.
function computeImportPlan() {
  const d = ui.importData;
  const v = store.view();
  const defAcc = v.accounts[0].name;
  const keyOf = (e) => [e.date, e.description, Number(e.amount).toFixed(2), e.type, e.category, e.sub, e.account || defAcc].join('|');
  const have = new Map();
  v.months.forEach((k) => v.by[k].entries.forEach((e) => have.set(keyOf(e), (have.get(keyOf(e)) || 0) + 1)));

  const candidates = d.res.entries.slice();
  const skipped = [];
  const rescued = [];
  let fixable = 0;
  for (const sk of d.res.skipped) {
    if (!sk.fix) { skipped.push(sk); continue; }
    const e = sk.fix;
    const catOk = !store.nameError(e.category, [], ['Income', 'Categories']);
    const subOk = !e.sub || !store.nameError(e.sub, []);
    if (catOk && subOk) {
      fixable++;
      if (d.create) { candidates.push(e); rescued.push(e); continue; }
    }
    skipped.push(sk);
  }

  // new categories needed (case-insensitive, first spelling wins)
  const lc = (x) => String(x).toLowerCase();
  const existing = new Map(v.categories.order.map((c) => [lc(c), c]));
  const newCats = new Map();   // lower -> { name, subs: Map(lower -> name) }
  const canonicalCat = new Map();
  const fresh = [];
  let dupes = 0;
  const unknownAcc = new Map();
  for (const e0 of candidates) {
    const e = { ...e0 };
    if (e.account) {
      const hit = v.accounts.find((a) => lc(a.name) === lc(e.account));
      if (hit) e.account = hit.name; else { unknownAcc.set(lc(e.account), e.account); delete e.account; }   // unknown names go to the main account
    }
    if (e.type === 'Expense') {
      const cl = lc(e.category);
      const known = existing.get(cl);
      if (known) {
        e.category = known;
        const subs = v.categories.map[known];
        const hit = subs.find((x) => lc(x) === lc(e.sub));
        if (hit) e.sub = hit;
        else if (!e.sub || lc(e.sub) === cl) e.sub = known;
        else {
          const nc = newCats.get(cl) || { name: known, subs: new Map(), existing: true };
          newCats.set(cl, nc);
          if (!nc.subs.has(lc(e.sub))) nc.subs.set(lc(e.sub), e.sub);
          e.sub = nc.subs.get(lc(e.sub));
        }
      } else {
        const nc = newCats.get(cl) || { name: e.category, subs: new Map(), existing: false };
        newCats.set(cl, nc);
        e.category = nc.name;
        if (!e.sub) e.sub = e.category;
        else {
          if (!nc.subs.has(lc(e.sub))) nc.subs.set(lc(e.sub), e.sub);
          e.sub = nc.subs.get(lc(e.sub));
        }
      }
    }
    const k = keyOf(e);
    if (have.get(k)) { have.set(k, have.get(k) - 1); dupes++; } else fresh.push(e);
  }
  d.fresh = fresh;
  d.unknownAccounts = [...unknownAcc.values()];
  d.dupes = dupes;
  d.skipped = skipped;
  d.fixable = fixable;
  d.rescued = rescued.length;
  d.newCats = [...newCats.values()].filter((c) => !c.existing || c.subs.size);
  d.newCatCount = d.newCats.filter((c) => !c.existing).length;
  d.newSubCount = d.newCats.reduce((n, c) => n + c.subs.size, 0);
}

function renderImportPreview() {
  const d = ui.importData;
  const byMonth = {};
  d.fresh.forEach((e) => { const k = e.date.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; });
  const months = Object.keys(byMonth).sort();
  const createLine = d.fixable
    ? `<label class="switch block"><input type="checkbox" id="createMissing" ${d.create ? 'checked' : ''}><span>Create the missing categories and sub-categories from this file <small class="muted">(${d.fixable} row${d.fixable === 1 ? '' : 's'} use names the app doesn’t have yet)</small></span></label>`
    : '';
  const accLine = d.unknownAccounts && d.unknownAccounts.length
    ? `<p class="muted sm">${d.unknownAccounts.length === 1 ? 'An account' : d.unknownAccounts.length + ' accounts'} in this file (${esc(d.unknownAccounts.join(', '))}) ${d.unknownAccounts.length === 1 ? 'doesn’t' : 'don’t'} exist here yet. Those rows will go to ${esc(accList()[0].name)}. Add the account in Settings first to keep them separate.</p>`
    : '';
  const planLine = d.create && (d.newCatCount || d.newSubCount)
    ? `<p class="muted sm">Will add ${d.newCatCount ? `${d.newCatCount} categor${d.newCatCount === 1 ? 'y' : 'ies'}` : ''}${d.newCatCount && d.newSubCount ? ' and ' : ''}${d.newSubCount ? `${d.newSubCount} sub-categor${d.newSubCount === 1 ? 'y' : 'ies'}` : ''}: ${esc(d.newCats.map((c) => c.name + (c.subs.size ? ' (' + [...c.subs.values()].join(', ') + ')' : '')).join('; '))}.</p>`
    : '';
  const body = `<div class="imp">
      <p class="imp-file">${esc(d.name)}</p>
      <div class="imp-stats">
        <div><b>${d.fresh.length}</b><span>new</span></div>
        <div><b>${d.dupes}</b><span>already here</span></div>
        <div><b>${d.skipped.length}</b><span>skipped</span></div>
      </div>
      ${d.notes.map((n) => `<p class="note-line sm">${esc(n)}</p>`).join('')}
      ${createLine}${planLine}${accLine}
      ${months.length ? `<div class="lbl">Will be added</div>${months.map((k) => `<div class="kv"><span>${esc(keyLabel(k))}</span><b>${byMonth[k]}</b></div>`).join('')}` : '<p class="muted pad">Nothing new to add — everything in this file is already in the app.</p>'}
      ${d.skipped.length ? `<div class="lbl">Skipped rows</div>${d.skipped.slice(0, 6).map((x) => `<p class="warn sm">${esc(x.sheet)} row ${x.row}: ${esc(x.reason)}</p>`).join('')}${d.skipped.length > 6 ? `<p class="muted sm">…and ${d.skipped.length - 6} more</p>` : ''}` : ''}
      <p class="muted sm">Duplicates are detected by date, description, amount and category, so importing the same file twice is safe.</p>
    </div>`;
  const foot = `<button class="btn primary big" data-act="do-import" ${d.fresh.length ? '' : 'disabled'}>${d.fresh.length ? `Import ${d.fresh.length} transaction${d.fresh.length === 1 ? '' : 's'}` : 'Nothing to import'}</button>`;
  const open = $('.sheet');
  if (open && $('.imp', open)) { // update in place (e.g. after toggling the option)
    $('.sheet-body', open).innerHTML = body;
    $('.sheet-foot', open).innerHTML = foot;
  } else {
    present(`Import from ${d.kind}`, '', body, 'compact', foot);
  }
}

// ---- Recently deleted ------------------------------------------------------------------------
function openTrash(rerender = false) {
  const t = store.getState().trash;
  const body = t.length ? `<div class="card flush">${t.map((x) => {
    const e = x.data;
    const isInc = e.type === 'Income';
    return `<div class="row ${isInc ? 'inc' : 'exp'} trashrow">
      <span class="bubble" style="${hueStyle(isInc ? 'Income' : e.category)}">${icon(isInc ? 'income' : e.category, 20)}</span>
      <span class="row-main"><span class="row-t">${esc(e.description || (isInc ? 'Income' : e.sub))}</span><span class="row-s">${esc(dateLong(e.date))} · ${isInc ? '+' : '\u2212'}${esc(num(e.amount))}</span></span>
      <button class="mini-btn" data-act="restore" data-id="${esc(x.trashId)}">Restore</button>
    </div>`;
  }).join('')}</div>
    <button class="btn danger" data-act="clear-trash">Clear this list</button>
    <p class="muted sm">Deleted entries stay here for 60 days on this device. Your Google Sheet also keeps its own version history.</p>`
    : '<p class="muted pad">Nothing deleted recently.</p>';
  if (rerender && $('.sheet-body')) { $('.sheet-body').innerHTML = body; return; }
  present('Recently deleted', '', body, 'small');
}

// ---------------------------------------------------------------- events
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'tab':
      closeMonthMenu();
      {
        const going = el.dataset.tab;
        const backToTop = going === 'settings' && ui.tab === 'settings' && ui.settingsPage;   // tapping Settings again goes back to the top level
        if (ui.tab !== going || backToTop) { if (going === 'settings') ui.settingsPage = null; ui.tab = going; ui.animate = true; $('#view').innerHTML = ''; render(); }
      }
      haptic(6);
      break;
    case 'settings-go': ui.settingsPage = el.dataset.p; ui.animate = true; haptic(6); $('#view').innerHTML = ''; render(); break;
    case 'settings-back': ui.settingsPage = null; ui.animate = true; haptic(6); $('#view').innerHTML = ''; render(); break;
    case 'ins-scope':
      ui.insScope = el.dataset.v === 'all' ? 'all' : 'month'; ui.animate = false; haptic(6);
      try { localStorage.setItem('el_ins', ui.insScope); } catch (e) { /* ignore */ }
      render();
      break;
    case 'ins-open':
      ui.q = el.dataset.q || ''; ui.filter = 'Expense'; ui.tab = 'activity'; ui.animate = true; haptic(6);
      $('#view').innerHTML = ''; render();
      break;
    case 'new': haptic(10); ui.quick = null; openSheet(null); break;
    case 'quick-open': enterQuick(); break;
    case 'quick-back': leaveQuick(); break;
    case 'quick-add': addQuickSelected(); break;
    case 'quick-edit': editQuickRow(+el.dataset.i); break;
    case 'quick-mic': startMic(); break;
    case 'quick-lang': {
      store.saveSettings({ voiceLang: el.dataset.v });
      $$('.q-lang .chip').forEach((b) => b.classList.toggle('on', b.dataset.v === el.dataset.v));
      stopMic();
      break;
    }
    case 'quick-paste': {
      const ta = $('#qText');
      if (!ta) break;
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then((t) => {
          if (!t || !t.trim()) { quickHint('The clipboard is empty. Copy your bank message first.'); return; }
          ta.value = ui.quick.text.trim() ? ui.quick.text.replace(/\s+$/, '') + '\n\n' + t.trim() : t.trim();
          ui.quick.text = ta.value;
          updateQuickRows();
        }).catch(() => { ta.focus(); quickHint('Your phone blocked the paste button. Press and hold in the box, then tap Paste.'); });
      } else { ta.focus(); quickHint('Press and hold in the box, then tap Paste.'); }
      break;
    }
    case 'edit': openSheet(el.dataset.id); break;
    case 'close': closeSheet(); break;
    case 'months':
      if (performance.now() < ui.noClickUntil) break;
      toggleMonthMenu(el);
      break;
    case 'menu-close': closeMonthMenu(); break;
    case 'pick-month':
      if (el.classList.contains('menu-row') && performance.now() < ui.noClickUntil) break; // already handled by the slide gesture
      pickMonth(el.dataset.key);
      break;
    case 'privacy': setPrivacy(!priv()); break;
    case 'acc':
      ui.account = el.dataset.v || 'all';
      try { localStorage.setItem('el_acc', ui.account); } catch (e) { /* ignore */ }
      haptic(6); ui.animate = false; render();
      break;
    case 'facc': ui.form.account = el.dataset.v; haptic(6); refreshForm(); break;
    case 'acc-type': ui.newAccType = el.dataset.v === 'cash' ? 'cash' : 'card'; haptic(6); renderSettings($('#view')); break;
    case 'acc-add': {
      const name = ($('#accName') || {}).value || '';
      const err = store.nameError(name, accList().map((a) => a.name));
      if (err) { toast(err, 'err'); break; }
      const limit = parseFloat(String((($('#accLimit') || {}).value || '')).replace(/,/g, ''));
      store.addAccount(name, ui.newAccType || 'card', Number.isFinite(limit) && limit > 0 ? limit : 0);
      ui.newAccType = 'card';
      haptic(10); toast('Account added', 'ok');
      renderSettings($('#view'));
      break;
    }
    case 'acc-archive': {
      const a = accOf(el.dataset.v);
      if (!a) break;
      store.updateAccount(a.name, { archived: !a.archived });
      if (!a.archived && ui.account === a.name) ui.account = 'all';
      toast(a.archived ? 'Account restored' : 'Account archived. Its entries stay in your history', 'ok');
      renderSettings($('#view'));
      break;
    }
    case 'filter': ui.filter = el.dataset.f; renderActivity($('#view'), activeMonth()); break;
    case 'sync':
      store.sync().then(() => {
        const st = store.getState();
        if (st.status === 'synced') toast('Up to date', 'ok');
        else if (st.status === 'offline' || st.status === 'retrying') toast('Can’t reach the server right now — changes are saved on this device');
        else if (st.status === 'error') toast(st.error || 'Sync failed', 'err');
      });
      break;
    case 'key': pressKey(el.dataset.k); break;
    case 'type': ui.form.type = el.dataset.t; ui.adding = null; haptic(6); refreshForm(); break;
    case 'cat': ui.form.category = el.dataset.v; ui.form.sub = ''; if (ui.adding === 'sub') ui.adding = null; haptic(6); refreshForm(); break;
    case 'sub': ui.form.sub = el.dataset.v; haptic(6); refreshForm(); break;
    case 'lock-method': {
      const want = el.dataset.v;
      const cur = lockCfg().method;
      if (want === cur) break;
      try {
        if (want === 'off') {
          await lk.verifyOwner(askPin);
          await lk.disableLock();
          toast('Lock turned off', 'ok');
        } else if (want === 'bio') {
          if (cur === 'pin') await lk.verifyOwner(askPin);
          await lk.enableBio(lockCfg().delay);
          toast('Face ID lock is on', 'ok');
        } else if (want === 'pin') {
          if (cur === 'bio') await lk.verifyOwner(askPin);
          pinSetupSheet('set');
        }
      } catch (err) {
        toast(err && err.name === 'NotAllowedError' ? 'Cancelled' : (err.message || 'Could not change the lock'), 'err');
      }
      break;
    }
    case 'lock-delay': store.saveSettings({ lock: { ...lockCfg(), delay: Number(el.dataset.v) } }); haptic(6); break;
    case 'lock-now': lk.lockApp(); break;
    case 'enc-open': encSheet(el.dataset.m); break;
    case 'enc-save': saveEncryption(); break;
    case 'enc-lock': location.reload(); break;
    case 'enc-auto-on':
      try {
        await vault.createDevice();
        await store.persistEverything();
        haptic(12); renderSettings($('#view')); toast('Your data is encrypted', 'ok');
      } catch (err) { vault.forget(); toast('Could not turn on encryption on this device.', 'err'); }
      break;
    case 'enc-auto-off':
      if (!confirm('Turn off encryption?\n\nThe data on this phone will be stored unscrambled again.')) break;
      vault.forget();
      await store.persistEverything();
      renderSettings($('#view')); toast('Encryption is off', 'ok');
      break;
    case 'update-now': toast('Updating…'); hardReload(() => vault.stashForReload()); break;
    case 'pin-change':
      try { await lk.verifyOwner(askPin); pinSetupSheet('change'); } catch (err) { toast(err.message || 'Wrong PIN', 'err'); }
      break;
    case 'pin-ask-ok': {
      const v = ($('#pinAsk') || {}).value || '';
      const r = pinAskResolve; pinAskResolve = null;
      closeSheet();
      if (r) r(v);
      break;
    }
    case 'pin-save': {
      const a = ($('#pinA') || {}).value || '';
      const b = ($('#pinB') || {}).value || '';
      if (!/^\d{4,8}$/.test(a)) { toast('Use 4 to 8 digits.', 'err'); shake(); break; }
      if (a !== b) { toast('The two PINs don’t match.', 'err'); shake(); break; }
      try {
        await lk.enablePin(a, lockCfg().delay);
        closeSheet();
        toast('PIN lock is on', 'ok');
        haptic(12);
      } catch (err) { toast(err.message || 'Could not save the PIN', 'err'); }
      break;
    }
    case 'flip': openFlip(el.dataset.kind, el); break;
    case 'flip-close': closeFlip(); break;
    case 'refresh-view': refreshView(); break;
    case 'theme': {
      const mode = el.dataset.v;
      store.saveSettings({ theme: mode });
      applyTheme(mode);
      haptic(8);
      break;
    }
    case 'new-cat': ui.adding = 'cat'; ui.newName = ''; refreshForm(); break;
    case 'new-sub': ui.adding = 'sub'; ui.newName = ''; refreshForm(); break;
    case 'new-cancel': ui.adding = null; ui.newName = ''; refreshForm(); break;
    case 'new-ok': confirmNew(); break;
    case 'date-today': ui.form.date = todayStr(); haptic(6); refreshForm(); break;
    case 'date-yesterday': ui.form.date = shiftDate(todayStr(), -1); haptic(6); refreshForm(); break;
    case 'date-pick': openCal(); break;
    case 'cal-day': ui.form.date = el.dataset.date; haptic(8); closeCal(); break;
    case 'cal-prev': shiftCalMonth(-1); break;
    case 'cal-next': shiftCalMonth(1); break;
    case 'cal-today': ui.calMonth = todayStr().slice(0, 7); renderCal(); break;
    case 'save': saveForm(); break;
    case 'delete': {
      if (!ui.armedDelete) {
        ui.armedDelete = true;
        el.classList.add('armed');
        toast('Tap the red button again to delete');
        haptic(12);
        setTimeout(() => { ui.armedDelete = false; if (el.isConnected) el.classList.remove('armed'); }, 3000);
      } else {
        const trashId = store.deleteEntry(ui.form.id);
        haptic(18);
        closeSheet();
        toast('Transaction deleted', '', trashId ? { label: 'Undo', fn: () => { store.restoreTrash(trashId); haptic(10); toast('Restored', 'ok'); } } : null);
      }
      break;
    }
    case 'export': {
      const rows = store.exportCsv();
      await saveFile('expense-log.csv', new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\n')], { type: 'text/csv' }));
      break;
    }
    case 'export-xlsx': {
      try {
        const v = store.view();
        const bytes = buildWorkbook({ months: v.months, by: v.by, categories: v.categories, accounts: v.accounts });
        const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const r = await saveFile('Expense Log.xlsx', blob);
        if (r !== 'cancelled') toast(r === 'shared' ? 'Excel file ready' : 'Excel file downloaded', 'ok');
      } catch (err) { toast('Could not create the Excel file: ' + (err.message || err), 'err'); }
      break;
    }
    case 'import-xlsx':
    case 'import-csv': {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = act === 'import-csv'
        ? '.csv,.txt,text/csv,text/plain'
        : '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12';
      input.addEventListener('change', () => { if (input.files && input.files[0]) readImportFile(input.files[0]); });
      input.click();
      break;
    }
    case 'do-import': {
      const d = ui.importData;
      if (!d || !d.fresh.length) { closeSheet(); break; }
      if (d.create) {
        for (const c of d.newCats) {
          if (!c.existing) store.addCategory(c.name);
          for (const sub of c.subs.values()) store.addSub(c.name, sub);
        }
      }
      store.addMany(d.fresh);
      ui.importData = null;
      haptic(14);
      closeSheet();
      toast(`Importing ${d.fresh.length} transactions…`, 'ok');
      break;
    }
    case 'trash': openTrash(); break;
    case 'restore': {
      const id = store.restoreTrash(el.dataset.id);
      if (id) { haptic(10); toast('Restored', 'ok'); }
      if (!store.getState().trash.length) closeSheet(); else openTrash(true);
      break;
    }
    case 'clear-trash':
      if (confirm('Permanently clear the recently deleted list on this device?')) { store.clearTrash(); closeSheet(); }
      break;
    case 'disconnect':
      if (confirm('Remove the local copy and disconnect this device? Unsynced changes will be lost.')) { try { localStorage.removeItem('el_lock'); } catch (e) { /* ignore */ } await store.disconnect(); render(); }
      break;
    case 'demo':
      try { await store.connect({ demo: true }); toast('Demo loaded', 'ok'); } catch (e) { toast(e.message, 'err'); }
      break;
    default:
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.dataset && e.target.dataset.qsel !== undefined && ui.quick) {
    const r = ui.quick.rows[+e.target.dataset.qsel];
    if (r) { if (e.target.checked) ui.quick.sel.add(r); else ui.quick.sel.delete(r); }
    renderQuickRows();
    return;
  }
  if (e.target && e.target.classList && e.target.classList.contains('acc-limit')) {
    const n = parseFloat(String(e.target.value).replace(/,/g, '').trim());
    const val = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    store.updateAccount(e.target.dataset.name, { limit: val });
    e.target.value = val || '';
    toast(val ? 'Limit saved' : 'Limit removed', 'ok');
    return;
  }
  if (e.target && e.target.id === 'budgetInput') {
    const n = parseFloat(String(e.target.value).replace(/,/g, '').trim());
    const val = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    store.saveSettings({ budget: val });
    e.target.value = val || '';
    toast(val ? 'Budget saved' : 'Budget turned off', 'ok');
    renderSettings($('#view'));
    return;
  }
  if (e.target && e.target.id === 'glassSwitch') {
    store.saveSettings({ glass: e.target.checked });
    document.documentElement.classList.toggle('no-glass', !e.target.checked);
    return;
  }
  if (e.target && e.target.id === 'createMissing' && ui.importData) {
    ui.importData.create = e.target.checked;
    computeImportPlan();
    renderImportPreview();
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.id === 'heroAmt') { e.preventDefault(); setPrivacy(!priv()); return; }
  if (e.key === 'Escape') { if (flipKind) closeFlip(); else if (ui.menuOpen) closeMonthMenu(); else if ($('#layer').classList.contains('open')) closeSheet(); }
  const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.type !== 'date';
  if (ui.form && !typing && /^[0-9.]$/.test(e.key)) pressKey(e.key);
  if (ui.form && !typing && e.key === 'Backspace') pressKey('del');
});

// ---------------------------------------------------------------- boot
function fitApp() {
  const root = document.documentElement;
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) 0';
  document.body.appendChild(probe);
  const inset = probe.offsetHeight; // top + bottom
  probe.style.padding = 'env(safe-area-inset-top,0px) 0 0 0';
  const insetTop = probe.offsetHeight;
  probe.remove();
  const gap = standalone && window.innerHeight > window.innerWidth
    ? Math.max(screen.width, screen.height) - window.innerHeight : 0;
  // If the page reaches under the status bar (top inset > 0) yet stops short of the bottom, iOS has already
  // reserved the bottom strip, so the home-indicator inset must not be added a second time.
  const shortUnderBar = gap > 8 && insetTop >= gap - 8;
  root.style.setProperty('--safe-b', shortUnderBar ? '0px' : 'env(safe-area-inset-bottom, 0px)');
  const vv = window.visualViewport ? Math.round(window.visualViewport.height) : '-';
  fitApp.info = `inner ${window.innerWidth}×${window.innerHeight} · visual ${vv} · screen ${screen.width}×${screen.height} · insets ${insetTop}+${inset - insetTop} · gap ${gap}${shortUnderBar ? ' (compensated)' : ''} · ${standalone ? 'app' : 'browser'}`;
}
fitApp();
window.addEventListener('resize', fitApp);
window.addEventListener('orientationchange', () => setTimeout(fitApp, 250));

let lastStatusKey = '';
function render() {
  const st = store.getState();
  if (!st.cfg) { renderOnboarding(); return; }
  document.body.classList.remove('onboard');
  renderTop();
  renderTabbar();
  renderTab();
}

store.onChange(() => {
  const st = store.getState();
  if (!st.cfg) { render(); return; }
  if ($('#layer').classList.contains('open') && ui.form) { renderTop(); return; } // don't disturb an open form
  const rej = store.takeRejected();
  if (rej.length) toast(`A change was rejected: ${rej[0].error}`, 'err');
  const key = st.status + st.queue.length;
  if (key === lastStatusKey && false) return;
  lastStatusKey = key;
  render();
});

$('#view').addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', $('#view').scrollTop > 4), { passive: true });
window.addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => {
  lk.onVisibility();
  paintTheme(themeNow); // the phone's appearance may have changed while the app was away
  if (document.visibilityState === 'visible') setTimeout(() => store.sync(), 700); // give a sleeping mobile connection a moment to wake
});
window.addEventListener('pageshow', () => paintTheme(themeNow));
setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 60000);

(async function boot() {
  let vaultOpened = false;
  let keyLost = false;
  if (vault.isEnabled() && vault.mode() === 'device') {
    try { await vault.openDevice(); } catch (e) { keyLost = true; await store.disconnect(); }   // the browser dropped the key: the local copy can't be read, so start clean (the sheet still has everything)
  } else if (vault.isEnabled()) {
    vaultOpened = await vault.takeStash();                // an automatic reload (app update) doesn't ask again
    if (!vaultOpened) {
      await promptUnlock({ onForgot: async () => { try { localStorage.removeItem('el_lock'); } catch (e) { /* ignore */ } await store.disconnect(); location.reload(); } });
      vaultOpened = true;
    }
  }
  await store.init();
  if (keyLost) setTimeout(() => toast('This phone’s encrypted copy could not be opened, so it was cleared. Reconnect to load everything again from your sheet.', 'err'), 800);
  document.documentElement.classList.toggle('privacy', !!store.getState().settings.hideBalance);
  watchPrivacy(!!store.getState().settings.hideBalance);
  applyTheme(store.getState().settings.theme || 'system');
  document.documentElement.classList.toggle('no-glass', store.getState().settings.glass === false);
  lk.initLock({
    skipInitial: vaultOpened,
    vaultOn: () => vault.isEnabled() && vault.mode() === 'passphrase',
    relock: () => location.reload(),
    getLock: lockCfg,
    setLock: (p) => store.saveSettings({ lock: { ...lockCfg(), ...p } }),
    haptic,
    onReset: async () => { try { localStorage.removeItem('el_lock'); } catch (e) { /* ignore */ } await store.disconnect(); location.reload(); },
  });
  try {
    const r = JSON.parse(sessionStorage.getItem('el_resume') || 'null');
    sessionStorage.removeItem('el_resume');
    if (r) { if (r.tab) ui.tab = r.tab; if (r.month) ui.month = r.month; ui.animate = false; }
  } catch (e) { /* ignore */ }
  if (/[?&]r=\d+/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
  // One-tap setup link: …/#u=<api url>&k=<key>
  if (location.hash.length > 1) {
    const p = new URLSearchParams(location.hash.slice(1));
    const url = p.get('u');
    const key = p.get('k');
    history.replaceState(null, '', location.pathname + location.search);
    if (url && key && !store.getState().cfg) {
      renderOnboarding({ url, key });
      try { await store.connect({ url, key }); toast('Connected', 'ok'); } catch (e) { toast(e.message || 'Could not connect', 'err'); }
      return;
    }
  }
  render();
  store.sync();
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (had && !reloaded) { reloaded = true; vault.stashForReload(); location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
