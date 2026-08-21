// Module 7 (Taste Filter) — persistence layer. CRUD against `image_preferences` and
// `taste_centroids` (both already in backend/db/schema.sql — see ARCHITECTURE.md ->
// Module 7 -> "Build sequence" step 2). Centroid *math* itself is pure and lives in
// centroids.js; this file is the DB-touching glue around it: reading labeled examples
// out, handing them to computeAllCentroidPairs(), and writing the result back.

import { getDb, withTransaction } from '../../db/init.js';
import { computeAllCentroidPairs } from './centroids.js';
import { extractPromptTerms } from './prompt-terms.js';

const VALID_LABELS = new Set(['keep', 'discard']);

/**
 * Float32Array <-> Buffer helpers for the `embedding`/`kept_centroid`/`discarded_centroid`
 * BLOB columns. A Float32Array's `.buffer` is a plain ArrayBuffer, which better-sqlite3
 * accepts directly as a BLOB parameter; reading it back needs a Buffer wrapped into a
 * Float32Array view, not a fresh copy loop.
 */
function vectorToBlob(vector) {
  // `Buffer.from(typedArray.buffer, byteOffset, byteLength)` (not `Buffer.from(vector)`,
  // which would reinterpret the *values* as bytes) — this is a zero-copy view over the
  // same underlying memory, which is fine here since we're about to hand it to
  // better-sqlite3 and not mutate `vector` afterward.
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

function blobToVector(blob) {
  if (!blob) return null;
  // Copy the blob's bytes into a new ArrayBuffer aligned to Float32Array's requirements —
  // better-sqlite3 returns a Buffer that may be a view into a larger internal buffer with
  // an arbitrary byte offset, so wrapping it directly risks a misaligned/incorrect view.
  const arrayBuffer = blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  return new Float32Array(arrayBuffer);
}

/**
 * Records one keep/discard decision — the training signal itself, per ARCHITECTURE.md ->
 * Module 7 -> "How the 'training' works". Upserts on `image_path` (one row per image,
 * enforced by the idx_image_preferences_image_path unique index): unlike `prompts`, this
 * is meant to hold
 * the *current* judgment for each image, not a full history, so re-labeling the same
 * image — including a manual Keep/Discard that corrects an earlier auto-labeled row —
 * updates that one row in place rather than adding a second, potentially contradictory
 * one that would double-count in recomputeCentroids() below.
 * @param {object} params
 * @param {string} params.imagePath
 * @param {Float32Array} params.embedding
 * @param {'keep' | 'discard'} params.label
 * @param {string | null} [params.category] - Module 7's own freeform curation grouping
 *   (e.g. "square-canvas", "bedroom") — a distinct concept from Module 4's `orientation`
 *   (portrait/landscape/square). Stored in the `image_preferences.category` DB column.
 * @param {number | null} [params.promptId] - links to the `prompts` row that generated this candidate, if any
 * @param {boolean} [params.autoLabeled] - true when this row was written by the auto-compute
 *   decision rule (plan.md Part 2) rather than a manual Keep/Discard click. Defaults to
 *   false, so a plain manual label call — including one correcting a prior auto-labeled
 *   row for the same image_path — always clears this back to 0 on upsert.
 * @returns {number} the row's id (existing, if this call updated it; new, otherwise)
 */
export function addImagePreference({
  imagePath,
  embedding,
  label,
  category = null,
  promptId = null,
  autoLabeled = false,
}) {
  if (!VALID_LABELS.has(label)) {
    throw new Error(`Invalid label "${label}" — must be "keep" or "discard"`);
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO image_preferences (image_path, embedding, label, category, prompt_id, auto_labeled)
     VALUES (@image_path, @embedding, @label, @category, @prompt_id, @auto_labeled)
     ON CONFLICT(image_path) DO UPDATE SET
       embedding = excluded.embedding,
       label = excluded.label,
       category = excluded.category,
       prompt_id = excluded.prompt_id,
       auto_labeled = excluded.auto_labeled`
  ).run({
    image_path: imagePath,
    embedding: vectorToBlob(embedding),
    label,
    category,
    prompt_id: promptId,
    auto_labeled: autoLabeled ? 1 : 0,
  });

  // better-sqlite3's lastInsertRowid isn't reliable for the ON CONFLICT ... DO UPDATE
  // branch — SQLite's last_insert_rowid() only advances on an actual INSERT, not an
  // UPDATE — so look the row up by its unique key instead. Correct either way: a fresh
  // insert or an update of the existing row.
  return db.prepare('SELECT id FROM image_preferences WHERE image_path = ?').get(imagePath).id;
}

/**
 * Reads back every labeled example, with embeddings parsed to Float32Array — the raw
 * input computeAllCentroidPairs() (centroids.js) operates on.
 * @returns {Array<{ id: number, imagePath: string, embedding: Float32Array, label: string, category: string | null, promptId: number | null }>}
 */
export function listImagePreferences() {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM image_preferences').all();
  return rows.map((row) => ({
    id: row.id,
    imagePath: row.image_path,
    embedding: blobToVector(row.embedding),
    label: row.label,
    category: row.category,
    promptId: row.prompt_id,
  }));
}

/**
 * Recomputes every centroid (global + per-category) from the full `image_preferences`
 * history and persists the result to `taste_centroids`, replacing whatever was there
 * before for each category. This is what both "recompute automatically after every
 * labeled batch" and the dashboard's "Recompute now" button (ARCHITECTURE.md -> Module 7)
 * call — same function either way, there's no separate incremental-update path, since a
 * full recompute over a single user's labeled set is cheap enough not to need one.
 *
 * A category whose centroid pair would be empty (no examples at all, e.g. because it's
 * only ever appeared with one label) still gets a row — with `kept_centroid`/
 * `discarded_centroid` left NULL for whichever side has zero examples — so callers can
 * distinguish "cold start, no data yet" from "row doesn't exist" without a separate
 * existence check.
 * @returns {Map<string | null, { keptCount: number, discardedCount: number }>} counts per
 *   category (null = global), for callers that want to surface cold-start state
 */
export function recomputeCentroids() {
  const db = getDb();
  const examples = listImagePreferences();
  const centroidPairs = computeAllCentroidPairs(examples);

  // Not a SQL-level `ON CONFLICT` upsert: `taste_centroids.category` has no UNIQUE
  // constraint in schema.sql, and even if it did, SQLite treats every NULL as distinct
  // for uniqueness purposes — which would defeat exactly the row we need it for most (the
  // global pair, stored as `category IS NULL`). So this does a NULL-safe
  // select-then-update-or-insert instead, in one transaction so a recompute can't leave
  // some categories updated and others not if it fails partway through.
  const findExisting = db.prepare('SELECT id FROM taste_centroids WHERE category IS ?');
  const update = db.prepare(
    `UPDATE taste_centroids SET kept_centroid = @kept_centroid, discarded_centroid = @discarded_centroid,
       kept_count = @kept_count, discarded_count = @discarded_count, updated_at = datetime('now')
     WHERE id = @id`
  );
  const insert = db.prepare(
    `INSERT INTO taste_centroids (category, kept_centroid, discarded_centroid, kept_count, discarded_count, updated_at)
     VALUES (@category, @kept_centroid, @discarded_centroid, @kept_count, @discarded_count, datetime('now'))`
  );

  const counts = new Map();
  withTransaction(db, () => {
    for (const [category, pair] of centroidPairs) {
      const params = {
        category,
        kept_centroid: pair.kept ? vectorToBlob(pair.kept) : null,
        discarded_centroid: pair.discarded ? vectorToBlob(pair.discarded) : null,
        kept_count: pair.keptCount,
        discarded_count: pair.discardedCount,
      };
      const existing = findExisting.get(category);
      if (existing) {
        update.run({ ...params, id: existing.id });
      } else {
        insert.run(params);
      }
      counts.set(category, { keptCount: pair.keptCount, discardedCount: pair.discardedCount });
    }
  });

  return counts;
}

/**
 * Reads one category's centroid pair (or the global pair, for `category = null`) back out
 * of `taste_centroids`, with the BLOBs parsed to Float32Array — the input step 3's scoring
 * function needs. Returns null centroids (not a thrown error) when nothing's been computed
 * yet for that category — cold start, per ARCHITECTURE.md -> Module 7's "Cold start" note;
 * the caller (step 3) is responsible for deciding how to handle that rather than this
 * function guessing at a default.
 * @param {string | null} category
 * @returns {{ kept: Float32Array | null, discarded: Float32Array | null } }
 */
export function getCentroids(category = null) {
  const db = getDb();
  const row = db
    .prepare('SELECT kept_centroid, discarded_centroid, kept_count, discarded_count FROM taste_centroids WHERE category IS ?')
    .get(category);

  if (!row) return { kept: null, discarded: null, keptCount: 0, discardedCount: 0 };
  return {
    kept: blobToVector(row.kept_centroid),
    discarded: blobToVector(row.discarded_centroid),
    keptCount: row.kept_count,
    discardedCount: row.discarded_count,
  };
}

/**
 * Reads back an image's *current* label/prompt, before a new label overwrites it --
 * the "before" half of tallyPromptTermsForLabel()'s before/after diff. Must be called
 * prior to addImagePreference()'s upsert for the same image_path, since that upsert is
 * what overwrites the row this reads.
 * Returns null when the image has never been labeled before (first label, nothing to undo).
 * @param {string} imagePath
 * @returns {{ promptId: number | null, label: 'keep' | 'discard' } | null}
 */
export function getImagePreferenceState(imagePath) {
  const db = getDb();
  const row = db.prepare('SELECT prompt_id, label FROM image_preferences WHERE image_path = ?').get(imagePath);
  if (!row) return null;
  return { promptId: row.prompt_id, label: row.label };
}

// Column name is interpolated from a fixed two-value ternary (never user input), so this
// is safe -- not a dynamic/user-controlled SQL fragment. Shared by both the increment and
// decrement sides of tallyPromptTermsForLabel() below.
function columnForLabel(label) {
  return label === 'keep' ? 'kept_count' : 'discarded_count';
}

// Applies one prompt's worth of term deltas (+1 for the label just applied, -1 to undo a
// label being replaced) to `prompt_terms`. No-op when promptId/label is missing, the
// prompt no longer exists, or its text yields no extractable terms -- same tolerance
// tallyPromptTermsForLabel() has always had for an unlinked/missing prompt.
function adjustPromptTermCounts(db, promptId, label, delta) {
  if (!promptId || !label) return;
  const prompt = db.prepare('SELECT prompt_text FROM prompts WHERE id = ?').get(promptId);
  if (!prompt) return;

  const terms = extractPromptTerms(prompt.prompt_text);
  if (!terms.size) return;

  const column = columnForLabel(label);
  const statement =
    delta > 0
      ? db.prepare(
          `INSERT INTO prompt_terms (term, ${column}, updated_at) VALUES (?, 1, datetime('now'))
           ON CONFLICT(term) DO UPDATE SET ${column} = ${column} + 1, updated_at = datetime('now')`
        )
      : // Clamped at 0 via MAX() -- a term whose count is already 0 (e.g. rows written
        // before this fix shipped, which never got their share of an earlier relabel's
        // increment reversed) must never go negative from an unrelated later correction.
        db.prepare(
          `UPDATE prompt_terms SET ${column} = MAX(${column} - 1, 0), updated_at = datetime('now') WHERE term = ?`
        );
  withTransaction(db, () => {
    for (const term of terms) statement.run(term);
  });
}

/**
 * Write side of the Module 7 -> Module 4 prompt-feedback link (ARCHITECTURE.md ->
 * Module 7 -> "Prompt-feedback link to Module 4", build sequence step 6). Looks up the
 * prompt that generated a just-labeled candidate, extracts its terms via
 * extractPromptTerms() (prompt-terms.js), and bumps each term's kept_count/
 * discarded_count in `prompt_terms` -- the same counts Module 4's getStyleHints()
 * (prompt-helper/index.js) reads back later as "terms that have worked well".
 *
 * `previous` (optional): the image's prior { promptId, label } state, from
 * getImagePreferenceState() called *before* addImagePreference()'s upsert overwrote it.
 * Three cases:
 *   - No `previous` given: a fresh tally, always +1 -- same as the original
 *     increment-only version (used by callers, e.g. some tests, that don't track state).
 *   - `previous` differs from the (promptId, label) being applied now: a real relabel --
 *     the prior state's contribution is undone first (-1, clamped at 0) before the new
 *     one is tallied (+1). Fixes prompt_terms drifting out of sync with the current
 *     labeled set on a relabel.
 *   - `previous` is identical to the (promptId, label) being applied now: a redundant
 *     re-label (nothing actually changed) -- a pure no-op, since it already contributed
 *     its +1 the first time.
 *
 * No-op for the new label's own tally when `promptId` is null/missing or the prompt no
 * longer exists -- this link is optional/opt-in per the architecture doc, so a missing or
 * unlinked prompt should never block the label itself from saving (addImagePreference()
 * always succeeds independently of this).
 * @param {number | null} promptId
 * @param {'keep' | 'discard'} label
 * @param {{ promptId: number | null, label: 'keep' | 'discard' } | null} [previous]
 */
export function tallyPromptTermsForLabel(promptId, label, previous = null) {
  const db = getDb();

  const isRedundant = previous && previous.promptId === promptId && previous.label === label;
  if (isRedundant) return;

  if (previous) {
    adjustPromptTermCounts(db, previous.promptId, previous.label, -1);
  }

  adjustPromptTermCounts(db, promptId, label, 1);
}

/**
 * Full rebuild of `prompt_terms.kept_count`/`discarded_count` from the *current*
 * `image_preferences` table, rather than trusting the incremental running total
 * tallyPromptTermsForLabel() maintains. Mirrors recomputeCentroids()'s "recompute
 * everything from the labeled set" pattern above -- same idea, applied to prompt terms
 * instead of embedding centroids.
 *
 * Why this exists alongside the incremental tally: it's the backfill/self-healing half
 * of the fix for prompt_terms double-counting on relabel (issue #59, part 2) -- any
 * `prompt_terms` rows left inflated by relabeling *before* that fix shipped are not
 * corrected by the incremental fix alone (it only stops *new* drift). Reading every
 * image's current label directly here, instead of relying on a running delta, can never
 * drift, so running this is always safe and always correct regardless of history.
 *
 * Resets every existing `prompt_terms` row's counts to 0 first (not a delete -- keeps
 * the term rows and lets `updated_at` reflect this recompute), then re-tallies from
 * every `image_preferences` row that resolves to a real prompt. Whole thing runs in one
 * transaction so a caller never sees a partially-reset table.
 */
export function recomputePromptTerms() {
  const db = getDb();

  withTransaction(db, () => {
    db.prepare('UPDATE prompt_terms SET kept_count = 0, discarded_count = 0').run();

    const labeledRows = db
      .prepare(
        `SELECT ip.label AS label, p.prompt_text AS prompt_text
         FROM image_preferences ip
         JOIN prompts p ON p.id = ip.prompt_id
         WHERE ip.prompt_id IS NOT NULL`
      )
      .all();

    const upsertKept = db.prepare(
      `INSERT INTO prompt_terms (term, kept_count, updated_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(term) DO UPDATE SET kept_count = kept_count + 1, updated_at = datetime('now')`
    );
    const upsertDiscarded = db.prepare(
      `INSERT INTO prompt_terms (term, discarded_count, updated_at) VALUES (?, 1, datetime('now'))
       ON CONFLICT(term) DO UPDATE SET discarded_count = discarded_count + 1, updated_at = datetime('now')`
    );

    for (const row of labeledRows) {
      const terms = extractPromptTerms(row.prompt_text);
      if (!terms.size) continue;
      const upsert = row.label === 'keep' ? upsertKept : upsertDiscarded;
      for (const term of terms) upsert.run(term);
    }
  });
}
