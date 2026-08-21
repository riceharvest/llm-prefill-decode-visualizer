// Copy-as-code snippet builders (#17): turn the current compare-tab setup
// into a runnable /api/compute request in cURL, Python or TypeScript.
//
// Like exportPng.js / exportMarkdown.js, the builders are pure functions
// (no DOM access) so the output is deterministic and unit-testable — and so
// the copied snippet is byte-identical to what the API validates: the same
// batch payload works as-is, and with "dry_run": true it previews without
// executing (see the dryRun section of /api/compute's capability list).

// The exact comparison shown in the compare tab, expressed as one batched
// POST: system A and system B become two `batched` scenarios sharing the
// same prompt/output token counts and concurrency.
export function buildCompareBatchBody({
  prefillSpeedA,
  decodeSpeedA,
  prefillSpeedB,
  decodeSpeedB,
  batchSize = 1,
  promptTokens = 4096,
  outputTokens = 512,
  dryRun = false
}) {
  const scenario = (prefillSpeed, decodeSpeed) => ({
    model: 'batched',
    prefillSpeed: Math.round(prefillSpeed),
    decodeSpeed: Math.round(decodeSpeed),
    batchSize,
    promptTokens,
    outputTokens
  });
  const body = {
    batch: [
      scenario(prefillSpeedA, decodeSpeedA),
      scenario(prefillSpeedB, decodeSpeedB)
    ]
  };
  if (dryRun) body.dry_run = true;
  return body;
}

export function buildCurl({ origin = '', body }) {
  const url = `${origin}/api/compute`;
  // Split -d across lines for readability; the JSON stays valid as-is.
  return `curl -X POST '${url}' \\
  -H 'Content-Type: application/json' \\
  -d '${JSON.stringify(body)}'`;
}

export function buildPython({ origin = '', body }) {
  const url = `${origin}/api/compute`;
  // JSON.stringify is almost a Python dict literal; only the literals
  // differ (true/false/null → True/False/None). The payload contains no
  // free-form strings, so the token replace is safe.
  const pyDict = JSON.stringify(body, null, 4)
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None');
  return `import requests

r = requests.post("${url}", json=${pyDict})
r.raise_for_status()
print(r.json())`;
}

export function buildTypeScript({ origin = '', body }) {
  const url = `${origin}/api/compute`;
  return `const res = await fetch("${url}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(${JSON.stringify(body, null, 2)})
});
console.log(await res.json());`;
}

// Dispatch helper used by the compare-tab buttons.
export function buildSnippet(lang, { origin, body }) {
  switch (lang) {
    case 'curl': return buildCurl({ origin, body });
    case 'python': return buildPython({ origin, body });
    case 'typescript': return buildTypeScript({ origin, body });
    default: throw new Error(`Unknown snippet language '${lang}'`);
  }
}
