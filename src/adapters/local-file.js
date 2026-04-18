import { BaseAdapter } from './base';
import { createExportButton } from '../core/export';

/**
 * Local file adapter — handles file:// URLs ending in .md or .markdown
 *
 * When Chrome opens a local .md file, it displays raw text in a <pre> tag.
 * This adapter detects that, reads the raw text, and replaces the entire
 * page body with GitHub-style rendered markdown.
 */
export class LocalFileAdapter extends BaseAdapter {
  constructor() {
    super('local-file');
  }

  matchUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'file:') return false;
      const path = decodeURIComponent(parsed.pathname);
      return /\.(md|markdown|mdown|mkd|mkdn|mdwn|mdtxt|mdtext|txt)$/i.test(path);
    } catch {
      return false;
    }
  }

  async getRawMarkdown(doc) {
    // Chrome renders local text files as: <body><pre>...content...</pre></body>
    // or sometimes just plain text in body
    const pre = doc.querySelector('pre');
    if (pre) {
      return pre.textContent;
    }
    // Fallback: body might contain raw text directly
    if (doc.body && doc.body.children.length === 0) {
      return doc.body.textContent;
    }
    // Already processed by us — don't re-process
    if (doc.querySelector('.md-reader-enhanced')) {
      return '';
    }
    return doc.body?.textContent || '';
  }

  async getContainer(doc) {
    // For local files, we replace the entire body content
    // Create a wrapper div inside body
    let container = doc.querySelector('.md-reader-container');
    if (container) return container;

    container = doc.createElement('div');
    container.className = 'md-reader-container';
    return container;
  }

  /**
   * Override: for local files we need to fully replace the page
   */
  async enhance(doc, renderFn) {
    const markdown = await this.getRawMarkdown(doc);
    if (!markdown || markdown.trim().length === 0) return false;

    const { html, toc } = await renderFn(markdown);

    // Save original content for toggle
    if (!doc.body.dataset.mdReaderOriginal) {
      doc.body.dataset.mdReaderOriginal = doc.body.innerHTML;
    }

    // Clear body and build new layout
    doc.body.innerHTML = '';
    doc.body.style.margin = '0';
    doc.body.style.padding = '0';
    doc.body.style.background = '#ffffff';

    // Set page title from filename
    const filename = decodeURIComponent(window.location.pathname.split('/').pop());
    doc.title = filename;

    // Set favicon using SVG data URI
    // Flat M with center stroke extending into down-arrow, rounded strokes
    const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g fill="none" stroke="%232b2b2b" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"><path d="M32 94 L32 34"/><path d="M32 34 L64 68"/><path d="M64 68 L96 34"/><path d="M96 34 L96 94"/><path d="M64 68 L64 102"/><path d="M48 88 L64 102 L80 88"/></g></svg>`;
    let link = doc.querySelector("link[rel*='icon']");
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${faviconSvg}`;

    // SVG icon for header
    const headerIcon = `<svg class="md-reader-local-icon" viewBox="0 0 128 128" fill="none"><g fill="none" stroke="#2b2b2b" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"><path d="M32 94 L32 34"/><path d="M32 34 L64 68"/><path d="M64 68 L96 34"/><path d="M96 34 L96 94"/><path d="M64 68 L64 102"/><path d="M48 88 L64 102 L80 88"/></g></svg>`;

    // Create main container
    const wrapper = doc.createElement('div');
    wrapper.className = 'md-reader-local-wrapper';
    wrapper.innerHTML = `
      <div class="md-reader-local-header">
        ${headerIcon}
        <span class="md-reader-local-filename">${this._escapeHtml(filename)}</span>
      </div>
      <div class="md-reader-container markdown-body md-reader-enhanced">
        ${html}
      </div>
    `;

    doc.body.appendChild(wrapper);

    // Add export button to header
    const header = wrapper.querySelector('.md-reader-local-header');
    const contentContainer = wrapper.querySelector('.md-reader-container');
    const exportBtn = createExportButton(contentContainer, filename.replace(/\.[^.]+$/, ''));
    header.appendChild(exportBtn);

    return { container: contentContainer, toc };
  }

  postProcess(container) {
    container.classList.add('markdown-body', 'md-reader-enhanced');

    // Fix relative image paths for local files
    const baseUrl = window.location.href.replace(/[^/]*$/, '');
    container.querySelectorAll('img[src]').forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('http') && !src.startsWith('data:') && !src.startsWith('file:')) {
        img.src = baseUrl + src;
      }
    });

    // Fix relative links
    container.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('http') && !href.startsWith('#') && !href.startsWith('file:')) {
        a.href = baseUrl + href;
      }
    });
  }

  _escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
