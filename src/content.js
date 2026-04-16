import { findAdapter } from './adapters/index';
import { renderMarkdown, attachCopyHandlers } from './core/renderer';
import { injectHeadingIds, createTocSidebar } from './core/toc';
import { enhanceTables } from './core/table';

// Track if we've already enhanced this page
let enhanced = false;

async function main() {
  // Don't re-enhance
  if (enhanced) return;

  // Check if extension is enabled
  try {
    const result = await chrome.storage.local.get('enabled');
    if (result.enabled === false) return;
  } catch (e) {
    // storage might fail on file:// — proceed anyway
  }

  const url = window.location.href;
  const adapter = findAdapter(url);
  if (!adapter) return;

  console.log(`[Markdown Reader] Matched adapter: ${adapter.name}`);

  try {
    // LocalFileAdapter has a special enhance() method that replaces the whole page
    if (adapter.enhance) {
      const result = await adapter.enhance(document, renderMarkdown);
      if (result) {
        const { container, toc } = result;
        container.innerHTML = injectHeadingIds(container.innerHTML);
        adapter.postProcess(container);
        attachCopyHandlers(container);
        enhanceTables(container);

        // TOC sidebar — left-right layout
        if (toc && toc.length > 2) {
          const tocSidebar = createTocSidebar(toc);
          if (tocSidebar) {
            const wrapper = document.querySelector('.md-reader-local-wrapper');
            document.body.insertBefore(tocSidebar, wrapper);
            if (wrapper) wrapper.classList.add('md-reader-has-toc');
            tocSidebar._observeHeadings(container);

            // Sync collapse/expand with content margin
            const toggleBtn = tocSidebar.querySelector('.md-reader-toc-toggle');
            toggleBtn.addEventListener('click', () => {
              const isCollapsed = tocSidebar.classList.contains('md-reader-toc-collapsed');
              if (wrapper) {
                wrapper.classList.toggle('md-reader-has-toc', !isCollapsed);
                wrapper.classList.toggle('md-reader-has-toc-collapsed', isCollapsed);
              }
            });
          }
        }

        enhanced = true;
        notifyBackground('success', adapter.name, url);
        return;
      }
    }

    // Standard flow for platform adapters (GitLab etc.)
    const markdown = await adapter.getRawMarkdown(document);
    if (!markdown || markdown.trim().length === 0) return;

    const container = await adapter.getContainer(document);
    if (!container) return;

    const { html, toc } = await renderMarkdown(markdown);
    container.innerHTML = injectHeadingIds(html);
    adapter.postProcess(container);
    attachCopyHandlers(container);
    enhanceTables(container);

    if (toc.length > 2) {
      const tocSidebar = createTocSidebar(toc);
      if (tocSidebar) {
        document.body.appendChild(tocSidebar);
        tocSidebar._observeHeadings(container);
      }
    }

    enhanced = true;
    notifyBackground('success', adapter.name, url);
  } catch (error) {
    console.error('[Markdown Reader] Enhancement failed:', error);
    showErrorToast(error.message);
    notifyBackground('error', adapter?.name, url, error.message);
  }
}

function notifyBackground(status, adapterName, url, error) {
  try {
    chrome.runtime.sendMessage({
      type: 'enhancement-status',
      status,
      adapter: adapterName,
      url,
      ...(error && { error }),
    });
  } catch (e) {
    // sendMessage may fail on file:// if background is not ready
  }
}

function showErrorToast(message) {
  const toast = document.createElement('div');
  toast.className = 'md-reader-toast md-reader-toast-error';
  toast.innerHTML = `
    <span>Markdown Reader: 渲染增强失败</span>
    <button class="md-reader-toast-close">✕</button>
  `;
  toast.title = message;
  toast.querySelector('.md-reader-toast-close').addEventListener('click', () => toast.remove());
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// SPA navigation observer — only for http(s) pages (GitLab etc.), not file://
if (document.body && window.location.protocol !== 'file:') {
  let lastUrl = window.location.href;
  const urlObserver = new MutationObserver(() => {
    const newUrl = window.location.href;
    // Only re-run if the pathname changed (not just hash)
    if (new URL(newUrl).pathname !== new URL(lastUrl).pathname) {
      lastUrl = newUrl;
      enhanced = false;
      setTimeout(main, 500);
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });
}

// Run on initial load
main();
