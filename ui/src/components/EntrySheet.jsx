import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useDragControls } from 'motion/react';
import NumberFlow from '@number-flow/react';
import {
  X,
  Delete,
  Check,
  Sparkles,
  Calendar,
  MapPin,
  Plus,
  Copy,
  Trash2,
  ArrowLeft,
  Mic,
  ClipboardPaste,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatAmt, formatEGP, safeEvalMath } from '../lib/helpers';
import {
  FUEL_BIG_FILL,
  holdMic,
  parseMessages,
  scheduleMicRelease,
  store,
  suggestNote,
  util,
} from '../lib/bridge';
import CategoryIcon from './CategoryIcon';
import SlidingHighlight from './SlidingHighlight';

const SpeechRec =
  typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

const MIC_ERRORS = {
  'not-allowed': 'Microphone access is off for this app. Use your keyboard microphone instead.',
  'service-not-allowed': 'Voice input is unavailable in this web view. Use keyboard dictation instead.',
  'no-speech': 'Did not hear anything. Tap Speak and try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Voice input needs an internet connection.',
};

export default function EntrySheet({
  open,
  onClose,
  editingTx,
  initialQuickText = '',
  activeAccount,
  accounts = [],
  categories = { order: [], map: {} },
  allEntries = [],
  fuelCutoff = FUEL_BIG_FILL,
  currency = 'EGP',
  locCapture = true,
  voiceLang = 'ar-EG',
  onSaveTx,
  onAddMultipleTx,
  onDuplicateTx,
  onDeleteTx,
}) {
  const dragControls = useDragControls();
  const recRef = useRef(null);

  const [mode, setMode] = useState('keypad'); // 'keypad' | 'details' | 'calendar' | 'quick'
  const [isEditingLatched, setIsEditingLatched] = useState(false);
  const [latchedEditingTx, setLatchedEditingTx] = useState(null);

  const [txType, setTxType] = useState('expense');
  const [expr, setExpr] = useState('0');
  const [category, setCategory] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [account, setAccount] = useState('');
  const [date, setDate] = useState(util.todayStr());
  const [seller, setSeller] = useState('');
  const [placeText, setPlaceText] = useState('');
  const [locationRaw, setLocationRaw] = useState('');
  const [note, setNote] = useState('');
  const [noteEdited, setNoteEdited] = useState(false);
  const [suggestedReason, setSuggestedReason] = useState('');

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [addingSub, setAddingSub] = useState(false);
  const [newSubName, setNewSubName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Quick Add state
  const [quickText, setQuickText] = useState('');
  const [selectedQuickIdx, setSelectedQuickIdx] = useState([]);
  const [listening, setListening] = useState(false);

  // Calendar month
  const [calMonth, setCalMonth] = useState(util.currentKey());

  const today = util.todayStr();
  const yesterday = util.shiftDate(today, -1);

  const stopMic = () => {
    if (recRef.current) {
      try { recRef.current.stop(); } catch { /* ignore */ }
      recRef.current = null;
    }
    setListening(false);
    scheduleMicRelease();
  };

  useEffect(() => {
    if (!open) {
      stopMic();
      return;
    }
    setConfirmDelete(false);
    setAddingCat(false);
    setNewCatName('');
    setAddingSub(false);
    setNewSubName('');
    setSuggestedReason('');
    const defCat = categories.order[0] || '';
    const defSub = (categories.map[defCat] || [])[0] || '';
    const defAcc =
      activeAccount && activeAccount !== 'all' && accounts.some((a) => a.name === activeAccount)
        ? activeAccount
        : accounts[0]?.name || '';

    setIsEditingLatched(Boolean(editingTx));
    setLatchedEditingTx(editingTx || null);

    if (editingTx) {
      setMode('details');
      setTxType(editingTx.type === 'income' ? 'income' : 'expense');
      setExpr(String(editingTx.amount));
      setCategory(editingTx.category || defCat);
      setSubCategory(editingTx.subCategory || editingTx.sub || '');
      setAccount(editingTx.account || defAcc);
      setDate(editingTx.date || today);
      setCalMonth((editingTx.date || today).slice(0, 7));
      setSeller(editingTx.seller || '');
      const parsedL = util.parseLoc(editingTx.locationRaw);
      setPlaceText(parsedL?.place || '');
      setLocationRaw(editingTx.locationRaw || '');
      setNote(editingTx.note || editingTx.description || '');
      setNoteEdited(true);
    } else if (initialQuickText) {
      setMode('quick');
      setTxType('expense');
      setExpr('0');
      setCategory(defCat);
      setSubCategory(defSub);
      setAccount(defAcc);
      setDate(today);
      setCalMonth(today.slice(0, 7));
      setSeller('');
      setPlaceText('');
      setLocationRaw('');
      setNote('');
      setNoteEdited(false);
      setQuickText(initialQuickText);
    } else {
      setMode('keypad');
      setTxType('expense');
      setExpr('0');
      setCategory(defCat);
      setSubCategory(defSub);
      setAccount(defAcc);
      setDate(today);
      setCalMonth(today.slice(0, 7));
      setSeller('');
      setPlaceText('');
      setLocationRaw('');
      setNote('');
      setNoteEdited(false);
      setQuickText('');
    }
  }, [open, editingTx, initialQuickText]);

  const evaluatedAmount = useMemo(() => safeEvalMath(expr), [expr]);
  const hasOperator = /[+\-×÷*/]/.test(expr.slice(1));

  // Real smart note suggestion (Fuel Haval/Verna + merchant history via quick.js)
  useEffect(() => {
    if (!open || noteEdited || isEditingLatched || txType !== 'expense') {
      setSuggestedReason('');
      return;
    }
    const rawHistory = allEntries.map((e) => e.raw || {
      type: e.type === 'income' ? 'Income' : 'Expense',
      seller: e.seller,
      amount: e.amount,
      sub: e.subCategory,
      description: e.note,
    });
    const sug = suggestNote(
      { seller, amount: evaluatedAmount, sub: subCategory, fuelCutoff },
      rawHistory
    );
    if (sug) {
      setNote(sug.note);
      setSuggestedReason(sug.why || '');
    } else {
      setSuggestedReason('');
    }
  }, [open, noteEdited, isEditingLatched, txType, subCategory, seller, evaluatedAmount, fuelCutoff, allEntries]);

  const catNames = categories.order || [];
  const subList = (category && categories.map[category]) || [];

  const handleTypeSwitch = (nextType) => {
    setTxType(nextType);
    if (nextType === 'expense' && !category && catNames.length) {
      setCategory(catNames[0]);
      setSubCategory((categories.map[catNames[0]] || [])[0] || '');
    }
  };

  const handleKeyPress = (key) => {
    util.haptic(6);
    if (key === 'back') {
      setExpr((prev) => (prev.length <= 1 ? '0' : prev.slice(0, -1)));
      return;
    }
    if (['+', '-', '×', '÷'].includes(key)) {
      setExpr((prev) => {
        if (['+', '-', '×', '÷'].includes(prev.slice(-1))) {
          return prev.slice(0, -1) + key;
        }
        return prev + key;
      });
      return;
    }
    if (key === '.') {
      const parts = expr.split(/[+\-×÷]/);
      if (parts[parts.length - 1].includes('.')) return;
      setExpr((prev) => prev + '.');
      return;
    }
    setExpr((prev) => (prev === '0' ? key : prev + key));
  };

  const handleUseMyLocation = async () => {
    util.resetGeoDenied();
    toast('Finding your location…');
    const fix = await util.currentLoc(10000);
    if (!fix) {
      toast.error('Could not get your location');
      return;
    }
    const combined = util.fmtLoc({ ...fix, place: placeText.trim() });
    setLocationRaw(combined);
    util.haptic(8);
    toast.success('Location attached');
  };

  const handlePlaceChange = (val) => {
    setPlaceText(val);
    const cur = util.parseLoc(locationRaw);
    setLocationRaw(
      util.fmtLoc({
        place: val,
        ...(cur && Number.isFinite(cur.lat) ? { lat: cur.lat, lon: cur.lon } : {}),
      })
    );
  };

  const handleSave = (e) => {
    if (e) e.preventDefault();
    if (evaluatedAmount <= 0) {
      toast.error(`Amount must be greater than 0 ${currency}`);
      return;
    }
    if (txType === 'expense' && (!category || !subCategory)) {
      toast.error('Pick a category and sub-category');
      return;
    }
    const targetTx = editingTx || latchedEditingTx;
    const isInc = txType === 'income';
    const finalLoc = locationRaw || (placeText.trim() ? util.fmtLoc({ place: placeText.trim() }) : '');
    onSaveTx({
      id: targetTx?.id,
      type: isInc ? 'Income' : 'Expense',
      amount: Math.round(evaluatedAmount * 100) / 100,
      account: account || accounts[0]?.name || '',
      category: isInc ? 'Income' : category,
      sub: isInc ? 'Income' : subCategory,
      seller: seller.trim() || undefined,
      date,
      description: note.trim() || seller.trim() || '',
      location: finalLoc || undefined,
      shouldAutoLocate: !targetTx && !finalLoc && locCapture,
    });
    onClose();
  };

  const handleAddCatSubmit = () => {
    const err = store.nameError(newCatName, catNames, ['Income', 'Categories']);
    if (err) {
      toast.error(err);
      return;
    }
    const added = store.addCategory(newCatName);
    setCategory(added);
    setSubCategory('');
    setNewCatName('');
    setAddingCat(false);
    toast.success(`Added category "${added}"`);
  };

  const handleAddSubSubmit = () => {
    if (!category) return;
    const err = store.nameError(newSubName, subList);
    if (err) {
      toast.error(err);
      return;
    }
    const added = store.addSub(category, newSubName);
    setSubCategory(added);
    setNewSubName('');
    setAddingSub(false);
    toast.success(`Added "${added}"`);
  };

  // Calendar grid generation
  const calendarDays = useMemo(() => {
    const [y, m] = calMonth.split('-').map(Number);
    const firstWeekday = new Date(y, m - 1, 1).getDay();
    const totalDays = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstWeekday; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) {
      cells.push(`${calMonth}-${String(d).padStart(2, '0')}`);
    }
    return {
      label: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      cells,
    };
  }, [calMonth]);

  const shiftCal = (delta) => {
    const [y, m] = calMonth.split('-').map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    setCalMonth(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`);
  };

  // REAL Quick Add parsing via js/quick.js
  const parsedQuickItems = useMemo(() => {
    if (!quickText.trim()) return [];
    const rawHistory = allEntries.map((e) => e.raw || {
      date: e.date,
      type: e.type === 'income' ? 'Income' : 'Expense',
      amount: e.amount,
      category: e.category,
      sub: e.subCategory,
      seller: e.seller,
      description: e.note,
    });
    return parseMessages(quickText, {
      today,
      categories,
      accounts,
      history: rawHistory,
      fuelCutoff,
    });
  }, [quickText, today, categories, accounts, allEntries, fuelCutoff]);

  useEffect(() => {
    setSelectedQuickIdx(
      parsedQuickItems
        .map((r, i) => (r.ready ? i : -1))
        .filter((i) => i >= 0)
    );
  }, [parsedQuickItems]);

  const canQuickAddRow = (r) =>
    Boolean(r.amount) && (r.currency === 'EGP' || !r.currency || r.currency === currency) && (r.type === 'Income' || (r.category && r.sub));

  const readySelectedRows = selectedQuickIdx
    .map((i) => parsedQuickItems[i])
    .filter((r) => r && canQuickAddRow(r));

  const handlePasteQuick = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (!txt || !txt.trim()) {
        toast.info('Clipboard is empty');
        return;
      }
      setQuickText((prev) => (prev.trim() ? `${prev.replace(/\s+$/, '')}\n\n${txt.trim()}` : txt.trim()));
    } catch {
      toast.error('Long-press inside the box and tap Paste');
    }
  };

  const handleMic = async () => {
    if (!SpeechRec) return;
    if (listening) {
      stopMic();
      return;
    }
    setListening(true);
    await holdMic();
    try {
      const r = new SpeechRec();
      r.lang = voiceLang;
      r.interimResults = true;
      r.continuous = false;
      const base = quickText.trim() ? `${quickText.replace(/\s+$/, '')} ` : '';
      r.onresult = (ev) => {
        let t = '';
        for (let i = 0; i < ev.results.length; i++) {
          t += (i ? ' ' : '') + ev.results[i][0].transcript.trim();
        }
        setQuickText(base + t);
      };
      r.onerror = (ev) => {
        toast.error(MIC_ERRORS[ev.error] || 'Voice input stopped');
        setListening(false);
      };
      r.onend = () => {
        recRef.current = null;
        setListening(false);
        scheduleMicRelease();
      };
      recRef.current = r;
      r.start();
      util.haptic(8);
    } catch {
      setListening(false);
      toast.error(MIC_ERRORS['service-not-allowed']);
    }
  };

  const headerTitle =
    mode === 'calendar'
      ? 'Select Date'
      : mode === 'quick'
        ? 'Quick Add'
        : isEditingLatched
          ? 'Edit Transaction'
          : 'New Transaction';

  const showBackButton = mode === 'calendar' || (mode === 'details' && !isEditingLatched);
  const handleBack = () => {
    if (mode === 'calendar') setMode('details');
    else if (mode === 'details' && !isEditingLatched) setMode('keypad');
  };

  const activeEditTarget = editingTx || (isEditingLatched ? latchedEditingTx : null);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end items-center pointer-events-auto">
          {/* Sibling 1: Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-0 bg-black/55 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Sibling 2: Solid Sheet slides up/down cleanly inside centered 480px column */}
          <motion.div
            initial={{ y: '105%' }}
            animate={{ y: 0 }}
            exit={{ y: '105%' }}
            transition={{ duration: 0.38, ease: [0.32, 0.72, 0, 1] }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.06, bottom: 0.65 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 95 || info.velocity.y > 420) onClose();
            }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-[480px] max-h-[90%] rounded-t-[30px] border-t flex flex-col overflow-hidden shadow-2xl"
            style={{
              backgroundColor: 'var(--bg-sheet)',
              borderColor: 'var(--border-strong)',
            }}
          >
            {/* Drag Handle + Header (ONLY top strip initiates drag) */}
            <div
              onPointerDown={(e) => {
                if (!e.target.closest('button')) dragControls.start(e);
              }}
              className="sheet-top px-4 pt-2.5 pb-2.5 border-b shrink-0 touch-none select-none cursor-grab active:cursor-grabbing"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="w-10 h-1 rounded-full mx-auto mb-2.5"
                style={{ backgroundColor: 'var(--border-strong)' }}
              />
              <div className="grid grid-cols-[72px_1fr_72px] items-center gap-2">
                <div className="flex items-center">
                  {showBackButton && (
                    <button
                      type="button"
                      onClick={handleBack}
                      className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1 rounded-full active:scale-95 transition-transform"
                      style={{ backgroundColor: 'var(--bg-pill)', color: 'var(--text-primary)' }}
                    >
                      <ArrowLeft size={13} />
                      <span>Back</span>
                    </button>
                  )}
                </div>

                <h3
                  className="font-display text-[15px] font-bold text-center truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {headerTitle}
                </h3>

                <div className="flex items-center justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
                    style={{ backgroundColor: 'var(--bg-pill)', color: 'var(--text-secondary)' }}
                    aria-label="Close sheet"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            </div>

            {/* Body */}
            <div
              className={`flex-1 min-h-0 overflow-y-auto px-4 py-3 ${
                mode === 'calendar' ? 'pb-[max(20px,var(--safe-b,env(safe-area-inset-bottom)))]' : ''
              }`}
            >
              {/* MODE 1: KEYPAD */}
              {mode === 'keypad' && (
                <div className="space-y-3">
                  <SlidingHighlight
                    activeKey={txType}
                    onSelect={handleTypeSwitch}
                    activeTextColor="#FFFFFF"
                    className="grid grid-cols-2 p-1 rounded-2xl border max-w-[230px] mx-auto"
                    style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                    pillClassName="rounded-[11px]"
                    pillStyle={{
                      backgroundColor: txType === 'income' ? 'var(--positive)' : 'var(--accent)',
                    }}
                  >
                    {[
                      { id: 'expense', label: 'Expense' },
                      { id: 'income', label: 'Income' },
                    ].map((t) => {
                      const active = txType === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          data-hl={t.id}
                          onClick={() => handleTypeSwitch(t.id)}
                          className="relative py-1.5 text-[12px] font-bold rounded-[11px] z-10 transition-colors"
                          style={{ color: active ? '#FFFFFF' : 'var(--text-secondary)' }}
                        >
                          {t.label}
                        </button>
                      );
                    })}
                  </SlidingHighlight>

                  <div className="py-2 text-center">
                    <div className="h-5 text-[13px] font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {hasOperator ? expr : 'Enter amount or math (e.g. 900 ÷ 3)'}
                    </div>
                    <div className="inline-flex items-baseline gap-1.5 mt-1 px-4 py-1 rounded-2xl">
                      <span
                        className="font-display text-[42px] font-extrabold leading-none tabular-nums"
                        style={{
                          color: txType === 'income' ? 'var(--positive)' : 'var(--text-primary)',
                        }}
                      >
                        <NumberFlow value={evaluatedAmount} format={{ maximumFractionDigits: 2 }} />
                      </span>
                      <span className="text-[14px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                        {currency}
                      </span>
                    </div>
                  </div>

                  {/* Tactile Calculator Keypad */}
                  <div className="grid grid-cols-4 gap-2 pt-1">
                    {[
                      '7', '8', '9', '÷',
                      '4', '5', '6', '×',
                      '1', '2', '3', '-',
                      '.', '0', 'back', '+',
                    ].map((k) => {
                      const isOp = ['÷', '×', '-', '+'].includes(k);
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => handleKeyPress(k)}
                          className="h-12 rounded-2xl text-[18px] font-bold flex items-center justify-center border active:scale-95 transition-transform"
                          style={{
                            backgroundColor: isOp ? 'var(--accent-soft)' : 'var(--bg-card)',
                            borderColor: 'var(--border-subtle)',
                            color: isOp ? 'var(--accent)' : 'var(--text-primary)',
                          }}
                        >
                          {k === 'back' ? <Delete size={18} /> : k}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* MODE 2: DETAILS */}
              {mode === 'details' && (
                <form id="entry-details-form" onSubmit={handleSave} className="space-y-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setMode('keypad')}
                      className="inline-flex items-baseline gap-1.5 px-3.5 py-2 rounded-2xl border active:scale-95 transition-transform"
                      style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-strong)' }}
                    >
                      <span
                        className="font-display text-[24px] font-extrabold tabular-nums"
                        style={{ color: txType === 'income' ? 'var(--positive)' : 'var(--text-primary)' }}
                      >
                        <NumberFlow value={evaluatedAmount} format={{ maximumFractionDigits: 2 }} />
                      </span>
                      <span className="text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
                        {currency} · Tap to edit
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        handleTypeSwitch(txType === 'expense' ? 'income' : 'expense')
                      }
                      className="px-3 py-1.5 rounded-full text-[11px] font-bold border"
                      style={{
                        backgroundColor:
                          txType === 'income' ? 'rgba(16,185,129,0.16)' : 'var(--bg-pill)',
                        borderColor: 'var(--border-subtle)',
                        color: txType === 'income' ? 'var(--positive)' : 'var(--text-primary)',
                      }}
                    >
                      {txType === 'income' ? 'Income' : 'Expense'}
                    </button>
                  </div>

                  {/* Category & Sub-category (Expenses only) */}
                  {txType === 'expense' && (
                    <>
                      <div>
                        <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                          Category
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {catNames.map((cat) => {
                            const active = category === cat;
                            return (
                              <button
                                key={cat}
                                type="button"
                                onClick={() => {
                                  setCategory(cat);
                                  const subs = categories.map[cat] || [];
                                  setSubCategory(subs[0] || '');
                                }}
                                className="px-3 py-1.5 rounded-full text-[12px] font-semibold border transition-colors"
                                style={{
                                  backgroundColor: active ? 'var(--accent)' : 'var(--bg-pill)',
                                  borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                                  color: active ? 'var(--accent-fg)' : 'var(--text-primary)',
                                }}
                              >
                                {cat}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            onClick={() => setAddingCat((v) => !v)}
                            className="inline-flex items-center gap-0.5 px-2.5 py-1.5 rounded-full text-[11px] font-bold border"
                            style={{
                              backgroundColor: 'var(--bg-pill)',
                              borderColor: 'var(--border-strong)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <Plus size={11} />
                            <span>New</span>
                          </button>
                        </div>
                        {addingCat && (
                          <div className="flex gap-1.5 mt-2">
                            <input
                              type="text"
                              value={newCatName}
                              onChange={(e) => setNewCatName(e.target.value)}
                              placeholder="New category name…"
                              className="flex-1 px-3 py-1.5 rounded-xl border bg-transparent text-[16px] outline-none"
                              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                            />
                            <button
                              type="button"
                              onClick={handleAddCatSubmit}
                              className="px-3 py-1.5 rounded-xl text-[12px] font-bold"
                              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                          Sub-category
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {subList.map((sub) => {
                            const active = subCategory === sub;
                            return (
                              <button
                                key={sub}
                                type="button"
                                onClick={() => setSubCategory(sub)}
                                className="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                                style={{
                                  backgroundColor: active ? 'var(--accent-soft)' : 'var(--bg-card)',
                                  borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                                }}
                              >
                                {sub}
                              </button>
                            );
                          })}

                          <button
                            type="button"
                            onClick={() => setAddingSub((v) => !v)}
                            className="inline-flex items-center gap-0.5 px-2.5 py-1 rounded-full text-[11px] font-bold border"
                            style={{
                              backgroundColor: 'var(--bg-pill)',
                              borderColor: 'var(--border-strong)',
                              color: 'var(--text-primary)',
                            }}
                          >
                            <Plus size={11} />
                            <span>New</span>
                          </button>
                        </div>

                        {addingSub && (
                          <div className="flex gap-1.5 mt-2">
                            <input
                              type="text"
                              value={newSubName}
                              onChange={(e) => setNewSubName(e.target.value)}
                              placeholder="Custom sub-category…"
                              className="flex-1 px-3 py-1.5 rounded-xl border bg-transparent text-[16px] outline-none"
                              style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                            />
                            <button
                              type="button"
                              onClick={handleAddSubSubmit}
                              className="px-3 py-1.5 rounded-xl text-[12px] font-bold"
                              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                            >
                              Add
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Date Pills + Calendar Trigger */}
                  <div>
                    <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                      Date
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: 'Today', val: today },
                        { label: 'Yesterday', val: yesterday },
                      ].map((d) => {
                        const active = date === d.val;
                        return (
                          <button
                            key={d.val}
                            type="button"
                            onClick={() => setDate(d.val)}
                            className="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
                            style={{
                              backgroundColor: active ? 'var(--accent)' : 'var(--bg-pill)',
                              borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                              color: active ? 'var(--accent-fg)' : 'var(--text-primary)',
                            }}
                          >
                            {d.label}
                          </button>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => setMode('calendar')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold border"
                        style={{
                          backgroundColor:
                            date !== today && date !== yesterday ? 'var(--accent)' : 'var(--bg-pill)',
                          borderColor: 'var(--border-subtle)',
                          color:
                            date !== today && date !== yesterday
                              ? 'var(--accent-fg)'
                              : 'var(--text-primary)',
                        }}
                      >
                        <Calendar size={12} />
                        <span>{date}</span>
                      </button>
                    </div>
                  </div>

                  {/* Account Chips */}
                  {accounts.length > 1 && (
                    <div>
                      <div className="text-[11px] font-bold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
                        Account
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {accounts.map((acc) => {
                          const active = account === acc.name;
                          return (
                            <button
                              key={acc.name}
                              type="button"
                              onClick={() => setAccount(acc.name)}
                              className="py-2 px-3 rounded-xl text-[11px] font-bold border truncate"
                              style={{
                                backgroundColor: active ? acc.color : 'var(--bg-pill)',
                                borderColor: active ? acc.color : 'var(--border-subtle)',
                                color: active ? '#FFFFFF' : 'var(--text-primary)',
                              }}
                            >
                              {acc.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Seller & Note */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Seller
                      </label>
                      <input
                        type="text"
                        value={seller}
                        onChange={(e) => setSeller(e.target.value)}
                        placeholder="e.g. Mobil, Cilantro"
                        className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Note
                      </label>
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setNoteEdited(true);
                        }}
                        placeholder="Optional note"
                        className="w-full px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  </div>
                  {suggestedReason && (
                    <div className="text-[11px]" style={{ color: 'var(--accent)' }}>
                      Suggested note ({suggestedReason})
                    </div>
                  )}

                  {/* Purchase Location Row */}
                  <div>
                    <div className="text-[11px] font-bold mb-1.5 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                      <MapPin size={11} />
                      <span>Location</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={placeText}
                        onChange={(e) => handlePlaceChange(e.target.value)}
                        placeholder="Place name (optional)"
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border bg-transparent text-[16px] outline-none"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}
                      />
                      <button
                        type="button"
                        onClick={handleUseMyLocation}
                        className="px-2.5 py-2 rounded-xl text-[11px] font-bold border shrink-0 inline-flex items-center gap-1"
                        style={{
                          backgroundColor: locationRaw ? 'var(--accent-soft)' : 'var(--bg-pill)',
                          borderColor: locationRaw ? 'var(--accent)' : 'var(--border-subtle)',
                          color: locationRaw ? 'var(--accent)' : 'var(--text-primary)',
                        }}
                      >
                        <MapPin size={12} />
                        <span>{locationRaw ? 'Pinned' : 'Use GPS'}</span>
                      </button>
                      {(locationRaw || placeText) && (
                        <button
                          type="button"
                          onClick={() => {
                            setLocationRaw('');
                            setPlaceText('');
                          }}
                          aria-label="Remove location"
                          className="p-2 rounded-xl border shrink-0"
                          style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Edit Mode: Duplicate & 2-Tap Delete */}
                  {activeEditTarget && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          onDuplicateTx(activeEditTarget);
                          onClose();
                        }}
                        className="py-2.5 rounded-xl text-[12px] font-bold border inline-flex items-center justify-center gap-1"
                        style={{
                          backgroundColor: 'var(--bg-pill)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Copy size={13} />
                        <span>Duplicate</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (!confirmDelete) {
                            setConfirmDelete(true);
                            setTimeout(() => setConfirmDelete(false), 3000);
                          } else {
                            onDeleteTx(activeEditTarget);
                            onClose();
                          }
                        }}
                        className="py-2.5 rounded-xl text-[12px] font-bold inline-flex items-center justify-center gap-1 text-white"
                        style={{ backgroundColor: confirmDelete ? '#DC2626' : '#F43F5E' }}
                      >
                        <Trash2 size={13} />
                        <span>{confirmDelete ? 'Confirm Delete?' : 'Delete'}</span>
                      </button>
                    </div>
                  )}
                </form>
              )}

              {/* MODE 3: CALENDAR PICKER */}
              {mode === 'calendar' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => shiftCal(-1)}
                      className="px-3 py-1 rounded-full text-[12px] font-semibold"
                      style={{ backgroundColor: 'var(--bg-pill)' }}
                    >
                      ‹ Prev
                    </button>
                    <span className="font-display text-[15px] font-bold">{calendarDays.label}</span>
                    <button
                      type="button"
                      onClick={() => shiftCal(1)}
                      className="px-3 py-1 rounded-full text-[12px] font-semibold"
                      style={{ backgroundColor: 'var(--bg-pill)' }}
                    >
                      Next ›
                    </button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
                      <div key={w} className="py-1">{w}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {calendarDays.cells.map((iso, idx) => {
                      if (!iso) return <div key={`empty-${idx}`} />;
                      const selected = date === iso;
                      const dayNum = Number(iso.slice(8, 10));
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => {
                            setDate(iso);
                            setMode('details');
                          }}
                          className="h-10 rounded-xl text-[13px] font-bold transition-colors"
                          style={{
                            backgroundColor: selected ? 'var(--accent)' : 'var(--bg-pill)',
                            color: selected ? 'var(--accent-fg)' : 'var(--text-primary)',
                          }}
                        >
                          {dayNum}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* MODE 4: REAL QUICK ADD (quick.js parseMessages) */}
              {mode === 'quick' && (
                <div className="space-y-3">
                  <textarea
                    rows={3}
                    value={quickText}
                    onChange={(e) => setQuickText(e.target.value)}
                    placeholder="Paste bank SMS, Arabic note (قهوة بخمسين وتاكسي بتمانين كاش), or type items…"
                    className="w-full p-3 rounded-2xl border bg-transparent text-[16px] outline-none resize-none"
                    style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handlePasteQuick}
                      className="px-3 py-1.5 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1.5"
                      style={{
                        backgroundColor: 'var(--bg-pill)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <ClipboardPaste size={12} />
                      <span>Paste</span>
                    </button>
                    {SpeechRec && (
                      <button
                        type="button"
                        onClick={handleMic}
                        className="px-3 py-1.5 rounded-full text-[11px] font-semibold border inline-flex items-center gap-1.5"
                        style={{
                          backgroundColor: listening ? 'var(--accent)' : 'var(--bg-pill)',
                          borderColor: listening ? 'var(--accent)' : 'var(--border-subtle)',
                          color: listening ? 'var(--accent-fg)' : 'var(--text-primary)',
                        }}
                      >
                        <Mic size={12} />
                        <span>{listening ? 'Listening…' : 'Speak'}</span>
                      </button>
                    )}
                  </div>

                  {/* Parsed Preview Cards */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                      Parsed Preview ({parsedQuickItems.length})
                    </div>
                    {parsedQuickItems.length === 0 ? (
                      <div className="p-4 rounded-2xl border text-center text-[12px]" style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}>
                        Paste a bank SMS or type something like &ldquo;coffee 45&rdquo;.
                      </div>
                    ) : (
                      parsedQuickItems.map((item, idx) => {
                        const checked = selectedQuickIdx.includes(idx);
                        const can = canQuickAddRow(item);
                        return (
                          <div
                            key={`${item.raw}-${idx}`}
                            className="p-2.5 rounded-2xl border flex items-center gap-2.5"
                            style={{ backgroundColor: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
                          >
                            <button
                              type="button"
                              disabled={!can}
                              onClick={() =>
                                setSelectedQuickIdx((prev) =>
                                  prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx]
                                )
                              }
                              className="w-5 h-5 rounded-full border flex items-center justify-center shrink-0 disabled:opacity-35"
                              style={{
                                backgroundColor: checked ? 'var(--accent)' : 'transparent',
                                borderColor: checked ? 'var(--accent)' : 'var(--border-strong)',
                                color: '#fff',
                              }}
                              aria-label="Toggle row"
                            >
                              {checked && <Check size={12} strokeWidth={3} />}
                            </button>

                            <CategoryIcon category={item.type === 'Income' ? 'Income' : item.category} />

                            <button
                              type="button"
                              onClick={() => {
                                // Load row into Details mode for category/note adjustment
                                setTxType(item.type === 'Income' ? 'income' : 'expense');
                                setExpr(String(item.amount || 0));
                                setCategory(item.category || categories.order[0] || '');
                                setSubCategory(item.sub || '');
                                setAccount(item.account || account);
                                setDate(item.date || today);
                                setSeller(item.seller || '');
                                setNote(item.description || '');
                                setNoteEdited(true);
                                if (item.location) setLocationRaw(item.location);
                                setMode('details');
                              }}
                              className="flex-1 min-w-0 text-left"
                            >
                              <div className="text-[13px] font-bold truncate">
                                {item.description || item.seller || 'Transaction'}
                              </div>
                              <div className="text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
                                {item.type === 'Income'
                                  ? 'Income'
                                  : item.category
                                    ? `${item.category} › ${item.sub}`
                                    : 'Tap to pick category'}{' '}
                                · {item.account}
                                {item.dup ? ' · Duplicate' : ''}
                              </div>
                            </button>

                            <div className="text-[14px] font-extrabold tabular-nums shrink-0">
                              {formatAmt(item.amount)} {item.currency || currency}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Bottom Bar — 4-col grid aligns Quick Add directly under operator column */}
            {mode !== 'calendar' && (
              <div
                className={`sheet-foot px-4 pt-2.5 border-t shrink-0 grid gap-2 ${
                  mode === 'details' && isEditingLatched ? 'grid-cols-1' : 'grid-cols-4'
                }`}
                style={{
                  borderColor: 'var(--border-subtle)',
                  backgroundColor: 'var(--bg-sheet)',
                  paddingBottom: 'max(16px, var(--safe-b, env(safe-area-inset-bottom)))',
                }}
              >
                {mode === 'keypad' && (
                  <>
                    <button
                      type="button"
                      onClick={() => setMode('details')}
                      className="col-span-3 py-3.5 rounded-2xl text-[14px] font-bold flex items-center justify-center gap-1.5 shadow-lg active:scale-[0.98] transition-transform"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      <Check size={16} strokeWidth={2.8} />
                      <span>Continue to Details</span>
                    </button>
                    {!isEditingLatched && (
                      <button
                        type="button"
                        onClick={() => setMode('quick')}
                        aria-label="Quick Add"
                        className="col-span-1 py-3.5 px-1 rounded-2xl text-[12px] font-bold border flex items-center justify-center gap-1 active:scale-[0.97] transition-transform"
                        style={{
                          backgroundColor: 'var(--bg-pill)',
                          borderColor: 'var(--border-strong)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                        <span>Quick</span>
                      </button>
                    )}
                  </>
                )}

                {mode === 'details' && (
                  <>
                    <button
                      type="button"
                      onClick={handleSave}
                      className={`${
                        isEditingLatched ? 'col-span-1' : 'col-span-3'
                      } py-3.5 rounded-2xl text-[14px] font-bold shadow-lg active:scale-[0.98] transition-transform`}
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      {isEditingLatched ? 'Save Changes' : 'Save Transaction'}
                    </button>
                    {!isEditingLatched && (
                      <button
                        type="button"
                        onClick={() => setMode('quick')}
                        aria-label="Quick Add"
                        className="col-span-1 py-3.5 px-1 rounded-2xl text-[12px] font-bold border flex items-center justify-center gap-1 active:scale-[0.97] transition-transform"
                        style={{
                          backgroundColor: 'var(--bg-pill)',
                          borderColor: 'var(--border-strong)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <Sparkles size={14} style={{ color: 'var(--accent)' }} />
                        <span>Quick</span>
                      </button>
                    )}
                  </>
                )}

                {mode === 'quick' && (
                  <>
                    <button
                      type="button"
                      disabled={readySelectedRows.length === 0}
                      onClick={() => {
                        const defAcc = accounts[0]?.name || '';
                        const mapped = readySelectedRows.map((r) => ({
                          date: r.date,
                          description: r.description || r.seller || '',
                          seller: r.seller || '',
                          amount: r.amount,
                          type: r.type,
                          category: r.type === 'Income' ? 'Income' : r.category,
                          sub: r.type === 'Income' ? 'Income' : r.sub,
                          account: r.account || defAcc,
                          location: r.location || '',
                        }));
                        onAddMultipleTx(mapped);
                        onClose();
                      }}
                      className="col-span-3 py-3.5 rounded-2xl text-[14px] font-bold shadow-lg disabled:opacity-40 active:scale-[0.98] transition-transform"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      Add Selected ({readySelectedRows.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMode('keypad')}
                      className="col-span-1 py-3.5 px-1 rounded-2xl text-[12px] font-bold border flex items-center justify-center active:scale-[0.97] transition-transform"
                      style={{
                        backgroundColor: 'var(--bg-pill)',
                        borderColor: 'var(--border-strong)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      Keypad
                    </button>
                  </>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
