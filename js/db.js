// Tiny key-value store on IndexedDB with a localStorage fallback.
// When encryption is on (see vault.js) every value is sealed before it is written and unsealed when it is read.
// iOS sometimes leaves IndexedDB hanging after the app was force-closed (requests that never answer). Every call
// therefore has a time limit: a stuck connection is thrown away and opened again once, and if storage still doesn't
// answer the call fails with STORAGE_TIMEOUT instead of waiting forever.
import * as vault from './vault.js';

const NAME = 'expenselog';
const LIMIT = 5000;
let dbp = null;

export class StorageTimeout extends Error { constructor() { super('STORAGE_TIMEOUT'); } }

function timed(p, ms = LIMIT) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new StorageTimeout()), ms); })]).finally(() => clearTimeout(t));
}

function open() {
  if (dbp) return dbp;
  const p = new Promise((resolve, reject) => {
    try {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        const db = r.result;
        db.onclose = () => { if (dbp === p) dbp = null; };            // the browser closed it under us: reopen next time
        db.onversionchange = () => { db.close(); if (dbp === p) dbp = null; };
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new StorageTimeout());
    } catch (e) { reject(e); }
  });
  dbp = p;
  p.catch(() => { if (dbp === p) dbp = null; });
  return p;
}

// Runs one request; on a hang, drops the connection and tries a fresh one once.
async function run(fn) {
  for (let i = 0; ; i++) {
    try {
      const db = await timed(open());
      return await timed(new Promise((res, rej) => fn(db, res, rej)));
    } catch (e) {
      if (!(e instanceof StorageTimeout) && !(e && e.name === 'InvalidStateError')) throw e;
      try { if (dbp) (await dbp).close(); } catch (e2) { /* ignore */ }
      dbp = null;
      if (i >= 1) throw new StorageTimeout();
    }
  }
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
    return await run((db, res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(key);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch (e) {
    if (e instanceof StorageTimeout) throw e;   // storage is there but stuck: don't pretend the phone is empty
    try { return JSON.parse(localStorage.getItem('el:' + key)); } catch (e2) { return undefined; }
  }
}

async function rawSet(key, value) {
  try {
    await run((db, res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) {
    if (e instanceof StorageTimeout) throw e;
    try { localStorage.setItem('el:' + key, JSON.stringify(value)); } catch (e2) { /* storage unavailable */ }
  }
}

export async function clearAll() {
  try {
    await run((db, res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch (e) { /* ignore */ }
  try { Object.keys(localStorage).filter((k) => k.startsWith('el:')).forEach((k) => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
}
