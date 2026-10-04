// The lock screen and the rules for when it appears.
import * as L from './lock.js';

const $ = (s) => document.querySelector(s);
const root = document.documentElement;

let api = null;                 // { getLock, setLock, haptic, onReset }
let hiddenAt = 0;
let busy = false;               // enrolling or re-verifying from Settings (not the lock screen)
let attempt = null;             // the Face ID / Touch ID request started from the lock screen, if any
let entry = '';
let fails = 0;
let blockedUntil = Number((() => { try { return localStorage.getItem('el_lock_until'); } catch (e) { return 0; } })()) || 0; // survives closing the app

const cfg = () => (api ? api.getLock() : { method: 'off' });
export const method = () => cfg().method || 'off';
export const isEnabled = () => method() === 'bio' || method() === 'pin';
export const isLocked = () => root.classList.contains('locked');

export function initLock(opts) {
  api = opts;
  const lock = $('#lock');
  // Biometric mode: the whole screen is one big button (a tap is needed for iOS to allow the Face ID prompt).
  lock.addEventListener('click', (e) => {
    if (!isLocked() || method() !== 'bio') return;
    if (e.target.closest('#lockReset')) return;
    tryBio(false);
  });
  $('#lockReset').addEventListener('click', () => {
    if (confirm('Remove the lock and disconnect this device?\n\nThis clears the local copy on this phone only. Your Google Sheet is untouched, and you can connect again afterwards.')) api.onReset();
  });
  if (!isEnabled()) { unlockApp(); } else { lockApp(); }
}

function setText(title, sub) {
  $('#lockTitle').textContent = title;
  $('#lockSub').textContent = sub;
}

function renderPin() {
  const len = cfg().pin ? cfg().pin.len : 4;
  const dots = Array.from({ length: len }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  $('#lockPin').innerHTML = `<div class="pin-dots" id="pinDots">${dots}</div>
    <div class="pin-pad">${keys.map((k) => (k === '' ? '<span></span>' : `<button type="button" data-k="${k}" aria-label="${k === 'del' ? 'Delete' : k}">${k === 'del' ? '⌫' : k}</button>`)).join('')}</div>`;
  $('#lockPin').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => pinKey(b.dataset.k)));
}

function render() {
  const bio = method() === 'bio';
  $('#lockBio').hidden = !bio;
  $('#lockPin').hidden = bio;
  if (bio) setText('Locked', 'Tap anywhere to unlock');
  else {
    renderPin();
    const left = Math.ceil((blockedUntil - Date.now()) / 1000);
    if (left > 0) {
      setText('Too many attempts', `Try again in ${left} seconds`);
      setTimeout(() => { fails = 0; if (isLocked()) setText('Enter PIN', 'Enter your PIN to unlock'); }, left * 1000);
    } else setText('Enter PIN', 'Enter your PIN to unlock');
  }
}

async function pinKey(k) {
  if (Date.now() < blockedUntil) return;
  if (k === 'del') entry = entry.slice(0, -1);
  else if (entry.length < (cfg().pin ? cfg().pin.len : 4)) entry += k;
  api.haptic(6);
  renderPin();
  const len = cfg().pin ? cfg().pin.len : 4;
  if (entry.length < len) return;
  const ok = await L.pinCheck(entry, cfg().pin);
  if (ok) { unlockApp(); return; }
  fails++;
  entry = '';
  api.haptic(25);
  const dots = $('#pinDots');
  if (dots) { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); }
  if (fails >= 5) {
    blockedUntil = Date.now() + 30000;
    try { localStorage.setItem('el_lock_until', String(blockedUntil)); } catch (e) { /* ignore */ }
    setText('Too many attempts', 'Try again in 30 seconds');
    setTimeout(() => { fails = 0; if (isLocked()) setText('Enter PIN', 'Enter your PIN to unlock'); }, 30000);
  } else setText('Wrong PIN', `${5 - fails} attempt${5 - fails === 1 ? '' : 's'} left`);
  renderPin();
}

