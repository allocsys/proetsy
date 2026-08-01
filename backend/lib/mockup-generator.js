import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import smartcrop from 'smartcrop-jimp';
import { readPsd } from 'ag-psd';
import pureimage from 'pureimage';
import { getDb } from '../db/init.js';
import { getProductSizes } from '../config/index.js';
import { ensurePsdCanvasInitialized } from './psd-canvas.js';
import { generateImage } from './llm/index.js';
import {
  DEFAULT_PLACEMENT_LAYER,
  detectTemplateKind,
  findPlacementLayer,
  flattenPaintOrder,
  resolvePlacementBounds,
} from './psd-template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Backend package root (mirrors backend/db/init.js's __dirname-based approach) — paths
// below are resolved against this, not process.cwd(), so behavior doesn't depend on
// where `node server.js` happens to be launched from.
const BACKEND_ROOT = path.join(__dirname, '..');

const TEMPLATES_BASE_DIR = process.env.MOCKUP_TEMPLATES_DIR
  ? path.resolve(process.cwd(), process.env.MOCKUP_TEMPLATES_DIR)
  : BACKEND_ROOT;
const OUTPUT_DIR = process.env.MOCKUP_OUTPUT_DIR
  ? path.resolve(process.cwd(), process.env.MOCKUP_OUTPUT_DIR)
  : path.join(BACKEND_ROOT, 'data', 'mockups');

// See ARCHITECTURE.md -> Module 3 -> "Aspect-ratio mismatch handling". Below this ratio,
// mismatches always go through content-aware smart-crop; at/above it, AI outpainting is
// attempted first (via resolveArtworkForTarget() below), with smart-crop as the guaranteed
// fallback if the outpaint call fails for any reason.
const LARGE_MISMATCH_RATIO = process.env.MOCKUP_LARGE_MISMATCH_RATIO
  ? Number(process.env.MOCKUP_LARGE_MISMATCH_RATIO)
  : 0.35;

function resolveBackendPath(p) {
  return path.isAbsolute(p) ? p : path.join(BACKEND_ROOT, p);
}

/**
 * Pure mismatch-ratio calculation, split out of composeMockup so it's unit-testable
 * without needing real image files. See ARCHITECTURE.md -> Module 3 -> "Aspect-ratio
 * mismatch handling".
 * @param {number} artRatio
 * @param {number} targetRatio
 * @returns {number}
 */
export function computeMismatchRatio(artRatio, targetRatio) {
  return Math.abs(artRatio - targetRatio) / targetRatio;
}

function outpaintFailureWarning(sizeKey, mismatch, err) {
  return (
    `Artwork aspect ratio differs from the "${sizeKey}" template by ${(mismatch * 100).toFixed(1)}% ` +
    `(large mismatch). AI outpainting was attempted but failed (${err.message}) — falling back to ` +
    'a content-aware smart crop instead.'
  );
}

/**
 * Content-aware crop-and-resize shared by both the flat-PNG and PSD compositing paths.
 * Never a blind center-crop, per ARCHITECTURE.md -> Module 3. The crop rect smartcrop
 * returns is in the *original* artwork's pixel coordinate space, at the target aspect
 * ratio but not necessarily the exact target pixel dimensions, so a resize to
 * (targetWidth, targetHeight) still follows the crop.
 * @param {Jimp} artwork
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {Promise<Jimp>}
 */
async function smartCropAndResize(artwork, targetWidth, targetHeight) {
  const { topCrop } = await smartcrop.crop(artwork, { width: targetWidth, height: targetHeight });
  return artwork.clone().crop(topCrop.x, topCrop.y, topCrop.width, topCrop.height).resize(targetWidth, targetHeight);
}

/**
 * Copies a Jimp image's pixels into a pureimage Bitmap. Both store pixels as a flat
 * RGBA Uint8(Clamped)Array in row-major order, so this is a direct byte copy — no channel
 * reordering needed. Used to hand a smart-cropped artwork off to the PSD compositing path,
 * which draws onto a pureimage canvas (see psd-canvas.js for why pureimage, not
 * node-canvas).
 * @param {Jimp} jimpImage
 * @returns {import('pureimage').Bitmap}
 */
