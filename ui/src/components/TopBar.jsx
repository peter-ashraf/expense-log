import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, ChevronLeft, RefreshCw, Check, Eye } from 'lucide-react';
import { formatEGP } from '../lib/helpers';

export default function TopBar({
  activeTab,
  settingsPage,
  onBackSettings,
  month,
  setMonth,
  months = [],
  syncStatus = 'idle',
  pendingCount = 0,
  onSync,
  isViewer = false,
  currency = 'EGP',
  privacyBlur = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [hoveredKey, setHoveredKey] = useState(null);
  const [hlRect, setHlRect] = useState({ top: 0, height: 48 });

  const pillRef = useRef(null);
  const menuRef = useRef(null);
  const suppressClickUntilRef = useRef(0);
  const gestureRef = useRef({
    source: null,
    timer: 0,
    holding: false,
    x: 0,
    y: 0,
    x0: 0,
    y0: 0,
    hoveredKey: null,
    cleanup: null,
  });

  const currentMonthObj = months.find((m) => m.key === month) || months[0] || {
    key: month || '',
    label: month || 'No data',
    short: month || '',
    available: 0,
    count: 0,
  };

  const trackPointer = useCallback((x, y) => {
    const menuEl = menuRef.current;
    if (!menuEl) return;
    const el = document.elementFromPoint(x, y);
    const row = el && el.closest ? el.closest('[data-month-key]') : null;
    const validRow = row && menuEl.contains(row) ? row : null;
    const nextKey = validRow ? validRow.getAttribute('data-month-key') : null;

    const g = gestureRef.current;
    if (nextKey !== g.hoveredKey) {
      g.hoveredKey = nextKey;
      setHoveredKey(nextKey);
      if (validRow) {
        setHlRect({ top: validRow.offsetTop, height: validRow.offsetHeight });
        navigator.vibrate?.(4);
      }
    }
  }, []);

  const clearActiveGesture = useCallback(() => {
    const g = gestureRef.current;
    clearTimeout(g.timer);
    g.timer = 0;
    if (g.cleanup) {
      g.cleanup();
      g.cleanup = null;
    }
    g.source = null;
    g.holding = false;
    g.hoveredKey = null;
    setHoveredKey(null);
  }, []);

  useEffect(() => {
    return () => clearActiveGesture();
  }, [clearActiveGesture]);

  const beginPointerGesture = useCallback(
    (e, source) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!months.length) return;

      clearActiveGesture();
      const g = gestureRef.current;
      g.source = source;
      g.x = g.x0 = e.clientX;
      g.y = g.y0 = e.clientY;
      g.holding = source === 'menu';
      g.hoveredKey = null;

      const startHold = () => {
        if (g.source !== 'pill' || g.holding) return;
        g.holding = true;
        setMenuOpen(true);
        navigator.vibrate?.(6);
        setTimeout(() => trackPointer(g.x, g.y), 30);
      };

      if (source === 'pill') {
        g.timer = window.setTimeout(startHold, 240);
      } else if (source === 'menu') {
        trackPointer(g.x, g.y);
      }

      const onPointerMove = (ev) => {
        if (!g.source) return;
        g.x = ev.clientX;
        g.y = ev.clientY;

        if (g.source === 'pill' && !g.holding) {
          if (Math.hypot(g.x - g.x0, g.y - g.y0) > 10) {
            clearTimeout(g.timer);
            g.timer = 0;
            startHold();
          }
          return;
        }

        if (g.holding) {
          trackPointer(g.x, g.y);
        }
      };

      const finish = (ev, cancelled) => {
        if (!g.source) return;
        g.x = ev.clientX ?? g.x;
        g.y = ev.clientY ?? g.y;
        const wasHolding = g.holding;
        const gestureSource = g.source;

        if (wasHolding && !cancelled) {
          trackPointer(g.x, g.y);
          const pickedKey = g.hoveredKey;
          suppressClickUntilRef.current = performance.now() + 450;

          if (pickedKey) {
            setMonth(pickedKey);
            setMenuOpen(false);
          } else if (gestureSource === 'pill') {
            const r = pillRef.current?.getBoundingClientRect();
            const overPill =
              r &&
              g.x >= r.left &&
              g.x <= r.right &&
              g.y >= r.top &&
              g.y <= r.bottom;
            if (!overPill) {
              setMenuOpen(false);
            }
          } else if (gestureSource === 'menu') {
            setMenuOpen(false);
          }
        } else if (wasHolding && cancelled && gestureSource === 'pill') {
          setMenuOpen(false);
        }

        clearActiveGesture();
      };

      const onPointerUp = (ev) => finish(ev, false);
      const onPointerCancel = (ev) => finish(ev, true);

      window.addEventListener('pointermove', onPointerMove, true);
      window.addEventListener('pointerup', onPointerUp, true);
      window.addEventListener('pointercancel', onPointerCancel, true);

      g.cleanup = () => {
        window.removeEventListener('pointermove', onPointerMove, true);
        window.removeEventListener('pointerup', onPointerUp, true);
        window.removeEventListener('pointercancel', onPointerCancel, true);
      };
    },
    [clearActiveGesture, months.length, setMonth, trackPointer]
  );

  const isSettings = activeTab === 'settings';
  const isSettingsSubpage = isSettings && settingsPage !== 'home';
  const isSyncing = syncStatus === 'syncing';

  let syncLabel = 'Ready';
  let dotColor = '#10B981';
  if (syncStatus === 'syncing') {
    syncLabel = 'Syncing…';
    dotColor = 'var(--accent)';
  } else if (syncStatus === 'offline') {
    syncLabel = pendingCount ? `Offline · ${pendingCount}` : 'Offline';
    dotColor = '#F59E0B';
  } else if (syncStatus === 'retrying') {
    syncLabel = pendingCount ? `Retry · ${pendingCount}` : 'Reconnecting';
    dotColor = '#F59E0B';
  } else if (syncStatus === 'error') {
    syncLabel = pendingCount ? `Issue · ${pendingCount}` : 'Sync issue';
    dotColor = '#F43F5E';
  } else if (pendingCount > 0) {
    syncLabel = `${pendingCount} pending`;
    dotColor = '#F59E0B';
  } else if (syncStatus === 'synced') {
    syncLabel = 'Synced';
    dotColor = '#10B981';
  }

  return (
    <div className="relative px-4 pt-2.5 pb-1.5 flex items-center justify-between gap-2 shrink-0 z-20">
      {/* Left: Settings Title / Settings Back Pill OR Month Switcher */}
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={isSettingsSubpage ? 'settings-back' : isSettings ? 'settings-title' : 'month-picker'}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
        >
      {isSettingsSubpage ? (
        <button
          type="button"
          onClick={onBackSettings}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[13px] font-semibold border active:scale-95 transition-transform"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-primary)',
          }}
        >
          <ChevronLeft size={15} />
          <span>Settings</span>
        </button>
      ) : isSettings ? (
        <h1
          className="font-display text-[20px] font-extrabold tracking-tight"
          style={{ color: 'var(--text-primary)' }}
        >
          Settings
        </h1>
      ) : (
        <div className="relative">
          <button
            ref={pillRef}
            type="button"
            disabled={!months.length}
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            onPointerDown={(e) => {
              if (!menuOpen) beginPointerGesture(e, 'pill');
            }}
            onClick={() => {
              if (performance.now() < suppressClickUntilRef.current) return;
              if (months.length) setMenuOpen((o) => !o);
            }}
            className={`month-pill inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-bold border active:scale-95 transition-transform ${
              menuOpen ? 'open' : ''
            }`}
            style={{
              backgroundColor: 'var(--bg-card)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-primary)',
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
            }}
          >
            <span className="font-display">{currentMonthObj.label}</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
              style={{ color: 'var(--text-secondary)' }}
            />
          </button>

          <AnimatePresence>
            {menuOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  className="fixed inset-0 z-30"
                  onClick={() => {
                    if (performance.now() < suppressClickUntilRef.current) return;
                    setMenuOpen(false);
                  }}
                />
                <motion.div
                  ref={menuRef}
                  role="listbox"
                  initial={{ opacity: 0, y: -8, scale: 0.86 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.94 }}
                  transition={{ type: 'spring', stiffness: 460, damping: 32 }}
                  className="absolute left-0 top-full mt-2 w-64 max-h-[60vh] overflow-y-auto no-scrollbar rounded-2xl border p-1.5 shadow-2xl z-40"
                  style={{
                    transformOrigin: '24px 0',
                    backgroundColor: 'var(--bg-elevated)',
                    borderColor: 'var(--border-strong)',
                    backdropFilter: 'blur(24px)',
                    WebkitBackdropFilter: 'blur(24px)',
                    touchAction: months.length > 7 ? 'pan-y' : 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                  }}
                >
                  {/* Native iOS press-and-slide highlight pill */}
                  <div
                    aria-hidden="true"
                    className="menu-hl"
                    style={{
                      position: 'absolute',
                      left: 6,
                      right: 6,
                      top: 0,
                      borderRadius: 12,
                      pointerEvents: 'none',
                      zIndex: 0,
                      backgroundColor: 'color-mix(in srgb, var(--text-primary) 11%, transparent)',
                      transition:
                        'transform 180ms cubic-bezier(0.3, 1.25, 0.5, 1), height 160ms ease, opacity 120ms ease',
                      transform: `translateY(${hlRect.top}px)`,
                      height: `${hlRect.height}px`,
                      opacity: hoveredKey ? 1 : 0,
                    }}
                  />

                  {months.map((m, idx) => {
                    const active = m.key === month;
                    return (
                      <motion.button
                        key={m.key}
                        type="button"
                        role="option"
                        aria-selected={active}
                        data-month-key={m.key}
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.025, duration: 0.2 }}
                        onPointerDown={(e) => {
                          if (months.length <= 7) beginPointerGesture(e, 'menu');
                        }}
                        onClick={() => {
                          if (performance.now() < suppressClickUntilRef.current) return;
                          setMonth(m.key);
                          setMenuOpen(false);
                        }}
                        className="relative z-10 w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors"
                        style={{
                          backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
                        }}
                      >
                        <div>
                          <div
                            className="text-[13px] font-bold flex items-center gap-1.5"
                            style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}
                          >
                            {m.label}
                            {active && <Check size={13} />}
                          </div>
                          <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                            {m.count} {m.count === 1 ? 'entry' : 'entries'}
                          </div>
                        </div>
                        <div
                          className={`text-[12px] font-bold tabular-nums ${privacyBlur ? 'privacy-mask' : ''}`}
                          style={{ color: m.available >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                        >
                          {privacyBlur ? '••••' : `${formatEGP(m.available)} ${currency}`}
                        </div>
                      </motion.button>
                    );
                  })}
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      )}
        </motion.div>
      </AnimatePresence>

      {/* Right: View-only indicator (if applicable) + Synced Pill */}
      <div className="flex items-center gap-1.5">
        {isViewer && (
          <span
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold"
            style={{ backgroundColor: 'rgba(16, 185, 129, 0.14)', color: 'var(--positive)' }}
          >
            <Eye size={11} />
            <span>View only</span>
          </span>
        )}
        <button
          type="button"
          onClick={onSync}
          aria-label="Sync now"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-semibold border active:scale-95 transition-transform"
          style={{
            backgroundColor: 'var(--bg-card)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          {isSyncing ? (
            <RefreshCw size={11} className="animate-spin" style={{ color: 'var(--accent)' }} />
          ) : (
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: dotColor }}
            />
          )}
          <span>{syncLabel}</span>
        </button>
      </div>
    </div>
  );
}
