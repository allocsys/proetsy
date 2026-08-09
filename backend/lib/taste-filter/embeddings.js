// Module 7 (Taste Filter) — image embeddings via a JS-only CLIP implementation. See
// ARCHITECTURE.md -> Module 7 -> "Build sequence" step 1.
//
// preprocessImage() is a pure function (no model, no network) so the resize/crop/
// normalize math is unit-testable on its own. embedImage() is the only piece that
// touches onnxruntime-web / the model file.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
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
// (e.g. the `onnx/model.onnx` file from that model's Hugging Face repo). No longer a
// manual-download requirement -- see downloadModel()/getSession() below, which fetch it
// into place automatically the first time it's needed if it isn't already there.
const MODEL_PATH = process.env.TASTE_FILTER_MODEL_PATH
  ? path.resolve(process.cwd(), process.env.TASTE_FILTER_MODEL_PATH)
  : path.join(BACKEND_ROOT, 'models', 'clip-vit-base-patch32.onnx');

// Where getSession() downloads MODEL_PATH from when it isn't already present.
// Overridable (e.g. to point at a mirror, or a quantized variant) via
// TASTE_FILTER_MODEL_URL without touching code.
const MODEL_DOWNLOAD_URL =
  process.env.TASTE_FILTER_MODEL_URL ||
  'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model.onnx';

// The real export is ~350MB. Anything drastically smaller means a previous download was
// interrupted or saved an HTML error page instead of the binary -- treated as "not there"
// rather than trusted as-is, so a half-downloaded file doesn't silently get loaded into
// onnxruntime (which would fail with a much more confusing error than "missing").
const MIN_VALID_MODEL_BYTES = 50 * 1024 * 1024;

function isValidModelFile(filePath) {
  try {
    return fs.statSync(filePath).size >= MIN_VALID_MODEL_BYTES;
  } catch {
    return false;
  }
}

// Model-download progress, for the dashboard's loading bar (server.js's
// GET /api/taste-filter/model-status(/stream) routes read this). A plain module-level
// object + pub-sub, same lightweight pattern as watcher.js's pending-candidates
// subscribers -- no need for a full EventEmitter here, just "tell whoever's listening
// the state changed."
//   status: 'idle' | 'downloading' | 'ready' | 'error'
//   bytesDownloaded: number
//   totalBytes: number | null (null when the server didn't send Content-Length)
//   error: string | null
let downloadState = { status: 'idle', bytesDownloaded: 0, totalBytes: null, error: null };
const downloadStateListeners = new Set();

function setDownloadState(patch) {
  downloadState = { ...downloadState, ...patch };
  for (const listener of downloadStateListeners) listener(downloadState);
}

// Current snapshot -- for a plain GET poll / a client's first render before its SSE
// connection (see onModelDownloadProgress below) delivers anything.
export function getModelDownloadState() {
  return downloadState;
}

// Subscribes to every downloadState change from here on (not just future ones -- the
// caller is expected to read getModelDownloadState() for the current snapshot first,
// same split as watcher.js's getPendingCandidates()/onPendingCandidate() pair). Returns
// an unsubscribe function.
export function onModelDownloadProgress(listener) {
  downloadStateListeners.add(listener);
  return () => downloadStateListeners.delete(listener);
}

// A pass-through stream that does nothing to the bytes themselves -- just counts them as
// they flow past, so downloadModel() can report progress without buffering the whole
// response in memory to measure it (defeating the entire point of streaming a 350MB
// file straight to disk).
function progressCounterStream(totalBytes) {
  let bytesDownloaded = 0;
  return new Transform({
    transform(chunk, _enc, callback) {
      bytesDownloaded += chunk.length;
      setDownloadState({ status: 'downloading', bytesDownloaded, totalBytes, error: null });
      callback(null, chunk);
    },
  });
}

