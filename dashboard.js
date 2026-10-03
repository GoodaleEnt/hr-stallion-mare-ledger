(function () {
  'use strict';
  var L = HRLib;

  var state = HRStorage.defaultState();
  var allBreedingsFlat = [];
  var aggregates = {};
  var uniqueMareCount = 0;
  var maresIndex = [];
  var activeTab = 'stallions';
  var selectedId = null;
  var selectedMareKey = null;
  var selectedPassportLife = null;
  var horseSearchQuery = '';
  var addingStallion = false;
  var editingStallion = false;
  var addingBreeding = false;
  var importingBreeding = false;
  var importError = '';
  var pendingConfirm = null;
  var showArchive = false;
  var herdRoleFilter = '';
  var herdProjectFilter = '';
  var calcMare = '';
  var calcStallion = '';

  // ---------- derived data ----------
  function recompute() {
    allBreedingsFlat = HRStorage.allBreedingsFlat(state);

    aggregates = {};
    state.stallions.forEach(function (s) { aggregates[s.id] = { count: 0, totals: {} }; });
    allBreedingsFlat.forEach(function (b) {
      var agg = aggregates[b.stallionId];
      if (!agg) return;
      agg.count++;
      var cur = b.currency || 'HRC';
      agg.totals[cur] = (agg.totals[cur] || 0) + (Number(b.price) || 0);
    });

    var mareKeys = {};
    allBreedingsFlat.forEach(function (b) { if (b.mareName) mareKeys[L.mareKey(b)] = true; });
    uniqueMareCount = Object.keys(mareKeys).length;

    // The Mares tab is scoped to mares YOU own — most mares that show up in
    // your stallions' breeding records belong to customers who paid to use
    // your stud, not to you. "Owner" here is the record's breederName field,
    // matched against the username you've entered in settings.
    var myName = (state.settings.myUsername || '').trim().toLowerCase();
    var map = {};
    if (myName) {
      allBreedingsFlat.forEach(function (b) {
        if (!b.mareName) return;
        if ((b.breederName || '').trim().toLowerCase() !== myName) return;
        // Older versions recorded any pregnant mare you viewed as yours; trust
        // the owner Horse Reality reports for her when we have it.
        var mareInfo = b.mareLifeNumber && state.horseInfo && state.horseInfo[b.mareLifeNumber];
        if (mareInfo && mareInfo.ownerName && mareInfo.ownerName.trim().toLowerCase() !== myName) return;
        var key = L.mareKey(b);
        if (!map[key]) {
          map[key] = { key: key, mareName: b.mareName, mareUrl: b.mareUrl, mareLifeNumber: b.mareLifeNumber, records: [] };
        }
        if (b.mareUrl) map[key].mareUrl = b.mareUrl;
        map[key].records.push(b);
      });

      // Also surface owned mares that haven't been bred yet — content.js
      // caches every horse you view (regardless of ownership) into
      // state.horseInfo, so any cached mare whose owner matches you shows
      // up here immediately, with an empty ledger until her first breeding.
      Object.keys(state.horseInfo || {}).forEach(function (lifeNumber) {
        var info = state.horseInfo[lifeNumber];
        if (!info || info.sex !== 'mare') return;
        if ((info.ownerName || '').trim().toLowerCase() !== myName) return;
        var key = 'life:' + lifeNumber;
        if (!map[key]) {
          map[key] = { key: key, mareName: info.name, mareUrl: 'https://www.horsereality.com/horses/' + lifeNumber + '/', mareLifeNumber: lifeNumber, records: [] };
        } else if (!map[key].mareName) {
          map[key].mareName = info.name;
        }
      });
    }
    maresIndex = Object.keys(map).map(function (k) { return map[k]; })
      .filter(function (m) { return isAdultHorse(m.mareLifeNumber); });
    maresIndex.forEach(function (m) {
      m.records.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var counts = { Pending: 0, Succeeded: 0, Failed: 0 };
      counts['Foal Born'] = 0;
      m.records.forEach(function (r) { var st = r.status || 'Pending'; counts[st] = (counts[st] || 0) + 1; });
      m.counts = counts;
    });
    maresIndex.sort(function (a, b) { return (a.mareName || '').localeCompare(b.mareName || ''); });
  }

  function persist(cb) {
    HRStorage.setState(state, function () {
      recompute();
      render();
      if (cb) cb();
    });
  }

  function findExistingBreeding(targetId, rowLike) {
    var key = L.breedingMatchKey(rowLike);
    return allBreedingsFlat.find(function (b) { return b.stallionId === targetId && L.breedingMatchKey(b) === key; });
  }

  // ---------- mutations ----------
  function addStallion(data) {
    data.id = L.uid();
    data.createdAt = Date.now();
    if (!data.status) data.status = 'Active';
    state.stallions.unshift(data);
    state.breedings[data.id] = [];
    persist();
  }
  function updateStallionRec(id, data) {
    var s = state.stallions.find(function (x) { return x.id === id; });
    if (s) Object.assign(s, data);
    persist();
  }
  function deleteStallionRec(id) {
    state.stallions = state.stallions.filter(function (s) { return s.id !== id; });
    delete state.breedings[id];
    persist();
  }
  function addBreeding(sid, data) {
    if (!state.breedings[sid]) state.breedings[sid] = [];
    data.id = L.uid();
    data.createdAt = Date.now();
    state.breedings[sid].push(data);
    persist();
  }
  function updateBreedingRec(sid, id, data) {
    var list = state.breedings[sid] || [];
    var b = list.find(function (x) { return x.id === id; });
    if (b) Object.assign(b, data);
    persist();
  }
  function deleteBreeding(sid, id) {
    state.breedings[sid] = (state.breedings[sid] || []).filter(function (b) { return b.id !== id; });
    persist();
  }

  function setHorseGene(lifeNumber, locus, value) {
    if (!lifeNumber || !locus) return;
    var meta = state.horseMeta[lifeNumber] = Object.assign({}, state.horseMeta[lifeNumber]);
    meta.genes = Object.assign({}, meta.genes);
    if (value) meta.genes[locus] = value; else delete meta.genes[locus];
    persist();
  }
  function setHorseMeta(lifeNumber, patch) {
    if (!lifeNumber) return;
    state.horseMeta[lifeNumber] = Object.assign({}, state.horseMeta[lifeNumber], patch);
    persist();
  }

  // ---------- confirm dialog ----------
  function askConfirm(message, onYes) {
    pendingConfirm = { message: message, onYes: onYes };
    render();
  }

  // ---------- backup / restore ----------
  // A safety net independent of "update the extension in the same folder"
  // — Chrome ties an unpacked extension's storage to its folder location,
  // so the wrong move (a new folder, or clicking Remove) can wipe it.
  // This lets a player save/restore the whole ledger regardless.
  function exportBackup() {
    var json = JSON.stringify(state, null, 2);
    var blob = new Blob([json], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'hr-ledger-backup-' + L.todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  function handleRestoreFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { alert('That file isn\'t valid JSON.'); return; }
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.stallions) || typeof parsed.breedings !== 'object') {
        alert('That doesn\'t look like an HR Ledger backup file.');
        return;
      }
      askConfirm('Restore this backup? This replaces ALL current stallions, mares, and breeding history with the backup\'s contents — this can\'t be undone.', function () {
        state = parsed;
        if (!state.horseInfo) state.horseInfo = {};
        if (!state.horseMeta) state.horseMeta = {};
        if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
        persist();
      });
    };
    reader.readAsText(file);
  }

  // ---------- render ----------
  function render() {
    var app = document.getElementById('app');
    var html;
    if (selectedPassportLife) html = renderPassportDetail();
    else if (selectedId) html = renderDetail();
    else if (selectedMareKey) html = renderMareDetail();
    else if (activeTab === 'mares') html = renderMaresList();
    else if (activeTab === 'young') html = renderYoungList();
    else if (activeTab === 'herd') html = renderHerdList();
    else if (activeTab === 'others') html = renderOthersList();
    else if (activeTab === 'calc') html = renderCalculator();
    else html = renderStallionsList();
    app.innerHTML = html;
    if (pendingConfirm) {
      var wrap = document.createElement('div');
      wrap.innerHTML = renderConfirm();
      app.appendChild(wrap.firstElementChild);
    }
    wireEvents();
  }

  function renderConfirm() {
    return '<div class="overlay" data-role="overlay">' +
      '<div class="confirm-box">' +
        '<p>' + L.esc(pendingConfirm.message) + '</p>' +
        '<div class="row">' +
          '<button class="btn btn-sm" data-action="confirm-no">Cancel</button>' +
          '<button class="btn btn-sm btn-primary" style="background:var(--danger);border-color:var(--danger)" data-action="confirm-yes">Delete</button>' +
        '</div>' +
      '</div></div>';
  }

  // Looks up any horse content.js has ever cached a passport snapshot for —
  // not just ones tied to a tracked stallion or a bred mare — by name
  // (substring) or exact life number.
  function searchHorseInfo(query) {
    query = (query || '').trim().toLowerCase();
    if (!query) return [];
    return Object.keys(state.horseInfo || {})
      .map(function (life) { return Object.assign({ lifeNumber: life }, state.horseInfo[life]); })
      .filter(function (h) { return (h.name || '').toLowerCase().indexOf(query) > -1 || h.lifeNumber.indexOf(query) > -1; })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); })
      .slice(0, 8);
  }

  // Surfaced here (not just in the collapsed debug panel) because a
  // non-technical player can't be asked to open DevTools — a plain
  // screenshot of the dashboard needs to be enough to diagnose a failure.
  function apiWarningBannerHtml() {
    var diag = state.apiDiagnostics;
    if (!diag || diag.ok !== false) return '';
    var reason;
    if (!diag.csrfTokenFound) {
      reason = 'Could not find the login token this extension needs to call Horse Reality\'s API (looked for the "hr_auth_production_access_payload" cookie). Try logging out and back in to Horse Reality, then reload the extension.';
    } else if (diag.errors && diag.errors.length) {
      reason = 'The request to Horse Reality\'s API failed: ' + diag.errors.join(' | ');
    } else {
      reason = 'The API response was missing expected data.';
    }
    return '<div class="empty" style="border-color:var(--danger);text-align:left;margin-bottom:16px;">' +
      '<h3 style="color:var(--danger);">Genetics, pedigree, and pregnancy data isn\'t loading</h3>' +
      '<p>' + L.esc(reason) + '</p>' +
      '<p style="margin:0;">Basic tracking (stud fees, offspring) is unaffected. Last checked: ' + L.esc(new Date(diag.lastCheckedAt).toLocaleString()) + ' on horse #' + L.esc(diag.lastHorseId) + '.</p>' +
    '</div>';
  }

  // Pending coverings old enough (6+ days) that Horse Reality has resolved
  // them one way or another, but with no "Foal Born" record yet to prove it.
  // The stud owner never gets the failure notification for a customer's
  // mare — only she does — so this points at her page directly instead of
  // silently trusting the auto-fail sweep that runs next time content.js
  // sees a horsereality.com page.
  var REVIEW_DAYS = 6;
  function renderNeedsReviewHtml() {
    var candidates = HRLib.findReviewCandidates(state, REVIEW_DAYS);
    if (!candidates.length) return '';
    candidates.sort(function (a, b) { return b.days - a.days; });
    var html = '<div class="empty" style="border-color:#d97706;text-align:left;margin-bottom:16px;">' +
      '<h3 style="color:#d97706;">' + candidates.length + ' covering' + (candidates.length === 1 ? '' : 's') + ' ready to review</h3>' +
      '<p style="margin-top:0;">Still marked Pending ' + REVIEW_DAYS + '+ days after breeding with no foal recorded yet. Horse Reality only notifies the ' +
      '<em>mare\'s</em> owner when a covering fails, so check her page directly before this gets auto-marked Failed.</p>';
    html += '<div class="ledger">';
    candidates.forEach(function (c) {
      var b = c.breeding;
      var mareHref = L.safeUrl(b.mareUrl);
      html += '<div class="review-row">' +
        '<div class="mono" data-label="Date">' + L.fmtDate(b.date) + '</div>' +
        '<div data-label="Mare">' + L.esc(b.mareName || 'Unknown mare') + (b.mareLifeNumber ? ' <span class="mono sub">#' + L.esc(b.mareLifeNumber) + '</span>' : '') + '</div>' +
        '<div data-label="Stallion"><button type="button" class="link-btn" data-action="open-stallion" data-id="' + L.esc(c.stallionId) + '">' + L.esc(c.stallionName) + '</button></div>' +
        '<div data-label="Days pending">' + c.days + ' days</div>' +
        '<div data-label="">' + (mareHref ? '<a href="' + L.esc(mareHref) + '" target="_blank" rel="noopener noreferrer">Check her page<span class="ext">↗</span></a>' : '<span class="sub">no link captured</span>') + '</div>' +
      '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function topHeaderHtml() {
    var results = horseSearchQuery ? searchHorseInfo(horseSearchQuery) : [];
    var version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    var html = '<header class="top"><div class="titles">' +
      '<h1>HR Stallion &amp; Mare Ledger</h1>' +
      '<p>Every covering, every mare, every fee — captured as you browse.' +
      (version ? ' <span class="mono" style="color:var(--text-muted);font-size:12px;">v' + L.esc(version) + '</span>' : '') +
      '</p>' +
      '</div></header>';

    html += apiWarningBannerHtml();
    html += renderNeedsReviewHtml();

    html += '<form class="search-row" data-action="submit-search">' +
      '<input type="text" name="query" placeholder="Look up any cached horse by name or life number…" value="' + L.esc(horseSearchQuery) + '">' +
      '<button type="submit" class="btn btn-sm">Search</button>' +
      (horseSearchQuery ? '<button type="button" class="btn btn-sm btn-ghost" data-action="clear-search">Clear</button>' : '') +
    '</form>';
    if (horseSearchQuery) {
      html += '<div class="search-results">';
      if (results.length) {
        results.forEach(function (h) {
          html += '<button type="button" class="search-result" data-action="open-passport" data-life="' + L.esc(h.lifeNumber) + '">' +
            (h.imageUrl ? '<img src="' + L.esc(h.imageUrl) + '" alt="">' : '<span class="search-result-noimg"></span>') +
            '<span>' + L.esc(h.name || 'Unnamed horse') + ' <span class="mono sub">#' + L.esc(h.lifeNumber) + '</span>' + (state.horseMeta[h.lifeNumber] && state.horseMeta[h.lifeNumber].tracked ? ' <span class="tag">Other Horses</span>' : '') + '</span>' +
          '</button>';
        });
      } else {
        html += '<div class="search-empty">No cached horses match "' + L.esc(horseSearchQuery) + '" — visit that horse\'s page on Horse Reality first to cache it.</div>';
      }
      html += '</div>';
    }

    html += '<div class="tabs">' +
        '<button class="tab-btn' + (activeTab === 'stallions' ? ' active' : '') + '" data-action="show-tab" data-tab="stallions">Stallions</button>' +
        '<button class="tab-btn' + (activeTab === 'mares' ? ' active' : '') + '" data-action="show-tab" data-tab="mares">My Mares</button>' +
        '<button class="tab-btn' + (activeTab === 'young' ? ' active' : '') + '" data-action="show-tab" data-tab="young">Colts &amp; Fillies</button>' +
        '<button class="tab-btn' + (activeTab === 'herd' ? ' active' : '') + '" data-action="show-tab" data-tab="herd">My Herd</button>' +
        '<button class="tab-btn' + (activeTab === 'others' ? ' active' : '') + '" data-action="show-tab" data-tab="others">Other Horses</button>' +
        '<button class="tab-btn' + (activeTab === 'calc' ? ' active' : '') + '" data-action="show-tab" data-tab="calc">Foal Calculator</button>' +
      '</div>';
    return html;
  }

  function renderPassportDetail() {
    var info = state.horseInfo[selectedPassportLife];
    if (!info) { selectedPassportLife = null; return renderStallionsList(); }
    var href = L.safeUrl('https://www.horsereality.com/horses/' + selectedPassportLife + '/');
    var html = '<button class="back-link" data-action="close-passport">' + (activeTab === 'herd' ? '← Back to herd' : activeTab === 'others' ? '← Back to other horses' : '← Back to search') + '</button>';
    html += '<div class="detail-head"><div class="name-row">' +
      (info.imageUrl ? '<img class="portrait" src="' + L.esc(info.imageUrl) + '" alt="">' : '') +
      '<div><h1>' + L.esc(info.name || 'Unnamed horse') + '</h1>' +
      '<div class="tags">' +
        '<span class="tag mono">#' + L.esc(selectedPassportLife) + '</span>' +
        (info.breed ? '<span class="tag">' + L.esc(info.breed) + '</span>' : '') +
        passportTagsHtml(info) +
      '</div>' +
      pregnancyLineHtml(info) +
      pedigreeLineHtml(info) +
      passportOwnerHtml(info) +
      (href ? '<p class="notes-line"><a href="' + L.esc(href) + '" target="_blank" rel="noopener noreferrer">View on Horse Reality<span class="ext">↗</span></a></p>' : '') +
      renderAgeControlHtml(selectedPassportLife) +
      '</div>' +
    '</div>';
    html += herdControlsPanelHtml(selectedPassportLife);
    html += geneDetailsHtml(selectedPassportLife);
    html += purchaseDetailsHtml(selectedPassportLife);

    // A horse can already exist as a (possibly stub, owned:false) stallion
    // record even though this raw passport cache doesn't know that — link
    // through to his actual tracked record instead of just saying "not
    // tied to a breeding record" so "Mark as My Stallion" is reachable.
    var matchId = L.findStallionMatch(state.stallions, { stallionName: info.name, stallionLifeNumber: selectedPassportLife });
    if (matchId) {
      html += '<div class="empty"><h3>Already tracked</h3>' +
        '<p>This horse has a stallion record in your ledger.</p>' +
        '<button class="btn btn-primary" data-action="open-stallion" data-id="' + L.esc(matchId) + '">View his stallion record</button></div>';
    } else {
      html += '<div class="empty"><h3>Not yet tied to a breeding record</h3>' +
        '<p>This horse is cached from a page you visited, but isn\'t linked to a tracked stallion or a logged breeding yet. Once one of those exists, ' +
        'she or he will also show up on the Stallions or My Mares tab.</p></div>';
    }
    return html;
  }

  // Temporary debug aid — lets raw storage be inspected on the dashboard
  // page itself (Ctrl+F for a life number or name) without needing to find
  // the extension's service worker console.
  function renderDebugPanel() {
    var horseInfoCount = Object.keys(state.horseInfo || {}).length;
    return '<details style="margin:16px 0;font-size:12px;color:var(--text-muted);">' +
      '<summary style="cursor:pointer;">Debug: raw storage state (' + state.stallions.length + ' stallions, ' + horseInfoCount + ' cached passports)</summary>' +
      '<pre style="white-space:pre-wrap;word-break:break-all;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px;max-height:400px;overflow:auto;">' +
        L.esc(JSON.stringify(state, null, 2)) +
      '</pre></details>';
  }

  // Stallions created as a lightweight stub just to anchor a mare's
  // breeding record (a covering with someone else's stud, or a free
  // self-breeding with no bank transaction) are marked `owned: false` and
  // kept out of your own roster — their history still shows via "My
  // Mares" and the ledger tables, just not cluttering this grid.
  function isAdultHorse(lifeNumber) {
    var info = lifeNumber && state.horseInfo && state.horseInfo[lifeNumber];
    if (!info) return true;
    var months = L.effectiveAgeMonths(info);
    if (months == null) return true;
    return months >= 36;
  }
  function getOwnedStallions() {
    return state.stallions.filter(function (s) { return s.owned !== false && isAdultHorse(s.lifeNumber); });
  }

  // Cached passports (state.horseInfo) belonging to you, under 3 years old —
  // shown separately from the Stallions/My Mares tabs, which are scoped to
  // breeding-age (3yo+) horses. "Under 3" here is the effective age: a real
  // cached birthdate, or a manually tracked age for a horse HR never gave us
  // a passport birthdate for (see ageUpHorse).
  function getYoungHorses() {
    var myName = (state.settings.myUsername || '').trim().toLowerCase();
    if (!myName) return [];
    return Object.keys(state.horseInfo || {})
      .map(function (life) { return Object.assign({ lifeNumber: life }, state.horseInfo[life]); })
      .filter(function (h) {
        if (h.sex !== 'stallion' && h.sex !== 'mare') return false;
        if ((h.ownerName || '').trim().toLowerCase() !== myName) return false;
        return L.isYoungInfo(h);
      })
      .sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
  }

  // Nudges a cached horse's tracked age by +/- 6 months. The first nudge on
  // a horse with no tracked age yet starts counting from its real cached
  // birthdate (or 0 if HR never gave us one — i.e. treat it as a newborn),
  // then every further nudge just adds/subtracts another 6 months on top
  // (never below 0 — an accidental extra click just gets retracted with the
  // -6mo button rather than going negative). Once the total crosses 3 years
  // he/she drops out of Colts & Fillies and appears on the Stallions/My
  // Mares tab automatically, and vice versa if retracted back under 3.
  function adjustAgeMonths(lifeNumber, deltaMonths) {
    if (!lifeNumber) return;
    if (!state.horseInfo) state.horseInfo = {};
    var info = state.horseInfo[lifeNumber];
    if (!info) { info = {}; state.horseInfo[lifeNumber] = info; }
    var baseMonths = info.manualAgeMonths != null
      ? info.manualAgeMonths
      : Math.round((L.ageYears(info.dateOfBirth) || 0) * 12);
    info.manualAgeMonths = Math.max(0, baseMonths + deltaMonths);
    persist();
  }
  // Sets the tracked age directly from a "times aged up" count (each unit
  // is 6 months) — lets a misclick be corrected in one go instead of
  // clicking -6mo repeatedly, or the age set precisely from the start.
  function setAgeTimes(lifeNumber, times) {
    if (!lifeNumber) return;
    if (!state.horseInfo) state.horseInfo = {};
    var info = state.horseInfo[lifeNumber];
    if (!info) { info = {}; state.horseInfo[lifeNumber] = info; }
    var n = Math.max(0, Math.round(Number(times) || 0));
    info.manualAgeMonths = n * 6;
    persist();
  }

  // Age control, shown wherever a horse's age matters (young horse cards,
  // stallion/mare detail pages). Needs a life number to have somewhere in
  // state.horseInfo to store the tracked age against.
  function renderAgeControlHtml(lifeNumber) {
    if (!lifeNumber) return '';
    var info = state.horseInfo && state.horseInfo[lifeNumber];
    // Once Horse Reality's own age reading has been captured (from visiting
    // this horse's page), it's ground truth and refreshes automatically on
    // every visit — no manual controls needed, and showing them would just
    // invite an override that gets silently ignored.
    if (info && info.ageMonths != null) {
      return '<div class="row"><span>' + L.esc(info.ageText || L.formatAgeMonths(info.ageMonths)) + '</span>' +
        '<span class="sub" style="font-size:11px;">from Horse Reality</span></div>';
    }
    var months = info ? L.effectiveAgeMonths(info) : null;
    var times = months != null ? Math.round(months / 6) : 0;
    return '<div class="row" style="align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<span>' + (months != null ? L.formatAgeMonths(months) + ' (estimated)' : 'Age unknown') + '</span>' +
      '<div style="display:flex;gap:6px;align-items:center;">' +
        '<button type="button" class="btn btn-sm" data-action="age-down-horse" data-life="' + L.esc(lifeNumber) + '" title="Retract 6 months"' + (months && months > 0 ? '' : ' disabled') + '>&minus;6mo</button>' +
        '<button type="button" class="btn btn-sm" data-action="age-up-horse" data-life="' + L.esc(lifeNumber) + '" title="Ages this horse up by 6 months">+6mo</button>' +
      '</div>' +
      '<form data-action="set-age-times" data-life="' + L.esc(lifeNumber) + '" style="display:flex;gap:6px;align-items:center;">' +
        '<label style="font-size:11.5px;color:var(--text-muted);">&times; aged up</label>' +
        '<input type="number" min="0" step="1" name="times" value="' + times + '" style="width:56px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:13px;color:var(--text);">' +
        '<button type="submit" class="btn btn-sm">Set</button>' +
      '</form>' +
    '</div>';
  }

  function renderStallionsList() {
    var ownedStallions = getOwnedStallions();
    var totalBreedings = 0, totalsAll = {};
    ownedStallions.forEach(function (s) {
      var a = aggregates[s.id] || { count: 0, totals: {} };
      totalBreedings += a.count;
      L.CURRENCIES.forEach(function (c) { if (a.totals && a.totals[c]) totalsAll[c] = (totalsAll[c] || 0) + a.totals[c]; });
    });
    var totalEarnedLine = L.moneyLine(totalsAll);

    var html = topHeaderHtml();
    html += renderDebugPanel();

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + ownedStallions.length + '</div><div class="label">Stallions</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + uniqueMareCount + '</div><div class="label">Mares (all)</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + totalBreedings + '</div><div class="label">Breedings logged</div></div>' +
      '<div class="stat-tile"><div class="' + (totalEarnedLine.indexOf('·') > -1 ? 'num mono multi' : 'num mono') + '">' + totalEarnedLine + '</div><div class="label">Total earned</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Your Stallions</h2>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-sm" data-action="export-backup" title="Save your entire ledger as a JSON file">Export Backup</button>' +
        '<button class="btn btn-sm" data-action="restore-backup" title="Replace your ledger with a previously exported backup">Restore Backup</button>' +
        '<input type="file" id="restore-file-input" accept="application/json" style="display:none;">' +
        '<button class="btn btn-sm" data-action="toggle-import">' + (importingBreeding ? 'Close' : 'Import') + '</button>' +
        '<button class="btn btn-primary btn-sm" data-action="toggle-add-stallion">' + (addingStallion ? 'Close' : '+ Add Stallion') + '</button>' +
      '</div></div>';

    html += '<div class="settings-row">' +
      '<label class="settings-toggle"><input type="checkbox" data-action="toggle-auto-delete"' + (state.settings.autoDeleteRetired ? ' checked' : '') + '> Automatically delete stallions marked Retired</label>' +
      '<label class="username-setting">My Horse Reality username' +
        '<input type="text" data-action="update-username" value="' + L.esc(state.settings.myUsername) + '" placeholder="e.g. Nemoriamini">' +
      '</label>' +
      '</div>';

    if (importingBreeding) html += renderImportForm(null);
    if (addingStallion) html += renderStallionForm();

    if (ownedStallions.length === 0 && !addingStallion) {
      html += '<div class="empty"><h3>No stallions yet</h3>' +
        '<p>Browse to your bank page or a stallion\'s offspring page on Horse Reality and they\'ll appear here automatically — or add one by hand.</p>' +
        '<button class="btn btn-primary" data-action="toggle-add-stallion">+ Add Stallion</button></div>';
    } else if (ownedStallions.length) {
      html += '<div class="stallion-grid">';
      ownedStallions.forEach(function (s) {
        var a = aggregates[s.id] || { count: 0, totals: {} };
        var pubFee = L.feeObj(s, 'Public'), privFee = L.feeObj(s, 'Private');
        html += '<div class="card stallion-card" data-action="open-stallion" data-id="' + s.id + '">' +
          (s.status && s.status !== 'Active' ? '<span class="pill corner-badge ' + L.stallionStatusClass(s.status) + '">' + L.esc(s.status) + '</span>' : '') +
          (s.imageUrl ? '<img class="portrait" src="' + L.esc(s.imageUrl) + '" alt="">' : '') +
          '<h3>' + L.esc(s.name) + '</h3>' +
          (s.lifeNumber ? '<div class="lifenum mono">#' + L.esc(s.lifeNumber) + '</div>' : '') +
          '<div class="meta">' + L.esc([s.breed, s.color].filter(Boolean).join(' · ') || 'No breed set') + '</div>' +
          '<div class="row"><span>Public fee</span><span class="v fee mono">' + L.moneyLine(pubFee) + '</span></div>' +
          (L.hasAny(privFee) ? '<div class="row"><span>Private fee</span><span class="v fee mono">' + L.moneyLine(privFee) + '</span></div>' : '') +
          '<div class="row"><span>Breedings</span><span class="v mono">' + a.count + '</span></div>' +
          '<div class="row"><span>Total earned</span><span class="v mono">' + L.moneyLine(a.totals) + '</span></div>' +
          purchaseRowsHtml(s.lifeNumber) +
          '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderStallionForm(prefill) {
    prefill = prefill || {};
    return '<form class="card panel" data-action="submit-stallion" data-mode="' + (prefill.id ? 'edit' : 'add') + '" data-id="' + (prefill.id || '') + '">' +
      '<div class="field"><label for="f-name">Name</label><input id="f-name" name="name" required placeholder="Midnight&#39;s Shadow" value="' + L.esc(prefill.name) + '"></div>' +
      '<div class="field"><label for="f-lifenumber">Life number</label><input id="f-lifenumber" name="lifeNumber" placeholder="1507449" value="' + L.esc(prefill.lifeNumber) + '"></div>' +
      '<div class="field"><label for="f-breed">Breed</label><input id="f-breed" name="breed" placeholder="Akhal-Teke" value="' + L.esc(prefill.breed) + '"></div>' +
      '<div class="field"><label for="f-color">Color</label><input id="f-color" name="color" placeholder="Bay" value="' + L.esc(prefill.color) + '"></div>' +
      '<div class="field"><label for="f-image">Image URL (optional)</label><input id="f-image" name="imageUrl" type="url" placeholder="horse-img.horsereality.com/..." value="' + L.esc(prefill.imageUrl) + '"></div>' +
      '<div class="field full"><label>Public stud fee</label><div class="fee-row">' +
        L.CURRENCIES.map(function (c) {
          var v = prefill['feePublic' + c];
          return '<div class="fee-mini"><input type="number" min="0" step="1" name="feePublic' + c + '" id="f-pub-' + c + '" placeholder="0" value="' + (v != null ? v : '') + '"><label for="f-pub-' + c + '">' + c + '</label></div>';
        }).join('') +
      '</div></div>' +
      '<div class="field full"><label>Private stud fee</label><div class="fee-row">' +
        L.CURRENCIES.map(function (c) {
          var v = prefill['feePrivate' + c];
          return '<div class="fee-mini"><input type="number" min="0" step="1" name="feePrivate' + c + '" id="f-priv-' + c + '" placeholder="0" value="' + (v != null ? v : '') + '"><label for="f-priv-' + c + '">' + c + '</label></div>';
        }).join('') +
      '</div></div>' +
      '<div class="field full"><label for="f-notes">Notes</label><textarea id="f-notes" name="notes" placeholder="Bloodline notes, discipline, availability...">' + L.esc(prefill.notes) + '</textarea></div>' +
      '<div class="panel-actions">' +
        '<button type="button" class="btn" data-action="cancel-stallion-form">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">' + (prefill.id ? 'Save Changes' : 'Add Stallion') + '</button>' +
      '</div>' +
    '</form>';
  }

  function renderBreedingForm() {
    return '<form class="card panel" data-action="submit-breeding">' +
      '<div class="field"><label for="b-mare">Mare name</label><input id="b-mare" name="mareName" required placeholder="Willow Creek Grace"></div>' +
      '<div class="field"><label for="b-mareLife">Mare life number</label><input id="b-mareLife" name="mareLifeNumber" placeholder="1492003"></div>' +
      '<div class="field"><label for="b-mareUrl">Mare link (optional)</label><input id="b-mareUrl" name="mareUrl" type="url" placeholder="horsereality.com/horse/..."></div>' +
      '<div class="field"><label for="b-breeder">Mare\'s owner</label><input id="b-breeder" name="breederName" placeholder="In-game username"></div>' +
      '<div class="field"><label for="b-breederUrl">Owner link (optional)</label><input id="b-breederUrl" name="breederUrl" type="url" placeholder="horsereality.com/user/..."></div>' +
      '<div class="field"><label for="b-price">Price paid</label><input id="b-price" name="price" type="number" min="0" step="1" placeholder="500"></div>' +
      '<div class="field"><label for="b-currency">Currency</label><select id="b-currency" name="currency">' +
        L.CURRENCIES.map(function (c) { return '<option' + (c === 'HRC' ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label for="b-feeType">Fee type</label><select id="b-feeType" name="feeType"><option selected>Public</option><option>Private</option></select></div>' +
      '<div class="field"><label for="b-date">Date</label><input id="b-date" name="date" type="date" value="' + L.todayStr() + '"></div>' +
      '<div class="field"><label for="b-status">Status</label><select id="b-status" name="status">' +
        '<option selected>Pending</option><option>Succeeded</option><option>Failed</option><option>Foal Born</option>' +
      '</select></div>' +
      '<div class="field"><label for="b-foalName">Foal name (optional)</label><input id="b-foalName" name="foalName" placeholder="If born already"></div>' +
      '<div class="field"><label for="b-foalUrl">Foal link (optional)</label><input id="b-foalUrl" name="foalUrl" type="url" placeholder="horsereality.com/horse/..."></div>' +
      '<div class="field"><label for="b-foalScore">Foal score (optional)</label><input id="b-foalScore" name="foalScore" type="number" min="0" step="0.001" placeholder="68.031"></div>' +
      '<div class="field full"><label for="b-notes">Notes</label><textarea id="b-notes" name="notes" placeholder="Genotype notes, extra context..."></textarea></div>' +
      '<div class="panel-actions">' +
        '<button type="button" class="btn" data-action="cancel-breeding-form">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Add Breeding</button>' +
      '</div>' +
    '</form>';
  }

  function renderImportForm(s) {
    return '<form class="card panel import-panel" data-action="submit-import">' +
      '<p class="import-hint">Paste a JSON array of breeding records (e.g. hand-crafted backfill data). Records naming their own stud route automatically' + (s ? '; others are added to ' + L.esc(s.name) : '') + '.</p>' +
      '<div class="field full"><label for="i-json">Data</label><textarea id="i-json" name="json" placeholder="[ { &quot;mareName&quot;: ... } ]"></textarea></div>' +
      (importError ? '<div class="import-error">' + L.esc(importError) + '</div>' : '') +
      '<div class="panel-actions">' +
        '<button type="button" class="btn" data-action="cancel-import-form">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Import Records</button>' +
      '</div>' +
    '</form>';
  }

  function renderBreedingRow(b, i, viewMode) {
    var curStatus = b.status || 'Pending';
    var sidForRow = b.stallionId || selectedId || '';
    var statusSelect = '<select class="pill-select ' + L.statusPillClass(curStatus) + '" data-action="update-breeding-status" data-id="' + b.id + '" data-sid="' + sidForRow + '">' +
      L.STATUS_OPTIONS.map(function (opt) {
        return '<option' + (opt === curStatus ? ' selected' : '') + '>' + opt + '</option>';
      }).join('') +
      (L.STATUS_OPTIONS.indexOf(curStatus) === -1 ? '<option selected>' + L.esc(curStatus) + '</option>' : '') +
    '</select>';
    var priceCell = (b.price ? L.fmtMoney(b.price) + ' ' + (b.currency || 'HRC') : '—') + (b.feeType === 'Private' ? '<div class="sub">private rate</div>' : '');
    var foalHref = L.safeUrl(b.foalUrl);
    var foalThumb = b.foalImageUrl ? '<img class="foal-thumb" src="' + L.esc(b.foalImageUrl) + '" alt="">' : '';
    var foalChip = b.foalName ? ('<span class="foal-chip">' + foalThumb + 'Foal: ' + (foalHref ? '<a href="' + L.esc(foalHref) + '" target="_blank" rel="noopener noreferrer">' + L.esc(b.foalName) + '<span class="ext">↗</span></a>' : L.esc(b.foalName)) + (b.foalScore ? ' · score ' + L.esc(b.foalScore) : '') + '</span>') : '';

    var col2Label, col2Html;
    if (viewMode === 'mare') {
      col2Label = 'Stallion';
      col2Html = b.stallionId
        ? '<button type="button" class="link-btn" data-action="open-stallion" data-id="' + b.stallionId + '">' + L.esc(b.stallionName || 'Unnamed stud') + '</button>'
        : L.esc(b.stallionName || 'Unknown stud');
      if (b.stallionLifeNumber) col2Html += '<div class="sub mono">#' + L.esc(b.stallionLifeNumber) + '</div>';
    } else {
      col2Label = 'Mare';
      var mareHref = L.safeUrl(b.mareUrl);
      col2Html = mareHref
        ? '<a href="' + L.esc(mareHref) + '" target="_blank" rel="noopener noreferrer">' + L.esc(b.mareName) + '<span class="ext">↗</span></a>'
        : L.esc(b.mareName);
      if (b.mareLifeNumber) col2Html += '<div class="sub mono">#' + L.esc(b.mareLifeNumber) + '</div>';
    }

    var ownerHref = L.safeUrl(b.breederUrl);
    var ownerCell = ownerHref
      ? '<a href="' + L.esc(ownerHref) + '" target="_blank" rel="noopener noreferrer">' + L.esc(b.breederName || '—') + '<span class="ext">↗</span></a>'
      : L.esc(b.breederName || '—');

    return '<div class="ledger-row" style="' + (i === 0 ? 'border-top:none' : '') + '">' +
      '<div class="mono" data-label="Date">' + L.fmtDate(b.date) + '</div>' +
      '<div class="mare" data-label="' + col2Label + '">' + col2Html + '</div>' +
      '<div data-label="Owner">' + ownerCell + '</div>' +
      '<div class="price mono" data-label="Price">' + priceCell + '</div>' +
      '<div data-label="Status">' + statusSelect + '</div>' +
      '<div class="actions-cell"><button class="btn btn-ghost btn-sm" data-action="delete-breeding" data-id="' + b.id + '" data-sid="' + sidForRow + '" title="Delete">✕</button></div>' +
      (foalChip || b.notes ? '<div class="notes-cell">' + foalChip + L.esc(b.notes) + '</div>' : '') +
    '</div>';
  }

  function renderMaresList() {
    var html = topHeaderHtml();
    var myName = (state.settings.myUsername || '').trim();

    if (!myName) {
      html += '<div class="empty"><h3>Set your username first</h3>' +
        '<p>Go to the Stallions tab and enter "My Horse Reality username" — that\'s how the ledger knows which mares are yours instead of a customer\'s.</p></div>';
      return html;
    }

    var totalRecords = 0, foalsBorn = 0;
    maresIndex.forEach(function (m) { totalRecords += m.records.length; foalsBorn += (m.counts['Foal Born'] || 0); });

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + maresIndex.length + '</div><div class="label">Your Mares</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + totalRecords + '</div><div class="label">Breedings logged</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + foalsBorn + '</div><div class="label">Foals born</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>My Mares</h2></div>';

    if (!maresIndex.length) {
      html += '<div class="empty"><h3>No mares of yours recorded yet</h3>' +
        '<p>A mare shows up here once a breeding record lists "' + L.esc(myName) + '" as her owner — from your own offspring or bank pages.</p></div>';
    } else {
      html += '<div class="stallion-grid">';
      maresIndex.forEach(function (m) {
        var mareInfo = (state.horseInfo && m.mareLifeNumber) ? state.horseInfo[m.mareLifeNumber] : null;
        html += '<div class="card stallion-card" data-action="open-mare" data-key="' + L.esc(m.key) + '">' +
          (mareInfo && mareInfo.imageUrl ? '<img class="portrait" src="' + L.esc(mareInfo.imageUrl) + '" alt="">' : '') +
          '<h3>' + L.esc(m.mareName) + '</h3>' +
          (m.mareLifeNumber ? '<div class="lifenum mono">#' + L.esc(m.mareLifeNumber) + '</div>' : '') +
          '<div class="row"><span>Breedings</span><span class="v mono">' + m.records.length + '</span></div>' +
          '<div class="row"><span>Succeeded</span><span class="v mono">' + (m.counts.Succeeded || 0) + '</span></div>' +
          '<div class="row"><span>Failed</span><span class="v mono">' + (m.counts.Failed || 0) + '</span></div>' +
          '<div class="row"><span>Foals born</span><span class="v mono">' + (m.counts['Foal Born'] || 0) + '</span></div>' +
          purchaseRowsHtml(m.mareLifeNumber) +
        '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderYoungList() {
    var html = topHeaderHtml();
    var myName = (state.settings.myUsername || '').trim();

    if (!myName) {
      html += '<div class="empty"><h3>Set your username first</h3>' +
        '<p>Go to the Stallions tab and enter "My Horse Reality username" — that\'s how the ledger knows which young horses are yours.</p></div>';
      return html;
    }

    var young = getYoungHorses();
    var colts = young.filter(function (h) { return h.sex === 'stallion'; });
    var fillies = young.filter(function (h) { return h.sex === 'mare'; });

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + young.length + '</div><div class="label">Under 3yo</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + colts.length + '</div><div class="label">Colts</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + fillies.length + '</div><div class="label">Fillies</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Colts &amp; Fillies</h2></div>';

    if (!young.length) {
      html += '<div class="empty"><h3>No young horses cached yet</h3>' +
        '<p>Once you view one of your under-3yo horses\' pages on Horse Reality, it\'ll show up here — split into colts and fillies until they turn 3 and move to the Stallions or My Mares tab.</p></div>';
      return html;
    }

    function youngGrid(list) {
      var out = '<div class="stallion-grid">';
      list.forEach(function (h) {
        out += '<div class="card stallion-card" data-action="open-passport" data-life="' + L.esc(h.lifeNumber) + '">' +
          (h.imageUrl ? '<img class="portrait" src="' + L.esc(h.imageUrl) + '" alt="">' : '') +
          '<h3>' + L.esc(h.name || 'Unnamed horse') + '</h3>' +
          '<div class="lifenum mono">#' + L.esc(h.lifeNumber) + '</div>' +
          '<div class="meta">' + L.esc([h.breed, h.color].filter(Boolean).join(' · ') || 'No breed set') + '</div>' +
          (h.dateOfBirth ? '<div class="row"><span>Born</span><span class="v mono">' + L.esc(h.dateOfBirth) + '</span></div>' : '') +
          renderAgeControlHtml(h.lifeNumber) +
          '</div>';
      });
      out += '</div>';
      return out;
    }

    if (colts.length) {
      html += '<h3 style="margin:20px 0 10px;">Colts</h3>' + youngGrid(colts);
    }
    if (fillies.length) {
      html += '<h3 style="margin:20px 0 10px;">Fillies</h3>' + youngGrid(fillies);
    }
    return html;
  }

  function renderMareDetail() {
    var m = maresIndex.find(function (x) { return x.key === selectedMareKey; });
    if (!m) { selectedMareKey = null; return renderMaresList(); }
    var mareHref = L.safeUrl(m.mareUrl);
    var passportInfo = (state.horseInfo && m.mareLifeNumber) ? state.horseInfo[m.mareLifeNumber] : null;

    var mareIdx = maresIndex.findIndex(function (x) { return x.key === selectedMareKey; });
    var html = '<div class="detail-nav">' +
      '<button class="back-link" data-action="back-to-mares">← My mares</button>' +
      (maresIndex.length > 1 ? '<div class="detail-nav-btns">' +
        '<button class="btn btn-sm" data-action="nav-mare" data-dir="prev">‹ Previous</button>' +
        '<button class="btn btn-sm" data-action="nav-mare" data-dir="next">Next ›</button>' +
      '</div>' : '') +
    '</div>';
    html += '<div class="detail-head">' +
      '<div><h1>' + L.esc(m.mareName) + '</h1>' +
      '<div class="tags">' +
        (m.mareLifeNumber ? '<span class="tag mono">#' + L.esc(m.mareLifeNumber) + '</span>' : '') +
        passportTagsHtml(passportInfo) +
      '</div>' +
      pregnancyLineHtml(passportInfo) +
      pedigreeLineHtml(passportInfo) +
      passportOwnerHtml(passportInfo) +
      (mareHref ? '<p class="notes-line"><a href="' + L.esc(mareHref) + '" target="_blank" rel="noopener noreferrer">View mare on Horse Reality<span class="ext">↗</span></a></p>' : '') +
      (m.mareLifeNumber ? renderAgeControlHtml(m.mareLifeNumber) : '') +
      '</div>' +
    '</div>';

    html += geneDetailsHtml(m.mareLifeNumber);
    html += purchaseDetailsHtml(m.mareLifeNumber);

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + m.records.length + '</div><div class="label">Breedings</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (m.counts.Succeeded || 0) + '</div><div class="label">Succeeded</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (m.counts.Failed || 0) + '</div><div class="label">Failed</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (m.counts['Foal Born'] || 0) + '</div><div class="label">Foals born</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Breeding History</h2></div>';
    if (!m.records.length) {
      html += '<div class="empty"><h3>No breedings logged yet</h3>' +
        '<p>' + L.esc(m.mareName) + ' hasn\'t been bred yet — once a covering shows up on your bank or notifications page, it\'ll appear here automatically.</p></div>';
    } else {
      html += '<div class="ledger">';
      html += '<div class="ledger-head"><div>Date</div><div>Stallion</div><div>Owner</div><div>Price</div><div>Status</div><div></div></div>';
      html += '<div class="card">';
      m.records.forEach(function (b, i) { html += renderBreedingRow(b, i, 'mare'); });
      html += '</div></div>';
    }

    return html;
  }

  // ---------- My Herd ----------
  // Status / role / project tags live in state.horseMeta (keyed by life
  // number), NOT on horseInfo — content.js rewrites horseInfo on every visit.
  // They're independent of a tracked stallion's own Active/Sold/Retired
  // status on the Stallions tab.
  function optionsHtml(list, current, blankLabel) {
    var html = blankLabel != null ? '<option value=""' + (current ? '' : ' selected') + '>' + L.esc(blankLabel) + '</option>' : '';
    list.forEach(function (opt) { html += '<option' + (opt === current ? ' selected' : '') + '>' + L.esc(opt) + '</option>'; });
    return html;
  }

  function parseScores(text) {
    return String(text || '').split(/[\s,;]+/).map(parseFloat).filter(function (n) { return isFinite(n) && n > 0; });
  }
  function bestScoreHtml(meta) {
    var b = L.bestConformation(meta);
    if (!b.best) return '';
    var best = Math.round(b.best * 1000) / 1000;
    return '<div class="sub" title="' + (b.fromPage ? 'Highest conformation score read from the horse\'s stats page' : 'Highest score you entered') + '">Best <strong>' + L.esc(best) + '</strong>' + (b.shows ? ' \u00b7 ' + b.shows + ' typed' : '') + (b.fromPage ? ' \u00b7 from stats page' : '') + '</div>';
  }
  function herdRowHtml(h) {
    var info = h.info, meta = h.meta;
    var detail = [info.breed, info.sex ? info.sex.charAt(0).toUpperCase() + info.sex.slice(1) : ''].filter(Boolean).join(' · ');
    var life = L.esc(h.lifeNumber);
    var pic = horsePictureUrl(h.lifeNumber);
    return '<div class="herd-row">' +
      '<div class="herd-pic">' + (pic ? '<img src="' + L.esc(pic) + '" alt="" width="200" height="200" loading="lazy" referrerpolicy="no-referrer">' : '<div class="nopic">No picture yet</div>') + '</div>' +
      '<div class="name" data-label="Horse"><span><button type="button" class="link-btn" data-action="open-passport" data-life="' + life + '">' + L.esc(info.name || 'Unnamed horse') + '</button> <span class="mono sub">#' + life + '</span>' + purchaseSubHtml(h.lifeNumber) + '</span></div>' +
      '<div data-label="Details"><span>' + L.esc(detail || '—') + (info.geneticPotential != null ? ' <span class="mono sub">GP ' + L.esc(info.geneticPotential) + '</span>' : '') + (info.conformation ? '<br><span class="mono sub">Conformation ' + L.esc(info.conformation) + '</span>' : '') + '</span></div>' +
      '<div data-label="Role"><select class="role-select" data-action="herd-role" data-life="' + life + '">' + optionsHtml(L.HERD_ROLES, meta.role, '—') + '</select></div>' +
      '<div data-label="Status"><select class="pill-select ' + L.herdStatusClass(meta.status) + '" data-action="herd-status" data-life="' + life + '">' + optionsHtml(L.HERD_STATUSES, meta.status) + '</select></div>' +
      '<div data-label="Project"><input type="text" data-action="herd-project" data-life="' + life + '" value="' + L.esc(meta.project) + '" placeholder="e.g. Leopard line"></div>' +
      '<div data-label="Show scores"><span><input type="text" data-action="herd-scores" data-life="' + life + '" value="' + L.esc(meta.confScores.join(', ')) + '" placeholder="e.g. 84.2, 87.5" title="Conformation show scores, separated by commas">' + bestScoreHtml(meta) + '</span></div>' +
    '</div>';
  }

  function herdListHtml(horses) {
    var html = '<div class="ledger"><div class="herd-head"><div></div><div>Horse</div><div>Details</div><div>Role</div><div>Status</div><div>Project</div><div>Show scores</div></div><div class="card">';
    horses.forEach(function (h) { html += herdRowHtml(h); });
    return html + '</div></div>';
  }

  // Same three tags, shown above a single horse's passport so they can be set
  // from there too (only for horses the API says you own).
  function herdControlsPanelHtml(lifeNumber) {
    var mine = L.ownedHorses(state).find(function (h) { return h.lifeNumber === lifeNumber; });
    if (!mine) return '';
    var life = L.esc(lifeNumber), meta = mine.meta;
    return '<div class="card" style="padding:16px;margin-bottom:16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">' +
      '<div class="field"><label for="hm-status">Status</label><select id="hm-status" data-action="herd-status" data-life="' + life + '">' + optionsHtml(L.HERD_STATUSES, meta.status) + '</select></div>' +
      '<div class="field"><label for="hm-role">Role</label><select id="hm-role" data-action="herd-role" data-life="' + life + '">' + optionsHtml(L.HERD_ROLES, meta.role, '—') + '</select></div>' +
      '<div class="field"><label for="hm-scores">Conformation scores (typed — the stats page is read automatically)</label><input id="hm-scores" type="text" data-action="herd-scores" data-life="' + life + '" value="' + L.esc(meta.confScores.join(', ')) + '" placeholder="e.g. 84.2, 87.5">' + bestScoreHtml(meta) + '</div>' +
      '<div class="field"><label for="hm-project">Project</label><input id="hm-project" type="text" data-action="herd-project" data-life="' + life + '" value="' + L.esc(meta.project) + '" placeholder="e.g. Leopard line"></div>' +
    '</div>';
  }

  function renderHerdList() {
    var html = topHeaderHtml();
    var myName = (state.settings.myUsername || '').trim();
    if (!myName) {
      html += '<div class="empty"><h3>Set your username first</h3>' +
        '<p>Go to the Stallions tab and enter "My Horse Reality username" — that\'s how the ledger knows which cached horses are yours.</p></div>';
      return html;
    }

    var horses = L.ownedHorses(state);
    if (!horses.length) {
      html += '<div class="empty"><h3>No horses of yours cached yet</h3>' +
        '<p>Open your own horses\' pages on Horse Reality — each one you visit is added here automatically once the page shows "' + L.esc(myName) + '" as its owner.</p></div>';
      return html;
    }

    var stats = L.herdStats(horses, state);
    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + stats.total + '</div><div class="label">Herd size</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + stats.mares + '</div><div class="label">Mares</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + stats.stallions + '</div><div class="label">Stallions</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + stats.pregnant + '</div><div class="label">In foal</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + stats.foalsBorn + '</div><div class="label">Foals born</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + stats.breeds + '</div><div class="label">Breeds</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (stats.avgGp != null ? stats.avgGp : '—') + '</div><div class="label">Avg genetic potential</div></div>' +
      '</div>';

    var active = horses.filter(function (h) { return !L.isArchivedHorse(h); });
    var archived = horses.filter(L.isArchivedHorse);
    var projects = [];
    horses.forEach(function (h) { if (h.meta.project && projects.indexOf(h.meta.project) === -1) projects.push(h.meta.project); });
    projects.sort();
    var visible = active.filter(function (h) {
      return (!herdRoleFilter || h.meta.role === herdRoleFilter) && (!herdProjectFilter || h.meta.project === herdProjectFilter);
    });

    html += '<div class="section-head"><h2>My Herd</h2>' +
      (archived.length ? '<button class="btn btn-sm" data-action="toggle-archive">' + (showArchive ? 'Hide archive' : 'Show archive (' + archived.length + ')') + '</button>' : '') +
      '</div>';
    html += '<div class="herd-filters">' +
      '<label>Role <select data-action="herd-filter-role">' + optionsHtml(L.HERD_ROLES, herdRoleFilter, 'All roles') + '</select></label>' +
      '<label>Project <select data-action="herd-filter-project">' + optionsHtml(projects, herdProjectFilter, 'All projects') + '</select></label>' +
      '</div>';

    if (visible.length) html += herdListHtml(visible);
    else html += '<div class="empty"><h3>Nothing matches</h3><p>No active horses match that role/project filter.</p></div>';

    if (showArchive && archived.length) {
      html += '<div class="section-head"><h2>Archive</h2></div>';
      html += herdListHtml(archived);
    }
    return html;
  }

  // ---------- Other Horses ----------
  // Horses added from the on-page prompt that someone else owns. They stay
  // out of My Herd; the search box above also finds them.
  function renderOthersList() {
    var html = topHeaderHtml();
    var horses = L.trackedOtherHorses(state);
    html += '<div class="section-head"><h2>Other Horses</h2></div>';
    if (!horses.length) {
      return html + '<div class="empty"><h3>No other horses yet</h3><p>Open a horse that isn\'t yours on Horse Reality and choose "Add to ledger" in the box that appears.</p></div>';
    }
    html += '<div class="card">';
    horses.forEach(function (info) {
      var life = L.esc(info.lifeNumber);
      var pic = horsePictureUrl(info.lifeNumber);
      var detail = [info.breed, info.sex ? info.sex.charAt(0).toUpperCase() + info.sex.slice(1) : '', info.ownerName ? 'Owner: ' + info.ownerName : ''].filter(Boolean).join(' · ');
      html += '<div class="herd-row other-row">' +
        '<div class="herd-pic">' + (pic ? '<img src="' + L.esc(pic) + '" alt="" width="200" height="200" loading="lazy" referrerpolicy="no-referrer">' : '<div class="nopic">No picture yet</div>') + '</div>' +
        '<div class="name" data-label="Horse"><span><button type="button" class="link-btn" data-action="open-passport" data-life="' + life + '">' + L.esc(info.name || 'Unnamed horse') + '</button> <span class="mono sub">#' + life + '</span></span></div>' +
        '<div data-label="Details"><span>' + L.esc(detail || '—') + '</span></div>' +
        '<div><button class="btn btn-sm" data-action="untrack-horse" data-life="' + life + '">Remove</button></div>' +
      '</div>';
    });
    return html + '</div>';
  }

  // ---------- Foal Calculator ----------
  // Pure computation over horses already cached in state.horseInfo — no new
  // network calls. Inbreeding is only as complete as the cached pedigree, so
  // ancestors we couldn't look up are reported explicitly as gaps instead of
  // being silently treated as "not inbred".
  var CALC_GENERATIONS = 3;
  function foalGenLabel(n) {
    return ['', 'parent', 'grandparent', 'great-grandparent', 'great-great-grandparent'][n] || (n + 'th-generation ancestor');
  }
  function foalGensText(gens) {
    return gens.map(function (g) { return foalGenLabel(g + 1); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' & ');
  }
  function calcOptionsHtml(sex, selected) {
    var mine = {};
    L.ownedHorses(state).forEach(function (h) { mine[h.lifeNumber] = true; });
    var rows = Object.keys(state.horseInfo || {}).filter(function (life) { return state.horseInfo[life].sex === sex; }).map(function (life) {
      return { life: life, name: state.horseInfo[life].name || ('#' + life), mine: !!mine[life], young: L.isYoungInfo(state.horseInfo[life]) };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    function group(label, list) {
      if (!list.length) return '';
      return '<optgroup label="' + L.esc(label) + '">' + list.map(function (r) {
        return '<option value="' + L.esc(r.life) + '"' + (r.life === selected ? ' selected' : '') + '>' + L.esc(r.name) + ' (#' + L.esc(r.life) + ')</option>';
      }).join('') + '</optgroup>';
    }
    return '<option value="">Choose…</option>' +
      group('Your horses · 3 and older', rows.filter(function (r) { return r.mine && !r.young; })) +
      group('Other horses · 3 and older', rows.filter(function (r) { return !r.mine && !r.young; })) +
      group('Your horses · Under 3', rows.filter(function (r) { return r.mine && r.young; })) +
      group('Other horses · Under 3', rows.filter(function (r) { return !r.mine && r.young; }));
  }
  function ancestorLabel(life) {
    var name = L.ancestorName(state, life);
    return (name ? L.esc(name) + ' ' : '') + '<span class="mono sub">#' + L.esc(life) + '</span>';
  }
  // Saved picture for a horse: the passport cache first, else the tracked
  // stallion record's own copy. The image server serves plain <img> loads.
  function horsePictureUrl(life) {
    var info = state.horseInfo[life] || {};
    if (info.imageUrl) return info.imageUrl;
    var rec = state.stallions.find(function (x) { return String(x.lifeNumber) === String(life); });
    return (rec && rec.imageUrl) || '';
  }
  function parentCardHtml(label, life) {
    var info = state.horseInfo[life] || {};
    var pic = horsePictureUrl(life);
    var facts = [];
    if (info.breed) facts.push(L.esc(info.breed));
    if (info.geneticPotential != null) facts.push('GP ' + L.esc(info.geneticPotential));
    if (info.conformation) facts.push(L.esc(info.conformation));
    var genes = savedGenesText(life);
    return '<div class="card" style="padding:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;">' +
      (pic ? '<img src="' + L.esc(pic) + '" alt="" referrerpolicy="no-referrer" style="width:150px;max-width:100%;aspect-ratio:4/3;object-fit:contain;border-radius:9px;background:var(--surface-2);flex-shrink:0;">'
           : '<div style="width:150px;max-width:100%;aspect-ratio:4/3;border-radius:9px;background:var(--surface-2);display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;flex-shrink:0;">No picture yet</div>') +
      '<div style="min-width:0;flex:1;">' +
        '<div style="font-size:11.5px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">' + label + '</div>' +
        '<h3 style="margin:2px 0 4px;font-size:19px;">' + L.esc(info.name || ('#' + life)) + '</h3>' +
        '<div class="mono sub" style="color:var(--text-muted);font-size:12px;">#' + L.esc(life) + '</div>' +
        (facts.length ? '<div style="font-size:13px;margin-top:6px;">' + facts.join(' · ') + '</div>' : '') +
        ((info.testedColours || genes) ? '<div class="mono" style="font-size:12px;color:var(--text-muted);margin-top:4px;">' + L.esc([info.testedColours, genes].filter(Boolean).join(' · ')) + '</div>' : '') +
      '</div></div>';
  }

  // Side-by-side stats for the two parents. Rows where the parents differ are
  // highlighted, and where a higher or lower value is clearly better the
  // stronger parent is marked. Only values both horses have are compared.
  function statNumber(text) {
    var m = /-?\d+(?:\.\d+)?/.exec(String(text == null ? '' : text));
    return m ? parseFloat(m[0]) : null;
  }
  function statsCompareHtml(mareLife, studLife) {
    var mare = state.horseInfo[mareLife] || {}, stud = state.horseInfo[studLife] || {};
    var mareConf = L.parseConformation(mare.conformation), studConf = L.parseConformation(stud.conformation);
    function confText(c, raw) {
      return c.ok ? L.esc(raw) + '<div class="sub" style="color:var(--text-muted);font-size:12px;">' + c.G + ' good \u00b7 ' + c.A + ' average \u00b7 ' + c.BA + ' below average</div>' : '';
    }
    function age(info) { var m = L.effectiveAgeMonths(info); return m == null ? null : m; }
    var rows = [
      { label: 'Genetic potential', a: mare.geneticPotential, b: stud.geneticPotential, num: true, better: 'high' },
      { label: 'Conformation', aHtml: confText(mareConf, mare.conformation), bHtml: confText(studConf, stud.conformation),
        aKey: mareConf.ok ? mare.conformation : null, bKey: studConf.ok ? stud.conformation : null,
        aScore: mareConf.G - mareConf.BA, bScore: studConf.G - studConf.BA, better: 'high' },
      { label: 'Best conformation show score', a: L.bestConformation(L.herdMeta(state, mareLife)).best || null, b: L.bestConformation(L.herdMeta(state, studLife)).best || null, num: true, better: 'high' },
      { label: 'Inbreeding (COI)', a: mare.coi, b: stud.coi, num: true, better: 'low', fmt: function (v, info) { return info.coiRaw || (v + '%'); } },
      { label: 'Height', a: statNumber(mare.height), b: statNumber(stud.height), num: true, fmt: function (v, info) { return info.height || (v + ' cm'); } },
      { label: 'Age', a: age(mare), b: age(stud), num: true, fmt: function (v) { return L.formatAgeMonths(v); } },
      { label: 'Breed', a: mare.breed, b: stud.breed },
      { label: 'Location', a: mare.location, b: stud.location },
      { label: 'Training', a: mare.training, b: stud.training },
      { label: 'Predicates', a: mare.predicates, b: stud.predicates }
    ];
    var html = '';
    var diffs = 0;
    rows.forEach(function (r) {
      var aVal = r.aKey !== undefined ? r.aKey : r.a, bVal = r.bKey !== undefined ? r.bKey : r.b;
      var hasA = aVal != null && aVal !== '', hasB = bVal != null && bVal !== '';
      if (!hasA && !hasB) return;
      var different = hasA && hasB && String(aVal).trim().toLowerCase() !== String(bVal).trim().toLowerCase();
      var aBetter = false, bBetter = false;
      if (different && r.better) {
        var sa = r.aScore != null ? r.aScore : Number(aVal), sb = r.bScore != null ? r.bScore : Number(bVal);
        if (isFinite(sa) && isFinite(sb) && sa !== sb) {
          var highWins = r.better === 'high';
          aBetter = highWins ? sa > sb : sa < sb;
          bBetter = !aBetter;
        }
      }
      if (different) diffs++;
      function cell(has, val, rawVal, htmlOverride, better, info) {
        var shown = !has ? '<span style="color:var(--text-muted);">\u2014</span>'
          : (htmlOverride ? htmlOverride : L.esc(r.fmt ? r.fmt(rawVal, info) : (r.num ? Math.round(Number(val) * 1000) / 1000 : val)));
        return '<div style="' + (better ? 'font-weight:700;' : '') + '">' + shown + (better ? ' <span title="Stronger parent for this stat" style="color:var(--success);font-size:12px;">\u25b2</span>' : '') + '</div>';
      }
      html += '<div style="display:grid;grid-template-columns:minmax(120px,1fr) 1.3fr 1.3fr;gap:12px;align-items:baseline;padding:9px 14px;border-top:1px solid var(--border);font-size:13.5px;' +
        (different ? 'background:var(--warn-bg);box-shadow:inset 3px 0 0 var(--warn);' : '') + '">' +
        '<div style="color:var(--text-muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;">' + L.esc(r.label) + (different ? ' <span title="The parents differ here" style="color:var(--warn);">\u2260</span>' : '') + '</div>' +
        cell(hasA, r.a, r.a, r.aHtml, aBetter, mare) + cell(hasB, r.b, r.b, r.bHtml, bBetter, stud) + '</div>';
    });
    if (!html) return '';
    return '<div class="section-head"><h2>Parent stats</h2></div>' +
      '<div class="card" style="overflow:hidden;margin-bottom:8px;"><div style="display:grid;grid-template-columns:minmax(120px,1fr) 1.3fr 1.3fr;gap:12px;padding:10px 14px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">' +
        '<div></div><div>' + L.esc(mare.name || 'Mare') + '</div><div>' + L.esc(stud.name || 'Stallion') + '</div></div>' + html + '</div>' +
      '<p class="notes-line" style="margin-bottom:16px;">' + (diffs ? diffs + ' stat' + (diffs === 1 ? '' : 's') + ' differ (highlighted \u2260). ' : 'No differences found. ') +
      '\u25b2 marks the stronger parent where higher or lower is clearly better.</p>';
  }

  // Trait-by-trait conformation comparison (Good / Average / Below average),
  // captured from each horse's own page. Differing traits are highlighted.
  var CONF_TRAITS = ['Walk', 'Trot', 'Canter', 'Gallop', 'Posture', 'Head', 'Neck', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters', 'Socks'];
  function ratingRank(text) {
    var t = String(text || '').toLowerCase();
    if (/below|poor|bad/.test(t)) return 1;
    if (/average/.test(t)) return 2;
    if (/good/.test(t)) return 3;
    if (/excellent|great|superb/.test(t)) return 4;
    return null;
  }
  function ratingChipHtml(text) {
    var rank = ratingRank(text);
    var colour = rank === 3 || rank === 4 ? ['var(--success-bg)', 'var(--success)'] : (rank === 1 ? ['var(--danger-bg)', 'var(--danger)'] : ['var(--warn-bg)', 'var(--warn)']);
    return '<span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12.5px;font-weight:600;background:' + colour[0] + ';color:' + colour[1] + ';">' + L.esc(text) + '</span>';
  }
  function traitsCompareHtml(mareLife, studLife) {
    var mare = state.horseInfo[mareLife] || {}, stud = state.horseInfo[studLife] || {};
    var mt = mare.confTraits || null, st = stud.confTraits || null;
    var html = '<div class="section-head"><h2>Conformation traits</h2></div>';
    if (!mt && !st) {
      return html + '<div class="empty" style="text-align:left;margin-bottom:16px;"><p style="margin:0;">Trait ratings are read from each horse\'s own page on Horse Reality (the conformation table). Open both horses\' pages once and they\'ll appear here.</p></div>';
    }
    var names = CONF_TRAITS.filter(function (n) { return (mt && mt[n]) || (st && st[n]); });
    [mt, st].forEach(function (t) { Object.keys(t || {}).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); }); });
    var diffs = 0;
    var head = '<div style="display:grid;grid-template-columns:minmax(110px,1fr) 1.3fr 1.3fr;gap:12px;padding:10px 14px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;">' +
      '<div></div><div>' + L.esc(mare.name || 'Mare') + '</div><div>' + L.esc(stud.name || 'Stallion') + '</div></div>';
    var rowsHtml = names.map(function (n) {
      var a = mt && mt[n], b = st && st[n];
      var different = !!(a && b && String(a).trim().toLowerCase() !== String(b).trim().toLowerCase());
      var ra = ratingRank(a), rb = ratingRank(b);
      var aBetter = different && ra != null && rb != null && ra > rb, bBetter = different && ra != null && rb != null && rb > ra;
      if (different) diffs++;
      function cell(v, better) {
        return '<div>' + (v ? ratingChipHtml(v) : '<span style="color:var(--text-muted);">\u2014</span>') +
          (better ? ' <span title="Stronger parent for this trait" style="color:var(--success);font-size:12px;">\u25b2</span>' : '') + '</div>';
      }
      return '<div style="display:grid;grid-template-columns:minmax(110px,1fr) 1.3fr 1.3fr;gap:12px;align-items:center;padding:7px 14px;border-top:1px solid var(--border);font-size:13.5px;' +
        (different ? 'background:var(--warn-bg);box-shadow:inset 3px 0 0 var(--warn);' : '') + '">' +
        '<div style="font-weight:600;">' + L.esc(n) + (different ? ' <span title="The parents differ here" style="color:var(--warn);">\u2260</span>' : '') + '</div>' +
        cell(a, aBetter) + cell(b, bBetter) + '</div>';
    }).join('');
    var missing = [];
    if (!mt) missing.push(mare.name || 'the mare');
    if (!st) missing.push(stud.name || 'the stallion');
    return html + '<div class="card" style="overflow:hidden;margin-bottom:8px;">' + head + rowsHtml + '</div>' +
      '<p class="notes-line" style="margin-bottom:16px;">' + (diffs ? diffs + ' of ' + names.length + ' traits differ (highlighted \u2260). ' : 'No differing traits. ') +
      '\u25b2 marks the stronger parent.' + (missing.length ? ' Not captured yet for ' + L.esc(missing.join(' and ')) + ' \u2014 open that horse\'s page on Horse Reality.' : '') + '</p>';
  }

  // The foal's pedigree: sire on top, dam below, each side expanded as far
  // back as the cached pedigrees reach. Ancestors that appear on BOTH sides
  // (the inbreeding check's shared ancestors) are outlined in red.
  function pedBoxHtml(n, shared) {
    var isShared = shared[n.life];
    var label = n.name ? L.esc(n.name) : '<span style="color:var(--text-muted);">#' + L.esc(n.life) + '</span>';
    return '<div style="border:1px solid ' + (isShared ? 'var(--danger)' : 'var(--border)') + ';background:' + (isShared ? 'var(--danger-bg)' : 'var(--surface)') +
      ';border-radius:8px;padding:5px 8px;font-size:12.5px;line-height:1.25;width:150px;box-sizing:border-box;">' + label +
      (n.name ? '<div class="mono" style="font-size:10.5px;color:var(--text-muted);">#' + L.esc(n.life) + (n.cached ? '' : ' · not cached') + '</div>' : '') + '</div>';
  }
  function pedNodeHtml(n, shared) {
    var kids = [];
    if (n.s) kids.push(pedNodeHtml(n.s, shared));
    if (n.d) kids.push(pedNodeHtml(n.d, shared));
    return '<div style="display:flex;align-items:stretch;">' +
      '<div style="display:flex;align-items:center;padding:3px 10px 3px 0;">' + pedBoxHtml(n, shared) + '</div>' +
      (kids.length ? '<div style="display:flex;flex-direction:column;justify-content:space-around;">' + kids.join('') + '</div>' : '') +
    '</div>';
  }
  function foalPedigreeHtml(studLife, mareLife, common) {
    var shared = {};
    common.forEach(function (c) { shared[c.life] = true; });
    var tree = {
      life: 'foal', name: 'Foal', cached: true,
      s: L.pedigreeTreeOf(state, studLife, CALC_GENERATIONS),
      d: L.pedigreeTreeOf(state, mareLife, CALC_GENERATIONS)
    };
    var rootBox = '<div style="border:1px dashed var(--border-strong);background:var(--surface-2);border-radius:8px;padding:5px 8px;font-size:12.5px;width:110px;box-sizing:border-box;">' +
      '<strong>Foal</strong><div style="font-size:10.5px;color:var(--text-muted);">' + L.esc(L.ancestorName(state, mareLife) || 'Mare') + ' × ' + L.esc(L.ancestorName(state, studLife) || 'Stallion') + '</div></div>';
    var inner = '<div style="display:flex;flex-direction:column;justify-content:space-around;">' + pedNodeHtml(tree.s, shared) + pedNodeHtml(tree.d, shared) + '</div>';
    return '<div class="section-head"><h2>Foal pedigree</h2></div>' +
      '<div class="card" style="padding:14px;overflow-x:auto;margin-bottom:16px;"><div style="display:flex;align-items:stretch;min-width:max-content;">' +
        '<div style="display:flex;align-items:center;padding-right:10px;">' + rootBox + '</div>' + inner +
      '</div></div>' +
      '<p class="notes-line" style="margin-top:-8px;margin-bottom:16px;">Sire on top, dam below. Red outline = ancestor on both sides. Ancestors shown as a number only haven\'t been cached yet — visit their pages to fill them in.</p>';
  }

  function renderCalculator() {
    var html = topHeaderHtml();
    html += '<div class="section-head"><h2>Foal Calculator</h2></div>';
    html += '<div class="card" style="padding:16px;margin-bottom:16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">' +
      '<div class="field"><label for="calc-mare">Mare</label><select id="calc-mare" data-action="calc-mare">' + calcOptionsHtml('mare', calcMare) + '</select></div>' +
      '<div class="field"><label for="calc-stallion">Stallion</label><select id="calc-stallion" data-action="calc-stallion">' + calcOptionsHtml('stallion', calcStallion) + '</select></div>' +
      '</div>';

    if (!calcMare || !calcStallion || !state.horseInfo[calcMare] || !state.horseInfo[calcStallion]) {
      html += '<div class="empty"><h3>Pick a mare and a stallion</h3>' +
        '<p>Choose from horses whose pages you\'ve visited on Horse Reality — the calculator checks their cached pedigrees for shared ancestors up to ' + CALC_GENERATIONS + ' generations behind each parent.</p></div>';
      return html;
    }

    var mareInfo = state.horseInfo[calcMare], studInfo = state.horseInfo[calcStallion];
    var a = L.ancestorMap(state, calcStallion, CALC_GENERATIONS);
    var b = L.ancestorMap(state, calcMare, CALC_GENERATIONS);
    var common = L.commonAncestors(a, b);
    var coi = L.estimateCoi(common);
    var gaps = a.gaps.concat(b.gaps);
    var gpA = studInfo.geneticPotential, gpB = mareInfo.geneticPotential;
    var avgGp = (gpA != null && gpB != null) ? Math.round((Number(gpA) + Number(gpB)) / 2) : null;

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + (avgGp != null ? avgGp : '—') + '</div><div class="label">Avg parent GP</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + common.length + '</div><div class="label">Shared ancestors</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (common.length ? coi.toFixed(2) + '%' : '0%') + '</div><div class="label">Est. inbreeding</div></div>' +
      '<div class="stat-tile"><div class="num mono multi">Stallion ' + a.depth + ' · Mare ' + b.depth + '</div><div class="label">Generations known</div></div>' +
      '</div>';

    html += '<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));margin-bottom:16px;">' +
      parentCardHtml('Mare', calcMare) + parentCardHtml('Stallion', calcStallion) + '</div>';
    html += statsCompareHtml(calcMare, calcStallion);
    html += traitsCompareHtml(calcMare, calcStallion);
    html += foalPedigreeHtml(calcStallion, calcMare, common);

    if (common.length) {
      html += '<div class="empty" style="border-color:var(--danger);text-align:left;margin:16px 0;">' +
        '<h3 style="color:var(--danger);">Inbreeding found</h3>' +
        '<p style="margin-top:0;">Shared ancestors within ' + CALC_GENERATIONS + ' generations behind each parent. The percentage is an estimate that ignores the ancestors\' own inbreeding, so Horse Reality\'s figure may be higher.</p>';
      common.forEach(function (c) {
        var self = c.life === calcStallion || c.life === calcMare;
        html += '<p class="notes-line"><strong>' + ancestorLabel(c.life) + '</strong>' + (self ? ' (is one of the parents)' : '') +
          ' — stallion\'s side: ' + L.esc(foalGensText(c.gensA)) + ' · mare\'s side: ' + L.esc(foalGensText(c.gensB)) + '</p>';
      });
      html += '</div>';
    } else if (!gaps.length) {
      html += '<div class="empty" style="border-color:var(--success);margin:16px 0;"><h3 style="color:var(--success);">No shared ancestors</h3>' +
        '<p style="margin:0;">None found within ' + CALC_GENERATIONS + ' generations behind each parent.</p></div>';
    }

    if (gaps.length) {
      var seen = {}, uniq = gaps.filter(function (g) { if (seen[g.life]) return false; seen[g.life] = true; return true; });
      html += '<div class="empty" style="border-color:#d97706;text-align:left;margin:16px 0;">' +
        '<h3 style="color:#d97706;">Pedigree incomplete</h3>' +
        '<p style="margin-top:0;">' + uniq.length + ' ancestor' + (uniq.length === 1 ? '' : 's') + ' haven\'t been cached, so this check can\'t rule out inbreeding through them. Visit their pages on Horse Reality to fill the gap:</p>' +
        '<p class="notes-line">' + uniq.map(function (g) { return ancestorLabel(g.life); }).join(' · ') + '</p></div>';
    }

    html += colourSectionHtml(calcStallion, calcMare);
    return html;
  }

  // ---------- Foal Calculator: colour odds ----------
  function pctText(p) { return (Math.round(p * 10) / 10) + '%'; }
  function oddsRowHtml(label, pct, sub) {
    return '<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline;padding:7px 12px;border-top:1px solid var(--border);' +
      'background:linear-gradient(to right,var(--accent-soft) ' + Math.min(100, pct) + '%,transparent ' + Math.min(100, pct) + '%);">' +
      '<span>' + L.esc(label) + (sub ? ' <span class="sub" style="color:var(--text-muted);font-size:12px;">' + L.esc(sub) + '</span>' : '') + '</span>' +
      '<span class="mono" style="font-weight:600;">' + pctText(pct) + '</span></div>';
  }
  function oddsCardHtml(title, rowsHtml) {
    return '<div style="margin-bottom:16px;"><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">' + L.esc(title) + '</div>' +
      '<div class="card" style="overflow:hidden;">' + rowsHtml + '</div></div>';
  }
  // Select per hand-entered gene for one horse. A gene Horse Reality itself
  // reports for that horse is shown read-only instead.
  function geneEditorHtml(lifeNumber, title) {
    var info = state.horseInfo[lifeNumber] || {};
    var tested = L.parseColourGenes(info.testedColours);
    var manual = L.manualGenes(state, lifeNumber);
    var life = L.esc(lifeNumber);
    var html = '<div><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">' + L.esc(title) + ' — ' + L.esc(info.name || ('#' + lifeNumber)) + '</div>' +
      '<div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">';
    L.EXTRA_LOCI.forEach(function (l) {
      var id = 'gene-' + life + '-' + l.id;
      html += '<div class="field"><label for="' + id + '">' + L.esc(l.name) + '</label>';
      if (tested[l.id]) {
        html += '<select id="' + id + '" disabled><option>' + L.esc(tested[l.id].join(' / ')) + ' (from Horse Reality)</option></select>';
      } else {
        var cur = manual[l.id] ? manual[l.id].join('/') : '';
        html += '<select id="' + id + '" data-action="horse-gene" data-life="' + life + '" data-locus="' + L.esc(l.id) + '">' +
          '<option value=""' + (cur ? '' : ' selected') + '>Not present (default)</option>' +
          L.extraGenotypeOptions(l).map(function (g) { return '<option value="' + L.esc(g) + '"' + (g === cur ? ' selected' : '') + '>' + L.esc(g.replace('/', ' / ')) + '</option>'; }).join('') +
        '</select>';
      }
      html += '</div>';
    });
    return html + '</div></div>';
  }

  // ---------- purchase price & shipping ----------
  function purchaseParts(lifeNumber) {
    var p = L.purchaseOf(state, lifeNumber);
    if (!p) return null;
    var parts = { paid: p.price ? L.fmtMoney(p.price) + ' ' + p.currency : '', ship: p.shipping ? L.fmtMoney(p.shipping) + ' ' + p.shippingCurrency : '', total: '' };
    if (p.price && p.shipping && p.currency === p.shippingCurrency) parts.total = L.fmtMoney(p.price + p.shipping) + ' ' + p.currency;
    return parts;
  }
  // tags for a horse's page header
  function purchaseTagsHtml(lifeNumber) {
    var p = purchaseParts(lifeNumber);
    if (!p) return '';
    return (p.paid ? '<span class="tag mono" title="What you paid for this horse">Paid ' + L.esc(p.paid) + '</span>' : '') +
      (p.ship ? '<span class="tag mono" title="Shipping fee">Shipping ' + L.esc(p.ship) + '</span>' : '') +
      (p.total ? '<span class="tag mono" title="Price plus shipping">Total ' + L.esc(p.total) + '</span>' : '');
  }
  // rows for the stallion / mare cards
  function purchaseRowsHtml(lifeNumber) {
    var p = purchaseParts(lifeNumber);
    if (!p) return '';
    return (p.paid ? '<div class="row"><span>Paid</span><span class="v fee mono">' + L.esc(p.paid) + '</span></div>' : '') +
      (p.ship ? '<div class="row"><span>Shipping</span><span class="v fee mono">' + L.esc(p.ship) + '</span></div>' : '');
  }
  // one small line under a horse's name in My Herd
  function purchaseSubHtml(lifeNumber) {
    var p = purchaseParts(lifeNumber);
    if (!p) return '';
    return '<div class="sub" style="color:var(--text-muted);">' + (p.paid ? 'Paid ' + L.esc(p.paid) : '') + (p.ship ? (p.paid ? ' + ' : '') + L.esc(p.ship) + ' shipping' : '') + '</div>';
  }
  function setHorsePurchase(lifeNumber, field, value) {
    if (!lifeNumber || !field) return;
    var meta = state.horseMeta[lifeNumber] = Object.assign({}, state.horseMeta[lifeNumber]);
    meta.purchase = Object.assign({}, meta.purchase);
    if (field === 'price' || field === 'shipping') {
      var n = parseFloat(value);
      if (isFinite(n) && n > 0) meta.purchase[field] = n; else delete meta.purchase[field];
    } else {
      meta.purchase[field] = value;
    }
    persist();
  }
  function purchaseDetailsHtml(lifeNumber) {
    if (!lifeNumber) return '';
    var meta = (state.horseMeta[lifeNumber] && state.horseMeta[lifeNumber].purchase) || {};
    var parts = purchaseParts(lifeNumber);
    var life = L.esc(lifeNumber);
    function money(label, field, curField, curValue) {
      var id = 'buy-' + life + '-' + field;
      return '<div class="field"><label for="' + id + '">' + label + '</label>' +
        '<div style="display:flex;gap:8px;"><input id="' + id + '" type="number" min="0" step="any" data-action="horse-purchase" data-life="' + life + '" data-field="' + field + '" value="' + (meta[field] ? L.esc(meta[field]) : '') + '" placeholder="0" style="flex:1;min-width:0;">' +
        '<select data-action="horse-purchase" data-life="' + life + '" data-field="' + curField + '" aria-label="' + label + ' currency">' +
          L.CURRENCIES.map(function (c) { return '<option' + (c === (curValue || 'HRC') ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
        '</select></div></div>';
    }
    return '<details style="margin:0 0 16px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Purchase price &amp; shipping — ' +
      (parts ? L.esc([parts.paid ? 'paid ' + parts.paid : '', parts.ship ? parts.ship + ' shipping' : ''].filter(Boolean).join(' + ')) : 'not recorded') + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">' +
        money('Price paid', 'price', 'currency', meta.currency) +
        money('Shipping fee', 'shipping', 'shippingCurrency', meta.shippingCurrency) +
        '<p class="notes-line" style="margin:0;grid-column:1/-1;">Leave both empty for a horse you bred or weren\'t charged for.</p>' +
      '</div></details>';
  }

  // Short text of the hand-entered genes saved on a horse, e.g. "Sooty Sty / sty".
  function savedGenesText(lifeNumber) {
    var manual = L.manualGenes(state, lifeNumber);
    return L.EXTRA_LOCI.filter(function (l) { return manual[l.id]; }).map(function (l) {
      return l.name.replace(/ \(.*\)$/, '') + ' ' + manual[l.id].join(' / ');
    }).join(', ');
  }
  // The same editor the calculator uses, tucked under a horse's own page so
  // genes are set once on the horse and reused for every pairing.
  function geneDetailsHtml(lifeNumber) {
    if (!lifeNumber || !state.horseInfo[lifeNumber]) return '';
    var saved = savedGenesText(lifeNumber);
    return '<details style="margin:0 0 16px;"' + '><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Extra genes (Sooty, Silver, Flaxen…) — ' +
      (saved ? L.esc(saved) : 'none entered yet') + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:12px;">' +
      geneEditorHtml(lifeNumber, 'Saved on this horse') +
      '<p class="notes-line" style="margin:0;">Saved once here and used automatically by the Foal Calculator whenever this horse is a parent.</p>' +
      '</div></details>';
  }

  function colourSectionHtml(studLife, mareLife) {
    var studInfo = state.horseInfo[studLife], mareInfo = state.horseInfo[mareLife];
    var c = L.colourOutcomes(studInfo.testedColours, mareInfo.testedColours, L.manualGenes(state, studLife), L.manualGenes(state, mareLife));
    var html = '<div class="section-head"><h2>Colour possibilities</h2></div>';
    html += '<details style="margin-bottom:14px;"' + (c.genes.length ? '' : ' open') + '><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Enter extra genes by hand (Sooty, Silver, Flaxen, Champagne, Roan, Tobiano, Sabino)</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:16px;">' +
      geneEditorHtml(mareLife, 'Mare') + geneEditorHtml(studLife, 'Stallion') +
      '<p class="notes-line" style="margin:0;">Horse Reality doesn\'t list these genes, so set them for each parent if you know them. Anything you leave unset counts as not present. Saved per horse and included in backups.</p>' +
      '</div></details>';
    if (!c.genes.length) {
      return html + '<div class="empty"><h3>No shared colour tests</h3>' +
        '<p>Colour odds need genes that are tested on <em>both</em> parents. Visit both horses\' pages on Horse Reality so their tested colours are cached.</p></div>';
    }
    if (c.colours) {
      html += oddsCardHtml('Coat colour', c.colours.map(function (o) { return oddsRowHtml(o.label, o.pct); }).join(''));
      if (!c.baseKnown) {
        html += '<p class="notes-line" style="margin-top:-8px;margin-bottom:16px;">The base colour can\'t be named because the Extension (E) gene isn\'t tested on both parents, so only the other known genes are combined.</p>';
      }
    } else {
      html += '<div class="empty" style="text-align:left;margin-bottom:16px;"><p style="margin:0;">Base coat colour needs the Extension (E) gene tested on both parents.</p></div>';
    }
    if (c.patterns) {
      html += oddsCardHtml('Appaloosa pattern', c.patterns.map(function (o) { return oddsRowHtml(o.label, o.pct); }).join(''));
    }
    if (c.extras.length) {
      html += oddsCardHtml('Extra genes — chance the foal shows each', c.extras.map(function (g) {
        var split = g.outcomes.map(function (o) { return o.genotype + ' ' + pctText(o.pct); }).join(' · ');
        return oddsRowHtml(g.label, g.pct, split + (g.note ? ' — ' + g.note : ''));
      }).join(''));
    }
    html += '<details style="margin-bottom:12px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Gene-by-gene odds</summary>';
    c.genes.forEach(function (g) {
      html += oddsCardHtml(g.name, g.outcomes.map(function (o) { return oddsRowHtml(o.genotype, o.pct, o.effect); }).join(''));
    });
    html += '</details>';
    if (c.untested.length) {
      html += '<p class="notes-line">Not known on both parents, so left out: ' + L.esc(c.untested.join(', ')) + '.</p>';
    }
    html += '<p class="notes-line">Assumes each gene is passed on independently, 50% from each parent. Extra genes you haven\'t set count as not present. Colour names follow standard equine genetics; Horse Reality may label some combinations differently.</p>';
    return html;
  }

  // ---------- passport (genetics/pedigree/pregnancy cache) rendering ----------
  // state.horseInfo is keyed by life number and populated by content.js from
  // ANY horse page viewed (not just owned stallions), so both a stallion's
  // and a mare's detail view can pull the same richer snapshot by that key.
  function passportTagsHtml(info) {
    if (!info) return '';
    var tags = [];
    if (info.geneticPotential != null) tags.push('<span class="tag mono">GP ' + L.esc(info.geneticPotential) + '</span>');
    if (info.conformation) tags.push('<span class="tag mono">' + L.esc(info.conformation) + '</span>');
    if (info.testedColours) tags.push('<span class="tag mono">' + L.esc(info.testedColours) + '</span>');
    var extraGenes = info.lifeNumber ? savedGenesText(info.lifeNumber) : '';
    if (extraGenes) tags.push('<span class="tag mono" title="Entered by hand">' + L.esc(extraGenes) + '</span>');
    var paidTags = info.lifeNumber ? purchaseTagsHtml(info.lifeNumber) : '';
    if (paidTags) tags.push(paidTags);
    if (info.training) tags.push('<span class="tag">' + L.esc(info.training) + '</span>');
    if (info.predicates) tags.push('<span class="tag">' + L.esc(info.predicates) + '</span>');
    if (info.height) tags.push('<span class="tag">' + L.esc(info.height) + '</span>');
    if (info.location) tags.push('<span class="tag">' + L.esc(info.location) + '</span>');
    if (info.dateOfBirth) tags.push('<span class="tag">Born ' + L.esc(info.dateOfBirth) + '</span>');
    if (info.coiRaw) tags.push('<span class="tag mono">' + L.esc(info.coiRaw) + '</span>');
    return tags.join('');
  }
  function ancestorHtml(a, label) {
    if (!a) return label + ': Unknown';
    var href = L.safeUrl(a.url);
    var nameHtml = href
      ? '<a href="' + L.esc(href) + '" target="_blank" rel="noopener noreferrer">' + L.esc(a.name || 'View') + '<span class="ext">↗</span></a>'
      : L.esc(a.name || 'Unknown');
    return label + ': ' + nameHtml + (a.scoreRaw ? ' <span class="mono">(' + L.esc(a.scoreRaw) + ')</span>' : '');
  }
  function pedigreeLineHtml(info) {
    if (!info || (!info.sire && !info.dam)) return '';
    return '<p class="notes-line">' + ancestorHtml(info.sire, 'Sire') + '<br>' + ancestorHtml(info.dam, 'Dam') + '</p>';
  }
  function passportOwnerHtml(info) {
    if (!info) return '';
    var lines = [];
    if (info.ownerName) {
      var oh = L.safeUrl(info.ownerUrl);
      lines.push('Owner: ' + (oh ? '<a href="' + L.esc(oh) + '" target="_blank" rel="noopener noreferrer">' + L.esc(info.ownerName) + '<span class="ext">↗</span></a>' : L.esc(info.ownerName)) + (info.ownerStable ? ' · ' + L.esc(info.ownerStable) : ''));
    }
    if (info.horseBreederName && info.horseBreederName !== info.ownerName) {
      var bh = L.safeUrl(info.horseBreederUrl);
      lines.push('Breeder: ' + (bh ? '<a href="' + L.esc(bh) + '" target="_blank" rel="noopener noreferrer">' + L.esc(info.horseBreederName) + '<span class="ext">↗</span></a>' : L.esc(info.horseBreederName)) + (info.horseBreederStable ? ' · ' + L.esc(info.horseBreederStable) : ''));
    }
    return lines.length ? '<p class="notes-line">' + lines.join(' &nbsp;·&nbsp; ') + '</p>' : '';
  }
  function pregnancyLineHtml(info) {
    if (!info || !info.pregnancy) return '';
    var p = info.pregnancy;
    if (!p.status && !p.dueText && !p.sireName) return '';
    var sireHref = L.safeUrl(p.sireUrl);
    var sireHtml = p.sireName
      ? (sireHref ? '<a href="' + L.esc(sireHref) + '" target="_blank" rel="noopener noreferrer">' + L.esc(p.sireName) + '<span class="ext">↗</span></a>' : L.esc(p.sireName))
      : '';
    return '<p class="notes-line"><strong>' + L.esc(p.status || 'Pregnant') + '</strong>' +
      (p.dueText ? ' — ' + L.esc(p.dueText) : '') +
      (sireHtml ? ' — sire: ' + sireHtml : '') +
      '</p>';
  }

  function renderDetail() {
    var s = state.stallions.find(function (x) { return x.id === selectedId; });
    if (!s) { selectedId = null; return renderStallionsList(); }
    var breedings = (state.breedings[selectedId] || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var passportInfo = (state.horseInfo && s.lifeNumber) ? state.horseInfo[s.lifeNumber] : null;

    var earnedTotals = {};
    breedings.forEach(function (b) {
      var cur = b.currency || 'HRC';
      earnedTotals[cur] = (earnedTotals[cur] || 0) + (Number(b.price) || 0);
    });
    var earnedLine = L.moneyLine(earnedTotals);
    var mareKeysForStallion = {};
    breedings.forEach(function (b) { if (b.mareName) mareKeysForStallion[L.mareKey(b)] = true; });
    var stallionMareCount = Object.keys(mareKeysForStallion).length;

    var ownedList = getOwnedStallions();
    var stallionIdx = ownedList.findIndex(function (x) { return x.id === selectedId; });
    var stallionHref = s.lifeNumber ? L.safeUrl('https://www.horsereality.com/horses/' + s.lifeNumber + '/') : '';

    var html = '<div class="detail-nav">' +
      '<button class="back-link" data-action="back-to-list">← All stallions</button>' +
      (ownedList.length > 1 ? '<div class="detail-nav-btns">' +
        '<button class="btn btn-sm" data-action="nav-stallion" data-dir="prev">‹ Previous</button>' +
        '<button class="btn btn-sm" data-action="nav-stallion" data-dir="next">Next ›</button>' +
      '</div>' : '') +
    '</div>';

    if (editingStallion) {
      html += renderStallionForm(s);
    } else {
      html += '<div class="detail-head"><div class="name-row">' +
        (s.imageUrl ? '<img class="portrait" src="' + L.esc(s.imageUrl) + '" alt="">' : '') +
        '<div><h1>' + L.esc(s.name) + '</h1>' +
        '<div class="tags">' +
          (s.owned === false ? '<span class="tag">Not your stud — tracked for a mare\'s breeding history</span>' : '') +
          (s.lifeNumber ? '<span class="tag mono">#' + L.esc(s.lifeNumber) + '</span>' : '') +
          (s.breed ? '<span class="tag">' + L.esc(s.breed) + '</span>' : '') +
          (s.color ? '<span class="tag">' + L.esc(s.color) + '</span>' : '') +
          L.CURRENCIES.map(function (c) { return s['feePublic' + c] ? '<span class="tag mono">Public ' + L.fmtMoney(s['feePublic' + c]) + ' ' + c + '</span>' : ''; }).join('') +
          L.CURRENCIES.map(function (c) { return s['feePrivate' + c] ? '<span class="tag mono">Private ' + L.fmtMoney(s['feePrivate' + c]) + ' ' + c + '</span>' : ''; }).join('') +
          passportTagsHtml(passportInfo) +
        '</div>' +
        (s.notes ? '<p class="notes-line">' + L.esc(s.notes) + '</p>' : '') +
        pedigreeLineHtml(passportInfo) +
        passportOwnerHtml(passportInfo) +
        (stallionHref ? '<p class="notes-line"><a href="' + L.esc(stallionHref) + '" target="_blank" rel="noopener noreferrer">View on Horse Reality<span class="ext">↗</span></a></p>' : '') +
        (s.lifeNumber ? renderAgeControlHtml(s.lifeNumber) : '') +
        '</div>' +
      '</div>' +
        '<div class="detail-actions">' +
          (s.owned === false ? '<button class="btn btn-sm btn-primary" data-action="mark-stallion-owned" data-id="' + s.id + '" title="He was only tracked because a mare\'s breeding record named him — mark him as your own stallion to list him on the Stallions tab.">Mark as My Stallion</button>' : '') +
          '<select class="pill-select ' + L.stallionStatusClass(s.status || 'Active') + '" data-action="update-stallion-status" data-id="' + s.id + '">' +
            ['Active', 'Sold', 'Retired'].map(function (opt) { return '<option' + (opt === (s.status || 'Active') ? ' selected' : '') + '>' + opt + '</option>'; }).join('') +
          '</select>' +
          '<button class="btn btn-sm" data-action="edit-stallion">Edit</button>' +
          '<button class="btn btn-sm btn-danger" data-action="delete-stallion" data-id="' + s.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }

    html += geneDetailsHtml(s.lifeNumber);
    html += purchaseDetailsHtml(s.lifeNumber);

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + breedings.length + '</div><div class="label">Breedings</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + stallionMareCount + '</div><div class="label">Mares</div></div>' +
      '<div class="stat-tile"><div class="' + (earnedLine.indexOf('·') > -1 ? 'num mono multi' : 'num mono') + '">' + earnedLine + '</div><div class="label">Total earned</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Breeding Ledger</h2>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-sm" data-action="toggle-import">' + (importingBreeding ? 'Close' : 'Import') + '</button>' +
        '<button class="btn btn-primary btn-sm" data-action="toggle-add-breeding">' + (addingBreeding ? 'Close' : '+ Add Breeding') + '</button>' +
      '</div></div>';

    if (importingBreeding) html += renderImportForm(s);
    if (addingBreeding) html += renderBreedingForm();

    if (breedings.length === 0 && !addingBreeding && !importingBreeding) {
      html += '<div class="empty"><h3>No breedings logged</h3>' +
        '<p>Record the first mare bred to ' + L.esc(s.name) + ', or just browse his bank/offspring pages on Horse Reality.</p>' +
        '<button class="btn btn-primary" data-action="toggle-add-breeding">+ Add Breeding</button></div>';
    } else if (breedings.length) {
      html += '<div class="ledger">';
      html += '<div class="ledger-head"><div>Date</div><div>Mare</div><div>Owner</div><div>Price</div><div>Status</div><div></div></div>';
      html += '<div class="card">';
      breedings.forEach(function (b, i) { html += renderBreedingRow(b, i); });
      html += '</div></div>';
    }

    return html;
  }

  // ---------- events ----------
  function wireEvents() {
    var app = document.getElementById('app');
    app.onclick = function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var action = t.getAttribute('data-action');

      if (action === 'show-tab') {
        activeTab = t.getAttribute('data-tab');
        selectedMareKey = null; selectedId = null; selectedPassportLife = null;
        render();
      }
      else if (action === 'toggle-add-stallion') { addingStallion = !addingStallion; render(); }
      else if (action === 'cancel-stallion-form') { addingStallion = false; editingStallion = false; render(); }
      else if (action === 'edit-stallion') { editingStallion = true; render(); }
      else if (action === 'mark-stallion-owned') { updateStallionRec(t.getAttribute('data-id'), { owned: true }); }
      else if (action === 'age-up-horse') { adjustAgeMonths(t.getAttribute('data-life'), 6); }
      else if (action === 'age-down-horse') { adjustAgeMonths(t.getAttribute('data-life'), -6); }
      else if (action === 'open-stallion') {
        selectedId = t.getAttribute('data-id');
        selectedMareKey = null;
        selectedPassportLife = null;
        addingBreeding = false; editingStallion = false;
        render();
      }
      else if (action === 'open-mare') {
        selectedMareKey = t.getAttribute('data-key');
        selectedId = null;
        render();
      }
      else if (action === 'back-to-mares') { selectedMareKey = null; render(); }
      else if (action === 'back-to-list') { selectedId = null; editingStallion = false; addingBreeding = false; render(); }
      else if (action === 'open-passport') { selectedPassportLife = t.getAttribute('data-life'); selectedId = null; selectedMareKey = null; render(); }
      else if (action === 'close-passport') { selectedPassportLife = null; render(); }
      else if (action === 'clear-search') { horseSearchQuery = ''; render(); }
      else if (action === 'untrack-horse') { setHorseMeta(t.getAttribute('data-life'), { tracked: false }); }
      else if (action === 'toggle-archive') { showArchive = !showArchive; render(); }
      else if (action === 'nav-stallion') {
        var ownedNav = getOwnedStallions();
        var curIdx = ownedNav.findIndex(function (x) { return x.id === selectedId; });
        if (curIdx > -1 && ownedNav.length > 1) {
          var dir = t.getAttribute('data-dir') === 'prev' ? -1 : 1;
          var nextIdx = (curIdx + dir + ownedNav.length) % ownedNav.length;
          selectedId = ownedNav[nextIdx].id;
          editingStallion = false; addingBreeding = false;
          render();
        }
      }
      else if (action === 'nav-mare') {
        var curMareIdx = maresIndex.findIndex(function (x) { return x.key === selectedMareKey; });
        if (curMareIdx > -1 && maresIndex.length > 1) {
          var mareDir = t.getAttribute('data-dir') === 'prev' ? -1 : 1;
          var nextMareIdx = (curMareIdx + mareDir + maresIndex.length) % maresIndex.length;
          selectedMareKey = maresIndex[nextMareIdx].key;
          render();
        }
      }
      else if (action === 'toggle-add-breeding') { addingBreeding = !addingBreeding; render(); }
      else if (action === 'cancel-breeding-form') { addingBreeding = false; render(); }
      else if (action === 'toggle-import') { importingBreeding = !importingBreeding; importError = ''; render(); }
      else if (action === 'export-backup') { exportBackup(); }
      else if (action === 'restore-backup') {
        var fileInput = document.getElementById('restore-file-input');
        if (fileInput) fileInput.click();
      }
      else if (action === 'cancel-import-form') { importingBreeding = false; importError = ''; render(); }
      else if (action === 'delete-stallion') {
        var sid = t.getAttribute('data-id');
        var s = state.stallions.find(function (x) { return x.id === sid; });
        askConfirm('Delete ' + (s ? s.name : 'this stallion') + ' and remove him from the ledger? His logged breedings will no longer be reachable.', function () {
          deleteStallionRec(sid);
          selectedId = null;
        });
      }
      else if (action === 'delete-breeding') {
        var bid = t.getAttribute('data-id');
        var bsid = t.getAttribute('data-sid') || selectedId;
        askConfirm('Delete this breeding record?', function () { deleteBreeding(bsid, bid); });
      }
      else if (action === 'confirm-no') { pendingConfirm = null; render(); }
      else if (action === 'confirm-yes') {
        var fn = pendingConfirm && pendingConfirm.onYes;
        pendingConfirm = null;
        if (fn) fn();
        render();
      }
      else if (t.getAttribute('data-role') === 'overlay' && e.target === t) { pendingConfirm = null; render(); }
    };

    app.onsubmit = function (e) {
      var t = e.target.closest('[data-action]');
      if (!t) return;
      e.preventDefault();
      var action = t.getAttribute('data-action');
      var fd = new FormData(t);

      if (action === 'submit-search') {
        horseSearchQuery = (fd.get('query') || '').trim();
        render();
      }
      else if (action === 'set-age-times') {
        setAgeTimes(t.getAttribute('data-life'), fd.get('times'));
      }
      else if (action === 'submit-stallion') {
        var data = {
          name: (fd.get('name') || '').trim(),
          lifeNumber: (fd.get('lifeNumber') || '').trim(),
          breed: (fd.get('breed') || '').trim(),
          color: (fd.get('color') || '').trim(),
          imageUrl: (fd.get('imageUrl') || '').trim(),
          notes: (fd.get('notes') || '').trim()
        };
        L.CURRENCIES.forEach(function (c) {
          data['feePublic' + c] = fd.get('feePublic' + c) ? Number(fd.get('feePublic' + c)) : null;
          data['feePrivate' + c] = fd.get('feePrivate' + c) ? Number(fd.get('feePrivate' + c)) : null;
        });
        if (!data.name) return;
        if (t.getAttribute('data-mode') === 'edit') {
          updateStallionRec(t.getAttribute('data-id'), data);
          editingStallion = false;
        } else {
          addStallion(data);
          addingStallion = false;
        }
        render();
      }
      else if (action === 'submit-breeding') {
        var bdata = {
          mareName: (fd.get('mareName') || '').trim(),
          mareLifeNumber: (fd.get('mareLifeNumber') || '').trim(),
          mareUrl: (fd.get('mareUrl') || '').trim(),
          breederName: (fd.get('breederName') || '').trim(),
          breederUrl: (fd.get('breederUrl') || '').trim(),
          price: fd.get('price') ? Number(fd.get('price')) : null,
          currency: fd.get('currency') || 'HRC',
          feeType: fd.get('feeType') || 'Public',
          date: fd.get('date') || L.todayStr(),
          status: fd.get('status') || 'Pending',
          foalName: (fd.get('foalName') || '').trim(),
          foalUrl: (fd.get('foalUrl') || '').trim(),
          foalScore: fd.get('foalScore') ? Number(fd.get('foalScore')) : null,
          notes: (fd.get('notes') || '').trim()
        };
        if (!bdata.mareName) return;
        addBreeding(selectedId, bdata);
        addingBreeding = false;
        render();
      }
      else if (action === 'submit-import') {
        var raw = fd.get('json') || '';
        var parsed;
        try { parsed = JSON.parse(raw); }
        catch (err) { importError = 'That doesn\'t look like valid JSON.'; render(); return; }
        if (!Array.isArray(parsed)) { importError = 'Expected a JSON array of records.'; render(); return; }
        if (!parsed.length) { importError = 'No records found in that data.'; render(); return; }
        var imported = 0, updated = 0;
        var skipped = [];
        parsed.forEach(function (row) {
          if (!row || !row.mareName) return;
          var targetId = selectedId;
          if (row.stallionName || row.stallionLifeNumber) {
            var matchId = L.findStallionMatch(state.stallions, row);
            if (matchId) { targetId = matchId; }
            else { skipped.push(row.stallionName || ('life #' + row.stallionLifeNumber)); return; }
          }
          if (!targetId) return;
          var normalized = {
            mareName: String(row.mareName).trim(),
            mareLifeNumber: row.mareLifeNumber ? String(row.mareLifeNumber).trim() : '',
            mareUrl: row.mareUrl ? String(row.mareUrl).trim() : '',
            breederName: row.breederName ? String(row.breederName).trim() : '',
            breederUrl: row.breederUrl ? String(row.breederUrl).trim() : '',
            price: row.price ? Number(row.price) : null,
            currency: L.CURRENCIES.indexOf(row.currency) > -1 ? row.currency : 'HRC',
            feeType: row.feeType === 'Private' ? 'Private' : 'Public',
            date: row.date || '',
            status: row.status || 'Pending',
            foalName: row.foalName ? String(row.foalName).trim() : '',
            foalUrl: row.foalUrl ? String(row.foalUrl).trim() : '',
            foalScore: row.foalScore ? Number(row.foalScore) : null,
            notes: row.notes ? String(row.notes).trim() : ''
          };
          var existing = findExistingBreeding(targetId, normalized);
          if (existing) { updateBreedingRec(targetId, existing.id, normalized); updated++; }
          else { addBreeding(targetId, normalized); imported++; }
        });
        if (!imported && !updated && !skipped.length) { importError = 'None of those records had a mare name — nothing was imported.'; render(); return; }
        if (skipped.length) {
          var uniqueSkipped = skipped.filter(function (v, i, a) { return a.indexOf(v) === i; });
          importError = 'Added ' + imported + ', updated ' + updated + '. Skipped ' + skipped.length + ' for stud(s) not yet in your book: ' + uniqueSkipped.join(', ') + '.';
          render();
          return;
        }
        importingBreeding = false;
        importError = '';
        render();
      }
    };

    app.onchange = function (e) {
      if (e.target.id === 'restore-file-input') {
        handleRestoreFile(e.target.files && e.target.files[0]);
        return;
      }
      var t = e.target.closest('[data-action]');
      if (!t) return;
      var action = t.getAttribute('data-action');
      if (action === 'update-breeding-status') {
        var bsid2 = t.getAttribute('data-sid') || selectedId;
        updateBreedingRec(bsid2, t.getAttribute('data-id'), { status: t.value });
      }
      else if (action === 'update-stallion-status') {
        var sid3 = t.getAttribute('data-id');
        var newStatus = t.value;
        updateStallionRec(sid3, { status: newStatus });
        if (newStatus === 'Retired' && state.settings.autoDeleteRetired) {
          deleteStallionRec(sid3);
          if (selectedId === sid3) selectedId = null;
        }
      }
      else if (action === 'calc-mare') { calcMare = t.value; render(); }
      else if (action === 'calc-stallion') { calcStallion = t.value; render(); }
      else if (action === 'horse-purchase') { setHorsePurchase(t.getAttribute('data-life'), t.getAttribute('data-field'), t.value); }
      else if (action === 'horse-gene') { setHorseGene(t.getAttribute('data-life'), t.getAttribute('data-locus'), t.value); }
      else if (action === 'herd-status') { setHorseMeta(t.getAttribute('data-life'), { status: t.value }); }
      else if (action === 'herd-scores') { setHorseMeta(t.getAttribute('data-life'), { confScores: parseScores(t.value) }); }
      else if (action === 'herd-role') { setHorseMeta(t.getAttribute('data-life'), { role: t.value }); }
      else if (action === 'herd-project') { setHorseMeta(t.getAttribute('data-life'), { project: t.value.trim() }); }
      else if (action === 'herd-filter-role') { herdRoleFilter = t.value; render(); }
      else if (action === 'herd-filter-project') { herdProjectFilter = t.value; render(); }
      else if (action === 'toggle-auto-delete') {
        state.settings.autoDeleteRetired = t.checked;
        persist();
      }
      else if (action === 'update-username') {
        state.settings.myUsername = t.value.trim();
        L.adoptOwnedStallions(state);
        persist();
      }
    };
  }

  // ---------- boot ----------
  HRStorage.getState(function (loaded) {
    state = loaded;
    if (L.adoptOwnedStallions(state)) { persist(); return; }
    recompute();
    render();
  });

  // Live-update if a content script writes new data while this tab is open.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.hrLedger) return;
    state = changes.hrLedger.newValue || HRStorage.defaultState();
    if (!state.breedings) state.breedings = {};
    if (!state.horseInfo) state.horseInfo = {};
    if (!state.horseMeta) state.horseMeta = {};
    if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
    recompute();
    render();
  });
})();
