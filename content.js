(function () {
  'use strict';

  // --- Horse Reality's own JSON API, fetched directly — same technique
  // HRToolkit (a well-established community extension) uses instead of
  // scraping the rendered page: read the CSRF token HR already exposes to
  // its own page JS via a cookie, and call the same endpoints its SPA
  // calls. This sidesteps the shadow-DOM markup entirely.
  function getAuthData() {
    try {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var eq = cookies[i].indexOf('=');
        if (eq === -1) continue;
        var name = cookies[i].slice(0, eq).trim();
        if (name !== 'hr_auth_production_access_payload') continue;
        var jwt = cookies[i].slice(eq + 1);
        var payloadB64 = jwt.split('.')[1];
        var b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
        var json = decodeURIComponent(atob(b64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(json);
      }
    } catch (e) {}
    return {};
  }
  function parseHorseIdFromUrl() {
    var m = location.pathname.match(/\/horses\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }
  function fetchHorseJson(path) {
    var auth = getAuthData();
    return fetch('https://v2.horsereality.com' + path, {
      method: 'GET',
      credentials: 'include',
      headers: { 'x-csrf-token': auth.hr_csrf || '', accept: 'application/json', 'content-type': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function cleanText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }
  function lifeNumberFromUrl(url) {
    if (!url) return '';
    var m = url.match(/\/horses\/(\d+)\//);
    return m ? m[1] : '';
  }
  function parseHorseLabel(a) {
    if (!a) return '';
    var text = a.textContent || '';
    text = text.replace(/ↆ/g, '');
    text = text.split('|')[0].replace(/^!/, '');
    return text.replace(/\s+/g, ' ').trim();
  }
  function parseScore(strongEl) {
    var text = cleanText(strongEl);
    if (!text) return { score: null, raw: '' };
    var parts = text.split('|');
    var last = parseFloat(parts[parts.length - 1]);
    return { score: isNaN(last) ? null : last, raw: text };
  }
  function parseBankDate(text) {
    var m = text.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!m) return '';
    return m[3] + '-' + m[2] + '-' + m[1];
  }
  function currencyFromCell(cell) {
    var img = cell ? cell.querySelector('img') : null;
    var src = img ? (img.getAttribute('src') || '') : '';
    if (/delta/i.test(src)) return 'DP';
    if (/foundation/i.test(src)) return 'FT';
    if (/wildlife/i.test(src)) return 'WT';
    return 'HRC';
  }

  // --- Source 1: a stallion's Offspring table (.stable_block .row_960) ---
  function scrapeOffspringRows() {
    var rows = document.querySelectorAll('.stable_block .row_960');
    var out = [];
    rows.forEach(function (row) {
      var col200 = row.querySelectorAll(':scope > .col_200');
      var col150 = row.querySelectorAll(':scope > .col_150');
      var col100 = row.querySelectorAll(':scope > .col_100');

      var foalA = col200[0] ? col200[0].querySelector('a') : null;
      var damA = col200[1] ? col200[1].querySelector('a') : null;
      var breederA = col150[1] ? col150[1].querySelector('a') : null;
      var statusText = col100[1] ? cleanText(col100[1]) : '';
      var scoreInfo = col200[0] ? parseScore(col200[0].querySelector('strong')) : { score: null, raw: '' };
      var foalImg = col100[0] ? col100[0].querySelector('.himage_tiny img') : null;

      if (!damA) return;

      out.push({
        mareName: parseHorseLabel(damA),
        mareUrl: damA.href || '',
        mareLifeNumber: lifeNumberFromUrl(damA.href),
        breederName: cleanText(breederA),
        breederUrl: breederA ? breederA.href : '',
        foalName: parseHorseLabel(foalA),
        foalUrl: foalA ? foalA.href : '',
        foalImageUrl: foalImg ? (foalImg.getAttribute('src') || '') : '',
        foalScore: scoreInfo.score,
        status: statusText || 'Foal Born'
      });
    });
    return out;
  }

  // --- Source 2: the account Bank/transactions table (tr.bank-table) ---
  function scrapeBankRows() {
    var rows = document.querySelectorAll('tr.bank-table');
    var out = [];
    rows.forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 4) return;
      if (cleanText(cells[0]) !== 'IN') return;
      var descCell = cells[2];
      var descText = descCell.textContent || '';
      if (descText.indexOf('used your stud service to breed') === -1) return;
      var links = descCell.querySelectorAll('a');
      if (links.length < 3) return;
      var breederA = links[0], mareA = links[1], stallionA = links[2];
      var price = parseInt(cleanText(cells[1]).replace(/\D/g, ''), 10);

      out.push({
        stallionName: cleanText(stallionA),
        stallionUrl: stallionA.href,
        stallionLifeNumber: lifeNumberFromUrl(stallionA.href),
        mareName: cleanText(mareA),
        mareUrl: mareA.href,
        mareLifeNumber: lifeNumberFromUrl(mareA.href),
        breederName: cleanText(breederA),
        breederUrl: breederA.href,
        price: isNaN(price) ? null : price,
        currency: currencyFromCell(cells[1]),
        date: parseBankDate(cleanText(cells[3]))
      });
    });
    return out;
  }

  // Purchases show up on the bank page as OUTgoing rows: "You have bought
  // <horse> from <seller> for 50 000 HRC and paid an additional 500 HRC for
  // transport." Only the horse link, price and (optional) transport fee are
  // needed. Amounts use spaces/NBSP as thousands separators.
  function parseAmountAndCurrency(m, fallback) {
    var amount = parseInt(m[1].replace(/\D/g, ''), 10);
    var cur = (m[2] || '').toUpperCase();
    return { amount: isNaN(amount) ? 0 : amount, currency: (HRLib.CURRENCIES || []).indexOf(cur) > -1 ? cur : fallback };
  }
  function scrapePurchases() {
    var out = [];
    document.querySelectorAll('tr.bank-table').forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 4 || cleanText(cells[0]) !== 'OUT') return;
      var text = cleanText(cells[2]);
      if (text.indexOf('You have bought') === -1) return;
      var horseA = cells[2].querySelector('a');
      var life = horseA ? lifeNumberFromUrl(horseA.href) : '';
      if (!life) return;
      var fallback = currencyFromCell(cells[1]);
      var price = text.match(/ for ([\d\s ,.]+?)\s*([A-Za-z]{2,4})/);
      if (!price) return;
      var ship = text.match(/additional ([\d\s ,.]+?)\s*([A-Za-z]{2,4}) for transport/);
      var p = parseAmountAndCurrency(price, fallback);
      var sh = ship ? parseAmountAndCurrency(ship, fallback) : { amount: 0, currency: fallback };
      out.push({ lifeNumber: life, name: parseHorseLabel(horseA), price: p.amount, currency: p.currency, shipping: sh.amount, shippingCurrency: sh.currency });
    });
    return out;
  }

  // --- Source 3: Horse Reality's own horse-detail JSON API ---
  // Names look like "!ↆMonte Cristo|f?" in both the API and the rendered
  // page — the display name is always the first "|"-separated segment once
  // the leading icon-font markers are stripped.
  function parseHorseNameHeader(text) {
    text = String(text || '').replace(/^!/, '');
    text = text.replace(/ↆ/g, '');
    text = text.split('|')[0];
    return text.replace(/\s+/g, ' ').trim();
  }
  // Runs an optional-enrichment step in isolation: if the API response ever
  // drifts from what this was built against, that must degrade to a
  // missing field, never blow up the whole fetch.
  function safeExtract(fn, fallback) {
    try { return fn(); } catch (e) {
      console.warn('HR Ledger: passport field skipped —', e);
      return fallback;
    }
  }
  var DISCIPLINE_LABELS = {
    reining: 'Western Reining', dressage: 'Dressage', driving: 'Driving',
    endurance: 'Endurance', eventing: 'Eventing', racing: 'Flat Racing',
    showjumping: 'Show Jumping', jumping: 'Show Jumping'
  };
  function disciplineLabel(id) {
    if (DISCIPLINE_LABELS[id]) return DISCIPLINE_LABELS[id];
    return String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function buildTrainingText(disciplines) {
    if (!Array.isArray(disciplines) || !disciplines.length) return '';
    return disciplines.map(function (d) {
      var level = (Number(d.currentLevel) || 0) + 1;
      var pct = Math.round((Number(d.currentLevelProgress) || 0) * 100);
      return disciplineLabel(d.id) + ' - Level ' + level + '/10 - ' + pct + '%';
    }).join(', ');
  }
  function buildPredicatesText(predicates) {
    if (!Array.isArray(predicates) || !predicates.length) return '';
    return predicates.map(function (p) {
      return typeof p === 'string' ? p : (p && p.name) || JSON.stringify(p);
    }).join(', ');
  }
  // Local time, not UTC — Horse Reality's own UI renders dates in the
  // viewer's local timezone (a "22:00:00Z" timestamp can already read as
  // the next calendar day for players ahead of UTC), and this always runs
  // in the same browser/timezone as the person viewing the dashboard.
  function formatBirthdate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }
  // Location isn't its own API field — it's encoded in the profile
  // background image's filename (".../profilebg_north-america.jpg").
  function parseLocationFromImages(imageFull) {
    if (!Array.isArray(imageFull)) return '';
    for (var i = 0; i < imageFull.length; i++) {
      var m = /profilebg_([a-z0-9-]+)\.\w+/i.exec((imageFull[i] && imageFull[i].url) || '');
      if (m) {
        return m[1].split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
      }
    }
    return '';
  }
  function horseProfileUrl(lifeNumber) {
    return 'https://www.horsereality.com/horses/' + lifeNumber + '/';
  }
  function userProfileUrl(id) {
    return id ? 'https://v2.horsereality.com/user/' + id + '/' : '';
  }
  // The passport's pedigree only carries each ancestor's life number — the
  // actual name/score/breeder comes from the sibling `related.horses` list.
  function resolveAncestor(ref, relatedHorses) {
    if (!ref || !ref.lifeNumber) return null;
    var full = (relatedHorses || []).find(function (h) { return h.lifeNumber === ref.lifeNumber; });
    return {
      name: full ? parseHorseNameHeader(full.name) : '',
      url: horseProfileUrl(ref.lifeNumber),
      lifeNumber: ref.lifeNumber,
      scoreRaw: full ? (full.tagline || '') : '',
      estate: full && full.breeder ? (full.breeder.estateName || '') : ''
    };
  }
  // The passport's pedigree is walked as deep as the API provides it (each
  // ancestor node may carry its own sire/dam), keeping only life numbers —
  // names come from the sibling `related.horses` list. Drives the dashboard's
  // Foal Calculator; if the API only returns parents this is simply shallow.
  function buildPedigreeTree(node, depthLeft) {
    if (!node || !node.lifeNumber || depthLeft < 1) return null;
    var out = { l: String(node.lifeNumber) };
    var s = buildPedigreeTree(node.sire, depthLeft - 1);
    var d = buildPedigreeTree(node.dam, depthLeft - 1);
    if (s) out.s = s;
    if (d) out.d = d;
    return out;
  }
  function buildPedigreeNames(relatedHorses) {
    var out = {};
    (relatedHorses || []).forEach(function (h) {
      if (h && h.lifeNumber) out[String(h.lifeNumber)] = parseHorseNameHeader(h.name);
    });
    return out;
  }
  function foalSexLabel(sex) {
    if (sex === 'stallion') return 'Colt';
    if (sex === 'mare') return 'Filly';
    return '';
  }
  function toIsoDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function buildPregnancyInfo(horse, passportRoot, relatedHorses) {
    if (horse.pregnancyStatus !== 'pregnant') {
      return horse.pregnancyStatus ? { status: horse.pregnancyStatus, dueText: '', sireName: '', sireUrl: '', sireLifeNumber: '' } : null;
    }
    var preg = passportRoot.pregnancy || {};
    var sireInfo = resolveAncestor(preg.sire ? { lifeNumber: preg.sire } : null, relatedHorses);
    var foalLabel = foalSexLabel(preg.sex);
    // Horse Reality gives a delivery date; a covering date is used only if the
    // API happens to expose one under a recognisable name.
    var startKey = ['coveringDate', 'coveredAt', 'inseminationDate', 'inseminatedAt', 'breedingDate', 'startDate', 'startedAt'].find(function (k) { return preg[k]; });
    return {
      deliveryDate: toIsoDate(preg.deliveryDate),
      coveredDate: startKey ? toIsoDate(preg[startKey]) : '',
      status: 'Pregnant' + (foalLabel ? ' (Unborn ' + foalLabel + ')' : ''),
      dueText: preg.deliveryDate ? ('Due ' + formatBirthdate(preg.deliveryDate)) : '',
      sireName: sireInfo ? sireInfo.name : '',
      sireUrl: sireInfo ? sireInfo.url : '',
      sireLifeNumber: preg.sire || ''
    };
  }
  function buildHorseInfoFromApi(lifeNumber, horseResp, passportResp) {
    var horse = horseResp && horseResp.horse ? horseResp.horse : null;
    if (!horse) return null;
    var passportRoot = passportResp && passportResp.horsePassport ? passportResp.horsePassport : {};
    var passport = passportRoot.passport || {};
    var ancestry = passportRoot.ancestry || {};
    var relatedHorses = (passportResp && passportResp.related && passportResp.related.horses) || [];
    var pedigree = ancestry.pedigree || {};
    var genetics = horse.geneticSummary || {};
    var coiValue = (typeof ancestry.coi === 'number') ? ancestry.coi : null;
    var geneticPotential = parseInt(genetics.potential, 10);
    // The horse endpoint's own `related.estates.location` is the direct
    // source; the background-image filename is only a fallback for horses
    // where that isn't present.
    var location = (horseResp.related && horseResp.related.estates && horseResp.related.estates.location) || parseLocationFromImages(horse.imageFull);

    return {
      name: parseHorseNameHeader(horse.name),
      lifeNumber: lifeNumber,
      sex: horse.sex || '',
      breed: horse.breed ? horse.breed.name : '',
      imageUrl: (horse.imagePassport && horse.imagePassport[0] && horse.imagePassport[0].url) || '',
      height: passport.height != null ? (passport.height + ' cm') : '',
      location: location,
      dateOfBirth: formatBirthdate(passport.birthdate),
      ownerName: horse.owner ? horse.owner.name : '',
      ownerUrl: horse.owner ? userProfileUrl(horse.owner.id) : '',
      ownerStable: horse.estate ? horse.estate.name : '',
      horseBreederName: horse.breeder ? horse.breeder.name : '',
      horseBreederUrl: horse.breeder ? userProfileUrl(horse.breeder.id) : '',
      horseBreederStable: horse.breeder ? horse.breeder.estateName : '',
      geneticPotential: isNaN(geneticPotential) ? null : geneticPotential,
      conformation: genetics.conformation || '',
      testedColours: genetics.colour || '',
      training: buildTrainingText(horse.disciplines),
      predicates: buildPredicatesText(passport.predicates),
      coi: coiValue,
      coiRaw: coiValue != null ? coiValue.toFixed(2) + '%' : '',
      sire: resolveAncestor(pedigree.sire, relatedHorses),
      dam: resolveAncestor(pedigree.dam, relatedHorses),
      pregnancy: buildPregnancyInfo(horse, passportRoot, relatedHorses),
      pedigreeTree: safeExtract(function () {
        var s = buildPedigreeTree(pedigree.sire, 5), d = buildPedigreeTree(pedigree.dam, 5);
        if (!s && !d) return null;
        var root = { l: String(lifeNumber) };
        if (s) root.s = s;
        if (d) root.d = d;
        return root;
      }, null),
      pedigreeNames: safeExtract(function () { return buildPedigreeNames(relatedHorses); }, {})
    };
  }
  // Recorded into state so a *screenshot of the dashboard* is enough to
  // diagnose a failure on someone else's machine — asking a non-technical
  // player to open DevTools and read the console isn't realistic.
  function fetchAndMergeHorseInfo() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    var auth = getAuthData();
    var hasToken = !!auth.hr_csrf;
    var errors = [];
    Promise.all([
      fetchHorseJson('/api/player/horse/' + id).catch(function (e) { errors.push('horse: ' + (e && e.message || e)); return null; }),
      fetchHorseJson('/api/player/horse/' + id + '/passport').catch(function (e) { errors.push('passport: ' + (e && e.message || e)); return null; })
    ]).then(function (results) {
      var horseInfo = safeExtract(function () { return buildHorseInfoFromApi(id, results[0], results[1]); }, null);
      if (horseInfo) mergeHorseInfo(horseInfo);

      HRStorage.getState(function (state) {
        state.apiDiagnostics = {
          lastCheckedAt: Date.now(),
          lastHorseId: id,
          csrfTokenFound: hasToken,
          ok: hasToken && !errors.length && !!horseInfo,
          errors: errors
        };
        HRStorage.setState(state);
      });
    });
  }

  // --- Source 4: the Notifications log (tr.notifications-table) ---
  // "The covering between [mare] and [stud] has failed, your mare is not
  // pregnant." — this is the only reliable source of failure data, since
  // neither the bank nor the offspring table ever mentions an attempt that
  // didn't result in a foal.
  // Scoped to `tr` generally rather than `tr.notifications-table`
  // specifically — Horse Reality's markup has shifted before (the passport
  // pages moved to a shadow-DOM component entirely), and the notification
  // text itself is distinctive enough that a broader net costs nothing.
  function scrapeFailedCoverings() {
    var out = [];
    document.querySelectorAll('tr').forEach(function (row) {
      var text = row.textContent || '';
      if (text.indexOf('has failed, your mare is not pregnant') === -1) return;
      var links = row.querySelectorAll('a');
      if (links.length < 2) return;
      out.push({
        mareName: parseHorseLabel(links[0]),
        mareUrl: links[0].href,
        mareLifeNumber: lifeNumberFromUrl(links[0].href),
        stallionName: parseHorseLabel(links[1]),
        stallionUrl: links[1].href,
        stallionLifeNumber: lifeNumberFromUrl(links[1].href),
        date: parseRowDate(text)
      });
    });
    return out;
  }
  // The notification's own date: "dd-mm-yyyy" if shown, else "Today"/"Yesterday".
  function parseRowDate(text) {
    var iso = parseBankDate(text || '');
    if (iso) return iso;
    var offset = /\bYesterday\b/i.test(text) ? 1 : (/\bToday\b/i.test(text) ? 0 : null);
    if (offset == null) return '';
    var d = new Date();
    d.setDate(d.getDate() - offset);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'background:#46592C', 'color:#fff',
      'padding:10px 16px', 'border-radius:8px', 'font:14px system-ui,sans-serif',
      'z-index:2147483647', 'box-shadow:0 4px 14px rgba(0,0,0,.25)'
    ].join(';');
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // Horse Reality's image CDN appears to reject cross-origin loads, so the
  // dashboard can never hotlink horse-img.horsereality.com directly. Instead,
  // fetch the bytes here (on the real page, not blocked) via the background
  // worker and store a self-contained data URL. This is used only by the
  // separate, non-blocking image-attaching passes below — it must never gate
  // the core data merge, or a slow/failed fetch would silently stop
  // everything else from saving too.
  function fetchImageAsDataUrl(url) {
    if (!url) return Promise.resolve('');
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'HR_FETCH_IMAGE', url: url }, function (response) {
        void chrome.runtime.lastError; // acknowledge to avoid an unchecked-error warning
        resolve((response && response.dataUrl) || '');
      });
    });
  }

  // A stallion can first be saved as a lightweight `owned: false` stub (a
  // failed-covering notification or a mare's pregnancy named him). When a
  // page later PROVES he's yours (a bank fee, or his own passport naming you
  // as owner), the stub must be promoted — otherwise the match is found, no
  // new stud is created, and he never appears on the Stallions tab.
  function promoteStubStallion(state, stallionId) {
    var rec = state.stallions.find(function (x) { return x.id === stallionId; });
    if (!rec || rec.owned !== false) return false;
    rec.owned = true;
    return true;
  }

  function mergeIntoLedger() {
    var offspring = scrapeOffspringRows();
    var bank = scrapeBankRows();
    var failedCoverings = scrapeFailedCoverings();
    var purchases = scrapePurchases();
    if (!offspring.length && !bank.length && !failedCoverings.length && !purchases.length) return;

    HRStorage.getState(function (state) {
      var added = 0, updated = 0, newStuds = 0, failuresMarked = 0, purchasesSaved = 0;
      var offspringStallionId = null;

      // Bank transactions are the one page that PROVES the stud is yours
      // (the fee landed in your own account) — safe to auto-create from.
      bank.forEach(function (row) {
        var stallionId = HRLib.findStallionMatch(state.stallions, row);
        if (!stallionId) {
          var res = HRStorage.upsertStallionByMatch(state, { name: row.stallionName, lifeNumber: row.stallionLifeNumber });
          stallionId = res.id;
          if (res.created) newStuds++;
        } else if (promoteStubStallion(state, stallionId)) {
          newStuds++;
        }
        var result = HRStorage.upsertBreeding(state, stallionId, {
          mareName: row.mareName, mareLifeNumber: row.mareLifeNumber, mareUrl: row.mareUrl,
          breederName: row.breederName, breederUrl: row.breederUrl,
          price: row.price, currency: row.currency, feeType: 'Public',
          date: row.date, status: 'Pending'
        });
        if (result === 'added') added++; else updated++;
      });

      // Viewing a horse's Offspring tab does NOT prove you own it — you
      // could just be browsing someone else's stud. The URL itself carries
      // this horse's life number, so match against that; only UPDATE an
      // already-tracked stallion, never create one from this page alone.
      if (offspring.length) {
        var urlId = parseHorseIdFromUrl();
        var matchId = urlId ? HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: urlId }) : null;
        if (matchId) {
          offspringStallionId = matchId;
          offspring.forEach(function (row) {
            var result = HRStorage.upsertBreeding(state, matchId, {
              mareName: row.mareName, mareLifeNumber: row.mareLifeNumber, mareUrl: row.mareUrl,
              breederName: row.breederName, breederUrl: row.breederUrl,
              price: null, currency: 'HRC', feeType: 'Public',
              date: '', status: row.status,
              foalName: row.foalName, foalUrl: row.foalUrl, foalScore: row.foalScore
            });
            if (result === 'added') added++; else updated++;
          });
        }
      }

      // Only fires when the failed covering used one of YOUR tracked studs —
      // this notification appears on the MARE owner's own feed regardless of
      // whose stud was used, so it's the one reliable signal for tracking a
      // covering that didn't involve one of your own studs. Unlike the rest
      // of this function, it's allowed to create both a lightweight
      // external stud stub (marked `owned: false`, kept out of your own
      // Stallions grid) and the breeding record itself — otherwise a mare
      // bred outside your own studs, or a free self-breeding that never
      // generated a bank transaction, would never get recorded at all.
      failedCoverings.forEach(function (f) {
        if (!f.stallionLifeNumber) return;
        var sid = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: f.stallionLifeNumber });
        if (!sid) {
          var res = HRStorage.upsertStallionByMatch(state, { name: f.stallionName, lifeNumber: f.stallionLifeNumber, owned: false });
          sid = res.id;
        }
        var list = state.breedings[sid] || [];
        var match = list.find(function (b) {
          return f.mareLifeNumber && b.mareLifeNumber === f.mareLifeNumber && b.status !== 'Failed' && b.status !== 'Foal Born';
        });
        if (match) {
          match.status = 'Failed';
          if (!match.date && f.date) match.date = f.date;
        } else {
          HRStorage.upsertBreeding(state, sid, {
            mareName: f.mareName || '', mareLifeNumber: f.mareLifeNumber, mareUrl: f.mareUrl,
            breederName: state.settings.myUsername || '', breederUrl: '',
            price: null, currency: 'HRC', feeType: 'Public',
            date: f.date || '', status: 'Failed'
          });
        }
        failuresMarked++;
      });

      // What you paid for a horse. Never overwrites a figure you typed in
      // yourself — only fills in a price/shipping that isn't recorded yet.
      purchases.forEach(function (pu) {
        var meta = state.horseMeta[pu.lifeNumber] = Object.assign({}, state.horseMeta[pu.lifeNumber]);
        var rec = meta.purchase = Object.assign({}, meta.purchase);
        var changed = false;
        if (pu.price && !rec.price) { rec.price = pu.price; rec.currency = pu.currency; changed = true; }
        if (pu.shipping && !rec.shipping) { rec.shipping = pu.shipping; rec.shippingCurrency = pu.shippingCurrency; changed = true; }
        if (changed) purchasesSaved++;
      });

      if (added || updated || newStuds || failuresMarked || purchasesSaved) {
        HRStorage.setState(state, function () {
          var parts = [];
          if (added) parts.push(added + ' new');
          if (updated) parts.push(updated + ' updated');
          if (newStuds) parts.push(newStuds + ' new stud' + (newStuds === 1 ? '' : 's'));
          if (failuresMarked) parts.push(failuresMarked + ' marked failed');
          if (purchasesSaved) parts.push(purchasesSaved + ' purchase' + (purchasesSaved === 1 ? '' : 's') + ' recorded');
          if (parts.length) showToast('HR Ledger: ' + parts.join(', '));
        });
      }

      // Images are fetched and attached afterward, independently — a slow or
      // failed image fetch must never block the data above from saving.
      attachOffspringImages(offspringStallionId, offspring);
      cacheFoalBirthdates(offspringStallionId, offspring);
    });
  }

  // The Offspring table doesn't show when a foal was born. Look each foal up
  // once (Horse Reality's own horse API, same as visiting its page) and keep
  // its birthdate on the breeding record. Capped per page load, skipped for
  // foals already known, and failures are silent.
  var FOAL_LOOKUP_CAP = 12;
  function cacheFoalBirthdates(stallionId, offspring) {
    if (!stallionId) return;
    HRStorage.getState(function (state) {
      var list = state.breedings[stallionId] || [];
      var todo = [];
      offspring.forEach(function (row) {
        var life = lifeNumberFromUrl(row.foalUrl);
        var rec = list.find(function (b) { return HRLib.breedingMatchKey(b) === HRLib.breedingMatchKey(Object.assign({ price: null, date: '' }, row)); });
        if (!life || !rec || rec.dateBorn || todo.some(function (t) { return t.life === life; })) return;
        var info = state.horseInfo[life];
        if (info && info.dateOfBirth) { rec.dateBorn = info.dateOfBirth; todo.changed = true; return; }
        if (todo.length < FOAL_LOOKUP_CAP) todo.push({ life: life, key: HRLib.breedingMatchKey(rec) });
      });
      if (todo.changed) HRStorage.setState(state);
      if (!todo.length) return;
      Promise.all(todo.map(function (t) {
        return fetchHorseJson('/api/player/horse/' + t.life + '/passport').then(function (resp) {
          var root = resp && resp.horsePassport ? resp.horsePassport : {};
          return { life: t.life, key: t.key, birth: root.passport && root.passport.birthdate };
        }).catch(function () { return null; });
      })).then(function (results) {
        var found = results.filter(function (r) { return r && r.birth; });
        if (!found.length) return;
        HRStorage.getState(function (fresh) {
          var rows = fresh.breedings[stallionId] || [];
          found.forEach(function (r) {
            var rec = rows.find(function (b) { return HRLib.breedingMatchKey(b) === r.key; });
            var d = new Date(r.birth);
            if (rec && !isNaN(d.getTime())) rec.dateBorn = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          });
          HRStorage.setState(fresh);
        });
      });
    });
  }

  // The horse-info API fetch runs on its own schedule (triggered by URL,
  // not DOM readiness), so it merges into storage independently of the
  // synchronous bank/offspring/notifications flow above.
  // Without a username the extension can't tell your horses from anyone
  // else's, and caching a horse page is otherwise silent — so a fresh
  // install would look dead. Nudge once per page load.
  var usernameNudged = false;
  function mergeHorseInfo(horseInfo) {
    HRStorage.getState(function (state) {
      var infoRefreshed = false, passportCached = false, newStud = false;
      var infoStallionId = null;

      // Caching a horse's passport snapshot is NOT an ownership claim — it's
      // just reference data (genetics, pedigree, pregnancy...), so this runs
      // for every horse page you view, yours or not. Skip the write when
      // nothing actually changed, so re-visiting the same horse repeatedly
      // doesn't spam storage writes.
      var existing = state.horseInfo[horseInfo.lifeNumber];
      var existingComparable = existing ? Object.assign({}, existing) : null;
      if (existingComparable) delete existingComparable.capturedAt;
      if (!existingComparable || JSON.stringify(existingComparable) !== JSON.stringify(horseInfo)) {
        HRStorage.upsertHorseInfo(state, horseInfo.lifeNumber, horseInfo);
        passportCached = true;
      }

      var matchId = HRLib.findStallionMatch(state.stallions, { stallionName: horseInfo.name, stallionLifeNumber: horseInfo.lifeNumber });

      // The horse's own API data names its owner directly — if that matches
      // the username configured in Settings, viewing the page IS proof of
      // ownership (stronger than waiting for a bank transaction to land).
      // Only stallions get auto-tracked here; mares surface via "My Mares"
      // once a breeding record exists for them.
      var myName = (state.settings.myUsername || '').trim().toLowerCase();
      if (!myName && !usernameNudged) {
        usernameNudged = true;
        setTimeout(function () { showToast('HR Ledger: set your Horse Reality username in the dashboard so it can track your horses'); }, 4500);
      }
      if (!matchId && horseInfo.sex === 'stallion' && myName && horseInfo.ownerName && horseInfo.ownerName.trim().toLowerCase() === myName) {
        var created = HRStorage.upsertStallionByMatch(state, {
          name: horseInfo.name, lifeNumber: horseInfo.lifeNumber,
          breed: horseInfo.breed, imageUrl: horseInfo.imageUrl
        });
        matchId = created.id;
        newStud = created.created;
      }

      if (matchId && horseInfo.sex === 'stallion' && myName && horseInfo.ownerName && horseInfo.ownerName.trim().toLowerCase() === myName && promoteStubStallion(state, matchId)) {
        newStud = true;
      }

      if (matchId) {
        infoStallionId = matchId;
        var s = state.stallions.find(function (x) { return x.id === matchId; });
        if (horseInfo.name && s.name !== horseInfo.name) { s.name = horseInfo.name; infoRefreshed = true; }
        if (horseInfo.breed && s.breed !== horseInfo.breed) { s.breed = horseInfo.breed; infoRefreshed = true; }
      }

      // A mare's own pregnancy status is a direct, reliable signal for a
      // SUCCESSFUL covering — same reasoning as the failure-notification
      // handling in mergeIntoLedger: track it even when the sire isn't one
      // of your own studs, via a lightweight external stud stub if needed,
      // so a mare bred outside your own studs still shows her history.
      var pregnancyMarked = false;
      if (horseInfo.sex === 'mare' && horseInfo.pregnancy && horseInfo.pregnancy.sireLifeNumber && (horseInfo.pregnancy.status || '').indexOf('Pregnant') === 0) {
        var sireId = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: horseInfo.pregnancy.sireLifeNumber });
        if (!sireId) {
          var sireRes = HRStorage.upsertStallionByMatch(state, { name: horseInfo.pregnancy.sireName, lifeNumber: horseInfo.pregnancy.sireLifeNumber, owned: false });
          sireId = sireRes.id;
        }
        var sireList = state.breedings[sireId] || [];
        var pregMatch = sireList.find(function (b) {
          return b.mareLifeNumber === horseInfo.lifeNumber && b.status !== 'Failed' && b.status !== 'Foal Born';
        });
        if (pregMatch) {
          if (pregMatch.status !== 'Succeeded') { pregMatch.status = 'Succeeded'; pregnancyMarked = true; }
          if (!pregMatch.date) {
            // No covering date anywhere on the page: use the day the mare was
            // first seen in foal (usually the day you bred her), flagged approximate.
            pregMatch.date = horseInfo.pregnancy.coveredDate || toIsoDate(Date.now());
            if (!horseInfo.pregnancy.coveredDate) pregMatch.dateApprox = true;
            pregnancyMarked = true;
          }
        } else {
          HRStorage.upsertBreeding(state, sireId, {
            mareName: horseInfo.name, mareLifeNumber: horseInfo.lifeNumber, mareUrl: horseProfileUrl(horseInfo.lifeNumber),
            // The mare's real owner, not you — otherwise any pregnant mare you
            // merely look at would be listed under My Mares.
            breederName: horseInfo.ownerName || '', breederUrl: '',
            price: null, currency: 'HRC', feeType: 'Public',
            date: horseInfo.pregnancy.coveredDate || toIsoDate(Date.now()), dateApprox: !horseInfo.pregnancy.coveredDate, status: 'Succeeded'
          });
          pregnancyMarked = true;
        }
      }

      if (infoRefreshed || passportCached || newStud || pregnancyMarked) {
        HRStorage.setState(state, function () {
          if (newStud) {
            showToast('HR Ledger: added ' + horseInfo.name + ' as a new stud');
            // Offspring rows on this same page may have been scraped before
            // the stud existed to attach to — retry now that it does.
            mergeIntoLedger();
          } else if (pregnancyMarked) {
            showToast('HR Ledger: ' + horseInfo.name + ' marked in foal');
          } else if (passportCached && !existing) {
            showToast('HR Ledger: saved ' + (horseInfo.name || 'horse') + ' to your ledger');
          } else if (infoRefreshed) {
            // A bare passport-cache refresh (no ledger change) stays silent —
            // showing a toast on every single horse page you browse would be noise.
            showToast('HR Ledger: info refreshed');
          }
        });
      }

      attachHorseImage(infoStallionId, horseInfo);

      // Not yours (and not already tracked or dismissed): offer to add it.
      var ownedByMe = myName && horseInfo.ownerName && horseInfo.ownerName.trim().toLowerCase() === myName;
      var meta = state.horseMeta[horseInfo.lifeNumber] || {};
      var s2 = matchId ? state.stallions.find(function (x) { return x.id === matchId; }) : null;
      var alreadyTracked = meta.tracked || (s2 && s2.owned !== false);
      if (myName && !ownedByMe && !alreadyTracked && !meta.declined && !offeredFor[horseInfo.lifeNumber]) {
        offeredFor[horseInfo.lifeNumber] = true;
        showAddPrompt(horseInfo);
      }
    });
  }

  var offeredFor = {};
  function showAddPrompt(horseInfo) {
    var old = document.getElementById('hr-ledger-add-prompt');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'hr-ledger-add-prompt';
    box.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'max-width:320px', 'background:#fff', 'color:#222',
      'padding:14px 16px', 'border-radius:8px', 'border:2px solid #46592C', 'font:14px system-ui,sans-serif',
      'z-index:2147483647', 'box-shadow:0 4px 14px rgba(0,0,0,.3)'
    ].join(';');
    var msg = document.createElement('div');
    msg.style.cssText = 'margin-bottom:10px;line-height:1.4';
    var strong = document.createElement('strong');
    strong.textContent = horseInfo.name || ('#' + horseInfo.lifeNumber);
    msg.appendChild(strong);
    msg.appendChild(document.createTextNode(' isn’t one of your horses. Add to your ledger?'));
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    function btn(label, primary) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'cursor:pointer;border-radius:6px;padding:6px 12px;font:inherit;border:1px solid #46592C;' +
        (primary ? 'background:#46592C;color:#fff' : 'background:#fff;color:#46592C');
      return b;
    }
    var no = btn('No thanks', false), yes = btn('Add to ledger', true);
    no.onclick = function () { box.remove(); markHorse(horseInfo, false); };
    yes.onclick = function () { box.remove(); markHorse(horseInfo, true); };
    row.appendChild(no);
    row.appendChild(yes);
    box.appendChild(msg);
    box.appendChild(row);
    document.body.appendChild(box);
  }

  function markHorse(horseInfo, add) {
    HRStorage.getState(function (state) {
      var life = horseInfo.lifeNumber;
      var meta = state.horseMeta[life] = Object.assign({}, state.horseMeta[life]);
      if (!add) {
        meta.declined = true;
        HRStorage.setState(state);
        return;
      }
      meta.tracked = true;
      delete meta.declined;
      HRStorage.setState(state, function () {
        showToast('HR Ledger: added ' + (horseInfo.name || 'horse') + ' to Other Horses');
      });
    });
  }

  // Best-effort, fire-and-forget. Re-reads a FRESH copy of state once the
  // fetches resolve (rather than reusing the closure above) so this can
  // never race a write that happened while the fetches were in flight.
  function attachOffspringImages(stallionId, offspring) {
    if (!stallionId) return;
    var jobs = [];
    offspring.forEach(function (row) {
      if (!row.foalImageUrl) return;
      jobs.push(fetchImageAsDataUrl(row.foalImageUrl).then(function (dataUrl) {
        return { row: row, dataUrl: dataUrl };
      }));
    });
    if (!jobs.length) return;

    Promise.all(jobs).then(function (results) {
      if (!results.some(function (r) { return r.dataUrl; })) return;
      HRStorage.getState(function (state) {
        var list = state.breedings[stallionId] || [];
        results.forEach(function (r) {
          if (!r.dataUrl) return;
          var key = HRLib.breedingMatchKey(r.row);
          var rec = list.find(function (b) { return HRLib.breedingMatchKey(b) === key; });
          if (rec) rec.foalImageUrl = r.dataUrl;
        });
        HRStorage.setState(state);
      });
    });
  }

  // Converts the horse's CDN image to a data URL and caches it — not just
  // onto a tracked stallion record (if any), but onto its state.horseInfo
  // entry too, so a horse's portrait renders reliably everywhere it's
  // shown (My Mares, Colts & Fillies, search results), not only for owned
  // stallions. Needed because the CDN blocks hotlinked/cross-origin loads.
  function attachHorseImage(stallionId, horseInfo) {
    if (!horseInfo || !horseInfo.lifeNumber || !horseInfo.imageUrl) return;
    fetchImageAsDataUrl(horseInfo.imageUrl).then(function (dataUrl) {
      if (!dataUrl) return;
      HRStorage.getState(function (state) {
        var changed = false;
        if (stallionId) {
          var s = state.stallions.find(function (x) { return x.id === stallionId; });
          if (s) { s.imageUrl = dataUrl; changed = true; }
        }
        var info = state.horseInfo[horseInfo.lifeNumber];
        if (info) { info.imageUrl = dataUrl; changed = true; }
        if (changed) HRStorage.setState(state);
      });
    });
  }

  // Horse Reality's pages are a client-rendered (Svelte) app: the
  // bank/offspring/notifications markup can take longer than a fixed
  // timeout to hydrate behind all the analytics/ad scripts also loading,
  // and navigating to another horse via the prev/next arrows changes the
  // URL via the History API without a full page reload — so content
  // scripts never re-inject for it. A short, give-up-after-N-tries poll
  // (the old approach) fails on both counts. Instead: watch indefinitely
  // for the trigger elements via MutationObserver (reacts the instant they
  // appear, no matter how slow hydration is), run the merge once, then
  // disconnect — and separately watch the URL itself so an in-app
  // navigation re-arms everything for the next page.
  function tryMergeOnce() {
    var ready = document.querySelector('.stable_block .row_960') || document.querySelector('tr.bank-table') || document.querySelector('tr.notifications-table');
    if (!ready) return false;
    mergeIntoLedger();
    return true;
  }

  function watchForContent() {
    if (tryMergeOnce()) return;

    var observer = new MutationObserver(function () {
      if (tryMergeOnce()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety net so a page that will never show any of our trigger
    // elements doesn't leave an observer running forever.
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  // A stud owner never gets the "covering has failed" notification for a
  // CUSTOMER's mare — that notification only ever reaches the mare's own
  // owner. Horse Reality resolves a covering within about 6 days, so a
  // "Pending" record that old with no matching "Foal Born" record for the
  // same mare almost certainly failed. Runs on every page load — it's pure
  // computation over already-stored data, no scraping needed.
  var STALE_PENDING_DAYS = 6;
  function sweepStaleFailedCoverings(state) {
    var candidates = HRLib.findReviewCandidates(state, STALE_PENDING_DAYS);
    candidates.forEach(function (c) { c.breeding.status = 'Failed'; });
    return candidates.length;
  }
  function sweepAndPersistStaleFailures() {
    HRStorage.getState(function (state) {
      var marked = sweepStaleFailedCoverings(state);
      if (marked) {
        HRStorage.setState(state, function () {
          showToast('HR Ledger: ' + marked + ' marked failed (no foal after ' + STALE_PENDING_DAYS + ' days)');
        });
      }
    });
  }

  // Horse Reality's own age display (e.g. "3 years 1 month", in a `#age`
  // element on the horse's own page) is ground truth — it already accounts
  // for aging boosts/Delta Points that a birthdate-based estimate can't
  // see, and matches what the player sees in-game exactly. Scraped
  // straight from the DOM (like the bank/offspring tables) rather than the
  // API, since the API's passport data only exposes a raw birthdate.
  function scrapeAndMergeAgeText() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    function tryCapture() {
      var el = document.querySelector('#age');
      if (!el) return false;
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return false;
      var months = HRLib.parseAgeText(text);
      if (months == null) return false;
      HRStorage.getState(function (state) {
        if (!state.horseInfo) state.horseInfo = {};
        var info = state.horseInfo[id];
        if (!info) { info = { lifeNumber: id }; state.horseInfo[id] = info; }
        if (info.ageMonths === months && info.ageText === text) return;
        info.ageMonths = months;
        info.ageText = text;
        info.capturedAt = Date.now();
        HRStorage.setState(state);
      });
      return true;
    }
    if (tryCapture()) return;
    var observer = new MutationObserver(function () {
      if (tryCapture()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  // A horse's stats page lists only its latest 25 shows. The best conformation
  // score is kept in the ledger and only ever raised, so it survives once that
  // score drops off the list. Two sources, both feeding the same maximum:
  //  1. Horse Reality's own "Latest 25 show results" rows (.row_460), points in
  //     the third column — breed-type (BT) categories are skipped.
  //  2. If the HRToolkit extension is also installed, its injected "All-time
  //     Confo" / "Current Confo" summary rows — its all-time figure can reach
  //     further back than the 25 listed shows.
  // Show date from a results-row cell: "dd-mm-yyyy", "Today"/"Yesterday",
  // "yyyy-mm-dd" or "5 Mar 2026". Empty string when it isn't a date.
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function parseShowDate(text) {
    text = String(text || '');
    var iso = parseRowDate(text);
    if (iso) return iso;
    var m = /([0-9]{4})-([0-9]{2})-([0-9]{2})/.exec(text);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = /([0-9]{1,2}) ([A-Za-z]{3,9}) ([0-9]{4})/.exec(text);
    if (m) {
      var mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi > -1) return m[3] + '-' + String(mi + 1).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    }
    return '';
  }
  function readConfoHighs() {
    var highs = [];
    function number(text) {
      var m = /\d+(?:\.\d+)?/.exec(String(text || '').replace(/,/g, ''));
      return m ? parseFloat(m[0]) : NaN;
    }
    document.querySelectorAll('.half_block').forEach(function (block) {
      var top = block.querySelector('.top');
      if (!top || !/show results/i.test(top.textContent || '')) return;
      block.querySelectorAll('.row_460').forEach(function (row) {
        var cols = row.querySelectorAll(':scope > div');
        if (cols.length < 3) return;
        var category = (cols[1].textContent || '').replace(/\s+/g, ' ').trim();
        if (/\bBT\b|breed\s*type/i.test(category)) return;
        var value = number(cols[2].textContent);
        if (!(isFinite(value) && value > 0)) return;
        // Whatever isn't the points column: the first date-like cell is the
        // show date, the rest (show / category) is kept as the details.
        var date = '', details = [];
        for (var i = 0; i < cols.length; i++) {
          if (i === 2) continue;
          var t = (cols[i].textContent || '').replace(/\s+/g, ' ').trim();
          if (!t) continue;
          var d = parseShowDate(t);
          if (d && !date) date = d; else if (!d) details.push(t);
        }
        highs.push({ value: value, date: date, event: details.join(' · ').slice(0, 90) });
      });
    });
    document.querySelectorAll('tr').forEach(function (tr) {
      var cells = tr.querySelectorAll('th, td');
      if (cells.length < 2) return;
      var label = (cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      if (!/^(all-time|current) confo$/i.test(label)) return;
      var value = number(cells[1].textContent);
      if (isFinite(value) && value > 0) highs.push({ value: value, date: '', event: 'HRToolkit all-time' });
    });
    return highs;
  }
  function scrapeConfoStats() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    function tryCapture() {
      var highs = readConfoHighs();
      if (!highs.length) return false;
      // Highest score wins; on a tie prefer the entry that knows its date.
      var top = highs.reduce(function (a, b) {
        return b.value > a.value || (b.value === a.value && b.date && !a.date) ? b : a;
      });
      var best = top.value;
      HRStorage.getState(function (state) {
        if (!state.horseMeta) state.horseMeta = {};
        var meta = Object.assign({}, state.horseMeta[id]);
        var prev = Number(meta.confBest) || 0;
        var raised = best > prev;
        // A same-score re-read can still fill in a date/details that were missing.
        var fillsDetails = best === prev && ((top.date && !meta.confBestDate) || (top.event && !meta.confBestEvent));
        if (!raised && !fillsDetails) return;
        meta.confBest = best;
        if (raised) meta.confBestAt = Date.now();
        if (top.date || raised) meta.confBestDate = top.date || '';
        if (top.event || raised) meta.confBestEvent = top.event || '';
        state.horseMeta[id] = meta;
        HRLib.refreshBreedTotals(state);
        var name = (state.horseInfo[id] && state.horseInfo[id].name) || 'this horse';
        HRStorage.setState(state, function () {
          if (raised) showToast('HR Ledger: best conformation score ' + best + ' saved for ' + name);
        });
      });
      return true;
    }
    if (tryCapture()) return;
    var observer = new MutationObserver(function () {
      if (tryCapture()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  // Per-trait conformation ratings from the horse page's genetics table
  // (.genetic_table_row: a trait name element, then its rating element —
  // Good / Average / Below average). Saved as horseInfo[id].confTraits.
  var CONF_TRAIT_NAMES = ['Walk', 'Trot', 'Canter', 'Gallop', 'Posture', 'Head', 'Neck', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters', 'Socks'];
  function readConfTraits() {
    var out = {};
    document.querySelectorAll('.genetic_table_row').forEach(function (row) {
      row.querySelectorAll('.genetic_potential').forEach(function (label) {
        var name = (label.textContent || '').replace(/\s+/g, ' ').trim();
        if (CONF_TRAIT_NAMES.indexOf(name) === -1) return;
        var value = label.nextElementSibling;
        if (!value || !value.classList.contains('genetic_stats')) return;
        var rating = (value.textContent || '').replace(/\s+/g, ' ').trim();
        if (rating) out[name] = rating;
      });
    });
    return Object.keys(out).length >= 8 ? out : null;
  }
  function scrapeConformationTraits() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    function tryCapture() {
      var traits = readConfTraits();
      if (!traits) return false;
      HRStorage.getState(function (state) {
        var info = state.horseInfo[id];
        if (!info) { info = { lifeNumber: id }; state.horseInfo[id] = info; }
        if (JSON.stringify(info.confTraits || null) === JSON.stringify(traits)) return;
        info.confTraits = traits;
        HRStorage.setState(state);
      });
      return true;
    }
    if (tryCapture()) return;
    var observer = new MutationObserver(function () {
      if (tryCapture()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  function healOwnedStubs() {
    HRStorage.getState(function (state) {
      var btChanged = HRLib.refreshBreedTotals(state);
      var fixed = HRLib.adoptOwnedStallions(state);
      if (btChanged && !fixed) HRStorage.setState(state);
      if (fixed) {
        HRStorage.setState(state, function () {
          showToast('HR Ledger: ' + fixed + ' stallion' + (fixed === 1 ? '' : 's') + ' of yours added to the Stallions tab');
        });
      }
    });
  }

  // The Breed page (/breed/<stallion life number>/) has a mare dropdown and a
  // "Breed" button. Clicking Breed reloads the site onto the stallion's page,
  // so the click is saved straight to extension storage (not the page) and
  // recorded a moment later, or on the next page load. If Horse Reality shows
  // an error pop-up instead, the covering is dropped.
  var PENDING_KEY = 'hrPendingCoverings';
  function readPendingCoverings(cb) {
    chrome.storage.local.get(PENDING_KEY, function (res) { cb(Array.isArray(res[PENDING_KEY]) ? res[PENDING_KEY] : []); });
  }
  function writePendingCoverings(list, cb) {
    var o = {}; o[PENDING_KEY] = list;
    chrome.storage.local.set(o, cb || function () {});
  }
  function setupBreedCapture() {
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('button.breedmare') : null;
      if (!btn) return;
      var select = document.getElementById('secondhorse');
      var mareLife = select ? select.value : '';
      if (!mareLife) return;
      var opt = select.options[select.selectedIndex];
      var urlPart = location.pathname.split('/').filter(Boolean);
      var stallionLife = btn.getAttribute('lang') || (urlPart[0] === 'breed' ? urlPart[1] : '');
      if (!stallionLife) return;
      var stallionTop = document.querySelector('#first_horseinfo .top');
      var covering = {
        mareLife: mareLife,
        mareName: parseHorseNameHeader(opt ? opt.textContent : ''),
        stallionLife: stallionLife,
        stallionName: parseHorseNameHeader(stallionTop ? stallionTop.textContent : ''),
        at: Date.now()
      };
      // Written immediately and without waiting: the page is about to unload.
      readPendingCoverings(function (list) {
        list = list.filter(function (p) { return p.mareLife !== covering.mareLife; });
        list.push(covering);
        writePendingCoverings(list);
      });
      var observer = new MutationObserver(function () {
        if (!document.querySelector('.notifyjs-bootstrap-error, .notifyjs-corner [class*="error"]')) return;
        observer.disconnect();
        readPendingCoverings(function (list) {
          writePendingCoverings(list.filter(function (p) { return p.mareLife !== covering.mareLife; }));
        });
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(function () { observer.disconnect(); }, 8000);
      setTimeout(confirmPendingCoverings, 4000);
    }, true);
  }
  function confirmPendingCoverings() {
    readPendingCoverings(function (list) {
      var fresh = list.filter(function (p) { return Date.now() - p.at < 120000; });
      if (list.length) writePendingCoverings([]);
      fresh.forEach(recordCovering);
    });
  }
  function recordCovering(c) {
    HRStorage.getState(function (state) {
      var sid = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: c.stallionLife, stallionName: c.stallionName });
      if (!sid) sid = HRStorage.upsertStallionByMatch(state, { name: c.stallionName, lifeNumber: c.stallionLife, owned: false }).id;
      HRStorage.upsertBreeding(state, sid, {
        mareName: c.mareName, mareLifeNumber: c.mareLife, mareUrl: horseProfileUrl(c.mareLife),
        breederName: state.settings.myUsername || '', breederUrl: '',
        price: null, currency: 'HRC', feeType: 'Public',
        date: toIsoDate(Date.now()), status: 'Pending'
      });
      HRStorage.setState(state, function () {
        showToast('HR Ledger: breeding recorded for ' + (c.mareName || ('#' + c.mareLife)));
      });
    });
  }
  setupBreedCapture();
  setTimeout(confirmPendingCoverings, 2500);

  // The horse page's "Health" box lists five health traits and, once tested,
  // fertility, as "<strong>Label:</strong> Rating" (Poor / Fair / Average /
  // Good / Excellent). Saved as horseInfo[id].health and horseInfo[id].fertility.
  function readHealth() {
    var health = {}, fertility = '', count = 0;
    document.querySelectorAll('.half_block').forEach(function (block) {
      var top = block.querySelector('.top');
      if (!top || (top.textContent || '').trim().toLowerCase() !== 'health') return;
      block.querySelectorAll('strong').forEach(function (st) {
        var label = (st.textContent || '').replace(':', '').trim();
        var next = st.nextSibling;
        var value = next && next.nodeType === 3 ? (next.textContent || '').trim() : '';
        if (!label || !value) return;
        if (/fertil/i.test(label)) { fertility = value; return; }
        health[label] = value;
        count++;
      });
    });
    return count >= 3 || fertility ? { health: count >= 3 ? health : null, fertility: fertility } : null;
  }
  function scrapeHealth() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    function tryCapture() {
      var found = readHealth();
      if (!found) return false;
      HRStorage.getState(function (state) {
        var info = state.horseInfo[id];
        if (!info) { info = { lifeNumber: id }; state.horseInfo[id] = info; }
        var same = JSON.stringify(info.health || null) === JSON.stringify(found.health || info.health || null) &&
          (info.fertility || '') === (found.fertility || info.fertility || '');
        if (same) return;
        if (found.health) info.health = found.health;
        if (found.fertility) info.fertility = found.fertility;
        HRStorage.setState(state);
      });
      return true;
    }
    if (tryCapture()) return;
    var observer = new MutationObserver(function () {
      if (tryCapture()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  function onPageReady() {
    healOwnedStubs();
    scrapeHealth();
    scrapeConfoStats();
    scrapeConformationTraits();
    watchForContent();
    fetchAndMergeHorseInfo();
    scrapeAndMergeAgeText();
    sweepAndPersistStaleFailures();
  }

  onPageReady();

  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onPageReady();
    }
  }, 1000);
})();
