import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Toaster, toast } from 'sonner';
import {
  budgetForAccount,
  FUEL_BIG_FILL,
  hexMixColor,
  initAppRuntime,
  mapAccountUi,
  mapEntryToUi,
  mapSubToUi,
  scopedMonth,
  store,
  toStoreRating,
  useExpenseStore,
  util,
  VLINK_KEY,
} from './lib/bridge';
import OnboardingView from './components/OnboardingView';
import TopBar from './components/TopBar';
import BottomNav from './components/BottomNav';
import HomeView from './components/HomeView';
import ActivityView from './components/ActivityView';
import InsightsView from './components/InsightsView';
import SettingsView from './components/SettingsView';
import EntrySheet from './components/EntrySheet';
import HeroFlipModal from './components/HeroFlipModal';

const TAB_ORDER = { home: 0, activity: 1, insights: 2, settings: 3 };

const SCREEN_VARIANTS = {
  enter: ({ dir, reduced }) => (reduced ? { opacity: 0 } : { opacity: 0, x: dir * 16 }),
  center: {
    opacity: 1,
    x: 0,
    pointerEvents: 'auto',
    transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  },
  exit: ({ dir, reduced }) => ({
    opacity: 0,
    x: reduced ? 0 : -dir * 14,
    pointerEvents: 'none',
    transition: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  }),
};

function resolveTheme(mode, sysTheme) {
  if (mode === 'light' || mode === 'dark') return mode;
  return sysTheme;
}

function getSystemTheme() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function getCachedPrefs() {
  try {
    const st = localStorage.getItem('el_style');
    const style = st === 'kinetic' || st === 'editorial' ? st : 'obsidian';
    const tSet = localStorage.getItem('el_theme_set') === '1';
    const rawT = tSet ? localStorage.getItem('el_theme') : 'dark';
    const theme = rawT === 'light' || rawT === 'dark' || rawT === 'system' ? rawT : 'dark';
    const glass = localStorage.getItem('el_glass') !== '0';
    return { style, theme, glass };
  } catch {
    return { style: 'obsidian', theme: 'dark', glass: true };
  }
}

