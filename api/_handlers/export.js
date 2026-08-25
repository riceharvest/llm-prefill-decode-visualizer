import { getAllRuns } from '../_localmaxxing.js';
import { csvEscape, toCsv, csvPreamble, buildJsonPayload, COLUMNS, DATASET_VERSION, CSV_BOM } from '../_export.js';
import { problemBody } from '../_errors.js';

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

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // Trailing newline matches src/utils/exportJson.js serializeJson() so
      // every JSON exporter in this repo agrees on the final byte.
      res.end(JSON.stringify(buildJsonPayload(runs, generatedAt), null, 2) + '\n');
      return;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // UTF-8 BOM first so Excel decodes the em-dashes in the `#` preamble
    // correctly; preamble + table are LF-terminated (see toCsv contract).
    res.write(CSV_BOM);
    res.write(csvPreamble(runs.length, generatedAt));
    res.write(toCsv(runs));
    res.end();
  } catch {
    // Unify with the API-wide RFC 9457 error contract (#687): serve a fixed
    // INTERNAL problem+json instead of leaking `String(err.message)` as
    // application/json.
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/problem+json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(problemBody({ code: 'INTERNAL', instance: req.url })));
  }
}

// Re-exported for tests / downstream consumers.
export { COLUMNS, DATASET_VERSION, csvEscape, toCsv, csvPreamble, buildJsonPayload };
