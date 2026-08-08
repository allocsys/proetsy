
// Module 7 (Taste Filter) -> "Auto-import via watched folder" (build sequence step 7).
// See ARCHITECTURE.md -> Module 7 -> "Future ... auto-import via watched folder" and ->
// "Activation". A lightweight chokidar file-watcher that, once turned on from the
// dashboard Settings panel, detects new image files landing in a local folder (where
// Midjourney downloads go), copies them into CANDIDATES_DIR (the same place a manual
// drag-and-drop import already saves to -- see server.js's `uploadCandidate` multer
// config), embeds + scores them the same way POST /api/taste-filter/import does, and
// holds the scored result in an in-process queue until the dashboard polls for it or the
// user labels it.
//
// Deliberately no DB table for this queue -- mirrors the "no separate pending
// candidates table" decision the manual-import path already made (ARCHITECTURE.md ->
// Module 7 -> "Build sequence" step 4): an imported-but-not-yet-labeled batch lives only
// on disk + in a response, never in `image_preferences`, until the user actually
// confirms keep/discard. The manual path's "response" is the HTTP reply itself, held in
// the frontend's local state; this path has no request to attach a response to (nothing
// triggered it from the browser), so the equivalent is a small in-process Map here
// instead, polled via GET /api/taste-filter/pending. Still transient by design, not
// durable -- a restart clears it, but anything still sitting in the watched folder just
// gets re-picked-up on the next chokidar 'add' event, so nothing is actually lost.

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';
import { getDb } from '../../db/init.js';
import { embedImage } from './embeddings.js';
import { scoreCandidate } from './scoring.js';
import { getCentroids } from './store.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

// Settings keys (ARCHITECTURE.md -> Module 7 -> "Activation": "a toggle in the dashboard
// Settings panel ... + a folder-path field"). Read/written through the existing generic
// settings key/value store (GET/PATCH /api/settings), same as every other Module 6
// setting -- no dedicated table needed for this one either.
export const SETTING_ENABLED = 'taste_filter_watch_enabled';
export const SETTING_FOLDER = 'taste_filter_watch_folder';
export const SETTING_CATEGORY = 'taste_filter_watch_category';

let watcher = null;
let watchedFolder = null;
let watchedCategory = null;
let lastError = null;
// imagePath -> candidate object, same shape POST /api/taste-filter/import already
// returns per-candidate, so TasteFilter.jsx can merge results from both sources without
// a separate code path.
const pending = new Map();

// Fires a 'candidate' event with the freshly-scored candidate object every time one is
// added to `pending` in handleNewFile below -- lets server.js push it straight to any
// open SSE connection (GET /api/taste-filter/pending/stream) instead of the dashboard
// having to poll GET /api/taste-filter/pending on a timer. GET /api/taste-filter/pending
// itself is unchanged and still returns the full current queue -- kept as the source of
// truth for a client's initial snapshot (and for anything that isn't SSE-capable); this
// emitter is purely an additional live-push channel on top of it, not a replacement.
const emitter = new EventEmitter();

function readSettings() {
  const db = getDb();
  const rows = db
    .prepare('SELECT key, value FROM settings WHERE key IN (?, ?, ?)')
    .all(SETTING_ENABLED, SETTING_FOLDER, SETTING_CATEGORY);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    enabled: map[SETTING_ENABLED] === 'true' || map[SETTING_ENABLED] === '1',
    folder: map[SETTING_FOLDER] || null,
    category: map[SETTING_CATEGORY] || null,
  };
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Copies a newly-detected file into CANDIDATES_DIR, embeds + scores it against the
 * current centroids, and adds it to the pending queue. Mirrors POST
 * /api/taste-filter/import's per-file try/catch -- one bad/corrupt file dropped into the
 * watched folder shouldn't take the watcher down, it just never makes it into the queue.
 * There's no HTTP response to attach that failure to here, so it's tracked as the
 * watcher's `lastError` instead, surfaced via getWatcherStatus().
 */
