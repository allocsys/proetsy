import { describe, it, expect } from 'vitest';
import { parseCsv, firstColumn } from './csv.js';

describe('parseCsv', () => {
  it('parses a simple header + rows CSV into lowercased-key row objects', () => {
    const rows = parseCsv('term,category\nwatercolor,art\nboho,decor');
    expect(rows).toEqual([
      { term: 'watercolor', category: 'art' },
      { term: 'boho', category: 'decor' },
    ]);
  });

  it('lowercases header names but not cell values', () => {
    const rows = parseCsv('Term,Category\nWatercolor,Art');
    expect(rows).toEqual([{ term: 'Watercolor', category: 'Art' }]);
  });

  it('handles a quoted field containing a comma', () => {
    const rows = parseCsv('term,category\n"cottage, core",aesthetic');
    expect(rows).toEqual([{ term: 'cottage, core', category: 'aesthetic' }]);
  });

  it('handles an escaped double-quote inside a quoted field', () => {
    const rows = parseCsv('term,category\n"artist\'s ""choice""",gift');
    expect(rows[0].term).toBe('artist\'s "choice"');
  });

  it('skips blank lines', () => {
    const rows = parseCsv('term,category\n\nwatercolor,art\n\n');
    expect(rows).toEqual([{ term: 'watercolor', category: 'art' }]);
  });

  it('returns an empty array for empty or header-only input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('   ')).toEqual([]);
    expect(parseCsv('term,category')).toEqual([]);
  });

  it('fills missing trailing cells with empty strings', () => {
    const rows = parseCsv('term,category\nwatercolor');
    expect(rows).toEqual([{ term: 'watercolor', category: '' }]);
  });
});

describe('firstColumn', () => {
  it('returns the value of the first candidate key present with a truthy value', () => {
    expect(firstColumn({ keyword: 'boho' }, ['term', 'keyword', 'trend'])).toBe('boho');
  });

  it('returns undefined when no candidate key has a value', () => {
    expect(firstColumn({ term: '' }, ['term', 'keyword'])).toBeUndefined();
    expect(firstColumn({}, ['term', 'keyword'])).toBeUndefined();
  });
});
