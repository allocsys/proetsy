import { describe, it, expect, afterEach, vi } from 'vitest';

// claude.js is an optional, disabled-by-default fallback (see ARCHITECTURE.md -> LLM
// Provider Layer -> "Fallback: Claude") — currently a stub pending a real implementation.
// These tests lock in its two real behaviors today: (1) it refuses to run at all without
// a DB-backed Claude key, matching "no silent fallback unless explicitly enabled", and
// (2) it has no image-generation capability, matching Module 3's Gemini-only
// AI-outpainting design. key-store.js is mocked (rather than setting CLAUDE_API_KEY)
// since key-store.js no longer has any .env fallback — see plan.md Rollout step 5.

let getKeysForProvider;

async function freshClaude({ hasKey } = {}) {
  vi.resetModules();
  getKeysForProvider = vi.fn(() => (hasKey ? ['test-key'] : []));
  vi.doMock('./key-store.js', () => ({ getKeysForProvider }));
  return import('./claude.js');
}

afterEach(() => {
  vi.doUnmock('./key-store.js');
  vi.restoreAllMocks();
});

describe('without a Claude key configured', () => {
  it('generateText refuses to run', async () => {
    const { generateText } = await freshClaude({ hasKey: false });
    await expect(generateText('a prompt')).rejects.toThrow(/Claude fallback is not configured/);
  });

  it('generateVision refuses to run', async () => {
    const { generateVision } = await freshClaude({ hasKey: false });
    await expect(generateVision('describe this', '/tmp/whatever.png')).rejects.toThrow(
      /Claude fallback is not configured/
    );
  });
});

describe('with a Claude key configured', () => {
  it('generateText returns a stub response tagged with provider: claude', async () => {
    const { generateText } = await freshClaude({ hasKey: true });
    const result = await generateText('describe a sunset');
    expect(result.provider).toBe('claude');
    expect(result.text).toContain('describe a sunset');
  });

  it('generateVision returns a stub response referencing the image path', async () => {
    const { generateVision } = await freshClaude({ hasKey: true });
    const result = await generateVision('what is this', '/tmp/art.png');
    expect(result.provider).toBe('claude');
    expect(result.text).toContain('/tmp/art.png');
  });
});

// No generateImage tests here -- claude.js doesn't export generateImage at all.
// llm/index.js's generateImage() always calls gemini.js directly regardless of
// LLM_PROVIDER (see index.test.js's "generateImage (always Gemini...)" suite), so
// there's nothing Claude-specific to test for image generation.
