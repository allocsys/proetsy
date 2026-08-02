import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// Same pattern as server.listing-routes.test.js: server.js (and everything it imports,
// including the new pipeline-runner) read DB_PATH at import time, so it must be set
// before the dynamic import() below. The LLM provider and Module 3's mockup generator
// are both stubbed — these tests are about the runner's orchestration (which modules run,
// in what order, how a required-module failure short-circuits the rest), not about
// Gemini calls or real image compositing, which already have their own test coverage.
let app;
let getDb;
let createJob;
let tmpRoot;
let artworkId;

function fixtureListingText() {
  return JSON.stringify({
    variations: ['fine_art', 'aesthetic', 'gift'].map((angle) => ({
      angle,
      title: `${angle} sample title`,
      description: `${angle} sample description, no forbidden phrases here.`,
      tags: Array.from({ length: 13 }, (_, i) => `${angle}tag${i}`),
      tag_alternates: Array.from({ length: 5 }, (_, i) => `${angle}alt${i}`),
    })),
  });
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-pipeline-runner-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  vi.doMock('./lib/llm/index.js', () => ({
    generateText: vi.fn(async () => ({ text: fixtureListingText() })),
    generateVision: vi.fn(async () => ({
      text: JSON.stringify({ subject: 'a fox', style: 'watercolor', palette: ['orange'], mood: 'calm' }),
    })),
    generateImage: vi.fn(),
  }));

  // Module 3 needs real image files/templates it doesn't have here — stubbed out
  // entirely so the runner's mockup_composer step just needs to call it and see it
  // resolve, same as how server.listing-routes.test.js stubs the LLM layer rather than
  // hitting Gemini for real.
  vi.doMock('./lib/mockup-generator.js', () => ({
    generateMockupForJob: vi.fn(async () => ({ outputPath: '/tmp/fake-mockup.png', warnings: [] })),
    OUTPUT_DIR: tmpRoot,
  }));

  ({ getDb } = await import('./db/init.js'));
  ({ createJob } = await import('./lib/jobs.js'));
  ({ default: app } = await import('./server.js'));

  const db = getDb();
  const { lastInsertRowid } = db.prepare('INSERT INTO artworks (file_path) VALUES (?)').run('artwork.png');
  artworkId = lastInsertRowid;
});

afterAll(() => {
  vi.doUnmock('./lib/llm/index.js');
  vi.doUnmock('./lib/mockup-generator.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/jobs/:id/run (server-side pipeline runner)', () => {
  it('runs every pending module for a job in one call', async () => {
    const jobId = createJob(artworkId);

    const res = await request(app).post(`/api/jobs/${jobId}/run`).send({});

    expect(res.status).toBe(200);
    const statuses = Object.fromEntries(res.body.job.modules.map((m) => [m.module_name, m.status]));
    expect(statuses.image_analyzer).toBe('success');
    expect(statuses.listing_generator).toBe('success');
    expect(statuses.mockup_composer).toBe('success');
    expect(res.body.job.overall_status).not.toBe('failed');
    expect(res.body.results.listing_generator.status).toBe('success');
  });

  it('does not run modules the job config disabled at creation time', async () => {
    const jobId = createJob(artworkId, { image_analyzer: false, mockup_composer: false });

    const res = await request(app).post(`/api/jobs/${jobId}/run`).send({});

    expect(res.status).toBe(200);
    const statuses = Object.fromEntries(res.body.job.modules.map((m) => [m.module_name, m.status]));
    expect(statuses.image_analyzer).toBe('skipped');
    expect(statuses.mockup_composer).toBe('skipped');
    expect(statuses.listing_generator).toBe('success');
    // Skipped modules never ran, so the runner shouldn't report a result for them.
    expect(res.body.results.image_analyzer).toBeUndefined();
    expect(res.body.results.mockup_composer).toBeUndefined();
  });

  it('stops after a required-module (listing_generator) failure without attempting mockup_composer', async () => {
    const db = getDb();
    const { lastInsertRowid: bareArtworkId } = db
      .prepare('INSERT INTO artworks (file_path) VALUES (?)')
      .run('bare.png');
    // No image analysis and Module 1 disabled -> listing_generator has neither input and fails.
    const jobId = createJob(bareArtworkId, { image_analyzer: false });

    const res = await request(app).post(`/api/jobs/${jobId}/run`).send({});

    expect(res.status).toBe(200);
    const statuses = Object.fromEntries(res.body.job.modules.map((m) => [m.module_name, m.status]));
    expect(statuses.listing_generator).toBe('failed');
    expect(statuses.mockup_composer).toBe('pending'); // never reached
    expect(res.body.job.overall_status).toBe('failed');
  });

  it('re-running only picks up modules still pending/failed, leaving success alone', async () => {
    const jobId = createJob(artworkId);
    const first = await request(app).post(`/api/jobs/${jobId}/run`).send({});
    expect(first.body.results.listing_generator.status).toBe('success');

    const second = await request(app).post(`/api/jobs/${jobId}/run`).send({});
    // Every module already succeeded — nothing left to run, so no results at all.
    expect(second.body.results).toEqual({});
  });

  it('returns 400 for a job that does not exist', async () => {
    const res = await request(app).post('/api/jobs/999999/run').send({});
    expect(res.status).toBe(400);
  });
});

describe('POST /api/jobs/run-batch', () => {
  it('runs multiple jobs independently and reports a per-job outcome for each', async () => {
    const jobA = createJob(artworkId);
    const jobB = createJob(artworkId);

    const res = await request(app)
      .post('/api/jobs/run-batch')
      .send({ job_ids: [jobA, jobB] });

    expect(res.status).toBe(200);
    expect(res.body.outcomes).toHaveLength(2);
    const byJobId = Object.fromEntries(res.body.outcomes.map((o) => [o.jobId, o]));
    expect(byJobId[jobA].ok).toBe(true);
    expect(byJobId[jobB].ok).toBe(true);
    expect(byJobId[jobA].job.overall_status).not.toBe('failed');
  });

  it('one job failing does not stop the others in the same batch', async () => {
    const db = getDb();
    const { lastInsertRowid: bareArtworkId } = db
      .prepare('INSERT INTO artworks (file_path) VALUES (?)')
      .run('bare2.png');
    const failingJob = createJob(bareArtworkId, { image_analyzer: false });
    const healthyJob = createJob(artworkId);

    const res = await request(app)
      .post('/api/jobs/run-batch')
      .send({ job_ids: [failingJob, healthyJob] });

    expect(res.status).toBe(200);
    const byJobId = Object.fromEntries(res.body.outcomes.map((o) => [o.jobId, o]));
    expect(byJobId[failingJob].job.overall_status).toBe('failed');
    expect(byJobId[healthyJob].job.overall_status).not.toBe('failed');
  });

  it('rejects a missing/empty job_ids array', async () => {
    const res = await request(app).post('/api/jobs/run-batch').send({});
    expect(res.status).toBe(400);
  });
});
