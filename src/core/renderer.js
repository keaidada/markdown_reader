import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import katex from 'katex';
import { generateToc } from './toc';

/**
 * Check if markdown contains math expressions
 */
function hasMath(markdown) {
  return /\$\$.+?\$\$/s.test(markdown) || /(?<!\$)\$(?!\$).+?(?<!\$)\$(?!\$)/.test(markdown);
}

/**
 * Create a configured Marked instance with highlight.js integration
 */
function createMarked() {
  const marked = new Marked(
    markedHighlight({
      langPrefix: 'hljs language-',
      highlight(code, lang) {
        // Don't highlight mermaid — we want the raw source for mermaid.run()
        if (lang === 'mermaid') return code;
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
    })
  );

  // Custom renderer for code blocks with copy button
  // `text` from markedHighlight is already highlighted HTML
  const renderer = {
    code({ text, lang, raw }) {
      const language = lang || 'plaintext';

      // Mermaid: render the raw source, not the highlighted HTML.
      // We emit <pre class="mermaid"> with the UNTOUCHED source so
      // mermaid.run() can parse it; highlight.js output would break the parser.
      if (language === 'mermaid') {
        // `raw` from marked is the full ```mermaid ... ``` block. Strip fences.
        // Fallback: decode the highlighted HTML if raw isn't available.
        let source;
        if (typeof raw === 'string') {
          source = raw.replace(/^```[^\n]*\n?/, '').replace(/\n?```\s*$/, '');
        } else {
          source = text
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        }
        source = sanitizeMermaidSource(source);
        return `<div class="md-reader-mermaid-wrapper"><pre class="mermaid md-reader-mermaid">${escapeHtml(source)}</pre></div>`;
      }

      // Strip HTML tags from text to get raw code for the copy button
      const rawCode = text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

      return `<div class="md-reader-code-block">
        <div class="md-reader-code-header">
          <span class="md-reader-code-lang">${language}</span>
          <button class="md-reader-copy-btn" data-code="${escapeHtml(rawCode)}">Copy</button>
        </div>
        <pre><code class="hljs language-${language}">${text}</code></pre>
      </div>`;
    },
  };

  marked.use({ renderer, breaks: true });
  marked.setOptions({ gfm: true });
  return marked;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// sequenceDiagram 的保留关键字。若 participant/actor 的 id 命中这些词
// （大小写不敏感），mermaid 解析器会把它当关键字用，报 Syntax error。
// 见 https://mermaid.js.org/syntax/sequenceDiagram.html
const MERMAID_SEQ_RESERVED = new Set([
  'opt', 'alt', 'else', 'loop', 'par', 'and', 'rect', 'critical', 'option',
  'break', 'end', 'note', 'activate', 'deactivate', 'autonumber',
  'participant', 'actor', 'box', 'link', 'links', 'properties', 'details',
]);

/**
 * Rename participant/actor aliases in sequenceDiagram that collide with
 * mermaid reserved keywords. Only touches sequenceDiagram blocks; other
 * diagram types are returned untouched to avoid false positives.
 */
function sanitizeMermaidSource(source) {
  const firstNonEmpty = source.split('\n').find((l) => l.trim().length > 0) || '';
  if (!/^\s*sequenceDiagram\b/.test(firstNonEmpty)) return source;

  const rename = new Map();
  const participantRe = /^\s*(?:participant|actor)\s+([^\s]+?)(?:\s+as\s+.*)?\s*$/i;
  for (const line of source.split('\n')) {
    const m = line.match(participantRe);
    if (!m) continue;
    const id = m[1];
    if (MERMAID_SEQ_RESERVED.has(id.toLowerCase()) && !rename.has(id)) {
      let safe = id + '_';
      while (MERMAID_SEQ_RESERVED.has(safe.toLowerCase())) safe += '_';
      rename.set(id, safe);
    }
  }
  if (rename.size === 0) return source;

  let out = source;
  for (const [from, to] of rename) {
    const re = new RegExp(`(^|[^\\w])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^\\w]|$)`, 'g');
    out = out.replace(re, (_m, pre) => pre + to);
  }
  return out;
}

/**
 * Process math expressions in HTML string using KaTeX,
 * skipping content inside <pre>, <code> tags, and any HTML tag attributes.
 *
 * We split the HTML into alternating "process" and "skip" segments. Skip
 * segments include full <pre>...</pre> and <code>...</code> blocks (so math
 * syntax inside code isn't interpreted) AND every individual HTML tag
 * (anything from `<` to the next `>`). Skipping tags is important because the
 * Copy button we emit for fenced code blocks stores the raw source in a
 * `data-code="..."` attribute; without this, a SQL block containing `$$...$$`
 * (e.g. PostgreSQL dollar-quoted strings) would have its attribute value
 * rewritten into KaTeX HTML — the injected `"` character breaks out of the
 * attribute and leaks markup into the page.
 */
function processMath(html) {
  // Split order matters: the <pre> and <code> alternatives consume their full
  // content first, so the generic <[^>]*> tag pattern only kicks in on tags
  // outside those regions.
  const parts = html.split(/(<pre[\s>][\s\S]*?<\/pre>|<code[\s>][\s\S]*?<\/code>|<[^>]*>)/gi);

  for (let i = 0; i < parts.length; i++) {
    // Odd indices are code/pre blocks — skip them
    if (i % 2 === 1) continue;

    let segment = parts[i];

    // Block math: $$...$$
    segment = segment.replace(/\$\$([\s\S]+?)\$\$/g, (match, tex) => {
      try {
        return katex.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
      } catch {
        return match;
      }
    });

    // Inline math: $...$  (require non-space after opening and before closing $)
    segment = segment.replace(/(?<!\$)\$(?!\$)(?!\s)(.+?)(?<!\s)(?<!\$)\$(?!\$)/g, (match, tex) => {
      // Skip if it looks like a shell variable or currency
      if (/^[A-Z_][A-Z_0-9]*$/i.test(tex) || /^\d/.test(tex)) return match;
      try {
        return katex.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
      } catch {
        return match;
      }
    });

    parts[i] = segment;
  }

  return parts.join('');
}

/**
 * Parse YAML front matter from the start of a markdown string.
 * Returns { body, frontMatter } where frontMatter is a key→value map
 * (simple string values only; no nested YAML parsing needed here).
 */
export function parseFrontMatter(markdown) {
  const match = markdown.match(/^\uFEFF?\s*---\r?\n([\s\S]*?)\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: markdown, frontMatter: {} };

  const body = match[2];
  const frontMatter = {};
  // Parse simple "key: value" lines (skip multi-line block scalars)
  let inBlock = false;
  for (const line of match[1].split('\n')) {
    if (inBlock) {
      if (/^\S/.test(line)) inBlock = false; else continue;
    }
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!kv) continue;
    const val = kv[2].trim();
    if (val === '|' || val === '>') { inBlock = true; continue; }
    frontMatter[kv[1]] = val.replace(/^['"]|['"]$/g, '');
  }
  return { body, frontMatter };
}

/**
 * Strip YAML front matter (--- ... ---) from the start of a markdown string.
 * GitHub and Jekyll use this; we should not render it as content.
 */
function stripFrontMatter(markdown) {
  return parseFrontMatter(markdown).body;
}

/**
 * Pre-process markdown to escape bare <word> patterns that aren't real HTML
 * tags (so `<uuid>` in prose renders as literal text instead of being swallowed
 * as an unknown HTML element). marked already escapes `<` / `>` inside inline
 * code and fenced code blocks correctly on its own — we intentionally do NOT
 * touch those regions, because pre-escaping them would double-escape through
 * marked's own code-content escaping (turning `<uuid>` into
 * `&amp;lt;uuid&amp;gt;`, which renders as the literal string `&lt;uuid&gt;`).
 *
 * Also fixes a CommonMark / CJK interop bug with bold spans: patterns like
 * `是**"一套"**，你` don't render as <strong> because CommonMark's
 * left-flanking rule fails when a CJK letter sits right before `**` that is
 * followed by ASCII/Unicode punctuation (the inner char). We inject a
 * zero-width space (U+200B) between the marker and the inner punct on the
 * failing side so the flanking rule passes. Symmetrically for the closing
 * side when a CJK letter follows `**` preceded by punctuation.
 */
function preprocessMarkdown(markdown) {
  // Note: front matter is already stripped by renderMarkdown before calling here.

  // Escape bare <word> that aren't known HTML tags (outside code blocks)
  // Known self-closing or common HTML tags to preserve
  const htmlTags = /^(a|abbr|address|article|aside|audio|b|bdi|bdo|blockquote|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|math|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)$/i;

  // CJK letter ranges: CJK Unified, Extension A, Compatibility Ideographs,
  // Hiragana + Katakana, and Hangul syllables.
  const cjkCharRe = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  const punctStartRe = /^[\p{P}\p{S}]/u;
  const punctEndRe = /[\p{P}\p{S}]$/u;
  // Match a non-nested **...** or __...__ span. We don't allow `*` or `_` in
  // the inner content (which would indicate nesting or a literal marker);
  // such rare cases fall back to CommonMark's default behavior.
  const boldSpanRe = /(\*\*|__)(?!\s)([^*_\n]+?)(?<!\s)\1/gu;
  const ZWSP = '\u200b';

  const fixCjkBold = (text) =>
    text.replace(boldSpanRe, (match, marker, inner, offset, full) => {
      const leftCtx = offset > 0 ? full[offset - 1] : '';
      const rightCtx = full[offset + match.length] || '';
      const brokenOpen = cjkCharRe.test(leftCtx) && punctStartRe.test(inner);
      const brokenClose = cjkCharRe.test(rightCtx) && punctEndRe.test(inner);
      if (!brokenOpen && !brokenClose) return match;
      return `${marker}${brokenOpen ? ZWSP : ''}${inner}${brokenClose ? ZWSP : ''}${marker}`;
    });

  // Process line by line, skip fenced code blocks. Within each prose line,
  // also skip inline-code spans (`...`) so marked's own escaping applies there.
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Split the line on inline-code spans; even indices are prose, odd indices
    // are the backtick-wrapped code (kept verbatim so marked handles it).
    const parts = lines[i].split(/(`[^`\n]+`)/g);
    const bareTagRe = /<([a-zA-Z\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]*)>/g;
    for (let j = 0; j < parts.length; j++) {
      if (j % 2 === 1) continue; // inline-code span - leave for marked
      let segment = parts[j].replace(bareTagRe, (match, tag) => {
        if (htmlTags.test(tag)) return match;
        return '&lt;' + tag + '&gt;';
      });
      segment = fixCjkBold(segment);
      parts[j] = segment;
    }
    lines[i] = parts.join('');
  }
  return lines.join('\n');
}

/**
 * Main render function: markdown string → rendered HTML + TOC data
 */
export async function renderMarkdown(markdown) {
  const marked = createMarked();
  // Extract front matter before preprocessing
  const { body, frontMatter } = parseFrontMatter(markdown);
  markdown = preprocessMarkdown(body);
  let html = marked.parse(markdown);

  // Process math if detected
  if (hasMath(markdown)) {
    html = processMath(html);
  }

  // Generate TOC from rendered HTML
  const toc = generateToc(html);

  return { html, toc, frontMatter };
}

/**
 * Attach copy button event listeners to a container
 */
export function attachCopyHandlers(container) {
  container.querySelectorAll('.md-reader-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.getAttribute('data-code')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"');
      try {
        await navigator.clipboard.writeText(code);
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      } catch {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Mermaid integration
// ---------------------------------------------------------------------------

let _mermaidInitialized = false;

/**
 * Detect whether the page is on a dark background.
 * Returns true if body's effective background is dark.
 */
function isDarkBackground() {
  try {
    const bg = getComputedStyle(document.body).backgroundColor || '';
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    // Perceptual luminance
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    return luma < 128;
  } catch {
    return false;
  }
}

/**
 * Render all <pre class="mermaid"> blocks inside the given container.
 * Safe to call multiple times — already-rendered blocks are skipped.
 */
export async function initMermaid(container) {
  const blocks = container.querySelectorAll('pre.mermaid:not([data-processed="true"])');
  if (blocks.length === 0) return;

  // Dynamic import so the mermaid bundle is only loaded when needed
  const mermaidModule = await import('mermaid');
  const mermaid = mermaidModule.default || mermaidModule;

  if (!_mermaidInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: isDarkBackground() ? 'dark' : 'default',
      securityLevel: 'loose', // allow links; safe in an extension context
      fontFamily: 'inherit',
      flowchart: { htmlLabels: true, useMaxWidth: true },
      sequence: { useMaxWidth: true },
      gantt: { useMaxWidth: true },
    });
    _mermaidInitialized = true;
  }

  try {
    await mermaid.run({ nodes: blocks });
    // Normalize sizes so every diagram fills the container width uniformly,
    // then attach fullscreen controls.
    blocks.forEach((node) => {
      normalizeMermaidSvg(node);
      attachMermaidFullscreen(node);
    });
  } catch (err) {
    console.error('[Markdown Reader] Mermaid render failed:', err);
    // Fall back: wrap the source in a visible error panel so users know
    blocks.forEach((node) => {
      if (node.dataset.processed !== 'true') {
        node.classList.add('md-reader-mermaid-error');
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Mermaid fullscreen viewer with pan + zoom
// ---------------------------------------------------------------------------

let _fsCloneCounter = 0;

/**
 * Rewrite every id in an SVG subtree (and every reference to those ids) so a
 * cloned copy doesn't collide with the original. Mermaid-generated SVGs rely
 * on internal ids for markers, clip-paths, gradients, and scoped CSS
 * selectors; without this, the clone renders as an empty silhouette.
 */
function uniquifySvgIds(root) {
  const prefix = `mdrfs${++_fsCloneCounter}_`;
  const idMap = new Map();

  // 1. Collect + rename every id on the subtree (including root)
  if (root.id) {
    const newId = prefix + root.id;
    idMap.set(root.id, newId);
    root.id = newId;
  }
  root.querySelectorAll('[id]').forEach((el) => {
    const oldId = el.id;
    if (!oldId || idMap.has(oldId)) return;
    const newId = prefix + oldId;
    idMap.set(oldId, newId);
    el.id = newId;
  });

  if (idMap.size === 0) return;

  const escapeForRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const oldIds = Array.from(idMap.keys()).sort((a, b) => b.length - a.length);
  const idAlt = oldIds.map(escapeForRegex).join('|');
  const urlRegex = new RegExp(`url\\(\\s*(['"]?)#(${idAlt})\\1\\s*\\)`, 'g');
  const hrefRegex = new RegExp(`^#(${idAlt})$`);
  // CSS: `#oldId` as a complete token (not followed by an id-char)
  const cssRegex = new RegExp(`#(${idAlt})(?![A-Za-z0-9_-])`, 'g');
  const remap = (name) => idMap.get(name) || name;

  // 2. Walk every element, rewrite attributes that can reference ids
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node = walker.currentNode;
  while (node) {
    // href / xlink:href
    const href = node.getAttribute && node.getAttribute('href');
    if (href) {
      const m = href.match(hrefRegex);
      if (m) node.setAttribute('href', '#' + remap(m[1]));
    }
    const xhref = node.getAttributeNS && node.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
    if (xhref) {
      const m = xhref.match(hrefRegex);
      if (m) node.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + remap(m[1]));
    }

    // url(#xxx) in any attribute value
    if (node.attributes) {
      for (let i = 0; i < node.attributes.length; i++) {
        const attr = node.attributes[i];
        const val = attr.value;
        if (val && val.includes('url(')) {
          const next = val.replace(urlRegex, (_, q, name) => `url(${q}#${remap(name)}${q})`);
          if (next !== val) attr.value = next;
        }
      }
    }

    // <style> blocks: rewrite both `url(#id)` and CSS id selectors `#id`
    if (node.tagName && node.tagName.toLowerCase() === 'style') {
      const css = node.textContent || '';
      const updated = css
        .replace(urlRegex, (_, q, name) => `url(${q}#${remap(name)}${q})`)
        .replace(cssRegex, (_, name) => '#' + remap(name));
      if (updated !== css) node.textContent = updated;
    }

    node = walker.nextNode();
  }
}

const FULLSCREEN_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M1.75 1h4a.75.75 0 0 1 0 1.5H2.5v3.25a.75.75 0 0 1-1.5 0v-4A.75.75 0 0 1 1.75 1Zm8.5 0h4a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0V2.5h-3.25a.75.75 0 0 1 0-1.5ZM1.75 9.5a.75.75 0 0 1 .75.75v3.25h3.25a.75.75 0 0 1 0 1.5h-4a.75.75 0 0 1-.75-.75v-4a.75.75 0 0 1 .75-.75Zm12.5 0a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-.75.75h-4a.75.75 0 0 1 0-1.5h3.25v-3.25a.75.75 0 0 1 .75-.75Z"/></svg>`;
const CLOSE_ICON = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>`;
const ZOOM_IN_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 3.5a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0V8h-3a.5.5 0 0 1 0-1h3V4a.5.5 0 0 1 .5-.5Z"/></svg>`;
const ZOOM_OUT_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M4 7.5h8a.5.5 0 0 1 0 1H4a.5.5 0 0 1 0-1Z"/></svg>`;
const RESET_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M8 2.5a5.5 5.5 0 1 0 5.47 5h-1.51A4 4 0 1 1 8 4V2.5Zm0 0V1l3 2.5L8 6V4.5"/></svg>`;

/**
 * Mermaid renders each SVG at its own "natural" width (depends on node count /
 * text length) and caps it with inline `style="max-width: XXXpx"`. Result:
 * simple diagrams look tiny while complex ones look huge. Normalize them so
 * every diagram fills the container width uniformly, with height deriving
 * from the viewBox to preserve aspect ratio.
 *
 * We stash the intrinsic width/height on data-* attributes so the fullscreen
 * viewer can recover the original geometry when it clones the SVG.
 */
function normalizeMermaidSvg(preNode) {
  const svg = preNode.querySelector('svg');
  if (!svg || svg.dataset.mdrNormalized === 'true') return;

  // Capture intrinsic size BEFORE we strip anything.
  // Prefer viewBox (authoritative) > width attribute > bounding rect.
  let intrinsicW = 0;
  let intrinsicH = 0;
  const viewBox = svg.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && !parts.some(isNaN)) {
      intrinsicW = parts[2];
      intrinsicH = parts[3];
    }
  }
  if (!intrinsicW || !intrinsicH) {
    const wAttr = parseFloat(svg.getAttribute('width'));
    const hAttr = parseFloat(svg.getAttribute('height'));
    if (wAttr && hAttr) {
      intrinsicW = wAttr;
      intrinsicH = hAttr;
    }
  }
  if (!intrinsicW || !intrinsicH) {
    const rect = svg.getBoundingClientRect();
    intrinsicW = rect.width || 800;
    intrinsicH = rect.height || 600;
  }

  // Ensure viewBox exists so height:auto can derive the right aspect ratio.
  if (!svg.getAttribute('viewBox')) {
    svg.setAttribute('viewBox', `0 0 ${intrinsicW} ${intrinsicH}`);
  }
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Strip mermaid's "max-width: XXXpx" cap so the SVG can fill its container.
  if (svg.style) {
    svg.style.maxWidth = '';
    svg.style.width = '100%';
    svg.style.height = 'auto';
  }
  // Remove hard sizing attributes so CSS wins.
  svg.removeAttribute('width');
  svg.removeAttribute('height');

  // --- Height cap for tall diagrams --------------------------------------
  // Some flowcharts are very tall (10+ nodes stacked vertically). At full
  // container width they'd run 2000+ pixels tall and force the reader to
  // scroll multiple screens.
  //
  // Cap the rendered size so a single diagram never exceeds ~70% of viewport
  // height. Combined with preserveAspectRatio, this turns tall diagrams into
  // thumbnail-sized overviews that fit in one screen; the fullscreen button
  // is still there for detailed inspection.
  //
  // Math: if the container is W px wide and the diagram's natural aspect
  // ratio is r = intrinsicH / intrinsicW, then rendering at width w yields
  // height w*r. We want w*r ≤ 70vh, i.e. w ≤ 70vh / r. The final width is
  // min(100%, 70vh / r). Express 70vh/r as calc(70vh * 1/r).
  const aspect = intrinsicH / intrinsicW;
  if (aspect > 0) {
    // inverse aspect (width per unit height). Clamp to a sane precision.
    const inv = (1 / aspect).toFixed(4);
    svg.style.maxWidth = `min(100%, calc(70vh * ${inv}))`;
    svg.style.maxHeight = '70vh';
    // Width becomes "as large as possible up to the cap"
    svg.style.width = '100%';
  }
  // -----------------------------------------------------------------------

  // Stash intrinsic size for the fullscreen viewer
  svg.dataset.mdrIntrinsicW = String(intrinsicW);
  svg.dataset.mdrIntrinsicH = String(intrinsicH);
  svg.dataset.mdrNormalized = 'true';
}

function attachMermaidFullscreen(preNode) {
  // Only attach once and only to successfully rendered diagrams
  if (preNode.dataset.fsAttached === 'true') return;
  if (preNode.dataset.processed !== 'true') return;

  preNode.dataset.fsAttached = 'true';
  const wrapper = preNode.closest('.md-reader-mermaid-wrapper') || preNode.parentElement;
  if (!wrapper) return;

  // Floating button on hover
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'md-reader-mermaid-fs-btn';
  btn.title = '全屏查看 (可拖动/缩放)';
  btn.setAttribute('aria-label', 'Fullscreen');
  btn.innerHTML = FULLSCREEN_ICON;
  wrapper.appendChild(btn);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = preNode.querySelector('svg');
    if (!svg) return;
    openMermaidFullscreen(svg);
  });
}

function openMermaidFullscreen(sourceSvg) {
  // Recover the intrinsic (pre-normalization) dimensions so the clone opens
  // at its natural size rather than whatever width the container happens to be.
  const stashedW = parseFloat(sourceSvg.dataset.mdrIntrinsicW);
  const stashedH = parseFloat(sourceSvg.dataset.mdrIntrinsicH);
  const srcRect = sourceSvg.getBoundingClientRect();
  const intrinsicW = stashedW || srcRect.width || parseFloat(sourceSvg.getAttribute('width')) || 800;
  const intrinsicH = stashedH || srcRect.height || parseFloat(sourceSvg.getAttribute('height')) || 600;

  // Clone to avoid yanking the inline diagram out of the page
  const clone = sourceSvg.cloneNode(true);

  // CRITICAL: rewrite all ids in the clone so they don't collide with the
  // original's ids. Mermaid uses internal ids for markers (arrowheads),
  // clip-paths, gradients, and scoped CSS (e.g. `#mermaid-123 .node`).
  uniquifySvgIds(clone);

  // Sizing strategy for CRISP rendering:
  //   Zoom is applied by changing the SVG's own `width` attribute — the
  //   browser re-rasterizes vectors (including <foreignObject> text) at the
  //   new size, so the image stays pixel-perfect at any scale.
  //   CSS `transform: scale()` would blur because Chromium rasterizes the
  //   layer once and then scales the bitmap.
  clone.removeAttribute('style');
  clone.removeAttribute('width');
  clone.removeAttribute('height');
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${intrinsicW} ${intrinsicH}`);
  }
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  // Lock aspect ratio via viewBox; width drives the actual render size,
  // height will be derived automatically by the browser.
  clone.style.display = 'block';
  clone.style.maxWidth = 'none';
  clone.style.maxHeight = 'none';
  clone.style.height = 'auto';
  // Crisp text / shape rendering hints
  clone.setAttribute('shape-rendering', 'geometricPrecision');
  clone.setAttribute('text-rendering', 'geometricPrecision');

  const overlay = document.createElement('div');
  overlay.className = 'md-reader-mermaid-fs-overlay';
  overlay.innerHTML = `
    <div class="md-reader-mermaid-fs-toolbar">
      <button type="button" class="md-reader-mermaid-fs-tool" data-act="zoom-out" title="缩小 (⌘/Ctrl+滚轮 / 捏合 / -)">${ZOOM_OUT_ICON}</button>
      <span class="md-reader-mermaid-fs-scale">100%</span>
      <button type="button" class="md-reader-mermaid-fs-tool" data-act="zoom-in" title="放大 (⌘/Ctrl+滚轮 / 捏合 / +)">${ZOOM_IN_ICON}</button>
      <button type="button" class="md-reader-mermaid-fs-tool" data-act="reset" title="重置 (双击画布 / 0)">${RESET_ICON}</button>
      <button type="button" class="md-reader-mermaid-fs-close" data-act="close" title="关闭 (Esc)">${CLOSE_ICON}</button>
    </div>
    <div class="md-reader-mermaid-fs-stage">
      <div class="md-reader-mermaid-fs-content"></div>
    </div>
    <div class="md-reader-mermaid-fs-hint">拖动 · 双指/Ctrl+滚轮缩放 · 双击重置 · Esc 关闭</div>
  `;

  const stage = overlay.querySelector('.md-reader-mermaid-fs-stage');
  const content = overlay.querySelector('.md-reader-mermaid-fs-content');
  const scaleLabel = overlay.querySelector('.md-reader-mermaid-fs-scale');
  content.appendChild(clone);

  document.body.appendChild(overlay);
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  // Initial width — will be updated on zoom
  clone.style.width = `${intrinsicW}px`;

  // Transform state
  let scale = 1;
  let tx = 0;
  let ty = 0;
  const MIN_SCALE = 0.1;
  const MAX_SCALE = 10;

  function applyTransform() {
    // Center via translate(-50%, -50%) + user pan offset. Keep CSS-based
    // centering IN the transform so we don't fight against the stylesheet.
    content.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
    // Zoom by resizing the SVG itself so the browser re-rasterizes vectors
    // at the new size — this is what keeps the image CRISP at every scale.
    clone.style.width = `${intrinsicW * scale}px`;
    scaleLabel.textContent = `${Math.round(scale * 100)}%`;
  }

  function fitToStage() {
    // Wait a tick so clone is laid out
    const svgRect = clone.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (svgRect.width === 0 || svgRect.height === 0) {
      scale = 1;
      tx = 0;
      ty = 0;
    } else {
      const padding = 40;
      const fitScale = Math.min(
        (stageRect.width - padding) / svgRect.width,
        (stageRect.height - padding) / svgRect.height,
        1
      );
      scale = fitScale > 0 ? fitScale : 1;
      tx = 0;
      ty = 0;
    }
    applyTransform();
  }

  /**
   * Zoom around a specific screen point so the point under the cursor stays
   * visually fixed.
   */
  function zoomAt(clientX, clientY, factor) {
    const rect = stage.getBoundingClientRect();
    const cx = clientX - rect.left;
    const cy = clientY - rect.top;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));
    if (newScale === scale) return;
    const stageMidX = rect.width / 2;
    const stageMidY = rect.height / 2;
    // Point in content-local coords
    const px = (cx - stageMidX - tx) / scale;
    const py = (cy - stageMidY - ty) / scale;
    tx = cx - stageMidX - px * newScale;
    ty = cy - stageMidY - py * newScale;
    scale = newScale;
    applyTransform();
  }

  function zoomBy(factor) {
    const rect = stage.getBoundingClientRect();
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  // --- Mouse / single-pointer drag (works for mouse and single-finger touch) -----
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startTx = 0;
  let startTy = 0;

  function onPointerDown(e) {
    if (e.target.closest('.md-reader-mermaid-fs-toolbar')) return;
    // Skip if touch is active (pinch handler owns it)
    if (touchActive) return;
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    startTx = tx;
    startTy = ty;
    stage.classList.add('is-dragging');
    if (stage.setPointerCapture && e.pointerId != null) {
      try { stage.setPointerCapture(e.pointerId); } catch { /* noop */ }
    }
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging || touchActive) return;
    tx = startTx + (e.clientX - startX);
    ty = startTy + (e.clientY - startY);
    applyTransform();
  }
  function onPointerUp() {
    dragging = false;
    stage.classList.remove('is-dragging');
  }

  // --- Wheel: trackpad two-finger swipe = pan; pinch / Ctrl+wheel = zoom -------
  // Browsers report trackpad pinch as a wheel event with ctrlKey=true even
  // when the user didn't press Ctrl. A plain two-finger drag on a trackpad
  // arrives as a regular wheel (ctrlKey=false).
  function onWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Pinch-zoom — magnitude of deltaY is small for pinch, larger for mouse
      const factor = Math.exp(-e.deltaY * 0.01);
      zoomAt(e.clientX, e.clientY, factor);
    } else {
      // Two-finger scroll → pan
      tx -= e.deltaX;
      ty -= e.deltaY;
      applyTransform();
    }
  }

  // --- Touch: real multi-touch (iPad / touchscreen) -----------------------------
  // Uses raw TouchEvent so we can handle 2-finger pan + pinch simultaneously.
  let touchActive = false;
  let touchStart = null; // { t1, t2?, tx, ty, scale, distance, midX, midY }

  function touchDistance(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.hypot(dx, dy);
  }
  function touchMidpoint(t1, t2) {
    return { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
  }

  function onTouchStart(e) {
    if (e.target.closest('.md-reader-mermaid-fs-toolbar')) return;
    if (e.touches.length === 1) {
      const t = e.touches[0];
      touchActive = true;
      dragging = true;
      startX = t.clientX;
      startY = t.clientY;
      startTx = tx;
      startTy = ty;
      touchStart = { mode: 'pan1', startTx: tx, startTy: ty, startX: t.clientX, startY: t.clientY };
      e.preventDefault();
    } else if (e.touches.length === 2) {
      const [t1, t2] = e.touches;
      touchActive = true;
      dragging = false;
      stage.classList.remove('is-dragging');
      const mid = touchMidpoint(t1, t2);
      touchStart = {
        mode: 'pinch',
        startDist: touchDistance(t1, t2),
        startScale: scale,
        startMidX: mid.x,
        startMidY: mid.y,
        startTx: tx,
        startTy: ty,
      };
      e.preventDefault();
    }
  }

  function onTouchMove(e) {
    if (!touchActive || !touchStart) return;
    if (touchStart.mode === 'pan1' && e.touches.length === 1) {
      const t = e.touches[0];
      tx = touchStart.startTx + (t.clientX - touchStart.startX);
      ty = touchStart.startTy + (t.clientY - touchStart.startY);
      applyTransform();
      e.preventDefault();
    } else if (touchStart.mode === 'pinch' && e.touches.length === 2) {
      const [t1, t2] = e.touches;
      const dist = touchDistance(t1, t2);
      const mid = touchMidpoint(t1, t2);
      // Scale relative to starting distance
      const targetScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, touchStart.startScale * (dist / touchStart.startDist)));
      // Pan by midpoint delta (two-finger drag)
      const rect = stage.getBoundingClientRect();
      const stageMidX = rect.width / 2;
      const stageMidY = rect.height / 2;
      // Convert the original midpoint to content-local coords at start state
      const px = (touchStart.startMidX - rect.left - stageMidX - touchStart.startTx) / touchStart.startScale;
      const py = (touchStart.startMidY - rect.top - stageMidY - touchStart.startTy) / touchStart.startScale;
      // Now make the same content point land under the current midpoint
      tx = (mid.x - rect.left) - stageMidX - px * targetScale;
      ty = (mid.y - rect.top) - stageMidY - py * targetScale;
      scale = targetScale;
      applyTransform();
      e.preventDefault();
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length === 0) {
      touchActive = false;
      dragging = false;
      touchStart = null;
      stage.classList.remove('is-dragging');
    } else if (e.touches.length === 1 && touchStart && touchStart.mode === 'pinch') {
      // Transition from pinch back to single-finger pan
      const t = e.touches[0];
      touchStart = { mode: 'pan1', startTx: tx, startTy: ty, startX: t.clientX, startY: t.clientY };
    }
  }

  function onDblClick() {
    fitToStage();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === '+' || e.key === '=') {
      zoomBy(1.2);
    } else if (e.key === '-' || e.key === '_') {
      zoomBy(1 / 1.2);
    } else if (e.key === '0') {
      fitToStage();
    }
  }

  function onToolbarClick(e) {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') close();
    else if (act === 'zoom-in') zoomBy(1.2);
    else if (act === 'zoom-out') zoomBy(1 / 1.2);
    else if (act === 'reset') fitToStage();
  }

  function close() {
    stage.removeEventListener('pointerdown', onPointerDown);
    overlay.removeEventListener('pointermove', onPointerMove);
    overlay.removeEventListener('pointerup', onPointerUp);
    overlay.removeEventListener('pointercancel', onPointerUp);
    overlay.removeEventListener('wheel', onWheel);
    stage.removeEventListener('touchstart', onTouchStart);
    stage.removeEventListener('touchmove', onTouchMove);
    stage.removeEventListener('touchend', onTouchEnd);
    stage.removeEventListener('touchcancel', onTouchEnd);
    stage.removeEventListener('dblclick', onDblClick);
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    document.body.style.overflow = prevBodyOverflow;
  }

  stage.addEventListener('pointerdown', onPointerDown);
  overlay.addEventListener('pointermove', onPointerMove);
  overlay.addEventListener('pointerup', onPointerUp);
  overlay.addEventListener('pointercancel', onPointerUp);
  overlay.addEventListener('wheel', onWheel, { passive: false });
  stage.addEventListener('touchstart', onTouchStart, { passive: false });
  stage.addEventListener('touchmove', onTouchMove, { passive: false });
  stage.addEventListener('touchend', onTouchEnd);
  stage.addEventListener('touchcancel', onTouchEnd);
  stage.addEventListener('dblclick', onDblClick);
  overlay.querySelector('.md-reader-mermaid-fs-toolbar').addEventListener('click', onToolbarClick);
  document.addEventListener('keydown', onKey);

  // Fit after layout
  requestAnimationFrame(() => requestAnimationFrame(fitToStage));
}
