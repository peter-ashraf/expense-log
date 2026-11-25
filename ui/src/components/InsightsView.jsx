import React, { useMemo, useState } from 'react';
import NumberFlow from '@number-flow/react';
import { MapPin, ArrowRight, Sparkles, Store } from 'lucide-react';
import { formatAmt, formatEGP, getCategoryColor } from '../lib/helpers';
import { computeAllTime, computeInsights, scopedMonth, topMerchants, util, weeklySeries } from '../lib/bridge';
import SlidingHighlight from './SlidingHighlight';

export default function InsightsView({
  viewData,
  month,
  months = [],
  account,
  allEntries = [],
  monthEntries = [],
  catOrder = [],
  monthlyBudget = 0,
  currency = 'EGP',
  privacyBlur = false,
  onNavigateActivity,
}) {
  const [selectedCat, setSelectedCat] = useState(null);
  const [trendMode, setTrendMode] = useState('7d'); // '7d' | '6m'
  const [selectedBarIdx, setSelectedBarIdx] = useState(null);
  const [selectedPlace, setSelectedPlace] = useState('');
  const [insightScope, setInsightScope] = useState('month'); // 'month' | 'all'

  const monthShort = month ? util.keyShort(month) : '';
  const [mYear, mNum] = (month || util.currentKey()).split('-').map(Number);
  const daysInMonth = new Date(mYear || 2026, mNum || 1, 0).getDate();
  const today = util.todayStr();
  const isCurrent = month === today.slice(0, 7);
  const currentDay = isCurrent ? Math.max(1, Number(today.slice(8, 10))) : daysInMonth;

  const monthExpenses = useMemo(
    () => monthEntries.filter((t) => t.type === 'expense'),
    [monthEntries]
  );
  const monthIncome = useMemo(
    () => monthEntries.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    [monthEntries]
  );
  const totalSpent = useMemo(
    () => monthExpenses.reduce((s, t) => s + t.amount, 0),
    [monthExpenses]
  );

  // Category Breakdown Donut
  const catSegments = useMemo(() => {
    const map = {};
    for (const tx of monthExpenses) {
      map[tx.category] = (map[tx.category] || 0) + tx.amount;
    }
    const entries = Object.entries(map)
      .map(([cat, amount]) => ({
        cat,
        amount,
        pct: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
        color: getCategoryColor(cat, catOrder),
      }))
      .sort((a, b) => b.amount - a.amount);

    const R = 56;
    const C = 2 * Math.PI * R;
    let offset = 0;
    return entries.map((e) => {
      const len = totalSpent > 0 ? (e.amount / totalSpent) * C : 0;
      const seg = { ...e, len, dashOffset: -offset, circumference: C, radius: R };
      offset += len;
      return seg;
    });
  }, [monthExpenses, totalSpent, catOrder]);

  const activeSegment = catSegments.find((s) => s.cat === selectedCat) || null;
  const donutCenterAmount = activeSegment ? activeSegment.amount : totalSpent;
  const donutCenterLabel = activeSegment
    ? `${activeSegment.cat} · ${activeSegment.pct}%`
    : `${monthShort} Total`;

  // 2x2 Bento KPIs
  const largestTx = useMemo(() => {
    if (!monthExpenses.length) return { amount: 0, seller: 'None', title: 'None' };
    return [...monthExpenses].sort((a, b) => b.amount - a.amount)[0];
  }, [monthExpenses]);

  const dailyAvg = Math.round(totalSpent / Math.max(1, currentDay));
  const savingsRate =
    monthIncome > 0 ? Math.max(0, Math.round(((monthIncome - totalSpent) / monthIncome) * 100)) : 0;

  // Trend Bars (7d vs 6m using real weeklySeries & real months)
  const trendBars = useMemo(() => {
    if (trendMode === '7d') {
      const endDay = isCurrent
        ? today
        : `${month}-${String(daysInMonth).padStart(2, '0')}`;
      const rawAllExp = allEntries
        .filter((e) => e.type === 'expense' && (account === 'all' || e.account === account))
        .map((e) => ({ date: e.date, type: 'Expense', amount: e.amount }));
      const wk = weeklySeries(rawAllExp, endDay);
      return wk.days.map((d) => ({
        label: String(Number(d.date.slice(8, 10))),
        fullLabel: util.dateLong(d.date),
        value: d.amt,
      }));
    }

    const recent6 = [...months].reverse().slice(-6);
    return recent6.map((m) => {
      const spent = allEntries
        .filter((e) => e.type === 'expense' && e.date.slice(0, 7) === m.key && (account === 'all' || e.account === account))
        .reduce((s, e) => s + e.amount, 0);
      return {
        label: util.keyShort(m.key),
        fullLabel: m.label,
        value: spent,
      };
    });
  }, [trendMode, month, isCurrent, today, daysInMonth, allEntries, account, months]);

  const maxBar = Math.max(1, ...trendBars.map((b) => b.value));
  const activeBar =
    selectedBarIdx !== null && trendBars[selectedBarIdx]
      ? trendBars[selectedBarIdx]
      : trendBars[trendBars.length - 1] || { fullLabel: '', value: 0 };

  // Real Places Spent (leveraging v3.18 place|lat,lon data)
  const realPlaces = useMemo(() => {
    const source =
      insightScope === 'all'
        ? allEntries.filter((e) => e.type === 'expense' && (account === 'all' || e.account === account))
        : monthExpenses;
    const map = new Map();
    for (const tx of source) {
      if (!tx.locationRaw) continue;
      const loc = util.parseLoc(tx.locationRaw);
      const label = (loc?.place || '').trim() || (loc?.lat != null ? `${loc.lat.toFixed(3)}, ${loc.lon.toFixed(3)}` : '');
      if (!label) continue;
      const key = label.toLowerCase();
      const cur = map.get(key) || {
        id: label,
        label,
        total: 0,
        count: 0,
        lat: loc?.lat,
        lon: loc?.lon,
        href: tx.mapHref,
      };
      cur.total += tx.amount;
      cur.count += 1;
      if (loc?.lat != null && cur.lat == null) {
        cur.lat = loc.lat;
        cur.lon = loc.lon;
      }
      map.set(key, cur);
    }
    const list = [...map.values()].sort((a, b) => b.total - a.total).slice(0, 8);
    // Project real lat/lon into 20..82% pin coords when coords exist
    const withCoords = list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (withCoords.length >= 2) {
      const minLat = Math.min(...withCoords.map((p) => p.lat));
      const maxLat = Math.max(...withCoords.map((p) => p.lat));
      const minLon = Math.min(...withCoords.map((p) => p.lon));
      const maxLon = Math.max(...withCoords.map((p) => p.lon));
      const dLat = Math.max(0.01, maxLat - minLat);
      const dLon = Math.max(0.01, maxLon - minLon);
      list.forEach((p, idx) => {
        if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
          p.xPct = 18 + ((p.lon - minLon) / dLon) * 64;
          p.yPct = 78 - ((p.lat - minLat) / dLat) * 56;
        } else {
          p.xPct = 20 + ((idx * 19) % 60);
          p.yPct = 25 + ((idx * 23) % 50);
        }
      });
    } else {
      list.forEach((p, idx) => {
        p.xPct = 22 + ((idx * 21) % 56);
        p.yPct = 28 + ((idx * 17) % 46);
      });
    }
    return list;
  }, [allEntries, monthExpenses, insightScope, account]);

  const activePlaceObj = realPlaces.find((p) => p.id === selectedPlace) || realPlaces[0] || null;

  // Real Top Merchants via js/insights.js
  const merchants = useMemo(() => {
    const raw = monthExpenses.map((e) => e.raw || {
      type: 'Expense',
      seller: e.seller,
      description: e.title,
      amount: e.amount,
    });
    return topMerchants(raw, 5);
  }, [monthExpenses]);
  const maxMerchant = Math.max(1, merchants[0]?.amt || 1);

  // Real Smart Insights via js/insights.js
  const smartInsights = useMemo(() => {
    const chronoMonths = [...months].reverse();
    const mName = (k) => util.keyLabel(k).split(' ')[0];
    if (insightScope === 'all') {
      return computeAllTime({
        months: chronoMonths.map((mo) => ({
          key: mo.key,
          entries: scopedMonth(viewData, mo.key, account).entries,
        })),
        today,
        fmt: formatEGP,
        monthName: mName,
      });
    }
    const idx = chronoMonths.findIndex((mo) => mo.key === month);
    const curScoped = scopedMonth(viewData, month, account);
    const prevScoped = idx > 0 ? scopedMonth(viewData, chronoMonths[idx - 1].key, account) : null;
    const history = chronoMonths.flatMap((mo) =>
      scopedMonth(viewData, mo.key, account).entries.filter((e) => e.type === 'Expense')
    );
    return computeInsights({
      m: curScoped,
      prev: prevScoped,
      today,
      fmt: formatEGP,
      monthName: mName,
      budget: monthlyBudget,
      history,
    });
  }, [insightScope, months, viewData, month, account, today, monthlyBudget]);

  const toneColor = (tone) =>
    tone === 'good' ? '#10B981' : tone === 'warn' ? '#F59E0B' : 'var(--accent)';

  return (
    <div className="px-4 pt-1 pb-28 space-y-3.5">
      {/* Interactive Tappable Donut */}
      <div className="surface-card p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display text-[15px] font-bold" style={{ color: 'var(--text-primary)' }}>
            Category Breakdown
          </h3>
          {selectedCat && (
            <button
              type="button"
              onClick={() => onNavigateActivity({ category: selectedCat })}
              className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <span>View in Activity</span>
              <ArrowRight size={12} />
            </button>
          )}
        </div>

        {catSegments.length === 0 ? (
          <div className="text-[12px] py-8 text-center" style={{ color: 'var(--text-muted)' }}>
            No expenses this month.
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="relative w-44 h-44 flex items-center justify-center">
              <svg viewBox="0 0 148 148" className="w-44 h-44 -rotate-90">
                <circle cx="74" cy="74" r="56" fill="none" stroke="var(--bg-pill)" strokeWidth="16" />
                {catSegments.map((seg) => {
                  const isSel = selectedCat === seg.cat;
                  const dimmed = selectedCat && !isSel;
                  return (
                    <circle
                      key={seg.cat}
                      cx="74"
                      cy="74"
                      r={seg.radius}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth={isSel ? 22 : 16}
                      strokeDasharray={`${Math.max(0, seg.len - 2)} ${seg.circumference}`}
                      strokeDashoffset={seg.dashOffset}
                      opacity={dimmed ? 0.3 : 1}
                      className="cursor-pointer transition-all duration-300"
                      onClick={() => setSelectedCat((c) => (c === seg.cat ? null : seg.cat))}
                    />
                  );
                })}
              </svg>

              <button
                type="button"
                onClick={() => setSelectedCat(null)}
                className="absolute inset-8 rounded-full flex flex-col items-center justify-center text-center"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
                  {donutCenterLabel}
                </span>
                <span
                  className={`text-[20px] font-extrabold tabular-nums mt-0.5 ${
                    privacyBlur ? 'privacy-mask' : ''
                  }`}
                  style={{ color: 'var(--text-primary)' }}
                >
                  {privacyBlur ? '••••' : <NumberFlow value={donutCenterAmount} format={{ maximumFractionDigits: 0 }} />}
                </span>
                <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                  {currency}
                </span>
              </button>
            </div>

            <div className="w-full grid grid-cols-2 gap-1.5 mt-2">
              {catSegments.map((seg) => {
                const isSel = selectedCat === seg.cat;
                return (
                  <button
                    key={seg.cat}
                    type="button"
                    onClick={() => setSelectedCat((c) => (c === seg.cat ? null : seg.cat))}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-xl border text-left transition-colors"
                    style={{
                      backgroundColor: isSel ? 'var(--accent-soft)' : 'var(--bg-pill)',
                      borderColor: isSel ? 'var(--accent)' : 'transparent',
                    }}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: seg.color }} />
                      <span className="text-[11px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                        {seg.cat}
                      </span>
                    </div>
                    <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: 'var(--text-secondary)' }}>
                      {privacyBlur ? '••' : `${seg.pct}%`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* 2x2 Bento KPIs */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="surface-card p-3">
          <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Daily Avg
          </div>
          <div className={`text-[20px] font-extrabold tabular-nums mt-0.5 ${privacyBlur ? 'privacy-mask' : ''}`}>
            {privacyBlur ? '••••' : <NumberFlow value={dailyAvg} format={{ maximumFractionDigits: 0 }} />}{' '}
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {currency}
            </span>
          </div>
        </div>

        <div className="surface-card p-3">
          <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Transactions
          </div>
          <div className="text-[20px] font-extrabold tabular-nums mt-0.5">
            <NumberFlow value={monthEntries.length} format={{ maximumFractionDigits: 0 }} />{' '}
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              entries
            </span>
          </div>
        </div>

        <div className="surface-card p-3">
          <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Largest Spend
          </div>
          <div className={`text-[20px] font-extrabold tabular-nums mt-0.5 ${privacyBlur ? 'privacy-mask' : ''}`}>
            {privacyBlur ? '••••' : <NumberFlow value={largestTx.amount} format={{ maximumFractionDigits: 0 }} />}{' '}
            <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {currency}
            </span>
          </div>
          <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
            {largestTx.seller || largestTx.title}
          </div>
        </div>

        <div className="surface-card p-3">
          <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            Savings Rate
          </div>
          <div className="text-[20px] font-extrabold tabular-nums mt-0.5" style={{ color: 'var(--positive)' }}>
            {privacyBlur ? '••%' : <NumberFlow value={savingsRate} suffix="%" format={{ maximumFractionDigits: 0 }} />}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            of monthly income
          </div>
        </div>
      </div>

      {/* Interactive Trend Chart */}
      <div className="surface-card p-3.5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <div className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
              {activeBar?.fullLabel}
            </div>
            <div className={`text-[17px] font-extrabold tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`}>
              {privacyBlur ? '••••' : <NumberFlow value={activeBar?.value || 0} format={{ maximumFractionDigits: 0 }} />}{' '}
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {currency}
              </span>
            </div>
          </div>

          <SlidingHighlight
            activeKey={trendMode}
            onSelect={(next) => {
              setTrendMode(next);
              setSelectedBarIdx(null);
            }}
            className="flex p-0.5 rounded-xl border"
            style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
            pillClassName="rounded-[9px]"
            pillStyle={{ backgroundColor: 'var(--accent)' }}
          >
            {[
              { id: '7d', label: '7 Days' },
              { id: '6m', label: '6 Months' },
            ].map((t) => {
              const active = trendMode === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-hl={t.id}
                  onClick={() => {
                    setTrendMode(t.id);
                    setSelectedBarIdx(null);
                  }}
                  className="relative px-2.5 py-1 text-[11px] font-semibold rounded-[9px] z-10 transition-colors"
                  style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                >
                  {t.label}
                </button>
              );
            })}
          </SlidingHighlight>
        </div>

        <div className="grid grid-flow-col auto-cols-fr gap-2 items-end h-28 pt-2">
          {trendBars.map((b, i) => {
            const active =
              selectedBarIdx === null ? i === trendBars.length - 1 : selectedBarIdx === i;
            const hPct = b.value > 0 ? Math.max(10, Math.round((b.value / maxBar) * 100)) : 4;
            return (
              <button
                key={`${b.label}-${i}`}
                type="button"
                onClick={() => setSelectedBarIdx(i)}
                className="flex flex-col items-center justify-end h-full gap-1.5 group"
              >
                <div className="w-full flex-1 flex items-end justify-center">
                  <div
                    className="w-full max-w-[28px] rounded-t-lg transition-all duration-300"
                    style={{
                      height: `${hPct}%`,
                      backgroundColor: active ? 'var(--accent)' : 'var(--bg-pill)',
                      opacity: active ? 1 : 0.78,
                    }}
                  />
                </div>
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  {b.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Places Spent (from real location-tagged entries) */}
      <div className="surface-card p-3.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <MapPin size={15} style={{ color: 'var(--accent)' }} />
            <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Places Spent
            </h3>
          </div>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {realPlaces.length ? 'Tap a pin' : 'Location tags'}
          </span>
        </div>

        {realPlaces.length === 0 ? (
          <div
            className="p-4 rounded-2xl border text-center text-[12px]"
            style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)', color: 'var(--text-muted)' }}
          >
            Log entries with location enabled or use your SMS Shortcut to see where your spending happens.
          </div>
        ) : (
          <>
            <div
              className="relative w-full h-44 rounded-2xl border overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-pill)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              <svg viewBox="0 0 340 210" className="w-full h-full">
                <g stroke="var(--border-subtle)" strokeWidth="0.7" opacity="0.65">
                  <line x1="0" y1="52" x2="340" y2="52" />
                  <line x1="0" y1="105" x2="340" y2="105" />
                  <line x1="0" y1="158" x2="340" y2="158" />
                  <line x1="85" y1="0" x2="85" y2="210" />
                  <line x1="170" y1="0" x2="170" y2="210" />
                  <line x1="255" y1="0" x2="255" y2="210" />
                </g>
                <circle
                  cx="170"
                  cy="105"
                  r="64"
                  fill="none"
                  stroke="var(--border-strong)"
                  strokeWidth="1.2"
                  strokeDasharray="4 4"
                />
              </svg>

              {realPlaces.map((p) => {
                const active = activePlaceObj?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPlace(p.id)}
                    style={{ left: `${p.xPct}%`, top: `${p.yPct}%` }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center z-10"
                  >
                    <div className="relative flex items-center justify-center w-8 h-8">
                      {active && (
                        <div
                          className="absolute inset-0 rounded-full animate-pulse"
                          style={{
                            backgroundColor: 'var(--accent-soft)',
                            border: '2px solid var(--accent)',
                          }}
                        />
                      )}
                      <span
                        className="w-3.5 h-3.5 rounded-full border-2 shadow-sm transition-transform"
                        style={{
                          backgroundColor: active ? 'var(--accent)' : 'var(--bg-card-solid)',
                          borderColor: active ? '#FFFFFF' : 'var(--accent)',
                          transform: active ? 'scale(1.15)' : 'scale(1)',
                        }}
                      />
                    </div>
                    <span
                      className="px-1.5 py-0.5 rounded-md text-[9px] font-bold whitespace-nowrap max-w-[96px] truncate shadow-sm"
                      style={{
                        backgroundColor: active ? 'var(--accent)' : 'var(--bg-card-solid)',
                        color: active ? 'var(--accent-fg)' : 'var(--text-primary)',
                      }}
                    >
                      {p.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {activePlaceObj && (
              <div
                className="mt-2.5 p-2.5 rounded-xl border flex items-center justify-between gap-2"
                style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
              >
                <div className="min-w-0">
                  <div className="text-[12px] font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                    {activePlaceObj.label}
                  </div>
                  <div className="text-[11px] tabular-nums mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    <span className={`font-bold ${privacyBlur ? 'privacy-mask' : ''}`} style={{ color: 'var(--text-primary)' }}>
                      {privacyBlur ? '••••' : <NumberFlow value={activePlaceObj.total} format={{ maximumFractionDigits: 0 }} />} {currency}
                    </span>{' '}
                    across {activePlaceObj.count} {activePlaceObj.count === 1 ? 'visit' : 'visits'}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigateActivity({ place: activePlaceObj.label })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold shrink-0"
                  style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
                >
                  <span>Filter</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Top Merchants */}
      {merchants.length > 0 && (
        <div className="surface-card p-3.5">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5">
              <Store size={15} style={{ color: 'var(--accent)' }} />
              <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
                Top Merchants
              </h3>
            </div>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Tap to search
            </span>
          </div>

          <div className="space-y-2.5">
            {merchants.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => onNavigateActivity({ search: m.name })}
                className="w-full text-left"
              >
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="font-semibold truncate pr-2" style={{ color: 'var(--text-primary)' }}>
                    {m.name}{' '}
                    <span className="text-[10px] font-normal" style={{ color: 'var(--text-muted)' }}>
                      ({m.n}×)
                    </span>
                  </span>
                  <span className={`font-bold tabular-nums shrink-0 ${privacyBlur ? 'privacy-mask' : ''}`}>
                    {privacyBlur ? '••••' : `${formatAmt(m.amt)} ${currency}`}
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-pill)' }}>
                  <div
                    className="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${Math.round((m.amt / maxMerchant) * 100)}%`,
                      backgroundColor: 'var(--accent)',
                    }}
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Real Smart Insights */}
      <div className="surface-card p-3.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Sparkles size={15} style={{ color: 'var(--accent)' }} />
            <h3 className="font-display text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
              Smart Insights
            </h3>
          </div>

          <SlidingHighlight
            activeKey={insightScope}
            onSelect={setInsightScope}
            className="flex p-0.5 rounded-xl border"
            style={{ backgroundColor: 'var(--bg-pill)', borderColor: 'var(--border-subtle)' }}
            pillClassName="rounded-[9px]"
            pillStyle={{ backgroundColor: 'var(--accent)' }}
          >
            {[
              { id: 'month', label: 'This Month' },
              { id: 'all', label: 'All Time' },
            ].map((s) => {
              const active = insightScope === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-hl={s.id}
                  onClick={() => setInsightScope(s.id)}
                  className="relative px-2 py-0.5 text-[10px] font-semibold rounded-[9px] z-10 transition-colors"
                  style={{ color: active ? 'var(--accent-fg)' : 'var(--text-secondary)' }}
                >
                  {s.label}
                </button>
              );
            })}
          </SlidingHighlight>
        </div>

        {!smartInsights.enough ? (
          <div className="text-[12px] py-3 text-center" style={{ color: 'var(--text-muted)' }}>
            {insightScope === 'all'
              ? 'Add a few more expenses across months to unlock pattern insights.'
              : `Add at least 3 expenses in ${monthShort} to spot patterns.`}
          </div>
        ) : (
          <div className="space-y-2">
            {smartInsights.items.map((ins) => (
              <button
                key={ins.id}
                type="button"
                disabled={!ins.q}
                onClick={() => ins.q && onNavigateActivity({ search: ins.q })}
                className="w-full text-left p-2.5 rounded-xl border disabled:cursor-default"
                style={{
                  backgroundColor: 'var(--bg-pill)',
                  borderColor: 'var(--border-subtle)',
                  borderLeft: `3px solid ${toneColor(ins.tone)}`,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {ins.title}
                  </span>
                  {ins.badge && (
                    <span className="text-[10px] font-bold shrink-0" style={{ color: toneColor(ins.tone) }}>
                      {ins.badge}
                    </span>
                  )}
                </div>
                <div className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  {ins.detail}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
