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
8. [Bulk-importing breeding records](#bulk-importing-breeding-records)
9. [My Mares](#my-mares)
10. [A mare's detail page & pregnancy tracking](#a-mares-detail-page--pregnancy-tracking)
11. [My Herd](#my-herd)
12. [Other Horses](#other-horses)
13. [Foal Calculator](#foal-calculator)
14. [Understanding breeding statuses](#understanding-breeding-statuses)
15. [Reviewing coverings before they auto-fail](#reviewing-coverings-before-they-auto-fail)
16. [Updating](#updating)
17. [Privacy](#privacy)
18. [Troubleshooting](#troubleshooting)

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

**Export Backup / Restore Backup** (top of this tab) save or reload your *entire* ledger as a single JSON file — every stallion, mare, breeding record, and cached horse passport. Use it before doing anything risky (switching computers, clearing browser data), or just periodically for peace of mind. Restoring a backup replaces everything currently stored, so you'll be asked to confirm first.

## The Open in Ledger button

On every horse's page on Horse Reality there is a white **Open in Ledger** pill inside the horse's picture, in the top-left corner. When the horse has status pills such as *Covered* or *Stud or semen* it sits beside them; when it doesn't, it sits in the same corner on its own. Click it to jump straight to that horse in the ledger: your stallions open on their stallion page, any other horse on its profile (your mares open on their mare page). If the dashboard is already open it is brought to the front instead of opening a second copy. If the ledger hasn't saved that horse yet, the dashboard opens with its life number in the search box. On mobile, the button opens the Ledger overlay on the same horse.

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

## Bulk-importing breeding records

Both a stallion's detail page and the Stallions tab have an **Import** button, for pasting in a JSON array of breeding records all at once — handy for backfilling history from before you installed the extension, or migrating from a spreadsheet.

![The bulk JSON import form on a stallion's detail page](images/08-import-json.png)

A record naming its own stud (`stallionName` or `stallionLifeNumber`) routes to that stallion automatically — but only if he's already in your ledger; records for a stud that isn't are skipped, and you're told which ones so you can add him first. Anything that doesn't name a stud goes to whichever stallion's page you opened Import from. A record that matches an existing one (same mare, date, foal, and price) updates it in place instead of duplicating.

## My Mares

Switch to the **My Mares** tab to see every mare *you* own — scoped by the username you set in first-time setup. A mare appears here the moment you view her page, even before she's been bred; once she has breeding history, it shows too.

![My Mares: your own mares at a glance](images/05-my-mares.png)

## A mare's detail page & pregnancy tracking

Click any mare to see her full picture, including live pregnancy status if she's currently carrying.

![A mare's detail page showing pregnancy, genetics, and pedigree](images/06-mare-pregnancy.png)

While she's pregnant, you'll see her due date and the covering sire (linked), pulled directly from her passport the moment you last viewed her page — no manual entry needed.

## My Herd

The **My Herd** tab lists every horse you own that the extension has seen (it uses the same username match as My Mares). For each one you can set:

- **Role** — Broodmare, Public Stud, Private Stud, Public & Private Stud, Competition or Young Stock
- **Status** — Active, Observation, Companion, For Sale, Sold, Retired or Deceased
- **Project** — a free-text group name for a breeding goal (e.g. "Leopard line"); use the filters above the list to view one role or project at a time
- **Show scores** — the highest conformation show score is captured automatically whenever you open a horse's stats page (it reads the "Latest 25 show results" list, skipping breed-type shows) and is **only ever raised**, so it stays even after that score drops off the 25-show list. If you also use the HRToolkit extension, its "All-time Confo" figure is read too. You can still type earlier scores separated by commas (e.g. `84.2, 91.5, 77`) for results the page no longer shows; the best of everything is displayed, for example "Best 91.5 · from stats page". Horse Reality's conformation grades (like "2G 9A 1BA") are shown under each horse's details automatically.

When you buy a horse, the price and transport fee are picked up automatically the next time you open your Horse Reality **bank page** (the "You have bought…" row). You can also open "Purchase price & shipping" on a horse's page to enter or correct what you paid and the shipping fee (each with its own currency); figures you typed yourself are never overwritten by the automatic ones. They show as **Paid / Shipping / Total** tags on the horse's page and as rows on its Stallions or My Mares card, and under its name in My Herd. Leave them empty for horses you bred.

Each horse also has a **200 × 200 picture** beside it (a "No picture yet" tile until one has been saved).

Horses marked **Sold, Retired or Deceased** move out of the working list and the headline numbers into an archive — click **Show archive** to see them. The tiles at the top summarise your active herd: size, mares, stallions, mares in foal, foals born, number of breeds and average genetic potential. You can also set the same three tags from a horse's own page (click her name). These tags are separate from a tracked stallion's Active/Sold/Retired status on the Stallions tab.

### High scores and Breed Total

Each horse's card and page shows its **top conformation score** and its **Breed Total (BT)**, with when each was reached. The conformation high is read from the horse's stats page (the show results list, with the show date when the page gives one) and only ever goes up, so it stays after the score drops off the latest-25 list. **Breed Total = ((Genetic Potential ÷ 10) + Top Conformation Score) ÷ 2**, and its high score is kept the same way. A date shown as "seen" means the ledger first noticed the score that day because the page didn't give the show date.

### Horses for sale

Set a horse's **Status** to **For Sale** (on My Herd, on its own page, or from the status menu on a stallion's or mare's card) and a big faint **$** appears behind its card or row everywhere it is listed, and a gold **$ For sale** tag appears on its profile. The horse stays on all your normal lists. When it is sold, change the status to Sold (or let the bank page do it) and it moves to Other Horses.

### Selling a horse

When you sell a horse, the sale shows on your Horse Reality bank page. The next time you open that page the ledger records what it sold for, the date and the buyer, and marks the horse **Sold** (so it moves to Other Horses). The horse's own page then shows **Sold for …** and, if you recorded what you paid, a **Profit** or **Loss** tag (sale price minus price paid plus shipping, when both use the same currency). You can also open the **Sale** section on a horse's page to enter or correct the price, date or buyer by hand; entering a price marks the horse Sold. Sold horses are left out of the Analytics lists and totals, and the **Sold horses** section at the bottom of Analytics lists them with what they fetched, what they cost and the profit.

### Retired and sold horses

Set a horse's **Status** to **Retired** (on My Herd, on a mare's card or page, on its own page, or on a stallion's status menu) and it leaves the Stallions, My Mares, Colts & Fillies and My Herd lists and appears on the **Retired** tab instead. Set a horse's status to **Sold** and it moves to **Other Horses**, tagged *Sold*. Nothing is deleted: change the status back to Active (or press **Restore** on a sold horse) and it returns to its usual place. A retired stallion's earnings still count in your totals.

### Highlight goals

Fertility can only be tested from age 3, so for a horse younger than that the Fertility box is greyed ("tested from age 3") and is left out of your goals. Under the search box, open **Highlight goals** and fill in any of: a minimum top conformation score, a minimum Breed Total, and, for conformation traits and for the five vet-check health traits, the **worst rating you will accept** and **how many** may be at that rating (for example, worst = Below average with 2 allows up to two BA traits; worst = Average with 3 allows up to three Average traits and no BA). Nothing may be rated worse than the one you pick. You can also set a **minimum fertility**. Leave a goal on "no limit" to ignore it.

Every horse card, herd row and horse page then shows five labelled boxes above its picture: **Conformation**, **Breed Total**, **Conformation traits**, **Health** and **Fertility**. A box is green if the horse meets that goal, red if it doesn't, and grey if there's no goal set or no data yet. A horse that meets every goal you set is outlined. A **Health** box turns **gold** when more than 3 of the 5 health traits are Excellent, and the **Fertility** box turns gold when fertility is Excellent, whatever your goals say. On a horse's page, each Excellent rating is gold too. Each horse's own page lists its health and fertility ratings once it has had a vet health check (and, for an adult, a fertility test); they are read from the horse's page on Horse Reality. Trait limits are "at or under": a maximum of 2 BA traits accepts horses with 0, 1 or 2.

## Handy extras

- **Filter box:** every list tab (Stallions, My Mares, Colts & Fillies, My Herd, Retired, Other Horses) has a box under the tabs that hides the horses that don't match what you type (name, breed or status).
- **Open in Foal Calculator:** pairing ideas on Analytics and the stallions on a mare's Breeding suggestions page have a button that opens the Foal Calculator with both parents already chosen.
- **Max stud fee:** the Foal Calculator suggestions have a "Max stud fee (HRC)" box that hides other players' stallions that cost more.
- **Breeding plan:** in the Foal Calculator, add the chosen pairing to your plan and tick it off when it's done.
- **Foal results vs. the parents:** Analytics compares each foal's score with its parents' average top conformation.
- **Mark For Sale:** each Sell ideas row has a button that sets the horse's status to For Sale.
- **Backup reminder:** if you haven't exported a backup for 30 days, a bar at the top offers to export one (or to remind you in a week).

## Goal suggestions

Besides conformation and Breed Total, you can set a **minimum Genetic Potential**; it has its own box on every horse. Under the goal boxes, **Goal suggestions** looks at the horses you own (3 and older) and your recent foals and tells you when to change a goal and to what: it suggests a starting value if a goal isn't set, a higher one when 60% or more of your herd already meets it (the level the top third of your herd starts at), or a reachable one when nobody meets it. Click **Apply** to use a suggestion. It also reminds you to review your goals every three months or after three or more new foals.

## Breeding calendar, money and more

- **My Mares** starts with **Foals due** (soonest first) and **Mares ready to breed** (longest open first).
- The toolbar icon badge counts coverings to review plus foals due within a week.
- **Analytics** adds **Money (HRC)**, **Stud fee changes**, **Compare two horses** and **Export to a spreadsheet** (herd, breedings or sales as CSV).
- Every horse page has a **Notes** box (the filter box searches it) and a **Copy sales ad** button.
- **Goal sets** (in Highlight goals) save named sets of goals, such as one per breed, to swap in with one click.
- **Recently deleted** (Other Horses tab) keeps removed horses, stallions and breeding records for 30 days with a **Restore** button.

## Times, ages and the game's rules

The ledger follows the rules on the Horse Reality wiki:

- **Time of breeding:** when you click Breed, the time is saved with the date and shown under the date in the ledger (and in the CSV export).
- **Due date window:** a pregnancy lasts 13.5 to 17 days, so for a mare in foal whose due date the site hasn't shown, Foals due gives an estimated window counted from the covering.
- **Ageing:** a game month is 32 real hours. The age read off a horse's page is moved forward by the time since you last saw it, so a horse that turns 3 shows up as an adult without you opening its page. If Horse Reality's data includes the exact time of birth it is used to land on the right hour, and a foal's official time of birth is saved and shown under its date born.
- **Coverings to review:** a covering is settled 48 hours after breeding, so one still marked Pending after 3 days is listed for review (it is only marked Failed automatically after 6).
- **Label ranges:** hover a conformation or health label to see the hidden number range it stands for (for example Good conformation is 70 to 84).
- **Clinical Approved:** a stallion's Health & Fertility panel says whether he can qualify for the predicate (all five health stats and fertility 75 or more, checked at 7).

## Breed picker on every page and best disciplines

If you breed more than one breed, the **Breed** picker under the tabs on every page limits the whole ledger to one breed: the lists, the Active stallions / mares / colts / fillies counts, Analytics, the calendar, sell ideas and goal suggestions, and the Foal Calculator and Compare lists. Choose **All breeds** to go back. Your choice is remembered.

Every horse page also has **Best disciplines from conformation**, which scores the seven disciplines from the conformation traits each one uses (from the wiki). The game also counts genetic potential stats, training, fitness and tack, which the ledger cannot see, so it is a guide only.

## Removing a horse

Every horse page (stallion, mare, or any other horse) has a **Remove from ledger** button. After you confirm, it deletes everything saved about that horse: its page data and tags, its stallion record with the breedings under him, the breedings where she is the mare, and any foal row for it. The ledger then stops saving that horse when you visit its page. To undo it, open **Other Horses → Removed horses** and click **Allow again**; the horse is saved again the next time you open its page. Export a backup first if you are unsure, because a removal cannot be undone.

## Other Horses

When you open a horse on Horse Reality that **isn't yours**, a small box appears in the bottom-right corner asking whether to add it to your ledger (this needs your username set in Settings, so the extension can tell your horses from other people's).

- **Add to ledger** puts the horse on the **Other Horses** tab. It stays out of My Herd, My Mares and the Stallions tab, so your own numbers aren't affected.
- **No thanks** remembers your answer, and the box won't ask about that horse again.

The Other Horses tab shows each added horse with its picture, breed, sex and owner. Click a name to open its passport, or search for it in the box at the top of any tab (added horses are tagged "Other Horses" in the results). **Remove** takes a horse off the tab but keeps it searchable; the box may appear again the next time you open its page.

## Analytics

The **Analytics** tab turns what the ledger has saved into numbers and advice. It never contacts Horse Reality; it only reads your own records.

- **Overview:** breedings logged, success rate, foals born, pending coverings, stud fees earned and the average foal score.
- **Suggestions:** coverings waiting for a result, stallions with a high failure rate (40% or more once at least 5 have resolved), stallions with no breedings in 45+ days, mares that are not in foal and haven't been bred in 30+ days, horses missing data, and horses that miss your goals by only one box.
- **Pairing ideas:** your free mares crossed with your active stallions, keeping only pairs with an estimated inbreeding under 6.25%. They are ranked by the foal's estimated Breed Total (from both parents' average genetic potential and average top conformation score), nudged up when one parent is strong where the other is Below average ("Covers") and down when both are Below average in the same trait ("Watch") and for inbreeding. A pair where a parent has no show score yet uses the other parent's score only.
- **Breedings per month:** the last 12 months as a bar chart.
- **Top Breed Total, top conformation and goals:** your best horses and how many meet your highlight goals.
- **Stallion and mare tables:** breedings, success rate, failures, foals, foal scores, fees earned and when each was last bred. These list horses aged 3 and over only.
- **Colts & Fillies:** horses under 3 are listed separately, a young stallion as a **Colt** and a young mare as a **Filly**, with age, genetic potential, top conformation and Breed Total.

Click any column heading in the stallion, mare or Colts & Fillies tables to sort by it; click it again to reverse the order (a small arrow shows the direction). Empty values always sort to the bottom. Foal scores are out of 100 (the highest a foal can score). Success rate counts every covering with a known result (pending ones are left out) and counts a covering that produced a foal once.

## Sell ideas

The **Sell ideas** card on the Analytics tab suggests which of your horses to sell and what to ask. Use its form to choose what to look at (mares, stallions, colts and fillies), how to pick (horses missing your highlight goals, or the weakest in your herd) and how to price (quick sale 15% under, fair, or top dollar 15% over). Each suggestion lists the reasons (missed goals, Breed Total below your herd median, never bred, a stallion that fails a lot) and a suggested price with a range. It never suggests a horse that meets all your goals, a Companion, or a mare that is covered or in foal. Prices come from the price per Breed Total point of your most similar past sales, and never go below what you paid; with no sales yet it starts from what you paid. Horses already marked For Sale get a price check too. These are estimates, so check the market before listing.

## Breeding suggestions

Open a mare's page (My Mares, or any mare's profile) and click **Breeding suggestions →** to see the 10 best stallions for her, each with the reasons: the foal's estimated Breed Total (from both parents' genetic potential and top conformation), inbreeding, conformation traits where he covers her weak ones (or where you are both weak), his fertility, what he costs (stud fee, transport and semen vial when known), and whether they have been bred together before.

**Only horses saved in the ledger are considered**: stallions whose pages you have opened on Horse Reality (age 3 and over, not sold or retired, with a genetic potential saved). Open more stallions' pages and they join the list. A mare under 3 gets no suggestions, and a covered or in-foal mare shows a note that the list is for her next breeding.

**Stud fees.** The ledger saves what a stallion costs from two places. His own page lists his *Public Stud Service* and *Private Stud Service* (and any semen vial) with the price in HRC, Delta Points, Foundation and Wildlife tickets. His **Breed** page states the transport fee and the cheapest price per currency. Both are saved on the stallion and shown as his cost in the suggestions. When you click **Breed** on a stallion that isn't yours, the covering is recorded straight away with the price option you ticked and the transport fee; when the bank row for it appears, the amount you really paid replaces it. The last fee you paid him is the fallback when nothing has been saved from his pages.

**Your own stallions.** Your stallions' fees come from the **My Studs** page in the Horse Reality market office (v2.horsereality.com/market/office/my-studs). Open it and the ledger reads your **public** offers (every currency with a price); flip its **Private** switch on and it reads your **private** offers too. Each stallion listed there is yours, so he is added to your Stallions tab if he wasn't, and his **Public** and **Private** fee fields are filled in (when a stallion has several offers, the lowest price per currency is kept). His card always shows both fees (plus a semen vial price when there is one), and his page has a **Stud fees** panel with the date it was read and a **fee history** of every change. You can still edit the fees by hand; they are replaced the next time you open that page.

**Other players' stallions.** A stallion you added to **Other Horses** shows what he costs right on his row (public and private stud, semen vial, the transport fee, who offers him, and the last fee you paid him), and his profile page has a **Stud fees** panel with the same details and the date they were read. They are saved whenever you open his page or his Breed page on Horse Reality.

## Foal Calculator

There is a **Breed** picker (all 34 breeds in Horse Reality, from the wiki) above the selectors. Horse Reality has no crossbreeding, so once you choose a breed, or pick one parent, the other list shows only horses of that breed; the Compare card on Analytics works the same way, and the suggested partners and breeding suggestions only offer the same breed. Horses with no breed saved are never hidden.

Above each selector are check boxes (All, 3+, Under 3, My horses, Other horses, Suggestions) that narrow the horses it offers, one set for mares and one for stallions. **Suggestions** keeps only the horses suggested for the parent picked on the other side. Under the selectors the calculator suggests partners for the mare and/or stallion you picked, split into your horses and other players' horses, saying whether the foal might fit your minimum Breed Total and conformation goals. Click **Use** to pick one. Only horses saved in the ledger are considered.

In the **Mare** list, a mare who is already covered or in foal says so next to her name (✔ COVERED by … / ♥ IN FOAL, in colour), and picking her shows a notice under the pickers saying who she is covered by or due to, and whether the stallion you are comparing is the pairing she already has.

Pick a **mare** and a **stallion** from any horses whose pages you've visited (the lists are grouped into 3 and older, then under 3, with your own horses first in each group) and the **Foal Calculator** shows the average of their genetic potential and checks both pedigrees for shared ancestors up to three generations behind each parent. If any turn up, it lists them with how far back they sit on each side and gives an *estimated* inbreeding percentage (an estimate that ignores the ancestors' own inbreeding, so Horse Reality's figure can be higher).

Once both parents are chosen, each is shown as a card with its picture, breed, genetic potential and tested colours. A **Parent stats** table then compares genetic potential, conformation grades, best conformation show score, inbreeding (COI), height, age, breed, location and training, and a **Conformation traits** table compares each of the 12 traits (Walk, Trot, Canter, Gallop, Posture, Head, Neck, Back, Shoulders, Frontlegs, Hindquarters, Socks) as Good / Average / Below average. Rows where the parents differ are highlighted with ≠, and ▲ marks the stronger parent. Trait ratings are read from each horse's own page the first time you open it on Horse Reality. A **Foal pedigree** tree follows (sire on top, dam below, going back as far as the cached pedigrees reach). Any ancestor that appears on both sides is outlined in red.

The check only knows what has been cached. If some ancestors haven't been visited it says **Pedigree incomplete** and lists them — open those horses' pages on Horse Reality to fill the gaps, rather than treating a missing result as "not inbred". 

### Colour possibilities

Below the inbreeding check, the calculator shows the odds for the foal's **coat colour** (for example Bay 56.3%, Chestnut 25%, Black 18.8%) and **Appaloosa pattern**, plus a collapsible gene-by-gene breakdown. Each parent passes on one copy of every gene with equal chance, and the genes are treated as independent.

- A gene Horse Reality does not list for a horse was not tested, and is treated as not there (so a parent with no PATN1 listed counts as having none). Only the base colour genes E and A are left out when untested. The extension reads the genes Horse Reality shows under "tested colours" (E, A, G, CR, D, LP, PATN1, SW1, W20); anything else is listed as "not known" instead of being guessed.
- **Hidden agouti and W20:** Horse Reality shows agouti only as A or a, but the game also has hidden wild bay (A+) and seal brown (At) alleles (dominance A+ > A > At > a). Under a horse's **Extra genes** you can enter its real agouti genotype, and it only accepts a genotype that agrees with the tested result. Wild bay and seal brown (and wild/brown buckskin and perlino) then show in the colour odds. **W20** (white spotting) can also be entered by hand when Horse Reality has not tested it.
- **Carried or visible:** for genes that can hide (extension E, agouti a, flaxen, silver on a chestnut, PATN1 without LP and so on) a card shows the chance the foal shows the gene, carries it without showing, or does not have it.
- **Colour names:** a single cream copy makes Smokey Black, Buckskin or Palomino, and a double makes Smokey Cream, Perlino or Cremello. Dun (D) makes a black Grulla, a bay Dun and a chestnut Red Dun; a horse with nd1 and no D is a Pseudo Dun.
- **Enter extra genes by hand:** set Sooty, Silver, Flaxen, Champagne, Roan, Tobiano or Sabino for a horse if you know them, either under "Extra genes" on the horse's own page (a stallion's page, a mare's page or any cached horse) or in the calculator itself. Genes are saved on the horse, so you enter them once and every future pairing uses them automatically. They also appear with the horse's other genetics (next to its tested colours) on its page and in the calculator's parent cards. They're also included in backups. If Horse Reality itself ever reports one of these genes for a horse, its value is used and the box is locked.
- Extra genes are part of the **Coat colour** list (for example "Bay Sooty 42.2%"). Any extra gene you haven't set counts as **not present** on that parent (the "Not present (default)" option), so you only need to enter genes a horse actually carries. If the base colour gene (E) isn't tested on both parents, the list still combines the other known genes under "Base colour unknown". An **Extra genes** card lists the chance the foal shows each hand-entered gene (for example Sooty 75%) with the genotype split beneath it; it appears even when the combined coat-colour list can't be built. Colour names follow standard equine genetics (for example Silver only shows on black-based coats and Flaxen only on chestnuts); Horse Reality may label some combinations differently.

## Foals

A mare's foals are picked up three ways: from the **Offspring** tab of one of your stallions, from the mare's own **Foals** tab on Horse Reality (open it once and every foal listed there, with its sire, is added to her breeding history), and from a foal's own page when its dam is one of your mares. A foal is recorded once, under its sire; if the same foal was ever recorded more than once, the copies are merged into one (keeping its score, picture and birth date); a sire you don't own is kept as an *outside stud* (it appears in the mare's history but not on your Stallions tab), and foal scores are read from the list. The same goes for breedings you do to a stallion that isn't yours: clicking **Breed** records the covering against that outside stud with today's date, and the next time you open your bank page the **stud fee you paid** (plus any transport) is read from the "You paid … to breed … with the stud …" row and added to that covering. It shows in the mare's breeding history under Price, with "+ transport" and who you paid beneath it.

## Covered and in-foal mares

A mare's card on **My Mares** shows where she stands: an amber outline and a **✔ Covered** ribbon (with the date) while a covering has been recorded in the last 7 days and has no result yet, and a pink outline with a **♥ In foal** ribbon (with her due date when known) once she is pregnant. The same labels appear as a tag on her own page and in the Status column on Analytics. On Horse Reality's **Breed** page, the mare dropdown also marks them: *♥ IN FOAL (due …)* and *✔ COVERED by …* next to the mare's name, so you can see at a glance who is already bred. The ledger also reads Horse Reality's own signs, so a covering it didn't see you make still shows: the **Covered** pill on a mare's picture, her pregnancy status, and the "Covered 1 day ago … Sire: …" line on her **Info** tab (open her page once). From that line it adds the covering to her history under that sire, with its date. Mares with no label are free to breed. If you have set **Highlight goals** and a covered or in-foal mare clearly misses one of them (one of her goal boxes is red), her card gets a **red outline** and a **⚠ below goals** note on the ribbon (hover it to see which goal), and the Breed page dropdown adds “⚠ BELOW GOALS (…)” in red. Goals with no data yet are not counted as misses, so open the mare's page once to fill them in.

## Breeding dates

When you click **Breed** on Horse Reality's Breed page, the ledger records the covering with today's date (shown as **Date bred**) and the status *Pending*, unless the site shows an error. The foal's **Date born** is filled in from the foal's passport once it's born.

## Understanding breeding statuses

| Status | Meaning |
|---|---|
| **Pending** | A covering was logged (bank transaction or notification), outcome not yet known |
| **Succeeded** | Confirmed pregnant — captured from the mare's own pregnancy status |
| **Failed** | Confirmed not pregnant |
| **Foal Born** | A foal resulting from this covering has arrived, captured from the stallion's Offspring tab |

**A note on failures:** Horse Reality only sends the "covering has failed" notification to the *mare's* owner, never the stud's — so if you're a stud owner, you'd normally never find out a customer's mare didn't take. To cover this gap, the extension automatically marks a "Pending" record **Failed** once it's more than 6 days old with no matching foal for that mare — Horse Reality resolves a covering within about that window, so a longer silence almost always means it didn't take.

You can also change any record's status by hand at any time using the dropdown in its row.

## Reviewing coverings before they auto-fail

Since that 6-day auto-fail happens quietly the next time you're browsing Horse Reality, it's easy to miss — and you'd have no way to double-check it before it happens. So as soon as a "Pending" covering crosses the 6-day mark, it's surfaced at the top of both the Stallions and My Mares tabs, and the toolbar icon badges with a count — even if you haven't opened Horse Reality that day.

![The "Needs Review" panel at the top of the dashboard](images/07-needs-review.png)

Each row links straight to **her page on Horse Reality** — since the failure notification went to her, not you, that's the only place to actually check what happened. From there you can either leave it for the automatic sweep to mark Failed, or jump to the stallion's page and set the status yourself once you know.

## Updating

**Your data is safe as long as you update in place.** Chrome ties an unpacked extension's stored data to the folder it's loaded from, not its contents:

1. Re-download the ZIP and extract it **into the same folder**, overwriting the old files — never a new or different folder.
2. Click the reload icon (⟳) on the extension's card at `chrome://extensions`.
3. If Chrome shows a new-permissions warning, accept it — reloading never clears your data.

**Never click "Remove"** to update — that permanently deletes the extension's stored data, even if you reload it from the same folder right after. If you want a safety net regardless, use **Export Backup** / **Restore Backup** on the dashboard (see below).

## Privacy

Everything lives in `chrome.storage.local` inside your own browser profile and never leaves your machine, except for requests the extension itself makes to `horsereality.com`/`v2.horsereality.com` — the same site you're already using — to read pages and fetch horse data. There is no backend, no account, and no analytics. See the [full privacy policy](../README.md#privacy) for details.

## Troubleshooting

- **Nothing is showing up.** Make sure you've set your username in Settings (Stallions tab) — most auto-tracking depends on matching it against a horse's owner.
- **A stallion I don't own is cluttering things.** If it only exists to anchor one of your mares' breeding history with an outside stud, it's intentionally kept off the Stallions grid — check that mare's own detail page instead.
- **Data seems stale after a Horse Reality update.** The extension reads Horse Reality's own API and page content directly; if the site changes its markup or API shape, some captures may need an update. Open an issue on the [GitHub repository](https://github.com/GoodaleEnt/hr-stallion-mare-ledger/issues) if something stops working.
