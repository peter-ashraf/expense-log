import { useEffect, useMemo, useState } from 'react';
import * as store from '../../../js/store.js';
import * as util from '../../../js/util.js';
import * as vault from '../../../js/vault.js';
import { promptUnlock } from '../../../js/vaultui.js';
import * as lk from '../../../js/lockui.js';
import { hardReload } from '../../../js/refresh.js';
import { parseMessages, suggestNote, FUEL_BIG_FILL } from '../../../js/quick.js';
import { computeInsights, computeAllTime, computeStreak, weeklySeries, topMerchants } from '../../../js/insights.js';
import { buildWorkbook, parseWorkbook } from '../../../js/xlsx.js';
import { readCsvEntries, decodeText } from '../../../js/csv.js';
import { brandOf, stateOf as subStateOf } from '../../../js/subs.js';

export const APP_VERSION = '3.20.3';
export const SCRIPT_LATEST = 11;
export const VLINK_KEY = 'el_vlink';
export { store, util, vault, lk, hardReload, parseMessages, suggestNote, FUEL_BIG_FILL, computeInsights, computeAllTime, computeStreak, weeklySeries, topMerchants, buildWorkbook, parseWorkbook, readCsvEntries, decodeText, brandOf, subStateOf };

const STYLE_BG = {
  obsidian: { light: '#F3F5FA', dark: '#06070C' },
  kinetic: { light: '#F7F8FC', dark: '#090B10' },
  editorial: { light: '#FAF8F4', dark: '#111215' },
};

const RATING_EMOJI_TO_ID = { '🔥': 'love', '😐': 'meh', '💤': 'sleep', love: 'love', meh: 'meh', sleep: 'sleep' };
const RATING_ID_TO_EMOJI = { love: '🔥', meh: '😐', sleep: '💤' };

export function toUiRating(r) {
  return RATING_EMOJI_TO_ID[r] || '';
}

export function toStoreRating(r) {
  return RATING_ID_TO_EMOJI[r] || '';
}

export function viewLinkUrl(cfg, token) {
  const base = location.origin + location.pathname;
  const u = cfg && cfg.demo ? 'demo' : (cfg && cfg.url) || '';
  return `${base}#v=${encodeURIComponent(u)}&t=${encodeURIComponent(token)}`;
}

export function parseViewLink(str) {
  try {
    const raw = String(str || '').trim();
    if (!raw) return null;
    const h = raw.includes('#') ? raw.split('#').slice(1).join('#') : raw;
    const p = new URLSearchParams(h);
    const v = p.get('v');
    const t = p.get('t');
    if (!v || !t) return null;
    return v === 'demo' ? { demo: true, token: t } : { url: v, token: t };
  } catch {
    return null;
  }
}

