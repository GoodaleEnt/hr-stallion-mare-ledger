importScripts('lib.js', 'storage.js');

// Pending coverings this old have certainly resolved in-game one way or the
// other, but the stud owner never gets the "covering has failed"
// notification for a CUSTOMER's mare — only she does. So rather than wait
// for the user to browse back to horsereality.com (which is when the
// content-script sweep would silently mark it Failed), badge the toolbar
// icon so there's a chance to click through to the mare's own page first.
var REVIEW_DAYS = 6;

function refreshReviewBadge() {
  HRStorage.getState(function (state) {
    var count = HRLib.findReviewCandidates(state, REVIEW_DAYS).length;
    chrome.action.setBadgeText({ text: count ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
    chrome.action.setTitle({
      title: count
        ? 'HR Stallion & Mare Ledger — ' + count + ' covering' + (count === 1 ? '' : 's') + ' ready to review'
        : 'Open HR Stallion & Mare Ledger'
    });
  });
}

chrome.runtime.onStartup.addListener(refreshReviewBadge);
chrome.runtime.onInstalled.addListener(refreshReviewBadge);
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
