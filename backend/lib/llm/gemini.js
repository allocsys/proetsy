// Primary LLM provider. Free-tier key pool with round-robin rotation and 429 retry.
// TODO: replace the stub bodies below with real Gemini API calls once Modules 1/2/4 are being built.

const keys = (process.env.GEMINI_API_KEYS || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

let keyIndex = 0;

function nextKey() {
  if (keys.length === 0) {
    throw new Error('No Gemini API keys configured. Set GEMINI_API_KEYS in backend/.env.');
  }
  const key = keys[keyIndex % keys.length];
  keyIndex += 1;
  return key;
}

export async function generateText(prompt, options = {}) {
  nextKey();
  // TODO: call Gemini's generateContent endpoint; on 429, retry with nextKey() before failing.
  return { text: `[stub] Gemini text response for: ${prompt}`, provider: 'gemini' };
}

export async function generateVision(prompt, imagePath, options = {}) {
  nextKey();
  // TODO: call a vision-capable Gemini model with the image + prompt.
  return { text: `[stub] Gemini vision response for ${imagePath}`, provider: 'gemini' };
}
