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
let getDb;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-config-test-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../db/init.js'));
  ({ getPipelineConfig, getProductSizes, getTrendsSeed, migrateProductSizesSeed } = await import('./index.js'));
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
