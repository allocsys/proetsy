// New module (plan.md -> "Backend changes" -> "3. New module:
// backend/lib/mockup-templates/index.js", Rollout step 2): scan a folder of the user's
// own mockup template files (blank frames/canvases/mugs from Etsy mockup packs), list
// which of them are already configured as product-size templates, and create/delete
// that configuration. Sits alongside (not on top of) mockup-generator.js -- this module
// never composes a mockup, it only manages the `product_sizes` DB rows and generates
// small preview thumbnails for the dashboard's folder-picker UI.
//
// resolveTemplatesDir() below is the shared settings-first fallback chain (setting ->
// MOCKUP_TEMPLATES_DIR env -> BACKEND_ROOT). As of Rollout step 3, mockup-generator.js's
// own resolveTemplatesBaseDir() delegates straight to this function rather than
// duplicating the chain -- see mockup-generator.js's doc comment on that function.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import pureimage from 'pureimage';
import { readPsd } from 'ag-psd';
import { getDb } from '../../db/init.js';
import { ensurePsdCanvasInitialized } from '../psd-canvas.js';
import { renderPsdLayers } from '../psd-template.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Backend package root -- mirrors mockup-generator.js's own BACKEND_ROOT derivation.
const BACKEND_ROOT = path.join(__dirname, '..', '..');

export const SETTING_TEMPLATES_DIR = 'mockup_templates_dir';

// Same convention as watcher.js's IMAGE_EXTENSIONS -- flat, not recursive (depth: 0),
// plus .psd since layered templates are a first-class template kind here (unlike the
// taste-filter watcher, which only ever deals with flat candidate images).
const TEMPLATE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.psd']);

// Preview cache dir -- env-override convention matches every other data dir in this app
// (UPLOADS_DIR, CANDIDATES_DIR in server.js; OUTPUT_DIR in mockup-generator.js).
export const PREVIEW_DIR = process.env.MOCKUP_TEMPLATE_PREVIEWS_DIR
  ? path.resolve(process.cwd(), process.env.MOCKUP_TEMPLATE_PREVIEWS_DIR)
  : path.join(BACKEND_ROOT, 'data', 'mockup-template-previews');

// Long edge cap for generated thumbnails -- plenty for a picker grid card, not full res.
const PREVIEW_MAX_EDGE = 400;

// In-process caches, both keyed by `${absolutePath}:${mtimeMs}` so an edited file (same
// path, new mtime) naturally busts the cache instead of serving a stale dimension/preview
// -- same "cache keyed by (path, mtime)" convention the plan calls for. Neither is meant
// to be durable: a backend restart just re-scans/re-generates on first access again,
// which is cheap since "a few hundred mockups" is a one-time/occasional setup action,
// not a hot path (see plan.md -> "New module" -> scanTemplatesFolder).
const dimensionsCache = new Map();
const previewPathCache = new Map();

function cacheKey(filePath, stat) {
  return `${filePath}:${stat.mtimeMs}`;
}

/**
 * Reads the `mockup_templates_dir` setting directly from the settings table (the
 * "folder picker" value the dashboard's folder field saves to -- see plan.md ->
 * "Backend changes" -> "1."). Returns null if unset, same as any other unset settings
 * key.
 * @returns {string | null}
 */
export function getTemplatesDirSetting() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_TEMPLATES_DIR);
  return row?.value || null;
}

/**
 * Resolves "the current templates dir" for this module's own purposes (validating an
 * upsert's referenced file, generating configured-template previews) -- settings-first,
 * falling back to MOCKUP_TEMPLATES_DIR/BACKEND_ROOT, same chain
 * mockup-generator.js's resolveTemplatesBaseDir() will switch to in Rollout step 3.
 * @returns {string}
 */
export function resolveTemplatesDir() {
  const fromSetting = getTemplatesDirSetting();
  if (fromSetting) return fromSetting;
  if (process.env.MOCKUP_TEMPLATES_DIR) {
    return path.resolve(process.cwd(), process.env.MOCKUP_TEMPLATES_DIR);
  }
  return BACKEND_ROOT;
}

function detectKind(filePath) {
  return path.extname(filePath).toLowerCase() === '.psd' ? 'psd' : 'flat';
}

/**
 * Cheap dimension read for the scan grid -- header-only for PSDs (skipLayerImageData),
 * and via Jimp for flat PNG/JPEG (Jimp has no cheap header-only path, but these are
 * template files, not artwork batches -- see plan.md). Cached by (path, mtime).
 * @param {string} filePath
 * @param {'flat' | 'psd'} kind
 * @returns {Promise<{ width: number, height: number }>}
 */
