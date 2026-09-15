// Mobile (userscript) scaffold — must @require before lib.js/content.js/dashboard.js.
// Sets up everything those unmodified desktop files expect to find:
//   - a `chrome` shim (content.js's one chrome.runtime.sendMessage call, used
//     only for portrait-image fetching, is a no-op here — see README's
//     Mobile section for why image caching is dropped on mobile)
//   - the dashboard's own CSS, copied verbatim from dashboard.html and then
//     scoped programmatically (via CSSOM, not hand-rewritten) to the overlay
//     container so it can never bleed into horsereality.com's own styles
//   - a hidden overlay container with `id="app"` inside it, since
//     dashboard.js does `document.getElementById('app')` at load time
(function () {
  'use strict';

  var OVERLAY_ID = 'hr-ledger-overlay';

  // --- chrome shim --------------------------------------------------------
  window.chrome = window.chrome || {};
  window.chrome.runtime = window.chrome.runtime || {};
  window.chrome.runtime.sendMessage = window.chrome.runtime.sendMessage || function (msg, cb) {
    if (typeof cb === 'function') cb({ dataUrl: '' });
  };
  // dashboard.js registers a real listener here (to live-refresh when
  // content.js writes new data while the overlay is open) — unlike the
  // sendMessage shim above, this one is a real minimal pub-sub, not a no-op.
  // mobile/storage.js's setState() publishes to it after every GM.setValue.
  window.chrome.storage = window.chrome.storage || {};
  window.chrome.storage.onChanged = window.chrome.storage.onChanged || {
    _listeners: [],
    addListener: function (fn) { this._listeners.push(fn); }
  };

  // --- dashboard CSS, verbatim from dashboard.html's <style> block --------
  var DASHBOARD_CSS = [
    ':root{',
    '  --bg:#EEEADB; --surface:#FFFFFF; --surface-2:#F6F1E3; --text:#262A1E; --text-muted:#6E7260;',
    '  --border:#DBD5BE; --border-strong:#C7C0A4; --accent:#5F7A3D; --accent-strong:#46592C;',
    '  --accent-soft:#E3E8D5; --accent-2:#A9822F; --danger:#9C4A3B; --danger-bg:#F1DED7;',
    '  --success:#4C7A52; --success-bg:#E1EEDD; --warn:#A9822F; --warn-bg:#F1E6C9;',
    '  --shadow: 0 1px 2px rgba(38,42,30,0.06), 0 4px 14px rgba(38,42,30,0.05);',
    '}',
    '@media (prefers-color-scheme: dark){',
    '  :root{',
    '    --bg:#1B1D15; --surface:#23261C; --surface-2:#2A2D20; --text:#EAE7D6; --text-muted:#9DA48A;',
    '    --border:#3A3D2C; --border-strong:#4A4E37; --accent:#9CBA6C; --accent-strong:#B7CC8C;',
    '    --accent-soft:#2E3B24; --accent-2:#D8B563; --danger:#DB8975; --danger-bg:#3A241E;',
    '    --success:#8FC494; --success-bg:#22321F; --warn:#D9B45C; --warn-bg:#362C18;',
    '    --shadow: 0 1px 2px rgba(0,0,0,0.3), 0 4px 14px rgba(0,0,0,0.25);',
    '  }',
    '}',
    '*{ box-sizing:border-box; }',
    'html,body{ margin:0; }',
    'body{',
    '  background:var(--bg); color:var(--text); font-family:"IBM Plex Sans", system-ui, sans-serif;',
    '  padding:0 16px;',
    '}',
    'h1,h2,h3{ font-family:"Fraunces", Georgia, serif; text-wrap:balance; }',
    '.mono{ font-family:"IBM Plex Mono", ui-monospace, monospace; font-variant-numeric:tabular-nums; }',
    'a{ color:inherit; }',
    'button{ font-family:inherit; }',
    ':focus-visible{ outline:2px solid var(--accent); outline-offset:2px; border-radius:4px; }',
    '.wrap{ max-width:960px; margin:0 auto; padding-block:28px 64px; }',
    'header.top{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:22px; }',
    'header.top .titles h1{ font-size:32px; font-weight:600; margin:0; line-height:1.1; }',
    'header.top .titles p{ margin:4px 0 0; color:var(--text-muted); font-size:14px; }',
    '.tabs{ display:flex; gap:4px; background:var(--surface-2); border:1px solid var(--border); border-radius:10px; padding:4px; width:fit-content; margin-bottom:20px; }',
    '.tab-btn{ border:none; background:transparent; padding:7px 16px; border-radius:7px; font-size:13.5px; font-weight:500; color:var(--text-muted); cursor:pointer; }',
    '.tab-btn.active{ background:var(--surface); color:var(--text); box-shadow:var(--shadow); }',
    '.link-btn{ background:none; border:none; padding:0; font:inherit; color:var(--accent-strong); text-decoration:underline; text-underline-offset:2px; cursor:pointer; }',
    '.link-btn:hover{ color:var(--accent); }',
    '.search-row{ display:flex; gap:8px; margin-bottom:10px; }',
    '.search-row input{ flex:1; min-width:0; background:var(--surface-2); border:1px solid var(--border); border-radius:9px; padding:9px 12px; font-size:14px; color:var(--text); font-family:inherit; }',
    '.search-row input:focus{ outline:2px solid var(--accent); outline-offset:0; border-color:var(--accent); }',
    '.search-results{ background:var(--surface); border:1px solid var(--border); border-radius:12px; box-shadow:var(--shadow); padding:6px; margin-bottom:16px; display:flex; flex-direction:column; gap:2px; }',
    '.search-result{ display:flex; align-items:center; gap:10px; background:none; border:none; border-radius:8px; padding:8px 10px; text-align:left; cursor:pointer; font:inherit; color:var(--text); }',
    '.search-result:hover{ background:var(--surface-2); }',
    '.search-result img, .search-result-noimg{ width:36px; height:27px; object-fit:cover; border-radius:5px; background:var(--surface-2); flex-shrink:0; }',
    '.search-result .sub{ color:var(--text-muted); font-size:12px; }',
    '.search-empty{ padding:12px 10px; color:var(--text-muted); font-size:13.5px; }',
    '.settings-row{ display:flex; flex-wrap:wrap; gap:16px 28px; align-items:center; margin-bottom:16px; }',
    '.settings-toggle{ display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--text-muted); cursor:pointer; }',
    '.settings-toggle input{ cursor:pointer; }',
    '.username-setting{ display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--text-muted); }',
    '.username-setting input{',
    '  background:var(--surface-2); border:1px solid var(--border); border-radius:7px;',
    '  padding:5px 9px; font-size:12.5px; color:var(--text); font-family:inherit; width:160px;',
    '}',
    '.username-setting input:focus{ outline:2px solid var(--accent); outline-offset:0; border-color:var(--accent); }',
    '.stats-bar{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:22px; }',
    '.stat-tile{ background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:14px 16px; box-shadow:var(--shadow); }',
    '.stat-tile .num{ font-size:22px; font-weight:600; }',
    '.stat-tile .num.multi{ font-size:14.5px; line-height:1.5; font-weight:600; }',
    '.stat-tile .label{ font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.05em; margin-top:2px; }',
    '.section-head{ display:flex; align-items:center; justify-content:space-between; gap:12px; margin:26px 0 12px; }',
    '.section-head h2{ font-size:20px; font-weight:600; margin:0; }',
    '.btn{ display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border-strong); background:var(--surface); color:var(--text); padding:9px 14px; border-radius:9px; font-size:14px; font-weight:500; cursor:pointer; min-height:38px; }',
    '.btn:hover{ border-color:var(--accent); }',
    '.btn-primary{ background:var(--accent); border-color:var(--accent); color:#fff; }',
    '.btn-primary:hover{ background:var(--accent-strong); border-color:var(--accent-strong); }',
    '.btn-ghost{ background:transparent; border-color:transparent; padding:8px 10px; }',
    '.btn-ghost:hover{ border-color:var(--border-strong); }',
    '.btn-danger{ color:var(--danger); }',
    '.btn-danger:hover{ border-color:var(--danger); }',
    '.btn-sm{ padding:6px 10px; font-size:13px; min-height:32px; }',
    '.card{ background:var(--surface); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow); }',
    '.stallion-grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:14px; }',
    '.stallion-card{ padding:16px; cursor:pointer; position:relative; transition:border-color .15s; overflow:hidden; }',
    '.stallion-card:hover{ border-color:var(--accent); }',
    '.stallion-card .portrait{ width:100%; aspect-ratio:4/3; object-fit:contain; border-radius:9px; margin-bottom:10px; background:var(--surface-2); }',
    '.stallion-card h3{ font-size:19px; font-weight:600; margin:0 0 2px; padding-right:26px; }',
    '.stallion-card .lifenum{ color:var(--text-muted); font-size:12px; margin-bottom:4px; }',
    '.stallion-card .meta{ color:var(--text-muted); font-size:13px; margin-bottom:12px; }',
    '.stallion-card .row{ display:flex; justify-content:space-between; font-size:13px; padding:3px 0; }',
    '.stallion-card .row .v{ font-weight:600; }',
    '.stallion-card .fee{ color:var(--accent-2); }',
    '.corner-badge{ position:absolute; top:14px; right:14px; }',
    '.empty{ border:1.5px dashed var(--border-strong); border-radius:14px; padding:32px 20px; text-align:center; color:var(--text-muted); }',
    '.empty h3{ color:var(--text); font-size:19px; margin:0 0 6px; }',
    '.empty p{ margin:0 0 16px; font-size:14px; }',
    'form.panel{ padding:16px; margin-bottom:16px; display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); }',
    'form.panel .full{ grid-column:1/-1; }',
    '.import-panel textarea{ min-height:120px; font-family:"IBM Plex Mono", ui-monospace, monospace; font-size:12.5px; }',
    '.import-error{ color:var(--danger); font-size:13px; grid-column:1/-1; }',
    '.import-hint{ color:var(--text-muted); font-size:13px; grid-column:1/-1; margin:0; }',
    '.field{ display:flex; flex-direction:column; gap:5px; }',
    '.field label{ font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:.04em; }',
    '.field input, .field select, .field textarea{ background:var(--surface-2); border:1px solid var(--border); border-radius:8px; padding:9px 10px; font-size:14px; color:var(--text); font-family:inherit; }',
    '.field textarea{ resize:vertical; min-height:44px; }',
    '.field input:focus, .field select:focus, .field textarea:focus{ outline:2px solid var(--accent); outline-offset:0; border-color:var(--accent); }',
    '.panel-actions{ grid-column:1/-1; display:flex; gap:10px; justify-content:flex-end; }',
    '.fee-row{ display:flex; gap:8px; flex-wrap:wrap; }',
    '.fee-mini{ display:flex; flex-direction:column; gap:3px; width:76px; }',
    '.fee-mini input{ width:100%; }',
    '.fee-mini label{ font-size:11px; text-align:center; color:var(--text-muted); text-transform:uppercase; letter-spacing:.03em; }',
    '.back-link{ display:inline-flex; align-items:center; gap:6px; color:var(--text-muted); font-size:14px; cursor:pointer; background:none; border:none; padding:4px 0; }',
    '.back-link:hover{ color:var(--accent); }',
    '.detail-nav{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:16px; }',
    '.detail-nav-btns{ display:flex; gap:8px; }',
    '.detail-head{ display:flex; justify-content:space-between; gap:16px; flex-wrap:wrap; align-items:flex-start; margin-bottom:6px; }',
    '.detail-head h1{ font-size:30px; margin:0; }',
    '.detail-head .portrait{ width:96px; height:96px; object-fit:contain; border-radius:12px; background:var(--surface-2); flex-shrink:0; }',
    '.detail-head .name-row{ display:flex; gap:16px; align-items:flex-start; }',
    '.detail-head .tags{ display:flex; gap:8px; flex-wrap:wrap; margin-top:8px; }',
    '.tag{ background:var(--surface-2); border:1px solid var(--border); border-radius:999px; padding:3px 11px; font-size:12.5px; color:var(--text-muted); }',
    '.detail-actions{ display:flex; gap:8px; flex-shrink:0; }',
    '.notes-line{ color:var(--text-muted); font-size:14px; margin-top:10px; max-width:60ch; }',
    '.ledger{ margin-top:6px; }',
    '.ledger-head{ display:grid; grid-template-columns:92px 1.3fr 1fr 100px 118px 32px; gap:12px; padding:0 14px 8px; font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--text-muted); }',
    '.ledger-row{ display:grid; grid-template-columns:92px 1.3fr 1fr 100px 118px 32px; gap:12px; align-items:center; padding:11px 14px; border-top:1px solid var(--border); }',
    '.ledger-row:first-child{ border-top:none; }',
    '.ledger .card{ padding:6px 0; }',
    '.ledger-row .mare{ font-weight:600; }',
    '.ledger-row .sub{ font-size:11.5px; font-weight:400; color:var(--text-muted); margin-top:1px; }',
    '.foal-chip{ display:inline-flex; align-items:center; gap:6px; background:var(--surface-2); border:1px solid var(--border); border-radius:6px; padding:2px 8px 2px 2px; font-size:12px; margin-right:8px; color:var(--text-muted); }',
    '.foal-chip a{ color:var(--accent-strong); }',
    '.foal-thumb{ width:22px; height:22px; object-fit:cover; border-radius:4px; background:var(--border); }',
    '.ledger-row .price{ color:var(--accent-2); font-weight:600; }',
    '.ledger-row .notes-cell{ grid-column:1/-1; color:var(--text-muted); font-size:13px; padding-top:2px; }',
    '.ledger-row a{ color:var(--accent-strong); text-decoration:underline; text-underline-offset:2px; }',
    '.ledger-row a:hover{ color:var(--accent); }',
    '.ext{ font-size:10px; margin-left:2px; opacity:.65; text-decoration:none !important; }',
    '.review-row{ display:grid; grid-template-columns:92px 1.4fr 1fr 90px 140px; gap:12px; align-items:center; padding:11px 14px; border-top:1px solid var(--border); }',
    '.review-row:first-child{ border-top:none; }',
    '.review-row a{ color:var(--accent-strong); text-decoration:underline; text-underline-offset:2px; }',
    '.review-row a:hover{ color:var(--accent); }',
    '.pill{ display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:600; }',
    '.pill-select{ border:none; font-family:inherit; appearance:auto; cursor:pointer; padding:3px 8px; border-radius:999px; font-size:12px; font-weight:600; }',
    '.pill-active{ background:var(--surface-2); color:var(--text-muted); border:1px solid var(--border); }',
    '.pill-pending{ background:var(--warn-bg); color:var(--warn); }',
    '.pill-succeeded{ background:var(--accent-soft); color:var(--accent-strong); }',
    '.pill-foal{ background:var(--success-bg); color:var(--success); }',
    '.pill-failed{ background:var(--danger-bg); color:var(--danger); }',
    '@media (max-width:640px){',
    '  .ledger-head{ display:none; }',
    '  .ledger-row{ grid-template-columns:1fr; gap:6px; background:var(--surface); border:1px solid var(--border); border-radius:12px; margin-bottom:10px; border-top:none; box-shadow:var(--shadow); }',
    '  .ledger-row > div{ display:flex; justify-content:space-between; gap:10px; font-size:14px; }',
    '  .ledger-row > div[data-label]::before{ content:attr(data-label); color:var(--text-muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; padding-top:2px; }',
    '  .ledger-row .notes-cell{ display:block; }',
    '  .ledger-row .notes-cell::before{ content:none; }',
    '  .ledger-row .actions-cell{ justify-content:flex-end; }',
    '  .ledger-row .actions-cell::before{ content:none; }',
    '  .review-row{ grid-template-columns:1fr; gap:6px; background:var(--surface); border:1px solid var(--border); border-radius:12px; margin-bottom:10px; border-top:none; box-shadow:var(--shadow); }',
    '  .review-row > div{ display:flex; justify-content:space-between; gap:10px; font-size:14px; }',
    '  .review-row > div[data-label]::before{ content:attr(data-label); color:var(--text-muted); font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; padding-top:2px; }',
    '  .detail-head .name-row{ flex-direction:column; }',
    '}',
    '.overlay{ position:fixed; inset:0; background:rgba(20,20,14,0.45); display:flex; align-items:center; justify-content:center; padding:20px; z-index:50; }',
    '.confirm-box{ background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:20px; max-width:360px; box-shadow:var(--shadow); }',
    '.confirm-box p{ margin:0 0 16px; font-size:14.5px; }',
    '.confirm-box .row{ display:flex; justify-content:flex-end; gap:10px; }'
  ].join('\n');

  // Rewrites every selector in a freshly-inserted stylesheet to be scoped
  // under #hr-ledger-overlay, so none of it can ever affect horsereality.com's
  // own page — walks @media blocks too. `:root`, `html` and `body` map onto
  // the scope element itself (there's no real <body> inside the overlay);
  // everything else becomes a descendant selector.
  function scopeStylesheet(styleEl, scopeSelector) {
    var sheet = styleEl.sheet;
    if (!sheet) return;
    function scopeRuleList(rules) {
      for (var i = 0; i < rules.length; i++) {
        var rule = rules[i];
        if (rule.type === CSSRule.MEDIA_RULE) {
          scopeRuleList(rule.cssRules);
        } else if (rule.type === CSSRule.STYLE_RULE) {
          var seen = {};
          var scoped = rule.selectorText.split(',').map(function (raw) {
            var sel = raw.trim();
            var mapped = (sel === ':root' || sel === 'html' || sel === 'body') ? scopeSelector : (scopeSelector + ' ' + sel);
            return mapped;
          }).filter(function (sel) {
            if (seen[sel]) return false;
            seen[sel] = true;
            return true;
          });
          rule.selectorText = scoped.join(', ');
        }
      }
    }
    scopeRuleList(sheet.cssRules);
  }

  // --- Google Fonts, same as dashboard.html --------------------------------
  var preconnect = document.createElement('link');
  preconnect.rel = 'preconnect';
  preconnect.href = 'https://fonts.googleapis.com';
  document.head.appendChild(preconnect);

  var fontSheet = document.createElement('link');
  fontSheet.rel = 'stylesheet';
  fontSheet.href = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(fontSheet);

  var dashboardStyleEl = document.createElement('style');
  dashboardStyleEl.textContent = DASHBOARD_CSS;
  document.head.appendChild(dashboardStyleEl);
  scopeStylesheet(dashboardStyleEl, '#' + OVERLAY_ID);

  // --- overlay container + #app mount point + close control ---------------
  var container = document.createElement('div');
  container.id = OVERLAY_ID;
  container.style.cssText = 'display:none; position:fixed; inset:0; z-index:2147483000; overflow:auto;';

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = [
    'position:fixed', 'top:12px', 'right:12px', 'z-index:2147483001',
    'background:var(--surface)', 'color:var(--text)', 'border:1px solid var(--border-strong)',
    'border-radius:9px', 'padding:8px 14px', 'font:14px "IBM Plex Sans",system-ui,sans-serif',
    'font-weight:500', 'cursor:pointer', 'box-shadow:var(--shadow)'
  ].join(';');
  closeBtn.addEventListener('click', function () { container.style.display = 'none'; });

  var app = document.createElement('div');
  app.className = 'wrap';
  app.id = 'app';

  container.appendChild(closeBtn);
  container.appendChild(app);
  (document.body || document.documentElement).appendChild(container);

  window.HRMobileOverlay = {
    show: function () { container.style.display = 'block'; },
    hide: function () { container.style.display = 'none'; },
    toggle: function () { container.style.display = (container.style.display === 'none') ? 'block' : 'none'; },
    isOpen: function () { return container.style.display !== 'none'; }
  };
})();
