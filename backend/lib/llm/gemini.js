// Primary LLM provider. Free-tier key pool with round-robin rotation, and — within each
// key — a priority-ordered model cascade tried before moving to the next key.
// See ARCHITECTURE.md -> LLM Provider Layer -> "Model cascade within a key".
// TODO: replace the stub call bodies below with real Gemini API calls once Modules 1/2/4
// are being built. The retry/cascade control flow around them is real, not stubbed.

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
// not per-key, so a different model on the same key may still have headroom).
async function cascade(callFn, options = {}) {
  if (keys.length === 0) {
    throw new Error('No Gemini API keys configured. Set GEMINI_API_KEYS in backend/.env.');
  }
  const modelsToTry = options.model ? [options.model] : models;
  if (modelsToTry.length === 0) {
    throw new Error('No Gemini models configured. Set GEMINI_MODELS in backend/.env.');
  }

  let lastError;
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[(keyStartIndex + i) % keys.length];
    for (const model of modelsToTry) {
      try {
        // eslint-disable-next-line no-await-in-loop
        return await callFn(key, model);
      } catch (err) {
        lastError = err;
        if (!isRetryable(err)) throw err;
        // retryable: fall through to the next model on this same key, or (once this
        // key's models are exhausted) the next key via the outer loop
      }
    }
  }

  keyStartIndex = (keyStartIndex + 1) % keys.length;
  throw new Error(
    `All Gemini keys (${keys.length}) exhausted across all models (${modelsToTry.join(', ')}). ` +
      `Last error: ${lastError?.message || 'unknown'}`
  );
}

export async function generateText(prompt, options = {}) {
  const result = await cascade(async (key, model) => {
    // TODO: call Gemini's generateContent endpoint for `model` using `key`; throw an
    // Error with `.status = 429` on rate-limit responses so cascade() retries correctly.
    return { text: `[stub] Gemini text response for: ${prompt}`, provider: 'gemini', model };
  }, options);
  keyStartIndex = (keyStartIndex + 1) % keys.length;
  return result;
}

export async function generateVision(prompt, imagePath, options = {}) {
  const result = await cascade(async (key, model) => {
    // TODO: call a vision-capable Gemini model with the image + prompt; same 429 -> retry
    // contract as generateText above.
    return { text: `[stub] Gemini vision response for ${imagePath}`, provider: 'gemini', model };
  }, options);
  keyStartIndex = (keyStartIndex + 1) % keys.length;
  return result;
}