function jimpToPureimageBitmap(jimpImage) {
  const { width, height, data } = jimpImage.bitmap;
  const bitmap = pureimage.make(width, height);
  bitmap.data.set(data);
  return bitmap;
}

/**
 * Builds the outpaint prompt for extending artwork to a target pixel size via AI
 * outpainting. Kept as its own pure function, separate from the network-calling code
 * below, so the prompt wording is unit-testable and can be iterated on without touching
 * outpaintArtwork(). See ARCHITECTURE.md -> Module 3 -> "Aspect-ratio mismatch handling"
 * -> "Large mismatch → AI outpainting".
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {string}
 */
export function buildOutpaintPrompt(targetWidth, targetHeight) {
  return (
    `Extend this artwork outward to fill a ${targetWidth}x${targetHeight} pixel canvas ` +
    `(aspect ratio ${(targetWidth / targetHeight).toFixed(3)}). Keep the original artwork's ` +
    "subject, composition, palette, and style completely unchanged in its current position " +
    'and scale — do not crop, shrink, warp, or recompose it. Generatively fill in only the ' +
    'new border area around it with plausible, stylistically-matched content that continues ' +
    'the existing scene, texture, and lighting outward, as if the original canvas had simply ' +
    'been larger to begin with. The result should read as a single seamless piece of art, ' +
    'not artwork placed on top of a different background.'
  );
}

/**
 * Standalone AI-outpainting call — takes artwork + target pixel dimensions, builds the
 * prompt, calls generateImage(), and returns the extended image as a Jimp instance.
 * **Not wired into composeMockup yet** (see ARCHITECTURE.md -> Module 3 ->
 * "AI-outpainting fallback" step 4 — the mismatch-triggered call + smart-crop-on-failure
 * fallback wiring is that step's job, not this function's). This function itself always
 * throws on failure rather than falling back to anything, by design — callers decide what
 * "fallback" means once step 4 wires it in.
 *
 * generateImage() takes an image *path*, not a Jimp instance (see gemini.js), so this
 * writes the artwork to a temp file for the call and best-effort cleans it up afterward
 * (cleanup failure is logged, not thrown — it shouldn't fail an otherwise-successful
 * outpaint).
 *
 * @param {Jimp} artwork - the source artwork, already loaded
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @returns {Promise<Jimp>}
 */
