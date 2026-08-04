import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// getProductSizes()/migrateProductSizesSeed() now read/write the `product_sizes` DB table
// (plan.md -> "Rollout" step 1), and backend/db/init.js resolves DB_PATH at import time --
// so DB_PATH must be set BEFORE config/index.js (which imports db/init.js) is first
// imported. Dynamic import() inside beforeAll, same env-var-before-import pattern as
// mockup-generator.idempotency.test.js.
let getPipelineConfig;
let getProductSizes;
let getTrendsSeed;
let migrateProductSizesSeed;
let migratePipelineConfigSeed;
let getDb;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-config-test-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../db/init.js'));
  ({ getPipelineConfig, getProductSizes, getTrendsSeed, migrateProductSizesSeed, migratePipelineConfigSeed } = await import(
    './index.js'
  ));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('getPipelineConfig', () => {
  it('returns the pipeline array with the required listing_generator entry', () => {
    const { pipeline } = getPipelineConfig();
    expect(Array.isArray(pipeline)).toBe(true);

    const listingGenerator = pipeline.find((m) => m.module === 'listing_generator');
    expect(listingGenerator).toBeDefined();
    expect(listingGenerator.required).toBe(true);
    expect(listingGenerator.enabled).toBe(true);
  });

  it('returns a fresh object each call (no shared-reference mutation risk)', () => {
    const first = getPipelineConfig();
    first.pipeline.push({ module: 'not_real', enabled: true });
    const second = getPipelineConfig();

    expect(second.pipeline.some((m) => m.module === 'not_real')).toBe(false);
  });
});

describe('migratePipelineConfigSeed', () => {
  it('seeds a pipeline_module_<name>_enabled settings row for each module in pipeline.config.json', () => {
    const db = getDb();
    db.prepare("DELETE FROM settings WHERE key LIKE 'pipeline_module_%'").run();

    const result = migratePipelineConfigSeed();
    expect(result.migrated).toBe(true);
    expect(result.inserted).toBe(3);

    const rows = db
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'pipeline_module_%' ORDER BY key")
      .all();
    expect(rows).toEqual([
      { key: 'pipeline_module_image_analyzer_enabled', value: 'true' },
      { key: 'pipeline_module_listing_generator_enabled', value: 'true' },
      { key: 'pipeline_module_mockup_composer_enabled', value: 'true' },
    ]);
  });

  it('is a no-op once seeded (never overwrites a dashboard-made toggle on a later call)', () => {
    const db = getDb();
    // Simulate a dashboard-made edit to one module's toggle before calling again.
    db.prepare(
      "UPDATE settings SET value = 'false' WHERE key = 'pipeline_module_image_analyzer_enabled'"
    ).run();

    const result = migratePipelineConfigSeed();
    expect(result.migrated).toBe(false);
    expect(result.inserted).toBe(0);

    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'pipeline_module_image_analyzer_enabled'")
      .get();
    expect(row.value).toBe('false');
  });

  it('getPipelineConfig() reflects the seeded/edited settings rows after migration', () => {
    const { pipeline } = getPipelineConfig();
    const analyzer = pipeline.find((m) => m.module === 'image_analyzer');
    expect(analyzer.enabled).toBe(false);

    const listingGenerator = pipeline.find((m) => m.module === 'listing_generator');
    expect(listingGenerator.enabled).toBe(true);
  });
});

describe('getProductSizes (DB-backed)', () => {
  it('is empty before anything has been migrated/inserted', () => {
    expect(getProductSizes()).toEqual({});
  });

  it('reflects rows in product_sizes, keyed by size_key, with dimensions/dpi/mockup_template', () => {
    const db = getDb();
    db.prepare(
      `INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer)
       VALUES ('unit-test-size', '5x7', 300, 'portrait', 'templates/unit-test.png', NULL)`
    ).run();

    const sizes = getProductSizes();
    expect(sizes['unit-test-size']).toEqual({
      dimensions: '5x7',
      dpi: 300,
      orientation: 'portrait',
      mockup_template: 'templates/unit-test.png',
      placement_layer: null,
    });

    db.prepare("DELETE FROM product_sizes WHERE size_key = 'unit-test-size'").run();
  });
});

describe('migrateProductSizesSeed', () => {
  it('seeds product_sizes from product-sizes.json when the table is empty', () => {
    const db = getDb();
    db.prepare('DELETE FROM product_sizes').run();

    const result = migrateProductSizesSeed();
    expect(result.migrated).toBe(true);
    expect(result.inserted).toBeGreaterThan(0);

    const sizes = getProductSizes();
    expect(sizes['8x10-portrait']).toBeDefined();
    expect(sizes['8x10-portrait'].mockup_template).toBe('templates/8x10-frame.png');
  });

  it('is a no-op once product_sizes already has rows (never duplicates or overwrites)', () => {
    const db = getDb();
    const before = db.prepare('SELECT COUNT(*) AS n FROM product_sizes').get().n;
    expect(before).toBeGreaterThan(0);

    const result = migrateProductSizesSeed();
    expect(result.migrated).toBe(false);
    expect(result.inserted).toBe(0);

    const after = db.prepare('SELECT COUNT(*) AS n FROM product_sizes').get().n;
    expect(after).toBe(before);
  });
});

describe('getTrendsSeed', () => {
  it('parses without throwing and returns valid JSON', () => {
    expect(() => getTrendsSeed()).not.toThrow();
    const seed = getTrendsSeed();
    expect(seed).toBeDefined();
  });
});
