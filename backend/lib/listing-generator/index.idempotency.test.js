import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LISTING_VARIATIONS } from '../../config/shop-conventions.js';

// db/init.js reads DB_PATH at import time, so it must be set BEFORE the module is
// imported — hence dynamic import() inside beforeAll rather than a static top-level
// import (same pattern as mockup-generator.idempotency.test.js).
let getDb;
let generateListingsForJob;
let createJob;
let tmpRoot;

function fixtureVariations() {
  return LISTING_VARIATIONS.map((angle) => ({
    angle,
    title: `${angle} sample title`,
    description: `${angle} sample description, no forbidden phrases here.`,
    tags: Array.from({ length: 13 }, (_, i) => `${angle}tag${i}`),
    tag_alternates: Array.from({ length: 5 }, (_, i) => `${angle}alt${i}`),
  }));
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-listing-idempotency-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  // Stub the LLM provider layer entirely — this suite is about the upsert idempotency of
  // generateListingsForJob, not the Gemini call itself (that's the LLM Provider Layer's
  // own concern, already covered elsewhere). No network, no API key needed.
  vi.doMock('../llm/index.js', () => ({
    generateText: vi.fn(async () => ({ text: JSON.stringify({ variations: fixtureVariations() }) })),
    generateVision: vi.fn(),
    generateImage: vi.fn(),
  }));

  ({ getDb } = await import('../../db/init.js'));
  ({ generateListingsForJob } = await import('./index.js'));
  ({ createJob } = await import('../jobs.js'));

  const db = getDb();
  const { lastInsertRowid: artworkId } = db
    .prepare('INSERT INTO artworks (file_path, image_analysis) VALUES (?, ?)')
    .run('artwork.png', JSON.stringify({ subject: 'test', style: 'test', palette: [], mood: 'calm' }));
  const jobId = createJob(artworkId);
  globalThis.__testListingJobId = jobId;
});

afterAll(() => {
  vi.doUnmock('../llm/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('generateListingsForJob upsert idempotency (ARCHITECTURE.md -> Module 2)', () => {
  it('produces exactly one row per variation angle', async () => {
    const jobId = globalThis.__testListingJobId;
    const db = getDb();

    await generateListingsForJob(jobId);
    const rows = db.prepare('SELECT * FROM listings WHERE job_id = ?').all(jobId);
    expect(rows).toHaveLength(LISTING_VARIATIONS.length);
    expect(new Set(rows.map((r) => r.variation))).toEqual(new Set(LISTING_VARIATIONS));
  });

  it('re-running for the same job updates existing rows rather than duplicating', async () => {
    const jobId = globalThis.__testListingJobId;
    const db = getDb();

    await generateListingsForJob(jobId);
    const afterFirst = db.prepare('SELECT * FROM listings WHERE job_id = ?').all(jobId);
    expect(afterFirst).toHaveLength(LISTING_VARIATIONS.length);

    await generateListingsForJob(jobId);
    const afterSecond = db.prepare('SELECT * FROM listings WHERE job_id = ?').all(jobId);

    // UNIQUE(job_id, variation) — a second run must UPDATE the same rows, never INSERT
    // duplicates.
    expect(afterSecond).toHaveLength(LISTING_VARIATIONS.length);
    const idsById = new Set(afterFirst.map((r) => r.id));
    for (const row of afterSecond) {
      expect(idsById.has(row.id)).toBe(true);
    }
  });

  it('applies enforceConventions to the persisted rows (e.g. tags capped at 13)', async () => {
    const jobId = globalThis.__testListingJobId;
    const db = getDb();

    await generateListingsForJob(jobId);
    const rows = db.prepare('SELECT * FROM listings WHERE job_id = ?').all(jobId);
    for (const row of rows) {
      expect(JSON.parse(row.tags)).toHaveLength(13);
      expect(JSON.parse(row.tag_alternates)).toHaveLength(5);
    }
  });
});
