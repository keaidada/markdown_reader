/**
 * Export rendered markdown to various formats (HTML, PDF, Word)
 */

/**
 * Get the full styled HTML content for export
 */
function getStyledHtml(container, title) {
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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
body { max-width: 800px; margin: 40px auto; padding: 0 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
${styles.join('\n')}
</style>
</head>
<body class="markdown-body">
${container.innerHTML}
</body>
</html>`;
}

/**
 * Export as HTML file
 */
export function exportHtml(container, title) {
  const html = getStyledHtml(container, title);
  downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${title}.html`);
}

/**
 * Export as PDF via print dialog
 */
export function exportPdf() {
  window.print();
}

/**
 * Export as Word (.doc) using HTML that Word can open
 */
export function exportWord(container, title) {
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
<body>${container.innerHTML}</body></html>`;

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
export function createExportButton(container, title) {
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
    opt.addEventListener('click', () => {
      menu.classList.remove('md-reader-export-menu-open');
      const format = opt.dataset.format;
      if (format === 'html') exportHtml(container, title);
      else if (format === 'pdf') exportPdf();
      else if (format === 'word') exportWord(container, title);
    });
  });

  return wrapper;
}
