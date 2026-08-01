import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { LISTING_VARIATIONS } from './config/shop-conventions.js';

// server.js (and the modules it imports) read DB_PATH at import time, so it must be set
// BEFORE the module is imported — hence dynamic import() inside beforeAll, same pattern
// used by index.idempotency.test.js and mockup-generator.idempotency.test.js.
let app;
let getDb;
let createJob;
let tmpRoot;
let artworkId;

function fixtureVariations({ titleSuffix = '' } = {}) {
  return LISTING_VARIATIONS.map((angle) => ({
    angle,
    title: `${angle} sample title${titleSuffix}`,
    description: `${angle} sample description, no forbidden phrases here.`,
    tags: Array.from({ length: 13 }, (_, i) => `${angle}tag${i}`),
    tag_alternates: Array.from({ length: 5 }, (_, i) => `${angle}alt${i}`),
  }));
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-listing-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  // Stub the LLM provider layer entirely — these tests are about the HTTP routes
  // (generate/list/edit) wired up in server.js, not the Gemini call itself (already
  // covered by the LLM Provider Layer's own tests and by
  // listing-generator/index.idempotency.test.js).
  vi.doMock('./lib/llm/index.js', () => ({
    generateText: vi.fn(async () => ({ text: JSON.stringify({ variations: fixtureVariations() }) })),
    generateVision: vi.fn(),
    generateImage: vi.fn(),
  }));

  ({ getDb } = await import('./db/init.js'));
  ({ createJob } = await import('./lib/jobs.js'));
  ({ default: app } = await import('./server.js'));

  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO artworks (file_path, image_analysis) VALUES (?, ?)')
    .run('artwork.png', JSON.stringify({ subject: 'test', style: 'test', palette: [], mood: 'calm' }));
  artworkId = lastInsertRowid;
});

afterAll(() => {
  vi.doUnmock('./lib/llm/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/jobs/:id/run/listing-generator (ARCHITECTURE.md -> Module 2)', () => {
  it('generates and persists all 3 listing variations for a job', async () => {
    const jobId = createJob(artworkId);

    const res = await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});

    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(LISTING_VARIATIONS.length);
    expect(new Set(res.body.listings.map((l) => l.angle))).toEqual(new Set(LISTING_VARIATIONS));

    // Module 2 is required — a successful run should move the job off 'failed', and the
    // per-module status for listing_generator should be 'success' (see
    // ARCHITECTURE.md -> Partial Failure Handling).
    const listingModule = res.body.job.modules.find((m) => m.module_name === 'listing_generator');
    expect(listingModule.status).toBe('success');
    expect(res.body.job.overall_status).not.toBe('failed');
  });

  it('fails the job when neither image analysis nor manual notes are present', async () => {
    const db = getDb();
    const { lastInsertRowid: bareArtworkId } = db
      .prepare('INSERT INTO artworks (file_path) VALUES (?)')
      .run('bare-artwork.png');
    const jobId = createJob(bareArtworkId);

    const res = await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/manual notes|image analysis/i);

    // Required-module failure marks the whole job failed (ARCHITECTURE.md -> Partial
    // Failure Handling: "Module 2 ... is core/required ... the job stops there and is
    // marked failed").
    const listingModule = res.body.job.modules.find((m) => m.module_name === 'listing_generator');
    expect(listingModule.status).toBe('failed');
    expect(res.body.job.overall_status).toBe('failed');
  });

  it('re-running for the same job overwrites listings rather than duplicating them', async () => {
    const jobId = createJob(artworkId);

    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});
    const first = await request(app).get(`/api/jobs/${jobId}/listings`);
    expect(first.body).toHaveLength(LISTING_VARIATIONS.length);
    const firstIds = new Set(first.body.map((l) => l.id));

    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});
    const second = await request(app).get(`/api/jobs/${jobId}/listings`);

    expect(second.body).toHaveLength(LISTING_VARIATIONS.length);
    for (const row of second.body) {
      expect(firstIds.has(row.id)).toBe(true);
    }
  });
});

describe('GET /api/jobs/:id/listings', () => {
  it('returns listings with tags/tag_alternates parsed as arrays', async () => {
    const jobId = createJob(artworkId);
    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});

    const res = await request(app).get(`/api/jobs/${jobId}/listings`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(LISTING_VARIATIONS.length);
    for (const listing of res.body) {
      expect(Array.isArray(listing.tags)).toBe(true);
      expect(Array.isArray(listing.tag_alternates)).toBe(true);
      expect(listing.tags).toHaveLength(13);
    }
  });

  it('returns an empty array for a job with no generated listings yet', async () => {
    const jobId = createJob(artworkId);
    const res = await request(app).get(`/api/jobs/${jobId}/listings`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('PATCH /api/jobs/:id/listings/:listingId', () => {
  it('updates only the fields provided, leaving others unchanged', async () => {
    const jobId = createJob(artworkId);
    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});
    const [listing] = (await request(app).get(`/api/jobs/${jobId}/listings`)).body;

    const res = await request(app)
      .patch(`/api/jobs/${jobId}/listings/${listing.id}`)
      .send({ title: 'A hand-edited title' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('A hand-edited title');
    // description/tags weren't sent — should be untouched.
    expect(res.body.description).toBe(listing.description);
    expect(res.body.tags).toEqual(listing.tags);
  });

  it('re-applies enforceConventions to a manual edit (e.g. strips a forbidden title word)', async () => {
    const jobId = createJob(artworkId);
    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});
    const [listing] = (await request(app).get(`/api/jobs/${jobId}/listings`)).body;

    const res = await request(app)
      .patch(`/api/jobs/${jobId}/listings/${listing.id}`)
      .send({ title: 'Framed wall art print' });

    expect(res.status).toBe(200);
    expect(res.body.title.toLowerCase()).not.toContain('framed');
    expect(res.body.warnings.some((w) => /frame/i.test(w))).toBe(true);
  });

  it('caps tags at 13 and surfaces a warning when an edit sends too many', async () => {
    const jobId = createJob(artworkId);
    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});
    const [listing] = (await request(app).get(`/api/jobs/${jobId}/listings`)).body;

    const tooManyTags = Array.from({ length: 20 }, (_, i) => `newtag${i}`);
    const res = await request(app)
      .patch(`/api/jobs/${jobId}/listings/${listing.id}`)
      .send({ tags: tooManyTags });

    expect(res.status).toBe(200);
    expect(res.body.tags).toHaveLength(13);
  });

  it('returns 404 for a listing that does not belong to the given job', async () => {
    const jobA = createJob(artworkId);
    const jobB = createJob(artworkId);
    await request(app).post(`/api/jobs/${jobA}/run/listing-generator`).send({});
    const [listingFromA] = (await request(app).get(`/api/jobs/${jobA}/listings`)).body;

    const res = await request(app)
      .patch(`/api/jobs/${jobB}/listings/${listingFromA.id}`)
      .send({ title: 'Should not apply' });

    expect(res.status).toBe(404);
  });

  it('persists the edit — a follow-up GET reflects the saved change', async () => {
    const jobId = createJob(artworkId);
    await request(app).post(`/api/jobs/${jobId}/run/listing-generator`).send({});
    const [listing] = (await request(app).get(`/api/jobs/${jobId}/listings`)).body;

    await request(app)
      .patch(`/api/jobs/${jobId}/listings/${listing.id}`)
      .send({ description: 'A manually rewritten description.' });

    const after = await request(app).get(`/api/jobs/${jobId}/listings`);
    const updated = after.body.find((l) => l.id === listing.id);
    expect(updated.description).toBe('A manually rewritten description.');
  });
});
