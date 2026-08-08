import { getShopConventions } from '../../config/index.js';

function stripForbiddenPhrases(text, phrases) {
  if (!text) return { text, hits: [] };
  let cleaned = text;
  const hits = [];
  for (const phrase of phrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'ig');
    if (re.test(cleaned)) {
      hits.push(phrase);
      cleaned = cleaned.replace(re, '').replace(/\s{2,}/g, ' ').trim();
    }
  }
  return { text: cleaned, hits };
}

// Enforces the shop's current conventions (dashboard-editable, see
// config/index.js's getShopConventions()) on one generated variation. The prompt already
// asks the model for these — this is the belt-and-braces backstop so a convention
// violation never reaches the dashboard even if the model drifts. Reads conventions
// fresh on every call (no caching), so a dashboard edit takes effect on the very next
// generation/manual-edit without a restart. Returns the cleaned variation plus a
// `warnings` list surfaced to the reviewer, never silently dropped.
export function enforceConventions(variation) {
  const SHOP_CONVENTIONS = getShopConventions().listing;
  const warnings = [];

  let title = variation.title || '';
  const { text: titleNoFrames, hits: frameHits } = stripForbiddenPhrases(title, SHOP_CONVENTIONS.forbiddenTitleWords);
  title = titleNoFrames;
  if (frameHits.length) warnings.push(`Removed frame reference(s) from title: ${frameHits.join(', ')}`);
  if (title.length > SHOP_CONVENTIONS.maxTitleLength) {
    title = title.slice(0, SHOP_CONVENTIONS.maxTitleLength).trim();
    warnings.push(`Title truncated to ${SHOP_CONVENTIONS.maxTitleLength} characters`);
  }

  let description = variation.description || '';
  const { text: descNoAi, hits: aiHits } = stripForbiddenPhrases(description, SHOP_CONVENTIONS.aiDisclosurePhrases);
  description = descNoAi;
  if (aiHits.length) warnings.push(`Removed AI-disclosure phrase(s): ${aiHits.join(', ')}`);
  const { text: descNoDelivery, hits: deliveryHits } = stripForbiddenPhrases(
    description,
    SHOP_CONVENTIONS.deliveryDetailPhrases
  );
  description = descNoDelivery;
  if (deliveryHits.length) warnings.push(`Removed delivery-detail phrase(s): ${deliveryHits.join(', ')}`);

  let tags = Array.isArray(variation.tags) ? variation.tags : [];
  const oversizedTags = tags.filter((t) => typeof t === 'string' && t.length > SHOP_CONVENTIONS.maxTagLength);
  tags = tags
    .filter((t) => typeof t === 'string' && t.length > 0 && t.length <= SHOP_CONVENTIONS.maxTagLength)
    .slice(0, SHOP_CONVENTIONS.tagsPerListing);
  if (oversizedTags.length) warnings.push(`Dropped ${oversizedTags.length} tag(s) over ${SHOP_CONVENTIONS.maxTagLength} chars`);
  if (tags.length < SHOP_CONVENTIONS.tagsPerListing) {
    warnings.push(`Only ${tags.length}/${SHOP_CONVENTIONS.tagsPerListing} tags after filtering — needs manual review before publishing`);
  }

  let tagAlternates = Array.isArray(variation.tag_alternates) ? variation.tag_alternates : [];
  tagAlternates = tagAlternates
    .filter((t) => typeof t === 'string' && t.length > 0 && t.length <= SHOP_CONVENTIONS.maxTagLength)
    .slice(0, SHOP_CONVENTIONS.tagAlternates);

  return {
    angle: variation.angle,
    title,
    description,
    tags,
    tagAlternates,
    warnings,
  };
}
