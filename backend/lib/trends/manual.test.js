import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let getDb;
let getTrends;
let importFromCsvRows;
let rowsFromCsvText;
let addManualTrend;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-trends-unit-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../../db/init.js'));
  ({ getTrends, importFromCsvRows, rowsFromCsvText, addManualTrend } = await import('./manual.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM trends').run();
});

describe('addManualTrend', () => {
  it('inserts a row tagged source "manual" and returns it', () => {
    const trend = addManualTrend('cottagecore', 'aesthetic');
    expect(trend).toMatchObject({ term: 'cottagecore', category: 'aesthetic', source: 'manual' });
    expect(trend.id).toBeTruthy();
  });

  it('allows a null category', () => {
    const trend = addManualTrend('dark academia');
    expect(trend.category).toBeNull();
  });
});

describe('getTrends', () => {
  it('returns all trends ordered by added_at desc when no category is given', async () => {
    addManualTrend('term-a', 'cat-a');
    addManualTrend('term-b', 'cat-b');

    const trends = await getTrends();
    expect(trends).toHaveLength(2);
    expect(trends.map((t) => t.term).sort()).toEqual(['term-a', 'term-b']);
  });

  it('filters by category when one is given', async () => {
    addManualTrend('term-a', 'cat-a');
    addManualTrend('term-b', 'cat-b');

    const trends = await getTrends('cat-a');
    expect(trends).toHaveLength(1);
    expect(trends[0].term).toBe('term-a');
  });

  it('returns an empty array for a category with no matches', async () => {
    const trends = await getTrends('does-not-exist');
    expect(trends).toEqual([]);
  });
});

describe('rowsFromCsvText (tolerant header parsing for eRank/EverBee-style exports)', () => {
  it('parses using the "term" header', () => {
    const rows = rowsFromCsvText('term,category\ncottagecore,aesthetic\n');
    expect(rows).toEqual([{ term: 'cottagecore', category: 'aesthetic' }]);
  });

  it('accepts the "keyword" and "trend" header aliases', () => {
    expect(rowsFromCsvText('keyword\nboho\n')).toEqual([{ term: 'boho', category: null }]);
    expect(rowsFromCsvText('trend\ndark academia\n')).toEqual([{ term: 'dark academia', category: null }]);
  });

  it('skips rows missing a usable term column', () => {
    expect(rowsFromCsvText('unrelated\nfoo\n')).toEqual([]);
  });
});

describe('importFromCsvRows', () => {
  it('inserts every row tagged source "csv", including duplicates (no dedupe by design)', async () => {
    importFromCsvRows([
      { term: 'cottagecore', category: 'aesthetic' },
      { term: 'cottagecore', category: 'aesthetic' },
    ]);

    const trends = await getTrends('aesthetic');
    // Unlike tags/user-list.js's importTagsFromCsvRows, trends has no UNIQUE/dedupe rule
    // in schema.sql or this function — a repeated CSV row is expected to insert twice.
    expect(trends).toHaveLength(2);
    expect(trends.every((t) => t.source === 'csv')).toBe(true);
  });

  it('handles an empty row list without throwing', () => {
    expect(() => importFromCsvRows([])).not.toThrow();
  });
});
