/**
 * Generate a Table of Contents from rendered HTML
 * Returns an array of { id, text, level } objects
 */
export function generateToc(html) {
  const toc = [];
  // Match h1-h6 tags and extract text content
  const headingRegex = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  let match;
  let index = 0;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const idMatch = match[2].match(/id="([^"]*)"/);
    const rawText = match[3].replace(/<[^>]+>/g, '').trim();
    const id = idMatch ? idMatch[1] : slugify(rawText) + '-' + index;
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

/**
 * Build a nested tree from a flat TOC list.
 * The lowest heading level present in the document acts as the root level
 * (h1 normally; falls back to h2/h3 when the document has no h1).
 * Each item becomes the child of the nearest preceding item with a smaller level.
 */
export function buildTree(items) {
  const roots = [];
  if (!items || items.length === 0) return roots;

  const minLevel = Math.min(...items.map((item) => item.level));
  const stack = [{ level: minLevel - 1, children: roots }];

  for (const item of items) {
    const node = { id: item.id, text: item.text, level: item.level, children: [] };
    while (stack[stack.length - 1].level >= node.level) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  return roots;
}

// Sidebar auto-collapses to the top level when the document has more items than this
const AUTO_COLLAPSE_THRESHOLD = 30;

// Chevron icon — CSS rotates it to point down (expanded) or right (collapsed)
const CHEVRON_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M9.78 12.78a.75.75 0 01-1.06 0L4.47 8.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L6.06 8l3.72 3.72a.75.75 0 010 1.06z"/></svg>`;

// Double chevron icon (Octicons chevrons-up) for the "collapse to top level"
// action — CSS rotates it 180deg when active (chevrons-down = expand all)
const COLLAPSE_SVG = `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M7.78 12.78a.75.75 0 01-1.06 0L2.47 8.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.06 8l3.72 3.72a.75.75 0 010 1.06zm4 0a.75.75 0 01-1.06 0L6.47 8.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L8.06 8l3.72 3.72a.75.75 0 010 1.06z"/></svg>`;

function renderTree(nodes) {
  if (!nodes || nodes.length === 0) return '';
  return `<ul class="md-reader-toc-children">${nodes.map(renderNode).join('')}</ul>`;
}

function renderNode(node) {
  const hasChildren = node.children.length > 0;
  return `
    <li class="md-reader-toc-node${hasChildren ? '' : ' md-reader-toc-leaf'}" data-id="${node.id}">
      <div class="md-reader-toc-row">
        ${hasChildren
          ? `<button class="md-reader-toc-caret" title="折叠">${CHEVRON_SVG}</button>`
          : '<span class="md-reader-toc-caret-spacer"></span>'}
        <a href="#${node.id}">${node.text}</a>
      </div>
      ${hasChildren ? renderTree(node.children) : ''}
    </li>`;
}

/**
 * Create a left-side TOC sidebar with a hierarchical tree.
 * Features:
 *  - per-node collapse/expand, persisted per document (chrome.storage.local)
 *  - global "collapse to top level" button (session-only, keeps active branch open)
 *  - auto-collapse to top level for documents with more than AUTO_COLLAPSE_THRESHOLD items
 *  - scroll-spy that re-opens the branch containing the active heading
 */
export function createTocSidebar(tocItems) {
  if (!tocItems || tocItems.length === 0) return null;

  const tree = buildTree(tocItems);

  const sidebar = document.createElement('div');
  sidebar.className = 'md-reader-toc-sidebar';
  sidebar.innerHTML = `
    <div class="md-reader-toc-header">
      <span class="md-reader-toc-title">目录</span>
      <div class="md-reader-toc-actions">
        <button class="md-reader-toc-collapse-btn" title="折叠到一级">${COLLAPSE_SVG}</button>
        <button class="md-reader-toc-toggle" title="收起目录">${CHEVRON_SVG}</button>
      </div>
    </div>
    <nav class="md-reader-toc-nav">${renderTree(tree)}</nav>
  `;

  const nav = sidebar.querySelector('.md-reader-toc-nav');
  const collapseBtn = sidebar.querySelector('.md-reader-toc-collapse-btn');
  const toggleBtn = sidebar.querySelector('.md-reader-toc-toggle');

  // Hide the collapse button when there is nothing to collapse
  if (!nav.querySelector('.md-reader-toc-caret')) collapseBtn.style.display = 'none';

  // ---- Collapse state, persisted per document ----
  const collapsedIds = new Set();
  let saveTimer = null;

  function docKey() {
    return 'tocState:' + window.location.href.split('#')[0];
  }

  function loadCollapsedIds() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(docKey()).then((result) => {
          const saved = result && result[docKey()];
          if (saved && Array.isArray(saved.collapsed)) {
            saved.collapsed.forEach((id) => collapsedIds.add(id));
          }
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        chrome.storage.local.set({ [docKey()]: { collapsed: [...collapsedIds] } }).catch(() => {});
      } catch {
        // storage unavailable — state just isn't remembered
      }
    }, 300);
  }

  // persist=false keeps the change session-only (global collapse / auto-expand)
  function setCollapsed(li, collapsed, persist) {
    li.classList.toggle('collapsed', collapsed);
    if (!persist) return;
    const id = li.dataset.id;
    if (collapsed) collapsedIds.add(id);
    else collapsedIds.delete(id);
    scheduleSave();
  }

  function applyPersistedState() {
    collapsedIds.forEach((id) => {
      const li = nav.querySelector(`.md-reader-toc-node[data-id="${CSS.escape(id)}"]`);
      if (li && li.querySelector(':scope > .md-reader-toc-children')) {
        li.classList.add('collapsed');
      }
    });
  }

  // Per-node caret toggling
  nav.querySelectorAll('.md-reader-toc-caret').forEach((btn) => {
    btn.addEventListener('click', () => {
      const li = btn.closest('.md-reader-toc-node');
      const collapsing = !li.classList.contains('collapsed');
      setCollapsed(li, collapsing, true);
      btn.title = collapsing ? '展开' : '折叠';
    });
  });

  // Whole-sidebar collapse/expand — all animation handled by CSS transitions
  toggleBtn.addEventListener('click', () => {
    const collapsed = sidebar.classList.toggle('md-reader-toc-collapsed');
    toggleBtn.title = collapsed ? '展开目录' : '收起目录';
  });

  // Global "collapse to top level / expand all" — session-only.
  // Collapses every branch except the path to the active heading, recursively,
  // so a single-h1 document still folds down to its first level.
  let topLevelCollapsed = false;

  function foldExceptActive(nodes) {
    [...nodes].forEach((li) => {
      const children = li.querySelector(':scope > .md-reader-toc-children');
      if (!children) return; // leaf
      if (activeLink && li.contains(activeLink)) {
        setCollapsed(li, false, false);
        foldExceptActive(children.children);
      } else {
        setCollapsed(li, true, false);
      }
    });
  }

  collapseBtn.addEventListener('click', () => {
    topLevelCollapsed = !topLevelCollapsed;
    collapseBtn.classList.toggle('active', topLevelCollapsed);
    collapseBtn.title = topLevelCollapsed ? '全部展开' : '折叠到一级';
    if (topLevelCollapsed) {
      foldExceptActive(nav.querySelector(':scope > .md-reader-toc-children').children);
    } else {
      nav.querySelectorAll('.md-reader-toc-node').forEach((li) => {
        setCollapsed(li, false, false);
      });
    }
  });

  // ---- Scroll-spy: single-active-item highlight ----
  const ACTIVE_OFFSET = 100;
  let headings = [];
  let activeLink = null;
  let rafId = null;
  let userClicking = false; // suppress scroll-spy during programmatic scroll

  // Session-only: open every collapsed ancestor so the active heading stays visible
  function expandAncestors(li) {
    let cur = li;
    while (cur) {
      cur.classList.remove('collapsed');
      cur = cur.parentElement ? cur.parentElement.closest('.md-reader-toc-node') : null;
    }
  }

  function setActive(link) {
    if (link === activeLink) return;
    if (activeLink) activeLink.parentElement.classList.remove('md-reader-toc-active');
    activeLink = link;
    if (!link) return;
    link.parentElement.classList.add('md-reader-toc-active');

    const li = link.closest('.md-reader-toc-node');
    if (li) expandAncestors(li);

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
    let current = headings[0];
    for (const h of headings) {
      if (h.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) {
        current = h;
      } else {
        break;
      }
    }

    // Near page bottom → force last heading
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
  sidebar.querySelectorAll('.md-reader-toc-nav a').forEach((link) => {
    link.addEventListener('click', (e) => {
      const id = link.getAttribute('href').slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      userClicking = true;
      setActive(link);
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      clearTimeout(sidebar._clickTimer);
      sidebar._clickTimer = setTimeout(() => {
        userClicking = false;
        updateActive();
      }, 700);
    });
  });

  sidebar._observeHeadings = async (container) => {
    headings = tocItems
      .map((item) => container.querySelector(`#${CSS.escape(item.id)}`))
      .filter(Boolean);

    // Listen on window — works for both normal body scroll and the wrapper-shifted layout
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    updateActive();

    // Restore per-document collapse state, then re-open the active branch
    await loadCollapsedIds();
    applyPersistedState();
    if (activeLink) {
      const li = activeLink.closest('.md-reader-toc-node');
      if (li) expandAncestors(li);
    }

    // Very long documents auto-collapse to the top level (session-only)
    if (tocItems.length > AUTO_COLLAPSE_THRESHOLD && nav.querySelector('.md-reader-toc-children')) {
      foldExceptActive(nav.querySelector(':scope > .md-reader-toc-children').children);
    }
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
