import { getDb, withTransaction } from '../../db/init.js';
import { getProductSizes } from '../../config/index.js';
import { LISTING_VARIATIONS } from '../../config/shop-conventions.js';
import { generateText } from '../llm/index.js';
import { getTagCandidates } from '../tags/index.js';
import { buildListingPrompt } from './prompt.js';
import { enforceConventions } from './validate.js';

function parseModelJson(rawText) {
  // Models sometimes wrap JSON in markdown fences despite instructions not to — strip
  // those, but don't silently swallow genuinely malformed JSON beyond that. A parse
  // failure here is a real Module 2 failure (see ARCHITECTURE.md Partial Failure
  // Handling: Module 2 is required, so the job stops and surfaces the error).
  const cleaned = rawText.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON (${err.message}). Raw response: ${rawText.slice(0, 200)}`);
  }
  if (!parsed || !Array.isArray(parsed.variations)) {
    throw new Error('Gemini response JSON did not contain a "variations" array.');
  }
  return parsed.variations;
}

// Module 2 — Listing Generator. Core, not skippable. See ARCHITECTURE.md -> Module 2.
// Persists results to the `listings` table (UNIQUE(job_id, variation) makes a re-run
// idempotent — it overwrites, never duplicates, per Partial Failure Handling).
export async function generateListingsForJob(jobId, { trendId = null } = {}) {
  const db = getDb();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(job.artwork_id);
  if (!artwork) throw new Error(`Artwork for job ${jobId} not found`);

  const imageAnalysis = artwork.image_analysis ? JSON.parse(artwork.image_analysis) : null;
  if (!imageAnalysis && !job.manual_notes) {
    throw new Error(
      'Module 2 needs either Module 1 image analysis or manual notes on the job, and neither is present. ' +
        'Set manual_notes via PATCH /api/jobs/:id/manual-notes, or run Module 1 first.'
    );
  }

  const trend = trendId ? db.prepare('SELECT * FROM trends WHERE id = ?').get(trendId) : null;

  const tagCandidates = await getTagCandidates(imageAnalysis || {});

  const productSizesConfig = getProductSizes();
  const availableSizes = Object.entries(productSizesConfig)
    .filter(([, size]) => Boolean(size.mockup_template))
    .map(([size_key, size]) => ({ size_key, ...size }));

  const prompt = buildListingPrompt({
    imageAnalysis,
    manualNotes: job.manual_notes,
    trend,
    tagCandidates,
    availableSizes,
  });

  const { text: rawResponse } = await generateText(prompt, { json: true });
  const rawVariations = parseModelJson(rawResponse);

  const byAngle = new Map(rawVariations.map((v) => [v.angle, v]));
  const missing = LISTING_VARIATIONS.filter((angle) => !byAngle.has(angle));
  if (missing.length) {
    throw new Error(`Gemini response is missing variation(s): ${missing.join(', ')}`);
  }

  const cleanedVariations = LISTING_VARIATIONS.map((angle) => enforceConventions(byAngle.get(angle)));

  const upsert = db.prepare(`
    INSERT INTO listings (job_id, variation, title, description, tags, tag_alternates, edited_at)
    VALUES (@job_id, @variation, @title, @description, @tags, @tag_alternates, datetime('now'))
    ON CONFLICT(job_id, variation) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      tags = excluded.tags,
      tag_alternates = excluded.tag_alternates,
      edited_at = excluded.edited_at
  `);

  withTransaction(db, () => {
    for (const v of cleanedVariations) {
      upsert.run({
        job_id: jobId,
        variation: v.angle,
        title: v.title,
        description: v.description,
        tags: JSON.stringify(v.tags),
        tag_alternates: JSON.stringify(v.tagAlternates),
      });
    }
  });

  return cleanedVariations;
}
