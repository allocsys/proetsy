import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { getDb } from './db/init.js';
import { getPipelineConfig, getProductSizes } from './config/index.js';
import { SHOP_CONVENTIONS, MIDJOURNEY_CONVENTIONS } from './config/shop-conventions.js';
import { createJob, getJobWithModules, setManualNotes, setModuleStatus } from './lib/jobs.js';
import { analyzeArtworkForJob } from './lib/image-analyzer/index.js';
import { generateListingsForJob } from './lib/listing-generator/index.js';
import { enforceConventions } from './lib/listing-generator/validate.js';
import { generateMockupForJob, OUTPUT_DIR } from './lib/mockup-generator.js';
import { runPendingModulesForJob, runPendingModulesForJobs } from './lib/pipeline-runner.js';
import { initRateLimitCache } from './lib/llm/rate-limits.js';
import { getTrends } from './lib/trends/index.js';
import { addManualTrend, importFromCsvRows, rowsFromCsvText } from './lib/trends/manual.js';
import { importTagsFromCsvRows, tagRowsFromCsvText } from './lib/tags/user-list.js';
import { generatePromptsForTrend, listPrompts } from './lib/prompt-helper/index.js';
import { embedImage } from './lib/taste-filter/embeddings.js';
import { scoreCandidate } from './lib/taste-filter/scoring.js';
import { getCentroids, addImagePreference, recomputeCentroids, tallyPromptTermsForLabel } from './lib/taste-filter/store.js';

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

// Rehydrates the LLM provider layer's in-process cooldown Map from the durable
// llm_rate_limits table, so a restart doesn't reset an already-exhausted key/model pair
// back to "looks fine, try it". See ARCHITECTURE.md -> LLM Provider Layer -> "Rate-limit
// cooldown tracking".
initRateLimitCache();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ARCHITECTURE.md -> First-Run Setup -> "Detection: on backend startup, check for (1) at
// least one Gemini key in .env, (2) an initialized DB, (3) at least one entry in
// product-sizes.json." Also reports the tag-library check ("Required for Module 2") so
// the dashboard's persistent Settings-panel status list (not just a one-time modal) has
// everything it needs in one call.
app.get('/api/setup-status', (req, res) => {
  const db = getDb();
  const geminiKeyConfigured = (process.env.GEMINI_API_KEYS || '').split(',').map((k) => k.trim()).filter(Boolean).length > 0;
  const hasProductSize = db.prepare('SELECT COUNT(*) AS n FROM product_sizes').get().n > 0;
  const hasTagLibrary = db.prepare('SELECT COUNT(*) AS n FROM tags').get().n > 0;
  res.json({
    geminiKeyConfigured,
    dbInitialized: true,
    hasProductSize,
    hasTagLibrary,
    readyToRun: geminiKeyConfigured && hasTagLibrary,
  });
});

app.get('/api/config/pipeline', (req, res) => {
  res.json(getPipelineConfig());
});

app.get('/api/config/product-sizes', (req, res) => {
  res.json(getProductSizes());
});

// Module 6 -> Settings panel: previously "not yet done" -- "shop style conventions...
// not consolidated into the Settings panel". These are intentionally hardcoded (see
// ARCHITECTURE.md -> Module 2 -> "Must hardcode shop conventions"), so this is a
// read-only view for the dashboard, not an editable-then-PATCH resource.
app.get('/api/config/shop-conventions', (req, res) => {
  res.json({ listing: SHOP_CONVENTIONS, midjourney: MIDJOURNEY_CONVENTIONS });
});

// Module 6 -> "Lets the user drag-and-drop artwork" / "Supports bulk mode (multiple
// artworks through the pipeline at once)". Accepts one or many files under the `files`
// field (a single drop and a bulk drop are the same request shape) and creates one
// artwork row per file. Actual pipeline runs are still kicked off by POST /api/jobs —
// this route only handles getting the files onto disk and into the artworks table.
app.post('/api/artworks/upload', upload.array('files', 50), (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded (expected multipart field "files")' });

  const db = getDb();
  const insert = db.prepare('INSERT INTO artworks (file_path, original_filename) VALUES (?, ?)');
  const artworks = files.map((file) => {
    const { lastInsertRowid } = insert.run(file.path, file.originalname);
    return {
      ...db.prepare('SELECT * FROM artworks WHERE id = ?').get(lastInsertRowid),
      file_url: `/artwork-files/${path.basename(file.path)}`,
    };
  });
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
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
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
  const run = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      upsert.run(key, value === null || value === undefined ? null : String(value));
    }
  });
  run();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

