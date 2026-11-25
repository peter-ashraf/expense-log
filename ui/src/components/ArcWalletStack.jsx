import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, animate } from 'motion/react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import {
  Sparkles,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  CalendarClock,
  CheckCircle2,
  ArrowLeft,
  Pencil,
} from 'lucide-react';
import { formatAmt } from '../lib/helpers';

const RATING_LIST = [
  { id: 'love', emoji: '🔥', short: 'Worth it', label: '🔥 Worth it' },
  { id: 'meh', emoji: '😐', short: 'Okay', label: '😐 Okay' },
  { id: 'sleep', emoji: '💤', short: 'Sleepy', label: '💤 Sleepy' },
];

const RATING_META = {
  love: RATING_LIST[0],
  meh: RATING_LIST[1],
  sleep: RATING_LIST[2],
};

const CLOSED_PEEK = 58;
const POCKET_PEEK = 50;
const CARD_SPRING = { type: 'spring', stiffness: 235, damping: 28, mass: 0.95 };
const STAGE_SPRING = { type: 'spring', stiffness: 230, damping: 29 };

function getPassFinish(sub) {
  const c = sub.color || '#6366F1';
  return {
    background: `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${c} 70%, #fff 30%) 0%, transparent 56%), linear-gradient(146deg, ${c} 0%, color-mix(in srgb, ${c} 54%, #000 46%) 100%)`,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    barColor: '#FFFFFF',
  };
}

