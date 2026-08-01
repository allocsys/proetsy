import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Jimp from 'jimp';
import { writePsdFixtureTo, PSD_FIXTURE } from './__fixtures__/load-psd-fixture.js';

// These modules read env-driven paths at import time (DB_PATH, MOCKUP_OUTPUT_DIR,
// MOCKUP_TEMPLATES_DIR), so the env vars below must be set BEFORE they're imported —
// hence dynamic import() inside beforeAll rather than static top-level imports (same
// pattern as mockup-generator.idempotency.test.js's flat-template coverage).
let getDb;
let generateMockupForJob;
let composeMockup;
let createJob;
let tmpRoot;
let artworkPath;

const VALID_SIZE_KEY = 'test-psd-size';
const BAD_LAYER_SIZE_KEY = 'test-psd-size-bad-layer';

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-mockup-psd-'));

  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.MOCKUP_OUTPUT_DIR = path.join(tmpRoot, 'mockups-out');
  process.env.MOCKUP_TEMPLATES_DIR = tmpRoot;

  const templateDir = path.join(tmpRoot, 'templates');
  writePsdFixtureTo(path.join(templateDir, 'framed-wall-test.psd'));

  // Sized to exactly match the fixture's 'artwork' placement layer's own aspect ratio
  // (80x70), so computeMismatchRatio() stays at 0 — well under the default
  // LARGE_MISMATCH_RATIO (0.35). This test is about the PSD compositing path's file-IO
  // and DB upsert, not the outpainting path (already covered in mockup-generator.test.js
  // for the pure decision logic, and in mockup-generator.idempotency.test.js for the flat-
  // template DB upsert) — keeping the mismatch at 0 keeps it hermetic, no Gemini call.
  const { width, height } = PSD_FIXTURE.placementLayerBounds;
  const artworkDir = path.join(tmpRoot, 'artwork');
  fs.mkdirSync(artworkDir, { recursive: true });
  artworkPath = path.join(artworkDir, 'test-artwork.png');
  const artwork = new Jimp(width, height, 0xcc3366ff);
  await artwork.writeAsync(artworkPath);

  // Two product sizes sharing the same PSD template: one with a valid placement_layer
  // ('artwork', matching the fixture) and one with a placement_layer name the fixture
  // doesn't have, to exercise composeMockupPsd's "no matching layer" error path against
  // a real decoded PSD (not a hand-built plain object, already covered in
  // psd-template.test.js's findPlacementLayer unit tests).
  vi.doMock('../config/index.js', async (importOriginal) => {
    const original = await importOriginal();
    return {
      ...original,
      getProductSizes: () => ({
        [VALID_SIZE_KEY]: {
          dimensions: '8x10',
          dpi: 300,
          orientation: 'portrait',
          mockup_template: 'templates/framed-wall-test.psd',
          placement_layer: 'artwork',
        },
        [BAD_LAYER_SIZE_KEY]: {
          dimensions: '8x10',
          dpi: 300,
          orientation: 'portrait',
          mockup_template: 'templates/framed-wall-test.psd',
          placement_layer: 'does-not-exist',
        },
      }),
    };
  });

  ({ getDb } = await import('../db/init.js'));
  ({ generateMockupForJob, composeMockup } = await import('./mockup-generator.js'));
  ({ createJob } = await import('./jobs.js'));

  const db = getDb();
  const { lastInsertRowid: artworkId } = db.prepare('INSERT INTO artworks (file_path) VALUES (?)').run(artworkPath);
  const jobId = createJob(artworkId);
  globalThis.__testPsdJobId = jobId;
});

afterAll(() => {
  vi.doUnmock('../config/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('composeMockup against a real, committed PSD template fixture (ARCHITECTURE.md -> Module 3 -> "Template formats")', () => {
  it('reads the fixture, substitutes the artwork into the placement layer, and writes a full-canvas composited PNG', async () => {
    const { outputPath, aiExtendedPath, warnings } = await composeMockup(artworkPath, VALID_SIZE_KEY);

    expect(fs.existsSync(outputPath)).toBe(true);
    expect(aiExtendedPath).toBeNull(); // matched aspect ratio -> outpainting never attempted
    expect(warnings).toEqual([]);

    // The output must be the PSD document's full canvas size (120x100), not just the
    // placement layer's own bounds (80x70) — confirms the non-placement layers
    // ('background', the nested 'frame group' -> 'top border') were painted onto the
    // full-size canvas too, not just the substituted artwork region.
    const composited = await Jimp.read(outputPath);
    expect(composited.bitmap.width).toBe(PSD_FIXTURE.documentWidth);
    expect(composited.bitmap.height).toBe(PSD_FIXTURE.documentHeight);
  });

  it('throws a clear error when placement_layer names a layer the PSD does not have', async () => {
    await expect(composeMockup(artworkPath, BAD_LAYER_SIZE_KEY)).rejects.toThrow(/has no layer named "does-not-exist"/);
  });
});

describe('generateMockupForJob upsert against the PSD fixture (idempotency, ARCHITECTURE.md -> Module 3 -> steps 6 & 8)', () => {
  it('re-running for the same job + PSD-backed size updates the existing row, not a duplicate', async () => {
    const jobId = globalThis.__testPsdJobId;
    const db = getDb();

    await generateMockupForJob(jobId, VALID_SIZE_KEY);
    const afterFirst = db.prepare('SELECT * FROM mockups WHERE job_id = ?').all(jobId);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0].file_path).toBe(afterFirst[0].smart_crop_path);
    expect(afterFirst[0].selected_variant).toBe('smart_crop');

    await generateMockupForJob(jobId, VALID_SIZE_KEY);
    const afterSecond = db.prepare('SELECT * FROM mockups WHERE job_id = ?').all(jobId);

    // UNIQUE(job_id, product_size_id) — a second run against the PSD-backed size must
    // UPDATE the same row, never INSERT a second one (same idempotency rule already
    // covered for flat templates in mockup-generator.idempotency.test.js, exercised here
    // specifically against the PSD compositing path's own file-IO).
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0].id).toBe(afterFirst[0].id);
  });
});
