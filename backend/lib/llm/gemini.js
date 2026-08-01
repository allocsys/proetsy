// Primary LLM provider. Free-tier key pool with round-robin rotation, and — within each
// key — a priority-ordered model cascade tried before moving to the next key.
// See ARCHITECTURE.md -> LLM Provider Layer -> "Model cascade within a key".

import fs from 'node:fs';
import path from 'node:path';
import { isInCooldown, getCooldownUntil, recordFailure, recordSuccess } from './rate-limits.js';
import { withRequestSlot } from './queue.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const keys = (process.env.GEMINI_API_KEYS || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

const models = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.0-flash,gemini-2.5-pro')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

// Round-robin starting point across separate generateText()/generateVision() calls, so
// repeated calls don't all hammer key[0] first. Cascading within a single call (below)
// is independent of this — it always walks forward from this starting index.
let keyStartIndex = 0;

function isRetryable(err) {
  // A 429 (rate-limit) is retryable — try the next model on this key, then the next key.
  // Anything else (bad request, auth failure, etc.) is not a capacity problem and
  // shouldn't be masked by silently cascading through the rest of the pool.
  return err && err.status === 429;
}

// callFn(key, model) -> performs the actual provider call for one (key, model) pair.
// Walks: for each key (starting at keyStartIndex, wrapping around) -> for each model
// in priority order -> attempt. Only exhausts a key's full model list before rotating
// to the next key (see ARCHITECTURE.md rationale: a rate limit is usually per-model,
// not per-key, so a different model on that key may still have headroom).
//
// Per-attempt ordering (ARCHITECTURE.md -> "Request spacing..." -> "This queue sits in
// front of the cooldown cache, not instead of it" — read together with "Rate-limit
// cooldown tracking", the cooldown check itself comes first):
//   1. Cooldown check (no network call at all if this (key, model) pair is known-limited)
//   2. Request-spacing queue slot (per-key in-flight limit + spacing/jitter + global cap)
//   3. The actual call
//
// This single pass over the pool is the *only* sweep — per ARCHITECTURE.md -> "Backoff
// means backing OFF, not retrying harder", there is deliberately no outer retry loop
// around this function. A sweep that ends with every pair either live-429'd or already
// in cooldown fails immediately; it does not wait and sweep again.
async function cascade(callFn, options = {}) {
  if (keys.length === 0) {
    throw new Error('No Gemini API keys configured. Set GEMINI_API_KEYS in backend/.env.');
  }
  const modelsToTry = options.model ? [options.model] : models;
  if (modelsToTry.length === 0) {
    throw new Error('No Gemini models configured. Set GEMINI_MODELS in backend/.env.');
  }

  let lastError;
  let madeALiveAttempt = false; // false only if every pair this sweep touched was skipped via cooldown
  let earliestCooldownEnd = Infinity;

  for (let i = 0; i < keys.length; i += 1) {
    const keyIndex = (keyStartIndex + i) % keys.length;
    const key = keys[keyIndex];
    for (const model of modelsToTry) {
      // 1. Cooldown check — skip known-limited pairs with no network call at all.
      if (isInCooldown(keyIndex, model)) {
        earliestCooldownEnd = Math.min(earliestCooldownEnd, getCooldownUntil(keyIndex, model));
        continue;
      }
      try {
        // 2 + 3. Queue slot (spacing/jitter/concurrency), then the actual call.
        // eslint-disable-next-line no-await-in-loop
        const result = await withRequestSlot(keyIndex, () => callFn(key, model));
        madeALiveAttempt = true;
        recordSuccess(keyIndex, model);
        return result;
      } catch (err) {
        madeALiveAttempt = true;
        lastError = err;
        if (!isRetryable(err)) throw err;
        // Retryable (429): record it (escalating this pair's cooldown if it's still
        // recovering from a prior hit), then fall through to the next model on this
        // same key, or — once this key's models are exhausted — the next key.
        recordFailure(keyIndex, model, { retryDelayMs: err.retryDelayMs, reason: err.reason || err.message });
      }
    }
  }

  keyStartIndex = (keyStartIndex + 1) % keys.length;

  if (!madeALiveAttempt) {
    // Every pair this sweep would have tried was already in cooldown — distinct from the
    // "we tried and all 429'd" case below, per ARCHITECTURE.md -> "Rate-limit cooldown
    // tracking": useful for telling the two apart in the dashboard.
    const nextAvailable = Number.isFinite(earliestCooldownEnd)
      ? new Date(earliestCooldownEnd).toISOString()
      : 'unknown';
    throw new Error(
      `All Gemini keys/models (${keys.length} keys x ${modelsToTry.join(', ')}) are currently in ` +
        `rate-limit cooldown, next available at ~${nextAvailable}. Not retrying within this request.`
    );
  }

  throw new Error(
    `All Gemini keys (${keys.length}) exhausted across all models (${modelsToTry.join(', ')}). ` +
      `Last error: ${lastError?.message || 'unknown'}`
  );
}