function PassBrandBadge({ sub }) {
  return (
    <span
      className="w-[34px] h-[34px] rounded-[10px] bg-white/95 flex items-center justify-center shrink-0 shadow-sm"
      style={{ color: sub.color || '#4F46E5' }}
    >
      {sub.logo ? (
        <span
          aria-hidden="true"
          className="w-[18px] h-[18px] block"
          style={{
            backgroundColor: 'currentColor',
            WebkitMask: `url('icons/brands/${sub.logo}.svg') center / contain no-repeat`,
            mask: `url('icons/brands/${sub.logo}.svg') center / contain no-repeat`,
          }}
        />
      ) : (
        <span className="text-[14px] font-black leading-none">
          {(sub.name || '?').trim().charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}

function SubscriptionPassCard({ sub, currency = 'EGP', stackedIndex = 0, isOpen = false }) {
  const finish = getPassFinish(sub);
  const sheenRef = useRef(null);
  const ratingObj = RATING_META[sub.rating];
  const cyclePct = Math.max(
    8,
    Math.min(100, Math.round(((30 - Math.min(30, Math.max(0, sub.daysLeft))) / 30) * 100))
  );

  const handlePointerMove = (e) => {
    const el = sheenRef.current;
    if (!el) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.opacity = '1';
    el.style.background = `radial-gradient(220px circle at ${px.toFixed(1)}% ${py.toFixed(1)}%, rgba(255,255,255,0.2), transparent 64%)`;
  };

  const resetSheen = () => {
    if (sheenRef.current) sheenRef.current.style.opacity = '0';
  };

  const renewLabel = sub.paidThisMonth
    ? `Paid this month · Next ${sub.nextDate}`
    : sub.skippedThisMonth
      ? `Skipped · Next ${sub.nextDate}`
      : sub.daysLeft < 0
        ? `${-sub.daysLeft}d overdue (${sub.nextDate})`
        : sub.daysLeft === 0
          ? `Renews today (${sub.nextDate})`
          : `Renews in ${sub.daysLeft}d (${sub.nextDate})`;

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerLeave={resetSheen}
      onPointerCancel={resetSheen}
      style={{
        background: finish.background,
        borderColor: finish.borderColor,
        boxShadow: isOpen
          ? '0 22px 44px -12px rgba(0, 0, 0, 0.62), inset 0 1px 0 rgba(255, 255, 255, 0.28)'
          : `${stackedIndex > 0 ? '0 -8px 20px -4px rgba(0, 0, 0, 0.52), ' : ''}0 14px 28px -10px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.26)`,
      }}
      className="relative w-full h-full rounded-[20px] px-4 py-3 text-white border flex flex-col justify-between overflow-hidden select-none text-left"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-1/2 -left-1/4 -right-1/4 h-[82%] -rotate-6 opacity-25"
        style={{
          background: 'linear-gradient(175deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 64%)',
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 wcard-noise" />
      <div
        ref={sheenRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[20px] transition-opacity duration-200"
        style={{ opacity: 0 }}
      />

      {/* Crown Row */}
      <div className="relative z-10 flex items-center gap-2.5 min-h-[34px]">
        <PassBrandBadge sub={sub} />
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.11em] text-white/75 truncate leading-tight">
            {sub.account} · {sub.category || 'Subscription'}
          </div>
          <div className="text-[15px] font-extrabold leading-tight truncate text-white">
            {sub.name}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[16px] font-extrabold tabular-nums leading-tight text-white">
            {formatAmt(sub.amount)} <span className="text-[10px] font-semibold">/mo</span>
          </div>
        </div>
      </div>

      {/* Middle Row */}
      <div className="relative z-10 my-auto space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-white/90 truncate">{renewLabel}</span>
          {ratingObj && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/28 border border-white/20 text-white shrink-0">
              <span>{ratingObj.emoji}</span>
              <span>{ratingObj.short}</span>
            </span>
          )}
        </div>
        <div className="h-1.5 w-full rounded-full bg-black/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${cyclePct}%`, backgroundColor: finish.barColor }}
          />
        </div>
      </div>

      {/* Bottom Perforation Footer */}
      <div className="relative z-10 border-t border-white/15 pt-2 grid grid-cols-3 gap-2">
        <div>
          <div className="text-[8px] font-bold uppercase tracking-wider text-white/65">Account</div>
          <div className="text-[11px] font-bold truncate">{sub.account}</div>
        </div>
        <div className="text-center">
          <div className="text-[8px] font-bold uppercase tracking-wider text-white/65">Weekly</div>
          <div className="text-[11px] font-bold tabular-nums">
            {Math.round((sub.amount * 12) / 52)} {currency}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[8px] font-bold uppercase tracking-wider text-white/65">Annual</div>
          <div className="text-[11px] font-bold tabular-nums">
            {formatAmt(sub.amount * 12)} {currency}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ArcWalletStack({
  subscriptions = [],
  allEntries = [],
  currency = 'EGP',
  onRateSubscription,
  onLogSubPaid,
  onSkipSubMonth,
  onEditSub,
  focusedSubId,
  setFocusedSubId,
  isViewer = false,
}) {
  const headerRef = useRef(null);
  const stageRef = useRef(null);
  const panelInnerRef = useRef(null);
  const cardBtnRefs = useRef({});
  const openIdRef = useRef(null);
  const closingRef = useRef(false);
  const focusedSubIdRef = useRef(focusedSubId);
  focusedSubIdRef.current = focusedSubId;

  const deckDragRef = useRef({ active: false, pointerId: null, startY: 0, didDrag: false });
  const pullDismissRef = useRef({ active: false, pointerId: null, startY: 0, didDrag: false });
  const suppressClickRef = useRef(false);
  const lastPanelSubRef = useRef(null);

  const [orderIds, setOrderIds] = useState(() => subscriptions.map((s) => s.id));
  const [openId, setOpenId] = useState(null);
  const [fanExtra, setFanExtra] = useState(0);
  const [cardHeight, setCardHeight] = useState(222);
  const [panelHeight, setPanelHeight] = useState(260);
  const [announcement, setAnnouncement] = useState('');

  const dismissY = useMotionValue(0);

  useEffect(() => {
    setOrderIds((prev) => {
      const ids = subscriptions.map((s) => s.id);
      const idSet = new Set(ids);
      const kept = prev.filter((id) => idSet.has(id));
      const keptSet = new Set(kept);
      const added = ids.filter((id) => !keptSet.has(id));
      return added.length ? [...added, ...kept] : kept;
    });
  }, [subscriptions]);

  const orderedSubs = useMemo(() => {
    const map = new Map(subscriptions.map((s) => [s.id, s]));
    return orderIds.map((id) => map.get(id)).filter(Boolean);
  }, [subscriptions, orderIds]);

  const openIdx = openId ? orderedSubs.findIndex((s) => s.id === openId) : -1;
  const openSub = openIdx >= 0 ? orderedSubs[openIdx] : null;
  const isOpen = openSub !== null;

  if (openSub) {
    lastPanelSubRef.current = openSub;
  }
  const panelSub = openSub || lastPanelSubRef.current;

  // Real matching history for the opened subscription
  const billingHistory = useMemo(() => {
    if (!panelSub) return [];
    const nameLower = panelSub.name.trim().toLowerCase();
    return allEntries
      .filter((e) => e.type === 'expense' && e.title.trim().toLowerCase() === nameLower)
      .slice(0, 4);
  }, [panelSub, allEntries]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setCardHeight(Math.round(w / 1.586));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  useLayoutEffect(() => {
    const el = panelInnerRef.current;
    if (!el || !isOpen) return;
    const measurePanel = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (h > 40) setPanelHeight(h);
    };
    measurePanel();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measurePanel);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [isOpen, openId, openSub?.rating, billingHistory.length]);

  const openPass = (subId, { focusCard = false } = {}) => {
    const idx = orderedSubs.findIndex((s) => s.id === subId);
    if (idx < 0) return;
    closingRef.current = false;
    openIdRef.current = subId;
    setFanExtra(0);
    setOpenId(subId);
    dismissY.set(0);

    if (focusedSubIdRef.current !== subId) {
      setFocusedSubId?.(subId);
    }
    const target = orderedSubs[idx];
    setAnnouncement(`${target.name} pass opened, ${idx + 1} of ${orderedSubs.length}`);
    requestAnimationFrame(() => {
      headerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (focusCard) cardBtnRefs.current[subId]?.focus();
    });
  };

  const closePass = (restoreFocus = false) => {
    const prevId = openIdRef.current;
    if (!prevId) return;
    openIdRef.current = null;
    setOpenId(null);
    animate(dismissY, 0, CARD_SPRING);
    if (focusedSubIdRef.current !== null && focusedSubIdRef.current !== undefined) {
      closingRef.current = true;
      setFocusedSubId?.(null);
    }
    setAnnouncement(`Returned to wallet, ${orderedSubs.length} passes`);
    if (restoreFocus && prevId) {
      requestAnimationFrame(() => cardBtnRefs.current[prevId]?.focus());
    }
  };

  useLayoutEffect(() => {
    if (focusedSubId && focusedSubId !== openIdRef.current) {
      openPass(focusedSubId);
    } else if (!focusedSubId && openIdRef.current) {
      if (closingRef.current) {
        closingRef.current = false;
      } else {
        closePass(false);
      }
    }
  }, [focusedSubId]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closePass(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  const cycleOrder = (direction = 1) => {
    if (orderedSubs.length <= 1) return;
    const ids = orderedSubs.map((s) => s.id);
    const nextOrder =
      direction > 0 ? [ids[ids.length - 1], ...ids.slice(0, -1)] : [...ids.slice(1), ids[0]];
    setOrderIds(nextOrder);
    const front = subscriptions.find((s) => s.id === nextOrder[nextOrder.length - 1]);
    if (front) setAnnouncement(`${front.name} moved to front`);
  };

  const stepOpenPass = (delta) => {
    if (!isOpen || orderedSubs.length <= 1) return;
    const nextIdx = (openIdx + delta + orderedSubs.length) % orderedSubs.length;
    openPass(orderedSubs[nextIdx].id);
  };

  const handleDeckPointerDown = (e) => {
    if (isOpen || e.button > 0) return;
    deckDragRef.current = { active: true, pointerId: e.pointerId, startY: e.clientY, didDrag: false };
  };

  const handleDeckPointerMove = (e) => {
    const st = deckDragRef.current;
    if (!st.active || st.pointerId !== e.pointerId || isOpen) return;
    const dy = e.clientY - st.startY;
    if (Math.abs(dy) > 8) {
      if (!st.didDrag) {
        st.didDrag = true;
        suppressClickRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      setFanExtra(dy > 0 ? Math.min(20, dy * 0.22) : Math.max(-8, dy * 0.1));
    }
  };

  const handleDeckPointerEnd = (e) => {
    const st = deckDragRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    const dy = e.clientY - st.startY;
    const wasDrag = st.didDrag;
    st.active = false;
    st.pointerId = null;
    st.didDrag = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    setFanExtra(0);
    if (wasDrag) {
      if (dy > 52) cycleOrder(1);
      else if (dy < -52) cycleOrder(-1);
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    } else {
      suppressClickRef.current = false;
    }
  };

  const handleLiftedPointerDown = (e, subId) => {
    if (!isOpen || openId !== subId || e.button > 0) return;
    pullDismissRef.current = { active: true, pointerId: e.pointerId, startY: e.clientY, didDrag: false };
  };

  const handleLiftedPointerMove = (e, subId) => {
    const st = pullDismissRef.current;
    if (!st.active || st.pointerId !== e.pointerId || openId !== subId) return;
    const dy = e.clientY - st.startY;
    if (Math.abs(dy) > 8) {
      if (!st.didDrag) {
        st.didDrag = true;
        suppressClickRef.current = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }
      dismissY.set(dy > 0 ? Math.min(120, dy * 0.68) : Math.max(-20, dy * 0.2));
    }
  };

  const handleLiftedPointerEnd = (e) => {
    const st = pullDismissRef.current;
    if (!st.active || st.pointerId !== e.pointerId) return;
    const dy = e.clientY - st.startY;
    const wasDrag = st.didDrag;
    st.active = false;
    st.pointerId = null;
    st.didDrag = false;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
    if (wasDrag) {
      if (dy > 55) {
        closePass(true);
      } else {
        animate(dismissY, 0, CARD_SPRING);
      }
      requestAnimationFrame(() => {
        suppressClickRef.current = false;
      });
    } else {
      suppressClickRef.current = false;
    }
  };

  const effectivePeek = Math.max(46, Math.round(CLOSED_PEEK + fanExtra));
  const panelTopY = cardHeight + 12;
  const pocketBaseY = panelTopY + panelHeight + 12;
  const tuckedCount = Math.max(0, orderedSubs.length - 1);

  const stageHeight = isOpen
    ? pocketBaseY + Math.max(0, tuckedCount - 1) * POCKET_PEEK + POCKET_PEEK + 10
    : orderedSubs.length > 0
      ? cardHeight + (orderedSubs.length - 1) * effectivePeek + 6
      : 0;

  return (
    <div className="space-y-2.5">
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      {/* Persistent Header */}
      <div
        ref={headerRef}
        data-testid="arc-wallet-header"
        className="flex items-center justify-between gap-2 px-0.5 pt-1 scroll-mt-2"
      >
        {isOpen ? (
          <>
            <button
              type="button"
              data-testid="arc-all-cards-btn"
              onClick={() => closePass(true)}
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-bold border active:scale-95 transition-transform"
              style={{
                backgroundColor: 'var(--bg-elevated)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            >
              <ArrowLeft size={12} />
              <span>All passes</span>
            </button>

            <div className="flex items-center gap-2">
              <span
                className="text-[11px] font-semibold tabular-nums"
                style={{ color: 'var(--text-secondary)' }}
              >
                Pass {openIdx + 1} of {orderedSubs.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="Previous pass"
                  onClick={() => stepOpenPass(-1)}
                  className="w-6 h-6 rounded-full border flex items-center justify-center active:scale-90 transition-transform"
                  style={{
                    backgroundColor: 'var(--bg-pill)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <ChevronLeft size={13} />
                </button>
                <button
                  type="button"
                  aria-label="Next pass"
                  onClick={() => stepOpenPass(1)}
                  className="w-6 h-6 rounded-full border flex items-center justify-center active:scale-90 transition-transform"
                  style={{
                    backgroundColor: 'var(--bg-pill)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-primary)',
                  }}
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="text-[12px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
              {orderedSubs.length} Subscriptions
            </div>
            <button
              type="button"
              onClick={() => cycleOrder(1)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border active:scale-95 transition-transform"
              style={{
                backgroundColor: 'var(--bg-pill)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <RotateCw size={10} />
              <span>Cycle</span>
            </button>
          </>
        )}
      </div>

      {/* Single Continuous Stage — ZERO portals, ZERO duplicate cards, CONSTANT Z-ORDER */}
      <motion.div
        ref={stageRef}
        animate={{ height: stageHeight }}
        transition={STAGE_SPRING}
        onPointerDown={handleDeckPointerDown}
        onPointerMove={handleDeckPointerMove}
        onPointerUp={handleDeckPointerEnd}
        onPointerCancel={handleDeckPointerEnd}
        className="relative overflow-hidden rounded-[22px]"
        style={{
          touchAction: isOpen ? 'auto' : 'pan-x',
        }}
      >
        {/* Layer A (zIndex: 1 — STRICTLY BEHIND ALL CARDS zIndex: 10+) */}
        <AnimatePresence>
          {isOpen && panelSub && (
            <motion.div
              key="pass-details-layer"
              data-testid="arc-activity-panel"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.14, ease: 'easeOut' } }}
              transition={{ delay: 0.08, duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: 'absolute',
                top: panelTopY,
                left: 0,
                right: 0,
                zIndex: 1,
              }}
            >
              <div ref={panelInnerRef} className="space-y-2.5">
                {!isViewer && (
                  <div className="surface-card p-3 space-y-2.5">
                    <div className="grid grid-cols-3 gap-1.5">
                      {RATING_LIST.map((r) => {
                        const active = panelSub.rating === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => onRateSubscription?.(panelSub.id, r.id)}
                            className="py-1.5 rounded-xl text-[11px] font-bold border transition-colors"
                            style={{
                              backgroundColor: active ? 'var(--accent)' : 'var(--bg-pill)',
                              borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                              color: active ? 'var(--accent-fg)' : 'var(--text-primary)',
                            }}
                          >
                            {r.label}
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={panelSub.paidThisMonth}
                        onClick={() => {
                          onLogSubPaid?.(panelSub);
                          confetti({ particleCount: 44, spread: 56, origin: { y: 0.6 } });
                        }}
                        className="flex-1 py-2 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-60"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                      >
                        <Sparkles size={13} />
                        <span>{panelSub.paidThisMonth ? 'Paid ✓' : 'Log as paid'}</span>
                      </button>

                      <button
                        type="button"
                        disabled={panelSub.paidThisMonth}
                        onClick={() => onSkipSubMonth?.(panelSub)}
                        className="flex-1 py-2 rounded-xl text-[12px] font-bold border flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform disabled:opacity-40"
                        style={{
                          backgroundColor: 'var(--bg-pill)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        <SkipForward size={13} />
                        <span>{panelSub.skippedThisMonth ? 'Undo skip' : 'Skip month'}</span>
                      </button>

                      {onEditSub && (
                        <button
                          type="button"
                          onClick={() => onEditSub(panelSub)}
                          aria-label="Edit subscription"
                          className="px-3 py-2 rounded-xl text-[12px] font-bold border flex items-center justify-center"
                          style={{
                            backgroundColor: 'var(--bg-pill)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Billing Timeline */}
                <div className="surface-card p-3 space-y-1.5">
                  <div
                    className="text-[10px] font-bold uppercase tracking-wider mb-1"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Billing Ledger
                  </div>

                  <div
                    className="px-2.5 py-1.5 rounded-xl border flex items-center justify-between gap-2"
                    style={{
                      backgroundColor: 'var(--accent-soft)',
                      borderColor: 'var(--accent)',
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CalendarClock size={13} style={{ color: 'var(--accent)' }} className="shrink-0" />
                      <div className="text-[11px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                        Next · {panelSub.nextDate}
                      </div>
                    </div>
                    <span className="text-[11px] font-extrabold tabular-nums shrink-0" style={{ color: 'var(--accent)' }}>
                      <NumberFlow value={panelSub.amount} format={{ maximumFractionDigits: 2 }} /> {currency}
                    </span>
                  </div>

                  {billingHistory.length === 0 ? (
                    <div className="text-[11px] py-1 px-1" style={{ color: 'var(--text-muted)' }}>
                      No matching logged payments yet.
                    </div>
                  ) : (
                    billingHistory.map((item) => (
                      <div
                        key={item.id}
                        className="px-2.5 py-1.5 rounded-xl border flex items-center justify-between gap-2"
                        style={{
                          backgroundColor: 'var(--bg-pill)',
                          borderColor: 'var(--border-subtle)',
                        }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                          <span className="text-[11px] font-semibold truncate">
                            {item.date} · {item.account}
                          </span>
                        </div>
                        <span className="text-[11px] font-bold tabular-nums shrink-0">
                          -{formatAmt(item.amount)} {currency}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Layer B — Real Pass Cards (zIndex: 10 + idx ALWAYS) */}
        {orderedSubs.map((sub, idx) => {
          const isLifted = isOpen && sub.id === openId;
          const isTucked = isOpen && sub.id !== openId;
          const isFrontClosed = !isOpen && idx === orderedSubs.length - 1;

          const tuckedSlot = isTucked ? (idx < openIdx ? idx : idx - 1) : 0;
          const targetY = isOpen
            ? isLifted
              ? 0
              : pocketBaseY + tuckedSlot * POCKET_PEEK
            : idx * effectivePeek;

          return (
            <motion.div
              key={sub.id}
              data-pass-card="true"
              data-sub-id={sub.id}
              animate={{ y: targetY }}
              transition={CARD_SPRING}
              className="absolute top-0 left-0 right-0 pointer-events-none"
              style={{
                height: cardHeight,
                zIndex: 10 + idx,
                willChange: 'transform',
              }}
            >
              <motion.div
                style={{ y: isLifted ? dismissY : 0 }}
                className="w-full h-full relative rounded-[20px]"
              >
                <SubscriptionPassCard
                  sub={sub}
                  currency={currency}
                  stackedIndex={idx}
                  isOpen={isLifted}
                />

                <button
                  ref={(el) => {
                    cardBtnRefs.current[sub.id] = el;
                  }}
                  type="button"
                  tabIndex={isOpen ? (isLifted ? 0 : -1) : isFrontClosed ? 0 : -1}
                  data-lifted-card={isLifted ? 'true' : undefined}
                  data-pocket-card={isTucked ? 'true' : undefined}
                  aria-expanded={isLifted}
                  aria-label={
                    isTucked
                      ? `Switch to ${sub.name} pass`
                      : `Open ${sub.name} pass`
                  }
                  onPointerDown={(e) => handleLiftedPointerDown(e, sub.id)}
                  onPointerMove={(e) => handleLiftedPointerMove(e, sub.id)}
                  onPointerUp={handleLiftedPointerEnd}
                  onPointerCancel={handleLiftedPointerEnd}
                  onClick={() => {
                    if (suppressClickRef.current) return;
                    if (isLifted) {
                      closePass(true);
                    } else {
                      openPass(sub.id);
                    }
                  }}
                  className="absolute left-0 right-0 top-0 pointer-events-auto cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-[20px]"
                  style={{
                    height: isTucked ? `${POCKET_PEEK}px` : '100%',
                    touchAction: isLifted ? 'pan-x' : 'auto',
                    background: 'transparent',
                  }}
                />
              </motion.div>
            </motion.div>
          );
        })}
      </motion.div>

      <div className="text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {isOpen
          ? 'Tap the top card, ← All passes, or pull down to return'
          : 'Tap any pass to inspect · Pull stack down to cycle'}
      </div>
    </div>
  );
}
