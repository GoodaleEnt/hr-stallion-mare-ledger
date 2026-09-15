# HR Stallion & Mare Ledger — User Manual

A visual walkthrough of installing and using the extension. For a quick technical overview instead, see the [main README](../README.md).

> The dashboard screenshots below use fictional sample data (no real player or horse names) so this manual can be published safely.

## Contents

1. [Installing](#installing)
2. [Pin the toolbar icon](#pin-the-toolbar-icon)
3. [First-time setup](#first-time-setup)
4. [Your Stallions](#your-stallions)
5. [Looking up any horse](#looking-up-any-horse)
6. [A stallion's detail page](#a-stallions-detail-page)
7. [Adding a stallion by hand](#adding-a-stallion-by-hand)
8. [My Mares](#my-mares)
9. [A mare's detail page & pregnancy tracking](#a-mares-detail-page--pregnancy-tracking)
10. [Understanding breeding statuses](#understanding-breeding-statuses)
11. [Updating](#updating)
12. [Privacy](#privacy)
13. [Troubleshooting](#troubleshooting)

## Installing

1. On the [repository page](https://github.com/GoodaleEnt/hr-stallion-mare-ledger), click the green **Code** button, then **Download ZIP**.
2. Extract the ZIP somewhere you'll keep it — Chrome loads the extension directly from this folder, so don't delete or move it later.
3. Open `chrome://extensions` in Chrome.
4. Turn on **Developer mode**, then click **Load unpacked** and select the extracted folder (the one containing `manifest.json`).

![chrome://extensions — turn on Developer mode, then Load unpacked](images/00a-install-load-unpacked.png)

## Pin the toolbar icon

Chrome hides new extension icons behind the puzzle-piece menu by default. Pin it so the dashboard is always one click away:

![Pin the toolbar icon so the dashboard is always one click away](images/00-pin-to-toolbar.png)

## First-time setup

Open the dashboard (click the toolbar icon) and enter your Horse Reality username under **"My Horse Reality username"** on the Stallions tab. This is how the extension tells *your* horses apart from everyone else's — without it, "My Mares" stays empty and owned horses won't auto-track.

## Your Stallions

This is the dashboard's home view. As you browse Horse Reality, stallions you own are tracked here automatically — no manual entry needed for a horse you own, though you can always add one by hand (see below).

![Stallions overview: roster, fees, earnings, and the search box](images/01-stallions-overview.png)

Each stallion card shows his public/private stud fee, how many breedings are logged, and total earnings. A stat bar across the top rolls all of this up across your whole roster.

**How stallions get added automatically:**
- A bank transaction where you *earned* a stud fee (proves you own the stud)
- Viewing your own horse's page, when its owner matches the username you set above

Studs that show up here only because they were needed to track one of *your mares'* breedings with someone else's stallion are kept off this grid — they still show up wherever that mare's history is displayed.

## Looking up any horse

The search box (top of every list view) looks up *any* horse the extension has ever cached a passport snapshot for — by name or life number — even if that horse isn't tied to a tracked stallion or a logged breeding yet.

![Typing a search and getting a result](images/02-search-results.png)

Clicking a result opens a lightweight passport view: genetics, pedigree, and pregnancy status, pulled straight from Horse Reality's own data the moment you last viewed that horse's page.

## A stallion's detail page

Click any stallion card to see his full breeding ledger.

![A stallion's detail page: genetics, pedigree, and the breeding ledger](images/03-stallion-detail.png)

This page shows:
- **Genetics & pedigree** — genetic potential, conformation, tested colours, training, COI, and sire/dam (stacked, each linking back to Horse Reality)
- **A link to view him on Horse Reality** directly
- **Prev / Next** buttons to flip through your whole roster without going back to the list
- **The full breeding ledger** — every mare bred to him, her owner, the price paid, and status
- **Edit / Delete / status** controls, and buttons to add a breeding by hand or bulk-import a JSON backfill

## Adding a stallion by hand

Anything the auto-capture misses can be entered manually — useful for backfilling history from before you installed the extension.

![The Add Stallion form](images/04-add-stallion-form.png)

## My Mares

Switch to the **My Mares** tab to see every mare *you* own — scoped by the username you set in first-time setup. A mare appears here the moment you view her page, even before she's been bred; once she has breeding history, it shows too.

![My Mares: your own mares at a glance](images/05-my-mares.png)

## A mare's detail page & pregnancy tracking

Click any mare to see her full picture, including live pregnancy status if she's currently carrying.

![A mare's detail page showing pregnancy, genetics, and pedigree](images/06-mare-pregnancy.png)

While she's pregnant, you'll see her due date and the covering sire (linked), pulled directly from her passport the moment you last viewed her page — no manual entry needed.

## Understanding breeding statuses

| Status | Meaning |
|---|---|
| **Pending** | A covering was logged (bank transaction or notification), outcome not yet known |
| **Succeeded** | Confirmed pregnant — captured from the mare's own pregnancy status |
| **Failed** | Confirmed not pregnant |
| **Foal Born** | A foal resulting from this covering has arrived, captured from the stallion's Offspring tab |

**A note on failures:** Horse Reality only sends the "covering has failed" notification to the *mare's* owner, never the stud's — so if you're a stud owner, you'd normally never find out a customer's mare didn't take. To cover this gap, the extension automatically marks a "Pending" record **Failed** once it's more than 6 days old with no matching foal for that mare — Horse Reality resolves a covering within about that window, so a longer silence almost always means it didn't take.

You can also change any record's status by hand at any time using the dropdown in its row.

## Updating

Re-download the ZIP from the repository, extract it over the same folder, then click the reload icon (⟳) on the extension's card at `chrome://extensions`. If `manifest.json`'s permissions changed, remove and re-add the extension instead.

## Privacy

Everything lives in `chrome.storage.local` inside your own browser profile and never leaves your machine, except for requests the extension itself makes to `horsereality.com`/`v2.horsereality.com` — the same site you're already using — to read pages and fetch horse data. There is no backend, no account, and no analytics. See the [full privacy policy](../README.md#privacy) for details.

## Troubleshooting

- **Nothing is showing up.** Make sure you've set your username in Settings (Stallions tab) — most auto-tracking depends on matching it against a horse's owner.
- **A stallion I don't own is cluttering things.** If it only exists to anchor one of your mares' breeding history with an outside stud, it's intentionally kept off the Stallions grid — check that mare's own detail page instead.
- **Data seems stale after a Horse Reality update.** The extension reads Horse Reality's own API and page content directly; if the site changes its markup or API shape, some captures may need an update. Open an issue on the [GitHub repository](https://github.com/GoodaleEnt/hr-stallion-mare-ledger/issues) if something stops working.
