import * as gemini from './gemini.js';
import * as claude from './claude.js';

function getActiveProvider() {
  const provider = process.env.LLM_PROVIDER || 'gemini';
  return provider === 'claude' ? claude : gemini;
}

export async function generateText(prompt, options = {}) {
  return getActiveProvider().generateText(prompt, options);
}

export async function generateVision(prompt, imagePath, options = {}) {
  return getActiveProvider().generateVision(prompt, imagePath, options);
}

// Image generation (Module 3's AI-outpainting fallback) is Gemini-only — Claude has no
// comparable endpoint (see claude.js's generateImage() stub) — so this deliberately bypasses
// getActiveProvider()'s LLM_PROVIDER switch and always calls gemini.js directly, regardless
// of which provider is active for text/vision calls via LLM_PROVIDER=claude.
export async function generateImage(prompt, imagePath, options = {}) {
  return gemini.generateImage(prompt, imagePath, options);
}
