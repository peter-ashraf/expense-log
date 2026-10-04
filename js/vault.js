// Encryption at rest for everything the app keeps on the phone.
//
//   passphrase --PBKDF2(600k, SHA-256, random salt)--> key-encryption key (never stored)
//   key-encryption key --AES-GCM--> unwraps the random 256-bit DATA key (the wrapped copy is kept in localStorage)
//   data key --AES-GCM--> seals every value written to IndexedDB (entries, queue, settings, API address + key, trash)
//
// The passphrase is never stored, and the data key exists in memory only while the app is unlocked. Without the
// passphrase the stored data is random-looking bytes, in the Application tab and in the console alike.
// Limits: it protects data at rest. While the app is open and unlocked the page itself holds the numbers, and a
// weak passphrase can be guessed offline (that is why the app asks for at least 8 characters).

import { b64u } from './lock.js';

const META = 'el_vault';
const ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

let dek = null;         // CryptoKey (not extractable) while unlocked
let dekRaw = null;      // kept only to re-wrap on passphrase change; cleared on forget()

const readMeta = () => { try { return JSON.parse(localStorage.getItem(META)); } catch (e) { return null; } };

export const isEnabled = () => !!readMeta();
/** 'device' = the app keeps the key itself (nothing to remember); 'passphrase' = locked with a passphrase; null = off. */
export const mode = () => { const m = readMeta(); return m ? (m.mode || 'passphrase') : null; };

// ---- automatic mode ------------------------------------------------------------------------------
// A random AES-256 key is created by the browser as NOT extractable (its bytes can't be read back, not even by this
// code) and kept in its own small IndexedDB. Everything the app stores is sealed with it. Nothing for the user to
// remember. It hides the data from anyone looking through the app's stored data; it cannot stop someone who can run code
// inside the unlocked app, because the app itself must be able to use the key.
function idbKeystore() {
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open('expenselog-keys', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('k');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const run = async (kind, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('k', kind);
      const req = fn(t.objectStore('k'));
      t.oncomplete = () => { db.close(); res(req && req.result); };
      t.onerror = () => { db.close(); rej(t.error); };
      t.onabort = () => { db.close(); rej(t.error); };
    });
  };
  return { get: () => run('readonly', (s) => s.get('dek')), put: (k) => run('readwrite', (s) => s.put(k, 'dek')), del: () => run('readwrite', (s) => s.delete('dek')) };
}
let keystore = null;
const store = () => keystore || (keystore = idbKeystore());
export function _setKeyStore(ks) { keystore = ks; }      // for tests

/** Turns automatic encryption on. Leaves the vault open. */
export async function createDevice() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await store().put(key);
  localStorage.setItem(META, JSON.stringify({ v: 2, mode: 'device' }));
  dek = key;
  dekRaw = null;
}

/** Opens automatic encryption at start-up. Throws 'KEY_MISSING' when the browser no longer has the key. */
export async function openDevice() {
  let key = null;
  try { key = await store().get(); } catch (e) { key = null; }
  if (!key) throw new Error('KEY_MISSING');
  dek = key;
  dekRaw = null;
  return true;
}
export const isOpen = () => !!dek;
export const MIN_LENGTH = 8;

async function kekFrom(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function wrap(raw, pass) {
  const salt = rand(16), iv = rand(12);
  const kek = await kekFrom(pass, salt, ITER);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, raw);
  return { v: 1, iter: ITER, salt: b64u.enc(salt), iv: b64u.enc(iv), wrapped: b64u.enc(ct) };
}

const useRaw = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

/** Turns encryption on: makes a fresh data key and locks it with the passphrase. Leaves the vault open. */
export async function create(pass) {
  if (String(pass || '').length < MIN_LENGTH) throw new Error(`Use at least ${MIN_LENGTH} characters.`);
  const raw = rand(32);
  const meta = await wrap(raw, pass);
  localStorage.setItem(META, JSON.stringify(meta));
  dekRaw = raw;
  dek = await useRaw(raw);
}

/** Unlocks with the passphrase. Throws 'Wrong passphrase.' when it does not fit. */
export async function open(pass) {
  const m = readMeta();
  if (!m) throw new Error('Encryption is not set up.');
  let raw;
  try {
    const kek = await kekFrom(String(pass || ''), b64u.dec(m.salt), m.iter);
    raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(m.iv) }, kek, b64u.dec(m.wrapped)));
  } catch (e) { throw new Error('Wrong passphrase.'); }
  dekRaw = raw;
  dek = await useRaw(raw);
  return true;
}

/** Same data key, new passphrase. Needs the vault to be open already. */
export async function changePassphrase(oldPass, newPass) {
  const m = readMeta();
  if (!m || !dekRaw) throw new Error('Unlock first.');
  try {   // prove the old passphrase
    const kek = await kekFrom(String(oldPass || ''), b64u.dec(m.salt), m.iter);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(m.iv) }, kek, b64u.dec(m.wrapped));
  } catch (e) { throw new Error('Wrong passphrase.'); }
  if (String(newPass || '').length < MIN_LENGTH) throw new Error(`Use at least ${MIN_LENGTH} characters.`);
  localStorage.setItem(META, JSON.stringify(await wrap(dekRaw, newPass)));
}

/** Verifies a passphrase without touching the open vault (used before turning encryption off). */
export async function check(pass) {
  const m = readMeta();
  if (!m) return false;
  try {
    const kek = await kekFrom(String(pass || ''), b64u.dec(m.salt), m.iter);
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(m.iv) }, kek, b64u.dec(m.wrapped));
    return true;
  } catch (e) { return false; }
}

/** Removes encryption: forgets the key and its wrapped copy. Only call after the data has been unsealed. */
export function forget() {
  const wasDevice = mode() === 'device';
  dek = null;
  dekRaw = null;
  try { localStorage.removeItem(META); sessionStorage.removeItem('el_dek_tmp'); } catch (e) { /* ignore */ }
  if (wasDevice) { try { store().del().catch(() => {}); } catch (e) { /* ignore */ } }
}

// ---- sealing values ------------------------------------------------------------------------------
export const isSealed = (x) => !!(x && typeof x === 'object' && x.__v === 1 && x.ct && x.iv);

export async function seal(value) {
  if (!dek) throw new Error('The app is locked.');
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dek, enc.encode(JSON.stringify(value === undefined ? null : value)));
  return { __v: 1, iv: b64u.enc(iv), ct: b64u.enc(ct) };
}

export async function unseal(obj) {
  if (!isSealed(obj)) return obj;     // not sealed yet (data written before encryption was switched on)
  if (!dek) throw new Error('The app is locked.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64u.dec(obj.iv) }, dek, b64u.dec(obj.ct));
  return JSON.parse(dec.decode(pt));
}

// ---- surviving an automatic reload (for example after an app update) without asking again ---------------
// The key is parked in sessionStorage for the moment of the reload and removed as soon as the new page reads it.
export function stashForReload() {
  try { if (dekRaw) sessionStorage.setItem('el_dek_tmp', b64u.enc(dekRaw)); } catch (e) { /* ignore */ }
}

export async function takeStash() {
  try {
    const t = sessionStorage.getItem('el_dek_tmp');
    sessionStorage.removeItem('el_dek_tmp');
    if (!t || !isEnabled()) return false;
    dekRaw = b64u.dec(t);
    dek = await useRaw(dekRaw);
    return true;
  } catch (e) { return false; }
}
