// Optional fallback provider. Disabled unless LLM_PROVIDER=claude and CLAUDE_API_KEY is set,
// per the LLM Provider Layer in ARCHITECTURE.md — no silent fallback unless explicitly enabled.

export async function generateText(prompt, _options = {}) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('Claude fallback is not configured. Set CLAUDE_API_KEY in backend/.env to enable it.');
  }
  // TODO: call Claude's messages API.
  return { text: `[stub] Claude text response for: ${prompt}`, provider: 'claude' };
}

export async function generateVision(prompt, imagePath, _options = {}) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('Claude fallback is not configured. Set CLAUDE_API_KEY in backend/.env to enable it.');
  }
  // TODO: call Claude's messages API with an image content block.
  return { text: `[stub] Claude vision response for ${imagePath}`, provider: 'claude' };
}

// Stub kept for interface symmetry with gemini.js's generateImage() (Module 3's
// AI-outpainting fallback). Claude has no image-generation endpoint comparable to Nano
// Banana, so there is no real Claude implementation to build here — this function is never
// actually called: llm/index.js's generateImage() bypasses the LLM_PROVIDER switch and
// calls gemini.js directly, so this stub only exists for interface symmetry / in case
// something imports claude.js directly.
export async function generateImage(prompt, imagePath, _options = {}) {
  throw new Error(
    'Claude has no image-generation fallback. generateImage() is Gemini-only — see ARCHITECTURE.md -> Module 3.'
  );
}