export function hexMixColor(concept, resolvedTheme, p = 0) {
  const s = STYLE_BG[concept] ? concept : 'obsidian';
  const base = STYLE_BG[s][resolvedTheme === 'light' ? 'light' : 'dark'].replace('#', '');
  if (p <= 0.001) return '#' + base;
  const k = 1 - 0.42 * p;
  return (
    '#' +
    [0, 2, 4]
      .map((i) => Math.round(parseInt(base.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0'))
      .join('')
  );
}

// iOS home-indicator double-inset compensation (ported identically from js/app.js)
let lastFitInfo = '';
export function getFitInfo() {
  return lastFitInfo;
}

export function fitApp() {
  const root = document.documentElement;
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) 0';
  document.body.appendChild(probe);
  const inset = probe.offsetHeight;
  probe.style.padding = 'env(safe-area-inset-top,0px) 0 0 0';
  const insetTop = probe.offsetHeight;
  probe.remove();
  const gap = standalone && window.innerHeight > window.innerWidth
    ? Math.max(screen.width, screen.height) - window.innerHeight
    : 0;
  const shortUnderBar = gap > 8 && insetTop >= gap - 8;
  root.style.setProperty('--safe-b', shortUnderBar ? '0px' : 'env(safe-area-inset-bottom, 0px)');
  const vv = window.visualViewport ? Math.round(window.visualViewport.height) : '-';
  lastFitInfo = `inner ${window.innerWidth}×${window.innerHeight} · visual ${vv} · screen ${screen.width}×${screen.height} · insets ${insetTop}+${inset - insetTop} · gap ${gap}${shortUnderBar ? ' (compensated)' : ''} · ${standalone ? 'app' : 'browser'}`;
}

// iOS 9-second storage hang rescue + lock screen wiring
let booted = false;
function bootRescue(why) {
  if (booted) return;
  const root = document.documentElement;
  root.classList.add('locked');
  ['#lockBio', '#lockPin', '#lockPass'].forEach((s) => {
    const el = document.querySelector(s);
    if (el) el.hidden = true;
  });
  const lt = document.querySelector('#lockTitle');
  const ls = document.querySelector('#lockSub');
  if (lt) lt.textContent = 'Still opening…';
  if (ls) ls.textContent = (why ? 'This phone’s storage didn’t respond. ' : 'This is taking longer than usual. ') + 'Tap anywhere to reload.';
  const lock = document.querySelector('#lock');
  if (!lock || lock.dataset.rescue) return;
  lock.dataset.rescue = '1';
  lock.addEventListener('click', (e) => {
    if (booted) return;
    if (e.target.closest('#lockReset')) {
      if (confirm('Still stuck after reloading?\n\nThis clears the app’s copy on this phone and starts fresh. Your Google Sheet is untouched; anything not yet uploaded from this phone is lost.')) {
        try { ['el_lock', 'el_vault'].forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }
        try { indexedDB.deleteDatabase('expenselog'); indexedDB.deleteDatabase('expenselog-keys'); } catch { /* ignore */ }
        setTimeout(() => location.reload(), 600);
      }
      return;
    }
    location.reload();
  });
}

// iOS WebSpeech warm-hold helper
let micStream = null;
let micTimer = null;
export async function holdMic() {
  clearTimeout(micTimer);
  if (micStream && micStream.active) return;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    micStream = null;
  }
}
export function releaseMic() {
  clearTimeout(micTimer);
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
}
export function scheduleMicRelease() {
  clearTimeout(micTimer);
  if (micStream) micTimer = setTimeout(releaseMic, 15000);
}

// Account helpers matching js/app.js
export function cashFlow(v, accName) {
  let spent = 0;
  let income = 0;
  for (const k of v.months) {
    for (const e of v.by[k].entries) {
      if (e.account === accName) {
        if (e.type === 'Expense') spent += e.amount;
        else if (e.type === 'Income') income += e.amount;
      }
    }
  }
  return { spent, income };
}

export function cashLeft(v, a) {
  if (!a || !(a.limit > 0)) return null;
  const f = cashFlow(v, a.name);
  return Math.round((a.limit - f.spent + f.income) * 100) / 100;
}

export function cashStartFor(v, a, nowAmt) {
  const f = cashFlow(v, a.name);
  return Math.max(0.01, Math.round((nowAmt + f.spent - f.income) * 100) / 100);
}

export function scopedMonth(v, monthKey, accountFilter) {
  const m = v.by[monthKey] || { key: monthKey, entries: [], spent: 0, income: 0, start: 0, available: 0 };
  if (!accountFilter || accountFilter === 'all') return m;
  const entries = m.entries.filter((e) => e.account === accountFilter);
  let spent = 0;
  let income = 0;
  for (const e of entries) {
    if (e.type === 'Income') income += e.amount;
    else spent += e.amount;
  }
  spent = Math.round(spent * 100) / 100;
  income = Math.round(income * 100) / 100;
  return { key: m.key, entries, spent, income, start: 0, available: Math.round((income - spent) * 100) / 100, scoped: true };
}

export function budgetForAccount(v, settings, accountFilter) {
  const live = (v.accounts || []).filter((a) => !a.archived);
  if (accountFilter && accountFilter !== 'all') {
    const a = live.find((x) => x.name === accountFilter);
    return a && a.type !== 'cash' ? Number(a.limit) || 0 : 0;
  }
  const own = Number(settings.budget) || 0;
  if (own > 0) return own;
  const cards = live.filter((a) => a.type !== 'cash');
  return cards.length && cards.every((a) => a.limit > 0)
    ? cards.reduce((n, a) => n + Number(a.limit), 0)
    : 0;
}

const CARD_PALETTE = ['#6366F1', '#3B82F6', '#8B5CF6', '#EC4899', '#0EA5E9'];
const CASH_PALETTE = ['#10B981', '#14B8A6', '#22C55E'];

export function mapAccountUi(a, idx, v, monthKey) {
  const isCash = a.type === 'cash';
  const color = isCash ? CASH_PALETTE[idx % CASH_PALETTE.length] : CARD_PALETTE[idx % CARD_PALETTE.length];
  const m = v.by[monthKey];
  let balance = 0;
  if (isCash) {
    const left = cashLeft(v, a);
    if (left !== null) balance = left;
    else if (m) {
      for (const e of m.entries) {
        if (e.account === a.name) balance += e.type === 'Income' ? e.amount : -e.amount;
      }
    }
  } else if (m) {
    for (const e of m.entries) {
      if (e.account === a.name) balance += e.type === 'Income' ? e.amount : -e.amount;
    }
  }
  return {
    ...a,
    id: a.name,
    short: a.name,
    color,
    kineticKey: isCash ? 'cash' : 'card',
    balance: Math.round(balance * 100) / 100,
  };
}

export function mapEntryToUi(e, pendingSet) {
  const loc = util.parseLoc(e.location);
  const isInc = e.type === 'Income';
  const title = e.description || (isInc ? 'Income' : e.sub || e.category);
  return {
    ...e,
    raw: e,
    type: isInc ? 'income' : 'expense',
    rawType: e.type,
    title,
    subCategory: e.sub,
    note: e.description,
    place: loc?.place || '',
    lat: loc?.lat,
    lon: loc?.lon,
    locationRaw: e.location || '',
    mapHref: util.mapUrl(e.location),
    pending: pendingSet ? pendingSet.has(e.id) : false,
  };
}

export function mapSubToUi(s, v) {
  const st = subStateOf(s);
  const brand = s.color ? { logo: s.logo, color: s.color } : brandOf(s.name);
  const color = s.color || brand.color || '#6366F1';
  const logo = s.logo || brand.logo || '';
  return {
    ...s,
    raw: s,
    daysLeft: st.until,
    nextDate: st.next,
    paidThisMonth: st.paid,
    skippedThisMonth: st.skipped,
    overdue: st.overdue,
    color,
    logo,
    rating: toUiRating(s.rating),
    subCategory: s.sub || s.category,
  };
}

// Runtime bootstrap (call once on app mount)
let runtimeStarted = false;
let storeHydrated = false;
const hydrationSubs = new Set();
export function initAppRuntime({ onSmsReview, onToast, onOpenUrlConnect } = {}) {
  if (runtimeStarted) return () => {};
  runtimeStarted = true;

  fitApp();
  const onResize = () => fitApp();
  const onOrient = () => setTimeout(fitApp, 250);
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onOrient);

  let rescueTimer = setTimeout(() => bootRescue(false), 9000);

  const AUTO_PULL_MS = 30 * 60 * 1000;
  const autoSync = () => {
    const st = store.getState();
    if (st.queue.length || Date.now() - (st.lastSync || 0) > AUTO_PULL_MS) store.sync();
  };

  // SMS inbox check
  const SMS_SEEN = 'el_sms_seen';
  let smsBusy = false;
  let smsLast = 0;
  const smsSeen = () => {
    try { return new Set(JSON.parse(localStorage.getItem(SMS_SEEN) || '[]')); } catch { return new Set(); }
  };
  const smsRemember = (ids) => {
    try {
      const all = [...smsSeen(), ...ids].slice(-300);
      localStorage.setItem(SMS_SEEN, JSON.stringify(all));
    } catch { /* ignore */ }
  };

  const checkSmsInbox = async (force = false) => {
    const st = store.getState();
    if (!st.cfg || st.cfg.demo || st.cfg.viewer || smsBusy || document.hidden || !(st.scriptVersion >= 7)) return;
    if (!force && Date.now() - smsLast < 20000) return;
    smsBusy = true;
    smsLast = Date.now();
    try {
      const seen = smsSeen();
      const list = (await store.smsList()).filter((m) => !seen.has(m.id));
      if (!list.length) return;
      const v = store.view();
      const ctx = {
        today: util.todayStr(),
        categories: v.categories,
        accounts: v.accounts,
        history: v.months.flatMap((k) => v.by[k].entries),
        fuelCutoff: st.settings.fuelCutoff,
      };
      const done = [];
      const logged = [];
      const review = [];
      const defAcc = (v.accounts[0] || {}).name || '';
      const toData = (r, msgLoc = '') => ({
        date: r.date,
        description: r.description || r.seller || '',
        seller: r.seller || '',
        amount: r.amount,
        type: r.type,
        category: r.type === 'Income' ? 'Income' : r.category,
        sub: r.type === 'Income' ? 'Income' : r.sub,
        account: r.account || defAcc,
        location: r.location || msgLoc || '',
      });
      for (const m of list) {
        const rows = parseMessages(m.text, ctx).filter((r) => r.source === 'sms');
        if (m.location) rows.forEach((r) => { r.location = m.location; });
        if (rows.length && rows.some((r) => !r.dup && (!r.ready || r.suggested))) {
          review.push(m);
          continue;
        }
        const fresh = rows.filter((r) => !r.dup);
        if (fresh.length) {
          logged.push(...fresh);
          ctx.history = ctx.history.concat(fresh.map((r) => toData(r, m.location)));
        }
        done.push(m.id);
      }
      if (!lk.isLocked()) {
        if (review.length) done.push(...review.map((m) => m.id));
        if (logged.length) {
          store.addMany(logged.map((r) => toData(r)));
          util.haptic(14);
          onToast?.(
            logged.length === 1
              ? `Logged ${logged[0].currency} ${Number(logged[0].amount).toFixed(2)} · ${logged[0].description}`
              : `${logged.length} bank SMS logged`,
            'success'
          );
        }
        smsRemember(done);
        store.smsDone(done).catch(() => {});
        if (review.length) {
          onSmsReview?.(review);
        }
      }
    } catch { /* ignore */ } finally {
      smsBusy = false;
    }
  };

  window.addEventListener('online', autoSync);
  const onVis = () => {
    lk.onVisibility();
    if (document.hidden) releaseMic();
    if (document.visibilityState === 'visible') {
      setTimeout(() => checkSmsInbox(true), 1500);
      const dropped = store.unstick();
      setTimeout(dropped ? () => store.sync() : autoSync, 700);
    }
  };
  document.addEventListener('visibilitychange', onVis);
  const iv = setInterval(() => {
    if (document.visibilityState === 'visible') autoSync();
  }, 60000);

  (async function boot() {
    try {
      let vaultOpened = false;
      let keyLost = false;
      if (vault.isEnabled() && vault.mode() === 'device') {
        try {
          await vault.openDevice();
        } catch (e) {
          if (e && e.message === 'STORAGE_TIMEOUT') throw e;
          keyLost = true;
          await store.disconnect();
        }
      } else if (vault.isEnabled()) {
        vaultOpened = await vault.takeStash();
        if (!vaultOpened) {
          booted = true;
          clearTimeout(rescueTimer);
          await promptUnlock({
            onForgot: async () => {
              try { localStorage.removeItem('el_lock'); } catch { /* ignore */ }
              await store.disconnect();
              location.reload();
            },
          });
          vaultOpened = true;
          booted = false;
          rescueTimer = setTimeout(() => bootRescue(false), 9000);
        }
      }

      await store.init();
      booted = true;
      clearTimeout(rescueTimer);

      const st = store.getState();
      // First-run defaults matching Prototype v9 (Dark Obsidian)
      const patch = {};
      if (!st.settings.style) patch.style = 'obsidian';
      if (!localStorage.getItem('el_theme_set') && (!st.settings.theme || st.settings.theme === 'system')) {
        patch.theme = 'dark';
        try { localStorage.setItem('el_theme_set', '1'); } catch { /* ignore */ }
      }
      if (Object.keys(patch).length) {
        await store.saveSettings(patch);
      }
      storeHydrated = true;
      hydrationSubs.forEach((fn) => fn());

      if (keyLost) {
        setTimeout(() => onToast?.('Encrypted copy could not be opened, so it was cleared. Reconnect to reload from your sheet.', 'error'), 800);
      }

      const lockCfg = () => store.getState().settings.lock || { method: 'off', delay: 60 };
      lk.initLock({
        skipInitial: vaultOpened,
        vaultOn: () => vault.isEnabled() && vault.mode() === 'passphrase',
        relock: () => location.reload(),
        getLock: lockCfg,
        setLock: (p) => store.saveSettings({ lock: { ...lockCfg(), ...p } }),
        haptic: util.haptic,
        onReset: async () => {
          try { localStorage.removeItem('el_lock'); } catch { /* ignore */ }
          await store.disconnect();
          location.reload();
        },
      });

      if (/[?&]r=\d+/.test(location.search)) {
        history.replaceState(null, '', location.pathname + location.hash);
      }

      if (location.hash.length > 1) {
        const p = new URLSearchParams(location.hash.slice(1));
        const url = p.get('u');
        const key = p.get('k');
        const vUrl = p.get('v');
        const tok = p.get('t');
        history.replaceState(null, '', location.pathname + location.search);

        const cur = store.getState().cfg;
        if (
          vUrl &&
          tok &&
          !(cur && cur.viewer && cur.token === tok) &&
          (!cur || cur.viewer || confirm('Open this view-only link?\n\nYour own sheet stays saved (nothing uploads while viewing) and comes back when you leave view-only mode in Settings.'))
        ) {
          try {
            const vc = vUrl === 'demo' ? { demo: true, token: tok } : { url: vUrl, token: tok };
            await store.connectViewer(vc);
            try { localStorage.setItem(VLINK_KEY, viewLinkUrl(vc, tok)); } catch { /* ignore */ }
            onToast?.('Opened view-only', 'success');
          } catch (e) {
            onToast?.(e.message || 'Could not open the link', 'error');
          }
        }
        if (url && key && !store.getState().cfg) {
          onOpenUrlConnect?.({ url, key });
          try {
            await store.connect({ url, key });
            onToast?.('Connected to Google Sheet', 'success');
          } catch (e) {
            onToast?.(e.message || 'Could not connect', 'error');
          }
        }
      }

      if (!store.getState().cfg) {
        let kept = '';
        try { kept = localStorage.getItem(VLINK_KEY) || ''; } catch { /* ignore */ }
        if (kept && parseViewLink(kept)) {
          const cfg = parseViewLink(kept);
          try {
            await store.connectViewer(cfg);
            onToast?.('Opened view-only', 'success');
          } catch { /* user can reconnect manually */ }
        }
      }

      store.sync();
      if ('serviceWorker' in navigator) {
        const had = !!navigator.serviceWorker.controller;
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (had && !reloaded) {
            reloaded = true;
            vault.stashForReload();
            location.reload();
          }
        });
        navigator.serviceWorker.register('sw.js').catch(() => {});
      }
    } catch (e) {
      console.error(e);
      bootRescue(true);
    }
  })();

  return () => {
    clearTimeout(rescueTimer);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onOrient);
    window.removeEventListener('online', autoSync);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(iv);
  };
}

export function useExpenseStore() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const unsub = store.onChange(bump);
    hydrationSubs.add(bump);
    return () => {
      unsub();
      hydrationSubs.delete(bump);
    };
  }, []);

  return useMemo(() => {
    const st = store.getState();
    const v = store.view();
    return {
      tick,
      state: st,
      view: v,
      settings: st.settings || {},
      isConnected: Boolean(st.cfg),
      isDemo: Boolean(st.cfg && st.cfg.demo),
      isViewer: store.isViewer(),
      isHydrated: storeHydrated,
      currency: (st.settings && st.settings.currency) || 'EGP',
    };
  }, [tick]);
}
