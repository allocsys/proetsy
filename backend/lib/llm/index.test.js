import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

// llm/index.js reads process.env.LLM_PROVIDER at CALL time (inside getActiveProvider()),
// not at import time — unlike gemini.js's key/model config, so no module-reset dance is
// needed here: one import, mock the three concrete providers, and flip the env var
// between assertions.
vi.mock('./gemini.js', () => ({
  generateText: vi.fn(async () => ({ text: 'gemini text', provider: 'gemini' })),
  generateVision: vi.fn(async () => ({ text: 'gemini vision', provider: 'gemini' })),
  generateImage: vi.fn(async () => ({ data: 'gemini image', provider: 'gemini' })),
}));
vi.mock('./claude.js', () => ({
  generateText: vi.fn(async () => ({ text: 'claude text', provider: 'claude' })),
  generateVision: vi.fn(async () => ({ text: 'claude vision', provider: 'claude' })),
  generateImage: vi.fn(async () => {
    throw new Error('Claude has no image-generation fallback.');
  }),
}));
vi.mock('./fixture.js', () => ({
  generateText: vi.fn(async () => ({ text: 'fixture text', provider: 'fixture' })),
  generateVision: vi.fn(async () => ({ text: 'fixture vision', provider: 'fixture' })),
  generateImage: vi.fn(async () => ({ data: 'fixture image', provider: 'fixture' })),
}));

let generateText;
let generateVision;
let generateImage;
let gemini;
let claude;
let fixture;

beforeAll(async () => {
  ({ generateText, generateVision, generateImage } = await import('./index.js'));
  gemini = await import('./gemini.js');
  claude = await import('./claude.js');
  fixture = await import('./fixture.js');
});

afterEach(() => {
  delete process.env.LLM_PROVIDER;
});

describe('getActiveProvider selection', () => {
  it('defaults to gemini when LLM_PROVIDER is unset', async () => {
    const result = await generateText('a prompt');
    expect(result.provider).toBe('gemini');
    expect(gemini.generateText).toHaveBeenCalledWith('a prompt', {});
  });

  it('routes to claude when LLM_PROVIDER=claude', async () => {
    process.env.LLM_PROVIDER = 'claude';
    const result = await generateText('a prompt');
    expect(result.provider).toBe('claude');
    expect(claude.generateText).toHaveBeenCalled();
  });

  it('routes to fixture when LLM_PROVIDER=fixture (used by the Playwright E2E suite)', async () => {
    process.env.LLM_PROVIDER = 'fixture';
    const result = await generateText('a prompt');
    expect(result.provider).toBe('fixture');
    expect(fixture.generateText).toHaveBeenCalled();
  });

  it('falls back to gemini for an unrecognized LLM_PROVIDER value', async () => {
    process.env.LLM_PROVIDER = 'some-typo';
    const result = await generateText('a prompt');
    expect(result.provider).toBe('gemini');
  });

  it('generateVision follows the same provider switch as generateText', async () => {
    process.env.LLM_PROVIDER = 'claude';
    const result = await generateVision('describe this', '/tmp/art.png');
    expect(result.provider).toBe('claude');
    expect(claude.generateVision).toHaveBeenCalledWith('describe this', '/tmp/art.png', {});
  });
});

describe('generateImage (always Gemini, regardless of LLM_PROVIDER)', () => {
  it('calls gemini.generateImage even when LLM_PROVIDER=claude is set for text/vision', async () => {
    process.env.LLM_PROVIDER = 'claude';
    const result = await generateImage('extend this canvas', '/tmp/art.png');
    expect(result.provider).toBe('gemini');
    expect(gemini.generateImage).toHaveBeenCalledWith('extend this canvas', '/tmp/art.png', {});
    expect(claude.generateImage).not.toHaveBeenCalled();
  });

  it('calls gemini.generateImage even when LLM_PROVIDER=fixture', async () => {
    process.env.LLM_PROVIDER = 'fixture';
    const result = await generateImage('extend this canvas', '/tmp/art.png');
    expect(result.provider).toBe('gemini');
    expect(fixture.generateImage).not.toHaveBeenCalled();
  });
});
