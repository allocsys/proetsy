import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { getDb } from './db/init.js';
import { getPipelineConfig, getProductSizes } from './config/index.js';
import { createJob, getJobWithModules, setManualNotes, setModuleStatus } from './lib/jobs.js';
import { analyzeArtworkForJob } from './lib/image-analyzer/index.js';
import { generateListingsForJob } from './lib/listing-generator/index.js';
import { enforceConventions } from './lib/listing-generator/validate.js';
import { generateMockupForJob, OUTPUT_DIR } from './lib/mockup-generator.js';
import { initRateLimitCache } from './lib/llm/rate-limits.js';
import { getTrends } from './lib/trends/index.js';
import { addManualTrend } from './lib/trends/manual.js';
import { generatePromptsForTrend, listPrompts } from './lib/prompt-helper/index.js';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

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

app.get('/api/config/pipeline', (req, res) => {
  res.json(getPipelineConfig());
});

app.get('/api/config/product-sizes', (req, res) => {
  res.json(getProductSizes());
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
app.post('/api/jobs', (req, res) => {
  const { artwork_id } = req.body || {};
  if (!artwork_id) return res.status(400).json({ error: 'artwork_id is required' });
  try {
    const jobId = createJob(artwork_id);
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
