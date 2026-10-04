// Minimal line icons (24x24, stroke). Returned as inline SVG strings.
const P = {
  food: 'M7 3v7a2 2 0 0 0 4 0V3M9 3v18M17 3c-2.2 1.2-3 3.6-3 6.5V13h3v8',
  transport: 'M5 17l1.4-5.2A2 2 0 0 1 8.3 10.3h7.4a2 2 0 0 1 1.9 1.5L19 17M3.5 17h17v3h-17zM7 20v1.5M17 20v1.5M7.5 14h.01M16.5 14h.01',
  bills: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  shopping: 'M5 8h14l-1 12H6zM9 8V6.5a3 3 0 0 1 6 0V8',
  entertainment: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM10 9l5 3-5 3z',
  health: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  education: 'M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2zM4 20.5v-15M8.5 7.5h6',
  travel: 'M2.5 12.5l19-8-8 17-2.5-7.5z',
  subscriptions: 'M17 2.5l3 3-3 3M20 5.5H8a4 4 0 0 0-4 4V11M7 21.5l-3-3 3-3M4 18.5h12a4 4 0 0 0 4-4V13',
  miscellaneous: 'M5 12h.01M12 12h.01M19 12h.01',
  income: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  chevron: 'M6 9l6 6 6-6',
  back: 'M15 6l-6 6 6 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  cloud: 'M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 11a3.5 3.5 0 0 1-.5 7z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  backspace: 'M9 5h11v14H9l-6-7zM12.5 9.5l5 5M17.5 9.5l-5 5',
  download: 'M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14',
};

export function icon(name, size = 20, sw = 1.8) {
  const key = String(name || '').toLowerCase();
  const d = P[key] || P.tag;
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${key === 'miscellaneous' ? 3 : sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
}

// Stable, pleasant hue per category (by position in the category list, falling back to a hash).
export function catHue(name, order = []) {
  if (name === 'Income') return 152;
  const i = order.indexOf(name);
  if (i >= 0) return (i * 47 + 12) % 360;
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
