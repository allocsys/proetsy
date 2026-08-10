import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads process.env.DB_PATH at import time (top-level `const DB_PATH = ...`)
// and keeps a module-level `db` singleton — same pattern already noted in
// mockup-generator.psd.test.js ("these modules read env-driven paths at import time...
// so the env vars must be set BEFORE they're imported"). Each test here that needs a
// genuinely fresh DB/module state sets DB_PATH first, then does a fresh dynamic
// import('./init.js') after vi.resetModules() clears vitest's module cache — otherwise
// a second import() would just return the same already-initialized module and its
// already-open `db` handle from an earlier test.

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-db-init-'));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  delete process.env.DB_PATH;
});

describe('getDb', () => {
  it('creates the DB file (and its parent directory) at DB_PATH', async () => {
    const dbPath = path.join(tmpRoot, 'nested', 'proetsy.db');
    process.env.DB_PATH = dbPath;
    const { getDb } = await import('./init.js');

    getDb();

    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('is a singleton within one module instance — repeated calls return the same connection', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');

    expect(getDb()).toBe(getDb());
  });

  it('sets WAL journal mode and enforces foreign keys', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('schema creation', () => {
  it('creates every core table schema.sql defines', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);

    const expectedTables = [
      'artworks',
      'jobs',
      'job_modules',
      'product_sizes',
      'listings',
      'mockups',
      'tags',
      'settings',
      'trends',
      'prompts',
      'image_preferences',
      'taste_centroids',
      'prompt_terms',
      'llm_rate_limits',
    ];
    for (const table of expectedTables) {
      expect(tableNames).toContain(table);
    }
  });
});

describe('runDefensiveMigrations (via getDb — not exported separately)', () => {
  it('is a no-op against a freshly created DB whose schema.sql already bakes in the migrated columns', async () => {
    // schema.sql already defines placement_layer/ai_extended_path/smart_crop_path/
    // needs_review/selected_variant/kept_count/discarded_count directly for a brand-new
    // DB — getDb() still runs runDefensiveMigrations()'s ALTER TABLE statements against
    // it every time regardless, so this confirms the "duplicate column" try/catch
    // actually swallows that (expected, every-single-startup) case without throwing.
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');

    expect(() => getDb()).not.toThrow();
  });

  it('leaves the migrated columns present with their documented defaults', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    const mockupColumns = db.prepare('PRAGMA table_info(mockups)').all().map((c) => c.name);
    expect(mockupColumns).toEqual(
      expect.arrayContaining(['ai_extended_path', 'smart_crop_path', 'needs_review', 'selected_variant'])
    );

    const productSizeColumns = db.prepare('PRAGMA table_info(product_sizes)').all().map((c) => c.name);
    expect(productSizeColumns).toContain('placement_layer');
    expect(productSizeColumns).toContain('category');

    const centroidColumns = db.prepare('PRAGMA table_info(taste_centroids)').all().map((c) => c.name);
    expect(centroidColumns).toEqual(expect.arrayContaining(['kept_count', 'discarded_count']));
  });

  it('defaults needs_review to 0, selected_variant to "smart_crop", and centroid counts to 0 on insert', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    const { lastInsertRowid: artworkId } = db.prepare('INSERT INTO artworks (file_path) VALUES (?)').run('/tmp/a.png');
    const { lastInsertRowid: jobId } = db.prepare('INSERT INTO jobs (artwork_id) VALUES (?)').run(artworkId);
    db.prepare('INSERT INTO product_sizes (size_key) VALUES (?)').run('test-size');
    const { id: sizeId } = db.prepare('SELECT id FROM product_sizes WHERE size_key = ?').get('test-size');
    db.prepare('INSERT INTO mockups (job_id, product_size_id, file_path) VALUES (?, ?, ?)').run(
      jobId,
      sizeId,
      '/tmp/mockup.png'
    );

    const mockup = db.prepare('SELECT * FROM mockups WHERE job_id = ?').get(jobId);
    expect(mockup.needs_review).toBe(0);
    expect(mockup.selected_variant).toBe('smart_crop');

    db.prepare('INSERT INTO taste_centroids (category) VALUES (NULL)').run();
    const centroid = db.prepare('SELECT * FROM taste_centroids').get();
    expect(centroid.kept_count).toBe(0);
    expect(centroid.discarded_count).toBe(0);

    const productSize = db.prepare('SELECT * FROM product_sizes WHERE size_key = ?').get('test-size');
    expect(productSize.category).toBeNull();
  });

  it('lets product_sizes.category be set on insert or update, freeform (no CHECK constraint)', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    db.prepare('INSERT INTO product_sizes (size_key, category) VALUES (?, ?)').run('mug-11oz', 'mug');
    expect(db.prepare('SELECT category FROM product_sizes WHERE size_key = ?').get('mug-11oz').category).toBe(
      'mug'
    );

    db.prepare('UPDATE product_sizes SET category = ? WHERE size_key = ?').run('green space', 'mug-11oz');
    expect(db.prepare('SELECT category FROM product_sizes WHERE size_key = ?').get('mug-11oz').category).toBe(
      'green space'
    );
  });

  it('re-running getDb() in a fresh module instance against an already-migrated on-disk DB does not throw', async () => {
    // The actual real-world case runDefensiveMigrations()'s try/catch exists for: a
    // second backend process start (or --watch reload) against a DB file that already
    // has every migrated column from a prior run — not just schema.sql's own baked-in
    // columns. vi.resetModules() + a second dynamic import() gives a genuinely fresh
    // module-level `db` singleton, still pointed at the SAME on-disk file, so
    // runDefensiveMigrations() has to hit "duplicate column" and swallow it for real.
    const dbPath = path.join(tmpRoot, 'proetsy.db');
    process.env.DB_PATH = dbPath;
    const first = await import('./init.js');
    first.getDb();

    vi.resetModules();
    process.env.DB_PATH = dbPath;
    const second = await import('./init.js');

    expect(() => second.getDb()).not.toThrow();
  });

  it('dedupes existing image_preferences rows by image_path before creating the unique index, preferring a manual label over an auto-labeled one', async () => {
    // Simulates a pre-existing DB (created before idx_image_preferences_image_path
    // existed) that already has a
    // duplicate image_path -- the exact case the pre-migration cleanup exists for: an
    // older auto-labeled row (auto_labeled = 1) plus a newer manual correction
    // (auto_labeled = 0) for the same image. Built directly with better-sqlite3 rather
    // than through getDb(), since schema.sql now bakes the unique index into a
    // brand-new DB and would reject the duplicate insert below.
    const dbPath = path.join(tmpRoot, 'proetsy.db');
    process.env.DB_PATH = dbPath;

    const Database = (await import('better-sqlite3')).default;
    const seedDb = new Database(dbPath);
    seedDb.exec(`
      CREATE TABLE image_preferences (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_path TEXT NOT NULL,
        embedding BLOB,
        label TEXT NOT NULL,
        category TEXT,
        prompt_id INTEGER,
        promoted_artwork_id INTEGER,
        auto_labeled INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    seedDb
      .prepare('INSERT INTO image_preferences (image_path, label, auto_labeled, created_at) VALUES (?, ?, ?, ?)')
      .run('/candidates/duplicate.png', 'discard', 1, '2026-01-01T00:00:00Z');
    seedDb
      .prepare('INSERT INTO image_preferences (image_path, label, auto_labeled, created_at) VALUES (?, ?, ?, ?)')
      .run('/candidates/duplicate.png', 'keep', 0, '2026-01-02T00:00:00Z');
    seedDb.close();

    const { getDb } = await import('./init.js');
    expect(() => getDb()).not.toThrow();
    const db = getDb();

    const rows = db.prepare('SELECT * FROM image_preferences WHERE image_path = ?').all('/candidates/duplicate.png');
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('keep');
    expect(rows[0].auto_labeled).toBe(0);
  });

  it('is a no-op on a DB with no duplicate image_path rows', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    db.prepare('INSERT INTO image_preferences (image_path, label) VALUES (?, ?)').run('/candidates/a.png', 'keep');
    db.prepare('INSERT INTO image_preferences (image_path, label) VALUES (?, ?)').run('/candidates/b.png', 'discard');

    vi.resetModules();
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const reopened = await import('./init.js');
    expect(() => reopened.getDb()).not.toThrow();

    const rows = reopened.getDb().prepare('SELECT image_path FROM image_preferences ORDER BY image_path').all();
    expect(rows.map((r) => r.image_path)).toEqual(['/candidates/a.png', '/candidates/b.png']);
  });

  it('creates idx_image_preferences_image_path as a unique index, rejecting a second insert for the same image_path', async () => {
    process.env.DB_PATH = path.join(tmpRoot, 'proetsy.db');
    const { getDb } = await import('./init.js');
    const db = getDb();

    db.prepare('INSERT INTO image_preferences (image_path, label) VALUES (?, ?)').run('/candidates/one.png', 'keep');
    expect(() =>
      db.prepare('INSERT INTO image_preferences (image_path, label) VALUES (?, ?)').run('/candidates/one.png', 'discard')
    ).toThrow(/UNIQUE constraint failed/);
  });
});
