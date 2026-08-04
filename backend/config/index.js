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
 * JSON file's `enabled` value. Meant to be called once on backend startup (server.js,
 * alongside migrateProductSizesSeed()) so an existing hand-edited pipeline.config.json
 * doesn't lose its configured toggles when upgrading to the dashboard-editable flow.
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
  } catch (err) {
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
  return { migrated: inserted > 0, inserted };
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
  const jsonConfig = loadPipelineConfigJsonSeed();
  const db = getDb();
  const modules = jsonConfig?.pipeline || [];
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${modules.map(() => '?').join(',') || "''"})`
    )
    .all(...modules.map((m) => pipelineEnabledSettingKey(m.module)));
  const overrides = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return {
    ...jsonConfig,
    pipeline: modules.map((entry) => {
      const key = pipelineEnabledSettingKey(entry.module);
      const enabled = key in overrides ? overrides[key] === 'true' : Boolean(entry.enabled);
      return { ...entry, enabled };
    }),
  };
}

// product-sizes.json is now only a one-time seed for the `product_sizes` DB table (see
// migrateProductSizesSeed() and getProductSizes() below, and plan.md -> "Backend changes"
// -> "4. getProductSizes() becomes DB-backed, JSON becomes a one-time seed"). Not exported
// -- nothing outside this file should read the JSON file directly anymore.
function loadProductSizesJsonSeed() {
  return loadJsonConfig('product-sizes.json');
}

/**
 * One-time migration: if the `product_sizes` table is empty and `product-sizes.json` has
 * entries, insert them. Meant to be called once on backend startup (server.js, alongside
 * getDb()'s existing schema init) so an existing dev setup with a hand-edited JSON file
 * doesn't lose its configured sizes when upgrading to the DB-backed dashboard flow.
 *
 * Safe to call on every startup -- only actually inserts anything the very first time
 * (product_sizes still empty); every subsequent call is a fast read-only no-op, so a
 * restart never re-seeds or overwrites dashboard-made edits. After the first successful
 * migration, product-sizes.json is inert: getProductSizes() below never reads it again.
 * The file itself is intentionally left in place (not deleted) as a legacy record -- see
 * plan.md -> "Out of scope".
 *
 * @returns {{ migrated: boolean, inserted: number }}
 */
export function migrateProductSizesSeed() {
  const db = getDb();
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM product_sizes').get();
  if (n > 0) return { migrated: false, inserted: 0 };

  let seed;
  try {
    seed = loadProductSizesJsonSeed();
  } catch (err) {
    // No seed file, or it doesn't parse -- nothing to migrate. Not fatal to startup, since
    // an empty product_sizes table is already a valid (if unconfigured) state.
    return { migrated: false, inserted: 0 };
  }

  const entries = Object.entries(seed);
  if (!entries.length) return { migrated: false, inserted: 0 };

  const insert = db.prepare(`
    INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer)
    VALUES (@size_key, @dimensions, @dpi, @orientation, @mockup_template_path, @placement_layer)
    ON CONFLICT(size_key) DO NOTHING
  `);
  const run = db.transaction((rows) => {
    for (const [sizeKey, entry] of rows) {
      insert.run({
        size_key: sizeKey,
        dimensions: entry.dimensions || null,
        dpi: entry.dpi || null,
        orientation: entry.orientation || null,
        mockup_template_path: entry.mockup_template || null,
        placement_layer: entry.placement_layer || null,
      });
    }
  });
  run(entries);

  return { migrated: true, inserted: entries.length };
}

/**
 * Reads product size / mockup template config from the `product_sizes` DB table -- now
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
export function getProductSizes() {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer FROM product_sizes'
    )
    .all();

  const result = {};
  for (const row of rows) {
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
