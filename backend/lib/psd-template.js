// Pure, IO-free helpers for PSD template handling — split out of mockup-generator.js so
// they're unit-testable without mocking file reads or the ag-psd canvas shim. See
// ARCHITECTURE.md -> Module 3 -> "Template formats".

import path from 'node:path';
import pureimage from 'pureimage';

// Matches product-sizes.json's documented default (see ARCHITECTURE.md -> Module 3 ->
// "Template formats": "`placement_layer` ... defaults to `"artwork"` if the field is
// omitted").
export const DEFAULT_PLACEMENT_LAYER = 'artwork';

/**
 * Which kind of template a `mockup_template` path is, inferred from its extension — no
 * separate config flag needed (per ARCHITECTURE.md -> Module 3 -> "Template formats").
 * @param {string} templatePath
 * @returns {'psd' | 'flat'}
 */
export function detectTemplateKind(templatePath) {
  return path.extname(templatePath).toLowerCase() === '.psd' ? 'psd' : 'flat';
}

/**
 * Recursively searches a PSD's layer tree (including nested groups) for the first layer
 * matching `placementLayerName`, case-sensitively (PSD layer names are user-authored
 * strings — a template author who names two layers the same casing but different case
 * elsewhere would be surprised by silent case-folding).
 * @param {import('ag-psd').Layer[] | undefined} layers
 * @param {string} placementLayerName
 * @returns {import('ag-psd').Layer | null}
 */
export function findPlacementLayer(layers, placementLayerName) {
  if (!layers) return null;
  for (const layer of layers) {
    if (layer.name === placementLayerName) return layer;
    if (layer.children) {
      const found = findPlacementLayer(layer.children, placementLayerName);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolves a placement layer's pixel bounds to a plain {width, height, left, top} rect —
 * the shape composeMockupFromPsd's smart-crop/resize step needs. Separated from
 * findPlacementLayer so bounds math (which has an actual edge case: a layer with no
 * pixels can have left/top/right/bottom all 0 or undefined) is independently testable.
 * @param {import('ag-psd').Layer} layer
 * @returns {{ left: number, top: number, width: number, height: number }}
 */
export function resolvePlacementBounds(layer) {
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const right = layer.right ?? left;
  const bottom = layer.bottom ?? top;
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) {
    throw new Error(
      `Placement layer "${layer.name}" has empty or invalid bounds (${width}x${height}) — ` +
        'it needs actual pixel bounds in the PSD, not just a name.'
    );
  }
  return { left, top, width, height };
}

/**
 * Flattens a PSD layer tree into paint order (bottom-most first) as a list of
 * { layer, depth } — depth-first per ag-psd's array convention (children[0] = bottommost
 * within its parent). Groups themselves are skipped (no canvas to draw); only leaf layers
 * with a canvas are yielded. A hidden group hides everything under it even if a child
 * layer's own `hidden` flag is false, matching Photoshop's visibility semantics.
 * @param {import('ag-psd').Layer[] | undefined} layers
 * @param {boolean} ancestorHidden
 * @returns {import('ag-psd').Layer[]}
 */
export function flattenPaintOrder(layers, ancestorHidden = false) {
  if (!layers) return [];
  const result = [];
  for (const layer of layers) {
    const effectivelyHidden = ancestorHidden || layer.hidden === true;
    if (layer.children) {
      result.push(...flattenPaintOrder(layer.children, effectivelyHidden));
    } else if (!effectivelyHidden && layer.canvas) {
      result.push(layer);
    }
  }
  return result;
}

/**
 * Renders every visible PSD layer, in stacking order, onto a fresh canvas sized to the
 * full document — the actual compositing step shared by real mockup composition
 * (mockup-generator.js's composeMockupPsd, which substitutes artwork into the placement
 * layer) and template-preview generation (backend/lib/mockup-templates/index.js's
 * generateTemplatePreview, which renders the template exactly as authored, no
 * substitution). Extracted out of mockup-generator.js's former standalone
 * `paintPsdCanvas` in the mockup-folder-picker plan (plan.md -> "New module" ->
 * generateTemplatePreview) specifically so both callers share one flattening
 * implementation instead of duplicating the paint loop.
 *
 * @param {object} psd - parsed PSD document (from ag-psd's readPsd)
 * @param {object} [options]
 * @param {object} [options.substituteLayer] - a layer node whose own pixel data should be
 *   skipped in favor of options.substituteBitmap (e.g. the placement layer during real
 *   mockup composition). Omit (along with substituteBitmap) to render every layer exactly
 *   as authored — e.g. for a template preview.
 * @param {import('pureimage').Bitmap} [options.substituteBitmap] - required together with
 *   substituteLayer.
 * @param {{ left: number, top: number, width: number, height: number }} [options.substituteBounds] -
 *   defaults to substituteLayer's own resolved bounds if omitted.
 * @returns {import('pureimage').Bitmap}
 */
export function renderPsdLayers(psd, options = {}) {
  const { substituteLayer, substituteBitmap, substituteBounds } = options;
  const outputCanvas = pureimage.make(psd.width, psd.height);
  const outputCtx = outputCanvas.getContext('2d');

  // Paint in stacking order (bottom-most first) so later layers correctly cover earlier
  // ones — see flattenPaintOrder's doc comment for the array-order convention.
  for (const layer of flattenPaintOrder(psd.children)) {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    outputCtx.globalAlpha = layer.opacity ?? 1;

    if (substituteLayer && layer === substituteLayer) {
      const bounds = substituteBounds || resolvePlacementBounds(layer);
      outputCtx.drawImage(substituteBitmap, 0, 0, bounds.width, bounds.height, bounds.left, bounds.top, bounds.width, bounds.height);
    } else {
      const layerWidth = (layer.right ?? 0) - (layer.left ?? 0);
      const layerHeight = (layer.bottom ?? 0) - (layer.top ?? 0);
      outputCtx.drawImage(layer.canvas, 0, 0, layerWidth, layerHeight, left, top, layerWidth, layerHeight);
    }
  }
  outputCtx.globalAlpha = 1;

  return outputCanvas;
}
