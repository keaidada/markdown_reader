import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { generateToc } from './toc';

let katexLoaded = false;
let katexModule = null;

/**
 * Lazily load KaTeX only when math expressions are detected
 */
async function ensureKatex() {
  if (katexLoaded) return katexModule;
  katexModule = await import('katex');
  katexLoaded = true;
  return katexModule;
}

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
    code({ text, lang }) {
      const language = lang || 'plaintext';
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

/**
 * Process math expressions in HTML string using KaTeX
 */
async function processMath(html) {
  const katex = await ensureKatex();

  // Block math: $$...$$
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (match, tex) => {
    try {
      return katex.default.renderToString(tex.trim(), { displayMode: true, throwOnError: false });
    } catch {
      return match;
    }
  });

  // Inline math: $...$
  html = html.replace(/(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$)/g, (match, tex) => {
    try {
      return katex.default.renderToString(tex.trim(), { displayMode: false, throwOnError: false });
    } catch {
      return match;
    }
  });

  return html;
}

/**
 * Pre-process markdown to escape angle brackets inside inline code.
 * Prevents `<group>` inside backticks from being parsed as HTML tags.
 * Also escapes bare <word> patterns that aren't real HTML tags.
 */
function preprocessMarkdown(markdown) {
  // Escape < > inside inline code (`...`)
  markdown = markdown.replace(/`([^`]+)`/g, (match, code) => {
    return '`' + code.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '`';
  });

  // Escape bare <word> that aren't known HTML tags (outside code blocks)
  // Known self-closing or common HTML tags to preserve
  const htmlTags = /^(a|abbr|address|article|aside|audio|b|bdi|bdo|blockquote|br|button|canvas|caption|cite|code|col|colgroup|data|datalist|dd|del|details|dfn|dialog|div|dl|dt|em|embed|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hgroup|hr|html|i|iframe|img|input|ins|kbd|label|legend|li|link|main|map|mark|math|menu|meta|meter|nav|noscript|object|ol|optgroup|option|output|p|param|picture|pre|progress|q|rp|rt|ruby|s|samp|script|search|section|select|slot|small|source|span|strong|style|sub|summary|sup|table|tbody|td|template|textarea|tfoot|th|thead|time|title|tr|track|u|ul|var|video|wbr)$/i;

  // Process line by line, skip fenced code blocks
  const lines = markdown.split('\n');
  let inCodeBlock = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    // Replace <word> patterns that aren't real HTML tags
    lines[i] = lines[i].replace(/<([a-zA-Z\u4e00-\u9fff][a-zA-Z0-9\u4e00-\u9fff_-]*)>/g, (match, tag) => {
      if (htmlTags.test(tag)) return match;
      return '&lt;' + tag + '&gt;';
    });
  }
  return lines.join('\n');
}

/**
 * Main render function: markdown string → rendered HTML + TOC data
 */
export async function renderMarkdown(markdown) {
  const marked = createMarked();
  markdown = preprocessMarkdown(markdown);
  let html = marked.parse(markdown);

  // Process math if detected
  if (hasMath(markdown)) {
    html = await processMath(html);
  }

  // Generate TOC from rendered HTML
  const toc = generateToc(html);

  return { html, toc };
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
