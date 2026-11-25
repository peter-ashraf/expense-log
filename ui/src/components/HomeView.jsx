import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import NumberFlow from '@number-flow/react';
import confetti from 'canvas-confetti';
import {
  Eye,
  EyeOff,
  Flame,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Sparkles,
  ArrowUpRight,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  buildPaceSeries,
  formatAmt,
  formatEGP,
  getCategoryColor,
} from '../lib/helpers';
import { computeStreak, util } from '../lib/bridge';
import SwipeableTxRow from './SwipeableTxRow';
import SlidingHighlight from './SlidingHighlight';

function pointsToSmoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = Math.min(i + 2, pts.length - 1);
    const pt3 = pts[p3];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (pt3.x - p1.x) / 6;
    const cp2y = p2.y - (pt3.y - p1.y) / 6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function HomeView({
  concept,
  account,
  setAccount,
  month,
  months = [],
  accounts = [],
  allEntries = [],
  monthEntries = [],
  monthStart = 0,
  monthAvailable = 0,
  monthIncome = 0,
  monthSpent = 0,
  effectiveBudget = 0,
  subscriptions = [],
  catOrder = [],
  currency = 'EGP',
  privacyBlur = false,
  onTogglePrivacy,
  activeFlipMode = null,
  onOpenBreakdown,
  onEditTx,
  onCopyTx,
  onDeleteTx,
  onNavigateActivity,
  onNavigateSubscriptions,
  onNavigateBudget,
  hasSwipedHint,
  onFirstSwipe,
  isViewer = false,
  viewerInfo = null,
}) {
  const heroRef = useRef(null);
  const chartSvgRef = useRef(null);
  const [scrubDay, setScrubDay] = useState(null);
  const [streakAnimating, setStreakAnimating] = useState(false);

  const springConfig =
    concept === 'kinetic'
      ? { type: 'spring', stiffness: 520, damping: 28 }
      : { type: 'spring', stiffness: 440, damping: 34 };

  const activeAccountObj = accounts.find((a) => a.name === account) || null;
  const isCash = activeAccountObj?.type === 'cash';

  const [mYear, mNum] = (month || util.currentKey()).split('-').map(Number);
  const daysInMonth = new Date(mYear || 2026, mNum || 1, 0).getDate();
  const today = util.todayStr();
  const isCurrentMonth = month === today.slice(0, 7);
  const currentDay = isCurrentMonth ? Math.max(1, Number(today.slice(8, 10))) : daysInMonth;
  const monthShort = month ? util.keyShort(month) : '';

  // Hero figures matching js/app.js scoped/cash/limit rules
  let heroLabel = 'Available balance';
  let heroAmount = monthAvailable;
  let heroSub = `Opened the month with ${formatAmt(monthStart)} ${currency}`;
  let meterShown = effectiveBudget > 0 || !activeAccountObj;
  let budgetPct = 0;

  if (activeAccountObj) {
    if (isCash) {
      const hasCashStart = Number(activeAccountObj.limit) > 0;
      heroLabel = `${activeAccountObj.name} · ${hasCashStart ? 'on hand' : 'spent this month'}`;
      heroAmount = hasCashStart ? activeAccountObj.balance : monthSpent;
      heroSub = hasCashStart
        ? `${formatAmt(monthSpent)} ${currency} spent this month`
        : 'Enter cash on hand in Settings to track balance';
      meterShown = false;
    } else {
      const lim = Number(activeAccountObj.limit) || 0;
      heroLabel = `${activeAccountObj.name} · ${lim > 0 ? 'left this month' : 'spent this month'}`;
      heroAmount = lim > 0 ? Math.max(0, lim - monthSpent) : monthSpent;
      heroSub =
        lim > 0
          ? monthSpent > lim
            ? `Over ${formatAmt(lim)} limit by ${formatAmt(monthSpent - lim)} ${currency}`
            : `Monthly limit ${formatAmt(lim)} ${currency}`
          : 'No limit set · Add one in Accounts & Budget';
      meterShown = lim > 0;
      budgetPct = lim > 0 ? Math.min(100, Math.round((monthSpent / lim) * 100)) : 0;
    }
  } else {
    const funds = effectiveBudget > 0 ? effectiveBudget : monthStart + monthIncome;
    budgetPct = funds > 0 ? Math.min(100, Math.round((monthSpent / funds) * 100)) : 0;
  }

  const daysRemaining = Math.max(1, daysInMonth - currentDay + 1);
  const dailyBudgetBase = effectiveBudget > 0 ? effectiveBudget : monthStart + monthIncome;
  const dailySafe = Math.max(0, Math.round((dailyBudgetBase - monthSpent) / daysRemaining));

  // Spending Pace Chart series
  const paceData = useMemo(() => {
    const thisMonthSeries = buildPaceSeries(allEntries, month, account, currentDay, daysInMonth);
    const curIdx = months.findIndex((m) => m.key === month);
    const prevMonthObj = curIdx >= 0 && curIdx + 1 < months.length ? months[curIdx + 1] : null;
    const prevSeries = prevMonthObj
      ? buildPaceSeries(allEntries, prevMonthObj.key, account, daysInMonth, daysInMonth)
      : [];

    const maxVal = Math.max(
      effectiveBudget > 0 ? effectiveBudget * 1.05 : 0,
      thisMonthSeries[thisMonthSeries.length - 1]?.value || 0,
      prevSeries[prevSeries.length - 1]?.value || 0,
      1000
    );

    const W = 320;
    const H = 128;
    const padX = 10;
    const padTop = 14;
    const padBot = 14;
    const plotW = W - padX * 2;
    const plotH = H - padTop - padBot;

    const toCoord = (day, val) => ({
      x: padX + ((day - 1) / Math.max(1, daysInMonth - 1)) * plotW,
      y: padTop + plotH - (val / maxVal) * plotH,
      day,
      value: val,
    });

    const curCoords = thisMonthSeries.map((p) => toCoord(p.day, p.value));
    const prevCoords = prevSeries.map((p) => toCoord(p.day, p.value));
    const budgetY = effectiveBudget > 0 ? padTop + plotH - (effectiveBudget / maxVal) * plotH : null;

    return {
      W,
      H,
      padX,
      plotW,
      curCoords,
      prevCoords,
      curPath: pointsToSmoothPath(curCoords),
      prevPath: pointsToSmoothPath(prevCoords),
      budgetY,
      maxVal,
    };
  }, [allEntries, month, months, account, currentDay, daysInMonth, effectiveBudget]);

  const activeDay = scrubDay ?? currentDay;
  const activePoint =
    paceData.curCoords[Math.min(Math.max(0, activeDay - 1), paceData.curCoords.length - 1)] || {
      x: paceData.padX,
      y: paceData.H - 14,
      day: activeDay,
      value: 0,
    };
  const expectedPaceAtDay =
    effectiveBudget > 0 ? Math.round((effectiveBudget / daysInMonth) * activeDay) : null;
  const paceDelta = expectedPaceAtDay !== null ? expectedPaceAtDay - activePoint.value : null;

  const handleChartPointer = (clientX) => {
    const svg = chartSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const relX = ((clientX - rect.left) / Math.max(1, rect.width)) * paceData.W;
    const norm = Math.min(1, Math.max(0, (relX - paceData.padX) / paceData.plotW));
    const day = Math.round(1 + norm * (daysInMonth - 1));
    setScrubDay(Math.min(currentDay, Math.max(1, day)));
  };

  // Next unhandled subscription
  const nextSub = useMemo(() => {
    const due = subscriptions
      .filter((s) => !s.paused && !s.paidThisMonth && !s.skippedThisMonth)
      .sort((a, b) => a.daysLeft - b.daysLeft);
    return due[0] || subscriptions.filter((s) => !s.paused).sort((a, b) => a.daysLeft - b.daysLeft)[0] || null;
  }, [subscriptions]);

  // Real streak from all recorded entry dates
  const streakInfo = useMemo(() => {
    const dates = new Set(allEntries.map((e) => e.date));
    return computeStreak(dates, today, util.weekStart());
  }, [allEntries, today]);

  // Top 4 spending categories ("Where It Went")
  const topCats = useMemo(() => {
    const map = {};
    for (const tx of monthEntries) {
      if (tx.type !== 'expense') continue;
      map[tx.category] = (map[tx.category] || 0) + tx.amount;
    }
    const total = Object.values(map).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(map)
      .map(([cat, amount]) => ({
        cat,
        amount,
        pct: Math.round((amount / total) * 100),
        color: getCategoryColor(cat, catOrder),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4);
  }, [monthEntries, catOrder]);

  const latestFive = monthEntries.slice(0, 5);

  const handleHeroPointerMove = (e) => {
    if (concept !== 'obsidian' || !heroRef.current) return;
    const rect = heroRef.current.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    heroRef.current.style.setProperty('--mx', `${xPct.toFixed(1)}%`);
    heroRef.current.style.setProperty('--my', `${yPct.toFixed(1)}%`);
  };

  const handleStreakTap = () => {
    setStreakAnimating(true);
    confetti({
      particleCount: 44,
      spread: 58,
      origin: { y: 0.62 },
      disableForReducedMotion: true,
    });
    toast.success(
      streakInfo.streak > 0
        ? `${streakInfo.streak}-Day Streak! Best: ${streakInfo.best} days 🔥`
        : 'Log an entry today to start your streak!'
    );
    setTimeout(() => setStreakAnimating(false), 650);
  };

  const heroClass =
    concept === 'obsidian'
      ? 'hero-obsidian'
      : concept === 'kinetic'
        ? 'hero-kinetic'
        : 'hero-editorial';

  const isKinetic = concept === 'kinetic';
  const accPillColor =
    isKinetic && account !== 'all' && activeAccountObj
      ? activeAccountObj.color
      : 'var(--accent)';

  const chipItems = [{ id: 'all', name: 'All accounts' }, ...accounts];

  return (
    <div className="px-4 pt-1 pb-28 space-y-3.5">
      {/* View-only Greeting Banner */}
      {isViewer && viewerInfo && (
        <div className="surface-card p-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-[13px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Hi {viewerInfo.name || 'there'} 👋
            </div>
            {viewerInfo.note && (
              <div className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                {viewerInfo.note}
              </div>
            )}
          </div>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ backgroundColor: 'rgba(16, 185, 129, 0.14)', color: 'var(--positive)' }}
          >
            View only
          </span>
        </div>
      )}

      {/* Account Filter Chips (horizontally scrollable — tap/scroll without scrub interception) */}
      {accounts.length > 1 && (
        <div className="overflow-x-auto no-scrollbar py-0.5">
          <SlidingHighlight
            activeKey={account}
            className="flex items-center gap-1.5 w-max"
            pillClassName="rounded-full"
            pillStyle={{ backgroundColor: accPillColor }}
          >
            {chipItems.map((acc) => {
              const active = account === acc.id;
              return (
                <button
                  key={acc.id}
                  type="button"
                  data-hl={acc.id}
                  onClick={() => setAccount(acc.id)}
                  className="relative px-3.5 py-1.5 rounded-full text-[12px] font-semibold shrink-0 transition-colors z-10"
                  style={{
                    color: active ? 'var(--accent-fg)' : 'var(--text-secondary)',
                    border: active ? '1px solid transparent' : '1px solid var(--border-subtle)',
                    backgroundColor: active ? 'transparent' : 'var(--bg-card)',
                  }}
                >
                  {acc.name}
                </button>
              );
            })}
          </SlidingHighlight>
        </div>
      )}

      {/* Hero Balance Card */}
      <motion.div
        ref={heroRef}
        onPointerMove={handleHeroPointerMove}
        whileTap={isKinetic ? { scale: 0.985 } : undefined}
        transition={springConfig}
        className={`relative p-4 overflow-hidden ${heroClass}`}
      >
        {concept === 'obsidian' && <div className="hero-obsidian-glare" />}

        <div className="relative z-10">
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{
                color: isKinetic ? 'rgba(255,255,255,0.78)' : 'var(--text-secondary)',
              }}
            >
              {heroLabel}
            </span>

            <button
              type="button"
              onClick={onTogglePrivacy}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors"
              style={{
                backgroundColor: isKinetic ? 'rgba(255,255,255,0.18)' : 'var(--bg-pill)',
                color: isKinetic ? '#FFFFFF' : 'var(--text-secondary)',
              }}
            >
              {privacyBlur ? <EyeOff size={12} /> : <Eye size={12} />}
              <span>{privacyBlur ? 'Hidden' : 'Hide'}</span>
            </button>
          </div>

          {/* Big NumberFlow Balance */}
          <button
            type="button"
            onClick={onTogglePrivacy}
            className="mt-1.5 flex items-baseline gap-2 text-left w-full"
          >
            <span
              className={`font-display text-[36px] leading-none tracking-tight tabular-nums transition-[filter] duration-200 ${
                isKinetic ? 'font-extrabold' : 'font-bold'
              } ${privacyBlur ? 'privacy-mask' : ''}`}
              style={{ color: isKinetic ? '#FFFFFF' : 'var(--text-primary)' }}
            >
              {privacyBlur ? (
                '••••••'
              ) : (
                <NumberFlow value={heroAmount} format={{ maximumFractionDigits: 2 }} />
              )}
            </span>
            <span
              className="text-[13px] font-semibold"
              style={{ color: isKinetic ? 'rgba(255,255,255,0.78)' : 'var(--text-secondary)' }}
            >
              {currency}
            </span>
          </button>

          <div
            className={`mt-1 text-[11px] ${privacyBlur ? 'privacy-mask' : ''}`}
            style={{ color: isKinetic ? 'rgba(255,255,255,0.75)' : 'var(--text-secondary)' }}
          >
            {privacyBlur ? '••••' : heroSub}
          </div>

          {/* Budget Meter + Daily Safe Spend */}
          {meterShown && (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] mb-1.5">
                <span
                  className="font-medium tabular-nums"
                  style={{ color: isKinetic ? 'rgba(255,255,255,0.84)' : 'var(--text-secondary)' }}
                >
                  {effectiveBudget > 0 ? 'Budget: ' : 'Spent: '}
                  <strong className={privacyBlur ? 'privacy-mask' : ''}>
                    {privacyBlur ? '••••' : <NumberFlow value={monthSpent} format={{ maximumFractionDigits: 0 }} />}
                  </strong>
                  {effectiveBudget > 0 ? (
                    <>
                      {' '}
                      / <NumberFlow value={effectiveBudget} format={{ maximumFractionDigits: 0 }} /> {currency}
                    </>
                  ) : (
                    ` ${currency}`
                  )}
                </span>
                <span
                  className="font-bold tabular-nums"
                  style={{
                    color: isKinetic
                      ? '#FFFFFF'
                      : budgetPct > 90
                        ? 'var(--negative)'
                        : 'var(--accent)',
                  }}
                >
                  {privacyBlur ? '••' : <NumberFlow value={budgetPct} format={{ maximumFractionDigits: 0 }} />}%
                </span>
              </div>
              <div
                className="h-2 rounded-full overflow-hidden"
                style={{
                  backgroundColor: isKinetic ? 'rgba(255,255,255,0.22)' : 'var(--bg-pill)',
                }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-300 ease-out"
                  style={{
                    width: `${budgetPct}%`,
                    background: isKinetic
                      ? '#FFFFFF'
                      : concept === 'obsidian'
                        ? 'linear-gradient(90deg, #6366F1, #22D3EE)'
                        : 'var(--accent)',
                  }}
                />
              </div>
              <div
                className="mt-1.5 text-[11px] flex items-center justify-between"
                style={{ color: isKinetic ? 'rgba(255,255,255,0.82)' : 'var(--text-muted)' }}
              >
                {effectiveBudget > 0 ? (
                  <span>
                    Safe daily spend:{' '}
                    <strong
                      className={`tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`}
                      style={{ color: isKinetic ? '#FFFFFF' : 'var(--text-primary)' }}
                    >
                      {privacyBlur ? (
                        '••••'
                      ) : (
                        <>
                          <NumberFlow value={dailySafe} format={{ maximumFractionDigits: 0 }} /> {currency}/day
                        </>
                      )}
                    </strong>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onNavigateBudget}
                    className="font-semibold underline"
                    style={{ color: isKinetic ? '#FFFFFF' : 'var(--accent)' }}
                  >
                    Set monthly budget →
                  </button>
                )}
                <span>{daysRemaining}d left</span>
              </div>
            </div>
          )}

          {/* Tappable Income / Spent Tiles */}
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              data-flip-tile="income"
              onClick={(e) => onOpenBreakdown('income', e.currentTarget.getBoundingClientRect())}
              className="p-2.5 rounded-2xl text-left border active:scale-[0.97] transition-[transform,opacity] duration-150"
              style={{
                backgroundColor: isKinetic ? 'rgba(255,255,255,0.14)' : 'var(--bg-pill)',
                borderColor: isKinetic ? 'rgba(255,255,255,0.2)' : 'var(--border-subtle)',
                opacity: activeFlipMode === 'income' ? 0 : 1,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-semibold flex items-center gap-1"
                  style={{ color: isKinetic ? 'rgba(255,255,255,0.82)' : 'var(--text-secondary)' }}
                >
                  <TrendingUp size={12} className={isKinetic ? 'text-emerald-200' : 'text-emerald-500'} />
                  Income
                </span>
                <ArrowUpRight
                  size={12}
                  style={{ color: isKinetic ? 'rgba(255,255,255,0.65)' : 'var(--text-muted)' }}
                />
              </div>
              <div
                className={`mt-0.5 text-[16px] font-bold tabular-nums transition-[filter] duration-200 ${
                  privacyBlur ? 'privacy-mask' : ''
                }`}
                style={{ color: isKinetic ? '#FFFFFF' : 'var(--positive)' }}
              >
                {privacyBlur ? (
                  '••••'
                ) : (
                  <>
                    +<NumberFlow value={monthIncome} format={{ maximumFractionDigits: 2 }} />
                  </>
                )}
              </div>
            </button>

            <button
              type="button"
              data-flip-tile="spent"
              onClick={(e) => onOpenBreakdown('spent', e.currentTarget.getBoundingClientRect())}
              className="p-2.5 rounded-2xl text-left border active:scale-[0.97] transition-[transform,opacity] duration-150"
              style={{
                backgroundColor: isKinetic ? 'rgba(255,255,255,0.14)' : 'var(--bg-pill)',
                borderColor: isKinetic ? 'rgba(255,255,255,0.2)' : 'var(--border-subtle)',
                opacity: activeFlipMode === 'spent' ? 0 : 1,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-semibold flex items-center gap-1"
                  style={{ color: isKinetic ? 'rgba(255,255,255,0.82)' : 'var(--text-secondary)' }}
                >
                  <TrendingDown size={12} className={isKinetic ? 'text-rose-200' : 'text-rose-500'} />
                  Spent
                </span>
                <ArrowUpRight
                  size={12}
                  style={{ color: isKinetic ? 'rgba(255,255,255,0.65)' : 'var(--text-muted)' }}
                />
              </div>
              <div
                className={`mt-0.5 text-[16px] font-bold tabular-nums transition-[filter] duration-200 ${
                  privacyBlur ? 'privacy-mask' : ''
                }`}
                style={{ color: isKinetic ? '#FFFFFF' : 'var(--text-primary)' }}
              >
                {privacyBlur ? (
                  '••••'
                ) : (
                  <>
                    -<NumberFlow value={monthSpent} format={{ maximumFractionDigits: 2 }} />
                  </>
                )}
              </div>
            </button>
          </div>
        </div>
      </motion.div>

      {/* Touch-Scrubbable Spending Pace Chart */}
      <div className="surface-card p-3.5">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
                Spending Pace
              </h3>
              {paceDelta !== null && (
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: paceDelta >= 0 ? 'rgba(16,185,129,0.14)' : 'rgba(244,63,94,0.14)',
                    color: paceDelta >= 0 ? 'var(--positive)' : 'var(--negative)',
                  }}
                >
                  {paceDelta >= 0
                    ? `Under pace · ${formatEGP(paceDelta)}`
                    : `Over pace · ${formatEGP(Math.abs(paceDelta))}`}
                </span>
              )}
            </div>
            <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              ⇄ Drag chart to scrub days
            </div>
          </div>

          <div className="text-right">
            <div className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {monthShort} {activeDay}
            </div>
            <div
              className={`text-[15px] font-bold tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`}
              style={{ color: 'var(--text-primary)' }}
            >
              {privacyBlur ? '••••' : <NumberFlow value={activePoint.value} format={{ maximumFractionDigits: 0 }} />}{' '}
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {currency}
              </span>
            </div>
          </div>
        </div>

        <div
          className="relative select-none touch-none mt-1"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            handleChartPointer(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons > 0 || e.pointerType === 'touch') {
              handleChartPointer(e.clientX);
            }
          }}
          onPointerUp={() => setScrubDay(null)}
          onPointerCancel={() => setScrubDay(null)}
          onPointerLeave={() => setScrubDay(null)}
        >
          <svg
            ref={chartSvgRef}
            viewBox={`0 0 ${paceData.W} ${paceData.H}`}
            className="w-full h-[126px] overflow-visible"
          >
            <defs>
              <linearGradient id="paceAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
              </linearGradient>
              <linearGradient id="obsidianStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#6366F1" />
                <stop offset="100%" stopColor="#22D3EE" />
              </linearGradient>
            </defs>

            {paceData.budgetY !== null && (
              <>
                <line
                  x1={paceData.padX}
                  x2={paceData.W - paceData.padX}
                  y1={paceData.budgetY}
                  y2={paceData.budgetY}
                  stroke="var(--border-strong)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                <text
                  x={paceData.W - paceData.padX}
                  y={Math.max(10, paceData.budgetY - 4)}
                  textAnchor="end"
                  fill="var(--text-muted)"
                  fontSize="9"
                  fontWeight="600"
                >
                  Budget {formatEGP(effectiveBudget)}
                </text>
              </>
            )}

            {paceData.prevPath && (
              <path
                d={paceData.prevPath}
                fill="none"
                stroke="var(--text-muted)"
                strokeOpacity="0.45"
                strokeWidth="1.6"
                strokeDasharray="4 4"
              />
            )}

            {paceData.curCoords.length > 1 && (
              <path
                d={`${paceData.curPath} L ${
                  paceData.curCoords[paceData.curCoords.length - 1].x
                } ${paceData.H - 14} L ${paceData.curCoords[0].x} ${paceData.H - 14} Z`}
                fill="url(#paceAreaGrad)"
              />
            )}

            {paceData.curPath && (
              <path
                d={paceData.curPath}
                fill="none"
                stroke={concept === 'obsidian' ? 'url(#obsidianStroke)' : 'var(--accent)'}
                strokeWidth="2.6"
                strokeLinecap="round"
                className="obsidian-spline-glow"
              />
            )}

            <line
              x1={activePoint.x}
              x2={activePoint.x}
              y1={8}
              y2={paceData.H - 12}
              stroke="var(--accent)"
              strokeOpacity="0.45"
              strokeWidth="1.2"
              strokeDasharray="3 3"
            />
            <circle cx={activePoint.x} cy={activePoint.y} r="7" fill="var(--accent)" fillOpacity="0.22" />
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r="4"
              fill="var(--bg-card-solid)"
              stroke={concept === 'obsidian' ? '#22D3EE' : 'var(--accent)'}
              strokeWidth="2.4"
            />
          </svg>

          <div className="flex items-center justify-between text-[10px] px-1" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-0.5 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                This Month
              </span>
              {paceData.prevPath && (
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-0.5 border-t border-dashed" style={{ borderColor: 'var(--text-muted)' }} />
                  Last Month
                </span>
              )}
            </div>
            <span>Day 1 – {daysInMonth}</span>
          </div>
        </div>
      </div>

      {/* Upcoming Subscription Strip + Real Streak Card */}
      <div className={`grid ${nextSub ? 'grid-cols-2' : 'grid-cols-1'} gap-2.5`}>
        {nextSub && (
          <button
            type="button"
            onClick={onNavigateSubscriptions}
            className="surface-card p-3 flex items-center gap-2.5 text-left active:scale-[0.98] transition-transform"
          >
            <div className="relative w-10 h-10 shrink-0 flex items-center justify-center">
              <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="var(--bg-pill)" strokeWidth="3.2" />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke={nextSub.color || 'var(--accent)'}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  strokeDasharray="88"
                  strokeDashoffset={Math.max(8, (Math.max(0, nextSub.daysLeft) / 31) * 88)}
                />
              </svg>
              <span className="absolute text-[10px] font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {nextSub.daysLeft < 0 ? `${-nextSub.daysLeft}d!` : `${nextSub.daysLeft}d`}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div
                className="text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1"
                style={{ color: nextSub.daysLeft < 0 ? 'var(--warning)' : 'var(--accent)' }}
              >
                <Sparkles size={10} />
                {nextSub.daysLeft < 0 ? 'Overdue' : 'Renewing'}
              </div>
              <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                {nextSub.name}
              </div>
              <div
                className={`text-[11px] font-medium tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`}
                style={{ color: 'var(--text-secondary)' }}
              >
                {privacyBlur ? '••••' : `${formatAmt(nextSub.amount)} ${currency}`}
              </div>
            </div>
          </button>
        )}

        {!isViewer && (
          <motion.button
            type="button"
            onClick={handleStreakTap}
            animate={streakAnimating ? { scale: [1, 1.07, 0.96, 1.02, 1] } : { scale: 1 }}
            transition={{ duration: 0.45 }}
            className="surface-card p-3 flex items-center gap-2.5 text-left active:scale-[0.98] transition-transform"
          >
            <motion.div
              animate={streakAnimating ? { rotate: [0, -14, 14, -8, 0], scale: [1, 1.25, 1] } : {}}
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: streakInfo.streak > 0 ? 'rgba(245, 158, 11, 0.16)' : 'var(--bg-pill)',
                color: streakInfo.streak > 0 ? '#F59E0B' : 'var(--text-muted)',
              }}
            >
              <Flame size={20} fill={streakInfo.streak > 0 ? 'currentColor' : 'none'} />
            </motion.div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                {streakInfo.loggedToday ? 'Today logged' : 'Logging streak'}
              </div>
              <div className="text-[13px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                {streakInfo.streak ? `${streakInfo.streak}-Day Streak` : 'Start a streak'}
              </div>
              <div className="flex items-center gap-1 mt-1">
                {streakInfo.week.map((d) => (
                  <span
                    key={d.date}
                    className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: d.on ? '#10B981' : d.today ? 'var(--accent-soft)' : 'var(--bg-pill)',
                      border: d.today && !d.on ? '1px solid var(--accent)' : 'none',
                      color: '#fff',
                    }}
                  >
                    {d.on && <Check size={8} strokeWidth={3} />}
                  </span>
                ))}
              </div>
            </div>
          </motion.button>
        )}
      </div>

      {/* Accounts Overview */}
      {accounts.length > 1 && (
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Accounts Overview
            </h3>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Tap to filter
            </span>
          </div>

          <div className="space-y-2">
            {accounts.map((acc) => {
              const isAccCash = acc.type === 'cash';
              const spentInAcc = allEntries
                .filter((e) => e.type === 'expense' && e.date.slice(0, 7) === month && e.account === acc.name)
                .reduce((s, e) => s + e.amount, 0);
              const val = isAccCash && acc.limit > 0 ? acc.balance : spentInAcc;
              const limit = isAccCash ? 0 : Number(acc.limit) || 0;
              const share =
                limit > 0
                  ? Math.max(4, Math.min(100, Math.round((spentInAcc / limit) * 100)))
                  : 18;
              const isActive = account === acc.id;

              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setAccount(isActive ? 'all' : acc.id)}
                  className="w-full p-2 rounded-xl border text-left transition-colors"
                  style={{
                    backgroundColor: isActive ? 'var(--accent-soft)' : 'transparent',
                    borderColor: isActive ? 'var(--accent)' : 'var(--border-subtle)',
                  }}
                >
                  <div className="flex items-center justify-between text-[12px] mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: acc.color }} />
                      <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {acc.name}
                      </span>
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--text-muted)' }}>
                        {isAccCash ? 'Cash' : 'Card'}
                      </span>
                    </div>
                    <span
                      className={`font-bold tabular-nums shrink-0 ${privacyBlur ? 'privacy-mask' : ''}`}
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {privacyBlur ? (
                        '••••'
                      ) : (
                        <>
                          <NumberFlow value={val} format={{ maximumFractionDigits: 2 }} />
                          {isAccCash && acc.limit > 0
                            ? ` on hand`
                            : limit > 0
                              ? ` / ${formatEGP(limit)}`
                              : ` ${currency}`}
                        </>
                      )}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-pill)' }}>
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${share}%`, backgroundColor: acc.color }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Where It Went */}
      <div className="surface-card p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Where It Went
          </h3>
          <button
            type="button"
            onClick={() => onNavigateActivity()}
            className="text-[11px] font-semibold inline-flex items-center gap-0.5"
            style={{ color: 'var(--accent)' }}
          >
            Explore <ChevronRight size={13} />
          </button>
        </div>

        <div className="space-y-2.5">
          {topCats.length === 0 ? (
            <div className="text-[12px] py-2 text-center" style={{ color: 'var(--text-muted)' }}>
              No expenses recorded for this selection
            </div>
          ) : (
            topCats.map((item) => (
              <button
                key={item.cat}
                type="button"
                onClick={() => onNavigateActivity({ category: item.cat })}
                className="w-full text-left group"
              >
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                    <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {item.cat}
                    </span>
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {privacyBlur ? '••' : `${item.pct}%`}
                    </span>
                  </div>
                  <span
                    className={`font-bold tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`}
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {privacyBlur ? (
                      '••••'
                    ) : (
                      <>
                        <NumberFlow value={item.amount} format={{ maximumFractionDigits: 2 }} /> {currency}
                      </>
                    )}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-pill)' }}>
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                  />
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Latest Transactions */}
      <div className="surface-card p-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Latest Transactions
          </h3>
          <button
            type="button"
            onClick={() => onNavigateActivity()}
            className="text-[11px] font-semibold inline-flex items-center gap-0.5"
            style={{ color: 'var(--accent)' }}
          >
            See all <ChevronRight size={13} />
          </button>
        </div>

        {latestFive.length === 0 ? (
          <div className="text-[12px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>
            {isViewer ? 'No transactions in this month.' : 'Tap + below to log your first entry.'}
          </div>
        ) : (
          <div className="space-y-2">
            {latestFive.map((tx, idx) => (
              <SwipeableTxRow
                key={tx.id}
                tx={tx}
                accounts={accounts}
                catOrder={catOrder}
                currency={currency}
                onEdit={onEditTx}
                onCopy={onCopyTx}
                onDelete={onDeleteTx}
                privacyBlur={privacyBlur}
                showSwipeHint={idx === 0 && !hasSwipedHint}
                onFirstSwipe={onFirstSwipe}
                showDate
                isViewer={isViewer}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
