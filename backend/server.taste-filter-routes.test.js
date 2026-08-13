import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
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
// See the mock factory below -- a mutable box + listener set standing in for
// embeddings.js's real downloadState/pub-sub, so route tests can simulate a state change.
const modelDownloadState = { current: null };
let modelDownloadListeners;

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
  // Step 1.3 (plan.md) -- POST /api/taste-filter/promote copies a candidate file into
  // UPLOADS_DIR, so this needs its own tmp dir here too, same pattern as
  // TASTE_FILTER_CANDIDATES_DIR above, rather than falling through to server.js's
  // default (backend/data/uploads on disk).
  process.env.ARTWORK_UPLOADS_DIR = path.join(tmpRoot, 'uploads');

  embedImageMock = vi.fn(async () => KEEP_LEANING);
  // Controllable from individual tests (see the "GET /api/taste-filter/model-status"
  // describe block below) via modelDownloadState.current -- a plain mutable box rather
  // than vi.fn() return-value plumbing, since getModelDownloadState() is called
  // synchronously and repeatedly (once per SSE connect, once per poll) and tests want to
  // change what it returns mid-test without re-mocking.
  modelDownloadState.current = { status: 'ready', bytesDownloaded: 0, totalBytes: null, error: null };
  modelDownloadListeners = new Set();
  vi.doMock('./lib/taste-filter/embeddings.js', () => ({
    embedImage: (...args) => embedImageMock(...args),
    ensureModelReady: async () => {},
    getModelDownloadState: () => modelDownloadState.current,
    onModelDownloadProgress: (listener) => {
      modelDownloadListeners.add(listener);
      return () => modelDownloadListeners.delete(listener);
    },
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

describe('GET /api/taste-filter/model-status(/stream) -- CLIP model download progress', () => {
  it('GET /api/taste-filter/model-status returns the current snapshot', async () => {
    modelDownloadState.current = { status: 'downloading', bytesDownloaded: 1000, totalBytes: 2000, error: null };

    const res = await request(app).get('/api/taste-filter/model-status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'downloading', bytesDownloaded: 1000, totalBytes: 2000, error: null });
  });

  it('GET /api/taste-filter/model-status/stream sends the current snapshot immediately on connect', async () => {
    modelDownloadState.current = { status: 'ready', bytesDownloaded: 0, totalBytes: null, error: null };

    const res = await request(app).get('/api/taste-filter/model-status/stream').buffer(true).parse((response, cb) => {
      let data = '';
      response.on('data', (chunk) => {
        data += chunk.toString();
        // The route never closes the connection on its own (see server.js) -- end the
        // request as soon as the first event has arrived, same pattern the existing
        // pending/stream tests elsewhere in this suite use for an SSE endpoint that
        // stays open.
        if (data.includes('\n\n')) response.destroy();
      });
      response.on('close', () => cb(null, data));
      response.on('error', () => cb(null, data));
    });

    // A custom .parse() callback's result lands on res.body, not res.text -- the latter
    // is only populated by supertest's own built-in text buffering, which a custom
    // parser bypasses.
    expect(res.body).toContain('data: {"status":"ready"');
  });

  it('GET /api/taste-filter/model-status/stream pushes a later state change to the listener registered via onModelDownloadProgress', async () => {
    modelDownloadState.current = { status: 'downloading', bytesDownloaded: 0, totalBytes: 350, error: null };

    const req = request(app).get('/api/taste-filter/model-status/stream');
    const events = [];
    await new Promise((resolve) => {
      req.buffer(true).parse((response, cb) => {
        response.on('data', (chunk) => {
          events.push(chunk.toString());
          if (events.length === 1) {
            // First chunk is the immediate current-snapshot send; now simulate a real
            // progress update the same way downloadModel()'s progress-counter stream
            // would, by notifying every subscriber the route registered.
            const update = { status: 'downloading', bytesDownloaded: 175, totalBytes: 350, error: null };
            for (const listener of modelDownloadListeners) listener(update);
          }
          if (events.length >= 2) {
            response.destroy();
            resolve();
          }
        });
        response.on('close', () => cb(null, events.join('')));
        response.on('error', () => cb(null, events.join('')));
      });
      req.end(() => {});
    });

    expect(events.join('')).toContain('"bytesDownloaded":175');
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
      .prepare(`INSERT INTO prompts (orientation, prompt_text) VALUES ('square-canvas', 'a serene lighthouse at dusk --ar 1:1')`)
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

  it('relabeling the same image_path moves its prompt terms from one column to the other, not both', async () => {
    // Before the fix, tallyPromptTermsForLabel() was purely additive, so this sequence
    // would leave kept_count at 1 AND discarded_count at 1 for the same term --
    // double-counted instead of moved.
    const { getDb } = await import('./db/init.js');
    const db = getDb();
    const { lastInsertRowid: promptId } = db
      .prepare(`INSERT INTO prompts (orientation, prompt_text) VALUES ('square-canvas', 'a golden meadow at sunrise --ar 1:1')`)
      .run();

    const firstLabel = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/meadow.png',
      embedding: Array.from(KEEP_LEANING),
      label: 'keep',
      category: 'square-canvas',
      prompt_id: promptId,
    });
    expect(firstLabel.status).toBe(201);

    let meadow = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('meadow');
    expect(meadow.kept_count).toBe(1);
    expect(meadow.discarded_count).toBe(0);

    // Correct it: same image_path, same prompt_id, opposite label.
    const secondLabel = await request(app).post('/api/taste-filter/label').send({
      image_path: '/tmp/meadow.png',
      embedding: Array.from(KEEP_LEANING),
      label: 'discard',
      category: 'square-canvas',
      prompt_id: promptId,
    });
    expect(secondLabel.status).toBe(201);

    meadow = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('meadow');
    expect(meadow.kept_count).toBe(0);
    expect(meadow.discarded_count).toBe(1);
  });
});

// Connects with node:http directly rather than supertest -- supertest/superagent waits
// for the response to fully end before resolving, which an SSE stream deliberately never
// does while the connection is open. Resolves with the live `http.ClientRequest` (so the
// caller can req.destroy() it once done) and invokes onEvent for each parsed `data: ...`
// message as it arrives, buffering across chunk boundaries the same way EventSource's
// real parser would.
function connectSseStream(port, streamPath, onEvent) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const req = http.get({ port, path: streamPath }, (res) => {
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const dataLine = rawEvent.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine) onEvent(JSON.parse(dataLine.slice('data: '.length)));
          boundary = buffer.indexOf('\n\n');
        }
      });
    });
    req.on('error', reject);
    req.on('socket', () => resolve(req));
  });
}

