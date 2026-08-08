import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// watcher.js's underlying getDb() reads DB_PATH at first call, so it must be set before
// the module (or its db/init.js dependency) is imported — same dynamic-import pattern
// store.test.js/embeddings.test.js use elsewhere in this directory. embedImage is
// mocked for the same reason server.taste-filter-routes.test.js mocks it: it needs a
// real ONNX model file on disk that isn't committed to the repo, and these tests are
// about the watcher's file-detection/queue behavior, not the CLIP model itself.
let getDb;
let syncWatcherFromSettings;
let getPendingCandidates;
let onPendingCandidate;
let removePendingCandidate;
let getWatcherStatus;
let _resetForTests;
let SETTING_ENABLED;
let SETTING_FOLDER;
let SETTING_CATEGORY;
let embedImageMock;

let tmpRoot;
let watchFolder;
let candidatesDir;

const FAKE_EMBEDDING = new Float32Array([1, 0, 0, 0]);

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-taste-filter-watcher-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  embedImageMock = vi.fn(async () => FAKE_EMBEDDING);
  vi.doMock('./embeddings.js', () => ({
    embedImage: (...args) => embedImageMock(...args),
  }));

  ({ getDb } = await import('../../db/init.js'));
  ({
    syncWatcherFromSettings,
    getPendingCandidates,
    onPendingCandidate,
    removePendingCandidate,
    getWatcherStatus,
    _resetForTests,
    SETTING_ENABLED,
    SETTING_FOLDER,
    SETTING_CATEGORY,
  } = await import('./watcher.js'));
});

