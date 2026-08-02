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
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-tags-unit-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../../db/init.js'));
  ({ getTagCandidates, tagRowsFromCsvText, importTagsFromCsvRows } = await import('./user-list.js'));
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