async function handleNewFile(sourcePath, candidatesDir, category) {
  if (!isImageFile(sourcePath)) return;
  try {
    const safeName = path.basename(sourcePath).replace(/[^a-zA-Z0-9_.-]/g, '_');
    const destPath = path.join(candidatesDir, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
    fs.copyFileSync(sourcePath, destPath);

    const embedding = await embedImage(destPath);
    const globalCentroids = getCentroids(null);
    const categoryCentroids = category ? getCentroids(category) : null;
    const scores = scoreCandidate(embedding, { global: globalCentroids, category: categoryCentroids });

    const candidate = {
      imagePath: destPath,
      imageUrl: `/taste-filter-files/${path.basename(destPath)}`,
      category,
      promptId: null,
      embedding: Array.from(embedding),
      ...scores,
    };
    pending.set(destPath, candidate);
    emitter.emit('candidate', candidate);
    lastError = null;
  } catch (err) {
    lastError = err.message;
  }
}

/**
 * Starts (or restarts) the watcher against whatever the settings table currently says,
 * and stops it cleanly if watching was turned off, unconfigured, or pointed at a
 * different folder. Called once on backend startup (so a restart picks a
 * previously-saved folder back up -- see server.js) and again after every PATCH
 * /api/settings (so toggling the checkbox or editing the folder path takes effect
 * immediately, no server restart needed). A settings change that touches neither the
 * enabled flag nor the folder (e.g. editing `default_price`) is a no-op here -- the
 * watcher, if any, just keeps running unchanged.
 * @param {string} candidatesDir - CANDIDATES_DIR from server.js, where detected files get copied
 */
export function syncWatcherFromSettings(candidatesDir) {
  const { enabled, folder, category } = readSettings();
  const shouldRun = enabled && !!folder;
  const folderChanged = folder !== watchedFolder;

  if (watcher && (!shouldRun || folderChanged)) {
    watcher.close();
    watcher = null;
    watchedFolder = null;
  }

  // Category can change without a restart -- it only affects which centroids a
  // newly-detected file gets scored against, not what's being watched.
  watchedCategory = category;

  if (!shouldRun || watcher) return;

  if (!fs.existsSync(folder)) {
    lastError = `Watched folder does not exist: ${folder}`;
    return;
  }

  watchedFolder = folder;
  lastError = null;
  // depth: 0 -- only files directly in the watched folder, not subfolders (matches "a
  // lightweight file-watcher can detect new files" -- a flat drop folder, not a tree to
  // recurse). awaitWriteFinish avoids reacting to a file that's still being written to
  // disk (e.g. a slow browser/Midjourney-client download) as if it were already complete.
  watcher = chokidar.watch(folder, {
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });
  watcher.on('add', (filePath) => {
    handleNewFile(filePath, candidatesDir, watchedCategory);
  });
  watcher.on('error', (err) => {
    lastError = err.message;
  });
}

/**
 * Returns the current pending queue (does NOT clear it) -- the dashboard polls this
 * repeatedly, and a candidate only leaves the queue once it's actually labeled (see
 * removePendingCandidate below) or the backend restarts.
 * @returns {Array<object>}
 */
export function getPendingCandidates() {
  return Array.from(pending.values());
}

/**
 * Subscribes to newly-detected pending candidates as they're scored, for a live-push
 * channel (GET /api/taste-filter/pending/stream in server.js) instead of requiring a
 * client to poll GET /api/taste-filter/pending on a timer. Returns an unsubscribe
 * function -- callers (one per open SSE connection) must call it when their connection
 * closes, or the listener leaks for the lifetime of the process.
 * @param {(candidate: object) => void} listener
 * @returns {() => void} unsubscribe
 */
export function onPendingCandidate(listener) {
  emitter.on('candidate', listener);
  return () => emitter.off('candidate', listener);
}

/**
 * Drops a candidate from the pending queue once it's been labeled (called from POST
 * /api/taste-filter/label). A no-op for any imagePath not currently in the queue -- e.g.
 * a manually drag-and-dropped candidate, which was never added here in the first place.
 * @param {string} imagePath
 */
export function removePendingCandidate(imagePath) {
  pending.delete(imagePath);
}

/**
 * Read-only status for the dashboard Settings panel -- whether the watcher is currently
 * active, which folder/category it's watching, how many candidates are sitting unlabeled,
 * and the most recent error (if any), so a bad folder path or a failed embed doesn't fail
 * silently.
 * @returns {{ active: boolean, folder: string | null, category: string | null, pendingCount: number, lastError: string | null }}
 */
export function getWatcherStatus() {
  return {
    active: !!watcher,
    folder: watchedFolder,
    category: watchedCategory,
    pendingCount: pending.size,
    lastError,
  };
}

/**
 * Test-only reset hook: closes any active watcher and clears all in-memory state, so
 * test files don't leak a live chokidar watcher (or stale pending candidates) into the
 * next suite. Not called from application code.
 */
export function _resetForTests() {
  if (watcher) watcher.close();
  watcher = null;
  watchedFolder = null;
  watchedCategory = null;
  pending.clear();
  lastError = null;
  emitter.removeAllListeners();
}
