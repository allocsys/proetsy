// Loader for the committed synthetic layered-PSD test fixture (ARCHITECTURE.md -> Module
// 3 -> "Status" note: "a real PSD test fixture checked into the repo" — previously the
// PSD-decode path was only verified during development via a throwaway PSD built and
// round-tripped in-memory through ag-psd's own writePsd/readPsd, never committed).
//
// The fixture itself (`framed-wall-test.psd.b64`) was generated once via ag-psd's
// writePsd() from a plain JS layer-tree description, then base64-encoded — committed as
// base64 TEXT rather than a raw binary blob because this repo's file-editing tooling
// writes plain-text file content; base64 round-trips exactly and Buffer.from(..,
// 'base64') below decodes it back to the identical original bytes with no loss. Verified
// during generation by reading it back through readPsd() + this project's actual
// pureimage-backed canvas shim (psd-canvas.js's initializeCanvas hook, the same one
// mockup-generator.js uses at runtime) and confirming every layer's name, bounds, and
// pixel data decode correctly — not just that the write call succeeded.
//
// Document layout (120x100px canvas):
//   - 'background'   — full-canvas opaque layer (0,0)-(120,100)
//   - 'artwork'      — the placement layer product-sizes.json's DEFAULT_PLACEMENT_LAYER
//                       ('artwork') expects by default: (20,15)-(100,85), i.e. 80x70px
//   - 'frame group'  — a nested group containing 'top border' (0,0)-(120,10), exercising
//                       findPlacementLayer()/flattenPaintOrder()'s group-recursion paths
//                       against a real decoded PSD, not just hand-built plain objects
//                       (already covered separately in psd-template.test.js).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Bounds of the fixture's 'artwork' placement layer, for tests that need to size a
 * matching-aspect-ratio source artwork (keeping computeMismatchRatio() at 0 so a test
 * doesn't accidentally trigger a real outpaint/Gemini call). */
export const PSD_FIXTURE = {
  documentWidth: 120,
  documentHeight: 100,
  placementLayerBounds: { left: 20, top: 15, width: 80, height: 70 },
};

/**
 * Decodes the committed fixture and writes it out as a real .psd file at `destPath`, for
 * tests that need an actual file on disk (composeMockup() reads templates via
 * fs.readFileSync, not from memory).
 * @param {string} destPath
 */
export function writePsdFixtureTo(destPath) {
  const b64Path = path.join(__dirname, 'framed-wall-test.psd.b64');
  const base64 = fs.readFileSync(b64Path, 'utf8').trim();
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.from(base64, 'base64'));
}
