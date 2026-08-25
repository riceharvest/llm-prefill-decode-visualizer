/**
 * Markdown content negotiation (acceptmarkdown.com).
 *
 * When a client sends `Accept: text/markdown`, API endpoints respond with a
 * markdown rendering of the same payload instead of JSON, and every response
 * carries `Vary: Accept, Accept-Encoding` so caches never serve the wrong
 * variant.
 *
 * The converter is intentionally generic: objects become `key: value` lines,
 * arrays become lists or tables (when rows share keys), scalars become plain
 * text. Endpoint handlers stay JSON-only — negotiation happens at the edge of
 * sendJson().
 */

const MARKDOWN_TYPES = new Set(['text/markdown', 'application/markdown']);
const JSON_TYPES = new Set(['application/json']);

/**
 * Parse an Accept header into ordered media ranges with quality values
 * (RFC 9110 §12.5.1): `[{ type, q, order }]`. Malformed entries and
 * non-finite q values are skipped; q defaults to 1 when absent.
 */
export function parseAccept(accept) {
  if (!accept) return [];
  return String(accept)
    .split(',')
    .map((part, i) => {
      const [range, ...params] = part.split(';');
      const type = range.trim().toLowerCase();
      if (!type || !type.includes('/')) return null;
      let q = 1;
      for (const p of params) {
        const m = /^\s*q\s*=\s*([^\s]+)\s*$/i.exec(p);
        if (m) {
          const v = Number(m[1]);
          if (!Number.isFinite(v)) return null;
          q = Math.max(0, Math.min(1, v));
        }
      }
      return { type, q, order: i };
    })
    .filter(Boolean);
}

/** Highest-q entry whose range matches `type` exactly or via wildcard. */
function bestMatch(ranges, type) {
  const [major, minor] = type.split('/');
  let best = null;
  for (const r of ranges) {
    if (r.q <= 0) continue;
    const matches =
      r.type === `${major}/${minor}` ||
      r.type === `${major}/*` && minor !== '*' ||
      r.type === '*/*';
    if (matches && (!best || r.q > best.q)) best = r;
  }
  return best;
}

/**
 * True only when a markdown variant is the client's preferred acceptable
 * representation: markdown must be explicitly acceptable with a strictly
 * higher q-value than JSON (ties keep the JSON default). An explicit
 * `q=0` refusal is honored, junk types like `text/markdownx` never match,
 * and unsatisfiable Accept headers fall back to the JSON default.
 */
export function wantsMarkdown(req) {
  const ranges = parseAccept(req?.headers?.accept);
  if (!ranges.length) return false;
  let md = null;
  for (const t of MARKDOWN_TYPES) {
    const m = bestMatch(ranges, t);
    if (m && (!md || m.q > md.q)) md = m;
  }
  if (!md || md.q <= 0) return false;
  let json = null;
  for (const t of JSON_TYPES) {
    const m = bestMatch(ranges, t);
    if (m && (!json || m.q > json.q)) json = m;
  }
  if (json && json.q >= md.q) return false;
  return true;
}

/** Escape pipe characters so table cells don't break. */
const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function renderScalar(v) {
  if (v === null) return '`null`';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return String(v);
}

/**
 * Render one object as a markdown table whose columns are the object's keys.
 * Only used when every value is a scalar — nested shapes fall back to lists.
 */
function objectAsTable(obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return '_(empty)_';
  if (!keys.every(k => ['string', 'number', 'boolean'].includes(typeof obj[k]) || obj[k] === null)) {
    return null;
  }
  const head = `| ${keys.map(cell).join(' | ')} |`;
  const sep = `| ${keys.map(() => '---').join(' | ')} |`;
  const row = `| ${keys.map(k => cell(renderScalar(obj[k]))).join(' | ')} |`;
  return `${head}\n${sep}\n${row}`;
}

