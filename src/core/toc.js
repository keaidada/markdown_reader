/**
 * Generate a Table of Contents from rendered HTML
 * Returns an array of { id, text, level } objects
 */
export function generateToc(html) {
  const toc = [];
  // Match h1-h6 tags and extract text content
  const headingRegex = /<h([1-6])[^>]*(?:id="([^"]*)")?[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match;
  let index = 0;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const existingId = match[2];
    const rawText = match[3].replace(/<[^>]+>/g, '').trim();
    const id = existingId || slugify(rawText) + '-' + index;
    toc.push({ id, text: rawText, level });
    index++;
  }

  return toc;
}

/**
 * Inject IDs into heading tags in HTML for TOC linking
 */
export function injectHeadingIds(html) {
  let index = 0;
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level, attrs, content) => {
    if (attrs.includes('id="')) return match;
    const text = content.replace(/<[^>]+>/g, '').trim();
    const id = slugify(text) + '-' + index;
    index++;
    return `<h${level}${attrs} id="${id}">${content}</h${level}>`;
  });
}

// SVG chevron icon for the toggle button
const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.78 12.78a.75.75 0 01-1.06 0L4.47 8.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L6.06 8l3.72 3.72a.75.75 0 010 1.06z"/></svg>`;

/**
 * Create a left-side TOC sidebar element with smooth collapse/expand
 */
export function createTocSidebar(tocItems) {
  if (!tocItems || tocItems.length === 0) return null;

  const sidebar = document.createElement('div');
  sidebar.className = 'md-reader-toc-sidebar';
  sidebar.innerHTML = `
    <div class="md-reader-toc-header">
      <span class="md-reader-toc-title">目录</span>
      <button class="md-reader-toc-toggle" title="收起目录">${CHEVRON_SVG}</button>
    </div>
    <nav class="md-reader-toc-nav">
      <ul>
        ${tocItems.map(item => `
          <li class="md-reader-toc-item md-reader-toc-level-${item.level}">
            <a href="#${item.id}">${item.text}</a>
          </li>
        `).join('')}
      </ul>
    </nav>
  `;

  // Toggle collapse/expand — all animation handled by CSS transitions
  const toggleBtn = sidebar.querySelector('.md-reader-toc-toggle');

  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('md-reader-toc-collapsed');
    toggleBtn.title = collapsed ? '展开目录' : '收起目录';
  });

  // Active heading highlight on scroll
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = sidebar.querySelector(`a[href="#${entry.target.id}"]`);
        if (link) {
          link.parentElement.classList.toggle('md-reader-toc-active', entry.isIntersecting);
        }
      });
    },
    { rootMargin: '-20% 0px -80% 0px' }
  );

  sidebar._observeHeadings = (container) => {
    tocItems.forEach((item) => {
      const heading = container.querySelector(`#${CSS.escape(item.id)}`);
      if (heading) observer.observe(heading);
    });
  };

  return sidebar;
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}
