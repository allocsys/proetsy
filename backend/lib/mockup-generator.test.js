import { describe, it, expect } from 'vitest';
import { computeMismatchRatio, shouldAttemptOutpaint, buildOutpaintPrompt } from './mockup-generator.js';

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

// See ARCHITECTURE.md -> Module 3 -> "AI-outpainting fallback" step 8. shouldAttemptOutpaint
// is the pure trigger decision extracted out of resolveArtworkVariants in this pass so it's
// testable without real image files or a network call.
describe('shouldAttemptOutpaint', () => {
  it('does not trigger outpainting for a mismatch below the threshold', () => {
    expect(shouldAttemptOutpaint(0.1, 0.35)).toBe(false);
  });

  it('triggers outpainting for a mismatch above the threshold', () => {
    expect(shouldAttemptOutpaint(0.5, 0.35)).toBe(true);
  });

  it('triggers at exactly the threshold (>= , not >)', () => {
    // Matches resolveArtworkVariants' documented behavior: "at/above it, AI outpainting is
    // attempted" (ARCHITECTURE.md -> Module 3 -> "Aspect-ratio mismatch handling").
    expect(shouldAttemptOutpaint(0.35, 0.35)).toBe(true);
  });

  it('defaults to the module-configured LARGE_MISMATCH_RATIO when no threshold is passed', () => {
    // No env override in the test environment, so this exercises the documented default
    // of 0.35 (see computeMismatchRatio's threshold-crossing test above).
    expect(shouldAttemptOutpaint(0.5)).toBe(true);
    expect(shouldAttemptOutpaint(0.1)).toBe(false);
  });
});

// See ARCHITECTURE.md -> Module 3 -> "AI-outpainting fallback" step 3 / step 8.
describe('buildOutpaintPrompt', () => {
  it('includes the exact target pixel dimensions', () => {
    const prompt = buildOutpaintPrompt(1200, 800);
    expect(prompt).toContain('1200x800');
  });

  it('includes the computed aspect ratio to 3 decimal places', () => {
    const prompt = buildOutpaintPrompt(1200, 800);
    expect(prompt).toContain((1200 / 800).toFixed(3));
  });

  it('instructs the model not to crop, shrink, warp, or recompose the original artwork', () => {
    const prompt = buildOutpaintPrompt(1000, 1000);
    expect(prompt).toMatch(/do not crop, shrink, warp, or recompose/);
  });

  it('produces a different prompt for different target dimensions', () => {
    expect(buildOutpaintPrompt(1000, 1000)).not.toBe(buildOutpaintPrompt(1200, 800));
  });
});
