import { describe, it, expect, afterEach, vi } from 'vitest';

// trends/index.js reads process.env.TRENDS_PROVIDER at CALL time (inside
// getActiveProvider()), not at import time — same as llm/index.js's own
// getActiveProvider() (see llm/index.test.js's own note on this) — so, same as that
// file, no module-reset dance is needed here: one import, mock the two concrete
// providers, flip the env var between assertions.
vi.mock('./manual.js', () => ({
  getTrends: vi.fn(async () => [{ term: 'manual trend', source: 'manual' }]),
}));
vi.mock('./etsy-api.js', () => ({
  getTrends: vi.fn(async () => [{ term: 'etsy-api trend', source: 'etsy_api' }]),
}));

let getTrends;
let manual;
let etsyApi;

beforeAll(async () => {
  ({ getTrends } = await import('./index.js'));
  manual = await import('./manual.js');
  etsyApi = await import('./etsy-api.js');
});

afterEach(() => {
  delete process.env.TRENDS_PROVIDER;
  vi.clearAllMocks();
});

describe('getActiveProvider selection', () => {
  it('defaults to manual when TRENDS_PROVIDER is unset', async () => {
    const result = await getTrends('wall-art');
    expect(result).toEqual([{ term: 'manual trend', source: 'manual' }]);
    expect(manual.getTrends).toHaveBeenCalledWith('wall-art');
    expect(etsyApi.getTrends).not.toHaveBeenCalled();
  });

  it('routes to etsy-api when TRENDS_PROVIDER=etsy_api', async () => {
    process.env.TRENDS_PROVIDER = 'etsy_api';
    const result = await getTrends('wall-art');
    expect(result).toEqual([{ term: 'etsy-api trend', source: 'etsy_api' }]);
    expect(etsyApi.getTrends).toHaveBeenCalledWith('wall-art');
    expect(manual.getTrends).not.toHaveBeenCalled();
  });

  it('falls back to manual for an unrecognized TRENDS_PROVIDER value', async () => {
    process.env.TRENDS_PROVIDER = 'etsy-scraper';
    const result = await getTrends();
    expect(result).toEqual([{ term: 'manual trend', source: 'manual' }]);
    expect(manual.getTrends).toHaveBeenCalled();
  });

  it('passes an undefined category straight through when called with none', async () => {
    await getTrends();
    expect(manual.getTrends).toHaveBeenCalledWith(undefined);
  });
});
