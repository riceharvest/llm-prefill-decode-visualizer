# llm-prefill-decode-visualizer MCP server

This repo ships a **stdio** MCP server (`mcp/server.js`) that wraps the [LLM Prefill & Decode Visualizer API](https://llm-prefill-decode-visualizer.vercel.app/llms.txt) for local/desktop clients. It is NOT the same surface as the hosted MCP server the site itself serves at `/api/mcp` (Streamable HTTP) — see ["Hosted server"](#hosted-server) below for the 8 hosted tools. Lets any MCP client run inference math and query community-measured hardware benchmarks without hand-rolling HTTP calls.

## Tools

| Tool | Wraps | What it does |
|---|---|---|
| `compute_inference` | `GET /api/compute` | TTFT, TPOT, walltime, throughput, KV-cache VRAM for five scenario types |
| `search_runs` | `GET /api/localmaxxing` | Raw community-measured benchmark runs, filterable by hardware/model/quant |
| `best_configs` | `GET /api/best` | Ranked hardware×model configs by median measured decode/prefill speed |
| `compare_hardware` | `GET /api/best` ×2 | A-vs-B rig comparison: per-model-family deltas + verdict |

## Hosted server

The deployed site also runs its own MCP server over **Streamable HTTP** at
`/api/mcp` (manifest: `/.well-known/mcp.json`). It is a different, larger
toolset — point a Streamable-HTTP-capable client there instead of running this
stdio wrapper when you want live access:

| Hosted tool | Wraps |
|---|---|
| `compute_single_turn` | `GET /api/compute?model=singleTurn` |
| `compute_agentic_loop` | `GET /api/compute?model=agentic` |
| `kv_cache_vram` | KV-cache VRAM math (compute model=kvCache) |
| `vram_from_hf_id` | VRAM fit from a Hugging Face model id (`/api/vram`) |
| `hardware_presets` | `GET /api/presets` |
| `benchmarks` | `GET /api/benchmarks` (grouped medians) |
| `cost_per_1m` | `GET /api/compute?model=cost` |
| `engine_flags` | Engine launch-flag deltas + flagged simulation |

The two servers are independent: tool names, argument schemas and transports
differ, so configure the one your client supports (stdio → this folder,
Streamable HTTP → `/api/mcp`).

## Configuration

- `VISUALIZER_API_URL` — API base URL. Defaults to `https://llm-prefill-decode-visualizer.vercel.app`. Point it at a local dev server (`http://localhost:3000`) or a self-hosted deployment.

## Install

```bash
cd mcp
npm install
```

## Run

```bash
node server.js
# or: npm start
```

Speaks MCP over stdio — it is not meant to be visited in a browser.

## Register with an MCP client

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "llm-prefill-decode-visualizer": {
      "command": "node",
      "args": ["/absolute/path/to/llm-prefill-decode-visualizer/mcp/server.js"],
      "env": {
        "VISUALIZER_API_URL": "https://llm-prefill-decode-visualizer.vercel.app"
      }
    }
  }
}
```

Any spec-compliant client (`claude mcp add`, Cursor, etc.):

```bash
claude mcp add llm-pvdv -- node /absolute/path/to/llm-prefill-decode-visualizer/mcp/server.js
```

Or after `npm install`, via the packaged bin:

```bash
npx llm-pvdv-mcp
```

## Smoke test

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}\n{"jsonrpc":"2.0","method":"notifications/initialized"}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' | node server.js
```
