import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, withTransaction } from '../db/init.js';
import { SHOP_CONVENTIONS, MIDJOURNEY_CONVENTIONS } from './shop-conventions.js';

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
  const inserted = withTransaction(db, () => {
    let count = 0;
    for (const entry of modules) {
      const { changes } = insert.run(pipelineEnabledSettingKey(entry.module), String(Boolean(entry.enabled)));
      count += changes;
    }
    return count;
  });
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
  if (!pipelineConfigCache) {
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
  }

  // Fresh shallow copy on every call, even when served from cache -- preserves the
  // pre-caching contract (existing test: "returns a fresh object each call, no
  // shared-reference mutation risk") so a caller mutating what it got back (e.g.
  // pushing into `.pipeline`) can't corrupt the cache for the next caller. The DB
  // round-trip above is still skipped on a cache hit, which is the actual point.
  return { ...pipelineConfigCache, pipeline: pipelineConfigCache.pipeline.map((entry) => ({ ...entry })) };
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

// Dashboard-editable shop/Midjourney conventions (plan.md -> "Dashboard-Editable Shop
// Conventions"). Backed by the same generic `settings` key/value table as everything
// else -- SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS (imported above) are now only the
// *defaults* used when a settings key hasn't been set yet, not the live values. Numeric
// and array/object fields are stored as strings (like every other settings row) and
// parsed back to their real type on read here -- callers never touch raw settings rows
// for these fields. `LISTING_VARIATIONS` is deliberately not part of this -- it's
// structural (fixed DB columns/UNIQUE constraints, dashboard component names), not a
// simple editable value; see plan.md's "Not in scope" note.
const SHOP_CONVENTION_FIELDS = [
  { key: 'sc_titleSeparator', group: 'listing', field: 'titleSeparator', type: 'string' },
  { key: 'sc_maxTitleLength', group: 'listing', field: 'maxTitleLength', type: 'int' },
  { key: 'sc_tagsPerListing', group: 'listing', field: 'tagsPerListing', type: 'int' },
  { key: 'sc_tagAlternates', group: 'listing', field: 'tagAlternates', type: 'int' },
  { key: 'sc_maxTagLength', group: 'listing', field: 'maxTagLength', type: 'int' },
  { key: 'sc_forbiddenTitleWords', group: 'listing', field: 'forbiddenTitleWords', type: 'stringArray' },
  { key: 'sc_aiDisclosurePhrases', group: 'listing', field: 'aiDisclosurePhrases', type: 'stringArray' },
  { key: 'sc_deliveryDetailPhrases', group: 'listing', field: 'deliveryDetailPhrases', type: 'stringArray' },
  { key: 'mj_version', group: 'midjourney', field: 'version', type: 'string' },
  { key: 'mj_style', group: 'midjourney', field: 'style', type: 'string' },
  { key: 'mj_stylizeMin', group: 'midjourney', field: 'stylizeMin', type: 'int' },
  { key: 'mj_stylizeMax', group: 'midjourney', field: 'stylizeMax', type: 'int' },
  { key: 'mj_defaultStylize', group: 'midjourney', field: 'defaultStylize', type: 'int' },
  { key: 'mj_aspectRatioByOrientation', group: 'midjourney', field: 'aspectRatioByOrientation', type: 'object' },
];

function defaultForField(def) {
  const source = def.group === 'listing' ? SHOP_CONVENTIONS : MIDJOURNEY_CONVENTIONS;
  return source[def.field];
}

function parseStoredValue(def, raw) {
  switch (def.type) {
    case 'int':
      return Number(raw);
    case 'stringArray':
    case 'object':
      return JSON.parse(raw);
    default:
      return raw;
  }
}

function serializeValue(def, value) {
  switch (def.type) {
    case 'stringArray':
    case 'object':
      return JSON.stringify(value);
    default:
      return String(value);
  }
}

/**
 * Reads shop/Midjourney conventions: dashboard-edited values from the `settings` table
 * where set, falling back to SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS's hardcoded
 * defaults for anything unset. No caching (unlike getPipelineConfig()) -- queried fresh
 * every call, same as getProductSizes() above; see plan.md's rationale for not adding a
 * cache yet (no established invalidation hook, and this is on the generation hot path
 * from validate.js/prompt.js, not a per-request-heavy route). Returns
 * { listing: {...}, midjourney: {...} } -- same shape the pre-existing
 * GET /api/config/shop-conventions route already returned when it read the static
 * import directly, so no response-shape change for existing callers.
 */
