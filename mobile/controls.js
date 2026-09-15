// Mobile (userscript) floating toggle button — @require last, after
// lib.js/mobile/storage.js/content.js/dashboard.js so HRLib/HRStorage exist
// and the overlay + dashboard are already mounted. Replaces the desktop
// toolbar icon (open dashboard) and its badge (pending reviews) with an
// on-page button, since there's no toolbar on mobile.
(function () {
  'use strict';

  var REVIEW_DAYS = 6; // same threshold background.js uses for the toolbar badge

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.style.cssText = [
    'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147482999',
    'display:flex', 'align-items:center', 'gap:7px',
    'background:#46592C', 'color:#fff', 'border:none', 'border-radius:999px',
    'padding:11px 16px', 'font:14px "IBM Plex Sans",system-ui,sans-serif', 'font-weight:600',
    'cursor:pointer', 'box-shadow:0 4px 14px rgba(0,0,0,.3)'
  ].join(';');

  var label = document.createElement('span');
  label.textContent = 'Ledger';
  var badge = document.createElement('span');
  badge.style.cssText = [
    'display:none', 'background:#D97706', 'color:#fff', 'border-radius:999px',
    'min-width:18px', 'height:18px', 'padding:0 5px', 'font-size:11.5px', 'font-weight:700',
    'align-items:center', 'justify-content:center', 'line-height:18px'
  ].join(';');

  btn.appendChild(label);
  btn.appendChild(badge);
  btn.addEventListener('click', function () { window.HRMobileOverlay.toggle(); });
  (document.body || document.documentElement).appendChild(btn);

  function refreshBadge() {
    HRStorage.getState(function (state) {
      var count = HRLib.findReviewCandidates(state, REVIEW_DAYS).length;
      if (count) {
        badge.textContent = String(count);
        badge.style.display = 'inline-flex';
        btn.title = count + ' covering' + (count === 1 ? '' : 's') + ' ready to review';
      } else {
        badge.style.display = 'none';
        btn.title = 'Open HR Stallion & Mare Ledger';
      }
    });
  }

  refreshBadge();
  // The scaffold's chrome shim turns chrome.storage.onChanged into a real
  // pub-sub that mobile/storage.js publishes to on every write — reuse it so
  // the badge updates the instant content.js scrapes something new, with no
  // separate polling loop.
  window.chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === 'local' && changes.hrLedger) refreshBadge();
  });
})();
