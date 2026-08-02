import { getDb } from '../db/init.js';
import { getPipelineConfig } from '../config/index.js';

// Creates a job for an artwork and seeds a job_modules row per module in the current
// pipeline config — 'pending' if enabled for this run, 'skipped' if disabled. See
// ARCHITECTURE.md -> Step control model.
//
// `overrides` (optional): { [module_name]: boolean }. Per ARCHITECTURE.md's Step control
// model, this is the "UI override" layer — it applies only to this one job, never
// rewrites pipeline.config.json. A required module (e.g. listing_generator) ignores an
// attempt to disable it, so a bad request can't produce a job that can never succeed.
export function createJob(artworkId, overrides = {}) {
  const db = getDb();
  const artwork = db.prepare('SELECT id FROM artworks WHERE id = ?').get(artworkId);
  if (!artwork) throw new Error(`Artwork ${artworkId} not found`);

  const insertJob = db.prepare("INSERT INTO jobs (artwork_id, overall_status) VALUES (?, 'pending')");
  const insertModule = db.prepare('INSERT INTO job_modules (job_id, module_name, status) VALUES (?, ?, ?)');

  const run = db.transaction(() => {
    const { lastInsertRowid: jobId } = insertJob.run(artworkId);
    const { pipeline } = getPipelineConfig();
    for (const { module, enabled, required } of pipeline) {
      const override = overrides[module];
      const effectiveEnabled = required ? true : override !== undefined ? Boolean(override) : enabled;
      insertModule.run(jobId, module, effectiveEnabled ? 'pending' : 'skipped');
    }
    return jobId;
  });

  return run();
}

export function getJobWithModules(jobId) {
  const db = getDb();
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;
  const modules = db.prepare('SELECT * FROM job_modules WHERE job_id = ? ORDER BY id').all(jobId);
  return { ...job, modules };
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
}
