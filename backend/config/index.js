import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../db/init.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJsonConfig(filename) {
  const filePath = path.join(__dirname, filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

export function getPipelineConfig() {
  return loadJsonConfig('pipeline.config.json');
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

export function getTrendsSeed() {
  return loadJsonConfig('trends.json');
}
