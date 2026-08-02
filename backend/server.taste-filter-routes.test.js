import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

// server.js (and the modules it imports) read DB_PATH at import time, so it must be set
// BEFORE the module is imported — same dynamic-import pattern used by the other
// server.*-routes.test.js files. embedImage is stubbed entirely: it needs a real ONNX
// model file on disk (not committed to the repo, see embeddings.js), and these tests are
// about the HTTP routes wired up in server.js, not the CLIP model itself (embeddings.js's
// pure preprocessing is already unit-tested in embeddings.test.js).
let app;
let tmpRoot;
let embedImageMock;

// Deterministic fake embeddings so tests can reason about which candidate should score
// as "keep-leaning" vs "discard-leaning" once labels exist. Orthogonal-ish 4-dim vectors
// standing in for CLIP's real (much longer) output — cosineSimilarity/scoreCandidate
// don't care about dimensionality.
const KEEP_LEANING = new Float32Array([1, 0, 0, 0]);
const DISCARD_LEANING = new Float32Array([0, 1, 0, 0]);

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-taste-filter-routes-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');
  process.env.TASTE_FILTER_CANDIDATES_DIR = path.join(tmpRoot, 'candidates');

  embedImageMock = vi.fn(async () => KEEP_LEANING);
  vi.doMock('./lib/taste-filter/embeddings.js', () => ({
    embedImage: (...args) => embedImageMock(...args),
  }));

  ({ default: app } = await import('./server.js'));
});

afterAll(() => {
  vi.doUnmock('./lib/taste-filter/embeddings.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/taste-filter/import (ARCHITECTURE.md -> Module 7 -> "Build sequence" step 4)', () => {
  it('saves each file, embeds it, and returns a scored candidate per file', async () => {
    const res = await request(app)
      .post('/api/taste-filter/import')
      .attach('files', Buffer.from('fake-png-bytes'), 'candidate1.png')
      .attach('files', Buffer.from('fake-png-bytes'), 'candidate2.png');

    expect(res.status).toBe(201);
    expect(res.body.candidates).toHaveLength(2);
    for (const c of res.body.candidates) {
      expect(c.imageUrl).toMatch(/^\/taste-filter-files\//);
      expect(c.embedding).toEqual(Array.from(KEEP_LEANING));
      // No labels exist yet at this point in the suite — cold start, so nothing to score
      // against (ARCHITECTURE.md -> Module 7 -> scoreAgainstCentroids: "null only when
      // NEITHER centroid exists yet").
      expect(c.globalScore).toBeNull();
      expect(c.globalLabel).toBe('uncertain');
    }
  });

  it('400s when no files are attached', async () => {
    const res = await request(app).post('/api/taste-filter/import').field('category', 'square-canvas');
    expect(res.status).toBe(400);
  });

  it("does not fail the whole batch when one file's embedding fails", async () => {
    embedImageMock.mockImplementationOnce(async () => {
      throw new Error('corrupt image');
    });

    const res = await request(app)
      .post('/api/taste-filter/import')
      .attach('files', Buffer.from('bad'), 'broken.png')
      .attach('files', Buffer.from('fine'), 'ok.png');

    expect(res.status).toBe(201);
    expect(res.body.candidates).toHaveLength(2);
    expect(res.body.candidates[0].error).toMatch(/corrupt image/);
    expect(res.body.candidates[1].error).toBeUndefined();
    expect(res.body.candidates[1].embedding).toBeDefined();
  });
});

describe('POST /api/taste-filter/label + GET /api/taste-filter/centroids (Module 7 -> "How the \'training\' works")', () => {
  it('persists a label, recomputes centroids, and the counts are reflected via GET /centroids', async () => {
    const labelRes = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/kept-one.png',
      embedding: Array.from(KEEP_LEANING),
      label: 'keep',
      category: 'square-canvas',
    });
    expect(labelRes.status).toBe(201);
    expect(labelRes.body.counts.global.keptCount).toBe(1);
    expect(labelRes.body.counts['square-canvas'].keptCount).toBe(1);

    await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/discarded-one.png',
      embedding: Array.from(DISCARD_LEANING),
      label: 'discard',
      category: 'square-canvas',
    });

    const centroidsRes = await request(app).get('/api/taste-filter/centroids');
    expect(centroidsRes.status).toBe(200);
    const global = centroidsRes.body.find((r) => r.category === 'global');
    expect(global.kept_count).toBe(1);
    expect(global.discarded_count).toBe(1);
  });

  it('a subsequent import now scores candidates against the real centroids, not null', async () => {
    embedImageMock.mockImplementationOnce(async () => KEEP_LEANING);

    const res = await request(app)
      .post('/api/taste-filter/import')
      .field('category', 'square-canvas')
      .attach('files', Buffer.from('fake'), 'candidate3.png');

    expect(res.status).toBe(201);
    const [candidate] = res.body.candidates;
    // Embedding matches the kept-leaning vector exactly, opposite the discarded one, so
    // it should score as likely-keep against both the global and category centroids.
    expect(candidate.globalScore).not.toBeNull();
    expect(candidate.globalLabel).toBe('likely-keep');
    expect(candidate.categoryScore).not.toBeNull();
    expect(candidate.categoryLabel).toBe('likely-keep');
  });

  it('400s for an invalid label value', async () => {
    const res = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/x.png',
      embedding: [1, 0, 0, 0],
      label: 'maybe',
    });
    expect(res.status).toBe(400);
  });

  it('400s when embedding is missing', async () => {
    const res = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/x.png',
      label: 'keep',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/taste-filter/recompute ("Recompute now" button)', () => {
  it('recomputes on demand and returns the current counts', async () => {
    const res = await request(app).post('/api/taste-filter/recompute');
    expect(res.status).toBe(200);
    expect(res.body.counts.global.keptCount).toBeGreaterThanOrEqual(1);
    expect(res.body.counts.global.discardedCount).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/taste-filter/label -> prompt-feedback link (Module 7 -> Module 4, write side)', () => {
  it('labeling a candidate tagged with a prompt_id tallies that prompt\'s terms into prompt_terms', async () => {
    const { getDb } = await import('./db/init.js');
    const db = getDb();
    const { lastInsertRowid: promptId } = db
      .prepare(`INSERT INTO prompts (category, prompt_text) VALUES ('square-canvas', 'a serene lighthouse at dusk --ar 1:1')`)
      .run();

    const res = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/lighthouse.png',
      embedding: Array.from(KEEP_LEANING),
      label: 'keep',
      category: 'square-canvas',
      prompt_id: promptId,
    });
    expect(res.status).toBe(201);

    const lighthouse = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('lighthouse');
    expect(lighthouse.kept_count).toBeGreaterThanOrEqual(1);
    const serene = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('serene');
    expect(serene.kept_count).toBeGreaterThanOrEqual(1);
  });

  it('labeling without a prompt_id does not throw and does not touch prompt_terms', async () => {
    const res = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/no-prompt.png',
      embedding: Array.from(DISCARD_LEANING),
      label: 'discard',
    });
    expect(res.status).toBe(201);
  });
});

