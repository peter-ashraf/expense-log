# Credit Card Expenses

Offline-first expense tracker (PWA) that syncs to a Google Sheet through a small Apps Script API.

- `index.html`, `css/`, `js/`, `sw.js`, `manifest.webmanifest`, `icons/` - the static app (host on GitHub Pages).
- `apps-script/Api.gs` - paste into the Google Sheet's Apps Script project (Extensions > Apps Script), set `API_KEY`,
  run `setupAfterImport` once, then Deploy > Web app (Execute as: Me, Access: Anyone).
- `tests/api.test.js` - `node tests/api.test.js` checks the Apps Script logic against an in-memory fake of Sheets.

The app has no secrets. On first launch enter the web-app URL and access key (or open `.../#u=<url>&k=<key>` once).
Try it without a backend using "Try the demo".


## Spending accounts (v3.0)

Entries belong to an account (Credit Card, Cash, ...), each with an optional monthly limit.

- The sheet gains a hidden column H `Account` on month tabs (blank = the main account) and an `Accounts` tab
  (`Account | Type | Monthly Limit | Archived`, first row = main account). Columns A-G, the balance formulas,
  Summary and Categories are untouched: the balance chain still totals every account together.
- Older app versions keep working against the new script, and the new app falls back to a single account
  against an older script (Settings shows a hint to update it).
- Excel/CSV export adds a trailing `Account` column and an `Accounts` sheet only when there is more than one
  account; import reads the column when present.
- After pasting the updated `apps-script/Api.gs`, deploy a new version (Deploy > Manage deployments > New version).


## View-only links (v3.17)

Settings > Share view-only makes a link for one person (name, optional note): `.../#v=<web-app url>&t=<token>`.

- The token is random and kept on a hidden `Viewers` tab (`Token | Name | Note | Created | LastOpened | Revoked`).
  It is never the access key: a request with a token can only run `view` (a read-only snapshot plus the viewer's
  name and note); everything else is `Unauthorized`. Revoke stamps the `Revoked` column and the link stops at once.
- Opening the link puts the app in view-only mode: a greeting, no add/edit/delete/import/quick-add/subscription or
  account editing, no SMS inbox or script self-update, and the last loaded data stays readable offline. Its copy is
  kept apart from an owner setup on the same phone (the app asks before switching); "Leave view-only mode" brings it back.
- Needs script v10. It updates itself like before; otherwise paste the new `Api.gs` and deploy a new version.
