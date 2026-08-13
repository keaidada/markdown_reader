import { describe, it, expect } from 'vitest';
import { buildTree, generateToc, injectHeadingIds } from './toc';

describe('buildTree', () => {
  it('returns an empty array for empty input', () => {
    expect(buildTree([])).toEqual([]);
    expect(buildTree(null)).toEqual([]);
  });

  it('nests headings under the nearest preceding heading of smaller level', () => {
    const tree = buildTree([
      { id: 'a', text: 'A', level: 1 },
      { id: 'b', text: 'B', level: 2 },
      { id: 'c', text: 'C', level: 3 },
      { id: 'd', text: 'D', level: 2 },
    ]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe('a');
    expect(tree[0].children.map((n) => n.id)).toEqual(['b', 'd']);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(['c']);
  });

  it('treats the lowest level in the document as the root level (h1 fallback)', () => {
    const tree = buildTree([
      { id: 'a', text: 'A', level: 2 },
      { id: 'b', text: 'B', level: 3 },
      { id: 'c', text: 'C', level: 3 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['b', 'c']);
  });

  it('supports level skips (h1 followed directly by h3)', () => {
    const tree = buildTree([
      { id: 'a', text: 'A', level: 1 },
      { id: 'b', text: 'B', level: 3 },
    ]);
    expect(tree[0].children.map((n) => n.id)).toEqual(['b']);
  });

  it('supports multiple root nodes', () => {
    const tree = buildTree([
      { id: 'a', text: 'A', level: 1 },
      { id: 'b', text: 'B', level: 1 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('keeps early deep headings as roots when a shallower heading appears later', () => {
    const tree = buildTree([
      { id: 'a', text: 'A', level: 3 },
      { id: 'b', text: 'B', level: 2 },
    ]);
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('generateToc', () => {
  it('extracts headings with existing and generated ids', () => {
    const toc = generateToc('<h1 id="title">Title</h1><h2>Sub <em>one</em></h2><h3 id="deep">Deep</h3>');
    expect(toc).toEqual([
      { id: 'title', text: 'Title', level: 1 },
      { id: 'sub-one-1', text: 'Sub one', level: 2 },
      { id: 'deep', text: 'Deep', level: 3 },
    ]);
  });
});

describe('injectHeadingIds', () => {
  it('injects unique ids into headings without one', () => {
    const html = injectHeadingIds('<h1>Foo Bar</h1><h2>Foo Bar</h2>');
    expect(html).toContain('<h1 id="foo-bar-0">Foo Bar</h1>');
    expect(html).toContain('<h2 id="foo-bar-1">Foo Bar</h2>');
  });

  it('keeps existing heading ids', () => {
    const html = injectHeadingIds('<h2 id="keep">Keep</h2>');
    expect(html).toContain('<h2 id="keep">Keep</h2>');
  });
});
