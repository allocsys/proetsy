import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getDb, withTransaction } from './db/init.js';
import {
  getPipelineConfig,
  getProductSizes,
  migratePipelineConfigSeed,
  invalidatePipelineConfigCache,
  getShopConventions,
  setShopConventions,
  exportAllConfig,
  importAllConfig,
} from './config/index.js';
import { createJob, createJobsBulk, getJobWithModules, setManualNotes, setModuleStatus } from './lib/jobs.js';
import { analyzeArtworkForJob } from './lib/image-analyzer/index.js';
import { generateListingsForJob } from './lib/listing-generator/index.js';
import { enforceConventions } from './lib/listing-generator/validate.js';
import {
  generateMockupForJob,
  OUTPUT_DIR,
  getTempCleanupFailureCount,
  TEMP_CLEANUP_FAILURE_THRESHOLD,
} from './lib/mockup-generator.js';
import { runPendingModulesForJob, runPendingModulesForJobs } from './lib/pipeline-runner.js';
import { initRateLimitCache } from './lib/llm/rate-limits.js';
import { listKeysMasked, addKey, setKeyEnabled, deleteKey, getKeysForProvider } from './lib/llm/key-store.js';
import { getTrends } from './lib/trends/index.js';
import { addManualTrend, importFromCsvRows, rowsFromCsvText } from './lib/trends/manual.js';
import { parseCsv } from './lib/csv.js';
import {
  importTagsFromCsvRows,
  tagRowsFromCsvText,
  suggestCategoriesForUncategorizedTags,
} from './lib/tags/user-list.js';
import { generatePromptsForTrend, listPrompts } from './lib/prompt-helper/index.js';
import {
  embedImage,
  ensureModelReady,
  getModelDownloadState,
  onModelDownloadProgress,
} from './lib/taste-filter/embeddings.js';
import { scoreCandidate, autoDecision } from './lib/taste-filter/scoring.js';
import {
  getCentroids,
  addImagePreference,
  recomputeCentroids,
  tallyPromptTermsForLabel,
  getImagePreferenceState,
  recomputePromptTerms,
} from './lib/taste-filter/store.js';
import { syncWatcherFromSettings, getPendingCandidates, removePendingCandidate, getWatcherStatus, onPendingCandidate } from './lib/taste-filter/watcher.js';
import {
  scanTemplatesFolder,
  listConfiguredTemplates,
  upsertConfiguredTemplate,
  deleteConfiguredTemplate,
  listConfiguredCategories,
  getTemplatesDirSetting,
  PREVIEW_DIR as MOCKUP_TEMPLATE_PREVIEW_DIR,
} from './lib/mockup-templates/index.js';

// Module 7 -> Part 2 (plan.md) -> Step 2.3: settings-table keys for the auto-compute
// taste threshold, same key/value `settings` table as everything else (no dedicated
// columns/migration needed to add these -- see the `/api/settings` route below). Unlike
// most settings keys, GET /api/settings explicitly fills in defaults for these two when
// unset, since the Step 2.4 decision rule (scoring.js, wired in Step 2.6) needs a real
// enabled/threshold value to apply, not just "missing".
const SETTING_AUTO_ENABLED = 'taste_filter_auto_enabled';
const SETTING_AUTO_THRESHOLD = 'taste_filter_auto_threshold';
const AUTO_SETTING_DEFAULTS = {
  [SETTING_AUTO_ENABLED]: 'true',
  [SETTING_AUTO_THRESHOLD]: '0.3',
};

const app = express();
const PORT = process.env.PORT || 4000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Storage for artwork the user drags/uploads into the dashboard (Module 6 -> "Lets the
// user drag-and-drop artwork"). Mirrors mockup-generator.js's MOCKUP_OUTPUT_DIR pattern:
// env-overridable, otherwise resolved against the backend package root (not
// process.cwd()) so behavior doesn't depend on where `node server.js` is launched from.
const UPLOADS_DIR = process.env.ARTWORK_UPLOADS_DIR
  ? path.resolve(process.cwd(), process.env.ARTWORK_UPLOADS_DIR)
  : path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
  },
});
const upload = multer({ storage: uploadStorage, limits: { fileSize: 25 * 1024 * 1024 } });

// Module 7 (Taste Filter) -> "Build sequence" step 4. Storage for raw Midjourney-batch
// candidates dragged into the dashboard for scoring, kept separate from artwork uploads
// (UPLOADS_DIR) since candidates aren't artworks until/unless a kept one is later dragged
// into "Upload Artwork" per the closed-loop diagram.
const CANDIDATES_DIR = process.env.TASTE_FILTER_CANDIDATES_DIR
  ? path.resolve(process.cwd(), process.env.TASTE_FILTER_CANDIDATES_DIR)
  : path.join(__dirname, 'data', 'taste-filter');
fs.mkdirSync(CANDIDATES_DIR, { recursive: true });

const candidateStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CANDIDATES_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
  },
});
const uploadCandidate = multer({ storage: candidateStorage, limits: { fileSize: 25 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
// Serves uploaded artwork files back to the dashboard (thumbnails, review screens).
app.use('/artwork-files', express.static(UPLOADS_DIR));
// Serves raw taste-filter candidate images back to the dashboard's ranked batch grid.
app.use('/taste-filter-files', express.static(CANDIDATES_DIR));

// Serves generated mockup images for the dashboard review UI (step 7). Files in
// OUTPUT_DIR are flat (no subdirectories — see composeMockup's naming convention), so a
// basename is a safe, stable public URL; mockupFileUrl() below is the one place that
// turns a stored server-side path into one.
app.use('/mockup-files', express.static(OUTPUT_DIR));
// Serves generated mockup-template preview thumbnails for the dashboard folder-picker
// grid (plan.md -> "New routes" -> "Static serving"). Same flat/basename-URL convention
// as /mockup-files above -- see lib/mockup-templates/index.js's generateTemplatePreview.
app.use('/mockup-template-previews', express.static(MOCKUP_TEMPLATE_PREVIEW_DIR));

function mockupFileUrl(filePath) {
  return filePath ? `/mockup-files/${path.basename(filePath)}` : null;
}

function withMockupUrls(row) {
  return {
    ...row,
    file_url: mockupFileUrl(row.file_path),
    smart_crop_url: mockupFileUrl(row.smart_crop_path),
    ai_extended_url: mockupFileUrl(row.ai_extended_path),
  };
}

// Initializes the schema on boot (CREATE TABLE IF NOT EXISTS, so safe to call every start).
getDb();

// One-time migration: seeds each pipeline module's `pipeline_module_<name>_enabled`
// settings key from pipeline.config.json the first time it's seen, so an existing
// hand-edited JSON file's toggles survive the move to the dashboard-editable flow (see
// config/index.js -> migratePipelineConfigSeed(), plan.md -> "Rollout" step 4). Safe to
// call on every startup -- a no-op once each module's settings key has been seeded once.
migratePipelineConfigSeed();

// Rehydrates the LLM provider layer's in-process cooldown Map from the durable
// llm_rate_limits table, so a restart doesn't reset an already-exhausted key/model pair
// back to "looks fine, try it". See ARCHITECTURE.md -> LLM Provider Layer -> "Rate-limit
// cooldown tracking".
initRateLimitCache();

// Module 7 -> "Auto-import via watched folder" (step 7). Off by default -- this only
// actually starts watching if taste_filter_watch_enabled/taste_filter_watch_folder are
// already saved in the settings table from a previous run (e.g. this is a restart, not a
// fresh DB). See ARCHITECTURE.md -> Module 7 -> "Activation".
syncWatcherFromSettings(CANDIDATES_DIR);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Module 7 -> "Auto-import via watched folder": a one-click default for the watched-
// folder Settings field, so the user doesn't have to type/paste a full path just to try
// the feature. os.homedir() resolves correctly cross-platform (including Windows --
// C:\Users\<name>\Downloads), and Downloads is the most common landing spot for
// Midjourney web-app / browser-saved images. `exists: false` just means the guess is a
// folder the user would need to create -- never auto-created here, since watching (or
// creating) an arbitrary folder without confirmation isn't this route's call to make.
app.get('/api/system/default-watch-folder', (req, res) => {
  const suggested = path.join(os.homedir(), 'Downloads');
  res.json({ suggested, exists: fs.existsSync(suggested) });
});

// ARCHITECTURE.md -> First-Run Setup -> "Detection: on backend startup, check for (1) at
// least one Gemini key (dashboard-managed, DB-backed -- see key-store.js), (2) an
// initialized DB, (3) at least one configured row in the product_sizes table." Also reports the
// tag-library check ("Required for Module 2") so the dashboard's persistent
// Settings-panel status list (not just a one-time modal) has everything it needs in one
// call.
app.get('/api/setup-status', (req, res) => {
  const db = getDb();
  const geminiKeyConfigured = getKeysForProvider('gemini').length > 0;
  // "Configured" means at least one row with the fields mockup-generator.js actually
  // needs to compose a mockup -- a bare row count would treat an empty/placeholder
  // dashboard entry as ready. Same required-field definition getProductSizes() should
  // use when it adds validation (debug.md step 3), so the two checks can't drift apart.
  const hasProductSize = db
    .prepare(
      `SELECT COUNT(*) AS n FROM product_sizes
       WHERE dimensions IS NOT NULL AND dimensions != ''
         AND mockup_template_path IS NOT NULL AND mockup_template_path != ''`
    )
    .get().n > 0;
  const hasTagLibrary = db.prepare('SELECT COUNT(*) AS n FROM tags').get().n > 0;
  // debug.md Issue 3: mockup-generator's temp-file cleanup failures were only visible via
  // console.warn. Surfaced here once they cross TEMP_CLEANUP_FAILURE_THRESHOLD so
  // persistent disk/permission trouble is flagged in the dashboard before it silently
  // accumulates into an unrelated-looking "no space left on device" error. Below the
  // threshold, tempCleanupIssue stays false -- a one-off failure isn't itself alarming --
  // but the raw count is always included so it's visible either way, not just at cutover.
  const tempCleanupFailureCount = getTempCleanupFailureCount();
  res.json({
    geminiKeyConfigured,
    dbInitialized: true,
    hasProductSize,
    hasTagLibrary,
    readyToRun: geminiKeyConfigured && hasTagLibrary,
    tempCleanupFailureCount,
    tempCleanupIssue: tempCleanupFailureCount >= TEMP_CLEANUP_FAILURE_THRESHOLD,
  });
});

app.get('/api/config/pipeline', (req, res) => {
  res.json(getPipelineConfig());
});

app.get('/api/config/product-sizes', (req, res) => {
  res.json(getProductSizes());
});

// Module 6 -> Settings panel: previously "not yet done" -- "shop style conventions...
// not consolidated into the Settings panel". Dashboard-editable (see plan.md ->
// "Dashboard-Editable Shop Conventions") -- DB-backed via getShopConventions(), no
// longer a static read of the hardcoded SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS module.
// See PATCH /api/config/shop-conventions below for the write side.
app.get('/api/config/shop-conventions', (req, res) => {
  res.json(getShopConventions());
});

// Write side of the above. Body: { listing?: {...partial fields}, midjourney?: {...partial
// fields} } -- partial at both the top level and within each group, matching
// PATCH /api/settings's "each key upserted independently" behavior. setShopConventions()
// validates every provided field (and the merged stylizeMin/stylizeMax/defaultStylize
// trio) before writing anything -- an invalid field 400s with no partial write, same
// error-to-400 pattern as POST /api/mockup-templates's upsertConfiguredTemplate call.
app.patch('/api/config/shop-conventions', (req, res) => {
  try {
    res.json(setShopConventions(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Full config backup/restore -- settings, product sizes/mockup templates, tag library,
// and (by default) API keys, bundled into one downloadable JSON file. Deliberately
// excludes job/artwork/listing/taste-filter data -- see exportAllConfig()'s doc comment.
// Works identically on any OS the dashboard runs on (Windows, macOS, Linux) since it's
// just a JSON file the browser downloads/uploads -- no server-side filesystem access to
// the user's machine involved. ?include_api_keys=false strips key material from the
// export, e.g. before sharing a config file with someone else.
app.get('/api/config/export', (req, res) => {
  const includeApiKeys = req.query.include_api_keys !== 'false';
  res.json(exportAllConfig({ includeApiKeys }));
});

// Body is a bundle previously returned by GET /api/config/export (or a hand-edited
// subset of one -- every section is optional, see importAllConfig()). Upserts/dedupes
// rather than wiping first, so this is safe to run against a backup taken a while ago
// without losing config added since.
app.post('/api/config/import', (req, res) => {
  try {
    const counts = importAllConfig(req.body || {});
    res.json({ imported: counts });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// LLM Provider Layer -> "Rate-limit cooldown tracking": previously no dashboard/API
// surface existed for this at all -- the durable `llm_rate_limits` table and the
// in-process cooldown cache (backend/lib/llm/rate-limits.js) were both fully built, but
// invisible outside the DB itself. Read-only, mirroring the /api/taste-filter/watch-status
// pattern. `key_index` only, never the raw API key, per the existing "identified by key
// index, not the raw key" rule -- see ARCHITECTURE.md -> LLM Provider Layer. Rows with a
// null `limited_until` (a pair that's fully recovered -- recordSuccess() clears it back
// to NULL rather than deleting the row) are included with `currentlyLimited: false` so the
// dashboard can show full key x model history, not just active cooldowns.
app.get('/api/llm/rate-limits', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT key_index, model, limited_until, consecutive_hits, reason, updated_at
       FROM llm_rate_limits
       ORDER BY key_index, model`
    )
    .all();
  const now = Date.now();
  res.json(
    rows.map((r) => ({
      keyIndex: r.key_index,
      model: r.model,
      limitedUntil: r.limited_until,
      currentlyLimited: Boolean(r.limited_until && Date.parse(r.limited_until) > now),
      consecutiveHits: r.consecutive_hits,
      reason: r.reason,
      updatedAt: r.updated_at,
    }))
  );
});

// Shared by POST /api/artworks/upload and POST /api/taste-filter/promote -- both end
// with the same thing: a file already sitting in UPLOADS_DIR becoming an `artworks` row.
// Kept as a plain insert (no move/copy logic here) so callers are explicit about getting
// the file into UPLOADS_DIR themselves first.
function insertArtworkRecord(filePath, originalFilename) {
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO artworks (file_path, original_filename) VALUES (?, ?)')
    .run(filePath, originalFilename || null);
  return {
    ...db.prepare('SELECT * FROM artworks WHERE id = ?').get(lastInsertRowid),
    file_url: `/artwork-files/${path.basename(filePath)}`,
  };
}

// Module 6 -> "Lets the user drag-and-drop artwork" / "Supports bulk mode (multiple
// artworks through the pipeline at once)". Accepts one or many files under the `files`
// field (a single drop and a bulk drop are the same request shape) and creates one
// artwork row per file. Actual pipeline runs are still kicked off by POST /api/jobs —
// this route only handles getting the files onto disk and into the artworks table.
app.post('/api/artworks/upload', upload.array('files', 50), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded (expected multipart field "files")' });

  const artworks = files.map((file) => insertArtworkRecord(file.path, file.originalname));
  res.status(201).json({ artworks });
});

// Module 6 -> Settings panel: default price, delivery text, and other free-form
// shop-level settings. Backed by the generic `settings` key/value table (see
// ARCHITECTURE.md -> Database Schema -> "Config-as-data") rather than dedicated columns,
// since the set of settings fields is expected to grow without needing a migration each
// time.
app.get('/api/settings', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = { ...AUTO_SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
  res.json(settings);
});

// Body is a flat { key: value, ... } object; each key is upserted independently so a
// partial update (e.g. just { default_price: '24.00' }) doesn't clobber other settings.
app.patch('/api/settings', (req, res) => {
  const updates = req.body || {};
  const db = getDb();
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  withTransaction(db, () => {
    for (const [key, value] of Object.entries(updates)) {
      upsert.run(key, value === null || value === undefined ? null : String(value));
    }
  });
  // getPipelineConfig() is memoized (config/index.js) -- any settings PATCH could have
  // touched a pipeline_module_<name>_enabled key, so invalidate unconditionally rather
  // than trying to detect which keys changed. Cheap: the next getPipelineConfig() call
  // just rebuilds it once.
  invalidatePipelineConfigCache();
  // Re-reconciles the taste-filter watcher against whatever just changed -- covers
  // toggling taste_filter_watch_enabled, editing taste_filter_watch_folder/_category, or
  // any other settings PATCH that happens to touch none of those (a no-op in that case,
  // see syncWatcherFromSettings). Takes effect immediately, no server restart needed.
  syncWatcherFromSettings(CANDIDATES_DIR);
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json({ ...AUTO_SETTING_DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) });
});

// plan.md -> "Editable Settings & API Keys from Dashboard": dashboard-managed LLM
// provider API keys, backed by the `api_keys` table (see lib/llm/key-store.js) -- the
// ONLY source of truth as of plan.md Rollout step 5 (the earlier .env fallback for
// GEMINI_API_KEYS / CLAUDE_API_KEY has been removed now that this path is confirmed
// working). Full key values are never returned by any of these routes -- list/create
// both come back through listKeysMasked()-shaped objects (masked to the last 4 chars).
// No auth layer on these routes -- confirmed as not needed, the dashboard is
// single-user/local (see plan.md's resolved "Open Question for User").
app.get('/api/settings/api-keys', (req, res) => {
  res.json(listKeysMasked());
});

// Body: { provider: 'gemini' | 'claude', key_value: string, label?: string }. Provider
// isn't restricted to a fixed enum here -- any provider string is a valid row, whether
// or not gemini.js/claude.js actually know how to consume it.
app.post('/api/settings/api-keys', (req, res) => {
  const { provider, key_value, label } = req.body || {};
  if (!provider || !key_value) {
    return res.status(400).json({ error: 'provider and key_value are required' });
  }
  try {
    const key = addKey({ provider, key_value, label });
    res.status(201).json(key);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Body: { enabled: boolean }. Enable/disable rather than edit-in-place -- there's no
// route to change an existing key's value, matching the "never re-expose a full key
// value" security note (an edit would require either accepting a new full value, which
// this covers via delete + re-add, or reading the old one back out, which we don't do).
app.patch('/api/settings/api-keys/:id', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }
  const updated = setKeyEnabled(Number(req.params.id), enabled);
  if (!updated) return res.status(404).json({ error: 'API key not found' });
  res.json(listKeysMasked().find((k) => k.id === Number(req.params.id)));
});

app.delete('/api/settings/api-keys/:id', (req, res) => {
  const deleted = deleteKey(Number(req.params.id));
  if (!deleted) return res.status(404).json({ error: 'API key not found' });
  res.status(204).end();
});

// Module 6 -> First-Run Setup -> "Required for Module 2 (core): a starter tag list —
// paste a list or upload a CSV, not one-at-a-time entry." Also doubles as the ongoing
// Settings-panel tag-library editor. Module 2's tags provider layer (lib/tags/user-list.js)
// reads straight from this table.
app.get('/api/tags', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM tags ORDER BY tag_text').all());
});

// Settings panel's "Delete tag" button (Tags & Trends) -- previously missing entirely,
// so every delete request 404'd silently (the frontend didn't check the response status
// before refreshing). See docs/known-issues/functional-correctness-review-2026-08-11.md #2.
app.delete('/api/tags/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM tags WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Tag not found' });
  res.status(204).end();
});

// Body: { tags: "one\nper\nline" or ["one", "two"], category?, source? }. Skips tags
// already present (by exact text) so pasting the same list twice doesn't duplicate rows.
app.post('/api/tags/bulk', (req, res) => {
  const { tags, category, source } = req.body || {};
  const list = Array.isArray(tags)
    ? tags
    : String(tags || '')
        .split(/\r?\n|,/)
        .map((t) => t.trim())
        .filter(Boolean);
  if (!list.length) return res.status(400).json({ error: 'tags is required (newline/comma-separated string or array)' });

  const db = getDb();
  const existing = new Set(db.prepare('SELECT tag_text FROM tags').all().map((r) => r.tag_text));
  const insert = db.prepare('INSERT INTO tags (tag_text, category, source) VALUES (?, ?, ?)');
  const run = db.transaction(() => {
    let inserted = 0;
    for (const tag of list) {
      if (existing.has(tag)) continue;
      insert.run(tag, category || null, source || 'manual');
      existing.add(tag);
      inserted += 1;
    }
    return inserted;
  });
  const inserted = run();
  res.status(201).json({ inserted, total: existing.size, tags: db.prepare('SELECT * FROM tags ORDER BY tag_text').all() });
});

// CSV tag import (ARCHITECTURE.md -> Module 6 -> Settings panel: previously "not yet
// done" -- "the backend already has importFromCsvRows in trends/manual.js for trends,
// but no analogous CSV path for tags"). Body: { csv: "<raw CSV text>" }. Mirrors
// POST /api/trends/csv's shape and dedupe-against-existing behavior (see
// tags/user-list.js's importTagsFromCsvRows), so a CSV overlapping the current library
// doesn't create duplicate tag rows.
app.post('/api/tags/csv', (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv is required (raw CSV text)' });
  const rows = tagRowsFromCsvText(csv);
  if (!rows.length) {
    // Same distinction as POST /api/trends/csv above -- header-only/empty file vs. rows
    // present but none have a usable tag-text column.
    const error = parseCsv(csv).length > 0
      ? 'No usable rows found (expected a tag_text/tag/text/keyword column)'
      : 'CSV has no data rows to import (only a header row, or the file is empty)';
    return res.status(400).json({ error });
  }
  const inserted = importTagsFromCsvRows(rows);
  const db = getDb();
  res.status(201).json({ inserted, tags: db.prepare('SELECT * FROM tags ORDER BY tag_text').all() });
});

// plan.md Rollout step 3: one-time "Suggest categories for uncategorized tags" admin
// action (Tag Library settings). Matches each uncategorized tag's text against
// categories already in use elsewhere in the library -- no request body needed, this is
// entirely derived from the current state of the tags table (see
// suggestCategoriesForUncategorizedTags).
app.post('/api/tags/backfill-categories', (req, res) => {
  // ?dry_run=true (or body { dry_run: true }) computes and returns the proposed
  // tag -> category matches without writing them, so the dashboard can show a preview
  // before the user commits (see user-list.js's suggestCategoriesForUncategorizedTags
  // dryRun option). Omitted/false behaves exactly as before -- writes immediately.
  const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === true;
  const result = suggestCategoriesForUncategorizedTags({ dryRun });
  const db = getDb();
  res.status(200).json({ ...result, tags: db.prepare('SELECT * FROM tags ORDER BY tag_text').all() });
});

app.get('/api/jobs', (req, res) => {
  const db = getDb();
  const jobs = db
    .prepare(
      `SELECT jobs.*, artworks.file_path AS artwork_file_path
       FROM jobs
       JOIN artworks ON artworks.id = jobs.artwork_id
       ORDER BY jobs.created_at DESC`
    )
    .all();
  res.json(jobs);
});

// Minimal artwork record creation. Not Module 1 (Image Analyzer) — no actual analysis
// happens here, just data plumbing so Module 2 can be exercised end-to-end before
// Module 1's real vision pipeline is built. `image_analysis` can be posted directly for
// testing, or left null and backfilled by Module 1 later.
app.post('/api/artworks', (req, res) => {
  const { file_path, original_filename, image_analysis } = req.body || {};
  if (!file_path) return res.status(400).json({ error: 'file_path is required' });
  const db = getDb();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO artworks (file_path, original_filename, image_analysis) VALUES (?, ?, ?)')
    .run(file_path, original_filename || null, image_analysis ? JSON.stringify(image_analysis) : null);
  res.status(201).json(db.prepare('SELECT * FROM artworks WHERE id = ?').get(lastInsertRowid));
});

app.get('/api/artworks/:id', (req, res) => {
  const db = getDb();
  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(Number(req.params.id));
  if (!artwork) return res.status(404).json({ error: 'Artwork not found' });
  res.json({ ...artwork, image_analysis: artwork.image_analysis ? JSON.parse(artwork.image_analysis) : null });
});

// Creates a job for an artwork, seeding job_modules from the current pipeline config.
// `pipeline_overrides` (optional): { [module_name]: boolean } — Module 6's per-run
// pipeline-config-panel toggle (see ARCHITECTURE.md -> Step control model -> "UI
// override"). Omit it to just use the saved default config as-is.
// `batch_id` (optional): a client-generated string shared across every job created from
// the same bulk drop, so the dashboard history log can group them into one batch row
// (see ARCHITECTURE.md -> Module 6 -> "consolidated single-page 'bulk batch' view").
app.post('/api/jobs', (req, res) => {
  const { artwork_id, pipeline_overrides, batch_id } = req.body || {};
  if (!artwork_id) return res.status(400).json({ error: 'artwork_id is required' });
  try {
    const jobId = createJob(artwork_id, pipeline_overrides || {}, batch_id || null);
    res.status(201).json(getJobWithModules(jobId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// plan.md step 6: single bulk-create endpoint so the dashboard's multi-file upload can
// make one request instead of one POST /api/jobs per file. All-or-nothing across the
// array (see createJobsBulk) -- a bad artwork_id 400s without creating any of the other
// jobs in the batch.
app.post('/api/jobs/bulk', (req, res) => {
  const { artwork_ids, pipeline_overrides, batch_id } = req.body || {};
  if (!Array.isArray(artwork_ids) || !artwork_ids.length) {
    return res.status(400).json({ error: 'artwork_ids is required and must be a non-empty array' });
  }
  try {
    const jobIds = createJobsBulk(artwork_ids, pipeline_overrides || {}, batch_id || null);
    res.status(201).json({ jobs: jobIds.map((jobId) => getJobWithModules(jobId)) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJobWithModules(Number(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Server-side pipeline runner (see backend/lib/pipeline-runner.js) — runs every
// currently pending/retryable module for this job, in pipeline order, from a single
// request. Unlike the dashboard sequencing individual /run/<module> calls itself, the
// work here isn't tied to the client staying connected: once this request lands, the
// async chain keeps running server-side even if the browser tab that triggered it
// closes. Existing single-module routes (/run/image-analyzer etc.) are unchanged and
// still the right tool for a targeted manual retry of just one module.
app.post('/api/jobs/:id/run', async (req, res) => {
  const jobId = Number(req.params.id);
  // Optional (plan.md -> "Mockup categories" -> backend changes): when provided,
  // restricts the mockup-composer loop to just these size_keys instead of every
  // configured size -- how the curated flow's category-selection step limits mockup
  // generation to only the categories picked for a given artwork. Omitted, behavior is
  // unchanged (every configured size, same as POST /api/jobs/run-batch still does).
  const { size_keys } = req.body || {};
  try {
    const { job, results } = await runPendingModulesForJob(jobId, { sizeKeys: size_keys });
    res.json({ job, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Bulk-mode counterpart: runs the full pipeline for several jobs at once, each
// independently (see ARCHITECTURE.md -> Partial Failure Handling -> Bulk mode). Body:
// { job_ids: number[] }.
app.post('/api/jobs/run-batch', async (req, res) => {
  const { job_ids } = req.body || {};
  if (!Array.isArray(job_ids) || !job_ids.length) {
    return res.status(400).json({ error: 'job_ids is required and must be a non-empty array' });
  }
  const outcomes = await runPendingModulesForJobs(job_ids.map(Number));
  res.json({ outcomes });
});

// Fallback input for Module 2 when Module 1 (Image Analyzer) is skipped or fails.
app.patch('/api/jobs/:id/manual-notes', (req, res) => {
  const { notes } = req.body || {};
  setManualNotes(Number(req.params.id), notes ?? null);
  res.json(getJobWithModules(Number(req.params.id)));
});

// Runs Module 1 (Image Analyzer) for a job. Optional/non-required module: on failure the
// job's module status is 'failed' but overall_status is NOT forced to 'failed' — per
// ARCHITECTURE.md -> Partial Failure Handling, "the job pauses and asks the user for
// manual notes instead of auto-failing the whole job" rather than blocking Module 2. The
// user can PATCH /api/jobs/:id/manual-notes and proceed as if Module 1 had been skipped.
// Persists to `artworks.image_analysis`, so a re-run overwrites the analysis rather than
// duplicating anything (single column, not a separate job-scoped table row).
app.post('/api/jobs/:id/run/image-analyzer', async (req, res) => {
  const jobId = Number(req.params.id);

  setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
  try {
    const imageAnalysis = await analyzeArtworkForJob(jobId);
    setModuleStatus(jobId, 'image_analyzer', 'success', { required: false });
    res.json({ job: getJobWithModules(jobId), imageAnalysis });
  } catch (err) {
    setModuleStatus(jobId, 'image_analyzer', 'failed', { required: false, errorMessage: err.message });
    res.status(422).json({ error: err.message, job: getJobWithModules(jobId) });
  }
});

// Runs Module 2 (Listing Generator) for a job. Core/required module: on failure the job
// is marked 'failed' and the error is surfaced directly (see ARCHITECTURE.md -> Partial
// Failure Handling). Re-running overwrites this job's listings rather than duplicating
// them (UNIQUE(job_id, variation) on the listings table).
app.post('/api/jobs/:id/run/listing-generator', async (req, res) => {
  const jobId = Number(req.params.id);
  const { trend_id } = req.body || {};

  setModuleStatus(jobId, 'listing_generator', 'running', { required: true });
  try {
    const listings = await generateListingsForJob(jobId, { trendId: trend_id || null });
    setModuleStatus(jobId, 'listing_generator', 'success', { required: true });
    res.json({ job: getJobWithModules(jobId), listings });
  } catch (err) {
    setModuleStatus(jobId, 'listing_generator', 'failed', { required: true, errorMessage: err.message });
    res.status(422).json({ error: err.message, job: getJobWithModules(jobId) });
  }
});

app.get('/api/jobs/:id/listings', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM listings WHERE job_id = ? ORDER BY variation')
    .all(Number(req.params.id));
  const listings = rows.map((r) => ({
    ...r,
    tags: r.tags ? JSON.parse(r.tags) : [],
    tag_alternates: r.tag_alternates ? JSON.parse(r.tag_alternates) : [],
  }));
  res.json(listings);
});

// Dashboard review/edit for a single generated listing (ARCHITECTURE.md -> Module 6 ->
// "Previews and allows editing any generated field before publishing"). Any of
// title/description/tags/tag_alternates may be omitted to leave that field unchanged.
// Re-applies enforceConventions() to the merged result -- the same backstop generation
// time already gets -- so a manual edit can't slip a forbidden title word, an oversized
// tag, or too many tags past the shop conventions.
app.patch('/api/jobs/:id/listings/:listingId', (req, res) => {
  const jobId = Number(req.params.id);
  const listingId = Number(req.params.listingId);
  const { title, description, tags, tag_alternates } = req.body || {};

  const db = getDb();

  // Read-merge-write wrapped in a transaction for atomicity. Note: this handler is
  // fully synchronous (no await between the read and the write), so on today's
  // single-process/single-threaded server there's no actual interleaving window --
  // this is future-proofing against the atomicity guarantee silently breaking if
  // async work (e.g. an await) is ever added to the merge/validation step, not a fix
  // for an active race condition.
  const result = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM listings WHERE id = ? AND job_id = ?').get(listingId, jobId);
    if (!existing) return null;

    const merged = {
      angle: existing.variation,
      title: title !== undefined ? title : existing.title,
      description: description !== undefined ? description : existing.description,
      tags: tags !== undefined ? tags : JSON.parse(existing.tags || '[]'),
      tag_alternates: tag_alternates !== undefined ? tag_alternates : JSON.parse(existing.tag_alternates || '[]'),
    };
    const cleaned = enforceConventions(merged);

    db.prepare(
      `UPDATE listings SET title = ?, description = ?, tags = ?, tag_alternates = ?, edited_at = datetime('now') WHERE id = ?`
    ).run(cleaned.title, cleaned.description, JSON.stringify(cleaned.tags), JSON.stringify(cleaned.tagAlternates), listingId);

    return { updated: db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId), cleaned };
  })();

  if (!result) return res.status(404).json({ error: 'Listing not found for this job' });

  const { updated, cleaned } = result;
  res.json({
    ...updated,
    tags: JSON.parse(updated.tags || '[]'),
    tag_alternates: JSON.parse(updated.tag_alternates || '[]'),
    warnings: cleaned.warnings,
  });
});

// Runs Module 3 (Mockup Composer) for a job against one product size. Optional/
// non-required module: on failure the job's module status is 'failed' but the job's
// overall_status is NOT forced to 'failed' (required: false) — a listing without
// mockups is still usable, so the failure is flagged, not fatal. See ARCHITECTURE.md ->
// Partial Failure Handling. Re-running for the same size_key overwrites that size's
// mockup rather than duplicating (UNIQUE(job_id, product_size_id) on the mockups table).
app.post('/api/jobs/:id/run/mockup-composer', async (req, res) => {
  const jobId = Number(req.params.id);
  const { size_key } = req.body || {};
  if (!size_key) return res.status(400).json({ error: 'size_key is required' });

  setModuleStatus(jobId, 'mockup_composer', 'running', { required: false });
  try {
    const { outputPath, warnings } = await generateMockupForJob(jobId, size_key);
    setModuleStatus(jobId, 'mockup_composer', 'success', { required: false });
    res.json({ job: getJobWithModules(jobId), outputPath, warnings });
  } catch (err) {
    setModuleStatus(jobId, 'mockup_composer', 'failed', { required: false, errorMessage: err.message });
    res.status(422).json({ error: err.message, job: getJobWithModules(jobId) });
  }
});

app.get('/api/jobs/:id/mockups', (req, res) => {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT mockups.*, product_sizes.size_key, product_sizes.dimensions, product_sizes.orientation
       FROM mockups
       JOIN product_sizes ON product_sizes.id = mockups.product_size_id
       WHERE mockups.job_id = ?
       ORDER BY mockups.id`
    )
    .all(Number(req.params.id));
  res.json(rows.map(withMockupUrls));
});

// Module 3 -> "AI-outpainting fallback" step 6: lets the user pick between the smart-crop
// and AI-extended mockup variants (step 7's dashboard review UI is the eventual caller;
// this route stands on its own regardless). Syncs `file_path` to whichever variant's
// stored path was chosen -- `smart_crop_path` and `ai_extended_path` are both preserved
// independently, so switching back and forth always has both files available, not just
// whichever one `file_path` last pointed at.
app.patch('/api/jobs/:id/mockups/:mockupId/variant', (req, res) => {
  const jobId = Number(req.params.id);
  const mockupId = Number(req.params.mockupId);
  const { variant } = req.body || {};

  if (variant !== 'smart_crop' && variant !== 'ai_extended') {
    return res.status(400).json({ error: "variant must be 'smart_crop' or 'ai_extended'" });
  }

  const db = getDb();
  const mockup = db
    .prepare('SELECT * FROM mockups WHERE id = ? AND job_id = ?')
    .get(mockupId, jobId);
  if (!mockup) return res.status(404).json({ error: 'Mockup not found for this job' });

  if (variant === 'ai_extended' && !mockup.ai_extended_path) {
    return res.status(422).json({ error: 'No AI-extended variant exists for this mockup' });
  }

  const targetPath = variant === 'ai_extended' ? mockup.ai_extended_path : mockup.smart_crop_path;

  db.prepare(
    `UPDATE mockups SET file_path = ?, selected_variant = ?, needs_review = 0 WHERE id = ?`
  ).run(targetPath, variant, mockupId);

  res.json(withMockupUrls(db.prepare('SELECT * FROM mockups WHERE id = ?').get(mockupId)));
});

// Dashboard Mockup Template Manager routes (plan.md -> "Backend changes" -> "5. New
// routes", Rollout step 2). Manage which files in the user's own templates folder are
// configured as product-size templates -- scan a folder, list/create/delete configured
// entries. Not nested under /api/jobs/:id: like Module 4 below, this isn't job-scoped.

// If `folder` is omitted, falls back to the saved mockup_templates_dir setting -- same
// "settings-first" convention as the taste-filter watcher's folder field. 400 (not 500)
// for a missing/nonexistent folder, since this is a synchronous user-initiated scan, not
// a background watcher silently recording lastError.
app.get('/api/mockup-templates/scan', async (req, res) => {
  const folder = req.query.folder || getTemplatesDirSetting();
  if (!folder) {
    return res.status(400).json({ error: 'folder query param is required (or set mockup_templates_dir in settings first)' });
  }
  try {
    const files = await scanTemplatesFolder(folder);
    res.json({ folder, files });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/mockup-templates', async (req, res) => {
  const templates = await listConfiguredTemplates();
  res.json(templates);
});

// Distinct, non-null `category` values currently configured (plan.md -> "Mockup
// categories" -> "New route"). Registered ahead of no other :param route on this prefix
// conflicts with it -- /api/mockup-templates/scan is the only sibling literal segment,
// and DELETE's :sizeKey param is a different HTTP method entirely. Backs both the
// curated flow's category-selection checklist and MockupTemplates.jsx's category
// `<datalist>` suggestions, so neither hardcodes a fixed taxonomy.
app.get('/api/mockup-templates/categories', (req, res) => {
  res.json(listConfiguredCategories());
});

// Body matches upsertConfiguredTemplate's shape; used both for creating a new entry and
// editing an existing one (same upsert-by-size_key semantics the JSON file always had).
app.post('/api/mockup-templates', (req, res) => {
  try {
    const template = upsertConfiguredTemplate(req.body || {});
    res.status(201).json(template);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/mockup-templates/:sizeKey', (req, res) => {
  const deleted = deleteConfiguredTemplate(req.params.sizeKey);
  if (!deleted) return res.status(404).json({ error: 'No configured template found for that size key' });
  res.status(204).end();
});

// Module 4 (Trend/Prompt Helper) routes. Deliberately NOT nested under /api/jobs/:id —
// per ARCHITECTURE.md -> Module 4 and -> Partial Failure Handling, this module is fully
// isolated from the job pipeline (no job_modules row, no jobId), keyed only by an
// optional trend + a target category.

// Lists trends via the trends provider layer (config-selected — manual by default, or
// etsy_api — see ARCHITECTURE.md -> Trends Provider Layer), optionally filtered by
// category.
app.get('/api/trends', async (req, res) => {
  try {
    const trends = await getTrends(req.query.category || undefined);
    res.json(trends);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Single-entry manual trend creation (the dashboard's one-at-a-time path — CSV import is
// a separate route, POST /api/trends/csv below, using trends/manual.js's importFromCsvRows). Writes
// directly via trends/manual.js rather than through the provider-layer abstraction,
// since only the *manual* implementation has a concept of "add one" — swapping
// TRENDS_PROVIDER later wouldn't give this write path a different meaning.
app.post('/api/trends', (req, res) => {
  const { term, category } = req.body || {};
  if (!term) return res.status(400).json({ error: 'term is required' });
  const trend = addManualTrend(term, category || null);
  res.status(201).json(trend);
});

// Settings panel's "Delete trend" button (Tags & Trends) -- same missing-route issue as
// DELETE /api/tags/:id above. See docs/known-issues/functional-correctness-review-2026-08-11.md #2.
app.delete('/api/trends/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM trends WHERE id = ?').run(Number(req.params.id));
  if (result.changes === 0) return res.status(404).json({ error: 'Trend not found' });
  res.status(204).end();
});

// CSV import (ARCHITECTURE.md -> Trends Provider Layer -> "CSV import in manual.js").
// Body: { csv: "<raw CSV text>" }, expected to have come from the user re-exporting a
// research tool's own results (eRank/EverBee free tier, etc.) as CSV, not scraped --
// same ToS-clean framing as the rest of that section. Accepts a `term`/`keyword`/`trend`
// header for the term column and an optional `category`/`cat` column; rows missing a
// usable term column are silently skipped rather than rejecting the whole file over one
// bad row.
app.post('/api/trends/csv', (req, res) => {
  const { csv } = req.body || {};
  if (!csv) return res.status(400).json({ error: 'csv is required (raw CSV text)' });
  const rows = rowsFromCsvText(csv);
  if (!rows.length) {
    // Same rows.length === 0 result covers two different problems: a header-only/empty
    // export (parseCsv finds zero raw rows at all) vs. rows that exist but none have a
    // usable term/keyword/trend column (rowsFromCsvText's own filter drops them). Give
    // each its own message rather than blaming a missing column on a file that has one.
    const error = parseCsv(csv).length > 0
      ? 'No usable rows found (expected a term/keyword/trend column)'
      : 'CSV has no data rows to import (only a header row, or the file is empty)';
    return res.status(400).json({ error });
  }
  const inserted = importFromCsvRows(rows);
  res.status(201).json({ imported: inserted });
});

// Runs Module 4: generates a fresh batch of ready-to-paste Midjourney prompts for an
// (optional) trend + a target category, and persists them. Isolated per
// ARCHITECTURE.md's Partial Failure Handling — a failure here is just a 422, with no
// job/job_modules state to update, since this route touches no job at all.
app.post('/api/prompts/generate', async (req, res) => {
  const { trend_id, orientation } = req.body || {};
  try {
    const prompts = await generatePromptsForTrend({ trendId: trend_id || null, orientation });
    res.status(201).json({ prompts });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// Browsable history of previously generated prompt batches, optionally filtered by trend
// and/or category — see generatePromptsForTrend's doc comment on why each generation run
// inserts new rows rather than upserting.
app.get('/api/prompts', (req, res) => {
  const { trend_id, orientation } = req.query;
  const prompts = listPrompts({ trendId: trend_id ? Number(trend_id) : undefined, orientation: orientation || undefined });
  res.json(prompts);
});

// Module 7 (Taste Filter) routes. See ARCHITECTURE.md -> Module 7 -> "Build sequence"
// steps 4-5. Candidates are NOT persisted to image_preferences until the user actually
// labels them (keep/discard) -- per the doc, "nothing is auto-deleted [...] the user
// confirms keep/discard, and that confirmation is the training signal", so an imported-
// but-not-yet-labeled batch only lives on disk + in this response, never in
// image_preferences. No separate "pending candidates" table -- just a scoring pass over
// freshly-saved files, matching the doc's "nothing extra needs to be built" closed-loop
// design.

// Read-only snapshot of the CLIP model download (see embeddings.js's downloadState) --
// backs the dashboard's loading bar so a slow/in-progress boot-time download (see
// server.js's ensureModelReady() call at startup) shows real progress instead of the
// Taste Filter panel just looking broken/unresponsive until it's done.
app.get('/api/taste-filter/model-status', (req, res) => {
  res.json(getModelDownloadState());
});

// Live version of the route above, same SSE shape/rationale as
// /api/taste-filter/pending/stream below: sends the current snapshot immediately (so a
// client that connects mid-download doesn't have to wait for the next change to see
// where things stand), then one more event per subsequent state change for as long as
// the connection stays open.
app.get('/api/taste-filter/model-status/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // Tells nginx-style reverse proxies (Render's edge included) not to buffer this
    // response -- without it, a small final message like the 'ready' transition below
    // can sit in the proxy's buffer indefinitely instead of reaching the client right
    // away, since nothing else is written afterward to force a flush.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  // Disables Nagle's algorithm on the underlying TCP socket so small writes (every
  // message here is a few dozen bytes) go out immediately instead of being held back
  // waiting to coalesce with more data that, for a stream like this, may not arrive for
  // seconds -- the same reason chat/game-server SSE and WebSocket code sets this.
  res.socket?.setNoDelay?.(true);

  const send = (state) => {
    res.write(`data: ${JSON.stringify(state)}\n\n`);
  };
  send(getModelDownloadState());

  const unsubscribe = onModelDownloadProgress(send);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

// Batch import: saves each uploaded file to disk, embeds it via the local CLIP model, and
// scores it against the CURRENT global + (optional) category centroids. Body fields
// alongside the `files` multipart field: `category` (optional -- applies to the whole
// batch) and `prompt_id` (optional -- links every candidate in this batch to the Module 4
// prompt that generated them, for the prompt-feedback link). Returns each candidate's
// embedding back to the caller (plain array) so the label call doesn't need to re-run the
// model -- the frontend holds it only for as long as the batch is under review. A
// per-file embed/score failure (e.g. a corrupt image) doesn't fail the whole batch --
// that candidate comes back with an `error` field instead of scores.
app.post('/api/taste-filter/import', uploadCandidate.array('files', 100), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded (expected multipart field "files")' });

  const category = req.body?.category || null;
  const promptId = req.body?.prompt_id ? Number(req.body.prompt_id) : null;

  // plan.md Part 2, Step 2.6: read the auto-compute settings for this batch. Same
  // key/value `settings` table as everything else (Step 2.3) — falls back to
  // AUTO_SETTING_DEFAULTS so an unset row behaves as "off" / the default threshold,
  // never as a crash or an accidental auto-enable.
  const autoSettingRows = getDb()
    .prepare('SELECT key, value FROM settings WHERE key IN (?, ?)')
    .all(SETTING_AUTO_ENABLED, SETTING_AUTO_THRESHOLD);
  const autoSettings = { ...AUTO_SETTING_DEFAULTS, ...Object.fromEntries(autoSettingRows.map((r) => [r.key, r.value])) };
  const autoEnabled = autoSettings[SETTING_AUTO_ENABLED] === 'true';
  const autoThreshold = Number(autoSettings[SETTING_AUTO_THRESHOLD]);

  let globalCentroids = getCentroids(null);
  let categoryCentroids = category ? getCentroids(category) : null;

  const candidates = [];
  for (const file of files) {
    try {
      const embedding = await embedImage(file.path);
      const scores = scoreCandidate(embedding, { global: globalCentroids, category: categoryCentroids });

      // Step 2.4's decision rule, applied per-centroid-pair, only when auto mode is on
      // (`isConfident`/`COLD_START_MIN_EXAMPLES` inside autoDecision() are unchanged —
      // this never acts on a pair that hasn't cleared the existing cold-start bar).
      // When the candidate has a category, require the global and category rules to
      // agree before auto-deciding: the two pairs are scored independently and can
      // disagree (e.g. fine globally but off for this category's style bucket, the
      // exact case ARCHITECTURE.md's "Output" section calls out both scores for), and
      // silently picking one over the other for an unattended decision would risk
      // exactly the "silently mislabel" failure mode Part 2's "Why" section rules out.
      // A disagreement (or no category) falls back to `null` — manual review, the same
      // state every candidate is already in today.
      let decision = null;
      if (autoEnabled) {
        const globalDecision = autoDecision(scores.globalScore, globalCentroids, autoThreshold);
        if (category) {
          const categoryDecision = autoDecision(scores.categoryScore, categoryCentroids, autoThreshold);
          decision = globalDecision && globalDecision === categoryDecision ? globalDecision : null;
        } else {
          decision = globalDecision;
        }
      }

      candidates.push({
        imagePath: file.path,
        imageUrl: `/taste-filter-files/${path.basename(file.path)}`,
        category,
        promptId,
        embedding: Array.from(embedding),
        ...scores,
        autoDecision: decision,
      });

      if (decision) {
        // Same effects as a manual label (POST /api/taste-filter/label above): persist
        // the training signal with `autoLabeled: true` (Step 2.2), tally its prompt's
        // terms, then recompute centroids. Never deletes the underlying file, in either
        // the auto-keep or auto-discard case — unchanged from today's manual-discard
        // behavior, per Part 2's "Why" constraint.
        //
        // Captured before addImagePreference()'s upsert overwrites this image's row --
        // same before/after-diff pattern the manual label route uses, so an auto-decision
        // landing on a path that was already labeled (e.g. a watched-folder re-import) still tallies
        // correctly instead of double-counting. An auto-decision is itself a real
        // training signal, same as a manual click — it was previously never tallied at
        // all (issue #59, part 1).
        const previousState = getImagePreferenceState(file.path);
        addImagePreference({
          imagePath: file.path,
          embedding,
          label: decision,
          category,
          promptId,
          autoLabeled: true,
        });
        tallyPromptTermsForLabel(promptId, decision, previousState);
        recomputeCentroids();
        // Refresh the centroids used for scoring so later candidates in this same
        // batch are scored (and auto-decided) against the just-updated centroids —
        // matching "same as a manual label", where every label recomputes before the
        // next one is scored.
        globalCentroids = getCentroids(null);
        categoryCentroids = category ? getCentroids(category) : null;
      }
    } catch (err) {
      candidates.push({
        imagePath: file.path,
        imageUrl: `/taste-filter-files/${path.basename(file.path)}`,
        category,
        promptId,
        error: err.message,
      });
    }
  }

  res.status(201).json({ candidates });
});

// Records a keep/discard decision for one candidate -- the actual training signal (see
// ARCHITECTURE.md -> Module 7 -> "How the 'training' works"). Body: { image_path,
// embedding: number[], label: 'keep' | 'discard', category?, prompt_id? }. The embedding
// is passed back in from the import response rather than re-derived, so labeling doesn't
// need the model loaded again. Centroids recompute synchronously right after, per
// "centroids recompute automatically after every labeled batch" -- a single label is the
// smallest possible batch.
app.post('/api/taste-filter/label', (req, res) => {
  const { image_path, embedding, label, category, prompt_id } = req.body || {};
  if (!image_path || !Array.isArray(embedding) || !embedding.length) {
    return res.status(400).json({ error: 'image_path and a non-empty embedding array are required' });
  }
  if (label !== 'keep' && label !== 'discard') {
    return res.status(400).json({ error: "label must be 'keep' or 'discard'" });
  }

  try {
    const resolvedPromptId = prompt_id ? Number(prompt_id) : null;
    // Captured before addImagePreference()'s upsert below overwrites this image's row --
    // the "before" half of tallyPromptTermsForLabel()'s before/after diff, so a relabel
    // (e.g. correcting an auto-sorted candidate) undoes its old term tally instead of
    // only ever adding to it.
    const previousState = getImagePreferenceState(image_path);
    const id = addImagePreference({
      imagePath: image_path,
      embedding: Float32Array.from(embedding),
      label,
      category: category || null,
      promptId: resolvedPromptId,
    });
    const counts = recomputeCentroids();
    // Module 7 -> Module 4 prompt-feedback link, write side (step 6): tallies this
    // label's prompt's terms into prompt_terms.kept_count/discarded_count. A no-op when
    // no prompt_id was given or it doesn't resolve to a real prompt -- optional/opt-in,
    // never blocks the label above from having already saved.
    tallyPromptTermsForLabel(resolvedPromptId, label, previousState);
    // Step 7's auto-import queue (see lib/taste-filter/watcher.js): if this label was for
    // a watched-folder candidate, drop it from the pending queue so a subsequent
    // GET /api/taste-filter/pending poll doesn't re-surface an already-labeled image. A
    // no-op for a manually drag-and-dropped candidate, which was never in this queue.
    removePendingCandidate(image_path);
    res.status(201).json({
      id,
      counts: Object.fromEntries(Array.from(counts.entries()).map(([k, v]) => [k === null ? 'global' : k, v])),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Promotes a taste-filter candidate into the pipeline as a real artwork -- closes the
// gap described at the top of insertArtworkRecord: a kept candidate otherwise never
// becomes an `artworks` row on its own. Body: { image_path, original_filename? }.
// `image_path` must resolve inside CANDIDATES_DIR (never UPLOADS_DIR or an arbitrary
// path -- this only promotes files that actually came through the taste-filter import
// flow). The file is copied, not moved, into UPLOADS_DIR using the same naming scheme
// as uploadStorage.filename above, so the original candidate file (and its taste-filter
// history/label) is untouched. Does not itself label or delete the candidate -- pairing
// this with a 'keep' label is the caller's responsibility (see TasteFilter.jsx's "Keep &
// send to pipeline" action).
app.post('/api/taste-filter/promote', (req, res) => {
  const { image_path, original_filename } = req.body || {};
  if (!image_path) return res.status(400).json({ error: 'image_path is required' });

  const resolvedCandidatePath = path.resolve(image_path);
  const resolvedCandidatesDir = path.resolve(CANDIDATES_DIR);
  const isInsideCandidatesDir =
    resolvedCandidatePath === resolvedCandidatesDir ||
    resolvedCandidatePath.startsWith(resolvedCandidatesDir + path.sep);
  if (!isInsideCandidatesDir) {
    return res.status(400).json({ error: 'image_path must be inside the taste-filter candidates directory' });
  }
  if (!fs.existsSync(resolvedCandidatePath)) {
    return res.status(400).json({ error: 'No candidate file found at image_path' });
  }

  const safeName = path.basename(resolvedCandidatePath).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const destFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`;
  const destPath = path.join(UPLOADS_DIR, destFilename);
  fs.copyFileSync(resolvedCandidatePath, destPath);

  const artwork = insertArtworkRecord(destPath, original_filename || path.basename(resolvedCandidatePath));
  res.status(201).json({ artwork });
});

// Module 7 -> "Auto-import via watched folder" (step 7). The dashboard polls this to pick
// up whatever the watcher has detected + scored since the last poll -- same response
// shape as POST /api/taste-filter/import's own `{ candidates }`, so TasteFilter.jsx can
// merge results from both sources into one local list without a separate code path.
app.get('/api/taste-filter/pending', (req, res) => {
  res.json({ candidates: getPendingCandidates() });
});

// Live-push counterpart to GET /api/taste-filter/pending above, so the dashboard finds
// out about a watcher-detected candidate the instant it's scored instead of waiting for
// the next poll tick -- chokidar's own 'add' handler already reacts synchronously (see
// watcher.js), the poll interval was the only remaining delay. Standard SSE: one
// `data: <candidate JSON>` event per candidate, sent immediately for whatever's already
// queued (so a client that just connected doesn't miss anything the watcher found before
// it opened the connection), then one more event per candidate as chokidar detects new
// files for as long as the connection stays open. GET /api/taste-filter/pending is left
// completely unchanged -- this is an additional channel on top of it, not a replacement;
// a client that never opens this stream still works exactly as before.
app.get('/api/taste-filter/pending/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    // See the identical header on /api/taste-filter/model-status/stream above -- same
    // reverse-proxy buffering concern applies here.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.socket?.setNoDelay?.(true);

  const send = (candidate) => {
    res.write(`data: ${JSON.stringify(candidate)}\n\n`);
  };
  for (const candidate of getPendingCandidates()) send(candidate);

  const unsubscribe = onPendingCandidate(send);
  // Keeps the connection alive through proxies/load balancers that time out an
  // otherwise-idle HTTP connection. A comment line per the SSE spec -- EventSource's
  // onmessage never sees it, so it can't reach TasteFilter.jsx as a fake candidate.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);

  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

// Read-only status for the dashboard Settings panel -- whether the watcher is currently
// active, which folder/category it's watching, and how many candidates are sitting
// unlabeled in the pending queue. Nothing here is user-editable directly; the watcher
// itself is driven entirely by the taste_filter_watch_* keys in PATCH /api/settings.
app.get('/api/taste-filter/watch-status', (req, res) => {
  res.json(getWatcherStatus());
});

// Current centroid coverage (counts only, not the raw vectors) -- backs the dashboard's
// cold-start messaging without exposing embedding data over the API.
app.get('/api/taste-filter/centroids', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT category, kept_count, discarded_count, updated_at FROM taste_centroids').all();
  res.json(rows.map((r) => ({ ...r, category: r.category === null ? 'global' : r.category })));
});

// Manual "Recompute now" button (ARCHITECTURE.md -> Module 7: "a 'Recompute now' button
// in the dashboard triggers an immediate recompute [...] without waiting for the next
// batch").
app.post('/api/taste-filter/recompute', (req, res) => {
  const counts = recomputeCentroids();
  // Also rebuilds prompt_terms from scratch off the current image_preferences table
  // (issue #59, part 2) -- unlike the incremental tally, this can't drift regardless of
  // relabeling history, so running it here self-heals any prompt_terms rows left
  // inflated by relabeling that happened before the double-counting fix shipped. Cheap
  // to run unconditionally alongside the existing centroid recompute,
  // same "manual trigger, no partial-state risk" contract this route already has.
  recomputePromptTerms();
  res.json({
    counts: Object.fromEntries(Array.from(counts.entries()).map(([k, v]) => [k === null ? 'global' : k, v])),
  });
});

// Guarded so importing this module (e.g. supertest-based integration tests, which wrap
// the `app` export directly and don't need a real listening socket) doesn't also bind a
// real port. Only binds when server.js is actually run as the entry point.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  // Fire-and-forget, started alongside (not before) app.listen() -- see this edit's
  // commit message. Logged rather than thrown: Taste Filter is one module among many,
  // and a download/disk failure here shouldn't take down job/listing/mockup routes that
  // have nothing to do with it. embedImage() still calls ensureModelReady() itself on
  // each use, so a failure here just means the first real import request re-attempts
  // the same download instead of finding it already done.
  ensureModelReady()
    .then(() => console.log('[taste-filter] CLIP model ready at boot.'))
    .catch((err) => console.error(`[taste-filter] Model prefetch at boot failed (will retry on first use): ${err.message}`));

  app.listen(PORT, () => {
    console.log(`ProEtsy backend listening on http://localhost:${PORT}`);
  });
}

export default app;
