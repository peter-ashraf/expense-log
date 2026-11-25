import React from 'react';
import {
  Utensils,
  Car,
  Sparkles,
  ShoppingBag,
  Receipt,
  HeartPulse,
  Briefcase,
  RotateCcw,
  Laptop,
  Gift,
  GraduationCap,
  Plane,
  Film,
  Tag,
} from 'lucide-react';
import { getCategoryColor } from '../lib/helpers';

const ICON_MAP = {
  Food: Utensils,
  Transport: Car,
  Subscriptions: Sparkles,
  Shopping: ShoppingBag,
  Bills: Receipt,
  Health: HeartPulse,
  Entertainment: Film,
  Education: GraduationCap,
  Travel: Plane,
  Miscellaneous: Tag,
  Income: Briefcase,
  Salary: Briefcase,
  Refund: RotateCcw,
  Freelance: Laptop,
  Gift: Gift,
};

export default function CategoryIcon({
  category,
  catOrder = [],
  size = 16,
  boxClass = 'w-9 h-9 rounded-xl',
}) {
  const Icon = ICON_MAP[category] || Tag;
  const color = getCategoryColor(category, catOrder);

  return (
    <div
      className={`shrink-0 flex items-center justify-center ${boxClass}`}
      style={{
        backgroundColor: color.startsWith('#') ? `${color}20` : `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
        border: `1px solid ${color.startsWith('#') ? `${color}33` : `color-mix(in srgb, ${color} 28%, transparent)`}`,
      }}
    >
      <Icon size={size} strokeWidth={2.1} />
    </div>
  );
}
