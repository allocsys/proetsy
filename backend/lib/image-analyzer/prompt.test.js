import { describe, it, expect } from 'vitest';
import { buildImageAnalysisPrompt } from './prompt.js';

// See ARCHITECTURE.md -> Module 1. buildImageAnalysisPrompt is a pure function (no DB,
// no network, no image argument — the image is attached separately by generateVision())
// so it's directly unit-testable.

describe('buildImageAnalysisPrompt', () => {
  it('instructs the model to return only valid JSON with no markdown fences', () => {
    const prompt = buildImageAnalysisPrompt();
    expect(prompt).toMatch(/only valid json/i);
    expect(prompt).toMatch(/no markdown code fences/i);
  });

  it('asks for plain, searchable language for tag-matching', () => {
    const prompt = buildImageAnalysisPrompt();
    expect(prompt).toMatch(/substring search/i);
  });

  it('specifies every expected output field', () => {
    const prompt = buildImageAnalysisPrompt();
    for (const field of ['subject', 'style', 'palette', 'mood', 'themes', 'notable_elements', 'suggested_categories']) {
      expect(prompt).toContain(`"${field}"`);
    }
  });

  it('returns the same prompt on every call (no hidden randomness/state)', () => {
    expect(buildImageAnalysisPrompt()).toBe(buildImageAnalysisPrompt());
  });
});
