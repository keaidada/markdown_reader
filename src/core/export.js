/**
 * Export rendered markdown to various formats (HTML, PDF, Word)
 */

/**
 * Create a clean clone of the container prepared for export:
 * - resolve relative <img> src against the current page (document.baseURI)
 * - fetch image bytes (best-effort) so they can be embedded into the export
 * - drop interactive-only elements (code copy buttons) that leak attributes
 *
 * Returns { clone, images } where images is a list of
 * { img, abs, dataUrl } — dataUrl is null when the fetch failed and the
 * caller must fall back to the absolute URL.
 */
async function prepareExportClone(container) {
  const clone = container.cloneNode(true);

  // Copy buttons carry the whole source in data-code — pure noise in exports
  clone.querySelectorAll('.md-reader-code-header').forEach((el) => el.remove());
  // Mermaid fullscreen buttons are interactive-only
  clone.querySelectorAll('.md-reader-mermaid-fs-btn').forEach((el) => el.remove());

  const images = [];
  const imgs = Array.from(clone.querySelectorAll('img[src]'));
  await Promise.all(imgs.map(async (img) => {
    const raw = img.getAttribute('src');
    if (!raw) return;

    // Already-inline images are usable as-is
    if (raw.startsWith('data:')) {
      images.push({ img, abs: raw, dataUrl: raw });
      return;
    }

    // Resolve against the page URL first — relative paths are meaningless
    // inside a standalone exported file.
    let abs;
    try {
      abs = new URL(raw, document.baseURI).href;
    } catch {
      return;
    }

    // Try to fetch the image bytes in the page context first (same-origin is
    // usually fine). On failure (file:// scheme forbidden, CORS, auth), fall
    // back to the background service worker, which fetches with extension
    // privileges (host_permissions).
    let dataUrl = null;
    try {
      const resp = await fetch(abs, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      if (!blob.type.startsWith('image/')) throw new Error(`not an image: ${blob.type}`);
      dataUrl = await blobToDataUrl(blob);
    } catch {
      dataUrl = await fetchImageViaBackground(abs);
    }
    images.push({ img, abs, dataUrl });
  }));

  return { clone, images };
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Ask the background service worker to fetch an image with extension
 * privileges (works for file:// URLs when the user enabled file access, and
 * for cross-origin images that page-context fetch would block on CORS).
 * Returns a data URL or null.
 */
async function fetchImageViaBackground(url) {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'fetch-image', url });
    if (resp && resp.ok && resp.dataUrl) return resp.dataUrl;
  } catch {
    // background unavailable (e.g. extension reloading)
  }
  return null;
}

/**
 * Get the full styled HTML content for export
 */
