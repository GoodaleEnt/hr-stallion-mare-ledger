# HR Stallion & Mare Ledger

A browser extension for [Horse Reality](https://www.horsereality.com) that automatically tracks your stallions' stud earnings, breeding history, and foal outcomes — all stored privately in your own browser. No account, no server, no data ever leaves your machine except to talk to Horse Reality itself.

Inspired by tools like HRToolKit and Realtools, built specifically around stud-fee tracking and breeding outcomes.

## What it does

While you browse Horse Reality normally, the extension watches for a few specific pages and quietly merges what it finds into your ledger:

- **Bank page** — every "used your stud service to breed..." transaction becomes a breeding record: mare, breeder, price, currency, date, and which stud. If that stud isn't in your ledger yet, it's created automatically (this is the one page that actually proves the stud is yours).
- **A stallion's Offspring tab** — dam, breeder, resulting foal (with its portrait and genetic score), and outcome.
- **A horse's Info/passport tab** — fills in breed and refreshes the stallion's name and portrait.
- **Notifications log** — "The covering between X and Y has failed, your mare is not pregnant" is the only source of confirmed failures, so the extension watches for it and marks the matching record.

Nothing is ever auto-created just from *viewing* a horse — only the bank page (which proves ownership) creates new stallion entries. Visiting someone else's stud's Offspring or Info tab will never clutter your ledger with horses you don't own.

Click the toolbar icon to open the full dashboard — a proper tab, not a cramped popup — with:

- **Stallions** — roster, public/private fees per currency (HRC/DP/FT/WT), earnings, Sold/Retired status
- **My Mares** — scoped to mares *you* own (set your username once in Settings so it can tell your mares apart from customers')
- Manual add/edit for anything the auto-capture misses, plus a JSON import box for backfilling history

## Installing

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Toggle **Developer mode** on (top right).
4. Click **Load unpacked** and select this folder.
5. Browse Horse Reality — the ledger fills in as you go. Click the extension's toolbar icon anytime to open the dashboard.

## Updating

Pull the latest changes (or re-download), then click the reload icon (⟳) on the extension's card at `chrome://extensions`. If `manifest.json` permissions changed, remove and re-add the extension instead.

## Privacy

All data lives in `chrome.storage.local` inside your own browser profile. Nothing is sent anywhere except the requests the extension makes to `horsereality.com` itself (to read pages you're already viewing, and to fetch horse portrait images for local display). There is no backend, no account, and no analytics.

## Known limitations

- The stallion's own large portrait selector (`img[src*="horse-img.horsereality.com/large/"]`) was reverse-engineered from a sample page and may need adjusting if Horse Reality changes its markup.
- Failed-covering detection depends on a notification that appears to go to the *mare's* owner rather than the stud's — it may rarely fire for your own studs. The status dropdown in the dashboard is always available as a manual fallback.
- Horse Reality's bank page only shows the last 7 days of transactions, and its rules don't allow automating page visits — so keeping the ledger current means browsing normally at least every few days.

## License

MIT
