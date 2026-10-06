import * as db from './db.js';
import { makeTransport } from './api.js';
import * as vault from './vault.js';
import { uid, monthKeyOf, round2 } from './util.js';

// ---- state -----------------------------------------------------------------
// snap  : last known server state (authoritative once synced)
// queue : local changes not yet confirmed by the server (add / update / delete)
// view(): snap + queue applied on top, so the UI is always instant and offline-capable.
const S = {
  cfg: null,
  snap: { categories: { order: [], map: {} }, accounts: [], firstStart: 0, months: [], entries: [] },
  queue: [],
  settings: { currency: '', theme: 'system', glass: true, lock: { method: 'off', delay: 60 } },
  status: 'idle', // idle | syncing | synced | offline | error
  error: '',
  lastSync: 0,
  rejected: [],
  trash: [], // recently deleted entries, kept on this device so they can be restored
};
const subs = new Set();
let transport = null;
let cache = null;
let syncing = false;
let timer = null;
let retries = 0;

export const getState = () => S;
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
function emit() { cache = null; subs.forEach((f) => f()); }

async function persist() {
  await Promise.all([db.set('snap', S.snap), db.set('queue', S.queue)]);
}

export async function init() {
  S.cfg = (await db.get('cfg')) || null;
  const snap = await db.get('snap');
  if (snap) S.snap = snap;
  S.queue = (await db.get('queue')) || [];
  S.settings = Object.assign(S.settings, (await db.get('settings')) || {});
  S.lastSync = (await db.get('lastSync')) || 0;
  const cutoff = Date.now() - 60 * 86400000;
  S.trash = ((await db.get('trash')) || []).filter((t) => t.deletedAt > cutoff);
  if (S.cfg) transport = makeTransport(S.cfg);
  emit();
}

export async function connect(cfg) {
  S.cfg = cfg;
  S.snap = { categories: { order: [], map: {} }, accounts: [], firstStart: 0, months: [], entries: [] };
  S.queue = [];
  S.rejected = [];
  await db.set('cfg', cfg);
  await persist();
  transport = makeTransport(cfg);
  emit();
  await sync();
  if (S.status === 'error') {
    const msg = S.error;
    await disconnect();
    throw new Error(msg);
  }
}

// Rewrites everything saved on this phone from memory (used when encryption is switched on or off).
export async function persistEverything() {
  await Promise.all([db.set('cfg', S.cfg), persist(), db.set('settings', S.settings), db.set('lastSync', S.lastSync), db.set('trash', S.trash)]);
}

export async function disconnect() {
  await db.clearAll();
  vault.forget();
  S.cfg = null;
  S.snap = { categories: { order: [], map: {} }, accounts: [], firstStart: 0, months: [], entries: [] };
  S.queue = [];
  S.status = 'idle';
  S.error = '';
  S.lastSync = 0;
  transport = null;
  emit();
}

export async function saveSettings(patch) {
  Object.assign(S.settings, patch);
  await db.set('settings', S.settings);
  emit();
}

// ---- mutations --------------------------------------------------------------
export function addEntry(data) {
  const id = uid();
  enqueue({ type: 'add', id, data: clean(data) });
  return id;
}
export function updateEntry(id, data) { enqueue({ type: 'update', id, data: clean(data) }); }
export function deleteEntry(id) {
  const v = view();
  let e = null;
  for (const k of v.months) {
    const f = v.by[k].entries.find((x) => x.id === id);
    if (f) { e = f; break; }
  }
  let trashId = null;
  if (e) {
    trashId = uid();
    S.trash.unshift({ trashId, deletedAt: Date.now(), data: { date: e.date, description: e.description, amount: e.amount, type: e.type, category: e.category, sub: e.sub, account: e.account } });
    S.trash = S.trash.slice(0, 100);
    db.set('trash', S.trash);
  }
  enqueue({ type: 'delete', id });
  return trashId;
}

// Put a deleted entry back (as a fresh entry with the same details).
export function restoreTrash(trashId) {
  const i = S.trash.findIndex((t) => t.trashId === trashId);
  if (i < 0) return null;
  const [t] = S.trash.splice(i, 1);
  db.set('trash', S.trash);
  return addEntry(t.data);
}

export function clearTrash() {
  S.trash = [];
  db.set('trash', S.trash);
  emit();
}

