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

  // ---- Scroll-spy: single-active-item highlight ----
  // Offset from viewport top — the "reading line". Heading is considered
  // active once it crosses this line from below.
  const ACTIVE_OFFSET = 100;
  const nav = sidebar.querySelector('.md-reader-toc-nav');
  let headings = [];
  let activeLink = null;
  let rafId = null;
  let userClicking = false; // suppress scroll-spy during programmatic scroll

  function setActive(link) {
    if (link === activeLink) return;
    if (activeLink) activeLink.parentElement.classList.remove('md-reader-toc-active');
    activeLink = link;
    if (!link) return;
    link.parentElement.classList.add('md-reader-toc-active');

    // Keep the active item in view inside the sidebar nav
    const linkRect = link.getBoundingClientRect();
    const navRect = nav.getBoundingClientRect();
    if (linkRect.top < navRect.top + 40 || linkRect.bottom > navRect.bottom - 40) {
      link.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function updateActive() {
    rafId = null;
    if (userClicking) return;
    if (headings.length === 0) return;

    // Pick the LAST heading whose top is above the reading line.
    // If none (we're above the first heading), fall back to the first.
    let current = headings[0];
    for (const h of headings) {
      if (h.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) {
        current = h;
      } else {
        break;
      }
    }

    // Near page bottom → force last heading (so the final section highlights
    // even if it's too short to cross the reading line).
    const nearBottom =
      window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    if (nearBottom) current = headings[headings.length - 1];

    const link = sidebar.querySelector(`a[href="#${CSS.escape(current.id)}"]`);
    if (link) setActive(link);
  }

  function onScroll() {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(updateActive);
  }

  // Clicking a TOC link: smooth-scroll + lock highlight onto clicked item
  // until the scroll settles, so spy logic doesn't fight the animation.
  sidebar.querySelectorAll('.md-reader-toc-nav a').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      userClicking = true;
      setActive(link);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // Release the lock after the smooth scroll animation completes (~600ms)
      clearTimeout(sidebar._clickTimer);
      sidebar._clickTimer = setTimeout(() => {
        userClicking = false;
        updateActive();
      }, 700);
    });
  });

  sidebar._observeHeadings = (container) => {
    headings = tocItems
      .map((item) => container.querySelector(`#${CSS.escape(item.id)}`))
      .filter(Boolean);

    // Listen on window — works for both normal body scroll and the wrapper-shifted layout
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    // Initial pass
    updateActive();
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
