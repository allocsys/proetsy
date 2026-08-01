import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// server.js (and the modules it imports) read DB_PATH at import time, so it must be set
// BEFORE the module is imported — hence dynamic import() inside beforeAll, same pattern
// used by server.listing-routes.test.js.
let app;
let getDb;
let createJob;
let tmpRoot;
let artworkId;

function fixtureAnalysis() {
  return {
    subject: 'a red fox in a snowy forest',
    style: 'watercolor',
    palette: ['white', 'orange', 'blue'],
    mood: 'calm',
    themes: ['winter', 'wildlife'],
    notable_elements: ['falling snow'],
    suggested_categories: ['nursery decor'],
  };
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-image-analyzer-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  // Stub the LLM provider layer entirely — these tests are about the
  // POST /api/jobs/:id/run/image-analyzer and GET /api/artworks/:id routes wired up in
  // server.js, not the Gemini vision call itself (already covered by
  // image-analyzer/index.idempotency.test.js).
  vi.doMock('./lib/llm/index.js', () => ({
    generateText: vi.fn(),
    generateVision: vi.fn(async () => ({ text: JSON.stringify(fixtureAnalysis()) })),
    generateImage: vi.fn(),
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
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/jobs/:id/run/image-analyzer (ARCHITECTURE.md -> Module 1)', () => {
  it('analyzes the artwork and persists the result', async () => {
    const jobId = createJob(artworkId);

    const res = await request(app).post(`/api/jobs/${jobId}/run/image-analyzer`).send({});

    expect(res.status).toBe(200);
    expect(res.body.imageAnalysis).toEqual(fixtureAnalysis());

    const analyzerModule = res.body.job.modules.find((m) => m.module_name === 'image_analyzer');
    expect(analyzerModule.status).toBe('success');
  });

  it('does not fail the whole job when image analysis fails (optional module)', async () => {
    const db = getDb();
    const { generateVision } = await import('./lib/llm/index.js');
    generateVision.mockImplementationOnce(async () => {
      throw new Error('Gemini exploded');
    });

    const jobId = createJob(artworkId);
    const res = await request(app).post(`/api/jobs/${jobId}/run/image-analyzer`).send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/gemini exploded/i);

    // Module 1 is optional — a failure here should NOT force the job's overall_status to
    // 'failed' (ARCHITECTURE.md -> Partial Failure Handling: "the job pauses and asks
    // the user for manual notes instead of auto-failing the whole job").
    const analyzerModule = res.body.job.modules.find((m) => m.module_name === 'image_analyzer');
    expect(analyzerModule.status).toBe('failed');
    expect(res.body.job.overall_status).not.toBe('failed');

    // Manual-notes fallback should still be usable afterward.
    const notesRes = await request(app).patch(`/api/jobs/${jobId}/manual-notes`).send({ notes: 'a cozy cabin scene' });
    expect(notesRes.status).toBe(200);
    expect(notesRes.body.manual_notes).toBe('a cozy cabin scene');
    void db;
  });

  it('re-running for the same artwork overwrites the analysis rather than duplicating anything', async () => {
    const jobId = createJob(artworkId);

    await request(app).post(`/api/jobs/${jobId}/run/image-analyzer`).send({});
    const first = await request(app).get(`/api/artworks/${artworkId}`);
    expect(first.body.image_analysis).toEqual(fixtureAnalysis());

    await request(app).post(`/api/jobs/${jobId}/run/image-analyzer`).send({});
    const second = await request(app).get(`/api/artworks/${artworkId}`);
    expect(second.body.image_analysis).toEqual(fixtureAnalysis());
  });
});

describe('GET /api/artworks/:id', () => {
  it('returns image_analysis as parsed JSON, or null if not yet analyzed', async () => {
    const db = getDb();
    const { lastInsertRowid: freshArtworkId } = db.prepare('INSERT INTO artworks (file_path) VALUES (?)').run('fresh.png');

    const res = await request(app).get(`/api/artworks/${freshArtworkId}`);
    expect(res.status).toBe(200);
    expect(res.body.image_analysis).toBeNull();
  });

  it('returns 404 for an artwork that does not exist', async () => {
    const res = await request(app).get('/api/artworks/999999');
    expect(res.status).toBe(404);
  });
});
