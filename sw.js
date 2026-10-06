const CACHE = 'expense-log-v50';
const SHELL = [
  './', 'manifest.webmanifest',
  'css/app.css',
  'js/app.js', 'js/store.js', 'js/api.js', 'js/db.js', 'js/util.js', 'js/icons.js', 'js/xlsx.js', 'js/csv.js', 'js/lock.js', 'js/lockui.js',
  'js/insights.js', 'js/quick.js', 'js/vault.js', 'js/vaultui.js', 'js/refresh.js', 'js/slide.js', 'js/subs.js',
  'icons/brands/1password.svg', 'icons/brands/applemusic.svg', 'icons/brands/appletv.svg', 'icons/brands/audible.svg', 'icons/brands/claude.svg', 'icons/brands/crunchyroll.svg', 'icons/brands/deezer.svg', 'icons/brands/discord.svg', 'icons/brands/dropbox.svg', 'icons/brands/duolingo.svg', 'icons/brands/epicgames.svg', 'icons/brands/expressvpn.svg', 'icons/brands/github.svg', 'icons/brands/googledrive.svg', 'icons/brands/hbomax.svg', 'icons/brands/icloud.svg', 'icons/brands/netflix.svg', 'icons/brands/nordvpn.svg', 'icons/brands/notion.svg', 'icons/brands/patreon.svg', 'icons/brands/perplexity.svg', 'icons/brands/playstation.svg', 'icons/brands/protonvpn.svg', 'icons/brands/soundcloud.svg', 'icons/brands/spotify.svg', 'icons/brands/steam.svg', 'icons/brands/telegram.svg', 'icons/brands/tidal.svg', 'icons/brands/twitch.svg', 'icons/brands/x.svg', 'icons/brands/youtube.svg', 'icons/brands/youtubemusic.svg',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/apple-touch-icon-dark.png',
];

// Some hosts (Cloudflare Pages) redirect "x.html" to "x". Safari refuses a page that a service worker hands back
// as a redirect, so every response is stored and served as a plain copy of the final page.
async function plain(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map(async (u) => {
    const res = await plain(await fetch(new Request(u, { cache: 'reload' })));
    if (!res.ok) throw new Error('Could not cache ' + u);
    await c.put(u, res);
  }))).then(() => self.skipWaiting()));
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
      const net = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(plain).then((res) => {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => hit || caches.match('./'));
      return hit || net;
    })
  );
});
