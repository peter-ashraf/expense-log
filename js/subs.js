// Subscriptions: a Wallet-style stack of cards (tap one and it flies to the centre and flips over a blurred
// backdrop), a strip of the coming days, a quick "worth it?" rating, and suggestions from repeated purchases.
// Nothing is ever charged automatically: "Log as paid" adds a normal entry, only when tapped.
import * as store from './store.js';
import { esc, todayStr, monthKeyOf, haptic } from './util.js';

// ---- brands: official logos (Simple Icons, CC0, stored in icons/brands) and brand colours
const BRANDS = [
  [/netflix/i, 'netflix', '#E50914'], [/spotify/i, 'spotify', '#1DB954'], [/youtube\s*music/i, 'youtubemusic', '#FF0000'],
  [/youtube/i, 'youtube', '#FF0000'], [/playstation|ps\s*plus|psn/i, 'playstation', '#0070D1'], [/icloud/i, 'icloud', '#3693F3'],
  [/apple\s*music/i, 'applemusic', '#FA243C'], [/apple\s*tv/i, 'appletv', '#1C1C1E'], [/claude/i, 'claude', '#D97757'],
  [/hbo|\bmax\b/i, 'hbomax', '#5822B4'], [/crunchyroll/i, 'crunchyroll', '#F47521'], [/twitch/i, 'twitch', '#9146FF'],
  [/discord|nitro/i, 'discord', '#5865F2'], [/duolingo/i, 'duolingo', '#58CC02'], [/notion/i, 'notion', '#2F2F2F'],
  [/google\s*(one|drive)/i, 'googledrive', '#4285F4'], [/dropbox/i, 'dropbox', '#0061FF'], [/\bx\b|twitter/i, 'x', '#14171A'],
  [/telegram/i, 'telegram', '#26A5E4'], [/patreon/i, 'patreon', '#FF424D'], [/steam/i, 'steam', '#1B2838'],
  [/epic/i, 'epicgames', '#313131'], [/deezer/i, 'deezer', '#A238FF'], [/soundcloud/i, 'soundcloud', '#FF5500'],
  [/tidal/i, 'tidal', '#1F1F1F'], [/audible/i, 'audible', '#F8991C'], [/github|copilot/i, 'github', '#181717'],
  [/perplexity/i, 'perplexity', '#1FB8CD'], [/1password/i, '1password', '#3B66BC'], [/nordvpn/i, 'nordvpn', '#4687FF'],
  [/expressvpn/i, 'expressvpn', '#DA3940'], [/proton/i, 'protonvpn', '#6D4AFF'],
  // known services without a logo in the set: their colour, and the first letter
  [/shahid|شاهد/i, '', '#16C2A3'], [/anghami|انغامي/i, '', '#8C33FF'], [/osn/i, '', '#E4002B'], [/watch\s*it|واتش/i, '', '#E30613'],
  [/chatgpt|openai/i, '', '#10A37F'], [/disney/i, '', '#113CCF'], [/prime/i, '', '#00A8E1'], [/xbox|game\s*pass/i, '', '#107C10'],
  [/gemini/i, '', '#4E7CF6'], [/canva/i, '', '#00C4CC'], [/adobe/i, '', '#FA0F00'], [/microsoft|office|365/i, '', '#D83B01'],
  [/linkedin/i, '', '#0A66C2'], [/gym|fitness/i, '', '#F97316'],
];
const SWATCHES = ['#E50914', '#F97316', '#EAB308', '#16A34A', '#0EA5E9', '#2563EB', '#7C3AED', '#DB2777', '#334155'];
export function brandOf(name) {
  for (const [re, logo, color] of BRANDS) if (re.test(name || '')) return { logo, color };
  let h = 0; for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { logo: '', color: SWATCHES[h % SWATCHES.length] };
}
// a full address: browsers disagree on what a relative url() inside a CSS variable is relative to
const logoUrl = (slug) => new URL(`icons/brands/${slug}.svg`, document.baseURI).href;
const glyph = (s) => (s.logo ? `<i class="bl" style="--m:url('${esc(logoUrl(s.logo))}')"></i>` : esc((s.name || '?').trim().charAt(0).toUpperCase()));