describe('GET /api/taste-filter/pending + /watch-status (Module 7 -> "Auto-import via watched folder", step 7)', () => {
  it('watch-status reports inactive when nothing has been configured', async () => {
    const res = await request(app).get('/api/taste-filter/watch-status');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
    expect(res.body.folder).toBeNull();
  });

  it('pending is an empty list when the watcher has nothing queued', async () => {
    const res = await request(app).get('/api/taste-filter/pending');
    expect(res.status).toBe(200);
    expect(res.body.candidates).toEqual([]);
  });

  it('enabling the watcher via PATCH /api/settings picks up a dropped file, surfaced via GET /pending, and labeling it clears the queue', async () => {
    const watchFolder = fs.mkdtempSync(path.join(tmpRoot, 'watch-'));

    const patchRes = await request(app).patch('/api/settings').send({
      taste_filter_watch_enabled: 'true',
      taste_filter_watch_folder: watchFolder,
      taste_filter_watch_category: 'square-canvas',
    });
    expect(patchRes.status).toBe(200);

    const statusRes = await request(app).get('/api/taste-filter/watch-status');
    expect(statusRes.body.active).toBe(true);
    expect(statusRes.body.folder).toBe(watchFolder);

    fs.writeFileSync(path.join(watchFolder, 'dropped.png'), 'fake-png-bytes');

    let candidate;
    const start = Date.now();
    while (Date.now() - start < 4000) {
      const pendingRes = await request(app).get('/api/taste-filter/pending');
      if (pendingRes.body.candidates.length > 0) {
        candidate = pendingRes.body.candidates[0];
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(candidate).toBeDefined();
    expect(candidate.category).toBe('square-canvas');
    expect(candidate.imageUrl).toMatch(/^\/taste-filter-files\//);

    const labelRes = await request(app).post('/api/taste-filter/label').send({
      image_path: candidate.imagePath,
      embedding: candidate.embedding,
      label: 'keep',
      category: candidate.category,
    });
    expect(labelRes.status).toBe(201);

    const pendingAfterLabel = await request(app).get('/api/taste-filter/pending');
    expect(pendingAfterLabel.body.candidates.find((c) => c.imagePath === candidate.imagePath)).toBeUndefined();

    // Turn the watcher back off so it doesn't linger past this test.
    await request(app).patch('/api/settings').send({ taste_filter_watch_enabled: 'false' });
  });
});