async function readDimensions(filePath, kind) {
  const stat = fs.statSync(filePath);
  const key = cacheKey(filePath, stat);
  if (dimensionsCache.has(key)) return dimensionsCache.get(key);

  let dims;
  if (kind === 'psd') {
    const buffer = fs.readFileSync(filePath);
    const psd = readPsd(buffer, { skipLayerImageData: true });
    dims = { width: psd.width, height: psd.height };
  } else {
    const image = await Jimp.read(filePath);
    dims = { width: image.bitmap.width, height: image.bitmap.height };
  }
  dimensionsCache.set(key, dims);
  return dims;
}

/**
 * Lists every template-ish file directly in `folder` (flat, not recursive -- same
 * depth: 0 convention watcher.js uses), cross-referenced against which ones are already
 * assigned to a product size, so the dashboard grid can show "already used as X" instead
 * of letting the user accidentally double-assign a file. See plan.md -> "New module" ->
 * scanTemplatesFolder.
 *
 * @param {string} folder
 * @returns {Promise<Array<{ filename: string, path: string, width: number, height: number, kind: 'flat' | 'psd', alreadyAssignedTo: string | null }>>}
 */
export async function scanTemplatesFolder(folder) {
  if (!folder) throw new Error('folder is required');
  if (!fs.existsSync(folder)) {
    throw new Error(`Templates folder does not exist: ${folder}`);
  }

  const db = getDb();
  // Keyed by basename, not the raw stored value -- upsertConfiguredTemplate stores
  // mockup_template_path as a filename relative to the templates dir (matching the
  // existing product-sizes.json convention composeMockup() already resolves against
  // TEMPLATES_BASE_DIR), so comparing basenames is what actually lines a scanned file up
  // with a configured row regardless of exactly how the path was stored historically.
  const assignedByFilename = new Map();
  for (const row of db
    .prepare('SELECT size_key, mockup_template_path FROM product_sizes WHERE mockup_template_path IS NOT NULL')
    .all()) {
    assignedByFilename.set(path.basename(row.mockup_template_path), row.size_key);
  }

  const entries = fs.readdirSync(folder, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEMPLATE_EXTENSIONS.has(ext)) continue;

    const filePath = path.join(folder, entry.name);
    const kind = detectKind(filePath);
    const { width, height } = await readDimensions(filePath, kind);

    results.push({
      filename: entry.name,
      path: filePath,
      width,
      height,
      kind,
      alreadyAssignedTo: assignedByFilename.get(entry.name) || null,
    });
  }
  return results;
}

function resizeToMaxEdge(image, maxEdge) {
  const { width, height } = image.bitmap;
  if (width <= maxEdge && height <= maxEdge) return image;
  return width >= height ? image.resize(maxEdge, Jimp.AUTO) : image.resize(Jimp.AUTO, maxEdge);
}

/**
 * Produces a small flattened preview PNG (long edge capped at PREVIEW_MAX_EDGE) for the
 * thumbnail grid, written into PREVIEW_DIR and cached by (path, mtime) so re-opening the
 * picker after the first scan doesn't regenerate every preview. See plan.md -> "New
 * module" -> generateTemplatePreview.
 *
 * PSD templates can't be handed straight to an <img> tag -- this reuses
 * renderPsdLayers() (the same paint-order flattening helper composeMockupPsd() uses,
 * shared out of psd-template.js) to flatten every visible layer exactly as authored (no
 * substitution), then downsizes the flattened result via Jimp the same way a flat
 * PNG/JPEG template is downsized.
 *
 * @param {string} filePath
 * @param {'flat' | 'psd'} kind
 * @returns {Promise<string>} absolute path to the generated (or cached) preview PNG
 */
export async function generateTemplatePreview(filePath, kind) {
  const stat = fs.statSync(filePath);
  const key = cacheKey(filePath, stat);
  const cached = previewPathCache.get(key);
  if (cached && fs.existsSync(cached)) return cached;

  fs.mkdirSync(PREVIEW_DIR, { recursive: true });
  const hash = crypto.createHash('sha1').update(key).digest('hex');
  const previewPath = path.join(PREVIEW_DIR, `${hash}.png`);

  if (kind === 'psd') {
    ensurePsdCanvasInitialized();
    const buffer = fs.readFileSync(filePath);
    const psd = readPsd(buffer, { useImageData: false });
    const canvas = renderPsdLayers(psd);
    // pureimage has no resize of its own -- flatten to a full-res temp PNG first, then
    // let Jimp (already used for the flat-template path below) do the actual downsizing,
    // and clean the full-res intermediate up immediately after.
    const fullResPath = `${previewPath}.full.png`;
    await pureimage.encodePNGToStream(canvas, fs.createWriteStream(fullResPath));
    try {
      const flattened = await Jimp.read(fullResPath);
      await resizeToMaxEdge(flattened, PREVIEW_MAX_EDGE).writeAsync(previewPath);
    } finally {
      fs.rmSync(fullResPath, { force: true });
    }
  } else {
    const image = await Jimp.read(filePath);
    await resizeToMaxEdge(image, PREVIEW_MAX_EDGE).writeAsync(previewPath);
  }

  previewPathCache.set(key, previewPath);
  return previewPath;
}

