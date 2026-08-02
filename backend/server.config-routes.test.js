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
