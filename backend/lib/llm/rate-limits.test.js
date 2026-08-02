import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads DB_PATH at first getDb() call and caches a singleton connection, and
// rate-limits.js reads LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS / LLM_RATE_LIMIT_MAX_COOLDOWN_MS
// as module-level constants at import time — both must be set before import, same dynamic-
// import pattern used by taste-filter/store.test.js.
let tmpRoot;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-rate-limits-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function freshRateLimits({ defaultCooldownMs = 1000, maxCooldownMs = 30 * 60_000, dbPath } = {}) {
  vi.resetModules();
  process.env.DB_PATH = dbPath || path.join(tmpRoot, `${Math.random().toString(36).slice(2)}.db`);
  process.env.LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS = String(defaultCooldownMs);
  process.env.LLM_RATE_LIMIT_MAX_COOLDOWN_MS = String(maxCooldownMs);
  return import('./rate-limits.js');
}

describe('isInCooldown / getCooldownUntil (cold start)', () => {
  it('an untouched (key, model) pair is not in cooldown, and getCooldownUntil is 0', async () => {
    const { isInCooldown, getCooldownUntil } = await freshRateLimits();
    expect(isInCooldown(0, 'gemini-2.5-flash')).toBe(false);
    expect(getCooldownUntil(0, 'gemini-2.5-flash')).toBe(0);
  });
});

describe('recordFailure', () => {
  it('puts a pair into cooldown for the default duration when no retryDelayMs is given', async () => {
    const { isInCooldown, getCooldownUntil, recordFailure } = await freshRateLimits({ defaultCooldownMs: 5000 });
    const before = Date.now();

    const { limitedUntil, consecutiveHits } = recordFailure(0, 'gemini-2.5-flash', {});

    expect(consecutiveHits).toBe(1);
    expect(limitedUntil).toBeGreaterThanOrEqual(before + 5000 - 50);
    expect(isInCooldown(0, 'gemini-2.5-flash')).toBe(true);
    expect(getCooldownUntil(0, 'gemini-2.5-flash')).toBe(limitedUntil);
  });

  it('uses the provided retryDelayMs instead of the default when present', async () => {
    const { recordFailure } = await freshRateLimits({ defaultCooldownMs: 60_000 });
    const before = Date.now();

    const { limitedUntil } = recordFailure(0, 'gemini-2.5-flash', { retryDelayMs: 2000 });

    expect(limitedUntil).toBeLessThan(before + 60_000); // did not fall back to the (much longer) default
    expect(limitedUntil).toBeGreaterThanOrEqual(before + 2000 - 50);
  });

  it('only affects the specific (key, model) pair, not other keys or models', async () => {
    const { isInCooldown, recordFailure } = await freshRateLimits({ defaultCooldownMs: 5000 });
    recordFailure(0, 'gemini-2.5-flash', {});

    expect(isInCooldown(0, 'gemini-2.5-flash')).toBe(true);
    expect(isInCooldown(0, 'gemini-2.0-flash')).toBe(false); // same key, different model
    expect(isInCooldown(1, 'gemini-2.5-flash')).toBe(false); // different key, same model
  });

  it('escalates (doubles) the cooldown on a second hit while still inside the previous cooldown window', async () => {
    const { recordFailure } = await freshRateLimits({ defaultCooldownMs: 60_000, maxCooldownMs: 60 * 60_000 });

    const first = recordFailure(0, 'gemini-2.5-flash', { retryDelayMs: 1000 });
    expect(first.consecutiveHits).toBe(1);

    const second = recordFailure(0, 'gemini-2.5-flash', { retryDelayMs: 1000 });
    expect(second.consecutiveHits).toBe(2);
    // Escalated cooldown (base * 2^1 = 2000ms) should push limitedUntil further out than
    // the first hit's (base * 2^0 = 1000ms) would have, measured from time of each call.
    expect(second.limitedUntil - first.limitedUntil).toBeGreaterThan(0);

    const third = recordFailure(0, 'gemini-2.5-flash', { retryDelayMs: 1000 });
    expect(third.consecutiveHits).toBe(3);
  });

  it('caps escalation at LLM_RATE_LIMIT_MAX_COOLDOWN_MS rather than doubling indefinitely', async () => {
    const { recordFailure } = await freshRateLimits({ defaultCooldownMs: 1000, maxCooldownMs: 3000 });

    // retryDelayMs of 1000, doubling each consecutive hit: 1000, 2000, 4000(->capped 3000),
    // 8000(->capped 3000)... every hit here happens well within the prior cooldown window
    // (which is itself capped, so always "still cooling down"), so hits keep escalating.
    let last;
    for (let i = 0; i < 6; i += 1) {
      last = recordFailure(0, 'gemini-2.5-flash', { retryDelayMs: 1000 });
    }
    // Measured right after the loop, not before it -- 6 synchronous DB writes can take
    // much longer than a tight tolerance on a loaded/slow CI runner, and that setup time
    // isn't what this assertion cares about. What matters is that the cap (3000ms) is
    // being applied at all, not exactly how many ms have elapsed since the loop started.
    const after = Date.now();

    expect(last.limitedUntil).toBeLessThanOrEqual(after + 3000 + 50);
    expect(last.limitedUntil).toBeGreaterThan(after); // still a real cooldown, not zeroed out
  });

  it('starts the escalation count over if hit again only after the previous cooldown fully expired', async () => {
    const { recordFailure } = await freshRateLimits({ defaultCooldownMs: 50, maxCooldownMs: 60_000 });

    const first = recordFailure(0, 'gemini-2.5-flash', {});
    expect(first.consecutiveHits).toBe(1);

    await new Promise((r) => setTimeout(r, 80)); // let the 50ms cooldown fully elapse

    const second = recordFailure(0, 'gemini-2.5-flash', {});
    expect(second.consecutiveHits).toBe(1); // fresh episode, not continued escalation
  });

  it('truncates an overly long reason string before persisting it', async () => {
    const dbPath = path.join(tmpRoot, 'reason-truncation.db');
    const { recordFailure } = await freshRateLimits({ dbPath });
    const longReason = 'x'.repeat(2000);

    expect(() => recordFailure(0, 'gemini-2.5-flash', { reason: longReason })).not.toThrow();

    vi.resetModules();
    process.env.DB_PATH = dbPath;
    const { getDb } = await import('../../db/init.js');
    const row = getDb().prepare('SELECT reason FROM llm_rate_limits WHERE key_index = 0 AND model = ?').get('gemini-2.5-flash');
    expect(row.reason.length).toBeLessThanOrEqual(500);
  });
});

