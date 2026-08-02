import { describe, it, expect } from 'vitest';
import { extractPromptTerms } from './prompt-terms.js';

describe('extractPromptTerms (Module 7 -> Module 4 prompt-feedback link, write side)', () => {
  it('extracts lowercase content terms and drops Midjourney flags and their arguments', () => {
    const terms = extractPromptTerms('A Fox in a Snowy Field --v 7 --style raw --ar 2:3 --s 100');
    expect(terms).toEqual(new Set(['fox', 'snowy', 'field']));
    expect(terms.has('raw')).toBe(false); // flag argument, not free text
    expect(terms.has('100')).toBe(false);
    expect(terms.has('2:3')).toBe(false);
  });

  it('drops stopwords and bare numbers, keeps hyphenated/short-but-meaningful words', () => {
    const terms = extractPromptTerms('a fox with fire-lit fur and 3 kits --ar 1:1');
    expect(terms.has('with')).toBe(false);
    expect(terms.has('and')).toBe(false);
    expect(terms.has('3')).toBe(false);
    expect(terms.has('fire-lit')).toBe(true);
    expect(terms.has('fur')).toBe(true);
    expect(terms.has('kits')).toBe(true);
  });

  it('deduplicates a term that appears more than once in the same prompt', () => {
    const terms = extractPromptTerms('fox fox fox in a snowy snowy field');
    expect(Array.from(terms).filter((t) => t === 'fox')).toHaveLength(1);
    expect(Array.from(terms).filter((t) => t === 'snowy')).toHaveLength(1);
  });

  it('handles an unrecognized flag by treating its "value" as ordinary text (not consumed)', () => {
    // Unlike a known MJ flag, an unrecognized "--foo" flag itself is still dropped (it
    // starts with "--"), but the token after it is NOT skipped as an argument, since we
    // don't know whether that flag takes one — safer to keep it as a possible content
    // word than to silently swallow real prompt text.
    const terms = extractPromptTerms('a fox --foo bar');
    expect(terms.has('bar')).toBe(true);
  });

  it('returns an empty set for empty/missing input', () => {
    expect(extractPromptTerms('').size).toBe(0);
    expect(extractPromptTerms(undefined).size).toBe(0);
  });
});
