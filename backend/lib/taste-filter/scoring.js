// Module 7 (Taste Filter) — scoring. Pure functions only: takes a candidate embedding and
// a centroid pair (from centroids.js/store.js) and produces the two taste scores +
// suggested label described in ARCHITECTURE.md -> Module 7 -> "Output" / "How the
// 'training' works". No DB, no model — unit-testable with synthetic vectors, same as
// centroids.js. See ARCHITECTURE.md -> Module 7 -> "Build sequence" step 3.

// "A few dozen labeled examples is typically enough for this kind of centroid scoring to
// become useful" (ARCHITECTURE.md -> Module 7 -> "Cold start"). Below this many *total*
// examples feeding a centroid pair (kept + discarded combined), a score is still returned
// but flagged low-confidence rather than withheld — the doc says "shows scores but doesn't
// filter confidently", not "shows nothing".
export const COLD_START_MIN_EXAMPLES = 30;

// A score near zero means "about as similar to kept as to discarded" — genuinely
// ambiguous, not just a rounding artifact, so it's labeled 'uncertain' rather than forced
// into likely-keep/likely-discard on whichever side of exactly zero it lands.
const UNCERTAIN_BAND = 0.02;

/**
 * Cosine similarity between two vectors. Centroids are means of L2-normalized embeddings,
 * so a centroid itself is generally NOT a unit vector (averaging unit vectors shrinks the
 * result toward zero unless they all point the same way) — this divides by both norms
 * explicitly rather than assuming a plain dot product is already cosine similarity.
 * @param {Float32Array | number[]} a
 * @param {Float32Array | number[]} b
 * @returns {number} in [-1, 1], or 0 if either vector has zero magnitude
 */
export function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Scores one candidate embedding against one centroid pair (either the global pair or one
 * category's pair — this function doesn't care which, per ARCHITECTURE.md -> Module 7:
 * "A new candidate gets scored against both [...] using the same calculation"). Score is
 * similarity-to-kept minus similarity-to-discarded, so it's positive when the candidate
 * leans toward what's historically been kept, negative when it leans toward discarded.
 *
 * Handles partial cold start explicitly: if only one side of the pair has any labeled
 * examples yet (e.g. everything labeled so far has been a keep), this scores against
 * whichever centroid exists rather than refusing — matching "the system shows scores but
 * doesn't filter confidently" rather than withholding a score entirely.
 * @param {Float32Array} embedding - the candidate's embedding
 * @param {{ kept: Float32Array | null, discarded: Float32Array | null }} centroidPair
 * @returns {number | null} null only when NEITHER centroid exists yet (no labels at all
 *   for this pair) — there's nothing to compare against.
 */
export function scoreAgainstCentroids(embedding, centroidPair) {
  const { kept, discarded } = centroidPair;
  if (!kept && !discarded) return null;

  const keptSim = kept ? cosineSimilarity(embedding, kept) : 0;
  const discardedSim = discarded ? cosineSimilarity(embedding, discarded) : 0;
  return keptSim - discardedSim;
}

/**
 * Turns a raw score into the dashboard's suggested label. Never used to auto-discard
 * anything (ARCHITECTURE.md -> Module 7: "Nothing is auto-deleted") — this is advisory
 * only, the user always confirms.
 * @param {number | null} score
 * @returns {'likely-keep' | 'likely-discard' | 'uncertain'}
 */
export function labelFromScore(score) {
  if (score === null || Math.abs(score) < UNCERTAIN_BAND) return 'uncertain';
  return score > 0 ? 'likely-keep' : 'likely-discard';
}

/**
 * Whether a centroid pair has enough labeled examples behind it to trust its score with
 * normal confidence, per ARCHITECTURE.md -> Module 7 -> "Cold start". Separate from
 * labelFromScore() so a caller can show "uncertain (cold start)" vs. a genuinely
 * ambiguous "uncertain" score differently in the UI, without conflating the two reasons.
 * @param {{ keptCount: number, discardedCount: number }} counts
 * @param {number} [minExamples]
 * @returns {boolean}
 */
export function isConfident(counts, minExamples = COLD_START_MIN_EXAMPLES) {
  return (counts.keptCount ?? 0) + (counts.discardedCount ?? 0) >= minExamples;
}

/**
 * Module 7 -> Part 2 (plan.md) -> Step 2.4: the auto-compute decision rule. Pure and
 * independently testable, same as the rest of this file -- no DB, no settings lookup;
 * the caller (POST /api/taste-filter/import, Step 2.6) is responsible for reading
 * `taste_filter_auto_enabled`/`taste_filter_auto_threshold` from the settings table and
 * only calling this when auto mode is on.
 *
 * Existing design constraint preserved (see this file's top-of-file comment and
 * ARCHITECTURE.md): "Nothing is auto-deleted ... this is advisory only" -- this function
 * never causes a file to be deleted either way, it only decides which `image_preferences`
 * row (if any) gets written automatically vs. left for manual review. A `null` result
 * means "needs manual review", the same state every candidate is in today.
 *
 * `isConfident`/`COLD_START_MIN_EXAMPLES` are unchanged and always checked first --
 * auto-compute only ever acts on centroid pairs that already clear the existing
 * cold-start bar, regardless of how extreme the score is.
 * @param {number | null} score - a single pair's score (global or category), as produced
 *   by scoreAgainstCentroids()
 * @param {{ keptCount: number, discardedCount: number }} counts - that same pair's counts
 * @param {number} threshold - `taste_filter_auto_threshold`, an absolute score cutoff
 * @returns {'keep' | 'discard' | null} null means "manual review" -- either the cold-start
 *   gate isn't cleared yet, or the score falls inside the uncertain band around zero
 */
export function autoDecision(score, counts, threshold) {
  if (score === null) return null;
  if (!isConfident(counts)) return null;
  if (score > threshold) return 'keep';
  if (score < -threshold) return 'discard';
  return null;
}

/**
 * The full per-candidate scoring result: both taste scores (global + category) plus a
 * suggested label for each, per ARCHITECTURE.md -> Module 7 -> "Output": "each candidate
 * gets two taste scores [...] plus a suggested label". Category is optional — a candidate
 * with no assigned category (or a category with no centroid pair at all yet) still gets a
 * global score; `categoryScore`/`categoryLabel` are null in that case rather than the
 * whole result failing.
 * @param {Float32Array} embedding
 * @param {{ global: { kept: Float32Array | null, discarded: Float32Array | null, keptCount: number, discardedCount: number },
 *           category: { kept: Float32Array | null, discarded: Float32Array | null, keptCount: number, discardedCount: number } | null }} centroids
 * @returns {{
 *   globalScore: number | null, globalLabel: string, globalConfident: boolean,
 *   categoryScore: number | null, categoryLabel: string | null, categoryConfident: boolean | null
 * }}
 */
export function scoreCandidate(embedding, { global, category }) {
  const globalScore = scoreAgainstCentroids(embedding, global);
  const result = {
    globalScore,
    globalLabel: labelFromScore(globalScore),
    globalConfident: isConfident(global),
    categoryScore: null,
    categoryLabel: null,
    categoryConfident: null,
  };

  if (category) {
    const categoryScore = scoreAgainstCentroids(embedding, category);
    result.categoryScore = categoryScore;
    result.categoryLabel = labelFromScore(categoryScore);
    result.categoryConfident = isConfident(category);
  }

  return result;
}
