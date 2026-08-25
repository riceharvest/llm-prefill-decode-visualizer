// Embeddable chart snippet builders (#104).
//
// Like copyAsCode.js / exportMarkdown.js, these are pure functions (no DOM
// access) so they're deterministic and unit-testable. The DOM-dependent half
// lives in exportPng.js (nodeToPngDataUri); here we turn that data-URI plus
// the shared run URL into copy-paste-ready snippets.
//
// Design goals from the issue:
//   - Self-contained: the <img> variant inlines the chart as a base64 PNG,
//     so it renders on any blog/CMS/forum with zero hosting and zero JS.
//   - Attribution baked in: every variant links back to the shared run URL,
//     so readers land on the exact live configuration ("spread virally").
//   - Read-only & tiny: the iframe variant is a plain <iframe> of the run
//     URL sized to the chart; nothing executes beyond the app itself.

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 450;

export function escapeHtmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Replace control characters (newlines, tabs, NULs…) with spaces so they can
 * neither forge Markdown block boundaries nor corrupt URLs.
 */
function flattenControlChars(str) {
  return [...str].map((c) => {
    const code = c.charCodeAt(0);
    return code > 0x1f && code !== 0x7f ? c : ' ';
  }).join('');
}

/**
 * Make an arbitrary URL safe to interpolate as a Markdown link destination
 * `](...)` (#684): a crafted share-link href can carry `(`/`)`/`[`/`]`, which
 * closes the destination early and lets the rest render as attacker markdown.
 * Percent-encode the structural characters (same effect URLSearchParams gives
 * the deep-link builder implicitly) and drop control chars / angle brackets so
 * the destination always stays one balanced token.
 */
export function escapeMarkdownLinkDest(value) {
  return flattenControlChars(String(value))
    .replace(/[<>]/g, '')
    .replace(/\\/g, '%5C')
    .replace(/[()[\] ]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Neutralize free-form (community-submitted) strings before they are
 * interpolated into Markdown structure (#896): newlines would break table rows
 * or forge block boundaries, and `|` closes table cells early while
 * brackets/backticks inject links, images, and code fences. Backslash is
 * doubled first so the escapes themselves survive.
 */
export function escapeMarkdownText(value) {
  return flattenControlChars(String(value ?? ''))
    .replace(/\\/g, '\\\\')
    .replace(/([|`*_[\]])/g, '\\$1');
}

/**
 * Self-contained `<img>` snippet: the chart is inlined as a base64 PNG
 * data-URI and wrapped in a link to the live run for attribution.
 */
export function buildEmbedHtml({ dataUri, sourceUrl = '', width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, alt = 'LLM inference chart' }) {
  const href = sourceUrl ? ` href="${escapeHtmlAttr(sourceUrl)}"` : '';
  const openTag = sourceUrl ? 'a' : 'span';
  const closeTag = sourceUrl ? 'a' : 'span';
  return (
    `<${openTag}${href} target="_blank" rel="noopener">` +
    `<img src="${dataUri}" width="${width}" height="${height}" alt="${escapeHtmlAttr(alt)}" style="max-width:100%;height:auto;">` +
    `</${closeTag}>`
  );
}

/**
 * Read-only live embed: an iframe of the shared run URL. The URL carries all
 * state as query params (see urlState.js writeParams), so the frame reproduces
 * this exact configuration without any extra script.
 */
export function buildEmbedIframe({ sourceUrl, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, title = 'LLM inference visualizer' }) {
  return (
    `<iframe src="${escapeHtmlAttr(sourceUrl)}" width="${width}" height="${height}" ` +
    `title="${escapeHtmlAttr(title)}" loading="lazy" style="border:1px solid #212B36;border-radius:6px;max-width:100%;" ` +
    `allowfullscreen></iframe>`
  );
}

/**
 * Markdown variant for platforms that render markdown but strip raw HTML
 * (GitHub READMEs, most forums). The image is the data-URI; the link is the
 * attribution back to the live run.
 */
export function buildEmbedMarkdown({ dataUri, sourceUrl = '', alt = 'LLM inference chart' }) {
  const altEscaped = alt.replace(/[[\]]/g, '');
  if (!sourceUrl) return `![${altEscaped}](${dataUri})`;
  return `[![${altEscaped}](${dataUri})](${escapeMarkdownLinkDest(sourceUrl)})`;
}
