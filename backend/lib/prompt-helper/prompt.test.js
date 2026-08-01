import { describe, it, expect } from 'vitest';
import { buildPromptHelperPrompt, PROMPT_COUNT } from './prompt.js';

const TREND = { term: 'cottagecore botanical', category: 'home decor' };

describe('buildPromptHelperPrompt', () => {
  it('includes the target category', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(prompt).toContain('"square"');
  });

  it('includes the selected trend term and its own category when a trend is given', () => {
    const prompt = buildPromptHelperPrompt({ trend: TREND, category: 'portrait' });
    expect(prompt).toContain('cottagecore botanical');
    expect(prompt).toContain('home decor');
  });

  it('falls back to a trend-less instruction when no trend is selected', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'landscape' });
    expect(prompt).toMatch(/no specific trend/i);
    expect(prompt).not.toContain('cottagecore');
  });

  it('includes the correct --ar value for a recognized category', () => {
    expect(buildPromptHelperPrompt({ trend: null, category: 'portrait' })).toContain('--ar 2:3');
    expect(buildPromptHelperPrompt({ trend: null, category: 'landscape' })).toContain('--ar 3:2');
    expect(buildPromptHelperPrompt({ trend: null, category: 'square' })).toContain('--ar 1:1');
  });

  it('omits an --ar instruction for an unrecognized category rather than guessing one', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'panoramic' });
    expect(prompt).not.toMatch(/--ar \d+:\d+/);
  });

  it('always instructs --v 7 and --style raw regardless of category', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(prompt).toContain('--v 7');
    expect(prompt).toContain('--style raw');
  });

  it('instructs a --s value within the shop stylize range', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(prompt).toMatch(/between 50 and 150/);
  });

  it('requests exactly PROMPT_COUNT distinct variations', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(prompt).toContain(`Generate exactly ${PROMPT_COUNT} distinct prompt variations`);
  });

  it('requests the documented JSON shape', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(prompt).toContain('"prompts"');
  });

  it('includes an opt-in style-hints line only when hints are provided', () => {
    const withHints = buildPromptHelperPrompt({ trend: null, category: 'square', styleHints: ['moody lighting', 'gold leaf'] });
    expect(withHints).toContain('moody lighting');
    expect(withHints).toContain('gold leaf');

    const withoutHints = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(withoutHints).not.toMatch(/style hint/i);
  });

  it('frames style hints as non-overriding, per the Module 7 feedback-link design', () => {
    const prompt = buildPromptHelperPrompt({ trend: TREND, category: 'square', styleHints: ['warm tones'] });
    expect(prompt).toMatch(/do not.*override/i);
  });

  it('never mentions AI or Midjourney in the descriptive-text instruction', () => {
    const prompt = buildPromptHelperPrompt({ trend: null, category: 'square' });
    expect(prompt).toMatch(/do not mention midjourney, ai, or "generated"/i);
  });
});
