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
    { id: 'CR', name: 'Cream (CR)', alleles: ['CR', 'n'] },
    { id: 'D', name: 'Dun (D)', alleles: ['D', 'nd1', 'nd2'] },
    { id: 'G', name: 'Grey (G)', alleles: ['G', 'g'] },
    { id: 'LP', name: 'Leopard complex (LP)', alleles: ['LP', 'lp'] },
    { id: 'PATN1', name: 'Pattern-1 (PATN1)', alleles: ['PATN1', 'patn1'] },
    { id: 'SW1', name: 'Splashed white (SW1)', alleles: ['SW1', 'n'] },
    { id: 'W20', name: 'White spotting (W20)', alleles: ['W20', 'n'] }
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
  function parseColourGenes(text) {
    var out = {};
    String(text || '').split(/\s+/).filter(Boolean).forEach(function (tok) {
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
    EXTRA_LOCI.forEach(function (l) {
      absent[l.id] = l.absent.slice();
      touched[l.id] = !!(sM[l.id] || dM[l.id] || sP[l.id] || dP[l.id]);
    });
    var s = Object.assign({}, absent, sM, sP);
    var d = Object.assign({}, absent, dM, dP);
    var dist = {}, untested = [];
    ALL_LOCI.forEach(function (l) {
      if (s[l.id] && d[l.id]) dist[l.id] = foalDistribution(l, s[l.id], d[l.id]);
      else if (!l.label) untested.push(l.name);
    });
    var genes = ALL_LOCI.filter(function (l) { return dist[l.id] && (!l.label || touched[l.id]); }).map(function (l) {
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
    var patternIds = ['LP', 'PATN1'].filter(function (id) { return dist[id]; });
    return {
      genes: genes,
      extras: extras,
      untested: untested,
      colours: dist.E ? enumerateOutcomes(dist, colourIds, baseColourLabel) : (noBaseIds.length ? enumerateOutcomes(dist, noBaseIds, baseColourLabel) : null),
      baseKnown: !!dist.E,
      patterns: dist.LP ? enumerateOutcomes(dist, patternIds, patternLabel) : null
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
    return { conf: minSection('Conformation', g.minConf, conf), bt: minSection('Breed Total', g.minBT, bt), traits: traits, health: health, fertility: fertility };
  }
  function goalCheck(state, life) {
    var s = goalSections(state, life);
    var list = [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.text !== 'no goal'; });
    return {
      active: list.length > 0,
      met: list.length > 0 && list.every(function (x) { return x.state === 'ok'; }),
      sections: s
    };
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

    var stallions = (state.stallions || []).filter(function (s) { return s.owned !== false; }).map(function (s) {
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
        if (r.foalScore > 0) out.scores.push(Number(r.foalScore));
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
      if (meta.status === 'Sold' || meta.status === 'Retired' || meta.status === 'Deceased') return;
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
    ownedHorses(state).forEach(function (h) {
      if (h.meta.status === 'Sold' || h.meta.status === 'Retired') return;
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
    ownedHorses(state).forEach(function (h) {
      var c = goalCheck(state, h.lifeNumber);
      if (!c.active) return;
      if (c.met) { goalHits.push(h); return; }
      var s = c.sections;
      var bad = [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'bad'; });
      var unknown = [s.conf, s.bt, s.traits, s.health, s.fertility].filter(function (x) { return x.state === 'na' && x.text === 'no data yet'; });
      if (bad.length === 1 && !unknown.length) nearMiss.push({ name: h.info.name || ('#' + h.lifeNumber), life: h.lifeNumber, why: bad[0].label + ' ' + bad[0].text });
    });
    if (nearMiss.length) tips.push({ level: 'tip', text: nearMiss.length + ' horse' + (nearMiss.length === 1 ? ' misses' : 's miss') + ' your goals by only one box: ' + nearMiss.slice(0, 5).map(function (n) { return n.name + ' (' + n.why + ')'; }).join('; ') + '.' });

    // pairing ideas: your adult mares x your active stallions, best average genetic potential with low inbreeding
    var pairs = [];
    var studs = stallions.filter(function (s) { return s.status === 'Active' && s.lifeNumber && state.horseInfo[s.lifeNumber] && state.horseInfo[s.lifeNumber].geneticPotential != null; });
    mares.filter(function (m) { return !m.young && !m.pregnant && state.horseInfo[m.life].geneticPotential != null; }).forEach(function (m) {
      studs.forEach(function (s) {
        var gp = (Number(state.horseInfo[m.life].geneticPotential) + Number(state.horseInfo[s.lifeNumber].geneticPotential)) / 2;
        var common = commonAncestors(ancestorMap(state, m.life, 3), ancestorMap(state, s.lifeNumber, 3));
        pairs.push({ mare: m.name, stallion: s.name, gp: Math.round(gp * 10) / 10, coi: Math.round(estimateCoi(common) * 100) / 100 });
      });
    });
    pairs = pairs.filter(function (p) { return p.coi < 6.25; }).sort(function (a, b) { return b.gp - a.gp || a.coi - b.coi; }).slice(0, 5);

    // standouts
    var best = ownedHorses(state).map(function (h) {
      var meta = state.horseMeta[h.lifeNumber] || {};
      var bt = Math.max(Number(meta.btBest) || 0, breedTotal(h.info.geneticPotential, bestConformation(meta).best));
      return { name: h.info.name || ('#' + h.lifeNumber), life: h.lifeNumber, bt: bt, conf: bestConformation(meta).best, gp: h.info.geneticPotential };
    });
    var topBT = best.filter(function (x) { return x.bt > 0; }).sort(function (a, b) { return b.bt - a.bt; }).slice(0, 5);
    var topConf = best.filter(function (x) { return x.conf > 0; }).sort(function (a, b) { return b.conf - a.conf; }).slice(0, 5);

    return { overall: overall, stallions: stallions, months: monthList, mares: mares, tips: tips, pairs: pairs, topBT: topBT, topConf: topConf, goalHits: goalHits.length, nearMiss: nearMiss.length, gaps: gaps.length };
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
    breedTotal: breedTotal,
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
