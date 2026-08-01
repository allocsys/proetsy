import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Jimp from 'jimp';

// These modules read env-driven paths at import time (DB_PATH, MOCKUP_OUTPUT_DIR,
// MOCKUP_TEMPLATES_DIR), so the env vars below must be set BEFORE they're imported —
// hence dynamic import() inside beforeAll rather than static top-level imports.
let getDb;
let generateMockupForJob;
let createJob;
let tmpRoot;

const TEST_SIZE_KEY = 'test-size';

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-mockup-idempotency-'));

  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.MOCKUP_OUTPUT_DIR = path.join(tmpRoot, 'mockups-out');
  process.env.MOCKUP_TEMPLATES_DIR = tmpRoot;

  // A flat, fully-transparent template and a same-size artwork — matching aspect ratio
  // keeps computeMismatchRatio() at 0, well under the default LARGE_MISMATCH_RATIO
  // (0.35), so composeMockup takes the smart-crop-only path and never calls
  // generateImage()/Gemini. This test is about the DB upsert (step 6), not the
  // outpainting path itself (covered separately in mockup-generator.test.js).
  const templateDir = path.join(tmpRoot, 'templates');
  fs.mkdirSync(templateDir, { recursive: true });
  const template = new Jimp(32, 32, 0x00000000);
  await template.writeAsync(path.join(templateDir, 'test-template.png'));

  const artworkDir = path.join(tmpRoot, 'artwork');
  fs.mkdirSync(artworkDir, { recursive: true });
  const artwork = new Jimp(32, 32, 0x3366ccff);
  await artwork.writeAsync(path.join(artworkDir, 'test-artwork.png'));

  // Override getProductSizes() only — createJob still needs the real getPipelineConfig()
  // to seed job_modules, so this spreads importOriginal() rather than replacing the
  // whole module.
  vi.doMock('../config/index.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      getProductSizes: () => ({
        [TEST_SIZE_KEY]: {
          dimensions: '4x4',
          dpi: 300,
          orientation: 'square',
          mockup_template: 'templates/test-template.png',
        },
      }),
    };
  });

  ({ getDb } = await import('../db/init.js'));
  ({ generateMockupForJob } = await import('./mockup-generator.js'));
  ({ createJob } = await import('./jobs.js'));

  const db = getDb();
  const { lastInsertRowid: artworkId } = db
    .prepare('INSERT INTO artworks (file_path) VALUES (?)')
    .run(path.join(artworkDir, 'test-artwork.png'));
  const jobId = createJob(artworkId);
  globalThis.__testJobId = jobId;
});

afterAll(() => {
  vi.doUnmock('../config/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('generateMockupForJob upsert idempotency (ARCHITECTURE.md -> Module 3 -> step 6)', () => {
  it('re-running for the same job + size updates the existing row, not a duplicate', async () => {
    const jobId = globalThis.__testJobId;
    const db = getDb();

    await generateMockupForJob(jobId, TEST_SIZE_KEY);
    const afterFirst = db.prepare('SELECT * FROM mockups WHERE job_id = ?').all(jobId);
    expect(afterFirst).toHaveLength(1);

    await generateMockupForJob(jobId, TEST_SIZE_KEY);
    const afterSecond = db.prepare('SELECT * FROM mockups WHERE job_id = ?').all(jobId);

    // UNIQUE(job_id, product_size_id) — a second run must UPDATE the same row, never
    // INSERT a second one.
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id);
  });

  it('always writes matching smart_crop_path and file_path, and resets selected_variant to smart_crop', async () => {
    const jobId = globalThis.__testJobId;
    const db = getDb();

    await generateMockupForJob(jobId, TEST_SIZE_KEY);
    const row = db.prepare('SELECT * FROM mockups WHERE job_id = ?').get(jobId);

    expect(row.smart_crop_path).toBeTruthy();
    // No outpaint was attempted (matching aspect ratio, see fixture setup above), so
    // file_path should track the smart-crop output on a fresh run.
    expect(row.file_path).toBe(row.smart_crop_path);
    expect(row.selected_variant).toBe('smart_crop');
    expect(row.needs_review).toBe(0);
    expect(row.ai_extended_path).toBeNull();
  });

  it('a re-run resets a previously-selected ai_extended choice back to smart_crop', async () => {
    const jobId = globalThis.__testJobId;
    const db = getDb();

    await generateMockupForJob(jobId, TEST_SIZE_KEY);
    const row = db.prepare('SELECT * FROM mockups WHERE job_id = ?').get(jobId);

    // Simulate a prior user selection via the step-6 PATCH route's own update shape,
    // without exercising the HTTP layer — this test is scoped to the generator/DB layer.
    db.prepare(
      "UPDATE mockups SET selected_variant = 'ai_extended', needs_review = 0 WHERE id = ?"
    ).run(row.id);

    await generateMockupForJob(jobId, TEST_SIZE_KEY);
    const rowAfterRerun = db.prepare('SELECT * FROM mockups WHERE id = ?').get(row.id);

    // A fresh run produces brand-new candidate files, so any previous selection no longer
    // corresponds to what's on disk — ARCHITECTURE.md -> Module 3 -> step 6 documents this
    // reset explicitly.
    expect(rowAfterRerun.selected_variant).toBe('smart_crop');
  });
});