// Polls a condition function the same way the existing GET /pending poll-loop test
// below does, instead of a fixed sleep -- SSE delivery here rides on the same chokidar
// awaitWriteFinish debounce as GET /pending, so timing isn't instant.
async function waitUntil(conditionFn, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (conditionFn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Timed out waiting for condition');
}

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

  it(
    'enabling the watcher via PATCH /api/settings picks up a dropped file, surfaced via GET /pending, and labeling it clears the queue',
    async () => {
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
    // Capped below the global testTimeout (15000ms, see vitest.config.js) so this poll
    // fails fast with a clear message instead of silently eating the rest of the test's
    // budget -- the label POST, follow-up GET /pending, and closing PATCH below still
    // need to run afterward. See this test's explicit 20000ms timeout override.
    while (Date.now() - start < 10000) {
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
    },
    20000
  );

  it(
    'GET /pending/stream sends already-pending candidates immediately, then pushes newly-detected ones live, without touching GET /pending',
    async () => {
      const watchFolder = fs.mkdtempSync(path.join(tmpRoot, 'watch-stream-'));
      await request(app).patch('/api/settings').send({
        taste_filter_watch_enabled: 'true',
        taste_filter_watch_folder: watchFolder,
      });

      fs.writeFileSync(path.join(watchFolder, 'already-pending.png'), 'fake-png-bytes');
      // Same inline poll-loop style as the GET /pending test above -- waitUntil's
      // predicate is synchronous, and getting a candidate here requires an awaited HTTP
      // call, so it's polled directly rather than through that helper.
      let firstCandidate;
      const pollStart = Date.now();
      while (Date.now() - pollStart < 10000 && !firstCandidate) {
        const pendingRes = await request(app).get('/api/taste-filter/pending');
        if (pendingRes.body.candidates.length > 0) firstCandidate = pendingRes.body.candidates[0];
        else await new Promise((r) => setTimeout(r, 100));
      }
      expect(firstCandidate).toBeDefined();

      const server = app.listen(0);
      const { port } = server.address();
      const events = [];
      const streamReq = await connectSseStream(port, '/api/taste-filter/pending/stream', (e) => events.push(e));

      try {
        // Immediate snapshot: the already-pending candidate above streams right away, with
        // no need to wait for a new file to land.
        await waitUntil(() => events.length >= 1);
        expect(events[0].imagePath).toBe(firstCandidate.imagePath);
        expect(events[0].imageUrl).toMatch(/^\/taste-filter-files\//);

        fs.writeFileSync(path.join(watchFolder, 'pushed-live.png'), 'fake-png-bytes');
        await waitUntil(() => events.length >= 2);
        expect(events[1].imagePath).not.toBe(firstCandidate.imagePath);
        expect(events[1].imageUrl).toMatch(/^\/taste-filter-files\//);

        // The poll route is untouched by the stream having been opened -- both candidates
        // are still there for a client that never subscribes to the stream at all.
        const pendingRes = await request(app).get('/api/taste-filter/pending');
        expect(pendingRes.body.candidates.length).toBeGreaterThanOrEqual(2);
      } finally {
        streamReq.destroy();
        server.close();
        await request(app).patch('/api/settings').send({ taste_filter_watch_enabled: 'false' });
      }
    },
    20000
  );
});

// Step 1.3 (plan.md -> Part 1 -> "Backend: promote-route tests"). Exercises the route
// added in Step 1.2 -- server.js's insertArtworkRecord/UPLOADS_DIR comment describes the
// contract this is checking: a candidate file gets copied (not moved) into UPLOADS_DIR
// and turned into a real `artworks` row, and only files that actually live inside
// CANDIDATES_DIR are eligible.
describe('POST /api/taste-filter/promote (Step 1.2 route, Step 1.3 tests)', () => {
  it('copies a candidate file into UPLOADS_DIR and creates an artworks row for it', async () => {
    const importRes = await request(app)
      .post('/api/taste-filter/import')
      .attach('files', Buffer.from('fake-png-bytes'), 'promote-me.png');
    const [candidate] = importRes.body.candidates;
    expect(candidate.error).toBeUndefined();

    const promoteRes = await request(app)
      .post('/api/taste-filter/promote')
      .send({ image_path: candidate.imagePath, original_filename: 'promote-me.png' });

    expect(promoteRes.status).toBe(201);
    const { artwork } = promoteRes.body;
    expect(artwork.id).toBeDefined();
    expect(artwork.original_filename).toBe('promote-me.png');
    expect(artwork.file_url).toMatch(/^\/artwork-files\//);

    // Copied, not moved -- the original candidate file must still be there.
    expect(fs.existsSync(candidate.imagePath)).toBe(true);
    // The new artwork file lives under ARTWORK_UPLOADS_DIR (this test's tmp uploads dir),
    // not CANDIDATES_DIR.
    expect(artwork.file_path.startsWith(process.env.ARTWORK_UPLOADS_DIR)).toBe(true);
    expect(fs.existsSync(artwork.file_path)).toBe(true);

    const getRes = await request(app).get(`/api/artworks/${artwork.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.file_path).toBe(artwork.file_path);
  });

  it('falls back to the candidate\'s own basename when original_filename is omitted', async () => {
    const importRes = await request(app)
      .post('/api/taste-filter/import')
      .attach('files', Buffer.from('fake-png-bytes'), 'no-name-given.png');
    const [candidate] = importRes.body.candidates;

    const promoteRes = await request(app)
      .post('/api/taste-filter/promote')
      .send({ image_path: candidate.imagePath });

    expect(promoteRes.status).toBe(201);
    expect(promoteRes.body.artwork.original_filename).toBe(path.basename(candidate.imagePath));
  });

  it('400s when image_path is missing', async () => {
    const res = await request(app).post('/api/taste-filter/promote').send({});
    expect(res.status).toBe(400);
  });

  it('400s on a path outside CANDIDATES_DIR', async () => {
    const outsidePath = path.join(tmpRoot, 'not-a-candidate.png');
    fs.writeFileSync(outsidePath, 'fake-png-bytes');

    const res = await request(app)
      .post('/api/taste-filter/promote')
      .send({ image_path: outsidePath });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/candidates directory/i);

    // Nothing should have been created.
    const artworksListRes = await request(app).get('/api/jobs');
    expect(artworksListRes.status).toBe(200);
  });

  it('400s on a directory-traversal attempt using a path outside CANDIDATES_DIR', async () => {
    const res = await request(app)
      .post('/api/taste-filter/promote')
      .send({ image_path: path.join(process.env.TASTE_FILTER_CANDIDATES_DIR, '..', 'escape.png') });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/candidates directory/i);
  });

  it('400s when the candidate file does not exist on disk', async () => {
    const missingPath = path.join(process.env.TASTE_FILTER_CANDIDATES_DIR, 'never-existed.png');

    const res = await request(app)
      .post('/api/taste-filter/promote')
      .send({ image_path: missingPath });

    expect(res.status).toBe(400);
  });
});

// Step 2.7 (plan.md -> Part 2 -> "Backend: route-level test"). Exercises the Step 2.6
// wiring in POST /api/taste-filter/import: with `taste_filter_auto_enabled=true` and a
// centroid pair that's already confident (>= COLD_START_MIN_EXAMPLES total labels), an
// extreme-score candidate should come back with a non-null `autoDecision` and a
// corresponding `auto_labeled = 1` row in image_preferences, while a mid-range/uncertain
// score still comes back `autoDecision: null` (manual review), same as auto mode being
// off.
describe('POST /api/taste-filter/import -> auto-compute decision rule (Step 2.6, tested here per Step 2.7)', () => {
  afterAll(async () => {
    // Leaves auto mode off so it can't leak into any test file run after this one.
    await request(app).patch('/api/settings').send({ taste_filter_auto_enabled: 'false' });
  });

  it('auto-decides extreme scores once confident, and leaves a mid-range score for manual review', async () => {
    // Seed the GLOBAL centroid pair well past COLD_START_MIN_EXAMPLES (30) with clearly
    // opposite labeled examples, no category -- so scoring against it later is
    // unambiguous (kept centroid ~= KEEP_LEANING, discarded centroid ~= DISCARD_LEANING).
    for (let i = 0; i < 20; i += 1) {
      await request(app).post('/api/taste-filter/label').send({
        image_path: `/tmp/auto-seed-keep-${i}.png`,
        embedding: Array.from(KEEP_LEANING),
        label: 'keep',
      });
      await request(app).post('/api/taste-filter/label').send({
        image_path: `/tmp/auto-seed-discard-${i}.png`,
        embedding: Array.from(DISCARD_LEANING),
        label: 'discard',
      });
    }

    const patchRes = await request(app).patch('/api/settings').send({
      taste_filter_auto_enabled: 'true',
      taste_filter_auto_threshold: '0.3',
    });
    expect(patchRes.status).toBe(200);

    // Three candidates, no category: matches KEEP_LEANING exactly (score ~1, well above
    // the 0.3 threshold), matches DISCARD_LEANING exactly (score ~-1), and an equal mix
    // of the two (score ~0, inside the uncertain band around the threshold).
    const MID_RANGE = new Float32Array([Math.SQRT1_2, Math.SQRT1_2, 0, 0]);
    embedImageMock.mockImplementationOnce(async () => KEEP_LEANING);
    embedImageMock.mockImplementationOnce(async () => DISCARD_LEANING);
    embedImageMock.mockImplementationOnce(async () => MID_RANGE);

    const res = await request(app)
      .post('/api/taste-filter/import')
      .attach('files', Buffer.from('fake'), 'extreme-keep.png')
      .attach('files', Buffer.from('fake'), 'extreme-discard.png')
      .attach('files', Buffer.from('fake'), 'mid-range.png');

    expect(res.status).toBe(201);
    const [keepCandidate, discardCandidate, midCandidate] = res.body.candidates;

    expect(keepCandidate.autoDecision).toBe('keep');
    expect(discardCandidate.autoDecision).toBe('discard');
    expect(midCandidate.autoDecision).toBeNull();

    const { getDb } = await import('./db/init.js');
    const db = getDb();

    const keepRow = db
      .prepare('SELECT auto_labeled, label FROM image_preferences WHERE image_path = ?')
      .get(keepCandidate.imagePath);
    expect(keepRow).toBeDefined();
    expect(keepRow.auto_labeled).toBe(1);
    expect(keepRow.label).toBe('keep');

    const discardRow = db
      .prepare('SELECT auto_labeled, label FROM image_preferences WHERE image_path = ?')
      .get(discardCandidate.imagePath);
    expect(discardRow).toBeDefined();
    expect(discardRow.auto_labeled).toBe(1);
    expect(discardRow.label).toBe('discard');

    // The mid-range candidate must NOT have been auto-labeled -- no row for it at all,
    // since Step 2.6 only writes image_preferences for a non-null decision.
    const midRow = db
      .prepare('SELECT * FROM image_preferences WHERE image_path = ?')
      .get(midCandidate.imagePath);
    expect(midRow).toBeUndefined();

    // The underlying candidate files themselves are never deleted, auto-decided or not
    // (Part 2's "Why" constraint: "Nothing is auto-deleted").
    expect(fs.existsSync(keepCandidate.imagePath)).toBe(true);
    expect(fs.existsSync(discardCandidate.imagePath)).toBe(true);
    expect(fs.existsSync(midCandidate.imagePath)).toBe(true);
  });

  it('leaves autoDecision null for every candidate when auto mode is off, even for an extreme score', async () => {
    await request(app).patch('/api/settings').send({ taste_filter_auto_enabled: 'false' });

    embedImageMock.mockImplementationOnce(async () => KEEP_LEANING);

    const res = await request(app)
      .post('/api/taste-filter/import')
      .attach('files', Buffer.from('fake'), 'extreme-but-auto-off.png');

    expect(res.status).toBe(201);
    expect(res.body.candidates[0].autoDecision).toBeNull();
  });

  it('an auto-decided candidate tallies its prompt terms, same as a manual label (issue #59, part 1)', async () => {
    const { getDb } = await import('./db/init.js');
    const db = getDb();
    const { lastInsertRowid: promptId } = db
      .prepare(`INSERT INTO prompts (orientation, prompt_text) VALUES ('square-canvas', 'a radiant glacier at noon --ar 1:1')`)
      .run();

    await request(app).patch('/api/settings').send({
      taste_filter_auto_enabled: 'true',
      taste_filter_auto_threshold: '0.3',
    });

    embedImageMock.mockImplementationOnce(async () => KEEP_LEANING);

    const res = await request(app)
      .post('/api/taste-filter/import')
      .field('prompt_id', String(promptId))
      .attach('files', Buffer.from('fake'), 'glacier.png');

    expect(res.status).toBe(201);
    expect(res.body.candidates[0].autoDecision).toBe('keep');

    const glacier = db.prepare('SELECT * FROM prompt_terms WHERE term = ?').get('glacier');
    expect(glacier).toBeDefined();
    expect(glacier.kept_count).toBeGreaterThanOrEqual(1);

    await request(app).patch('/api/settings').send({ taste_filter_auto_enabled: 'false' });
  });
});
