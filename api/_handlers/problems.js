// Serves machine-readable documentation for every RFC 9457 error code at the
// /problems/<slug> URIs that problem+json bodies advertise in their `type`
// member (#1093 #1108). Without this route the advertised URIs dead-end on
// the SPA's HTML 404 page, so an agent dereferencing `type` per RFC 9457
// §4.2 gets HTML instead of the promised problem documentation.
//
//   GET /api/problems                  → registry index ({ codes: [...] })
//   GET /api/problems/<slug>           → one code's doc (slug = code lowercased, '_' → '-')
//   GET /api/problems?code=<slug|CODE> → same doc, query-param form
//
// The registry (title/status/description) is the same ERROR_CODES table that
// feeds problem bodies and /api/spec `x-error-codes`, so all three surfaces
// cannot drift apart.

import { ERROR_CODES, problemType } from '../_errors.js';

const slugOf = (code) => String(code).toLowerCase().replace(/_/g, '-');

const bySlug = new Map(Object.keys(ERROR_CODES).map((code) => [slugOf(code), code]));

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Registry content only changes on deploy — cacheable like other static docs.
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(JSON.stringify(body, null, 2));
}

/** One code's documentation entry, shaped for direct JSON output. */
export function problemDoc(code) {
  const meta = ERROR_CODES[code];
  return {
    code,
    slug: slugOf(code),
    type: problemType(code),
    title: meta.title,
    status: meta.status,
    description: meta.description,
    spec: `${new URL(problemType(code)).origin}/api/spec`
  };
}

export default function problems(req, res) {
  const q = (req.query && (req.query.code || req.query.slug)) || '';
  const slug = slugOf(q);
  if (!q) {
    return sendJson(res, 200, {
      description:
        'RFC 9457 problem-type documentation. Every application/problem+json `type` URI served by this API resolves here.',
      codes: Object.keys(ERROR_CODES).map(problemDoc)
    });
  }
  const code = bySlug.get(slug);
  if (!code) {
    return sendJson(res, 404, {
      error: 'Unknown problem code',
      requested: slug,
      available: [...bySlug.keys()].sort()
    });
  }
  return sendJson(res, 200, problemDoc(code));
}
