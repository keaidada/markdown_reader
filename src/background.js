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
