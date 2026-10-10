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
    text = text.replace(/^\s*!/, '').replace(/\s*\|\s*$/, '');
    return text.replace(/\s+/g, ' ').trim();
  }
  function parseScore(strongEl) {
    var text = cleanText(strongEl);
    if (!text) return { score: null, raw: '' };
    var parts = text.split('|');
    var last = parseFloat(parts[parts.length - 1]);
    // a foal's score is out of 100; a larger number means the wrong figure was read
    return { score: isNaN(last) || last > 100 ? null : last, raw: text };
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
        date: parseRowDate(cleanText(cells[3]))
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
  // Breeding a mare to someone else's stallion shows as an OUTgoing bank row:
  // "You paid 35 000 HRC + 1 000 HRC for transport to Ambre to breed !Its A Sign with the stud 73.4 | JS Antares."
  function toInt(text) { var n = parseInt(String(text || '').replace(/[^0-9]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function scrapeStudFeesPaid() {
    var out = [];
    document.querySelectorAll('tr.bank-table').forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 4 || cleanText(cells[0]) !== 'OUT') return;
      var text = cleanText(cells[2]);
      var m = /You paid ([0-9\s\u00a0]+?)\s*([A-Z]{2,4})(?: \+ ([0-9\s\u00a0]+?)\s*[A-Z]{2,4} for transport)? to (.+?) to breed (.+?) with the stud (.+?)\.?$/.exec(text);
      if (!m) return;
      var horseLinks = [];
      cells[2].querySelectorAll('a').forEach(function (a) { if (lifeNumberFromUrl(a.href || '')) horseLinks.push(a); });
      var stallionA = horseLinks.length ? horseLinks[horseLinks.length - 1] : null;
      var mareA = horseLinks.length > 1 ? horseLinks[0] : null;
      out.push({
        fee: toInt(m[1]), currency: (HRLib.CURRENCIES || []).indexOf(m[2]) > -1 ? m[2] : 'HRC', transport: m[3] ? toInt(m[3]) : 0,
        studOwner: m[4].trim(), mareName: m[5].trim(), mareLife: mareA ? lifeNumberFromUrl(mareA.href) : '',
        stallionName: m[6].trim(), stallionLife: stallionA ? lifeNumberFromUrl(stallionA.href) : '', date: parseRowDate(cleanText(cells[3]))
      });
    });
    return out;
  }
  // Sales appear as INcoming bank rows naming one of your horses (not a stud fee).
  // The amount column is what you were paid. The wording isn't relied on beyond
  // "sold"/"bought" plus a link to a horse; the first /user/ link is taken as the buyer.
  function scrapeSales() {
    var out = [];
    document.querySelectorAll('tr.bank-table').forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 4 || cleanText(cells[0]) !== 'IN') return;
      var text = cleanText(cells[2]);
      if (text.indexOf('used your stud service to breed') > -1) return;
      if (!/sold|bought/i.test(text)) return;
      var horseA = null, buyerA = null;
      cells[2].querySelectorAll('a').forEach(function (a) {
        var href = a.href || '';
        if (!horseA && lifeNumberFromUrl(href)) horseA = a;
        else if (!buyerA && href.indexOf('/user/') > -1) buyerA = a;
      });
      if (!horseA) return;
      var price = parseInt(cleanText(cells[1]).replace(/[^0-9]/g, ''), 10);
      if (!price) return;
      var when = cleanText(cells[3]);
      out.push({
        lifeNumber: lifeNumberFromUrl(horseA.href), name: parseHorseLabel(horseA), price: price,
        currency: currencyFromCell(cells[1]), date: parseRowDate(when), buyer: buyerA ? cleanText(buyerA) : ''
      });
    });
    return out;
  }
  // Rows that look like a purchase but could not be read (the wording is reported once, so it can be fixed)
  var unreadPurchases = [];
  function scrapePurchases() {
    var out = [];
    unreadPurchases = [];
    document.querySelectorAll('tr.bank-table').forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 4 || cleanText(cells[0]) !== 'OUT') return;
      var text = cleanText(cells[2]);
      // "You have bought ..." or, for a horse you made an offer on, "You placed an offer of 300 000 HRC on <horse> with foal <foal>
      // and paid an additional 500 HRC for transport"
      var isOffer = /\bplaced an offer of\b/i.test(text);
      if (!isOffer && !/\b(bought|purchased)\b/i.test(text)) return;
      // the horse is the first link that points at a horse (the seller's link may come before it)
      var horseA = null;
      cells[2].querySelectorAll('a').forEach(function (a) { if (!horseA && lifeNumberFromUrl(a.href || '')) horseA = a; });
      var life = horseA ? lifeNumberFromUrl(horseA.href) : '';
      if (!life) { unreadPurchases.push(text); return; }
      var fallback = currencyFromCell(cells[1]);
      // take the horse's own name out first, so a name with "for" in it cannot be taken for the price
      var clean = text.split(cleanText(horseA)).join(' ');
      var money = '([0-9\\s\\u00a0.,]+?)\\s*([A-Za-z]{2,4})\\b';
      var price = (isOffer ? new RegExp('\\boffer of\\s+' + money, 'i') : new RegExp('\\bfor\\s+' + money, 'i')).exec(clean);
      var ship = new RegExp('(?:additional|extra|plus|and|\\+)\\s+' + money + '\\s*(?:for\\s+)?(?:the\\s+)?(?:transport|shipping|delivery)', 'i').exec(clean)
        || new RegExp('(?:transport|shipping|delivery)(?:\\s+fee)?(?:\\s+of)?\\s+' + money, 'i').exec(clean);
      var sh = ship ? parseAmountAndCurrency(ship, fallback) : { amount: 0, currency: fallback };
      var p = price ? parseAmountAndCurrency(price, fallback) : { amount: 0, currency: fallback };
      // the wording was not recognised: the amount column is what was paid in all
      if (!p.amount) {
        var total = toInt(cleanText(cells[1]));
        if (total) p = { amount: Math.max(0, total - sh.amount), currency: fallback };
      }
      if (!p.amount && !sh.amount) { unreadPurchases.push(text); return; }
      out.push({ lifeNumber: life, name: parseHorseLabel(horseA), price: p.amount, currency: p.currency, shipping: sh.amount, shippingCurrency: sh.currency, offer: isOffer });
    });
    if (unreadPurchases.length) console.warn('HR Ledger: bank rows that look like purchases but could not be read:', unreadPurchases);
    return out;
  }

  // --- Source 3: Horse Reality's own horse-detail JSON API ---
  // Names look like "!ↆMonte Cristo|f?" in both the API and the rendered
  // page — the display name is always the first "|"-separated segment once
  // the leading icon-font markers are stripped.
  function parseHorseNameHeader(text) {
    text = String(text || '').replace(/^!/, '');
    text = text.replace(/ↆ/g, '');
    text = text.replace(/\s*\|\s*$/, '');
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
  // The API's birthdate may carry the exact time of birth. Kept as milliseconds when it does, so a horse's age can
  // follow Horse Reality's own 32-hour months exactly.
  function parseBirthAt(iso) {
    if (!iso || !/\d{1,2}:\d{2}/.test(String(iso))) return null;
    var t = new Date(iso).getTime();
    return isNaN(t) ? null : t;
  }
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
      birthAt: parseBirthAt(passport.birthdate),
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
    var sales = scrapeSales();
    var studFees = scrapeStudFeesPaid();
    if (!offspring.length && !bank.length && !failedCoverings.length && !purchases.length && !sales.length && !studFees.length) return;

    HRStorage.getState(function (state) {
      var added = 0, updated = 0, newStuds = 0, failuresMarked = 0, purchasesSaved = 0, salesSaved = 0, feesPaid = 0;
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
            // a foal already recorded another way: line its address up so this row merges instead of doubling
            var rowLife = lifeNumberFromUrl(row.foalUrl);
            (state.breedings[matchId] || []).forEach(function (b) {
              if (rowLife && b.foalUrl && b.foalUrl !== row.foalUrl && HRLib.foalLifeOf(b.foalUrl) === rowLife) b.foalUrl = row.foalUrl;
            });
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
        if (pu.offer) {
          // an offer may have been outbid: keep it aside until the horse is seen to be yours
          var oi = state.horseInfo && state.horseInfo[pu.lifeNumber], oMe = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
          var mine = oi && oMe && String(oi.ownerName || '').trim().toLowerCase() === oMe;
          if (!mine) {
            var pend = { price: pu.price, currency: pu.currency, shipping: pu.shipping, shippingCurrency: pu.shippingCurrency };
            if (JSON.stringify(meta.purchaseOffer) !== JSON.stringify(pend)) { meta.purchaseOffer = pend; purchasesSaved++; }
            return;
          }
        }
        var rec = meta.purchase = Object.assign({}, meta.purchase);
        var changed = false;
        if (pu.price && !rec.price) { rec.price = pu.price; rec.currency = pu.currency; rec.recordedAt = Date.now(); changed = true; }
        if (pu.shipping && !rec.shipping) { rec.shipping = pu.shipping; rec.shippingCurrency = pu.shippingCurrency; changed = true; }
        if (changed) purchasesSaved++;
      });

      // A horse you sold: record the price and date and mark it Sold. A sale already
      // recorded is never overwritten (so restoring a horse to Active sticks).
      sales.forEach(function (sa) {
        var meta = state.horseMeta[sa.lifeNumber] = Object.assign({}, state.horseMeta[sa.lifeNumber]);
        if (meta.sale && meta.sale.price) return;
        meta.sale = { price: sa.price, currency: sa.currency, date: sa.date, buyer: sa.buyer, recordedAt: Date.now() };
        meta.status = 'Sold';
        var rec = state.stallions.find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(sa.lifeNumber); });
        if (rec) rec.status = 'Sold';
        salesSaved++;
      });

      // Stud fees you paid to breed to someone else's stallion (and the transport)
      studFees.forEach(function (sf) { if (HRLib.applyStudFee(state, sf)) feesPaid++; });

      if (added || updated || newStuds || failuresMarked || purchasesSaved || salesSaved || feesPaid) {
        HRStorage.setState(state, function () {
          var parts = [];
          if (added) parts.push(added + ' new');
          if (updated) parts.push(updated + ' updated');
          if (newStuds) parts.push(newStuds + ' new stud' + (newStuds === 1 ? '' : 's'));
          if (failuresMarked) parts.push(failuresMarked + ' marked failed');
          if (purchasesSaved) parts.push(purchasesSaved + ' purchase' + (purchasesSaved === 1 ? '' : 's') + ' recorded');
          if (salesSaved) parts.push(salesSaved + ' sale' + (salesSaved === 1 ? '' : 's') + ' recorded');
          if (feesPaid) parts.push(feesPaid + ' stud fee' + (feesPaid === 1 ? '' : 's') + ' paid recorded');
          if (unreadPurchases.length) parts.push(unreadPurchases.length + ' purchase row' + (unreadPurchases.length === 1 ? '' : 's') + ' could not be read (see the console)');
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
        if (info && info.dateOfBirth) { rec.dateBorn = info.dateOfBirth; if (info.birthAt) rec.bornAt = info.birthAt; todo.changed = true; return; }
        if (todo.length < FOAL_LOOKUP_CAP) todo.push({ life: life, key: HRLib.breedingMatchKey(rec) });
      });
      if (todo.changed) HRStorage.setState(state);
      if (!todo.length) return;
      Promise.all(todo.map(function (t) {
        return fetchHorseJson('/api/player/horse/' + t.life + '/passport').then(function (resp) {
          var root = resp && resp.horsePassport ? resp.horsePassport : {};
          return { life: t.life, key: t.key, birth: root.passport && root.passport.birthdate, bornAt: parseBirthAt(root.passport && root.passport.birthdate) };
        }).catch(function () { return null; });
      })).then(function (results) {
        var found = results.filter(function (r) { return r && r.birth; });
        if (!found.length) return;
        HRStorage.getState(function (fresh) {
          var rows = fresh.breedings[stallionId] || [];
          found.forEach(function (r) {
            var rec = rows.find(function (b) { return HRLib.breedingMatchKey(b) === r.key; });
            var d = new Date(r.birth);
            if (rec && !isNaN(d.getTime())) { rec.dateBorn = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); if (r.bornAt) rec.bornAt = r.bornAt; }
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
      // a horse you removed from the ledger is not saved again (until you allow it under Removed horses)
      if (state.settings && state.settings.ignored && state.settings.ignored[horseInfo.lifeNumber]) return;
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
      // an offer made on this horse that was kept aside is her purchase once she is yours
      (function () {
        var pm = state.horseMeta && state.horseMeta[horseInfo.lifeNumber], pOwn = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
        if (pm && pm.purchaseOffer && pOwn && String(horseInfo.ownerName || '').trim().toLowerCase() === pOwn) {
          var po = pm.purchaseOffer, cur = Object.assign({}, pm.purchase);
          if (po.price && !cur.price) { cur.price = po.price; cur.currency = po.currency; cur.recordedAt = Date.now(); }
          if (po.shipping && !cur.shipping) { cur.shipping = po.shipping; cur.shippingCurrency = po.shippingCurrency; }
          state.horseMeta[horseInfo.lifeNumber] = Object.assign({}, pm, { purchase: cur });
          delete state.horseMeta[horseInfo.lifeNumber].purchaseOffer;
          passportCached = true;
        }
      })();
      // a horse that has been renamed (a name you gave her, or the seller's tagline replaced): breeding records that
      // were saved under the old name take the new one
      if (horseInfo.name) {
        Object.keys(state.breedings || {}).forEach(function (sid) {
          (state.breedings[sid] || []).forEach(function (b) {
            if (String(b.mareLifeNumber) === String(horseInfo.lifeNumber) && b.mareName !== horseInfo.name) { b.mareName = horseInfo.name; passportCached = true; }
          });
        });
      }
      // a horse you had listed that now belongs to someone else has been sold
      if (HRLib.recordSoldByOwner(state, horseInfo.lifeNumber)) passportCached = true;

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

      // This horse is a foal of one of your mares: make sure her breeding history lists it.
      var foalRecorded = HRLib.recordFoalFromHorse(state, horseInfo);

      if (infoRefreshed || passportCached || newStud || pregnancyMarked || foalRecorded) {
        HRStorage.setState(state, function () {
          if (newStud) {
            showToast('HR Ledger: added ' + horseInfo.name + ' as a new stud');
            // Offspring rows on this same page may have been scraped before
            // the stud existed to attach to — retry now that it does.
            mergeIntoLedger();
          } else if (foalRecorded) {
            showToast('HR Ledger: recorded ' + (horseInfo.name || 'foal') + ' as a foal of ' + ((horseInfo.dam && horseInfo.dam.name) || 'your mare'));
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
    HRStorage.peekState(function (pst) {
      var plist = pst.breedings[stallionId] || [];
      offspring.forEach(function (row) {
        var k = HRLib.breedingMatchKey(row), rec = plist.find(function (b) { return HRLib.breedingMatchKey(b) === k; });
        if (rec && rec.foalImageStored) row.__stored = true;
      });
      runOffspringImages(stallionId, offspring);
    });
  }
  function runOffspringImages(stallionId, offspring) {
    var jobs = [];
    offspring.forEach(function (row) {
      if (!row.foalImageUrl) return;
      // a picture already saved apart from the ledger is not fetched again
      if (row.__stored) return;
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
    HRStorage.peekState(function (pst) {
      var cur = pst.horseInfo[horseInfo.lifeNumber];
      // the picture is already saved (apart from the ledger): do not fetch it again on every visit
      if (cur && cur.imageStored) return;
      fetchHorseImageNow(stallionId, horseInfo);
    });
  }
  function fetchHorseImageNow(stallionId, horseInfo) {
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

    var observer = new MutationObserver(observerDebounce(function () {
      if (tryMergeOnce()) observer.disconnect();
    }));
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
    // between day 5 and day 17 a Pending covering may be a real pregnancy not seen yet: only call it failed when her page
    // (saved on day 5 or later) shows she is not in foal, or the longest pregnancy has passed
    var candidates = HRLib.findReviewCandidates(state, STALE_PENDING_DAYS).filter(function (c) { return HRLib.coveringLooksFailed(state, c.breeding); });
    candidates.forEach(function (c) { c.breeding.status = 'Failed'; });
    return candidates.length;
  }
  function sweepAndPersistStaleFailures() {
    HRStorage.getState(function (state) {
      var marked = sweepStaleFailedCoverings(state);
      if (marked) {
        HRStorage.setState(state, function () {
          showToast('HR Ledger: ' + marked + ' marked failed (her page shows no pregnancy, or no foal after 17 days)');
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
  // The age shown on a horse's own page (<p id="age">6 years 3 months</p>) is its real age: owners can age horses up with
  // Delta Points, so it can be well above what the birth date says. The page draws inside shadow roots (web components),
  // so the search goes through them, and it is repeated by the one-second tick until the age has appeared.
  var ageDone = {};
  function findAgeText() {
    var el = deepQuery('#age') || deepQuery('.breed-and-age .age.desktop') || deepQuery('[data-age]');
    var text = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
    if (text) return text;
    // a table row labelled "Age" (the horse information box)
    var rows = deepQueryAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll('th, td');
      if (cells.length >= 2 && /^age:?$/i.test((cells[0].textContent || '').trim())) { var t = (cells[1].textContent || '').replace(/\s+/g, ' ').trim(); if (t) return t; }
    }
    return '';
  }
  function scrapeAgeFromProfile() {
    var id = parseHorseIdFromUrl();
    if (!id || ageDone[id]) return;
    var text = findAgeText();
    if (!text) return;
    var months = HRLib.parseAgeText(text);
    if (months == null) return;
    ageDone[id] = text;
    HRStorage.getState(function (state) {
      if (!state.horseInfo) state.horseInfo = {};
      var info = state.horseInfo[id];
      if (!info) { info = { lifeNumber: id }; state.horseInfo[id] = info; }
      if (info.ageMonths === months && info.ageText === text) return;
      info.ageMonths = months;
      info.ageText = text;
      info.ageAt = Date.now();
      info.capturedAt = Date.now();
      HRStorage.setState(state);
    });
  }
  function scrapeAndMergeAgeText() {
    var id = parseHorseIdFromUrl();
    if (id) delete ageDone[id]; // a fresh visit reads it again
    scrapeAgeFromProfile();
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
    var highs = [], lows = [];
    highs.lows = lows;
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
        lows.push({ value: value, date: date, event: details.join(' · ').slice(0, 90) });
      });
    });
    document.querySelectorAll('tr').forEach(function (tr) {
      var cells = tr.querySelectorAll('th, td');
      if (cells.length < 2) return;
      var label = (cells[0].textContent || '').replace(/\s+/g, ' ').trim();
      var isLow = /^all-time low( confo)?$/i.test(label);
      if (!/^(all-time|current) confo$/i.test(label) && !isLow) return;
      var value = number(cells[1].textContent);
      if (!(isFinite(value) && value > 0)) return;
      if (isLow) lows.push({ value: value, date: '', event: 'HRToolkit all-time low' }); else highs.push({ value: value, date: '', event: 'HRToolkit all-time' });
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
        // the lowest of the scores listed (and HRToolkit's all-time low) counts as the low when it is within the range guard
        var lowMoved = false;
        (highs.lows || []).forEach(function (lv) { if (HRLib.recordLowScore(meta, lv.value, Math.max(best, prev), 'show results', false, state.horseInfo[id], { date: lv.date, event: lv.event })) lowMoved = true; });
        // A same-score re-read can still fill in a date/details that were missing.
        var fillsDetails = best === prev && ((top.date && !meta.confBestDate) || (top.event && !meta.confBestEvent));
        if (!raised && !fillsDetails) { if (lowMoved) { state.horseMeta[id] = meta; HRStorage.setState(state); } return; }
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
    var observer = new MutationObserver(observerDebounce(function () {
      if (tryCapture()) observer.disconnect();
    }));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  // ---- market board: colour the rows of horses you have already looked at ----
  // On the Explore pages of the market, a row whose horse is saved in the ledger gets a green background if it would
  // lift your herd (compared with your own horses of the same breed) and a red one if it would not. The horse is found
  // from a market listing you opened (the listing's number is remembered with the horse), from a life number written in
  // its name, or from an exact name + breed + sex that only one saved horse has.
  var marketTimers = [], marketDebounce = null;
  function rememberTrade(tradeId, life) {
    if (!tradeId || !life) return;
    HRStorage.getState(function (state) {
      var tr = Object.assign({}, state.marketTrades);
      if (tr[tradeId] === life) return;
      tr[tradeId] = life;
      var keys = Object.keys(tr);
      if (keys.length > 600) keys.slice(0, keys.length - 600).forEach(function (k) { delete tr[k]; });
      state.marketTrades = tr;
      HRStorage.setState(state);
    });
  }
  function scrapeTradePage() {
    var m = /\/market\/trade\/(\d+)/.exec(location.pathname);
    if (!m) return;
    var a = document.querySelector('a[href*="/horses/"]');
    var lm = a && /\/horses\/(\d+)/.exec(a.getAttribute('href') || '');
    if (lm) rememberTrade(m[1], lm[1]);
  }
  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function highlightMarket(force) {
    if (!force && !/\/market\//.test(location.pathname)) return;
    var outers = document.querySelectorAll('.market-office-table-row-outer');
    if (!outers.length) return;
    HRStorage.peekState(function (state) {
      var off = state.settings && state.settings.marketHighlight === false;
      var trades = state.marketTrades || {}, me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      var index = null;
      function findByName(name, breed, sex) {
        if (!index) {
          index = {};
          Object.keys(state.horseInfo || {}).forEach(function (l) {
            var n = normName(state.horseInfo[l].name);
            if (n.length >= 3) (index[n] = index[n] || []).push(l);
          });
        }
        // market names often carry extras ("Name/68.4", "Name | 1E-5G", "Name - GP 556"): try the whole name, then the part before them
        var tries = [name, name.split(/s*[/|]s*/)[0], name.split(/s+-s+/)[0]];
        for (var t = 0; t < tries.length; t++) {
          var hits = (index[normName(tries[t])] || []).filter(function (l) {
            var i = state.horseInfo[l];
            return (!breed || HRLib.breedKeyOf(i.breed) === HRLib.breedKeyOf(breed)) && (!sex || !i.sex || i.sex === sex);
          });
          if (hits.length === 1) return hits[0];
        }
        return '';
      }
      outers.forEach(function (outer) {
        var row = outer.querySelector('.market-office-table-row') || outer;
        row.style.background = '';
        row.style.boxShadow = '';
        row.removeAttribute('data-hr-fit');
        row.removeAttribute('title');
        outer.querySelectorAll('[data-hr-info]').forEach(function (e) { e.remove(); });
        // a row of the Studs & Semen market: the life number is in the link
        var studLink = outer.querySelector('a[href*="/market/studs-and-semen/"]');
        if (studLink) { if (!off) studRow(state, outer, row, studLink, me); return; }
        var link = outer.querySelector('.market-office-table-row-horse-info a[href*="/market/trade/"]') || outer.querySelector('a[href*="/market/trade/"]');
        if (!link) return;
        var tm = /\/market\/trade\/(\d+)/.exec(link.getAttribute('href') || '');
        bidMark(outer, tm && state.marketBids && state.marketBids[tm[1]]);
        if (tm) noteHighest(state, tm[1], outer);
        if (off) return;
        var name = (link.textContent || '').replace(/\s+/g, ' ').trim();
        var life = (tm && trades[tm[1]]) || '';
        if (!life) { var nm = /(?:^|\D)(\d{8})(?:\D|$)/.exec(name); if (nm && state.horseInfo && state.horseInfo[nm[1]]) life = nm[1]; }
        if (!life) {
          var p = outer.querySelector('.market-office-table-row-horse-info p');
          var breed = p ? (p.firstChild && p.firstChild.textContent || '').replace(/\s+/g, ' ').trim() : '';
          var sexImg = outer.querySelector('img.sex');
          var sex = sexImg ? (sexImg.getAttribute('alt') || '').toLowerCase() : '';
          life = findByName(name, breed, sex);
        }
        if (life && state.marketBids && state.marketBids['life:' + life] && !(tm && state.marketBids[tm[1]])) bidMark(outer, state.marketBids['life:' + life]);
        var info = life && state.horseInfo && state.horseInfo[life];
        if (!info) return;
        if (me && String(info.ownerName || '').trim().toLowerCase() === me) return;
        var b = HRLib.herdBenefit(state, life);
        var ri = HRLib.marketRowInfo(state, life, { asking: rowMoney(outer, '.market-office-table-row-autobuy'), highest: rowMoney(outer, '.market-office-table-row-highestbid') });
        if (ri) infoBadge(outer, ri, b);
        if (b.verdict === 'unknown') { if (ri) row.title = ri.hover; return; }
        var good = b.verdict === 'helps' || b.verdict === 'maybe';
        var counts = HRLib.fitSummary(state, life).counts;
        var judged = counts.total > 0;
        var frac = judged ? counts.matched / counts.total : 1;
        var allMet = judged && counts.matched === counts.total;
        var state2 = good && allMet ? 'gold' : good ? 'lifts' : 'no';
        paintRow(row, state2, frac, false);
        var head = state2 === 'gold' ? 'would lift your herd and fits all ' + counts.total + ' of your criteria' :
          good ? 'would lift your herd; fits ' + counts.matched + ' of ' + counts.total + ' criteria' + (counts.missing.length ? ' (missing ' + counts.missing.slice(0, 3).join(', ') + ')' : '') : 'would not lift your herd';
        row.title = (ri ? ri.hover + '\n\n' : '') + 'Overall: ' + head;
      });
    });
  }
  // ---- retiring a horse from your barn ----
  // The Retire button (on a horse's Edit tab in your barn, or anywhere on the site) is noticed when you press it. If a
  // confirmation box opens, the ledger waits for you to confirm it; if the button just submits, it is taken as done. The
  // horse is then marked Retired (replacing For Sale) and moves to the Retired tab. Which horse it was comes from the page
  // address, a link to the horse on the page, or a life number written in its header.
  var RETIRE_KEY = 'hrRetirePending';
  function lifeFromContext(el) {
    var life = parseHorseIdFromUrl();
    if (life) return life;
    var um = /\/horses?\/(\d{6,})/.exec(location.href);
    if (um) return um[1];
    var scope = (el && el.closest && (el.closest('form') || el.closest('.modal,[role=dialog],.component,.frame,main'))) || document;
    var a = scope.querySelector('a[href*="/horses/"]') || document.querySelector('a[href*="/horses/"]');
    var lm = a && /\/horses\/(\d{6,})/.exec(a.getAttribute('href') || '');
    if (lm) return lm[1];
    var nm = /(?:#|life number[:\s]*)(\d{8})/i.exec(String((document.body && document.body.innerText) || '').slice(0, 5000));
    return nm ? nm[1] : '';
  }
  function commitRetire(life) {
    try { sessionStorage.removeItem(RETIRE_KEY); } catch (e) { /* no storage */ }
    if (!life) return;
    HRStorage.getState(function (state) {
      var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      var info = state.horseInfo && state.horseInfo[life];
      if (info && me && info.ownerName && String(info.ownerName).trim().toLowerCase() !== me) return;
      if (HRLib.recordRetired(state, life)) {
        HRStorage.setState(state, function () { showToast('HR Ledger: ' + ((info && info.name) || ('#' + life)) + ' marked Retired'); });
      }
    });
  }
  // a visible confirmation box (a hidden one does not count)
  function dialogOpen() {
    return [].slice.call(document.querySelectorAll('.modal.show, .modal.in, .modal[style*="display: block"], [role=dialog]:not([aria-hidden="true"])')).some(function (el) { return el.getClientRects().length > 0 && el.offsetWidth > 0; });
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button,a,input[type=submit],.btn,[role=button]') : null;
    if (!b) return;
    var label = String(b.textContent || b.value || '').replace(/\s+/g, ' ').trim();
    if (!/\bretire\b/i.test(label) || label.length > 45 || /breeding|unretire|un-retire|retired horses|cancel/i.test(label)) {
      // a confirmation button in an open box, after a Retire press
      var p0 = null;
      try { p0 = JSON.parse(sessionStorage.getItem(RETIRE_KEY) || 'null'); } catch (err) { /* ignore */ }
      if (p0 && Date.now() - p0.at < 180000 && b.closest('.modal,[role=dialog]') && /^(yes|confirm|ok|continue|proceed|retire)\b/i.test(label) && !/cancel|no\b/i.test(label)) commitRetire(p0.life);
      return;
    }
    var life = lifeFromContext(b);
    if (!life) { showToast('HR Ledger: could not tell which horse you retired. Open its page to update it.'); return; }
    var isSubmit = (b.type === 'submit') || (b.closest && b.closest('form') && !dialogOpen());
    try { sessionStorage.setItem(RETIRE_KEY, JSON.stringify({ life: life, at: Date.now(), confirmed: !!isSubmit })); } catch (err) { /* no storage */ }
    if (isSubmit) { commitRetire(life); return; }
    // not a form button: if no confirmation box appears shortly, the press itself did it
    setTimeout(function () { if (!dialogOpen()) commitRetire(life); }, 1500);
  }, true);
  function checkPendingRetire() {
    var p = null;
    try { p = JSON.parse(sessionStorage.getItem(RETIRE_KEY) || 'null'); } catch (e) { /* ignore */ }
    if (p && p.confirmed && Date.now() - p.at < 180000) commitRetire(p.life);
    else if (p && Date.now() - p.at >= 180000) { try { sessionStorage.removeItem(RETIRE_KEY); } catch (e) { /* ignore */ } }
  }

  // ---- your sales: asking prices of horses you list ----
  // On your My Sales page (rows like the Explore rows) each listing's buyout price is saved with the horse, the horse is
  // marked For Sale, and a price change adds a line to its asking-price history. On the New sale form, pressing the
  // button that creates the listing saves the horse and the prices typed in the form.
  function lifeForRow(state, outer, idx) {
    var link = outer.querySelector('.market-office-table-row-horse-info a[href*="/market/trade/"]') || outer.querySelector('a[href*="/market/trade/"]');
    if (!link) return '';
    var tm = /\/market\/trade\/(\d+)/.exec(link.getAttribute('href') || '');
    var trades = state.marketTrades || {};
    var name = (link.textContent || '').replace(/\s+/g, ' ').trim();
    var life = (tm && trades[tm[1]]) || '';
    if (!life) { var nm = /(?:^|\D)(\d{8})(?:\D|$)/.exec(name); if (nm && state.horseInfo && state.horseInfo[nm[1]]) life = nm[1]; }
    if (!life) {
      var tries = [name, name.split(/\s*[\/|]\s*/)[0], name.split(/\s+-\s+/)[0]];
      for (var t = 0; t < tries.length && !life; t++) {
        var hits = (idx[normName(tries[t])] || []);
        if (hits.length === 1) life = hits[0];
      }
    }
    return life;
  }
  function scrapeMySales() {
    if (!(window.__HR_TEST__ && window.__HR_TEST_SALES__) && (!/\/market\/office\/my-sales/.test(location.pathname) || /\/(create|edit)/.test(location.pathname))) return;
    var outers = document.querySelectorAll('.market-office-table-row-outer');
    if (!outers.length) return;
    HRStorage.getState(function (state) {
      var idx = {};
      Object.keys(state.horseInfo || {}).forEach(function (l) { var i = state.horseInfo[l]; if (String(i.ownerName || '').trim().toLowerCase() === String((state.settings && state.settings.myUsername) || '').trim().toLowerCase()) { var n = normName(i.name); if (n.length >= 3) (idx[n] = idx[n] || []).push(l); } });
      var changed = 0, names = [];
      outers.forEach(function (outer) {
        var life = lifeForRow(state, outer, idx);
        if (!life) return;
        var ab = outer.querySelector('.market-office-table-row-autobuy');
        var buyout = ab && !/n\/a/i.test(ab.textContent || '') ? parseInt(String(ab.textContent || '').replace(/[^0-9]/g, ''), 10) || 0 : 0;
        if (HRLib.recordAsk(state, life, { buyout: buyout })) { changed++; names.push((state.horseInfo[life] && state.horseInfo[life].name) || ('#' + life)); }
      });
      if (!changed) return;
      HRStorage.setState(state, function () { showToast('HR Ledger: ' + changed + ' sale listing' + (changed === 1 ? '' : 's') + ' updated in the ledger'); });
    });
  }
  document.addEventListener('click', function (e) {
    if (!(window.__HR_TEST__ && window.__HR_TEST_SALES__) && !/\/market\/office\/my-sales\/horses\/create|\/market\/office\/my-sales\/.*\/edit/.test(location.pathname)) return;
    var b = e.target && e.target.closest ? e.target.closest('button,input[type=submit],.btn') : null;
    if (!b) return;
    var label = String(b.textContent || b.value || '').toLowerCase();
    if (/cancel|back|delete|remove/.test(label)) return;
    var scope = b.closest('form') || document, life = '', buyout = 0, bid = 0, any = 0;
    scope.querySelectorAll('input,select').forEach(function (el) {
      var nm = String(el.name || el.id || '').toLowerCase();
      if (/horse/.test(nm)) { var v = String(el.value || '').match(/\d{6,}/); if (v) life = v[0]; }
      var n = parseInt(String(el.value || '').replace(/[^0-9]/g, ''), 10) || 0;
      if (!n || el.type === 'hidden' || el.type === 'checkbox') return;
      if (/autobuy|buyout|buy_out|buy-out/.test(nm)) buyout = n;
      else if (/start|bid|minimum|min_price/.test(nm)) bid = n;
      else if (/price/.test(nm) && !buyout) buyout = n;
      if (n) any++;
    });
    if (!life) { var um = /horses?\/(\d{6,})|[?&]horse[_a-z]*=(\d{6,})/.exec(location.href); if (um) life = um[1] || um[2]; }
    if (!life || !(buyout || bid)) return;
    HRStorage.getState(function (state) {
      if (HRLib.recordAsk(state, life, { buyout: buyout, bid: bid })) HRStorage.setState(state, function () { showToast('HR Ledger: marked For Sale, asking ' + (buyout || bid).toLocaleString('en-US')); });
    });
  }, true);
  var salesTimers = [];
  function scheduleSales() {
    salesTimers.forEach(clearTimeout);
    salesTimers = [1500, 4000].map(function (ms) { return setTimeout(scrapeMySales, ms); });
  }

  // ---- your offers: a $ on listings you bid on, an X when you have been outbid ----
  // The ledger notes an offer when you press a Bid / Offer button on a listing page (with the amount in the box), and
  // reads the listing page's own wording ("outbid", "you are the highest bidder"). On the Explore pages a listing you
  // bid on shows a green $ while your offer is the highest and a red X once someone's highest bid is above yours.
  function tradeIdFromPath() {
    if (typeof window !== 'undefined' && window.__HR_TEST__ && window.__HR_TEST_TRADE__) return window.__HR_TEST_TRADE__;
    var m = /\/market\/trade\/(\d+)/.exec(location.pathname);
    return m ? m[1] : '';
  }
  function saveBid(tradeId, patch) {
    if (!tradeId) return;
    HRStorage.getState(function (state) {
      var mb = Object.assign({}, state.marketBids);
      mb[tradeId] = Object.assign({}, mb[tradeId], patch, { seenAt: Date.now() });
      var keys = Object.keys(mb);
      if (keys.length > 300) keys.sort(function (a, b) { return (mb[a].seenAt || 0) - (mb[b].seenAt || 0); }).slice(0, keys.length - 300).forEach(function (k) { delete mb[k]; });
      state.marketBids = mb;
      HRStorage.setState(state);
    });
  }
  function scanTradeStatus() {
    var id = tradeIdFromPath();
    if (!id) return;
    var low = String((document.body && document.body.innerText) || '').slice(0, 30000).toLowerCase();
    var status = '';
    if (/\boutbid\b|no longer the highest|someone (else )?(has )?(placed )?a higher/.test(low)) status = 'outbid';
    else if (/(you are|you're|you have) the highest (bid|offer|bidder)|your (bid|offer) is the highest|highest (bid|offer) is yours/.test(low)) status = 'leading';
    if (status) saveBid(id, { status: status });
  }
  document.addEventListener('click', function (e) {
    var id = tradeIdFromPath();
    if (!id) return;
    var b = e.target && e.target.closest ? e.target.closest('button,input[type=submit],a.button,.btn') : null;
    if (!b) return;
    var label = String(b.textContent || b.value || '').toLowerCase();
    if (!/\b(bid|offer)\b/.test(label) || /buyout|buy out|autobuy|buy now|cancel/.test(label)) return;
    var scope = b.closest('form') || document, amt = 0;
    scope.querySelectorAll('input').forEach(function (i) {
      if (i.type === 'hidden' || i.type === 'submit' || i.type === 'checkbox' || i.type === 'radio') return;
      var v = parseInt(String(i.value || '').replace(/[^0-9]/g, ''), 10);
      if (v > amt) amt = v;
    });
    saveBid(id, { amount: amt || null, status: 'placed', placedAt: Date.now() });
  }, true);
  var bidTimers = [];
  function scheduleBidScan() {
    bidTimers.forEach(clearTimeout);
    bidTimers = [1500, 4000, 9000].map(function (ms) { return setTimeout(function () { scanTradeStatus(); scrapeBidNotifications(); }, ms); });
  }
  // The site's notifications say when an auction you bid on is over: that you were outbid or lost it, or that you won it.
  // The listing (or the horse) the notification links to gets the outcome, which turns the mark on its Explore row into
  // a red X or a green $ and puts the price into the sale price numbers.
  function scrapeBidNotifications() {
    var rows = document.querySelectorAll('tr.notifications-table, .notifications-table tr, .notification');
    if (!rows.length && /notif/i.test(location.pathname)) rows = document.querySelectorAll('tr');
    if (!rows.length) return;
    var found = [];
    rows.forEach(function (row) {
      var text = String(row.textContent || '').replace(/\s+/g, ' ');
      var kind = /\bout-?bid\b|lost (the |your )?(auction|bid|offer)|did not win|was not the highest|higher (bid|offer)|auction (has )?(ended|closed).*(another|someone)/i.test(text) ? 'lost'
        : /\byou (have )?won\b|won the (auction|bid)|successfully (bought|purchased|won)|(bid|offer) (was )?(accepted|successful)/i.test(text) ? 'won' : '';
      if (!kind) return;
      var tl = row.querySelector('a[href*="/market/trade/"]'), hl = row.querySelector('a[href*="/horses/"]');
      var tid = tl && (/\/market\/trade\/(\d+)/.exec(tl.getAttribute('href') || '') || [])[1];
      var life = hl && (/\/horses\/(\d+)/.exec(hl.getAttribute('href') || '') || [])[1];
      if (!tid && !life) return;
      found.push({ kind: kind, tid: tid || '', life: life || '', name: ((tl || hl).textContent || '').replace(/\s+/g, ' ').trim(), date: parseRowDate(text) });
    });
    if (!found.length) return;
    HRStorage.getState(function (state) {
      var mb = Object.assign({}, state.marketBids), trades = state.marketTrades || {}, changed = [];
      found.forEach(function (f) {
        var key = f.tid;
        if (!key && f.life) { key = Object.keys(trades).find(function (t) { return trades[t] === f.life && mb[t]; }) || ('life:' + f.life); }
        var cur = mb[key] || {};
        if (cur.outcome === f.kind) return;
        mb[key] = Object.assign({}, cur, { outcome: f.kind, outcomeAt: f.date || today10Local(), status: f.kind === 'lost' ? 'outbid' : 'leading', seenAt: Date.now() }, f.life ? { life: f.life } : {}, f.kind === 'won' && !cur.amount && cur.highest ? { amount: cur.highest } : {});
        changed.push(f);
      });
      if (!changed.length) return;
      state.marketBids = mb;
      HRStorage.setState(state, function () {
        var lost = changed.filter(function (c) { return c.kind === 'lost'; }).length, won = changed.length - lost;
        showToast('HR Ledger: ' + (lost ? lost + ' lost bid' + (lost === 1 ? '' : 's') : '') + (lost && won ? ' and ' : '') + (won ? won + ' won' : '') + ' noted from your notifications');
      });
    });
  }
  function today10Local() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function bidMark(outer, bid) {
    var host = outer.querySelector('.market-office-table-row-horse-info') || outer;
    host.querySelectorAll('[data-hr-bid]').forEach(function (e) { e.remove(); });
    if (!bid) return;
    var hb = outer.querySelector('.market-office-table-row-highestbid');
    var highest = 0;
    if (hb && !/n\/a/i.test(hb.textContent || '')) highest = parseInt(String(hb.textContent || '').replace(/[^0-9]/g, ''), 10) || 0;
    var mine = Number(bid.amount) || 0;
    var won = bid.outcome === 'won';
    var out = bid.outcome === 'lost' || (!won && (bid.status === 'outbid' || (mine > 0 && highest > mine && bid.status !== 'leading')));
    var tag = document.createElement('span');
    tag.setAttribute('data-hr-bid', out ? 'outbid' : 'mine');
    tag.textContent = out ? 'X' : '$';
    tag.title = won ? 'HR Ledger: you won this listing' + (mine ? ' with ' + mine.toLocaleString('en-US') : '') : out ? (bid.outcome === 'lost' ? 'HR Ledger: you lost this bid' : 'HR Ledger: you have been outbid') + (mine ? ' (your offer ' + mine.toLocaleString('en-US') + (highest || bid.highest ? ', highest bid ' + (highest || bid.highest).toLocaleString('en-US') : '') + ')' : '') : 'HR Ledger: you made an offer' + (mine ? ' of ' + mine.toLocaleString('en-US') : '') + ' and it is the highest so far';
    tag.style.cssText = 'display:inline-block;margin-left:6px;min-width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;font:700 14px system-ui,sans-serif;color:#fff;vertical-align:middle;background:' + (out ? '#C0281E' : '#1E8449') + ';box-shadow:0 0 0 2px #fff;';
    var link = host.querySelector('a');
    if (link && link.parentNode) link.parentNode.insertBefore(tag, link.nextSibling); else host.appendChild(tag);
  }
  // row colours: gold = fits everything, green fading to a colour for how many criteria are met, red = no, grey = about the same
  var ROW_GREEN = [34, 160, 84], ROW_RED = [204, 48, 40], ROW_ORANGE = [236, 140, 30], ROW_GOLD = [255, 196, 0], ROW_GREY = [130, 134, 120];
  function rowRgb(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }
  function rowMix(a, b, t) { return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)]; }
  function paintRow(row, st, frac, plain) {
    var bar, mc;
    if (plain) { bar = ROW_GREY; row.style.background = rowRgb(ROW_GREY, 0.35); }
    else if (st === 'gold') { bar = ROW_GOLD; row.style.background = rowRgb(ROW_GOLD, 0.7); }
    else if (st === 'lifts') {
      mc = frac < 0.5 ? rowMix(ROW_RED, ROW_ORANGE, frac / 0.5) : rowMix(ROW_ORANGE, ROW_GOLD, (frac - 0.5) / 0.5); bar = mc;
      row.style.background = 'linear-gradient(90deg,' + rowRgb(ROW_GREEN, 0.7) + ' 0%,' + rowRgb(ROW_GREEN, 0.7) + ' 30%,' + rowRgb(mc, 0.7) + ' 100%)';
    } else { bar = ROW_RED; row.style.background = rowRgb(ROW_RED, 0.6); }
    row.style.boxShadow = 'inset 8px 0 0 ' + rowRgb(bar, 1);
    row.setAttribute('data-hr-fit', plain ? 'same' : st);
  }
  // a stallion on the Studs & Semen market: his numbers, the fee, and whether he is better or worse than your own
  // stallions for your free mares; the hover lists the mares that would suit him best and why
  function studRow(state, outer, row, studLink, me) {
    var m = /studs-and-semen\/(\d+)/.exec(studLink.getAttribute('href') || '');
    if (!m) return;
    var info = state.horseInfo && state.horseInfo[m[1]];
    if (!info || (me && String(info.ownerName || '').trim().toLowerCase() === me)) return;
    var fees = {};
    [['hrc', 'HRC'], ['dp', 'DP'], ['ft', 'FT'], ['wt', 'WT']].forEach(function (p) {
      var td = outer.querySelector('tr.market-item-price td.item-price-' + p[0]);
      if (td && !td.classList.contains('disabled')) { var n = parseInt(String(td.textContent || '').replace(/[^0-9]/g, ''), 10); if (n) fees[p[1]] = n; }
    });
    var ri = HRLib.studRowInfo(state, m[1], fees);
    if (!ri) return;
    infoBadge(outer, ri, null);
    row.title = ri.hover;
    if (ri.paint) paintRow(row, ri.paint.state, ri.paint.frac, ri.paint.plain);
  }
  function rowMoney(outer, sel) {
    var el = outer.querySelector(sel);
    return el && !/n\/a/i.test(el.textContent || '') ? parseInt(String(el.textContent || '').replace(/[^0-9]/g, ''), 10) || 0 : 0;
  }
  // a small line under the horse's name on a market row: GP, conformation, traits, a typical price and the herd verdict,
  // each green when it meets your purchase criteria for that sex and red when it does not
  function infoBadge(outer, ri, benefit) {
    var host = outer.querySelector('.market-office-table-row-horse-info') || outer;
    var box = document.createElement('div');
    box.setAttribute('data-hr-info', '1');
    box.style.cssText = 'margin-top:3px;font:600 12px system-ui,sans-serif;line-height:1.6;';
    box.title = ri.hover;
    function pill(text, ok, bg) {
      var sp = document.createElement('span');
      sp.textContent = text;
      sp.style.cssText = 'display:inline-block;margin:0 4px 2px 0;padding:0 6px;border-radius:9px;color:#fff;background:' + (bg || (ok === true ? '#1E8449' : ok === false ? '#C0281E' : '#6E7260')) + ';';
      box.appendChild(sp);
    }
    ri.chips.forEach(function (c) { pill(c.label + ' ' + c.text + (c.ok === true ? ' ✓' : c.ok === false ? ' ✗' : ''), c.ok); });
    if (ri.bench) pill('$ ~' + ri.bench.est.toLocaleString('en-US'), null, '#46592C');
    (ri.extraPills || []).forEach(function (x) { pill(x.text, null, x.bg); });
    var hv = benefit && benefit.verdict;
    if (hv && hv !== 'unknown') pill(hv === 'helps' ? 'Helps herd' : hv === 'maybe' ? 'May help herd' : 'No herd lift', hv === 'no' ? false : true);
    host.appendChild(box);
    // the row has a fixed height that would hide the badges: let it and the boxes around the horse's details grow
    var row = outer.querySelector('.market-office-table-row') || outer;
    for (var el = box.parentElement; el; el = el.parentElement) {
      el.style.overflow = 'visible';
      if (el === outer.parentElement) break;
      if (el === row || el.contains(host) || host.contains(el)) { el.style.height = 'auto'; el.style.maxHeight = 'none'; }
    }
    // if it is still cut off, make the row tall enough for what is inside it
    setTimeout(function () {
      var need = box.getBoundingClientRect().bottom - row.getBoundingClientRect().top + 8;
      if (need > row.getBoundingClientRect().height) { row.style.minHeight = Math.ceil(need) + 'px'; outer.style.minHeight = Math.ceil(need) + 'px'; }
    }, 50);
  }
  // the highest bid seen on a listing you bid on is kept with the bid, so a lost bid still tells what the horse went for
  function noteHighest(state, tradeId, outer) {
    var bid = state.marketBids && state.marketBids[tradeId];
    var hi = bid ? rowMoney(outer, '.market-office-table-row-highestbid') : 0;
    if (hi > (Number(bid && bid.highest) || 0)) saveBid(tradeId, { highest: hi });
  }
  // ---- ranch page: a keep / sell verdict and the best stallion on each horse's card ----
  // The ranch page lists horses as li.horse-item[data-horse="<life number>"]. Each of yours that is saved in the ledger
  // gets a small block under its name: a coloured Keep / Consider selling / Sell / For sale tag, and for a mare that is
  // free to breed the stallion the ledger would pick. Hover it for the reasons. A checkbox in My notes turns it off.
  // Keep the site fast: heavy drawing waits for the browser to be idle, and page watchers run at most every 300 ms
  function whenIdle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(function () { try { fn(); } catch (e) { console.error('HR Ledger:', e); } }, { timeout: 4000 });
    else setTimeout(fn, 50);
  }
  function observerDebounce(fn) {
    var t = null;
    return function () { if (t) return; t = setTimeout(function () { t = null; fn(); }, 300); };
  }
  // ---- stallions on the Studs & Semen market are saved for you ----
  // Opening the market lists many studs the ledger has never seen. A few at a time (5 per pass, a pause between each, only
  // while the browser is idle) the stallions listed on the page are looked up the way a visit to their page would, and
  // their fee is kept with them, so they show up in the Foal Calculator, the mare cards' suggestions and the market rows.
  // A checkbox in My notes turns it off.
  var studCacheTimers = [], studCacheBusy = false;
  function cacheMarketStuds() {
    if (studCacheBusy || !/\/market\/studs-and-semen/.test(location.pathname) || /\/(edit|create)/.test(location.pathname)) return;
    var rows = document.querySelectorAll('.market-office-table-row-outer');
    if (!rows.length || !getAuthData().hr_csrf) return;
    var wanted = [];
    rows.forEach(function (outer) {
      var a = outer.querySelector('a[href*="/market/studs-and-semen/"]'), m = a && /studs-and-semen\/(\d+)/.exec(a.getAttribute('href') || '');
      if (!m) return;
      var fees = {};
      [['hrc', 'HRC'], ['dp', 'DP'], ['ft', 'FT'], ['wt', 'WT']].forEach(function (p) {
        var td = outer.querySelector('tr.market-item-price td.item-price-' + p[0]);
        if (td && !td.classList.contains('disabled')) { var n = parseInt(String(td.textContent || '').replace(/[^0-9]/g, ''), 10); if (n) fees[p[1]] = n; }
      });
      if (!wanted.some(function (w) { return w.life === m[1]; })) wanted.push({ life: m[1], fees: fees });
    });
    if (!wanted.length) return;
    studCacheBusy = true;
    HRStorage.peekState(function (state) {
      if (state.settings && state.settings.saveMarketStuds === false) { studCacheBusy = false; return; }
      var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase(), week = Date.now() - 7 * 86400000;
      // new ones first, then ones last saved over a week ago (fee and details change)
      var todo = wanted.filter(function (w) { var i = state.horseInfo && state.horseInfo[w.life]; return !i; })
        .concat(wanted.filter(function (w) { var i = state.horseInfo && state.horseInfo[w.life]; return i && (!i.capturedAt || i.capturedAt < week) && String(i.ownerName || '').trim().toLowerCase() !== me; })).slice(0, 5);
      if (!todo.length) { studCacheBusy = false; return; }
      var got = [];
      (function next(i) {
        if (i >= todo.length) { finish(); return; }
        var id = todo[i].life;
        Promise.all([
          fetchHorseJson('/api/player/horse/' + id).catch(function () { return null; }),
          fetchHorseJson('/api/player/horse/' + id + '/passport').catch(function () { return null; })
        ]).then(function (res) {
          var info = safeExtract(function () { return buildHorseInfoFromApi(id, res[0], res[1]); }, null);
          if (info) got.push({ info: info, fees: todo[i].fees });
          setTimeout(function () { next(i + 1); }, 800);
        });
      })(0);
      function finish() {
        if (!got.length) { studCacheBusy = false; return; }
        HRStorage.getState(function (st) {
          got.forEach(function (g) {
            HRStorage.upsertHorseInfo(st, g.info.lifeNumber, g.info);
            if (g.info.sex === 'stallion' && Object.keys(g.fees).length) {
              var meta = st.horseMeta[g.info.lifeNumber] = Object.assign({}, st.horseMeta[g.info.lifeNumber]);
              meta.studTerms = Object.assign({}, meta.studTerms, { cheapest: g.fees, seenAt: toIsoDate(Date.now()) });
            }
          });
          HRStorage.setState(st, function () { studCacheBusy = false; showToast('HR Ledger: ' + got.length + ' stud' + (got.length === 1 ? '' : 's') + ' from the market saved'); });
        });
      }
    });
  }
  function scheduleStudCache() {
    studCacheTimers.forEach(clearTimeout);
    if (!/\/market\/studs-and-semen/.test(location.pathname)) return;
    studCacheTimers = [4000, 16000, 30000].map(function (ms) { return setTimeout(function () { whenIdle(cacheMarketStuds); }, ms); });
  }
  // ---- ranch page: the age Horse Reality shows on each card ----
  // Owners can age horses up with Delta Points, so the birth date alone is not the age. The ranch page lists every horse's
  // real age ("9 years, 2 months"): it is saved as the horse's age, and the months it was aged up are worked out from it.
  var ranchAgeDone = '';
  function scrapeRanchAges() {
    var items = document.querySelectorAll('li.horse-item[data-horse]');
    if (!items.length) return;
    var seen = [];
    items.forEach(function (li) {
      var el = li.querySelector('.breed-and-age .age.desktop') || li.querySelector('.breed-and-age .age');
      var text = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      var months = HRLib.parseAgeText(text);
      // HRToolkit's tagline and private stable tag on the card
      var tagline = null, priv = null;
      li.querySelectorAll('.name-and-tagline .tagline').forEach(function (t) {
        var tt = (t.textContent || '').trim();
        if (t.hasAttribute('data-hrtoolkit-stable-private-tag')) priv = priv || HRLib.parseToolkitPrivateTag(tt);
        else tagline = tagline || HRLib.parseToolkitTagline(tt);
      });
      if (months != null || tagline || priv) seen.push({ life: li.getAttribute('data-horse'), text: text, months: months, tagline: tagline, priv: priv });
    });
    var sig = seen.map(function (s) { return s.life + ':' + s.months + ':' + JSON.stringify(s.tagline) + JSON.stringify(s.priv); }).join(',');
    if (!seen.length || sig === ranchAgeDone) return;
    HRStorage.getState(function (state) {
      var changed = 0;
      seen.forEach(function (s) {
        var info = state.horseInfo && state.horseInfo[s.life];
        if (!info) return;
        var did = false;
        if (s.months != null && !(info.ageMonths === s.months && info.ageText === s.text)) { info.ageMonths = s.months; info.ageText = s.text; info.ageAt = Date.now(); did = true; }
        if ((s.tagline || s.priv) && HRLib.applyToolkitTags(state, s.life, s.tagline, s.priv)) did = true;
        if (did) changed++;
      });
      ranchAgeDone = sig;
      if (!changed) return;
      HRStorage.setState(state, function () { showToast('HR Ledger: ' + changed + ' horse' + (changed === 1 ? '' : 's') + ' updated from the ranch page (age, scores, tags)'); });
    });
  }
  var ranchTimers = [], ranchObserver = null, ranchDebounce = null;
  // ---- breeding suggestions on the ranch cards are collapsed until you open them ----
  // Each free mare's card has a "Breeding suggestions" toggle; Expand all / Close all buttons sit above and below the horses.
  var ranchSuggOpen = {};
  function syncRanchSugg() {
    document.querySelectorAll('li.horse-item[data-horse]').forEach(function (li) {
      var sub = li.querySelector('[data-hr-sugg]'), tg = li.querySelector('[data-hr-sugg-toggle]');
      if (!sub || !tg) return;
      var open = !!ranchSuggOpen[li.getAttribute('data-horse')];
      sub.style.display = open ? 'flex' : 'none';
      tg.textContent = (open ? '\u25BE ' : '\u25B8 ') + 'Breeding suggestions';
    });
  }
  function setAllRanchSugg(open) {
    document.querySelectorAll('li.horse-item[data-horse]').forEach(function (li) { ranchSuggOpen[li.getAttribute('data-horse')] = open; });
    syncRanchSugg();
  }
  function ranchSuggBar(id) {
    var bar = document.createElement('div');
    bar.id = id;
    bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0 10px;font:600 13px system-ui,sans-serif;';
    [['Expand all suggestions', true], ['Close all suggestions', false]].forEach(function (b) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.textContent = b[0];
      btn.style.cssText = 'padding:3px 10px;font:inherit;cursor:pointer;border:1px solid #888;border-radius:6px;background:#fff;color:#222;';
      btn.addEventListener('click', function (e) { e.preventDefault(); setAllRanchSugg(b[1]); });
      bar.appendChild(btn);
    });
    return bar;
  }
  // ---- sorting the ranch page by what the ledger knows ----
  // A small "Sort" box above the horse grid orders the cards by a conformation score recorded in the ledger (top, lowest, range),
  // Breed Total, genetic potential or the keep/sell rank. Horses with no value for it go last; ties keep the site's own order.
  var RANCH_SORTS = [
    ['', 'Site order'], ['conf', 'Conformation score: high to low'], ['conf:asc', 'Conformation score: low to high'],
    ['stats', 'Conformation stats: better first'], ['stats:asc', 'Conformation stats: weaker first'],
    ['bt', 'Breed Total: high to low'], ['bt:asc', 'Breed Total: low to high'], ['gp', 'Genetic potential: high to low'], ['gp:asc', 'Genetic potential: low to high'],
    ['range', 'Conformation range: widest first'], ['ranged', 'Ranged first'], ['rank', 'Keep / sell rank: best first']
  ];
  function ranchSortValue(key, state, life, advice) {
    key = String(key).replace(':asc', '');
    var meta = (state.horseMeta && state.horseMeta[life]) || {}, info = (state.horseInfo && state.horseInfo[life]) || {};
    var hi = HRLib.bestConformation(meta).best, lo = Number(meta.confLow) || 0;
    if (key === 'conf') return hi > 0 ? hi : null;
    if (key === 'stats') {
      // the trait ratings (the 2G 8A 2BA on the card): average rating, Below average = 0 ... Very good = 4; fewer Below average breaks a tie
      var tc = HRLib.traitCounts(info);
      var n = tc ? tc.VG + tc.GP + tc.G + tc.A + tc.BA : 0;
      return n > 0 ? (4 * tc.VG + 3 * tc.GP + 2 * tc.G + tc.A) / n * 1000 - tc.BA : null;
    }
    if (key === 'range') return hi > 0 && lo > 0 && lo <= hi ? hi - lo : null;
    if (key === 'ranged') { var rs = HRLib.rangeStatus(state, life); return rs ? (rs.ranged ? 1000 : 0) + rs.range : null; }
    if (key === 'gp') { var g = Number(info.geneticPotential); return g > 0 ? g : null; }
    if (key === 'bt') { var b = Math.max(Number(meta.btBest) || 0, HRLib.breedTotal(info.geneticPotential, hi)); return b > 0 ? b : null; }
    if (key === 'rank') { var a = advice && advice[life]; return a && a.level ? a.level * 1000 - (a.rank || 0) : null; }
    return null;
  }
  function applyRanchSort(state, advice) {
    var grid = document.querySelector('ul.horse-grid, ul.horses');
    if (!grid) return;
    var key = ''; try { key = localStorage.getItem('hrLedgerRanchSort') || ''; } catch (e) { /* no storage */ }
    var bar = document.getElementById('hr-ranch-sort');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'hr-ranch-sort';
      bar.style.cssText = 'display:flex;align-items:center;gap:8px;margin:0 0 10px;font:600 13px system-ui,sans-serif;';
      var lab = document.createElement('label'); lab.textContent = 'HR Ledger sort'; lab.htmlFor = 'hr-ranch-sort-sel';
      var sel = document.createElement('select'); sel.id = 'hr-ranch-sort-sel'; sel.style.cssText = 'padding:3px 6px;font:inherit;';
      RANCH_SORTS.forEach(function (o) { var op = document.createElement('option'); op.value = o[0]; op.textContent = o[1]; sel.appendChild(op); });
      sel.addEventListener('change', function () { try { localStorage.setItem('hrLedgerRanchSort', sel.value); } catch (e) { /* no storage */ } renderRanchAdvice(); });
      bar.appendChild(lab); bar.appendChild(sel);
      grid.parentNode.insertBefore(bar, grid);
    }
    if (!document.getElementById('hr-ranch-sugg-top')) bar.parentNode.insertBefore(ranchSuggBar('hr-ranch-sugg-top'), grid);
    if (!document.getElementById('hr-ranch-sugg-bottom')) grid.parentNode.insertBefore(ranchSuggBar('hr-ranch-sugg-bottom'), grid.nextSibling);
    var selEl = document.getElementById('hr-ranch-sort-sel');
    if (selEl && selEl.value !== key) selEl.value = key;
    var items = Array.prototype.slice.call(grid.querySelectorAll(':scope > li.horse-item[data-horse]'));
    items.forEach(function (li, i) { if (li.getAttribute('data-hr-pos') == null) li.setAttribute('data-hr-pos', String(i)); });
    var rows = items.map(function (li) { return { li: li, pos: Number(li.getAttribute('data-hr-pos')), v: key ? ranchSortValue(key, state, li.getAttribute('data-horse'), advice) : null }; });
    rows.sort(function (a, b) {
      if (!key) return a.pos - b.pos;
      if ((a.v == null) !== (b.v == null)) return a.v == null ? 1 : -1;
      if (a.v !== b.v) return /:asc$/.test(key) ? a.v - b.v : b.v - a.v;
      return a.pos - b.pos;
    });
    var disp = getComputedStyle(grid).display, useOrder = /flex|grid/.test(disp);
    rows.forEach(function (r, i) { if (useOrder) r.li.style.order = String(i); else if (grid.children[i] !== r.li) grid.insertBefore(r.li, grid.children[i] || null); });
  }
  function renderRanchAdvice() {
    var items = document.querySelectorAll('li.horse-item[data-horse]');
    if (!items.length) return;
    HRStorage.peekState(function (state) {
      if (state.settings && state.settings.ranchAdvice === false) { items.forEach(function (li) { li.querySelectorAll('[data-hr-advice]').forEach(function (e) { e.remove(); }); }); return; }
      var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      var lives = [];
      items.forEach(function (li) {
        var l = li.getAttribute('data-horse'), info = state.horseInfo && state.horseInfo[l];
        if (info && (!me || String(info.ownerName || '').trim().toLowerCase() === me)) lives.push(l);
      });
      var advice;
      try { advice = HRLib.herdAdvice(state, lives, { noBreeding: true }); } catch (e) { return; }
      // one colour per level, from a dark green (top keeper) to red (sell)
      var COL = { top: '#146C3B', keep: '#1E8449', middle: '#7D8A2B', consider: '#B9770E', sell: '#C0281E', forsale: '#6E7260', nodata: '#8A8F85' };
      var queue = [];
      try { applyRanchSort(state, advice); } catch (e) { /* sorting is optional */ }
      items.forEach(function (li) {
        li.querySelectorAll('[data-hr-advice]').forEach(function (e) { e.remove(); });
        var a = advice[li.getAttribute('data-horse')];
        if (!a) return;
        // a block at the bottom of the card, so it never covers the horse or the name
        var host = li.querySelector('.content-wrapper') || li.querySelector('.content') || li;
        var box = document.createElement('div');
        box.setAttribute('data-hr-advice', '1');
        box.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 6px;padding:6px 6px 8px;margin:0;position:relative;z-index:2;clear:both;flex:0 0 auto;font:700 12px/1.4 system-ui,sans-serif;';
        box.title = 'HR Ledger\n' + a.reasons.join('\n');
        function pill(text, bg, into) {
          var d = document.createElement('span');
          d.textContent = text;
          d.style.cssText = 'display:inline-block;padding:1px 9px;border-radius:10px;color:#fff;background:' + bg + ';white-space:normal;text-align:center;max-width:100%;';
          (into || box).appendChild(d);
          return d;
        }
        pill((a.protectedHorse ? '\u2605 ' : '') + a.label + (a.price ? ' \u00b7 ~' + a.price.toLocaleString('en-US') : '') + (a.infoal ? ' \u00b7 ' + a.infoal : ''), COL[a.action] || COL.nodata);
        if (a.ranged) pill('\u25C6 Ranged', '#3A78C2');
        // five pips: how far up the herd the horse really sits by rank (all filled = top of the herd, one = bottom)
        if (a.pips) {
          var bar = document.createElement('span');
          bar.style.cssText = 'display:inline-flex;align-items:center;gap:2px;';
          for (var i = 1; i <= 5; i++) {
            var pip = document.createElement('span');
            pip.style.cssText = 'display:inline-block;width:10px;height:10px;border-radius:2px;background:' + (i <= a.pips ? (COL[['', 'sell', 'consider', 'middle', 'keep', 'top'][a.pips]] || COL.nodata) : '#CFD3C8') + ';';
            bar.appendChild(pip);
          }
          if (a.rank && a.of) { var rk = document.createElement('span'); rk.textContent = a.rank + '/' + a.of; rk.style.cssText = 'margin-left:4px;color:#2E3B1F;'; bar.appendChild(rk); }
          box.appendChild(bar);
        }
        function stud(b) { return b.name + (b.estBT != null ? ' \u00b7 BT ' + b.estBT : ''); }
        // the best stallion for a free mare is worked out afterwards, a few at a time while the browser is idle
        if (a.freeMare) {
          // a toggle, and the suggestions inside a box that is closed until you open it
          var tg = document.createElement('button');
          tg.type = 'button'; tg.setAttribute('data-hr-sugg-toggle', '1');
          tg.style.cssText = 'flex:0 0 100%;max-width:100%;padding:2px 10px;font:700 12px system-ui,sans-serif;cursor:pointer;border:1px solid #5B3E8A;border-radius:10px;background:#fff;color:#5B3E8A;';
          var subBox = document.createElement('div');
          subBox.setAttribute('data-hr-sugg', '1');
          subBox.style.cssText = 'display:none;flex:0 0 100%;flex-wrap:wrap;justify-content:center;gap:4px 6px;';
          tg.addEventListener('click', function (e) { e.preventDefault(); var l = li.getAttribute('data-horse'); ranchSuggOpen[l] = !ranchSuggOpen[l]; syncRanchSugg(); });
          box.appendChild(tg); box.appendChild(subBox);
        }
        if (a.freeMare) queue.push({ life: li.getAttribute('data-horse'), show: function (pa) {
          var subBox2 = box.querySelector('[data-hr-sugg]');
          if (pa.bestOwn) pill('\u2192 Yours: ' + stud(pa.bestOwn), '#2E3B1F', subBox2);
          if (pa.best && !pa.best.yours) pill('\u2192 Other: ' + stud(pa.best) + (pa.best.partner ? ' (partner)' : '') + (pa.best.unlisted ? ' (no fee saved)' : (pa.best.cost ? ' \u00b7 ' + pa.best.cost : '')), '#5B3E8A', subBox2);
          if (!pa.bestOwn && !(pa.best && !pa.best.yours)) { var none = box.querySelector('[data-hr-sugg-toggle]'); if (none) none.style.display = 'none'; }
          syncRanchSugg();
          if (pa.reasons.length) box.title = box.title + '\n\n' + pa.reasons.join('\n');
        } });
        // the very bottom of the card, so it sits in the same place on every card
        host.appendChild(box);
        // stars in the top-left corner of the horse's picture (limits are set in the ledger's Settings)
        var stars = HRLib.starsOf(state, li.getAttribute('data-horse'));
        if (stars.length) {
          var pbox = li; // the card itself, so the stars sit in the corner of the picture whatever layers the horse is drawn in
          if (pbox) {
            if (getComputedStyle(pbox).position === 'static') pbox.style.position = 'relative';
            var sb = document.createElement('span');
            sb.setAttribute('data-hr-advice', '1');
            sb.style.cssText = 'position:absolute;top:8px;left:10px;display:flex;gap:1px;z-index:20;pointer-events:auto;';
            stars.forEach(function (x) {
              var s = document.createElement('span');
              s.title = 'HR Ledger: ' + x.title;
              s.style.cssText = 'position:relative;display:inline-block;width:30px;height:30px;font:30px/30px system-ui,sans-serif;text-align:center;text-shadow:0 1px 2px rgba(0,0,0,.55);color:' + { conf: '#F2B705', gp: '#1A9E9E', bt: '#8E4FD0' }[x.key] + ';';
              s.textContent = '\u2605';
              if (x.label) { var b = document.createElement('b'); b.textContent = x.label; b.style.cssText = 'position:absolute;left:0;right:0;top:0;font:800 9px/31px system-ui,sans-serif;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.8);'; s.appendChild(b); }
              sb.appendChild(s);
            });
            pbox.appendChild(sb);
          }
        }
      });
      function step() {
        var t0 = Date.now();
        while (queue.length && Date.now() - t0 < 12) { var q = queue.shift(); try { q.show(HRLib.partnerAdvice(state, q.life)); } catch (e) { /* skip this mare */ } }
        if (queue.length) whenIdle(step);
      }
      if (queue.length) whenIdle(step);
    });
  }
  function scheduleRanch() {
    ranchTimers.forEach(clearTimeout);
    ranchTimers = [2000].map(function (ms) { return setTimeout(function () { whenIdle(scrapeRanchAges); whenIdle(renderRanchAdvice); }, ms); });
    var grid = document.querySelector('ul.horse-grid, ul.horses');
    if (grid && !ranchObserver) {
      // the list can be redrawn (filters, search): watch its direct children only, so adding our block never retriggers it
      ranchObserver = new MutationObserver(function () { clearTimeout(ranchDebounce); ranchDebounce = setTimeout(function () { whenIdle(scrapeRanchAges); whenIdle(renderRanchAdvice); }, 900); });
      ranchObserver.observe(grid, { childList: true });
    }
  }
  function scheduleMarket() {
    marketTimers.forEach(clearTimeout);
    marketTimers = [2000, 6000].map(function (ms) { return setTimeout(function () { whenIdle(highlightMarket); }, ms); });
  }
  // (No storage-change listener here: Chrome would copy the whole ledger into every open Horse Reality tab on every
  // save. The rows are refreshed on load and when the tab is shown again.)
  if (typeof window !== 'undefined' && window.__HR_TEST__) window.__hrMarket = { highlightMarket: highlightMarket, scanTradeStatus: scanTradeStatus, scrapeMySales: scrapeMySales, scrapeBidNotifications: scrapeBidNotifications, checkPendingRetire: checkPendingRetire };

  // ---- fit summary on a horse's page ----
  // A small card in the corner of a Horse Reality horse page saying whether the horse fits your criteria and why
  // (goal boxes, preferred and unwanted genes, notes, producer record). Click it to open the reasons, x to dismiss.
  var fitTimers = [], fitDismissed = '', fitDebounce = null;
  function removeFitBanner() { var e = document.getElementById('hr-fit-banner'); if (e) e.remove(); }
  function renderFitBanner() {
    var life = (window.__HR_TEST__ && window.__HR_TEST_LIFE__) || parseHorseIdFromUrl();
    if (!life) { removeFitBanner(); return; }
    if (fitDismissed === life) return;
    HRStorage.peekState(function (state) {
      if (state.settings && state.settings.fitBanner === false) { removeFitBanner(); return; }
      var f = HRLib.fitSummary(state, life);
      if (f.verdict === 'nogoals') { removeFitBanner(); return; }
      var colours = { fits: '#4C7A52', near: '#3A78C2', misses: '#9C4A3B', unknown: '#6E7260' };
      var open = false;
      try { open = sessionStorage.getItem('hrFitOpen') === '1'; } catch (e) { /* no storage */ }
      var box = document.getElementById('hr-fit-banner');
      if (!box) { box = document.createElement('div'); box.id = 'hr-fit-banner'; document.body.appendChild(box); }
      else { open = box.getAttribute('data-open') === '1'; }
      box.setAttribute('data-open', open ? '1' : '0');
      box.style.cssText = 'position:fixed;left:12px;bottom:12px;max-width:340px;z-index:2147483646;background:#fff;color:#262A1E;border:1px solid #DBD5BE;border-left:6px solid ' + (colours[f.verdict] || colours.unknown) + ';border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.2);font:13px/1.4 system-ui,sans-serif;';
      while (box.firstChild) box.removeChild(box.firstChild);
      var head = document.createElement('div');
      head.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;cursor:pointer;';
      var title = document.createElement('div');
      title.style.cssText = 'flex:1;font-weight:600;';
      title.textContent = 'HR Ledger: ' + f.headline;
      var arrow = document.createElement('span');
      arrow.textContent = open ? '\u25be' : '\u25b8';
      var close = document.createElement('span');
      close.textContent = '\u00d7';
      close.title = 'Hide for this page';
      close.style.cssText = 'font-size:18px;line-height:1;padding:0 2px;';
      head.appendChild(title); head.appendChild(arrow); head.appendChild(close);
      head.addEventListener('click', function (e) {
        if (e.target === close) { fitDismissed = life; removeFitBanner(); return; }
        var nowOpen = box.getAttribute('data-open') !== '1';
        box.setAttribute('data-open', nowOpen ? '1' : '0');
        try { sessionStorage.setItem('hrFitOpen', nowOpen ? '1' : '0'); } catch (err) { /* no storage */ }
        renderFitBanner();
      });
      box.appendChild(head);
      if (open) {
        var list = document.createElement('div');
        list.style.cssText = 'padding:0 10px 8px;border-top:1px solid #EEE9D6;';
        f.lines.forEach(function (l) {
          var row = document.createElement('div');
          row.style.cssText = 'padding:3px 0;color:' + (l.ok === true ? '#46592C' : l.ok === false ? '#9C4A3B' : '#6E7260') + ';';
          row.textContent = (l.ok === true ? '\u2713 ' : l.ok === false ? '\u2717 ' : '\u2022 ') + l.text;
          list.appendChild(row);
        });
        box.appendChild(list);
      }
    });
  }
  function scheduleFit() {
    fitTimers.forEach(clearTimeout);
    fitTimers = [2000, 6000, 14000].map(function (ms) { return setTimeout(function () { whenIdle(renderFitBanner); }, ms); });
  }
  // Refresh when you come back to this tab (for example after changing a setting in the dashboard)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !storageAlive()) return;
    clearTimeout(fitDebounce);
    fitDebounce = setTimeout(function () { renderFitBanner(); highlightMarket(); }, 2300);
  });

  // ---- competition results: scores of your horses in the disciplines ----
  // Two places are read: a competition's results page (a list of horses with a score, like the conformation show results; the
  // discipline is taken from the page title or address), and the "competition results" block of a horse's stats page. Only
  // horses that are yours (or already saved) are recorded. Because these pages can be laid out differently from the show
  // pages, a message says how many scores were read; if none appears on a competition page, tell the developer.
  var lastCompSig = '';
  function readCompetitionPage() {
    // a competition's results page is /competitions/<id> (the entry page, ending /enter, is not read); older layouts had /results
    if (/conformation-shows/.test(location.pathname) || /\/enter\/?$/.test(location.pathname) || !/\/competitions\/|results/.test(location.pathname)) return null;
    var h1 = document.querySelector('.competition-title') || document.querySelector('h1'), title = h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim() : '';
    var discipline = HRLib.disciplineNameOf(title) || HRLib.disciplineNameOf(location.pathname);
    if (!discipline) return null;
    var rows = [];
    document.querySelectorAll('.responsive-tr, tr').forEach(function (tr) {
      var link = tr.querySelector('a[href*="/horses/"]'), m = link && /\/horses\/(\d+)\//.exec(link.getAttribute('href') || '');
      if (!m) return;
      var scoreEl = tr.querySelector('.text-right strong.fontbigger') || tr.querySelector('strong.fontbigger') || tr.querySelector('.text-right strong');
      var sm = scoreEl && /\d+(?:\.\d+)?/.exec((scoreEl.textContent || '').replace(/,/g, ''));
      if (!sm) return;
      var owner = tr.querySelector('a[href*="/user/"]');
      rows.push({ life: m[1], score: parseFloat(sm[0]), owner: owner ? (owner.textContent || '').trim() : '', mine: tr.classList.contains('mine') });
    });
    return rows.length ? { name: title, discipline: discipline, rows: rows, id: ((/\/competitions\/([0-9a-f-]{8,})/i.exec(location.pathname) || /\/([0-9a-f-]{8,})\/results/i.exec(location.pathname) || [])[1]) || title } : null;
  }
  function scrapeCompetitionResults() {
    var res = readCompetitionPage();
    if (!res) return;
    var sig = res.id + '|' + res.rows.map(function (r) { return r.life + ':' + r.score; }).join(',');
    if (sig === lastCompSig) return;
    lastCompSig = sig;
    HRStorage.getState(function (state) {
      if (!state.horseMeta) state.horseMeta = {};
      var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase(), saved = 0;
      res.rows.forEach(function (r) {
        if (!(r.mine || (me && r.owner.toLowerCase() === me)) && !(state.horseInfo && state.horseInfo[r.life])) return;
        var meta = Object.assign({}, state.horseMeta[r.life]);
        var log = Array.isArray(meta.compLog) ? meta.compLog.slice() : [];
        if (log.some(function (e) { return e.comp === res.id && e.score === r.score; })) return;
        log.push({ comp: res.id, name: res.name, discipline: res.discipline, score: r.score, seenAt: Date.now() });
        meta.compLog = log.slice(-40);
        HRLib.recordCompScore(meta, r.score, res.discipline, { event: res.name });
        var by = Object.assign({}, meta.comp && meta.comp.by), rec = Object.assign({}, by[res.discipline]);
        rec.n = (rec.n || 0) + 1; by[res.discipline] = rec; meta.comp = Object.assign({}, meta.comp, { by: by });
        state.horseMeta[r.life] = meta; saved++;
      });
      if (!saved) return;
      HRStorage.setState(state, function () { showToast('HR Ledger: ' + saved + ' ' + res.discipline + ' score' + (saved === 1 ? '' : 's') + ' saved'); });
    });
  }
  // the "Latest 25 competition results" block on a horse's stats page: rows of date, level ("BRE - Training Level"), score and
  // position; the HRToolkit summary table above it (All-time high / low) is read too. The discipline is the one named in the
  // row or the block; a short code like "BRE" is matched to the discipline the horse is in training for (and remembered).
  var lastCompStatsSig = '';
  function isoFromDmy(t) { var m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(t || ''); return m ? m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) : ''; }
  function scrapeCompetitionStats() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    var rows = [], sum = null, blockDisc = '';
    document.querySelectorAll('.half_block').forEach(function (block) {
      var top = block.querySelector('.top');
      if (!top || !/competition/i.test(top.textContent || '') || /show results/i.test(top.textContent || '')) return;
      blockDisc = HRLib.disciplineNameOf(top.textContent || '') || blockDisc;
      var all = block.querySelector('.hrtoolkit-summary-alltime');
      if (all) {
        var tds = all.querySelectorAll('td'), hi = parseFloat((tds[1] && tds[1].textContent) || ''), lo = parseFloat((tds[2] && tds[2].textContent) || '');
        if (hi > 0) sum = { high: hi, low: lo > 0 ? lo : 0 };
      }
      block.querySelectorAll('.row_460').forEach(function (row) {
        var cols = row.querySelectorAll(':scope > div');
        if (cols.length < 3) return;
        var dateText = (cols[0].textContent || '').trim(), level = (cols[1].textContent || '').replace(/\s+/g, ' ').trim();
        var vm = /\d+(?:\.\d+)?/.exec((cols[2].textContent || '').replace(/,/g, ''));
        // older layout: category, score; current layout: date, level, score, position
        if (!/\d{1,2}-\d{1,2}-\d{4}/.test(dateText)) { level = dateText; dateText = ''; vm = /\d+(?:\.\d+)?/.exec((cols[2].textContent || '').replace(/,/g, '')) || vm; }
        if (!vm) return;
        var cm = /^\s*([A-Za-z]{2,5})\s*-/.exec(level);
        rows.push({ level: level, date: isoFromDmy(dateText), score: parseFloat(vm[0]), code: cm ? cm[1].toUpperCase() : '', named: HRLib.disciplineNameOf(level) });
      });
    });
    if (!rows.length && !sum) return;
    var sig = id + '|' + rows.map(function (r) { return r.date + r.score; }).join(',') + '|' + (sum ? sum.high + '/' + sum.low : '');
    if (sig === lastCompStatsSig) return;
    lastCompStatsSig = sig;
    HRStorage.getState(function (state) {
      if (!state.horseMeta) state.horseMeta = {};
      var info = (state.horseInfo && state.horseInfo[id]) || {};
      var trainedAll = String(info.training || '').split(',').map(function (t) { return HRLib.disciplineNameOf(t); }).filter(Boolean);
      var trained = trainedAll.length === 1 ? trainedAll[0] : '';
      var codes = Object.assign({}, state.settings && state.settings.compCodes), codesChanged = false;
      function discOf(r) {
        if (r.named) return r.named;
        if (blockDisc) return blockDisc;
        if (r.code && codes[r.code]) return codes[r.code];
        if (trained) { if (r.code) { codes[r.code] = trained; codesChanged = true; } return trained; }
        return r.code ? 'Other (' + r.code + ')' : '';
      }
      var meta = Object.assign({}, state.horseMeta[id]), changed = false, fallback = '';
      rows.forEach(function (r) {
        var disc = discOf(r);
        if (!disc) return;
        fallback = fallback || disc;
        if (HRLib.recordCompScore(meta, r.score, disc, { event: r.level, date: r.date })) changed = true;
      });
      if (sum) {
        var sd = fallback || trained || blockDisc;
        if (sd) {
          if (HRLib.recordCompScore(meta, sum.high, sd, { event: 'HRToolkit all-time high' })) changed = true;
          if (sum.low && HRLib.recordCompScore(meta, sum.low, sd, { event: 'HRToolkit all-time low' })) changed = true;
        }
      }
      if (codesChanged) { state.settings = Object.assign({}, state.settings, { compCodes: codes }); changed = true; }
      if (!changed) return;
      state.horseMeta[id] = meta;
      HRStorage.setState(state, function () { showToast('HR Ledger: competition scores saved for this horse'); });
    });
  }

  // ---- conformation show results page ----
  // A show's results page lists every horse in each category (Foals / Mares / Stallions / Geldings) with its rank and
  // score. The score of each horse that is in the ledger (or is yours) raises its top conformation score, and the
  // result is kept in a short per-horse log of shows (used for the Star predicate count on the horse's page).
  var lastShowSig = '';
  function readShowResults() {
    var frames = document.querySelectorAll('.component.frame.show-table');
    if (!frames.length) return null;
    var h1 = document.querySelector('h1');
    var out = {
      showId: ((/\/show\/([0-9a-f-]{8,})\//i.exec(location.pathname) || [])[1]) || '',
      name: h1 ? (h1.textContent || '').replace(/\s+/g, ' ').trim() : 'Conformation show',
      rows: []
    };
    frames.forEach(function (fr) {
      var t = fr.querySelector('.title');
      var category = t ? (t.textContent || '').replace(/\s+/g, ' ').trim() : '';
      fr.querySelectorAll('.responsive-tr').forEach(function (tr) {
        var link = tr.querySelector('a[href*="/horses/"]');
        var m = link && /\/horses\/(\d+)\//.exec(link.getAttribute('href') || '');
        if (!m) return;
        var scoreEl = tr.querySelector('.text-right strong.fontbigger') || tr.querySelector('strong.fontbigger');
        var sm = scoreEl && /\d+(?:\.\d+)?/.exec((scoreEl.textContent || '').replace(/,/g, ''));
        if (!sm) return;
        var rankEl = tr.querySelector('.text-bold');
        var rank = 0;
        if (rankEl) {
          var rimg = rankEl.querySelector('img[alt$="Prize"]');
          var rm = rimg ? /(\d+)/.exec(rimg.getAttribute('alt') || '') : /#\s*(\d+)/.exec(rankEl.textContent || '');
          rank = rm ? parseInt(rm[1], 10) : 0;
        }
        var pm = /(\d)(?:st|nd|rd|th) Premium/i.exec((scoreEl.innerHTML || ''));
        var owner = tr.querySelector('a[href*="/user/"]');
        out.rows.push({
          life: m[1], score: parseFloat(sm[0]), rank: rank, premium: pm ? parseInt(pm[1], 10) : 0,
          category: category, owner: owner ? (owner.textContent || '').trim() : '',
          mine: tr.classList.contains('mine')
        });
      });
    });
    return out.rows.length ? out : null;
  }
  // ---- the conformation show entry page: who is ranged, and how far the others have to go ----
  // Each horse in the entry list gets its range (highest minus lowest score) out of the full range for its breed, and
  // "Ranged" once it is complete, so the horses that still need showing stand out. A button ticks the ones not ranged yet.
  var entrySig = '';
  function annotateShowEntry() {
    if (!/\/(conformation-shows|competitions)\//.test(location.pathname) || !/\/enter\/?$/.test(location.pathname)) return;
    var rows = document.querySelectorAll('.responsive-table-body .responsive-tr');
    if (!rows.length) return;
    var sig = rows.length + '|' + document.querySelectorAll('.hr-range-badge').length;
    if (sig === entrySig && document.getElementById('hr-range-bar')) return;
    HRStorage.peekState(function (state) {
      var L = HRLib, counts = { ranged: 0, open: 0, unknown: 0 }, todo = [];
      rows.forEach(function (row) {
        var a = row.querySelector('a[href*="/horses/"]');
        var m = a && /\/horses\/(\d+)/.exec(a.getAttribute('href') || '');
        var tag = row.querySelector('.horse-tagline');
        if (!m || !tag) return;
        var life = m[1], meta = (state.horseMeta && state.horseMeta[life]) || {}, info = (state.horseInfo && state.horseInfo[life]) || {};
        var stats = 0;
        (tag.textContent.match(/\d+(?:\+\d+)?(?:VG|GP|G|BA|A)\b/g) || []).forEach(function (t) { (t.match(/\d+/g) || []).forEach(function (n) { stats += Number(n); }); });
        var full = L.fullScoreRange(info) || L.fullScoreRange({ tagCounts: { G: stats } });
        var high = Number(meta.confBest) || 0, low = Number(meta.confLow) || 0;
        var kind, text, title;
        if (high > 0 && low > 0 && low <= high) {
          var range = Math.round((high - low) * 1000) / 1000;
          if (full && range >= full - 0.002) { kind = 'ranged'; text = '◆ Ranged ' + range + (full ? ' / ' + full : ''); }
          else { kind = 'open'; text = 'Range ' + range + (full ? ' / ' + full : '') + (full ? ' — ' + Math.round((full - range) * 1000) / 1000 + ' to go' : ''); }
          title = 'High ' + high + ', low ' + low + '. A horse is ranged when high minus low reaches the full range for its breed' + (full ? ' (' + full + ')' : ' (not known for this breed)') + '.';
        } else {
          kind = 'unknown'; text = 'Range unknown' + (high > 0 ? ' — high ' + high + ', no low yet' : ' — no scores saved');
          title = 'The ledger has no lowest score for this horse yet. Show it, or enter its high and low on its page.';
        }
        counts[kind]++;
        if (kind !== 'ranged') todo.push(row);
        var old = row.querySelector('.hr-range-badge');
        if (old) old.remove();
        var b = document.createElement('div');
        b.className = 'hr-range-badge';
        var colour = kind === 'ranged' ? '#3A78C2' : kind === 'open' ? '#C77700' : '#777';
        b.style.cssText = 'display:inline-block;margin-top:3px;padding:1px 7px;border-radius:9px;font-size:11px;font-weight:600;color:#fff;background:' + colour;
        b.textContent = text; b.title = title;
        tag.appendChild(b);
        row.style.boxShadow = 'inset 4px 0 0 ' + colour;
        row.dataset.hrRange = kind;
      });
      var bar = document.getElementById('hr-range-bar');
      if (!bar) {
        var first = document.querySelector('.horse-enter .row.mb-15');
        if (!first) return;
        bar = document.createElement('div');
        bar.id = 'hr-range-bar';
        bar.style.cssText = 'margin:0 0 12px;padding:8px 12px;border-radius:6px;background:rgba(58,120,194,.12);border:1px solid #3A78C2;font-size:13px;';
        first.parentNode.insertBefore(bar, first.nextSibling);
      }
      bar.innerHTML = '';
      var span = document.createElement('span');
      span.textContent = 'HR Ledger — ranged: ' + counts.ranged + ' · still to range: ' + counts.open + ' · range unknown: ' + counts.unknown + '   ';
      bar.appendChild(span);
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-sm btn-warning'; btn.textContent = 'Tick the ones not ranged';
      btn.title = 'Ticks every horse in the list that is not ranged yet (and unticks the ranged ones). Nothing is entered until you press the Enter button.';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        document.querySelectorAll('.responsive-table-body .responsive-tr').forEach(function (row) {
          var cb = row.querySelector('input[type=checkbox]');
          if (!cb) return;
          var want = row.dataset.hrRange !== 'ranged';
          if (cb.checked !== want) cb.click();
        });
      });
      bar.appendChild(btn);
      entrySig = rows.length + '|' + document.querySelectorAll('.hr-range-badge').length;
    });
  }
  function scrapeShowResults(force) {
    if (!force && !(/conformation-shows/.test(location.pathname) && /\/results\/?$/.test(location.pathname))) return;
    var res = readShowResults();
    if (!res) return;
    var sig = res.showId + '|' + res.rows.map(function (r) { return r.life + ':' + r.score; }).join(',');
    if (sig === lastShowSig) return;
    lastShowSig = sig;
    HRStorage.getState(function (state) {
      if (!state.horseMeta) state.horseMeta = {};
      var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      var ignored = (state.settings && state.settings.ignored) || {};
      var saved = 0, raisedCount = 0, names = [];
      res.rows.forEach(function (r) {
        if (ignored[r.life]) return;
        var mine = r.mine || (me && r.owner.toLowerCase() === me);
        if (!mine && !(state.horseInfo && state.horseInfo[r.life])) return;
        var meta = Object.assign({}, state.horseMeta[r.life]);
        var log = Array.isArray(meta.showLog) ? meta.showLog.slice() : [];
        var key = res.showId || res.name;
        var existing = log.find(function (e) { return e.show === key; });
        var entry = { show: key, name: res.name, score: r.score, rank: r.rank, premium: r.premium, category: r.category, seenAt: Date.now() };
        var changed = false;
        if (existing) { if (existing.score !== r.score || existing.rank !== r.rank) { Object.assign(existing, entry); changed = true; } }
        else { log.push(entry); changed = true; }
        var prev = Number(meta.confBest) || 0;
        if (HRLib.recordLowScore(meta, r.score, Math.max(r.score, prev), 'show results', false, state.horseInfo && state.horseInfo[r.life], { date: '', event: res.name.slice(0, 90) })) changed = true;
        if (r.score > prev) {
          meta.confBest = r.score; meta.confBestAt = Date.now(); meta.confBestDate = ''; meta.confBestEvent = res.name.slice(0, 90);
          raisedCount++; changed = true;
          names.push((state.horseInfo[r.life] && state.horseInfo[r.life].name) || ('#' + r.life));
        }
        if (!changed) return;
        meta.showLog = log.slice(-40);
        state.horseMeta[r.life] = meta;
        saved++;
      });
      if (!saved) return;
      HRLib.refreshBreedTotals(state);
      HRStorage.setState(state, function () {
        showToast('HR Ledger: ' + saved + ' show score' + (saved === 1 ? '' : 's') + ' saved' + (raisedCount ? ' (' + raisedCount + ' new best)' : ''));
      });
    });
  }
  if (typeof window !== 'undefined' && window.__HR_TEST__) window.__hrTest = { scrapeShowResults: scrapeShowResults, readShowResults: readShowResults, renderFitBanner: renderFitBanner };

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
    var observer = new MutationObserver(observerDebounce(function () {
      if (tryCapture()) observer.disconnect();
    }));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  function healOwnedStubs() {
    HRStorage.getState(function (state) {
      var btChanged = HRLib.refreshBreedTotals(state) + HRLib.dedupeFoals(state) + HRLib.purgeIgnored(state);
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
  // false once the extension has been reloaded under an already-open tab (the mobile build has no such check)
  function storageAlive() { return typeof HRStorage.alive !== 'function' || HRStorage.alive(); }
  var PENDING_KEY = 'hrPendingCoverings';
  function readPendingCoverings(cb) {
    if (!storageAlive()) return;
    try { chrome.storage.local.get(PENDING_KEY, function (res) { cb(Array.isArray(res[PENDING_KEY]) ? res[PENDING_KEY] : []); }); } catch (e) { /* extension was reloaded */ }
  }
  function writePendingCoverings(list, cb) {
    if (!storageAlive()) return;
    var o = {}; o[PENDING_KEY] = list;
    try { chrome.storage.local.set(o, cb || function () {}); } catch (e) { /* extension was reloaded */ }
  }
  // The mare's Info tab, "Pregnancy" panel: "Covered 1 day ago" with "Sire: <stallion>". Read it for the
  // covering's date and sire, and make sure the ledger has that covering.
  function deepFindLeavesMatching(re, root, out) {
    root = root || document;
    out = out || [];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && re.test((el.textContent || '').trim())) out.push(el);
      if (el.shadowRoot) deepFindLeavesMatching(re, el.shadowRoot, out);
    }
    return out;
  }
  var lastCoveredSig = '', lastCoveredAt = 0;
  function scrapeCoveredPanel() {
    var life = parseHorseIdFromUrl();
    if (!life || Date.now() - lastCoveredAt < 3000) return;
    lastCoveredAt = Date.now();
    var re = /^Covered (a|an|[0-9]+) (second|minute|hour|day)s? ago$/i;
    var hit = deepFindLeavesMatching(re)[0];
    if (!hit) return;
    var m = re.exec((hit.textContent || '').trim());
    var n = /^an?$/i.test(m[1]) ? 1 : parseInt(m[1], 10);
    var d = new Date();
    if (/day/i.test(m[2])) d.setDate(d.getDate() - n);
    var date = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    // the sire is named in the same panel
    var box = hit, sireA = null;
    for (var up = 0; up < 6 && box && !sireA; up++) {
      box = box.parentElement || (box.getRootNode && box.getRootNode().host) || null;
      if (box && /Sire/i.test(box.textContent || '')) {
        var links = box.querySelectorAll('a');
        for (var k = 0; k < links.length; k++) if (lifeNumberFromUrl(links[k].href) && lifeNumberFromUrl(links[k].href) !== life) { sireA = links[k]; break; }
      }
    }
    var sireLife = sireA ? lifeNumberFromUrl(sireA.href) : '';
    var sireName = sireA ? parseHorseNameHeader(sireA.textContent) : '';
    var sig = [life, date, sireLife].join('|');
    if (sig === lastCoveredSig) return;
    HRStorage.getState(function (state) {
      var info = state.horseInfo[life];
      if (!info) return; // wait until the horse has been saved
      info.coveredInfo = { date: date, sireName: sireName, sireLife: sireLife, seenAt: Date.now() };
      var res = HRLib.recordCoveringFromPage(state, { mareLife: life, mareName: info.name || '', sireLife: sireLife, sireName: sireName, date: date });
      lastCoveredSig = sig;
      HRStorage.setState(state, function () {
        if (res === 'added') showToast('HR Ledger: recorded ' + (info.name || 'her') + ' as covered' + (sireName ? ' by ' + sireName : ''));
      });
    });
  }

  // Horse Reality shows a horse's state as pills in its picture (<hr-status-pill status="covered">).
  // They are saved on the horse (statusPills + when they were seen) so the ledger can show a mare as
  // covered or in foal straight from the site, even when it never recorded the breeding itself.
  var lastPillSig = '', lastPillAt = 0;
  function scrapeStatusPills() {
    var id = parseHorseIdFromUrl();
    if (!id || Date.now() - lastPillAt < 3000) return;
    lastPillAt = Date.now();
    if (!deepQuery('#name')) return; // wait until the horse's header has drawn
    var pills = deepQueryAll('hr-status-pill').map(function (el) { return String(el.getAttribute('status') || '').toLowerCase(); }).filter(Boolean).sort();
    var sig = id + ':' + pills.join(',');
    if (sig === lastPillSig) return;
    HRStorage.getState(function (state) {
      var info = state.horseInfo[id];
      if (!info) { info = { lifeNumber: id }; state.horseInfo[id] = info; }
      info.statusPills = pills;
      info.statusPillsAt = Date.now();
      lastPillSig = sig;
      // your own horse showing a Retired pill: mark it Retired in the ledger
      var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      if (me && String(info.ownerName || '').trim().toLowerCase() === me && pills.some(function (p) { return p.indexOf('retire') > -1; })) HRLib.recordRetired(state, id);
      HRStorage.setState(state);
    });
  }

  // The Breed page's mare dropdown: mares you have covered, or that are in foal, say so in the list.
  // The option's own text is kept in data-hr-name; the page only reads the option's value.
  var lastAnnotateAt = 0;
  function annotateBreedDropdown() {
    var select = document.getElementById('secondhorse');
    if (!select) return;
    if (Date.now() - lastAnnotateAt < 4000) return;
    lastAnnotateAt = Date.now();
    HRStorage.getState(function (state) {
      for (var i = 0; i < select.options.length; i++) {
        var opt = select.options[i];
        if (!opt.value) continue;
        if (!opt.hasAttribute('data-hr-name')) opt.setAttribute('data-hr-name', (opt.textContent || '').trim());
        var base = opt.getAttribute('data-hr-name');
        var st = HRLib.mareBreedStatus(state, opt.value);
        var label = st.status === 'pregnant' ? '  \u2014  \u2665 IN FOAL' + (st.due ? ' (' + st.due.replace(/^Due /, 'due ') + ')' : '')
          : st.status === 'covered' ? '  \u2014  \u2714 COVERED' + (st.stallion ? ' by ' + st.stallion : '') : '';
        var misses = st.status ? HRLib.goalMisses(state, opt.value) : [];
        if (misses.length) label += '  \u2014  \u26a0 BELOW GOALS (' + misses.join(', ') + ')';
        var text = base + label;
        if (opt.textContent !== text) opt.textContent = text;
        opt.style.fontWeight = label ? '700' : '';
        opt.style.color = misses.length ? '#b3261e' : st.status === 'pregnant' ? '#b0407a' : st.status === 'covered' ? '#a06a00' : '';
      }
    });
  }

  // Links on the Breed page to each parent's own page: the chosen mare (follows the dropdown) and the stallion.
  function addBreedParentLinks() {
    var select = document.getElementById('secondhorse');
    if (!select || !select.parentElement) return;
    var box = document.getElementById('hr-parent-links');
    if (!box) {
      box = document.createElement('span');
      box.id = 'hr-parent-links';
      box.style.cssText = 'margin-left:12px;font-size:13px;';
      var a = document.createElement('a');
      a.id = 'hr-mare-link'; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Open mare \u2197';
      var b = document.createElement('a');
      b.id = 'hr-stallion-link'; b.target = '_blank'; b.rel = 'noopener'; b.textContent = 'Open stallion \u2197'; b.style.marginLeft = '12px';
      box.appendChild(a); box.appendChild(b);
      select.parentElement.appendChild(box);
    }
    var mare = document.getElementById('hr-mare-link'), stal = document.getElementById('hr-stallion-link');
    if (select.value) { mare.href = 'https://www.horsereality.com/horses/' + select.value + '/'; mare.style.display = ''; }
    else { mare.removeAttribute('href'); mare.style.display = 'none'; }
    var btn = document.querySelector('button.breedmare');
    var parts = location.pathname.split('/').filter(Boolean);
    var stallionLife = (btn && btn.getAttribute('lang')) || (parts[0] === 'breed' ? parts[1] : '');
    if (stallionLife) { stal.href = 'https://www.horsereality.com/horses/' + stallionLife + '/'; stal.style.display = ''; }
    else stal.style.display = 'none';
  }

  // ---- stud terms: what it costs to breed to a stallion ----
  // 1) The stallion's own page has "Public Stud Service" / "Private Stud Service" (and any semen) boxes, each
  //    with a price row: HRC, Delta Points, Foundation and Wildlife tickets (a greyed price is not offered).
  // 2) His Breed page states the owner, the transport fee ("An additional transport fee of 1000 HRC ...") and
  //    the cheapest price per currency as radio buttons. Both are saved on the stallion (horseMeta[life].studTerms).
  var CURRENCY_NAMES = { 'hrc': 'HRC', 'delta points': 'DP', 'dp': 'DP', 'foundation tickets': 'FT', 'ft': 'FT', 'wildlife tickets': 'WT', 'wt': 'WT' };
  function currencyCode(name) { return CURRENCY_NAMES[String(name || '').trim().toLowerCase()] || ''; }
  function toAmount(text) { var n = parseInt(String(text || '').replace(/[^0-9]/g, ''), 10); return isNaN(n) ? 0 : n; }
  function parseBreedPageTerms(area) {
    var text = (area.textContent || '').replace(/\s+/g, ' ');
    var cheapest = {};
    area.querySelectorAll('input[name="price"]').forEach(function (inp) {
      var code = currencyCode(inp.value);
      var label = inp.closest('label') || inp.parentElement;
      var amt = toAmount(label ? label.textContent : '');
      if (code && amt) cheapest[code] = amt;
    });
    if (!Object.keys(cheapest).length) return null; // your own stud, or no price shown
    var terms = { cheapest: cheapest, transport: 0, transportCurrency: 'HRC', owner: '' };
    var tm = /transport fee of ([0-9\s\u00a0]+?)\s*(HRC|DP|FT|WT|Delta Points|Foundation Tickets|Wildlife Tickets)/i.exec(text);
    if (tm) { terms.transport = toAmount(tm[1]); terms.transportCurrency = currencyCode(tm[2]) || 'HRC'; }
    var owner = area.querySelector('a[href*="/user/"]');
    if (owner) terms.owner = (owner.textContent || '').trim();
    return terms;
  }
  function parseStudFrames() {
    var out = {}, found = false;
    deepQueryAll('.component.frame').forEach(function (fr) {
      var titleEl = fr.querySelector('.title');
      var title = titleEl ? (titleEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
      var row = fr.querySelector('tr.market-item-price');
      if (!title || !row) return;
      var key = /private/i.test(title) ? 'private' : /semen|vial/i.test(title) ? 'semen' : /stud/i.test(title) ? 'public' : '';
      if (!key) return;
      var prices = {};
      [['hrc', 'HRC'], ['dp', 'DP'], ['ft', 'FT'], ['wt', 'WT']].forEach(function (p) {
        var td = row.querySelector('td.item-price-' + p[0]);
        if (td && !td.classList.contains('disabled')) { var n = toAmount(td.textContent); if (n) prices[p[1]] = n; }
      });
      out[key] = prices;
      found = true;
      var o = fr.querySelector('a[href*="/user/"]');
      if (o) out.owner = (o.textContent || '').trim();
    });
    return found ? out : null;
  }
  var lastTermsSig = '', lastTermsAt = 0;
  function scrapeStudTerms() {
    if (Date.now() - lastTermsAt < 2000) return;
    lastTermsAt = Date.now();
    var parts = location.pathname.split('/').filter(Boolean);
    var onBreedPage = parts[0] === 'breed' && parts[1];
    var life = onBreedPage ? parts[1] : parseHorseIdFromUrl();
    if (!life) return;
    var found = null;
    if (onBreedPage) {
      var area = document.querySelector('.breeding');
      found = area ? parseBreedPageTerms(area) : null;
    } else {
      found = parseStudFrames();
    }
    if (!found) return;
    var sig = life + ':' + JSON.stringify(found);
    if (sig === lastTermsSig) return;
    HRStorage.getState(function (state) {
      if (onBreedPage) {
        var meta = state.horseMeta[life] = Object.assign({}, state.horseMeta[life]);
        meta.studTerms = Object.assign({}, meta.studTerms, found, { seenAt: toIsoDate(Date.now()) });
      } else {
        // the stud boxes on his own page: his Public / Private fee fields are filled in from them
        HRLib.applyStudFrames(state, life, found);
      }
      lastTermsSig = sig;
      HRStorage.setState(state, function () { showToast('HR Ledger: stud fees saved for this stallion'); });
    });
  }

  // Your own stud offers: the market office page "My Studs" (/market/office/my-studs). Its Overview lists one
  // row per offer (a link to /market/studs-and-semen/<life number>, the name, and a price row with HRC, Delta
  // Points, Foundation and Wildlife prices; greyed = not offered). With the "Private" switch off it shows your
  // public offers; switched on it shows your private offers ("To 4 players"). Because these are YOUR offers they
  // prove the stallion is yours. Several offers for one stallion: the lowest price per currency is kept.
  var lastMyStudsSig = '', lastMyStudsAt = 0;
  function scrapeMyStuds() {
    if (location.pathname.indexOf('/market/office/my-studs') === -1 || /\/(edit|create)/.test(location.pathname)) return;
    if (Date.now() - lastMyStudsAt < 2000) return;
    lastMyStudsAt = Date.now();
    var rows = deepQueryAll('.market-office-table-row-outer');
    if (!rows.length) return;
    var toggle = deepQuery('#checkboxForshow_private');
    var privateView = !!(toggle && toggle.checked);
    var found = {};
    rows.forEach(function (row) {
      var link = row.querySelector('a[href*="/market/studs-and-semen/"]');
      var m = link ? /studs-and-semen\/([0-9]+)/.exec(link.href) : null;
      var priceRow = row.querySelector('tr.market-item-price');
      if (!m || !priceRow) return;
      var life = m[1];
      var nameA = row.querySelector('.market-office-table-row-horse-info a');
      var prices = {};
      [['hrc', 'HRC'], ['dp', 'DP'], ['ft', 'FT'], ['wt', 'WT']].forEach(function (p) {
        var td = priceRow.querySelector('td.item-price-' + p[0]);
        if (td && !td.classList.contains('disabled')) { var n = toAmount(td.textContent); if (n) prices[p[1]] = n; }
      });
      var isPrivate = privateView || /\bTo\s+[0-9]+\s+players?\b/i.test(row.textContent || '');
      var entry = found[life] = found[life] || { name: nameA ? parseHorseNameHeader(nameA.textContent) : '' };
      var key = isPrivate ? 'private' : 'public';
      var into = entry[key] = entry[key] || {};
      Object.keys(prices).forEach(function (c) { into[c] = into[c] ? Math.min(into[c], prices[c]) : prices[c]; });
    });
    var lives = Object.keys(found);
    if (!lives.length) return;
    var sig = (privateView ? 'private:' : 'public:') + JSON.stringify(found);
    if (sig === lastMyStudsSig) return;
    HRStorage.getState(function (state) {
      var n = 0;
      lives.forEach(function (life) {
        var f = found[life];
        // an offer of yours: the stallion is yours, so add him or promote an outside-stud entry
        var res = HRStorage.upsertStallionByMatch(state, { name: f.name, lifeNumber: life });
        promoteStubStallion(state, res.id);
        var frames = {};
        if (f.public) frames.public = f.public;
        if (f.private) frames.private = f.private;
        if (HRLib.applyStudFrames(state, life, frames) || res.created) n++;
      });
      lastMyStudsSig = sig;
      HRStorage.setState(state, function () {
        if (n) showToast('HR Ledger: ' + (privateView ? 'private' : 'public') + ' stud fees saved for ' + n + ' of your stallion' + (n === 1 ? '' : 's'));
      });
    });
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
        mareName: parseHorseNameHeader(opt ? (opt.getAttribute('data-hr-name') || opt.textContent) : ''),
        stallionLife: stallionLife,
        stallionName: parseHorseNameHeader(stallionTop ? stallionTop.textContent : ''),
        at: Date.now()
      };
      // the price option ticked on a stallion that is not yours (HRC, Delta Points, ...) and the transport fee
      var chosen = document.querySelector('input[name="price"]:checked');
      if (chosen) {
        var chosenLabel = chosen.closest('label') || chosen.parentElement;
        covering.price = toAmount(chosenLabel ? chosenLabel.textContent : '');
        covering.currency = currencyCode(chosen.value) || 'HRC';
        var tfm = /transport fee of ([0-9\s\u00a0]+?)\s*(HRC|DP|FT|WT|Delta Points|Foundation Tickets|Wildlife Tickets)/i.exec((document.querySelector('.breeding') || document.body).textContent.replace(/\s+/g, ' '));
        covering.transport = tfm ? toAmount(tfm[1]) : 0;
        var ownerLink = (document.querySelector('.breeding') || document).querySelector('a[href*="/user/"]');
        covering.studOwner = ownerLink ? (ownerLink.textContent || '').trim() : '';
      }
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
      // never record a stallion as the mare, or a horse as bred to itself
      var mi = state.horseInfo && state.horseInfo[c.mareLife];
      if ((mi && mi.sex === 'stallion') || String(c.mareLife) === String(c.stallionLife)) return;
      var sid = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: c.stallionLife, stallionName: c.stallionName });
      if (!sid) sid = HRStorage.upsertStallionByMatch(state, { name: c.stallionName, lifeNumber: c.stallionLife, owned: false }).id;
      HRStorage.upsertBreeding(state, sid, {
        mareName: c.mareName, mareLifeNumber: c.mareLife, mareUrl: horseProfileUrl(c.mareLife),
        breederName: state.settings.myUsername || '', breederUrl: '',
        price: c.price > 0 ? c.price : null, currency: c.currency || 'HRC', feeType: 'Public',
        transport: c.transport || 0, studOwner: c.studOwner || '', feeSource: c.price > 0 ? 'breed page' : '',
        date: toIsoDate(c.at || Date.now()), coveredAt: c.at || Date.now(), status: 'Pending'
      });
      HRStorage.setState(state, function () {
        showToast('HR Ledger: breeding recorded for ' + (c.mareName || ('#' + c.mareLife)) + (c.price > 0 ? ' (fee ' + c.price + ' ' + (c.currency || 'HRC') + (c.transport ? ' + ' + c.transport + ' transport' : '') + ')' : ''));
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
    var observer = new MutationObserver(observerDebounce(function () {
      if (tryCapture()) observer.disconnect();
    }));
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  // The mare's "Foals" tab: a table with the columns Horse | Name | Sire | Owner | Breeder | Status,
  // one row per foal. The Name cell holds the foal's link and its score line ("2G|7A|3BA|569|63|69.499",
  // the last number is its score). Found by the header words rather than by class names, and the page
  // is searched inside open shadow roots too.
  function deepFindAllText(text, root, out) {
    root = root || document;
    out = out || [];
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.children.length === 0 && (el.textContent || '').trim() === text) out.push(el);
      if (el.shadowRoot) deepFindAllText(text, el.shadowRoot, out);
    }
    return out;
  }
  function readFoalsTable() {
    // the header cell "Sire" whose row also has "Name" and "Breeder" cells
    var headRow = null, heads = null;
    deepFindAllText('Sire').forEach(function (el) {
      if (headRow || !el.parentElement) return;
      var h = Array.prototype.slice.call(el.parentElement.children).map(function (c) { return (c.textContent || '').trim(); });
      if (h.indexOf('Name') > -1 && h.indexOf('Breeder') > -1) { headRow = el.parentElement; heads = h; }
    });
    if (!headRow) return null;
    var sireIdx = heads.indexOf('Sire'), nameIdx = heads.indexOf('Name');
    var rowEls;
    var section = headRow.parentElement;
    if (section && section.tagName === 'THEAD') rowEls = Array.prototype.slice.call(section.parentElement.querySelectorAll('tbody tr'));
    else rowEls = Array.prototype.slice.call(section ? section.children : []).filter(function (r) { return r !== headRow; });
    var out = [];
    rowEls.forEach(function (row) {
      var cells = row.children;
      if (cells.length <= Math.max(sireIdx, nameIdx)) return;
      function horseLink(cell) {
        var links = cell.querySelectorAll('a');
        for (var i = 0; i < links.length; i++) if (lifeNumberFromUrl(links[i].href)) return links[i];
        return null;
      }
      var foalA = horseLink(cells[nameIdx]);
      if (!foalA) return;
      var sireA = horseLink(cells[sireIdx]);
      var tag = (cells[nameIdx].textContent || '').replace(/\s+/g, ' ').trim();
      var m = /([0-9]+(?:\.[0-9]+)?)\s*$/.exec(tag);
      out.push({
        foalLife: lifeNumberFromUrl(foalA.href), foalName: parseHorseLabel(foalA),
        sireLife: sireA ? lifeNumberFromUrl(sireA.href) : '', sireName: sireA ? parseHorseLabel(sireA) : (cells[sireIdx].textContent || '').trim(),
        score: m ? parseFloat(m[1]) : 0
      });
    });
    return out;
  }
  var lastFoalsSig = '', lastFoalsAt = 0;
  function scrapeFoalsTab() {
    var damLife = parseHorseIdFromUrl();
    if (!damLife || Date.now() - lastFoalsAt < 2000) return;
    lastFoalsAt = Date.now();
    var rows = readFoalsTable();
    if (!rows || !rows.length) return;
    var sig = damLife + ':' + rows.map(function (r) { return r.foalLife + ':' + r.score; }).join(',');
    if (sig === lastFoalsSig) return;
    HRStorage.getState(function (state) {
      var n = HRLib.recordFoalsFromList(state, damLife, rows);
      if (n < 0) return; // not one of your mares (or not cached yet): try again later
      lastFoalsSig = sig;
      if (n > 0) HRStorage.setState(state, function () { showToast('HR Ledger: ' + n + ' foal' + (n === 1 ? '' : 's') + ' added to her history'); });
    });
  }

  // An "Open in Ledger" pill on every horse page, inside the horse's picture box in the top-left
  // corner, styled like the site's own status pills. It goes beside those pills ("Covered",
  // "Stud or semen", ...) when the page has them; when it doesn't, it is placed in the same
  // corner of the picture itself. Only if the picture box can't be found is a plain vertical
  // tab drawn on the right edge of the screen. On desktop the click asks the extension to open (or focus) the dashboard
  // on this horse's profile; on mobile it opens the on-page overlay.
  var LEDGER_BTN_ID = 'hr-ledger-open-btn';
  var LEDGER_PILL_ID = 'hr-ledger-open-pill';
  // which version of the extension is running on this page (shown in the button's tooltip and the console)
  var LEDGER_VERSION = '';
  try { LEDGER_VERSION = chrome.runtime.getManifest().version; } catch (e) {}
  try { console.info('HR Ledger content script v' + (LEDGER_VERSION || '?')); } catch (e) {}
  var areaFailed = false, pillHiddenTicks = 0;
  // The horse page's content can live inside open shadow roots, where document.querySelector
  // can't see it, so these search the page and every open shadow root below it.
  function deepQuery(selector, root) {
    root = root || document;
    var hit = root.querySelector(selector);
    if (hit) return hit;
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) {
        hit = deepQuery(selector, all[i].shadowRoot);
        if (hit) return hit;
      }
    }
    return null;
  }
  function deepQueryAll(selector, root) {
    root = root || document;
    var out = Array.prototype.slice.call(root.querySelectorAll(selector));
    var all = root.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      if (all[i].shadowRoot) out = out.concat(deepQueryAll(selector, all[i].shadowRoot));
    }
    return out;
  }
  function openInLedger(id) {
    if (window.HRMobileOverlay && window.HRLedgerOpenProfile) {
      window.HRMobileOverlay.show();
      window.HRLedgerOpenProfile(id);
      return;
    }
    chrome.runtime.sendMessage({ type: 'HR_OPEN_PROFILE', life: id }, function () { void chrome.runtime.lastError; });
  }
  function removeLedgerButton() {
    deepQueryAll('#' + LEDGER_PILL_ID + ', #' + LEDGER_BTN_ID).forEach(function (el) { el.remove(); });
  }
  function injectLedgerButton() {
    var life = parseHorseIdFromUrl();
    if (!life) { removeLedgerButton(); return; }

    // 1) in the picture's status-pill area (top-left), or 2) in that corner of the picture itself
    var area = areaFailed ? null : deepQuery('div.horse-status');
    var picture = deepQuery('#top');
    var home = area || picture;
    if (home) {
      document.querySelectorAll('#' + LEDGER_BTN_ID).forEach(function (el) { el.remove(); });
      var pill = deepQuery('#' + LEDGER_PILL_ID);
      if (pill && pill.parentNode === home) {
        pill.setAttribute('data-life', life);
        // the status area can exist but draw nothing; if our pill is invisible there, use the picture corner
        if (area && pill.getBoundingClientRect().width === 0) {
          if (++pillHiddenTicks >= 3) { areaFailed = true; pill.remove(); }
        } else {
          pillHiddenTicks = 0;
        }
        return;
      }
      if (pill) pill.remove();
      pill = document.createElement('button');
      pill.id = LEDGER_PILL_ID;
      pill.type = 'button';
      pill.title = 'Open this horse in HR Stallion & Mare Ledger' + (LEDGER_VERSION ? ' (v' + LEDGER_VERSION + ')' : '');
      pill.setAttribute('data-life', life);
      var dot = document.createElement('span');
      dot.style.cssText = 'width:9px;height:9px;border-radius:50%;background:#46592C;display:inline-block;';
      pill.appendChild(dot);
      pill.appendChild(document.createTextNode('Open in Ledger'));
      pill.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:7px', 'height:32px', 'padding:0 14px',
        'border-radius:999px', 'border:1px solid rgba(255,255,255,.7)', 'background:rgba(255,255,255,.88)',
        'color:#081b28', 'font:500 13px Roboto,system-ui,sans-serif', 'cursor:pointer',
        'box-shadow:0 1px 4px rgba(0,0,0,.25)', 'white-space:nowrap'
      ].concat(area ? ['margin:0 0 0 8px'] : ['position:absolute', 'left:16px', 'top:16px', 'z-index:5', 'margin:0']).join(';');
      pill.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        openInLedger(pill.getAttribute('data-life'));
      });
      if (!area && window.getComputedStyle(picture).position === 'static') picture.style.position = 'relative';
      home.appendChild(pill);
      return;
    }
    deepQueryAll('#' + LEDGER_PILL_ID).forEach(function (el) { el.remove(); });

    // 3) no picture box found: a vertical tab on the right edge of the screen
    var edge = document.getElementById(LEDGER_BTN_ID);
    if (edge) { edge.setAttribute('data-life', life); return; }
    var host = document.body || document.documentElement;
    if (!host) return;
    edge = document.createElement('button');
    edge.id = LEDGER_BTN_ID;
    edge.type = 'button';
    edge.textContent = 'Open in Ledger';
    edge.title = 'Open this horse in HR Stallion & Mare Ledger' + (LEDGER_VERSION ? ' (v' + LEDGER_VERSION + ')' : '') + ' \u2014 edge tab: the picture box was not found on this page';
    edge.setAttribute('data-life', life);
    edge.style.cssText = [
      'position:fixed', 'right:0', 'top:38%', 'z-index:2147483000', 'cursor:pointer',
      'background:#46592C', 'color:#fff', 'border:none', 'border-radius:10px 0 0 10px',
      'padding:16px 9px', 'writing-mode:vertical-rl', 'text-orientation:mixed',
      'font:600 14px system-ui,sans-serif', 'letter-spacing:.03em',
      'box-shadow:-2px 2px 10px rgba(0,0,0,.3)'
    ].join(';');
    edge.addEventListener('click', function () { openInLedger(edge.getAttribute('data-life')); });
    host.appendChild(edge);
  }

  function onPageReady() {
    scheduleFit();
    scheduleMarket();
    scheduleRanch();
    scheduleStudCache();
    scheduleBidScan();
    scheduleSales();
    checkPendingRetire();
    scrapeTradePage();
    var refTrade = parseHorseIdFromUrl() && /\/market\/trade\/(\d+)/.exec(document.referrer || '');
    if (refTrade) rememberTrade(refTrade[1], parseHorseIdFromUrl());
    injectLedgerButton();
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
  var tickTimer = setInterval(function () {
    // after the extension is reloaded or updated this old copy of the script is orphaned: stop quietly
    if (!storageAlive()) { clearInterval(tickTimer); return; }
    injectLedgerButton(); // put it back if the site's own scripts removed it
    scrapeFoalsTab();
    scrapeStatusPills();
    scrapeCoveredPanel();
    scrapeStudTerms();
    scrapeMyStuds();
    annotateBreedDropdown();
    addBreedParentLinks();
    scrapeShowResults();
    annotateShowEntry();
    scrapeCompetitionResults();
    scrapeCompetitionStats();
    scrapeAgeFromProfile();
    if (location.href !== lastHref) {
      lastHref = location.href;
      onPageReady();
    }
  }, 1000);
})();
