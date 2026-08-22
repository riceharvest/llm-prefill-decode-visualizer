// Catch-all serverless function for Vercel Hobby plan (12-function limit).
// Routes /api/* requests to the individual endpoint handlers.
// Each handler module is imported and dispatched based on the pathname.

import { default as compute } from './_handlers/compute.js';
import { default as presets } from './_handlers/presets.js';
import { default as localmaxxing } from './_handlers/localmaxxing.js';
import { default as benchmarks } from './_handlers/benchmarks.js';
import { default as best } from './_handlers/best.js';
import { default as diff } from './_handlers/diff.js';
import { default as exportHandler } from './_handlers/export.js';
import { default as health } from './_handlers/health.js';
import { default as og } from './_handlers/og.js';
import { default as parseConstraints } from './_handlers/parse-constraints.js';
import { default as sizing } from './_handlers/sizing.js';
import { default as snapshots } from './_handlers/snapshots.js';
import { default as spec } from './_handlers/spec.js';
import { default as vram } from './_handlers/vram.js';
import { default as watch } from './_watch_impl.js';
import { default as watchRss } from './_handlers/rss.xml.js';
import { default as watchDispatch } from './_handlers/dispatch.js';
import { default as calcId } from './_handlers/calc_id.js';

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
