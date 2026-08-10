import { getShopConventions } from '../../config/index.js';

const STYLIZE_RE = /--s(?:tylize)?\s+(\d+)/i;
const AR_RE = /--ar\s+\d+:\d+/i;
const VERSION_RE = /--v\s+7\b/i;
const STYLE_RAW_RE = /--style\s+raw/i;

/**
 * Enforces the shop's current Midjourney conventions (dashboard-editable, see
 * config/index.js's getShopConventions().midjourney) on one generated prompt string. The
 * prompt already asks the model for these (see buildPromptHelperPrompt), but this is the
 * belt-and-braces backstop — same pattern as listing-generator/validate.js's
 * enforceConventions — so a convention violation never reaches the dashboard even if the
 * model drifts. Reads conventions fresh on every call (no caching), so a dashboard edit
 * takes effect on the next generation without a restart. Appends any missing flag rather
 * than rejecting the prompt outright (a missing flag is fixable; nothing about a
 * prompt's descriptive text is validated or rewritten here), and clamps an out-of-range
 * --s value into [stylizeMin, stylizeMax] rather than dropping it.
 *
 * @param {string} promptText
 * @param {string} orientation - drives which --ar value gets appended if missing; no --ar is added for an unrecognized orientation (the shop's aspectRatioByOrientation has no entry for it)
 * @returns {{ text: string, warnings: string[] }}
 */
export function enforceMidjourneyConventions(promptText, orientation) {
  const MIDJOURNEY_CONVENTIONS = getShopConventions().midjourney;
  const warnings = [];
  let text = (promptText || '').trim();

  if (!VERSION_RE.test(text)) {
    text += ` ${MIDJOURNEY_CONVENTIONS.version}`;
    warnings.push(`Added missing ${MIDJOURNEY_CONVENTIONS.version} flag`);
  }
  if (!STYLE_RAW_RE.test(text)) {
    text += ` ${MIDJOURNEY_CONVENTIONS.style}`;
    warnings.push(`Added missing ${MIDJOURNEY_CONVENTIONS.style} flag`);
  }

  const aspectRatio = MIDJOURNEY_CONVENTIONS.aspectRatioByOrientation[orientation];
  if (aspectRatio && !AR_RE.test(text)) {
    text += ` --ar ${aspectRatio}`;
    warnings.push(`Added missing --ar ${aspectRatio} flag for orientation "${orientation}"`);
  }

  const stylizeMatch = text.match(STYLIZE_RE);
  if (!stylizeMatch) {
    text += ` --s ${MIDJOURNEY_CONVENTIONS.defaultStylize}`;
    warnings.push(`Added missing --s flag (default ${MIDJOURNEY_CONVENTIONS.defaultStylize})`);
  } else {
    const value = Number(stylizeMatch[1]);
    if (value < MIDJOURNEY_CONVENTIONS.stylizeMin || value > MIDJOURNEY_CONVENTIONS.stylizeMax) {
      const clamped = Math.min(Math.max(value, MIDJOURNEY_CONVENTIONS.stylizeMin), MIDJOURNEY_CONVENTIONS.stylizeMax);
      text = text.replace(STYLIZE_RE, `--s ${clamped}`);
      warnings.push(
        `Clamped --s ${value} to shop range [${MIDJOURNEY_CONVENTIONS.stylizeMin}, ${MIDJOURNEY_CONVENTIONS.stylizeMax}] -> ${clamped}`
      );
    }
  }

  return { text: text.trim(), warnings };
}
