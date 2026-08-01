import { getDb } from '../../db/init.js';
import { generateVision } from '../llm/index.js';
import { buildImageAnalysisPrompt } from './prompt.js';

function parseModelJson(rawText) {
  // Models sometimes wrap JSON in markdown fences despite instructions not to — strip
  // those, but don't silently swallow genuinely malformed JSON beyond that (same
  // approach as listing-generator/index.js's parseModelJson).
  const cleaned = rawText.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON (${err.message}). Raw response: ${rawText.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini response JSON was not an object.');
  }
  if (typeof parsed.subject !== 'string' || !parsed.subject.trim()) {
    throw new Error('Gemini response JSON is missing a non-empty "subject" field.');
  }
  if (typeof parsed.style !== 'string' || !parsed.style.trim()) {
    throw new Error('Gemini response JSON is missing a non-empty "style" field.');
  }
  return parsed;
}

// Module 1 — Image Analyzer (optional). See ARCHITECTURE.md -> Module 1.
//
// Unlike Modules 2/3 (which persist per-job rows into `listings`/`mockups`), this
// persists onto `artworks.image_analysis` directly — the analysis describes the artwork
// itself, not a particular pipeline run of it, so it's keyed by artwork rather than job.
// A re-run (e.g. the user hits retry after tweaking nothing, or re-analyzes after
// swapping the file at the same path) overwrites that single column rather than
// accumulating history, the same idempotency principle the other modules' upserts
// follow, just via UPDATE instead of an ON CONFLICT upsert since there's only ever one
// row to touch.
//
// Per ARCHITECTURE.md -> Partial Failure Handling: "If Module 1 fails, the job pauses
// and asks the user for manual notes instead of auto-failing the whole job — Module 1 is
// optional, so a failure here shouldn't block Module 2." This function itself just
// throws on failure like any other module function; it's the caller (the
// POST /api/jobs/:id/run/image-analyzer route) that passes `required: false` to
// setModuleStatus so a failure here never forces the job's overall_status to 'failed' —
// the user can PATCH /api/jobs/:id/manual-notes and proceed straight to Module 2, same
// as if Module 1 had been skipped outright.
export async function analyzeArtworkForJob(jobId) {
  const db = getDb();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(job.artwork_id);
  if (!artwork) throw new Error(`Artwork for job ${jobId} not found`);

  const prompt = buildImageAnalysisPrompt();
  const { text: rawResponse } = await generateVision(prompt, artwork.file_path, { json: true });
  const analysis = parseModelJson(rawResponse);

  db.prepare('UPDATE artworks SET image_analysis = ? WHERE id = ?').run(JSON.stringify(analysis), artwork.id);

  return analysis;
}