// Downloads MODEL_DOWNLOAD_URL straight to MODEL_PATH. Streams to a sibling `.download`
// temp file first and only renames it into place once fully written (rename is atomic on
// the same volume, on Windows and POSIX alike) -- so a crash or interrupted connection
// mid-download never leaves a corrupt file sitting at MODEL_PATH for the next run to trip
// over. Pure Node.js (fs/fetch/streams) -- no shell-out, no platform-specific download
// tool, so this runs identically on Windows, macOS, Linux, and Render.
async function downloadModel() {
  fs.mkdirSync(path.dirname(MODEL_PATH), { recursive: true });
  const tmpPath = `${MODEL_PATH}.download`;
  console.log(`[taste-filter] Downloading CLIP vision model from ${MODEL_DOWNLOAD_URL} ...`);

  const response = await fetch(MODEL_DOWNLOAD_URL, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download Taste Filter model: HTTP ${response.status} from ${MODEL_DOWNLOAD_URL}`
    );
  }

  // Content-Length is what Hugging Face's resolve/ URLs send for this file in practice,
  // but treat it as advisory -- a redirect through a mirror or CDN that omits/lies about
  // it just means the dashboard's progress bar falls back to indeterminate, not a reason
  // to fail the download.
  const totalBytes = Number(response.headers.get('content-length')) || null;
  setDownloadState({ status: 'downloading', bytesDownloaded: 0, totalBytes, error: null });

  await streamPipeline(
    Readable.fromWeb(response.body),
    progressCounterStream(totalBytes),
    fs.createWriteStream(tmpPath)
  );

  if (!isValidModelFile(tmpPath)) {
    fs.rmSync(tmpPath, { force: true });
    throw new Error(
      `Downloaded Taste Filter model from ${MODEL_DOWNLOAD_URL} looks truncated/invalid ` +
        '(smaller than expected). Check your network connection and try again.'
    );
  }

  fs.renameSync(tmpPath, MODEL_PATH);
  console.log(`[taste-filter] CLIP vision model ready at ${MODEL_PATH}`);
}

// Lazily-created, cached across calls -- de-duped the same way for the same reason as
// sessionPromise below, but covering ONLY the download-check+download step, not session
// creation. Split out from getSession() (which used to do both inline) so a caller that
// wants the ~350MB download paid for up front -- e.g. server.js at boot, before any
// request can reach embedImage() -- can await just that cost, without also forcing an
// InferenceSession.create() call or a real inference. See server.js's boot sequence for
// why: downloading (and loading) a large model inside a live request handler is exactly
// the kind of memory/time pressure that gets a process killed mid-request on a
// resource-constrained host, which surfaces to the client as an empty response body
// rather than a real error -- paying that cost once at startup instead makes a failure
// (or a slow/OOM-prone environment) visible in boot logs instead of as a mystifying
// client-side JSON parse error.
let modelReadyPromise = null;

export function ensureModelReady() {
  if (!modelReadyPromise) {
    modelReadyPromise = (async () => {
      try {
        // No-op if a valid model file is already at MODEL_PATH (the common case after the
        // first run) -- only downloads when it's missing or looks corrupt/truncated. Goes
        // straight to 'ready' with no 'downloading' phase in that case -- there's nothing
        // for a progress bar to show.
        if (!isValidModelFile(MODEL_PATH)) {
          await downloadModel();
        }
        setDownloadState({ status: 'ready', error: null });
      } catch (err) {
        // Don't cache a permanent failure -- a transient network error (or an interrupted
        // download) shouldn't poison every future call for the life of the process. The
        // next ensureModelReady()/embedImage() call gets a fresh attempt instead of
        // replaying this rejection.
        modelReadyPromise = null;
        setDownloadState({ status: 'error', error: err.message });
        throw err;
      }
    })();
  }
  return modelReadyPromise;
}

// Lazily-created, cached across calls — loading the ONNX session is expensive and the
// model is stateless/reusable across every embedImage() call, so there's no reason to
// reload it per call. Module-level singleton, same rationale as gemini.js's key-pool
// caching a single provider layer instance rather than reconstructing it per request.
// Callers that only care about the model file being on disk (not a live session) should
// use ensureModelReady() instead -- this always implies that, but also pays the session-
// creation cost, which a boot-time "just get the download out of the way" call doesn't
// need.
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      try {
        await ensureModelReady();
        return await ort.InferenceSession.create(MODEL_PATH);
      } catch (err) {
        // Same don't-cache-a-permanent-failure rationale as ensureModelReady() above --
        // a transient failure (including one bubbled up from ensureModelReady() itself)
        // shouldn't poison every future call for the life of the process.
        sessionPromise = null;
        throw err;
      }
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
