import { describe, it, expect, vi } from 'vitest';

// queue.js reads LLM_MIN_REQUEST_INTERVAL_MS / LLM_REQUEST_JITTER_MS /
// LLM_MAX_CONCURRENT_REQUESTS as module-level constants at import time, and keeps its
// per-key/global state in module-level Maps/counters — so each test gets a fully fresh
// module (fresh env values AND fresh state) via vi.resetModules() + a dynamic import,
// same pattern used by the idempotency suites elsewhere in this repo.
async function freshQueue(env = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = String(v);
  return import('./queue.js');
}

describe('withRequestSlot', () => {
  it('runs a single call through with no artificial delay when spacing/jitter are zero', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 0,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 5,
    });
    const start = Date.now();
    const result = await withRequestSlot(0, async () => 'ok');
    expect(result).toBe('ok');
    expect(Date.now() - start).toBeLessThan(50);
  });

  it('serializes requests on the same key — the second does not start until the first finishes', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 0,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 5,
    });

    const events = [];
    const slow = async (label) => {
      events.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, 60));
      events.push(`${label}:end`);
      return label;
    };

    const [a, b] = await Promise.all([
      withRequestSlot(0, () => slow('a')),
      withRequestSlot(0, () => slow('b')),
    ]);

    expect([a, b]).toEqual(['a', 'b']);
    // Same key -> strictly sequential: a must fully finish before b starts.
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('does not serialize requests on different keys against each other', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 0,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 5,
    });

    const events = [];
    const slow = async (label) => {
      events.push(`${label}:start`);
      await new Promise((r) => setTimeout(r, 60));
      events.push(`${label}:end`);
      return label;
    };

    await Promise.all([withRequestSlot(0, () => slow('a')), withRequestSlot(1, () => slow('b'))]);

    // Different keys -> both start before either finishes.
    expect(events[0]).toMatch(/:start$/);
    expect(events[1]).toMatch(/:start$/);
  });

  it('caps global concurrency across the whole pool even when keys differ', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 0,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 2,
    });

    let active = 0;
    let maxActive = 0;
    const tracked = (keyIndex) =>
      withRequestSlot(keyIndex, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 40));
        active -= 1;
        return keyIndex;
      });

    // 5 distinct keys so per-key serialization can't be what's limiting concurrency —
    // only the global cap should be.
    await Promise.all([0, 1, 2, 3, 4].map(tracked));

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('enforces minimum spacing between consecutive requests on the same key', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 120,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 5,
    });

    const first = Date.now();
    await withRequestSlot(0, async () => 'a');
    await withRequestSlot(0, async () => 'b');
    const elapsed = Date.now() - first;

    expect(elapsed).toBeGreaterThanOrEqual(115); // small tolerance for scheduler jitter
  });

  it('a rejection on a key does not jam that key\u2019s queue for the next request', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 0,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 5,
    });

    await expect(
      withRequestSlot(0, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Same key, right after a failure — must still run, not hang.
    const result = await withRequestSlot(0, async () => 'still works');
    expect(result).toBe('still works');
  });

  it('propagates the wrapped function\u2019s return value and rethrows its error unchanged', async () => {
    const { withRequestSlot } = await freshQueue({
      LLM_MIN_REQUEST_INTERVAL_MS: 0,
      LLM_REQUEST_JITTER_MS: 0,
      LLM_MAX_CONCURRENT_REQUESTS: 5,
    });

    const err = new Error('specific failure');
    err.status = 429;
    await expect(
      withRequestSlot(0, async () => {
        throw err;
      })
    ).rejects.toBe(err);
  });
});
