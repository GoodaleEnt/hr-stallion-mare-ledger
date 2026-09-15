// Mobile (userscript) drop-in replacement for storage.js — same HRStorage
// interface, backed by GM.getValue/GM.setValue instead of chrome.storage.local,
// so content.js and dashboard.js (both loaded via @require, unmodified) don't
// need to know the difference.
(function (global) {
  'use strict';

  function defaultState() {
    return { stallions: [], breedings: {}, horseInfo: {}, settings: { autoDeleteRetired: false, myUsername: '' } };
  }

  function getState(cb) {
    GM.getValue('hrLedger', defaultState()).then(function (res) {
      var state = res || defaultState();
      if (!state.breedings) state.breedings = {};
      if (!state.horseInfo) state.horseInfo = {};
      if (!state.settings) state.settings = { autoDeleteRetired: false, myUsername: '' };
      if (state.settings.myUsername == null) state.settings.myUsername = '';
      cb(state);
    });
  }

  // dashboard.js listens via chrome.storage.onChanged for live refresh (e.g.
  // content.js scraping new data while the dashboard overlay is open) — the
  // scaffold's chrome shim turns that into a real pub-sub instead of a
  // no-op specifically so this can notify it, matching what
  // chrome.storage.local.set would do for real in the extension.
  function setState(state, cb) {
    GM.setValue('hrLedger', state).then(function () {
      var onChanged = window.chrome && window.chrome.storage && window.chrome.storage.onChanged;
      if (onChanged && onChanged._listeners) {
        onChanged._listeners.forEach(function (fn) { fn({ hrLedger: { newValue: state } }, 'local'); });
      }
      if (cb) cb();
    });
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

  function upsertStallionByMatch(state, partial) {
    var matchId = HRLib.findStallionMatch(state.stallions, { stallionName: partial.name, stallionLifeNumber: partial.lifeNumber });
    if (matchId) return { id: matchId, created: false };
    var id = HRLib.uid();
    state.stallions.push(Object.assign({ id: id, createdAt: Date.now(), status: 'Active' }, partial));
    state.breedings[id] = [];
    return { id: id, created: true };
  }

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
