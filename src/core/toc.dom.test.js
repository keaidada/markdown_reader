import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTocSidebar } from './toc';

// Minimal CSS.escape shim for happy-dom
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  globalThis.CSS = { escape: (s) => s.replace(/"/g, '\\"') };
}

function mockChromeStorage(store = {}) {
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (key) => ({ [key]: store[key] })),
        set: vi.fn(async (obj) => {
          Object.assign(store, obj);
        }),
      },
    },
  };
  return store;
}

const ITEMS = [
  { id: 'intro', text: 'Intro', level: 1 },
  { id: 'setup', text: 'Setup', level: 1 },
  { id: 'install', text: 'Install', level: 2 },
  { id: 'config', text: 'Config', level: 2 },
  { id: 'usage', text: 'Usage', level: 1 },
];

function buildSidebar(store) {
  mockChromeStorage(store);
  const sidebar = createTocSidebar(ITEMS);
  document.body.appendChild(sidebar);
  return sidebar;
}

function topNodes(sidebar) {
  return [...sidebar.querySelectorAll(':scope > .md-reader-toc-nav > .md-reader-toc-children > .md-reader-toc-node')];
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('createTocSidebar', () => {
  it('renders a hierarchical tree', () => {
    const sidebar = buildSidebar({});
    const top = topNodes(sidebar);
    expect(top.map((li) => li.dataset.id)).toEqual(['intro', 'setup', 'usage']);

    const setupChildren = top[1].querySelectorAll(':scope > .md-reader-toc-children > .md-reader-toc-node');
    expect([...setupChildren].map((li) => li.dataset.id)).toEqual(['install', 'config']);
    expect(top[0].querySelector('.md-reader-toc-caret')).toBeNull();
    expect(top[1].querySelector('.md-reader-toc-caret')).not.toBeNull();
  });

  it('toggles a node with the caret and persists the state', async () => {
    vi.useFakeTimers();
    const store = {};
    const sidebar = buildSidebar(store);
    const setup = topNodes(sidebar)[1];
    const caret = setup.querySelector('.md-reader-toc-caret');

    caret.click();
    expect(setup.classList.contains('collapsed')).toBe(true);

    // Flush the 300ms debounce and check the persisted payload
    vi.advanceTimersByTime(350);
    expect(chrome.storage.local.set).toHaveBeenCalled();
    expect(store['tocState:http://localhost:3000/']).toEqual({ collapsed: ['setup'] });

    // Second click expands again and removes from persisted state
    caret.click();
    expect(setup.classList.contains('collapsed')).toBe(false);
    vi.advanceTimersByTime(350);
    expect(store['tocState:http://localhost:3000/']).toEqual({ collapsed: [] });
  });

  it('applies persisted collapsed state on observe', async () => {
    const store = { 'tocState:http://localhost:3000/': { collapsed: ['setup'] } };
    const sidebar = buildSidebar(store);

    // Simulate a realistic page layout: tall document, first heading active
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 5000, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });

    const container = document.createElement('div');
    ITEMS.forEach((item, i) => {
      const h = document.createElement('h' + item.level);
      h.id = item.id;
      h.textContent = item.text;
      h.getBoundingClientRect = () => ({
        top: 200 + i * 400, bottom: 230 + i * 400, height: 30,
        left: 0, right: 0, width: 0, x: 0, y: 0, toJSON() {},
      });
      container.appendChild(h);
    });
    document.body.appendChild(container);

    await sidebar._observeHeadings(container);
    const setup = topNodes(sidebar)[1];
    expect(setup.classList.contains('collapsed')).toBe(true);
  });

  it('collapses all top-level nodes except the active branch, then expands all', async () => {
    const sidebar = buildSidebar({});
    const btn = sidebar.querySelector('.md-reader-toc-collapse-btn');
    const setup = topNodes(sidebar)[1];

    // Collapse the "setup" branch manually, then collapse to top level
    setup.querySelector('.md-reader-toc-caret').click();
    btn.click();

    const [intro, setup2, usage] = topNodes(sidebar);
    expect(intro.classList.contains('collapsed')).toBe(true);
    expect(usage.classList.contains('collapsed')).toBe(true);
    // setup was already collapsed; it stays collapsed
    expect(setup2.classList.contains('collapsed')).toBe(true);
    expect(btn.classList.contains('active')).toBe(true);

    // Second click restores everything
    btn.click();
    topNodes(sidebar).forEach((li) => {
      expect(li.classList.contains('collapsed')).toBe(false);
    });
    expect(btn.classList.contains('active')).toBe(false);
  });

  it('hides the collapse button when every node is a leaf', () => {
    const sidebar = createTocSidebar([{ id: 'a', text: 'A', level: 1 }]);
    expect(sidebar.querySelector('.md-reader-toc-collapse-btn').style.display).toBe('none');
  });
});
