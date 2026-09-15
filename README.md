# HR Stallion & Mare Ledger

A browser extension for [Horse Reality](https://www.horsereality.com) that automatically tracks your stallions' stud earnings, breeding history, and foal outcomes — all stored privately in your own browser. No account, no server, no data ever leaves your machine except to talk to Horse Reality itself.

Inspired by tools like HRToolKit and Realtools, built specifically around stud-fee tracking and breeding outcomes.

📖 **[Full illustrated user manual](docs/MANUAL.md)** — installing, pinning the icon, and a screenshot tour of every feature.

## What it does

While you browse Horse Reality normally, the extension watches for a few specific pages and quietly merges what it finds into your ledger:

- **Bank page** — every "used your stud service to breed..." transaction becomes a breeding record: mare, breeder, price, currency, date, and which stud. If that stud isn't in your ledger yet, it's created automatically (this is the one page that actually proves the stud is yours).
- **A stallion's Offspring tab** — dam, breeder, resulting foal (with its portrait and genetic score), and outcome.
- **A horse's Info/passport tab** — fills in breed and refreshes the stallion's name and portrait, and caches a fuller passport snapshot (genetic potential, conformation, tested colours, training, predicates, height, location, date of birth, owner/breeder, COI, and sire/dam) keyed by life number. This cache is populated for *any* horse you view — yours or not — since it's just reference data, not an ownership claim; the dashboard shows it on both a stallion's and a mare's detail page whenever it has a matching life number.
- **A mare's Pregnancy card** — while she's carrying, her current status, due date, and covering sire are captured too and shown on her detail page.
- **Notifications log** — "The covering between X and Y has failed, your mare is not pregnant" is the only source of confirmed failures, so the extension watches for it and marks the matching record.

Nothing is ever auto-created just from *viewing* a horse — only the bank page (which proves ownership) creates new stallion entries. Visiting someone else's stud's Offspring or Info tab will never clutter your ledger with horses you don't own.

Click the toolbar icon to open the full dashboard — a proper tab, not a cramped popup — with:

- **Stallions** — roster, public/private fees per currency (HRC/DP/FT/WT), earnings, Sold/Retired status
- **My Mares** — scoped to mares *you* own (set your username once in Settings so it can tell your mares apart from customers')
- Manual add/edit for anything the auto-capture misses, plus a JSON import box for backfilling history

## Installing

1. On this repository's GitHub page, click the green **Code** button, then **Download ZIP**. (Or `git clone` it, if you'd rather.)
2. Extract the ZIP somewhere you'll keep it — Chrome loads the extension directly from this folder, so don't delete or move it later.
3. Open `chrome://extensions` in Chrome.
4. Toggle **Developer mode** on (top right).
5. Click **Load unpacked** and select the extracted folder (the one containing `manifest.json`).
6. On the dashboard's Stallions tab, enter your Horse Reality username under "My Horse Reality username" — this is how it tells your own horses apart from other players'.
7. Browse Horse Reality — the ledger fills in as you go. Click the extension's toolbar icon anytime to open the dashboard.

## Updating

Pull the latest changes (or re-download), then click the reload icon (⟳) on the extension's card at `chrome://extensions`. If `manifest.json` permissions changed, remove and re-add the extension instead.

## Privacy

**What the extension reads.** While you browse `horsereality.com` and `v2.horsereality.com`, the extension reads page content and calls Horse Reality's own API (using your existing logged-in session — no separate login) to capture: your bank/stud-fee transactions, your stallions' offspring, horse genetics/pedigree/passport data, pregnancy status, and breeding-related notifications. This includes in-game text, horse portrait images, and profile hyperlinks (mare, stallion, and owner names/links) — it does not read anything on any other website.

**What it does not read.** No real-world personal information (name, email, address), no passwords, no payment/financial data outside the game's own virtual currency, no browsing history outside horsereality.com, and no keystrokes, clicks, or mouse activity.

**Where the data goes.** Everything captured is written to `chrome.storage.local` inside your own browser profile and never leaves your machine, except for the requests the extension itself makes to `horsereality.com`/`v2.horsereality.com` (the same site you're already using) to read pages and fetch horse portrait images. There is no backend server, no account, no analytics, and no third party ever receives this data — it is never sold, shared, or used for any purpose other than building your own breeding ledger.

**Your control.** Since all data lives in your browser's local storage, uninstalling the extension or clearing its storage removes it completely. There is nothing to delete on a server because nothing is ever sent to one.

## Known limitations

- The stallion's own large portrait selector (`img[src*="horse-img.horsereality.com/large/"]`) was reverse-engineered from a sample page and may need adjusting if Horse Reality changes its markup.
- Failed-covering detection depends on a notification that appears to go to the *mare's* owner rather than the stud's — it may rarely fire for your own studs. The status dropdown in the dashboard is always available as a manual fallback.
- Horse Reality's bank page only shows the last 7 days of transactions, and its rules don't allow automating page visits — so keeping the ledger current means browsing normally at least every few days.

## License

MIT