export async function outpaintArtwork(artwork, targetWidth, targetHeight) {
  const prompt = buildOutpaintPrompt(targetWidth, targetHeight);

  const tempPath = path.join(
    os.tmpdir(),
    `outpaint-src-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  );
  await artwork.writeAsync(tempPath);

  let result;
  try {
    result = await generateImage(prompt, tempPath);
  } finally {
    fs.promises.rm(tempPath, { force: true }).catch((err) => {
      console.warn(`outpaintArtwork: failed to clean up temp file ${tempPath}:`, err.message);
    });
  }

  const imageBuffer = Buffer.from(result.data, 'base64');
  return Jimp.read(imageBuffer);
}

/**
 * Resolves BOTH candidate variants (smart-crop and, when triggered and successful, AI-
 * extended) resized to exactly (targetWidth, targetHeight), per ARCHITECTURE.md -> Module
 * 3 -> "Aspect-ratio mismatch handling" -> "Review step": when both approaches are viable
 * they're shown side by side and the user picks, so this always computes the smart-crop
 * variant (the guaranteed fallback / default selection) and, when the mismatch is large,
 * *additionally* attempts AI outpainting rather than replacing smart-crop with it. Shared
 * by both composeMockupFlat and composeMockupPsd since the mismatch-handling *decision*
 * doesn't depend on template kind — only what targetWidth/targetHeight mean differs
 * between them (full canvas vs. placement-layer bounds).
 *
 * `aiExtended` is null when the mismatch is small (outpainting isn't attempted at all) or
 * when an attempted outpaint failed. On failure, an explanatory entry is pushed to
 * `warnings` (flagged, not hidden — consistent with this doc's Partial Failure Handling
 * principle) but nothing throws from this function; only a smart-crop failure would
 * propagate up, since smart-crop must remain the guaranteed fallback.
 *
 * @param {Jimp} artwork
 * @param {number} targetWidth
 * @param {number} targetHeight
 * @param {number} mismatch - precomputed via computeMismatchRatio()
 * @param {string} sizeKey
 * @param {string[]} warnings - mutated in place
 * @returns {Promise<{ smartCrop: Jimp, aiExtended: Jimp | null }>}
 */
async function resolveArtworkVariants(artwork, targetWidth, targetHeight, mismatch, sizeKey, warnings) {
  const smartCrop = await smartCropAndResize(artwork, targetWidth, targetHeight);

  if (mismatch < LARGE_MISMATCH_RATIO) {
    return { smartCrop, aiExtended: null };
  }

  try {
    const outpainted = await outpaintArtwork(artwork, targetWidth, targetHeight);
    // The model isn't guaranteed to return exactly targetWidth x targetHeight pixels, so
    // resize to fit exactly — the same guarantee smart-crop already provides.
    return { smartCrop, aiExtended: outpainted.resize(targetWidth, targetHeight) };
  } catch (err) {
    warnings.push(outpaintFailureWarning(sizeKey, mismatch, err));
    return { smartCrop, aiExtended: null };
  }
}

/**
 * Composes a mockup against a flat PNG/JPEG template.
 *
 * Compositing convention (spec-filling decision — product-sizes.json has no placement
 * rect, see ARCHITECTURE.md -> Module 3): the template PNG's own pixel dimensions ARE the
 * full output canvas, and the template is layered ON TOP of the (cropped+resized)
 * artwork. This means the template image must have a transparent "window" the size of the
 * print area, with opaque frame/background graphics everywhere else — that's what lets a
 * single generic composite step work for any template without per-size placement
 * metadata. Documented here and in ARCHITECTURE.md -> Module 3.
 *
 * @param {Jimp} artwork
 * @param {string} templatePath
 * @param {string} sizeKey
 * @returns {Promise<{ composed: Jimp, composedAiExtended: Jimp | null, warnings: string[] }>}
 */
async function composeMockupFlat(artwork, templatePath, sizeKey) {
  const template = await Jimp.read(templatePath);

  // The template's own pixel size is canonical for the target aspect ratio — not the
  // human-readable `dimensions` string in product-sizes.json (e.g. "8x10"), which is
  // print-size/DPI metadata, not necessarily the template PNG's exact pixel ratio.
  const targetWidth = template.bitmap.width;
  const targetHeight = template.bitmap.height;
  const targetRatio = targetWidth / targetHeight;
  const artRatio = artwork.bitmap.width / artwork.bitmap.height;
  const mismatch = computeMismatchRatio(artRatio, targetRatio);

  const warnings = [];
  const { smartCrop, aiExtended } = await resolveArtworkVariants(artwork, targetWidth, targetHeight, mismatch, sizeKey, warnings);
  // Template on top, artwork as the base layer — see compositing convention above.
  // Default blend mode (source-over) is correct here: the template's transparent
  // window lets the artwork show through, its opaque areas cover it. `template` is only
  // ever the composite *source*, so compositing it onto two separate receivers below
  // (smartCrop, aiExtended) doesn't require cloning it — Jimp's composite() mutates and
  // returns the receiver, not the source.
  const composed = smartCrop.composite(template, 0, 0);
  const composedAiExtended = aiExtended ? aiExtended.composite(template, 0, 0) : null;

  return { composed, composedAiExtended, warnings };
}

/**
 * Composes a mockup against a layered PSD template. See ARCHITECTURE.md -> Module 3 ->
 * "Template formats" for the full design rationale (placement-layer convention, the
 * ag-psd + pureimage canvas shim, and the known warp-transform limitation).
 *
 * Placement is layer-based, not whole-canvas: the artwork is smart-cropped/resized to the
 * named placement layer's own pixel bounds (not the full document canvas), then every
 * visible PSD layer is rendered in its original stacking order onto a canvas the size of
 * the full document, substituting the artwork bitmap in for the placement layer's own
 * pixel data.
 *
 * Known, accepted limitation (documented in ARCHITECTURE.md, repeated here since it's
 * exactly the code path it applies to): this does not re-evaluate Photoshop smart-object
 * warp/perspective transforms — the artwork is placed as an unwarped, axis-aligned
 * rectangle within the placement layer's bounding box, not warped to match a photographed
 * frame's angle if the template's smart object was originally warped.
 *
 * @param {Jimp} artwork
 * @param {string} templatePath
 * @param {object} sizeEntry - the product-sizes.json entry (for `placement_layer`)
 * @param {string} sizeKey
 * @returns {Promise<{ canvas: import('pureimage').Bitmap, canvasAiExtended: import('pureimage').Bitmap | null, warnings: string[] }>}
 */
async function composeMockupPsd(artwork, templatePath, sizeEntry, sizeKey) {
  ensurePsdCanvasInitialized();

  const psdBuffer = fs.readFileSync(templatePath);
  const psd = readPsd(psdBuffer, { useImageData: false });

  const placementLayerName = sizeEntry.placement_layer || DEFAULT_PLACEMENT_LAYER;
  const placementLayer = findPlacementLayer(psd.children, placementLayerName);
  if (!placementLayer) {
    throw new Error(
      `PSD template "${templatePath}" has no layer named "${placementLayerName}" ` +
        `(product size "${sizeKey}"'s placement_layer). Check the template's layer names in Photoshop.`
    );
  }
  const bounds = resolvePlacementBounds(placementLayer);

  const targetRatio = bounds.width / bounds.height;
  const artRatio = artwork.bitmap.width / artwork.bitmap.height;
  const mismatch = computeMismatchRatio(artRatio, targetRatio);

  const warnings = [];
  const { smartCrop, aiExtended } = await resolveArtworkVariants(artwork, bounds.width, bounds.height, mismatch, sizeKey, warnings);

  const canvas = paintPsdCanvas(psd, placementLayer, bounds, jimpToPureimageBitmap(smartCrop));
  const canvasAiExtended = aiExtended
    ? paintPsdCanvas(psd, placementLayer, bounds, jimpToPureimageBitmap(aiExtended))
    : null;

  return { canvas, canvasAiExtended, warnings };
}

/**
 * Renders every visible PSD layer, in stacking order, onto a fresh canvas the size of the
 * full document, substituting `artworkBitmap` in for the placement layer's own pixel data
 * — the actual compositing step shared by both composeMockupPsd variants (smart-crop and
 * AI-extended). Split out of composeMockupPsd in outpainting sub-step 6 so it can be
 * called once per variant instead of duplicating the paint loop inline.
 *
 * @param {object} psd - parsed PSD document (from ag-psd's readPsd)
 * @param {object} placementLayer - the PSD layer node being substituted
 * @param {{ left: number, top: number, width: number, height: number }} bounds - placementLayer's resolved bounds
 * @param {import('pureimage').Bitmap} artworkBitmap - artwork already sized to (bounds.width, bounds.height)
 * @returns {import('pureimage').Bitmap}
 */
function paintPsdCanvas(psd, placementLayer, bounds, artworkBitmap) {
  const outputCanvas = pureimage.make(psd.width, psd.height);
  const outputCtx = outputCanvas.getContext('2d');

  // Paint in stacking order (bottom-most first) so later layers correctly cover earlier
  // ones — see flattenPaintOrder's doc comment for the array-order convention.
  for (const layer of flattenPaintOrder(psd.children)) {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    outputCtx.globalAlpha = layer.opacity ?? 1;

    if (layer === placementLayer) {
      // Substitute the artwork bitmap for this layer's own pixel data, positioned at the
      // *original* placement layer's bounds — this is the actual placement step.
      outputCtx.drawImage(artworkBitmap, 0, 0, bounds.width, bounds.height, bounds.left, bounds.top, bounds.width, bounds.height);
    } else {
      const layerWidth = (layer.right ?? 0) - (layer.left ?? 0);
      const layerHeight = (layer.bottom ?? 0) - (layer.top ?? 0);
      outputCtx.drawImage(layer.canvas, 0, 0, layerWidth, layerHeight, left, top, layerWidth, layerHeight);
    }
  }
  outputCtx.globalAlpha = 1;

  return outputCanvas;
}

function writePureimagePng(canvas, outputPath) {
  return pureimage.encodePNGToStream(canvas, fs.createWriteStream(outputPath));
}

/**
 * Composes a mockup for one artwork + product size. Dispatches to the flat-PNG or PSD
 * compositing path based on the template file's extension (see psd-template.js ->
 * detectTemplateKind) — no separate config flag needed, per ARCHITECTURE.md -> Module 3.
 *
 * @param {string} artworkPath - path to the source artwork image
 * @param {string} sizeKey - key into product-sizes.json (e.g. "8x10-portrait")
 * @returns {Promise<{ outputPath: string, aiExtendedPath: string | null, warnings: string[] }>}
 */
export async function composeMockup(artworkPath, sizeKey) {
  const productSizesConfig = getProductSizes();
  const sizeEntry = productSizesConfig[sizeKey];
  if (!sizeEntry) {
    throw new Error(`Unknown product size "${sizeKey}" — not found in product-sizes.json`);
  }
  if (!sizeEntry.mockup_template) {
    throw new Error(`Product size "${sizeKey}" has no mockup_template configured`);
  }

  const resolvedArtworkPath = resolveBackendPath(artworkPath);
  const templatePath = path.join(TEMPLATES_BASE_DIR, sizeEntry.mockup_template);

  if (!fs.existsSync(resolvedArtworkPath)) {
    throw new Error(`Artwork file not found: ${resolvedArtworkPath}`);
  }
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Mockup template not found: ${templatePath}`);
  }

  const artwork = await Jimp.read(resolvedArtworkPath);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const artworkBase = path.basename(resolvedArtworkPath, path.extname(resolvedArtworkPath));
  const timestamp = Date.now();
  // `file_path`'s naming (no suffix) is unchanged from before this pass, so existing
  // readers of that column keep working; the AI-extended variant gets its own file next
  // to it, only written when an outpaint attempt actually succeeded.
  const outputPath = path.join(OUTPUT_DIR, `${artworkBase}-${sizeKey}-${timestamp}.png`);
  const aiExtendedOutputPath = path.join(OUTPUT_DIR, `${artworkBase}-${sizeKey}-${timestamp}-ai-extended.png`);

  if (detectTemplateKind(templatePath) === 'psd') {
    const { canvas, canvasAiExtended, warnings } = await composeMockupPsd(artwork, templatePath, sizeEntry, sizeKey);
    await writePureimagePng(canvas, outputPath);
    let aiExtendedPath = null;
    if (canvasAiExtended) {
      await writePureimagePng(canvasAiExtended, aiExtendedOutputPath);
      aiExtendedPath = aiExtendedOutputPath;
    }
    return { outputPath, aiExtendedPath, warnings };
  }

  const { composed, composedAiExtended, warnings } = await composeMockupFlat(artwork, templatePath, sizeKey);
  await composed.writeAsync(outputPath);
  let aiExtendedPath = null;
  if (composedAiExtended) {
    await composedAiExtended.writeAsync(aiExtendedOutputPath);
    aiExtendedPath = aiExtendedOutputPath;
  }
  return { outputPath, aiExtendedPath, warnings };
}

