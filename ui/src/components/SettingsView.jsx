import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import NumberFlow from '@number-flow/react';
import {
  CreditCard,
  Sliders,
  Palette,
  ShieldCheck,
  Share2,
  Trash2,
  ChevronRight,
  Plus,
  Check,
  RotateCcw,
  Lock,
  Copy,
  RefreshCw,
  Download,
  Upload,
  FileSpreadsheet,
  Smartphone,
  CloudUpload,
  Info,
  ExternalLink,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatAmt, formatEGP } from '../lib/helpers';
import {
  APP_VERSION,
  brandOf,
  buildWorkbook,
  cashLeft,
  cashStartFor,
  decodeText,
  FUEL_BIG_FILL,
  getFitInfo,
  hardReload,
  lk,
  parseWorkbook,
  readCsvEntries,
  SCRIPT_LATEST,
  store,
  util,
  vault,
  viewLinkUrl,
} from '../lib/bridge';
import SlidingHighlight from './SlidingHighlight';
import WalletStack3D from './WalletStack3D';
import ArcWalletStack from './ArcWalletStack';

export default function SettingsView({
  concept,
  setConcept,
  themeMode,
  setThemeMode,
  glassBars,
  setGlassBars,
  navStyle,
  setNavStyle,
  subsStyle,
  setSubsStyle,
  onPassDeckOpenChange,
  settingsPage,
  setSettingsPage,
  state,
  viewData,
  accounts = [],
  allAccounts = [],
  allEntries = [],
  subscriptions = [],
  categories = { order: [], map: {} },
  currency = 'EGP',
  setCurrency,
  monthlyBudget = 0,
  setMonthlyBudget,
  fuelCutoff = FUEL_BIG_FILL,
  setFuelCutoff,
  locCapture = true,
  setLocCapture,
  privacyBlur = false,
  onTogglePrivacy,
  isDemo = false,
  isViewer = false,
  onSyncNow,
  onRateSubscription,
  onLogSubPaid,
  onSkipSubMonth,
  onSaveSubscription,
  onDeleteSubscription,
  onRestoreTrash,
  onEmptyTrash,
  onDisconnect,
}) {
  const [focusedSubId, setFocusedSubId] = useState(null);
  const [showSubForm, setShowSubForm] = useState(false);
  const [editingSubId, setEditingSubId] = useState(null);
  const [subName, setSubName] = useState('');
  const [subAmount, setSubAmount] = useState('');
  const [subDay, setSubDay] = useState('1');
  const [subAcc, setSubAcc] = useState(accounts[0]?.name || '');
  const [subCat, setSubCat] = useState(categories.order.includes('Subscriptions') ? 'Subscriptions' : categories.order[0] || '');

  // Accounts & budget states
  const [newAccType, setNewAccType] = useState('card');
  const [newAccName, setNewAccName] = useState('');
  const [newAccLimit, setNewAccLimit] = useState('');
  const [deleteAccState, setDeleteAccState] = useState(null); // { name, mode, to, keep: Set }

  // Share viewer states
  const [shareName, setShareName] = useState('');
  const [shareNote, setShareNote] = useState('');
  const [shareCreated, setShareCreated] = useState(null);
  const [viewersList, setViewersList] = useState(null);
  const [shareBusy, setShareBusy] = useState(false);

  // Import/Export & Lock & Vault states
  const fileInputRef = useRef(null);
  const [importKind, setImportKind] = useState('xlsx');
  const [importPreview, setImportPreview] = useState(null);
  const [pinModal, setPinModal] = useState(null); // null | { mode: 'ask'|'set'|'change', resolve }
  const [pinValue, setPinValue] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [vaultModal, setVaultModal] = useState(null); // null | 'on'|'change'|'off'
  const [vaultCurPass, setVaultCurPass] = useState('');
  const [vaultNewPass, setVaultNewPass] = useState('');
  const [vaultConfirmPass, setVaultConfirmPass] = useState('');
  const [updatingScript, setUpdatingScript] = useState(false);
  const [armedDisconnect, setArmedDisconnect] = useState(false);
  const [demoOffline, setDemoOffline] = useState(() => {
    try { return localStorage.getItem('el_demo_offline') === '1'; } catch { return false; }
  });

  useEffect(() => {
    setFocusedSubId(null);
  }, [subsStyle]);

  useEffect(() => {
    onPassDeckOpenChange?.(subsStyle === 'arc' && Boolean(focusedSubId));
  }, [subsStyle, focusedSubId, onPassDeckOpenChange]);

  useEffect(() => {
    if (settingsPage === 'share' && !isViewer && !viewersList && !shareBusy) {
      setShareBusy(true);
      store
        .shareList()
        .then((l) => setViewersList(l))
        .catch(() => setViewersList([]))
        .finally(() => setShareBusy(false));
    }
  }, [settingsPage, isViewer, viewersList, shareBusy]);

  const upcoming14 = useMemo(
    () =>
      subscriptions
        .filter((s) => !s.paused && !s.paidThisMonth && !s.skippedThisMonth && s.daysLeft <= 14)
        .sort((a, b) => a.daysLeft - b.daysLeft),
    [subscriptions]
  );

  const sleepyAnnualSavings = useMemo(
    () =>
      subscriptions
        .filter((s) => !s.paused && s.rating === 'sleep')
        .reduce((sum, s) => sum + s.amount * 12, 0),
    [subscriptions]
  );

  // Spotted recurring purchases not yet in subscriptions (matching subs.js)
  const spottedSubs = useMemo(() => {
    const have = new Set(subscriptions.map((s) => s.name.trim().toLowerCase()));
    const recentMonths = (viewData.months || []).slice(-3);
    const seen = new Map();
    for (const mk of recentMonths) {
      for (const e of (viewData.by?.[mk]?.entries || [])) {
        if (e.type !== 'Expense' || !e.description?.trim()) continue;
        const n = e.description.trim().toLowerCase();
        if (have.has(n)) continue;
        const g = seen.get(n) || { name: e.description.trim(), months: new Set(), amounts: [], last: e, cat: e.category === 'Subscriptions' };
        g.months.add(mk);
        g.amounts.push(e.amount);
        if (e.date > g.last.date) g.last = e;
        seen.set(n, g);
      }
    }
    return [...seen.values()]
      .filter((g) => {
        const lo = Math.min(...g.amounts);
        const hi = Math.max(...g.amounts);
        return (g.months.size >= 2 && hi <= lo * 1.15) || (g.cat && g.months.size >= 1);
      })
      .slice(0, 4);
  }, [subscriptions, viewData]);

  const openNewSubForm = (preset = null) => {
    setEditingSubId(preset?.id || null);
    setSubName(preset?.name || '');
    setSubAmount(preset?.amount ? String(preset.amount) : '');
    setSubDay(preset?.day ? String(preset.day) : String(Math.min(28, Number(util.todayStr().slice(8, 10)) || 1)));
    setSubAcc(preset?.account || accounts[0]?.name || '');
    setSubCat(preset?.category || (categories.order.includes('Subscriptions') ? 'Subscriptions' : categories.order[0] || ''));
    setShowSubForm(true);
  };

  const handleSaveSubForm = (e) => {
    e.preventDefault();
    const amt = Math.round(parseFloat(subAmount) * 100) / 100;
    const day = Math.max(1, Math.min(31, parseInt(subDay, 10) || 1));
    if (!subName.trim() || !(amt > 0)) {
      toast.error('Enter a subscription name and valid amount');
      return;
    }
    const brand = brandOf(subName.trim());
    onSaveSubscription({
      id: editingSubId || undefined,
      name: subName.trim(),
      amount: amt,
      day,
      category: subCat,
      account: subAcc || accounts[0]?.name || '',
      logo: brand.logo,
      color: brand.color,
    });
    setShowSubForm(false);
    setEditingSubId(null);
  };

  // Account helpers
  const handleAddAccount = (e) => {
    e.preventDefault();
    const err = store.nameError(newAccName, allAccounts.map((a) => a.name));
    if (err) {
      toast.error(err);
      return;
    }
    const lim = parseFloat(String(newAccLimit || '').replace(/,/g, ''));
    store.addAccount(newAccName.trim(), newAccType, Number.isFinite(lim) && lim > 0 ? lim : 0);
    setNewAccName('');
    setNewAccLimit('');
    toast.success('Account added');
  };

  const handleLimitBlur = (acc, rawVal) => {
    const n = parseFloat(String(rawVal || '').replace(/,/g, '').trim());
    const val = Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
    if (acc.type === 'cash') {
      store.updateAccount(acc.name, { limit: val ? cashStartFor(viewData, acc, val) : 0 });
      toast.success(val ? 'Cash on hand updated' : 'Cash balance tracking removed');
    } else {
      store.updateAccount(acc.name, { limit: val });
      toast.success(val ? 'Monthly limit saved' : 'Monthly limit removed');
    }
  };

  // Real Lock methods
  const lockCfg = state.settings?.lock || { method: 'off', delay: 60 };
  const lockMethod = lockCfg.method || 'off';
  const lockDelay = lockCfg.delay == null ? 60 : lockCfg.delay;

  const askPinPromise = () =>
    new Promise((resolve) => {
      setPinValue('');
      setPinConfirm('');
      setPinModal({ mode: 'ask', resolve });
    });

  const handleLockMethod = async (want) => {
    if (want === lockMethod) return;
    try {
      if (want === 'off') {
        await lk.verifyOwner(askPinPromise);
        await lk.disableLock();
        toast.success('App lock turned off');
      } else if (want === 'bio') {
        if (lockMethod === 'pin') await lk.verifyOwner(askPinPromise);
        await lk.enableBio(lockDelay);
        toast.success('Face ID / Passkey lock is on');
      } else if (want === 'pin') {
        if (lockMethod === 'bio') await lk.verifyOwner(askPinPromise);
        setPinValue('');
        setPinConfirm('');
        setPinModal({ mode: 'set' });
      }
    } catch (err) {
      toast.error(err?.name === 'NotAllowedError' ? 'Cancelled' : err?.message || 'Could not change lock');
    }
  };

  const handlePinSubmit = async (e) => {
    e.preventDefault();
    if (!pinModal) return;
    if (pinModal.mode === 'ask') {
      const r = pinModal.resolve;
      const val = pinValue;
      setPinModal(null);
      r?.(val);
      return;
    }
    if (!/^\d{4,8}$/.test(pinValue)) {
      toast.error('Use 4 to 8 digits');
      return;
    }
    if (pinValue !== pinConfirm) {
      toast.error('PINs do not match');
      return;
    }
    try {
      await lk.enablePin(pinValue, lockDelay);
      setPinModal(null);
      toast.success('PIN lock saved');
    } catch (err) {
      toast.error(err?.message || 'Could not save PIN');
    }
  };

  // Real Vault encryption
  const vaultMode = vault.mode();
  const handleVaultSubmit = async (e) => {
    e.preventDefault();
    try {
      if (vaultModal === 'off') {
        if (!(await vault.check(vaultCurPass))) {
          toast.error('Wrong passphrase');
          return;
        }
        vault.forget();
        await store.persistEverything();
        setVaultModal(null);
        toast.success('Encryption turned off');
        return;
      }
      if (vaultNewPass.length < vault.MIN_LENGTH) {
        toast.error(`Use at least ${vault.MIN_LENGTH} characters`);
        return;
      }
      if (/^\d+$/.test(vaultNewPass) && vaultNewPass.length < 12) {
        toast.error('Digits alone are easy to guess — add letters');
        return;
      }
      if (vaultNewPass !== vaultConfirmPass) {
        toast.error('Passphrases do not match');
        return;
      }
      if (vaultModal === 'change') {
        await vault.changePassphrase(vaultCurPass, vaultNewPass);
        setVaultModal(null);
        toast.success('Passphrase changed');
        return;
      }
      await vault.create(vaultNewPass);
      await store.persistEverything();
      setVaultModal(null);
      toast.success('Data encrypted');
    } catch (err) {
      toast.error(err?.message || 'Encryption update failed');
    }
  };

  // Real Import / Export
  const handleExportXlsx = async () => {
    try {
      const bytes = buildWorkbook({
        months: viewData.months,
        by: viewData.by,
        categories: viewData.categories,
        accounts: viewData.accounts,
      });
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const res = await util.saveFile('Expense Log.xlsx', blob);
      if (res !== 'cancelled') toast.success('Excel workbook ready');
    } catch (err) {
      toast.error(err?.message || 'Could not export Excel file');
    }
  };

  const handleExportCsv = async () => {
    const rows = store.exportCsv();
    const text = rows.map((r) => r.map(util.csvEscape).join(',')).join('\n');
    await util.saveFile('expense-log.csv', new Blob([text], { type: 'text/csv' }));
    toast.success('CSV exported');
  };

  const computeImport = (res, name, kind, createMissing) => {
    const defAcc = allAccounts[0]?.name || '';
    const keyOf = (e) =>
      [e.date, e.description, Number(e.amount).toFixed(2), e.type, e.category, e.sub, e.account || defAcc].join('|');
    const have = new Map();
    for (const k of viewData.months) {
      for (const e of viewData.by[k].entries) {
        have.set(keyOf(e), (have.get(keyOf(e)) || 0) + 1);
      }
    }
    const candidates = res.entries.slice();
    const skipped = [];
    let fixable = 0;
    for (const sk of res.skipped) {
      if (!sk.fix) { skipped.push(sk); continue; }
      const e = sk.fix;
      const catOk = !store.nameError(e.category, [], ['Income', 'Categories']);
      const subOk = !e.sub || !store.nameError(e.sub, []);
      if (catOk && subOk) {
        fixable++;
        if (createMissing) { candidates.push(e); continue; }
      }
      skipped.push(sk);
    }
    const lc = (x) => String(x).toLowerCase();
    const existing = new Map(categories.order.map((c) => [lc(c), c]));
    const newCats = new Map();
    const fresh = [];
    let dupes = 0;
    for (const e0 of candidates) {
      const e = { ...e0 };
      if (e.account) {
        const hit = allAccounts.find((a) => lc(a.name) === lc(e.account));
        if (hit) e.account = hit.name;
        else delete e.account;
      }
      if (e.type === 'Expense') {
        const cl = lc(e.category);
        const known = existing.get(cl);
        if (known) {
          e.category = known;
          const subs = categories.map[known] || [];
          const hit = subs.find((x) => lc(x) === lc(e.sub));
          if (hit) e.sub = hit;
          else if (!e.sub || lc(e.sub) === cl) e.sub = known;
          else {
            const nc = newCats.get(cl) || { name: known, subs: new Map(), existing: true };
            newCats.set(cl, nc);
            if (!nc.subs.has(lc(e.sub))) nc.subs.set(lc(e.sub), e.sub);
            e.sub = nc.subs.get(lc(e.sub));
          }
        } else {
          const nc = newCats.get(cl) || { name: e.category, subs: new Map(), existing: false };
          newCats.set(cl, nc);
          e.category = nc.name;
          if (!e.sub) e.sub = e.category;
          else {
            if (!nc.subs.has(lc(e.sub))) nc.subs.set(lc(e.sub), e.sub);
            e.sub = nc.subs.get(lc(e.sub));
          }
        }
      }
      const k = keyOf(e);
      if (have.get(k)) { have.set(k, have.get(k) - 1); dupes++; }
      else fresh.push(e);
    }
    setImportPreview({
      name,
      kind,
      res,
      createMissing,
      fresh,
      dupes,
      skipped,
      fixable,
      newCats: [...newCats.values()].filter((c) => !c.existing || c.subs.size),
    });
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 2));
      const isZip = head[0] === 0x50 && head[1] === 0x4b;
      const res = isZip ? await parseWorkbook(buf, categories) : readCsvEntries(decodeText(buf), categories);
      computeImport(res, file.name, isZip ? 'Excel' : 'CSV', false);
    } catch (err) {
      toast.error(err?.message || 'Could not read that file');
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview?.fresh.length) {
      setImportPreview(null);
      return;
    }
    if (importPreview.createMissing) {
      for (const c of importPreview.newCats) {
        if (!c.existing) store.addCategory(c.name);
        for (const sub of c.subs.values()) store.addSub(c.name, sub);
      }
    }
    store.addMany(importPreview.fresh);
    toast.success(`Importing ${importPreview.fresh.length} transactions…`);
    setImportPreview(null);
  };

  // Real Share link creation
  const handleCreateShare = async (e) => {
    e.preventDefault();
    if (!shareName.trim()) {
      toast.error('Enter their name first');
      return;
    }
    try {
      const r = await store.shareCreate(shareName.trim(), shareNote.trim());
      setShareCreated({ name: r.name, link: viewLinkUrl(state.cfg, r.token) });
      setShareName('');
      setShareNote('');
      setViewersList(null);
      toast.success('View-only link ready');
    } catch (err) {
      toast.error(err?.message || 'Could not create link');
    }
  };

  const handleUpdateScript = async () => {
    if (updatingScript) return;
    setUpdatingScript(true);
    try {
      const r = await store.selfUpdate();
      if (r.updated) {
        toast.success(`Sheet script updated to v${r.version}`);
        store.sync();
      } else {
        toast.info('Latest script is not published on the remote host yet');
      }
    } catch (err) {
      toast.error(err?.message || 'Could not update script');
    } finally {
      setUpdatingScript(false);
    }
  };

  const switchToClassicUi = () => {
    try { localStorage.setItem('el_ui', 'classic'); } catch { /* ignore */ }
    try { vault.stashForReload(); } catch { /* ignore */ }
    window.location.replace('classic.html' + window.location.hash);
  };

  const isHome = settingsPage === 'home';
  const trash = state.trash || [];
  const scriptVersion = state.scriptVersion;
  const hostLabel = isDemo
    ? 'Demo mode (local storage)'
    : isViewer
      ? 'Shared view-only link'
      : (() => {
          try { return new URL(state.cfg?.url || '').host; } catch { return 'Connected'; }
        })();

  const menuRows = isViewer
    ? [
        {
          id: 'appearance',
          label: 'Appearance & Nav',
          sub: `${concept} · ${themeMode} · ${navStyle === 'orb' ? 'Side Orb' : 'Center +'} · ${subsStyle === 'arc' ? 'Pass Deck' : '3D Flip'}`,
          Icon: Palette,
          color: '#EC4899',
        },
        {
          id: 'privacy',
          label: 'App Lock',
          sub: lockMethod === 'bio' ? 'Face ID' : lockMethod === 'pin' ? 'PIN' : 'No lock',
          Icon: ShieldCheck,
          color: '#10B981',
        },
        {
          id: 'about',
          label: 'About & Updates',
          sub: `v${APP_VERSION}`,
          Icon: Smartphone,
          color: '#6366F1',
        },
      ]
    : [
        {
          id: 'subscriptions',
          label: 'Subscriptions',
          sub: `${subscriptions.filter((s) => !s.paused).length} active · ${subsStyle === 'arc' ? 'Pass Deck' : '3D Flip Stack'}`,
          badge: subscriptions.length ? `${subscriptions.length}` : null,
          Icon: CreditCard,
          color: '#8B5CF6',
        },
        {
          id: 'budget',
          label: 'Accounts & Budget',
          sub: `${accounts.length} account${accounts.length === 1 ? '' : 's'}${monthlyBudget > 0 ? ` · ${formatEGP(monthlyBudget)} ${currency}/mo` : ''}`,
          Icon: Sliders,
          color: '#3B82F6',
        },
        {
          id: 'appearance',
          label: 'Appearance & Nav',
          sub: `${concept} · ${themeMode} · ${navStyle === 'orb' ? 'Side Orb' : 'Center +'}`,
          Icon: Palette,
          color: '#EC4899',
        },
        {
          id: 'privacy',
          label: 'Privacy & Security',
          sub: `${lockMethod === 'bio' ? 'Face ID' : lockMethod === 'pin' ? 'PIN' : 'No lock'} · ${vaultMode ? 'Encrypted' : 'Not encrypted'}`,
          Icon: ShieldCheck,
          color: '#10B981',
        },
        ...(isDemo || scriptVersion === undefined || scriptVersion >= 10
          ? [
              {
                id: 'share',
                label: 'Share View-Only',
                sub: 'Read-only link for family or accountant',
                Icon: Share2,
                color: '#06B6D4',
              },
            ]
          : []),
        {
          id: 'trash',
          label: 'Data, Export & Trash',
          sub: `Excel (.xlsx), CSV · ${trash.length} deleted`,
          badge: trash.length > 0 ? `${trash.length}` : null,
          Icon: Trash2,
          color: '#F43F5E',
        },
        {
          id: 'about',
          label: 'About & Updates',
          sub: `v${APP_VERSION}${!isDemo && scriptVersion ? ` · Script v${scriptVersion}` : ''}`,
          badge: !isDemo && scriptVersion && scriptVersion < SCRIPT_LATEST ? 'Update' : null,
          Icon: Smartphone,
          color: '#6366F1',
        },
      ];

  return (
    <div className="px-4 pt-1 pb-28">
      <input
        ref={fileInputRef}
        type="file"
        hidden
        accept={
          importKind === 'csv'
            ? '.csv,.txt,text/csv,text/plain'
            : '.xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12'
        }
        onChange={handleFileChange}
      />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={settingsPage}
          initial={{ opacity: 0, x: isHome ? -18 : 22 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: isHome ? 22 : -18 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* SETTINGS HOME */}
          {settingsPage === 'home' && (
            <div className="space-y-3.5">
              {/* Sync Card */}
              <div className="surface-card p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    Sync
                  </div>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-bold inline-flex items-center gap-1.5"
                    style={{
                      backgroundColor: state.status === 'syncing' ? 'var(--accent-soft)' : 'rgba(16, 185, 129, 0.14)',
                      color: state.status === 'syncing' ? 'var(--accent)' : '#10B981',
                    }}
                  >
                    {state.status || 'ready'}
                  </span>
                </div>

                <div className="space-y-1 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ color: 'var(--text-secondary)' }}>Source</span>
                    <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                      {hostLabel}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span style={{ color: 'var(--text-secondary)' }}>Last synced</span>
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {state.lastSync
                        ? new Date(state.lastSync).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                        : 'Never'}
                    </span>
                  </div>
                  {state.queue?.length > 0 && (
                    <div className="flex items-center justify-between gap-2">
                      <span style={{ color: 'var(--text-secondary)' }}>Waiting to upload</span>
                      <span className="font-bold" style={{ color: 'var(--warning)' }}>
                        {state.queue.length}
                      </span>
                    </div>
                  )}
                </div>

                {state.error && (state.status === 'error' || state.status === 'retrying') && (
                  <div className="text-[11px] text-rose-500">{state.error}</div>
                )}

                <button
                  type="button"
                  onClick={onSyncNow}
                  disabled={state.status === 'syncing'}
                  className="w-full py-2 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-70"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  <RefreshCw size={13} className={state.status === 'syncing' ? 'animate-spin' : ''} />
                  <span>{state.status === 'syncing' ? 'Syncing…' : isViewer ? 'Refresh' : 'Sync now'}</span>
                </button>
              </div>

              <div className="surface-card overflow-hidden divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {menuRows.map((row) => {
                  const Icon = row.Icon;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => setSettingsPage(row.id)}
                      className="w-full px-3.5 py-3 flex items-center gap-3 text-left active:opacity-80 transition-opacity"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${row.color}20`, color: row.color }}
                      >
                        <Icon size={17} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {row.label}
                        </div>
                        <div className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                          {row.sub}
                        </div>
                      </div>
                      {row.badge && (
                        <span
                          className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                          style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                        >
                          {row.badge}
                        </span>
                      )}
                      <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* SUB-PAGE 1: SUBSCRIPTIONS */}
          {settingsPage === 'subscriptions' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-[18px] font-bold">Subscriptions Wallet</h2>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {subsStyle === 'arc' ? 'Tap a pass to inspect · Pull stack to fan' : 'Tap any card to flip 3D'}
                  </p>
                </div>
                {!isViewer && (
                  <button
                    type="button"
                    onClick={() => (showSubForm ? setShowSubForm(false) : openNewSubForm())}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-bold shrink-0"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    <Plus size={14} />
                    <span>Add Sub</span>
                  </button>
                )}
              </div>

              <SlidingHighlight
                activeKey={subsStyle}
                onSelect={setSubsStyle}
                className="grid grid-cols-2 p-1 rounded-xl border"
                style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                pillClassName="rounded-[7px]"
                pillStyle={{ backgroundColor: 'var(--accent)' }}
              >
                {[
                  { id: 'flip', label: '3D Flip' },
                  { id: 'arc', label: 'Pass Deck' },
                ].map((mode) => {
                  const active = subsStyle === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      data-hl={mode.id}
                      onClick={() => setSubsStyle(mode.id)}
                      className="relative py-1.5 text-[11px] font-semibold rounded-[7px] z-10 transition-colors"
                      style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </SlidingHighlight>

              <AnimatePresence>
                {showSubForm && !isViewer && (
                  <motion.form
                    onSubmit={handleSaveSubForm}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="surface-card p-3.5 space-y-2.5 overflow-hidden"
                  >
                    <div className="flex items-center justify-between">
                      <div className="text-[12px] font-bold">
                        {editingSubId ? 'Edit Subscription' : 'New Subscription'}
                      </div>
                      {editingSubId && onDeleteSubscription && (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(`Delete "${subName}"?`)) {
                              onDeleteSubscription(editingSubId);
                              setShowSubForm(false);
                              setEditingSubId(null);
                            }
                          }}
                          className="text-[11px] font-bold text-rose-500"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Service name"
                        value={subName}
                        onChange={(e) => setSubName(e.target.value)}
                        className="col-span-2 px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                      />
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Day 1-31"
                        min="1"
                        max="31"
                        value={subDay}
                        onChange={(e) => setSubDay(e.target.value)}
                        className="px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="0.01"
                        placeholder={`${currency} / mo`}
                        value={subAmount}
                        onChange={(e) => setSubAmount(e.target.value)}
                        className="px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                      />
                      <select
                        value={subCat}
                        onChange={(e) => setSubCat(e.target.value)}
                        className="px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                      >
                        {categories.order.map((c) => (
                          <option key={c} value={c} style={{ color: '#000' }}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex gap-1.5 flex-wrap">
                        {accounts.map((a) => (
                          <button
                            key={a.name}
                            type="button"
                            onClick={() => setSubAcc(a.name)}
                            className="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                            style={{
                              backgroundColor: subAcc === a.name ? 'var(--accent)' : 'var(--bg-pill)',
                              borderColor: subAcc === a.name ? 'var(--accent)' : 'var(--border-subtle)',
                              color: subAcc === a.name ? 'var(--accent-fg)' : 'var(--text-secondary)',
                            }}
                          >
                            {a.name}
                          </button>
                        ))}
                      </div>
                      <button
                        type="submit"
                        className="px-3.5 py-1.5 rounded-xl text-[12px] font-bold"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                      >
                        Save
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>

              {upcoming14.length > 0 && (
                <div className="surface-card p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Next 14 Days ({upcoming14.length})
                  </div>
                  <div className="flex gap-2 overflow-x-auto no-scrollbar">
                    {upcoming14.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setFocusedSubId(s.id)}
                        className="px-3 py-2 rounded-xl border shrink-0 text-left"
                        style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="text-[12px] font-bold">{s.name}</div>
                        <div className="text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                          {s.daysLeft < 0 ? `${-s.daysLeft}d late` : s.daysLeft === 0 ? 'today' : `in ${s.daysLeft}d`} · {formatAmt(s.amount)} {currency}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {sleepyAnnualSavings > 0 && (
                <div
                  className="p-3 rounded-2xl border flex items-center gap-2.5"
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                    borderColor: 'rgba(245, 158, 11, 0.35)',
                  }}
                >
                  <span className="text-[18px]">💤</span>
                  <div className="text-[12px]">
                    <strong style={{ color: 'var(--text-primary)' }}>
                      Save <NumberFlow value={sleepyAnnualSavings} format={{ maximumFractionDigits: 0 }} /> {currency}/year
                    </strong>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      from subscriptions rated Sleepy — tap a card to review
                    </div>
                  </div>
                </div>
              )}

              {subscriptions.length === 0 ? (
                <div className="surface-card p-8 text-center">
                  <div className="text-[14px] font-bold">No subscriptions yet</div>
                  <div className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    Tap + Add Sub above to add Netflix, Spotify, iCloud, or gym plans.
                  </div>
                </div>
              ) : subsStyle === 'arc' ? (
                <ArcWalletStack
                  subscriptions={subscriptions}
                  allEntries={allEntries}
                  currency={currency}
                  onRateSubscription={onRateSubscription}
                  onLogSubPaid={onLogSubPaid}
                  onSkipSubMonth={onSkipSubMonth}
                  onEditSub={isViewer ? null : openNewSubForm}
                  focusedSubId={focusedSubId}
                  setFocusedSubId={setFocusedSubId}
                  isViewer={isViewer}
                />
              ) : (
                <WalletStack3D
                  subscriptions={subscriptions}
                  currency={currency}
                  onRateSubscription={onRateSubscription}
                  onLogSubPaid={onLogSubPaid}
                  onSkipSubMonth={onSkipSubMonth}
                  onEditSub={isViewer ? null : openNewSubForm}
                  focusedSubId={focusedSubId}
                  setFocusedSubId={setFocusedSubId}
                  isViewer={isViewer}
                />
              )}

              {/* Spotted recurring charges */}
              {spottedSubs.length > 0 && !isViewer && (
                <div className="surface-card p-3.5 space-y-2">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    Spotted in your entries
                  </div>
                  {spottedSubs.map((sp) => (
                    <div key={sp.name} className="flex items-center justify-between gap-2 text-[12px]">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{sp.name}</div>
                        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          {formatAmt(sp.last.amount)} {currency} · {sp.months.size} months
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          openNewSubForm({
                            name: sp.name,
                            amount: sp.last.amount,
                            day: Number(sp.last.date.slice(8, 10)) || 1,
                            category: sp.last.category,
                            account: sp.last.account,
                          })
                        }
                        className="px-2.5 py-1 rounded-full text-[11px] font-bold border"
                        style={{
                          backgroundColor: 'var(--accent-soft)',
                          borderColor: 'var(--accent)',
                          color: 'var(--accent)',
                        }}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-PAGE 2: ACCOUNTS & BUDGET */}
          {settingsPage === 'budget' && (
            <div className="space-y-3.5">
              <h2 className="font-display text-[18px] font-bold">Accounts & Budget</h2>

              {/* Real Accounts Management */}
              <div className="surface-card p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold">Accounts ({allAccounts.length})</span>
                </div>

                {allAccounts.map((acc, i) => {
                  const isCashAcc = acc.type === 'cash';
                  const cashNow = isCashAcc ? cashLeft(viewData, acc) : null;
                  const initVal = isCashAcc ? (cashNow !== null ? String(cashNow) : '') : acc.limit > 0 ? String(acc.limit) : '';
                  return (
                    <div
                      key={acc.name}
                      className={`p-2.5 rounded-xl border space-y-2 ${acc.archived ? 'opacity-60' : ''}`}
                      style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: isCashAcc ? '#10B981' : '#6366F1' }} />
                          <div className="min-w-0">
                            <div className="text-[13px] font-bold truncate">{acc.name}</div>
                            <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                              {isCashAcc ? 'Cash' : 'Card'}
                              {i === 0 ? ' · main' : ''}
                              {acc.archived ? ' · archived' : ''}
                            </div>
                          </div>
                        </div>

                        <input
                          key={`${acc.name}-${initVal}`}
                          type="number"
                          inputMode="decimal"
                          defaultValue={initVal}
                          placeholder={isCashAcc ? 'Cash on hand' : 'Monthly limit'}
                          onBlur={(e) => {
                            if (e.target.value !== initVal) handleLimitBlur(acc, e.target.value);
                          }}
                          className="w-32 px-2.5 py-1.5 rounded-lg border bg-transparent text-[16px] text-right font-bold outline-none"
                          style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                        />
                      </div>

                      {i > 0 && (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => store.updateAccount(acc.name, { archived: !acc.archived })}
                            className="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            {acc.archived ? 'Restore' : 'Archive'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setDeleteAccState({
                                name: acc.name,
                                mode: 'keep',
                                to: allAccounts[0]?.name || '',
                              })
                            }
                            className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-rose-500 border border-rose-500/30"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                <form onSubmit={handleAddAccount} className="pt-2 space-y-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                    Add Account
                  </div>
                  <SlidingHighlight
                    activeKey={newAccType}
                    onSelect={setNewAccType}
                    className="grid grid-cols-2 p-1 rounded-xl border"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    pillClassName="rounded-[7px]"
                    pillStyle={{ backgroundColor: 'var(--accent)' }}
                  >
                    {[
                      { id: 'card', label: 'Card' },
                      { id: 'cash', label: 'Cash' },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        data-hl={t.id}
                        onClick={() => setNewAccType(t.id)}
                        className="relative py-1.5 text-[11px] font-semibold rounded-[7px] z-10 transition-colors"
                        style={{ color: newAccType === t.id ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                      >
                        {t.label}
                      </button>
                    ))}
                  </SlidingHighlight>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      maxLength={30}
                      placeholder="Account name"
                      value={newAccName}
                      onChange={(e) => setNewAccName(e.target.value)}
                      className="px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                      style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder={newAccType === 'cash' ? 'Cash on hand' : 'Monthly limit'}
                      value={newAccLimit}
                      onChange={(e) => setNewAccLimit(e.target.value)}
                      className="px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                      style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1"
                    style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    <Plus size={14} />
                    <span>Add account</span>
                  </button>
                </form>
              </div>

              {/* Monthly Budget, Currency & Fuel Cutoff */}
              <div className="surface-card p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-bold">Monthly Budget</span>
                    <span className="text-[15px] font-extrabold tabular-nums" style={{ color: 'var(--accent)' }}>
                      {monthlyBudget > 0 ? <><NumberFlow value={monthlyBudget} format={{ maximumFractionDigits: 0 }} /> {currency}</> : 'Off'}
                    </span>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="e.g. 25000 (blank = off)"
                    value={monthlyBudget || ''}
                    onChange={(e) => setMonthlyBudget(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none mb-2"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  />
                  <input
                    type="range"
                    min="0"
                    max="60000"
                    step="500"
                    value={Math.min(60000, monthlyBudget)}
                    onChange={(e) => setMonthlyBudget(Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </div>

                <div>
                  <label className="text-[13px] font-bold block mb-1">Currency Symbol</label>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="EGP"
                    value={state.settings?.currency ?? ''}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <span className="text-[13px] font-bold">Fuel Cutoff (Haval vs Verna)</span>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        ≥ <NumberFlow value={fuelCutoff} format={{ maximumFractionDigits: 0 }} /> {currency} notes Fuel - Haval
                      </div>
                    </div>
                    <span className="text-[14px] font-bold tabular-nums">
                      <NumberFlow value={fuelCutoff} format={{ maximumFractionDigits: 0 }} /> {currency}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="200"
                    max="1500"
                    step="25"
                    value={fuelCutoff}
                    onChange={(e) => setFuelCutoff(Number(e.target.value))}
                    className="w-full accent-[var(--accent)]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* SUB-PAGE 3: APPEARANCE & NAV (All 5 Prototype v9 Options + Hold-Drag-Release Pills) */}
          {settingsPage === 'appearance' && (
            <div className="space-y-3.5">
              <h2 className="font-display text-[18px] font-bold">Appearance & Nav</h2>

              <div className="surface-card p-4 space-y-2.5">
                <div className="text-[12px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                  Visual Direction
                </div>
                {[
                  { id: 'obsidian', name: '1 · Obsidian', desc: 'Copilot Money × iOS Glass, rotating specular border' },
                  { id: 'kinetic', name: '2 · Kinetic', desc: 'Cash App × Family × Wise, account-adaptive colors' },
                  { id: 'editorial', name: '3 · Editorial', desc: 'Monarch × Linear, warm paper & serif titles' },
                ].map((c) => {
                  const active = concept === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setConcept(c.id)}
                      className="w-full p-3 rounded-2xl border text-left flex items-center justify-between"
                      style={{
                        backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-pill)',
                        borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                      }}
                    >
                      <div>
                        <div className="text-[13px] font-bold">{c.name}</div>
                        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.desc}</div>
                      </div>
                      {active && <Check size={16} style={{ color: 'var(--accent)' }} />}
                    </button>
                  );
                })}
              </div>

              <div className="surface-card p-4 space-y-4">
                <div>
                  <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Color Theme
                  </div>
                  <SlidingHighlight
                    activeKey={themeMode}
                    onSelect={setThemeMode}
                    className="grid grid-cols-3 p-1 rounded-xl border"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    pillClassName="rounded-[7px]"
                    pillStyle={{ backgroundColor: 'var(--accent)' }}
                  >
                    {[
                      { id: 'light', label: 'Light' },
                      { id: 'dark', label: 'Dark' },
                      { id: 'system', label: 'System' },
                    ].map((t) => {
                      const active = themeMode === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          data-hl={t.id}
                          onClick={() => setThemeMode(t.id)}
                          className="relative py-1.5 text-[12px] font-semibold rounded-[7px] z-10 transition-colors"
                          style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </SlidingHighlight>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[13px] font-bold">Glass Bars</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      Translucent backdrop blur on bars & cards
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={glassBars}
                    aria-label="Toggle Glass Bars"
                    onClick={() => setGlassBars(!glassBars)}
                    className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                      glassBars ? 'bg-indigo-500' : 'bg-slate-500/40'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-white transition-transform ${
                        glassBars ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {!isViewer && (
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-bold">Save Purchase Location</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        Attaches GPS on Save of new manual entries
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={locCapture}
                      aria-label="Toggle Location Capture"
                      onClick={() => setLocCapture(!locCapture)}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        locCapture ? 'bg-emerald-500' : 'bg-slate-500/40'
                      }`}
                    >
                      <div
                        className={`w-5 h-5 rounded-full bg-white transition-transform ${
                          locCapture ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                )}

                <div>
                  <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Bottom Dock
                  </div>
                  <SlidingHighlight
                    activeKey={navStyle}
                    onSelect={setNavStyle}
                    className="grid grid-cols-2 p-1 rounded-xl border"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    pillClassName="rounded-[7px]"
                    pillStyle={{ backgroundColor: 'var(--accent)' }}
                  >
                    {[
                      { id: 'center', label: 'Center +' },
                      { id: 'orb', label: 'Side Orb' },
                    ].map((n) => {
                      const active = navStyle === n.id;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          data-hl={n.id}
                          onClick={() => setNavStyle(n.id)}
                          className="relative py-1.5 text-[12px] font-semibold rounded-[7px] z-10 transition-colors"
                          style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                        >
                          {n.label}
                        </button>
                      );
                    })}
                  </SlidingHighlight>
                </div>

                <div>
                  <div className="text-[12px] font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Subscriptions Wallet
                  </div>
                  <SlidingHighlight
                    activeKey={subsStyle}
                    onSelect={setSubsStyle}
                    className="grid grid-cols-2 p-1 rounded-xl border"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    pillClassName="rounded-[7px]"
                    pillStyle={{ backgroundColor: 'var(--accent)' }}
                  >
                    {[
                      { id: 'flip', label: '3D Flip Stack' },
                      { id: 'arc', label: 'Pass Deck' },
                    ].map((w) => {
                      const active = subsStyle === w.id;
                      return (
                        <button
                          key={w.id}
                          type="button"
                          data-hl={w.id}
                          onClick={() => setSubsStyle(w.id)}
                          className="relative py-1.5 text-[12px] font-semibold rounded-[7px] z-10 transition-colors"
                          style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                        >
                          {w.label}
                        </button>
                      );
                    })}
                  </SlidingHighlight>
                </div>
              </div>

              <div className="surface-card p-4 space-y-2">
                <div className="text-[12px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                  App Interface
                </div>
                <SlidingHighlight
                  activeKey="modern"
                  onSelect={(v) => {
                    if (v === 'classic') switchToClassicUi();
                  }}
                  className="grid grid-cols-2 p-1 rounded-xl border"
                  style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                  pillClassName="rounded-[7px]"
                  pillStyle={{ backgroundColor: 'var(--accent)' }}
                >
                  {[
                    { id: 'modern', label: 'Modern' },
                    { id: 'classic', label: 'Classic (Original)' },
                  ].map((u) => {
                    const active = u.id === 'modern';
                    return (
                      <button
                        key={u.id}
                        type="button"
                        data-hl={u.id}
                        onClick={() => {
                          if (u.id === 'classic') switchToClassicUi();
                        }}
                        className="relative py-1.5 text-[12px] font-semibold rounded-[7px] z-10 transition-colors"
                        style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                      >
                        {u.label}
                      </button>
                    );
                  })}
                </SlidingHighlight>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Classic preserves the previous app interface on the exact same data & Google Sheet sync. Switch back from Settings › Appearance anytime.
                </p>
              </div>
            </div>
          )}

          {/* SUB-PAGE 4: PRIVACY & SECURITY (Real lockui + vault) */}
          {settingsPage === 'privacy' && (
            <div className="space-y-3.5">
              <h2 className="font-display text-[18px] font-bold">Privacy & Security</h2>

              <div className="surface-card p-4 space-y-3">
                <div className="text-[12px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                  App Lock
                </div>
                <SlidingHighlight
                  activeKey={lockMethod}
                  onSelect={handleLockMethod}
                  className="grid grid-cols-3 p-1 rounded-xl border"
                  style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                  pillClassName="rounded-[7px]"
                  pillStyle={{ backgroundColor: 'var(--accent)' }}
                >
                  {[
                    { id: 'off', label: 'Off' },
                    { id: 'bio', label: 'Face ID' },
                    { id: 'pin', label: 'PIN' },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      data-hl={m.id}
                      onClick={() => handleLockMethod(m.id)}
                      className="relative py-1.5 text-[12px] font-semibold rounded-[7px] z-10 transition-colors"
                      style={{ color: lockMethod === m.id ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                    >
                      {m.label}
                    </button>
                  ))}
                </SlidingHighlight>

                {lockMethod !== 'off' && (
                  <>
                    <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                      Lock after away for
                    </div>
                    <SlidingHighlight
                      activeKey={String(lockDelay)}
                      onSelect={(v) => store.saveSettings({ lock: { ...lockCfg, delay: Number(v) } })}
                      className="grid grid-cols-4 p-1 rounded-xl border"
                      style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                      pillClassName="rounded-[7px]"
                      pillStyle={{ backgroundColor: 'var(--accent)' }}
                    >
                      {[
                        { id: '0', label: 'Now' },
                        { id: '60', label: '1m' },
                        { id: '300', label: '5m' },
                        { id: '900', label: '15m' },
                      ].map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          data-hl={d.id}
                          onClick={() => store.saveSettings({ lock: { ...lockCfg, delay: Number(d.id) } })}
                          className="relative py-1.5 text-[11px] font-semibold rounded-[7px] z-10 transition-colors"
                          style={{ color: String(lockDelay) === d.id ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                        >
                          {d.label}
                        </button>
                      ))}
                    </SlidingHighlight>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => lk.lockApp()}
                        className="flex-1 py-2.5 rounded-xl font-bold text-[12px] flex items-center justify-center gap-1.5"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                      >
                        <Lock size={14} />
                        <span>Lock now</span>
                      </button>
                      {lockMethod === 'pin' && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await lk.verifyOwner(askPinPromise);
                              setPinValue('');
                              setPinConfirm('');
                              setPinModal({ mode: 'change' });
                            } catch (err) {
                              toast.error(err?.message || 'Wrong PIN');
                            }
                          }}
                          className="px-3.5 py-2.5 rounded-xl font-bold text-[12px] border"
                          style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                        >
                          Change PIN
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {!isViewer && (
                <div className="surface-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[13px] font-bold">AES-256 Encryption</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {vaultMode === 'device'
                          ? 'On · Automatic device key'
                          : vaultMode === 'passphrase'
                            ? 'On · Passphrase protected'
                            : 'Off · Stored unscrambled on this phone'}
                      </div>
                    </div>
                  </div>

                  {vaultMode === 'device' ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!confirm('Turn off encryption? Data will be stored unscrambled again.')) return;
                        vault.forget();
                        await store.persistEverything();
                        toast.success('Encryption is off');
                      }}
                      className="w-full py-2.5 rounded-xl text-[12px] font-bold border"
                      style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    >
                      Turn off automatic encryption
                    </button>
                  ) : vaultMode === 'passphrase' ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setVaultCurPass('');
                          setVaultNewPass('');
                          setVaultConfirmPass('');
                          setVaultModal('change');
                        }}
                        className="py-2.5 rounded-xl text-[12px] font-bold border"
                        style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                      >
                        Change passphrase
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVaultCurPass('');
                          setVaultModal('off');
                        }}
                        className="py-2.5 rounded-xl text-[12px] font-bold text-rose-500 border border-rose-500/30"
                      >
                        Turn off
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await vault.createDevice();
                            await store.persistEverything();
                            toast.success('Automatic AES-256 encryption enabled');
                          } catch {
                            vault.forget();
                            toast.error('Could not turn on encryption on this device');
                          }
                        }}
                        className="w-full py-2.5 rounded-xl text-[12px] font-bold"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                      >
                        Turn on automatic encryption
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setVaultNewPass('');
                          setVaultConfirmPass('');
                          setVaultModal('on');
                        }}
                        className="w-full py-2 text-[11px] font-semibold"
                        style={{ color: 'var(--accent)' }}
                      >
                        Or use a custom passphrase (stronger)
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="surface-card p-4 flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-bold">Hide Numbers</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    Mask balances everywhere in the app
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onTogglePrivacy}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                    privacyBlur ? 'bg-indigo-500' : 'bg-slate-500/40'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white transition-transform ${
                      privacyBlur ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}

          {/* SUB-PAGE 5: SHARE VIEW-ONLY */}
          {settingsPage === 'share' && (
            <div className="space-y-3.5">
              <h2 className="font-display text-[18px] font-bold">Share View-Only</h2>

              <form onSubmit={handleCreateShare} className="surface-card p-4 space-y-3">
                <div className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>
                  Someone with a view-only link sees your entries, balances, and subscriptions, but cannot change anything.
                </div>

                <input
                  type="text"
                  maxLength={40}
                  placeholder="Their name (e.g. Sara)"
                  value={shareName}
                  onChange={(e) => setShareName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                />
                <input
                  type="text"
                  maxLength={140}
                  placeholder="Short note (optional)"
                  value={shareNote}
                  onChange={(e) => setShareNote(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                />

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  <Plus size={14} />
                  <span>Create view-only link</span>
                </button>

                {shareCreated && (
                  <div className="p-3 rounded-xl border space-y-2" style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--accent)' }}>
                    <div className="text-[11px] font-bold">Link for {shareCreated.name}</div>
                    <input
                      readOnly
                      value={shareCreated.link}
                      className="w-full px-2.5 py-1.5 rounded-lg border bg-transparent text-[16px] outline-none"
                      style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(shareCreated.link).catch(() => {});
                        toast.success('Link copied');
                      }}
                      className="w-full py-2 rounded-xl text-[11px] font-bold inline-flex items-center justify-center gap-1"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      <Copy size={12} />
                      <span>Copy link</span>
                    </button>
                  </div>
                )}
              </form>

              <div className="surface-card p-4 space-y-2">
                <div className="text-[13px] font-bold">People with a link</div>
                {shareBusy ? (
                  <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Loading…</div>
                ) : !viewersList || viewersList.length === 0 ? (
                  <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>Nobody yet.</div>
                ) : (
                  viewersList.map((vw) => {
                    const link = viewLinkUrl(state.cfg, vw.token);
                    return (
                      <div key={vw.token} className="p-2.5 rounded-xl border flex items-center justify-between gap-2" style={{ borderColor: 'var(--border-subtle)' }}>
                        <div className="min-w-0">
                          <div className="text-[12px] font-bold truncate">{vw.name}</div>
                          {vw.note && <div className="text-[10px] truncate" style={{ color: 'var(--text-secondary)' }}>{vw.note}</div>}
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard?.writeText(link).catch(() => {});
                              toast.success('Copied');
                            }}
                            className="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                            style={{ borderColor: 'var(--border-subtle)' }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!confirm(`Revoke ${vw.name}'s link?`)) return;
                              await store.shareRevoke(vw.token);
                              setViewersList(null);
                              toast.success('Link revoked');
                            }}
                            className="px-2.5 py-1 rounded-full text-[11px] font-semibold text-rose-500 border border-rose-500/30"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* SUB-PAGE 6: DATA, EXPORT & TRASH */}
          {settingsPage === 'trash' && (
            <div className="space-y-3.5">
              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'rgba(16, 185, 129, 0.14)', color: '#10B981' }}
                  >
                    <FileSpreadsheet size={16} />
                  </div>
                  <div>
                    <h2 className="font-display text-[15px] font-bold leading-tight">Excel & CSV</h2>
                    <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      Export formatted workbooks or import logs
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleExportXlsx}
                    className="px-3 py-2.5 rounded-xl border text-[12px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    style={{ backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                  >
                    <Download size={13} />
                    <span>Export Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportKind('xlsx');
                      setTimeout(() => fileInputRef.current?.click(), 10);
                    }}
                    className="px-3 py-2.5 rounded-xl border text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    <Upload size={13} />
                    <span>Import Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleExportCsv}
                    className="px-3 py-2.5 rounded-xl border text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    <Download size={13} />
                    <span>Export CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setImportKind('csv');
                      setTimeout(() => fileInputRef.current?.click(), 10);
                    }}
                    className="px-3 py-2.5 rounded-xl border text-[12px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                  >
                    <Upload size={13} />
                    <span>Import CSV</span>
                  </button>
                </div>

                {isDemo && (
                  <div className="flex items-center justify-between pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                    <span className="text-[12px] font-semibold">Simulate offline (demo)</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !demoOffline;
                        setDemoOffline(next);
                        try { localStorage.setItem('el_demo_offline', next ? '1' : '0'); } catch { /* ignore */ }
                        if (!next) store.sync();
                        else toast.info('Offline simulation enabled');
                      }}
                      className={`w-11 h-6 rounded-full p-0.5 transition-colors ${
                        demoOffline ? 'bg-amber-500' : 'bg-slate-500/40'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded-full bg-white transition-transform ${demoOffline ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-0.5">
                <h2 className="font-display text-[18px] font-bold">Recently Deleted</h2>
                {trash.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm('Permanently clear recently deleted items?')) onEmptyTrash();
                    }}
                    className="text-[12px] font-semibold text-rose-500"
                  >
                    Empty Trash
                  </button>
                )}
              </div>

              {trash.length === 0 ? (
                <div className="surface-card p-8 text-center">
                  <div className="text-[14px] font-bold">Trash is empty</div>
                  <div className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    Deleted entries stay here for 60 days so you can restore them anytime.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {trash.map((item) => (
                    <div
                      key={item.trashId}
                      className="surface-card p-3 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold truncate">
                          {item.data?.description || item.data?.sub || item.data?.category || 'Entry'}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          {formatAmt(item.data?.amount)} {currency} · {item.data?.date}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRestoreTrash(item.trashId)}
                        className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 shrink-0"
                        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                      >
                        <RotateCcw size={12} />
                        <span>Restore</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-PAGE 7: ABOUT & UPDATES */}
          {settingsPage === 'about' && (
            <div className="space-y-3.5">
              <h2 className="font-display text-[18px] font-bold">About & Updates</h2>

              <div className="surface-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Smartphone size={16} />
                    </div>
                    <div className="text-[14px] font-bold">Credit Card Expenses</div>
                  </div>
                  <span
                    className="px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    v{APP_VERSION}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    toast.info('Updating app…');
                    hardReload(() => vault.stashForReload());
                  }}
                  className="w-full py-2.5 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  <RefreshCw size={13} />
                  <span>Update app now</span>
                </button>

                <div className="flex items-start gap-1.5 text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  <Info size={12} className="shrink-0 mt-0.5" />
                  <span>{getFitInfo() || `${window.innerWidth}×${window.innerHeight}`}</span>
                </div>
              </div>

              {!isDemo && !isViewer && (
                <div className="surface-card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor:
                            scriptVersion && scriptVersion < SCRIPT_LATEST
                              ? 'rgba(245, 158, 11, 0.16)'
                              : 'rgba(16, 185, 129, 0.14)',
                          color: scriptVersion && scriptVersion < SCRIPT_LATEST ? '#F59E0B' : '#10B981',
                        }}
                      >
                        <CloudUpload size={16} />
                      </div>
                      <div className="text-[14px] font-bold">Google Sheet script</div>
                    </div>
                    <span
                      className="px-2.5 py-0.5 rounded-full text-[11px] font-bold"
                      style={{
                        backgroundColor: 'var(--bg-pill)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      {scriptVersion ? `v${scriptVersion}` : '?'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[12px]">
                    <span style={{ color: 'var(--text-secondary)' }}>Status</span>
                    <span className="font-semibold">
                      {scriptVersion === undefined
                        ? 'Checking at next sync'
                        : state.scriptLoader
                          ? 'Updates automatically'
                          : !scriptVersion
                            ? 'Older script without self-update'
                            : scriptVersion >= SCRIPT_LATEST
                              ? 'Up to date'
                              : `v${scriptVersion} installed — v${SCRIPT_LATEST} available`}
                    </span>
                  </div>

                  {scriptVersion && scriptVersion < SCRIPT_LATEST && !state.scriptLoader && (
                    <button
                      type="button"
                      disabled={updatingScript}
                      onClick={handleUpdateScript}
                      className="w-full py-2.5 rounded-xl text-[12px] font-bold bg-amber-500 text-slate-950 disabled:opacity-60"
                    >
                      {updatingScript ? 'Updating script…' : 'Update the sheet script now'}
                    </button>
                  )}
                </div>
              )}

              <div className="surface-card p-4 space-y-2.5">
                <button
                  type="button"
                  onClick={switchToClassicUi}
                  className="w-full py-2.5 px-3 rounded-xl border text-[12px] font-semibold inline-flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: 'var(--bg-pill)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <ExternalLink size={13} />
                  <span>Open classic app</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const url = 'https://cc-expenses.pages.dev/setup';
                    navigator.clipboard?.writeText(url).catch(() => {});
                    toast.success('Setup guide link copied');
                  }}
                  className="w-full py-2.5 px-3 rounded-xl border text-[12px] font-semibold inline-flex items-center justify-center gap-1.5"
                  style={{
                    backgroundColor: 'var(--bg-pill)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <Share2 size={13} />
                  <span>Share the setup guide</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!armedDisconnect) {
                      setArmedDisconnect(true);
                      return;
                    }
                    setArmedDisconnect(false);
                    onDisconnect();
                  }}
                  className={`w-full py-2.5 px-3 rounded-xl border text-[12px] font-bold transition-colors ${
                    armedDisconnect ? 'bg-rose-500 text-white border-rose-500' : 'text-rose-500'
                  }`}
                  style={
                    armedDisconnect
                      ? undefined
                      : { backgroundColor: 'rgba(244, 63, 94, 0.08)', borderColor: 'rgba(244, 63, 94, 0.25)' }
                  }
                >
                  {armedDisconnect
                    ? 'Tap again to confirm'
                    : isViewer
                      ? 'Leave view-only mode'
                      : isDemo
                        ? 'Exit demo'
                        : 'Disconnect this device'}
                </button>
                {armedDisconnect && (
                  <button
                    type="button"
                    onClick={() => setArmedDisconnect(false)}
                    className="w-full py-1 text-[11px] font-semibold"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Import Preview Modal */}
      <AnimatePresence>
        {importPreview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div
              className="w-full max-w-[380px] rounded-[24px] border p-4 space-y-3 shadow-2xl"
              style={{ backgroundColor: 'var(--bg-sheet)', borderColor: 'var(--border-strong)' }}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-[15px] font-bold">Import from {importPreview.kind}</h3>
                <button type="button" onClick={() => setImportPreview(null)} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--bg-pill)' }}>
                  <X size={14} />
                </button>
              </div>
              <div className="text-[12px] truncate" style={{ color: 'var(--text-secondary)' }}>{importPreview.name}</div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-xl" style={{ backgroundColor: 'var(--bg-pill)' }}>
                  <div className="text-[16px] font-extrabold">{importPreview.fresh.length}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>New</div>
                </div>
                <div className="p-2 rounded-xl" style={{ backgroundColor: 'var(--bg-pill)' }}>
                  <div className="text-[16px] font-extrabold">{importPreview.dupes}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Existing</div>
                </div>
                <div className="p-2 rounded-xl" style={{ backgroundColor: 'var(--bg-pill)' }}>
                  <div className="text-[16px] font-extrabold">{importPreview.skipped.length}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Skipped</div>
                </div>
              </div>
              {importPreview.fixable > 0 && (
                <label className="flex items-center gap-2 text-[12px]">
                  <input
                    type="checkbox"
                    checked={importPreview.createMissing}
                    onChange={(e) =>
                      computeImport(importPreview.res, importPreview.name, importPreview.kind, e.target.checked)
                    }
                  />
                  <span>Create {importPreview.fixable} missing categories/sub-categories</span>
                </label>
              )}
              <button
                type="button"
                disabled={!importPreview.fresh.length}
                onClick={handleConfirmImport}
                className="w-full py-3 rounded-xl text-[13px] font-bold disabled:opacity-40"
                style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
              >
                Import {importPreview.fresh.length} transactions
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Account Modal */}
      <AnimatePresence>
        {deleteAccState && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div
              className="w-full max-w-[360px] rounded-[24px] border p-4 space-y-3 shadow-2xl"
              style={{ backgroundColor: 'var(--bg-sheet)', borderColor: 'var(--border-strong)' }}
            >
              <h3 className="font-display text-[15px] font-bold">Delete &ldquo;{deleteAccState.name}&rdquo;</h3>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'keep', label: 'Move entries' },
                  { id: 'delete', label: 'Delete all' },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDeleteAccState((s) => ({ ...s, mode: m.id }))}
                    className="py-2 rounded-xl text-[12px] font-semibold border"
                    style={{
                      backgroundColor: deleteAccState.mode === m.id ? 'var(--accent)' : 'var(--bg-pill)',
                      color: deleteAccState.mode === m.id ? 'var(--accent-fg)' : 'var(--text-primary)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {deleteAccState.mode === 'keep' && (
                <select
                  value={deleteAccState.to}
                  onChange={(e) => setDeleteAccState((s) => ({ ...s, to: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px]"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                >
                  {allAccounts.filter((a) => a.name !== deleteAccState.name).map((a) => (
                    <option key={a.name} value={a.name} style={{ color: '#000' }}>
                      Move to {a.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDeleteAccState(null)}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const dropIds = new Set();
                    if (deleteAccState.mode === 'delete') {
                      for (const e of allEntries) {
                        if (e.account === deleteAccState.name) dropIds.add(e.id);
                      }
                    }
                    store.deleteAccount(deleteAccState.name, deleteAccState.to, dropIds);
                    setDeleteAccState(null);
                    toast.success('Account removed');
                  }}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-bold bg-rose-500 text-white"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* PIN Setup / Ask Modal */}
      <AnimatePresence>
        {pinModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <form
              onSubmit={handlePinSubmit}
              className="w-full max-w-[340px] rounded-[24px] border p-4 space-y-3 shadow-2xl"
              style={{ backgroundColor: 'var(--bg-sheet)', borderColor: 'var(--border-strong)' }}
            >
              <h3 className="font-display text-[15px] font-bold">
                {pinModal.mode === 'ask' ? 'Enter current PIN' : pinModal.mode === 'change' ? 'Change PIN' : 'Set PIN (4–8 digits)'}
              </h3>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="PIN"
                value={pinValue}
                onChange={(e) => setPinValue(e.target.value)}
                autoFocus
                className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
                style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
              />
              {pinModal.mode !== 'ask' && (
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={8}
                  placeholder="Repeat PIN"
                  value={pinConfirm}
                  onChange={(e) => setPinConfirm(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (pinModal.mode === 'ask') pinModal.resolve?.(null);
                    setPinModal(null);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-bold"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  Confirm
                </button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>

      {/* Vault Passphrase Modal */}
      <AnimatePresence>
        {vaultModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <form
              onSubmit={handleVaultSubmit}
              className="w-full max-w-[350px] rounded-[24px] border p-4 space-y-3 shadow-2xl"
              style={{ backgroundColor: 'var(--bg-sheet)', borderColor: 'var(--border-strong)' }}
            >
              <h3 className="font-display text-[15px] font-bold">
                {vaultModal === 'off' ? 'Turn off encryption' : vaultModal === 'change' ? 'Change passphrase' : 'Set encryption passphrase'}
              </h3>
              {(vaultModal === 'off' || vaultModal === 'change') && (
                <input
                  type="password"
                  placeholder="Current passphrase"
                  value={vaultCurPass}
                  onChange={(e) => setVaultCurPass(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
                  style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                />
              )}
              {vaultModal !== 'off' && (
                <>
                  <input
                    type="password"
                    placeholder="New passphrase (8+ characters)"
                    value={vaultNewPass}
                    onChange={(e) => setVaultNewPass(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  />
                  <input
                    type="password"
                    placeholder="Repeat passphrase"
                    value={vaultConfirmPass}
                    onChange={(e) => setVaultConfirmPass(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border bg-transparent text-[16px] outline-none"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  />
                </>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setVaultModal(null)}
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold border"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl text-[12px] font-bold"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  Save
                </button>
              </div>
            </form>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