export default function App() {
  const { state, view, settings, isConnected, isDemo, isViewer, isHydrated, currency } = useExpenseStore();

  const [systemTheme, setSystemTheme] = useState(getSystemTheme);
  const [activeTab, setActiveTab] = useState('home');
  const [settingsPage, setSettingsPage] = useState('home');
  const [account, setAccount] = useState(() => {
    try { return localStorage.getItem('el_acc') || 'all'; } catch { return 'all'; }
  });
  const [month, setMonth] = useState('');
  const [passDeckOpen, setPassDeckOpen] = useState(false);
  const [hasSwipedHint, setHasSwipedHint] = useState(false);

  // Activity cross-filters
  const [actSearch, setActSearch] = useState('');
  const [actCatFilter, setActCatFilter] = useState('All');
  const [actPlaceFilter, setActPlaceFilter] = useState('');

  // Sheets & Modals
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingTx, setEditingTx] = useState(null);
  const [initialQuickText, setInitialQuickText] = useState('');
  const [breakdownState, setBreakdownState] = useState({
    open: false,
    mode: 'spent',
    originRect: null,
  });
  const [hiddenFlipTile, setHiddenFlipTile] = useState(null);
  const [urlPrefill, setUrlPrefill] = useState({ url: '', key: '' });

  const scrollRef = useRef(null);
  const prefersReducedMotion = useReducedMotion();
  const prevTabRef = useRef(activeTab);
  const tabDirRef = useRef(1);
  if (prevTabRef.current !== activeTab) {
    const fromIdx = TAB_ORDER[prevTabRef.current] ?? 0;
    const toIdx = TAB_ORDER[activeTab] ?? 0;
    tabDirRef.current = toIdx >= fromIdx ? 1 : -1;
    prevTabRef.current = activeTab;
  }
  const screenCustom = { dir: tabDirRef.current, reduced: Boolean(prefersReducedMotion) };

  const cachedPrefs = useMemo(getCachedPrefs, []);
  const rawStyle = isHydrated ? settings.style : cachedPrefs.style;
  const concept = rawStyle === 'kinetic' || rawStyle === 'editorial' ? rawStyle : 'obsidian';
  const rawTheme = isHydrated ? settings.theme : cachedPrefs.theme;
  const themeMode = rawTheme === 'light' || rawTheme === 'dark' || rawTheme === 'system' ? rawTheme : 'dark';
  const resolvedTheme = resolveTheme(themeMode, systemTheme);
  const glassBars = isHydrated ? settings.glass !== false : cachedPrefs.glass;
  const navStyle = settings.navStyle === 'orb' ? 'orb' : 'center';
  // Prototype calls Pass Deck 'arc', js/app.js stored 'pass'
  const subsStyle = settings.subsStyle === 'pass' || settings.subsStyle === 'arc' ? 'arc' : 'flip';
  const privacyBlur = Boolean(settings.hideBalance);
  const fuelCutoff = Number(settings.fuelCutoff) || FUEL_BIG_FILL;
  const monthlyBudget = Number(settings.budget) || 0;
  const locCapture = settings.locCapture !== false;
  const voiceLang = settings.voiceLang || 'ar-EG';

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const sync = () => setSystemTheme(mq.matches ? 'dark' : 'light');
    sync();
    mq.addEventListener?.('change', sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('pageshow', sync);
    return () => {
      mq.removeEventListener?.('change', sync);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('pageshow', sync);
    };
  }, []);

  useEffect(() => {
    const cleanup = initAppRuntime({
      onToast: (msg, kind) => {
        if (kind === 'error') toast.error(msg);
        else if (kind === 'success') toast.success(msg);
        else toast(msg);
      },
      onSmsReview: (msgs) => {
        setEditingTx(null);
        setInitialQuickText(msgs.map((m) => m.text).join('\n\n'));
        setSheetOpen(true);
      },
      onOpenUrlConnect: ({ url, key }) => setUrlPrefill({ url, key }),
    });
    return cleanup;
  }, []);

  // Derived real accounts
  const liveAccounts = useMemo(
    () => (view.accounts || []).filter((a) => !a.archived),
    [view.accounts]
  );

  // Sync active month with available store months
  const monthsList = useMemo(() => {
    const raw = (view.months || []).slice();
    const cur = util.currentKey();
    if (!raw.includes(cur)) raw.push(cur);
    return raw
      .sort()
      .reverse()
      .map((key) => {
        const m = view.by?.[key] || { entries: [], spent: 0, income: 0, start: 0, available: 0 };
        return {
          key,
          label: util.keyLabel(key),
          short: util.keyShort(key),
          count: m.entries.length,
          spent: m.spent,
          income: m.income,
          start: m.start,
          available: m.available,
        };
      });
  }, [view]);

  const activeMonthKey = useMemo(() => {
    if (month && monthsList.some((m) => m.key === month)) return month;
    const now = util.currentKey();
    if (monthsList.some((m) => m.key === now)) return now;
    return monthsList[0]?.key || now;
  }, [month, monthsList]);

  useEffect(() => {
    if (account !== 'all' && !liveAccounts.some((a) => a.name === account)) {
      setAccount('all');
    }
  }, [account, liveAccounts]);

  const mappedAccounts = useMemo(
    () => liveAccounts.map((a, idx) => mapAccountUi(a, idx, view, activeMonthKey)),
    [liveAccounts, view, activeMonthKey]
  );

  const activeAccKind = useMemo(() => {
    if (account === 'all') return 'all';
    const acc = mappedAccounts.find((a) => a.name === account);
    return acc?.type === 'cash' ? 'cash' : 'card';
  }, [account, mappedAccounts]);

  // Sync <html data-concept data-theme data-acc data-glass> and <meta name="theme-color">
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute('data-concept', concept);
    html.setAttribute('data-style', concept);
    html.setAttribute('data-theme', resolvedTheme);
    html.style.colorScheme = resolvedTheme;
    html.setAttribute('data-acc', activeAccKind);
    html.setAttribute('data-glass', glassBars ? 'on' : 'off');

    if (isHydrated) {
      try {
        localStorage.setItem('el_style', concept);
        localStorage.setItem('el_theme', themeMode);
        localStorage.setItem('el_theme_set', '1');
        localStorage.setItem('el_glass', glassBars ? '1' : '0');
      } catch { /* ignore */ }
    }

    const syncStatusBar = () => {
      const dimmed = sheetOpen || breakdownState.open ? 1 : 0;
      const hex = hexMixColor(concept, resolvedTheme, dimmed);
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', hex);
      document.documentElement.style.backgroundColor = hex;
      document.body.style.backgroundColor = hex;
    };
    syncStatusBar();
    const onVis = () => {
      if (document.visibilityState === 'visible') syncStatusBar();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', syncStatusBar);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', syncStatusBar);
    };
  }, [concept, themeMode, resolvedTheme, activeAccKind, glassBars, sheetOpen, breakdownState.open, isHydrated]);

  // All normalized UI entries & active-month scoped data
  const allEntriesUi = useMemo(() => {
    const out = [];
    for (const mk of view.months || []) {
      for (const e of (view.by?.[mk]?.entries || [])) {
        out.push(mapEntryToUi(e, view.pending));
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }, [view]);

  const scoped = useMemo(
    () => scopedMonth(view, activeMonthKey, account),
    [view, activeMonthKey, account]
  );

  const scopedEntriesUi = useMemo(
    () => (scoped.entries || []).map((e) => mapEntryToUi(e, view.pending)),
    [scoped, view.pending]
  );

  const mappedSubs = useMemo(
    () => (view.subs || []).map((s) => mapSubToUi(s, view)),
    [view]
  );

  const effectiveBudget = useMemo(
    () => budgetForAccount(view, settings, account),
    [view, settings, account]
  );

  // Reset scroll to top on settings subpage switch (tabs preserve outgoing scroll during exit glide)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
  }, [settingsPage]);

  useEffect(() => {
    if (activeTab !== 'settings' || settingsPage !== 'subscriptions' || subsStyle !== 'arc') {
      setPassDeckOpen(false);
    }
  }, [activeTab, settingsPage, subsStyle]);

  const handleSelectTab = (tab) => {
    if (tab === 'settings' && activeTab === 'settings') {
      setSettingsPage('home');
    } else {
      setActiveTab(tab);
      if (tab !== 'settings') setSettingsPage('home');
    }
  };

  const navigateToActivity = ({ category, place, search } = {}) => {
    setActCatFilter(category || 'All');
    setActPlaceFilter(place || '');
    setActSearch(search || '');
    setActiveTab('activity');
  };

  // Real Mutations via store
  const handleSaveTx = (payload) => {
    const data = {
      date: payload.date,
      description: payload.description,
      amount: payload.amount,
      type: payload.type,
      category: payload.category,
      sub: payload.sub,
      account: payload.account,
      seller: payload.seller,
      location: payload.location,
    };
    if (payload.id) {
      store.updateEntry(payload.id, data);
      toast.success(`Updated "${payload.description || payload.sub}"`);
    } else {
      const newId = store.addEntry(data);
      if (payload.shouldAutoLocate) {
        util.currentLoc(6000).then((fix) => {
          if (!fix) return;
          const loc = util.fmtLoc(fix);
          const v = store.view();
          for (const k of v.months) {
            const hit = v.by[k].entries.find((x) => x.id === newId);
            if (hit && !hit.location) {
              store.updateEntry(newId, { ...hit, location: loc });
              break;
            }
          }
        });
      }
      toast.success(`Added ${payload.description || payload.sub} (${payload.amount} ${currency})`);
    }
    setMonth(util.monthKeyOf(payload.date));
  };

  const handleAddMultipleTx = (items) => {
    store.addMany(items);
    if (items.length) setMonth(util.monthKeyOf(items[items.length - 1].date));
    toast.success(`Added ${items.length} ${items.length === 1 ? 'entry' : 'entries'}`);
  };

  const handleCopyTx = (tx) => {
    const raw = tx.raw || tx;
    store.addEntry({
      date: util.todayStr(),
      description: raw.description || tx.title,
      amount: raw.amount,
      type: raw.type || (tx.type === 'income' ? 'Income' : 'Expense'),
      category: raw.category,
      sub: raw.sub || tx.subCategory,
      account: raw.account,
      seller: raw.seller,
      location: raw.location,
    });
    toast.success(`Copied "${tx.title}" to today`);
  };

  const handleDeleteTx = (tx) => {
    const trashId = store.deleteEntry(tx.id);
    util.haptic(16);
    toast(`Deleted "${tx.title}"`, {
      action: trashId
        ? {
            label: 'Undo',
            onClick: () => {
              store.restoreTrash(trashId);
              util.haptic(10);
              toast.success(`Restored "${tx.title}"`);
            },
          }
        : undefined,
    });
  };

  const handleBulkDelete = (ids) => {
    const trashIds = ids.map((id) => store.deleteEntry(id)).filter(Boolean);
    if (!trashIds.length) return;
    util.haptic(18);
    toast(`Deleted ${trashIds.length} entries`, {
      action: {
        label: 'Undo',
        onClick: () => {
          trashIds.forEach((tid) => store.restoreTrash(tid));
          util.haptic(10);
          toast.success(`Restored ${trashIds.length} entries`);
        },
      },
    });
  };

  const handleBulkMoveAccount = (ids, nextAccount) => {
    for (const id of ids) {
      const hit = allEntriesUi.find((e) => e.id === id);
      if (!hit) continue;
      const r = hit.raw || hit;
      store.updateEntry(id, {
        date: r.date,
        description: r.description,
        amount: r.amount,
        type: r.type,
        category: r.category,
        sub: r.sub,
        account: nextAccount,
        seller: r.seller,
        location: r.location,
      });
    }
    toast.success(`Moved ${ids.length} entries to ${nextAccount}`);
  };

  const handleBulkChangeCategory = (ids, nextCat, nextSub) => {
    let count = 0;
    for (const id of ids) {
      const hit = allEntriesUi.find((e) => e.id === id);
      if (!hit || hit.type !== 'expense') continue;
      const r = hit.raw || hit;
      store.updateEntry(id, {
        date: r.date,
        description: r.description,
        amount: r.amount,
        type: 'Expense',
        category: nextCat,
        sub: nextSub,
        account: r.account,
        seller: r.seller,
        location: r.location,
      });
      count++;
    }
    toast.success(`Updated category for ${count} expenses`);
  };

  // Real Subscription Actions
  const handleRateSub = (subId, ratingId) => {
    const sub = view.subs.find((s) => s.id === subId);
    if (!sub) return;
    const emoji = toStoreRating(ratingId);
    store.saveSubscription({ ...sub, rating: sub.rating === emoji ? '' : emoji });
  };

  const handleLogSubPaid = (sub) => {
    store.addEntry({
      date: util.todayStr(),
      description: sub.name,
      amount: sub.amount,
      type: 'Expense',
      category: sub.category || 'Subscriptions',
      sub: sub.sub || sub.category || 'Other Services',
      account: sub.account || mappedAccounts[0]?.name || '',
      seller: sub.name,
    });
    toast.success(`Logged ${sub.name} (${sub.amount} ${currency})`);
  };

  const handleSkipSubMonth = (sub) => {
    const rawSub = view.subs.find((s) => s.id === sub.id);
    if (!rawSub) return;
    const key = util.monthKeyOf(util.todayStr());
    const nextSkipped = rawSub.skipped === key ? '' : key;
    store.saveSubscription({ ...rawSub, skipped: nextSkipped });
    toast(nextSkipped ? `Skipped ${sub.name} this month` : `Restored ${sub.name} this month`);
  };

  const handleSaveSub = (payload) => {
    store.saveSubscription(payload);
    toast.success(payload.id ? `Updated ${payload.name}` : `Added ${payload.name}`);
  };

  const handleDeleteSub = (id) => {
    store.deleteSubscription(id);
    toast('Subscription deleted');
  };

  const handleDisconnect = async () => {
    if (isViewer) {
      await store.leaveViewer();
      try { localStorage.removeItem(VLINK_KEY); } catch { /* ignore */ }
      setActiveTab('home');
      setSettingsPage('home');
      store.sync();
    } else {
      try { localStorage.removeItem('el_lock'); } catch { /* ignore */ }
      await store.disconnect();
      setActiveTab('home');
      setSettingsPage('home');
    }
  };

  const monthObj = monthsList.find((m) => m.key === activeMonthKey) || { label: activeMonthKey };

  return (
    <div id="desktop-backdrop">
      <div id="phone-shell">
        {/* Editorial Grain Overlay */}
        <svg
          className="pointer-events-none absolute inset-0 w-full h-full z-40 editorial-grain"
          aria-hidden="true"
        >
          <filter id="editorialNoise">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.82"
              numOctaves="3"
              stitchTiles="stitch"
            />
          </filter>
          <rect width="100%" height="100%" filter="url(#editorialNoise)" />
        </svg>

        {/* Sonner Toasts */}
        <Toaster
          position="top-center"
          theme={resolvedTheme}
          toastOptions={{
            style: {
              borderRadius: '16px',
              fontSize: '12px',
            },
          }}
        />

        <AnimatePresence mode="wait" initial={false}>
          {!isConnected ? (
            <motion.div
              key="onboarding"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.985 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 min-h-0 flex flex-col"
            >
              <OnboardingView
                initialUrl={urlPrefill.url}
                initialKey={urlPrefill.key}
              />
            </motion.div>
          ) : (
            <motion.div
              key="stage"
              id="phone-stage"
              initial={{ opacity: 0 }}
              animate={
                sheetOpen
                  ? { scale: 0.955, borderRadius: '26px', opacity: 0.88 }
                  : { scale: 1, borderRadius: '0px', opacity: 1, transitionEnd: { transform: 'none' } }
              }
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              className="relative flex-1 min-h-0 flex flex-col overflow-hidden origin-top"
            >
              <TopBar
                activeTab={activeTab}
                settingsPage={settingsPage}
                onBackSettings={() => setSettingsPage('home')}
                month={activeMonthKey}
                setMonth={setMonth}
                months={monthsList}
                syncStatus={state.status}
                pendingCount={state.queue?.length || 0}
                onSync={() => store.sync()}
                isViewer={isViewer}
                currency={currency}
                privacyBlur={privacyBlur}
              />

              <div className="relative flex-1 min-h-0 overflow-hidden">
                <AnimatePresence initial={false} custom={screenCustom}>
                  <motion.div
                    key={activeTab}
                    ref={scrollRef}
                    custom={screenCustom}
                    variants={SCREEN_VARIANTS}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    data-screen-tab={activeTab}
                    className="absolute inset-0 overflow-y-auto overscroll-y-contain no-scrollbar"
                  >
              {activeTab === 'home' && (
                <HomeView
                  concept={concept}
                  account={account}
                  setAccount={(next) => {
                    setAccount(next);
                    try { localStorage.setItem('el_acc', next); } catch { /* ignore */ }
                  }}
                  month={activeMonthKey}
                  months={monthsList}
                  accounts={mappedAccounts}
                  allEntries={allEntriesUi}
                  monthEntries={scopedEntriesUi}
                  monthStart={scoped.start || 0}
                  monthAvailable={scoped.available || 0}
                  monthIncome={scoped.income || 0}
                  monthSpent={scoped.spent || 0}
                  effectiveBudget={effectiveBudget}
                  subscriptions={mappedSubs}
                  catOrder={view.categories?.order || []}
                  currency={currency}
                  privacyBlur={privacyBlur}
                  onTogglePrivacy={() => store.saveSettings({ hideBalance: !privacyBlur })}
                  activeFlipMode={hiddenFlipTile}
                  onOpenBreakdown={(m, originRect) => {
                    setHiddenFlipTile(m);
                    setBreakdownState({ open: true, mode: m, originRect });
                  }}
                  onEditTx={(tx) => {
                    setInitialQuickText('');
                    setEditingTx(tx);
                    setSheetOpen(true);
                  }}
                  onCopyTx={handleCopyTx}
                  onDeleteTx={handleDeleteTx}
                  onNavigateActivity={navigateToActivity}
                  onNavigateSubscriptions={() => {
                    setActiveTab('settings');
                    setSettingsPage('subscriptions');
                  }}
                  onNavigateBudget={() => {
                    setActiveTab('settings');
                    setSettingsPage('budget');
                  }}
                  hasSwipedHint={hasSwipedHint}
                  onFirstSwipe={() => setHasSwipedHint(true)}
                  isViewer={isViewer}
                  viewerInfo={state.snap?.viewer || null}
                />
              )}

              {activeTab === 'activity' && (
                <ActivityView
                  month={activeMonthKey}
                  account={account}
                  accounts={mappedAccounts}
                  categories={view.categories || { order: [], map: {} }}
                  entries={allEntriesUi}
                  currency={currency}
                  searchQuery={actSearch}
                  setSearchQuery={setActSearch}
                  catFilter={actCatFilter}
                  setCatFilter={setActCatFilter}
                  placeFilter={actPlaceFilter}
                  setPlaceFilter={setActPlaceFilter}
                  privacyBlur={privacyBlur}
                  onEditTx={(tx) => {
                    setInitialQuickText('');
                    setEditingTx(tx);
                    setSheetOpen(true);
                  }}
                  onCopyTx={handleCopyTx}
                  onDeleteTx={handleDeleteTx}
                  onBulkDelete={handleBulkDelete}
                  onBulkMoveAccount={handleBulkMoveAccount}
                  onBulkChangeCategory={handleBulkChangeCategory}
                  hasSwipedHint={hasSwipedHint}
                  onFirstSwipe={() => setHasSwipedHint(true)}
                  isViewer={isViewer}
                />
              )}

              {activeTab === 'insights' && (
                <InsightsView
                  viewData={view}
                  month={activeMonthKey}
                  months={monthsList}
                  account={account}
                  allEntries={allEntriesUi}
                  monthEntries={scopedEntriesUi}
                  catOrder={view.categories?.order || []}
                  monthlyBudget={effectiveBudget}
                  currency={currency}
                  privacyBlur={privacyBlur}
                  onNavigateActivity={navigateToActivity}
                />
              )}

              {activeTab === 'settings' && (
                <SettingsView
                  concept={concept}
                  setConcept={(s) => store.saveSettings({ style: s })}
                  themeMode={themeMode}
                  setThemeMode={(m) => store.saveSettings({ theme: m })}
                  glassBars={glassBars}
                  setGlassBars={(g) => store.saveSettings({ glass: g })}
                  navStyle={navStyle}
                  setNavStyle={(n) => store.saveSettings({ navStyle: n })}
                  subsStyle={subsStyle}
                  setSubsStyle={(ss) => store.saveSettings({ subsStyle: ss === 'arc' ? 'pass' : 'flip' })}
                  onPassDeckOpenChange={setPassDeckOpen}
                  settingsPage={settingsPage}
                  setSettingsPage={setSettingsPage}
                  state={state}
                  viewData={view}
                  accounts={mappedAccounts}
                  allAccounts={view.accounts || []}
                  allEntries={allEntriesUi}
                  subscriptions={mappedSubs}
                  categories={view.categories || { order: [], map: {} }}
                  currency={currency}
                  setCurrency={(c) => store.saveSettings({ currency: c.trim() })}
                  monthlyBudget={monthlyBudget}
                  setMonthlyBudget={(b) => store.saveSettings({ budget: b })}
                  fuelCutoff={fuelCutoff}
                  setFuelCutoff={(f) => store.saveSettings({ fuelCutoff: f })}
                  locCapture={locCapture}
                  setLocCapture={(v) => store.saveSettings({ locCapture: v })}
                  privacyBlur={privacyBlur}
                  onTogglePrivacy={() => store.saveSettings({ hideBalance: !privacyBlur })}
                  isDemo={isDemo}
                  isViewer={isViewer}
                  onSyncNow={() => store.sync()}
                  onRateSubscription={handleRateSub}
                  onLogSubPaid={handleLogSubPaid}
                  onSkipSubMonth={handleSkipSubMonth}
                  onSaveSubscription={handleSaveSub}
                  onDeleteSubscription={handleDeleteSub}
                  onRestoreTrash={(tid) => {
                    store.restoreTrash(tid);
                    toast.success('Restored entry');
                  }}
                  onEmptyTrash={() => {
                    store.clearTrash();
                    toast('Trash emptied');
                  }}
                  onDisconnect={handleDisconnect}
                />
              )}
                  </motion.div>
                </AnimatePresence>
              </div>

              <BottomNav
                activeTab={activeTab}
                onSelectTab={handleSelectTab}
                onOpenAdd={() => {
                  setInitialQuickText('');
                  setEditingTx(null);
                  setSheetOpen(true);
                }}
                navStyle={navStyle}
                concept={concept}
                hidden={passDeckOpen}
                isViewer={isViewer}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Entry Sheet (Keypad / Details / Calendar / Quick Add) */}
        {!isViewer && (
          <EntrySheet
            open={sheetOpen}
            onClose={() => {
              setSheetOpen(false);
              setEditingTx(null);
              setInitialQuickText('');
            }}
            editingTx={editingTx}
            initialQuickText={initialQuickText}
            activeAccount={account}
            accounts={mappedAccounts}
            categories={view.categories || { order: [], map: {} }}
            allEntries={allEntriesUi}
            fuelCutoff={fuelCutoff}
            currency={currency}
            locCapture={locCapture}
            voiceLang={voiceLang}
            onSaveTx={handleSaveTx}
            onAddMultipleTx={handleAddMultipleTx}
            onDuplicateTx={handleCopyTx}
            onDeleteTx={handleDeleteTx}
          />
        )}

        {/* Hero 3D Flip Modal */}
        <HeroFlipModal
          open={breakdownState.open}
          initialMode={breakdownState.mode}
          originRect={breakdownState.originRect}
          onClose={() => setBreakdownState((s) => ({ ...s, open: false }))}
          onSideChange={(nextSide) => setHiddenFlipTile(nextSide)}
          onRevealTile={() => setHiddenFlipTile(null)}
          onClosed={() => setHiddenFlipTile(null)}
          monthLabel={monthObj.label || activeMonthKey}
          accountLabel={account === 'all' ? 'All accounts' : account}
          entries={scopedEntriesUi}
          catOrder={view.categories?.order || []}
          currency={currency}
          privacyBlur={privacyBlur}
        />
      </div>
    </div>
  );
}
