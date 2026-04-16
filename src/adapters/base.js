/**
 * Base class for platform adapters.
 * Each adapter defines how to detect, extract, and replace markdown on a specific platform.
 */
export class BaseAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * Check if this adapter handles the given URL
   * @param {string} url - Current page URL
   * @returns {boolean}
   */
  matchUrl(url) {
    throw new Error('matchUrl() must be implemented');
  }

  /**
   * Get the raw markdown content from the page.
   * Strategy 1: Raw API (preferred) — construct a URL to fetch raw content
   * Strategy 2: DOM extraction (fallback) — extract from rendered HTML (lossy)
   * @param {Document} doc
   * @returns {Promise<string>}
   */
  async getRawMarkdown(doc) {
    throw new Error('getRawMarkdown() must be implemented');
  }

  /**
   * Get the container element where rendered markdown should be placed.
   * For SPA pages, may need to wait for the element to appear.
   * @param {Document} doc
   * @returns {Promise<HTMLElement>}
   */
  async getContainer(doc) {
    throw new Error('getContainer() must be implemented');
  }

  /**
   * Post-process the container after rendering (fix links, etc.)
   * @param {HTMLElement} container
   */
  postProcess(container) {
    // Optional: override in subclass
  }

  /**
   * Wait for an element to appear in the DOM (for SPA support)
   * @param {Document} doc
   * @param {string} selector
   * @param {number} timeout - Max wait time in ms
   * @returns {Promise<HTMLElement>}
   */
  waitForElement(doc, selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = doc.querySelector(selector);
      if (el) return resolve(el);

      const observer = new MutationObserver(() => {
        const el = doc.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });

      observer.observe(doc.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Timeout waiting for ${selector}`));
      }, timeout);
    });
  }
}
