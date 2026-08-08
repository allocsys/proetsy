import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// server.js reads DB_PATH at import time, so it must be set BEFORE the module is
// imported — same pattern as server.prompt-routes.test.js / server.listing-routes.test.js.
let app;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-csv-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  ({ default: app } = await import('./server.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/trends/csv', () => {
  it('imports rows from CSV text and reports how many were inserted', async () => {
    const csv = 'term,category\nwatercolor florals,art\nmoody botanical,decor';
    const res = await request(app).post('/api/trends/csv').send({ csv });

    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(2);

    const list = await request(app).get('/api/trends');
    const terms = list.body.map((t) => t.term);
    expect(terms).toContain('watercolor florals');
    expect(terms).toContain('moody botanical');
    expect(list.body.find((t) => t.term === 'watercolor florals').source).toBe('csv');
  });

  it('recognizes an alternate header name for the term column', async () => {
    const csv = 'keyword,category\ncottagecore,nursery';
    const res = await request(app).post('/api/trends/csv').send({ csv });

    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);
  });

  it('dedupes against terms already in the table, including ones added via the single-entry route', async () => {
    // Uses a term not touched by any earlier test in this file (the shared beforeAll's
    // app/DB persists across tests here) -- 'watercolor florals' was already inserted via
    // CSV in the first test above, so asserting a fresh single-row count against it would
    // be asserting against stale state, not this test's own setup.
    await request(app).post('/api/trends').send({ term: 'sunlit meadow', category: 'art' });

    const res = await request(app)
      .post('/api/trends/csv')
      .send({ csv: 'term,category\nsunlit meadow,art\nbrand new term,decor' });

    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1);

    const list = await request(app).get('/api/trends');
    expect(list.body.filter((t) => t.term === 'sunlit meadow')).toHaveLength(1);
  });

  it('400s when csv is missing', async () => {
    const res = await request(app).post('/api/trends/csv').send({});
    expect(res.status).toBe(400);
  });

  it('400s when the CSV has no usable term/keyword/trend column', async () => {
    const res = await request(app).post('/api/trends/csv').send({ csv: 'foo,bar\nx,y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No usable rows/);
  });

  it('400s with a distinct message for a header-only CSV (no data rows at all)', async () => {
    const res = await request(app).post('/api/trends/csv').send({ csv: 'term,category' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no data rows/i);
    expect(res.body.error).not.toMatch(/No usable rows/);
  });
});

describe('POST /api/tags/csv', () => {
  it('imports rows from CSV text, tagging their source as csv', async () => {
    const csv = 'tag_text,category\nboho wall art,decor\nminimalist print,art';
    const res = await request(app).post('/api/tags/csv').send({ csv });

    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(2);
    const boho = res.body.tags.find((t) => t.tag_text === 'boho wall art');
    expect(boho.source).toBe('csv');
    expect(boho.category).toBe('decor');
  });

  it('dedupes against tags already in the library, including ones added via the paste-a-list route', async () => {
    await request(app).post('/api/tags/bulk').send({ tags: 'floral print' });

    const res = await request(app).post('/api/tags/csv').send({ csv: 'tag,category\nfloral print,art\nnew unique tag,art' });

    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(1);
    expect(res.body.tags.filter((t) => t.tag_text === 'floral print')).toHaveLength(1);
  });

  it('recognizes alternate header names (tag / text / keyword) for the tag-text column', async () => {
    const res = await request(app).post('/api/tags/csv').send({ csv: 'keyword\nabstract line art' });
    expect(res.status).toBe(201);
    expect(res.body.inserted).toBe(1);
  });

  it('400s when csv is missing', async () => {
    const res = await request(app).post('/api/tags/csv').send({});
    expect(res.status).toBe(400);
  });

  it('400s when the CSV has no usable tag-text column', async () => {
    const res = await request(app).post('/api/tags/csv').send({ csv: 'foo,bar\nx,y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No usable rows/);
  });

  it('400s with a distinct message for a header-only CSV (no data rows at all)', async () => {
    const res = await request(app).post('/api/tags/csv').send({ csv: 'tag_text,category' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no data rows/i);
    expect(res.body.error).not.toMatch(/No usable rows/);
  });
});

describe('POST /api/tags/backfill-categories', () => {
  it('backfills uncategorized tags whose text matches a category already in use, and reports how many', async () => {
    await request(app).post('/api/tags/bulk').send({ tags: 'botanical print', category: 'botanical' });
    await request(app).post('/api/tags/bulk').send({ tags: 'botanical accent piece' });

    const res = await request(app).post('/api/tags/backfill-categories').send({});

    expect(res.status).toBe(200);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    const backfilled = res.body.tags.find((t) => t.tag_text === 'botanical accent piece');
    expect(backfilled.category).toBe('botanical');
  });

  it('is a no-op (200, zero updates) when there are no uncategorized tags left to check', async () => {
    // Second call right after the one above: every tag from that test now has a category.
    const res = await request(app).post('/api/tags/backfill-categories').send({});
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);
  });
});
