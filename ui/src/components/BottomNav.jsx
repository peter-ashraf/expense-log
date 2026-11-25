import React from 'react';
import { motion } from 'motion/react';
import { Home, ArrowLeftRight, PieChart, Settings, Plus } from 'lucide-react';
import SlidingHighlight from './SlidingHighlight';

const TABS = [
  { id: 'home', label: 'Home', Icon: Home },
  { id: 'activity', label: 'Activity', Icon: ArrowLeftRight },
  { id: 'insights', label: 'Insights', Icon: PieChart },
  { id: 'settings', label: 'Settings', Icon: Settings },
];

export default function BottomNav({
  activeTab,
  onSelectTab,
  onOpenAdd,
  navStyle,
  concept,
  hidden = false,
  isViewer = false,
}) {
  const springConfig =
    concept === 'kinetic'
      ? { type: 'spring', stiffness: 520, damping: 28 }
      : { type: 'spring', stiffness: 460, damping: 34 };

  if (navStyle === 'orb') {
    return (
      <motion.div
        data-bottom-nav="true"
        animate={{ y: hidden ? 110 : 0, opacity: hidden ? 0 : 1 }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className="absolute bottom-0 inset-x-0 px-3 pt-2 pointer-events-none z-20"
        style={{ paddingBottom: 'max(14px, var(--safe-b, env(safe-area-inset-bottom)))' }}
      >
        <div
          className={`flex items-center gap-2.5 ${hidden ? 'pointer-events-none' : 'pointer-events-auto'}`}
        >
          {/* 4-Tab Frosted Capsule with Hold-Drag-Release Pill */}
          <SlidingHighlight
            activeKey={activeTab}
            onSelect={onSelectTab}
            preventScroll
            activeTextColor="var(--accent-fg)"
            className="flex-1 grid grid-cols-4 p-1.5 rounded-[28px] border shadow-xl"
            style={{
              backgroundColor: 'var(--bg-nav)',
              borderColor: 'var(--border-strong)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
            }}
            pillClassName="rounded-[21px]"
            pillStyle={{ backgroundColor: 'var(--accent)' }}
          >
            {TABS.map(({ id, label, Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  data-hl={id}
                  onClick={() => onSelectTab(id)}
                  className="relative py-2 flex flex-col items-center justify-center gap-0.5 rounded-[21px] z-10 transition-colors"
                  style={{
                    color: active ? 'var(--accent-fg)' : 'var(--text-secondary)',
                  }}
                >
                  <Icon size={17} strokeWidth={active ? 2.4 : 2} />
                  <span className="text-[10px] font-semibold tracking-tight">{label}</span>
                </button>
              );
            })}
          </SlidingHighlight>

          {/* Standalone 56x56 Circular + Orb (hidden for view-only links) */}
          {!isViewer && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              transition={springConfig}
              onClick={onOpenAdd}
              className="w-14 h-14 rounded-full flex items-center justify-center shadow-2xl border shrink-0"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--accent-fg)',
                borderColor: 'rgba(255,255,255,0.22)',
                boxShadow: '0 10px 26px -6px color-mix(in srgb, var(--accent) 65%, transparent)',
              }}
              aria-label="Add transaction"
            >
              <Plus size={25} strokeWidth={2.6} />
            </motion.button>
          )}
        </div>
      </motion.div>
    );
  }

  // Default: Symmetric 5-Slot Dock with dead-center elevated + Jewel FAB (and Hold-Drag-Release Pill!)
  const leftTabs = TABS.slice(0, 2);
  const rightTabs = TABS.slice(2, 4);

  const renderSlot = ({ id, label, Icon }) => {
    const active = activeTab === id;
    return (
      <button
        key={id}
        type="button"
        data-hl={id}
        onClick={() => onSelectTab(id)}
        className="relative py-1.5 flex flex-col items-center justify-center gap-0.5 rounded-[21px] z-10 transition-colors"
        style={{
          color: active ? 'var(--accent)' : 'var(--text-secondary)',
        }}
      >
        <Icon size={18} strokeWidth={active ? 2.4 : 1.9} />
        <span className="text-[10px] font-semibold tracking-tight">{label}</span>
      </button>
    );
  };

  return (
    <motion.div
      data-bottom-nav="true"
      animate={{ y: hidden ? 110 : 0, opacity: hidden ? 0 : 1 }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      className="absolute bottom-0 inset-x-0 px-3 pt-2 pointer-events-none z-20"
      style={{ paddingBottom: 'max(12px, var(--safe-b, env(safe-area-inset-bottom)))' }}
    >
      <SlidingHighlight
        activeKey={activeTab}
        onSelect={onSelectTab}
        preventScroll
        activeTextColor="var(--accent)"
        className={`grid ${isViewer ? 'grid-cols-4' : 'grid-cols-[1fr_1fr_64px_1fr_1fr]'} items-center px-1.5 py-1.5 rounded-[28px] border shadow-xl ${
          hidden ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
        style={{
          backgroundColor: 'var(--bg-nav)',
          borderColor: 'var(--border-strong)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
        }}
        pillClassName="rounded-[21px]"
        pillStyle={{ backgroundColor: 'var(--accent-soft)' }}
      >
        {leftTabs.map(renderSlot)}

        {!isViewer && (
          <div className="flex items-center justify-center">
            <motion.button
              type="button"
              whileTap={{ scale: 0.9 }}
              transition={springConfig}
              onClick={onOpenAdd}
              className="w-[52px] h-[52px] -mt-5 rounded-[20px] flex items-center justify-center border shadow-xl"
              style={{
                background:
                  concept === 'obsidian'
                    ? 'linear-gradient(135deg, #6366F1 0%, #22D3EE 100%)'
                    : 'var(--accent)',
                color: '#FFFFFF',
                borderColor: 'rgba(255,255,255,0.28)',
                boxShadow: '0 10px 26px -6px color-mix(in srgb, var(--accent) 70%, transparent)',
              }}
              aria-label="Add transaction"
            >
              <Plus size={25} strokeWidth={2.7} />
            </motion.button>
          </div>
        )}

        {rightTabs.map(renderSlot)}
      </SlidingHighlight>
    </motion.div>
  );
}