// Reads a 429 response's retry-delay signal, if Gemini supplied one: either a
// `Retry-After` header (seconds, or an HTTP-date) or `error.details[].retryDelay` (a
// "30s"-style string) in the JSON error body. Returns milliseconds, or null if neither is
// present/parseable — callers then fall back to LLM_RATE_LIMIT_DEFAULT_COOLDOWN_MS. See
// ARCHITECTURE.md -> LLM Provider Layer -> "Rate-limit cooldown tracking" -> "Cooldown
// duration".
function extractRetryDelayMs(response, bodyText) {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const asSeconds = Number(retryAfter);
    if (!Number.isNaN(asSeconds)) return asSeconds * 1000;
    const asDate = Date.parse(retryAfter);
    if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  }

  try {
    const parsed = JSON.parse(bodyText);
    const details = parsed?.error?.details || [];
    const retryInfo = details.find((d) => typeof d['@type'] === 'string' && d['@type'].includes('RetryInfo'));
    const retryDelay = retryInfo?.retryDelay; // e.g. "30s"
    if (typeof retryDelay === 'string' && retryDelay.endsWith('s')) {
      const seconds = Number(retryDelay.slice(0, -1));
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  } catch {
    // Body wasn't JSON, or didn't have the expected shape — fall through to null.
  }

  return null;
}

// Single generateContent call against one (key, model) pair. `contents` follows Gemini's
// request shape ([{ role, parts: [...] }]). Throws with `.status` set to the HTTP status
// on failure so cascade() can tell a 429 (retryable) apart from anything else.
async function callGenerateContent(key, model, contents, options = {}) {
  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${key}`;

  const generationConfig = {};
  if (options.json) generationConfig.responseMimeType = 'application/json';
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;

  const body = { contents };
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    const err = new Error(`Gemini API error ${response.status} (model=${model}): ${errBody.slice(0, 300)}`);
    err.status = response.status;
    if (response.status === 429) {
      err.retryDelayMs = extractRetryDelayMs(response, errBody);
      err.reason = errBody;
    }
    throw err;
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!text) {
    throw new Error(
      `Gemini response for model=${model} had no text content (possibly blocked). ` +
        `promptFeedback: ${JSON.stringify(data?.promptFeedback || {})}`
    );
  }
  return text;
}

function guessMimeType(imagePath) {
  const byExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return byExt[path.extname(imagePath).toLowerCase()] || 'application/octet-stream';
}

// options.json: true forces Gemini's structured-output mode (generationConfig.
// responseMimeType = 'application/json') instead of relying solely on prompt wording to
// get valid JSON back — used by Module 2 so listing parsing doesn't depend on the model
// reliably following instructions. options.model pins a single model (bypasses cascade
// for model choice, still cascades across keys).
export async function generateText(prompt, options = {}) {
  const result = await cascade(async (key, model) => {
    const text = await callGenerateContent(key, model, [{ role: 'user', parts: [{ text: prompt }] }], options);
    return { text, provider: 'gemini', model };
  }, options);
  keyStartIndex = (keyStartIndex + 1) % keys.length;
  return result;
}

export async function generateVision(prompt, imagePath, options = {}) {
  const result = await cascade(async (key, model) => {
    const imageBuffer = fs.readFileSync(imagePath);
    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: guessMimeType(imagePath), data: imageBuffer.toString('base64') } },
        ],
      },
    ];
    const text = await callGenerateContent(key, model, contents, options);
    return { text, provider: 'gemini', model };
  }, options);
  keyStartIndex = (keyStartIndex + 1) % keys.length;
  return result;
}
