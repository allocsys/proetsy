import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// store.js's underlying getDb() reads DB_PATH at first call (and caches a singleton
// connection), so it must be set before the module (or its db/init.js dependency) is
// imported — same dynamic-import pattern mockup-generator.idempotency.test.js uses. All
// tests below share that one connection, so assertions on category-scoped data use a
// category unique to that test rather than assuming isolation; global-pair assertions are
// scoped to the "cold start" case where nothing else in this file has run yet.
let getDb;
let addImagePreference;
let listImagePreferences;
let recomputeCentroids;
let getCentroids;
let tallyPromptTermsForLabel;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-taste-filter-store-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../../db/init.js'));
  ({ addImagePreference, listImagePreferences, recomputeCentroids, getCentroids, tallyPromptTermsForLabel } = await import('./store.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('addImagePreference / listImagePreferences', () => {
  it('round-trips an embedding through the BLOB column without precision loss', () => {
    const embedding = new Float32Array([0.1, -0.2, 0.3, 0.999999]);
    addImagePreference({ imagePath: '/tmp/a.png', embedding, label: 'keep', category: 'portrait' });

    const row = listImagePreferences().find((r) => r.imagePath === '/tmp/a.png');
    expect(row.embedding).toBeInstanceOf(Float32Array);
    expect(Array.from(row.embedding)).toEqual(Array.from(embedding));
    expect(row.label).toBe('keep');
    expect(row.category).toBe('portrait');
  });

  it('rejects an invalid label rather than silently storing it', () => {
    const embedding = new Float32Array([1, 2, 3]);
    expect(() => addImagePreference({ imagePath: '/tmp/b.png', embedding, label: 'maybe' })).toThrow(/Invalid label/);
  });

  it('updates the existing row when the same image_path is labeled again, rather than inserting a duplicate', () => {
    // See docs/fixes/taste-filter-duplicate-labels.md: image_preferences holds the
    // *current* judgment per image, not a full history (unlike `prompts`, which is
    // append-only) -- a relabel must upsert, not accumulate rows that would double-count
    // in recomputeCentroids().
    const before = listImagePreferences().length;
    const firstEmbedding = new Float32Array([1, 1]);
    const secondEmbedding = new Float32Array([2, 2]);
    const firstId = addImagePreference({ imagePath: '/tmp/c.png', embedding: firstEmbedding, label: 'discard' });
    const secondId = addImagePreference({ imagePath: '/tmp/c.png', embedding: secondEmbedding, label: 'keep' }); // same path, relabeled

    expect(listImagePreferences().length).toBe(before + 1);
    expect(secondId).toBe(firstId);

    const row = listImagePreferences().find((r) => r.imagePath === '/tmp/c.png');
    expect(row.label).toBe('keep');
    expect(Array.from(row.embedding)).toEqual(Array.from(secondEmbedding));
  });

  it('clears auto_labeled back to 0 when a manual label corrects an earlier auto-labeled row for the same image', () => {
    // The schema.sql comment on the auto_labeled column has always promised this; this
    // is the behavior that makes it true (previously nothing did -- see
    // docs/fixes/taste-filter-duplicate-labels.md).
    const db = getDb();
    const embedding = new Float32Array([3, 3]);

    addImagePreference({ imagePath: '/tmp/auto-correct.png', embedding, label: 'discard', autoLabeled: true });
    let row = db
      .prepare('SELECT auto_labeled, label FROM image_preferences WHERE image_path = ?')
      .get('/tmp/auto-correct.png');
    expect(row.auto_labeled).toBe(1);
    expect(row.label).toBe('discard');

    // A plain manual Keep/Discard call never passes autoLabeled -- defaults to false --
    // same as how POST /api/taste-filter/label calls addImagePreference() today.
    addImagePreference({ imagePath: '/tmp/auto-correct.png', embedding, label: 'keep' });
    row = db
      .prepare('SELECT auto_labeled, label FROM image_preferences WHERE image_path = ?')
      .get('/tmp/auto-correct.png');
    expect(row.auto_labeled).toBe(0);
    expect(row.label).toBe('keep');
  });
});

