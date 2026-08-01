import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import smartcrop from 'smartcrop-jimp';
import { getDb } from '../db/init.js';
import { getProductSizes } from '../config/index.js';

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

// See ARCHITECTURE.md -> Module 3 -> "Aspect-ratio mismatch handling". This pass only
// implements the small-mismatch path (smart-crop); a mismatch at/above this ratio just
// gets flagged with a warning instead of triggering the (not-yet-built) AI-outpainting
// fallback.
const LARGE_MISMATCH_RATIO = process.env.MOCKUP_LARGE_MISMATCH_RATIO
  ? Number(process.env.MOCKUP_LARGE_MISMATCH_RATIO)
  : 0.35;

function resolveBackendPath(p) {
  return path.isAbsolute(p) ? p : path.join(BACKEND_ROOT, p);
}

/**
 * Composes a mockup for one artwork + product size.
 *
 * Compositing convention (spec-filling decision — product-sizes.json has no placement
 * rect, see ARCHITECTURE.md -> Module 3): the template PNG's own pixel dimensions ARE the
 * full output canvas, and the template is layered ON TOP of the (cropped+resized)
 * artwork. This means the template image must have a transparent "window" the size of the
 * print area, with opaque frame/background graphics everywhere else — that's what lets a
 * single generic composite step work for any template without per-size placement
 * metadata. Documented here and in ARCHITECTURE.md -> Module 3.
 *
 * @param {string} artworkPath - path to the source artwork image
 * @param {string} sizeKey - key into product-sizes.json (e.g. "8x10-portrait")
 * @returns {Promise<{ outputPath: string, warnings: string[] }>}
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

  const [artwork, template] = await Promise.all([Jimp.read(resolvedArtworkPath), Jimp.read(templatePath)]);

  // The template's own pixel size is canonical for the target aspect ratio — not the
  // human-readable `dimensions` string in product-sizes.json (e.g. "8x10"), which is
  // print-size/DPI metadata, not necessarily the template PNG's exact pixel ratio. See
  // ARCHITECTURE.md -> Module 3 -> "Aspect-ratio mismatch handling".
  const targetWidth = template.bitmap.width;
  const targetHeight = template.bitmap.height;
  const targetRatio = targetWidth / targetHeight;

  const artRatio = artwork.bitmap.width / artwork.bitmap.height;
  const mismatch = Math.abs(artRatio - targetRatio) / targetRatio;

  const warnings = [];
  if (mismatch >= LARGE_MISMATCH_RATIO) {
    warnings.push(
      `Artwork aspect ratio differs from the "${sizeKey}" template by ${(mismatch * 100).toFixed(1)}% ` +
        '(large mismatch). AI outpainting would preserve more of the artwork than a crop, but that ' +
        'fallback isn\'t implemented in this pass — proceeding with a content-aware smart crop instead.'
    );
  }

  // Always smart-crop — never a blind center-crop, per ARCHITECTURE.md -> Module 3. The
  // crop rect smartcrop returns is in the *original* artwork's pixel coordinate space, at
  // the target aspect ratio but not necessarily the exact target pixel dimensions, so a
  // resize to (targetWidth, targetHeight) still follows the crop.
  const { topCrop } = await smartcrop.crop(artwork, { width: targetWidth, height: targetHeight });

  const composed = artwork
    .clone()
    .crop(topCrop.x, topCrop.y, topCrop.width, topCrop.height)
    .resize(targetWidth, targetHeight)
    // Template on top, artwork as the base layer — see compositing convention above.
    // Default blend mode (source-over) is correct here: the template's transparent
    // window lets the artwork show through, its opaque areas cover it.
    .composite(template, 0, 0);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const artworkBase = path.basename(resolvedArtworkPath, path.extname(resolvedArtworkPath));
  const outputPath = path.join(OUTPUT_DIR, `${artworkBase}-${sizeKey}-${Date.now()}.png`);
  await composed.writeAsync(outputPath);

  return { outputPath, warnings };
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
 * @param {number} jobId
 * @param {string} sizeKey
 * @returns {Promise<{ outputPath: string, warnings: string[] }>}
 */
export async function generateMockupForJob(jobId, sizeKey) {
  const db = getDb();

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  const artwork = db.prepare('SELECT * FROM artworks WHERE id = ?').get(job.artwork_id);
  if (!artwork) throw new Error(`Artwork for job ${jobId} not found`);

  const { outputPath, warnings } = await composeMockup(artwork.file_path, sizeKey);

  const productSizesConfig = getProductSizes();
  const sizeEntry = productSizesConfig[sizeKey];

  const upsertProductSize = db.prepare(`
    INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path)
    VALUES (@size_key, @dimensions, @dpi, @orientation, @mockup_template_path)
    ON CONFLICT(size_key) DO UPDATE SET
      dimensions = excluded.dimensions,
      dpi = excluded.dpi,
      orientation = excluded.orientation,
      mockup_template_path = excluded.mockup_template_path
  `);
  upsertProductSize.run({
    size_key: sizeKey,
    dimensions: sizeEntry.dimensions || null,
    dpi: sizeEntry.dpi || null,
    orientation: sizeEntry.orientation || null,
    mockup_template_path: sizeEntry.mockup_template,
  });

  const productSizeRow = db.prepare('SELECT id FROM product_sizes WHERE size_key = ?').get(sizeKey);

  const upsertMockup = db.prepare(`
    INSERT INTO mockups (job_id, product_size_id, file_path, status)
    VALUES (@job_id, @product_size_id, @file_path, 'success')
    ON CONFLICT(job_id, product_size_id) DO UPDATE SET
      file_path = excluded.file_path,
      status = excluded.status
  `);
  upsertMockup.run({
    job_id: jobId,
    product_size_id: productSizeRow.id,
    file_path: outputPath,
  });

  return { outputPath, warnings };
}
