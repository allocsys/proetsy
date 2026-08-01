// Optional fallback provider. Disabled unless LLM_PROVIDER=claude and CLAUDE_API_KEY is set,
// per the LLM Provider Layer in ARCHITECTURE.md — no silent fallback unless explicitly enabled.

export async function generateText(prompt, options = {}) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('Claude fallback is not configured. Set CLAUDE_API_KEY in backend/.env to enable it.');
  }
  // TODO: call Claude's messages API.
  return { text: `[stub] Claude text response for: ${prompt}`, provider: 'claude' };
}

export async function generateVision(prompt, imagePath, options = {}) {
  if (!process.env.CLAUDE_API_KEY) {
    throw new Error('Claude fallback is not configured. Set CLAUDE_API_KEY in backend/.env to enable it.');
  }
  // TODO: call Claude's messages API with an image content block.
  return { text: `[stub] Claude vision response for ${imagePath}`, provider: 'claude' };
}
