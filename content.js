(function () {
  'use strict';

  // --- Horse Reality's own JSON API, fetched directly — same technique
  // HRToolkit (a well-established community extension) uses instead of
  // scraping the rendered page: read the CSRF token HR already exposes to
  // its own page JS via a cookie, and call the same endpoints its SPA
  // calls. This sidesteps the shadow-DOM markup entirely.
  function getAuthData() {
    try {
      var cookies = document.cookie.split(';');
      for (var i = 0; i < cookies.length; i++) {
        var eq = cookies[i].indexOf('=');
        if (eq === -1) continue;
        var name = cookies[i].slice(0, eq).trim();
        if (name !== 'hr_auth_production_access_payload') continue;
        var jwt = cookies[i].slice(eq + 1);
        var payloadB64 = jwt.split('.')[1];
        var b64 = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
        var json = decodeURIComponent(atob(b64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        return JSON.parse(json);
      }
    } catch (e) {}
    return {};
  }
  function parseHorseIdFromUrl() {
    var m = location.pathname.match(/\/horses\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }
  function fetchHorseJson(path) {
    var auth = getAuthData();
    return fetch('https://v2.horsereality.com' + path, {
      method: 'GET',
      credentials: 'include',
      headers: { 'x-csrf-token': auth.hr_csrf || '', accept: 'application/json', 'content-type': 'application/json' }
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function cleanText(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }
  function lifeNumberFromUrl(url) {
    if (!url) return '';
    var m = url.match(/\/horses\/(\d+)\//);
    return m ? m[1] : '';
  }
  function parseHorseLabel(a) {
    if (!a) return '';
    var text = a.textContent || '';
    text = text.replace(/ↆ/g, '');
    text = text.split('|')[0];
    return text.replace(/\s+/g, ' ').trim();
  }
  function parseScore(strongEl) {
    var text = cleanText(strongEl);
    if (!text) return { score: null, raw: '' };
    var parts = text.split('|');
    var last = parseFloat(parts[parts.length - 1]);
    return { score: isNaN(last) ? null : last, raw: text };
  }
  function parseBankDate(text) {
    var m = text.match(/(\d{2})-(\d{2})-(\d{4})/);
    if (!m) return '';
    return m[3] + '-' + m[2] + '-' + m[1];
  }
  function currencyFromCell(cell) {
    var img = cell ? cell.querySelector('img') : null;
    var src = img ? (img.getAttribute('src') || '') : '';
    if (/delta/i.test(src)) return 'DP';
    if (/foundation/i.test(src)) return 'FT';
    if (/wildlife/i.test(src)) return 'WT';
    return 'HRC';
  }

  // --- Source 1: a stallion's Offspring table (.stable_block .row_960) ---
  function scrapeOffspringRows() {
    var rows = document.querySelectorAll('.stable_block .row_960');
    var out = [];
    rows.forEach(function (row) {
      var col200 = row.querySelectorAll(':scope > .col_200');
      var col150 = row.querySelectorAll(':scope > .col_150');
      var col100 = row.querySelectorAll(':scope > .col_100');

      var foalA = col200[0] ? col200[0].querySelector('a') : null;
      var damA = col200[1] ? col200[1].querySelector('a') : null;
      var breederA = col150[1] ? col150[1].querySelector('a') : null;
      var statusText = col100[1] ? cleanText(col100[1]) : '';
      var scoreInfo = col200[0] ? parseScore(col200[0].querySelector('strong')) : { score: null, raw: '' };
      var foalImg = col100[0] ? col100[0].querySelector('.himage_tiny img') : null;

      if (!damA) return;

      out.push({
        mareName: cleanText(damA),
        mareUrl: damA.href || '',
        mareLifeNumber: lifeNumberFromUrl(damA.href),
        breederName: cleanText(breederA),
        breederUrl: breederA ? breederA.href : '',
        foalName: parseHorseLabel(foalA),
        foalUrl: foalA ? foalA.href : '',
        foalImageUrl: foalImg ? (foalImg.getAttribute('src') || '') : '',
        foalScore: scoreInfo.score,
        status: statusText || 'Foal Born'
      });
    });
    return out;
  }

  // --- Source 2: the account Bank/transactions table (tr.bank-table) ---
  function scrapeBankRows() {
    var rows = document.querySelectorAll('tr.bank-table');
    var out = [];
    rows.forEach(function (row) {
      var cells = row.querySelectorAll('td');
      if (cells.length < 4) return;
      if (cleanText(cells[0]) !== 'IN') return;
      var descCell = cells[2];
      var descText = descCell.textContent || '';
      if (descText.indexOf('used your stud service to breed') === -1) return;
      var links = descCell.querySelectorAll('a');
      if (links.length < 3) return;
      var breederA = links[0], mareA = links[1], stallionA = links[2];
      var price = parseInt(cleanText(cells[1]).replace(/\D/g, ''), 10);

      out.push({
        stallionName: cleanText(stallionA),
        stallionUrl: stallionA.href,
        stallionLifeNumber: lifeNumberFromUrl(stallionA.href),
        mareName: cleanText(mareA),
        mareUrl: mareA.href,
        mareLifeNumber: lifeNumberFromUrl(mareA.href),
        breederName: cleanText(breederA),
        breederUrl: breederA.href,
        price: isNaN(price) ? null : price,
        currency: currencyFromCell(cells[1]),
        date: parseBankDate(cleanText(cells[3]))
      });
    });
    return out;
  }

  // --- Source 3: Horse Reality's own horse-detail JSON API ---
  // Names look like "!ↆMonte Cristo|f?" in both the API and the rendered
  // page — the display name is always the first "|"-separated segment once
  // the leading icon-font markers are stripped.
  function parseHorseNameHeader(text) {
    text = String(text || '').replace(/^!/, '');
    text = text.replace(/ↆ/g, '');
    text = text.split('|')[0];
    return text.replace(/\s+/g, ' ').trim();
  }
  // Runs an optional-enrichment step in isolation: if the API response ever
  // drifts from what this was built against, that must degrade to a
  // missing field, never blow up the whole fetch.
  function safeExtract(fn, fallback) {
    try { return fn(); } catch (e) {
      console.warn('HR Ledger: passport field skipped —', e);
      return fallback;
    }
  }
  var DISCIPLINE_LABELS = {
    reining: 'Western Reining', dressage: 'Dressage', driving: 'Driving',
    endurance: 'Endurance', eventing: 'Eventing', racing: 'Flat Racing',
    showjumping: 'Show Jumping', jumping: 'Show Jumping'
  };
  function disciplineLabel(id) {
    if (DISCIPLINE_LABELS[id]) return DISCIPLINE_LABELS[id];
    return String(id || '').replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function buildTrainingText(disciplines) {
    if (!Array.isArray(disciplines) || !disciplines.length) return '';
    return disciplines.map(function (d) {
      var level = (Number(d.currentLevel) || 0) + 1;
      var pct = Math.round((Number(d.currentLevelProgress) || 0) * 100);
      return disciplineLabel(d.id) + ' - Level ' + level + '/10 - ' + pct + '%';
    }).join(', ');
  }
  function buildPredicatesText(predicates) {
    if (!Array.isArray(predicates) || !predicates.length) return '';
    return predicates.map(function (p) {
      return typeof p === 'string' ? p : (p && p.name) || JSON.stringify(p);
    }).join(', ');
  }
  // Local time, not UTC — Horse Reality's own UI renders dates in the
  // viewer's local timezone (a "22:00:00Z" timestamp can already read as
  // the next calendar day for players ahead of UTC), and this always runs
  // in the same browser/timezone as the person viewing the dashboard.
  function formatBirthdate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }
  // Location isn't its own API field — it's encoded in the profile
  // background image's filename (".../profilebg_north-america.jpg").
  function parseLocationFromImages(imageFull) {
    if (!Array.isArray(imageFull)) return '';
    for (var i = 0; i < imageFull.length; i++) {
      var m = /profilebg_([a-z0-9-]+)\.\w+/i.exec((imageFull[i] && imageFull[i].url) || '');
      if (m) {
        return m[1].split('-').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
      }
    }
    return '';
  }
  function horseProfileUrl(lifeNumber) {
    return 'https://www.horsereality.com/horses/' + lifeNumber + '/';
  }
  function userProfileUrl(id) {
    return id ? 'https://v2.horsereality.com/user/' + id + '/' : '';
  }
  // The passport's pedigree only carries each ancestor's life number — the
  // actual name/score/breeder comes from the sibling `related.horses` list.
  function resolveAncestor(ref, relatedHorses) {
    if (!ref || !ref.lifeNumber) return null;
    var full = (relatedHorses || []).find(function (h) { return h.lifeNumber === ref.lifeNumber; });
    return {
      name: full ? parseHorseNameHeader(full.name) : '',
      url: horseProfileUrl(ref.lifeNumber),
      lifeNumber: ref.lifeNumber,
      scoreRaw: full ? (full.tagline || '') : '',
      estate: full && full.breeder ? (full.breeder.estateName || '') : ''
    };
  }
  function foalSexLabel(sex) {
    if (sex === 'stallion') return 'Colt';
    if (sex === 'mare') return 'Filly';
    return '';
  }
  function buildPregnancyInfo(horse, passportRoot, relatedHorses) {
    if (horse.pregnancyStatus !== 'pregnant') {
      return horse.pregnancyStatus ? { status: horse.pregnancyStatus, dueText: '', sireName: '', sireUrl: '', sireLifeNumber: '' } : null;
    }
    var preg = passportRoot.pregnancy || {};
    var sireInfo = resolveAncestor(preg.sire ? { lifeNumber: preg.sire } : null, relatedHorses);
    var foalLabel = foalSexLabel(preg.sex);
    return {
      status: 'Pregnant' + (foalLabel ? ' (Unborn ' + foalLabel + ')' : ''),
      dueText: preg.deliveryDate ? ('Due ' + formatBirthdate(preg.deliveryDate)) : '',
      sireName: sireInfo ? sireInfo.name : '',
      sireUrl: sireInfo ? sireInfo.url : '',
      sireLifeNumber: preg.sire || ''
    };
  }
  function buildHorseInfoFromApi(lifeNumber, horseResp, passportResp) {
    var horse = horseResp && horseResp.horse ? horseResp.horse : null;
    if (!horse) return null;
    var passportRoot = passportResp && passportResp.horsePassport ? passportResp.horsePassport : {};
    var passport = passportRoot.passport || {};
    var ancestry = passportRoot.ancestry || {};
    var relatedHorses = (passportResp && passportResp.related && passportResp.related.horses) || [];
    var pedigree = ancestry.pedigree || {};
    var genetics = horse.geneticSummary || {};
    var coiValue = (typeof ancestry.coi === 'number') ? ancestry.coi : null;
    var geneticPotential = parseInt(genetics.potential, 10);
    // The horse endpoint's own `related.estates.location` is the direct
    // source; the background-image filename is only a fallback for horses
    // where that isn't present.
    var location = (horseResp.related && horseResp.related.estates && horseResp.related.estates.location) || parseLocationFromImages(horse.imageFull);

    return {
      name: parseHorseNameHeader(horse.name),
      lifeNumber: lifeNumber,
      sex: horse.sex || '',
      breed: horse.breed ? horse.breed.name : '',
      imageUrl: (horse.imagePassport && horse.imagePassport[0] && horse.imagePassport[0].url) || '',
      height: passport.height != null ? (passport.height + ' cm') : '',
      location: location,
      dateOfBirth: formatBirthdate(passport.birthdate),
      ownerName: horse.owner ? horse.owner.name : '',
      ownerUrl: horse.owner ? userProfileUrl(horse.owner.id) : '',
      ownerStable: horse.estate ? horse.estate.name : '',
      horseBreederName: horse.breeder ? horse.breeder.name : '',
      horseBreederUrl: horse.breeder ? userProfileUrl(horse.breeder.id) : '',
      horseBreederStable: horse.breeder ? horse.breeder.estateName : '',
      geneticPotential: isNaN(geneticPotential) ? null : geneticPotential,
      conformation: genetics.conformation || '',
      testedColours: genetics.colour || '',
      training: buildTrainingText(horse.disciplines),
      predicates: buildPredicatesText(passport.predicates),
      coi: coiValue,
      coiRaw: coiValue != null ? coiValue.toFixed(2) + '%' : '',
      sire: resolveAncestor(pedigree.sire, relatedHorses),
      dam: resolveAncestor(pedigree.dam, relatedHorses),
      pregnancy: buildPregnancyInfo(horse, passportRoot, relatedHorses)
    };
  }
  // Recorded into state so a *screenshot of the dashboard* is enough to
  // diagnose a failure on someone else's machine — asking a non-technical
  // player to open DevTools and read the console isn't realistic.
  function fetchAndMergeHorseInfo() {
    var id = parseHorseIdFromUrl();
    if (!id) return;
    var auth = getAuthData();
    var hasToken = !!auth.hr_csrf;
    var errors = [];
    Promise.all([
      fetchHorseJson('/api/player/horse/' + id).catch(function (e) { errors.push('horse: ' + (e && e.message || e)); return null; }),
      fetchHorseJson('/api/player/horse/' + id + '/passport').catch(function (e) { errors.push('passport: ' + (e && e.message || e)); return null; })
    ]).then(function (results) {
      var horseInfo = safeExtract(function () { return buildHorseInfoFromApi(id, results[0], results[1]); }, null);
      if (horseInfo) mergeHorseInfo(horseInfo);

      HRStorage.getState(function (state) {
        state.apiDiagnostics = {
          lastCheckedAt: Date.now(),
          lastHorseId: id,
          csrfTokenFound: hasToken,
          ok: hasToken && !errors.length && !!horseInfo,
          errors: errors
        };
        HRStorage.setState(state);
      });
    });
  }

  // --- Source 4: the Notifications log (tr.notifications-table) ---
  // "The covering between [mare] and [stud] has failed, your mare is not
  // pregnant." — this is the only reliable source of failure data, since
  // neither the bank nor the offspring table ever mentions an attempt that
  // didn't result in a foal.
  // Scoped to `tr` generally rather than `tr.notifications-table`
  // specifically — Horse Reality's markup has shifted before (the passport
  // pages moved to a shadow-DOM component entirely), and the notification
  // text itself is distinctive enough that a broader net costs nothing.
  function scrapeFailedCoverings() {
    var out = [];
    document.querySelectorAll('tr').forEach(function (row) {
      var text = row.textContent || '';
      if (text.indexOf('has failed, your mare is not pregnant') === -1) return;
      var links = row.querySelectorAll('a');
      if (links.length < 2) return;
      out.push({
        mareName: parseHorseLabel(links[0]),
        mareUrl: links[0].href,
        mareLifeNumber: lifeNumberFromUrl(links[0].href),
        stallionName: parseHorseLabel(links[1]),
        stallionUrl: links[1].href,
        stallionLifeNumber: lifeNumberFromUrl(links[1].href)
      });
    });
    return out;
  }

  function showToast(msg) {
    var el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'bottom:16px', 'right:16px', 'background:#46592C', 'color:#fff',
      'padding:10px 16px', 'border-radius:8px', 'font:14px system-ui,sans-serif',
      'z-index:2147483647', 'box-shadow:0 4px 14px rgba(0,0,0,.25)'
    ].join(';');
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // Horse Reality's image CDN appears to reject cross-origin loads, so the
  // dashboard can never hotlink horse-img.horsereality.com directly. Instead,
  // fetch the bytes here (on the real page, not blocked) via the background
  // worker and store a self-contained data URL. This is used only by the
  // separate, non-blocking image-attaching passes below — it must never gate
  // the core data merge, or a slow/failed fetch would silently stop
  // everything else from saving too.
  function fetchImageAsDataUrl(url) {
    if (!url) return Promise.resolve('');
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage({ type: 'HR_FETCH_IMAGE', url: url }, function (response) {
        void chrome.runtime.lastError; // acknowledge to avoid an unchecked-error warning
        resolve((response && response.dataUrl) || '');
      });
    });
  }

  function mergeIntoLedger() {
    var offspring = scrapeOffspringRows();
    var bank = scrapeBankRows();
    var failedCoverings = scrapeFailedCoverings();
    if (!offspring.length && !bank.length && !failedCoverings.length) return;

    HRStorage.getState(function (state) {
      var added = 0, updated = 0, newStuds = 0, failuresMarked = 0;
      var offspringStallionId = null;

      // Bank transactions are the one page that PROVES the stud is yours
      // (the fee landed in your own account) — safe to auto-create from.
      bank.forEach(function (row) {
        var stallionId = HRLib.findStallionMatch(state.stallions, row);
        if (!stallionId) {
          var res = HRStorage.upsertStallionByMatch(state, { name: row.stallionName, lifeNumber: row.stallionLifeNumber });
          stallionId = res.id;
          if (res.created) newStuds++;
        }
        var result = HRStorage.upsertBreeding(state, stallionId, {
          mareName: row.mareName, mareLifeNumber: row.mareLifeNumber, mareUrl: row.mareUrl,
          breederName: row.breederName, breederUrl: row.breederUrl,
          price: row.price, currency: row.currency, feeType: 'Public',
          date: row.date, status: 'Pending'
        });
        if (result === 'added') added++; else updated++;
      });

      // Viewing a horse's Offspring tab does NOT prove you own it — you
      // could just be browsing someone else's stud. The URL itself carries
      // this horse's life number, so match against that; only UPDATE an
      // already-tracked stallion, never create one from this page alone.
      if (offspring.length) {
        var urlId = parseHorseIdFromUrl();
        var matchId = urlId ? HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: urlId }) : null;
        if (matchId) {
          offspringStallionId = matchId;
          offspring.forEach(function (row) {
            var result = HRStorage.upsertBreeding(state, matchId, {
              mareName: row.mareName, mareLifeNumber: row.mareLifeNumber, mareUrl: row.mareUrl,
              breederName: row.breederName, breederUrl: row.breederUrl,
              price: null, currency: 'HRC', feeType: 'Public',
              date: '', status: row.status,
              foalName: row.foalName, foalUrl: row.foalUrl, foalScore: row.foalScore
            });
            if (result === 'added') added++; else updated++;
          });
        }
      }

      // Only fires when the failed covering used one of YOUR tracked studs —
      // this notification appears on the MARE owner's own feed regardless of
      // whose stud was used, so it's the one reliable signal for tracking a
      // covering that didn't involve one of your own studs. Unlike the rest
      // of this function, it's allowed to create both a lightweight
      // external stud stub (marked `owned: false`, kept out of your own
      // Stallions grid) and the breeding record itself — otherwise a mare
      // bred outside your own studs, or a free self-breeding that never
      // generated a bank transaction, would never get recorded at all.
      failedCoverings.forEach(function (f) {
        if (!f.stallionLifeNumber) return;
        var sid = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: f.stallionLifeNumber });
        if (!sid) {
          var res = HRStorage.upsertStallionByMatch(state, { name: f.stallionName, lifeNumber: f.stallionLifeNumber, owned: false });
          sid = res.id;
        }
        var list = state.breedings[sid] || [];
        var match = list.find(function (b) {
          return f.mareLifeNumber && b.mareLifeNumber === f.mareLifeNumber && b.status !== 'Failed' && b.status !== 'Foal Born';
        });
        if (match) {
          match.status = 'Failed';
        } else {
          HRStorage.upsertBreeding(state, sid, {
            mareName: f.mareName || '', mareLifeNumber: f.mareLifeNumber, mareUrl: f.mareUrl,
            breederName: state.settings.myUsername || '', breederUrl: '',
            price: null, currency: 'HRC', feeType: 'Public',
            date: '', status: 'Failed'
          });
        }
        failuresMarked++;
      });

      if (added || updated || newStuds || failuresMarked) {
        HRStorage.setState(state, function () {
          var parts = [];
          if (added) parts.push(added + ' new');
          if (updated) parts.push(updated + ' updated');
          if (newStuds) parts.push(newStuds + ' new stud' + (newStuds === 1 ? '' : 's'));
          if (failuresMarked) parts.push(failuresMarked + ' marked failed');
          if (parts.length) showToast('HR Ledger: ' + parts.join(', '));
        });
      }

      // Images are fetched and attached afterward, independently — a slow or
      // failed image fetch must never block the data above from saving.
      attachOffspringImages(offspringStallionId, offspring);
    });
  }

  // The horse-info API fetch runs on its own schedule (triggered by URL,
  // not DOM readiness), so it merges into storage independently of the
  // synchronous bank/offspring/notifications flow above.
  function mergeHorseInfo(horseInfo) {
    HRStorage.getState(function (state) {
      var infoRefreshed = false, passportCached = false, newStud = false;
      var infoStallionId = null;

      // Caching a horse's passport snapshot is NOT an ownership claim — it's
      // just reference data (genetics, pedigree, pregnancy...), so this runs
      // for every horse page you view, yours or not. Skip the write when
      // nothing actually changed, so re-visiting the same horse repeatedly
      // doesn't spam storage writes.
      var existing = state.horseInfo[horseInfo.lifeNumber];
      var existingComparable = existing ? Object.assign({}, existing) : null;
      if (existingComparable) delete existingComparable.capturedAt;
      if (!existingComparable || JSON.stringify(existingComparable) !== JSON.stringify(horseInfo)) {
        HRStorage.upsertHorseInfo(state, horseInfo.lifeNumber, horseInfo);
        passportCached = true;
      }

      var matchId = HRLib.findStallionMatch(state.stallions, { stallionName: horseInfo.name, stallionLifeNumber: horseInfo.lifeNumber });

      // The horse's own API data names its owner directly — if that matches
      // the username configured in Settings, viewing the page IS proof of
      // ownership (stronger than waiting for a bank transaction to land).
      // Only stallions get auto-tracked here; mares surface via "My Mares"
      // once a breeding record exists for them.
      var myName = (state.settings.myUsername || '').trim().toLowerCase();
      if (!matchId && horseInfo.sex === 'stallion' && myName && horseInfo.ownerName && horseInfo.ownerName.trim().toLowerCase() === myName) {
        var created = HRStorage.upsertStallionByMatch(state, {
          name: horseInfo.name, lifeNumber: horseInfo.lifeNumber,
          breed: horseInfo.breed, imageUrl: horseInfo.imageUrl
        });
        matchId = created.id;
        newStud = created.created;
      }

      if (matchId) {
        infoStallionId = matchId;
        var s = state.stallions.find(function (x) { return x.id === matchId; });
        if (horseInfo.name && s.name !== horseInfo.name) { s.name = horseInfo.name; infoRefreshed = true; }
        if (horseInfo.breed && s.breed !== horseInfo.breed) { s.breed = horseInfo.breed; infoRefreshed = true; }
      }

      // A mare's own pregnancy status is a direct, reliable signal for a
      // SUCCESSFUL covering — same reasoning as the failure-notification
      // handling in mergeIntoLedger: track it even when the sire isn't one
      // of your own studs, via a lightweight external stud stub if needed,
      // so a mare bred outside your own studs still shows her history.
      var pregnancyMarked = false;
      if (horseInfo.sex === 'mare' && horseInfo.pregnancy && horseInfo.pregnancy.sireLifeNumber && (horseInfo.pregnancy.status || '').indexOf('Pregnant') === 0) {
        var sireId = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: horseInfo.pregnancy.sireLifeNumber });
        if (!sireId) {
          var sireRes = HRStorage.upsertStallionByMatch(state, { name: horseInfo.pregnancy.sireName, lifeNumber: horseInfo.pregnancy.sireLifeNumber, owned: false });
          sireId = sireRes.id;
        }
        var sireList = state.breedings[sireId] || [];
        var pregMatch = sireList.find(function (b) {
          return b.mareLifeNumber === horseInfo.lifeNumber && b.status !== 'Failed' && b.status !== 'Foal Born';
        });
        if (pregMatch) {
          if (pregMatch.status !== 'Succeeded') { pregMatch.status = 'Succeeded'; pregnancyMarked = true; }
        } else {
          HRStorage.upsertBreeding(state, sireId, {
            mareName: horseInfo.name, mareLifeNumber: horseInfo.lifeNumber, mareUrl: horseProfileUrl(horseInfo.lifeNumber),
            breederName: state.settings.myUsername || '', breederUrl: '',
            price: null, currency: 'HRC', feeType: 'Public',
            date: '', status: 'Succeeded'
          });
          pregnancyMarked = true;
        }
      }

      if (infoRefreshed || passportCached || newStud || pregnancyMarked) {
        HRStorage.setState(state, function () {
          if (newStud) {
            showToast('HR Ledger: added ' + horseInfo.name + ' as a new stud');
            // Offspring rows on this same page may have been scraped before
            // the stud existed to attach to — retry now that it does.
            mergeIntoLedger();
          } else if (pregnancyMarked) {
            showToast('HR Ledger: ' + horseInfo.name + ' marked in foal');
          } else if (infoRefreshed) {
            // A bare passport-cache refresh (no ledger change) stays silent —
            // showing a toast on every single horse page you browse would be noise.
            showToast('HR Ledger: info refreshed');
          }
        });
      }

      attachHorseImage(infoStallionId, horseInfo);
    });
  }

  // Best-effort, fire-and-forget. Re-reads a FRESH copy of state once the
  // fetches resolve (rather than reusing the closure above) so this can
  // never race a write that happened while the fetches were in flight.
  function attachOffspringImages(stallionId, offspring) {
    if (!stallionId) return;
    var jobs = [];
    offspring.forEach(function (row) {
      if (!row.foalImageUrl) return;
      jobs.push(fetchImageAsDataUrl(row.foalImageUrl).then(function (dataUrl) {
        return { row: row, dataUrl: dataUrl };
      }));
    });
    if (!jobs.length) return;

    Promise.all(jobs).then(function (results) {
      if (!results.some(function (r) { return r.dataUrl; })) return;
      HRStorage.getState(function (state) {
        var list = state.breedings[stallionId] || [];
        results.forEach(function (r) {
          if (!r.dataUrl) return;
          var key = HRLib.breedingMatchKey(r.row);
          var rec = list.find(function (b) { return HRLib.breedingMatchKey(b) === key; });
          if (rec) rec.foalImageUrl = r.dataUrl;
        });
        HRStorage.setState(state);
      });
    });
  }

  function attachHorseImage(stallionId, horseInfo) {
    if (!stallionId || !horseInfo || !horseInfo.imageUrl) return;
    fetchImageAsDataUrl(horseInfo.imageUrl).then(function (dataUrl) {
      if (!dataUrl) return;
      HRStorage.getState(function (state) {
        var s = state.stallions.find(function (x) { return x.id === stallionId; });
        if (s) { s.imageUrl = dataUrl; HRStorage.setState(state); }
      });
    });
  }

  // Horse Reality's pages are a client-rendered (Svelte) app: the
  // bank/offspring/notifications markup can take longer than a fixed
  // timeout to hydrate behind all the analytics/ad scripts also loading,
  // and navigating to another horse via the prev/next arrows changes the
  // URL via the History API without a full page reload — so content
  // scripts never re-inject for it. A short, give-up-after-N-tries poll
  // (the old approach) fails on both counts. Instead: watch indefinitely
  // for the trigger elements via MutationObserver (reacts the instant they
  // appear, no matter how slow hydration is), run the merge once, then
  // disconnect — and separately watch the URL itself so an in-app
  // navigation re-arms everything for the next page.
  function tryMergeOnce() {
    var ready = document.querySelector('.stable_block .row_960') || document.querySelector('tr.bank-table') || document.querySelector('tr.notifications-table');
    if (!ready) return false;
    mergeIntoLedger();
    return true;
  }

  function watchForContent() {
    if (tryMergeOnce()) return;

    var observer = new MutationObserver(function () {
      if (tryMergeOnce()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    // Safety net so a page that will never show any of our trigger
    // elements doesn't leave an observer running forever.
    setTimeout(function () { observer.disconnect(); }, 60000);
  }

  // A stud owner never gets the "covering has failed" notification for a
  // CUSTOMER's mare — that notification only ever reaches the mare's own
  // owner. Horse Reality resolves a covering within about 6 days, so a
  // "Pending" record that old with no matching "Foal Born" record for the
  // same mare almost certainly failed. Runs on every page load — it's pure
  // computation over already-stored data, no scraping needed.
  var STALE_PENDING_DAYS = 6;
  function sweepStaleFailedCoverings(state) {
    var candidates = HRLib.findReviewCandidates(state, STALE_PENDING_DAYS);
    candidates.forEach(function (c) { c.breeding.status = 'Failed'; });
    return candidates.length;
  }
  function sweepAndPersistStaleFailures() {
    HRStorage.getState(function (state) {
      var marked = sweepStaleFailedCoverings(state);
      if (marked) {
        HRStorage.setState(state, function () {
          showToast('HR Ledger: ' + marked + ' marked failed (no foal after ' + STALE_PENDING_DAYS + ' days)');
        });
      }
    });
  }

  function onPageReady() {
    watchForContent();
    fetchAndMergeHorseInfo();
    sweepAndPersistStaleFailures();
  }

  onPageReady();

  var lastHref = location.href;
  setInterval(function () {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onPageReady();
    }
  }, 1000);
})();
