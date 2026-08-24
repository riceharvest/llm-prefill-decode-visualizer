// Generates public/.well-known/mcp.json from the live MCP definitions in
// api/mcp.js (#848).
//
// The manifest used to be a hand-maintained copy of what api/mcp.js serves
// over `initialize` + `tools/list`, and the two had drifted apart: every tool
// description, several property schemas and server.instructions disagreed.
// Now the static manifest is fully generated from the same exported
// constants (TOOLS, SERVER_INFO, INSTRUCTIONS) the wire protocol returns,
// so the surfaces cannot diverge. mcp-manifest.test.js asserts parity.
//
// Manifest-only presentation fields (icons, transports note, resources)
// stay defined here — they have no counterpart on the wire.
//
// Idempotent: same api/mcp.js => byte-identical output. `npm run build`
// runs this before `vite build`.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { TOOLS, SERVER_INFO, INSTRUCTIONS, toolToRequest } from '../api/mcp.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', '.well-known', 'mcp.json');
export const BASE_URL = 'https://llm-prefill-decode-visualizer.vercel.app';

/** REST-mapping hint for a tool, e.g. "/api/compute?model=singleTurn". */
function endpointHint(name) {
  const route = toolToRequest(name);
  if (!route) return undefined;
  const qs = route.query.toString();
  return qs ? `${route.path}?${qs}` : route.path;
}

/** Render the tools array exactly as the live tools/list serves it, plus the endpoint hint. */
export function renderTools(tools = TOOLS) {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    ...(endpointHint(tool.name) ? { endpoint: endpointHint(tool.name) } : {}),
    inputSchema: tool.inputSchema
  }));
}

/** Build the full manifest object. */
export function renderManifest({ tools = TOOLS, serverInfo = SERVER_INFO, instructions = INSTRUCTIONS } = {}) {
  return {
    mcp: {
      version: '1.0',
      protocolVersion: '2025-06-18',
      server: {
        name: serverInfo.name,
        title: serverInfo.title,
        description:
          'Deterministic JSON API for LLM inference performance math: TTFT/TPOT per hardware preset, ' +
          'KV-cache VRAM by architecture and precision, agentic loop walltime with prefix caching, ' +
          'speculative decoding speedups, batching throughput, engine flag deltas, and $/1M-token cost.',
        websiteUrl: `${BASE_URL}/`,
        instructions,
        icons: [
          { src: `${BASE_URL}/favicon.svg`, sizes: ['any'], type: 'image/svg+xml' }
        ]
      },
      transports: {
        http: {
          type: 'streamable-http',
          url: `${BASE_URL}/api/mcp`,
          note: 'Streamable HTTP transport. Tools mirror the REST endpoints below; responses are deterministic JSON (or markdown via Accept header).'
        }
      },
      tools: renderTools(tools),
      resources: [
        { uri: `${BASE_URL}/llms.txt`, name: 'Agent guidance', description: 'When-to-use guidance, endpoint list, versioning policy' },
        { uri: `${BASE_URL}/api/spec`, name: 'OpenAPI spec', description: 'Full machine-readable API schema' }
      ]
    }
  };
}

function main() {
  const json = JSON.stringify(renderManifest(), null, 2) + '\n';
  writeFileSync(OUT, json);
  console.log(`[mcp-manifest] wrote ${TOOLS.length} tools from api/mcp.js -> ${OUT}`);
}

// Run when invoked directly (`node scripts/generate-mcp-manifest.mjs` or via
// npm run build); stay inert when imported by tests.
const invokedDirectly =
  process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly || process.env.GENERATE_MCP_MANIFEST === '1') {
  main();
}
