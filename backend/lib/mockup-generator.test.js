import { describe, it, expect } from 'vitest';
import { computeMismatchRatio } from './mockup-generator.js';

describe('computeMismatchRatio', () => {
  it('returns 0 for identical ratios', () => {
    expect(computeMismatchRatio(1.5, 1.5)).toBe(0);
  });

  it('computes relative difference against the target ratio', () => {
    // target 2.0, actual 1.5 -> |1.5 - 2.0| / 2.0 = 0.25
    expect(computeMismatchRatio(1.5, 2.0)).toBeCloseTo(0.25);
  });

  it('is symmetric in direction (over- and under-wide both register)', () => {
    expect(computeMismatchRatio(2.5, 2.0)).toBeCloseTo(0.25);
  });

  it('crosses the documented default large-mismatch threshold (0.35) for a big difference', () => {
    // A tall portrait artwork (0.7) against a wide landscape template (1.8) — should
    // clearly exceed the default LARGE_MISMATCH_RATIO used by composeMockup.
    expect(computeMismatchRatio(0.7, 1.8)).toBeGreaterThan(0.35);
  });
});
