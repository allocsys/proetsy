// Module 7 (Taste Filter) — persistence layer. CRUD against `image_preferences` and
// `taste_centroids` (both already in backend/db/schema.sql — see ARCHITECTURE.md ->
// Module 7 -> "Build sequence" step 2). Centroid *math* itself is pure and lives in
// centroids.js; this file is the DB-touching glue around it: reading labeled examples
// out, handing them to computeAllCentroidPairs(), and writing the result back.

import { getDb } from '../../db/init.js';
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
 * Module 7 -> "How the 'training' works". Always inserts a new row (never upserts): like
 * `prompts`, this is meant to be a full history of labeled examples, not one current value
 * per key — re-labeling the same image is a new data point, not a correction to an old one.
 * @param {object} params
 * @param {string} params.imagePath
 * @param {Float32Array} params.embedding
 * @param {'keep' | 'discard'} params.label
 * @param {string | null} [params.category]
 * @param {number | null} [params.promptId] - links to the `prompts` row that generated this candidate, if any
 * @returns {number} the new row's id
 */
export function addImagePreference({ imagePath, embedding, label, category = null, promptId = null }) {
  if (!VALID_LABELS.has(label)) {
    throw new Error(`Invalid label "${label}" — must be "keep" or "discard"`);
  }

  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO image_preferences (image_path, embedding, label, category, prompt_id)
       VALUES (@image_path, @embedding, @label, @category, @prompt_id)`
    )
    .run({
      image_path: imagePath,
      embedding: vectorToBlob(embedding),
      label,
      category,
      prompt_id: promptId,
    });

  return result.lastInsertRowid;
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
  const writeAll = db.transaction(() => {
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
  writeAll();

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
 * Write side of the Module 7 -> Module 4 prompt-feedback link (ARCHITECTURE.md ->
 * Module 7 -> "Prompt-feedback link to Module 4", build sequence step 6). Looks up the
 * prompt that generated a just-labeled candidate, extracts its terms via
 * extractPromptTerms() (prompt-terms.js), and bumps each term's kept_count/
 * discarded_count in `prompt_terms` -- the same counts Module 4's getStyleHints()
 * (prompt-helper/index.js) reads back later as "terms that have worked well".
 *
 * No-op (not an error) when `promptId` is null/missing or the prompt no longer exists --
 * this link is optional/opt-in per the architecture doc, so a missing or unlinked prompt
 * should never block the label itself from saving (addImagePreference() above always
 * succeeds independently of this).
 * @param {number | null} promptId
 * @param {'keep' | 'discard'} label
 */
export function tallyPromptTermsForLabel(promptId, label) {
  if (!promptId) return;
  const db = getDb();
  const prompt = db.prepare('SELECT prompt_text FROM prompts WHERE id = ?').get(promptId);
  if (!prompt) return;

  const terms = extractPromptTerms(prompt.prompt_text);
  if (!terms.size) return;

  // Column name is interpolated from a fixed two-value ternary (never user input), so
  // this is safe -- not a dynamic/user-controlled SQL fragment.
  const column = label === 'keep' ? 'kept_count' : 'discarded_count';
  const upsert = db.prepare(
    `INSERT INTO prompt_terms (term, ${column}, updated_at) VALUES (?, 1, datetime('now'))
     ON CONFLICT(term) DO UPDATE SET ${column} = ${column} + 1, updated_at = datetime('now')`
  );
  const run = db.transaction((termList) => {
    for (const term of termList) upsert.run(term);
  });
  run(Array.from(terms));
}
