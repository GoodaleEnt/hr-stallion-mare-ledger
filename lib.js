// Shared, pure helper functions — no chrome.* calls here, safe to load into
// both a content-script isolated world and a normal extension page.
(function (global) {
  'use strict';

  var CURRENCIES = ['HRC', 'DP', 'FT', 'WT'];
  var STATUS_OPTIONS = ['Pending', 'Succeeded', 'Failed', 'Foal Born'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMoney(n) {
    n = Number(n) || 0;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  function moneyLine(totals) {
    var parts = CURRENCIES.filter(function (c) { return totals && totals[c]; })
      .map(function (c) { return fmtMoney(totals[c]) + ' ' + c; });
    return parts.length ? parts.join(' · ') : '—';
  }
  function feeObj(s, tier) {
    var o = {};
    CURRENCIES.forEach(function (c) {
      var v = s['fee' + tier + c];
      if (v) o[c] = v;
    });
    return o;
  }
  function hasAny(obj) { return !!obj && Object.keys(obj).length > 0; }
  function fmtDate(d) {
    if (!d) return '—';
    var parts = d.split('-');
    if (parts.length !== 3) return d;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var m = parseInt(parts[1], 10) - 1;
    return months[m] + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function uid() {
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }
  function statusPillClass(s) {
    if (s === 'Foal Born') return 'pill-foal';
    if (s === 'Failed' || s === 'Cancelled') return 'pill-failed';
    if (s === 'Succeeded' || s === 'Confirmed') return 'pill-succeeded';
    return 'pill-pending';
  }
  function stallionStatusClass(s) {
    if (s === 'Sold') return 'pill-succeeded';
    if (s === 'Retired') return 'pill-failed';
    return 'pill-active';
  }
  function safeUrl(u) {
    if (!u) return '';
    u = String(u).trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return '';
    return 'https://' + u;
  }
  function mareKey(b) {
    return b.mareLifeNumber ? ('life:' + b.mareLifeNumber) : ('name:' + String(b.mareName || '').trim().toLowerCase());
  }
  function breedingMatchKey(b) {
    return [
      b.mareLifeNumber ? ('life:' + b.mareLifeNumber) : ('name:' + String(b.mareName || '').trim().toLowerCase()),
      b.date || '',
      b.foalUrl || b.foalName || '',
      b.price != null ? b.price : ''
    ].join('|');
  }
  function findStallionMatch(stallions, row) {
    if (row.stallionLifeNumber) {
      var byLife = stallions.find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(row.stallionLifeNumber); });
      if (byLife) return byLife.id;
    }
    if (row.stallionName) {
      var name = String(row.stallionName).trim().toLowerCase();
      var byName = stallions.find(function (s) { return s.name && s.name.trim().toLowerCase() === name; });
      if (byName) return byName.id;
    }
    return null;
  }
  function daysSince(dateStr) {
    if (!dateStr) return null;
    var ms = new Date(dateStr + 'T00:00:00').getTime();
    if (isNaN(ms)) return null;
    return (Date.now() - ms) / 86400000;
  }
  // Pending breedings old enough that Horse Reality has certainly resolved
  // the covering one way or the other, but which the ledger has no proof of
  // either way yet (no matching "Foal Born" record for that mare). Shared by
  // content.js (which auto-marks these Failed) and background.js (which
  // badges them first, since the stud owner never gets the failure
  // notification for a customer's mare — only she does).
  function findReviewCandidates(state, minDays) {
    var out = [];
    (state.stallions || []).forEach(function (s) {
      var list = (state.breedings && state.breedings[s.id]) || [];
      list.forEach(function (b) {
        if (b.status !== 'Pending' || !b.date) return;
        var age = daysSince(b.date);
        if (age == null || age < minDays) return;
        var hasFoal = list.some(function (other) {
          return other !== b && other.mareLifeNumber && other.mareLifeNumber === b.mareLifeNumber && other.status === 'Foal Born';
        });
        if (hasFoal) return;
        out.push({ stallionId: s.id, stallionName: s.name, breeding: b, days: Math.floor(age) });
      });
    });
    return out;
  }

  // ---------- herd tracking (My Herd tab) ----------
  var HERD_STATUSES = ['Active', 'Observation', 'Companion', 'For Sale', 'Sold', 'Retired', 'Deceased'];
  var HERD_ROLES = ['Broodmare', 'Public Stud', 'Private Stud', 'Competition', 'Young Stock'];
  var ARCHIVE_STATUSES = ['Sold', 'Retired', 'Deceased'];

  function herdStatusClass(s) {
    if (s === 'Sold') return 'pill-succeeded';
    if (s === 'Retired' || s === 'Deceased') return 'pill-failed';
    if (s === 'Observation' || s === 'For Sale') return 'pill-pending';
    if (s === 'Companion') return 'pill-foal';
    return 'pill-active';
  }
  function herdMeta(state, lifeNumber) {
    var m = (state.horseMeta && state.horseMeta[lifeNumber]) || {};
    return { status: m.status || 'Active', role: m.role || '', project: m.project || '' };
  }
  // Cached horses whose API-reported owner matches the username in Settings
  // (same ownership rule the My Mares tab uses), with their herd tags attached.
  function ownedHorses(state) {
    var myName = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    if (!myName) return [];
    return Object.keys(state.horseInfo || {}).map(function (life) {
      return { lifeNumber: life, info: state.horseInfo[life], meta: herdMeta(state, life) };
    }).filter(function (h) {
      return h.info && String(h.info.ownerName || '').trim().toLowerCase() === myName;
    }).sort(function (a, b) { return String(a.info.name || '').localeCompare(String(b.info.name || '')); });
  }
  function isArchivedHorse(h) { return ARCHIVE_STATUSES.indexOf(h.meta.status) > -1; }
  // Archived horses are left out of the headline numbers; foals born counts
  // every owned mare, archived or not, since a foal is a permanent result.
  function herdStats(horses, state) {
    var active = horses.filter(function (h) { return !isArchivedHorse(h); });
    var out = { total: active.length, mares: 0, stallions: 0, other: 0, pregnant: 0, breeds: 0, avgGp: null, foalsBorn: 0 };
    var breeds = {}, gpSum = 0, gpCount = 0;
    active.forEach(function (h) {
      var info = h.info;
      if (info.sex === 'mare') out.mares++;
      else if (info.sex === 'stallion') out.stallions++;
      else out.other++;
      if (info.pregnancy && String(info.pregnancy.status || '').indexOf('Pregnant') === 0) out.pregnant++;
      if (info.breed) breeds[info.breed] = true;
      if (info.geneticPotential != null) { gpSum += Number(info.geneticPotential); gpCount++; }
    });
    out.breeds = Object.keys(breeds).length;
    out.avgGp = gpCount ? Math.round(gpSum / gpCount) : null;
    var ownedLives = {};
    horses.forEach(function (h) { ownedLives[h.lifeNumber] = true; });
    (state.stallions || []).forEach(function (s) {
      ((state.breedings && state.breedings[s.id]) || []).forEach(function (b) {
        if (b.status === 'Foal Born' && b.mareLifeNumber && ownedLives[b.mareLifeNumber]) out.foalsBorn++;
      });
    });
    return out;
  }

  // ---------- foal calculator: pedigree + inbreeding ----------
  // Ancestors of one horse, up to maxGen generations behind it (its parents
  // are generation 1; the horse itself is generation 0 so a parent that is
  // also an ancestor of the other parent is caught). Parents come from the
  // horse's own captured pedigree tree when it has one, otherwise by
  // chaining through other cached horses. `gaps` lists ancestors whose
  // parents we couldn't look up at all (not cached) — distinct from a cached
  // horse that simply has no recorded parents (a founder), which isn't a gap.
  function ancestorMap(state, rootLife, maxGen) {
    var horseInfo = (state && state.horseInfo) || {};
    var found = {}, gaps = [], depth = 0;
    function note(life, gen) {
      (found[life] = found[life] || []).push(gen);
      if (gen > depth) depth = gen;
    }
    function walk(life, node, gen) {
      var cached = horseInfo[life];
      node = node || (cached && cached.pedigreeTree) || null;
      var sNode = node && node.s ? node.s : null, dNode = node && node.d ? node.d : null;
      var sLife = sNode ? sNode.l : (cached && cached.sire && cached.sire.lifeNumber) || null;
      var dLife = dNode ? dNode.l : (cached && cached.dam && cached.dam.lifeNumber) || null;
      if (gen >= maxGen) return;
      if (!sLife && !dLife && !cached && !node) { if (gen > 0) gaps.push({ life: life, gen: gen }); return; }
      if (sLife) { note(sLife, gen + 1); walk(sLife, sNode, gen + 1); }
      if (dLife) { note(dLife, gen + 1); walk(dLife, dNode, gen + 1); }
    }
    note(rootLife, 0);
    walk(rootLife, null, 0);
    return { found: found, gaps: gaps, depth: depth };
  }
  function commonAncestors(a, b) {
    return Object.keys(a.found).filter(function (life) { return b.found[life]; }).map(function (life) {
      return { life: life, gensA: a.found[life], gensB: b.found[life] };
    }).sort(function (x, y) { return Math.min.apply(null, x.gensA.concat(x.gensB)) - Math.min.apply(null, y.gensA.concat(y.gensB)); });
  }
  // Wright's path formula, summed over every path pair through each common
  // ancestor: (1/2)^(n1+n2+1). Ignores the ancestors' own inbreeding, so it
  // is an estimate (lower bound), not Horse Reality's own COI figure.
  function estimateCoi(common) {
    var total = 0;
    common.forEach(function (c) {
      c.gensA.forEach(function (n1) { c.gensB.forEach(function (n2) { total += Math.pow(0.5, n1 + n2 + 1); }); });
    });
    return total * 100;
  }
  function ancestorName(state, life) {
    var horseInfo = (state && state.horseInfo) || {};
    if (horseInfo[life] && horseInfo[life].name) return horseInfo[life].name;
    var keys = Object.keys(horseInfo);
    for (var i = 0; i < keys.length; i++) {
      var names = horseInfo[keys[i]].pedigreeNames;
      if (names && names[life]) return names[life];
    }
    return '';
  }

  global.HRLib = {
    ancestorMap: ancestorMap,
    commonAncestors: commonAncestors,
    estimateCoi: estimateCoi,
    ancestorName: ancestorName,
    HERD_STATUSES: HERD_STATUSES,
    HERD_ROLES: HERD_ROLES,
    ARCHIVE_STATUSES: ARCHIVE_STATUSES,
    herdStatusClass: herdStatusClass,
    herdMeta: herdMeta,
    ownedHorses: ownedHorses,
    isArchivedHorse: isArchivedHorse,
    herdStats: herdStats,
    CURRENCIES: CURRENCIES,
    STATUS_OPTIONS: STATUS_OPTIONS,
    esc: esc,
    fmtMoney: fmtMoney,
    moneyLine: moneyLine,
    feeObj: feeObj,
    hasAny: hasAny,
    fmtDate: fmtDate,
    todayStr: todayStr,
    uid: uid,
    statusPillClass: statusPillClass,
    stallionStatusClass: stallionStatusClass,
    safeUrl: safeUrl,
    mareKey: mareKey,
    breedingMatchKey: breedingMatchKey,
    findStallionMatch: findStallionMatch,
    daysSince: daysSince,
    findReviewCandidates: findReviewCandidates
  };
})(typeof window !== 'undefined' ? window : this);
