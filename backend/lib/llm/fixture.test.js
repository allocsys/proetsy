import { describe, it, expect } from 'vitest';
import { generateText, generateVision, generateImage } from './fixture.js';
import { LISTING_VARIATIONS, SHOP_CONVENTIONS } from '../../config/shop-conventions.js';
import { enforceConventions } from '../listing-generator/validate.js';
import { enforceMidjourneyConventions } from '../prompt-helper/validate.js';

// fixture.js (LLM_PROVIDER=fixture) is currently only exercised two ways: mocked-out
// entirely in llm/index.test.js (which never touches this file's own logic), and for
// real but indirectly through the full Playwright critical-path E2E run (slow, and a
// broken fixture output would surface as an opaque E2E failure rather than a clear unit
// test failure pointing at this file). These tests fill that gap at the unit level --
// importantly, several of them run the fixture's real output through the SAME
// downstream validators (enforceConventions, enforceMidjourneyConventions) Module 2/4
// actually use, so a future SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS change that quietly
// breaks the fixture's own compliance fails here, not only in a slower E2E run.

describe('generateText — listing-generator shape (prompt contains "variations")', () => {
  const listingPrompt = 'Return JSON with a "variations" array, one per angle...';

  it('returns a JSON string with one variation per LISTING_VARIATIONS angle', async () => {
    const result = await generateText(listingPrompt);
    expect(result.provider).toBe('fixture');
    expect(result.model).toBe('fixture');

    const parsed = JSON.parse(result.text);
    expect(Array.isArray(parsed.variations)).toBe(true);
    expect(parsed.variations.map((v) => v.angle).sort()).toEqual([...LISTING_VARIATIONS].sort());
  });

  it('gives every variation exactly the tag/tag_alternate counts Module 2 expects', async () => {
    const result = await generateText(listingPrompt);
    const { variations } = JSON.parse(result.text);

    for (const v of variations) {
      expect(v.tags).toHaveLength(SHOP_CONVENTIONS.tagsPerListing);
      expect(v.tag_alternates).toHaveLength(SHOP_CONVENTIONS.tagAlternates);
      expect(typeof v.title).toBe('string');
      expect(typeof v.description).toBe('string');
    }
  });

  it('produces output that passes enforceConventions() with no warnings', async () => {
    // The real backstop listing-generator/index.js runs every variation through — if the
    // fixture's own title/tags/description ever drifted out of shop-convention compliance
    // (e.g. SHOP_CONVENTIONS.maxTagLength shrinks below what fixture tags need), this is
    // where that would be caught, not silently in an E2E run.
    const result = await generateText(listingPrompt);
    const { variations } = JSON.parse(result.text);

    for (const v of variations) {
      const cleaned = enforceConventions(v);
      expect(cleaned.warnings).toEqual([]);
      expect(cleaned.title).toBe(v.title);
      expect(cleaned.tags).toEqual(v.tags);
      expect(cleaned.tagAlternates).toEqual(v.tag_alternates);
    }
  });
});

describe('generateText — prompt-helper shape (prompt has no "variations")', () => {
  it('returns plain Midjourney-formatted text, not JSON', async () => {
    const result = await generateText('Write a Midjourney prompt for a square category.');
    expect(result.provider).toBe('fixture');
    expect(() => JSON.parse(result.text)).toThrow();
    expect(result.text).toContain('--v 7');
  });

  it('already satisfies enforceMidjourneyConventions() with no added/clamped flags', async () => {
    const result = await generateText('Write a Midjourney prompt for a square category.');
    const { text, warnings } = enforceMidjourneyConventions(result.text, 'square');

    expect(warnings).toEqual([]);
    expect(text).toBe(result.text);
  });
});

describe('generateVision — image-analyzer shape', () => {
  it('returns JSON with the non-empty subject/style fields Module 1 requires', async () => {
    const result = await generateVision('describe this artwork', '/tmp/whatever.png');
    expect(result.provider).toBe('fixture');

    const parsed = JSON.parse(result.text);
    expect(typeof parsed.subject).toBe('string');
    expect(parsed.subject.trim().length).toBeGreaterThan(0);
    expect(typeof parsed.style).toBe('string');
    expect(parsed.style.trim().length).toBeGreaterThan(0);
  });

  it('ignores its arguments — same fixed output regardless of prompt/imagePath', async () => {
    const a = await generateVision('prompt A', '/tmp/a.png');
    const b = await generateVision('prompt B', '/tmp/b.png');
    expect(a.text).toBe(b.text);
  });
});

describe('generateImage — deliberately unimplemented', () => {
  it('throws a clear, specific error rather than returning fake image data', async () => {
    await expect(generateImage()).rejects.toThrow(/not implemented in the fixture LLM provider/);
  });
});
