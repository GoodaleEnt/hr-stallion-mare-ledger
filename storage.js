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
  // When the extension is reloaded or updated, a Horse Reality tab that was already open keeps running the OLD
  // content script, whose connection to the extension is gone ("Extension context invalidated"). That is harmless
  // (reload the tab to get the new script), so the old script just goes quiet instead of logging errors.
  function alive() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function isGone(e) { return !alive() || /context invalidated/i.test(String((e && e.message) || e || '')); }
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
    if (!alive()) return;
    gate = gate.then(function () {
      if (!alive()) throw new Error('Extension context invalidated');
      if (cache && Date.now() - cacheAt < CACHE_MS) { cacheAt = Date.now(); return cache; }
      return readFromStorage().then(function (s) { cache = s; cacheAt = Date.now(); return s; });
    }).then(function (s) {
      try { cb(clone(s)); } catch (e) { console.error('HR Ledger:', e); }
    }).catch(function (e) { if (!isGone(e)) console.error('HR Ledger storage error:', e); });
  }

  // Like getState, but hands over the shared copy instead of cloning the whole ledger. For code that only READS (drawing a
  // badge, colouring rows): it must not change the object it is given.
  function peekState(cb) {
    if (!alive()) return;
    gate = gate.then(function () {
      if (!alive()) throw new Error('Extension context invalidated');
      if (cache && Date.now() - cacheAt < CACHE_MS) { cacheAt = Date.now(); return cache; }
      return readFromStorage().then(function (s) { cache = s; cacheAt = Date.now(); return s; });
    }).then(function (s) {
      try { if (global.HRLib && HRLib.markStable) HRLib.markStable(s); cb(s); } catch (e) { console.error('HR Ledger:', e); }
    }).catch(function (e) { if (!isGone(e)) console.error('HR Ledger storage error:', e); });
  }

  // ---------- pictures live apart from the ledger ----------
  // Horse pictures are kept as data URLs (the site's image server refuses to be hotlinked) and each is about 200 KB, so a
  // ledger of a few hundred horses reached 90 MB. Every Horse Reality page read and rewrote all of it. The pictures are now
  // stored under their own keys ("hrImg:h:<life number>", "hrImg:s:<stallion id>", "hrImg:f:<breeding id>"), which Horse
  // Reality pages never load; the ledger itself only keeps a flag (imageStored / foalImageStored). The dashboard reads the
  // pictures back (hydrateImages / applyImages) and writes any new one through setState as before.
  var IMG_PREFIX = 'hrImg:';
  var imageStore = {};  // 'h:<life>' | 's:<id>' | 'f:<id>' -> data URL, as far as this page knows
  var imgSig = {};      // key -> signature of the picture already saved in storage
  function isDataUrl(v) { return typeof v === 'string' && v.charAt(0) === 'd' && v.indexOf('data:') === 0; }
  function sigOf(v) { return v.length + ':' + v.slice(-24); }
  // Takes the pictures out of a state: { items, stripped }. stripped shares everything with state except the entries it
  // had to copy, so a state without pictures costs only a scan.
  function extractImages(state) {
    var items = {}, stripped = state, copied = false;
    function own() { if (!copied) { stripped = Object.assign({}, state); copied = true; } return stripped; }
    var hi = state.horseInfo || {}, newHi = null;
    Object.keys(hi).forEach(function (l) {
      var info = hi[l];
      if (info && isDataUrl(info.imageUrl)) { items['h:' + l] = info.imageUrl; if (!newHi) newHi = Object.assign({}, hi); newHi[l] = Object.assign({}, info, { imageUrl: '', imageStored: true }); }
    });
    if (newHi) own().horseInfo = newHi;
    var ss = state.stallions || [], newSs = null;
    ss.forEach(function (s, i) {
      if (s && s.id && isDataUrl(s.imageUrl)) { items['s:' + s.id] = s.imageUrl; if (!newSs) newSs = ss.slice(); newSs[i] = Object.assign({}, s, { imageUrl: '', imageStored: true }); }
    });
    if (newSs) own().stallions = newSs;
    var bs = state.breedings || {}, newBs = null;
    Object.keys(bs).forEach(function (sid) {
      var arr = bs[sid] || [], na = null;
      arr.forEach(function (b, i) {
        if (b && b.id && isDataUrl(b.foalImageUrl)) { items['f:' + b.id] = b.foalImageUrl; if (!na) na = arr.slice(); na[i] = Object.assign({}, b, { foalImageUrl: '', foalImageStored: true }); }
      });
      if (na) { if (!newBs) newBs = Object.assign({}, bs); newBs[sid] = na; }
    });
    if (newBs) own().breedings = newBs;
    return { items: items, stripped: stripped };
  }
  // Puts the pictures this page knows about back into a state (the dashboard, for showing and for backups)
  function applyImages(state) {
    var hi = state.horseInfo || {}, ssById = null, recById = null;
    Object.keys(imageStore).forEach(function (k) {
      var kind = k.charAt(0), id = k.slice(2), v = imageStore[k];
      if (kind === 'h') { var info = hi[id]; if (info && !isDataUrl(info.imageUrl)) info.imageUrl = v; }
      else if (kind === 's') { if (!ssById) { ssById = {}; (state.stallions || []).forEach(function (s) { ssById[s.id] = s; }); } var s0 = ssById[id]; if (s0 && !isDataUrl(s0.imageUrl)) s0.imageUrl = v; }
      else if (kind === 'f') {
        if (!recById) { recById = {}; Object.keys(state.breedings || {}).forEach(function (sid) { (state.breedings[sid] || []).forEach(function (b) { if (b && b.id) recById[b.id] = b; }); }); }
        var r = recById[id]; if (r && !isDataUrl(r.foalImageUrl)) r.foalImageUrl = v;
      }
    });
    return state;
  }
  // Saves pictures in pieces of about 5 MB (one huge write can fail); only the ones that changed. cb(true) when all are saved.
  function writeImages(items, cb) {
    var keys = Object.keys(items).filter(function (k) { return imgSig[k] !== sigOf(items[k]); });
    if (!keys.length) { cb(true); return; }
    var pos = 0;
    (function nextChunk() {
      if (pos >= keys.length) { cb(true); return; }
      var batch = {}, size = 0, used = [];
      while (pos < keys.length && (size === 0 || size + items[keys[pos]].length < 5000000)) { var k = keys[pos++]; batch[IMG_PREFIX + k] = items[k]; size += items[k].length; used.push(k); }
      try {
        chrome.storage.local.set(batch, function () {
          if (chrome.runtime && chrome.runtime.lastError) { cb(false); return; }
          used.forEach(function (u) { imgSig[u] = sigOf(items[u]); });
          nextChunk();
        });
      } catch (e) { cb(false); }
    })();
  }
  // Reads every saved picture (the dashboard, once it has drawn)
  function hydrateImages(cb) {
    if (!alive()) { cb(0); return; }
    chrome.storage.local.get(null, function (all) {
      var n = 0;
      Object.keys(all || {}).forEach(function (k) {
        if (k.indexOf(IMG_PREFIX) !== 0) return;
        var key = k.slice(IMG_PREFIX.length);
        imageStore[key] = all[k]; imgSig[key] = sigOf(all[k]); n++;
      });
      cb(n);
    });
  }
  function noteImageChange(storageKey, newValue) {
    if (storageKey.indexOf(IMG_PREFIX) !== 0) return false;
    var key = storageKey.slice(IMG_PREFIX.length);
    if (newValue) { imageStore[key] = newValue; imgSig[key] = sigOf(newValue); } else { delete imageStore[key]; delete imgSig[key]; }
    return true;
  }
  // One-time move of the pictures out of an older, large ledger. The pictures are written first, and the ledger is only
  // rewritten without them once they are all safely saved, so an interruption loses nothing. Run by the extension's own
  // pages (background, dashboard), never by a Horse Reality page. cb(number of pictures moved).
  var migrating = false;
  function migrateImages(cb) {
    cb = cb || function () {};
    if (migrating || !alive()) { cb(0); return; }
    migrating = true;
    function done(n) { migrating = false; cb(n); }
    chrome.storage.local.get({ hrLedger: null }, function (res) {
      var cur = res && res.hrLedger;
      if (!cur) { done(0); return; }
      var ex = extractImages(cur), keys = Object.keys(ex.items);
      if (!keys.length) { done(0); return; }
      writeImages(ex.items, function (ok) {
        if (!ok) { done(0); return; }
        keys.forEach(function (k) { imageStore[k] = ex.items[k]; });
        // read the ledger again: pages may have changed it meanwhile; any picture that appeared since is saved too
        chrome.storage.local.get({ hrLedger: null }, function (r2) {
          var latest = r2 && r2.hrLedger;
          if (!latest) { done(0); return; }
          var ex2 = extractImages(latest);
          writeImages(ex2.items, function (ok2) {
            if (!ok2) { done(0); return; }
            chrome.storage.local.set({ hrLedger: ex2.stripped }, function () {
              if (chrome.runtime && chrome.runtime.lastError) { done(0); return; }
              cache = null;
              done(keys.length);
            });
          });
        });
      });
    });
  }

  function setState(state, cb) {
    var ex = extractImages(state);
    Object.keys(ex.items).forEach(function (k) { imageStore[k] = ex.items[k]; });
    cache = clone(ex.stripped);
    cacheAt = Date.now();
    if (!alive()) return;
    try {
      // new pictures go to their own keys first; if that fails the ledger is saved whole, as before, so nothing is lost
      writeImages(ex.items, function (ok) {
        try { chrome.storage.local.set({ hrLedger: ok ? ex.stripped : state }, cb || function () {}); } catch (e) { if (!isGone(e)) console.error('HR Ledger storage error:', e); }
      });
    } catch (e) { if (!isGone(e)) console.error('HR Ledger storage error:', e); }
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
    peekState: peekState,
    hydrateImages: hydrateImages,
    applyImages: applyImages,
    noteImageChange: noteImageChange,
    migrateImages: migrateImages,
    extractImages: extractImages,
    setState: setState,
    alive: alive,
    allBreedingsFlat: allBreedingsFlat,
    upsertStallionByMatch: upsertStallionByMatch,
    upsertBreeding: upsertBreeding,
    upsertHorseInfo: upsertHorseInfo
  };
})(typeof window !== 'undefined' ? window : this);
