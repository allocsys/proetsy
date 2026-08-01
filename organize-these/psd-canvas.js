// Pure-JS Canvas2D shim satisfying ag-psd's `initializeCanvas()` contract, backed by
// `pureimage` instead of `node-canvas`. See ARCHITECTURE.md -> Module 3 -> "Template
// formats" for why: `node-canvas` needs native Cairo bindings, which conflicts with the
// project's zero-native-deps/Termux-Electron constraint (same reasoning as `onnxruntime-web`
// over `onnxruntime-node` for Module 7, and Jimp over any native image lib elsewhere).
//
// ag-psd calls exactly two hooks from `initializeCanvas(createCanvas, createImageData)`
// (see node_modules/ag-psd/dist/helpers.js): `createCanvas(width, height)` to get a
// canvas-like object with `.getContext('2d')`, and `createImageData(width, height)` to
// get a mutable pixel buffer it fills in and later hands back to `putImageData`.
//
// pureimage's `Bitmap` (returned by `pureimage.make(w, h)`) satisfies BOTH roles as-is —
// it has `.getContext('2d')` for the canvas role, and its `.data` is already a flat
// Uint8Array in the same RGBA/row-major layout ag-psd writes into for the imageData role.
// The one thing pureimage's Context is missing that ag-psd's internals reach for
// (`putImageData`'s destination expects a source with a working `calculateIndex()`, i.e.
// a real Bitmap, not a plain `{width,height,data}` object — see pureimage's
// `_pasteSubBitmap`) is exactly why `createImageData` below also returns a full Bitmap
// rather than a lightweight ImageData-shaped stand-in. Verified against ag-psd's actual
// decode path (write a synthetic layered PSD via `writePsd`, read it back via `readPsd`,
// confirm layer pixel data round-trips correctly through this shim) before wiring it in.
//
// pureimage's Context also doesn't implement `createImageData`/`toDataURL` — ag-psd only
// needs `toDataURL` for thumbnail generation, which this project never requests, so it's
// deliberately left unimplemented here rather than stubbed with fake output.

import pureimage from 'pureimage';
import { initializeCanvas } from 'ag-psd';

function createCanvas(width, height) {
  return pureimage.make(width, height);
}

function createImageData(width, height) {
  return pureimage.make(width, height);
}

let initialized = false;

/**
 * Registers the pureimage-backed canvas shim with ag-psd. Idempotent — ag-psd's
 * `initializeCanvas` just reassigns module-level function references, so calling this
 * more than once (e.g. from multiple modules that both read PSD templates) is harmless,
 * but we still guard it to make call sites' intent explicit and avoid redundant work.
 */
export function ensurePsdCanvasInitialized() {
  if (initialized) return;
  initializeCanvas(createCanvas, createImageData);
  initialized = true;
}
