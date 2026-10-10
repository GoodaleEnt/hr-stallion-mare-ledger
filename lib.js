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
  // Results that are slow to work out and are asked for many times about the same ledger (the herd, what has been learned,
  // price comparisons) are remembered for a state object marked stable. Only code that will not change the state marks it
  // (the page scripts do, for the copy they only read), so the dashboard, which edits its state, never gets a stale answer.
  var MEMO = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function markStable(state) { try { Object.defineProperty(state, '__stable', { value: true, enumerable: false, configurable: true }); } catch (e) { /* frozen */ } return state; }
  function memo(state, key, fn) {
    if (!MEMO || !state || !state.__stable) return fn();
    var m = MEMO.get(state);
    if (!m) { m = {}; MEMO.set(state, m); }
    if (!Object.prototype.hasOwnProperty.call(m, key)) m[key] = fn();
    return m[key];
  }
  function ageYears(dateOfBirth, birthAt) {
    if (birthAt) { var bm = Date.now() - birthAt; return bm < 0 ? null : (bm / GAME_MS_PER_MONTH) / 12; }
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
  // Three sources of age, in priority order:
  //  1. `ageMonths` — scraped straight off Horse Reality's own horse page
  //     (see parseAgeText below), which is ground truth: it already
  //     accounts for aging boosts/Delta Points a birthdate calc can't see.
  //  2. `manualAgeMonths` — a player's own correction/tracking, for a horse
  //     whose own page hasn't been visited yet (so #1 isn't available).
  //  3. A birthdate-derived estimate, only as a last resort — Horse Reality
  //     ages horses on its own accelerated clock, so this is approximate.
  function effectiveAgeMonths(info) {
    if (!info) return null;
    if (info.ageMonths != null) {
      // The age read off the page is only true on the day it was read. A game month is 32 real hours, so move it
      // forward by the time since then. With the official birth time the month boundary is exact; without it the
      // result can be one month behind.
      if (!info.ageAt) return info.ageMonths;
      var elapsed = Math.max(0, Date.now() - info.ageAt);
      var phase = info.birthAt ? (((info.ageAt - info.birthAt) % GAME_MS_PER_MONTH) + GAME_MS_PER_MONTH) % GAME_MS_PER_MONTH : 0;
      return info.ageMonths + Math.floor((phase + elapsed) / GAME_MS_PER_MONTH);
    }
    // a horse its owner aged up (with Delta Points): the age by birth date plus the months it was aged up by
    if (info.agedUpMonths != null) {
      var yb = ageYears(info.dateOfBirth, info.birthAt);
      if (yb != null) return Math.round(yb * 12) + Number(info.agedUpMonths);
    }
    if (info.manualAgeMonths != null) return info.manualAgeMonths;
    var y = ageYears(info.dateOfBirth, info.birthAt);
    return y == null ? null : Math.round(y * 12);
  }
  function effectiveAgeYears(info) {
    var months = effectiveAgeMonths(info);
    return months == null ? null : months / 12;
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
  // Horse Reality's own horse page renders the true, authoritative age
  // (e.g. "3 years 1 month" — it accounts for aging boosts/Delta Points
  // that a birthdate-based estimate can't see) in a `#age` element that
  // content.js scrapes directly rather than trying to compute it. Parses
  // that text into whole months; returns null if it can't be read.
  function parseAgeText(text) {
    if (!text) return null;
    // "9 years, 2 months", "9yr 2mo", "3 yrs, 7 mo", "7 years"
    var y = /(\d+)\s*(?:years?|yrs?)\b/i.exec(text);
    var m = /(\d+)\s*(?:months?|mos?)\b/i.exec(text);
    if (!y && !m) return null;
    return (y ? parseInt(y[1], 10) : 0) * 12 + (m ? parseInt(m[1], 10) : 0);
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
  var HERD_ROLES = ['Broodmare', 'Public Stud', 'Private Stud', 'Public & Private Stud', 'Competition', 'Young Stock'];
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
    return { status: m.status || 'Active', role: m.role || '', project: m.project || '', confScores: Array.isArray(m.confScores) ? m.confScores : [], confBest: Number(m.confBest) || 0 };
  }
  // Highest conformation show score: the all-time best captured from the
  // horse's stats page (only ever raised, so it outlives the 25-show list)
  // or the highest hand-entered score, whichever is greater.
  function bestConformation(meta) {
    var scores = (meta && meta.confScores) || [];
    var typed = scores.length ? Math.max.apply(null, scores) : 0;
    var captured = Number(meta && meta.confBest) || 0;
    return { best: Math.max(typed, captured), fromPage: captured >= typed && captured > 0, shows: scores.length };
  }

  // Cached horses whose API-reported owner matches the username in Settings
  // (same ownership rule the My Mares tab uses), with their herd tags attached.
  function ownedHorses(state) { return memo(state, 'owned', function () { return ownedHorsesRaw(state); }); }
  function ownedHorsesRaw(state) {
    var myName = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    if (!myName) return [];
    return Object.keys(state.horseInfo || {}).map(function (life) {
      return { lifeNumber: life, info: state.horseInfo[life], meta: herdMeta(state, life) };
    }).filter(function (h) {
      return h.info && String(h.info.ownerName || '').trim().toLowerCase() === myName;
    }).sort(function (a, b) { return String(a.info.name || '').localeCompare(String(b.info.name || '')); });
  }
  // Horses you chose to add from the "add to ledger?" prompt that the API
  // says someone else owns — kept apart from your own herd.
  function trackedOtherHorses(state) {
    var myName = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    return Object.keys(state.horseMeta || {}).filter(function (life) {
      var info = state.horseInfo && state.horseInfo[life];
      return state.horseMeta[life].tracked && info && String(info.ownerName || '').trim().toLowerCase() !== myName;
    }).map(function (life) { return Object.assign({ lifeNumber: life }, state.horseInfo[life]); })
      .sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
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

  // Makes sure every cached stallion whose passport names you as owner has a
  // proper (owned) stallion record. Needed because content.js only creates one
  // at the moment you view his page: a horse cached BEFORE you set your
  // username (or saved as an owned:false stub first) would otherwise never
  // reach the Stallions tab. Returns how many records were added or promoted.
  function adoptOwnedStallions(state) {
    var myName = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    if (!myName) return 0;
    var n = 0;
    Object.keys(state.horseInfo || {}).forEach(function (life) {
      var info = state.horseInfo[life];
      if (!info || info.sex !== 'stallion' || String(info.ownerName || '').trim().toLowerCase() !== myName) return;
      var matchId = findStallionMatch(state.stallions || [], { stallionName: info.name, stallionLifeNumber: life });
      var rec = matchId ? state.stallions.find(function (x) { return x.id === matchId; }) : null;
      if (rec) {
        if (rec.owned === false) { rec.owned = true; n++; }
        return;
      }
      var id = uid();
      state.stallions.push({ id: id, createdAt: Date.now(), status: 'Active', name: info.name || ('#' + life), lifeNumber: life, breed: info.breed || '', imageUrl: info.imageUrl || '' });
      if (!state.breedings) state.breedings = {};
      state.breedings[id] = [];
      n++;
    });
    return n;
  }

  // ---------- coat colour odds ----------
  // Horse Reality's "tested colours" text is a run of two-allele genotypes,
  // e.g. "Ee Aa gg Dnd2 LPLP PATN1patn1". Each parent passes one allele per
  // gene with equal chance, genes assumed inherited independently. Only genes
  // tested in BOTH parents are calculated — an untested gene is unknown, not
  // assumed absent.
  var COLOUR_LOCI = [
    { id: 'E', name: 'Extension (E)', alleles: ['E', 'e'] },
    // Horse Reality's test shows only A or a. The wild bay (A+) and seal brown (At) alleles are hidden and show up
    // as A, so they can only be entered by hand. Dominance: A+ > A > At > a.
    { id: 'A', name: 'Agouti (A)', alleles: ['A+', 'A', 'At', 'a'] },
    // A gene Horse Reality doesn't list for a horse was not tested, and is treated as not there (`absent`).
    // Only Extension and Agouti, which decide the base colour, are left unknown when untested.
    { id: 'CR', name: 'Cream (CR)', alleles: ['CR', 'n'], absent: ['n', 'n'] },
    { id: 'D', name: 'Dun (D)', alleles: ['D', 'nd1', 'nd2'], absent: ['nd2', 'nd2'] },
    { id: 'G', name: 'Grey (G)', alleles: ['G', 'g'], absent: ['g', 'g'] },
    { id: 'LP', name: 'Leopard complex (LP)', alleles: ['LP', 'lp'], absent: ['lp', 'lp'] },
    { id: 'PATN1', name: 'Pattern-1 (PATN1)', alleles: ['PATN1', 'patn1'], absent: ['patn1', 'patn1'] },
    { id: 'SW1', name: 'Splashed white (SW1)', alleles: ['SW1', 'n'], absent: ['n', 'n'] },
    { id: 'W20', name: 'White spotting (W20)', alleles: ['W20', 'n'], absent: ['n', 'n'] }
  ];
  // Genes Horse Reality's tested-colours text doesn't report, entered by hand
  // per horse (stored in state.horseMeta[life].genes) — and parsed from the
  // text too if it ever does list them. `only` limits where a modifier shows.
  // Modelled as simple dominant (or, for Flaxen, recessive) genes; real-world
  // interactions beyond that are not simulated.
  var EXTRA_LOCI = [
    // Sooty shows on a black-based coat (EE or Ee) with one copy, but on a chestnut (ee) it needs two (one copy is only a
    // carrier). It cannot be seen on a foal until the foal turns 3.
    { id: 'STY', name: 'Sooty (STY)', alleles: ['STY', 'n'], absent: ['n', 'n'], label: 'Sooty', sooty: true },
    { id: 'FL', name: 'Flaxen (F)', alleles: ['F', 'f'], absent: ['F', 'F'], recessive: true, label: 'Flaxen', only: 'chestnut' },
    { id: 'Z', name: 'Silver (Z)', alleles: ['Z', 'n'], absent: ['n', 'n'], label: 'Silver', only: 'blackBased' },
    { id: 'CH', name: 'Champagne (Ch)', alleles: ['Ch', 'n'], absent: ['n', 'n'], label: 'Champagne' },
    { id: 'RN', name: 'Roan (Rn)', alleles: ['Rn', 'rn'], absent: ['rn', 'rn'], label: 'Roan' },
    { id: 'TO', name: 'Tobiano (TO)', alleles: ['TO', 'to'], absent: ['to', 'to'], label: 'Tobiano' },
    { id: 'SB1', name: 'Sabino 1 (SB1)', alleles: ['SB1', 'n'], absent: ['n', 'n'], label: 'Sabino' }
  ];
  var ALL_LOCI = COLOUR_LOCI.concat(EXTRA_LOCI);
  function extraGenotypeOptions(locus) {
    var a = locus.alleles, out = [];
    for (var i = 0; i < a.length; i++) for (var j = i; j < a.length; j++) out.push(a[i] + '/' + a[j]);
    return out;
  }
  // Genes that can be entered by hand for a horse: the extra genes, plus W20 (white spotting) and the hidden
  // agouti alleles (A+ wild bay, At seal brown).
  var MANUAL_LOCI = EXTRA_LOCI.concat(COLOUR_LOCI.filter(function (l) { return l.id === 'W20' || l.id === 'A'; }));
  // The plain A / a form of an agouti genotype (A+ and At are what the game shows as A).
  function agoutiPlain(al) { return al.map(function (x) { return x === 'a' ? 'a' : 'A'; }).sort(); }
  function agoutiCompatible(tested, manual) {
    return !tested || agoutiPlain(tested).join() === agoutiPlain(manual).join();
  }
  // Flaxen is written ff (shows flaxen), Ff (carrier) and FF (not there). Genotypes saved before that as Fl / fl are read as F / f.
  function normGeneText(locusId, text) {
    var map = locusId === 'FL' ? { Fl: 'F', fl: 'f' } : locusId === 'STY' ? { Sty: 'STY', sty: 'n' } : null;
    if (!map) return String(text || '');
    return String(text || '').split('/').map(function (p) { return map[p] || p; }).join('/');
  }
  // How a genotype is written: flaxen as FF / Ff / ff, the others as "a / b"
  function genotypeText(locus, alleles) {
    if (locus && locus.id === 'FL') return alleles.slice().sort(function (a, b) { return a === b ? 0 : a === 'F' ? -1 : 1; }).join('');
    return alleles.join(' / ');
  }
  // What a choice in the gene editor says
  function genotypeOptionLabel(locus, g) {
    var parts = g.split('/');
    if (locus.id === 'FL' && parts.indexOf('?') === -1) {
      var t = genotypeText(locus, parts);
      return t + (t === 'ff' ? ' (shows flaxen)' : t === 'Ff' ? ' (carrier)' : ' (not present)');
    }
    if (locus.id === 'STY' && parts.indexOf('?') === -1) {
      var n = parts.filter(function (x) { return x === 'STY'; }).length;
      return g.replace('/', ' / ') + (n === 2 ? ' (sooty on any coat)' : n === 1 ? ' (sooty on a black-based coat, carrier on chestnut)' : ' (not present)');
    }
    return g.replace('/', ' / ');
  }
  // Does the gene show on a coat? black-based = EE or Ee. Sooty shows with one copy on a black-based coat and needs two on a
  // chestnut; flaxen only shows on a chestnut; silver only on a black-based coat. blackBased null = base not known.
  function sootyShows(alleles, blackBased) {
    var c = copies(alleles, 'STY');
    return c === 2 || (c === 1 && blackBased === true);
  }
  // Hand-entered genotypes for one horse, validated against the gene table.
  function manualGenes(state, lifeNumber) {
    var saved = (state.horseMeta && state.horseMeta[lifeNumber] && state.horseMeta[lifeNumber].genes) || {};
    var out = {};
    MANUAL_LOCI.forEach(function (l) {
      var parts = normGeneText(l.id, saved[l.id]).split('/');
      if (parts.length === 2 && l.alleles.indexOf(parts[0]) > -1 && l.alleles.indexOf(parts[1]) > -1) out[l.id] = parts;
    });
    return out;
  }
  // Hidden genes you are not sure of: a "?" in place of one allele ("?/n" = one copy of n, the other not known). They are
  // kept apart from the confirmed genotypes (so the colour odds are not changed) and count as a possible gene: the preferred
  // genes lists show them, and the chance a foal gets a gene counts a suspected copy as a coin toss.
  function suspectedGenes(state, lifeNumber) {
    var saved = (state.horseMeta && state.horseMeta[lifeNumber] && state.horseMeta[lifeNumber].genes) || {};
    var out = {};
    MANUAL_LOCI.forEach(function (l) {
      var parts = normGeneText(l.id, saved[l.id]).split('/');
      if (parts.length !== 2 || parts.indexOf('?') === -1 || (parts[0] === '?' && parts[1] === '?')) return;
      var known = parts[0] === '?' ? parts[1] : parts[0];
      if (l.alleles.indexOf(known) > -1) out[l.id] = parts;
    });
    return out;
  }
  function suspectedGenotypeOptions(locus) { return locus.alleles.map(function (a) { return '?/' + a; }); }
  // Peacock: whether it is expressed and your own estimate of how strong the line is (0 to 100); horseMeta[life].peacock
  function peacockOf(state, life) {
    var p = state && state.horseMeta && state.horseMeta[life] && state.horseMeta[life].peacock;
    if (!p || !p.expressed) return null;
    var s = Number(p.strength);
    return { expressed: true, strength: isFinite(s) && s >= 0 ? Math.min(100, s) : null };
  }
  function splitAlleles(token, alleles) {
    var sorted = alleles.slice().sort(function (a, b) { return b.length - a.length; });
    var out = [], rest = token;
    while (rest && out.length < 2) {
      var hit = sorted.find(function (a) { return rest.indexOf(a) === 0; });
      if (!hit) return null;
      out.push(hit);
      rest = rest.slice(hit.length);
    }
    return (out.length === 2 && !rest) ? out : null;
  }
  // Splits the text into one token per gene. A genotype written with a separator ("PATN1/patn1",
  // "PATN1, patn1") is joined first, and stray punctuation is dropped.
  function colourTokens(text) {
    return String(text || '').replace(/\s*[\/|,;]\s*/g, '').split(/\s+/).map(function (t) { return t.replace(/[^A-Za-z0-9]/g, ''); }).filter(Boolean);
  }
  // Tokens of the tested-colours text that matched no gene (so the screen can show what was skipped).
  function unreadColourTokens(text) {
    return colourTokens(text).filter(function (tok) {
      return !ALL_LOCI.some(function (l) { return splitAlleles(tok, l.alleles); });
    });
  }
  function parseColourGenes(text) {
    var out = {};
    colourTokens(text).forEach(function (tok) {
      for (var i = 0; i < ALL_LOCI.length; i++) {
        var al = splitAlleles(tok, ALL_LOCI[i].alleles);
        if (al) { out[ALL_LOCI[i].id] = al; return; }
      }
    });
    return out;
  }
  function foalDistribution(locus, sire, dam) {
    var d = {};
    sire.forEach(function (s) {
      dam.forEach(function (m) {
        var key = [s, m].sort(function (a, b) { return locus.alleles.indexOf(a) - locus.alleles.indexOf(b); }).join('/');
        d[key] = (d[key] || 0) + 0.25;
      });
    });
    return Object.keys(d).map(function (k) { return { genotype: k, alleles: k.split('/'), p: d[k] }; })
      .sort(function (a, b) { return b.p - a.p; });
  }
  function copies(alleles, a) { return alleles.filter(function (x) { return x === a; }).length; }
  function geneEffect(id, al) {
    var c;
    if (id === 'E') return al.indexOf('E') > -1 ? 'black-based' : 'red (chestnut) base';
    if (id === 'A') return al.indexOf('A+') > -1 ? 'wild bay (A+), bay if black-based' : al.indexOf('A') > -1 ? 'bay if black-based' : al.indexOf('At') > -1 ? 'seal brown (At), if black-based' : 'no agouti (black if black-based)';
    if (id === 'CR') { c = copies(al, 'CR'); return c === 0 ? 'no cream' : (c === 1 ? 'one cream copy' : 'double cream'); }
    if (id === 'D') return al.indexOf('D') > -1 ? 'dun' : (al.indexOf('nd1') > -1 ? 'pseudo dun (nd1, primitive markings)' : 'non-dun');
    if (id === 'G') return al.indexOf('G') > -1 ? 'grey' : 'not grey';
    if (id === 'LP') { c = copies(al, 'LP'); return c === 0 ? 'no leopard complex' : (c === 1 ? 'one LP copy' : 'two LP copies'); }
    if (id === 'PATN1') { c = copies(al, 'PATN1'); return c === 0 ? 'no PATN1' : (c === 1 ? 'one PATN1 copy' : 'two PATN1 copies'); }
    var extra = EXTRA_LOCI.find(function (l) { return l.id === id; });
    if (extra && extra.sooty) { c = copies(al, 'STY'); return c === 2 ? 'sooty' : c === 1 ? 'sooty if black-based, carrier on chestnut' : 'no sooty'; }
    if (extra) {
      var shown = extra.recessive ? copies(al, extra.alleles[1]) === 2 : al.indexOf(extra.alleles[0]) > -1;
      return shown ? extra.label.toLowerCase() : 'no ' + extra.label.toLowerCase();
    }
    c = copies(al, id);
    return c === 0 ? 'none' : (c === 1 ? 'one copy' : 'two copies');
  }
  // Used when Extension (E) isn't known on both parents: the base colour can't
  // be named, but the other known genes can still be combined and reported.
  function modifiersOnlyLabel(g) {
    var parts = [];
    if (g.CR && copies(g.CR, 'CR')) parts.push(copies(g.CR, 'CR') === 1 ? 'one cream copy' : 'double cream');
    if (g.D && g.D.indexOf('D') > -1) parts.push('Dun');
    else if (g.D && g.D.indexOf('nd1') > -1) parts.push('Pseudo Dun');
    EXTRA_LOCI.forEach(function (l) {
      var al = g[l.id];
      if (!al || l.only) return;
      var expressed = l.sooty ? sootyShows(al, null) : (l.recessive ? copies(al, l.alleles[1]) === 2 : al.indexOf(l.alleles[0]) > -1);
      if (expressed) parts.push(l.label);
    });
    var name = 'Base colour unknown' + (parts.length ? ' + ' + parts.join(' + ') : '');
    if (g.G && g.G.indexOf('G') > -1) name = 'Grey (born ' + name + ')';
    return name;
  }
  function baseColourLabel(g) {
    if (!g.E) return modifiersOnlyLabel(g);
    var hasAgouti = !!g.A && (g.A.indexOf('A') > -1 || g.A.indexOf('A+') > -1 || g.A.indexOf('At') > -1);
    var base = g.E.indexOf('E') === -1 ? 'chestnut' : (!g.A ? 'blackBased' : (hasAgouti ? 'bay' : 'black'));
    // Bay comes in three shades: wild bay (A+ present), bay, and seal brown (At only, with At or a).
    var shade = '';
    if (base === 'bay') shade = g.A.indexOf('A+') > -1 ? 'wild' : (g.A.indexOf('A') === -1 && g.A.indexOf('At') > -1 ? 'seal' : '');
    var names = {
      chestnut: ['Chestnut', 'Palomino', 'Cremello'],
      bay: shade === 'wild' ? ['Wild Bay', 'Wild Buckskin', 'Wild Perlino'] : shade === 'seal' ? ['Seal Brown', 'Brown Buckskin', 'Brown Perlino'] : ['Bay', 'Buckskin', 'Perlino'],
      black: ['Black', 'Smokey Black', 'Smokey Cream'],
      blackBased: ['Bay or Black', 'Buckskin or Smokey Black', 'Perlino or Smokey Cream']
    };
    // A dun coat without cream has its own names; with cream it is added to the cream name.
    var dunNames = { chestnut: 'Red Dun', bay: shade === 'wild' ? 'Wild Bay Dun' : shade === 'seal' ? 'Seal Brown Dun' : 'Dun', black: 'Grulla', blackBased: 'Dun or Grulla' };
    var cream = g.CR ? copies(g.CR, 'CR') : 0;
    var name = names[base][cream];
    if (g.D && g.D.indexOf('D') > -1) name = cream ? name + ' Dun' : dunNames[base];
    else if (g.D && g.D.indexOf('nd1') > -1) name += ' Pseudo Dun';
    var blackBased = g.E.indexOf('E') > -1;
    EXTRA_LOCI.forEach(function (l) {
      var al = g[l.id];
      if (!al) return;
      var expressed = l.sooty ? sootyShows(al, blackBased) : (l.recessive ? copies(al, l.alleles[1]) === 2 : al.indexOf(l.alleles[0]) > -1);
      if (!expressed) return;
      if (l.only === 'chestnut' && blackBased) return;
      if (l.only === 'blackBased' && !blackBased) return;
      name += ' ' + l.label;
    });
    if (g.G && g.G.indexOf('G') > -1) name = 'Grey (born ' + name + ')';
    return name;
  }
  function patternLabel(g) {
    var lp = copies(g.LP, 'LP');
    if (lp === 0) return 'No Appaloosa pattern (no LP)';
    if (!g.PATN1) return lp === 1 ? 'Appaloosa pattern possible (one LP copy; PATN1 untested)' : 'Appaloosa pattern possible (two LP copies; PATN1 untested)';
    var patn = copies(g.PATN1, 'PATN1');
    if (patn === 0) return 'LP without PATN1 (varnish roan / minimal pattern)';
    if (lp === 2 && patn === 2) return 'Few-spot / no-spot (LP and PATN1 both homozygous)';
    return 'Leopard spotting (LP + PATN1)';
  }
  function enumerateOutcomes(dist, ids, labelFn) {
    var results = {};
    (function rec(i, p, genos) {
      if (i === ids.length) { var label = labelFn(genos); results[label] = (results[label] || 0) + p; return; }
      dist[ids[i]].forEach(function (o) {
        var next = Object.assign({}, genos);
        next[ids[i]] = o.alleles;
        rec(i + 1, p * o.p, next);
      });
    })(0, 1, {});
    return Object.keys(results).map(function (k) { return { label: k, pct: results[k] * 100 }; })
      .sort(function (a, b) { return b.pct - a.pct; });
  }
  // How a gene will show in the foal: visible, carried without showing, or not present at all (percent chances).
  // A recessive gene shows with two copies and is carried with one; a gene that needs a base colour (flaxen only shows
  // on chestnut, silver only on black-based, agouti's a only on black-based) is carried when the base is wrong;
  // PATN1 only shows together with LP. ctx holds the chance of those base colours / LP.
  function visibilityOf(l, d, ctx) {
    var v = 0, c = 0, n = 0;
    d.forEach(function (o) {
      var al = o.alleles, p = o.p, k;
      if (l.id === 'E') {
        k = copies(al, 'E');
        if (k === 0) v += p; else if (k === 1) c += p; else n += p;
      } else if (l.id === 'A') {
        k = copies(al, 'a');
        if (k === 2) { var pb = ctx.pBlack == null ? 1 : ctx.pBlack; v += p * pb; c += p * (1 - pb); } else if (k === 1) c += p; else n += p;
      } else if (l.id === 'D') {
        if (al.indexOf('D') > -1 || al.indexOf('nd1') > -1) v += p; else n += p;
      } else if (l.id === 'PATN1') {
        if (al.indexOf('PATN1') > -1) { var pl = ctx.pLP == null ? 1 : ctx.pLP; v += p * pl; c += p * (1 - pl); } else n += p;
      } else if (l.recessive) {
        k = copies(al, l.alleles[1]);
        if (k === 2) { var pc = l.only === 'chestnut' && ctx.pChest != null ? ctx.pChest : 1; v += p * pc; c += p * (1 - pc); } else if (k === 1) c += p; else n += p;
      } else if (l.sooty) {
        k = copies(al, 'STY');
        if (k === 2) v += p; else if (k === 1) { var pbs = ctx.pBlack == null ? 1 : ctx.pBlack; v += p * pbs; c += p * (1 - pbs); } else n += p;
      } else if (al.indexOf(l.alleles[0]) > -1) {
        var pd = l.only === 'blackBased' && ctx.pBlack != null ? ctx.pBlack : 1; v += p * pd; c += p * (1 - pd);
      } else n += p;
    });
    return { visible: v * 100, carrier: c * 100, none: n * 100 };
  }
  // Odds for a foal of sire x dam, from their "tested colours" strings.
  function colourOutcomes(sireText, damText, sireManual, damManual) {
    // Horse Reality's own tested result wins over a hand-entered one.
    // An extra gene nobody has set counts as NOT present on that parent.
    var sM = sireManual || {}, dM = damManual || {}, sP = parseColourGenes(sireText), dP = parseColourGenes(damText);
    var absent = {}, touched = {};
    ALL_LOCI.forEach(function (l) {
      if (!l.absent) return;
      absent[l.id] = l.absent.slice();
      touched[l.id] = !!(sM[l.id] || dM[l.id] || sP[l.id] || dP[l.id]);
    });
    var s = Object.assign({}, absent, sM, sP);
    var d = Object.assign({}, absent, dM, dP);
    // Hidden agouti alleles: a hand-entered genotype replaces the tested A / a when it agrees with it
    if (sM.A && agoutiCompatible(sP.A, sM.A)) s.A = sM.A;
    if (dM.A && agoutiCompatible(dP.A, dM.A)) d.A = dM.A;
    var dist = {}, untested = [];
    ALL_LOCI.forEach(function (l) {
      if (s[l.id] && d[l.id]) dist[l.id] = foalDistribution(l, s[l.id], d[l.id]);
      else if (!l.absent) untested.push(l.name);
    });
    var ctx = { pChest: null, pBlack: null, pLP: null };
    if (dist.E) { ctx.pChest = dist.E.reduce(function (t, o) { return t + (o.alleles.indexOf('E') === -1 ? o.p : 0); }, 0); ctx.pBlack = 1 - ctx.pChest; }
    if (dist.LP) ctx.pLP = dist.LP.reduce(function (t, o) { return t + (o.alleles.indexOf('LP') > -1 ? o.p : 0); }, 0);
    var genes = ALL_LOCI.filter(function (l) { return dist[l.id] && (!l.absent || touched[l.id]); }).map(function (l) {
      return { id: l.id, name: l.name, vis: visibilityOf(l, dist[l.id], ctx), outcomes: dist[l.id].map(function (o) {
        return { genotype: o.alleles.join(' / '), label: genotypeText(l, o.alleles), pct: o.p * 100, effect: geneEffect(l.id, o.alleles) };
      }) };
    });
    // Chance the foal actually shows each extra gene (a dominant one needs a
    // single copy; a recessive one — Flaxen — needs two), listed on its own so
    // it's visible even when the combined colour list can't be built.
    var extras = EXTRA_LOCI.filter(function (l) { return dist[l.id] && touched[l.id]; }).map(function (l) {
      var shown = 0;
      dist[l.id].forEach(function (o) {
        if (l.sooty) { var kk = copies(o.alleles, 'STY'); shown += o.p * (kk === 2 ? 1 : kk === 1 ? (ctx.pBlack == null ? 1 : ctx.pBlack) : 0); return; }
        var expressed = l.recessive ? copies(o.alleles, l.alleles[1]) === 2 : o.alleles.indexOf(l.alleles[0]) > -1;
        if (expressed) shown += o.p;
      });
      return {
        id: l.id, name: l.name, label: l.label, pct: shown * 100,
        note: l.sooty ? 'one copy shows on a black-based coat, a chestnut needs two; cannot be seen on a foal until it turns 3' : (l.only === 'chestnut' ? 'shows on chestnut coats only' : (l.only === 'blackBased' ? 'shows on black-based coats only' : '')),
        outcomes: dist[l.id].map(function (o) { return { genotype: o.alleles.join(' / '), label: genotypeText(l, o.alleles), pct: o.p * 100 }; })
      };
    });
    var colourIds = ['E', 'A', 'CR', 'D', 'G'].concat(EXTRA_LOCI.map(function (l) { return l.id; })).filter(function (id) { return dist[id]; });
    // Modifiers usable without a base colour (not A, not the base-dependent extras).
    var noBaseIds = ['CR', 'D', 'G'].concat(EXTRA_LOCI.filter(function (l) { return !l.only; }).map(function (l) { return l.id; })).filter(function (id) { return dist[id]; });
    var unread = unreadColourTokens(sireText).concat(unreadColourTokens(damText)).filter(function (t, i, a) { return a.indexOf(t) === i; });
    var patternIds = ['LP', 'PATN1'].filter(function (id) { return dist[id]; });
    var patternTested = !!(touched.LP || touched.PATN1);
    return {
      genes: genes,
      unread: unread,
      extras: extras,
      untested: untested,
      colours: dist.E ? enumerateOutcomes(dist, colourIds, baseColourLabel) : (noBaseIds.length ? enumerateOutcomes(dist, noBaseIds, baseColourLabel) : null),
      baseKnown: !!dist.E,
      patterns: patternTested ? enumerateOutcomes(dist, patternIds, patternLabel) : null
    };
  }

  // A horse's pedigree as a nested tree, `depth` generations deep, using the
  // same sources as ancestorMap (its captured pedigree tree, else chaining
  // through other cached horses). Each node: { life, name, cached, s?, d? }.
  function pedigreeTreeOf(state, life, depth, hintNode, hintName) {
    var horseInfo = (state && state.horseInfo) || {};
    var cached = horseInfo[life];
    var node = hintNode || (cached && cached.pedigreeTree) || null;
    var name = (cached && cached.name) || hintName || ancestorName(state, life) || '';
    if (name === String(life)) name = '';
    var out = { life: life, name: name, cached: !!cached };
    if (depth < 1) return out;
    var sNode = node && node.s ? node.s : null, dNode = node && node.d ? node.d : null;
    var sLife = sNode ? sNode.l : (cached && cached.sire && cached.sire.lifeNumber) || null;
    var dLife = dNode ? dNode.l : (cached && cached.dam && cached.dam.lifeNumber) || null;
    if (sLife) out.s = pedigreeTreeOf(state, sLife, depth - 1, sNode, cached && cached.sire && cached.sire.lifeNumber === sLife ? cached.sire.name : '');
    if (dLife) out.d = pedigreeTreeOf(state, dLife, depth - 1, dNode, cached && cached.dam && cached.dam.lifeNumber === dLife ? cached.dam.name : '');
    return out;
  }

  // Horse Reality's conformation summary, e.g. "2G 7A 3BA": how many of the
  // horse's traits are rated Good, Average and Below average.
  function parseConformation(text) {
    var out = { G: 0, A: 0, BA: 0, total: 0, ok: false };
    String(text || '').replace(/(\d+)\s*(BA|G|A)\b/g, function (m, n, code) {
      out[code] += parseInt(n, 10);
      out.ok = true;
      return m;
    });
    out.total = out.G + out.A + out.BA;
    return out;
  }

  // Breed Total (BT) = ((Genetic Potential / 10) + top conformation score) / 2.
  function breedTotal(gp, conf) {
    gp = Number(gp); conf = Number(conf);
    if (!gp || !conf) return 0;
    return Math.round(((gp / 10 + conf) / 2) * 1000) / 1000;
  }
  // Keeps each horse's all-time best BT (only ever raised, like the best
  // conformation score) together with when it was reached and what produced it.
  // Returns how many horses changed.
  function refreshBreedTotals(state) {
    var n = 0;
    if (!state.horseMeta) state.horseMeta = {};
    Object.keys(state.horseInfo || {}).forEach(function (life) {
      var info = state.horseInfo[life];
      var meta = state.horseMeta[life];
      if (!info || !meta || info.geneticPotential == null) return;
      var conf = bestConformation(meta).best;
      var bt = breedTotal(info.geneticPotential, conf);
      if (!bt || bt <= (Number(meta.btBest) || 0)) return;
      state.horseMeta[life] = Object.assign({}, meta, {
        btBest: bt, btBestAt: Date.now(), btBestGp: Number(info.geneticPotential), btBestConf: conf,
        btBestDate: meta.confBestDate || ''
      });
      n++;
    });
    return n;
  }
  // ---------- goals: horses worth a closer look ----------
  // state.settings.goals = { minConf, minBT, maxGP, maxG, maxA, maxBA }. A blank goal
  // is ignored. Each horse gets three sections - top conformation, Breed Total
  // and conformation traits - each 'ok' (meets the goal), 'bad' (doesn't) or
  // 'na' (no goal set, or no data yet). A horse is highlighted overall when it
  // has at least one goal and every set goal is met.
  var FERT_RANK = { poor: 0, fair: 1, average: 2, good: 3, excellent: 4 };
  function healthCounts(info) {
    var h = info && info.health;
    if (!h) return null;
    var c = { poor: 0, fair: 0, average: 0, good: 0, excellent: 0 };
    Object.keys(h).forEach(function (k) {
      var r = String(h[k]).toLowerCase().trim();
      if (c[r] != null) c[r]++;
    });
    return c;
  }
  // Goals can be one set for every horse, or (state.settings.goalsSplit) a separate set for mares and fillies
  // (settings.goalsMare) and for stallions and colts (settings.goalsStallion). sex is a horse's sex.
  function goalsKeyFor(state, sex) {
    var split = !!(state && state.settings && state.settings.goalsSplit);
    if (!split) return 'goals';
    return sex === 'stallion' ? 'goalsStallion' : sex === 'mare' ? 'goalsMare' : 'goals';
  }
  function goalsOf(state, sex) {
    var st = (state && state.settings) || {};
    var raw = st[goalsKeyFor(state, sex)];
    return normalizeGoals(raw || st.goals || {});
  }
  function normalizeGoals(g) {
    function num(v) { var x = parseFloat(v); return isFinite(x) && x >= 0 ? x : null; }
    var fert = String(g.minFert || '').toLowerCase();
    var traitWorst = ['GP', 'G', 'A', 'BA'].indexOf(g.traitWorst) > -1 ? g.traitWorst : null;
    var healthWorst = ['good', 'average', 'fair', 'poor'].indexOf(g.healthWorst) > -1 ? g.healthWorst : null;
    return {
      minFert: FERT_RANK[fert] != null ? fert : null,
      minConf: num(g.minConf), minBT: num(g.minBT), minGP: num(g.minGP),
      traitWorst: traitWorst, traitWorstMax: num(g.traitWorstMax),
      healthWorst: healthWorst, healthWorstMax: num(g.healthWorstMax)
    };
  }
  function anyGoals(state) {
    return ['mare', 'stallion'].some(function (sx) {
      var g = goalsOf(state, sx);
      return Object.keys(g).some(function (k) { return g[k] != null; });
    }) || (function () { var g = goalsOf(state); return Object.keys(g).some(function (k) { return g[k] != null; }); })();
  }
  function traitCounts(info) {
    var t = info && info.confTraits;
    if (!t) return info && info.tagCounts ? Object.assign({ VG: 0, GP: 0, G: 0, A: 0, BA: 0 }, info.tagCounts) : null;
    // Ratings: Very good (VG), Good+ (G+), Good (G), Average (A), Below average (BA).
    var c = { VG: 0, GP: 0, G: 0, A: 0, BA: 0 };
    Object.keys(t).forEach(function (k) {
      var r = String(t[k]).toLowerCase().trim();
      if (r.indexOf('below') === 0 || r === 'ba') c.BA++;
      else if (r.indexOf('very good') === 0 || r === 'vg') c.VG++;
      else if (r.indexOf('good') === 0 && r.indexOf('+') > -1) c.GP++;
      else if (r.indexOf('good') === 0 || r === 'g') c.G++;
      else if (r.indexOf('average') === 0 || r === 'a') c.A++;
    });
    return c;
  }
  function goalSections(state, life) {
    var info = (state.horseInfo && state.horseInfo[life]) || {};
    return goalSectionsWith(state, life, goalsOf(state, info.sex));
  }
  function goalSectionsWith(state, life, g) {
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var info = (state.horseInfo && state.horseInfo[life]) || {};
    var conf = bestConformation(meta).best;
    var bt = Math.max(Number(meta.btBest) || 0, breedTotal(info.geneticPotential, conf));
    function r3(n) { return Math.round(n * 1000) / 1000; }
    function minSection(label, goal, have) {
      if (goal == null) return { label: label, state: 'na', text: 'no goal' };
      if (!(have > 0)) return { label: label, state: 'na', text: 'no data yet' };
      return { label: label, state: have >= goal ? 'ok' : 'bad', text: r3(have) + ' (min ' + goal + ')' };
    }
    // "Worst rating I'll accept, and how many at that rating": passes when
    // nothing is rated worse than that rating and at most N sit exactly at it.
    function worstSection(label, order, counts, worstKey, max) {
      if (!worstKey) return { label: label, state: 'na', text: 'no goal' };
      if (!counts) return { label: label, state: 'na', text: 'no data yet' };
      var w = -1;
      order.forEach(function (o, i) { if (o[0] === worstKey) w = i; });
      var at = counts[worstKey] || 0, worse = 0;
      order.slice(w + 1).forEach(function (o) { worse += counts[o[0]] || 0; });
      var limit = max == null ? 0 : max;
      return {
        label: label,
        state: at <= limit && worse === 0 ? 'ok' : 'bad',
        text: order[w][1] + ' ' + at + ' (max ' + limit + ')' + (worse ? ', ' + worse + ' worse' : '')
      };
    }
    var traits = worstSection('Conformation traits',
      [['VG', 'VG'], ['GP', 'G+'], ['G', 'G'], ['A', 'A'], ['BA', 'BA']], traitCounts(info), g.traitWorst, g.traitWorstMax);
    var health = worstSection('Health',
      [['excellent', 'Excellent'], ['good', 'Good'], ['average', 'Average'], ['fair', 'Fair'], ['poor', 'Poor']], healthCounts(info), g.healthWorst, g.healthWorstMax);
    // Gold: more than 3 of the 5 health traits are Excellent.
    var hcAll = healthCounts(info);
    if (hcAll && hcAll.excellent > 3) { health.gold = true; health.goldText = hcAll.excellent + ' Excellent'; }
    var fertility = { label: 'Fertility', state: 'na', text: 'no goal' };
    if (g.minFert) {
      var fv = String((info && info.fertility) || '').toLowerCase().trim();
      if (FERT_RANK[fv] == null) {
        fertility.text = 'no data yet';
      } else {
        fertility.state = FERT_RANK[fv] >= FERT_RANK[g.minFert] ? 'ok' : 'bad';
        fertility.text = info.fertility + ' (min ' + g.minFert.charAt(0).toUpperCase() + g.minFert.slice(1) + ')';
      }
    }
    // Gold: fertility is Excellent.
    if (String((info && info.fertility) || '').toLowerCase().trim() === 'excellent') { fertility.gold = true; fertility.goldText = 'Excellent'; }
    // Fertility can only be tested from age 3: for a younger horse it is not part of the goals
    if (isYoungInfo(info)) fertility = { label: 'Fertility', state: 'na', text: 'tested from age 3', skip: true };
    return { conf: minSection('Conformation', g.minConf, conf), gp: minSection('Genetic Potential', g.minGP, Number(info.geneticPotential) || 0), bt: minSection('Breed Total', g.minBT, bt), traits: traits, health: health, fertility: fertility };
  }
  function goalCheck(state, life) {
    var s = goalSections(state, life);
    var list = [s.conf, s.gp, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.text !== 'no goal' && !x.skip; });
    return {
      active: list.length > 0,
      met: list.length > 0 && list.every(function (x) { return x.state === 'ok'; }),
      sections: s
    };
  }
  // The goal boxes a horse clearly misses (the red ones). A box with no data yet is not counted as a miss.
  function goalMisses(state, life) {
    var c = goalCheck(state, life);
    if (!c.active) return [];
    var s = c.sections;
    return [s.conf, s.gp, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'bad' && !x.skip; }).map(function (x) { return x.label; });
  }

  // ---------- where a mare stands: covered, or in foal ----------
  // 'pregnant' = her page says she is pregnant, or a breeding of hers succeeded and no foal has been
  // recorded for it yet. 'covered' = a covering within the last 7 days that has no result yet (Horse
  // Reality settles a covering within about 6 days). Otherwise ''.
  function mareBreedStatus(state, life) {
    life = String(life || '');
    var out = { status: '', date: '', due: '', stallion: '' };
    if (!life) return out;
    var info = state.horseInfo && state.horseInfo[life];
    var preg = !!(info && info.pregnancy && String(info.pregnancy.status || '').indexOf('Pregnant') === 0);
    var succeeded = false, covered = null;
    Object.keys(state.breedings || {}).forEach(function (sid) {
      var list = state.breedings[sid] || [];
      var hasFoal = list.some(function (b) { return String(b.mareLifeNumber) === life && b.status === 'Foal Born'; });
      list.forEach(function (b) {
        if (String(b.mareLifeNumber) !== life) return;
        var days = b.date ? daysSince(b.date) : 0;
        if (b.status === 'Succeeded' && !hasFoal && (days == null || days <= 400)) { succeeded = true; out.stallion = out.stallion || sid; }
        if (b.status === 'Pending' && (days == null || days <= 7)) {
          if (!covered || String(b.date || '') > String(covered.date || '')) covered = { date: b.date || '', sid: sid };
        }
      });
    });
    // the site's own pills (seen within the last 7 days) fill in what the ledger's records don't show
    var pills = info && Array.isArray(info.statusPills) ? info.statusPills : [];
    var fresh = !!(info && info.statusPillsAt && (Date.now() - info.statusPillsAt) < 7 * 86400000);
    var pillPreg = fresh && pills.some(function (p) { return p.indexOf('pregnan') > -1 || p.indexOf('foal') > -1; });
    var pillCovered = fresh && pills.some(function (p) { return p.indexOf('cover') > -1; });
    var apiCovered = !!(info && info.pregnancy && /cover/i.test(String(info.pregnancy.status || '')) && info.capturedAt && (Date.now() - info.capturedAt) < 8 * 86400000);
    var seenCover = info && info.coveredInfo && info.coveredInfo.seenAt && (Date.now() - info.coveredInfo.seenAt) < 8 * 86400000 ? info.coveredInfo : null;
    var nameOf = function (sid) { var s = (state.stallions || []).find(function (x) { return x.id === sid; }); return s ? s.name : ''; };
    if (preg || succeeded || pillPreg) {
      out.status = 'pregnant';
      out.due = preg && info.pregnancy.dueText ? info.pregnancy.dueText : '';
      out.stallion = nameOf(out.stallion) || (preg && info.pregnancy.sireName) || '';
    } else if (covered) {
      out.status = 'covered';
      out.date = covered.date;
      out.stallion = nameOf(covered.sid);
    } else if (pillCovered || apiCovered || seenCover) {
      out.status = 'covered';
      out.fromSite = true;
      if (seenCover) { out.date = seenCover.date || ''; out.stallion = seenCover.sireName || ''; }
    }
    return out;
  }

  // The mare's Info tab says "Covered 1 day ago" and names the sire. If that covering isn't in the ledger,
  // add it (under that stallion, an outside stud if needed); if it is but has no date, fill the date in.
  // c = { mareLife, mareName, sireLife, sireName, date }. Returns 'added', 'updated' or ''.
  function recordCoveringFromPage(state, c) {
    if (!c || !c.mareLife || !c.date || !isMyMare(state, String(c.mareLife))) return '';
    var life = String(c.mareLife);
    var near = function (b) { var d1 = b.date ? daysSince(b.date) : null, d2 = daysSince(c.date); return !b.date || d1 == null || d2 == null || Math.abs(d1 - d2) <= 2; };
    var existing = null;
    Object.keys(state.breedings || {}).forEach(function (sid) {
      (state.breedings[sid] || []).forEach(function (b) {
        if (!existing && String(b.mareLifeNumber) === life && (b.status === 'Pending' || b.status === 'Succeeded') && near(b)) existing = b;
      });
    });
    if (existing) {
      if (!existing.date) { existing.date = c.date; return 'updated'; }
      return '';
    }
    var sid = findStallionMatch(state.stallions || [], { stallionLifeNumber: c.sireLife, stallionName: c.sireName });
    if (!sid) {
      if (!c.sireName && !c.sireLife) return '';
      sid = uid();
      state.stallions.push({ id: sid, createdAt: Date.now(), status: 'Active', name: c.sireName || ('#' + c.sireLife), lifeNumber: c.sireLife ? String(c.sireLife) : '', owned: false });
      if (!state.breedings) state.breedings = {};
      state.breedings[sid] = [];
    }
    if (!state.breedings[sid]) state.breedings[sid] = [];
    var info = state.horseInfo && state.horseInfo[life];
    state.breedings[sid].push({
      id: uid(), createdAt: Date.now(),
      mareName: c.mareName || (info && info.name) || '', mareLifeNumber: life, mareUrl: 'https://www.horsereality.com/horses/' + life + '/',
      breederName: (state.settings && state.settings.myUsername) || '', breederUrl: '', price: null, currency: 'HRC', feeType: 'Public',
      date: c.date, status: 'Pending'
    });
    return 'added';
  }

  // ---------- breeding suggestions for one mare ----------
  // Every stallion saved in the ledger (age 3+, not sold or retired, with a genetic potential) is paired with
  // her. Ranked mostly by the foal's estimated Breed Total, nudged up where his strong traits cover her weak
  // ones and by good fertility, down for shared weak traits and inbreeding. Only horses in the ledger count.
  var TRAIT_RANKS = { 'below average': 0, 'average': 1, 'good': 2, 'good+': 3, 'good +': 3, 'very good': 4 };
  function traitRankOf(v) { var r = TRAIT_RANKS[String(v || '').toLowerCase().trim()]; return r == null ? null : r; }
  var FERT_BONUS = { excellent: 0.4, good: 0.2, average: 0, fair: -0.4, poor: -0.8 };
  // What it costs to breed to this stallion, if known: the prices saved from his page and Breed page, else the
  // last fee you paid him. summary is a sentence fragment; fee is the HRC price (0 if none) for sorting/totals.
  function priceList(p) {
    var parts = [];
    ['HRC', 'DP', 'FT', 'WT'].forEach(function (c) { if (p && p[c]) parts.push(fmtMoney(p[c]) + ' ' + c); });
    return parts.join(' / ');
  }
  // Copies the prices listed on a stallion's page into his record, so the Public and Private fee fields (and
  // everything built on them) stay current without typing. Also keeps a log of each change. frames = { public,
  // private, semen } as read from the page; returns true if anything changed.
  function applyStudFrames(state, life, frames) {
    if (!life || !frames) return false;
    var changed = false;
    if (!state.horseMeta) state.horseMeta = {};
    var meta = state.horseMeta[life] = Object.assign({}, state.horseMeta[life]);
    var prev = meta.studTerms || {};
    var snap = function (t) { return JSON.stringify([t.public || null, t.private || null, t.semen || null]); };
    var merged = Object.assign({}, prev, frames);
    if (snap(prev) !== snap(merged)) {
      var log = Array.isArray(meta.studTermsLog) ? meta.studTermsLog.slice() : [];
      log.push({ date: new Date().toISOString().slice(0, 10), public: merged.public || null, private: merged.private || null, semen: merged.semen || null });
      meta.studTermsLog = log.slice(-30);
      changed = true;
    }
    meta.studTerms = Object.assign({}, merged, { seenAt: new Date().toISOString().slice(0, 10) });
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
    if (rec && rec.owned !== false) {
      ['Public', 'Private'].forEach(function (tier) {
        var prices = frames[tier.toLowerCase()];
        if (!prices) return;
        CURRENCIES.forEach(function (c) {
          var key = 'fee' + tier + c;
          if (prices[c]) { if (rec[key] !== prices[c]) { rec[key] = prices[c]; changed = true; } }
          else if (rec[key]) { delete rec[key]; changed = true; }
        });
      });
    }
    return changed;
  }
  function studTermsOf(state, life) {
    var m = state.horseMeta && state.horseMeta[life];
    var t = m && m.studTerms;
    if (t && (t.public || t.private || t.semen || t.cheapest)) {
      var parts = [];
      if (t.public && priceList(t.public)) parts.push('public stud ' + priceList(t.public));
      if (t.private && priceList(t.private)) parts.push('private stud ' + priceList(t.private));
      if (t.semen && priceList(t.semen)) parts.push('semen vial ' + priceList(t.semen));
      if (!parts.length && t.cheapest) parts.push('cheapest ' + priceList(t.cheapest));
      if (t.transport) parts.push('+ ' + fmtMoney(t.transport) + ' ' + (t.transportCurrency || 'HRC') + ' transport');
      return {
        fee: (t.public && t.public.HRC) || (t.cheapest && t.cheapest.HRC) || 0, transport: Number(t.transport) || 0, currency: 'HRC',
        summary: parts.join('; ') + ' (seen ' + (t.seenAt || 'recently') + ')', owner: t.owner || ''
      };
    }
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
    if (rec && rec.lastFee && Number(rec.lastFee.fee) > 0) {
      return { fee: Number(rec.lastFee.fee), transport: Number(rec.lastFee.transport) || 0, currency: rec.lastFee.currency || 'HRC', owner: rec.lastFee.studOwner || '',
        summary: 'last fee you paid ' + fmtMoney(rec.lastFee.fee) + ' ' + (rec.lastFee.currency || 'HRC') + (rec.lastFee.transport ? ' + ' + fmtMoney(rec.lastFee.transport) + ' transport' : '') };
    }
    return null;
  }
  // Can you book a stallion, and how? yours; a partner's stallion; a private fee offered to you; a public stud fee; semen; or no
  // fee known for you (then you cannot breed to him). { mine, partner, privateOffer, publicFee, semen, lastFee, breedable }
  function studAccess(state, life) {
    var info = (state.horseInfo && state.horseInfo[life]) || {}, meta = (state.horseMeta && state.horseMeta[life]) || {}, t = meta.studTerms || {};
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var mine = !!me && String(info.ownerName || '').trim().toLowerCase() === me;
    var partner = mine ? '' : partnerOwnerOf(state, info);
    var pub = (t.public && priceList(t.public)) || (t.cheapest && !t.private && !t.semen && priceList(t.cheapest)) || '';
    var priv = (t.private && priceList(t.private)) || '', sem = (t.semen && priceList(t.semen)) || '';
    if (mine) { pub = ''; priv = ''; sem = ''; } // the fees on your own stallion are what you charge, not what you pay
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
    var last = rec && rec.lastFee && Number(rec.lastFee.fee) > 0 ? fmtMoney(rec.lastFee.fee) + ' ' + (rec.lastFee.currency || 'HRC') : '';
    return { retired: meta.status === 'Retired' || meta.status === 'Deceased', mine: mine, partner: partner, privateOffer: priv, publicFee: pub, semen: sem, lastFee: last, seen: t.seenAt || '', breedable: mine || !!partner || !!(pub || priv || sem) };
  }
  // ---------- learning from the ledger ----------
  // Nothing is stored and nothing is guessed from outside: every time it is needed the ledger looks again at what has
  // happened in your own records and adjusts its suggestions. Settings: state.settings.learn (false turns it off).
  //
  // Breeding: every foal with a score, whose parents both have a show score, is a lesson in how far the plain average of
  // the parents misses. From these come an overall offset, a lean towards the better parent, an offset for genetic
  // potential, and a (shrunk) effect for each stallion and mare whose foals keep beating or missing the prediction.
  // Few samples count for little: each effect is pulled towards zero by n / (n + k).
  // Buying: how your past purchases resold, which breeds earned most, the genetic potential and conformation of the
  // horses that have proved themselves, and a suggested top bid from what horses like it have gone for.
  function learningOn(state) { return !(state && state.settings && state.settings.learn === false); }
  function learnSamples(state) {
    var rows = [];
    (state.stallions || []).forEach(function (s) {
      var sLife = s.lifeNumber ? String(s.lifeNumber) : '';
      var sInfo = sLife && state.horseInfo && state.horseInfo[sLife];
      var sConf = bestConformation((sLife && state.horseMeta && state.horseMeta[sLife]) || {}).best;
      (state.breedings[s.id] || []).forEach(function (b) {
        if (b.status !== 'Foal Born') return;
        var fl = foalLifeOf(b.foalUrl), fInfo = fl && state.horseInfo && state.horseInfo[fl], fMeta = fl && state.horseMeta && state.horseMeta[fl];
        var score = b.foalScore > 0 && b.foalScore <= 100 ? b.foalScore : (fMeta && Number(fMeta.confBest) > 0 && Number(fMeta.confBest) <= 100 ? Number(fMeta.confBest) : 0);
        var mLife = String(b.mareLifeNumber || ''), mInfo = mLife && state.horseInfo && state.horseInfo[mLife];
        var mConf = bestConformation((mLife && state.horseMeta && state.horseMeta[mLife]) || {}).best;
        var row = { sire: sLife || s.id, mare: mLife, breed: breedKeyOf((sInfo && sInfo.breed) || (mInfo && mInfo.breed) || ''), sConf: sConf, mConf: mConf, score: score, fGp: 0, pGp: 0 };
        var fg = fInfo && Number(fInfo.geneticPotential), sg = sInfo && Number(sInfo.geneticPotential), mg = mInfo && Number(mInfo.geneticPotential);
        if (fg > 0 && sg > 0 && mg > 0) { row.fGp = fg; row.pGp = (sg + mg) / 2; }
        if ((score > 0 && sConf > 0 && mConf > 0) || row.fGp) rows.push(row);
      });
    });
    return rows;
  }
  function learnedModel(state) { return memo(state, 'learnedModel', function () { return learnedModelRaw(state); }); }
  function learnedModelRaw(state) {
    var all = learnSamples(state);
    var rows = all.filter(function (r) { return r.score > 0 && r.sConf > 0 && r.mConf > 0; });
    var n = rows.length, out = { on: learningOn(state), n: n, conf: { off: 0, slope: 0, naiveErr: null, modelErr: null }, gp: { n: 0, off: 0 }, sire: {}, mare: {}, breed: {}, lines: [] };
    var gpRows = all.filter(function (r) { return r.fGp > 0; });
    if (gpRows.length) { out.gp.n = gpRows.length; out.gp.off = gpRows.reduce(function (t, r) { return t + (r.fGp - r.pGp); }, 0) / (gpRows.length + 5); }
    if (n) {
      var d = rows.map(function (r) { return r.score - (r.sConf + r.mConf) / 2; });
      var xs = rows.map(function (r) { return (r.sConf - r.mConf) / 2; });
      var md = d.reduce(function (a, b) { return a + b; }, 0) / n, mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
      var sxx = 0, sxy = 0;
      xs.forEach(function (x, i) { sxx += (x - mx) * (x - mx); sxy += (x - mx) * (d[i] - md); });
      var slope = n >= 8 && sxx > 0 ? Math.max(-0.5, Math.min(0.5, sxy / sxx)) : 0;
      var sh = n / (n + 8);
      out.conf.slope = slope * sh;
      out.conf.off = (md - slope * mx) * n / (n + 5);
      var res = rows.map(function (r, i) { return d[i] - (out.conf.off + out.conf.slope * xs[i]); });
      out.conf.naiveErr = Math.round(d.reduce(function (t, v) { return t + Math.abs(v); }, 0) / n * 10) / 10;
      out.conf.modelErr = Math.round(res.reduce(function (t, v) { return t + Math.abs(v); }, 0) / n * 10) / 10;
      var acc = function (key, bucket) {
        var by = {};
        rows.forEach(function (r, i) { if (!r[key]) return; (by[r[key]] = by[r[key]] || []).push(res[i]); });
        Object.keys(by).forEach(function (k) { bucket[k] = { n: by[k].length, effect: by[k].reduce(function (a, b) { return a + b; }, 0) / (by[k].length + 3) }; });
      };
      acc('sire', out.sire); acc('mare', out.mare);
      var byBreed = {};
      rows.forEach(function (r, i) { if (r.breed) (byBreed[r.breed] = byBreed[r.breed] || []).push(res[i]); });
      Object.keys(byBreed).forEach(function (k) { if (byBreed[k].length >= 4) out.breed[k] = { n: byBreed[k].length, effect: byBreed[k].reduce(function (a, b) { return a + b; }, 0) / (byBreed[k].length + 5) }; });
    }
    return out;
  }
  // The expected conformation score of a foal of this pair: { conf, plain, note } (the plain average of the parents, and
  // what the ledger expects after learning from your foals)
  function predictFoalConf(model, mConf, sConf, mareLife, sireKey, breed) {
    var plain = (mConf + sConf) / 2;
    if (!model || !model.on || model.n < 3) return { conf: plain, plain: plain, note: '' };
    var pred = plain + model.conf.off + model.conf.slope * (sConf - mConf) / 2;
    var se = model.sire[sireKey], me = model.mare[String(mareLife)], be = breed && model.breed[breed];
    if (se) pred += se.effect;
    if (me) pred += me.effect;
    if (be) pred += be.effect;
    pred = Math.max(0, Math.min(100, pred));
    var bits = [];
    if (Math.abs(model.conf.off) >= 0.5) bits.push('your foals score ' + Math.abs(Math.round(model.conf.off * 10) / 10) + (model.conf.off > 0 ? ' above' : ' below') + ' the parents’ average');
    if (se && Math.abs(se.effect) >= 0.5) bits.push('his foals run ' + Math.abs(Math.round(se.effect * 10) / 10) + (se.effect > 0 ? ' above' : ' below') + ' that');
    if (me && Math.abs(me.effect) >= 0.5) bits.push('her foals run ' + Math.abs(Math.round(me.effect * 10) / 10) + (me.effect > 0 ? ' above' : ' below'));
    return { conf: pred, plain: plain, note: 'Learned from your ' + model.n + ' scored foals: ' + (bits.length ? bits.join('; ') : 'the plain average has been close') + ' (expected foal conformation ' + (Math.round(pred * 10) / 10) + ' instead of ' + (Math.round(plain * 10) / 10) + ')' };
  }
  // How a stallion's coverings have really gone against what his fertility predicts (wiki failure chances)
  var FERT_FAIL = { excellent: 0.05, good: 0.10, average: 0.15, fair: 0.20, poor: 0.40 };
  function learnedFailure(state, stallionLife) {
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(stallionLife); });
    if (!rec) return null;
    var done = (state.breedings[rec.id] || []).filter(function (b) { return b.status === 'Succeeded' || b.status === 'Failed' || b.status === 'Foal Born'; });
    if (done.length < 5) return null;
    var failed = done.filter(function (b) { return b.status === 'Failed'; }).length;
    var info = state.horseInfo && state.horseInfo[stallionLife], exp = info && FERT_FAIL[String(info.fertility || '').toLowerCase().trim()];
    return { n: done.length, failed: failed, rate: failed / done.length, expected: exp != null ? exp : null };
  }

  // ---- buying ----
  function learnedBuying(state) { return memo(state, 'learnedBuying', function () { return learnedBuyingRaw(state); }); }
  function learnedBuyingRaw(state) {
    var out = { on: learningOn(state), bought: 0, sold: 0, avgPct: null, byBreed: [], proven: [], tips: [] };
    var pcts = [], by = {};
    Object.keys(state.horseMeta || {}).forEach(function (l) {
      var p = purchaseOf(state, l);
      if (!p) return;
      out.bought++;
      var info = (state.horseInfo || {})[l] || {}, bk = breedKeyOf(info.breed), g = bk ? (by[bk] = by[bk] || { breed: info.breed, bought: 0, sold: 0, pcts: [] }) : null;
      if (g) g.bought++;
      var pr = profitOf(state, l);
      if (pr && pr.cost > 0) { out.sold++; var pct = pr.profit / pr.cost; pcts.push(pct); if (g) { g.sold++; g.pcts.push(pct); } }
    });
    var avg = function (a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; };
    out.avgPct = avg(pcts);
    out.byBreed = Object.keys(by).map(function (k) { return { breed: by[k].breed, bought: by[k].bought, sold: by[k].sold, avgPct: avg(by[k].pcts) }; })
      .filter(function (b) { return b.sold >= 1; }).sort(function (a, b) { return b.avgPct - a.avgPct; });
    // horses that have proved themselves: mares that out-produce themselves, stallions whose foals beat their dams
    ownedHorses(state).forEach(function (h) {
      if (isSoldLife(state, h.lifeNumber) && h.meta.status === 'Sold') return;
      var proven = h.info.sex === 'mare' ? producerRecord(state, h.lifeNumber).improver : h.info.sex === 'stallion' ? sireRecord(state, h.lifeNumber).improver : false;
      if (!proven) return;
      var gp = Number(h.info.geneticPotential) || 0, conf = bestConformation(h.meta).best || 0;
      out.proven.push({ life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), sex: h.info.sex, breed: h.info.breed, gp: gp, conf: conf });
    });
    return out;
  }
  // Starting values for purchase criteria taken from the horses that proved themselves (needs 3 of that sex)
  function learnedBuyTips(state, breed, sex) {
    var lb = learnedBuying(state), tips = [];
    if (!lb.on) return tips;
    var pool = lb.proven.filter(function (p) { return (!sex || p.sex === sex) && (!breed || breedKeyOf(p.breed) === breedKeyOf(breed)); });
    if (pool.length < 3) return tips;
    function low(arr) { var a = arr.filter(function (v) { return v > 0; }).sort(function (x, y) { return x - y; }); return a.length >= 3 ? a[Math.floor((a.length - 1) * 0.25)] : 0; }
    var who = (sex === 'stallion' ? 'colts & stallions' : sex === 'mare' ? 'mares & fillies' : 'horses');
    [['minGP', 'Genetic Potential', low(pool.map(function (p) { return p.gp; })), 0], ['minConf', 'Top conformation', low(pool.map(function (p) { return p.conf; })), 1]].forEach(function (m) {
      if (!m[2]) return;
      var f = Math.pow(10, m[3]);
      tips.push({ field: m[0], label: m[1], suggested: Math.floor(m[2] * f) / f, learned: true, why: 'Learned: ' + pool.length + ' of your ' + who + ' have proved themselves as producers, and three quarters of them are at or above ' + Math.floor(m[2] * f) / f + '.' });
    });
    return tips;
  }
  // A top bid for a horse: what similar horses have gone for, less the margin your own resales have left
  function suggestedTopBid(state, life) {
    var bench = priceBenchmark(state, life);
    if (!bench) return null;
    var lb = learnedBuying(state), margin = lb.on && lb.sold >= 3 && lb.avgPct != null ? Math.max(0.05, Math.min(0.4, lb.avgPct)) : 0.15;
    if (focusOf(state).keys.indexOf('profit') > -1) margin = Math.max(margin, 0.25);
    return { bid: roundPrice(bench.est / (1 + margin)), margin: margin, learned: lb.on && lb.sold >= 3 && lb.avgPct != null, est: bench.est, sold: lb.sold };
  }
  // Everything the ledger has learned, as plain sentences for the dashboard
  function learnedSummary(state) {
    var m = learnedModel(state), lb = learnedBuying(state), breeding = [], buying = [];
    if (m.n < 3) breeding.push('Not enough yet: the ledger needs at least 3 foals with a saved score whose parents both have a show score (it has ' + m.n + ').');
    else {
      breeding.push('From ' + m.n + ' scored foals: they score ' + Math.abs(Math.round(m.conf.off * 10) / 10) + (m.conf.off >= 0 ? ' above' : ' below') + ' the plain average of their parents' + (m.conf.slope ? ', and lean ' + (m.conf.slope > 0 ? 'towards the better parent' : 'towards the weaker parent') : '') + '. Breeding suggestions use this to estimate foals.');
      if (m.conf.naiveErr != null) breeding.push('The plain average was off by ' + m.conf.naiveErr + ' points on average; with what was learned it is off by ' + m.conf.modelErr + ' (checked on the same foals, so it improves as more are born).');
      var best = [];
      ['sire', 'mare'].forEach(function (k) {
        Object.keys(m[k]).forEach(function (id) { if (m[k][id].n >= 2 && Math.abs(m[k][id].effect) >= 1) best.push({ id: id, kind: k, n: m[k][id].n, effect: m[k][id].effect }); });
      });
      best.sort(function (a, b) { return b.effect - a.effect; });
      var nameOf = function (id) { var i = state.horseInfo && state.horseInfo[id]; if (i && i.name) return i.name; var s = (state.stallions || []).find(function (x) { return x.id === id; }); return (s && s.name) || ('#' + id); };
      best.slice(0, 3).filter(function (x) { return x.effect > 0; }).forEach(function (x) { breeding.push((x.kind === 'sire' ? 'Stallion ' : 'Mare ') + nameOf(x.id) + ': foals beat the prediction by ' + (Math.round(x.effect * 10) / 10) + ' (' + x.n + ' foals).'); });
      best.slice(-3).reverse().filter(function (x) { return x.effect < 0; }).forEach(function (x) { breeding.push((x.kind === 'sire' ? 'Stallion ' : 'Mare ') + nameOf(x.id) + ': foals fall short of the prediction by ' + (Math.round(-x.effect * 10) / 10) + ' (' + x.n + ' foals).'); });
    }
    if (m.gp.n >= 3) breeding.push('Genetic potential: foals come out ' + Math.abs(Math.round(m.gp.off * 10) / 10) + (m.gp.off >= 0 ? ' above' : ' below') + ' their parents’ average (' + m.gp.n + ' foals).');
    var fails = [];
    (state.stallions || []).forEach(function (s) { if (!s.lifeNumber) return; var f = learnedFailure(state, s.lifeNumber); if (f && f.expected != null && Math.abs(f.rate - f.expected) >= 0.15) fails.push(s.name + ' fails ' + Math.round(f.rate * 100) + '% of ' + f.n + ' coverings (his fertility predicts ' + Math.round(f.expected * 100) + '%)'); });
    fails.slice(0, 3).forEach(function (t) { breeding.push(t + '.'); });
    if (lb.sold >= 1) buying.push('Of ' + lb.bought + ' horses you bought, ' + lb.sold + ' have been resold' + (lb.avgPct != null ? ' at an average ' + (lb.avgPct >= 0 ? 'profit' : 'loss') + ' of ' + Math.abs(Math.round(lb.avgPct * 100)) + '%' : '') + '.');
    lb.byBreed.slice(0, 3).forEach(function (b) { buying.push(b.breed + ': ' + b.sold + ' resold at ' + (b.avgPct >= 0 ? '+' : '-') + Math.abs(Math.round(b.avgPct * 100)) + '%.'); });
    if (lb.proven.length) buying.push(lb.proven.length + ' of your horses have proved themselves as producers; the Purchase criteria suggestions use their genetic potential and conformation once there are 3 of the same sex.');
    var mc = marketComps(state);
    if (mc.length) buying.push(mc.length + ' market result' + (mc.length === 1 ? '' : 's') + ' (bids you won or lost) feed the price numbers, with your sales.');
    if (!buying.length) buying.push('Nothing yet: resell a bought horse, or let a horse of yours prove itself as a producer, and this fills in.');
    return { on: m.on, breeding: breeding, buying: buying, model: m, buyingData: lb };
  }

  // ---------- breeder focus ----------
  // What kind of breeder you are: state.settings.breederFocus = { conf: true, gp: true, comp: true, ... } (any number of
  // them) and settings.focusDiscipline (the discipline for Competition; blank = whichever suits the horse best).
  // A focus rates horses that are strong in it a bit higher (sell ideas are less likely to suggest selling them, they
  // rank higher as partners and count more when you look at a horse to buy) and a horse that is weak in it a bit lower.
  // A missed goal in a focus area also counts for more.
  var FOCUS_TYPES = [
    { key: 'conf', label: 'Conformation', hint: 'top conformation score (show quality)' },
    { key: 'gp', label: 'Genetic potential', hint: 'the genetic potential total' },
    { key: 'bt', label: 'Breed Total', hint: 'genetic potential and conformation together' },
    { key: 'comp', label: 'Competition', hint: 'competition scores in a discipline, and the conformation traits that count there (for you, competition scores come before conformation)' },
    { key: 'health', label: 'Health & fertility', hint: 'health ratings and fertility' },
    { key: 'genes', label: 'Colour & preferred genes', hint: 'genes you prefer or keep (and avoid)' },
    { key: 'producer', label: 'Proven producers', hint: 'mares that out-produce themselves, stallions whose foals beat their dams' },
    { key: 'profit', label: 'Buying & selling for profit', hint: 'horses that sell well above what they cost' }
  ];
  function focusOf(state) {
    var f = (state && state.settings && state.settings.breederFocus) || {};
    return { keys: FOCUS_TYPES.filter(function (t) { return f[t.key]; }).map(function (t) { return t.key; }), discipline: (state && state.settings && state.settings.focusDiscipline) || '' };
  }
  // the competition focus also looks at the scores the horses have actually earned ('compscore' / 'cscore' are not a choice of their own)
  function focusKeysAll(FX) { return FX.keys.indexOf('comp') > -1 ? FX.keys.concat(['compscore']) : FX.keys; }
  // the highest competition score a horse has had: in the discipline you breed for, or in any when none is chosen; null when none
  function compScoreOf(state, life, discipline) {
    var c = state && state.horseMeta && state.horseMeta[life] && state.horseMeta[life].comp;
    if (!c) return null;
    var v = discipline ? (c.by && c.by[discipline] && c.by[discipline].high) : c.high;
    return v > 0 ? Number(v) : null;
  }
  function focusLabel(key) { if (key === 'compscore' || key === 'cscore') return 'competition score'; var t = FOCUS_TYPES.find(function (x) { return x.key === key; }); return t ? t.label.toLowerCase() : key; }
  var RATING_SCORE = { excellent: 90, good: 70, average: 50, fair: 30, poor: 10 };
  // A number for one focus (higher is better) or null when it is not known
  function focusMetric(state, life, key, discipline) {
    var info = state.horseInfo && state.horseInfo[life], meta = (state.horseMeta && state.horseMeta[life]) || {};
    if (key === 'compscore') return compScoreOf(state, life, discipline);
    if (!info) return null;
    if (key === 'conf') { var c = bestConformation(meta).best; return c > 0 ? c : null; }
    if (key === 'gp') { var g = Number(info.geneticPotential); return g > 0 ? g : null; }
    if (key === 'bt') { var b = horseBT(state, life); return b > 0 ? b : null; }
    if (key === 'comp') {
      var df = disciplineFit(info);
      if (!df) return null;
      var hit = discipline && df.find(function (d) { return d.name === discipline; });
      return hit ? hit.fit : df[0].fit;
    }
    if (key === 'health') {
      var vals = [];
      if (info.health && typeof info.health === 'object') Object.keys(info.health).forEach(function (k) { var v = RATING_SCORE[String(info.health[k]).toLowerCase().trim()]; if (v != null) vals.push(v); });
      var fv = RATING_SCORE[String(info.fertility || '').toLowerCase().trim()];
      if (fv != null && !isYoungInfo(info)) vals.push(fv, fv);
      return vals.length ? vals.reduce(function (a, b2) { return a + b2; }, 0) / vals.length : null;
    }
    if (key === 'genes') {
      var gs = preferredGenesOf(state, life);
      if (!Object.keys(preferenceMap(state, info.breed)).length) return null;
      return gs.reduce(function (t, x) { return t + (x.level === 'avoid' ? -2 : x.level === 'keep' ? 1.5 : 1); }, 0);
    }
    if (key === 'producer') {
      if (info.sex === 'mare') { var pr = producerRecord(state, life); return pr.improver ? 1 : (pr.scored >= 2 && pr.avgDelta != null && pr.avgDelta < -3 && pr.better === 0 ? -1 : (pr.scored >= 1 ? 0 : null)); }
      if (info.sex === 'stallion') { var sr = sireRecord(state, life); return sr.improver ? 1 : (sr.scored >= 3 && sr.avgDelta < -3 && sr.better === 0 ? -1 : (sr.scored >= 1 ? 0 : null)); }
      return null;
    }
    return null;
  }
  // Where a value stands in a list of the same kind of horse: 1 = clearly strong, -1 = clearly weak, 0 = in between, null = unknown.
  // Producers and genes are judged by their own value, the rest by quarter of the list.
  function focusStanding(key, value, group) {
    if (value == null) return null;
    if (key === 'producer') return value > 0 ? 1 : value < 0 ? -1 : 0;
    if (key === 'genes') return value >= 1 ? 1 : value < 0 ? -1 : 0;
    var a = group.filter(function (v) { return v != null; }).sort(function (x, y) { return x - y; });
    if (a.length < 4) return null;
    var below = a.filter(function (v) { return v < value; }).length / a.length;
    return below >= 0.75 ? 1 : below <= 0.25 ? -1 : 0;
  }
  // The goal box labels of goalSections, and which focus each belongs to
  function focusKeyOfLabel(label) {
    return { 'Conformation': 'conf', 'Genetic Potential': 'gp', 'Breed Total': 'bt', 'Conformation traits': 'comp', 'Health': 'health', 'Fertility': 'health' }[label] || '';
  }
  // A miss of less than 1% on a number goal (566 against a minimum of 570) is a near miss
  function isNearMiss(sections, label) {
    var s = { 'Conformation': sections.conf, 'Genetic Potential': sections.gp, 'Breed Total': sections.bt }[label];
    var m = s && /^([\d.]+) \(min ([\d.]+)\)/.exec(s.text || '');
    return !!(m && parseFloat(m[2]) > 0 && parseFloat(m[1]) >= parseFloat(m[2]) * 0.99);
  }

  // ---------- a mare's foals as keepers ----------
  // Her foals that are yours are checked as possible replacements or additions:
  //  - a colt must make your herd of stallions better (the same check as for a horse you are thinking of buying);
  //  - a filly must be better than her dam (Breed Total, and conformation or genetic potential), and should not make
  //    your herd of mares worse;
  //  - a daughter whose own foals average clearly above her dam's foals out-produces her: that lowers the dam's rank.
  // Returns { foals: [{ life, name, sex, young, bt, conf, gp, verdict, why }], betterProducers: [{ life, name, avgFoal, damAvg }] }
  // verdict: 'keeper' (worth keeping), 'maybe', 'no', 'unknown' (not enough scores yet)
  function foalsOfDam(state, damLife) {
    damLife = String(damLife);
    var seen = {}, out = [];
    Object.keys(state.breedings || {}).forEach(function (sid) {
      (state.breedings[sid] || []).forEach(function (b) {
        if (String(b.mareLifeNumber) !== damLife || b.status !== 'Foal Born') return;
        var fl = foalLifeOf(b.foalUrl);
        if (fl && !seen[fl]) { seen[fl] = true; out.push(fl); }
      });
    });
    Object.keys(state.horseInfo || {}).forEach(function (l) {
      var i = state.horseInfo[l];
      if (i && i.dam && String(i.dam.lifeNumber) === damLife && !seen[l]) { seen[l] = true; out.push(l); }
    });
    return out;
  }
  function foalKeeperInfo(state, damLife) {
    damLife = String(damLife);
    var out = { foals: [], betterProducers: [] };
    var dInfo = state.horseInfo && state.horseInfo[damLife];
    if (!dInfo) return out;
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var dBT = horseBT(state, damLife), dConf = bestConformation((state.horseMeta && state.horseMeta[damLife]) || {}).best, dGP = Number(dInfo.geneticPotential) || 0;
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    var damProd = null;
    foalsOfDam(state, damLife).forEach(function (fl) {
      var fi = state.horseInfo && state.horseInfo[fl], fm = (state.horseMeta && state.horseMeta[fl]) || {};
      if (!fi || (fi.sex !== 'mare' && fi.sex !== 'stallion')) return;
      if (me && String(fi.ownerName || '').trim().toLowerCase() !== me) return;
      if (isSoldLife(state, fl) || fm.status === 'Retired' || fm.status === 'Deceased') return;
      var bt = horseBT(state, fl), conf = bestConformation(fm).best, gp = Number(fi.geneticPotential) || 0;
      var row = { life: fl, name: fi.name || ('#' + fl), sex: fi.sex, young: isYoungInfo(fi), bt: bt, conf: conf, gp: gp, verdict: 'unknown', why: '' };
      var hb = herdBenefit(state, fl);
      if (fi.sex === 'stallion') {
        if (hb.verdict === 'helps') { row.verdict = 'keeper'; row.why = 'would make your stallions better (' + hb.lines.filter(function (l) { return l.ok === true; }).slice(0, 2).map(function (l) { return l.text; }).join('; ') + ')'; }
        else if (hb.verdict === 'maybe') { row.verdict = 'maybe'; row.why = 'might help your stallions, but not clearly'; }
        else if (hb.verdict === 'no') { row.verdict = 'no'; row.why = 'would not make your stallions better'; }
        else row.why = bt > 0 ? 'fewer than 3 of your stallions of this breed are saved to compare with' : 'scores not known yet';
      } else {
        var wins = 0, known = 0, bits = [];
        [['Breed Total', bt, dBT], ['conformation', conf, dConf], ['genetic potential', gp, dGP]].forEach(function (m) {
          if (!(m[1] > 0) || !(m[2] > 0)) return;
          known++;
          if (m[1] > m[2]) { wins++; bits.push(m[0] + ' ' + r1(m[1]) + ' against her ' + r1(m[2])); }
        });
        if (!known) row.why = 'scores not known yet';
        else if (bt > 0 && dBT > 0 && bt >= dBT + 0.5 && wins >= 2 && hb.verdict !== 'no') { row.verdict = 'keeper'; row.why = 'better than her dam: ' + bits.join(', '); }
        else if (wins >= 1 && hb.verdict !== 'no') { row.verdict = 'maybe'; row.why = 'beats her dam only in part: ' + bits.join(', '); }
        else { row.verdict = 'no'; row.why = wins ? 'better than her dam in some ways, but would not make your mares better' : 'not better than her dam'; }
        // a daughter whose own foals score clearly above her dam's foals
        if (!fi.young || !isYoungInfo(fi)) {
          damProd = damProd || producerRecord(state, damLife);
          var dp = producerRecord(state, fl);
          if (damProd.scored >= 2 && dp.scored >= 2 && dp.avgFoal != null && damProd.avgFoal != null && dp.avgFoal >= damProd.avgFoal + 1) {
            out.betterProducers.push({ life: fl, name: row.name, avgFoal: dp.avgFoal, damAvg: damProd.avgFoal, n: dp.scored });
            row.producer = 'her foals average ' + dp.avgFoal + ', above her dam’s ' + damProd.avgFoal;
          }
        }
      }
      out.foals.push(row);
    });
    var rank = { keeper: 0, maybe: 1, unknown: 2, no: 3 };
    out.foals.sort(function (a, b) { return rank[a.verdict] - rank[b.verdict]; });
    return out;
  }
  // Plain lines for the card hover and the horse's ledger page: her foals as keepers (for a mare) or how a foal compares
  // with its dam and herd (for a foal of a mare of yours).
  function keeperLines(state, life) {
    life = String(life);
    var info = state.horseInfo && state.horseInfo[life], lines = [];
    if (!info) return lines;
    var tag = { keeper: '✓ keeper', maybe: '• maybe', no: '✗ not needed', unknown: '• not clear yet' };
    var fmt = function (f) { return (f.name) + ' (' + (f.sex === 'stallion' ? (f.young ? 'colt' : 'stallion') : (f.young ? 'filly' : 'mare')) + '): ' + tag[f.verdict] + ' — ' + f.why + (f.producer ? '; ' + f.producer : ''); };
    if (info.sex === 'mare') {
      var fk = foalKeeperInfo(state, life);
      if (fk.foals.length) {
        lines.push('HER FOALS AS KEEPERS (a colt must make your stallions better; a filly must be better than her)');
        fk.foals.slice(0, 8).forEach(function (f) { lines.push('   ' + fmt(f)); });
        if (fk.foals.length > 8) lines.push('   and ' + (fk.foals.length - 8) + ' more');
      }
      fk.betterProducers.forEach(function (b) { lines.push('✗ Her daughter ' + b.name + ' out-produces her (foals average ' + b.avgFoal + ' against her ' + b.damAvg + '), which lowers her rank'); });
    }
    var dl = info.dam && info.dam.lifeNumber ? String(info.dam.lifeNumber) : '';
    if (dl && state.horseInfo && state.horseInfo[dl]) {
      var mine = foalKeeperInfo(state, dl).foals.find(function (f) { return f.life === life; });
      if (mine) lines.push('COMPARED WITH HER DAM ' + ((state.horseInfo[dl] && state.horseInfo[dl].name) || ('#' + dl)).toUpperCase() + ': ' + fmt(mine));
    }
    return lines;
  }

  // ---------- ranch cards: where each horse sits between keeping and selling ----------
  // Every horse of yours is ranked against the rest of its group (mares & fillies or colts & stallions of the same breed,
  // or of all breeds when fewer than 6 of the breed) on a blend of Breed Total, conformation, genetic potential and, when
  // you chose a breeder focus, the focus measures (which count 1.6 times as much). Missed goals pull a horse down (a miss
  // in a focus area more), meeting every goal lifts it, and your notes, genes, producer record, a stallion's failed
  // coverings and a never-bred mare adjust it. The rank gives five levels:
  //   5 Top keeper (top 20%) · 4 Keep · 3 Middle of the herd · 2 Consider selling (bottom 30%) · 1 Sell (bottom 12%)
  // A keep note, a proven producer or a gene you keep makes a horse a top keeper; a sell note makes it Sell; a horse that
  // meets every goal is never lower than Middle.
  var RANK_LEVELS = { 5: 'Top keeper', 4: 'Keep', 3: 'Middle of the herd', 2: 'Consider selling', 1: 'Sell' };
  function herdRanking(state) { return memo(state, 'herdRanking', function () { return herdRankingRaw(state); }); }
  function herdRankingRaw(state) {
    var FX = focusOf(state), goalsOn = anyGoals(state), me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var overall = overallNoteRules(state), comps = priceComps(state), form = sellFormOf(state);
    var herd = ownedHorses(state).filter(function (h) {
      return !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && h.meta.status !== 'Companion' && (h.info.sex === 'mare' || h.info.sex === 'stallion');
    }).map(function (h) {
      var life = String(h.lifeNumber), m = {};
      ['bt', 'conf', 'gp', 'comp', 'health', 'genes', 'producer'].forEach(function (k) { m[k] = focusMetric(state, life, k, FX.discipline); });
      m.cscore = focusMetric(state, life, 'compscore', FX.discipline);
      return { life: life, h: h, sex: h.info.sex, young: isYoungInfo(h.info), breed: breedKeyOf(h.info.breed), m: m, z: 0, adj: 0, why: [], flags: {}, parts: [], adjParts: [], over: [] };
    });
    var GROUP = { mare: 'mares & fillies', stallion: 'colts & stallions' };
    // groups: same breed and sex, or all breeds when the breed group is small
    var bySex = { mare: [], stallion: [] }, byBreedSex = {};
    herd.forEach(function (x) { bySex[x.sex].push(x); (byBreedSex[x.breed + '|' + x.sex] = byBreedSex[x.breed + '|' + x.sex] || []).push(x); });
    herd.forEach(function (x) { var g = byBreedSex[x.breed + '|' + x.sex]; x.group = x.breed && g.length >= 6 ? g : bySex[x.sex]; x.groupName = (x.group === bySex[x.sex] ? '' : (x.h.info.breed || '') + ' ') + GROUP[x.sex]; });
    // conformation counts most for a conformation breeder; for a competition breeder the scores horses earned in the discipline (cscore) come first
    var BASE = { bt: 1, conf: 0.5, gp: 0.5, comp: 0, cscore: 0.3, health: 0, genes: 0.6, producer: 0.6 };
    var stats = {};
    function statOf(group, k) {
      var key = group.length + '|' + group[0].life + '|' + k;
      if (stats[key]) return stats[key];
      var v = group.map(function (x) { return x.m[k]; }).filter(function (n) { return n != null; });
      var mean = v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : 0;
      var sd = v.length > 1 ? Math.sqrt(v.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / v.length) : 0;
      return (stats[key] = { n: v.length, mean: mean, sd: sd || 1 });
    }
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    herd.forEach(function (x) {
      var num = 0, den = 0, life = x.life, nr = horseNoteRules(state, life);
      Object.keys(BASE).forEach(function (k) {
        var inF = FX.keys.indexOf(k === 'cscore' ? 'comp' : k) > -1;
        var w = (BASE[k] || 0) * (inF ? 1.6 : 1);
        if (inF && !BASE[k]) w = 1.4;
        if (k === 'cscore' && inF) w = 1.2;
        if (k === 'conf' && !inF && FX.keys.indexOf('comp') > -1) w *= 0.6;
        if (!w || x.m[k] == null) return;
        var st = statOf(x.group, k);
        if (st.n < 3) return;
        var z = Math.max(-2, Math.min(2, (x.m[k] - st.mean) / st.sd));
        num += w * z; den += w;
        x.parts.push({ k: k, label: { bt: 'Breed Total', conf: 'Top conformation', gp: 'Genetic potential', comp: 'Competition fit', cscore: 'Competition score' + (FX.discipline ? ' (' + FX.discipline + ')' : ''), health: 'Health & fertility', genes: 'Genes', producer: 'Producer record' }[k] || k, value: x.m[k], mean: st.mean, z: z, w: w, focus: inF });
        if (inF && Math.abs(z) >= 0.6) x.why.push((z > 0 ? 'Strong' : 'Weak') + ' in your focus, ' + focusLabel(k) + (k === 'conf' || k === 'gp' || k === 'bt' || k === 'cscore' ? ' (' + r1(x.m[k]) + ' against a group average of ' + r1(st.mean) + ')' : ''));
      });
      x.z = den ? num / den : null;
      var adj = 0;
      function A(amt, text) { adj += amt; x.adjParts.push({ amt: amt, text: text }); }
      if (goalsOn) {
        var misses = goalMisses(state, life), sec = misses.length ? goalSections(state, life) : null, hard = 0, near = [];
        misses.forEach(function (lbl) {
          var key = focusKeyOfLabel(lbl), inFocus = FX.keys.indexOf(key) > -1;
          if (!inFocus && isNearMiss(sec, lbl)) { near.push(lbl); return; }
          hard++; A(inFocus ? -0.55 : -0.35, 'Misses your ' + lbl + ' goal' + (inFocus ? ' (a focus area counts more)' : ''));
        });
        if (hard) x.why.push('Misses your goal' + (hard === 1 ? '' : 's') + ': ' + misses.filter(function (l) { return !(near.indexOf(l) > -1); }).join(', '));
        if (near.length) { x.why.push('Within 1% of your ' + near.join(', ') + ' goal (not counted against it)'); x.adjParts.push({ amt: 0, text: 'Within 1% of your ' + near.join(', ') + ' goal, so not counted against it' }); }
        x.hard = hard;
        var gc = goalCheck(state, life);
        if (gc.active && gc.met) { A(0.3, 'Meets all your goals'); x.flags.met = true; x.why.push('Meets all your goals'); }
      }
      var genes = preferredGenesOf(state, life);
      var avoid = genes.filter(function (g) { return g.level === 'avoid'; }), keepG = genes.filter(function (g) { return g.level === 'keep' && !g.suspected; });
      if (avoid.length) { A(-0.5, 'Carries ' + avoid.map(function (g) { return g.name; }).join(', ') + ', a gene you do not want'); x.why.push('Carries ' + avoid.map(function (g) { return g.name; }).join(', ') + ', a gene you do not want'); }
      if (keepG.length) { x.flags.core = true; (x.coreWhy = x.coreWhy || []).push('carries ' + keepG.map(function (g) { return g.name; }).join(', ') + ', a gene you keep'); x.why.push('Carries ' + keepG.map(function (g) { return g.name; }).join(', ') + ', a gene you want to keep'); }
      if (nr.keep || overall.keepGroups[x.young ? (x.sex === 'mare' ? 'filly' : 'colt') : x.sex]) { x.flags.core = true; (x.coreWhy = x.coreWhy || []).push('your notes say to keep'); x.why.push('Your notes say to keep'); }
      if (nr.sell) { x.flags.sell = true; x.why.push('Your note says to sell'); }
      if (x.sex === 'mare') {
        var pr = producerRecord(state, life), dimp = damImprover(state, life);
        var fkd = foalKeeperInfo(state, life);
        x.foalInfo = fkd;
        if (fkd.betterProducers.length) {
          fkd.betterProducers.slice(0, 2).forEach(function (bp) { A(-0.3, 'Her daughter ' + bp.name + ' out-produces her (foals average ' + bp.avgFoal + ' against her ' + bp.damAvg + ')'); });
          x.why.push('A daughter out-produces her');
        }
        if (pr.improver && fkd.betterProducers.length) { x.adjParts.push({ amt: 0, text: 'Her own record (foals above her) would protect her, but a daughter out-produces her, so it does not' }); }
        else if (pr.improver) { x.flags.core = true; (x.coreWhy = x.coreWhy || []).push('she out-produces herself (foals average ' + pr.avgFoal + ' against her ' + pr.mareScore + ')'); x.why.push('Out-produces herself: foals average ' + pr.avgFoal + ' against her ' + pr.mareScore); }
        else if (dimp && !fkd.betterProducers.length) { x.flags.core = true; (x.coreWhy = x.coreWhy || []).push('her dam ' + dimp.name + ' out-produces herself'); x.why.push('Her dam ' + dimp.name + ' out-produces herself'); }
        else if (pr.scored >= 2 && pr.avgDelta != null && pr.avgDelta < -3 && pr.better === 0) { A(-0.4, 'Her ' + pr.scored + ' scored foals average ' + pr.avgFoal + ', below her own ' + pr.mareScore); x.why.push('Her ' + pr.scored + ' scored foals average ' + pr.avgFoal + ', below her own ' + pr.mareScore); }
        if (!x.young && !Object.keys(state.breedings || {}).some(function (sid) { return (state.breedings[sid] || []).some(function (b) { return String(b.mareLifeNumber) === life; }); })) A(-0.15, 'Adult mare never bred');
      } else {
        var sr = sireRecord(state, life);
        if (sr.improver) { x.flags.core = true; (x.coreWhy = x.coreWhy || []).push('his foals beat their dams by ' + sr.avgDelta + ' on average'); x.why.push('His foals beat their dams by ' + sr.avgDelta + ' on average'); }
        else if (sr.scored >= 3 && sr.avgDelta < -3 && sr.better === 0) { A(-0.4, 'His ' + sr.scored + ' scored foals average ' + sr.avgFoal + ', below their dams'); x.why.push('His ' + sr.scored + ' scored foals average ' + sr.avgFoal + ', below their dams'); }
        var lf = learnedFailure(state, life);
        if (lf && lf.rate >= 0.4) { A(-0.4, 'Fails ' + Math.round(lf.rate * 100) + '% of his ' + lf.n + ' coverings'); x.why.push('Fails ' + Math.round(lf.rate * 100) + '% of his ' + lf.n + ' coverings'); }
      }
      var rgs = rangeStatus(state, life);
      if (rgs && rgs.ranged) x.why.push('Ranged: its high ' + rgs.high + ' and low ' + rgs.low + ' span the full ' + rgs.full + ', so its top score is its true top');
      x.ranged = !!(rgs && rgs.ranged);
      x.price = priceIdea(state, life, form.pace, comps);
      if (FX.keys.indexOf('profit') > -1) {
        var cost = x.price.floor;
        if (cost && x.price.suggested && x.price.suggested >= cost * 1.25) { A(-0.25, 'Would sell about ' + Math.round((x.price.suggested / cost - 1) * 100) + '% above what you paid (your focus is profit)'); x.why.push('Would sell about ' + Math.round((x.price.suggested / cost - 1) * 100) + '% above what you paid (your focus is profit)'); }
      }
      x.adj = adj;
      if (x.z != null) x.value = x.z + adj; else x.value = null;
    });
    // rank inside each group
    herd.forEach(function (x) {
      var vals = x.group.filter(function (o) { return o.value != null; });
      x.of = vals.length;
      if (x.value == null || vals.length < 4) { x.pct = null; return; }
      var below = vals.filter(function (o) { return o.value < x.value; }).length, equal = vals.filter(function (o) { return o.value === x.value; }).length;
      x.pct = (below + (equal - 1) / 2) / (vals.length - 1);
      x.rank = vals.filter(function (o) { return o.value > x.value; }).length + 1;
    });
    var out = {};
    herd.forEach(function (x) {
      var level = null, rankLevel = null;
      if (x.pct != null) {
        rankLevel = x.pct >= 0.8 ? 5 : x.pct >= 0.5 ? 4 : x.pct >= 0.3 ? 3 : x.pct >= 0.12 ? 2 : 1;
        var byRank = rankLevel;
        if (x.flags.met && rankLevel < 3) { rankLevel = 3; x.over.push('It meets all your goals, so it is never placed lower than Middle of the herd (its rank alone said ' + RANK_LEVELS[byRank] + ')'); }
        if ((x.hard || 0) >= 2 && rankLevel > 2 && x.pct < 0.5) { rankLevel = 2; x.over.push('It misses 2 or more goals and is in the lower half, so it is capped at Consider selling'); }
      }
      if (x.flags.sell) { level = 1; x.over.push('Your note says to sell, so it is Sell whatever its rank'); }
      else if (x.flags.core) { level = 5; x.over.push('It is protected as a keeper (' + (x.coreWhy || []).join('; ') + '), so it is a Top keeper whatever its rank'); }
      else level = rankLevel;
      var prot = !!x.flags.core && !x.flags.sell;
      out[x.life] = { ranged: x.ranged, parts: x.parts, adjParts: x.adjParts, over: x.over, z: x.z, adj: x.adj, value: x.value, level: level, rankLevel: rankLevel, protectedHorse: prot, protectedWhy: prot ? (x.coreWhy || []) : [], label: level ? RANK_LEVELS[level] : (x.value != null ? 'Too few to rank' : 'Not enough data'), rank: x.rank || null, of: x.of, group: x.groupName, pct: x.pct, why: x.why.slice(), price: x.price, young: x.young, sex: x.sex };
    });
    return out;
  }
  // The hover text for a card: every step of how the horse got its level
  function rankExplanation(r, a) {
    var f2 = function (n) { return (n >= 0 ? '+' : '\u2212') + Math.abs(Math.round(n * 100) / 100).toFixed(2); };
    var f1 = function (n) { return Math.round(n * 10) / 10; };
    var L = [];
    L.push('LEVEL: ' + r.label + (a.rank && a.of ? ' \u2014 ranks ' + a.rank + ' of ' + a.of + ' ' + a.group + ' (1 is the best)' : ''));
    if (r.over.length) r.over.forEach(function (t) { L.push('\u2605 ' + t); });
    if (r.value != null) {
      L.push('');
      L.push('HOW THE SCORE IS WORKED OUT (higher is better)');
      L.push('1. Each measure compared with the average of its group, then blended (weights in brackets; your focus counts 1.6\u00d7):');
      r.parts.forEach(function (p) { L.push('   ' + p.label + ' ' + (p.k === 'bt' || p.k === 'conf' || p.k === 'comp' || p.k === 'cscore' || p.k === 'health' ? f1(p.value) : p.k === 'gp' ? Math.round(p.value) : p.value) + ' against a group average of ' + (p.k === 'gp' ? Math.round(p.mean) : f1(p.mean)) + '  \u2192 ' + f2(p.z) + '  (weight ' + f1(p.w) + (p.focus ? ', your focus' : '') + ')'); });
      L.push('   Blended: ' + f2(r.z));
      L.push('2. Adjustments:');
      if (!r.adjParts.length) L.push('   none');
      r.adjParts.forEach(function (p) { L.push('   ' + (p.amt ? f2(p.amt) : ' 0.00') + '  ' + p.text); });
      L.push('3. Final score ' + f2(r.value) + (a.rank && a.of ? ', ranked against the other ' + (a.of - 1) + ' in the group' + (a.rank && a.of ? ': ' + (a.rank <= a.of / 2 ? 'top ' + Math.ceil(a.rank / a.of * 100) : 'bottom ' + Math.ceil((a.of - a.rank + 1) / a.of * 100)) + '%' : '') : ''));
      L.push('');
      L.push('LEVELS BY RANK: top 20% Top keeper \u00b7 next 30% Keep \u00b7 next 20% Middle \u00b7 next 18% Consider selling \u00b7 bottom 12% Sell');
    } else {
      L.push('');
      L.push('Not enough saved data (Breed Total, conformation or genetic potential) or too few horses in its group to rank it.');
    }
    if (a.price) L.push('Suggested asking price about ' + fmtMoney(a.price) + ' HRC');
    return L;
  }
  // The card for each horse: its level, where it ranks, the reasons, an asking price when selling is suggested, and for a
  // mare free to breed the stallion the ledger would pick. { action, level, label, rank, of, group, reasons, price, best, infoal }
  // The stallion the ledger would pick for a free adult mare, and your own best when a better one is in the ledger:
  // { best, bestOwn, reasons }. Slow-ish (it looks at every stallion), so the ranch page asks for it a mare at a time.
  function partnerAdvice(state, l) {
    var out = { best: null, bestOwn: null, reasons: [] };
    var sg = breedingSuggestions(state, l, 40);
    var pack = function (t) { return { life: t.life, name: t.name, estBT: t.estBT, conf: t.conf, yours: t.yours, partner: t.partner || '', unlisted: !!t.unlisted, cost: t.yours ? '' : (t.terms && t.terms.summary ? t.terms.summary : 'no fee saved') }; };
    var mine = sg.mine || [], others = sg.others || [];
    if (!mine.length && !others.length) { if (sg.error !== 'young') out.reasons.push('No stallion suggestion yet (' + (sg.noData ? 'some horses are missing saved data' : 'none available') + ')'); return out; }
    out.bestOwn = mine[0] ? pack(mine[0]) : null;
    // the best-crossing stallion of another player that is saved in the ledger (marked when no fee is known)
    var bestOther = others[0] || null;
    out.best = bestOther ? pack(bestOther) : (mine[0] ? pack(mine[0]) : null);
    var line = function (t, i) { return '  ' + (i + 1) + '. ' + t.name + (t.partner ? ' (partner)' : '') + ' \u2014 expected foal conformation ' + (t.conf != null ? t.conf : '?') + ', GP ' + Math.round(t.gp) + (t.traitAvg != null ? ', ' + (t.weakTraits || 0) + ' weak traits' : '') + (t.yours ? '' : (t.terms && t.terms.summary ? ' \u00b7 ' + t.terms.summary : ' \u00b7 no stud fee saved')); };
    if (mine.length) { out.reasons.push('YOUR STALLIONS (top ' + mine.length + ')'); mine.forEach(function (t, i) { out.reasons.push(line(t, i)); }); }
    if (others.length) { out.reasons.push('OTHER PLAYERS\u2019 STALLIONS SAVED IN THE LEDGER (top ' + others.length + ')'); others.forEach(function (t, i) { out.reasons.push(line(t, i)); }); }
    var top = bestOther || mine[0];
    out.reasons.push('', 'Why ' + top.name + ': ');
    (top.reasons || []).slice(0, 4).forEach(function (t) { out.reasons.push('  ' + t); });
    return out;
  }
  function herdAdvice(state, lives, opts) {
    var rk = herdRanking(state), forSaleSet = {}, out = {};
    ownedHorses(state).forEach(function (h) { if (h.meta.status === 'For Sale') forSaleSet[String(h.lifeNumber)] = true; });
    (lives || []).forEach(function (l) {
      l = String(l);
      var info = state.horseInfo && state.horseInfo[l], meta = (state.horseMeta && state.horseMeta[l]) || {}, r = rk[l];
      if (!info || (info.sex !== 'mare' && info.sex !== 'stallion')) return;
      if (meta.status === 'Sold' || meta.status === 'Retired' || meta.status === 'Deceased' || meta.status === 'Companion') return;
      var a = { ranged: !!(r && r.ranged), action: r && r.level ? ['', 'sell', 'consider', 'middle', 'keep', 'top'][r.level] : 'nodata', level: r ? r.level : null, pips: r ? (r.rankLevel || r.level) : null, protectedHorse: !!(r && r.protectedHorse), label: r ? r.label : 'Not enough data', rank: r && r.rank, of: r ? r.of : 0, group: r && r.group, reasons: r ? r.why.slice() : [], price: null, best: null, infoal: '' };
      if (r) a.reasons = rankExplanation(r, a);
      var kl = keeperLines(state, l);
      if (kl.length) { a.reasons.push(''); kl.forEach(function (t) { a.reasons.push(t); }); }
      if (r && r.level && r.level <= 2 && r.price && r.price.suggested) { a.price = r.price.suggested; a.reasons.push('Suggested asking price about ' + fmtMoney(a.price) + ' HRC'); }
      if (forSaleSet[l] || meta.status === 'For Sale') { a.action = 'forsale'; a.label = 'For sale'; a.reasons.unshift('Listed for sale'); }
      if (info.sex === 'mare') {
        var bs = mareBreedStatus(state, l);
        if (bs.status) { a.infoal = bs.status === 'pregnant' ? 'in foal' : 'covered'; a.reasons.unshift((bs.status === 'pregnant' ? 'In foal' : 'Covered') + (bs.due ? ', ' + bs.due : '') + (bs.stallion ? ' by ' + bs.stallion : '')); }
        else if (!isYoungInfo(info) && a.action !== 'sell' && a.action !== 'forsale') {
          a.freeMare = true;
          if (!(opts && opts.noBreeding)) { var pa = partnerAdvice(state, l); a.best = pa.best; a.bestOwn = pa.bestOwn; pa.reasons.forEach(function (t) { a.reasons.push(t); }); }
        }
      }
      out[l] = a;
    });
    return out;
  }

  // A stallion is worth suggesting only if he can actually be used: one of yours that is active, or (anyone's) one
  // that has semen vials or is currently offered at stud (a public or private stud fee saved from his page).
  function stallionAvailable(state, life) {
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var inactive = function (st) { return st === 'Retired' || st === 'Sold' || st === 'Deceased'; };
    var t = meta.studTerms;
    // a retired stallion is still usable while semen vials are available
    if (inactive(meta.status) || (rec && inactive(rec.status))) return !!(t && t.semen && priceList(t.semen));
    if (t && ((t.semen && priceList(t.semen)) || (t.public && priceList(t.public)) || (t.private && priceList(t.private)) || (t.cheapest && priceList(t.cheapest)))) return true;
    if (rec && rec.owned !== false) return rec.status === 'Active' || (!rec.status && meta.status !== 'Observation');
    return false;
  }
  // 'yes': yours and active, or has a stud fee / semen saved; 'unlisted': another player's stallion that is saved in the
  // ledger but no fee is known (he may not be at stud, so he is offered with a note); 'no': retired, sold or deceased
  function stallionUsable(state, life) {
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var info = state.horseInfo && state.horseInfo[life], meta = (state.horseMeta && state.horseMeta[life]) || {};
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
    var inactive = function (st) { return st === 'Retired' || st === 'Sold' || st === 'Deceased'; };
    if (inactive(meta.status) || (rec && inactive(rec.status))) return stallionAvailable(state, life) ? 'yes' : 'no';
    if (stallionAvailable(state, life)) return 'yes';
    var mine = !!me && info && String(info.ownerName || '').trim().toLowerCase() === me;
    if (mine) return meta.status === 'Observation' || meta.status === 'Companion' ? 'no' : 'yes';
    return 'unlisted';
  }
  function breedingSuggestions(state, mareLife, limit) {
    mareLife = String(mareLife || '');
    var mInfo = state.horseInfo && state.horseInfo[mareLife];
    var out = { mareName: (mInfo && mInfo.name) || ('#' + mareLife), status: mareBreedStatus(state, mareLife), error: '', suggestions: [], considered: 0, noData: 0, tooRelated: 0, notAvailable: 0, byNotes: 0, noteEffects: [] };
    var overallRules = overallNoteRules(state), mareRules = horseNoteRules(state, mareLife);
    if (mareRules.noBreed) { out.error = 'no-breed'; return out; }
    var maxFeeNote = overallRules.maxFee, coiLimit = overallRules.avoidInbreeding ? 3.125 : 12.5;
    overallRules.understood.concat(mareRules.understood).forEach(function (u) { out.noteEffects.push(u); });
    if (!mInfo || mInfo.sex !== 'mare') { out.error = 'not-a-mare'; return out; }
    if (isYoungInfo(mInfo)) { out.error = 'young'; return out; }
    var mMeta = (state.horseMeta && state.horseMeta[mareLife]) || {};
    var mConf = bestConformation(mMeta).best;
    var LM = learnedModel(state), FXb = focusOf(state);
    var mAnc = ancestorMap(state, mareLife, 3);
    var list = [];
    Object.keys(state.horseInfo || {}).forEach(function (life) {
      var sInfo = state.horseInfo[life];
      if (!sInfo || sInfo.sex !== 'stallion' || isYoungInfo(sInfo)) return;
      if (!sameBreed(sInfo, mInfo)) return;
      var usable = stallionUsable(state, life);
      if (usable === 'no') { out.notAvailable++; return; }
      var noteFx = partnerNoteEffect(state, mareLife, life);
      if (noteFx.skip) { out.byNotes++; return; }
      var sMeta = (state.horseMeta && state.horseMeta[life]) || {};
      if (isSoldLife(state, life) || sMeta.status === 'Retired' || sMeta.status === 'Deceased') return;
      if (sInfo.geneticPotential == null || mInfo.geneticPotential == null) { out.noData++; return; }
      out.considered++;
      var sConf = bestConformation(sMeta).best;
      var gp = (Number(mInfo.geneticPotential) + Number(sInfo.geneticPotential)) / 2;
      var confs = [mConf, sConf].filter(function (x) { return x > 0; });
      var conf = confs.length ? confs.reduce(function (a, b) { return a + b; }, 0) / confs.length : null;
      // what the ledger has learned from your own foals adjusts the plain average of the parents
      var learnedNote = '';
      if (LM.on && LM.gp.n >= 3) gp += LM.gp.off;
      if (LM.on && conf && sConf > 0 && mConf > 0) { var pf = predictFoalConf(LM, mConf, sConf, mareLife, String(life), breedKeyOf(mInfo.breed)); conf = pf.conf; learnedNote = pf.note; }
      var estBT = conf ? breedTotal(gp, conf) : null;
      var common = commonAncestors(mAnc, ancestorMap(state, life, 3));
      var coi = estimateCoi(common);
      if (coi > coiLimit) { out.tooRelated++; return; }
      var shared = [], fixes = [], tr = { n: 0, sum: 0, weak: 0, strong: 0 };
      if (mInfo.confTraits && sInfo.confTraits) {
        Object.keys(mInfo.confTraits).forEach(function (t) {
          var a = traitRankOf(mInfo.confTraits[t]), b = traitRankOf(sInfo.confTraits[t]);
          if (a == null || b == null) return;
          if (a === 0 && b === 0) shared.push(t);
          else if (a === 0 && b >= 2) fixes.push(t);
          var ex = (a + b) / 2;
          tr.n++; tr.sum += ex;
          if (ex < 1) tr.weak++;
          if (ex >= 2) tr.strong++;
        });
      }
      // partners are ranked on the foal's expected conformation score, genetic potential and conformation stats (not on
      // Breed Total, which depends on how the foal does in conformation shows); a breeder focus counts its measure more
      var foalExp = { conf: conf, gp: gp, traitAvg: tr.n ? tr.sum / tr.n : null, weak: tr.weak, strong: tr.strong };
      var baseScore = conf != null ? foalScoreOf(foalExp, FXb) / 2 : gp / 10;
      var fert = String(sInfo.fertility || '').toLowerCase().trim();
      var fertBonus = FERT_BONUS[fert] != null ? FERT_BONUS[fert] : 0;
      var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
      var yours = !!(rec && rec.owned !== false);
      var terms = yours ? null : studTermsOf(state, life);
      var partnerName = yours ? '' : partnerOwnerOf(state, sInfo);
      var isMineHorse = yours || usable === 'yes' && !terms && String((sInfo.ownerName || '')).trim().toLowerCase() === String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      // what she and he have produced together already
      var hist = { foals: 0, failed: 0, bestScore: 0 };
      if (rec) {
        (state.breedings[rec.id] || []).forEach(function (b) {
          if (String(b.mareLifeNumber) !== mareLife) return;
          if (b.status === 'Foal Born') { hist.foals++; if (b.foalScore > 0 && b.foalScore <= 100 && b.foalScore > hist.bestScore) hist.bestScore = b.foalScore; }
          else if (b.status === 'Failed') hist.failed++;
        });
      }
      var reasons = [], learnedFail = 0;
      reasons.push('Expected foal: ' + (conf != null ? 'conformation score ' + (Math.round(conf * 10) / 10) + ', ' : 'no conformation score yet, ') + 'genetic potential ' + Math.round(gp) + (foalExp.traitAvg != null ? ', conformation stats: ' + tr.strong + ' of ' + tr.n + ' traits Good or better, ' + tr.weak + ' weak' : ''));
      reasons.push(estBT != null
        ? 'For reference, estimated Breed Total ' + (Math.round(estBT * 10) / 10) + ' (average genetic potential ' + (Math.round(gp * 10) / 10) + ', average top conformation ' + (Math.round(conf * 10) / 10) + ')'
        : 'Average genetic potential ' + (Math.round(gp * 10) / 10) + ' (neither has a show score saved yet, so Breed Total is not estimated)');
      reasons.push(common.length ? 'Estimated inbreeding ' + (Math.round(coi * 100) / 100) + '% (' + common.length + ' shared ancestor' + (common.length === 1 ? '' : 's') + ')' : 'No shared ancestors in the saved pedigrees (0% inbreeding)');
      if (learnedNote) reasons.push(learnedNote);
      if (fixes.length) reasons.push('Covers her Below-average ' + fixes.join(', ') + ' (his rating there is Good or better)');
      if (shared.length) reasons.push('Watch: she and he are both Below average in ' + shared.join(', '));
      if (FERT_BONUS[fert] != null) reasons.push('His fertility is ' + sInfo.fertility + (FERT_BONUS[fert] > 0 ? ' (fewer failed coverings)' : FERT_BONUS[fert] < 0 ? ' (more failed coverings)' : ''));
      else reasons.push('His fertility is not recorded' + (isYoungInfo(sInfo) ? '' : ' (open his page after a fertility test)'));
      var lf = LM.on ? learnedFailure(state, life) : null;
      if (lf && lf.expected != null && Math.abs(lf.rate - lf.expected) >= 0.1) { learnedFail = (lf.expected - lf.rate) * 5; reasons.push('Learned: ' + lf.failed + ' of his ' + lf.n + ' coverings failed (' + Math.round(lf.rate * 100) + '%), against ' + Math.round(lf.expected * 100) + '% expected for his fertility'); }
      if (partnerName) reasons.push('Stallion of your breeding partner ' + partnerName);
      if (usable === 'unlisted') reasons.push('No stud fee or semen saved for him, so he may not be at stud (open his page or the Studs & Semen market to check)');
      if (yours) reasons.push('Your own stallion: no stud fee');
      else if (terms) reasons.push('Cost: ' + terms.summary);
      else reasons.push('Stud fee not known yet (open his page or his Breed page to record it)');
      if (hist.foals || hist.failed) reasons.push('Bred together before: ' + (hist.foals ? hist.foals + ' foal' + (hist.foals === 1 ? '' : 's') + (hist.bestScore ? ' (best score ' + hist.bestScore + ')' : '') : '') + (hist.foals && hist.failed ? ', ' : '') + (hist.failed ? hist.failed + ' failed covering' + (hist.failed === 1 ? '' : 's') : ''));
      if (maxFeeNote && !yours && terms && (terms.currency || 'HRC') === 'HRC' && terms.fee > maxFeeNote) { out.byNotes++; return; }
      if (noteFx.reason) reasons.push(noteFx.reason);
      var geneFx = preferredGeneBonus(state, mareLife, life);
      geneFx.reasons.forEach(function (r) { reasons.push(r); });
      var score = baseScore + (partnerName ? 0.4 : 0) + 0.3 * fixes.length - 0.6 * shared.length - 0.2 * coi + fertBonus * (overallRules.fertilityMatters ? 2.5 : 1) + learnedFail + noteFx.bonus + geneFx.bonus;
      list.push({ partner: partnerName, unlisted: usable === 'unlisted', life: life, conf: conf != null ? Math.round(conf * 10) / 10 : null, traitAvg: foalExp.traitAvg, weakTraits: tr.weak, name: sInfo.name || ('#' + life), yours: yours, gp: Math.round(gp * 10) / 10, estBT: estBT != null ? Math.round(estBT * 10) / 10 : null, coi: Math.round(coi * 100) / 100, terms: terms, reasons: reasons, score: score });
    });
    // a breeder focus lifts partners that are strong in it (by how far above the others they stand)
    var FXp = focusOf(state);
    if (FXp.keys.length && list.length > 1) {
      focusKeysAll(FXp).forEach(function (k) {
        if (k === 'profit') return;
        var vals = list.map(function (it) { return focusMetric(state, it.life, k, FXp.discipline); }), known = vals.filter(function (v) { return v != null; });
        if (known.length < 2) return;
        var mean = known.reduce(function (a, b) { return a + b; }, 0) / known.length, sd = Math.sqrt(known.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / known.length);
        if (!sd) return;
        list.forEach(function (it, i) {
          if (vals[i] == null) return;
          var z = Math.max(-2, Math.min(2, (vals[i] - mean) / sd));
          it.score += 0.6 * z;
          if (z >= 0.5) it.reasons.push('Strong in your breeding focus, ' + focusLabel(k));
          else if (z <= -0.5) it.reasons.push('Weak in your breeding focus, ' + focusLabel(k));
        });
      });
    }
    list.sort(function (a, b) { return b.score - a.score; });
    out.suggestions = list.slice(0, limit || 10);
    // your own stallions and other players' stallions, each ranked on its own
    out.mine = list.filter(function (x) { return x.yours; }).slice(0, 5);
    out.others = list.filter(function (x) { return !x.yours; }).slice(0, 5);
    return out;
  }

  // ---------- stud fees you paid to breed to someone else's stallion ----------
  // Bank row: "You paid 35 000 HRC + 1 000 HRC for transport to <owner> to breed <mare> with the stud <stallion>."
  // sf = { fee, currency, transport, studOwner, mareName, mareLife, stallionName, stallionLife, date }
  // The Breed click may already have saved the covering (no price yet): the fee is added to that record.
  // Returns 'added', 'updated' or ''.
  function tidyName(n) { return String(n || '').replace(/^!/, '').replace(/[|]$/, '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function applyStudFee(state, sf) {
    if (!sf || !(sf.fee > 0)) return '';
    var me = String((state.settings && state.settings.myUsername) || '').trim();
    var mareLife = sf.mareLife || '';
    if (!mareLife) {
      Object.keys(state.horseInfo || {}).forEach(function (l) {
        var i = state.horseInfo[l];
        if (!mareLife && i && i.sex === 'mare' && tidyName(i.name) === tidyName(sf.mareName)) mareLife = l;
      });
    }
    var sid = findStallionMatch(state.stallions || [], { stallionLifeNumber: sf.stallionLife, stallionName: sf.stallionName });
    if (!sid) {
      sid = uid();
      state.stallions.push({ id: sid, createdAt: Date.now(), status: 'Active', name: sf.stallionName || ('#' + sf.stallionLife), lifeNumber: sf.stallionLife ? String(sf.stallionLife) : '', owned: false });
      if (!state.breedings) state.breedings = {};
      state.breedings[sid] = [];
    }
    var studRec = state.stallions.find(function (x) { return x.id === sid; });
    if (studRec && sf.date >= String((studRec.lastFee && studRec.lastFee.date) || '')) studRec.lastFee = { fee: sf.fee, transport: sf.transport || 0, currency: sf.currency || 'HRC', date: sf.date || '', studOwner: sf.studOwner || '' };
    var list = state.breedings[sid] || (state.breedings[sid] = []);
    var sameMare = function (b) { return mareLife ? String(b.mareLifeNumber) === String(mareLife) : tidyName(b.mareName) === tidyName(sf.mareName); };
    // already recorded with this fee on this date? nothing to do
    if (list.some(function (b) { return sameMare(b) && b.price === sf.fee && b.feeSource !== 'breed page' && (!b.date || !sf.date || b.date === sf.date); })) return '';
    // the Breed page already put its (cheapest-price) fee on this covering: the bank row has the amount really paid
    var fromBreedPage = list.find(function (b) { return sameMare(b) && b.feeSource === 'breed page' && b.status === 'Pending' && (!b.date || !sf.date || b.date === sf.date); });
    if (fromBreedPage) {
      fromBreedPage.price = sf.fee; fromBreedPage.currency = sf.currency || 'HRC';
      if (sf.transport) fromBreedPage.transport = sf.transport;
      if (sf.studOwner) fromBreedPage.studOwner = sf.studOwner;
      if (!fromBreedPage.date && sf.date) fromBreedPage.date = sf.date;
      fromBreedPage.feeSource = 'bank';
      return 'updated';
    }
    var pending = list.find(function (b) { return sameMare(b) && b.price == null && b.status === 'Pending' && (!b.date || !sf.date || b.date === sf.date); });
    if (pending) {
      pending.price = sf.fee;
      pending.currency = sf.currency || 'HRC';
      if (sf.transport) pending.transport = sf.transport;
      if (!pending.date && sf.date) pending.date = sf.date;
      if (!pending.studOwner && sf.studOwner) pending.studOwner = sf.studOwner;
      return 'updated';
    }
    list.push({
      id: uid(), createdAt: Date.now(),
      mareName: sf.mareName || '', mareLifeNumber: mareLife ? String(mareLife) : '', mareUrl: mareLife ? 'https://www.horsereality.com/horses/' + mareLife + '/' : '',
      breederName: me, breederUrl: '', price: sf.fee, currency: sf.currency || 'HRC', transport: sf.transport || 0, studOwner: sf.studOwner || '',
      feeType: 'Public', date: sf.date || '', status: 'Pending'
    });
    return 'added';
  }

  // ---------- foals found on a mare's Foals tab, or from a foal's own page ----------
  // A stallion's Offspring tab is the usual source of "Foal Born" rows, but it only helps for studs you
  // open it on. A mare's own Foals tab lists every foal she has had (with its sire), and a foal's page
  // names its dam and sire, so both can fill in her history. A foal is recorded once, under its sire
  // (an external-stud stub is created if the sire is not yet known).
  function foalLifeOf(url) {
    var m = /\/horses\/([0-9]+)/.exec(String(url || ''));
    return m ? m[1] : '';
  }
  function isMyMare(state, damLife) {
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    if (!me) return false;
    var damInfo = state.horseInfo && state.horseInfo[damLife];
    if (damInfo && String(damInfo.ownerName || '').trim().toLowerCase() === me) return true;
    var mine = false;
    Object.keys(state.breedings || {}).forEach(function (sid) {
      (state.breedings[sid] || []).forEach(function (b) {
        if (String(b.mareLifeNumber) === String(damLife) && String(b.breederName || '').trim().toLowerCase() === me) mine = true;
      });
    });
    return mine;
  }
  // f = { damLife, damName, damUrl, sireLife, sireName, foalLife, foalName, born (yyyy-mm-dd), score }
  // returns 'added', 'updated' or ''
  function addFoalRecord(state, f) {
    var found = null;
    Object.keys(state.breedings || {}).forEach(function (sid) {
      (state.breedings[sid] || []).forEach(function (b) { if (!found && foalLifeOf(b.foalUrl) === String(f.foalLife)) found = b; });
    });
    if (found) {
      var changed = false;
      if (f.score > 0 && f.score <= 100 && !found.foalScore) { found.foalScore = f.score; changed = true; }
      if (f.born && !found.dateBorn) { found.dateBorn = f.born; changed = true; }
      if (f.foalName && !found.foalName) { found.foalName = f.foalName; changed = true; }
      return changed ? 'updated' : '';
    }
    if (!f.sireLife) return '';
    var sid = findStallionMatch(state.stallions || [], { stallionLifeNumber: f.sireLife, stallionName: f.sireName });
    if (!sid) {
      sid = uid();
      state.stallions.push({ id: sid, createdAt: Date.now(), status: 'Active', name: f.sireName || ('#' + f.sireLife), lifeNumber: String(f.sireLife), owned: false });
      if (!state.breedings) state.breedings = {};
      state.breedings[sid] = [];
    }
    if (!state.breedings[sid]) state.breedings[sid] = [];
    var rec = {
      id: uid(), createdAt: Date.now(),
      mareName: f.damName || '', mareLifeNumber: String(f.damLife), mareUrl: f.damUrl || '',
      breederName: (state.settings && state.settings.myUsername) || '', breederUrl: '', price: null, currency: 'HRC', feeType: 'Public',
      date: '', status: 'Foal Born', foalName: f.foalName || '', foalUrl: 'https://www.horsereality.com/horses/' + f.foalLife + '/', dateBorn: f.born || ''
    };
    if (f.score > 0 && f.score <= 100) rec.foalScore = f.score;
    state.breedings[sid].push(rec);
    return 'added';
  }
  // One "Foal Born" row per foal: when the same foal turns up more than once (under one or several
  // stallions), keep the best copy (under a stallion you own, with a score and picture) and fold
  // the missing details of the others into it. Returns how many copies were removed.
  function dedupeFoals(state) {
    var byLife = {};
    Object.keys(state.breedings || {}).forEach(function (sid) {
      (state.breedings[sid] || []).forEach(function (b) {
        if (b.status !== 'Foal Born') return;
        var life = foalLifeOf(b.foalUrl);
        if (life) (byLife[life] = byLife[life] || []).push({ sid: sid, rec: b });
      });
    });
    var owned = {};
    (state.stallions || []).forEach(function (s) { if (s.owned !== false) owned[s.id] = true; });
    var weight = function (g) { return (owned[g.sid] ? 4 : 0) + (g.rec.foalScore ? 2 : 0) + (g.rec.foalImageUrl ? 1 : 0); };
    var removed = 0;
    Object.keys(byLife).forEach(function (life) {
      var group = byLife[life];
      if (group.length < 2) return;
      group.sort(function (a, b) { return weight(b) - weight(a); });
      var keep = group[0].rec;
      group.slice(1).forEach(function (g) {
        ['foalScore', 'foalImageUrl', 'dateBorn', 'foalName', 'mareUrl'].forEach(function (k) { if (!keep[k] && g.rec[k]) keep[k] = g.rec[k]; });
        state.breedings[g.sid] = (state.breedings[g.sid] || []).filter(function (x) { return x !== g.rec; });
        removed++;
      });
    });
    return removed;
  }
  // rows from the Foals tab of mare damLife; -1 = not one of your mares (nothing recorded), else how many changed
  function recordFoalsFromList(state, damLife, rows) {
    if (!isMyMare(state, damLife)) return -1;
    var info = state.horseInfo && state.horseInfo[damLife];
    var n = 0;
    (rows || []).forEach(function (r) {
      if (addFoalRecord(state, {
        damLife: damLife, damName: (info && info.name) || '', damUrl: 'https://www.horsereality.com/horses/' + damLife + '/',
        sireLife: r.sireLife, sireName: r.sireName, foalLife: r.foalLife, foalName: r.foalName, born: r.born || '', score: r.score
      })) n++;
    });
    return n;
  }
  function recordFoalFromHorse(state, info) {
    if (!info || !info.lifeNumber || !info.sire || !info.dam || !info.sire.lifeNumber || !info.dam.lifeNumber) return false;
    if (!isMyMare(state, String(info.dam.lifeNumber))) return false;
    var born = '';
    var d = new Date(info.dateOfBirth);
    if (!isNaN(d.getTime())) born = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    var damInfo = state.horseInfo && state.horseInfo[String(info.dam.lifeNumber)];
    return !!addFoalRecord(state, {
      damLife: String(info.dam.lifeNumber), damName: info.dam.name || (damInfo && damInfo.name) || '', damUrl: info.dam.url || '',
      sireLife: String(info.sire.lifeNumber), sireName: info.sire.name, foalLife: String(info.lifeNumber), foalName: info.name || '', born: born, score: 0
    });
  }

  // ---------- removing a horse from the ledger ----------
  // Deletes everything saved about a horse: its page data and tags, its stallion record with all the breedings
  // under him, the breeding rows where she is the mare, and foal rows for a foal that is this horse. With
  // ignoreName set, the horse also goes on state.settings.ignored so the ledger doesn't save it again until it is
  // allowed back (purgeIgnored repeats the removal if any page brings it back).
  function horseRemovalCounts(state, life) {
    life = String(life || '');
    var c = { stallion: 0, breedingsUnder: 0, breedingsAsMare: 0, foalRows: 0, hasData: !!((state.horseInfo || {})[life] || (state.horseMeta || {})[life]) };
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === life; });
    if (rec) { c.stallion = 1; c.breedingsUnder = (state.breedings[rec.id] || []).length; }
    Object.keys(state.breedings || {}).forEach(function (sid) {
      if (rec && sid === rec.id) return;
      (state.breedings[sid] || []).forEach(function (b) {
        if (String(b.mareLifeNumber) === life) c.breedingsAsMare++;
        else if (b.status === 'Foal Born' && foalLifeOf(b.foalUrl) === life) c.foalRows++;
      });
    });
    return c;
  }
  // ---------- recently deleted (undo) ----------
  // Removing a horse, a stallion or a breeding record keeps a copy for 30 days under state.trash so it can be put back.
  function trashPush(state, entry) {
    if (!state.trash) state.trash = [];
    entry.id = uid(); entry.deletedAt = Date.now();
    state.trash.push(entry);
    if (state.trash.length > 60) state.trash = state.trash.slice(-60);
  }
  function purgeTrash(state) {
    if (!state.trash) return 0;
    var cutoff = Date.now() - 30 * 86400000, before = state.trash.length;
    state.trash = state.trash.filter(function (t) { return t.deletedAt >= cutoff; });
    return before - state.trash.length;
  }
  function restoreTrash(state, id) {
    var i = (state.trash || []).findIndex(function (t) { return t.id === id; });
    if (i < 0) return false;
    var t = state.trash[i], d = t.data || {};
    if (t.kind === 'horse') {
      if (d.horseInfo) state.horseInfo[t.life] = d.horseInfo;
      if (d.horseMeta) state.horseMeta[t.life] = d.horseMeta;
      if (d.stallion && !state.stallions.some(function (s) { return s.id === d.stallion.id; })) {
        state.stallions.push(d.stallion);
        state.breedings[d.stallion.id] = d.breedingsUnder || [];
      }
      (d.rows || []).forEach(function (r) {
        if (!state.breedings[r.sid]) state.breedings[r.sid] = [];
        state.breedings[r.sid].push(r.row);
      });
      if (state.settings && state.settings.ignored) { var ign = Object.assign({}, state.settings.ignored); delete ign[t.life]; state.settings.ignored = ign; }
    } else if (t.kind === 'stallion') {
      if (d.stallion && !state.stallions.some(function (s) { return s.id === d.stallion.id; })) state.stallions.push(d.stallion);
      state.breedings[d.stallion.id] = d.breedings || [];
    } else if (t.kind === 'breeding') {
      if (!state.breedings[d.sid]) state.breedings[d.sid] = [];
      state.breedings[d.sid].push(d.row);
    }
    state.trash.splice(i, 1);
    return true;
  }
  function removeHorse(state, life, ignoreName) {
    life = String(life || '');
    if (!life) return 0;
    var n = 0;
    if (ignoreName != null) {
      var snap = { horseInfo: state.horseInfo && state.horseInfo[life], horseMeta: state.horseMeta && state.horseMeta[life], rows: [] };
      var srec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === life; });
      if (srec) { snap.stallion = srec; snap.breedingsUnder = state.breedings[srec.id] || []; }
      Object.keys(state.breedings || {}).forEach(function (sid) {
        if (srec && sid === srec.id) return;
        (state.breedings[sid] || []).forEach(function (b) {
          if (String(b.mareLifeNumber) === life || (b.status === 'Foal Born' && foalLifeOf(b.foalUrl) === life)) snap.rows.push({ sid: sid, row: b });
        });
      });
      trashPush(state, { kind: 'horse', life: life, name: String(ignoreName || '#' + life), data: JSON.parse(JSON.stringify(snap)) });
    }
    if (state.horseInfo && state.horseInfo[life]) { delete state.horseInfo[life]; n++; }
    if (state.horseMeta && state.horseMeta[life]) { delete state.horseMeta[life]; n++; }
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === life; });
    if (rec) {
      delete state.breedings[rec.id];
      state.stallions = state.stallions.filter(function (s) { return s !== rec; });
      n++;
    }
    Object.keys(state.breedings || {}).forEach(function (sid) {
      var before = (state.breedings[sid] || []).length;
      state.breedings[sid] = (state.breedings[sid] || []).filter(function (b) {
        if (String(b.mareLifeNumber) === life) return false;
        if (b.status === 'Foal Born' && foalLifeOf(b.foalUrl) === life) return false;
        return true;
      });
      n += before - state.breedings[sid].length;
    });
    if (ignoreName != null) {
      if (!state.settings) state.settings = {};
      state.settings.ignored = Object.assign({}, state.settings.ignored);
      state.settings.ignored[life] = String(ignoreName || '#' + life);
    }
    return n;
  }
  function purgeIgnored(state) {
    var ignored = (state.settings && state.settings.ignored) || {};
    var n = 0;
    Object.keys(ignored).forEach(function (life) { n += removeHorse(state, life, null); });
    return n;
  }

  // ---------- sales ----------
  // state.horseMeta[life].sale = { price, currency, date, buyer, recordedAt }. A horse
  // counts as sold when its herd status is Sold or, for a stallion, its record is.
  function isSoldLife(state, life) {
    if (!life) return false;
    var m = state.horseMeta && state.horseMeta[life];
    if (m && m.status === 'Sold') return true;
    var s = (state.stallions || []).find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(life); });
    return !!(s && s.status === 'Sold');
  }
  function saleOf(state, life) {
    var m = state.horseMeta && state.horseMeta[life];
    var sa = m && m.sale;
    if (!sa || !(Number(sa.price) > 0)) return null;
    return { price: Number(sa.price), currency: sa.currency || 'HRC', date: sa.date || '', buyer: sa.buyer || '' };
  }
  // sale price minus what was paid (price + shipping); null unless all the amounts share a currency
  function profitOf(state, life) {
    var sa = saleOf(state, life), p = purchaseOf(state, life);
    if (!sa || !p) return null;
    var cost = p.price + p.shipping;
    if (!cost) return null;
    if (p.price && p.currency !== sa.currency) return null;
    if (p.shipping && p.shippingCurrency !== sa.currency) return null;
    return { cost: cost, profit: sa.price - cost, currency: sa.currency };
  }

  // ---------- purchase criteria (per breed) ----------
  // state.settings.buyCriteria = { '' : {...}, '<breed key>': {...} }: the same fields as goals (minGP, minConf, minBT,
  // traitWorst/traitWorstMax, healthWorst/healthWorstMax, minFert) plus maxPrice (HRC) and needTraits (traits that
  // must be Good or better). A breed's own value wins; otherwise the all-breeds value applies.
  var BUY_FIELDS = ['minGP', 'minConf', 'minBT', 'traitWorst', 'traitWorstMax', 'healthWorst', 'healthWorstMax', 'minFert', 'maxPrice'];
  // Each field is looked up in this order: the breed for that sex, the breed, all breeds for that sex, all breeds. The
  // sex scopes are stored as 'breedkey|mare' and 'breedkey|stallion' ('|mare' = all breeds); mares and fillies are
  // 'mare', stallions and colts are 'stallion'.
  function buyScopeKeys(breed, sex) {
    var bk = breed ? breedKeyOf(breed) : '', sx = sex === 'mare' || sex === 'stallion' ? sex : '';
    var keys = [];
    if (bk && sx) keys.push(bk + '|' + sx);
    if (bk) keys.push(bk);
    if (sx) keys.push('|' + sx);
    keys.push('');
    return keys;
  }
  function buyCriteriaOf(state, breed, sex) {
    var all = (state && state.settings && state.settings.buyCriteria) || {};
    var keys = buyScopeKeys(breed, sex), raw = {};
    BUY_FIELDS.forEach(function (k) {
      for (var i = 0; i < keys.length; i++) { var o = all[keys[i]]; if (o && o[k] != null && o[k] !== '') { raw[k] = o[k]; break; } }
    });
    var need = [];
    for (var j = 0; j < keys.length; j++) { var oo = all[keys[j]]; if (oo && oo.needTraits && oo.needTraits.length) { need = oo.needTraits; break; } }
    var mp = parseFloat(raw.maxPrice);
    var goals = normalizeGoals(raw);
    var any = Object.keys(goals).some(function (k) { return goals[k] != null; }) || need.length > 0 || mp > 0;
    return { goals: goals, needTraits: need, maxPrice: mp > 0 ? mp : null, any: !!any };
  }
  function traitValue(info, trait) {
    var ct = info && info.confTraits;
    if (!ct) return null;
    var key = Object.keys(ct).find(function (k) { return k.toLowerCase().replace(/\s+/g, '') === trait.toLowerCase(); });
    return key ? traitRankOf(ct[key]) : null;
  }
  function purchaseSections(state, life, crit) {
    var info = (state.horseInfo && state.horseInfo[life]) || {};
    var s = goalSectionsWith(state, life, crit.goals);
    s.need = { label: 'Traits needed', state: 'na', text: 'no goal' };
    if (crit.needTraits.length) {
      if (!info.confTraits) s.need = { label: 'Traits needed', state: 'na', text: 'no data yet' };
      else {
        var below = crit.needTraits.filter(function (t) { var r = traitValue(info, t); return r == null || r < 2; });
        s.need = { label: 'Traits needed (Good or better)', state: below.length ? 'bad' : 'ok', text: below.length ? 'below Good in ' + below.join(', ') : 'Good or better in all' };
      }
    }
    return s;
  }
  // Would this horse help the herd? Compared with your own (not sold or retired) horses of the same breed.
  function herdBenefit(state, life) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life];
    var out = { verdict: 'unknown', lines: [], herdSize: 0 };
    if (!info) return out;
    var herd = ownedHorses(state).filter(function (h) {
      return String(h.lifeNumber) !== life && (h.info.sex === 'mare' || h.info.sex === 'stallion') && !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && sameBreed(h.info, info);
    });
    // a mare or filly is compared with your mares and fillies, a colt or stallion with your colts and stallions
    var sameSex = herd.filter(function (h) { return h.info.sex === info.sex; });
    var groupName = info.sex === 'stallion' ? 'colts & stallions' : 'mares & fillies';
    if (sameSex.length >= 3) herd = sameSex; else groupName = 'horses';
    out.herdSize = herd.length;
    out.group = groupName;
    if (herd.length < 3) { out.lines.push({ ok: null, text: 'Fewer than 3 of your horses of this breed are saved, so there is nothing to compare it with' }); return out; }
    function vals(fn) { return herd.map(fn).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; }); }
    function pick(arr, p) { return arr.length ? arr[Math.min(arr.length - 1, Math.round((arr.length - 1) * p))] : 0; }
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var mine = { gp: Number(info.geneticPotential) || 0, conf: bestConformation(meta).best || 0 };
    mine.bt = Math.max(Number(meta.btBest) || 0, breedTotal(mine.gp, mine.conf));
    var pos = 0, neg = 0;
    [['Genetic potential', mine.gp, vals(function (h) { return Number(h.info.geneticPotential) || 0; }), 0],
     ['Top conformation', mine.conf, vals(function (h) { return bestConformation(h.meta).best; }), 1],
     ['Breed Total', mine.bt, vals(function (h) { return horseBT(state, h.lifeNumber); }), 1]].forEach(function (m) {
      var label = m[0], v = m[1], arr = m[2], dec = m[3];
      if (!(v > 0)) { out.lines.push({ ok: null, text: label + ': not known yet' }); return; }
      if (arr.length < 3) return;
      var med = pick(arr, 0.5), top = pick(arr, 0.75), r = function (n) { return Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec); };
      if (v >= top) { pos++; out.lines.push({ ok: true, text: label + ' ' + r(v) + ' is in the top quarter of your ' + herd.length + ' ' + groupName + ' (median ' + r(med) + ')' }); }
      else if (v >= med) { pos++; out.lines.push({ ok: true, text: label + ' ' + r(v) + ' is above your ' + groupName + ' median of ' + r(med) }); }
      else { neg++; out.lines.push({ ok: false, text: label + ' ' + r(v) + ' is below your ' + groupName + ' median of ' + r(med) }); }
    });
    // traits your herd is weak in that this horse is strong in
    var weak = [], covers = [];
    ['Walk', 'Trot', 'Canter', 'Gallop', 'Posture', 'Head', 'Neck', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters'].forEach(function (t) {
      var ranks = herd.map(function (h) { return traitValue(h.info, t); }).filter(function (r) { return r != null; });
      if (ranks.length < 3) return;
      if (ranks.filter(function (r) { return r <= 1; }).length / ranks.length >= 0.5) {
        weak.push(t);
        var mr = traitValue(info, t);
        if (mr != null && mr >= 2) covers.push(t);
      }
    });
    if (covers.length) { pos++; out.lines.push({ ok: true, text: 'Strong (Good or better) in ' + covers.join(', ') + ', where your herd is weakest' }); }
    else if (weak.length && info.confTraits) out.lines.push({ ok: null, text: 'Your herd is weakest in ' + weak.join(', ') + '; this horse is not strong there' });
    // your breeder focus counts for more
    var FXh = focusOf(state);
    focusKeysAll(FXh).forEach(function (k) {
      if (k === 'profit') return;
      var mv = focusMetric(state, life, k, FXh.discipline);
      if (mv == null) return;
      var st = focusStanding(k, mv, herd.map(function (h) { return focusMetric(state, h.lifeNumber, k, FXh.discipline); }));
      if (st === 1) { pos++; out.lines.push({ ok: true, text: 'Strong in your focus, ' + focusLabel(k) + ': in the top quarter of your ' + groupName }); }
      else if (st === -1) { neg++; out.lines.push({ ok: false, text: 'Weak in your focus, ' + focusLabel(k) + ': in the bottom quarter of your ' + groupName }); }
    });
    out.verdict = pos >= 2 && neg === 0 ? 'helps' : pos > neg ? 'maybe' : 'no';
    return out;
  }
  // Starting values for the purchase criteria, from your own herd of that breed ('' = all your horses)
  function buyAdvice(state, breed, sex) {
    var herd = ownedHorses(state).filter(function (h) {
      return (h.info.sex === 'mare' || h.info.sex === 'stallion') && (!sex || h.info.sex === sex) && !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && (!breed || breedKeyOf(h.info.breed) === breedKeyOf(breed));
    });
    var out = { herdSize: herd.length, tips: [], traits: null };
    if (herd.length < 3) return out;
    var cur = buyCriteriaOf(state, breed, sex).goals;
    function vals(fn) { return herd.map(fn).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; }); }
    function pick(arr, p) { return arr.length ? arr[Math.min(arr.length - 1, Math.round((arr.length - 1) * p))] : 0; }
    [['minGP', 'Genetic Potential', vals(function (h) { return Number(h.info.geneticPotential) || 0; }), 0],
     ['minConf', 'Top conformation', vals(function (h) { return bestConformation(h.meta).best; }), 1],
     ['minBT', 'Breed Total', vals(function (h) { return horseBT(state, h.lifeNumber); }), 1]].forEach(function (m) {
      if (m[2].length < 3) return;
      var f = Math.pow(10, m[3]), target = Math.round(pick(m[2], 0.6) * f) / f;
      if (cur[m[0]] == null || target > cur[m[0]]) out.tips.push({ field: m[0], label: m[1], current: cur[m[0]], suggested: target, why: 'A horse at ' + target + ' or more would be in the top ' + Math.round((1 - m[2].filter(function (v) { return v < target; }).length / m[2].length) * 100) + '% of your ' + herd.length + ' horses, so it lifts your herd.' });
    });
    var weak = [];
    ['Walk', 'Trot', 'Canter', 'Gallop', 'Posture', 'Head', 'Neck', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters'].forEach(function (t) {
      var ranks = herd.map(function (h) { return traitValue(h.info, t); }).filter(function (r) { return r != null; });
      if (ranks.length >= 3 && ranks.filter(function (r) { return r <= 1; }).length / ranks.length >= 0.5) weak.push(t);
    });
    if (weak.length) out.traits = { traits: weak, why: 'At least half of your horses are Below average or Average in these, so a horse that is Good or better there would help.' };
    // what the horses that proved themselves look like replaces the herd-percentile tip for the same field
    learnedBuyTips(state, breed, sex).forEach(function (t) {
      if (cur[t.field] != null && t.suggested <= cur[t.field]) return;
      out.tips = out.tips.filter(function (x) { return x.field !== t.field; });
      out.tips.push({ field: t.field, label: t.label, current: cur[t.field], suggested: t.suggested, why: t.why });
    });
    return out;
  }

  // ---------- prices seen on the market ----------
  // Past sales of yours plus what you saw on the market: the price you paid when you won a bid, and the highest bid on
  // a listing you lost (what the winner paid was at least that). Each is { life, name, bt, price, source }.
  function marketComps(state) {
    var out = [], trades = state.marketTrades || {};
    var bids = state.marketBids || {};
    Object.keys(bids).forEach(function (k) {
      var b = bids[k] || {};
      var life = String(b.life || trades[k] || (k.indexOf('life:') === 0 ? k.slice(5) : ''));
      if (!life) return;
      var bt = horseBT(state, life), price = 0, source = '';
      if (b.outcome === 'lost' && Number(b.highest) > 0) { price = Number(b.highest); source = 'lost bid'; }
      else if (b.outcome === 'won' && Number(b.amount) > 0) { price = Number(b.amount); source = 'won bid'; }
      if (!(bt > 0) || !price) return;
      out.push({ life: life, name: ((state.horseInfo || {})[life] || {}).name || ('#' + life), bt: bt, price: price, source: source });
    });
    return out;
  }
  function priceComps(state) { return memo(state, 'priceComps', function () { return priceCompsRaw(state); }); }
  function priceCompsRaw(state) {
    var comps = [];
    Object.keys(state.horseMeta || {}).forEach(function (l) {
      if (!isSoldLife(state, l)) return;
      var sa = saleOf(state, l), bt = horseBT(state, l);
      if (sa && sa.currency === 'HRC' && bt > 0) comps.push({ life: l, name: ((state.horseInfo || {})[l] || {}).name || ('#' + l), bt: bt, price: sa.price, source: 'sale' });
    });
    return comps.concat(marketComps(state));
  }
  // What horses of this Breed Total have gone for, from your sales and market results: { est, n } or null
  function priceBenchmark(state, life) {
    var bt = horseBT(state, life);
    if (!(bt > 0)) return null;
    var near = priceComps(state).filter(function (c) { return String(c.life) !== String(life); })
      .sort(function (a, b) { return Math.abs(a.bt - bt) - Math.abs(b.bt - bt); }).slice(0, 3);
    if (!near.length) return null;
    return { est: roundPrice(median(near.map(function (c) { return c.price / c.bt; })) * bt), n: near.length };
  }

  // ---------- one market row: the numbers, the checks against your purchase criteria, the herd and the price ----------
  // market = { asking, highest } (what the row shows). Returns { chips: [{ label, text, ok }], pass, bad, unknown, judged,
  // benefit, hover, bench } or null when the horse is not saved.
  function marketRowInfo(state, life, market) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life];
    if (!info) return null;
    market = market || {};
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var crit = buyCriteriaOf(state, info.breed, info.sex);
    var sec = crit.any ? purchaseSections(state, life, crit) : goalSections(state, life);
    var fs = fitSummary(state, life), benefit = herdBenefit(state, life);
    var gp = Number(info.geneticPotential) || 0, conf = bestConformation(meta).best || 0, bt = horseBT(state, life);
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    var chips = [];
    function chip(label, text, section) { chips.push({ label: label, text: text, ok: section && section.text !== 'no goal' && section.state !== 'na' ? section.state === 'ok' : null }); }
    chip('GP', gp > 0 ? String(gp) : '?', sec.gp);
    chip('Conf', conf > 0 ? String(r1(conf)) : '?', sec.conf);
    if (bt > 0 && sec.bt.text !== 'no goal') chip('BT', String(r1(bt)), sec.bt);
    var tc = traitCounts(info);
    var tsec = sec.traits.text !== 'no goal' ? sec.traits : (sec.need && sec.need.text !== 'no goal' ? sec.need : null);
    if (tsec) chip('Traits', tc ? (tc.VG + tc.GP + tc.G) + ' good+' + (tc.BA ? ', ' + tc.BA + ' BA' : '') : '?', tsec);
    var judged = [sec.gp, sec.conf, sec.bt, sec.traits, sec.health, sec.fertility, sec.need].filter(function (x) { return x && x.text !== 'no goal' && !x.skip; });
    var bad = judged.filter(function (x) { return x.state === 'bad'; }), unknown = judged.filter(function (x) { return x.state === 'na'; });
    var overPrice = !!(crit.maxPrice && market.asking && market.asking > crit.maxPrice);
    var pass = judged.length > 0 && !bad.length && !unknown.length && !overPrice;
    var bench = priceBenchmark(state, life);
    var shown = market.asking || market.highest || 0, priceLine = '';
    if (bench) {
      priceLine = 'Similar horses (Breed Total ' + r1(bt) + ') have gone for about ' + fmtMoney(bench.est) + ' HRC (' + bench.n + ' of your sales and market results)';
      if (shown) { var pct = Math.round((shown / bench.est - 1) * 100); priceLine += '; this one is ' + (Math.abs(pct) < 5 ? 'about the same' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below')); }
    }
    var groupName = info.sex === 'stallion' ? 'colts & stallions' : 'mares & fillies';
    var lines = ['HR Ledger — ' + (info.name || '#' + life) + (info.breed ? ' · ' + info.breed : '') + ' · ' + groupName.split(' ')[0] + (info.age != null && info.age !== '' ? ' · age ' + info.age : ''),
      'GP ' + (gp || '?') + '   Conf ' + (conf ? r1(conf) : '?') + '   Breed Total ' + (bt > 0 ? r1(bt) : '?') + (info.fertility ? '   Fertility ' + info.fertility : '')];
    lines.push(!judged.length ? 'No purchase criteria set for ' + groupName + ' yet (Purchase criteria in the ledger)' :
      pass ? '✓ Meets all ' + judged.length + ' of your purchase criteria for ' + groupName :
      bad.length ? '✗ Misses: ' + bad.map(function (x) { return x.label; }).join(', ') : '• Not all known yet: ' + unknown.map(function (x) { return x.label; }).join(', '));
    fs.lines.forEach(function (l) { lines.push((l.ok === true ? '✓ ' : l.ok === false ? '✗ ' : '• ') + l.text); });
    if (overPrice) lines.push('✗ Asking ' + fmtMoney(market.asking) + ' is above your limit of ' + fmtMoney(crit.maxPrice));
    if (priceLine) lines.push('$ ' + priceLine);
    var tb = suggestedTopBid(state, life);
    if (tb) lines.push('$ Suggested top bid about ' + fmtMoney(tb.bid) + ' HRC' + (tb.learned ? ' (leaves ' + Math.round(tb.margin * 100) + '% to resell, the average your ' + tb.sold + ' resales earned)' : ' (leaves 15% to resell; it adjusts once you have resold 3 horses you bought)'));
    var lbk = learnedBuying(state).byBreed.find(function (b) { return breedKeyOf(b.breed) === breedKeyOf(info.breed); });
    if (lbk) lines.push('\u2022 Learned: your ' + lbk.sold + ' resold ' + info.breed + ' horse' + (lbk.sold === 1 ? '' : 's') + ' made ' + (lbk.avgPct >= 0 ? '+' : '-') + Math.abs(Math.round(lbk.avgPct * 100)) + '% on average');
    return { chips: chips, pass: pass, bad: bad.map(function (x) { return x.label; }), unknown: unknown.map(function (x) { return x.label; }), judged: judged.length, benefit: benefit, hover: lines.join('\n'), bench: bench };
  }

  // ---------- Studs & Semen market: a stallion's row compared with your mares ----------
  // A mare's own profile in the same shape as an expected foal, for comparing a foal with her
  function foalProfileOfMare(state, life) {
    var info = state.horseInfo && state.horseInfo[life], p = { conf: bestConformation((state.horseMeta && state.horseMeta[life]) || {}).best || null, gp: Number(info && info.geneticPotential) || 0, traitAvg: null, weak: 0, strong: 0 };
    if (info && info.confTraits) {
      var ranks = Object.keys(info.confTraits).map(function (t) { return traitRankOf(info.confTraits[t]); }).filter(function (r) { return r != null; });
      if (ranks.length) { p.traitAvg = ranks.reduce(function (a, b) { return a + b; }, 0) / ranks.length; p.weak = ranks.filter(function (r) { return r < 1; }).length; p.strong = ranks.filter(function (r) { return r >= 2; }).length; }
    }
    return p;
  }
  // one number to pick which of your stallions is the baseline (conformation score, genetic potential on the same scale, stats)
  function foalScoreOf(e, FX) {
    var w = function (k) { return FX.keys.indexOf(k) > -1 ? 1.6 : 1; };
    return w('conf') * (e.conf || 0) + w('gp') * (e.gp || 0) / 10 + w('comp') * (e.traitAvg != null ? e.traitAvg * 5 : 0);
  }
  // Is foal a better, the same or worse than foal b? Judged on three things separately, not on Breed Total: the
  // conformation score (a difference of 0.5 counts), genetic potential (3) and the conformation stats (the average rating
  // of the traits, 0.1 of a rating step). Better = ahead on balance with nothing clearly worse; your breeder focus counts more.
  function compareFoals(a, b, FX) {
    var w = function (k) { return FX.keys.indexOf(k) > -1 ? 1.6 : 1; }, d = {}, score = 0, clearBad = 0;
    if (a.conf != null && b.conf != null && a.conf > 0 && b.conf > 0) { d.conf = a.conf - b.conf; score += w('conf') * (d.conf >= 0.5 ? 1 : d.conf <= -0.5 ? -1 : 0); if (d.conf <= -1) clearBad++; }
    if (a.gp > 0 && b.gp > 0) { d.gp = a.gp - b.gp; score += w('gp') * (d.gp >= 3 ? 1 : d.gp <= -3 ? -1 : 0); if (d.gp <= -6) clearBad++; }
    if (a.traitAvg != null && b.traitAvg != null) { d.traits = a.traitAvg - b.traitAvg; d.weak = a.weak - b.weak; score += w('comp') * (d.traits >= 0.1 ? 1 : d.traits <= -0.1 ? -1 : 0); if (d.traits <= -0.2) clearBad++; }
    return { verdict: score >= 1 && !clearBad ? 'better' : score <= -1 ? 'worse' : 'same', score: score, d: d, known: Object.keys(d).length };
  }
  // The estimated foal for one mare and one stallion, the way the breeding suggestions work it out (average parents,
  // adjusted by what the ledger learned from your own foals): { estBT, gp, conf, coi, common, fixes, shared, note } or null
  function pairEstimate(state, mareLife, sireLife, LM) {
    var mInfo = state.horseInfo && state.horseInfo[mareLife], sInfo = state.horseInfo && state.horseInfo[sireLife];
    if (!mInfo || !sInfo || mInfo.geneticPotential == null || sInfo.geneticPotential == null) return null;
    var mConf = bestConformation((state.horseMeta && state.horseMeta[mareLife]) || {}).best, sConf = bestConformation((state.horseMeta && state.horseMeta[sireLife]) || {}).best;
    var gp = (Number(mInfo.geneticPotential) + Number(sInfo.geneticPotential)) / 2;
    var confs = [mConf, sConf].filter(function (x) { return x > 0; });
    var conf = confs.length ? confs.reduce(function (a, b) { return a + b; }, 0) / confs.length : null, note = '';
    if (LM && LM.on && LM.gp.n >= 3) gp += LM.gp.off;
    if (LM && LM.on && conf && sConf > 0 && mConf > 0) { var pf = predictFoalConf(LM, mConf, sConf, mareLife, String(sireLife), breedKeyOf(mInfo.breed)); conf = pf.conf; note = pf.note; }
    var common = commonAncestors(ancestorMap(state, mareLife, 3), ancestorMap(state, sireLife, 3)), coi = estimateCoi(common);
    var shared = [], fixes = [];
    if (mInfo.confTraits && sInfo.confTraits) {
      Object.keys(mInfo.confTraits).forEach(function (t) {
        var a = traitRankOf(mInfo.confTraits[t]), b = traitRankOf(sInfo.confTraits[t]);
        if (a == null || b == null) return;
        if (a === 0 && b === 0) shared.push(t); else if (a === 0 && b >= 2) fixes.push(t);
      });
    }
    // the foal's expected conformation traits: the average of the two parents' ratings (0 Below average ... 4 Very good)
    var tr = { n: 0, sum: 0, weak: 0, strong: 0 };
    if (mInfo.confTraits && sInfo.confTraits) {
      Object.keys(mInfo.confTraits).forEach(function (t) {
        var a = traitRankOf(mInfo.confTraits[t]), b = traitRankOf(sInfo.confTraits[t]);
        if (a == null || b == null) return;
        var e = (a + b) / 2;
        tr.n++; tr.sum += e;
        if (e < 1) tr.weak++;
        if (e >= 2) tr.strong++;
      });
    }
    return { estBT: conf ? breedTotal(gp, conf) : null, gp: gp, conf: conf, coi: coi, common: common, fixes: fixes, shared: shared, note: note,
      traitAvg: tr.n ? tr.sum / tr.n : null, weak: tr.weak, strong: tr.strong, traitN: tr.n };
  }
  // Fees the other studs in the ledger ask, by Breed Total: what a stud of this Breed Total usually costs { est, n }
  function studFeeBenchmark(state, life) {
    var bt = horseBT(state, life);
    if (!(bt > 0)) return null;
    var comps = [];
    Object.keys(state.horseMeta || {}).forEach(function (l) {
      var t = state.horseMeta[l] && state.horseMeta[l].studTerms;
      if (!t || String(l) === String(life)) return;
      var fee = (t.public && t.public.HRC) || (t.cheapest && t.cheapest.HRC) || 0, b = horseBT(state, l);
      if (fee > 0 && b > 0) comps.push({ bt: b, fee: fee });
    });
    if (comps.length < 2) return null;
    var near = comps.sort(function (a, b) { return Math.abs(a.bt - bt) - Math.abs(b.bt - bt); }).slice(0, 3);
    return { est: roundPrice(median(near.map(function (c) { return c.fee / c.bt; })) * bt), n: near.length };
  }
  // fees = { HRC: n, DP: n, ... } as the row shows them. Returns { chips, extraPills, verdict, paint, hover, mares } or null when
  // the stallion is not saved.
  function studRowInfo(state, life, fees) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life];
    if (!info || info.sex !== 'stallion') return null;
    fees = fees || {};
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var crit = buyCriteriaOf(state, info.breed, 'stallion');
    var sec = crit.any ? purchaseSections(state, life, crit) : goalSections(state, life);
    var gp = Number(info.geneticPotential) || 0, conf = bestConformation(meta).best || 0, bt = horseBT(state, life);
    var r1 = function (n) { return Math.round(n * 10) / 10; };
    var chips = [];
    function chip(label, text, section) { chips.push({ label: label, text: text, ok: section && section.text !== 'no goal' && section.state !== 'na' ? section.state === 'ok' : null }); }
    chip('GP', gp > 0 ? String(gp) : '?', sec.gp);
    chip('Conf', conf > 0 ? String(r1(conf)) : '?', sec.conf);
    if (bt > 0 && sec.bt.text !== 'no goal') chip('BT', String(r1(bt)), sec.bt);
    var tc = traitCounts(info), tsec = sec.traits.text !== 'no goal' ? sec.traits : (sec.need && sec.need.text !== 'no goal' ? sec.need : null);
    if (tsec) chip('Traits', tc ? (tc.VG + tc.GP + tc.G) + ' good+' + (tc.BA ? ', ' + tc.BA + ' BA' : '') : '?', tsec);
    var fert = String(info.fertility || '').trim();
    if (fert) chip('Fert', fert, sec.fertility);
    var judged = [sec.gp, sec.conf, sec.bt, sec.traits, sec.health, sec.fertility, sec.need].filter(function (x) { return x && x.text !== 'no goal' && !x.skip; });
    var bad = judged.filter(function (x) { return x.state === 'bad'; });
    // your free adult mares of this breed, and what a foal by him would be against a foal by your own best stallion
    var LM = learnedModel(state), me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var ownStuds = (state.stallions || []).filter(function (s) { return s.lifeNumber && s.owned !== false && stallionAvailable(state, String(s.lifeNumber)) && sameBreed(state.horseInfo[s.lifeNumber] || {}, info); });
    var FXs = focusOf(state), mares = [], busy = 0, skipped = 0;
    ownedHorses(state).forEach(function (h) {
      if (h.info.sex !== 'mare' || isYoungInfo(h.info) || !sameBreed(h.info, info) || isSoldLife(state, h.lifeNumber) || isArchivedHorse(h) || h.meta.status === 'Companion') return;
      if (horseNoteRules(state, h.lifeNumber).noBreed) { skipped++; return; }
      if (mareBreedStatus(state, h.lifeNumber).status) { busy++; return; }
      var est = pairEstimate(state, h.lifeNumber, life, LM);
      if (!est || (est.conf == null && !(est.gp > 0))) return;
      var mareProfile = foalProfileOfMare(state, h.lifeNumber), own = null;
      ownStuds.forEach(function (s) { var e = pairEstimate(state, h.lifeNumber, String(s.lifeNumber), LM); if (e && (!own || foalScoreOf(e, FXs) > foalScoreOf(own.est, FXs))) own = { name: s.name, est: e }; });
      var cmp = compareFoals(est, own ? own.est : mareProfile, FXs);
      mares.push({ life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), est: est, own: own, cmp: cmp, coiHigh: est.coi > 6.25 });
    });
    // best first: the biggest overall gain on conformation score, genetic potential and conformation stats
    mares.sort(function (a, b) { return b.cmp.score - a.cmp.score || (b.est.conf || 0) - (a.est.conf || 0); });
    var better = mares.filter(function (m) { return m.cmp.verdict === 'better' && !m.coiHigh; });
    var worse = mares.filter(function (m) { return m.cmp.verdict === 'worse'; });
    var verdict = !mares.length ? 'unknown' : better.length ? 'better' : (worse.length >= mares.length / 2 ? 'worse' : 'same');
    // the fee
    var feeParts = Object.keys(fees).filter(function (c) { return fees[c] > 0; }).map(function (c) { return fmtMoney(fees[c]) + ' ' + c; });
    var feeHRC = Number(fees.HRC) || 0, bench = studFeeBenchmark(state, life), maxFee = parseFloat(state.settings && state.settings.calcMaxFee) || 0, ruleMax = overallNoteRules(state).maxFee;
    if (ruleMax && (!maxFee || ruleMax < maxFee)) maxFee = ruleMax;
    var lines = ['HR Ledger — ' + (info.name || '#' + life) + (info.breed ? ' · ' + info.breed : '') + ' · stallion' + (info.age != null && info.age !== '' ? ' · age ' + info.age : ''),
      'GP ' + (gp || '?') + '   Conf ' + (conf ? r1(conf) : '?') + '   Breed Total ' + (bt > 0 ? r1(bt) : '?') + (fert ? '   Fertility ' + fert + (FERT_FAIL[fert.toLowerCase()] != null ? ' (about ' + Math.round(FERT_FAIL[fert.toLowerCase()] * 100) + '% of coverings fail)' : '') : '')];
    lines.push('STUD FEE: ' + (feeParts.length ? feeParts.join(' · ') : 'not shown on the row'));
    if (feeHRC && bench) { var pct = Math.round((feeHRC / bench.est - 1) * 100); lines.push('   Studs of his Breed Total usually ask about ' + fmtMoney(bench.est) + ' HRC (' + bench.n + ' studs you have seen); this one is ' + (Math.abs(pct) < 5 ? 'about the same' : Math.abs(pct) + '% ' + (pct > 0 ? 'above' : 'below'))); }
    if (feeHRC && maxFee && feeHRC > maxFee) lines.push('✗ Above your maximum stud fee of ' + fmtMoney(maxFee) + ' HRC');
    lines.push(!judged.length ? '• No purchase criteria set for colts & stallions yet' : bad.length ? '✗ Misses your criteria for stallions: ' + bad.map(function (x) { return x.label; }).join(', ') : '✓ Meets your criteria for stallions');
    lines.push('');
    if (!mares.length) lines.push('YOUR MARES: none of your free adult ' + (info.breed || 'mares') + ' mares could be compared' + (busy ? ' (' + busy + ' in foal or covered)' : '') + ' \u2014 their genetic potential must be saved');
    else {
      lines.push('YOUR MARES (judged on the foal\u2019s conformation score, genetic potential and conformation stats, not on Breed Total): ' + (verdict === 'better' ? 'BETTER than your own stallions for ' + better.length + ' of ' + mares.length : verdict === 'worse' ? 'WORSE than your own stallions for most of your ' + mares.length + ' mares' : 'about the same as your own stallions') + (busy ? ' (' + busy + ' more are in foal or covered)' : ''));
      var sgn = function (n, dec) { var v = Math.round(n * Math.pow(10, dec)) / Math.pow(10, dec); return (v >= 0 ? '+' : '\u2212') + Math.abs(v); };
      mares.slice(0, 5).forEach(function (m) {
        var e = m.est, d = m.cmp.d, against = m.own ? m.own.name : 'her', bits = [];
        if (e.conf != null) bits.push('conformation score about ' + r1(e.conf) + (d.conf != null ? ' (' + sgn(d.conf, 1) + ')' : ''));
        if (e.gp > 0) bits.push('genetic potential about ' + Math.round(e.gp) + (d.gp != null ? ' (' + sgn(d.gp, 0) + ')' : ''));
        if (e.traitAvg != null) bits.push('stats: ' + e.strong + ' of ' + e.traitN + ' traits Good or better, ' + e.weak + ' weak' + (d.weak != null ? ' (' + (d.weak < 0 ? d.weak : d.weak > 0 ? '+' + d.weak : 'same') + ' weak against ' + against + ')' : ''));
        var why = [];
        if (e.fixes.length) why.push('he is strong where she is Below average: ' + e.fixes.join(', '));
        if (e.shared.length) why.push('both Below average in ' + e.shared.join(', '));
        why.push(e.common.length ? 'inbreeding about ' + (Math.round(e.coi * 100) / 100) + '%' : 'no shared ancestors');
        lines.push((better.indexOf(m) > -1 ? '\u2713 ' : m.cmp.verdict === 'worse' ? '\u2717 ' : '\u2022 ') + m.name + ' (compared with ' + against + '): ' + bits.join('; ') + ' \u2014 ' + why.join('; '));
      });
      if (mares.length > 5) lines.push('   and ' + (mares.length - 5) + ' more mare' + (mares.length - 5 === 1 ? '' : 's') + ' compared');
      // would the best foal meet your goals?
      var g = goalsOf(state, 'mare'), be = (better[0] || mares[0]).est, gl = [];
      if (g.minConf != null && be.conf != null) gl.push('conformation ' + r1(be.conf) + (be.conf >= g.minConf ? ' meets' : ' is below') + ' your goal of ' + g.minConf);
      if (g.minGP != null && be.gp > 0) gl.push('genetic potential ' + Math.round(be.gp) + (be.gp >= g.minGP ? ' meets' : ' is below') + ' your goal of ' + g.minGP);
      if (gl.length) lines.push('Best foal against your goals: ' + gl.join('; '));
      var learnedNote = mares[0].est.note;
      if (learnedNote) lines.push('', learnedNote);
    }
    if (skipped) lines.push('(' + skipped + ' mare' + (skipped === 1 ? '' : 's') + ' left out because of your notes)');
    var top = better[0] || null, extra = [];
    if (feeParts.length) extra.push({ text: 'Fee ' + feeParts[0] + (feeParts.length > 1 ? ' +' : ''), bg: feeHRC && maxFee && feeHRC > maxFee ? '#C0281E' : '#46592C' });
    if (verdict === 'better') extra.push({ text: 'Better for ' + better.length + ' mare' + (better.length === 1 ? '' : 's') + ' · best ' + top.name + '', bg: '#1E8449' });
    else if (verdict === 'worse') extra.push({ text: 'Worse for your mares', bg: '#C0281E' });
    else if (verdict === 'same') extra.push({ text: 'Same as your studs', bg: '#6E7260' });
    var frac = judged.length ? (judged.length - bad.length) / judged.length : 1;
    var paint = verdict === 'unknown' ? null : { state: verdict === 'better' ? (judged.length && !bad.length ? 'gold' : 'lifts') : verdict === 'worse' ? 'no' : 'lifts', frac: frac, plain: verdict === 'same' };
    return { chips: chips, extraPills: extra, verdict: verdict, paint: paint, hover: lines.join('\n'), mares: mares, bench: null, judged: judged.length };
  }

  // ---------- taglines written by HRToolkit, read from the ranch page ----------
  // With HRToolkit installed, each horse's tagline holds numbers the ledger would otherwise need a visit to the horse's
  // page for, e.g. "3G|6A|3BA|580|64|69.176" = 3 Good, 6 Average, 3 Below average traits | genetic potential 580 | Breed
  // Total 64 (rounded) | conformation score 69.176, and its private stable tag "69.18-62.69|GGGGG" = all-time high and low
  // conformation | the five health ratings (colic, hoof, back, respiratory, lameness). The ranch page lists every horse, so one
  // visit fills them all. A tag is only used when its numbers agree with each other (the Breed Total must match the genetic
  // potential and conformation), so a differently laid out tagline is ignored.
  function parseToolkitTagline(text) {
    var parts = String(text || '').replace(/\s+/g, '').split('|');
    if (parts.length < 3) return null;
    var conf = parseFloat(parts[parts.length - 1]), bt = parseInt(parts[parts.length - 2], 10), gp = parseInt(parts[parts.length - 3], 10);
    if (!(conf >= 20 && conf <= 100) || !(bt >= 20 && bt <= 100) || !(gp >= 300 && gp <= 1000)) return null;
    if (!/^\d+(\.\d+)?$/.test(parts[parts.length - 1]) || !/^\d+$/.test(parts[parts.length - 2]) || !/^\d+$/.test(parts[parts.length - 3])) return null;
    if (Math.abs(Math.round((gp / 10 + conf) / 2) - bt) > 1) return null;
    var counts = { VG: 0, GP: 0, G: 0, A: 0, BA: 0 }, n = 0;
    for (var i = 0; i < parts.length - 3; i++) {
      var m = /^(\d+)(VG|G\+|G|A|BA)$/i.exec(parts[i]);
      if (!m) return null;
      var k = m[2].toUpperCase() === 'G+' ? 'GP' : m[2].toUpperCase();
      counts[k] += parseInt(m[1], 10); n++;
    }
    return { counts: n ? counts : null, gp: gp, bt: bt, conf: conf };
  }
  var TOOLKIT_HEALTH_ORDER = ['Colic resistance', 'Hoof quality', 'Back problems', 'Respiratory disease', 'Resistance to lameness'];
  var TOOLKIT_RATING = { E: 'Excellent', G: 'Good', A: 'Average', F: 'Fair', P: 'Poor' };
  function parseToolkitPrivateTag(text) {
    var m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)\|([EGAFPegafp]{5})$/.exec(String(text || '').replace(/\s+/g, ''));
    if (!m) return null;
    var a = parseFloat(m[1]), b = parseFloat(m[2]);
    if (!(a >= 20 && a <= 100 && b >= 20 && b <= 100)) return null;
    return { high: Math.max(a, b), low: Math.min(a, b), health: m[3].toUpperCase().split('') };
  }
  // Puts what the tags say into the ledger for one horse; returns true when anything changed.
  function applyToolkitTags(state, life, tagline, priv) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life];
    if (!info) return false;
    var changed = false;
    state.horseMeta = state.horseMeta || {};
    var meta = Object.assign({}, state.horseMeta[life]);
    if (tagline) {
      if (!(Number(info.geneticPotential) > 0)) { info.geneticPotential = tagline.gp; changed = true; }
      if (tagline.conf > (Number(meta.confBest) || 0)) { meta.confBest = tagline.conf; meta.confBestAt = Date.now(); meta.confBestEvent = 'HRToolkit tag'; meta.confBestDate = ''; changed = true; }
      if (tagline.counts && !info.confTraits) {
        var same = info.tagCounts && JSON.stringify(info.tagCounts) === JSON.stringify(tagline.counts);
        if (!same) { info.tagCounts = tagline.counts; changed = true; }
      }
    }
    if (priv) {
      if (priv.high > (Number(meta.confBest) || 0) + 0.006) { meta.confBest = priv.high; meta.confBestAt = Date.now(); meta.confBestEvent = 'HRToolkit all-time high'; meta.confBestDate = ''; changed = true; }
      // the all-time low and range (see recordLowScore for the guard)
      if (recordLowScore(meta, priv.low, Math.max(priv.high, Number(meta.confBest) || 0), 'HRToolkit all-time low', false, info, { event: 'HRToolkit all-time low' })) changed = true;
      if (!info.health && !info.healthFromTag) {
        var h = {};
        priv.health.forEach(function (c, i) { if (TOOLKIT_RATING[c]) h[TOOLKIT_HEALTH_ORDER[i]] = TOOLKIT_RATING[c]; });
        info.health = h; info.healthFromTag = true; changed = true;
      }
    }
    if (changed) { meta.toolkitSeenAt = Date.now(); state.horseMeta[life] = meta; }
    return changed;
  }
  // The widest a horse's conformation score can range, by how many conformation stats its breed has: a horse with 12 stats can
  // vary by 6.928 between its lowest and its highest score. A horse whose highest minus lowest score reaches that is "ranged":
  // both ends are found, so no later show can widen it. (Only the 12-stat range is known; other breeds are not marked.)
  var FULL_RANGE_BY_STATS = { 12: 6.928 };
  var RANGE_TOLERANCE = 0.002;
  function statCountOf(info) {
    if (info && info.confTraits) return Object.keys(info.confTraits).length;
    var tc = info && info.tagCounts;
    return tc ? (tc.VG || 0) + (tc.GP || 0) + (tc.G || 0) + (tc.A || 0) + (tc.BA || 0) : 0;
  }
  function fullScoreRange(info) { return FULL_RANGE_BY_STATS[statCountOf(info)] || null; }
  // { full, range, high, low, ranged } or null when the high or low is not known
  function rangeStatus(state, life) {
    var meta = state.horseMeta && state.horseMeta[life], info = state.horseInfo && state.horseInfo[life];
    var high = bestConformation(meta).best, low = Number(meta && meta.confLow) || 0;
    if (!(high > 0) || !(low > 0) || low > high) return null;
    var full = fullScoreRange(info), range = Math.round((high - low) * 1000) / 1000;
    return { full: full, range: range, high: high, low: low, ranged: !!full && (high - low) >= full - RANGE_TOLERANCE };
  }
  // The lowest conformation score a horse has had. Only ever goes down, and a low further than MAX_SCORE_RANGE below the
  // all-time high is ignored (a wrongly entered show would otherwise drag it out of reach). Returns true if it changed.
  var MAX_SCORE_RANGE = 12;
  // detail = { date, event } (when and in which show the low was earned), kept like the highest score's.
  function recordLowScore(meta, low, high, source, force, info, detail) {
    low = Number(low);
    if (!(low > 0)) return false;
    var cur = Number(meta.confLow) || 0;
    // a low further under the high than the breed's full range allows (or 12 points when the range is not known) is a misread
    var full = fullScoreRange(info);
    if (!force && high > 0 && high - low > (full ? full + 0.01 : MAX_SCORE_RANGE)) return false;
    if (cur > 0 && low >= cur && !force) return false;
    if (low === cur) {
      var fills = detail && ((detail.date && !meta.confLowDate) || (detail.event && !meta.confLowEvent));
      if (!fills) return false;
      if (detail.date && !meta.confLowDate) meta.confLowDate = detail.date;
      if (detail.event && !meta.confLowEvent) meta.confLowEvent = String(detail.event).slice(0, 90);
      return true;
    }
    meta.confLow = low; meta.confLowAt = Date.now(); meta.confLowSource = source || '';
    meta.confLowDate = (detail && detail.date) || ''; meta.confLowEvent = (detail && detail.event) ? String(detail.event).slice(0, 90) : (source || '');
    return true;
  }

  // ---------- horse tags ----------
  // Up to 10 short tags per horse (horseMeta[life].tags): 2 to 24 characters, lower case, spaces and underscores joined by
  // hyphens ("comp-team", "for-sale"). They group horses beyond breed and status and are searched with #tag in the filter
  // box above a list (a part of a tag matches). Three tags change the suggestions: keep, sell and no-breed.
  var MAX_TAGS = 10;
  function normalizeTag(t) {
    var s = String(t || '').toLowerCase().trim().replace(/^#+/, '').replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
    return s.length >= 2 && s.length <= 24 ? s : '';
  }
  function tagsOf(state, life) {
    var m = state && state.horseMeta && state.horseMeta[life];
    return m && Array.isArray(m.tags) ? m.tags : [];
  }
  // 'added', 'exists', 'full' or 'invalid'
  function addTagTo(state, life, raw) {
    var tag = normalizeTag(raw);
    if (!tag || !life) return 'invalid';
    state.horseMeta = state.horseMeta || {};
    var meta = Object.assign({}, state.horseMeta[life]), list = Array.isArray(meta.tags) ? meta.tags.slice() : [];
    if (list.indexOf(tag) > -1) return 'exists';
    if (list.length >= MAX_TAGS) return 'full';
    list.push(tag);
    meta.tags = list;
    state.horseMeta[life] = meta;
    return 'added';
  }
  function removeTagFrom(state, life, raw) {
    var tag = normalizeTag(raw), meta = state.horseMeta && state.horseMeta[life];
    if (!tag || !meta || !Array.isArray(meta.tags) || meta.tags.indexOf(tag) === -1) return false;
    var m2 = Object.assign({}, meta);
    m2.tags = meta.tags.filter(function (t) { return t !== tag; });
    if (!m2.tags.length) delete m2.tags;
    state.horseMeta[life] = m2;
    return true;
  }
  function allTags(state) {
    var count = {};
    Object.keys(state.horseMeta || {}).forEach(function (l) { tagsOf(state, l).forEach(function (t) { count[t] = (count[t] || 0) + 1; }); });
    return Object.keys(count).sort().map(function (t) { return { tag: t, count: count[t] }; });
  }
  // Does a horse match every #tag term of a search (a part of a tag matches)? terms are tags without the #.
  function tagQueryMatch(state, life, terms) {
    var tags = tagsOf(state, life);
    // horses of your breeding partners also answer to #partner and #bp
    if (partnerOwnerOf(state, state.horseInfo && state.horseInfo[life])) tags = tags.concat(['partner', 'bp']);
    if (peacockOf(state, life)) tags = tags.concat(['peacock']);
    var rs = rangeStatus(state, life);
    if (rs && rs.ranged) tags = tags.concat(['ranged']);
    return terms.every(function (q) { return tags.some(function (t) { return t.indexOf(q) > -1; }); });
  }

  // ---------- breeding partners ----------
  // Other players whose stallions you breed to (state.settings.partners, up to 20 user names). Their stallions that are saved in
  // the ledger are marked as partner studs: ranked a little higher in the suggestions, shown with a "partner" label, and found
  // with #partner (or #bp) in a list filter.
  var MAX_PARTNERS = 20;
  function partnerList(state) { return (state && state.settings && Array.isArray(state.settings.partners)) ? state.settings.partners : []; }
  function partnerOwnerOf(state, info) {
    var owner = String((info && info.ownerName) || '').trim().toLowerCase();
    if (!owner) return '';
    var hit = partnerList(state).find(function (p) { return String(p).trim().toLowerCase() === owner; });
    return hit ? String(info.ownerName).trim() : '';
  }
  // 'added', 'exists', 'full' or 'invalid'
  function addPartner(state, name) {
    name = String(name || '').trim();
    if (name.length < 2 || name.length > 40) return 'invalid';
    state.settings = state.settings || {};
    var list = partnerList(state).slice();
    if (list.some(function (p) { return String(p).toLowerCase() === name.toLowerCase(); })) return 'exists';
    if (list.length >= MAX_PARTNERS) return 'full';
    list.push(name);
    state.settings.partners = list;
    return 'added';
  }
  function removePartner(state, name) {
    var list = partnerList(state), next = list.filter(function (p) { return String(p).toLowerCase() !== String(name).toLowerCase(); });
    if (next.length === list.length) return false;
    state.settings.partners = next;
    return true;
  }

  // ---------- competition scores ----------
  // horseMeta[life].comp = { high, low, n, at, by: { <discipline>: { high, low, n } } }: the highest and lowest competition score
  // seen for a horse, overall and per discipline (conformation shows are kept apart, in confBest / confLow). The high only
  // goes up and the low only goes down; a low more than MAX_COMP_RANGE under the high is ignored (a misread row).
  var COMP_DISCIPLINES = ['Dressage', 'Driving', 'Endurance', 'Eventing', 'Flat Racing', 'Show Jumping', 'Western Reining', 'Basic Training'];
  var MAX_COMP_RANGE = 40;
  function disciplineNameOf(text) {
    var t = String(text || '').toLowerCase();
    if (/dressage/.test(t)) return 'Dressage';
    if (/driving/.test(t)) return 'Driving';
    if (/endurance/.test(t)) return 'Endurance';
    if (/eventing/.test(t)) return 'Eventing';
    if (/racing|gallop/.test(t)) return 'Flat Racing';
    if (/jumping/.test(t)) return 'Show Jumping';
    if (/reining|western/.test(t)) return 'Western Reining';
    if (/basic/.test(t)) return 'Basic Training';
    return '';
  }
  // Returns true when something changed. A score of 0 or over 1000 is ignored.
  // detail = { event } (the competition the score came from), kept with the high and the low like the conformation scores.
  function recordCompScore(meta, score, discipline, detail) {
    score = Number(score);
    if (!(score > 0 && score <= 1000)) return false;
    var c = Object.assign({}, meta.comp), by = Object.assign({}, c.by), changed = false;
    function bump(rec) {
      rec = Object.assign({ n: 0 }, rec);
      var ch = false;
      var ev = detail && detail.event ? String(detail.event).slice(0, 90) : '';
      if (!(rec.high >= score)) { rec.high = score; rec.highAt = Date.now(); rec.highEvent = ev; rec.highDate = (detail && detail.date) || ''; ch = true; }
      if (!(rec.low > 0) || (score < rec.low && (rec.high - score) <= MAX_COMP_RANGE)) { if (rec.low !== score) { rec.low = score; rec.lowAt = Date.now(); rec.lowEvent = ev; rec.lowDate = (detail && detail.date) || ''; ch = true; } }
      return { rec: rec, changed: ch };
    }
    var all = bump(c); c.high = all.rec.high; c.low = all.rec.low; changed = all.changed;
    if (discipline) { var d = bump(by[discipline]); by[discipline] = d.rec; if (d.changed) changed = true; }
    c.by = by;
    if (changed) { c.at = Date.now(); meta.comp = c; }
    return changed;
  }
  function compSummary(state, life) {
    var m = state && state.horseMeta && state.horseMeta[life], c = m && m.comp;
    if (!c || !(c.high > 0)) return null;
    var rows = Object.keys(c.by || {}).map(function (k) { var r = c.by[k]; return { discipline: k, high: r.high, low: r.low, n: r.n || 0, highAt: r.highAt, highDate: r.highDate, highEvent: r.highEvent, lowAt: r.lowAt, lowDate: r.lowDate, lowEvent: r.lowEvent }; }).sort(function (a, b) { return b.high - a.high; });
    return { high: c.high, low: c.low || null, range: c.low ? Math.round((c.high - c.low) * 1000) / 1000 : null, by: rows, log: Array.isArray(m.compLog) ? m.compLog.length : 0 };
  }

  // ---------- listing a horse for sale and retiring it ----------
  // A horse you list gets the status For Sale and a log of the prices you ask (horseMeta[life].askLog); a price change
  // adds a line. A horse you retire gets the status Retired and the date. A horse already Sold or Retired is not
  // changed back to For Sale by a stale listing.
  function setHorseStatusIn(state, life, status) {
    life = String(life);
    state.horseMeta = state.horseMeta || {};
    state.horseMeta[life] = Object.assign({}, state.horseMeta[life], { status: status });
    var rec = (state.stallions || []).find(function (x) { return x.lifeNumber && String(x.lifeNumber) === life; });
    if (rec) rec.status = (status === 'Sold' || status === 'Retired' || status === 'For Sale') ? status : 'Active';
  }
  function today10() { return new Date().toISOString().slice(0, 10); }
  // ask = { buyout, bid } (either may be missing). Returns true if anything changed.
  function recordAsk(state, life, ask) {
    life = String(life || '');
    if (!life) return false;
    var meta = state.horseMeta && state.horseMeta[life] || {};
    if (meta.status === 'Sold' || meta.status === 'Retired') return false;
    var buyout = Number(ask && ask.buyout) > 0 ? Number(ask.buyout) : null, bid = Number(ask && ask.bid) > 0 ? Number(ask.bid) : null;
    var log = Array.isArray(meta.askLog) ? meta.askLog.slice() : [];
    var last = log[log.length - 1];
    var changed = false;
    if (meta.status !== 'For Sale') { setHorseStatusIn(state, life, 'For Sale'); meta = state.horseMeta[life]; changed = true; }
    if ((buyout || bid) && (!last || (last.buyout || null) !== buyout || (last.bid || null) !== bid)) {
      // a price you did not state this time keeps the one already known
      var entry = { date: today10(), at: Date.now(), buyout: buyout != null ? buyout : (last && last.buyout) || null, bid: bid != null ? bid : (last && last.bid) || null };
      if (!last || entry.buyout !== (last.buyout || null) || entry.bid !== (last.bid || null)) { log.push(entry); changed = true; }
    }
    if (changed) {
      meta = Object.assign({}, state.horseMeta[life]);
      meta.askLog = log.slice(-60);
      if (!meta.forSaleSince) meta.forSaleSince = today10();
      state.horseMeta[life] = meta;
    }
    return changed;
  }
  function recordRetired(state, life) {
    life = String(life || '');
    var meta = state.horseMeta && state.horseMeta[life] || {};
    if (!life || meta.status === 'Retired') return false;
    setHorseStatusIn(state, life, 'Retired');
    state.horseMeta[life] = Object.assign({}, state.horseMeta[life], { retiredAt: today10() });
    return true;
  }
  // A horse that was listed for sale (or marked For Sale) and now shows another owner has been sold: mark it Sold and
  // keep who has it and when you noticed. The price comes from your bank page when it has been read.
  function recordSoldByOwner(state, life) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life], meta = (state.horseMeta && state.horseMeta[life]) || {};
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var owner = info && String(info.ownerName || '').trim();
    if (!life || !me || !owner || owner.toLowerCase() === me) return false;
    if (meta.status === 'Sold' || meta.status === 'Retired') return false;
    var listed = meta.status === 'For Sale' || (Array.isArray(meta.askLog) && meta.askLog.length > 0);
    if (!listed) return false;
    setHorseStatusIn(state, life, 'Sold');
    state.horseMeta[life] = Object.assign({}, state.horseMeta[life], { soldAt: today10(), soldTo: owner });
    return true;
  }
  // The tally of what you have asked: { count, first, last, lowest, highest, days } or null
  function askSummary(meta) {
    var log = meta && Array.isArray(meta.askLog) ? meta.askLog : [];
    if (!log.length) return null;
    var prices = log.map(function (e) { return e.buyout || e.bid || 0; }).filter(Boolean);
    var since = meta.forSaleSince ? daysSince(meta.forSaleSince) : null;
    return { count: log.length, changes: Math.max(0, log.length - 1), first: log[0], last: log[log.length - 1], lowest: prices.length ? Math.min.apply(null, prices) : null, highest: prices.length ? Math.max.apply(null, prices) : null, days: since != null ? Math.floor(since) : null };
  }

  // ---------- why a horse fits (or does not fit) your criteria ----------
  // Used for the summary on a horse's page on Horse Reality: your goal boxes, preferred and unwanted genes, what the
  // horse's notes say and its producer record. Returns { verdict: 'fits' | 'near' | 'misses' | 'nogoals' | 'unknown',
  // headline, lines: [{ ok: true | false | null, text }] }.
  function fitSummary(state, life) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life];
    var out = { life: life, name: (info && info.name) || '', verdict: 'unknown', headline: '', lines: [], counts: { total: 0, matched: 0, missing: [], unknown: 0 }, benefit: '' };
    if (!info) { out.headline = 'Not saved in the ledger yet'; out.lines.push({ ok: null, text: 'The ledger saves a horse when its page has loaded. This summary appears a moment later.' }); return out; }
    var me = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var buying = !!me && String(info.ownerName || '').trim().toLowerCase() !== me && !!String(info.ownerName || '').trim();
    var crit = buying ? buyCriteriaOf(state, info.breed, info.sex) : null;
    var sec = buying && crit.any ? purchaseSections(state, life, crit) : goalSections(state, life), misses = [], criteria = 0;
    var secList = [sec.conf, sec.gp, sec.bt, sec.traits, sec.health, sec.fertility];
    if (sec.need) secList.push(sec.need);
    secList.forEach(function (x) {
      if (x.text === 'no goal') return;
      if (x.skip) { out.lines.push({ ok: null, text: x.label + ': ' + x.text }); return; }
      criteria++;
      if (x.state === 'ok') { out.lines.push({ ok: true, text: x.label + ': ' + x.text }); out.counts.total++; out.counts.matched++; }
      else if (x.state === 'bad') { out.lines.push({ ok: false, text: x.label + ': ' + x.text }); misses.push(x.label); out.counts.total++; out.counts.missing.push(x.label); }
      else { out.lines.push({ ok: null, text: x.label + ': not known yet' }); out.counts.unknown++; }
    });
    // genes
    var genes = preferredGenesOf(state, life), badGenes = [], goodGenes = [];
    genes.forEach(function (g) {
      if (g.level === 'avoid') { badGenes.push(g.name); out.counts.total++; out.counts.missing.push(g.name + ' (unwanted)'); out.lines.push({ ok: false, text: 'Carries ' + g.name + ', a gene you don\'t want' }); }
      else { goodGenes.push(g.name); out.lines.push({ ok: true, text: 'Carries ' + g.name + ', a gene you ' + (g.level === 'keep' ? 'want to keep' : 'prefer') }); }
    });
    var pm = preferenceMap(state, info.breed);
    if (Object.keys(pm).length && !Object.keys(horseGenotype(state, life)).length) out.lines.push({ ok: null, text: 'Genes you care about: its colours have not been tested or saved yet' });
    if (Object.keys(pm).length) criteria++;
    // notes and producer record
    var nr = horseNoteRules(state, life);
    nr.understood.forEach(function (u) { out.lines.push({ ok: null, text: 'Your note: ' + u }); });
    if (info.sex === 'mare') {
      var pr = producerRecord(state, life);
      if (pr.improver) out.lines.push({ ok: true, text: 'Out-produces herself: foals average ' + pr.avgFoal + ' vs her ' + pr.mareScore });
      else if (pr.scored >= 2 && pr.avgDelta != null && pr.avgDelta < -3 && pr.better === 0) out.lines.push({ ok: false, text: 'Her scored foals average ' + pr.avgFoal + ', below her own ' + pr.mareScore });
    } else if (info.sex === 'stallion') {
      var sr = sireRecord(state, life);
      if (sr.improver) out.lines.push({ ok: true, text: 'His foals beat their dams by ' + sr.avgDelta + ' on average' });
      else if (sr.scored >= 3 && sr.avgDelta < -3 && sr.better === 0) out.lines.push({ ok: false, text: 'His scored foals average ' + sr.avgFoal + ', below their dams' });
    }
    var benefit = null;
    if (buying) {
      if (crit.maxPrice) out.lines.push({ ok: null, text: 'Your price limit: ' + fmtMoney(crit.maxPrice) + ' HRC' });
      benefit = herdBenefit(state, life);
      out.benefit = benefit.verdict;
      benefit.lines.forEach(function (l) { out.lines.push(l); });
    }
    var total = misses.length + badGenes.length;
    if (!criteria && !out.lines.some(function (l) { return l.ok !== null; })) { out.verdict = 'nogoals'; out.headline = 'Set goals to see how this horse fits'; return out; }
    var names = misses.concat(badGenes.map(function (n) { return n + ' (unwanted)'; }));
    if (!total) { out.verdict = 'fits'; out.headline = goodGenes.length && !criteria ? 'Carries a gene you prefer' : (buying ? 'Meets your purchase criteria' : 'Fits your criteria'); }
    else if (total === 1) { out.verdict = 'near'; out.headline = 'Off by one: ' + names[0]; }
    else { out.verdict = 'misses'; out.headline = 'Misses ' + total + ': ' + names.slice(0, 3).join(', ') + (names.length > 3 ? '\u2026' : ''); }
    if (buying) { out.headline = 'Buying check \u2014 ' + out.headline; if (benefit && benefit.verdict === 'helps') out.headline += ' \u00b7 would help your herd'; else if (benefit && benefit.verdict === 'no') out.headline += ' \u00b7 would not lift your herd'; }
    return out;
  }

  // ---------- preferred genetics ----------
  // Genes you want to keep in the herd: state.settings.preferGenes = { LP: 'prefer' | 'keep', ... }.
  // A horse "has" a gene if it has at least one copy of the gene's interesting allele (the dominant one, or the
  // recessive one for flaxen), from Horse Reality's test or from genes entered by hand. Untested counts as not there.
  // Extension and Agouti are base colours and are not offered. Used by sell ideas (keep, or less likely to be
  // suggested), the partner suggestions (a foal that is likely to carry it ranks higher) and the Foal Calculator.
  function interestingAllele(l) { return l.recessive ? l.alleles[1] : l.alleles[0]; }
  function preferLoci() { return ALL_LOCI.filter(function (l) { return l.id !== 'E' && l.id !== 'A'; }); }
  // Levels: 'prefer', 'keep' (never sold), 'avoid' (a gene you don't want). Set for all breeds
  // (settings.preferGenes) and optionally per breed (settings.preferGenesByBreed[breed]); a breed's own choice for a
  // gene wins ('none' there means no preference for that breed), otherwise the all-breeds choice applies.
  var PREFER_LEVELS = ['prefer', 'keep', 'avoid'];
  function preferenceMap(state, breed) {
    var st = (state && state.settings) || {};
    var general = st.preferGenes || {};
    var own = (breed && st.preferGenesByBreed && st.preferGenesByBreed[breedKeyOf(breed)]) || {};
    var out = {};
    preferLoci().forEach(function (l) {
      var v = own[l.id] != null && own[l.id] !== '' ? own[l.id] : general[l.id];
      if (PREFER_LEVELS.indexOf(v) > -1) out[l.id] = v;
    });
    return out;
  }
  function horseGenotype(state, life) {
    var info = state.horseInfo && state.horseInfo[life];
    var man = manualGenes(state, life);
    var g = Object.assign({}, man, parseColourGenes(info && info.testedColours));
    return g;
  }
  // The preferred genes this horse has: [{ id, name, level }]
  function preferredGenesOf(state, life) {
    var pm = preferenceMap(state, state.horseInfo && state.horseInfo[life] && state.horseInfo[life].breed), g = horseGenotype(state, life), out = [];
    preferLoci().forEach(function (l) {
      if (!pm[l.id] || !g[l.id]) return;
      if (g[l.id].indexOf(interestingAllele(l)) > -1) out.push({ id: l.id, name: (l.label || l.name.replace(/ \(.*\)$/, '')), level: pm[l.id] });
    });
    // a suspected copy of a gene you care about, where the horse's genotype is not otherwise known
    var sus = suspectedGenes(state, life);
    preferLoci().forEach(function (l) {
      if (!pm[l.id] || g[l.id] || !sus[l.id]) return;
      var allele = interestingAllele(l);
      if (sus[l.id].indexOf(allele) > -1 || sus[l.id].indexOf('?') > -1) out.push({ id: l.id, name: (l.label || l.name.replace(/ \(.*\)$/, '')) + '?', level: pm[l.id], suspected: true });
    });
    return out;
  }
  // Chance that a foal of a x b has each preferred gene: [{ id, name, level, p }] (p 0 to 1)
  function foalPreferredChances(state, aLife, bLife) {
    var a = state.horseInfo[aLife] || {}, b = state.horseInfo[bLife] || {};
    var pm = preferenceMap(state, a.breed || b.breed);
    if (!Object.keys(pm).length) return [];
    var res = colourOutcomes(a.testedColours, b.testedColours, manualGenes(state, aLife), manualGenes(state, bLife));
    var out = [];
    preferLoci().forEach(function (l) {
      if (!pm[l.id]) return;
      var gene = res.genes.find(function (g) { return g.id === l.id; });
      var p = 0, allele = interestingAllele(l);
      if (gene) gene.outcomes.forEach(function (o) { if (o.genotype.split(' / ').indexOf(allele) > -1) p += o.pct / 100; });
      // a parent with a suspected copy: average the chance over the "?" being the gene and not being it
      var susA = suspectedGenes(state, aLife)[l.id], susB = suspectedGenes(state, bLife)[l.id];
      if (susA || susB) {
        var other = l.alleles.find(function (x) { return x !== allele; }) || allele;
        var fill = function (parts, a1) { return parts.map(function (x) { return x === '?' ? a1 : x; }); };
        var variantsA = susA ? [fill(susA, allele), fill(susA, other)] : [null], variantsB = susB ? [fill(susB, allele), fill(susB, other)] : [null];
        var sum = 0, cnt = 0;
        variantsA.forEach(function (va) {
          variantsB.forEach(function (vb) {
            var mA = Object.assign({}, manualGenes(state, aLife)), mB = Object.assign({}, manualGenes(state, bLife));
            if (va) mA[l.id] = va;
            if (vb) mB[l.id] = vb;
            var r2 = colourOutcomes(a.testedColours, b.testedColours, mA, mB), g2 = r2.genes.find(function (g) { return g.id === l.id; }), q = 0;
            if (g2) g2.outcomes.forEach(function (o) { if (o.genotype.split(' / ').indexOf(allele) > -1) q += o.pct / 100; });
            sum += q; cnt++;
          });
        });
        if (cnt) p = sum / cnt;
      }
      out.push({ id: l.id, name: (l.label || l.name.replace(/ \(.*\)$/, '')), level: pm[l.id], p: p });
    });
    return out;
  }
  // Score bonus and reasons for a pairing from the preferred genes a foal could get
  function preferredGeneBonus(state, aLife, bLife) {
    var chances = foalPreferredChances(state, aLife, bLife), bonus = 0, reasons = [];
    chances.forEach(function (c) {
      bonus += (c.level === 'avoid' ? -2.5 : c.level === 'keep' ? 3 : 1.5) * c.p;
      if (c.p >= 0.25) reasons.push('Foal has a ' + Math.round(c.p * 100) + '% chance of ' + c.name + ' (a gene you ' + (c.level === 'avoid' ? "don't want" : c.level === 'keep' ? 'want to keep' : 'prefer') + ')');
    });
    return { bonus: Math.round(bonus * 100) / 100, reasons: reasons };
  }

  // ---------- mares that out-produce themselves ----------
  // Compares a mare's foals with the mare herself: each foal's score against her own top conformation score, and
  // (where the foal's page is saved) genetic potential and conformation traits. A mare is an "improver" when at least
  // two of her foals have scores, they average higher than she scored, and at least half of them beat her. With
  // opts.full it also works out what to look for in a stallion and which ledger stallions fit.
  function producerRecord(state, mareLife, opts) {
    mareLife = String(mareLife || '');
    var info = state.horseInfo && state.horseInfo[mareLife];
    var meta = (state.horseMeta && state.horseMeta[mareLife]) || {};
    var out = { life: mareLife, mareScore: bestConformation(meta).best || 0, scored: 0, total: 0, avgFoal: null, avgDelta: null, better: 0,
      improver: false, foals: [], bySire: [], needTraits: [], improvedTraits: [], heldBackTraits: [], gp: null, failed: 0, advice: [], candidates: [] };
    var bySire = {};
    var traitFoals = {};
    Object.keys(state.breedings || {}).forEach(function (sid) {
      var st = (state.stallions || []).find(function (s) { return s.id === sid; });
      (state.breedings[sid] || []).forEach(function (b) {
        if (String(b.mareLifeNumber) !== mareLife) return;
        if (b.status === 'Failed') { out.failed++; return; }
        if (b.status !== 'Foal Born') return;
        out.total++;
        var fl = foalLifeOf(b.foalUrl);
        var fInfo = fl && state.horseInfo && state.horseInfo[fl];
        var fMeta = fl && state.horseMeta && state.horseMeta[fl];
        var score = b.foalScore > 0 && b.foalScore <= 100 ? b.foalScore : (fMeta && Number(fMeta.confBest) > 0 ? Number(fMeta.confBest) : 0);
        if (fInfo && fInfo.confTraits) Object.keys(fInfo.confTraits).forEach(function (t) { var r = traitRankOf(fInfo.confTraits[t]); if (r != null) (traitFoals[t] = traitFoals[t] || []).push(r); });
        if (!(score > 0)) return;
        out.scored++;
        var delta = out.mareScore ? Math.round((score - out.mareScore) * 10) / 10 : null;
        out.foals.push({ name: b.foalName || 'Foal', life: fl, score: score, delta: delta, sire: st ? st.name : '', sireLife: st ? st.lifeNumber : '', gp: fInfo && fInfo.geneticPotential != null ? Number(fInfo.geneticPotential) : null });
        var key = st ? st.name : '?';
        (bySire[key] = bySire[key] || { sire: key, sireLife: st ? st.lifeNumber : '', scores: [] }).scores.push(score);
      });
    });
    if (out.scored) {
      var total = out.foals.reduce(function (t, f) { return t + f.score; }, 0);
      out.avgFoal = Math.round(total / out.scored * 10) / 10;
      if (out.mareScore) {
        out.avgDelta = Math.round((out.avgFoal - out.mareScore) * 10) / 10;
        out.better = out.foals.filter(function (f) { return f.score > out.mareScore; }).length;
        out.improver = out.scored >= 2 && out.avgDelta > 0 && out.better / out.scored >= 0.5;
      }
    }
    out.bySire = Object.keys(bySire).map(function (k) {
      var g = bySire[k], avg = g.scores.reduce(function (a, b) { return a + b; }, 0) / g.scores.length;
      return { sire: g.sire, sireLife: g.sireLife, n: g.scores.length, avg: Math.round(avg * 10) / 10, delta: out.mareScore ? Math.round((avg - out.mareScore) * 10) / 10 : null };
    }).sort(function (a, b) { return b.avg - a.avg; });
    // genetic potential of her foals against hers
    var fgp = out.foals.filter(function (f) { return f.gp != null; });
    if (info && info.geneticPotential != null && fgp.length) {
      out.gp = { mare: Number(info.geneticPotential), foalAvg: Math.round(fgp.reduce(function (t, f) { return t + f.gp; }, 0) / fgp.length), n: fgp.length };
    }
    // traits: where she is weak, and where her foals come out better or worse than she is
    var mareTraits = (info && info.confTraits) || {};
    var need = {};
    Object.keys(mareTraits).forEach(function (t) {
      var mr = traitRankOf(mareTraits[t]);
      if (mr == null) return;
      if (mr <= 1) need[t] = true;
      var fr = traitFoals[t];
      if (fr && fr.length) {
        var avg = fr.reduce(function (a, b) { return a + b; }, 0) / fr.length;
        if (avg >= mr + 0.5) out.improvedTraits.push(t);
        else if (avg <= mr - 0.5) { out.heldBackTraits.push(t); need[t] = true; }
      }
    });
    out.needTraits = Object.keys(need);
    if (!(opts && opts.full)) return out;

    // ---- advice (only with the full record)
    var name = (info && info.name) || ('#' + mareLife);
    if (!out.scored) {
      out.advice.push('No foal scores saved for ' + name + ' yet, so there is nothing to compare. Open her Foals tab and each foal\'s page on Horse Reality to save them.');
    } else {
      out.advice.push('Her ' + out.scored + ' scored foal' + (out.scored === 1 ? '' : 's') + ' average ' + out.avgFoal + (out.mareScore ? (out.avgDelta >= 0 ? ', ' + out.avgDelta + ' above' : ', ' + Math.abs(out.avgDelta) + ' below') + ' her own ' + out.mareScore + ' (' + out.better + ' of ' + out.scored + ' beat her)' : '') + '.');
    }
    if (out.bySire.length) {
      var top = out.bySire[0];
      out.advice.push('Best result so far: ' + top.sire + ' (' + top.n + ' foal' + (top.n === 1 ? '' : 's') + ', average ' + top.avg + '). Repeating a cross that worked is the safest start.');
      var weak = out.bySire.filter(function (x) { return x.delta != null && x.delta < -2; });
      if (weak.length) out.advice.push('Foals by ' + weak.map(function (x) { return x.sire; }).join(', ') + ' scored below her, so look elsewhere.');
    }
    if (out.needTraits.length) out.advice.push('Look for a stallion rated Good or better in: ' + out.needTraits.join(', ') + (out.heldBackTraits.length ? ' (her foals came out weaker than she is in ' + out.heldBackTraits.join(', ') + ')' : '') + '.');
    if (out.improvedTraits.length) out.advice.push('Her foals tend to improve on her in ' + out.improvedTraits.join(', ') + ', so those matter less.');
    if (out.gp) out.advice.push('Genetic potential: hers is ' + out.gp.mare + ' and her foals average ' + out.gp.foalAvg + '. ' + (out.gp.foalAvg >= out.gp.mare ? 'Keep to stallions at or above ' + out.gp.mare + ' to keep that going.' : 'Choose a stallion above ' + out.gp.mare + ' to lift it.'));
    if (out.failed >= 2 && out.failed / Math.max(1, out.failed + out.total) >= 0.3) out.advice.push('She has had ' + out.failed + ' failed coverings: prefer a stallion with Good or Excellent fertility.');
    // ledger stallions that fit
    var sug = breedingSuggestions(state, mareLife, 40);
    if (!sug.error) {
      var scored = sug.suggestions.map(function (s) {
        var si = state.horseInfo[s.life] || {};
        var covers = out.needTraits.filter(function (t) { var r = si.confTraits ? traitRankOf(si.confTraits[t]) : null; return r != null && r >= 2; });
        return { life: s.life, name: s.name, covers: covers, estBT: s.estBT, yours: s.yours };
      });
      scored.sort(function (a, b) { return b.covers.length - a.covers.length; });
      out.candidates = scored.slice(0, 3);
    }
    return out;
  }
  // The same idea for a stallion: his scored foals against the top scores of the mares they were out of.
  function sireRecord(state, stallionLife) {
    var out = { scored: 0, avgFoal: null, avgDelta: null, better: 0, improver: false };
    var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(stallionLife); });
    if (!rec) return out;
    var deltas = [], foals = [];
    (state.breedings[rec.id] || []).forEach(function (b) {
      if (b.status !== 'Foal Born' || !(b.foalScore > 0 && b.foalScore <= 100)) return;
      var dam = bestConformation((state.horseMeta && state.horseMeta[b.mareLifeNumber]) || {}).best;
      if (!(dam > 0)) return;
      deltas.push(b.foalScore - dam); foals.push(b.foalScore);
    });
    out.scored = deltas.length;
    if (!out.scored) return out;
    out.avgFoal = Math.round(foals.reduce(function (a, b) { return a + b; }, 0) / out.scored * 10) / 10;
    out.avgDelta = Math.round(deltas.reduce(function (a, b) { return a + b; }, 0) / out.scored * 10) / 10;
    out.better = deltas.filter(function (d) { return d > 0; }).length;
    out.improver = out.scored >= 3 && out.avgDelta > 0 && out.better / out.scored >= 0.5;
    return out;
  }
  // Does this horse's dam out-produce herself? (her life number is saved with the horse's page)
  function damImprover(state, life) {
    var info = state.horseInfo && state.horseInfo[life];
    var dl = info && info.dam && info.dam.lifeNumber;
    if (!dl) return null;
    var r = producerRecord(state, String(dl));
    return r.improver ? { life: String(dl), name: r.mareScore ? ((state.horseInfo[dl] && state.horseInfo[dl].name) || (info.dam && info.dam.name) || 'her dam') : '' } : null;
  }
  // mares with a clear record of out-producing themselves, best first
  function improverMares(state) {
    var out = [];
    ownedHorses(state).forEach(function (h) {
      if (h.info.sex !== 'mare' || isSoldLife(state, h.lifeNumber)) return;
      var r = producerRecord(state, h.lifeNumber);
      if (r.improver) out.push(Object.assign({ name: h.info.name || ('#' + h.lifeNumber) }, r));
    });
    return out.sort(function (a, b) { return b.avgDelta - a.avgDelta; });
  }

  // ---------- notes the suggestions can use ----------
  // The ledger has no AI: it looks for plain phrases in the notes you write and shows what it understood.
  // On a horse: "keep" / "don't sell" / "foundation" (never suggested for sale), "sell" (suggested for sale),
  // "don't breed" (left out of breeding suggestions), "pair with <name>" (preferred partner), "avoid <name>"
  // (never suggested together). In your overall notes: "max fee 500000", "avoid inbreeding", "fertility matters",
  // "keep all mares" (also stallions, fillies, colts).
  function splitNames(s) {
    return String(s || '').split(/\s*(?:,|\band\b|\/|&)\s*/).map(function (x) { return x.replace(/[.!"']/g, '').trim(); }).filter(function (x) { return x.length >= 3; });
  }
  function parseNotes(text, overall) {
    var out = { keep: false, sell: false, noBreed: false, pairWith: [], avoid: [], maxFee: null, avoidInbreeding: false, fertilityMatters: false, keepGroups: {}, understood: [] };
    var raw = String(text || '');
    if (!raw.trim()) return out;
    function say(t) { if (out.understood.indexOf(t) === -1) out.understood.push(t); }
    raw.split(/[\n;]+|\.\s+/).forEach(function (line) {
      var l = line.toLowerCase().trim();
      if (!l) return;
      var m;
      // groups: "keep all mares", "never sell any stallions"
      var gm = /\b(?:keep|never sell|do not sell|don'?t sell)\s+(?:all|every|any|the)?\s*(mares|stallions|fillies|colts)\b/.exec(l);
      if (gm) {
        var key = gm[1] === 'mares' ? 'mare' : gm[1] === 'stallions' ? 'stallion' : gm[1] === 'fillies' ? 'filly' : 'colt';
        out.keepGroups[key] = true;
        say('Never suggest selling any ' + gm[1]);
        return;
      }
      if (overall) {
        if (/\b(fee|hrc|stud)\b/.test(l)) {
          m = /(?:max(?:imum)?(?:\s+stud)?\s+fee|fees?\s+(?:under|below|up to)|under|below|no more than|up to|not (?:more|over|above))\s*\$?\s*([0-9][0-9,.]*)\s*(k|m)?/.exec(l);
          if (m) {
            var n = parseFloat(m[1].replace(/,/g, ''));
            if (m[2] === 'k') n *= 1000; else if (m[2] === 'm') n *= 1000000;
            if (n > 0) { out.maxFee = n; say('Leave out other players\' stallions that cost more than ' + n.toLocaleString('en-US') + ' HRC'); }
          }
        }
        if (/(avoid|no|low|minimi[sz]e|limit|keep down)\s+(?:any\s+)?(inbreeding|inbred|coi)|inbreeding.*\b(avoid|low|minimi[sz]e)/.test(l)) { out.avoidInbreeding = true; say('Be stricter about inbreeding (under 3.1%)'); }
        if (/fertil/.test(l) && /(prefer|matters?|important|high|good|favou?r|priority|care)/.test(l)) { out.fertilityMatters = true; say('Give a stallion\'s fertility extra weight'); }
        return;
      }
      var negSell = /\b(do not|don'?t|never|not)\s+(?:to\s+)?sell/.test(l) || /\bnot for sale\b/.test(l);
      if (negSell || /\bkeep\b/.test(l) || /\bfoundation\b/.test(l) || /\bbreeding stock\b/.test(l)) { out.keep = true; say('Keep: not suggested for sale'); }
      else if (/\b(sell|selling|for sale|rehome|re-home)\b/.test(l)) { out.sell = true; say('Sell: suggested for sale'); }
      if (/\b(do not|don'?t|never|no|stop)\s+(?:to\s+)?(?:breed|breeding)\b/.test(l) || /\bnot for breeding\b|\bretire[d]? from breeding\b|\bnon-?breeding\b/.test(l)) {
        if (!/\b(with|to)\s+\S+/.test(l.replace(/\b(do not|don'?t|never|no|stop)\s+(?:to\s+)?(?:breed|breeding)\b/, ''))) { out.noBreed = true; say('Not for breeding: left out of breeding suggestions'); return; }
      }
      var neg = /\b(avoid|don'?t|do not|never|not)\b/.test(l);
      m = /\b(?:avoid)\s+([^;\n]+)/.exec(l);
      if (m) { splitNames(m[1]).forEach(function (nm) { out.avoid.push(nm); say('Never pair with ' + nm); }); return; }
      m = /\b(?:pair|breed|bred|cross|mate|match|put)(?:ed)?\s+(?:\w+\s+)?(?:with|to)\s+([^;\n]+)/.exec(l);
      if (m) {
        splitNames(m[1]).forEach(function (nm) {
          if (neg) { out.avoid.push(nm); say('Never pair with ' + nm); } else { out.pairWith.push(nm); say('Prefer pairing with ' + nm); }
        });
      }
    });
    return out;
  }
  function nameMatches(list, name) {
    var n = String(name || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!n) return false;
    return (list || []).some(function (it) {
      var i = String(it || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
      return i.length >= 3 && (n.indexOf(i) > -1 || i.indexOf(n) > -1);
    });
  }
  function overallNoteRules(state) { return parseNotes(state && state.settings && state.settings.notes, true); }
  function horseNoteRules(state, life) {
    var r = parseNotes(state && state.horseMeta && state.horseMeta[life] && state.horseMeta[life].notes);
    // the tags keep, sell and no-breed work like the same words in the horse's notes
    var tg = tagsOf(state, life);
    if (tg.indexOf('keep') > -1) { r.keep = true; r.understood.push('Tag #keep: keep her or him'); }
    if (tg.indexOf('sell') > -1) { r.sell = true; r.understood.push('Tag #sell: sell'); }
    if (tg.indexOf('no-breed') > -1 || tg.indexOf('dont-breed') > -1) { r.noBreed = true; r.understood.push('Tag #no-breed: do not breed'); }
    return r;
  }
  // What the notes of the two horses say about pairing them: { skip, bonus, reason }
  function partnerNoteEffect(state, aLife, bLife) {
    var a = horseNoteRules(state, aLife), b = horseNoteRules(state, bLife);
    var aName = (state.horseInfo[aLife] && state.horseInfo[aLife].name) || '', bName = (state.horseInfo[bLife] && state.horseInfo[bLife].name) || '';
    var out = { skip: false, bonus: 0, reason: '' };
    if (a.noBreed || b.noBreed) { out.skip = true; return out; }
    if (nameMatches(a.avoid, bName) || nameMatches(b.avoid, aName)) { out.skip = true; return out; }
    if (nameMatches(a.pairWith, bName)) { out.bonus = 2; out.reason = 'Your note on ' + (aName || 'her') + ' says to pair with ' + bName; }
    else if (nameMatches(b.pairWith, aName)) { out.bonus = 2; out.reason = 'Your note on ' + (bName || 'him') + ' says to pair with ' + aName; }
    return out;
  }

  // ---------- disciplines (wiki: Competitions) ----------
  // The conformation traits that count in each discipline. Genetic-potential stats also count in the game, but the
  // ledger only saves the total genetic potential, so this fit is from conformation alone.
  var DISCIPLINES = [
    { name: 'Dressage', traits: ['Walk', 'Trot', 'Canter', 'Posture'] },
    { name: 'Driving', traits: ['Trot', 'Back', 'Shoulders', 'Hindquarters'] },
    { name: 'Endurance', traits: ['Walk', 'Trot', 'Canter', 'Head', 'Neck', 'Back'] },
    { name: 'Eventing', traits: ['Walk', 'Trot', 'Canter', 'Posture', 'Head', 'Neck'] },
    { name: 'Flat Racing', traits: ['Gallop', 'Posture', 'Neck', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters'] },
    { name: 'Show Jumping', traits: ['Canter', 'Back', 'Shoulders', 'Frontlegs', 'Hindquarters'] },
    { name: 'Western Reining', traits: ['Head', 'Neck', 'Shoulders', 'Frontlegs', 'Hindquarters'] }
  ];
  // The middle of each label's hidden number range (poor 0-39, below average 40-59, average 60-69, good 70-84, very good 85-100).
  function traitMidpoint(label) {
    var t = String(label || '').toLowerCase().trim();
    if (/^very good|^vg/.test(t)) return 92;
    if (/^good|^g\b/.test(t)) return 77;
    if (/^average|^a\b/.test(t)) return 65;
    if (/^below|^ba\b/.test(t)) return 50;
    if (/^poor/.test(t)) return 20;
    return null;
  }
  function disciplineFit(info) {
    var traits = info && info.confTraits;
    if (!traits) return null;
    var byKey = {};
    Object.keys(traits).forEach(function (k) { byKey[k.toLowerCase().replace(/\s+/g, '')] = traits[k]; });
    var out = DISCIPLINES.map(function (d) {
      var vals = d.traits.map(function (t) { return traitMidpoint(byKey[t.toLowerCase()]); }).filter(function (v) { return v != null; });
      var fit = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length * 10) / 10 : null;
      return { name: d.name, fit: fit, known: vals.length, total: d.traits.length, traits: d.traits };
    }).filter(function (x) { return x.fit != null; });
    return out.length ? out.sort(function (a, b) { return b.fit - a.fit; }) : null;
  }

  // ---------- breeds ----------
  // The breeds in Horse Reality (from the wiki's Horse Breeds page). There is no crossbreeding in the game, so
  // two horses can only be paired when they are the same breed.
  var HR_BREEDS = ['Akhal-Teke Horse', 'Appaloosa Horse', 'Arabian Horse', 'Brabant Horse', 'Brumby Horse', 'Camargue Horse', 'Cleveland Bay', 'Exmoor Pony',
    'Finnhorse', 'Fjord Horse', 'Friesian Horse', 'Haflinger Horse', 'Icelandic Horse', 'Irish Cob Horse', 'Kathiawari Horse', 'Kladruber Horse', 'Knabstrupper',
    'Lipizzaner Horse', 'Lusitano', 'Mongolian Horse', 'Mustang Horse', 'Namib Desert Horse', 'Noriker Horse', 'Norman Cob', 'Oldenburg Horse', 'Pantaneiro Horse',
    'Pura Raza Espa\u00f1ola', 'Quarter Horse', 'Shetland Pony', 'Shire Horse', 'Suffolk Punch', 'Thoroughbred', 'Trakehner Horse', 'Welsh Pony'];
  // A comparable form of a breed name ("Friesian" and "Friesian Horse" match). '' when the breed is not known.
  function breedKeyOf(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/ horse$/, '');
  }
  function breedKey(info) { return breedKeyOf(info && info.breed); }
  function sameBreed(a, b) {
    var x = breedKey(a), y = breedKey(b);
    return !x || !y || x === y;
  }

  // ---------- Foal Calculator: partners for the horse you picked ----------
  // For a mare: the stallions to use; for a stallion: the mares to use. Only horses saved in the ledger are
  // considered (3 and older, not sold/retired, genetic potential known). Mares that are covered or in foal are left
  // out. Each result says whether the foal might fit your minimum Breed Total / conformation goals, judged from the
  // average of the two parents' genetic potential and top conformation. Split into your horses and other players'.
  function pairIdeas(state, life, limit) {
    life = String(life || '');
    var info = state.horseInfo && state.horseInfo[life];
    var out = { life: life, name: (info && info.name) || ('#' + life), kind: '', mine: [], other: [], error: '', hasGoal: false, notAvailable: 0, byNotes: 0 };
    var overallRules = overallNoteRules(state);
    if (horseNoteRules(state, life).noBreed) { out.error = 'no-breed'; return out; }
    if (!info || (info.sex !== 'mare' && info.sex !== 'stallion')) { out.error = 'unknown'; return out; }
    if (isYoungInfo(info)) { out.error = 'young'; return out; }
    var isMare = info.sex === 'mare';
    out.kind = isMare ? 'stallions' : 'mares';
    var goalSets = [goalsOf(state, 'mare'), goalsOf(state, 'stallion')];
    var goals = goalSets[0];
    out.hasGoal = goalSets.some(function (g) { return g.minBT != null || g.minConf != null || g.minGP != null; });
    var myName = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var myConf = bestConformation(meta).best;
    var myAnc = ancestorMap(state, life, 3);
    var myMet = goalCheck(state, life).met;
    var LMp = learnedModel(state);
    var list = [];
    Object.keys(state.horseInfo || {}).forEach(function (cl) {
      var ci = state.horseInfo[cl];
      if (!ci || cl === life || ci.sex !== (isMare ? 'stallion' : 'mare') || isYoungInfo(ci)) return;
      var cm = (state.horseMeta && state.horseMeta[cl]) || {};
      if (isSoldLife(state, cl) || cm.status === 'Retired' || cm.status === 'Deceased') { if (!(isMare && stallionAvailable(state, cl))) return; }
      if (ci.geneticPotential == null || info.geneticPotential == null) return;
      if (!isMare && mareBreedStatus(state, cl).status) return;
      if (!sameBreed(ci, info)) return;
      var usableQ = isMare ? stallionUsable(state, cl) : 'yes';
      if (usableQ === 'no') { out.notAvailable++; return; }
      var noteFx = partnerNoteEffect(state, life, cl);
      if (noteFx.skip) { out.byNotes++; return; }
      var maxFee = parseFloat(state.settings && state.settings.calcMaxFee);
      if (overallRules.maxFee && (!(maxFee > 0) || overallRules.maxFee < maxFee)) maxFee = overallRules.maxFee;
      if (isMare && maxFee > 0 && !(!!myName && String(ci.ownerName || '').trim().toLowerCase() === myName)) {
        var tm = studTermsOf(state, cl);
        if (tm && (tm.currency || 'HRC') === 'HRC' && tm.fee > maxFee) return;
      }
      var cConf = bestConformation(cm).best;
      var gp = (Number(info.geneticPotential) + Number(ci.geneticPotential)) / 2;
      var confs = [myConf, cConf].filter(function (x) { return x > 0; });
      var conf = confs.length ? confs.reduce(function (a, b) { return a + b; }, 0) / confs.length : null;
      // adjusted by what the ledger has learned from your own foals
      var FXq = focusOf(state);
      if (LMp.on && LMp.gp.n >= 3) gp += LMp.gp.off;
      if (LMp.on && conf && myConf > 0 && cConf > 0) conf = predictFoalConf(LMp, isMare ? myConf : cConf, isMare ? cConf : myConf, isMare ? life : cl, String(isMare ? cl : life), breedKeyOf(info.breed)).conf;
      var estBT = conf ? breedTotal(gp, conf) : null;
      var common = commonAncestors(myAnc, ancestorMap(state, cl, 3));
      var coi = estimateCoi(common);
      if (coi > (overallRules.avoidInbreeding ? 3.125 : 12.5)) return;
      var mI = isMare ? info : ci, sI = isMare ? ci : info;
      var shared = [], fixes = [], trq = { n: 0, sum: 0, weak: 0, strong: 0 };
      if (mI.confTraits && sI.confTraits) {
        Object.keys(mI.confTraits).forEach(function (t) {
          var a = traitRankOf(mI.confTraits[t]), b = traitRankOf(sI.confTraits[t]);
          if (a == null || b == null) return;
          if (a === 0 && b === 0) shared.push(t);
          else if (a === 0 && b >= 2) fixes.push(t);
          var exq = (a + b) / 2;
          trq.n++; trq.sum += exq;
          if (exq < 1) trq.weak++;
          if (exq >= 2) trq.strong++;
        });
      }
      var foalQ = { conf: conf, gp: gp, traitAvg: trq.n ? trq.sum / trq.n : null, weak: trq.weak, strong: trq.strong };
      var fert = String(sI.fertility || '').toLowerCase().trim();
      var fertBonus = FERT_BONUS[fert] != null ? FERT_BONUS[fert] : 0;
      var fits = coi < (overallRules.avoidInbreeding ? 3.125 : 6.25) && goalSets.some(function (g) { return (g.minBT == null || (estBT != null && estBT >= g.minBT)) && (g.minConf == null || (conf != null && conf >= g.minConf)) && (g.minGP == null || gp >= g.minGP); });
      var otherMet = goalCheck(state, cl).met;
      var mine = !!myName && String(ci.ownerName || '').trim().toLowerCase() === myName;
      var reasons = [];
      reasons.push('Expected foal: ' + (conf != null ? 'conformation score ' + (Math.round(conf * 10) / 10) + ', ' : 'no conformation score yet, ') + 'genetic potential ' + Math.round(gp) + (foalQ.traitAvg != null ? ', conformation stats: ' + trq.strong + ' of ' + trq.n + ' traits Good or better, ' + trq.weak + ' weak' : ''));
      if (estBT != null) reasons.push('For reference, estimated Breed Total ' + (Math.round(estBT * 10) / 10));
      if (out.hasGoal && !fits && goals.minBT != null && estBT != null && estBT < goals.minBT) reasons.push('Your goal is Breed Total ' + goals.minBT);
      reasons.push(common.length ? 'Estimated inbreeding ' + (Math.round(coi * 100) / 100) + '%' : 'No shared ancestors');
      if (fixes.length) reasons.push('Covers ' + fixes.join(', '));
      if (shared.length) reasons.push('Both weak in ' + shared.join(', '));
      if (myMet && otherMet) reasons.push('Both parents meet your goals');
      if (isMare && !mine) { var terms = studTermsOf(state, cl); if (terms) reasons.push('Cost: ' + terms.summary); else if (usableQ === 'unlisted') reasons.push('No stud fee or semen saved for him, so he may not be at stud'); }
      if (noteFx.reason) reasons.push(noteFx.reason);
      var geneFx2 = preferredGeneBonus(state, life, cl);
      geneFx2.reasons.forEach(function (r) { reasons.push(r); });
      var score = (conf != null ? foalScoreOf(foalQ, FXq) / 2 : gp / 10) + 0.3 * fixes.length - 0.6 * shared.length - 0.2 * coi + fertBonus * (overallRules.fertilityMatters ? 2.5 : 1) + (fits ? 1 : 0) + (myMet && otherMet ? 0.5 : 0) + noteFx.bonus + geneFx2.bonus;
      // is the foal better than the horse that was picked? (conformation score, genetic potential and conformation stats)
      var cmpQ = compareFoals(foalQ, foalProfileOfMare(state, life), FXq);
      list.push({ partner: partnerOwnerOf(state, ci), better: cmpQ.verdict, d: cmpQ.d, foal: { conf: conf != null ? Math.round(conf * 10) / 10 : null, gp: Math.round(gp), weak: trq.weak, strong: trq.strong, n: trq.n }, unlisted: usableQ === 'unlisted', life: cl, name: ci.name || ('#' + cl), mine: mine, fits: fits, estBT: estBT != null ? Math.round(estBT * 10) / 10 : null, coi: Math.round(coi * 100) / 100, score: score, reasons: reasons });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    out.mine = list.filter(function (x) { return x.mine; }).slice(0, limit || 10);
    out.other = list.filter(function (x) { return !x.mine; }).slice(0, limit || 10);
    return out;
  }

  // ---------- goal advice: when to raise your goals, and to what ----------
  // Looks at the horses you own (not sold or retired; colts count with the stallions and fillies with the mares, and
  // with separate goals each group is judged on its own) and at recent foals. A numeric goal (conformation,
  // Genetic Potential, Breed Total) that most of the herd already meets is too easy, so it suggests the level the top
  // third of the herd starts at; one nobody meets suggests something within reach; one that is not set gets a starting
  // value. Nothing changes until you apply a suggestion.
  function goalAdvice(state, sex) {
    var g = goalsOf(state, sex);
    var herd = ownedHorses(state).filter(function (h) {
      return (h.info.sex === 'mare' || h.info.sex === 'stallion') && (!sex || !(state.settings && state.settings.goalsSplit) || h.info.sex === sex) && !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && h.meta.status !== 'Companion';
    });
    function valuesOf(fn) { return herd.map(fn).filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; }); }
    function pct(arr, p) { if (!arr.length) return 0; var i = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p))); return arr[i]; }
    var metrics = [
      { key: 'minGP', label: 'Genetic Potential', dec: 0, vals: valuesOf(function (h) { return Number(h.info.geneticPotential) || 0; }) },
      { key: 'minConf', label: 'Top conformation', dec: 1, vals: valuesOf(function (h) { return bestConformation((state.horseMeta && state.horseMeta[h.lifeNumber]) || {}).best; }) },
      { key: 'minBT', label: 'Breed Total', dec: 1, vals: valuesOf(function (h) { return horseBT(state, h.lifeNumber); }) }
    ];
    function round(n, dec) { var f = Math.pow(10, dec); return Math.round(n * f) / f; }
    var out = { tips: [], review: [], herdSize: herd.length };
    metrics.forEach(function (m) {
      var n = m.vals.length;
      if (n < 4) return;
      var cur = g[m.key], target = round(pct(m.vals, 0.65), m.dec), median = round(pct(m.vals, 0.5), m.dec), best = m.vals[n - 1];
      if (cur == null) {
        out.tips.push({ key: m.key, set: goalsKeyFor(state, sex), label: m.label, kind: 'start', current: null, suggested: target, why: 'No goal set. The top third of your ' + n + ' horses starts at ' + target + ' (median ' + median + ', best ' + round(best, m.dec) + ').' });
        return;
      }
      var meet = m.vals.filter(function (v) { return v >= cur; }).length;
      if (meet / n >= 0.6) {
        var next = Math.max(target, round(cur + (m.dec ? 0.5 : 5), m.dec));
        out.tips.push({ key: m.key, set: goalsKeyFor(state, sex), label: m.label, kind: 'raise', current: cur, suggested: next, why: meet + ' of ' + n + ' horses (' + Math.round(meet / n * 100) + '%) already meet ' + cur + ', so the goal is not picking out your best. The top third of your herd starts at ' + target + '.' });
      } else if (meet === 0 && n >= 5) {
        out.tips.push({ key: m.key, set: goalsKeyFor(state, sex), label: m.label, kind: 'lower', current: cur, suggested: median, why: 'None of your ' + n + ' horses meet ' + cur + ' (best is ' + round(best, m.dec) + ', median ' + median + '). A goal within reach, like the median, keeps the highlights useful.' });
      }
    });
    // foals: recent foal scores that beat the conformation goal
    var cutoff = Date.now() - 180 * 86400000, scores = [];
    (state.stallions || []).forEach(function (s) {
      (state.breedings[s.id] || []).forEach(function (b) {
        var d = Date.parse(b.dateBorn || b.date || '');
        if (b.status === 'Foal Born' && b.foalScore > 0 && b.foalScore <= 100 && d && d >= cutoff) scores.push(b.foalScore);
      });
    });
    if (scores.length >= 3 && g.minConf != null) {
      var avg = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
      if (avg >= g.minConf + 2 && !out.tips.some(function (t) { return t.key === 'minConf' && t.kind === 'raise'; })) {
        out.tips.push({ key: 'minConf', set: goalsKeyFor(state, sex), label: 'Top conformation', kind: 'raise', current: g.minConf, suggested: round(avg - 1, 1), why: 'Your ' + scores.length + ' foals from the last 6 months average ' + round(avg, 1) + ', well above the goal of ' + g.minConf + '.' });
      }
    }
    // when to look again
    var at = state.settings && state.settings.goalsUpdatedAt;
    if (at) {
      var days = Math.floor((Date.now() - at) / 86400000), since = 0;
      (state.stallions || []).forEach(function (s) {
        (state.breedings[s.id] || []).forEach(function (b) { var d = Date.parse(b.dateBorn || b.date || ''); if (b.status === 'Foal Born' && d && d > at) since++; });
      });
      if (days >= 90) out.review.push('You last changed your goals ' + days + ' days ago. Goals are worth a look every three months or so.');
      if (since >= 3) out.review.push(since + ' foals have been born since you last changed your goals. A good moment to check them.');
    } else if (Object.keys(g).some(function (k) { return g[k] != null; })) {
      out.review.push('The ledger does not know when you last changed your goals. It will start counting from your next change.');
    }
    return out;
  }

  // ---------- from the wiki: times, pregnancy window, label ranges, Clinical Approved ----------
  var DAY_MS = 86400000;
  function fmtTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function fmtDay(ms) {
    var d = new Date(ms), mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return mo[d.getMonth()] + ' ' + d.getDate();
  }
  // A pregnancy lasts 13.5 to 17 real days (wiki: Life). Given when she was covered (a time, or just a date), the
  // earliest and latest birth. A date alone leaves a day of slack at the end.
  function dueWindow(coveredAt, dateOnly) {
    if (!coveredAt) return null;
    return { from: coveredAt + 13.5 * DAY_MS, to: coveredAt + 17 * DAY_MS + (dateOnly ? DAY_MS : 0) };
  }
  function dueWindowText(w) {
    if (!w) return '';
    var a = fmtDay(w.from), b = fmtDay(w.to);
    return a === b ? a : a + ' \u2013 ' + b;
  }
  // The latest covering of a mare that is still Pending or Succeeded: { at, dateOnly }
  function coveringOf(state, mareLife) {
    var best = null;
    Object.keys(state.breedings || {}).forEach(function (sid) {
      (state.breedings[sid] || []).forEach(function (b) {
        if (String(b.mareLifeNumber) !== String(mareLife) || (b.status !== 'Pending' && b.status !== 'Succeeded')) return;
        var at = b.coveredAt || (b.date ? new Date(b.date + 'T00:00:00').getTime() : 0);
        if (!at || isNaN(at)) return;
        if (!best || at > best.at) best = { at: at, dateOnly: !b.coveredAt };
      });
    });
    return best;
  }
  // The hidden number behind each label (wiki: Conformation, Health).
  var CONF_RANGES = { 'poor': '0\u201339', 'below average': '40\u201359', 'average': '60\u201369', 'good': '70\u201384', 'very good': '85\u2013100' };
  var HEALTH_RANGES = { 'poor': '0\u201320', 'fair': '21\u201340', 'average': '41\u201360', 'good': '61\u201380', 'excellent': '81\u2013100' };
  function labelRangeText(kind, label) {
    var key = String(label || '').toLowerCase().trim();
    var short = { 'g+': 'good', 'g': 'good', 'good+': 'good', 'good +': 'good', 'vg': 'very good', 'a': 'average', 'ba': 'below average' };
    if (short[key]) key = short[key];
    var table = kind === 'health' ? HEALTH_RANGES : CONF_RANGES;
    var r = table[key];
    return r ? label + ': the hidden number is ' + r + ' (the average of two inherited values)' : '';
  }
  // Clinical Approved: a stallion of 7 or older gets it if all five health stats and fertility are 75+ (wiki: Predicates).
  // Excellent (81+) always passes; Good (61-80) may or may not; Average or worse (60 or less) can never.
  function clinicalOutlook(info) {
    if (!info || info.sex !== 'stallion') return null;
    var h = info.health && typeof info.health === 'object' ? Object.keys(info.health).map(function (k) { return String(info.health[k]).toLowerCase(); }) : [];
    var fert = String(info.fertility || '').toLowerCase().trim();
    var vals = h.concat(fert ? [fert] : []);
    var out = { status: 'unknown', text: '' };
    if (/clinical/i.test(String(info.predicates || ''))) return { status: 'has', text: 'Has the Clinical Approved predicate.' };
    if (h.length < 5 || !fert) return { status: 'unknown', text: 'Needs a health check and a fertility test to tell.' };
    var rank = { poor: 0, fair: 0, average: 0, good: 1, excellent: 2 };
    var worst = Math.min.apply(null, vals.map(function (v) { return rank[v] == null ? 0 : rank[v]; }));
    var goods = vals.filter(function (v) { return v === 'good'; }).length;
    if (worst === 0) { out.status = 'no'; out.text = 'Can\u2019t qualify: at least one stat is Average or worse, and all six must be 75 or more.'; }
    else if (goods === 0) { out.status = 'yes'; out.text = 'All six stats are Excellent (81+), so he qualifies once he is 7 and has the clinical check.'; }
    else { out.status = 'maybe'; out.text = goods + ' of the six stats are Good (61\u201380); each needs 75+ for the predicate, so it can go either way.'; }
    return out;
  }

  // ---------- breeding timeline and foal ages (wiki: Breeding) ----------
  // Day 2 after covering: a failed covering is announced. Day 4: a miscarriage (or a W/W foal) is announced. Day 5: the
  // mare's page changes from "Covered X days ago" to "Due on ..." and the foal is certain. Birth comes 13.5 to 17 days
  // after covering. A foal is unweaned until 6 months old and a horse can be bred from 3 years.
  var COVERING_SETTLED_DAYS = 5, LAST_BIRTH_DAYS = 17;
  function coveredAtOf(b) {
    var at = b && (b.coveredAt || (b.date ? new Date(b.date + 'T00:00:00').getTime() : 0));
    return at && !isNaN(at) ? at : 0;
  }
  // A line saying where a covering stands: { text, stage } or null. stage: 'early' | 'wait' | 'settled' | 'due' | 'overdue'
  function coveringStage(b, now) {
    var at = coveredAtOf(b);
    if (!at || !b || (b.status !== 'Pending' && b.status !== 'Succeeded')) return null;
    now = now || Date.now();
    var d = (now - at) / DAY_MS, day = Math.floor(d) + 1, w = dueWindow(at, !b.coveredAt), due = dueWindowText(w);
    if (d < 2) return { stage: 'early', text: 'Day ' + day + ': a failed covering is announced on day 2' };
    if (d < 4) return { stage: 'wait', text: 'Day ' + day + ': a miscarriage would be announced on day 4' };
    if (d < COVERING_SETTLED_DAYS) return { stage: 'wait', text: 'Day ' + day + ': after the daily roll over her page shows "Due on ..." if she is in foal' };
    if (d <= LAST_BIRTH_DAYS) return { stage: b.status === 'Succeeded' ? 'due' : 'settled', text: (b.status === 'Succeeded' ? 'In foal' : 'Day ' + day + ': her page should say "Due on ..." if she is in foal') + '; birth expected ' + due };
    return { stage: 'overdue', text: 'Past the longest pregnancy (' + LAST_BIRTH_DAYS + ' days)' };
  }
  // Is a Pending covering safe to call Failed? Only when her page was saved on day 5 or later and does not show her in
  // foal, or when the longest pregnancy has passed with no foal. Between day 5 and 17 a Pending covering may be a real
  // pregnancy that has not been seen yet.
  function coveringLooksFailed(state, b, now) {
    var at = coveredAtOf(b);
    if (!at) return false;
    now = now || Date.now();
    if ((now - at) / DAY_MS > LAST_BIRTH_DAYS + 1) return true;
    var info = b.mareLifeNumber && state.horseInfo && state.horseInfo[b.mareLifeNumber];
    if (!info || !info.capturedAt || info.capturedAt < at + COVERING_SETTLED_DAYS * DAY_MS) return false;
    var st = String((info.pregnancy && info.pregnancy.status) || '');
    return !/pregnan|cover/i.test(st);
  }
  // A foal's age in game months: from its saved page, else from its birth time or date (a game month is 32 real hours)
  function foalAgeInfo(state, b) {
    var m = /\/horses\/(\d+)/.exec((b && b.foalUrl) || '');
    var info = m && state.horseInfo ? state.horseInfo[m[1]] : null, months = info ? effectiveAgeMonths(info) : null;
    if (months == null) {
      var born = b && (b.bornAt || (b.dateBorn ? new Date(b.dateBorn + 'T00:00:00').getTime() : 0));
      if (!born || isNaN(born)) return null;
      months = Math.max(0, Math.floor((Date.now() - born) / GAME_MS_PER_MONTH));
    }
    var text = formatAgeMonths(months) || '0 months';
    if (months < 6) text += ' · nursing, weaned at 6 months (' + (6 - months) + ' to go)';
    else if (months < 36) text += ' · weaned, can be bred from 3 years';
    else text += ' · breeding age';
    return { months: months, text: text };
  }

  // ---------- breeding calendar: foals due, mares ready, money, fee changes ----------
  // Days until the foal is due, from the site's due text ("Due in 5 days", "Due tomorrow"...). null if it can't be read.
  function dueDays(text) {
    var t = String(text || '');
    var m = /(\d+)\s*day/i.exec(t);
    if (m) return parseInt(m[1], 10);
    if (/hour|today|soon/i.test(t)) return 0;
    if (/tomorrow/i.test(t)) return 1;
    return null;
  }
  function foalsDue(state) {
    var out = [];
    ownedHorses(state).forEach(function (h) {
      if (h.info.sex !== 'mare' || isSoldLife(state, h.lifeNumber) || isArchivedHorse(h)) return;
      var st = mareBreedStatus(state, h.lifeNumber);
      if (st.status !== 'pregnant') return;
      var dueText = st.due, days = dueDays(st.due), estimated = false;
      if (!dueText) {
        var cv = coveringOf(state, h.lifeNumber), w = cv && dueWindow(cv.at, cv.dateOnly);
        if (w) { dueText = 'about ' + dueWindowText(w); days = Math.max(0, Math.ceil((w.from - Date.now()) / DAY_MS)); estimated = true; }
      }
      out.push({ life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), due: dueText, days: days, stallion: st.stallion, estimated: estimated });
    });
    return out.sort(function (a, b) { return (a.days == null ? 999 : a.days) - (b.days == null ? 999 : b.days); });
  }
  // Your adult mares that are not covered or in foal, longest-open first.
  function readyMares(state) {
    var out = [];
    ownedHorses(state).forEach(function (h) {
      if (h.info.sex !== 'mare' || isYoungInfo(h.info) || isSoldLife(state, h.lifeNumber) || isArchivedHorse(h) || h.meta.status === 'Companion') return;
      if (mareBreedStatus(state, h.lifeNumber).status) return;
      var last = null;
      Object.keys(state.breedings || {}).forEach(function (sid) {
        (state.breedings[sid] || []).forEach(function (b) {
          if (String(b.mareLifeNumber) !== h.lifeNumber) return;
          var d = b.status === 'Foal Born' ? (b.dateBorn || b.date) : b.date;
          if (d && (!last || d > last)) last = d;
        });
      });
      out.push({ life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), last: last, days: last ? Math.floor(daysSince(last)) : null });
    });
    return out.sort(function (a, b) { return (b.days == null ? 9999 : b.days) - (a.days == null ? 9999 : a.days); });
  }
  // HRC income and spending by month (last 12 months) plus all-time totals. Other currencies are left out.
  function moneySummary(state) {
    var months = {}, totals = { earned: 0, paid: 0, sold: 0, bought: 0 };
    var now = new Date(), keys = [];
    for (var i = 11; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      var k = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
      keys.push(k); months[k] = { m: k, earned: 0, paid: 0, sold: 0 };
    }
    (state.stallions || []).forEach(function (s) {
      (state.breedings[s.id] || []).forEach(function (b) {
        if (!(b.price > 0) || (b.currency || 'HRC') !== 'HRC') return;
        var kind = s.owned === false ? (isMyMare(state, String(b.mareLifeNumber)) ? 'paid' : '') : 'earned';
        if (!kind) return;
        totals[kind] += b.price;
        var mk = String(b.date || '').slice(0, 7);
        if (months[mk]) months[mk][kind] += b.price;
      });
    });
    Object.keys(state.horseMeta || {}).forEach(function (l) {
      var m = state.horseMeta[l];
      if (m.sale && m.sale.price > 0 && (m.sale.currency || 'HRC') === 'HRC') {
        totals.sold += m.sale.price;
        var mk = String(m.sale.date || '').slice(0, 7);
        if (months[mk]) months[mk].sold += m.sale.price;
      }
      var p = purchaseOf(state, l);
      if (p) {
        if (!p.price || p.currency === 'HRC') totals.bought += p.price;
        if (p.shipping && p.shippingCurrency === 'HRC') totals.bought += p.shipping;
      }
    });
    totals.net = totals.earned + totals.sold - totals.paid - totals.bought;
    return { months: keys.map(function (k) { return months[k]; }), totals: totals };
  }
  // Stallions whose public HRC fee changed in the last `days` days (from the fee history kept from their pages).
  function feeChanges(state, days) {
    var out = [], cutoff = new Date(Date.now() - (days || 14) * 86400000).toISOString().slice(0, 10);
    Object.keys(state.horseMeta || {}).forEach(function (l) {
      var log = state.horseMeta[l].studTermsLog;
      if (!Array.isArray(log) || log.length < 2) return;
      var last = log[log.length - 1], prev = log[log.length - 2];
      var a = prev.public && prev.public.HRC, b = last.public && last.public.HRC;
      if (!a || !b || a === b || last.date < cutoff) return;
      out.push({ life: l, name: (state.horseInfo[l] && state.horseInfo[l].name) || ('#' + l), from: a, to: b, pct: Math.round((b - a) / a * 100), date: last.date });
    });
    return out;
  }
  // A short sales ad for a horse, to paste into the market.
  function adText(state, life) {
    var info = state.horseInfo && state.horseInfo[life];
    if (!info) return '';
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    var conf = bestConformation(meta).best;
    var bt = Math.max(Number(meta.btBest) || 0, breedTotal(info.geneticPotential, conf));
    var lines = [];
    lines.push((info.name || ('#' + life)) + ' \u2014 ' + [info.breed, info.sex === 'stallion' ? 'stallion' : info.sex === 'mare' ? 'mare' : '', info.ageText || formatAgeMonths(effectiveAgeMonths(info))].filter(Boolean).join(', '));
    var stats = [];
    if (info.geneticPotential != null) stats.push('Genetic potential ' + info.geneticPotential);
    if (info.conformation) stats.push('Conformation ' + info.conformation);
    if (conf > 0) stats.push('Top conformation score ' + (Math.round(conf * 1000) / 1000));
    if (bt > 0) stats.push('Breed Total ' + (Math.round(bt * 10) / 10));
    if (stats.length) lines.push(stats.join(' | '));
    if (info.confTraits) lines.push('Traits: ' + Object.keys(info.confTraits).map(function (t) { return t + ' ' + info.confTraits[t]; }).join(', '));
    if (info.health && typeof info.health === 'object') {
      var hv = Object.keys(info.health).map(function (k) { return k + ' ' + info.health[k]; });
      if (hv.length) lines.push('Health: ' + hv.join(', '));
    }
    if (info.fertility) lines.push('Fertility: ' + info.fertility);
    if (info.testedColours) lines.push('Tested colours: ' + info.testedColours);
    if (meta.project) lines.push('Line: ' + meta.project);
    lines.push('https://www.horsereality.com/horses/' + life + '/');
    return lines.join('\n');
  }

  // ---------- foal results vs. what the parents predicted ----------
  // A foal's score (out of 100) against the average top conformation score of its two parents, for foals whose
  // parents both have a saved show score. Positive = the foal scored above its parents' average.
  function foalAccuracy(state) {
    var rows = [];
    (state.stallions || []).forEach(function (s) {
      if (!s.lifeNumber) return;
      var sConf = bestConformation((state.horseMeta && state.horseMeta[s.lifeNumber]) || {}).best;
      (state.breedings[s.id] || []).forEach(function (b) {
        if (b.status !== 'Foal Born' || !(b.foalScore > 0 && b.foalScore <= 100)) return;
        var mConf = bestConformation((state.horseMeta && state.horseMeta[b.mareLifeNumber]) || {}).best;
        if (!(sConf > 0 && mConf > 0)) return;
        var avg = (sConf + mConf) / 2;
        rows.push({ foal: b.foalName || 'Foal', mare: b.mareName || '', stallion: s.name, date: b.dateBorn || b.date || '', score: b.foalScore, parentsAvg: Math.round(avg * 10) / 10, diff: Math.round((b.foalScore - avg) * 10) / 10 });
      });
    });
    rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var n = rows.length;
    var sum = rows.reduce(function (t, r) { return t + r.diff; }, 0);
    return { count: n, avgDiff: n ? Math.round(sum / n * 10) / 10 : null, above: rows.filter(function (r) { return r.diff >= 0; }).length, rows: rows.slice(0, 8) };
  }
  // Owned horses whose saved page data is older than 30 days (open their page to refresh it).
  function staleOwned(state) {
    var cutoff = Date.now() - 30 * 86400000;
    return ownedHorses(state).filter(function (h) {
      return !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && h.info.capturedAt && h.info.capturedAt < cutoff;
    }).map(function (h) { return h.info.name || ('#' + h.lifeNumber); });
  }

  // ---------- sell ideas: which horses to sell, and what to ask ----------
  // Nothing here contacts Horse Reality. Prices come from your own past sales (price per Breed Total point
  // of the most similar horses you sold, in HRC) and never go below what you paid for the horse.
  var SELL_PACE = { quick: 0.85, fair: 1, high: 1.15 };
  function sellFormOf(state) {
    var f = (state.settings && state.settings.sellForm) || {};
    return {
      mares: f.mares !== false, stallions: f.stallions !== false, young: f.young !== false,
      mode: f.mode === 'weakest' ? 'weakest' : 'misses',
      pace: SELL_PACE[f.pace] ? f.pace : 'fair'
    };
  }
  function median(list) {
    var a = list.slice().sort(function (x, y) { return x - y; });
    if (!a.length) return 0;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function roundPrice(n) {
    var step = n >= 10000 ? 500 : n >= 1000 ? 100 : 10;
    return Math.max(step, Math.round(n / step) * step);
  }
  function horseBT(state, life) {
    var info = (state.horseInfo && state.horseInfo[life]) || {};
    var meta = (state.horseMeta && state.horseMeta[life]) || {};
    return Math.max(Number(meta.btBest) || 0, breedTotal(info.geneticPotential, bestConformation(meta).best));
  }
  // Stars on a horse's picture, from the limits in Settings (settings.stars = { conf, gp, bt }, 0 or missing = off):
  //   gold star: nothing lower than the conformation limit (judged on the lowest conformation score the ledger knows)
  //   teal "GP" star: genetic potential at or above its limit; violet "BT" star: Breed Total at or above its limit
  function lowestKnownConf(meta) {
    var v = [];
    if (Number(meta && meta.confLow) > 0) v.push(Number(meta.confLow));
    if (meta && Array.isArray(meta.showLog)) meta.showLog.forEach(function (e) { if (Number(e && e.score) > 0) v.push(Number(e.score)); });
    var best = bestConformation(meta || {}).best;
    if (best > 0) v.push(best);
    return v.length ? Math.min.apply(null, v) : 0;
  }
  function starsOf(state, life) {
    var cfg = (state && state.settings && state.settings.stars) || {}, out = [];
    var info = (state.horseInfo && state.horseInfo[life]) || null, meta = (state.horseMeta && state.horseMeta[life]) || {};
    if (!info) return out;
    var rnd = function (n) { return Math.round(n * 1000) / 1000; };
    var c = Number(cfg.conf) || 0;
    if (c > 0) { var low = lowestKnownConf(meta); if (low > 0 && low >= c) out.push({ key: 'conf', label: '', title: 'Conformation: nothing lower than ' + c + ' (lowest score known ' + rnd(low) + ')' }); }
    var g = Number(cfg.gp) || 0, gp = Number(info.geneticPotential);
    if (g > 0 && gp >= g) out.push({ key: 'gp', label: 'GP', title: 'Genetic potential ' + gp + ' (your limit ' + g + ')' });
    var b = Number(cfg.bt) || 0;
    if (b > 0) { var bt = horseBT(state, life); if (bt >= b) out.push({ key: 'bt', label: 'BT', title: 'Breed Total ' + rnd(bt) + ' (your limit ' + b + ')' }); }
    return out;
  }
  // The price to ask for one horse: { suggested, low, high, basis, comps, floor, belowCost }
  function priceIdea(state, life, pace, soldComps) {
    var bt = horseBT(state, life);
    var pr = profitOf(state, life);
    var p = purchaseOf(state, life);
    var cost = p && (!p.price || p.currency === 'HRC') && (!p.shipping || p.shippingCurrency === 'HRC') ? p.price + p.shipping : 0;
    var mult = SELL_PACE[pace] || 1;
    // A proven producer is worth more: +10% for a mare who out-produces herself or a stallion whose foals beat their
    // dams, +5% for a daughter of such a mare.
    var prem = 1, premWhy = '', pInfo = state.horseInfo && state.horseInfo[life];
    if (pInfo && pInfo.sex === 'mare') {
      if (producerRecord(state, life).improver) { prem = 1.1; premWhy = '+10% because she out-produces herself'; }
      else if (damImprover(state, life)) { prem = 1.05; premWhy = '+5% because her dam out-produces herself'; }
    } else if (pInfo && pInfo.sex === 'stallion' && sireRecord(state, life).improver) { prem = 1.1; premWhy = '+10% because his foals beat their dams'; }
    var out = { suggested: null, low: null, high: null, basis: '', comps: [], floor: cost || null, belowCost: false, premium: premWhy };
    if (bt > 0 && soldComps.length) {
      var near = soldComps.filter(function (c) { return String(c.life) !== String(life); })
        .sort(function (a, b) { return Math.abs(a.bt - bt) - Math.abs(b.bt - bt); }).slice(0, 3);
      if (near.length) {
        var est = median(near.map(function (c) { return c.price / c.bt; })) * bt * mult * prem;
        out.suggested = roundPrice(est); out.low = roundPrice(est * 0.85); out.high = roundPrice(est * 1.15);
        out.comps = near;
        out.basis = 'your ' + near.length + ' most similar past sale' + (near.length === 1 ? '' : 's') + ' (by Breed Total)';
      }
    }
    if (cost && (out.suggested == null || out.suggested < cost)) {
      out.belowCost = out.suggested != null;
      if (out.suggested == null) { out.suggested = roundPrice(cost * mult); out.low = roundPrice(cost); out.high = roundPrice(cost * 1.3); out.basis = 'what you paid (no similar sales of yours yet)'; }
      else { out.suggested = roundPrice(cost); if (out.low < cost) out.low = roundPrice(cost); if (out.high < out.suggested) out.high = roundPrice(out.suggested * 1.15); }
    }
    return out;
  }
  function sellIdeas(state) {
    var form = sellFormOf(state);
    var goalsOn = anyGoals(state);
    // past sales (and market results you saw) that give a price per Breed Total point
    var comps = priceComps(state);
    var herd = ownedHorses(state).filter(function (h) {
      return !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && h.meta.status !== 'Companion' &&
        (h.info.sex === 'mare' || h.info.sex === 'stallion');
    }).map(function (h) {
      var young = isYoungInfo(h.info);
      var meta = (state.horseMeta && state.horseMeta[h.lifeNumber]) || {};
      return { h: h, life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), sex: h.info.sex, young: young, bt: horseBT(state, h.lifeNumber),
        conf: bestConformation(meta).best, gp: h.info.geneticPotential, forSale: h.meta.status === 'For Sale' };
    });
    // Each horse is compared with its own group: mares & fillies, or stallions & colts.
    var GROUP_NAME = { mare: 'mares & fillies', stallion: 'stallions & colts' };
    var groupStats = {};
    ['mare', 'stallion'].forEach(function (sx) {
      var bts = herd.filter(function (x) { return x.sex === sx && x.bt > 0; }).map(function (x) { return x.bt; }).sort(function (a, b) { return a - b; });
      groupStats[sx] = { med: median(bts), lowCut: bts.length >= 4 ? bts[Math.floor(bts.length / 4)] : 0 };
    });
    var med = Math.max(groupStats.mare.med, groupStats.stallion.med);

    var ideas = [], forSale = [], held = [];
    var FXs = focusOf(state), fxVals = {};
    FXs.keys.forEach(function (k) { if (k === 'profit') return; fxVals[k] = {}; herd.forEach(function (h) { fxVals[k][h.life] = focusMetric(state, h.life, k, FXs.discipline); }); });
    function fxStanding(k, x) { return focusStanding(k, fxVals[k][x.life], herd.filter(function (h) { return h.sex === x.sex; }).map(function (h) { return fxVals[k][h.life]; })); }
    herd.forEach(function (x) {
      var price = priceIdea(state, x.life, form.pace, comps);
      if (x.forSale) { forSale.push(Object.assign({ price: price }, x)); return; }
      var kind = x.young ? (x.sex === 'stallion' ? 'Colt' : 'Filly') : (x.sex === 'stallion' ? 'Stallion' : 'Mare');
      if ((x.young && !form.young) || (!x.young && x.sex === 'mare' && !form.mares) || (!x.young && x.sex === 'stallion' && !form.stallions)) return;
      var noteRules = horseNoteRules(state, x.life), groupKey = x.young ? (x.sex === 'mare' ? 'filly' : 'colt') : x.sex;
      if (noteRules.keep || overallNoteRules(state).keepGroups[groupKey]) return; // your notes say to keep her / him
      var reasons = [], score = 0;
      if (noteRules.sell) { score += 3; reasons.push('Your note says to sell'); }
      // What her foals (or his) have done: keep the proven producers and their daughters, flag the poor ones
      var heldWhy = '';
      if (x.sex === 'mare') {
        var prod = producerRecord(state, x.life);
        var dimp = damImprover(state, x.life);
        if (prod.improver) heldWhy = 'she out-produces herself (foals average ' + prod.avgFoal + ' vs her ' + prod.mareScore + ')';
        else if (dimp) heldWhy = 'her dam ' + dimp.name + ' out-produces herself';
        else if (prod.scored >= 2 && prod.avgDelta != null && prod.avgDelta < -3 && prod.better === 0) { score += 2; reasons.push('Her ' + prod.scored + ' scored foals average ' + prod.avgFoal + ', below her own ' + prod.mareScore); }
      } else {
        var sr = sireRecord(state, x.life);
        if (sr.improver) heldWhy = 'his foals beat their dams by ' + sr.avgDelta + ' on average';
        else if (sr.scored >= 3 && sr.avgDelta < -3 && sr.better === 0) { score += 2; reasons.push('His ' + sr.scored + ' scored foals average ' + sr.avgFoal + ', ' + Math.abs(sr.avgDelta) + ' below their dams'); }
      }
      // genes you want to keep
      var allGenes = preferredGenesOf(state, x.life);
      var keepGenes = allGenes.filter(function (g) { return g.level !== 'avoid' && !g.suspected; });
      var avoidGenes = allGenes.filter(function (g) { return g.level === 'avoid'; });
      if (avoidGenes.length) { score += 2; reasons.push('Carries ' + avoidGenes.map(function (g) { return g.name; }).join(', ') + ', a gene you don\'t want'); }
      var hardGene = keepGenes.filter(function (g) { return g.level === 'keep'; });
      if (!heldWhy && hardGene.length) heldWhy = 'carries ' + hardGene.map(function (g) { return g.name; }).join(', ') + ', a gene you want to keep';
      else if (!heldWhy && keepGenes.length) { score -= 2; reasons.push('Carries ' + keepGenes.map(function (g) { return g.name; }).join(', ') + ' (a gene you prefer), so less likely to sell'); }
      if (heldWhy && !noteRules.sell) { held.push({ life: x.life, name: x.name, why: heldWhy, kind: 'record' }); return; }
      var med = groupStats[x.sex].med, lowCut = groupStats[x.sex].lowCut, gname = GROUP_NAME[x.sex];
      var misses = goalsOn ? goalMisses(state, x.life) : [];
      var met = goalsOn && goalCheck(state, x.life).met;
      if (met && !noteRules.sell) return;
      // a miss of under 1% outside your focus is not counted; a miss in a focus area counts for more
      var nearM = [], hardM = [], secM = misses.length ? goalSections(state, x.life) : null, missPts = 0;
      misses.forEach(function (lbl) { var fk = focusKeyOfLabel(lbl), inF = FXs.keys.indexOf(fk) > -1; if (!inF && isNearMiss(secM, lbl)) { nearM.push(lbl); return; } hardM.push(lbl); missPts += inF ? 4 : 3; });
      misses = hardM;
      if (misses.length) { score += missPts; reasons.push('Misses your goal' + (misses.length === 1 ? '' : 's') + ': ' + misses.join(', ')); }
      if (nearM.length && misses.length) reasons.push('Within 1% of your ' + nearM.join(', ') + ' goal (not counted)');
      FXs.keys.forEach(function (k) {
        if (k === 'profit') { if (price.floor && price.suggested && price.suggested >= price.floor * 1.25) { score += 1; reasons.push('Would sell about ' + Math.round((price.suggested / price.floor - 1) * 100) + '% above what you paid (your focus is profit)'); } return; }
        var st = fxStanding(k, x);
        if (st === 1) { score -= 1; reasons.push('Strong in your focus, ' + focusLabel(k) + ', so less likely to sell'); }
        else if (st === -1) { score += 1; reasons.push('Weak in your focus, ' + focusLabel(k)); }
      });
      if (x.bt > 0 && med > 0 && x.bt < med * 0.92) { score += 2; reasons.push('Breed Total ' + (Math.round(x.bt * 10) / 10) + ' is below your ' + gname + ' median of ' + (Math.round(med * 10) / 10)); }
      if (x.bt > 0 && lowCut && x.bt <= lowCut) { score += 1; reasons.push('In the bottom quarter of your ' + gname + ' by Breed Total'); }
      if (x.sex === 'mare') {
        var rows = 0;
        Object.keys(state.breedings || {}).forEach(function (sid) {
          (state.breedings[sid] || []).forEach(function (b) { if (String(b.mareLifeNumber) === String(x.life)) rows++; });
        });
        if (!x.young && !rows) { score += 1; reasons.push('Never bred'); }
        var st = mareBreedStatus(state, x.life);
        if (st.status) { held.push({ life: x.life, name: x.name, why: st.status === 'pregnant' ? 'in foal' : 'just covered', kind: 'foal' }); return; }
      } else if (!x.young) {
        var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(x.life); });
        var recs = rec ? (state.breedings[rec.id] || []) : [];
        var done = recs.filter(function (b) { return b.status === 'Succeeded' || b.status === 'Failed' || b.status === 'Foal Born'; });
        var failed = done.filter(function (b) { return b.status === 'Failed'; }).length;
        if (done.length >= 5 && failed / done.length >= 0.4) { score += 2; reasons.push('Fails ' + Math.round(failed / done.length * 100) + '% of his resolved breedings'); }
        if (!recs.length) { score += 1; reasons.push('No breedings recorded'); }
      }
      var qualifies = noteRules.sell || ((form.mode === 'misses' && goalsOn) ? misses.length > 0 : (score >= 2 || (lowCut && x.bt > 0 && x.bt <= lowCut)));
      if (!qualifies) return;
      if (!reasons.length) return;
      ideas.push(Object.assign({ kind: kind, score: score, reasons: reasons, price: price, misses: misses }, x));
    });
    ideas.sort(function (a, b) { return b.score - a.score || a.bt - b.bt; });
    return { form: form, goalsOn: goalsOn, ideas: ideas, forSale: forSale, held: held, medianBT: med, comps: comps.length };
  }

  // ---------- analytics: numbers and suggestions drawn from what is already saved ----------
  // Nothing here makes a network request. A breeding that worked is stored as a
  // "Succeeded" row and later also as a "Foal Born" row, so a success is counted
  // once: every Foal Born row, plus each Succeeded row whose mare has no Foal
  // Born row under the same stallion.
  function analytics(state) {
    var now = Date.now();
    var myName = String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
    var allBreedings = state.breedings || {};
    function addTotals(into, rec) {
      if (rec.price > 0) { var c = rec.currency || 'HRC'; into[c] = (into[c] || 0) + rec.price; }
    }
    function latest(a, b) { return b && (!a || b > a) ? b : a; }

    function myHorses() { return ownedHorses(state).filter(function (h) { return !isSoldLife(state, h.lifeNumber); }); }
    var stallions = (state.stallions || []).filter(function (s) {
      if (s.owned === false || s.status === 'Sold') return false;
      var si = s.lifeNumber && state.horseInfo ? state.horseInfo[s.lifeNumber] : null;
      return !(si && isYoungInfo(si));
    }).map(function (s) {
      var recs = allBreedings[s.id] || [];
      var foalMares = {};
      recs.forEach(function (r) { if (r.status === 'Foal Born' && r.mareLifeNumber) foalMares[r.mareLifeNumber] = true; });
      var out = { id: s.id, name: s.name, lifeNumber: s.lifeNumber, status: s.status || 'Active', breedings: 0, succeeded: 0, failed: 0, pending: 0, foals: 0, earned: {}, scores: [], last: '' };
      recs.forEach(function (r) {
        var st = r.status || 'Pending';
        if (st === 'Foal Born') { out.foals++; out.succeeded++; }
        else if (st === 'Succeeded') { if (!(r.mareLifeNumber && foalMares[r.mareLifeNumber])) out.succeeded++; out.breedings++; }
        else if (st === 'Failed') { out.failed++; out.breedings++; }
        else { out.pending++; out.breedings++; }
        addTotals(out.earned, r);
        // foal scores are out of 100; anything higher was misread from the page and is ignored
        if (r.foalScore > 0 && r.foalScore <= 100) out.scores.push(Number(r.foalScore));
        if (st !== 'Foal Born') out.last = latest(out.last, r.date);
      });
      out.resolved = out.succeeded + out.failed;
      out.successRate = out.resolved ? out.succeeded / out.resolved : null;
      out.avgScore = out.scores.length ? out.scores.reduce(function (a, b) { return a + b; }, 0) / out.scores.length : null;
      out.bestScore = out.scores.length ? Math.max.apply(null, out.scores) : null;
      return out;
    });

    var overall = { breedings: 0, succeeded: 0, failed: 0, pending: 0, foals: 0, earned: {}, scores: [] };
    stallions.forEach(function (s) {
      overall.breedings += s.breedings; overall.succeeded += s.succeeded; overall.failed += s.failed;
      overall.pending += s.pending; overall.foals += s.foals;
      Object.keys(s.earned).forEach(function (c) { overall.earned[c] = (overall.earned[c] || 0) + s.earned[c]; });
      overall.scores = overall.scores.concat(s.scores);
    });
    overall.resolved = overall.succeeded + overall.failed;
    overall.successRate = overall.resolved ? overall.succeeded / overall.resolved : null;
    overall.avgScore = overall.scores.length ? overall.scores.reduce(function (a, b) { return a + b; }, 0) / overall.scores.length : null;

    // breedings and fee income per month (all stallions, including studs used for your own mares)
    var months = {};
    Object.keys(allBreedings).forEach(function (sid) {
      (allBreedings[sid] || []).forEach(function (r) {
        if (r.status === 'Foal Born' || !r.date) return;
        var key = String(r.date).slice(0, 7);
        var m = months[key] = months[key] || { key: key, breedings: 0, earned: 0 };
        m.breedings++;
        if (r.price > 0 && (r.currency || 'HRC') === 'HRC') m.earned += r.price;
      });
    });
    var monthList = [];
    var d = new Date(now);
    for (var i = 11; i >= 0; i--) {
      var dt = new Date(d.getFullYear(), d.getMonth() - i, 1);
      var key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
      monthList.push(months[key] || { key: key, breedings: 0, earned: 0 });
    }

    // your own adult mares
    var mares = [];
    Object.keys(state.horseInfo || {}).forEach(function (life) {
      var info = state.horseInfo[life];
      var meta = (state.horseMeta && state.horseMeta[life]) || {};
      if (!info || info.sex !== 'mare' || !myName || String(info.ownerName || '').trim().toLowerCase() !== myName) return;
      if (isSoldLife(state, life) || meta.status === 'Retired' || meta.status === 'Deceased') return;
      var m = { life: life, name: info.name || ('#' + life), young: isYoungInfo(info), breedings: 0, foals: 0, last: '', pregnant: !!(info.pregnancy && String(info.pregnancy.status || '').indexOf('Pregnant') === 0) };
      Object.keys(allBreedings).forEach(function (sid) {
        (allBreedings[sid] || []).forEach(function (r) {
          if (String(r.mareLifeNumber) !== String(life)) return;
          if (r.status === 'Foal Born') { m.foals++; return; }
          m.breedings++;
          m.last = latest(m.last, r.date);
        });
      });
      mares.push(m);
    });

    // under 3: listed as colts (young stallions) and fillies (young mares)
    var youngList = [];
    myHorses().forEach(function (h) {
      var info = h.info;
      if ((info.sex !== 'stallion' && info.sex !== 'mare') || !isYoungInfo(info)) return;
      if (h.meta.status === 'Sold' || h.meta.status === 'Retired' || h.meta.status === 'Deceased') return;
      var conf = bestConformation(h.meta).best;
      var meta = (state.horseMeta && state.horseMeta[h.lifeNumber]) || {};
      youngList.push({
        life: h.lifeNumber, name: info.name || ('#' + h.lifeNumber), kind: info.sex === 'stallion' ? 'Colt' : 'Filly',
        age: info.ageText || formatAgeMonths(effectiveAgeMonths(info)),
        ageMonths: effectiveAgeMonths(info),
        gp: info.geneticPotential != null ? info.geneticPotential : null,
        conf: conf > 0 ? conf : null,
        bt: Math.max(Number(meta.btBest) || 0, breedTotal(info.geneticPotential, conf)) || null
      });
    });
    youngList.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

    // suggestions
    var tips = [];
    var review = findReviewCandidates(state, 6);
    if (review.length) tips.push({ level: 'warn', text: review.length + ' covering' + (review.length === 1 ? ' is' : 's are') + ' 6+ days old with no result yet. Check the mares\' pages before they are marked Failed.' });
    stallions.forEach(function (s) {
      if (s.resolved >= 5 && s.failed / s.resolved >= 0.4) {
        tips.push({ level: 'warn', text: s.name + ': ' + Math.round(100 * s.failed / s.resolved) + '% of resolved coverings failed (' + s.failed + ' of ' + s.resolved + '). Consider a fertility check or a lower fee until it improves.' });
      }
    });
    var idle = stallions.filter(function (s) {
      if (s.status !== 'Active') return false;
      var days = s.last ? daysSince(s.last) : null;
      return days == null || days > 45;
    }).map(function (s) { return s.name; });
    if (idle.length) tips.push({ level: 'tip', text: 'No breedings in 45+ days: ' + idle.join(', ') + '. A lower fee or a promotion may help.' });
    var ready = mares.filter(function (m) {
      if (m.young || m.pregnant) return false;
      var days = m.last ? daysSince(m.last) : null;
      return days == null || days > 30;
    }).map(function (m) { return m.name; });
    if (ready.length) tips.push({ level: 'tip', text: ready.length + ' mare' + (ready.length === 1 ? '' : 's') + ' not in foal and not bred in 30+ days: ' + ready.slice(0, 8).join(', ') + (ready.length > 8 ? ' and ' + (ready.length - 8) + ' more' : '') + '.' });

    // missing data
    var gaps = [];
    myHorses().forEach(function (h) {
      if (h.meta.status === 'Retired') return;
      var missing = [];
      if (h.info.geneticPotential == null) missing.push('genetic potential');
      if (!h.info.confTraits) missing.push('conformation traits');
      if (!h.info.health) missing.push('health check');
      if (!(bestConformation(h.meta).best > 0)) missing.push('a show score');
      if (missing.length) gaps.push({ life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), missing: missing });
    });
    if (gaps.length) tips.push({ level: 'info', text: gaps.length + ' of your horses are missing data (e.g. ' + gaps[0].name + ': ' + gaps[0].missing.join(', ') + '). Open each horse on Horse Reality once and its page is read automatically.' });

    // goals
    var goalHits = [], nearMiss = [];
    myHorses().forEach(function (h) {
      var c = goalCheck(state, h.lifeNumber);
      if (!c.active) return;
      if (c.met) { goalHits.push({ name: h.info.name || ('#' + h.lifeNumber), life: h.lifeNumber }); return; }
      var s = c.sections;
      var bad = [s.conf, s.gp, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'bad'; });
      var unknown = [s.conf, s.gp, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'na' && x.text === 'no data yet'; });
      if (bad.length === 1 && !unknown.length) nearMiss.push({ name: h.info.name || ('#' + h.lifeNumber), life: h.lifeNumber, missing: bad[0].label, detail: bad[0].text, why: bad[0].label + ' ' + bad[0].text });
    });
    if (nearMiss.length) tips.push({ level: 'tip', text: nearMiss.length + ' horse' + (nearMiss.length === 1 ? ' misses' : 's miss') + ' your goals by only one box: ' + nearMiss.slice(0, 5).map(function (n) { return n.name + ' (' + n.why + ')'; }).join('; ') + '.' });

    // pairing ideas: your free adult mares x your active stallions. Ranked mostly by the
    // foal's estimated Breed Total (from the parents' average genetic potential and
    // average top conformation score), nudged up where one parent's strength covers the
    // other's Below-average conformation trait, and down for shared weak traits and inbreeding.
    var TRAIT_RANK = { 'below average': 0, 'average': 1, 'good': 2, 'good+': 3, 'good +': 3, 'very good': 4 };
    function traitRank(v) { var r = TRAIT_RANK[String(v || '').toLowerCase().trim()]; return r == null ? null : r; }
    var pairs = [], LMa = learnedModel(state), FXa = focusOf(state);
    var studs = stallions.filter(function (s) { return s.status === 'Active' && s.lifeNumber && state.horseInfo[s.lifeNumber] && state.horseInfo[s.lifeNumber].geneticPotential != null; });
    mares.filter(function (m) { return !m.young && !m.pregnant && state.horseInfo[m.life].geneticPotential != null; }).forEach(function (m) {
      var mInfo = state.horseInfo[m.life], mConf = bestConformation((state.horseMeta && state.horseMeta[m.life]) || {}).best;
      studs.forEach(function (s) {
        var sInfo = state.horseInfo[s.lifeNumber], sConf = bestConformation((state.horseMeta && state.horseMeta[s.lifeNumber]) || {}).best;
        if (!sameBreed(sInfo, mInfo)) return;
        var pairFx = partnerNoteEffect(state, m.life, s.lifeNumber);
        if (pairFx.skip) return;
        // the expected foal, adjusted by what the ledger has learned from your own foals
        var est0 = pairEstimate(state, m.life, s.lifeNumber, LMa);
        var gp = est0 ? est0.gp : (Number(mInfo.geneticPotential) + Number(sInfo.geneticPotential)) / 2;
        var conf = est0 ? est0.conf : null;
        var estBT = conf ? breedTotal(gp, conf) : null;
        var common = commonAncestors(ancestorMap(state, m.life, 3), ancestorMap(state, s.lifeNumber, 3));
        var coi = estimateCoi(common);
        var shared = [], fixes = [];
        if (mInfo.confTraits && sInfo.confTraits) {
          Object.keys(mInfo.confTraits).forEach(function (t) {
            var a = traitRank(mInfo.confTraits[t]), b = traitRank(sInfo.confTraits[t]);
            if (a == null || b == null) return;
            if (a === 0 && b === 0) shared.push(t);
            else if (a === 0 && b >= 2) fixes.push({ trait: t, from: 'stallion' });
            else if (b === 0 && a >= 2) fixes.push({ trait: t, from: 'mare' });
          });
        }
        // ranked on the foal's expected conformation score, genetic potential and conformation stats, not on Breed Total
        var foalExp = { conf: conf, gp: gp, traitAvg: est0 ? est0.traitAvg : null, weak: est0 ? est0.weak : 0, strong: est0 ? est0.strong : 0 };
        var score = (conf != null ? foalScoreOf(foalExp, FXa) / 2 : gp / 10) + 0.3 * fixes.length - 0.6 * shared.length - 0.2 * coi + pairFx.bonus + preferredGeneBonus(state, m.life, s.lifeNumber).bonus;
        pairs.push({
          mare: m.name, stallion: s.name, mareLife: m.life, stallionLife: s.lifeNumber, gp: Math.round(gp * 10) / 10,
          conf: conf != null ? Math.round(conf * 10) / 10 : null,
          estBT: estBT != null ? Math.round(estBT * 10) / 10 : null,
          coi: Math.round(coi * 100) / 100, shared: shared, fixes: fixes,
          noScore: !(mConf > 0 && sConf > 0), score: score,
          traitN: est0 ? est0.traitN : 0, strong: foalExp.strong, weak: foalExp.weak
        });
      });
    });
    pairs = pairs.filter(function (p) { return p.coi < 6.25; }).sort(function (a, b) { return b.score - a.score; }).slice(0, 5);

    // standouts
    var best = myHorses().map(function (h) {
      var meta = state.horseMeta[h.lifeNumber] || {};
      var bt = Math.max(Number(meta.btBest) || 0, breedTotal(h.info.geneticPotential, bestConformation(meta).best));
      return { name: h.info.name || ('#' + h.lifeNumber), life: h.lifeNumber, bt: bt, conf: bestConformation(meta).best, gp: h.info.geneticPotential };
    });
    var topBT = best.filter(function (x) { return x.bt > 0; }).sort(function (a, b) { return b.bt - a.bt; }).slice(0, 5);
    var topConf = best.filter(function (x) { return x.conf > 0; }).sort(function (a, b) { return b.conf - a.conf; }).slice(0, 5);

    // horses you have sold: what they fetched, what they cost, the difference
    var soldLives = {};
    Object.keys(state.horseMeta || {}).forEach(function (l) { if (isSoldLife(state, l)) soldLives[l] = true; });
    (state.stallions || []).forEach(function (s) { if (s.lifeNumber && s.status === 'Sold') soldLives[s.lifeNumber] = true; });
    var soldList = Object.keys(soldLives).map(function (l) {
      var info = (state.horseInfo && state.horseInfo[l]) || {};
      var rec = (state.stallions || []).find(function (x) { return x.lifeNumber && String(x.lifeNumber) === String(l); });
      var sa = saleOf(state, l), pr = profitOf(state, l);
      return {
        life: l, name: info.name || (rec && rec.name) || ('#' + l),
        date: sa ? sa.date : '', price: sa ? sa.price : null, currency: sa ? sa.currency : '', buyer: sa ? sa.buyer : '',
        cost: pr ? pr.cost : null, profit: pr ? pr.profit : null
      };
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    var soldSummary = { count: soldList.length, withPrice: 0, revenue: {}, profit: 0, profitKnown: 0 };
    soldList.forEach(function (x) {
      if (x.price) { soldSummary.withPrice++; soldSummary.revenue[x.currency || 'HRC'] = (soldSummary.revenue[x.currency || 'HRC'] || 0) + x.price; }
      if (x.profit != null && x.currency === 'HRC') { soldSummary.profit += x.profit; soldSummary.profitKnown++; }
    });
    soldSummary.avg = soldSummary.withPrice && soldSummary.revenue.HRC ? soldSummary.revenue.HRC / soldList.filter(function (x) { return x.price && x.currency === 'HRC'; }).length : null;

    return { sold: soldList, soldSummary: soldSummary, overall: overall, stallions: stallions, months: monthList, mares: mares, young: youngList, tips: tips, pairs: pairs, topBT: topBT, topConf: topConf, goalHits: goalHits.length, goalHitList: goalHits, nearMiss: nearMiss.length, nearMissList: nearMiss, gaps: gaps.length };
  }
  // What was paid for a horse (and shipping), recorded in
  // state.horseMeta[life].purchase = { price, currency, shipping, shippingCurrency }.
  function purchaseOf(state, lifeNumber) {
    var p = state.horseMeta && state.horseMeta[lifeNumber] && state.horseMeta[lifeNumber].purchase;
    if (!p) return null;
    var price = Number(p.price) || 0, shipping = Number(p.shipping) || 0;
    if (!price && !shipping) return null;
    return { price: price, currency: p.currency || 'HRC', shipping: shipping, shippingCurrency: p.shippingCurrency || 'HRC' };
  }

  global.HRLib = {
    purchaseOf: purchaseOf,
    sellIdeas: sellIdeas,
    pairIdeas: pairIdeas,
    producerRecord: producerRecord,
    preferLoci: preferLoci,
    fitSummary: fitSummary,
    recordAsk: recordAsk,
    recordRetired: recordRetired,
    recordSoldByOwner: recordSoldByOwner,
    askSummary: askSummary,
    buyCriteriaOf: buyCriteriaOf,
    marketRowInfo: marketRowInfo,
    recordCompScore: recordCompScore,
    compSummary: compSummary,
    starsOf: starsOf,
    studAccess: studAccess,
    compScoreOf: compScoreOf,
    disciplineNameOf: disciplineNameOf,
    COMP_DISCIPLINES: COMP_DISCIPLINES,
    partnerList: partnerList,
    partnerOwnerOf: partnerOwnerOf,
    addPartner: addPartner,
    removePartner: removePartner,
    MAX_PARTNERS: MAX_PARTNERS,
    normalizeTag: normalizeTag,
    tagsOf: tagsOf,
    addTagTo: addTagTo,
    removeTagFrom: removeTagFrom,
    allTags: allTags,
    tagQueryMatch: tagQueryMatch,
    MAX_TAGS: MAX_TAGS,
    parseToolkitTagline: parseToolkitTagline,
    parseToolkitPrivateTag: parseToolkitPrivateTag,
    applyToolkitTags: applyToolkitTags,
    recordLowScore: recordLowScore,
    rangeStatus: rangeStatus,
    fullScoreRange: fullScoreRange,
    MAX_SCORE_RANGE: MAX_SCORE_RANGE,
    studRowInfo: studRowInfo,
    pairEstimate: pairEstimate,
    marketComps: marketComps,
    priceComps: priceComps,
    priceBenchmark: priceBenchmark,
    herdBenefit: herdBenefit,
    buyAdvice: buyAdvice,
    preferenceMap: preferenceMap,
    horseGenotype: horseGenotype,
    preferredGenesOf: preferredGenesOf,
    foalPreferredChances: foalPreferredChances,
    sireRecord: sireRecord,
    damImprover: damImprover,
    improverMares: improverMares,
    parseNotes: parseNotes,
    overallNoteRules: overallNoteRules,
    horseNoteRules: horseNoteRules,
    partnerNoteEffect: partnerNoteEffect,
    stallionAvailable: stallionAvailable,
    HR_BREEDS: HR_BREEDS,
    DISCIPLINES: DISCIPLINES,
    disciplineFit: disciplineFit,
    breedKey: breedKey,
    breedKeyOf: breedKeyOf,
    sameBreed: sameBreed,
    foalAccuracy: foalAccuracy,
    foalsDue: foalsDue,
    herdAdvice: herdAdvice,
    partnerAdvice: partnerAdvice,
    markStable: markStable,
    foalKeeperInfo: foalKeeperInfo,
    keeperLines: keeperLines,
    herdRanking: herdRanking,
    focusOf: focusOf,
    FOCUS_TYPES: FOCUS_TYPES,
    RANK_LEVELS: RANK_LEVELS,
    learnedModel: learnedModel,
    learnedSummary: learnedSummary,
    learnedBuying: learnedBuying,
    learnedBuyTips: learnedBuyTips,
    suggestedTopBid: suggestedTopBid,
    predictFoalConf: predictFoalConf,
    learnedFailure: learnedFailure,
    coveringStage: coveringStage,
    coveringLooksFailed: coveringLooksFailed,
    foalAgeInfo: foalAgeInfo,
    fmtTime: fmtTime,
    dueWindow: dueWindow,
    dueWindowText: dueWindowText,
    coveringOf: coveringOf,
    labelRangeText: labelRangeText,
    clinicalOutlook: clinicalOutlook,
    goalAdvice: goalAdvice,
    readyMares: readyMares,
    moneySummary: moneySummary,
    feeChanges: feeChanges,
    adText: adText,
    dueDays: dueDays,
    trashPush: trashPush,
    purgeTrash: purgeTrash,
    restoreTrash: restoreTrash,
    staleOwned: staleOwned,
    sellFormOf: sellFormOf,
    breedTotal: breedTotal,
    isSoldLife: isSoldLife,
    applyStudFee: applyStudFee,
    breedingSuggestions: breedingSuggestions,
    studTermsOf: studTermsOf,
    applyStudFrames: applyStudFrames,
    priceList: priceList,
    recordCoveringFromPage: recordCoveringFromPage,
    dedupeFoals: dedupeFoals,
    mareBreedStatus: mareBreedStatus,
    goalMisses: goalMisses,
    recordFoalsFromList: recordFoalsFromList,
    horseRemovalCounts: horseRemovalCounts,
    removeHorse: removeHorse,
    purgeIgnored: purgeIgnored,
    recordFoalFromHorse: recordFoalFromHorse,
    foalLifeOf: foalLifeOf,
    saleOf: saleOf,
    profitOf: profitOf,
    analytics: analytics,
    goalsOf: goalsOf,
    goalsKeyFor: goalsKeyFor,
    anyGoals: anyGoals,
    healthCounts: healthCounts,
    goalSections: goalSections,
    goalCheck: goalCheck,
    traitCounts: traitCounts,
    refreshBreedTotals: refreshBreedTotals,
    parseConformation: parseConformation,
    pedigreeTreeOf: pedigreeTreeOf,
    parseColourGenes: parseColourGenes,
    unreadColourTokens: unreadColourTokens,
    colourOutcomes: colourOutcomes,
    EXTRA_LOCI: EXTRA_LOCI,
    MANUAL_LOCI: MANUAL_LOCI,
    ALL_LOCI: ALL_LOCI,
    agoutiPlain: agoutiPlain,
    extraGenotypeOptions: extraGenotypeOptions,
    manualGenes: manualGenes,
    genotypeText: genotypeText,
    genotypeOptionLabel: genotypeOptionLabel,
    suspectedGenes: suspectedGenes,
    suspectedGenotypeOptions: suspectedGenotypeOptions,
    peacockOf: peacockOf,
    adoptOwnedStallions: adoptOwnedStallions,
    ancestorMap: ancestorMap,
    commonAncestors: commonAncestors,
    estimateCoi: estimateCoi,
    ancestorName: ancestorName,
    HERD_STATUSES: HERD_STATUSES,
    HERD_ROLES: HERD_ROLES,
    ARCHIVE_STATUSES: ARCHIVE_STATUSES,
    herdStatusClass: herdStatusClass,
    herdMeta: herdMeta,
    bestConformation: bestConformation,
    ownedHorses: ownedHorses,
    trackedOtherHorses: trackedOtherHorses,
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
    ageYears: ageYears,
    isYoungHorse: isYoungHorse,
    effectiveAgeYears: effectiveAgeYears,
    effectiveAgeMonths: effectiveAgeMonths,
    parseAgeText: parseAgeText,
    formatAgeMonths: formatAgeMonths,
    isYoungInfo: isYoungInfo,
    findReviewCandidates: findReviewCandidates
  };
})(typeof window !== 'undefined' ? window : this);
