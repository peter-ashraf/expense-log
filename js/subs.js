// Subscriptions: dual-mode Wallet ("3D Flip" stack + continuous "Pass Deck"), a strip of the coming days,
// a quick "worth it?" rating, and suggestions from repeated purchases.
// Nothing is ever charged automatically: "Log as paid" adds a normal entry, only when tapped.
import * as store from './store.js';
import { nfSpan, syncNumFlow } from './numflow.js';
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

const subsStyle = () => (store.getState().settings.subsStyle === 'pass' ? 'pass' : 'flip');
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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

// ---- the page state
const ui = { edit: null, armed: false };
let ctx = null;
let bound = false;

// Mode A (3D Flip) state
let focused = null, busy = false, focusSeq = 0, dirtyWhileFocused = false;

// Mode B (Pass Deck) state
let passOrder = [];
let passOpenId = null;
let forcePassRerender = false;
let passResizeObs = null;
let passDrag = null;
let suppressPassClickUntil = 0;

// ---- Mode A markup: 3D Flip card
const PEEK_BTN_STYLE = 'flex:none;width:auto;height:26px;padding:0 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.24);line-height:1';
const CLOSE_BTN_STYLE = 'flex:none;width:26px;height:26px;padding:0;border-radius:50%;font-size:12px;font-weight:700;display:grid;place-items:center;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.24)';

function cardHTML(s, st, fmt) {
  const acc = s.account || store.view().accounts[0].name;
  const ratingRow = `<div class="r7">${['🔥', '😐', '💤'].map((e) => `<button type="button" data-sa="rate" data-id="${esc(s.id)}" data-v="${e}" class="${s.rating === e ? 'on' : ''}" aria-label="Rate ${e}">${e}</button>`).join('')}</div>`;
  const status = st.paid ? 'Paid' : st.skipped ? 'Skipped' : esc(whenTxt(st));
  return `<div class="wcard ${st.paid || st.skipped ? 'done' : ''} ${s.rating === '💤' ? 'sleepy' : ''}" data-id="${esc(s.id)}" style="--c:${esc(s.color || '#5B5BF0')}">
      <div class="face front">
        <div class="top"><span class="mark">${glyph(s)}</span><span class="name">${esc(s.name)}</span><span class="fld"><i>Monthly</i><b>${esc(fmt(s.amount))}</b></span>
          <span class="back-acts front-acts" hidden style="display:none;align-items:center;gap:6px;flex:none;margin-left:auto"><button type="button" data-sa="peek" data-id="${esc(s.id)}" style="${PEEK_BTN_STYLE}">Details</button><button type="button" data-sa="close-card" data-id="${esc(s.id)}" aria-label="Close" style="${CLOSE_BTN_STYLE}">✕</button></span></div>
        ${ratingRow}
        <div class="grid"><div><i>Next</i><b>${status}</b></div><div><i>Account</i><b>${esc(acc)}</b></div><div><i>Per year</i><b>${esc(fmt(Math.round(s.amount * 12)))}</b></div></div>
      </div>
      <div class="face back">
        <div class="top"><span class="mark">${glyph(s)}</span><span class="name">${esc(s.name)}</span><span class="fld"><i>Monthly</i><b>${esc(fmt(s.amount))}</b></span>
          <span class="back-acts" style="display:flex;align-items:center;gap:6px;flex:none;margin-left:auto"><button type="button" data-sa="peek" data-id="${esc(s.id)}" style="${PEEK_BTN_STYLE}">Front</button><button type="button" data-sa="close-card" data-id="${esc(s.id)}" aria-label="Close" style="${CLOSE_BTN_STYLE}">✕</button></span></div>
        <div class="grid g2"><div><i>Next</i><b>${status}</b></div><div><i>Account</i><b>${esc(acc)}</b></div><div><i>Per year</i><b>${esc(fmt(Math.round(s.amount * 12)))}</b></div></div>
        <div class="grid"><div><i>Renews</i><b>${ord(s.day)}</b></div><div><i>Per week</i><b>${esc(fmt(Math.round(s.amount * 12 / 52)))}</b></div><div><i>Per day</i><b>${esc(fmt(Math.round(s.amount / 30 * 10) / 10))}</b></div></div>
        <div class="btns">
          ${st.paid ? '<button type="button" class="main" disabled>Paid this month ✓</button>' : `<button type="button" class="main" data-sa="paid" data-id="${esc(s.id)}">Log as paid</button>`}
          ${st.paid ? '' : `<button type="button" data-sa="${st.skipped ? 'unskip' : 'skip'}" data-id="${esc(s.id)}">${st.skipped ? 'Undo skip' : 'Skip month'}</button>`}
          <button type="button" class="more" data-sa="edit" data-id="${esc(s.id)}" aria-label="Edit ${esc(s.name)}">Edit</button>
        </div>
      </div>
    </div>`;
}

