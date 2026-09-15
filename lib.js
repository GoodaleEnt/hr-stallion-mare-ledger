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

  global.HRLib = {
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
