(function () {
  'use strict';

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

  // --- Source 3: a horse's own Info/passport tab (#horse-name, #extra-info) ---
  // The header text looks like "!ↆMonte Cristo|f?" or "HMS Showtime|TSK|STY?ff" —
  // the display name is always the first "|"-separated segment once the leading
  // icon-font markers are stripped.
  function parseHorseNameHeader(text) {
    text = String(text || '').replace(/^!/, '');
    text = text.replace(/ↆ/g, '');
    text = text.split('|')[0];
    return text.replace(/\s+/g, ' ').trim();
  }
  // hr-table-cell delivers its text via a `text` attribute (not child text
  // content), formatted like markdown: "**value**" or "**[Label](url)**".
  function stripMd(text) {
    return String(text || '').replace(/\*\*/g, '').trim();
  }
  function parseMdLink(text) {
    var m = String(text || '').match(/\[([^\]]*)\]\(([^)]*)\)/);
    return m ? { label: m[1], url: m[2] } : null;
  }
  function extractInfoTable() {
    var result = {};
    document.querySelectorAll('hr-table-row[slot="body"]').forEach(function (row) {
      var cells = row.querySelectorAll('hr-table-cell');
      if (cells.length < 2) return;
      var label = stripMd(cells[0].getAttribute('text'));
      var value = stripMd(cells[1].getAttribute('text'));
      result[label] = value;
    });
    return result;
  }
  // The horse's own large portrait always loads from the /large/ path on
  // horse-img.horsereality.com (thumbnails elsewhere use /small/), so that
  // path segment alone is a reliable selector — no class or id needed.
  function findHorsePortrait() {
    var img = document.querySelector('img[src*="horse-img.horsereality.com/large/"]');
    return img ? (img.getAttribute('src') || '') : '';
  }
  function scrapeHorseInfo() {
    var nameEl = document.getElementById('horse-name');
    if (!nameEl) return null;
    var name = parseHorseNameHeader(nameEl.textContent);
    var lifeNumber = lifeNumberFromUrl(window.location.href);
    if (!name && !lifeNumber) return null;

    var info = extractInfoTable();
    var breed = '';
    if (info['Breed registry']) {
      var link = parseMdLink(info['Breed registry']);
      breed = link ? link.label : info['Breed registry'];
    }
    var imageUrl = findHorsePortrait();

    return { name: name, lifeNumber: lifeNumber, breed: breed, imageUrl: imageUrl };
  }

  // --- Source 4: the Notifications log (tr.notifications-table) ---
  // "The covering between [mare] and [stud] has failed, your mare is not
  // pregnant." — this is the only reliable source of failure data, since
  // neither the bank nor the offspring table ever mentions an attempt that
  // didn't result in a foal.
  function scrapeFailedCoverings() {
    var rows = document.querySelectorAll('tr.notifications-table');
    var out = [];
    rows.forEach(function (row) {
      var cell = row.querySelector('td');
      if (!cell) return;
      var text = cell.textContent || '';
      if (text.indexOf('has failed, your mare is not pregnant') === -1) return;
      var links = cell.querySelectorAll('a');
      if (links.length < 2) return;
      out.push({
        mareUrl: links[0].href,
        mareLifeNumber: lifeNumberFromUrl(links[0].href),
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
  // separate, non-blocking attachImages() pass below — it must never gate
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
    var horseInfo = scrapeHorseInfo();
    var failedCoverings = scrapeFailedCoverings();
    if (!offspring.length && !bank.length && !horseInfo && !failedCoverings.length) return;

    HRStorage.getState(function (state) {
      var added = 0, updated = 0, newStuds = 0, infoRefreshed = false, failuresMarked = 0;
      var infoStallionId = null;

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

      // Viewing a horse's Info/Offspring tab does NOT prove you own it — you
      // could just be browsing someone else's stud. Only UPDATE an existing
      // match here; never create a new stallion from these pages alone.
      if (horseInfo) {
        var matchId = HRLib.findStallionMatch(state.stallions, { stallionName: horseInfo.name, stallionLifeNumber: horseInfo.lifeNumber });
        if (matchId) {
          infoStallionId = matchId;
          var s = state.stallions.find(function (x) { return x.id === matchId; });
          if (horseInfo.name && s.name !== horseInfo.name) { s.name = horseInfo.name; infoRefreshed = true; }
          if (horseInfo.lifeNumber && s.lifeNumber !== horseInfo.lifeNumber) { s.lifeNumber = horseInfo.lifeNumber; infoRefreshed = true; }
          if (horseInfo.breed && s.breed !== horseInfo.breed) { s.breed = horseInfo.breed; infoRefreshed = true; }

          if (offspring.length) {
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
      }

      // Only fires when the failed covering used one of YOUR tracked studs —
      // this notification appears to go to the mare's owner, not the stud's,
      // so it may rarely (or never) match your own stallions. When it does,
      // it's the only source we have for a confirmed "Failed" status.
      failedCoverings.forEach(function (f) {
        if (!f.stallionLifeNumber) return;
        var sid = HRLib.findStallionMatch(state.stallions, { stallionLifeNumber: f.stallionLifeNumber });
        if (!sid) return;
        var list = state.breedings[sid] || [];
        var match = list.find(function (b) {
          return f.mareLifeNumber && b.mareLifeNumber === f.mareLifeNumber && b.status !== 'Failed' && b.status !== 'Foal Born';
        });
        if (match) { match.status = 'Failed'; failuresMarked++; }
      });

      if (added || updated || newStuds || infoRefreshed || failuresMarked) {
        HRStorage.setState(state, function () {
          var parts = [];
          if (added) parts.push(added + ' new');
          if (updated) parts.push(updated + ' updated');
          if (newStuds) parts.push(newStuds + ' new stud' + (newStuds === 1 ? '' : 's'));
          if (infoRefreshed) parts.push('info refreshed');
          if (failuresMarked) parts.push(failuresMarked + ' marked failed');
          showToast('HR Ledger: ' + parts.join(', '));
        });
      }

      // Images are fetched and attached afterward, independently — a slow or
      // failed image fetch must never block the data above from saving.
      attachImages(infoStallionId, horseInfo, offspring);
    });
  }

  // Best-effort, fire-and-forget. Re-reads a FRESH copy of state once the
  // fetches resolve (rather than reusing the closure above) so this can
  // never race a write that happened while the fetches were in flight.
  function attachImages(stallionId, horseInfo, offspring) {
    if (!stallionId) return;
    var jobs = [];
    if (horseInfo && horseInfo.imageUrl) {
      jobs.push(fetchImageAsDataUrl(horseInfo.imageUrl).then(function (dataUrl) {
        return { type: 'stallion', dataUrl: dataUrl };
      }));
    }
    offspring.forEach(function (row) {
      if (!row.foalImageUrl) return;
      jobs.push(fetchImageAsDataUrl(row.foalImageUrl).then(function (dataUrl) {
        return { type: 'foal', row: row, dataUrl: dataUrl };
      }));
    });
    if (!jobs.length) return;

    Promise.all(jobs).then(function (results) {
      if (!results.some(function (r) { return r.dataUrl; })) return;
      HRStorage.getState(function (state) {
        var s = state.stallions.find(function (x) { return x.id === stallionId; });
        if (!s) return;
        results.forEach(function (r) {
          if (!r.dataUrl) return;
          if (r.type === 'stallion') {
            s.imageUrl = r.dataUrl;
          } else {
            var list = state.breedings[stallionId] || [];
            var key = HRLib.breedingMatchKey(r.row);
            var rec = list.find(function (b) { return HRLib.breedingMatchKey(b) === key; });
            if (rec) rec.foalImageUrl = r.dataUrl;
          }
        });
        HRStorage.setState(state);
      });
    });
  }

  var tries = 0;
  var timer = setInterval(function () {
    tries++;
    var ready = document.querySelector('.stable_block .row_960') || document.querySelector('tr.bank-table') || document.getElementById('horse-name') || document.querySelector('tr.notifications-table');
    if (ready) {
      mergeIntoLedger();
      clearInterval(timer);
    } else if (tries > 20) {
      clearInterval(timer);
    }
  }, 500);
})();
