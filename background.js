importScripts('lib.js', 'storage.js');

// Pending coverings this old have certainly resolved in-game one way or the
// other, but the stud owner never gets the "covering has failed"
// notification for a CUSTOMER's mare — only she does. So rather than wait
// for the user to browse back to horsereality.com (which is when the
// content-script sweep would silently mark it Failed), badge the toolbar
// icon so there's a chance to click through to the mare's own page first.
var REVIEW_DAYS = 5; // a covering is settled 48 hours after breeding (wiki: Life); it is badged for review on day 5

function refreshReviewBadge() {
  HRStorage.getState(function (state) {
    var review = HRLib.findReviewCandidates(state, REVIEW_DAYS).length;
    var due = HRLib.foalsDue(state).filter(function (f) { return f.days != null && f.days <= 7; }).length;
    var count = review + due;
    chrome.action.setBadgeText({ text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    chrome.action.setTitle({
      title: count
        ? 'HR Stallion & Mare Ledger — ' + (review ? review + ' covering' + (review === 1 ? '' : 's') + ' ready to review' : '') + (review && due ? ', ' : '') + (due ? due + ' foal' + (due === 1 ? '' : 's') + ' due this week' : '')
        : 'Open HR Stallion & Mare Ledger'
    });
  });
}

chrome.runtime.onStartup.addListener(refreshReviewBadge);
chrome.runtime.onInstalled.addListener(refreshReviewBadge);
// older ledgers keep every horse picture inside the ledger (tens of MB read and rewritten by every page): move them out once
function moveImages() { HRStorage.migrateImages(function (n) { if (n) refreshReviewBadge(); }); }
chrome.runtime.onStartup.addListener(moveImages);
chrome.runtime.onInstalled.addListener(moveImages);
setTimeout(moveImages, 4000);
// Storage changes (a new breeding scraped, a status edited) update the badge
// right away; the hourly alarm catches the case where nothing changed but a
// Pending covering has simply aged past the threshold since the service
// worker last woke up.
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area === 'local' && changes.hrLedger) refreshReviewBadge();
});
chrome.alarms.create('hr-review-badge', { periodInMinutes: 60 });
chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === 'hr-review-badge') refreshReviewBadge();
});
refreshReviewBadge();

// Focuses the dashboard if it's already open instead of opening a second
// copy. chrome.tabs.query({ url }) can't see a tab's URL without the "tabs"
// permission, so ask the runtime which pages of THIS extension are open
// (runtime.getContexts needs no permission and reports tabId/windowId).
// With a life number, the dashboard also jumps to that horse's profile: it reads
// "#horse=<life>" (a timestamp keeps repeat clicks on the same horse working).
async function openDashboard(life) {
  var url = chrome.runtime.getURL('dashboard.html');
  var target = life ? url + '#horse=' + encodeURIComponent(life) + '&t=' + Date.now() : url;
  try {
    var contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    var open = contexts.find(function (c) { return c.documentUrl && c.documentUrl.split('#')[0] === url && c.tabId >= 0; });
    if (open) {
      await chrome.tabs.update(open.tabId, life ? { active: true, url: target } : { active: true });
      await chrome.windows.update(open.windowId, { focused: true });
      return;
    }
  } catch (e) { /* fall through and open a new tab */ }
  chrome.tabs.create({ url: target });
}
chrome.action.onClicked.addListener(function () { openDashboard(); });

// Content scripts' own fetch() is still bound by the page's CORS policy, so
// image fetches (which Horse Reality's CDN seems to reject cross-origin) are
// done here instead — the background service worker gets an unrestricted
// fetch for any host covered by host_permissions.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg && msg.type === 'HR_OPEN_PROFILE') {
    openDashboard(String(msg.life || '').replace(/[^0-9]/g, ''));
    sendResponse({ ok: true });
    return false;
  }
  if (!msg || msg.type !== 'HR_FETCH_IMAGE') return false;

  fetch(msg.url)
    .then(function (r) {
      if (!r.ok) throw new Error('bad status ' + r.status);
      return r.blob();
    })
    .then(function (blob) {
      return blob.arrayBuffer().then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        var base64 = btoa(binary);
        return 'data:' + (blob.type || 'image/png') + ';base64,' + base64;
      });
    })
    .then(function (dataUrl) { sendResponse({ dataUrl: dataUrl }); })
    .catch(function () { sendResponse({ dataUrl: '' }); });

  return true; // keep the message channel open for the async response
});

