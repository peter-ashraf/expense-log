import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'motion/react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import { Sparkles, X, RotateCw, Pencil } from 'lucide-react';
import { formatAmt } from '../lib/helpers';

const RATINGS = [
  { id: 'love', emoji: '🔥', label: '🔥 Worth it' },
  { id: 'meh', emoji: '😐', label: '😐 Okay' },
  { id: 'sleep', emoji: '💤', label: '💤 Sleepy' },
];

const PEEK = 58;
const OPEN_PORTAL_TRANSITION = { duration: 0.52, ease: [0.22, 1, 0.36, 1] };
const EXIT_PORTAL_TRANSITION = { duration: 0.44, ease: [0.32, 0.72, 0, 1] };

function cardGradient(color) {
  const c = color || '#6366F1';
  return `radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, ${c} 75%, #fff 25%) 0%, transparent 56%), linear-gradient(150deg, ${c} 0%, color-mix(in srgb, ${c} 54%, #000 46%) 100%)`;
}

function BrandMark({ sub }) {
  return (
    <span
      className="w-8 h-8 rounded-[10px] bg-white/95 flex items-center justify-center shrink-0 shadow-sm"
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

function CardFrontContent({
  sub,
  currency = 'EGP',
  onRateSubscription,
  interactiveRatings = true,
  isFocused = false,
  showFlipToBack = false,
  onFlipToBack,
  onClose,
}) {
  const statusTxt = sub.paidThisMonth
    ? 'Paid ✓'
    : sub.skippedThisMonth
      ? 'Skipped'
      : sub.daysLeft < 0
        ? `${-sub.daysLeft}d late`
        : sub.daysLeft === 0
          ? 'Today'
          : `in ${sub.daysLeft}d`;

  return (
    <div
      style={{ background: cardGradient(sub.color) }}
      className="relative w-full h-full rounded-[20px] p-4 text-white border border-white/25 flex flex-col justify-between overflow-hidden shadow-xl select-none"
    >
      <div className="pointer-events-none absolute inset-0 wcard-noise" />
      <div
        className="pointer-events-none absolute -top-1/2 -left-1/4 -right-1/4 h-[85%] -rotate-6 opacity-30"
        style={{
          background:
            'linear-gradient(175deg, rgba(255,255,255,0.45) 0%, rgba(255,255,255,0) 62%)',
        }}
      />

      {/* Top Row: Brand Mark, Name, Monthly EGP */}
      <div className="relative z-10 flex items-center gap-2.5">
        <BrandMark sub={sub} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-extrabold leading-tight truncate">{sub.name}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-white/75 truncate">
            {sub.category || 'Subscription'} · {sub.account || 'Card'}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-white/70">Monthly</div>
          <div className="text-[16px] font-extrabold tabular-nums leading-tight">
            {formatAmt(sub.amount)} <span className="text-[10px] font-semibold">{currency}</span>
          </div>
        </div>
        {showFlipToBack && !isFocused && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFlipToBack?.();
            }}
            className="ml-1 w-7 h-7 rounded-full bg-black/25 border border-white/20 flex items-center justify-center text-white/95 hover:bg-black/40 active:scale-90 transition-transform"
            aria-label="Flip to details"
          >
            <RotateCw size={13} />
          </button>
        )}
        {isFocused && (
          <div className="flex items-center gap-1 ml-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onFlipToBack?.();
              }}
              className="w-7 h-7 rounded-full bg-black/25 flex items-center justify-center text-white/90 hover:bg-black/40"
              aria-label="Flip to details"
            >
              <RotateCw size={13} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose?.();
              }}
              className="w-7 h-7 rounded-full bg-black/25 flex items-center justify-center text-white/90 hover:bg-black/40"
              aria-label="Close card"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Clickable Front-Face Rating Pills */}
      <div className="relative z-10 flex items-center gap-1.5">
        {RATINGS.map((r) => {
          const active = sub.rating === r.id;
          return (
            <button
              key={r.id}
              type="button"
              disabled={!interactiveRatings}
              onClick={(e) => {
                e.stopPropagation();
                onRateSubscription?.(sub.id, r.id);
              }}
              aria-label={`Rate ${sub.name} ${r.id}`}
              className={`px-2.5 py-1 rounded-full text-[13px] transition-all active:scale-90 ${
                active
                  ? 'bg-white/95 shadow-sm scale-105'
                  : 'bg-white/15 hover:bg-white/25 border border-white/25'
              }`}
            >
              {r.emoji}
            </button>
          );
        })}
      </div>

      {/* Bottom 3-Column Meta Grid */}
      <div className="relative z-10 grid grid-cols-3 gap-2 pt-1">
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-white/70">Next</div>
          <div className="text-[13px] font-bold tabular-nums truncate">{statusTxt}</div>
        </div>
        <div>
          <div className="text-[9px] font-bold uppercase tracking-wider text-white/70">Account</div>
          <div className="text-[13px] font-bold truncate">{sub.account}</div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-wider text-white/70">Per year</div>
          <div className="text-[13px] font-bold tabular-nums truncate">
            {formatAmt(sub.amount * 12)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WalletStack3D({
  subscriptions = [],
  currency = 'EGP',
  onRateSubscription,
  onLogSubPaid,
  onSkipSubMonth,
  onEditSub,
  focusedSubId,
  setFocusedSubId,
  isViewer = false,
}) {
  const stackRef = useRef(null);
  const cardRefs = useRef({});
  const sheenRef = useRef(null);
  const portalCardRef = useRef(null);

  const seqTimersRef = useRef([]);
  const closingRef = useRef(false);
  const stageRef = useRef('idle');
  const targetIdRef = useRef(null);
  const prevTargetIdxRef = useRef(-1);
  const focusedSubIdRef = useRef(focusedSubId);
  focusedSubIdRef.current = focusedSubId;

  const [cardHeight, setCardHeight] = useState(222);
  const [stage, setStage] = useState('idle');
  const [targetId, setTargetId] = useState(null);
  const [portalFocus, setPortalFocus] = useState(null);
  const [hiddenSlotId, setHiddenSlotId] = useState(null);
  const [showFront, setShowFront] = useState(false);

  const rawTiltX = useMotionValue(0);
  const tiltX = useSpring(rawTiltX, { stiffness: 280, damping: 24 });

  const clearSeqTimers = () => {
    for (const id of seqTimersRef.current) clearTimeout(id);
    seqTimersRef.current = [];
  };

  useEffect(() => {
    return () => clearSeqTimers();
  }, []);

  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el) return;
    const updateH = () => {
      const w = el.clientWidth;
      if (w > 0) setCardHeight(Math.round(w / 1.586));
    };
    updateH();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateH);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  const resetTilt = () => {
    rawTiltX.set(0);
    if (sheenRef.current) sheenRef.current.style.opacity = '0';
  };

  const buildSnapshot = (subId) => {
    const cardEl = cardRefs.current[subId];
    const shell =
      typeof document !== 'undefined'
        ? document.getElementById('phone-shell') || document.body
        : null;
    const sr = shell
      ? shell.getBoundingClientRect()
      : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    const targetW = Math.min(352, Math.max(260, sr.width - 32));
    const targetH = Math.max(268, Math.round(targetW / 1.42));
    const centerX =
      sr.left + (shell?.clientLeft || 0) + (shell?.clientWidth || sr.width) / 2;
    const centerY =
      sr.top + (shell?.clientTop || 0) + (shell?.clientHeight || sr.height) / 2 - 14;

    let dx = 0;
    let dy = 80;
    let scaleX = 0.95;
    let scaleY = 0.85;

    if (cardEl) {
      const r = cardEl.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        dx = r.left + r.width / 2 - centerX;
        dy = r.top + r.height / 2 - centerY;
        scaleX = Math.max(0.4, r.width / targetW);
        scaleY = Math.max(0.4, r.height / targetH);
      }
    }

    return { subId, dx, dy, scaleX, scaleY, targetW, targetH };
  };

  const startOpen = (subId) => {
    if (!subId) return;
    clearSeqTimers();
    closingRef.current = false;

    const idx = subscriptions.findIndex((s) => s.id === subId);
    if (idx < 0) return;

    if (idx < subscriptions.length - 1) {
      prevTargetIdxRef.current = idx;
      targetIdRef.current = subId;
      setTargetId(subId);
      stageRef.current = 'clearing';
      setStage('clearing');
      setHiddenSlotId(null);
      setPortalFocus(null);
      if (focusedSubIdRef.current !== subId) {
        setFocusedSubId?.(subId);
      }

      const t = setTimeout(() => {
        const snapshot = buildSnapshot(subId);
        resetTilt();
        setShowFront(false);
        setHiddenSlotId(subId);
        setPortalFocus(snapshot);
        stageRef.current = 'open';
        setStage('open');
      }, 380);
      seqTimersRef.current.push(t);
    } else {
      resetTilt();
      setShowFront(false);
      prevTargetIdxRef.current = idx;
      const snapshot = buildSnapshot(subId);
      targetIdRef.current = subId;
      setTargetId(subId);
      setHiddenSlotId(subId);
      setPortalFocus(snapshot);
      stageRef.current = 'open';
      setStage('open');
      if (focusedSubIdRef.current !== subId) {
        setFocusedSubId?.(subId);
      }
    }
  };

  const handleClose = () => {
    resetTilt();
    const curStage = stageRef.current;
    if (curStage !== 'clearing' && curStage !== 'open') return;

    if (focusedSubIdRef.current !== null && focusedSubIdRef.current !== undefined) {
      closingRef.current = true;
      setFocusedSubId?.(null);
    }

    if (curStage === 'clearing') {
      clearSeqTimers();
      targetIdRef.current = null;
      setTargetId(null);
      stageRef.current = 'restoring';
      setStage('restoring');
      const t = setTimeout(() => {
        stageRef.current = 'idle';
        setStage('idle');
      }, 260);
      seqTimersRef.current.push(t);
      return;
    }

    if (curStage === 'open') {
      stageRef.current = 'returning';
      setStage('returning');
      setPortalFocus(null);
    }
  };

  useLayoutEffect(() => {
    if (focusedSubId && focusedSubId !== targetIdRef.current) {
      startOpen(focusedSubId);
    } else if (!focusedSubId && targetIdRef.current) {
      if (closingRef.current) {
        closingRef.current = false;
      } else {
        handleClose();
      }
    }
  }, [focusedSubId]);

  useEffect(() => {
    if (stage !== 'open' && stage !== 'clearing') return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  const openId = portalFocus?.subId || null;
  const focusedSub = openId ? subscriptions.find((s) => s.id === openId) || null : null;
  const targetIdx = targetId ? subscriptions.findIndex((s) => s.id === targetId) : -1;

  const stackContainerHeight =
    subscriptions.length > 0 ? cardHeight + (subscriptions.length - 1) * PEEK : 0;

  const portalHost =
    typeof document !== 'undefined'
      ? document.getElementById('phone-shell') || document.body
      : null;

  const handlePortalMove = (e) => {
    const el = portalCardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height - 0.5) * 2));
    rawTiltX.set(-ny * 5);

    if (sheenRef.current) {
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      sheenRef.current.style.opacity = '1';
      sheenRef.current.style.background = `radial-gradient(210px circle at ${px.toFixed(1)}% ${py.toFixed(1)}%, rgba(255,255,255,0.16), transparent 65%)`;
    }
  };

  const brandColor = focusedSub ? focusedSub.color || '#6366F1' : '#6366F1';
  const isBusy = Boolean(targetId);

  return (
    <>
      <div
        ref={stackRef}
        className="relative pt-1 pb-2"
        style={{ height: stackContainerHeight }}
      >
        {subscriptions.map((sub, idx) => {
          const isHiddenSlot = sub.id === hiddenSlotId;
          const isBelow = targetIdx >= 0 && idx > targetIdx;
          const isAbove = targetIdx >= 0 && idx < targetIdx;

          const animateState = isBelow
            ? { y: 520, scale: 1, opacity: 1 }
            : isAbove
              ? { y: 0, scale: 1, opacity: 1 }
              : { y: 0, scale: 1, opacity: 1 };

          const transitionCfg = isBelow
            ? {
                duration: 0.58,
                delay: (subscriptions.length - 1 - idx) * 0.05,
                ease: [0.36, 0.06, 0.24, 1],
              }
            : isAbove
              ? { duration: 0.44, ease: [0.22, 1, 0.36, 1] }
              : stage === 'restoring' && targetIdx < 0
                ? {
                    duration: 0.52,
                    delay:
                      prevTargetIdxRef.current >= 0 && idx > prevTargetIdxRef.current
                        ? (idx - prevTargetIdxRef.current - 1) * 0.048
                        : 0,
                    ease: [0.22, 1, 0.36, 1],
                  }
                : { duration: 0.36, ease: [0.22, 1, 0.36, 1] };

          return (
            <motion.div
              key={sub.id}
              ref={(el) => {
                cardRefs.current[sub.id] = el;
              }}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${sub.name} subscription`}
              onClick={() => startOpen(sub.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  startOpen(sub.id);
                }
              }}
              animate={animateState}
              transition={transitionCfg}
              className="absolute left-0 right-0 aspect-[1.586/1] cursor-pointer focus:outline-none"
              style={{
                top: idx * PEEK,
                zIndex: idx + 1,
                willChange: 'transform',
                pointerEvents: isHiddenSlot || isBusy ? 'none' : 'auto',
                visibility: isHiddenSlot ? 'hidden' : 'visible',
              }}
            >
              <motion.div
                whileTap={isBusy ? undefined : { scale: 0.985 }}
                transition={{ duration: 0.12 }}
                className="w-full h-full"
              >
                <CardFrontContent
                  sub={sub}
                  currency={currency}
                  onRateSubscription={onRateSubscription}
                  interactiveRatings={!isViewer && !isBusy}
                />
              </motion.div>
            </motion.div>
          );
        })}
      </div>

      {/* Portaled 3D Focused & Flippable Card Modal */}
      {portalHost &&
        createPortal(
          <AnimatePresence
            onExitComplete={() => {
              if (stageRef.current === 'returning') {
                setHiddenSlotId(null);
                targetIdRef.current = null;
                setTargetId(null);
                stageRef.current = 'restoring';
                setStage('restoring');
                clearSeqTimers();
                const t = setTimeout(() => {
                  stageRef.current = 'idle';
                  setStage('idle');
                  prevTargetIdxRef.current = -1;
                }, 680);
                seqTimersRef.current.push(t);
              }
            }}
          >
            {focusedSub && portalFocus && (
              <div
                key={`wallet-focus-${portalFocus.subId}`}
                className="fixed sm:absolute inset-0 z-[58] pointer-events-auto"
              >
                {/* Sibling 1: GPU-composited scrim without backdrop blur stall */}
                <motion.div
                  data-testid="wallet3d-scrim"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.34 } }}
                  transition={{ duration: 0.32 }}
                  style={{ backgroundColor: 'rgba(5, 6, 11, 0.88)' }}
                  className="absolute inset-0"
                  onClick={handleClose}
                />

                {/* Sibling 2: Hint positioned cleanly BELOW the centered card */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.85 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22 }}
                  style={{ top: `calc(50% + ${Math.round(portalFocus.targetH / 2 + 6)}px)` }}
                  className="absolute inset-x-0 text-center text-[12px] font-semibold text-white pointer-events-none"
                >
                  Tap outside to put it back
                </motion.div>

                {/* Sibling 3: Centered Flight Box */}
                <motion.div
                  ref={portalCardRef}
                  initial={{
                    x: portalFocus.dx,
                    y: portalFocus.dy,
                    scaleX: portalFocus.scaleX,
                    scaleY: portalFocus.scaleY,
                  }}
                  animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1 }}
                  exit={{
                    x: portalFocus.dx,
                    y: portalFocus.dy,
                    scaleX: portalFocus.scaleX,
                    scaleY: portalFocus.scaleY,
                    transition: EXIT_PORTAL_TRANSITION,
                  }}
                  transition={OPEN_PORTAL_TRANSITION}
                  onClick={(e) => e.stopPropagation()}
                  onPointerMove={handlePortalMove}
                  onPointerLeave={resetTilt}
                  onPointerUp={resetTilt}
                  onPointerCancel={resetTilt}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    width: portalFocus.targetW,
                    height: portalFocus.targetH,
                    marginLeft: -portalFocus.targetW / 2,
                    marginTop: -portalFocus.targetH / 2 - 14,
                    perspective: 1200,
                  }}
                >
                  {/* Face 1: Front Face */}
                  <motion.div
                    initial={{ rotateY: 0 }}
                    animate={{ rotateY: showFront ? 0 : -180 }}
                    exit={{ rotateY: 0, transition: EXIT_PORTAL_TRANSITION }}
                    transition={OPEN_PORTAL_TRANSITION}
                    onClick={() => {
                      if (showFront) setShowFront(false);
                    }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      pointerEvents: showFront ? 'auto' : 'none',
                      rotateX: tiltX,
                    }}
                  >
                    <CardFrontContent
                      sub={focusedSub}
                      currency={currency}
                      onRateSubscription={onRateSubscription}
                      interactiveRatings={!isViewer}
                      isFocused={false}
                      showFlipToBack={showFront}
                      onFlipToBack={() => setShowFront(false)}
                    />
                  </motion.div>

                  {/* Face 2: Dark Metallic Back Face */}
                  <motion.div
                    initial={{ rotateY: 180 }}
                    animate={{ rotateY: showFront ? 180 : 0 }}
                    exit={{ rotateY: 180, transition: EXIT_PORTAL_TRANSITION }}
                    transition={OPEN_PORTAL_TRANSITION}
                    className="rounded-[22px] p-4 border text-white flex flex-col justify-between overflow-hidden select-none"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      backfaceVisibility: 'hidden',
                      WebkitBackfaceVisibility: 'hidden',
                      pointerEvents: showFront ? 'none' : 'auto',
                      rotateX: tiltX,
                      backgroundImage: `radial-gradient(120% 80% at 12% 0%, ${brandColor}36 0%, transparent 56%), linear-gradient(155deg, rgba(15,18,28,0.92), rgba(8,10,18,0.98))`,
                      borderColor: `${brandColor}55`,
                      boxShadow: `0 28px 60px -16px rgba(0, 0, 0, 0.72), 0 0 28px -8px ${brandColor}44, inset 0 1px 0 rgba(255, 255, 255, 0.16)`,
                    }}
                  >
                    <div className="pointer-events-none absolute inset-0 wcard-noise" />
                    <div
                      className="pointer-events-none absolute -top-1/2 -left-1/4 -right-1/4 h-[80%] -rotate-6 opacity-25"
                      style={{
                        background:
                          'linear-gradient(175deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 60%)',
                      }}
                    />

                    {/* Header */}
                    <div className="relative z-10 flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <BrandMark sub={focusedSub} />
                        <div className="min-w-0">
                          <h3 className="font-display text-[16px] font-extrabold leading-tight truncate text-white">
                            {focusedSub.name}
                          </h3>
                          <div className="text-[11px] truncate text-white/65">
                            Renews {focusedSub.nextDate} · day {focusedSub.day}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {!isViewer && onEditSub && (
                          <button
                            type="button"
                            onClick={() => {
                              handleClose();
                              onEditSub(focusedSub);
                            }}
                            aria-label="Edit subscription"
                            className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 border border-white/15 text-white/90 hover:bg-white/20"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowFront(true)}
                          className="h-7 px-2 rounded-full flex items-center gap-1 text-[10px] font-bold bg-white/10 border border-white/15 text-white/90 hover:bg-white/20 active:scale-95 transition-transform"
                          aria-label="Peek front of card"
                        >
                          <RotateCw size={11} />
                          <span>Peek</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClose}
                          aria-label="Close card"
                          className="w-7 h-7 rounded-full flex items-center justify-center bg-white/10 border border-white/15 text-white/90 hover:bg-white/20 active:scale-90 transition-transform"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {/* Breakdown Grid: Per Week / Per Day / Per Year */}
                    <div className="relative z-10 grid grid-cols-3 gap-1.5">
                      <div className="p-2 rounded-xl border bg-white/[0.07] border-white/12">
                        <div className="text-[9px] font-bold uppercase text-white/55">Per Week</div>
                        <div className="text-[13px] font-extrabold tabular-nums text-white">
                          <NumberFlow value={Math.round(focusedSub.amount / 4.33)} /> {currency}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl border bg-white/[0.07] border-white/12">
                        <div className="text-[9px] font-bold uppercase text-white/55">Per Day</div>
                        <div className="text-[13px] font-extrabold tabular-nums text-white">
                          <NumberFlow value={Math.round((focusedSub.amount / 30) * 10) / 10} /> {currency}
                        </div>
                      </div>
                      <div className="p-2 rounded-xl border bg-white/[0.07] border-white/12">
                        <div className="text-[9px] font-bold uppercase text-white/55">Per Year</div>
                        <div className="text-[13px] font-extrabold tabular-nums text-white">
                          <NumberFlow value={focusedSub.amount * 12} />
                        </div>
                      </div>
                    </div>

                    {/* Value Rating Selector */}
                    {!isViewer && (
                      <div className="relative z-10 grid grid-cols-3 gap-1.5">
                        {RATINGS.map((r) => {
                          const active = focusedSub.rating === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => onRateSubscription?.(focusedSub.id, r.id)}
                              className="py-1.5 rounded-xl text-[11px] font-bold border transition-colors"
                              style={{
                                backgroundColor: active ? '#FFFFFF' : 'rgba(255,255,255,0.08)',
                                borderColor: active ? '#FFFFFF' : 'rgba(255,255,255,0.14)',
                                color: active ? '#0B1020' : '#FFFFFF',
                              }}
                            >
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Action Buttons */}
                    {!isViewer && (
                      <div className="relative z-10 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={focusedSub.paidThisMonth}
                          onClick={() => {
                            onLogSubPaid?.(focusedSub);
                            confetti({ particleCount: 44, spread: 56, origin: { y: 0.6 } });
                            handleClose();
                          }}
                          className="py-2.5 rounded-xl text-[12px] font-bold flex items-center justify-center gap-1 active:scale-[0.98] transition-transform disabled:opacity-60"
                          style={{ backgroundColor: '#FFFFFF', color: '#0B1020' }}
                        >
                          <Sparkles size={13} />
                          <span>{focusedSub.paidThisMonth ? 'Paid this month ✓' : 'Log as paid'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={focusedSub.paidThisMonth}
                          onClick={() => {
                            onSkipSubMonth?.(focusedSub);
                            handleClose();
                          }}
                          className="py-2.5 rounded-xl text-[12px] font-bold border bg-white/10 border-white/18 text-white active:scale-[0.98] transition-transform disabled:opacity-40"
                        >
                          {focusedSub.skippedThisMonth ? 'Undo skip' : 'Skip month'}
                        </button>
                      </div>
                    )}

                    <div
                      ref={sheenRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 rounded-[22px] transition-opacity duration-200"
                      style={{ opacity: 0 }}
                    />
                  </motion.div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          portalHost
        )}
    </>
  );
}
