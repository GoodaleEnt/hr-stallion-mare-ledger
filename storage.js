// Thin wrapper around chrome.storage.local — the one place that knows the
// on-disk shape. Both content.js (scraping) and dashboard.js (the UI) share it.
(function (global) {
  'use strict';

  function defaultState() {
    return { stallions: [], breedings: {}, horseInfo: {}, horseMeta: {}, settings: { autoDeleteRetired: false, myUsername: '' } };
  }

  // content.js fires several independent read-modify-write cycles at once
  // (passport merge, diagnostics note, stale-covering sweep, image attach...).
  // Each used to read its own copy of the ledger straight from storage, so a
  // slow writer could silently overwrite a faster one's changes — the horse
  // was reported "added" and then vanished. getState() callbacks now run one
  // at a time, in call order, against the newest state this context has
  // written (kept in `cache` for a short burst, then re-read from storage so
  // writes made by another context — the dashboard, another tab — are picked up).
  var CACHE_MS = 2000;
  var cache = null, cacheAt = 0, gate = Promise.resolve();
  function clone(o) { return typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)); }
  function readFromStorage() {
    return new Promise(function (resolve) {
      chrome.storage.local.get({ hrLedger: defaultState() }, function (res) { resolve(normalize(res.hrLedger)); });
    });
  }
  function normalize(state) {
    state = state || defaultState();
    if (!state.breedings) state.breedings = {};
    if (!state.horseInfo) state.horseInfo = {};
    if (!state.horseMeta) state.horseMeta = {};
    if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
    if (state.settings.myUsername == null) state.settings.myUsername = '';
    return state;
  }
  function getState(cb) {
    gate = gate.then(function () {
      if (cache && Date.now() - cacheAt < CACHE_MS) { cacheAt = Date.now(); return cache; }
      return readFromStorage().then(function (s) { cache = s; cacheAt = Date.now(); return s; });
    }).then(function (s) {
      try { cb(clone(s)); } catch (e) { console.error('HR Ledger:', e); }
    }).catch(function (e) { console.error('HR Ledger storage error:', e); });
  }

  function setState(state, cb) {
    cache = clone(state);
    cacheAt = Date.now();
    chrome.storage.local.set({ hrLedger: state }, cb || function () {});
  }

  function allBreedingsFlat(state) {
    var out = [];
    state.stallions.forEach(function (s) {
      (state.breedings[s.id] || []).forEach(function (b) {
        out.push(Object.assign({}, b, { stallionId: s.id, stallionName: s.name, stallionLifeNumber: s.lifeNumber }));
      });
    });
    return out;
  }

  // Finds a stallion by life number/name, or creates a minimal stub for one
  // scraped from the bank page that isn't in the ledger yet. Never overwrites
  // an existing stallion's details.
  function upsertStallionByMatch(state, partial) {
    var matchId = HRLib.findStallionMatch(state.stallions, { stallionName: partial.name, stallionLifeNumber: partial.lifeNumber });
    if (matchId) return { id: matchId, created: false };
    var id = HRLib.uid();
    state.stallions.push(Object.assign({ id: id, createdAt: Date.now(), status: 'Active' }, partial));
    state.breedings[id] = [];
    return { id: id, created: true };
  }

  // Adds a breeding record, or merges into a matching one (same mare/date/
  // foal/price) instead of creating a duplicate.
  function upsertBreeding(state, stallionId, rowData) {
    if (!state.breedings[stallionId]) state.breedings[stallionId] = [];
    var list = state.breedings[stallionId];
    var key = HRLib.breedingMatchKey(rowData);
    var existing = list.find(function (b) { return HRLib.breedingMatchKey(b) === key; });
    if (existing) {
      Object.assign(existing, rowData);
      return 'updated';
    }
    list.push(Object.assign({ id: HRLib.uid(), createdAt: Date.now() }, rowData));
    return 'added';
  }

  // Caches a horse's passport snapshot (genetics, pedigree, pregnancy...) by
  // life number. Unlike stallions/breedings, this is safe to write for ANY
  // horse you merely view — it's read-only reference data, not a claim of
  // ownership, so it doesn't need the "bank page proves it" gate that
  // upsertStallionByMatch enforces.
  function upsertHorseInfo(state, lifeNumber, data) {
    if (!lifeNumber) return;
    state.horseInfo[lifeNumber] = Object.assign({}, state.horseInfo[lifeNumber], data, { capturedAt: Date.now() });
  }

  global.HRStorage = {
    defaultState: defaultState,
    getState: getState,
    setState: setState,
    allBreedingsFlat: allBreedingsFlat,
    upsertStallionByMatch: upsertStallionByMatch,
    upsertBreeding: upsertBreeding,
    upsertHorseInfo: upsertHorseInfo
  };
})(typeof window !== 'undefined' ? window : this);
