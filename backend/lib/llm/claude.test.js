import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { generateText, generateVision, generateImage } from './claude.js';

// claude.js is an optional, disabled-by-default fallback (see ARCHITECTURE.md -> LLM
// Provider Layer -> "Fallback: Claude") — currently a stub pending a real implementation.
// These tests lock in its two real behaviors today: (1) it refuses to run at all without
// CLAUDE_API_KEY, matching "no silent fallback unless explicitly enabled", and (2) it has
// no image-generation capability, matching Module 3's Gemini-only AI-outpainting design.

const originalKey = process.env.CLAUDE_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.CLAUDE_API_KEY;
  else process.env.CLAUDE_API_KEY = originalKey;
});

describe('without CLAUDE_API_KEY configured', () => {
  beforeEach(() => {
    delete process.env.CLAUDE_API_KEY;
  });

  it('generateText refuses to run', async () => {
    await expect(generateText('a prompt')).rejects.toThrow(/Claude fallback is not configured/);
  });

  it('generateVision refuses to run', async () => {
    await expect(generateVision('describe this', '/tmp/whatever.png')).rejects.toThrow(
      /Claude fallback is not configured/
    );
  });
});

describe('with CLAUDE_API_KEY configured', () => {
  beforeEach(() => {
    process.env.CLAUDE_API_KEY = 'test-key';
  });

  it('generateText returns a stub response tagged with provider: claude', async () => {
    const result = await generateText('describe a sunset');
    expect(result.provider).toBe('claude');
    expect(result.text).toContain('describe a sunset');
  });

  it('generateVision returns a stub response referencing the image path', async () => {
    const result = await generateVision('what is this', '/tmp/art.png');
    expect(result.provider).toBe('claude');
    expect(result.text).toContain('/tmp/art.png');
  });
});

describe('generateImage (interface-symmetry stub only)', () => {
  it('always throws, regardless of CLAUDE_API_KEY, since Claude has no image-generation endpoint', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';
    await expect(generateImage('extend this canvas', '/tmp/art.png')).rejects.toThrow(
      /no image-generation fallback/i
    );

    delete process.env.CLAUDE_API_KEY;
    await expect(generateImage('extend this canvas', '/tmp/art.png')).rejects.toThrow(
      /no image-generation fallback/i
    );
  });
});
