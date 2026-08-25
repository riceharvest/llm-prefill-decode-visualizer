// Centralized bot-protection ("WAF") backoff contract for machine consumers.
//
// GitHub issues #466 #526 #541 #554 #710: bursts well under the documented
// 120 req/min budget can trip Vercel's Security Checkpoint / Attack Challenge
// Mode at the edge. When that happens EVERY path — including /llms.txt and
// /api/health — returns an HTML challenge instead of JSON:
//
//   HTTP/2 403
//   content-type: text/html; charset=utf-8
//   x-vercel-mitigated: challenge
//   x-vercel-challenge-token: 2.…          (JS-solve token)
//   (no Retry-After, no JSON, no problem+json)
//
// The challenge is enforced BEFORE app code runs, so no serverless handler can
// intercept it or rewrite it into a friendly 429 + Retry-After. What we CAN do
// is publish the exact wire signature and the recommended agent backoff in one
// place, mirror it into /api/spec (`x-bot-protection`) and /llms.txt, and keep
// every app-emitted 429 carrying a real Retry-After header so agents always
// have at least one honest throttle signal per layer.
//
// Observed lockout duration (#541): ~10 minutes even at ~1 request/100s.
// Backing off for less only re-trips the checkpoint and extends the block.

/** Wire signature of an edge challenge response — how agents detect "blocked". */
export const WAF_BLOCK = Object.freeze({
  status: 403,
  contentType: 'text/html; charset=utf-8',
  mitigatedHeader: 'x-vercel-mitigated',
  mitigatedValue: 'challenge',
  challengeTokenHeader: 'x-vercel-challenge-token',
  retryAfterHeader: null // the edge sends none — that is the problem
});

/**
 * Recommended agent backoff when a block is detected, in seconds.
 * ~10 minutes: the observed lockout length from #541. Agents should sleep for
 * this long (or until a probe succeeds again) instead of retrying sooner.
 */
export const WAF_RECOMMENDED_BACKOFF_SECONDS = 600;

/**
 * The machine-readable shape we document as "what a block means" — the
 * problem+json equivalent agents can treat a challenge 403 as mapping onto.
 * Used by /api/spec `x-bot-protection` so SDKs can model it; NOT emitted on
 * the wire today because the edge intercepts before the handler runs.
 */
export function wafProblemBody() {
  return {
    type: 'https://llm-prefill-decode-visualizer.vercel.app/problems/challenge-required',
    title: 'Blocked by edge bot protection',
    status: WAF_BLOCK.status,
    code: 'CHALLENGE_REQUIRED',
    detail:
      'Vercel Security Checkpoint served an HTML JS challenge instead of JSON. ' +
      `Detect it by ${WAF_BLOCK.mitigatedHeader}: ${WAF_BLOCK.mitigatedValue} on a ${WAF_BLOCK.status} text/html response. ` +
      `There is no Retry-After on the wire; back off ~${WAF_RECOMMENDED_BACKOFF_SECONDS}s and retry.`,
    retry_after_seconds: WAF_RECOMMENDED_BACKOFF_SECONDS,
    actionable: 'Back off ~10 minutes; plain HTTP clients cannot solve the JS challenge.'
  };
}

/**
 * Root-level `/api/spec` extension documenting the edge behavior next to the
 * app's own rate-limit contract, so generated clients see both layers.
 */
export function xBotProtection() {
  return {
    description:
      'Vercel edge bot protection (Attack Challenge Mode / Security Checkpoint) sits IN FRONT of this API ' +
      'and can temporarily block clients whose burst traffic trips it — observed around ~35–60 rapid ' +
      'requests/min, i.e. below the documented 120/min application budget.',
    detection: {
      status: WAF_BLOCK.status,
      content_type: WAF_BLOCK.contentType,
      [WAF_BLOCK.mitigatedHeader]: WAF_BLOCK.mitigatedValue,
      body: 'HTML JS challenge page (not JSON, not problem+json)',
      retry_after_header: 'absent'
    },
    scope: 'ALL paths while blocked, including /llms.txt, /agents.json and /api/health',
    recommended_backoff_seconds: WAF_RECOMMENDED_BACKOFF_SECONDS,
    maps_to_problem: wafProblemBody(),
    note:
      'Enforced at Vercel\'s edge before application code runs, so the server cannot convert it into a ' +
      '429 + Retry-After. The app\'s OWN rate limiter (see x-rate-limit) still emits 429 with Retry-After; ' +
      'treat a 403 text/html challenge as the stricter, edge-level signal documented here.'
  };
}