describe('recordSuccess', () => {
  it('clears an existing cooldown and resets the escalation counter', async () => {
    const { isInCooldown, recordFailure, recordSuccess } = await freshRateLimits({ defaultCooldownMs: 60_000 });
    recordFailure(0, 'gemini-2.5-flash', {});
    expect(isInCooldown(0, 'gemini-2.5-flash')).toBe(true);

    recordSuccess(0, 'gemini-2.5-flash');
    expect(isInCooldown(0, 'gemini-2.5-flash')).toBe(false);
  });

  it('a subsequent failure after a success starts escalation over at consecutiveHits = 1', async () => {
    const { recordFailure, recordSuccess } = await freshRateLimits({ defaultCooldownMs: 60_000 });
    recordFailure(0, 'gemini-2.5-flash', {});
    recordFailure(0, 'gemini-2.5-flash', {}); // consecutiveHits = 2
    recordSuccess(0, 'gemini-2.5-flash');

    const afterSuccess = recordFailure(0, 'gemini-2.5-flash', {});
    expect(afterSuccess.consecutiveHits).toBe(1);
  });

  it('is a no-op (no DB write, no throw) for a pair that was never in cooldown', async () => {
    const { recordSuccess } = await freshRateLimits();
    expect(() => recordSuccess(5, 'gemini-2.5-pro')).not.toThrow();
  });
});

describe('durability across a restart', () => {
  it('rehydrates the in-memory cache from the llm_rate_limits table on a fresh process/import', async () => {
    const dbPath = path.join(tmpRoot, 'durability.db');

    const first = await freshRateLimits({ defaultCooldownMs: 60_000, dbPath });
    first.recordFailure(2, 'gemini-2.5-pro', { retryDelayMs: 45_000 });
    expect(first.isInCooldown(2, 'gemini-2.5-pro')).toBe(true);

    // Simulate a process restart: fresh module graph, same DB_PATH, no explicit hand-off
    // of in-memory state — only the durable table should carry the cooldown forward.
    const second = await freshRateLimits({ defaultCooldownMs: 60_000, dbPath });
    expect(second.isInCooldown(2, 'gemini-2.5-pro')).toBe(true);
    expect(second.getCooldownUntil(2, 'gemini-2.5-pro')).toBeGreaterThan(Date.now());
  });

  it('initRateLimitCache() explicitly triggers hydration without needing a read call first', async () => {
    const dbPath = path.join(tmpRoot, 'explicit-init.db');

    const first = await freshRateLimits({ defaultCooldownMs: 60_000, dbPath });
    first.recordFailure(0, 'gemini-2.5-flash', {});

    const second = await freshRateLimits({ defaultCooldownMs: 60_000, dbPath });
    expect(() => second.initRateLimitCache()).not.toThrow();
    expect(second.isInCooldown(0, 'gemini-2.5-flash')).toBe(true);
  });

  it('a cleared (recordSuccess) pair stays cleared after a simulated restart', async () => {
    const dbPath = path.join(tmpRoot, 'cleared-persists.db');

    const first = await freshRateLimits({ defaultCooldownMs: 60_000, dbPath });
    first.recordFailure(0, 'gemini-2.5-flash', {});
    first.recordSuccess(0, 'gemini-2.5-flash');

    const second = await freshRateLimits({ defaultCooldownMs: 60_000, dbPath });
    expect(second.isInCooldown(0, 'gemini-2.5-flash')).toBe(false);
  });
});
