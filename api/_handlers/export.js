import { getAllRuns } from '../_localmaxxing.js';
import { csvEscape, toCsv, csvPreamble, buildJsonPayload, COLUMNS, DATASET_VERSION } from '../_export.js';
import { SCHEMA_VERSION, applySchemaHeaders } from '../_schema.js';

export const config = { runtime: 'nodejs' };

/**
 * GET /api/export — full comparable dataset as a downloadable file.
 *
 * ?format=csv|json   default csv
 * CSV: RFC 4180, `#`-comment preamble carrying metadata + data dictionary.
 * JSON: envelope with structured dataDictionary + runs array.
 */
export default async function handler(req, res) {
  try {
    const format = req.query?.format === 'json' ? 'json' : 'csv';
    const runs = await getAllRuns();
    const generatedAt = new Date().toISOString();
    const dateTag = generatedAt.slice(0, 10).replaceAll('-', '');
    const filename = `localmaxxing-comparable-runs-v${DATASET_VERSION}-${dateTag}.${format}`;

    res.statusCode = 200;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    applySchemaHeaders(res); // X-Schema-Version on both formats (#963)

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // schema_version = the API wire contract version stamped on every
      // response body; legacy schemaVersion (= DATASET_VERSION) kept for
      // existing export consumers. See #963.
      const payload = { ...buildJsonPayload(runs, generatedAt), schema_version: SCHEMA_VERSION };
      res.end(JSON.stringify(payload, null, 2));
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.write(csvPreamble(runs.length, generatedAt));
    res.write(toCsv(runs));
    res.end();
  } catch (err) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    applySchemaHeaders(res); // errors stay inside the version contract (#963)
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
}

// Re-exported for tests / downstream consumers.
export { COLUMNS, DATASET_VERSION, csvEscape, toCsv, csvPreamble, buildJsonPayload };