export function getShopConventions() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN (${SHOP_CONVENTION_FIELDS.map(() => '?').join(',')})`
    )
    .all(...SHOP_CONVENTION_FIELDS.map((f) => f.key));
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const result = { listing: {}, midjourney: {} };
  for (const def of SHOP_CONVENTION_FIELDS) {
    const value = def.key in stored ? parseStoredValue(def, stored[def.key]) : defaultForField(def);
    result[def.group][def.field] = value;
  }
  return result;
}

function validateFieldValue(def, value) {
  switch (def.type) {
    case 'string':
      if (typeof value !== 'string' || !value.length) {
        throw new Error(`${def.field} must be a non-empty string`);
      }
      break;
    case 'int':
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${def.field} must be a positive integer`);
      }
      break;
    case 'stringArray':
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v.length)) {
        throw new Error(`${def.field} must be an array of non-empty strings`);
      }
      break;
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${def.field} must be a plain object`);
      }
      for (const [k, v] of Object.entries(value)) {
        if (typeof v !== 'string' || !/^\d+:\d+$/.test(v)) {
          throw new Error(`${def.field}.${k} must be a "W:H" aspect ratio string`);
        }
      }
      break;
    }
    default:
      break;
  }
}

/**
 * Upserts a partial set of shop/Midjourney conventions into the `settings` table.
 * `partial` shape: { listing?: {...subset of SHOP_CONVENTIONS fields}, midjourney?:
 * {...subset of MIDJOURNEY_CONVENTIONS fields} } -- partial at both the top level and
 * within each group, matching PATCH /api/settings's "each key upserted independently"
 * behavior. Every provided field is validated individually (see validateFieldValue)
 * before anything is written; the merged (existing + incoming) stylizeMin/stylizeMax/
 * defaultStylize trio is then cross-validated so a partial update can't leave it
 * inconsistent even if only one of the three was actually touched. Throws on the first
 * invalid field -- nothing is written if any field fails validation, since all
 * validation happens before the DB transaction starts. Returns the fresh
 * getShopConventions() result.
 */
const CONFIG_EXPORT_VERSION = 1;

/**
 * Exports every "configuration" table as one importable JSON bundle: the settings table
 * (shop/Midjourney conventions, pipeline module toggles, watch-folder & auto-sort
 * settings, default price/delivery text, etc.), product sizes / configured mockup
 * templates, the tag library, and -- optionally -- LLM provider API keys.
 *
 * Deliberately excludes everything that's *data* rather than *config*: jobs, listings,
 * mockups, artworks, trends, taste-filter labels/centroids, prompts, and
 * llm_rate_limits (transient cooldown state, not worth restoring). Restoring a backup
 * should never touch a shop's actual work in progress -- only how the app is set up.
 *
 * @param {{ includeApiKeys?: boolean }} [options] includeApiKeys defaults to true; set
 *   false to produce a backup with no key material in it (e.g. before sharing a config
 *   file with someone else).
 */
export function exportAllConfig({ includeApiKeys = true } = {}) {
  const db = getDb();
  return {
    version: CONFIG_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: db.prepare('SELECT key, value FROM settings').all(),
    productSizes: db
      .prepare(
        'SELECT size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer, category FROM product_sizes'
      )
      .all(),
    tags: db.prepare('SELECT tag_text, category, source FROM tags').all(),
    apiKeys: includeApiKeys
      ? db.prepare('SELECT provider, key_value, label, enabled FROM api_keys').all()
      : [],
  };
}

/**
 * Restores a bundle produced by exportAllConfig(). Every section is optional/independent
 * -- a bundle missing a section (e.g. `apiKeys` on an includeApiKeys: false export) just
 * leaves that part of the current config untouched. Settings and product sizes are
 * upserted by their natural key (settings.key / product_sizes.size_key), so re-importing
 * the same backup twice is idempotent. Tags and API keys are deduped against what's
 * already there (by tag_text, and by provider+key_value respectively) and only new rows
 * are inserted -- nothing is deleted, so importing an older backup can't silently wipe
 * config added since it was taken. Runs as a single transaction: a malformed bundle
 * fails without partially applying. Returns how many rows were written per section.
 * @param {object} bundle
 */
export function importAllConfig(bundle = {}) {
  const db = getDb();
  const counts = { settings: 0, productSizes: 0, tags: 0, apiKeys: 0 };

  withTransaction(db, () => {
    if (Array.isArray(bundle.settings)) {
      const upsert = db.prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      );
      for (const row of bundle.settings) {
        if (!row || typeof row.key !== 'string') continue;
        upsert.run(row.key, row.value ?? null);
        counts.settings += 1;
      }
    }

    if (Array.isArray(bundle.productSizes)) {
      const upsert = db.prepare(`
        INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer, category)
        VALUES (@size_key, @dimensions, @dpi, @orientation, @mockup_template_path, @placement_layer, @category)
        ON CONFLICT(size_key) DO UPDATE SET
          dimensions = excluded.dimensions,
          dpi = excluded.dpi,
          orientation = excluded.orientation,
          mockup_template_path = excluded.mockup_template_path,
          placement_layer = excluded.placement_layer,
          category = excluded.category
      `);
      for (const row of bundle.productSizes) {
        if (!row || !row.size_key) continue;
        upsert.run({
          size_key: row.size_key,
          dimensions: row.dimensions ?? null,
          dpi: row.dpi ?? null,
          orientation: row.orientation ?? null,
          mockup_template_path: row.mockup_template_path ?? null,
          placement_layer: row.placement_layer ?? null,
          category: row.category ?? null,
        });
        counts.productSizes += 1;
      }
    }

    if (Array.isArray(bundle.tags)) {
      const existingTags = new Set(db.prepare('SELECT tag_text FROM tags').all().map((r) => r.tag_text));
      const insert = db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)');
      for (const row of bundle.tags) {
        if (!row || !row.tag_text || existingTags.has(row.tag_text)) continue;
        insert.run(row.tag_text, row.category ?? null, row.source ?? 'backup');
        existingTags.add(row.tag_text);
        counts.tags += 1;
      }
    }

    if (Array.isArray(bundle.apiKeys)) {
      const existingKeys = new Set(
        db.prepare('SELECT provider, key_value FROM api_keys').all().map((r) => `${r.provider}:${r.key_value}`)
      );
      const insert = db.prepare('INSERT INTO api_keys (provider, key_value, label, enabled) VALUES (?, ?, ?, ?)');
      for (const row of bundle.apiKeys) {
        if (!row || !row.provider || !row.key_value) continue;
        const dedupeKey = `${row.provider}:${row.key_value}`;
        if (existingKeys.has(dedupeKey)) continue;
        insert.run(row.provider, row.key_value, row.label ?? null, row.enabled === false ? 0 : 1);
        existingKeys.add(dedupeKey);
        counts.apiKeys += 1;
      }
    }
  });

  // A settings-table import may have touched a pipeline_module_<n>_enabled key.
  invalidatePipelineConfigCache();
  return counts;
}

export function setShopConventions(partial = {}) {
  const current = getShopConventions();
  const merged = { listing: { ...current.listing }, midjourney: { ...current.midjourney } };
  const toWrite = [];

  for (const def of SHOP_CONVENTION_FIELDS) {
    const group = partial[def.group];
    if (!group || !(def.field in group)) continue;
    const value = group[def.field];
    validateFieldValue(def, value);
    merged[def.group][def.field] = value;
    toWrite.push({ def, value });
  }

  const { stylizeMin, stylizeMax, defaultStylize } = merged.midjourney;
  if (!(stylizeMin <= defaultStylize && defaultStylize <= stylizeMax)) {
    throw new Error('midjourney stylize values must satisfy stylizeMin <= defaultStylize <= stylizeMax');
  }

  if (!toWrite.length) return current;

  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  withTransaction(db, () => {
    for (const { def, value } of toWrite) {
      upsert.run(def.key, serializeValue(def, value));
    }
  });

  return getShopConventions();
}
