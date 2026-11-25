import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { X, TrendingUp, TrendingDown, RotateCw } from 'lucide-react';
import { formatAmt, getCategoryColor } from '../lib/helpers';

const CARD_HEIGHT = 432;
const OPEN_FLIGHT_TRANSITION = { duration: 0.5, ease: [0.2, 0.85, 0.25, 1] };
const CLOSE_FLIGHT_TRANSITION = { duration: 0.48, ease: [0.55, 0.05, 0.2, 1] };
const CLOSE_ROTATE_TRANSITION = { duration: 0.32, ease: [0.4, 0, 0.2, 1] };
const INCOME_PALETTE = ['#10B981', '#14B8A6', '#06B6D4', '#3B82F6', '#8B5CF6', '#EC4899'];

function computeFlightMetrics(targetSide, fallbackRect) {
  if (typeof window === 'undefined') {
    return { cardW: 340, cardH: CARD_HEIGHT, dx: 0, dy: -60, sx: 0.45, sy: 0.22 };
  }

  const shell = document.getElementById('phone-shell');
  const shellRect = shell
    ? shell.getBoundingClientRect()
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

  const cardW = Math.min(360, Math.max(260, shellRect.width - 32));
  const cardH = Math.min(CARD_HEIGHT, Math.max(320, shellRect.height - 96));
  const centerX =
    shellRect.left + (shell?.clientLeft || 0) + (shell?.clientWidth || shellRect.width) / 2;
  const centerY =
    shellRect.top + (shell?.clientTop || 0) + (shell?.clientHeight || shellRect.height) / 2;

  const tileEl =
    typeof document !== 'undefined'
      ? document.querySelector(`[data-flip-tile="${targetSide}"]`)
      : null;
  const tileRect = tileEl ? tileEl.getBoundingClientRect() : fallbackRect;

  if (!tileRect || !tileRect.width || !tileRect.height) {
    return { cardW, cardH, dx: 0, dy: -60, sx: 0.45, sy: 0.22 };
  }

  return {
    cardW,
    cardH,
    dx: tileRect.left + tileRect.width / 2 - centerX,
    dy: tileRect.top + tileRect.height / 2 - centerY,
    sx: Math.max(0.2, tileRect.width / cardW),
    sy: Math.max(0.12, tileRect.height / cardH),
  };
}

function buildBreakdown(entries, typeMode, catOrder = []) {
  const isInc = typeMode === 'income';
  const filtered = entries.filter((tx) => tx.type === (isInc ? 'income' : 'expense'));
  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const map = {};
  for (const tx of filtered) {
    const key = isInc
      ? (tx.description || '').trim() || 'Income'
      : tx.category || 'Miscellaneous';
    map[key] = (map[key] || 0) + tx.amount;
  }
  const R = 48;
  const C = 2 * Math.PI * R;
  let offset = 0;
  let list = Object.entries(map)
    .map(([cat, amount], i) => ({
      cat,
      amount,
      pct: total > 0 ? Math.round((amount / total) * 100) : 0,
      color: isInc ? INCOME_PALETTE[i % INCOME_PALETTE.length] : getCategoryColor(cat, catOrder),
    }))
    .sort((a, b) => b.amount - a.amount);

  if (isInc && list.length > 6) {
    const rest = list.slice(5).reduce((n, x) => n + x.amount, 0);
    list = list.slice(0, 5).concat([{
      cat: 'Other',
      amount: rest,
      pct: total > 0 ? Math.round((rest / total) * 100) : 0,
      color: INCOME_PALETTE[5],
    }]);
  }

  list = list.map((item, i) => {
    const color = isInc ? INCOME_PALETTE[i % INCOME_PALETTE.length] : item.color;
    const len = total > 0 ? (item.amount / total) * C : 0;
    const seg = { ...item, color, len, offset: -offset, C, R };
    offset += len;
    return seg;
  });
  return { total, list, count: filtered.length };
}

