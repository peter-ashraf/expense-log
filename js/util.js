export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const monthKeyOf = (dateStr) => String(dateStr).slice(0, 7);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const keyLabel = (k) => {
  const [y, m] = k.split('-');
  return MONTHS[+m - 1] + ' ' + y;
};
export const keyShort = (k) => MONTHS[+k.split('-')[1] - 1].slice(0, 3);

export const todayStr = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

export const currentKey = () => todayStr().slice(0, 7);

const parts = (s) => s.split('-').map(Number);

export function dayLabel(dateStr) {
  const t = todayStr();
  if (dateStr === t) return 'Today';
  const [y, m, d] = parts(dateStr);
  const dt = new Date(y, m - 1, d);
  const yest = new Date();
  yest.setDate(yest.getDate() - 1);
  const ys = yest.getFullYear() + '-' + String(yest.getMonth() + 1).padStart(2, '0') + '-' + String(yest.getDate()).padStart(2, '0');
  if (dateStr === ys) return 'Yesterday';
  return DAYS[dt.getDay()] + ', ' + d + ' ' + MONTHS[m - 1].slice(0, 3);
}

export function dateLong(dateStr) {
  const [y, m, d] = parts(dateStr);
  return d + ' ' + MONTHS[m - 1].slice(0, 3) + ' ' + y;
}

const nf = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export const num = (n) => nf.format(Math.round((Number(n) || 0) * 100) / 100);
export const num0 = (n) => nf0.format(Number(n) || 0);
export const money = (n, cur = '') => (cur ? cur + ' ' : '') + num(n);

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function haptic(ms = 8) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ }
}

export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Save a file: use the phone's share sheet ("Save to Files") when available, else a normal download.
export async function saveFile(name, blob) {
  try {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancelled';
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

// "1 Sep" this year, "1 Sep 2025" otherwise
export function dateShort(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const now = new Date().getFullYear();
  return d + ' ' + MONTHS[m - 1].slice(0, 3) + (y === now ? '' : ' ' + y);
}

// First day of the week for the user's locale as a JS day index (0 = Sunday ... 6 = Saturday).
export function weekStart() {
  try {
    const loc = new Intl.Locale(navigator.language || 'en-US');
    const info = (loc.getWeekInfo && loc.getWeekInfo()) || loc.weekInfo;
    if (info && info.firstDay) return info.firstDay % 7; // Intl: 1 = Monday ... 7 = Sunday
  } catch (e) { /* fall through */ }
  return 0;
}

// ---- where a purchase happened: stored as "place|lat,lon" (either half may be missing), same as the sheet's Location column
export function parseLoc(s) {
  s = String(s || '').trim();
  if (!s) return null;
  const bar = s.lastIndexOf('|');
  let place = bar >= 0 ? s.slice(0, bar).trim() : s;
  let lat = NaN, lon = NaN;
  const c = /^\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*$/.exec(bar >= 0 ? s.slice(bar + 1) : s);
  if (c) { lat = Number(c[1]); lon = Number(c[2]); if (bar < 0) place = ''; }
  const has = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!place && !has) return null;
  return { place, ...(has ? { lat, lon } : {}) };
}

export function fmtLoc(l) {
  if (!l) return '';
  const place = String(l.place || '').replace(/[|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const has = Number.isFinite(l.lat) && Number.isFinite(l.lon);
  const coords = has ? `${Math.round(l.lat * 1e6) / 1e6},${Math.round(l.lon * 1e6) / 1e6}` : '';
  return coords ? `${place}|${coords}` : place;
}

export function mapUrl(s) {
  const l = typeof s === 'string' ? parseLoc(s) : s;
  if (!l) return '';
  return 'https://maps.google.com/?q=' + encodeURIComponent(Number.isFinite(l.lat) ? `${l.lat},${l.lon}` : l.place);
}

// The phone's position, or null: never throws, never waits longer than `ms`.
export function currentLoc(ms = 6000) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve(null); return; }
    let done = false;
    const end = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => end(null), ms + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => end({ place: '', lat: p.coords.latitude, lon: p.coords.longitude }),
        () => end(null),
        { enableHighAccuracy: false, timeout: ms, maximumAge: 120000 });
    } catch (e) { end(null); }
  });
}
