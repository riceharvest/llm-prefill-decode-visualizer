import { getAllRuns } from '../_localmaxxing.js';
import { csvEscape, toCsv, csvPreamble, buildJsonPayload, COLUMNS, DATASET_VERSION, CSV_BOM } from '../_export.js';
import { SCHEMA_VERSION, applySchemaHeaders, applyRangeGuard } from '../_schema.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { sendProblem, sendProblemFromError } from '../_errors.js';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/export — full comparable dataset as a downloadable file.
 *
 * ?format=csv|json   default csv
 * CSV: RFC 4180, `#`-comment preamble carrying metadata + data dictionary.
 * JSON: envelope with structured dataDictionary + runs array.
 *
 * Errors follow the shared problem+json contract (code UPSTREAM_UNAVAILABLE
 * on transient dataset-fetch failures), and the endpoint is method-guarded +
 * rate-limited like its sibling dump endpoint /api/runs (#737).
 */
export default async function handler(req, res) {
  // CORS preflight + method guard (agents/crawlers are first-class consumers).
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(204).end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendProblem(res, req, {
      code: 'METHOD_NOT_ALLOWED',
      detail: `${req.method} is not supported here. Use GET to download the export file.`
    });
  }

  if (!enforceRateLimit(req, res)) return;

  try {
    const format = req.query?.format === 'json' ? 'json' : 'csv';
    // Ranged GETs bypass the CDN cache (#995): a cached body sliced by the
    // edge into a 200-branded partial response is indistinguishable from the
    // full dump for clients that only check the status code.
    const ranged = applyRangeGuard(req, res);
    const runs = await getAllRuns();
    const generatedAt = new Date().toISOString();
    const dateTag = generatedAt.slice(0, 10).replaceAll('-', '');
    const filename = `localmaxxing-comparable-runs-v${DATASET_VERSION}-${dateTag}.${format}`;

    res.statusCode = 200;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', ranged ? 'no-store' : 'public, max-age=600');
    if (ranged) res.setHeader('Accept-Ranges', 'none');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    applySchemaHeaders(res); // X-Schema-Version on both formats (#963)

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // schema_version = the API wire contract version stamped on every
      // response body; legacy schemaVersion (= DATASET_VERSION) kept for
      // existing export consumers. See #963.
      // Trailing newline matches src/utils/exportJson.js serializeJson() so
      // every JSON exporter in this repo agrees on the final byte.
      const payload = { ...buildJsonPayload(runs, generatedAt), schema_version: SCHEMA_VERSION };
      res.end(JSON.stringify(payload, null, 2) + '\n');
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // UTF-8 BOM first so Excel decodes the em-dashes in the `#` preamble
    // correctly; preamble + table are LF-terminated (see toCsv contract).
    res.write(CSV_BOM);
    res.write(csvPreamble(runs.length, generatedAt));
    res.write(toCsv(runs));
    res.end();
  } catch (err) {
    // Problem+json contract (#737): getAllRuns() throws ApiError
    // UPSTREAM_UNAVAILABLE on transient fetch failures; unexpected throws map
    // to INTERNAL. Never leaks raw internal error text. Errors stay inside
    // the schema version contract too (#963).
    applySchemaHeaders(res);
    return sendProblemFromError(res, req, err);
  }
}

// Re-exported for tests / downstream consumers.
export { COLUMNS, DATASET_VERSION, csvEscape, toCsv, csvPreamble, buildJsonPayload };
