import { BaseAdapter } from './base';

/**
 * GitLab adapter — works with GitLab CE/EE instances including self-hosted.
 * Covers: git.woa.com, gitlab.com, and any GitLab-based platform.
 *
 * GitLab renders markdown files at URLs like:
 *   /group/project/-/blob/branch/path/to/file.md
 *
 * Raw content is available at:
 *   /group/project/-/raw/branch/path/to/file.md
 *   or via API: /api/v4/projects/:id/repository/files/:path/raw?ref=branch
 */
export class GitLabAdapter extends BaseAdapter {
  constructor(options = {}) {
    super('gitlab');
    // Default URL patterns — user can add custom domains
    this.domains = options.domains || [
      'gitlab.com',
      'git.woa.com',
    ];
    // CSS selectors for different GitLab versions
    this.containerSelectors = [
      '.blob-viewer[data-type="rich"]',  // GitLab 15+
      '.blob-content .code',              // GitLab rich blob view
      '.file-content .code',              // Older GitLab
      '.blob-viewer',                     // Generic blob viewer
      '.markdown-body',                   // Already-rendered markdown
      '.file-holder .file-content',       // File content wrapper
    ];
  }

  matchUrl(url) {
    try {
      const parsed = new URL(url);
      const domainMatch = this.domains.some(
        (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
      );
      if (!domainMatch) return false;

      // Must be viewing a .md file in blob view
      const isMdFile = /\.md$/i.test(parsed.pathname) || /\.markdown$/i.test(parsed.pathname);
      const isBlobView = /\/-\/blob\//.test(parsed.pathname) || /\/blob\//.test(parsed.pathname);
      // Also match tree view for README.md rendering
      const isTreeView = /\/-\/tree\//.test(parsed.pathname) || /\/tree\//.test(parsed.pathname);

      return isMdFile && isBlobView || isTreeView;
    } catch {
      return false;
    }
  }

  async getRawMarkdown(doc) {
    // Strategy 1: Construct raw URL from current URL
    const rawUrl = this._constructRawUrl(doc.location.href);
    if (rawUrl) {
      try {
        const response = await fetch(rawUrl, { credentials: 'same-origin' });
        if (response.ok) {
          const text = await response.text();
          // Verify it looks like markdown (not HTML)
          if (!text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
            return text;
          }
        }
      } catch {
        // Fall through to DOM extraction
      }
    }

    // Strategy 2: Try to find raw content button/link
    const rawLink = doc.querySelector('a[data-testid="raw-button"], a.btn-raw, a[href*="/raw/"]');
    if (rawLink) {
      try {
        const response = await fetch(rawLink.href, { credentials: 'same-origin' });
        if (response.ok) return await response.text();
      } catch {
        // Fall through
      }
    }

    // Strategy 3: DOM extraction (lossy fallback)
    return this._extractFromDom(doc);
  }

  async getContainer(doc) {
    for (const selector of this.containerSelectors) {
      try {
        const el = await this.waitForElement(doc, selector, 5000);
        if (el) return el;
      } catch {
        continue;
      }
    }
    throw new Error('GitLab: could not find markdown container');
  }

  postProcess(container) {
    // Fix relative links to work within the git platform
    container.querySelectorAll('a[href]').forEach((link) => {
      const href = link.getAttribute('href');
      // Don't touch absolute URLs or anchors
      if (href.startsWith('http') || href.startsWith('#') || href.startsWith('//')) return;
      // Relative links should resolve against the current page
      // GitLab already handles this in most cases
    });

    // Add GitHub-style markdown-body class for styling
    container.classList.add('markdown-body', 'md-reader-enhanced');
  }

  _constructRawUrl(url) {
    try {
      const parsed = new URL(url);
      // /group/project/-/blob/branch/path.md → /group/project/-/raw/branch/path.md
      const rawPath = parsed.pathname.replace(/\/-\/blob\//, '/-/raw/');
      if (rawPath !== parsed.pathname) {
        return `${parsed.origin}${rawPath}`;
      }
      // Older GitLab: /group/project/blob/branch/path.md → /group/project/raw/branch/path.md
      const rawPath2 = parsed.pathname.replace(/\/blob\//, '/raw/');
      if (rawPath2 !== parsed.pathname) {
        return `${parsed.origin}${rawPath2}`;
      }
    } catch {
      // ignore
    }
    return null;
  }

  _extractFromDom(doc) {
    // Try to get text content from code blocks (pre-rendered markdown)
    // This is lossy — formatting, code fences, etc. may not survive
    for (const selector of this.containerSelectors) {
      const el = doc.querySelector(selector);
      if (el) {
        // If it contains rendered HTML, we can't easily get raw markdown back
        // Best effort: return the text content
        return el.textContent || '';
      }
    }
    return '';
  }
}
