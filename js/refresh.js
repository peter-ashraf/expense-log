// Fetches the newest version of the app right now, instead of after closing and reopening it a couple of times.
//
// Why updates were slow: the host tells the browser to keep every file for 10 minutes, and the app's background refresh
// went through that same cache, so it often "refreshed" from a copy it already had. Here every file is re-downloaded with
// cache: 'reload', the old copies are thrown away, and the page is loaded again from scratch.

export async function hardReload(beforeNavigate) {
  // 1) stop the old service worker answering from its cache, and empty that cache
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  } catch (e) { /* no service worker here */ }
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch (e) { /* ignore */ }

  // 2) re-download the newest files, bypassing every cache (this also refreshes the browser's own HTTP cache)
  try {
    const sw = await (await fetch('sw.js', { cache: 'reload' })).text();
    const files = [...sw.matchAll(/'([^']+\.(?:js|css|html|webmanifest|svg|png))'/g)].map((m) => m[1]);
    await Promise.all(['./'].concat(files).map((f) => fetch(f, { cache: 'reload' }).catch(() => {})));
  } catch (e) { /* offline: the reload below will use what is there */ }

  if (beforeNavigate) { try { beforeNavigate(); } catch (e) { /* ignore */ } }
  const u = new URL(location.href);
  u.searchParams.set('r', String(Date.now()));
  u.hash = '';
  location.replace(u.toString());
}
