# Generated API clients

Typed clients for the Agent API, generated in CI from the OpenAPI 3.1 document
served at [`/api/spec`](https://llm-prefill-decode-visualizer.vercel.app/api/spec)
by [`.github/workflows/sdk.yml`](../.github/workflows/sdk.yml). **Do not edit
these files by hand** — changes are overwritten on the next regeneration.

| Path | What |
| --- | --- |
| `VERSION` | Schema/API version the clients were generated from (spec `info.version`). Breaking changes show up as a diff here first. |
| `typescript/schema.d.ts` | TypeScript types for every path, parameter, and response ([openapi-typescript](https://github.com/openapi-ts/openapi-typescript)). |
| `python/` | Full Python client package ([openapi-python-client](https://github.com/openapi-generators/openapi-python-client)): models, sync + async APIs, `pyproject.toml`. |

## Using them

**TypeScript** — pair the types with any fetch wrapper:

```ts
import type { paths } from './clients/typescript/schema';
import type { operation } from 'openapi-typescript-helpers';

type BestQuery = paths['/api/best']['get']['parameters']['query'];
```

**Python** — install the folder as a local dependency:

```bash
pip install ./clients/python
```

```python
from llm_prefill_decode_speed_visualizer_api_client import Client
from llm_prefill_decode_speed_visualizer_api_client.api.default import best

client = Client(base_url="https://llm-prefill-decode-visualizer.vercel.app")
r = best.sync(client=client, by="decode", max_params_b=8.0)
```

## Regenerating locally

```bash
node scripts/dump-openapi.mjs openapi.json
npx openapi-typescript openapi.json -o clients/typescript/schema.d.ts
openapi-python-client generate --path openapi.json --output-path clients/python
```

CI regenerates on every push to `main` that touches `api/**` and commits the
result, so a spec change that breaks a client type is caught in review.