async function getStyledHtml(container, title, toc) {
  const { clone, images } = await prepareExportClone(container);
  // Inline bytes as data URIs; fall back to the absolute URL
  images.forEach(({ img, abs, dataUrl }) => { img.src = dataUrl || abs; });

  // Collect all stylesheets from the page
  const styles = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        styles.push(rule.cssText);
      }
    } catch {
      // Cross-origin stylesheets can't be read
    }
  }

  const tocNav = buildTocNav(toc);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body { max-width: 860px; margin: 40px auto; padding: 0 24px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
pre { overflow-x: auto; }
table { display: table; }
.md-reader-table-wrapper, .mdr-tbl-wrap { overflow-x: auto; }
img { max-width: 100%; }
${styles.join('\n')}
${EXPORT_TOC_CSS}
</style>
</head>
<body class="markdown-body">
${clone.innerHTML}
${tocNav}
${EXPORT_TOC_JS}
</body>
</html>`;
}

/**
 * Build a fixed right-side chapter navigation for the exported HTML.
 * Pure CSS + a tiny scrollspy script — no external dependencies.
 */
function buildTocNav(toc) {
  if (!toc || toc.length < 2) return '';
  const items = toc.map((t) => {
    const indent = Math.max(0, t.level - 1) * 12;
    const text = escapeHtml(t.text);
    return `<a class="mdr-toc-item" data-lv="${t.level}" href="#${t.id}" style="padding-left:${8 + indent}px" title="${text}">${text}</a>`;
  }).join('\n');
  return `<nav class="mdr-export-toc"><div class="mdr-toc-title">目录</div>${items}</nav>`;
}

const EXPORT_TOC_CSS = `
.mdr-export-toc { position: fixed; top: 24px; right: 16px; width: 240px; max-height: calc(100vh - 48px); overflow-y: auto; padding: 12px 8px; background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 8px; font-size: 12px; line-height: 1.5; z-index: 99; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.mdr-toc-title { font-weight: 600; font-size: 13px; padding: 0 8px 8px; color: #1f2328; }
.mdr-toc-item { display: block; color: #57606a; text-decoration: none; padding: 3px 8px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mdr-toc-item:hover { background: #eaeef2; color: #0969da; }
.mdr-toc-item.active { background: #dbeafe; color: #0969da; font-weight: 600; }
@media (min-width: 1200px) { body { margin-left: calc(50vw - 430px - 130px); } }
@media (max-width: 1199px) { .mdr-export-toc { display: none; } }
@media print { .mdr-export-toc { display: none; } }
`;

const EXPORT_TOC_JS = `
<script>
(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll('.mdr-toc-item'));
  if (!links.length) return;
  var heads = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
  function update() {
    var y = window.scrollY + 120, active = -1;
    for (var i = 0; i < heads.length; i++) {
      if (heads[i] && heads[i].getBoundingClientRect().top + window.scrollY <= y) active = i;
    }
    links.forEach(function (a, i) { a.classList.toggle('active', i === active); });
  }
  window.addEventListener('scroll', update, { passive: true });
  update();
})();
</script>
`;

/**
 * Export as HTML file
 */
export async function exportHtml(container, title, toc) {
  const html = await getStyledHtml(container, title, toc);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${title}.html`);
}

/**
 * Export as PDF via print dialog
 */
export function exportPdf() {
  window.print();
}

/**
 * Export as Word (.doc) using HTML that Word/WPS can open.
 *
 * Note: MHTML would be needed for MS Word to render embedded images, but WPS
 * refuses to open MHTML saved as .doc. Plain HTML with data-URI images opens
 * in both WPS and Word.
 */
export async function exportWord(container, title) {
  const { clone, images } = await prepareExportClone(container);
  // Embed fetched bytes as data URIs; fall back to the absolute URL
  images.forEach(({ img, abs, dataUrl }) => { img.src = dataUrl || abs; });

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
body { font-family: "Segoe UI", Arial, sans-serif; font-size: 12pt; line-height: 1.6; }
h1 { font-size: 24pt; } h2 { font-size: 18pt; } h3 { font-size: 14pt; }
pre { background: #f6f8fa; padding: 12px; border-radius: 6px; font-family: Consolas, monospace; font-size: 10pt; }
code { font-family: Consolas, monospace; font-size: 10pt; background: #f0f0f0; padding: 2px 4px; }
table { border-collapse: collapse; } td, th { border: 1px solid #d0d7de; padding: 6px 12px; }
blockquote { border-left: 4px solid #d0d7de; margin-left: 0; padding-left: 16px; color: #57606a; }
img { max-width: 100%; }
</style></head>
<body>${clone.innerHTML}</body></html>`;

  downloadBlob(
    new Blob([html], { type: 'application/msword;charset=utf-8' }),
    `${title}.doc`
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Create the export dropdown button element
 */
export function createExportButton(container, title, toc) {
  const wrapper = document.createElement('div');
  wrapper.className = 'md-reader-export-wrapper';
  wrapper.innerHTML = `
    <button class="md-reader-export-btn" title="导出文档">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/>
        <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"/>
      </svg>
      导出
    </button>
    <div class="md-reader-export-menu">
      <button class="md-reader-export-option" data-format="html">
        <span class="md-reader-export-option-icon">🌐</span> HTML
      </button>
      <button class="md-reader-export-option" data-format="pdf">
        <span class="md-reader-export-option-icon">📄</span> PDF
      </button>
      <button class="md-reader-export-option" data-format="word">
        <span class="md-reader-export-option-icon">📝</span> Word
      </button>
    </div>
  `;

  // Toggle dropdown
  const btn = wrapper.querySelector('.md-reader-export-btn');
  const menu = wrapper.querySelector('.md-reader-export-menu');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('md-reader-export-menu-open');
  });

  // Close on outside click
  document.addEventListener('click', () => {
    menu.classList.remove('md-reader-export-menu-open');
  });

  // Handle format selection
  wrapper.querySelectorAll('.md-reader-export-option').forEach((opt) => {
    opt.addEventListener('click', async () => {
      menu.classList.remove('md-reader-export-menu-open');
      const format = opt.dataset.format;
      if (format === 'html') await exportHtml(container, title, toc);
      else if (format === 'pdf') exportPdf();
      else if (format === 'word') await exportWord(container, title);
    });
  });

  return wrapper;
}
