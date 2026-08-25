// Shared fetch helper: timeout + JSON content-type guard (#723).
//
// Before this helper existed, every data panel rolled its own fetch policy:
// some had an AbortController timeout (HardwareShortlist, QuantTradeoffMatrix),
// some had nothing at all (RunDiff could hang forever on a stalled request),
// and NONE checked Content-Type before calling res.json() — so a non-JSON
// response (e.g. the Vercel security checkpoint's HTML challenge) surfaced as
// raw `SyntaxError: Unexpected token '<' …` text in the UI.
//
// fetchJsonWithTimeout(path, opts) fixes all three:
//   - always runs under an AbortController: caller signal ORed with an
//     abort timer (timeoutMs, default 15000);
//   - verifies the response is JSON before parsing;
//   - throws a typed FetchJsonError ({ kind: 'timeout' | 'aborted' |
//     'bad_response' | 'http', status?, detail }) so callers render stable,
//     actionable messages instead of engine internals.
export class FetchJsonError extends Error {
  constructor(kind, detail, { status } = {}) {
    super(detail);
    this.name = 'FetchJsonError';
    this.kind = kind; // 'timeout' | 'aborted' | 'bad_response' | 'http'
    if (status !== undefined) this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

export async function fetchJsonWithTimeout(path, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  // Caller signal (e.g. unmount abort) and our timer both route through one
  // controller: whichever fires first wins.
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`request timed out after ${timeoutMs}ms`, 'TimeoutError')),
    timeoutMs
  );
  const onOuterAbort = () => controller.abort(signal.reason);
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  let res;
  try {
    res = await fetch(path, { signal: controller.signal });
  } catch {
    if (controller.signal.reason instanceof DOMException && controller.signal.reason.name === 'TimeoutError') {
      throw new FetchJsonError('timeout', `Request timed out after ${Math.round(timeoutMs / 1000)}s — try again.`);
    }
    throw new FetchJsonError('aborted', 'Request aborted.');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }

  const contentType = res.headers?.get?.('content-type') || '';
  if (!contentType.includes('json')) {
    throw new FetchJsonError(
      'bad_response',
      `Expected JSON from ${path} but got '${contentType || 'unknown content type'}' (HTTP ${res.status}) — possibly a proxy/WAF challenge page.`,
      { status: res.status }
    );
  }

  let body;
  try {
    body = await res.json();
  } catch {
    throw new FetchJsonError('bad_response', `Response claimed JSON but could not be parsed (HTTP ${res.status}).`, { status: res.status });
  }

  if (!res.ok) {
    // Problem+json responses carry a stable machine-readable `code`; prefer it
    // over prose. Fall back to the legacy `{ error }` shape, then to status.
    throw new FetchJsonError('http', body?.detail || body?.error || body?.title || `API returned ${res.status}`, { status: res.status });
  }

  return body;
}