// Many adds at once (used by Excel import): one save, one redraw, one sync.
export function addMany(list) {
  for (const d of list) S.queue.push({ type: 'add', id: uid(), opId: uid(), ts: Date.now(), data: clean(d) });
  persist();
  emit();
  scheduleSync();
  return list.length;
}

const clean = (d) => ({
  date: d.date,
  description: (d.description || '').trim(),
  amount: round2(d.amount),
  type: d.type,
  category: d.category,
  sub: d.sub,
  ...(d.account ? { account: d.account } : {}),
});

function enqueue(op) {
  op.opId = uid();
  op.ts = Date.now();
  if (op.type === 'saveSubscription' || op.type === 'deleteSubscription') {
    // only the latest pending change per subscription matters; a never-uploaded one that is deleted just disappears
    const known = (S.snap.subscriptions || []).some((x) => x.id === op.id);
    S.queue = S.queue.filter((o) => !((o.type === 'saveSubscription' || o.type === 'deleteSubscription') && o.id === op.id));
    if (op.type === 'saveSubscription' || known) S.queue.push(op);
    persist(); emit(); scheduleSync();
    return;
  }
  const i = S.queue.findIndex((o) => o.id === op.id && o.type !== 'delete');
  if (op.type === 'update') {
    if (i >= 0) S.queue[i].data = op.data; // fold into pending add/update
    else S.queue.push(op);
  } else if (op.type === 'delete') {
    if (i >= 0) {
      const wasAdd = S.queue[i].type === 'add';
      S.queue = S.queue.filter((o) => o.id !== op.id);
      if (!wasAdd) S.queue.push(op);
    } else if (!S.queue.some((o) => o.id === op.id && o.type === 'delete')) {
      S.queue.push(op);
    }
  } else {
    S.queue.push(op);
  }
  persist();
  emit();
  scheduleSync();
}

// ---- categories ----------------------------------------------------------------
// Server list + categories / sub-categories added on this device that have not synced yet.
function mergedCategories() {
  const order = S.snap.categories.order.slice();
  const map = {};
  for (const k of Object.keys(S.snap.categories.map)) map[k] = S.snap.categories.map[k].slice();
  const has = (list, n) => list.some((x) => x.toLowerCase() === n.toLowerCase());
  for (const o of S.queue) {
    if (o.type === 'addCategory' && !has(order, o.name)) { order.push(o.name); map[o.name] = []; }
    else if (o.type === 'addSub' && map[o.category] && !has(map[o.category], o.name)) map[o.category].push(o.name);
  }
  return { order, map };
}

// Returns an error message, or '' when the name is fine.
export function nameError(name, existing, reserved = []) {
  const n = String(name || '').replace(/\s+/g, ' ').trim();
  if (!n) return 'Type a name first.';
  if (n.length > 30) return 'Keep it under 30 characters.';
  if (reserved.some((r) => r.toLowerCase() === n.toLowerCase())) return `"${n}" is reserved.`;
  if (existing.some((x) => x.toLowerCase() === n.toLowerCase())) return `"${n}" already exists.`;
  return '';
}

export function addCategory(name) {
  const n = String(name).replace(/\s+/g, ' ').trim();
  enqueue({ type: 'addCategory', id: uid(), name: n });
  return n;
}

export function addSub(category, name) {
  const n = String(name).replace(/\s+/g, ' ').trim();
  enqueue({ type: 'addSub', id: uid(), category, name: n });
  return n;
}

// ---- accounts ------------------------------------------------------------------
// Server list (the first one is the default) + accounts added or changed on this device that have not synced yet.
// An older server that knows nothing about accounts just gives us the single default one.
const DEFAULT_ACCOUNT = { name: 'Credit Card', type: 'card', limit: 0, archived: false };

