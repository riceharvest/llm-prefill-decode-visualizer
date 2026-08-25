// Share-link tamper-evidence (issue #917).
//
// The repo's trust model already makes its server-side citable artifacts
// tamper-evident: `calc_` ids are content hashes over canonical params
// (api/_calc_id.js), pagination cursors fail loudly on tampering
// (api/_pagination.js), and watch webhooks carry an HMAC header
// (api/_watch.js). Share permalinks were the one widely-circulated artifact
// with zero integrity checking — any mutated ?title= or param was accepted
// verbatim on load.
//
// This module gives share links the same treatment: `permalinkHref()` appends
// an integrity param `h=<hex>` — an HMAC-SHA256 (first 12 hex chars) over the
// canonicalized query params including `title` — and App verifies it once on
// load. A mismatch ⇒ visible "link was modified" banner instead of silent
// acceptance.
//
// Trust model (same honesty as _calc_id): everything here is client-side and
// ships in the public bundle, so the signing key is public knowledge. The
// signature detects *mutation* — accidental edits, silent rewrites in transit,
// doctored links whose params no longer match their claimed title — but it
// cannot authenticate authorship against someone willing to re-sign. The only
// cryptographically authenticated citable artifact remains a `calc_` id.

// Static application pepper. Public by design; versioned so the scheme can
// rotate without invalidating old links silently.
const SHARE_SIGNING_KEY = 'llm-prefill-decode-visualizer/share-integrity/v1';

// Integrity param name + signature length (48 bits — enough to make casual
// mutation detection reliable without bloating shared URLs).
export const SHARE_SIG_PARAM = 'h';
const SIG_HEX_CHARS = 12;

function subtle() {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error('Web Crypto unavailable: cannot verify share-link signature');
  return c.subtle;
}

/**
 * Canonical string form of a share link's query state: every param except the
 * signature itself, sorted by key then value, joined as `key=value` lines.
 * Deterministic across URLSearchParams ordering so re-signed links hash equal.
 */
export function canonicalShareQuery(search) {
  const p = new URLSearchParams(search || '');
  p.delete(SHARE_SIG_PARAM);
  const entries = [...p.entries()]
    .filter(([k]) => k !== SHARE_SIG_PARAM)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return entries.map(([k, v]) => `${k}=${v}`).join('\n');
}

/** HMAC-SHA256 over the canonical query, hex-encoded. Async (Web Crypto). */
async function hmacHex(data) {
  const enc = new TextEncoder();
  const key = await subtle().importKey(
    'raw', enc.encode(SHARE_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await subtle().sign('HMAC', key, enc.encode(data));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Signature for a query string's current params (excluding any existing `h`).
 * Returns the first SIG_HEX_CHARS hex chars.
 */
export async function signShareParams(search) {
  const sig = await hmacHex(canonicalShareQuery(search));
  return sig.slice(0, SIG_HEX_CHARS);
}

/**
 * Verify a loaded share link. Returns:
 *   { status: 'ok',       given, expected } — signed and intact
 *   { status: 'tampered', given, expected } — signed but params/title mutated
 *   { status: 'unsigned' }                  — no `h` param (legacy/in-app links)
 */
export async function verifyShareLink(search) {
  const p = new URLSearchParams(search || '');
  const given = p.get(SHARE_SIG_PARAM);
  if (!given) return { status: 'unsigned' };
  const expected = await signShareParams(search);
  const ok = given.trim().toLowerCase() === expected.toLowerCase();
  return ok
    ? { status: 'ok', given, expected }
    : { status: 'tampered', given, expected };
}
