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
let llmIndex;
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
  llmIndex = await import('../llm/index.js');

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

// plan.md Testing: "Add a fixture ... covering a mixed-category tag library to guard
// against regressing this fix later." This exercises the real tags table + real
// getTagCandidates() scoring (backend/lib/tags/user-list.js) end-to-end through Module 2,
// asserting the category-aware ordering actually reaches the prompt text handed to the
// LLM provider — not just the ordering of the array in isolation (already covered in
// tags/user-list.test.js).
describe('generateListingsForJob tag candidate ordering (mixed-category regression guard)', () => {
  it('lists category-corroborated tags before uncategorized tags before category-conflicting tags in the prompt', async () => {
    const db = getDb();
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'watercolor',
      'watercolor',
      'manual'
    );
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run('fox', null, 'manual');
    db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)').run(
      'boho decor',
      'boho',
      'manual'
    );

    const { lastInsertRowid: artworkId } = db
      .prepare('INSERT INTO artworks (file_path, image_analysis) VALUES (?, ?)')
      .run(
        'mixed-category-artwork.png',
        JSON.stringify({
          subject: 'a fox in a meadow',
          style: 'watercolor',
          suggested_categories: ['botanical'],
          palette: [],
          mood: 'calm',
          themes: ['boho decor'],
          notable_elements: [],
        })
      );
    const jobId = createJob(artworkId);

    llmIndex.generateText.mockClear();
    await generateListingsForJob(jobId);

    expect(llmIndex.generateText).toHaveBeenCalledTimes(1);
    const promptSent = llmIndex.generateText.mock.calls[0][0];

    // Scope the ordering check to the candidate-tags section of the prompt specifically —
    // 'watercolor' also appears earlier in the raw image-analysis JSON block, so comparing
    // indices across the whole prompt would give a false pass/fail unrelated to tag scoring.
    const tagSection = promptSent.slice(promptSent.indexOf("Candidate tags from the shop's tag library"));
    const watercolorIdx = tagSection.indexOf('watercolor');
    const foxIdx = tagSection.indexOf('fox');
    const bohoIdx = tagSection.indexOf('boho decor');

    expect(watercolorIdx).toBeGreaterThan(-1);
    expect(foxIdx).toBeGreaterThan(-1);
    expect(bohoIdx).toBeGreaterThan(-1);
    expect(watercolorIdx).toBeLessThan(foxIdx);
    expect(foxIdx).toBeLessThan(bohoIdx);
  });
});
