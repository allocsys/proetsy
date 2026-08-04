import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJsonConfig(filename) {
  const filePath = path.join(__dirname, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// pipeline.config.json is now only a one-time seed for each module's enabled flag (see
// migratePipelineConfigSeed() and getPipelineConfig() below) -- module *order* and
// *required*-ness stay defined in the JSON file (not dashboard-editable), only
// *enabled* moves to the DB-backed `settings` table, same key/value table used for
// every other dashboard-editable setting. Not exported -- nothing outside this file
// should read the JSON file's `enabled` values directly anymore.
function loadPipelineConfigJsonSeed() {
  return loadJsonConfig('pipeline.config.json');
}

function pipelineEnabledSettingKey(moduleName) {
  return `pipeline_module_${moduleName}_enabled`;
}

/**
 * One-time migration: for each module in pipeline.config.json, if its
 * `pipeline_module_<name>_enabled` settings key doesn't exist yet, seed it from the
 * JSON file's `enabled` value. Meant to be called once on backend startup (server.js)
 * so an existing hand-edited pipeline.config.json doesn't lose its configured toggles
 * when upgrading to the dashboard-editable flow.
 *
 * Safe to call on every startup -- only inserts a settings row the first time each
 * module is seen (ON CONFLICT DO NOTHING), so a restart never overwrites a
 * dashboard-made toggle.
 */
export function migratePipelineConfigSeed() {
  const db = getDb();
  let seed;
  try {
    seed = loadPipelineConfigJsonSeed();
  } catch {
    return { migrated: false, inserted: 0 };
  }
  const modules = seed?.pipeline || [];
  if (!modules.length) return { migrated: false, inserted: 0 };

  const insert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING'
  );
  const run = db.transaction(() => {
    let inserted = 0;
    for (const entry of modules) {
      const { changes } = insert.run(pipelineEnabledSettingKey(entry.module), String(Boolean(entry.enabled)));
      inserted += changes;
    }
    return inserted;
  });
  const inserted = run();
  if (inserted > 0) invalidatePipelineConfigCache();
  return { migrated: inserted > 0, inserted };
}

// getPipelineConfig() result cache (debug.md step 5) -- avoids a DB round-trip + JSON
// re-join on every call. Invalidated here on startup seeding and by server.js's
// PATCH /api/settings whenever a dashboard toggle could have changed a module's
// `enabled` value; never invalidated based on which specific key changed, since the
// cost of an extra rebuild on an unrelated settings PATCH is negligible next to the
// risk of missing an invalidation and serving a stale pipeline config.
let pipelineConfigCache = null;

export function invalidatePipelineConfigCache() {
  pipelineConfigCache = null;
}

/**
 * Reads the pipeline config: module list/order/required-ness from pipeline.config.json
 * (unchanged, not dashboard-editable), each module's `enabled` flag from the DB-backed
 * `settings` table (dashboard-editable, see migratePipelineConfigSeed() above and
 * PATCH /api/settings). Falls back to the JSON file's own `enabled` value for a module
 * whose settings key hasn't been seeded yet, so this never returns `undefined` for
 * `enabled`.
 */
export function getPipelineConfig() {
  if (pipelineConfigCache) return pipelineConfigCache;

  const jsonConfig = loadPipelineConfigJsonSeed();
  const db = getDb();
  const modules = jsonConfig?.pipeline || [];
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${modules.map(() => '?').join(',') || "''"})`
    )
    .all(...modules.map((m) => pipelineEnabledSettingKey(m.module)));
  const overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  pipelineConfigCache = {
    ...jsonConfig,
    pipeline: modules.map((entry) => {
      const key = pipelineEnabledSettingKey(entry.module);
      const enabled = key in overrides ? overrides[key] === 'true' : Boolean(entry.enabled);
      return { ...entry, enabled };
    }),
  };
  return pipelineConfigCache;
}

/**
 * Reads product size / mockup template config from the `product_sizes` DB table --
 * the live, dashboard-editable source of truth (plan.md -> "Backend changes" -> "4."),
 * not a static JSON file. A fresh query every call, same "always current" property the
 * old JSON-file read had, no caching to invalidate.
 *
 * Return shape is unchanged from the old JSON-file format on purpose, so every existing
 * caller (mockup-generator.js's composeMockup()/generateMockupForJob(), the
 * GET /api/config/product-sizes route) keeps working without any changes of its own: an
 * object keyed by `size_key`, each entry having `dimensions`, `dpi`, `orientation`,
 * `mockup_template`, `placement_layer`.
 */
// A row needs at least these to be usable by mockup-generator.js's composeMockup() --
// the same "dimensions + mockup_template_path present" definition /api/setup-status
// uses to decide whether product sizing counts as configured (see server.js's
// hasProductSize check), kept here as the single source of truth for both.
function isValidProductSizeRow(row) {
  return Boolean(row.size_key) && Boolean(row.dimensions) && Boolean(row.mockup_template_path);
}

export function getProductSizes() {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer FROM product_sizes'
    )
    .all();

  const result = {};
  for (const row of rows) {
    if (!isValidProductSizeRow(row)) {
      // Dashboard-editable table -- a half-filled row (e.g. mid-edit, or
      // mockup_template_path cleared without a replacement) shouldn't silently reach
      // mockup-generator.js and fail deep inside image composition. Skipped, not
      // thrown, so one bad row doesn't take down every other configured size.
      console.warn(`getProductSizes: skipping invalid product_sizes row (size_key=${row.size_key ?? '(missing)'})`);
      continue;
    }
    result[row.size_key] = {
      dimensions: row.dimensions,
      dpi: row.dpi,
      orientation: row.orientation,
      mockup_template: row.mockup_template_path,
      placement_layer: row.placement_layer,
    };
  }
  return result;
}