// Module 6 -> First-Run Setup -> "Required for Module 2 (core): a starter tag list —
// paste a list or upload a CSV, not one-at-a-time entry." Also doubles as the ongoing
// Settings-panel tag-library editor. Module 2's tags provider layer (lib/tags/user-list.js)
// reads straight from this table.
app.get('/api/tags', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM tags ORDER BY tag_text').all());
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
  if (!rows.length) return res.status(400).json({ error: 'No usable rows found (expected a tag_text/tag/text/keyword column)' });
  const inserted = importTagsFromCsvRows(rows);
  const db = getDb();
  res.status(201).json({ inserted, tags: db.prepare('SELECT * FROM tags ORDER BY tag_text').all() });
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
app.post('/api/jobs', (req, res) => {
  const { artwork_id, pipeline_overrides } = req.body || {};
  if (!artwork_id) return res.status(400).json({ error: 'artwork_id is required' });
  try {
    const jobId = createJob(artwork_id, pipeline_overrides || {});
    res.status(201).json(getJobWithModules(jobId));
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
  try {
    const { job, results } = await runPendingModulesForJob(jobId);
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
  const existing = db.prepare('SELECT * FROM listings WHERE id = ? AND job_id = ?').get(listingId, jobId);
  if (!existing) return res.status(404).json({ error: 'Listing not found for this job' });

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

  const updated = db.prepare('SELECT * FROM listings WHERE id = ?').get(listingId);
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
// a separate, not-yet-wired route using trends/manual.js's importFromCsvRows). Writes
// directly via trends/manual.js rather than through the provider-layer abstraction,
// since only the *manual* implementation has a concept of "add one" — swapping
// TRENDS_PROVIDER later wouldn't give this write path a different meaning.
app.post('/api/trends', (req, res) => {
  const { term, category } = req.body || {};
  if (!term) return res.status(400).json({ error: 'term is required' });
  const trend = addManualTrend(term, category || null);
  res.status(201).json(trend);
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
  if (!rows.length) return res.status(400).json({ error: 'No usable rows found (expected a term/keyword/trend column)' });
  const inserted = importFromCsvRows(rows);
  res.status(201).json({ imported: inserted });
});

// Runs Module 4: generates a fresh batch of ready-to-paste Midjourney prompts for an
// (optional) trend + a target category, and persists them. Isolated per
// ARCHITECTURE.md's Partial Failure Handling — a failure here is just a 422, with no
// job/job_modules state to update, since this route touches no job at all.
app.post('/api/prompts/generate', async (req, res) => {
  const { trend_id, category } = req.body || {};
  try {
    const prompts = await generatePromptsForTrend({ trendId: trend_id || null, category });
    res.status(201).json({ prompts });
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

// Browsable history of previously generated prompt batches, optionally filtered by trend
// and/or category — see generatePromptsForTrend's doc comment on why each generation run
// inserts new rows rather than upserting.
app.get('/api/prompts', (req, res) => {
  const { trend_id, category } = req.query;
  const prompts = listPrompts({ trendId: trend_id ? Number(trend_id) : undefined, category: category || undefined });
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

  const globalCentroids = getCentroids(null);
  const categoryCentroids = category ? getCentroids(category) : null;

  const candidates = [];
  for (const file of files) {
    try {
      const embedding = await embedImage(file.path);
      const scores = scoreCandidate(embedding, { global: globalCentroids, category: categoryCentroids });
      candidates.push({
        imagePath: file.path,
        imageUrl: `/taste-filter-files/${path.basename(file.path)}`,
        category,
        promptId,
        embedding: Array.from(embedding),
        ...scores,
      });
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
    tallyPromptTermsForLabel(resolvedPromptId, label);
    res.status(201).json({
      id,
      counts: Object.fromEntries(Array.from(counts.entries()).map(([k, v]) => [k === null ? 'global' : k, v])),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
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
  res.json({
    counts: Object.fromEntries(Array.from(counts.entries()).map(([k, v]) => [k === null ? 'global' : k, v])),
  });
});

// Guarded so importing this module (e.g. supertest-based integration tests, which wrap
// the `app` export directly and don't need a real listening socket) doesn't also bind a
// real port. Only binds when server.js is actually run as the entry point.
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  app.listen(PORT, () => {
    console.log(`ProEtsy backend listening on http://localhost:${PORT}`);
  });
}

export default app;
