import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { getDb } from './db/init.js';
import { getPipelineConfig, getProductSizes } from './config/index.js';
import { createJob, getJobWithModules, setManualNotes, setModuleStatus } from './lib/jobs.js';
import { generateListingsForJob } from './lib/listing-generator/index.js';
import { generateMockupForJob, OUTPUT_DIR } from './lib/mockup-generator.js';
import { initRateLimitCache } from './lib/llm/rate-limits.js';

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

app.listen(PORT, () => {
  console.log(`ProEtsy backend listening on http://localhost:${PORT}`);
});
