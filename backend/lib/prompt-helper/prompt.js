import { MIDJOURNEY_CONVENTIONS } from '../../config/shop-conventions.js';

// Number of ready-to-paste prompt variations requested per generation call. Mirrors
// Module 2's fixed-3-variations precedent for consistency, but isn't itself a hardcoded
// shop convention like LISTING_VARIATIONS — ARCHITECTURE.md -> Module 4 only says
// "prompts" (plural), not a specific count.
export const PROMPT_COUNT = 3;

/**
 * Builds the prompt sent to the LLM provider layer's generateText() call for Module 4
 * (Trend/Prompt Helper). Pure function (no DB, no network) — mirrors
 * image-analyzer/prompt.js and listing-generator/prompt.js's split between prompt
 * construction (here) and the module's DB/network orchestration (index.js). See
 * ARCHITECTURE.md -> Module 4.
 *
 * @param {object} params
 * @param {{ term: string, category?: string } | null} params.trend - the selected trend row, or null if none picked (module works trend-less per ARCHITECTURE.md's manual-trend framing)
 * @param {string} params.category - desired product category (e.g. 'portrait', 'landscape', 'square') — drives the --ar flag
 * @param {string[]} [params.styleHints] - optional "terms that have worked well" from Module 7's kept/discard tally (prompt_terms table), when any exist yet — see ARCHITECTURE.md -> Module 7 -> "Prompt-feedback link to Module 4": a style hint only, never overriding the trend/category selection itself
 * @returns {string}
 */
export function buildPromptHelperPrompt({ trend, category, styleHints = [] }) {
  const aspectRatio = MIDJOURNEY_CONVENTIONS.aspectRatioByCategory[category] || null;

  const trendLine = trend
    ? `Selected trend/theme: "${trend.term}"${trend.category ? ` (trend category: ${trend.category})` : ''}.`
    : 'No specific trend was selected — generate broadly appealing fine-art print concepts for this category.';

  const hintsLine = styleHints.length
    ? `Style hint (optional, from this shop's own history of kept vs. discarded images — lean toward these where they fit naturally, but do NOT let them override the trend or category above): ${styleHints.join(', ')}.`
    : '';

  return [
    'You are writing ready-to-paste Midjourney prompts for an Etsy fine art print shop.',
    'Return ONLY valid JSON — no markdown code fences, no preamble, no trailing commentary.',
    '',
    `Target product category: "${category}".`,
    trendLine,
    hintsLine,
    '',
    `Every prompt MUST end with exactly these Midjourney parameters, in this order: ` +
      `${MIDJOURNEY_CONVENTIONS.version} ${MIDJOURNEY_CONVENTIONS.style}` +
      `${aspectRatio ? ` --ar ${aspectRatio}` : ''} --s <a whole number between ${MIDJOURNEY_CONVENTIONS.stylizeMin} and ${MIDJOURNEY_CONVENTIONS.stylizeMax}>.`,
    'Do not mention Midjourney, AI, or "generated" anywhere in the descriptive part of the prompt — only plain visual/artistic description, followed by the parameters.',
    '',
    `Generate exactly ${PROMPT_COUNT} distinct prompt variations — different compositions, angles, or framings on the trend and category above, not just reworded restatements of each other.`,
    '',
    'Respond with exactly this JSON shape:',
    '{ "prompts": ["full ready-to-paste prompt text 1", "full ready-to-paste prompt text 2", "..."] }',
  ]
    .filter(Boolean)
    .join('\n');
}