/**
 * Runs Module 3 for a job: loads the job's artwork, composes the mockup, and persists
 * results. Closes a gap noted in ARCHITECTURE.md's `product_sizes` table — it's currently
 * never populated from product-sizes.json — by upserting a row for `sizeKey` (keyed on
 * `size_key`) before writing to `mockups`, since `mockups.product_size_id` is an FK that
 * needs a row to point at. Both upserts follow the same idempotent `ON CONFLICT`
 * overwrite pattern already used in backend/lib/listing-generator/index.js for the
 * `listings` table (UNIQUE(job_id, product_size_id) makes a re-run replace, not
 * duplicate — see ARCHITECTURE.md -> Partial Failure Handling -> Idempotency).
 *
 * Also persists the AI-outpainting review state (ARCHITECTURE.md -> Module 3 ->
 * "AI-outpainting fallback" step 6): `ai_extended_path` when composeMockup() produced one,
 * `needs_review` set whenever it did (there's a real choice for the user to make),
 * `selected_variant` reset to the `'smart_crop'` default on every run — a fresh run
 * produces brand-new candidate files, so any previous selection from an earlier run no
 * longer corresponds to what's on disk now.
 *
 * @param {number} jobId
 * @param {string} sizeKey
 * @returns {Promise<{ outputPath: string, aiExtendedPath: string | null, warnings: string[] }>}
 */