// ---- dates and state of each subscription this month
const pad = (n) => String(n).padStart(2, '0');
const dim = (y, m) => new Date(y, m, 0).getDate();
function dateIn(key, day) { const [y, m] = key.split('-').map(Number); return `${key}-${pad(Math.min(day, dim(y, m)))}`; }
function nextKey(key) { const [y, m] = key.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`; }
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

function paidThisMonth(s, key) {
  const m = store.view().by[key];
  const n = s.name.toLowerCase();
  return !!(m && m.entries.some((e) => e.type === 'Expense' && e.description.trim().toLowerCase() === n));
}
export function stateOf(s, today = todayStr()) {
  const key = monthKeyOf(today);
  const thisDate = dateIn(key, s.day);
  const paid = paidThisMonth(s, key);
  const skipped = s.skipped === key;
  const handled = paid || skipped;
  const next = handled ? dateIn(nextKey(key), s.day) : thisDate;   // not handled yet: this month's date (maybe already past)
  const overdue = !handled && !s.paused && thisDate < today;
  return { key, thisDate, paid, skipped, next, until: daysBetween(today, next), overdue };
}
const whenTxt = (st) => (st.overdue ? `${-st.until} day${st.until === -1 ? '' : 's'} late` : st.until === 0 ? 'today' : st.until === 1 ? 'tomorrow' : `in ${st.until} days`);
const ord = (d) => d + (d % 10 === 1 && d !== 11 ? 'st' : d % 10 === 2 && d !== 12 ? 'nd' : d % 10 === 3 && d !== 13 ? 'rd' : 'th');

export function liveSubs() {
  return store.view().subs.filter((s) => !s.paused).map((s) => ({ s, st: stateOf(s) })).sort((a, b) => a.st.until - b.st.until);
}

// ---- Home: the next renewal in one slim row
export function homeStrip(fmt) {
  const v = store.view();
  if (!v.subs || !v.subs.length) return '';
  const due = liveSubs().filter((x) => !x.st.paid && !x.st.skipped);
  if (!due.length) return '';
  const { s, st } = due[0];
  const p = Math.max(0.04, 1 - Math.max(0, st.until) / 31);
  return `<button class="card subs-strip" data-act="open-subs" style="--c:${esc(s.color || '#5B5BF0')}">
      <svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--line)" stroke-width="4"/><circle cx="18" cy="18" r="15" fill="none" stroke="var(--c)" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(p * 94).toFixed(1)} 94" transform="rotate(-90 18 18)"/></svg>
      <span class="subs-strip-t"><b>${esc(s.name)}</b><small>${st.overdue ? 'renewal was ' : 'renews '}${esc(whenTxt(st))}${due.length > 1 ? ` · ${due.length - 1} more this month` : ''}</small></span>
      <b class="subs-strip-a">${esc(fmt(s.amount))}</b>
    </button>`;
}

// ---- suggestions: the same purchase in at least two of the last three months, not yet a subscription
function spotted() {
  const v = store.view();
  const have = new Set(v.subs.map((s) => s.name.toLowerCase()));
  const recent = v.months.slice(-3);
  const seen = new Map();
  recent.forEach((k) => v.by[k].entries.forEach((e) => {
    if (e.type !== 'Expense' || !e.description.trim()) return;
    const n = e.description.trim().toLowerCase();
    if (have.has(n)) return;
    const g = seen.get(n) || { name: e.description.trim(), months: new Set(), amounts: [], last: e, cat: e.category === 'Subscriptions' };
    g.months.add(k); g.amounts.push(e.amount); if (e.date > g.last.date) g.last = e;
    seen.set(n, g);
  }));
  return [...seen.values()].filter((g) => {
    const lo = Math.min(...g.amounts), hi = Math.max(...g.amounts);
    return (g.months.size >= 2 && hi <= lo * 1.15) || (g.cat && g.months.size >= 1);
  }).slice(0, 4);
}

// ---- the page
const ui = { edit: null, armed: false };
let ctx = null;
let bound = false;

function cardHTML(s, st, fmt) {
  const acc = s.account || store.view().accounts[0].name;
  const ratingRow = `<div class="r7">${['🔥', '😐', '💤'].map((e) => `<button data-sa="rate" data-id="${esc(s.id)}" data-v="${e}" class="${s.rating === e ? 'on' : ''}" aria-label="Rate ${e}">${e}</button>`).join('')}</div>`;
  const status = st.paid ? 'Paid' : st.skipped ? 'Skipped' : esc(whenTxt(st));
  return `<div class="wcard ${st.paid || st.skipped ? 'done' : ''} ${s.rating === '💤' ? 'sleepy' : ''}" data-id="${esc(s.id)}" style="--c:${esc(s.color || '#5B5BF0')}">
      <div class="face front">
        <div class="top"><span class="mark">${glyph(s)}</span><span class="name">${esc(s.name)}</span><span class="fld"><i>Monthly</i><b>${esc(fmt(s.amount))}</b></span></div>
        ${ratingRow}
        <div class="grid"><div><i>Next</i><b>${status}</b></div><div><i>Account</i><b>${esc(acc)}</b></div><div><i>Per year</i><b>${esc(fmt(Math.round(s.amount * 12)))}</b></div></div>
      </div>
      <div class="face back">
        <div class="top"><span class="mark">${glyph(s)}</span><span class="name">${esc(s.name)}</span><span class="fld"><i>Monthly</i><b>${esc(fmt(s.amount))}</b></span></div>
        <div class="grid g2"><div><i>Next</i><b>${status}</b></div><div><i>Account</i><b>${esc(acc)}</b></div><div><i>Per year</i><b>${esc(fmt(Math.round(s.amount * 12)))}</b></div></div>
        <div class="grid"><div><i>Renews</i><b>${ord(s.day)}</b></div><div><i>Per week</i><b>${esc(fmt(Math.round(s.amount * 12 / 52)))}</b></div><div><i>Per day</i><b>${esc(fmt(Math.round(s.amount / 30 * 10) / 10))}</b></div></div>
        <div class="btns">
          ${st.paid ? '<button class="main" disabled>Paid this month ✓</button>' : `<button class="main" data-sa="paid" data-id="${esc(s.id)}">Log as paid</button>`}
          ${st.paid ? '' : `<button data-sa="${st.skipped ? 'unskip' : 'skip'}" data-id="${esc(s.id)}">${st.skipped ? 'Undo skip' : 'Skip month'}</button>`}
          <button class="more" data-sa="edit" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">Edit</button>
        </div>
      </div>
    </div>`;
}

function formHTML(f) {
  const v = store.view();
  const cats = v.categories.order.filter((c) => c !== 'Income');
  const accs = v.accounts.filter((a) => !a.archived || a.name === f.account);
  const preview = { name: f.name || '?', logo: f.logo, color: f.color };
  return `<section class="card subs-form">
      <div class="card-h"><h3>${f.id ? 'Edit subscription' : 'New subscription'}</h3>
        <span class="mark big" style="--c:${esc(f.color)}">${glyph(preview)}</span></div>
      <label class="field"><span>Name</span><input id="sfName" maxlength="40" placeholder="e.g. Netflix" value="${esc(f.name)}" autocomplete="off"></label>
      <div class="row2">
        <label class="field"><span>Amount a month</span><input id="sfAmt" inputmode="decimal" placeholder="0.00" value="${f.amount ? esc(String(f.amount)) : ''}" autocomplete="off"></label>
        <label class="field"><span>Renews on day</span><input id="sfDay" inputmode="numeric" placeholder="1–31" value="${f.day ? esc(String(f.day)) : ''}" autocomplete="off"></label>
      </div>
      <label class="field"><span>Paid from</span><select id="sfAcc">${accs.map((a) => `<option ${a.name === f.account ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <div class="row2">
        <label class="field"><span>Category</span><select id="sfCat">${cats.map((c) => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field"><span>Sub-category</span><select id="sfSub">${subOptions(f)}</select></label>
      </div>
      <div class="lbl">Colour</div>
      <div class="swatches">${swatchesHTML(f)}</div>
      <div class="row-btns">
        <button class="btn" data-sa="save">${f.id ? 'Save' : 'Add subscription'}</button>
        <button class="btn ghost" data-sa="cancel">Cancel</button>
      </div>
      ${f.id ? `<div class="row-btns">
        <button class="btn ghost" data-sa="pause" data-id="${esc(f.id)}">${f.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn ${ui.armed ? 'danger' : 'ghost'}" data-sa="delete" data-id="${esc(f.id)}">${ui.armed ? 'Tap again to delete' : 'Delete'}</button>
      </div>` : ''}
      <p class="muted sm">Nothing is charged or logged by itself. “Log as paid” adds a normal entry when you tap it.</p>
    </section>`;
}

function swatchesHTML(f) {
  return [...new Set([brandOf(f.name).color, ...SWATCHES])].map((c) => `<button class="sw ${c.toLowerCase() === String(f.color).toLowerCase() ? 'on' : ''}" data-sa="color" data-v="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('');
}

function blankForm(prefill = {}) {
  const v = store.view();
  const cats = v.categories.order.filter((c) => c !== 'Income');
  const category = cats.find((c) => c.toLowerCase() === 'subscriptions') || cats[0] || '';
  const name = prefill.name || '';
  const subs = v.categories.map[category] || [];
  const b = brandOf(name);
  return {
    id: null, name, amount: prefill.amount || '', day: prefill.day || '', account: prefill.account || v.accounts[0].name,
    category: prefill.category || category, sub: prefill.sub || subs.find((x) => x.toLowerCase() === name.toLowerCase()) || (name ? '__new' : subs[0] || ''),
    logo: b.logo, color: b.color, rating: '', paused: false, skipped: '',
  };
}

export function renderSubsPage(view, c) {
  ctx = c;
  // a sync can redraw the screen at any time: never tear down an open card, and keep what is being typed
  if (focused && document.contains(focused)) return;   // (the open card lives on <body> until it is put back)
  if (focused) { focused = null; busy = false; const d = document.querySelector('.wdim'); if (d) d.classList.remove('on'); view.style.overflow = ''; }
  if (ui.edit && view.querySelector('#sfName')) readForm();
  const { fmt } = c;
  const v = store.view();
  const all = v.subs.map((s) => ({ s, st: stateOf(s) }));
  const live = all.filter((x) => !x.s.paused).sort((a, b) => a.st.until - b.st.until);
  const paused = all.filter((x) => x.s.paused);
  const total = live.reduce((n, x) => n + x.s.amount, 0);
  const due = live.filter((x) => !x.st.paid && !x.st.skipped);
  const sleepy = live.filter((x) => x.s.rating === '💤');
  const today = todayStr();
  let strip = '';
  for (let i = 0; i < 21; i++) {
    const d = new Date(today + 'T12:00:00'); d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const on = live.filter((x) => x.st.next === iso && !x.st.paid && !x.st.skipped);
    strip += `<button class="sd ${i === 0 ? 'today' : ''}" data-sa="day" data-v="${iso}">${esc(new Intl.DateTimeFormat(undefined, { weekday: 'narrow' }).format(d))}<b>${d.getDate()}</b>${on.length ? `<span class="dot" style="--c:${esc(on[0].s.color || '#5B5BF0')}">${on.length > 1 ? on.length : glyph(on[0].s)}</span>` : '<span class="dot none"></span>'}</button>`;
  }
  const sugg = ui.edit ? [] : spotted();
  const warn = v.subsSupported ? '' : '<p class="warn">Your Google Sheet script doesn’t support subscriptions yet. Paste the updated script (Api.gs), deploy a new version, then sync.</p>';
  view.innerHTML = `<div class="page ${c.animate ? 'enter' : ''}">
    <h2 class="page-title">Subscriptions</h2>
    ${warn}
    ${ui.edit ? formHTML(ui.edit) : ''}
    ${live.length ? `<section class="card subs-head">
      <div class="strip7">${strip}</div>
      <div class="wtotal"><div><small class="muted">Every month</small><div class="big">${esc(fmt(total))}</div></div>
        <div class="muted next">${due.length ? `Next: <b>${esc(due[0].s.name)}</b><br>${esc(whenTxt(due[0].st))} · ${esc(fmt(due[0].s.amount))}` : 'All paid this month'}</div></div>
      <div class="wallet" id="wallet">${live.map((x) => cardHTML(x.s, x.st, fmt)).join('')}</div>
      <p class="muted xs center">Tap a card for details · rate each one on its front</p>
    </section>` : ui.edit ? '' : `<section class="card empty-subs"><p class="muted">Keep Netflix, Spotify and the rest in one place: see what renews next, log it in one tap, and spot the ones you no longer use.</p></section>`}
    ${sleepy.length ? `<div class="savebox">💤 ${esc(sleepy.map((x) => x.s.name).join(', '))}: you would save ${esc(fmt(Math.round(sleepy.reduce((n, x) => n + x.s.amount, 0) * 12)))} a year by cancelling.</div>` : ''}
    ${ui.edit ? '' : `<button class="btn" data-sa="new" ${v.subsSupported ? '' : 'disabled'}>Add subscription</button>`}
    ${sugg.length ? `<section class="card"><div class="card-h"><h3>Spotted in your entries</h3></div>
      ${sugg.map((g, i) => `<div class="spot"><span class="mark" style="--c:${esc(brandOf(g.name).color)}">${glyph({ name: g.name, logo: brandOf(g.name).logo })}</span>
        <span class="spot-t"><b>${esc(g.name)}</b><small>${esc(fmt(g.last.amount))} · ${g.months.size} month${g.months.size === 1 ? '' : 's'}</small></span>
        <button class="chip" data-sa="adopt" data-i="${i}" ${v.subsSupported ? '' : 'disabled'}>Add</button></div>`).join('')}</section>` : ''}
    ${paused.length ? `<section class="card"><div class="card-h"><h3>Paused</h3></div>
      ${paused.map((x) => `<div class="spot"><span class="mark" style="--c:${esc(x.s.color)}">${glyph(x.s)}</span><span class="spot-t"><b>${esc(x.s.name)}</b><small>${esc(fmt(x.s.amount))} a month</small></span><button class="chip" data-sa="edit" data-id="${esc(x.s.id)}">Edit</button></div>`).join('')}</section>` : ''}
  </div>`;
  view._spotted = sugg;
  const w = view.querySelector('#wallet');
  if (w) stack(w);
  bindForm(view);
  // on the document: an open card is moved out of the page (to <body>) while it is in the centre
  if (!bound) { bound = true; document.addEventListener('click', onClick); }
}

// ---- the stack and the Wallet-style focus
let focused = null, busy = false;
function stack(w) {
  const cards = [...w.children];
  if (!cards.length) return;
  const ch = cards[0].offsetHeight || 200, peek = 56;
  cards.forEach((c, i) => { c.style.top = i * peek + 'px'; c.style.zIndex = i; });
  w.style.height = ch + (cards.length - 1) * peek + 'px';
}
function dimEl() {
  let d = document.querySelector('.wdim');
  if (!d) {
    d = document.createElement('div'); d.className = 'wdim'; document.body.appendChild(d);
    const h = document.createElement('div'); h.className = 'whint'; h.textContent = 'Tap outside to put it back'; document.body.appendChild(h);
    d.addEventListener('click', () => unfocus());
  }
  return d;
}
const below = (c) => { const cs = [...c.parentNode.children]; return cs.slice(cs.indexOf(c) + 1); };
function focus(c) {
  if (busy || focused) return;
  busy = true; focused = c;
  const r = c.getBoundingClientRect();
  const sc = Math.min(innerWidth - 28, 460) / r.width;
  c.style.transition = 'none';
  c.style.left = r.left + 'px'; c.style.top = r.top + 'px'; c.style.width = r.width + 'px'; c.style.right = 'auto';
  c.classList.add('focus');
  const lower = below(c);
  c._home = { parent: c.parentNode, next: c.nextSibling };
  document.body.appendChild(c);                    // out of any blurred / animated parent, so "fixed" means the screen
  void c.offsetWidth;
  c.style.transition = '';
  c.style.transform = `translate(${innerWidth / 2 - (r.left + r.width / 2)}px, ${innerHeight / 2 - (r.top + r.height / 2) - 20}px) scale(${sc})`;
  c.classList.add('flip');
  lower.forEach((b, k) => { b.style.transition = 'transform .72s cubic-bezier(.45,0,.2,1)'; b.style.transitionDelay = k * 40 + 'ms'; b.style.transform = `translateY(${innerHeight}px)`; });
  dimEl().classList.add('on');
  const view = document.getElementById('view'); if (view) view.style.overflow = 'hidden';
  haptic(6);
  setTimeout(() => { busy = false; }, 650);
}
function unfocus(after) {
  const c = focused; if (!c || busy) return;
  busy = true;
  c.classList.remove('flip');
  c.style.transform = 'translate(0, 0) scale(1)';
  dimEl().classList.remove('on');
  const view = document.getElementById('view'); if (view) view.style.overflow = '';
  setTimeout(() => {
    c.style.transition = 'none';
    if (c._home && c._home.parent && document.contains(c._home.parent)) c._home.parent.insertBefore(c, c._home.next && c._home.next.parentNode === c._home.parent ? c._home.next : null);
    else c.remove();
    c.classList.remove('focus'); c.style.transform = ''; c.style.left = ''; c.style.width = ''; c.style.right = '';
    focused = null;
    if (c.parentNode) stack(c.parentNode);
    void c.offsetWidth; c.style.transition = '';
    const bl = c.parentNode ? below(c) : [];
    bl.forEach((b, k) => { b.style.transition = ''; b.style.transitionDelay = k * 30 + 'ms'; b.style.transform = ''; });
    setTimeout(() => { bl.forEach((b) => { b.style.transitionDelay = ''; }); busy = false; if (after) after(); }, 560 + bl.length * 30);
  }, 640);
}
// leaving the page while a card is open: put everything back at once
export function resetSubsUI() {
  const d = document.querySelector('.wdim'); if (d) d.classList.remove('on');
  document.querySelectorAll('body > .wcard').forEach((c) => c.remove());
  const view = document.getElementById('view'); if (view) view.style.overflow = '';
  focused = null; busy = false; ui.edit = null; ui.armed = false;
}

// ---- actions
const findSub = (id) => store.view().subs.find((x) => x.id === id);
function rerender() { const view = document.getElementById('view'); if (view && ctx) renderSubsPage(view, { ...ctx, animate: false }); }

function logPaid(s) {
  const v = store.view();
  const today = todayStr();
  const st = stateOf(s, today);
  const date = st.thisDate <= today ? st.thisDate : today;
  let category = s.category, sub = s.sub;
  if (!v.categories.map[category]) { category = v.categories.order.find((c) => c.toLowerCase() === 'subscriptions') || ''; sub = ''; }
  if (!category) { category = store.addCategory('Subscriptions'); }
  const list = store.view().categories.map[category] || [];
  if (!sub || !list.some((x) => x === sub)) {
    const hit = list.find((x) => x.toLowerCase() === s.name.toLowerCase());
    sub = hit || store.addSub(category, s.name);
  }
  store.addEntry({ date, description: s.name, amount: s.amount, type: 'Expense', category, sub, account: s.account || v.accounts[0].name });
  ctx.toast(`${s.name} logged · ${ctx.fmt(s.amount)}`, 'ok');
}

function onClick(e) {
  if (!ctx || !e.target.closest('.wcard, [data-sa]')) return;
  const el = e.target.closest('[data-sa]');
  const card = e.target.closest('.wcard');
  if (!el) { if (card) { if (card === focused) unfocus(); else focus(card); } return; }
  const a = el.dataset.sa, id = el.dataset.id;
  const s = id ? findSub(id) : null;
  if (a === 'rate' && s) { e.stopPropagation(); store.saveSubscription({ ...s, rating: s.rating === el.dataset.v ? '' : el.dataset.v }); haptic(5); rerender(); return; }
  if (a === 'paid' && s) { unfocus(() => { logPaid(s); rerender(); }); return; }
  if (a === 'skip' && s) { unfocus(() => { store.saveSubscription({ ...s, skipped: stateOf(s).key }); ctx.toast(`${s.name} skipped this month`); rerender(); }); return; }
  if (a === 'unskip' && s) { unfocus(() => { store.saveSubscription({ ...s, skipped: '' }); rerender(); }); return; }
  if (a === 'edit' && s) {
    const open = () => { ui.edit = { ...s }; ui.armed = false; rerender(); document.getElementById('view').scrollTo({ top: 0, behavior: 'smooth' }); };
    if (focused) unfocus(open); else open();
    return;
  }
  if (a === 'new') { ui.edit = blankForm(); ui.armed = false; rerender(); return; }
  if (a === 'adopt') {
    const g = (document.getElementById('view')._spotted || [])[+el.dataset.i];
    if (g) { ui.edit = blankForm({ name: g.name, amount: g.last.amount, day: +g.last.date.slice(8, 10), account: g.last.account, category: g.last.category, sub: g.last.sub }); rerender(); }
    return;
  }
  if (a === 'cancel') { ui.edit = null; rerender(); return; }
  if (a === 'color') { ui.edit.color = el.dataset.v; ui.edit.colorPicked = true; refreshFormBits(document.getElementById('view'), false); return; }
  if (a === 'save') { save(); return; }
  if (a === 'pause' && ui.edit) { store.saveSubscription({ ...findSub(ui.edit.id), paused: !ui.edit.paused }); ctx.toast(ui.edit.paused ? 'Resumed' : 'Paused. It stays here but is left out of totals'); ui.edit = null; rerender(); return; }
  if (a === 'delete' && ui.edit) {
    if (!ui.armed) { ui.armed = true; rerender(); return; }
    store.deleteSubscription(ui.edit.id); ctx.toast('Subscription deleted'); ui.edit = null; ui.armed = false; rerender(); return;
  }
  if (a === 'day') {
    const x = liveSubs().find((y) => y.st.next === el.dataset.v);
    const c = x && document.querySelector(`#wallet .wcard[data-id="${CSS.escape(x.s.id)}"]`);
    if (c) { c.scrollIntoView({ block: 'center' }); requestAnimationFrame(() => focus(c)); } else ctx.toast('Nothing renews that day');
  }
}

function readForm() {
  const f = ui.edit; if (!f) return;
  const val = (id) => (document.getElementById(id) || {}).value;
  f.name = val('sfName') ?? f.name; f.amount = val('sfAmt') ?? f.amount; f.day = val('sfDay') ?? f.day;
  f.account = val('sfAcc') ?? f.account; f.category = val('sfCat') ?? f.category; f.sub = val('sfSub') ?? f.sub;
}
function subOptions(f) {
  const subs = store.view().categories.map[f.category] || [];
  const nm = String(f.name || '').trim();
  const opts = subs.map((x) => `<option ${x === f.sub ? 'selected' : ''}>${esc(x)}</option>`).join('');
  return opts + (nm && !subs.some((x) => x.toLowerCase() === nm.toLowerCase()) ? `<option value="__new" ${f.sub === '__new' ? 'selected' : ''}>+ New: ${esc(nm)}</option>` : '');
}
// typing a known name picks its logo, colour and sub-category, without redrawing the form (so focus stays put)
function refreshFormBits(view, nameChanged) {
  readForm();
  const f = ui.edit;
  const subs = store.view().categories.map[f.category] || [];
  if (nameChanged) {
    const b = brandOf(f.name);
    f.logo = b.logo;
    if (!f.id && !f.colorPicked) f.color = b.color;
    const hit = subs.find((x) => x.toLowerCase() === String(f.name).trim().toLowerCase());
    if (hit) f.sub = hit; else if (f.sub === '__new' || !subs.includes(f.sub) || !f.id) f.sub = f.name.trim() ? '__new' : subs[0] || '';
  } else if (!subs.includes(f.sub)) {
    f.sub = subs.find((x) => x.toLowerCase() === String(f.name).trim().toLowerCase()) || (f.name.trim() ? '__new' : subs[0] || '');
  }
  const sel = view.querySelector('#sfSub'); if (sel) sel.innerHTML = subOptions(f);
  const mk = view.querySelector('.subs-form .mark.big');
  if (mk) { mk.style.setProperty('--c', f.color); mk.innerHTML = glyph({ name: f.name || '?', logo: f.logo }); }
  const sw = view.querySelector('.subs-form .swatches'); if (sw) sw.innerHTML = swatchesHTML(f);
}
function bindForm(view) {
  const n = view.querySelector('#sfName');
  if (!n) return;
  let t = 0;
  n.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => refreshFormBits(view, true), 250); });
  const cat = view.querySelector('#sfCat');
  if (cat) cat.addEventListener('change', () => refreshFormBits(view, false));
}

function save() {
  readForm();
  const f = ui.edit;
  const name = String(f.name || '').replace(/\s+/g, ' ').trim();
  const amount = parseFloat(String(f.amount).replace(/,/g, ''));
  const day = parseInt(f.day, 10);
  if (!name) return ctx.toast('Give it a name', 'err');
  if (!(amount > 0)) return ctx.toast('Enter the monthly amount', 'err');
  if (!(day >= 1 && day <= 31)) return ctx.toast('Renewal day must be 1 to 31', 'err');
  let sub = f.sub;
  if (sub === '__new' || !sub) {
    const list = store.view().categories.map[f.category] || [];
    sub = list.find((x) => x.toLowerCase() === name.toLowerCase()) || store.addSub(f.category, name);
  }
  if (!f.logo) f.logo = brandOf(name).logo;
  const { colorPicked, ...data } = f;
  store.saveSubscription({ ...data, name, amount, day, sub });
  haptic(10);
  ctx.toast(f.id ? 'Saved' : `${name} added`, 'ok');
  ui.edit = null; ui.armed = false;
  rerender();
}
