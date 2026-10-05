const CACHE = 'expense-log-v35';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/store.js', 'js/api.js', 'js/db.js', 'js/util.js', 'js/icons.js', 'js/xlsx.js', 'js/csv.js', 'js/lock.js', 'js/lockui.js',
  'js/insights.js', 'js/quick.js', 'js/vault.js', 'js/vaultui.js', 'js/refresh.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/apple-touch-icon-dark.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// App shell: serve from cache instantly, refresh in the background (stale-while-revalidate).
// Cross-origin requests (the Apps Script API) are never touched.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => {
      // 'no-cache' = ask the server whether the file changed every time (the host's 10-minute cache would otherwise
      // let this "background refresh" read the same old copy again)
      const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit || caches.match('index.html'));
      return hit || net;
    })
  );
});
