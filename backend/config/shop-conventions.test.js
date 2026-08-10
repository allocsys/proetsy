import { describe, it, expect } from 'vitest';
import { LISTING_VARIATIONS, SHOP_CONVENTIONS, MIDJOURNEY_CONVENTIONS } from './shop-conventions.js';

// This file had no test of its own until now. listing-generator/validate.test.js and
// prompt-helper/validate.test.js exercise the *enforcement logic* in validate.js, but
// they read SHOP_CONVENTIONS/MIDJOURNEY_CONVENTIONS dynamically (e.g.
// `SHOP_CONVENTIONS.maxTitleLength + 20` for an over-length title) — so those suites
// would still pass unchanged even if someone silently edited maxTitleLength from 140 to,
// say, 500. These are hardcoded *business* values (see ARCHITECTURE.md -> Module 2 ->
// "Must hardcode shop conventions" and -> Module 4 -> its Midjourney conventions list),
// not implementation details, so this suite pins the literal documented values directly
// — a change here should require a deliberate edit to this test, not slip through only
// because validate.js's own tests happened to reference `SHOP_CONVENTIONS.x` instead of
// a literal.

describe('LISTING_VARIATIONS', () => {
  it('matches the three documented listing angles, in order', () => {
    expect(LISTING_VARIATIONS).toEqual(['fine_art', 'aesthetic', 'gift']);
  });
});

describe('SHOP_CONVENTIONS', () => {
  it('matches ARCHITECTURE.md -> Module 2 -> "Must hardcode shop conventions"', () => {
    expect(SHOP_CONVENTIONS.titleSeparator).toBe('|');
    expect(SHOP_CONVENTIONS.maxTitleLength).toBe(140);
    expect(SHOP_CONVENTIONS.tagsPerListing).toBe(13);
    expect(SHOP_CONVENTIONS.tagAlternates).toBe(5);
    expect(SHOP_CONVENTIONS.maxTagLength).toBe(20);
  });

  it('forbids frame/framed/frames in titles (no frames mentioned in titles)', () => {
    expect(SHOP_CONVENTIONS.forbiddenTitleWords).toEqual(['frame', 'framed', 'frames']);
  });

  it('flags the documented AI-disclosure phrasings (no AI disclosure in descriptions)', () => {
    expect(SHOP_CONVENTIONS.aiDisclosurePhrases).toEqual(
      expect.arrayContaining(['ai generated', 'ai-generated', 'made with ai', 'artificial intelligence'])
    );
  });

  it('flags the documented delivery-detail phrasings (no delivery details in descriptions)', () => {
    expect(SHOP_CONVENTIONS.deliveryDetailPhrases).toEqual(
      expect.arrayContaining(['ships in', 'business days', 'delivery time'])
    );
  });

  it('is frozen so a module can\'t accidentally mutate the shared conventions object', () => {
    expect(Object.isFrozen(SHOP_CONVENTIONS)).toBe(true);
    expect(() => {
      'use strict';
      SHOP_CONVENTIONS.maxTitleLength = 999;
    }).toThrow();
    expect(SHOP_CONVENTIONS.maxTitleLength).toBe(140);
  });
});

describe('MIDJOURNEY_CONVENTIONS', () => {
  it('matches ARCHITECTURE.md -> Module 4 -> "--v 7, --style raw, aspect ratio per category, --s 50–150"', () => {
    expect(MIDJOURNEY_CONVENTIONS.version).toBe('--v 7');
    expect(MIDJOURNEY_CONVENTIONS.style).toBe('--style raw');
    expect(MIDJOURNEY_CONVENTIONS.stylizeMin).toBe(50);
    expect(MIDJOURNEY_CONVENTIONS.stylizeMax).toBe(150);
    expect(MIDJOURNEY_CONVENTIONS.defaultStylize).toBe(100);
  });

  it('maps the three documented orientations to their --ar values', () => {
    expect(MIDJOURNEY_CONVENTIONS.aspectRatioByOrientation).toEqual({
      portrait: '2:3',
      landscape: '3:2',
      square: '1:1',
    });
  });

  it('keeps defaultStylize inside [stylizeMin, stylizeMax]', () => {
    expect(MIDJOURNEY_CONVENTIONS.defaultStylize).toBeGreaterThanOrEqual(MIDJOURNEY_CONVENTIONS.stylizeMin);
    expect(MIDJOURNEY_CONVENTIONS.defaultStylize).toBeLessThanOrEqual(MIDJOURNEY_CONVENTIONS.stylizeMax);
  });

  it('is frozen, including the nested aspectRatioByOrientation map', () => {
    expect(Object.isFrozen(MIDJOURNEY_CONVENTIONS)).toBe(true);
    expect(Object.isFrozen(MIDJOURNEY_CONVENTIONS.aspectRatioByOrientation)).toBe(true);
  });
});
