chrome.action.onClicked.addListener(function () {
  var url = chrome.runtime.getURL('dashboard.html');
  chrome.tabs.query({ url: url }, function (tabs) {
    if (tabs && tabs.length) {
      chrome.tabs.update(tabs[0].id, { active: true });
      chrome.windows.update(tabs[0].windowId, { focused: true });
    } else {
      chrome.tabs.create({ url: url });
    }
  });
});

// Content scripts' own fetch() is still bound by the page's CORS policy, so
// image fetches (which Horse Reality's CDN seems to reject cross-origin) are
// done here instead — the background service worker gets an unrestricted
// fetch for any host covered by host_permissions.
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
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
