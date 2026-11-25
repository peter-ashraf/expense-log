import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useIsPresent } from 'motion/react';
import NumberFlow from '@number-flow/react';
import { Search, X, MapPin, CheckSquare, Trash2, ArrowRightLeft, Tag, Calendar } from 'lucide-react';
import { getDayLabel, getMonthKey } from '../lib/helpers';
import SwipeableTxRow from './SwipeableTxRow';
import SlidingHighlight from './SlidingHighlight';

export default function ActivityView({
  month,
  account,
  accounts = [],
  categories = { order: [], map: {} },
  entries = [],
  currency = 'EGP',
  searchQuery,
  setSearchQuery,
  catFilter,
  setCatFilter,
  placeFilter,
  setPlaceFilter,
  privacyBlur = false,
  onEditTx,
  onCopyTx,
  onDeleteTx,
  onBulkDelete,
  onBulkMoveAccount,
  onBulkChangeCategory,
  hasSwipedHint,
  onFirstSwipe,
  isViewer = false,
}) {
  const isPresent = useIsPresent();
  const [typeFilter, setTypeFilter] = useState('all'); // 'all' | 'expense' | 'income'
  const [onlyLocation, setOnlyLocation] = useState(false);
  const [allMonths, setAllMonths] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkSubmenu, setBulkSubmenu] = useState(null); // null | 'account' | 'category'
  const [pendingCat, setPendingCat] = useState(categories.order[0] || '');

  const catPills = useMemo(() => ['All', ...(categories.order || [])], [categories.order]);

  const matchesFilter = (tx) => {
    if (account !== 'all' && tx.account !== account) return false;
    if (typeFilter !== 'all' && tx.type !== typeFilter) return false;
    if (onlyLocation && !tx.locationRaw) return false;
    if (placeFilter) {
      const target = placeFilter.toLowerCase();
      if (!(tx.place || '').toLowerCase().includes(target)) return false;
    }
    if (catFilter !== 'All' && tx.category !== catFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      const hay = `${tx.title} ${tx.seller || ''} ${tx.category} ${tx.subCategory || ''} ${
        tx.place || ''
      } ${tx.note || ''} ${tx.amount}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  const { currentGrouped, earlierMatches, allVisibleIds, filteredNet, filteredCount } = useMemo(() => {
    const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
    const current = [];
    const earlier = [];

    for (const tx of sorted) {
      if (!matchesFilter(tx)) continue;
      const mKey = getMonthKey(tx.date);
      if (mKey === month) {
        current.push(tx);
      } else if (allMonths || searchQuery.trim().length > 0 || placeFilter) {
        earlier.push(tx);
      }
    }

    const groupByDay = (list) => {
      const groups = [];
      const map = new Map();
      for (const tx of list) {
        if (!map.has(tx.date)) {
          const g = { date: tx.date, items: [], net: 0 };
          map.set(tx.date, g);
          groups.push(g);
        }
        const g = map.get(tx.date);
        g.items.push(tx);
        g.net += tx.type === 'income' ? tx.amount : -tx.amount;
      }
      return groups;
    };

    const allFiltered = [...current, ...earlier];
    let net = 0;
    for (const tx of allFiltered) {
      net += tx.type === 'income' ? tx.amount : -tx.amount;
    }

    return {
      currentGrouped: groupByDay(current),
      earlierMatches: groupByDay(earlier),
      allVisibleIds: allFiltered.map((t) => t.id),
      filteredNet: Math.round(net * 100) / 100,
      filteredCount: allFiltered.length,
    };
  }, [entries, month, account, typeFilter, onlyLocation, placeFilter, catFilter, searchQuery, allMonths]);

  const hasActiveFilter =
    typeFilter !== 'all' ||
    onlyLocation ||
    Boolean(placeFilter) ||
    catFilter !== 'All' ||
    searchQuery.trim().length > 0;

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const selectedNet = useMemo(() => {
    const set = new Set(selectedIds);
    let net = 0;
    for (const tx of entries) {
      if (set.has(tx.id)) {
        net += tx.type === 'income' ? tx.amount : -tx.amount;
      }
    }
    return Math.round(net * 100) / 100;
  }, [entries, selectedIds]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds([]);
    setBulkSubmenu(null);
  };

  return (
    <div
      className={`px-4 pt-1 space-y-3 ${
        selectMode ? 'pb-48' : hasActiveFilter ? 'pb-40' : 'pb-28'
      }`}
    >
      {/* Search Bar */}
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-2xl border"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <Search size={16} style={{ color: 'var(--text-muted)' }} />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search seller, place, note, ${currency}…`}
          className="flex-1 bg-transparent outline-none text-[16px] leading-snug"
          style={{ color: 'var(--text-primary)' }}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--bg-pill)', color: 'var(--text-secondary)' }}
            aria-label="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Primary Filter Chips Row — Pinned Select on far right, filter chips scroll next to it */}
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0 flex items-center gap-1.5 overflow-x-auto no-scrollbar mask-fade-right pr-2">
          {[
            { id: 'all', label: 'All' },
            { id: 'expense', label: 'Expenses' },
            { id: 'income', label: 'Income' },
          ].map((item) => {
            const active = typeFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTypeFilter(item.id)}
                className="px-3 py-1.5 rounded-full text-[12px] font-semibold border shrink-0 transition-colors"
                style={{
                  backgroundColor: active ? 'var(--accent)' : 'var(--bg-card)',
                  borderColor: active ? 'var(--accent)' : 'var(--border-subtle)',
                  color: active ? 'var(--accent-fg)' : 'var(--text-secondary)',
                }}
              >
                {item.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setOnlyLocation((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold border shrink-0 transition-colors"
            style={{
              backgroundColor: onlyLocation ? 'var(--accent-soft)' : 'var(--bg-card)',
              borderColor: onlyLocation ? 'var(--accent)' : 'var(--border-subtle)',
              color: onlyLocation ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <MapPin size={12} />
            <span>Location</span>
          </button>

          <button
            type="button"
            onClick={() => setAllMonths((v) => !v)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold border shrink-0 transition-colors"
            style={{
              backgroundColor: allMonths ? 'var(--accent-soft)' : 'var(--bg-card)',
              borderColor: allMonths ? 'var(--accent)' : 'var(--border-subtle)',
              color: allMonths ? 'var(--accent)' : 'var(--text-secondary)',
            }}
          >
            <Calendar size={12} />
            <span>All Months</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold border shrink-0 transition-colors"
          style={{
            backgroundColor: selectMode ? 'var(--accent)' : 'var(--bg-card)',
            borderColor: selectMode ? 'var(--accent)' : 'var(--border-subtle)',
            color: selectMode ? 'var(--accent-fg)' : 'var(--text-secondary)',
          }}
        >
          <CheckSquare size={12} />
          <span>{selectMode ? 'Done' : 'Select'}</span>
        </button>
      </div>

      {/* Category Pills Row + Active Place Badge */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {placeFilter && (
          <button
            type="button"
            onClick={() => setPlaceFilter('')}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 border"
            style={{
              backgroundColor: 'var(--accent-soft)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            <MapPin size={11} />
            <span>{placeFilter}</span>
            <X size={11} />
          </button>
        )}

        <SlidingHighlight
          activeKey={catFilter}
          className="flex items-center gap-1.5 w-max"
          pillClassName="rounded-full"
          pillStyle={{ backgroundColor: 'var(--accent)' }}
        >
          {catPills.map((cat) => {
            const active = catFilter === cat;
            return (
              <button
                key={cat}
                type="button"
                data-hl={cat}
                onClick={() => setCatFilter(cat)}
                className="relative px-3 py-1 rounded-full text-[11px] font-semibold shrink-0 z-10 transition-colors"
                style={{
                  color: active ? 'var(--accent-fg)' : 'var(--text-secondary)',
                  backgroundColor: active ? 'transparent' : 'var(--bg-pill)',
                }}
              >
                {cat}
              </button>
            );
          })}
        </SlidingHighlight>
      </div>

      {/* Current Month Grouped List */}
      <div className="space-y-4">
        {currentGrouped.length === 0 && earlierMatches.length === 0 ? (
          <div className="surface-card p-8 text-center">
            <div className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>
              No matching transactions
            </div>
            <div className="text-[12px] mt-1" style={{ color: 'var(--text-muted)' }}>
              Try clearing a category, place, or search filter.
            </div>
          </div>
        ) : (
          currentGrouped.map((group, gIdx) => (
            <div key={group.date} className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[12px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                  {getDayLabel(group.date)}
                </span>
                <span
                  className={`text-[11px] font-semibold tabular-nums ${
                    privacyBlur ? 'privacy-mask' : ''
                  }`}
                  style={{
                    color: group.net >= 0 ? 'var(--positive)' : 'var(--text-muted)',
                  }}
                >
                  {privacyBlur ? '••••' : `${group.net >= 0 ? '+' : ''}${Math.round(group.net).toLocaleString('en-US')} ${currency}`}
                </span>
              </div>

              <div className="space-y-1.5">
                {group.items.map((tx, tIdx) => (
                  <SwipeableTxRow
                    key={tx.id}
                    tx={tx}
                    accounts={accounts}
                    catOrder={categories.order}
                    currency={currency}
                    onEdit={onEditTx}
                    onCopy={onCopyTx}
                    onDelete={onDeleteTx}
                    privacyBlur={privacyBlur}
                    selectMode={selectMode}
                    isSelected={selectedIds.includes(tx.id)}
                    onToggleSelect={toggleSelect}
                    showSwipeHint={gIdx === 0 && tIdx === 0 && !hasSwipedHint}
                    onFirstSwipe={onFirstSwipe}
                    isViewer={isViewer}
                  />
                ))}
              </div>
            </div>
          ))
        )}

        {/* Cross-Month Earlier Matches */}
        {earlierMatches.length > 0 && (
          <div className="pt-2 space-y-3">
            <div className="flex items-center gap-2 px-1">
              <span
                className="text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--accent)' }}
              >
                Matches in Earlier Months
              </span>
              <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border-subtle)' }} />
            </div>

            {earlierMatches.map((group) => (
              <div key={group.date} className="space-y-1.5">
                <div className="flex items-center justify-between px-1">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--text-secondary)' }}>
                    {getDayLabel(group.date)}
                  </span>
                  <span
                    className={`text-[11px] font-semibold tabular-nums ${
                      privacyBlur ? 'privacy-mask' : ''
                    }`}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {privacyBlur ? '••••' : `${group.net >= 0 ? '+' : ''}${Math.round(group.net).toLocaleString('en-US')} ${currency}`}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {group.items.map((tx) => (
                    <SwipeableTxRow
                      key={tx.id}
                      tx={tx}
                      accounts={accounts}
                      catOrder={categories.order}
                      currency={currency}
                      onEdit={onEditTx}
                      onCopy={onCopyTx}
                      onDelete={onDeleteTx}
                      privacyBlur={privacyBlur}
                      selectMode={selectMode}
                      isSelected={selectedIds.includes(tx.id)}
                      onToggleSelect={toggleSelect}
                      showDate
                      isViewer={isViewer}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Multi-Select / Filtered Totals Floating Bar — portaled to #phone-stage */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isPresent && (selectMode || hasActiveFilter) && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-24 inset-x-3 z-30 rounded-2xl border p-3 shadow-2xl space-y-2.5"
            style={{
              backgroundColor: 'var(--bg-elevated)',
              borderColor: 'var(--border-strong)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
            }}
          >
            {selectMode ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    {selectedIds.length} selected ·{' '}
                    <span className={`tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`} style={{ color: 'var(--accent)' }}>
                      {privacyBlur ? (
                        '••••'
                      ) : (
                        <>
                          {selectedNet >= 0 ? '+' : ''}
                          <NumberFlow value={selectedNet} format={{ maximumFractionDigits: 2 }} /> {currency}
                        </>
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedIds(
                        selectedIds.length === allVisibleIds.length ? [] : allVisibleIds
                      )
                    }
                    className="text-[11px] font-semibold"
                    style={{ color: 'var(--accent)' }}
                  >
                    {selectedIds.length === allVisibleIds.length ? 'Clear all' : 'Select all'}
                  </button>
                </div>

                {!isViewer && bulkSubmenu === 'account' && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {accounts.map((acc) => (
                      <button
                        key={acc.name}
                        type="button"
                        disabled={selectedIds.length === 0}
                        onClick={() => {
                          onBulkMoveAccount(selectedIds, acc.name);
                          exitSelectMode();
                        }}
                        className="px-2.5 py-1 rounded-full text-[11px] font-semibold border disabled:opacity-40"
                        style={{
                          backgroundColor: 'var(--bg-pill)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        → {acc.name}
                      </button>
                    ))}
                  </div>
                )}

                {!isViewer && bulkSubmenu === 'category' && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex flex-wrap gap-1.5">
                      {categories.order.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setPendingCat(cat)}
                          className="px-2.5 py-1 rounded-full text-[11px] font-semibold border"
                          style={{
                            backgroundColor: pendingCat === cat ? 'var(--accent)' : 'var(--bg-pill)',
                            borderColor: pendingCat === cat ? 'var(--accent)' : 'var(--border-subtle)',
                            color: pendingCat === cat ? 'var(--accent-fg)' : 'var(--text-primary)',
                          }}
                        >
                          {cat}
                        </button>
                      ))}
                    </div>
                    {pendingCat && (categories.map[pendingCat] || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {(categories.map[pendingCat] || []).map((sub) => (
                          <button
                            key={sub}
                            type="button"
                            disabled={selectedIds.length === 0}
                            onClick={() => {
                              onBulkChangeCategory(selectedIds, pendingCat, sub);
                              exitSelectMode();
                            }}
                            className="px-2.5 py-1 rounded-full text-[11px] font-semibold border disabled:opacity-40"
                            style={{
                              backgroundColor: 'var(--accent-soft)',
                              borderColor: 'var(--accent)',
                              color: 'var(--accent)',
                            }}
                          >
                            {sub}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {!isViewer && (
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      disabled={selectedIds.length === 0 || accounts.length < 2}
                      onClick={() =>
                        setBulkSubmenu((s) => (s === 'account' ? null : 'account'))
                      }
                      className="py-2 rounded-xl text-[11px] font-semibold inline-flex items-center justify-center gap-1 border disabled:opacity-40"
                      style={{
                        backgroundColor: bulkSubmenu === 'account' ? 'var(--accent-soft)' : 'var(--bg-pill)',
                        borderColor: bulkSubmenu === 'account' ? 'var(--accent)' : 'var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <ArrowRightLeft size={12} />
                      <span>Move Acc</span>
                    </button>

                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={() => {
                        if (!pendingCat && categories.order.length) setPendingCat(categories.order[0]);
                        setBulkSubmenu((s) => (s === 'category' ? null : 'category'));
                      }}
                      className="py-2 rounded-xl text-[11px] font-semibold inline-flex items-center justify-center gap-1 border disabled:opacity-40"
                      style={{
                        backgroundColor: bulkSubmenu === 'category' ? 'var(--accent-soft)' : 'var(--bg-pill)',
                        borderColor: bulkSubmenu === 'category' ? 'var(--accent)' : 'var(--border-subtle)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <Tag size={12} />
                      <span>Category</span>
                    </button>

                    <button
                      type="button"
                      disabled={selectedIds.length === 0}
                      onClick={() => {
                        onBulkDelete(selectedIds);
                        exitSelectMode();
                      }}
                      className="py-2 rounded-xl text-[11px] font-bold inline-flex items-center justify-center gap-1 bg-rose-500 text-white disabled:opacity-40"
                    >
                      <Trash2 size={12} />
                      <span>Delete</span>
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[12px] font-bold" style={{ color: 'var(--text-primary)' }}>
                    Total · {filteredCount} {filteredCount === 1 ? 'result' : 'results'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setTypeFilter('all');
                      setOnlyLocation(false);
                      setPlaceFilter('');
                      setCatFilter('All');
                      setSearchQuery('');
                    }}
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0"
                    style={{
                      backgroundColor: 'var(--bg-pill)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Clear
                  </button>
                </div>
                <span
                  className={`text-[13px] font-extrabold tabular-nums shrink-0 ${
                    privacyBlur ? 'privacy-mask' : ''
                  }`}
                  style={{
                    color: filteredNet >= 0 ? 'var(--positive)' : 'var(--negative)',
                  }}
                >
                  {privacyBlur ? (
                    '••••'
                  ) : (
                    <>
                      {filteredNet >= 0 ? '+' : ''}
                      <NumberFlow value={filteredNet} format={{ maximumFractionDigits: 2 }} /> {currency}
                    </>
                  )}
                </span>
              </div>
            )}
          </motion.div>
        )}
          </AnimatePresence>,
          document.getElementById('phone-stage') || document.body
        )}
    </div>
  );
}