// An automatic attempt (no tap behind it) can be left waiting forever by iOS without ever being refused. That must
// never block the next tap: a tap always replaces an older attempt, and every attempt gives up after 30 seconds.
export async function tryBio(auto) {
  if (!isLocked() || method() !== 'bio') return;
  if (attempt) {
    if (auto || Date.now() - attempt.at < 1200) return;      // don't stack automatic tries, or double-fire a quick tap
    attempt.ctl.abort();
    attempt = null;
  }
  const ctl = new AbortController();
  const mine = { ctl, auto, at: Date.now() };
  attempt = mine;
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    await L.bioVerify(cfg().credId, ctl.signal);
    unlockApp();
  } catch (e) {
    if (attempt !== mine) return;                            // a newer attempt took over; let it speak
    const cancelled = e && (e.name === 'NotAllowedError' || e.name === 'AbortError');
    setText('Locked', cancelled ? (auto ? 'Tap anywhere to unlock' : 'Cancelled. Tap anywhere to try again') : 'Couldn’t verify. Tap anywhere to try again');
  } finally {
    clearTimeout(timer);
    if (attempt === mine) attempt = null;
  }
}

export function lockApp() {
  if (!isEnabled()) return;
  root.classList.add('locked');
  root.classList.remove('cover');
  $('#app').setAttribute('inert', '');
  entry = '';
  render();
  if (method() === 'bio') setTimeout(() => tryBio(true), 200); // may be refused without a tap; the tap-anywhere fallback covers that
}

export function unlockApp() {
  try { localStorage.removeItem('el_lock_until'); } catch (e) { /* ignore */ }
  root.classList.remove('locked', 'cover');
  $('#app').removeAttribute('inert');
  fails = 0;
  entry = '';
}

/** Call from visibilitychange: hide the app in the app switcher, and lock after the chosen time away. */
export function onVisibility() {
  if (!isEnabled() || busy) return;
  if (document.visibilityState === 'hidden') {
    hiddenAt = Date.now();
    if (!isLocked()) root.classList.add('cover');
    return;
  }
  if (attempt && Date.now() - attempt.at > 1500) { attempt.ctl.abort(); attempt = null; }
  const away = Date.now() - hiddenAt;
  const need = Math.max(1000, (cfg().delay == null ? 60 : cfg().delay) * 1000);
  if (isLocked()) { if (method() === 'bio') setTimeout(() => tryBio(true), 250); }
  else if (away >= need) lockApp();
  else root.classList.remove('cover');
}

/** Verifies the owner again (used before turning the lock off). Bio asks Face ID; PIN asks via `askPin`. */
export async function verifyOwner(askPin) {
  if (method() === 'bio') {
    busy = true;
    try { await L.bioVerify(cfg().credId); } finally { busy = false; }
    return true;
  }
  if (method() === 'pin') {
    const pin = await askPin();
    if (!pin || !(await L.pinCheck(pin, cfg().pin))) throw new Error('Wrong PIN.');
    return true;
  }
  return true;
}

export async function enableBio(keepDelay) {
  if (!(await L.bioAvailable())) throw new Error('Face ID / Touch ID isn’t available for web apps on this device. Try the PIN lock instead.');
  busy = true;
  try {
    const credId = await L.bioEnroll();
    await api.setLock({ method: 'bio', credId, delay: keepDelay, pin: null });
  } finally { busy = false; }
  try { localStorage.setItem('el_lock', 'bio'); } catch (e) { /* ignore */ }
}

export async function enablePin(pin, keepDelay) {
  const rec = await L.pinCreate(pin);
  await api.setLock({ method: 'pin', pin: rec, delay: keepDelay, credId: null });
  try { localStorage.setItem('el_lock', 'pin'); } catch (e) { /* ignore */ }
}

export async function disableLock() {
  await api.setLock({ method: 'off', pin: null, credId: null, delay: cfg().delay });
  try { localStorage.removeItem('el_lock'); } catch (e) { /* ignore */ }
  unlockApp();
}
