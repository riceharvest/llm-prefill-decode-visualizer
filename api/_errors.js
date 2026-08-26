// Shared RFC 9457 "problem+json" error helpers for every /api endpoint.
//
// Every error response is a single JSON object:
//   { type, title, status, detail?, instance?, code, errors?: [...] , ...extras }
// served with Content-Type: application/problem+json.
//
// `code` is the machine-readable stable identifier agents should branch on;
// the registry below is mirrored into /api/spec (`x-error-codes`) so generated
// SDKs can type failure cases.

const BASE = 'https://llm-prefill-decode-visualizer.vercel.app';

/**
 * Stable error-code registry. `status` is the default HTTP status; a call site
 * may override it, but the defaults here are canonical.
 */
export const ERROR_CODES = {
  INVALID_PARAMS: {
    status: 400,
    title: 'Invalid parameters',
    description: 'The request was well-formed but contains invalid or missing parameters. Fix the input and retry without backoff.'
  },
  INVALID_CURSOR: {
    status: 400,
    title: 'Invalid cursor',
    description: 'The ?cursor= value is malformed or was minted for a different query (endpoint, filters or dataset snapshot changed). Restart the walk from page one of the current query. Do not retry with the same cursor.'
  },
  NOT_FOUND: {
    status: 404,
    title: 'Not found',
    description: 'A referenced resource (e.g. a scenario preset id) does not exist. Do not retry unchanged.'
  },
  METHOD_NOT_ALLOWED: {
    status: 405,
    title: 'Method not allowed',
    description: 'The HTTP method is not supported by this endpoint. Use GET as documented; do not retry with the same method.'
  },
  RATE_LIMITED: {
    status: 429,
    title: 'Rate limited',
    description: 'Too many requests. Honor Retry-After (seconds), then retry with backoff.'
  },
  UPSTREAM_UNAVAILABLE: {
    status: 502,
    title: 'Upstream unavailable',
    description: 'Transient failure fetching community benchmark data. Safe to retry with backoff.'
  },
  BATCH_ALL_FAILED: {
    status: 400,
    title: 'Batch failed',
    description: 'Every item in the batch failed (issue #707). The `errors` member carries one entry per failed item, each with its own stable `code` and HTTP `status`. Partial batches (at least one ok item) still return 200 with per-item ok/error entries.'
  },
  UPSTREAM_TIMEOUT: {
    status: 504,
    title: 'Upstream timeout',
    description: 'An upstream data source did not respond within its time budget, so the request was aborted server-side instead of hanging. Safe to retry with backoff.'
  },
  INTERNAL: {
    status: 500,
    title: 'Internal server error',
    description: 'Unexpected server error. Not actionable; retrying may or may not help.'
  }
};

/** Machine-readable problem-type URI for a code (resolvable, stable). */
export function problemType(code) {
  return `${BASE}/problems/${String(code).toLowerCase().replace(/_/g, '-')}`;
}

/**
 * Build an RFC 9457 problem body. Field order follows the RFC convention:
 * type, title, status, then detail/instance, then the machine-readable code,
 * field-level `errors`, and any extra members.
 */
export function problemBody({ status, code = 'INTERNAL', detail, instance, errors, ...extras } = {}) {
  const meta = ERROR_CODES[code] || ERROR_CODES.INTERNAL;
  return {
    type: problemType(ERROR_CODES[code] ? code : 'INTERNAL'),
    title: meta.title,
    status: Number.isFinite(status) ? status : meta.status,
    ...(detail ? { detail } : {}),
    ...(instance ? { instance } : {}),
    code: ERROR_CODES[code] ? code : 'INTERNAL',
    ...(Array.isArray(errors) && errors.length ? { errors } : {}),
    ...extras
  };
}

/**
 * Error class carrying a stable code so handlers can throw and let one
 * central catch render the problem response.
 */
export class ApiError extends Error {
  constructor(code, detail, { status, errors, extras } = {}) {
    super(detail || ERROR_CODES[code]?.title || 'error');
    this.name = 'ApiError';
    this.code = ERROR_CODES[code] ? code : 'INTERNAL';
    this.status = Number.isFinite(status) ? status : ERROR_CODES[this.code].status;
    if (detail) this.detail = detail;
    if (errors) this.errors = errors;
    if (extras) this.extras = extras;
  }

  toProblem(instance) {
    return problemBody({
      status: this.status,
      code: this.code,
      detail: this.detail,
      instance,
      errors: this.errors,
      ...this.extras
    });
  }
}

/** Map any thrown value to an ApiError (unknown throws become INTERNAL). */
export function toApiError(err) {
  if (err instanceof ApiError) return err;
  return new ApiError('INTERNAL', String(err?.message || err));
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/problem+json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body, null, 2));
}

/**
 * RFC 9457 `instance` source URL for a request.
 *
 * On the serverless catch-all (api/[...path].js), the platform appends its own
 * internal routing key — `?...path=<fn-name>` — to req.url. That key is not a
 * documented API parameter and was never sent by the client, so it must not
 * leak into the occurrence URI agents use for correlation/retry logs (#1095).
 */
export function requestInstance(req) {
  const raw = String(req?.url || '');
  const q = raw.indexOf('?');
  if (q === -1 || !raw.includes('...path=')) return raw;
  const kept = raw
    .slice(q + 1)
    .split('&')
    .filter(part => part !== '' && !part.startsWith('...path='));
  return kept.length ? `${raw.slice(0, q)}?${kept.join('&')}` : raw.slice(0, q);
}

/**
 * Render a problem+json response. `req` is optional and only used to fill the
 * RFC `instance` member (the request path + query).
 */
export function sendProblem(res, req, { status, code, detail, errors, ...extras } = {}) {
  const body = problemBody({ status, code, detail, errors, ...extras });
  send(res, body.status, { ...body, instance: body.instance ?? requestInstance(req) });
}

/** Render a problem from a thrown value (ApiError keeps its code/status). */
export function sendProblemFromError(res, req, err) {
  const e = toApiError(err);
  send(res, e.status, e.toProblem(requestInstance(req)));
}

/**
 * Convenience for endpoints that enforce rate limits. Sets a Retry-After
 * header (seconds) alongside the standard problem response.
 */
export function sendRateLimited(res, req, { detail, retryAfter = 60 } = {}) {
  const body = problemBody({
    code: 'RATE_LIMITED',
    detail: detail || 'Too many requests — slow down.',
    instance: requestInstance(req)
  });
  res.setHeader('Retry-After', String(retryAfter));
  send(res, ERROR_CODES.RATE_LIMITED.status, body);
}
