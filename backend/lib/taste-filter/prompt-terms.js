// Module 7 -> Module 4 prompt-feedback link, write side. See ARCHITECTURE.md -> Module 7
// -> "Prompt-feedback link to Module 4 (optional, opt-in)". Module 4's
// generatePromptsForTrend() (prompt-helper/index.js) already reads from prompt_terms via
// its own getStyleHints(); this file is the write side -- turning a prompt's text into a
// set of terms so callers can tally kept/discarded counts as labels come in. Pure/testable
// without a DB — the DB-touching tally itself lives in store.js's
// tallyPromptTermsForLabel(), which calls extractPromptTerms() below.

// Midjourney parameter flags (ARCHITECTURE.md -> Module 4: "--v 7", "--style raw", aspect
// ratio, "--s 50-150") -- these aren't content/style words, so they (and their argument
// token) are stripped before term extraction rather than tallied as if "7" or "raw" were
// meaningful style hints on their own. ("raw" is ambiguous — it's also a real style word
// elsewhere — but immediately following "--style" it's a flag argument, not free text, so
// it's excluded here; this mirrors how validate.js's enforceMidjourneyConventions()
// already treats these tokens as structured parameters, not prose.)
const MIDJOURNEY_FLAGS = new Set([
  '--v', '--version', '--style', '--ar', '--aspect', '--s', '--stylize',
  '--c', '--chaos', '--q', '--quality', '--seed', '--niji', '--no', '--w', '--weird',
  '--tile', '--iw',
]);

// Common English function words -- not useful as "terms that have worked well" style
// hints on their own, so excluded from the tallied term set even though they're
// technically part of the prompt text.
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'with', 'to', 'for', 'by', 'at',
  'is', 'are', 'this', 'that', 'it', 'as', 'from', 'into',
]);

/**
 * Splits a Midjourney-formatted prompt string into a deduplicated set of lowercase
 * content terms, stripping `--flag value` pairs and stopwords. Returns a Set, not an
 * array or a frequency count -- a term should only count once per prompt no matter how
 * many times it appears in the text, since the eventual tally
 * (store.js -> tallyPromptTermsForLabel) is "how many labeled candidates included this
 * term", not raw word frequency within one prompt.
 * @param {string} promptText
 * @returns {Set<string>}
 */
export function extractPromptTerms(promptText) {
  const terms = new Set();
  if (!promptText) return terms;

  const tokens = promptText.split(/\s+/);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('--')) {
      const flag = token.toLowerCase();
      if (MIDJOURNEY_FLAGS.has(flag)) {
        // Skip the flag's argument token too (e.g. "--ar 2:3", "--v 7") so values like
        // "2:3" or "7" never get tallied as if they were style words. MJ flags take at
        // most one argument here; only consume it if it isn't itself another flag.
        if (tokens[i + 1] && !tokens[i + 1].startsWith('--')) i += 1;
      }
      continue;
    }
    const cleaned = token.toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!cleaned || cleaned.length < 3) continue;
    if (STOPWORDS.has(cleaned)) continue;
    if (/^\d+$/.test(cleaned)) continue; // bare numbers (sizes, counts) aren't style terms
    terms.add(cleaned);
  }
  return terms;
}
