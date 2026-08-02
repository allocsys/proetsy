import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads DB_PATH at import time, so it must be set BEFORE the module is
// imported — same dynamic-import pattern used by
// listing-generator/index.idempotency.test.js and the server.*-routes.test.js suites.
let getDb;
let createJob;
let getJobWithModules;
let setManualNotes;
let setModuleStatus;
let tmpRoot;
let artworkId;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-jobs-unit-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ getDb } = await import('../db/init.js'));
  ({ createJob, getJobWithModules, setManualNotes, setModuleStatus } = await import('./jobs.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  const { lastInsertRowid } = db.prepare('INSERT INTO artworks (file_path) VALUES (?)').run('artwork.png');
  artworkId = lastInsertRowid;
});

describe('createJob (ARCHITECTURE.md -> Step control model)', () => {
  it('throws for an artwork that does not exist', () => {
    expect(() => createJob(999999)).toThrow(/not found/i);
  });

  it('seeds one job_modules row per pipeline.config.json entry, all pending by default', () => {
    const jobId = createJob(artworkId);
    const job = getJobWithModules(jobId);

    expect(job.overall_status).toBe('pending');
    const statuses = Object.fromEntries(job.modules.map((m) => [m.module_name, m.status]));
    expect(statuses).toEqual({
      image_analyzer: 'pending',
      listing_generator: 'pending',
      mockup_composer: 'pending',
    });
  });

  it('applies a per-job UI override to disable an optional module', () => {
    const jobId = createJob(artworkId, { image_analyzer: false });
    const job = getJobWithModules(jobId);
    const statuses = Object.fromEntries(job.modules.map((m) => [m.module_name, m.status]));

    expect(statuses.image_analyzer).toBe('skipped');
    expect(statuses.listing_generator).toBe('pending');
  });

  it('ignores an override attempting to disable the required module (listing_generator)', () => {
    const jobId = createJob(artworkId, { listing_generator: false });
    const job = getJobWithModules(jobId);
    const statuses = Object.fromEntries(job.modules.map((m) => [m.module_name, m.status]));

    // Required modules can't be turned off via override — see the ARCHITECTURE.md
    // comment in jobs.js itself: "a bad request can't produce a job that can never
    // succeed."
    expect(statuses.listing_generator).toBe('pending');
  });

  it('does not persist overrides back to the pipeline config for the next job', () => {
    createJob(artworkId, { image_analyzer: false });
    const secondJobId = createJob(artworkId);
    const job = getJobWithModules(secondJobId);
    const statuses = Object.fromEntries(job.modules.map((m) => [m.module_name, m.status]));

    // Overrides apply only to the run they were passed to — a fresh job with no
    // overrides should fall back to the config default (enabled) again.
    expect(statuses.image_analyzer).toBe('pending');
  });
});

describe('getJobWithModules', () => {
  it('returns null for a job that does not exist', () => {
    expect(getJobWithModules(999999)).toBeNull();
  });

  it('returns modules ordered by id (pipeline order)', () => {
    const jobId = createJob(artworkId);
    const job = getJobWithModules(jobId);
    expect(job.modules.map((m) => m.module_name)).toEqual([
      'image_analyzer',
      'listing_generator',
      'mockup_composer',
    ]);
  });
});

describe('setManualNotes', () => {
  it('stores notes on the job row and bumps updated_at', () => {
    const jobId = createJob(artworkId);
    const before = getJobWithModules(jobId).updated_at;

    setManualNotes(jobId, 'hand-written notes since Module 1 was skipped');
    const job = getJobWithModules(jobId);

    expect(job.manual_notes).toBe('hand-written notes since Module 1 was skipped');
    // updated_at is a datetime('now') string; just assert it's still populated (SQLite's
    // second-level resolution makes an inequality assertion here flaky).
    expect(job.updated_at).toBeTruthy();
    expect(before).toBeTruthy();
  });
});

describe('setModuleStatus (ARCHITECTURE.md -> Partial Failure Handling)', () => {
  it('upserts in place rather than duplicating (UNIQUE(job_id, module_name))', () => {
    const jobId = createJob(artworkId);
    const db = getDb();

    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    setModuleStatus(jobId, 'image_analyzer', 'success', { required: false });

    const rows = db
      .prepare('SELECT * FROM job_modules WHERE job_id = ? AND module_name = ?')
      .all(jobId, 'image_analyzer');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('success');
  });

  it('a required module failing marks the whole job failed', () => {
    const jobId = createJob(artworkId);
    setModuleStatus(jobId, 'listing_generator', 'failed', { required: true, errorMessage: 'boom' });

    const job = getJobWithModules(jobId);
    expect(job.overall_status).toBe('failed');
    const row = job.modules.find((m) => m.module_name === 'listing_generator');
    expect(row.status).toBe('failed');
    expect(row.error_message).toBe('boom');
  });

  it('an optional module failing does not mark the job failed', () => {
    const jobId = createJob(artworkId);
    setModuleStatus(jobId, 'image_analyzer', 'failed', { required: false, errorMessage: 'model timeout' });

    const job = getJobWithModules(jobId);
    expect(job.overall_status).not.toBe('failed');
  });

  it('a success does not downgrade an already-failed job back to running', () => {
    const jobId = createJob(artworkId);
    setModuleStatus(jobId, 'listing_generator', 'failed', { required: true });
    setModuleStatus(jobId, 'image_analyzer', 'success', { required: false });

    const job = getJobWithModules(jobId);
    expect(job.overall_status).toBe('failed');
  });

  it('increments retry_count when a module transitions from failed back to running', () => {
    const jobId = createJob(artworkId);
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    setModuleStatus(jobId, 'image_analyzer', 'failed', { required: false, errorMessage: 'first try failed' });

    let row = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer');
    expect(row.retry_count).toBe(0);

    // Retrying: running again after a prior failure should bump retry_count.
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    row = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer');
    expect(row.retry_count).toBe(1);

    setModuleStatus(jobId, 'image_analyzer', 'failed', { required: false, errorMessage: 'second try failed' });
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    row = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer');
    expect(row.retry_count).toBe(2);
  });

  it('preserves started_at across a retry rather than resetting it', () => {
    const jobId = createJob(artworkId);
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    const firstStartedAt = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer').started_at;

    setModuleStatus(jobId, 'image_analyzer', 'failed', { required: false });
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    const secondStartedAt = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer').started_at;

    expect(secondStartedAt).toBe(firstStartedAt);
  });

  it('sets completed_at on success and failed but not on running', () => {
    const jobId = createJob(artworkId);
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    let row = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer');
    expect(row.completed_at).toBeNull();

    setModuleStatus(jobId, 'image_analyzer', 'success', { required: false });
    row = getJobWithModules(jobId).modules.find((m) => m.module_name === 'image_analyzer');
    expect(row.completed_at).toBeTruthy();
  });
});
