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
  // dateOfBirth is cached as a formatted string ("05 Mar 2023", see
  // content.js's formatBirthdate) rather than a raw ISO value, but that's
  // still enough for the JS Date parser to work with. Returns null when the
  // birthdate isn't known so callers can fall back to "assume adult" rather
  // than wrongly hiding a horse with no cached passport.
  //
  // Horse Reality ages horses on an accelerated in-game clock, not real
  // calendar time: 1 game month per 32 real hours (1 game year per 16 real
  // days), calculated from each horse's own birth timestamp — see
  // https://horsereality.wiki/en/Horses/Basics/Life and
  // https://horsereality.wiki/en/World/World-Basics/Automatic-Tasks.
  // Players can also pay Delta Points to age a horse up early, which this
  // formula can't see — that's what the manual aged-up override is for.
  var GAME_MS_PER_MONTH = 32 * 3600 * 1000;
  function ageYears(dateOfBirth) {
    if (!dateOfBirth) return null;
    var d = new Date(dateOfBirth);
    if (isNaN(d.getTime())) return null;
    var ms = Date.now() - d.getTime();
    if (ms < 0) return null;
    return (ms / GAME_MS_PER_MONTH) / 12;
  }
  function isYoungHorse(dateOfBirth) {
    var age = ageYears(dateOfBirth);
    return age != null && age < 3;
  }
  // Horse Reality doesn't always give us a birthdate (a horse only gets one
  // cached once you've viewed its own passport page), and even when it does,
  // players sometimes want to correct or track age by hand. `manualAgeMonths`
  // on a horseInfo record, once set, overrides the birthdate-derived age
  // entirely — "aging up" a horse just bumps that number by 6 months.
  function effectiveAgeYears(info) {
    if (!info) return null;
    if (info.manualAgeMonths != null) return info.manualAgeMonths / 12;
    return ageYears(info.dateOfBirth);
  }
  // Whole-months version of the above — avoids float rounding surprises
  // right at the 3-year (36 month) boundary, and is what the "aged up"
  // controls add/subtract/set against.
  function effectiveAgeMonths(info) {
    if (!info) return null;
    if (info.manualAgeMonths != null) return info.manualAgeMonths;
    var y = ageYears(info.dateOfBirth);
    return y == null ? null : Math.round(y * 12);
  }
  function formatAgeMonths(months) {
    if (months == null) return '';
    var y = Math.floor(months / 12);
    var m = months % 12;
    return y + ' yr' + (y === 1 ? '' : 's') + (m ? ', ' + m + ' mo' : '');
  }
  function isYoungInfo(info) {
    var months = effectiveAgeMonths(info);
    return months != null && months < 36;
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
    ageYears: ageYears,
    isYoungHorse: isYoungHorse,
    effectiveAgeYears: effectiveAgeYears,
    effectiveAgeMonths: effectiveAgeMonths,
    formatAgeMonths: formatAgeMonths,
    isYoungInfo: isYoungInfo,
    findReviewCandidates: findReviewCandidates
  };
})(typeof window !== 'undefined' ? window : this);
