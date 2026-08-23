// Dump the OpenAPI document served by /api/spec to a static JSON file.
// Usage: node scripts/dump-openapi.mjs [output-path]
// Used by CI (.github/workflows/sdk.yml) to generate typed clients from the
// spec as it exists in the repo, before any deploy.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outPath = process.argv[2] || path.join(here, '..', 'openapi.json');

const { default: handler } = await import(path.join(here, '..', 'api', '_handlers', 'spec.js'));

// Minimal mock of the Vercel/Node response object the handler writes to.
const chunks = [];
const headers = {};
const res = {
  statusCode: 200,
  setHeader(k, v) { headers[k.toLowerCase()] = v; },
  getHeader(k) { return headers[String(k).toLowerCase()]; },
  end(body) { chunks.push(String(body)); },
};

handler({ method: 'GET', url: '/api/spec' }, res);

if (res.statusCode !== 200) {
  console.error(`spec handler returned ${res.statusCode}`);
  process.exit(1);
}

const spec = JSON.parse(chunks.join(''));
if (spec.openapi !== '3.1.0' || !spec.info?.version) {
  console.error('unexpected spec document shape');
  process.exit(1);
}

fs.writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n');
console.log(`wrote ${outPath} (openapi ${spec.openapi}, version ${spec.info.version})`);
