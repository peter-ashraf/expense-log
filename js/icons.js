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
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeoff: 'M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.9M6.5 7.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a9.4 9.4 0 0 0 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2',
  flame: 'M12 21c3.9 0 6.5-2.6 6.5-6.2 0-2.5-1.3-4.4-2.7-6C14.6 7.4 13.5 5.8 13 3c-3 1.8-5.5 4.7-5.5 8.2 0 .9.2 1.6.5 2.3.4-.9 1-1.5 1.8-1.9-.1 1.8.4 2.8 1.2 3.7.5.6.7 1.2.5 2-.6-.2-1.1-.6-1.4-1.1C8 17 8 19 12 21z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
  mic: 'M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zM6 11a6 6 0 0 0 12 0M12 17v4',
  paste: 'M9 4h6v3H9zM7 5.5H5a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2M8.5 12h7M8.5 16h5',
  cash: 'M3 7h18v10H3zM12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM6.5 12h.01M17.5 12h.01',
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
  close: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z',
  device: 'M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 18h2',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5M9 13h6M9 17h6',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  face: 'M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 10v1.5M15 10v1.5M12 10v3.5h-1M9.5 16a3.5 3.5 0 0 0 5 0',
  keypad: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
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
