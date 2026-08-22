import { getDb, withTransaction } from '../db/init.js';
import { getPipelineConfig } from '../config/index.js';

// Creates a job for an artwork and seeds a job_modules row per module in the current
// pipeline config — 'pending' if enabled for this run, 'skipped' if disabled. See
// ARCHITECTURE.md -> Step control model.
//
// `overrides` (optional): { [module_name]: boolean }. Per ARCHITECTURE.md's Step control
// model, this is the "UI override" layer — it applies only to this one job, never
// rewrites pipeline.config.json. A required module (e.g. listing_generator) ignores an
// attempt to disable it, so a bad request can't produce a job that can never succeed.
// `batchId` (optional): a caller-supplied string (Module 6's dashboard generates one
// client-side per bulk drop) shared across every job created from the same batch, so the
// dashboard history view can group them into one row instead of N indistinguishable
// single-job rows. Null for a single-artwork upload — no grouping to do.
export function createJob(artworkId, overrides = {}, batchId = null) {
  const db = getDb();
  const artwork = db.prepare('SELECT id FROM artworks WHERE id = ?').get(artworkId);
  if (!artwork) throw new Error(`Artwork ${artworkId} not found`);

  const insertJob = db.prepare("INSERT INTO jobs (artwork_id, overall_status, batch_id) VALUES (?, 'pending', ?)");
  const insertModule = db.prepare('INSERT INTO job_modules (job_id, module_name, status) VALUES (?, ?, ?)');

  return withTransaction(db, () => {
    const { lastInsertRowid: jobId } = insertJob.run(artworkId, batchId || null);
    const { pipeline } = getPipelineConfig();
    for (const { module, enabled, required } of pipeline) {
      const override = overrides[module];
      const effectiveEnabled = required ? true : override !== undefined ? Boolean(override) : enabled;
      insertModule.run(jobId, module, effectiveEnabled ? 'pending' : 'skipped');
    }
    return jobId;
  });
}

// plan.md step 6: bulk-upload previously fired one POST /api/jobs per artwork,
// sequentially awaited from the dashboard (N round-trips for N files). This creates
// every job for a batch in a single call and a single DB transaction, so the dashboard
// can make one request instead of N. Same per-module seeding rules as createJob
// (required modules always pending, overrides apply per-run only) -- kept atomic across
// the whole array: if any artwork_id doesn't exist, nothing in the batch is created
// (mirrors createJob's own all-or-nothing behavior for one job).
// Returns the array of new job ids, in the same order as `artworkIds`.
export function createJobsBulk(artworkIds, overrides = {}, batchId = null) {
  if (!Array.isArray(artworkIds) || !artworkIds.length) {
    throw new Error('artworkIds must be a non-empty array');
  }

  const db = getDb();
  const getArtwork = db.prepare('SELECT id FROM artworks WHERE id = ?');
  const insertJob = db.prepare("INSERT INTO jobs (artwork_id, overall_status, batch_id) VALUES (?, 'pending', ?)");
  const insertModule = db.prepare('INSERT INTO job_modules (job_id, module_name, status) VALUES (?, ?, ?)');
  const { pipeline } = getPipelineConfig();

  return withTransaction(db, () => {
    const jobIds = [];
    for (const artworkId of artworkIds) {
      const artwork = getArtwork.get(artworkId);
      if (!artwork) throw new Error(`Artwork ${artworkId} not found`);

      const { lastInsertRowid: jobId } = insertJob.run(artworkId, batchId || null);
      for (const { module, enabled, required } of pipeline) {
        const override = overrides[module];
        const effectiveEnabled = required ? true : override !== undefined ? Boolean(override) : enabled;
        insertModule.run(jobId, module, effectiveEnabled ? 'pending' : 'skipped');
      }
      jobIds.push(jobId);
    }
    return jobIds;
  });
}

export function getJobWithModules(jobId) {
  const db = getDb();
  // Joins artworks for artwork_file_path -- same alias GET /api/jobs' list query uses
  // (see server.js) -- so a job fetched by id carries the same field the dashboard's
  // Job Workspace preview (App.jsx's activeJobInfo) and Listing History table already
  // rely on from the list endpoint. Previously a bare `SELECT * FROM jobs` here, which
  // silently broke the Job Workspace artwork preview/filename for a job loaded by id
  // (jobData.artwork_file_path was always undefined).
  const job = db
    .prepare(
      `SELECT jobs.*, artworks.file_path AS artwork_file_path
       FROM jobs
       JOIN artworks ON artworks.id = jobs.artwork_id
       WHERE jobs.id = ?`
    )
    .get(jobId);
  if (!job) return null;
  const modules = db.prepare('SELECT * FROM job_modules WHERE job_id = ? ORDER BY id').all(jobId);
  return { ...job, modules };
}

