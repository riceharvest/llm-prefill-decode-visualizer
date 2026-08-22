// Catch-all serverless function for Vercel Hobby plan (12-function limit).
// Routes /api/* requests to the individual endpoint handlers.
// Each handler module is imported and dispatched based on the pathname.

import { handler as compute } from './handlers/compute.js';
import { handler as presets } from './handlers/presets.js';
import { handler as localmaxxing } from './handlers/localmaxxing.js';
import { handler as benchmarks } from './handlers/benchmarks.js';
import { handler as best } from './handlers/best.js';
import { handler as diff } from './handlers/diff.js';
import { handler as exportHandler } from './handlers/export.js';
import { handler as health } from './handlers/health.js';
import { handler as og } from './handlers/og.js';
import { handler as parseConstraints } from './handlers/parse-constraints.js';
import { handler as sizing } from './handlers/sizing.js';
import { handler as snapshots } from './handlers/snapshots.js';
import { handler as spec } from './handlers/spec.js';
import { handler as vram } from './handlers/vram.js';
import { handler as watch } from './handlers/watch.js';
import { handler as watchRss } from './handlers/rss.xml.js';
import { handler as watchDispatch } from './handlers/dispatch.js';
import { handler as calcId } from './handlers/calc_id.js';

export const config = { runtime: 'nodejs' };

function json(res, body, status = 200) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body, null, 2));
}

export default async function handler(req, res) {
  const pathname = (req.url || '').split('?')[0].replace(/^\/api\/?/, '/');

  try {
    // Strip /v1/ prefix if present (versioning rewrite)
    const clean = pathname.replace(/^\/v1\//, '/');

    switch (clean) {
      case '/compute': return compute(req, res);
      case '/presets': return presets(req, res);
      case '/localmaxxing': return localmaxxing(req, res);
      case '/benchmarks': return benchmarks(req, res);
      case '/best': return best(req, res);
      case '/diff': return diff(req, res);
      case '/export': return exportHandler(req, res);
      case '/health': return health(req, res);
      case '/og': return og(req, res);
      case '/parse-constraints': return parseConstraints(req, res);
      case '/sizing': return sizing(req, res);
      case '/snapshots': return snapshots(req, res);
      case '/spec': return spec(req, res);
      case '/vram': return vram(req, res);
      case '/watch': return watch(req, res);
      case '/watch/rss.xml': return watchRss(req, res);
      case '/watch/dispatch': return watchDispatch(req, res);
      default:
        // /api/calc/<id>
        const calcMatch = clean.match(/^\/calc\/([^/]+)$/);
        if (calcMatch) {
          req.query = { ...req.query, id: calcMatch[1] };
          return calcId(req, res);
        }
        return json(res, { error: 'Not found', path: pathname }, 404);
    }
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 500);
  }
}
