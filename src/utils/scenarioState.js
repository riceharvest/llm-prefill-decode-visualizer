// Workload scenario preset ↔ URL param bridge (#475).
//
// Scenario presets were click-only: applying one wrote prompt=/output= into
// the URL, so the preset's IDENTITY was lost in every share link and the app
// had to reverse-infer it by token counts (ambiguous if a custom config
// collides with a preset). This module makes ?scenario=<id> a first-class
// URL param: mount-time restore + share-link persistence.

export function findScenario(scenarios, id) {
  if (!id) return null;
  return scenarios.find(s => s.id === id) || null;
}

/**
 * Resolve the initial token counts from the URL.
 * Priority: explicit prompt/output params > ?scenario=<id> > fallbacks.
 */
export function initialTokensFromUrl({ readParam, readParamNum, scenarios }) {
  const urlScenario = findScenario(scenarios, readParam('scenario'));
  const hasExplicitPrompt = readParam('prompt') !== null && readParam('prompt') !== '';
  const hasExplicitOutput = readParam('output') !== null && readParam('output') !== '';
  return {
    scenario: urlScenario,
    promptTokens: hasExplicitPrompt
      ? readParamNum('prompt', 2048)
      : (urlScenario?.promptTokens ?? readParamNum('prompt', 2048)),
    outputTokens: hasExplicitOutput
      ? readParamNum('output', 512)
      : (urlScenario?.outputTokens ?? readParamNum('output', 512))
  };
}

/**
 * Which scenario should render "active": an explicit ?scenario=<id> wins so
 * the identity survives even if the counts were tweaked afterwards; otherwise
 * fall back to the legacy reverse-inference by exact token-count match.
 */
export function resolveActiveScenario({ scenarios, urlScenarioId, promptTokens, outputTokens }) {
  return findScenario(scenarios, urlScenarioId)
    || scenarios.find(s => s.promptTokens === promptTokens && s.outputTokens === outputTokens)
    || null;
}