export async function generateMockupForJob(jobId, sizeKey) {
  const db = getDb();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(job.artwork_id);
  if (!artwork) throw new Error(`Artwork for job ${jobId} not found`);

  const { outputPath, aiExtendedPath, warnings } = await composeMockup(artwork.file_path, sizeKey);

  const productSizesConfig = getProductSizes();
  const sizeEntry = productSizesConfig[sizeKey];

  const upsertProductSize = db.prepare(`
    INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer)
    VALUES (@size_key, @dimensions, @dpi, @orientation, @mockup_template_path, @placement_layer)
    ON CONFLICT(size_key) DO UPDATE SET
      dimensions = excluded.dimensions,
      dpi = excluded.dpi,
      orientation = excluded.orientation,
      mockup_template_path = excluded.mockup_template_path,
      placement_layer = excluded.placement_layer
  `);
  upsertProductSize.run({
    size_key: sizeKey,
    dimensions: sizeEntry.dimensions || null,
    dpi: sizeEntry.dpi || null,
    orientation: sizeEntry.orientation || null,
    mockup_template_path: sizeEntry.mockup_template,
    // Nullable — only meaningful for .psd templates, see ARCHITECTURE.md -> Module 3 ->
    // "Template formats". Left null for flat PNG/JPEG templates.
    placement_layer: sizeEntry.placement_layer || null,
  });

  const productSizeRow = db.prepare('SELECT id FROM product_sizes WHERE size_key = ?').get(sizeKey);

  const upsertMockup = db.prepare(`
    INSERT INTO mockups (job_id, product_size_id, file_path, status, ai_extended_path, smart_crop_path, needs_review, selected_variant)
    VALUES (@job_id, @product_size_id, @file_path, 'success', @ai_extended_path, @smart_crop_path, @needs_review, 'smart_crop')
    ON CONFLICT(job_id, product_size_id) DO UPDATE SET
      file_path = excluded.file_path,
      status = excluded.status,
      ai_extended_path = excluded.ai_extended_path,
      smart_crop_path = excluded.smart_crop_path,
      needs_review = excluded.needs_review,
      selected_variant = 'smart_crop'
  `);
  upsertMockup.run({
    job_id: jobId,
    product_size_id: productSizeRow.id,
    file_path: outputPath,
    ai_extended_path: aiExtendedPath,
    // Same value as file_path at generation time (both point at the smart-crop output) —
    // stored separately so it survives file_path later being synced to ai_extended_path
    // by the PATCH variant route. See schema.sql for the full rationale.
    smart_crop_path: outputPath,
    needs_review: aiExtendedPath ? 1 : 0,
  });

  return { outputPath, aiExtendedPath, warnings };
}
