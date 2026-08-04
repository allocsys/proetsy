// Optional fallback provider. Disabled unless LLM_PROVIDER=claude and a Claude key is
// configured (dashboard-added, via key-store.js -- DB-backed only, no .env fallback),
// per the LLM Provider Layer in ARCHITECTURE.md — no silent fallback unless explicitly
// enabled.

import { getKeysForProvider } from './key-store.js';

function getClaudeKey() {
  return getKeysForProvider('claude')[0] || null;
}

export async function generateText(prompt, _options = {}) {
  if (!getClaudeKey()) {
    throw new Error('Claude fallback is not configured. Add a Claude key from the dashboard Settings panel.');
  }
  // TODO: call Claude's messages API.
  return { text: `[stub] Claude text response for: ${prompt}`, provider: 'claude' };
}

export async function generateVision(prompt, imagePath, _options = {}) {
  if (!getClaudeKey()) {
    throw new Error('Claude fallback is not configured. Add a Claude key from the dashboard Settings panel.');
  }
  // TODO: call Claude's messages API with an image content block.
  return { text: `[stub] Claude vision response for ${imagePath}`, provider: 'claude' };
}

// No generateImage() here -- Claude has no image-generation endpoint comparable to
// Nano Banana, and llm/index.js's generateImage() deliberately bypasses the
// LLM_PROVIDER switch and always calls gemini.js directly (see index.js), so this
// module never needs to implement or stub image generation at all.
