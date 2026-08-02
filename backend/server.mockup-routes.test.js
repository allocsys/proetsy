import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import Jimp from 'jimp';

// Same "env vars + doMock before dynamic import" pattern as
// mockup-generator.idempotency.test.js and server.pipeline-runner-routes.test.js:
// server.js and everything it imports read DB_PATH/MOCKUP_OUTPUT_DIR/
// MOCKUP_TEMPLATES_DIR at import time, so those must be set first, and
// getProductSizes() must be mocked before server.js (which imports mockup-generator.js,
// which imports config/index.js) is ever imported.
let app;
let getDb;
let createJob;
let tmpRoot;
let artworkId;

const TEST_SIZE_KEY = 'test-size';

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-mockup-routes-'));

  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.MOCKUP_OUTPUT_DIR = path.join(tmpRoot, 'mockups-out');
  process.env.MOCKUP_TEMPLATES_DIR = tmpRoot;
  process.env.ARTWORK_UPLOADS_DIR = path.join(tmpRoot, 'uploads');
  process.env.TASTE_FILTER_CANDIDATES_DIR = path.join(tmpRoot, 'taste-filter');

  // A flat, fully-transparent template and a same-size artwork — matching aspect ratio
  // keeps the mismatch ratio at 0 (well under LARGE_MISMATCH_RATIO's default 0.35), so
  // composeMockup takes the smart-crop-only path and never calls generateImage()/Gemini.
  // These tests are about the HTTP routes, not the outpainting path (covered elsewhere).
  const templateDir = path.join(tmpRoot, 'templates');
  fs.mkdirSync(templateDir, { recursive: true });
  const template = new Jimp(32, 32, 0x00000000);
  await template.writeAsync(path.join(templateDir, 'test-template.png'));

  const artworkDir = path.join(tmpRoot, 'artwork');
  fs.mkdirSync(artworkDir, { recursive: true });
  const artwork = new Jimp(32, 32, 0x3366ccff);
  await artwork.writeAsync(path.join(artworkDir, 'test-artwork.png'));

  vi.doMock('./config/index.js', async (importOriginal) => {
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

  ({ getDb } = await import('./db/init.js'));
  ({ createJob } = await import('./lib/jobs.js'));
  ({ default: app } = await import('./server.js'));

  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO artworks (file_path) VALUES (?)')
    .run(path.join(artworkDir, 'test-artwork.png'));
  artworkId = lastInsertRowid;
});

afterAll(() => {
  vi.doUnmock('./config/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/jobs/:id/run/mockup-composer (flat template)', () => {
  it('composes a mockup and marks the module success without forcing overall_status failed', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });

    const res = await request(app)
      .post(`/api/jobs/${jobId}/run/mockup-composer`)
      .send({ size_key: TEST_SIZE_KEY });

    expect(res.status).toBe(200);
    expect(res.body.outputPath).toBeTruthy();
    expect(res.body.warnings).toEqual([]);
    const statuses = Object.fromEntries(res.body.job.modules.map((m) => [m.module_name, m.status]));
    expect(statuses.mockup_composer).toBe('success');
  });

  it('rejects a missing size_key', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });

    const res = await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({});

    expect(res.status).toBe(400);
  });

  it('an unknown size_key fails the module but does not force overall_status to failed (Module 3 is optional)', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });

    const res = await request(app)
      .post(`/api/jobs/${jobId}/run/mockup-composer`)
      .send({ size_key: 'does-not-exist' });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/does-not-exist/);
    const statuses = Object.fromEntries(res.body.job.modules.map((m) => [m.module_name, m.status]));
    expect(statuses.mockup_composer).toBe('failed');
    // Optional module — a listing without mockups is still usable, per
    // ARCHITECTURE.md -> Partial Failure Handling.
    expect(res.body.job.overall_status).not.toBe('failed');
  });

  it('re-running for the same job + size overwrites rather than duplicating (idempotency at the route level)', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });

    await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({ size_key: TEST_SIZE_KEY });
    await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({ size_key: TEST_SIZE_KEY });

    const db = getDb();
    const rows = db.prepare('SELECT * FROM mockups WHERE job_id = ?').all(jobId);
    expect(rows).toHaveLength(1);
  });
});

describe('GET /api/jobs/:id/mockups', () => {
  it('returns the composed mockup with file_url/smart_crop_url/ai_extended_url attached', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });
    await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({ size_key: TEST_SIZE_KEY });

    const res = await request(app).get(`/api/jobs/${jobId}/mockups`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].file_url).toMatch(/^\/mockup-files\//);
    expect(res.body[0].smart_crop_url).toMatch(/^\/mockup-files\//);
    expect(res.body[0].ai_extended_url).toBeNull();
    expect(res.body[0].size_key).toBe(TEST_SIZE_KEY);
  });
});

describe('PATCH /api/jobs/:id/mockups/:mockupId/variant', () => {
  it('rejects an invalid variant value', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });
    const runRes = await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({ size_key: TEST_SIZE_KEY });
    const db = getDb();
    const mockup = db.prepare('SELECT * FROM mockups WHERE job_id = ?').get(jobId);

    const res = await request(app)
      .patch(`/api/jobs/${jobId}/mockups/${mockup.id}/variant`)
      .send({ variant: 'not_a_real_variant' });

    expect(res.status).toBe(400);
    expect(runRes.status).toBe(200); // sanity check the fixture composed successfully
  });

  it('404s for a mockup that does not belong to the job', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });

    const res = await request(app)
      .patch(`/api/jobs/${jobId}/mockups/999999/variant`)
      .send({ variant: 'smart_crop' });

    expect(res.status).toBe(404);
  });

  it("422s selecting 'ai_extended' when no AI-extended variant exists (matching-aspect-ratio fixture never triggers outpaint)", async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });
    await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({ size_key: TEST_SIZE_KEY });
    const db = getDb();
    const mockup = db.prepare('SELECT * FROM mockups WHERE job_id = ?').get(jobId);

    const res = await request(app)
      .patch(`/api/jobs/${jobId}/mockups/${mockup.id}/variant`)
      .send({ variant: 'ai_extended' });

    expect(res.status).toBe(422);
  });

  it("selecting 'smart_crop' syncs file_path and clears needs_review", async () => {
    const jobId = createJob(artworkId, { image_analyzer: false });
    await request(app).post(`/api/jobs/${jobId}/run/mockup-composer`).send({ size_key: TEST_SIZE_KEY });
    const db = getDb();
    const mockup = db.prepare('SELECT * FROM mockups WHERE job_id = ?').get(jobId);

    const res = await request(app)
      .patch(`/api/jobs/${jobId}/mockups/${mockup.id}/variant`)
      .send({ variant: 'smart_crop' });

    expect(res.status).toBe(200);
    expect(res.body.selected_variant).toBe('smart_crop');
    expect(res.body.needs_review).toBe(0);
    expect(res.body.file_path).toBe(mockup.smart_crop_path);
  });
});
