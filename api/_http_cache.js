// Shared Cache-Control policy for handlers that stamp public TTLs (#944).
//
// Success responses are edge/browser-cacheable as before. Error responses
// must never be: a publicly cached 404/502 replays a transient failure from
// the edge long after the underlying cause has cleared (live-verified:
// x-vercel-cache: HIT, age 45 on a 404 from /api/diff). Errors now get
// `no-store` so every retry reaches the origin.
export function cacheControlFor(status, ttl) {
  return status < 400 ? `public, max-age=${ttl}` : 'no-store';
}
