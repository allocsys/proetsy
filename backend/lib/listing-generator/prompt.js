import { LISTING_VARIATIONS } from '../../config/shop-conventions.js';
import { getShopConventions } from '../../config/index.js';

// Builds the prompt sent to the LLM provider layer for Module 2. Shop conventions are
// spelled out explicitly here; validate.js re-enforces them after the fact as a backstop
// in case the model drifts from the instructions.
export function buildListingPrompt({ imageAnalysis, manualNotes, trend, tagCandidates, availableSizes }) {
  const SHOP_CONVENTIONS = getShopConventions().listing;
  const subjectBlock = imageAnalysis
    ? `Image analysis (from Module 1):\n${JSON.stringify(imageAnalysis, null, 2)}`
    : `Module 1 (Image Analyzer) was skipped. Manual notes from the user:\n${manualNotes || '(none provided)'}`;

  const trendBlock = trend
    ? `Selected trend to lean into: "${trend.term}" (category: ${trend.category || 'n/a'})`
    : 'No specific trend selected — write generally appealing listing copy.';

  const tagBlock = tagCandidates.length
    ? `Candidate tags from the shop's tag library (choose/prioritize from these, do not invent new ones):\n${tagCandidates
        .map((t) => t.tag_text)
        .join(', ')}`
    : 'No matching tags found in the tag library yet — return empty tag arrays rather than inventing tags; the user will pick tags manually.';

  const sizesBlock = availableSizes.length
    ? `Only reference these product sizes if sizes come up at all (never mention a size not listed here):\n${availableSizes
        .map((s) => `${s.size_key} (${s.dimensions}, ${s.orientation})`)
        .join('; ')}`
    : 'No product sizes are configured yet — do not mention any specific size in the listing.';

  return `You are writing Etsy listing copy for a fine art print shop. Return ONLY valid JSON — no markdown code fences, no preamble, no trailing commentary.

${subjectBlock}

${trendBlock}

${tagBlock}

${sizesBlock}

Hard rules (must follow exactly, no exceptions):
- Produce exactly ${LISTING_VARIATIONS.length} listing variations, one each for these angles: ${LISTING_VARIATIONS.join(', ')}.
- Each title: max ${SHOP_CONVENTIONS.maxTitleLength} characters total, with sections separated by " ${SHOP_CONVENTIONS.titleSeparator} ".
- Never mention frames or framing in any title.
- Never disclose, imply, or hint that the artwork or listing was AI-generated.
- Never include delivery or shipping timing details in the description.
- Each listing needs exactly ${SHOP_CONVENTIONS.tagsPerListing} tags plus ${SHOP_CONVENTIONS.tagAlternates} alternate tags, each tag max ${SHOP_CONVENTIONS.maxTagLength} characters.

Respond with exactly this JSON shape:
{
  "variations": [
    { "angle": "fine_art", "title": "...", "description": "...", "tags": ["...", "... (${SHOP_CONVENTIONS.tagsPerListing} total)"], "tag_alternates": ["...", "... (${SHOP_CONVENTIONS.tagAlternates} total)"] },
    { "angle": "aesthetic", "title": "...", "description": "...", "tags": [...], "tag_alternates": [...] },
    { "angle": "gift", "title": "...", "description": "...", "tags": [...], "tag_alternates": [...] }
  ]
}`;
}