function mergedAccounts() {
  const list = (S.snap.accounts && S.snap.accounts.length ? S.snap.accounts : [DEFAULT_ACCOUNT]).map((a) => ({ ...a }));
  for (const o of S.queue) {
    if (o.type === 'addAccount') {
      if (!list.some((a) => a.name.toLowerCase() === o.name.toLowerCase())) list.push({ name: o.name, type: o.accType === 'cash' ? 'cash' : 'card', limit: Number(o.limit) > 0 ? Number(o.limit) : 0, archived: false });
    } else if (o.type === 'updateAccount') {
      const a = list.find((x) => x.name.toLowerCase() === o.name.toLowerCase());
      if (!a) continue;
      if (o.limit !== undefined) a.limit = Number(o.limit) > 0 ? Number(o.limit) : 0;
      if (o.archived !== undefined) a.archived = !!o.archived;
      if (o.accType !== undefined) a.type = o.accType === 'cash' ? 'cash' : 'card';
    } else if (o.type === 'deleteAccount') {
      const i = list.findIndex((x) => x.name.toLowerCase() === o.name.toLowerCase());
      if (i > 0) list.splice(i, 1);
    }
  }
  return list;
}

function resolveAccountName(list, name) {
  if (!name) return '';
  const a = list.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  return a ? a.name : '';
}

export function addAccount(name, accType = 'card', limit = 0) {
  const n = String(name).replace(/\s+/g, ' ').trim();
  enqueue({ type: 'addAccount', id: uid(), name: n, accType, limit: Number(limit) > 0 ? round2(limit) : 0 });
  return n;
}

export function updateAccount(name, patch) {
  enqueue({ type: 'updateAccount', id: uid(), name, ...patch });
}

// Remove an account for good: entries in `dropIds` are deleted, the rest (and its subscriptions) move to `moveTo` first (in queue order, so the server
// sees them moved before the account goes). Returns how many entries were moved.
export function deleteAccount(name, moveTo, dropIds = new Set()) {
  const v = view();
  const key = name.toLowerCase();
  let moved = 0;
  const own = [];
  for (const k of v.months) for (const e of v.by[k].entries) if (String(e.account).toLowerCase() === key) own.push(e);
  for (const e of own) {
    if (dropIds.has(e.id)) { deleteEntry(e.id); continue; }    // goes to Recently deleted, can be restored
    enqueue({ type: 'update', id: e.id, data: clean({ date: e.date, description: e.description, amount: e.amount, type: e.type, category: e.category, sub: e.sub, account: moveTo }) });
    moved++;
  }
  for (const x of v.subs) if (String(x.account).toLowerCase() === key) saveSubscription({ ...x, account: moveTo });
  enqueue({ type: 'deleteAccount', id: uid(), name });
  return moved;
}

// ---- subscriptions -----------------------------------------------------------
// Server list + changes made on this device that have not synced yet. An older server script sends no list at all.
function mergedSubs() {
  const list = (S.snap.subscriptions || []).map((x) => ({ ...x }));
  for (const o of S.queue) {
    if (o.type === 'saveSubscription') {
      const i = list.findIndex((x) => x.id === o.id);
      const v = { id: o.id, ...o.data, amount: Number(o.data.amount), day: Number(o.data.day) };
      if (i >= 0) list[i] = v; else list.push(v);
    } else if (o.type === 'deleteSubscription') {
      const i = list.findIndex((x) => x.id === o.id);
      if (i >= 0) list.splice(i, 1);
    }
  }
  return list;
}

export function saveSubscription(sub) {
  const id = sub.id || uid();
  const data = {
    name: String(sub.name || '').replace(/\s+/g, ' ').trim(), amount: round2(sub.amount), day: Math.round(Number(sub.day)),
    category: sub.category || '', sub: sub.sub || '', account: sub.account || '', logo: sub.logo || '', color: sub.color || '',
    rating: sub.rating || '', paused: !!sub.paused, skipped: sub.skipped || '',
  };
  enqueue({ type: 'saveSubscription', id, data });
  return id;
}

export function deleteSubscription(id) {
  enqueue({ type: 'deleteSubscription', id });
}

