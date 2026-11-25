import React, { useLayoutEffect, useRef } from 'react';

/**
 * Container-scoped sliding highlight indicator modeled on Animate UI Highlight & js/slide.js.
 * Outer positioned wrapper owns ONLY DOM geometry/transitions (no React `style` prop) so React
 * re-renders never wipe `opacity` or `transition`. Inner fill child owns color styling.
 *
 * When `onSelect` is provided (for static, non-scrolling containers like BottomNav or segmented controls),
 * holding down (`150ms` hold or `>8px` horizontal drag) activates live pill scrubbing and releases to select.
 */
export default function SlidingHighlight({
  activeKey,
  onSelect,
  preventScroll = false,
  activeTextColor = 'var(--accent-fg)',
  className = '',
  style = {},
  pillClassName = '',
  pillStyle = {},
  children,
}) {
  const containerRef = useRef(null);
  const pillRef = useRef(null);
  const pillInnerRef = useRef(null);
  const mountedRef = useRef(false);
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const suppressClickUntilRef = useRef(0);
  const scrubbingRef = useRef(false);

  const measureAndApply = (key, transitionCss) => {
    const container = containerRef.current;
    const pill = pillRef.current;
    if (!container || !pill) return;

    const keyStr = key != null ? String(key) : '';
    const el = keyStr
      ? container.querySelector(`[data-hl="${CSS.escape(keyStr)}"]`)
      : null;

    if (!el) {
      pill.style.opacity = '0';
      return;
    }

    const x = el.offsetLeft;
    const y = el.offsetTop;
    const w = el.offsetWidth;
    const h = el.offsetHeight;

    // Concentric border-radius: R_inner = max(2, min(h/2, effectiveOuterR - (border + padding)))
    const cs = window.getComputedStyle(container);
    const rawR = parseFloat(cs.borderTopLeftRadius) || 0;
    if (rawR > 0 && pillInnerRef.current) {
      const effR = Math.min(rawR, container.offsetHeight / 2);
      const insetX = (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.paddingLeft) || 0);
      const insetY = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.paddingTop) || 0);
      const inset = Math.min(insetX, insetY);
      const innerR = Math.max(2, Math.min(h / 2, effR - inset));
      pillInnerRef.current.style.borderRadius = `${innerR}px`;
    }

    pill.style.transition = transitionCss;
    pill.style.width = `${w}px`;
    pill.style.height = `${h}px`;
    pill.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    pill.style.opacity = '1';
    if (transitionCss === 'none') {
      void pill.offsetWidth;
    }
  };

  const syncGeometry = (instant) => {
    if (scrubbingRef.current) return;
    const trans = instant
      ? 'none'
      : 'transform 320ms cubic-bezier(0.28, 1.15, 0.4, 1), width 320ms cubic-bezier(0.28, 1.15, 0.4, 1), height 220ms ease, opacity 150ms ease';
    measureAndApply(activeKeyRef.current, trans);
  };

  useLayoutEffect(() => {
    const isInitial = !mountedRef.current;
    syncGeometry(isInitial);
    mountedRef.current = true;
  }, [activeKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    let skipFirst = true;
    const ro = new ResizeObserver(() => {
      if (skipFirst) {
        skipFirst = false;
        return;
      }
      syncGeometry(true);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const interactive = Boolean(onSelect);

  const handlePointerDown = (e) => {
    if (!interactive || !onSelectRef.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const container = containerRef.current;
    if (!container) return;

    const originBtn = e.target?.closest?.('[data-hl]');
    if (!originBtn || !container.contains(originBtn)) return;
    const originKey = originBtn.getAttribute('data-hl');

    const startX = e.clientX;
    const startY = e.clientY;
    let curX = startX;
    let curY = startY;
    let holdTimer = 0;
    let isScrub = false;
    let cancelledForScroll = false;
    let currentHovered = originKey;

    const updateScrubVisuals = (targetKey) => {
      const btns = [...container.querySelectorAll('[data-hl]')];
      for (const b of btns) {
        const k = b.getAttribute('data-hl');
        if (k === targetKey) {
          b.setAttribute('data-scrub-active', 'true');
          b.removeAttribute('data-scrub-inactive');
        } else if (k === String(activeKeyRef.current ?? '')) {
          b.removeAttribute('data-scrub-active');
          b.setAttribute('data-scrub-inactive', 'true');
        } else {
          b.removeAttribute('data-scrub-active');
          b.removeAttribute('data-scrub-inactive');
        }
      }
      measureAndApply(
        targetKey,
        'transform 180ms cubic-bezier(0.3, 1.2, 0.45, 1), width 180ms cubic-bezier(0.3, 1.2, 0.45, 1), height 160ms ease, opacity 120ms ease'
      );
    };

    const clearScrubVisuals = () => {
      container.removeAttribute('data-hl-scrub');
      if (pillInnerRef.current) pillInnerRef.current.style.transform = '';
      for (const b of container.querySelectorAll('[data-hl]')) {
        b.removeAttribute('data-scrub-active');
        b.removeAttribute('data-scrub-inactive');
      }
    };

    const findKeyAtPoint = (clientX, clientY) => {
      const cr = container.getBoundingClientRect();
      if (clientY < cr.top - 72 || clientY > cr.bottom + 72) {
        return String(activeKeyRef.current ?? '');
      }
      const btns = [...container.querySelectorAll('[data-hl]')];
      if (!btns.length) return String(activeKeyRef.current ?? '');
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        if (clientX >= r.left && clientX <= r.right) {
          return b.getAttribute('data-hl');
        }
      }
      // Gap between buttons (e.g. center + button in BottomNav): snap to nearest horizontal center
      let bestKey = btns[0].getAttribute('data-hl');
      let bestDist = Infinity;
      for (const b of btns) {
        const r = b.getBoundingClientRect();
        const midX = r.left + r.width / 2;
        const dist = Math.abs(clientX - midX);
        if (dist < bestDist) {
          bestDist = dist;
          bestKey = b.getAttribute('data-hl');
        }
      }
      return bestKey;
    };

    const startScrub = () => {
      if (isScrub || cancelledForScroll) return;
      isScrub = true;
      scrubbingRef.current = true;
      container.setAttribute('data-hl-scrub', 'true');
      if (pillInnerRef.current) {
        pillInnerRef.current.style.transform = 'scale(1.03)';
      }
      navigator.vibrate?.(5);
      currentHovered = findKeyAtPoint(curX, curY);
      updateScrubVisuals(currentHovered);
    };

    holdTimer = window.setTimeout(startScrub, 150);

    const onMove = (ev) => {
      if (cancelledForScroll) return;
      curX = ev.clientX;
      curY = ev.clientY;
      const dx = curX - startX;
      const dy = curY - startY;

      if (!isScrub) {
        if (!preventScroll && Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) {
          cancelledForScroll = true;
          clearTimeout(holdTimer);
          cleanup();
          return;
        }
        if (Math.abs(dx) > 8 && Math.abs(dx) >= Math.abs(dy)) {
          clearTimeout(holdTimer);
          startScrub();
        }
        return;
      }

      const nextKey = findKeyAtPoint(curX, curY);
      if (nextKey !== currentHovered) {
        currentHovered = nextKey;
        navigator.vibrate?.(4);
        updateScrubVisuals(nextKey);
      }
    };

    const finish = (ev, cancelled) => {
      clearTimeout(holdTimer);
      cleanup();
      if (!isScrub) return;

      const finalKey = cancelled
        ? String(activeKeyRef.current ?? '')
        : findKeyAtPoint(ev.clientX ?? curX, ev.clientY ?? curY);

      scrubbingRef.current = false;
      clearScrubVisuals();
      suppressClickUntilRef.current = performance.now() + 400;

      if (!cancelled && finalKey != null && finalKey !== String(activeKeyRef.current ?? '')) {
        onSelectRef.current?.(finalKey);
      } else {
        syncGeometry(false);
      }
    };

    const onUp = (ev) => finish(ev, false);
    const onCancel = (ev) => finish(ev, true);

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  };

  const handleClickCapture = (e) => {
    if (performance.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const mergedStyle = {
    '--hl-active-fg': activeTextColor,
    ...(interactive ? { touchAction: preventScroll ? 'none' : 'pan-y', userSelect: 'none', WebkitUserSelect: 'none' } : {}),
    ...style,
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={interactive ? handlePointerDown : undefined}
      onClickCapture={interactive ? handleClickCapture : undefined}
      className={`relative isolate ${className}`}
      style={mergedStyle}
    >
      <div
        ref={pillRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 -z-10"
      >
        <div
          ref={pillInnerRef}
          className={`w-full h-full transition-[background-color,transform] duration-200 ${pillClassName}`}
          style={pillStyle}
        />
      </div>
      {children}
    </div>
  );
}