// ---- Mode B helpers & markup: Pass Deck
const BRAND_GRADIENTS = {
  claude: ['#EDA082', '#D97757', '#6E311B'],
  spotify: ['#35DD73', '#1DB954', '#0A4B22'],
  youtube: ['#FF4D4D', '#D91B1B', '#660808'],
  youtubemusic: ['#FF4D4D', '#D91B1B', '#660808'],
  netflix: ['#F52F38', '#C80812', '#520308'],
  icloud: ['#68B5FF', '#3693F3', '#12417E'],
};
const RATING_LABELS = { '🔥': '🔥 Worth it', '😐': '😐 Okay', '💤': '💤 Sleepy' };

function parseHex(hex) {
  let h = String(hex || '').trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) h = '5B5BF0';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mixHex(rgb, target, t) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return '#' + rgb.map((v, i) => toHex(v + (target[i] - v) * t)).join('');
}
function passGradient(s) {
  const b = brandOf(s.name);
  const key = s.logo || b.logo;
  const baseColor = s.color || b.color || '#5B5BF0';
  if (BRAND_GRADIENTS[key] && baseColor.toLowerCase() === b.color.toLowerCase()) {
    const [a, m, z] = BRAND_GRADIENTS[key];
    return `linear-gradient(142deg, ${a}, ${m}, ${z})`;
  }
  const rgb = parseHex(baseColor);
  const brighter = mixHex(rgb, [255, 255, 255], 0.22);
  const base = mixHex(rgb, rgb, 0);
  const deepest = mixHex(rgb, [0, 0, 0], 0.54);
  return `linear-gradient(142deg, ${brighter}, ${base}, ${deepest})`;
}

function syncPassOrder(live) {
  const liveIds = live.map((x) => x.s.id);
  const liveSet = new Set(liveIds);
  passOrder = passOrder.filter((id) => liveSet.has(id));
  for (const id of liveIds) if (!passOrder.includes(id)) passOrder.push(id);
  if (passOpenId && !liveSet.has(passOpenId)) passOpenId = null;
}

function billingEntries(s) {
  const v = store.view();
  const target = s.name.trim().toLowerCase();
  const hits = [];
  for (let i = v.months.length - 1; i >= 0 && hits.length < 3; i--) {
    const m = v.by[v.months[i]];
    if (!m) continue;
    for (const e of m.entries) {
      if (e.type === 'Expense' && e.description.trim().toLowerCase() === target) {
        hits.push(e);
        if (hits.length >= 3) break;
      }
    }
  }
  return hits;
}

function passBarHTML(ordered) {
  if (!passOpenId) {
    return `<span>${ordered.length} Subscriptions</span><button type="button" class="chip sm" data-sa="pass-cycle">↻ Cycle</button>`;
  }
  const openIdx = Math.max(0, ordered.findIndex((x) => x.s.id === passOpenId));
  return `<button type="button" class="chip on sm" data-sa="pass-close" data-testid="pass-all-btn">← All passes</button><div class="pass-nav"><span>Pass ${openIdx + 1} of ${ordered.length}</span><button type="button" class="pass-step" data-sa="pass-prev" aria-label="Previous pass">‹</button><button type="button" class="pass-step" data-sa="pass-next" aria-label="Next pass">›</button></div>`;
}

function passDetailsHTML(s, st, fmt) {
  if (!s) return '';
  const entries = billingEntries(s);
  const nextStatus = st.paid ? 'Paid this month' : st.skipped ? 'Skipped this month' : whenTxt(st);
  return `<div class="pass-act-row">
      <div class="pass-r7">
        ${[['🔥', 'Worth it'], ['😐', 'Okay'], ['💤', 'Sleepy']].map(([e, lbl]) =>
          `<button type="button" class="${s.rating === e ? 'on' : ''}" data-sa="rate" data-id="${esc(s.id)}" data-v="${e}">${e} ${lbl}</button>`
        ).join('')}
      </div>
      <div class="pass-act-btns">
        ${st.paid ? '<button type="button" class="main" disabled>Paid this month ✓</button>' : `<button type="button" class="main" data-sa="paid" data-id="${esc(s.id)}">Log as paid</button>`}
        ${st.paid ? '' : `<button type="button" data-sa="${st.skipped ? 'unskip' : 'skip'}" data-id="${esc(s.id)}">${st.skipped ? 'Undo skip' : 'Skip month'}</button>`}
        <button type="button" data-sa="edit" data-id="${esc(s.id)}">Edit</button>
      </div>
    </div>
    <div class="pass-ledger">
      <div class="pass-ledger-row"><b>Billing ledger</b></div>
      <div class="pass-ledger-row">
        <span class="pass-ledger-next">Next renewal · ${esc(st.next)} · ${esc(nextStatus)}</span>
        <b>${esc(fmt(s.amount))}</b>
      </div>
      ${entries.length ? entries.map((e) => `<div class="pass-ledger-row">
        <span>${esc(e.date)}${e.account ? ` · ${esc(e.account)}` : ''}</span>
        <b>${esc(fmt(e.amount))}</b>
      </div>`).join('') : '<div class="pass-ledger-row"><span>No logged payments yet</span></div>'}
    </div>`;
}

