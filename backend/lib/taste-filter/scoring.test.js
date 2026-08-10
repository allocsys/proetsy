import { describe, expect, it } from 'vitest';
import {
  COLD_START_MIN_EXAMPLES,
  autoDecision,
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

describe('autoDecision', () => {
  // A centroid pair that clears the cold-start gate on its own (isConfident === true),
  // reused across the boundary/threshold tests below so each test only has to vary the
  // thing it's actually testing.
  const confidentCounts = { keptCount: COLD_START_MIN_EXAMPLES, discardedCount: COLD_START_MIN_EXAMPLES };
  const coldStartCounts = { keptCount: 5, discardedCount: 3 };

  it('auto-keeps a score strictly above the threshold when confident', () => {
    expect(autoDecision(0.31, confidentCounts, 0.3)).toBe('keep');
  });

  it('auto-discards a score strictly below the negative threshold when confident', () => {
    expect(autoDecision(-0.31, confidentCounts, 0.3)).toBe('discard');
  });

  it('leaves a score exactly at the threshold boundary for manual review (not >, not <)', () => {
    expect(autoDecision(0.3, confidentCounts, 0.3)).toBeNull();
    expect(autoDecision(-0.3, confidentCounts, 0.3)).toBeNull();
  });

  it('leaves a score inside the uncertain band (between -threshold and +threshold) for manual review', () => {
    expect(autoDecision(0.1, confidentCounts, 0.3)).toBeNull();
    expect(autoDecision(-0.1, confidentCounts, 0.3)).toBeNull();
    expect(autoDecision(0, confidentCounts, 0.3)).toBeNull();
  });

  it('leaves an extreme score for manual review when just inside the cold-start gate (not confident)', () => {
    // Same extreme score that would auto-keep/auto-discard once confident — the
    // cold-start check must be applied first and short-circuit regardless of the score.
    expect(autoDecision(0.9, coldStartCounts, 0.3)).toBeNull();
    expect(autoDecision(-0.9, coldStartCounts, 0.3)).toBeNull();
  });

  it('treats counts exactly at the cold-start minimum as confident', () => {
    const atMinimum = { keptCount: Math.ceil(COLD_START_MIN_EXAMPLES / 2), discardedCount: Math.floor(COLD_START_MIN_EXAMPLES / 2) };
    expect(autoDecision(0.9, atMinimum, 0.3)).toBe('keep');
  });

  it('leaves a null score (no centroid data at all) for manual review even when confident', () => {
    expect(autoDecision(null, confidentCounts, 0.3)).toBeNull();
  });

  it('never auto-deletes or otherwise touches files — purely returns a label, advisory only', () => {
    // Documents the design constraint from ARCHITECTURE.md / plan.md Part 2: this
    // function's contract is a pure string-or-null return, nothing else.
    const result = autoDecision(0.5, confidentCounts, 0.3);
    expect(['keep', 'discard', null]).toContain(result);
  });
});

describe('scoreCandidate', () => {
  it('always returns a global score, and an orientation score only when an orientation pair is given', () => {
    const global = { kept: [1, 0], discarded: [0, 1], keptCount: 40, discardedCount: 40 };
    const result = scoreCandidate([1, 0], { global, orientation: null });

    expect(result.globalScore).not.toBeNull();
    expect(result.globalLabel).toBe('likely-keep');
    expect(result.globalConfident).toBe(true);
    expect(result.orientationScore).toBeNull();
    expect(result.orientationLabel).toBeNull();
    expect(result.orientationConfident).toBeNull();
  });

  it('flags low confidence for an orientation with too few labeled examples (cold start)', () => {
    const global = { kept: [1, 0], discarded: [0, 1], keptCount: 40, discardedCount: 40 };
    const orientation = { kept: [1, 0], discarded: null, keptCount: 2, discardedCount: 0 };
    const result = scoreCandidate([1, 0], { global, orientation });

    expect(result.orientationScore).not.toBeNull();
    expect(result.orientationConfident).toBe(false);
  });
});
