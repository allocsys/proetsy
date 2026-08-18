// Shared pipeline module display metadata.
//
// Keys must match the module names in backend/config/pipeline.config.json
// (image_analyzer, listing_generator, mockup_composer), not display-friendly
// slugs -- `mod.module` from GET /api/config/pipeline is looked up directly
// against this object wherever it's used. See
// docs/known-issues/frontend-rebuild-logic-review-2026-08-12.md #7.
//
// Previously this object was duplicated independently in UploadView.jsx and
// SettingsView.jsx (with slightly different key names: `description` vs
// `desc`). This is now the single source of truth for both. Consumers that
// need the shorter key should destructure `description` themselves.
export const PIPELINE_MODULE_LABELS = {
  image_analyzer: {
    name: 'Image Analyzer',
    description: 'Analyzes artwork for colors, style, and composition',
  },
  listing_generator: {
    name: 'Listing Generator',
    description: 'Creates Etsy-optimized titles, descriptions, and tags',
  },
  mockup_composer: {
    name: 'Mockup Composer',
    description: 'Generates product mockups using PSD templates',
  },
};

// Fallback label for any module not present in PIPELINE_MODULE_LABELS above
// (e.g. a newly added backend module the frontend hasn't been updated for yet).
export function getModuleLabel(moduleName) {
  return PIPELINE_MODULE_LABELS[moduleName] || {
    name: moduleName,
    description: 'Pipeline module',
  };
}

// Human-readable summary of a pipeline config's enabled modules, e.g.
// "Image Analyzer, Listing Generator, Mockup Composer". Used by UploadView's
// collapsed "Using default pipeline" summary so it doesn't need its own
// formatting logic.
export function summarizeEnabledModules(pipelineModules) {
  if (!Array.isArray(pipelineModules) || pipelineModules.length === 0) return '';
  return pipelineModules
    .filter((mod) => mod.enabled)
    .map((mod) => getModuleLabel(mod.module).name)
    .join(', ');
}
