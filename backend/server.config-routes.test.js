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
  it('returns the hardcoded listing and Midjourney conventions', async () => {
    const res = await request(app).get('/api/config/shop-conventions');

    expect(res.status).toBe(200);
    expect(res.body.listing.titleSeparator).toBe('|');
    expect(res.body.listing.maxTitleLength).toBe(140);
    expect(res.body.listing.tagsPerListing).toBe(13);
    expect(res.body.midjourney.version).toBe('--v 7');
    expect(res.body.midjourney.aspectRatioByCategory.portrait).toBe('2:3');
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
