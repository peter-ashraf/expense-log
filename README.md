# Credit Card Expenses

Offline-first expense tracker (PWA) that syncs to a Google Sheet through a small Apps Script API.

- `index.html`, `css/`, `js/`, `sw.js`, `manifest.webmanifest`, `icons/` - the static app (host on GitHub Pages).
- `apps-script/Api.gs` - paste into the Google Sheet's Apps Script project (Extensions > Apps Script), set `API_KEY`,
  run `setupAfterImport` once, then Deploy > Web app (Execute as: Me, Access: Anyone).
- `tests/api.test.js` - `node tests/api.test.js` checks the Apps Script logic against an in-memory fake of Sheets.

The app has no secrets. On first launch enter the web-app URL and access key (or open `.../#u=<url>&k=<key>` once).
Try it without a backend using "Try the demo".