function TileBackFace({ side, cornerScaleX = 1, cornerScaleY = 1 }) {
  const isIncome = side === 'income';
  const safeScaleX = Math.max(0.1, cornerScaleX);
  const safeScaleY = Math.max(0.1, cornerScaleY);

  return (
    <div
      data-testid="hero-tile-backface"
      className="relative w-full h-full select-none"
      style={{
        borderRadius: `${Math.round(16 / safeScaleX)}px / ${Math.round(16 / safeScaleY)}px`,
      }}
    >
      <motion.div
        className="w-full h-full relative rounded-[inherit] overflow-hidden border"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: [1, 1, 0],
          transition: { duration: 0.48, times: [0, 0.68, 1], ease: 'easeOut' },
        }}
        style={{
          backgroundColor: 'var(--bg-sheet)',
          backgroundImage: isIncome
            ? 'linear-gradient(155deg, rgba(16,185,129,0.22) 0%, rgba(16,185,129,0.06) 55%, rgba(16,185,129,0.18) 100%)'
            : 'linear-gradient(155deg, rgba(244,63,94,0.22) 0%, rgba(244,63,94,0.06) 55%, rgba(244,63,94,0.16) 100%)',
          borderColor: isIncome ? 'rgba(16,185,129,0.42)' : 'rgba(244,63,94,0.38)',
          boxShadow:
            '0 28px 64px -16px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.16)',
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent 8%, rgba(255,255,255,0.28) 50%, transparent 92%)',
          }}
        />
      </motion.div>
    </div>
  );
}

