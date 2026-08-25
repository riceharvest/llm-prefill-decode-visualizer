// GET /api/calc/<id> — file-routed alias so the calc replay endpoint is
// reachable in production (issue #474).
//
// The replay handler lives in ./_handlers/calc_id.js and was only reachable
// through the catch-all router's /calc/:id regex — but multi-segment /api/*
// URLs never reach the catch-all on the deployed platform, so every replay
// 404s at the edge with a plain-text NOT_FOUND. This thin module gives the
// route a real serverless function, and a vercel.json rewrite maps
//   /api/calc/<id>  →  /api/calc?id=<id>
// (query strings are preserved, so the original params ride along).
// Self-hosted/proxied deployments keep working through the catch-all too.

import calcId from './_handlers/calc_id.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  return calcId(req, res);
}