// ---- derived view -----------------------------------------------------------
export function view() {
  if (cache) return cache;
  const map = new Map(S.snap.entries.map((e) => [e.id, e]));
  const pending = new Set();
  for (const o of S.queue) {
    if (o.type === 'addCategory' || o.type === 'addSub' || o.type === 'addAccount' || o.type === 'updateAccount' || o.type === 'deleteAccount' || o.type === 'saveSubscription' || o.type === 'deleteSubscription') continue;
    pending.add(o.id);
    if (o.type === 'delete') map.delete(o.id);
    else map.set(o.id, { id: o.id, ...o.data, amount: Number(o.data.amount) });
  }
  const accounts = mergedAccounts();
  const defAcc = accounts[0].name;
  for (const e of map.values()) e.account = resolveAccountName(accounts, e.account) || defAcc;
  const by = {};
  const keys = new Set(S.snap.months);
  for (const e of map.values()) {
    const k = monthKeyOf(e.date);
    keys.add(k);
    (by[k] = by[k] || { key: k, entries: [] }).entries.push(e);
  }
  const sorted = [...keys].sort();
  const serverFirst = [...S.snap.months].sort()[0];
  const months = {};
  let prev = null;
  sorted.forEach((k) => {
    const m = by[k] || { key: k, entries: [] };
    m.entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    let spent = 0;
    let income = 0;
    m.entries.forEach((e) => { if (e.type === 'Income') income += e.amount; else spent += e.amount; });
    m.spent = round2(spent);
    m.income = round2(income);
    m.start = prev === null ? (serverFirst && k >= serverFirst ? S.snap.firstStart : 0) : prev;
    m.available = round2(m.start - m.spent + m.income);
    prev = m.available;
    months[k] = m;
  });
  cache = { months: sorted, by: months, categories: mergedCategories(), accounts, pending, accountsSupported: S.snap.accounts.length > 0 || !S.lastSync, subs: mergedSubs(), subsSupported: Array.isArray(S.snap.subscriptions) || !S.lastSync };
  return cache;
}

// ---- sync -------------------------------------------------------------------
export function scheduleSync(ms = 500) {
  clearTimeout(timer);
  timer = setTimeout(() => sync(), ms);
}

export async function sync() {
  if (!transport || syncing) return;
  if (!navigator.onLine && !(S.cfg && S.cfg.demo)) {
    S.status = 'offline';
    emit();
    return;
  }
  syncing = true;
  S.status = 'syncing';
  emit();
  try {
    const ops = S.queue.slice(0, 20); // big batches go up in slices so each request stays quick
    const r = ops.length ? await transport.call('push', { ops }) : await transport.call('pull', {});
    const done = new Set([...(r.applied || []), ...(r.rejected || []).map((x) => x.opId)]);
    if (r.rejected && r.rejected.length) S.rejected = r.rejected;
    S.queue = S.queue.filter((o) => !done.has(o.opId));
    S.snap = { categories: r.categories, accounts: r.accounts || [], subscriptions: r.subscriptions, firstStart: r.firstStart, months: r.months, entries: r.entries };
    S.lastSync = Date.now();
    retries = 0;
    S.status = 'synced';
    S.error = '';
    await db.set('lastSync', S.lastSync);
  } catch (e) {
    const msg = (e && e.message) || String(e);
    // "Load failed" / "Failed to fetch": the request never completed (phone radio asleep, tunnel, dropped signal...).
    const network = !navigator.onLine || e instanceof TypeError || /load failed|failed to fetch|network|timed out|abort/i.test(msg);
    if (network) {
      S.status = navigator.onLine ? 'retrying' : 'offline';
      S.error = "Couldn't reach the server. Trying again automatically…";
      retries++;
      if (navigator.onLine) scheduleSync(Math.min(60000, 2500 * Math.pow(2, retries - 1)));
    } else {
      S.status = 'error';
      S.error = msg;
      retries++;
      scheduleSync(Math.min(120000, 15000 * retries));
    }
    if (S.cfg && S.cfg.demo && localStorage.getItem('el_demo_offline') === '1') S.status = 'offline';
  } finally {
    syncing = false;
    await persist();
    emit();
    if (S.queue.length && S.status === 'synced') scheduleSync(300);
  }
}

export function takeRejected() {
  const r = S.rejected;
  S.rejected = [];
  return r;
}

export function exportCsv() {
  const v = view();
  const withAcc = v.accounts.length > 1;   // one account: same columns as ever
  const rows = [['Date', 'Description', 'Amount', 'Type', 'Category', 'Sub-Category'].concat(withAcc ? ['Account'] : [])];
  v.months.slice().reverse().forEach((k) => v.by[k].entries.forEach((e) => rows.push([e.date, e.description, e.amount, e.type, e.category, e.sub].concat(withAcc ? [e.account] : []))));
  return rows;
}
