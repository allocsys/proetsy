// Module 7 (Taste Filter) — image embeddings via a JS-only CLIP implementation. See
// ARCHITECTURE.md -> Module 7 -> "Build sequence" step 1.
//
// preprocessImage() is a pure function (no model, no network) so the resize/crop/
// normalize math is unit-testable on its own. embedImage() is the only piece that
// touches onnxruntime-web / the model file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Jimp from 'jimp';
import * as ort from 'onnxruntime-web';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.join(__dirname, '..', '..');

// CLIP's standard input size and normalization constants (OpenAI CLIP / Xenova's
// clip-vit-base-patch32 preprocessor config) — not arbitrary, these must match what the
// model was trained/exported with.
const CLIP_IMAGE_SIZE = 224;
const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];

// The .onnx weights file is a large binary and isn't committed to the repo — resolved
// via an env-driven path, same pattern as mockup-generator.js's MOCKUP_TEMPLATES_DIR.
// Expected to hold Xenova/clip-vit-base-patch32's vision encoder exported to ONNX
// (e.g. the `onnx/model.onnx` file from that model's Hugging Face repo).
const MODEL_PATH = process.env.TASTE_FILTER_MODEL_PATH
  ? path.resolve(process.cwd(), process.env.TASTE_FILTER_MODEL_PATH)
  : path.join(BACKEND_ROOT, 'models', 'clip-vit-base-patch32.onnx');

// Lazily-created, cached across calls — loading the ONNX session is expensive and the
// model is stateless/reusable across every embedImage() call, so there's no reason to
// reload it per call. Module-level singleton, same rationale as gemini.js's key-pool
// caching a single provider layer instance rather than reconstructing it per request.
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      if (!fs.existsSync(MODEL_PATH)) {
        throw new Error(
          `Taste Filter model not found at ${MODEL_PATH}. Download the ONNX export of ` +
            'Xenova/clip-vit-base-patch32 (its vision encoder) and place it there, or set ' +
            'TASTE_FILTER_MODEL_PATH to point at it. See ARCHITECTURE.md -> Module 7.'
        );
      }
      return ort.InferenceSession.create(MODEL_PATH);
    })();
  }
  return sessionPromise;
}

/**
 * Resize the image so its shorter side is CLIP_IMAGE_SIZE, then center-crop to an exact
 * CLIP_IMAGE_SIZE x CLIP_IMAGE_SIZE square — the standard CLIP preprocessing pipeline
 * (resize-shorter-side + center-crop, not a plain stretch-resize, so aspect ratio is
 * preserved for the region that ends up in-frame).
 * @param {Jimp} image
 * @returns {Jimp}
 */
function resizeAndCenterCrop(image) {
  const { width, height } = image.bitmap;
  const scale = CLIP_IMAGE_SIZE / Math.min(width, height);
  const resized = image.clone().resize(Math.round(width * scale), Math.round(height * scale));

  const cropX = Math.max(0, Math.round((resized.bitmap.width - CLIP_IMAGE_SIZE) / 2));
  const cropY = Math.max(0, Math.round((resized.bitmap.height - CLIP_IMAGE_SIZE) / 2));
  return resized.crop(cropX, cropY, CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE);
}

/**
 * Pure preprocessing: takes an already-loaded Jimp image and produces the CHW
 * (channel, height, width), normalized Float32Array CLIP's vision encoder expects as
 * input — resize+center-crop to 224x224, split into R/G/B planes (Jimp stores pixels
 * interleaved RGBA; the model wants planar, not interleaved), scale from [0, 255] to
 * [0, 1], then normalize each channel with CLIP's own mean/std. No model, no I/O beyond
 * what the caller already loaded — unit-testable against a synthetic Jimp image.
 * @param {Jimp} image
 * @returns {Float32Array} length 3 * CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE, planar RGB
 */
export function preprocessImage(image) {
  const cropped = resizeAndCenterCrop(image);
  const { data } = cropped.bitmap; // interleaved RGBA, row-major
  const pixelCount = CLIP_IMAGE_SIZE * CLIP_IMAGE_SIZE;
  const planar = new Float32Array(3 * pixelCount);

  for (let i = 0; i < pixelCount; i += 1) {
    const rgbaOffset = i * 4;
    // Plane layout: all R values, then all G values, then all B values (CHW) — not
    // interleaved like the source buffer.
    planar[i] = (data[rgbaOffset] / 255 - CLIP_MEAN[0]) / CLIP_STD[0]; // R
    planar[pixelCount + i] = (data[rgbaOffset + 1] / 255 - CLIP_MEAN[1]) / CLIP_STD[1]; // G
    planar[2 * pixelCount + i] = (data[rgbaOffset + 2] / 255 - CLIP_MEAN[2]) / CLIP_STD[2]; // B
  }

  return planar;
}

/**
 * L2-normalizes a vector in place-equivalent (returns a new array) so downstream cosine-
 * similarity scoring (Module 7 step 3) reduces to a plain dot product. Pure/testable
 * without a model.
 * @param {Float32Array | number[]} vector
 * @returns {Float32Array}
 */
export function l2Normalize(vector) {
  let sumSquares = 0;
  for (let i = 0; i < vector.length; i += 1) sumSquares += vector[i] * vector[i];
  const norm = Math.sqrt(sumSquares) || 1; // avoid divide-by-zero on an all-zero vector
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i += 1) out[i] = vector[i] / norm;
  return out;
}

/**
 * Loads an image from disk, runs it through the CLIP vision encoder, and returns an
 * L2-normalized embedding. This is the only exported function that touches the ONNX
 * session / model file — everything else in this module is pure and testable without it.
 * @param {string} imagePath
 * @returns {Promise<Float32Array>}
 */
export async function embedImage(imagePath) {
  const image = await Jimp.read(imagePath);
  const input = preprocessImage(image);

  const session = await getSession();
  const tensor = new ort.Tensor('float32', input, [1, 3, CLIP_IMAGE_SIZE, CLIP_IMAGE_SIZE]);

  // Input/output tensor names follow Xenova's standard CLIP vision-encoder ONNX export
  // ("pixel_values" in, "image_embeds" out). Fall back to whatever the session actually
  // reports if a differently-named export is dropped in, rather than hard-failing on a
  // naming mismatch alone.
  const inputName = session.inputNames.includes('pixel_values') ? 'pixel_values' : session.inputNames[0];
  const results = await session.run({ [inputName]: tensor });
  const outputName = session.outputNames.includes('image_embeds') ? 'image_embeds' : session.outputNames[0];

  return l2Normalize(results[outputName].data);
}

// Exported for step 2/3 (centroids.js, scoring) and tests.
export { CLIP_IMAGE_SIZE, MODEL_PATH };
