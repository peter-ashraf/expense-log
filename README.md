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


## Purchase location (v3.18)

Each entry can remember where it was bought, stored as `place|lat,lon` (either half may be empty).

- Month tabs gain a hidden column J `Location`; the `SMS Inbox` tab gains a column E `Location`. Columns A-I, the
  balance formulas, Summary and Categories are untouched. Needs script v11 (it updates itself like before).
- Bank SMS: `smsAdd` accepts optional `lat` / `lon` (or `latitude` / `longitude`), `place` (or `address`, `name`,
  `street`) and/or one combined `location` string (`"30.04,31.23"`, `"Some place"` or `"place|lat,lon"`). Numbers or
  text both work. Requests without them work exactly as before. The location goes into the logged entry.
- Manual entries: the app asks the phone for its position only when you tap Save on a brand-new typed entry (or
  "Use my location"), never when a form, Quick add or the editor opens, and never waits for it when saving
  (a refusal or timeout just means no location). A fix under 3 minutes old is reused, and a refusal stops further asks
  for that session. Turn it off in Settings > Location. The entry editor has
  "Use my location" and a button to remove it. Lists show a pin with the place (or "Location") on its own line under the entry; tap it for Google Maps.
- CSV/Excel export adds a trailing `Location` column only when some entry has one; import reads it when present.

iPhone Shortcut (the existing SMS automation), before the **Get contents of URL** step:

1. Add **Get Current Location**.
2. Add **Get Details of Locations** three times on that location: **Latitude**, **Longitude**, and **Street** (or **Name**).
3. In **Get contents of URL** (Method POST, Request Body JSON) keep `key`, `action` = `smsAdd`, `sms`, and add Text
   fields `lat` = Latitude, `lon` = Longitude, `place` = Street (or Name).
4. The first run asks for location access: choose **Always Allow** (Settings > Privacy & Security > Location Services
   > Shortcuts > While Using / Always) so the automation can run without asking.