function passCardHTML(s, st, idx, fmt) {
  const acc = s.account || store.view().accounts[0].name;
  const status = st.paid ? 'Paid' : st.skipped ? 'Skipped' : whenTxt(st);
  const prog = st.paid || st.skipped ? 100 : Math.max(4, Math.min(100, Math.round((1 - Math.max(0, st.until) / 31) * 100)));
  const ratingText = RATING_LABELS[s.rating] || 'Unrated';
  return `<div class="pcard ${st.paid || st.skipped ? 'done' : ''} ${s.rating === '💤' ? 'sleepy' : ''}" data-pass-card="true" data-id="${esc(s.id)}" style="z-index:${10 + idx}">
      <div class="pcard-face" style="background:${passGradient(s)}">
        <div class="pass-crown">
          <span class="mark" style="--c:${esc(s.color || '#5B5BF0')}">${glyph(s)}</span>
          <div style="flex:1;min-width:0;display:flex;flex-direction:column">
            <b style="font-size:15.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</b>
            <small style="font-size:11.5px;opacity:.82;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(acc)} · ${esc(s.category || 'Subscription')}</small>
          </div>
          <div style="text-align:right;flex:none"><b style="font-size:16px;font-weight:750;font-variant-numeric:tabular-nums">${esc(fmt(s.amount))}</b><small style="font-size:11px;opacity:.82"> /mo</small></div>
        </div>
        <div class="pass-mid">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;font-weight:650">
            <span>Next: ${esc(status)} · ${ord(s.day)}</span>
            <span class="pass-pill">${esc(ratingText)}</span>
          </div>
          <div class="pass-bar"><i style="width:${prog}%"></i></div>
        </div>
        <div class="pass-foot">
          <div><i style="display:block;font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.72">Account</i><b>${esc(acc)}</b></div>
          <div><i style="display:block;font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.72">Weekly</i><b>${esc(fmt(Math.round(s.amount * 12 / 52)))}</b></div>
          <div style="text-align:right"><i style="display:block;font-style:normal;font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;opacity:.72">Annual</i><b>${esc(fmt(Math.round(s.amount * 12)))}</b></div>
        </div>
      </div>
      <button type="button" class="pass-hit" data-id="${esc(s.id)}" aria-label="Open ${esc(s.name)} pass" style="top:0;height:100%"></button>
    </div>`;
}

function disconnectPassObserver() {
  if (passResizeObs) {
    passResizeObs.disconnect();
    passResizeObs = null;
  }
}