// ---------- address-bar search: type "hrl", press Tab, then a horse's name or a tab ----------
// "hrl Dark Knight" opens that horse in the ledger; "hrl mares", "hrl stallions", "hrl colts", "hrl fillies", "hrl herd",
// "hrl analytics", "hrl calc" open that tab; "hrl panel" opens the ledger in Chrome's side panel.
var OMNI_TABS = { stallions: 'stallions', mares: 'mares', colts: 'colts', fillies: 'fillies', herd: 'herd', retired: 'retired', others: 'others', analytics: 'analytics', calc: 'calc', calculator: 'calc' };
function omniEscape(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function omniNorm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9# ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
chrome.omnibox.setDefaultSuggestion({ description: 'Open the ledger, or type a horse name, a life number, or mares, stallions, colts, fillies, herd, analytics, calc, panel' });
chrome.omnibox.onInputChanged.addListener(function (text, suggest) {
  var q = omniNorm(text), out = [];
  Object.keys(OMNI_TABS).concat(['panel']).forEach(function (c) {
    if (!q || c.indexOf(q) === 0) out.push({ content: 'tab:' + c, description: 'Open <match>' + omniEscape(c) + '</match> in the ledger' });
  });
  if (!q) { suggest(out.slice(0, 8)); return; }
  HRStorage.getState(function (state) {
    var hits = [];
    Object.keys(state.horseInfo || {}).forEach(function (life) {
      var i = state.horseInfo[life], n = omniNorm(i.name);
      var at = n.indexOf(q);
      if (life.indexOf(q.replace('#', '')) === 0 || at > -1) hits.push({ life: life, rank: at === 0 || life.indexOf(q.replace('#', '')) === 0 ? 0 : 1, info: i });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || String(a.info.name || '').localeCompare(String(b.info.name || '')); });
    hits.slice(0, 6).forEach(function (h) {
      var mine = String(h.info.ownerName || '').trim().toLowerCase() === String((state.settings && state.settings.myUsername) || '').trim().toLowerCase();
      out.unshift({ content: 'horse:' + h.life, description: omniEscape(h.info.name || ('#' + h.life)) + ' <dim>' + omniEscape([h.info.breed, h.info.sex, mine ? 'yours' : h.info.ownerName].filter(Boolean).join(' \u00b7 ')) + ' #' + h.life + '</dim>' });
    });
    suggest(out.slice(0, 8));
  });
});
chrome.omnibox.onInputEntered.addListener(function (text) {
  var t = String(text || '').trim(), m;
  if ((m = /^horse:(\d+)$/.exec(t))) { openDashboard(m[1]); return; }
  if ((m = /^tab:(\w+)$/.exec(t))) { openCommand(m[1]); return; }
  if (!t) { openDashboard(''); return; }
  var low = omniNorm(t);
  if (OMNI_TABS[low] || low === 'panel') { openCommand(low); return; }
  if ((m = /^#?(\d{6,})$/.exec(t))) { openDashboard(m[1]); return; }
  // a name: the first saved horse that matches
  HRStorage.getState(function (state) {
    var found = Object.keys(state.horseInfo || {}).find(function (life) { return omniNorm(state.horseInfo[life].name).indexOf(low) > -1; });
    if (found) openDashboard(found); else openDashboard('');
  });
});
function openCommand(cmd) {
  if (cmd === 'panel') {
    chrome.windows.getLastFocused(function (w) { try { chrome.sidePanel.open({ windowId: w.id }); } catch (e) { openDashboard(''); } });
    return;
  }
  openDashboardTab(OMNI_TABS[cmd] || '');
}
// the dashboard opens on a tab when the address ends in #tab=<name>
async function openDashboardTab(tab) {
  var url = chrome.runtime.getURL('dashboard.html');
  var target = tab ? url + '#tab=' + encodeURIComponent(tab) + '&t=' + Date.now() : url;
  try {
    var contexts = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    var open = contexts.find(function (c) { return c.documentUrl && c.documentUrl.split('#')[0] === url && c.tabId >= 0; });
    if (open) { await chrome.tabs.update(open.tabId, { active: true, url: target }); await chrome.windows.update(open.windowId, { focused: true }); return; }
  } catch (e) { /* open a new tab */ }
  chrome.tabs.create({ url: target });
}
// the toolbar icon keeps opening the dashboard in a tab; the side panel is opened from the address bar ("hrl panel")
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); } catch (e) { /* older Chrome */ }
