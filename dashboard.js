(function () {
  'use strict';
  var L = HRLib;

  // opened in Chrome's side panel (hrl panel): a narrow layout (see html.sidepanel in dashboard.html)
  if (/[?&]sidepanel=1/.test(location.search)) document.documentElement.classList.add('sidepanel');
  var state = HRStorage.defaultState();
  var allBreedingsFlat = [];
  var aggregates = {};
  var uniqueMareCount = 0;
  var maresIndex = [];
  var activeTab = 'stallions';
  var calcShowAll = false; // Foal Calculator suggestions: also list partners whose foal would not be better
  var calcSuggOpen = {}; // which suggestion panels are open
  var anOpen = {}; // Analytics: which sections are open (by title)
  var herdSub = ''; // My Herd has a submenu: '' = the herd, 'retired' = retired horses
  var listSort = {}; // the sort order chosen for each list tab
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
  var suggestLife = null;
  var calcMare = '';
  var calcStallion = '';
  var listFilterText = '';
  var bulkMode = false, bulkSel = {}; // My Herd: choose several horses, then add or remove a tag on all of them
  var compareA = '', compareB = '';
  var goalsEdit = 'mare'; // which goal set the Highlight goals panel is editing when mares and stallions have their own
  var calcBreed = '', compareBreed = '';
  var activeBreed = ''; // the breed picked at the top of every page ('' = all breeds)
  function breedOk(breed) { return !activeBreed || L.breedKeyOf(breed) === L.breedKeyOf(activeBreed); }
  function lifeBreedOk(life) {
    if (!activeBreed) return true;
    var info = state.horseInfo && state.horseInfo[life];
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
    return breedOk((info && info.breed) || (rec && rec.breed) || '');
  }
  // The ledger as seen through the chosen breed (for the numbers on Analytics, the calendar and so on).
  function viewState() {
    if (!activeBreed) return state;
    var key = L.breedKeyOf(activeBreed), info = {};
    Object.keys(state.horseInfo || {}).forEach(function (l) { if (L.breedKey(state.horseInfo[l]) === key) info[l] = state.horseInfo[l]; });
    return Object.assign({}, state, {
      horseInfo: info,
      stallions: (state.stallions || []).filter(function (s) { var i = state.horseInfo[s.lifeNumber]; return L.breedKeyOf((i && i.breed) || s.breed) === key; })
    });
  }
  function defaultCompareFilter() { return { adult: true, young: true, mine: true, other: true, mares: true, stallions: true, sugg: false }; }
  var compareFilter = { a: defaultCompareFilter(), b: defaultCompareFilter() };
  var UI_KEY = 'hrLedgerUi';
  function defaultCalcFilter() { return { adult: true, young: true, mine: true, other: true, sugg: false }; }
  var calcFilter = { mare: defaultCalcFilter(), stallion: defaultCalcFilter() };
  function saveUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: activeTab === 'calc' ? 'calc' : '', calcMare: calcMare, calcStallion: calcStallion, calcFilter: calcFilter, calcBreed: calcBreed, activeBreed: activeBreed, sort: listSort, an: anOpen })); } catch (e) {}
  }
  try {
    var savedUi = JSON.parse(localStorage.getItem(UI_KEY) || '{}');
    if (savedUi.calcMare) calcMare = String(savedUi.calcMare);
    if (savedUi.calcStallion) calcStallion = String(savedUi.calcStallion);
    if (savedUi.calcBreed) calcBreed = String(savedUi.calcBreed);
    if (savedUi.activeBreed) { activeBreed = String(savedUi.activeBreed); }
    if (savedUi.calcFilter) ['mare', 'stallion'].forEach(function (k) { if (savedUi.calcFilter[k]) calcFilter[k] = Object.assign(defaultCalcFilter(), savedUi.calcFilter[k]); });
    if (savedUi.tab === 'calc') activeTab = 'calc';
    if (savedUi.tab === 'young') activeTab = 'colts';
    if (savedUi.sort && typeof savedUi.sort === 'object') listSort = savedUi.sort;
    if (savedUi.an && typeof savedUi.an === 'object') anOpen = savedUi.an;
  } catch (e) {}

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
        // a stallion is never a mare: skip a record whose "mare" is a horse known to be a stallion, one of your own studs,
        // or the stud of that very record (a misread row)
        if (mareInfo && mareInfo.sex === 'stallion') return;
        if (b.mareLifeNumber && state.stallions.some(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(b.mareLifeNumber); })) return;
        var recStud = state.stallions.find(function (x) { return x.id === b.stallionId; });
        if (recStud && (String(recStud.name || '').trim().toLowerCase() === String(b.mareName).trim().toLowerCase() || (recStud.lifeNumber && b.mareLifeNumber && String(recStud.lifeNumber) === String(b.mareLifeNumber)))) return;
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
    // the name on the horse's own page is the current one: a mare that has been renamed shows under the new name
    Object.keys(map).forEach(function (k) {
      var mi = map[k].mareLifeNumber && state.horseInfo && state.horseInfo[map[k].mareLifeNumber];
      var nm = mi && String(mi.name || '').replace(/\u2186/g, '').replace(/^\s*!/, '').replace(/\s*\|\s*$/, '').replace(/\s+/g, ' ').trim();
      if (nm) map[k].mareName = nm;
    });
    maresIndex = Object.keys(map).map(function (k) { return map[k]; })
      .filter(function (m) { return isAdultHorse(m.mareLifeNumber) && !movedOut(m.mareLifeNumber); });
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
    var delRec = state.stallions.find(function (s) { return s.id === id; });
    if (delRec) L.trashPush(state, { kind: 'stallion', name: delRec.name, data: JSON.parse(JSON.stringify({ stallion: delRec, breedings: state.breedings[id] || [] })) });
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
    var delRow = (state.breedings[sid] || []).find(function (b) { return b.id === id; });
    if (delRow) L.trashPush(state, { kind: 'breeding', name: (delRow.mareName || 'Breeding') + (delRow.date ? ' ' + delRow.date : ''), data: JSON.parse(JSON.stringify({ sid: sid, row: delRow })) });
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
    // the pictures are stored apart from the ledger: bring them in so the backup holds everything
    HRStorage.hydrateImages(function () { HRStorage.applyImages(state); writeBackupFile(); });
  }
  function writeBackupFile() {
    state.settings.lastBackupAt = Date.now();
    HRStorage.setState(state, function () {});
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
  // Breeds saved in the ledger, with a way to clear out other players' horses of a breed you do not keep
  function breedCleanupHtml() {
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase(), by = {};
    Object.keys(state.horseInfo || {}).forEach(function (l) {
      var i = state.horseInfo[l], k = L.breedKeyOf(i.breed) || '(none)';
      var g = by[k] = by[k] || { key: k, name: i.breed || 'No breed saved', mine: 0, others: 0 };
      if (me && String(i.ownerName || '').trim().toLowerCase() === me) g.mine++; else g.others++;
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return (b.mine + b.others) - (a.mine + a.others); });
    if (!rows.length) return '';
    return '<div class="card" style="padding:14px 16px;margin-bottom:14px;"><strong>Breeds in your ledger</strong>' +
      '<p class="notes-line" style="margin:6px 0 10px;">Every horse whose page you have opened is saved, whoever owns it. To clear out a breed you do not keep, remove the other players\u2019 horses of it. Your own horses are never touched here. Removed horses stay in <em>Recently deleted</em> for 30 days and the ledger will not save them again.</p>' +
      '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Breed</th><th class="num">Yours</th><th class="num">Other players\u2019</th><th></th></tr></thead><tbody>' + rows.map(function (g) {
        return '<tr><td>' + L.esc(g.name) + '</td><td class="num mono">' + g.mine + '</td><td class="num mono">' + g.others + '</td><td class="num">' +
          (g.others ? '<button type="button" class="btn btn-sm" style="border-color:var(--danger);color:var(--danger);" data-action="remove-breed-others" data-breed="' + L.esc(g.key) + '" data-name="' + L.esc(g.name) + '" data-count="' + g.others + '">Remove ' + g.others + '</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  // ---------- settings ----------
  // Everything you set up in one place, instead of panels above every list: who you are, backups, highlight goals, notes and
  // preferences (breeder focus, partners, genes, switches), and purchase criteria.
  var settingsSeen = false;
  function renderSettings() {
    // the panels start open the first time this page is shown
    if (!settingsSeen) { settingsSeen = true; goalsOpen = true; notesOpen = true; buyOpen = true; }
    var s = state.settings || {};
    var html = topHeaderHtml();
    html += '<div class="section-head"><h2>Settings</h2></div>';
    html += '<div class="card" style="padding:14px 16px;margin-bottom:14px;"><strong>You</strong>' +
      '<div class="settings-row" style="margin:10px 0 0;">' +
        '<label class="username-setting">My Horse Reality username<input type="text" data-action="update-username" value="' + L.esc(s.myUsername) + '" placeholder="e.g. Nemoriamini"></label>' +
        '<label class="settings-toggle"><input type="checkbox" data-action="toggle-auto-delete"' + (s.autoDeleteRetired ? ' checked' : '') + '> Automatically delete stallions marked Retired</label>' +
      '</div>' +
      '<p class="notes-line" style="margin:8px 0 0;">The username is how the ledger knows which horses are yours rather than a customer\'s or another player\'s.</p></div>';
    html += '<div class="card" style="padding:14px 16px;margin-bottom:14px;"><strong>Backup</strong>' +
      '<p class="notes-line" style="margin:6px 0 10px;">Your ledger lives only in this browser. ' + (s.lastBackupAt ? 'Last backup: ' + L.esc(L.fmtDate(isoFromMs(s.lastBackupAt))) + '.' : 'No backup saved yet.') + ' A backup file holds everything, including the horse pictures, and restores it all.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
        '<button class="btn btn-sm btn-primary" data-action="export-backup" title="Save your entire ledger as a JSON file">Export backup</button>' +
        '<button class="btn btn-sm" data-action="restore-backup" title="Replace your ledger with a previously exported backup">Restore backup</button>' +
        '<input type="file" id="restore-file-input" accept="application/json" style="display:none;">' +
      '</div></div>';
    html += breedCleanupHtml();
    html += goalsPanelHtml();
    html += notesPanelHtml();
    html += purchasePanelHtml();
    var version = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || '';
    html += '<p class="notes-line" style="margin:14px 0 0;">HR Stallion &amp; Mare Ledger ' + (version ? 'v' + L.esc(version) : '') + ' \u00b7 <a href="manual.html" target="_blank" rel="noopener">User manual</a></p>';
    return html;
  }
  // A change inside an open box (a gene, a price, a score) redraws the page; the boxes that were open stay open as long as it is
  // the same page with the same boxes.
  function detailsSig(n) { return [activeTab, herdSub, selectedId, selectedMareKey, selectedPassportLife, suggestLife, n].join('|'); }
  function captureDetails() {
    var app = document.getElementById('app');
    if (!app) return null;
    var ds = app.querySelectorAll('details');
    return { sig: detailsSig(ds.length), opens: Array.prototype.map.call(ds, function (x) { return x.open; }) };
  }
  function restoreDetails(saved) {
    var app = document.getElementById('app');
    if (!saved || !app) return;
    var ds = app.querySelectorAll('details');
    if (detailsSig(ds.length) !== saved.sig) return;
    Array.prototype.forEach.call(ds, function (x, i) { if (saved.opens[i] && !x.open) x.open = true; else if (!saved.opens[i] && x.open) x.open = false; });
  }
  function render() {
    var app = document.getElementById('app');
    var html;
    if (suggestLife) html = renderSuggestions();
    else if (selectedPassportLife) html = renderPassportDetail();
    else if (selectedId) html = renderDetail();
    else if (selectedMareKey) html = renderMareDetail();
    else if (activeTab === 'mares') html = renderMaresList();
    else if (activeTab === 'colts') html = renderYoungList('stallion');
    else if (activeTab === 'fillies') html = renderYoungList('mare');
    else if (activeTab === 'herd') html = herdSub === 'retired' ? renderRetiredList() : renderHerdList();
    else if (activeTab === 'others') html = renderOthersList();
    else if (activeTab === 'retired') { activeTab = 'herd'; herdSub = 'retired'; html = renderRetiredList(); }
    else if (activeTab === 'analytics') html = renderAnalytics();
    else if (activeTab === 'calc') html = renderCalculator();
    else if (activeTab === 'settings') html = renderSettings();
    else html = renderStallionsList();
    var keptOpen = captureDetails();
    app.removeAttribute('data-an');
    app.innerHTML = html;
    restoreDetails(keptOpen);
    if (pendingConfirm) {
      var wrap = document.createElement('div');
      wrap.innerHTML = renderConfirm();
      app.appendChild(wrap.firstElementChild);
    }
    wireEvents();
    applyListSort();
    applyListFilter();
    if (activeTab === 'analytics' && !suggestLife && !selectedPassportLife && !selectedId && !selectedMareKey) enhanceAnalytics();
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
  var REVIEW_DAYS = 5; // a covering is settled 48 hours after breeding (wiki: Life); it is listed for review on day 5
  function renderNeedsReviewHtml() {
    var candidates = HRLib.findReviewCandidates(state, REVIEW_DAYS);
    if (!candidates.length) return '';
    candidates.sort(function (a, b) { return b.days - a.days; });
    var html = '<div class="empty" style="border-color:#d97706;text-align:left;margin-bottom:16px;">' +
      '<h3 style="color:#d97706;">' + candidates.length + ' covering' + (candidates.length === 1 ? '' : 's') + ' ready to review</h3>' +
      '<p style="margin-top:0;">Still marked Pending ' + REVIEW_DAYS + '+ days after breeding with no foal recorded yet. Horse Reality announces a failed covering on day 2 and a miscarriage on day 4, but only to the ' +
      '<em>mare\'s</em> owner. From day 5 her page says "Due on ..." if she is in foal (the foal then comes 13.5 to 17 days after breeding). Check her page: a covering is only marked Failed on its own when her page, seen on day 5 or later, shows no pregnancy, or when 17 days have passed with no foal.</p>';
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
      '</div>' + (document.documentElement.classList.contains('sidepanel') ? '<a class="btn btn-sm" style="text-decoration:none;" href="dashboard.html" target="_blank" rel="noopener" title="Open the full ledger in a tab">Full view ↗</a>' : '') + '<a class="btn btn-sm" style="text-decoration:none;" href="' + L.esc((chrome.runtime.getURL && chrome.runtime.getURL('manual.html')) || 'https://github.com/GoodaleEnt/hr-stallion-mare-ledger/blob/master/docs/MANUAL.md') + '" target="_blank" rel="noopener">User Manual</a></header>';

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

    html += backupReminderHtml();
    html += '<div class="tabs">' +
        '<button class="tab-btn' + (activeTab === 'stallions' ? ' active' : '') + '" data-action="show-tab" data-tab="stallions">Stallions</button>' +
        '<button class="tab-btn' + (activeTab === 'mares' ? ' active' : '') + '" data-action="show-tab" data-tab="mares">Mares</button>' +
        '<button class="tab-btn' + (activeTab === 'colts' ? ' active' : '') + '" data-action="show-tab" data-tab="colts">Colts</button>' +
        '<button class="tab-btn' + (activeTab === 'fillies' ? ' active' : '') + '" data-action="show-tab" data-tab="fillies">Fillies</button>' +
        '<button class="tab-btn' + (activeTab === 'herd' ? ' active' : '') + '" data-action="show-tab" data-tab="herd">My Herd</button>' +
        '<button class="tab-btn' + (activeTab === 'others' ? ' active' : '') + '" data-action="show-tab" data-tab="others">Other Horses</button>' +
        '<button class="tab-btn' + (activeTab === 'analytics' ? ' active' : '') + '" data-action="show-tab" data-tab="analytics">Analytics</button>' +
        '<button class="tab-btn' + (activeTab === 'calc' ? ' active' : '') + '" data-action="show-tab" data-tab="calc">Foal Calculator</button>' +
        '<button class="tab-btn' + (activeTab === 'settings' ? ' active' : '') + '" data-action="show-tab" data-tab="settings" title="Username, goals, notes, purchase criteria, breeder focus, partners and backups">\u2699 Settings</button>' +
      '</div>';
    var breedsHere = {}, breedNames = [];
    Object.keys(state.horseInfo || {}).forEach(function (l) {
      var b = state.horseInfo[l].breed, k = L.breedKeyOf(b);
      if (k && !breedsHere[k]) { breedsHere[k] = true; breedNames.push(b); }
    });
    (state.stallions || []).forEach(function (s) { var k = L.breedKeyOf(s.breed); if (k && !breedsHere[k]) { breedsHere[k] = true; breedNames.push(s.breed); } });
    var isListTab = ['stallions', 'mares', 'colts', 'fillies', 'herd', 'others'].indexOf(activeTab) > -1;
    if (activeTab !== 'settings' && (breedNames.length > 1 || activeBreed || isListTab)) {
      html += '<div style="margin:-6px 0 16px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;">';
      if (breedNames.length > 1 || activeBreed) {
        html += '<label for="global-breed" style="font-weight:600;font-size:13px;">Breed</label><select id="global-breed" data-action="global-breed"><option value="">All breeds</option>' +
          breedNames.sort().map(function (b) { return '<option value="' + L.esc(b) + '"' + (L.breedKeyOf(b) === L.breedKeyOf(activeBreed) ? ' selected' : '') + '>' + L.esc(b) + '</option>'; }).join('') + '</select>';
      }
      if (isListTab && activeTab !== 'others') html += sortSelectHtml();
      if (isListTab) html += '<input id="list-filter" type="search" data-action="list-filter" placeholder="Filter by name, breed, status or #tag\u2026" value="' + L.esc(listFilterText) + '" style="flex:1 1 240px;max-width:380px;">';
      html += '</div>';
    }
    return html;
  }
  // Reminder to export a backup: the ledger lives only in this browser.
  function backupReminderHtml() {
    var s = state.settings || {};
    var hasData = (state.stallions || []).length || Object.keys(state.horseInfo || {}).length;
    if (!hasData) return '';
    var now = Date.now(), DAY = 86400000;
    if (s.backupSnoozeUntil && now < s.backupSnoozeUntil) return '';
    if (s.lastBackupAt && now - s.lastBackupAt < 30 * DAY) return '';
    var days = s.lastBackupAt ? Math.floor((now - s.lastBackupAt) / DAY) : 0;
    return '<div class="card" style="padding:10px 14px;margin:0 0 14px;display:flex;flex-wrap:wrap;gap:10px;align-items:center;border-color:var(--accent-2);">' +
      '<span style="flex:1 1 280px;">' + (s.lastBackupAt ? 'Your last backup was ' + days + ' days ago.' : 'You haven\'t saved a backup yet.') + ' Your ledger lives only in this browser, so export a copy now and then.</span>' +
      '<button type="button" class="btn btn-sm btn-primary" data-action="export-backup">Export backup</button>' +
      '<button type="button" class="btn btn-sm" data-action="backup-snooze">Remind me in a week</button></div>';
  }
  // Hide the cards / rows that don't match the filter box (the list itself is not re-drawn).
  // ---------- sort order for the list tabs ----------
  var SORT_MODES = [
    ['', 'Order as listed'], ['name', 'Name A\u2013Z'], ['name-desc', 'Name Z\u2013A'], ['age', 'Age: oldest first'], ['age-young', 'Age: youngest first'],
    ['bt', 'Breed Total: high to low'], ['gp', 'Genetic potential: high to low'], ['conf', 'Conformation: high to low'],
    ['goals', 'Goals: met first'], ['rank', 'Keep / sell rank: best first'], ['ranged', 'Ranged first']
  ];
  function lifeOfEl(el) {
    var life = el.getAttribute('data-life') || (el.querySelector('[data-life]') && el.querySelector('[data-life]').getAttribute('data-life')) || '';
    if (!life && el.getAttribute('data-key')) { var mrec = maresIndex.find(function (x) { return x.key === el.getAttribute('data-key'); }); life = mrec && mrec.mareLifeNumber || ''; }
    if (!life && el.getAttribute('data-id')) { var srec = state.stallions.find(function (x) { return x.id === el.getAttribute('data-id'); }); life = srec && srec.lifeNumber || ''; }
    return life;
  }
  function sortValueOf(el, mode, ranking) {
    var life = lifeOfEl(el), info = (life && state.horseInfo[life]) || {}, meta = (life && state.horseMeta[life]) || {};
    if (mode === 'name' || mode === 'name-desc') {
      var rec = el.getAttribute('data-id') && state.stallions.find(function (x) { return x.id === el.getAttribute('data-id'); });
      return String(info.name || (rec && rec.name) || el.textContent || '').toLowerCase();
    }
    if (mode === 'age' || mode === 'age-young') { var m = L.effectiveAgeMonths(info); return m == null ? -1 : m; }
    if (mode === 'bt') { var b = highScoreInfo(life).bt; return b ? Number(b.value) : -1; }
    if (mode === 'gp') return Number(info.geneticPotential) || -1;
    if (mode === 'conf') return L.bestConformation(meta).best || -1;
    if (mode === 'goals') { if (!life) return -1; var c = L.goalCheck(state, life); return c.met ? 2 : (c.active && L.goalMisses(state, life).length === 1 ? 1 : 0); }
    if (mode === 'ranged') { var rg = life ? L.rangeStatus(state, life) : null; return rg ? (rg.ranged ? 1000 : 0) + rg.range : -1; }
    if (mode === 'rank') { var r = ranking && ranking[life]; return r && r.pct != null ? r.pct : (r && r.level ? r.level / 10 : -1); }
    return 0;
  }
  // Reorders the cards or rows already drawn (a list's own order is kept for "Order as listed")
  function applyListSort() {
    var mode = listSort[activeTab] || '';
    if (!mode) return;
    var app = document.getElementById('app');
    if (!app) return;
    var els = Array.prototype.slice.call(app.querySelectorAll('.stallion-card[data-action], .herd-row'));
    if (!els.length) return;
    var ranking = mode === 'rank' ? L.herdRanking(state) : null, parents = [];
    els.forEach(function (el) { if (parents.indexOf(el.parentElement) === -1) parents.push(el.parentElement); });
    parents.forEach(function (p) {
      var kids = els.filter(function (el) { return el.parentElement === p; });
      var keyed = kids.map(function (el, i) { return { el: el, v: sortValueOf(el, mode, ranking), i: i }; });
      keyed.sort(function (a, b) {
        var c;
        if (mode === 'name') c = a.v < b.v ? -1 : a.v > b.v ? 1 : 0;
        else if (mode === 'name-desc') c = a.v < b.v ? 1 : a.v > b.v ? -1 : 0;
        else if (mode === 'age-young') c = a.v - b.v;
        else c = b.v - a.v;
        return c || a.i - b.i;
      });
      keyed.forEach(function (k) { p.appendChild(k.el); });
    });
  }
  function sortSelectHtml() {
    var cur = listSort[activeTab] || '';
    return '<label for="list-sort" style="font-weight:600;font-size:13px;">Sort</label><select id="list-sort" data-action="list-sort">' + SORT_MODES.map(function (m) {
      return '<option value="' + m[0] + '"' + (m[0] === cur ? ' selected' : '') + '>' + L.esc(m[1]) + '</option>';
    }).join('') + '</select>';
  }
  function applyListFilter() {
    var q0 = listFilterText.trim().toLowerCase();
    // #tag terms narrow by tag (a part of a tag matches); the rest is text
    var tagTerms = (q0.match(/#[a-z0-9-]+/g) || []).map(function (t) { return t.slice(1); });
    var q = q0.replace(/#[a-z0-9-]+/g, ' ').replace(/\s+/g, ' ').trim();
    var app = document.getElementById('app');
    if (!app) return;
    app.querySelectorAll('.stallion-card[data-action], .herd-row').forEach(function (el) {
      var life = el.getAttribute('data-life') || (el.querySelector('[data-life]') && el.querySelector('[data-life]').getAttribute('data-life')) || '';
      if (!life && el.getAttribute('data-key')) { var mrec = maresIndex.find(function (x) { return x.key === el.getAttribute('data-key'); }); life = mrec && mrec.mareLifeNumber || ''; }
      if (!life && el.getAttribute('data-id')) { var srec = state.stallions.find(function (x) { return x.id === el.getAttribute('data-id'); }); life = srec && srec.lifeNumber || ''; }
      var note = life && state.horseMeta[life] && state.horseMeta[life].notes || '';
      var textOk = !q || ((el.textContent || '') + ' ' + note).toLowerCase().indexOf(q) > -1;
      var tagOk = !tagTerms.length || (life && L.tagQueryMatch(state, life, tagTerms));
      var breedShown = !life || lifeBreedOk(life);
      el.style.display = textOk && tagOk && breedShown ? '' : 'none';
    });
  }

  function renderPassportDetail() {
    var info = state.horseInfo[selectedPassportLife];
    if (!info) { selectedPassportLife = null; return renderStallionsList(); }
    var href = L.safeUrl('https://www.horsereality.com/horses/' + selectedPassportLife + '/');
    var html = '<button class="back-link" data-action="close-passport">' + (activeTab === 'herd' ? (herdSub === 'retired' ? '← Back to retired' : '← Back to herd') : activeTab === 'others' ? '← Back to other horses' : '← Back to search') + '</button>';
    html += suggestionsLinkHtml(selectedPassportLife);
    html += goalStripHtml(selectedPassportLife);
    html += '<div class="detail-head profile-goal' + goalClass(selectedPassportLife) + '"><div class="name-row">' +
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
    html += keeperPanelHtml(selectedPassportLife) + saleHistoryPanelHtml(selectedPassportLife) + geneticsPanelHtml(selectedPassportLife) + producerPanelHtml(selectedPassportLife) + healthPanelHtml(selectedPassportLife) + disciplinePanelHtml(selectedPassportLife) + showLogPanelHtml(selectedPassportLife);
    html += studProfilePanelHtml(selectedPassportLife);
    html += removeHorsePanelHtml(selectedPassportLife, info.name);
    html += purchaseDetailsHtml(selectedPassportLife) + scoreDetailsHtml(selectedPassportLife) + compPanelHtml(selectedPassportLife) + tagsPanelHtml(selectedPassportLife);
    html += saleDetailsHtml(selectedPassportLife);

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
        'she or he will also show up on the Stallions or Mares tab.</p></div>';
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
    return state.stallions.filter(function (s) { return s.owned !== false && isAdultHorse(s.lifeNumber) && lifeBreedOk(s.lifeNumber); });
  }

  // Cached passports (state.horseInfo) belonging to you, under 3 years old —
  // shown separately from the Stallions/Mares tabs, which are scoped to
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
        if (!breedOk(h.breed)) return false;
        if (movedOut(h.lifeNumber)) return false;
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
  // he/she drops out of Colts or Fillies and appears on the Stallions/My
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
  // Months older than the birth date: the owner of a horse can age it up (Delta Points), so its age is the age by birth date
  // plus the months it was aged up by. Entered here when Horse Reality's own age has not been read from the horse's page.
  function setAgedUpMonths(lifeNumber, months) {
    if (!lifeNumber) return;
    if (!state.horseInfo) state.horseInfo = {};
    var info = state.horseInfo[lifeNumber];
    if (!info) { info = {}; state.horseInfo[lifeNumber] = info; }
    info.agedUpMonths = Math.max(0, Math.round(Number(months) || 0));
    delete info.manualAgeMonths;
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
    var byBirth = info && info.dateOfBirth ? Math.round((L.ageYears(info.dateOfBirth, info.birthAt) || 0) * 12) : null;
    var up = info && info.agedUpMonths != null ? info.agedUpMonths : (info && info.manualAgeMonths != null && byBirth != null ? Math.max(0, info.manualAgeMonths - byBirth) : 0);
    return '<div class="row" style="align-items:center;flex-wrap:wrap;gap:8px;">' +
      '<span>' + (months != null ? L.formatAgeMonths(months) + ' (estimated)' : 'Age unknown') + '</span>' +
      '<form data-action="set-aged-up" data-life="' + L.esc(lifeNumber) + '" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">' +
        '<label style="font-size:11.5px;color:var(--text-muted);" title="Horse Reality\'s age is the age by birth date plus any months its owner aged it up with Delta Points">months older than its birth date</label>' +
        '<input type="number" min="0" step="1" name="months" value="' + up + '" style="width:64px;background:var(--surface-2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font-size:13px;color:var(--text);">' +
        '<button type="submit" class="btn btn-sm">Set</button>' +
      '</form>' +
      (byBirth != null ? '<span class="sub" style="font-size:11px;flex-basis:100%;">By birth date alone: ' + L.esc(L.formatAgeMonths(byBirth)) + '. Open the ranch page on Horse Reality and the real age is read for you.</span>' : '') +
    '</div>';
  }

  // How a group of horses stands against your highlight goals: meets all, misses exactly one box, misses more.
  // A horse with no data yet for a box is not counted as a miss (same rule as the goal boxes on its card).
  function goalTally(lives) {
    var t = { total: lives.length, meet: 0, one: 0, more: 0, goals: false };
    lives.forEach(function (life) {
      if (!life) return;
      var c = L.goalCheck(state, life);
      if (!c.active) return;
      t.goals = true;
      if (c.met) { t.meet++; return; }
      var n = L.goalMisses(state, life).length;
      if (n === 1) t.one++; else if (n > 1) t.more++;
    });
    return t;
  }
  function goalTallyHtml(t) {
    if (!t.goals) return '<div class="tally sub" style="font-size:12px;color:var(--text-muted);margin-top:6px;">Set highlight goals to see how many fit</div>';
    return '<div class="tally" style="font-size:12px;margin-top:6px;line-height:1.5;">' +
      '<div><span style="color:var(--success);font-weight:600;">' + t.meet + '</span> fit your goals</div>' +
      '<div><span style="color:var(--warn);font-weight:600;">' + t.one + '</span> off by one</div>' +
      '<div><span style="color:var(--danger);font-weight:600;">' + t.more + '</span> off by more</div></div>';
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
    var activeStallions = ownedStallions.filter(function (s) { return !movedOut(s.lifeNumber); });
    var activeMares = maresIndex.filter(function (m) { return !movedOut(m.mareLifeNumber) && lifeBreedOk(m.mareLifeNumber); });
    var stallionTally = goalTally(activeStallions.map(function (s) { return s.lifeNumber; }));
    var mareTally = goalTally(activeMares.map(function (m) { return m.mareLifeNumber; }));
    var youngNow = getYoungHorses();
    var activeColts = youngNow.filter(function (h) { return h.sex === 'stallion'; });
    var activeFillies = youngNow.filter(function (h) { return h.sex === 'mare'; });
    var coltTally = goalTally(activeColts.map(function (h) { return h.lifeNumber; }));
    var fillyTally = goalTally(activeFillies.map(function (h) { return h.lifeNumber; }));

    var html = topHeaderHtml();
    html += renderDebugPanel();

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + activeStallions.length + '</div><div class="label">Active stallions</div>' + goalTallyHtml(stallionTally) + '</div>' +
      '<div class="stat-tile"><div class="num mono">' + activeMares.length + '</div><div class="label">Active mares</div>' + goalTallyHtml(mareTally) + '</div>' +
      '<div class="stat-tile"><div class="num mono">' + activeColts.length + '</div><div class="label">Active colts</div>' + goalTallyHtml(coltTally) + '</div>' +
      '<div class="stat-tile"><div class="num mono">' + activeFillies.length + '</div><div class="label">Active fillies</div>' + goalTallyHtml(fillyTally) + '</div>' +
      '<div class="stat-tile"><div class="num mono">' + totalBreedings + '</div><div class="label">Breedings logged</div></div>' +
      '<div class="stat-tile"><div class="' + (totalEarnedLine.indexOf('·') > -1 ? 'num mono multi' : 'num mono') + '">' + totalEarnedLine + '</div><div class="label">Total earned</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Your Stallions</h2>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-sm" data-action="toggle-import">' + (importingBreeding ? 'Close' : 'Import') + '</button>' +
        '<button class="btn btn-primary btn-sm" data-action="toggle-add-stallion">' + (addingStallion ? 'Close' : '+ Add Stallion') + '</button>' +
      '</div></div>';

    if (!(state.settings.myUsername || '').trim()) html += '<div class="card" style="padding:10px 14px;margin:0 0 14px;border-color:var(--accent-2);">Set your Horse Reality username under <button type="button" class="link-btn" data-action="show-tab" data-tab="settings">Settings</button> so the ledger knows which horses are yours.</div>';

    if (importingBreeding) html += renderImportForm(null);
    if (addingStallion) html += renderStallionForm();

    var shownStallions = ownedStallions.filter(function (s) { return !movedOut(s.lifeNumber); });
    if (shownStallions.length === 0 && !addingStallion) {
      html += '<div class="empty"><h3>No stallions yet</h3>' +
        '<p>Browse to your bank page or a stallion\'s offspring page on Horse Reality and they\'ll appear here automatically — or add one by hand.</p>' +
        '<button class="btn btn-primary" data-action="toggle-add-stallion">+ Add Stallion</button></div>';
    } else if (shownStallions.length) {
      html += '<div class="stallion-grid">';
      shownStallions.forEach(function (s) {
        var a = aggregates[s.id] || { count: 0, totals: {} };
        var pubFee = L.feeObj(s, 'Public'), privFee = L.feeObj(s, 'Private');
        html += '<div class="card stallion-card' + goalClass(s.lifeNumber) + '" data-action="open-stallion" data-id="' + s.id + '">' +
          goalStripHtml(s.lifeNumber) + preferredGeneTagHtml(s.lifeNumber) +
          (s.status && s.status !== 'Active' ? '<span class="pill corner-badge ' + L.stallionStatusClass(s.status) + '">' + L.esc(s.status) + '</span>' : '') +
          (s.imageUrl ? '<img class="portrait" src="' + L.esc(s.imageUrl) + '" alt="">' : '') +
          '<h3>' + L.esc(s.name) + '</h3>' +
          (s.lifeNumber ? '<div class="lifenum mono">#' + L.esc(s.lifeNumber) + '</div>' : '') +
          '<div class="meta">' + L.esc([s.breed, s.color].filter(Boolean).join(' · ') || 'No breed set') + '</div>' +
          '<div class="row"><span>Public fee</span><span class="v fee mono">' + L.moneyLine(pubFee) + '</span></div>' +
          '<div class="row"><span>Private fee</span><span class="v fee mono">' + L.moneyLine(privFee) + '</span></div>' +
          studSemenRowHtml(s.lifeNumber) +
          '<div class="row"><span>Breedings</span><span class="v mono">' + a.count + '</span></div>' +
          '<div class="row"><span>Total earned</span><span class="v mono">' + L.moneyLine(a.totals) + '</span></div>' +
          purchaseRowsHtml(s.lifeNumber) +
          highScoreRowsHtml(s.lifeNumber) +
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

  // Only bank rows carry a covering date; offspring, in-foal and failed rows
  // often have none. Fall back to another record for the same mare that does
  // (shown in italics) so a foal's row still says when she was bred.
  // Older saves kept Horse Reality's icon markers ("!27923531|") or just the
  // life number as the name; tidy that and prefer the name from her passport.
  function displayMareName(b) {
    var tidy = function (n) { return String(n || '').replace(/ↆ/g, '').replace(/^\s*!/, '').replace(/\s*\|\s*$/, '').replace(/\s+/g, ' ').trim(); };
    var name = tidy(b.mareName);
    var info = b.mareLifeNumber && state.horseInfo ? state.horseInfo[b.mareLifeNumber] : null;
    // her current name from her own page (a renamed mare, or a name that was only her life number, "28040882|$")
    if (info && info.name) name = tidy(info.name);
    return name || b.mareName || '';
  }
  var rowSiblings = [];
  function bredDate(b) {
    if (b.date) return { date: b.date, inferred: false, approx: !!b.dateApprox };
    var best = '';
    rowSiblings.forEach(function (o) {
      if (o === b || !o.date) return;
      var same = (b.mareLifeNumber && o.mareLifeNumber === b.mareLifeNumber) || (!b.mareLifeNumber && b.mareName && o.mareName === b.mareName);
      if (same && o.date > best) best = o.date;
    });
    return best ? { date: best, inferred: true, approx: false } : { date: '', inferred: false, approx: false };
  }
  function bredDateCellHtml(b) {
    var d = bredDate(b);
    return '<div class="mono" data-label="Date bred"' + (d.inferred ? ' title="Taken from another record for this mare"' : d.approx ? ' title="Approximate: the day this mare was first seen in foal"' : '') + '>' +
      (d.inferred || d.approx ? '<em>' + L.fmtDate(d.date) + '</em>' : L.fmtDate(d.date)) +
      (b.coveredAt && !d.inferred ? '<div class="sub" style="font-size:11px;" title="The time you clicked Breed">' + L.esc(L.fmtTime(b.coveredAt)) + '</div>' : '') +
      (function () { var cs = L.coveringStage(b); return cs ? '<div class="sub" style="font-size:11px;">' + L.esc(cs.text) + '</div>' : ''; })() + '</div>';
  }
  // Foal's birth date: stored on the record, else from the foal's cached passport.
  function bornDate(b) {
    if (b.dateBorn) return b.dateBorn;
    var m = /\/horses\/(\d+)/.exec(b.foalUrl || '');
    var info = m && state.horseInfo ? state.horseInfo[m[1]] : null;
    if (!info || !info.dateOfBirth) return '';
    var d = new Date(info.dateOfBirth);
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function bornDateCellHtml(b) {
    return '<div class="mono" data-label="Date born">' + L.fmtDate(bornDate(b)) + (b.bornAt ? '<div class="sub" style="font-size:11px;" title="Official time of birth">' + L.esc(L.fmtTime(b.bornAt)) + '</div>' : '') + '</div>';
  }

  function renderBreedingRow(b, i, viewMode) {
    var curStatus = b.status || 'Pending';
    b = Object.assign({}, b, { mareName: displayMareName(b) });
    var sidForRow = b.stallionId || selectedId || '';
    var statusSelect = '<select class="pill-select ' + L.statusPillClass(curStatus) + '" data-action="update-breeding-status" data-id="' + b.id + '" data-sid="' + sidForRow + '">' +
      L.STATUS_OPTIONS.map(function (opt) {
        return '<option' + (opt === curStatus ? ' selected' : '') + '>' + opt + '</option>';
      }).join('') +
      (L.STATUS_OPTIONS.indexOf(curStatus) === -1 ? '<option selected>' + L.esc(curStatus) + '</option>' : '') +
    '</select>';
    var priceCell = (b.price ? L.fmtMoney(b.price) + ' ' + (b.currency || 'HRC') : '—') + (b.feeType === 'Private' ? '<div class="sub">private rate</div>' : '') + (b.transport ? '<div class="sub">+ ' + L.esc(L.fmtMoney(b.transport)) + ' transport</div>' : '') + (b.studOwner ? '<div class="sub">paid to ' + L.esc(b.studOwner) + '</div>' : '');
    var foalHref = L.safeUrl(b.foalUrl);
    var foalThumb = b.foalImageUrl ? '<img class="foal-thumb" src="' + L.esc(b.foalImageUrl) + '" alt="">' : '';
    var foalChip = b.foalName ? ('<span class="foal-chip">' + foalThumb + 'Foal: ' + (foalHref ? '<a href="' + L.esc(foalHref) + '" target="_blank" rel="noopener noreferrer">' + L.esc(b.foalName) + '<span class="ext">↗</span></a>' : L.esc(b.foalName)) + (b.foalScore > 0 && b.foalScore <= 100 ? ' · score ' + L.esc(b.foalScore) : '') + (function () { var fa = L.foalAgeInfo(state, b); return fa ? '<div class="sub" style="font-size:11px;">' + L.esc(fa.text) + '</div>' : ''; })() + '</span>') : '';

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
      bredDateCellHtml(b) +
      bornDateCellHtml(b) +
      '<div class="mare" data-label="' + col2Label + '">' + col2Html + '</div>' +
      '<div data-label="Owner">' + ownerCell + '</div>' +
      '<div class="price mono" data-label="Price">' + priceCell + '</div>' +
      '<div data-label="Status">' + statusSelect + '</div>' +
      '<div class="actions-cell"><button class="btn btn-ghost btn-sm" data-action="delete-breeding" data-id="' + b.id + '" data-sid="' + sidForRow + '" title="Delete">✕</button></div>' +
      (foalChip || b.notes ? '<div class="notes-cell">' + foalChip + L.esc(b.notes) + '</div>' : '') +
    '</div>';
  }

  // corner ribbon and note on a mare's card: covered (waiting for the result) or in foal
  function mareBreedBadgeHtml(st, misses) {
    if (!st || !st.status) return '';
    var below = misses && misses.length ? ' \u00b7 \u26a0 below goals' : '';
    var belowTip = misses && misses.length ? ' \u2014 misses your goals: ' + misses.join(', ') : '';
    if (st.status === 'pregnant') {
      return '<span class="pill corner-badge mare-ribbon pregnant" title="' + L.esc('In foal' + (st.stallion ? ' to ' + st.stallion : '') + (st.due ? ' \u2014 ' + st.due : '') + belowTip) + '">\u2665 In foal' + (st.due ? ' \u00b7 ' + L.esc(st.due.replace(/^Due /, 'due ')) : '') + below + '</span>';
    }
    return '<span class="pill corner-badge mare-ribbon covered" title="' + L.esc('Covered' + (st.stallion ? ' by ' + st.stallion : '') + (st.date ? ' on ' + L.fmtDate(st.date) : '') + ' \u2014 waiting for the result' + belowTip) + '">\u2714 Covered' + (st.date ? ' \u00b7 ' + L.esc(L.fmtDate(st.date)) : '') + below + '</span>';
  }
  function renderMaresList() {
    var html = topHeaderHtml();
    var myName = (state.settings.myUsername || '').trim();

    if (!myName) {
      html += '<div class="empty"><h3>Set your username first</h3>' +
        '<p>Open the Settings tab and enter "My Horse Reality username" — that\'s how the ledger knows which mares are yours instead of a customer\'s.</p></div>';
      return html;
    }

    var activeMaresTab = maresIndex.filter(function (m) { return !movedOut(m.mareLifeNumber) && lifeBreedOk(m.mareLifeNumber); });
    var totalRecords = 0, foalsBorn = 0;
    maresIndex.filter(function (m) { return lifeBreedOk(m.mareLifeNumber); }).forEach(function (m) { totalRecords += m.records.length; foalsBorn += (m.counts['Foal Born'] || 0); });

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + activeMaresTab.length + '</div><div class="label">Active mares</div>' + goalTallyHtml(goalTally(activeMaresTab.map(function (m) { return m.mareLifeNumber; }))) + '</div>' +
      '<div class="stat-tile"><div class="num mono">' + totalRecords + '</div><div class="label">Breedings logged</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + foalsBorn + '</div><div class="label">Foals born</div></div>' +
      '</div>';

    html += breedingCalendarHtml();
    html += '<div class="section-head"><h2>Mares</h2></div>';

    if (!maresIndex.length) {
      html += '<div class="empty"><h3>No mares of yours recorded yet</h3>' +
        '<p>A mare shows up here once a breeding record lists "' + L.esc(myName) + '" as her owner — from your own offspring or bank pages.</p></div>';
    } else {
      html += '<div class="stallion-grid">';
      maresIndex.forEach(function (m) {
        var mareInfo = (state.horseInfo && m.mareLifeNumber) ? state.horseInfo[m.mareLifeNumber] : null;
        var breedSt = L.mareBreedStatus(state, m.mareLifeNumber);
        var breedMisses = breedSt.status ? L.goalMisses(state, m.mareLifeNumber) : [];
        html += '<div class="card stallion-card' + goalClass(m.mareLifeNumber) + (breedSt.status ? ' mare-' + breedSt.status : '') + (breedMisses.length ? ' mare-below' : '') + '" data-action="open-mare" data-key="' + L.esc(m.key) + '">' +
          mareBreedBadgeHtml(breedSt, breedMisses) +
          goalStripHtml(m.mareLifeNumber) + improverTagHtml(m.mareLifeNumber) + preferredGeneTagHtml(m.mareLifeNumber) +
          (mareInfo && mareInfo.imageUrl ? '<img class="portrait" src="' + L.esc(mareInfo.imageUrl) + '" alt="">' : '') +
          '<h3>' + L.esc(m.mareName) + '</h3>' +
          (m.mareLifeNumber ? '<div class="lifenum mono">#' + L.esc(m.mareLifeNumber) + '</div>' : '') +
          '<div class="row"><span>Breedings</span><span class="v mono">' + m.records.length + '</span></div>' +
          '<div class="row"><span>Succeeded</span><span class="v mono">' + (m.counts.Succeeded || 0) + '</span></div>' +
          '<div class="row"><span>Failed</span><span class="v mono">' + (m.counts.Failed || 0) + '</span></div>' +
          '<div class="row"><span>Foals born</span><span class="v mono">' + (m.counts['Foal Born'] || 0) + '</span></div>' +
          purchaseRowsHtml(m.mareLifeNumber) +
          highScoreRowsHtml(m.mareLifeNumber) +
          mareStatusRowHtml(m.mareLifeNumber) +
        '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderYoungList(only) {
    var html = topHeaderHtml();
    var myName = (state.settings.myUsername || '').trim();

    if (!myName) {
      html += '<div class="empty"><h3>Set your username first</h3>' +
        '<p>Open the Settings tab and enter "My Horse Reality username" — that\'s how the ledger knows which young horses are yours.</p></div>';
      return html;
    }

    var young = getYoungHorses();
    var colts = young.filter(function (h) { return h.sex === 'stallion'; });
    var fillies = young.filter(function (h) { return h.sex === 'mare'; });

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + young.length + '</div><div class="label">Under 3yo</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + colts.length + '</div><div class="label">Active colts</div>' + goalTallyHtml(goalTally(colts.map(function (h) { return h.lifeNumber; }))) + '</div>' +
      '<div class="stat-tile"><div class="num mono">' + fillies.length + '</div><div class="label">Active fillies</div>' + goalTallyHtml(goalTally(fillies.map(function (h) { return h.lifeNumber; }))) + '</div>' +
      '</div>';

    var shown = only === 'mare' ? fillies : colts, word = only === 'mare' ? 'Fillies' : 'Colts';
    html += '<div class="section-head"><h2>' + word + '</h2></div>';

    if (!shown.length) {
      html += '<div class="empty"><h3>No ' + word.toLowerCase() + ' cached yet</h3>' +
        '<p>Once you view one of your under-3yo ' + word.toLowerCase() + '\' pages on Horse Reality, it\'ll show up here until ' + (only === 'mare' ? 'she turns 3 and moves to the My Mares tab' : 'he turns 3 and moves to the Stallions tab') + '.</p></div>';
      return html;
    }

    function youngGrid(list) {
      var out = '<div class="stallion-grid">';
      list.forEach(function (h) {
        out += '<div class="card stallion-card' + goalClass(h.lifeNumber) + '" data-action="open-passport" data-life="' + L.esc(h.lifeNumber) + '">' +
          goalStripHtml(h.lifeNumber) +
          (h.imageUrl ? '<img class="portrait" src="' + L.esc(h.imageUrl) + '" alt="">' : '') +
          '<h3>' + L.esc(h.name || 'Unnamed horse') + '</h3>' +
          '<div class="lifenum mono">#' + L.esc(h.lifeNumber) + '</div>' +
          '<div class="meta">' + L.esc([h.breed, h.color].filter(Boolean).join(' · ') || 'No breed set') + '</div>' +
          (h.dateOfBirth ? '<div class="row"><span>Born</span><span class="v mono">' + L.esc(h.dateOfBirth) + '</span></div>' : '') +
          highScoreRowsHtml(h.lifeNumber) +
          renderAgeControlHtml(h.lifeNumber) +
          '</div>';
      });
      out += '</div>';
      return out;
    }

    html += youngGrid(shown);
    return html;
  }

  // ---------- remove a horse from the ledger ----------
  function removeHorsePanelHtml(life, name) {
    if (!life) return '';
    return horseNotesHtml(life) + '<div class="card profile-block" style="padding:12px 16px;margin:8px 0 16px;display:flex;flex-wrap:wrap;align-items:center;gap:12px;">' +
      (state.horseInfo[life] ? '<button type="button" class="btn btn-sm" data-action="copy-ad" data-life="' + L.esc(life) + '" title="Copies a short sales listing for this horse">Copy sales ad</button>' : '') +
      '<button type="button" class="btn btn-sm" style="border-color:var(--danger);color:var(--danger);" data-action="remove-horse" data-life="' + L.esc(life) + '" data-name="' + L.esc(name || '') + '">Remove from ledger</button>' +
      '<span class="notes-line" style="margin:0;">Deletes everything saved about this horse and stops the ledger saving it again. You can allow it back later under <em>Other Horses \u2192 Removed horses</em>.</span></div>';
  }
  function trashHtml() {
    var tr = (state.trash || []).slice().reverse();
    if (!tr.length) return '';
    var kinds = { horse: 'horse', stallion: 'stallion record', breeding: 'breeding record' };
    return '<details style="margin:16px 0;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Recently deleted (' + tr.length + ') \u2014 kept for 30 days, then gone for good</summary>' +
      '<div class="card" style="padding:10px 14px;margin-top:8px;">' + tr.map(function (t) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-top:1px solid var(--border);"><span>' + L.esc(t.name || 'Unnamed') + ' <span class="sub">(' + (kinds[t.kind] || t.kind) + ', deleted ' + L.esc(new Date(t.deletedAt).toISOString().slice(0, 10)) + ')</span></span>' +
          '<button type="button" class="btn btn-sm" data-action="trash-restore" data-id="' + L.esc(t.id) + '">Restore</button></div>';
      }).join('') + '</div></details>';
  }
  function removedHorsesHtml() {
    var ignored = (state.settings && state.settings.ignored) || {};
    var lives = Object.keys(ignored);
    if (!lives.length) return trashHtml();
    return trashHtml() + '<details style="margin:16px 0;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Removed horses (' + lives.length + ') \u2014 not saved by the ledger</summary>' +
      '<div class="card" style="padding:10px 14px;margin-top:8px;">' + lives.map(function (l) {
        return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-top:1px solid var(--border);"><span>' + L.esc(ignored[l]) + ' <span class="mono sub">#' + L.esc(l) + '</span></span>' +
          '<button type="button" class="btn btn-sm" data-action="allow-horse" data-life="' + L.esc(l) + '">Allow again</button></div>';
      }).join('') + '</div></details>';
  }

  // ---------- stud fees of any stallion in the ledger (other players' too) ----------
  // Rows [label, text] from what was read on his page / Breed page, plus the last fee you paid him.
  function studTermRows(life) {
    var meta = life && state.horseMeta ? state.horseMeta[life] : null;
    var t = meta && meta.studTerms;
    var rec = life ? state.stallions.find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(life); }) : null;
    var rows = [];
    if (t) {
      if (t.public && L.priceList(t.public)) rows.push(['Public stud', L.priceList(t.public)]);
      if (t.private && L.priceList(t.private)) rows.push(['Private stud', L.priceList(t.private)]);
      if (t.semen && L.priceList(t.semen)) rows.push(['Semen vial', L.priceList(t.semen)]);
      if (t.cheapest && L.priceList(t.cheapest)) rows.push(['Cheapest on Breed page', L.priceList(t.cheapest)]);
      if (t.transport) rows.push(['Transport', L.fmtMoney(t.transport) + ' ' + (t.transportCurrency || 'HRC')]);
      if (t.owner) rows.push(['Offered by', t.owner]);
    }
    if (rec && rec.owned === false && rec.lastFee && rec.lastFee.fee > 0) {
      rows.push(['Last fee you paid', L.fmtMoney(rec.lastFee.fee) + ' ' + (rec.lastFee.currency || 'HRC') + (rec.lastFee.transport ? ' + ' + L.fmtMoney(rec.lastFee.transport) + ' transport' : '') + (rec.lastFee.date ? ' \u00b7 ' + L.fmtDate(rec.lastFee.date) : '')]);
    }
    return { rows: rows, seenAt: t && t.seenAt ? t.seenAt : '' };
  }
  // compact lines for a card or list row
  function studFeeCompactHtml(life) {
    var r = studTermRows(life);
    if (!r.rows.length) return '';
    return '<div class="sub" style="margin-top:6px;line-height:1.5;">' + r.rows.map(function (x) { return '<div><span style="color:var(--text-muted);">' + L.esc(x[0]) + ':</span> <span class="mono">' + L.esc(x[1]) + '</span></div>'; }).join('') + '</div>';
  }
  // panel on a stallion's profile page
  function studProfilePanelHtml(life) {
    var info = life && state.horseInfo ? state.horseInfo[life] : null;
    if (!info || info.sex !== 'stallion') return '';
    var r = studTermRows(life);
    if (!r.rows.length) {
      return '<div class="card profile-block" style="padding:12px 16px;margin-bottom:16px;"><strong>Stud fees</strong> <span class="notes-line" style="margin:0;">\u2014 not recorded yet. Open his page (the Public / Private Stud Service boxes) or his Breed page on Horse Reality and they are saved.</span></div>';
    }
    return '<div class="card profile-block" style="padding:14px 16px;margin-bottom:16px;"><strong>Stud fees</strong>' +
      '<div class="stallion-card" style="padding:6px 0 0;cursor:default;box-shadow:none;border:none;max-width:520px;">' +
        r.rows.map(function (x) { return '<div class="row" style="gap:14px;flex-wrap:wrap;"><span>' + L.esc(x[0]) + '</span><span class="v fee mono">' + L.esc(x[1]) + '</span></div>'; }).join('') +
      '</div>' + (r.seenAt ? '<p class="notes-line" style="margin:6px 0 0;">Read on ' + L.esc(L.fmtDate(r.seenAt)) + '; open his page again to refresh.</p>' : '') + '</div>';
  }

  // ---------- a stallion's stud fees (from his page) ----------
  function studSemenRowHtml(life) {
    var t = life && state.horseMeta[life] && state.horseMeta[life].studTerms;
    if (!t || !t.semen || !L.priceList(t.semen)) return '';
    return '<div class="row"><span>Semen vial</span><span class="v fee mono">' + L.esc(L.priceList(t.semen)) + '</span></div>';
  }
  function studFeesPanelHtml(s) {
    var t = s.lifeNumber && state.horseMeta[s.lifeNumber] && state.horseMeta[s.lifeNumber].studTerms;
    var pub = L.feeObj(s, 'Public'), priv = L.feeObj(s, 'Private');
    var log = (s.lifeNumber && state.horseMeta[s.lifeNumber] && state.horseMeta[s.lifeNumber].studTermsLog) || [];
    var row = function (label, text) { return '<div class="row" style="gap:14px;flex-wrap:wrap;"><span>' + label + '</span><span class="v fee mono">' + (text ? L.esc(text) : '\u2014') + '</span></div>'; };
    var html = '<div class="card profile-block" style="padding:14px 16px;margin:0 0 16px;"><strong>Stud fees</strong>' +
      '<div class="stallion-card" style="padding:6px 0 0;cursor:default;box-shadow:none;border:none;max-width:520px;">' +
        row('Public fee', L.priceList(pub)) + row('Private fee', L.priceList(priv)) +
        (t && t.semen && L.priceList(t.semen) ? row('Semen vial', L.priceList(t.semen)) : '') +
      '</div>' +
      '<p class="notes-line" style="margin:6px 0 0;">' + (t && t.seenAt ? 'Read from his page on Horse Reality on ' + L.esc(L.fmtDate(t.seenAt)) + '; open his page again to refresh.' : 'Not read from his page yet. Open his page on Horse Reality (the Public / Private Stud Service boxes) and it fills in; you can also edit the fees by hand.') + '</p>';
    if (log.length > 1) {
      html += '<details style="margin-top:8px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Fee history (' + log.length + ' change' + (log.length === 1 ? '' : 's') + ')</summary><div style="font-size:13px;line-height:1.6;margin-top:6px;">' +
        log.slice().reverse().map(function (e) { return '<div class="mono">' + L.esc(L.fmtDate(e.date)) + ' \u2014 public ' + L.esc(L.priceList(e.public) || '\u2014') + '; private ' + L.esc(L.priceList(e.private) || '\u2014') + (e.semen && L.priceList(e.semen) ? '; semen ' + L.esc(L.priceList(e.semen)) : '') + '</div>'; }).join('') +
        '</div></details>';
    }
    return html + '</div>';
  }

  // ---------- breeding suggestions page ----------
  function suggestionsLinkHtml(life) {
    var info = life && state.horseInfo ? state.horseInfo[life] : null;
    if (!info || info.sex !== 'mare') return '';
    return '<div style="margin:0 0 12px;"><button type="button" class="btn btn-primary btn-sm" data-action="open-suggestions" data-life="' + L.esc(life) + '">Breeding suggestions \u2192</button></div>';
  }
  function renderSuggestions() {
    var life = suggestLife;
    var r = L.breedingSuggestions(state, life, 10);
    var html = '<button class="back-link" data-action="close-suggestions">\u2190 Back to ' + L.esc(r.mareName) + '</button>';
    html += '<div class="section-head"><h2>Breeding suggestions for ' + L.esc(r.mareName) + '</h2></div>';
    html += '<div class="card" style="padding:12px 16px;margin-bottom:14px;border-color:var(--accent-2);"><strong>Only horses saved in the ledger are considered.</strong> ' +
      'That means stallions whose pages you have opened on Horse Reality (your own and other players\'). Open more stallions\' pages and they will show up here. ' +
      'Your own active stallions are shown first (top 5), then the best crosses among other players\' stallions you have saved (top 5; ones without a stud fee saved are marked). Ranked on the foal\'s expected conformation score, genetic potential and conformation stats, adjusted for the stallion\'s fertility and inbreeding.</div>';
    if (r.error === 'no-breed') return html + '<div class="empty"><h3>Your note says not to breed ' + L.esc(r.mareName) + '</h3><p>Remove "don\'t breed" from her notes to see suggestions.</p></div>';
    if (r.error === 'young') return html + '<div class="empty"><h3>' + L.esc(r.mareName) + ' is under 3</h3><p>A mare can only be bred from age 3.</p></div>';
    if (r.error) return html + '<div class="empty"><h3>Not a mare</h3><p>Breeding suggestions are for mares.</p></div>';
    if (r.status.status === 'pregnant') html += '<div class="card" style="padding:10px 14px;margin-bottom:14px;background:#f6dbe9;border-color:#c8588f;color:#8a2a5c;"><strong>\u2665 She is in foal' + (r.status.stallion ? ' to ' + L.esc(r.status.stallion) : '') + (r.status.due ? ' \u2014 ' + L.esc(r.status.due.replace(/^Due /, 'due ')) : '') + '.</strong> These suggestions are for her next breeding.</div>';
    else if (r.status.status === 'covered') html += '<div class="card" style="padding:10px 14px;margin-bottom:14px;background:#f6e4a8;border-color:#d9a21b;color:#6b4f00;"><strong>\u2714 She is already covered' + (r.status.stallion ? ' by ' + L.esc(r.status.stallion) : '') + ' \u2014 waiting for the result.</strong> These suggestions are for her next breeding.</div>';
    html += '<p class="notes-line" style="margin:0 0 10px;">' + r.considered + ' stallion' + (r.considered === 1 ? '' : 's') + ' considered' +
      (r.noData ? ' \u00b7 ' + r.noData + ' skipped (no genetic potential saved yet)' : '') + (r.tooRelated ? ' \u00b7 ' + r.tooRelated + ' left out (more than 12.5% inbred to her)' : '') + (r.notAvailable ? ' \u00b7 ' + r.notAvailable + ' left out (not active at stud and no semen vials)' : '') + (r.byNotes ? ' \u00b7 ' + r.byNotes + ' left out by your notes' : '') + '.</p>';
    if (r.noteEffects && r.noteEffects.length) html += '<div class="card" style="padding:8px 14px;margin-bottom:10px;"><strong style="font-size:13px;">From your notes:</strong> <span class="sub">' + r.noteEffects.map(L.esc).join(' \u00b7 ') + '</span></div>';
    if (!r.suggestions.length) return html + '<div class="empty"><h3>No stallions to suggest yet</h3><p>Open some stallions\' pages on Horse Reality (age 3 and over) so the ledger has them saved.</p></div>';
    function suggestionCards(list) {
      var h2 = '';
      list.forEach(function (s, i) {
      h2 += '<div class="card" style="padding:14px 16px;margin-bottom:10px;">' +
        '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;justify-content:space-between;">' +
          '<div><span class="tag mono">#' + (i + 1) + '</span> <button type="button" class="link-btn" style="font-size:17px;font-weight:600;" data-action="open-passport" data-life="' + L.esc(s.life) + '">' + L.esc(s.name) + '</button>' +
            (s.yours ? ' <span class="tag">Your stallion</span>' : s.partner ? ' <span class="tag" title="A stallion of your breeding partner ' + L.esc(s.partner) + '">Partner</span>' + (s.unlisted ? ' <span class="tag" title="No stud fee or semen is saved for him">No fee saved</span>' : '') : s.unlisted ? ' <span class="tag" title="No stud fee or semen is saved for him">No fee saved</span>' : '') + '</div>' +
          '<div class="mono" style="font-size:15px;">' + (s.estBT != null ? 'Foal BT ~<strong>' + s.estBT + '</strong>' : 'Avg GP <strong>' + s.gp + '</strong>') + ' <button type="button" class="btn btn-sm" data-action="calc-open" data-mare="' + L.esc(life) + '" data-stallion="' + L.esc(s.life) + '">Foal Calculator</button></div>' +
        '</div>' +
        '<ul style="margin:8px 0 0 18px;padding:0;font-size:13.5px;line-height:1.55;">' + s.reasons.map(function (x) { return '<li>' + L.esc(x) + '</li>'; }).join('') + '</ul>' +
      '</div>';
    });
      return h2;
    }
    if (r.mine && r.mine.length) html += '<h3 style="margin:14px 0 8px;">Your stallions \u2014 top ' + r.mine.length + '</h3>' + suggestionCards(r.mine);
    if (r.others && r.others.length) html += '<h3 style="margin:14px 0 8px;">Other players\u2019 stallions saved in the ledger \u2014 best crosses</h3><p class="notes-line" style="margin:0 0 8px;">Ones marked <em>No fee saved</em> are stallions you have opened but whose stud fee or semen price is not saved, so they may not be at stud.</p>' + suggestionCards(r.others);
    return html;
  }

  function renderMareDetail() {
    var m = maresIndex.find(function (x) { return x.key === selectedMareKey; });
    if (!m) { selectedMareKey = null; return renderMaresList(); }
    var mareHref = L.safeUrl(m.mareUrl);
    var passportInfo = (state.horseInfo && m.mareLifeNumber) ? state.horseInfo[m.mareLifeNumber] : null;

    var mareIdx = maresIndex.findIndex(function (x) { return x.key === selectedMareKey; });
    var html = '<div class="detail-nav">' +
      '<button class="back-link" data-action="back-to-mares">← Mares</button>' +
      (maresIndex.length > 1 ? '<div class="detail-nav-btns">' +
        '<button class="btn btn-sm" data-action="nav-mare" data-dir="prev">‹ Previous</button>' +
        '<button class="btn btn-sm" data-action="nav-mare" data-dir="next">Next ›</button>' +
      '</div>' : '') +
    '</div>';
    html += suggestionsLinkHtml(m.mareLifeNumber);
    html += goalStripHtml(m.mareLifeNumber);
    html += '<div class="detail-head profile-goal' + goalClass(m.mareLifeNumber) + '">' +
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
    html += mareStatusPanelHtml(m.mareLifeNumber);
    html += keeperPanelHtml(m.mareLifeNumber) + saleHistoryPanelHtml(m.mareLifeNumber) + geneticsPanelHtml(m.mareLifeNumber) + producerPanelHtml(m.mareLifeNumber) + healthPanelHtml(m.mareLifeNumber) + disciplinePanelHtml(m.mareLifeNumber) + showLogPanelHtml(m.mareLifeNumber);
    html += purchaseDetailsHtml(m.mareLifeNumber) + scoreDetailsHtml(m.mareLifeNumber) + compPanelHtml(m.mareLifeNumber) + tagsPanelHtml(m.mareLifeNumber);
    html += saleDetailsHtml(m.mareLifeNumber);
    html += removeHorsePanelHtml(m.mareLifeNumber, m.mareName);

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
      html += '<div class="ledger-head"><div>Date bred</div><div>Date born</div><div>Stallion</div><div>Owner</div><div>Price</div><div>Status</div><div></div></div>';
      html += '<div class="card">';
      rowSiblings = m.records;
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
    return '<div class="herd-row' + goalClass(h.lifeNumber) + '">' +
      goalStripHtml(h.lifeNumber) + '<div class="herd-pic">' + (pic ? '<img src="' + L.esc(pic) + '" alt="" width="200" height="200" loading="lazy" referrerpolicy="no-referrer">' : '<div class="nopic">No picture yet</div>') + '</div>' +
      '<div class="name" data-label="Horse"><span>' + (bulkMode ? '<input type="checkbox" data-action="bulk-pick" data-life="' + life + '" aria-label="Select ' + L.esc(info.name || 'horse') + '"' + (bulkSel[h.lifeNumber] ? ' checked' : '') + ' style="margin-right:6px;"> ' : '') + '<button type="button" class="link-btn" data-action="open-passport" data-life="' + life + '">' + L.esc(info.name || 'Unnamed horse') + '</button> <span class="mono sub">#' + life + '</span>' + purchaseSubHtml(h.lifeNumber) + '</span>' + (L.tagsOf(state, h.lifeNumber).length ? '<div style="margin-top:2px;">' + tagChipsHtml(h.lifeNumber, false) + '</div>' : '') + '</div>' +
      '<div data-label="Details"><span>' + L.esc(detail || '—') + (info.geneticPotential != null ? ' <span class="mono sub">GP ' + L.esc(info.geneticPotential) + '</span>' : '') + (info.conformation ? '<br><span class="mono sub">Conformation ' + L.esc(info.conformation) + '</span>' : '') + '</span></div>' +
      '<div data-label="Role"><select class="role-select" data-action="herd-role" data-life="' + life + '">' + optionsHtml(L.HERD_ROLES, meta.role, '—') + '</select></div>' +
      '<div data-label="Status"><select class="pill-select ' + L.herdStatusClass(meta.status) + '" data-action="herd-status" data-life="' + life + '">' + optionsHtml(L.HERD_STATUSES, meta.status) + '</select></div>' +
      '<div data-label="Project"><input type="text" data-action="herd-project" data-life="' + life + '" value="' + L.esc(meta.project) + '" placeholder="e.g. Leopard line"></div>' +
      '<div data-label="Show scores"><span><input type="text" data-action="herd-scores" data-life="' + life + '" value="' + L.esc(meta.confScores.join(', ')) + '" placeholder="e.g. 84.2, 87.5" title="Conformation show scores, separated by commas">' + bestScoreHtml(meta) + btLineHtml(life) + '</span></div>' +
    '</div>';
  }

  // ---------- tags ----------
  function tagChipsHtml(life, withRemove) {
    var tags = L.tagsOf(state, life);
    if (!tags.length) return '';
    return '<span class="tag-chips">' + tags.map(function (t) {
      return '<span class="tag mono" style="margin:0 4px 2px 0;"><button type="button" class="link-btn" style="font-size:11.5px;" data-action="filter-tag" data-tag="' + L.esc(t) + '" title="Show the horses with this tag">#' + L.esc(t) + '</button>' +
        (withRemove ? ' <button type="button" class="link-btn" style="font-size:12px;" data-action="tag-remove" data-life="' + L.esc(life) + '" data-tag="' + L.esc(t) + '" title="Remove this tag" aria-label="Remove tag ' + L.esc(t) + '">\u00d7</button>' : '') + '</span>';
    }).join('') + '</span>';
  }
  function tagsDatalistHtml() {
    return '<datalist id="hr-tags-list">' + L.allTags(state).map(function (t) { return '<option value="' + L.esc(t.tag) + '" label="' + t.count + ' horse' + (t.count === 1 ? '' : 's') + '"></option>'; }).join('') + '</datalist>';
  }
  function tagsPanelHtml(life) {
    if (!life || !state.horseInfo[life]) return '';
    var n = L.tagsOf(state, life).length;
    return '<div class="card profile-block" style="padding:12px 16px;margin-bottom:16px;"><strong>Tags</strong> <span class="sub" style="font-size:12.5px;">up to ' + L.MAX_TAGS + ' \u00b7 <em>keep</em>, <em>sell</em> and <em>no-breed</em> change the suggestions</span>' +
      '<div style="margin:8px 0;">' + (tagChipsHtml(life, true) || '<span class="sub">No tags yet.</span>') + '</div>' +
      (n < L.MAX_TAGS ? '<form data-action="tag-add" data-life="' + L.esc(life) + '" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><input name="tag" type="text" list="hr-tags-list" maxlength="30" placeholder="Add a tag, e.g. comp-team" autocomplete="off" style="max-width:240px;"><button type="submit" class="btn btn-sm">Add</button></form>' + tagsDatalistHtml() : '<span class="sub">The limit of ' + L.MAX_TAGS + ' tags is reached.</span>') +
      '</div>';
  }
  function bulkBarHtml() {
    if (!bulkMode) return '<div style="margin:0 0 8px;"><button type="button" class="btn btn-sm" data-action="bulk-toggle">Select horses to tag</button></div>';
    var n = Object.keys(bulkSel).filter(function (k) { return bulkSel[k]; }).length;
    return '<div class="card" style="padding:10px 14px;margin:0 0 10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;border-color:var(--accent-2);">' +
      '<strong id="bulk-count">' + n + ' selected</strong>' +
      '<button type="button" class="btn btn-sm" data-action="bulk-all">Select all shown</button><button type="button" class="btn btn-sm" data-action="bulk-none">Clear</button>' +
      '<input id="bulk-tag" type="text" list="hr-tags-list" maxlength="30" placeholder="tag" autocomplete="off" style="max-width:180px;">' +
      '<button type="button" class="btn btn-sm btn-primary" data-action="bulk-add">Add tag</button><button type="button" class="btn btn-sm" data-action="bulk-remove">Remove tag</button>' +
      '<button type="button" class="btn btn-sm" data-action="bulk-toggle">Done</button>' + tagsDatalistHtml() + '</div>';
  }
  // the horse the "select" boxes belong to is the first life number found in a row
  function bulkApply(add) {
    var tag = L.normalizeTag(document.getElementById('bulk-tag') && document.getElementById('bulk-tag').value);
    if (!tag) { alert('Type a tag of 2 to 24 letters, numbers or hyphens.'); return; }
    var lives = Object.keys(bulkSel).filter(function (k) { return bulkSel[k]; }), changed = 0, full = 0;
    lives.forEach(function (life) {
      if (add) { var r = L.addTagTo(state, life, tag); if (r === 'added') changed++; else if (r === 'full') full++; }
      else if (L.removeTagFrom(state, life, tag)) changed++;
    });
    if (full) alert(full + ' horse' + (full === 1 ? ' is' : 's are') + ' already at the limit of ' + L.MAX_TAGS + ' tags.');
    if (changed) persist(); else render();
  }
  function herdListHtml(horses) {
    var html = bulkBarHtml() + '<div class="ledger"><div class="herd-head"><div></div><div>Horse</div><div>Details</div><div>Role</div><div>Status</div><div>Project</div><div>Show scores</div></div><div class="card">';
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
      '<div class="field"><label for="hm-scores">Conformation scores (typed — the stats page is read automatically)</label><input id="hm-scores" type="text" data-action="herd-scores" data-life="' + life + '" value="' + L.esc(meta.confScores.join(', ')) + '" placeholder="e.g. 84.2, 87.5">' + bestScoreHtml(meta) + btLineHtml(life) + '</div>' +
      '<div class="field"><label for="hm-project">Project</label><input id="hm-project" type="text" data-action="herd-project" data-life="' + life + '" value="' + L.esc(meta.project) + '" placeholder="e.g. Leopard line"></div>' +
    '</div>';
  }

  // My Herd's submenu: the herd, and the retired horses
  function herdSubTabsHtml() {
    var n = horsesWithStatus('Retired').length;
    return '<div style="display:flex;gap:6px;margin:0 0 12px;">' +
      '<button type="button" class="btn btn-sm' + (herdSub !== 'retired' ? ' btn-primary' : '') + '" data-action="herd-sub" data-sub="">Herd</button>' +
      '<button type="button" class="btn btn-sm' + (herdSub === 'retired' ? ' btn-primary' : '') + '" data-action="herd-sub" data-sub="retired">Retired' + (n ? ' (' + n + ')' : '') + '</button></div>';
  }
  function renderHerdList() {
    var html = topHeaderHtml() + herdSubTabsHtml();
    var myName = (state.settings.myUsername || '').trim();
    if (!myName) {
      html += '<div class="empty"><h3>Set your username first</h3>' +
        '<p>Open the Settings tab and enter "My Horse Reality username" — that\'s how the ledger knows which cached horses are yours.</p></div>';
      return html;
    }

    var horses = L.ownedHorses(state).filter(function (h) { return !movedOut(h.lifeNumber) && lifeBreedOk(h.lifeNumber); });
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

  // ---------- Analytics ----------
  function pct(x) { return x == null ? '\u2014' : Math.round(x * 100) + '%'; }
  // Click a table heading to sort by it; click again to reverse. Empty values sort last.
  var anSort = { sold: { key: 'date', dir: -1 }, stallions: { key: 'breedings', dir: -1 }, mares: { key: 'breedings', dir: -1 }, young: { key: 'name', dir: 1 } };
  var AN_TEXT_KEYS = { name: true, kind: true, status: true };
  function sortHead(table, key, label, cls, title) {
    var s = anSort[table];
    return '<th class="' + (cls || '') + ' sortable" data-action="an-sort" data-table="' + table + '" data-key="' + key + '" title="' + L.esc(title || 'Sort by ' + label) + '">' + label + (s.key === key ? (s.dir > 0 ? ' \u25b2' : ' \u25bc') : '') + '</th>';
  }
  function sortList(table, list, getters) {
    var s = anSort[table], get = getters[s.key] || function () { return null; };
    return list.slice().sort(function (a, b) {
      var x = get(a), y = get(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return s.dir * x.localeCompare(y);
      return s.dir * (x - y);
    });
  }
  function totalEarned(e) { return Object.keys(e || {}).reduce(function (n, c) { return n + e[c]; }, 0); }
  // What the ledger has learned from your own records (see lib.js: learning from the ledger)
  function learnedPanelHtml() {
    var ls = L.learnedSummary(viewState());
    var li = function (t) { return '<div class="an-tip info" style="margin-top:4px;">' + L.esc(t) + '</div>'; };
    return '<div class="an-card" style="margin-bottom:18px;"><h3>What the ledger has learned' + (ls.on ? '' : ' (off)') + '</h3>' +
      (ls.on ? '<strong style="font-size:13px;">Breeding</strong>' + ls.breeding.map(li).join('') + '<div style="margin-top:10px;"><strong style="font-size:13px;">Buying and prices</strong></div>' + ls.buying.map(li).join('') +
        '<p class="notes-line" style="margin:8px 0 0;">Worked out again from your records each time, so it improves as foals are born, horses are sold and bids are won or lost. Turn it off under My notes.</p>' : '<p class="notes-line" style="margin:6px 0 0;">Learning is turned off under My notes.</p>') + '</div>';
  }
  // ---------- analytics: sections you can open and close, and a bar to jump between them ----------
  // The analytics page is built as a long run of cards; after it is drawn each card becomes a section with its title as a
  // heading (click to open or close), the few small overview cards start open, and a bar at the top jumps to a section.
  var AN_OPEN = ['Suggestions', 'Goals', 'Breedings per month', 'Top Breed Total', 'Top conformation'];
  function anSlug(t) { return 'an-' + String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function enhanceAnalytics() {
    var app = document.getElementById('app');
    if (!app || app.getAttribute('data-an')) return;
    var nav = [];
    Array.prototype.slice.call(app.querySelectorAll('.an-card')).forEach(function (card) {
      var h3 = card.querySelector(':scope > h3');
      if (!h3) return;
      var title = (h3.firstChild && h3.firstChild.nodeType === 3 ? h3.firstChild.textContent : h3.textContent).replace(/\s+/g, ' ').trim();
      if (!title) return;
      var det = document.createElement('details');
      det.className = 'an-card an-sec';
      det.id = anSlug(title);
      det.setAttribute('data-sec', title);
      if (anOpen[title] != null ? anOpen[title] : AN_OPEN.indexOf(title) > -1) det.open = true;
      var sum = document.createElement('summary');
      sum.innerHTML = h3.innerHTML;
      h3.remove();
      var body = document.createElement('div');
      body.className = 'an-body';
      while (card.firstChild) body.appendChild(card.firstChild);
      det.appendChild(sum); det.appendChild(body);
      card.parentNode.replaceChild(det, card);
      nav.push({ id: det.id, title: title });
    });
    if (nav.length) {
      var bar = document.createElement('div');
      bar.className = 'an-nav';
      bar.innerHTML = nav.map(function (n) { return '<button type="button" class="btn btn-sm" data-action="an-jump" data-id="' + L.esc(n.id) + '">' + L.esc(n.title.replace(/ \(.*\)$/, '')) + '</button>'; }).join('') +
        '<span style="flex:1"></span><button type="button" class="btn btn-sm btn-ghost" data-action="an-all" data-open="1">Open all</button><button type="button" class="btn btn-sm btn-ghost" data-action="an-all" data-open="0">Close all</button>';
      var first = app.querySelector('.stats-bar');
      if (first && first.nextSibling) first.parentNode.insertBefore(bar, first.nextSibling); else app.insertBefore(bar, app.firstChild);
    }
    app.setAttribute('data-an', '1');
  }
  function renderAnalytics() {
    var html = topHeaderHtml();
    var a = L.analytics(viewState());
    var o = a.overall;
    if (!a.stallions.length && !a.mares.length) {
      return html + '<div class="empty"><h3>Nothing to analyse yet</h3><p>Analytics appear once the ledger has your stallions, mares and breedings. Browse your bank page and horses on Horse Reality and they fill in automatically.</p></div>';
    }
    html += '<div class="section-head"><h2>Analytics</h2></div>';
    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + o.breedings + '</div><div class="label">Breedings logged</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + pct(o.successRate) + '</div><div class="label">Success rate</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + o.foals + '</div><div class="label">Foals born</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + o.pending + '</div><div class="label">Pending</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + L.esc(L.moneyLine(o.earned)) + '</div><div class="label">Stud fees earned</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (o.avgScore != null ? Math.round(o.avgScore * 10) / 10 : '\u2014') + '</div><div class="label">Avg foal score (of 100)</div></div>' +
    '</div>';

    html += learnedPanelHtml();

    // suggestions
    html += '<div class="an-card" style="margin-bottom:18px;"><h3>Suggestions</h3>';
    if (!a.tips.length) html += '<div class="an-tip info">Nothing needs attention right now.</div>';
    a.tips.forEach(function (t) { html += '<div class="an-tip ' + t.level + '">' + L.esc(t.text) + '</div>'; });
    if (a.pairs.length) {
      html += '<div style="margin-top:10px;"><strong>Pairing ideas</strong> <span class="sub" style="color:var(--text-muted);font-size:12px;">your free mares \u00d7 your active stallions, ranked by the foal\u2019s expected conformation score, genetic potential and conformation stats (not Breed Total), then adjusted for conformation traits that cover each other, shared weak traits, and an estimated inbreeding under 6.25%</span>';
      a.pairs.forEach(function (p) {
        var line = L.esc(p.mare) + ' \u00d7 ' + L.esc(p.stallion) + ' \u2014 ' +
          (p.conf != null ? 'expected foal conformation <strong>' + p.conf + '</strong>, GP <strong>' + Math.round(p.gp) + '</strong>' + (p.traitN ? ', stats ' + p.strong + '/' + p.traitN + ' good+, ' + p.weak + ' weak' : '') + ' (Breed Total ~' + p.estBT + ')' : 'average GP <strong>' + Math.round(p.gp) + '</strong> (no show score yet)') +
          ', inbreeding ' + p.coi + '%';
        var notes = [];
        if (p.fixes.length) notes.push('Covers: ' + p.fixes.map(function (f) { return L.esc(f.trait) + ' (' + f.from + ' is stronger)'; }).join(', '));
        if (p.shared.length) notes.push('Watch: both Below average in ' + p.shared.map(L.esc).join(', '));
        if (p.noScore && p.estBT != null) notes.push('One parent has no show score yet, so the conformation part uses the other parent only');
        line += ' <button type="button" class="link-btn" style="font-size:12.5px;" data-action="calc-open" data-mare="' + L.esc(p.mareLife || '') + '" data-stallion="' + L.esc(p.stallionLife || '') + '">Open in Foal Calculator \u2192</button>';
        html += '<div class="an-tip tip">' + line + (notes.length ? '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">' + notes.join(' \u00b7 ') + '</div>' : '') + '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += '<div class="an-grid">';
    // months
    var maxB = Math.max.apply(null, a.months.map(function (m) { return m.breedings; }).concat([1]));
    html += '<div class="an-card"><h3>Breedings per month</h3><div class="an-bars">' +
      a.months.map(function (m) { return '<div class="an-bar" style="height:' + Math.max(2, Math.round(110 * m.breedings / maxB)) + 'px;" title="' + L.esc(m.key + ': ' + m.breedings + ' breeding' + (m.breedings === 1 ? '' : 's') + (m.earned ? ', ' + L.fmtMoney(m.earned) + ' HRC' : '')) + '"></div>'; }).join('') +
      '</div><div class="an-barlabels">' + a.months.map(function (m) { return '<span>' + L.esc(m.key.slice(5)) + '</span>'; }).join('') + '</div>' +
      '<p class="notes-line" style="margin:8px 0 0;">Last 12 months. Hover a bar for the count and HRC fees.</p></div>';
    // top lists
    function topList(title, list, valueOf) {
      var out = '<div class="an-card"><h3>' + title + '</h3>';
      if (!list.length) return out + '<p class="notes-line" style="margin:0;">Not enough data yet.</p></div>';
      out += '<table class="an-table"><tbody>';
      list.forEach(function (x) { out += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(x.life) + '">' + L.esc(x.name) + '</button></td><td class="num mono">' + valueOf(x) + '</td></tr>'; });
      return out + '</tbody></table></div>';
    }
    html += topList('Top Breed Total', a.topBT, function (x) { return Math.round(x.bt * 1000) / 1000; });
    html += topList('Top conformation', a.topConf, function (x) { return Math.round(x.conf * 1000) / 1000; });
    html += '</div>';

    // goals: who meets them, and who misses by exactly one box (and which box)
    html += '<div class="an-card" style="margin-bottom:18px;"><h3>Goals</h3>';
    var anyGoal = L.anyGoals(state);
    if (!anyGoal) {
      html += '<p class="notes-line" style="margin:0;">No goals set. Open <em>Highlight goals</em> in the Settings tab to set some.</p>';
    } else {
      html += '<p style="margin:0 0 8px;"><strong>' + a.goalHits + '</strong> horse' + (a.goalHits === 1 ? '' : 's') + ' meet all your goals; <strong>' + a.nearMiss + '</strong> miss by one box.</p>';
      html += '<div class="an-grid" style="margin:0;">';
      html += '<div><strong>Meet all goals</strong>';
      if (!a.goalHitList.length) html += '<p class="notes-line" style="margin:6px 0 0;">None yet.</p>';
      else {
        html += '<table class="an-table"><tbody>';
        a.goalHitList.forEach(function (h) { html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(h.life) + '">' + L.esc(h.name) + '</button></td><td class="num">\u2605</td></tr>'; });
        html += '</tbody></table>';
      }
      html += '</div><div><strong>Miss by one</strong>';
      if (!a.nearMissList.length) html += '<p class="notes-line" style="margin:6px 0 0;">None.</p>';
      else {
        html += '<table class="an-table"><thead><tr><th>Horse</th><th>What is missing</th></tr></thead><tbody>';
        a.nearMissList.forEach(function (n) { html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(n.life) + '">' + L.esc(n.name) + '</button></td><td><span class="goal-pill" style="background:var(--danger);color:#fff;">' + L.esc(n.missing) + '</span> ' + L.esc(n.detail) + '</td></tr>'; });
        html += '</tbody></table>';
      }
      html += '</div></div>';
      html += '<p class="notes-line" style="margin:8px 0 0;">Horses with missing data (no show score, health check, etc.) are left out of \u201cmiss by one\u201d until their page has been opened once.</p>';
    }
    html += '</div>';

    // stallion table
    html += '<div class="an-card" style="margin-bottom:18px;"><h3>Stallions <span class="sub" style="font-size:12px;color:var(--text-muted);font-weight:400;">3 years and older</span></h3>';
    if (!a.stallions.length) {
      html += '<p class="notes-line" style="margin:0;">No stallions yet.</p>';
    } else {
      html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr>' + sortHead('stallions', 'name', 'Stallion') + sortHead('stallions', 'breedings', 'Breedings', 'num') + sortHead('stallions', 'successRate', 'Success', 'num') + sortHead('stallions', 'failed', 'Failed', 'num') + sortHead('stallions', 'pending', 'Pending', 'num') + sortHead('stallions', 'foals', 'Foals', 'num') + sortHead('stallions', 'avgScore', 'Avg foal /100', 'num', 'Average foal score, out of 100') + sortHead('stallions', 'bestScore', 'Best foal /100', 'num', 'Highest foal score, out of 100') + sortHead('stallions', 'earned', 'Earned', 'num') + sortHead('stallions', 'last', 'Last bred') + '</tr></thead><tbody>';
      sortList('stallions', a.stallions, { name: function (s) { return String(s.name || ''); }, breedings: function (s) { return s.breedings; }, successRate: function (s) { return s.successRate; }, failed: function (s) { return s.failed; }, pending: function (s) { return s.pending; }, foals: function (s) { return s.foals; }, avgScore: function (s) { return s.avgScore; }, bestScore: function (s) { return s.bestScore; }, earned: function (s) { return totalEarned(s.earned) || null; }, last: function (s) { return s.last || null; } }).forEach(function (s) {
        html += '<tr><td><button type="button" class="link-btn" data-action="open-stallion" data-id="' + L.esc(s.id) + '">' + L.esc(s.name) + '</button></td>' +
          '<td class="num mono">' + s.breedings + '</td><td class="num mono">' + pct(s.successRate) + '</td><td class="num mono">' + s.failed + '</td><td class="num mono">' + s.pending + '</td><td class="num mono">' + s.foals + '</td>' +
          '<td class="num mono">' + (s.avgScore != null ? Math.round(s.avgScore * 10) / 10 : '\u2014') + '</td><td class="num mono">' + (s.bestScore != null ? s.bestScore : '\u2014') + '</td>' +
          '<td class="num mono">' + L.esc(L.moneyLine(s.earned)) + '</td><td>' + (s.last ? L.fmtDate(s.last) : '\u2014') + '</td></tr>';
      });
      html += '</tbody></table></div><p class="notes-line" style="margin:8px 0 0;">Success rate = foals and in-foal results out of every covering with a known result (pending ones are left out). Foal scores are out of 100.</p>';
    }
    html += '</div>';

    // mares table
    html += '<div class="an-card" style="margin-bottom:18px;"><h3>Your mares <span class="sub" style="font-size:12px;color:var(--text-muted);font-weight:400;">3 years and older</span></h3>';
    var adultMares = a.mares.filter(function (m) { return !m.young; });
    if (!adultMares.length) {
      html += '<p class="notes-line" style="margin:0;">No adult mares (3+) of yours cached yet.</p>';
    } else {
      html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr>' + sortHead('mares', 'name', 'Mare') + sortHead('mares', 'breedings', 'Breedings', 'num') + sortHead('mares', 'foals', 'Foals', 'num') + sortHead('mares', 'last', 'Last bred') + sortHead('mares', 'status', 'Status') + '</tr></thead><tbody>';
      sortList('mares', adultMares, { name: function (m) { return String(m.name || ''); }, breedings: function (m) { return m.breedings; }, foals: function (m) { return m.foals; }, last: function (m) { return m.last || null; }, status: function (m) { var b = L.mareBreedStatus(state, m.life).status; return b === 'pregnant' || m.pregnant ? 'In foal' : b === 'covered' ? 'Covered' : 'Open'; } }).forEach(function (m) {
        html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(m.life) + '">' + L.esc(m.name) + '</button></td>' +
          '<td class="num mono">' + m.breedings + '</td><td class="num mono">' + m.foals + '</td><td>' + (m.last ? L.fmtDate(m.last) : '\u2014') + '</td><td>' + (function () { var b = L.mareBreedStatus(state, m.life).status; return b === 'pregnant' || m.pregnant ? 'In foal' : b === 'covered' ? 'Covered' : 'Open'; })() + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    // under 3: colts and fillies
    html += '<div class="an-card"><h3>Colts &amp; Fillies <span class="sub" style="font-size:12px;color:var(--text-muted);font-weight:400;">under 3 years</span></h3>';
    if (!a.young.length) {
      html += '<p class="notes-line" style="margin:0;">No colts or fillies of yours cached yet.</p>';
    } else {
      html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr>' + sortHead('young', 'name', 'Horse') + sortHead('young', 'kind', 'Colt / Filly') + sortHead('young', 'ageMonths', 'Age') + sortHead('young', 'gp', 'GP', 'num') + sortHead('young', 'conf', 'Top conformation', 'num') + sortHead('young', 'bt', 'Breed Total', 'num') + '</tr></thead><tbody>';
      sortList('young', a.young, { name: function (y) { return String(y.name || ''); }, kind: function (y) { return y.kind; }, ageMonths: function (y) { return y.ageMonths; }, gp: function (y) { return y.gp != null ? Number(y.gp) : null; }, conf: function (y) { return y.conf; }, bt: function (y) { return y.bt; } }).forEach(function (y) {
        html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(y.life) + '">' + L.esc(y.name) + '</button></td><td><span class="tag">' + y.kind + '</span></td><td>' + L.esc(y.age || '\u2014') + '</td>' +
          '<td class="num mono">' + (y.gp != null ? L.esc(y.gp) : '\u2014') + '</td><td class="num mono">' + (y.conf != null ? Math.round(y.conf * 1000) / 1000 : '\u2014') + '</td><td class="num mono">' + (y.bt ? Math.round(y.bt * 1000) / 1000 : '\u2014') + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';

    html += sellIdeasHtml();
    html += improversCardHtml() + feeWatchHtml() + moneyCardHtml() + compareCardHtml();
    var fa = L.foalAccuracy(viewState());
    html += '<div class="an-card" style="margin-top:18px;"><h3>Foal results vs. the parents</h3>';
    if (!fa.count) {
      html += '<p class="notes-line" style="margin:0;">Needs foals with a score whose two parents both have a saved show score. The foal\'s score is compared with its parents\' average top conformation.</p>';
    } else {
      html += '<p style="margin:0 0 8px;"><strong>' + fa.count + '</strong> foal' + (fa.count === 1 ? '' : 's') + ' compared. On average they scored <strong style="color:var(--' + (fa.avgDiff >= 0 ? 'success' : 'danger') + ');">' + (fa.avgDiff >= 0 ? '+' : '') + fa.avgDiff + '</strong> against their parents\' average, and ' + fa.above + ' of ' + fa.count + ' matched or beat it.</p>' +
        '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Foal</th><th>Parents</th><th class="num">Foal score</th><th class="num">Parents avg</th><th class="num">Difference</th></tr></thead><tbody>' +
        fa.rows.map(function (r) {
          return '<tr><td>' + L.esc(r.foal) + '</td><td>' + L.esc(r.mare) + ' \u00d7 ' + L.esc(r.stallion) + '</td><td class="num mono">' + r.score + '</td><td class="num mono">' + r.parentsAvg + '</td><td class="num mono" style="color:var(--' + (r.diff >= 0 ? 'success' : 'danger') + ');">' + (r.diff >= 0 ? '+' : '') + r.diff + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '</div>';

    // horses you have sold
    var ss = a.soldSummary;
    html += '<div class="an-card" style="margin-top:18px;"><h3>Sold horses</h3>';
    if (!a.sold.length) {
      html += '<p class="notes-line" style="margin:0;">No sold horses yet. Sales are picked up from your bank page, or mark a horse Sold and enter the price on its page.</p>';
    } else {
      html += '<p style="margin:0 0 8px;"><strong>' + ss.count + '</strong> sold' + (ss.withPrice ? ' for <strong>' + L.esc(L.moneyLine(ss.revenue)) + '</strong>' : '') +
        (ss.avg ? ' (average ' + L.esc(L.fmtMoney(Math.round(ss.avg))) + ' HRC)' : '') +
        (ss.profitKnown ? '; profit on the ' + ss.profitKnown + ' with a known cost: <strong style="color:var(--' + (ss.profit >= 0 ? 'success' : 'danger') + ');">' + (ss.profit >= 0 ? '+' : '-') + L.esc(L.fmtMoney(Math.abs(ss.profit))) + ' HRC</strong>' : '') + '.</p>';
      html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr>' + sortHead('sold', 'name', 'Horse') + sortHead('sold', 'date', 'Sold') + sortHead('sold', 'price', 'Sold for', 'num') + sortHead('sold', 'cost', 'Paid', 'num', 'Price paid plus shipping') + sortHead('sold', 'profit', 'Profit', 'num') + sortHead('sold', 'buyer', 'Buyer') + '</tr></thead><tbody>';
      sortList('sold', a.sold, { name: function (x) { return String(x.name || ''); }, date: function (x) { return x.date || null; }, price: function (x) { return x.price; }, cost: function (x) { return x.cost; }, profit: function (x) { return x.profit; }, buyer: function (x) { return x.buyer || null; } }).forEach(function (x) {
        html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(x.life) + '">' + L.esc(x.name) + '</button></td><td>' + (x.date ? L.fmtDate(x.date) : '\u2014') + '</td>' +
          '<td class="num mono">' + (x.price ? L.esc(L.fmtMoney(x.price) + ' ' + x.currency) : '\u2014') + '</td><td class="num mono">' + (x.cost ? L.esc(L.fmtMoney(x.cost)) : '\u2014') + '</td>' +
          '<td class="num mono"' + (x.profit != null ? ' style="color:var(--' + (x.profit >= 0 ? 'success' : 'danger') + ');"' : '') + '>' + (x.profit != null ? (x.profit >= 0 ? '+' : '-') + L.esc(L.fmtMoney(Math.abs(x.profit))) : '\u2014') + '</td><td>' + L.esc(x.buyer || '\u2014') + '</td></tr>';
      });
      html += '</tbody></table></div><p class="notes-line" style="margin:8px 0 0;">Paid = price plus shipping when you bought the horse (blank if you bred it). Profit is shown only when the sale and purchase used the same currency.</p>';
    }
    html += '</div>';
    html += exportCardHtml();
    return html;
  }

  // ---------- spreadsheet export ----------
  function csvDownload(filename, rows) {
    var text = rows.map(function (r) {
      return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
    }).join('\r\n');
    var blob = new Blob(['\ufeff' + text], { type: 'text/csv' });
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename + '-' + L.todayStr() + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function csvRows(kind) {
    var rows = [];
    if (kind === 'herd') {
      rows.push(['Name', 'Life number', 'Sex', 'Breed', 'Age', 'Genetic potential', 'Top conformation', 'Breed Total', 'Status', 'Role', 'Project', 'Notes']);
      L.ownedHorses(state).forEach(function (h) {
        var m = state.horseMeta[h.lifeNumber] || {}, conf = L.bestConformation(m).best;
        rows.push([h.info.name, h.lifeNumber, h.info.sex, h.info.breed, h.info.ageText || '', h.info.geneticPotential, conf || '', Math.max(Number(m.btBest) || 0, L.breedTotal(h.info.geneticPotential, conf)) || '', m.status || 'Active', m.role || '', m.project || '', m.notes || '']);
      });
    } else if (kind === 'breedings') {
      rows.push(['Stallion', 'Mare', 'Mare life number', 'Date bred', 'Time bred', 'Status', 'Price', 'Currency', 'Foal', 'Foal score', 'Date born']);
      state.stallions.forEach(function (st) {
        (state.breedings[st.id] || []).forEach(function (b) {
          rows.push([st.name, b.mareName, b.mareLifeNumber, b.date, b.coveredAt ? L.fmtTime(b.coveredAt) : '', b.status, b.price, b.currency, b.foalName, b.foalScore, b.dateBorn]);
        });
      });
    } else {
      rows.push(['Horse', 'Life number', 'Date sold', 'Sold for', 'Currency', 'Buyer', 'Paid (price + shipping)', 'Profit']);
      Object.keys(state.horseMeta || {}).forEach(function (l) {
        var sa = L.saleOf(state, l);
        if (!sa) return;
        var pr = L.profitOf(state, l);
        rows.push([(state.horseInfo[l] && state.horseInfo[l].name) || ('#' + l), l, sa.date, sa.price, sa.currency, sa.buyer, pr ? pr.cost : '', pr ? pr.profit : '']);
      });
    }
    return rows;
  }

  // ---------- breeding calendar (Mares tab): foals due and mares ready ----------
  function breedingCalendarHtml() {
    var due = L.foalsDue(viewState()), ready = L.readyMares(viewState());
    if (!due.length && !ready.length) return '';
    var html = '<div style="display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-bottom:18px;">';
    html += '<div class="an-card"><h3>Foals due</h3>' + (due.length ? due.map(function (f) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--border);padding:6px 0;"><span><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(f.life) + '">' + L.esc(f.name) + '</button>' + (f.stallion ? ' <span class="sub">by ' + L.esc(f.stallion) + '</span>' : '') + '</span>' +
        '<span class="mono" style="' + (f.days != null && f.days <= 3 ? 'color:var(--warn);font-weight:600;' : '') + '">' + L.esc(f.due || 'due date not read yet') + '</span></div>';
    }).join('') : '<p class="notes-line" style="margin:0;">No mares in foal right now.</p>') + '</div>';
    html += '<div class="an-card"><h3>Mares ready to breed</h3>' + (ready.length ? ready.slice(0, 8).map(function (r) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--border);padding:6px 0;"><span><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(r.life) + '">' + L.esc(r.name) + '</button></span>' +
        '<span class="sub">' + (r.days == null ? 'never bred' : r.days + ' day' + (r.days === 1 ? '' : 's') + ' since last') + ' <button type="button" class="link-btn" data-action="calc-open" data-mare="' + L.esc(r.life) + '" data-stallion="">pick a stallion \u2192</button></span></div>';
    }).join('') : '<p class="notes-line" style="margin:0;">Every mare is covered or in foal.</p>') + '</div>';
    return html + '</div>';
  }

  // ---------- money, compare and fee watch (Analytics) ----------
  function moneyCardHtml() {
    var ms = L.moneySummary(state), t = ms.totals;
    function f(n) { return L.esc(L.fmtMoney(n)); }
    var any = t.earned || t.paid || t.sold || t.bought;
    var html = '<div class="an-card" style="margin-top:18px;"><h3>Money (HRC)</h3>';
    if (!any) return html + '<p class="notes-line" style="margin:0;">Fees and sales appear once the ledger has read your bank page.</p></div>';
    html += '<div class="stats-bar" style="margin-bottom:12px;">' +
      '<div class="stat-tile"><div class="num mono">' + f(t.earned) + '</div><div class="label">Stud fees earned</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + f(t.paid) + '</div><div class="label">Stud fees paid</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + f(t.sold) + '</div><div class="label">Horses sold</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + f(t.bought) + '</div><div class="label">Horses bought</div></div>' +
      '<div class="stat-tile"><div class="num mono" style="color:var(--' + (t.net >= 0 ? 'success' : 'danger') + ');">' + (t.net >= 0 ? '+' : '-') + f(Math.abs(t.net)) + '</div><div class="label">Net, all time</div></div></div>';
    html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Month</th><th class="num">Earned</th><th class="num">Paid</th><th class="num">Sold</th><th class="num">Net</th></tr></thead><tbody>' +
      ms.months.filter(function (m) { return m.earned || m.paid || m.sold; }).reverse().map(function (m) {
        var net = m.earned + m.sold - m.paid;
        return '<tr><td>' + L.esc(m.m) + '</td><td class="num mono">' + f(m.earned) + '</td><td class="num mono">' + f(m.paid) + '</td><td class="num mono">' + f(m.sold) + '</td><td class="num mono" style="color:var(--' + (net >= 0 ? 'success' : 'danger') + ');">' + (net >= 0 ? '+' : '-') + f(Math.abs(net)) + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="notes-line" style="margin:8px 0 0;">Last 12 months by the date of each breeding or sale. Horses bought are in the all-time total only, because the purchase date is not recorded. Other currencies are left out.</p></div>';
    return html;
  }
  function improversCardHtml() {
    var list = L.improverMares(viewState());
    var html = '<div class="an-card" style="margin-top:18px;"><h3>Mares that out-produce themselves</h3>';
    if (!list.length) return html + '<p class="notes-line" style="margin:0;">A mare shows here once at least two of her foals have scores, they average higher than her own top score, and half of them beat her. Open her Foals tab and her foals\' pages to save the scores.</p></div>';
    return html + '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Mare</th><th class="num">Her score</th><th class="num">Foals average</th><th class="num">Difference</th><th>Foals that beat her</th></tr></thead><tbody>' + list.map(function (r) {
      return '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(r.life) + '">' + L.esc(r.name) + '</button></td><td class="num mono">' + r.mareScore + '</td><td class="num mono">' + r.avgFoal + '</td><td class="num mono" style="color:var(--success);">+' + r.avgDelta + '</td><td>' + r.better + ' of ' + r.scored + '</td></tr>';
    }).join('') + '</tbody></table></div><p class="notes-line" style="margin:8px 0 0;">Open a mare\'s page for what to look for in a stallion.</p></div>';
  }
  function feeWatchHtml() {
    var ch = L.feeChanges(state, 14);
    if (!ch.length) return '';
    return '<div class="an-card" style="margin-top:18px;"><h3>Stud fee changes (last 14 days)</h3>' + ch.map(function (c) {
      return '<div class="an-tip ' + (c.pct > 0 ? 'info' : 'tip') + '"><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(c.life) + '">' + L.esc(c.name) + '</button>: public fee ' + (c.pct > 0 ? 'up' : 'down') + ' ' + Math.abs(c.pct) + '% (' + L.esc(L.fmtMoney(c.from)) + ' \u2192 ' + L.esc(L.fmtMoney(c.to)) + ' HRC) on ' + L.esc(L.fmtDate(c.date)) + '</div>';
    }).join('') + '</div>';
  }
  function compareCardHtml() {
    var lives = Object.keys(state.horseInfo || {}).sort(function (a, b) { return String(state.horseInfo[a].name || '').localeCompare(String(state.horseInfo[b].name || '')); });
    var mineSet = {};
    L.ownedHorses(state).forEach(function (h) { mineSet[h.lifeNumber] = true; });
    // Suggestions on one side = the partners suggested for the horse picked on the other side.
    function suggestedFor(other) {
      if (!other || !state.horseInfo[other]) return null;
      var r = L.pairIdeas(state, other, 10), set = {};
      r.mine.concat(r.other).forEach(function (x) { set[x.life] = true; });
      return set;
    }
    function filterBoxes(side) {
      var f = compareFilter[side], other = side === 'a' ? compareB : compareA;
      var all = f.adult && f.young && f.mine && f.other && f.mares && f.stallions && !f.sugg;
      function box(key, label, checked, title) {
        return '<label title="' + L.esc(title || '') + '" style="display:inline-flex;align-items:center;gap:4px;margin:0 12px 4px 0;font-size:12.5px;font-weight:400;cursor:pointer;"><input type="checkbox" data-action="compare-filter" data-side="' + side + '" data-key="' + key + '"' + (checked ? ' checked' : '') + '> ' + label + '</label>';
      }
      return '<div style="margin:2px 0 6px;">' + box('all', 'All', all) + box('adult', '3+', f.adult) + box('young', 'Under 3', f.young) + box('mine', 'My horses', f.mine) + box('other', 'Other horses', f.other) +
        box('mares', 'Mares', f.mares) + box('stallions', 'Stallions', f.stallions) + box('sugg', 'Suggestions', f.sugg, other ? 'Only the horses suggested as partners for the horse picked on the other side' : 'Pick a horse on the other side first') + '</div>' +
        (f.sugg && !suggestedFor(other) ? '<div class="notes-line" style="margin:0 0 6px;">Pick a horse on the other side first and this shows the partners suggested for it.</div>' : '');
    }
    function sel(id, action, cur, side) {
      var f = compareFilter[side], sugg = f.sugg ? suggestedFor(side === 'a' ? compareB : compareA) : null;
      var cmpKey = breedInForce(compareBreed, side === 'a' ? compareB : compareA);
      var rows = lives.filter(function (l) {
        if (l === cur) return true;
        var info = state.horseInfo[l];
        if (!breedAllowed(l, cmpKey)) return false;
        if (info.sex === 'mare' ? !f.mares : info.sex === 'stallion' ? !f.stallions : false) return false;
        if (L.isYoungInfo(info) ? !f.young : !f.adult) return false;
        if (mineSet[l] ? !f.mine : !f.other) return false;
        if (sugg && !sugg[l]) return false;
        return true;
      });
      function opt(l) {
        var info = state.horseInfo[l];
        return '<option value="' + L.esc(l) + '"' + (l === cur ? ' selected' : '') + '>' + L.esc(info.name || ('#' + l)) + ' (#' + L.esc(l) + ')' + (info.sex ? ' \u00b7 ' + L.esc(info.sex) : '') + '</option>';
      }
      function group(label, test) {
        var g = rows.filter(test);
        return g.length ? '<optgroup label="' + L.esc(label) + '">' + g.map(opt).join('') + '</optgroup>' : '';
      }
      var young = function (l) { return L.isYoungInfo(state.horseInfo[l]); };
      return '<div>' + filterBoxes(side) + '<select id="' + id + '" data-action="' + action + '" style="width:100%;"><option value="">Choose a horse\u2026</option>' +
        group('Your horses \u00b7 3 and older', function (l) { return mineSet[l] && !young(l); }) +
        group('Other horses \u00b7 3 and older', function (l) { return !mineSet[l] && !young(l); }) +
        group('Your horses \u00b7 Under 3', function (l) { return mineSet[l] && young(l); }) +
        group('Other horses \u00b7 Under 3', function (l) { return !mineSet[l] && young(l); }) + '</select></div>';
    }
    var html = '<div class="an-card" style="margin-top:18px;"><h3>Compare two horses</h3><div style="max-width:380px;margin-bottom:8px;"><label for="compare-breed" style="font-weight:600;">Breed</label>' + breedSelectHtml('compare-breed', 'compare-breed', compareBreed) + '</div>' + breedNoteHtml(breedInForce(compareBreed, compareA || compareB), compareBreed, compareA || compareB) + '<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-bottom:10px;">' + sel('compare-a', 'compare-a', compareA, 'a') + sel('compare-b', 'compare-b', compareB, 'b') + '</div>';
    if (compareA && compareB && state.horseInfo[compareA] && state.horseInfo[compareB]) {
      html += statsCompareHtml(compareA, compareB).replace('Parent stats', 'Side by side') + traitsCompareHtml(compareA, compareB);
      var ga = savedGenesText(compareA), gb = savedGenesText(compareB);
      var ta = state.horseInfo[compareA].testedColours || '', tb = state.horseInfo[compareB].testedColours || '';
      if (ta || tb || ga || gb) html += '<p class="mono notes-line">' + L.esc(state.horseInfo[compareA].name || compareA) + ': ' + L.esc([ta, ga].filter(Boolean).join(' \u00b7 ') || '\u2014') + '<br>' + L.esc(state.horseInfo[compareB].name || compareB) + ': ' + L.esc([tb, gb].filter(Boolean).join(' \u00b7 ') || '\u2014') + '</p>';
    }
    return html + '</div>';
  }
  function exportCardHtml() {
    return '<div class="an-card" style="margin-top:18px;"><h3>Export to a spreadsheet</h3><div style="display:flex;flex-wrap:wrap;gap:8px;">' +
      '<button type="button" class="btn btn-sm" data-action="csv-export" data-kind="herd">My herd (CSV)</button>' +
      '<button type="button" class="btn btn-sm" data-action="csv-export" data-kind="breedings">All breedings (CSV)</button>' +
      '<button type="button" class="btn btn-sm" data-action="csv-export" data-kind="sales">Sales (CSV)</button></div></div>';
  }

  // ---------- notes on a horse ----------
  function horseNotesHtml(life) {
    if (!life || !state.horseInfo[life]) return '';
    var note = (state.horseMeta[life] && state.horseMeta[life].notes) || '';
    return '<div class="card profile-block" style="padding:12px 16px;margin:8px 0 8px;"><label for="note-' + L.esc(life) + '" style="font-weight:600;">Notes</label>' +
      '<textarea id="note-' + L.esc(life) + '" data-action="update-note" data-life="' + L.esc(life) + '" rows="2" style="width:100%;margin-top:6px;" placeholder="Anything you want to remember. Words like keep, sell, don\'t breed, pair with &lt;name&gt; and avoid &lt;name&gt; are used for suggestions (saved when you click away)">' + L.esc(note) + '</textarea>' +
      (function () { var u = L.parseNotes(note).understood; return u.length ? '<div style="margin-top:6px;">' + u.map(function (x) { return '<span class="tag" style="margin-right:6px;">' + L.esc(x) + '</span>'; }).join('') + '</div>' : '<p class="notes-line" style="margin:6px 0 0;">The ledger reads words like keep, sell, don\'t breed, pair with &lt;name&gt; and avoid &lt;name&gt; when it makes suggestions.</p>'; })() + '</div>';
  }

  // ---------- sell ideas: the suggestion form, horses to sell and what to ask ----------
  function sellIdeasHtml() {
    var r = L.sellIdeas(viewState()), f = r.form;
    function chk(key, label) {
      return '<label style="display:inline-flex;align-items:center;gap:6px;margin-right:14px;"><input type="checkbox" data-action="update-sell" data-field="' + key + '"' + (f[key] ? ' checked' : '') + '> ' + label + '</label>';
    }
    function sel(key, options) {
      return '<select data-action="update-sell" data-field="' + key + '">' + options.map(function (o) { return '<option value="' + o[0] + '"' + (f[key] === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
    }
    function money(n) { return L.esc(L.fmtMoney(n)) + ' HRC'; }
    function priceCell(p) {
      if (p.suggested == null) return '<span class="sub">No sales or purchase price to go on yet</span>';
      return '<strong class="mono">' + money(p.suggested) + '</strong><div class="sub" style="font-size:12px;">range ' + L.esc(L.fmtMoney(p.low)) + '\u2013' + L.esc(L.fmtMoney(p.high)) + ' \u00b7 ' + L.esc(p.basis) +
        (p.premium ? ' \u00b7 ' + L.esc(p.premium) : '') + (p.belowCost ? ' \u00b7 raised to what you paid' : '') + '</div>';
    }
    var html = '<div class="an-card" style="margin-top:18px;"><h3>Sell ideas</h3>' +
      '<p class="notes-line" style="margin:0 0 10px;">Horses worth selling, and what to ask. It never lists a horse that meets all your goals, a Companion, or a mare that is covered or in foal.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin-bottom:12px;">' +
        '<span><strong>Look at:</strong> ' + chk('mares', 'Mares') + chk('stallions', 'Stallions') + chk('young', 'Colts &amp; Fillies') + '</span>' +
        '<span><strong>Pick by:</strong> ' + sel('mode', [['misses', 'Missing my goals'], ['weakest', 'Weakest in the herd']]) + '</span>' +
        '<span><strong>Price:</strong> ' + sel('pace', [['quick', 'Quick sale (15% under)'], ['fair', 'Fair'], ['high', 'Top dollar (15% over)']]) + '</span>' +
      '</div>';
    if (!r.goalsOn && f.mode === 'misses') html += '<div class="an-tip info">You have no highlight goals set, so horses are picked from the weaker end of your herd. Set goals under <em>Highlight goals</em> for sharper picks.</div>';
    if (!r.comps) html += '<div class="an-tip info">No past sales or market results with a known Breed Total yet, so prices start from what you paid for a horse. They get better as sales are recorded from your bank page and as bids you win or lose are noted from your notifications.</div>';
    if (!r.ideas.length) {
      html += '<p class="notes-line" style="margin:8px 0 0;">Nothing to suggest with these settings. Every horse you look at either meets your goals or is worth keeping.</p>';
    } else {
      html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Horse</th><th>Why sell</th><th class="num">BT</th><th>Suggested price</th></tr></thead><tbody>';
      r.ideas.slice(0, 15).forEach(function (x) {
        html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(x.life) + '">' + L.esc(x.name) + '</button><div class="sub">' + x.kind + '</div></td>' +
          '<td>' + x.reasons.map(function (t) { return '<div>' + L.esc(t) + '</div>'; }).join('') + '</td>' +
          '<td class="num mono">' + (x.bt ? Math.round(x.bt * 10) / 10 : '\u2014') + '</td><td>' + priceCell(x.price) + '<div style="margin-top:4px;"><button type="button" class="btn btn-sm" data-action="mark-sale" data-life="' + L.esc(x.life) + '">Mark For Sale</button></div></td></tr>';
      });
      html += '</tbody></table></div>';
      if (r.ideas.length > 15) html += '<p class="notes-line" style="margin:6px 0 0;">Showing the 15 strongest of ' + r.ideas.length + '.</p>';
    }
    var heldFoal = r.held.filter(function (x) { return x.kind !== 'record'; }), heldRecord = r.held.filter(function (x) { return x.kind === 'record'; });
    if (heldFoal.length) html += '<p class="notes-line" style="margin:8px 0 0;">Held back until their foal is born: ' + heldFoal.map(function (x) { return L.esc(x.name) + ' (' + x.why + ')'; }).join(', ') + '.</p>';
    if (heldRecord.length) html += '<p class="notes-line" style="margin:8px 0 0;"><strong>Kept off the list because of their record:</strong> ' + heldRecord.map(function (x) { return '<button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(x.life) + '">' + L.esc(x.name) + '</button> (' + L.esc(x.why) + ')'; }).join('; ') + '.</p>';
    if (r.forSale.length) {
      html += '<h4 style="margin:16px 0 6px;">Already for sale: price check</h4><div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Horse</th><th class="num">BT</th><th>Price to ask</th></tr></thead><tbody>';
      r.forSale.forEach(function (x) {
        html += '<tr><td><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(x.life) + '">' + L.esc(x.name) + '</button></td><td class="num mono">' + (x.bt ? Math.round(x.bt * 10) / 10 : '\u2014') + '</td><td>' + priceCell(x.price) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<p class="notes-line" style="margin:10px 0 0;">Prices are estimates, not what the market will pay: they come from the price per Breed Total point of your most similar past sales, never below what you paid. Check the market before listing.</p></div>';
    return html;
  }

  // ---------- Retired / Sold: horses that leave the working lists ----------
  // A horse's status can be set on its herd row/page (horseMeta.status) or, for
  // a stallion, on the Stallions tab (record status). Either one counts. Retired
  // horses move to My Herd → Retired; Sold horses move to Other Horses. Nothing is
  // deleted - setting the status back to Active returns the horse.
  function lifeStatus(life) {
    var m = state.horseMeta && state.horseMeta[life];
    if (m && m.status && m.status !== 'Active') return m.status;
    var s = state.stallions.find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(life); });
    if (s && s.status && s.status !== 'Active') return s.status;
    return 'Active';
  }
  function movedOut(life) {
    if (!life) return false;
    var st = lifeStatus(life);
    return st === 'Retired' || st === 'Sold';
  }
  function setLifeStatus(life, status) {
    if (!life) return;
    state.horseMeta[life] = Object.assign({}, state.horseMeta[life], { status: status });
    var s = state.stallions.find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(life); });
    if (s) s.status = (status === 'Sold' || status === 'Retired' || status === 'For Sale') ? status : 'Active';
    persist();
  }
  // Active / Sold / Retired menu (keeps any other herd status as its own option).
  function statusSelectHtml(life, id) {
    var cur = lifeStatus(life);
    var opts = ['Active', 'For Sale', 'Sold', 'Retired'];
    if (opts.indexOf(cur) === -1) opts.push(cur);
    return '<select' + (id ? ' id="' + id + '"' : '') + ' class="pill-select ' + L.herdStatusClass(cur) + '" data-action="herd-status" data-life="' + L.esc(life) + '" aria-label="Status">' +
      opts.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + L.esc(o) + '</option>'; }).join('') + '</select>';
  }
  function mareStatusRowHtml(life) {
    if (!life) return '';
    return '<div class="row"><span>Status</span><span class="v">' + statusSelectHtml(life) + '</span></div>';
  }
  function mareStatusPanelHtml(life) {
    if (!life) return '';
    return '<div class="card" style="padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">' +
      '<label for="mare-status" style="color:var(--text-muted);font-size:13px;">Status</label>' + statusSelectHtml(life, 'mare-status') +
      '<span class="notes-line" style="margin:0;">Sold mares move to Other Horses; retired mares move to My Herd → Retired.</span></div>';
  }

  // every horse the ledger knows with this status, as { lifeNumber, info, meta }
  function horsesWithStatus(status) {
    var lives = {};
    Object.keys(state.horseMeta || {}).forEach(function (l) { lives[l] = true; });
    state.stallions.forEach(function (s) { if (s.lifeNumber && s.owned !== false) lives[s.lifeNumber] = true; });
    return Object.keys(lives).filter(function (l) { return lifeStatus(l) === status; }).map(function (l) {
      var s = state.stallions.find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(l); });
      var info = state.horseInfo[l] || { lifeNumber: l, name: s ? s.name : '#' + l, breed: s ? s.breed : '', sex: s ? 'stallion' : '', imageUrl: s ? s.imageUrl : '' };
      var meta = L.herdMeta(state, l);
      meta.status = status;
      return { lifeNumber: l, info: info, meta: meta };
    }).sort(function (a, b) { return String(a.info.name || '').localeCompare(String(b.info.name || '')); });
  }
  function renderRetiredList() {
    var html = topHeaderHtml() + herdSubTabsHtml();
    var horses = horsesWithStatus('Retired');
    html += '<div class="section-head"><h2>Retired</h2></div>';
    if (!horses.length) {
      return html + '<div class="empty"><h3>No retired horses</h3><p>Set a horse\'s Status to Retired (on My Herd, its page, or a stallion\'s Stallions card) and it moves here. Set it back to Active to return it.</p></div>';
    }
    return html + herdListHtml(horses);
  }

  // ---------- Other Horses ----------
  // Horses added from the on-page prompt that someone else owns. They stay
  // out of My Herd; the search box above also finds them.
  function renderOthersList() {
    var html = topHeaderHtml();
    var soldHorses = horsesWithStatus('Sold');
    var soldLives = {};
    soldHorses.forEach(function (h) { soldLives[h.lifeNumber] = true; });
    var horses = L.trackedOtherHorses(state).filter(function (h) { return !soldLives[h.lifeNumber]; })
      .concat(soldHorses.map(function (h) { return Object.assign({ lifeNumber: h.lifeNumber }, h.info, { sold: true }); }));
    html += '<div class="section-head"><h2>Other Horses</h2></div>';
    if (!horses.length) {
      return html + removedHorsesHtml() + '<div class="empty"><h3>No other horses yet</h3><p>Open a horse that isn\'t yours on Horse Reality and choose "Add to ledger" in the box that appears.</p></div>';
    }
    html += '<div class="card">';
    horses.forEach(function (info) {
      var life = L.esc(info.lifeNumber);
      var pic = horsePictureUrl(info.lifeNumber);
      var detail = [info.breed, info.sex ? info.sex.charAt(0).toUpperCase() + info.sex.slice(1) : '', info.ownerName ? 'Owner: ' + info.ownerName : ''].filter(Boolean).join(' · ');
      html += '<div class="herd-row other-row' + goalClass(info.lifeNumber) + '">' +
        goalStripHtml(info.lifeNumber) + '<div class="herd-pic">' + (pic ? '<img src="' + L.esc(pic) + '" alt="" width="200" height="200" loading="lazy" referrerpolicy="no-referrer">' : '<div class="nopic">No picture yet</div>') + '</div>' +
        '<div class="name" data-label="Horse"><span><button type="button" class="link-btn" data-action="open-passport" data-life="' + life + '">' + L.esc(info.name || 'Unnamed horse') + '</button> <span class="mono sub">#' + life + '</span></span>' + (info.sold ? '<div class="name-tags"><span class="tag">Sold</span>' + saleTagsHtml(info.lifeNumber) + '</div>' : '') + '</div>' +
        '<div data-label="Details"><span>' + L.esc(detail || '—') + '</span>' + (info.sex === 'stallion' ? studFeeCompactHtml(info.lifeNumber) : '') + '</div>' +
        '<div>' + (info.sold ? '<button class="btn btn-sm" data-action="restore-horse" data-life="' + life + '" title="Set back to Active and return it to your lists">Restore</button>' : '<button class="btn btn-sm" data-action="untrack-horse" data-life="' + life + '">Remove</button>') + '</div>' +
      '</div>';
    });
    return html + '</div>' + removedHorsesHtml();
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
  // Lives suggested for the horse picked on the other side (used by the Suggestions filter box).
  function calcSuggestedSet(sex) {
    var other = sex === 'mare' ? calcStallion : calcMare;
    if (!other || !state.horseInfo[other]) return null;
    var r = L.pairIdeas(state, other, 10), set = {};
    r.mine.concat(r.other).forEach(function (x) { set[x.life] = true; });
    return set;
  }
  // Check boxes above a selector that narrow the horses it offers.
  function calcFilterHtml(sex) {
    var f = calcFilter[sex];
    var all = f.adult && f.young && f.mine && f.other && !f.sugg;
    function box(key, label, checked, title) {
      return '<label title="' + L.esc(title || '') + '" style="display:inline-flex;align-items:center;gap:4px;margin:0 12px 4px 0;font-size:12.5px;font-weight:400;cursor:pointer;"><input type="checkbox" data-action="calc-filter" data-side="' + sex + '" data-key="' + key + '"' + (checked ? ' checked' : '') + '> ' + label + '</label>';
    }
    var other = sex === 'mare' ? calcStallion : calcMare;
    return '<div style="margin:2px 0 6px;">' + box('all', 'All', all, 'Show every ' + sex) + box('adult', '3+', f.adult) + box('young', 'Under 3', f.young) +
      box('mine', 'My horses', f.mine) + box('other', 'Other horses', f.other) +
      box('sugg', 'Suggestions', f.sugg, other ? 'Only the ' + sex + 's suggested for the horse picked on the other side' : 'Pick a ' + (sex === 'mare' ? 'stallion' : 'mare') + ' first') + '</div>' +
      (f.sugg && !calcSuggestedSet(sex) ? '<div class="notes-line" style="margin:0 0 6px;">Pick a ' + (sex === 'mare' ? 'stallion' : 'mare') + ' first and this shows the ' + sex + 's suggested for it.</div>' : '');
  }
  // The breeding plan: pairings you have decided on, ticked off when done.
  function calcPlanHtml() {
    var plan = (state.settings && state.settings.plan) || [];
    var both = calcMare && calcStallion && state.horseInfo[calcMare] && state.horseInfo[calcStallion];
    var already = plan.some(function (p) { return p.mare === calcMare && p.stallion === calcStallion; });
    var name = function (l) { return (state.horseInfo[l] && state.horseInfo[l].name) || ('#' + l); };
    var html = '<details class="an-card" style="margin-bottom:14px;"' + (plan.length ? ' open' : '') + '><summary style="cursor:pointer;font-weight:600;">Breeding plan (' + plan.filter(function (p) { return !p.done; }).length + ' to do)</summary><div style="margin-top:8px;">';
    if (both && !already) html += '<button type="button" class="btn btn-sm btn-primary" data-action="plan-add">Add ' + L.esc(name(calcMare)) + ' \u00d7 ' + L.esc(name(calcStallion)) + ' to the plan</button>';
    if (!plan.length) html += '<p class="notes-line" style="margin:8px 0 0;">Pick a mare and a stallion, then add the pairing here to keep a list of the coverings you plan to do.</p>';
    plan.forEach(function (p, i) {
      var st = L.mareBreedStatus(state, p.mare);
      html += '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;border-top:1px solid var(--border);padding:7px 0;' + (p.done ? 'opacity:.6;' : '') + '">' +
        '<label style="display:inline-flex;gap:6px;align-items:center;flex:1 1 260px;margin:0;"><input type="checkbox" data-action="plan-toggle" data-i="' + i + '"' + (p.done ? ' checked' : '') + '> <span' + (p.done ? ' style="text-decoration:line-through;"' : '') + '>' + L.esc(name(p.mare)) + ' \u00d7 ' + L.esc(name(p.stallion)) + '</span></label>' +
        (st.status && !p.done ? '<span class="tag">' + (st.status === 'pregnant' ? 'mare is in foal' : 'mare is covered') + '</span>' : '') +
        '<button type="button" class="btn btn-sm" data-action="calc-open" data-mare="' + L.esc(p.mare) + '" data-stallion="' + L.esc(p.stallion) + '">Open</button>' +
        '<button type="button" class="btn btn-sm" data-action="plan-remove" data-i="' + i + '">Remove</button></div>';
    });
    return html + '</div></details>';
  }
  // Suggested partners for the mare and/or stallion that is picked.
  function calcSuggestionsHtml() {
    var fee = state.settings && state.settings.calcMaxFee != null ? state.settings.calcMaxFee : '';
    var feeBox = '<div class="field" style="max-width:260px;margin:0 0 12px;"><label for="calc-max-fee">Max stud fee for suggestions (HRC)</label><input id="calc-max-fee" type="number" min="0" step="1000" data-action="update-calc-fee" value="' + L.esc(fee) + '" placeholder="no limit"></div>';
    function panel(life) {
      if (!life || !state.horseInfo[life]) return '';
      var r = L.pairIdeas(state, life, 40);
      var head = '<strong>Suggested ' + r.kind + ' for ' + L.esc(r.name) + '</strong>';
      var card = function (summary, inner, open) { return '<details class="calc-sugg card" data-life="' + L.esc(life) + '"' + (open ? ' open' : '') + ' style="padding:10px 16px;margin-bottom:12px;"><summary style="cursor:pointer;">' + summary + '</summary>' + inner + '</details>'; };
      if (r.error) return card(head + ' <span class="sub">\u2014 ' + (r.error === 'young' ? 'under 3' : r.error === 'no-breed' ? 'not to be bred' : 'not available') + '</span>', '<p class="notes-line" style="margin:8px 0 0;">' + (r.error === 'young' ? 'Horses under 3 can\'t be bred yet.' : r.error === 'no-breed' ? 'Your note on this horse says not to breed it.' : 'Pick a mare or a stallion.') + '</p>', false);
      var pickAction = r.kind === 'stallions' ? 'calc-pick-stallion' : 'calc-pick-mare';
      var sgn = function (n, dec) { var v = Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec); return (v >= 0 ? '+' : '\u2212') + Math.abs(v); };
      var betterMine = r.mine.filter(function (x) { return x.better === 'better'; }), betterOther = r.other.filter(function (x) { return x.better === 'better'; });
      var nBetter = betterMine.length + betterOther.length, nAll = r.mine.length + r.other.length;
      function col(title, list, allList) {
        var inner = list.length ? list.slice(0, 5).map(function (x) {
          var tagColour = x.better === 'better' ? 'success' : x.better === 'worse' ? 'danger' : 'text-muted';
          var tagText = x.better === 'better' ? 'better foal' : x.better === 'worse' ? 'foal falls short' : 'about the same';
          var f = x.foal || {}, dd = x.d || {};
          return '<div style="border-top:1px solid var(--border);padding:7px 0;"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">' +
            '<strong>' + L.esc(x.name) + (x.partner ? ' <span class="tag">Partner</span>' : '') + '</strong><button type="button" class="btn btn-sm" data-action="' + pickAction + '" data-life="' + L.esc(x.life) + '">Use</button></div>' +
            '<span class="tag" style="font-size:11px;color:var(--' + tagColour + ');">' + tagText + '</span> ' +
            (r.hasGoal ? '<span class="tag" style="font-size:11px;color:var(--' + (x.fits ? 'success' : 'warn') + ');">' + (x.fits ? 'might fit goals' : 'may miss goals') + '</span> ' : '') +
            '<div class="mono" style="font-size:12px;margin:3px 0;">' + (f.conf != null ? 'conformation ' + f.conf + (dd.conf != null ? ' (' + sgn(dd.conf, 1) + ')' : '') + ' \u00b7 ' : '') + 'GP ' + (f.gp || '?') + (dd.gp != null ? ' (' + sgn(dd.gp, 0) + ')' : '') + (f.n ? ' \u00b7 ' + f.strong + '/' + f.n + ' traits good+, ' + f.weak + ' weak' : '') + '</div>' +
            '<span class="sub" style="font-size:12px;">' + x.reasons.slice(0, 5).map(function (t) { return L.esc(t); }).join(' \u00b7 ') + '</span></div>';
        }).join('') : '<p class="notes-line" style="margin:6px 0 0;">' + (allList.length ? 'None would give a better foal than ' + L.esc(r.name) + '.' : 'None found yet. Open more ' + r.kind + '\' pages on Horse Reality so the ledger knows them.') + '</p>';
        return '<div><div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">' + title + '</div>' + inner + '</div>';
      }
      var minePick = calcShowAll ? r.mine : betterMine, otherPick = calcShowAll ? r.other : betterOther;
      var summary = head + ' <span class="sub" style="font-size:12.5px;">\u2014 ' + (nAll ? nBetter + ' would give a better foal' + (calcShowAll ? ', showing all ' + nAll : ' (of ' + nAll + ' considered)') : 'none found yet') + '</span>';
      var inner = '<p class="notes-line" style="margin:8px 0;">A foal counts as <em>better</em> when its expected conformation score, genetic potential and conformation stats are ahead of ' + L.esc(r.name) + '\'s on balance with nothing clearly worse. The numbers in brackets are how far ahead (+) or behind (\u2212) it is.</p>' +
        '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;margin-bottom:6px;"><input type="checkbox" data-action="calc-show-all"' + (calcShowAll ? ' checked' : '') + '> Also show partners whose foal would only match or fall short</label>' +
        '<div style="display:grid;gap:18px;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));margin-top:8px;">' + col('Your ' + r.kind, minePick, r.mine) + col('Other players\' ' + r.kind, otherPick, r.other) + '</div>';
      return card(summary, inner, !!calcSuggOpen[life]);
    }
    var h = panel(calcMare) + panel(calcStallion);
    if (h) h = feeBox + h;
    if (!h) return '<p class="notes-line" style="margin:0 0 14px;">Pick a mare or a stallion and the ledger suggests partners from the horses it has saved, split into yours and other players\'.</p>';
    return h;
  }
  // Breed picker. There is no crossbreeding in Horse Reality, so once a breed is chosen (or one parent is picked)
  // only horses of that breed are offered.
  function breedSelectHtml(id, action, cur) {
    var known = L.HR_BREEDS.slice();
    var keys = {};
    known.forEach(function (b) { keys[L.breedKeyOf(b)] = true; });
    Object.keys(state.horseInfo || {}).forEach(function (l) {
      var b = state.horseInfo[l].breed, k = L.breedKeyOf(b);
      if (k && !keys[k]) { keys[k] = true; known.push(b); }
    });
    return '<select id="' + id + '" data-action="' + action + '" style="width:100%;"><option value="">All breeds</option>' + known.sort().map(function (b) {
      return '<option value="' + L.esc(b) + '"' + (L.breedKeyOf(b) === L.breedKeyOf(cur) ? ' selected' : '') + '>' + L.esc(b) + '</option>';
    }).join('') + '</select>';
  }
  // The breed in force for a list: the chosen breed, else the breed of the horse already picked on the other side.
  function breedInForce(chosen, otherLife) {
    if (chosen) return L.breedKeyOf(chosen);
    if (activeBreed) return L.breedKeyOf(activeBreed);
    var oi = otherLife && state.horseInfo[otherLife];
    return oi ? L.breedKey(oi) : '';
  }
  function breedAllowed(life, key) {
    if (!key) return true;
    var k = L.breedKey(state.horseInfo[life]);
    return !k || k === key;
  }
  function breedNoteHtml(key, chosen, otherLife) {
    if (!key) return '';
    var oi = otherLife && state.horseInfo[otherLife];
    var name = chosen || (oi && oi.breed) || key;
    return '<p class="notes-line" style="margin:0 0 12px;">Showing only <strong>' + L.esc(name) + '</strong> horses. There is no crossbreeding in Horse Reality, so only the same breed can be paired.</p>';
  }
  // The pickers are typeahead boxes: type part of a name or a life number and choose from the list (a browser datalist),
  // instead of scrolling a long drop-down. The text of an entry is "Name (#life)".
  function calcTypeLabel(r) { return r.name + ' (#' + r.life + ')'; }
  function calcTypeaheadHtml(sex, selected) {
    var rows = calcRows(sex, selected), id = 'calc-' + (sex === 'mare' ? 'mare' : 'stallion');
    var cur = rows.find(function (r) { return r.life === selected; });
    return '<input id="' + id + '" type="text" list="' + id + '-list" autocomplete="off" data-action="' + id + '-text" placeholder="Type a name or life number\u2026" value="' + L.esc(cur ? calcTypeLabel(cur) : '') + '" style="width:100%;">' +
      '<datalist id="' + id + '-list">' + rows.map(function (r) {
        var tag = r.breed.status === 'pregnant' ? ' \u2665 in foal' : r.breed.status === 'covered' ? ' \u2714 covered' + (r.breed.stallion ? ' by ' + r.breed.stallion : '') : '';
        return '<option value="' + L.esc(calcTypeLabel(r)) + '" label="' + L.esc((r.mine ? 'Your horse' : 'Other horse') + (r.young ? ' \u00b7 under 3' : '') + tag) + '"></option>';
      }).join('') + '</datalist>' + (selected ? '<button type="button" class="link-btn" style="font-size:12px;" data-action="calc-clear-' + (sex === 'mare' ? 'mare' : 'stallion') + '">clear</button>' : '');
  }
  // What was typed or chosen: a "(#life)" ending, a bare life number, or a name that only one horse has
  function calcResolveText(sex, text) {
    var t = String(text || '').trim();
    if (!t) return '';
    // any saved horse of that sex counts, whatever the filter boxes show
    var all = Object.keys(state.horseInfo || {}).filter(function (l) { return state.horseInfo[l].sex === sex; });
    var m = /#(\d{6,})\)?\s*$/.exec(t) || /^(\d{6,})$/.exec(t);
    if (m && all.indexOf(m[1]) > -1) return m[1];
    var low = t.toLowerCase();
    var hits = all.filter(function (l) { return String(state.horseInfo[l].name || '').toLowerCase() === low; });
    if (hits.length === 1) return hits[0];
    hits = all.filter(function (l) { return String(state.horseInfo[l].name || '').toLowerCase().indexOf(low) > -1; });
    return hits.length === 1 ? hits[0] : null;
  }
  function calcOptionsHtml(sex, selected) {
    return '';
  }
  function calcRows(sex, selected) {
    var mine = {};
    L.ownedHorses(state).forEach(function (h) { mine[h.lifeNumber] = true; });
    var f = calcFilter[sex], sugg = f.sugg ? calcSuggestedSet(sex) : null;
    var calcBreedKey = breedInForce(calcBreed, sex === 'mare' ? calcStallion : calcMare);
    var rows = Object.keys(state.horseInfo || {}).filter(function (life) { return state.horseInfo[life].sex === sex; }).filter(function (life) {
      if (life === selected) return true;
      var young = L.isYoungInfo(state.horseInfo[life]);
      if (young ? !f.young : !f.adult) return false;
      if (mine[life] ? !f.mine : !f.other) return false;
      if (sugg && !sugg[life]) return false;
      if (!breedAllowed(life, calcBreedKey)) return false;
      return true;
    }).map(function (life) {
      return { life: life, name: state.horseInfo[life].name || ('#' + life), mine: !!mine[life], young: L.isYoungInfo(state.horseInfo[life]), breed: sex === 'mare' ? L.mareBreedStatus(state, life) : { status: '' } };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    return rows;
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
        (/^[0-9]+$/.test(String(life)) ? '<div style="margin-top:4px;font-size:13px;"><a href="https://www.horsereality.com/horses/' + L.esc(life) + '/" target="_blank" rel="noopener">View on Horse Reality \u2197</a></div>' : '') +
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
    return '<span title="' + L.esc(L.labelRangeText('conf', text)) + '" style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:12.5px;font-weight:600;background:' + colour[0] + ';color:' + colour[1] + ';">' + L.esc(text) + '</span>';
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
  function pedBoxHtml(n, shared, col, row, span) {
    var isShared = shared[n.life];
    var full = n.name ? n.name + ' #' + n.life : '#' + n.life;
    var label = n.name ? L.esc(n.name) : '<span style="color:var(--text-muted);">#' + L.esc(n.life) + '</span>';
    var linkable = /^[0-9]+$/.test(String(n.life));
    return '<' + (linkable ? 'a href="https://www.horsereality.com/horses/' + L.esc(n.life) + '/" target="_blank" rel="noopener"' : 'div') + ' title="' + L.esc(full) + '" style="text-decoration:none;color:inherit;display:block;grid-column:' + col + ';grid-row:' + row + ' / span ' + span + ';align-self:center;height:46px;overflow:hidden;box-sizing:border-box;' +
      'border:1px solid ' + (isShared ? 'var(--danger)' : 'var(--border)') + ';background:' + (isShared ? 'var(--danger-bg)' : 'var(--surface)') +
      ';border-radius:8px;padding:4px 8px;font-size:12px;line-height:1.2;">' +
      '<div style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + label + '</div>' +
      (n.name ? '<div class="mono" style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">#' + L.esc(n.life) + (n.cached ? '' : ' \u00b7 not cached') + '</div>' : '') + '</' + (linkable ? 'a' : 'div') + '>';
  }
  // Every generation is a column of equal boxes; a horse spans the rows of its own ancestors, so the
  // sire and dam lines line up whether or not their pedigrees are cached.
  function pedCellsHtml(n, shared, level, row, levels) {
    var span = Math.pow(2, levels - level);
    if (!n) {
      return level === 1 ? '<div style="grid-column:' + (level + 1) + ';grid-row:' + row + ' / span ' + span + ';align-self:center;height:46px;box-sizing:border-box;border:1px dashed var(--border);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px;">not cached</div>' : '';
    }
    var h = pedBoxHtml(n, shared, level + 1, row, span);
    if (level < levels) h += pedCellsHtml(n.s, shared, level + 1, row, levels) + pedCellsHtml(n.d, shared, level + 1, row + span / 2, levels);
    return h;
  }
  function foalPedigreeHtml(studLife, mareLife, common) {
    var shared = {};
    common.forEach(function (c) { shared[c.life] = true; });
    var sire = L.pedigreeTreeOf(state, studLife, CALC_GENERATIONS), dam = L.pedigreeTreeOf(state, mareLife, CALC_GENERATIONS);
    // only as many generations as have a known horse, so there are no empty columns
    var depth = function (n) { return n ? 1 + Math.max(depth(n.s), depth(n.d)) : 0; };
    var levels = Math.max(1, depth(sire), depth(dam)), rows = Math.pow(2, levels);
    var names = ['Parents', 'Grandparents', 'Great-grandparents', '3x great-grandparents', '4x great-grandparents'];
    var head = '';
    for (var i = 0; i < levels; i++) head += '<div style="grid-column:' + (i + 2) + ';grid-row:1;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);">' + (names[i] || ('Generation ' + (i + 1))) + '</div>';
    var root = '<div style="grid-column:1;grid-row:2 / span ' + rows + ';align-self:center;box-sizing:border-box;border:1px dashed var(--border-strong);background:var(--surface-2);border-radius:8px;padding:8px;font-size:12.5px;">' +
      '<strong>Foal</strong><div style="font-size:11px;color:var(--text-muted);margin-top:2px;">' + L.esc(L.ancestorName(state, mareLife) || 'Mare') + ' \u00d7 ' + L.esc(L.ancestorName(state, studLife) || 'Stallion') + '</div></div>';
    return '<div class="section-head"><h2>Foal pedigree</h2></div>' +
      '<div class="card" style="padding:14px;overflow-x:auto;margin-bottom:16px;"><div style="display:grid;min-width:max-content;column-gap:12px;grid-template-columns:130px repeat(' + levels + ', 170px);grid-template-rows:auto repeat(' + rows + ', 52px);">' +
        head + root + pedCellsHtml(sire, shared, 1, 2, levels) + pedCellsHtml(dam, shared, 1, 2 + rows / 2, levels) +
      '</div></div>' +
      '<p class="notes-line" style="margin-top:-8px;margin-bottom:16px;">Sire on top, dam below. Red outline = ancestor on both sides. Ancestors shown as a number only haven\'t been cached yet \u2014 visit their pages to fill them in. Click a box to open that horse on Horse Reality; hover for the full name.</p>';
  }

  // Under the pickers: is the chosen mare already covered, or in foal? And is that the pairing she's already got?
  function calcMareNoticeHtml() {
    if (!calcMare || !state.horseInfo[calcMare]) return '';
    var st = L.mareBreedStatus(state, calcMare);
    if (!st.status) return '';
    var name = state.horseInfo[calcMare].name || ('#' + calcMare);
    var tidy = function (n) { return String(n || '').replace(/^!/, '').replace(/[|]$/, '').trim().toLowerCase(); };
    var studName = calcStallion && state.horseInfo[calcStallion] ? state.horseInfo[calcStallion].name : '';
    var same = studName && st.stallion && tidy(studName) === tidy(st.stallion);
    var box = st.status === 'pregnant'
      ? { bg: '#f6dbe9', border: '#c8588f', fg: '#8a2a5c', head: '\u2665 ' + L.esc(name) + ' is in foal' + (st.stallion ? ' to ' + L.esc(st.stallion) : '') + (st.due ? ' \u2014 ' + L.esc(st.due.replace(/^Due /, 'due ')) : '') }
      : { bg: '#f6e4a8', border: '#d9a21b', fg: '#6b4f00', head: '\u2714 ' + L.esc(name) + ' is already covered' + (st.stallion ? ' by ' + L.esc(st.stallion) : '') + (st.date ? ' on ' + L.esc(L.fmtDate(st.date)) : '') + ' \u2014 waiting for the result' };
    return '<div style="background:' + box.bg + ';border:1px solid ' + box.border + ';color:' + box.fg + ';border-radius:10px;padding:10px 14px;margin:0 0 16px;font-size:14px;">' +
      '<strong>' + box.head + '</strong>' +
      (same ? '<div style="margin-top:3px;">This is the pairing she already has.</div>' : (studName ? '<div style="margin-top:3px;">You are comparing her with a different stallion (' + L.esc(studName) + ').</div>' : '')) +
      '</div>';
  }

  function renderCalculator() {
    var html = topHeaderHtml();
    html += '<div class="section-head"><h2>Foal Calculator</h2><button type="button" class="btn btn-sm" data-action="calc-refresh" title="Reload the saved horses and recalculate. Your mare and stallion stay selected.">Refresh</button></div>';
    html += '<div class="card" style="padding:12px 16px;margin-bottom:12px;max-width:380px;"><label for="calc-breed" style="font-weight:600;">Breed</label>' + breedSelectHtml('calc-breed', 'calc-breed', calcBreed) + '</div>';
    html += breedNoteHtml(breedInForce(calcBreed, calcMare || calcStallion), calcBreed, calcMare || calcStallion);
    html += '<div class="card" style="padding:16px;margin-bottom:16px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));">' +
      '<div class="field"><label for="calc-mare">Mare</label>' + calcFilterHtml('mare') + calcTypeaheadHtml('mare', calcMare) + '</div>' +
      '<div class="field"><label for="calc-stallion">Stallion</label>' + calcFilterHtml('stallion') + calcTypeaheadHtml('stallion', calcStallion) + '</div>' +
      '</div>';
    html += calcPlanHtml();
    html += calcSuggestionsHtml();
    html += calcMareNoticeHtml();

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

    html += preferredChancesHtml(calcStallion, calcMare);
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
  // "?/n": one copy known, the other not sure
  function suspectedOptionsHtml(locus, current) {
    var cur = current ? current.join('/') : '';
    return '<optgroup label="Suspected (not confirmed)">' + L.suspectedGenotypeOptions(locus).map(function (g) {
      return '<option value="' + L.esc(g) + '"' + (g === cur ? ' selected' : '') + '>' + L.esc(g.replace('/', ' / ')) + ' (suspected)</option>';
    }).join('') + '</optgroup>';
  }
  function peacockEditorHtml(lifeNumber) {
    var p = (state.horseMeta[lifeNumber] && state.horseMeta[lifeNumber].peacock) || {}, life = L.esc(lifeNumber);
    return '<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:end;"><label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="horse-peacock" data-life="' + life + '"' + (p.expressed ? ' checked' : '') + '> Peacock expressed</label>' +
      '<div class="field" style="margin:0;"><label for="pk-' + life + '">Line strength estimate (0\u2013100%)</label><input id="pk-' + life + '" type="number" min="0" max="100" step="5" data-action="horse-peacock-strength" data-life="' + life + '" value="' + (p.strength != null && p.strength !== '' ? L.esc(p.strength) : '') + '" placeholder="your estimate" style="max-width:150px;"></div></div>';
  }
  function geneEditorHtml(lifeNumber, title) {
    var info = state.horseInfo[lifeNumber] || {};
    var tested = L.parseColourGenes(info.testedColours);
    var manual = L.manualGenes(state, lifeNumber), suspected = L.suspectedGenes(state, lifeNumber);
    var life = L.esc(lifeNumber);
    var html = '<div><div style="font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">' + L.esc(title) + ' — ' + L.esc(info.name || ('#' + lifeNumber)) + '</div>' +
      '<div style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));">';
    L.MANUAL_LOCI.forEach(function (l) {
      var id = 'gene-' + life + '-' + l.id;
      html += '<div class="field"><label for="' + id + '">' + L.esc(l.id === 'A' ? 'Agouti, hidden alleles (A+, At)' : l.name) + (l.id === 'STY' && L.isYoungInfo(info) ? ' \u2014 cannot be told before age 3' : '') + '</label>';
      if (l.id === 'A') {
        var curA = manual.A ? manual.A.join('/') : '';
        var opts = L.extraGenotypeOptions(l).filter(function (g) { return !tested.A || L.agoutiPlain(g.split('/')).join() === L.agoutiPlain(tested.A).join(); });
        html += '<select id="' + id + '" data-action="horse-gene" data-life="' + life + '" data-locus="A">' +
          '<option value=""' + (curA ? '' : ' selected') + '>' + (tested.A ? 'As tested (' + L.esc(tested.A.join(' / ')) + ')' : 'Not known') + '</option>' +
          opts.map(function (g) { return '<option value="' + L.esc(g) + '"' + (g === curA ? ' selected' : '') + '>' + L.esc(g.replace('/', ' / ')) + '</option>'; }).join('') + suspectedOptionsHtml(l, suspected[l.id]) + '</select>';
      } else if (tested[l.id]) {
        html += '<select id="' + id + '" disabled><option>' + L.esc(L.genotypeText(l, tested[l.id])) + ' (from Horse Reality)</option></select>';
      } else {
        var cur = manual[l.id] ? manual[l.id].join('/') : '';
        html += '<select id="' + id + '" data-action="horse-gene" data-life="' + life + '" data-locus="' + L.esc(l.id) + '">' +
          '<option value=""' + (cur ? '' : ' selected') + '>Not present (default)</option>' +
          L.extraGenotypeOptions(l).map(function (g) { return '<option value="' + L.esc(g) + '"' + (g === cur ? ' selected' : '') + '>' + L.esc(L.genotypeOptionLabel(l, g)) + '</option>'; }).join('') + suspectedOptionsHtml(l, suspected[l.id]) +
        '</select>';
      }
      html += '</div>';
    });
    return html + '</div></div>';
  }

  // ---------- high scores: top conformation + Breed Total (BT) ----------
  // BT = ((Genetic Potential / 10) + top conformation score) / 2. Both highs are
  // only ever raised; their dates come from Horse Reality's results list when
  // it shows one, otherwise the day the ledger first saw the score.
  function isoFromMs(ms) {
    var d = new Date(ms);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function highDateText(date, at) {
    if (date) return L.fmtDate(date);
    return at ? 'seen ' + L.fmtDate(isoFromMs(at)) : '';
  }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function highScoreInfo(life) {
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var info = (state.horseInfo && state.horseInfo[life]) || {};
    var conf = L.bestConformation(meta).best;
    var out = { conf: null, bt: null, low: null, comp: null };
    // competition: the best score in the discipline you breed for (or in any when none is chosen), with the discipline and when
    var cs = L.compSummary(state, life);
    if (cs) {
      var fd = state.settings && state.settings.focusDiscipline, row = fd ? cs.by.find(function (r) { return r.discipline === fd; }) : cs.by[0];
      if (row) out.comp = { value: round3(row.high), discipline: row.discipline, n: row.n, low: row.low ? round3(row.low) : null, when: highDateText(row.highDate, row.highAt), event: row.highEvent || '' };
    }
    if (conf) {
      out.conf = { value: round3(conf), when: highDateText(meta.confBestDate, meta.confBestAt), event: meta.confBestEvent || '' };
    }
    var lowV = Number(meta.confLow) || 0;
    if (conf && lowV && lowV <= conf) { var rst = L.rangeStatus(state, life); out.low = { value: round3(lowV), range: round3(conf - lowV), when: highDateText(meta.confLowDate, meta.confLowAt), event: meta.confLowEvent || '', source: meta.confLowSource || '', full: rst && rst.full, ranged: !!(rst && rst.ranged) }; }
    var btNow = L.breedTotal(info.geneticPotential, conf);
    var btVal = Math.max(Number(meta.btBest) || 0, btNow);
    if (btVal) {
      var stored = Number(meta.btBest) >= btNow && Number(meta.btBest) > 0;
      out.bt = {
        value: round3(btVal),
        when: stored ? highDateText(meta.btBestDate, meta.btBestAt) : 'seen ' + L.fmtDate(isoFromMs(Date.now())),
        formula: stored && meta.btBestGp ? '((GP ' + meta.btBestGp + ' ÷ 10) + ' + round3(meta.btBestConf) + ') ÷ 2' : '((GP ' + info.geneticPotential + ' ÷ 10) + ' + round3(conf) + ') ÷ 2'
      };
    }
    return out;
  }
  // rows for the horse cards (stallion / mare / young horse)
  function highScoreRowsHtml(life) {
    var h = highScoreInfo(life);
    var sub = 'font-size:11.5px;color:var(--text-muted);text-align:right;padding:0 0 3px;';
    var out = '';
    // a competition breeder sees the competition score first, everyone else the conformation score
    var fx = (state.settings && state.settings.breederFocus) || {}, compFirst = !!fx.comp && !fx.conf;
    var compRow = h.comp ? '<div class="row"><span>Top competition</span><span class="v mono">' + L.esc(h.comp.value) + ' <span class="sub">(' + L.esc(h.comp.discipline) + (h.comp.n > 1 ? ', ' + h.comp.n + ' results' : '') + ')</span></span></div>' + (h.comp.when || h.comp.event ? '<div style="' + sub + '">' + L.esc([h.comp.when, h.comp.event].filter(Boolean).join(' \u00b7 ')) + '</div>' : '') : '';
    if (compFirst) out += compRow;
    if (h.conf) {
      out += '<div class="row"><span>Top conformation</span><span class="v mono">' + L.esc(h.conf.value) + '</span></div>' +
        '<div style="' + sub + '">' + L.esc([h.conf.when, h.conf.event].filter(Boolean).join(' · ')) + '</div>';
      if (h.low) out += '<div class="row"><span>Lowest conformation</span><span class="v mono">' + L.esc(h.low.value) + ' <span class="sub">(range ' + L.esc(h.low.range) + (h.low.full ? ' of ' + L.esc(h.low.full) : '') + ')</span></span></div>' + '<div style="' + sub + '">' + L.esc([h.low.when, h.low.event].filter(Boolean).join(' · ')) + '</div>' + (h.low.ranged ? '<div style="' + sub + 'color:var(--near);font-weight:600;">\u25C6 Ranged: high and low span the full range</div>' : '');
    }
    if (!compFirst) out += compRow;
    if (h.bt) {
      out += '<div class="row"><span>Breed Total (BT)</span><span class="v mono">' + L.esc(h.bt.value) + '</span></div>' +
        '<div style="' + sub + '">' + L.esc([h.bt.when, h.bt.formula].filter(Boolean).join(' · ')) + '</div>';
    }
    return out;
  }
  // tags for a horse's own page header
  function highScoreTagsHtml(life) {
    var h = highScoreInfo(life);
    var out = '';
    var fxt = (state.settings && state.settings.breederFocus) || {}, compTag = h.comp ? '<span class="tag mono" title="Highest competition score in ' + L.esc(h.comp.discipline) + (h.comp.low ? ' (lowest ' + L.esc(h.comp.low) + ')' : '') + '">Top comp ' + L.esc(h.comp.value) + ' \u00b7 ' + L.esc(h.comp.discipline) + '</span>' : '';
    if (fxt.comp && !fxt.conf) out += compTag;
    if (h.conf) out += '<span class="tag mono" title="' + L.esc(['Highest conformation show score', h.conf.event].filter(Boolean).join(' — ')) + '">Top confo ' + L.esc(h.conf.value) + (h.conf.when ? ' · ' + L.esc(h.conf.when) : '') + '</span>';
    if (h.low) out += '<span class="tag mono" title="' + L.esc(['Lowest conformation show score', h.low.event].filter(Boolean).join(' — ')) + '">Low confo ' + L.esc(h.low.value) + (h.low.when ? ' · ' + L.esc(h.low.when) : '') + '</span>';
    if (h.low && h.low.ranged) out += '<span class="tag mono" style="color:var(--near);border-color:var(--near);" title="Highest minus lowest conformation score has reached the full range of ' + L.esc(h.low.full) + ' for this breed, so no later show can widen it">\u25C6 Ranged</span>';
    if (!(fxt.comp && !fxt.conf)) out += compTag;
    if (h.bt) out += '<span class="tag mono" title="Breed Total = ((Genetic Potential ÷ 10) + top conformation) ÷ 2: ' + L.esc(h.bt.formula) + '">BT ' + L.esc(h.bt.value) + (h.bt.when ? ' · ' + L.esc(h.bt.when) : '') + '</span>';
    return out;
  }
  function btLineHtml(life) {
    var h = highScoreInfo(life);
    if (!h.bt) return '';
    return '<div class="sub" title="' + L.esc(h.bt.formula) + '">BT <strong>' + L.esc(h.bt.value) + '</strong>' + (h.bt.when ? ' · ' + L.esc(h.bt.when) : '') + '</div>';
  }

  // ---------- goals: highlight horses that meet your minimums / maximums ----------
  var goalsOpen = false;
  var notesOpen = false;
  var buyOpen = false;
  var buyScope = ''; // breed the purchase criteria are being edited for ('' = all breeds)
  var buySex = ''; // 'mare' (mares & fillies), 'stallion' (colts & stallions) or '' (both) — who the criteria being edited are for
  function buyStoreKey() { return (buyScope ? L.breedKeyOf(buyScope) : '') + (buySex ? '|' + buySex : ''); }
  var prefScope = ''; // breed the Preferred genetics choices apply to ('' = all breeds)
  // classes for a horse's card or row: outlined if it meets your goals, and a big $ behind it if it is for sale
  function goalClass(life) {
    // outlined gold when every goal is met; outlined blue when exactly one goal box is missed ("off by one")
    var met = L.goalCheck(state, life).met;
    var near = !met && L.goalMisses(state, life).length === 1;
    return (met ? ' goal-hit' : near ? ' goal-near' : '') + (lifeStatus(life) === 'For Sale' ? ' for-sale' : '');
  }
  // Three labelled boxes shown above a horse's picture: green = meets that
  // goal, red = doesn't, grey = no goal set or no data yet. Hidden entirely
  // until at least one goal is set.
  function goalStripHtml(life) {
    var c = L.goalCheck(state, life);
    if (!c.active) return '';
    function box(sec) {
      // gold (Health: more than 3 Excellent; Fertility: Excellent) overrides green/red/grey
      var text = sec.text;
      var hasGoal = sec.text !== 'no goal' && sec.text !== 'no data yet';
      if (sec.gold) text = sec.label === 'Health' ? sec.goldText + (hasGoal ? ' \u00b7 ' + sec.text : '') : (hasGoal ? sec.text : sec.goldText);
      return '<div class="goal-sec ' + (sec.gold ? 'gold' : sec.state) + '" title="' + L.esc(sec.label + ': ' + text) + '"><span class="gl">' + L.esc(sec.label) + '</span>' + L.esc(text) + '</div>';
    }
    return '<div class="goal-strip">' + box(c.sections.conf) + box(c.sections.gp) + box(c.sections.bt) + box(c.sections.traits) + box(c.sections.health) + box(c.sections.fertility) + '</div>';
  }
  // Named sets of goals (for example one per breed or project) that can be swapped in with one click.
  function goalSetsHtml() {
    var sets = (state.settings && state.settings.goalSets) || {};
    var names = Object.keys(sets);
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
      '<strong style="font-size:13px;">Goal sets</strong>' +
      (names.length ? '<select data-action="goalset-load" aria-label="Load a saved goal set"><option value="">Load a set\u2026</option>' + names.map(function (n) { return '<option value="' + L.esc(n) + '">' + L.esc(n) + '</option>'; }).join('') + '</select>' +
        '<select id="goalset-del" aria-label="Delete a saved goal set"><option value="">Delete a set\u2026</option>' + names.map(function (n) { return '<option value="' + L.esc(n) + '">' + L.esc(n) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-sm" data-action="goalset-delete">Delete</button>' : '') +
      '<input id="goalset-name" type="text" placeholder="Name this set (e.g. Appaloosa)" style="max-width:220px;"><button type="button" class="btn btn-sm" data-action="goalset-save">Save current goals as set</button></div>';
  }
  // Suggestions on when to raise the goals and to what, from the herd and recent foals.
  function goalAdviceHtml() {
    var a = goalAdviceAll();
    if (!a.tips.length && !a.review.length) return '';
    var kinds = { start: 'Set', raise: 'Raise', lower: 'Lower' };
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);"><strong style="font-size:13px;">Goal suggestions</strong>' +
      a.review.map(function (t) { return '<div class="an-tip info" style="margin-top:6px;">' + L.esc(t) + '</div>'; }).join('') +
      a.tips.map(function (t) {
        return '<div class="an-tip tip" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;"><span style="flex:1 1 300px;">' + (t.who ? '<span class="tag" style="margin-right:6px;">' + L.esc(t.who) + '</span>' : '') + '<strong>' + kinds[t.kind] + ' ' + L.esc(t.label) + (t.current != null ? ' from ' + L.esc(t.current) : '') + ' to ' + L.esc(t.suggested) + '</strong><br><span class="sub" style="font-size:12.5px;">' + L.esc(t.why) + '</span></span>' +
          '<button type="button" class="btn btn-sm" data-action="goal-apply" data-field="' + t.key + '" data-set="' + L.esc(t.set || 'goals') + '" data-value="' + L.esc(t.suggested) + '">Apply</button></div>';
      }).join('') + '</div>';
  }
  // Purchase criteria: what a horse you are thinking of buying should have, per breed, with starting values taken from your
  // own herd. Checked against any horse that is not yours when you open its page on Horse Reality.
  function purchasePanelHtml() {
    var all = (state.settings && state.settings.buyCriteria) || {};
    var scopeKey = buyScope ? L.breedKeyOf(buyScope) : '';
    var own = all[buyStoreKey()] || {};
    var eff = L.buyCriteriaOf(state, buyScope, buySex);
    var adv = L.buyAdvice(state, buyScope, buySex);
    var tipCount = adv.tips.length + (adv.traits && !(own.needTraits || []).length ? 1 : 0);
    var breeds = {}, names = [];
    Object.keys(state.horseInfo || {}).forEach(function (l) { var b = state.horseInfo[l].breed, k = L.breedKeyOf(b); if (k && !breeds[k]) { breeds[k] = true; names.push(b); } });
    Object.keys(all).forEach(function (k0) { var k = k0.split("|")[0]; if (k && !breeds[k]) { breeds[k] = true; names.push(L.HR_BREEDS.find(function (b) { return L.breedKeyOf(b) === k; }) || k); } });
    function field(label, key, step) {
      return '<div class="field"><label for="buy-' + key + '">' + label + '</label><input id="buy-' + key + '" type="number" min="0" step="' + step + '" data-action="update-buy" data-field="' + key + '" value="' + (own[key] != null ? L.esc(own[key]) : '') + '" placeholder="' + (own[key] == null && key !== 'maxPrice' && eff.goals && eff.goals[key] != null ? 'also set above: ' + L.esc(eff.goals[key]) : own[key] == null && key === 'maxPrice' && eff.maxPrice ? 'also set above: ' + L.esc(eff.maxPrice) : 'no limit') + '"></div>';
    }
    function sel(label, key, options) {
      return '<div class="field"><label for="buy-' + key + '">' + label + '</label><select id="buy-' + key + '" data-action="update-buy" data-field="' + key + '" style="width:100%;">' +
        options.map(function (o) { return '<option value="' + o[0] + '"' + (String(own[key] == null ? '' : own[key]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    }
    var need = own.needTraits || [];
    var html = '<details class="buy-panel"' + (buyOpen ? ' open' : '') + '><summary>Purchase criteria \u2014 what a horse should have for you to buy it' + (tipCount ? ' \u00b7 ' + tipCount + ' suggestion' + (tipCount === 1 ? '' : 's') : '') + '</summary>' +
      '<p class="notes-line" style="margin:6px 0;">Set what you look for in a horse to buy, for all breeds or one breed at a time. When you open a horse that is not yours on Horse Reality, the summary in the corner of the page checks it against these and says whether it would lift your own herd of that breed.</p>' +
      '<div style="margin:6px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><label for="buy-sex" style="font-size:13px;font-weight:600;">Applies to</label><select id="buy-sex" data-action="buy-sex"><option value=""' + (buySex ? '' : ' selected') + '>Mares, fillies, colts and stallions</option><option value="mare"' + (buySex === 'mare' ? ' selected' : '') + '>Mares &amp; fillies</option><option value="stallion"' + (buySex === 'stallion' ? ' selected' : '') + '>Colts &amp; stallions</option></select><label for="buy-scope" style="font-size:13px;font-weight:600;">Set for</label><select id="buy-scope" data-action="buy-scope"><option value="">All breeds</option>' +
        names.sort().map(function (b) { return '<option value="' + L.esc(b) + '"' + (L.breedKeyOf(b) === scopeKey ? ' selected' : '') + '>' + L.esc(b) + '</option>'; }).join('') + '</select>' + '<span class="sub" style="font-size:12.5px;">An empty field uses the next wider setting: this breed for both sexes, then all breeds for this sex, then all breeds for both.</span></div>' +
      '<div class="goals-grid">' + field('Min Genetic Potential', 'minGP', 'any') + field('Min top conformation', 'minConf', 'any') + field('Min Breed Total', 'minBT', 'any') + field('Highest price you will pay (HRC)', 'maxPrice', '1000') + '</div>' +
      '<div class="goals-grid">' +
        sel('Lowest conformation trait rating allowed', 'traitWorst', [['', 'no limit'], ['GP', 'G+ (Good+)'], ['G', 'G (Good)'], ['A', 'A (Average)'], ['BA', 'BA (Below average)']]) + field('How many traits may sit at that rating', 'traitWorstMax', '1') +
        sel('Worst health rating accepted', 'healthWorst', [['', 'no limit'], ['good', 'Good'], ['average', 'Average'], ['fair', 'Fair'], ['poor', 'Poor']]) + field('How many at that rating (of 5)', 'healthWorstMax', '1') +
        sel('Min fertility', 'minFert', [['', 'no limit'], ['poor', 'Poor'], ['fair', 'Fair'], ['average', 'Average'], ['good', 'Good'], ['excellent', 'Excellent']]) +
      '</div>' +
      '<div style="margin-top:8px;"><strong style="font-size:13px;">Traits it must be Good or better in</strong><div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px;">' +
        ['Walk', 'Trot', 'Canter', 'Gallop', 'Posture', 'Head', 'Neck', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters'].map(function (t) {
          return '<label style="display:inline-flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="buy-trait" data-trait="' + t + '"' + (need.indexOf(t) > -1 ? ' checked' : '') + '> ' + t + '</label>';
        }).join('') + '</div></div>';
    if (adv.herdSize < 3) {
      html += '<p class="notes-line" style="margin:10px 0 0;">Suggestions appear once at least 3 of your horses' + (scopeKey ? ' of this breed' : '') + ' are saved.</p>';
    } else if (tipCount) {
      html += '<div style="margin-top:10px;"><strong style="font-size:13px;">Suggestions from your herd (' + adv.herdSize + ' horses)</strong>' +
        adv.tips.map(function (t) {
          return '<div class="an-tip tip" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;"><span style="flex:1 1 300px;"><strong>' + (t.current != null ? 'Raise' : 'Set') + ' ' + L.esc(t.label) + (t.current != null ? ' from ' + L.esc(t.current) : '') + ' to ' + L.esc(t.suggested) + '</strong><br><span class="sub" style="font-size:12.5px;">' + L.esc(t.why) + '</span></span>' +
            '<button type="button" class="btn btn-sm" data-action="buy-apply" data-field="' + t.field + '" data-value="' + L.esc(t.suggested) + '">Apply</button></div>';
        }).join('') +
        (adv.traits && !need.length ? '<div class="an-tip tip" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;"><span style="flex:1 1 300px;"><strong>Require Good or better in ' + L.esc(adv.traits.traits.join(', ')) + '</strong><br><span class="sub" style="font-size:12.5px;">' + L.esc(adv.traits.why) + '</span></span><button type="button" class="btn btn-sm" data-action="buy-apply" data-traits="' + L.esc(adv.traits.traits.join(',')) + '">Apply</button></div>' : '') + '</div>';
    }
    return html + '</details>';
  }
  // My notes: free text the ledger reads for phrases it knows (keep, sell, don't breed, pair with, avoid, max fee...)
  // and says what it understood. Horse notes are on each horse's page; these are for the whole ledger.
  function notesPanelHtml() {
    var text = (state.settings && state.settings.notes) || '';
    var rules = L.parseNotes(text, true);
    var horses = Object.keys(state.horseMeta || {}).map(function (l) {
      var n = state.horseMeta[l] && state.horseMeta[l].notes;
      return n ? { life: l, name: (state.horseInfo[l] && state.horseInfo[l].name) || ('#' + l), rules: L.parseNotes(n) } : null;
    }).filter(function (h) { return h && h.rules.understood.length; });
    var total = rules.understood.length + horses.length;
    var html = '<details class="notes-panel"' + (notesOpen ? ' open' : '') + '><summary>My notes \u2014 used when making suggestions' + (total ? ' \u00b7 ' + total + ' understood' : '') + '</summary>' +
      '<p class="notes-line" style="margin:6px 0;">Write notes about how you breed. The ledger has no guesswork: it looks for plain phrases and lists what it understood below. In your <strong>overall notes</strong> it knows <em>max stud fee 500000</em>, <em>avoid inbreeding</em>, <em>fertility matters</em> and <em>keep all mares</em> (or stallions, fillies, colts). On a <strong>horse\'s own page</strong> it knows <em>keep</em> / <em>don\'t sell</em>, <em>sell</em>, <em>don\'t breed</em>, <em>pair with &lt;name&gt;</em> and <em>avoid &lt;name&gt;</em>.</p>' +
      '<textarea id="overall-notes" data-action="update-overall-notes" rows="5" style="width:100%;" placeholder="For example:&#10;Max stud fee 600000&#10;Avoid inbreeding&#10;Keep all mares">' + L.esc(text) + '</textarea>' +
      '<div style="margin-top:8px;"><strong style="font-size:13px;">Understood from these notes</strong>' +
      (rules.understood.length ? rules.understood.map(function (u) { return '<div class="an-tip info" style="margin-top:4px;">' + L.esc(u) + '</div>'; }).join('') : '<p class="notes-line" style="margin:4px 0 0;">Nothing recognised yet. Saved when you click away.</p>') + '</div>';
    if (horses.length) {
      html += '<div style="margin-top:10px;"><strong style="font-size:13px;">Understood from horse notes</strong>' + horses.slice(0, 15).map(function (h) {
        return '<div class="an-tip info" style="margin-top:4px;"><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(h.life) + '">' + L.esc(h.name) + '</button>: ' + L.esc(h.rules.understood.join('; ')) + '</div>';
      }).join('') + (horses.length > 15 ? '<p class="notes-line" style="margin:4px 0 0;">and ' + (horses.length - 15) + ' more.</p>' : '') + '</div>';
    }
    html += breederFocusHtml();
    html += partnersHtml();
    html += preferredGenesHtml();
    html += '<label style="display:flex;align-items:center;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:13px;cursor:pointer;"><input type="checkbox" data-action="update-fit-banner"' + (state.settings.fitBanner === false ? '' : ' checked') + '> Show a "fits / doesn\'t fit my criteria" summary on Horse Reality horse pages</label>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="update-ranch-advice"' + (state.settings.ranchAdvice === false ? '' : ' checked') + '> Show Keep / Sell and the best stallion for each mare on the cards of my Horse Reality ranch page</label>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="update-save-studs"' + (state.settings.saveMarketStuds === false ? '' : ' checked') + '> Save the stallions listed on the Studs &amp; Semen market (a few at a time) so they show up in the Foal Calculator and suggestions</label>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="update-learn"' + (state.settings.learn === false ? '' : ' checked') + '> Let the ledger learn from my foals, sales and bids to improve its breeding and purchase suggestions</label>' +
      '<label style="display:flex;align-items:center;gap:6px;margin-top:6px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="update-market-highlight"' + (state.settings.marketHighlight === false ? '' : ' checked') + '> Colour market rows green or red for horses I have looked at (would lift my herd or not)</label>';
    return html + '</details>';
  }
  // Other players whose stallions you breed to
  function partnersHtml() {
    var list = L.partnerList(state);
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);"><strong style="font-size:13px;">Breeding partners' + (list.length ? ' (' + list.length + ' of ' + L.MAX_PARTNERS + ')' : '') + '</strong>' +
      '<p class="notes-line" style="margin:4px 0 8px;">Add the Horse Reality user names of players whose stallions you breed to. Their stallions saved in the ledger are marked <em>Partner</em>, ranked a little higher in the suggestions, and found with <em>#partner</em> in a list filter. Horses of theirs you open are saved like any other horse.</p>' +
      '<div style="margin-bottom:6px;">' + (list.map(function (p) { return '<span class="tag" style="margin:0 6px 4px 0;">' + L.esc(p) + ' <button type="button" class="link-btn" data-action="partner-remove" data-name="' + L.esc(p) + '" aria-label="Remove ' + L.esc(p) + '">\u00d7</button></span>'; }).join('') || '<span class="sub">No partners yet.</span>') + '</div>' +
      (list.length < L.MAX_PARTNERS ? '<form data-action="partner-add" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;"><input name="partner" type="text" maxlength="40" placeholder="User name" autocomplete="off" style="max-width:220px;"><button type="submit" class="btn btn-sm">Add partner</button></form>' : '') + '</div>';
  }
  // What kind of breeder you are: horses strong in it are rated a bit higher, weak ones a bit lower
  function breederFocusHtml() {
    var f = state.settings.breederFocus || {};
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);"><strong style="font-size:13px;">Breeder focus</strong>' +
      '<p class="notes-line" style="margin:4px 0 8px;">Tick what you breed for. Horses that are strong in it are less likely to be suggested for sale, rank higher as partners and count more when you look at a horse to buy; a missed goal in that area counts for more, and the ranch page cards weigh it more when placing a horse between keep and sell.</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:6px 16px;">' + L.FOCUS_TYPES.map(function (t) {
        return '<label style="display:inline-flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;" title="' + L.esc(t.hint) + '"><input type="checkbox" data-action="update-focus" data-focus="' + t.key + '"' + (f[t.key] ? ' checked' : '') + '> ' + L.esc(t.label) + '</label>';
      }).join('') + '</div>' +
      (f.comp ? '<div class="field" style="margin-top:8px;max-width:260px;"><label for="focus-disc">Competition discipline</label><select id="focus-disc" data-action="update-focus-discipline" style="width:100%;"><option value="">Whichever suits the horse best</option>' +
        L.DISCIPLINES.map(function (d) { return '<option' + (state.settings.focusDiscipline === d.name ? ' selected' : '') + '>' + L.esc(d.name) + '</option>'; }).join('') + '</select></div>' : '') + '</div>';
  }
  // Genes you want to keep: a level for each (no preference / prefer / keep).
  function preferredGenesHtml() {
    var st = state.settings || {};
    var scopeKey = prefScope ? L.breedKeyOf(prefScope) : '';
    var own = scopeKey ? ((st.preferGenesByBreed || {})[scopeKey] || {}) : (st.preferGenes || {});
    var pm = L.preferenceMap(state, prefScope), count = Object.keys(pm).length;
    var breeds = {}, names = [];
    Object.keys(state.horseInfo || {}).forEach(function (l) { var b = state.horseInfo[l].breed, k = L.breedKeyOf(b); if (k && !breeds[k]) { breeds[k] = true; names.push(b); } });
    L.HR_BREEDS.forEach(function (b) { var k = L.breedKeyOf(b); if (!breeds[k] && (st.preferGenesByBreed || {})[k]) { breeds[k] = true; names.push(b); } });
    return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border);"><strong style="font-size:13px;">Preferred genetics' + (count ? ' (' + count + ' chosen' + (scopeKey ? ' for ' + L.esc(prefScope) : '') + ')' : '') + '</strong>' +
      '<div style="margin:6px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center;"><label for="pref-scope" style="font-size:13px;font-weight:600;">Set for</label><select id="pref-scope" data-action="pref-scope"><option value="">All breeds</option>' + names.sort().map(function (b) { return '<option value="' + L.esc(b) + '"' + (L.breedKeyOf(b) === scopeKey ? ' selected' : '') + '>' + L.esc(b) + '</option>'; }).join('') + '</select>' + (scopeKey ? '<span class="sub" style="font-size:12.5px;">"Same as all breeds" uses your all-breeds choice for that gene.</span>' : '') + '</div>' +
      '<p class="notes-line" style="margin:4px 0 8px;"><strong>Prefer</strong>: a horse with the gene is less likely to be suggested for sale, and a pairing that could give a foal the gene ranks higher. <strong>Keep</strong>: never suggested for sale, and pairings ranked higher still. <strong>Avoid</strong>: a gene you do not want; a horse with it is marked and more likely to be suggested for sale, and a pairing that could give it ranks lower. Needs the horse\'s colours tested (or entered under Extra genes).</p>' +
      '<div style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">' + L.preferLoci().map(function (l) {
        var cur = own[l.id] || '';
        return '<div class="field"><label for="pg-' + l.id + '">' + L.esc(l.name) + '</label><select id="pg-' + l.id + '" data-action="update-prefer-gene" data-gene="' + l.id + '">' +
          '<option value=""' + (cur ? '' : ' selected') + '>' + (scopeKey ? 'Same as all breeds' : 'No preference') + '</option>' + (scopeKey ? '<option value="none"' + (cur === 'none' ? ' selected' : '') + '>No preference</option>' : '') +
          '<option value="prefer"' + (cur === 'prefer' ? ' selected' : '') + '>Prefer</option><option value="keep"' + (cur === 'keep' ? ' selected' : '') + '>Keep</option><option value="avoid"' + (cur === 'avoid' ? ' selected' : '') + '>Avoid</option></select></div>';
      }).join('') + '</div></div>';
  }
  function preferredChancesHtml(aLife, bLife) {
    var ch = L.foalPreferredChances(state, aLife, bLife);
    if (!ch.length) return '';
    return '<div class="card" style="padding:12px 16px;margin-bottom:14px;"><strong>Your preferred and unwanted genes</strong>' + ch.map(function (c) {
      return '<div style="display:grid;grid-template-columns:150px 1fr 56px;gap:10px;align-items:center;padding:3px 0;font-size:13.5px;"><span>' + L.esc(c.name) + ' <span class="sub">(' + c.level + ')</span></span>' +
        '<span style="background:var(--surface-2);border-radius:6px;height:10px;overflow:hidden;"><span style="display:block;height:100%;width:' + Math.round(c.p * 100) + '%;background:var(--' + (c.level === 'avoid' ? 'danger' : 'accent') + ');"></span></span><span class="mono">' + Math.round(c.p * 100) + '%</span></div>';
    }).join('') + '<p class="notes-line" style="margin:6px 0 0;">The chance the foal has at least one copy. A gene neither parent is tested for counts as not there.</p></div>';
  }
  // Competition scores (high, low and per discipline), read from results pages and the horse's stats page, or entered by hand
  // exactly like the conformation scores: pick the discipline, then its highest and lowest score with date and show.
  var compEditDisc = {};
  function setCompBest(life, field, value) {
    if (!life) return;
    var sel = document.getElementById('cb-disc-' + life), disc = (sel && sel.value) || compEditDisc[life];
    if (!disc) return;
    var meta = state.horseMeta[life] = Object.assign({}, state.horseMeta[life]);
    var c = Object.assign({}, meta.comp), by = Object.assign({}, c.by), rec = Object.assign({ n: 0 }, by[disc]);
    var num = parseFloat(String(value).replace(',', '.')), ok = isFinite(num) && num > 0 && num <= 1000;
    if (field === 'high' || field === 'low') {
      if (ok) { rec[field] = num; rec[field + 'At'] = Date.now(); if (!rec[field + 'Event']) rec[field + 'Event'] = 'entered by hand'; }
      else { delete rec[field]; delete rec[field + 'At']; delete rec[field + 'Date']; delete rec[field + 'Event']; }
    } else if (field === 'highDate' || field === 'lowDate') rec[field] = String(value || '').trim();
    else if (field === 'highEvent' || field === 'lowEvent') rec[field] = String(value || '').trim().slice(0, 90);
    if (!(rec.high > 0) && !(rec.low > 0)) delete by[disc]; else by[disc] = rec;
    c.by = by;
    var highs = Object.keys(by).map(function (k) { return by[k].high; }).filter(function (v) { return v > 0; });
    var lows = Object.keys(by).map(function (k) { return by[k].low; }).filter(function (v) { return v > 0; });
    if (highs.length) c.high = Math.max.apply(null, highs); else delete c.high;
    if (lows.length) c.low = Math.min.apply(null, lows); else delete c.low;
    c.at = Date.now(); meta.comp = c;
    persist();
  }
  function compPanelHtml(life) {
    if (!life || !state.horseInfo[life]) return '';
    var meta = state.horseMeta[life] || {}, cs = L.compSummary(state, life), by = (meta.comp && meta.comp.by) || {}, id = L.esc(life);
    var discs = L.COMP_DISCIPLINES.slice();
    Object.keys(by).forEach(function (k) { if (discs.indexOf(k) < 0) discs.push(k); });
    // the discipline the horse is in training for is read from its page (Training: "Western Reining - Level 1/10 - 100%")
    var trained = (String(state.horseInfo[life].training || '').split(',').map(function (t) { return L.disciplineNameOf(t); }).filter(Boolean))[0] || '';
    var disc = compEditDisc[life] || trained || (state.settings && state.settings.focusDiscipline) || Object.keys(by)[0] || discs[0];
    if (discs.indexOf(disc) < 0) disc = discs[0];
    var rec = by[disc] || {};
    var att = function (field) { return ' data-action="comp-best" data-life="' + id + '" data-field="' + field + '"'; };
    var head = 'Competition scores \u2014 ' + (cs ? 'best ' + L.esc(cs.high) + (cs.by[0] ? ' (' + L.esc(cs.by[0].discipline) + ')' : '') : 'not recorded');
    var table = cs && cs.by.length ? '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Discipline</th><th class="num">High</th><th class="num">Low</th><th class="num">Range</th><th class="num">Seen</th><th>When \u00b7 where (high)</th></tr></thead><tbody>' + cs.by.map(function (r) {
      return '<tr><td>' + L.esc(r.discipline) + '</td><td class="num mono">' + L.esc(r.high) + '</td><td class="num mono">' + (r.low ? L.esc(r.low) : '\u2014') + '</td><td class="num mono">' + (r.low ? L.esc(round3(r.high - r.low)) : '\u2014') + '</td><td class="num mono">' + (r.n || '\u2014') + '</td><td>' + L.esc([highDateText(r.highDate, r.highAt), r.highEvent].filter(Boolean).join(' \u00b7 ')) + '</td></tr>';
    }).join('') + '</tbody></table></div>' : '';
    return '<details class="profile-block" style="margin:0 0 16px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">' + head + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;">' + (state.horseInfo[life].training ? '<div class="sub" style="margin-bottom:10px;">In training: <strong>' + L.esc(state.horseInfo[life].training) + '</strong> (read from Horse Reality; that discipline is chosen below first)</div>' : '') + table +
      '<div style="display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:' + (table ? '12' : '0') + 'px;">' +
        '<div class="field"><label for="cb-disc-' + id + '">Discipline</label><select id="cb-disc-' + id + '" data-action="comp-disc" data-life="' + id + '">' + discs.map(function (n) { return '<option' + (n === disc ? ' selected' : '') + '>' + L.esc(n) + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label for="cb-high-' + id + '">Highest score</label><input id="cb-high-' + id + '" type="number" min="0" max="1000" step="any"' + att('high') + ' value="' + (rec.high ? L.esc(rec.high) : '') + '" placeholder="e.g. 83.774"></div>' +
        '<div class="field"><label for="cb-low-' + id + '">Lowest score (range ' + (rec.high && rec.low ? L.esc(round3(rec.high - rec.low)) : '\u2014') + ')</label><input id="cb-low-' + id + '" type="number" min="0" max="1000" step="any"' + att('low') + ' value="' + (rec.low ? L.esc(rec.low) : '') + '" placeholder="e.g. 70.1"></div>' +
        '<div class="field"><label for="cb-hdate-' + id + '">Highest: date earned (optional)</label><input id="cb-hdate-' + id + '" type="date"' + att('highDate') + ' value="' + L.esc(rec.highDate || '') + '"></div>' +
        '<div class="field"><label for="cb-hevent-' + id + '">Highest: competition (optional)</label><input id="cb-hevent-' + id + '" type="text"' + att('highEvent') + ' value="' + L.esc(rec.highEvent || '') + '" placeholder="e.g. Western Reining, Training Level"></div>' +
        '<div class="field"><label for="cb-ldate-' + id + '">Lowest: date earned (optional)</label><input id="cb-ldate-' + id + '" type="date"' + att('lowDate') + ' value="' + L.esc(rec.lowDate || '') + '"></div>' +
        '<div class="field"><label for="cb-levent-' + id + '">Lowest: competition (optional)</label><input id="cb-levent-' + id + '" type="text"' + att('lowEvent') + ' value="' + L.esc(rec.lowEvent || '') + '" placeholder="e.g. Western Reining, Training Level"></div>' +
        '<p class="notes-line" style="margin:0;grid-column:1/-1;">Pick a discipline, then enter its highest and lowest score by hand if the ledger has not read them (it reads them when you open a competition\'s results page or the horse\'s stats page). The high only goes up and the low only goes down when read automatically; one you enter is always kept, and clearing a box removes it. Competition scores show on the card (Top competition) and in the page header, and count in ranking and suggestions most for a competition breeder (Settings \u2192 Breeder focus). Conformation shows are kept apart (Highest conformation score).</p>' +
      '</div></div></details>';
  }
  // Keep or sell: the level, how it was worked out, and (for a mare or a foal of a mare of yours) the foals as keepers
  function keeperPanelHtml(life) {
    var info = state.horseInfo[life], me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    if (!info || !me || String(info.ownerName || '').trim().toLowerCase() !== me) return '';
    var adv;
    try { adv = L.herdAdvice(state, [life])[life]; } catch (e) { return ''; }
    if (!adv) return '';
    var colours = { top: 'var(--success)', keep: 'var(--success)', middle: 'var(--text-muted)', consider: '#B9770E', sell: 'var(--danger)', forsale: 'var(--text-muted)', nodata: 'var(--text-muted)' };
    return '<details class="card profile-block" style="padding:12px 16px;margin-bottom:16px;"><summary style="cursor:pointer;display:flex;flex-wrap:wrap;align-items:center;gap:8px;"><strong>Keep or sell</strong> <span class="tag" style="color:' + (colours[adv.action] || 'inherit') + ';">' + (adv.protectedHorse ? '\u2605 ' : '') + L.esc(adv.label) + (adv.rank && adv.of ? ' \u00b7 ' + adv.rank + '/' + adv.of : '') + '</span></summary>' +
      '<div style="margin-top:10px;white-space:pre-wrap;font-size:12.5px;line-height:1.55;">' + adv.reasons.map(function (t) { return L.esc(t); }).join('\n') + '</div>' +
      '<p class="notes-line" style="margin:8px 0 0;">The same information is in the hover on the ranch page cards. It is worked out again from your ledger each time.</p></details>';
  }
  // For a horse that is listed for sale (or was): what you ask and how it changed; and when it was retired.
  function saleHistoryPanelHtml(life) {
    var meta = state.horseMeta[life];
    if (!meta) return '';
    var sum = L.askSummary(meta);
    var forSale = meta.status === 'For Sale', retired = meta.status === 'Retired', sold = meta.status === 'Sold' && (meta.soldTo || meta.soldAt);
    if (!sum && !retired && !sold) return '';
    var money = function (n) { return n ? L.esc(L.fmtMoney(n)) + ' HRC' : '\u2014'; };
    var html = '<div class="card profile-block" style="padding:12px 16px;margin-bottom:16px;' + (forSale ? 'border-color:var(--accent-2);' : '') + '"><strong>' + (retired ? 'Retired' : sold ? 'Sold' : forSale ? 'For sale' : 'Sale history') + '</strong>';
    if (retired) html += ' <span class="tag">retired' + (meta.retiredAt ? ' ' + L.esc(L.fmtDate(meta.retiredAt)) : '') + '</span>';
    if (sold) html += ' <span class="tag">sold' + (meta.soldTo ? ' to ' + L.esc(meta.soldTo) : '') + (meta.soldAt ? ' \u00b7 noticed ' + L.esc(L.fmtDate(meta.soldAt)) : '') + '</span>';
    if (forSale && sum) html += ' <span class="tag" style="color:var(--accent-strong);">asking ' + money(sum.last.buyout || sum.last.bid) + '</span>';
    if (sum) {
      html += '<p class="notes-line" style="margin:6px 0;">' + (meta.forSaleSince ? 'Listed since ' + L.esc(L.fmtDate(meta.forSaleSince)) + (sum.days != null ? ' (' + sum.days + ' day' + (sum.days === 1 ? '' : 's') + ')' : '') + '. ' : '') +
        sum.count + ' asking price' + (sum.count === 1 ? '' : 's') + ' recorded' + (sum.changes ? ', ' + sum.changes + ' change' + (sum.changes === 1 ? '' : 's') : '') + (sum.lowest && sum.highest && sum.lowest !== sum.highest ? '; lowest ' + money(sum.lowest) + ', highest ' + money(sum.highest) : '') + '.</p>' +
        '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Date</th><th class="num">Buyout</th><th class="num">Starting bid</th><th class="num">Change</th></tr></thead><tbody>' +
        meta.askLog.map(function (e, i) {
          var prev = i ? (meta.askLog[i - 1].buyout || meta.askLog[i - 1].bid) : 0, cur = e.buyout || e.bid, d = prev && cur ? cur - prev : null;
          return '<tr><td>' + L.esc(L.fmtDate(e.date)) + '</td><td class="num mono">' + money(e.buyout) + '</td><td class="num mono">' + money(e.bid) + '</td><td class="num mono"' + (d ? ' style="color:var(--' + (d < 0 ? 'danger' : 'success') + ');"' : '') + '>' + (d ? (d > 0 ? '+' : '-') + L.esc(L.fmtMoney(Math.abs(d))) : '\u2014') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return html + '<p class="notes-line" style="margin:6px 0 0;">' + (retired ? 'Marked Retired in the ledger. ' : '') + (sold ? 'Marked Sold in the ledger when its page showed a new owner' + (L.saleOf(state, life) ? '; the sale price is from your bank page.' : '; the sale price is filled in when your bank page is read.') + ' ' : '') + 'Prices are saved when you list a horse on the New sale form and when you open My Sales on Horse Reality.</p></div>';
  }
  // The genes read for a horse (from Horse Reality's test, or entered by hand), each as a chip: green with a star if you
  // prefer or keep it, red with a cross if you do not want it.
  function suspectedChipsHtml(life) {
    var sus = L.suspectedGenes(state, life), pk = L.peacockOf(state, life), out = '';
    L.MANUAL_LOCI.forEach(function (l) { if (sus[l.id]) out += '<span class="tag" style="margin:0;white-space:nowrap;font-style:italic;" title="Suspected, not confirmed">' + L.esc((l.label || l.name.replace(/ \(.*\)$/, ''))) + ' ' + L.esc(sus[l.id].join(' / ')) + '</span>'; });
    if (pk) out += '<span class="tag" style="margin:0;white-space:nowrap;" title="Peacock expressed' + (pk.strength != null ? ', line strength estimate ' + pk.strength + '%' : '') + '">Peacock' + (pk.strength != null ? ' ' + L.esc(pk.strength) + '%' : '') + '</span>';
    return out;
  }
  function geneticsPanelHtml(life) {
    var info = state.horseInfo[life];
    if (!info) return '';
    var geno = L.horseGenotype(state, life);
    var ids = Object.keys(geno);
    if (!ids.length) return preferredGeneTagHtml(life);
    var pm = L.preferenceMap(state, info.breed);
    var tested = L.parseColourGenes(info.testedColours);
    var chips = L.preferLoci().concat(L.ALL_LOCI.filter(function (l) { return l.id === 'E' || l.id === 'A'; })).filter(function (l) { return geno[l.id]; }).map(function (l) {
      var lvl = pm[l.id], carries = lvl && geno[l.id].indexOf(l.recessive ? l.alleles[1] : l.alleles[0]) > -1;
      var bad = carries && lvl === 'avoid', good = carries && !bad;
      var nm = l.label || l.name.replace(/ \(.*\)$/, '');
      return '<span class="tag" style="margin:0;white-space:nowrap;' + (good ? 'color:var(--accent-strong);border-color:var(--accent-strong);font-weight:600;' : bad ? 'color:var(--danger);border-color:var(--danger);font-weight:600;' : '') + '" title="' + L.esc(l.name + (tested[l.id] ? '' : ' (entered by hand)') + (good ? ' \u2014 a gene you ' + (lvl === 'keep' ? 'want to keep' : 'prefer') : bad ? " \u2014 a gene you don't want" : '')) + '">' + (good ? '\u2726 ' : bad ? '\u2716 ' : '') + L.esc(nm) + ' <span class="mono" style="font-size:11.5px;">' + L.esc(l.id === 'FL' ? L.genotypeText(l, geno[l.id]) : geno[l.id].join('/')) + '</span></span>';
    }).join('');
    var wanted = L.preferredGenesOf(state, life);
    var hasBad = wanted.some(function (g) { return g.level === 'avoid'; }), hasGood = wanted.some(function (g) { return g.level !== 'avoid'; });
    return '<div class="card profile-block" style="padding:12px 16px;margin-bottom:16px;' + (hasBad ? 'border-color:var(--danger);' : hasGood ? 'border-color:var(--accent-strong);' : '') + '"><div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;"><strong>Genetics</strong>' +
      (hasGood ? '<span class="tag" style="color:var(--accent-strong);border-color:var(--accent-strong);">\u2726 carries a preferred gene</span>' : '') + (hasBad ? '<span class="tag" style="color:var(--danger);border-color:var(--danger);">\u2716 carries an unwanted gene</span>' : '') + '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;">' + chips + suspectedChipsHtml(life) + '</div>' + (info.testedColours ? '<div class="mono sub" style="font-size:12px;margin-top:12px;line-height:1.5;">' + L.esc(info.testedColours) + '</div>' : '') +
      '<p class="notes-line" style="margin:12px 0 0;line-height:1.55;">Genes the ledger knows for this horse. Green star = a gene you prefer or keep, red cross = a gene you do not want (choose these under My notes \u2192 Preferred genetics). A gene that is not listed was not tested.</p></div>';
  }
  // A star tag for a horse that carries a gene you prefer.
  function preferredGeneTagHtml(life) {
    var g = L.preferredGenesOf(state, life);
    if (!g.length) return '';
    return '<div style="margin:0 0 6px;">' + g.map(function (x) {
      var bad = x.level === 'avoid';
      return '<span class="tag" style="margin-right:6px;color:var(--' + (bad ? 'danger' : 'accent-strong') + ');border-color:var(--' + (bad ? 'danger' : 'accent-strong') + ');" title="A gene you ' + (bad ? "don't want" : x.level === 'keep' ? 'want to keep' : 'prefer') + '">' + (bad ? '\u2716 ' : '\u2726 ') + L.esc(x.name) + '</span>';
    }).join('') + '</div>';
  }
  // Advice for the goal set(s) in use: one list, or (with separate goals) the mare and stallion lists together.
  function goalAdviceAll() {
    var vs = viewState();
    if (!state.settings.goalsSplit) return L.goalAdvice(vs);
    var m = L.goalAdvice(vs, 'mare'), s = L.goalAdvice(vs, 'stallion');
    m.tips.forEach(function (t) { t.who = 'Mares & fillies'; });
    s.tips.forEach(function (t) { t.who = 'Stallions & colts'; });
    return { tips: m.tips.concat(s.tips), review: m.review.length ? m.review : s.review, herdSize: m.herdSize + s.herdSize };
  }
  // The switch: one set of goals for everyone, or a set for mares & fillies and another for stallions & colts.
  function goalsSwitchHtml() {
    var split = !!state.settings.goalsSplit;
    var html = '<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center;">' +
      '<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" data-action="goals-split"' + (split ? ' checked' : '') + '> Separate goals for mares &amp; fillies and for stallions &amp; colts</label>';
    if (split) {
      html += '<span style="display:inline-flex;gap:4px;">' +
        '<button type="button" class="btn btn-sm' + (goalsEdit === 'mare' ? ' btn-primary' : '') + '" data-action="goals-edit" data-sex="mare">Mares &amp; fillies</button>' +
        '<button type="button" class="btn btn-sm' + (goalsEdit === 'stallion' ? ' btn-primary' : '') + '" data-action="goals-edit" data-sex="stallion">Stallions &amp; colts</button></span>';
    }
    return html + '</div>';
  }
  function goalsPanelHtml() {
    var splitOn = !!state.settings.goalsSplit;
    var g = L.goalsOf(state, splitOn ? goalsEdit : undefined);
    var any = L.anyGoals(state);
    var hits = 0;
    if (any) {
      var seen = {};
      L.ownedHorses(state).forEach(function (h) { seen[h.lifeNumber] = true; });
      L.trackedOtherHorses(state).forEach(function (h) { seen[h.lifeNumber] = true; });
      Object.keys(seen).forEach(function (life) { if (L.goalCheck(state, life).met) hits++; });
    }
    function field(label, key, step) {
      return '<div class="field"><label for="goal-' + key + '">' + label + '</label>' +
        '<input id="goal-' + key + '" type="number" min="0" step="' + step + '" data-action="update-goal" data-field="' + key + '" value="' + (g[key] != null ? L.esc(g[key]) : '') + '" placeholder="no limit"></div>';
    }
    function selectField(label, key, options) {
      return '<div class="field"><label for="goal-' + key + '">' + label + '</label><select id="goal-' + key + '" data-action="update-goal" data-field="' + key + '" style="width:100%;">' +
        options.map(function (o) { return '<option value="' + o[0] + '"' + (String(g[key] == null ? '' : g[key]) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>';
    }
    var adv = goalAdviceAll(), goalTipCount = adv.tips.length + adv.review.length;
    return '<details class="goals-panel"' + (goalsOpen ? ' open' : '') + '><summary>Highlight goals' +
      (any ? ' \u2014 ' + hits + ' horse' + (hits === 1 ? '' : 's') + ' meet all of them' : '') + (goalTipCount ? ' \u00b7 ' + goalTipCount + ' suggestion' + (goalTipCount === 1 ? '' : 's') : '') + '</summary>' +
      goalsSwitchHtml() + (splitOn ? '<p class="notes-line" style="margin:6px 0 0;"><strong>Editing the goals for ' + (goalsEdit === 'stallion' ? 'stallions &amp; colts' : 'mares &amp; fillies') + '.</strong></p>' : '') +
      '<p class="notes-line" style="margin:6px 0 0;">Each horse shows six boxes above its picture (Conformation, Genetic Potential, Breed Total, Conformation traits, Health, Fertility): green if it meets that goal, red if not, grey if there is no goal or no data yet. A horse that meets <strong>every</strong> goal you fill in is outlined. Leave a goal on \u201cno limit\u201d or empty to ignore it.</p>' +
      '<div class="goals-grid">' +
        field('Min top conformation', 'minConf', 'any') +
        field('Min Genetic Potential (GP)', 'minGP', 'any') +
        field('Min Breed Total (BT)', 'minBT', 'any') +
      '</div>' +
      '<p class="notes-line" style="margin:10px 0 0;"><strong>Conformation traits</strong> \u2014 the worst rating you will accept, and how many traits may be at that rating. Nothing may be rated worse.</p>' +
      '<div class="goals-grid">' +
        selectField('Worst trait rating accepted', 'traitWorst', [['', 'no limit'], ['GP', 'G+ (Good+)'], ['G', 'G (Good)'], ['A', 'A (Average)'], ['BA', 'BA (Below average)']]) +
        field('How many at that rating', 'traitWorstMax', '1') +
      '</div>' +
      '<p class="notes-line" style="margin:10px 0 0;"><strong>Health</strong> (the five vet-check traits) \u2014 the worst rating you will accept, and how many may be at it. Plus a minimum fertility.</p>' +
      '<div class="goals-grid">' +
        selectField('Worst health rating accepted', 'healthWorst', [['', 'no limit'], ['good', 'Good'], ['average', 'Average'], ['fair', 'Fair'], ['poor', 'Poor']]) +
        selectField('How many at that rating (of 5)', 'healthWorstMax', [['', 'none (0)'], ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']]) +
        selectField('Min fertility', 'minFert', [['', 'no limit'], ['poor', 'Poor'], ['fair', 'Fair'], ['average', 'Average'], ['good', 'Good'], ['excellent', 'Excellent']]) +
      '</div>' + goalAdviceHtml() + goalSetsHtml() + '</details>';
  }

  // ---------- health & fertility (read from the horse's Health box) ----------
  // A mare whose foals beat her own score: a star tag on cards and pages.
  function improverTagHtml(life) {
    var r = L.producerRecord(state, life);
    if (!r.improver) return '';
    return '<div style="margin:0 0 6px;"><span class="tag" style="color:var(--success);border-color:var(--success);" title="' + L.esc('Her ' + r.scored + ' scored foals average ' + r.avgFoal + ', ' + r.avgDelta + ' above her own ' + r.mareScore + '; ' + r.better + ' of ' + r.scored + ' beat her') + '">\u2605 Out-produces herself +' + r.avgDelta + '</span></div>';
  }
  // The mare's producer record and what to look for in a stallion.
  function producerPanelHtml(life) {
    var info = state.horseInfo[life];
    if (!info || info.sex !== 'mare') return '';
    var r = L.producerRecord(state, life, { full: true });
    if (!r.total && !r.failed && !r.needTraits.length) return '';
    var head = r.improver ? '\u2605 She out-produces herself' : (r.scored ? 'Her foals compared with her' : 'Producer record');
    var html = '<details class="card profile-block" style="padding:12px 16px;margin-bottom:16px;' + (r.improver ? 'border-color:var(--success);' : '') + '"' + (r.improver ? ' open' : '') + '><summary style="cursor:pointer;font-weight:600;">' + head +
      (r.scored && r.avgDelta != null ? ' \u2014 foals average ' + r.avgFoal + ' vs her ' + r.mareScore : '') + ' \u00b7 what to look for in a stallion</summary><div style="margin-top:8px;">';
    if (r.foals.length) {
      html += '<div style="overflow-x:auto;"><table class="an-table"><thead><tr><th>Foal</th><th>Sire</th><th class="num">Score</th><th class="num">vs her</th></tr></thead><tbody>' + r.foals.map(function (f) {
        return '<tr><td>' + (f.life ? '<button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(f.life) + '">' + L.esc(f.name) + '</button>' : L.esc(f.name)) + '</td><td>' + L.esc(f.sire || '\u2014') + '</td><td class="num mono">' + f.score + '</td>' +
          '<td class="num mono"' + (f.delta != null ? ' style="color:var(--' + (f.delta >= 0 ? 'success' : 'danger') + ');"' : '') + '>' + (f.delta != null ? (f.delta >= 0 ? '+' : '') + f.delta : '\u2014') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    }
    html += '<div style="margin-top:10px;"><strong style="font-size:13px;">What to look for in a stallion</strong>' + r.advice.map(function (t) { return '<div class="an-tip tip" style="margin-top:4px;">' + L.esc(t) + '</div>'; }).join('') + '</div>';
    if (r.candidates.length) {
      html += '<div style="margin-top:10px;"><strong style="font-size:13px;">Stallions in the ledger that fit</strong>' + r.candidates.map(function (c) {
        return '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;border-top:1px solid var(--border);padding:5px 0;font-size:13.5px;"><span><button type="button" class="link-btn" data-action="open-passport" data-life="' + L.esc(c.life) + '">' + L.esc(c.name) + '</button>' + (c.yours ? ' <span class="tag">yours</span>' : '') +
          (c.covers.length ? ' <span class="sub">good in ' + L.esc(c.covers.join(', ')) + '</span>' : '') + '</span><button type="button" class="btn btn-sm" data-action="calc-open" data-mare="' + L.esc(life) + '" data-stallion="' + L.esc(c.life) + '">Foal Calculator</button></div>';
      }).join('') + '</div>';
    }
    return html + '</div></details>';
  }
  // Shows read from conformation-show results pages: the latest few, and progress to the Star predicate
  // (three 1st premiums, a score of 80 or more; wiki: Predicates).
  function showLogPanelHtml(life) {
    var meta = state.horseMeta[life];
    var log = meta && Array.isArray(meta.showLog) ? meta.showLog : [];
    if (!log.length) return '';
    var firsts = log.filter(function (e) { return e.score >= 80; }).length;
    var recent = log.slice().sort(function (a, b) { return b.seenAt - a.seenAt; }).slice(0, 6);
    var ord = function (n) { return n ? (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th') : ''; };
    return '<details class="card profile-block" style="padding:12px 16px;margin-bottom:16px;"><summary style="cursor:pointer;font-weight:600;">Show results saved from results pages (' + log.length + ') \u2014 Star: ' + Math.min(firsts, 3) + ' of 3 first premiums</summary>' +
      '<div style="margin-top:8px;">' + recent.map(function (e) {
        return '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;border-top:1px solid var(--border);padding:5px 0;font-size:13.5px;"><span>' + L.esc(e.name || 'Show') + (e.category ? ' <span class="sub">(' + L.esc(e.category) + ')</span>' : '') + '</span>' +
          '<span class="mono">' + (e.rank ? ord(e.rank) + ' \u00b7 ' : '') + L.esc(e.score) + (e.premium ? ' \u00b7 ' + ord(e.premium) + ' premium' : '') + '</span></div>';
      }).join('') + '</div><p class="notes-line" style="margin:8px 0 0;">Read when you open a show\'s results page. The Star predicate needs three scores of 80 or more; only shows you have opened are counted here.</p></details>';
  }
  // Which disciplines the horse's conformation suits (wiki: Competitions lists the traits each discipline uses).
  function disciplinePanelHtml(life) {
    var info = state.horseInfo[life];
    var fit = L.disciplineFit(info);
    if (!fit) return '';
    var young = L.isYoungInfo(info);
    return '<details class="card profile-block" style="padding:12px 16px;margin-bottom:16px;"><summary style="cursor:pointer;font-weight:600;">Best disciplines from conformation \u2014 ' + L.esc(fit[0].name) + (fit[1] ? ', ' + L.esc(fit[1].name) : '') + '</summary>' +
      '<div style="margin-top:8px;">' + fit.map(function (d) {
        return '<div style="display:grid;grid-template-columns:130px 1fr 52px;gap:10px;align-items:center;padding:3px 0;font-size:13.5px;" title="Traits used: ' + L.esc(d.traits.join(', ')) + (d.known < d.total ? ' (' + d.known + ' of ' + d.total + ' known)' : '') + '"><span>' + L.esc(d.name) + '</span>' +
          '<span style="background:var(--surface-2);border-radius:6px;height:10px;overflow:hidden;"><span style="display:block;height:100%;width:' + Math.max(4, Math.min(100, d.fit)) + '%;background:var(--accent);"></span></span><span class="mono">' + d.fit + '</span></div>';
      }).join('') + '</div><p class="notes-line" style="margin:8px 0 0;">Each score is the average of the middle of the hidden number range behind the horse\'s ratings for the traits that discipline uses. The game also counts genetic potential stats, training, fitness, grooming and tack, which the ledger can\'t see, so treat this as a guide to conformation only.' + (young ? ' Horses can enter competitions from age 3.' : '') + '</p></details>';
  }
  function healthPanelHtml(life) {
    var info = (state.horseInfo && state.horseInfo[life]) || {};
    if (!info.health && !info.fertility) {
      return '<div class="card" style="padding:12px 16px;margin-bottom:16px;width:100%;flex:1 1 100%;box-sizing:border-box;"><strong>Health &amp; Fertility</strong> <span class="notes-line" style="margin:0;">\u2014 not recorded yet. Open this horse on Horse Reality once it has had a vet health check (and a fertility test if it\'s an adult).</span></div>';
    }
    function ratingClass(v) {
      var r = String(v || '').toLowerCase();
      if (r === 'excellent') return 'gold';
      if (r === 'good') return 'ok';
      if (r === 'poor' || r === 'fair') return 'bad';
      return 'na';
    }
    var cells = '';
    var order = ['Colic resistance', 'Hoof quality', 'Back problems', 'Respiratory disease', 'Resistance to lameness'];
    var h = info.health || {};
    order.concat(Object.keys(h).filter(function (k) { return order.indexOf(k) === -1; })).forEach(function (k) {
      if (!h[k]) return;
      cells += '<div class="goal-sec ' + ratingClass(h[k]) + '" title="' + L.esc(L.labelRangeText('health', h[k])) + '"><span class="gl">' + L.esc(k) + '</span>' + L.esc(h[k]) + '</div>';
    });
    var youngHorse = L.isYoungInfo(info);
    cells += '<div class="goal-sec ' + (youngHorse ? 'na' : ratingClass(info.fertility)) + '"><span class="gl">Fertility</span>' + L.esc(youngHorse ? 'tested from age 3' : (info.fertility || 'not tested')) + '</div>';
    return '<div class="card" style="padding:12px 16px;margin-bottom:16px;width:100%;flex:1 1 100%;box-sizing:border-box;"><strong>Health &amp; Fertility</strong>' +
      '<div class="goal-strip" style="margin:8px 0 0;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));">' + cells + '</div>' + clinicalHtml(info) + '</div>';
  }
  function clinicalHtml(info) {
    var c = L.clinicalOutlook(info);
    if (!c) return '';
    var months = L.effectiveAgeMonths(info);
    var when = months != null && months < 84 ? ' He can have the clinical check from age 7.' : '';
    return '<p class="notes-line" style="margin:8px 0 0;"><strong>Clinical Approved:</strong> ' + L.esc(c.text) + L.esc(when) + '</p>';
  }

  // ---------- sale (read from the bank page, or entered by hand) ----------
  function saleLineText(life) {
    var sa = L.saleOf(state, life);
    if (!sa) return '';
    return L.fmtMoney(sa.price) + ' ' + sa.currency + (sa.date ? ' \u00b7 ' + L.fmtDate(sa.date) : '') + (sa.buyer ? ' \u00b7 to ' + sa.buyer : '');
  }
  function saleTagsHtml(life) {
    var sa = L.saleOf(state, life);
    if (!sa) return '';
    var out = '<span class="tag mono" title="' + L.esc(saleLineText(life)) + '">Sold for ' + L.esc(L.fmtMoney(sa.price) + ' ' + sa.currency) + (sa.date ? ' \u00b7 ' + L.esc(L.fmtDate(sa.date)) : '') + '</span>';
    var pr = L.profitOf(state, life);
    if (pr) {
      out += '<span class="tag mono" style="color:var(--' + (pr.profit >= 0 ? 'success' : 'danger') + ');" title="Sold for minus what you paid, including shipping (' + L.esc(L.fmtMoney(pr.cost) + ' ' + pr.currency) + ')">' + (pr.profit >= 0 ? 'Profit +' : 'Loss ') + L.esc(L.fmtMoney(Math.abs(pr.profit)) + ' ' + pr.currency) + '</span>';
    }
    return out;
  }
  function setHorseSale(life, field, value) {
    if (!life || !field) return;
    var meta = state.horseMeta[life] = Object.assign({}, state.horseMeta[life]);
    meta.sale = Object.assign({}, meta.sale);
    if (field === 'price') {
      var n = parseFloat(value);
      if (isFinite(n) && n > 0) meta.sale.price = n; else delete meta.sale.price;
    } else {
      meta.sale[field] = value;
    }
    persist();
    // entering a sale price means the horse has been sold
    if (field === 'price' && meta.sale.price && meta.status !== 'Sold') setLifeStatus(life, 'Sold');
  }
  function saleDetailsHtml(life) {
    if (!life) return '';
    var meta = (state.horseMeta[life] && state.horseMeta[life].sale) || {};
    var id = 'sale-' + L.esc(life);
    var line = saleLineText(life);
    return '<details class="profile-block" style="margin:0 0 16px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Sale \u2014 ' + (line ? L.esc(line) : 'not sold / not recorded') + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">' +
        '<div class="field"><label for="' + id + '-price">Sold for</label><div style="display:flex;gap:8px;"><input id="' + id + '-price" type="number" min="0" step="any" data-action="horse-sale" data-life="' + L.esc(life) + '" data-field="price" value="' + (meta.price ? L.esc(meta.price) : '') + '" placeholder="0" style="flex:1;min-width:0;">' +
          '<select data-action="horse-sale" data-life="' + L.esc(life) + '" data-field="currency" aria-label="Sale currency">' + L.CURRENCIES.map(function (c) { return '<option' + (c === (meta.currency || 'HRC') ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></div></div>' +
        '<div class="field"><label for="' + id + '-date">Date sold</label><input id="' + id + '-date" type="date" data-action="horse-sale" data-life="' + L.esc(life) + '" data-field="date" value="' + L.esc(meta.date || '') + '"></div>' +
        '<div class="field"><label for="' + id + '-buyer">Sold to</label><input id="' + id + '-buyer" type="text" data-action="horse-sale" data-life="' + L.esc(life) + '" data-field="buyer" value="' + L.esc(meta.buyer || '') + '" placeholder="buyer\'s username"></div>' +
        '<p class="notes-line" style="margin:0;grid-column:1/-1;">Sales are picked up automatically from your bank page. You can also enter or correct one here; entering a price marks the horse Sold.</p>' +
      '</div></details>';
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
  // The highest conformation score by hand: the stats page only lists recent shows, so a horse with many shows (often one
  // you bought) can have a higher score than the ledger has read. It counts in rankings, Breed Total and suggestions.
  function setHorseBest(lifeNumber, field, value) {
    if (!lifeNumber) return;
    var meta = state.horseMeta[lifeNumber] = Object.assign({}, state.horseMeta[lifeNumber]);
    if (field === 'confBest') {
      var n = parseFloat(String(value).replace(',', '.'));
      if (isFinite(n) && n > 0 && n <= 100) { meta.confBest = n; meta.confBestAt = Date.now(); if (!meta.confBestEvent || meta.confBestEvent === 'entered by hand') meta.confBestEvent = 'entered by hand'; }
      else { delete meta.confBest; delete meta.confBestAt; delete meta.confBestDate; delete meta.confBestEvent; }
    } else if (field === 'confLow') {
      var lw = parseFloat(String(value).replace(',', '.'));
      if (isFinite(lw) && lw > 0 && lw <= 100) { meta.confLow = lw; meta.confLowAt = Date.now(); meta.confLowSource = 'entered by hand'; if (!meta.confLowEvent) meta.confLowEvent = 'entered by hand'; }
      else { delete meta.confLow; delete meta.confLowAt; delete meta.confLowSource; delete meta.confLowDate; delete meta.confLowEvent; }
    } else if (field === 'confLowDate') { meta.confLowDate = String(value || '').trim(); }
    else if (field === 'confLowEvent') { meta.confLowEvent = String(value || '').trim().slice(0, 90); }
    else if (field === 'confBestDate') { meta.confBestDate = String(value || '').trim(); }
    else if (field === 'confBestEvent') { meta.confBestEvent = String(value || '').trim().slice(0, 90); }
    persist();
  }
  function scoreDetailsHtml(lifeNumber) {
    if (!lifeNumber || !state.horseInfo[lifeNumber]) return '';
    var meta = state.horseMeta[lifeNumber] || {}, b = L.bestConformation(meta), life = L.esc(lifeNumber);
    var shows = Array.isArray(meta.showLog) ? meta.showLog.length : 0;
    return '<details class="profile-block" style="margin:0 0 16px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Highest conformation score \u2014 ' + (b.best ? L.esc(Math.round(b.best * 1000) / 1000) : 'not recorded') + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));">' +
        '<div class="field"><label for="hb-score-' + life + '">Highest score</label><input id="hb-score-' + life + '" type="number" min="0" max="100" step="any" data-action="horse-best" data-life="' + life + '" data-field="confBest" value="' + (meta.confBest ? L.esc(meta.confBest) : '') + '" placeholder="e.g. 87.425"></div>' +
        '<div class="field"><label for="hb-low-' + life + '">Lowest score (range ' + (meta.confLow && b.best ? L.esc(Math.round((b.best - meta.confLow) * 1000) / 1000) : '—') + ')</label><input id="hb-low-' + life + '" type="number" min="0" max="100" step="any" data-action="horse-best" data-life="' + life + '" data-field="confLow" value="' + (meta.confLow ? L.esc(meta.confLow) : '') + '" placeholder="e.g. 80.1"></div>' +
        '<div class="field"><label for="hb-lowdate-' + life + '">Lowest: date earned (optional)</label><input id="hb-lowdate-' + life + '" type="date" data-action="horse-best" data-life="' + life + '" data-field="confLowDate" value="' + L.esc(meta.confLowDate || '') + '"></div>' +
        '<div class="field"><label for="hb-lowevent-' + life + '">Lowest: show (optional)</label><input id="hb-lowevent-' + life + '" type="text" data-action="horse-best" data-life="' + life + '" data-field="confLowEvent" value="' + L.esc(meta.confLowEvent || '') + '" placeholder="e.g. Show name"></div>' +
        '<div class="field"><label for="hb-date-' + life + '">Date earned (optional)</label><input id="hb-date-' + life + '" type="date" data-action="horse-best" data-life="' + life + '" data-field="confBestDate" value="' + L.esc(meta.confBestDate || '') + '"></div>' +
        '<div class="field"><label for="hb-event-' + life + '">Show (optional)</label><input id="hb-event-' + life + '" type="text" data-action="horse-best" data-life="' + life + '" data-field="confBestEvent" value="' + L.esc(meta.confBestEvent || '') + '" placeholder="e.g. Dressage, Oct 2026"></div>' +
        '<p class="notes-line" style="margin:0;grid-column:1/-1;">Horse Reality\'s stats page only lists recent shows, so a horse with many shows (often one you bought) can have a higher best score than the ledger has read. Enter it here and it is used for Breed Total, rankings and suggestions. A higher score read later from a page replaces it; clear the box to remove it. The lowest score only ever goes down, and one read automatically that is more than ' + L.MAX_SCORE_RANGE + ' points under the highest is ignored (a wrongly entered show would otherwise stretch the range); one you enter by hand is always kept.' + (shows ? ' ' + shows + ' show result' + (shows === 1 ? '' : 's') + ' saved from results pages.' : '') + '</p>' +
      '</div></details>';
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
    return '<details class="profile-block" style="margin:0 0 16px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Purchase price &amp; shipping — ' +
      (parts ? L.esc([parts.paid ? 'paid ' + parts.paid : '', parts.ship ? parts.ship + ' shipping' : ''].filter(Boolean).join(' + ')) : 'not recorded') + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));">' +
        money('Price paid', 'price', 'currency', meta.currency) +
        money('Shipping fee', 'shipping', 'shippingCurrency', meta.shippingCurrency) +
        '<p class="notes-line" style="margin:0;grid-column:1/-1;">Leave both empty for a horse you bred or weren\'t charged for.</p>' +
      '</div></details>';
  }

  // Short text of the hand-entered genes saved on a horse, e.g. "Sooty STY / n".
  function savedGenesText(lifeNumber) {
    var manual = L.manualGenes(state, lifeNumber);
    var sus = L.suspectedGenes(state, lifeNumber), pk = L.peacockOf(state, lifeNumber);
    return L.MANUAL_LOCI.filter(function (l) { return manual[l.id] || sus[l.id]; }).map(function (l) {
      return l.name.replace(/ \(.*\)$/, '') + ' ' + (manual[l.id] ? L.genotypeText(l, manual[l.id]) : sus[l.id].join(' / ') + ' (suspected)');
    }).concat(pk ? ['Peacock' + (pk.strength != null ? ' ' + pk.strength + '%' : '')] : []).join(', ');
  }
  // The same editor the calculator uses, tucked under a horse's own page so
  // genes are set once on the horse and reused for every pairing.
  function geneDetailsHtml(lifeNumber) {
    if (!lifeNumber || !state.horseInfo[lifeNumber]) return '';
    var saved = savedGenesText(lifeNumber);
    return '<details class="profile-block" style="margin:0 0 16px;"' + '><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Extra genes (Sooty, Silver, Flaxen, W20, hidden Agouti…) — ' +
      (saved ? L.esc(saved) : 'none entered yet') + '</summary>' +
      '<div class="card" style="padding:14px;margin-top:8px;display:grid;gap:12px;">' +
      geneEditorHtml(lifeNumber, 'Saved on this horse') + peacockEditorHtml(lifeNumber) +
      '<p class="notes-line" style="margin:0;">Saved once here and used automatically by the Foal Calculator whenever this horse is a parent.</p>' +
      '</div></details>';
  }

  function colourSectionHtml(studLife, mareLife) {
    var studInfo = state.horseInfo[studLife], mareInfo = state.horseInfo[mareLife];
    var c = L.colourOutcomes(studInfo.testedColours, mareInfo.testedColours, L.manualGenes(state, studLife), L.manualGenes(state, mareLife));
    var html = '<div class="section-head"><h2>Colour possibilities</h2></div>';
    html += '<details style="margin-bottom:14px;"' + (c.genes.length ? '' : ' open') + '><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Enter extra genes by hand (W20, hidden Agouti A+/At, Sooty, Silver, Flaxen, Champagne, Roan, Tobiano, Sabino)</summary>' +
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
    // genes a foal can carry without showing: visible vs carrier vs not present
    var carried = c.genes.filter(function (g) { return g.vis && g.vis.carrier > 0.05; });
    if (carried.length) {
      html += oddsCardHtml('Carried or visible \u2014 genes that can hide', carried.map(function (g) {
        var parts = [];
        if (g.vis.visible > 0.05) parts.push('visible ' + pctText(g.vis.visible));
        parts.push('carrier ' + pctText(g.vis.carrier));
        if (g.vis.none > 0.05) parts.push('not present ' + pctText(g.vis.none));
        return oddsRowHtml(g.name, g.vis.visible, parts.join(' \u00b7 '));
      }).join(''));
      html += '<p class="notes-line" style="margin:-6px 0 12px;">The bar is the chance the foal <strong>shows</strong> the gene. A carrier has one hidden copy (or a copy that cannot show on its base colour) and can pass it on.</p>';
    }
    if (c.extras.length) {
      html += oddsCardHtml('Extra genes — chance the foal shows each', c.extras.map(function (g) {
        var split = g.outcomes.map(function (o) { return (o.label || o.genotype) + ' ' + pctText(o.pct); }).join(' · ');
        return oddsRowHtml(g.label, g.pct, split + (g.note ? ' — ' + g.note : ''));
      }).join(''));
    }
    html += '<details style="margin-bottom:12px;"><summary style="cursor:pointer;color:var(--text-muted);font-size:13px;">Gene-by-gene odds</summary>';
    c.genes.forEach(function (g) {
      html += oddsCardHtml(g.name, g.outcomes.map(function (o) { return oddsRowHtml(o.label || o.genotype, o.pct, o.effect); }).join(''));
    });
    html += '</details>';
    if (c.unread && c.unread.length) {
      html += '<p class="notes-line" style="color:var(--danger);">Could not read these from the tested colours: <span class="mono">' + L.esc(c.unread.join(' ')) + '</span>. Tell the developer how Horse Reality writes them.</p>';
    }
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
    if (info.lifeNumber && lifeStatus(info.lifeNumber) === 'For Sale') tags.push('<span class="tag" style="background:#f1e6c9;border-color:#a9822f;color:#6b4f00;font-weight:600;">$ For sale</span>');
    var breedNow = info.lifeNumber ? L.mareBreedStatus(state, info.lifeNumber) : { status: '' };
    if (breedNow.status === 'pregnant') tags.push('<span class="tag" style="background:#f6dbe9;border-color:#b0407a;color:#8a2a5c;font-weight:600;">\u2665 In foal' + (breedNow.due ? ' \u00b7 ' + L.esc(breedNow.due.replace(/^Due /, 'due ')) : '') + '</span>');
    else if (breedNow.status === 'covered') tags.push('<span class="tag" style="background:#f1e6c9;border-color:#a9822f;color:#6b4f00;font-weight:600;">\u2714 Covered' + (breedNow.date ? ' \u00b7 ' + L.esc(L.fmtDate(breedNow.date)) : '') + '</span>');
    var saleTags = info.lifeNumber ? saleTagsHtml(info.lifeNumber) : '';
    if (saleTags) tags.push(saleTags);
    var scoreTags = info.lifeNumber ? highScoreTagsHtml(info.lifeNumber) : '';
    if (scoreTags) tags.push(scoreTags);
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
      html += goalStripHtml(s.lifeNumber);
      html += '<div class="detail-head profile-goal' + goalClass(s.lifeNumber) + '"><div class="name-row">' +
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
            ['Active', 'For Sale', 'Sold', 'Retired'].map(function (opt) { return '<option' + (opt === (s.status || 'Active') ? ' selected' : '') + '>' + opt + '</option>'; }).join('') +
          '</select>' +
          '<button class="btn btn-sm" data-action="edit-stallion">Edit</button>' +
          '<button class="btn btn-sm btn-danger" data-action="delete-stallion" data-id="' + s.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }

    html += geneDetailsHtml(s.lifeNumber);
    html += keeperPanelHtml(s.lifeNumber) + saleHistoryPanelHtml(s.lifeNumber) + geneticsPanelHtml(s.lifeNumber) + healthPanelHtml(s.lifeNumber) + disciplinePanelHtml(s.lifeNumber) + showLogPanelHtml(s.lifeNumber);
    html += purchaseDetailsHtml(s.lifeNumber) + scoreDetailsHtml(s.lifeNumber) + compPanelHtml(s.lifeNumber) + tagsPanelHtml(s.lifeNumber);
    html += saleDetailsHtml(s.lifeNumber);
    html += studFeesPanelHtml(s);
    html += removeHorsePanelHtml(s.lifeNumber, s.name);

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
      html += '<div class="ledger-head"><div>Date bred</div><div>Date born</div><div>Mare</div><div>Owner</div><div>Price</div><div>Status</div><div></div></div>';
      html += '<div class="card">';
      rowSiblings = breedings;
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

      if (action === 'copy-ad') {
        var adTxt = L.adText(state, t.getAttribute('data-life'));
        var done = function () { var old = t.textContent; t.textContent = 'Copied \u2713'; setTimeout(function () { t.textContent = old; }, 1600); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(adTxt).then(done, function () { window.prompt('Copy this ad:', adTxt); });
        else window.prompt('Copy this ad:', adTxt);
      }
      else if (action === 'csv-export') { csvDownload('hr-ledger-' + t.getAttribute('data-kind'), csvRows(t.getAttribute('data-kind'))); }
      else if (action === 'goal-apply') {
        var gaKey = t.getAttribute('data-set') || 'goals';
        var ga = Object.assign({}, state.settings[gaKey] || state.settings.goals);
        ga[t.getAttribute('data-field')] = t.getAttribute('data-value');
        state.settings[gaKey] = ga;
        state.settings.goalsUpdatedAt = Date.now();
        goalsOpen = true;
        persist();
      }
      else if (action === 'buy-apply') {
        var bk2 = buyStoreKey();
        var allB2 = Object.assign({}, state.settings.buyCriteria);
        var ownB2 = Object.assign({}, allB2[bk2]);
        if (t.getAttribute('data-traits')) ownB2.needTraits = t.getAttribute('data-traits').split(',');
        else ownB2[t.getAttribute('data-field')] = t.getAttribute('data-value');
        allB2[bk2] = ownB2;
        state.settings.buyCriteria = allB2;
        buyOpen = true;
        persist();
      }
      else if (action === 'goals-edit') { goalsEdit = t.getAttribute('data-sex') === 'stallion' ? 'stallion' : 'mare'; goalsOpen = true; render(); }
      else if (action === 'trash-restore') {
        if (L.restoreTrash(state, t.getAttribute('data-id'))) persist();
      }
      else if (action === 'goalset-save') {
        var gsn = (document.getElementById('goalset-name').value || '').trim();
        if (!gsn) { document.getElementById('goalset-name').focus(); return; }
        var gs = Object.assign({}, state.settings.goalSets);
        gs[gsn] = { __bundle: true, split: !!state.settings.goalsSplit, goals: Object.assign({}, state.settings.goals), goalsMare: Object.assign({}, state.settings.goalsMare), goalsStallion: Object.assign({}, state.settings.goalsStallion) };
        state.settings.goalSets = gs;
        goalsOpen = true;
        persist();
      }
      else if (action === 'goalset-delete') {
        var gdn = document.getElementById('goalset-del').value;
        if (!gdn) return;
        askConfirm('Delete the goal set "' + gdn + '"? Your current goals stay as they are.', function () {
          var gs2 = Object.assign({}, state.settings.goalSets);
          delete gs2[gdn];
          state.settings.goalSets = gs2;
          goalsOpen = true;
          persist();
        });
      }
      else if (action === 'calc-open') {
        var om = t.getAttribute('data-mare'), os = t.getAttribute('data-stallion');
        if (om) calcMare = om;
        if (os) calcStallion = os;
        activeTab = 'calc'; selectedId = null; selectedMareKey = null; selectedPassportLife = null; suggestLife = null;
        saveUi(); render(); window.scrollTo(0, 0);
      }
      else if (action === 'plan-add') {
        var pl = (state.settings.plan || []).slice();
        pl.push({ mare: calcMare, stallion: calcStallion, done: false, addedAt: Date.now() });
        state.settings.plan = pl;
        persist();
      }
      else if (action === 'plan-remove') {
        var pr = (state.settings.plan || []).slice();
        pr.splice(parseInt(t.getAttribute('data-i'), 10), 1);
        state.settings.plan = pr;
        persist();
      }
      else if (action === 'backup-snooze') {
        state.settings.backupSnoozeUntil = Date.now() + 7 * 86400000;
        persist();
      }
      else if (action === 'mark-sale') {
        var msl = t.getAttribute('data-life');
        state.horseMeta[msl] = Object.assign({}, state.horseMeta[msl], { status: 'For Sale' });
        persist();
      }
      else if (action === 'calc-pick-mare') { calcMare = t.getAttribute('data-life'); saveUi(); render(); }
      else if (action === 'calc-pick-stallion') { calcStallion = t.getAttribute('data-life'); saveUi(); render(); }
      else if (action === 'calc-refresh') {
        HRStorage.getState(function (fresh) {
          state = fresh;
          if (!state.breedings) state.breedings = {};
          if (!state.horseInfo) state.horseInfo = {};
          if (!state.horseMeta) state.horseMeta = {};
          if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
          HRStorage.applyImages(state);
          recompute();
          render();
        });
      }
      else if (action === 'herd-sub') { activeTab = 'herd'; herdSub = t.getAttribute('data-sub') === 'retired' ? 'retired' : ''; listFilterText = ''; selectedMareKey = null; selectedId = null; selectedPassportLife = null; suggestLife = null; saveUi(); render(); }
      else if (action === 'show-tab') {
        activeTab = t.getAttribute('data-tab');
        if (activeTab === 'retired') { activeTab = 'herd'; herdSub = 'retired'; } else if (activeTab === 'herd') herdSub = '';
        listFilterText = '';
        saveUi();
        selectedMareKey = null; selectedId = null; selectedPassportLife = null; suggestLife = null;
        render();
      }
      else if (action === 'calc-clear-mare') { calcMare = ''; saveUi(); render(); }
      else if (action === 'calc-clear-stallion') { calcStallion = ''; saveUi(); render(); }
      else if (action === 'partner-remove') { if (L.removePartner(state, t.getAttribute('data-name'))) { notesOpen = true; persist(); } }
      else if (action === 'tag-remove') { if (L.removeTagFrom(state, t.getAttribute('data-life'), t.getAttribute('data-tag'))) persist(); }
      else if (action === 'filter-tag') {
        listFilterText = '#' + t.getAttribute('data-tag');
        var lf = document.getElementById('list-filter');
        if (lf) { lf.value = listFilterText; applyListFilter(); } else { render(); }
      }
      else if (action === 'bulk-toggle') { bulkMode = !bulkMode; if (!bulkMode) bulkSel = {}; render(); }
      else if (action === 'bulk-all') {
        document.querySelectorAll('.herd-row').forEach(function (row) {
          if (row.style.display === 'none') return;
          var cb = row.querySelector('input[data-action="bulk-pick"]');
          if (cb) { cb.checked = true; bulkSel[cb.getAttribute('data-life')] = true; }
        });
        var bc = document.getElementById('bulk-count'); if (bc) bc.textContent = Object.keys(bulkSel).filter(function (k) { return bulkSel[k]; }).length + ' selected';
      }
      else if (action === 'bulk-none') { bulkSel = {}; render(); }
      else if (action === 'bulk-add') { bulkApply(true); }
      else if (action === 'bulk-remove') { bulkApply(false); }
      else if (action === 'toggle-add-stallion') { addingStallion = !addingStallion; render(); }
      else if (action === 'cancel-stallion-form') { addingStallion = false; editingStallion = false; render(); }
      else if (action === 'edit-stallion') { editingStallion = true; render(); }
      else if (action === 'mark-stallion-owned') { updateStallionRec(t.getAttribute('data-id'), { owned: true }); }
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
      else if (action === 'open-suggestions') { suggestLife = t.getAttribute('data-life'); render(); window.scrollTo(0, 0); }
      else if (action === 'close-suggestions') { suggestLife = null; render(); }
      else if (action === 'close-passport') { selectedPassportLife = null; render(); }
      else if (action === 'clear-search') { horseSearchQuery = ''; render(); }
      else if (action === 'an-sort') {
        var anTable = t.getAttribute('data-table'), anKey = t.getAttribute('data-key');
        if (anSort[anTable] && anSort[anTable].key === anKey) anSort[anTable].dir = -anSort[anTable].dir;
        else anSort[anTable] = { key: anKey, dir: AN_TEXT_KEYS[anKey] ? 1 : -1 };
        render();
      }
      else if (action === 'remove-breed-others') {
        var rbKey = t.getAttribute('data-breed'), rbName = t.getAttribute('data-name'), rbMe = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
        var rbLives = Object.keys(state.horseInfo || {}).filter(function (l) {
          var i = state.horseInfo[l];
          return (L.breedKeyOf(i.breed) || '(none)') === rbKey && !(rbMe && String(i.ownerName || '').trim().toLowerCase() === rbMe);
        });
        if (!rbLives.length) return;
        askConfirm('Remove the ' + rbLives.length + ' saved ' + rbName + ' horse' + (rbLives.length === 1 ? '' : 's') + ' that belong to other players from your ledger? Your own horses are not touched. They stay in Recently deleted for 30 days and the ledger will not save them again.', function () {
          rbLives.forEach(function (l) { L.removeHorse(state, l, (state.horseInfo[l] && state.horseInfo[l].name) || ('#' + l)); });
          selectedId = null; selectedMareKey = null; selectedPassportLife = null; suggestLife = null;
          persist();
        });
      }
      else if (action === 'remove-horse') {
        var rmLife = t.getAttribute('data-life'), rmName = t.getAttribute('data-name') || ('#' + rmLife);
        var cnt = L.horseRemovalCounts(state, rmLife);
        var parts = [];
        if (cnt.stallion) parts.push('his stallion record with ' + cnt.breedingsUnder + ' breeding record' + (cnt.breedingsUnder === 1 ? '' : 's') + ' under him');
        if (cnt.breedingsAsMare) parts.push(cnt.breedingsAsMare + ' breeding record' + (cnt.breedingsAsMare === 1 ? '' : 's') + ' where she is the mare');
        if (cnt.foalRows) parts.push(cnt.foalRows + ' foal row' + (cnt.foalRows === 1 ? '' : 's') + ' for this horse');
        askConfirm('Remove ' + rmName + ' (#' + rmLife + ') from your ledger? This deletes its saved page data and tags' + (parts.length ? ', ' + parts.join(', ') : '') + '. The ledger will not save it again unless you allow it under Other Horses \u2192 Removed horses. Export a backup first if you are not sure \u2014 this cannot be undone.', function () {
          L.removeHorse(state, rmLife, rmName);
          selectedId = null; selectedMareKey = null; selectedPassportLife = null; suggestLife = null;
          persist();
        });
      }
      else if (action === 'allow-horse') {
        var allowLife = t.getAttribute('data-life');
        var ign = Object.assign({}, state.settings.ignored);
        delete ign[allowLife];
        state.settings.ignored = ign;
        persist();
      }
      else if (action === 'restore-horse') { setLifeStatus(t.getAttribute('data-life'), 'Active'); }
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
      else if (action === 'partner-add') {
        var pr = L.addPartner(state, fd.get('partner'));
        if (pr === 'invalid') { alert('Type a Horse Reality user name.'); return; }
        notesOpen = true;
        if (pr === 'added') persist(); else render();
      }
      else if (action === 'tag-add') {
        var tl = t.getAttribute('data-life'), tr = L.addTagTo(state, tl, fd.get('tag'));
        if (tr === 'invalid') { alert('A tag is 2 to 24 letters, numbers or hyphens.'); return; }
        if (tr === 'added') persist(); else render();
      }
      else if (action === 'set-aged-up') {
        setAgedUpMonths(t.getAttribute('data-life'), fd.get('months'));
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

    // <details> toggle events don't bubble, so listen in the capture phase. wireEvents() runs on every redraw, so these
    // are added only once (adding them each time piled up thousands of listeners and leaked memory).
    if (!app.getAttribute('data-wired')) {
      app.setAttribute('data-wired', '1');
      app.addEventListener('input', function (e) {
        if (e.target && e.target.id === 'list-filter') {
          listFilterText = e.target.value;
          applyListFilter();
        }
      });
      app.addEventListener('toggle', function (e) {
        if (e.target && e.target.classList && e.target.classList.contains('an-sec')) { anOpen[e.target.getAttribute('data-sec')] = e.target.open; saveUi(); }
        if (e.target && e.target.classList && e.target.classList.contains('calc-sugg')) calcSuggOpen[e.target.getAttribute('data-life')] = e.target.open;
        if (e.target && e.target.classList && e.target.classList.contains('goals-panel')) goalsOpen = e.target.open;
        if (e.target && e.target.classList && e.target.classList.contains('notes-panel')) notesOpen = e.target.open;
        if (e.target && e.target.classList && e.target.classList.contains('buy-panel')) buyOpen = e.target.open;
      }, true);
    }

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
        var stRec = state.stallions.find(function (x) { return x.id === sid3; });
        if (stRec && stRec.lifeNumber) {
          state.horseMeta[stRec.lifeNumber] = Object.assign({}, state.horseMeta[stRec.lifeNumber], { status: newStatus === 'Sold' || newStatus === 'Retired' || newStatus === 'For Sale' ? newStatus : 'Active' });
        }
        updateStallionRec(sid3, { status: newStatus });
        if (newStatus === 'Retired' && state.settings.autoDeleteRetired) {
          deleteStallionRec(sid3);
          if (selectedId === sid3) selectedId = null;
        }
      }
      else if (action === 'an-jump') {
        var sec = document.getElementById(t.getAttribute('data-id'));
        if (sec) { sec.open = true; anOpen[sec.getAttribute('data-sec')] = true; saveUi(); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      }
      else if (action === 'an-all') {
        var openAll = t.getAttribute('data-open') === '1';
        document.querySelectorAll('details.an-sec').forEach(function (s) { s.open = openAll; anOpen[s.getAttribute('data-sec')] = openAll; });
        saveUi();
      }
      else if (action === 'calc-show-all') { calcShowAll = !!t.checked; render(); }
      else if (action === 'list-sort') { listSort[activeTab] = t.value; saveUi(); render(); }
      else if (action === 'calc-mare') { calcMare = t.value; saveUi(); render(); }
      else if (action === 'calc-stallion') { calcStallion = t.value; saveUi(); render(); }
      else if (action === 'bulk-pick') {
        bulkSel[t.getAttribute('data-life')] = !!t.checked;
        var bc2 = document.getElementById('bulk-count'); if (bc2) bc2.textContent = Object.keys(bulkSel).filter(function (k) { return bulkSel[k]; }).length + ' selected';
      }
      else if (action === 'calc-mare-text' || action === 'calc-stallion-text') {
        var isM = action === 'calc-mare-text', picked = calcResolveText(isM ? 'mare' : 'stallion', t.value);
        if (picked === null) { render(); return; } // not a horse in the list: put the box back as it was
        if (isM) calcMare = picked; else calcStallion = picked;
        saveUi(); render();
      }
      else if (action === 'goals-split') {
        if (t.checked) {
          // start both sets from the goals you already have
          state.settings.goalsMare = state.settings.goalsMare || Object.assign({}, state.settings.goals);
          state.settings.goalsStallion = state.settings.goalsStallion || Object.assign({}, state.settings.goals);
        }
        state.settings.goalsSplit = !!t.checked;
        state.settings.goalsUpdatedAt = Date.now();
        goalsOpen = true;
        persist();
      }
      else if (action === 'buy-scope') { buyScope = t.value; buyOpen = true; render(); }
      else if (action === 'buy-sex') { buySex = t.value === 'mare' || t.value === 'stallion' ? t.value : ''; buyOpen = true; render(); }
      else if (action === 'update-buy' || action === 'buy-trait') {
        var bk = buyStoreKey();
        var allB = Object.assign({}, state.settings.buyCriteria);
        var ownB = Object.assign({}, allB[bk]);
        if (action === 'buy-trait') {
          var tl = (ownB.needTraits || []).slice(), tn = t.getAttribute('data-trait'), ti = tl.indexOf(tn);
          if (t.checked && ti === -1) tl.push(tn); else if (!t.checked && ti > -1) tl.splice(ti, 1);
          if (tl.length) ownB.needTraits = tl; else delete ownB.needTraits;
        } else {
          var bf = t.getAttribute('data-field');
          if (String(t.value).trim() === '') delete ownB[bf]; else ownB[bf] = String(t.value).trim();
        }
        if (Object.keys(ownB).length) allB[bk] = ownB; else delete allB[bk];
        state.settings.buyCriteria = allB;
        buyOpen = true;
        persist();
      }
      else if (action === 'update-focus') { var bf = Object.assign({}, state.settings.breederFocus); if (t.checked) bf[t.getAttribute('data-focus')] = true; else delete bf[t.getAttribute('data-focus')]; state.settings.breederFocus = bf; notesOpen = true; persist(); }
      else if (action === 'update-focus-discipline') { state.settings.focusDiscipline = t.value; notesOpen = true; persist(); }
      else if (action === 'update-save-studs') { state.settings.saveMarketStuds = !!t.checked; notesOpen = true; persist(); }
      else if (action === 'update-ranch-advice') { state.settings.ranchAdvice = !!t.checked; notesOpen = true; persist(); }
      else if (action === 'update-learn') { state.settings.learn = !!t.checked; notesOpen = true; persist(); }
      else if (action === 'update-market-highlight') { state.settings.marketHighlight = !!t.checked; notesOpen = true; persist(); }
      else if (action === 'update-fit-banner') { state.settings.fitBanner = !!t.checked; notesOpen = true; persist(); }
      else if (action === 'pref-scope') { prefScope = t.value; notesOpen = true; render(); }
      else if (action === 'update-prefer-gene') {
        var pgKey = prefScope ? L.breedKeyOf(prefScope) : '';
        if (pgKey) {
          var byBreed = Object.assign({}, state.settings.preferGenesByBreed);
          var own = Object.assign({}, byBreed[pgKey]);
          if (t.value) own[t.getAttribute('data-gene')] = t.value; else delete own[t.getAttribute('data-gene')];
          if (Object.keys(own).length) byBreed[pgKey] = own; else delete byBreed[pgKey];
          state.settings.preferGenesByBreed = byBreed;
        } else {
          var pgm = Object.assign({}, state.settings.preferGenes);
          if (t.value) pgm[t.getAttribute('data-gene')] = t.value; else delete pgm[t.getAttribute('data-gene')];
          state.settings.preferGenes = pgm;
        }
        notesOpen = true;
        persist();
      }
      else if (action === 'update-overall-notes') {
        state.settings.notes = t.value;
        notesOpen = true;
        persist();
      }
      else if (action === 'update-note') {
        var nl = t.getAttribute('data-life');
        state.horseMeta[nl] = Object.assign({}, state.horseMeta[nl], { notes: t.value.trim() });
        persist();
      }
      else if (action === 'goalset-load') {
        var gl = (state.settings.goalSets || {})[t.value];
        if (gl) {
          if (gl.__bundle) { state.settings.goalsSplit = !!gl.split; state.settings.goals = Object.assign({}, gl.goals); state.settings.goalsMare = Object.assign({}, gl.goalsMare); state.settings.goalsStallion = Object.assign({}, gl.goalsStallion); }
          else state.settings.goals = Object.assign({}, gl);
          state.settings.goalsUpdatedAt = Date.now(); goalsOpen = true; persist();
        }
      }
      else if (action === 'compare-filter') {
        var cfs = t.getAttribute('data-side'), cfk = t.getAttribute('data-key');
        if (cfk === 'all') compareFilter[cfs] = Object.assign(defaultCompareFilter(), t.checked ? {} : { adult: false, young: false, mine: false, other: false, mares: false, stallions: false });
        else compareFilter[cfs][cfk] = t.checked;
        render();
      }
      else if (action === 'global-breed') {
        activeBreed = t.value;
        calcBreed = activeBreed; compareBreed = activeBreed;
        var gk = L.breedKeyOf(activeBreed);
        if (gk) {
          if (calcMare && state.horseInfo[calcMare] && !breedAllowed(calcMare, gk)) calcMare = '';
          if (calcStallion && state.horseInfo[calcStallion] && !breedAllowed(calcStallion, gk)) calcStallion = '';
          if (compareA && state.horseInfo[compareA] && !breedAllowed(compareA, gk)) compareA = '';
          if (compareB && state.horseInfo[compareB] && !breedAllowed(compareB, gk)) compareB = '';
        }
        selectedId = null; selectedMareKey = null; selectedPassportLife = null; suggestLife = null;
        saveUi(); render();
      }
      else if (action === 'calc-breed') {
        calcBreed = t.value;
        var bk = L.breedKeyOf(calcBreed);
        if (bk) {
          if (calcMare && state.horseInfo[calcMare] && !breedAllowed(calcMare, bk)) calcMare = '';
          if (calcStallion && state.horseInfo[calcStallion] && !breedAllowed(calcStallion, bk)) calcStallion = '';
        }
        saveUi(); render();
      }
      else if (action === 'compare-breed') {
        compareBreed = t.value;
        var ck = L.breedKeyOf(compareBreed);
        if (ck) {
          if (compareA && state.horseInfo[compareA] && !breedAllowed(compareA, ck)) compareA = '';
          if (compareB && state.horseInfo[compareB] && !breedAllowed(compareB, ck)) compareB = '';
        }
        render();
      }
      else if (action === 'compare-a') { compareA = t.value; render(); }
      else if (action === 'compare-b') { compareB = t.value; render(); }
      else if (action === 'plan-toggle') {
        var pt = (state.settings.plan || []).map(function (p) { return Object.assign({}, p); });
        var pi = parseInt(t.getAttribute('data-i'), 10);
        if (pt[pi]) pt[pi].done = t.checked;
        state.settings.plan = pt;
        persist();
      }
      else if (action === 'update-calc-fee') {
        state.settings.calcMaxFee = t.value.trim();
        persist();
      }
      else if (action === 'calc-filter') {
        var side = t.getAttribute('data-side'), key = t.getAttribute('data-key'), cf = calcFilter[side];
        if (key === 'all') calcFilter[side] = Object.assign(defaultCalcFilter(), t.checked ? {} : { adult: false, young: false, mine: false, other: false });
        else cf[key] = t.checked;
        saveUi();
        render();
      }
      else if (action === 'horse-sale') { setHorseSale(t.getAttribute('data-life'), t.getAttribute('data-field'), t.value); }
      else if (action === 'comp-best') { setCompBest(t.getAttribute('data-life'), t.getAttribute('data-field'), t.value); }
      else if (action === 'comp-disc') { compEditDisc[t.getAttribute('data-life')] = t.value; persist(); }
      else if (action === 'horse-best') { setHorseBest(t.getAttribute('data-life'), t.getAttribute('data-field'), t.value); }
      else if (action === 'horse-purchase') { setHorsePurchase(t.getAttribute('data-life'), t.getAttribute('data-field'), t.value); }
      else if (action === 'horse-peacock') { var pk0 = Object.assign({}, (state.horseMeta[t.getAttribute('data-life')] || {}).peacock); pk0.expressed = !!t.checked; setHorseMeta(t.getAttribute('data-life'), { peacock: pk0 }); }
      else if (action === 'horse-peacock-strength') { var pk1 = Object.assign({}, (state.horseMeta[t.getAttribute('data-life')] || {}).peacock); pk1.strength = t.value === '' ? '' : Math.max(0, Math.min(100, parseFloat(t.value) || 0)); setHorseMeta(t.getAttribute('data-life'), { peacock: pk1 }); }
      else if (action === 'horse-gene') { setHorseGene(t.getAttribute('data-life'), t.getAttribute('data-locus'), t.value); }
      else if (action === 'herd-status') { setLifeStatus(t.getAttribute('data-life'), t.value); }
      else if (action === 'herd-scores') { setHorseMeta(t.getAttribute('data-life'), { confScores: parseScores(t.value) }); }
      else if (action === 'herd-role') { setHorseMeta(t.getAttribute('data-life'), { role: t.value }); }
      else if (action === 'herd-project') { setHorseMeta(t.getAttribute('data-life'), { project: t.value.trim() }); }
      else if (action === 'herd-filter-role') { herdRoleFilter = t.value; render(); }
      else if (action === 'herd-filter-project') { herdProjectFilter = t.value; render(); }
      else if (action === 'toggle-auto-delete') {
        state.settings.autoDeleteRetired = t.checked;
        persist();
      }
      else if (action === 'update-goal') {
        var gKey = L.goalsKeyFor(state, state.settings.goalsSplit ? goalsEdit : undefined);
        var goals = Object.assign({}, state.settings[gKey] || state.settings.goals);
        goals[t.getAttribute('data-field')] = t.value.trim();
        state.settings[gKey] = goals;
        state.settings.goalsUpdatedAt = Date.now();
        goalsOpen = true;
        persist();
      }
      else if (action === 'update-sell') {
        var sf = Object.assign({}, state.settings.sellForm);
        var fld = t.getAttribute('data-field');
        sf[fld] = t.type === 'checkbox' ? t.checked : t.value;
        state.settings.sellForm = sf;
        persist();
      }
      else if (action === 'update-username') {
        state.settings.myUsername = t.value.trim();
        L.adoptOwnedStallions(state);
        persist();
      }
    };
  }

  // ---------- open a horse's profile (from the "Open in Ledger" button on Horse Reality) ----------
  // Picks the richest page for the horse: your stallion's page, your mare's page, otherwise
  // its cached passport; an uncached horse falls back to a search for its number.
  window.HRLedgerOpenProfile = function (life) {
    life = String(life || '').replace(/[^0-9]/g, '');
    if (!life || !state) return;
    selectedId = null; selectedMareKey = null; selectedPassportLife = null; pendingConfirm = null;
    horseSearchQuery = '';
    var stud = state.stallions.find(function (s) { return s.lifeNumber && String(s.lifeNumber) === life && s.owned !== false; });
    var mare = maresIndex.find(function (m) { return String(m.mareLifeNumber) === life; });
    if (stud) selectedId = stud.id;
    else if (mare) selectedMareKey = mare.key;
    else if (state.horseInfo && state.horseInfo[life]) selectedPassportLife = life;
    else horseSearchQuery = life;
    render();
    window.scrollTo(0, 0);
  };
  function openFromHash() {
    var m = /horse=([0-9]+)/.exec(location.hash || '');
    if (m) { window.HRLedgerOpenProfile(m[1]); return; }
    var t = /tab=(\w+)/.exec(location.hash || '');
    var tabs = ['stallions', 'mares', 'colts', 'fillies', 'herd', 'retired', 'others', 'analytics', 'calc', 'settings'];
    if (t && tabs.indexOf(t[1]) > -1) {
      activeTab = t[1]; herdSub = '';
      if (activeTab === 'retired') { activeTab = 'herd'; herdSub = 'retired'; } selectedId = null; selectedMareKey = null; selectedPassportLife = null; suggestLife = null;
      saveUi(); render();
    }
  }
  window.addEventListener('hashchange', openFromHash);

  // ---------- boot ----------
  HRStorage.getState(function (loaded) {
    state = loaded;
    var scoresChanged = L.refreshBreedTotals(state) + L.dedupeFoals(state) + L.purgeIgnored(state) + L.purgeTrash(state);
    if (L.adoptOwnedStallions(state) || scoresChanged) { persist(function () { openFromHash(); bringInImages(); }); return; }
    recompute();
    render();
    openFromHash();
    bringInImages();
  });

  // The pictures are stored apart from the ledger: read them after the first draw and draw again
  function bringInImages() {
    HRStorage.migrateImages(function () {
      HRStorage.hydrateImages(function (n) { if (n) { HRStorage.applyImages(state); render(); } });
    });
  }

  // Live-update if a content script writes new data while this tab is open.
  var liveTimer = null, liveState = null;
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    var imgChanged = false;
    Object.keys(changes).forEach(function (k) { if (HRStorage.noteImageChange(k, changes[k].newValue)) imgChanged = true; });
    if (!changes.hrLedger && !imgChanged) return;
    if (changes.hrLedger) liveState = changes.hrLedger.newValue || HRStorage.defaultState();
    // Pages writing several times in a row are folded into one redraw
    clearTimeout(liveTimer);
    liveTimer = setTimeout(function () {
      if (liveState) { state = liveState; liveState = null; }
      if (!state.breedings) state.breedings = {};
      if (!state.horseInfo) state.horseInfo = {};
      if (!state.horseMeta) state.horseMeta = {};
      if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
      HRStorage.applyImages(state);
      recompute();
      render();
    }, 400);
  });
})();
