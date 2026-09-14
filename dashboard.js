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
  var addingStallion = false;
  var editingStallion = false;
  var addingBreeding = false;
  var importingBreeding = false;
  var importError = '';
  var pendingConfirm = null;

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
        var key = L.mareKey(b);
        if (!map[key]) {
          map[key] = { key: key, mareName: b.mareName, mareUrl: b.mareUrl, mareLifeNumber: b.mareLifeNumber, records: [] };
        }
        if (b.mareUrl) map[key].mareUrl = b.mareUrl;
        map[key].records.push(b);
      });
    }
    maresIndex = Object.keys(map).map(function (k) { return map[k]; });
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

  // ---------- confirm dialog ----------
  function askConfirm(message, onYes) {
    pendingConfirm = { message: message, onYes: onYes };
    render();
  }

  // ---------- render ----------
  function render() {
    var app = document.getElementById('app');
    var html;
    if (selectedId) html = renderDetail();
    else if (selectedMareKey) html = renderMareDetail();
    else if (activeTab === 'mares') html = renderMaresList();
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

  function topHeaderHtml() {
    return '<header class="top"><div class="titles">' +
      '<h1>HR Stallion &amp; Mare Ledger</h1>' +
      '<p>Every covering, every mare, every fee — captured as you browse.</p>' +
      '</div></header>' +
      '<div class="tabs">' +
        '<button class="tab-btn' + (activeTab === 'stallions' ? ' active' : '') + '" data-action="show-tab" data-tab="stallions">Stallions</button>' +
        '<button class="tab-btn' + (activeTab === 'mares' ? ' active' : '') + '" data-action="show-tab" data-tab="mares">My Mares</button>' +
      '</div>';
  }

  function renderStallionsList() {
    var totalBreedings = 0, totalsAll = {};
    state.stallions.forEach(function (s) {
      var a = aggregates[s.id] || { count: 0, totals: {} };
      totalBreedings += a.count;
      L.CURRENCIES.forEach(function (c) { if (a.totals && a.totals[c]) totalsAll[c] = (totalsAll[c] || 0) + a.totals[c]; });
    });
    var totalEarnedLine = L.moneyLine(totalsAll);

    var html = topHeaderHtml();

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + state.stallions.length + '</div><div class="label">Stallions</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + uniqueMareCount + '</div><div class="label">Mares (all)</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + totalBreedings + '</div><div class="label">Breedings logged</div></div>' +
      '<div class="stat-tile"><div class="' + (totalEarnedLine.indexOf('·') > -1 ? 'num mono multi' : 'num mono') + '">' + totalEarnedLine + '</div><div class="label">Total earned</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Your Stallions</h2>' +
      '<div style="display:flex;gap:8px;">' +
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

    if (state.stallions.length === 0 && !addingStallion) {
      html += '<div class="empty"><h3>No stallions yet</h3>' +
        '<p>Browse to your bank page or a stallion\'s offspring page on Horse Reality and they\'ll appear here automatically — or add one by hand.</p>' +
        '<button class="btn btn-primary" data-action="toggle-add-stallion">+ Add Stallion</button></div>';
    } else if (state.stallions.length) {
      html += '<div class="stallion-grid">';
      state.stallions.forEach(function (s) {
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
        html += '<div class="card stallion-card" data-action="open-mare" data-key="' + L.esc(m.key) + '">' +
          '<h3>' + L.esc(m.mareName) + '</h3>' +
          (m.mareLifeNumber ? '<div class="lifenum mono">#' + L.esc(m.mareLifeNumber) + '</div>' : '') +
          '<div class="row"><span>Breedings</span><span class="v mono">' + m.records.length + '</span></div>' +
          '<div class="row"><span>Succeeded</span><span class="v mono">' + (m.counts.Succeeded || 0) + '</span></div>' +
          '<div class="row"><span>Failed</span><span class="v mono">' + (m.counts.Failed || 0) + '</span></div>' +
          '<div class="row"><span>Foals born</span><span class="v mono">' + (m.counts['Foal Born'] || 0) + '</span></div>' +
        '</div>';
      });
      html += '</div>';
    }
    return html;
  }

  function renderMareDetail() {
    var m = maresIndex.find(function (x) { return x.key === selectedMareKey; });
    if (!m) { selectedMareKey = null; return renderMaresList(); }
    var mareHref = L.safeUrl(m.mareUrl);

    var html = '<button class="back-link" data-action="back-to-mares">← My mares</button>';
    html += '<div class="detail-head">' +
      '<div><h1>' + L.esc(m.mareName) + '</h1>' +
      '<div class="tags">' +
        (m.mareLifeNumber ? '<span class="tag mono">#' + L.esc(m.mareLifeNumber) + '</span>' : '') +
      '</div>' +
      (mareHref ? '<p class="notes-line"><a href="' + L.esc(mareHref) + '" target="_blank" rel="noopener noreferrer">View mare on Horse Reality<span class="ext">↗</span></a></p>' : '') +
      '</div>' +
    '</div>';

    html += '<div class="stats-bar">' +
      '<div class="stat-tile"><div class="num mono">' + m.records.length + '</div><div class="label">Breedings</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (m.counts.Succeeded || 0) + '</div><div class="label">Succeeded</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (m.counts.Failed || 0) + '</div><div class="label">Failed</div></div>' +
      '<div class="stat-tile"><div class="num mono">' + (m.counts['Foal Born'] || 0) + '</div><div class="label">Foals born</div></div>' +
      '</div>';

    html += '<div class="section-head"><h2>Breeding History</h2></div>';
    html += '<div class="ledger">';
    html += '<div class="ledger-head"><div>Date</div><div>Stallion</div><div>Owner</div><div>Price</div><div>Status</div><div></div></div>';
    html += '<div class="card">';
    m.records.forEach(function (b, i) { html += renderBreedingRow(b, i, 'mare'); });
    html += '</div></div>';

    return html;
  }

  function renderDetail() {
    var s = state.stallions.find(function (x) { return x.id === selectedId; });
    if (!s) { selectedId = null; return renderStallionsList(); }
    var breedings = (state.breedings[selectedId] || []).slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

    var earnedTotals = {};
    breedings.forEach(function (b) {
      var cur = b.currency || 'HRC';
      earnedTotals[cur] = (earnedTotals[cur] || 0) + (Number(b.price) || 0);
    });
    var earnedLine = L.moneyLine(earnedTotals);
    var mareKeysForStallion = {};
    breedings.forEach(function (b) { if (b.mareName) mareKeysForStallion[L.mareKey(b)] = true; });
    var stallionMareCount = Object.keys(mareKeysForStallion).length;

    var html = '<button class="back-link" data-action="back-to-list">← All stallions</button>';

    if (editingStallion) {
      html += renderStallionForm(s);
    } else {
      html += '<div class="detail-head"><div class="name-row">' +
        (s.imageUrl ? '<img class="portrait" src="' + L.esc(s.imageUrl) + '" alt="">' : '') +
        '<div><h1>' + L.esc(s.name) + '</h1>' +
        '<div class="tags">' +
          (s.lifeNumber ? '<span class="tag mono">#' + L.esc(s.lifeNumber) + '</span>' : '') +
          (s.breed ? '<span class="tag">' + L.esc(s.breed) + '</span>' : '') +
          (s.color ? '<span class="tag">' + L.esc(s.color) + '</span>' : '') +
          L.CURRENCIES.map(function (c) { return s['feePublic' + c] ? '<span class="tag mono">Public ' + L.fmtMoney(s['feePublic' + c]) + ' ' + c + '</span>' : ''; }).join('') +
          L.CURRENCIES.map(function (c) { return s['feePrivate' + c] ? '<span class="tag mono">Private ' + L.fmtMoney(s['feePrivate' + c]) + ' ' + c + '</span>' : ''; }).join('') +
        '</div>' +
        (s.notes ? '<p class="notes-line">' + L.esc(s.notes) + '</p>' : '') +
        '</div>' +
      '</div>' +
        '<div class="detail-actions">' +
          '<select class="pill-select ' + L.stallionStatusClass(s.status || 'Active') + '" data-action="update-stallion-status" data-id="' + s.id + '">' +
            ['Active', 'Sold', 'Retired'].map(function (opt) { return '<option' + (opt === (s.status || 'Active') ? ' selected' : '') + '>' + opt + '</option>'; }).join('') +
          '</select>' +
          '<button class="btn btn-sm" data-action="edit-stallion">Edit</button>' +
          '<button class="btn btn-sm btn-danger" data-action="delete-stallion" data-id="' + s.id + '">Delete</button>' +
        '</div>' +
      '</div>';
    }

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
        selectedMareKey = null; selectedId = null;
        render();
      }
      else if (action === 'toggle-add-stallion') { addingStallion = !addingStallion; render(); }
      else if (action === 'cancel-stallion-form') { addingStallion = false; editingStallion = false; render(); }
      else if (action === 'edit-stallion') { editingStallion = true; render(); }
      else if (action === 'open-stallion') {
        selectedId = t.getAttribute('data-id');
        selectedMareKey = null;
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
      else if (action === 'toggle-add-breeding') { addingBreeding = !addingBreeding; render(); }
      else if (action === 'cancel-breeding-form') { addingBreeding = false; render(); }
      else if (action === 'toggle-import') { importingBreeding = !importingBreeding; importError = ''; render(); }
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

      if (action === 'submit-stallion') {
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
      else if (action === 'toggle-auto-delete') {
        state.settings.autoDeleteRetired = t.checked;
        persist();
      }
      else if (action === 'update-username') {
        state.settings.myUsername = t.value.trim();
        persist();
      }
    };
  }

  // ---------- boot ----------
  HRStorage.getState(function (loaded) {
    state = loaded;
    recompute();
    render();
  });

  // Live-update if a content script writes new data while this tab is open.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local' || !changes.hrLedger) return;
    state = changes.hrLedger.newValue || HRStorage.defaultState();
    if (!state.breedings) state.breedings = {};
    if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
    recompute();
    render();
  });
})();