/**
 * Reads every row from `product_sizes` (the DB table, now the live source -- see
 * config/index.js's getProductSizes()), each annotated with a `preview_url` for the
 * dashboard's configured-templates grid. A row whose template file no longer exists on
 * disk (moved/deleted outside the app) gets `preview_url: null` rather than throwing --
 * the row itself is still real config, just missing its thumbnail.
 * @returns {Promise<Array<object>>}
 */
export async function listConfiguredTemplates() {
  const db = getDb();
  const rows = db
    .prepare(
      'SELECT size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer FROM product_sizes ORDER BY size_key'
    )
    .all();

  const templatesDir = resolveTemplatesDir();
  const result = [];
  for (const row of rows) {
    let previewUrl = null;
    if (row.mockup_template_path) {
      const fullPath = path.isAbsolute(row.mockup_template_path)
        ? row.mockup_template_path
        : path.join(templatesDir, row.mockup_template_path);
      if (fs.existsSync(fullPath)) {
        try {
          const previewPath = await generateTemplatePreview(fullPath, detectKind(fullPath));
          previewUrl = `/mockup-template-previews/${path.basename(previewPath)}`;
        } catch {
          previewUrl = null;
        }
      }
    }
    result.push({ ...row, preview_url: previewUrl });
  }
  return result;
}

/**
 * Validates the referenced file exists under the current templates dir, then upserts
 * into `product_sizes` -- same ON CONFLICT(size_key) DO UPDATE pattern
 * generateMockupForJob() already uses inline (mockup-generator.js), moved here so both
 * callers share one function instead of two copies of the same SQL (see plan.md -> "New
 * module" -> upsertConfiguredTemplate). `mockup_template` is stored as-given (a filename
 * relative to the templates dir, matching the existing product-sizes.json convention).
 *
 * @param {{ size_key: string, dimensions?: string, dpi?: number, orientation?: string, mockup_template: string, placement_layer?: string }} entry
 * @returns {object} the resulting product_sizes row
 */
export function upsertConfiguredTemplate({ size_key, dimensions, dpi, orientation, mockup_template, placement_layer } = {}) {
  if (!size_key) throw new Error('size_key is required');
  if (!mockup_template) throw new Error('mockup_template is required');

  const templatesDir = resolveTemplatesDir();
  const fullPath = path.isAbsolute(mockup_template) ? mockup_template : path.join(templatesDir, mockup_template);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Template file not found: ${mockup_template} (looked in ${templatesDir})`);
  }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO product_sizes (size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer)
    VALUES (@size_key, @dimensions, @dpi, @orientation, @mockup_template_path, @placement_layer)
    ON CONFLICT(size_key) DO UPDATE SET
      dimensions = excluded.dimensions,
      dpi = excluded.dpi,
      orientation = excluded.orientation,
      mockup_template_path = excluded.mockup_template_path,
      placement_layer = excluded.placement_layer
  `);
  upsert.run({
    size_key,
    dimensions: dimensions || null,
    dpi: dpi || null,
    orientation: orientation || null,
    mockup_template_path: mockup_template,
    placement_layer: placement_layer || null,
  });

  return db.prepare('SELECT size_key, dimensions, dpi, orientation, mockup_template_path, placement_layer FROM product_sizes WHERE size_key = ?').get(size_key);
}

/**
 * Deletes the `product_sizes` row for `sizeKey`. Does NOT delete the underlying file (it
 * lives in the user's own folder, outside app-managed storage) or touch any `mockups`
 * rows already generated against it historically -- a deleted size just stops being
 * offered going forward, exactly like removing an entry from the old JSON file would
 * have. See plan.md -> "New module" -> deleteConfiguredTemplate.
 * @param {string} sizeKey
 * @returns {boolean} whether a row was actually deleted
 */
export function deleteConfiguredTemplate(sizeKey) {
  const db = getDb();
  const { changes } = db.prepare('DELETE FROM product_sizes WHERE size_key = ?').run(sizeKey);
  return changes > 0;
}

/**
 * Test-only reset hook: clears the in-process dimension/preview caches so test files
 * don't leak state (e.g. a stale preview path) into the next suite. Not called from
 * application code.
 */
export function _resetCachesForTests() {
  dimensionsCache.clear();
  previewPathCache.clear();
}
