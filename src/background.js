/**
 * Background service worker.
 * Handles install events, storage, and cross-tab messaging.
 * Does NOT do any DOM operations (MV3 constraint).
 */

// Track enhancement status per tab
const tabStatus = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'enhancement-status') {
    const tabId = sender.tab?.id;
    if (tabId) {
      tabStatus.set(tabId, {
        status: message.status,
        adapter: message.adapter,
        error: message.error,
        url: message.url,
      });
      // Update badge
      if (message.status === 'success') {
        chrome.action.setBadgeText({ text: '✓', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId });
      } else if (message.status === 'error') {
        chrome.action.setBadgeText({ text: '!', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#dc3545', tabId });
      }
    }
  }

  if (message.type === 'get-status') {
    const tabId = message.tabId;
    sendResponse(tabStatus.get(tabId) || { status: 'inactive' });
    return true;
  }

  if (message.type === 'toggle-enabled') {
    chrome.storage.local.get('enabled', (result) => {
      const newEnabled = !(result.enabled ?? true);
      chrome.storage.local.set({ enabled: newEnabled });
      sendResponse({ enabled: newEnabled });
    });
    return true;
  }

  // Proxy-fetch an image with extension privileges. The content script's page
  // context cannot fetch file:// URLs (Chrome forbids the scheme) and is
  // subject to page CORS for cross-origin images; the service worker with
  // host_permissions can fetch both. Used by export to embed images.
  if (message.type === 'fetch-image') {
    (async () => {
      try {
        const resp = await fetch(message.url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        const type = blob.type || 'image/png';
        if (!type.startsWith('image/')) throw new Error(`not an image: ${type}`);
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        sendResponse({ ok: true, dataUrl: `data:${type};base64,${btoa(binary)}` });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true; // async sendResponse
  }
});

// Clean up status when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStatus.delete(tabId);
});

// Clear badge when navigating to a non-enhanced page
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
    tabStatus.delete(tabId);
  }
});
