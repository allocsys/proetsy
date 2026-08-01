import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads DB_PATH at import time, so it must be set BEFORE the module is
// imported — hence dynamic import() inside beforeAll (same pattern as
// listing-generator/index.idempotency.test.js).
let getDb;
let analyzeArtworkForJob;
let createJob;
let tmpRoot;
let artworkId;
let jobId;

function fixtureAnalysis(overrides = {}) {
  return {
    subject: 'a red fox in a snowy forest',
    style: 'watercolor',
    palette: ['white', 'orange', 'blue'],
    mood: 'calm',
    themes: ['winter', 'wildlife'],
    notable_elements: ['falling snow', 'bare trees'],
    suggested_categories: ['nursery decor'],
    ...overrides,
  };
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-image-analyzer-idempotency-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  // Stub the LLM provider layer entirely — this suite is about analyzeArtworkForJob's
  // persistence behavior, not the Gemini vision call itself (already covered by the LLM
  // Provider Layer's own tests). No network, no API key, no real image file needed.
  vi.doMock('../llm/index.js', () => ({
    generateText: vi.fn(),
    generateVision: vi.fn(async () => ({ text: JSON.stringify(fixtureAnalysis()) })),
    generateImage: vi.fn(),
  }));

  ({ getDb } = await import('../../db/init.js'));
  ({ analyzeArtworkForJob } = await import('./index.js'));
  ({ createJob } = await import('../jobs.js'));

  const db = getDb();
  const { lastInsertRowid } = db.prepare('INSERT INTO artworks (file_path) VALUES (?)').run('artwork.png');
  artworkId = lastInsertRowid;
  jobId = createJob(artworkId);
});

afterAll(() => {
  vi.doUnmock('../llm/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('analyzeArtworkForJob (ARCHITECTURE.md -> Module 1)', () => {
  it('persists the parsed analysis onto artworks.image_analysis', async () => {
    const db = getDb();

    const result = await analyzeArtworkForJob(jobId);
    expect(result.subject).toBe('a red fox in a snowy forest');

    const row = db.prepare('SELECT image_analysis FROM artworks WHERE id = ?').get(artworkId);
    expect(JSON.parse(row.image_analysis)).toEqual(fixtureAnalysis());
  });

  it('re-running for the same artwork overwrites the column rather than creating a second row', async () => {
    const db = getDb();

    await analyzeArtworkForJob(jobId);
    const countAfterFirst = db.prepare('SELECT COUNT(*) AS n FROM artworks WHERE id = ?').get(artworkId).n;
    expect(countAfterFirst).toBe(1);

    await analyzeArtworkForJob(jobId);
    const countAfterSecond = db.prepare('SELECT COUNT(*) AS n FROM artworks WHERE id = ?').get(artworkId).n;
    expect(countAfterSecond).toBe(1);
  });

  it('throws for a job that does not exist', async () => {
    await expect(analyzeArtworkForJob(999999)).rejects.toThrow(/not found/i);
  });
});
