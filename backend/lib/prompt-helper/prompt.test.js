import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// buildPromptHelperPrompt now reads the shop's *current* Midjourney conventions via
// config/index.js's getShopConventions().midjourney (dashboard-editable, backed by the
// `settings` DB table — see plan.md). DB_PATH must be set BEFORE prompt.js (which
// transitively imports db/init.js via config/index.js) is first imported — same
// env-var-before-import pattern as config/index.test.js. PROMPT_COUNT is a plain export
// (no DB dependency), so it's fine to still import it up front.
let buildPromptHelperPrompt;
let PROMPT_COUNT;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-prompt-helper-prompt-test-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ buildPromptHelperPrompt, PROMPT_COUNT } = await import('./prompt.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const TREND = { term: 'cottagecore botanical', category: 'home decor' };

describe('buildPromptHelperPrompt', () => {
  it('includes the target orientation', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(prompt).toContain('"square"');
  });

  it('includes the selected trend term and its own category when a trend is given', () => {
    const prompt = buildPromptHelperPrompt({ trend: TREND, orientation: 'portrait' });
    expect(prompt).toContain('cottagecore botanical');
    expect(prompt).toContain('home decor');
  });

  it('falls back to a trend-less instruction when no trend is selected', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'landscape' });
    expect(prompt).toMatch(/no specific trend/i);
    expect(prompt).not.toContain('cottagecore');
  });

  it('includes the correct --ar value for a recognized orientation', () => {
    expect(buildPromptHelperPrompt({ trend: null, orientation: 'portrait' })).toContain('--ar 2:3');
    expect(buildPromptHelperPrompt({ trend: null, orientation: 'landscape' })).toContain('--ar 3:2');
    expect(buildPromptHelperPrompt({ trend: null, orientation: 'square' })).toContain('--ar 1:1');
  });

  it('omits an --ar instruction for an unrecognized orientation rather than guessing one', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'panoramic' });
    expect(prompt).not.toMatch(/--ar \d+:\d+/);
  });

  it('always instructs --v 7 and --style raw regardless of orientation', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(prompt).toContain('--v 7');
    expect(prompt).toContain('--style raw');
  });

  it('instructs a --s value within the shop stylize range', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(prompt).toMatch(/between 50 and 150/);
  });

  it('requests exactly PROMPT_COUNT distinct variations', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(prompt).toContain(`Generate exactly ${PROMPT_COUNT} distinct prompt variations`);
  });

  it('requests the documented JSON shape', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(prompt).toContain('"prompts"');
  });

  it('includes an opt-in style-hints line only when hints are provided', () => {
    const withHints = buildPromptHelperPrompt({ trend: null, orientation: 'square', styleHints: ['moody lighting', 'gold leaf'] });
    expect(withHints).toContain('moody lighting');
    expect(withHints).toContain('gold leaf');

    const withoutHints = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(withoutHints).not.toMatch(/style hint/i);
  });

  it('frames style hints as non-overriding, per the Module 7 feedback-link design', () => {
    const prompt = buildPromptHelperPrompt({ trend: TREND, orientation: 'square', styleHints: ['warm tones'] });
    expect(prompt).toMatch(/do not.*override/i);
  });

  it('never mentions AI or Midjourney in the descriptive-text instruction', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, orientation: 'square' });
    expect(prompt).toMatch(/do not mention midjourney, ai, or "generated"/i);
  });
});
