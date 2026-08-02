import { describe, it, expect } from 'vitest';
import { getPipelineConfig, getProductSizes, getTrendsSeed } from './index.js';

describe('getPipelineConfig', () => {
  it('returns the pipeline array with the required listing_generator entry', () => {
    const { pipeline } = getPipelineConfig();
    expect(Array.isArray(pipeline)).toBe(true);

    const listingGenerator = pipeline.find((m) => m.module === 'listing_generator');
    expect(listingGenerator).toBeDefined();
    expect(listingGenerator.required).toBe(true);
    expect(listingGenerator.enabled).toBe(true);
  });

  it('returns a fresh object each call (no shared-reference mutation risk)', () => {
    const first = getPipelineConfig();
    first.pipeline.push({ module: 'not_real', enabled: true });
    const second = getPipelineConfig();

    expect(second.pipeline.some((m) => m.module === 'not_real')).toBe(false);
  });
});

describe('getProductSizes', () => {
  it('returns an object keyed by size_key with dimensions/dpi/mockup_template', () => {
    const sizes = getProductSizes();
    expect(typeof sizes).toBe('object');
    expect(Object.keys(sizes).length).toBeGreaterThan(0);

    for (const [key, entry] of Object.entries(sizes)) {
      expect(typeof key).toBe('string');
      expect(entry).toHaveProperty('dimensions');
      expect(entry).toHaveProperty('dpi');
      expect(entry).toHaveProperty('mockup_template');
    }
  });
});

describe('getTrendsSeed', () => {
  it('parses without throwing and returns valid JSON', () => {
    expect(() => getTrendsSeed()).not.toThrow();
    const seed = getTrendsSeed();
    expect(seed).toBeDefined();
  });
});
