import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads DB_PATH at import time — dynamic import() after setting it, same
// pattern as jobs.test.js and the existing *.idempotency.test.js suites.
let getDb;
let getTagCandidates;
let tagRowsFromCsvText;
let importTagsFromCsvRows;
let suggestCategoriesForUncategorizedTags;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-tags-unit-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../../db/init.js'));
  ({
    getTagCandidates,
    tagRowsFromCsvText,
    importTagsFromCsvRows,
    suggestCategoriesForUncategorizedTags,
  } = await import('./user-list.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM tags').run();
});

describe('getTagCandidates (ARCHITECTURE.md -> Tags Provider Layer, v1 user-list)', () => {
  it('returns tags whose text appears in the image analysis, case-insensitively', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run('Fox', 'animals', 'manual');
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run('watercolor', 'style', 'manual');
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run('cityscape', 'subject', 'manual');

    const matches = getTagCandidates({ subject: 'a fox', style: 'watercolor', palette: ['orange'], mood: 'calm' });
    const matchedText = matches.map((t) => t.tag_text).sort();

    expect(matchedText).toEqual(['Fox', 'watercolor'].sort());
  });

  it('returns an empty array when no tags match and when the library is empty', () => {
    expect(getTagCandidates({ subject: 'a fox' })).toEqual([]);

    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'nonexistentmatch',
      null,
      'manual'
    );
    expect(getTagCandidates({ subject: 'a fox', style: 'watercolor' })).toEqual([]);
  });

  it('defaults to an empty analysis object without throwing', () => {
    expect(() => getTagCandidates()).not.toThrow();
    expect(getTagCandidates()).toEqual([]);
  });

  it('ranks a tag whose category matches suggested_categories above one whose category conflicts, even when both substring-match', () => {
    const db = getDb();
    // Both tag texts appear in the analysis blob below, so both pass the substring check —
    // only the category should decide the ordering.
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'wall art',
      'abstract',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'wall art print',
      'botanical',
      'manual'
    );

    const matches = getTagCandidates({
      subject: 'a fern in wall art print form',
      style: 'watercolor',
      suggested_categories: ['botanical'],
    });

    expect(matches.map((t) => t.tag_text)).toEqual(['wall art print', 'wall art']);
  });

  it('ranks a tag whose category matches the detected style above an uncategorized tag', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'watercolor',
      'watercolor',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'watercolor art',
      null,
      'manual'
    );

    const matches = getTagCandidates({ subject: 'watercolor art of a fox', style: 'watercolor' });

    expect(matches.map((t) => t.tag_text)).toEqual(['watercolor', 'watercolor art']);
  });

  it('still returns a category-conflicting tag (demoted, not dropped) alongside a corroborated one', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'boho decor',
      'boho',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'botanical print',
      'botanical',
      'manual'
    );

    const matches = getTagCandidates({
      subject: 'a fern, boho decor style, botanical print',
      suggested_categories: ['botanical'],
    });

    expect(matches.map((t) => t.tag_text)).toEqual(['botanical print', 'boho decor']);
  });

  it('preserves existing behavior for tags with no category (pure substring match, order unaffected by category)', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run('Fox', null, 'manual');
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'watercolor',
      null,
      'manual'
    );

    const matches = getTagCandidates({ subject: 'a fox', style: 'watercolor' });
    expect(matches.map((t) => t.tag_text).sort()).toEqual(['Fox', 'watercolor'].sort());
  });
});

