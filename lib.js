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
    if (info.ageMonths != null) return info.ageMonths;
    if (info.manualAgeMonths != null) return info.manualAgeMonths;
    var y = ageYears(info.dateOfBirth);
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
    var y = /(\d+)\s*year/i.exec(text);
    var m = /(\d+)\s*month/i.exec(text);
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
  function ownedHorses(state) {
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
    { id: 'A', name: 'Agouti (A)', alleles: ['A', 'a'] },
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
    { id: 'STY', name: 'Sooty (Sty)', alleles: ['Sty', 'sty'], absent: ['sty', 'sty'], label: 'Sooty' },
    { id: 'FL', name: 'Flaxen (Fl)', alleles: ['Fl', 'fl'], absent: ['Fl', 'Fl'], recessive: true, label: 'Flaxen', only: 'chestnut' },
    { id: 'Z', name: 'Silver (Z)', alleles: ['Z', 'n'], absent: ['n', 'n'], label: 'Silver', only: 'blackBased' },
    { id: 'CH', name: 'Champagne (Ch)', alleles: ['Ch', 'n'], absent: ['n', 'n'], label: 'Champagne' },
    { id: 'RN', name: 'Roan (Rn)', alleles: ['Rn', 'rn'], absent: ['rn', 'rn'], label: 'Roan' },
    { id: 'TO', name: 'Tobiano (TO)', alleles: ['TO', 'to'], absent: ['to', 'to'], label: 'Tobiano' },
    { id: 'SB1', name: 'Sabino 1 (SB1)', alleles: ['SB1', 'n'], absent: ['n', 'n'], label: 'Sabino' }
  ];
  var ALL_LOCI = COLOUR_LOCI.concat(EXTRA_LOCI);
  function extraGenotypeOptions(locus) {
    var a = locus.alleles;
    return [a[0] + '/' + a[0], a[0] + '/' + a[1], a[1] + '/' + a[1]];
  }
  // Hand-entered genotypes for one horse, validated against the gene table.
  function manualGenes(state, lifeNumber) {
    var saved = (state.horseMeta && state.horseMeta[lifeNumber] && state.horseMeta[lifeNumber].genes) || {};
    var out = {};
    EXTRA_LOCI.forEach(function (l) {
      var parts = String(saved[l.id] || '').split('/');
      if (parts.length === 2 && l.alleles.indexOf(parts[0]) > -1 && l.alleles.indexOf(parts[1]) > -1) out[l.id] = parts;
    });
    return out;
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
    if (id === 'A') return al.indexOf('A') > -1 ? 'agouti (bay if black-based)' : 'no agouti (black if black-based)';
    if (id === 'CR') { c = copies(al, 'CR'); return c === 0 ? 'no cream' : (c === 1 ? 'one cream copy' : 'double cream'); }
    if (id === 'D') return al.indexOf('D') > -1 ? 'dun' : (al.indexOf('nd1') > -1 ? 'non-dun, primitive markings' : 'non-dun');
    if (id === 'G') return al.indexOf('G') > -1 ? 'grey' : 'not grey';
    if (id === 'LP') { c = copies(al, 'LP'); return c === 0 ? 'no leopard complex' : (c === 1 ? 'one LP copy' : 'two LP copies'); }
    if (id === 'PATN1') { c = copies(al, 'PATN1'); return c === 0 ? 'no PATN1' : (c === 1 ? 'one PATN1 copy' : 'two PATN1 copies'); }
    var extra = EXTRA_LOCI.find(function (l) { return l.id === id; });
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
    EXTRA_LOCI.forEach(function (l) {
      var al = g[l.id];
      if (!al || l.only) return;
      var expressed = l.recessive ? copies(al, l.alleles[1]) === 2 : al.indexOf(l.alleles[0]) > -1;
      if (expressed) parts.push(l.label);
    });
    var name = 'Base colour unknown' + (parts.length ? ' + ' + parts.join(' + ') : '');
    if (g.G && g.G.indexOf('G') > -1) name = 'Grey (born ' + name + ')';
    return name;
  }
  function baseColourLabel(g) {
    if (!g.E) return modifiersOnlyLabel(g);
    var names = {
      chestnut: ['Chestnut', 'Palomino', 'Cremello'],
      bay: ['Bay', 'Buckskin', 'Perlino'],
      black: ['Black', 'Smoky Black', 'Smoky Cream'],
      blackBased: ['Bay or Black', 'Buckskin or Smoky Black', 'Perlino or Smoky Cream']
    };
    var base = g.E.indexOf('E') === -1 ? 'chestnut' : (!g.A ? 'blackBased' : (g.A.indexOf('A') > -1 ? 'bay' : 'black'));
    var name = names[base][g.CR ? copies(g.CR, 'CR') : 0];
    if (g.D && g.D.indexOf('D') > -1) name += ' Dun';
    var blackBased = g.E.indexOf('E') > -1;
    EXTRA_LOCI.forEach(function (l) {
      var al = g[l.id];
      if (!al) return;
      var expressed = l.recessive ? copies(al, l.alleles[1]) === 2 : al.indexOf(l.alleles[0]) > -1;
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
    var dist = {}, untested = [];
    ALL_LOCI.forEach(function (l) {
      if (s[l.id] && d[l.id]) dist[l.id] = foalDistribution(l, s[l.id], d[l.id]);
      else if (!l.absent) untested.push(l.name);
    });
    var genes = ALL_LOCI.filter(function (l) { return dist[l.id] && (!l.absent || touched[l.id]); }).map(function (l) {
      return { id: l.id, name: l.name, outcomes: dist[l.id].map(function (o) {
        return { genotype: o.alleles.join(' / '), pct: o.p * 100, effect: geneEffect(l.id, o.alleles) };
      }) };
    });
    // Chance the foal actually shows each extra gene (a dominant one needs a
    // single copy; a recessive one — Flaxen — needs two), listed on its own so
    // it's visible even when the combined colour list can't be built.
    var extras = EXTRA_LOCI.filter(function (l) { return dist[l.id] && touched[l.id]; }).map(function (l) {
      var shown = 0;
      dist[l.id].forEach(function (o) {
        var expressed = l.recessive ? copies(o.alleles, l.alleles[1]) === 2 : o.alleles.indexOf(l.alleles[0]) > -1;
        if (expressed) shown += o.p;
      });
      return {
        id: l.id, name: l.name, label: l.label, pct: shown * 100,
        note: l.only === 'chestnut' ? 'shows on chestnut coats only' : (l.only === 'blackBased' ? 'shows on black-based coats only' : ''),
        outcomes: dist[l.id].map(function (o) { return { genotype: o.alleles.join(' / '), pct: o.p * 100 }; })
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
  function goalsOf(state) {
    var g = (state && state.settings && state.settings.goals) || {};
    function num(v) { var x = parseFloat(v); return isFinite(x) && x >= 0 ? x : null; }
    var fert = String(g.minFert || '').toLowerCase();
    var traitWorst = ['GP', 'G', 'A', 'BA'].indexOf(g.traitWorst) > -1 ? g.traitWorst : null;
    var healthWorst = ['good', 'average', 'fair', 'poor'].indexOf(g.healthWorst) > -1 ? g.healthWorst : null;
    return {
      minFert: FERT_RANK[fert] != null ? fert : null,
      minConf: num(g.minConf), minBT: num(g.minBT),
      traitWorst: traitWorst, traitWorstMax: num(g.traitWorstMax),
      healthWorst: healthWorst, healthWorstMax: num(g.healthWorstMax)
    };
  }
  function traitCounts(info) {
    var t = info && info.confTraits;
    if (!t) return null;
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
    var g = goalsOf(state);
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
    return { conf: minSection('Conformation', g.minConf, conf), bt: minSection('Breed Total', g.minBT, bt), traits: traits, health: health, fertility: fertility };
  }
  function goalCheck(state, life) {
    var s = goalSections(state, life);
    var list = [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.text !== 'no goal' && !x.skip; });
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
    return [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'bad' && !x.skip; }).map(function (x) { return x.label; });
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
  function breedingSuggestions(state, mareLife, limit) {
    mareLife = String(mareLife || '');
    var mInfo = state.horseInfo && state.horseInfo[mareLife];
    var out = { mareName: (mInfo && mInfo.name) || ('#' + mareLife), status: mareBreedStatus(state, mareLife), error: '', suggestions: [], considered: 0, noData: 0, tooRelated: 0 };
    if (!mInfo || mInfo.sex !== 'mare') { out.error = 'not-a-mare'; return out; }
    if (isYoungInfo(mInfo)) { out.error = 'young'; return out; }
    var mMeta = (state.horseMeta && state.horseMeta[mareLife]) || {};
    var mConf = bestConformation(mMeta).best;
    var mAnc = ancestorMap(state, mareLife, 3);
    var list = [];
    Object.keys(state.horseInfo || {}).forEach(function (life) {
      var sInfo = state.horseInfo[life];
      if (!sInfo || sInfo.sex !== 'stallion' || isYoungInfo(sInfo)) return;
      var sMeta = (state.horseMeta && state.horseMeta[life]) || {};
      if (isSoldLife(state, life) || sMeta.status === 'Retired' || sMeta.status === 'Deceased') return;
      if (sInfo.geneticPotential == null || mInfo.geneticPotential == null) { out.noData++; return; }
      out.considered++;
      var sConf = bestConformation(sMeta).best;
      var gp = (Number(mInfo.geneticPotential) + Number(sInfo.geneticPotential)) / 2;
      var confs = [mConf, sConf].filter(function (x) { return x > 0; });
      var conf = confs.length ? confs.reduce(function (a, b) { return a + b; }, 0) / confs.length : null;
      var estBT = conf ? breedTotal(gp, conf) : null;
      var common = commonAncestors(mAnc, ancestorMap(state, life, 3));
      var coi = estimateCoi(common);
      if (coi > 12.5) { out.tooRelated++; return; }
      var shared = [], fixes = [];
      if (mInfo.confTraits && sInfo.confTraits) {
        Object.keys(mInfo.confTraits).forEach(function (t) {
          var a = traitRankOf(mInfo.confTraits[t]), b = traitRankOf(sInfo.confTraits[t]);
          if (a == null || b == null) return;
          if (a === 0 && b === 0) shared.push(t);
          else if (a === 0 && b >= 2) fixes.push(t);
        });
      }
      var fert = String(sInfo.fertility || '').toLowerCase().trim();
      var fertBonus = FERT_BONUS[fert] != null ? FERT_BONUS[fert] : 0;
      var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(life); });
      var yours = !!(rec && rec.owned !== false);
      var terms = yours ? null : studTermsOf(state, life);
      // what she and he have produced together already
      var hist = { foals: 0, failed: 0, bestScore: 0 };
      if (rec) {
        (state.breedings[rec.id] || []).forEach(function (b) {
          if (String(b.mareLifeNumber) !== mareLife) return;
          if (b.status === 'Foal Born') { hist.foals++; if (b.foalScore > 0 && b.foalScore <= 100 && b.foalScore > hist.bestScore) hist.bestScore = b.foalScore; }
          else if (b.status === 'Failed') hist.failed++;
        });
      }
      var reasons = [];
      reasons.push(estBT != null
        ? 'Estimated foal Breed Total ' + (Math.round(estBT * 10) / 10) + ' (average genetic potential ' + (Math.round(gp * 10) / 10) + ', average top conformation ' + (Math.round(conf * 10) / 10) + ')'
        : 'Average genetic potential ' + (Math.round(gp * 10) / 10) + ' (neither has a show score saved yet, so Breed Total is not estimated)');
      reasons.push(common.length ? 'Estimated inbreeding ' + (Math.round(coi * 100) / 100) + '% (' + common.length + ' shared ancestor' + (common.length === 1 ? '' : 's') + ')' : 'No shared ancestors in the saved pedigrees (0% inbreeding)');
      if (fixes.length) reasons.push('Covers her Below-average ' + fixes.join(', ') + ' (his rating there is Good or better)');
      if (shared.length) reasons.push('Watch: she and he are both Below average in ' + shared.join(', '));
      if (FERT_BONUS[fert] != null) reasons.push('His fertility is ' + sInfo.fertility + (FERT_BONUS[fert] > 0 ? ' (fewer failed coverings)' : FERT_BONUS[fert] < 0 ? ' (more failed coverings)' : ''));
      else reasons.push('His fertility is not recorded' + (isYoungInfo(sInfo) ? '' : ' (open his page after a fertility test)'));
      if (yours) reasons.push('Your own stallion: no stud fee');
      else if (terms) reasons.push('Cost: ' + terms.summary);
      else reasons.push('Stud fee not known yet (open his page or his Breed page to record it)');
      if (hist.foals || hist.failed) reasons.push('Bred together before: ' + (hist.foals ? hist.foals + ' foal' + (hist.foals === 1 ? '' : 's') + (hist.bestScore ? ' (best score ' + hist.bestScore + ')' : '') : '') + (hist.foals && hist.failed ? ', ' : '') + (hist.failed ? hist.failed + ' failed covering' + (hist.failed === 1 ? '' : 's') : ''));
      var score = (estBT != null ? estBT : gp / 10) + 0.3 * fixes.length - 0.6 * shared.length - 0.2 * coi + fertBonus;
      list.push({ life: life, name: sInfo.name || ('#' + life), yours: yours, gp: Math.round(gp * 10) / 10, estBT: estBT != null ? Math.round(estBT * 10) / 10 : null, coi: Math.round(coi * 100) / 100, terms: terms, reasons: reasons, score: score });
    });
    list.sort(function (a, b) { return b.score - a.score; });
    out.suggestions = list.slice(0, limit || 10);
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
  function removeHorse(state, life, ignoreName) {
    life = String(life || '');
    if (!life) return 0;
    var n = 0;
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
  // The price to ask for one horse: { suggested, low, high, basis, comps, floor, belowCost }
  function priceIdea(state, life, pace, soldComps) {
    var bt = horseBT(state, life);
    var pr = profitOf(state, life);
    var p = purchaseOf(state, life);
    var cost = p && (!p.price || p.currency === 'HRC') && (!p.shipping || p.shippingCurrency === 'HRC') ? p.price + p.shipping : 0;
    var mult = SELL_PACE[pace] || 1;
    var out = { suggested: null, low: null, high: null, basis: '', comps: [], floor: cost || null, belowCost: false };
    if (bt > 0 && soldComps.length) {
      var near = soldComps.filter(function (c) { return String(c.life) !== String(life); })
        .sort(function (a, b) { return Math.abs(a.bt - bt) - Math.abs(b.bt - bt); }).slice(0, 3);
      if (near.length) {
        var est = median(near.map(function (c) { return c.price / c.bt; })) * bt * mult;
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
    var goals = goalsOf(state);
    var goalsOn = Object.keys(goals).some(function (k) { return goals[k] != null; });
    // past sales that give a price per Breed Total point
    var comps = [];
    Object.keys(state.horseMeta || {}).forEach(function (l) {
      if (!isSoldLife(state, l)) return;
      var sa = saleOf(state, l), bt = horseBT(state, l);
      if (sa && sa.currency === 'HRC' && bt > 0) comps.push({ life: l, name: ((state.horseInfo || {})[l] || {}).name || ('#' + l), bt: bt, price: sa.price });
    });
    var herd = ownedHorses(state).filter(function (h) {
      return !isSoldLife(state, h.lifeNumber) && !isArchivedHorse(h) && h.meta.status !== 'Companion' &&
        (h.info.sex === 'mare' || h.info.sex === 'stallion');
    }).map(function (h) {
      var young = isYoungInfo(h.info);
      var meta = (state.horseMeta && state.horseMeta[h.lifeNumber]) || {};
      return { h: h, life: h.lifeNumber, name: h.info.name || ('#' + h.lifeNumber), sex: h.info.sex, young: young, bt: horseBT(state, h.lifeNumber),
        conf: bestConformation(meta).best, gp: h.info.geneticPotential, forSale: h.meta.status === 'For Sale' };
    });
    var adultBTs = herd.filter(function (x) { return !x.young && x.bt > 0; }).map(function (x) { return x.bt; });
    var med = median(adultBTs);
    var sortedBTs = adultBTs.slice().sort(function (a, b) { return a - b; });
    var lowCut = sortedBTs.length >= 4 ? sortedBTs[Math.floor(sortedBTs.length / 4)] : 0;

    var ideas = [], forSale = [], held = [];
    herd.forEach(function (x) {
      var price = priceIdea(state, x.life, form.pace, comps);
      if (x.forSale) { forSale.push(Object.assign({ price: price }, x)); return; }
      var kind = x.young ? (x.sex === 'stallion' ? 'Colt' : 'Filly') : (x.sex === 'stallion' ? 'Stallion' : 'Mare');
      if ((x.young && !form.young) || (!x.young && x.sex === 'mare' && !form.mares) || (!x.young && x.sex === 'stallion' && !form.stallions)) return;
      var reasons = [], score = 0;
      var misses = goalsOn ? goalMisses(state, x.life) : [];
      var met = goalsOn && goalCheck(state, x.life).met;
      if (met) return;
      if (misses.length) { score += misses.length * 3; reasons.push('Misses your goal' + (misses.length === 1 ? '' : 's') + ': ' + misses.join(', ')); }
      if (!x.young && x.bt > 0 && med > 0 && x.bt < med * 0.92) { score += 2; reasons.push('Breed Total ' + (Math.round(x.bt * 10) / 10) + ' is below your herd median of ' + (Math.round(med * 10) / 10)); }
      if (!x.young && x.bt > 0 && lowCut && x.bt <= lowCut) { score += 1; reasons.push('In the bottom quarter of your herd by Breed Total'); }
      if (x.sex === 'mare') {
        var rows = 0;
        Object.keys(state.breedings || {}).forEach(function (sid) {
          (state.breedings[sid] || []).forEach(function (b) { if (String(b.mareLifeNumber) === String(x.life)) rows++; });
        });
        if (!x.young && !rows) { score += 1; reasons.push('Never bred'); }
        var st = mareBreedStatus(state, x.life);
        if (st.status) { held.push({ life: x.life, name: x.name, why: st.status === 'pregnant' ? 'in foal' : 'just covered' }); return; }
      } else if (!x.young) {
        var rec = (state.stallions || []).find(function (s) { return s.lifeNumber && String(s.lifeNumber) === String(x.life); });
        var recs = rec ? (state.breedings[rec.id] || []) : [];
        var done = recs.filter(function (b) { return b.status === 'Succeeded' || b.status === 'Failed' || b.status === 'Foal Born'; });
        var failed = done.filter(function (b) { return b.status === 'Failed'; }).length;
        if (done.length >= 5 && failed / done.length >= 0.4) { score += 2; reasons.push('Fails ' + Math.round(failed / done.length * 100) + '% of his resolved breedings'); }
        if (!recs.length) { score += 1; reasons.push('No breedings recorded'); }
      }
      var qualifies = (form.mode === 'misses' && goalsOn) ? misses.length > 0 : (score >= 2 || (!x.young && lowCut && x.bt > 0 && x.bt <= lowCut));
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
      var bad = [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'bad'; });
      var unknown = [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'na' && x.text === 'no data yet'; });
      if (bad.length === 1 && !unknown.length) nearMiss.push({ name: h.info.name || ('#' + h.lifeNumber), life: h.lifeNumber, missing: bad[0].label, detail: bad[0].text, why: bad[0].label + ' ' + bad[0].text });
    });
    if (nearMiss.length) tips.push({ level: 'tip', text: nearMiss.length + ' horse' + (nearMiss.length === 1 ? ' misses' : 's miss') + ' your goals by only one box: ' + nearMiss.slice(0, 5).map(function (n) { return n.name + ' (' + n.why + ')'; }).join('; ') + '.' });

    // pairing ideas: your free adult mares x your active stallions. Ranked mostly by the
    // foal's estimated Breed Total (from the parents' average genetic potential and
    // average top conformation score), nudged up where one parent's strength covers the
    // other's Below-average conformation trait, and down for shared weak traits and inbreeding.
    var TRAIT_RANK = { 'below average': 0, 'average': 1, 'good': 2, 'good+': 3, 'good +': 3, 'very good': 4 };
    function traitRank(v) { var r = TRAIT_RANK[String(v || '').toLowerCase().trim()]; return r == null ? null : r; }
    var pairs = [];
    var studs = stallions.filter(function (s) { return s.status === 'Active' && s.lifeNumber && state.horseInfo[s.lifeNumber] && state.horseInfo[s.lifeNumber].geneticPotential != null; });
    mares.filter(function (m) { return !m.young && !m.pregnant && state.horseInfo[m.life].geneticPotential != null; }).forEach(function (m) {
      var mInfo = state.horseInfo[m.life], mConf = bestConformation((state.horseMeta && state.horseMeta[m.life]) || {}).best;
      studs.forEach(function (s) {
        var sInfo = state.horseInfo[s.lifeNumber], sConf = bestConformation((state.horseMeta && state.horseMeta[s.lifeNumber]) || {}).best;
        var gp = (Number(mInfo.geneticPotential) + Number(sInfo.geneticPotential)) / 2;
        var confs = [mConf, sConf].filter(function (x) { return x > 0; });
        var conf = confs.length ? confs.reduce(function (a, b) { return a + b; }, 0) / confs.length : null;
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
        var score = (estBT != null ? estBT : gp / 10) + 0.3 * fixes.length - 0.6 * shared.length - 0.2 * coi;
        pairs.push({
          mare: m.name, stallion: s.name, gp: Math.round(gp * 10) / 10,
          conf: conf != null ? Math.round(conf * 10) / 10 : null,
          estBT: estBT != null ? Math.round(estBT * 10) / 10 : null,
          coi: Math.round(coi * 100) / 100, shared: shared, fixes: fixes,
          noScore: !(mConf > 0 && sConf > 0), score: score
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
    extraGenotypeOptions: extraGenotypeOptions,
    manualGenes: manualGenes,
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
