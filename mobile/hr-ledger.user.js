// ==UserScript==
// @name         HR Stallion & Mare Ledger (Mobile)
// @namespace    https://github.com/GoodaleEnt/hr-stallion-mare-ledger
// @version      1.0.0
// @description  Mobile port of HR Stallion & Mare Ledger — auto-tracks Horse Reality stud earnings and breeding history via a userscript manager (Userscripts on iOS, Tampermonkey/Violentmonkey on Firefox Android). Private, no account needed.
// @author       GoodaleEnt
// @match        *://*.horsereality.com/*
// @run-at       document-end
// @grant        GM.getValue
// @grant        GM.setValue
// @require      https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/mobile/scaffold.js
// @require      https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/lib.js
// @require      https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/mobile/storage.js
// @require      https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/content.js
// @require      https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/dashboard.js
// @require      https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/mobile/controls.js
// @updateURL    https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/mobile/hr-ledger.user.js
// @downloadURL  https://raw.githubusercontent.com/GoodaleEnt/hr-stallion-mare-ledger/master/mobile/hr-ledger.user.js
// ==/UserScript==

// Everything runs from the @require chain above, in this exact order:
//   1. scaffold.js   — chrome shim, overlay container + #app mount point,
//                       scoped dashboard CSS (must load before dashboard.js)
//   2. lib.js         — shared pure helpers, unmodified from the desktop extension
//   3. mobile/storage.js — GM.getValue/GM.setValue-backed HRStorage (same
//                       interface as the desktop extension's storage.js)
//   4. content.js     — the actual page scraping, unmodified from the
//                       desktop extension (portrait-image caching silently
//                       no-ops via the scaffold's chrome shim — see README)
//   5. dashboard.js   — unmodified from the desktop extension; mounts into
//                       the #app div scaffold.js created, hidden until opened
//   6. mobile/controls.js — the floating "Ledger" button that shows/hides
//                       the dashboard overlay and badges pending reviews
//
// This file has no logic of its own — everything above is self-starting,
// same as content.js already does inside the desktop extension.
//
// NOTE for maintainers: @require'd files are cached by the userscript
// manager and only re-fetched when THIS file's @version changes (or on
// manual reinstall). Editing any required file — including a shared file
// like content.js or lib.js — needs a @version bump here for mobile users
// to actually pick it up.
