import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads DB_PATH at import time, so it must be set BEFORE the module is
// imported — hence dynamic import() inside beforeAll, same pattern used throughout this
// repo's other DB-touching tests (e.g. mockup-generator.idempotency.test.js).
let getDb;
let generatePromptsForTrend;
let listPrompts;
let generateTextMock;
let tmpRoot;

function fixturePrompts(count = 3) {
  // Deliberately missing the --v 7 flag on one entry, so these tests also exercise the
  // enforceMidjourneyConventions() backstop end-to-end, not just a pass-through.
  return Array.from({ length: count }, (_, i) =>
    i === 0
      ? 'a fox in a snowy field --style raw --ar 2:3 --s 100'
      : `variation ${i} description --v 7 --style raw --ar 2:3 --s 100`
  );
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-prompt-helper-'));
  process.env.DB_PATH = path.join(tmpRoot, 'test.db');

  generateTextMock = vi.fn(async () => ({ text: JSON.stringify({ prompts: fixturePrompts() }) }));
  vi.doMock('../llm/index.js', () => ({
    generateText: generateTextMock,
    generateVision: vi.fn(),
    generateImage: vi.fn(),
  }));

  ({ getDb } = await import('../../db/init.js'));
  ({ generatePromptsForTrend, listPrompts } = await import('./index.js'));
});

beforeEach(() => {
  generateTextMock.mockClear();
});

afterAll(() => {
  vi.doUnmock('../llm/index.js');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('generatePromptsForTrend', () => {
  it('requires an orientation', async () => {
    await expect(generatePromptsForTrend({ orientation: undefined })).rejects.toThrow(/orientation is required/);
  });

  it('generates and persists a batch with trend_id null when no trend is selected', async () => {
    const results = await generatePromptsForTrend({ orientation: 'square' });

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.trend_id).toBeNull();
      expect(r.orientation).toBe('square');
      expect(r.id).toBeTruthy();
    }

    const db = getDb();
    const rows = db.prepare('SELECT * FROM prompts WHERE trend_id IS NULL').all();
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('applies the Midjourney-conventions backstop to the model output (e.g. adds a missing --v 7)', async () => {
    const results = await generatePromptsForTrend({ orientation: 'portrait' });
    const withMissingFlag = results.find((r) => r.prompt_text.includes('a fox in a snowy field'));
    expect(withMissingFlag.prompt_text).toContain('--v 7');
    expect(withMissingFlag.warnings.some((w) => /--v 7/.test(w))).toBe(true);
  });

  it('throws for a trend_id that does not exist', async () => {
    await expect(generatePromptsForTrend({ trendId: 999999, orientation: 'square' })).rejects.toThrow(/Trend 999999 not found/);
  });

  it('associates persisted prompts with a real trend_id when one is given', async () => {
    const db = getDb();
    const { lastInsertRowid: trendId } = db
      .prepare("INSERT INTO trends (term, category, source) VALUES (?, ?, 'manual')")
      .run('cottagecore botanical', 'home decor');

    const results = await generatePromptsForTrend({ trendId, orientation: 'landscape' });
    expect(results.every((r) => r.trend_id === trendId)).toBe(true);

    // The prompt sent to the LLM should reference the selected trend's term.
    const promptArg = generateTextMock.mock.calls.at(-1)[0];
    expect(promptArg).toContain('cottagecore botanical');
  });

  it('each call appends a new batch of rows rather than overwriting the previous one', async () => {
    const db = getDb();
    const before = db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n;

    await generatePromptsForTrend({ orientation: 'square' });
    const afterOne = db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n;
    expect(afterOne).toBe(before + 3);

    await generatePromptsForTrend({ orientation: 'square' });
    const afterTwo = db.prepare('SELECT COUNT(*) AS n FROM prompts').get().n;
    expect(afterTwo).toBe(afterOne + 3);
  });

  it('includes style hints from prompt_terms in the LLM prompt when they exist, without overriding the request itself', async () => {
    const db = getDb();
    db.prepare(
      "INSERT INTO prompt_terms (term, kept_count, discarded_count) VALUES ('gold leaf accents', 12, 2), ('muddy composition', 1, 9)"
    ).run();

    await generatePromptsForTrend({ orientation: 'square' });

    const promptArg = generateTextMock.mock.calls.at(-1)[0];
    // A term with more kept than discarded should surface as a hint...
    expect(promptArg).toContain('gold leaf accents');
    // ...while one that's mostly discarded should not.
    expect(promptArg).not.toContain('muddy composition');
  });
});

describe('listPrompts', () => {
  it('filters by orientation', async () => {
    await generatePromptsForTrend({ orientation: 'landscape' });
    const results = listPrompts({ orientation: 'landscape' });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.orientation === 'landscape')).toBe(true);
  });

  it('filters by trendId', async () => {
    const db = getDb();
    const { lastInsertRowid: trendId } = db
      .prepare("INSERT INTO trends (term, category, source) VALUES (?, NULL, 'manual')")
      .run('a uniquely filterable trend');

    await generatePromptsForTrend({ trendId, orientation: 'square' });
    const results = listPrompts({ trendId });

    expect(results.length).toBe(3);
    expect(results.every((r) => r.trend_id === trendId)).toBe(true);
  });

  it('returns newest first', async () => {
    const results = listPrompts({});
    for (let i = 1; i < results.length; i++) {
      expect(new Date(results[i - 1].created_at).getTime()).toBeGreaterThanOrEqual(new Date(results[i].created_at).getTime());
    }
  });
});
