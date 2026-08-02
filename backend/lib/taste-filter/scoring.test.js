import { describe, expect, it } from 'vitest';
import {
  COLD_START_MIN_EXAMPLES,
  cosineSimilarity,
  isConfident,
  labelFromScore,
  scoreAgainstCentroids,
  scoreCandidate,
} from './scoring.js';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('is -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('is scale-invariant (not a plain dot product) — a non-unit centroid still gives a normalized score', () => {
    // [2, 0] and [10, 0] point the same direction but have very different magnitudes —
    // a plain dot product would differ a lot; cosine similarity should not.
    const a = cosineSimilarity([1, 0], [2, 0]);
    const b = cosineSimilarity([1, 0], [10, 0]);
    expect(a).toBeCloseTo(1, 5);
    expect(b).toBeCloseTo(1, 5);
  });

  it('returns 0 rather than NaN for a zero-magnitude vector', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});

describe('scoreAgainstCentroids', () => {
  it('returns null when neither centroid exists (no labels at all)', () => {
    expect(scoreAgainstCentroids([1, 0], { kept: null, discarded: null })).toBeNull();
  });

  it('scores toward kept as positive when the candidate matches the kept centroid', () => {
    const score = scoreAgainstCentroids([1, 0], { kept: [1, 0], discarded: [0, 1] });
    expect(score).toBeGreaterThan(0);
  });

  it('scores toward discarded as negative when the candidate matches the discarded centroid', () => {
    const score = scoreAgainstCentroids([0, 1], { kept: [1, 0], discarded: [0, 1] });
    expect(score).toBeLessThan(0);
  });

  it('scores against just the kept centroid when discarded has no examples yet (partial cold start)', () => {
    const score = scoreAgainstCentroids([1, 0], { kept: [1, 0], discarded: null });
    expect(score).toBeCloseTo(1, 5); // similarity to kept minus 0 (no discarded side)
  });
});

describe('labelFromScore', () => {
  it('labels a clearly positive score likely-keep', () => {
    expect(labelFromScore(0.5)).toBe('likely-keep');
  });

  it('labels a clearly negative score likely-discard', () => {
    expect(labelFromScore(-0.5)).toBe('likely-discard');
  });

  it('labels a near-zero score uncertain, not forced to a side', () => {
    expect(labelFromScore(0.001)).toBe('uncertain');
    expect(labelFromScore(-0.001)).toBe('uncertain');
  });

  it('labels a null score (no data at all) uncertain', () => {
    expect(labelFromScore(null)).toBe('uncertain');
  });
});

describe('isConfident', () => {
  it('is false below the cold-start threshold', () => {
    expect(isConfident({ keptCount: 5, discardedCount: 3 })).toBe(false);
  });

  it('is true at/above the cold-start threshold', () => {
    const half = Math.ceil(COLD_START_MIN_EXAMPLES / 2);
    expect(isConfident({ keptCount: half, discardedCount: half })).toBe(true);
  });

  it('respects a custom threshold override', () => {
    expect(isConfident({ keptCount: 2, discardedCount: 1 }, 3)).toBe(true);
  });
});

describe('scoreCandidate', () => {
  it('always returns a global score, and a category score only when a category pair is given', () => {
    const global = { kept: [1, 0], discarded: [0, 1], keptCount: 40, discardedCount: 40 };
    const result = scoreCandidate([1, 0], { global, category: null });

    expect(result.globalScore).not.toBeNull();
    expect(result.globalLabel).toBe('likely-keep');
    expect(result.globalConfident).toBe(true);
    expect(result.categoryScore).toBeNull();
    expect(result.categoryLabel).toBeNull();
    expect(result.categoryConfident).toBeNull();
  });

  it('flags low confidence for a category with too few labeled examples (cold start)', () => {
    const global = { kept: [1, 0], discarded: [0, 1], keptCount: 40, discardedCount: 40 };
    const category = { kept: [1, 0], discarded: null, keptCount: 2, discardedCount: 0 };
    const result = scoreCandidate([1, 0], { global, category });

    expect(result.categoryScore).not.toBeNull();
    expect(result.categoryConfident).toBe(false);
  });
});
