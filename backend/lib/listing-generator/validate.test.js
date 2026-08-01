import { describe, it, expect } from 'vitest';
import { enforceConventions } from './validate.js';
import { SHOP_CONVENTIONS } from '../../config/shop-conventions.js';

// See ARCHITECTURE.md -> Module 2 -> "Must hardcode shop conventions". enforceConventions
// is the belt-and-braces backstop applied both at generation time and (as of the PATCH
// route added alongside these tests) on manual edits — these tests exercise it directly,
// independent of the LLM call.

function baseVariation(overrides = {}) {
  return {
    angle: 'fine_art',
    title: 'Abstract Sunset Print | Modern Wall Art',
    description: 'A vibrant abstract print for any room.',
    tags: Array.from({ length: SHOP_CONVENTIONS.tagsPerListing }, (_, i) => `tag${i}`),
    tag_alternates: Array.from({ length: SHOP_CONVENTIONS.tagAlternates }, (_, i) => `alt${i}`),
    ...overrides,
  };
}

describe('enforceConventions — titles', () => {
  it('strips forbidden framing words from the title and warns', () => {
    const result = enforceConventions(baseVariation({ title: 'Framed Sunset Print' }));
    expect(result.title.toLowerCase()).not.toContain('framed');
    expect(result.warnings.some((w) => w.includes('frame'))).toBe(true);
  });

  it('truncates an over-length title and warns', () => {
    const longTitle = 'A'.repeat(SHOP_CONVENTIONS.maxTitleLength + 20);
    const result = enforceConventions(baseVariation({ title: longTitle }));
    expect(result.title.length).toBeLessThanOrEqual(SHOP_CONVENTIONS.maxTitleLength);
    expect(result.warnings.some((w) => w.includes('truncated'))).toBe(true);
  });

  it('leaves a compliant title untouched with no warnings about it', () => {
    const result = enforceConventions(baseVariation());
    expect(result.title).toBe('Abstract Sunset Print | Modern Wall Art');
    expect(result.warnings.some((w) => w.includes('truncated') || w.includes('frame'))).toBe(false);
  });
});

describe('enforceConventions — descriptions', () => {
  it('strips AI-disclosure phrases and warns', () => {
    const result = enforceConventions(
      baseVariation({ description: 'This piece was AI generated for your home.' })
    );
    expect(result.description.toLowerCase()).not.toContain('ai generated');
    expect(result.warnings.some((w) => w.includes('AI-disclosure'))).toBe(true);
  });

  it('strips delivery-detail phrases and warns', () => {
    const result = enforceConventions(
      baseVariation({ description: 'Beautiful print. Ships in 3-5 business days.' })
    );
    expect(result.description.toLowerCase()).not.toContain('ships in');
    expect(result.warnings.some((w) => w.includes('delivery-detail'))).toBe(true);
  });

  it('leaves a clean description untouched with no warnings about it', () => {
    const result = enforceConventions(baseVariation());
    expect(result.description).toBe('A vibrant abstract print for any room.');
    expect(result.warnings).toHaveLength(0);
  });
});

describe('enforceConventions — tags', () => {
  it('drops tags over the max length and warns', () => {
    const oversized = 'x'.repeat(SHOP_CONVENTIONS.maxTagLength + 5);
    const tags = [oversized, ...Array.from({ length: SHOP_CONVENTIONS.tagsPerListing }, (_, i) => `ok${i}`)];
    const result = enforceConventions(baseVariation({ tags }));
    expect(result.tags).not.toContain(oversized);
    expect(result.warnings.some((w) => w.includes('Dropped'))).toBe(true);
  });

  it('caps tags at tagsPerListing even if more are provided', () => {
    const tooMany = Array.from({ length: SHOP_CONVENTIONS.tagsPerListing + 10 }, (_, i) => `tag${i}`);
    const result = enforceConventions(baseVariation({ tags: tooMany }));
    expect(result.tags).toHaveLength(SHOP_CONVENTIONS.tagsPerListing);
  });

  it('warns when fewer tags remain than tagsPerListing after filtering', () => {
    const tooFew = ['tag0', 'tag1'];
    const result = enforceConventions(baseVariation({ tags: tooFew }));
    expect(result.warnings.some((w) => w.includes('needs manual review'))).toBe(true);
  });

  it('caps tag_alternates at the configured count', () => {
    const tooMany = Array.from({ length: SHOP_CONVENTIONS.tagAlternates + 10 }, (_, i) => `alt${i}`);
    const result = enforceConventions(baseVariation({ tag_alternates: tooMany }));
    expect(result.tagAlternates).toHaveLength(SHOP_CONVENTIONS.tagAlternates);
  });

  it('ignores non-string entries in tags rather than throwing', () => {
    const tags = [null, 42, 'valid-tag', ...Array.from({ length: SHOP_CONVENTIONS.tagsPerListing }, (_, i) => `tag${i}`)];
    expect(() => enforceConventions(baseVariation({ tags }))).not.toThrow();
  });
});

describe('enforceConventions — general shape', () => {
  it('preserves the angle unchanged', () => {
    const result = enforceConventions(baseVariation({ angle: 'gift' }));
    expect(result.angle).toBe('gift');
  });

  it('defaults tags/tag_alternates to empty arrays when missing entirely', () => {
    const result = enforceConventions({ angle: 'fine_art', title: 'T', description: 'D' });
    expect(result.tags).toEqual([]);
    expect(result.tagAlternates).toEqual([]);
  });
});
