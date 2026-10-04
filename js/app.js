import * as store from './store.js';
import { icon, catHue } from './icons.js';
import { esc, num, num0, money, keyLabel, keyShort, todayStr, dayLabel, dateLong, monthKeyOf, haptic, csvEscape } from './util.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const ui = { tab: 'home', month: null, filter: 'all', q: '', animate: true, form: null, armedDelete: false };

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

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, kind === 'err' ? 4200 : 2200);
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
    : `<button class="month-pill" data-act="months" ${v.months.length ? '' : 'disabled'}>
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
      <div class="card-h"><h3>Preferences</h3></div>
      <label class="field"><span>Currency symbol</span><input id="curInput" maxlength="4" placeholder="e.g. $, €, EGP" value="${esc(st.settings.currency)}" autocomplete="off"></label>
      <p class="muted sm">Shown next to amounts. Doesn’t change your data.</p>
    </section>
    <section class="card">
      <div class="card-h"><h3>Data</h3></div>
      <button class="btn ghost" data-act="export">${icon('download', 18)}Export all as CSV</button>
      ${demo ? `<label class="switch"><input type="checkbox" id="offSim" ${localStorage.getItem('el_demo_offline') === '1' ? 'checked' : ''}><span>Simulate offline (demo)</span></label>` : ''}
      <button class="btn danger" data-act="disconnect">${demo ? 'Exit demo' : 'Disconnect this device'}</button>
      <p class="muted sm">Disconnecting removes the local copy from this device. Your Google Sheet is untouched.</p>
    </section>
    <p class="muted center sm">Expense Log · v1.1</p>
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
  const body = `<div class="seg" id="fType"></div>
      <div class="amt" id="fAmt"></div>
      <div class="keypad" id="keypad">${KEYS.map((k) => `<button data-act="key" data-k="${k}" aria-label="${k === 'del' ? 'Delete digit' : k}">${k === 'del' ? icon('backspace', 20) : k}</button>`).join('')}</div>
      <div id="fCatWrap"><div class="lbl">Category</div><div class="chips hs" id="fCats"></div>
      <div class="lbl">Sub-category</div><div class="chips hs" id="fSubs"></div></div>
      <div class="two">
        <label class="date-pill">${icon('calendar', 18)}<span id="fDateLbl"></span><input type="date" id="fDate" value="${esc(ui.form.date)}"></label>
        <label class="note"><input id="fDesc" placeholder="Add a note" value="${esc(ui.form.desc)}" autocomplete="off" maxlength="120"></label>
      </div>`;
  const foot = `<button class="btn primary big" data-act="save" id="saveBtn">${e ? 'Save changes' : 'Add transaction'}</button>`;
  present(e ? 'Edit transaction' : 'New transaction',
    e ? `<button class="icon-btn danger" id="delBtn" data-act="delete" aria-label="Delete">${icon('trash', 20)}</button>` : '', body, 'compact', foot);
  $('#fDate').addEventListener('change', (ev) => { ui.form.date = ev.target.value; refreshForm(); });
  $('#fDesc').addEventListener('input', (ev) => { ui.form.desc = ev.target.value; });
  refreshForm();
}

// ---- iOS-style sheet presentation ------------------------------------------------------------
// Opens with a spring slide-up while the app behind scales back; dragging follows the finger
// (by the grey pill only); a flick or a long
// pull dismisses it, a short pull springs back.
let sheetClosing = false;

function setProgress(p) { $('#app').style.setProperty('--p', String(Math.max(0, Math.min(1, p)))); }

function present(title, headExtra, body, cls = '', foot = '') {
  const layer = $('#layer');
  sheetClosing = false;
  layer.className = 'open';
  layer.innerHTML = `<div class="scrim" data-act="close"></div>
    <div class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="grab-zone" aria-hidden="true"><div class="grab"></div></div>
      <div class="sheet-h">
        <button class="close" data-act="close" aria-label="Close">${icon('close', 20, 2.2)}</button>
        <h2>${esc(title)}</h2>
        <div class="hbtns">${headExtra}</div>
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
  const handle = $('.grab-zone', sheet);
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

  // Only the grey pill is a handle; the title row and the content never start a drag.
  handle.addEventListener('pointerdown', (e) => {
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
    setChips('#fCats', v.categories.order.map((n) => `<button class="chip cat ${f.category === n ? 'on' : ''}" style="${hueStyle(n)}" data-act="cat" data-v="${esc(n)}">${icon(n, 16)}${esc(n)}</button>`).join(''));
    const subs = v.categories.map[f.category] || [];
    setChips('#fSubs', subs.length
      ? subs.map((n) => `<button class="chip ${f.sub === n ? 'on' : ''}" data-act="sub" data-v="${esc(n)}">${esc(n)}</button>`).join('')
      : '<span class="hint">Pick a category first</span>');
  }
  $('#fDateLbl').textContent = dayLabel(f.date) === 'Today' || dayLabel(f.date) === 'Yesterday' ? dayLabel(f.date) : dateLong(f.date);
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

function openMonths() {
  const v = store.view();
  present('Choose month', '', `<div class="mlist">${v.months.slice().reverse().map((k) => `<button class="mrow ${k === ui.month ? 'on' : ''}" data-act="pick-month" data-key="${k}"><span>${esc(keyLabel(k))}</span><b>${esc(fmt(v.by[k].available))}</b>${k === ui.month ? icon('check', 18, 2.4) : ''}</button>`).join('')}</div>`, 'small');
}

// ---------------------------------------------------------------- events
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  switch (act) {
    case 'tab':
      if (ui.tab !== el.dataset.tab) { ui.tab = el.dataset.tab; ui.animate = true; $('#view').innerHTML = ''; render(); }
      haptic(6);
      break;
    case 'new': haptic(10); openSheet(null); break;
    case 'edit': openSheet(el.dataset.id); break;
    case 'close': closeSheet(); break;
    case 'months': openMonths(); break;
    case 'pick-month':
      ui.month = el.dataset.key; ui.animate = true;
      if ($('.sheet')) closeSheet();
      render();
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
    case 'type': ui.form.type = el.dataset.t; haptic(6); refreshForm(); break;
    case 'cat': ui.form.category = el.dataset.v; ui.form.sub = ''; haptic(6); refreshForm(); break;
    case 'sub': ui.form.sub = el.dataset.v; haptic(6); refreshForm(); break;
    case 'save': saveForm(); break;
    case 'delete': {
      if (!ui.armedDelete) {
        ui.armedDelete = true;
        el.classList.add('armed');
        toast('Tap the red button again to delete');
        haptic(12);
        setTimeout(() => { ui.armedDelete = false; if (el.isConnected) el.classList.remove('armed'); }, 3000);
      } else {
        store.deleteEntry(ui.form.id);
        haptic(18);
        toast('Transaction deleted');
        closeSheet();
      }
      break;
    }
    case 'export': {
      const rows = store.exportCsv();
      const blob = new Blob([rows.map((r) => r.map(csvEscape).join(',')).join('\n')], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'expense-log.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      break;
    }
    case 'disconnect':
      if (confirm('Remove the local copy and disconnect this device? Unsynced changes will be lost.')) { await store.disconnect(); render(); }
      break;
    case 'demo':
      try { await store.connect({ demo: true }); toast('Demo loaded', 'ok'); } catch (e) { toast(e.message, 'err'); }
      break;
    default:
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#layer').classList.contains('open')) closeSheet();
  if (ui.form && /^[0-9.]$/.test(e.key) && document.activeElement && document.activeElement.id !== 'fDesc') pressKey(e.key);
  if (ui.form && e.key === 'Backspace' && document.activeElement && document.activeElement.id !== 'fDesc') pressKey('del');
});

// ---------------------------------------------------------------- boot
function fitApp() {
  const app = $('#app');
  app.style.height = window.innerHeight + 'px';
  // On some iPhones a home-screen app's web view stops above the home-indicator zone (the system fills it)
  // while still reporting a bottom safe-area inset. In that case the inset must not be added again.
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const gap = standalone && window.innerHeight > window.innerWidth
    ? Math.max(screen.width, screen.height) - window.innerHeight : 0;
  document.documentElement.style.setProperty('--safe-b', gap > 8 ? '0px' : 'env(safe-area-inset-bottom, 0px)');
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) 0;visibility:hidden';
  document.body.appendChild(probe);
  const inset = probe.offsetHeight;
  probe.remove();
  const vv = window.visualViewport ? Math.round(window.visualViewport.height) : '-';
  fitApp.info = `inner ${window.innerWidth}×${window.innerHeight} · visual ${vv} · screen ${screen.width}×${screen.height} · doc ${document.documentElement.clientHeight} · app ${Math.round(app.getBoundingClientRect().height)} · insets(top+bottom) ${inset} · gap ${gap} · ${standalone ? 'app' : 'browser'}`;
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

window.addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.sync(); });
setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 60000);

(async function boot() {
  await store.init();
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
