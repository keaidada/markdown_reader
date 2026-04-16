const statusEl = document.getElementById('status');
const toggleEl = document.getElementById('toggle');
const adapterInfoEl = document.getElementById('adapter-info');

// Get current tab status
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  if (!tab) return;

  chrome.runtime.sendMessage({ type: 'get-status', tabId: tab.id }, (response) => {
    if (!response) return;
    if (response.status === 'success') {
      statusEl.className = 'status status-success';
      statusEl.textContent = `✓ 已增强 (${response.adapter})`;
      adapterInfoEl.textContent = `平台: ${response.adapter}`;
    } else if (response.status === 'error') {
      statusEl.className = 'status status-error';
      statusEl.textContent = `✕ 增强失败`;
      adapterInfoEl.textContent = response.error || '未知错误';
    } else {
      statusEl.className = 'status status-inactive';
      statusEl.textContent = '未检测到 Markdown 页面';
      adapterInfoEl.textContent = '支持: 本地文件、GitLab、Gitea 等平台';
    }
  });
});

// Load enabled state
chrome.storage.local.get('enabled', (result) => {
  toggleEl.checked = result.enabled ?? true;
});

// Toggle handler
toggleEl.addEventListener('change', () => {
  chrome.runtime.sendMessage({ type: 'toggle-enabled' }, (response) => {
    // Reload current tab to apply change
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.reload(tabs[0].id);
    });
  });
});