function layoutPassDeck(instant = false) {
  const stage = document.getElementById('passStage');
  if (!stage) return;
  const cards = passOrder.map((id) => stage.querySelector(`.pcard[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
  if (!cards.length) return;
  const details = stage.querySelector('.pass-details');
  const firstCard = cards[0];
  const cardW = firstCard.clientWidth || stage.clientWidth || 320;
  const cardH = firstCard.offsetHeight || Math.round(cardW / 1.586);
  const panelH = details ? details.offsetHeight : 0;

  if (instant || reduceMotion()) {
    cards.forEach((c) => { c.style.transition = 'none'; });
    if (details) details.style.transition = 'none';
  }

  const openIdx = passOpenId ? passOrder.indexOf(passOpenId) : -1;
  if (passOpenId && openIdx < 0) passOpenId = null;
  document.body.classList.toggle('pass-open', Boolean(passOpenId));

  if (!passOpenId) {
    const peek = 48;
    const N = cards.length;
    cards.forEach((c, idx) => {
      c.removeAttribute('data-pocket-card');
      c.classList.remove('is-open', 'is-pocket');
      c.style.zIndex = String(10 + idx);
      c.style.transformOrigin = 'top center';
      c.style.touchAction = 'pan-x';
      const hit = c.querySelector('.pass-hit');
      if (hit) { hit.style.height = '100%'; hit.style.touchAction = 'pan-x'; }
      const scale = 1 - (N - 1 - idx) * 0.014;
      const y = idx * peek;
      c.style.transform = `translate3d(0, ${y}px, 0) scale(${scale.toFixed(4)})`;
    });
    if (details) {
      details.setAttribute('aria-hidden', 'true');
      details.style.opacity = '0';
      details.style.pointerEvents = 'none';
      details.style.transform = `translate3d(0, ${Math.max(0, (N - 1) * peek + 20)}px, 0)`;
    }
    stage.style.height = Math.round(cardH + Math.max(0, N - 1) * peek) + 'px';
  } else {
    const gap = 12;
    const panelY = cardH + gap;
    const pocketStep = 52;
    const pocketCount = cards.length - 1;
    const pocketBase = panelY + panelH + (pocketCount > 0 ? 14 : 0);
    let pIdx = 0;

    cards.forEach((c, idx) => {
      const isOpen = idx === openIdx;
      const hit = c.querySelector('.pass-hit');
      c.style.zIndex = String(10 + idx);
      c.style.transformOrigin = 'top center';
      if (isOpen) {
        c.removeAttribute('data-pocket-card');
        c.classList.add('is-open');
        c.classList.remove('is-pocket');
        c.style.touchAction = 'none';
        if (hit) { hit.style.height = '100%'; hit.style.touchAction = 'none'; }
        c.style.transform = 'translate3d(0, 0, 0) scale(1)';
      } else {
        c.setAttribute('data-pocket-card', 'true');
        c.classList.remove('is-open');
        c.classList.add('is-pocket');
        c.style.touchAction = 'manipulation';
        if (hit) { hit.style.height = '52px'; hit.style.touchAction = 'manipulation'; }
        const scale = 1 - (pocketCount - 1 - pIdx) * 0.014;
        const y = pocketBase + pIdx * pocketStep;
        c.style.transform = `translate3d(0, ${y}px, 0) scale(${scale.toFixed(4)})`;
        pIdx++;
      }
    });
    if (details) {
      details.setAttribute('aria-hidden', 'false');
      details.style.opacity = '1';
      details.style.pointerEvents = 'auto';
      details.style.transform = `translate3d(0, ${panelY}px, 0)`;
    }
    const pocketH = pocketCount > 0 ? (pocketCount - 1) * pocketStep + 56 : 0;
    stage.style.height = Math.round(pocketCount > 0 ? pocketBase + pocketH : cardH + gap + panelH) + 'px';
  }

  if (instant || reduceMotion()) {
    void stage.offsetHeight;
    cards.forEach((c) => { c.style.transition = ''; });
    if (details) details.style.transition = '';
  }
}

function refreshPassHeaderAndPanel() {
  const stage = document.getElementById('passStage');
  const headerEl = document.querySelector('[data-testid="pass-deck-header"]');
  if (!stage || !ctx) return;
  const live = liveSubs();
  syncPassOrder(live);
  const byId = new Map(live.map((x) => [x.s.id, x]));
  const ordered = passOrder.map((id) => byId.get(id)).filter(Boolean);
  if (headerEl) headerEl.innerHTML = passBarHTML(ordered);
  const details = stage.querySelector('.pass-details');
  if (details) {
    const active = passOpenId ? byId.get(passOpenId) : null;
    details.innerHTML = active ? passDetailsHTML(active.s, active.st, ctx.fmt) : '';
  }
}

function openPass(id) {
  const stage = document.getElementById('passStage');
  if (!stage || !passOrder.includes(id)) return;
  const wasClosed = !passOpenId;
  passOpenId = id;
  refreshPassHeaderAndPanel();
  layoutPassDeck(false);
  if (wasClosed) {
    const headerEl = document.querySelector('[data-testid="pass-deck-header"]');
    headerEl?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
  }
}

function closePass() {
  if (!passOpenId) return;
  passOpenId = null;
  refreshPassHeaderAndPanel();
  layoutPassDeck(false);
}

function bindPassObservers(stage) {
  disconnectPassObserver();
  if (typeof ResizeObserver !== 'function') return;
  const firstCard = stage.querySelector('.pcard');
  const details = stage.querySelector('.pass-details');
  let lastW = firstCard ? firstCard.clientWidth : 0;
  let lastH = details ? details.offsetHeight : 0;
  passResizeObs = new ResizeObserver(() => {
    const nw = firstCard ? firstCard.clientWidth : 0;
    const nh = details ? details.offsetHeight : 0;
    if (Math.abs(nw - lastW) >= 1 || Math.abs(nh - lastH) >= 1) {
      lastW = nw;
      lastH = nh;
      layoutPassDeck(true);
    }
  });
  if (firstCard) passResizeObs.observe(firstCard);
  if (details) passResizeObs.observe(details);
}

// ---- form
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
  // a sync can redraw the screen at any time: never tear down an open card or pass, and keep what is being typed
  if (focused && document.contains(focused)) return;
  if (focused) { focused = null; busy = false; const d = document.querySelector('.wdim'); if (d) d.classList.remove('on'); view.style.overflow = ''; }
  const mode = subsStyle();
  if (mode === 'pass' && passOpenId && !forcePassRerender && document.getElementById('passStage')) return;
  forcePassRerender = false;

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

  let ordered = live;
  if (mode === 'pass') {
    syncPassOrder(live);
    const byId = new Map(live.map((x) => [x.s.id, x]));
    ordered = passOrder.map((id) => byId.get(id)).filter(Boolean);
    document.body.classList.toggle('pass-open', Boolean(passOpenId));
  } else {
    document.body.classList.remove('pass-open');
    disconnectPassObserver();
  }

  const activePass = mode === 'pass' && passOpenId ? ordered.find((x) => x.s.id === passOpenId) : null;
  const styleSwitcher = `<div class="seg two subs-style-seg" role="radiogroup" aria-label="Subscriptions style">
      <button role="radio" aria-checked="${mode === 'flip'}" class="${mode === 'flip' ? 'on' : ''}" data-sa="subs-style" data-v="flip">3D Flip</button>
      <button role="radio" aria-checked="${mode === 'pass'}" class="${mode === 'pass' ? 'on' : ''}" data-sa="subs-style" data-v="pass">Pass Deck</button>
    </div>`;

  const deckMarkup = mode === 'pass'
    ? `<div class="pass-deck-bar" data-testid="pass-deck-header">${passBarHTML(ordered)}</div>
      <div id="passStage" class="pass-stage">
        <div class="pass-details" data-testid="pass-activity-panel" style="top:0;z-index:1">${activePass ? passDetailsHTML(activePass.s, activePass.st, fmt) : ''}</div>
        ${ordered.map((x, idx) => passCardHTML(x.s, x.st, idx, fmt)).join('')}
      </div>
      <p class="muted xs center">Tap a pass to inspect · drag down to put back</p>`
    : `<div class="wallet" id="wallet">${live.map((x) => cardHTML(x.s, x.st, fmt)).join('')}</div>
      <p class="muted xs center">Tap a card for details · rate each one on its front</p>`;

  const prevScroll = view.scrollTop;
  const sugg = ui.edit ? [] : spotted();
  const warn = v.subsSupported ? '' : '<p class="warn">Your Google Sheet script doesn’t support subscriptions yet. Paste the updated script (Api.gs), deploy a new version, then sync.</p>';
  view.innerHTML = `<div class="page ${c.animate ? 'enter' : ''}">
    <h2 class="page-title">Subscriptions</h2>
    ${warn}
    ${ui.edit ? formHTML(ui.edit) : ''}
    ${live.length ? `<section class="card subs-head">
      <div class="strip7">${strip}</div>
      <div class="wtotal"><div><small class="muted">Every month</small><div class="big">${nfSpan(total, 'subs-monthly-total', esc(fmt(total)))}</div></div>
        <div class="muted next">${due.length ? `Next: <b>${esc(due[0].s.name)}</b><br>${esc(whenTxt(due[0].st))} · ${esc(fmt(due[0].s.amount))}` : 'All paid this month'}</div></div>
      ${styleSwitcher}
      ${deckMarkup}
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
  syncNumFlow(view);

  if (mode === 'pass') {
    const stage = view.querySelector('#passStage');
    if (stage) {
      layoutPassDeck(true);
      bindPassObservers(stage);
      if (passOpenId) view.scrollTop = prevScroll;
    }
  } else {
    const w = view.querySelector('#wallet');
    if (w) stack(w);
  }
  bindForm(view);

  // on the document: an open card is moved out of the page (to <body>) while it is in the centre
  if (!bound) {
    bound = true;
    document.addEventListener('click', onClick);
    document.addEventListener('pointerdown', onPassPointerDown);
    document.addEventListener('pointermove', onPassPointerMove);
    document.addEventListener('pointerup', onPassPointerUp);
    document.addEventListener('pointercancel', onPassPointerUp);
  }
}

// ---- Mode A: stack and sequenced two-phase 3D Flip focus
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

function appBox() {
  const appEl = document.getElementById('app');
  if (appEl) {
    const ar = appEl.getBoundingClientRect();
    return {
      left: ar.left + appEl.clientLeft,
      top: ar.top + appEl.clientTop,
      width: appEl.clientWidth || innerWidth,
      height: appEl.clientHeight || innerHeight,
    };
  }
  return { left: 0, top: 0, width: innerWidth, height: innerHeight };
}

function setPeeking(c, peeking) {
  c.classList.toggle('peek', peeking);
  c.classList.toggle('flip', !peeking);
  const fa = c.querySelector('.front-acts');
  if (fa) {
    fa.hidden = !peeking;
    fa.style.display = peeking ? 'flex' : 'none';
  }
}

function focus(c) {
  if (busy || focused) return;
  busy = true;
  focused = c;
  dirtyWhileFocused = false;
  const seq = ++focusSeq;
  const rm = reduceMotion();
  const lower = below(c);
  const leadMs = lower.length > 0 && !rm ? 380 : 0;

  // Phase 1: clear cards below cleanly with S-curve, keep cards above completely untouched
  if (lower.length > 0) {
    lower.forEach((b, k) => {
      b.style.willChange = 'transform';
      b.style.transition = rm ? 'none' : 'transform 0.58s cubic-bezier(0.36, 0.06, 0.24, 1)';
      b.style.transitionDelay = rm ? '' : (lower.length - 1 - k) * 50 + 'ms';
      b.style.transform = 'translateY(560px)';
    });
  }
  haptic(6);

  const launchFocus = () => {
    if (seq !== focusSeq || !c.isConnected) return;
    const box = appBox();
    const r = c.getBoundingClientRect();
    const sc = Math.min(box.width - 28, 420) / (r.width || 1);
    const targetH = r.height * sc;
    const centerX = box.left + box.width / 2;
    const centerY = box.top + box.height / 2 - 14;

    c._home = { parent: c.parentNode, next: c.nextSibling };
    c.style.setProperty('transition', 'none', 'important');
    c.style.willChange = 'transform';
    c.style.left = r.left + 'px';
    c.style.top = r.top + 'px';
    c.style.width = r.width + 'px';
    c.style.right = 'auto';
    c.classList.add('focus');
    c.classList.remove('peek');
    const fa = c.querySelector('.front-acts');
    if (fa) { fa.hidden = true; fa.style.display = 'none'; }
    document.body.appendChild(c);

    const d = dimEl();
    d.classList.add('on');
    const hint = document.querySelector('.whint');
    if (hint) {
      hint.style.top = Math.min(innerHeight - 54, Math.round(centerY + targetH / 2 + 12)) + 'px';
      hint.style.bottom = 'auto';
    }
    const view = document.getElementById('view');
    if (view) view.style.overflow = 'hidden';

    void c.offsetWidth;
    c.style.setProperty('transition', rm ? 'none' : 'transform 0.52s cubic-bezier(0.22, 1, 0.36, 1)', 'important');
    c.style.transform = `translate(${centerX - (r.left + r.width / 2)}px, ${centerY - (r.top + r.height / 2)}px) scale(${sc})`;
    c.classList.add('flip');

    setTimeout(() => {
      if (seq === focusSeq) busy = false;
    }, rm ? 0 : 530);
  };

  if (leadMs > 0) setTimeout(launchFocus, leadMs);
  else launchFocus();
}

function unfocus(after) {
  const c = focused;
  if (!c || busy) return;
  busy = true;
  const seq = ++focusSeq;
  const rm = reduceMotion();

  // Phase 1 (0ms -> 440ms): return focused card to slot & fade dim backdrop while lower cards stay parked
  c.classList.remove('flip', 'peek');
  const fa = c.querySelector('.front-acts');
  if (fa) { fa.hidden = true; fa.style.display = 'none'; }
  c.style.setProperty('transition', rm ? 'none' : 'transform 0.44s cubic-bezier(0.32, 0.72, 0, 1)', 'important');
  c.style.transform = 'translate(0, 0) scale(1)';
  dimEl().classList.remove('on');
  const view = document.getElementById('view');
  if (view) view.style.overflow = '';

  const phase2 = () => {
    if (seq !== focusSeq) return;
    c.style.setProperty('transition', 'none', 'important');
    if (c._home && c._home.parent && document.contains(c._home.parent)) {
      c._home.parent.insertBefore(c, c._home.next && c._home.next.parentNode === c._home.parent ? c._home.next : null);
    } else {
      c.remove();
    }
    c.classList.remove('focus');
    c.style.transform = '';
    c.style.left = '';
    c.style.width = '';
    c.style.right = '';
    c.style.willChange = '';
    c.style.removeProperty('transition');
    if (c.parentNode) stack(c.parentNode);
    focused = null;

    void c.offsetWidth;
    const bl = c.parentNode ? below(c) : [];
    bl.forEach((b, k) => {
      b.style.transition = rm ? 'none' : 'transform 0.52s cubic-bezier(0.22, 1, 0.36, 1)';
      b.style.transitionDelay = rm ? '' : k * 48 + 'ms';
      b.style.transform = '';
    });

    const settleMs = rm ? 0 : 540 + bl.length * 48;
    setTimeout(() => {
      if (seq !== focusSeq) return;
      bl.forEach((b) => { b.style.transition = ''; b.style.transitionDelay = ''; b.style.willChange = ''; });
      busy = false;
      const shouldRerender = dirtyWhileFocused;
      dirtyWhileFocused = false;
      if (after) after();
      else if (shouldRerender) rerender();
    }, settleMs);
  };

  if (rm) phase2();
  else setTimeout(phase2, 450);
}

// leaving the page while a card or pass is open: put everything back at once
export function resetSubsUI() {
  focusSeq++;
  const d = document.querySelector('.wdim'); if (d) d.classList.remove('on');
  const h = document.querySelector('.whint'); if (h) { h.style.top = ''; h.style.bottom = ''; }
  document.querySelectorAll('body > .wcard').forEach((c) => c.remove());
  const view = document.getElementById('view'); if (view) view.style.overflow = '';
  focused = null; busy = false; dirtyWhileFocused = false;
  passOpenId = null; forcePassRerender = false; passDrag = null; suppressPassClickUntil = 0;
  disconnectPassObserver();
  document.body.classList.remove('pass-open');
  ui.edit = null; ui.armed = false;
}

// ---- Pass Deck touch / pointer gestures
function onPassPointerDown(e) {
  if (!ctx || subsStyle() !== 'pass' || e.button > 0) return;
  const card = e.target.closest('#passStage .pcard');
  if (!card) return;
  const stage = document.getElementById('passStage');
  if (!stage) return;
  if (passOpenId) {
    if (card.dataset.id !== passOpenId) return;
    passDrag = { mode: 'dismiss', card, stage, startX: e.clientX, startY: e.clientY, dy: 0, moved: false, pointerId: e.pointerId };
  } else {
    passDrag = { mode: 'fan', card, stage, startX: e.clientX, startY: e.clientY, dy: 0, moved: false, pointerId: e.pointerId };
  }
}

function onPassPointerMove(e) {
  if (!passDrag || e.pointerId !== passDrag.pointerId) return;
  const dx = e.clientX - passDrag.startX;
  const dy = e.clientY - passDrag.startY;
  if (!passDrag.moved) {
    if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
    if (passDrag.mode === 'fan' && Math.abs(dx) > Math.abs(dy) * 1.2) { passDrag = null; return; }
    passDrag.moved = true;
  }
  passDrag.dy = dy;
  suppressPassClickUntil = performance.now() + 350;

  if (passDrag.mode === 'dismiss') {
    const pullY = dy > 0 ? dy : dy * 0.2;
    const sc = dy > 0 ? Math.max(0.92, 1 - dy * 0.0005) : 1;
    passDrag.card.style.transition = 'none';
    passDrag.card.style.transform = `translate3d(0, ${pullY.toFixed(1)}px, 0) scale(${sc.toFixed(4)})`;
    const details = passDrag.stage.querySelector('.pass-details');
    if (details && dy > 0) details.style.opacity = String(Math.max(0.15, 1 - dy / 140));
  } else {
    const elastic = dy > 0 ? Math.min(26, dy * 0.24) : -Math.min(10, Math.abs(dy) * 0.12);
    const cards = passOrder.map((id) => passDrag.stage.querySelector(`.pcard[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
    const N = cards.length;
    const peek = 48;
    cards.forEach((c, idx) => {
      c.style.transition = 'none';
      const scale = 1 - (N - 1 - idx) * 0.014;
      const y = idx * (peek + elastic * 0.55);
      c.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
    });
  }
}

function onPassPointerUp(e) {
  if (!passDrag || e.pointerId !== passDrag.pointerId) return;
  const d = passDrag;
  passDrag = null;
  if (!d.moved) return;
  suppressPassClickUntil = performance.now() + 350;
  d.stage.querySelectorAll('.pcard').forEach((c) => { c.style.transition = ''; });
  if (d.mode === 'dismiss' && e.type === 'pointerup' && d.dy > 55) {
    haptic(6);
    closePass();
  } else {
    layoutPassDeck(false);
  }
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

const READ_ACTS = new Set(['day', 'subs-style', 'peek', 'close-card', 'pass-cycle', 'pass-close', 'pass-prev', 'pass-next']);

function onClick(e) {
  if (!ctx) return;
  if (e.target.closest('.pass-hit') && !e.target.closest('[data-sa]')) {
    if (performance.now() < suppressPassClickUntil) return;
    const hit = e.target.closest('.pass-hit');
    const id = hit.dataset.id;
    if (id) {
      haptic(5);
      if (passOpenId === id) closePass();
      else openPass(id);
    }
    return;
  }
  if (!e.target.closest('.wcard, [data-sa]')) return;
  const el = e.target.closest('[data-sa]');
  const card = e.target.closest('.wcard');
  if (!el) { if (card) { if (card === focused) unfocus(); else focus(card); } return; }
  const a = el.dataset.sa, id = el.dataset.id;
  if (store.isViewer() && !READ_ACTS.has(a)) return;   // view only: look, don't touch

  if (a === 'subs-style') {
    const nextStyle = el.dataset.v === 'pass' ? 'pass' : 'flip';
    resetSubsUI();
    store.saveSettings({ subsStyle: nextStyle });
    haptic(6);
    rerender();
    return;
  }
  if (a === 'peek') {
    if (focused) {
      const peeking = !focused.classList.contains('peek');
      setPeeking(focused, peeking);
      haptic(5);
    }
    return;
  }
  if (a === 'close-card') {
    unfocus();
    return;
  }
  if (a === 'pass-cycle') {
    if (passOrder.length > 1 && !passOpenId) {
      passOrder.unshift(passOrder.pop());
      refreshPassHeaderAndPanel();
      layoutPassDeck(false);
      haptic(5);
    }
    return;
  }
  if (a === 'pass-close') {
    haptic(5);
    closePass();
    return;
  }
  if ((a === 'pass-prev' || a === 'pass-next') && passOrder.length > 1) {
    const curIdx = Math.max(0, passOrder.indexOf(passOpenId));
    const nextIdx = a === 'pass-prev'
      ? (curIdx - 1 + passOrder.length) % passOrder.length
      : (curIdx + 1) % passOrder.length;
    haptic(5);
    openPass(passOrder[nextIdx]);
    return;
  }

  const s = id ? findSub(id) : null;
  if (a === 'rate' && s) {
    e.stopPropagation();
    const nextRating = s.rating === el.dataset.v ? '' : el.dataset.v;
    if (subsStyle() === 'pass' && passOpenId) forcePassRerender = true;
    store.saveSubscription({ ...s, rating: nextRating });
    haptic(5);
    if (focused && focused.dataset.id === s.id) {
      dirtyWhileFocused = true;
      focused.classList.toggle('sleepy', nextRating === '💤');
      focused.querySelectorAll('.r7 button').forEach((b) => b.classList.toggle('on', b.dataset.v === nextRating));
    }
    if (!focused && forcePassRerender) rerender();
    else if (!focused && subsStyle() !== 'pass') rerender();
    forcePassRerender = false;
    return;
  }
  if (a === 'paid' && s) {
    if (subsStyle() === 'pass') {
      forcePassRerender = true;
      logPaid(s);
      if (forcePassRerender) { forcePassRerender = false; rerender(); }
      return;
    }
    unfocus(() => { logPaid(s); rerender(); });
    return;
  }
  if (a === 'skip' && s) {
    if (subsStyle() === 'pass') {
      forcePassRerender = true;
      store.saveSubscription({ ...s, skipped: stateOf(s).key });
      ctx.toast(`${s.name} skipped this month`);
      if (forcePassRerender) { forcePassRerender = false; rerender(); }
      return;
    }
    unfocus(() => { store.saveSubscription({ ...s, skipped: stateOf(s).key }); ctx.toast(`${s.name} skipped this month`); rerender(); });
    return;
  }
  if (a === 'unskip' && s) {
    if (subsStyle() === 'pass') {
      forcePassRerender = true;
      store.saveSubscription({ ...s, skipped: '' });
      if (forcePassRerender) { forcePassRerender = false; rerender(); }
      return;
    }
    unfocus(() => { store.saveSubscription({ ...s, skipped: '' }); rerender(); });
    return;
  }
  if (a === 'edit' && s) {
    const open = () => {
      ui.edit = { ...s };
      ui.armed = false;
      rerender();
      document.getElementById('view').scrollTo({ top: 0, behavior: 'smooth' });
    };
    if (focused) unfocus(open);
    else {
      if (passOpenId) { passOpenId = null; document.body.classList.remove('pass-open'); }
      open();
    }
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
    if (!x) { ctx.toast('Nothing renews that day'); return; }
    if (subsStyle() === 'pass') { openPass(x.s.id); return; }
    const c = document.querySelector(`#wallet .wcard[data-id="${CSS.escape(x.s.id)}"]`);
    if (c) { c.scrollIntoView({ block: 'center' }); requestAnimationFrame(() => focus(c)); }
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
