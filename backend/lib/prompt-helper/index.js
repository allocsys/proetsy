import { getDb, withTransaction } from '../../db/init.js';
import { generateText } from '../llm/index.js';
import { buildPromptHelperPrompt } from './prompt.js';
import { enforceMidjourneyConventions } from './validate.js';

function parseModelJson(rawText) {
  // Models sometimes wrap JSON in markdown fences despite instructions not to — strip
  // those, but don't silently swallow genuinely malformed JSON beyond that (same
  // approach as image-analyzer/index.js's and listing-generator/index.js's
  // parseModelJson).
  const cleaned = rawText.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON (${err.message}). Raw response: ${rawText.slice(0, 200)}`);
  }
  if (!parsed || !Array.isArray(parsed.prompts) || parsed.prompts.length === 0) {
    throw new Error('Gemini response JSON did not contain a non-empty "prompts" array.');
  }
  return parsed.prompts;
}

/**
 * Pulls up to `limit` terms that have historically shown up disproportionately in kept
 * (vs. discarded) images, per Module 7's optional, opt-in prompt-feedback link (see
 * ARCHITECTURE.md -> Module 7 -> "Prompt-feedback link to Module 4"). Returns an empty
 * array whenever `prompt_terms` has no qualifying rows — which is the normal state until
 * Module 7 is built and the user has labeled enough images for a term to show a real
 * kept/discarded skew; this link being "opt-in" is a natural consequence of there being
 * no data to opt into yet, not a separate feature flag.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {number} limit
 * @returns {string[]}
 */
function getStyleHints(db, limit = 5) {
  return db
    .prepare(
      `SELECT term FROM prompt_terms
       WHERE kept_count > discarded_count
       ORDER BY (kept_count - discarded_count) DESC
       LIMIT ?`
    )
    .all(limit)
    .map((row) => row.term);
}

// Module 4 — Trend/Prompt Helper (optional, isolated from the main pipeline). See
// ARCHITECTURE.md -> Module 4, and -> Partial Failure Handling: "If Module 4 fails, it's
// fully isolated — it's not part of the main listing pipeline, so a failure there never
// touches jobs in progress." Unlike Modules 1–3, this is NOT job-scoped at all — no
// job_modules row, no jobId parameter. A generation run is keyed only by an optional
// trend + a target orientation.
//
// Each call INSERTS new `prompts` rows rather than upserting one row per (trend,
// orientation) the way listings/mockups upsert per (job, variation/size) — the point
// here is to build up a browsable history of generated prompt batches (conceptually
// similar to Module 6's "listing history log"), not to represent one current value for
// a given key. Re-running with the same trend/orientation is expected to add a fresh
// batch, not replace the last one.
//
export async function generatePromptsForTrend({ trendId = null, orientation }) {
  if (!orientation) {
    throw new Error('orientation is required (e.g. "portrait", "landscape", "square")');
  }

  const db = getDb();

  const trend = trendId ? db.prepare('SELECT * FROM trends WHERE id = ?').get(trendId) : null;
  if (trendId && !trend) {
    throw new Error(`Trend ${trendId} not found`);
  }

  const styleHints = getStyleHints(db);

  const prompt = buildPromptHelperPrompt({ trend, orientation, styleHints });
  const { text: rawResponse } = await generateText(prompt, { json: true });
  const rawPrompts = parseModelJson(rawResponse);

  const cleaned = rawPrompts.map((p) => enforceMidjourneyConventions(p, orientation));

  const insert = db.prepare(
    `INSERT INTO prompts (trend_id, orientation, prompt_text, created_at) VALUES (?, ?, ?, datetime('now'))`
  );
  const ids = withTransaction(db, () => {
    const result = [];
    for (const item of cleaned) {
      const { lastInsertRowid } = insert.run(trendId || null, orientation, item.text);
      result.push(lastInsertRowid);
    }
    return result;
  });

  return cleaned.map((c, i) => ({
    id: ids[i],
    trend_id: trendId || null,
    orientation,
    prompt_text: c.text,
    warnings: c.warnings,
  }));
}

/**
 * Lists previously generated prompt batches, optionally filtered by trend and/or
 * orientation, newest first — backs the dashboard's browsable history for this module.
 * @param {{ trendId?: number, orientation?: string }} [filters]
 * @returns {object[]}
 */
export function listPrompts({ trendId, orientation } = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];
  if (trendId) {
    conditions.push('trend_id = ?');
    params.push(trendId);
  }
  if (orientation) {
    conditions.push('orientation = ?');
    params.push(orientation);
  }
  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`SELECT * FROM prompts${where} ORDER BY created_at DESC`).all(...params);
}
