// Module 7 (Taste Filter) — centroid math. Pure functions only: everything here operates
// on plain embedding vectors and labels, no DB access (see store.js for that) and no
// model/network call (see embeddings.js) — unit-testable with synthetic vectors. See
// ARCHITECTURE.md -> Module 7 -> "Build sequence" step 2 and "How the 'training' works".

/**
 * Mean of a set of embedding vectors — the centroid itself. Assumes every vector is the
 * same length (the embedding dimensionality); the caller (recomputeCentroids in store.js)
 * is responsible for only ever passing vectors from the same embedding model.
 * @param {Array<Float32Array | number[]>} vectors
 * @returns {Float32Array | null} null if `vectors` is empty — there's no meaningful
 *   centroid for zero examples, and callers (see scoring in step 3) need to handle that
 *   as "not enough data yet" rather than treating a zero vector as a real centroid.
 */
export function computeCentroid(vectors) {
  if (!vectors || vectors.length === 0) return null;

  const dim = vectors[0].length;
  const sum = new Float32Array(dim);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) sum[i] += vector[i];
  }
  for (let i = 0; i < dim; i += 1) sum[i] /= vectors.length;
  return sum;
}

/**
 * Splits a set of labeled examples into kept/discarded centroids in one pass. This is the
 * core of both the global centroid pair (all examples) and each per-orientation pair (pre-
 * filtered to one orientation by the caller) — the split-by-label logic doesn't care which.
 * @param {Array<{ embedding: Float32Array | number[], label: 'keep' | 'discard' }>} examples
 * @returns {{ kept: Float32Array | null, discarded: Float32Array | null, keptCount: number, discardedCount: number }}
 */
export function computeCentroidPair(examples) {
  const keptVectors = [];
  const discardedVectors = [];

  for (const example of examples) {
    if (example.label === 'keep') keptVectors.push(example.embedding);
    else if (example.label === 'discard') discardedVectors.push(example.embedding);
    // Any other label value is ignored here rather than thrown on — label validation is
    // the write path's job (store.js), not this read-side aggregation.
  }

  return {
    kept: computeCentroid(keptVectors),
    discarded: computeCentroid(discardedVectors),
    keptCount: keptVectors.length,
    discardedCount: discardedVectors.length,
  };
}

/**
 * Groups labeled examples by orientation and computes a centroid pair for each group, plus
 * one global pair across everything regardless of orientation. Matches ARCHITECTURE.md ->
 * Module 7's "Two sets of centroids are maintained" design — this is the pure aggregation
 * step; persisting the result to the `taste_centroids` table is recomputeCentroids() in
 * store.js.
 * @param {Array<{ embedding: Float32Array | number[], label: 'keep' | 'discard', orientation: string | null }>} examples
 * @returns {Map<string | null, { kept: Float32Array | null, discarded: Float32Array | null, keptCount: number, discardedCount: number }>}
 *   keyed by orientation, with `null` holding the global (all-orientations) pair
 */
export function computeAllCentroidPairs(examples) {
  const byOrientation = new Map();
  for (const example of examples) {
    const key = example.orientation ?? null;
    if (!byOrientation.has(key)) byOrientation.set(key, []);
    byOrientation.get(key).push(example);
  }

  const result = new Map();
  result.set(null, computeCentroidPair(examples)); // global — every example, orientation ignored
  for (const [orientation, orientationExamples] of byOrientation) {
    if (orientation === null) continue; // already covered by the global pair above
    result.set(orientation, computeCentroidPair(orientationExamples));
  }
  return result;
}
