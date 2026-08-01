// Proactive request pacing for the Gemini key pool, independent of (and layered on top
// of) the reactive cooldown cache in rate-limits.js. See ARCHITECTURE.md -> LLM Provider
// Layer -> "Request spacing, concurrency limits & jitter".
//
// Three things this enforces:
//   1. At most one in-flight request per key at a time — a small per-key queue.
//   2. Minimum spacing (LLM_MIN_REQUEST_INTERVAL_MS) plus randomized jitter
//      (LLM_REQUEST_JITTER_MS) between consecutive requests on the same key, so bulk-mode
//      traffic lands at irregular intervals rather than a scripted, evenly-spaced burst.
//   3. A global concurrency cap (LLM_MAX_CONCURRENT_REQUESTS) across the whole pool,
//      independent of key count, so a bulk batch spread across several keys still doesn't
//      fire everything at once.
//
// Ordering (per ARCHITECTURE.md): the cascade in gemini.js checks the cooldown cache
// first (skip pairs already known to be limited, no call at all) — only a surviving
// candidate acquires a slot here before the actual request goes out.

import { setTimeout as sleep } from 'node:timers/promises';

const MIN_INTERVAL_MS = Number(process.env.LLM_MIN_REQUEST_INTERVAL_MS || 1000);
const JITTER_MS = Number(process.env.LLM_REQUEST_JITTER_MS || 400);
const MAX_CONCURRENT = Number(process.env.LLM_MAX_CONCURRENT_REQUESTS || 2);

// keyIndex -> Promise that resolves once that key's queue is clear of prior work. Used
// purely for per-key sequencing (point 1 above) — not the actual work being awaited.
const perKeyTail = new Map();
// keyIndex -> epoch ms the last request on that key was *started* (used for spacing).
const lastRequestAt = new Map();

let globalActive = 0;
const globalWaiters = [];

function acquireGlobalSlot() {
  if (globalActive < MAX_CONCURRENT) {
    globalActive += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => globalWaiters.push(resolve));
}

function releaseGlobalSlot() {
  const next = globalWaiters.shift();
  if (next) {
    next(); // hand the slot straight to the next waiter — globalActive stays the same
  } else {
    globalActive = Math.max(0, globalActive - 1);
  }
}

async function runSpacedAndBounded(keyIndex, fn) {
  const last = lastRequestAt.get(keyIndex) || 0;
  const floor = Math.max(0, MIN_INTERVAL_MS - (Date.now() - last));
  const jitter = JITTER_MS > 0 ? Math.random() * JITTER_MS : 0;
  const waitMs = floor + jitter;
  if (waitMs > 0) await sleep(waitMs);

  await acquireGlobalSlot();
  lastRequestAt.set(keyIndex, Date.now());
  try {
    return await fn();
  } finally {
    releaseGlobalSlot();
  }
}

// Runs fn() (the actual provider call for one (key, model) pair) once this key's queue
// slot, spacing/jitter, and a global concurrency slot all allow it. Returns fn()'s result
// or rethrows its error — callers (gemini.js's cascade) handle 429s exactly as before,
// this only affects *when* the call goes out.
export function withRequestSlot(keyIndex, fn) {
  const previousTail = perKeyTail.get(keyIndex) || Promise.resolve();
  const runPromise = previousTail.then(
    () => runSpacedAndBounded(keyIndex, fn),
    () => runSpacedAndBounded(keyIndex, fn) // prior request on this key failing shouldn't jam the queue
  );
  // Tail is used only for sequencing — swallow rejections so the chain never stalls.
  perKeyTail.set(keyIndex, runPromise.catch(() => {}));
  return runPromise;
}