function renderValue(v, indent = 0) {
  const pad = '  '.repeat(indent);
  if (v === null || typeof v !== 'object') return `${pad}${renderScalar(v)}`;
  if (Array.isArray(v)) {
    // Array of uniform-shape scalar objects → table; otherwise list.
    if (
      v.length > 0 &&
      v.every(item => item && typeof item === 'object' && !Array.isArray(item))
    ) {
      const table = renderArrayTable(v);
      if (table) return `${pad}${table}`;
    }
    if (v.length === 0) return `${pad}_(empty array)_`;
    return v.map(item => `${pad}- ${inline(item)}`).join('\n');
  }
  // Plain object → key: value list, recursing into nested values
  return Object.entries(v)
    .map(([k, val]) => {
      if (val !== null && typeof val === 'object') {
        const inner = renderValue(val, indent + 1);
        return `${pad}- **${k}:**\n${inner}`;
      }
      return `${pad}- **${k}:** ${renderScalar(val)}`;
    })
    .join('\n');
}

function renderArrayTable(arr) {
  const allKeys = [...new Set(arr.flatMap(o => Object.keys(o)))];
  if (!allKeys.length) return null;
  const flat = arr.every(o =>
    allKeys.every(k => ['string', 'number', 'boolean'].includes(typeof o[k]) || o[k] === null || o[k] === undefined)
  );
  if (!flat) return null;
  const head = `| ${allKeys.map(cell).join(' | ')} |`;
  const sep = `| ${allKeys.map(() => '---').join(' | ')} |`;
  const rows = arr.map(o => `| ${allKeys.map(k => cell(o[k] === undefined ? '' : renderScalar(o[k]))).join(' | ')} |`);
  return [head, sep, ...rows].join('\n');
}

function inline(v) {
  if (v === null || typeof v !== 'object') return renderScalar(v);
  if (Array.isArray(v)) return v.map(inline).join(', ');
  return Object.entries(v).map(([k, val]) => `${k}: ${inline(val)}`).join('; ');
}

/**
 * Convert an arbitrary JSON-serialisable body to a markdown document.
 * Top level: `## <title>` then the rendered value. Nested objects/arrays use
 * headings for keys and markdown tables where rows are uniform.
 */
export function jsonToMarkdown(body, { title = 'Response' } = {}) {
  const parts = [`## ${title}`, ''];
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    for (const [key, val] of Object.entries(body)) {
      if (val !== null && typeof val === 'object') {
        if (Array.isArray(val)) {
          parts.push(`### ${key}`, '');
          if (val.length && val.every(i => i && typeof i === 'object')) {
            parts.push(renderArrayTable(val) || renderValue(val, 0));
          } else if (val.length === 0) {
            parts.push('_(empty)_');
          } else {
            parts.push(renderValue(val, 0));
          }
        } else {
          parts.push(`### ${key}`, '');
          const table = objectAsTable(val);
          parts.push(table ?? renderValue(val, 0));
        }
      } else {
        parts.push(`- **${key}:** ${renderScalar(val)}`);
      }
      parts.push('');
    }
  } else {
    parts.push(renderValue(body));
  }
  return parts.join('\n').trimEnd() + '\n';
}

/**
 * Wrap a response `end`: when the request wants markdown and the handler is
 * about to emit JSON, swap in the markdown rendering and set the right
 * Content-Type. Always sets `Vary: Accept, Accept-Encoding`.
 *
 * Usage inside a serverless handler:
 *   withMarkdownNegotiation(req, res);
 *   ... normal JSON handling ...
 */
export function withMarkdownNegotiation(req, res) {
  res.setHeader('Vary', 'Accept, Accept-Encoding');
  if (!wantsMarkdown(req)) return;

  const originalEnd = res.end.bind(res);
  res.end = function patchedEnd(chunk, ...rest) {
    const contentType = String(res.getHeader('Content-Type') || '');
    if (contentType.includes('application/json') && chunk) {
      try {
        const body = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
        const md = jsonToMarkdown(body, { title: titleFor(req) });
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        return originalEnd(md, ...rest);
      } catch {
        // not valid JSON — pass through untouched
      }
    }
    return originalEnd(chunk, ...rest);
  };
}

function titleFor(req) {
  const url = (req.url || '').split('?')[0];
  const name = url.replace(/^\/(v1\/)?api\//, '').replace(/^\//, '') || 'root';
  return `GET ${name}`;
}
