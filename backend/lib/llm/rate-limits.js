// In-process rate-limit cooldown cache for the Gemini key x model cascade. See
// ARCHITECTURE.md -> LLM Provider Layer -> "Rate-limit cooldown tracking" and "Cooldown
// escalation instead".
//
// This is deliberately a plain in-process `Map`, not Redis or any other external cache —
// same local-first, single-process, no-second-runtime reasoning used to reject a separate
// process for Module 7's embeddings. The Map is the hot-path read (checked before every
// cascade attempt); the `llm_rate_limits` table is the durable source of truth that
// survives restarts (`--watch` reload, crash, machine reboot) — important because Gemini's
// free tier has per-day quotas, not just per-minute ones, so a restart shouldn't reset a
// key's daily exhaustion back to "looks fine, try it."
//
// Rows/entries are keyed by a key's positional index in GEMINI_API_KEYS (`key_index`) plus
// `model` — never the raw API key string.

import { getDb } from '../../db/init.js';

const DEFAULT_COOLDOWN_MS = Number(process.env.LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS || 60_000);
const MAX_COOLDOWN_MS = Number(process.env.LLM_RATE_LIMIT_MAX_COOLDOWN_MS || 30 * 60_000);

// cacheKey -> { limitedUntil: epochMs, consecutiveHits: number }
const cooldowns = new Map();
let hydrated = false;

function cacheKey(keyIndex, model) {
  return `${keyIndex}:${model}`;
}

// Rehydrates the in-memory Map from the durable table. Safe to call more than once —
// only actually reads the DB the first time. Called lazily (on first cache access) so any
// module that imports this file doesn't have to worry about import-order relative to
// server startup; also exposed as initRateLimitCache() for an explicit startup call.
function hydrate() {
  if (hydrated) return;
  hydrated = true;
  const db = getDb();
  const rows = db
    .prepare('SELECT key_index, model, limited_until, consecutive_hits FROM llm_rate_limits')
    .all();
  for (const row of rows) {
    const limitedUntil = row.limited_until ? Date.parse(row.limited_until) : 0;
    if (!limitedUntil) continue; // nothing to track — this pair isn't currently cooling down
    cooldowns.set(cacheKey(row.key_index, row.model), {
      limitedUntil,
      consecutiveHits: row.consecutive_hits || 0,
    });
  }
}

export function initRateLimitCache() {
  hydrate();
}

// Checked before every cascade attempt. If true, the caller skips this (key, model) pair
// with no network call at all.
export function isInCooldown(keyIndex, model) {
  hydrate();
  const entry = cooldowns.get(cacheKey(keyIndex, model));
  return Boolean(entry && entry.limitedUntil > Date.now());
}

// Used to build the "next available at ~T" message when every pair is in cooldown.
export function getCooldownUntil(keyIndex, model) {
  hydrate();
  return cooldowns.get(cacheKey(keyIndex, model))?.limitedUntil || 0;
}

// Called on a 429 for this (key, model) pair. `retryDelayMs` should come from Gemini's
// Retry-After header or retryInfo.retryDelay when present; pass null/undefined to fall
// back to LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS.
//
// Escalation: if this pair is hit again while still inside its *previous* cooldown window
// (i.e. it was still recovering and got hit again), the next cooldown is lengthened —
// doubled per consecutive hit — rather than reset to the same base duration, capped at
// LLM_RATE_LIMIT_MAX_COOLDOWN_MS. Getting hit again *after* a previous cooldown had already
// expired starts the escalation count over, since that's a fresh rate-limit episode, not a
// pair that's failing to recover.
export function recordFailure(keyIndex, model, { retryDelayMs, reason } = {}) {
  hydrate();
  const key = cacheKey(keyIndex, model);
  const existing = cooldowns.get(key);
  const stillCoolingDown = Boolean(existing && existing.limitedUntil > Date.now());
  const consecutiveHits = stillCoolingDown ? existing.consecutiveHits + 1 : 1;

  const base = retryDelayMs != null && retryDelayMs > 0 ? retryDelayMs : DEFAULT_COOLDOWN_MS;
  const escalated = Math.min(base * 2 ** (consecutiveHits - 1), MAX_COOLDOWN_MS);
  const limitedUntil = Date.now() + escalated;

  cooldowns.set(key, { limitedUntil, consecutiveHits });

  const db = getDb();
  db.prepare(
    `INSERT INTO llm_rate_limits (key_index, model, limited_until, consecutive_hits, reason, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key_index, model) DO UPDATE SET
       limited_until = excluded.limited_until,
       consecutive_hits = excluded.consecutive_hits,
       reason = excluded.reason,
       updated_at = datetime('now')`
  ).run(keyIndex, model, new Date(limitedUntil).toISOString(), consecutiveHits, reason ? String(reason).slice(0, 500) : null);

  return { limitedUntil, consecutiveHits };
}

// Called on a successful call to this (key, model) pair — clears any cooldown and resets
// the escalation counter to 0, per ARCHITECTURE.md ("This escalation resets once a call to
// that pair actually succeeds").
export function recordSuccess(keyIndex, model) {
  hydrate();
  const key = cacheKey(keyIndex, model);
  if (!cooldowns.has(key)) return; // nothing to clear — avoid a write for the common case

  cooldowns.delete(key);

  const db = getDb();
  db.prepare(
    `INSERT INTO llm_rate_limits (key_index, model, limited_until, consecutive_hits, reason, updated_at)
     VALUES (?, ?, NULL, 0, NULL, datetime('now'))
     ON CONFLICT(key_index, model) DO UPDATE SET
       limited_until = NULL,
       consecutive_hits = 0,
       reason = NULL,
       updated_at = datetime('now')`
  ).run(keyIndex, model);
}
