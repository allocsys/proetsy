// Builds the prompt sent to the LLM provider layer's generateVision() call for Module 1
// (Image Analyzer). Pure function (no DB, no network) — the image itself is attached
// separately by generateVision(prompt, imagePath, options); this only builds the text
// half of the request. See ARCHITECTURE.md -> Module 1.
//
// Output feeds two downstream consumers directly, which shapes the requested shape below:
//   - Module 2's buildListingPrompt() JSON.stringifies whatever this returns straight into
//     its own prompt (see listing-generator/prompt.js), so keys should be self-explanatory
//     without extra context.
//   - The tags provider layer's user-list.js matches the shop's tag library against
//     `JSON.stringify(imageAnalysis).toLowerCase()` via plain substring search — so the
//     values need to be concrete, plain, searchable words/phrases, not flowery prose that
//     would never literally match a tag string.
export function buildImageAnalysisPrompt() {
  return `You are analyzing a piece of artwork for an Etsy fine art print shop. Return ONLY valid JSON — no markdown code fences, no preamble, no trailing commentary.

Look at the attached image and describe it for two downstream uses: (1) writing Etsy listing copy, and (2) matching against a tag library via plain substring search. Use concrete, plain, searchable words and phrases — avoid vague or overly poetic language that wouldn't literally match a tag someone would type into Etsy search.

Respond with exactly this JSON shape:
{
  "subject": "short phrase describing what is depicted, e.g. 'a red fox in a snowy forest'",
  "style": "art style/medium, e.g. 'watercolor', 'minimalist line art', 'oil painting', 'digital illustration'",
  "palette": ["dominant color 1", "dominant color 2", "dominant color 3"],
  "mood": "overall mood/feeling, e.g. 'calm', 'whimsical', 'moody', 'energetic'",
  "themes": ["theme or keyword 1", "theme or keyword 2"],
  "notable_elements": ["specific visual detail 1", "specific visual detail 2"],
  "suggested_categories": ["e.g. nursery decor", "botanical", "abstract wall art"]
}`;
}
