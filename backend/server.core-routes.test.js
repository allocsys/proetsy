import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// server.js (and db/init.js underneath it) reads DB_PATH at import time, so it must be
// set before the dynamic import() below — same pattern as every other
// server.*-routes.test.js file in this repo.
//
// This file covers the core plumbing routes that every other route-level test file
// takes for granted rather than exercising directly: every existing
// server.*-routes.test.js creates its artworks/jobs straight through lib/jobs.js or a
// raw INSERT (see e.g. server.pipeline-runner-routes.test.js's own comment on this), so
// POST /api/artworks and POST /api/jobs themselves — validation, error responses,
// response shape — had never actually been hit over HTTP before. Also covers
// /api/health, /api/setup-status, and the two read-only /api/config/* routes, none of
// which had a home in any existing test file.

let app;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-core-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  ({ default: app } = await import('./server.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

// Ordered before any other describe block below inserts tags/product-sizes, since these
// two tests are asserting on the DB's starting-from-empty vs. after-one-tag state.
describe('GET /api/setup-status', () => {
  // hasProductSize is true from the very first request, even on an otherwise-untouched
  // DB -- server.js runs migrateProductSizesSeed() once on startup (before this test file
  // ever calls the route), which seeds `product_sizes` from the committed
  // product-sizes.json the first time the table is found empty (plan.md -> "Rollout"
  // step 1). This is expected, not a leftover from another test: an existing dev setup's
  // JSON-configured sizes (or, here, the repo's own shipped example entries) shouldn't
  // read as "not set up" just because they haven't been re-entered through the DB yet.
  it('reports not-ready on a fresh DB with no Gemini key and no tag library, but hasProductSize true from the JSON-seed migration', async () => {
    const res = await request(app).get('/api/setup-status');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      geminiKeyConfigured: false,
      dbInitialized: true,
      hasProductSize: true,
      hasTagLibrary: false,
      readyToRun: false,
    });
  });

  it('reports readyToRun once a Gemini key (added via the dashboard API-keys route) and a tag are present', async () => {
    await request(app)
      .post('/api/settings/api-keys')
      .send({ provider: 'gemini', key_value: 'fake-key-1234567890' });
    await request(app).post('/api/tags/bulk').send({ tags: 'setup-status-tag' });

    const res = await request(app).get('/api/setup-status');

    expect(res.body.geminiKeyConfigured).toBe(true);
    expect(res.body.hasTagLibrary).toBe(true);
    expect(res.body.readyToRun).toBe(true);
  });
});

describe('GET /api/config/pipeline and /api/config/product-sizes', () => {
  it('returns the pipeline config with the required listing_generator module', async () => {
    const res = await request(app).get('/api/config/pipeline');

    expect(res.status).toBe(200);
    const listingModule = res.body.pipeline.find((m) => m.module === 'listing_generator');
    expect(listingModule).toMatchObject({ enabled: true, required: true });
  });

  it('returns the product-sizes config as an object', async () => {
    const res = await request(app).get('/api/config/product-sizes');
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });
});

