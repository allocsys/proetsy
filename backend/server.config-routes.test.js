import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

let app;

beforeAll(async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-config-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  ({ default: app } = await import('./server.js'));
});

describe('GET /api/config/shop-conventions', () => {
  it('returns the shipped defaults when nothing has been dashboard-edited yet', async () => {
    const res = await request(app).get('/api/config/shop-conventions');

    expect(res.status).toBe(200);
    expect(res.body.listing.titleSeparator).toBe('|');
    expect(res.body.listing.maxTitleLength).toBe(140);
    expect(res.body.listing.tagsPerListing).toBe(13);
    expect(res.body.midjourney.version).toBe('--v 7');
    expect(res.body.midjourney.aspectRatioByOrientation.portrait).toBe('2:3');
  });
});

describe('PATCH /api/config/shop-conventions', () => {
  it('updates a field and persists it -- a subsequent GET reflects the change', async () => {
    const patchRes = await request(app)
      .patch('/api/config/shop-conventions')
      .send({ listing: { maxTitleLength: 120 } });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.listing.maxTitleLength).toBe(120);

    const getRes = await request(app).get('/api/config/shop-conventions');
    expect(getRes.body.listing.maxTitleLength).toBe(120);
  });

  it('rejects an invalid field with 400 and writes nothing', async () => {
    const res = await request(app)
      .patch('/api/config/shop-conventions')
      .send({ listing: { maxTitleLength: -5 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maxTitleLength must be a positive integer/);

    const getRes = await request(app).get('/api/config/shop-conventions');
    expect(getRes.body.listing.maxTitleLength).not.toBe(-5);
  });

  it('rejects a stylize trio that violates stylizeMin <= defaultStylize <= stylizeMax', async () => {
    const res = await request(app)
      .patch('/api/config/shop-conventions')
      .send({ midjourney: { defaultStylize: 999 } });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/stylizeMin <= defaultStylize <= stylizeMax/);
  });

  it('a partial PATCH does not clobber unrelated fields', async () => {
    await request(app).patch('/api/config/shop-conventions').send({ listing: { titleSeparator: '--' } });

    const res = await request(app)
      .patch('/api/config/shop-conventions')
      .send({ listing: { maxTagLength: 25 } });

    expect(res.status).toBe(200);
    expect(res.body.listing.maxTagLength).toBe(25);
    // titleSeparator from the earlier PATCH is still intact -- not reset back to the
    // shipped default '|' by this second, unrelated PATCH.
    expect(res.body.listing.titleSeparator).toBe('--');
  });
});

describe('GET /api/llm/rate-limits', () => {
  it('returns an empty array when no key/model pair has ever been rate-limited', async () => {
    const res = await request(app).get('/api/llm/rate-limits');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('reports currentlyLimited correctly for an active cooldown vs. a cleared one, and never exposes a raw API key', async () => {
    const { getDb } = await import('./db/init.js');
    const db = getDb();
    const future = new Date(Date.now() + 60_000).toISOString();
    db.prepare(
      `INSERT INTO llm_rate_limits (key_index, model, limited_until, consecutive_hits, reason, updated_at)
       VALUES (0, 'gemini-2.5-flash', ?, 2, '429', datetime('now'))`
    ).run(future);
    db.prepare(
      `INSERT INTO llm_rate_limits (key_index, model, limited_until, consecutive_hits, reason, updated_at)
       VALUES (1, 'gemini-2.5-flash', NULL, 0, NULL, datetime('now'))`
    ).run();

    const res = await request(app).get('/api/llm/rate-limits');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);

    const limited = res.body.find((r) => r.keyIndex === 0);
    expect(limited.currentlyLimited).toBe(true);
    expect(limited.consecutiveHits).toBe(2);
    expect(Object.keys(limited)).not.toContain('key');
    expect(JSON.stringify(limited)).not.toMatch(/AIza|sk-/); // no raw key material leaking through

    const cleared = res.body.find((r) => r.keyIndex === 1);
    expect(cleared.currentlyLimited).toBe(false);
    expect(cleared.limitedUntil).toBeNull();
  });
});
