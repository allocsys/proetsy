// Server-side pipeline runner. See ARCHITECTURE.md -> Module 6 status note:
// "orchestration currently lives client-side in App.jsx, not as a server-side job
// queue; closing the browser tab mid-run would leave later modules un-triggered." This
// module is that hardening step — it runs a job's modules end-to-end from a single
// server-side call, in the same order and with the same optional/required semantics the
// individual /run/* routes already use, so closing the tab after kicking off the request
// no longer matters (the work isn't tied to the response ever reaching the browser).
//
// This does NOT turn the app into a background job queue with its own worker process —
// it's still triggered by an HTTP request (per ARCHITECTURE.md's local-first,
// single-process design, adding a separate queue/worker would be a bigger architectural
// change than this pass's scope). What it fixes specifically is the *closing the tab*
// failure mode: once the request lands, Node keeps executing the async chain regardless
// of whether the client is still connected to read the eventual response.

import { getJobWithModules, setModuleStatus } from './jobs.js';
import { analyzeArtworkForJob } from './image-analyzer/index.js';
import { generateListingsForJob } from './listing-generator/index.js';
import { generateMockupForJob } from './mockup-generator.js';
import { getProductSizes } from '../config/index.js';

function moduleStatus(job, moduleName) {
  return job.modules.find((m) => m.module_name === moduleName)?.status;
}

/**
 * Runs every module that's currently 'pending' (or 'failed', i.e. retryable) for a job,
 * in the fixed pipeline order (Module 1 -> Module 2 -> Module 3), and returns the final
 * job state plus a per-module result summary. Modules already 'success' or 'skipped' are
 * left alone — this is meant to pick up wherever a job currently stands, the same way
 * hitting each module's retry button one at a time would, just server-side and in one
 * call.
 *
 * Module 3 (mockup_composer) has no size_key of its own on the job_modules row — a job's
 * single 'mockup_composer' status covers however many product sizes exist. This runner
 * attempts every configured size and only reports the module 'success' if at least one
 * size composited without throwing (matches the spirit of Module 3 being optional/
 * non-required: a job with mockups for some sizes but not others is still a usable
 * result, not a hard failure).
 *
 * `options.sizeKeys`, if provided, restricts the mockup-composer loop to just that list
 * instead of every configured size (plan.md -> "Mockup categories" -> backend changes) —
 * this is how the curated flow's category-selection step (once wired up) limits mockup
 * generation to only the categories the user picked for a given artwork. Omitted (the
 * default), behavior is exactly what it was before this option existed: every configured
 * `size_key` is attempted, so the existing direct-upload / "run everything" callers
 * (`POST /api/jobs/:id/run` with no body, `POST /api/jobs/run-batch`) need zero changes
 * to keep working as-is.
 *
 * @param {number} jobId
 * @param {{ sizeKeys?: string[] }} [options]
 * @returns {Promise<{job: object, results: Record<string, any>}>}
 */
export async function runPendingModulesForJob(jobId, options = {}) {
  const results = {};
  let job = getJobWithModules(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const imageAnalyzerStatus = moduleStatus(job, 'image_analyzer');
  if (imageAnalyzerStatus === 'pending' || imageAnalyzerStatus === 'failed') {
    setModuleStatus(jobId, 'image_analyzer', 'running', { required: false });
    try {
      const imageAnalysis = await analyzeArtworkForJob(jobId);
      setModuleStatus(jobId, 'image_analyzer', 'success', { required: false });
      results.image_analyzer = { status: 'success', imageAnalysis };
    } catch (err) {
      setModuleStatus(jobId, 'image_analyzer', 'failed', { required: false, errorMessage: err.message });
      results.image_analyzer = { status: 'failed', error: err.message };
    }
  }

  job = getJobWithModules(jobId);
  const listingGeneratorStatus = moduleStatus(job, 'listing_generator');
  if (listingGeneratorStatus === 'pending' || listingGeneratorStatus === 'failed') {
    setModuleStatus(jobId, 'listing_generator', 'running', { required: true });
    try {
      const listings = await generateListingsForJob(jobId, {});
      setModuleStatus(jobId, 'listing_generator', 'success', { required: true });
      results.listing_generator = { status: 'success', listings };
    } catch (err) {
      setModuleStatus(jobId, 'listing_generator', 'failed', { required: true, errorMessage: err.message });
      results.listing_generator = { status: 'failed', error: err.message };
      // Core/required module — per Partial Failure Handling, the job stops here.
      return { job: getJobWithModules(jobId), results };
    }
  }

  job = getJobWithModules(jobId);
  const mockupComposerStatus = moduleStatus(job, 'mockup_composer');
  if (mockupComposerStatus === 'pending' || mockupComposerStatus === 'failed') {
    setModuleStatus(jobId, 'mockup_composer', 'running', { required: false });
    // Only default to sizes that actually have a mockup template configured -- mirrors
    // listing-generator/index.js's `availableSizes` filter. Previously this defaulted to
    // every configured size regardless, so composeMockup() would predictably throw ("no
    // mockup_template configured") for any untemplated size on every single run. See
    // docs/known-issues/functional-correctness-review-2026-08-11.md #3.
    const sizeKeys =
      options.sizeKeys ??
      Object.entries(getProductSizes())
        .filter(([, size]) => Boolean(size.mockup_template))
        .map(([sizeKey]) => sizeKey);
    const perSize = {};
    let anySucceeded = false;
    for (const sizeKey of sizeKeys) {
      try {
        const { outputPath, warnings } = await generateMockupForJob(jobId, sizeKey);
        perSize[sizeKey] = { status: 'success', outputPath, warnings };
        anySucceeded = true;
      } catch (err) {
        perSize[sizeKey] = { status: 'failed', error: err.message };
      }
    }
    if (anySucceeded || sizeKeys.length === 0) {
      setModuleStatus(jobId, 'mockup_composer', 'success', { required: false });
    } else {
      setModuleStatus(jobId, 'mockup_composer', 'failed', {
        required: false,
        errorMessage: 'Mockup composition failed for every configured product size.',
      });
    }
    results.mockup_composer = { status: anySucceeded || sizeKeys.length === 0 ? 'success' : 'failed', perSize };
  }

  return { job: getJobWithModules(jobId), results };
}

/**
 * Bulk-mode helper: runs runPendingModulesForJob for several jobs. Each job's pipeline
 * runs independently — one job throwing (shouldn't normally happen, since
 * runPendingModulesForJob catches per-module errors itself, but this is a last-resort
 * guard) never stops the others, matching ARCHITECTURE.md -> Partial Failure Handling ->
 * "Bulk mode: ... One item failing ... does not halt or roll back the rest of the batch."
 * @param {number[]} jobIds
 * @returns {Promise<Array<{jobId: number, ok: boolean, job?: object, results?: object, error?: string}>>}
 */
export async function runPendingModulesForJobs(jobIds) {
  return Promise.all(
    jobIds.map(async (jobId) => {
      try {
        const { job, results } = await runPendingModulesForJob(jobId);
        return { jobId, ok: true, job, results };
      } catch (err) {
        return { jobId, ok: false, error: err.message };
      }
    })
  );
}
