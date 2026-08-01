import { describe, it, expect } from 'vitest';
import { buildListingPrompt } from './prompt.js';
import { SHOP_CONVENTIONS, LISTING_VARIATIONS } from '../../config/shop-conventions.js';

// See ARCHITECTURE.md -> Module 2. buildListingPrompt is a pure function (no DB, no
// network) so it's directly unit-testable — these tests check the prompt adapts to which
// optional inputs are present, and that the hardcoded shop conventions always show up.

const baseArgs = {
  imageAnalysis: { subject: 'mountain lake', style: 'watercolor', palette: ['blue', 'green'], mood: 'calm' },
  manualNotes: null,
  trend: null,
  tagCandidates: [],
  availableSizes: [],
};

describe('buildListingPrompt — Module 1 input', () => {
  it('includes the image analysis JSON when present', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain('mountain lake');
    expect(prompt).toContain('watercolor');
  });

  it('falls back to manual notes and flags Module 1 as skipped when no image analysis', () => {
    const prompt = buildListingPrompt({ ...baseArgs, imageAnalysis: null, manualNotes: 'a cozy cabin scene' });
    expect(prompt).toContain('Module 1 (Image Analyzer) was skipped');
    expect(prompt).toContain('a cozy cabin scene');
  });

  it('notes when neither image analysis nor manual notes are provided', () => {
    const prompt = buildListingPrompt({ ...baseArgs, imageAnalysis: null, manualNotes: null });
    expect(prompt).toContain('(none provided)');
  });
});

describe('buildListingPrompt — trend', () => {
  it('includes the selected trend term and category', () => {
    const prompt = buildListingPrompt({ ...baseArgs, trend: { term: 'cottagecore', category: 'home decor' } });
    expect(prompt).toContain('cottagecore');
    expect(prompt).toContain('home decor');
  });

  it('tells the model to write generally when no trend is selected', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain('No specific trend selected');
  });
});

describe('buildListingPrompt — tags', () => {
  it('lists candidate tags and instructs the model not to invent new ones', () => {
    const prompt = buildListingPrompt({
      ...baseArgs,
      tagCandidates: [{ tag_text: 'wall art' }, { tag_text: 'boho decor' }],
    });
    expect(prompt).toContain('wall art');
    expect(prompt).toContain('boho decor');
    expect(prompt).toContain('do not invent new ones');
  });

  it('tells the model to return empty tag arrays when no candidates match', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain('return empty tag arrays');
  });
});

describe('buildListingPrompt — product sizes', () => {
  it('lists only the configured sizes and warns against mentioning others', () => {
    const prompt = buildListingPrompt({
      ...baseArgs,
      availableSizes: [{ size_key: '8x10-portrait', dimensions: '8x10', orientation: 'portrait' }],
    });
    expect(prompt).toContain('8x10-portrait');
    expect(prompt).toContain('never mention a size not listed here');
  });

  it('instructs the model not to mention any size when none are configured', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain('do not mention any specific size');
  });
});

describe('buildListingPrompt — hardcoded shop conventions always present', () => {
  it('requires exactly the configured number of variations, one per angle', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain(`exactly ${LISTING_VARIATIONS.length} listing variations`);
    for (const angle of LISTING_VARIATIONS) {
      expect(prompt).toContain(angle);
    }
  });

  it('states the max title length and separator', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain(String(SHOP_CONVENTIONS.maxTitleLength));
    expect(prompt).toContain(SHOP_CONVENTIONS.titleSeparator);
  });

  it('forbids framing/frame mentions and AI disclosure and delivery timing', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toMatch(/never mention frames or framing/i);
    expect(prompt).toMatch(/never disclose.*ai-generated/i);
    expect(prompt).toMatch(/never include delivery or shipping timing/i);
  });

  it('states the exact tag and tag_alternates counts', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toContain(String(SHOP_CONVENTIONS.tagsPerListing));
    expect(prompt).toContain(String(SHOP_CONVENTIONS.tagAlternates));
  });

  it('instructs the model to return only valid JSON with no markdown fences', () => {
    const prompt = buildListingPrompt(baseArgs);
    expect(prompt).toMatch(/only valid json/i);
    expect(prompt).toMatch(/no markdown code fences/i);
  });
});
