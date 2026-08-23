# Contributing

Thanks for contributing! This project is plain-JS ESM + React, built with
Vite, linted with oxlint, and tested with Node's built-in test runner.

## Development gate

Before opening a PR, all three of these must pass from the repo root:

```bash
node --test "**/*.test.js"   # unit + doc-existence tests
oxlint                       # lint
npm run build                # sitemap generation + vite build
```

## Project layout

- `api/` — serverless API. `api/[...path].js` is a single catch-all
  dispatcher that routes `/api/*` to handlers in `api/_handlers/`.
  Co-located `*.test.js` files test each module.
- `src/`, `index.html` — the Vite/React frontend.
- `public/` — static files served at the site root, including the
  agent-facing capability manifest (`agents.json`) and `llms.txt`.
- `tests/` — cross-cutting tests (e.g. doc-existence and manifest checks).
- `docs/` — contributor and agent documentation.

## Docs for AI agents

If you are an AI agent working in this repo or calling its HTTP API, start
with **[docs/AGENT-QUICKSTART.md](docs/AGENT-QUICKSTART.md)**. It covers:

- how to discover the API surface (`/agents.json`, `/llms.txt`, `/api/spec`),
- example calls to every key endpoint,
- running the full test suite locally.

Note: `tests/docs-agent-quickstart.test.js` extracts every example endpoint
URL from that quickstart and fails CI if it references a route that doesn't
exist in `api/[...path].js`. Keep docs and code in sync in the same PR.

## Ground rules

- Never commit directly to `main`; open a feature branch and a PR.
- Never force-push.
- Never commit secrets, tokens, or credentials.
