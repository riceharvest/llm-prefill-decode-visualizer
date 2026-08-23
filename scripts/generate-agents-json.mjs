// Generate public/agents.json from the central route table (api/_route_table.js).
//
// Usage:
//   node scripts/generate-agents-json.mjs            # write public/agents.json
//   node scripts/generate-agents-json.mjs --check    # exit 1 if it would change
//
// The drift test (api/_route_table.test.js) regenerates the document in
// memory and compares it against the committed file, so editing agents.json
// by hand — or adding a route without regenerating — fails CI.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { flattenRoutes } from '../api/_route_table.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(here, '..', 'public', 'agents.json');

/** Static, non-route metadata preserved verbatim from the committed file. */
const STATIC_METADATA = {
  $schema: 'https://spec.agentproviders.dev/schemas/agents.v1.json',
  name: 'llm-prefill-decode-visualizer',
  description:
    'LLM inference performance math: TTFT, TPOT, walltime for single-turn chat, agentic loops, batched serving, speculative decoding, and KV-cache VRAM. Includes community-measured hardware benchmarks.',
  url: 'https://llm-prefill-decode-visualizer.vercel.app',
  docs: '/llms.txt',
};

/** Build the full agents.json document from the route table. */
export function buildAgentsJson() {
  return {
    ...STATIC_METADATA,
    endpoints: flattenRoutes().map((r) => ({
      path: r.path,
      method: r.method,
      description: r.description,
      sinceVersion: r.sinceVersion,
    })),
    auth: 'none',
    cors: true,
  };
}

function main() {
  const doc = buildAgentsJson();
  const serialized = JSON.stringify(doc, null, 2) + '\n';

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
    if (current !== serialized) {
      console.error(`agents.json is stale — run: node scripts/generate-agents-json.mjs`);
      process.exit(1);
    }
    console.log(`agents.json up to date (${doc.endpoints.length} endpoint entries)`);
    return;
  }

  fs.writeFileSync(outPath, serialized);
  console.log(`wrote ${outPath} (${doc.endpoints.length} endpoint entries)`);
}

// Only run the CLI when executed directly (the drift test imports the builder).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
