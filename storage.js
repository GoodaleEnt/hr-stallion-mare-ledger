// Thin wrapper around chrome.storage.local — the one place that knows the
// on-disk shape. Both content.js (scraping) and dashboard.js (the UI) share it.
(function (global) {
  'use strict';

  function defaultState() {
    return { stallions: [], breedings: {}, settings: { autoDeleteRetired: false, myUsername: '' } };
  }

  function getState(cb) {
    chrome.storage.local.get({ hrLedger: defaultState() }, function (res) {
      var state = res.hrLedger || defaultState();
      if (!state.breedings) state.breedings = {};
      if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
      if (state.settings.myUsername == null) state.settings.myUsername = '';
      cb(state);
    });
  }

  function setState(state, cb) {
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

  global.HRStorage = {
    defaultState: defaultState,
    getState: getState,
    setState: setState,
    allBreedingsFlat: allBreedingsFlat,
    upsertStallionByMatch: upsertStallionByMatch,
    upsertBreeding: upsertBreeding
  };
})(typeof window !== 'undefined' ? window : this);
