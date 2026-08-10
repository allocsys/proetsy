import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// server.js (and the modules it imports) read DB_PATH at import time, so it must be set
// BEFORE the module is imported — hence dynamic import() inside beforeAll, same pattern
// used by server.listing-routes.test.js.
let app;
let tmpRoot;

function fixturePrompts() {
  return [
    'a fox in a snowy field --v 7 --style raw --ar 2:3 --s 100',
    'a fox curled by a fire --v 7 --style raw --ar 2:3 --s 100',
    'a fox mid-leap through frost --v 7 --style raw --ar 2:3 --s 100',
  ];
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-prompt-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  // Stub the LLM provider layer entirely — these tests are about the HTTP routes wired
  // up in server.js, not the Gemini call itself (already covered by
  // prompt-helper/index.test.js and prompt-helper/prompt.test.js).
  vi.doMock('./lib/llm/index.js', () => ({
    generateText: vi.fn(async () => ({ text: JSON.stringify({ prompts: fixturePrompts() }) })),
    generateVision: vi.fn(),
    generateImage: vi.fn(),
  }));

  ({ default: app } = await import('./server.js'));
});

afterAll(() => {
  vi.doUnmock('./lib/llm/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/trends', () => {
  it('creates a manual trend and returns it', async () => {
    const res = await request(app).post('/api/trends').send({ term: 'moody botanical', category: 'wall art' });
    expect(res.status).toBe(201);
    expect(res.body.term).toBe('moody botanical');
    expect(res.body.source).toBe('manual');
  });

  it('400s when term is missing', async () => {
    const res = await request(app).post('/api/trends').send({ category: 'wall art' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/trends', () => {
  it('lists previously created trends, optionally filtered by category', async () => {
    await request(app).post('/api/trends').send({ term: 'cottagecore florals', category: 'nursery' });
    await request(app).post('/api/trends').send({ term: 'dark academia', category: 'office' });

    const all = await request(app).get('/api/trends');
    expect(all.status).toBe(200);
    expect(all.body.length).toBeGreaterThanOrEqual(2);

    const filtered = await request(app).get('/api/trends').query({ category: 'nursery' });
    expect(filtered.status).toBe(200);
    expect(filtered.body.every((t) => t.category === 'nursery')).toBe(true);
  });
});

describe('POST /api/prompts/generate (ARCHITECTURE.md -> Module 4)', () => {
  it('generates and persists a batch of ready-to-paste prompts for an orientation with no trend', async () => {
    const res = await request(app).post('/api/prompts/generate').send({ orientation: 'portrait' });

    expect(res.status).toBe(201);
    expect(res.body.prompts).toHaveLength(3);
    for (const p of res.body.prompts) {
      expect(p.trend_id).toBeNull();
      expect(p.orientation).toBe('portrait');
      expect(p.prompt_text).toContain('--v 7');
    }
  });

  it('associates generated prompts with a selected trend', async () => {
    const trendRes = await request(app).post('/api/trends').send({ term: 'linked trend', category: 'square' });
    const trendId = trendRes.body.id;

    const res = await request(app).post('/api/prompts/generate').send({ trend_id: trendId, orientation: 'square' });

    expect(res.status).toBe(201);
    expect(res.body.prompts.every((p) => p.trend_id === trendId)).toBe(true);
  });

  it('422s with a clear error when orientation is missing', async () => {
    const res = await request(app).post('/api/prompts/generate').send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/orientation is required/);
  });

  it('422s for a trend_id that does not exist', async () => {
    const res = await request(app).post('/api/prompts/generate').send({ trend_id: 999999, orientation: 'square' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not found/);
  });

  it('a second generation call for the same orientation adds a new batch rather than replacing the first', async () => {
    const first = await request(app).post('/api/prompts/generate').send({ orientation: 'landscape' });
    const second = await request(app).post('/api/prompts/generate').send({ orientation: 'landscape' });

    const firstIds = new Set(first.body.prompts.map((p) => p.id));
    const secondIds = new Set(second.body.prompts.map((p) => p.id));
    for (const id of secondIds) {
      expect(firstIds.has(id)).toBe(false);
    }
  });
});

describe('GET /api/prompts', () => {
  it('returns generated prompts, filterable by orientation', async () => {
    await request(app).post('/api/prompts/generate').send({ orientation: 'square' });

    const res = await request(app).get('/api/prompts').query({ orientation: 'square' });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((p) => p.orientation === 'square')).toBe(true);
  });
});