afterAll(() => {
  vi.doUnmock('./embeddings.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function writeSetting(key, value) {
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

function clearSettings() {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key IN (?, ?, ?)').run(SETTING_ENABLED, SETTING_FOLDER, SETTING_CATEGORY);
}

// Polls getPendingCandidates() until it has at least `count` entries or the timeout
// elapses — chokidar's awaitWriteFinish + its own polling means a drop isn't picked up
// synchronously.
async function waitForPendingCount(count, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (getPendingCandidates().length >= count) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${count} pending candidate(s); got ${getPendingCandidates().length}`);
}

beforeEach(() => {
  watchFolder = fs.mkdtempSync(path.join(tmpRoot, 'watch-'));
  candidatesDir = fs.mkdtempSync(path.join(tmpRoot, 'candidates-'));
  clearSettings();
});

afterEach(() => {
  _resetForTests();
});

describe('syncWatcherFromSettings — off by default', () => {
  it('does not start a watcher when nothing is configured', () => {
    syncWatcherFromSettings(candidatesDir);
    const status = getWatcherStatus();
    expect(status.active).toBe(false);
    expect(status.folder).toBeNull();
  });

  it('does not start when enabled but no folder is set', () => {
    writeSetting(SETTING_ENABLED, 'true');
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().active).toBe(false);
  });

  it('does not start when a folder is set but not enabled', () => {
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().active).toBe(false);
  });

  it('records a clear error when the configured folder does not exist', () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, path.join(tmpRoot, 'does-not-exist'));
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().active).toBe(false);
    expect(getWatcherStatus().lastError).toMatch(/does not exist/);
  });
});

describe('syncWatcherFromSettings — enabled', () => {
  it('starts watching the configured folder', () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);

    const status = getWatcherStatus();
    expect(status.active).toBe(true);
    expect(status.folder).toBe(watchFolder);
  });

  it('detects a new image file, copies it into candidatesDir, embeds and scores it', async () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    writeSetting(SETTING_CATEGORY, 'square-canvas');
    syncWatcherFromSettings(candidatesDir);

    fs.writeFileSync(path.join(watchFolder, 'new-candidate.png'), 'fake-png-bytes');
    await waitForPendingCount(1);

    const [candidate] = getPendingCandidates();
    expect(candidate.category).toBe('square-canvas');
    expect(candidate.embedding).toEqual(Array.from(FAKE_EMBEDDING));
    expect(candidate.imageUrl).toMatch(/^\/taste-filter-files\//);
    // Copied into candidatesDir, not left pointing at the original watched-folder path.
    expect(path.dirname(candidate.imagePath)).toBe(candidatesDir);
    expect(fs.existsSync(candidate.imagePath)).toBe(true);
  });

  it('ignores non-image files dropped into the watched folder', async () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);

    fs.writeFileSync(path.join(watchFolder, 'notes.txt'), 'hello');
    // Give chokidar a beat to have processed it if it were (wrongly) going to.
    await new Promise((r) => setTimeout(r, 800));
    expect(getPendingCandidates()).toHaveLength(0);
  });

  it('removePendingCandidate drops a candidate once labeled, and is a no-op for an unknown path', async () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);

    fs.writeFileSync(path.join(watchFolder, 'to-label.png'), 'fake-png-bytes');
    await waitForPendingCount(1);
    const [candidate] = getPendingCandidates();

    removePendingCandidate(candidate.imagePath);
    expect(getPendingCandidates()).toHaveLength(0);

    expect(() => removePendingCandidate('/nonexistent/path.png')).not.toThrow();
  });

  it('stops watching once turned off, and re-syncing again is a no-op while still off', () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().active).toBe(true);

    writeSetting(SETTING_ENABLED, 'false');
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().active).toBe(false);

    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().active).toBe(false);
  });

  it('a settings change unrelated to watching is a no-op for an already-running watcher', () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);
    const firstStatus = getWatcherStatus();

    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus()).toEqual(firstStatus);
  });

  it('switching the watched folder restarts against the new one', () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().folder).toBe(watchFolder);

    const secondFolder = fs.mkdtempSync(path.join(tmpRoot, 'watch2-'));
    writeSetting(SETTING_FOLDER, secondFolder);
    syncWatcherFromSettings(candidatesDir);
    expect(getWatcherStatus().folder).toBe(secondFolder);
  });
});

// Backs GET /api/taste-filter/pending/stream in server.js -- a live-push channel on top
// of the existing GET /api/taste-filter/pending poll route, so a subscriber (one per SSE
// connection) finds out about a newly-detected candidate the moment handleNewFile scores
// it, instead of only through the next poll.
describe('onPendingCandidate — live-push subscription used by the SSE route', () => {
  it('notifies a subscriber the moment a new candidate is detected and scored', async () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);

    const received = [];
    const unsubscribe = onPendingCandidate((c) => received.push(c));

    fs.writeFileSync(path.join(watchFolder, 'pushed.png'), 'fake-png-bytes');
    await waitForPendingCount(1);

    expect(received).toHaveLength(1);
    expect(received[0].imagePath).toBe(getPendingCandidates()[0].imagePath);
    unsubscribe();
  });

  it('stops delivering candidates once unsubscribed', async () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);

    const received = [];
    const unsubscribe = onPendingCandidate((c) => received.push(c));
    unsubscribe();

    fs.writeFileSync(path.join(watchFolder, 'unsubscribed.png'), 'fake-png-bytes');
    await waitForPendingCount(1);

    expect(received).toHaveLength(0);
  });

  it('supports multiple independent subscribers, e.g. two concurrent SSE connections', async () => {
    writeSetting(SETTING_ENABLED, 'true');
    writeSetting(SETTING_FOLDER, watchFolder);
    syncWatcherFromSettings(candidatesDir);

    const receivedA = [];
    const receivedB = [];
    const unsubscribeA = onPendingCandidate((c) => receivedA.push(c));
    const unsubscribeB = onPendingCandidate((c) => receivedB.push(c));

    fs.writeFileSync(path.join(watchFolder, 'fan-out.png'), 'fake-png-bytes');
    await waitForPendingCount(1);

    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(receivedA[0].imagePath).toBe(receivedB[0].imagePath);
    unsubscribeA();
    unsubscribeB();
  });
});
