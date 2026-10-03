# Chrome Web Store Listing — HR Stallion & Mare Ledger

> Last Updated: 2026-10-03

Keep this file in step with `manifest.json` whenever permissions, data handling or features change.

## Store Listing

**Extension Name** — HR Stallion & Mare Ledger (matches `manifest.json`)

**Short Description** (≤132 chars; manifest copy is 129)
Automatically tracks your Horse Reality stallion earnings, mare breeding history, and foal outcomes — private, no account needed.

**Detailed Description**
Keep a private ledger of your Horse Reality breeding business without typing anything in.

As you browse horsereality.com, the ledger records your stud fees from the bank page, each covering and its result (pending, in foal, failed, foal born), and the foals your stallions produce. Open the dashboard from the toolbar icon to see it all.

Features:
Stallions: earnings, breeding history and foal results for each of your studs.
My Mares: every mare you have bred, with pregnancy status.
Colts & Fillies: your young horses, with their real in-game age.
My Herd: tag each horse with a status, role and project, record purchase prices, and track best conformation scores.
Other Horses: when you view a horse that isn't yours, a box offers to add it to a separate list you can search.
Foal Calculator: pick a mare and a stallion to see the average genetic potential, shared ancestors and coat colour odds.
Review prompts: the toolbar icon shows a badge when coverings are old enough to check.
Backup: export or restore your whole ledger as a file.

How to use: install, open Horse Reality, enter your Horse Reality username in the dashboard, then visit your horses, bank and offspring pages as usual.

Privacy: everything stays on your computer. The extension only reads horsereality.com pages you are already viewing, has no account, and sends your data nowhere.

Not affiliated with or endorsed by Horse Reality.

**Category** — Productivity (suggested; alternative: Fun)

**Single Purpose** — Track a Horse Reality player's own stallion earnings, mare breeding history and foal outcomes in a private ledger built from horsereality.com pages they view.

**Primary Language** — English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `icons/128.png` |
| Screenshot 1 | 1280×800 | ✅ Ready | `store-screenshots/screenshot-1-stallions.png` |
| Screenshot 2 | 1280×800 | ✅ Ready | `store-screenshots/screenshot-2-mare-pregnancy.png` |
| Screenshot 3 | 1280×800 | ✅ Ready | `store-screenshots/screenshot-3-other-horses.png` (sample data) |
| Screenshot 4 | 1280×800 | ✅ Ready | `store-screenshots/screenshot-4-my-herd.png` (sample data) |
| Small Promo Tile | 440×280 | ✅ Ready | `store-screenshots/promo-small-440x280.png` |
| Marquee Promo Tile | 1400×560 | ✅ Ready | `store-screenshots/promo-marquee-1400x560.png` |

Screenshots 1–2 predate the extra tabs (My Herd, Other Horses, Foal Calculator) so their tab bar looks shorter; screenshots 3–4 show the current UI. All use made-up sample horses.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's ledger (stallions, breeding records, cached horse details, herd tags, settings) in `chrome.storage.local` on their device. |
| `unlimitedStorage` | permissions | The ledger stores cached horse portraits and years of breeding history, which can exceed the default storage quota. |
| `alarms` | permissions | An hourly alarm refreshes the toolbar badge that counts coverings ready to review, since a pending covering can age past the review threshold with no page activity. |
| `*://*.horsereality.com/*` | host_permissions | The ledger reads the bank, offspring, notification and horse pages on horsereality.com to record fees and breedings, requests the viewed horse's details from Horse Reality's own API (`v2.horsereality.com`), and downloads horse portraits from Horse Reality's image server to store them locally. No other site is accessed. |

No remote code is loaded or executed. All scripts ship inside the package.

## Privacy & Data Use

**Does the extension collect user data?** Yes, locally only. It stores the user's own Horse Reality game data (horse names, breeding records, stud fees) and the Horse Reality username they type in. None of it leaves the device.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | Username typed in Settings (game username) | No | Tell the user's horses from others' | No |
| Health info | No | — | — | — |
| Financial info | In-game currency fees only (not real money) | No | Earnings tracking | No |
| Authentication info | No | — | — | — |
| Personal communications | No | — | — | — |
| Location | No | — | — | — |
| Web history | No | — | — | — |
| User activity | No | — | — | — |
| Website content | Game data on horsereality.com pages | No | Ledger records | No |

(For the dashboard's data-use form, "Website content" and possibly "Personally identifiable info" are the closest categories; answer conservatively and keep this table consistent with the form.)

- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

The dashboard page also loads fonts from Google Fonts (Google sees the user's IP); the privacy policy discloses this. Bundling the fonts locally would remove it. Only `chrome.storage.local` is used (never `sync`), so nothing is sent to Google's servers by the extension.

## Privacy Policy

**Privacy Policy URL** — https://github.com/GoodaleEnt/hr-stallion-mare-ledger/blob/master/PRIVACY.md (live once pushed)

## Distribution

**Visibility** — Public
**Regions** — All regions

## Developer Info

**Publisher Name** — goodaleent
**Contact Email** — goodaleent@gmail.com (shown publicly)
**Support URL** — https://github.com/GoodaleEnt/hr-stallion-mare-ledger/issues
**Homepage URL** — https://github.com/GoodaleEnt/hr-stallion-mare-ledger

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.8.4 | 2026-10-03 | Focus an open dashboard without the tabs permission | Draft |
| 1.8.3 | 2026-10-03 | Tidier Other Horses row layout | Draft |
| 1.8.2 | 2026-10-03 | Removed unneeded `tabs` permission; added packaging script and privacy policy | Draft |
| 1.8.1 | 2026-10-03 | Docs for Other Horses tab | Draft |
| 1.8.0 | 2026-10-03 | Add-to-ledger prompt for other people's horses; Other Horses tab | Draft |

## Review Notes

### Known Issues / Limitations
- Ownership is detected by matching the username the user enters in Settings against the owner reported by Horse Reality.
- A mobile userscript build lives in `mobile/` and is not part of the store package.

### Before submitting
- [x] Tested: with the dashboard open, the toolbar icon focuses it (1.8.4, runtime.getContexts, no `tabs` permission).
- [ ] Push so the privacy policy URL is live.
- [x] Publisher name and contact email filled in.
- [ ] Build the ZIP with `powershell -ExecutionPolicy Bypass -File package.ps1` (ships only the files the extension runs from).
- [ ] Bump the version above the last published one in `manifest.json`.
- [ ] Load unpacked and check the console for errors on horsereality.com and in the dashboard.
