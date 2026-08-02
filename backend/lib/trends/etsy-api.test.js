import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTrends } from './etsy-api.js';

describe('trends/etsy-api getTrends (ARCHITECTURE.md -> Trends Provider Layer)', () => {
  const originalKey = process.env.ETSY_API_KEY;

  beforeEach(() => {
    delete process.env.ETSY_API_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ETSY_API_KEY;
    else process.env.ETSY_API_KEY = originalKey;
  });

  it('throws a clear, actionable error when ETSY_API_KEY is not configured', async () => {
    await expect(getTrends('cottagecore')).rejects.toThrow(/ETSY_API_KEY/);
  });

  it('does not throw once a key is present (implementation is still a stub returning [])', async () => {
    process.env.ETSY_API_KEY = 'fake-key-for-test';
    await expect(getTrends('cottagecore')).resolves.toEqual([]);
  });
});
