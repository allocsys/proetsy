import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// enforceMidjourneyConventions now reads the shop's *current* Midjourney conventions via
// config/index.js's getShopConventions().midjourney (dashboard-editable, backed by the
// `settings` DB table — see plan.md). DB_PATH must be set BEFORE validate.js (which
// transitively imports db/init.js via config/index.js) is first imported — same
// env-var-before-import pattern as config/index.test.js. This file's expectations use
// the shipped default values directly (--v 7, --style raw, stylize 50-150 default 100,
// aspect ratios) rather than importing MIDJOURNEY_CONVENTIONS, matching how they were
// already written before this change — nothing here ever writes to `settings`, so those
// defaults hold throughout.
let enforceMidjourneyConventions;
let tmpRoot;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-prompt-helper-validate-test-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  ({ enforceMidjourneyConventions } = await import('./validate.js'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('enforceMidjourneyConventions', () => {
  it('leaves an already-compliant prompt unchanged, with no warnings', () => {
    const compliant = 'a red fox curled up in snow, soft morning light --v 7 --style raw --ar 2:3 --s 100';
    const { text, warnings } = enforceMidjourneyConventions(compliant, 'portrait');
    expect(text).toBe(compliant);
    expect(warnings).toEqual([]);
  });

  it('appends a missing --v 7 flag', () => {
    const { text, warnings } = enforceMidjourneyConventions('a mountain lake --style raw --ar 3:2 --s 80', 'landscape');
    expect(text).toContain('--v 7');
    expect(warnings.some((w) => /--v 7/.test(w))).toBe(true);
  });

  it('appends a missing --style raw flag', () => {
    const { text, warnings } = enforceMidjourneyConventions('a mountain lake --v 7 --ar 3:2 --s 80', 'landscape');
    expect(text).toContain('--style raw');
    expect(warnings.some((w) => /--style raw/.test(w))).toBe(true);
  });

  it('appends the correct --ar for the given orientation when missing', () => {
    const { text, warnings } = enforceMidjourneyConventions('a still life --v 7 --style raw --s 90', 'square');
    expect(text).toContain('--ar 1:1');
    expect(warnings.some((w) => /--ar 1:1/.test(w))).toBe(true);
  });

  it('does not add an --ar flag for an unrecognized orientation', () => {
    const { text, warnings } = enforceMidjourneyConventions('a still life --v 7 --style raw --s 90', 'panoramic');
    expect(text).not.toMatch(/--ar \d+:\d+/);
    expect(warnings.some((w) => /--ar/.test(w))).toBe(false);
  });

  it('appends a default --s when missing entirely', () => {
    const { text, warnings } = enforceMidjourneyConventions('a still life --v 7 --style raw --ar 1:1', 'square');
    expect(text).toContain('--s 100');
    expect(warnings.some((w) => /missing --s/.test(w))).toBe(true);
  });

  it('clamps a --s value below the shop minimum', () => {
    const { text, warnings } = enforceMidjourneyConventions('a still life --v 7 --style raw --ar 1:1 --s 10', 'square');
    expect(text).toContain('--s 50');
    expect(text).not.toContain('--s 10');
    expect(warnings.some((w) => /Clamped --s 10/.test(w))).toBe(true);
  });

  it('clamps a --s value above the shop maximum', () => {
    const { text, warnings } = enforceMidjourneyConventions('a still life --v 7 --style raw --ar 1:1 --s 400', 'square');
    expect(text).toContain('--s 150');
    expect(text).not.toContain('--s 400');
    expect(warnings.some((w) => /Clamped --s 400/.test(w))).toBe(true);
  });

  it('leaves an in-range --s value untouched', () => {
    const { text, warnings } = enforceMidjourneyConventions('a still life --v 7 --style raw --ar 1:1 --s 125', 'square');
    expect(text).toContain('--s 125');
    expect(warnings).toEqual([]);
  });

  it('handles a prompt missing every flag, adding all of them', () => {
    const { text, warnings } = enforceMidjourneyConventions('a quiet library reading nook', 'portrait');
    expect(text).toContain('--v 7');
    expect(text).toContain('--style raw');
    expect(text).toContain('--ar 2:3');
    expect(text).toContain('--s 100');
    expect(warnings).toHaveLength(4);
  });

  it('trims surrounding whitespace', () => {
    const { text } = enforceMidjourneyConventions('  a still life --v 7 --style raw --ar 1:1 --s 100  ', 'square');
    expect(text).toBe('a still life --v 7 --style raw --ar 1:1 --s 100');
  });
});
