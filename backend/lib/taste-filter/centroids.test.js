import { describe, expect, it } from 'vitest';
import { computeAllCentroidPairs, computeCentroid, computeCentroidPair } from './centroids.js';

describe('computeCentroid', () => {
  it('returns null for an empty set', () => {
    expect(computeCentroid([])).toBeNull();
  });

  it('returns the mean vector', () => {
    const result = computeCentroid([
      [1, 2, 3],
      [3, 4, 5],
    ]);
    expect(Array.from(result)).toEqual([2, 3, 4]);
  });

  it('returns the single vector unchanged for one example', () => {
    const result = computeCentroid([[1, 2, 3]]);
    expect(Array.from(result)).toEqual([1, 2, 3]);
  });
});

describe('computeCentroidPair', () => {
  it('splits examples by label and computes each centroid independently', () => {
    const examples = [
      { embedding: [1, 0], label: 'keep' },
      { embedding: [3, 0], label: 'keep' },
      { embedding: [0, 1], label: 'discard' },
    ];
    const result = computeCentroidPair(examples);

    expect(Array.from(result.kept)).toEqual([2, 0]);
    expect(Array.from(result.discarded)).toEqual([0, 1]);
    expect(result.keptCount).toBe(2);
    expect(result.discardedCount).toBe(1);
  });

  it('returns null centroids and zero counts for a side with no examples (cold start)', () => {
    const result = computeCentroidPair([{ embedding: [1, 1], label: 'keep' }]);

    expect(result.kept).not.toBeNull();
    expect(result.discarded).toBeNull();
    expect(result.discardedCount).toBe(0);
  });

  it('ignores examples with an unrecognized label rather than throwing', () => {
    const result = computeCentroidPair([
      { embedding: [1, 1], label: 'keep' },
      { embedding: [5, 5], label: 'uncertain' },
    ]);
    expect(result.keptCount).toBe(1);
    expect(result.discardedCount).toBe(0);
  });
});

describe('computeAllCentroidPairs', () => {
  it('computes a global pair across all orientations plus one pair per orientation', () => {
    const examples = [
      { embedding: [1, 0], label: 'keep', orientation: 'portrait' },
      { embedding: [0, 1], label: 'discard', orientation: 'portrait' },
      { embedding: [5, 5], label: 'keep', orientation: 'landscape' },
    ];
    const result = computeAllCentroidPairs(examples);

    expect(result.has(null)).toBe(true); // global
    expect(result.get(null).keptCount).toBe(2); // both keeps, across orientations
    expect(result.get(null).discardedCount).toBe(1);

    expect(result.get('portrait').keptCount).toBe(1);
    expect(result.get('portrait').discardedCount).toBe(1);

    expect(result.get('landscape').keptCount).toBe(1);
    expect(result.get('landscape').discardedCount).toBe(0);
  });

  it('treats a null orientation as part of the global pair, not a separate orientation entry', () => {
    const examples = [{ embedding: [1, 1], label: 'keep', orientation: null }];
    const result = computeAllCentroidPairs(examples);

    // Only the global (null-keyed) entry should exist — no duplicate null orientation.
    expect(result.size).toBe(1);
    expect(result.get(null).keptCount).toBe(1);
  });
});
