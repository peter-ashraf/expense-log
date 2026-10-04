import * as store from './store.js';
import { icon, catHue } from './icons.js';
import { esc, num, num0, money, keyLabel, keyShort, todayStr, dayLabel, dateLong, dateShort, shiftDate, weekStart, monthKeyOf, haptic, csvEscape, saveFile } from './util.js';
import { buildWorkbook, parseWorkbook } from './xlsx.js';
import { readCsvEntries, decodeText } from './csv.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = { tab: 'home', month: null, filter: 'all', q: '', animate: true, form: null, armedDelete: false, adding: null, newName: '', menuOpen: false, noClickUntil: 0, picking: false, calMonth: '' };

// ---------------------------------------------------------------- helpers
const cur = () => store.getState().settings.currency || '';
const fmt = (n) => money(n, cur());

function activeMonth() {
  const v = store.view();
  if (!v.months.length) return null;
  if (!ui.month || !v.by[ui.month]) {
    const now = todayStr().slice(0, 7);
    ui.month = v.by[now] ? now : v.months.filter((k) => k <= now).pop() || v.months[v.months.length - 1];
  }
  return v.by[ui.month];
}

function splitAmount(n) {
  const s = num(n);
  const hasDec = s.length > 3 && /\D/.test(s[s.length - 3]);
  return hasDec ? [s.slice(0, -3), s.slice(-3)] : [s, ''];
}

function heroHTML(n) {
  const [i, d] = splitAmount(n);
  return `${cur() ? `<span class="cur">${esc(cur())}</span>` : ''}${esc(i)}<small>${esc(d)}</small>`;
}

function countUp(el, to) {
  if (!el) return;
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
  const subtitle = isInc ? 'Income' : `${e.category} · ${e.sub}`;
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
    ? '<h1 class="title">Settings</h1>'
    : `<button class="month-pill ${ui.menuOpen ? 'open' : ''}" data-act="months" aria-haspopup="listbox" aria-expanded="${ui.menuOpen}" ${v.months.length ? '' : 'disabled'}>
        <span>${m ? esc(keyLabel(m.key)) : 'No data'}</span>${icon('chevron', 16, 2.2)}</button>`;
  const n = st.queue.length;
  let label = '';
  let cls = st.status;
  if (st.status === 'syncing') label = 'Syncing…';
  else if (st.status === 'offline') label = n ? `Offline · ${n} pending` : 'Offline';
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
  view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
    <section class="hero">
      <div class="hero-label">Available balance</div>
      <div class="hero-amt" id="heroAmt">${heroHTML(m.available)}</div>
      <div class="hero-sub">Opened the month with ${esc(fmt(m.start))}</div>
      <div class="hero-row">
        <div class="mini"><span>${icon('income', 14, 2.2).replace('class="ic"', 'class="ic up"')}Income</span><b>${esc(fmt(m.income))}</b></div>
        <div class="mini"><span>${icon('income', 14, 2.2).replace('class="ic"', 'class="ic down"')}Spent</span><b>${esc(fmt(m.spent))}</b></div>
      </div>
      <div class="meter"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="meter-cap">${Math.round(pct)}% of available funds spent</div>
    </section>
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
  countUp($('#heroAmt'), m.available);
}

