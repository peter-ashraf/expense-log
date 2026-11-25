import React, { useRef, useState } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';
import { Copy, Trash2, MapPin, Check } from 'lucide-react';
import CategoryIcon from './CategoryIcon';
import { formatAmt } from '../lib/helpers';

export default function SwipeableTxRow({
  tx,
  accounts = [],
  catOrder = [],
  currency = 'EGP',
  onEdit,
  onCopy,
  onDelete,
  privacyBlur = false,
  selectMode = false,
  isSelected = false,
  onToggleSelect,
  showSwipeHint = false,
  onFirstSwipe,
  showDate = false,
  isViewer = false,
}) {
  const x = useMotionValue(0);
  const [isOpen, setIsOpen] = useState(false);
  const draggingRef = useRef(false);

  const acc = accounts.find((a) => a.name === tx.account);
  const isIncome = tx.type === 'income';
  const canSwipe = !isViewer && !selectMode;
  const sellerExtra =
    tx.seller && tx.title && tx.seller.trim().toLowerCase() !== tx.title.trim().toLowerCase()
      ? tx.seller
      : '';

  const closeRow = () => {
    setIsOpen(false);
    animate(x, 0, { type: 'spring', stiffness: 480, damping: 36 });
  };

  const handleDragStart = () => {
    draggingRef.current = true;
    if (showSwipeHint && onFirstSwipe) onFirstSwipe();
  };

  const handleDragEnd = (_, info) => {
    const offset = x.get();
    if (offset < -52 || info.velocity.x < -300) {
      setIsOpen(true);
      animate(x, -132, { type: 'spring', stiffness: 480, damping: 36 });
    } else {
      closeRow();
    }
    setTimeout(() => {
      draggingRef.current = false;
    }, 60);
  };

  const handleRowClick = () => {
    if (draggingRef.current) return;
    if (selectMode) {
      onToggleSelect?.(tx.id);
      return;
    }
    if (isOpen) {
      closeRow();
      return;
    }
    if (!isViewer) onEdit?.(tx);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Revealed Swipe Actions */}
      {canSwipe && (
        <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 pr-1.5">
          <button
            type="button"
            onClick={() => {
              closeRow();
              onCopy?.(tx);
            }}
            className="h-[calc(100%-8px)] w-[58px] rounded-xl bg-indigo-500 text-white flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold active:scale-95 transition-transform"
          >
            <Copy size={14} />
            <span>Copy</span>
          </button>
          <button
            type="button"
            onClick={() => {
              closeRow();
              onDelete?.(tx);
            }}
            className="h-[calc(100%-8px)] w-[58px] rounded-xl bg-rose-500 text-white flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold active:scale-95 transition-transform"
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Draggable Foreground Row */}
      <motion.div
        style={{
          x: canSwipe ? x : 0,
          backgroundColor: 'var(--bg-card-solid)',
          borderColor: isSelected ? 'var(--accent)' : 'var(--border-subtle)',
        }}
        drag={canSwipe ? 'x' : false}
        dragConstraints={{ left: -136, right: 0 }}
        dragElastic={0.12}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={handleRowClick}
        className={`relative z-10 flex items-center gap-3 px-3 py-2.5 rounded-2xl border select-none touch-pan-y ${
          !isViewer || selectMode ? 'cursor-pointer' : ''
        }`}
      >
        {selectMode && (
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors"
            style={{
              backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
              borderColor: isSelected ? 'var(--accent)' : 'var(--border-strong)',
              color: isSelected ? 'var(--accent-fg)' : 'transparent',
            }}
          >
            <Check size={12} strokeWidth={3} />
          </div>
        )}

        <CategoryIcon
          category={isIncome ? 'Income' : tx.category}
          catOrder={catOrder}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {tx.title}
            </span>
            {sellerExtra && (
              <span className="text-[11px] truncate shrink-0" style={{ color: 'var(--text-muted)' }}>
                {sellerExtra}
              </span>
            )}
            {tx.pending && (
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: 'var(--warning)' }}
                title="Waiting to sync"
              />
            )}
            {showSwipeHint && canSwipe && (
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                style={{
                  backgroundColor: 'var(--accent-soft)',
                  color: 'var(--accent)',
                }}
              >
                ‹ swipe
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[11px] truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            <span className="truncate">
              {isIncome ? 'Income' : `${tx.category} · ${tx.subCategory || tx.sub || ''}`}
            </span>
            {accounts.length > 1 && tx.account && (
              <>
                <span>·</span>
                <span
                  className="inline-flex items-center gap-1 shrink-0 font-medium"
                  style={{ color: acc?.color || 'var(--text-secondary)' }}
                >
                  {tx.account}
                </span>
              </>
            )}
            {showDate && (
              <>
                <span>·</span>
                <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {tx.date.slice(5)}
                </span>
              </>
            )}
          </div>

          {tx.locationRaw && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (tx.mapHref) window.open(tx.mapHref, '_blank', 'noopener');
              }}
              className="mt-0.5 inline-flex items-center gap-1 text-[10.5px] font-medium hover:underline"
              style={{ color: 'var(--accent)' }}
            >
              <MapPin size={10} />
              <span className="truncate max-w-[200px]">{tx.place || 'Location'}</span>
            </button>
          )}
        </div>

        <div className="text-right shrink-0">
          <div
            className={`text-[14px] font-bold tabular-nums transition-[filter] duration-200 ${
              privacyBlur ? 'privacy-mask' : ''
            }`}
            style={{
              color: isIncome ? 'var(--positive)' : 'var(--text-primary)',
            }}
          >
            {privacyBlur ? '••••' : `${isIncome ? '+' : '-'}${formatAmt(tx.amount)}`}
          </div>
          <div className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
            {currency}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
