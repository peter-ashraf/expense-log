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