// Re-derives a job's overall_status from its modules once one of them reaches a
// terminal state, per the Suggested fix in
// docs/known-issues/functional-correctness-review-2026-08-11.md #1: previously nothing
// ever set overall_status to a success value, so a fully-finished job stayed 'running'
// forever. Called from setModuleStatus() after every status write so every caller
// (the /run/* routes, pipeline-runner.js) gets this for free.
//
// 'skipped' modules don't count towards "pending-eligible" -- a job where every
// non-skipped module is done (all 'success', or 'failed' with no required module
// among the failures... though a required failure already short-circuits to 'failed'
// above) is complete. If any non-skipped module is still 'pending'/'running', the job
// isn't done yet and overall_status is left alone (already 'running' from createJob or
// an earlier call).
function finalizeJobStatus(db, jobId) {
  const current = db.prepare('SELECT overall_status FROM jobs WHERE id = ?').get(jobId);
  if (!current || current.overall_status === 'failed') return; // already terminal / a required module failed

  const modules = db
    .prepare("SELECT module_name, status FROM job_modules WHERE job_id = ? AND status != 'skipped'")
    .all(jobId);

  const allTerminal = modules.length > 0 && modules.every((m) => m.status === 'success' || m.status === 'failed');
  if (!allTerminal) return;

  // Only a REQUIRED module's failure should fail the whole job -- an optional module
  // (e.g. image_analyzer, mockup_composer) reaching 'failed' is still a usable result,
  // same as setModuleStatus()'s own `status === 'failed' && required` check above.
  // Previously this counted a failure from *any* non-skipped module, required or not,
  // which could flip a job to 'failed' purely because an optional module struggled even
  // though every required module succeeded.
  const { pipeline } = getPipelineConfig();
  const requiredModuleNames = new Set(pipeline.filter((m) => m.required).map((m) => m.module));
  const anyRequiredFailed = modules.some((m) => m.status === 'failed' && requiredModuleNames.has(m.module_name));
  db.prepare("UPDATE jobs SET overall_status = ? WHERE id = ?").run(anyRequiredFailed ? 'failed' : 'success', jobId);
}

// Sets/replaces the manual-notes fallback input used by Module 2 when Module 1 is
// skipped or fails (see ARCHITECTURE.md -> Module 2 input, and the `jobs.manual_notes`
// column).
export function setManualNotes(jobId, notes) {
  const db = getDb();
  db.prepare("UPDATE jobs SET manual_notes = ?, updated_at = datetime('now') WHERE id = ?").run(notes, jobId);
}

// Updates a module's status for a job (upserting the job_modules row — UNIQUE(job_id,
// module_name) means a retry updates in place rather than duplicating, per the
// idempotency rule in ARCHITECTURE.md -> Partial Failure Handling).
// `required: true` mirrors the Module 2 rule: a required module's failure marks the
// whole job `failed`; a non-required module's failure does not.
export function setModuleStatus(jobId, moduleName, status, { errorMessage = null, required = false } = {}) {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM job_modules WHERE job_id = ? AND module_name = ?')
    .get(jobId, moduleName);

  const isRetry = status === 'running' && existing?.status === 'failed';
  const startedAt = existing?.started_at || (status === 'running' ? now : null);
  const completedAt = ['success', 'failed'].includes(status) ? now : existing?.completed_at || null;
  const retryCount = (existing?.retry_count || 0) + (isRetry ? 1 : 0);

  if (existing) {
    db.prepare(
      `UPDATE job_modules SET status = ?, error_message = ?, retry_count = ?, started_at = ?, completed_at = ?
       WHERE job_id = ? AND module_name = ?`
    ).run(status, errorMessage, retryCount, startedAt, completedAt, jobId, moduleName);
  } else {
    db.prepare(
      `INSERT INTO job_modules (job_id, module_name, status, error_message, retry_count, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(jobId, moduleName, status, errorMessage, retryCount, startedAt, completedAt);
  }

  db.prepare("UPDATE jobs SET updated_at = datetime('now') WHERE id = ?").run(jobId);

  if (status === 'failed' && required) {
    db.prepare("UPDATE jobs SET overall_status = 'failed' WHERE id = ?").run(jobId);
  } else if (status === 'success') {
    db.prepare(
      "UPDATE jobs SET overall_status = CASE WHEN overall_status = 'failed' THEN overall_status ELSE 'running' END WHERE id = ?"
    ).run(jobId);
  }

  // A non-required module failure doesn't hit the branch above, but it can still be the
  // last module the job was waiting on -- so this needs to run regardless of which
  // branch (if any) fired.
  finalizeJobStatus(db, jobId);
}