describe('POST /api/artworks + GET /api/artworks/:id', () => {
  it('creates an artwork and round-trips its stored image_analysis as parsed JSON', async () => {
    const createRes = await request(app)
      .post('/api/artworks')
      .send({ file_path: '/tmp/test-art.png', original_filename: 'test-art.png', image_analysis: { subject: 'a cat' } });

    expect(createRes.status).toBe(201);
    expect(createRes.body.file_path).toBe('/tmp/test-art.png');
    expect(createRes.body.original_filename).toBe('test-art.png');

    const getRes = await request(app).get(`/api/artworks/${createRes.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.image_analysis).toEqual({ subject: 'a cat' });
  });

  it('400s when file_path is missing', async () => {
    const res = await request(app).post('/api/artworks').send({});
    expect(res.status).toBe(400);
  });

  it('404s for a nonexistent artwork id', async () => {
    const res = await request(app).get('/api/artworks/999999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/jobs + GET /api/jobs/:id + GET /api/jobs', () => {
  let artworkId;

  beforeAll(async () => {
    const res = await request(app).post('/api/artworks').send({ file_path: '/tmp/job-art.png' });
    artworkId = res.body.id;
  });

  it('creates a job with job_modules seeded from the pipeline config', async () => {
    const res = await request(app).post('/api/jobs').send({ artwork_id: artworkId });

    expect(res.status).toBe(201);
    expect(res.body.artwork_id).toBe(artworkId);
    expect(res.body.overall_status).toBe('pending');
    const moduleNames = res.body.modules.map((m) => m.module_name);
    expect(moduleNames).toEqual(expect.arrayContaining(['image_analyzer', 'listing_generator', 'mockup_composer']));
  });

  it('honors pipeline_overrides for a non-required module', async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ artwork_id: artworkId, pipeline_overrides: { image_analyzer: false } });

    expect(res.status).toBe(201);
    const imageAnalyzer = res.body.modules.find((m) => m.module_name === 'image_analyzer');
    expect(imageAnalyzer.status).toBe('skipped');
  });

  it("ignores an override attempting to disable the required listing_generator module", async () => {
    const res = await request(app)
      .post('/api/jobs')
      .send({ artwork_id: artworkId, pipeline_overrides: { listing_generator: false } });

    expect(res.status).toBe(201);
    const listingGenerator = res.body.modules.find((m) => m.module_name === 'listing_generator');
    expect(listingGenerator.status).toBe('pending');
  });

  it('400s with a clear "not found" error for a nonexistent artwork_id', async () => {
    const res = await request(app).post('/api/jobs').send({ artwork_id: 999999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('400s when artwork_id is missing', async () => {
    const res = await request(app).post('/api/jobs').send({});
    expect(res.status).toBe(400);
  });

  it('GET /api/jobs/:id returns the job with its modules', async () => {
    const createRes = await request(app).post('/api/jobs').send({ artwork_id: artworkId });

    const res = await request(app).get(`/api/jobs/${createRes.body.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createRes.body.id);
    expect(Array.isArray(res.body.modules)).toBe(true);
  });

  it('GET /api/jobs/:id 404s for a nonexistent job', async () => {
    const res = await request(app).get('/api/jobs/999999');
    expect(res.status).toBe(404);
  });

  it('GET /api/jobs lists jobs newest-first, joined with their artwork file path', async () => {
    const res = await request(app).get('/api/jobs');

    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('artwork_file_path');
  });
});

describe('POST /api/jobs batch_id grouping', () => {
  it('stores the given batch_id and omits it (null) when not provided', async () => {
    const artA = await request(app).post('/api/artworks').send({ file_path: '/tmp/batch-a.png' });
    const artB = await request(app).post('/api/artworks').send({ file_path: '/tmp/batch-b.png' });
    const artC = await request(app).post('/api/artworks').send({ file_path: '/tmp/batch-c.png' });

    const batchId = 'test-batch-123';
    const jobA = await request(app).post('/api/jobs').send({ artwork_id: artA.body.id, batch_id: batchId });
    const jobB = await request(app).post('/api/jobs').send({ artwork_id: artB.body.id, batch_id: batchId });
    const jobC = await request(app).post('/api/jobs').send({ artwork_id: artC.body.id });

    expect(jobA.body.batch_id).toBe(batchId);
    expect(jobB.body.batch_id).toBe(batchId);
    expect(jobC.body.batch_id).toBeNull();

    const listRes = await request(app).get('/api/jobs');
    const byId = Object.fromEntries(listRes.body.map((j) => [j.id, j]));
    expect(byId[jobA.body.id].batch_id).toBe(batchId);
    expect(byId[jobB.body.id].batch_id).toBe(batchId);
    expect(byId[jobC.body.id].batch_id).toBeNull();
  });
});

describe('PATCH /api/jobs/:id/manual-notes', () => {
  it("sets manual notes and returns the job with them applied (Module 2's fallback input)", async () => {
    const artworkRes = await request(app).post('/api/artworks').send({ file_path: '/tmp/notes-art.png' });
    const jobRes = await request(app).post('/api/jobs').send({ artwork_id: artworkRes.body.id });

    const res = await request(app)
      .patch(`/api/jobs/${jobRes.body.id}/manual-notes`)
      .send({ notes: 'hand-written listing angle notes' });

    expect(res.status).toBe(200);
    expect(res.body.manual_notes).toBe('hand-written listing angle notes');
  });

  it('clears manual notes back to null when sent without a notes field', async () => {
    const artworkRes = await request(app).post('/api/artworks').send({ file_path: '/tmp/notes-clear-art.png' });
    const jobRes = await request(app).post('/api/jobs').send({ artwork_id: artworkRes.body.id });
    await request(app).patch(`/api/jobs/${jobRes.body.id}/manual-notes`).send({ notes: 'will be cleared' });

    const res = await request(app).patch(`/api/jobs/${jobRes.body.id}/manual-notes`).send({});

    expect(res.status).toBe(200);
    expect(res.body.manual_notes).toBeNull();
  });
});