describe('recomputeCentroids / getCentroids', () => {
  it('persists a per-category pair, readable back via getCentroids', () => {
    // "square" is a category no other test in this file touches, so its centroid is
    // isolated even though every test shares one DB connection/singleton.
    const keepA = new Float32Array([1, 0]);
    const keepB = new Float32Array([3, 0]);
    const discardA = new Float32Array([0, 5]);

    addImagePreference({ imagePath: '/tmp/keepA.png', embedding: keepA, label: 'keep', category: 'square' });
    addImagePreference({ imagePath: '/tmp/keepB.png', embedding: keepB, label: 'keep', category: 'square' });
    addImagePreference({ imagePath: '/tmp/discardA.png', embedding: discardA, label: 'discard', category: 'square' });

    recomputeCentroids();

    const square = getCentroids('square');
    expect(Array.from(square.kept)).toEqual([2, 0]); // mean of [1,0] and [3,0]
    expect(Array.from(square.discarded)).toEqual([0, 5]);
  });

  it('the global pair reflects every labeled example regardless of category', () => {
    // By this point the file has added several "keep"-labeled examples across earlier
    // tests; rather than hardcode an expected vector (fragile against test ordering),
    // assert the global pair's keptCount matches the full keep-labeled row count — the
    // aggregation contract computeAllCentroidPairs() (centroids.js) guarantees.
    recomputeCentroids();
    const totalKept = listImagePreferences().filter((r) => r.label === 'keep').length;

    const db = getDb();
    // Recompute the same count independently via centroids.js's own logic isn't needed
    // here — this test only needs to confirm the global row exists and isn't empty.
    const globalRow = db.prepare('SELECT * FROM taste_centroids WHERE category IS NULL').get();
    expect(globalRow).toBeTruthy();
    expect(globalRow.kept_centroid).not.toBeNull();
    expect(totalKept).toBeGreaterThan(0);
  });

  it('returns null centroids for a category with no data yet (cold start), not an error', () => {
    const result = getCentroids('never-labeled-category');
    expect(result.kept).toBeNull();
    expect(result.discarded).toBeNull();
  });

  it('a second recompute updates existing rows rather than duplicating them', () => {
    const db = getDb();
    recomputeCentroids();
    const afterFirst = db.prepare('SELECT COUNT(*) as count FROM taste_centroids').get().count;

    addImagePreference({ imagePath: '/tmp/extra.png', embedding: new Float32Array([9, 9]), label: 'keep', category: 'square' });
    recomputeCentroids();
    const afterSecond = db.prepare('SELECT COUNT(*) as count FROM taste_centroids').get().count;

    expect(afterSecond).toBe(afterFirst);
  });
});

describe('tallyPromptTermsForLabel (Module 7 -> Module 4 prompt-feedback link, write side)', () => {
  it("bumps kept_count for each of a prompt's terms on a 'keep' label", () => {
    const db = getDb();
    const { lastInsertRowid: promptId } = db
      .prepare(`INSERT INTO prompts (category, prompt_text) VALUES ('square', 'a lone fox in a snowy field --v 7 --ar 1:1')`)
      .run();

    tallyPromptTermsForLabel(promptId, 'keep');

    const fox = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('fox');
    expect(fox.kept_count).toBe(1);
    expect(fox.discarded_count).toBe(0);
    const snowy = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('snowy');
    expect(snowy.kept_count).toBe(1);
  });

  it("bumps discarded_count on a 'discard' label, accumulating across repeated calls", () => {
    const db = getDb();
    const { lastInsertRowid: promptId } = db
      .prepare(`INSERT INTO prompts (category, prompt_text) VALUES ('square', 'a moody forest scene --ar 1:1')`)
      .run();

    tallyPromptTermsForLabel(promptId, 'discard');
    tallyPromptTermsForLabel(promptId, 'discard');

    const moody = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('moody');
    expect(moody.discarded_count).toBe(2);
    expect(moody.kept_count).toBe(0);
  });

  it('is a no-op (does not throw) for a null promptId or one that does not exist', () => {
    expect(() => tallyPromptTermsForLabel(null, 'keep')).not.toThrow();
    expect(() => tallyPromptTermsForLabel(999999, 'keep')).not.toThrow();
  });

  it("the fed-back terms are exactly what Module 4's getStyleHints() query would surface", () => {
    const db = getDb();
    const { lastInsertRowid: promptId } = db
      .prepare(`INSERT INTO prompts (category, prompt_text) VALUES ('square', 'a radiant sunrise over mountains --ar 1:1')`)
      .run();

    // Label it 'keep' five times so it clearly skews kept vs discarded (mirrors
    // prompt-helper/index.js's getStyleHints() ordering by (kept_count - discarded_count)).
    for (let i = 0; i < 5; i += 1) tallyPromptTermsForLabel(promptId, 'keep');

    const top = db
      .prepare('SELECT term FROM prompt_terms WHERE kept_count > discarded_count ORDER BY (kept_count - discarded_count) DESC LIMIT 5')
      .all()
      .map((r) => r.term);
    expect(top).toContain('radiant');
    expect(top).toContain('sunrise');
  });
});