function BreakdownContent({
  side,
  data,
  monthLabel,
  accountLabel,
  currency,
  privacyBlur,
  isSpinning,
  onFlip,
  onClose,
}) {
  const isIncome = side === 'income';
  const accentColor = isIncome ? 'var(--positive)' : 'var(--negative)';
  const Icon = isIncome ? TrendingUp : TrendingDown;

  return (
    <div
      className="relative w-full h-full rounded-[28px] border p-4.5 shadow-2xl flex flex-col overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-sheet)',
        borderColor: 'var(--border-strong)',
        boxShadow:
          '0 28px 64px -16px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.12)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-45"
        style={{
          background: isIncome
            ? 'radial-gradient(ellipse at 50% 0%, rgba(16,185,129,0.28), transparent 72%)'
            : 'radial-gradient(ellipse at 50% 0%, rgba(244,63,94,0.24), transparent 72%)',
        }}
      />

      {/* Header */}
      <div className="relative z-10 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold"
            style={{
              backgroundColor: isIncome ? 'rgba(16,185,129,0.16)' : 'rgba(244,63,94,0.15)',
              color: accentColor,
            }}
          >
            <Icon size={12} />
            <span>{isIncome ? 'Income' : 'Spent'}</span>
          </span>
          <span className="text-[11px] font-medium truncate" style={{ color: 'var(--text-muted)' }}>
            {monthLabel} · {accountLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={isSpinning}
            onClick={onFlip}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border active:scale-95 transition-transform disabled:opacity-60"
            style={{
              backgroundColor: 'var(--bg-pill)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
            }}
          >
            <span>{isIncome ? 'Flip to Spent' : 'Flip to Income'}</span>
            <RotateCw size={11} />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close breakdown"
            className="w-7 h-7 rounded-full flex items-center justify-center active:scale-90 transition-transform"
            style={{ backgroundColor: 'var(--bg-pill)', color: 'var(--text-secondary)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Center SVG Donut with NumberFlow Total Inside */}
      <div className="relative z-10 flex flex-col items-center justify-center py-2.5 shrink-0">
        <div className="relative w-32 h-32 flex items-center justify-center">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke="var(--border-subtle)"
              strokeWidth="11"
            />
            {data.list.map((seg) => (
              <circle
                key={seg.cat}
                cx="60"
                cy="60"
                r={seg.R}
                fill="none"
                stroke={seg.color}
                strokeWidth="11"
                strokeLinecap="round"
                strokeDasharray={`${Math.max(0, seg.len - 3)} ${seg.C}`}
                strokeDashoffset={seg.offset}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none px-2">
            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              {isIncome ? 'Total In' : 'Total Out'}
            </span>
            <span
              className={`font-display text-[17px] font-extrabold leading-tight tabular-nums ${
                privacyBlur ? 'privacy-mask' : ''
              }`}
              style={{ color: isIncome ? 'var(--positive)' : 'var(--text-primary)' }}
            >
              {privacyBlur ? (
                '••••'
              ) : (
                <>
                  {isIncome ? '+' : '-'}
                  <NumberFlow value={data.total} format={{ maximumFractionDigits: 0 }} />
                </>
              )}
            </span>
            <span className="text-[9px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {currency} · {data.count} {data.count === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </div>
      </div>

      {/* Staggered Breakdown Bars */}
      <div className="relative z-10 flex-1 min-h-0 overflow-y-auto no-scrollbar space-y-2.5 pt-1 pr-0.5">
        {data.list.length === 0 ? (
          <div
            className="h-full flex items-center justify-center text-center text-[12px] py-6"
            style={{ color: 'var(--text-muted)' }}
          >
            No {isIncome ? 'income' : 'expense'} entries in this filter
          </div>
        ) : (
          data.list.map((item, idx) => (
            <motion.div
              key={`${side}-${item.cat}`}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 + idx * 0.045, duration: 0.24 }}
              className="space-y-1"
            >
              <div className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {item.cat}
                  </span>
                  <span className="text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {privacyBlur ? '••' : `${item.pct}%`}
                  </span>
                </div>
                <span
                  className={`font-bold tabular-nums shrink-0 ${privacyBlur ? 'privacy-mask' : ''}`}
                  style={{ color: 'var(--text-primary)' }}
                >
                  {privacyBlur ? '••••' : `${formatAmt(item.amount)} ${currency}`}
                </span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-pill)' }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${item.pct}%` }}
                  transition={{ delay: 0.1 + idx * 0.045, duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: item.color }}
                />
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}

export function HeroFlipModal({
  open,
  initialMode,
  originRect,
  onClose,
  onSideChange,
  onRevealTile,
  onClosed,
  monthLabel,
  accountLabel,
  entries = [],
  catOrder = [],
  currency = 'EGP',
  privacyBlur = false,
}) {
  const normalizedInitial = initialMode === 'income' ? 'income' : 'spent';
  const [side, setSide] = useState(normalizedInitial);
  const [prevOpen, setPrevOpen] = useState(false);
  const [flipStage, setFlipStage] = useState('idle');

  const flightRef = useRef(null);
  const sheenRef = useRef(null);
  const timersRef = useRef([]);
  const revealTimerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const onRevealTileRef = useRef(onRevealTile);

  onCloseRef.current = onClose;
  onRevealTileRef.current = onRevealTile;

  const rawTiltX = useMotionValue(0);
  const tiltX = useSpring(rawTiltX, { stiffness: 280, damping: 24 });

  const clearFlipTimers = () => {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current = [];
  };

  const clearRevealTimer = () => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  if (open && !prevOpen) {
    setPrevOpen(true);
    setSide(normalizedInitial);
    setFlipStage('idle');
  } else if (!open && prevOpen) {
    setPrevOpen(false);
  }

  useEffect(() => {
    if (open) {
      clearRevealTimer();
      rawTiltX.set(0);
    }
    return () => clearFlipTimers();
  }, [open, rawTiltX]);

  useEffect(() => {
    return () => {
      clearFlipTimers();
      clearRevealTimer();
    };
  }, []);

  const handleClose = () => {
    clearFlipTimers();
    setFlipStage('idle');
    rawTiltX.set(0);
    if (sheenRef.current) sheenRef.current.style.opacity = '0';
    if (!revealTimerRef.current) {
      revealTimerRef.current = setTimeout(() => {
        revealTimerRef.current = null;
        onRevealTileRef.current?.();
      }, 330);
    }
    onCloseRef.current?.();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const enterFlight = useMemo(() => {
    if (!open) return { cardW: 340, cardH: CARD_HEIGHT, dx: 0, dy: -60, sx: 0.45, sy: 0.22 };
    return computeFlightMetrics(normalizedInitial, originRect);
  }, [open, normalizedInitial, originRect]);

  const exitFlight = useMemo(() => {
    const fallback = side === normalizedInitial ? originRect : null;
    return computeFlightMetrics(side, fallback);
  }, [open, side, normalizedInitial, originRect]);

  const spentData = useMemo(
    () => buildBreakdown(entries, 'spent', catOrder),
    [entries, catOrder]
  );
  const incomeData = useMemo(
    () => buildBreakdown(entries, 'income', catOrder),
    [entries, catOrder]
  );

  const activeData = side === 'income' ? incomeData : spentData;

  const handleFlipSide = () => {
    if (flipStage !== 'idle') return;
    clearFlipTimers();
    rawTiltX.set(0);

    const nextSide = side === 'spent' ? 'income' : 'spent';
    setFlipStage('half');

    const t1 = setTimeout(() => {
      setSide(nextSide);
      onSideChange?.(nextSide);
      setFlipStage('snap');

      const t2 = setTimeout(() => {
        setFlipStage('in');

        const t3 = setTimeout(() => {
          setFlipStage('idle');
        }, 200);
        timersRef.current.push(t3);
      }, 24);
      timersRef.current.push(t2);
    }, 150);
    timersRef.current.push(t1);
  };

  const handlePointerMove = (e) => {
    const el = flightRef.current;
    if (!el || flipStage !== 'idle') return;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height - 0.5) * 2));
    rawTiltX.set(-ny * 5);

    if (sheenRef.current) {
      const px = ((e.clientX - rect.left) / rect.width) * 100;
      const py = ((e.clientY - rect.top) / rect.height) * 100;
      sheenRef.current.style.opacity = '1';
      sheenRef.current.style.background = `radial-gradient(230px circle at ${px.toFixed(1)}% ${py.toFixed(1)}%, rgba(255,255,255,0.14), transparent 68%)`;
    }
  };

  const resetTilt = () => {
    rawTiltX.set(0);
    if (sheenRef.current) {
      sheenRef.current.style.opacity = '0';
    }
  };

  const contentRotateY = flipStage === 'half' ? 90 : flipStage === 'snap' ? -90 : 0;
  const contentTransition =
    flipStage === 'snap'
      ? { duration: 0 }
      : flipStage === 'half'
        ? { duration: 0.15, ease: [0.4, 0, 1, 1] }
        : flipStage === 'in'
          ? { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
          : OPEN_FLIGHT_TRANSITION;

  return (
    <AnimatePresence onExitComplete={() => onClosed?.()}>
      {open && (
        <div
          key="hero-flip-overlay"
          className="fixed inset-0 z-50 pointer-events-auto"
        >
          {/* Sibling 1: Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-md"
            onClick={handleClose}
          />

          {/* Sibling 2: Centered Flight + Perspective Container */}
          <motion.div
            ref={flightRef}
            initial={{
              x: enterFlight.dx,
              y: enterFlight.dy,
              scaleX: enterFlight.sx,
              scaleY: enterFlight.sy,
            }}
            animate={{
              x: 0,
              y: 0,
              scaleX: 1,
              scaleY: 1,
            }}
            exit={{
              x: exitFlight.dx,
              y: exitFlight.dy,
              scaleX: exitFlight.sx,
              scaleY: exitFlight.sy,
              transition: CLOSE_FLIGHT_TRANSITION,
            }}
            transition={OPEN_FLIGHT_TRANSITION}
            onClick={(e) => e.stopPropagation()}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetTilt}
            onPointerUp={resetTilt}
            onPointerCancel={resetTilt}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: enterFlight.cardW,
              height: enterFlight.cardH,
              marginLeft: -enterFlight.cardW / 2,
              marginTop: -enterFlight.cardH / 2,
              perspective: 1300,
            }}
          >
            {/* Face 1: Pure Blank Frosted Origin Tile Back-Face */}
            <motion.div
              aria-hidden="true"
              initial={{ rotateY: 0 }}
              animate={{ rotateY: -180 }}
              exit={{ rotateY: 0, transition: CLOSE_ROTATE_TRANSITION }}
              transition={OPEN_FLIGHT_TRANSITION}
              style={{
                position: 'absolute',
                inset: 0,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                pointerEvents: 'none',
              }}
            >
              <TileBackFace
                side={side}
                cornerScaleX={exitFlight.sx}
                cornerScaleY={exitFlight.sy}
              />
            </motion.div>

            {/* Face 2: Breakdown Content Face */}
            <motion.div
              initial={{ rotateY: 180 }}
              animate={{ rotateY: contentRotateY }}
              exit={{ rotateY: 180, transition: CLOSE_ROTATE_TRANSITION }}
              transition={contentTransition}
              style={{
                position: 'absolute',
                inset: 0,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                rotateX: tiltX,
              }}
            >
              <BreakdownContent
                side={side}
                data={activeData}
                monthLabel={monthLabel}
                accountLabel={accountLabel}
                currency={currency}
                privacyBlur={privacyBlur}
                isSpinning={flipStage !== 'idle'}
                onFlip={handleFlipSide}
                onClose={handleClose}
              />

              <div
                ref={sheenRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-[28px] transition-opacity duration-200"
                style={{ opacity: 0 }}
              />
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default HeroFlipModal;
