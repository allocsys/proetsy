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
