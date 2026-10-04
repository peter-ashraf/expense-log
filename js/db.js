// Tiny key-value store on IndexedDB with a localStorage fallback.
// When encryption is on (see vault.js) every value is sealed before it is written and unsealed when it is read.
import * as vault from './vault.js';

const NAME = 'expenselog';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    } catch (e) { reject(e); }
  });
  return dbp;
}

export async function get(key) {
  const raw = await rawGet(key);
  return vault.isEnabled() ? vault.unseal(raw) : raw;
}

export async function set(key, value) {
  await rawSet(key, vault.isEnabled() ? await vault.seal(value) : value);
}

async function rawGet(key) {
  try {
    const db = await open();
    return await new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch (e) {
    try { return JSON.parse(localStorage.getItem('el:' + key)); } catch (e2) { return undefined; }
  }
}

async function rawSet(key, value) {
  try {
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    try { localStorage.setItem('el:' + key, JSON.stringify(value)); } catch (e2) { /* storage unavailable */ }
  }
}

export async function clearAll() {
  try {
    const db = await open();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* ignore */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith('el:')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
}