describe('suggestCategoriesForUncategorizedTags (plan.md Rollout step 3)', () => {
  it('backfills an uncategorized tag whose text contains an already-in-use category', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'fern print',
      'botanical',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'botanical wall art',
      null,
      'manual'
    );

    const result = suggestCategoriesForUncategorizedTags();

    expect(result).toEqual({
      checked: 1,
      updated: 1,
      updates: [{ tagText: 'botanical wall art', category: 'botanical' }],
    });
    const row = db.prepare('SELECT * FROM tags WHERE tag_text = ?').get('botanical wall art');
    expect(row.category).toBe('botanical');
  });

  it('leaves a tag uncategorized when no known category matches its text', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'fern print',
      'botanical',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'cityscape at night',
      null,
      'manual'
    );

    const result = suggestCategoriesForUncategorizedTags();

    expect(result).toEqual({ checked: 1, updated: 0, updates: [] });
    const row = db.prepare('SELECT * FROM tags WHERE tag_text = ?').get('cityscape at night');
    expect(row.category).toBeNull();
  });

  it('never overwrites a tag that already has a category', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'botanical print',
      'botanical',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'boho botanical mashup',
      'boho',
      'manual'
    );

    const result = suggestCategoriesForUncategorizedTags();

    expect(result).toEqual({ checked: 0, updated: 0, updates: [] });
    const row = db.prepare('SELECT * FROM tags WHERE tag_text = ?').get('boho botanical mashup');
    expect(row.category).toBe('boho');
  });

  it('prefers the longer/more specific matching category when more than one substring-matches', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'wreath',
      'decor',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'crib mobile',
      'nursery decor',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'nursery decor accent',
      null,
      'manual'
    );

    const result = suggestCategoriesForUncategorizedTags();

    expect(result.updated).toBe(1);
    expect(result.updates).toEqual([{ tagText: 'nursery decor accent', category: 'nursery decor' }]);
  });

  it('returns all-zero results when the library has no uncategorized tags or is empty', () => {
    expect(suggestCategoriesForUncategorizedTags()).toEqual({ checked: 0, updated: 0, updates: [] });

    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'fully tagged',
      'style',
      'manual'
    );
    expect(suggestCategoriesForUncategorizedTags()).toEqual({ checked: 0, updated: 0, updates: [] });
  });
});

describe('tagRowsFromCsvText', () => {
  it('parses rows using any of the tolerant header names', () => {
    const rows = tagRowsFromCsvText('tag_text,category\nfox art,animals\nwatercolor,style\n');
    expect(rows).toEqual([
      { tagText: 'fox art', category: 'animals' },
      { tagText: 'watercolor', category: 'style' },
    ]);
  });

  it('accepts the "tag" and "keyword" header aliases', () => {
    const rows = tagRowsFromCsvText('tag,cat\nsquare canvas,products\n');
    expect(rows).toEqual([{ tagText: 'square canvas', category: 'products' }]);
  });

  it('skips rows with no usable tag-text column', () => {
    const rows = tagRowsFromCsvText('unrelated_column\nfoo\n');
    expect(rows).toEqual([]);
  });

  it('sets category to null when the column is absent', () => {
    const rows = tagRowsFromCsvText('tag_text\nminimalist\n');
    expect(rows).toEqual([{ tagText: 'minimalist', category: null }]);
  });
});

describe('importTagsFromCsvRows', () => {
  it('inserts new rows tagged with source "csv" and returns the inserted count', () => {
    const db = getDb();
    const inserted = importTagsFromCsvRows([
      { tagText: 'boho decor', category: 'style' },
      { tagText: 'wall art', category: null },
    ]);

    expect(inserted).toBe(2);
    const rows = db.prepare('SELECT * FROM tags ORDER BY tag_text').all();
    expect(rows.map((r) => r.tag_text)).toEqual(['boho decor', 'wall art']);
    expect(rows.every((r) => r.source === 'csv')).toBe(true);
  });

  it('dedupes against tag_text already in the library and only counts genuinely new rows', () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'boho decor',
      'style',
      'manual'
    );

    const inserted = importTagsFromCsvRows([
      { tagText: 'boho decor', category: 'style' },
      { tagText: 'fresh new tag', category: null },
    ]);

    expect(inserted).toBe(1);
    const rows = db.prepare('SELECT * FROM tags').all();
    expect(rows).toHaveLength(2);
    // The pre-existing manual row is untouched, not overwritten by the CSV import.
    const existing = rows.find((r) => r.tag_text === 'boho decor');
    expect(existing.source).toBe('manual');
  });

  it('dedupes within the same CSV batch too (repeated tag_text in one import)', () => {
    const inserted = importTagsFromCsvRows([
      { tagText: 'repeat me', category: null },
      { tagText: 'repeat me', category: null },
    ]);
    expect(inserted).toBe(1);
  });
});