function renderActivity(view, m) {
  if (!$('#actList')) {
    view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
      <div class="search">${icon('search', 18)}<input id="q" type="search" placeholder="Search transactions" value="${esc(ui.q)}" autocomplete="off" enterkeyhint="search"></div>
      <div class="chips" id="filters"></div>
      <div id="actList"></div></div>`;
    $('#q').addEventListener('input', (e) => { ui.q = e.target.value; fillActivity(); });
  }
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

function donut(parts, total) {
  const r = 62;
  const c = 2 * Math.PI * r;
  let off = 0;
  const order = store.view().categories.order;
  const segs = parts.map(([name, amt]) => {
    const len = (amt / total) * c;
    const s = `<circle r="${r}" cx="80" cy="80" fill="none" stroke="hsl(${catHue(name, order)} 70% 58%)" stroke-width="18"
      stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(c - Math.max(0, len - 2)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 80 80)" stroke-linecap="butt"/>`;
    off += len;
    return s;
  }).join('');
  return `<svg viewBox="0 0 160 160" class="donut"><circle r="${r}" cx="80" cy="80" fill="none" stroke="var(--track)" stroke-width="18"/>${segs}</svg>`;
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
  const maxSpent = Math.max(1, ...last.map((k) => v.by[k].spent));
  view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
    <section class="card">
      <div class="card-h"><h3>Spending split</h3></div>
      ${cats.length ? `<div class="donut-wrap">
        <div class="donut-box">${donut(cats, total)}<div class="donut-c"><small>Spent</small><b>${esc(num0(m.spent))}</b></div></div>
        <div class="legend">${cats.slice(0, 6).map(([n, a]) => `<div style="${hueStyle(n)}"><i></i><span>${esc(n)}</span><b>${Math.round((a / total) * 100)}%</b></div>`).join('')}</div>
      </div>` : '<p class="muted pad">No expenses this month.</p>'}
    </section>
    <section class="stats">
      <div class="stat"><span>Daily average</span><b>${esc(num0(m.spent / Math.max(1, days)))}</b></div>
      <div class="stat"><span>Transactions</span><b>${m.entries.length}</b></div>
      <div class="stat"><span>Largest expense</span><b>${biggest[0] ? esc(num0(biggest[0].amount)) : '—'}</b></div>
      <div class="stat"><span>Saved</span><b class="${saved !== null && saved < 0 ? 'neg' : 'pos'}">${saved === null ? '—' : saved + '%'}</b></div>
    </section>
    <section class="card">
      <div class="card-h"><h3>Monthly trend</h3><span class="muted sm">Spent per month</span></div>
      <div class="trend">${last.map((k) => {
        const mm = v.by[k];
        const h = Math.max(4, (mm.spent / maxSpent) * 100);
        return `<button class="tcol ${k === m.key ? 'on' : ''}" data-act="pick-month" data-key="${k}"><b>${esc(num0(mm.spent))}</b><div class="tbar"><i style="height:${h.toFixed(1)}%"></i></div><span>${esc(keyShort(k))}</span></button>`;
      }).join('')}</div>
    </section>
    ${biggest.length ? `<section class="card"><div class="card-h"><h3>Biggest expenses</h3></div>${biggest.map((e) => entryRow(e, v.pending)).join('')}</section>` : ''}
  </div>`;
}

function renderSettings(view) {
  const st = store.getState();
  const n = st.queue.length;
  const last = st.lastSync ? new Date(st.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
  const demo = st.cfg && st.cfg.demo;
  const host = demo ? 'Demo mode (data stays on this device)' : (() => { try { return new URL(st.cfg.url).host; } catch (e) { return 'Connected'; } })();
  view.innerHTML = `<div class="page ${ui.animate ? 'enter' : ''}">
    <section class="card">
      <div class="card-h"><h3>Sync</h3><span class="badge ${st.status}">${esc(st.status === 'idle' ? 'ready' : st.status)}</span></div>
      <div class="kv"><span>Source</span><b>${esc(host)}</b></div>
      <div class="kv"><span>Last synced</span><b>${esc(last)}</b></div>
      <div class="kv"><span>Waiting to upload</span><b>${n}</b></div>
      ${st.error && st.status === 'error' ? `<p class="warn">${esc(st.error)}</p>` : ''}
      <button class="btn" data-act="sync">${icon('cloud', 18)}Sync now</button>
    </section>
    <section class="card">
      <div class="card-h"><h3>Appearance</h3></div>
      <div class="seg three" role="radiogroup" aria-label="Theme">${[['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'device']]
        .map(([k, l, ic]) => `<button role="radio" aria-checked="${(st.settings.theme || 'system') === k}" class="${(st.settings.theme || 'system') === k ? 'on' : ''}" data-act="theme" data-v="${k}">${icon(ic, 18)}${l}</button>`).join('')}</div>
      <p class="muted sm" style="margin-top:10px">System follows your phone’s light/dark setting automatically.</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>Preferences</h3></div>
      <label class="field"><span>Currency symbol</span><input id="curInput" maxlength="4" placeholder="e.g. $, €, EGP" value="${esc(st.settings.currency)}" autocomplete="off"></label>
      <p class="muted sm">Shown next to amounts. Doesn’t change your data.</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>Data</h3></div>
      <button class="btn ghost" data-act="export-xlsx">${icon('download', 18)}Export to Excel (.xlsx)</button>
      <button class="btn ghost" data-act="import-xlsx">${icon('download', 18).replace('class="ic"', 'class="ic flip"')}Import from Excel</button>
      <button class="btn ghost" data-act="export">${icon('download', 18)}Export as CSV</button>
      <button class="btn ghost" data-act="import-csv">${icon('file', 18)}Import from CSV</button>
      <button class="btn ghost" data-act="trash">${icon('trash', 18)}Recently deleted${st.trash.length ? ` (${st.trash.length})` : ''}</button>
      ${demo ? `<label class="switch"><input type="checkbox" id="offSim" ${localStorage.getItem('el_demo_offline') === '1' ? 'checked' : ''}><span>Simulate offline (demo)</span></label>` : ''}
      <button class="btn danger" data-act="disconnect">${demo ? 'Exit demo' : 'Disconnect this device'}</button>
      <p class="muted sm">Disconnecting removes the local copy from this device. Your Google Sheet is untouched.</p>
    </section>
    <p class="muted center sm">Credit Card Expenses · v1.9</p>
    <p class="muted center xs">${esc(fitApp.info || '')}</p>
  </div>`;
  $('#curInput').addEventListener('change', (e) => store.saveSettings({ currency: e.target.value.trim() }));
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
    ? { id: e.id, type: e.type, amt: String(e.amount), category: e.category, sub: e.sub, date: e.date, desc: e.description }
    : { id: null, type: 'Expense', amt: '', category: '', sub: '', date: defDate, desc: '' };
  ui.armedDelete = false;
  const body = `<div id="formMain"><div class="seg" id="fType"></div>
      <div class="amt" id="fAmt"></div>
      <div class="keypad" id="keypad">${KEYS.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === 'del' ? 'Delete digit' : k}">${k === 'del' ? icon('backspace', 20) : k}</button>`).join('')}</div>
      <div id="fCatWrap"><div class="lbl">Category</div><div class="chips hs" id="fCats"></div>
      <div class="lbl">Sub-category</div><div class="chips hs" id="fSubs"></div></div>
      <div class="lbl">Date</div>
      <div class="chips datechips" id="fDates"></div>
      <label class="note"><input id="fDesc" placeholder="Add a note" value="${esc(ui.form.desc)}" autocomplete="off" maxlength="120"></label></div>
      <div id="calWrap"></div>`;
  const foot = `<button class="btn primary big" data-act="save" id="saveBtn">${e ? 'Save changes' : 'Add transaction'}</button>`;
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
  if (p <= 0.001) { setStatusColor('#' + base); return; }
  const k = 1 - SCRIM_ALPHA * p;
  const c = [0, 2, 4].map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  setStatusColor('#' + c);
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
  };
  if (f.id) store.updateEntry(f.id, data); else store.addEntry(data);
  ui.month = monthKeyOf(f.date);
  haptic(14);
  toast(f.id ? 'Changes saved' : 'Transaction added', 'ok');
  closeSheet();
  ui.animate = false;
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
  const keyOf = (e) => [e.date, e.description, Number(e.amount).toFixed(2), e.type, e.category, e.sub].join('|');
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
  for (const e0 of candidates) {
    const e = { ...e0 };
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
      ${createLine}${planLine}
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
      if (ui.tab !== el.dataset.tab) { ui.tab = el.dataset.tab; ui.animate = true; $('#view').innerHTML = ''; render(); }
      haptic(6);
      break;
    case 'new': haptic(10); openSheet(null); break;
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
    case 'filter': ui.filter = el.dataset.f; renderActivity($('#view'), activeMonth()); break;
    case 'sync':
      store.sync().then(() => {
        const st = store.getState();
        if (st.status === 'synced') toast('Up to date', 'ok');
        else if (st.status === 'offline') toast('You’re offline — changes are saved on this device');
        else if (st.status === 'error') toast(st.error || 'Sync failed', 'err');
      });
      break;
    case 'key': pressKey(el.dataset.k); break;
    case 'type': ui.form.type = el.dataset.t; ui.adding = null; haptic(6); refreshForm(); break;
    case 'cat': ui.form.category = el.dataset.v; ui.form.sub = ''; if (ui.adding === 'sub') ui.adding = null; haptic(6); refreshForm(); break;
    case 'sub': ui.form.sub = el.dataset.v; haptic(6); refreshForm(); break;
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
        const bytes = buildWorkbook({ months: v.months, by: v.by, categories: v.categories });
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
      if (confirm('Remove the local copy and disconnect this device? Unsynced changes will be lost.')) { await store.disconnect(); render(); }
      break;
    case 'demo':
      try { await store.connect({ demo: true }); toast('Demo loaded', 'ok'); } catch (e) { toast(e.message, 'err'); }
      break;
    default:
  }
});

document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'createMissing' && ui.importData) {
    ui.importData.create = e.target.checked;
    computeImportPlan();
    renderImportPreview();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (ui.menuOpen) closeMonthMenu(); else if ($('#layer').classList.contains('open')) closeSheet(); }
  const typing = document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && document.activeElement.type !== 'date';
  if (ui.form && !typing && /^[0-9.]$/.test(e.key)) pressKey(e.key);
  if (ui.form && !typing && e.key === 'Backspace') pressKey('del');
});

// ---------------------------------------------------------------- boot
function fitApp() {
  const app = $('#app');
  app.style.height = window.innerHeight + 'px';
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
  paintTheme(themeNow); // the phone's appearance may have changed while the app was away
  if (document.visibilityState === 'visible') store.sync();
});
window.addEventListener('pageshow', () => paintTheme(themeNow));
setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 60000);

(async function boot() {
  await store.init();
  applyTheme(store.getState().settings.theme || 'system');
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
      if (had && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
