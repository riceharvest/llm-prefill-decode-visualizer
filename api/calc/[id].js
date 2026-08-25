// Filesystem-routed entry for GET /api/calc/<id> (issue #592).
//
// The dispatcher in api/[...path].js has a /calc/:id regex branch, but
// multi-segment /api/* paths never reach the catch-all on the deployed
// platform (see issue #540 for the general mechanism) — the documented
// deterministic-replay endpoint 404s at the edge with Vercel's plain-text
// NOT_FOUND instead of the JSON contract.
//
// This dynamic-segment file makes the platform's filesystem router serve the
// route directly: requests to /api/calc/<id> invoke this function with the id
// injected into req.query.id, and it delegates to the exact same handler the
// dispatcher uses, so there is one implementation and zero drift.
// /v1/calc/<id> keeps working through the existing vercel.json rewrite
// (/v1/:path* → /api/:path*), which lands here too.

export { default, config } from '../_handlers/calc_id.js';
